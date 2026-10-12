"""world_contract_v1 — 契约校验与 Python 侧 parity（FB-0）。

边界（docs/living-town-functional-baseline.md §19-FB-0）：

- 零数据库、零运行时行为变更——只验证契约数据本身与 Python 镜像词汇；
- 「当前场景 → 静态基座 + seed 无损切分」的 TS 侧 parity 由
  web/tests/worldContract.test.ts 用真实 LIVING_TOWN_SCENE 对账；
  本文件锁定契约的自洽性、seed 冻结身份、LIFE_SCENES 镜像、以及
  渲染器专属/财务词汇的结构性禁入。
"""

from __future__ import annotations

import json
import uuid

import pytest

from life_energy.living_town import rules
from life_energy.living_town.world import (
    CONTRACT_VERSION,
    LAYOUT_ID,
    ORIENTATIONS,
    ContractError,
    footprint_cells,
    load_contract,
    raw_contract,
    validate_contract,
)

# 冻结的 seed 身份（FB-0 一次性生成后写死；永不在运行时重新生成）。
EXPECTED_SEEDS = {
    "residential-a": ("5513ac64-2727-4f4f-9e9e-44441076de27", "residential_a", 1, 2),
    "residential-b": ("0deb488a-6d16-4c95-b245-7ff945b77402", "residential_b", 4, 3),
    "cafe": ("45a22d48-57c5-4d02-95c3-517d1c36957c", "cafe", 11, 3),
    "convenience-store": ("ea217128-8498-491b-b025-42e8653f387d", "convenience_store", 9, 4),
}

EXPECTED_ASSET_IDS = frozenset(
    {
        "residential_a", "residential_b", "convenience_store", "cafe",
        "road_straight", "road_corner", "sidewalk", "crosswalk", "bridge", "water", "green_patch",
        "street_light", "bench", "vending_machine", "bicycle_rack", "bus_stop",
        "tree", "shrub", "planter",
        "pedestrian", "bicycle", "car",
        "external_connection_anchor", "variable_lot",
    }
)

FLAT_ASSET_IDS = frozenset(
    {"road_straight", "road_corner", "sidewalk", "crosswalk", "bridge", "water", "green_patch"}
)

# 非 1x1 的 footprint 全部显式列出，防止静默漂移。
EXPECTED_FOOTPRINTS = {
    "residential_a": (2, 2),
    "residential_b": (2, 2),
    "convenience_store": (2, 1),
    "bridge": (2, 1),
    "external_connection_anchor": (2, 1),
    "variable_lot": (2, 2),
}

VARIABLE_LOT_CELLS = {(6, 0), (7, 0), (6, 1), (7, 1)}
ANCHOR_CELLS = {(14, 6), (15, 6)}


@pytest.fixture(scope="module")
def contract():
    return load_contract()


# ---------------------------------------------------------------- schema / version


def test_contract_loads_with_frozen_version_and_layout(contract):
    assert contract.contract_version == CONTRACT_VERSION == "living-town-world-contract-v1"
    assert contract.layout_id == LAYOUT_ID == "living-town-block-v1"


def test_layout_bounds_match_current_block(contract):
    assert (contract.bounds.min_x, contract.bounds.max_x) == (0, 15)
    assert (contract.bounds.min_y, contract.bounds.max_y) == (0, 9)
    assert contract.bounds.contains(0, 0)
    assert contract.bounds.contains(15, 9)
    assert not contract.bounds.contains(16, 9)
    assert not contract.bounds.contains(15, 10)


def test_orientation_vocabulary(contract):
    assert contract.orientations == ORIENTATIONS == ("N", "E", "S", "W", "NE", "NW", "SE", "SW")


def test_unknown_contract_version_rejected():
    data = raw_contract()
    data["contract_version"] = "living-town-world-contract-v2"
    with pytest.raises(ContractError, match="contract_version"):
        validate_contract(data)


def test_unknown_top_level_key_rejected():
    data = raw_contract()
    data["renderer"] = {"anything": 1}
    with pytest.raises(ContractError, match="unknown keys"):
        validate_contract(data)


def test_missing_top_level_key_rejected():
    data = raw_contract()
    del data["life_scenes"]
    with pytest.raises(ContractError, match="missing keys"):
        validate_contract(data)


# ---------------------------------------------------------------- portable assets


def test_asset_registry_parity(contract):
    assert set(contract.assets) == EXPECTED_ASSET_IDS
    for asset_id, (w, h) in EXPECTED_FOOTPRINTS.items():
        assert (contract.assets[asset_id].footprint_w, contract.assets[asset_id].footprint_h) == (w, h), asset_id
    for asset_id, asset in contract.assets.items():
        if asset_id not in EXPECTED_FOOTPRINTS:
            assert (asset.footprint_w, asset.footprint_h) == (1, 1), asset_id


def test_flat_assets_are_exactly_the_ground_tiles(contract):
    flat = {asset_id for asset_id, a in contract.assets.items() if a.occupancy == "flat"}
    assert flat == FLAT_ASSET_IDS
    assert all(a.occupancy == "solid" for asset_id, a in contract.assets.items() if asset_id not in FLAT_ASSET_IDS)


def test_placeable_policy_is_explicit_and_consistent(contract):
    # 基线只有真正建筑类可创建；policy 显式逐资产写进契约，不靠 renderer 类别推断。
    assert contract.placeable_categories == ("building",)
    assert contract.placeable_asset_ids == ("residential_a", "residential_b", "convenience_store", "cafe")
    for asset in contract.assets.values():
        assert isinstance(asset.placeable, bool)
        assert asset.placeable == (asset.category in contract.placeable_categories)


def test_negative_or_zero_footprint_rejected():
    data = raw_contract()
    data["assets"]["tree"]["footprint"]["w"] = 0
    with pytest.raises(ContractError, match="positive"):
        validate_contract(data)


def test_invalid_occupancy_rejected():
    data = raw_contract()
    data["assets"]["bench"]["occupancy"] = "floating"
    with pytest.raises(ContractError, match="occupancy"):
        validate_contract(data)


def test_placeable_placeable_categories_contradiction_rejected():
    data = raw_contract()
    data["assets"]["tree"]["placeable"] = True
    with pytest.raises(ContractError, match="placeable"):
        validate_contract(data)


# ---------------------------------------------------------------- static solid occupancy


def test_static_solid_cells_canonical_and_in_bounds(contract):
    cells = contract.static_solid_cells
    assert len(cells) == 38
    assert len(set(cells)) == len(cells), "static solid cells must be unique"
    assert list(cells) == sorted(cells), "canonical serialization is (x, y)-sorted"
    for x, y in cells:
        assert contract.bounds.contains(x, y), (x, y)


def test_variable_lot_and_anchor_cells_are_static_solids(contract):
    # variable_lot 当前仍是 solid、external anchor 也是——它们的格子必须
    # 属于静态占用，未来放置权威据此拒绝在其上建房。
    cells = contract.static_solid_cell_set
    assert VARIABLE_LOT_CELLS <= cells
    assert ANCHOR_CELLS <= cells


def test_seed_cells_are_disjoint_from_static_cells(contract):
    seed_cells = contract.seed_cells()
    assert len(seed_cells) == 11
    assert len(set(seed_cells)) == len(seed_cells)
    assert contract.static_solid_cell_set.isdisjoint(seed_cells)


def test_duplicate_static_cell_rejected():
    data = raw_contract()
    data["static_solid_cells"].append([0, 0])
    with pytest.raises(ContractError, match="duplicates"):
        validate_contract(data)


def test_out_of_bounds_static_cell_rejected():
    data = raw_contract()
    data["static_solid_cells"].append([16, 0])
    with pytest.raises(ContractError, match="outside layout bounds"):
        validate_contract(data)


def test_non_integer_static_cell_rejected():
    data = raw_contract()
    data["static_solid_cells"][0] = [0.5, 0]
    with pytest.raises(ContractError, match="integer"):
        validate_contract(data)


# ---------------------------------------------------------------- seed buildings


def test_seed_building_identity_is_frozen(contract):
    by_legacy = {seed.legacy_object_id: seed for seed in contract.seed_buildings}
    assert set(by_legacy) == set(EXPECTED_SEEDS)
    for legacy, (building_id, asset_id, grid_x, grid_y) in EXPECTED_SEEDS.items():
        seed = by_legacy[legacy]
        assert seed.building_id == building_id          # 冻结 UUID，静默变化即红
        uuid.UUID(seed.building_id)                     # 必须是合法 UUID 文本
        assert (seed.asset_id, seed.grid_x, seed.grid_y, seed.orientation) == (asset_id, grid_x, grid_y, "S")


def test_seed_building_ids_are_unique_uuids(contract):
    ids = [seed.building_id for seed in contract.seed_buildings]
    assert len(ids) == len(set(ids)) == 4
    for building_id in ids:
        assert str(uuid.UUID(building_id)) == building_id


def test_seed_footprints_inside_bounds(contract):
    for seed in contract.seed_buildings:
        for x, y in contract.assets[seed.asset_id].footprint_cells(seed.grid_x, seed.grid_y):
            assert contract.bounds.contains(x, y), (seed.legacy_object_id, x, y)


def test_seed_moved_out_of_bounds_rejected():
    data = raw_contract()
    data["seed_buildings"][2]["grid_x"] = 16  # cafe
    with pytest.raises(ContractError, match="leaves layout bounds"):
        validate_contract(data)


def test_seed_colliding_with_static_solid_rejected():
    data = raw_contract()
    data["seed_buildings"][0]["grid_x"], data["seed_buildings"][0]["grid_y"] = 0, 0  # 压到树 (0,0)
    with pytest.raises(ContractError, match="static solid"):
        validate_contract(data)


def test_seed_colliding_with_seed_rejected():
    data = raw_contract()
    data["seed_buildings"][2]["grid_x"], data["seed_buildings"][2]["grid_y"] = 4, 3  # cafe 压到 residential-b
    with pytest.raises(ContractError, match="another seed"):
        validate_contract(data)


def test_seed_with_unknown_asset_rejected():
    data = raw_contract()
    data["seed_buildings"][2]["asset_id"] = "castle"
    with pytest.raises(ContractError, match="not defined in assets"):
        validate_contract(data)


def test_seed_with_non_placeable_asset_rejected():
    data = raw_contract()
    data["seed_buildings"][2]["asset_id"] = "tree"  # 存在但 placeable=false
    with pytest.raises(ContractError, match="not placeable"):
        validate_contract(data)


def test_seed_with_duplicate_uuid_rejected():
    data = raw_contract()
    data["seed_buildings"][3]["building_id"] = data["seed_buildings"][0]["building_id"]
    with pytest.raises(ContractError, match="duplicated"):
        validate_contract(data)


def test_seed_with_non_uuid_id_rejected():
    data = raw_contract()
    data["seed_buildings"][0]["building_id"] = "residential-a"
    with pytest.raises(ContractError, match="not a valid UUID"):
        validate_contract(data)


def test_seed_with_unknown_orientation_rejected():
    data = raw_contract()
    data["seed_buildings"][0]["orientation"] = "UP"
    with pytest.raises(ContractError, match="orientation"):
        validate_contract(data)


# ---------------------------------------------------------------- LIFE_SCENES parity


def test_life_scenes_match_python_rules(contract):
    assert contract.life_scenes == tuple(rules.LIFE_SCENES)
    assert len(contract.life_scenes) == 11


# ---------------------------------------------------------------- renderer / finance ban


RENDERER_TERMS = [
    "screen", "screenx", "screeny", "drawkey", "viewbox", "heightpx", "pixel",
    "palette", "token", "css", "svg", "shadow", "stroke", "facade", "window",
]


def test_contract_text_contains_no_renderer_data():
    text = json.dumps(raw_contract()).lower()
    for term in RENDERER_TERMS:
        assert term not in text, term


def test_contract_text_contains_no_financial_or_category_mapping_data():
    text = json.dumps(raw_contract()).lower()
    for term in ("amount", "_minor", "transaction_id", "category_to_scene", "category_mapping"):
        assert term not in text, term
    # 消费分类词汇不得借道进入（scene id 本身是合法契约内容）。
    for category in ("food", "housing", "telecom", "entertainment", "services", "education", "other_expense", "shopping"):
        assert f'"{category}"' not in text, category


@pytest.mark.parametrize(
    "key,value",
    [
        ("screenX", 100),
        ("drawKey", "residential_a-1-2"),
        ("viewBox", "0 0 100 100"),
        ("palette", {"building": "#fff"}),
        ("render_token", "window-lit"),
        ("amount_minor", 100),
        ("transaction_id", "T-1"),
        ("grid_z", 0),
        ("category_to_scene", {"FOOD": "DINING_SOCIAL"}),
    ],
)
def test_forbidden_keys_are_structurally_rejected(key, value):
    data = raw_contract()
    data["assets"]["residential_a"][key] = value
    with pytest.raises(ContractError):
        validate_contract(data)


# ---------------------------------------------------------------- pure geometry helper


def test_footprint_cells_expands_from_north_corner():
    assert footprint_cells(1, 2, 2, 2) == [(1, 2), (2, 2), (1, 3), (2, 3)]
    assert footprint_cells(9, 4, 2, 1) == [(9, 4), (10, 4)]
    assert footprint_cells(11, 3, 1, 1) == [(11, 3)]
