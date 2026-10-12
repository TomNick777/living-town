"""Town State scoring: deterministic, explainable, unit-testable.

每 个 指标 = 纯函数(聚合输入) -> MetricResult(score + band + factors)。
设计约束(任务书核心语义):

- 不用量化金额表达"好":vitality 只看活跃天数 / 场景广度 / 连续性 /
  收入在场,金额结构性不参与——「花得越多小镇越繁荣」被排除;
- 每个分数都能回答"为什么"(factors + rules_version);
- 边界行为显式定义:收入为 0 的月份、无活动月份、大额一次性支出;
- float 只出现在 0..1 评分;权威金额永远整数分。
"""

from __future__ import annotations

from dataclasses import dataclass

from . import rules
from .models import Factor, FinancialSummary, MetricResult, UnresolvedSummary


@dataclass(frozen=True)
class PeriodActivity:
    """Count-based aggregates of one period (amounts only for the outlier
    disclosure, never for vitality)."""

    days_in_period: int
    active_days: int                    # days with >= 1 consumption or income tx
    longest_inactive_streak: int        # longest run of days with no activity
    distinct_life_scenes: int           # distinct consumption scenes (excl. INVESTMENT)
    consumption_count: int
    income_count: int
    largest_consumption_minor: int
    total_transaction_count: int


def _clamp01(value: float) -> float:
    return max(0.0, min(1.0, value))


def _round6(value: float) -> float:
    """Scores are presentation-grade 0..1 floats; rounding kills binary
    accumulation noise (0.4+0.3+0.2+0.1 -> 1.0) and stays deterministic."""
    return round(value, 6)


def _band(score: float, bands: tuple[tuple[float, str], ...]) -> str:
    for threshold, label in bands:
        if score < threshold:
            return label
    return bands[-1][1]


# ------------------------------------------------------------------ vitality


def vitality(activity: PeriodActivity, income_present: bool) -> MetricResult:
    """生活活跃度:生活是否在持续发生。金额不参与。

    coverage   活跃天数 / 目标天数(封顶 1.0)——日常生活持续发生;
    breadth    不同生活场景数 / 目标场景数(封顶 1.0)——生活有广度;
    continuity 最长无活动空窗 <= 10 天满分,线性降到 20 天归零;
    income     外部收入是否在场(权重最小;收入主要归 stability)。
    """
    target_days = min(rules.VITALITY_COVERAGE_TARGET_DAYS, activity.days_in_period)
    coverage = _clamp01(activity.active_days / target_days) if target_days else 0.0
    breadth = _clamp01(activity.distinct_life_scenes / rules.VITALITY_BREADTH_TARGET_SCENES)
    allowance = rules.VITALITY_CONTINUITY_STREAK_ALLOWANCE_DAYS
    continuity = (
        1.0
        if activity.longest_inactive_streak <= allowance
        else _clamp01(1 - (activity.longest_inactive_streak - allowance) / allowance)
    )
    income = 1.0 if income_present else 0.0

    score = _round6(
        rules.VITALITY_WEIGHT_COVERAGE * coverage
        + rules.VITALITY_WEIGHT_BREADTH * breadth
        + rules.VITALITY_WEIGHT_CONTINUITY * continuity
        + rules.VITALITY_WEIGHT_INCOME * income
    )
    return MetricResult(
        metric="vitality",
        score=score,
        band=_band(score, rules.BAND_VITALITY),
        factors=[
            Factor("active_day_coverage", coverage,
                   f"active_days={activity.active_days}/{activity.days_in_period}, target={target_days}"),
            Factor("scene_breadth", breadth,
                   f"distinct_life_scenes={activity.distinct_life_scenes}, "
                   f"target={rules.VITALITY_BREADTH_TARGET_SCENES}"),
            Factor("continuity", continuity,
                   f"longest_inactive_streak={activity.longest_inactive_streak}d, "
                   f"allowance={allowance}d"),
            Factor("income_present", income,
                   "external income present in period" if income_present
                   else "no external income in period"),
            Factor("amounts_involved", 0,
                   "spending amounts are structurally excluded from vitality"),
        ],
    )


# ----------------------------------------------------------------- stability


def stability(financial: FinancialSummary, activity: PeriodActivity) -> MetricResult:
    """生活系统稳定度:收入在场、收支从容、有正结余、未决占比小、
    无极端集中支出。空窗月份拿不到"未发现问题"的默认分。"""
    income_present = 1.0 if financial.external_income_minor > 0 else 0.0

    if financial.net_storage_change_minor > 0:
        storage = 1.0
    elif financial.net_storage_change_minor == 0:
        storage = 0.5
    else:
        storage = 0.0

    net_consumption = financial.net_life_consumption_minor
    if financial.external_income_minor > 0 and net_consumption == 0:
        budget = 1.0
    elif financial.external_income_minor == 0:
        budget = 0.0  # 无收入(含纯非工资月):开销无收入覆盖,不给分
    else:
        ratio = net_consumption / financial.external_income_minor
        comfort = rules.STABILITY_BUDGET_COMFORT_RATIO
        failure = rules.STABILITY_BUDGET_FAILURE_RATIO
        budget = 1.0 if ratio <= comfort else _clamp01(1 - (ratio - comfort) / (failure - comfort))

    flow = (financial.external_income_minor
            + financial.life_consumption_minor
            + financial.investment_export_minor)
    if flow > 0:
        unreconciled_ratio = financial.unreconciled_minor / flow
        unreconciled = _clamp01(1 - unreconciled_ratio / rules.STABILITY_UNRECONCILED_TOLERANCE_RATIO)
    else:
        unreconciled_ratio = None
        unreconciled = 0.0  # 无生活流量可评估:不给默认分

    if activity.consumption_count == 0:
        outlier = 0.0
        concentration = None
    elif activity.consumption_count < rules.STABILITY_OUTLIER_MIN_SAMPLE:
        outlier = 0.5  # 样本不足以判断模式,诚实给半分
        concentration = None
    else:
        concentration = activity.largest_consumption_minor / financial.life_consumption_minor
        threshold = rules.STABILITY_OUTLIER_CONCENTRATION_THRESHOLD
        outlier = 1.0 if concentration <= threshold else _clamp01(1 - (concentration - threshold) / (1 - threshold))

    score = _round6(
        rules.STABILITY_WEIGHT_INCOME * income_present
        + rules.STABILITY_WEIGHT_STORAGE * storage
        + rules.STABILITY_WEIGHT_BUDGET * budget
        + rules.STABILITY_WEIGHT_UNRECONCILED * unreconciled
        + rules.STABILITY_WEIGHT_OUTLIER * outlier
    )
    factors = [
        Factor("income_present", income_present,
               f"external_income={financial.external_income_minor}"),
        Factor("positive_storage", storage,
               f"net_storage_change={financial.net_storage_change_minor}"),
        Factor("budget_balance", budget,
               f"net_consumption={net_consumption}, income={financial.external_income_minor}"),
        Factor("unreconciled_ratio", unreconciled_ratio if unreconciled_ratio is not None else 0,
               f"unreconciled={financial.unreconciled_minor}, flow={flow}"),
        Factor("extreme_outlier", outlier,
               "largest_single_consumption="
               f"{activity.largest_consumption_minor}, "
               f"consumption_count={activity.consumption_count}"
               + ("" if concentration is None else f", concentration={concentration:.4f}"),
               ),
    ]
    return MetricResult(
        metric="stability",
        score=score,
        band=_band(score, rules.BAND_STABILITY),
        factors=factors,
    )


# ------------------------------------------------------ consumption pressure


def consumption_pressure(
    financial: FinancialSummary, largest_consumption_minor: int = 0
) -> MetricResult:
    """消费压力 = 净生活消耗对外部收入的挤压。

    income > 0:ratio = net_consumption / income;score = clamp(ratio, 0, 1);
                <= 50% LOW, <= 85% NORMAL, < 100% HIGH, >= 100% EXTREME。
    income = 0:无消耗 -> LOW(无压力);有消耗 -> EXTREME——没有外部收入
                还在消耗就是最大压力。非工资月按定义如实读高,解释里
                明示原因;大额一次性事件通过 largest_single 暴露,不改分数。
    """
    net = financial.net_life_consumption_minor
    income = financial.external_income_minor
    largest_share = (
        largest_consumption_minor / financial.life_consumption_minor
        if financial.life_consumption_minor > 0
        else None
    )

    if income > 0:
        ratio = net / income
        score = _clamp01(ratio)
        if ratio <= rules.PRESSURE_NORMAL_RATIO:
            band = "LOW"
        elif ratio <= rules.PRESSURE_HIGH_RATIO:
            band = "NORMAL"
        elif ratio < 1.0:
            band = "HIGH"
        else:
            band = "EXTREME"
    elif net == 0:
        ratio = None
        score = 0.0
        band = "LOW"
    else:
        ratio = None
        score = 1.0
        band = "EXTREME"

    factors = [
        Factor("net_life_consumption_minor", net,
               f"gross={financial.life_consumption_minor}, returned={financial.energy_return_minor}"),
        Factor("external_income_minor", income,
               "non-salary month: income legitimately 0" if income == 0 and net > 0 else ""),
    ]
    if ratio is not None:
        factors.append(Factor("consumption_to_income_ratio", ratio,
                              "score = clamp(ratio, 0, 1)"))
    else:
        factors.append(Factor("consumption_to_income_ratio", None,
                              "undefined: no external income in period"))
    if largest_share is not None:
        factors.append(Factor("largest_single_share", largest_share,
                              f"largest_single_consumption={largest_consumption_minor}; "
                              "disclosure only: one-off events do not change the score"))
    return MetricResult(metric="consumption_pressure", score=score, band=band, factors=factors)


# ------------------------------------------------------------ saving strength


def saving_strength(financial: FinancialSummary) -> MetricResult:
    """结余/储能能力 = net_storage_change 相对外部收入的留存率。

    income > 0:rate = net_storage / income,score = clamp(rate / 30%, 0, 1);
    income = 0:正结余给固定半分(可能来自退款/回流,不可归因于收入),
                负结余或零结余为 0。
    """
    net = financial.net_storage_change_minor
    income = financial.external_income_minor
    if income > 0:
        rate = net / income
        score = _clamp01(rate / rules.SAVING_TARGET_RATE)
    elif net > 0:
        rate = None
        score = rules.SAVING_NO_INCOME_CREDIT
    else:
        rate = None
        score = 0.0

    if net <= 0 and score == 0.0:
        band = "NONE"
    else:
        band = _band(score, rules.BAND_GENERIC)

    factors = [
        Factor("net_storage_change_minor", net, "signed cash-system net flow"),
        Factor("external_income_minor", income, ""),
    ]
    if rate is not None:
        factors.append(Factor("storage_rate", rate,
                              f"score = clamp(rate / {rules.SAVING_TARGET_RATE}, 0, 1)"))
    else:
        factors.append(Factor("storage_rate", None,
                              "undefined: no external income; positive storage "
                              "credited at fixed 0.5 (source not attributable to income)"))
    return MetricResult(metric="saving_strength", score=score, band=band, factors=factors)


# --------------------------------------------------------- investment outflow


def investment_outflow(financial: FinancialSummary) -> MetricResult:
    """生活系统向海獭控股(外部资本系统)输送资金的强度。

    amount/count 直接来自 ENERGY_EXPORT;ratio = export / income,
    达到 50% 即满分。投资外输永远不进 life_consumption(数据层不变量)。
    """
    export = financial.investment_export_minor
    income = financial.external_income_minor
    if export == 0:
        score, band, ratio = 0.0, "NONE", None
    elif income > 0:
        ratio = export / income
        score = _clamp01(ratio / rules.INVESTMENT_TARGET_RATIO)
        band = _band(score, rules.BAND_GENERIC)
    else:
        ratio = None
        score = rules.INVESTMENT_NO_INCOME_CREDIT
        band = _band(score, rules.BAND_GENERIC)

    factors = [
        Factor("investment_export_minor", export, "ENERGY_EXPORT volume"),
        Factor("investment_export_count", financial.investment_export_count, ""),
        Factor("investment_import_minor", financial.investment_import_minor,
               "context: capital flowing back (not part of this score)"),
    ]
    if ratio is not None:
        factors.append(Factor("export_to_income_ratio", ratio,
                              f"score = clamp(ratio / {rules.INVESTMENT_TARGET_RATIO}, 0, 1)"))
    else:
        factors.append(Factor("export_to_income_ratio", None,
                              "undefined: no external income" if export > 0 else "no export"))
    return MetricResult(metric="investment_outflow", score=score, band=band, factors=factors)


# ---------------------------------------------------------------- data health


def data_health(
    financial: FinancialSummary, unresolved: UnresolvedSummary, activity: PeriodActivity
) -> MetricResult:
    """小镇数据健康度:未决行占比 + 未决金额占比,线性扣分。

    未决状态如实进入并拉低健康度,但绝不反过来修改财务事实。
    """
    flags = unresolved.transfer_legs + unresolved.refunds + unresolved.unknown_transactions
    total = activity.total_transaction_count
    flag_ratio = flags / total if total else 0.0

    flow = (financial.external_income_minor
            + financial.life_consumption_minor
            + financial.investment_export_minor)
    if flow > 0:
        amount_ratio = financial.unreconciled_minor / flow
    else:
        amount_ratio = 1.0 if financial.unreconciled_minor > 0 else 0.0

    score = _round6(_clamp01(1 - flag_ratio - amount_ratio))
    factors = [
        Factor("unresolved_flag_ratio", flag_ratio,
               f"flags={flags} (legs={unresolved.transfer_legs}, refunds={unresolved.refunds}, "
               f"unknown={unresolved.unknown_transactions}) / transactions={total}"),
        Factor("unreconciled_amount_ratio", amount_ratio,
               f"unreconciled={financial.unreconciled_minor}, flow={flow}"),
        Factor("balanced", 1.0 if financial.balanced else 0.0,
               "energy identity holds" if financial.balanced else
               f"identity_delta={financial.identity_delta_minor} != "
               f"net_storage={financial.net_storage_change_minor}"),
    ]
    return MetricResult(
        metric="data_health",
        score=score,
        band=_band(score, rules.BAND_DATA_HEALTH),
        factors=factors,
    )
