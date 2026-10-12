"""Channel-native column name mappings (absorbed from all-wallet-manager).

Parsers extract rows as dicts keyed by the ORIGINAL column names; the
normalizer maps them onto canonical fields through these tables so that
raw evidence always keeps its native shape.
"""

from __future__ import annotations

WECHAT_MAPPING = {
    "交易时间": "occurred_raw",
    "交易类型": "type_raw",
    "交易对方": "counterparty",
    "商品": "description",
    "收/支": "direction_raw",
    "金额(元)": "amount_raw",
    "支付方式": "payment_method",
    "当前状态": "status",
    "交易单号": "source_reference",
    "商户单号": "merchant_reference",
    "备注": "remark",
}

ALIPAY_MAPPING = {
    "交易时间": "occurred_raw",
    "交易分类": "type_raw",
    "交易对方": "counterparty",
    "对方账号": "counterparty_account",
    "商品说明": "description",
    "收/支": "direction_raw",
    "金额": "amount_raw",
    "收/付款方式": "payment_method",
    "交易状态": "status",
    "交易订单号": "source_reference",
    "商家订单号": "merchant_reference",
    "备注": "remark",
}

GENERIC_BANK_MAPPING = {
    "date": "occurred_raw",
    "description": "description",
    "amount": "amount_raw",  # signed
    "balance": "balance_raw",
}

# Real bank adapters (2025-01 ~ 2026-08 exports). Raw columns keep their
# native names; the mapping only renames. Composition rules (description
# joining, direction flags, merchant) live in normalize_bank. The normalized
# key vocabulary used across banks:
#   occurred_raw / posted_raw      movement time vs bank posting date
#   amount_raw                     signed unless direction_raw carries C/D-支/收
#   direction_raw                  explicit direction flag (C/D, 支/收)
#   balance_raw                    running balance (evidence only)
#   description / abstract_raw     native summary columns; joined for typing
#   counterparty / counterparty_account / merchant_raw
BOCOM_BANK_MAPPING = {
    "交易日期": "occurred_date_raw",
    "交易时间": "occurred_time_raw",
    "交易类型": "description",
    "借贷状态": "direction_raw",  # C / D
    "交易金额": "amount_raw",  # unsigned
    "余额": "balance_raw",
    "对方账号": "counterparty_account",
    "对方户名": "counterparty",
    "交易地点": "abstract_raw",
    "摘要": "abstract_raw2",
}

CIB_BANK_MAPPING = {
    "交易时间": "occurred_raw",  # "2026-08-14 10:47:47"
    "记账日期": "posted_raw",  # YYYYMMDD
    "摘要": "description",
    "支/收": "direction_raw",  # 支 / 收
    "交易金额": "amount_raw",  # signed
    "账户余额": "balance_raw",
    "交易用途": "abstract_raw",
    "对方户名": "counterparty",
    "对方账户/对方银行": "counterparty_account",
}

ICBC_BANK_MAPPING = {
    "交易日期": "occurred_raw",  # "2026-01-05 10:23:14"
    "账号": "account_number_raw",
    "摘要": "description",
    "收入/支出金额": "amount_raw",  # signed
    "余额": "balance_raw",
    "对方户名": "counterparty",
    "对方账号": "counterparty_account",
    "渠道": "abstract_raw",
}

CMB_BANK_MAPPING = {
    "记账日期": "occurred_raw",
    "货币": "currency_raw",
    "交易金额": "amount_raw",  # signed
    "联机余额": "balance_raw",
    "交易摘要": "description",
    "对手信息": "counterparty",
}

CCB_BANK_MAPPING = {
    "序号": "row_number_raw",
    "摘要": "description",
    "交易日期": "occurred_raw",  # YYYYMMDD
    "交易金额": "amount_raw",  # signed
    "账户余额": "balance_raw",
    "交易地点/附言": "abstract_raw",
    "对方账号": "counterparty_account",
    "对方户名": "counterparty",
}

BOC_BANK_MAPPING = {
    "记账日期": "occurred_date_raw",  # YYYY-MM-DD (记账时间 splits the clock)
    "记账时间": "occurred_time_raw",  # HH:MM:SS
    "金额": "amount_raw",  # signed
    "余额": "balance_raw",
    "交易名称": "description",  # 结息 / 转账支出 / 跨行转账 / 自助取款 / 网上快捷支付
    "渠道": "abstract_raw",  # 其他 / 手机银行 / 网上银行 / ATM / 银企对接
    "附言": "abstract_raw2",  # e.g. 缴费备注 or 支付宝 (wallet marker)
    "对方账户名": "counterparty",
    "对方卡号/账号": "counterparty_account",
}

GF_CREDIT_BANK_MAPPING = {
    "交易日期": "occurred_raw",  # 2026/08/23
    "入账日期": "posted_raw",
    "交易摘要": "description",  # "(消费)支付宝-杨荣泉" or empty
    "交易金额": "amount_raw",  # signed; + = spending, - = credit
    "交易货币": "currency_raw",
    "入账金额": "posted_amount_raw",
    "入账货币": "posted_currency_raw",
}

GF_DEBIT_BANK_MAPPING = {
    "交易时间": "occurred_raw",
    "币种": "currency_raw",
    "交易金额": "amount_raw",  # signed number cell
    "账户余额": "balance_raw",
    "对方姓名": "counterparty",
    "对方账号": "counterparty_account",
    "商户名称": "merchant_raw",
    "摘要": "description",
    "附言": "abstract_raw",
}

# Synthesized per-row identity (parsers embed the within-key ordinal; clearly
# underscore-prefixed so it never masquerades as a native column).
BANK_ROW_REFERENCE_MAPPING = {"_row_reference": "source_reference"}

MAPPINGS = {
    "wechat": WECHAT_MAPPING,
    "alipay": ALIPAY_MAPPING,
    "bank:generic_csv": GENERIC_BANK_MAPPING,
    "bank:bocom": {**BOCOM_BANK_MAPPING, **BANK_ROW_REFERENCE_MAPPING},
    "bank:cib": {**CIB_BANK_MAPPING, **BANK_ROW_REFERENCE_MAPPING},
    "bank:icbc": {**ICBC_BANK_MAPPING, **BANK_ROW_REFERENCE_MAPPING},
    "bank:cmb": {**CMB_BANK_MAPPING, **BANK_ROW_REFERENCE_MAPPING},
    "bank:ccb": {**CCB_BANK_MAPPING, **BANK_ROW_REFERENCE_MAPPING},
    "bank:boc": {**BOC_BANK_MAPPING, **BANK_ROW_REFERENCE_MAPPING},
    "bank:gf_credit": {**GF_CREDIT_BANK_MAPPING, **BANK_ROW_REFERENCE_MAPPING},
    "bank:gf_debit": {**GF_DEBIT_BANK_MAPPING, **BANK_ROW_REFERENCE_MAPPING},
}

# Raw column holding the payment method, per channel — used by attribution
# re-runs (accounts reattribute), which read raw evidence without re-parsing.
# Bank statements represent a single account per file (attribution comes from
# the --account fallback), so they carry no per-row payment method.
PAYMENT_METHOD_RAW_KEY = {
    "wechat": "支付方式",
    "alipay": "收/付款方式",
    "bank:generic_csv": None,
    **{name: None for name in (
        "bank:bocom", "bank:cib", "bank:icbc", "bank:cmb",
        "bank:ccb", "bank:gf_credit", "bank:gf_debit", "bank:boc",
    )},
}


def map_fields(raw_row: dict, source: str) -> dict:
    """Map a native row onto normalized field names; unmapped keys are ignored."""
    mapping = MAPPINGS.get(source, {})
    return {normalized: raw_row[native] for native, normalized in mapping.items() if native in raw_row}
