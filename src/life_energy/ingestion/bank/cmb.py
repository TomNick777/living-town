"""招商银行交易流水 (CMB transaction statement, text PDF without ruling lines).

No tables are detectable (extract_tables finds none), so rows are rebuilt from
word coordinates:

    x<90 记账日期 | <150 货币 | <230 交易金额 | <305 联机余额 | <415 交易摘要 | >=415 对手信息

A row anchors on a date-shaped word in the first column. Both 交易摘要 and
对手信息 wrap to lines above/below the anchor (the wrapped counterparty of the
朝朝宝 pairs is the only place those markers live), so every word joins the
nearest anchor within ±14pt; inter-row spacing (~27pt) makes that unambiguous.
Page footers ("3/20") and the bilingual column headers are filtered by shape.
"""

from __future__ import annotations
import re

from pathlib import Path

from ..models import ParseResult, RawTransaction
from .base import BankStatementParser, register_bank_parser
from .pdf_utils import bank_row_reference, pdf_pages

PARSER_VERSION = "bank:cmb/1.0"

DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
AMOUNT_RE = re.compile(r"^-?[\d,]+\.\d{2}$")
FOOTER_RE = re.compile(r"^\d+/\d+$")
CURRENCY_RE = re.compile(r"^[A-Z]{3}$")

# Column left edges (statement layout is fixed); measured from real exports.
COL_DATE, COL_CURRENCY, COL_AMOUNT, COL_BALANCE, COL_SUMMARY = 90, 150, 230, 305, 415
WRAP_WINDOW = 14.0


def _column_of(word) -> str:
    x = word["x0"]
    if x < COL_DATE:
        return "date"
    if x < COL_CURRENCY:
        return "currency"
    if x < COL_AMOUNT:
        return "amount"
    if x < COL_BALANCE:
        return "balance"
    if x < COL_SUMMARY:
        return "summary"
    return "counterparty"


def rows_from_words(words: list[dict]) -> list[dict]:
    """Pure core: pdfplumber words -> row dicts (used directly by tests)."""
    anchors = [w for w in words if _column_of(w) == "date" and DATE_RE.match(w["text"])]
    if not anchors:
        return []
    horizon = min(a["top"] for a in anchors) - WRAP_WINDOW
    rows = {a["top"]: {"top": a["top"], "date": a["text"], "currency": "", "amount": "",
                       "balance": "", "summary": [], "counterparty": []} for a in anchors}
    tops = sorted(rows)
    for word in words:
        column = _column_of(word)
        text = word["text"]
        if column == "date":
            continue
        if column in ("amount", "balance") and not AMOUNT_RE.match(text):
            continue
        if column == "currency" and not CURRENCY_RE.match(text):
            continue
        if FOOTER_RE.match(text) or word["top"] < horizon:
            continue
        anchor = min(tops, key=lambda t: abs(t - word["top"]))
        if abs(anchor - word["top"]) > WRAP_WINDOW:
            continue
        row = rows[anchor]
        if column == "amount" and not row["amount"]:
            row["amount"] = text
        elif column == "balance" and not row["balance"]:
            row["balance"] = text
        elif column == "currency" and not row["currency"]:
            row["currency"] = text
        elif column in ("summary", "counterparty"):
            row[column].append((word["top"], word["x0"], text))
    out = []
    for top in tops:
        row = rows[top]
        if not row["amount"]:
            continue
        row["summary"] = "".join(t for _, _, t in sorted(row["summary"]))
        row["counterparty"] = "".join(t for _, _, t in sorted(row["counterparty"]))
        out.append(row)
    return out


class CmbParser(BankStatementParser):
    source = "bank:cmb"
    parser_name = "cmb_pdf"
    parser_version = PARSER_VERSION

    def parse(self, file_path: str | Path) -> ParseResult:
        result = ParseResult(source=self.source, parser_name=self.parser_name, parser_version=self.parser_version)
        seen_keys: dict[str, int] = {}
        for page in pdf_pages(file_path):
            for row in rows_from_words(page.extract_words()):
                ordinal_key = "|".join([row["date"], row["amount"], row["balance"], row["summary"], row["counterparty"]])
                ordinal = seen_keys.get(ordinal_key, 0) + 1
                seen_keys[ordinal_key] = ordinal
                raw_fields = {
                    "记账日期": row["date"],
                    "货币": row["currency"],
                    "交易金额": row["amount"],
                    "联机余额": row["balance"],
                    "交易摘要": row["summary"],
                    "对手信息": row["counterparty"],
                }
                reference = bank_row_reference("cmb", row["date"], row["amount"], row["balance"], row["summary"], row["counterparty"], ordinal=ordinal)
                raw_fields["_row_reference"] = reference
                result.records.append(RawTransaction(
                    source=self.source,
                    row_index=len(result.records),
                    raw_fields=raw_fields,
                    row_identity=reference,
                ))
        if not result.records:
            result.errors.append("no CMB statement rows found (expected 记账日期/CNY/amount word columns)")
        return result


register_bank_parser(CmbParser())
