"""TownEvent projection tests over a synthetic mini-ledger.

覆盖 Data Driven City 原型的核心承诺（V2）：
- transaction -> correct TownEvent（分类 / 商户关键词 -> 9 类建筑）；
- behavior 语义层：VISIT / TRANSIT / DELIVERY / CREDIT / PASSIVE / UNKNOWN
  与 (target, direction) 一致，provenance 可回答「为什么」；
- unknown 分类不猜建筑（target=unknown，无虚假动画来源），unknown
  是一等公民，不为覆盖率而猜分类；
- income（仅 SALARY）/ expense 的方向与事件类型；
- 映射确定性 + 事件顺序确定性 + coverage 统计确定性；
- intensity 对数归一化有界、单调；
- DATE 精度（00:00:00）不伪装成事实时间。

映射矩阵直接对纯函数 project_row 单测（不受分类种子覆盖面限制）；
集成测试走真实导入 -> 分类 -> 投影管线。
"""

from __future__ import annotations

from conftest import make_bank_csv, make_wechat_csv

from life_energy.accounts.service import ensure_account
from life_energy.classification.engine import classify_transactions
from life_energy.ingestion.bank.generic_csv import GenericCSVBankParser
from life_energy.ingestion.wechat import WechatParser
from life_energy.ledger.importer import import_file
from life_energy.living_town.town_events import (
    BEHAVIORS,
    INTENSITY_MIN,
    TARGETS,
    TOWN_EVENT_RULES_VERSION,
    TOWN_EVENTS_VERSION,
    build_town_events,
    coverage_summary,
    intensity_for_amount,
    project_row,
)

FIXED_CLOCK = "2026-09-09T00:00:00+00:00"


def _wechat_row(day: str, counterparty: str, goods: str, yuan: str, ref: str,
                time_of_day: str = "12:00:00", type_raw: str = "商户消费") -> str:
    return (f"2026-08-{day} {time_of_day},{type_raw},{counterparty},{goods},"
            f"支出,¥{yuan},零钱,支付成功,{ref},")


def _seed(conn, tmp_path, *, wechat_rows: list[str], bank_rows: list[str] | None = None):
    bank = ensure_account(conn, "招商银行(1234)")
    if bank_rows:
        import_file(conn, GenericCSVBankParser(),
                    make_bank_csv(tmp_path / "bank.csv", bank_rows),
                    fallback_account_id=bank)
    import_file(conn, WechatParser(),
                make_wechat_csv(tmp_path / "wx.csv", wechat_rows),
                fallback_account_id=ensure_account(conn, "微信零钱"))
    classify_transactions(conn)


def _events(conn, month="2026-08"):
    return build_town_events(conn, month, generated_at=FIXED_CLOCK)


def _by_ref(conn, month="2026-08") -> dict:
    """Map source_reference -> projected event (stable handle on one row)."""
    refs = {
        row["transaction_id"]: row["source_reference"]
        for row in conn.execute("SELECT transaction_id, source_reference FROM transactions")
    }
    return {refs[event["transaction_id"]]: event for event in _events(conn, month)["events"]}


def _row(category, merchant="某商户", amount_minor=3600, transaction_type="EXPENSE",
         direction="OUTFLOW", occurred_at="2026-08-02T12:20:00+08:00"):
    return {
        "transaction_id": 1,
        "occurred_at": occurred_at,
        "counterparty": merchant,
        "description": "des",
        "amount_minor": amount_minor,
        "currency": "CNY",
        "direction": direction,
        "transaction_type": transaction_type,
        "category_code": category,
        "category_name": None,
    }


# ------------------------------------------------- mapping matrix (pure)

def test_mapping_matrix_is_centralized_and_deterministic():
    cases = [
        (_row("FOOD", "麦当劳"), "restaurant", "DINING", "VISIT", "expense"),
        (_row("FOOD", "luckin coffee"), "cafe", "COFFEE", "VISIT", "expense"),
        (_row("FOOD", "永辉超市"), "supermarket", "GROCERY", "VISIT", "expense"),
        (_row("SHOPPING", "拼多多平台商户"), "logistics", "PARCEL", "DELIVERY", "expense"),
        (_row("SHOPPING", "714street"), "supermarket", "GROCERY", "VISIT", "expense"),
        (_row("SERVICES", "顺丰速运"), "logistics", "PARCEL", "DELIVERY", "expense"),
        (_row("SERVICES", "tb**3"), "unknown", "UNKNOWN", "UNKNOWN", "expense"),
        (_row("HOUSING", "国网福州"), "home", "HOUSEHOLD", "PASSIVE", "expense"),
        (_row("TELECOM", "中国移动"), "home", "HOUSEHOLD", "PASSIVE", "expense"),
        (_row("FAMILY", "家人"), "home", "HOUSEHOLD", "PASSIVE", "expense"),
        (_row("TRANSPORT", "中铁网络"), "transit", "TRANSIT", "TRANSIT", "expense"),
        (_row("TRANSPORT", "滴滴出行"), "transit", "TRANSIT", "TRANSIT", "expense"),
        (_row("HEALTH", "海王星辰药房"), "clinic", "HEALTH", "VISIT", "expense"),
        (_row("HEALTH", "淘宝闪购"), "logistics", "PARCEL", "DELIVERY", "expense"),
        (_row("ENTERTAINMENT", "万达影城"), "leisure", "LEISURE", "VISIT", "expense"),
        (_row(None, "无名小店"), "unknown", "UNKNOWN", "UNKNOWN", "expense"),
        (_row("SALARY", "公司", transaction_type="INCOME", direction="INFLOW"),
         "office", "WORK", "CREDIT", "income"),
        (_row("OTHER_INCOME", "返利", transaction_type="INCOME", direction="INFLOW"),
         "unknown", "UNKNOWN", "UNKNOWN", "income"),
    ]
    for row, target, event_type, behavior, direction in cases:
        event = project_row(row)
        assert (event["target"], event["type"], event["behavior"], event["direction"]) == (
            target, event_type, behavior, direction), row
    assert project_row(_row("FOOD", "麦当劳")) == project_row(_row("FOOD", "麦当劳"))


def test_keyword_hits_are_recorded_as_provenance():
    cafe = project_row(_row("FOOD", "luckin coffee"))
    parcel = project_row(_row("SHOPPING", "京东商城平台商户"))
    plain = project_row(_row("FOOD", "麦当劳"))
    assert cafe["rule"].startswith("merchant-kw:")
    assert parcel["rule"].startswith("merchant-kw:")
    assert plain["rule"] == "category:FOOD->restaurant"
    # behavior 由 (target, direction) 决定，provenance 能回答「为什么是这个行为」
    assert cafe["behavior"] == "VISIT" and cafe["target"] == "cafe"
    assert parcel["behavior"] == "DELIVERY" and parcel["target"] == "logistics"


def test_behavior_vocabulary_is_closed():
    for event in (project_row(_row(code, "某商户")) for code in
                  ("FOOD", "TRANSPORT", "HEALTH", "ENTERTAINMENT", "SHOPPING",
                   "HOUSING", "SERVICES", None)):
        assert event["behavior"] in BEHAVIORS
    assert set(BEHAVIORS) == {"VISIT", "TRANSIT", "DELIVERY", "CREDIT", "PASSIVE", "UNKNOWN"}


def test_v2_versions_are_declared():
    assert TOWN_EVENTS_VERSION == "town-events-v2"
    assert TOWN_EVENT_RULES_VERSION == "town-event-rules-v2"


# ------------------------------------------------------ integration (DB)

def test_food_expense_maps_to_restaurant(tmp_ledger, tmp_path):
    _seed(tmp_ledger, tmp_path, wechat_rows=[
        _wechat_row("02", "麦当劳", "巨无霸套餐", "36.00", "WMA"),
    ])
    event = _by_ref(tmp_ledger)["WMA"]
    assert event["target"] == "restaurant"
    assert event["behavior"] == "VISIT"
    assert event["direction"] == "expense"
    assert event["merchant"] == "麦当劳"
    assert event["amount_minor"] == 3600
    assert event["time_precision"] == "SECOND"
    assert event["time_of_day_seconds"] == 12 * 3600
    assert event["id"] == f"te:{event['transaction_id']}"


def test_salary_income_maps_office_other_income_excluded(tmp_ledger, tmp_path):
    _seed(tmp_ledger, tmp_path,
          wechat_rows=[_wechat_row("02", "麦当劳", "套餐", "30.00", "WMB")],
          bank_rows=["2026-08-01,代发工资 工资,10000.00,10000.00"])
    events = _events(tmp_ledger)["events"]
    income_events = [e for e in events if e["direction"] == "income"]
    assert len(income_events) == 1
    assert income_events[0]["target"] == "office"
    assert income_events[0]["type"] == "WORK"
    assert income_events[0]["behavior"] == "CREDIT"  # 入账反馈，不是「人到办公室」
    assert income_events[0]["time_precision"] == "DAY"  # bank CSV 只有日期


def test_transport_health_leisure_entertainment_integration(tmp_ledger, tmp_path):
    _seed(tmp_ledger, tmp_path, wechat_rows=[
        _wechat_row("02", "滴滴出行", "快车", "20.00", "WDD"),
        _wechat_row("03", "海王星辰大药房", "药品", "42.00", "WHL"),
        _wechat_row("04", "万达影城", "电影票", "60.00", "WLV"),
    ])
    events = _by_ref(tmp_ledger)
    assert events["WDD"]["target"] == "transit"
    assert events["WDD"]["behavior"] == "TRANSIT"
    assert events["WHL"]["target"] == "clinic"
    assert events["WHL"]["behavior"] == "VISIT"
    assert events["WLV"]["target"] == "leisure"
    assert events["WLV"]["behavior"] == "VISIT"


def test_household_is_passive_not_a_visit(tmp_ledger, tmp_path):
    _seed(tmp_ledger, tmp_path, wechat_rows=[
        _wechat_row("02", "自如", "八月房租", "2000.00", "WHR"),
        _wechat_row("03", "中国移动", "话费充值", "50.00", "WTC"),
    ])
    events = _by_ref(tmp_ledger)
    assert events["WHR"]["target"] == "home"
    assert events["WHR"]["behavior"] == "PASSIVE"
    assert events["WTC"]["target"] == "home"
    assert events["WTC"]["behavior"] == "PASSIVE"


def test_transfers_refunds_investments_are_not_town_events(tmp_ledger, tmp_path):
    _seed(tmp_ledger, tmp_path, wechat_rows=[
        _wechat_row("02", "零钱充值", "充值", "500.00", "WT1", type_raw="转账"),
    ])
    document = _events(tmp_ledger)
    assert document["events"] == []
    assert document["days"] == []


# ------------------------------------------------------------- coverage

def test_coverage_summary_counts_mapped_unknown_and_categories():
    events = [
        project_row(_row("FOOD", "麦当劳")),
        project_row(_row("TRANSPORT", "滴滴出行")),
        project_row(_row("TRANSPORT", "中铁网络")),
        project_row(_row("SERVICES", "tb**3")),
        project_row(_row(None, "无名")),
    ]
    coverage = coverage_summary(events)
    assert coverage["total"] == 5
    assert coverage["mapped"] == 3
    assert coverage["unknown"] == 2
    assert coverage["unknown_ratio"] == 0.4
    assert [b["category_code"] for b in coverage["unknown_by_category"]] == [None, "SERVICES"]
    assert coverage["unknown_by_category"][0]["count"] == 1


def test_document_carries_deterministic_coverage(tmp_ledger, tmp_path):
    _seed(tmp_ledger, tmp_path, wechat_rows=[
        _wechat_row("02", "麦当劳", "套餐", "30.00", "WC1"),
        _wechat_row("03", "tb**3", "杂项", "18.00", "WC2"),
    ])
    document = _events(tmp_ledger)
    assert document["projection_version"] == "town-events-v2"
    assert document["coverage"]["total"] == 2
    assert document["coverage"]["mapped"] == 1
    assert document["coverage"]["unknown"] == 1
    assert document["coverage"]["unknown_by_category"][0]["category_code"] is None
    replayed = build_town_events(tmp_ledger, "2026-08", generated_at="2026-09-10T00:00:00+00:00")
    replayed.pop("generated_at")
    fixed = dict(document)
    fixed.pop("generated_at")
    assert replayed == fixed


# ------------------------------------------------------- time & ordering

def test_day_precision_events_get_presentation_slots_not_fake_times(tmp_ledger, tmp_path):
    _seed(tmp_ledger, tmp_path,
          wechat_rows=[_wechat_row("01", "麦当劳", "套餐", "30.00", "WMB")],
          bank_rows=["2026-08-01,代发工资 工资,10000.00,10000.00",
                     "2026-08-01,代发工资 工资,20000.00,30000.00"])
    document = _events(tmp_ledger)
    day_events = sorted(
        (e for e in document["events"] if e["occurred_at"].startswith("2026-08-01")),
        key=lambda e: e["schedule_seconds"],
    )
    assert len(day_events) == 3
    bank_events = [e for e in day_events if e["time_precision"] == "DAY"]
    assert len(bank_events) == 2
    for event in bank_events:
        assert event["presentation_time"] is True
        assert event["time_of_day_seconds"] == 0
    assert bank_events[0]["schedule_seconds"] < bank_events[1]["schedule_seconds"]
    assert document["days"][0] == {"date": "2026-08-01", "event_count": 3, "precise_time_count": 1}


def test_events_are_chronologically_scheduled(tmp_ledger, tmp_path):
    _seed(tmp_ledger, tmp_path, wechat_rows=[
        _wechat_row("02", "麦当劳", "午餐", "30.00", "WA1", time_of_day="12:20:00"),
        _wechat_row("02", "星巴克", "咖啡", "32.00", "WA2", time_of_day="08:41:00"),
        _wechat_row("02", "拼多多平台商户", "日用品", "38.00", "WA3", time_of_day="21:53:00"),
    ])
    document = _events(tmp_ledger)
    schedules = [e["schedule_seconds"] for e in document["events"]]
    assert schedules == sorted(schedules)
    assert document["events"][0]["merchant"] == "星巴克"


# ------------------------------------------------------ determinism & range

def test_projection_is_deterministic(tmp_ledger, tmp_path):
    _seed(tmp_ledger, tmp_path, wechat_rows=[
        _wechat_row("02", "麦当劳", "套餐", "30.00", "WD1"),
        _wechat_row("03", "拼多多平台商户", "纸巾", "20.00", "WD2"),
    ])
    first = _events(tmp_ledger)
    second = build_town_events(tmp_ledger, "2026-08", generated_at="2026-09-10T00:00:00+00:00")
    first.pop("generated_at"), second.pop("generated_at")
    assert first == second


def test_intensity_is_bounded_log_normalization():
    assert intensity_for_amount(0) == INTENSITY_MIN
    assert intensity_for_amount(-5) == INTENSITY_MIN  # 防御：永不 < 0.15
    assert intensity_for_amount(100_000) == 1.0       # ¥1000 封顶
    assert intensity_for_amount(3_600) < intensity_for_amount(36_000)
    assert 0.0 <= intensity_for_amount(62680) <= 1.0
    for target in TARGETS:
        assert isinstance(target, str)
