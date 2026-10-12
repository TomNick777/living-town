"""SQLite connection management.

Local-first, single-process CLI tool: connections are plain sqlite3
connections opened per call site, with the pragmas Life Energy relies on.
No global singleton, no thread lock machinery — the caller owns the
connection lifetime (usually via :func:`connect` as a context manager).
"""

from __future__ import annotations

import os
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path

DEFAULT_DB_ENV_VAR = "LIFE_ENERGY_DB"
DEFAULT_RELATIVE_PATH = Path("data") / "life-energy.db"


def default_db_path() -> Path:
    """Env var > ./data/life-energy.db. The repo default is for development."""
    env = os.environ.get(DEFAULT_DB_ENV_VAR)
    if env:
        return Path(env)
    return DEFAULT_RELATIVE_PATH


def _enable_wal(conn: sqlite3.Connection) -> None:
    """Switch the database to WAL exactly once, tolerating the race where two
    processes open the same fresh database simultaneously.

    journal_mode is a persistent property, so the common path is "already
    WAL" and the pragma is skipped entirely. The one-time conversion cannot
    run while another connection holds the database — the PRAGMA fails with
    'database is locked' regardless of busy_timeout — so retry briefly until
    the other opener finishes converting.
    """
    last_error: sqlite3.OperationalError | None = None
    for _ in range(50):
        try:
            current = conn.execute("PRAGMA journal_mode").fetchone()[0]
            if str(current).lower() == "wal":
                return
            conn.execute("PRAGMA journal_mode = WAL")
            return
        except sqlite3.OperationalError as exc:
            last_error = exc
            time.sleep(0.1)
    raise last_error  # the loop always runs at least once


def connect(db_path: str | os.PathLike[str]) -> sqlite3.Connection:
    path = Path(db_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    # busy_timeout must precede any lock-taking statement so a concurrent
    # opener waits its turn instead of failing outright.
    conn.execute("PRAGMA busy_timeout = 30000")
    _enable_wal(conn)
    return conn


@contextmanager
def open_db(db_path: str | os.PathLike[str], *, migrate: bool = True) -> sqlite3.Connection:
    """Open the ledger, running pending migrations unless asked not to."""
    from .migrations import migrate

    conn = connect(db_path)
    try:
        if migrate:
            migrate(conn)
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
