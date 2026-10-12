"""TownWorldState — the persistent world-layer read model (FB-1).

Two parallel state lines, never merged (docs/living-town-functional-baseline.md
§0/§1): TownState (living_town package) derives period semantics from financial
facts and never contains buildings or positions; TownWorldState is the user's
built-world intent — permanent building identities, grid placement, lifecycle.
It is persisted in SQLite (town_world / town_building), is not a financial
fact and is not derived from TownState.

The JSON shape of :meth:`TownWorldState.to_dict` is the versioned transport
shared by the CLI and (from FB-4) the local HTTP API.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

WORLD_VERSION = "town-world-v1"

LIFECYCLE_ACTIVE = "ACTIVE"
LIFECYCLE_DEMOLISHED = "DEMOLISHED"


@dataclass(frozen=True)
class BuildingInstance:
    """One built thing. Identity (building_id) is decoupled from asset,
    coordinates and renderer: move/upgrade/demolish never changes the id."""

    building_id: str
    asset_id: str
    grid_x: int
    grid_y: int
    orientation: str
    lifecycle: str
    provenance: dict[str, Any] | None = field(default=None)
    created_at: str | None = field(default=None)

    @property
    def active(self) -> bool:
        return self.lifecycle == LIFECYCLE_ACTIVE

    def to_dict(self) -> dict[str, Any]:
        return {
            "building_id": self.building_id,
            "asset_id": self.asset_id,
            "grid_x": self.grid_x,
            "grid_y": self.grid_y,
            "orientation": self.orientation,
            "lifecycle": self.lifecycle,
            "provenance": self.provenance,
            "created_at": self.created_at,
        }


@dataclass(frozen=True)
class TownWorldState:
    """The whole world: world-level facts + every building (including the
    demolished history). ``buildings`` is always sorted by building_id —
    deterministic output; array order is not identity."""

    world_version: str
    layout_version: str
    revision: int
    buildings: tuple[BuildingInstance, ...] = field(default=())

    def active_buildings(self) -> tuple[BuildingInstance, ...]:
        return tuple(b for b in self.buildings if b.active)

    def to_dict(self) -> dict[str, Any]:
        return {
            "world_version": self.world_version,
            "layout_version": self.layout_version,
            "revision": self.revision,
            "buildings": [b.to_dict() for b in self.buildings],
        }
