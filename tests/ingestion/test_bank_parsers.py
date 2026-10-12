"""Real-bank adapter tests: pure parsing cores + normalization semantics.

All inputs are synthetic rows shaped like the 2025-01 ~ 2026-08 real exports
(documented in docs/real-format-compatibility-202608.md). Real bills never
enter this repository.
"""

from __future__ import annotations

from datetime import datetime

from life_energy.normalization.normalizer import normalize_row


# ------------------------------------------------------------- 招行 (word rebuild)

def _cmb_word(text, x0, top):
    return {"text": text, "x0": x0, "x1": x0 + len(text) * 5, "top": top}


def test_cmb_rows_rebuilt_from_word_coordinates():
    from life_energy.ingestion.bank.cmb import rows_from_words

    words = [
        # page header noise (above the horizon)
        _cmb_word("记账日期", 36.0, 10.0),
        _cmb_word("1/20", 300.0, 12.0),
        # row 1: counterparty wraps ABOVE the date anchor, continuation BELOW
        _cmb_word("待清算电子汇差-代销理财快赎", 417.6, 287.5),
        _cmb_word("2025-01-02", 36.0, 293.5),
        _cmb_word("CNY", 98.7, 293.5),
        _cmb_word("600.00", 156.3, 293.5),
        _cmb_word("600.00", 234.7, 293.5),
        _cmb_word("朝朝宝转出", 307.9, 293.5),
        _cmb_word("投资", 417.6, 299.5),
        # row 2, identical date+amount+balance to row 1: multiplicity must survive
        _cmb_word("待清算电子汇差-代销理财快赎", 417.6, 314.5),
        _cmb_word("2025-01-02", 36.0, 320.5),
        _cmb_word("CNY", 98.7, 320.5),
        _cmb_word("600.00", 156.3, 320.5),
        _cmb_word("600.00", 234.7, 320.5),
        _cmb_word("朝朝宝转出", 307.9, 320.5),
        _cmb_word("投资", 417.6, 326.5),
    ]
    rows = rows_from_words(words)
    assert len(rows) == 2
    first, second = rows
    assert first["date"] == "2025-01-02" and first["amount"] == "600.00"
    assert first["summary"] == "朝朝宝转出"
    assert first["counterparty"] == "待清算电子汇差-代销理财快赎投资"
    assert second["counterparty"] == first["counterparty"]


def test_cmb_ignores_non_amount_noise_in_money_columns():
    from life_energy.ingestion.bank.cmb import rows_from_words

    words = [
        _cmb_word("2025-01-02", 36.0, 50.0),
        _cmb_word("CNY", 98.7, 50.0),
        _cmb_word("600.00", 156.3, 50.0),
        _cmb_word("--", 234.7, 50.0),  # not an amount: dropped
        _cmb_word("朝朝宝转出", 307.9, 50.0),
    ]
    rows = rows_from_words(words)
    assert len(rows) == 1 and rows[0]["balance"] == ""


# ------------------------------------------------------------- 建行 (.xls rows)

class FakeCell:
    def __init__(self, ctype, value):
        self.ctype = ctype
        self.value = value


class FakeSheet:
    """Just enough of an xlrd sheet: text cells (ctype 1) and blank (0)."""

    def __init__(self, grid):
        self.grid = grid
        self.nrows = len(grid)
        self.ncols = max(len(r) for r in grid)

    def cell(self, row, col):
        row_cells = self.grid[row]
        if col >= len(row_cells) or row_cells[col] is None:
            return FakeCell(0, "")
        return FakeCell(1, row_cells[col])


def test_ccb_rows_from_sheet_with_composite_counterparty():
    from life_energy.ingestion.bank.ccb import rows_from_sheet

    sheet = FakeSheet([
        ["", "", "", "中国建设银行个人活期账户全部交易明细", "", "", "", "", ""],
        ["序号", "摘要", "币别", "钞汇", "交易日期", "交易金额", "账户余额", "交易地点/附言", "对方账号与户名"],
        ["1", "跨行转出", "人民币元", "钞", "20250113", "-11,000.00", "231.92", "跨行转出", "6222620110070947271/林海斌"],
        ["2", "无卡自助交易", "人民币元", "钞", "20250113", "-9,073.47", "11,231.92", "招行信用卡还款（云闪付APP）", "0******5840/***还款"],
        ["", "", "", "", "", "", "", "", ""],  # blank row: skipped
    ])
    rows = rows_from_sheet(sheet)
    assert len(rows) == 2
    assert rows[0]["交易日期"] == "20250113"
    assert rows[0]["交易金额"] == "-11,000.00"
    assert rows[0]["对方账号"] == "6222620110070947271"
    assert rows[0]["对方户名"] == "林海斌"


# ------------------------------------------------------------- 广发信用卡 (lines)

def test_gf_credit_rows_from_lines_with_and_without_summary():
    from life_energy.ingestion.bank.gf_credit import rows_from_lines

    lines = [
        "信用卡账户信息",
        "2026/08/23 2026/08/23 (消费)支付宝-杨荣泉 11.27 人民币 11.27 人民币",
        "2026/08/22 2026/08/22 (退款)财付通-某公司 -22.43 人民币 -22.43 人民币",
        "2026/02/19 2026/02/19 -1,329.98 人民币 -1,329.98 人民币",  # no summary at all
        "2025/07/23 2025/07/23 (费用)年费 RMB: 480.00 480.00 人民币 480.00 人民币",
        "2026/08/21 2026/08/22 (消费)支付宝-刘金妹 238.30 人民币 238.30 人民币",
        "2026/08/21 2026/08/22 (消费)支付宝-刘金妹 238.30 人民币 238.30 人民币",  # true duplicate content
    ]
    rows = rows_from_lines(lines)
    assert len(rows) == 6
    assert rows[0]["交易摘要"] == "(消费)支付宝-杨荣泉"
    assert rows[2]["交易摘要"] == "" and rows[2]["交易金额"] == "-1,329.98"
    assert rows[3]["交易金额"] == "480.00"  # RMB: prefix tolerated
    assert rows[4] == rows[5]  # identical fields; the parser adds ordinals


# ------------------------------------------------------------- 广发储蓄卡 (xlsx)

def test_gf_debit_rows_from_worksheet(tmp_path):
    import openpyxl

    from life_energy.ingestion.bank.gf_debit import rows_from_worksheet

    book = openpyxl.Workbook()
    ws = book.active
    ws.append(["个人活期账户交易明细"])
    ws.append(["账号：6214623621003224434", None, "户名：测试\n", None, " ", " 起止日期：2025-06-16 至 2025-12-31"])
    ws.append(["交易时间", "币种", "交易金额", "账户余额", "对方姓名", "对方账号", "商户名称", "摘要", "附言"])
    ws.append([datetime(2025, 12, 31, 21, 42, 22), "人民币", -10.0, 5586.60, "测试对方", 11647908397, "财付通-扫二维码付款", "快捷支付", "扫二维码付款"])
    rows = rows_from_worksheet(ws)
    assert len(rows) == 1
    row = rows[0]
    assert row["交易时间"] == "2025-12-31 21:42:22"  # datetime -> native string
    assert row["交易金额"] == "-10.0"  # openpyxl float, digit-exact via repr
    assert row["对方账号"] == "11647908397"
    assert row["商户名称"] == "财付通-扫二维码付款"


# ------------------------------------------------------------- table adapters

def test_bocom_rows_from_tables():
    from life_energy.ingestion.bank.bocom import rows_from_tables

    tables = [[
        ["序号\nSerial", "交易日期\nTrans Date", "交易时间\nTrans Time", "交易类型\nTrading Type",
         "借贷状态\nDc Flg", "交易金额\nTrans Amt", "余额\nBalance", "对方账号", "对方户名", "交易地点", "摘要\nAbstract"],
        ["1", "2026-01-02", "02:49:01", "跨行汇款", "C", "5586.60", "5602.12", "6214623621003224434", "测试人", "支付平台", ""],
        ["", "", "", "", "", "", "", "", "", "", ""],  # empty row skipped
    ]]
    rows = rows_from_tables(tables)
    assert len(rows) == 1
    assert rows[0]["借贷状态"] == "C"
    assert rows[0]["交易金额"] == "5586.60"  # unsigned; direction comes from the flag


def test_cib_rows_from_tables():
    from life_energy.ingestion.bank.cib import rows_from_tables

    tables = [[
        ["交易时间\nTransaction\nTime", "记账日期\nAccounting\nDate", "摘要\nType", "支/收\nExpenditure\n/Income",
         "交易金额\nAmount", "账户余额\nBalance", "交易用途", "对方户名", "对方账户/对方银行"],
        ["2026-08-14\n10:47:47", "20260814", "汇款汇出", "支", "-3,769.58", "0.00", "转账", "测试人", "6217001820001363187\n中国建设银行"],
    ]]
    rows = rows_from_tables(tables)
    assert len(rows) == 1
    assert rows[0]["支/收"] == "支"
    assert rows[0]["对方账户/对方银行"].startswith("6217")


def test_icbc_rows_from_tables():
    from life_energy.ingestion.bank.icbc import rows_from_tables

    tables = [[
        ["交易日期", "账号", "储种", "序号", "币种", "钞汇", "摘要", "地区",
         "收入/支出金额", "余额", "对方户名", "对方账号", "渠道"],
        ["2026-01-05\n10:23:14", "1402225101106929192", "活期", "00000", "人民币", "钞", "银证", "1402",
         "+209.41", "253.39", "开源证券股份有限公司(客户)", "3700****5066", "其他"],
    ]]
    rows = rows_from_tables(tables)
    assert len(rows) == 1
    assert rows[0]["收入/支出金额"] == "+209.41"


# ------------------------------------------------------------- normalization

def test_bank_direction_flag_wins_over_unsigned_amount():
    row = {
        "交易日期": "2026-01-02", "交易时间": "02:49:01", "交易类型": "跨行汇款",
        "借贷状态": "C", "交易金额": "5586.60",
    }
    candidate = normalize_row(row, "bank:bocom")
    assert (candidate.amount_minor, candidate.direction) == (558_660, "INFLOW")
    assert candidate.occurred_at == "2026-01-02T02:49:01+08:00"


def test_cib_direction_flag_and_posted_date():
    row = {
        "交易时间": "2026-08-14 10:47:47", "记账日期": "20260814", "摘要": "汇款汇出",
        "支/收": "支", "交易金额": "-3,769.58", "账户余额": "0.00",
        "交易用途": "转账", "对方户名": "测试人", "对方账户/对方银行": "6217…",
    }
    candidate = normalize_row(row, "bank:cib")
    assert candidate.direction == "OUTFLOW"
    assert candidate.amount_minor == 376_958
    assert candidate.occurred_at == "2026-08-14T10:47:47+08:00"
    assert candidate.posted_at == "2026-08-14T00:00:00+08:00"
    assert candidate.description == "汇款汇出 转账"  # 摘要 + 交易用途 composed


def test_gf_credit_sign_convention_is_debt_positive():
    spending = {"交易日期": "2026/08/23", "入账日期": "2026/08/23", "交易摘要": "(消费)支付宝-测试", "交易金额": "11.27"}
    candidate = normalize_row(spending, "bank:gf_credit")
    assert (candidate.transaction_type, candidate.direction) == ("EXPENSE", "OUTFLOW")
    assert candidate.posted_at == "2026-08-23T00:00:00+08:00"

    rebate = {"交易日期": "2025/01/20", "入账日期": "2025/01/20", "交易摘要": "(赠送)广发返利金", "交易金额": "-20.00"}
    candidate = normalize_row(rebate, "bank:gf_credit")
    assert (candidate.transaction_type, candidate.direction) == ("INCOME", "INFLOW")

    clawback = {"交易日期": "2025/01/20", "入账日期": "2025/01/20", "交易摘要": "(还原)广发返利金退货扣回", "交易金额": "20.00"}
    candidate = normalize_row(clawback, "bank:gf_credit")
    assert (candidate.transaction_type, candidate.direction) == ("EXPENSE", "OUTFLOW")

    unmarked = {"交易日期": "2026/02/19", "入账日期": "2026/02/19", "交易摘要": "", "交易金额": "-1,329.98"}
    candidate = normalize_row(unmarked, "bank:gf_credit")
    assert (candidate.transaction_type, candidate.direction) == ("REFUND", "INFLOW")


def test_ccb_composed_description_types_repayment():
    row = {
        "序号": "3", "摘要": "无卡自助交易", "交易日期": "20250113", "交易金额": "-9,073.47",
        "账户余额": "11,231.92", "交易地点/附言": "招行信用卡还款（云闪付APP）",
        "对方账号": "0******5840", "对方户名": "***还款",
    }
    candidate = normalize_row(row, "bank:ccb")
    assert candidate.transaction_type == "TRANSFER"
    assert candidate.direction == "OUTFLOW"
    assert candidate.occurred_at == "2025-01-13T00:00:00+08:00"
    assert "还款" in candidate.description


def test_icbc_counterparty_joins_typing_for_fund_purchases():
    row = {
        "交易日期": "2026-01-05 10:27:08", "账号": "1402225101106929192", "储种": "活期",
        "序号": "00000", "币种": "人民币", "钞汇": "钞", "摘要": "天天 1052581902", "地区": "1001",
        "收入/支出金额": "-1,000.00", "余额": "43.98", "对方户名": "上海天天基金销售有限公司",
        "对方账号": "1001****9222", "渠道": "中间业务后台方式",
    }
    candidate = normalize_row(row, "bank:icbc")
    assert candidate.transaction_type == "INVESTMENT"  # fund company in counterparty


def test_bank_row_reference_keeps_identical_rows_distinct():
    keys = {"交易日期": "2026/08/21", "入账日期": "2026/08/21", "交易摘要": "(消费)支付宝-测试", "交易金额": "-238.30", "交易货币": "人民币", "入账金额": "-238.30", "入账货币": "人民币"}
    first = normalize_row({**keys, "_row_reference": "gf_credit:aaaa:1"}, "bank:gf_credit")
    second = normalize_row({**keys, "_row_reference": "gf_credit:aaaa:2"}, "bank:gf_credit")
    assert first.source_reference != second.source_reference
    # the fingerprint must NOT collapse genuinely distinct identical rows either
    assert first.canonical_fingerprint != second.canonical_fingerprint


# ------------------------------------------------------------- 中行 (encrypted table PDF)

def test_boc_rows_from_tables():
    from life_energy.ingestion.bank.boc import rows_from_tables

    tables = [[
        ["记账日期", "记账时间", "币别", "金额", "余额", "交易名称", "渠道",
         "网点名称", "附言", "对方账户名", "对方卡号/账号", "对方开户行"],
        ["2026-09-21", "02:05:32", "人民币", "0.10", "2,236.11", "结息", "其他",
         "-------------------", "----------", "-------------------", "-------------------", "-------------------"],
        ["2026-09-16", "17:16:07", "人民币", "-4,764.00", "2,236.01", "转账支出", "手机银行",
         "-------------------", "小一班,林楚皓,2026 年 秋季缴费", "福州市仓山区第一中心 幼儿园教育集团附属幼",
         "414387719843", "中国银行福州市仓山支行"],
        ["", "", "", "", "", "", "", "", "", "", "", ""],
    ]]
    rows = rows_from_tables(tables)
    assert len(rows) == 2
    interest, payment = rows
    assert interest["金额"] == "0.10" and interest["交易名称"] == "结息"
    assert payment["附言"].startswith("小一班")
    assert payment["对方卡号/账号"] == "414387719843"


def test_boc_signed_amount_and_time_merge():
    outflow = {
        "记账日期": "2026-09-16", "记账时间": "17:16:07", "币别": "人民币",
        "金额": "-4,764.00", "余额": "2,236.01", "交易名称": "转账支出", "渠道": "手机银行",
        "网点名称": "-------------------", "附言": "小一班,林楚皓,2026 年 秋季缴费",
        "对方账户名": "福州市仓山区第一中心 幼儿园教育集团附属幼", "对方卡号/账号": "414387719843",
    }
    candidate = normalize_row(outflow, "bank:boc")
    assert (candidate.amount_minor, candidate.direction) == (476_400, "OUTFLOW")
    assert candidate.occurred_at == "2026-09-16T17:16:07+08:00"
    assert candidate.posted_at is None  # no separate posting column
    assert candidate.description == "转账支出 手机银行 小一班,林楚皓,2026 年 秋季缴费"
    assert candidate.counterparty.startswith("福州市仓山区第一中心")
    assert candidate.transaction_type == "TRANSFER"  # 转账 keyword; 缴费 in 附言 keeps TRANSFER (first hit wins)

    interest = {
        "记账日期": "2026-09-21", "记账时间": "02:05:32", "币别": "人民币",
        "金额": "0.10", "余额": "2,236.11", "交易名称": "结息", "渠道": "其他",
    }
    candidate = normalize_row(interest, "bank:boc")
    assert (candidate.amount_minor, candidate.direction, candidate.transaction_type) == (10, "INFLOW", "INCOME")


def test_boc_wallet_marker_row_keeps_type_unknown_until_dedup():
    row = {
        "记账日期": "2025-02-09", "记账时间": "11:42:58", "币别": "人民币",
        "金额": "-171.99", "余额": "4.01", "交易名称": "网上快捷支付", "渠道": "银企对接",
        "附言": "支付宝", "对方账户名": "支付宝", "对方卡号/账号": "Z2007933000010N",
    }
    candidate = normalize_row(row, "bank:boc")
    # wallet-mediated purchase; the alipay-side fact is canonical, so the type
    # heuristic may stay honest-UNKNOWN — the cross-channel dedup consumes it.
    assert "支付宝" in candidate.description
    assert (candidate.amount_minor, candidate.direction) == (17_199, "OUTFLOW")
