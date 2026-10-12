/**
 * TownUIState — the ephemeral interaction state machine (FB-6, §14).
 *
 * Pure reducer so the transitions are testable without React. NOTHING in
 * this state may reach SQLite, the world JSON or any command: hover,
 * selection, placement mode, ghost and the last error are web-session-only
 * and die with the page.
 */

export type PlacementMode =
  | null
  | { kind: "create"; assetId: string }
  | { kind: "move"; buildingId: string };

export interface TownUIState {
  hoveredBuildingId: string | null;
  selectedBuildingId: string | null;
  placementMode: PlacementMode;
  ghost: { x: number; y: number; valid: boolean } | null;
  lastCommandError: { code: string; message: string } | null;
}

export const initialTownUIState: TownUIState = {
  hoveredBuildingId: null,
  selectedBuildingId: null,
  placementMode: null,
  ghost: null,
  lastCommandError: null,
};

export type TownUIAction =
  | { type: "HOVER_BUILDING"; buildingId: string }
  | { type: "CLEAR_HOVER" }
  | { type: "SELECT_BUILDING"; buildingId: string }
  | { type: "DESELECT" }
  | { type: "START_CREATE"; assetId: string }
  | { type: "START_MOVE" }
  | { type: "CANCEL_PLACEMENT" }
  | { type: "GHOST_MOVE"; cell: { x: number; y: number }; valid: boolean }
  | { type: "COMMAND_FAILED"; code: string; message: string }
  | { type: "CLEAR_COMMAND_ERROR" }
  | { type: "COMMAND_SUCCEEDED" }
  | { type: "WORLD_RELOADED"; buildingIds: readonly string[] };

export function townUIReducer(state: TownUIState, action: TownUIAction): TownUIState {
  switch (action.type) {
    case "HOVER_BUILDING":
      return { ...state, hoveredBuildingId: action.buildingId };
    case "CLEAR_HOVER":
      return { ...state, hoveredBuildingId: null };
    case "SELECT_BUILDING":
      // clicking a building never lingers in a placement mode
      return { ...state, selectedBuildingId: action.buildingId, placementMode: null, ghost: null };
    case "DESELECT":
      return { ...state, selectedBuildingId: null, placementMode: null, ghost: null };
    case "START_CREATE":
      return {
        ...state,
        placementMode: { kind: "create", assetId: action.assetId },
        selectedBuildingId: null,
        ghost: null,
      };
    case "START_MOVE":
      if (state.selectedBuildingId === null) return state;
      return { ...state, placementMode: { kind: "move", buildingId: state.selectedBuildingId }, ghost: null };
    case "CANCEL_PLACEMENT":
      return { ...state, placementMode: null, ghost: null };
    case "GHOST_MOVE":
      return { ...state, ghost: { x: action.cell.x, y: action.cell.y, valid: action.valid } };
    case "COMMAND_FAILED":
      return { ...state, lastCommandError: { code: action.code, message: action.message } };
    case "CLEAR_COMMAND_ERROR":
      return { ...state, lastCommandError: null };
    case "COMMAND_SUCCEEDED":
      return { ...state, placementMode: null, ghost: null, lastCommandError: null };
    case "WORLD_RELOADED": {
      const alive = new Set(action.buildingIds);
      // defensive rule §14: a world refresh must not leave dangling references
      return {
        ...state,
        selectedBuildingId:
          state.selectedBuildingId !== null && alive.has(state.selectedBuildingId) ? state.selectedBuildingId : null,
        hoveredBuildingId:
          state.hoveredBuildingId !== null && alive.has(state.hoveredBuildingId) ? state.hoveredBuildingId : null,
      };
    }
  }
}
