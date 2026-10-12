/**
 * Command transport tests — POST /api/commands client behavior: envelope
 * serialization, full-world success parsing, stable error codes surfaced
 * untouched, and transport failures as WorldUnavailableError.
 */

import { describe, expect, it } from "vitest";
import { sendCommand, WorldCommandRejectedError } from "../src/town/world/commands";
import { WorldUnavailableError } from "../src/town/world/client";
import { SEED_WORLD } from "../src/town/world/seedWorld";

function okWorldResponse(body: unknown): Response {
  const world = body as { revision: number };
  return new Response(JSON.stringify({ ok: true, world: body, revision: world.revision }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("sendCommand", () => {
  it("POSTs a JSON envelope to /api/commands and parses the returned world", async () => {
    const calls: { input: string; init: RequestInit }[] = [];
    const world = await sendCommand(
      { type: "CreateBuilding", expected_revision: 1, asset_id: "cafe", grid_x: 5, grid_y: 1 },
      async (input, init) => {
        calls.push({ input: String(input), init: init ?? {} });
        return okWorldResponse({ ...SEED_WORLD, revision: 2 });
      },
    );
    expect(calls).toHaveLength(1);
    const headers = new Headers(calls[0].init.headers);
    expect(calls[0].input).toBe("/api/commands");
    expect(calls[0].init.method).toBe("POST");
    expect(headers.get("Content-Type")).toBe("application/json");
    const sent = JSON.parse(String(calls[0].init.body));
    expect(sent).toEqual({ type: "CreateBuilding", expected_revision: 1, asset_id: "cafe", grid_x: 5, grid_y: 1 });
    expect(world.revision).toBe(2);
    expect(world.buildings).toHaveLength(4);
  });

  it("surfaces stable error codes with their detail (VERSION_CONFLICT carries current_revision)", async () => {
    const rejection = async () =>
      sendCommand({ type: "MoveBuilding", expected_revision: 1, building_id: "x", grid_x: 1, grid_y: 1 }, async () =>
        new Response(
          JSON.stringify({
            ok: false,
            error: "VERSION_CONFLICT",
            message: "world moved on: expected revision 1, current is 7",
            detail: { expected_revision: 1, current_revision: 7 },
          }),
          { status: 409, headers: { "Content-Type": "application/json" } },
        ),
      );
    await expect(rejection()).rejects.toMatchObject({
      code: "VERSION_CONFLICT",
      detail: { current_revision: 7 },
    });
  });

  it("surfaces COLLISION rejections untouched", async () => {
    const attempt = () =>
      sendCommand({ type: "CreateBuilding", expected_revision: 1, asset_id: "cafe", grid_x: 6, grid_y: 0 }, async () =>
        new Response(
          JSON.stringify({ ok: false, error: "COLLISION", message: "cannot place", detail: { source: "static" } }),
          { status: 409, headers: { "Content-Type": "application/json" } },
        ),
      );
    await expect(attempt()).rejects.toBeInstanceOf(WorldCommandRejectedError);
    await expect(attempt()).rejects.toMatchObject({ code: "COLLISION" });
  });

  it("network failure and non-JSON responses are WorldUnavailableError (fail closed)", async () => {
    await expect(
      sendCommand({ type: "DemolishBuilding", expected_revision: 1, building_id: "x" }, async () => {
        throw new Error("down");
      }),
    ).rejects.toBeInstanceOf(WorldUnavailableError);
    await expect(
      sendCommand({ type: "DemolishBuilding", expected_revision: 1, building_id: "x" }, async () =>
        new Response("{not json", { status: 500 }),
      ),
    ).rejects.toBeInstanceOf(WorldUnavailableError);
  });

  it("an ok:false body with no error code is a transport failure, not a crash", async () => {
    await expect(
      sendCommand({ type: "DemolishBuilding", expected_revision: 1, building_id: "x" }, async () =>
        new Response(JSON.stringify({ ok: false }), { status: 500 }),
      ),
    ).rejects.toBeInstanceOf(WorldUnavailableError);
  });
});
