"""Evidence bridge: living-town as an Otter Evidence consumer (Phase 4).

After a successful bill import this bridge registers the file's content with
the local Otter Evidence service (docs: otter-evidence repo,
docs/migration-plan-living-town.md). The ledger NEVER depends on it:

- best-effort only: any failure degrades to a warning, never an error,
  never a rollback, never a changed exit code (记账永远优先);
- HTTP only: the evidence registry's SQLite schema is an implementation
  detail no consumer may touch;
- stdlib only (urllib), keeping the "openpyxl is the only runtime dep" rule;
- the sha256 comes from the ledger (import_batches / ImportReport) — the
  bridge never re-hashes, identity stays ledger-authoritative;
- extractor naming matches the Phase 2 reconciliation
  (``living-town:<source_type>``) so re-imports report ALREADY_EXTRACTED
  instead of duplicating processing state.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path

DEFAULT_BASE_URL = "http://127.0.0.1:7366"


@dataclass
class BridgeOutcome:
    contacted: bool
    detail: str
    evidence_status: str | None = None
    extraction_status: str | None = None


def _http_request(method: str, url: str, payload: dict | None = None, timeout: float = 2.0) -> tuple[int, dict]:
    """Return (http_status, parsed_body). HTTP error codes are values, not exceptions."""
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    request = urllib.request.Request(url, method=method, data=data,
                                     headers={"content-type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read().decode("utf-8")
            return response.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8")
        try:
            return exc.code, json.loads(raw) if raw else {}
        except ValueError:
            return exc.code, {}


class EvidenceBridge:
    def __init__(self, base_url: str | None = None, timeout: float = 2.0, transport=None) -> None:
        env_url = os.environ.get("EVIDENCE_API_URL")
        self.base_url = (base_url or env_url or DEFAULT_BASE_URL).rstrip("/")
        self.timeout = timeout
        self._transport = transport or _http_request

    def notify_import(self, file_path: str | Path, report, *, parser_version: str | None) -> BridgeOutcome:
        """Register the imported file's content + report the extraction state.

        ``report`` is ledger.importer.ImportReport. Never raises.
        """
        path = Path(file_path)
        payload: dict = {
            "sha256": report.source_sha256,
            "origin": "ingest",
            "notes": "life-energy import bridge",
        }
        try:
            if path.is_file():
                payload["sizeBytes"] = path.stat().st_size
                payload["path"] = str(path)
        except OSError:
            pass  # unreadable file: register content without a location claim

        try:
            code, body = self._transport("POST", f"{self.base_url}/evidence", payload, self.timeout)
        except Exception as exc:  # urllib.error.URLError, TimeoutError, OSError …
            return BridgeOutcome(False, f"unavailable ({exc.__class__.__name__}); ledger unaffected, "
                                        f"run reconcile later to backfill")
        if code not in (200, 201):
            return BridgeOutcome(True, f"register rejected (HTTP {code}: {body.get('error', body)})")

        evidence_status = str(body.get("outcome"))

        if not parser_version:
            return BridgeOutcome(True, f"evidence {evidence_status}; extraction not reported (no parser version)")

        extraction = {
            "evidenceId": report.source_sha256,
            "extractor": f"living-town:{report.source_type}",
            "extractorVersion": parser_version,
            "state": "EXTRACTED",
            "resultRef": f"life-energy:batch:{report.batch_id}",
            "note": f"imported={report.imported}/{report.total_rows} "
                    f"duplicate={report.duplicates} skipped={report.skipped}",
        }
        checkpoint_note = ""  # advance only after the extraction itself is reported
        try:
            code2, body2 = self._transport("POST", f"{self.base_url}/extraction", extraction, self.timeout)
        except Exception as exc:
            return BridgeOutcome(True, f"evidence {evidence_status}; extraction report failed "
                                       f"({exc.__class__.__name__}){checkpoint_note}")
        if code2 == 409:
            extraction_status = "ALREADY_EXTRACTED (do not reanalyze)"
        elif code2 == 201:
            extraction_status = "RECORDED"
        else:
            extraction_status = f"HTTP {code2}: {body2.get('error', body2)}"

        # checkpoint last: "processed up to revision N" is only true once the
        # extraction itself has been reported.
        checkpoint_note = self._advance_checkpoint(body)
        return BridgeOutcome(True, f"evidence {evidence_status}, extraction {extraction_status}{checkpoint_note}",
                             evidence_status, extraction_status)

    def _advance_checkpoint(self, evidence_body: dict) -> str:
        """Move living-town's Analysis Delta cursor to this evidence's revision.

        Server-side the checkpoint is monotonic, so this only ever moves it
        forward. Failure degrades to an empty note — never an exception.
        """
        revision = ((evidence_body or {}).get("evidence") or {}).get("revision")
        if revision is None:
            return ""
        try:
            self._transport("POST", f"{self.base_url}/checkpoint",
                            {"consumer": "living-town", "revision": revision}, self.timeout)
            return f", checkpoint -> {revision}"
        except Exception:
            return ""

    def get_evidence(self, sha256: str) -> tuple[int, dict]:
        code, body = self._transport("GET", f"{self.base_url}/evidence/{sha256}", None, self.timeout)
        return code, body

    def get_extraction(self, sha256: str, extractor: str) -> tuple[int, dict]:
        from urllib.parse import quote
        code, body = self._transport(
            "GET", f"{self.base_url}/extraction?evidenceId={sha256}&extractor={quote(extractor)}",
            None, self.timeout,
        )
        return code, body
