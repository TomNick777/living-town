"""Idempotent import pipeline: file -> raw evidence -> canonical transactions.

Idempotency (docs/data-invariants.md):
1. File-level: the source sha256 is unique across import_batches. Re-importing
   the exact same file is a short-circuit no-op that reports the original batch.
2. Row-level: a canonical row exists only once per
   ``(source, source_reference)`` (UNIQUE constraint) and once per
   ``canonical_fingerprint``. Duplicates keep their raw evidence row (status
   DUPLICATE) and never create a second canonical transaction.

Raw evidence is append-only: importing never updates or deletes existing
raw_records or transactions.
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
import uuid
from dataclasses import dataclass, field
from pathlib import Path

from ..accounts.service import resolve_account_id
from ..ingestion.base import BillParser
from ..ingestion.models import RawTransaction
from ..normalization.normalizer import CanonicalCandidate, NormalizeError, normalize_row
from .dedup import duplicate_note, find_cross_channel_duplicate, load_consumed_duplicate_targets


@dataclass
class ImportReport:
    batch_id: str
    source_type: str
    source_filename: str
    source_sha256: str
    already_imported: bool = False
    total_rows: int = 0
    imported: int = 0
    duplicates: int = 0
    skipped: int = 0
    errors: list[str] = field(default_factory=list)

    def summary(self) -> str:
        prefix = "already imported" if self.already_imported else "imported"
        return (
            f"{prefix}: {self.imported} new, {self.duplicates} duplicate, "
            f"{self.skipped} skipped of {self.total_rows} rows (batch {self.batch_id[:8]})"
        )


def file_sha256(file_path: str | Path) -> str:
    digest = hashlib.sha256()
    with open(file_path, "rb") as handle:
        for chunk in iter(lambda: handle.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest()


def import_file(
    conn: sqlite3.Connection,
    parser: BillParser,
    file_path: str | Path,
    fallback_account_id: int | None = None,
) -> ImportReport:
    path = Path(file_path)
    if not path.is_file():
        raise FileNotFoundError(f"bill file not found: {path}")
    # Originals are read-only evidence: never renamed, moved or rewritten.
    sha = file_sha256(path)

    existing = conn.execute(
        "SELECT * FROM import_batches WHERE source_sha256 = ?", (sha,)
    ).fetchone()
    if existing:
        return ImportReport(
            batch_id=existing["batch_id"],
            source_type=existing["source_type"],
            source_filename=existing["source_filename"],
            source_sha256=sha,
            already_imported=True,
            total_rows=existing["total_rows"],
            imported=existing["imported_rows"],
            duplicates=existing["duplicate_rows"],
            skipped=existing["skipped_rows"],
        )

    parse_result = parser.parse(path)
    if parse_result.errors and not parse_result.records:
        # Fatal parse failure: nothing is written.
        raise RuntimeError(f"parse failed for {path.name}: {'; '.join(parse_result.errors)}")

    # Wallet facts that already absorbed a bank duplicate in earlier batches
    # stay consumed, so statement multiplicity is respected across files.
    consumed_duplicate_targets = load_consumed_duplicate_targets(conn)

    batch_id = str(uuid.uuid4())
    report = ImportReport(
        batch_id=batch_id,
        source_type=parser.get_channel(),
        source_filename=path.name,
        source_sha256=sha,
        total_rows=len(parse_result.records),
        errors=list(parse_result.errors),
    )

    try:
        conn.execute(
            """
            INSERT INTO import_batches
                (batch_id, source_type, source_filename, source_sha256, parser_name, parser_version,
                 total_rows, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                batch_id,
                report.source_type,
                report.source_filename,
                sha,
                parser.parser_name,
                parser.parser_version,
                report.total_rows,
                json.dumps({"parse_errors": parse_result.errors}, ensure_ascii=False) if parse_result.errors else None,
            ),
        )

        for raw in parse_result.records:
            _import_row(conn, batch_id, parser, raw, fallback_account_id, report, consumed_duplicate_targets)

        conn.execute(
            """
            UPDATE import_batches
            SET imported_rows = ?, duplicate_rows = ?, skipped_rows = ?
            WHERE batch_id = ?
            """,
            (report.imported, report.duplicates, report.skipped, batch_id),
        )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    return report


def _import_row(
    conn: sqlite3.Connection,
    batch_id: str,
    parser: BillParser,
    raw: RawTransaction,
    fallback_account_id: int | None,
    report: ImportReport,
    consumed_duplicate_targets: set[int],
) -> None:
    try:
        candidate = normalize_row(raw.raw_fields, raw.source)
    except NormalizeError as exc:
        report.skipped += 1
        conn.execute(
            """
            INSERT INTO raw_records
                (batch_id, row_index, source_row_identity, raw_payload, parser_name, parser_version, status, status_note)
            VALUES (?, ?, ?, ?, ?, ?, 'SKIPPED', ?)
            """,
            (batch_id, raw.row_index, raw.row_identity, _payload(raw), parser.parser_name, parser.parser_version, str(exc)),
        )
        return

    account_id = resolve_account_id(conn, raw.source, candidate.payment_method)
    if account_id is None:
        account_id = fallback_account_id

    duplicate_of = _find_duplicate(conn, candidate)
    wallet_duplicate_of = None
    if duplicate_of is None and candidate.source.startswith("bank:"):
        wallet_duplicate_of = find_cross_channel_duplicate(conn, candidate, account_id, consumed_duplicate_targets)
    if duplicate_of is not None or wallet_duplicate_of is not None:
        report.duplicates += 1
        if wallet_duplicate_of is not None:
            consumed_duplicate_targets.add(wallet_duplicate_of)
            status_note = duplicate_note(wallet_duplicate_of)
        else:
            status_note = f"duplicate of transaction {duplicate_of}"
        conn.execute(
            """
            INSERT INTO raw_records
                (batch_id, row_index, source_row_identity, raw_payload, parser_name, parser_version, status, status_note)
            VALUES (?, ?, ?, ?, ?, ?, 'DUPLICATE', ?)
            """,
            (
                batch_id,
                raw.row_index,
                raw.row_identity,
                _payload(raw),
                parser.parser_name,
                parser.parser_version,
                status_note,
            ),
        )
        return

    raw_cursor = conn.execute(
        """
        INSERT INTO raw_records
            (batch_id, row_index, source_row_identity, raw_payload, parser_name, parser_version, status)
        VALUES (?, ?, ?, ?, ?, ?, 'IMPORTED')
        """,
        (batch_id, raw.row_index, raw.row_identity, _payload(raw), parser.parser_name, parser.parser_version),
    )
    raw_record_id = raw_cursor.lastrowid

    tx_cursor = conn.execute(
        """
        INSERT INTO transactions
            (occurred_at, posted_at, source, source_account_id, counterparty, merchant, description,
             amount_minor, currency, direction, transaction_type, status, source_reference,
             canonical_fingerprint, import_batch_id, raw_record_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'CNY', ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            candidate.occurred_at,
            candidate.posted_at,
            candidate.source,
            account_id,
            candidate.counterparty or None,
            candidate.merchant or None,
            candidate.description or None,
            candidate.amount_minor,
            candidate.direction,
            candidate.transaction_type,
            candidate.status or None,
            candidate.source_reference,
            candidate.canonical_fingerprint,
            batch_id,
            raw_record_id,
        ),
    )
    conn.execute(
        "UPDATE raw_records SET canonical_transaction_id = ? WHERE raw_record_id = ?",
        (tx_cursor.lastrowid, raw_record_id),
    )
    report.imported += 1


def _find_duplicate(conn: sqlite3.Connection, candidate: CanonicalCandidate) -> int | None:
    row = conn.execute(
        "SELECT transaction_id FROM transactions WHERE source = ? AND source_reference = ?",
        (candidate.source, candidate.source_reference),
    ).fetchone()
    if row:
        return row["transaction_id"]
    row = conn.execute(
        "SELECT transaction_id FROM transactions WHERE canonical_fingerprint = ?",
        (candidate.canonical_fingerprint,),
    ).fetchone()
    return row["transaction_id"] if row else None


def _payload(raw: RawTransaction) -> str:
    return json.dumps(raw.raw_fields, ensure_ascii=False, sort_keys=True, default=str)
