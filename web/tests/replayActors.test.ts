/**
 * Replay-layer actor rendering invariants:
 * role silhouette props, event-vs-ambient hierarchy, grounding heights,
 * group de-overlap and walk/idle pose differences. Pure scene-graph
 * assertions — no WebGL context needed.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { createReplayLayer } from "../src/showcase/town3d/replayLayer";
import type { ReplaySnapshot } from "../src/town/replay/replayEngine";

function actorState(overrides: Record<string, unknown>) {
  return {
    eventId: "te:1",
    target: "cafe",
    role: "visitor",
    phase: "WALKING",
    route: [],
    leg: 0,
    legProgress: 0,
    position: { x: 0, z: 0 },
    heading: 0,
    phaseRemaining: 0,
    opacity: 1,
    delay: 0,
    mode: "visit",
    dwellWall: 3,
    ...overrides,
  };
}

function ambientState(overrides: Record<string, unknown>) {
  return actorState({ kind: "ambient", seed: "s1", target: null, streetKind: "promenade", ...overrides });
}

function snapshotOf(actors: unknown[], ambientActors: unknown[] = [], buildings: Record<string, unknown> = {}): ReplaySnapshot {
  return {
    status: "playing",
    day: "2026-08-12",
    clockSeconds: 3600,
    speed: 8,
    totalEvents: 1,
    firedCount: 1,
    nextEvent: null,
    buildings,
    actors,
    ambientActors,
    crowd: {} as never,
    timeOfDayPhase: "MORNING",
    recent: [],
    highlightedEventId: null,
    selectedTarget: null,
    skippedActorCount: 0,
    incomePulses: [],
    deliveryPulses: [],
  } as unknown as ReplaySnapshot;
}

let scene: THREE.Scene;
let layer: ReturnType<typeof createReplayLayer>;

beforeEach(() => {
  vi.stubGlobal("document", {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({
        fillStyle: "", strokeStyle: "", lineWidth: 0, font: "", textAlign: "", textBaseline: "",
        beginPath() {}, roundRect() {}, fill() {}, stroke() {}, fillText() {},
      }),
    }),
  });
  scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-40, 40, 25, -25, 0.1, 200);
  const dom = {
    addEventListener() {}, removeEventListener() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
  } as unknown as HTMLElement;
  layer = createReplayLayer({ scene, camera, dom, onTargetClick: () => {} });
});

afterEach(() => {
  layer.dispose();
  vi.unstubAllGlobals();
});

function drawnActors(): THREE.Group[] {
  const root = scene.getObjectByName("replay-layer")!;
  return root.children.filter((child) => (child as THREE.Group).userData?.body instanceof THREE.Group) as THREE.Group[];
}

function dataOf(group: THREE.Group) {
  return group.userData as {
    body: THREE.Group; torso: THREE.Mesh; legL: THREE.Mesh; backpack: THREE.Mesh;
    parcel: THREE.Mesh; bag: THREE.Mesh; shadow: THREE.Mesh;
  };
}

describe("role silhouettes", () => {
  it("courier carries backpack + parcel and wears the uniform palette", () => {
    layer.update(snapshotOf([actorState({ id: 1, role: "courier", target: "home" })]), 0.016);
    const courier = drawnActors()[0];
    const data = dataOf(courier);
    expect(data.backpack.visible).toBe(true);
    expect(data.parcel.visible).toBe(true);
    expect(data.bag.visible).toBe(false);
    expect((data.torso.material as THREE.MeshStandardMaterial).color.getHexString()).toMatch(/e2953a|d97b3f/);
  });

  it("transit-passenger has a shoulder bag and no courier gear", () => {
    layer.update(snapshotOf([actorState({ id: 2, role: "transit-passenger", target: "transit" })]), 0.016);
    const data = dataOf(drawnActors()[0]);
    expect(data.bag.visible).toBe(true);
    expect(data.backpack.visible).toBe(false);
    expect(data.parcel.visible).toBe(false);
  });

  it("visitor stays the plain minimal silhouette", () => {
    layer.update(snapshotOf([actorState({ id: 3, role: "visitor" })]), 0.016);
    const data = dataOf(drawnActors()[0]);
    expect(data.backpack.visible || data.parcel.visible || data.bag.visible).toBe(false);
  });
});

describe("event vs ambient hierarchy", () => {
  it("ambient actors render smaller and with a softer grounding shadow", () => {
    layer.update(snapshotOf(
      [actorState({ id: 1, role: "visitor" })],
      [ambientState({ id: 1, role: "visitor" })],
    ), 0.016);
    const [event, ambient] = drawnActors();
    expect(ambient.scale.x).toBeLessThan(event.scale.x);
    expect((dataOf(ambient).shadow.material as THREE.MeshBasicMaterial).opacity)
      .toBeLessThan((dataOf(event).shadow.material as THREE.MeshBasicMaterial).opacity);
  });
});

describe("grounding", () => {
  it("feet sit on the bridge deck while crossing, and on the road elsewhere", () => {
    layer.update(snapshotOf([
      actorState({ id: 1, position: { x: -12, z: 14.5 } }),
      actorState({ id: 2, position: { x: 0, z: -8.5 } }),
      actorState({ id: 3, position: { x: -18.8, z: 19.6 }, target: "transit" }),
    ]), 0.016);
    const [bridge, road, southBank] = drawnActors();
    expect(bridge.position.y).toBeCloseTo(0.62, 5);
    expect(road.position.y).toBeCloseTo(0.18, 5);
    expect(southBank.position.y).toBeCloseTo(0.3, 5);
  });
});

describe("group readability", () => {
  it("three companions on the same walk never collapse onto one point", () => {
    const same = { position: { x: 4, z: 2.15 }, heading: Math.PI / 2 };
    layer.update(snapshotOf([
      actorState({ id: 1, ...same }),
      actorState({ id: 2, ...same }),
      actorState({ id: 3, ...same }),
    ]), 0.016);
    const groups = drawnActors();
    expect(groups).toHaveLength(3);
    for (let a = 0; a < groups.length; a += 1) {
      for (let b = a + 1; b < groups.length; b += 1) {
        const gap = Math.hypot(
          groups[a].position.x - groups[b].position.x,
          groups[a].position.z - groups[b].position.z,
        );
        expect(gap).toBeGreaterThanOrEqual(0.25);
      }
    }
  });

  it("dwelling groups fan out over doorway slots instead of stacking", () => {
    const anchor = { position: { x: 25, z: 1.9 }, phase: "DWELLING" };
    layer.update(snapshotOf([
      actorState({ id: 4, ...anchor }),
      actorState({ id: 5, ...anchor }),
      actorState({ id: 6, ...anchor }),
    ]), 0.016);
    const groups = drawnActors();
    for (let a = 0; a < groups.length; a += 1) {
      for (let b = a + 1; b < groups.length; b += 1) {
        const gap = Math.hypot(
          groups[a].position.x - groups[b].position.x,
          groups[a].position.z - groups[b].position.z,
        );
        expect(gap).toBeGreaterThanOrEqual(0.3);
      }
    }
  });
});

describe("motion and poses", () => {
  it("walking actors swing limbs over time; dwelling actors hold an idle sway", () => {
    const walking = actorState({ id: 1 });
    layer.update(snapshotOf([walking, actorState({ id: 2, phase: "DWELLING" })]), 0.016);
    const [walker, dweller] = drawnActors();
    const legSeen = new Set<number>();
    for (let frame = 0; frame < 24; frame += 1) {
      layer.update(snapshotOf([walking, actorState({ id: 2, phase: "DWELLING" })]), 0.016);
      legSeen.add(Math.round(dataOf(walker).legL.rotation.x * 10) / 10);
    }
    expect(legSeen.size).toBeGreaterThan(3); // 明显的腿部摆动，而非静止滑行
    expect(dataOf(dweller).legL.rotation.x).toBe(0);
    expect(Math.abs(dataOf(dweller).body.rotation.z)).toBeLessThan(0.04);
    expect(Math.abs(dataOf(walker).body.position.y)).toBeLessThanOrEqual(0.07);
  });

  it("heading is smoothed across corners instead of snapping", () => {
    const walker = actorState({ id: 1, heading: 0 });
    layer.update(snapshotOf([walker]), 0.016);
    const group = drawnActors()[0];
    const before = group.rotation.y;
    layer.update(snapshotOf([actorState({ id: 1, heading: Math.PI / 2 })]), 0.016);
    expect(group.rotation.y).toBeGreaterThan(before);
    expect(group.rotation.y).toBeLessThan(Math.PI / 2);
  });
});
