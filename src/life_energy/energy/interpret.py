"""Materialize energy interpretations for provenance and audit.

The energy summary always computes live from canonical facts + pairing state
(one source of truth). This module additionally persists the derived energy
type + provenance JSON into ``transaction_interpretation`` so the question
"why is this row ENERGY_EXPORT?" is answerable from the database itself.
Manual overrides are never clobbered.
"""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone

from .model import ENERGY_TYPES, classify_energy, load_energy_rows


def refresh_energy_interpretations(conn: sqlite3.Connection) -> dict:
    rows = classify_energy(load_energy_rows(conn))
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S+00:00")
    stats = {"materialized": 0, "kept_manual": 0}

    for row in rows:
        if row.get("is_manual_override"):
            stats["kept_manual"] += 1
            continue
        conn.execute(
            """
            INSERT INTO transaction_interpretation
                (transaction_id, energy_type, energy_derived_from, interpretation_version, derived_at)
            VALUES (?, ?, ?, 1, ?)
            ON CONFLICT(transaction_id) DO UPDATE SET
                energy_type = excluded.energy_type,
                energy_derived_from = excluded.energy_derived_from,
                interpretation_version = transaction_interpretation.interpretation_version + 1,
                derived_at = excluded.derived_at
            """,
            (row["transaction_id"], row["energy_type"], _dumps(row["energy_derived_from"]), now),
        )
        stats["materialized"] += 1
    conn.commit()
    return stats


def override_energy_type(conn: sqlite3.Connection, transaction_id: int, energy_type: str, note: str = "") -> None:
    """Human-confirmed energy reading (e.g. an incoming wechat transfer that is
    external income, not an internal movement). Facts stay untouched; the
    interpretation row is marked as a manual override and never re-derived.
    """
    if energy_type not in ENERGY_TYPES:
        raise ValueError(f"unknown energy type {energy_type!r}; expected one of {ENERGY_TYPES}")
    tx = conn.execute(
        "SELECT transaction_id FROM transactions WHERE transaction_id = ?", (transaction_id,)
    ).fetchone()
    if tx is None:
        raise ValueError(f"transaction {transaction_id} does not exist")
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S+00:00")
    conn.execute(
        """
        INSERT INTO transaction_interpretation
            (transaction_id, energy_type, energy_derived_from, is_manual_override,
             interpretation_version, derived_at)
        VALUES (?, ?, ?, 1, 1, ?)
        ON CONFLICT(transaction_id) DO UPDATE SET
            energy_type = excluded.energy_type,
            energy_derived_from = excluded.energy_derived_from,
            is_manual_override = 1,
            interpretation_version = transaction_interpretation.interpretation_version + 1,
            derived_at = excluded.derived_at
        """,
        (
            transaction_id,
            energy_type,
            json.dumps({"manual_override": True, "note": note or "manual energy override"}, ensure_ascii=False),
            now,
        ),
    )
    conn.commit()


def _dumps(value: dict) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True)
