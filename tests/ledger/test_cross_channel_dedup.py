"""Cross-channel duplicate resolution: bank row ↔ wallet fact.

Scenario shaped like the real 2025-2026 data: a WeChat purchase paid with
广发银行信用卡(9807), plus the card statement row "(消费)支付宝-…" for the
same event. The wallet fact stays canonical; the bank row lands as
raw_records/DUPLICATE with a status_note pointing at it — energy counts the
consumption exactly once.
"""

from __future__ import annotations

from life_energy.accounts.service import add_alias, ensure_account
from life_energy.classification.seed import seed_all
from life_energy.db.connection import open_db
from life_energy.energy.model import summarize_period
from life_energy.ingestion.models import ParseResult, RawTransaction
from life_energy.ingestion.wechat import WechatParser
from life_energy.ledger.importer import import_file

from tests.conftest import make_wechat_csv

AUGUST = ("2026-08-01T00:00:00+08:00", "2026-09-01T00:00:00+08:00")


class StubBankParser:
    """Stand-in for the PDF parsers: same bank: channel, pre-parsed rows."""

    source = ""
    parser_name = "stub"
    parser_version = "stub/1"

    def __init__(self, source: str, rows: list[dict]):
        self.source = source
        self._rows = rows

    def parse(self, file_path) -> ParseResult:
        result = ParseResult(source=self.source, parser_name=self.parser_name, parser_version=self.parser_version)
        for index, fields in enumerate(self._rows):
            result.records.append(RawTransaction(source=self.source, row_index=index, raw_fields=fields))
        return result

    def get_channel(self) -> str:
        return self.source


def _stub_statement(tmp_path):
    statement = tmp_path / "statement.pdf"
    statement.write_bytes(b"%PDF-1.4 stub")  # never read by the stub parser
    return statement


def _gf_rows(summary="(消费)支付宝-滴滴出行", amount="12.90", day="2026/08/21", reference="gf:stub:r1"):
    return [{
        "交易日期": day, "入账日期": "2026/08/22", "交易摘要": summary,
        "交易金额": amount, "交易货币": "人民币", "入账金额": amount, "入账货币": "人民币",
        "_row_reference": reference,
    }]


def _wallet_bill(tmp_path):
    return make_wechat_csv(tmp_path / "wechat.csv", [
        "2026-08-21 12:00:00,商户消费,滴滴出行,订单付款,支出,12.90,广发银行信用卡(9807),支付成功,4200001234,merch1,/",
        "2026-08-21 18:00:00,商户消费,肯德基,订单付款,支出,30.00,广发银行信用卡(9807),支付成功,4200005678,merch2,/",
    ])


def _seed_credit_card(connection) -> int:
    seed_all(connection)
    card = ensure_account(connection, "广发银行信用卡(9807)", "CREDIT", institution="广发银行")
    add_alias(connection, "wechat", "广发银行信用卡(9807)", card)
    connection.commit()
    return card


def test_bank_duplicate_of_wallet_purchase_is_not_double_counted(tmp_path):
    with open_db(tmp_path / "ledger.db") as connection:
        card = _seed_credit_card(connection)
        assert import_file(connection, WechatParser(), _wallet_bill(tmp_path)).imported == 2

        report = import_file(
            connection,
            StubBankParser("bank:gf_credit", _gf_rows()),
            _stub_statement(tmp_path),
            fallback_account_id=card,
        )
        assert (report.imported, report.duplicates) == (0, 1)

        note = connection.execute(
            "SELECT status_note FROM raw_records WHERE status='DUPLICATE'"
        ).fetchone()["status_note"]
        assert "cross-channel duplicate of transaction" in note

        rows = connection.execute(
            "SELECT source FROM transactions WHERE transaction_type='EXPENSE' AND amount_minor=1290"
        ).fetchall()
        assert len(rows) == 1 and rows[0]["source"] == "wechat"

        summary = summarize_period(connection, *AUGUST)
        assert summary.consumption_minor == 1290 + 3000  # 12.90 counted once (wallet) + 30.00


def test_multiplicity_second_identical_bank_row_imports(tmp_path):
    with open_db(tmp_path / "ledger.db") as connection:
        card = _seed_credit_card(connection)
        import_file(connection, WechatParser(), _wallet_bill(tmp_path))

        rows = _gf_rows() + _gf_rows(day="2026/08/22", reference="gf:stub:r2")
        report = import_file(
            connection,
            StubBankParser("bank:gf_credit", rows),
            _stub_statement(tmp_path),
            fallback_account_id=card,
        )
        # first bank row → duplicate of the wallet fact; second (next day) → real fact
        assert (report.imported, report.duplicates) == (1, 1)


def test_bank_row_without_wallet_marker_imports_normally(tmp_path):
    with open_db(tmp_path / "ledger.db") as connection:
        card = _seed_credit_card(connection)
        import_file(connection, WechatParser(), _wallet_bill(tmp_path))

        report = import_file(
            connection,
            StubBankParser("bank:gf_credit", _gf_rows(summary="(消费)麦当劳", reference="gf:stub:r3")),
            _stub_statement(tmp_path),
            fallback_account_id=card,
        )
        assert (report.imported, report.duplicates) == (1, 0)  # no marker → no link, ever


def test_wallet_transfer_topup_matches_bank_leg_in_opposite_direction(tmp_path):
    """充值的钱包行方向是钱包视角（INFLOW），银行侧是 OUTFLOW——TRANSFER 类型
    允许反向配链，否则卡付费充值会被双算。"""
    with open_db(tmp_path / "ledger.db") as connection:
        card = _seed_credit_card(connection)
        bank_card = ensure_account(connection, "交通银行储蓄卡(7271)", "CASH", institution="交通银行")
        add_alias(connection, "wechat", "交通银行储蓄卡(7271)", bank_card)
        connection.commit()

        bill = make_wechat_csv(tmp_path / "wechat2.csv", [
            "2026-08-01 08:00:00,充值,/,零钱充值,不计收支,100.00,交通银行储蓄卡(7271),已入账,4200009999,merch9,/",
        ])
        import_file(connection, WechatParser(), bill)

        bank_rows = [{
            "交易日期": "2026-08-01", "交易时间": "08:00:05", "交易类型": "网上支付",
            "借贷状态": "D", "交易金额": "100.00", "余额": "4900.00",
            "对方账号": "1000050201", "对方户名": "微信转账", "交易地点": "财付通支付科技有限公司",
            "摘要": "网上支付 充值 订单编号123", "_row_reference": "bocom:stub:1",
        }]
        report = import_file(
            connection,
            StubBankParser("bank:bocom", bank_rows),
            _stub_statement(tmp_path),
            fallback_account_id=bank_card,
        )
        assert (report.imported, report.duplicates) == (0, 1)
