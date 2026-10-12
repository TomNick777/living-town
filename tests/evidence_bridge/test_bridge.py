"""Evidence bridge tests: registration payloads, degradation, CLI wiring.

The bridge is best-effort by contract — every test here also asserts that a
failing evidence service can never break the import itself.
"""

from __future__ import annotations

import urllib.error

import pytest

from conftest import FIXTURES
from life_energy.cli import main as cli_main
from life_energy.cli.main import main
from life_energy.evidence_bridge import EvidenceBridge
from life_energy.ledger.importer import file_sha256, import_file
from life_energy.ingestion.wechat import WechatParser

BILL = FIXTURES / "wechat_202608.csv"


class StubTransport:
    """Canned HTTP responses; records every call for assertions."""

    def __init__(self, responses):
        self.calls: list[tuple] = []
        self.responses = list(responses)

    def __call__(self, method, url, payload=None, timeout=2.0):
        self.calls.append((method, url, payload))
        result = self.responses.pop(0)
        if isinstance(result, Exception):
            raise result
        return result


def make_report(already=False):
    from life_energy.ledger.importer import ImportReport

    return ImportReport(
        batch_id="11111111-2222-3333-4444-555555555555",
        source_type="wechat",
        source_filename=BILL.name,
        source_sha256=file_sha256(BILL),
        already_imported=already,
        total_rows=10,
        imported=8,
        duplicates=2,
        skipped=0,
    )


def test_notify_import_posts_evidence_then_extraction():
    transport = StubTransport([(201, {"outcome": "CREATED", "evidence": {"revision": 42}}), (201, {"ok": True}), (200, {"ok": True})])
    bridge = EvidenceBridge(base_url="http://127.0.0.1:1", transport=transport)

    outcome = bridge.notify_import(BILL, make_report(), parser_version="wechat/1.0")

    assert outcome.contacted and outcome.evidence_status == "CREATED" and outcome.extraction_status == "RECORDED"
    assert "checkpoint -> 42" in outcome.detail
    method, url, payload = transport.calls[0]
    assert (method, url) == ("POST", "http://127.0.0.1:1/evidence")
    assert payload["sha256"] == file_sha256(BILL)
    assert payload["sizeBytes"] == BILL.stat().st_size and payload["path"].endswith(BILL.name)

    method, url, payload = transport.calls[1]
    assert (method, url) == ("POST", "http://127.0.0.1:1/extraction")
    assert payload["evidenceId"] == file_sha256(BILL)
    assert payload["extractor"] == "living-town:wechat"
    assert payload["extractorVersion"] == "wechat/1.0"
    assert payload["resultRef"] == "life-energy:batch:11111111-2222-3333-4444-555555555555"
    assert payload["note"] == "imported=8/10 duplicate=2 skipped=0"

    # Analysis Delta cursor advances after the extraction was reported
    method, url, payload = transport.calls[2]
    assert (method, url) == ("POST", "http://127.0.0.1:1/checkpoint")
    assert payload == {"consumer": "living-town", "revision": 42}


def test_already_registered_reports_duplicate_and_guard():
    transport = StubTransport([
        (200, {"outcome": "DUPLICATE", "evidence": {"revision": 7}}),
        (409, {"error": "ALREADY_EXTRACTED"}),
        (200, {"ok": True}),
    ])
    bridge = EvidenceBridge(transport=transport)

    outcome = bridge.notify_import(BILL, make_report(already=True), parser_version="wechat/1.0")

    assert outcome.evidence_status == "DUPLICATE"
    assert outcome.extraction_status.startswith("ALREADY_EXTRACTED")
    # even a late DUPLICATE advances (server clamps to monotonic-forward)
    assert "checkpoint -> 7" in outcome.detail


def test_service_down_degrades_without_raising():
    transport = StubTransport([urllib.error.URLError("connection refused")])
    bridge = EvidenceBridge(transport=transport)

    outcome = bridge.notify_import(BILL, make_report(), parser_version="wechat/1.0")

    assert outcome.contacted is False
    assert "ledger unaffected" in outcome.detail
    assert len(transport.calls) == 1  # extraction never attempted after evidence POST failed


def test_real_unreachable_port_degrades():
    # port 1 on localhost: nothing listens there; this exercises the real urllib path
    bridge = EvidenceBridge(base_url="http://127.0.0.1:1", timeout=0.5)
    outcome = bridge.notify_import(BILL, make_report(), parser_version="wechat/1.0")
    assert outcome.contacted is False


def test_cli_import_notifies_evidence(tmp_path, monkeypatch, capsys):
    calls = []

    class StubBridge:
        def __init__(self, *a, **k):
            pass

        def notify_import(self, file_path, report, *, parser_version):
            calls.append((str(file_path), report.batch_id, parser_version))
            return type("O", (), {"contacted": True, "detail": "evidence CREATED, extraction RECORDED"})()

    monkeypatch.setattr(cli_main, "EvidenceBridge", StubBridge)
    db = tmp_path / "ledger.db"
    assert main(["--db", str(db), "import", "wechat", str(BILL)]) == 0
    out = capsys.readouterr().out
    assert "evidence: evidence CREATED, extraction RECORDED" in out
    assert calls and calls[0][0].endswith(BILL.name) and calls[0][2] == "wechat/1.0"


def test_cli_import_survives_bridge_bug(tmp_path, monkeypatch, capsys):
    class BrokenBridge:
        def __init__(self, *a, **k):
            pass

        def notify_import(self, *a, **k):
            raise RuntimeError("bridge bug")

    monkeypatch.setattr(cli_main, "EvidenceBridge", BrokenBridge)
    db = tmp_path / "ledger.db"
    assert main(["--db", str(db), "import", "wechat", str(BILL)]) == 0  # import still succeeds
    err = capsys.readouterr().err
    assert "bridge error ignored" in err


def test_cli_import_reports_unreachable_service(tmp_path, monkeypatch, capsys):
    class UnreachableBridge:
        base_url = "http://127.0.0.1:1"

        def __init__(self, *a, **k):
            pass

        def notify_import(self, *a, **k):
            return type("O", (), {"contacted": False, "detail": "unavailable (URLError); ledger unaffected"})()

    monkeypatch.setattr(cli_main, "EvidenceBridge", UnreachableBridge)
    db = tmp_path / "ledger.db"
    assert main(["--db", str(db), "import", "wechat", str(BILL)]) == 0
    captured = capsys.readouterr()
    assert "evidence: unavailable" in captured.out
    assert "EVIDENCE_API_URL" in captured.err


def test_evidence_status_lists_batches_and_survives_outage(tmp_path, monkeypatch, capsys):
    from life_energy.db.connection import open_db
    from life_energy.classification.seed import seed_all

    db = tmp_path / "ledger.db"
    with open_db(db) as conn:
        seed_all(conn)
        import_file(conn, WechatParser(), BILL)

    class KnownBridge:
        base_url = "http://127.0.0.1:7366"

        def __init__(self, *a, **k):
            pass

        def get_evidence(self, sha):
            return 200, {"locations": [{"path": "D:/vault/x.xlsx"}]}

        def get_extraction(self, sha, extractor):
            return 200, {"extraction": {"state": "EXTRACTED", "resultRef": "life-energy:batch:abc"}, "mayAnalyze": False}

    monkeypatch.setattr(cli_main, "EvidenceBridge", KnownBridge)
    assert main(["--db", str(db), "evidence", "status"]) == 0
    out = capsys.readouterr().out
    assert "registered" in out and "EXTRACTED" in out and "1 registered, 1 extracted of 1 batch(es)" in out

    class DeadBridge:
        base_url = "http://127.0.0.1:1"

        def __init__(self, *a, **k):
            pass

        def get_evidence(self, sha):
            raise urllib.error.URLError("refused")

        def get_extraction(self, sha, extractor):
            raise urllib.error.URLError("refused")

    monkeypatch.setattr(cli_main, "EvidenceBridge", DeadBridge)
    assert main(["--db", str(db), "evidence", "status"]) == 0
    out = capsys.readouterr().out
    assert "service down" in out and "ledger itself is unaffected" in out
