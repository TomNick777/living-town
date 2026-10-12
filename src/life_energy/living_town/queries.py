"""Read-side queries for the Living Town projection.

Strictly read-only over canonical ledger + derived interpretation. The row
source is energy.model (load_energy_rows + classify_energy) so the Town
State shares the exact same energy readings as `energy summary` — one
computation basis, never a second one.
"""

from __future__ import annotations

import sqlite3
from datetime import date

from ..energy.model import (
    ENERGY_CONSUMPTION,
    ENERGY_EXPORT,
    ENERGY_INPUT,
    classify_energy,
    load_energy_rows,
)
from ..ledger.queries import month_bounds
from .rules import CATEGORY_TO_SCENE, INVESTMENT, OTHER


def period_energy_rows(conn: sqlite3.Connection, start: str, end: str) -> list[dict]:
    """Canonical rows of [start, end) with live energy readings attached."""
    return classify_energy(load_energy_rows(conn, start, end))


def scene_for_row(row: dict) -> str | None:
    """Deterministic scene of one ledger row; None = not a scene activity.

    life_scene 由 category 派生(v1),投资外输行映射到 INVESTMENT 场景
    (生活小镇 -> 海獭控股的连接)。转账 / 退款 / 收入 / 未知不构成场景活动。
    """
    if row["energy_type"] == ENERGY_CONSUMPTION:
        return CATEGORY_TO_SCENE.get(row.get("category_code") or "", OTHER)
    if row["energy_type"] == ENERGY_EXPORT:
        return INVESTMENT
    return None


def available_months(conn: sqlite3.Connection) -> list[str]:
    """Months with at least one canonical transaction, ascending ("YYYY-MM").

    展示层的月份导航用:只读 transactions.occurred_at,不碰金额与解释,
    空库返回空列表(如实,不造默认月份)。
    """
    rows = conn.execute(
        "SELECT DISTINCT substr(occurred_at, 1, 7) FROM transactions "
        "WHERE occurred_at IS NOT NULL ORDER BY 1"
    ).fetchall()
    return [str(row[0]) for row in rows]


def previous_month(month: str) -> str:
    year, month_number = int(month[:4]), int(month[5:7])
    if month_number == 1:
        return f"{year - 1:04d}-12"
    return f"{year:04d}-{month_number - 1:02d}"


def month_display_bounds(month: str) -> tuple[str, str, int]:
    """('2026-08') -> ('2026-08-01', '2026-08-31', 31): display bounds + days.

    month_bounds 是 [start, end) 查询窗口;展示与天数用包含式月末。"""
    start, end = month_bounds(month)
    start_date = date.fromisoformat(start[:10])
    end_exclusive = date.fromisoformat(end[:10])
    days = (end_exclusive - start_date).days
    last_day = date.fromordinal(end_exclusive.toordinal() - 1)
    return start_date.isoformat(), last_day.isoformat(), days


def scene_amounts(rows: list[dict]) -> dict[str, int]:
    """scene -> total amount; used for the previous-period trend base."""
    amounts: dict[str, int] = {}
    for row in rows:
        scene = scene_for_row(row)
        if scene is not None:
            amounts[scene] = amounts.get(scene, 0) + row["amount_minor"]
    return amounts
