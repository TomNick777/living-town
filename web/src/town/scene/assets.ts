/**
 * Asset registry — identity, footprint and category of every modular asset.
 *
 * This file knows nothing about drawing (that lives in render/assets) and
 * nothing about money. An asset is a piece of a believable neighbourhood;
 * it exists because a street needs it, not because a spending category does
 * (docs/living-town-visual-language.md: no building <-> category mapping).
 */

import type { Footprint } from "./coordinates";

export type AssetCategory =
  | "building"
  | "infrastructure"
  | "furniture"
  | "nature"
  | "living"
  | "special";

export interface AssetDef {
  id: AssetId;
  category: AssetCategory;
  footprint: Footprint;
  /** Flat tiles are painted first and may sit under furniture/living elements. */
  flat: boolean;
  /** Approximate silhouette height (px) — for viewBox sizing only. */
  heightPx: number;
}

export const ASSET_IDS = [
  // buildings
  "residential_a",
  "residential_b",
  "convenience_store",
  "cafe",
  // infrastructure
  "road_straight",
  "road_corner",
  "sidewalk",
  "crosswalk",
  "bridge",
  "water",
  "green_patch",
  // street furniture
  "street_light",
  "bench",
  "vending_machine",
  "bicycle_rack",
  "bus_stop",
  // nature
  "tree",
  "shrub",
  "planter",
  // living elements (architecture only in v1; pedestrians are placed statically)
  "pedestrian",
  "bicycle",
  "car",
  // special
  "external_connection_anchor",
  "variable_lot",
] as const;

export type AssetId = (typeof ASSET_IDS)[number];

const def = (
  id: AssetId,
  category: AssetCategory,
  w: number,
  h: number,
  heightPx: number,
  flat = false,
): AssetDef => ({ id, category, footprint: { w, h }, flat, heightPx });

export const ASSET_REGISTRY: Record<AssetId, AssetDef> = {
  residential_a: def("residential_a", "building", 2, 2, 118),
  residential_b: def("residential_b", "building", 2, 2, 74),
  convenience_store: def("convenience_store", "building", 2, 1, 44),
  cafe: def("cafe", "building", 1, 1, 46),

  road_straight: def("road_straight", "infrastructure", 1, 1, 0, true),
  road_corner: def("road_corner", "infrastructure", 1, 1, 0, true),
  sidewalk: def("sidewalk", "infrastructure", 1, 1, 0, true),
  crosswalk: def("crosswalk", "infrastructure", 1, 1, 0, true),
  bridge: def("bridge", "infrastructure", 2, 1, 14, true),
  water: def("water", "infrastructure", 1, 1, 0, true),
  green_patch: def("green_patch", "infrastructure", 1, 1, 0, true),

  street_light: def("street_light", "furniture", 1, 1, 58),
  bench: def("bench", "furniture", 1, 1, 14),
  vending_machine: def("vending_machine", "furniture", 1, 1, 30),
  bicycle_rack: def("bicycle_rack", "furniture", 1, 1, 14),
  bus_stop: def("bus_stop", "furniture", 1, 1, 42),

  tree: def("tree", "nature", 1, 1, 60),
  shrub: def("shrub", "nature", 1, 1, 16),
  planter: def("planter", "nature", 1, 1, 18),

  pedestrian: def("pedestrian", "living", 1, 1, 22),
  bicycle: def("bicycle", "living", 1, 1, 18),
  car: def("car", "living", 1, 1, 22),

  external_connection_anchor: def("external_connection_anchor", "special", 2, 1, 52),
  variable_lot: def("variable_lot", "special", 2, 2, 12),
};

export function assetDef(id: AssetId): AssetDef {
  return ASSET_REGISTRY[id];
}
