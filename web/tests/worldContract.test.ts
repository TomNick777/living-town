/**
 * World contract v1 — renderer-independence and Python/TypeScript parity.
 *
 * The contract JSON (src/life_energy/living_town/world/contracts/) is the
 * NORMATIVE copy of the world-space rules: layout bounds, orientation
 * vocabulary, portable asset definitions (footprint / occupancy /
 * placeable), static solid occupancy, frozen seed buildings and life
 * scenes. The TS runtime never reads it (functional baseline §17): it keeps
 * its own mirrored copies (scene/assets.ts, adapter/townState.ts,
 * scene/livingTownScene.ts) — THIS test locks the mirrors to the contract,
 * so any drift fails loudly here instead of silently in the world layer.
 *
 * FB-0 proved the scene split (landed in FB-3) is lossless:
 *
 *   pre-split scene solid cells − seed building footprints ≡ static_solid_cells
 *   static_solid_cells ∪ seed building footprints ≡ pre-split solid cells
 *
 * Post-split the base scene's solids ARE the contract's static_solid_cells.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LIFE_SCENES } from "../src/town/adapter/townState";
import { ASSET_IDS, ASSET_REGISTRY } from "../src/town/scene/assets";
import { LIVING_TOWN_BASE_SCENE } from "../src/town/scene/livingTownScene";
import { composeSceneConfig } from "../src/town/world/compose";
import { SEED_WORLD } from "../src/town/world/seedWorld";

const CONTRACT_PATH = join(
  __dirname,
  "..",
  "..",
  "src",
  "life_energy",
  "living_town",
  "world",
  "contracts",
  "world_contract_v1.json",
);

interface PortableAssetDef {
  category: string;
  footprint: { w: number; h: number };
  occupancy: string;
  placeable: boolean;
}

interface SeedBuilding {
  building_id: string;
  legacy_object_id: string;
  asset_id: string;
  grid_x: number;
  grid_y: number;
  orientation: string;
}

interface WorldContract {
  contract_version: string;
  layout: { id: string; bounds: { min_x: number; max_x: number; min_y: number; max_y: number } };
  orientations: string[];
  assets: Record<string, PortableAssetDef>;
  placeable_categories: string[];
  static_solid_cells: [number, number][];
  seed_buildings: SeedBuilding[];
  life_scenes: string[];
}

const contract: WorldContract = JSON.parse(readFileSync(CONTRACT_PATH, "utf8"));

// ------------------------------------------------------------------ validator

const FORBIDDEN_SUBSTRINGS = [
  // renderer-specific
  "screen", "sx", "sy", "drawkey", "viewbox", "heightpx", "pixel",
  "palette", "token", "css", "svg", "shadow", "stroke", "facade",
  "painter", "viewport", "window",
  // financial / classification vocabulary
  "amount", "_minor", "transaction",
];

const FORBIDDEN_EXACT_KEYS = new Set(["z", "grid_z", "gridz", "category_to_scene", "category_mapping"]);

const TOP_KEYS = new Set([
  "contract_version",
  "layout",
  "orientations",
  "assets",
  "placeable_categories",
  "static_solid_cells",
  "seed_buildings",
  "life_scenes",
]);

const ASSET_DEF_KEYS = new Set(["category", "footprint", "occupancy", "placeable"]);
const SEED_KEYS = new Set(["building_id", "legacy_object_id", "asset_id", "grid_x", "grid_y", "orientation"]);

const ORIENTATION_VOCABULARY = ["N", "E", "S", "W", "NE", "NW", "SE", "SW"];
const ASSET_CATEGORIES = new Set(["building", "infrastructure", "furniture", "nature", "living", "special"]);
const OCCUPANCY = new Set(["solid", "flat"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v);
}

function forbiddenKeyErrors(raw: unknown): string[] {
  const errors: string[] = [];
  const walk = (node: unknown, where: string): void => {
    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, `${where}[${i}].`));
      return;
    }
    if (!isObject(node)) return;
    for (const [key, value] of Object.entries(node)) {
      const lower = key.toLowerCase();
      if (FORBIDDEN_SUBSTRINGS.some((t) => lower.includes(t)) || FORBIDDEN_EXACT_KEYS.has(key)) {
        errors.push(`key ${where}${key} is forbidden in the world contract`);
      }
      walk(value, `${where}${key}.`);
    }
  };
  walk(raw, "");
  return errors;
}

/** TS-side mirror of the Python validator checklist (living_town/world/contract.py). */
export function validateContract(raw: unknown): string[] {
  const errors: string[] = forbiddenKeyErrors(raw);
  if (!isObject(raw)) return ["contract root must be an object"];

  const unknownTop = Object.keys(raw).filter((k) => !TOP_KEYS.has(k));
  if (unknownTop.length) errors.push(`contract has unknown keys ${unknownTop.sort()}`);
  const missingTop = [...TOP_KEYS].filter((k) => !(k in raw));
  if (missingTop.length) return [...errors, `contract is missing keys ${missingTop.sort()}`];

  if (raw.contract_version !== "living-town-world-contract-v1") {
    errors.push(`contract_version must be living-town-world-contract-v1, got ${String(raw.contract_version)}`);
  }

  const layout = raw.layout;
  if (!isObject(layout) || layout.id !== "living-town-block-v1") {
    errors.push("layout.id must be living-town-block-v1");
  }
  let bounds: Record<string, number> | undefined;
  if (isObject(layout) && isObject(layout.bounds)) {
    const b = layout.bounds;
    if ((["min_x", "max_x", "min_y", "max_y"] as const).every((k) => isInt(b[k]))) {
      bounds = { min_x: b.min_x as number, max_x: b.max_x as number, min_y: b.min_y as number, max_y: b.max_y as number };
    }
  }
  if (!bounds) errors.push("layout.bounds must be integer min_x/max_x/min_y/max_y");
  else if (bounds.min_x > bounds.max_x || bounds.min_y > bounds.max_y) {
    errors.push("layout.bounds min must not exceed max");
  }

  const orientations = raw.orientations;
  if (!Array.isArray(orientations) || orientations.length !== ORIENTATION_VOCABULARY.length
    || !ORIENTATION_VOCABULARY.every((o, i) => orientations[i] === o)) {
    errors.push(`orientations must equal ${JSON.stringify(ORIENTATION_VOCABULARY)}`);
  }

  const placeableCategories: string[] = Array.isArray(raw.placeable_categories) ? (raw.placeable_categories as string[]) : [];
  if (!placeableCategories.length || placeableCategories.some((c) => !ASSET_CATEGORIES.has(c))) {
    errors.push("placeable_categories must be non-empty known asset categories");
  }

  const assets = raw.assets;
  const assetDefs: Record<string, PortableAssetDef> = {};
  if (!isObject(assets) || !Object.keys(assets).length) {
    errors.push("assets must be a non-empty object");
  } else {
    for (const [assetId, def] of Object.entries(assets)) {
      const where = `assets.${assetId}`;
      if (!isObject(def)) {
        errors.push(`${where} must be an object`);
        continue;
      }
      const badKeys = Object.keys(def).filter((k) => !ASSET_DEF_KEYS.has(k));
      const missingKeys = [...ASSET_DEF_KEYS].filter((k) => !(k in def));
      if (badKeys.length || missingKeys.length) errors.push(`${where} has wrong keys (unknown ${badKeys.sort()}, missing ${missingKeys.sort()})`);
      if (!ASSET_CATEGORIES.has(String(def.category))) errors.push(`${where}.category ${String(def.category)} is not a known asset category`);
      if (!OCCUPANCY.has(String(def.occupancy))) errors.push(`${where}.occupancy must be solid or flat`);
      if (typeof def.placeable !== "boolean") errors.push(`${where}.placeable must be a boolean`);
      const fp = def.footprint;
      if (!isObject(fp) || !isInt(fp.w) || !isInt(fp.h) || (fp.w as number) < 1 || (fp.h as number) < 1) {
        errors.push(`${where}.footprint must be positive integer w/h`);
        continue;
      }
      if (typeof def.placeable === "boolean" && def.placeable !== placeableCategories.includes(String(def.category))) {
        errors.push(`${where}.placeable contradicts placeable_categories`);
      }
      assetDefs[assetId] = def as unknown as PortableAssetDef;
    }
  }

  const cells: [number, number][] = Array.isArray(raw.static_solid_cells) ? (raw.static_solid_cells as [number, number][]) : [];
  if (!cells.length) errors.push("static_solid_cells must be a non-empty list of [x, y]");
  const seenCells = new Set<string>();
  for (const [index, cell] of cells.entries()) {
    if (!Array.isArray(cell) || cell.length !== 2 || !isInt(cell[0]) || !isInt(cell[1])) {
      errors.push(`static_solid_cells[${index}] must be an [x, y] integer pair`);
      continue;
    }
    const key = `${cell[0]},${cell[1]}`;
    if (seenCells.has(key)) errors.push(`static_solid_cells[${index}] duplicates cell (${cell[0]}, ${cell[1]})`);
    seenCells.add(key);
    if (bounds) {
      if (cell[0] < bounds.min_x || cell[0] > bounds.max_x || cell[1] < bounds.min_y || cell[1] > bounds.max_y) {
        errors.push(`static_solid_cells[${index}] (${cell[0]}, ${cell[1]}) is outside layout bounds`);
      }
    }
  }
  const staticCellSet = new Set(seenCells);

  const seeds: SeedBuilding[] = Array.isArray(raw.seed_buildings) ? (raw.seed_buildings as SeedBuilding[]) : [];
  if (!seeds.length) errors.push("seed_buildings must be a non-empty list");
  const seenIds = new Set<string>();
  const seenLegacy = new Set<string>();
  const occupied = new Map<string, string>();
  for (const [index, seed] of seeds.entries()) {
    const where = `seed_buildings[${index}]`;
    if (!isObject(seed)) {
      errors.push(`${where} must be an object`);
      continue;
    }
    const badKeys = Object.keys(seed).filter((k) => !SEED_KEYS.has(k));
    if (badKeys.length) errors.push(`${where} has unknown keys ${badKeys.sort()}`);
    if (typeof seed.building_id !== "string" || !UUID_PATTERN.test(seed.building_id)) {
      errors.push(`${where}.building_id ${String(seed.building_id)} is not a valid UUID`);
    } else if (seenIds.has(seed.building_id)) {
      errors.push(`${where}.building_id ${seed.building_id} is duplicated`);
    } else {
      seenIds.add(seed.building_id);
    }
    if (typeof seed.legacy_object_id !== "string" || !seed.legacy_object_id) {
      errors.push(`${where}.legacy_object_id must be a non-empty string`);
    } else if (seenLegacy.has(seed.legacy_object_id)) {
      errors.push(`${where}.legacy_object_id ${seed.legacy_object_id} is duplicated`);
    } else {
      seenLegacy.add(seed.legacy_object_id);
    }
    const asset = assetDefs[String(seed.asset_id)];
    if (!asset) errors.push(`${where}.asset_id ${String(seed.asset_id)} is not defined in assets`);
    else if (!asset.placeable) errors.push(`${where}.asset_id ${String(seed.asset_id)} is not placeable`);
    if (!isInt(seed.grid_x) || !isInt(seed.grid_y)) {
      errors.push(`${where} grid_x/grid_y must be integers`);
      continue;
    }
    if (!ORIENTATION_VOCABULARY.includes(String(seed.orientation))) {
      errors.push(`${where}.orientation ${String(seed.orientation)} is not in the orientation vocabulary`);
    }
    if (asset) {
      for (let dx = 0; dx < asset.footprint.w; dx += 1) {
        for (let dy = 0; dy < asset.footprint.h; dy += 1) {
          const x = seed.grid_x + dx;
          const y = seed.grid_y + dy;
          if (bounds) {
            if (x < bounds.min_x || x > bounds.max_x || y < bounds.min_y || y > bounds.max_y) {
              errors.push(`${where} footprint leaves layout bounds at (${x}, ${y})`);
            }
          }
          if (staticCellSet.has(`${x},${y}`)) errors.push(`${where} footprint collides with static solid cell (${x}, ${y})`);
          const other = occupied.get(`${x},${y}`);
          if (other !== undefined) errors.push(`${where} footprint collides with another seed at (${x}, ${y})`);
          occupied.set(`${x},${y}`, String(seed.building_id));
        }
      }
    }
  }

  if (!Array.isArray(raw.life_scenes) || !raw.life_scenes.length || raw.life_scenes.some((s) => typeof s !== "string" || !s)) {
    errors.push("life_scenes must be a non-empty list of strings");
  } else if (new Set(raw.life_scenes).size !== raw.life_scenes.length) {
    errors.push("life_scenes contains duplicates");
  }

  return errors;
}

// ------------------------------------------------------------------ helpers

function cellsOf(x: number, y: number, w: number, h: number): string[] {
  const out: string[] = [];
  for (let dy = 0; dy < h; dy += 1) {
    for (let dx = 0; dx < w; dx += 1) out.push(`${x + dx},${y + dy}`);
  }
  return out;
}

/** Every solid-occupied cell of the STATIC BASE scene (post-split truth). */
function currentSolidCellSet(): Set<string> {
  const cells = new Set<string>();
  for (const o of LIVING_TOWN_BASE_SCENE.objects) {
    const def = ASSET_REGISTRY[o.asset];
    if (!def.flat) for (const cell of cellsOf(o.gridX, o.gridY, def.footprint.w, def.footprint.h)) cells.add(cell);
  }
  return cells;
}

function seedCellSet(seeds: SeedBuilding[]): Set<string> {
  const cells = new Set<string>();
  for (const seed of seeds) {
    const fp = contract.assets[seed.asset_id].footprint;
    for (const cell of cellsOf(seed.grid_x, seed.grid_y, fp.w, fp.h)) cells.add(cell);
  }
  return cells;
}

// Frozen once at FB-0; these literals are the buildings' permanent identity.
const FROZEN_SEED_IDS: Record<string, string> = {
  "residential-a": "5513ac64-2727-4f4f-9e9e-44441076de27",
  "residential-b": "0deb488a-6d16-4c95-b245-7ff945b77402",
  cafe: "45a22d48-57c5-4d02-95c3-517d1c36957c",
  "convenience-store": "ea217128-8498-491b-b025-42e8653f387d",
};

// ------------------------------------------------------------------ tests

describe("world contract schema", () => {
  it("validates cleanly", () => {
    expect(validateContract(contract)).toEqual([]);
  });

  it("carries the frozen contract and layout versions", () => {
    expect(contract.contract_version).toBe("living-town-world-contract-v1");
    expect(contract.layout.id).toBe("living-town-block-v1");
    expect(contract.layout.bounds).toEqual({ min_x: 0, max_x: 15, min_y: 0, max_y: 9 });
    expect(contract.layout.bounds).toEqual({
      min_x: LIVING_TOWN_BASE_SCENE.bounds.minX,
      max_x: LIVING_TOWN_BASE_SCENE.bounds.maxX,
      min_y: LIVING_TOWN_BASE_SCENE.bounds.minY,
      max_y: LIVING_TOWN_BASE_SCENE.bounds.maxY,
    });
  });

  it("carries the shared orientation vocabulary", () => {
    expect(contract.orientations).toEqual(["N", "E", "S", "W", "NE", "NW", "SE", "SW"]);
  });

  it("rejects an unknown contract version", () => {
    expect(validateContract({ ...contract, contract_version: "living-town-world-contract-v2" })).toContainEqual(
      expect.stringContaining("contract_version"),
    );
  });

  it("rejects unknown and missing top-level keys", () => {
    expect(validateContract({ ...contract, renderer: {} })).toContainEqual(expect.stringContaining("unknown keys"));
    const { life_scenes: _dropped, ...rest } = contract;
    expect(validateContract(rest)).toContainEqual(expect.stringContaining("missing keys"));
  });
});

describe("portable asset parity (registry minus renderer-only fields)", () => {
  it("covers exactly the TS asset registry ids", () => {
    expect(new Set(Object.keys(contract.assets))).toEqual(new Set(ASSET_IDS));
    expect(Object.keys(contract.assets).length).toBe(ASSET_IDS.length);
  });

  it("mirrors category, footprint and occupancy of every asset (heightPx stays out)", () => {
    for (const id of ASSET_IDS) {
      const def = ASSET_REGISTRY[id];
      // heightPx is viewBox/renderer-only and must never travel with the contract.
      expect(contract.assets[id].category, id).toBe(def.category);
      expect(contract.assets[id].footprint, id).toEqual({ w: def.footprint.w, h: def.footprint.h });
      expect(contract.assets[id].occupancy, id).toBe(def.flat ? "flat" : "solid");
    }
  });

  it("states an explicit placeable policy: only the four buildings are user-creatable", () => {
    expect(contract.placeable_categories).toEqual(["building"]);
    const placeable = Object.entries(contract.assets)
      .filter(([, def]) => def.placeable)
      .map(([id]) => id)
      .sort();
    expect(placeable).toEqual(["cafe", "convenience_store", "residential_a", "residential_b"]);
    for (const [id, def] of Object.entries(contract.assets)) {
      expect(def.placeable, id).toBe(def.category === "building");
    }
  });

  it("rejects renderer-only fields sneaking into asset definitions", () => {
    const withScreenX = structuredClone(contract) as unknown as Record<string, unknown>;
    (withScreenX.assets as Record<string, Record<string, unknown>>).residential_a.screenX = 120;
    expect(validateContract(withScreenX)).toContainEqual(expect.stringContaining("screen"));
    const withHeightPx = structuredClone(contract) as unknown as Record<string, unknown>;
    (withHeightPx.assets as Record<string, Record<string, unknown>>).cafe.heightPx = 46;
    expect(validateContract(withHeightPx)).toContainEqual(expect.stringContaining("heightPx"));
  });
});

describe("static solid occupancy parity", () => {
  const contractStatic = new Set(contract.static_solid_cells.map(([x, y]) => `${x},${y}`));

  it("is unique, integer and inside the layout bounds", () => {
    expect(contract.static_solid_cells.length).toBe(contractStatic.size);
    for (const [x, y] of contract.static_solid_cells) {
      expect(Number.isInteger(x) && Number.isInteger(y), `${x},${y}`).toBe(true);
      expect(x).toBeGreaterThanOrEqual(contract.layout.bounds.min_x);
      expect(x).toBeLessThanOrEqual(contract.layout.bounds.max_x);
      expect(y).toBeGreaterThanOrEqual(contract.layout.bounds.min_y);
      expect(y).toBeLessThanOrEqual(contract.layout.bounds.max_y);
    }
  });

  it("equals the static base scene solid cells exactly (the split already happened)", () => {
    const base = currentSolidCellSet();
    expect(base).toEqual(contractStatic);
    expect(contractStatic.size).toBe(38);
  });

  it("unions with the seed footprints into the full 49-cell pre-split solid set", () => {
    const seedCells = seedCellSet(
      SEED_WORLD.buildings.map((b) => ({
        building_id: b.building_id,
        legacy_object_id: b.building_id,
        asset_id: b.asset_id,
        grid_x: b.grid_x,
        grid_y: b.grid_y,
        orientation: b.orientation,
      })),
    );
    const union = new Set([...contractStatic, ...seedCells]);
    expect(union.size).toBe(49);
    // the four seed footprints still stand exactly where they always did
    for (const [x, y] of [
      [1, 2], [2, 2], [1, 3], [2, 3], // residential-a
      [4, 3], [5, 3], [4, 4], [5, 4], // residential-b
      [9, 4], [10, 4], // convenience-store
      [11, 3], // cafe
    ]) {
      expect(union.has(`${x},${y}`), `${x},${y}`).toBe(true);
    }
  });

  it("keeps the variable lot and the external connection anchor occupied (both still solid)", () => {
    for (const [x, y] of [[6, 0], [7, 0], [6, 1], [7, 1], [14, 6], [15, 6]]) {
      expect(contractStatic.has(`${x},${y}`), `${x},${y}`).toBe(true);
    }
  });
});

describe("seed buildings", () => {
  it("map legacy scene ids to frozen, permanent UUIDs", () => {
    expect(contract.seed_buildings.length).toBe(4);
    const ids = contract.seed_buildings.map((s) => s.building_id);
    expect(new Set(ids).size).toBe(4);
    for (const seed of contract.seed_buildings) {
      expect(seed.building_id, seed.legacy_object_id).toBe(FROZEN_SEED_IDS[seed.legacy_object_id]);
      expect(seed.building_id).toMatch(UUID_PATTERN);
    }
  });

  it("are mirrored exactly by the offline SEED_WORLD fixture (asset, position, orientation, lifecycle)", () => {
    expect(SEED_WORLD.world_version).toBe("town-world-v1");
    expect(SEED_WORLD.layout_version).toBe(contract.layout.id);
    expect(SEED_WORLD.revision).toBe(1);
    expect(SEED_WORLD.buildings.length).toBe(4);
    for (const seed of contract.seed_buildings) {
      const building = SEED_WORLD.buildings.find((b) => b.building_id === seed.building_id);
      expect(building, seed.legacy_object_id).toBeDefined();
      expect(building!.asset_id).toBe(seed.asset_id);
      expect(building!.grid_x).toBe(seed.grid_x);
      expect(building!.grid_y).toBe(seed.grid_y);
      expect(building!.orientation).toBe(seed.orientation);
      expect(building!.lifecycle).toBe("ACTIVE");
    }
  });

  it("never collide with static solids or with each other", () => {
    const staticCells = new Set(contract.static_solid_cells.map(([x, y]) => `${x},${y}`));
    expect(validateContract(contract)).toEqual([]);
    const seedCells = seedCellSet(contract.seed_buildings);
    for (const cell of seedCells) expect(staticCells.has(cell), cell).toBe(false);
    expect(seedCells.size).toBe(11);
  });

  it("reject seeds moved out of bounds or onto static solids", () => {
    const moved = structuredClone(contract);
    moved.seed_buildings[2].grid_x = 16;
    expect(validateContract(moved)).toContainEqual(expect.stringContaining("leaves layout bounds"));

    const onTree = structuredClone(contract);
    onTree.seed_buildings[0].grid_x = 0;
    onTree.seed_buildings[0].grid_y = 0;
    expect(validateContract(onTree)).toContainEqual(expect.stringContaining("static solid"));

    const onSeed = structuredClone(contract);
    onSeed.seed_buildings[2].grid_x = 4;
    onSeed.seed_buildings[2].grid_y = 3;
    expect(validateContract(onSeed)).toContainEqual(expect.stringContaining("another seed"));

    const notPlaceable = structuredClone(contract);
    notPlaceable.seed_buildings[2].asset_id = "tree";
    expect(validateContract(notPlaceable)).toContainEqual(expect.stringContaining("not placeable"));

    const reusedId = structuredClone(contract);
    reusedId.seed_buildings[3].building_id = reusedId.seed_buildings[0].building_id;
    expect(validateContract(reusedId)).toContainEqual(expect.stringContaining("duplicated"));
  });
});

describe("static base scene ↔ seeds split is lossless (post-FB-3)", () => {
  it("the static base no longer contains any placeable building", () => {
    const placeable = new Set(
      Object.entries(contract.assets).filter(([, def]) => def.placeable).map(([id]) => id),
    );
    for (const o of LIVING_TOWN_BASE_SCENE.objects) {
      expect(placeable.has(o.asset), `${o.id} uses placeable asset ${o.asset}`).toBe(false);
    }
  });

  it("the base keeps every non-building object the pre-split scene had", () => {
    // Pre-split the scene had N objects, 4 of them buildings; the base must
    // be exactly those N−4 and the composed scene exactly N again.
    const composed = composeSceneConfig(LIVING_TOWN_BASE_SCENE, SEED_WORLD);
    expect(composed.objects.length).toBe(LIVING_TOWN_BASE_SCENE.objects.length + 4);
  });

  it("the variable lot and the external anchor remain static solid scene objects", () => {
    const byId = new Map(LIVING_TOWN_BASE_SCENE.objects.map((o) => [o.id, o]));
    expect(byId.get("variable-lot")?.asset).toBe("variable_lot");
    expect(byId.get("external-connection-anchor")?.asset).toBe("external_connection_anchor");
  });
});

describe("LIFE_SCENES parity (Python rules ↔ contract ↔ TS adapter)", () => {
  it("matches the TS LIFE_SCENES vocabulary exactly (the Python side is locked by pytest)", () => {
    expect(contract.life_scenes).toEqual([...LIFE_SCENES]);
    expect(contract.life_scenes.length).toBe(11);
  });
});

describe("renderer independence of the contract file", () => {
  it("contains no renderer-specific data anywhere (keys or values)", () => {
    const text = JSON.stringify(contract).toLowerCase();
    for (const term of ["screen", "drawkey", "viewbox", "heightpx", "pixel", "palette", "token", "css", "svg", "shadow", "stroke", "facade", "viewport", "window"]) {
      expect(text).not.toContain(term);
    }
  });

  it("contains no monetary or spending-category data", () => {
    const text = JSON.stringify(contract).toLowerCase();
    for (const term of ["amount", "_minor", "transaction", "category_to_scene", "category_mapping"]) {
      expect(text).not.toContain(term);
    }
    for (const category of ['"food"', '"housing"', '"telecom"', '"entertainment"', '"education"', '"other_expense"', '"shopping"']) {
      expect(text).not.toContain(category);
    }
  });

  it("structurally rejects forbidden keys via the validator", () => {
    const cases: Record<string, unknown> = {
      screenX: 100,
      drawKey: "residential_a-1-2",
      viewBox: "0 0 640 360",
      palette: { building: "#ffffff" },
      render_token: "window-lit",
      amount_minor: 100,
      transaction_id: "T-1",
      grid_z: 0,
      category_to_scene: { FOOD: "DINING_SOCIAL" },
    };
    for (const [key, value] of Object.entries(cases)) {
      const mutated = structuredClone(contract) as unknown as Record<string, unknown>;
      (mutated.assets as Record<string, Record<string, unknown>>).residential_a[key] = value;
      expect(validateContract(mutated), key).not.toEqual([]);
    }
  });
});
