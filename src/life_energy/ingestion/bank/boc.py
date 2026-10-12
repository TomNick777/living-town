"""中国银行交易流水明细清单 (BOC transaction detail, encrypted text PDF).

The export page puts the open password in the file name (...密码451203.pdf);
pdfplumber decrypts via pdfminer, so no extra dependency. Layout: one table
per page under the header —

    记账日期 记账时间 币别 金额 余额 交易名称 渠道 网点名称 附言 对方账户名 对方卡号/账号 对方开户行

金额 is signed (negative = money left the account); the statement header
prints 借记卡号 for the single account the file represents (attribution via
``--account`` at import time). Placeholder cells print as dash rows
("-------------------" / "----------") and are kept verbatim as evidence.
Wallet-mediated rows say 网上快捷支付 with 支付宝 in 附言/对方账户名 — the
marker the cross-channel dedup looks for.
"""

from __future__ import annotations

from pathlib import Path

from ..models import ParseResult, RawTransaction
from .base import BankStatementParser, register_bank_parser
from .pdf_utils import bank_row_reference, flat_text, password_from_filename, pdf_table_rows

PARSER_VERSION = "bank:boc/1.0"

HEADER = ["记账日期", "金额", "余额", "交易名称", "渠道"]
COLUMN_NAMES = [
    "记账日期", "记账时间", "币别", "金额", "余额", "交易名称", "渠道",
    "网点名称", "附言", "对方账户名", "对方卡号/账号", "对方开户行",
]


def _header_row_index(table: list[list[str]]) -> int:
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
            if not raw_fields["金额"].strip() or not raw_fields["记账日期"].strip():
                continue
            rows.append(raw_fields)
    return rows


def _statement_tables(path: str | Path) -> list[list[list[str]]]:
    """BOC exports are encrypted; the password rides in the file name.
    An unencrypted export (if the bank ever ships one) opens directly."""
    try:
        return pdf_table_rows(path)
    except Exception:
        return pdf_table_rows(path, password=password_from_filename(path))


class BocParser(BankStatementParser):
    source = "bank:boc"
    parser_name = "boc_pdf"
    parser_version = PARSER_VERSION

    def parse(self, file_path: str | Path) -> ParseResult:
        result = ParseResult(source=self.source, parser_name=self.parser_name, parser_version=self.parser_version)
        seen_keys: dict[tuple, int] = {}
        for raw_fields in rows_from_tables(_statement_tables(file_path)):
            key = tuple(raw_fields[name] for name in ("记账日期", "记账时间", "金额", "交易名称"))
            ordinal = seen_keys.get(key, 0) + 1
            seen_keys[key] = ordinal
            reference = bank_row_reference(
                "boc",
                raw_fields["记账日期"], raw_fields["记账时间"], raw_fields["金额"], raw_fields["交易名称"],
                ordinal=ordinal,
            )
            raw_fields["_row_reference"] = reference
            result.records.append(RawTransaction(
                source=self.source,
                row_index=len(result.records),
                raw_fields=raw_fields,
                row_identity=reference,
            ))
        if not result.records:
            result.errors.append("no BOC statement rows found (expected 记账日期/金额/… table)")
        return result


register_bank_parser(BocParser())
