/**
 * TownVisualProjector — TownState -> TownVisualState.
 *
 * Deterministic, pure, side-effect free. Consumes the domain's bands and
 * scores (docs/living-town-ui-contract.md, first-class data source) and
 * produces visual levels plus an explanation per field, so the visual state
 * is never a black box: "why is ambient_activity ACTIVE?" is always answerable.
 *
 * What this function must never do:
 *   - read amount_minor / *_minor fields to decide a visual level;
 *   - recompute any financial ratio;
 *   - decide concrete presentation (lights, NPC counts) — that is the
 *     renderer's token table, one layer down.
 */

import { LIFE_SCENES, type LifeScene, type TownState } from "../adapter/townState";
import {
  AMBIENT_BY_VITALITY,
  CERTAINTY_BY_DATA_HEALTH,
  CERTAINTY_FLOOR_WHEN_UNBALANCED,
  EXTERNAL_FLOW_BY_INVESTMENT,
  RESERVE_BY_SAVING,
  RESIDENTIAL_BY_STABILITY,
  TENSION_BY_PRESSURE,
  sceneActivationForActiveDays,
} from "./visualRules";
import {
  VISUAL_PROJECTION_VERSION,
  type DataCertainty,
  type SceneActivation,
  type TownVisualState,
  type VisualExplanation,
} from "./visualState";

function reading(town: TownState, metric: keyof TownState["state"]): string {
  const m = town.state[metric];
  return `TownState.state.${metric} = ${m.band} (score ${m.score.toFixed(4)})`;
}

function projectDataCertainty(town: TownState): { value: DataCertainty; explanation: VisualExplanation } {
  const mapped = CERTAINTY_BY_DATA_HEALTH[town.state.data_health.band];
  const u = town.unresolved;
  const because = [
    reading(town, "data_health"),
    `unresolved in period: transfer_legs=${u.transfer_legs}, refunds=${u.refunds}, ` +
      `unknown_transactions=${u.unknown_transactions}, energy_unknown=${u.energy_unknown_count}`,
  ];

  if (!town.financial.balanced && mapped === "HEALTHY") {
    because.push("TownState.financial.balanced = false (energy identity does not hold) -> floor REVIEW");
    return {
      value: CERTAINTY_FLOOR_WHEN_UNBALANCED,
      explanation: { field: "data_certainty", value: CERTAINTY_FLOOR_WHEN_UNBALANCED, rule: "VR-6b", because },
    };
  }
  because.push(`TownState.financial.balanced = ${town.financial.balanced}`);
  return { value: mapped, explanation: { field: "data_certainty", value: mapped, rule: "VR-6", because } };
}

function projectSceneActivity(town: TownState): {
  value: Record<LifeScene, SceneActivation>;
  explanations: VisualExplanation[];
} {
  const value = {} as Record<LifeScene, SceneActivation>;
  const explanations: VisualExplanation[] = [];
  for (const scene of LIFE_SCENES) {
    const activity = town.scenes[scene];
    const activeDays = activity ? activity.active_days : 0;
    const count = activity ? activity.transaction_count : 0;
    const level = sceneActivationForActiveDays(activeDays);
    value[scene] = level;
    explanations.push({
      field: `scene_activity.${scene}`,
      value: level,
      rule: "VR-7",
      because: activity
        ? [
            `TownState.scenes.${scene}.active_days = ${activeDays}`,
            `TownState.scenes.${scene}.transaction_count = ${count} (disclosure; not used for the level)`,
            `trend_vs_previous_period = ${activity.trend_vs_previous_period} (not used in v1)`,
          ]
        : [`TownState.scenes.${scene} absent in period -> IDLE`],
    });
  }
  return { value, explanations };
}

export function projectTownVisualState(town: TownState): TownVisualState {
  const ambient = AMBIENT_BY_VITALITY[town.state.vitality.band];
  const residential = RESIDENTIAL_BY_STABILITY[town.state.stability.band];
  const tension = TENSION_BY_PRESSURE[town.state.consumption_pressure.band];
  const reserve = RESERVE_BY_SAVING[town.state.saving_strength.band];
  const externalFlow = EXTERNAL_FLOW_BY_INVESTMENT[town.state.investment_outflow.band];
  const certainty = projectDataCertainty(town);
  const scenes = projectSceneActivity(town);

  const activeScenes = LIFE_SCENES.filter((s) => (town.scenes[s]?.active_days ?? 0) > 0).length;

  const explanations: VisualExplanation[] = [
    {
      field: "ambient_activity",
      value: ambient,
      rule: "VR-1",
      because: [
        reading(town, "vitality"),
        `life scenes active in period = ${activeScenes}`,
        "spending amounts are structurally excluded (vitality is day/scene based)",
      ],
    },
    {
      field: "residential_stability",
      value: residential,
      rule: "VR-2",
      because: [
        reading(town, "stability"),
        `context: consumption_pressure band = ${town.state.consumption_pressure.band}`,
        `context: net storage change is ${
          town.financial.net_storage_change_minor > 0
            ? "positive"
            : town.financial.net_storage_change_minor === 0
              ? "zero"
              : "negative"
        }`,
      ],
    },
    {
      field: "consumption_tension",
      value: tension,
      rule: "VR-3",
      because: [reading(town, "consumption_pressure")],
    },
    {
      field: "reserve_state",
      value: reserve,
      rule: "VR-4",
      because: [reading(town, "saving_strength")],
    },
    {
      field: "external_flow_activity",
      value: externalFlow,
      rule: "VR-5",
      because: [
        reading(town, "investment_outflow"),
        `investment export count in period = ${town.financial.investment_export_count}`,
      ],
    },
    certainty.explanation,
    ...scenes.explanations,
  ];

  return {
    visual_projection_version: VISUAL_PROJECTION_VERSION,
    source_projection_version: town.projection_version,
    period_month: town.period.month,
    ambient_activity: ambient,
    residential_stability: residential,
    consumption_tension: tension,
    reserve_state: reserve,
    external_flow_activity: externalFlow,
    data_certainty: certainty.value,
    scene_activity: scenes.value,
    explanations,
  };
}
