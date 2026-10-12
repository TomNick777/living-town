/**
 * SEED_WORLD — the offline bootstrap world (FB-3 transition fixture).
 *
 * Mirrored from world_contract_v1.json seed_buildings: the four frozen-UUID
 * buildings, revision 1 (the frozen seed revision). Parity with the contract
 * is locked by worldComposition.test.ts — this file must never drift.
 *
 * The web app runs on this constant only until the local world service is
 * wired (FB-4). It is NOT a demo of fake data: these are the same seed rows
 * ensure_world() writes into SQLite, so the offline view and the persisted
 * view agree byte-for-byte on identity, placement and lifecycle.
 */

import type { TownWorldState } from "./types";

export const SEED_WORLD: TownWorldState = {
  world_version: "town-world-v1",
  layout_version: "living-town-block-v1",
  revision: 1,
  buildings: [
    {
      building_id: "5513ac64-2727-4f4f-9e9e-44441076de27", // residential-a
      asset_id: "residential_a",
      grid_x: 1,
      grid_y: 2,
      orientation: "S",
      lifecycle: "ACTIVE",
    },
    {
      building_id: "0deb488a-6d16-4c95-b245-7ff945b77402", // residential-b
      asset_id: "residential_b",
      grid_x: 4,
      grid_y: 3,
      orientation: "S",
      lifecycle: "ACTIVE",
    },
    {
      building_id: "45a22d48-57c5-4d02-95c3-517d1c36957c", // cafe
      asset_id: "cafe",
      grid_x: 11,
      grid_y: 3,
      orientation: "S",
      lifecycle: "ACTIVE",
    },
    {
      building_id: "ea217128-8498-491b-b025-42e8653f387d", // convenience-store
      asset_id: "convenience_store",
      grid_x: 9,
      grid_y: 4,
      orientation: "S",
      lifecycle: "ACTIVE",
    },
  ],
};
