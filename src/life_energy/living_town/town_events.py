"""TownEvent projection: ledger facts -> city world (the formal boundary).

生活小镇 Data Driven City 的中间层。账本事实在进入表达层之前，
先在这里被投影成确定性的「城市事件」文档：

    canonical ledger -> build_town_events -> /api/town-events -> web replay

边界承诺：

- 只读：不写 Raw Evidence、不改 canonical facts，浏览器不解释流水；
- 事件是表达层语义：target 指向 9 类生活建筑，不是 canonical 字段；
- 集中管理映射：category -> target 与商户关键词都只在本文件，
  不允许散落在 renderer 的 if/else 里；
- 不猜：无法识别的分类 -> target = "unknown"，不制造虚假动画；
  无法识别的商户绝不伪造 merchant；不为降低 unknown 比例而猜分类；
- 时间诚实：来源只有日期（00:00:00）的事件 time_precision = "DAY"，
  replay 顺序时间是演示槽位（presentation_time = true），不是事实时间；
- 转账 / 退款 / 投资不是小镇生活活动，不产生城市事件；
  非工资收入（返利等）同样不投影——小镇没有对应建筑，不猜。

V2（town-event-rules-v2）新增 behavior 语义层：同一笔事实用什么
「城市行为」表达由 (target, direction) 决定——

    VISIT    到访生活设施（餐饮 / 咖啡 / 商超 / 医疗 / 娱乐）；
    TRANSIT  交通消费的城市表现（车站乘客流），不是真实 GPS 行程；
    DELIVERY 网购快递的表现隐喻（配送员从宅配站到住宅），不是事实位置；
    CREDIT   工资等明确收入的入账反馈（办公楼 pulse，不生成「人到办公室」）；
    PASSIVE  有城市含义但人不移动的事件（房租 / 水电 / 话费 / 家庭支出）；
    UNKNOWN  证据不足，保持诚实 no-op。

这些都是 presentation semantics：城市不重建事实位置，也不产生任何
财务事实。金额保持整数分；intensity 只做对数归一化（0.15..1），
金额不等于人数。
"""

from __future__ import annotations

import math
import sqlite3
from datetime import datetime, timezone

from ..ledger.queries import month_bounds

TOWN_EVENTS_VERSION = "town-events-v2"
TOWN_EVENT_RULES_VERSION = "town-event-rules-v2"

# V2 支持 9 类生活建筑 + unknown（不猜）。target 是语义目标类型，
# 不是具体场景建筑——同一 target type 可以对应多栋 scene building。
TARGETS = (
    "home", "office", "restaurant", "cafe", "supermarket", "logistics",
    "transit", "clinic", "leisure", "unknown",
)

EVENT_TYPES = (
    "DINING", "COFFEE", "GROCERY", "PARCEL", "HOUSEHOLD", "WORK",
    "TRANSIT", "HEALTH", "LEISURE", "UNKNOWN",
)

BEHAVIORS = ("VISIT", "TRANSIT", "DELIVERY", "CREDIT", "PASSIVE", "UNKNOWN")

# ----------------------------------------------------------- 集中映射表
# category -> (event type, target, behavior)。只列有真实依据的分类；
# 其余分类（OTHER_EXPENSE / SERVICES / 未分类）显式落在 UNKNOWN。
# 电商/快递关键词优先于分类映射（淘宝买药也是网购：DELIVERY 更诚实）。
CATEGORY_TO_TARGET: dict[str, tuple[str, str, str]] = {
    "TRANSPORT": ("TRANSIT", "transit", "TRANSIT"),
    "HEALTH": ("HEALTH", "clinic", "VISIT"),
    "ENTERTAINMENT": ("LEISURE", "leisure", "VISIT"),
    "SHOPPING": ("GROCERY", "supermarket", "VISIT"),
    "HOUSING": ("HOUSEHOLD", "home", "PASSIVE"),
    "TELECOM": ("HOUSEHOLD", "home", "PASSIVE"),
    "FAMILY": ("HOUSEHOLD", "home", "PASSIVE"),
}

# 商户关键词（子串、大小写不敏感）。它们只在表达层区分「同一分类里
# 的不同去处」，不是新的分类体系；每条命中都会写进事件 provenance。
CAFE_MERCHANT_KEYWORDS = (
    "coffee", "luckin", "咖啡", "奶茶", "茶饮", "蜜雪冰城", "茶百道",
    "贡茶", "书亦", "益禾堂", "古茗", "沪上阿姨", "喜茶", "奈雪",
    "星巴克", "coco", "7分甜",
)
# FOOD 分类里明确是商超/便利店铺型的（商超熟食、便利店餐食）。
MARKET_MERCHANT_KEYWORDS = ("超市", "便利店", "商场", "百货", "商行", "食杂", "士多")
# 电商 / 快递平台：非 FOOD 消费命中即送 logistics（如 SERVICES 下的顺丰）。
PARCEL_MERCHANT_KEYWORDS = (
    "拼多多", "京东", "淘宝", "天猫", "唯品会", "小红书", "顺丰", "邮政",
    "ems", "快递", "得物", "闲鱼", "抖店", "抖音商城", "苏宁易购",
)

# ------------------------------------------------------- intensity 归一化
# log10(1 + 元) / 3：¥10 ≈ 0.35，¥100 ≈ 0.67，¥1000 = 1.0。
# 下限 0.15 让小额也有「发生感」。金额永远不直接等于人数。
INTENSITY_MIN = 0.15
INTENSITY_LOG_DENOMINATOR = 3.0


def intensity_for_amount(amount_minor: int) -> float:
    yuan = max(0, amount_minor) / 100
    raw = math.log10(1.0 + yuan) / INTENSITY_LOG_DENOMINATOR
    return round(min(1.0, max(INTENSITY_MIN, raw)), 4)


_SELECT = """
SELECT t.transaction_id, t.occurred_at, t.counterparty, t.description,
       t.amount_minor, t.currency, t.direction, t.transaction_type,
       i.category_code, c.name AS category_name
FROM transactions t
LEFT JOIN transaction_interpretation i ON i.transaction_id = t.transaction_id
LEFT JOIN categories c ON c.code = i.category_code
WHERE t.occurred_at >= ? AND t.occurred_at < ?
  AND (t.transaction_type = 'EXPENSE'
       OR (t.transaction_type = 'INCOME' AND i.category_code = 'SALARY'))
"""


def _schedule_day_events(day_events: list[dict]) -> tuple[int, int]:
    """Assign intra-day schedule_seconds; returns (event_count, precise_count)."""
    precise = [e for e in day_events if e["time_precision"] == "SECOND"]
    day_slots = len(day_events) - len(precise)
    slot_index = 0
    for event in sorted(day_events, key=lambda e: (e["occurred_at"], e["transaction_id"])):
        if event["time_precision"] == "SECOND":
            event["schedule_seconds"] = event["time_of_day_seconds"]
        else:
            if day_slots <= 0:
                event["schedule_seconds"] = 43200
            else:
                event["schedule_seconds"] = int((slot_index + 0.5) / day_slots * 86400)
            event["presentation_time"] = True
            slot_index += 1
    return len(day_events), len(precise)


def _apply_period_montage_schedule(events: list[dict]) -> None:
    """Flatten a period into one presentation timeline (facts unchanged)."""
    by_day: dict[str, list[dict]] = {}
    for event in events:
        by_day.setdefault(event["occurred_at"][:10], []).append(event)
    ordered: list[dict] = []
    for day in sorted(by_day):
        day_events = by_day[day]
        _schedule_day_events(day_events)
        day_events.sort(
            key=lambda e: (e["schedule_seconds"], e["occurred_at"], e["transaction_id"]),
        )
        ordered.extend(day_events)
    total = len(ordered)
    for index, event in enumerate(ordered):
        if total == 0:
            event["schedule_seconds"] = 0
        else:
            event["schedule_seconds"] = int((index + 0.5) / total * 86400)
        event["presentation_time"] = True


def build_town_events_document(
    conn: sqlite3.Connection,
    start: str,
    end: str,
    *,
    period_key: str,
    presentation_mode: str = "day",
    generated_at: str | None = None,
) -> dict:
    """Range-scoped TownEvent document; day = per-day replay, period_montage =缩时。"""
    rows = [dict(row) for row in conn.execute(_SELECT, (start, end)).fetchall()]
    projected = [project_row(row) for row in rows]
    by_day: dict[str, list[dict]] = {}
    for event in projected:
        by_day.setdefault(event["occurred_at"][:10], []).append(event)

    events: list[dict] = []
    days: list[dict] = []
    for day in sorted(by_day):
        day_events = by_day[day]
        event_count, precise_count = _schedule_day_events(day_events)
        events.extend(day_events)
        days.append({
            "date": day,
            "event_count": event_count,
            "precise_time_count": precise_count,
        })

    if presentation_mode == "period_montage":
        _apply_period_montage_schedule(events)
    else:
        events.sort(key=lambda e: (e["schedule_seconds"], e["occurred_at"], e["transaction_id"]))

    presentation = None
    if presentation_mode == "period_montage":
        presentation = {
            "version": "town-period-presentation-v1",
            "mode": "period_montage",
            "montage_label": period_key,
            "timeline_seconds": 86400,
            "event_count": len(events),
        }

    payload: dict = {
        "projection_version": TOWN_EVENTS_VERSION,
        "rules_version": TOWN_EVENT_RULES_VERSION,
        "generated_at": generated_at or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S+00:00"),
        "month": period_key,
        "coverage": coverage_summary(events),
        "days": days,
        "events": events,
    }
    if presentation is not None:
        payload["presentation"] = presentation
    return payload


def build_town_events(
    conn: sqlite3.Connection,
    month: str,
    *,
    generated_at: str | None = None,
) -> dict:
    """Month-scoped TownEvent document. Deterministic given (db, month, clock)."""
    start, end = month_bounds(month)
    return build_town_events_document(
        conn,
        start,
        end,
        period_key=month,
        presentation_mode="day",
        generated_at=generated_at,
    )


def coverage_summary(events: list[dict]) -> dict:
    """Town Visualization Coverage：多少真实事件拥有城市表现。

    这是表达层对自身投影的统计（mapped = target != unknown），
    不是「识别准确率」——unknown 是诚实的一等公民。确定性：
    同一事件列表永远得到同一统计。
    """
    total = len(events)
    unknown = [e for e in events if e["target"] == "unknown"]
    by_category: dict[str, dict] = {}
    for event in unknown:
        code = event["category_code"] or "NONE"
        bucket = by_category.setdefault(code, {
            "category_code": event["category_code"],
            "category_name": event["category_name"],
            "count": 0,
        })
        bucket["count"] += 1
    ranked = sorted(by_category.values(), key=lambda b: (-b["count"], b["category_code"] or "NONE"))
    return {
        "total": total,
        "mapped": total - len(unknown),
        "unknown": len(unknown),
        "unknown_ratio": round(len(unknown) / total, 4) if total else 0.0,
        "unknown_by_category": ranked,
    }


def project_row(row: dict) -> dict:
    category = row["category_code"]
    merchant = (row["counterparty"] or "").strip()
    merchant_lower = merchant.lower()

    if row["transaction_type"] == "INCOME" and category == "SALARY":
        # presentation semantics：工资到账 = 办公楼收入反馈，不是「用户人在办公楼」。
        event_type, target, behavior, rule = "WORK", "office", "CREDIT", "category:SALARY->office"
    elif category == "FOOD":
        cafe_kw = _first_keyword(merchant_lower, CAFE_MERCHANT_KEYWORDS)
        market_kw = _first_keyword(merchant_lower, MARKET_MERCHANT_KEYWORDS)
        if cafe_kw is not None:
            event_type, target, behavior, rule = "COFFEE", "cafe", "VISIT", f"merchant-kw:{cafe_kw}->cafe"
        elif market_kw is not None:
            event_type, target, behavior, rule = "GROCERY", "supermarket", "VISIT", f"merchant-kw:{market_kw}->supermarket"
        else:
            event_type, target, behavior, rule = "DINING", "restaurant", "VISIT", "category:FOOD->restaurant"
    else:
        parcel_kw = _first_keyword(merchant_lower, PARCEL_MERCHANT_KEYWORDS)
        if parcel_kw is not None:
            # presentation metaphor：网购 = 配送行为，不是「用户走到物流中心」。
            event_type, target, behavior, rule = "PARCEL", "logistics", "DELIVERY", f"merchant-kw:{parcel_kw}->logistics"
        elif category in CATEGORY_TO_TARGET:
            event_type, target, behavior = CATEGORY_TO_TARGET[category]
            rule = f"category:{category}->{target}"
        else:
            event_type, target, behavior, rule = "UNKNOWN", "unknown", "UNKNOWN", f"category:{category or 'NONE'}->unknown"

    occurred_at = row["occurred_at"]
    # 00:00:00 的来源几乎都是只有日期的账单（银行 CSV 等）；真实
    # 午夜整点交易无法与日期精度区分，一律按 DAY 演示，绝不伪装时刻。
    precise = occurred_at[11:19] != "00:00:00"
    hour = minute = second = 0
    if precise:
        hour, minute, second = int(occurred_at[11:13]), int(occurred_at[14:16]), int(occurred_at[17:19])

    return {
        "id": f"te:{row['transaction_id']}",
        "transaction_id": row["transaction_id"],
        "occurred_at": occurred_at,
        "time_precision": "SECOND" if precise else "DAY",
        "time_of_day_seconds": hour * 3600 + minute * 60 + second,
        "presentation_time": False,
        "type": event_type,
        "category_code": category,
        "category_name": row["category_name"],
        "merchant": merchant or None,
        "description": row["description"],
        "amount_minor": row["amount_minor"],
        "currency": row["currency"],
        "direction": "income" if row["direction"] == "INFLOW" else "expense",
        "target": target,
        "behavior": behavior,
        "intensity": intensity_for_amount(row["amount_minor"]),
        "rule": rule,
        "transaction_type": row["transaction_type"],
    }


def _first_keyword(merchant_lower: str, keywords: tuple[str, ...]) -> str | None:
    for keyword in keywords:
        if keyword in merchant_lower:
            return keyword
    return None
