/**
 * Render tokens — the renderer's ONLY interpretation of TownVisualState.
 *
 * Every visual level is translated here, in one table, into presentation
 * tokens. Asset components read tokens, never TownVisualState fields, so a
 * future refinement ("what does BUSY look like?") changes this file and
 * nothing else. Values are provisional placeholders for the architecture
 * phase, not product rules (docs/living-town-renderer-architecture.md §10).
 *
 * This module has no access to TownState: amounts cannot leak in here.
 */

import type { TownVisualState } from "../visual/visualState";

export type WindowLight = "dim" | "partial" | "warm" | "full";
export type ShopFront = "quiet" | "open" | "lively";
export type AnchorFlow = "dormant" | "trickle" | "steady" | "busy";
export type PublicMood = "serene" | "calm" | "tense";
export type Greenery = "bare" | "sparse" | "tended" | "blooming";
export type DataHaze = "none" | "review" | "uncertain";

export interface RenderTokens {
  /** Share of residential windows that are lit (deterministic per building). */
  windowLight: WindowLight;
  /** Static figures placed on the scene's living spots, in priority order. */
  pedestrians: number;
  /** Shop sign / glass-front lighting. */
  shopFront: ShopFront;
  /** Treatment of the external connection anchor (towards Otter Holdings). */
  anchorFlow: AnchorFlow;
  /** Ambient tint of public space; "tense" is restrained, never ruinous. */
  publicMood: PublicMood;
  /** Flowers in planters and on the green corner. */
  greenery: Greenery;
  /** Honesty marker for data gaps — separate from every life token. */
  dataHaze: DataHaze;
  /** The variable lot never has a project in v1. */
  lotState: "EMPTY";
}

const WINDOW_LEVELS: WindowLight[] = ["dim", "partial", "warm", "full"];

export function renderTokens(v: TownVisualState): RenderTokens {
  const pedestrians = { QUIET: 0, NORMAL: 2, ACTIVE: 4, BUSY: 6 }[v.ambient_activity];
  const shopFront: ShopFront = { QUIET: "quiet", NORMAL: "open", ACTIVE: "open", BUSY: "lively" }[
    v.ambient_activity
  ] as ShopFront;

  // Residential light follows felt stability; severe/high tension dims it by
  // one step at most — tight months look more restrained, not derelict.
  const base = { FRAGILE: 0, NORMAL: 1, STABLE: 2, STRONG: 3 }[v.residential_stability];
  const tensionStep = v.consumption_tension === "HIGH" || v.consumption_tension === "SEVERE" ? 1 : 0;
  const windowLight = WINDOW_LEVELS[Math.max(0, Math.min(3, base - tensionStep))];

  const anchorFlow: AnchorFlow = { NONE: "dormant", LOW: "trickle", NORMAL: "steady", HIGH: "busy" }[
    v.external_flow_activity
  ] as AnchorFlow;

  const publicMood: PublicMood = { LOW: "serene", NORMAL: "calm", HIGH: "tense", SEVERE: "tense" }[
    v.consumption_tension
  ] as PublicMood;

  const greenery: Greenery = { DEPLETED: "bare", LOW: "sparse", HEALTHY: "tended", STRONG: "blooming" }[
    v.reserve_state
  ] as Greenery;

  const dataHaze: DataHaze = { HEALTHY: "none", REVIEW: "review", UNCERTAIN: "uncertain" }[
    v.data_certainty
  ] as DataHaze;

  return { windowLight, pedestrians, shopFront, anchorFlow, publicMood, greenery, dataHaze, lotState: "EMPTY" };
}

/** Lit-window share per token, in percent — used with a stable per-window hash. */
export const LIT_WINDOW_PERCENT: Record<WindowLight, number> = {
  dim: 22,
  partial: 45,
  warm: 70,
  full: 92,
};

/** Small deterministic hash so the same building always lights the same windows. */
export function stableHash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h % 100;
}
