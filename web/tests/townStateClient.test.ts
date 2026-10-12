import { describe, expect, it, vi } from "vitest";
import {
  fetchAvailableMonths,
  fetchTownState,
  TownStateSourceError,
  townStateUrl,
} from "../src/town/world/townStateClient";
import stable from "../../tests/fixtures/town-showcase/stable.json";

function ok(payload: unknown) {
  return Promise.resolve(new Response(JSON.stringify(payload), { status: 200 }));
}

describe("town state client", () => {
  it("returns months ascending as served, empty list stays empty", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok({ months: ["2025-12", "2026-01"] }));
    await expect(fetchAvailableMonths(fetchImpl as unknown as typeof fetch)).resolves.toEqual(["2025-12", "2026-01"]);
    fetchImpl.mockResolvedValue(ok({ months: [] }));
    await expect(fetchAvailableMonths(fetchImpl as unknown as typeof fetch)).resolves.toEqual([]);
  });

  it("fails closed on every malformed months payload", async () => {
    for (const payload of [{}, { months: "2026-08" }, { months: [202608] }, { months: ["2026-8"] }, { months: [null] }]) {
      const fetchImpl = vi.fn().mockResolvedValue(ok(payload));
      await expect(fetchAvailableMonths(fetchImpl as unknown as typeof fetch)).rejects.toThrow(TownStateSourceError);
    }
  });

  it("fails closed on network error, non-200, and malformed JSON", async () => {
    const network = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    await expect(fetchAvailableMonths(network as unknown as typeof fetch)).rejects.toThrow("ledger service unreachable");
    const status = vi.fn().mockResolvedValue(new Response("nope", { status: 503 }));
    await expect(fetchAvailableMonths(status as unknown as typeof fetch)).rejects.toThrow("HTTP 503");
    const broken = vi.fn().mockResolvedValue(ok("not-json-object-later"));
    await expect(fetchTownState("2026-08", broken as unknown as typeof fetch)).rejects.toThrow(
      TownStateSourceError,
    );
  });

  it("requests the documented endpoint and validates a real projection shape", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok(stable));
    const state = await fetchTownState("2026-08", fetchImpl as unknown as typeof fetch);
    expect(fetchImpl.mock.calls[0][0]).toBe(townStateUrl("2026-08"));
    expect(state.period.month).toBe(stable.period.month);
    expect(state.projection_version).toBe("living-town-v1");
  });

  it("rejects contract-violating town states and malformed month arguments", async () => {
    const bad = { ...stable, projection_version: "living-town-v2" };
    const fetchImpl = vi.fn().mockResolvedValue(ok(bad));
    await expect(fetchTownState("2026-08", fetchImpl as unknown as typeof fetch)).rejects.toThrow(
      /violates the contract/,
    );
    await expect(fetchTownState("2026/08", vi.fn() as unknown as typeof fetch)).rejects.toThrow(/YYYY-MM/);
  });
});
