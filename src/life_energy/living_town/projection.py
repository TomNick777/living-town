"""Living Town projection: canonical ledger + derived interpretation -> Town State.

    Raw Evidence -> Canonical Ledger -> Derived Interpretation
        -> Life Energy -> Living Town Projection -> Town State

原则:

- 只读:本模块对数据库零写入;Town State 是派生状态,可随时安全重算,
  永远不成为 authoritative financial fact(本阶段不物化);
- 财务数字 100% 来自 energy.model.summarize_period,不发明第二套口径;
- deterministic:同一数据库、同一期间、同一 generated_at => 输出逐字节
  一致;generated_at 可注入以便测试与可复现输出;
- trend 对上一月如实 UNKNOWN,绝不造默认增长率。
"""

from __future__ import annotations

import sqlite3
from datetime import date, datetime, timezone

from ..energy.model import ENERGY_CONSUMPTION, ENERGY_INPUT, ENERGY_TRANSFER, EnergySummary, summarize_period
from ..ledger.queries import month_bounds
from . import rules, scoring
from .models import (
    FinancialSummary,
    PeriodInfo,
    SceneActivity,
    TownProject,
    TownState,
    UnresolvedSummary,
)
from .queries import (
    month_display_bounds,
    period_energy_rows,
    previous_month,
    scene_amounts,
    scene_for_row,
)


def financial_from_energy_summary(summary: EnergySummary) -> FinancialSummary:
    """Map EnergySummary onto Town/ledger financial fields.

    The transfer volume uses the same out-leg formula as Town State so the
    board never invents a second cash-flow identity.
    """
    return FinancialSummary(
        external_income_minor=summary.input_minor,
        life_consumption_minor=summary.consumption_minor,
        energy_return_minor=summary.return_minor,
        net_life_consumption_minor=max(0, summary.consumption_minor - summary.return_minor),
        investment_export_minor=summary.export_minor,
        investment_export_count=summary.by_type_count.get("ENERGY_EXPORT", 0),
        investment_import_minor=summary.import_minor,
        net_storage_change_minor=summary.net_storage_change_minor,
        # 出腿口径:每对已配对转账只计一次;未配对腿按自身方向计入。
        internal_transfer_minor=(
            summary.by_type_minor.get(ENERGY_TRANSFER, 0) - summary.transfer_net_minor
        )
        // 2,
        transfer_fee_minor=summary.transfer_fee_minor,
        unreconciled_minor=summary.unreconciled_minor,
        identity_delta_minor=summary.identity_delta_minor,
        balanced=summary.balanced,
    )


def load_projects(conn: sqlite3.Connection) -> list[TownProject]:
    """Future extension point: a user goal system would plug in here.

    v1 has no goal tables and projects are never guessed from bills, so
    this returns [] — the interface exists so the Town State shape is
    already stable for the future UI contract.
    """
    return []


def _trend(current: int, previous: int | None, previous_exists: bool) -> str:
    if not previous_exists:
        return "UNKNOWN"
    assert previous is not None
    if previous == 0:
        return "UP" if current > 0 else "FLAT"
    delta = (current - previous) / previous
    if delta > 0.05:
        return "UP"
    if delta < -0.05:
        return "DOWN"
    return "FLAT"


def _activity(rows: list[dict], period_start: str, days_in_period: int) -> scoring.PeriodActivity:
    """Count-based period aggregates. Activity day = a day with at least one
    consumption or income transaction (transfers/refunds are movements, not
    town life)."""
    active_dates: set[str] = set()
    consumption_scenes: set[str] = set()
    consumption_count = 0
    income_count = 0
    largest_consumption = 0

    for row in rows:
        energy = row["energy_type"]
        day = row["occurred_at"][:10]
        if energy in (ENERGY_CONSUMPTION, ENERGY_INPUT):
            active_dates.add(day)
        if energy == ENERGY_CONSUMPTION:
            consumption_count += 1
            largest_consumption = max(largest_consumption, row["amount_minor"])
            scene = scene_for_row(row)
            if scene is not None:
                consumption_scenes.add(scene)
        elif energy == ENERGY_INPUT:
            income_count += 1

    streak = _longest_inactive_streak(active_dates, period_start, days_in_period)
    return scoring.PeriodActivity(
        days_in_period=days_in_period,
        active_days=len(active_dates),
        longest_inactive_streak=streak,
        distinct_life_scenes=len(consumption_scenes),
        consumption_count=consumption_count,
        income_count=income_count,
        largest_consumption_minor=largest_consumption,
        total_transaction_count=len(rows),
    )


def _longest_inactive_streak(active_dates: set[str], period_start: str, days_in_period: int) -> int:
    """Longest run of consecutive days without town activity, including the
    leading and trailing edges of the period."""
    if not active_dates:
        return days_in_period
    period_first = date.fromisoformat(period_start).toordinal()
    active_ordinals = sorted(date.fromisoformat(day).toordinal() for day in active_dates)
    leading = active_ordinals[0] - period_first
    internal = [b - a - 1 for a, b in zip(active_ordinals, active_ordinals[1:])]
    trailing = period_first + days_in_period - 1 - active_ordinals[-1]
    return max(leading, *internal, trailing)


def _scene_activities(
    rows: list[dict], gross_consumption: int, prev_amounts: dict[str, int], previous_exists: bool
) -> list[SceneActivity]:
    per_scene: dict[str, dict] = {}
    for row in rows:
        scene = scene_for_row(row)
        if scene is None:
            continue
        entry = per_scene.setdefault(scene, {"count": 0, "amount": 0, "days": set()})
        entry["count"] += 1
        entry["amount"] += row["amount_minor"]
        entry["days"].add(row["occurred_at"][:10])

    activities = []
    for scene in rules.LIFE_SCENES:
        if scene not in per_scene:
            continue
        entry = per_scene[scene]
        # 上期存在数据时,本期没有活动的场景按 0 对比(如实的 UP);
        # 上期完全无数据时 previous=None -> trend UNKNOWN,绝不造默认增长率。
        previous = prev_amounts.get(scene, 0) if previous_exists else None
        activities.append(
            SceneActivity(
                scene=scene,
                transaction_count=entry["count"],
                amount_minor=entry["amount"],
                share_of_consumption=(
                    entry["amount"] / gross_consumption
                    if gross_consumption > 0 and scene != rules.INVESTMENT
                    else None
                ),
                active_days=len(entry["days"]),
                trend_vs_previous_period=_trend(entry["amount"], previous, previous_exists),
                previous_amount_minor=previous,
            )
        )
    return activities


def build_town_state(
    conn: sqlite3.Connection,
    month: str,
    *,
    generated_at: str | None = None,
    projects: list[TownProject] | None = None,
) -> TownState:
    """Project the Town State for a calendar month. Read-only; deterministic
    for a fixed generated_at."""
    start, end = month_bounds(month)
    start_display, end_display, days = month_display_bounds(month)

    summary = summarize_period(conn, start, end)
    rows = period_energy_rows(conn, start, end)
    activity = _activity(rows, start_display, days)

    financial = financial_from_energy_summary(summary)

    unresolved = UnresolvedSummary(
        transfer_legs=summary.unpaired_transfer_count,
        refunds=sum(
            1
            for row in rows
            if row["transaction_type"] == "REFUND"
            and row.get("refund_link_status") in (None, "UNRESOLVED")
        ),
        unknown_transactions=sum(1 for row in rows if row["transaction_type"] == "UNKNOWN"),
        energy_unknown_count=summary.unknown_count,
        unreconciled_minor=summary.unreconciled_minor,
    )

    prev_month = previous_month(month)
    prev_start, prev_end = month_bounds(prev_month)
    prev_rows = period_energy_rows(conn, prev_start, prev_end)
    previous_exists = bool(prev_rows)
    prev_amounts = scene_amounts(prev_rows)

    state = {
        "vitality": scoring.vitality(activity, financial.external_income_minor > 0),
        "stability": scoring.stability(financial, activity),
        "consumption_pressure": scoring.consumption_pressure(
            financial, activity.largest_consumption_minor
        ),
        "saving_strength": scoring.saving_strength(financial),
        "investment_outflow": scoring.investment_outflow(financial),
        "data_health": scoring.data_health(financial, unresolved, activity),
    }

    return TownState(
        period=PeriodInfo(month=month, start=start_display, end=end_display, days_in_period=days),
        generated_at=generated_at or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S+00:00"),
        financial=financial,
        state=state,
        scenes=_scene_activities(rows, summary.consumption_minor, prev_amounts, previous_exists),
        unresolved=unresolved,
        projects=projects if projects is not None else load_projects(conn),
    )
