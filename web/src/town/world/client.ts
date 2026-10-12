/**
 * World transport client — the ONLY way the web app talks to the world
 * service. The web never reads SQLite; it sees this JSON and nothing else
 * (functional baseline §8, fact #7).
 *
 * Fail-closed: any network error, non-200, or shape/version mismatch throws
 * WorldUnavailableError. Callers must never silently substitute the seed
 * world for the user's real town — SERVICE UNAVAILABLE stays explicit.
 */

import { LAYOUT_ID, WORLD_VERSION, type BuildingInstance, type TownWorldState } from "./types";

export const WORLD_ENDPOINT = "/api/world";

export class WorldUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorldUnavailableError";
  }
}

function isInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

function parseBuilding(raw: unknown): BuildingInstance {
  if (typeof raw !== "object" || raw === null) {
    throw new WorldUnavailableError("world payload has a non-object building");
  }
  const b = raw as Record<string, unknown>;
  if (typeof b.building_id !== "string" || typeof b.asset_id !== "string") {
    throw new WorldUnavailableError("building is missing its identity fields");
  }
  if (!isInt(b.grid_x) || !isInt(b.grid_y)) {
    throw new WorldUnavailableError(`building "${b.building_id}" has non-integer coordinates`);
  }
  if (typeof b.orientation !== "string") {
    throw new WorldUnavailableError(`building "${b.building_id}" has no orientation`);
  }
  if (b.lifecycle !== "ACTIVE" && b.lifecycle !== "DEMOLISHED") {
    throw new WorldUnavailableError(`building "${b.building_id}" has an unknown lifecycle`);
  }
  // Extra fields (provenance, created_at, future additions) are tolerated
  // and ignored — portable contract §16.
  return {
    building_id: b.building_id,
    asset_id: b.asset_id,
    grid_x: b.grid_x,
    grid_y: b.grid_y,
    orientation: b.orientation,
    lifecycle: b.lifecycle,
  };
}

export function parseWorldPayload(payload: unknown): TownWorldState {
  if (typeof payload !== "object" || payload === null) {
    throw new WorldUnavailableError("world payload is not an object");
  }
  const w = payload as Record<string, unknown>;
  if (w.world_version !== WORLD_VERSION) {
    throw new WorldUnavailableError(`unknown world_version ${String(w.world_version)}`);
  }
  if (w.layout_version !== LAYOUT_ID) {
    throw new WorldUnavailableError(`unknown layout_version ${String(w.layout_version)}`);
  }
  if (!isInt(w.revision) || w.revision < 0) {
    throw new WorldUnavailableError("world revision is not a non-negative integer");
  }
  if (!Array.isArray(w.buildings)) {
    throw new WorldUnavailableError("world buildings are not an array");
  }
  return {
    world_version: w.world_version,
    layout_version: w.layout_version,
    revision: w.revision,
    buildings: w.buildings.map(parseBuilding),
  };
}

export async function fetchWorld(fetchImpl: typeof fetch = fetch): Promise<TownWorldState> {
  let response: Response;
  try {
    response = await fetchImpl(WORLD_ENDPOINT);
  } catch {
    throw new WorldUnavailableError("world service unreachable");
  }
  if (!response.ok) {
    throw new WorldUnavailableError(`world service responded HTTP ${response.status}`);
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new WorldUnavailableError("world service returned malformed JSON");
  }
  return parseWorldPayload(payload);
}
