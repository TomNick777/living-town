import { describe, expect, it, vi } from "vitest";
import bundle from "../public/demo/ledger.json";
import { createDemoTransport } from "../src/showcase/demoSource";
import { fetchAvailableMonths, fetchTownState } from "../src/town/world/townStateClient";
import { fetchTownPeriod } from "../src/town/world/townPeriodClient";
import { fetchLedgerBoard, fetchLedgerReview } from "../src/town/world/ledgerClient";

function transport() {
  const network = vi.fn<typeof fetch>().mockResolvedValue(Response.json(bundle));
  return { network, demo: createDemoTransport(network, "/living-town/") };
}

describe("public synthetic transport", () => {
  it("serves every view from one subpath-safe snapshot without any API network call", async () => {
    const { demo, network } = transport();
    const months = await fetchAvailableMonths(demo);
    const month = months.at(-1)!;
    const state = await fetchTownState(month, demo);
    const period = await fetchTownPeriod(month, demo);
    const board = await fetchLedgerBoard(month, demo);
    const year = await fetchTownPeriod("2026", demo);
    expect(period.payload.financial).toEqual(state.financial);
    expect(board.series.at(-1)?.net_life_consumption_minor).toBe(state.financial.net_life_consumption_minor);
    expect(year.payload.period.months_with_data).toEqual(months);
    expect(network).toHaveBeenCalledTimes(1);
    expect(network).toHaveBeenCalledWith("/living-town/demo/ledger.json");
  });

  it("filters and paginates rows without modifying original full-month counts", async () => {
    const { demo } = transport();
    const original = JSON.stringify(bundle);
    const first = await fetchLedgerReview({ month: "2026-09", limit: 25 }, demo);
    const next = await fetchLedgerReview({ month: "2026-09", limit: 25, offset: 25 }, demo);
    expect(first.transactions).toHaveLength(25);
    expect(next.transactions).toHaveLength(25);
    expect(first.transactions.map(row => row.transaction_id)).not.toContain(next.transactions[0].transaction_id);
    const filtered = await fetchLedgerReview({ month: "2026-09", type: "EXPENSE", q: "咖啡" }, demo);
    expect(filtered.transactions.length).toBeGreaterThan(0);
    expect(filtered.transactions.every(row => row.transaction_type === "EXPENSE" && row.counterparty?.includes("咖啡"))).toBe(true);
    const pending = await fetchLedgerReview({ month: "2026-09", bucket: "pending" }, demo);
    expect(pending.transactions.every(row => row.flags.length > 0)).toBe(true);
    expect(pending.type_counts).toEqual(first.type_counts);
    expect(JSON.stringify(bundle)).toBe(original);
  });

  it("fails on absent or mislabeled data and retries a failed snapshot load", async () => {
    const { demo } = transport();
    await expect(fetchTownState("2030-01", demo)).rejects.toThrow("HTTP 404");
    const bad = createDemoTransport(vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ...bundle, synthetic: false })));
    await expect(fetchAvailableMonths(bad)).rejects.toThrow();
    const network = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(Response.json(bundle));
    const retry = createDemoTransport(network);
    await expect(fetchAvailableMonths(retry)).rejects.toThrow();
    expect(await fetchAvailableMonths(retry)).toHaveLength(6);
    expect(network).toHaveBeenCalledTimes(2);
  });
});
