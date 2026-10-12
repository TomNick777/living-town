/**
 * Deterministic event-actor presence: dwell by target, stagger jitter,
 * high-intensity VISIT group arrival.
 *
 * Variation is a hash of eventId + target, so reset replay is identical.
 * Amount, merchant and transaction identity never enter these numbers.
 */

import type { ActorRole, TownTarget } from "./replayEngine";
import type { TownBehavior } from "../adapter/townEvents";

export function hash32(text: string): number {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Base wall-clock dwell by semantic target (seconds). Role can shorten it. */
const TARGET_DWELL: Record<Exclude<TownTarget, "unknown">, number> = {
  cafe: 8.4,
  leisure: 7.8,
  restaurant: 6.6,
  clinic: 5.1,
  office: 4.2,
  supermarket: 3.7,
  home: 3.2,
  logistics: 2.6,
  transit: 1.7,
};

function unitJitter(seed: string): number {
  return (hash32(seed) % 21) / 100; // 0.00 .. 0.20
}

export function eventDwellWallSeconds(
  role: ActorRole,
  target: TownTarget,
  eventId: string,
): number {
  if (role === "courier") return 2.4 + unitJitter(`${eventId}:courier`) * 0.4;
  if (role === "transit-passenger") return 1.55 + unitJitter(`${eventId}:pax`) * 0.25;
  const base = target === "unknown" ? 4.0 : TARGET_DWELL[target];
  return base + unitJitter(`${eventId}:${target}`) * 0.35;
}

/**
 * Spawn delay for actor `index` of a `count`-person event.
 * High-intensity VISIT (count >= 2) groups the first two people.
 */
export function eventStaggerDelay(
  eventId: string,
  index: number,
  count: number,
  behavior: TownBehavior,
): number {
  if (index <= 0) return 0;
  const grouped = behavior === "VISIT" && count >= 2 && index === 1;
  if (grouped) {
    return 0.22 + (hash32(`${eventId}:group`) % 9) * 0.02; // 0.22 .. 0.38
  }
  const mechanical = index * 0.9;
  const signed = (hash32(`${eventId}:${index}`) % 11) - 5; // -5..5
  const jitter = (signed === 0 ? 2 : signed) * 0.05; // never zero: avoids 0.9/1.8 lockstep
  // Keep order: later actors remain later than the previous slot's floor.
  return Math.max(index * 0.55, mechanical + jitter);
}
