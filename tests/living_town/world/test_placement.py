"""FB-2 placement authority: pure evaluation + golden parity fixtures.

The same fixture file (contracts/placement_golden_v1.json) is executed by the
TS side (web/tests/placementParity.test.ts) against the TS rules mirror; the
two implementations must reach identical verdicts for every case.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from life_energy.living_town.world.contract import load_contract
from life_energy.living_town.world.placement import (
    OK,
    ActiveFootprint,
    evaluate_placement,
)

GOLDEN_PATH = (
    Path(__file__).resolve().parents[3]
    / "src"
    / "life_energy"
    / "living_town"
    / "world"
    / "contracts"
    / "placement_golden_v1.json"
)


def golden_cases():
    return json.loads(GOLDEN_PATH.read_text(encoding="utf-8"))["cases"]


def _footprints(contract, buildings):
    return [
        ActiveFootprint.from_contract(
            b["building_id"],
            contract.assets[b["asset_id"]].footprint_w,
            contract.assets[b["asset_id"]].footprint_h,
            b["grid_x"],
            b["grid_y"],
        )
        for b in buildings
    ]


@pytest.mark.parametrize("case", golden_cases(), ids=lambda c: c["name"])
def test_golden_case(case):
    contract = load_contract()
    verdict = evaluate_placement(
        contract,
        case["candidate"]["asset_id"],
        case["candidate"]["grid_x"],
        case["candidate"]["grid_y"],
        active_footprints=_footprints(contract, case.get("active_buildings", [])),
        exclude_building_id=case.get("exclude_building_id"),
    )
    assert verdict.code == case["expected"], verdict.detail
    assert verdict.ok == (case["expected"] == OK)
    if verdict.ok:
        assert verdict.cells  # accepted placements report their cells


def test_every_golden_case_name_is_unique():
    names = [c["name"] for c in golden_cases()]
    assert len(names) == len(set(names))
    assert len(names) >= 10  # the corpus must stay broad enough to matter


def test_ok_verdict_reports_expanded_cells():
    contract = load_contract()
    verdict = evaluate_placement(contract, "residential_a", 12, 7)
    assert verdict.ok
    assert sorted(map(tuple, verdict.cells)) == [(12, 7), (12, 8), (13, 7), (13, 8)]


def test_collision_names_the_source():
    contract = load_contract()
    static = evaluate_placement(contract, "cafe", 6, 0)
    assert static.detail["source"] == "static"
    building = evaluate_placement(
        contract,
        "cafe",
        4,
        3,
        active_footprints=[ActiveFootprint.from_contract("b", 2, 2, 4, 3)],
    )
    assert building.detail["source"] == ["b"]


def test_demolished_buildings_never_block():
    """The evaluator only receives ACTIVE footprints — this test pins that the
    service-side helper skips non-active rows."""
    from life_energy.living_town.world.models import BuildingInstance
    from life_energy.living_town.world.placement import active_footprints_from_state

    contract = load_contract()
    ghost = BuildingInstance(
        building_id="ghost",
        asset_id="residential_b",
        grid_x=4,
        grid_y=3,
        orientation="S",
        lifecycle="DEMOLISHED",
    )
    assert active_footprints_from_state(contract, [ghost]) == []
