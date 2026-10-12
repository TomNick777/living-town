/**
 * World command transport — web's single write channel.
 *
 * Mirrors the single-command-endpoint protocol (functional baseline §8/§9):
 * POST /api/commands with {type, expected_revision, ...data}. There are no
 * REST resources and no DELETE. Success returns the FULL new world; failure
 * returns a stable error code which this client surfaces untouched — the
 * UI decides how to present it, and on VERSION_CONFLICT must re-fetch the
 * world instead of blindly overwriting (optimistic concurrency).
 */

import { fetchWorld, WorldUnavailableError, parseWorldPayload } from "./client";
import type { TownWorldState } from "./types";

export const COMMANDS_ENDPOINT = "/api/commands";

export type CommandType = "CreateBuilding" | "MoveBuilding" | "ChangeBuildingAsset" | "DemolishBuilding";

export interface CommandEnvelope {
  type: CommandType;
  expected_revision: number;
  /** Command fields (asset_id / grid_x / grid_y / orientation / building_id). */
  [field: string]: unknown;
}

export class WorldCommandRejectedError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly detail: Record<string, unknown>,
  ) {
    super(`${code}: ${message}`);
    this.name = "WorldCommandRejectedError";
  }
}

export async function sendCommand(
  command: CommandEnvelope,
  fetchImpl: typeof fetch = fetch,
): Promise<TownWorldState> {
  let response: Response;
  try {
    response = await fetchImpl(COMMANDS_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(command),
    });
  } catch {
    throw new WorldUnavailableError("world service unreachable");
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new WorldUnavailableError("world service returned malformed JSON");
  }
  const body = payload as Record<string, unknown>;
  if (response.ok && body.ok === true) {
    return parseWorldPayload(body.world);
  }
  if (typeof body.error === "string") {
    throw new WorldCommandRejectedError(
      body.error,
      String(body.message ?? ""),
      (body.detail ?? {}) as Record<string, unknown>,
    );
  }
  throw new WorldUnavailableError(`world service responded HTTP ${response.status}`);
}

/** Convenience: refresh after VERSION_CONFLICT (never blind-overwrite). */
export { fetchWorld, WorldUnavailableError };
