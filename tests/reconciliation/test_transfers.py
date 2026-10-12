"""Transfer pairing: cross-channel candidates, conservative statuses, memory."""

from __future__ import annotations

from life_energy.reconciliation.transfer_pairing import (
    confirm_pair,
    create_pair,
    find_transfer_candidates,
    list_pairs,
    suggest_transfers,
    unpair,
)


def test_candidates_find_both_cross_channel_pairs(ledger_raw):
    candidates = find_transfer_candidates(ledger_raw)
    pairs = {(c.out_transaction_id, c.in_transaction_id) for c in candidates}
    # bank(09:00) -> alipay 充值(09:05) and wechat(12:00) -> alipay 转账(12:05)
    assert len(pairs) == 2
    for candidate in candidates:
        assert candidate.fee_minor == 0
        assert candidate.delta_minutes <= 30
        reason = candidate.match_reason
        assert reason["opposite_direction"] is True
        assert reason["out_account"] != reason["in_account"]


def test_suggest_creates_probable_never_confirmed(ledger_raw):
    applied = suggest_transfers(ledger_raw)
    assert len(applied) == 2
    rows = list_pairs(ledger_raw)
    assert {row["pair_status"] for row in rows} == {"PROBABLE"}
    assert {row["paired_by"] for row in rows} == {"AUTO"}
    # match reason is JSON provenance
    assert "same_amount" in rows[0]["match_reason"]


def test_unpaired_transfer_leg_remains_visible(ledger_raw):
    suggest_transfers(ledger_raw)
    lonely = ledger_raw.execute(
        """
        SELECT t.transaction_id FROM transactions t
        WHERE t.transaction_type = 'TRANSFER'
          AND NOT EXISTS (SELECT 1 FROM transfer_pairs tp
              WHERE tp.out_transaction_id = t.transaction_id OR tp.in_transaction_id = t.transaction_id)
        """
    ).fetchall()
    assert len(lonely) == 1  # ¥88.00 with no counter leg — surfaced, not absorbed


def test_confirm_then_unpair_with_memory(ledger_raw):
    suggest_transfers(ledger_raw)
    pair = list_pairs(ledger_raw)[0]

    confirm_pair(ledger_raw, pair["pair_id"])
    statuses = {row["pair_id"]: row["pair_status"] for row in list_pairs(ledger_raw)}
    assert statuses[pair["pair_id"]] == "CONFIRMED"

    out_id, in_id = unpair(ledger_raw, pair["pair_id"])
    remaining = {(row["out_id"], row["in_id"]) for row in list_pairs(ledger_raw)}
    assert (out_id, in_id) not in remaining  # the dissolved pair is gone

    decision = ledger_raw.execute(
        "SELECT decision FROM transfer_pair_decisions WHERE out_transaction_id = ? AND in_transaction_id = ?",
        (out_id, in_id),
    ).fetchone()
    assert decision["decision"] == "REJECTED"

    # A rejected pair is never re-suggested automatically.
    pairs = {(c.out_transaction_id, c.in_transaction_id) for c in find_transfer_candidates(ledger_raw)}
    assert (out_id, in_id) not in pairs


def test_manual_link_creates_confirmed_pair(ledger_raw):
    out = ledger_raw.execute(
        "SELECT transaction_id FROM transactions WHERE transaction_type='TRANSFER' AND direction='OUTFLOW' AND amount_minor=20000 LIMIT 1"
    ).fetchone()
    inner = ledger_raw.execute(
        "SELECT transaction_id FROM transactions WHERE transaction_type='TRANSFER' AND direction='INFLOW' AND amount_minor=20000 LIMIT 1"
    ).fetchone()
    create_pair(
        ledger_raw,
        out["transaction_id"],
        inner["transaction_id"],
        pair_status="CONFIRMED",
        match_reason={"note": "manual"},
        paired_by="MANUAL",
    )
    ledger_raw.commit()
    rows = list_pairs(ledger_raw)
    assert len(rows) == 1
    assert rows[0]["pair_status"] == "CONFIRMED"
    assert rows[0]["paired_by"] == "MANUAL"


def test_candidates_reject_same_account_and_wrong_amounts(tmp_path, tmp_ledger):
    from life_energy.accounts.service import add_alias, ensure_account
    from life_energy.ledger.importer import import_file
    from life_energy.ingestion.wechat import WechatParser

    from conftest import make_wechat_csv

    account_id = ensure_account(tmp_ledger, "微信零钱")
    add_alias(tmp_ledger, "wechat", "零钱", account_id)
    # Same account on both sides: must never pair (money cannot transfer to itself).
    csv = make_wechat_csv(
        tmp_path / "w.csv",
        [
            "2026-08-01 09:00:00,转账-转出,自有账户,转出,支出,¥100.00,零钱,转账成功,W1,",
            "2026-08-01 09:01:00,转账-转入,自有账户,转入,收入,¥100.00,零钱,转账成功,W2,",
        ],
    )
    import_file(tmp_ledger, WechatParser(), csv)
    assert find_transfer_candidates(tmp_ledger) == []
