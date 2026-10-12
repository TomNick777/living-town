"""Deterministic classification with a strict priority chain.

    Manual Override  >  USER_EXPLICIT  >  MERCHANT  >  KEYWORD  >  HEURISTIC  >  UNKNOWN(NONE)

The first matching rule in priority order wins — no score mixing, so every
classification can answer "why" with one rule id. Manual overrides are never
touched by recompute. Facts (transactions) are never modified.
"""

from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone

PRIORITY_CLASSES = ("USER_EXPLICIT", "MERCHANT", "KEYWORD", "HEURISTIC")


@dataclass
class ClassificationResult:
    transaction_id: int
    category_code: str | None
    source: str          # MANUAL / USER_EXPLICIT / MERCHANT / KEYWORD / HEURISTIC / NONE
    rule_id: int | None
    confidence: float
    evidence: dict


def add_rule(
    conn: sqlite3.Connection,
    *,
    priority_class: str,
    name: str,
    match_field: str,
    match_mode: str,
    pattern: str,
    category_code: str,
    applies_to_type: str | None = "EXPENSE",
    confidence: float = 0.8,
    sort_order: int = 100,
) -> int:
    if priority_class not in PRIORITY_CLASSES:
        raise ValueError(f"invalid priority class {priority_class!r}")
    cursor = conn.execute(
        """
        INSERT INTO classification_rules
            (priority_class, name, match_field, match_mode, pattern, category_code,
             applies_to_type, confidence, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (priority_class, name, match_field, match_mode, pattern, category_code,
         applies_to_type, confidence, sort_order),
    )
    return cursor.lastrowid


def _match_value(row: sqlite3.Row, match_field: str) -> str:
    if match_field == "all_text":
        parts = [row["counterparty"] or "", row["description"] or "", row["merchant"] or ""]
        return " ".join(parts).strip().lower()
    value = row[match_field]
    return (value or "").strip().lower()


def _rule_matches(value: str, pattern: str, match_mode: str) -> bool:
    needle = pattern.strip().lower()
    if not needle:
        return False
    if match_mode == "EQUALS":
        return value == needle
    if match_mode == "PREFIX":
        return value.startswith(needle)
    return needle in value


def classify_one(conn: sqlite3.Connection, transaction_id: int) -> ClassificationResult:
    tx = conn.execute(
        "SELECT transaction_id, transaction_type, counterparty, description, merchant FROM transactions WHERE transaction_id = ?",
        (transaction_id,),
    ).fetchone()
    if tx is None:
        raise ValueError(f"transaction {transaction_id} does not exist")
    if tx["transaction_type"] not in ("EXPENSE", "INCOME"):
        return ClassificationResult(transaction_id, None, "NONE", None, 0.0, {})

    rules = conn.execute(
        """
        SELECT * FROM classification_rules
        WHERE enabled = 1 AND (applies_to_type IS NULL OR applies_to_type = ?)
        ORDER BY CASE priority_class
            WHEN 'USER_EXPLICIT' THEN 0 WHEN 'MERCHANT' THEN 1
            WHEN 'KEYWORD' THEN 2 WHEN 'HEURISTIC' THEN 3 END,
            sort_order, rule_id
        """,
        (tx["transaction_type"],),
    ).fetchall()

    for rule in rules:
        value = _match_value(tx, rule["match_field"])
        if _rule_matches(value, rule["pattern"], rule["match_mode"]):
            evidence = {
                "matched_field": rule["match_field"],
                "matched_value": value,
                "pattern": rule["pattern"],
                "match_mode": rule["match_mode"],
            }
            return ClassificationResult(
                transaction_id,
                rule["category_code"],
                rule["priority_class"],
                rule["rule_id"],
                float(rule["confidence"]),
                evidence,
            )

    return ClassificationResult(transaction_id, None, "NONE", None, 0.0, {})


def classify_transactions(conn: sqlite3.Connection, recompute: bool = False) -> dict:
    """Classify every EXPENSE/INCOME fact. Manual overrides are never clobbered."""
    stats = {"classified": 0, "unclassified": 0, "kept_manual": 0, "kept_existing": 0, "recomputed": 0}
    rows = conn.execute(
        """
        SELECT t.transaction_id, i.is_manual_override, i.classification_source
        FROM transactions t
        LEFT JOIN transaction_interpretation i ON i.transaction_id = t.transaction_id
        WHERE t.transaction_type IN ('EXPENSE', 'INCOME')
        ORDER BY t.transaction_id
        """
    ).fetchall()

    for row in rows:
        if row["is_manual_override"]:
            stats["kept_manual"] += 1
            continue
        # Already classified by some rule: leave it unless recompute was asked.
        # A previous NONE (unclassified) is always retried — new rules may hit.
        existing = row["classification_source"] is not None and row["classification_source"] != "NONE"
        if existing and not recompute:
            stats["kept_existing"] += 1
            continue

        result = classify_one(conn, row["transaction_id"])
        if existing and recompute:
            stats["recomputed"] += 1
        _upsert_interpretation(conn, result)
        if result.category_code:
            stats["classified"] += 1
        else:
            stats["unclassified"] += 1
    conn.commit()
    return stats


def override_category(conn: sqlite3.Connection, transaction_id: int, category_code: str, note: str = "") -> None:
    """Human decision: stored as a manual override, facts untouched."""
    category = conn.execute("SELECT code FROM categories WHERE code = ?", (category_code,)).fetchone()
    if category is None:
        raise ValueError(f"unknown category code {category_code!r}")
    result = ClassificationResult(transaction_id, category_code, "MANUAL", None, 1.0, {"note": note})
    _upsert_interpretation(conn, result, manual=True)


def _upsert_interpretation(conn: sqlite3.Connection, result: ClassificationResult, manual: bool = False) -> None:
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S+00:00")
    conn.execute(
        """
        INSERT INTO transaction_interpretation
            (transaction_id, category_code, classification_source, classification_rule_id,
             classification_confidence, classification_evidence, is_manual_override,
             interpretation_version, derived_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
        ON CONFLICT(transaction_id) DO UPDATE SET
            category_code = excluded.category_code,
            classification_source = excluded.classification_source,
            classification_rule_id = excluded.classification_rule_id,
            classification_confidence = excluded.classification_confidence,
            classification_evidence = excluded.classification_evidence,
            is_manual_override = CASE WHEN transaction_interpretation.is_manual_override = 1
                                 THEN 1 ELSE excluded.is_manual_override END,
            interpretation_version = transaction_interpretation.interpretation_version + 1,
            derived_at = excluded.derived_at
        """,
        (
            result.transaction_id,
            result.category_code,
            result.source,
            result.rule_id,
            result.confidence,
            json.dumps(result.evidence, ensure_ascii=False),
            1 if manual else 0,
            now,
        ),
    )
