"""Read-only month board: trends, calendar, merchants, account net flow.

A presentation projection over EnergySummary + period energy rows. The
browser must not sum transactions to draw these charts. Town State remains
the period-state source for scenes and headline financials; this module
adds the cross-month and within-month breakdowns the board page needs.

No ENERGY_* type names leak into the JSON.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta, timezone

import sqlite3

from ..energy.model import ENERGY_CONSUMPTION, ENERGY_INPUT, ENERGY_RETURN, summarize_period
from ..ledger.queries import month_bounds, net_flow_by_account
from .projection import financial_from_energy_summary
from .queries import available_months, month_display_bounds, period_energy_rows, scene_for_row
from .rules import OTHER

BOARD_VERSION = "ledger-board-v1"
MERCHANT_LIMIT = 10
SERIES_MONTHS = 12


def build_ledger_board(
    conn: sqlite3.Connection,
    month: str,
    *,
    generated_at: str | None = None,
) -> dict:
    """Derived board document for one calendar month. Read-only."""
    start, end = month_bounds(month)
    start_display, _end_display, days_in_period = month_display_bounds(month)
    rows = period_energy_rows(conn, start, end)
    return {
        "projection_version": BOARD_VERSION,
        "generated_at": generated_at or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S+00:00"),
        "month": month,
        "series": _series(conn, month),
        "days": _days(rows, start_display, days_in_period),
        "merchants": _merchants(rows),
        "accounts": _accounts(conn, start, end),
    }


def _series(conn: sqlite3.Connection, month: str) -> list[dict]:
    months = [item for item in available_months(conn) if item <= month][-SERIES_MONTHS:]
    points = []
    for item in months:
        start, end = month_bounds(item)
        financial = financial_from_energy_summary(summarize_period(conn, start, end))
        points.append(
            {
                "month": item,
                "external_income_minor": financial.external_income_minor,
                "net_life_consumption_minor": financial.net_life_consumption_minor,
                "investment_export_minor": financial.investment_export_minor,
                "net_storage_change_minor": financial.net_storage_change_minor,
                "unreconciled_minor": financial.unreconciled_minor,
                "balanced": financial.balanced,
            }
        )
    return points


def _days(rows: list[dict], start_display: str, days_in_period: int) -> list[dict]:
    start_date = date.fromisoformat(start_display)
    by_day: dict[str, dict] = {}
    for offset in range(days_in_period):
        day = (start_date + timedelta(days=offset)).isoformat()
        by_day[day] = {
            "date": day,
            "life_event_count": 0,
            "consumption_count": 0,
            "consumption_minor": 0,
            "income_count": 0,
            "income_minor": 0,
        }
    for row in rows:
        day = row["occurred_at"][:10]
        entry = by_day.get(day)
        if entry is None:
            continue
        energy = row["energy_type"]
        if energy == ENERGY_CONSUMPTION:
            entry["consumption_count"] += 1
            entry["consumption_minor"] += row["amount_minor"]
            entry["life_event_count"] += 1
        elif energy == ENERGY_INPUT:
            entry["income_count"] += 1
            entry["income_minor"] += row["amount_minor"]
            entry["life_event_count"] += 1
    return [by_day[key] for key in sorted(by_day)]


def _merchants(rows: list[dict]) -> dict:
    per: dict[str, dict] = defaultdict(
        lambda: {
            "consumption_minor": 0,
            "return_minor": 0,
            "consumption_count": 0,
            "scenes": defaultdict(int),
        }
    )
    for row in rows:
        name = (row.get("counterparty") or "").strip() or "未填写对手方"
        energy = row["energy_type"]
        if energy == ENERGY_CONSUMPTION:
            per[name]["consumption_minor"] += row["amount_minor"]
            per[name]["consumption_count"] += 1
            scene = scene_for_row(row) or OTHER
            per[name]["scenes"][scene] += row["amount_minor"]
        elif energy == ENERGY_RETURN:
            per[name]["return_minor"] += row["amount_minor"]

    ranked: list[dict] = []
    for name, agg in per.items():
        net = agg["consumption_minor"] - agg["return_minor"]
        if agg["consumption_count"] <= 0 or net <= 0:
            continue
        scenes = agg["scenes"]
        ranked.append(
            {
                "counterparty": name,
                "scene": max(scenes, key=scenes.get) if scenes else OTHER,
                "transaction_count": agg["consumption_count"],
                "amount_minor": net,
                "consumption_minor": agg["consumption_minor"],
                "return_minor": agg["return_minor"],
            }
        )
    ranked.sort(key=lambda item: (-item["amount_minor"], item["counterparty"]))
    top = ranked[:MERCHANT_LIMIT]
    rest = ranked[MERCHANT_LIMIT:]
    return {
        "top": top,
        "others": {
            "merchant_count": len(rest),
            "transaction_count": sum(item["transaction_count"] for item in rest),
            "amount_minor": sum(item["amount_minor"] for item in rest),
        },
    }


def _accounts(conn: sqlite3.Connection, start: str, end: str) -> list[dict]:
    return [
        {
            "account_id": item["account_id"],
            "account_name": item["account_name"] or "未归属账户",
            "net_minor": item["net_minor"],
        }
        for item in net_flow_by_account(conn, start, end)
    ]
