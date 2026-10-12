"""兴业银行交易明细 (CIB transaction detail, text PDF with diagonal watermark).

The stamp "兴业银行 2026-… 11:19:22" is printed rotated 30°; pdf_utils filters
those glyphs by matrix before table extraction. Layout: one table per page —

    交易时间 记账日期 摘要 支/收 交易金额 账户余额 交易用途 对方户名 对方账户/对方银行

交易金额 is signed and the 支/收 column agrees; 记账日期 is compact YYYYMMDD.
Wallet-mediated rows show up as 快捷支付 with 支付宝（中国）/财付通… in the
counterparty-account cell — the marker the cross-channel dedup looks for.
"""

from __future__ import annotations

from pathlib import Path

from ..models import ParseResult, RawTransaction
from .base import BankStatementParser, register_bank_parser
from .pdf_utils import bank_row_reference, flat_text, pdf_table_rows

PARSER_VERSION = "bank:cib/1.0"

HEADER = ["交易时间", "记账日期", "摘要", "支/收", "交易金额", "账户余额"]
COLUMN_NAMES = ["交易时间", "记账日期", "摘要", "支/收", "交易金额", "账户余额", "交易用途", "对方户名", "对方账户/对方银行"]


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
            if not raw_fields["交易金额"].strip() or not raw_fields["交易时间"].strip():
                continue
            rows.append(raw_fields)
    return rows


def _row_reference(raw_fields: dict, ordinal: int) -> str:
    return bank_row_reference(
        "cib",
        raw_fields["交易时间"], raw_fields["交易金额"], raw_fields["摘要"],
        ordinal=ordinal,
    )


class CibParser(BankStatementParser):
    source = "bank:cib"
    parser_name = "cib_pdf"
    parser_version = PARSER_VERSION

    def parse(self, file_path: str | Path) -> ParseResult:
        result = ParseResult(source=self.source, parser_name=self.parser_name, parser_version=self.parser_version)
        seen_keys: dict[tuple, int] = {}
        for raw_fields in rows_from_tables(pdf_table_rows(file_path)):
            key = tuple(raw_fields[name] for name in ("交易时间", "交易金额", "摘要"))
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
            result.errors.append("no CIB statement rows found (expected 交易时间/记账日期/… table)")
        return result


register_bank_parser(CibParser())
