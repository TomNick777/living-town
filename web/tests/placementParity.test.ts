/**
 * Placement parity — TS defensive rules mirror vs Python authority.
 *
 * Python owns placement logic (world/placement.py) and the world contract
 * owns the data. The TS SceneModel keeps its build-time validation as a
 * defensive net, and THIS suite executes the shared golden corpus
 * (placement_golden_v1.json) through a TS mirror of the rules: both
 * implementations must reach identical verdicts for every case, so rule
 * drift fails loudly on at least one side.
 *
 * The mirror here is test-only: production TS never becomes a second
 * write-path authority (functional baseline §5, decision A).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ASSET_REGISTRY } from "../src/town/scene/assets";

const CONTRACTS_DIR = join(
  __dirname,
  "..",
  "..",
  "src",
  "life_energy",
  "living_town",
  "world",
  "contracts",
);

interface PortableAssetDef {
  category: string;
  footprint: { w: number; h: number };
  occupancy: string;
  placeable: boolean;
}

interface WorldContract {
  contract_version: string;
  layout: { id: string; bounds: { min_x: number; max_x: number; min_y: number; max_y: number } };
  assets: Record<string, PortableAssetDef>;
  static_solid_cells: [number, number][];
}

interface GoldenCase {
  name: string;
  candidate: { asset_id: string; grid_x: number; grid_y: number };
  active_buildings?: { building_id: string; asset_id: string; grid_x: number; grid_y: number }[];
  demolished_buildings?: { building_id: string; asset_id: string; grid_x: number; grid_y: number }[];
  exclude_building_id?: string;
  expected: string;
}

const contract: WorldContract = JSON.parse(
  readFileSync(join(CONTRACTS_DIR, "world_contract_v1.json"), "utf8"),
);
const golden: { golden_version: string; cases: GoldenCase[] } = JSON.parse(
  readFileSync(join(CONTRACTS_DIR, "placement_golden_v1.json"), "utf8"),
);

// ------------------------------------------------------- TS rules mirror

function cellsOf(assetId: string, gridX: number, gridY: number): [number, number][] {
  const def = contract.assets[assetId];
  const cells: [number, number][] = [];
  for (let dx = 0; dx < def.footprint.w; dx += 1) {
    for (let dy = 0; dy < def.footprint.h; dy += 1) {
      cells.push([gridX + dx, gridY + dy]);
    }
  }
  return cells;
}

function evaluate(candidate: GoldenCase["candidate"], active: NonNullable<GoldenCase["active_buildings"]>, exclude?: string): string {
  const asset = contract.assets[candidate.asset_id];
  if (!asset) return "UNKNOWN_ASSET";
  if (!asset.placeable) return "ASSET_NOT_PLACEABLE";
  if (!Number.isInteger(candidate.grid_x) || !Number.isInteger(candidate.grid_y)) {
    return "INVALID_COORDINATE";
  }
  const cells = cellsOf(candidate.asset_id, candidate.grid_x, candidate.grid_y);
  const { min_x, max_x, min_y, max_y } = contract.layout.bounds;
  if (cells.some(([x, y]) => x < min_x || x > max_x || y < min_y || y > max_y)) {
    return "OUT_OF_BOUNDS";
  }
  const staticSet = new Set(contract.static_solid_cells.map(([x, y]) => `${x},${y}`));
  if (cells.some(([x, y]) => staticSet.has(`${x},${y}`))) {
    return "COLLISION";
  }
  for (const building of active) {
    if (exclude !== undefined && building.building_id === exclude) continue;
    const other = new Set(cellsOf(building.asset_id, building.grid_x, building.grid_y).map(([x, y]) => `${x},${y}`));
    if (cells.some(([x, y]) => other.has(`${x},${y}`))) {
      return "COLLISION";
    }
  }
  return "OK";
}

// ------------------------------------------------------------------ tests

describe("placement golden parity (Python authority ↔ TS mirror)", () => {
  it("pins the golden corpus version and breadth", () => {
    expect(golden.golden_version).toBe("living-town-placement-golden-v1");
    expect(golden.cases.length).toBeGreaterThanOrEqual(10);
    const names = golden.cases.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });

  for (const testCase of golden.cases) {
    it(`case: ${testCase.name}`, () => {
      const verdict = evaluate(
        testCase.candidate,
        testCase.active_buildings ?? [],
        testCase.exclude_building_id,
      );
      expect(verdict).toBe(testCase.expected);
    });
  }

  it("the TS mirror agrees with the TS asset registry on footprints and occupancy", () => {
    // The parity mirror derives footprints from the shared contract while
    // production composition derives them from ASSET_REGISTRY; if the two
    // diverge, the authority and the defensive net would judge differently.
    for (const [assetId, def] of Object.entries(contract.assets)) {
      const ts = ASSET_REGISTRY[assetId as keyof typeof ASSET_REGISTRY];
      expect(ts, `registry is missing contract asset ${assetId}`).toBeDefined();
      expect(ts.footprint).toEqual(def.footprint);
      expect(ts.flat).toBe(def.occupancy === "flat");
      expect(ts.category).toBe(def.category);
    }
  });
});
