"""Attribution re-runs: aliases added after import are applied deterministically."""

from __future__ import annotations

from life_energy.accounts.service import add_alias, ensure_account, reattribute_transactions
from life_energy.energy.interpret import refresh_energy_interpretations
from life_energy.ingestion.wechat import WechatParser
from life_energy.ledger.importer import import_file

from conftest import FIXTURES, make_wechat_csv


def test_reattribute_applies_newly_added_aliases(tmp_ledger):
    """Import happened before the user finished configuring aliases."""
    report = import_file(tmp_ledger, WechatParser(), FIXTURES / "wechat_202608.csv")
    assert report.imported == 8

    unattributed_before = tmp_ledger.execute(
        "SELECT COUNT(*) FROM transactions WHERE source_account_id IS NULL"
    ).fetchone()[0]
    assert unattributed_before == 8

    account_id = ensure_account(tmp_ledger, "微信零钱")
    add_alias(tmp_ledger, "wechat", "零钱", account_id)
    stats = reattribute_transactions(tmp_ledger, channel="wechat")
    assert stats["updated"] == 8
    assert tmp_ledger.execute(
        "SELECT COUNT(*) FROM transactions WHERE source_account_id IS NULL"
    ).fetchone()[0] == 0


def test_reattribute_never_nulls_or_guessed(tmp_path, tmp_ledger):
    """Rows without an alias match keep their state (NULL or fallback) — no guessing."""
    ensure_account(tmp_ledger, "微信零钱")
    add_alias(tmp_ledger, "wechat", "零钱", ensure_account(tmp_ledger, "微信零钱"))
    csv = make_wechat_csv(
        tmp_path / "w.csv",
        [
            "2026-08-01 09:00:00,商户消费,店A,东西,支出,¥10.00,零钱,支付成功,WX1,",
            "2026-08-01 10:00:00,商户消费,店B,东西,支出,¥20.00,神秘支付渠道,支付成功,WX2,",
        ],
    )
    import_file(tmp_ledger, WechatParser(), csv)
    stats = reattribute_transactions(tmp_ledger)
    assert stats["updated"] == 0
    assert stats["unresolvable"] == 1  # 神秘支付渠道 stays honestly NULL
    assert tmp_ledger.execute(
        "SELECT source_account_id FROM transactions WHERE counterparty = '店B'"
    ).fetchone()["source_account_id"] is None


def test_reattribute_preserves_interpretations(tmp_ledger):
    """Re-attribution must not touch derived interpretations."""
    import_file(tmp_ledger, WechatParser(), FIXTURES / "wechat_202608.csv")
    refresh_energy_interpretations(tmp_ledger)
    before = tmp_ledger.execute(
        "SELECT transaction_id, energy_type FROM transaction_interpretation ORDER BY transaction_id"
    ).fetchall()

    add_alias(tmp_ledger, "wechat", "零钱", ensure_account(tmp_ledger, "微信零钱"))
    reattribute_transactions(tmp_ledger, channel="wechat")

    after = tmp_ledger.execute(
        "SELECT transaction_id, energy_type FROM transaction_interpretation ORDER BY transaction_id"
    ).fetchall()
    assert [(r["transaction_id"], r["energy_type"]) for r in before] == [
        (r["transaction_id"], r["energy_type"]) for r in after
    ]
