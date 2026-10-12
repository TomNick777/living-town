"""Refund linking: refunds trace to originals or stay explicitly unresolved."""

from __future__ import annotations

from life_energy.energy.model import classify_energy, load_energy_rows
from life_energy.reconciliation.refund_pairing import (
    confirm_refund_link,
    find_refund_candidates,
    list_refund_links,
    mark_all_unresolved,
    suggest_refunds,
    unlink_refund,
)


def test_candidates_pair_full_and_partial_refunds(ledger_raw):
    candidates = find_refund_candidates(ledger_raw)
    by_refund = {c.refund_transaction_id: c for c in candidates}
    assert len(by_refund) == 2

    wechat_links = [
        c for c in candidates
        if c.match_reason["amount_minor"] == 10000
    ]
    assert len(wechat_links) == 1
    assert wechat_links[0].match_reason["original_amount_minor"] == 10000

    alipay_partial = [c for c in candidates if c.match_reason["amount_minor"] == 2000]
    assert len(alipay_partial) == 1
    assert alipay_partial[0].match_reason["original_amount_minor"] == 5000  # 50.00 expense


def test_suggest_probable_and_orphan_unresolved(ledger_raw):
    applied = suggest_refunds(ledger_raw)
    assert len(applied) == 2
    leftover = mark_all_unresolved(ledger_raw)
    assert leftover == 1  # bank orphan refund (京东 30.00, no bank expense)

    links = {row["refund_transaction_id"]: row for row in list_refund_links(ledger_raw)}
    assert len(links) == 3
    assert sum(1 for row in links.values() if row["link_status"] == "PROBABLE") == 2
    orphan = [row for row in links.values() if row["link_status"] == "UNRESOLVED"][0]
    assert orphan["original_id"] is None
    assert orphan["paired_by"] == "AUTO"


def test_refund_energy_is_return_not_input(ledger_raw):
    """Hard rule: a refund must never read as external income."""
    suggest_refunds(ledger_raw)
    mark_all_unresolved(ledger_raw)

    rows = classify_energy(load_energy_rows(ledger_raw))
    refunds = [row for row in rows if row["transaction_type"] == "REFUND"]
    assert len(refunds) == 3
    assert {row["energy_type"] for row in refunds} == {"ENERGY_RETURN"}
    provenance = refunds[0]["energy_derived_from"]
    assert provenance["note"]
    assert "not external income" in provenance["note"]


def test_confirm_and_unlink(ledger_raw):
    suggest_refunds(ledger_raw)
    link = list_refund_links(ledger_raw)[0]
    confirm_refund_link(ledger_raw, link["refund_transaction_id"])
    assert list_refund_links(ledger_raw)[0]["link_status"] == "CONFIRMED"

    unlink_refund(ledger_raw, link["refund_transaction_id"])
    row = list_refund_links(ledger_raw)[0]
    assert row["link_status"] == "UNRESOLVED"
    assert row["original_id"] is None


def test_unresolved_refund_is_queryable_not_hidden(ledger):
    """Without any suggestion run, the orphan refund is still discoverable."""
    from life_energy.ledger.queries import unresolved_transactions

    unresolved = unresolved_transactions(ledger)
    assert len(unresolved["unresolved_refund"]) == 1
