"""World-service port authority: env > config file > compiled default."""

from __future__ import annotations

import json
from pathlib import Path

from life_energy.living_town.world.api import DEFAULT_PORT as API_DEFAULT_PORT
from life_energy.living_town.world.runtime_port import (
    DEFAULT_PORT,
    WORLD_PORT_ENV,
    load_runtime_config,
    resolve_world_port,
)

REPO_CONFIG = Path(__file__).resolve().parents[3] / "config" / "local-runtime.json"


def test_default_port_is_the_published_loopback_port():
    assert DEFAULT_PORT == 8642
    assert resolve_world_port(env={}) == 8642


def test_env_overrides_config_file(tmp_path, monkeypatch):
    config = tmp_path / "local-runtime.json"
    config.write_text(json.dumps({"worldServiceHost": "127.0.0.1", "worldServicePort": 9001}), encoding="utf-8")
    assert resolve_world_port(env={WORLD_PORT_ENV: "8765"}, config_path=config) == 8765


def test_config_file_used_when_env_unset(tmp_path):
    config = tmp_path / "local-runtime.json"
    config.write_text(json.dumps({"worldServiceHost": "127.0.0.1", "worldServicePort": 9001}), encoding="utf-8")
    assert resolve_world_port(env={}, config_path=config) == 9001


def test_invalid_env_falls_back_instead_of_inventing_a_port(tmp_path):
    config = tmp_path / "local-runtime.json"
    config.write_text(json.dumps({"worldServicePort": 9001}), encoding="utf-8")
    assert resolve_world_port(env={WORLD_PORT_ENV: "nope"}, config_path=config) == 9001
    assert resolve_world_port(env={WORLD_PORT_ENV: "0"}) == DEFAULT_PORT
    assert resolve_world_port(env={WORLD_PORT_ENV: "-3"}) == DEFAULT_PORT


def test_api_reexports_the_same_default():
    assert API_DEFAULT_PORT == DEFAULT_PORT
    payload = json.loads(REPO_CONFIG.read_text(encoding="utf-8"))
    assert payload["worldServiceHost"] == "127.0.0.1"
    assert payload["worldServicePort"] == DEFAULT_PORT
    loaded = load_runtime_config(REPO_CONFIG)
    assert loaded.port == DEFAULT_PORT
    assert loaded.host == "127.0.0.1"
