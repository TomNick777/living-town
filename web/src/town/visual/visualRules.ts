/**
 * Visual projection rules — living-town-visual-v1.
 *
 * Every table here maps a TownState *band* (already computed by the domain
 * layer, town-rules-v1) to a visual level. No threshold on amounts exists in
 * this file by design: the frontend never re-derives financial meaning
 * (docs/living-town-ui-contract.md: "UI 不得硬编码 band 阈值").
 *
 * Changing any table = bump VISUAL_PROJECTION_VERSION.
 */

import type {
  DataHealthBand,
  PressureBand,
  StabilityBand,
  StrengthBand,
  VitalityBand,
} from "../adapter/townState";
import type {
  AmbientActivity,
  ConsumptionTension,
  DataCertainty,
  ExternalFlowActivity,
  ReserveState,
  ResidentialStability,
  SceneActivation,
} from "./visualState";

/** VR-1: vitality band -> ambient activity (amounts are structurally absent). */
export const AMBIENT_BY_VITALITY: Record<VitalityBand, AmbientActivity> = {
  DORMANT: "QUIET",
  QUIET: "NORMAL",
  ALIVE: "ACTIVE",
  THRIVING: "BUSY",
};

/** VR-2: stability band -> residential stability (NORMAL reserved, see visualState.ts). */
export const RESIDENTIAL_BY_STABILITY: Record<StabilityBand, ResidentialStability> = {
  FRAGILE: "FRAGILE",
  MODERATE: "STABLE",
  SOLID: "STRONG",
};

/** VR-3: consumption_pressure band -> consumption tension. */
export const TENSION_BY_PRESSURE: Record<PressureBand, ConsumptionTension> = {
  LOW: "LOW",
  NORMAL: "NORMAL",
  HIGH: "HIGH",
  EXTREME: "SEVERE",
};

/** VR-4: saving_strength band -> reserve state. */
export const RESERVE_BY_SAVING: Record<StrengthBand, ReserveState> = {
  NONE: "DEPLETED",
  WEAK: "LOW",
  MODERATE: "HEALTHY",
  STRONG: "STRONG",
};

/** VR-5: investment_outflow band -> external flow activity (town -> Otter Holdings). */
export const EXTERNAL_FLOW_BY_INVESTMENT: Record<StrengthBand, ExternalFlowActivity> = {
  NONE: "NONE",
  WEAK: "LOW",
  MODERATE: "NORMAL",
  STRONG: "HIGH",
};

/** VR-6: data_health band -> data certainty. */
export const CERTAINTY_BY_DATA_HEALTH: Record<DataHealthBand, DataCertainty> = {
  HEALTHY: "HEALTHY",
  REVIEW: "REVIEW",
  NEEDS_WORK: "UNCERTAIN",
};

/**
 * VR-6b: an unbalanced energy identity (TownState.financial.balanced = false)
 * is a data gap that data_health does not score (see projection doc, O-1).
 * It can only lower certainty from HEALTHY to REVIEW; it never touches any
 * life level.
 */
export const CERTAINTY_FLOOR_WHEN_UNBALANCED: DataCertainty = "REVIEW";

/**
 * VR-7: scene activation from *active days* in the period. Days and counts
 * are activity facts, not money; amount_minor is deliberately never read.
 */
export const SCENE_ACTIVATION_DAY_STEPS: readonly { maxActiveDays: number; level: SceneActivation }[] = [
  { maxActiveDays: 0, level: "IDLE" },
  { maxActiveDays: 3, level: "NORMAL" },
  { maxActiveDays: 10, level: "ACTIVE" },
  { maxActiveDays: Number.POSITIVE_INFINITY, level: "HIGH" },
];

export function sceneActivationForActiveDays(activeDays: number): SceneActivation {
  const step = SCENE_ACTIVATION_DAY_STEPS.find((s) => activeDays <= s.maxActiveDays);
  return step ? step.level : "HIGH";
}
