/**
 * TownWorldState — the persistent world-layer read model, TS side.
 *
 * Mirrors living_town/world/models.py (Python authority) and the JSON
 * transport documented in docs/living-town-functional-baseline.md §1.1.
 * This is the user's built-world intent — permanent building identities,
 * grid placement, lifecycle — NOT a financial fact and NOT derived from
 * TownState. The web app never reads SQLite: it receives this JSON from
 * the local world service (FB-4) or, until then, from the offline seed
 * fixture (seedWorld.ts).
 *
 * Tolerance rule (portable contract §16): unknown additional fields must be
 * ignored; provenance/created_at may be consumed but carry no semantics here.
 */

export const WORLD_VERSION = "town-world-v1";
/** The static base layout this world's coordinates live in. */
export const LAYOUT_ID = "living-town-block-v1";

export type BuildingLifecycle = "ACTIVE" | "DEMOLISHED";

export interface BuildingInstance {
  building_id: string;
  asset_id: string;
  grid_x: number;
  grid_y: number;
  orientation: string;
  lifecycle: BuildingLifecycle;
  /** Provenance JSON (why does this row exist). Tolerated, not interpreted. */
  provenance?: unknown;
  created_at?: string;
}

export interface TownWorldState {
  world_version: string;
  layout_version: string;
  revision: number;
  /** Always sorted by building_id; array order is not identity. */
  buildings: BuildingInstance[];
}
