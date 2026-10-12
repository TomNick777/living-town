/**
 * Event-actor presence polish: dwell by target, deterministic stagger,
 * high-intensity VISIT group arrival. No ambient actors here.
 */

import { describe, expect, it } from "vitest";
import { eventDwellWallSeconds, eventStaggerDelay } from "../src/town/replay/eventPresence";

describe("event dwell variation", () => {
  it("gives cafe a longer stay than supermarket, leisure longer than transit", () => {
    const cafe = eventDwellWallSeconds("visitor", "cafe", "te:1");
    const market = eventDwellWallSeconds("visitor", "supermarket", "te:1");
    const leisure = eventDwellWallSeconds("visitor", "leisure", "te:1");
    const transit = eventDwellWallSeconds("transit-passenger", "transit", "te:1");
    const clinic = eventDwellWallSeconds("visitor", "clinic", "te:1");
    const restaurant = eventDwellWallSeconds("visitor", "restaurant", "te:1");
    expect(cafe).toBeGreaterThan(market);
    expect(leisure).toBeGreaterThan(transit);
    expect(clinic).toBeGreaterThan(transit);
    expect(restaurant).toBeGreaterThan(market);
    expect(restaurant).toBeLessThan(cafe);
  });

  it("is deterministic for the same eventId + target + role", () => {
    expect(eventDwellWallSeconds("visitor", "cafe", "te:42")).toBe(
      eventDwellWallSeconds("visitor", "cafe", "te:42"),
    );
    expect(eventDwellWallSeconds("visitor", "cafe", "te:42")).not.toBe(
      eventDwellWallSeconds("visitor", "cafe", "te:99"),
    );
  });

  it("keeps courier and transit-passenger stays short regardless of target", () => {
    expect(eventDwellWallSeconds("courier", "logistics", "te:d")).toBeLessThan(3.2);
    expect(eventDwellWallSeconds("transit-passenger", "transit", "te:t")).toBeLessThan(2.4);
  });
});

describe("event stagger and group arrival", () => {
  it("keeps stagger ordered and non-mechanical for a 3-person visit", () => {
    const delays = [0, 1, 2].map((index) => eventStaggerDelay("te:hi", index, 3, "VISIT"));
    expect(delays[0]).toBe(0);
    expect(delays[1]).toBeGreaterThan(delays[0]);
    expect(delays[2]).toBeGreaterThan(delays[1]);
    // not exactly 0.9 / 1.8 mechanical spacing
    expect(delays[1]).not.toBe(0.9);
    expect(delays[2]).not.toBe(1.8);
  });

  it("groups the first two VISIT actors of a high-intensity event", () => {
    const a = eventStaggerDelay("te:group", 0, 3, "VISIT");
    const b = eventStaggerDelay("te:group", 1, 3, "VISIT");
    const c = eventStaggerDelay("te:group", 2, 3, "VISIT");
    expect(b - a).toBeLessThan(0.45);
    expect(c - b).toBeGreaterThan(0.7);
  });

  it("is deterministic across resets", () => {
    const first = [0, 1, 2].map((index) => eventStaggerDelay("te:same", index, 3, "VISIT"));
    const second = [0, 1, 2].map((index) => eventStaggerDelay("te:same", index, 3, "VISIT"));
    expect(second).toEqual(first);
  });
});
