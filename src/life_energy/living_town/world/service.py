"""World domain service — the only write path into the world layer (FB-2).

Every mutation goes through here: the CLI and (from FB-5) the HTTP handler
are thin shells over these functions. Nothing else may UPDATE/INSERT into
town_world / town_building — UI or CLI writing SQL directly is forbidden
(docs/living-town-functional-baseline.md §9).

Each command:
1. passes the ensure_world gate (first touch seeds, exactly once);
2. opens its own BEGIN IMMEDIATE transaction (or joins a caller-owned one);
3. re-reads the world *inside* the transaction and compares its revision
   with expected_revision (optimistic concurrency, §10);
4. validates via the pure placement engine (§5) in the §9 order;
5. writes rows and bumps revision atomically, or raises WorldCommandError
   with a stable code and leaves the world byte-identical.

Provenance: every command row records {"via": ..., "command": {...}} so the
world can always answer "why does this building exist / why is it here".
"""

from __future__ import annotations

import json
import sqlite3
import uuid
from typing import Any, Callable

from .bootstrap import ensure_world, load_world
from .contract import WorldContractV1, load_contract
from .errors import (
    BUILDING_DEMOLISHED,
    BUILDING_NOT_FOUND,
    MALFORMED_COMMAND,
    VERSION_CONFLICT,
    WorldCommandError,
)
from .models import (
    LIFECYCLE_ACTIVE,
    BuildingInstance,
    TownWorldState,
)
from .placement import active_footprints_from_state, evaluate_placement


def _check_orientation(orientation: Any, *, contract: WorldContractV1) -> str:
    if not isinstance(orientation, str) or orientation not in contract.orientations:
        raise WorldCommandError(
            MALFORMED_COMMAND,
            f"orientation must be one of {list(contract.orientations)}",
            {"field": "orientation", "got": orientation},
        )
    return orientation


def _check_revision(current: int, expected_revision: Any) -> None:
    if isinstance(expected_revision, bool) or not isinstance(expected_revision, int):
        raise WorldCommandError(
            MALFORMED_COMMAND,
            "expected_revision must be an integer",
            {"field": "expected_revision", "got": expected_revision},
        )
    if expected_revision != current:
        raise WorldCommandError(
            VERSION_CONFLICT,
            f"world moved on: expected revision {expected_revision}, current is {current}",
            {"expected_revision": expected_revision, "current_revision": current},
        )


def _find_active_building(state: TownWorldState, building_id: Any) -> BuildingInstance:
    if not isinstance(building_id, str) or not building_id:
        raise WorldCommandError(
            MALFORMED_COMMAND,
            "building_id must be a non-empty string",
            {"field": "building_id", "got": building_id},
        )
    for building in state.buildings:
        if building.building_id == building_id:
            if building.lifecycle != LIFECYCLE_ACTIVE:
                raise WorldCommandError(
                    BUILDING_DEMOLISHED,
                    f"building {building_id} was demolished; demolished buildings cannot be changed",
                    {"building_id": building_id},
                )
            return building
    raise WorldCommandError(BUILDING_NOT_FOUND, f"no building with id {building_id!r}", {"building_id": building_id})


def _provenance(via: str, command_type: str, command_data: dict[str, Any]) -> str:
    return json.dumps(
        {"via": via, "command": {"type": command_type, **command_data}},
        ensure_ascii=False,
        sort_keys=True,
    )


def _finalize(
    conn: sqlite3.Connection,
    *,
    expected_revision: Any,
    contract: WorldContractV1,
    work: Callable[[TownWorldState], None],
) -> TownWorldState:
    """Shared command skeleton: gate → tx → fresh read → revision check →
    work() → revision+1. work() runs inside the transaction, so its
    validation sees the committed world even under concurrency."""
    ensure_world(conn, contract=contract)
    owns_tx = not conn.in_transaction
    if owns_tx:
        conn.execute("BEGIN IMMEDIATE")
    try:
        state = load_world(conn, contract=contract)
        _check_revision(state.revision, expected_revision)
        work(state)
        conn.execute("UPDATE town_world SET revision = revision + 1 WHERE id = 1")
        if owns_tx:
            conn.commit()
    except Exception:
        if owns_tx:
            conn.rollback()
        raise
    return load_world(conn, contract=contract)


def create_building(
    conn: sqlite3.Connection,
    *,
    asset_id: Any,
    grid_x: Any,
    grid_y: Any,
    expected_revision: Any,
    orientation: Any = "S",
    via: str = "cli",
    contract: WorldContractV1 | None = None,
) -> TownWorldState:
    """Place a new building; the server assigns its permanent UUID."""
    contract = contract or load_contract()
    _check_orientation(orientation, contract=contract)
    command_data = {"asset_id": asset_id, "grid_x": grid_x, "grid_y": grid_y, "orientation": orientation}

    def work(state: TownWorldState) -> None:
        verdict = evaluate_placement(
            contract,
            asset_id,
            grid_x,
            grid_y,
            active_footprints=active_footprints_from_state(contract, state.buildings),
        )
        if not verdict.ok:
            raise WorldCommandError(verdict.code, f"cannot place {asset_id!r} at ({grid_x}, {grid_y})", verdict.detail)
        conn.execute(
            """
            INSERT INTO town_building
                (building_id, asset_id, grid_x, grid_y, orientation, lifecycle, provenance)
            VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?)
            """,
            (
                str(uuid.uuid4()),
                asset_id,
                grid_x,
                grid_y,
                orientation,
                _provenance(via, "CreateBuilding", command_data),
            ),
        )

    return _finalize(conn, expected_revision=expected_revision, contract=contract, work=work)


def move_building(
    conn: sqlite3.Connection,
    *,
    building_id: Any,
    grid_x: Any,
    grid_y: Any,
    expected_revision: Any,
    orientation: Any = None,
    via: str = "cli",
    contract: WorldContractV1 | None = None,
) -> TownWorldState:
    """Move a building: identity, asset and created_at never change."""
    contract = contract or load_contract()
    if orientation is not None:
        _check_orientation(orientation, contract=contract)
    command_data = {"building_id": building_id, "grid_x": grid_x, "grid_y": grid_y, "orientation": orientation}

    def work(state: TownWorldState) -> None:
        building = _find_active_building(state, building_id)
        new_orientation = orientation if orientation is not None else building.orientation
        verdict = evaluate_placement(
            contract,
            building.asset_id,
            grid_x,
            grid_y,
            active_footprints=active_footprints_from_state(contract, state.buildings),
            exclude_building_id=building.building_id,  # moving within/over one's own cells is legal
        )
        if not verdict.ok:
            raise WorldCommandError(verdict.code, f"cannot move {building_id} to ({grid_x}, {grid_y})", verdict.detail)
        conn.execute(
            "UPDATE town_building SET grid_x = ?, grid_y = ?, orientation = ? WHERE building_id = ?",
            (grid_x, grid_y, new_orientation, building.building_id),
        )

    return _finalize(conn, expected_revision=expected_revision, contract=contract, work=work)


def change_building_asset(
    conn: sqlite3.Connection,
    *,
    building_id: Any,
    asset_id: Any,
    expected_revision: Any,
    via: str = "cli",
    contract: WorldContractV1 | None = None,
) -> TownWorldState:
    """Rebuild (改建): same identity, new asset. The new footprint is fully
    re-validated at the original anchor — a bigger footprint must still fit."""
    contract = contract or load_contract()
    command_data = {"building_id": building_id, "asset_id": asset_id}

    def work(state: TownWorldState) -> None:
        building = _find_active_building(state, building_id)
        verdict = evaluate_placement(
            contract,
            asset_id,
            building.grid_x,
            building.grid_y,
            active_footprints=active_footprints_from_state(contract, state.buildings),
            exclude_building_id=building.building_id,
        )
        if not verdict.ok:
            raise WorldCommandError(
                verdict.code,
                f"cannot change {building_id} from {building.asset_id!r} to {asset_id!r} at its anchor",
                verdict.detail,
            )
        conn.execute(
            "UPDATE town_building SET asset_id = ? WHERE building_id = ?",
            (asset_id, building.building_id),
        )

    return _finalize(conn, expected_revision=expected_revision, contract=contract, work=work)


def demolish_building(
    conn: sqlite3.Connection,
    *,
    building_id: Any,
    expected_revision: Any,
    via: str = "cli",
    contract: WorldContractV1 | None = None,
) -> TownWorldState:
    """Soft demolition: lifecycle ACTIVE → DEMOLISHED. The row (and its UUID)
    stays forever; there is no un-demolish in the baseline."""
    contract = contract or load_contract()
    command_data = {"building_id": building_id}

    def work(state: TownWorldState) -> None:
        building = _find_active_building(state, building_id)  # repeat demolish = loud error, not a no-op
        conn.execute(
            "UPDATE town_building SET lifecycle = 'DEMOLISHED' WHERE building_id = ?",
            (building.building_id,),
        )

    return _finalize(conn, expected_revision=expected_revision, contract=contract, work=work)
