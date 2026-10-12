"""Time normalization: channel-native strings -> ISO8601 with +08:00 offset.

All bill channels are China-domestic; Life Energy stores timestamps with an
explicit +08:00 offset so period boundaries are unambiguous.
"""

from __future__ import annotations

from datetime import datetime

TIMEZONE_SUFFIX = "+08:00"

# Channel-native formats (from all-wallet-manager + 2026-08 real exports).
# Bank entries per adapter: 建行 ships compact YYYYMMDD; 广发信用卡 uses
# slashed dates; 招行/建行 have date-only precision.
FORMATS = {
    "wechat": ("%Y-%m-%d %H:%M:%S",),
    # Real 2026 Alipay exports use dashed timestamps with seconds; older
    # exports used slashed minute precision. Keep both.
    "alipay": ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y/%m/%d %H:%M:%S", "%Y/%m/%d %H:%M"),
    "bank:generic_csv": ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d"),
    "bank:bocom": ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d"),
    "bank:cib": ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d", "%Y%m%d"),
    "bank:icbc": ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d"),
    "bank:cmb": ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d"),
    "bank:ccb": ("%Y%m%d", "%Y-%m-%d"),
    "bank:gf_credit": ("%Y/%m/%d", "%Y-%m-%d"),
    "bank:gf_debit": ("%Y-%m-%d %H:%M:%S",),
}


class TimeParseError(ValueError):
    pass


def normalize_time(raw_time, source: str) -> str:
    if raw_time is None:
        raise TimeParseError("time is empty")
    if isinstance(raw_time, datetime):
        dt = raw_time
    else:
        formats = FORMATS.get(source, ("%Y-%m-%d",))
        text = str(raw_time).strip()
        dt = None
        for fmt in formats:
            try:
                dt = datetime.strptime(text, fmt)
                break
            except (ValueError, TypeError):
                continue
        if dt is None:
            try:
                dt = datetime.fromisoformat(text)
            except (ValueError, TypeError) as exc:
                raise TimeParseError(f"unparseable time {raw_time!r} for {source}") from exc
    return dt.strftime("%Y-%m-%dT%H:%M:%S") + TIMEZONE_SUFFIX
