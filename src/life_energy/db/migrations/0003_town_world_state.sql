-- Migration 3: living town world layer (TownWorldState, FB-1).
--
-- The world layer holds the user's built-world intent: permanent building
-- identities, grid placement, lifecycle. It is fully isolated from the
-- ledger: no FK to transactions, no amounts (*_minor), no renderer concepts
-- (screen coordinates / drawKey / palette / pixel sizes). Semantic rules —
-- asset vocabulary, layout bounds, collision — live in the domain service
-- and the shared world contract (living_town/world/contracts/), so only the
-- *stable* enumerations are CHECK-constrained here. asset_id deliberately
-- has no CHECK: the vocabulary grows with asset expansion, and a frozen
-- schema list would force a table rebuild on every expansion (§4 of
-- docs/living-town-functional-baseline.md).

CREATE TABLE IF NOT EXISTS town_world (
    id             INTEGER PRIMARY KEY CHECK (id = 1),   -- singleton row
    world_version  TEXT NOT NULL,                        -- 'town-world-v1'
    layout_version TEXT NOT NULL,                        -- 'living-town-block-v1'
    revision       INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
    -- NULL = never bootstrapped. Bootstrap keys on this flag, never on
    -- "building count == 0": a user who demolishes everything must never
    -- see the seed resurrect.
    seeded_at      TEXT
);

INSERT INTO town_world (id, world_version, layout_version)
SELECT 1, 'town-world-v1', 'living-town-block-v1'
WHERE NOT EXISTS (SELECT 1 FROM town_world WHERE id = 1);

CREATE TABLE IF NOT EXISTS town_building (
    -- Permanent TEXT UUID identity: never changes, never reused. Demolish
    -- is a lifecycle transition, never a DELETE; no row leaves this table.
    building_id TEXT PRIMARY KEY,
    asset_id    TEXT NOT NULL,
    grid_x      INTEGER NOT NULL,
    grid_y      INTEGER NOT NULL,
    orientation TEXT NOT NULL DEFAULT 'S'
                CHECK (orientation IN ('N','E','S','W','NE','NW','SE','SW')),
    lifecycle   TEXT NOT NULL DEFAULT 'ACTIVE'
                CHECK (lifecycle IN ('ACTIVE','DEMOLISHED')),
    provenance  TEXT,  -- JSON: why does this row exist (seed / command)
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_town_building_active
    ON town_building(lifecycle, grid_x, grid_y);
