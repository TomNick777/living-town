"""Full Functional QA drill (Phase J) — the whole baseline lifecycle in one
deterministic sequence against a FRESH database, exercising the CLI as a
user would (every CLI call is a fresh process → restart semantics included).

Covers drill items J1 (fresh world), J3 (create), J4 (move), J5 (change
asset), J6 (demolish), J7 (no reseed after demolishing everything), J8
(collision/bounds rejections), J9 (optimistic-concurrency conflict).
J2 (restart identity) is implicit: every step below is a separate CLI
invocation against the same file. UI smoke (J10/J11) and the evidence
incremental drill (J12) run separately.
"""

from __future__ import annotations

import json

from life_energy.cli.main import main as cli_main
from life_energy.living_town.world import (
    BUILDING_DEMOLISHED,
    COLLISION,
    INVALID_COORDINATE,
    OUT_OF_BOUNDS,
    UNKNOWN_ASSET,
)

FROZEN = {
    "residential-a": "5513ac64-2727-4f4f-9e9e-44441076de27",
    "residential-b": "0deb488a-6d16-4c95-b245-7ff945b77402",
    "cafe": "45a22d48-57c5-4d02-95c3-517d1c36957c",
    "convenience-store": "ea217128-8498-491b-b025-42e8653f387d",
}


def run(tmp_path, capsys, *argv) -> tuple[int, str, str]:
    code = cli_main(["--db", str(tmp_path / "qa.db"), *argv])
    captured = capsys.readouterr()
    return code, captured.out, captured.err


def world_json(tmp_path, capsys) -> dict:
    code, out, _ = run(tmp_path, capsys, "town", "world", "show", "--json")
    assert code == 0
    return json.loads(out)


def test_functional_baseline_drill(tmp_path, capsys):
    # ---- J1: fresh DB 0001→0002→0003, ensure_world seeds the frozen four ----
    state = world_json(tmp_path, capsys)
    assert state["revision"] == 1
    assert {b["building_id"] for b in state["buildings"]} == set(FROZEN.values())
    assert all(b["lifecycle"] == "ACTIVE" for b in state["buildings"])

    # ---- J8: every placement rejection reason ----
    # static tree at (0,0), variable lot at (6,0), external anchor at (14,6)
    for x, y in ((0, 0), (6, 0), (14, 6)):
        code, _, err = run(tmp_path, capsys, "town", "building", "create", "--asset", "cafe",
                           "--x", str(x), "--y", str(y), "--revision", "1")
        assert code == 1 and "error: COLLISION" in err, (x, y, err)
    code, _, err = run(tmp_path, capsys, "town", "building", "create", "--asset", "residential_a",
                       "--x", "15", "--y", "9", "--revision", "1")
    assert code == 1 and "error: OUT_OF_BOUNDS" in err
    code, _, err = run(tmp_path, capsys, "town", "building", "create", "--asset", "tree",
                       "--x", "5", "--y", "1", "--revision", "1")
    assert code == 1 and "error: ASSET_NOT_PLACEABLE" in err
    code, _, err = run(tmp_path, capsys, "town", "building", "create", "--asset", "skyscraper",
                       "--x", "5", "--y", "1", "--revision", "1")
    assert code == 1 and "error: UNKNOWN_ASSET" in err
    code, _, err = run(tmp_path, capsys, "town", "building", "create", "--asset", "cafe",
                       "--x", "5", "--y", "1", "--revision", "999")
    assert code == 1 and "error: VERSION_CONFLICT" in err
    assert world_json(tmp_path, capsys)["revision"] == 1  # J8: zero side effects

    # ---- J3: create the fifth building ----
    code, out, _ = run(tmp_path, capsys, "town", "building", "create", "--asset", "cafe",
                       "--x", "5", "--y", "1", "--revision", "1")
    assert code == 0 and "revision 2" in out
    fifth_id = world_json(tmp_path, capsys)["buildings"]
    fifth_id = next(b["building_id"] for b in fifth_id if b["grid_x"] == 5 and b["grid_y"] == 1)

    # ---- J9: two clients on the same revision — one wins, one conflicts ----
    code, _, err = run(tmp_path, capsys, "town", "building", "create", "--asset", "convenience_store",
                       "--x", "12", "--y", "7", "--revision", "1")
    assert code == 1 and "error: VERSION_CONFLICT" in err
    code, out, _ = run(tmp_path, capsys, "town", "building", "create", "--asset", "convenience_store",
                       "--x", "12", "--y", "7", "--revision", "2")
    assert code == 0 and "revision 3" in out

    # ---- J4: move the fifth building; identity unchanged, position new ----
    code, _, _ = run(tmp_path, capsys, "town", "building", "move", "--id", fifth_id,
                     "--x", "0", "--y", "1", "--revision", "3")
    assert code == 0
    buildings = world_json(tmp_path, capsys)["buildings"]
    moved = next(b for b in buildings if b["building_id"] == fifth_id)
    assert (moved["grid_x"], moved["grid_y"]) == (0, 1)

    # ---- J5: change asset on a tight spot collides; on free space it works ----
    code, _, err = run(tmp_path, capsys, "town", "building", "change-asset", "--id", fifth_id,
                       "--asset", "residential_a", "--revision", "4")
    assert code == 1 and "error: COLLISION" in err  # 2x2 at (0,1) reaches (0,2) — static
    code, out, _ = run(tmp_path, capsys, "town", "building", "change-asset", "--id", fifth_id,
                       "--asset", "convenience_store", "--revision", "4")
    assert code == 0
    moved = next(b for b in world_json(tmp_path, capsys)["buildings"] if b["building_id"] == fifth_id)
    assert moved["asset_id"] == "convenience_store" and moved["building_id"] == fifth_id

    # ---- J6: demolish; row stays, never resurrects ----
    code, _, _ = run(tmp_path, capsys, "town", "building", "demolish", "--id", fifth_id, "--revision", "5")
    assert code == 0
    code, _, err = run(tmp_path, capsys, "town", "building", "demolish", "--id", fifth_id, "--revision", "6")
    assert code == 1 and "error: BUILDING_DEMOLISHED" in err
    state = world_json(tmp_path, capsys)
    demolished = next(b for b in state["buildings"] if b["building_id"] == fifth_id)
    assert demolished["lifecycle"] == "DEMOLISHED"
    assert len(state["buildings"]) == 6 and state["revision"] == 6  # 4 seeds + 2 created, none deleted

    # ---- J7: demolish everything; ensure_world must NOT reseed ----
    for building_id in [b["building_id"] for b in state["buildings"] if b["lifecycle"] == "ACTIVE"]:
        revision = world_json(tmp_path, capsys)["revision"]
        code, _, _ = run(tmp_path, capsys, "town", "building", "demolish", "--id", building_id,
                         "--revision", str(revision))
        assert code == 0
    state = world_json(tmp_path, capsys)
    assert all(b["lifecycle"] == "DEMOLISHED" for b in state["buildings"])
    assert len(state["buildings"]) == 6  # history preserved
    # one more entry point (a "restart"): still no resurrection, revision stable
    assert world_json(tmp_path, capsys) == state

    # ---- J2/J6: after all that, the frozen identities still exist (not reused) ----
    assert set(FROZEN.values()) <= {b["building_id"] for b in state["buildings"]}


def test_drill_rejects_malformed_cli_shape(tmp_path, capsys):
    import pytest

    from life_energy.cli.main import build_parser

    with pytest.raises(SystemExit):
        build_parser().parse_args(["--db", str(tmp_path / "x.db"), "town", "building", "create",
                                   "--asset", "cafe", "--x", "abc", "--y", "1", "--revision", "1"])
