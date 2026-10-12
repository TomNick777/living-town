"""Single authority for the loopback world-service port.

Resolution order (mirrors LIFE_ENERGY_DB):

1. ``LIFE_ENERGY_WORLD_PORT`` environment variable
2. ``config/local-runtime.json`` (repo file, if present)
3. compiled default ``8642``

Harbor continues to target 8642 unless that process is given the env var.
This module does not invent a second magic port.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path

DEFAULT_PORT = 8642
DEFAULT_HOST = "127.0.0.1"
WORLD_PORT_ENV = "LIFE_ENERGY_WORLD_PORT"
CONFIG_RELATIVE = Path("config") / "local-runtime.json"


@dataclass(frozen=True)
class RuntimeBind:
    host: str
    port: int


def _repo_config_path() -> Path:
    # src/life_energy/living_town/world/runtime_port.py → repo root
    return Path(__file__).resolve().parents[4] / CONFIG_RELATIVE


def load_runtime_config(path: Path | None = None) -> RuntimeBind:
    candidate = path if path is not None else _repo_config_path()
    if not candidate.is_file():
        return RuntimeBind(host=DEFAULT_HOST, port=DEFAULT_PORT)
    raw = json.loads(candidate.read_text(encoding="utf-8"))
    host = str(raw.get("worldServiceHost") or DEFAULT_HOST)
    try:
        port = int(raw.get("worldServicePort", DEFAULT_PORT))
    except (TypeError, ValueError):
        port = DEFAULT_PORT
    if port <= 0 or port >= 65536:
        port = DEFAULT_PORT
    return RuntimeBind(host=host, port=port)


def resolve_world_port(
    env: dict[str, str] | None = None,
    config_path: Path | None = None,
) -> int:
    source = env if env is not None else os.environ
    raw = str(source.get(WORLD_PORT_ENV, "")).strip()
    if raw.isdigit():
        port = int(raw)
        if 0 < port < 65536:
            return port
    return load_runtime_config(config_path).port
