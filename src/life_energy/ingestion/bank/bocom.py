"""交通银行个人客户交易清单 (BoCom personal account details, text PDF).

Layout: one ruled table per page, bilingual two-line header:
    序号 交易日期 交易时间 交易类型 借贷状态 交易金额 余额 对方账号 对方户名 交易地点 摘要
借贷状态 C/D carries the direction; 交易金额 is unsigned. The 摘要/交易地点
cells wrap across several lines and carry the wallet markers (微信零钱提现 /
财付通 / 订单编号…) used downstream for cross-channel duplicate resolution.
"""

from __future__ import annotations

from pathlib import Path

from ..models import ParseResult, RawTransaction
from .base import BankStatementParser, register_bank_parser
from .pdf_utils import bank_row_reference, flat_text, pdf_table_rows

PARSER_VERSION = "bank:bocom/1.0"

HEADER = ["交易日期", "交易时间", "交易类型", "借贷状态", "交易金额", "余额"]
COLUMN_NAMES = [
    "序号", "交易日期", "交易时间", "交易类型", "借贷状态", "交易金额",
    "余额", "对方账号", "对方户名", "交易地点", "摘要",
]


def _header_row_index(table: list[list[str]]) -> int:
    """Bilingual header cells wrap to two lines ('交易日期' + 'Trans Date');
    match keywords against each cell's first line."""
    for index, row in enumerate(table):
        first_lines = [str(cell).splitlines()[0].strip() if str(cell).strip() else "" for cell in row]
        hits = sum(1 for keyword in HEADER if keyword in first_lines)
        if hits >= 4:
            return index
    return -1

def rows_from_tables(tables: list[list[list[str]]]) -> list[dict]:
    """Pure core: extracted PDF tables -> native-field dicts (tests use this)."""
    rows = []
    for table in tables:
        header_idx = _header_row_index(table)
        if header_idx < 0:
            continue
        for row in table[header_idx + 1:]:
            cells = [flat_text(cell) for cell in row]
            if not any(cells):
                continue
            raw_fields = {name: (cells[i] if i < len(cells) else "") for i, name in enumerate(COLUMN_NAMES)}
            if not raw_fields["交易金额"].strip() or not raw_fields["交易日期"].strip():
                continue
            rows.append(raw_fields)
    return rows


def _row_reference(raw_fields: dict, ordinal: int) -> str:
    return bank_row_reference(
        "bocom",
        raw_fields["交易日期"], raw_fields["交易时间"], raw_fields["交易金额"], raw_fields["摘要"],
        ordinal=ordinal,
    )


class BocomParser(BankStatementParser):
    source = "bank:bocom"
    parser_name = "bocom_pdf"
    parser_version = PARSER_VERSION

    def parse(self, file_path: str | Path) -> ParseResult:
        result = ParseResult(source=self.source, parser_name=self.parser_name, parser_version=self.parser_version)
        seen_keys: dict[tuple, int] = {}
        for raw_fields in rows_from_tables(pdf_table_rows(file_path)):
            key = tuple(raw_fields[name] for name in ("交易日期", "交易时间", "交易金额", "摘要"))
            ordinal = seen_keys.get(key, 0) + 1
            seen_keys[key] = ordinal
            reference = _row_reference(raw_fields, ordinal)
            raw_fields["_row_reference"] = reference
            result.records.append(RawTransaction(
                source=self.source,
                row_index=len(result.records),
                raw_fields=raw_fields,
                row_identity=reference,
            ))
        if not result.records:
            result.errors.append("no bocom statement rows found (expected 序号/交易日期/… table)")
        return result


register_bank_parser(BocomParser())
