"""Scene activity aggregation: counts, amounts, active days, honest trends."""

from __future__ import annotations

import pytest

from conftest import make_bank_csv, make_wechat_csv

from life_energy.accounts.service import add_alias, ensure_account
from life_energy.classification.engine import classify_transactions
from life_energy.ingestion.bank.generic_csv import GenericCSVBankParser
from life_energy.ingestion.wechat import WechatParser
from life_energy.ledger.importer import import_file
from life_energy.living_town import build_town_state

FIXED_CLOCK = "2026-09-09T00:00:00+00:00"


def _wx(day: str, type_raw: str, counterparty: str, goods: str, direction: str,
        yuan: str, ref: str) -> str:
    """Full-date row so July and August share one helper."""
    return (f"{day} 12:00:00,{type_raw},{counterparty},{goods},{direction},"
            f"¥{yuan},零钱,支付成功,{ref},")


def _seed_august(conn, tmp_path):
    bank = ensure_account(conn, "招商银行(1234)")
    wechat = ensure_account(conn, "微信零钱")
    add_alias(conn, "wechat", "零钱", wechat)
    import_file(
        conn, GenericCSVBankParser(),
        make_bank_csv(tmp_path / "salary.csv", ["2026-08-01 09:00:00,代发工资 工资,10000.00,10000.00"]),
        fallback_account_id=bank,
    )
    rows = [
        _wx("2026-08-02", "商户消费", "麦当劳", "巨无霸套餐", "支出", "30.00", "SA1"),
        _wx("2026-08-02", "商户消费", "滴滴出行", "快车", "支出", "20.00", "SA2"),
        _wx("2026-08-05", "商户消费", "滴滴出行", "快车", "支出", "20.00", "SA3"),
    ]
    import_file(conn, WechatParser(), make_wechat_csv(tmp_path / "aug.csv", rows))
    classify_transactions(conn)


def _scenes(conn):
    return {scene.scene: scene for scene in build_town_state(conn, "2026-08", generated_at=FIXED_CLOCK).scenes}


def test_scene_activity_aggregates_counts_amounts_and_days(tmp_ledger, tmp_path):
    _seed_august(tmp_ledger, tmp_path)
    scenes = _scenes(tmp_ledger)

    dining = scenes["DINING_SOCIAL"]      # 麦当劳 -> FOOD -> DINING_SOCIAL
    commute = scenes["COMMUTE"]           # 滴滴 -> TRANSPORT -> COMMUTE
    assert (dining.transaction_count, dining.amount_minor, dining.active_days) == (1, 3_000, 1)
    assert (commute.transaction_count, commute.amount_minor, commute.active_days) == (2, 4_000, 2)

    # shares are of gross consumption (7000 fen this month)
    assert dining.share_of_consumption == pytest.approx(3_000 / 7_000)
    assert commute.share_of_consumption == pytest.approx(4_000 / 7_000)

    # no July data: the trend is honestly UNKNOWN, no invented growth rate
    assert dining.trend_vs_previous_period == "UNKNOWN"
    assert dining.previous_amount_minor is None


def test_scene_trend_against_existing_previous_month(tmp_ledger, tmp_path):
    _seed_august(tmp_ledger, tmp_path)
    wechat = ensure_account(tmp_ledger, "微信零钱")
    july = [
        _wx("2026-07-02", "商户消费", "麦当劳", "巨无霸套餐", "支出", "60.00", "JB1"),
        _wx("2026-07-03", "商户消费", "京东商城", "纸巾", "支出", "40.00", "JB2"),
    ]
    import_file(tmp_ledger, WechatParser(), make_wechat_csv(tmp_path / "jul.csv", july))
    classify_transactions(tmp_ledger)
    assert wechat is not None

    scenes = _scenes(tmp_ledger)
    dining = scenes["DINING_SOCIAL"]
    commute = scenes["COMMUTE"]

    assert dining.previous_amount_minor == 6_000
    assert dining.trend_vs_previous_period == "DOWN"    # 3000 vs 6000
    assert commute.previous_amount_minor == 0
    assert commute.trend_vs_previous_period == "UP"     # active now, silent in July
    assert "DAILY_CONVENIENCE" not in scenes            # July-only scene stays out of August


def test_scene_mapping_covers_seed_taxonomy(tmp_ledger, tmp_path):
    """A wider slice of categories lands in their documented scenes."""
    bank = ensure_account(tmp_ledger, "招商银行(1234)")
    rows = [
        _wx("2026-08-01", "商户消费", "自如", "八月房租", "支出", "2000.00", "SB1"),       # HOUSING -> HOME
        _wx("2026-08-02", "商户消费", "中国移动", "话费充值", "支出", "50.00", "SB2"),     # TELECOM -> HOME
        _wx("2026-08-03", "商户消费", "京东商城", "纸巾洗衣液", "支出", "200.00", "SB3"),  # SHOPPING -> DAILY_CONVENIENCE
        _wx("2026-08-04", "商户消费", "电影院", "电影票", "支出", "90.00", "SB4"),         # 关键词 电影 -> ENTERTAINMENT -> LEISURE
    ]
    import_file(tmp_ledger, WechatParser(), make_wechat_csv(tmp_path / "wide.csv", rows))
    import_file(
        tmp_ledger, GenericCSVBankParser(),
        make_bank_csv(tmp_path / "salary2.csv", ["2026-08-01 09:00:00,代发工资 工资,10000.00,10000.00"]),
        fallback_account_id=bank,
    )
    classify_transactions(tmp_ledger)

    scenes = _scenes(tmp_ledger)
    assert {scene.scene for scene in scenes.values()} == {"HOME", "DAILY_CONVENIENCE", "LEISURE"}
    home = scenes["HOME"]
    assert home.amount_minor == 205_000  # rent 200000 + telecom 5000, two categories one scene
    assert home.transaction_count == 2
