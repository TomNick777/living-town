"""Living Town projection — Town State, the derived state of the 生活小镇.

Canonical Ledger -> Derived Interpretation -> Life Energy
    -> Living Town Projection -> Town State

This package is a pure derived layer: read-only over the database, no UI,
no canonical mutation. See docs/living-town-projection.md.
"""

from .models import (
    Factor,
    FinancialSummary,
    MetricResult,
    PeriodInfo,
    SceneActivity,
    TownProject,
    TownState,
    UnresolvedSummary,
)
from .ledger_board import build_ledger_board
from .ledger_review import build_ledger_review
from .projection import build_town_state, financial_from_energy_summary, load_projects
from .rules import CATEGORY_TO_SCENE, LIFE_SCENES, PROJECTION_VERSION, RULES_VERSION

__all__ = [
    "build_town_state",
    "build_ledger_board",
    "build_ledger_review",
    "financial_from_energy_summary",
    "load_projects",
    "TownState",
    "TownProject",
    "PeriodInfo",
    "FinancialSummary",
    "UnresolvedSummary",
    "SceneActivity",
    "MetricResult",
    "Factor",
    "LIFE_SCENES",
    "CATEGORY_TO_SCENE",
    "PROJECTION_VERSION",
    "RULES_VERSION",
]
