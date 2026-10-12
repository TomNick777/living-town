"""Placement authority — the single rule implementation (FB-2, §5).

Python is the placement authority; the TS SceneModel keeps its build-time
validation as a defensive net. The *rules logic* lives only here, the *rules
data* lives only in the shared world contract. This module is pure: no DB,
no IO — the service applies its verdicts inside the write transaction.

Rules (fixed for the baseline):
- the candidate footprint must sit on integer grid cells;
- the whole footprint must stay inside the layout bounds;
- footprint cells must not intersect any static solid cell (trees, lots,
  furniture, the external anchor — everything the static base occupies);
- footprint cells must not intersect any ACTIVE building's cells
  (DEMOLISHED buildings never block; the moved/changed building itself is
  excluded by the caller);
- flat static cells (roads, water, sidewalks) do NOT block solid placement —
  the same single rule the SceneModel uses for furniture-on-flat.

Zoning (e.g. "no building on water") is future contract semantics and is
deliberately not implemented here.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Iterable

from .contract import WorldContractV1
from .errors import (
    ASSET_NOT_PLACEABLE,
    COLLISION,
    INVALID_COORDINATE,
    OUT_OF_BOUNDS,
    UNKNOWN_ASSET,
)

OK = "OK"

_STATIC_SOURCE = "static"
_BUILDING_SOURCE_PREFIX = "building:"


@dataclass(frozen=True)
class ActiveFootprint:
    """One blocking building, reduced to what collision needs."""

    building_id: str
    cells: frozenset[tuple[int, int]]

    @classmethod
    def from_contract(cls, building_id: str, asset_w: int, asset_h: int, grid_x: int, grid_y: int) -> "ActiveFootprint":
        return cls(
            building_id=building_id,
            cells=frozenset(
                (grid_x + dx, grid_y + dy) for dy in range(asset_h) for dx in range(asset_w)
            ),
        )


@dataclass(frozen=True)
class PlacementVerdict:
    ok: bool
    code: str
    detail: dict[str, Any] = field(default_factory=dict)
    cells: tuple[tuple[int, int], ...] = ()


def _rejected(code: str, detail: dict[str, Any]) -> PlacementVerdict:
    return PlacementVerdict(ok=False, code=code, detail=detail)


def _is_int(value: Any) -> bool:
    # bool is an int subclass; JSON true/false must not become coordinates.
    return isinstance(value, int) and not isinstance(value, bool)


def evaluate_placement(
    contract: WorldContractV1,
    asset_id: Any,
    grid_x: Any,
    grid_y: Any,
    *,
    active_footprints: Iterable[ActiveFootprint] = (),
    exclude_building_id: str | None = None,
) -> PlacementVerdict:
    """Full placement evaluation in §9 order: asset → coordinates → bounds →
    collision. Returns OK or the stable error code with an explanatory detail."""
    asset = contract.assets.get(asset_id) if isinstance(asset_id, str) else None
    if asset is None:
        return _rejected(UNKNOWN_ASSET, {"asset_id": asset_id})
    if not asset.placeable:
        return _rejected(ASSET_NOT_PLACEABLE, {"asset_id": asset_id, "category": asset.category})
    if not (_is_int(grid_x) and _is_int(grid_y)):
        return _rejected(INVALID_COORDINATE, {"grid_x": grid_x, "grid_y": grid_y})

    cells = tuple(asset.footprint_cells(grid_x, grid_y))
    outside = [list(cell) for cell in cells if not contract.bounds.contains(*cell)]
    if outside:
        return _rejected(OUT_OF_BOUNDS, {"cells": outside})

    blocked_static = [list(cell) for cell in cells if cell in contract.static_solid_cell_set]
    if blocked_static:
        return _rejected(COLLISION, {"source": _STATIC_SOURCE, "cells": blocked_static})

    blockers: list[str] = []
    blocked_cells: set[tuple[int, int]] = set()
    cells_set = frozenset(cells)
    for footprint in active_footprints:
        if exclude_building_id is not None and footprint.building_id == exclude_building_id:
            continue
        hit = cells_set & footprint.cells
        if hit:
            blockers.append(footprint.building_id)
            blocked_cells |= hit
    if blockers:
        return _rejected(
            COLLISION,
            {
                "source": sorted(blockers),
                "cells": sorted(list(cell) for cell in blocked_cells),
            },
        )

    return PlacementVerdict(ok=True, code=OK, cells=cells)


def active_footprints_from_state(
    contract: WorldContractV1,
    buildings: Iterable[Any],
) -> list[ActiveFootprint]:
    """Footprints of every ACTIVE building; unknown assets there are a loud
    data error (the service vocabulary check should have prevented them)."""
    footprints: list[ActiveFootprint] = []
    for building in buildings:
        if not getattr(building, "active", False):
            continue
        asset = contract.assets.get(building.asset_id)
        if asset is None:
            raise ValueError(
                f"building {building.building_id}: stored asset_id {building.asset_id!r} is not in the contract"
            )
        footprints.append(
            ActiveFootprint.from_contract(
                building.building_id, asset.footprint_w, asset.footprint_h, building.grid_x, building.grid_y
            )
        )
    return footprints
