"""Amount normalization.

Hard rules (docs/data-invariants.md):
- Money is stored as INTEGER minor units (fen): ¥10.23 -> 1023.
- Parsing goes through Decimal; binary floats never touch an amount.
- Canonical ``amount_minor`` is always >= 0; the sign lives in ``direction``.
- WeChat/Alipay bill amounts are unsigned ("¥32.00"); direction comes from the
  收/支 column. Bank statements carry signed amounts; the sign IS direction.
"""

from __future__ import annotations

import re
from decimal import Decimal, InvalidOperation

CLEAN_RE = re.compile(r"[¥￥,\s]")
SIGNED_RE = re.compile(r"^[+-]?\d+(\.\d+)?$")

INFLOW = "INFLOW"
OUTFLOW = "OUTFLOW"
NEUTRAL = "NEUTRAL"

# 收/支 column vocabulary (both channels + aliases)
DIRECTION_MAP = {
    "支出": OUTFLOW,
    "支出（扣除）": OUTFLOW,
    "expense": OUTFLOW,
    "收入": INFLOW,
    "income": INFLOW,
    "不计收支": NEUTRAL,
    "不计入收支": NEUTRAL,
    "不计入": NEUTRAL,
    "neutral": NEUTRAL,
}


class AmountParseError(ValueError):
    pass


def parse_amount_to_minor(raw_amount) -> int:
    """'¥1,234.56' -> 123456. Raises on anything that is not a clean amount."""
    if raw_amount is None:
        raise AmountParseError("amount is empty")
    if isinstance(raw_amount, float):
        # Guard against upstream float contamination; convert via repr to Decimal.
        raw_amount = repr(raw_amount)
    cleaned = CLEAN_RE.sub("", str(raw_amount).strip())
    if not cleaned or not SIGNED_RE.match(cleaned):
        raise AmountParseError(f"unparseable amount: {raw_amount!r}")
    try:
        minor = (Decimal(cleaned) * 100).to_integral_value()
    except InvalidOperation as exc:
        raise AmountParseError(f"unparseable amount: {raw_amount!r}") from exc
    return int(minor)


def parse_signed_amount_to_minor_and_direction(raw_amount) -> tuple[int, str]:
    """Bank-style signed amount: -32.00 -> (3200, OUTFLOW); +10.00 -> (1000, INFLOW)."""
    minor = parse_amount_to_minor(raw_amount)
    cleaned = CLEAN_RE.sub("", str(raw_amount).strip())
    if cleaned.startswith("-"):
        return abs(minor), OUTFLOW
    return minor, INFLOW


def direction_from_raw(raw_direction) -> str:
    if raw_direction is None:
        return NEUTRAL
    key = str(raw_direction).strip()
    return DIRECTION_MAP.get(key, NEUTRAL)


def minor_to_display(amount_minor: int) -> str:
    """1023 -> '10.23' for human-facing output only; never for storage."""
    sign = "-" if amount_minor < 0 else ""
    return f"{sign}{abs(amount_minor) // 100}.{abs(amount_minor) % 100:02d}"
