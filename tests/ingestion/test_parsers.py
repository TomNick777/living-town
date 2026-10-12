"""Parsers extract faithfully: preamble skipping, encodings, evidence kept."""

from __future__ import annotations

from pathlib import Path

from life_energy.ingestion.alipay import AlipayParser
from life_energy.ingestion.bank.generic_csv import GenericCSVBankParser
from life_energy.ingestion.wechat import WechatParser

from conftest import FIXTURES


def test_wechat_parser_reads_fixture():
    result = WechatParser().parse(FIXTURES / "wechat_202608.csv")
    assert result.errors == []
    assert len(result.records) == 10  # all data rows carry a 交易单号, incl. duplicates
    first = result.records[0]
    assert first.source == "wechat"
    assert first.row_identity == "4200000000000000001"
    # raw evidence keeps the original column names
    assert "交易单号" in first.raw_fields
    assert first.raw_fields["交易时间"] == "2026-08-01 09:30:00"
    # refunded expense rows are evidence and must be kept
    statuses = [rec.raw_fields.get("当前状态") for rec in result.records]
    assert "已退款" in statuses


def test_wechat_parser_xlsx(tmp_path):
    import openpyxl

    path = tmp_path / "wechat.xlsx"
    workbook = openpyxl.Workbook()
    sheet = workbook.active
    rows = [
        ("微信支付账单明细",),
        ("------ 以下是账单明细 ------",),
        ("交易时间", "交易类型", "交易对方", "商品", "收/支", "金额(元)", "支付方式", "当前状态", "交易单号", "商户单号", "备注"),
        ("2026-08-01 09:30:00", "商户消费", "麦当劳", "套餐", "支出", "¥32.00", "零钱", "支付成功", "4200X1", "M1", ""),
    ]
    for row in rows:
        sheet.append(row)
    workbook.save(path)

    result = WechatParser().parse(path)
    assert result.errors == []
    assert len(result.records) == 1
    assert result.records[0].raw_fields["交易单号"] == "4200X1"


def test_alipay_parser_reads_gbk(tmp_path):
    """Real exports are GBK; the committed UTF-8 source is re-encoded for this test."""
    source = (FIXTURES / "alipay_202608_source.csv").read_text(encoding="utf-8")
    gbk_path = tmp_path / "alipay.csv"
    gbk_path.write_bytes(source.encode("gbk"))

    result = AlipayParser().parse(gbk_path)
    assert result.errors == []
    assert len(result.records) == 9
    assert result.records[0].raw_fields["交易订单号"] == "2026080612345001"


def test_bank_generic_parser():
    result = GenericCSVBankParser().parse(FIXTURES / "bank_generic_202608.csv")
    assert result.errors == []
    assert len(result.records) == 5
    assert result.records[1].raw_fields["amount"] == "-1000.00"


def test_parser_rejects_garbage_file(tmp_path):
    bad = tmp_path / "random.csv"
    bad.write_text("col_a,col_b\n1,2\n", encoding="utf-8")
    result = WechatParser().parse(bad)
    assert result.records == []
    assert result.errors and "header" in result.errors[0]


def test_bank_adapter_registry():
    # registration is an import side effect; import every adapter explicitly
    # so the assertion never depends on which other test module ran first
    import life_energy.ingestion.bank.bocom  # noqa: F401
    import life_energy.ingestion.bank.boc  # noqa: F401
    import life_energy.ingestion.bank.cib  # noqa: F401
    import life_energy.ingestion.bank.icbc  # noqa: F401
    import life_energy.ingestion.bank.cmb  # noqa: F401
    import life_energy.ingestion.bank.ccb  # noqa: F401
    import life_energy.ingestion.bank.gf_credit  # noqa: F401
    import life_energy.ingestion.bank.gf_debit  # noqa: F401
    from life_energy.ingestion.bank import BANK_PARSERS, get_bank_parser

    parser = get_bank_parser("bank:generic_csv")
    assert parser.get_channel() == "bank:generic_csv"

    import pytest

    # the 2025-2026 real-bank adapters register alongside the generic one
    assert get_bank_parser("bank:ccb").get_channel() == "bank:ccb"
    assert get_bank_parser("bank:gf_credit").get_channel() == "bank:gf_credit"
    assert get_bank_parser("bank:boc").get_channel() == "bank:boc"
    assert len(BANK_PARSERS) == 9  # generic + bocom/boc/cib/icbc/cmb/ccb/gf_credit/gf_debit

    with pytest.raises(KeyError):
        get_bank_parser("bank:does_not_exist")


def test_original_file_is_never_modified():
    """Importing reads evidence but must not touch the original bill."""
    from life_energy.db.connection import connect
    from life_energy.db.migrations import migrate
    from life_energy.ledger.importer import import_file

    source = FIXTURES / "wechat_202608.csv"
    before = source.read_bytes()

    db = Path(" nowhere ")  # placeholder to keep imports honest
    del db
    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        conn = connect(Path(tmp) / "ledger.db")
        migrate(conn)
        import_file(conn, WechatParser(), source)
        conn.close()

    assert source.read_bytes() == before
