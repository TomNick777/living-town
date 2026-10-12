"""Channel enum mapping: channel-native type labels -> canonical transaction types.

Canonical types are the six fact-level types:
    INCOME / EXPENSE / TRANSFER / REFUND / INVESTMENT / UNKNOWN

Key correction vs all-wallet-manager: internal money movement (转账, 红包,
充值, 提现, 信用卡还款) maps to TRANSFER — never to income/expense. When a
channel label is unrecognized the result is UNKNOWN, not a guess.

Mappings absorbed from all-wallet-manager config/channel_enum_mappings.json
(commit 033b90b) and adapted to canonical semantics.
"""

from __future__ import annotations

from .amount import INFLOW, NEUTRAL, OUTFLOW

EXPENSE = "EXPENSE"
INCOME = "INCOME"
TRANSFER = "TRANSFER"
REFUND = "REFUND"
INVESTMENT = "INVESTMENT"
UNKNOWN = "UNKNOWN"

# ---------------------------------------------------------------- wechat

WECHAT_TYPE_MAP = {
    "商户消费": EXPENSE,
    "扫二维码付款": EXPENSE,
    "转账": TRANSFER,
    "转账-转出": TRANSFER,
    "转账-转入": TRANSFER,
    "微信红包": TRANSFER,
    "微信红包-发出": TRANSFER,
    "微信红包-领取": TRANSFER,
    "微信红包（单发）": TRANSFER,
    "微信红包（群红包）": TRANSFER,
    "群收款": TRANSFER,
    "二维码收款": TRANSFER,
    "信用卡还款": TRANSFER,  # repayment of own credit card: internal movement
    "充值": TRANSFER,  # top-up from bank card into wallet: internal movement
    "提现": TRANSFER,  # withdrawal from wallet into bank card: internal movement
    "零钱提现": TRANSFER,  # 2026 real exports label withdrawals this way
    "理财通买入": INVESTMENT,
    "零钱通存入": INVESTMENT,
    "零钱通转出": INVESTMENT,
    "消费-其他": EXPENSE,  # merchant-consumption variant seen in real exports
}

WECHAT_REFUND_MARKERS = ("退款",)
# Transaction rows that never completed: no money moved, safe to skip at import.
WECHAT_SKIP_STATUSES = ("交易关闭",)

# ---------------------------------------------------------------- alipay

# Alipay exports carry a 交易分类 label (not a strict type). Known flow labels
# map explicitly; unknown labels fall back to direction-based typing below.
ALIPAY_TYPE_MAP = {
    "转账": TRANSFER,
    "充值": TRANSFER,
    "提现": TRANSFER,
    "还款": TRANSFER,
    "花呗还款": TRANSFER,
    "余额宝": INVESTMENT,
    "余额宝-转入": INVESTMENT,
    "余额宝-转出": INVESTMENT,
    "基金": INVESTMENT,
    "投资理财": INVESTMENT,  # 2026-08 real exports label all fund moves this way
    "退款": REFUND,
}

ALIPAY_REFUND_MARKERS = ("退款",)
# Transaction rows that never completed: no money moved, safe to skip at import.
# 已关闭 (closed orders, seen on 充值缴费 auto-debits) behaves like 交易关闭.
ALIPAY_SKIP_STATUSES = ("交易关闭", "已关闭")
ALIPAY_CREDIT_MARKERS = ("花呗", "信用购")  # credit payment methods

# ---------------------------------------------------------------- bank

# Bank typing order: exact per-source maps (channel-native 摘要 vocabulary)
# → bracketed kind markers (广发信用卡) → keyword chain. Anything unmatched
# stays UNKNOWN — bank statements must not be guessed into income/expense.
#
# Keyword chain notes:
# - INVESTMENT keywords precede TRANSFER so 银证转账 types as investment, not
#   transfer.
# - Wallet markers (支付宝/财付通/微信) are deliberately NOT type keywords:
#   a bank row naming the wallet is usually the duplicate of a wallet-side
#   consumption (cross-channel dedup removes it); a leftover must stay
#   UNKNOWN (visible) instead of hiding as a neutral TRANSFER.
BANK_TYPE_KEYWORDS = [
    (REFUND, ("退款", "退货")),
    (INVESTMENT, ("银证", "证券", "基金", "理财", "朝朝宝", "贵金属", "养老金")),
    (TRANSFER, ("转账", "转入", "转出", "汇入", "汇出", "汇款", "提现", "充值",
                "还款", "余额宝", "云闪付", "取款", "兑出", "汇兑")),
    (INCOME, ("工资", "代发", "代付", "利息", "结息", "薪资", "报销")),
    (EXPENSE, ("消费", "手续费", "年费", "管理费", "缴费", "保险费", "违约金",
               "租购", "无卡支付", "POS消费")),
]

# CCB 摘要 is a closed vocabulary; map it exactly (falls through to keywords
# only for the two genuinely ambiguous labels).
CCB_TYPE_MAP = {
    "代理付款": INCOME,
    "挂账报销款": INCOME,
    "电子汇入": TRANSFER,
    "理财产品赎回": INVESTMENT,
    "理财产品申购": INVESTMENT,
    "基金上账": INVESTMENT,
    "利息存入": INCOME,
    "消费": EXPENSE,
    "消费退货": REFUND,
    "退款": REFUND,
    "转账支取": TRANSFER,
    "跨行转出": TRANSFER,
    "充值": TRANSFER,
    "支付机构提现": TRANSFER,
    "刷脸取款": TRANSFER,
    "汇兑": TRANSFER,
    "普通汇兑": TRANSFER,
    "数字人民币兑出": TRANSFER,
    "跨行POS消费": EXPENSE,
    "缴费": EXPENSE,
    "银联无卡支付": EXPENSE,
    "保险费（跨行）": EXPENSE,
    "无卡自助交易": None,  # direction + 附言 decides (还款 → TRANSFER, else UNKNOWN)
    "代收付": UNKNOWN,
    "其他款项": UNKNOWN,
}

# 广发信用卡 交易摘要 bracketed kind markers. Sign carries direction
# (+ = spending/debt up, - = credit); (还原) is a clawed-back reward —
# mirror of (赠送), typed as expense so the pair nets to zero.
GF_CREDIT_TYPE_MARKERS = (
    ("(退款)", REFUND),
    ("(退货)", REFUND),
    ("(还款)", TRANSFER),
    ("(消费)", EXPENSE),
    ("(分期)", EXPENSE),
    ("(还原)", EXPENSE),
    ("(费用)", EXPENSE),
    ("(赠送)", INCOME),
)

# ------------------------------------------------- structural direction overrides
# Channels declare 充值/提现/理财 moves as 不计收支 ("neither income nor
# expense") — true for cash-flow semantics but wrong for movement semantics:
# top-up money DOES enter the wallet account. When the channel direction is
# NEUTRAL and the flow type is structural, derive the honest direction from
# the flow itself. Explicit 支出/收入 declarations are always respected.
WECHAT_DIRECTION_OVERRIDES = {
    "充值": INFLOW,
    "提现": OUTFLOW,
    "零钱提现": OUTFLOW,
    "信用卡还款": OUTFLOW,
    "理财通买入": OUTFLOW,
    "零钱通存入": OUTFLOW,
    "零钱通转出": INFLOW,
}

ALIPAY_DIRECTION_OVERRIDES = {
    "充值": INFLOW,
    "提现": OUTFLOW,
    "余额宝": OUTFLOW,
    "余额宝-转入": OUTFLOW,
    "余额宝-转出": INFLOW,
    "基金": OUTFLOW,
}

# 2026 real exports: every fund move is labelled 投资理财, direction declared
# 不计收支. The description tells which way the money went. Deterministic
# keyword split — fund-to-fund conversions never touch the cash system and
# stay directionless (ENERGY_INVESTMENT_INTERNAL downstream); anything else
# unmatched stays NEUTRAL and surfaces as unknown.
ALIPAY_INVESTMENT_INTERNAL_MARKERS = ("转换", "转入成功", "确认成功退款")
ALIPAY_INVESTMENT_OUTFLOW_MARKERS = ("买入", "申购", "定投", "存入", "自动转入")
ALIPAY_INVESTMENT_INFLOW_MARKERS = ("收益发放", "赎回", "卖出", "分红", "取出", "到期")

# marker value for fund-to-fund conversions (no cash-system movement)
INVESTMENT_DIRECTION_INTERNAL = "INTERNAL"


def map_alipay_investment_direction(description: str) -> str:
    """投资理财 rows: 买入 -> OUTFLOW, 收益/赎回 -> INFLOW, 基金转换 -> INTERNAL, else NEUTRAL."""
    text = (description or "").strip()
    if any(marker in text for marker in ALIPAY_INVESTMENT_INTERNAL_MARKERS):
        return INVESTMENT_DIRECTION_INTERNAL
    if any(marker in text for marker in ALIPAY_INVESTMENT_OUTFLOW_MARKERS):
        return OUTFLOW
    if any(marker in text for marker in ALIPAY_INVESTMENT_INFLOW_MARKERS):
        return INFLOW
    return NEUTRAL

# ---------------------------------------------------------------- helpers


def map_wechat_type(type_raw: str, status: str = "") -> str:
    """WeChat 交易类型 -> canonical type. Refund markers win over the exact map."""
    text = (type_raw or "").strip()
    if any(marker in text for marker in WECHAT_REFUND_MARKERS):
        return REFUND
    return WECHAT_TYPE_MAP.get(text, UNKNOWN)


def map_alipay_type(type_raw: str, status: str = "", direction: str = NEUTRAL) -> str:
    """Alipay 交易分类/交易状态 -> canonical type, direction as final fallback."""
    text = (type_raw or "").strip()
    status_text = (status or "").strip()
    if any(marker in text for marker in ALIPAY_REFUND_MARKERS) or "退款" in status_text:
        return REFUND
    mapped = ALIPAY_TYPE_MAP.get(text)
    if mapped:
        return mapped
    if direction == OUTFLOW:
        return EXPENSE
    if direction == INFLOW:
        return INCOME
    return UNKNOWN


def map_bank_type(description: str, source: str = "", direction: str = "", counterparty: str = "") -> str:
    """Bank 摘要 (+counterparty) -> canonical type: exact maps, GF markers, keyword chain.

    The counterparty joins the text because fund-company / employer names live
    only there on several statements (天天基金, 嘉实基金, 代发单位).
    """
    text = " ".join(part for part in (description or "").split() if part)
    if source == "bank:ccb":
        exact = CCB_TYPE_MAP.get(text)
        if exact is not None:
            return exact
        if "还款" in text:
            return TRANSFER
        if "退款" in text or "退货" in text:
            return REFUND
    if source == "bank:gf_credit":
        for marker, mapped in GF_CREDIT_TYPE_MARKERS:
            if text.startswith(marker):
                return mapped
        if not text:
            # No summary at all: the sign alone says spend (outflow) or credit back.
            return EXPENSE if direction == OUTFLOW else REFUND
        return UNKNOWN
    haystack = f"{text} {(counterparty or '').strip()}".strip()
    for transaction_type, keywords in BANK_TYPE_KEYWORDS:
        if any(keyword in haystack for keyword in keywords):
            return transaction_type
    return UNKNOWN


def is_credit_payment_method(payment_method: str, channel: str) -> bool:
    text = (payment_method or "").strip()
    if channel == "alipay":
        return any(marker in text for marker in ALIPAY_CREDIT_MARKERS)
    if channel == "wechat":
        return "分付" in text
    return False
