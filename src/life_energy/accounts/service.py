"""Account registry and deterministic payment-method attribution.

Attribution policy: a transaction's source account is resolved from its
channel ``payment_method`` via exact or prefix alias matches. A miss leaves
``source_account_id`` NULL — attribution never guesses, and NULL is a first-
class queryable state (see ``transactions unresolved``).
"""

from __future__ import annotations

import sqlite3

VALID_ACCOUNT_TYPES = ("CASH", "CREDIT", "INVESTMENT", "EXTERNAL")


def ensure_account(
    conn: sqlite3.Connection,
    name: str,
    account_type: str = "CASH",
    institution: str | None = None,
    masked_number: str | None = None,
    owner_role: str | None = None,
) -> int:
    """Get-or-create an account by name."""
    if account_type not in VALID_ACCOUNT_TYPES:
        raise ValueError(f"invalid account type {account_type!r}; expected one of {VALID_ACCOUNT_TYPES}")
    row = conn.execute("SELECT account_id FROM accounts WHERE name = ?", (name,)).fetchone()
    if row:
        return row["account_id"]
    cursor = conn.execute(
        "INSERT INTO accounts (name, account_type, institution, masked_number, owner_role) VALUES (?, ?, ?, ?, ?)",
        (name, account_type, institution, masked_number, owner_role),
    )
    return cursor.lastrowid


def add_alias(conn: sqlite3.Connection, channel: str, alias_value: str, account_id: int, match_mode: str = "EXACT") -> None:
    if match_mode not in ("EXACT", "PREFIX"):
        raise ValueError(f"invalid alias match_mode {match_mode!r}")
    conn.execute(
        """
        INSERT INTO account_aliases (channel, alias_value, match_mode, account_id)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(channel, alias_value) DO UPDATE SET account_id = excluded.account_id,
                                                         match_mode = excluded.match_mode
        """,
        (channel, alias_value, match_mode, account_id),
    )


def resolve_account_id(conn: sqlite3.Connection, channel: str, payment_method: str | None) -> int | None:
    """Exact alias wins; otherwise the longest matching PREFIX alias. Miss -> None."""
    text = (payment_method or "").strip()
    if not text:
        return None
    row = conn.execute(
        "SELECT account_id FROM account_aliases WHERE channel = ? AND alias_value = ?",
        (channel, text),
    ).fetchone()
    if row:
        return row["account_id"]
    row = conn.execute(
        """
        SELECT account_id FROM account_aliases
        WHERE channel = ? AND match_mode = 'PREFIX' AND ? LIKE alias_value || '%'
        ORDER BY length(alias_value) DESC LIMIT 1
        """,
        (channel, text),
    ).fetchone()
    return row["account_id"] if row else None


def reattribute_transactions(conn: sqlite3.Connection, channel: str | None = None) -> dict:
    """Re-run alias attribution over imported transactions.

    Attribution is a deterministic mapping (aliases), not an inference — so it
    may be safely recomputed when the user adds aliases after importing. Only
    rows whose payment method now resolves get updated; nothing is ever set
    back to NULL and bank fallback attributions are kept.
    """
    import json

    from ..normalization.fields import PAYMENT_METHOD_RAW_KEY

    stats = {"updated": 0, "unchanged": 0, "unresolvable": 0}
    where, params = "", []
    if channel:
        where = "WHERE t.source = ?"
        params = [channel]
    rows = conn.execute(
        f"""
        SELECT t.transaction_id, t.source, t.source_account_id, r.raw_payload
        FROM transactions t JOIN raw_records r ON r.raw_record_id = t.raw_record_id
        {where}
        """,
        params,
    ).fetchall()
    for row in rows:
        key = PAYMENT_METHOD_RAW_KEY.get(row["source"])
        if key is None:
            stats["unchanged"] += 1
            continue
        payment_method = (json.loads(row["raw_payload"]).get(key) or "").strip()
        account_id = resolve_account_id(conn, row["source"], payment_method)
        if account_id is None:
            stats["unresolvable"] += 1
            continue
        if account_id != row["source_account_id"]:
            conn.execute(
                "UPDATE transactions SET source_account_id = ? WHERE transaction_id = ?",
                (account_id, row["transaction_id"]),
            )
            stats["updated"] += 1
        else:
            stats["unchanged"] += 1
    conn.commit()
    return stats


def list_accounts(conn: sqlite3.Connection) -> list[dict]:
    rows = conn.execute("SELECT * FROM accounts ORDER BY account_id").fetchall()
    return [dict(row) for row in rows]


def list_aliases(conn: sqlite3.Connection) -> list[dict]:
    rows = conn.execute(
        """
        SELECT aa.alias_id, aa.channel, aa.alias_value, aa.match_mode, aa.account_id, a.name AS account_name
        FROM account_aliases aa JOIN accounts a ON a.account_id = aa.account_id
        ORDER BY aa.channel, aa.alias_value
        """
    ).fetchall()
    return [dict(row) for row in rows]
