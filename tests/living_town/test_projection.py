"""Town projection invariants over synthetic mini-ledgers.

Core promises under test:
- deterministic (same db + period + clock => identical output);
- read-only (canonical ledger + raw evidence untouched);
- transfer neutrality / investment separation / refund-not-income;
- unresolved states stay visible and drag data_health;
- spending more must never raise vitality (and must worsen pressure).
"""

from __future__ import annotations

import hashlib

from conftest import make_bank_csv, make_wechat_csv

from life_energy.accounts.service import add_alias, ensure_account
from life_energy.classification.engine import classify_transactions
from life_energy.classification.seed import seed_all
from life_energy.db.connection import open_db
from life_energy.ingestion.bank.generic_csv import GenericCSVBankParser
from life_energy.ingestion.wechat import WechatParser
from life_energy.ledger.importer import import_file
from life_energy.living_town import build_town_state
from life_energy.reconciliation.refund_pairing import mark_all_unresolved, suggest_refunds
from life_energy.reconciliation.transfer_pairing import suggest_transfers

FIXED_CLOCK = "2026-09-09T00:00:00+00:00"


def _wechat_row(day: str, type_raw: str, counterparty: str, goods: str,
                direction: str, yuan: str, ref: str, time_of_day: str = "12:00:00") -> str:
    return f"2026-08-{day} {time_of_day},{type_raw},{counterparty},{goods},{direction},¥{yuan},零钱,支付成功,{ref},"


def _seed_month(conn, tmp_path, *, multiplier: int = 1):
    """A synthetic but ordinary August: salary + rent + food + commute +
    shopping + telecom. `multiplier` scales every CONSUMPTION amount while
    income stays fixed, so the spend-more invariant compares two identical
    lifestyles that differ only in price."""
    bank = ensure_account(conn, "招商银行(1234)")
    wechat = ensure_account(conn, "微信零钱")
    add_alias(conn, "wechat", "零钱", wechat)

    import_file(
        conn, GenericCSVBankParser(),
        make_bank_csv(tmp_path / f"salary{multiplier}.csv",
                      ["2026-08-01 09:00:00,代发工资 工资,10000.00,10000.00"]),
        fallback_account_id=bank,
    )
    m = multiplier
    rows = [
        _wechat_row("01", "商户消费", "自如", "八月房租", "支出", f"{2000 * m}.00", f"WXR{m}"),
        _wechat_row("02", "商户消费", "麦当劳", "巨无霸套餐", "支出", f"{30 * m}.00", f"WMA{m}"),
        _wechat_row("03", "商户消费", "麦当劳", "巨无霸套餐", "支出", f"{30 * m}.00", f"WMB{m}"),
        _wechat_row("04", "商户消费", "麦当劳", "巨无霸套餐", "支出", f"{30 * m}.00", f"WMC{m}"),
        _wechat_row("05", "商户消费", "麦当劳", "巨无霸套餐", "支出", f"{30 * m}.00", f"WMD{m}"),
        _wechat_row("06", "商户消费", "麦当劳", "巨无霸套餐", "支出", f"{30 * m}.00", f"WME{m}"),
        _wechat_row("03", "商户消费", "滴滴出行", "快车", "支出", f"{20 * m}.00", f"WDA{m}"),
        _wechat_row("07", "商户消费", "滴滴出行", "快车", "支出", f"{20 * m}.00", f"WDB{m}"),
        _wechat_row("08", "商户消费", "京东商城", "纸巾洗衣液", "支出", f"{200 * m}.00", f"WJ{m}"),
        _wechat_row("10", "商户消费", "中国移动", "话费充值", "支出", f"{50 * m}.00", f"WY{m}"),
    ]
    import_file(conn, WechatParser(), make_wechat_csv(tmp_path / f"wx{multiplier}.csv", rows))
    classify_transactions(conn)
    suggest_transfers(conn)
    return bank, wechat


def _state(conn, month="2026-08"):
    return build_town_state(conn, month, generated_at=FIXED_CLOCK)


def _state_json(conn, month="2026-08"):
    return _state(conn, month).to_dict()


# ------------------------------------------------------------------ determinism


def test_projection_is_deterministic(tmp_ledger, tmp_path):
    _seed_month(tmp_ledger, tmp_path)
    a = _state_json(tmp_ledger)
    b = _state_json(tmp_ledger)
    assert a == b

    later = build_town_state(tmp_ledger, "2026-08", generated_at="2026-09-10T00:00:00+00:00").to_dict()
    a.pop("generated_at"), later.pop("generated_at")
    assert a == later  # only the clock may differ


def test_empty_period_is_dormant_but_honest(tmp_ledger):
    state = _state(tmp_ledger)  # no imports at all
    data = state.to_dict()
    assert data["state"]["vitality"] == {"score": 0.0, "band": "DORMANT"}
    assert data["financial"]["external_income_minor"] == 0
    assert data["financial"]["balanced"] is True
    assert data["scenes"] == {}
    assert data["unresolved"]["unreconciled_minor"] == 0


# -------------------------------------------------------------- read-only


def _ledger_snapshot(conn) -> tuple:
    def rows_as_tuples(sql: str) -> list:
        return [tuple(row) for row in conn.execute(sql).fetchall()]  # Row repr is address-based

    tx_digest = hashlib.sha256(
        repr(rows_as_tuples(
            "SELECT transaction_id, occurred_at, amount_minor, direction, transaction_type,"
            " source, source_reference, canonical_fingerprint FROM transactions"
            " ORDER BY transaction_id"
        )).encode()
    ).hexdigest()
    raw_digest = hashlib.sha256(
        repr(rows_as_tuples(
            "SELECT raw_record_id, raw_payload, status FROM raw_records ORDER BY raw_record_id"
        )).encode()
    ).hexdigest()
    interp_count = conn.execute("SELECT COUNT(*) FROM transaction_interpretation").fetchone()[0]
    return (conn.execute("SELECT COUNT(*) FROM transactions").fetchone()[0],
            conn.execute("SELECT COUNT(*) FROM raw_records").fetchone()[0],
            conn.execute("SELECT COUNT(*) FROM import_batches").fetchone()[0],
            interp_count, tx_digest, raw_digest)


def test_projection_never_mutates_canonical_or_raw(tmp_ledger, tmp_path):
    _seed_month(tmp_ledger, tmp_path)
    before = _ledger_snapshot(tmp_ledger)
    changes_before = tmp_ledger.total_changes

    for _ in range(3):
        build_town_state(tmp_ledger, "2026-08")

    assert tmp_ledger.total_changes == changes_before  # zero INSERT/UPDATE/DELETE
    assert _ledger_snapshot(tmp_ledger) == before


# --------------------------------------------------------- transfer neutrality


def test_internal_transfer_is_neutral_to_life_state(tmp_ledger, tmp_path):
    _seed_month(tmp_ledger, tmp_path)
    base = _state(tmp_ledger)

    bank = ensure_account(tmp_ledger, "招商银行(1234)")
    import_file(
        tmp_ledger, GenericCSVBankParser(),
        make_bank_csv(tmp_path / "out.csv", ["2026-08-21 11:00:00,转账 微信,-300.00,9700.00"]),
        fallback_account_id=bank,
    )
    import_file(
        tmp_ledger, WechatParser(),
        make_wechat_csv(tmp_path / "in.csv",
                        [_wechat_row("21", "转账-转入", "招商银行", "零钱转入", "收入", "300.00", "WXT1",
                                     time_of_day="11:05:00")]),  # instant channels pair within 30 min
    )
    suggest_transfers(tmp_ledger)
    after = _state(tmp_ledger)

    assert after.state["vitality"].score == base.state["vitality"].score
    assert after.state["saving_strength"].score == base.state["saving_strength"].score
    assert after.state["investment_outflow"].score == base.state["investment_outflow"].score
    assert after.financial.life_consumption_minor == base.financial.life_consumption_minor
    assert after.financial.external_income_minor == base.financial.external_income_minor
    # the only thing that moved is the descriptive internal-movement volume
    assert (after.financial.internal_transfer_minor
            > base.financial.internal_transfer_minor == 0)
    assert after.unresolved.transfer_legs == 0  # paired, no new gaps


# ---------------------------------------------------------- investment export


def test_investment_export_raises_outflow_never_consumption(tmp_ledger, tmp_path):
    _seed_month(tmp_ledger, tmp_path)
    base = _state(tmp_ledger)
    assert base.state["investment_outflow"].band == "NONE"

    bank = ensure_account(tmp_ledger, "招商银行(1234)")
    import_file(
        tmp_ledger, GenericCSVBankParser(),
        make_bank_csv(tmp_path / "fund.csv", ["2026-08-12 10:00:00,基金申购 华夏基金,-3000.00,7000.00"]),
        fallback_account_id=bank,
    )
    after = _state(tmp_ledger)

    assert after.state["investment_outflow"].score > base.state["investment_outflow"].score
    assert after.financial.life_consumption_minor == base.financial.life_consumption_minor
    assert (after.financial.investment_export_minor
            == base.financial.investment_export_minor + 300_000)
    investment_scene = next(s for s in after.scenes if s.scene == "INVESTMENT")
    assert investment_scene.amount_minor == 300_000
    assert investment_scene.share_of_consumption is None  # not a consumption scene


# ------------------------------------------------------------------- refunds


def test_refund_is_return_not_income_and_eases_net_pressure(tmp_ledger, tmp_path):
    _seed_month(tmp_ledger, tmp_path)
    base = _state(tmp_ledger)

    import_file(
        tmp_ledger, WechatParser(),
        make_wechat_csv(tmp_path / "refund.csv", [
            _wechat_row("15", "商户消费", "麦当劳", "巨无霸套餐", "支出", "100.00", "WXK1"),
            _wechat_row("16", "商户消费-退款", "麦当劳", "巨无霸退款", "收入", "100.00", "WXK2"),
        ]),
    )
    suggest_refunds(tmp_ledger)
    mark_all_unresolved(tmp_ledger)
    after = _state(tmp_ledger)

    # The refund came back as RETURN, never as external income.
    assert (after.financial.external_income_minor
            == base.financial.external_income_minor == 1_000_000)
    assert after.financial.energy_return_minor == 10_000
    # gross consumption grew by the ¥100 purchase; net is unchanged by the refund
    assert (after.financial.life_consumption_minor
            == base.financial.life_consumption_minor + 10_000)
    assert (after.financial.net_life_consumption_minor
            == base.financial.net_life_consumption_minor)
    assert after.state["consumption_pressure"].score == base.state["consumption_pressure"].score
    assert after.unresolved.refunds == 0  # linked


# ------------------------------------------------------------- unresolved


def test_unresolved_states_stay_visible_and_drag_data_health(tmp_ledger, tmp_path):
    _seed_month(tmp_ledger, tmp_path)
    base = _state(tmp_ledger)
    assert base.state["data_health"].band == "HEALTHY"

    wechat = ensure_account(tmp_ledger, "微信零钱")
    bank = ensure_account(tmp_ledger, "招商银行(1234)")
    assert wechat and bank  # both accounts exist; attribution is irrelevant here
    import_file(
        tmp_ledger, WechatParser(),
        make_wechat_csv(tmp_path / "gaps.csv", [
            _wechat_row("22", "转账-转出", "消失的对手方", "转出", "支出", "88.00", "WXL1"),
            _wechat_row("23", "商户消费-退款", "无名商家", "无主退款", "收入", "10.00", "WXL2"),
        ]),
    )
    import_file(
        tmp_ledger, GenericCSVBankParser(),
        make_bank_csv(tmp_path / "unknown.csv", ["2026-08-24 10:00:00,神秘杂项,-66.00,100.00"]),
        fallback_account_id=bank,
    )
    suggest_refunds(tmp_ledger)
    mark_all_unresolved(tmp_ledger)
    after = _state(tmp_ledger)

    assert after.unresolved.transfer_legs >= 1
    assert after.unresolved.refunds >= 1
    assert after.unresolved.unknown_transactions >= 1
    assert after.financial.unreconciled_minor > base.financial.unreconciled_minor
    assert after.state["data_health"].score < base.state["data_health"].score
    assert after.state["data_health"].band in ("REVIEW", "NEEDS_WORK")


# ------------------------------------------------- no spend-more-is-better


def test_spending_more_never_raises_vitality(tmp_path, tmp_ledger):
    """Two identical lifestyles, the second pays 5x for everything.
    Vitality must be identical; stability must drop; pressure must rise.
    「花得越多小镇越繁荣」是被禁止的产品语义。"""
    _seed_month(tmp_ledger, tmp_path, multiplier=1)
    frugal = _state(tmp_ledger)

    with open_db(tmp_path / "five_x.db") as rich_conn:
        seed_all(rich_conn)
        _seed_month(rich_conn, tmp_path, multiplier=5)
        lavish = _state(rich_conn)

    assert lavish.state["vitality"].score == frugal.state["vitality"].score
    assert lavish.state["vitality"].band == frugal.state["vitality"].band
    assert lavish.state["stability"].score < frugal.state["stability"].score
    assert lavish.state["consumption_pressure"].score > frugal.state["consumption_pressure"].score
    assert frugal.state["consumption_pressure"].band == "LOW"
    assert lavish.state["consumption_pressure"].band == "EXTREME"
