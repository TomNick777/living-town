/**
 * TownEvents adapter + transport tests: fail-closed contract validation.
 * The browser must reject documents that would force it to interpret facts.
 * V2：behavior 字段必填；v1 文档按已发布语义规范化（schema 兼容）。
 */

import { describe, expect, it, vi } from "vitest";
import {
  SUPPORTED_TOWN_EVENTS_VERSIONS,
  validateTownEvents,
  type TownBehavior,
  type TownEventsDocument,
} from "../src/town/adapter/townEvents";
import { fetchTownEvents, townEventsUrl } from "../src/town/world/townEventsClient";
import { TownStateSourceError } from "../src/town/world/townStateClient";

function validDocument(version: (typeof SUPPORTED_TOWN_EVENTS_VERSIONS)[number] = "town-events-v2"): TownEventsDocument {
  return {
    projection_version: version,
    rules_version: version === "town-events-v2" ? "town-event-rules-v2" : "town-event-rules-v1",
    generated_at: "2026-09-01T00:00:00+00:00",
    month: "2026-07",
    coverage: {
      total: 1,
      mapped: 1,
      unknown: 0,
      unknown_ratio: 0,
      unknown_by_category: [],
    },
    days: [{ date: "2026-07-12", event_count: 1, precise_time_count: 1 }],
    events: [
      {
        id: "te:1",
        transaction_id: 1,
        occurred_at: "2026-07-12T12:20:00+08:00",
        time_precision: "SECOND",
        time_of_day_seconds: 44400,
        presentation_time: false,
        type: "DINING",
        category_code: "FOOD",
        category_name: "餐饮美食",
        merchant: "麦当劳",
        description: null,
        amount_minor: 3600,
        currency: "CNY",
        direction: "expense",
        target: "restaurant",
        behavior: "VISIT",
        intensity: 0.4231,
        rule: "category:FOOD->restaurant",
        transaction_type: "EXPENSE",
        schedule_seconds: 44400,
      },
    ],
  };
}

describe("town events adapter (v2)", () => {
  it("accepts a valid v2 document with behavior and coverage", () => {
    const document = validateTownEvents(validDocument());
    expect(document.events).toHaveLength(1);
    expect(document.events[0].target).toBe("restaurant");
    expect(document.events[0].behavior).toBe("VISIT");
    expect(document.coverage?.mapped).toBe(1);
  });

  it("rejects unsupported projection versions", () => {
    const payload = { ...validDocument(), projection_version: "town-events-v9" };
    expect(() => validateTownEvents(payload)).toThrow(/projection_version/);
  });

  it("rejects v2 events without a behavior field", () => {
    const payload = validDocument();
    delete (payload.events[0] as { behavior?: string }).behavior;
    expect(() => validateTownEvents(payload)).toThrow(/behavior/);
  });

  it("rejects behavior values outside the closed vocabulary", () => {
    const payload = validDocument();
    (payload.events[0] as { behavior: string }).behavior = "TELEPORT";
    expect(() => validateTownEvents(payload)).toThrow(/behavior/);
  });

  it("validates the coverage block when present", () => {
    const payload = validDocument();
    (payload.coverage as { unknown_ratio: number }).unknown_ratio = 1.5;
    expect(() => validateTownEvents(payload)).toThrow(/unknown_ratio/);
  });

  it("rejects unknown targets (the renderer must not invent places)", () => {
    const payload = validDocument();
    (payload.events[0] as { target: string }).target = "airport";
    expect(() => validateTownEvents(payload)).toThrow(/target/);
  });

  it("rejects out-of-range intensity and non-integer amounts", () => {
    expect(() =>
      validateTownEvents({ ...validDocument(), events: [{ ...validDocument().events[0], intensity: 1.5 }] }),
    ).toThrow(/intensity/);
    expect(() =>
      validateTownEvents({ ...validDocument(), events: [{ ...validDocument().events[0], amount_minor: 3.6 }] }),
    ).toThrow(/amount_minor/);
  });
});

describe("town events adapter (v1 compatibility)", () => {
  it("accepts a v1 document and fills behavior from published v1 semantics", () => {
    const payload = validDocument("town-events-v1") as TownEventsDocument & { coverage?: unknown };
    delete payload.coverage; // v1 没有 coverage 块
    delete (payload.events[0] as { behavior?: string }).behavior;
    const document = validateTownEvents(payload);
    expect(document.projection_version).toBe("town-events-v1");
    expect(document.coverage).toBeUndefined();
    expect(document.events[0].behavior).toBe("VISIT"); // DINING -> VISIT
  });

  it("normalizes v1 SALARY / PARCEL / HOUSEHOLD to CREDIT / DELIVERY / VISIT", () => {
    const base = validDocument("town-events-v1");
    const events = [
      { ...base.events[0], id: "te:w", transaction_id: 11, type: "WORK" as const, target: "office" as const, direction: "income" as const, behavior: undefined },
      { ...base.events[0], id: "te:p", transaction_id: 12, type: "PARCEL" as const, target: "logistics" as const, behavior: undefined },
      { ...base.events[0], id: "te:h", transaction_id: 13, type: "HOUSEHOLD" as const, target: "home" as const, behavior: undefined },
      { ...base.events[0], id: "te:u", transaction_id: 14, type: "UNKNOWN" as const, target: "unknown" as const, behavior: undefined },
    ].map((event) => {
      const { behavior: _dropped, ...rest } = event;
      void _dropped;
      return rest;
    });
    const behaviors = validateTownEvents({ ...base, events }).events.map((event) => event.behavior);
    expect(behaviors).toEqual<TownBehavior[]>(["CREDIT", "DELIVERY", "VISIT", "UNKNOWN"]);
  });

  it("keeps an explicit v1 behavior when the payload already carries one", () => {
    const payload = validDocument("town-events-v1");
    (payload.events[0] as { behavior: string }).behavior = "VISIT";
    expect(validateTownEvents(payload).events[0].behavior).toBe("VISIT");
  });
});

describe("town events client", () => {
  it("requests the month endpoint and validates the payload", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(validDocument()), { status: 200 }),
    );
    const document = await fetchTownEvents("2026-07", fetchImpl);
    expect(document.month).toBe("2026-07");
    expect(fetchImpl).toHaveBeenCalledWith(townEventsUrl("2026-07"));
    expect(townEventsUrl("2026-07")).toBe("/api/town-events?month=2026-07");
  });

  it("fails closed on unreachable service or malformed payload", async () => {
    await expect(fetchTownEvents("2026-07", vi.fn().mockRejectedValue(new Error("down")))).rejects.toBeInstanceOf(
      TownStateSourceError,
    );
    await expect(
      fetchTownEvents("2026-07", vi.fn().mockResolvedValue(new Response("{}", { status: 200 }))),
    ).rejects.toBeInstanceOf(TownStateSourceError);
    await expect(fetchTownEvents("2026-7", vi.fn())).rejects.toBeInstanceOf(TownStateSourceError);
  });
});
