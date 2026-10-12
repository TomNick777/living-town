/**
 * LIVING_TOWN_BASE_SCENE — the static base of the first neighbourhood block.
 *
 * Since FB-3 this config contains ONLY the fixed infrastructure: the four
 * user-facing buildings (residential-a/b, convenience-store, cafe) moved out
 * and now come exclusively from the persistent world layer (TownWorldState,
 * seeded from world_contract_v1.json) via world/compose.ts. A lived-in street
 * has its layout fixed; buildings exist because the user built them, never
 * because a month contained a matching spending category. Financial state
 * only ever changes how the block *behaves* (lights, activity, the external
 * connection), never what is built here.
 *
 * Every object is placed on the shared isometric grid (scene/coordinates.ts).
 * Grid orientation: x grows to the south-east, y to the south-west.
 *   y 0..4  residential block + local commerce (north of the main road)
 *   y 5     north sidewalk (bus stop, lights)
 *   y 6     main road (east-west), crossing the river on a bridge
 *   y 7     south sidewalk
 *   y 8..9  riverside park strip
 *   x 12,13 river; x 14,15 far bank = external connection anchor only
 */

import type { AssetId } from "./assets";
import type { GridBounds, GridPos } from "./coordinates";

/**
 * Facing / axis token. Roads: N|S = north-south axis, E|W = east-west axis.
 * Corners: two letters = the two arms. Buildings: side the entrance faces.
 */
export type Orientation = "N" | "E" | "S" | "W" | "NE" | "NW" | "SE" | "SW";

export interface SceneObjectDef {
  id: string;
  asset: AssetId;
  gridX: number;
  gridY: number;
  gridZ?: number;
  orientation?: Orientation;
}

export interface SceneConfig {
  id: string;
  bounds: GridBounds;
  objects: SceneObjectDef[];
  /** Candidate positions for living elements, in placement priority order. */
  livingSpots: GridPos[];
  /** Reserved hook for the future Otter Holdings connection. */
  externalConnectionAnchorId: string;
  /** Reserved lot for future construction / life-stage projects (EMPTY in v1). */
  variableLotId: string;
}

function place(asset: AssetId, x: number, y: number, orientation?: Orientation, id?: string): SceneObjectDef {
  return { id: id ?? `${asset}-${x}-${y}`, asset, gridX: x, gridY: y, gridZ: 0, orientation };
}

/** Inclusive straight run of 1x1 tiles along one axis. */
function run(asset: AssetId, x0: number, y0: number, x1: number, y1: number, orientation: Orientation, skip: [number, number][] = []): SceneObjectDef[] {
  const out: SceneObjectDef[] = [];
  const dx = Math.sign(x1 - x0);
  const dy = Math.sign(y1 - y0);
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let i = 0; i <= steps; i += 1) {
    const x = x0 + dx * i;
    const y = y0 + dy * i;
    if (skip.some(([sx, sy]) => sx === x && sy === y)) continue;
    out.push(place(asset, x, y, orientation));
  }
  return out;
}

export const LIVING_TOWN_BASE_SCENE: SceneConfig = {
  id: "living-town-block-v1",
  bounds: { minX: 0, maxX: 15, minY: 0, maxY: 9 },
  externalConnectionAnchorId: "external-connection-anchor",
  variableLotId: "variable-lot",
  objects: [
    // --- edge feature: river + bridge --------------------------------------
    ...run("water", 12, 0, 12, 9, "N", [[12, 6]]),
    ...run("water", 13, 0, 13, 9, "N", [[13, 6]]),
    place("bridge", 12, 6, "E", "bridge"),

    // --- infrastructure ----------------------------------------------------
    place("road_corner", 0, 6, "SE", "road-corner-west"),
    ...run("road_straight", 1, 6, 11, 6, "E", [[4, 6]]),
    place("crosswalk", 4, 6, "N", "crosswalk-main"),
    ...run("road_straight", 0, 7, 0, 9, "S"),
    ...run("road_straight", 7, 2, 7, 4, "S"), // secondary lane into the block
    ...run("sidewalk", 0, 5, 11, 5, "E"),
    ...run("sidewalk", 1, 7, 11, 7, "E"),
    place("green_patch", 0, 3, "S"),
    place("green_patch", 0, 4, "S"),
    place("green_patch", 1, 4, "S"),

    // --- public space ------------------------------------------------------
    place("bus_stop", 8, 5, "S", "bus-stop"),
    place("bench", 0, 4, "E", "bench-corner-green"),
    place("bench", 6, 8, "N", "bench-riverside-park"),
    place("street_light", 2, 5, "S"),
    place("street_light", 6, 5, "S"),
    place("street_light", 10, 5, "S"),
    place("street_light", 3, 7, "N"),
    place("street_light", 9, 7, "N"),
    place("vending_machine", 6, 4, "S", "vending-machine"),
    place("bicycle_rack", 11, 4, "S", "bicycle-rack"),
    place("planter", 2, 4, "S"),
    place("planter", 8, 4, "S"),
    place("planter", 4, 8, "N"),

    // --- nature ------------------------------------------------------------
    place("tree", 0, 0), place("tree", 2, 0), place("tree", 4, 1), place("tree", 0, 2),
    place("tree", 9, 1), place("tree", 10, 2), place("tree", 11, 1),
    place("tree", 2, 8), place("tree", 5, 9), place("tree", 8, 8), place("tree", 11, 8),
    place("tree", 14, 8), place("tree", 15, 2),
    place("shrub", 8, 3), place("shrub", 3, 4), place("shrub", 11, 2),
    place("shrub", 3, 9), place("shrub", 7, 9), place("shrub", 10, 9),

    // --- reserved: variable lot + external connection ----------------------
    place("variable_lot", 6, 0, "S", "variable-lot"),
    place("external_connection_anchor", 14, 6, "E", "external-connection-anchor"),
  ],
  livingSpots: [
    { x: 3, y: 5, z: 0 },
    { x: 9, y: 5, z: 0 },
    { x: 5, y: 7, z: 0 },
    { x: 10, y: 7, z: 0 },
    { x: 1, y: 5, z: 0 },
    { x: 7, y: 7, z: 0 },
    { x: 11, y: 5, z: 0 },
    { x: 4, y: 7, z: 0 },
  ],
};
