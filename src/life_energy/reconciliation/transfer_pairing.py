"""Internal transfer pairing.

Two canonical transactions can be one real movement of money (bank card ->
Alipay -> WeChat -> ...). Pairing prevents double counting and keeps energy
accounts neutral. Principles (inherited from all-wallet-manager's
TransferPairer, made more conservative):

- Only channel-declared TRANSFER facts participate.
- Auto suggestion creates at most PROBABLE pairs — never CONFIRMED facts.
  ``pair_status`` is honest: PROBABLE needs human confirmation via CLI.
- Amount tolerance is fee-shaped: out >= in and (out - in) <= 5% of out.
  Fee-bearing candidates become UNCERTAIN pairs (visible, unconfirmed).
- Rejected pairs are remembered (transfer_pair_decisions) and never re-suggested.
- Unpairing deletes the pair and records a REJECTED decision.

No synthetic fee transactions are ever created; the fee lives on the pair.
"""

from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass
from datetime import datetime

# Channels whose transfers settle within minutes.
INSTANT_SOURCES = {"wechat", "alipay"}
DEFAULT_INSTANT_WINDOW_MINUTES = 30.0
DEFAULT_OTHER_WINDOW_MINUTES = 120.0
FEE_RATIO_LIMIT = 0.05


@dataclass
class TransferCandidate:
    out_transaction_id: int
    in_transaction_id: int
    amount_out_minor: int
    amount_in_minor: int
    fee_minor: int
    delta_minutes: float
    match_reason: dict

    @property
    def suggested_status(self) -> str:
        return "PROBABLE" if self.fee_minor == 0 else "UNCERTAIN"


def _parse_time(value: str) -> datetime | None:
    try:
        return datetime.fromisoformat(value)
    except (TypeError, ValueError):
        return None


def find_transfer_candidates(conn: sqlite3.Connection) -> list[TransferCandidate]:
    rows = conn.execute(
        """
        SELECT t.transaction_id, t.occurred_at, t.source, t.direction, t.amount_minor,
               t.counterparty, t.source_account_id, a.name AS account_name
        FROM transactions t LEFT JOIN accounts a ON a.account_id = t.source_account_id
        WHERE t.transaction_type = 'TRANSFER'
          AND t.direction IN ('INFLOW', 'OUTFLOW')
          AND NOT EXISTS (
              SELECT 1 FROM transfer_pairs tp
              WHERE tp.out_transaction_id = t.transaction_id OR tp.in_transaction_id = t.transaction_id
          )
        ORDER BY t.occurred_at
        """
    ).fetchall()

    unpaired = [dict(row) for row in rows]
    rejected = {
        (row["out_transaction_id"], row["in_transaction_id"])
        for row in conn.execute("SELECT out_transaction_id, in_transaction_id FROM transfer_pair_decisions WHERE decision = 'REJECTED'")
    }

    candidates: list[TransferCandidate] = []
    for out in unpaired:
        if out["direction"] != "OUTFLOW":
            continue
        for inner in unpaired:
            if inner["direction"] != "INFLOW":
                continue
            if inner["transaction_id"] == out["transaction_id"]:
                continue
            if (out["transaction_id"], inner["transaction_id"]) in rejected:
                continue
            if out["source_account_id"] is None or inner["source_account_id"] is None:
                continue  # unattributed legs are not auto-paired; they surface as unresolved
            if out["source_account_id"] == inner["source_account_id"]:
                continue  # same account cannot transfer to itself

            amount_out, amount_in = out["amount_minor"], inner["amount_minor"]
            if amount_in > amount_out:
                continue
            fee = amount_out - amount_in
            if fee > amount_out * FEE_RATIO_LIMIT:
                continue

            t_out, t_in = _parse_time(out["occurred_at"]), _parse_time(inner["occurred_at"])
            if t_out is None or t_in is None:
                continue
            delta_minutes = abs((t_in - t_out).total_seconds()) / 60.0
            window = (
                DEFAULT_INSTANT_WINDOW_MINUTES
                if out["source"] in INSTANT_SOURCES or inner["source"] in INSTANT_SOURCES
                else DEFAULT_OTHER_WINDOW_MINUTES
            )
            if delta_minutes > window:
                continue

            candidates.append(
                TransferCandidate(
                    out_transaction_id=out["transaction_id"],
                    in_transaction_id=inner["transaction_id"],
                    amount_out_minor=amount_out,
                    amount_in_minor=amount_in,
                    fee_minor=fee,
                    delta_minutes=round(delta_minutes, 2),
                    match_reason={
                        "same_amount": fee == 0,
                        "opposite_direction": True,
                        "delta_minutes": round(delta_minutes, 2),
                        "window_minutes": window,
                        "out_source": out["source"],
                        "in_source": inner["source"],
                        "out_account": out["account_name"],
                        "in_account": inner["account_name"],
                    },
                )
            )
    candidates.sort(key=lambda c: (c.delta_minutes, c.fee_minor))
    return candidates


def suggest_transfers(conn: sqlite3.Connection) -> list[TransferCandidate]:
    """Create PROBABLE/UNCERTAIN pairs for the best non-conflicting candidates."""
    applied: list[TransferCandidate] = []
    used: set[int] = set()
    for candidate in find_transfer_candidates(conn):
        if candidate.out_transaction_id in used or candidate.in_transaction_id in used:
            continue
        create_pair(
            conn,
            candidate.out_transaction_id,
            candidate.in_transaction_id,
            pair_status=candidate.suggested_status,
            match_reason=candidate.match_reason,
            fee_minor=candidate.fee_minor,
            paired_by="AUTO",
        )
        used.add(candidate.out_transaction_id)
        used.add(candidate.in_transaction_id)
        applied.append(candidate)
    conn.commit()
    return applied


def create_pair(
    conn: sqlite3.Connection,
    out_transaction_id: int,
    in_transaction_id: int,
    *,
    pair_status: str,
    match_reason: dict,
    fee_minor: int = 0,
    paired_by: str,
) -> int:
    if pair_status not in ("CONFIRMED", "PROBABLE", "UNCERTAIN"):
        raise ValueError(f"invalid pair status {pair_status!r}")
    out, inner = _load_pair_legs(conn, out_transaction_id, in_transaction_id)
    if out is None or inner is None:
        raise ValueError("both legs must be TRANSFER transactions")
    cursor = conn.execute(
        """
        INSERT INTO transfer_pairs
            (out_transaction_id, in_transaction_id, pair_status, match_reason, fee_minor, paired_by)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (out_transaction_id, in_transaction_id, pair_status, json.dumps(match_reason, ensure_ascii=False), fee_minor, paired_by),
    )
    return cursor.lastrowid


def confirm_pair(conn: sqlite3.Connection, pair_id: int, *, by: str = "MANUAL") -> None:
    pair = conn.execute("SELECT * FROM transfer_pairs WHERE pair_id = ?", (pair_id,)).fetchone()
    if pair is None:
        raise ValueError(f"transfer pair {pair_id} does not exist")
    conn.execute("UPDATE transfer_pairs SET pair_status = 'CONFIRMED', paired_by = ? WHERE pair_id = ?", (by, pair_id))
    conn.execute(
        """
        INSERT INTO transfer_pair_decisions (out_transaction_id, in_transaction_id, decision)
        VALUES (?, ?, 'CONFIRMED')
        ON CONFLICT(out_transaction_id, in_transaction_id) DO UPDATE SET decision = 'CONFIRMED'
        """,
        (pair["out_transaction_id"], pair["in_transaction_id"]),
    )
    conn.commit()


def unpair(conn: sqlite3.Connection, pair_id: int) -> tuple[int, int]:
    pair = conn.execute("SELECT * FROM transfer_pairs WHERE pair_id = ?", (pair_id,)).fetchone()
    if pair is None:
        raise ValueError(f"transfer pair {pair_id} does not exist")
    conn.execute("DELETE FROM transfer_pairs WHERE pair_id = ?", (pair_id,))
    conn.execute(
        """
        INSERT INTO transfer_pair_decisions (out_transaction_id, in_transaction_id, decision)
        VALUES (?, ?, 'REJECTED')
        ON CONFLICT(out_transaction_id, in_transaction_id) DO UPDATE SET decision = 'REJECTED'
        """,
        (pair["out_transaction_id"], pair["in_transaction_id"]),
    )
    conn.commit()
    return pair["out_transaction_id"], pair["in_transaction_id"]


def list_pairs(conn: sqlite3.Connection, pair_status: str | None = None) -> list[dict]:
    where, params = "", []
    if pair_status:
        where = "WHERE tp.pair_status = ?"
        params.append(pair_status)
    rows = conn.execute(
        f"""
        SELECT tp.pair_id, tp.pair_status, tp.fee_minor, tp.paired_by, tp.match_reason, tp.created_at,
           tout.transaction_id AS out_id, tout.occurred_at AS out_at, tout.amount_minor AS out_amount,
           tout.source AS out_source, ta.name AS out_account,
           tin.transaction_id AS in_id, tin.occurred_at AS in_at, tin.amount_minor AS in_amount,
           tin.source AS in_source, tia.name AS in_account
        FROM transfer_pairs tp
        JOIN transactions tout ON tout.transaction_id = tp.out_transaction_id
        JOIN transactions tin ON tin.transaction_id = tp.in_transaction_id
        LEFT JOIN accounts ta ON ta.account_id = tout.source_account_id
        LEFT JOIN accounts tia ON tia.account_id = tin.source_account_id
        {where} ORDER BY tp.pair_id
        """,
        params,
    ).fetchall()
    return [dict(row) for row in rows]


def _load_pair_legs(conn: sqlite3.Connection, out_id: int, in_id: int) -> tuple[dict | None, dict | None]:
    rows = conn.execute(
        """
        SELECT transaction_id, transaction_type, direction, amount_minor FROM transactions
        WHERE transaction_id IN (?, ?)
        """,
        (out_id, in_id),
    ).fetchall()
    by_id = {row["transaction_id"]: dict(row) for row in rows}
    out, inner = by_id.get(out_id), by_id.get(in_id)
    if out is None or inner is None:
        return None, None
    if out["transaction_type"] != "TRANSFER" or inner["transaction_type"] != "TRANSFER":
        return None, None
    if out["direction"] != "OUTFLOW" or inner["direction"] != "INFLOW":
        return None, None
    return out, inner
