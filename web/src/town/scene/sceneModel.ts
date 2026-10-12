/**
 * SceneModel — what is where, in which order.
 *
 * Built once from a SceneConfig. It resolves every object against the asset
 * registry, projects it into screen space and fixes a total painter's order.
 * It reads no visual state and no financial data: the same model is used for
 * every TownVisualState.
 */

import { ASSET_REGISTRY, type AssetDef, type AssetId } from "./assets";
import {
  drawKey,
  gridToScreen,
  viewBoxFor,
  type GridBounds,
  type GridPos,
  type ScreenPos,
} from "./coordinates";
import type { Orientation, SceneConfig, SceneObjectDef } from "./livingTownScene";

export interface PlacedObject {
  id: string;
  asset: AssetId;
  def: AssetDef;
  grid: GridPos;
  orientation: Orientation;
  /** Screen anchor = projected north corner of the footprint at ground level. */
  screen: ScreenPos;
  key: number;
}

export interface SceneModel {
  id: string;
  bounds: GridBounds;
  /** Every ground cell inside bounds (base terrain), north-to-south order. */
  ground: GridPos[];
  /** All objects in final painter's order. */
  objects: PlacedObject[];
  livingSpots: GridPos[];
  externalConnectionAnchorId: string;
  variableLotId: string;
  viewBox: { x: number; y: number; w: number; h: number };
}

export class SceneConfigError extends Error {
  constructor(message: string) {
    super(`Scene config error: ${message}`);
    this.name = "SceneConfigError";
  }
}

function cellsOf(o: SceneObjectDef, def: AssetDef): string[] {
  const cells: string[] = [];
  for (let dx = 0; dx < def.footprint.w; dx += 1) {
    for (let dy = 0; dy < def.footprint.h; dy += 1) {
      cells.push(`${o.gridX + dx},${o.gridY + dy}`);
    }
  }
  return cells;
}

function inBounds(x: number, y: number, b: GridBounds): boolean {
  return x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY;
}

export function buildSceneModel(config: SceneConfig): SceneModel {
  const seenIds = new Set<string>();
  const flatCells = new Map<string, string>();
  const solidCells = new Map<string, string>();
  let tallest = 0;

  const objects: PlacedObject[] = config.objects.map((o) => {
    if (seenIds.has(o.id)) throw new SceneConfigError(`duplicate object id "${o.id}"`);
    seenIds.add(o.id);

    const def = ASSET_REGISTRY[o.asset];
    if (!def) throw new SceneConfigError(`"${o.id}" uses unknown asset "${o.asset}"`);

    const z = o.gridZ ?? 0;
    if (!Number.isInteger(o.gridX) || !Number.isInteger(o.gridY) || !Number.isInteger(z) || z < 0) {
      throw new SceneConfigError(`"${o.id}" has a non-integer or negative grid coordinate`);
    }
    for (const cell of cellsOf(o, def)) {
      const [cx, cy] = cell.split(",").map(Number);
      if (!inBounds(cx, cy, config.bounds)) {
        throw new SceneConfigError(`"${o.id}" footprint leaves the scene bounds at (${cell})`);
      }
      const layer = def.flat ? flatCells : solidCells;
      const other = layer.get(cell);
      if (other) {
        throw new SceneConfigError(`"${o.id}" overlaps "${other}" at (${cell})`);
      }
      layer.set(cell, o.id);
    }

    tallest = Math.max(tallest, def.heightPx + z);
    return {
      id: o.id,
      asset: o.asset,
      def,
      grid: { x: o.gridX, y: o.gridY, z },
      orientation: o.orientation ?? "S",
      screen: gridToScreen(o.gridX, o.gridY, z),
      key: drawKey(o.gridX, o.gridY, z, def.footprint, def.flat),
    };
  });

  for (const spot of config.livingSpots) {
    if (!inBounds(spot.x, spot.y, config.bounds)) {
      throw new SceneConfigError(`living spot (${spot.x},${spot.y}) leaves the scene bounds`);
    }
  }
  if (!seenIds.has(config.externalConnectionAnchorId)) {
    throw new SceneConfigError(`external connection anchor "${config.externalConnectionAnchorId}" is not placed`);
  }
  if (!seenIds.has(config.variableLotId)) {
    throw new SceneConfigError(`variable lot "${config.variableLotId}" is not placed`);
  }

  objects.sort((a, b) => a.key - b.key || a.id.localeCompare(b.id));

  const ground: GridPos[] = [];
  for (let sum = config.bounds.minX + config.bounds.minY; sum <= config.bounds.maxX + config.bounds.maxY; sum += 1) {
    for (let x = config.bounds.minX; x <= config.bounds.maxX; x += 1) {
      const y = sum - x;
      if (y >= config.bounds.minY && y <= config.bounds.maxY) ground.push({ x, y, z: 0 });
    }
  }

  return {
    id: config.id,
    bounds: config.bounds,
    ground,
    objects,
    livingSpots: config.livingSpots,
    externalConnectionAnchorId: config.externalConnectionAnchorId,
    variableLotId: config.variableLotId,
    viewBox: viewBoxFor(config.bounds, tallest),
  };
}
