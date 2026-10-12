"""Grouped classification review: groups, one-decision rules, review loop."""

from __future__ import annotations

from contextlib import contextmanager

from life_energy.classification import review
from life_energy.db.connection import open_db
from life_energy.classification.seed import seed_all
from life_energy.ingestion.models import ParseResult, RawTransaction
from life_energy.ledger.importer import import_file

from tests.conftest import make_wechat_csv


class StubParser:
    source = ""
    parser_name = "stub"
    parser_version = "stub/1"

    def __init__(self, source: str, rows: list[dict]):
        self.source = source
        self._rows = rows

    def parse(self, file_path) -> ParseResult:
        result = ParseResult(source=self.source, parser_name=self.parser_name, parser_version=self.parser_version)
        for index, fields in enumerate(self._rows):
            result.records.append(RawTransaction(source=self.source, row_index=index, raw_fields=fields))
        return result

    def get_channel(self) -> str:
        return self.source


@contextmanager
def _seeded_ledger(tmp_path):
    """Two wallet expenses + one card-statement expense of the same merchant,
    one amount-only card row, one income row — all unclassified."""
    with open_db(tmp_path / "ledger.db") as connection:
        seed_all(connection)
        # two distinct stub files: same bytes would sha256-short-circuit the
        # second import (idempotency applies to file identity, not parser)
        wallet_bill = tmp_path / "wechat.csv"
        wallet_bill.write_bytes(b"stub")
        statement = tmp_path / "statement.pdf"
        statement.write_bytes(b"%PDF-1.4 stub")
        import_file(connection, StubParser("wechat", [
            {"交易时间": "2026-08-01 12:00:00", "交易类型": "商户消费", "交易对方": "美团",
             "商品": "订单付款", "收/支": "支出", "金额(元)": "15.80", "支付方式": "零钱",
             "当前状态": "支付成功", "交易单号": "w1", "商户单号": "m1", "备注": "/"},
            {"交易时间": "2026-08-02 12:00:00", "交易类型": "商户消费", "交易对方": "美团",
             "商品": "先用后付", "收/支": "支出", "金额(元)": "39.90", "支付方式": "零钱",
             "当前状态": "支付成功", "交易单号": "w2", "商户单号": "m2", "备注": "/"},
            {"交易时间": "2026-08-03 09:00:00", "交易类型": "商户消费", "交易对方": "美团外卖",
             "商品": "订单付款", "收/支": "支出", "金额(元)": "25.00", "支付方式": "零钱",
             "当前状态": "支付成功", "交易单号": "w3", "商户单号": "m3", "备注": "/"},
        ]), wallet_bill)
        import_file(connection, StubParser("bank:gf_credit", [
            {"交易日期": "2026/08/04", "入账日期": "2026/08/05", "交易摘要": "(消费)（特约）美团",
             "交易金额": "108.80", "交易货币": "人民币", "入账金额": "108.80", "入账货币": "人民币",
             "_row_reference": "gf:r1"},
            {"交易日期": "2026/08/06", "入账日期": "2026/08/06", "交易摘要": "",
             "交易金额": "12.00", "交易货币": "人民币", "入账金额": "12.00", "入账货币": "人民币",
             "_row_reference": "gf:r2"},
            {"交易日期": "2026/08/07", "入账日期": "2026/08/07", "交易摘要": "(赠送)广发返利金",
             "交易金额": "-20.00", "交易货币": "人民币", "入账金额": "-20.00", "入账货币": "人民币",
             "_row_reference": "gf:r3"},
        ]), statement)
        yield connection


def test_groups_merge_channels_and_rank_by_amount(tmp_path):
    with _seeded_ledger(tmp_path) as conn:
        groups = review.unclassified_groups(conn)
        # 美团 wallet rows and the (消费)（特约）美团 card row are distinct texts
        texts = {g["text"]: g for g in groups}
        assert "美团" in texts and texts["美团"]["n"] == 2
        assert texts["美团"]["channels"] == "wechat"
        assert "(消费)（特约）美团" in texts and texts["(消费)（特约）美团"]["n"] == 1
        assert "(赠送)广发返利金" in texts and texts["(赠送)广发返利金"]["ttype"] == "INCOME"
        # ordering: largest total first
        assert groups[0]["total_minor"] == 10880  # (消费)（特约）美团 card row


def test_one_rule_covers_variant_groups_across_channels(tmp_path):
    with _seeded_ledger(tmp_path) as conn:
        rule_id = review.create_group_rule(
            conn, group_text="美团", tx_type="EXPENSE", category_code="FOOD",
        )
        remaining = review.apply_rules(conn)
        rows = conn.execute(
            """
            SELECT i.category_code, i.classification_rule_id, t.source, t.amount_minor
            FROM transaction_interpretation i JOIN transactions t ON t.transaction_id = i.transaction_id
            WHERE t.transaction_type = 'EXPENSE' AND i.category_code IS NOT NULL
            """
        ).fetchall()
        by_amount = {r["amount_minor"]: (r["category_code"], r["classification_rule_id"], r["source"]) for r in rows}
        # 美团 (15.80), 美团外卖 (25.00, longer variant), card (消费)（特约）美团 (108.80)
        assert by_amount[1580][0] == "FOOD" and by_amount[1580][2] == "wechat"
        assert by_amount[2500][0] == "FOOD"  # 美团外卖 absorbed by CONTAINS
        assert by_amount[10880][0] == "FOOD" and by_amount[10880][2] == "bank:gf_credit"
        for amount in (1580, 2500, 10880):
            assert by_amount[amount][1] == rule_id
        # only the amount-only row and the income row remain
        assert remaining == 2


def test_category_kind_must_match_group_type(tmp_path):
    with _seeded_ledger(tmp_path) as conn:
        try:
            review.create_group_rule(conn, group_text="美团", tx_type="EXPENSE", category_code="SALARY")
            raise AssertionError("expected ValueError")
        except ValueError as exc:
            assert "INCOME category" in str(exc)
        try:
            review.create_group_rule(conn, group_text="   ", tx_type="EXPENSE", category_code="FOOD")
            raise AssertionError("expected ValueError")
        except ValueError as exc:
            assert "no text" in str(exc)


def test_review_loop_decides_skips_and_quits(tmp_path):
    with _seeded_ledger(tmp_path) as conn:
        # flow: decide the card group (FOOD, exact-text pattern) -> skip the
        # 美团 group once -> mis-typed category is rejected -> decide it with
        # a broad category -> skip 美团外卖 -> skip income -> the amount-only
        # group shows its no-text warning -> quit.
        answers = iter([
            "FOOD",
            "s",
            "SALARY",
            "OTHER_EXPENSE",
            "",
            "",
            "q",
        ])
        echo_lines: list[str] = []
        stats = review.review_unclassified(
            conn,
            input_func=lambda prompt: next(answers),
            echo=echo_lines.append,
        )
        assert stats["rules_created"] == 2
        assert stats["quit"] is True
        joined = "\n".join(echo_lines)
        assert "✗" in joined  # SALARY is an INCOME category: rejected
        assert "没有任何文本可匹配" in joined  # amount-only group honestly flagged
        summary = review.unclassified_summary(conn)
        assert summary["rows"] == 3  # 美团外卖 + income + amount-only remain
