"""WeChat Pay bill parser (xlsx / csv).

Format knowledge absorbed from all-wallet-manager (verified against real
exports): preamble meta lines, header located by keywords, native id column
交易单号. GBK/UTF-8-BOM encoding fallback for CSV.

Deliberate difference from upstream: rows with status 已退款 are KEPT — they
are the expense evidence that refund pairing needs. Only 交易关闭 rows (no
money ever moved) are skipped, and that is recorded, not silent.
"""

from __future__ import annotations

from pathlib import Path

from ..base import BillParser, find_header_row, read_csv_lines
from ..models import ParseResult, RawTransaction

PARSER_VERSION = "wechat/1.0"

HEADER_KEYWORDS = ["交易时间", "交易类型", "交易对方", "商品", "收/支"]
CSV_ENCODINGS = ("utf-8-sig", "gbk", "gb18030", "utf-8")


class WechatParser(BillParser):
    source = "wechat"
    parser_name = "wechat"
    parser_version = PARSER_VERSION

    def get_channel(self) -> str:
        return self.source

    def parse(self, file_path: str | Path) -> ParseResult:
        path = Path(file_path)
        suffix = path.suffix.lower()
        if suffix == ".xlsx":
            return self._parse_xlsx(path)
        if suffix == ".csv":
            return self._parse_csv(path)
        result = ParseResult(source=self.source, parser_name=self.parser_name, parser_version=self.parser_version)
        result.errors.append(f"unsupported file format: {suffix}")
        return result

    def _parse_csv(self, path: Path) -> ParseResult:
        result = ParseResult(source=self.source, parser_name=self.parser_name, parser_version=self.parser_version)
        try:
            rows = read_csv_lines(path, CSV_ENCODINGS)
        except ValueError as exc:
            result.errors.append(str(exc))
            return result

        header_idx = find_header_row(rows, HEADER_KEYWORDS)
        if header_idx < 0:
            result.errors.append("header row not found (expected WeChat bill keywords)")
            return result

        headers = [cell.strip() for cell in rows[header_idx]]
        result.meta["source_filename"] = path.name
        self._consume(result, headers, rows[header_idx + 1:])
        return result

    def _parse_xlsx(self, path: Path) -> ParseResult:
        import openpyxl

        result = ParseResult(source=self.source, parser_name=self.parser_name, parser_version=self.parser_version)
        try:
            workbook = openpyxl.load_workbook(path, read_only=True, data_only=True)
            sheet = workbook.active
            rows = [list(row) for row in sheet.iter_rows(values_only=True)]
            workbook.close()
        except Exception as exc:  # openpyxl raises a variety of wrapppers
            result.errors.append(f"failed to open workbook: {exc}")
            return result

        header_idx = find_header_row(rows, HEADER_KEYWORDS)
        if header_idx < 0:
            result.errors.append("header row not found (expected WeChat bill keywords)")
            return result

        headers = [str(cell).strip() if cell is not None else "" for cell in rows[header_idx]]
        result.meta["source_filename"] = path.name
        self._consume(result, headers, rows[header_idx + 1:])
        return result

    def _consume(self, result: ParseResult, headers: list[str], data_rows) -> None:
        for offset, row in enumerate(data_rows, start=1):
            if not row or all(cell is None or str(cell).strip() == "" for cell in row):
                continue
            raw_fields = {}
            for column_index, header in enumerate(headers):
                if not header:
                    continue
                value = row[column_index] if column_index < len(row) else None
                if value is None:
                    continue
                raw_fields[header] = value if isinstance(value, str) else str(value)
            reference = raw_fields.get("交易单号", "").strip().replace(" ", "")
            if not reference:
                # Preamble leftovers / trailing summary lines are not transactions.
                continue
            result.records.append(
                RawTransaction(
                    source=self.source,
                    row_index=offset,
                    raw_fields=raw_fields,
                    row_identity=reference,
                )
            )
