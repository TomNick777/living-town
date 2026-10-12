/**
 * Local placement preview — the ghost's validity check (FB-6).
 *
 * This is the WEB-SIDE APPROXIMATION the baseline explicitly allows
 * (functional baseline §5: "web 本地 ghost 预览可用契约数据近似,最终以
 * 服务端裁决为准"). It mirrors the authoritative rules using the same data
 * the scene already uses (asset registry footprints + static base scene
 * solids), and the golden parity corpus in placementParity.test.ts locks the
 * rules so the mirror cannot drift. The server's verdict always wins; a
 * locally-valid ghost can still be rejected (VERSION_CONFLICT, a move that
 * raced) and the UI must show that error honestly.
 */

import { ASSET_REGISTRY } from "../scene/assets";
import { LIVING_TOWN_BASE_SCENE } from "../scene/livingTownScene";
import type { TownWorldState } from "./types";

/** Solid cells occupied by the static base, derived once from the scene. */
const BASE_SOLID_CELLS: ReadonlySet<string> = (() => {
  const cells = new Set<string>();
  for (const object of LIVING_TOWN_BASE_SCENE.objects) {
    const def = ASSET_REGISTRY[object.asset];
    if (def.flat) continue;
    for (let dx = 0; dx < def.footprint.w; dx += 1) {
      for (let dy = 0; dy < def.footprint.h; dy += 1) {
        cells.add(`${object.gridX + dx},${object.gridY + dy}`);
      }
    }
  }
  return cells;
})();

export function isLocalPlacementValid(
  world: TownWorldState,
  assetId: string,
  gridX: number,
  gridY: number,
  excludeBuildingId?: string,
): boolean {
  const def = ASSET_REGISTRY[assetId as keyof typeof ASSET_REGISTRY];
  if (!def) return false;
  const { minX, maxX, minY, maxY } = LIVING_TOWN_BASE_SCENE.bounds;
  for (let dx = 0; dx < def.footprint.w; dx += 1) {
    for (let dy = 0; dy < def.footprint.h; dy += 1) {
      const x = gridX + dx;
      const y = gridY + dy;
      if (x < minX || x > maxX || y < minY || y > maxY) return false;
      if (BASE_SOLID_CELLS.has(`${x},${y}`)) return false;
      for (const building of world.buildings) {
        if (building.lifecycle !== "ACTIVE") continue; // demolished never blocks
        if (excludeBuildingId !== undefined && building.building_id === excludeBuildingId) continue;
        const other = ASSET_REGISTRY[building.asset_id as keyof typeof ASSET_REGISTRY];
        if (!other) continue; // unknown asset — let the server reject it
        const withinX = x >= building.grid_x && x < building.grid_x + other.footprint.w;
        const withinY = y >= building.grid_y && y < building.grid_y + other.footprint.h;
        if (withinX && withinY) return false;
      }
    }
  }
  return true;
}
