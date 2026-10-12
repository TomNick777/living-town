"""FB-4 local world service: read transport, loopback-only, fail-honest.

Runs the real stdlib server on an ephemeral 127.0.0.1 port against a temp DB
and talks to it over HTTP — the same path the web app takes through the
vite proxy.
"""

from __future__ import annotations

import json
import threading
import urllib.error
import urllib.request

import pytest

from life_energy.db.connection import open_db
from life_energy.living_town.world.api import make_server
from life_energy.living_town.world.bootstrap import load_world
from life_energy.living_town.world.service import create_building


@pytest.fixture()
def server(tmp_path):
    db_path = tmp_path / "world.db"
    srv = make_server(db_path, port=0)
    thread = threading.Thread(target=srv.serve_forever, daemon=True)
    thread.start()
    yield srv, db_path
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


def test_binds_loopback_only(server):
    srv, _ = server
    host, _port = srv.server_address[:2]
    assert host == "127.0.0.1"


def test_make_server_refuses_non_loopback_bind(tmp_path):
    from life_energy.living_town.world.api import WorldHTTPServer

    with pytest.raises(ValueError, match="127.0.0.1"):
        WorldHTTPServer(("0.0.0.0", 0), tmp_path / "w.db")
    with pytest.raises(ValueError, match="127.0.0.1"):
        WorldHTTPServer(("192.168.1.10", 0), tmp_path / "w.db")


def test_get_world_returns_seeded_town(server):
    srv, db_path = server
    port = srv.server_address[1]
    status, payload = _get(f"http://127.0.0.1:{port}", "/api/world")
    assert status == 200
    assert payload["world_version"] == "town-world-v1"
    assert payload["layout_version"] == "living-town-block-v1"
    assert payload["revision"] == 1
    assert len(payload["buildings"]) == 4
    ids = [b["building_id"] for b in payload["buildings"]]
    assert ids == sorted(ids)  # deterministic order


def test_world_matches_cli_shape_exactly(server, tmp_path):
    """GET /api/world and `town world show --json` are the same document."""
    srv, db_path = server
    port = srv.server_address[1]
    _, http_payload = _get(f"http://127.0.0.1:{port}", "/api/world")
    with open_db(db_path) as conn:
        cli_payload = load_world(conn).to_dict()
    assert http_payload == cli_payload


def test_service_restart_preserves_identity(server):
    """Stop the server, start another on the same DB: identical world,
    same seed, no reseed."""
    srv, db_path = server
    port = srv.server_address[1]
    _, first = _get(f"http://127.0.0.1:{port}", "/api/world")

    srv.shutdown()
    srv.server_close()
    srv2 = make_server(db_path, port=0)
    thread = threading.Thread(target=srv2.serve_forever, daemon=True)
    thread.start()
    try:
        _, second = _get(f"http://127.0.0.1:{srv2.server_address[1]}", "/api/world")
    finally:
        srv2.shutdown()
        srv2.server_close()
        thread.join(5)
    assert first == second


def test_created_building_is_served_after_cli_mutation(server):
    """CLI (domain service) and HTTP read the same single truth."""
    srv, db_path = server
    port = srv.server_address[1]
    with open_db(db_path) as conn:
        create_building(conn, asset_id="cafe", grid_x=5, grid_y=1, expected_revision=1)
    status, payload = _get(f"http://127.0.0.1:{port}", "/api/world")
    assert status == 200
    assert payload["revision"] == 2
    assert len(payload["buildings"]) == 5


def test_get_town_state_requires_month(server):
    srv, _ = server
    port = srv.server_address[1]
    status, payload = _get(f"http://127.0.0.1:{port}", "/api/town-state")
    assert status == 400
    assert payload["error"] == "MALFORMED_COMMAND"
    status, payload = _get(f"http://127.0.0.1:{port}", "/api/town-state?month=2026-13")
    assert status == 400


def test_get_town_state_projects_period(server):
    srv, _ = server
    port = srv.server_address[1]
    status, payload = _get(f"http://127.0.0.1:{port}", "/api/town-state?month=2026-08")
    assert status == 200
    assert payload["period"]["month"] == "2026-08"
    assert "financial" in payload
    assert payload["projects"] == []  # TownProject stays deferred (§12)


def test_get_months_empty_then_seeded(server, tmp_path):
    """Month navigation is honest: no transactions -> empty list, never a
    guessed default month; seeding goes through the real import path."""
    srv, db_path = server
    port = srv.server_address[1]
    status, payload = _get(f"http://127.0.0.1:{port}", "/api/months")
    assert status == 200
    assert payload == {"months": []}

    from conftest import make_wechat_csv

    from life_energy.accounts.service import add_alias, ensure_account
    from life_energy.ingestion.wechat import WechatParser
    from life_energy.ledger.importer import import_file

    with open_db(db_path) as conn:
        wechat = ensure_account(conn, "微信零钱")
        add_alias(conn, "wechat", "零钱", wechat)
        import_file(
            conn, WechatParser(),
            make_wechat_csv(tmp_path / "months.csv", [
                "2026-08-05 12:00:00,商户消费,某商店,日用品,支出,¥12.00,零钱,支付成功,REF-M1,",
                "2026-07-28 09:00:00,商户消费,某商店,日用品,支出,¥8.00,零钱,支付成功,REF-M2,",
            ]),
            fallback_account_id=wechat,
        )
    status, payload = _get(f"http://127.0.0.1:{port}", "/api/months")
    assert status == 200
    assert payload["months"] == ["2026-07", "2026-08"]


def test_ledger_board_and_review_require_month_and_project(server, tmp_path):
    srv, db_path = server
    port = srv.server_address[1]
    base = f"http://127.0.0.1:{port}"
    status, payload = _get(base, "/api/ledger-board")
    assert status == 400
    status, payload = _get(base, "/api/ledger-review?month=2026-13")
    assert status == 400
    status, payload = _get(base, "/api/ledger-review?month=2026-08&type=FOOD")
    assert status == 400

    from conftest import make_wechat_csv

    from life_energy.accounts.service import add_alias, ensure_account
    from life_energy.ingestion.wechat import WechatParser
    from life_energy.ledger.importer import import_file

    with open_db(db_path) as conn:
        wechat = ensure_account(conn, "微信零钱")
        add_alias(conn, "wechat", "零钱", wechat)
        import_file(
            conn, WechatParser(),
            make_wechat_csv(tmp_path / "board.csv", [
                "2026-08-05 12:00:00,商户消费,某商店,日用品,支出,¥12.00,零钱,支付成功,REF-B1,",
            ]),
            fallback_account_id=wechat,
        )

    status, board = _get(base, "/api/ledger-board?month=2026-08")
    assert status == 200
    assert board["projection_version"] == "ledger-board-v1"
    assert board["merchants"]["top"][0]["counterparty"] == "某商店"
    status, review = _get(base, "/api/ledger-review?month=2026-08")
    assert status == 200
    assert review["projection_version"] == "ledger-review-v1"
    assert review["total_count"] == 1
    assert review["transactions"][0]["amount_minor"] == 1200


def test_unknown_path_and_wrong_method_are_honest(server):
    srv, _ = server
    port = srv.server_address[1]
    status, payload = _get(f"http://127.0.0.1:{port}", "/api/nope")
    assert status == 404
    assert payload["error"] == "NOT_FOUND"

    # POST with a loopback origin passes the guard but the endpoint does not exist yet
    request = urllib.request.Request(
        f"http://127.0.0.1:{port}/api/world", data=b"{}", method="POST",
        headers={"Content-Type": "application/json", "Origin": "http://localhost:5173"},
    )
    try:
        with urllib.request.urlopen(request, timeout=5) as response:
            status = response.status
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        status = exc.code
        payload = json.loads(exc.read().decode("utf-8"))
    assert status == 404


def test_cross_site_origin_is_rejected(server):
    srv, _ = server
    port = srv.server_address[1]
    request = urllib.request.Request(
        f"http://127.0.0.1:{port}/api/world", data=b"{}", method="POST",
        headers={"Content-Type": "application/json", "Origin": "http://evil.example"},
    )
    try:
        with urllib.request.urlopen(request, timeout=5) as response:
            status = response.status
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        status = exc.code
        payload = json.loads(exc.read().decode("utf-8"))
    assert status == 403
    assert payload["error"] == "FORBIDDEN"


def test_non_loopback_host_header_is_rejected(server):
    srv, _ = server
    port = srv.server_address[1]
    request = urllib.request.Request(
        f"http://127.0.0.1:{port}/api/world", data=b"{}", method="POST",
        headers={"Content-Type": "application/json", "Host": "attacker.example"},
    )
    try:
        with urllib.request.urlopen(request, timeout=5) as response:
            status = response.status
    except urllib.error.HTTPError as exc:
        status = exc.code
    assert status == 403


# ------------------------------------------------------------------ commands


def _post(base: str, path: str, payload, headers=None):
    request = urllib.request.Request(
        base + path,
        data=json.dumps(payload).encode("utf-8") if payload is not None else b"",
        method="POST",
        headers={"Content-Type": "application/json", **(headers or {})},
    )
    try:
        with urllib.request.urlopen(request, timeout=5) as response:
            return response.status, json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        return exc.code, json.loads(exc.read().decode("utf-8"))


CAFE_UUID = "45a22d48-57c5-4d02-95c3-517d1c36957c"


def test_post_create_returns_full_new_world(server):
    srv, _ = server
    base = f"http://127.0.0.1:{srv.server_address[1]}"
    status, payload = _post(base, "/api/commands", {
        "type": "CreateBuilding", "asset_id": "cafe", "grid_x": 5, "grid_y": 1, "expected_revision": 1,
    })
    assert status == 200
    assert payload["ok"] is True
    assert payload["revision"] == 2
    assert len(payload["world"]["buildings"]) == 5
    created = [b for b in payload["world"]["buildings"] if b["grid_x"] == 5 and b["grid_y"] == 1]
    assert len(created) == 1
    assert created[0]["provenance"]["via"] == "web"
    # a subsequent GET returns the same document
    status, world = _get(base, "/api/world")
    assert world == payload["world"]


def test_post_version_conflict_is_409_with_current_revision(server):
    srv, _ = server
    base = f"http://127.0.0.1:{srv.server_address[1]}"
    status, payload = _post(base, "/api/commands", {
        "type": "CreateBuilding", "asset_id": "cafe", "grid_x": 5, "grid_y": 1, "expected_revision": 42,
    })
    assert status == 409
    assert payload["error"] == "VERSION_CONFLICT"
    assert payload["detail"]["current_revision"] == 1


def test_two_tab_conflict_first_wins_second_gets_409(server):
    srv, _ = server
    base = f"http://127.0.0.1:{srv.server_address[1]}"
    # tab A and tab B both saw revision 1; A submits first
    status_a, payload_a = _post(base, "/api/commands", {
        "type": "CreateBuilding", "asset_id": "cafe", "grid_x": 5, "grid_y": 1, "expected_revision": 1,
    })
    status_b, payload_b = _post(base, "/api/commands", {
        "type": "CreateBuilding", "asset_id": "convenience_store", "grid_x": 12, "grid_y": 7, "expected_revision": 1,
    })
    assert status_a == 200 and status_b == 409
    assert payload_b["detail"]["current_revision"] == 2
    # the loser's building must not exist anywhere
    assert all(b["grid_x"] != 12 for b in payload_a["world"]["buildings"])


def test_post_error_code_http_mapping(server):
    srv, _ = server
    base = f"http://127.0.0.1:{srv.server_address[1]}"
    cases = [
        ({"type": "CreateBuilding", "asset_id": "cafe", "grid_x": 6, "grid_y": 0, "expected_revision": 1}, 409, "COLLISION"),
        # cafe 1x1 fits the max corner; the next case reuses the revision to hit OOB with a 2x2
        ({"type": "CreateBuilding", "asset_id": "residential_a", "grid_x": 15, "grid_y": 9, "expected_revision": 1}, 422, "OUT_OF_BOUNDS"),
        ({"type": "CreateBuilding", "asset_id": "skyscraper", "grid_x": 5, "grid_y": 1, "expected_revision": 1}, 422, "UNKNOWN_ASSET"),
        ({"type": "CreateBuilding", "asset_id": "tree", "grid_x": 5, "grid_y": 1, "expected_revision": 1}, 422, "ASSET_NOT_PLACEABLE"),
        ({"type": "CreateBuilding", "asset_id": "cafe", "grid_x": 1.5, "grid_y": 1, "expected_revision": 1}, 422, "INVALID_COORDINATE"),
        ({"type": "MoveBuilding", "building_id": "nope", "grid_x": 5, "grid_y": 1, "expected_revision": 1}, 404, "BUILDING_NOT_FOUND"),
        ({"type": "DemolishBuilding", "building_id": CAFE_UUID, "expected_revision": 1}, 200, "OK"),
        ({"type": "DemolishBuilding", "building_id": CAFE_UUID, "expected_revision": 2}, 422, "BUILDING_DEMOLISHED"),
    ]
    for payload, expected_status, expected_code in cases:
        status, body = _post(base, "/api/commands", payload)
        if expected_code == "OK":
            assert status == expected_status, body
        else:
            assert status == expected_status, (payload, body)
            assert body["error"] == expected_code, (payload, body)


def test_post_malformed_commands_are_400(server):
    srv, _ = server
    base = f"http://127.0.0.1:{srv.server_address[1]}"
    cases = [
        {"type": "TimeTravel", "expected_revision": 1},                      # unknown type
        {"type": "CreateBuilding", "asset_id": "cafe", "grid_x": 5},        # missing fields
        {"type": "CreateBuilding", "asset_id": "cafe", "grid_x": 5, "grid_y": 1, "expected_revision": 1, "extra": 1},
        {"type": "MoveBuilding", "building_id": CAFE_UUID, "grid_x": 5, "grid_y": 1, "expected_revision": 1, "orientation": "UP"},
    ]
    for payload in cases:
        status, body = _post(base, "/api/commands", payload)
        assert status == 400, (payload, body)
        assert body["error"] == "MALFORMED_COMMAND", (payload, body)


def test_post_non_json_body_is_400(server):
    srv, _ = server
    base = f"http://127.0.0.1:{srv.server_address[1]}"
    request = urllib.request.Request(
        base + "/api/commands", data=b"{not json", method="POST",
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=5) as response:
            status = response.status
            body = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        status = exc.code
        body = json.loads(exc.read().decode("utf-8"))
    assert status == 400
    assert body["error"] == "MALFORMED_COMMAND"


def test_full_command_cycle_over_http(server):
    srv, _ = server
    base = f"http://127.0.0.1:{srv.server_address[1]}"
    _, world = _get(base, "/api/world")
    revision = world["revision"]
    status, payload = _post(base, "/api/commands", {
        "type": "CreateBuilding", "asset_id": "cafe", "grid_x": 5, "grid_y": 1, "expected_revision": revision,
    })
    assert status == 200
    new_id = next(b["building_id"] for b in payload["world"]["buildings"] if b["grid_x"] == 5)
    status, payload = _post(base, "/api/commands", {
        "type": "MoveBuilding", "building_id": new_id, "grid_x": 0, "grid_y": 1, "expected_revision": revision + 1,
    })
    assert status == 200
    status, payload = _post(base, "/api/commands", {
        "type": "ChangeBuildingAsset", "building_id": new_id, "asset_id": "convenience_store", "expected_revision": revision + 2,
    })
    assert status == 200
    status, payload = _post(base, "/api/commands", {
        "type": "DemolishBuilding", "building_id": new_id, "expected_revision": revision + 3,
    })
    assert status == 200
    demolished = next(b for b in payload["world"]["buildings"] if b["building_id"] == new_id)
    assert demolished["lifecycle"] == "DEMOLISHED"
    assert payload["world"]["revision"] == revision + 4


def test_command_persistence_across_service_restart(server):
    srv, db_path = server
    base = f"http://127.0.0.1:{srv.server_address[1]}"
    status, payload = _post(base, "/api/commands", {
        "type": "CreateBuilding", "asset_id": "cafe", "grid_x": 5, "grid_y": 1, "expected_revision": 1,
    })
    assert status == 200
    created_id = next(b["building_id"] for b in payload["world"]["buildings"] if b["grid_x"] == 5)

    srv.shutdown()
    srv.server_close()
    srv2 = make_server(db_path, port=0)
    thread = threading.Thread(target=srv2.serve_forever, daemon=True)
    thread.start()
    try:
        _, world = _get(f"http://127.0.0.1:{srv2.server_address[1]}", "/api/world")
    finally:
        srv2.shutdown()
        srv2.server_close()
        thread.join(5)
    assert any(b["building_id"] == created_id for b in world["buildings"])
    assert world["revision"] == 2


def test_demolished_identity_retained_across_restart(server):
    srv, db_path = server
    base = f"http://127.0.0.1:{srv.server_address[1]}"
    status, _ = _post(base, "/api/commands", {
        "type": "DemolishBuilding", "building_id": CAFE_UUID, "expected_revision": 1,
    })
    assert status == 200

    srv.shutdown()
    srv.server_close()
    srv2 = make_server(db_path, port=0)
    thread = threading.Thread(target=srv2.serve_forever, daemon=True)
    thread.start()
    try:
        _, world = _get(f"http://127.0.0.1:{srv2.server_address[1]}", "/api/world")
    finally:
        srv2.shutdown()
        srv2.server_close()
        thread.join(5)
    # the row survives the restart, still DEMOLISHED, never resurrected
    demolished = next(b for b in world["buildings"] if b["building_id"] == CAFE_UUID)
    assert demolished["lifecycle"] == "DEMOLISHED"
    assert world["revision"] == 2


def test_health_reports_ready_with_service_identity(server):
    srv, _ = server
    port = srv.server_address[1]
    status, payload = _get(f"http://127.0.0.1:{port}", "/api/health")
    assert status == 200
    assert payload == {"ok": True, "service": "living-town-world", "database": "ok"}


def test_health_reports_unopenable_database_as_503(tmp_path):
    """A launcher must be able to tell "up and ready" from "up but broken":
    the probe opens the DB through the same path real handlers use, so a
    database that cannot open is a 503 with the failure in the payload."""
    db_path = tmp_path / "world.db"
    db_path.mkdir()  # a directory: sqlite cannot open it as a database
    srv = make_server(db_path, port=0)
    thread = threading.Thread(target=srv.serve_forever, daemon=True)
    thread.start()
    try:
        status, payload = _get(f"http://127.0.0.1:{srv.server_address[1]}", "/api/health")
    finally:
        srv.shutdown()
        srv.server_close()
        thread.join(5)
    assert status == 503
    assert payload["ok"] is False
    assert payload["service"] == "living-town-world"
    assert "OperationalError" in payload["database"]


def test_serve_exits_with_message_when_port_taken(tmp_path, capsys):
    """A second start against a held port is one honest line + exit 1,
    never a traceback (the launcher path depends on this)."""
    import socket

    from life_energy.living_town.world.api import serve

    blocker = socket.socket()
    blocker.bind(("127.0.0.1", 0))
    blocker.listen(1)
    try:
        port = blocker.getsockname()[1]
        with pytest.raises(SystemExit) as excinfo:
            serve(str(tmp_path / "w.db"), port=port)
        assert excinfo.value.code == 1
    finally:
        blocker.close()
    out = capsys.readouterr().out
    assert "cannot bind" in out
    assert "already be listening" in out


def _all_table_snapshot(conn) -> dict[str, list[tuple]]:
    names = [
        row[0]
        for row in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
        )
    ]
    return {
        name: [tuple(row) for row in conn.execute(f"SELECT * FROM {name}").fetchall()]
        for name in names
    }


def test_showcase_reads_do_not_mutate_rows_after_bootstrap(server):
    """After the one-time world seed, health / months / town-state / world
    GETs must not insert, update, or delete any user table row. Showcase
    and Harbor production hosting rely on this."""
    srv, db_path = server
    base = f"http://127.0.0.1:{srv.server_address[1]}"
    status, _ = _get(base, "/api/world")
    assert status == 200

    from conftest import make_wechat_csv

    from life_energy.accounts.service import add_alias, ensure_account
    from life_energy.ingestion.wechat import WechatParser
    from life_energy.ledger.importer import import_file

    csv_path = db_path.parent / "showcase-month.csv"
    with open_db(db_path) as conn:
        wechat = ensure_account(conn, "微信零钱")
        add_alias(conn, "wechat", "零钱", wechat)
        import_file(
            conn,
            WechatParser(),
            make_wechat_csv(
                csv_path,
                ["2026-08-05 12:00:00,商户消费,某商店,日用品,支出,¥12.00,零钱,支付成功,REF-S1,"],
            ),
            fallback_account_id=wechat,
        )
        before = _all_table_snapshot(conn)

    for path in (
        "/api/health",
        "/api/months",
        "/api/town-state?month=2026-08",
        "/api/ledger-board?month=2026-08",
        "/api/ledger-review?month=2026-08",
        "/api/world",
    ):
        status, _ = _get(base, path)
        assert status == 200

    with open_db(db_path, migrate=False) as conn:
        after = _all_table_snapshot(conn)
    assert after == before
