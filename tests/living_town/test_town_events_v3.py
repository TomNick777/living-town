"""town-events-v3 contract tests: the cross-system fact feed for Otter City.

All six transaction types, pairing-state honesty, provenance fields, an
incremental transaction_id cursor, a content-digest ledger revision, and
byte-deterministic documents (no clock). Runs the real stdlib server over
HTTP against a temp DB — the same path Otter City takes.
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
from life_energy.ingestion.bank.generic_csv import GenericCSVBankParser
from life_energy.ingestion.wechat import WechatParser
from life_energy.ledger.importer import import_file
from life_energy.living_town.town_events_v3 import build_town_events_v3
from life_energy.living_town.world.api import make_server
from life_energy.reconciliation.refund_pairing import mark_all_unresolved, suggest_refunds
from life_energy.reconciliation.transfer_pairing import suggest_transfers


@pytest.fixture()
def v3_ledger(tmp_path: Path):
    """Synthetic ledger with every transaction type represented."""
    db_path = tmp_path / "ledger.db"
    with open_db(db_path) as conn:
        seed_all(conn)
        wechat = ensure_account(conn, "微信零钱")
        rows = [
            "2026-08-02 12:20:00,商户消费,麦当劳,巨无霸套餐,支出,¥36.00,零钱,支付成功,EVA,",
            "2026-08-02 15:10:00,商户消费,星巴克,拿铁,支出,¥32.00,零钱,支付成功,EVB,",
            "2026-08-03 09:00:00,转账,招商银行(1234),零钱充值,支出,¥500.00,零钱,支付成功,EVD,",
            "2026-08-04 10:00:00,退款,麦当劳,退款,收入,¥36.00,零钱,支付成功,EVE,",
            "2026-08-05 11:00:00,转账,证券公司,银证转账,支出,¥1000.00,零钱,支付成功,EVF,",
            "2026-08-06 20:00:00,微信红包,朋友,红包,收入,¥88.00,零钱,支付成功,EVG,",
        ]
        import_file(conn, WechatParser(), make_wechat_csv(tmp_path / "wx.csv", rows),
                    fallback_account_id=wechat)
        classify_transactions(conn)
        # The reconciliation layer owns pairing state: one PROBABLE transfer
        # pairing attempt and explicitly UNRESOLVED refunds (never income).
        suggest_transfers(conn)
        suggest_refunds(conn)
        mark_all_unresolved(conn)
        yield conn


def test_v3_projects_all_transaction_types(v3_ledger):
    doc = build_town_events_v3(v3_ledger)
    types = {e["transaction_type"] for e in doc["events"]}
    assert types <= {"INCOME", "EXPENSE", "TRANSFER", "REFUND", "INVESTMENT", "UNKNOWN"}
    assert "REFUND" in types and "TRANSFER" in types
    assert doc["projection_version"] == "town-events-v3"
    for e in doc["events"]:
        assert e["id"] == f"te:{e['transaction_id']}"
        assert isinstance(e["amount_minor"], int) and e["amount_minor"] >= 0
        assert e["currency"] == "CNY"
        assert e["time_precision"] in ("SECOND", "DAY")
        assert e["recorded_at"]


def test_v3_is_deterministic_and_revision_covers_published_fields(v3_ledger):
    first = build_town_events_v3(v3_ledger)
    second = build_town_events_v3(v3_ledger)
    assert json.dumps(first, sort_keys=True) == json.dumps(second, sort_keys=True)
    digest = first["ledger_revision"]["digest"]
    assert digest.startswith("sha256:")
    # An in-place status flip is invisible to id counters but must move the digest.
    v3_ledger.execute(
        "UPDATE refund_links SET link_status = 'CONFIRMED' "
        "WHERE link_status = 'PROBABLE'"
    )
    flipped = build_town_events_v3(v3_ledger)
    assert flipped["ledger_revision"]["digest"] != digest
    flipped_rows = [e for e in flipped["events"] if e["refund_link"]]
    assert flipped_rows and all(
        e["refund_link"]["link_status"] == "CONFIRMED" for e in flipped_rows
    )


def test_v3_refund_and_transfer_states_stay_honest(v3_ledger):
    doc = build_town_events_v3(v3_ledger)
    refunds = [e for e in doc["events"] if e["transaction_type"] == "REFUND"]
    assert refunds, "synthetic ledger must contain a refund"
    assert any(e["refund_link"] is not None for e in refunds), (
        "the reconciliation pass must have produced refund links"
    )
    for e in refunds:
        # link_status is either an honest pairing state or null (no record);
        # the projection never upgrades it.
        if e["refund_link"] is not None:
            assert e["refund_link"]["link_status"] in ("CONFIRMED", "PROBABLE", "UNRESOLVED")
    # An explicitly unlinked refund stays UNRESOLVED — never income, never dropped.
    from life_energy.reconciliation.refund_pairing import unlink_refund

    linked = next(e for e in refunds if e["refund_link"] is not None)
    unlink_refund(v3_ledger, linked["transaction_id"])
    after = build_town_events_v3(v3_ledger)
    unlinked = next(
        e for e in after["events"] if e["transaction_id"] == linked["transaction_id"]
    )
    assert unlinked["refund_link"]["link_status"] == "UNRESOLVED"
    assert unlinked["refund_link"]["original_transaction_id"] is None
    transfers = [e for e in doc["events"] if e["transaction_type"] == "TRANSFER"]
    assert transfers
    for e in transfers:
        if e["transfer_pair"] is not None:
            assert e["transfer_pair"]["pair_status"] in ("CONFIRMED", "PROBABLE", "UNCERTAIN")


def test_v3_incremental_cursor_covers_all_events_without_gaps(v3_ledger):
    full = build_town_events_v3(v3_ledger)["events"]
    page_size = 2
    collected: list[dict] = []
    since_id = 0
    for _ in range(50):
        page = build_town_events_v3(v3_ledger, since_id=since_id, limit=page_size)
        collected.extend(page["events"])
        if not page["cursor"]["has_more"]:
            break
        since_id = page["cursor"]["next_since_id"]
    assert collected == full


def test_v3_month_filter_and_unknown_classification(v3_ledger):
    doc = build_town_events_v3(v3_ledger, month="2026-08")
    assert all(e["occurred_at"].startswith("2026-08") for e in doc["events"])
    empty = build_town_events_v3(v3_ledger, month="2026-09")
    assert empty["events"] == []
    # The unmapped red packet keeps null category — unknown stays honest
    # (its transaction_type is whatever the canonical layer decided; the
    # projection never re-classifies).
    packet = next(e for e in doc["events"] if e["description"] == "红包")
    assert packet["category_code"] is None
    assert packet["category_name"] is None


@pytest.fixture()
def v3_server(tmp_path: Path):
    db_path = tmp_path / "ledger.db"
    with open_db(db_path) as conn:
        seed_all(conn)
        wechat = ensure_account(conn, "微信零钱")
        rows = [
            "2026-08-02 12:20:00,商户消费,麦当劳,巨无霸套餐,支出,¥36.00,零钱,支付成功,EVA,",
            "2026-08-03 09:00:00,转账,证券公司,银证转账,支出,¥1000.00,零钱,支付成功,EVD,",
        ]
        import_file(conn, WechatParser(), make_wechat_csv(tmp_path / "wx.csv", rows),
                    fallback_account_id=wechat)
        classify_transactions(conn)
        # bank date-only rows give the DAY time-precision path a real record
        bank = ensure_account(conn, "招商银行(1234)")
        import_file(conn, GenericCSVBankParser(),
                    make_bank_csv(tmp_path / "bank.csv", ["2026-08-04,工资,4769.58"]), fallback_account_id=bank)
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


def test_v3_endpoint_serves_contract(v3_server):
    port = v3_server.server_address[1]
    status, payload = _get(f"http://127.0.0.1:{port}", "/api/town-events-v3")
    assert status == 200
    assert payload["projection_version"] == "town-events-v3"
    assert payload["ledger_revision"]["digest"].startswith("sha256:")
    assert payload["cursor"]["has_more"] is False
    ids = [e["transaction_id"] for e in payload["events"]]
    assert ids == sorted(ids)


def test_v3_endpoint_validates_params(v3_server):
    port = v3_server.server_address[1]
    status, payload = _get(f"http://127.0.0.1:{port}", "/api/town-events-v3?since_id=-1")
    assert status == 400
    assert payload["error"] == "MALFORMED_COMMAND"
    status, _ = _get(f"http://127.0.0.1:{port}", "/api/town-events-v3?limit=99999")
    assert status == 400
    status, _ = _get(f"http://127.0.0.1:{port}", "/api/town-events-v3?since_id=abc")
    assert status == 400
    status, _ = _get(f"http://127.0.0.1:{port}", "/api/town-events-v3?month=2026-13")
    assert status == 400


def test_v2_endpoint_unchanged(v3_server):
    """The v2 presentation contract and its web consumer stay untouched."""
    port = v3_server.server_address[1]
    status, payload = _get(f"http://127.0.0.1:{port}", "/api/town-events?month=2026-08")
    assert status == 200
    assert payload["projection_version"] == "town-events-v2"
    # v2 still filters: the transfer must not appear as a town life event.
    assert all(e["transaction_type"] in ("EXPENSE", "INCOME") for e in payload["events"])
