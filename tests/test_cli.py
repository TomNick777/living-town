"""CLI smoke tests: the full user journey through the argparse interface."""

from __future__ import annotations

import pytest

from life_energy.cli.main import main
from conftest import FIXTURES


@pytest.fixture()
def cli_db(tmp_path):
    return tmp_path / "cli-ledger.db"


def test_db_status_smoke(cli_db, capsys):
    assert main(["--db", str(cli_db), "db", "status"]) == 0
    out = capsys.readouterr().out
    assert "schema version: 3" in out
    assert "0001" in out or "initial" in out
    assert '"transactions": 0' in out


def test_full_cli_journey(cli_db, capsys):
    # accounts + aliases
    assert main(["--db", str(cli_db), "accounts", "add", "微信零钱", "--type", "CASH"]) == 0
    assert main(["--db", str(cli_db), "accounts", "add", "支付宝余额", "--type", "CASH"]) == 0
    assert main(["--db", str(cli_db), "accounts", "add", "招商银行(1234)", "--type", "CASH"]) == 0
    assert main(["--db", str(cli_db), "accounts", "alias", "微信零钱", "wechat", "零钱"]) == 0
    assert main(["--db", str(cli_db), "accounts", "alias", "支付宝余额", "alipay", "余额"]) == 0

    # imports (bank via --account fallback)
    assert main(["--db", str(cli_db), "import", "wechat", str(FIXTURES / "wechat_202608.csv")]) == 0
    out = capsys.readouterr().out
    assert "8 new" in out and "2 duplicate" in out

    assert main(["--db", str(cli_db), "import", "wechat", str(FIXTURES / "wechat_202608.csv")]) == 0
    assert "already imported" in capsys.readouterr().out

    assert main(
        ["--db", str(cli_db), "import", "alipay", str(FIXTURES / "alipay_202608_source.csv"), "--account", "支付宝余额"]
    ) == 0
    assert main(
        ["--db", str(cli_db), "import", "bank", str(FIXTURES / "bank_generic_202608.csv"), "--account", "招商银行(1234)"]
    ) == 0

    # inspection
    assert main(["--db", str(cli_db), "transactions", "list", "--month", "2026-08", "--type", "EXPENSE"]) == 0
    out = capsys.readouterr().out
    assert "EXPENSE" in out and "6 transaction(s)" in out

    # classification + reconciliation
    assert main(["--db", str(cli_db), "classify"]) == 0
    assert main(["--db", str(cli_db), "transfers", "candidates"]) == 0
    assert main(["--db", str(cli_db), "transfers", "suggest"]) == 0
    assert main(["--db", str(cli_db), "refunds", "resolve"]) == 0
    assert main(["--db", str(cli_db), "reconcile"]) == 0

    assert main(["--db", str(cli_db), "transfers", "list"]) == 0
    out = capsys.readouterr().out
    assert "PROBABLE" in out or "CONFIRMED" in out

    # unresolved is explicit
    assert main(["--db", str(cli_db), "transactions", "unresolved"]) == 0
    out = capsys.readouterr().out
    assert "UNKNOWN" in out and "honest gaps" in out

    # energy summary for the month
    assert main(["--db", str(cli_db), "energy", "summary", "--month", "2026-08"]) == 0
    out = capsys.readouterr().out
    assert "UNRECONCILED" in out
    assert "93.00" in out
    assert "net storage change" in out


def test_manual_override_via_cli(cli_db, capsys):
    main(["--db", str(cli_db), "accounts", "add", "微信零钱"])
    main(["--db", str(cli_db), "accounts", "alias", "微信零钱", "wechat", "零钱"])
    main(["--db", str(cli_db), "import", "wechat", str(FIXTURES / "wechat_202608.csv")])
    main(["--db", str(cli_db), "classify"])
    capsys.readouterr()

    tx_id = 1
    assert main(["--db", str(cli_db), "transactions", "override", str(tx_id), "OTHER_EXPENSE", "--note", "手改"]) == 0
    main(["--db", str(cli_db), "classify", "--recompute"])
    main(["--db", str(cli_db), "transactions", "show", str(tx_id)])
    out = capsys.readouterr().out
    assert '"category_code": "OTHER_EXPENSE"' in out
    assert '"is_manual_override": 1' in out


def test_energy_summary_requires_month(cli_db):
    with pytest.raises(SystemExit):
        main(["--db", str(cli_db), "energy", "summary"])


def test_bank_import_without_alias_still_records(cli_db, capsys):
    """Missing attribution is recorded honestly (source_account NULL), not guessed."""
    main(["--db", str(cli_db), "import", "bank", str(FIXTURES / "bank_generic_202608.csv")])
    capsys.readouterr()
    assert main(["--db", str(cli_db), "transactions", "unresolved"]) == 0
    out = capsys.readouterr().out
    assert "unattributed source account" in out
