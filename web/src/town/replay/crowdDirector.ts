/**
 * Crowd Director — presentation-only ambient population.
 *
 * Event actors are TownEvent-driven and live in ReplayEngine. This module
 * never sees transactionId / merchant / amount. It only answers:
 * "given activityLevel, time of day and the current budget, who else
 * should be visible so the city does not look abandoned?"
 *
 * Renderer must not call this. ReplayEngine asks; Three.js only draws.
 */

import type { ActivityLevel, ActorPhase, ActorRole, TownTarget } from "./replayEngine";
import { hash32 } from "./eventPresence";
import { timeOfDayPhase, type TimeOfDayPhase } from "./timeOfDay";

export const DEFAULT_MAX_EVENT_ACTORS = 8;
export const DEFAULT_MAX_AMBIENT_ACTORS = 6;
export const DEFAULT_MAX_TOTAL_ACTORS = 14;

export type AmbientKind = "place" | "street";
export type AmbientStreetKind = "north-street" | "promenade" | "bridge-a-south" | "bridge-b-north";

export interface AmbientOccupant {
  id: number;
  kind: "ambient";
  role: ActorRole;
  target: TownTarget | null;
  streetKind: AmbientStreetKind | null;
  phase: ActorPhase;
}

export interface AmbientSpawnIntent {
  seed: string;
  kind: AmbientKind;
  role: ActorRole;
  target: TownTarget | null;
  streetKind: AmbientStreetKind | null;
  dwellWall: number;
  eventId: null;
  transactionId?: undefined;
}

export interface CrowdDirectorInput {
  clockSeconds: number;
  wallNow: number;
  day: string | null;
  buildings: ReadonlyMap<string, { target: TownTarget; activityLevel: ActivityLevel }>;
  eventActorCount: number;
  ambientActors: readonly AmbientOccupant[];
  skippedAmbientActors: number;
}

export interface CrowdDirectorPlan {
  spawns: AmbientSpawnIntent[];
  skipped: number;
  timeOfDayPhase: TimeOfDayPhase;
}

const PLACE_TARGETS: TownTarget[] = [
  "restaurant", "cafe", "supermarket", "transit", "clinic",
  "leisure", "logistics", "office", "home",
];

const STREET_KINDS: AmbientStreetKind[] = [
  "north-street", "promenade", "bridge-a-south", "bridge-b-north",
];

/** 8 minutes of replay-day time: spawn slots stay stable inside a bucket. */
export const AMBIENT_BUCKET_SECONDS = 8 * 60;

export function desiredPlaceAmbient(
  target: TownTarget,
  activity: ActivityLevel,
  phase: TimeOfDayPhase,
): number {
  if (target === "unknown" || activity === "QUIET") return 0;

  const busy = activity === "BUSY";
  switch (target) {
    case "clinic":
      if (phase === "NIGHT") return 0;
      return busy ? 1 : 0;
    case "office":
      if (phase === "NIGHT" || phase === "EVENING") return 0;
      return busy || phase === "MORNING" ? 1 : 0;
    case "home":
      return busy && (phase === "MORNING" || phase === "EVENING") ? 1 : 0;
    case "logistics":
      return 1; // staff-shaped, never a visitor crowd
    case "supermarket":
      return 1; // enter/leave, never a cluster
    case "transit":
      if (phase === "NIGHT") return busy ? 1 : 0;
      return busy ? 2 : 1;
    case "leisure":
      if (phase === "MORNING") return busy ? 1 : 0;
      if (phase === "EVENING" || phase === "NIGHT") return busy ? 2 : 1;
      return busy ? 1 : 0;
    case "cafe":
    case "restaurant":
      if (phase === "NIGHT") return busy ? 1 : 0;
      if (phase === "EVENING") return busy ? 2 : 1;
      return busy ? 2 : 1;
    default:
      return 0;
  }
}

export function desiredStreetAmbient(phase: TimeOfDayPhase, _hasAnyActivity: boolean): number {
  switch (phase) {
    case "MORNING":
    case "DAY":
      return 2;
    case "EVENING":
      return 2;
    case "NIGHT":
      return 1;
  }
}

function placeRole(target: TownTarget): ActorRole {
  if (target === "logistics") return "courier";
  if (target === "transit") return "transit-passenger";
  if (target === "home") return "resident";
  if (target === "office") return "resident";
  return "visitor";
}

function placeDwell(target: TownTarget, seed: string): number {
  const jitter = (hash32(seed) % 17) / 20; // 0 .. 0.80
  switch (target) {
    case "cafe":
      return 9.5 + jitter;
    case "leisure":
      return 8.5 + jitter;
    case "restaurant":
      return 7.2 + jitter;
    case "clinic":
      return 5.4 + jitter;
    case "supermarket":
      return 3.2 + jitter * 0.5;
    case "transit":
      return 6.5 + jitter; // waiting, not a long social linger
    case "logistics":
      return 4.0 + jitter * 0.4;
    case "office":
      return 5.0 + jitter;
    case "home":
      return 3.4 + jitter * 0.5;
    default:
      return 4.0;
  }
}

function streetDwell(_kind: AmbientStreetKind, seed: string): number {
  return 0.4 + (hash32(seed) % 9) / 20; // through-routes barely pause
}

function occupancyKey(actor: AmbientOccupant): string {
  if (actor.kind === "ambient" && actor.target) return `place:${actor.target}`;
  if (actor.streetKind) return `street:${actor.streetKind}`;
  return "street:unknown";
}

function pickStreetKind(day: string, bucket: number, used: Set<AmbientStreetKind>): AmbientStreetKind {
  const ranked = [...STREET_KINDS].sort((a, b) => {
    const ha = hash32(`${day}|${bucket}|${a}`);
    const hb = hash32(`${day}|${bucket}|${b}`);
    return ha - hb || a.localeCompare(b);
  });
  return ranked.find((kind) => !used.has(kind)) ?? ranked[0];
}

export function planAmbientSpawns(input: CrowdDirectorInput): CrowdDirectorPlan {
  const phase = timeOfDayPhase(input.clockSeconds);
  const day = input.day ?? "undated";
  const bucket = Math.floor(Math.max(0, input.clockSeconds) / AMBIENT_BUCKET_SECONDS);
  const ambientCap = DEFAULT_MAX_AMBIENT_ACTORS;
  const totalCap = DEFAULT_MAX_TOTAL_ACTORS;
  const usedSlots = input.eventActorCount + input.ambientActors.length;
  let remainingAmbient = Math.max(0, ambientCap - input.ambientActors.length);
  let remainingTotal = Math.max(0, totalCap - usedSlots);
  let skipped = 0;
  const spawns: AmbientSpawnIntent[] = [];

  const occupied = new Map<string, number>();
  for (const actor of input.ambientActors) {
    const key = occupancyKey(actor);
    occupied.set(key, (occupied.get(key) ?? 0) + 1);
  }

  const usedStreets = new Set<AmbientStreetKind>();
  for (const actor of input.ambientActors) {
    if (actor.streetKind) usedStreets.add(actor.streetKind);
  }

  const hasActivity = [...input.buildings.values()].some((building) => building.activityLevel !== "QUIET");

  function takeSlot(): boolean {
    if (remainingAmbient <= 0 || remainingTotal <= 0) return false;
    remainingAmbient -= 1;
    remainingTotal -= 1;
    return true;
  }

  // Place-based first: BUSY districts beat empty-street filling.
  for (const target of PLACE_TARGETS) {
    const runtime = input.buildings.get(target);
    const activity = runtime?.activityLevel ?? "QUIET";
    const desired = desiredPlaceAmbient(target, activity, phase);
    const current = occupied.get(`place:${target}`) ?? 0;
    const need = Math.max(0, desired - current);
    for (let slot = 0; slot < need; slot += 1) {
      if (!takeSlot()) continue;
      const seed = `${day}|${target}|${bucket}|${slot}`;
      spawns.push({
        seed,
        kind: "place",
        role: placeRole(target),
        target,
        streetKind: null,
        dwellWall: placeDwell(target, seed),
        eventId: null,
      });
    }
  }

  const streetDesired = desiredStreetAmbient(phase, hasActivity);
  const streetCurrent = input.ambientActors.filter((actor) => actor.streetKind !== null).length
    + spawns.filter((spawn) => spawn.kind === "street").length;
  const streetNeed = Math.max(0, streetDesired - streetCurrent);
  for (let slot = 0; slot < streetNeed; slot += 1) {
    if (!takeSlot()) continue;
    const kind = pickStreetKind(day, bucket, usedStreets);
    usedStreets.add(kind);
    const seed = `${day}|street|${kind}|${bucket}|${slot}`;
    spawns.push({
      seed,
      kind: "street",
      role: "visitor",
      target: null,
      streetKind: kind,
      dwellWall: streetDwell(kind, seed),
      eventId: null,
    });
  }

  return { spawns, skipped, timeOfDayPhase: phase };
}

export interface CrowdMetrics {
  eventActors: number;
  ambientActors: number;
  totalActors: number;
  busyBuildings: number;
  normalBuildings: number;
  quietBuildings: number;
  skippedEventActors: number;
  skippedAmbientActors: number;
  timeOfDayPhase: TimeOfDayPhase;
}

export function measureCrowd(params: {
  eventActors: number;
  ambientActors: number;
  buildings: Iterable<{ activityLevel: ActivityLevel }>;
  skippedEventActors: number;
  skippedAmbientActors: number;
  clockSeconds: number;
}): CrowdMetrics {
  let busyBuildings = 0;
  let normalBuildings = 0;
  let quietBuildings = 0;
  for (const building of params.buildings) {
    if (building.activityLevel === "BUSY") busyBuildings += 1;
    else if (building.activityLevel === "NORMAL") normalBuildings += 1;
    else quietBuildings += 1;
  }
  return {
    eventActors: params.eventActors,
    ambientActors: params.ambientActors,
    totalActors: params.eventActors + params.ambientActors,
    busyBuildings,
    normalBuildings,
    quietBuildings,
    skippedEventActors: params.skippedEventActors,
    skippedAmbientActors: params.skippedAmbientActors,
    timeOfDayPhase: timeOfDayPhase(params.clockSeconds),
  };
}
