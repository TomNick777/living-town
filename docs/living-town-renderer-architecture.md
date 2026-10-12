# Living Town Renderer — Architecture

- 状态:v1 已实现(`web/`,visual projection = `living-town-visual-v1`)
- 前置:`docs/living-town-projection.md`(Town State 语义)、
  `docs/living-town-ui-contract.md`(UI 可读什么)、`docs/life-town.md`(世界观)、
  `docs/living-town-visual-language.md`(视觉基线)
- 本阶段目标:建立 **TownState → TownVisualState → SceneModel → Renderer**
  的架构与一个最小静态等距街区;不是最终视觉设计。

## 0. 阶段文件边界(审计用)

- **新增**:`web/`(React + TypeScript + Vite + Vitest 前端,独立于 Python
  包)、`docs/living-town-renderer-architecture.md`、
  `docs/living-town-visual-language.md`、根 `.gitignore` 增加 `artifacts/`。
- **未修改**:`src/life_energy/`(含刚冻结的 `living_town/`)、`db/`、
  `tests/`、Raw / Canonical / Schema、既有 UI contract。Python 172 项测试原样。
- 前端**不直接读取** `data/life-energy.db`;唯一数据入口是 Town State
  JSON(fixture 或 `town state --json` 的输出)。

## 1. TownState(领域状态,输入)

`life_energy.living_town.build_town_state` 的 `to_dict()` 形状
(`living-town-v1`,见 projection doc 第 4 节)。前端把它当作**只读契约**:
`web/src/town/adapter/townState.ts` 定义同形 TypeScript 类型,
`validateTownState()` 校验版本、块结构、整数分金额、0..1 评分与 band
枚举——**只校验,不计算**。`parseTownStateText()` 同时接受
`life-energy town state --month YYYY-MM --json` 的完整 stdout(人读表 +
JSON 块),定位 JSON 后交给校验;这就是本阶段的 CLI export adapter,无需改
Python。

## 2. TownVisualState(视觉语义,边界)

`web/src/town/visual/visualState.ts`。这是财务领域与一切视觉之间的
**唯一边界**:只含命名等级、版本字符串与解释,**没有任何数字**(测试断言
所有叶子都是字符串)。

| 字段 | 取值 | 主要来源 |
|---|---|---|
| `ambient_activity` | QUIET / NORMAL / ACTIVE / BUSY | `vitality`(按 band;金额结构性不参与) |
| `residential_stability` | FRAGILE / NORMAL* / STABLE / STRONG | `stability` |
| `consumption_tension` | LOW / NORMAL / HIGH / SEVERE | `consumption_pressure` |
| `reserve_state` | DEPLETED / LOW / HEALTHY / STRONG | `saving_strength` |
| `external_flow_activity` | NONE / LOW / NORMAL / HIGH | `investment_outflow` |
| `data_certainty` | HEALTHY / REVIEW / UNCERTAIN | `data_health` + `unresolved` + `financial.balanced` |
| `scene_activity[scene]` | IDLE / NORMAL / ACTIVE / HIGH(11 个 scene 全量) | `scenes[scene].active_days` |
| `explanations[]` | `{field, value, rule, because[]}` | 每个字段一条,可追溯到 TownState 读数 |
| `visual_projection_version` | `living-town-visual-v1` | — |
| `source_projection_version` / `period_month` | 字符串 | TownState 元数据 |

\* `NORMAL` 为保留等级:`living-town-v1` 的 stability 只有三档
(FRAGILE / MODERATE / SOLID),v1 规则不会产生它;保留是为了未来更细的
规则版本不必改视觉契约。

## 3. Visual Projection(TownVisualProjector)

`web/src/town/visual/townVisualProjector.ts::projectTownVisualState`,
纯函数、确定性、零副作用。规则集中在 `visualRules.ts`,每条有稳定编号:

| 规则 | 映射 |
|---|---|
| VR-1 | vitality band → ambient:DORMANT→QUIET,QUIET→NORMAL,ALIVE→ACTIVE,THRIVING→BUSY |
| VR-2 | stability band → residential:FRAGILE→FRAGILE,MODERATE→STABLE,SOLID→STRONG |
| VR-3 | pressure band → tension:LOW/NORMAL/HIGH 同名,EXTREME→SEVERE |
| VR-4 | saving band → reserve:NONE→DEPLETED,WEAK→LOW,MODERATE→HEALTHY,STRONG→STRONG |
| VR-5 | investment band → external flow:NONE→NONE,WEAK→LOW,MODERATE→NORMAL,STRONG→HIGH |
| VR-6 | data_health band → certainty:HEALTHY→HEALTHY,REVIEW→REVIEW,NEEDS_WORK→UNCERTAIN |
| VR-6b | `financial.balanced=false` 时 HEALTHY 降为 REVIEW(只动数据可信,不动任何生活等级) |
| VR-7 | scene 活跃天数 → 激活度:0→IDLE,≤3→NORMAL,≤10→ACTIVE,>10→HIGH(amount 永不读取) |

设计约束:

- 只消费 band(与 score 用于解释),**不在前端重算任何比率、不硬编码领域
  阈值**(契约要求);
- 「数据不确定 ≠ 生活不好」:VR-6/6b 与 VR-1..5 完全独立,专项测试;
- 解释示例(真实输出形状):

```
ambient_activity = BUSY   [VR-1]
  TownState.state.vitality = THRIVING (score 0.9500)
  life scenes active in period = 5
  spending amounts are structurally excluded (vitality is day/scene based)
residential_stability = FRAGILE   [VR-2]
  TownState.state.stability = FRAGILE (score 0.3400)
  context: consumption_pressure band = EXTREME
  context: net storage change is positive
```

解释里只出现 band、score、计数与符号,不出现金额。改任何表 = 升
`VISUAL_PROJECTION_VERSION`。

### 关于层的位置(living_town_visual → web/src/town/visual)

任务书建议的独立层名是 `living_town_visual`。本阶段把它落在前端
`web/src/town/visual/`(TypeScript)而不是新建 Python 包,理由:
① 第十四节要求的管线 Adapter → Projector → VisualState → SceneModel →
Renderer 全部在前端内,投影器必须能在浏览器里对 fixture 运行,不依赖
Python;② 单一实现,避免 Python/TS 双真源;③ Python 数据层刚形成冻结
checkpoint,不再触碰。它仍然是独立、纯、可测、版本化的层——只是宿主语言
是 TS。若未来需要服务端投影(缓存/API),以本文件的规则表为唯一规范移植。

## 4. SceneModel(有什么、在哪、什么顺序)

- 配置:`web/src/town/scene/livingTownScene.ts` —— 纯数据
  (`{id, asset, gridX, gridY, gridZ, orientation}`),街区布局由它驱动,
  不在 JSX 里硬编码。
- 构建:`sceneModel.ts::buildSceneModel(config)`:解析资产、投影到屏幕、
  校验(id 唯一、资产已注册、整数坐标、footprint 不越界、实体 footprint
  不重叠、anchor 与可变地块必须存在)、生成地面格与**总序**的画家顺序。
- SceneModel **不读取任何视觉状态或财务数据**:三个 demo 共用同一个模型。
- 「生活元素」(行人)只在模型里留**候选位置**(`livingSpots`,按优先级
  排序),不是实体。

## 5. Renderer

`web/src/town/render/`:

- `tokens.ts` —— **Renderer 对 TownVisualState 的唯一解释表**
  (`renderTokens()`):`windowLight`、`pedestrians`、`shopFront`、
  `anchorFlow`、`publicMood`、`greenery`、`dataHaze`、`lotState`。资产组件
  只读 token,不读 VisualState 字段;未来「BUSY 长什么样」只改这一个文件。
- `assetComponents.tsx` —— 每个资产一个 SVG 组件,输入 `PlacedObject`
  + `RenderTokens`。
- `TownRenderer.tsx` —— 把地面、按画家顺序合并了行人的对象列表、氛围
  叠层画成一个 `<svg viewBox>`;props = `{ model: SceneModel; visual:
  TownVisualState }`,**不含任何金额**(类型级 + 运行时测试)。
- 允许的 import:react、render/、scene/、visual/;禁止 adapter/、任何
  Node/DB 模块(测试扫描源码强制)。

Token 表(v1 占位,不是产品规则):

| token | 来源 | v1 取值 |
|---|---|---|
| `pedestrians` | ambient | QUIET 0 / NORMAL 2 / ACTIVE 4 / BUSY 6(静态放置于 livingSpots) |
| `shopFront` | ambient | quiet / open / lively(玻璃与招牌灯) |
| `windowLight` | residential − (tension ≥ HIGH ? 1 : 0) | dim 22% / partial 45% / warm 70% / full 92%(按稳定 hash 选窗) |
| `publicMood` | tension | serene(暖 6%)/ calm(无)/ tense(冷 7%) 叠层 |
| `greenery` | reserve | 花坛花朵 0 / 1 / 2 / 4 |
| `anchorFlow` | external flow | 流动点 0 / 2 / 4 / 6;busy 有 2.4s 轻微脉动(尊重 reduced-motion) |
| `dataHaze` | certainty | 可变地块上的测量旗:none / review / uncertain |

## 6. Isometric coordinate system

`web/src/town/scene/coordinates.ts`,全场景唯一的坐标来源:

```
grid  (x → 东南, y → 西南, z = 地面以上像素)
sx = (x − y) · TILE_W / 2          TILE_W = 64
sy = (x + y) · TILE_H / 2 − z      TILE_H = 32   (2:1 菱形)
```

- footprint `{w, h}` 的地面四角 N/E/S/W 由 `groundQuad()` 给出;
  盒体 = 顶面 + 南面(屏幕左下,临街)+ 东面(屏幕右下);
- 画家顺序 `drawKey`:平铺(flat)永远先于实体;实体按 footprint 远角
  `(x+w−1)+(y+h−1)` 再按 z;模型里最后按 id 决胜,得到总序;
- `viewBoxFor(bounds, tallest)` 由边界与最高资产算出,页面里 SVG
  `width=100%`,移动端自动缩放,无横向溢出。
- 禁止任何组件手写像素位置;小道具用小数格坐标(`at(x+0.5, y+0.5)`)。

## 7. Asset system

`web/src/town/scene/assets.ts` 注册表(身份 / 类别 / footprint / flat /
高度),绘制在 render 层:

| 类别 | 资产 |
|---|---|
| building | `residential_a`(2×2 中层公寓)、`residential_b`(2×2 低层混合居住,底层小店)、`convenience_store`(2×1)、`cafe`(1×1) |
| infrastructure | `road_straight`、`road_corner`、`sidewalk`、`crosswalk`、`bridge`(2×1)、`water`、`green_patch` |
| furniture | `street_light`、`bench`、`vending_machine`、`bicycle_rack`、`bus_stop` |
| nature | `tree`、`shrub`、`planter` |
| living | `pedestrian`(v1 静态)、`bicycle`、`car`(仅注册,场景未用) |
| special | `external_connection_anchor`(2×1)、`variable_lot`(2×2) |

资产命名不含任何消费分类词(测试断言)。

## 8. UI / domain boundary

```
data/life-energy.db ─(Python, 只读)─► TownState JSON ─► web/
                                                     adapter  校验,不算
                                                     visual   band → 等级 + 解释
                                                     scene    资产/坐标/顺序(无财务)
                                                     render   token → SVG(无财务)
```

- 前端零 SQLite 访问、零写路径;金额在 adapter 之后**物理上**不再向下传
  (VisualState 无数字;Renderer props 无金额;测试扫描 markup 中不含
  fixture 的任何金额)。
- 禁止:组件直接读 `saving_strength` 决定灯数;`if (ratio > 0.7)`;
  建筑 ↔ 分类映射;建筑随月份出现/消失(测试:三态资产集合一致)。
- UI contract 缺口:本阶段**没有**发现需要新增的领域字段
(所需读数——band/score/active_days/count/balanced/period——契约均已提供),
因此未创建 `living-town-ui-contract-gap.md`。

## 9. external connection anchor

`external-connection-anchor`(资产 `external_connection_anchor`)放在
河对岸 `(14,6)-(15,6)`:主路过桥后的路段 + 门架 + 指向东侧(海獭控股方向)
的箭头。`external_flow_activity` 只改变它的流动点与脉动——**不画 CBD、
不画对岸建筑**。SceneModel 用 `externalConnectionAnchorId` 显式暴露该
对象,未来 Otter Holdings 场景以它为连接点(桥/道路/铁路方向)。

`variable-lot`(`(6,0)-(7,1)`,围绳空地)是未来装修/建设/生活阶段项目的
预留位,v1 恒为 `EMPTY`,与 `TownState.projects=[]` 对应;不实现目标管理。

## 10. future animation boundary

- v1 只有一处克制动画:anchor `busy` 的流动点脉动(CSS keyframe,
  `prefers-reduced-motion` 关闭)。
- 未来动画(行人移动、车辆、昼夜、天气、季节)的边界:**输入只能是
  RenderTokens**,不能新增对 VisualState 字段或金额的直接读取;动态实体
  从 `livingSpots` 之类的模型数据出发;时间驱动的变化不得改变 TownVisualState
  (它是期间状态,不随时钟变)。
- 不引入 Three.js / WebGL:当前场景是模块化等距微缩街区,SVG + DOM
  完全满足;若未来需要,需先证明 2D 无法满足。

## 11. 数据入口与 fixtures

- `web/src/fixtures/town-state/{stable,busy-tight,capital-export}.json`:
  三个**手工编写**的合成 Town State(README 说明其 band 为演示所设,非
  town-rules-v1 实跑结果);视觉开发不依赖真实账单。
- 真实数据路径:`life-energy town state --month YYYY-MM --json > state.txt`,
  页面「载入 Town State JSON」直接读取该文件(adapter 容错解析)。
  没有 backend API,Phase 1 不扩大范围。
- `artifacts/visual-qa/` 存放 Visual QA 截图(gitignore,不进源码目录)。

## 12. 测试

`web/tests/`(vitest,74 项):

- `visualProjection.test.ts` —— 任务书十项:确定性 / 同输入同输出(含三
  demo 回归)/ 金额不进入视觉状态(无 `_minor` 键、无数字叶子、金额 ×10
  不改变输出)/ VR-1..VR-7 逐档映射 / 数据可信与生活等级解耦 / 解释可追溯
  与版本;以及 adapter 契约测试(版本、整数分、band、CLI stdout 解析、
  不重算)。
- `sceneArchitecture.test.ts` —— 坐标公式、2:1 菱形、画家顺序、viewBox
  覆盖;注册表完备且每个资产有组件、资产名无分类词;场景 id 唯一、坐标合法、
  最小街区组成、anchor/可变地块、总序、无财务词汇;构建器拒绝重复 id /
  重叠 / 越界 / 非整数。
- `rendererBoundary.test.ts` —— 源码 import 扫描(render 只依赖 react/
  scene/visual;scene 自包含;visual 只读 adapter 类型;全前端无 SQLite/
  ledger 库/表名/Node 内建);props 类型只含 model + visual;
  `react-dom/server` 静态渲染三个 demo:资产集合一致、B 比 A 行人多但
  亮窗少、C 亮窗最多、只有 C 的 anchor 为 busy、B 无流动点、紧张色调不是
  红色警报、markup 无任何 fixture 金额、三态 markup 两两不同。

Python 172 项测试不受影响(未改 Python)。

## 13. 已知边界与 future scope

- 资产是统一比例的占位几何(SVG 盒体),不是最终美术;比例/材质/灯光/
  配色打磨属下一阶段。
- `residential_stability=NORMAL` 在 v1 不可达(见第 2 节);scene 的
  `trend_vs_previous_period` 在 v1 不参与视觉。
- fixtures 为手工合成,部分 explanation factor 标注 `(synthetic demo factor)`。
- 浏览器 file chooser 在本次 smoke 环境不可自动化,「载入 JSON」路径以
  adapter 单元测试覆盖。
- 未做(记录 future scope,不在本阶段扩展):最终 Dashboard、财务详情页、
  交易列表 UI、unresolved 工作台、完整导航、手机 App、Electron、Cloudflare、
  Otter Holdings 集成/CBD、真实资金同步、AI 分析 UI、天气/季节/昼夜、
  大量 NPC、车辆系统、高级动画、音效、Three.js。
