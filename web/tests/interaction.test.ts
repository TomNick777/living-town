/**
 * FB-6 interaction tests — the ephemeral TownUIState machine, the grid
 * pick math, the local ghost validity, and the rendered interaction markup.
 * Interaction state must stay ephemeral: no test may find it in any
 * persistent shape.
 */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { gridToScreen, screenToGrid, TILE_H, TILE_W } from "../src/town/scene/coordinates";
import { LIVING_TOWN_BASE_SCENE } from "../src/town/scene/livingTownScene";
import { buildSceneModel } from "../src/town/scene/sceneModel";
import { TownRenderer } from "../src/town/render/TownRenderer";
import { projectTownVisualState } from "../src/town/visual/townVisualProjector";
import { composeSceneConfig } from "../src/town/world/compose";
import { SEED_WORLD } from "../src/town/world/seedWorld";
import { isLocalPlacementValid } from "../src/town/world/ghost";
import {
  initialTownUIState,
  townUIReducer,
  type TownUIState,
} from "../src/town/ui/townUIState";
import stable from "../src/fixtures/town-state/stable.json";
import { validateTownState } from "../src/town/adapter/townState";

const CAFE_UUID = "45a22d48-57c5-4d02-95c3-517d1c36957c";
const STORE_UUID = "ea217128-8498-491b-b025-42e8653f387d";

// ------------------------------------------------------------------ reducer

function run(actions: Parameters<typeof townUIReducer>[1][], state = initialTownUIState): TownUIState {
  return actions.reduce(townUIReducer, state);
}

describe("TownUIState reducer (ephemeral interaction state)", () => {
  it("hover and selection are plain state transitions", () => {
    const s = run([{ type: "HOVER_BUILDING", buildingId: CAFE_UUID }]);
    expect(s.hoveredBuildingId).toBe(CAFE_UUID);
    const s2 = run([{ type: "HOVER_BUILDING", buildingId: CAFE_UUID }, { type: "CLEAR_HOVER" }]);
    expect(s2.hoveredBuildingId).toBeNull();
    const s3 = run([{ type: "SELECT_BUILDING", buildingId: CAFE_UUID }]);
    expect(s3.selectedBuildingId).toBe(CAFE_UUID);
  });

  it("start-create and start-move enter placement mode and drop the ghost", () => {
    const s = run([
      { type: "SELECT_BUILDING", buildingId: CAFE_UUID },
      { type: "GHOST_MOVE", cell: { x: 1, y: 1 }, valid: true },
      { type: "START_MOVE" },
    ]);
    expect(s.placementMode).toEqual({ kind: "move", buildingId: CAFE_UUID });
    expect(s.ghost).toBeNull();
    expect(s.selectedBuildingId).toBe(CAFE_UUID); // move keeps the selection

    const c = run([{ type: "START_CREATE", assetId: "cafe" }]);
    expect(c.placementMode).toEqual({ kind: "create", assetId: "cafe" });
    expect(c.selectedBuildingId).toBeNull(); // create deselects
  });

  it("START_MOVE without a selection is a no-op", () => {
    const s = run([{ type: "START_MOVE" }]);
    expect(s.placementMode).toBeNull();
  });

  it("selecting a building cancels any placement mode", () => {
    const s = run([
      { type: "START_CREATE", assetId: "cafe" },
      { type: "SELECT_BUILDING", buildingId: CAFE_UUID },
    ]);
    expect(s.placementMode).toBeNull();
    expect(s.ghost).toBeNull();
    expect(s.selectedBuildingId).toBe(CAFE_UUID);
  });

  it("escape equivalent: cancel placement, then deselect", () => {
    const placed = run([
      { type: "SELECT_BUILDING", buildingId: CAFE_UUID },
      { type: "START_MOVE" },
    ]);
    const cancelled = townUIReducer(placed, { type: "CANCEL_PLACEMENT" });
    expect(cancelled.placementMode).toBeNull();
    expect(cancelled.selectedBuildingId).toBe(CAFE_UUID);
    const deselected = townUIReducer(cancelled, { type: "DESELECT" });
    expect(deselected.selectedBuildingId).toBeNull();
  });

  it("command success clears placement, ghost and error; failure records the stable code", () => {
    const failed = run([
      { type: "START_CREATE", assetId: "cafe" },
      { type: "COMMAND_FAILED", code: "COLLISION", message: "nope" },
    ]);
    expect(failed.lastCommandError).toEqual({ code: "COLLISION", message: "nope" });
    expect(failed.placementMode).not.toBeNull(); // retry stays possible
    const cleared = townUIReducer(failed, { type: "CLEAR_COMMAND_ERROR" });
    expect(cleared.lastCommandError).toBeNull();
    const ok = townUIReducer(failed, { type: "COMMAND_SUCCEEDED" });
    expect(ok.placementMode).toBeNull();
    expect(ok.ghost).toBeNull();
    expect(ok.lastCommandError).toBeNull();
  });

  it("world reload clears dangling hover/selection but keeps live ones", () => {
    const s = run([
      { type: "SELECT_BUILDING", buildingId: CAFE_UUID },
      { type: "HOVER_BUILDING", buildingId: STORE_UUID },
      { type: "WORLD_RELOADED", buildingIds: SEED_WORLD.buildings.map((b) => b.building_id) },
    ]);
    expect(s.selectedBuildingId).toBe(CAFE_UUID); // still alive
    expect(s.hoveredBuildingId).toBe(STORE_UUID);
    const s2 = run([{ type: "WORLD_RELOADED", buildingIds: [CAFE_UUID] }]);
    expect(s2.hoveredBuildingId).toBeNull(); // gone from the world
    const s3 = run([{ type: "WORLD_RELOADED", buildingIds: [] }]);
    expect(s3.selectedBuildingId).toBeNull(); // demolished elsewhere
  });
});

// ------------------------------------------------------------------ math

describe("screenToGrid (click → cell)", () => {
  it("inverts gridToScreen for every cell centre", () => {
    for (let x = 0; x <= 15; x += 1) {
      for (let y = 0; y <= 9; y += 1) {
        // centre of the cell diamond in screen space
        const c = gridToScreen(x + 0.5, y + 0.5, 0);
        expect(screenToGrid(c.sx, c.sy)).toEqual({ x, y });
      }
    }
  });

  it("maps a screen offset back with the documented tile size", () => {
    expect(TILE_W).toBe(64);
    expect(TILE_H).toBe(32);
    const p = gridToScreen(3, 2);
    expect(screenToGrid(p.sx + 1, p.sy + 1)).toEqual({ x: 3, y: 2 });
  });
});

// ------------------------------------------------------------------ ghost

describe("isLocalPlacementValid (web-side ghost approximation)", () => {
  it("accepts free ground and rejects static solids, bounds and active buildings", () => {
    expect(isLocalPlacementValid(SEED_WORLD, "cafe", 5, 1)).toBe(true);
    expect(isLocalPlacementValid(SEED_WORLD, "cafe", 6, 0)).toBe(false); // variable lot
    expect(isLocalPlacementValid(SEED_WORLD, "residential_a", 15, 9)).toBe(false); // out of bounds
    expect(isLocalPlacementValid(SEED_WORLD, "cafe", 4, 3)).toBe(false); // on residential-b
    expect(isLocalPlacementValid(SEED_WORLD, "cafe", 11, 3)).toBe(false); // on the cafe itself
  });

  it("excludes the moving building and ignores demolished ones", () => {
    expect(isLocalPlacementValid(SEED_WORLD, "residential_a", 11, 3, CAFE_UUID)).toBe(false); // (11,4) is static
    const demolishedCafe = {
      ...SEED_WORLD,
      buildings: SEED_WORLD.buildings.map((b) =>
        b.building_id === CAFE_UUID ? { ...b, lifecycle: "DEMOLISHED" as const } : b,
      ),
    };
    expect(isLocalPlacementValid(demolishedCafe, "cafe", 11, 3)).toBe(true); // ghost may stand again
  });
});

// ------------------------------------------------------------------ markup

const model = buildSceneModel(composeSceneConfig(LIVING_TOWN_BASE_SCENE, SEED_WORLD));
const visual = projectTownVisualState(validateTownState(stable));

function markupWith(interaction: Partial<Parameters<typeof TownRenderer>[0]["interaction"]> | null): string {
  return renderToStaticMarkup(
    createElement(TownRenderer, {
      model,
      visual,
      interaction: interaction === null
        ? null
        : {
            model,
            hoveredBuildingId: null,
            selectedBuildingId: null,
            ghost: null,
            ghostAssetId: null,
            placementActive: false,
            onHoverBuilding: () => undefined,
            onLeaveBuilding: () => undefined,
            onSelectBuilding: () => undefined,
            onBackgroundClick: () => undefined,
            onCellClick: () => undefined,
            onGhostMove: () => undefined,
            ...interaction,
          },
    }),
  );
}

describe("interaction markup", () => {
  it("renders invisible hit geometry for every active building", () => {
    const text = markupWith({});
    for (const id of SEED_WORLD.buildings.map((b) => b.building_id)) {
      expect(text).toContain(`data-hit-id="${id}"`);
    }
    expect(text).toContain('class="town-hit-ground"');
  });

  it("shows a selection outline only for the selected building", () => {
    const selected = markupWith({ selectedBuildingId: CAFE_UUID });
    const hovered = markupWith({ hoveredBuildingId: CAFE_UUID });
    const none = markupWith({});
    // the interaction outline colours are new palette tokens used nowhere else
    const SELECTED = "#1f4e5f";
    const HOVER = "#3c5a76";
    expect(selected).toContain(`stroke="${SELECTED}"`);
    expect(selected).not.toContain(`stroke="${HOVER}"`);
    expect(hovered).toContain(`stroke="${HOVER}"`);
    expect(hovered).not.toContain(`stroke="${SELECTED}"`);
    expect(none).not.toContain(`stroke="${SELECTED}"`);
    expect(none).not.toContain(`stroke="${HOVER}"`);
  });

  it("renders the ghost with its validity flag", () => {
    const valid = markupWith({ placementActive: true, ghostAssetId: "cafe", ghost: { x: 5, y: 1, valid: true } });
    const invalid = markupWith({ placementActive: true, ghostAssetId: "cafe", ghost: { x: 6, y: 0, valid: false } });
    expect(valid).toContain('data-ghost-valid="true"');
    expect(invalid).toContain('data-ghost-valid="false"');
  });

  it("no interaction markup leaks financial vocabulary", () => {
    expect(markupWith({ placementActive: true, ghostAssetId: "cafe", ghost: { x: 5, y: 1, valid: true } })).not.toMatch(
      /_minor|amount|income|expense/i,
    );
  });
});
