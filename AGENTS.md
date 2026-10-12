# Living Town 开发与维护边界

本仓库是已收尾的个人作品集：全合成静态演示 + local-first Python 账本核心。
停止扩展功能；维护只处理正确性、可复现性、隐私与展示故障。

- 先读 `PROJECT_STATE.md`、`docs/architecture.md`、`docs/data-invariants.md` 和相关 ADR。
- 金额使用整数分，经 Decimal 解析；符号在 direction。退款、内部转账、投资不算外部收入或生活消费。
- 原始证据与 canonical 事实保持不可变；修正走解释层。不平账报告差额，禁止造调整交易。
- Schema 变化使用新增编号 migration；禁止重建用户数据库。正式数据检查用只读连接或临时副本。
- 自动建议最多 PROBABLE，CONFIRMED 来自人工。浏览器不计算财务事实，不访问 SQLite。
- 默认 Web 入口只读 `web/public/demo/ledger.json`。`?local` 显式使用本机 API，失败时不得用模拟数据冒充。
- 合成数据仅来自 `tests/fixtures/`；运行 `python scripts/build_demo.py` 在临时数据库生成投影。
- 不提交真实账单、账户信息、规则备份、运行记录、私有路径或凭证，公开截图只使用合成数据。
- 修改前记录 Git baseline，保留用户已有改动；逐文件审查/暂存，使用 conventional commit。
- 提交前 `python -m pytest` 全绿；Web 改动完成 `cd web && npm test && npm run build`。
- 停止大重构与新平台集成。旧 SVG 工作台和事件契约作为维护能力保留，演练/迁移试点已从公开版排除。
- 面向用户默认简体中文；使用具体、简洁的叙述。独立读取批量执行；临时验证产物用后清理。
