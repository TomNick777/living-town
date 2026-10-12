"""Refund linking: every refund traces back to its original expense.

A refund is not income. Each REFUND transaction gets a refund_links row:
linked to its original EXPENSE, or explicitly UNRESOLVED — there is no
"just an inflow" state. Automatic suggestions stop at PROBABLE; only human
confirmation (or a strong manual link) marks CONFIRMED.

Energy reads a refund as ENERGY_RETURN — never ENERGY_INPUT.
"""

from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timedelta

MAX_REFUND_WINDOW_DAYS = 90


@dataclass
class RefundCandidate:
    refund_transaction_id: int
    original_transaction_id: int
    delta_days: float
    match_reason: dict


def _parse_time(value: str) -> datetime | None:
    try:
        return datetime.fromisoformat(value)
    except (TypeError, ValueError):
        return None


def _counterparty_similar(a: str | None, b: str | None) -> bool:
    a = (a or "").strip().lower()
    b = (b or "").strip().lower()
    if not a or not b:
        return False
    return a == b or a in b or b in a


def find_refund_candidates(conn: sqlite3.Connection, refund_transaction_id: int | None = None) -> list[RefundCandidate]:
    refund_filter, params = "", []
    if refund_transaction_id is not None:
        refund_filter = "AND t.transaction_id = ?"
        params.append(refund_transaction_id)

    refunds = conn.execute(
        f"""
        SELECT t.transaction_id, t.occurred_at, t.source, t.amount_minor, t.counterparty
        FROM transactions t
        WHERE t.transaction_type = 'REFUND'
          AND t.direction = 'INFLOW'
          AND NOT EXISTS (
              SELECT 1 FROM refund_links rl WHERE rl.refund_transaction_id = t.transaction_id
          )
          {refund_filter}
        ORDER BY t.occurred_at
        """,
        params,
    ).fetchall()

    expenses = conn.execute(
        """
        SELECT t.transaction_id, t.occurred_at, t.source, t.amount_minor, t.counterparty
        FROM transactions t
        WHERE t.transaction_type = 'EXPENSE' AND t.direction = 'OUTFLOW'
        ORDER BY t.occurred_at
        """
    ).fetchall()

    candidates: list[RefundCandidate] = []
    for refund in refunds:
        t_refund = _parse_time(refund["occurred_at"])
        if t_refund is None:
            continue
        best: RefundCandidate | None = None
        best_key: tuple[int, float] | None = None
        for expense in expenses:
            t_expense = _parse_time(expense["occurred_at"])
            if t_expense is None or t_expense > t_refund:
                continue
            delta = t_refund - t_expense
            if delta > timedelta(days=MAX_REFUND_WINDOW_DAYS):
                continue
            if expense["source"] != refund["source"]:
                continue  # refunds go back the way they came
            if refund["amount_minor"] > expense["amount_minor"]:
                continue  # a refund cannot exceed what was paid
            if not _counterparty_similar(refund["counterparty"], expense["counterparty"]):
                continue
            candidate = RefundCandidate(
                refund_transaction_id=refund["transaction_id"],
                original_transaction_id=expense["transaction_id"],
                delta_days=round(delta.total_seconds() / 86400, 2),
                match_reason={
                    "same_channel": True,
                    "counterparty_similar": True,
                    "amount_minor": refund["amount_minor"],
                    "original_amount_minor": expense["amount_minor"],
                    "delta_days": round(delta.total_seconds() / 86400, 2),
                },
            )
            # Prefer exact-amount originals, then the freshest one.
            key = (0 if refund["amount_minor"] == expense["amount_minor"] else 1, candidate.delta_days)
            if best is None or key < best_key:
                best, best_key = candidate, key
        if best is not None:
            candidates.append(best)
    return candidates


def suggest_refunds(conn: sqlite3.Connection) -> list[RefundCandidate]:
    applied: list[RefundCandidate] = []
    for candidate in find_refund_candidates(conn):
        link_refund(
            conn,
            candidate.refund_transaction_id,
            candidate.original_transaction_id,
            link_status="PROBABLE",
            match_reason=candidate.match_reason,
            confidence=0.8,
            paired_by="AUTO",
        )
        applied.append(candidate)
    conn.commit()
    return applied


def link_refund(
    conn: sqlite3.Connection,
    refund_transaction_id: int,
    original_transaction_id: int | None,
    *,
    link_status: str,
    match_reason: dict | None = None,
    confidence: float = 1.0,
    paired_by: str,
) -> int:
    if link_status not in ("CONFIRMED", "PROBABLE", "UNRESOLVED"):
        raise ValueError(f"invalid refund link status {link_status!r}")
    if link_status == "UNRESOLVED" and original_transaction_id is not None:
        raise ValueError("an UNRESOLVED link cannot point at an original transaction")
    conn.execute(
        """
        INSERT INTO refund_links
            (refund_transaction_id, original_transaction_id, link_status, match_reason, confidence, paired_by)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(refund_transaction_id) DO UPDATE SET
            original_transaction_id = excluded.original_transaction_id,
            link_status = excluded.link_status,
            match_reason = excluded.match_reason,
            confidence = excluded.confidence,
            paired_by = excluded.paired_by
        """,
        (
            refund_transaction_id,
            original_transaction_id,
            link_status,
            json.dumps(match_reason, ensure_ascii=False) if match_reason else None,
            confidence,
            paired_by,
        ),
    )
    return refund_transaction_id


def confirm_refund_link(conn: sqlite3.Connection, refund_transaction_id: int) -> None:
    link = conn.execute(
        "SELECT * FROM refund_links WHERE refund_transaction_id = ?", (refund_transaction_id,)
    ).fetchone()
    if link is None or link["original_transaction_id"] is None:
        raise ValueError(f"refund {refund_transaction_id} has no original transaction to confirm")
    conn.execute(
        "UPDATE refund_links SET link_status = 'CONFIRMED', paired_by = 'MANUAL' WHERE refund_transaction_id = ?",
        (refund_transaction_id,),
    )
    conn.commit()


def unlink_refund(conn: sqlite3.Connection, refund_transaction_id: int) -> None:
    """Detach a wrong link; the refund stays, explicitly unresolved."""
    link_refund(
        conn,
        refund_transaction_id,
        None,
        link_status="UNRESOLVED",
        match_reason={"note": "manual unlink"},
        confidence=0.0,
        paired_by="MANUAL",
    )
    conn.commit()


def mark_all_unresolved(conn: sqlite3.Connection) -> int:
    """Give every unlinked refund an explicit UNRESOLVED row (auditability)."""
    cursor = conn.execute(
        """
        INSERT INTO refund_links (refund_transaction_id, original_transaction_id, link_status, paired_by, confidence)
        SELECT t.transaction_id, NULL, 'UNRESOLVED', 'AUTO', 0.0
        FROM transactions t
        WHERE t.transaction_type = 'REFUND'
          AND NOT EXISTS (SELECT 1 FROM refund_links rl WHERE rl.refund_transaction_id = t.transaction_id)
        """
    )
    conn.commit()
    return cursor.rowcount


def list_refund_links(conn: sqlite3.Connection, link_status: str | None = None) -> list[dict]:
    where, params = "", []
    if link_status:
        where = "WHERE rl.link_status = ?"
        params.append(link_status)
    rows = conn.execute(
        f"""
        SELECT rl.refund_transaction_id, rl.link_status, rl.confidence, rl.paired_by, rl.match_reason,
               r.occurred_at AS refund_at, r.amount_minor AS refund_amount, r.source AS refund_source,
               r.counterparty AS refund_counterparty,
               o.transaction_id AS original_id, o.occurred_at AS original_at,
               o.amount_minor AS original_amount, o.counterparty AS original_counterparty
        FROM refund_links rl
        JOIN transactions r ON r.transaction_id = rl.refund_transaction_id
        LEFT JOIN transactions o ON o.transaction_id = rl.original_transaction_id
        {where} ORDER BY rl.refund_transaction_id
        """,
        params,
    ).fetchall()
    return [dict(row) for row in rows]
