"""Bank statement adapter interface.

Life Energy does not ship real bank parsers in v1. Each bank gets an adapter
registered here; the ingestion/normalization/ledger pipeline is identical for
every adapter (parse -> normalize -> canonical, with provenance).

Adapter contract:
    - source id:  "bank:<adapter_name>" (e.g. bank:ccb, bank:generic_csv)
    - parse(file) -> ParseResult of RawTransaction
    - every row MUST carry the statement account identity when the file
      represents a single account (usually via ``--account`` at import time)
    - signed amounts are normalized downstream (negative = OUTFLOW)
    - rows without a native reference get a deterministic synthetic one;
      cross-file dedup then relies on canonical_fingerprint

Register a real bank adapter with :func:`register_bank_parser` and
``life-energy import bank:<adapter_name> <file>`` picks it up.
"""

from __future__ import annotations

from pathlib import Path

from ..base import BillParser
from ..models import ParseResult

BANK_PARSERS: dict[str, BillParser] = {}


def register_bank_parser(parser: BillParser) -> BillParser:
    channel = parser.get_channel()
    if not channel.startswith("bank:"):
        raise ValueError(f"bank adapter channel must start with 'bank:', got {channel!r}")
    BANK_PARSERS[channel] = parser
    return parser


def get_bank_parser(channel: str) -> BillParser:
    parser = BANK_PARSERS.get(channel)
    if parser is None:
        known = ", ".join(sorted(BANK_PARSERS)) or "<none registered>"
        raise KeyError(f"no bank adapter registered for {channel!r}; known: {known}")
    return parser


class BankStatementParser(BillParser):
    """Base class for bank adapters; enforces the 'bank:' source namespace."""

    def get_channel(self) -> str:
        return self.source

    def parse(self, file_path: str | Path) -> ParseResult:
        raise NotImplementedError
