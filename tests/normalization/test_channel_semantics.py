"""Channel semantics: internal movement stays TRANSFER, refunds stay REFUND."""

from __future__ import annotations

import pytest

from life_energy.normalization.normalizer import (
    CanonicalCandidate,
    NormalizeError,
    normalize_row,
)


def wechat_row(**overrides):
    row = {
        "交易时间": "2026-08-01 09:30:00",
        "交易类型": "商户消费",
        "交易对方": "麦当劳",
        "商品": "麦当劳（南京西路店）",
        "收/支": "支出",
        "金额(元)": "¥32.00",
        "支付方式": "零钱",
        "当前状态": "支付成功",
        "交易单号": " 4200000000000000001 ",
        "商户单号": "MSG1",
        "备注": "",
    }
    row.update(overrides)
    return row


def test_wechat_expense():
    candidate = normalize_row(wechat_row(), "wechat")
    assert candidate.transaction_type == "EXPENSE"
    assert candidate.direction == "OUTFLOW"
    assert candidate.amount_minor == 3200
    assert candidate.source_reference == "4200000000000000001"
    assert candidate.occurred_at == "2026-08-01T09:30:00+08:00"
    assert candidate.type_provenance == "channel_enum"


def test_wechat_refund_marker_wins():
    candidate = normalize_row(wechat_row(交易类型="商户消费-退款", **{"收/支": "收入"}), "wechat")
    assert candidate.transaction_type == "REFUND"
    assert candidate.direction == "INFLOW"
    assert "refund_marker" in candidate.type_provenance


@pytest.mark.parametrize(
    ("type_raw", "expected_type", "expected_direction"),
    [
        ("转账-转出", "TRANSFER", "OUTFLOW"),
        ("转账-转入", "TRANSFER", "INFLOW"),
        ("微信红包-发出", "TRANSFER", "OUTFLOW"),
        ("微信红包-领取", "TRANSFER", "INFLOW"),
        ("信用卡还款", "TRANSFER", "OUTFLOW"),
    ],
)
def test_wechat_internal_flows_are_transfer_never_income(type_raw, expected_type, expected_direction):
    """工资卡 -> 支付宝 ¥1000 must be TRANSFER, never INCOME (hard rule)."""
    overrides = {"交易类型": type_raw, "收/支": "收入" if expected_direction == "INFLOW" else "支出", "金额(元)": "¥1000.00"}
    candidate = normalize_row(wechat_row(**overrides), "wechat")
    assert candidate.transaction_type == expected_type
    assert candidate.direction == expected_direction
    assert candidate.amount_minor == 100000


def test_wechat_topup_neutral_declared_gets_structural_direction():
    """充值 declared 不计收支: money still entered the wallet -> INFLOW, with provenance."""
    candidate = normalize_row(wechat_row(交易类型="充值", **{"收/支": "不计收支", "金额(元)": "¥500.00"}), "wechat")
    assert candidate.transaction_type == "TRANSFER"
    assert candidate.direction == "INFLOW"
    assert "structural_direction_override" in candidate.type_provenance


def test_wechat_withdrawal_is_outflow_transfer():
    candidate = normalize_row(wechat_row(交易类型="提现", **{"收/支": "不计收支", "金额(元)": "¥300.00"}), "wechat")
    assert candidate.transaction_type == "TRANSFER"
    assert candidate.direction == "OUTFLOW"


def test_wechat_unknown_type_stays_unknown():
    candidate = normalize_row(wechat_row(交易类型="神秘服务"), "wechat")
    assert candidate.transaction_type == "UNKNOWN"
    assert candidate.direction == "OUTFLOW"


def test_wechat_closed_transaction_is_rejected_not_dropped_silently():
    with pytest.raises(NormalizeError, match="交易关闭"):
        normalize_row(wechat_row(当前状态="交易关闭"), "wechat")


def test_wechat_refunded_status_is_kept_as_evidence():
    """已退款 rows must survive: they are the expense side of a refund pair."""
    candidate = normalize_row(wechat_row(当前状态="已退款"), "wechat")
    assert candidate.transaction_type == "EXPENSE"
    assert candidate.status == "已退款"


def test_wechat_unknown_neutral_is_rejected():
    with pytest.raises(NormalizeError):
        normalize_row(wechat_row(交易类型="神秘服务", **{"收/支": "不计收支"}), "wechat")


def test_alipay_expense_and_type_fallback():
    row = {
        "交易时间": "2026/08/06 12:30",
        "交易分类": "餐饮美食",
        "交易对方": "美团",
        "对方账号": "***",
        "商品说明": "美团外卖订单",
        "收/支": "支出",
        "金额": "50.00",
        "收/付款方式": "余额",
        "交易状态": "交易成功",
        "交易订单号": "2026080612345001",
        "商家订单号": "",
        "备注": "",
    }
    candidate = normalize_row(row, "alipay")
    assert candidate.transaction_type == "EXPENSE"
    assert candidate.type_provenance == "direction_fallback"


def test_alipay_topup_from_bank_is_inflow_transfer():
    row = {
        "交易时间": "2026/08/05 09:05",
        "交易分类": "充值",
        "交易对方": "",
        "对方账号": "***",
        "商品说明": "充值-招商银行储蓄卡",
        "收/支": "不计收支",
        "金额": "1000.00",
        "收/付款方式": "招商银行储蓄卡(1234)",
        "交易状态": "交易成功",
        "交易订单号": "2026080509050003",
        "商家订单号": "",
        "备注": "",
    }
    candidate = normalize_row(row, "alipay")
    assert candidate.transaction_type == "TRANSFER"
    assert candidate.direction == "INFLOW"
    assert "structural_direction_override" in candidate.type_provenance


def test_alipay_yuebao_is_investment_outflow():
    row = {
        "交易时间": "2026/08/12 10:00",
        "交易分类": "余额宝-转入",
        "交易对方": "",
        "对方账号": "",
        "商品说明": "余额宝单次转入",
        "收/支": "不计收支",
        "金额": "3000.00",
        "收/付款方式": "余额",
        "交易状态": "交易成功",
        "交易订单号": "2026081210000005",
        "商家订单号": "",
        "备注": "",
    }
    candidate = normalize_row(row, "alipay")
    assert candidate.transaction_type == "INVESTMENT"
    assert candidate.direction == "OUTFLOW"


def test_alipay_credit_payment_method_detected():
    from life_energy.normalization.enums import is_credit_payment_method

    assert is_credit_payment_method("花呗", "alipay")
    assert not is_credit_payment_method("余额", "alipay")


def test_bank_signed_csv_row():
    row = {"date": "2026-08-01 09:00:00", "description": "代发工资 工资", "amount": "20000.00", "balance": "50000.00"}
    candidate = normalize_row(row, "bank:generic_csv")
    assert candidate.transaction_type == "INCOME"
    assert candidate.direction == "INFLOW"
    assert candidate.source_reference.startswith("bank:generic_csv:2026-08-01:")


def test_bank_transfer_keyword_is_transfer():
    row = {"date": "2026-08-05 09:00:00", "description": "转账 支付宝", "amount": "-1000.00"}
    candidate = normalize_row(row, "bank:generic_csv")
    assert candidate.transaction_type == "TRANSFER"
    assert candidate.direction == "OUTFLOW"


def test_bank_consumption_keyword_is_expense_and_unmatched_stays_unknown():
    # 消费 is deterministic channel semantics, not a guess...
    consumption = {"date": "2026-08-15 12:30:00", "description": "消费 未知商户", "amount": "-66.60"}
    assert normalize_row(consumption, "bank:generic_csv").transaction_type == "EXPENSE"
    # ...but a genuinely unplaceable bank description must stay UNKNOWN.
    mystery = {"date": "2026-08-15 12:30:00", "description": "神秘银行操作", "amount": "-66.60"}
    assert normalize_row(mystery, "bank:generic_csv").transaction_type == "UNKNOWN"


def test_synthetic_bank_reference_is_deterministic():
    row = {"date": "2026-08-05 09:00:00", "description": "转账 支付宝", "amount": "-1000.00"}
    first = normalize_row(row, "bank:generic_csv")
    second = normalize_row(row, "bank:generic_csv")
    assert first.source_reference == second.source_reference


def test_fingerprint_ignores_channel_reference():
    """Re-exports with a new synthetic id but identical semantics dedup via fingerprint."""
    base = normalize_row(wechat_row(), "wechat")
    altered = normalize_row(wechat_row(交易单号="9999999999999999999"), "wechat")
    assert base.source_reference != altered.source_reference
    assert base.canonical_fingerprint == altered.canonical_fingerprint


def test_fingerprint_changes_with_semantics():
    base = normalize_row(wechat_row(), "wechat")
    other_amount = normalize_row(wechat_row(**{"金额(元)": "¥33.00"}), "wechat")
    assert base.canonical_fingerprint != other_amount.canonical_fingerprint
