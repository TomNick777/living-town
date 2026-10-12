"""Import idempotency + raw evidence integrity."""

from __future__ import annotations

import json

from life_energy.ingestion.wechat import WechatParser
from life_energy.ledger.importer import file_sha256, import_file
from life_energy.ledger.queries import counts, unresolved_transactions

from conftest import FIXTURES


def test_same_file_imported_twice_is_noop(tmp_ledger):
    """Invariant: re-importing a bill file must not grow canonical transactions."""
    parser = WechatParser()
    first = import_file(tmp_ledger, parser, FIXTURES / "wechat_202608.csv")
    assert first.already_imported is False
    assert first.imported == 8  # 10 rows: 2 duplicates within the file

    second = import_file(tmp_ledger, parser, FIXTURES / "wechat_202608.csv")
    assert second.already_imported is True
    assert second.batch_id == first.batch_id
    assert counts(tmp_ledger)["transactions"] == 8


def test_modified_copy_with_same_rows_imports_zero_new(tmp_path, tmp_ledger):
    """Byte-different file (e.g. re-export) still dedups row by row."""
    original = (FIXTURES / "wechat_202608.csv").read_text(encoding="utf-8")
    modified = tmp_path / "wechat_modified.csv"
    modified.write_text(original.replace("测试用户", "测试用户2"), encoding="utf-8")
    assert file_sha256(modified) != file_sha256(FIXTURES / "wechat_202608.csv")

    import_file(tmp_ledger, WechatParser(), FIXTURES / "wechat_202608.csv")
    report = import_file(tmp_ledger, WechatParser(), modified)
    assert report.imported == 0
    assert report.duplicates == 10
    assert counts(tmp_ledger)["transactions"] == 8  # only the original import's rows


def test_raw_evidence_is_complete_and_untouched(tmp_ledger):
    import_file(tmp_ledger, WechatParser(), FIXTURES / "wechat_202608.csv")

    raws = tmp_ledger.execute("SELECT * FROM raw_records ORDER BY raw_record_id").fetchall()
    assert len(raws) == 10
    statuses = {row["status"] for row in raws}
    assert statuses == {"IMPORTED", "DUPLICATE"}
    duplicates = [row for row in raws if row["status"] == "DUPLICATE"]
    assert len(duplicates) == 2
    assert all(row["canonical_transaction_id"] is None for row in duplicates)

    # raw payload preserves the ORIGINAL columns verbatim
    payload = json.loads(raws[0]["raw_payload"])
    assert payload["交易时间"] == "2026-08-01 09:30:00"
    assert payload["金额(元)"] == "¥32.00"


def test_skip_rows_are_recorded_not_silent(tmp_ledger, alipay_gbk_file):
    from life_energy.ingestion.alipay import AlipayParser

    report = import_file(tmp_ledger, AlipayParser(), alipay_gbk_file)
    assert report.skipped == 1  # 交易关闭 row: no money ever moved
    skipped = tmp_ledger.execute(
        "SELECT * FROM raw_records WHERE status = 'SKIPPED'"
    ).fetchall()
    assert len(skipped) == 1
    assert "交易关闭" in skipped[0]["status_note"]


def test_cross_channel_month_shape(ledger):
    """The synthetic month contains every semantic kind we care about."""
    rows = ledger.execute(
        "SELECT transaction_type, direction, COUNT(*) AS n FROM transactions GROUP BY transaction_type, direction ORDER BY 1, 2"
    ).fetchall()
    shape = {(row["transaction_type"], row["direction"]): row["n"] for row in rows}
    assert shape[("INCOME", "INFLOW")] == 2          # salary x2
    assert shape[("EXPENSE", "OUTFLOW")] == 6        # wechat x4 + alipay x1 + bank 消费
    assert shape[("TRANSFER", "OUTFLOW")] == 3       # wechat x2 (one unpaired) + bank -> alipay top-up
    assert shape[("TRANSFER", "INFLOW")] == 2        # alipay top-up + wechat->alipay
    assert shape[("REFUND", "INFLOW")] == 3          # wechat full + alipay partial + bank orphan
    assert shape[("INVESTMENT", "OUTFLOW")] == 2     # 余额宝 + fund purchase
    assert shape[("UNKNOWN", "OUTFLOW")] == 1        # honest unknowns (wechat only; bank 消费 reads EXPENSE)


def test_unresolved_states_are_explicit(ledger):
    unresolved = unresolved_transactions(ledger)
    assert len(unresolved["unknown_type"]) == 1          # wechat 神秘服务 (bank 消费 rows type as EXPENSE now)
    assert len(unresolved["unattributed_account"]) == 0  # aliases + fallback covered everything
    assert len(unresolved["unclassified"]) == 2          # 肯德基 no rule on purpose + bank 消费 row
    assert len(unresolved["unpaired_transfer"]) == 1     # 88.00 with no counter leg
    assert len(unresolved["unresolved_refund"]) == 1     # bank orphan refund


def test_transactions_carry_account_and_batch_provenance(ledger):
    row = ledger.execute(
        """
        SELECT t.*, a.name AS account_name, b.source_type AS batch_source
        FROM transactions t
        LEFT JOIN accounts a ON a.account_id = t.source_account_id
        LEFT JOIN import_batches b ON b.batch_id = t.import_batch_id
        WHERE t.counterparty = '麦当劳'
        """
    ).fetchone()
    assert row is not None
    assert row["account_name"] == "微信零钱"
    assert row["batch_source"] == "wechat"
    assert row["raw_record_id"] is not None
