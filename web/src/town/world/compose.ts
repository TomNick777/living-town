/**
 * composeSceneConfig — static base + ACTIVE world buildings → SceneConfig.
 *
 * The composition point of the two state lines (functional baseline §6):
 *
 *   LIVING_TOWN_BASE_SCENE (static)   TownWorldState.buildings (ACTIVE only)
 *             └───────────────┬───────────────┘
 *                             ▼
 *             composeSceneConfig(base, world) → SceneConfig
 *                             ▼
 *                   buildSceneModel(...)      (unchanged defensive validator)
 *
 * The output must be deterministic: buildings are appended in building_id
 * order, so transport order never affects painter's tie-breaks. DEMOLISHED
 * buildings are excluded here — they persist in the world layer but never
 * re-enter the scene.
 */

import { ASSET_REGISTRY } from "../scene/assets";
import type { Orientation, SceneConfig, SceneObjectDef } from "../scene/livingTownScene";
import { WORLD_VERSION, type TownWorldState } from "./types";

export class WorldContractError extends Error {
  constructor(message: string) {
    super(`World contract error: ${message}`);
    this.name = "WorldContractError";
  }
}

function toObjectDef(building: TownWorldState["buildings"][number]): SceneObjectDef {
  if (!Number.isInteger(building.grid_x) || !Number.isInteger(building.grid_y)) {
    throw new WorldContractError(`building "${building.building_id}" has a non-integer grid coordinate`);
  }
  if (!(building.asset_id in ASSET_REGISTRY)) {
    throw new WorldContractError(`building "${building.building_id}" uses unknown asset "${building.asset_id}"`);
  }
  if (building.lifecycle !== "ACTIVE") {
    throw new WorldContractError(`building "${building.building_id}" is ${building.lifecycle} and must be filtered before composition`);
  }
  return {
    id: building.building_id,
    asset: building.asset_id as SceneObjectDef["asset"],
    gridX: building.grid_x,
    gridY: building.grid_y,
    gridZ: 0,
    orientation: building.orientation as Orientation,
  };
}

export function composeSceneConfig(base: SceneConfig, world: TownWorldState): SceneConfig {
  if (world.world_version !== WORLD_VERSION) {
    throw new WorldContractError(`unknown world_version ${world.world_version}; refusing to compose`);
  }
  if (world.layout_version !== base.id) {
    throw new WorldContractError(
      `layout mismatch: world is "${world.layout_version}" but the base scene is "${base.id}"`,
    );
  }
  const active = world.buildings
    .filter((b) => b.lifecycle === "ACTIVE")
    .sort((a, b) => (a.building_id < b.building_id ? -1 : a.building_id > b.building_id ? 1 : 0));
  return { ...base, objects: [...base.objects, ...active.map(toObjectDef)] };
}
