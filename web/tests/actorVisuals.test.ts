/**
 * Actor readability invariants (pure layer):
 *  - roles are told apart by silhouette props + palettes, not by luck;
 *  - event actors outrank ambient actors visually;
 *  - group placement is deterministic, never overlapping;
 *  - feet land on the actual surface (bridge / road / plaza) heights.
 */

import { describe, expect, it } from "vitest";
import {
  ACTOR_BASE_HEIGHT,
  ACTOR_VISUAL_SCALE,
  AMBIENT_PRESENCE,
  EVENT_PRESENCE,
  dwellSlot,
  dwellSway,
  groundHeightAt,
  laneShift,
  roleVisual,
  walkLaneOffset,
  walkSwing,
} from "../src/showcase/town3d/actorVisuals";

describe("role visual descriptors", () => {
  it("gives couriers backpack + parcel + uniform, passengers a bag, others nothing", () => {
    expect(roleVisual("courier")).toEqual({ backpack: true, parcel: true, bag: false, uniform: true });
    expect(roleVisual("transit-passenger")).toEqual({ backpack: false, parcel: false, bag: true, uniform: false });
    expect(roleVisual("resident").backpack).toBe(false);
    expect(roleVisual("visitor").bag).toBe(false);
  });

  it("keeps event actors visually above ambient actors without shrinking them to dots", () => {
    expect(EVENT_PRESENCE).toBeGreaterThan(AMBIENT_PRESENCE);
    expect(AMBIENT_PRESENCE).toBeGreaterThanOrEqual(0.8);
  });

  it("scales actors up but keeps buildings the dominant mass", () => {
    const grownHeight = ACTOR_BASE_HEIGHT * ACTOR_VISUAL_SCALE;
    expect(grownHeight).toBeGreaterThanOrEqual(1.9); // readable at default framing
    expect(grownHeight).toBeLessThanOrEqual(2.2); // never a giant
    // buildTown.ts 最矮商铺 floors=2 → h=2*1.65+0.7+0.4 ≈ 4.4m
    expect(grownHeight).toBeLessThan(4.4 / 2);
  });
});

describe("deterministic placement", () => {
  it("lane offsets stay on the walkway and vary between ids", () => {
    const seen = new Set<number>();
    for (let id = 1; id <= 10; id += 1) {
      const offset = walkLaneOffset(id);
      expect(Math.abs(offset)).toBeLessThanOrEqual(0.7);
      seen.add(offset);
    }
    expect(seen.size).toBeGreaterThanOrEqual(3);
  });

  it("laneShift moves perpendicular to heading by exactly the offset", () => {
    const shifted = laneShift({ x: 0, z: 0 }, Math.PI / 2, 0.5); // heading +x
    expect(shifted.x).toBeCloseTo(0, 5);
    expect(shifted.z).toBeCloseTo(-0.5, 5);
    expect(Math.hypot(shifted.x, shifted.z)).toBeCloseTo(0.5, 5);
  });

  it("consecutive group ids land in distinct, non-overlapping dwell slots", () => {
    for (let start = 1; start <= 64; start += 1) {
      const slots = [start, start + 1, start + 2].map((id) => dwellSlot(id));
      for (let a = 0; a < slots.length; a += 1) {
        for (let b = a + 1; b < slots.length; b += 1) {
          const gap = Math.hypot(slots[a].dx - slots[b].dx, slots[a].dz - slots[b].dz);
          expect(gap, `ids ${start + a} vs ${start + b}`).toBeGreaterThanOrEqual(0.3);
        }
      }
      for (const slot of slots) {
        expect(Math.hypot(slot.dx, slot.dz)).toBeLessThanOrEqual(0.65); // 不散成crowd圈
      }
    }
  });

  it("is stable across calls (same id -> same offsets)", () => {
    expect(dwellSlot(7)).toEqual(dwellSlot(7));
    expect(walkLaneOffset(9)).toBe(walkLaneOffset(9));
  });
});

describe("grounding heights", () => {
  it("matches the built surfaces (bridge deck above road top, plazas flat)", () => {
    expect(groundHeightAt(-12, 14.5)).toBe(0.62); // 主桥桥面
    expect(groundHeightAt(19, 16)).toBe(0.62); // 宅配桥
    expect(groundHeightAt(0, -8.5)).toBe(0.18); // 东西车道
    expect(groundHeightAt(0, -14)).toBe(0.1); // 北岸铺装
    expect(groundHeightAt(-18.8, 19.6)).toBe(0.3); // 南岸站台步道
    expect(groundHeightAt(0, 21)).toBe(0.1); // 南岸内侧
  });
});

describe("motion readability", () => {
  it("walking swings limbs and bobs; amplitude stays inside one body width", () => {
    for (let id = 1; id <= 8; id += 1) {
      const swing = walkSwing(id, 12.34, false);
      expect(Math.abs(swing.stride)).toBeLessThanOrEqual(0.62);
      expect(swing.bob).toBeGreaterThanOrEqual(0);
      expect(swing.bob).toBeLessThanOrEqual(0.07);
      expect(Math.abs(swing.armSwing)).toBeLessThanOrEqual(0.5);
    }
  });

  it("dwell sway is a gentle idle, clearly smaller than walk bob peaks", () => {
    for (let id = 1; id <= 8; id += 1) {
      expect(Math.abs(dwellSway(id, 55.5))).toBeLessThanOrEqual(0.035);
    }
  });
});
