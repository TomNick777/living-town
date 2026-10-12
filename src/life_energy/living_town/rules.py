"""Deterministic rules and constants for the Living Town projection.

生活小镇是表达层世界观（docs/life-town.md），Town State 是它的唯一
派生状态入口。本模块只含常量与纯映射：

- 不写 Raw Evidence，不改 canonical transaction；
- 不建「建筑 ↔ 消费分类」映射——这里映射的是 scene（生活场景），
  它是 Town State 的聚合维度，不是任何 UI 载体；
- 所有阈值集中在此，改规则 = 升 RULES_VERSION，保证历史状态可解释。
"""

from __future__ import annotations

# 版本：projection 版本跟随输出结构，rules 版本跟随评分规则。
PROJECTION_VERSION = "living-town-v1"
RULES_VERSION = "town-rules-v1"

# ------------------------------------------------------------ life scenes

# 生活场景：派生聚合维度（不是 category 的别名，也不是 UI 概念）。
HOME = "HOME"
COMMUTE = "COMMUTE"
DINING_SOCIAL = "DINING_SOCIAL"
FAMILY = "FAMILY"
DAILY_CONVENIENCE = "DAILY_CONVENIENCE"
LEARNING = "LEARNING"
HEALTH = "HEALTH"
LEISURE = "LEISURE"
CONSTRUCTION_PROJECT = "CONSTRUCTION_PROJECT"
INVESTMENT = "INVESTMENT"
OTHER = "OTHER"

LIFE_SCENES = (
    HOME,
    COMMUTE,
    DINING_SOCIAL,
    FAMILY,
    DAILY_CONVENIENCE,
    LEARNING,
    HEALTH,
    LEISURE,
    CONSTRUCTION_PROJECT,
    INVESTMENT,
    OTHER,
)

# 参与「生活广度」的场景 = 生活消费场景（INVESTMENT 是对海獭控股的
# 外输连接，不算小镇内部生活气息）。
CONSUMPTION_SCENES = tuple(scene for scene in LIFE_SCENES if scene != INVESTMENT)

# v1：category -> scene 的确定性映射（docs/living-town-projection.md）。
# scene 不等于 category：多个 category 可落入同一 scene（HOUSING 与
# TELECOM 都是 HOME）。未分类 / 未知 category 落 OTHER，绝不猜测。
CATEGORY_TO_SCENE = {
    "FOOD": DINING_SOCIAL,
    "HOUSING": HOME,
    "TRANSPORT": COMMUTE,
    "FAMILY": FAMILY,
    "TELECOM": HOME,
    "ENTERTAINMENT": LEISURE,
    "HEALTH": HEALTH,
    "SHOPPING": DAILY_CONVENIENCE,
    "SERVICES": DAILY_CONVENIENCE,
    "EDUCATION": LEARNING,
    "OTHER_EXPENSE": OTHER,
}

# ---------------------------------------------------- vitality thresholds

# 活跃天数达到目标即满分：更多天数不再加分，金额完全不参与——
# 「花得越多小镇越繁荣」被这里结构性排除。
VITALITY_COVERAGE_TARGET_DAYS = 20
VITALITY_BREADTH_TARGET_SCENES = 6
# 最长连续无活动天数 <= 10 视为连续生活；超过线性降分，20 天以上为 0。
VITALITY_CONTINUITY_STREAK_ALLOWANCE_DAYS = 10
VITALITY_WEIGHT_COVERAGE = 0.4
VITALITY_WEIGHT_BREADTH = 0.3
VITALITY_WEIGHT_CONTINUITY = 0.2
VITALITY_WEIGHT_INCOME = 0.1

# ---------------------------------------------------- stability thresholds

STABILITY_WEIGHT_INCOME = 0.25
STABILITY_WEIGHT_STORAGE = 0.2
STABILITY_WEIGHT_BUDGET = 0.3
STABILITY_WEIGHT_UNRECONCILED = 0.15
STABILITY_WEIGHT_OUTLIER = 0.1
# 净消耗 / 外部收入 在此比例内视为收支从容。
STABILITY_BUDGET_COMFORT_RATIO = 0.7
# 超过此比例（花穿收入）预算因子归零；之间线性下降。
STABILITY_BUDGET_FAILURE_RATIO = 1.5
# 未决金额占生活系统总流量（收入+消耗+外输）的比例上限。
STABILITY_UNRECONCILED_TOLERANCE_RATIO = 0.15
# 单笔最大消耗占当期毛消耗超过此值视为集中/极端支出。
STABILITY_OUTLIER_CONCENTRATION_THRESHOLD = 0.8
# 消耗笔数不足时极端支出因子给半分（样本不足以判断模式）。
STABILITY_OUTLIER_MIN_SAMPLE = 3

# ------------------------------------------- consumption_pressure thresholds

# net_life_consumption / external_income 的分档边界。
PRESSURE_NORMAL_RATIO = 0.5   # <= 50% LOW
PRESSURE_HIGH_RATIO = 0.85    # <= 85% NORMAL, 之下 HIGH
# >= 100% EXTREME（花穿当期收入）；score = clamp(ratio, 0, 1)。

# ---------------------------------------------------- saving_strength

# 净结余 / 外部收入 达到 30% 即满分（线性）。
SAVING_TARGET_RATE = 0.3
# 无收入月份的正结余给固定半分（来源可能是退款/回流，不可归因于收入）。
SAVING_NO_INCOME_CREDIT = 0.5

# ------------------------------------------------- investment_outflow

# 投资外输 / 外部收入 达到 50% 即满分（线性）。
INVESTMENT_TARGET_RATIO = 0.5
# 无收入月份的投资外输给固定半分。
INVESTMENT_NO_INCOME_CREDIT = 0.5

# ------------------------------------------------------- data_health

# 未决行占比（未决笔数 / 期内交易数）与未决金额占比各自线性扣分。
DATA_HEALTH_FLAG_RATIO_CAP = 1.0
DATA_HEALTH_AMOUNT_RATIO_CAP = 1.0

# ------------------------------------------------------------- bands

BAND_VITALITY = ((0.25, "DORMANT"), (0.5, "QUIET"), (0.75, "ALIVE"), (1.01, "THRIVING"))
BAND_STABILITY = ((0.4, "FRAGILE"), (0.7, "MODERATE"), (1.01, "SOLID"))
BAND_GENERIC = ((0.4, "WEAK"), (0.7, "MODERATE"), (1.01, "STRONG"))
BAND_DATA_HEALTH = ((0.7, "NEEDS_WORK"), (0.9, "REVIEW"), (1.01, "HEALTHY"))
