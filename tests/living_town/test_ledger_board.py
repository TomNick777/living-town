"""Ledger board projection: energy-caliber charts, no second accounting path."""

from __future__ import annotations

import json

from life_energy.db.connection import open_db
from life_energy.living_town import build_ledger_board, build_town_state

FIXED_CLOCK = "2026-09-16T00:00:00+00:00"


def _blob(payload: dict) -> str:
    return json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def test_board_is_deterministic_and_read_only(ledger):
    before = ledger.total_changes
    first = build_ledger_board(ledger, "2026-08", generated_at=FIXED_CLOCK)
    second = build_ledger_board(ledger, "2026-08", generated_at=FIXED_CLOCK)
    assert first == second
    assert _blob(first) == _blob(second)
    assert ledger.total_changes == before


def test_board_never_leaks_energy_terms_or_counts_transfers_as_spend(ledger):
    board = build_ledger_board(ledger, "2026-08", generated_at=FIXED_CLOCK)
    blob = _blob(board)
    assert "ENERGY_" not in blob
    assert board["projection_version"] == "ledger-board-v1"
    assert board["month"] == "2026-08"
    assert len(board["days"]) == 31

    names = {item["counterparty"] for item in board["merchants"]["top"]}
    assert "支付宝" not in names
    assert "测试朋友" not in names
    # Fully refunded 肯德基 nets to zero and drops out of the spend ranking.
    assert "肯德基" not in names
    assert "麦当劳" in names

    town = build_town_state(ledger, "2026-08", generated_at=FIXED_CLOCK)
    point = board["series"][-1]
    assert point["month"] == "2026-08"
    assert point["external_income_minor"] == town.financial.external_income_minor
    assert point["net_life_consumption_minor"] == town.financial.net_life_consumption_minor
    assert point["investment_export_minor"] == town.financial.investment_export_minor
    assert point["unreconciled_minor"] == town.financial.unreconciled_minor
    assert point["balanced"] is False


def test_calendar_counts_life_days_not_internal_moves(ledger):
    board = build_ledger_board(ledger, "2026-08", generated_at=FIXED_CLOCK)
    by_date = {day["date"]: day for day in board["days"]}
    # Transfer-only day 2026-08-25 (测试朋友 88) is not a life event.
    assert by_date["2026-08-25"]["life_event_count"] == 0
    assert by_date["2026-08-25"]["consumption_minor"] == 0
    # 麦当劳 consumption day.
    assert by_date["2026-08-01"]["consumption_count"] >= 1
    assert by_date["2026-08-01"]["consumption_minor"] > 0


def test_empty_month_is_honest(tmp_ledger):
    board = build_ledger_board(tmp_ledger, "2026-01", generated_at=FIXED_CLOCK)
    assert board["series"] == []
    assert board["merchants"]["top"] == []
    assert board["merchants"]["others"] == {
        "merchant_count": 0,
        "transaction_count": 0,
        "amount_minor": 0,
    }
    assert board["accounts"] == []
    assert len(board["days"]) == 31
    assert all(day["life_event_count"] == 0 for day in board["days"])
