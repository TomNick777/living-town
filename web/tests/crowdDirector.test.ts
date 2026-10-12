/**
 * Crowd Director: ambient population is presentation state derived from
 * activityLevel, time of day and a global budget. It never carries a
 * transaction id or merchant.
 */

import { describe, expect, it } from "vitest";
import type { ActivityLevel, TownTarget } from "../src/town/replay/replayEngine";
import {
  DEFAULT_MAX_AMBIENT_ACTORS,
  desiredPlaceAmbient,
  desiredStreetAmbient,
  planAmbientSpawns,
  type CrowdDirectorInput,
} from "../src/town/replay/crowdDirector";
import { timeOfDayPhase } from "../src/town/replay/timeOfDay";

function buildings(
  levels: Partial<Record<TownTarget, ActivityLevel>>,
): CrowdDirectorInput["buildings"] {
  return new Map(
    (Object.entries(levels) as [TownTarget, ActivityLevel][]).map(([target, activityLevel]) => [
      target,
      { target, activityLevel },
    ]),
  );
}

function input(overrides: Partial<CrowdDirectorInput> = {}): CrowdDirectorInput {
  return {
    clockSeconds: 13 * 3600,
    wallNow: 40,
    day: "2026-08-15",
    buildings: buildings({ restaurant: "QUIET" }),
    eventActorCount: 0,
    ambientActors: [],
    skippedAmbientActors: 0,
    ...overrides,
  };
}

describe("place-specific ambient demand", () => {
  it("spawns nobody at a QUIET building", () => {
    for (const target of ["restaurant", "cafe", "supermarket", "transit", "clinic", "leisure", "logistics", "office", "home"] as TownTarget[]) {
      expect(desiredPlaceAmbient(target, "QUIET", "DAY"), target).toBe(0);
    }
  });

  it("keeps NORMAL at 0–1 and BUSY at 1–2, with clinic quieter than leisure/transit", () => {
    expect(desiredPlaceAmbient("restaurant", "NORMAL", "DAY")).toBeLessThanOrEqual(1);
    expect(desiredPlaceAmbient("cafe", "BUSY", "EVENING")).toBeGreaterThanOrEqual(1);
    expect(desiredPlaceAmbient("cafe", "BUSY", "EVENING")).toBeLessThanOrEqual(2);
    expect(desiredPlaceAmbient("clinic", "BUSY", "DAY")).toBeLessThan(
      desiredPlaceAmbient("leisure", "BUSY", "EVENING"),
    );
    expect(desiredPlaceAmbient("clinic", "BUSY", "DAY")).toBeLessThanOrEqual(1);
    expect(desiredPlaceAmbient("supermarket", "BUSY", "DAY")).toBeLessThanOrEqual(1);
    expect(desiredPlaceAmbient("home", "BUSY", "DAY")).toBeLessThanOrEqual(1);
    expect(desiredPlaceAmbient("logistics", "BUSY", "DAY")).toBeLessThanOrEqual(1);
    expect(desiredPlaceAmbient("office", "BUSY", "NIGHT")).toBe(0);
    expect(desiredPlaceAmbient("office", "NORMAL", "MORNING")).toBeGreaterThan(0);
    expect(desiredPlaceAmbient("leisure", "NORMAL", "EVENING")).toBeGreaterThan(
      desiredPlaceAmbient("leisure", "NORMAL", "MORNING"),
    );
    expect(desiredPlaceAmbient("transit", "BUSY", "MORNING")).toBeGreaterThanOrEqual(1);
  });
});

describe("street ambient demand", () => {
  it("keeps a light trickle even when nowhere is BUSY, and never floods at night", () => {
    expect(desiredStreetAmbient("DAY", false)).toBeGreaterThan(0);
    expect(desiredStreetAmbient("NIGHT", false)).toBeLessThanOrEqual(1);
    expect(desiredStreetAmbient("MORNING", true)).toBeGreaterThanOrEqual(
      desiredStreetAmbient("NIGHT", true),
    );
  });
});

describe("planAmbientSpawns", () => {
  it("does not invent place ambient for a fully QUIET city beyond the street trickle", () => {
    const plan = planAmbientSpawns(input({
      clockSeconds: 13 * 3600,
      buildings: buildings({
        restaurant: "QUIET", cafe: "QUIET", supermarket: "QUIET",
        transit: "QUIET", clinic: "QUIET", leisure: "QUIET",
        logistics: "QUIET", office: "QUIET", home: "QUIET",
      }),
    }));
    expect(plan.spawns.every((spawn) => spawn.kind === "street")).toBe(true);
    expect(plan.spawns.length).toBeLessThanOrEqual(desiredStreetAmbient("DAY", false));
  });

  it("adds place ambient when a building is BUSY and respects the global cap", () => {
    const plan = planAmbientSpawns(input({
      clockSeconds: 18 * 3600,
      eventActorCount: 8,
      buildings: buildings({
        cafe: "BUSY",
        leisure: "BUSY",
        transit: "BUSY",
        restaurant: "BUSY",
        supermarket: "BUSY",
      }),
    }));
    expect(plan.spawns.some((spawn) => spawn.kind === "place" && spawn.target === "cafe")).toBe(true);
    expect(plan.spawns.length).toBeLessThanOrEqual(DEFAULT_MAX_AMBIENT_ACTORS);
    expect(plan.spawns.every((spawn) => spawn.eventId === null)).toBe(true);
    expect(plan.spawns.every((spawn) => spawn.transactionId === undefined)).toBe(true);
  });

  it("uses courier-like staff at logistics and transit-passenger at the hub", () => {
    const plan = planAmbientSpawns(input({
      clockSeconds: 8 * 3600,
      buildings: buildings({ logistics: "BUSY", transit: "BUSY" }),
    }));
    const logistics = plan.spawns.find((spawn) => spawn.target === "logistics");
    const transit = plan.spawns.find((spawn) => spawn.target === "transit");
    expect(logistics?.role).toBe("courier");
    expect(transit?.role).toBe("transit-passenger");
  });

  it("is deterministic for the same day, clock bucket and occupancy", () => {
    const first = planAmbientSpawns(input({ clockSeconds: 12 * 3600 + 10, buildings: buildings({ cafe: "BUSY" }) }));
    const second = planAmbientSpawns(input({ clockSeconds: 12 * 3600 + 40, buildings: buildings({ cafe: "BUSY" }) }));
    expect(second.spawns.map((spawn) => spawn.seed)).toEqual(first.spawns.map((spawn) => spawn.seed));
  });

  it("does not spawn more place ambient than still needed", () => {
    const existing = [{
      id: 1,
      kind: "ambient" as const,
      role: "visitor" as const,
      target: "cafe" as TownTarget,
      streetKind: null,
      phase: "DWELLING" as const,
    }];
    const plan = planAmbientSpawns(input({
      clockSeconds: 18 * 3600,
      buildings: buildings({ cafe: "NORMAL" }),
      ambientActors: existing,
    }));
    expect(plan.spawns.filter((spawn) => spawn.target === "cafe")).toHaveLength(0);
  });
});

describe("time phase is presentation rhythm", () => {
  it("reads morning / evening from the replay clock, not a user schedule", () => {
    expect(timeOfDayPhase(7 * 3600)).toBe("MORNING");
    expect(timeOfDayPhase(19 * 3600 + 30)).toBe("EVENING");
  });
});
