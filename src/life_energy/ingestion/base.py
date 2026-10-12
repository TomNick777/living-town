"""Parser interface shared by all channels."""

from __future__ import annotations

from abc import ABC, abstractmethod
from pathlib import Path

from .models import ParseResult


class BillParser(ABC):
    """Contract: ``parse(source_file) -> ParseResult`` (list of raw rows)."""

    source: str
    parser_name: str
    parser_version: str

    @abstractmethod
    def parse(self, file_path: str | Path) -> ParseResult:
        ...

    @abstractmethod
    def get_channel(self) -> str:
        """Channel identifier: wechat / alipay / bank:<adapter>."""
        ...


def read_csv_lines(file_path: Path, encodings: tuple[str, ...]) -> list[list[str]]:
    """Read a CSV with an encoding fallback chain (exports are GBK or UTF-8-BOM)."""
    import csv

    last_error: Exception | None = None
    for encoding in encodings:
        try:
            with open(file_path, "r", encoding=encoding, newline="") as handle:
                return list(csv.reader(handle))
        except (UnicodeDecodeError, UnicodeError) as exc:
            last_error = exc
            continue
    raise ValueError(f"unrecognized file encoding: {file_path} ({last_error})")


def find_header_row(rows: list, keywords: list[str], min_matches: int = 3) -> int:
    """Locate the header row under channel preamble lines (>= min_matches keywords)."""
    for index, row in enumerate(rows):
        cells = [str(cell).strip() for cell in row if cell is not None]
        hits = sum(1 for keyword in keywords if keyword in cells)
        if hits >= min_matches:
            return index
    return -1
