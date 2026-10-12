"""Town period projection: month/year read snapshot for Living Town showcase.

Single read-only response bundles authoritative financial summary, activity
counts, TownEvent facts and presentation scheduling for period montage replay.
"""

from __future__ import annotations

import re
import sqlite3
from datetime import date, datetime, timezone

from ..energy.model import summarize_period
from ..ledger.queries import month_bounds
from .projection import financial_from_energy_summary
from .queries import available_months, month_display_bounds
from .town_events import (
    TOWN_EVENT_RULES_VERSION,
    TOWN_EVENTS_VERSION,
    build_town_events_document,
    coverage_summary,
)

TOWN_PERIOD_VERSION = "town-period-v1"
PRESENTATION_VERSION = "town-period-presentation-v1"

_PERIOD_MONTH_RE = re.compile(r"^\d{4}-\d{2}$")
_PERIOD_YEAR_RE = re.compile(r"^\d{4}$")


def parse_period_key(period: str) -> tuple[str, str, str, str]:
    """Return (kind, key, start_iso, end_exclusive_iso) for YYYY-MM or YYYY."""
    if _PERIOD_MONTH_RE.match(period):
        try:
            datetime.strptime(period, "%Y-%m")
        except ValueError as exc:
            raise ValueError(f"not a real calendar month: {period}") from exc
        start, end = month_bounds(period)
        return "month", period, start, end
    if _PERIOD_YEAR_RE.match(period):
        year = int(period)
        start = f"{year:04d}-01-01T00:00:00+08:00"
        end = f"{year + 1:04d}-01-01T00:00:00+08:00"
        return "year", period, start, end
    raise ValueError("period must be YYYY-MM or YYYY")


def _year_month_keys(year: int) -> list[str]:
    return [f"{year:04d}-{month:02d}" for month in range(1, 13)]


def _period_month_series(
    kind: str,
    key: str,
    start: str,
    end: str,
    available: list[str],
) -> list[dict]:
    if kind == "month":
        has = key in available
        start_display, end_display, _days = month_display_bounds(key)
        return [{
            "month": key,
            "has_data": has,
            "start": start_display,
            "end": end_display,
        }]
    year = int(key)
    months_in_year = _year_month_keys(year)
    available_set = set(available)
    series: list[dict] = []
    for month in months_in_year:
        start_display, end_display, _days = month_display_bounds(month)
        series.append({
            "month": month,
            "has_data": month in available_set,
            "start": start_display,
            "end": end_display,
        })
    return series


def _active_dates(events: list[dict]) -> list[str]:
    return sorted({event["occurred_at"][:10] for event in events})


def _place_counts(events: list[dict]) -> list[dict]:
    counts: dict[str, int] = {}
    for event in events:
        counts[event["target"]] = counts.get(event["target"], 0) + 1
    return [{"target": target, "count": count} for target, count in sorted(counts.items())]


def _ledger_transaction_count(conn: sqlite3.Connection, start: str, end: str) -> int:
    row = conn.execute(
        "SELECT COUNT(*) FROM transactions WHERE occurred_at >= ? AND occurred_at < ?",
        (start, end),
    ).fetchone()
    return int(row[0]) if row else 0


def build_town_period(
    conn: sqlite3.Connection,
    period: str,
    *,
    generated_at: str | None = None,
) -> dict:
    """Read-only period snapshot for showcase month/year navigation."""
    kind, key, start, end = parse_period_key(period)
    generated = generated_at or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S+00:00")
    months_available = available_months(conn)
    if kind == "month":
        months_in_data = [key] if key in months_available else []
    else:
        year = int(key)
        months_in_data = [month for month in months_available if month.startswith(f"{year:04d}-")]

    start_date = date.fromisoformat(start[:10])
    end_exclusive = date.fromisoformat(end[:10])
    end_inclusive = date.fromordinal(end_exclusive.toordinal() - 1)

    summary = summarize_period(conn, start, end)
    financial = financial_from_energy_summary(summary)

    events_doc = build_town_events_document(
        conn,
        start,
        end,
        period_key=key,
        presentation_mode="period_montage",
        generated_at=generated,
    )
    events = events_doc["events"]
    active_dates = _active_dates(events)

    activity = {
        "ledger_transaction_count": _ledger_transaction_count(conn, start, end),
        "town_event_count": len(events),
        "active_day_count": len(active_dates),
        "active_dates": active_dates,
        "places": _place_counts(events),
        "coverage": events_doc["coverage"],
    }

    presentation = {
        "version": PRESENTATION_VERSION,
        "mode": "period_montage",
        "montage_label": key,
        "timeline_seconds": 86400,
        "event_count": len(events),
    }

    return {
        "projection_version": TOWN_PERIOD_VERSION,
        "rules_version": TOWN_EVENT_RULES_VERSION,
        "town_events_version": TOWN_EVENTS_VERSION,
        "generated_at": generated,
        "period": {
            "kind": kind,
            "key": key,
            "start": start_date.isoformat(),
            "end_exclusive": end_exclusive.isoformat(),
            "end_inclusive": end_inclusive.isoformat(),
            "available_months": months_available,
            "months_with_data": months_in_data,
            "date_coverage": {
                "first": active_dates[0] if active_dates else None,
                "last": active_dates[-1] if active_dates else None,
            },
        },
        "financial": financial.to_dict(),
        "activity": activity,
        "months": _period_month_series(kind, key, start, end, months_available),
        "events": events,
        "days": events_doc["days"],
        "presentation": presentation,
        "coverage": coverage_summary(events),
    }
