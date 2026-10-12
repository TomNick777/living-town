"""Living Town world layer — 渲染器无关的世界契约（FB-0）与世界状态（FB-1）。

- world_contract_v1：世界空间规则与 bootstrap 数据的版本化真源（纯数据 +
  纯函数，无 DB）。
- models / bootstrap：TownWorldState 读模型 + 幂等 bootstrap / 确定性加载。
  世界层的唯一写面是 town_world / town_building 两张表，与账本零接触；
  命令与放置权威属于 FB-2。

契约 ≠ TownWorldState 实例数据：契约是「世界空间规则与 bootstrap 数据」，
不是「用户当前小镇」；TownWorldState（世界层读模型）与 TownState
（账单派生语义）是两个平行概念。
"""

from .bootstrap import (
    SEED_PROVENANCE_SOURCE,
    SEED_REVISION,
    WorldStateError,
    ensure_world,
    load_world,
)
from .contract import (
    ASSET_CATEGORIES,
    CONTRACT_VERSION,
    FORBIDDEN_KEY_EXACT,
    FORBIDDEN_KEY_PATTERNS,
    LAYOUT_ID,
    OCCUPANCY_FLAT,
    OCCUPANCY_SOLID,
    ORIENTATIONS,
    AssetContract,
    ContractError,
    GridBounds,
    SeedBuildingContract,
    WorldContractV1,
    footprint_cells,
    load_contract,
    raw_contract,
    validate_contract,
)
from .errors import (
    ALL_ERROR_CODES,
    ASSET_NOT_PLACEABLE,
    BUILDING_DEMOLISHED,
    BUILDING_NOT_FOUND,
    COLLISION,
    INVALID_COORDINATE,
    MALFORMED_COMMAND,
    OUT_OF_BOUNDS,
    UNKNOWN_ASSET,
    VERSION_CONFLICT,
    WorldCommandError,
)
from .models import (
    WORLD_VERSION,
    BuildingInstance,
    TownWorldState,
)
from .placement import ActiveFootprint, OK, PlacementVerdict, evaluate_placement
from . import service

__all__ = [
    "ASSET_CATEGORIES",
    "ASSET_NOT_PLACEABLE",
    "ALL_ERROR_CODES",
    "ActiveFootprint",
    "BUILDING_DEMOLISHED",
    "BUILDING_NOT_FOUND",
    "COLLISION",
    "CONTRACT_VERSION",
    "FORBIDDEN_KEY_EXACT",
    "FORBIDDEN_KEY_PATTERNS",
    "INVALID_COORDINATE",
    "LAYOUT_ID",
    "MALFORMED_COMMAND",
    "OCCUPANCY_FLAT",
    "OCCUPANCY_SOLID",
    "OK",
    "ORIENTATIONS",
    "OUT_OF_BOUNDS",
    "PlacementVerdict",
    "SEED_PROVENANCE_SOURCE",
    "SEED_REVISION",
    "UNKNOWN_ASSET",
    "VERSION_CONFLICT",
    "WORLD_VERSION",
    "AssetContract",
    "BuildingInstance",
    "ContractError",
    "GridBounds",
    "SeedBuildingContract",
    "TownWorldState",
    "WorldCommandError",
    "WorldContractV1",
    "WorldStateError",
    "ensure_world",
    "evaluate_placement",
    "footprint_cells",
    "load_contract",
    "load_world",
    "raw_contract",
    "service",
    "validate_contract",
]
