"""Manual energy override: human-confirmed readings, never auto-clobbered."""

from __future__ import annotations

from life_energy.energy.interpret import override_energy_type, refresh_energy_interpretations
from life_energy.energy.model import classify_energy, load_energy_rows, summarize_period
from life_energy.ledger.importer import import_file
from life_energy.ledger.queries import month_bounds
from life_energy.ingestion.wechat import WechatParser

from conftest import ensure_account, add_alias, make_wechat_csv


def _ledger_with_incoming_transfer(tmp_path, tmp_ledger):
    """Someone wechat-transfers ¥10 to the user: channel says TRANSFER inflow."""
    account = ensure_account(tmp_ledger, "微信零钱")
    add_alias(tmp_ledger, "wechat", "零钱", account)
    csv = make_wechat_csv(
        tmp_path / "w.csv",
        [
            "2026-08-01 09:00:00,商户消费,某便利店,饮料,支出,¥5.00,零钱,支付成功,WX1,",
            "2026-08-02 12:00:00,转账,某朋友,转账备注:微信转账,收入,¥10.00,/,已存入零钱,WX2,",
        ],
    )
    import_file(tmp_ledger, WechatParser(), csv)
    return tmp_ledger


def test_incoming_transfer_is_unpaired_by_default(tmp_path, tmp_ledger):
    ledger = _ledger_with_incoming_transfer(tmp_path, tmp_ledger)
    start, end = month_bounds("2026-08")
    summary = summarize_period(ledger, start, end)

    # Conservative default: incoming transfer stays TRANSFER; without a counter
    # leg it surfaces as unreconciled instead of being booked as income.
    assert summary.transfer_net_minor == 1_000
    assert summary.unreconciled_minor == 1_000
    assert summary.input_minor == 0
    assert summary.balanced is False


def test_manual_override_marks_external_income(tmp_path, tmp_ledger):
    ledger = _ledger_with_incoming_transfer(tmp_path, tmp_ledger)
    tx = ledger.execute(
        "SELECT transaction_id FROM transactions WHERE transaction_type = 'TRANSFER' AND direction = 'INFLOW'"
    ).fetchone()

    override_energy_type(ledger, tx["transaction_id"], "ENERGY_INPUT", note="确认是外部往来收入")

    # Materialization must not clobber the manual reading.
    stats = refresh_energy_interpretations(ledger)
    assert stats["kept_manual"] == 1

    start, end = month_bounds("2026-08")
    summary = summarize_period(ledger, start, end)
    assert summary.input_minor == 1_000
    assert summary.transfer_net_minor == 0
    assert summary.unreconciled_minor == 0
    assert summary.balanced is True

    row = ledger.execute(
        "SELECT energy_type, energy_derived_from FROM transaction_interpretation WHERE transaction_id = ?",
        (tx["transaction_id"],),
    ).fetchone()
    assert row["energy_type"] == "ENERGY_INPUT"
    assert "manual_override" in row["energy_derived_from"]


def test_override_rejects_unknown_energy_type(tmp_ledger):
    try:
        override_energy_type(tmp_ledger, 1, "ENERGY_MAGIC")
    except ValueError:
        pass
    else:
        raise AssertionError("expected ValueError for unknown energy type")


def test_neutral_investment_reads_as_unknown(tmp_path, tmp_ledger):
    """An investment row without direction evidence must surface, not guess."""
    from life_energy.normalization.normalizer import normalize_row

    rows = [{"transaction_id": 1, "transaction_type": "INVESTMENT", "direction": "NEUTRAL",
             "amount_minor": 100, "occurred_at": "x", "counterparty": None, "description": "某基金-巨额赎回确认",
             "source": "alipay", "account_name": None, "account_type": None,
             "transfer_pair_status": None, "refund_link_status": None,
             "investment_attribution": None, "category_code": None, "is_manual_override": None,
             "override_energy_type": None}]
    enriched = classify_energy(rows)
    assert enriched[0]["energy_type"] == "ENERGY_UNKNOWN"
