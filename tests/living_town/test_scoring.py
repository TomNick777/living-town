"""Unit tests for Town State scoring: pure functions, exact expectations.

Scoring must be deterministic, explainable, and must never encode
「花得越多小镇越好」.
"""

from __future__ import annotations

from life_energy.living_town.models import FinancialSummary, UnresolvedSummary
from life_energy.living_town.scoring import (
    PeriodActivity,
    consumption_pressure,
    data_health,
    investment_outflow,
    saving_strength,
    stability,
    vitality,
)


def _financial(**overrides) -> FinancialSummary:
    base = dict(
        external_income_minor=1_000_000,
        life_consumption_minor=600_000,
        energy_return_minor=0,
        net_life_consumption_minor=600_000,
        investment_export_minor=0,
        investment_export_count=0,
        investment_import_minor=0,
        net_storage_change_minor=400_000,
        internal_transfer_minor=0,
        transfer_fee_minor=0,
        unreconciled_minor=0,
        identity_delta_minor=400_000,
        balanced=True,
    )
    base.update(overrides)
    return FinancialSummary(**base)


def _activity(**overrides) -> PeriodActivity:
    base = dict(
        days_in_period=31,
        active_days=22,
        longest_inactive_streak=2,
        distinct_life_scenes=6,
        consumption_count=25,
        income_count=2,
        largest_consumption_minor=100_000,
        total_transaction_count=30,
    )
    base.update(overrides)
    return PeriodActivity(**base)


# ------------------------------------------------------- consumption pressure


def test_pressure_bands_by_ratio():
    assert consumption_pressure(_financial(net_life_consumption_minor=300_000)).band == "LOW"
    assert consumption_pressure(_financial(net_life_consumption_minor=600_000)).band == "NORMAL"
    assert consumption_pressure(_financial(net_life_consumption_minor=900_000)).band == "HIGH"
    assert consumption_pressure(_financial(net_life_consumption_minor=1_000_000)).band == "EXTREME"
    assert consumption_pressure(_financial(net_life_consumption_minor=1_400_000)).band == "EXTREME"


def test_pressure_score_is_clamped_ratio():
    assert consumption_pressure(_financial(net_life_consumption_minor=250_000)).score == 0.25
    assert consumption_pressure(_financial(net_life_consumption_minor=1_400_000)).score == 1.0


def test_pressure_with_zero_income_is_extreme_and_explained():
    result = consumption_pressure(_financial(external_income_minor=0, net_storage_change_minor=-600_000))
    assert result.band == "EXTREME"
    assert result.score == 1.0
    income_factor = next(f for f in result.factors if f.name == "external_income_minor")
    assert "non-salary" in income_factor.detail


def test_pressure_with_zero_income_and_zero_consumption_is_low():
    result = consumption_pressure(_financial(external_income_minor=0, net_life_consumption_minor=0))
    assert result.band == "LOW"
    assert result.score == 0.0


def test_refund_reduces_pressure_because_net_consumption_shrinks():
    gross = consumption_pressure(_financial(net_life_consumption_minor=900_000))
    with_return = consumption_pressure(_financial(
        life_consumption_minor=900_000,
        energy_return_minor=300_000,
        net_life_consumption_minor=600_000,
        net_storage_change_minor=900_000,
    ))
    assert gross.band == "HIGH"
    assert with_return.band == "NORMAL"


def test_one_off_event_is_disclosed_not_hidden():
    result = consumption_pressure(
        _financial(life_consumption_minor=600_000), largest_consumption_minor=500_000
    )
    largest = next(f for f in result.factors if f.name == "largest_single_share")
    assert largest.value == 500_000 / 600_000
    assert "do not change the score" in largest.detail


# ------------------------------------------------------------ saving strength


def test_saving_strength_full_credit_at_30_percent_rate():
    result = saving_strength(_financial(net_storage_change_minor=300_000))
    assert result.score == 1.0
    assert result.band == "STRONG"


def test_saving_strength_negative_storage_is_none():
    result = saving_strength(_financial(net_storage_change_minor=-100_000, identity_delta_minor=-100_000))
    assert result.score == 0.0
    assert result.band == "NONE"


def test_saving_strength_zero_storage_is_none():
    assert saving_strength(_financial(net_storage_change_minor=0, identity_delta_minor=0)).band == "NONE"


def test_saving_strength_without_income_credits_positive_storage_at_half():
    result = saving_strength(_financial(external_income_minor=0, net_storage_change_minor=200_000))
    assert result.score == 0.5
    rate = next(f for f in result.factors if f.name == "storage_rate")
    assert rate.value is None  # undefined, honestly


# --------------------------------------------------------- investment outflow


def test_investment_outflow_scales_with_ratio_not_absorption():
    assert investment_outflow(_financial()).band == "NONE"
    mid = investment_outflow(_financial(investment_export_minor=200_000, investment_export_count=2))
    assert mid.score == 0.4
    full = investment_outflow(_financial(investment_export_minor=500_000, investment_export_count=3))
    assert full.score == 1.0
    assert full.band == "STRONG"


def test_investment_outflow_without_income_is_capped_half():
    result = investment_outflow(_financial(external_income_minor=0, investment_export_minor=300_000))
    assert result.score == 0.5


# ----------------------------------------------------------------- vitality


def test_vitality_is_amount_free_and_count_based():
    base = vitality(_activity(), income_present=True)
    # Same counts, different amounts: PeriodActivity carries no amounts except
    # largest_consumption (outlier disclosure) — vitality must ignore it.
    same = vitality(_activity(largest_consumption_minor=10_000_000), income_present=True)
    assert base.score == same.score


def test_vitality_full_score_reference_period():
    result = vitality(_activity(active_days=22, longest_inactive_streak=2, distinct_life_scenes=6), True)
    assert result.score == 1.0
    assert result.band == "THRIVING"


def test_vitality_empty_period_is_dormant():
    result = vitality(_activity(active_days=0, longest_inactive_streak=31, distinct_life_scenes=0,
                                consumption_count=0, income_count=0), False)
    assert result.score == 0.0
    assert result.band == "DORMANT"


def test_vitality_long_dead_window_penalised():
    alive = vitality(_activity(longest_inactive_streak=5), True)
    dead = vitality(_activity(longest_inactive_streak=18), True)
    assert dead.score < alive.score


# ---------------------------------------------------------------- stability


def test_stability_reference_month_is_solid():
    result = stability(_financial(), _activity())
    assert result.band == "SOLID"
    assert result.score == 1.0


def test_stability_drops_when_spending_overruns_income():
    calm = stability(_financial(net_life_consumption_minor=500_000), _activity())
    overrun = stability(_financial(net_life_consumption_minor=1_200_000,
                                   net_storage_change_minor=-200_000,
                                   identity_delta_minor=-200_000), _activity())
    assert overrun.score < calm.score


def test_stability_empty_period_gets_no_default_credit():
    result = stability(
        _financial(external_income_minor=0, life_consumption_minor=0,
                   net_life_consumption_minor=0, net_storage_change_minor=0,
                   identity_delta_minor=0),
        _activity(active_days=0, longest_inactive_streak=31, distinct_life_scenes=0,
                  consumption_count=0, income_count=0, total_transaction_count=0),
    )
    assert result.score < 0.2


def test_stability_penalises_extreme_single_transaction():
    spread = stability(_financial(), _activity(largest_consumption_minor=100_000))
    concentrated = stability(_financial(), _activity(largest_consumption_minor=550_000))
    assert concentrated.score < spread.score


def test_stability_penalises_unreconciled_amount():
    clean = stability(_financial(), _activity())
    dirty = stability(_financial(unreconciled_minor=300_000, balanced=False,
                                 identity_delta_minor=100_000), _activity())
    assert dirty.score < clean.score


# -------------------------------------------------------------- data health


def test_data_health_healthy_when_no_gaps():
    result = data_health(_financial(), UnresolvedSummary(0, 0, 0, 0, 0), _activity())
    assert result.score == 1.0
    assert result.band == "HEALTHY"


def test_data_health_drops_with_unresolved_items():
    gaps = UnresolvedSummary(transfer_legs=5, refunds=3, unknown_transactions=2, energy_unknown_count=2,
                             unreconciled_minor=100_000)
    result = data_health(_financial(), gaps, _activity(total_transaction_count=30))
    assert result.score < 1.0
    assert result.band != "HEALTHY"
    flags = next(f for f in result.factors if f.name == "unresolved_flag_ratio")
    assert flags.value == 10 / 30
