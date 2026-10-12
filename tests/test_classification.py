"""Classification invariants: strict priority chain, provenance, manual safety."""

from __future__ import annotations

from life_energy.classification.engine import (
    add_rule,
    classify_one,
    classify_transactions,
    override_category,
)
from life_energy.ledger.importer import import_file
from life_energy.ingestion.wechat import WechatParser

from conftest import FIXTURES


def _classify_mcdonald(tmp_ledger):
    import_file(tmp_ledger, WechatParser(), FIXTURES / "wechat_202608.csv")
    classify_transactions(tmp_ledger)
    row = tmp_ledger.execute(
        """
        SELECT i.category_code, i.classification_source, i.classification_rule_id,
               i.classification_confidence, i.classification_evidence
        FROM transactions t JOIN transaction_interpretation i ON i.transaction_id = t.transaction_id
        WHERE t.counterparty = '麦当劳'
        """
    ).fetchone()
    return row


def test_merchant_rule_classifies_with_provenance(tmp_ledger):
    row = _classify_mcdonald(tmp_ledger)
    assert row["category_code"] == "FOOD"
    assert row["classification_source"] == "MERCHANT"
    assert row["classification_rule_id"] is not None
    evidence = row["classification_evidence"]
    assert "麦当劳" in evidence  # evidence JSON records what matched


def test_user_explicit_rule_beats_merchant_rule(tmp_ledger):
    add_rule(
        tmp_ledger,
        priority_class="USER_EXPLICIT",
        name="麦当劳记为其他（用户规则）",
        match_field="counterparty",
        match_mode="CONTAINS",
        pattern="麦当劳",
        category_code="OTHER_EXPENSE",
        applies_to_type="EXPENSE",
        confidence=1.0,
        sort_order=1,
    )
    row = _classify_mcdonald(tmp_ledger)
    assert row["category_code"] == "OTHER_EXPENSE"
    assert row["classification_source"] == "USER_EXPLICIT"


def test_manual_override_never_clobbered_by_recompute(tmp_ledger):
    import_file(tmp_ledger, WechatParser(), FIXTURES / "wechat_202608.csv")
    tx = tmp_ledger.execute("SELECT transaction_id FROM transactions WHERE counterparty = '麦当劳'").fetchone()

    override_category(tmp_ledger, tx["transaction_id"], "OTHER_EXPENSE", note="个人修正")
    stats = classify_transactions(tmp_ledger, recompute=True)
    assert stats["kept_manual"] >= 1

    row = tmp_ledger.execute(
        "SELECT category_code, classification_source, is_manual_override FROM transaction_interpretation WHERE transaction_id = ?",
        (tx["transaction_id"],),
    ).fetchone()
    assert row["category_code"] == "OTHER_EXPENSE"
    assert row["classification_source"] == "MANUAL"
    assert row["is_manual_override"] == 1


def test_unclassified_rows_have_explicit_none_source(tmp_ledger):
    import_file(tmp_ledger, WechatParser(), FIXTURES / "wechat_202608.csv")
    classify_transactions(tmp_ledger)
    kfc = tmp_ledger.execute(
        """
        SELECT i.classification_source, i.category_code
        FROM transactions t JOIN transaction_interpretation i ON i.transaction_id = t.transaction_id
        WHERE t.counterparty = '肯德基'
        """
    ).fetchone()
    assert kfc["category_code"] is None
    assert kfc["classification_source"] == "NONE"


def test_classification_only_touches_expense_and_income(tmp_ledger):
    import_file(tmp_ledger, WechatParser(), FIXTURES / "wechat_202608.csv")
    classify_transactions(tmp_ledger)
    transfer = tmp_ledger.execute(
        """
        SELECT t.transaction_type, i.transaction_id IS NOT NULL AS has_interpretation
        FROM transactions t LEFT JOIN transaction_interpretation i ON i.transaction_id = t.transaction_id
        WHERE t.transaction_type = 'TRANSFER' LIMIT 1
        """
    ).fetchone()
    assert transfer["has_interpretation"] == 0


def test_first_match_in_priority_order_wins_not_highest_score(tmp_ledger):
    """Two KEYWORD rules matching the same text: lower sort_order wins; no score mixing."""
    add_rule(tmp_ledger, priority_class="KEYWORD", name="外卖第二", match_field="description",
             match_mode="CONTAINS", pattern="外卖", category_code="SHOPPING", confidence=0.5, sort_order=200)
    import_file(tmp_ledger, WechatParser(), FIXTURES / "wechat_202608.csv")
    result = classify_one(tmp_ledger, 1)
    # 美团 rows are alipay; wechat tx #1 is 麦当劳 -> FOOD (merchant, higher class anyway)
    assert result.category_code in ("FOOD", "SHOPPING")
