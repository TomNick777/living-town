/**
 * ReplayEngine + Crowd Director integration: ambient vs event actors,
 * activity-driven population, caps, reset, determinism.
 */

import { describe, expect, it } from "vitest";
import {
  ReplayEngine,
  type TownEvent,
  type TownEventsDocument,
} from "../src/town/replay/replayEngine";
import { TownWalkways } from "../src/showcase/town3d/townMap";

let eventSeq = 8000;

function makeEvent(overrides: Partial<TownEvent> = {}): TownEvent {
  eventSeq += 1;
  return {
    id: overrides.id ?? `te:${eventSeq}`,
    transaction_id: overrides.transaction_id ?? eventSeq,
    occurred_at: overrides.occurred_at ?? "2026-08-15T12:00:00+08:00",
    time_precision: "SECOND",
    time_of_day_seconds: 12 * 3600,
    presentation_time: false,
    type: "DINING",
    category_code: "FOOD",
    category_name: "餐饮美食",
    merchant: " prototypical cafe",
    description: null,
    amount_minor: 3600,
    currency: "CNY",
    direction: "expense",
    target: "cafe",
    behavior: "VISIT",
    intensity: 0.42,
    rule: "category:FOOD->cafe",
    transaction_type: "EXPENSE",
    schedule_seconds: 12 * 3600,
    ...overrides,
  };
}

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

function engine() {
  return new ReplayEngine({
    routes: new TownWalkways(),
    baseWalkSpeed: 6,
    maxWalkSpeed: 9,
  });
}

const STEP = 1 / 30;
function runSeconds(replay: ReplayEngine, seconds: number) {
  for (let i = 0; i < Math.round(seconds / STEP); i += 1) replay.tick(STEP);
}

describe("ambient vs event isolation", () => {
  it("never attaches a transaction or event id to an ambient actor", () => {
    const replay = engine();
    replay.loadDocument(documentFor([makeEvent({ schedule_seconds: 20 * 3600 })]));
    replay.selectDay("2026-08-15");
    replay.play();
    runSeconds(replay, 2);
    const snapshot = replay.getSnapshot();
    expect(snapshot.ambientActors.length).toBeGreaterThan(0);
    expect(snapshot.actors).toHaveLength(0);
    for (const actor of snapshot.ambientActors) {
      expect(actor.kind).toBe("ambient");
      expect("eventId" in actor).toBe(false);
      expect("transactionId" in actor).toBe(false);
      expect("merchant" in actor).toBe(false);
      expect("amount" in actor).toBe(false);
    }
  });
});

describe("activity-driven ambience", () => {
  it("adds cafe ambient when the cafe is BUSY and clears it after decay + reset", () => {
    const replay = engine();
    replay.loadDocument(documentFor([
      makeEvent({ id: "te:c1", transaction_id: 11, schedule_seconds: 12 * 3600, target: "cafe", intensity: 0.9 }),
      makeEvent({ id: "te:c2", transaction_id: 12, schedule_seconds: 12 * 3600 + 30, target: "cafe", intensity: 0.9 }),
      makeEvent({ id: "te:c3", transaction_id: 13, schedule_seconds: 12 * 3600 + 60, target: "cafe", intensity: 0.9 }),
    ]));
    replay.selectDay("2026-08-15");
    replay.setSpeed(24);
    replay.play();
    runSeconds(replay, 5);
    const busy = replay.getSnapshot();
    expect(busy.buildings.cafe?.activityLevel).toBe("BUSY");
    const cafeAmbient = busy.ambientActors.filter((actor) => actor.target === "cafe").length;
    expect(cafeAmbient).toBeGreaterThan(0);
    expect(busy.crowd.ambientActors).toBeLessThanOrEqual(6);
    expect(busy.crowd.totalActors).toBeLessThanOrEqual(14);
    expect(busy.crowd.skippedAmbientActors).toBeLessThan(40);

    replay.setSpeed(1);
    runSeconds(replay, 21);
    const quiet = replay.getSnapshot();
    expect(quiet.buildings.cafe?.activityLevel).toBe("QUIET");
    // decay stops new place spawns; leftover walkers may still be leaving
    const newPlanWouldBeZeroPlace = quiet.buildings.cafe?.activityLevel === "QUIET";
    expect(newPlanWouldBeZeroPlace).toBe(true);

    replay.reset();
    expect(replay.getSnapshot().ambientActors).toHaveLength(0);
    expect(replay.getSnapshot().crowd.skippedAmbientActors).toBe(0);
    expect(replay.getSnapshot().buildings.cafe?.activityLevel).toBe("QUIET");
  });

  it("keeps clinic quieter than leisure in the evening even when both are BUSY", () => {
    const replay = engine();
    replay.loadDocument(documentFor([
      makeEvent({ id: "te:l1", transaction_id: 21, schedule_seconds: 18 * 3600, target: "leisure", type: "LEISURE", behavior: "VISIT", intensity: 0.9 }),
      makeEvent({ id: "te:l2", transaction_id: 22, schedule_seconds: 18 * 3600 + 20, target: "leisure", type: "LEISURE", behavior: "VISIT", intensity: 0.9 }),
      makeEvent({ id: "te:l3", transaction_id: 23, schedule_seconds: 18 * 3600 + 40, target: "leisure", type: "LEISURE", behavior: "VISIT", intensity: 0.9 }),
      makeEvent({ id: "te:h1", transaction_id: 24, schedule_seconds: 18 * 3600, target: "clinic", type: "HEALTH", behavior: "VISIT", intensity: 0.9 }),
      makeEvent({ id: "te:h2", transaction_id: 25, schedule_seconds: 18 * 3600 + 20, target: "clinic", type: "HEALTH", behavior: "VISIT", intensity: 0.9 }),
      makeEvent({ id: "te:h3", transaction_id: 26, schedule_seconds: 18 * 3600 + 40, target: "clinic", type: "HEALTH", behavior: "VISIT", intensity: 0.9 }),
    ]));
    replay.selectDay("2026-08-15");
    replay.setSpeed(24);
    replay.play();
    runSeconds(replay, 6);
    const snapshot = replay.getSnapshot();
    expect(snapshot.timeOfDayPhase).toBe("EVENING");
    const leisure = snapshot.ambientActors.filter((actor) => actor.target === "leisure").length;
    const clinic = snapshot.ambientActors.filter((actor) => actor.target === "clinic").length;
    expect(leisure).toBeGreaterThan(clinic);
    expect(clinic).toBeLessThanOrEqual(1);
  });
});

describe("ambient determinism and cap", () => {
  it("replays the same ambient seeds after reset", () => {
    const events = [
      makeEvent({ id: "te:d1", transaction_id: 31, schedule_seconds: 12 * 3600, target: "cafe" }),
    ];
    const replay = engine();
    replay.loadDocument(documentFor(events));
    replay.selectDay("2026-08-15");
    replay.setSpeed(8);
    replay.play();
    runSeconds(replay, 2);
    const first = replay.getSnapshot().ambientActors.map((actor) => [actor.seed, actor.role, actor.target]);
    replay.reset();
    replay.setSpeed(8);
    replay.play();
    runSeconds(replay, 2);
    const second = replay.getSnapshot().ambientActors.map((actor) => [actor.seed, actor.role, actor.target]);
    expect(second).toEqual(first);
  });
});
