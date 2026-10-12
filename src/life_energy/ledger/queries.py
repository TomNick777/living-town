"""Read-side queries over the canonical ledger.

Everything the CLI and tests need for inspection, including the explicit
unresolved states: UNKNOWN types, unattributed accounts, unclassified rows,
unpaired transfers and unresolved refunds. Unresolved is a normal, queryable
state — never silently absorbed.
"""

from __future__ import annotations

import sqlite3

from ..energy.model import signed_minor

SELECT_TX = """
SELECT t.transaction_id, t.occurred_at, t.source, t.counterparty, t.description,
       t.amount_minor, t.currency, t.direction, t.transaction_type, t.status,
       t.source_reference, t.source_account_id, a.name AS account_name,
       i.category_code, i.classification_source, i.energy_type, i.is_manual_override
FROM transactions t
LEFT JOIN accounts a ON a.account_id = t.source_account_id
LEFT JOIN transaction_interpretation i ON i.transaction_id = t.transaction_id
"""


def get_transaction(conn: sqlite3.Connection, transaction_id: int) -> dict | None:
    row = conn.execute(f"{SELECT_TX} WHERE t.transaction_id = ?", (transaction_id,)).fetchone()
    return dict(row) if row else None


def list_transactions(
    conn: sqlite3.Connection,
    *,
    month: str | None = None,
    transaction_type: str | None = None,
    account_id: int | None = None,
    limit: int = 50,
) -> list[dict]:
    clauses, params = [], []
    if month:
        start, end = month_bounds(month)
        clauses.append("t.occurred_at >= ? AND t.occurred_at < ?")
        params += [start, end]
    if transaction_type:
        clauses.append("t.transaction_type = ?")
        params.append(transaction_type)
    if account_id:
        clauses.append("t.source_account_id = ?")
        params.append(account_id)
    where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
    params.append(limit)
    rows = conn.execute(f"{SELECT_TX} {where} ORDER BY t.occurred_at DESC LIMIT ?", params).fetchall()
    return [dict(row) for row in rows]


def month_bounds(month: str) -> tuple[str, str]:
    """'2026-08' -> ('2026-08-01T00:00:00+08:00', '2026-09-01T00:00:00+08:00')."""
    year, month_number = month.split("-")
    start_year = int(year)
    start_month = int(month_number)
    end_year, end_month = (start_year + 1, 1) if start_month == 12 else (start_year, start_month + 1)
    return (
        f"{start_year:04d}-{start_month:02d}-01T00:00:00+08:00",
        f"{end_year:04d}-{end_month:02d}-01T00:00:00+08:00",
    )


def counts(conn: sqlite3.Connection) -> dict:
    def count(table: str) -> int:
        return conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]

    return {
        "accounts": count("accounts"),
        "import_batches": count("import_batches"),
        "raw_records": count("raw_records"),
        "transactions": count("transactions"),
        "interpretations": count("transaction_interpretation"),
        "transfer_pairs": count("transfer_pairs"),
        "refund_links": count("refund_links"),
    }


def unresolved_transactions(conn: sqlite3.Connection, limit: int = 100) -> dict[str, list[dict]]:
    """Every row here needs human eyes; none of them is silently absorbed."""
    unknown_types = conn.execute(
        f"{SELECT_TX} WHERE t.transaction_type = 'UNKNOWN' ORDER BY t.occurred_at LIMIT ?",
        (limit,),
    ).fetchall()
    unattributed = conn.execute(
        f"{SELECT_TX} WHERE t.source_account_id IS NULL ORDER BY t.occurred_at LIMIT ?",
        (limit,),
    ).fetchall()
    unclassified = conn.execute(
        f"""
        {SELECT_TX}
        WHERE t.transaction_type IN ('EXPENSE', 'INCOME')
          AND (i.transaction_id IS NULL OR i.classification_source = 'NONE' OR i.category_code IS NULL)
        ORDER BY t.occurred_at LIMIT ?
        """,
        (limit,),
    ).fetchall()
    unpaired_transfers = conn.execute(
        f"""
        {SELECT_TX}
        WHERE t.transaction_type = 'TRANSFER'
          AND NOT EXISTS (
              SELECT 1 FROM transfer_pairs tp
              WHERE tp.out_transaction_id = t.transaction_id OR tp.in_transaction_id = t.transaction_id
          )
        ORDER BY t.occurred_at LIMIT ?
        """,
        (limit,),
    ).fetchall()
    unresolved_refunds = conn.execute(
        f"""
        {SELECT_TX}
        WHERE t.transaction_type = 'REFUND'
          AND (
              NOT EXISTS (SELECT 1 FROM refund_links rl WHERE rl.refund_transaction_id = t.transaction_id)
              OR EXISTS (
                  SELECT 1 FROM refund_links rl
                  WHERE rl.refund_transaction_id = t.transaction_id AND rl.link_status = 'UNRESOLVED'
              )
          )
        ORDER BY t.occurred_at LIMIT ?
        """,
        (limit,),
    ).fetchall()
    return {
        "unknown_type": [dict(r) for r in unknown_types],
        "unattributed_account": [dict(r) for r in unattributed],
        "unclassified": [dict(r) for r in unclassified],
        "unpaired_transfer": [dict(r) for r in unpaired_transfers],
        "unresolved_refund": [dict(r) for r in unresolved_refunds],
    }


def net_flow_by_account(conn: sqlite3.Connection, start: str, end: str) -> list[dict]:
    """Signed net flow per account in [start, end): the raw cash arithmetic."""
    rows = conn.execute(
        """
        SELECT t.source_account_id, a.name AS account_name, t.direction, SUM(t.amount_minor) AS total_minor
        FROM transactions t LEFT JOIN accounts a ON a.account_id = t.source_account_id
        WHERE t.occurred_at >= ? AND t.occurred_at < ?
        GROUP BY t.source_account_id, t.direction
        """,
        (start, end),
    ).fetchall()
    accounts: dict[int | None, dict] = {}
    for row in rows:
        entry = accounts.setdefault(
            row["source_account_id"], {"account_id": row["source_account_id"], "account_name": row["account_name"], "net_minor": 0}
        )
        entry["net_minor"] += signed_minor(row["total_minor"], row["direction"])
    return sorted(accounts.values(), key=lambda item: (item["account_id"] is None, item["account_id"] or 0))
