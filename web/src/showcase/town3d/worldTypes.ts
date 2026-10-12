import type { TownVisualState } from "../../town/visual/visualState";

export interface TownWorld {
  update: (visual: TownVisualState, dusk: boolean) => void;
  tick: (seconds: number, animate: boolean) => void;
  dispose: () => void;
}
