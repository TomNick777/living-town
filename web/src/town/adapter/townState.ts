/**
 * TownStateAdapter — the ONLY place the frontend touches domain data.
 *
 * Reads a Town State JSON exactly as defined by docs/living-town-ui-contract.md
 * (`life-energy town state --month YYYY-MM --json`). It validates shape and
 * version and hands a typed TownState to the visual projector.
 *
 * Hard rules (docs/living-town-ui-contract.md):
 *   - never recompute any financial figure ("not even a convenience sum");
 *   - never read SQLite / raw / canonical tables — JSON only;
 *   - no write path of any kind.
 */

export const SUPPORTED_PROJECTION_VERSION = "living-town-v1";

export const LIFE_SCENES = [
  "HOME",
  "COMMUTE",
  "DINING_SOCIAL",
  "FAMILY",
  "DAILY_CONVENIENCE",
  "LEARNING",
  "HEALTH",
  "LEISURE",
  "CONSTRUCTION_PROJECT",
  "INVESTMENT",
  "OTHER",
] as const;
export type LifeScene = (typeof LIFE_SCENES)[number];

export type VitalityBand = "DORMANT" | "QUIET" | "ALIVE" | "THRIVING";
export type StabilityBand = "FRAGILE" | "MODERATE" | "SOLID";
export type PressureBand = "LOW" | "NORMAL" | "HIGH" | "EXTREME";
export type StrengthBand = "NONE" | "WEAK" | "MODERATE" | "STRONG";
export type DataHealthBand = "NEEDS_WORK" | "REVIEW" | "HEALTHY";
export type Trend = "UP" | "DOWN" | "FLAT" | "UNKNOWN";

export interface MetricReading<B extends string> {
  score: number; // 0..1 presentation-grade reading, never a financial amount
  band: B;
}

export interface TownStateMetrics {
  vitality: MetricReading<VitalityBand>;
  stability: MetricReading<StabilityBand>;
  consumption_pressure: MetricReading<PressureBand>;
  saving_strength: MetricReading<StrengthBand>;
  investment_outflow: MetricReading<StrengthBand>;
  data_health: MetricReading<DataHealthBand>;
}

export interface TownFinancial {
  external_income_minor: number;
  life_consumption_minor: number;
  energy_return_minor: number;
  net_life_consumption_minor: number;
  investment_export_minor: number;
  investment_export_count: number;
  investment_import_minor: number;
  net_storage_change_minor: number;
  internal_transfer_minor: number;
  transfer_fee_minor: number;
  unreconciled_minor: number;
  identity_delta_minor: number;
  balanced: boolean;
}

export interface TownSceneActivity {
  scene: LifeScene;
  transaction_count: number;
  amount_minor: number;
  share_of_consumption: number | null;
  active_days: number;
  trend_vs_previous_period: Trend;
  previous_amount_minor: number | null;
}

export interface TownUnresolved {
  transfer_legs: number;
  refunds: number;
  unknown_transactions: number;
  energy_unknown_count: number;
  unreconciled_minor: number;
}

export interface TownExplanationFactor {
  name: string;
  value: unknown;
  detail: string;
}

export interface TownExplanation {
  metric: string;
  value: number;
  band: string;
  factors: TownExplanationFactor[];
  rules_version: string;
}

export interface TownPeriod {
  month: string;
  start: string;
  end: string;
  days_in_period: number;
}

export interface TownState {
  period: TownPeriod;
  projection_version: string;
  generated_at: string;
  financial: TownFinancial;
  state: TownStateMetrics;
  scenes: Partial<Record<LifeScene, TownSceneActivity>>;
  unresolved: TownUnresolved;
  projects: unknown[];
  explanations: TownExplanation[];
}

export class TownStateContractError extends Error {
  constructor(message: string) {
    super(`TownState contract violation: ${message}`);
    this.name = "TownStateContractError";
  }
}

const METRIC_KEYS: (keyof TownStateMetrics)[] = [
  "vitality",
  "stability",
  "consumption_pressure",
  "saving_strength",
  "investment_outflow",
  "data_health",
];

const BANDS: Record<keyof TownStateMetrics, readonly string[]> = {
  vitality: ["DORMANT", "QUIET", "ALIVE", "THRIVING"],
  stability: ["FRAGILE", "MODERATE", "SOLID"],
  consumption_pressure: ["LOW", "NORMAL", "HIGH", "EXTREME"],
  saving_strength: ["NONE", "WEAK", "MODERATE", "STRONG"],
  investment_outflow: ["NONE", "WEAK", "MODERATE", "STRONG"],
  data_health: ["NEEDS_WORK", "REVIEW", "HEALTHY"],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) throw new TownStateContractError(`${path} must be an object`);
  return value;
}

function requireInt(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new TownStateContractError(`${path} must be an integer (minor units / counts)`);
  }
  return value;
}

function requireScore(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new TownStateContractError(`${path} must be a 0..1 score`);
  }
  return value;
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TownStateContractError(`${path} must be a non-empty string`);
  }
  return value;
}

/**
 * Validate an already-parsed JSON value against the v1 UI contract.
 * The output is the input, typed — nothing is recomputed or normalized.
 */
export function validateTownState(input: unknown): TownState {
  const root = requireRecord(input, "townState");

  const version = requireString(root.projection_version, "projection_version");
  if (version !== SUPPORTED_PROJECTION_VERSION) {
    throw new TownStateContractError(
      `unsupported projection_version "${version}" (adapter supports ${SUPPORTED_PROJECTION_VERSION})`,
    );
  }

  const period = requireRecord(root.period, "period");
  requireString(period.month, "period.month");
  requireInt(period.days_in_period, "period.days_in_period");
  requireString(root.generated_at, "generated_at");

  const financial = requireRecord(root.financial, "financial");
  for (const key of Object.keys(financial)) {
    if (key === "balanced") {
      if (typeof financial.balanced !== "boolean") {
        throw new TownStateContractError("financial.balanced must be boolean");
      }
    } else {
      requireInt(financial[key], `financial.${key}`);
    }
  }
  if (typeof financial.balanced !== "boolean") {
    throw new TownStateContractError("financial.balanced is required");
  }

  const state = requireRecord(root.state, "state");
  for (const metric of METRIC_KEYS) {
    const reading = requireRecord(state[metric], `state.${metric}`);
    requireScore(reading.score, `state.${metric}.score`);
    const band = requireString(reading.band, `state.${metric}.band`);
    if (!BANDS[metric].includes(band)) {
      throw new TownStateContractError(
        `state.${metric}.band "${band}" not in ${BANDS[metric].join("|")}`,
      );
    }
  }

  const scenes = requireRecord(root.scenes, "scenes");
  for (const [name, raw] of Object.entries(scenes)) {
    if (!(LIFE_SCENES as readonly string[]).includes(name)) {
      throw new TownStateContractError(`scenes.${name} is not a known life scene`);
    }
    const scene = requireRecord(raw, `scenes.${name}`);
    requireInt(scene.transaction_count, `scenes.${name}.transaction_count`);
    requireInt(scene.active_days, `scenes.${name}.active_days`);
    requireString(scene.trend_vs_previous_period, `scenes.${name}.trend_vs_previous_period`);
  }

  const unresolved = requireRecord(root.unresolved, "unresolved");
  for (const key of ["transfer_legs", "refunds", "unknown_transactions", "energy_unknown_count"]) {
    requireInt(unresolved[key], `unresolved.${key}`);
  }

  if (!Array.isArray(root.projects)) throw new TownStateContractError("projects must be a list");
  if (!Array.isArray(root.explanations)) {
    throw new TownStateContractError("explanations must be a list");
  }

  return root as unknown as TownState;
}

/**
 * Parse text that is either a bare Town State JSON document or the full
 * stdout of `life-energy town state --month YYYY-MM --json` (human-readable
 * table followed by the JSON block). This is the CLI export adapter: it
 * locates the JSON object, it never interprets the human text.
 */
export function parseTownStateText(text: string): TownState {
  const trimmed = text.trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    const lines = trimmed.split(/\r?\n/);
    const start = lines.findIndex((line) => line.trim() === "{");
    if (start < 0) {
      throw new TownStateContractError("no JSON object found in input");
    }
    parsed = JSON.parse(lines.slice(start).join("\n"));
  }
  return validateTownState(parsed);
}
