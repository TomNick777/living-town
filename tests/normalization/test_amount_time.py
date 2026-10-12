"""Money can never be approximate: Decimal -> integer minor units, always."""

from __future__ import annotations

import pytest

from life_energy.normalization.amount import (
    AmountParseError,
    direction_from_raw,
    minor_to_display,
    parse_amount_to_minor,
    parse_signed_amount_to_minor_and_direction,
)
from life_energy.normalization.time import TimeParseError, normalize_time


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("¥10.23", 1023),
        ("￥1,234.56", 123456),
        ("0.01", 1),
        (" 32.00 ", 3200),
        (12.34, 1234),
        ("100", 10000),
    ],
)
def test_amount_to_minor(raw, expected):
    assert parse_amount_to_minor(raw) == expected


def test_signed_amount_direction():
    assert parse_signed_amount_to_minor_and_direction("-32.00") == (3200, "OUTFLOW")
    assert parse_signed_amount_to_minor_and_direction("+20000.00") == (2000000, "INFLOW")
    assert parse_signed_amount_to_minor_and_direction("30.00") == (3000, "INFLOW")


@pytest.mark.parametrize("bad", ["", "abc", "1.2.3", "¥--", None])
def test_amount_rejects_garbage(bad):
    with pytest.raises(AmountParseError):
        parse_amount_to_minor(bad)


def test_no_binary_float_drift():
    # 0.1 + 0.2 drifts in float; Decimal parsing must not.
    assert parse_amount_to_minor("0.30") == 30
    assert parse_amount_to_minor("29.99") == 2999


def test_direction_vocabulary():
    assert direction_from_raw("支出") == "OUTFLOW"
    assert direction_from_raw("收入") == "INFLOW"
    assert direction_from_raw("不计收支") == "NEUTRAL"
    assert direction_from_raw("不计入收支") == "NEUTRAL"
    assert direction_from_raw("不可识别") == "NEUTRAL"
    assert direction_from_raw(None) == "NEUTRAL"


def test_display_helper():
    assert minor_to_display(1023) == "10.23"
    assert minor_to_display(-5) == "-0.05"


def test_time_formats():
    assert normalize_time("2026-08-01 09:30:00", "wechat") == "2026-08-01T09:30:00+08:00"
    assert normalize_time("2026/08/06 12:30", "alipay") == "2026-08-06T12:30:00+08:00"
    assert normalize_time("2026-08-05", "bank:generic_csv") == "2026-08-05T00:00:00+08:00"
    assert normalize_time("2026-08-05 09:00:00", "bank:generic_csv") == "2026-08-05T09:00:00+08:00"


def test_time_rejects_garbage():
    with pytest.raises(TimeParseError):
        normalize_time("not-a-date", "wechat")
