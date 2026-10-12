/**
 * Demo catalogue — the three visual-state demonstrations of this phase.
 * Each demo is a synthetic Town State fixture pushed through the real
 * adapter + projector; nothing here hand-writes a TownVisualState.
 */

import { validateTownState, type TownState } from "../town/adapter/townState";
import stable from "../fixtures/town-state/stable.json";
import busyTight from "../fixtures/town-state/busy-tight.json";
import capitalExport from "../fixtures/town-state/capital-export.json";

export interface Demo {
  key: "A" | "B" | "C";
  title: string;
  subtitle: string;
  townState: TownState;
}

export const DEMOS: Demo[] = [
  { key: "A", title: "平稳日常", subtitle: "Stable everyday life", townState: validateTownState(stable) },
  { key: "B", title: "热闹但紧绷", subtitle: "Busy but financially tight", townState: validateTownState(busyTight) },
  { key: "C", title: "平稳 · 资本外输", subtitle: "Stable + capital export", townState: validateTownState(capitalExport) },
];
