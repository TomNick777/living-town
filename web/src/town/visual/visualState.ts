/**
 * TownVisualState — visual semantics of the living town for one period.
 *
 * This is the boundary between the financial domain and everything visual.
 * Renderers, scene models and CSS may read THIS and only this. It contains
 * no amounts, no ratios, no scores: only named levels plus the explanation
 * of how each level was reached (docs/living-town-renderer-architecture.md).
 */

import type { LifeScene } from "../adapter/townState";

export const VISUAL_PROJECTION_VERSION = "living-town-visual-v1";

/** Overall street-level activity of the town. From vitality — never from amounts. */
export type AmbientActivity = "QUIET" | "NORMAL" | "ACTIVE" | "BUSY";

/**
 * Felt stability of residential life. From stability.
 * NORMAL is reserved: living-town-v1 has three stability bands, so v1 rules
 * only produce FRAGILE / STABLE / STRONG. The level exists so a finer future
 * rules version can use it without changing the visual contract.
 */
export type ResidentialStability = "FRAGILE" | "NORMAL" | "STABLE" | "STRONG";

/** Consumption pressure as a visual tension level. Not "how many shops". */
export type ConsumptionTension = "LOW" | "NORMAL" | "HIGH" | "SEVERE";

/** Reserve / storage state. From saving_strength. */
export type ReserveState = "DEPLETED" | "LOW" | "HEALTHY" | "STRONG";

/** Activity of the connection to the external capital system (Otter Holdings). */
export type ExternalFlowActivity = "NONE" | "LOW" | "NORMAL" | "HIGH";

/**
 * How trustworthy the underlying data is. Deliberately separate from every
 * "life" level above: uncertain data does not mean life is going badly.
 */
export type DataCertainty = "HEALTHY" | "REVIEW" | "UNCERTAIN";

/** Activation of one life scene. Intensity only — never a building. */
export type SceneActivation = "IDLE" | "NORMAL" | "ACTIVE" | "HIGH";

export interface VisualExplanation {
  /** TownVisualState field name, e.g. "ambient_activity". */
  field: string;
  /** The produced level, e.g. "ACTIVE". */
  value: string;
  /** Stable rule identifier inside VISUAL_PROJECTION_VERSION, e.g. "VR-1". */
  rule: string;
  /** Human-readable trace back to TownState readings (bands, scores, counts). */
  because: string[];
}

export interface TownVisualState {
  visual_projection_version: string;
  /** projection_version of the consumed Town State, for audit. */
  source_projection_version: string;
  /** Period label only (e.g. "2026-08"); carries no amounts. */
  period_month: string;
  ambient_activity: AmbientActivity;
  residential_stability: ResidentialStability;
  consumption_tension: ConsumptionTension;
  reserve_state: ReserveState;
  external_flow_activity: ExternalFlowActivity;
  data_certainty: DataCertainty;
  scene_activity: Record<LifeScene, SceneActivation>;
  explanations: VisualExplanation[];
}
