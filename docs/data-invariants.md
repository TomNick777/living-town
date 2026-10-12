# Life Energy Data Invariants

不可破坏的规则。任何 PR / 重构 / 新功能违反以下任何一条，即视为 bug。
每条都对应可执行的测试（括号内为测试位置）。

## 事实层（Canonical Facts）

1. **事实不可变**。导入后不得 UPDATE/DELETE `transactions` 的事实字段；
   一切修正写入派生层（interpretation / pairs / links）。
2. **原始证据 append-only**。`raw_records` / `import_batches` 只插入；
   原始 payload 保留渠道原始列名与值，任何下游结论都不回写证据行
   （`canonical_transaction_id` / `status` 除外，且只在导入事务内写一次）。
   （tests/ledger/test_import.py）
3. **用户原始账单文件是只读的**。系统可以读取、hash、解析、记录来源，
   但绝不重命名、移动、删除、修改、覆盖。文件名在库里只存 basename。
   （tests/ingestion/test_parsers.py::test_original_file_is_never_modified）
4. **导入幂等**。同一文件重复导入：canonical 行数不变（文件 sha256 短路）；
   字节不同但语义相同的再导出：行级去重（UNIQUE(source, source_reference)
   + canonical_fingerprint），重复只留 audit 记录。
   （tests/ledger/test_import.py）
5. **金额永不用 float**。解析经 Decimal；存储为整数分（amount_minor >= 0）；
   符号在 direction。精度损失在这个系统里是数据损坏。
   （tests/normalization/test_amount_time.py）
6. **拒绝诚实归类就写 UNKNOWN**。类型识别不出来的行是 UNKNOWN（保留方向），
   不是猜测的 EXPENSE/INCOME；"不计收支"且无法归类的行整行拒绝并留痕。
   （tests/normalization/test_channel_semantics.py）

## 语义中性（Life Energy 边界）

7. **Energy 不污染事实**。`transactions` 表没有 energy 列；能量解释只存在于
   派生层，且每条带 energy_derived_from provenance。
   （tests/test_migrations.py::test_fact_and_derived_layers_separated）
8. **内部转账中立**。A → B（本人账户间）：Energy Input 不增加，
   Energy Consumption 不增加。转账/红包/充值/提现/信用卡还款在事实层就是
   TRANSFER，永远不是 INCOME/EXPENSE。
   （tests/energy/test_invariants.py::test_transfer_neutrality、
   tests/normalization/test_channel_semantics.py）
9. **退款不是收入**。退款事实是 REFUND，能量解释是 ENERGY_RETURN；
   无法确定原交易时显式 UNRESOLVED，绝不改记为外部收入。
   （tests/reconciliation/test_refunds.py）
10. **投资不是消费**。投资转出（基金/理财/余额宝/证券）是 ENERGY_EXPORT，
    永不进入 Energy Consumption；赎回回流是 ENERGY_IMPORT。
    （tests/energy/test_invariants.py::test_investment_separation）
11. **消费 ¥100 后退款 ¥100，净生活消耗为 0**。退款必须追溯原交易并体现在
    周期汇总里。
    （tests/energy/test_invariants.py::test_refund_correction）

## 对账（Reconciliation）

12. **不平账就报差额，绝不自动造数**。禁止自动插入 opening balance、
    adjustment、reconciliation income、fake dividend、fake expense 来让
    数字相等。对不上就输出 UNRECONCILED + 差额 + 明细查询入口。
    （tests/energy/test_energy_month.py、CLI smoke）
13. **自动配对上限是 PROBABLE/UNCERTAIN**。CONFIRMED 只来自人工确认或
    人工创建；拒绝过的配对不再自动建议；解除配对留 REJECTED 记忆。
    配对手续费只记在 pair 上，绝不生成合成交易。
    （tests/reconciliation/test_transfers.py）
14. **归因不猜**。payment_method 匹配不上任何 alias 时，source_account_id
    为 NULL 并进入 unattributed 查询；NULL 是诚实状态，不是错误。
    （tests/ledger/test_import.py::test_unresolved_states_are_explicit）

## 分类（Classification）

15. **优先级链严格有序**：Manual Override > USER_EXPLICIT > MERCHANT >
    KEYWORD > HEURISTIC > NONE。命中即停，不做分数混合；
    每条分类必须能回答"为什么"（source + rule_id + evidence）。
    （tests/test_classification.py）
16. **手工覆盖永不失效**。is_manual_override=1 的解释在 recompute 时被跳过。
    （tests/test_classification.py::test_manual_override_never_clobbered_by_recompute）

## 演进（Evolution）

17. **增量迁移，禁止重建**。schema 变更只能是新的编号迁移；禁止以删除/重建
    正式数据库作为升级方式；代码不得打开比自身更新的数据库。
    （tests/test_migrations.py）
18. **禁止真实数据进测试**。测试只用 tests/fixtures/ 下的 synthetic 数据；
    真实账单与正式账本永不进入 git（.gitignore 已按此配置）。
19. **不连接 Otter Holdings**。本阶段不产生任何跨项目运行时耦合，只保留
    ENERGY_EXPORT 事实 + provenance 作为未来导出接口的素材。

## 证据权威源（Phase 6 cutover，2026-09-10）

> 跨项目权威关系声明，位于上述 19 条账本不变量之上的边界约定。
> 对应实现：`src/life_energy/evidence_bridge.py`（见 docs/evidence-bridge.md）；
> 对端：Otter Evidence（外部可选服务）。

20. **证据身份与处理状态的权威源是 Otter Evidence**。账本内
    `import_batches` 降级为「本地写入缓存」语义：它继续负责导入幂等
    （sha256 短路），但「这个文件是否/如何被处理过」的权威查询走 Evidence
    服务（`evidence status`、Evidence API）。服务不可用时降级为本地视图并
    明示——降级是暂态，绝不升级本地视图为权威。
    （tests/evidence_bridge/test_bridge.py）
21. **文件位置登记与对账归 otter-evidence**。账本只存 basename（历史决定，
    见 schema 注释），完整路径、副本、vault 副本与内容漂移检测由
    otter-evidence 的 evidence_location / verify / reconcile 承担；
    账本侧不得自行重建这套登记。
    （otter-evidence: reconcile-living-town 36/36 对账 + doctor 例行体检）
