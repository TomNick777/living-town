"""Test configuration: path bootstrap + a fully imported synthetic ledger.

All fixtures are synthetic. No real personal bills are ever used.
"""

from __future__ import annotations

import shutil
import sys
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT / "src"))

from life_energy.accounts.service import add_alias, ensure_account  # noqa: E402
from life_energy.classification.seed import seed_all  # noqa: E402
from life_energy.db.connection import open_db  # noqa: E402
from life_energy.ingestion.alipay import AlipayParser  # noqa: E402
from life_energy.ingestion.bank.generic_csv import GenericCSVBankParser  # noqa: E402
from life_energy.ingestion.wechat import WechatParser  # noqa: E402
from life_energy.ledger.importer import import_file  # noqa: E402
from life_energy.reconciliation.refund_pairing import mark_all_unresolved, suggest_refunds  # noqa: E402
from life_energy.reconciliation.transfer_pairing import suggest_transfers  # noqa: E402

FIXTURES = Path(__file__).parent / "fixtures"

WECHAT_HEADER = "交易时间,交易类型,交易对方,商品,收/支,金额(元),支付方式,当前状态,交易单号,商户单号,备注"
ALIPAY_HEADER = (
    "交易时间,交易分类,交易对方,对方账号,商品说明,收/支,金额,收/付款方式,交易状态,交易订单号,商家订单号,备注"
)


def make_wechat_csv(path: Path, rows: list[str]) -> Path:
    lines = [
        "微信支付账单明细,,,,,,,,,,,",
        "微信昵称：[测试用户],,,,,,,,,,,",
        "起始时间：[2026-08-01 00:00:00] 终止时间：[2026-08-31 23:59:59],,,,,,,,,,,",
        "------ 以下是账单明细 ------,,,,,,,,,,,",
        WECHAT_HEADER,
        *rows,
    ]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return path


def make_alipay_gbk(path: Path, rows: list[str]) -> Path:
    lines = [
        "近期交易记录明细",
        "起始日期:[2026-08-01],终止日期:[2026-08-31]",
        ALIPAY_HEADER,
        *rows,
    ]
    path.write_bytes(("\n".join(lines) + "\n").encode("gbk"))
    return path


def make_bank_csv(path: Path, rows: list[str]) -> Path:
    lines = ["date,description,amount,balance", *rows]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return path


@pytest.fixture()
def tmp_ledger(tmp_path):
    """A migrated, seeded, empty ledger database."""
    with open_db(tmp_path / "ledger.db") as conn:
        seed_all(conn)
        yield conn


@pytest.fixture()
def alipay_gbk_file(tmp_path) -> Path:
    """The committed UTF-8 alipay fixture re-encoded as GBK (the real export encoding)."""
    target = tmp_path / "alipay_202608.csv"
    content = (FIXTURES / "alipay_202608_source.csv").read_text(encoding="utf-8")
    target.write_bytes(content.encode("gbk"))
    return target


@pytest.fixture()
def ledger_raw(tmp_path, alipay_gbk_file):
    """Three channels imported and classified, but NOT reconciled.

    Use this when testing pairing/refund logic itself.
    """
    db_path = tmp_path / "ledger.db"
    with open_db(db_path) as conn:
        seed_all(conn)
        ensure_account(conn, "招商银行(1234)", "CASH", institution="招商银行", masked_number="1234")
        wechat_cash = ensure_account(conn, "微信零钱", "CASH", institution="微信")
        alipay_cash = ensure_account(conn, "支付宝余额", "CASH", institution="支付宝")
        add_alias(conn, "wechat", "零钱", wechat_cash)
        add_alias(conn, "alipay", "余额", alipay_cash)
        conn.commit()

        import_file(conn, WechatParser(), FIXTURES / "wechat_202608.csv")
        import_file(conn, AlipayParser(), alipay_gbk_file, fallback_account_id=alipay_cash)
        import_file(
            conn,
            GenericCSVBankParser(),
            FIXTURES / "bank_generic_202608.csv",
            fallback_account_id=ensure_account(conn, "招商银行(1234)"),
        )

        from life_energy.classification.engine import classify_transactions

        classify_transactions(conn)
        yield conn


@pytest.fixture()
def ledger(ledger_raw):
    """The reconciled synthetic month: transfer pairs, refund links, unresolved marks."""
    suggest_transfers(ledger_raw)
    suggest_refunds(ledger_raw)
    mark_all_unresolved(ledger_raw)
    return ledger_raw
