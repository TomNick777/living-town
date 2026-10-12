"""Ingestion data models.

A parser's ONLY job: turn a source file into raw rows, faithfully.
It must not classify, interpret, or compute anything beyond extraction.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class RawTransaction:
    """One untouched row from a source bill.

    ``raw_fields`` keeps the original column names and values — this is the
    evidence that lands in ``raw_records.raw_payload``.
    """

    source: str
    row_index: int
    raw_fields: dict
    row_identity: str = ""

    def __post_init__(self):
        if not self.row_identity:
            self.row_identity = f"row:{self.row_index}"


@dataclass
class ParseResult:
    source: str
    parser_name: str
    parser_version: str
    records: list[RawTransaction] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    meta: dict = field(default_factory=dict)
