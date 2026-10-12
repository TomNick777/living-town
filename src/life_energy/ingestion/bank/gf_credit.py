"""广发银行信用卡综合对账单 (GF credit-card monthly statement, text PDF).

Monthly statements (period 24th → 23rd); every transaction line:

    交易日期 入账日期 交易摘要 交易金额 交易货币 入账金额 入账货币

Sign convention: positive = spending (debt up), negative = credit (退款/还款/
返利金). 交易摘要 carries a bracketed kind marker — (消费)/(退款)/(退货)/
(还款)/(分期)/(赠送)/(还原)/(费用) — and, for wallet-mediated purchases, the
channel marker ("(消费)支付宝-杨荣泉", "(消费)财付通-…") used by cross-channel
dedup. Some rows have NO summary at all; their sign alone says consume/refund.
There is no running balance column, so row references embed the within-key
ordinal to keep genuinely identical same-day rows distinct.
"""

from __future__ import annotations
import re

from pathlib import Path

from ..models import ParseResult, RawTransaction
from .base import BankStatementParser, register_bank_parser
from .pdf_utils import bank_row_reference, pdf_text_lines

PARSER_VERSION = "bank:gf_credit/1.0"

ROW_RE = re.compile(r"^(\d{4}/\d{2}/\d{2})\s+(\d{4}/\d{2}/\d{2})\s+(\S.*)$")
AMOUNT_RE = re.compile(r"^-?[\d,]+\.\d{2}$")


def rows_from_lines(lines: list[str]) -> list[dict]:
    """Pure core: statement lines -> native-field dicts (tests exercise this)."""
    rows = []
    for line in lines:
        match = ROW_RE.match(line.strip())
        if not match:
            continue
        rest = match.group(3).split()
        if len(rest) < 4:
            continue
        entry_amount, entry_currency, posted_amount, posted_currency = rest[-4:]
        if not AMOUNT_RE.match(entry_amount) or not AMOUNT_RE.match(posted_amount):
            continue
        summary = " ".join(rest[:-4])
        rows.append({
            "交易日期": match.group(1),
            "入账日期": match.group(2),
            "交易摘要": summary,
            "交易金额": entry_amount,
            "交易货币": entry_currency,
            "入账金额": posted_amount,
            "入账货币": posted_currency,
        })
    return rows


class GfCreditParser(BankStatementParser):
    source = "bank:gf_credit"
    parser_name = "gf_credit_pdf"
    parser_version = PARSER_VERSION

    def parse(self, file_path: str | Path) -> ParseResult:
        result = ParseResult(source=self.source, parser_name=self.parser_name, parser_version=self.parser_version)
        seen_keys: dict[str, int] = {}
        for fields in rows_from_lines(pdf_text_lines(file_path)):
            key = "|".join(fields[name] for name in ("交易日期", "入账日期", "交易摘要", "交易金额"))
            ordinal = seen_keys.get(key, 0) + 1
            seen_keys[key] = ordinal
            reference = bank_row_reference("gf_credit", fields["交易日期"], fields["交易摘要"], fields["交易金额"], ordinal=ordinal)
            fields["_row_reference"] = reference
            result.records.append(RawTransaction(
                source=self.source,
                row_index=len(result.records),
                raw_fields=fields,
                row_identity=reference,
            ))
        if not result.records:
            result.errors.append("no GF credit-card rows found (expected 交易日期 入账日期 摘要 金额 lines)")
        return result


register_bank_parser(GfCreditParser())
