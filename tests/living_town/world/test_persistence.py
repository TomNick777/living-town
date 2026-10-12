"""FB-1 persistence: migration 0003, deterministic load, ledger isolation."""

from __future__ import annotations

import json
import sqlite3

import pytest

from life_energy.db.connection import open_db
from life_energy.db.migrations import discover_migrations, migrate
from life_energy.living_town.world import (
    SEED_REVISION,
    WorldStateError,
    ensure_world,
    load_world,
    load_contract,
)

FROZEN_SEED_IDS = {
    "5513ac64-2727-4f4f-9e9e-44441076de27",
    "0deb488a-6d16-4c95-b245-7ff945b77402",
    "45a22d48-57c5-4d02-95c3-517d1c36957c",
    "ea217128-8498-491b-b025-42e8653f387d",
}


def fresh_world_db(tmp_path):
    path = tmp_path / "world.db"
    with open_db(path) as conn:
        ensure_world(conn)
    return path


def test_migration_0003_is_rerunnable(tmp_path):
    path = tmp_path / "rerun.db"
    with open_db(path) as conn:
        migrate(conn)  # second full pass over all migrations must be a no-op
        assert conn.execute("SELECT COUNT(*) FROM town_world WHERE id = 1").fetchone()[0] == 1


def test_singleton_row_cannot_be_duplicated(tmp_path):
    with open_db(tmp_path / "guard.db") as conn:
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute(
                "INSERT INTO town_world (id, world_version, layout_version) VALUES (2, 'town-world-v1', 'living-town-block-v1')"
            )


def test_seeded_world_matches_contract(tmp_path):
    contract = load_contract()
    with open_db(fresh_world_db(tmp_path)) as conn:
        state = load_world(conn)
    assert state.world_version == "town-world-v1"
    assert state.layout_version == "living-town-block-v1"
    assert state.revision == SEED_REVISION
    assert {b.building_id for b in state.buildings} == {s.building_id for s in contract.seed_buildings}
    assert {b.building_id for b in state.buildings} == FROZEN_SEED_IDS
    for building in state.buildings:
        seed = next(s for s in contract.seed_buildings if s.building_id == building.building_id)
        assert (building.asset_id, building.grid_x, building.grid_y, building.orientation) == (
            seed.asset_id,
            seed.grid_x,
            seed.grid_y,
            seed.orientation,
        )
        assert building.lifecycle == "ACTIVE"
        assert building.provenance["source"] == "bootstrap-seed"
        assert building.provenance["legacy_object_id"] == seed.legacy_object_id
        # one bootstrap moment for the whole seed
        assert building.created_at is not None


def test_load_is_deterministic_sorted_by_building_id(tmp_path):
    with open_db(fresh_world_db(tmp_path)) as conn:
        first = load_world(conn).to_dict()
        second = load_world(conn).to_dict()
    assert first == second
    ids = [b["building_id"] for b in first["buildings"]]
    assert ids == sorted(ids)


def test_load_includes_demolished_history(tmp_path):
    victim = sorted(FROZEN_SEED_IDS)[0]
    with open_db(fresh_world_db(tmp_path)) as conn:
        conn.execute("UPDATE town_building SET lifecycle = 'DEMOLISHED' WHERE building_id = ?", (victim,))
        state = load_world(conn)
    assert len(state.buildings) == 4  # soft state: the row survives
    demolished = [b for b in state.buildings if b.lifecycle == "DEMOLISHED"]
    assert [b.building_id for b in demolished] == [victim]
    assert state.active_buildings() and len(state.active_buildings()) == 3


def test_load_fails_loud_on_unknown_world_version(tmp_path):
    with open_db(fresh_world_db(tmp_path)) as conn:
        conn.execute("UPDATE town_world SET world_version = 'town-world-v99' WHERE id = 1")
        with pytest.raises(WorldStateError, match="town-world-v99"):
            load_world(conn)


def test_load_fails_loud_on_layout_mismatch(tmp_path):
    with open_db(fresh_world_db(tmp_path)) as conn:
        conn.execute("UPDATE town_world SET layout_version = 'living-town-block-v0' WHERE id = 1")
        with pytest.raises(WorldStateError, match="layout_version"):
            load_world(conn)


def test_corrupt_provenance_fails_loud(tmp_path):
    with open_db(fresh_world_db(tmp_path)) as conn:
        conn.execute("UPDATE town_building SET provenance = '{not json'")
        with pytest.raises(WorldStateError, match="provenance"):
            load_world(conn)


def test_missing_singleton_row_fails_loud(tmp_path):
    path = tmp_path / "bare.db"
    with open_db(path) as conn:
        conn.execute("DROP TABLE town_building")
        conn.execute("DROP TABLE town_world")
        with pytest.raises(WorldStateError, match="town_world"):
            load_world(conn)
        with pytest.raises(WorldStateError, match="town_world"):
            ensure_world(conn)


def test_ensure_world_never_touches_a_populated_ledger(tmp_ledger):
    """World bootstrap must be invisible to the ledger layers (invariants 1..19)."""
    counts_before = {
        table: tmp_ledger.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        for table in ("transactions", "accounts", "transaction_interpretation", "transfer_pairs")
    }
    assert ensure_world(tmp_ledger) is True  # first touch seeds
    counts_after = {
        table: tmp_ledger.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        for table in counts_before
    }
    assert counts_after == counts_before
    # and the world tables are the only schema addition
    world_tables = {
        row["name"]
        for row in tmp_ledger.execute("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'town_%'")
    }
    assert world_tables == {"town_world", "town_building"}


def test_seed_provenance_is_wellformed_json(tmp_path):
    with open_db(fresh_world_db(tmp_path)) as conn:
        rows = conn.execute("SELECT building_id, provenance FROM town_building").fetchall()
    assert len(rows) == 4
    for row in rows:
        parsed = json.loads(row["provenance"])
        assert parsed["source"] == "bootstrap-seed"
        assert isinstance(parsed["legacy_object_id"], str)
