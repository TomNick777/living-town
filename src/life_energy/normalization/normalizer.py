"""Normalize raw channel rows into canonical transaction candidates.

Pure functions: raw row in, :class:`CanonicalCandidate` out. No DB access, no
policy decisions beyond the channel enum maps — classification, pairing and
energy interpretation happen downstream.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field

from . import enums
from .amount import AmountParseError, direction_from_raw, parse_amount_to_minor, parse_signed_amount_to_minor_and_direction
from .fields import map_fields
from .time import TimeParseError, normalize_time


class NormalizeError(ValueError):
    """A row could not be normalized; the raw evidence is kept and the row skipped."""


@dataclass
class CanonicalCandidate:
    source: str
    occurred_at: str
    amount_minor: int
    direction: str
    transaction_type: str
    source_reference: str
    status: str = ""
    counterparty: str = ""
    merchant: str = ""
    description: str = ""
    payment_method: str = ""
    remark: str = ""
    posted_at: str | None = None
    type_provenance: str = ""  # channel_enum | refund_marker | direction_fallback | bank_heuristic
    raw_fields: dict = field(default_factory=dict)

    @property
    def canonical_fingerprint(self) -> str:
        """Stable semantic identity used for cross-file dedup.

        Channel-native reference is deliberately excluded: it catches
        re-exports of the same underlying transaction even when the channel
        id is synthetic per-file. Bank rows are the exception — several bank
        statements carry date-only precision and genuinely distinct
        content-identical rows (two same-day equal purchases); there the
        reference (which embeds the within-key ordinal) is the only honest
        disambiguator, so it joins the fingerprint for bank sources.
        """
        semantic = "|".join(
            [
                self.source,
                self.payment_method or "",
                self.occurred_at,
                str(self.amount_minor),
                self.direction,
                _normalize_text(self.counterparty),
                _normalize_text(self.description),
            ]
        )
        if self.source.startswith("bank:"):
            semantic += "|" + (self.source_reference or "")
        return hashlib.sha256(semantic.encode("utf-8")).hexdigest()


def _normalize_text(value) -> str:
    return " ".join(str(value or "").strip().lower().split())


def normalize_row(raw_fields: dict, source: str) -> CanonicalCandidate:
    if source == "wechat":
        return normalize_wechat(raw_fields)
    if source == "alipay":
        return normalize_alipay(raw_fields)
    if source.startswith("bank:"):
        return normalize_bank(raw_fields, source)
    raise NormalizeError(f"unknown source: {source}")


def normalize_wechat(raw_fields: dict) -> CanonicalCandidate:
    mapped = map_fields(raw_fields, "wechat")
    status = _text(mapped.get("status"))
    if status in enums.WECHAT_SKIP_STATUSES:
        raise NormalizeError(f"transaction never completed (status={status}); no money moved")

    try:
        amount_minor = parse_amount_to_minor(mapped.get("amount_raw"))
        occurred_at = normalize_time(mapped.get("occurred_raw"), "wechat")
    except (AmountParseError, TimeParseError) as exc:
        raise NormalizeError(str(exc)) from exc

    direction = direction_from_raw(mapped.get("direction_raw"))
    type_raw = _text(mapped.get("type_raw"))
    transaction_type = enums.map_wechat_type(type_raw, status)
    type_provenance = "refund_marker" if transaction_type == enums.REFUND else "channel_enum"
    direction, direction_provenance = _structural_direction(
        direction, type_raw, transaction_type, enums.WECHAT_DIRECTION_OVERRIDES
    )
    if direction_provenance:
        type_provenance = type_provenance + "+" + direction_provenance

    if transaction_type == enums.UNKNOWN and direction == "NEUTRAL":
        raise NormalizeError(f"untyped neutral row (type_raw={type_raw!r}); cannot place it honestly")

    return CanonicalCandidate(
        source="wechat",
        occurred_at=occurred_at,
        amount_minor=amount_minor,
        direction=direction,
        transaction_type=transaction_type,
        type_provenance=type_provenance,
        source_reference=_reference(mapped.get("source_reference")),
        status=status,
        counterparty=_text(mapped.get("counterparty")),
        description=_text(mapped.get("description")),
        payment_method=_text(mapped.get("payment_method")),
        remark=_text(mapped.get("remark")),
        raw_fields=dict(raw_fields),
    )


def normalize_alipay(raw_fields: dict) -> CanonicalCandidate:
    mapped = map_fields(raw_fields, "alipay")
    status = _text(mapped.get("status"))
    if status in enums.ALIPAY_SKIP_STATUSES:
        raise NormalizeError(f"transaction never completed (status={status}); no money moved")

    try:
        amount_minor = parse_amount_to_minor(mapped.get("amount_raw"))
        occurred_at = normalize_time(mapped.get("occurred_raw"), "alipay")
    except (AmountParseError, TimeParseError) as exc:
        raise NormalizeError(str(exc)) from exc

    direction = direction_from_raw(mapped.get("direction_raw"))
    type_raw = _text(mapped.get("type_raw"))
    transaction_type = enums.map_alipay_type(type_raw, status, direction)
    if transaction_type == enums.REFUND and direction == "OUTFLOW":
        # A refund row declared as outflow would be a chargeback-style correction;
        # keep the declared direction, the refund link logic only pairs inflows.
        pass
    elif transaction_type == enums.REFUND:
        direction = "INFLOW"
    type_provenance = (
        "refund_marker"
        if transaction_type == enums.REFUND
        else ("direction_fallback" if type_raw not in enums.ALIPAY_TYPE_MAP else "channel_enum")
    )
    direction, direction_provenance = _structural_direction(
        direction, type_raw, transaction_type, enums.ALIPAY_DIRECTION_OVERRIDES
    )
    if direction_provenance:
        type_provenance = type_provenance + "+" + direction_provenance
    if direction == "NEUTRAL" and transaction_type == enums.INVESTMENT:
        # 投资理财 rows: the description (买入 / 收益发放 / 基金转换 ...) carries
        # the actual movement direction. Fund conversions stay directionless:
        # the money never touches the life cash system.
        investment_direction = enums.map_alipay_investment_direction(_text(mapped.get("description")))
        if investment_direction == enums.INVESTMENT_DIRECTION_INTERNAL:
            type_provenance = type_provenance + "+investment_internal"
        elif investment_direction != "NEUTRAL":
            direction = investment_direction
            type_provenance = type_provenance + "+investment_direction_heuristic"

    if transaction_type == enums.UNKNOWN and direction == "NEUTRAL":
        raise NormalizeError(f"untyped neutral row (type_raw={type_raw!r}); cannot place it honestly")

    return CanonicalCandidate(
        source="alipay",
        occurred_at=occurred_at,
        amount_minor=amount_minor,
        direction=direction,
        transaction_type=transaction_type,
        type_provenance=type_provenance,
        source_reference=_reference(mapped.get("source_reference")),
        status=status,
        counterparty=_text(mapped.get("counterparty")),
        description=_text(mapped.get("description")),
        payment_method=_text(mapped.get("payment_method")),
        remark=_text(mapped.get("remark")),
        raw_fields=dict(raw_fields),
    )


def normalize_bank(raw_fields: dict, source: str) -> CanonicalCandidate:
    mapped = map_fields(raw_fields, source)
    try:
        occurred_at = normalize_time(_bank_occurred_text(mapped), source)
        posted_at = (
            normalize_time(_clean_cell(mapped.get("posted_raw")), source)
            if _clean_cell(mapped.get("posted_raw"))
            else None
        )
        amount_minor, direction = _bank_amount_and_direction(mapped, source)
    except (AmountParseError, TimeParseError) as exc:
        raise NormalizeError(str(exc)) from exc

    description = _composed_description(mapped)
    counterparty = _clean_cell(mapped.get("counterparty"))
    transaction_type = enums.map_bank_type(
        description, source=source, direction=direction, counterparty=counterparty
    )
    return CanonicalCandidate(
        source=source,
        occurred_at=occurred_at,
        posted_at=posted_at,
        amount_minor=amount_minor,
        direction=direction,
        transaction_type=transaction_type,
        type_provenance="bank_heuristic",
        source_reference=_clean_cell(mapped.get("source_reference"))
        or _synthetic_bank_reference(source, occurred_at, amount_minor, direction, description),
        status="",
        description=description,
        counterparty=counterparty,
        merchant=_clean_cell(mapped.get("merchant_raw")),
        raw_fields=dict(raw_fields),
    )


def _clean_cell(value) -> str:
    return " ".join(str(value).split()) if value is not None else ""


def _bank_occurred_text(mapped: dict) -> str:
    """ occurred_raw directly, or date+time cells merged (交通银行 splits them)."""
    direct = _clean_cell(mapped.get("occurred_raw"))
    if direct:
        return direct
    return _clean_cell(
        " ".join(part for part in (mapped.get("occurred_date_raw"), mapped.get("occurred_time_raw")) if part)
    )


# Statements whose explicit direction flag sits in its own column.
BANK_DIRECTION_FLAGS = {
    "C": "INFLOW", "D": "OUTFLOW",  # 借贷状态 (交通银行)
    "收": "INFLOW", "支": "OUTFLOW",  # 支/收 (兴业银行)
    "贷": "INFLOW", "借": "OUTFLOW",
}

# 广发信用卡 statements print positive amounts for spending (debt grows) —
# the inverse of the debit-statement convention (negative = money left).
DEBT_SIGN_SOURCES = ("bank:gf_credit",)


def _bank_amount_and_direction(mapped: dict, source: str) -> tuple[int, str]:
    flag = _clean_cell(mapped.get("direction_raw"))
    if flag:
        direction = BANK_DIRECTION_FLAGS.get(flag)
        if direction is None:
            raise NormalizeError(f"unrecognized bank direction flag: {flag!r}")
        minor = abs(parse_amount_to_minor(mapped.get("amount_raw")))
        return minor, direction
    minor, direction = parse_signed_amount_to_minor_and_direction(mapped.get("amount_raw"))
    if source in DEBT_SIGN_SOURCES:
        direction = "OUTFLOW" if direction == "INFLOW" else "INFLOW"
    return minor, direction


def _composed_description(mapped: dict) -> str:
    """Join the native summary columns; banks split one description over
    several (交通银行: 交易类型 + 交易地点 + 摘要)."""
    parts = [
        _clean_cell(mapped.get(key))
        for key in ("description", "abstract_raw", "abstract_raw2")
    ]
    return " ".join(part for part in parts if part)


def _structural_direction(direction: str, type_raw: str, transaction_type: str, overrides: dict) -> tuple[str, str]:
    """Fill in the structural direction for NEUTRAL-declared flow types.

    Only fires when the channel itself declared 不计收支; explicit 支出/收入
    always wins. Returns (direction, provenance_suffix).
    """
    if direction != "NEUTRAL":
        return direction, ""
    override = overrides.get((type_raw or "").strip())
    if override and transaction_type in ("TRANSFER", "INVESTMENT"):
        return override, "structural_direction_override"
    return direction, ""


def _synthetic_bank_reference(source: str, occurred_at: str, amount_minor: int, direction: str, description: str) -> str:
    """Bank rows without a native id get a deterministic row-level reference.

    Cross-file dedup of synthetic ids is handled by canonical_fingerprint.
    """
    digest = hashlib.sha256(f"{occurred_at}|{amount_minor}|{direction}|{_normalize_text(description)}".encode("utf-8")).hexdigest()[:16]
    return f"{source}:{occurred_at[:10]}:{digest}"


def _reference(value) -> str:
    return str(value or "").strip().replace(" ", "")


def _text(value) -> str:
    return str(value).strip() if value is not None else ""
