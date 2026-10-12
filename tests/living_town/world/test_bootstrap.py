"""FB-1 bootstrap semantics: seed exactly once, never resurrect, CLI surface."""

from __future__ import annotations

import json
import sqlite3
import threading

from life_energy.cli.main import main as cli_main
from life_energy.db.connection import connect, open_db
from life_energy.living_town.world import SEED_REVISION, ensure_world, load_world, load_contract

FROZEN_SEED_IDS = {
    "5513ac64-2727-4f4f-9e9e-44441076de27",  # residential-a
    "0deb488a-6d16-4c95-b245-7ff945b77402",  # residential-b
    "45a22d48-57c5-4d02-95c3-517d1c36957c",  # cafe
    "ea217128-8498-491b-b025-42e8653f387d",  # convenience-store
}


def _open_fresh(path):
    with open_db(path) as conn:
        ensure_world(conn)


def test_seed_exactly_once_across_restarts(tmp_path):
    path = tmp_path / "once.db"
    _open_fresh(path)
    with open_db(path) as conn:
        first = conn.execute("SELECT revision, seeded_at FROM town_world WHERE id = 1").fetchone()
        assert first["revision"] == SEED_REVISION
        ensure_world(conn)  # second entry must be a no-op
        second = conn.execute("SELECT revision, seeded_at FROM town_world WHERE id = 1").fetchone()
    assert (first["revision"], first["seeded_at"]) == (second["revision"], second["seeded_at"])
    with open_db(path) as conn:
        assert conn.execute("SELECT COUNT(*) FROM town_building").fetchone()[0] == 4


def test_no_reseed_after_total_demolition(tmp_path):
    """The seed keys on seeded_at, never on building count: a user who
    demolishes everything must never see the seed resurrect (§7)."""
    path = tmp_path / "ghost-town.db"
    _open_fresh(path)
    with open_db(path) as conn:
        conn.execute("UPDATE town_building SET lifecycle = 'DEMOLISHED'")
        before = conn.execute("SELECT revision, seeded_at FROM town_world WHERE id = 1").fetchone()
        assert ensure_world(conn) is False
        after = conn.execute("SELECT revision, seeded_at FROM town_world WHERE id = 1").fetchone()
        rows = conn.execute("SELECT building_id, lifecycle FROM town_building").fetchall()
    assert (before["revision"], before["seeded_at"]) == (after["revision"], after["seeded_at"])
    assert len(rows) == 4 and all(r["lifecycle"] == "DEMOLISHED" for r in rows)


def test_no_reseed_even_after_manual_table_wipe(tmp_path):
    """Worst case (handwritten repair wiped the table): seeded_at stays set,
    so bootstrap still refuses to resurrect the seed."""
    path = tmp_path / "wiped.db"
    _open_fresh(path)
    with open_db(path) as conn:
        conn.execute("DELETE FROM town_building")  # manual repair, not a domain operation
        conn.commit()
        assert ensure_world(conn) is False
        assert conn.execute("SELECT COUNT(*) FROM town_building").fetchone()[0] == 0


def test_concurrent_first_entry_seeds_once(tmp_path):
    """Two concurrent first-reads on separate connections: BEGIN IMMEDIATE +
    busy_timeout serialize them into exactly one seed."""
    path = tmp_path / "race.db"

    def runner(results, index, errors):
        try:
            conn = connect(path)
            try:
                from life_energy.db.migrations import migrate

                migrate(conn)
                results[index] = ensure_world(conn)
            finally:
                conn.close()
        except Exception as exc:  # surfaced below; a silent thread death would look like a missing key
            errors[index] = exc

    results: dict[int, bool] = {}
    errors: dict[int, Exception] = {}
    threads = [threading.Thread(target=runner, args=(results, i, errors)) for i in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(60)
    assert not errors, f"thread failures: {errors}"
    assert sorted(results) == [False, True]  # exactly one performed the seed
    with open_db(path) as conn:
        state = load_world(conn)
    assert {b.building_id for b in state.buildings} == FROZEN_SEED_IDS
    assert state.revision == SEED_REVISION


def test_cli_town_world_show_json_is_stable(tmp_path, capsys):
    path = tmp_path / "cli.db"
    cli_main(["--db", str(path), "town", "world", "show", "--json"])
    first = capsys.readouterr().out
    payload = json.loads(first)
    assert payload["world_version"] == "town-world-v1"
    assert payload["layout_version"] == "living-town-block-v1"
    assert payload["revision"] == SEED_REVISION
    assert {b["building_id"] for b in payload["buildings"]} == FROZEN_SEED_IDS
    assert all(b["lifecycle"] == "ACTIVE" for b in payload["buildings"])

    cli_main(["--db", str(path), "town", "world", "show", "--json"])
    assert capsys.readouterr().out == first  # restart output byte-identical


def test_cli_town_world_show_text(tmp_path, capsys):
    path = tmp_path / "cli2.db"
    cli_main(["--db", str(path), "town", "world", "show"])
    out = capsys.readouterr().out
    assert "town-world-v1" in out
    for building_id in FROZEN_SEED_IDS:
        assert building_id in out


def test_cli_town_world_show_does_not_write_ledger_tables(tmp_path, capsys):
    path = tmp_path / "cli3.db"
    cli_main(["--db", str(path), "town", "world", "show", "--json"])
    capsys.readouterr()
    with open_db(path) as conn:
        assert conn.execute("SELECT COUNT(*) FROM transactions").fetchone()[0] == 0
        assert conn.execute("SELECT COUNT(*) FROM accounts").fetchone()[0] == 0


def test_seed_rows_match_contract_cells(tmp_path):
    contract = load_contract()
    path = tmp_path / "cells.db"
    _open_fresh(path)
    conn = connect(path)
    try:
        stored = {
            row["building_id"]: (row["asset_id"], row["grid_x"], row["grid_y"], row["orientation"])
            for row in conn.execute("SELECT * FROM town_building")
        }
    finally:
        conn.close()
    for seed in contract.seed_buildings:
        assert stored[seed.building_id] == (seed.asset_id, seed.grid_x, seed.grid_y, seed.orientation)
