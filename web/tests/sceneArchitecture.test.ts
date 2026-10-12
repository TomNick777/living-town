/**
 * Scene architecture tests — coordinate system, asset registry, scene
 * config integrity and painter's order.
 */

import { describe, expect, it } from "vitest";
import { ASSET_IDS, ASSET_REGISTRY } from "../src/town/scene/assets";
import { TILE_H, TILE_W, drawKey, gridToScreen, groundQuad, viewBoxFor } from "../src/town/scene/coordinates";
import { LIVING_TOWN_BASE_SCENE, type SceneConfig } from "../src/town/scene/livingTownScene";
import { buildSceneModel, SceneConfigError } from "../src/town/scene/sceneModel";
import { ASSET_COMPONENTS } from "../src/town/render/assetComponents";

describe("isometric coordinate system", () => {
  it("projects grid cells with the documented formula", () => {
    expect(gridToScreen(0, 0)).toEqual({ sx: 0, sy: 0 });
    expect(gridToScreen(1, 0)).toEqual({ sx: TILE_W / 2, sy: TILE_H / 2 });
    expect(gridToScreen(0, 1)).toEqual({ sx: -TILE_W / 2, sy: TILE_H / 2 });
    expect(gridToScreen(2, 3, 10)).toEqual({ sx: ((2 - 3) * TILE_W) / 2, sy: ((2 + 3) * TILE_H) / 2 - 10 });
  });

  it("uses a 2:1 diamond tile", () => {
    const [n, e, s, w] = groundQuad(3, 4, { w: 1, h: 1 });
    expect(e.sx - w.sx).toBe(TILE_W);
    expect(s.sy - n.sy).toBe(TILE_H);
  });

  it("orders flat tiles before solids and nearer footprints later", () => {
    const fp = { w: 1, h: 1 };
    expect(drawKey(5, 5, 0, fp, true)).toBeLessThan(drawKey(0, 0, 0, fp, false));
    expect(drawKey(1, 1, 0, fp, false)).toBeLessThan(drawKey(2, 1, 0, fp, false));
    expect(drawKey(1, 1, 0, { w: 2, h: 2 }, false)).toBeGreaterThan(drawKey(2, 1, 0, fp, false));
  });

  it("viewBox contains every cell of the bounds", () => {
    const bounds = LIVING_TOWN_BASE_SCENE.bounds;
    const vb = viewBoxFor(bounds, 120);
    for (let x = bounds.minX; x <= bounds.maxX + 1; x += 1) {
      for (let y = bounds.minY; y <= bounds.maxY + 1; y += 1) {
        const p = gridToScreen(x, y);
        expect(p.sx).toBeGreaterThanOrEqual(vb.x);
        expect(p.sx).toBeLessThanOrEqual(vb.x + vb.w);
        expect(p.sy).toBeGreaterThanOrEqual(vb.y);
        expect(p.sy).toBeLessThanOrEqual(vb.y + vb.h);
      }
    }
  });
});

describe("asset registry", () => {
  it("has a definition and a drawing component for every asset id", () => {
    for (const id of ASSET_IDS) {
      expect(ASSET_REGISTRY[id].id).toBe(id);
      expect(ASSET_REGISTRY[id].footprint.w).toBeGreaterThan(0);
      expect(ASSET_REGISTRY[id].footprint.h).toBeGreaterThan(0);
      expect(typeof ASSET_COMPONENTS[id]).toBe("function");
    }
  });

  it("covers the required first-version asset families", () => {
    const ids = new Set<string>(ASSET_IDS);
    for (const required of [
      "residential_a", "residential_b", "convenience_store", "cafe",
      "road_straight", "road_corner", "sidewalk", "crosswalk", "bridge",
      "street_light", "bench", "vending_machine", "bicycle_rack",
      "tree", "shrub", "planter",
      "pedestrian", "bicycle", "car",
      "external_connection_anchor", "variable_lot",
    ]) {
      expect(ids.has(required), required).toBe(true);
    }
  });

  it("does not name any spending category", () => {
    const text = ASSET_IDS.join(" ");
    expect(text).not.toMatch(/food|shopping|transport|saving|bank|health|income|expense/i);
  });
});

describe("living-town scene config", () => {
  const model = buildSceneModel(LIVING_TOWN_BASE_SCENE);

  it("builds without errors and deterministically", () => {
    expect(JSON.stringify(buildSceneModel(LIVING_TOWN_BASE_SCENE))).toBe(JSON.stringify(model));
  });

  it("has unique object ids", () => {
    const ids = LIVING_TOWN_BASE_SCENE.objects.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("places every object on integer grid coordinates inside the bounds", () => {
    const b = LIVING_TOWN_BASE_SCENE.bounds;
    for (const o of LIVING_TOWN_BASE_SCENE.objects) {
      expect(Number.isInteger(o.gridX) && Number.isInteger(o.gridY), o.id).toBe(true);
      expect(o.gridX).toBeGreaterThanOrEqual(b.minX);
      expect(o.gridY).toBeGreaterThanOrEqual(b.minY);
      const fp = ASSET_REGISTRY[o.asset].footprint;
      expect(o.gridX + fp.w - 1).toBeLessThanOrEqual(b.maxX);
      expect(o.gridY + fp.h - 1).toBeLessThanOrEqual(b.maxY);
    }
  });

  it("uses only registered assets", () => {
    for (const o of LIVING_TOWN_BASE_SCENE.objects) expect(ASSET_REGISTRY[o.asset], o.id).toBeDefined();
  });

  it("contains the static base and NO building (buildings come from the world layer)", () => {
    const count = (asset: string) => model.objects.filter((o) => o.asset === asset).length;
    expect(count("residential_a")).toBe(0);
    expect(count("residential_b")).toBe(0);
    expect(count("convenience_store")).toBe(0);
    expect(count("cafe")).toBe(0);
    expect(count("bus_stop")).toBe(1);
    expect(count("street_light")).toBeGreaterThanOrEqual(3);
    expect(count("bench")).toBeGreaterThanOrEqual(1);
    expect(count("tree")).toBeGreaterThanOrEqual(6);
    expect(count("road_straight")).toBeGreaterThanOrEqual(10);
    expect(count("road_corner")).toBeGreaterThanOrEqual(1);
    expect(count("sidewalk")).toBeGreaterThanOrEqual(10);
    expect(count("crosswalk")).toBeGreaterThanOrEqual(1);
    expect(count("water")).toBeGreaterThanOrEqual(10);
    expect(count("bridge")).toBe(1);
    expect(count("variable_lot")).toBe(1);
    expect(count("external_connection_anchor")).toBe(1);
  });

  it("exposes the external connection anchor and the variable lot by id", () => {
    expect(model.externalConnectionAnchorId).toBe("external-connection-anchor");
    expect(model.objects.find((o) => o.id === model.externalConnectionAnchorId)?.asset).toBe("external_connection_anchor");
    expect(model.objects.find((o) => o.id === model.variableLotId)?.asset).toBe("variable_lot");
  });

  it("orders objects by painter's key with a total, stable tie-break", () => {
    for (let i = 1; i < model.objects.length; i += 1) {
      const prev = model.objects[i - 1];
      const cur = model.objects[i];
      expect(prev.key < cur.key || (prev.key === cur.key && prev.id.localeCompare(cur.id) < 0)).toBe(true);
    }
  });

  it("derives every screen position from the coordinate system", () => {
    for (const o of model.objects) expect(o.screen).toEqual(gridToScreen(o.grid.x, o.grid.y, o.grid.z));
  });

  it("carries no financial vocabulary", () => {
    expect(JSON.stringify(LIVING_TOWN_BASE_SCENE)).not.toMatch(/_minor|amount|income|consumption|investment|saving/i);
  });
});

describe("scene model validation", () => {
  const base: SceneConfig = {
    id: "t",
    bounds: { minX: 0, maxX: 3, minY: 0, maxY: 3 },
    objects: [
      { id: "lot", asset: "variable_lot", gridX: 0, gridY: 0 },
      { id: "anchor", asset: "external_connection_anchor", gridX: 2, gridY: 3 },
    ],
    livingSpots: [],
    externalConnectionAnchorId: "anchor",
    variableLotId: "lot",
  };

  it("rejects duplicate ids", () => {
    expect(() => buildSceneModel({ ...base, objects: [...base.objects, { id: "lot", asset: "tree", gridX: 3, gridY: 0 }] })).toThrow(SceneConfigError);
  });

  it("rejects overlapping solid footprints", () => {
    expect(() => buildSceneModel({ ...base, objects: [...base.objects, { id: "tree", asset: "tree", gridX: 1, gridY: 1 }] })).toThrow(/overlaps/);
  });

  it("rejects footprints leaving the bounds", () => {
    expect(() => buildSceneModel({ ...base, objects: [...base.objects, { id: "x", asset: "residential_a", gridX: 3, gridY: 0 }] })).toThrow(/bounds/);
  });

  it("rejects non-integer coordinates", () => {
    expect(() => buildSceneModel({ ...base, objects: [...base.objects, { id: "x", asset: "tree", gridX: 2.5, gridY: 1 }] })).toThrow(/integer/);
  });

  it("allows furniture on top of flat tiles", () => {
    expect(() => buildSceneModel({ ...base, objects: [...base.objects, { id: "s", asset: "sidewalk", gridX: 3, gridY: 1 }, { id: "l", asset: "street_light", gridX: 3, gridY: 1 }] })).not.toThrow();
  });
});
