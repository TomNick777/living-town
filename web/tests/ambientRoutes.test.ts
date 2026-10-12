/**
 * Ambient waypoint routes: street life and place linger points stay on
 * the walkway graph and never cut through building footprints.
 */

import { describe, expect, it } from "vitest";
import type { AmbientStreetKind } from "../src/town/replay/replayEngine";
import { TARGET_PLACES, TownWalkways } from "../src/showcase/town3d/townMap";
import type { TownTarget } from "../src/town/adapter/townEvents";

const TARGETS: Exclude<TownTarget, "unknown">[] = [
  "home", "office", "restaurant", "cafe", "supermarket", "logistics",
  "transit", "clinic", "leisure",
];
const STREETS: AmbientStreetKind[] = [
  "north-street", "promenade", "bridge-a-south", "bridge-b-north",
];
const SEEDS = [0, 1, 2, 7, 13, 42, 99];

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

describe("ambient street routes", () => {
  it("returns a through-route for every street kind and seed", () => {
    const walkways = new TownWalkways();
    for (const kind of STREETS) {
      for (const seed of SEEDS) {
        const route = walkways.ambientStreetRoute(kind, seed);
        expect(route, kind).not.toBeNull();
        expect(route!.mode).toBe("through");
        expect(route!.path.length).toBeGreaterThan(1);
      }
    }
  });

  it("is deterministic and stays off building footprints", () => {
    const walkways = new TownWalkways();
    const again = new TownWalkways();
    for (const kind of STREETS) {
      for (const seed of SEEDS) {
        const route = walkways.ambientStreetRoute(kind, seed)!;
        expect(again.ambientStreetRoute(kind, seed)).toEqual(route);
        for (const point of [route.spawn, ...route.path]) {
          expect(insideFootprint(point), `${kind} ${seed} ${point.x},${point.z}`).toBeNull();
        }
      }
    }
  });
});

describe("ambient place routes", () => {
  it("gives every mapped target a linger/visit route with the right role", () => {
    const walkways = new TownWalkways();
    const roles: Record<string, string> = {
      home: "resident",
      logistics: "courier",
      transit: "transit-passenger",
    };
    for (const target of TARGETS) {
      const route = walkways.ambientPlaceRoute(target, 3);
      expect(route, target).not.toBeNull();
      expect(route!.path.length).toBeGreaterThan(0);
      if (roles[target]) expect(route!.role).toBe(roles[target]);
    }
    expect(walkways.ambientPlaceRoute("unknown", 3)).toBeNull();
  });

  it("does not walk through other buildings on the way to a linger point", () => {
    const walkways = new TownWalkways();
    for (const target of TARGETS) {
      for (const seed of SEEDS) {
        const route = walkways.ambientPlaceRoute(target, seed)!;
        const waypoints = [route.spawn, ...route.path];
        for (let i = 0; i < waypoints.length - 1; i += 1) {
          const hit = insideFootprint(waypoints[i]);
          const isHomeSpawn = target === "home" && i === 0;
          const isLogisticsSpawn = target === "logistics" && i === 0;
          expect(
            hit && !isHomeSpawn && !isLogisticsSpawn ? hit : null,
            `${target} seed ${seed} waypoint ${i}`,
          ).toBeNull();
        }
      }
    }
  });
});
