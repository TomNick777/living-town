"""Build public read models from committed synthetic bills, never a user database."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from tempfile import TemporaryDirectory

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from life_energy.accounts.service import add_alias, ensure_account
from life_energy.classification.engine import add_rule, classify_transactions
from life_energy.classification.seed import seed_all
from life_energy.db.connection import open_db
from life_energy.energy.interpret import refresh_energy_interpretations
from life_energy.ingestion.bank.generic_csv import GenericCSVBankParser
from life_energy.ingestion.wechat import WechatParser
from life_energy.ledger.importer import import_file
from life_energy.living_town.ledger_board import build_ledger_board
from life_energy.living_town.ledger_review import build_ledger_review
from life_energy.living_town.projection import build_town_state
from life_energy.living_town.town_period import build_town_period
from life_energy.reconciliation.refund_pairing import mark_all_unresolved, suggest_refunds
from life_energy.reconciliation.transfer_pairing import suggest_transfers

CLOCK = "2026-10-01T00:00:00+00:00"
SOURCE = ROOT / "tests" / "fixtures" / "portfolio"
OUTPUT = ROOT / "web" / "public" / "demo" / "ledger.json"
MONTHS = [f"2026-{month:02d}" for month in range(4, 10)]
DEMO_RULES = {
    "河岸咖啡": "FOOD", "青川食堂": "FOOD", "青叶便利": "SHOPPING",
    "青川公交": "TRANSPORT", "青川影剧院": "ENTERTAINMENT",
    "河岸诊所": "HEALTH", "青川书房": "EDUCATION", "青川物业": "HOUSING",
}


def build_demo() -> dict:
    """Recompute projections through the actual import/classification pipeline."""
    with TemporaryDirectory(prefix="living-town-demo-") as temporary:
        with open_db(Path(temporary) / "synthetic.db") as conn:
            seed_all(conn)
            daily = ensure_account(conn, "演示日常账户", institution="虚构账户")
            savings = ensure_account(conn, "演示储蓄账户", institution="虚构账户")
            add_alias(conn, "wechat", "演示日常账户", daily)
            add_alias(conn, "wechat", "演示储蓄账户", savings)
            conn.commit()
            for pattern, category in DEMO_RULES.items():
                add_rule(conn, priority_class="USER_EXPLICIT", name=f"合成样例：{pattern}",
                         match_field="all_text", match_mode="CONTAINS", pattern=pattern,
                         category_code=category)
            import_file(conn, GenericCSVBankParser(), SOURCE / "bank.csv", fallback_account_id=daily)
            import_file(conn, WechatParser(), SOURCE / "wechat.csv")
            classify_transactions(conn)
            suggest_transfers(conn)
            suggest_refunds(conn)
            mark_all_unresolved(conn)
            refresh_energy_interpretations(conn)
            conn.commit()
            before = conn.total_changes
            months = {}
            for month in MONTHS:
                months[month] = {
                    "state": build_town_state(conn, month, generated_at=CLOCK).to_dict(),
                    "period": build_town_period(conn, month, generated_at=CLOCK),
                    "board": build_ledger_board(conn, month, generated_at=CLOCK),
                    "review": build_ledger_review(conn, month, limit=200, generated_at=CLOCK),
                }
                review = months[month]["review"]
                if review["total_count"] != len(review["transactions"]):
                    raise ValueError("Demo month exceeds the full-snapshot review limit")
            annual = build_town_period(conn, "2026", generated_at=CLOCK)
            if conn.total_changes != before:
                raise ValueError("Read projections wrote to the synthetic ledger")
            return {"schema_version": "portfolio-demo-v1", "synthetic": True,
                    "description": "所有账户、商户和交易均为虚构；金额由 Python 账本投影生成。",
                    "months": months, "years": {"2026": annual}}


def render_demo() -> str:
    return json.dumps(build_demo(), ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Verify committed snapshot without writing")
    args = parser.parse_args()
    content = render_demo()
    if args.check:
        if not OUTPUT.exists() or OUTPUT.read_text(encoding="utf-8") != content:
            print("Demo snapshot is stale; run python scripts/build_demo.py", file=sys.stderr)
            return 1
        print("Synthetic demo snapshot is reproducible and current")
    else:
        OUTPUT.parent.mkdir(parents=True, exist_ok=True)
        OUTPUT.write_text(content, encoding="utf-8", newline="\n")
        print(f"Generated {len(MONTHS)} monthly snapshots and one year snapshot")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
