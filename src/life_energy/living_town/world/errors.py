"""Stable world-command error codes (docs/living-town-functional-baseline.md §9).

Codes are part of the command protocol: the CLI prints them and (from FB-5)
the HTTP transport maps them to status codes. They must never be renamed
lightly — clients match on them.
"""

from __future__ import annotations

from typing import Any

VERSION_CONFLICT = "VERSION_CONFLICT"
COLLISION = "COLLISION"
OUT_OF_BOUNDS = "OUT_OF_BOUNDS"
INVALID_COORDINATE = "INVALID_COORDINATE"
UNKNOWN_ASSET = "UNKNOWN_ASSET"
ASSET_NOT_PLACEABLE = "ASSET_NOT_PLACEABLE"
BUILDING_NOT_FOUND = "BUILDING_NOT_FOUND"
BUILDING_DEMOLISHED = "BUILDING_DEMOLISHED"
MALFORMED_COMMAND = "MALFORMED_COMMAND"

ALL_ERROR_CODES = (
    VERSION_CONFLICT,
    COLLISION,
    OUT_OF_BOUNDS,
    INVALID_COORDINATE,
    UNKNOWN_ASSET,
    ASSET_NOT_PLACEABLE,
    BUILDING_NOT_FOUND,
    BUILDING_DEMOLISHED,
    MALFORMED_COMMAND,
)


class WorldCommandError(Exception):
    """A rejected world command: stable code + human message + optional detail."""

    def __init__(self, code: str, message: str, detail: dict[str, Any] | None = None) -> None:
        super().__init__(f"{code}: {message}")
        self.code = code
        self.message = message
        self.detail = detail or {}

    def to_dict(self) -> dict[str, Any]:
        return {"error": self.code, "message": self.message, "detail": self.detail}
