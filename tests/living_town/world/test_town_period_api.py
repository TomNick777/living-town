"""GET /api/town-period contract tests."""

from __future__ import annotations

import json
import threading
import urllib.error
import urllib.request
from pathlib import Path

import pytest

from conftest import make_wechat_csv

from life_energy.accounts.service import ensure_account
from life_energy.classification.engine import classify_transactions
from life_energy.classification.seed import seed_all
from life_energy.db.connection import open_db
from life_energy.energy.model import summarize_period
from life_energy.ingestion.wechat import WechatParser
from life_energy.ledger.importer import import_file
from life_energy.ledger.queries import month_bounds
from life_energy.living_town.projection import financial_from_energy_summary
from life_energy.living_town.town_events import build_town_events
from life_energy.living_town.town_period import TOWN_PERIOD_VERSION, build_town_period
from life_energy.living_town.world.api import make_server


@pytest.fixture()
def period_server(tmp_path: Path):
    db_path = tmp_path / "ledger.db"
    with open_db(db_path) as conn:
        seed_all(conn)
        wechat = ensure_account(conn, "微信零钱")
        rows = [
            "2026-01-15 12:00:00,商户消费,麦当劳,套餐,支出,¥36.00,零钱,支付成功,JAN,",
            "2026-02-03 00:00:00,商户消费,超市,日用品,支出,¥20.00,零钱,支付成功,FEB,",
            "2025-12-28 10:00:00,商户消费,星巴克,拿铁,支出,¥32.00,零钱,支付成功,DEC,",
        ]
        import_file(conn, WechatParser(), make_wechat_csv(tmp_path / "wx.csv", rows),
                    fallback_account_id=wechat)
        classify_transactions(conn)
    srv = make_server(db_path, port=0)
    thread = threading.Thread(target=srv.serve_forever, daemon=True)
    thread.start()
    yield srv
    srv.shutdown()
    srv.server_close()
    thread.join(5)


def _get(base: str, path: str):
    request = urllib.request.Request(base + path)
    try:
        with urllib.request.urlopen(request, timeout=5) as response:
            return response.status, json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        return exc.code, json.loads(exc.read().decode("utf-8"))


def test_town_period_month_matches_authoritative_financials(period_server, tmp_path):
    port = period_server.server_address[1]
    status, payload = _get(f"http://127.0.0.1:{port}", "/api/town-period?period=2026-01")
    assert status == 200
    assert payload["projection_version"] == TOWN_PERIOD_VERSION
    assert payload["period"]["kind"] == "month"
    assert payload["presentation"]["mode"] == "period_montage"

    with open_db(tmp_path / "ledger.db") as conn:
        start, end = month_bounds("2026-01")
        expected = financial_from_energy_summary(summarize_period(conn, start, end)).to_dict()
        events = build_town_events(conn, "2026-01")["events"]
    assert payload["financial"] == expected
    assert payload["activity"]["town_event_count"] == len(events)
    assert payload["events"][0]["occurred_at"].startswith("2026-01")


def test_town_period_year_aggregates_and_orders_montage(period_server):
    port = period_server.server_address[1]
    status, payload = _get(f"http://127.0.0.1:{port}", "/api/town-period?period=2026")
    assert status == 200
    assert payload["period"]["kind"] == "year"
    assert payload["period"]["months_with_data"] == ["2026-01", "2026-02"]
    assert len(payload["months"]) == 12
    assert payload["months"][0]["month"] == "2026-01"
    assert payload["months"][0]["has_data"] is True
    assert payload["months"][2]["has_data"] is False
    schedules = [event["schedule_seconds"] for event in payload["events"]]
    assert schedules == sorted(schedules)
    assert payload["activity"]["town_event_count"] == 2


def test_town_period_rejects_bad_period(period_server):
    port = period_server.server_address[1]
    status, _payload = _get(f"http://127.0.0.1:{port}", "/api/town-period?period=2026-13")
    assert status == 400


def test_build_town_period_is_read_only(period_server, tmp_path):
    db_path = tmp_path / "ledger.db"
    with open_db(db_path) as conn:
        before = conn.total_changes
        build_town_period(conn, "2026-02")
        assert conn.total_changes == before
