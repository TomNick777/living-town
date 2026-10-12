"""Local world runtime — minimal read transport (FB-4).

stdlib http.server only (no framework — dependency restraint is a hard repo
rule). This is the Functional Baseline's dev transport layer, NOT a product
backend: no auth, no LAN exposure, no cloud. Security scope:

- bind 127.0.0.1 only (loopback guard in make_server — refuse anything else);
- web never sees SQLite; it only sees these JSON endpoints;
- POST (FB-5) will require a localhost Origin/Host + JSON content-type, the
  minimal browser-side CSRF defence for an unauthenticated local API; plain
  GET reads stay open (they change nothing).

Endpoints:
    GET  /api/health                    -> readiness for local launchers:
                                           {"ok", "service", "database"} —
                                           200 when the DB opens through the
                                           same path every handler uses,
                                           503 with the failure otherwise
    GET  /api/world                     -> TownWorldState JSON (ensure_world
                                           first: first touch seeds, always
                                           idempotent)
    GET  /api/months                    -> {"months": ["YYYY-MM", ...]} —
                                           periods with canonical transactions
                                           (month navigation for the web)
    GET  /api/town-state?month=YYYY-MM  -> TownState projection JSON (pure
                                           derived read, zero writes)
    GET  /api/ledger-board?month=YYYY-MM
                                        -> month board projection (series,
                                           calendar, merchants, account net
                                           flow). Derived read, zero writes.
    GET  /api/ledger-review?month=YYYY-MM
                                        -> period transaction list + unresolved
                                           buckets. Query: type, bucket, q,
                                           limit, offset. Read-only.
    GET  /api/town-events?month=YYYY-MM
                                        -> TownEvent projection for the data-
                                           driven city replay (ledger facts ->
                                           city events; the formal boundary the
                                           renderer consumes). Derived read,
                                           zero writes.
    GET  /api/town-events-v3?since_id=&limit=&month=
                                        -> cross-system fact feed for Otter
                                           City (town-events-v3): all six
                                           transaction types + refund/transfer
                                           pairing state + provenance fields,
                                           incremental by transaction_id
                                           cursor, content-digest ledger
                                           revision. Derived read, zero writes.
    GET  /api/town-events-v3/delta?generation=
                                        -> Phase 2D delta surface for Otter
                                           City warm startup: upserts /
                                           invalidations since the consumer's
                                           acknowledged ledger digest
                                           (generation), honest resync for
                                           unknown generations. In-memory
                                           journal, zero writes.
    GET  /api/town-period?period=YYYY-MM|YYYY
                                        -> month/year showcase snapshot:
                                           financial + activity + events +
                                           period montage presentation.
                                           Derived read, zero writes.
    POST /api/commands                  -> the single write path: one command
                                           envelope {type, expected_revision,
                                           ...}; success returns the FULL new
                                           world; every rejection returns a
                                           stable error code mapped to an
                                           HTTP status (§9). No REST resources,
                                           no DELETE — demolish is a command.
"""

from __future__ import annotations

import json
import re
import sqlite3
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from ...db.connection import open_db
from ...living_town import build_ledger_board, build_ledger_review, build_town_state
from ...living_town.ledger_review import BUCKETS, DEFAULT_LIMIT, MAX_LIMIT, TRANSACTION_TYPES
from ...living_town.queries import available_months
from ...living_town.town_events import build_town_events
from ...living_town.town_events_v3 import DEFAULT_LIMIT as V3_DEFAULT_LIMIT
from ...living_town.town_events_v3 import MAX_LIMIT as V3_MAX_LIMIT
from ...living_town.town_events_v3 import build_town_events_v3
from ...living_town.town_events_v3 import build_town_events_v3_delta
from ...living_town.town_events_v3 import TownEventsDeltaIndex
from ...living_town.town_period import build_town_period, parse_period_key
from .bootstrap import ensure_world, load_world
from .errors import (
    ASSET_NOT_PLACEABLE,
    BUILDING_DEMOLISHED,
    BUILDING_NOT_FOUND,
    COLLISION,
    INVALID_COORDINATE,
    MALFORMED_COMMAND,
    OUT_OF_BOUNDS,
    UNKNOWN_ASSET,
    VERSION_CONFLICT,
    WorldCommandError,
)
from .service import change_building_asset, create_building, demolish_building, move_building
from .runtime_port import DEFAULT_PORT

#: Transport-layer mapping of stable command codes to HTTP status (§9).
HTTP_STATUS_BY_CODE = {
    VERSION_CONFLICT: 409,
    COLLISION: 409,
    OUT_OF_BOUNDS: 422,
    INVALID_COORDINATE: 422,
    UNKNOWN_ASSET: 422,
    ASSET_NOT_PLACEABLE: 422,
    BUILDING_NOT_FOUND: 404,
    BUILDING_DEMOLISHED: 422,
    MALFORMED_COMMAND: 400,
}

#: Per-command required/optional fields; anything else is malformed.
COMMAND_FIELDS = {
    "CreateBuilding": ({"asset_id", "grid_x", "grid_y", "expected_revision"}, {"orientation"}),
    "MoveBuilding": ({"building_id", "grid_x", "grid_y", "expected_revision"}, {"orientation"}),
    "ChangeBuildingAsset": ({"building_id", "asset_id", "expected_revision"}, set()),
    "DemolishBuilding": ({"building_id", "expected_revision"}, set()),
}

MAX_COMMAND_BODY_BYTES = 64 * 1024

#: Loopback-only service. Anything else is a misconfiguration, not a feature.
BIND_HOST = "127.0.0.1"

#: Identity announced by /api/health so a launcher probing the port can tell
#: this service from anything else that might hold 8642.
SERVICE_NAME = "living-town-world"

_LOCAL_ORIGIN_RE = re.compile(r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$", re.IGNORECASE)
_LOCAL_HOST_RE = re.compile(r"^(localhost|127\.0\.0\.1)(:\d+)?$", re.IGNORECASE)


def origin_allowed(headers) -> bool:
    """True when the request may proceed. Browsers always send Origin on
    cross-site POSTs; non-browser clients (CLI, curl) send none and pass —
    they are inside the trust domain (any local process can read the DB)."""
    origin = headers.get("Origin")
    if origin is None:
        return True
    return bool(_LOCAL_ORIGIN_RE.match(origin))


def host_allowed(headers) -> bool:
    """DNS-rebinding defence: a foreign page cannot pivot through its own
    domain to 127.0.0.1 if the Host header must be loopback."""
    return bool(_LOCAL_HOST_RE.match(headers.get("Host", "")))


def local_mutation_guard(headers) -> str | None:
    """Full guard for mutating requests; returns an error string or None."""
    if not origin_allowed(headers):
        return "cross-site origin rejected"
    if not host_allowed(headers):
        return "non-loopback Host header rejected"
    content_type = headers.get("Content-Type", "")
    if "application/json" not in content_type:
        return "Content-Type must be application/json"
    return None


class WorldHTTPServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address: tuple[str, int], db_path: str):
        if address[0] != BIND_HOST:
            raise ValueError(f"the world service binds {BIND_HOST} only, got {address[0]!r}")
        self.db_path = str(db_path)
        # Phase 2D delta surface: per-process, in-memory change journal for
        # the town-events-v3-delta consumer surface. Pure derived state —
        # a restart empties it and consumers get an honest resync.
        self.delta_index = TownEventsDeltaIndex()
        super().__init__(address, WorldRequestHandler)


class WorldRequestHandler(BaseHTTPRequestHandler):
    server_version = "LifeEnergyWorld/1"
    protocol_version = "HTTP/1.1"

    # ---------------------------------------------------------------- io

    def _send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args) -> None:  # noqa: A002 (stdlib signature)
        print(f"world-service: {self.address_string()} {format % args}")

    # ------------------------------------------------------------- verbs

    def do_GET(self) -> None:  # noqa: N802 (stdlib naming)
        parsed = urlparse(self.path)
        try:
            if parsed.path == "/api/health":
                self._get_health()
            elif parsed.path == "/api/world":
                self._get_world()
            elif parsed.path == "/api/months":
                self._get_months()
            elif parsed.path == "/api/town-state":
                self._get_town_state(parse_qs(parsed.query))
            elif parsed.path == "/api/ledger-board":
                self._get_ledger_board(parse_qs(parsed.query))
            elif parsed.path == "/api/ledger-review":
                self._get_ledger_review(parse_qs(parsed.query))
            elif parsed.path == "/api/town-events":
                self._get_town_events(parse_qs(parsed.query))
            elif parsed.path == "/api/town-events-v3":
                self._get_town_events_v3(parse_qs(parsed.query))
            elif parsed.path == "/api/town-events-v3/delta":
                self._get_town_events_v3_delta(parse_qs(parsed.query))
            elif parsed.path == "/api/town-period":
                self._get_town_period(parse_qs(parsed.query))
            else:
                self._send_json(404, {"ok": False, "error": "NOT_FOUND",
                                      "message": f"no such endpoint: {parsed.path}"})
        except BrokenPipeError:
            raise
        except Exception as exc:  # transport layer: report, never crash the server
            self._send_json(500, {"ok": False, "error": "INTERNAL_ERROR", "message": f"{type(exc).__name__}: {exc}"})

    def do_POST(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        problem = local_mutation_guard(self.headers)
        if problem:
            self._send_json(403, {"ok": False, "error": "FORBIDDEN", "message": problem})
            return
        if parsed.path != "/api/commands":
            self._send_json(404, {"ok": False, "error": "NOT_FOUND",
                                  "message": f"no such endpoint: {parsed.path}"})
            return
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_COMMAND_BODY_BYTES:
            self._send_json(400, {"ok": False, "error": MALFORMED_COMMAND, "message": "missing or oversized request body"})
            return
        raw = self.rfile.read(length)
        try:
            payload = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self._send_json(400, {"ok": False, "error": MALFORMED_COMMAND, "message": "request body is not JSON"})
            return
        self._post_command(payload)

    def _post_command(self, payload: object) -> None:
        """Single command endpoint — the ONLY write path exposed over HTTP.
        All rules live in the domain service; this handler translates."""
        if not isinstance(payload, dict):
            self._send_json(400, {"ok": False, "error": MALFORMED_COMMAND, "message": "command must be a JSON object"})
            return
        command_type = payload.get("type")
        if command_type not in COMMAND_FIELDS:
            self._send_json(400, {"ok": False, "error": MALFORMED_COMMAND,
                                  "message": f"unknown command type {command_type!r}",
                                  "detail": {"known": sorted(COMMAND_FIELDS)}})
            return
        required, optional = COMMAND_FIELDS[command_type]
        fields = set(payload) - {"type"}
        missing = required - fields
        unknown = fields - required - optional
        if missing or unknown:
            self._send_json(400, {"ok": False, "error": MALFORMED_COMMAND,
                                  "message": f"command {command_type} fields wrong",
                                  "detail": {"missing": sorted(missing), "unknown": sorted(unknown)}})
            return

        try:
            with open_db(self.server.db_path) as conn:  # type: ignore[attr-defined]
                if command_type == "CreateBuilding":
                    state = create_building(
                        conn,
                        asset_id=payload["asset_id"],
                        grid_x=payload["grid_x"],
                        grid_y=payload["grid_y"],
                        orientation=payload.get("orientation", "S"),
                        expected_revision=payload["expected_revision"],
                        via="web",
                    )
                elif command_type == "MoveBuilding":
                    state = move_building(
                        conn,
                        building_id=payload["building_id"],
                        grid_x=payload["grid_x"],
                        grid_y=payload["grid_y"],
                        orientation=payload.get("orientation"),
                        expected_revision=payload["expected_revision"],
                        via="web",
                    )
                elif command_type == "ChangeBuildingAsset":
                    state = change_building_asset(
                        conn,
                        building_id=payload["building_id"],
                        asset_id=payload["asset_id"],
                        expected_revision=payload["expected_revision"],
                        via="web",
                    )
                else:  # DemolishBuilding
                    state = demolish_building(
                        conn,
                        building_id=payload["building_id"],
                        expected_revision=payload["expected_revision"],
                        via="web",
                    )
        except WorldCommandError as exc:
            self._send_json(HTTP_STATUS_BY_CODE.get(exc.code, 400), {"ok": False, **exc.to_dict()})
            return
        # Success returns the full new world so the client never needs a
        # second GET (and can never end up mid-revision).
        self._send_json(200, {"ok": True, "world": state.to_dict(), "revision": state.revision})

    # -------------------------------------------------------- endpoints

    def _get_health(self) -> None:
        """Minimal readiness probe: the service answers, and the database
        opens through the exact same open path (migrations included) every
        real handler uses — "healthy" here means the town will actually
        serve, not just that a socket is listening."""
        try:
            with open_db(self.server.db_path) as conn:  # type: ignore[attr-defined]
                conn.execute("SELECT 1")
        except Exception as exc:
            self._send_json(503, {"ok": False, "service": SERVICE_NAME,
                                  "database": f"{type(exc).__name__}: {exc}"})
            return
        self._send_json(200, {"ok": True, "service": SERVICE_NAME, "database": "ok"})

    def _get_world(self) -> None:
        with open_db(self.server.db_path) as conn:  # type: ignore[attr-defined]
            ensure_world(conn)
            state = load_world(conn)
        self._send_json(200, state.to_dict())

    def _get_months(self) -> None:
        """Month navigation: which periods exist. Empty list stays empty."""
        with open_db(self.server.db_path) as conn:  # type: ignore[attr-defined]
            months = available_months(conn)
        self._send_json(200, {"months": months})

    def _parse_month(self, params: dict[str, list[str]]) -> str | None:
        months = params.get("month", [])
        month = months[0] if len(months) == 1 else ""
        # The shape regex is not enough: 2026-13 must be a client error
        # (400), never a 500 from deep inside the projection.
        if not re.match(r"^\d{4}-\d{2}$", month or ""):
            self._send_json(400, {"ok": False, "error": MALFORMED_COMMAND,
                                  "message": "month=YYYY-MM is required (Town State is period state)"})
            return None
        try:
            datetime.strptime(month, "%Y-%m")
        except ValueError:
            self._send_json(400, {"ok": False, "error": MALFORMED_COMMAND,
                                  "message": f"not a real calendar month: {month}"})
            return None
        return month

    def _get_town_state(self, params: dict[str, list[str]]) -> None:
        month = self._parse_month(params)
        if month is None:
            return
        with open_db(self.server.db_path) as conn:  # type: ignore[attr-defined]
            state = build_town_state(conn, month)
        self._send_json(200, state.to_dict())

    def _get_ledger_board(self, params: dict[str, list[str]]) -> None:
        month = self._parse_month(params)
        if month is None:
            return
        with open_db(self.server.db_path) as conn:  # type: ignore[attr-defined]
            payload = build_ledger_board(conn, month)
        self._send_json(200, payload)

    def _get_ledger_review(self, params: dict[str, list[str]]) -> None:
        month = self._parse_month(params)
        if month is None:
            return
        transaction_type = (params.get("type") or [None])[0] or None
        bucket = (params.get("bucket") or [None])[0] or None
        q = (params.get("q") or [None])[0] or None
        try:
            limit = int((params.get("limit") or [str(DEFAULT_LIMIT)])[0])
            offset = int((params.get("offset") or ["0"])[0])
        except ValueError:
            self._send_json(400, {"ok": False, "error": MALFORMED_COMMAND,
                                  "message": "limit and offset must be integers"})
            return
        if transaction_type is not None and transaction_type not in TRANSACTION_TYPES:
            self._send_json(400, {"ok": False, "error": MALFORMED_COMMAND,
                                  "message": f"type must be one of {', '.join(TRANSACTION_TYPES)}"})
            return
        if bucket is not None and bucket not in BUCKETS:
            self._send_json(400, {"ok": False, "error": MALFORMED_COMMAND,
                                  "message": f"bucket must be one of {', '.join(BUCKETS)}"})
            return
        if limit < 1 or limit > MAX_LIMIT or offset < 0:
            self._send_json(400, {"ok": False, "error": MALFORMED_COMMAND,
                                  "message": f"limit 1..{MAX_LIMIT}, offset >= 0"})
            return
        with open_db(self.server.db_path) as conn:  # type: ignore[attr-defined]
            payload = build_ledger_review(
                conn,
                month,
                transaction_type=transaction_type,
                bucket=bucket,
                q=q,
                limit=limit,
                offset=offset,
            )
        self._send_json(200, payload)

    def _get_town_events(self, params: dict[str, list[str]]) -> None:
        month = self._parse_month(params)
        if month is None:
            return
        with open_db(self.server.db_path) as conn:  # type: ignore[attr-defined]
            payload = build_town_events(conn, month)
        self._send_json(200, payload)

    def _get_town_events_v3(self, params: dict[str, list[str]]) -> None:
        """Cross-system fact feed for Otter City (town-events-v3): all six
        transaction types, refund/transfer pairing state, provenance fields,
        incremental since_id cursor, content-digest ledger revision.
        Read-only derived projection, zero writes. month= is optional."""
        month = (params.get("month") or [None])[0]
        if month is not None:
            month = self._parse_month({"month": [month]})
            if month is None:
                return
        try:
            since_id = int((params.get("since_id") or ["0"])[0])
            limit = int((params.get("limit") or [str(V3_DEFAULT_LIMIT)])[0])
        except ValueError:
            self._send_json(400, {"ok": False, "error": MALFORMED_COMMAND,
                                  "message": "since_id and limit must be integers"})
            return
        if since_id < 0 or limit < 1 or limit > V3_MAX_LIMIT:
            self._send_json(400, {"ok": False, "error": MALFORMED_COMMAND,
                                  "message": f"since_id >= 0, limit 1..{V3_MAX_LIMIT}"})
            return
        with open_db(self.server.db_path) as conn:  # type: ignore[attr-defined]
            payload = build_town_events_v3(conn, since_id=since_id, limit=limit, month=month)
        self._send_json(200, payload)

    def _get_town_events_v3_delta(self, params: dict[str, list[str]]) -> None:
        """Phase 2D delta surface (town-events-v3-delta/1) for Otter City's
        warm startup: upsert/invalidation between the consumer's acknowledged
        generation (a ledger_revision.digest) and now. Read-only; the journal
        is in-memory derived state, so an unknown generation gets an explicit
        resync instead of a guess."""
        generation = (params.get("generation") or [None])[0]
        if generation is not None and not isinstance(generation, str):
            self._send_json(400, {"ok": False, "error": MALFORMED_COMMAND,
                                  "message": "generation must be a string"})
            return
        with open_db(self.server.db_path) as conn:  # type: ignore[attr-defined]
            payload = build_town_events_v3_delta(
                self.server.delta_index, conn, acknowledged_generation=generation,
            )
        self._send_json(200, payload)

    def _parse_period(self, params: dict[str, list[str]]) -> str | None:
        values = params.get("period", [])
        period = values[0] if len(values) == 1 else ""
        if not period:
            self._send_json(400, {"ok": False, "error": MALFORMED_COMMAND,
                                  "message": "period=YYYY-MM or YYYY is required"})
            return None
        try:
            parse_period_key(period)
        except ValueError as exc:
            self._send_json(400, {"ok": False, "error": MALFORMED_COMMAND,
                                  "message": str(exc)})
            return None
        return period

    def _get_town_period(self, params: dict[str, list[str]]) -> None:
        period = self._parse_period(params)
        if period is None:
            return
        with open_db(self.server.db_path) as conn:  # type: ignore[attr-defined]
            payload = build_town_period(conn, period)
        self._send_json(200, payload)


def make_server(db_path: str | sqlite3.Connection, port: int = DEFAULT_PORT) -> WorldHTTPServer:
    """Bind the loopback-only world service; port 0 picks a free one."""
    server = WorldHTTPServer((BIND_HOST, port), str(db_path))
    return server


def serve(db_path: str, port: int = DEFAULT_PORT) -> None:
    try:
        server = make_server(db_path, port)
    except OSError as exc:
        # A launcher (or a second manual start) hitting a busy port must get
        # one honest line, not a traceback — the existing service on 8642 is
        # discoverable via GET /api/health.
        print(f"world service: cannot bind {BIND_HOST}:{port} — {exc}")
        print("a world service may already be listening (check GET /api/health)")
        raise SystemExit(1) from exc
    host, bound_port = server.server_address[:2]
    print(f"world service: http://{host}:{bound_port}  (db: {server.db_path})")
    print("endpoints: GET /api/health, GET /api/world, GET /api/months, GET /api/town-state?month=YYYY-MM, GET /api/ledger-board?month=YYYY-MM, GET /api/ledger-review?month=YYYY-MM, GET /api/town-events?month=YYYY-MM, GET /api/town-events-v3?since_id=&limit=&month=, GET /api/town-events-v3/delta?generation=, GET /api/town-period?period=YYYY-MM|YYYY, POST /api/commands — Ctrl+C to stop")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nworld service stopped")
    finally:
        server.server_close()
