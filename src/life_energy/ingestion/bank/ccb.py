"""建设银行个人活期账户全部交易明细 (CCB current-account detail, legacy .xls).

Real BIFF workbook read with xlrd (openpyxl cannot touch .xls). Layout: title/
summary preamble, then a single sheet-wide header row:

    序号 摘要 币别 钞汇 交易日期 交易金额 账户余额 交易地点/附言 对方账号与户名

交易金额 is signed and comma-formatted TEXT ('-9,073.47') — no float ever
appears. 交易日期 is compact 'YYYYMMDD'. 对方账号与户名 is 'acct/name';
the name part is exposed as 对方户名 so counterparty keywords survive
classification, while the raw payload keeps the original composite column.
"""

from __future__ import annotations

from pathlib import Path

from ..models import ParseResult, RawTransaction
from .base import BankStatementParser, register_bank_parser
from .pdf_utils import bank_row_reference

PARSER_VERSION = "bank:ccb/1.0"

HEADER_KEYWORDS = ("序号", "摘要", "交易日期", "交易金额", "账户余额")


def _cell_text(sheet, row: int, col: int) -> str:
    if col >= sheet.ncols:
        return ""
    cell = sheet.cell(row, col)
    if cell.ctype == 0:
        return ""
    value = cell.value
    if isinstance(value, float) and value == int(value):
        # xlrd yields floats for numeric cells; dates/序号 here are text, but a
        # bare numeric amount must enter the pipeline digit-exact, never via
        # float repr ('9224.92' not '9224.9200000000002').
        return str(int(value))
    return str(value).strip()


def rows_from_sheet(sheet) -> list[dict]:
    """Pure core: an xlrd sheet -> native-field dicts (tests exercise this)."""
    header_idx = -1
    for r in range(sheet.nrows):
        cells = [_cell_text(sheet, r, c) for c in range(sheet.ncols)]
        if all(keyword in cells for keyword in HEADER_KEYWORDS):
            header_idx = r
            break
    if header_idx < 0:
        return []
    headers = [_cell_text(sheet, header_idx, c) for c in range(sheet.ncols)]
    rows = []
    for r in range(header_idx + 1, sheet.nrows):
        raw_fields = {headers[c]: _cell_text(sheet, r, c) for c in range(sheet.ncols) if headers[c]}
        if not raw_fields.get("交易金额", "").strip() or not raw_fields.get("交易日期", "").strip():
            continue
        # 对方账号与户名 is the composite 'acct/name'; expose the name so
        # counterparty keywords survive typing/classification.
        account_part, _, name_part = raw_fields.get("对方账号与户名", "").partition("/")
        raw_fields.setdefault("对方账号", account_part.strip())
        raw_fields.setdefault("对方户名", name_part.strip())
        rows.append(raw_fields)
    return rows


class CcbParser(BankStatementParser):
    source = "bank:ccb"
    parser_name = "ccb_xls"
    parser_version = PARSER_VERSION

    def parse(self, file_path: str | Path) -> ParseResult:
        import xlrd

        result = ParseResult(source=self.source, parser_name=self.parser_name, parser_version=self.parser_version)
        try:
            book = xlrd.open_workbook(file_path)
        except Exception as exc:
            result.errors.append(f"cannot open CCB .xls workbook: {exc}")
            return result
        sheet = book.sheet_by_index(0)
        seen_keys: dict[str, int] = {}
        for raw_fields in rows_from_sheet(sheet):
            key = "|".join(raw_fields.get(name, "") for name in ("序号", "交易日期", "交易金额", "摘要"))
            ordinal = seen_keys.get(key, 0) + 1
            seen_keys[key] = ordinal
            reference = bank_row_reference("ccb", raw_fields.get("交易日期", ""), raw_fields.get("序号", ""), raw_fields.get("交易金额", ""), ordinal=ordinal)
            raw_fields["_row_reference"] = reference
            result.records.append(RawTransaction(
                source=self.source,
                row_index=len(result.records),
                raw_fields=raw_fields,
                row_identity=reference,
            ))
        if not result.records:
            result.errors.append("no CCB statement rows found (expected 序号/摘要/交易日期/交易金额 header)")
        return result


register_bank_parser(CcbParser())
