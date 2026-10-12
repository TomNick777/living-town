/**
 * World client tests — the transport layer between App and the local world
 * service. The client must parse honestly, tolerate unknown extra fields
 * (portable contract §16) and FAIL CLOSED on anything unexpected: a broken
 * service must surface as WorldUnavailableError, never as a silently
 * substituted seed world.
 */

import { describe, expect, it } from "vitest";
import { fetchWorld, parseWorldPayload, WorldUnavailableError } from "../src/town/world/client";
import { SEED_WORLD } from "../src/town/world/seedWorld";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("parseWorldPayload", () => {
  it("accepts the seed world document (the canonical shape)", () => {
    const parsed = parseWorldPayload(SEED_WORLD);
    expect(parsed.revision).toBe(1);
    expect(parsed.buildings).toHaveLength(4);
  });

  it("tolerates unknown extra fields and ignores provenance semantics", () => {
    const payload = {
      ...SEED_WORLD,
      future_field: { anything: true },
      buildings: SEED_WORLD.buildings.map((b) => ({ ...b, provenance: { source: "bootstrap-seed" }, extra: 1 })),
    };
    const parsed = parseWorldPayload(payload);
    expect(parsed.buildings[0].building_id).toBe(SEED_WORLD.buildings[0].building_id);
  });

  it("rejects an unknown world_version (fail closed)", () => {
    expect(() => parseWorldPayload({ ...SEED_WORLD, world_version: "town-world-v99" })).toThrow(WorldUnavailableError);
  });

  it("rejects an unknown layout_version", () => {
    expect(() => parseWorldPayload({ ...SEED_WORLD, layout_version: "living-town-block-v9" })).toThrow(
      WorldUnavailableError,
    );
  });

  it("rejects non-integer coordinates and unknown lifecycles", () => {
    const bad = {
      ...SEED_WORLD,
      buildings: [{ ...SEED_WORLD.buildings[0], grid_x: 1.5 }],
    };
    expect(() => parseWorldPayload(bad)).toThrow(/non-integer/);
    const haunted = {
      ...SEED_WORLD,
      buildings: [{ ...SEED_WORLD.buildings[0], lifecycle: "HAUNTED" }],
    };
    expect(() => parseWorldPayload(haunted)).toThrow(/lifecycle/);
  });

  it("rejects a non-array or missing buildings list", () => {
    expect(() => parseWorldPayload({ ...SEED_WORLD, buildings: "four" })).toThrow(WorldUnavailableError);
  });
});

describe("fetchWorld", () => {
  it("returns the parsed world on HTTP 200", async () => {
    const world = await fetchWorld(() => Promise.resolve(jsonResponse(SEED_WORLD)));
    expect(world.buildings).toHaveLength(4);
  });

  it("throws WorldUnavailableError when the network fails", async () => {
    await expect(fetchWorld(() => Promise.reject(new Error("down")))).rejects.toBeInstanceOf(WorldUnavailableError);
  });

  it("throws on non-200 with the status in the message", async () => {
    await expect(fetchWorld(() => Promise.resolve(jsonResponse({ ok: false }, 503)))).rejects.toThrow(/503/);
  });

  it("throws on malformed JSON", async () => {
    const broken = new Response("{not json", { status: 200, headers: { "Content-Type": "application/json" } });
    await expect(fetchWorld(() => Promise.resolve(broken))).rejects.toBeInstanceOf(WorldUnavailableError);
  });
});
