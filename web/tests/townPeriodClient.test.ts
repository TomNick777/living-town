import { describe, expect, it, vi } from "vitest";
import stable from "../../tests/fixtures/town-showcase/stable.json";
import { availableYearKeys, fetchTownPeriod } from "../src/town/world/townPeriodClient";
import { TownStateSourceError } from "../src/town/world/townStateClient";

describe("townPeriodClient", () => {
  it("parses town-period payload into replay document", async () => {
    const payload = {
      projection_version: "town-period-v1",
      rules_version: "town-event-rules-v2",
      town_events_version: "town-events-v2",
      generated_at: "2026-01-01T00:00:00Z",
      period: {
        kind: "month",
        key: "2026-01",
        start: "2026-01-01",
        end_exclusive: "2026-02-01",
        end_inclusive: "2026-01-31",
        available_months: ["2026-01"],
        months_with_data: ["2026-01"],
        date_coverage: { first: "2026-01-01", last: "2026-01-01" },
      },
      financial: {
        external_income_minor: 0,
        life_consumption_minor: 3600,
        energy_return_minor: 0,
        net_life_consumption_minor: 3600,
        investment_export_minor: 0,
        investment_export_count: 0,
        investment_import_minor: 0,
        net_storage_change_minor: -3600,
        internal_transfer_minor: 0,
        transfer_fee_minor: 0,
        unreconciled_minor: 0,
        identity_delta_minor: 0,
        balanced: true,
      },
      activity: {
        ledger_transaction_count: 1,
        town_event_count: 1,
        active_day_count: 1,
        active_dates: ["2026-01-01"],
        places: [{ target: "restaurant", count: 1 }],
        coverage: { total: 1, mapped: 1, unknown: 0, unknown_ratio: 0, unknown_by_category: [] },
      },
      months: [{ month: "2026-01", has_data: true, start: "2026-01-01", end: "2026-01-31" }],
      events: [{
        id: "te:1",
        transaction_id: 1,
        occurred_at: "2026-01-01T12:00:00+08:00",
        time_precision: "SECOND",
        time_of_day_seconds: 43200,
        presentation_time: true,
        type: "DINING",
        category_code: "FOOD",
        category_name: "餐饮",
        merchant: "食堂",
        description: null,
        amount_minor: 3600,
        currency: "CNY",
        direction: "expense",
        target: "restaurant",
        behavior: "VISIT",
        intensity: 0.5,
        rule: "category:FOOD->restaurant",
        transaction_type: "EXPENSE",
        schedule_seconds: 43200,
      }],
      days: [{ date: "2026-01-01", event_count: 1, precise_time_count: 1 }],
      presentation: {
        version: "town-period-presentation-v1",
        mode: "period_montage",
        montage_label: "2026-01",
        timeline_seconds: 86400,
        event_count: 1,
      },
      coverage: { total: 1, mapped: 1, unknown: 0, unknown_ratio: 0, unknown_by_category: [] },
    };
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => payload });
    const result = await fetchTownPeriod("2026-01", fetchImpl as unknown as typeof fetch);
    expect(result.document.presentation?.mode).toBe("period_montage");
    expect(result.document.events).toHaveLength(1);
  });

  it("lists distinct years from month keys", () => {
    expect(availableYearKeys(["2025-11", "2026-01", "2026-02"])).toEqual(["2025", "2026"]);
  });

  it("surfaces HTTP failures", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    await expect(fetchTownPeriod("2026", fetchImpl as unknown as typeof fetch)).rejects.toThrow(TownStateSourceError);
  });

  it("falls back to month town-state and town-events when town-period is missing", async () => {
    const month = "2026-01";
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("/api/town-period")) return { ok: false, status: 404 };
      if (url.includes("/api/months")) return { ok: true, json: async () => ({ months: [month] }) };
      if (url.includes("/api/town-state")) {
        return { ok: true, json: async () => ({ ...stable, period: { ...stable.period, month } }) };
      }
      return {
        ok: true,
        json: async () => ({
          projection_version: "town-events-v2",
          rules_version: "town-event-rules-v2",
          generated_at: "2026-01-01T00:00:00Z",
          month,
          days: [{ date: "2026-01-01", event_count: 1, precise_time_count: 1 }],
          events: [{
            id: "te:1",
            transaction_id: 1,
            occurred_at: "2026-01-01T12:00:00+08:00",
            time_precision: "SECOND",
            time_of_day_seconds: 43200,
            presentation_time: false,
            type: "DINING",
            category_code: "FOOD",
            category_name: "餐饮",
            merchant: "食堂",
            description: null,
            amount_minor: 100,
            currency: "CNY",
            direction: "expense",
            target: "restaurant",
            behavior: "VISIT",
            intensity: 0.5,
            rule: "category:FOOD->restaurant",
            transaction_type: "EXPENSE",
            schedule_seconds: 43200,
          }],
        }),
      };
    });
    const result = await fetchTownPeriod(month, fetchImpl as unknown as typeof fetch);
    expect(result.document.presentation?.mode).toBe("period_montage");
    expect(result.payload.financial.net_life_consumption_minor).toBe(stable.financial.net_life_consumption_minor);
  });
});
