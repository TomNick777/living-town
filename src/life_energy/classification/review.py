"""Grouped classification review: decide once per merchant group.

Unclassified rows need not be individual decisions: grouped by
``(transaction_type, merchant text)`` they collapse into a few hundred
groups, and one USER_EXPLICIT rule per group (match_field=all_text,
CONTAINS) classifies the group's rows across ALL channels at once — a
"美团" decision hits the wallet counterparty 美团 AND the GF-credit-card
description "(消费)（特约）美团". The group list is re-queried after every
rule, so shorter patterns automatically absorb longer sibling groups.

Rules — not row overrides — are the output: they are reusable, re-runnable,
carry provenance (rule id), and sit at the top of the deterministic priority
chain (USER_EXPLICIT). Manual overrides stay reserved for true exceptions,
e.g. the amount-only card-statement rows that no rule can ever match (they
have no text; the review loop says so instead of pretending).
"""

from __future__ import annotations

import sqlite3

from .engine import add_rule, classify_transactions

# Merchant text: counterparty when present, else the description (bank
# statement rows carry the merchant only inside the description).
_GROUP_TEXT = """
    CASE WHEN NULLIF(TRIM(t.counterparty), '') IS NOT NULL THEN TRIM(t.counterparty)
         ELSE TRIM(COALESCE(t.description, '')) END
"""

_UNCLASSIFIED_CTE = """
    WITH unclassified AS (
        SELECT t.transaction_id, t.transaction_type, t.counterparty, t.description,
               t.merchant, t.amount_minor, t.source, t.occurred_at,
               """ + _GROUP_TEXT + """ AS group_text
        FROM transactions t
        LEFT JOIN transaction_interpretation i ON i.transaction_id = t.transaction_id
        WHERE t.transaction_type IN ('EXPENSE', 'INCOME')
          AND IFNULL(i.is_manual_override, 0) = 0
          AND i.category_code IS NULL
    )
"""


def unclassified_summary(conn: sqlite3.Connection) -> dict:
    row = conn.execute(
        _UNCLASSIFIED_CTE
        + " SELECT COUNT(*) AS rows, COUNT(DISTINCT transaction_type || '|' || group_text) AS groups FROM unclassified"
    ).fetchone()
    return {"rows": row["rows"], "groups": row["groups"]}


def unclassified_groups(
    conn: sqlite3.Connection,
    *,
    tx_type: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> list[dict]:
    """Unclassified rows grouped by (type, merchant text), amount-desc."""
    where, params = "", []
    if tx_type:
        where = " WHERE transaction_type = ?"
        params.append(tx_type)
    params.extend([limit, offset])
    rows = conn.execute(
        _UNCLASSIFIED_CTE
        + """
        SELECT transaction_type AS ttype, group_text AS text,
               COUNT(*) AS n, SUM(amount_minor) AS total_minor,
               GROUP_CONCAT(DISTINCT source) AS channels
        FROM unclassified"""
        + where
        + """
        GROUP BY transaction_type, group_text
        ORDER BY total_minor DESC, n DESC
        LIMIT ? OFFSET ?
        """,
        params,
    ).fetchall()
    return [dict(row) for row in rows]


def group_detail(conn: sqlite3.Connection, tx_type: str, group_text: str, limit: int = 20) -> list[dict]:
    """Recent rows of one group (samples = a small limit)."""
    rows = conn.execute(
        _UNCLASSIFIED_CTE
        + """
        SELECT transaction_id, occurred_at, amount_minor, description, counterparty, source
        FROM unclassified
        WHERE transaction_type = ? AND group_text = ?
        ORDER BY occurred_at DESC LIMIT ?
        """,
        (tx_type, group_text, limit),
    ).fetchall()
    return [dict(row) for row in rows]


def create_group_rule(
    conn: sqlite3.Connection,
    *,
    group_text: str,
    tx_type: str,
    category_code: str,
    pattern: str | None = None,
    rule_name: str | None = None,
) -> int:
    """One user decision -> one USER_EXPLICIT rule (all_text, CONTAINS)."""
    if not group_text.strip():
        raise ValueError(
            "group has no text to match (amount-only bank row); "
            "use 'transactions override <id> <category>' per row instead"
        )
    category = conn.execute("SELECT kind FROM categories WHERE code = ?", (category_code,)).fetchone()
    if category is None:
        raise ValueError(f"unknown category code {category_code!r}")
    if category["kind"] != tx_type:
        raise ValueError(f"category {category_code} is a {category['kind']} category, group is {tx_type}")
    rule_id = add_rule(
        conn,
        priority_class="USER_EXPLICIT",
        name=rule_name or f"{group_text[:24]}→{category_code}",
        match_field="all_text",
        match_mode="CONTAINS",
        pattern=pattern or group_text,
        category_code=category_code,
        applies_to_type=tx_type,
        confidence=0.9,
        sort_order=50,
    )
    conn.commit()
    return rule_id


def apply_rules(conn: sqlite3.Connection) -> int:
    """Re-run the chain; previously-NONE rows retry, classified ones stay."""
    stats = classify_transactions(conn)
    return stats["unclassified"]


def review_unclassified(
    conn: sqlite3.Connection,
    *,
    input_func=input,
    echo=print,
    tx_type: str | None = None,
) -> dict:
    """Interactive loop: one category decision per group.

    Inputs per prompt:
        CODE          decide with this category (e.g. FOOD)
        CODE/PATTERN  decide with a custom (shorter) match pattern
        d [N]         show recent rows of the group
        s / Enter     skip this group
        q             quit
    """
    stats = {"rules_created": 0, "skipped": 0, "quit": False}
    skipped: set[tuple[str, str]] = set()
    while True:
        summary = unclassified_summary(conn)
        if summary["rows"] == 0:
            echo("没有待分类的交易了。")
            break
        groups = unclassified_groups(conn, tx_type=tx_type, limit=500)
        candidates = [g for g in groups if (g["ttype"], g["text"]) not in skipped]
        if not candidates:
            if skipped:
                skipped.clear()
                echo("（这一轮的组都跳过了，重新从头开始；输入 q 可随时退出。）")
                continue
            echo("当前范围内没有待分组。")
            break
        group = candidates[0]
        echo(
            f"\n== 剩余 {summary['rows']} 笔 / {summary['groups']} 组"
            f"  [EXPENSE=支出 INCOME=收入，当前组类型 {group['ttype']}]"
        )
        echo(
            f"  {group['text'] if group['text'] else '(无文本)'}  "
            f"{group['n']} 笔  ¥{group['total_minor'] // 100}.{group['total_minor'] % 100:02d}  "
            f"渠道: {group['channels']}"
        )
        for sample in group_detail(conn, group["ttype"], group["text"], limit=3):
            amount = f"¥{sample['amount_minor'] // 100}.{sample['amount_minor'] % 100:02d}"
            echo(f"    {sample['occurred_at'][:16]}  {sample['source']:<9} {amount:>10}  {sample['description'] or ''}")

        if not group["text"].strip():
            echo("  ⚠ 该组没有任何文本可匹配，规则引擎无法命中；请逐笔 'transactions override <id> <类别>' 或跳过。")

        try:
            answer = input_func(f"  类别代码 (CODE[/PATTERN], d 详情, s 跳过, q 退出): ").strip()
        except (EOFError, KeyboardInterrupt):
            echo("")
            stats["quit"] = True
            break
        if not answer or answer.lower() == "s":
            skipped.add((group["ttype"], group["text"]))
            stats["skipped"] += 1
            continue
        if answer.lower() in ("q", "quit", "exit"):
            stats["quit"] = True
            break
        if answer.lower() == "d" or answer.lower().startswith("d "):
            limit = 20
            parts = answer.split()
            if len(parts) == 2 and parts[1].isdigit():
                limit = int(parts[1])
            for row in group_detail(conn, group["ttype"], group["text"], limit=limit):
                amount = f"¥{row['amount_minor'] // 100}.{row['amount_minor'] % 100:02d}"
                echo(
                    f"    #{row['transaction_id']:<5} {row['occurred_at'][:16]} {row['source']:<9} "
                    f"{amount:>10}  {row['counterparty'] or ''} | {row['description'] or ''}"
                )
            continue

        category_code, _, pattern = answer.partition("/")
        category_code = category_code.strip().upper()
        try:
            rule_id = create_group_rule(
                conn,
                group_text=group["text"],
                tx_type=group["ttype"],
                category_code=category_code,
                pattern=pattern.strip() or None,
            )
        except ValueError as exc:
            echo(f"  ✗ {exc}")
            continue
        remaining = apply_rules(conn)
        stats["rules_created"] += 1
        echo(f"  ✓ 规则 #{rule_id} 已生效，剩余未分类 {remaining} 笔")
    return stats


def group_detail(conn: sqlite3.Connection, tx_type: str, group_text: str, limit: int = 20) -> list[dict]:
    rows = conn.execute(
        _UNCLASSIFIED_CTE
        + """
        SELECT transaction_id, occurred_at, amount_minor, description, counterparty, source
        FROM unclassified
        WHERE transaction_type = ? AND group_text = ?
        ORDER BY occurred_at DESC LIMIT ?
        """,
        (tx_type, group_text, limit),
    ).fetchall()
    return [dict(row) for row in rows]
