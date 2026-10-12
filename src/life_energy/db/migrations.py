"""Incremental schema migration runner.

Policy (docs/data-invariants.md): the production ledger is never upgraded by
deleting and recreating the database. Every schema change is a numbered SQL
migration applied in order, tracked in ``schema_migrations``.

Properties:
- each migration has a unique integer version and a name
- migrations are applied strictly in version order, once
- the current version is detectable; an unknown *higher* version is an error
  (the database was written by a newer build — never touch it with old code)
- migration DDL is written idempotently (``IF NOT EXISTS``) so a partially
  applied migration (SQLite ``executescript`` auto-commits per statement) can
  be safely re-run.
"""

from __future__ import annotations

import re
import sqlite3
from dataclasses import dataclass
from importlib import resources
from pathlib import Path

MIGRATIONS_DIR = Path(__file__).parent / "migrations"
_FILENAME_RE = re.compile(r"^(\d{4})_([a-z0-9_]+)\.sql$")


@dataclass(frozen=True)
class Migration:
    version: int
    name: str
    sql: str


def discover_migrations(directory: Path | None = None) -> list[Migration]:
    """Load and validate packaged migrations; strict ordering, no gaps."""
    directory = directory or MIGRATIONS_DIR
    found: list[Migration] = []
    for entry in sorted(directory.iterdir()):
        match = _FILENAME_RE.match(entry.name)
        if not match:
            continue
        found.append(Migration(int(match.group(1)), match.group(2), entry.read_text(encoding="utf-8")))
    found.sort(key=lambda m: m.version)
    if not found:
        raise RuntimeError(f"no migration files found in {directory}")
    expected = found[0].version
    for migration in found:
        if migration.version != expected:
            raise RuntimeError(
                f"migration versions must be contiguous: expected {expected}, got {migration.version}"
            )
        expected += 1
    return found


def _migration_sql_from_package() -> list[Migration]:
    """Fallback for installed wheels where migrations ship as package data."""
    migrations: list[Migration] = []
    entries = sorted(
        (name for name in resources.files("life_energy.db.migrations").iterdir()),
        key=lambda entry: entry.name,
    )
    for entry in entries:
        match = _FILENAME_RE.match(entry.name)
        if not match:
            continue
        migrations.append(Migration(int(match.group(1)), match.group(2), entry.read_text(encoding="utf-8")))
    return migrations


def applied_versions(conn: sqlite3.Connection) -> list[int]:
    _ensure_migration_table(conn)
    rows = conn.execute("SELECT version FROM schema_migrations ORDER BY version").fetchall()
    return [row["version"] for row in rows]


def current_version(conn: sqlite3.Connection) -> int:
    versions = applied_versions(conn)
    return versions[-1] if versions else 0


def migrate(conn: sqlite3.Connection, directory: Path | None = None) -> list[Migration]:
    """Apply all pending migrations in order. Returns the ones applied now."""
    _ensure_migration_table(conn)
    migrations = discover_migrations(directory)
    if directory is None and not migrations:
        migrations = _migration_sql_from_package()

    applied_now: list[Migration] = []
    known = set(applied_versions(conn))
    latest_available = migrations[-1].version
    db_version = current_version(conn)
    if db_version > latest_available:
        raise RuntimeError(
            f"database schema version {db_version} is newer than supported version "
            f"{latest_available}; do not open a newer database with older code"
        )

    for migration in migrations:
        if migration.version in known:
            continue
        conn.executescript(migration.sql)
        conn.execute(
            "INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (?, ?)",
            (migration.version, migration.name),
        )
        conn.commit()
        applied_now.append(migration)
    return applied_now


def _ensure_migration_table(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        )
        """
    )
    conn.commit()
