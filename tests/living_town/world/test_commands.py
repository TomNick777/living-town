"""FB-2 world domain service: the four commands, error codes, revision
semantics, provenance, and failure atomicity (zero side effects)."""

from __future__ import annotations

import json
import uuid

import pytest

from life_energy.db.connection import open_db
from life_energy.living_town.world.bootstrap import ensure_world
from life_energy.living_town.world.errors import (
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
from life_energy.living_town.world.service import (
    change_building_asset,
    create_building,
    demolish_building,
    move_building,
)

SEED_REVISION = 1
CAFE_ID = "45a22d48-57c5-4d02-95c3-517d1c36957c"
CONVENIENCE_ID = "ea217128-8498-491b-b025-42e8653f387d"


@pytest.fixture()
def world(tmp_path):
    with open_db(tmp_path / "world.db") as conn:
        ensure_world(conn)  # standard entry-gate state: seeded, revision 1
        yield conn


def _ids(state):
    return {b.building_id for b in state.buildings}


def _revision(conn):
    return conn.execute("SELECT revision FROM town_world WHERE id = 1").fetchone()["revision"]


# ------------------------------------------------------------------ create


def test_create_assigns_permanent_uuid_and_bumps_revision(world):
    state = create_building(
        world, asset_id="cafe", grid_x=5, grid_y=1, expected_revision=SEED_REVISION
    )
    new = [b for b in state.buildings if b.grid_x == 5 and b.grid_y == 1]
    assert len(new) == 1
    building = new[0]
    uuid.UUID(building.building_id)  # valid UUID
    assert building.building_id not in {CAFE_ID, CONVENIENCE_ID}
    assert building.lifecycle == "ACTIVE"
    assert building.provenance["via"] == "cli"
    assert building.provenance["command"] == {
        "type": "CreateBuilding",
        "asset_id": "cafe",
        "grid_x": 5,
        "grid_y": 1,
        "orientation": "S",
    }
    assert state.revision == SEED_REVISION + 1
    assert len(state.buildings) == 5


def test_create_rejects_every_invalid_placement(world):
    cases = [
        ({"asset_id": "cafe", "grid_x": 6, "grid_y": 0}, COLLISION),  # variable lot
        ({"asset_id": "residential_a", "grid_x": 15, "grid_y": 9}, OUT_OF_BOUNDS),
        ({"asset_id": "skyscraper", "grid_x": 5, "grid_y": 1}, UNKNOWN_ASSET),
        ({"asset_id": "tree", "grid_x": 5, "grid_y": 1}, ASSET_NOT_PLACEABLE),
        ({"asset_id": "cafe", "grid_x": 1.5, "grid_y": 1}, INVALID_COORDINATE),
        ({"asset_id": "cafe", "grid_x": 5, "grid_y": 1, "orientation": "UP"}, MALFORMED_COMMAND),
    ]
    for kwargs, expected_code in cases:
        with pytest.raises(WorldCommandError) as excinfo:
            create_building(world, expected_revision=SEED_REVISION, **kwargs)
        assert excinfo.value.code == expected_code


def test_create_version_conflict_carries_current_revision(world):
    with pytest.raises(WorldCommandError) as excinfo:
        create_building(world, asset_id="cafe", grid_x=5, grid_y=1, expected_revision=99)
    assert excinfo.value.code == VERSION_CONFLICT
    assert excinfo.value.detail["current_revision"] == SEED_REVISION


def test_failed_command_leaves_zero_side_effects(world):
    before_rows = world.execute("SELECT COUNT(*) FROM town_building").fetchone()[0]
    before_revision = _revision(world)
    with pytest.raises(WorldCommandError):
        create_building(world, asset_id="cafe", grid_x=6, grid_y=0, expected_revision=SEED_REVISION)  # lot collision
    with pytest.raises(WorldCommandError):
        create_building(world, asset_id="cafe", grid_x=5, grid_y=1, expected_revision=SEED_REVISION - 1)  # conflict
    assert world.execute("SELECT COUNT(*) FROM town_building").fetchone()[0] == before_rows
    assert _revision(world) == before_revision


# ------------------------------------------------------------------ move


def test_move_keeps_identity_and_created_at(world):
    before = next(b for b in create_building(
        world, asset_id="cafe", grid_x=5, grid_y=1, expected_revision=SEED_REVISION
    ).buildings if b.grid_x == 5)
    state = move_building(
        world, building_id=before.building_id, grid_x=0, grid_y=1,
        expected_revision=SEED_REVISION + 1,
    )
    moved = next(b for b in state.buildings if b.building_id == before.building_id)
    assert (moved.grid_x, moved.grid_y) == (0, 1)
    assert moved.asset_id == before.asset_id
    assert moved.created_at == before.created_at
    assert state.revision == SEED_REVISION + 2


def test_move_can_set_orientation(world):
    state = create_building(world, asset_id="cafe", grid_x=5, grid_y=1, expected_revision=SEED_REVISION)
    target = next(b for b in state.buildings if b.grid_x == 5)
    state = move_building(
        world, building_id=target.building_id, grid_x=0, grid_y=1,
        orientation="N", expected_revision=SEED_REVISION + 1,
    )
    assert next(b for b in state.buildings if b.building_id == target.building_id).orientation == "N"


def test_move_error_codes(world):
    state = create_building(world, asset_id="cafe", grid_x=5, grid_y=1, expected_revision=SEED_REVISION)
    target_id = next(b for b in state.buildings if b.grid_x == 5).building_id
    demolish_building(world, building_id=target_id, expected_revision=SEED_REVISION + 1)
    with pytest.raises(WorldCommandError) as not_found:
        move_building(world, building_id="00000000-0000-0000-0000-000000000000", grid_x=5, grid_y=1,
                      expected_revision=SEED_REVISION + 2)
    assert not_found.value.code == BUILDING_NOT_FOUND
    with pytest.raises(WorldCommandError) as demolished:
        move_building(world, building_id=target_id, grid_x=5, grid_y=1, expected_revision=SEED_REVISION + 2)
    assert demolished.value.code == BUILDING_DEMOLISHED
    with pytest.raises(WorldCommandError) as collision:
        # a live seed building moved onto the variable lot (static solid)
        move_building(world, building_id=CAFE_ID, grid_x=6, grid_y=0, expected_revision=SEED_REVISION + 2)
    assert collision.value.code == COLLISION


# ------------------------------------------------------------------ change asset


def test_change_asset_revalidates_new_footprint(world):
    state = change_building_asset(
        world, building_id=CAFE_ID, asset_id="convenience_store", expected_revision=SEED_REVISION
    )
    changed = next(b for b in state.buildings if b.building_id == CAFE_ID)
    assert changed.asset_id == "convenience_store"
    assert (changed.grid_x, changed.grid_y) == (11, 3)  # anchor unchanged
    assert changed.created_at is not None


def test_change_asset_collision_when_footprint_grows(world):
    # cafe (1x1) -> residential_a (2x2) at (11,3) reaches cell (11,4), a static solid
    with pytest.raises(WorldCommandError) as excinfo:
        change_building_asset(world, building_id=CAFE_ID, asset_id="residential_a", expected_revision=SEED_REVISION)
    assert excinfo.value.code == COLLISION
    assert _revision(world) == SEED_REVISION  # zero side effects


def test_change_asset_to_same_asset_is_legal(world):
    state = change_building_asset(world, building_id=CAFE_ID, asset_id="cafe", expected_revision=SEED_REVISION)
    assert state.revision == SEED_REVISION + 1  # still a world mutation


# ------------------------------------------------------------------ demolish


def test_demolish_is_soft_and_keeps_history(world):
    state = demolish_building(world, building_id=CONVENIENCE_ID, expected_revision=SEED_REVISION)
    demolished = next(b for b in state.buildings if b.building_id == CONVENIENCE_ID)
    assert demolished.lifecycle == "DEMOLISHED"
    assert len(state.buildings) == 4  # row kept
    assert len(state.active_buildings()) == 3
    assert _revision(world) == SEED_REVISION + 1


def test_repeat_demolish_is_a_loud_error(world):
    demolish_building(world, building_id=CONVENIENCE_ID, expected_revision=SEED_REVISION)
    with pytest.raises(WorldCommandError) as excinfo:
        demolish_building(world, building_id=CONVENIENCE_ID, expected_revision=SEED_REVISION + 1)
    assert excinfo.value.code == BUILDING_DEMOLISHED


def test_demolished_cells_are_free_for_a_new_building(world):
    demolish_building(world, building_id=CONVENIENCE_ID, expected_revision=SEED_REVISION)
    # residential_a at (9,3) overlaps two cells of the demolished convenience store
    state = create_building(
        world, asset_id="residential_a", grid_x=9, grid_y=3, expected_revision=SEED_REVISION + 1
    )
    fresh = [b for b in state.buildings if b.grid_x == 9 and b.grid_y == 3]
    assert len(fresh) == 1
    assert fresh[0].building_id != CONVENIENCE_ID  # new identity, old uuid retired
    assert fresh[0].lifecycle == "ACTIVE"


def test_full_revision_chain(world):
    state = create_building(world, asset_id="cafe", grid_x=3, grid_y=1, expected_revision=1)
    new_id = next(b.building_id for b in state.buildings if b.grid_x == 3)
    assert state.revision == 2
    state = move_building(world, building_id=new_id, grid_x=5, grid_y=1, expected_revision=2)
    assert state.revision == 3
    state = change_building_asset(world, building_id=new_id, asset_id="cafe", expected_revision=3)
    assert state.revision == 4
    state = demolish_building(world, building_id=new_id, expected_revision=4)
    assert state.revision == 5
    assert json.dumps(state.to_dict())  # final shape serializes


# ------------------------------------------------------------------ CLI


def _run(world_db, capsys, *argv):
    from life_energy.cli.main import main as cli_main

    code = cli_main(["--db", str(world_db), *argv])
    return code, capsys.readouterr()


def test_cli_build_cycle(tmp_path, capsys):
    db = tmp_path / "cli-world.db"
    code, out = _run(db, capsys, "town", "world", "show", "--json")
    assert code == 0
    revision = json.loads(out.out)["revision"]

    code, out = _run(db, capsys, "town", "building", "create", "--asset", "cafe", "--x", "5", "--y", "1",
                     "--revision", str(revision))
    assert code == 0
    assert "revision 2" in out.out
    code, out = _run(db, capsys, "town", "world", "show", "--json")
    world_json = json.loads(out.out)
    assert world_json["revision"] == 2
    assert len(world_json["buildings"]) == 5
    moved_id = next(b["building_id"] for b in world_json["buildings"] if b["grid_x"] == 5 and b["grid_y"] == 1)

    code, out = _run(db, capsys, "town", "building", "move", "--id", moved_id, "--x", "0", "--y", "1",
                     "--revision", "2")
    assert code == 0
    code, out = _run(db, capsys, "town", "building", "change-asset", "--id", moved_id, "--asset", "convenience_store",
                     "--revision", "3")
    assert code == 0
    code, out = _run(db, capsys, "town", "building", "demolish", "--id", moved_id, "--revision", "4")
    assert code == 0
    code, out = _run(db, capsys, "town", "world", "show", "--json")
    world_json = json.loads(out.out)
    assert world_json["revision"] == 5
    target = next(b for b in world_json["buildings"] if b["building_id"] == moved_id)
    assert target["lifecycle"] == "DEMOLISHED"


def test_cli_command_errors_exit_nonzero_with_stable_code(tmp_path, capsys):
    db = tmp_path / "cli-world-err.db"
    code, out = _run(db, capsys, "town", "building", "create", "--asset", "cafe", "--x", "6", "--y", "0",
                     "--revision", "1")  # variable lot
    assert code == 1
    assert "error: COLLISION" in out.err
    code, out = _run(db, capsys, "town", "building", "create", "--asset", "cafe", "--x", "5", "--y", "1",
                     "--revision", "7")
    assert code == 1
    assert "error: VERSION_CONFLICT" in out.err
    code, out = _run(db, capsys, "town", "building", "demolish", "--id", "no-such-id", "--revision", "1")
    assert code == 1
    assert "error: BUILDING_NOT_FOUND" in out.err
