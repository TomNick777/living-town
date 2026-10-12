"""The presentation demo must tell a coherent financial story, even with synthetic data."""

import json
from pathlib import Path

import pytest


@pytest.mark.parametrize("name", ["stable", "busy-tight", "capital-export"])
def test_showcase_cash_flow_and_scene_totals(name: str) -> None:
    data = json.loads(
        (Path(__file__).parent / "fixtures" / "town-showcase" / f"{name}.json").read_text(encoding="utf-8")
    )
    financial = data["financial"]
    assert all(isinstance(value, int) for key, value in financial.items() if key.endswith("_minor"))
    assert financial["net_life_consumption_minor"] == (
        financial["life_consumption_minor"] - financial["energy_return_minor"]
    )
    # Internal transfers are neutral; redemption is not external income.
    assert financial["net_storage_change_minor"] == (
        financial["external_income_minor"]
        - financial["net_life_consumption_minor"]
        - financial["investment_export_minor"]
        + financial["investment_import_minor"]
        - financial["transfer_fee_minor"]
    )
    assert sum(
        scene["amount_minor"] for key, scene in data["scenes"].items() if key != "INVESTMENT"
    ) == financial["life_consumption_minor"]
    saving = next(item for item in data["explanations"] if item["metric"] == "saving_strength")
    assert saving["band"] == data["state"]["saving_strength"]["band"]
    assert next(item["value"] for item in saving["factors"] if item["name"] == "net_storage_change_minor") == financial["net_storage_change_minor"]


def test_busy_showcase_preserves_unresolved_refund() -> None:
    data = json.loads(
        (Path(__file__).parent / "fixtures" / "town-showcase" / "busy-tight.json").read_text(encoding="utf-8")
    )
    assert data["unresolved"]["refunds"] == 1
