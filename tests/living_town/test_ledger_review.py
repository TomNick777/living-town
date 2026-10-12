"""Ledger review projection: facts listed, unresolved kept explicit."""

from __future__ import annotations

from life_energy.living_town import build_ledger_review


FIXED_CLOCK = "2026-09-16T00:00:00+00:00"


def test_review_lists_types_without_absorbing_unresolved(ledger):
    before = ledger.total_changes
    review = build_ledger_review(ledger, "2026-08", generated_at=FIXED_CLOCK, limit=200)
    assert ledger.total_changes == before
    assert review["projection_version"] == "ledger-review-v1"
    assert review["total_count"] == review["type_counts"]["INCOME"] + review["type_counts"]["EXPENSE"] + review["type_counts"]["TRANSFER"] + review["type_counts"]["REFUND"] + review["type_counts"]["INVESTMENT"] + review["type_counts"]["UNKNOWN"]
    assert review["type_counts"]["UNKNOWN"] == 1
    assert review["bucket_counts"]["unpaired_transfer"] == 1
    assert review["bucket_counts"]["unknown_type"] == 1
    assert review["bucket_counts"]["pending"] >= 1

    blob = str(review)
    assert "ENERGY_" not in blob
    assert "raw_payload" not in blob

    kinds = {item["transaction_type"] for item in review["transactions"]}
    assert "TRANSFER" in kinds
    assert "REFUND" in kinds
    assert "INVESTMENT" in kinds
    assert "UNKNOWN" in kinds


def test_review_filters_and_pagination(ledger):
    pending = build_ledger_review(ledger, "2026-08", bucket="pending", generated_at=FIXED_CLOCK)
    assert pending["total_count"] == pending["bucket_counts"]["pending"]
    assert all(item["flags"] for item in pending["transactions"])

    unknown = build_ledger_review(ledger, "2026-08", transaction_type="UNKNOWN", generated_at=FIXED_CLOCK)
    assert unknown["total_count"] == 1
    assert unknown["transactions"][0]["transaction_type"] == "UNKNOWN"

    page = build_ledger_review(ledger, "2026-08", limit=3, offset=0, generated_at=FIXED_CLOCK)
    nxt = build_ledger_review(ledger, "2026-08", limit=3, offset=3, generated_at=FIXED_CLOCK)
    ids = [item["transaction_id"] for item in page["transactions"] + nxt["transactions"]]
    assert len(ids) == len(set(ids))
    assert page["total_count"] == nxt["total_count"]


def test_review_search_is_filter_not_a_new_total(ledger):
    found = build_ledger_review(ledger, "2026-08", q="麦当劳", generated_at=FIXED_CLOCK)
    assert found["total_count"] >= 1
    assert all("麦当劳" in (item["counterparty"] or "") for item in found["transactions"])
    empty = build_ledger_review(ledger, "2026-08", q="不会出现的对手方xyz", generated_at=FIXED_CLOCK)
    assert empty["total_count"] == 0
    assert empty["transactions"] == []
