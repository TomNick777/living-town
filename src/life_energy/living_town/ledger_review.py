"""Read-only ledger workbench: period transaction list + unresolved buckets.

This is the second-class UI data source from the Living Town UI contract
(list_transactions / unresolved_transactions). It never writes, never
exposes raw_payload, and never emits ENERGY_* labels. Amounts are the
canonical integer minors; the browser must not sum them into a new total.
"""

from __future__ import annotations

from datetime import datetime, timezone

import sqlite3

from ..ledger.queries import month_bounds
from .rules import CATEGORY_TO_SCENE, INVESTMENT, OTHER

REVIEW_VERSION = "ledger-review-v1"
DEFAULT_LIMIT = 80
MAX_LIMIT = 200
TRANSACTION_TYPES = ("INCOME", "EXPENSE", "TRANSFER", "REFUND", "INVESTMENT", "UNKNOWN")
BUCKETS = (
    "unpaired_transfer",
    "unresolved_refund",
    "unknown_type",
    "unattributed_account",
    "unclassified",
    "pending",
)

_SELECT = """
SELECT t.transaction_id, t.occurred_at, t.source, t.counterparty, t.description,
       t.amount_minor, t.currency, t.direction, t.transaction_type, t.status,
       t.source_account_id, a.name AS account_name,
       i.category_code, i.classification_source, i.is_manual_override,
       tp.pair_status AS transfer_pair_status,
       rl.link_status AS refund_link_status,
       c.name AS category_name
FROM transactions t
LEFT JOIN accounts a ON a.account_id = t.source_account_id
LEFT JOIN transaction_interpretation i ON i.transaction_id = t.transaction_id
LEFT JOIN transfer_pairs tp
  ON tp.out_transaction_id = t.transaction_id OR tp.in_transaction_id = t.transaction_id
LEFT JOIN refund_links rl ON rl.refund_transaction_id = t.transaction_id
LEFT JOIN categories c ON c.code = i.category_code
WHERE t.occurred_at >= ? AND t.occurred_at < ?
ORDER BY t.occurred_at DESC, t.transaction_id DESC
"""


def build_ledger_review(
    conn: sqlite3.Connection,
    month: str,
    *,
    transaction_type: str | None = None,
    bucket: str | None = None,
    q: str | None = None,
    limit: int = DEFAULT_LIMIT,
    offset: int = 0,
    generated_at: str | None = None,
) -> dict:
    """Period-scoped workbench document. Read-only; pagination is over facts."""
    if transaction_type is not None and transaction_type not in TRANSACTION_TYPES:
        raise ValueError(f"unknown transaction_type {transaction_type!r}")
    if bucket is not None and bucket not in BUCKETS:
        raise ValueError(f"unknown bucket {bucket!r}")
    if limit < 1 or limit > MAX_LIMIT:
        raise ValueError(f"limit must be 1..{MAX_LIMIT}")
    if offset < 0:
        raise ValueError("offset must be >= 0")

    start, end = month_bounds(month)
    rows = [dict(row) for row in conn.execute(_SELECT, (start, end)).fetchall()]
    items = [_item(row) for row in rows]
    needle = (q or "").strip().casefold()

    type_counts = {kind: 0 for kind in TRANSACTION_TYPES}
    bucket_counts = {kind: 0 for kind in BUCKETS if kind != "pending"}
    for item in items:
        type_counts[item["transaction_type"]] += 1
        for flag in item["flags"]:
            bucket_counts[flag] += 1
    bucket_counts["pending"] = sum(1 for item in items if item["flags"])

    filtered = items
    if transaction_type:
        filtered = [item for item in filtered if item["transaction_type"] == transaction_type]
    if bucket == "pending":
        filtered = [item for item in filtered if item["flags"]]
    elif bucket:
        filtered = [item for item in filtered if bucket in item["flags"]]
    if needle:
        filtered = [item for item in filtered if needle in item["search_text"]]

    total = len(filtered)
    page = filtered[offset : offset + limit]
    for item in page:
        item.pop("search_text", None)

    return {
        "projection_version": REVIEW_VERSION,
        "generated_at": generated_at or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S+00:00"),
        "month": month,
        "total_count": total,
        "limit": limit,
        "offset": offset,
        "type_counts": type_counts,
        "bucket_counts": bucket_counts,
        "transactions": page,
    }


def _item(row: dict) -> dict:
    flags = _flags(row)
    return {
        "transaction_id": row["transaction_id"],
        "occurred_at": row["occurred_at"],
        "source": row["source"],
        "counterparty": row["counterparty"],
        "description": row["description"],
        "amount_minor": row["amount_minor"],
        "currency": row["currency"],
        "direction": row["direction"],
        "transaction_type": row["transaction_type"],
        "status": row["status"],
        "account_name": row["account_name"],
        "category_code": row["category_code"],
        "category_name": row["category_name"],
        "scene": _scene(row),
        "classification_source": row["classification_source"],
        "manual_override": bool(row["is_manual_override"]),
        "flags": flags,
        "search_text": " ".join(
            part for part in (row["counterparty"], row["description"], row["source"], row["account_name"]) if part
        ).casefold(),
    }


def _flags(row: dict) -> list[str]:
    flags: list[str] = []
    if row["transaction_type"] == "UNKNOWN":
        flags.append("unknown_type")
    if row["source_account_id"] is None:
        flags.append("unattributed_account")
    if row["transaction_type"] in ("EXPENSE", "INCOME") and not row["category_code"]:
        flags.append("unclassified")
    if row["transaction_type"] == "TRANSFER" and row["transfer_pair_status"] is None:
        flags.append("unpaired_transfer")
    if row["transaction_type"] == "REFUND" and row["refund_link_status"] in (None, "UNRESOLVED"):
        flags.append("unresolved_refund")
    return flags


def _scene(row: dict) -> str | None:
    if row["transaction_type"] == "EXPENSE":
        return CATEGORY_TO_SCENE.get(row.get("category_code") or "", OTHER)
    if row["transaction_type"] == "INVESTMENT" and row["direction"] == "OUTFLOW":
        return INVESTMENT
    return None
