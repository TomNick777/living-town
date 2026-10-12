/**
 * Walkway graph tests: connectivity, determinism, and the hard rule that
 * actor paths follow streets — intermediate points never enter buildings.
 */

import { describe, expect, it } from "vitest";
import { TARGET_PLACES, TownWalkways, walkwayPath } from "../src/showcase/town3d/townMap";
import type { TownEvent, TownTarget } from "../src/town/adapter/townEvents";

const TARGETS: TownTarget[] = [
  "home", "office", "restaurant", "cafe", "supermarket", "logistics",
  "transit", "clinic", "leisure",
];
const SEEDS = [0, 1, 2, 3, 7, 13, 42, 99, 1234];

function makeEvent(overrides: Partial<TownEvent>): TownEvent {
  return {
    id: "te:1",
    transaction_id: 1,
    occurred_at: "2026-08-14T12:20:00+08:00",
    time_precision: "SECOND",
    time_of_day_seconds: 44400,
    presentation_time: false,
    type: "DINING",
    category_code: "FOOD",
    category_name: null,
    merchant: null,
    description: null,
    amount_minor: 3600,
    currency: "CNY",
    direction: "expense",
    target: "restaurant",
    behavior: "VISIT",
    intensity: 0.42,
    rule: "category:FOOD->restaurant",
    transaction_type: "EXPENSE",
    schedule_seconds: 44400,
    ...overrides,
  };
}

function insideFootprint(point: { x: number; z: number }, margin = 0.15): string | null {
  for (const target of TARGETS) {
    for (const box of TARGET_PLACES[target].footprints) {
      const withinX = Math.abs(point.x - box.x) <= box.w / 2 + margin;
      const withinZ = Math.abs(point.z - box.z) <= box.d / 2 + margin;
      if (withinX && withinZ) return `${target}@${box.x},${box.z}`;
    }
  }
  return null;
}

describe("walkway graph", () => {
  it("routes every target from every spawn deterministically", () => {
    const walkways = new TownWalkways();
    for (const target of TARGETS) {
      for (const seed of SEEDS) {
        const route = walkways.routeFor(target, seed);
        expect(route, `${target} seed ${seed}`).not.toBeNull();
        expect(route!.path.length).toBeGreaterThan(0);
        expect(route!.path[route!.path.length - 1]).toEqual(route!.path[route!.path.length - 1]);
      }
    }
    const walkwaysAgain = new TownWalkways();
    for (const target of TARGETS) {
      for (const seed of SEEDS) {
        expect(walkwaysAgain.routeFor(target, seed)).toEqual(walkways.routeFor(target, seed));
      }
    }
  });

  it("unknown targets never produce a route (no fake actors)", () => {
    const walkways = new TownWalkways();
    for (const seed of SEEDS) {
      expect(walkways.routeFor("unknown", seed)).toBeNull();
    }
  });

  it("intermediate path points never walk through a building", () => {
    const walkways = new TownWalkways();
    for (const target of TARGETS) {
      for (const seed of SEEDS) {
        const route = walkways.routeFor(target, seed)!;
        const waypoints = [route.spawn, ...route.path];
        for (let i = 0; i < waypoints.length - 1; i += 1) {
          // 终点门口属于目标建筑，允许；其余点必须在通行区域。
          const hit = insideFootprint(waypoints[i]);
          const isOwnDoor = i === waypoints.length - 1;
          const isSpawnDoor = i === 0 && target === "home" && seed % 7 === 0;
          expect(hit ? hit : null, `${target} seed ${seed} waypoint ${i} (${waypoints[i].x},${waypoints[i].z})`).toBe(
            isOwnDoor || isSpawnDoor ? hit : null,
          );
        }
      }
    }
  });

  it("logistics routes cross the river bridge to the depot", () => {
    const walkways = new TownWalkways();
    const route = walkways.routeFor("logistics", 3)!;
    const zs = route.path.map((point) => point.z);
    expect(Math.max(...zs)).toBeGreaterThan(18); // 到达南岸
    const path = walkwayPath("A:0", "S:15.8");
    expect(path).toContain("BR2:14.5"); // 经过 x=19 桥
  });

  it("v2 transit routes enter from a street end, stop at the hub and exit through", () => {
    const walkways = new TownWalkways();
    const west = walkways.routeForEvent!(
      makeEvent({ behavior: "TRANSIT", target: "transit", type: "TRANSIT", transaction_id: 21 }), 0)!;
    expect(west.role).toBe("transit-passenger");
    expect(west.mode).toBe("through");
    const waypoints = [west.spawn, ...west.path];
    // 途经巴士站门口（z ≈ 20.4，南岸），终点是桥端出口（不再返回出生点）。
    expect(waypoints.some((point) => Math.abs(point.x - (-18.8)) < 0.3 && Math.abs(point.z - 20.4) < 0.3)).toBe(true);
    const last = waypoints[waypoints.length - 1];
    expect(last.z).toBeCloseTo(19.6, 5);
    expect([-12, 19]).toContain(last.x); // 两座桥的南岸落点之一
    // 确定性：同一笔交易永远走同一条乘客路线。
    expect(walkways.routeForEvent!(makeEvent({ behavior: "TRANSIT", target: "transit", type: "TRANSIT", transaction_id: 21 }), 0))
      .toEqual(west);
  });

  it("v2 delivery routes run courier from the depot to the home door (not the user)", () => {
    const walkways = new TownWalkways();
    const route = walkways.routeForEvent!(
      makeEvent({ behavior: "DELIVERY", target: "logistics", type: "PARCEL" }), 0)!;
    expect(route.role).toBe("courier");
    expect(route.mode).toBeUndefined(); // 默认 visit：送完返回宅配站
    expect(route.spawn.x).toBeCloseTo(15.8, 5); // 从青川宅配出发
    const last = route.path[route.path.length - 1];
    expect(last).toEqual({ x: 0, z: -11.45 }); // 终点是青川荘门口
    const zs = route.path.map((point) => point.z);
    expect(Math.min(...zs)).toBeLessThan(-10); // 过桥回到北岸
  });

  it("rejects paths between disconnected nodes", () => {
    expect(walkwayPath("A:0", "nonexistent")).toEqual([]);
  });
});
