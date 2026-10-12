"""Town State domain models.

TownState 是「期间状态」（period state），不是永久事实，更不是
authoritative financial fact。它由 projection 从 canonical ledger +
derived interpretation 现算得出，永远可以安全重算。

这里没有任何 UI 字段（建筑/动画/地图等属于未来的 Living Town
Renderer，见 docs/living-town-ui-contract.md）。金额一律整数分；
float 只允许出现在 0..1 的评分与比例里，绝不参与权威金额。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .rules import PROJECTION_VERSION, RULES_VERSION


def _round4(value: Any) -> Any:
    if isinstance(value, float):
        return round(value, 4)
    return value


@dataclass(frozen=True)
class PeriodInfo:
    """A explicit period: a calendar month in v1. Town State is period state."""

    month: str            # "2026-08"
    start: str            # "2026-08-01"
    end: str              # "2026-08-31" (inclusive display; query window is [start, end+1))
    days_in_period: int   # 31

    def to_dict(self) -> dict:
        return {
            "month": self.month,
            "start": self.start,
            "end": self.end,
            "days_in_period": self.days_in_period,
        }


@dataclass(frozen=True)
class Factor:
    """One explainable input of a metric: name + value + human detail."""

    name: str
    value: Any
    detail: str = ""

    def to_dict(self) -> dict:
        return {"name": self.name, "value": _round4(self.value), "detail": self.detail}


@dataclass
class MetricResult:
    """A derived metric: 0..1 score + band + the factors that produced it."""

    metric: str
    score: float
    band: str
    factors: list[Factor] = field(default_factory=list)

    def to_explanation(self) -> dict:
        """Why is this the result — the answer must always be available."""
        return {
            "metric": self.metric,
            "value": _round4(self.score),
            "band": self.band,
            "factors": [f.to_dict() for f in self.factors],
            "rules_version": RULES_VERSION,
        }

    def to_reading(self) -> dict:
        return {"score": _round4(self.score), "band": self.band}


@dataclass(frozen=True)
class FinancialSummary:
    """Period financial facts — every number is taken from EnergySummary
    (energy.model.summarize_period), never recomputed here."""

    external_income_minor: int
    life_consumption_minor: int          # gross ENERGY_CONSUMPTION
    energy_return_minor: int             # ENERGY_RETURN (refunds)
    net_life_consumption_minor: int      # max(0, consumption - return)
    investment_export_minor: int         # ENERGY_EXPORT (life -> capital system)
    investment_export_count: int
    investment_import_minor: int         # ENERGY_IMPORT (capital -> life system)
    net_storage_change_minor: int
    internal_transfer_minor: int         # internal movement volume, out-leg basis
    transfer_fee_minor: int
    unreconciled_minor: int
    identity_delta_minor: int
    balanced: bool

    def to_dict(self) -> dict:
        return {
            "external_income_minor": self.external_income_minor,
            "life_consumption_minor": self.life_consumption_minor,
            "energy_return_minor": self.energy_return_minor,
            "net_life_consumption_minor": self.net_life_consumption_minor,
            "investment_export_minor": self.investment_export_minor,
            "investment_export_count": self.investment_export_count,
            "investment_import_minor": self.investment_import_minor,
            "net_storage_change_minor": self.net_storage_change_minor,
            "internal_transfer_minor": self.internal_transfer_minor,
            "transfer_fee_minor": self.transfer_fee_minor,
            "unreconciled_minor": self.unreconciled_minor,
            "identity_delta_minor": self.identity_delta_minor,
            "balanced": self.balanced,
        }


@dataclass(frozen=True)
class UnresolvedSummary:
    """Period-scoped honest gaps. They enter data_health; they never get
    silently absorbed and never alter financial facts."""

    transfer_legs: int             # unpaired transfer legs in period
    refunds: int                   # UNRESOLVED (or unlinked) refunds in period
    unknown_transactions: int      # canonical UNKNOWN type rows in period
    energy_unknown_count: int      # rows the energy layer could not place
    unreconciled_minor: int

    def to_dict(self) -> dict:
        return {
            "transfer_legs": self.transfer_legs,
            "refunds": self.refunds,
            "unknown_transactions": self.unknown_transactions,
            "energy_unknown_count": self.energy_unknown_count,
            "unreconciled_minor": self.unreconciled_minor,
        }


@dataclass(frozen=True)
class SceneActivity:
    """One life scene's activity in the period. share_of_consumption is only
    meaningful for consumption scenes (None for INVESTMENT). trend compares
    amounts with the previous calendar month; UNKNOWN when that period has
    no data — a default growth rate is never invented."""

    scene: str
    transaction_count: int
    amount_minor: int
    share_of_consumption: float | None
    active_days: int
    trend_vs_previous_period: str      # UP | DOWN | FLAT | UNKNOWN
    previous_amount_minor: int | None

    def to_dict(self) -> dict:
        return {
            "scene": self.scene,
            "transaction_count": self.transaction_count,
            "amount_minor": self.amount_minor,
            "share_of_consumption": _round4(self.share_of_consumption),
            "active_days": self.active_days,
            "trend_vs_previous_period": self.trend_vs_previous_period,
            "previous_amount_minor": self.previous_amount_minor,
        }


@dataclass
class TownProject:
    """阶段性建设（装修 / 买车 / 旅行 / 家庭计划）。v1 只保留接口：
    不从账单自动生成，等未来用户目标系统填充。"""

    project_id: str
    name: str
    project_type: str
    target_amount_minor: int | None = None
    current_progress_minor: int | None = None
    start_date: str | None = None
    target_date: str | None = None
    status: str = "PLANNED"            # PLANNED | ACTIVE | PAUSED | DONE | ABANDONED

    def to_dict(self) -> dict:
        return {
            "project_id": self.project_id,
            "name": self.name,
            "project_type": self.project_type,
            "target_amount_minor": self.target_amount_minor,
            "current_progress_minor": self.current_progress_minor,
            "start_date": self.start_date,
            "target_date": self.target_date,
            "status": self.status,
        }


@dataclass
class TownState:
    """The full projected state of the living town for one period."""

    period: PeriodInfo
    generated_at: str
    financial: FinancialSummary
    state: dict[str, MetricResult]          # vitality / stability / ...
    scenes: list[SceneActivity]
    unresolved: UnresolvedSummary
    projects: list[TownProject] = field(default_factory=list)
    projection_version: str = PROJECTION_VERSION

    def to_dict(self) -> dict:
        return {
            "period": self.period.to_dict(),
            "projection_version": self.projection_version,
            "generated_at": self.generated_at,
            "financial": self.financial.to_dict(),
            "state": {name: metric.to_reading() for name, metric in self.state.items()},
            "scenes": {scene.scene: scene.to_dict() for scene in self.scenes},
            "unresolved": self.unresolved.to_dict(),
            "projects": [project.to_dict() for project in self.projects],
            "explanations": [metric.to_explanation() for metric in self.state.values()],
        }
