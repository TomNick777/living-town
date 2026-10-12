/**
 * Occupancy sample for the milestone report: event-only vs ambient city
 * on a sparse 13-event day (FOOD / TRANSPORT / SHOPPING / ENTERTAINMENT mix).
 */

import { describe, expect, it } from "vitest";
import {
  BASE_DAY_WALL_SECONDS,
  ReplayEngine,
  type ReplayRoutes,
  type TownEvent,
  type TownEventsDocument,
  type TownTarget,
} from "../src/town/replay/replayEngine";
import { TownWalkways } from "../src/showcase/town3d/townMap";

function event(overrides: Partial<TownEvent>): TownEvent {
  return {
    id: "te:x",
    transaction_id: 1,
    occurred_at: "2026-08-15T12:00:00+08:00",
    time_precision: "SECOND",
    time_of_day_seconds: 12 * 3600,
    presentation_time: false,
    type: "DINING",
    category_code: "FOOD",
    category_name: "餐饮美食",
    merchant: "sample",
    description: null,
    amount_minor: 2800,
    currency: "CNY",
    direction: "expense",
    target: "restaurant",
    behavior: "VISIT",
    intensity: 0.42,
    rule: "sample",
    transaction_type: "EXPENSE",
    schedule_seconds: 12 * 3600,
    ...overrides,
  };
}

const DAY: TownEvent[] = [
  event({ id: "te:1", transaction_id: 1, schedule_seconds: 8 * 3600, target: "cafe", type: "COFFEE" }),
  event({ id: "te:2", transaction_id: 2, schedule_seconds: 8.5 * 3600, target: "transit", behavior: "TRANSIT", type: "TRANSIT", category_code: "TRANSPORT" }),
  event({ id: "te:3", transaction_id: 3, schedule_seconds: 9 * 3600, target: "office", behavior: "CREDIT", type: "WORK", direction: "income", category_code: "SALARY" }),
  event({ id: "te:4", transaction_id: 4, schedule_seconds: 12 * 3600, target: "restaurant" }),
  event({ id: "te:5", transaction_id: 5, schedule_seconds: 12.2 * 3600, target: "restaurant", intensity: 0.8 }),
  event({ id: "te:6", transaction_id: 6, schedule_seconds: 12.4 * 3600, target: "supermarket", type: "GROCERY", category_code: "SHOPPING" }),
  event({ id: "te:7", transaction_id: 7, schedule_seconds: 13 * 3600, target: "transit", behavior: "TRANSIT", type: "TRANSIT", category_code: "TRANSPORT" }),
  event({ id: "te:8", transaction_id: 8, schedule_seconds: 18 * 3600, target: "leisure", type: "LEISURE", category_code: "ENTERTAINMENT" }),
  event({ id: "te:9", transaction_id: 9, schedule_seconds: 18.3 * 3600, target: "leisure", type: "LEISURE", category_code: "ENTERTAINMENT", intensity: 0.8 }),
  event({ id: "te:10", transaction_id: 10, schedule_seconds: 18.5 * 3600, target: "cafe", type: "COFFEE" }),
  event({ id: "te:11", transaction_id: 11, schedule_seconds: 19 * 3600, target: "logistics", behavior: "DELIVERY", type: "PARCEL", category_code: "SHOPPING" }),
  event({ id: "te:12", transaction_id: 12, schedule_seconds: 20 * 3600, target: "home", behavior: "PASSIVE", type: "HOUSEHOLD" }),
  event({ id: "te:13", transaction_id: 13, schedule_seconds: 21 * 3600, target: "clinic", type: "HEALTH", category_code: "HEALTH" }),
];

function documentFor(events: TownEvent[]): TownEventsDocument {
  return {
    projection_version: "town-events-v2",
    rules_version: "town-event-rules-v2",
    generated_at: "2026-09-01T00:00:00+00:00",
    month: "2026-08",
    days: [{ date: "2026-08-15", event_count: events.length, precise_time_count: events.length }],
    events,
  };
}

const eventOnlyRoutes: ReplayRoutes = {
  routeFor(target: TownTarget) {
    if (target === "unknown") return null;
    return { spawn: { x: 0, z: -10 }, path: [{ x: 0, z: 0 }, { x: 0, z: 2 }] };
  },
  routeForEvent(townEvent, index) {
    if (townEvent.behavior === "TRANSIT") {
      return { spawn: { x: -20, z: 15 }, path: [{ x: -10, z: 15 }, { x: 0, z: 15 }], mode: "through", role: "transit-passenger" };
    }
    if (townEvent.behavior === "DELIVERY") {
      return { spawn: { x: 5, z: 18 }, path: [{ x: 0, z: -10 }], role: "courier" };
    }
    return this.routeFor(townEvent.target, townEvent.transaction_id + index);
  },
};

function sample(routes: ReplayRoutes) {
  const replay = new ReplayEngine({ routes, baseWalkSpeed: 4, maxWalkSpeed: 9 });
  replay.loadDocument(documentFor(DAY));
  replay.selectDay("2026-08-15");
  replay.play();
  const step = 1 / 20;
  let samples = 0;
  let actorSum = 0;
  let ambientSum = 0;
  let peak = 0;
  let empty = 0;
  let busyPeak = 0;
  for (let t = 0; t < BASE_DAY_WALL_SECONDS; t += step) {
    replay.tick(step);
    const snap = replay.getSnapshot();
    const total = snap.actors.length + snap.ambientActors.length;
    samples += 1;
    actorSum += snap.actors.length;
    ambientSum += snap.ambientActors.length;
    if (total > peak) peak = total;
    if (total === 0) empty += 1;
    const busy = Object.values(snap.buildings).filter((b) => b.activityLevel === "BUSY").length;
    if (busy > busyPeak) busyPeak = busy;
  }
  return {
    avgEvent: actorSum / samples,
    avgAmbient: ambientSum / samples,
    avgTotal: (actorSum + ambientSum) / samples,
    peak,
    emptyRatio: empty / samples,
    busyPeak,
  };
}

describe("occupancy sample (sparse mixed day)", () => {
  it("keeps event-only days mostly empty, and ambient fills without bursting the cap", () => {
    const before = sample(eventOnlyRoutes);
    const after = sample(new TownWalkways());
    expect(before.avgTotal).toBeLessThan(1.5);
    expect(before.emptyRatio).toBeGreaterThan(0.5);
    expect(after.avgTotal).toBeGreaterThan(before.avgTotal);
    expect(after.emptyRatio).toBeLessThan(before.emptyRatio);
    expect(after.emptyRatio).toBeLessThan(0.2);
    expect(after.peak).toBeLessThanOrEqual(14);
    expect(after.avgAmbient).toBeGreaterThan(after.avgEvent);
    // eslint-disable-next-line no-console
    console.log("OCCUPANCY_SAMPLE", { before, after });
  });
});
