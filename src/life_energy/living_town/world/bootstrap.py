"""World persistence: idempotent bootstrap + deterministic load (FB-1).

``ensure_world`` is the gate for every world-layer entry point (read and
write): the first touch seeds the four frozen contract buildings exactly
once, keyed on ``town_world.seeded_at`` — never on "building count == 0",
so a user who demolishes everything must never see the seed resurrect
(docs/living-town-functional-baseline.md §7).

Revision semantics, frozen here: revision 0 = the migrated-but-never-used
world; the single bootstrap bump makes every seeded world start at
revision 1. From then on each domain-service command adds exactly 1.

The write surface of this module is limited to ``town_world`` and
``town_building``; the ledger layers (invariants 1..19) are untouched.
"""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from typing import Any

from .contract import LAYOUT_ID, WorldContractV1, load_contract
from .models import (
    WORLD_VERSION,
    BuildingInstance,
    TownWorldState,
)

#: Frozen initial-revision semantics: 0 = never used; the one-time bootstrap
#: seed is the first world mutation and lands on revision 1.
SEED_REVISION = 1

SEED_PROVENANCE_SOURCE = "bootstrap-seed"


class WorldStateError(ValueError):
    """The stored world state violates its own contract (fail loud, never guess)."""


def _utc_now() -> str:
    """Same format as the DB-side strftime('%Y-%m-%dT%H:%M:%fZ','now')."""
    now = datetime.now(timezone.utc)
    return f"{now.strftime('%Y-%m-%dT%H:%M:%S')}.{now.microsecond // 1000:03d}Z"


def _check_world_row(row: sqlite3.Row, contract: WorldContractV1) -> None:
    if row["world_version"] != WORLD_VERSION:
        raise WorldStateError(
            f"town_world.world_version is {row['world_version']!r}, expected {WORLD_VERSION!r}; "
            "refusing to interpret an unknown world schema"
        )
    if row["layout_version"] != contract.layout_id:
        raise WorldStateError(
            f"town_world.layout_version is {row['layout_version']!r}, expected "
            f"{contract.layout_id!r}; the static base and the world disagree"
        )


def _singleton_row(conn: sqlite3.Connection) -> sqlite3.Row:
    """Read the world singleton; a missing table or missing row is a loud
    domain error, never a raw sqlite exception leaking upward."""
    try:
        row = conn.execute(
            "SELECT world_version, layout_version, revision, seeded_at FROM town_world WHERE id = 1"
        ).fetchone()
    except sqlite3.OperationalError as exc:
        raise WorldStateError(
            f"town_world table missing — apply migrations first (db/migrations/0003): {exc}"
        ) from exc
    if row is None:
        raise WorldStateError("town_world singleton row missing — apply migrations first (db/migrations/0003)")
    return row


def _seed_if_needed(conn: sqlite3.Connection, contract: WorldContractV1) -> bool:
    """Insert the frozen seed buildings once. Caller owns the transaction."""
    row = _singleton_row(conn)
    _check_world_row(row, contract)
    if row["seeded_at"] is not None:
        return False

    seeded_at = _utc_now()
    for seed in contract.seed_buildings:
        conn.execute(
            """
            INSERT INTO town_building
                (building_id, asset_id, grid_x, grid_y, orientation, lifecycle, provenance, created_at)
            VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, ?)
            """,
            (
                seed.building_id,
                seed.asset_id,
                seed.grid_x,
                seed.grid_y,
                seed.orientation,
                json.dumps(
                    {
                        "source": SEED_PROVENANCE_SOURCE,
                        "legacy_object_id": seed.legacy_object_id,
                        "contract_version": contract.contract_version,
                    },
                    ensure_ascii=False,
                    sort_keys=True,
                ),
                seeded_at,  # one bootstrap moment for the whole seed (§7)
            ),
        )
    conn.execute(
        "UPDATE town_world SET seeded_at = ?, revision = ? WHERE id = 1",
        (seeded_at, SEED_REVISION),
    )
    return True


def ensure_world(conn: sqlite3.Connection, *, contract: WorldContractV1 | None = None) -> bool:
    """Idempotent bootstrap. Returns True if this call performed the seeding.

    Concurrency: when the connection has no open transaction we take the
    write lock up front (BEGIN IMMEDIATE, serialized further by the
    busy_timeout pragma) so two first-reads cannot double-seed. Inside a
    caller-owned transaction we join it and leave commit to the caller.
    """
    contract = contract or load_contract()
    owns_tx = not conn.in_transaction
    if owns_tx:
        conn.execute("BEGIN IMMEDIATE")
    try:
        return _seed_if_needed(conn, contract)
    except Exception:
        if owns_tx:
            conn.rollback()
        raise
    finally:
        if owns_tx:
            conn.commit()


def load_world(conn: sqlite3.Connection, *, contract: WorldContractV1 | None = None) -> TownWorldState:
    """Deterministic full read, including the demolished history.

    Buildings are sorted by building_id in Python (not relying on SQL
    collation or insertion order); array order is not identity.
    """
    contract = contract or load_contract()
    row = _singleton_row(conn)
    _check_world_row(row, contract)

    buildings: list[BuildingInstance] = []
    rows = conn.execute(
        """
        SELECT building_id, asset_id, grid_x, grid_y, orientation, lifecycle, provenance, created_at
        FROM town_building
        """
    ).fetchall()
    for r in sorted(rows, key=lambda r: r["building_id"]):
        provenance: dict[str, Any] | None = None
        if r["provenance"] is not None:
            try:
                provenance = json.loads(r["provenance"])
            except json.JSONDecodeError as exc:
                raise WorldStateError(f"town_building {r['building_id']}: provenance is not valid JSON ({exc})") from exc
        buildings.append(
            BuildingInstance(
                building_id=r["building_id"],
                asset_id=r["asset_id"],
                grid_x=r["grid_x"],
                grid_y=r["grid_y"],
                orientation=r["orientation"],
                lifecycle=r["lifecycle"],
                provenance=provenance,
                created_at=r["created_at"],
            )
        )
    return TownWorldState(
        world_version=row["world_version"],
        layout_version=row["layout_version"],
        revision=row["revision"],
        buildings=tuple(buildings),
    )
