# Living Town UI Contract — 未来 UI 允许读取什么

- 状态:v1 契约(`living-town-v1`)。只定义数据入口,不设计任何 UI。
- 背景:`docs/life-town.md`(世界观)、`docs/living-town-projection.md`(语义)。

## 原则

1. **UI 是纯表达层**。未来 Living Town Renderer(无论 2D/3D/文本)
   只消费本契约列出的数据源,自己决定视觉载体;财务事实、能量术语、
   规则细节不外泄到 UI 语义之外(如 UI 上不出现「ENERGY_EXPORT」字样)。
2. **UI 没有任何写路径**。修正永远走既有通道:interpretation override /
   classify rule / transfer pair / refund link。UI 可以调用 CLI 层的
   这些命令,但绝不允许直写数据库表。
3. **一切可解释**。UI 呈现的每个状态都应能回答「为什么」——数据源是
   Town State 的 `explanations`;UI 不得凭空装饰状态。

## UI 允许读取的数据源

### 一等数据源:Town State(本阶段已实现)

```
life_energy.living_town.build_town_state(conn, month) -> TownState
CLI: life-energy town state|scenes|explain --month YYYY-MM [--json]
本地 HTTP(world serve,127.0.0.1 只读):
  GET /api/months                    # 有交易的月份列表(月份导航用)
  GET /api/town-state?month=YYYY-MM  # 与 CLI 同一投影的 JSON
  GET /api/ledger-board?month=YYYY-MM
                                     # 月报看板派生:跨月序列 / 日历 /
                                     # 商户净消耗 / 账户净流动
  GET /api/ledger-review?month=YYYY-MM[&type=&bucket=&q=&limit=&offset=]
                                     # 流水工作台:期间交易列表 + 未决分桶
```

`TownState.to_dict()` 的字段(`docs/living-town-projection.md` 第 4 节
有完整定义):

| 块 | UI 可用于 |
|---|---|
| `period` | 时间字幕、月份切换 |
| `financial` | 小镇「生活账」叙述:收入/消耗/结余/外输的量感 |
| `state.vitality` | 小镇整体活跃气氛的等级依据 |
| `state.stability` | 小镇秩序感/安稳感的等级依据 |
| `state.consumption_pressure` | 生活压力的叙事等级 |
| `state.saving_strength` | 储能/蓄水意象的等级依据 |
| `state.investment_outflow` | 「小镇 → 海獭控股」连接的活跃度 |
| `state.data_health` | 数据迷雾/施工围挡等"诚实的不完美"表达 |
| `scenes` | 各生活侧面的活动量、占比、活跃天数、环比 |
| `unresolved` | 未决状态的诚实呈现(迷雾/待办),绝不自动脑补 |
| `projects` | 阶段性建设进度(装修/买车/旅行),v1 恒为空 |
| `explanations` | 状态点击后的"为什么"面板 |
| `projection_version` / `generated_at` | 版本与时效标注 |

### 一等数据源补充:Ledger Board / Ledger Review(只读派生)

`GET /api/ledger-board` 与 `GET /api/ledger-review` 把既有 energy / ledger
查询收成版本化 JSON,供展示页的「月报看板」和「流水账本」使用。金额仍
取 energy 口径或 canonical `amount_minor`;浏览器不得对返回列表再求和。
看板 JSON 不含 `ENERGY_*` 字段名。流水页只列事实与未决旗标,不暴露
`raw_payload`,也没有写路径。

### 二等数据源:既有只读查询(细节视图/裁决工作台)

- `ledger.queries.list_transactions / get_transaction` — 交易明细;
- `ledger.queries.unresolved_transactions` — 五类未决全集;
- `ledger.queries.net_flow_by_account` — 账户视角现金流;
- `energy.model.summarize_period` — 周期能量口径(与 Town State 同源);
- `reconciliation` 的 candidates / list 查询 — 转账与退款裁决工作台。

### 允许的写操作入口(仅经由既有领域服务,绝不直写表)

`energy.interpret.override_energy_type`、
`classification.engine.override_category`、
`transfer_pairing.confirm_pair/create_pair/unpair`、
`refund_pairing.link_refund/confirm_refund_link/unlink_refund`、
`accounts.service.add_alias/reattribute`。

## UI 禁止读取 / 禁止做的事情

- 禁止读取 `raw_records.raw_payload` 用于渲染(它是证据,不是素材;
  裁决工作台可读字段级解析结果,不展示原始 payload);
- 禁止把 `transactions`/`raw_records`/`interpretation` 当作渲染数据
  直接绘图——一切汇总语义必须经过 Town State 或 energy 口径;
- 禁止在 UI 层发明第二套财务计算(哪怕只是"顺便"求个和);
- 禁止 UI 状态反过来写入 Town State(它永远只读、可重算);
- 禁止为了好看自动"修复"未决状态;未决必须是显式的 UI 状态。

## Town State 中永久禁止出现的字段类型

`building_*` / `npc_*` / `animation_*` / `road_*` / `weather` /
`map_position` 等一切视觉载体字段(颜色、坐标、层级数、开闭状态、
速度、数量)——它们属于 Renderer 自己的资产与配置。Town State 只提供
语义(score / band / count / amount / trend / factor);「ALIVE 的小镇
画几盏灯、有没有咖啡店」是 Renderer 的决定,不是数据的字段。

## 版本与演进兼容

- UI 应声明自己适配的 `projection_version`;`living-town-v1` 的字段
  语义以上文为准。未来升版(v2)时,旧字段要么语义不变,要么升版本号
  ——不允许同名静默变义;
- 评分阈值会演进(见 `rules.RULES_VERSION`):UI 不得硬编码 band 阈值,
  只消费已算好的 score/band,解释面板直接展示 `explanations`;
- `generated_at` 每次现算都不同:UI 若缓存 Town State,必须带着它做
  时效标注,且缓存永远可以被现算结果安全替换。
