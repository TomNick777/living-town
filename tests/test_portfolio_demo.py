"""The portfolio shows the actual pipeline's synthetic projections, not invented totals."""
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_snapshot_reproduces_pipeline_and_preserves_financial_semantics():
    spec = importlib.util.spec_from_file_location("build_demo", ROOT / "scripts" / "build_demo.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    generated = module.build_demo()
    committed = json.loads(module.OUTPUT.read_text(encoding="utf-8"))
    assert generated == committed
    for month, snapshot in generated["months"].items():
        financial = snapshot["state"]["financial"]
        assert financial == snapshot["period"]["financial"]
        assert snapshot["board"]["series"][-1]["net_life_consumption_minor"] == financial["net_life_consumption_minor"]
        review = snapshot["review"]
        assert review["total_count"] == len(review["transactions"])
        assert financial["internal_transfer_minor"] > 0
        assert financial["investment_export_minor"] > 0
        assert financial["energy_return_minor"] > 0
        assert all(isinstance(row["amount_minor"], int) for row in review["transactions"])
        assert not any("raw_payload" in row for row in review["transactions"])
        if month == "2026-09":
            assert financial["balanced"] is False
            assert review["bucket_counts"]["unresolved_refund"] > 0
            assert review["bucket_counts"]["unknown_type"] > 0
            assert review["bucket_counts"]["unpaired_transfer"] > 0
