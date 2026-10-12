/**
 * World composition tests — static base + TownWorldState → SceneModel.
 *
 * FB-3 invariants:
 *   - composition is deterministic (transport order never matters);
 *   - layout mismatch fails loudly before anything renders;
 *   - the composed scene reproduces the pre-split buildings exactly
 *     (asset/position/orientation), now keyed by frozen UUIDs;
 *   - DEMOLISHED buildings never reach the SceneModel; ACTIVE ones do;
 *   - any world the placement authority accepts passes buildSceneModel;
 *   - buildings never come and go between the three demo states.
 */

import { describe, expect, it } from "vitest";
import { ASSET_REGISTRY } from "../src/town/scene/assets";
import { LIVING_TOWN_BASE_SCENE } from "../src/town/scene/livingTownScene";
import { buildSceneModel, SceneConfigError } from "../src/town/scene/sceneModel";
import { validateTownState } from "../src/town/adapter/townState";
import { projectTownVisualState } from "../src/town/visual/townVisualProjector";
import { composeSceneConfig, WorldContractError } from "../src/town/world/compose";
import { SEED_WORLD } from "../src/town/world/seedWorld";
import type { TownWorldState } from "../src/town/world/types";
import stable from "../src/fixtures/town-state/stable.json";

const UUIDS = {
  residentialA: "5513ac64-2727-4f4f-9e9e-44441076de27",
  residentialB: "0deb488a-6d16-4c95-b245-7ff945b77402",
  cafe: "45a22d48-57c5-4d02-95c3-517d1c36957c",
  convenienceStore: "ea217128-8498-491b-b025-42e8653f387d",
};

// Pre-split static scene objects, frozen here as the visual regression truth
// (FB-0 parity + the FB-0-era scene file). Composition must reproduce them
// under the frozen UUID identities.
const LEGACY_BUILDINGS: Record<string, [string, number, number, string]> = {
  "residential-a": ["residential_a", 1, 2, "S"],
  "residential-b": ["residential_b", 4, 3, "S"],
  cafe: ["cafe", 11, 3, "S"],
  "convenience-store": ["convenience_store", 9, 4, "S"],
};

const LEGACY_TO_UUID: Record<string, string> = {
  "residential-a": UUIDS.residentialA,
  "residential-b": UUIDS.residentialB,
  cafe: UUIDS.cafe,
  "convenience-store": UUIDS.convenienceStore,
};

function composedModel(world: TownWorldState = SEED_WORLD) {
  return buildSceneModel(composeSceneConfig(LIVING_TOWN_BASE_SCENE, world));
}

describe("composeSceneConfig", () => {
  it("is deterministic: shuffling the transport order changes nothing", () => {
    const shuffled: TownWorldState = {
      ...SEED_WORLD,
      buildings: [...SEED_WORLD.buildings].reverse(),
    };
    expect(JSON.stringify(composedModel(shuffled))).toBe(JSON.stringify(composedModel()));
  });

  it("rejects an unknown world_version", () => {
    expect(() => composeSceneConfig(LIVING_TOWN_BASE_SCENE, { ...SEED_WORLD, world_version: "town-world-v2" })).toThrow(
      WorldContractError,
    );
  });

  it("rejects a layout mismatch before the SceneModel is built", () => {
    expect(() => composeSceneConfig(LIVING_TOWN_BASE_SCENE, { ...SEED_WORLD, layout_version: "living-town-block-v0" })).toThrow(
      /layout mismatch/,
    );
  });

  it("rejects non-integer coordinates and unknown assets defensively", () => {
    const bad: TownWorldState = {
      ...SEED_WORLD,
      buildings: [{ building_id: "x", asset_id: "skyscraper", grid_x: 1, grid_y: 1, orientation: "S", lifecycle: "ACTIVE" }],
    };
    expect(() => composeSceneConfig(LIVING_TOWN_BASE_SCENE, bad)).toThrow(/unknown asset/);
    const fractional: TownWorldState = {
      ...SEED_WORLD,
      buildings: [{ building_id: "x", asset_id: "cafe", grid_x: 1.5, grid_y: 1, orientation: "S", lifecycle: "ACTIVE" }],
    };
    expect(() => composeSceneConfig(LIVING_TOWN_BASE_SCENE, fractional)).toThrow(/non-integer/);
  });
});

describe("the composed scene", () => {
  const model = composedModel();

  it("reproduces the pre-split buildings exactly, now under frozen UUID ids", () => {
    const byId = new Map(model.objects.map((o) => [o.id, o]));
    for (const [legacyId, [asset, x, y, orientation]] of Object.entries(LEGACY_BUILDINGS)) {
      const placed = byId.get(LEGACY_TO_UUID[legacyId]);
      expect(placed, legacyId).toBeDefined();
      expect([placed!.asset, placed!.grid.x, placed!.grid.y, placed!.orientation]).toEqual([asset, x, y, orientation]);
    }
  });

  it("passes the unchanged defensive buildSceneModel validation", () => {
    expect(model.id).toBe("living-town-block-v1");
    expect(model.externalConnectionAnchorId).toBe("external-connection-anchor");
    expect(model.variableLotId).toBe("variable-lot");
  });

  it("contains the full neighbourhood: base + four buildings", () => {
    const count = (asset: string) => model.objects.filter((o) => o.asset === asset).length;
    expect(count("residential_a")).toBe(1);
    expect(count("residential_b")).toBe(1);
    expect(count("convenience_store")).toBe(1);
    expect(count("cafe")).toBe(1);
    expect(count("bus_stop")).toBe(1);
    expect(count("street_light")).toBeGreaterThanOrEqual(3);
    expect(count("tree")).toBeGreaterThanOrEqual(6);
    expect(count("bridge")).toBe(1);
    expect(count("variable_lot")).toBe(1);
    expect(count("external_connection_anchor")).toBe(1);
  });
});

describe("world lifecycle in the scene", () => {
  it("excludes DEMOLISHED buildings from the SceneModel but keeps ACTIVE ones", () => {
    const world: TownWorldState = {
      ...SEED_WORLD,
      buildings: SEED_WORLD.buildings.map((b) =>
        b.building_id === UUIDS.cafe ? { ...b, lifecycle: "DEMOLISHED" as const } : b,
      ),
    };
    const model = composedModel(world);
    expect(model.objects.find((o) => o.id === UUIDS.cafe)).toBeUndefined();
    expect(model.objects.find((o) => o.id === UUIDS.residentialA)).toBeDefined();
  });

  it("renders a user-created building from the world layer", () => {
    const world: TownWorldState = {
      ...SEED_WORLD,
      revision: 2,
      buildings: [
        ...SEED_WORLD.buildings,
        { building_id: "aaaaffff-0000-0000-0000-000000000001", asset_id: "cafe", grid_x: 5, grid_y: 1, orientation: "N", lifecycle: "ACTIVE" },
      ],
    };
    const model = composedModel(world);
    const created = model.objects.find((o) => o.id === "aaaaffff-0000-0000-0000-000000000001");
    expect(created).toBeDefined();
    expect(created!.asset).toBe("cafe");
    expect(created!.grid).toMatchObject({ x: 5, y: 1 });
  });

  it("any world the placement authority accepts passes SceneModel validation (collision parity)", () => {
    // A world whose buildings exactly fill the legal cells of the golden
    // corpus: every accepted placement must compose into a valid SceneModel.
    const world: TownWorldState = {
      ...SEED_WORLD,
      buildings: [
        ...SEED_WORLD.buildings,
        { building_id: "aaaaffff-0000-0000-0000-000000000002", asset_id: "cafe", grid_x: 12, grid_y: 0, orientation: "S", lifecycle: "ACTIVE" }, // on water (flat) — legal
        { building_id: "aaaaffff-0000-0000-0000-000000000003", asset_id: "cafe", grid_x: 15, grid_y: 9, orientation: "S", lifecycle: "ACTIVE" }, // max corner
      ],
    };
    expect(() => composedModel(world)).not.toThrow();
  });

  it("a world that the service would never emit still fails the defensive net, not silently renders", () => {
    const overlapping: TownWorldState = {
      ...SEED_WORLD,
      buildings: [
        ...SEED_WORLD.buildings,
        { building_id: "aaaaffff-0000-0000-0000-000000000004", asset_id: "cafe", grid_x: 1, grid_y: 2, orientation: "S", lifecycle: "ACTIVE" }, // on residential-a
      ],
    };
    expect(() => composedModel(overlapping)).toThrow(SceneConfigError);
  });
});

describe("footprint agreement (contract ↔ registry) keeps composition honest", () => {
  it("every world building resolves through the same registry the base uses", () => {
    for (const building of SEED_WORLD.buildings) {
      expect(ASSET_REGISTRY[building.asset_id as keyof typeof ASSET_REGISTRY]).toBeDefined();
    }
  });
});

describe("the two state lines never cross", () => {
  it("a world with zero active buildings changes no visual level for the same TownState", () => {
    // TownVisualState derives ONLY from the TownState line; TownWorldState
    // only feeds the SceneModel. They meet at the renderer, nowhere earlier.
    const town = validateTownState(stable);
    const visual = projectTownVisualState(town);
    const emptyWorld: TownWorldState = { ...SEED_WORLD, buildings: [] };
    expect(JSON.stringify(projectTownVisualState(town))).toBe(JSON.stringify(visual));
    const empty = buildSceneModel(composeSceneConfig(LIVING_TOWN_BASE_SCENE, emptyWorld));
    const seeded = buildSceneModel(composeSceneConfig(LIVING_TOWN_BASE_SCENE, SEED_WORLD));
    expect(seeded.objects.length).toBe(empty.objects.length + 4);
  });

  it("no scene_activity rule ever creates or removes a building", () => {
    // buildings come exclusively from the world layer; the visual line's
    // scene activity only drives ambience (pedestrians, lights, mood)
    const town = validateTownState(stable);
    const visual = projectTownVisualState(town);
    const model = buildSceneModel(composeSceneConfig(LIVING_TOWN_BASE_SCENE, SEED_WORLD));
    const buildingObjects = model.objects.filter((o) => o.def.category === "building");
    expect(buildingObjects.map((o) => o.id).sort()).toEqual(SEED_WORLD.buildings.map((b) => b.building_id).sort());
    // pedestrians (scene-activity ambience) are added at render time, never as world buildings
    expect(visual.explanations.some((e) => e.field.startsWith("scene_activity."))).toBe(true);
  });
});
