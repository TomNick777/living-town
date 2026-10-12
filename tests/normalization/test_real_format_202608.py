"""Regression tests for quirks found in real 2026-08 exports.

Every row here is SYNTHETIC — it replicates *format* characteristics of real
exports (dashed timestamps, trailing-comma headers, tab-suffixed order ids,
invest-ment category labels) without carrying any real personal data.
"""

from __future__ import annotations

import pytest

from life_energy.normalization.normalizer import NormalizeError, normalize_row


def alipay_row(**overrides):
    row = {
        "交易时间": "2026-08-31 11:55:56",  # 2026 exports: dashed with seconds
        "交易分类": "餐饮美食",
        "交易对方": "某快餐店",
        "对方账号": "/",
        "商品说明": "快餐",
        "收/支": "支出",
        "金额": "16.80",
        "收/付款方式": "某银行信用卡(9807)",
        "交易状态": "交易成功",
        "交易订单号": "20260831230014095\t",  # real exports carry trailing tabs
        "商家订单号": "20260831230014095\t",
        "备注": "",
    }
    row.update(overrides)
    return row


def test_alipay_dashed_timestamp_with_seconds():
    candidate = normalize_row(alipay_row(), "alipay")
    assert candidate.occurred_at == "2026-08-31T11:55:56+08:00"


def test_alipay_order_number_tab_stripped():
    candidate = normalize_row(alipay_row(), "alipay")
    assert "\t" not in candidate.source_reference
    assert candidate.source_reference == "20260831230014095"


def test_alipay_invest_category_buy_is_outflow_investment():
    candidate = normalize_row(
        alipay_row(
            交易分类="投资理财",
            **{
                "收/支": "不计收支",
                "金额": "2259.42",
                "收/付款方式": "余额宝",
                "商品说明": "蚂蚁财富-某某科创50联接C-买入",
            },
        ),
        "alipay",
    )
    assert candidate.transaction_type == "INVESTMENT"
    assert candidate.direction == "OUTFLOW"
    assert "investment_direction_heuristic" in candidate.type_provenance


def test_alipay_invest_category_yield_is_inflow_investment():
    candidate = normalize_row(
        alipay_row(
            交易分类="投资理财",
            **{
                "收/支": "不计收支",
                "金额": "0.05",
                "收/付款方式": "余额宝",
                "商品说明": "余额宝-2026.08.15-收益发放",
            },
        ),
        "alipay",
    )
    assert candidate.transaction_type == "INVESTMENT"
    assert candidate.direction == "INFLOW"


def test_alipay_invest_without_direction_markers_stays_neutral():
    candidate = normalize_row(
        alipay_row(
            交易分类="投资理财",
            **{"收/支": "不计收支", "商品说明": "某某基金-账户资料维护", "收/付款方式": "余额宝"},
        ),
        "alipay",
    )
    assert candidate.transaction_type == "INVESTMENT"
    assert candidate.direction == "NEUTRAL"
    assert "investment_internal" not in candidate.type_provenance


def test_alipay_fund_conversion_is_internal_investment():
    """Fund-to-fund conversions never touch the cash system: directionless,
    then ENERGY_INVESTMENT_INTERNAL (no export/import, no unreconciled)."""
    candidate = normalize_row(
        alipay_row(
            交易分类="投资理财",
            **{
                "收/支": "不计收支",
                "金额": "12009.93",
                "收/付款方式": "",
                "商品说明": "蚂蚁财富-易方达恒生科技ETF联接(QDII)C-「转换至」-永赢数字经济智选混合A-转入成功",
            },
        ),
        "alipay",
    )
    assert candidate.transaction_type == "INVESTMENT"
    assert candidate.direction == "NEUTRAL"
    assert "investment_internal" in candidate.type_provenance

    from life_energy.energy.model import energy_type_for

    energy_type, provenance = energy_type_for(
        {
            "transaction_type": "INVESTMENT",
            "direction": "NEUTRAL",
            "description": candidate.description,
            "account_name": None,
            "account_type": None,
        },
        None,
        None,
    )
    assert energy_type == "ENERGY_INVESTMENT_INTERNAL"
    assert "no cash-system impact" in provenance["note"]


def test_wechat_lingqian_tixian_is_outflow_transfer():
    """2026 real exports: 零钱提现 with 收/支='/' — a withdrawal to bank card."""
    row = {
        "交易时间": "2026-03-05 10:00:00",
        "交易类型": "零钱提现",
        "交易对方": "/",
        "商品": "零钱提现",
        "收/支": "/",
        "金额(元)": "500.00",
        "支付方式": "/",
        "当前状态": "提现已到账",
        "交易单号": "5000000000000000001",
        "商户单号": "",
        "备注": "/",
    }
    candidate = normalize_row(row, "wechat")
    assert candidate.transaction_type == "TRANSFER"
    assert candidate.direction == "OUTFLOW"
    assert "structural_direction_override" in candidate.type_provenance


def test_wechat_consumption_other_variant_is_expense():
    row = {
        "交易时间": "2026-03-06 10:00:00",
        "交易类型": "消费-其他",
        "交易对方": "某商户",
        "商品": "商品",
        "收/支": "支出",
        "金额(元)": "10.00",
        "支付方式": "零钱",
        "当前状态": "支付成功",
        "交易单号": "5000000000000000002",
        "商户单号": "",
        "备注": "/",
    }
    candidate = normalize_row(row, "wechat")
    assert candidate.transaction_type == "EXPENSE"
    assert candidate.direction == "OUTFLOW"


def test_alipay_utility_bill_payment_is_expense():
    """充值缴费 declared 支出 is a real life expense, not a top-up."""
    candidate = normalize_row(
        alipay_row(交易分类="充值缴费", 商品说明="电费自动缴费", **{"收/付款方式": "某银行信用卡(9807)&红包"}),
        "alipay",
    )
    assert candidate.transaction_type == "EXPENSE"
    assert candidate.direction == "OUTFLOW"


def test_wechat_plain_amount_without_yen_symbol():
    """Real 2026 exports: amounts like '39.9' with no currency prefix."""
    row = {
        "交易时间": "2026-08-31 14:52:25",
        "交易类型": "商户消费",
        "交易对方": "某商户",
        "商品": "先用后付",
        "收/支": "支出",
        "金额(元)": "39.9",
        "支付方式": "某银行信用卡(9807)",
        "当前状态": "支付成功",
        "交易单号": "4200003158202608314125195931",
        "商户单号": "XnnB58wUpIo09E1",
        "备注": "/",
    }
    candidate = normalize_row(row, "wechat")
    assert candidate.amount_minor == 3990
    assert candidate.transaction_type == "EXPENSE"


def test_wechat_neutral_transactions_note_is_kept():
    """2026 exports declare 充值/提现/理财通 as 中性交易 — still investment facts."""
    row = {
        "交易时间": "2026-08-20 10:00:00",
        "交易类型": "零钱通存入",
        "交易对方": "/",
        "商品": "零钱通存入",
        "收/支": "中性交易",
        "金额(元)": "100.00",
        "支付方式": "零钱",
        "当前状态": "支付成功",
        "交易单号": "4500000000000000001",
        "商户单号": "",
        "备注": "/",
    }
    candidate = normalize_row(row, "wechat")
    assert candidate.transaction_type == "INVESTMENT"
    # 中性交易 is not a recognized direction word -> NEUTRAL declared, then the
    # structural override derives the honest direction (money left 零钱).
    assert candidate.direction == "OUTFLOW"
    assert "structural_direction_override" in candidate.type_provenance


def test_alipay_closed_auto_debit_is_rejected():
    """2026-01-07 exports: 已关闭 status on 充值缴费 auto-debit orders — no money moved."""
    with pytest.raises(NormalizeError, match="已关闭"):
        normalize_row(
            alipay_row(
                交易分类="充值缴费",
                **{"收/支": "不计收支", "金额": "818.00", "交易状态": "已关闭"},
            ),
            "alipay",
        )


def test_alipay_auto_sweep_into_yuebao_is_outflow():
    """余额宝-自动转入 sweeps cash from the wallet into the fund: EXPORT, not unknown."""
    candidate = normalize_row(
        alipay_row(
            交易分类="投资理财",
            **{"收/支": "不计收支", "金额": "88.72", "收/付款方式": "",
               "商品说明": "余额宝-自动转入"},
        ),
        "alipay",
    )
    assert candidate.transaction_type == "INVESTMENT"
    assert candidate.direction == "OUTFLOW"
