"""Reference bank adapter: a minimal generic signed-CSV statement format.

This exists to prove the bank adapter interface end to end (and to power the
cross-channel fixtures in tests). It is NOT a real bank's export format.

Contract (exact lowercase header):
    date,description,amount[,balance]
    2026-08-01,转账 支付宝,-1000.00,5231.40

amount is signed: negative = OUTFLOW, positive = INFLOW.
date is ISO yyyy-mm-dd (posted at 00:00:00+08:00).
"""

from __future__ import annotations

from pathlib import Path

from ..base import find_header_row, read_csv_lines
from ..models import ParseResult, RawTransaction
from .base import BankStatementParser, register_bank_parser

PARSER_VERSION = "bank:generic_csv/1.0"

HEADER = ["date", "description", "amount"]
CSV_ENCODINGS = ("utf-8-sig", "utf-8", "gbk")


class GenericCSVBankParser(BankStatementParser):
    source = "bank:generic_csv"
    parser_name = "generic_csv"
    parser_version = PARSER_VERSION

    def parse(self, file_path: str | Path) -> ParseResult:
        path = Path(file_path)
        result = ParseResult(source=self.source, parser_name=self.parser_name, parser_version=self.parser_version)
        try:
            rows = read_csv_lines(path, CSV_ENCODINGS)
        except ValueError as exc:
            result.errors.append(str(exc))
            return result

        header_idx = find_header_row(rows, HEADER, min_matches=3)
        if header_idx < 0:
            result.errors.append("header row not found (expected: date,description,amount[,balance])")
            return result

        headers = [cell.strip().lower() for cell in rows[header_idx]]
        for offset, row in enumerate(rows[header_idx + 1:], start=1):
            if not row or all(str(cell).strip() == "" for cell in row):
                continue
            raw_fields = {}
            for column_index, header in enumerate(headers):
                if not header:
                    continue
                value = row[column_index] if column_index < len(row) else None
                if value is None:
                    continue
                raw_fields[header] = value if isinstance(value, str) else str(value)
            if not raw_fields.get("amount", "").strip():
                continue
            result.records.append(
                RawTransaction(
                    source=self.source,
                    row_index=offset,
                    raw_fields=raw_fields,
                )
            )
        return result


register_bank_parser(GenericCSVBankParser())
