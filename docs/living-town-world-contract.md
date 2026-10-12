# Living Town — World Contract v1

- 状态:**已实现(FB-0)**。本文描述 `world_contract_v1` 的内容、边界与验证方式。
- 日期:2026-09-10。
- 上游设计:`docs/living-town-functional-baseline.md`(§5/§16/§17)。
- 契约文件(唯一真源):
  `src/life_energy/living_town/world/contracts/world_contract_v1.json`
- 读取与校验(Python):`src/life_energy/living_town/world/contract.py`

---

## 1. 契约是什么、不是什么

**world_contract_v1 是「世界空间规则与 bootstrap 数据契约」**——它描述
世界网格的规则数据(边界、朝向词汇、资产 footprint/占用语义/可放置性、
静态基座 solid 占用、种子建筑、生活场景词汇),供未来的放置权威
(Python,FB-2)与任意 renderer 消费。

三个概念必须分清:

| 概念 | 是什么 | 在哪里 |
|---|---|---|
| `TownState` | 账单**派生**的期间语义状态(可完全重算,零写入) | `living_town/` projection |
| `TownWorldState` | **用户创造的小镇事实**(建筑实例;FB-1 起持久化) | 未来 `town_world` / `town_building` 表 |
| `world_contract_v1` | 世界空间的**规则与 bootstrap 数据**(不是任何用户的当前小镇) | 本契约 JSON |

即:`world_contract_v1 ≠ TownWorldState instance data`;
`TownWorldState ≠ TownState`。世界层与账本层互不引用。

## 2. 契约内容

| 字段 | 内容 |
|---|---|
| `contract_version` | `"living-town-world-contract-v1"`(加载方拒绝不认识的版本) |
| `layout.id` | `"living-town-block-v1"`——坐标所属的静态基座布局 |
| `layout.bounds` | `x 0..15`,`y 0..9`(含端点,整数格) |
| `orientations` | `N E S W NE NW SE SW`(语义朝向,不改变 footprint 几何) |
| `assets` | 24 个 portable 资产定义(见 §3) |
| `placeable_categories` | `["building"]` |
| `static_solid_cells` | 38 个 `[x, y]` 格——静态基座全部 solid 占用的 cell union |
| `seed_buildings` | 4 栋 bootstrap 建筑(见 §4) |
| `life_scenes` | 11 个 canonical LifeScene id(Python/TS 共同词汇) |

## 3. Portable asset 定义(24 个)

每个资产只有放置所需的**世界属性**,没有任何绘制数据:

```json
{ "category": "building", "footprint": { "w": 2, "h": 2 },
  "occupancy": "solid", "placeable": true }
```

- `occupancy`:`solid`(阻挡 solid 放置)或 `flat`(地面瓦片,不阻挡,
  与现 SceneModel「furniture 可放 flat 之上」一致)。
- `placeable`:**逐资产显式布尔**,是人工裁定的世界 policy;类别字段只是
  让裁定可读。基线只有 4 栋建筑类可创建(`placeable_categories` 与逐资产
  布尔的一致性由校验强制)。renderer/ vegetation/living/variable_lot/
  external anchor 全部不可由用户创建。
- `heightPx` 等 renderer 专属数据**不入契约**;TS 资产注册表保留它,
  parity 测试锁定「注册表去 heightPx ≡ 契约 assets」。

## 4. Seed buildings(冻结身份)

当前四栋建筑是未来世界层的 bootstrap truth。`building_id` 是一次性生成、
**永久冻结**的 TEXT UUID:不含 asset、不含坐标、永不重新生成、
Python/TS 两侧读同一值。`legacy_object_id` 是它来自现静态场景的显式映射:

| legacy scene id | frozen building_id (UUID) | asset | grid (x, y) | orientation |
|---|---|---|---|---|
| `residential-a` | `5513ac64-2727-4f4f-9e9e-44441076de27` | `residential_a` | (1, 2) | S |
| `residential-b` | `0deb488a-6d16-4c95-b245-7ff945b77402` | `residential_b` | (4, 3) | S |
| `cafe` | `45a22d48-57c5-4d02-95c3-517d1c36957c` | `cafe` | (11, 3) | S |
| `convenience-store` | `ea217128-8498-491b-b025-42e8653f387d` | `convenience_store` | (9, 4) | S |

FB-0 阶段这四栋仍留在静态场景里(行为零变化);FB-1 起由契约 seed
装载进世界层,FB-3 起由组合层供给画面。

## 5. 静态基座 solid 占用(`static_solid_cells`)

当前场景中**四栋建筑以外**的全部 solid 对象 footprint 展开后的 cell
union(38 格;含 variable_lot 的 4 格与 external_connection_anchor 的
2 格——两者当前仍是 solid)。它与四栋 seed 的 11 格互不相交,并集精确
等于现场景 49 个 solid 格。

**这是 placement authority 所需的世界几何,不是 renderer 几何**:未来的
Python 放置引擎用它拒绝把楼盖在树/路灯/售货机/预留地块上。flat 格
(路/水/人行道)不进入也不阻挡,与现 SceneModel 单一规则一致。

## 6. 双真源的同步机制(§17)

- **契约 JSON 是 normative copy**(随 Python 包分发,pyproject
  package-data);Python `load_contract()` 是运行时权威读取点。
- TS 运行时**不读契约**(自带 `assets.ts` / `townState.ts` /
  `livingTownScene.ts` 镜像);一致性由双侧 parity 测试锁定:
  - Python:`tests/living_town/world/test_contract.py`——契约自洽、
    冻结 UUID、`rules.LIFE_SCENES ≡ contract.life_scenes`、禁入词拒绝;
  - TS:`web/tests/worldContract.test.ts`——`LIFE_SCENES ≡ contract`、
    注册表(去 heightPx)≡ contract assets、场景 solid 格 − 四栋
    footprint ≡ static_solid_cells、并集 ≡ 现场景全集、同一套校验。
- 不引入代码生成、不改构建链。任何一侧改动镜像而不改契约 = 测试红。

## 7. 禁入数据(结构性强制)

校验器递归扫描所有键,命中即拒绝加载(未来加字段也一样):

- **渲染器专属**:screen 坐标(sx/sy)、drawKey、viewBox、heightPx、
  任何像素尺寸、palette、render token、CSS、SVG、shadow、stroke、
  facade、viewport/窗口配置;
- **精确禁键**:`z` / `grid_z`(地面以上像素是纯渲染概念)、
  `category_to_scene` / `category_mapping`(消费分类映射不是世界事实);
- **财务词汇**:`amount`、`*_minor`、`transaction`。

测试同时锁定契约**文本**层面不含这些词(Python 与 TS 各一份负向套件)。

## 8. 增补方式

契约演进 = 升 `contract_version`(如资产词汇扩展、基座扩建升
`layout.id`)。FB-1..FB-3 只消费本契约,不修改它;修改契约必须同时过
两侧 parity 测试。
