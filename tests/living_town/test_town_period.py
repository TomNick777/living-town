"""Unit tests for town period montage scheduling."""

from __future__ import annotations

from conftest import make_wechat_csv

from life_energy.accounts.service import ensure_account
from life_energy.classification.engine import classify_transactions
from life_energy.classification.seed import seed_all
from life_energy.db.connection import open_db
from life_energy.ingestion.wechat import WechatParser
from life_energy.ledger.importer import import_file
from life_energy.living_town.town_period import build_town_period, parse_period_key


def test_parse_period_key_month_and_year():
    kind, key, start, end = parse_period_key("2026-02")
    assert kind == "month"
    assert key == "2026-02"
    assert start.startswith("2026-02-01")
    assert end.startswith("2026-03-01")
    kind, key, start, end = parse_period_key("2026")
    assert kind == "year"
    assert start.startswith("2026-01-01")
    assert end.startswith("2027-01-01")


def test_period_montage_orders_across_days(tmp_path):
    db_path = tmp_path / "ledger.db"
    with open_db(db_path) as conn:
        seed_all(conn)
        wechat = ensure_account(conn, "微信零钱")
        rows = [
            "2026-03-02 12:00:00,商户消费,A,餐,支出,¥10.00,零钱,支付成功,A,",
            "2026-03-10 12:00:00,商户消费,B,餐,支出,¥20.00,零钱,支付成功,B,",
        ]
        import_file(conn, WechatParser(), make_wechat_csv(tmp_path / "wx.csv", rows),
                    fallback_account_id=wechat)
        classify_transactions(conn)
        payload = build_town_period(conn, "2026-03", generated_at="2026-01-01T00:00:00Z")
    events = payload["events"]
    assert [event["merchant"] for event in events] == ["A", "B"]
    assert events[0]["schedule_seconds"] < events[1]["schedule_seconds"]


def test_empty_month_has_zero_events(tmp_path):
    db_path = tmp_path / "ledger.db"
    with open_db(db_path) as conn:
        seed_all(conn)
        payload = build_town_period(conn, "2026-04", generated_at="2026-01-01T00:00:00Z")
    assert payload["activity"]["town_event_count"] == 0
    assert payload["events"] == []
