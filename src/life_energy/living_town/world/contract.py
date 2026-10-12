"""world_contract_v1 — 渲染器无关的世界数据契约（renderer-independent）。

FB-0（docs/living-town-functional-baseline.md §5/§16/§17/§19）：

- 本模块只做契约的**读取与校验**：纯数据 + 纯函数，零数据库、零运行时
  行为变更；规则逻辑（放置引擎/命令）属于 FB-2，不在这里。
- 契约是「世界空间规则与 bootstrap 数据」的版本化真源：
  bounds / orientation 词汇 / portable 资产定义（footprint、occupancy、
  placeable）/ 静态基座 solid 占用格 / seed 建筑（冻结 UUID）/ life scenes。
  它**不是** TownWorldState 实例数据——不描述「用户当前小镇」。
- 契约文件随 Python 包分发（pyproject package-data）；TS 运行时不读它
  （自带 registry/常量），一致性由双侧 parity 测试锁定（§17）。

禁止进入契约的内容（§16，由 FORBIDDEN_KEY_PATTERNS + 测试双锁）：
渲染器专属数据（screen 坐标、drawKey、viewBox、palette、像素尺寸、
shadow/stroke/facade、窗口配置……）与任何财务/消费分类映射
（amount、*_minor、transaction、category→scene）。
"""

from __future__ import annotations

import json
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping

CONTRACT_VERSION = "living-town-world-contract-v1"
LAYOUT_ID = "living-town-block-v1"

OCCUPANCY_SOLID = "solid"
OCCUPANCY_FLAT = "flat"

#: 世界契约认识的资产类别（与渲染 taxonomy 镜像；policy 是 placeable，
#: 类别只是让人工裁定可读——见契约内逐资产的 placeable 布尔）。
ASSET_CATEGORIES = (
    "building",
    "infrastructure",
    "furniture",
    "nature",
    "living",
    "special",
)

#: v1 朝向词汇（语义朝向，不改变 footprint 几何）。
ORIENTATIONS = ("N", "E", "S", "W", "NE", "NW", "SE", "SW")

#: 任何键（小写比较）命中这些子串即拒绝加载：渲染器专属 / 财务词汇。
#: 这是结构性 tripwire——未来加字段时引入这些词，加载即失败，不靠人眼。
FORBIDDEN_KEY_PATTERNS = (
    # renderer-specific
    "screen",
    "sx",
    "sy",
    "drawkey",
    "viewbox",
    "heightpx",
    "pixel",
    "palette",
    "token",
    "css",
    "svg",
    "shadow",
    "stroke",
    "facade",
    "painter",
    "viewport",
    "window",
    # financial / classification vocabulary
    "amount",
    "_minor",
    "transaction",
)

#: 精确键禁入（子串规则不便覆盖的）：grid_z 是「地面以上像素」，纯渲染
#: 概念（§1.2 DO NOT STORE）；消费分类映射禁止成为世界事实。
FORBIDDEN_KEY_EXACT = frozenset(
    {
        "z",
        "grid_z",
        "gridz",
        "category_to_scene",
        "category_mapping",
    }
)

_CONTRACT_PATH = Path(__file__).parent / "contracts" / "world_contract_v1.json"


class ContractError(ValueError):
    """契约文件违反 world_contract_v1 的 schema 或语义。"""


@dataclass(frozen=True)
class GridBounds:
    """含端点的整数格边界（世界网格空间，唯一权威位置空间）。"""

    min_x: int
    max_x: int
    min_y: int
    max_y: int

    def contains(self, x: int, y: int) -> bool:
        return self.min_x <= x <= self.max_x and self.min_y <= y <= self.max_y


def footprint_cells(grid_x: int, grid_y: int, width: int, height: int) -> list[tuple[int, int]]:
    """把锚定在北角 (grid_x, grid_y) 的 w×h footprint 展开成格子集合。

    最小纯几何函数：只服务契约校验；未来放置引擎（FB-2）可复用，
    本阶段不引入任何变更语义。
    """
    return [(grid_x + dx, grid_y + dy) for dy in range(height) for dx in range(width)]


@dataclass(frozen=True)
class AssetContract:
    """portable 资产定义：放置所需的全部世界属性，无任何绘制数据。"""

    asset_id: str
    category: str
    footprint_w: int
    footprint_h: int
    occupancy: str  # OCCUPANCY_SOLID | OCCUPANCY_FLAT
    placeable: bool

    def footprint_cells(self, grid_x: int, grid_y: int) -> list[tuple[int, int]]:
        return footprint_cells(grid_x, grid_y, self.footprint_w, self.footprint_h)


@dataclass(frozen=True)
class SeedBuildingContract:
    """bootstrap 种子建筑：当前四栋的冻结身份。

    building_id 是一次性生成后**冻结进契约**的永久 TEXT UUID：
    不含 asset、不含坐标、永不重新生成（§7）。legacy_object_id 记录
    它来自当前静态场景的哪个对象 id（legacy → UUID 的显式映射）。
    """

    building_id: str
    legacy_object_id: str
    asset_id: str
    grid_x: int
    grid_y: int
    orientation: str


@dataclass(frozen=True)
class WorldContractV1:
    """world_contract_v1 的已校验内存形态。"""

    contract_version: str
    layout_id: str
    bounds: GridBounds
    orientations: tuple[str, ...]
    assets: Mapping[str, AssetContract]
    placeable_categories: tuple[str, ...]
    static_solid_cells: tuple[tuple[int, int], ...]
    seed_buildings: tuple[SeedBuildingContract, ...]
    life_scenes: tuple[str, ...]

    @property
    def static_solid_cell_set(self) -> frozenset[tuple[int, int]]:
        return frozenset(self.static_solid_cells)

    @property
    def placeable_asset_ids(self) -> tuple[str, ...]:
        return tuple(asset_id for asset_id, a in self.assets.items() if a.placeable)

    def seed_cells(self) -> list[tuple[int, int]]:
        cells: list[tuple[int, int]] = []
        for seed in self.seed_buildings:
            cells.extend(self.assets[seed.asset_id].footprint_cells(seed.grid_x, seed.grid_y))
        return cells


def raw_contract() -> dict[str, Any]:
    """读取契约 JSON 原文（未校验）。"""
    return json.loads(_CONTRACT_PATH.read_text(encoding="utf-8"))


def load_contract() -> WorldContractV1:
    """读取并校验契约；任何违反即 ContractError（fail loud，不猜）。"""
    return validate_contract(raw_contract())


def _fail(errors: list[str], message: str) -> None:
    errors.append(message)


def _require_object(value: Any, where: str, errors: list[str], keys: frozenset[str]) -> bool:
    if not isinstance(value, Mapping):
        _fail(errors, f"{where} must be an object")
        return False
    unknown = sorted(set(value) - keys)
    missing = sorted(keys - set(value))
    if unknown:
        _fail(errors, f"{where} has unknown keys {unknown}")
    if missing:
        _fail(errors, f"{where} is missing keys {missing}")
    return not unknown and not missing


def _require_int(value: Any, where: str, errors: list[str]) -> bool:
    # JSON 里 true/false 是 bool；bool 是 int 子类，必须显式排除。
    if isinstance(value, bool) or not isinstance(value, int):
        _fail(errors, f"{where} must be an integer, got {value!r}")
        return False
    return True


def _require_str_list(value: Any, where: str, errors: list[str]) -> list[str] | None:
    if not isinstance(value, list) or not value or not all(isinstance(v, str) and v for v in value):
        _fail(errors, f"{where} must be a non-empty list of strings")
        return None
    if len(set(value)) != len(value):
        _fail(errors, f"{where} contains duplicates")
        return None
    return value


def _check_forbidden_keys(node: Any, where: str, errors: list[str]) -> None:
    """递归扫描所有对象键，命中渲染器/财务词汇即违约。"""
    if isinstance(node, Mapping):
        for key, value in node.items():
            key_str = str(key)
            lowered = key_str.lower()
            for pattern in FORBIDDEN_KEY_PATTERNS:
                if pattern in lowered:
                    _fail(errors, f"key {where}{key_str} contains forbidden renderer/financial term {pattern!r}")
            if key_str in FORBIDDEN_KEY_EXACT:
                _fail(errors, f"key {where}{key_str} is forbidden in the world contract")
            _check_forbidden_keys(value, f"{where}{key_str}.", errors)
    elif isinstance(node, list):
        for index, item in enumerate(node):
            _check_forbidden_keys(item, f"{where}[{index}].", errors)


def validate_contract(data: Mapping[str, Any]) -> WorldContractV1:
    """校验契约 dict 的 schema 与语义（§H 清单），全部违规一次性报出。"""
    if not isinstance(data, Mapping):
        raise ContractError("world contract root must be a JSON object")

    errors: list[str] = []
    _check_forbidden_keys(data, "", errors)

    top_keys = frozenset(
        {
            "contract_version",
            "layout",
            "orientations",
            "assets",
            "placeable_categories",
            "static_solid_cells",
            "seed_buildings",
            "life_scenes",
        }
    )
    if not _require_object(data, "contract", errors, top_keys):
        raise ContractError(_message(errors))

    # ---- version -----------------------------------------------------------
    if data["contract_version"] != CONTRACT_VERSION:
        _fail(errors, f"contract_version must be {CONTRACT_VERSION!r}, got {data['contract_version']!r}")

    # ---- layout / bounds ---------------------------------------------------
    bounds: GridBounds | None = None
    if _require_object(data["layout"], "layout", errors, frozenset({"id", "bounds"})):
        if data["layout"]["id"] != LAYOUT_ID:
            _fail(errors, f"layout.id must be {LAYOUT_ID!r}, got {data['layout']['id']!r}")
        raw_bounds = data["layout"]["bounds"]
        bounds_keys = frozenset({"min_x", "max_x", "min_y", "max_y"})
        if _require_object(raw_bounds, "layout.bounds", errors, bounds_keys):
            ints = {key: raw_bounds[key] for key in bounds_keys if _require_int(raw_bounds[key], f"layout.bounds.{key}", errors)}
            if len(ints) == 4:
                bounds = GridBounds(ints["min_x"], ints["max_x"], ints["min_y"], ints["max_y"])
                if bounds.min_x > bounds.max_x or bounds.min_y > bounds.max_y:
                    bounds = None
                    _fail(errors, "layout.bounds min must not exceed max")

    # ---- orientation vocabulary -------------------------------------------
    orientations_list = _require_str_list(data["orientations"], "orientations", errors)
    if orientations_list is not None and tuple(orientations_list) != ORIENTATIONS:
        _fail(errors, f"orientations must be {list(ORIENTATIONS)}, got {orientations_list}")
    orientations = tuple(orientations_list) if orientations_list is not None else ORIENTATIONS

    # ---- placeable policy --------------------------------------------------
    placeable_categories_list = _require_str_list(data["placeable_categories"], "placeable_categories", errors)
    if placeable_categories_list is not None:
        unknown_categories = sorted(set(placeable_categories_list) - set(ASSET_CATEGORIES))
        if unknown_categories:
            _fail(errors, f"placeable_categories contains unknown categories {unknown_categories}")
    placeable_categories = tuple(placeable_categories_list or ())

    # ---- portable assets ---------------------------------------------------
    assets: dict[str, AssetContract] = {}
    raw_assets = data["assets"]
    if not isinstance(raw_assets, Mapping) or not raw_assets:
        _fail(errors, "assets must be a non-empty object")
    else:
        for asset_id, raw_def in raw_assets.items():
            where = f"assets.{asset_id}"
            def_keys = frozenset({"category", "footprint", "occupancy", "placeable"})
            if not _require_object(raw_def, where, errors, def_keys):
                continue
            category = raw_def["category"]
            if category not in ASSET_CATEGORIES:
                _fail(errors, f"{where}.category {category!r} is not a known asset category")
            occupancy = raw_def["occupancy"]
            if occupancy not in (OCCUPANCY_SOLID, OCCUPANCY_FLAT):
                _fail(errors, f"{where}.occupancy must be 'solid' or 'flat', got {occupancy!r}")
            if not isinstance(raw_def["placeable"], bool):
                _fail(errors, f"{where}.placeable must be a boolean")
                continue
            raw_footprint = raw_def["footprint"]
            if not _require_object(raw_footprint, f"{where}.footprint", errors, frozenset({"w", "h"})):
                continue
            if not all(_require_int(raw_footprint[k], f"{where}.footprint.{k}", errors) for k in ("w", "h")):
                continue
            if raw_footprint["w"] < 1 or raw_footprint["h"] < 1:
                _fail(errors, f"{where}.footprint dimensions must be positive integers")
                continue
            expected_placeable = category in placeable_categories
            if raw_def["placeable"] != expected_placeable:
                _fail(errors, f"{where}.placeable={raw_def['placeable']} contradicts placeable_categories (expected {expected_placeable})")
            assets[str(asset_id)] = AssetContract(
                asset_id=str(asset_id),
                category=category,
                footprint_w=raw_footprint["w"],
                footprint_h=raw_footprint["h"],
                occupancy=occupancy,
                placeable=raw_def["placeable"],
            )

    # ---- static solid occupancy -------------------------------------------
    static_cells: list[tuple[int, int]] = []
    raw_cells = data["static_solid_cells"]
    if not isinstance(raw_cells, list) or not raw_cells:
        _fail(errors, "static_solid_cells must be a non-empty list of [x, y] pairs")
    else:
        seen: set[tuple[int, int]] = set()
        for index, cell in enumerate(raw_cells):
            where = f"static_solid_cells[{index}]"
            if not isinstance(cell, list) or len(cell) != 2 or not all(_require_int(v, where, errors) for v in cell):
                _fail(errors, f"{where} must be an [x, y] integer pair")
                continue
            x, y = int(cell[0]), int(cell[1])
            if (x, y) in seen:
                _fail(errors, f"{where} duplicates cell ({x}, {y})")
                continue
            seen.add((x, y))
            if bounds is not None and not bounds.contains(x, y):
                _fail(errors, f"{where} ({x}, {y}) is outside layout bounds")
                continue
            static_cells.append((x, y))

    # ---- seed buildings ----------------------------------------------------
    seeds: list[SeedBuildingContract] = []
    static_cell_set = frozenset(static_cells)
    raw_seeds = data["seed_buildings"]
    if not isinstance(raw_seeds, list) or not raw_seeds:
        _fail(errors, "seed_buildings must be a non-empty list")
    else:
        seen_ids: set[str] = set()
        seen_legacy: set[str] = set()
        occupied: dict[tuple[int, int], str] = {}
        for index, raw_seed in enumerate(raw_seeds):
            where = f"seed_buildings[{index}]"
            seed_keys = frozenset({"building_id", "legacy_object_id", "asset_id", "grid_x", "grid_y", "orientation"})
            if not _require_object(raw_seed, where, errors, seed_keys):
                continue
            building_id = raw_seed["building_id"]
            try:
                uuid.UUID(str(building_id))
            except ValueError:
                _fail(errors, f"{where}.building_id {building_id!r} is not a valid UUID")
            if not isinstance(building_id, str):
                _fail(errors, f"{where}.building_id must be a string")
                continue
            if building_id in seen_ids:
                _fail(errors, f"{where}.building_id {building_id!r} is duplicated")
            seen_ids.add(building_id)
            legacy = raw_seed["legacy_object_id"]
            if not isinstance(legacy, str) or not legacy:
                _fail(errors, f"{where}.legacy_object_id must be a non-empty string")
            elif legacy in seen_legacy:
                _fail(errors, f"{where}.legacy_object_id {legacy!r} is duplicated")
            else:
                seen_legacy.add(legacy)
            asset_id = raw_seed["asset_id"]
            asset = assets.get(asset_id)
            if asset is None:
                _fail(errors, f"{where}.asset_id {asset_id!r} is not defined in assets")
            elif not asset.placeable:
                _fail(errors, f"{where}.asset_id {asset_id!r} is not placeable")
            if not all(_require_int(raw_seed[k], f"{where}.{k}", errors) for k in ("grid_x", "grid_y")):
                continue
            orientation = raw_seed["orientation"]
            if orientation not in orientations:
                _fail(errors, f"{where}.orientation {orientation!r} is not in the orientation vocabulary")
            x, y = raw_seed["grid_x"], raw_seed["grid_y"]
            if asset is not None and bounds is not None:
                for cx, cy in asset.footprint_cells(x, y):
                    if not bounds.contains(cx, cy):
                        _fail(errors, f"{where} footprint leaves layout bounds at ({cx}, {cy})")
                    if (cx, cy) in static_cell_set:
                        _fail(errors, f"{where} footprint collides with static solid cell ({cx}, {cy})")
                    other = occupied.get((cx, cy))
                    if other is not None:
                        _fail(errors, f"{where} footprint collides with another seed at ({cx}, {cy})")
                    occupied[(cx, cy)] = str(building_id)
            seeds.append(
                SeedBuildingContract(
                    building_id=building_id,
                    legacy_object_id=legacy,
                    asset_id=asset_id,
                    grid_x=x,
                    grid_y=y,
                    orientation=orientation,
                )
            )

    # ---- life scenes -------------------------------------------------------
    life_scenes_list = _require_str_list(data["life_scenes"], "life_scenes", errors)
    life_scenes = tuple(life_scenes_list) if life_scenes_list is not None else ()

    if errors:
        raise ContractError(_message(errors))

    assert bounds is not None  # 任何 bounds 违规都已在上面进入 errors
    return WorldContractV1(
        contract_version=data["contract_version"],
        layout_id=LAYOUT_ID,
        bounds=bounds,
        orientations=orientations,
        assets=assets,
        placeable_categories=placeable_categories,
        static_solid_cells=tuple(static_cells),
        seed_buildings=tuple(seeds),
        life_scenes=life_scenes,
    )


def _message(errors: list[str]) -> str:
    return "world_contract_v1 invalid:\n- " + "\n- ".join(errors)
