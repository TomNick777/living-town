"""CLI surface of the Living Town projection."""

from __future__ import annotations

import json

import pytest

from life_energy.cli.main import main
from conftest import FIXTURES


@pytest.fixture()
def town_db(tmp_path):
    db = tmp_path / "town.db"
    main(["--db", str(db), "accounts", "add", "微信零钱"])
    main(["--db", str(db), "accounts", "alias", "微信零钱", "wechat", "零钱"])
    main(["--db", str(db), "import", "wechat", str(FIXTURES / "wechat_202608.csv")])
    main(["--db", str(db), "classify"])
    return db


def test_town_state_smoke(town_db, capsys):
    assert main(["--db", str(town_db), "town", "state", "--month", "2026-08"]) == 0
    out = capsys.readouterr().out
    assert "living-town-v1" in out
    assert "小镇状态" in out
    assert "未决" in out


def test_town_state_json_is_the_stable_contract(town_db, capsys):
    assert main(["--db", str(town_db), "town", "state", "--month", "2026-08", "--json"]) == 0
    out = capsys.readouterr().out
    json_part = out[out.index("{"):]
    data = json.loads(json_part)
    assert data["projection_version"] == "living-town-v1"
    assert data["period"]["month"] == "2026-08"
    for key in ("financial", "state", "scenes", "unresolved", "explanations"):
        assert key in data
    for metric in ("vitality", "stability", "consumption_pressure",
                   "saving_strength", "investment_outflow", "data_health"):
        assert metric in data["state"]
        assert {"score", "band"} <= set(data["state"][metric])
    explanation_metrics = {item["metric"] for item in data["explanations"]}
    assert explanation_metrics == set(data["state"])
    for item in data["explanations"]:
        assert item["rules_version"]
        assert item["factors"]


def test_town_scenes_and_explain(town_db, capsys):
    assert main(["--db", str(town_db), "town", "scenes", "--month", "2026-08"]) == 0
    scenes_out = capsys.readouterr().out
    assert "DINING_SOCIAL" in scenes_out  # 麦当劳 in the fixture

    assert main(["--db", str(town_db), "town", "scenes", "--month", "2026-08", "--json"]) == 0
    json_out = capsys.readouterr().out
    data = json.loads(json_out[json_out.index("{"):])
    assert "DINING_SOCIAL" in data["scenes"]
    assert data["scenes"]["DINING_SOCIAL"]["transaction_count"] >= 1

    assert main(["--db", str(town_db), "town", "explain", "--month", "2026-08"]) == 0
    explain_out = capsys.readouterr().out
    for metric in ("vitality", "stability", "consumption_pressure",
                   "saving_strength", "investment_outflow", "data_health"):
        assert metric in explain_out
    assert "town-rules-v1" in explain_out


def test_town_state_requires_month(town_db):
    with pytest.raises(SystemExit):
        main(["--db", str(town_db), "town", "state"])
