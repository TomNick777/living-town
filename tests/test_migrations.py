"""Migration runner invariants: incremental, ordered, never destructive."""

from __future__ import annotations

import sqlite3

import pytest

from life_energy.db.connection import connect
from life_energy.db.migrations import current_version, discover_migrations, migrate


def test_migrate_creates_schema(tmp_path):
    conn = connect(tmp_path / "ledger.db")
    applied = migrate(conn)
    assert [m.version for m in applied] == [1, 2, 3]
    assert current_version(conn) == 3
    tables = {
        row["name"]
        for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
    }
    # Layer 1 / Layer 2 / Layer 3 tables all present.
    assert {"import_batches", "raw_records"} <= tables
    assert "transactions" in tables
    assert {
        "transaction_interpretation",
        "transfer_pairs",
        "transfer_pair_decisions",
        "refund_links",
        "classification_rules",
        "categories",
    } <= tables
    # Migration 0003 adds the world layer, fully isolated from the ledger.
    assert {"town_world", "town_building"} <= tables
    conn.close()


def test_migrate_is_idempotent(tmp_path):
    conn = connect(tmp_path / "ledger.db")
    migrate(conn)
    applied_again = migrate(conn)
    assert applied_again == []
    assert current_version(conn) == 3
    # Applied exactly once in the bookkeeping table.
    count = conn.execute("SELECT COUNT(*) FROM schema_migrations WHERE version <= 3").fetchone()[0]
    assert count == 3
    conn.close()


def test_discover_migrations_are_contiguous_and_ordered():
    migrations = discover_migrations()
    versions = [m.version for m in migrations]
    assert versions == sorted(versions)
    assert versions == list(range(versions[0], versions[-1] + 1))


def test_energy_type_check_allows_investment_internal(tmp_path):
    """Migration 0002 widens the interpretation CHECK for fund conversions."""
    conn = connect(tmp_path / "ledger.db")
    migrate(conn)
    conn.execute("INSERT INTO import_batches (batch_id, source_type, source_filename, source_sha256, parser_name, parser_version) VALUES ('b1', 'alipay', 'f.csv', 'sha1', 'alipay', 'alipay/1.0')")
    conn.execute(
        """
        INSERT INTO transactions (occurred_at, source, amount_minor, direction, transaction_type,
                                  source_reference, canonical_fingerprint, import_batch_id, raw_record_id)
        VALUES ('2026-01-01T00:00:00+08:00', 'alipay', 1, 'NEUTRAL', 'INVESTMENT', 'X1', 'fp1', 'b1', NULL)
        """
    )
    conn.execute(
        "INSERT INTO transaction_interpretation (transaction_id, energy_type) VALUES (1, 'ENERGY_INVESTMENT_INTERNAL')"
    )
    conn.commit()
    row = conn.execute("SELECT energy_type FROM transaction_interpretation WHERE transaction_id = 1").fetchone()
    assert row["energy_type"] == "ENERGY_INVESTMENT_INTERNAL"
    conn.close()


def test_rejects_newer_database(tmp_path):
    """A database written by a newer build must never be touched by old code."""
    conn = connect(tmp_path / "ledger.db")
    conn.execute(
        "CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT, applied_at TEXT)"
    )
    conn.execute("INSERT INTO schema_migrations (version, name) VALUES (9999, 'future')")
    conn.commit()
    with pytest.raises(RuntimeError, match="newer"):
        migrate(conn)
    conn.close()


def test_fact_and_derived_layers_separated(tmp_path):
    """Transactions table carries no interpretation columns by construction."""
    conn = connect(tmp_path / "ledger.db")
    migrate(conn)
    tx_columns = {row["name"] for row in conn.execute("PRAGMA table_info(transactions)").fetchall()}
    assert "category_code" not in tx_columns
    assert "energy_type" not in tx_columns
    assert "account_override_id" not in tx_columns
    conn.close()
