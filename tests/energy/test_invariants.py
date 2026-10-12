"""Core scenario invariants on clean mini-ledgers (fully balanced by design)."""

from __future__ import annotations

from life_energy.accounts.service import add_alias, ensure_account
from life_energy.energy.model import summarize_period
from life_energy.ingestion.bank.generic_csv import GenericCSVBankParser
from life_energy.ingestion.wechat import WechatParser
from life_energy.ledger.importer import import_file
from life_energy.ledger.queries import month_bounds
from life_energy.reconciliation.refund_pairing import suggest_refunds
from life_energy.reconciliation.transfer_pairing import suggest_transfers

from conftest import make_bank_csv, make_wechat_csv


def _prepared_ledger(tmp_ledger):
    wechat_cash = ensure_account(tmp_ledger, "微信零钱")
    bank = ensure_account(tmp_ledger, "招商银行(1234)")
    add_alias(tmp_ledger, "wechat", "零钱", wechat_cash)
    return wechat_cash, bank


def _summarize(tmp_ledger, month="2026-08"):
    start, end = month_bounds(month)
    return summarize_period(tmp_ledger, start, end)


def test_transfer_neutrality(tmp_path, tmp_ledger):
    """A -> B inside the system: Input and Consumption must not move."""
    wechat_cash, bank = _prepared_ledger(tmp_ledger)

    base = make_bank_csv(tmp_path / "b1.csv", ["2026-08-01 09:00:00,代发工资 工资,10000.00,10000.00"])
    import_file(tmp_ledger, GenericCSVBankParser(), base, fallback_account_id=bank)
    before = _summarize(tmp_ledger)
    assert (before.input_minor, before.consumption_minor) == (1_000_000, 0)

    # Now add the transfer legs: bank -100 -> wechat +100.
    add = make_bank_csv(tmp_path / "b2.csv", ["2026-08-01 11:00:00,转账 微信,-100.00,9900.00"])
    import_file(tmp_ledger, GenericCSVBankParser(), add, fallback_account_id=bank)
    wx = make_wechat_csv(
        tmp_path / "w1.csv",
        ["2026-08-01 11:05:00,转账-转入,招商银行,零钱转入,收入,¥100.00,零钱,转账成功,WX901,"],
    )
    import_file(tmp_ledger, WechatParser(), wx)
    suggest_transfers(tmp_ledger)

    after = _summarize(tmp_ledger)
    # Neutrality: input/consumption identical; the movement is pure transfer.
    assert after.input_minor == before.input_minor
    assert after.consumption_minor == before.consumption_minor
    assert after.transfer_net_minor == 0
    assert after.unpaired_transfer_count == 0
    # Fully balanced clean period.
    assert after.balanced is True
    assert after.unreconciled_minor == 0
    assert after.net_storage_change_minor == after.identity_delta_minor == 1_000_000


def test_refund_correction(tmp_path, tmp_ledger):
    """¥100 spent then ¥100 refunded: net life consumption must be zero."""
    _prepared_ledger(tmp_ledger)
    csv = make_wechat_csv(
        tmp_path / "w.csv",
        [
            "2026-08-01 09:00:00,商户消费,肯德基,全家桶,支出,¥100.00,零钱,支付成功,WX1,",
            "2026-08-02 10:00:00,商户消费-退款,肯德基,全家桶退款,收入,¥100.00,零钱,退款成功,WX2,",
        ],
    )
    import_file(tmp_ledger, WechatParser(), csv)
    suggest_refunds(tmp_ledger)

    summary = _summarize(tmp_ledger)
    assert summary.consumption_minor == 10_000   # the expense happened
    assert summary.return_minor == 10_000        # and fully came back
    assert summary.consumption_minor - summary.return_minor == 0  # net: zero
    assert summary.transfer_net_minor == 0
    assert summary.balanced is True
    assert summary.net_storage_change_minor == 0

    # And the refund was linked to its original, not booked as income.
    assert summary.input_minor == 0


def test_partial_refund(tmp_path, tmp_ledger):
    """¥50 spent, ¥20 back: net consumption 30, storage -30, balanced."""
    _prepared_ledger(tmp_ledger)
    csv = make_wechat_csv(
        tmp_path / "w.csv",
        [
            "2026-08-01 09:00:00,商户消费,美团,外卖,支出,¥50.00,零钱,支付成功,WX1,",
            "2026-08-03 10:00:00,商户消费-退款,美团,部分退款,收入,¥20.00,零钱,退款成功,WX2,",
        ],
    )
    import_file(tmp_ledger, WechatParser(), csv)
    suggest_refunds(tmp_ledger)

    summary = _summarize(tmp_ledger)
    assert summary.consumption_minor - summary.return_minor == 3_000
    assert summary.net_storage_change_minor == -3_000
    assert summary.balanced is True


def test_investment_separation(tmp_path, tmp_ledger):
    """¥5000 into funds: no consumption, pure export, storage drop explained."""
    _prepared_ledger(tmp_ledger)
    csv = make_bank_csv(
        tmp_path / "b.csv",
        [
            "2026-08-01 09:00:00,代发工资 工资,10000.00,10000.00",
            "2026-08-05 10:00:00,基金申购 华夏基金,-5000.00,5000.00",
        ],
    )
    import_file(tmp_ledger, GenericCSVBankParser(), csv, fallback_account_id=ensure_account(tmp_ledger, "招商银行(1234)"))

    summary = _summarize(tmp_ledger)
    assert summary.consumption_minor == 0
    assert summary.export_minor == 500_000
    assert summary.input_minor == 1_000_000
    assert summary.balanced is True
    assert summary.net_storage_change_minor == 500_000
    assert summary.identity_delta_minor == 500_000


def test_unknown_energy_is_reported_never_absorbed(tmp_path, tmp_ledger):
    """A lone transfer out must surface as unreconciled — no fake adjustment."""
    wechat_cash, bank = _prepared_ledger(tmp_ledger)
    csv = make_bank_csv(tmp_path / "b.csv", ["2026-08-01 09:00:00,代发工资 工资,1000.00,1000.00"])
    import_file(tmp_ledger, GenericCSVBankParser(), csv, fallback_account_id=bank)

    lone = make_wechat_csv(
        tmp_path / "w.csv",
        ["2026-08-02 09:00:00,转账-转出,消失的对手方,转出,支出,¥88.00,零钱,转账成功,WX1,"],
    )
    import_file(tmp_ledger, WechatParser(), lone)

    summary = _summarize(tmp_ledger)
    assert summary.transfer_net_minor == -8_800
    assert summary.unreconciled_minor == 8_800
    assert summary.balanced is False
