"""town-events-v3-delta contract tests (Phase 2D): the minimal legacy-consumer
change index for Otter City warm startup.

The cursor is a *generation* — the ledger_revision.digest of the state the
consumer fully incorporated. Equal generations prove zero semantic delta;
known older generations diff to upserts + invalidations; unknown generations
honestly resync. Every scenario checks the merged view equals a full rebuild
(the §32 equivalence invariant), riding the same fixtures Otter City consumes.
"""

from __future__ import annotations

import json
import threading
from pathlib import Path

import pytest

from conftest import make_wechat_csv

from life_energy.accounts.service import ensure_account
from life_energy.classification.engine import classify_transactions
from life_energy.classification.seed import seed_all
from life_energy.db.connection import open_db
from life_energy.ingestion.wechat import WechatParser
from life_energy.ledger.importer import import_file
from life_energy.living_town.town_events_v3 import (
    DELTA_SURFACE_VERSION,
    TownEventsDeltaIndex,
    build_town_events_v3,
    build_town_events_v3_delta,
)
from life_energy.living_town.world.api import make_server


@pytest.fixture()
def delta_ledger(tmp_path: Path):
    """Synthetic ledger + its tmp dir, so scenarios may import more rows."""
    db_path = tmp_path / "ledger.db"
    with open_db(db_path) as conn:
        seed_all(conn)
        wechat = ensure_account(conn, "微信零钱")
        rows = [
            "2026-08-02 12:20:00,商户消费,麦当劳,巨无霸套餐,支出,¥36.00,零钱,支付成功,EVA,",
            "2026-08-02 15:10:00,商户消费,星巴克,拿铁,支出,¥32.00,零钱,支付成功,EVB,",
            "2026-08-05 10:59:00,转账,证券公司,银证转账,支出,¥1000.00,零钱,支付成功,EVD,",
            "2026-08-04 10:00:00,退款,麦当劳,退款,收入,¥36.00,零钱,支付成功,EVE,",
        ]
        import_file(conn, WechatParser(), make_wechat_csv(tmp_path / "wx.csv", rows),
                    fallback_account_id=wechat)
        # The in-leg of the internal transfer lands in a DIFFERENT account
        # (pairing rejects same-account candidates), same parser shape.
        bank = ensure_account(conn, "招商银行(1234)")
        import_file(
            conn,
            WechatParser(),
            make_wechat_csv(
                tmp_path / "bank-in.csv",
                ["2026-08-05 11:00:00,转账,零钱,银证转入,收入,¥1000.00,招行,支付成功,EVF,"],
            ),
            fallback_account_id=bank,
        )
        classify_transactions(conn)
        # Pairing state is owned by the reconciliation layer (same as v3 tests).
        from life_energy.reconciliation.refund_pairing import mark_all_unresolved, suggest_refunds
        from life_energy.reconciliation.transfer_pairing import suggest_transfers

        suggest_transfers(conn)
        suggest_refunds(conn)
        mark_all_unresolved(conn)
        yield conn, tmp_path


def _all_events(conn) -> dict[int, dict]:
    doc = build_town_events_v3(conn, since_id=0, limit=2000)
    return {e["transaction_id"]: e for e in doc["events"]}


def _handshake(index: TownEventsDeltaIndex, conn) -> str:
    """The warm-start handshake: after a cold bootstrap the consumer
    acknowledges its generation and the producer confirms it (resync with
    current == acknowledged costs nothing to apply). Subsequent deltas diff
    against the journal snapshot this creates."""
    generation, row_digests = index.scan(conn)
    index.remember(generation, row_digests)
    confirmed = build_town_events_v3_delta(index, conn, acknowledged_generation=generation)
    assert confirmed["generation"]["unchanged"] is True
    return generation


def _import_row(conn, tmp_path: Path, row: str) -> None:
    wechat = ensure_account(conn, "微信零钱")
    import_file(
        conn,
        WechatParser(),
        make_wechat_csv(tmp_path / "delta-more.csv", [row]),
        fallback_account_id=wechat,
    )


def _merge_and_assert_equivalent(
    acknowledged_events: dict[int, dict], doc: dict, conn
) -> None:
    """Old state + all valid deltas must equal the full bootstrap, exactly."""
    merged = dict(acknowledged_events)
    for event in doc["upserts"]:
        merged[event["transaction_id"]] = event
    for removed in doc["invalidations"]:
        merged.pop(removed, None)
    assert merged == _all_events(conn)


def test_equal_generation_proves_zero_semantic_delta(delta_ledger):
    conn, _ = delta_ledger
    index = TownEventsDeltaIndex()
    generation, _ = index.scan(conn)
    doc = build_town_events_v3_delta(index, conn, acknowledged_generation=generation)
    assert doc["surface"] == DELTA_SURFACE_VERSION
    assert doc["generation"]["unchanged"] is True
    assert doc["generation"]["resync"] is False
    assert doc["upserts"] == []
    assert doc["invalidations"] == []
    assert doc["counts"] == {"upserts": 0, "invalidations": 0, "transaction_count": 5}
    # The generation IS the v3 ledger revision digest — the surfaces agree.
    assert doc["generation"]["current"] == build_town_events_v3(conn, limit=1)[
        "ledger_revision"
    ]["digest"]


def test_new_transaction_is_an_upsert_and_merge_equals_rebuild(delta_ledger):
    conn, tmp_path = delta_ledger
    index = TownEventsDeltaIndex()
    generation = _handshake(index, conn)
    acknowledged = _all_events(conn)
    _import_row(conn, tmp_path,
                "2026-08-09 18:00:00,商户消费,便利店,饭团,支出,¥9.90,零钱,支付成功,EVZ,")
    doc = build_town_events_v3_delta(index, conn, acknowledged_generation=generation)
    assert doc["generation"]["unchanged"] is False
    assert doc["generation"]["resync"] is False
    assert [u["transaction_id"] for u in doc["upserts"]] == [6]
    assert doc["invalidations"] == []
    _merge_and_assert_equivalent(acknowledged, doc, conn)
    # Duplicate delta is idempotent: the same request against the new
    # generation now proves no change.
    again = build_town_events_v3_delta(
        index, conn, acknowledged_generation=doc["generation"]["current"]
    )
    assert again["generation"]["unchanged"] is True
    assert again["upserts"] == []


def test_in_place_classification_change_is_discovered(delta_ledger):
    conn, _ = delta_ledger
    index = TownEventsDeltaIndex()
    generation = _handshake(index, conn)
    acknowledged = _all_events(conn)
    # Re-interpret an existing EXPENSE row in place (id stays, semantics move).
    conn.execute(
        "UPDATE transaction_interpretation SET category_code = 'FOOD', "
        "interpretation_version = interpretation_version + 1 "
        "WHERE transaction_id = 1"
    )
    doc = build_town_events_v3_delta(index, conn, acknowledged_generation=generation)
    assert [u["transaction_id"] for u in doc["upserts"]] == [1]
    upsert = doc["upserts"][0]
    assert upsert["category_code"] == "FOOD"
    assert upsert["interpretation_version"] >= 1
    _merge_and_assert_equivalent(acknowledged, doc, conn)


def test_transfer_pair_status_flip_reaches_both_sides(delta_ledger):
    conn, _ = delta_ledger
    index = TownEventsDeltaIndex()
    generation = _handshake(index, conn)
    acknowledged = _all_events(conn)
    conn.execute("UPDATE transfer_pairs SET pair_status = 'CONFIRMED'")
    doc = build_town_events_v3_delta(index, conn, acknowledged_generation=generation)
    assert {u["transaction_id"] for u in doc["upserts"]} == {3, 5}
    assert all(u["transfer_pair"]["pair_status"] == "CONFIRMED" for u in doc["upserts"])
    _merge_and_assert_equivalent(acknowledged, doc, conn)


def test_refund_link_change_is_discovered(delta_ledger):
    conn, _ = delta_ledger
    index = TownEventsDeltaIndex()
    generation = _handshake(index, conn)
    conn.execute(
        "UPDATE refund_links SET link_status = 'UNRESOLVED' WHERE link_status = 'PROBABLE'"
    )
    doc = build_town_events_v3_delta(index, conn, acknowledged_generation=generation)
    refund_ids = {
        u["transaction_id"]
        for u in doc["upserts"]
        if u["refund_link"] is not None and u["refund_link"]["link_status"] == "UNRESOLVED"
    }
    assert refund_ids, "the demoted refund must arrive as an upsert"


def test_deleted_row_is_reported_as_invalidation(delta_ledger):
    conn, _ = delta_ledger
    index = TownEventsDeltaIndex()
    generation = _handshake(index, conn)
    acknowledged = _all_events(conn)
    # Retract a transaction: dependents first, then the row itself (FK order).
    conn.execute("DELETE FROM refund_links WHERE refund_transaction_id = 2")
    conn.execute("DELETE FROM transaction_interpretation WHERE transaction_id = 2")
    conn.execute("DELETE FROM transactions WHERE transaction_id = 2")
    doc = build_town_events_v3_delta(index, conn, acknowledged_generation=generation)
    assert doc["invalidations"] == [2]
    assert doc["upserts"] == []
    _merge_and_assert_equivalent(acknowledged, doc, conn)


def test_unknown_generation_resyncs(delta_ledger):
    conn, _ = delta_ledger
    index = TownEventsDeltaIndex()
    for acknowledged in (None, "sha256:not-a-real-generation"):
        doc = build_town_events_v3_delta(index, conn, acknowledged_generation=acknowledged)
        assert doc["generation"]["resync"] is True
        assert doc["generation"]["reason"] in ("no-generation", "unknown-generation")
        assert doc["upserts"] == []
        assert doc["invalidations"] == []


def test_delta_too_large_degrades_to_resync(delta_ledger):
    conn, _ = delta_ledger
    index = TownEventsDeltaIndex()
    generation = _handshake(index, conn)
    conn.execute("UPDATE transactions SET description = '改写'")
    doc = build_town_events_v3_delta(
        index, conn, acknowledged_generation=generation, max_upserts=2
    )
    assert doc["generation"]["resync"] is True
    assert doc["generation"]["reason"] == "delta-too-large"
    assert doc["upserts"] == [] and doc["invalidations"] == []


def test_journal_prune_forces_honest_resync(delta_ledger):
    conn, _ = delta_ledger
    index = TownEventsDeltaIndex(capacity=1)
    first, rows = index.scan(conn)
    index.remember(first, rows)
    conn.execute("UPDATE transactions SET description = 'A'")
    second = build_town_events_v3_delta(index, conn, acknowledged_generation=first)
    assert second["generation"]["resync"] is False
    conn.execute("UPDATE transactions SET description = 'B'")
    third = build_town_events_v3_delta(index, conn, acknowledged_generation=first)
    # capacity=1 evicted `first`'s snapshot — the honest answer is a resync.
    assert third["generation"]["resync"] is True


def test_multi_generation_advance_without_resync(delta_ledger):
    conn, _ = delta_ledger
    index = TownEventsDeltaIndex()
    generation = _handshake(index, conn)
    merged = _all_events(conn)
    for description in ("甲", "乙", "丙"):
        conn.execute("UPDATE transactions SET description = ?", (description,))
        doc = build_town_events_v3_delta(index, conn, acknowledged_generation=generation)
        assert doc["generation"]["resync"] is False
        for event in doc["upserts"]:
            merged[event["transaction_id"]] = event
        for removed in doc["invalidations"]:
            merged.pop(removed, None)
        assert merged == _all_events(conn)
        generation = doc["generation"]["current"]


@pytest.fixture()
def delta_server(tmp_path: Path):
    db_path = tmp_path / "ledger.db"
    with open_db(db_path) as conn:
        seed_all(conn)
        wechat = ensure_account(conn, "微信零钱")
        import_file(
            conn,
            WechatParser(),
            make_wechat_csv(
                tmp_path / "wx.csv",
                ["2026-08-02 12:20:00,商户消费,麦当劳,巨无霸套餐,支出,¥36.00,零钱,支付成功,EVA,"],
            ),
            fallback_account_id=wechat,
        )
        classify_transactions(conn)
    srv = make_server(db_path, port=0)
    thread = threading.Thread(target=srv.serve_forever, daemon=True)
    thread.start()
    yield srv
    srv.shutdown()
    srv.server_close()
    thread.join(5)


def _get(base: str, path: str):
    import urllib.request

    with urllib.request.urlopen(base + path, timeout=5) as response:
        return response.status, json.loads(response.read().decode("utf-8"))


def test_delta_endpoint_round_trip(delta_server):
    base = f"http://127.0.0.1:{delta_server.server_address[1]}"
    _, full = _get(base, "/api/town-events-v3?limit=2000")
    generation = full["ledger_revision"]["digest"]
    status, doc = _get(base, f"/api/town-events-v3/delta?generation={generation}")
    assert status == 200
    assert doc["surface"] == DELTA_SURFACE_VERSION
    assert doc["generation"]["unchanged"] is True
    # Unknown generation → honest resync, never a guess.
    _, doc = _get(base, "/api/town-events-v3/delta?generation=sha256:bogus")
    assert doc["generation"]["resync"] is True
    # First contact (no generation) → resync pointing at the current one.
    _, doc = _get(base, "/api/town-events-v3/delta")
    assert doc["generation"]["resync"] is True
    assert doc["generation"]["acknowledged"] is None
