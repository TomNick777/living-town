# TownEvent 表达契约

事件是 canonical 事实的派生只读文档。后端决定可表达的行为、目标地点、
强度与时间精度；浏览器校验文档并运行展示时钟，不重新解释交易。

| 行为 | 表达 |
|---|---|
| VISIT | 人物沿道路到访、停留、离开 |
| TRANSIT | 候车与穿行，不声称是 GPS 轨迹 |
| DELIVERY | 配送站至住宅的展示路线 |
| CREDIT | 收入建筑反馈，工资不生成假到访人物 |
| PASSIVE | 住宅等场所反馈，不生成人物路线 |
| UNKNOWN | 保留事件与覆盖统计，不编造动画 |

未知分类与未映射事件计入 coverage。覆盖率表示有展示语义的比例，不是分类准确率。
DAY 精度只表明日期；缩时重放中的演出时间不冒充原始交易时刻。
ambient actors 与昼夜观看设置只营造氛围，不重建用户作息。

保留的本机服务包括 month-scoped v2 projection、TownPeriod 的月/年 montage，
以及 TownEvents v3 consumer / delta 契约。公开页面使用合成 TownPeriod v1 快照。
版本兼容与 delta 行为由 `tests/living_town/test_town_events*` 验证。

人物有 WALKING / ARRIVED / DWELLING / LEAVING 状态，全局有数量上限。
几何、材质与人物组复用，页面隐藏时停止绘制，卸载时释放 GPU 资源。
