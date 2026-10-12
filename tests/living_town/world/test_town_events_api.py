"""GET /api/town-events contract tests: the replay data endpoint.

Runs the real stdlib server against a temp DB seeded through the import
pipeline, then talks HTTP — the same path the web app takes via the vite
proxy. Read-only derived projection: zero writes, honest empty months.
"""

from __future__ import annotations

import json
import threading
import urllib.error
import urllib.request
from pathlib import Path

import pytest

from conftest import make_bank_csv, make_wechat_csv

from life_energy.accounts.service import ensure_account
from life_energy.classification.engine import classify_transactions
from life_energy.classification.seed import seed_all
from life_energy.db.connection import open_db
from life_energy.ingestion.wechat import WechatParser
from life_energy.ledger.importer import import_file
from life_energy.living_town.world.api import make_server


@pytest.fixture()
def event_server(tmp_path: Path):
    db_path = tmp_path / "ledger.db"
    with open_db(db_path) as conn:
        seed_all(conn)
        wechat = ensure_account(conn, "微信零钱")
        rows = [
            "2026-08-02 12:20:00,商户消费,麦当劳,巨无霸套餐,支出,¥36.00,零钱,支付成功,EVA,",
            "2026-08-02 15:10:00,商户消费,星巴克,拿铁,支出,¥32.00,零钱,支付成功,EVB,",
            "2026-08-02 18:30:00,商户消费,拼多多平台商户,日用品,支出,¥38.00,零钱,支付成功,EVC,",
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


def test_town_events_endpoint_serves_projection(event_server):
    port = event_server.server_address[1]
    status, payload = _get(f"http://127.0.0.1:{port}", "/api/town-events?month=2026-08")
    assert status == 200
    assert payload["projection_version"] == "town-events-v2"
    assert payload["rules_version"] == "town-event-rules-v2"
    assert payload["month"] == "2026-08"
    assert payload["days"] == [{"date": "2026-08-02", "event_count": 3, "precise_time_count": 3}]
    events = {e["merchant"]: e for e in payload["events"]}
    assert events["麦当劳"]["target"] == "restaurant"
    assert events["麦当劳"]["behavior"] == "VISIT"
    assert events["星巴克"]["target"] == "cafe"
    assert events["星巴克"]["behavior"] == "VISIT"
    assert events["拼多多平台商户"]["target"] == "logistics"
    assert events["拼多多平台商户"]["behavior"] == "DELIVERY"
    assert all(e["direction"] == "expense" for e in payload["events"])
    assert [e["schedule_seconds"] for e in payload["events"]] == sorted(
        e["schedule_seconds"] for e in payload["events"]
    )
    coverage = payload["coverage"]
    assert coverage["total"] == 3
    assert coverage["mapped"] == 3
    assert coverage["unknown"] == 0
    assert coverage["unknown_ratio"] == 0.0
    assert coverage["unknown_by_category"] == []


def test_town_events_endpoint_validates_month(event_server):
    port = event_server.server_address[1]
    status, payload = _get(f"http://127.0.0.1:{port}", "/api/town-events?month=2026-13")
    assert status == 400
    assert payload["error"] == "MALFORMED_COMMAND"
    status, _ = _get(f"http://127.0.0.1:{port}", "/api/town-events")
    assert status == 400


def test_town_events_endpoint_honest_empty_month(event_server):
    port = event_server.server_address[1]
    status, payload = _get(f"http://127.0.0.1:{port}", "/api/town-events?month=2026-09")
    assert status == 200
    assert payload["events"] == []
    assert payload["days"] == []
