"""Cross-channel duplicate resolution (bank row ↔ wallet fact).

The same economic event legitimately appears in TWO bills: a WeChat/Alipay
row paid "支付方式: XX银行信用卡(9807)" and, days apart at most, the card
statement's "(消费)支付宝-…" row. Both bills themselves warn against double
bookkeeping (支付宝导出特别提示 #3). Importing both as canonical facts would
double-count ENERGY_CONSUMPTION.

Policy (docs/data-invariants.md 4/12 — honest, auditable, no guessing):
- The WALLET fact stays canonical: it carries the semantics (type, counter-
  party, category). The bank row is marked raw_records/DUPLICATE with a
  status_note pointing at the canonical transaction — evidence kept, audit
  answerable, nothing deleted.
- A link fires only on a deterministic conjunction: same source account
  (alias/fallback attribution), equal amount, occurrence within ±1 day, same
  direction (except wallet TRANSFER rows, whose direction is wallet-relative
  for 充值/提现), AND an explicit wallet marker on the bank side
  (支付宝/财付通/微信/…). No marker, no link — leftover rows stay visible.
- Each wallet fact can absorb at most one bank row (per-run consumed set +
  previously persisted links), so multiplicity never swallows real rows: if
  the statement shows two equal purchases and the wallet only one, the second
  bank row imports as its own fact.

This is deliberately import-time (not a re-runnable derived layer): the
decision is recorded once in the audit trail and never mutates facts.
"""

from __future__ import annotations
import re
from datetime import date, timedelta

import sqlite3

from ..normalization.normalizer import CanonicalCandidate

WALLET_SOURCES = ("wechat", "alipay")
WALLET_CHANNEL_MARKERS = ("支付宝", "财付通", "微信", "网商银行", "美团", "京东")
DEDUP_WINDOW_DAYS = 1

_NOTE_PREFIX = "cross-channel duplicate of transaction"
_NOTE_RE = re.compile(rf"{_NOTE_PREFIX} (\d+)")


def load_consumed_duplicate_targets(conn: sqlite3.Connection) -> set[int]:
    """Wallet transaction ids already absorbing a bank duplicate (earlier files)."""
    rows = conn.execute(
        "SELECT status_note FROM raw_records WHERE status = 'DUPLICATE' AND status_note LIKE ?",
        (f"{_NOTE_PREFIX} %",),
    ).fetchall()
    targets = set()
    for row in rows:
        match = _NOTE_RE.match(row["status_note"] or "")
        if match:
            targets.add(int(match.group(1)))
    return targets


def duplicate_note(wallet_transaction_id: int) -> str:
    return (
        f"{_NOTE_PREFIX} {wallet_transaction_id} "
        f"(same account+amount, ±{DEDUP_WINDOW_DAYS}d, wallet marker; wallet fact kept canonical)"
    )


def find_cross_channel_duplicate(
    conn: sqlite3.Connection,
    candidate: CanonicalCandidate,
    account_id: int | None,
    consumed: set[int],
) -> int | None:
    """Return the wallet transaction this bank row duplicates, or None."""
    if account_id is None:
        return None
    haystack = " ".join(
        [candidate.description, candidate.counterparty, candidate.merchant]
        + [str(v) for v in candidate.raw_fields.values() if isinstance(v, str)]
    )
    if not any(marker in haystack for marker in WALLET_CHANNEL_MARKERS):
        return None

    day = date.fromisoformat(candidate.occurred_at[:10])
    lo = (day - timedelta(days=DEDUP_WINDOW_DAYS)).isoformat()
    hi = (day + timedelta(days=DEDUP_WINDOW_DAYS + 1)).isoformat()
    rows = conn.execute(
        """
        SELECT transaction_id, occurred_at, direction, transaction_type
        FROM transactions
        WHERE source IN ('wechat', 'alipay')
          AND source_account_id = ?
          AND amount_minor = ?
          AND occurred_at >= ?
          AND occurred_at < ?
        """,
        (account_id, candidate.amount_minor, lo, hi),
    ).fetchall()
    eligible = [
        row for row in rows
        if row["transaction_id"] not in consumed
        and (row["direction"] == candidate.direction or row["transaction_type"] == "TRANSFER")
    ]
    if not eligible:
        return None
    return min(
        eligible,
        key=lambda row: (abs(date.fromisoformat(row["occurred_at"][:10]) - day).days, row["transaction_id"]),
    )["transaction_id"]
