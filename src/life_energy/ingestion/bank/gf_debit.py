"""广发银行储蓄卡个人活期账户交易明细 (GF debit card, password-protected xlsx).

The export is an OLE-encrypted OOXML workbook; the open password is the one
embedded in the export filename ("…密码5157.xlsx" → "5157"). The file is
decrypted in memory (original untouched) and read with openpyxl:

    交易时间 币种 交易金额 账户余额 对方姓名 对方账号 商户名称 摘要 附言

交易金额 is a signed NUMBER cell; openpyxl yields floats, which the amount
parser routes through repr→Decimal so digits stay exact. 商户名称 carries the
wallet markers ("财付通-扫二维码付款") for cross-channel dedup.
"""

from __future__ import annotations
from datetime import datetime

from pathlib import Path

from ..models import ParseResult, RawTransaction
from .base import BankStatementParser, register_bank_parser
from .pdf_utils import bank_row_reference, decrypt_xlsx, flat_text, password_from_filename

PARSER_VERSION = "bank:gf_debit/1.0"

HEADER_KEYWORDS = ("交易时间", "交易金额", "账户余额", "摘要")
COLUMN_NAMES = ["交易时间", "币种", "交易金额", "账户余额", "对方姓名", "对方账号", "商户名称", "摘要", "附言"]


def rows_from_worksheet(worksheet) -> list[dict]:
    """Pure-ish core: an openpyxl worksheet -> native-field dicts."""
    rows_iter = worksheet.iter_rows(values_only=True)
    header = None
    for row in rows_iter:
        cells = [flat_text(c) for c in row]
        if all(any(keyword == cell for cell in cells) for keyword in HEADER_KEYWORDS):
            header = cells
            break
    if header is None:
        return []
    name_to_index = {name: i for i, name in enumerate(header) if name}
    rows = []
    for row in rows_iter:
        if not row or row[name_to_index["交易时间"]] in (None, ""):
            continue
        fields = {}
        for name in COLUMN_NAMES:
            index = name_to_index.get(name)
            if index is None or index >= len(row):
                continue
            value = row[index]
            if isinstance(value, datetime):
                value = value.strftime("%Y-%m-%d %H:%M:%S")
            fields[name] = flat_text(value)
        if not str(fields.get("交易金额", "")).strip():
            continue
        rows.append(fields)
    return rows


class GfDebitParser(BankStatementParser):
    source = "bank:gf_debit"
    parser_name = "gf_debit_xlsx"
    parser_version = PARSER_VERSION

    def parse(self, file_path: str | Path) -> ParseResult:
        import openpyxl

        result = ParseResult(source=self.source, parser_name=self.parser_name, parser_version=self.parser_version)
        try:
            password = password_from_filename(file_path)
            workbook = openpyxl.load_workbook(decrypt_xlsx(file_path, password), read_only=True, data_only=True)
        except Exception as exc:
            result.errors.append(f"cannot decrypt/open GF debit workbook: {exc}")
            return result
        seen_keys: dict[str, int] = {}
        for fields in rows_from_worksheet(workbook.active):
            key = "|".join(fields.get(name, "") for name in ("交易时间", "交易金额", "摘要", "附言"))
            ordinal = seen_keys.get(key, 0) + 1
            seen_keys[key] = ordinal
            reference = bank_row_reference("gf_debit", fields.get("交易时间", ""), fields.get("交易金额", ""), ordinal=ordinal)
            fields["_row_reference"] = reference
            result.records.append(RawTransaction(
                source=self.source,
                row_index=len(result.records),
                raw_fields=fields,
                row_identity=reference,
            ))
        if not result.records:
            result.errors.append("no GF debit rows found (expected 交易时间/交易金额/账户余额 header)")
        return result


register_bank_parser(GfDebitParser())
