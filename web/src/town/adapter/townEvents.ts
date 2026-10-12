/**
 * TownEvent adapter — validates GET /api/town-events JSON.
 *
 * TownEvent 是「账本事实 → 城市世界」的正式边界：replay/renderer 只消费
 * 这里的事件，不再解释任何流水字段。浏览器只校验，不重算 target、
 * 不重算 intensity、不汇总金额（coverage 由投影端给出）。
 *
 * V2（town-events-v2）新增 behavior 语义层。本适配器同时接受 v1 文档
 * （schema 兼容）：v1 事件缺 behavior 字段时按 v1 已发布的映射语义
 * 补齐（见 v1FallbackBehavior）——这是旧文档的规范化，不是新的推断。
 */

export const SUPPORTED_TOWN_EVENTS_VERSIONS = ["town-events-v2", "town-events-v1"] as const;
export type TownEventsVersion = (typeof SUPPORTED_TOWN_EVENTS_VERSIONS)[number];

export const TOWN_TARGETS = [
  "home",
  "office",
  "restaurant",
  "cafe",
  "supermarket",
  "logistics",
  "transit",
  "clinic",
  "leisure",
  "unknown",
] as const;
export type TownTarget = (typeof TOWN_TARGETS)[number];

export const TOWN_EVENT_TYPES = [
  "DINING",
  "COFFEE",
  "GROCERY",
  "PARCEL",
  "HOUSEHOLD",
  "WORK",
  "TRANSIT",
  "HEALTH",
  "LEISURE",
  "UNKNOWN",
] as const;
export type TownEventType = (typeof TOWN_EVENT_TYPES)[number];

export const TOWN_BEHAVIORS = [
  "VISIT",
  "TRANSIT",
  "DELIVERY",
  "CREDIT",
  "PASSIVE",
  "UNKNOWN",
] as const;
export type TownBehavior = (typeof TOWN_BEHAVIORS)[number];

export const TOWN_EVENT_DIRECTIONS = ["expense", "income"] as const;
export type TownEventDirection = (typeof TOWN_EVENT_DIRECTIONS)[number];

export interface TownEvent {
  id: string;
  transaction_id: number;
  occurred_at: string;
  time_precision: "SECOND" | "DAY";
  time_of_day_seconds: number;
  presentation_time: boolean;
  type: TownEventType;
  category_code: string | null;
  category_name: string | null;
  merchant: string | null;
  description: string | null;
  amount_minor: number;
  currency: string;
  direction: TownEventDirection;
  target: TownTarget;
  behavior: TownBehavior;
  intensity: number;
  rule: string;
  transaction_type: string;
  /** replay 顺序时间（秒，0..86400）；DAY 精度是演示槽位，不是事实时刻。 */
  schedule_seconds: number;
}

export interface TownEventDay {
  date: string;
  event_count: number;
  precise_time_count: number;
}

/** 投影端对自身统计的 Town Visualization Coverage（不是识别准确率）。 */
export interface TownCoverage {
  total: number;
  mapped: number;
  unknown: number;
  unknown_ratio: number;
  unknown_by_category: {
    category_code: string | null;
    category_name: string | null;
    count: number;
  }[];
}

export interface PeriodPresentation {
  version: string;
  mode: "period_montage" | "day_replay";
  montage_label: string;
  timeline_seconds: number;
  event_count: number;
}

export interface TownEventsDocument {
  projection_version: string;
  rules_version: string;
  generated_at: string;
  month: string;
  /** v1 文档没有 coverage 块（旧 payload 兼容：可选）。 */
  coverage?: TownCoverage;
  days: TownEventDay[];
  events: TownEvent[];
  presentation?: PeriodPresentation;
}

export class TownEventsContractError extends Error {
  constructor(message: string) {
    super(`TownEvents contract violation: ${message}`);
    this.name = "TownEventsContractError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) throw new TownEventsContractError(`${path} must be an object`);
  return value;
}

function requireInt(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new TownEventsContractError(`${path} must be an integer`);
  }
  return value;
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TownEventsContractError(`${path} must be a non-empty string`);
  }
  return value;
}

function nullableString(value: unknown, path: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new TownEventsContractError(`${path} must be a string or null`);
  return value;
}

function requireEnum<T extends string>(value: unknown, allowed: readonly T[], path: string): T {
  const text = requireString(value, path);
  if (!(allowed as readonly string[]).includes(text)) {
    throw new TownEventsContractError(`${path} must be one of ${allowed.join(", ")}`);
  }
  return text as T;
}

function optionalEnum<T extends string>(value: unknown, allowed: readonly T[], path: string): T | null {
  if (value === null || value === undefined) return null;
  return requireEnum(value, allowed, path);
}

/**
 * v1 → v2 规范化：v1 没有 behavior 字段。这里按 v1 已发布语义补齐
 * （与 v1 投影行为一致，不发明新语义）：WORK→CREDIT、PARCEL→DELIVERY、
 * HOUSEHOLD 在 v1 会生成到访人物（V2 起改为 PASSIVE），其余映射目标
 * 一律 VISIT，unknown 保持 UNKNOWN。
 */
function v1FallbackBehavior(type: TownEventType, target: TownTarget): TownBehavior {
  if (target === "unknown") return "UNKNOWN";
  switch (type) {
    case "WORK": return "CREDIT";
    case "PARCEL": return "DELIVERY";
    case "HOUSEHOLD": return "VISIT";
    default: return "VISIT";
  }
}

function validateCoverage(value: unknown, path: string): TownCoverage {
  const root = requireRecord(value, path);
  if (!Array.isArray(root.unknown_by_category)) {
    throw new TownEventsContractError(`${path}.unknown_by_category must be a list`);
  }
  const ratio = root.unknown_ratio;
  if (typeof ratio !== "number" || !Number.isFinite(ratio) || ratio < 0 || ratio > 1) {
    throw new TownEventsContractError(`${path}.unknown_ratio must be within 0..1`);
  }
  return {
    total: requireInt(root.total, `${path}.total`),
    mapped: requireInt(root.mapped, `${path}.mapped`),
    unknown: requireInt(root.unknown, `${path}.unknown`),
    unknown_ratio: ratio,
    unknown_by_category: root.unknown_by_category.map((raw, index) => {
      const bucket = requireRecord(raw, `${path}.unknown_by_category[${index}]`);
      return {
        category_code: nullableString(bucket.category_code, `${path}.unknown_by_category[${index}].category_code`),
        category_name: nullableString(bucket.category_name, `${path}.unknown_by_category[${index}].category_name`),
        count: requireInt(bucket.count, `${path}.unknown_by_category[${index}].count`),
      };
    }),
  };
}

export function validateTownEvents(input: unknown): TownEventsDocument {
  const root = requireRecord(input, "townEvents");
  const version = requireString(root.projection_version, "projection_version");
  if (!(SUPPORTED_TOWN_EVENTS_VERSIONS as readonly string[]).includes(version)) {
    throw new TownEventsContractError(`unsupported projection_version "${version}"`);
  }
  const isV2 = version === "town-events-v2";
  if (!Array.isArray(root.days)) throw new TownEventsContractError("days must be a list");
  if (!Array.isArray(root.events)) throw new TownEventsContractError("events must be a list");

  const days = root.days.map((raw, index) => {
    const day = requireRecord(raw, `days[${index}]`);
    return {
      date: requireString(day.date, `days[${index}].date`),
      event_count: requireInt(day.event_count, `days[${index}].event_count`),
      precise_time_count: requireInt(day.precise_time_count, `days[${index}].precise_time_count`),
    };
  });

  const events = root.events.map((raw, index): TownEvent => {
    const item = requireRecord(raw, `events[${index}]`);
    const intensity = item.intensity;
    if (typeof intensity !== "number" || !Number.isFinite(intensity) || intensity < 0 || intensity > 1) {
      throw new TownEventsContractError(`events[${index}].intensity must be within 0..1`);
    }
    if (typeof item.presentation_time !== "boolean") {
      throw new TownEventsContractError(`events[${index}].presentation_time must be boolean`);
    }
    const type = requireEnum(item.type, TOWN_EVENT_TYPES, `events[${index}].type`);
    const target = requireEnum(item.target, TOWN_TARGETS, `events[${index}].target`);
    const behavior = isV2
      ? requireEnum(item.behavior, TOWN_BEHAVIORS, `events[${index}].behavior`)
      : (optionalEnum(item.behavior, TOWN_BEHAVIORS, `events[${index}].behavior`)
          ?? v1FallbackBehavior(type, target));
    return {
      id: requireString(item.id, `events[${index}].id`),
      transaction_id: requireInt(item.transaction_id, `events[${index}].transaction_id`),
      occurred_at: requireString(item.occurred_at, `events[${index}].occurred_at`),
      time_precision: requireEnum(item.time_precision, ["SECOND", "DAY"], `events[${index}].time_precision`),
      time_of_day_seconds: requireInt(item.time_of_day_seconds, `events[${index}].time_of_day_seconds`),
      presentation_time: item.presentation_time,
      type,
      category_code: nullableString(item.category_code, `events[${index}].category_code`),
      category_name: nullableString(item.category_name, `events[${index}].category_name`),
      merchant: nullableString(item.merchant, `events[${index}].merchant`),
      description: nullableString(item.description, `events[${index}].description`),
      amount_minor: requireInt(item.amount_minor, `events[${index}].amount_minor`),
      currency: requireString(item.currency, `events[${index}].currency`),
      direction: requireEnum(item.direction, TOWN_EVENT_DIRECTIONS, `events[${index}].direction`),
      target,
      behavior,
      intensity,
      rule: requireString(item.rule, `events[${index}].rule`),
      transaction_type: requireString(item.transaction_type, `events[${index}].transaction_type`),
      schedule_seconds: requireInt(item.schedule_seconds, `events[${index}].schedule_seconds`),
    };
  });

  let presentation: PeriodPresentation | undefined;
  if (root.presentation !== undefined && root.presentation !== null) {
    const block = requireRecord(root.presentation, "presentation");
    presentation = {
      version: requireString(block.version, "presentation.version"),
      mode: requireEnum(block.mode, ["period_montage", "day_replay"], "presentation.mode"),
      montage_label: requireString(block.montage_label, "presentation.montage_label"),
      timeline_seconds: requireInt(block.timeline_seconds, "presentation.timeline_seconds"),
      event_count: requireInt(block.event_count, "presentation.event_count"),
    };
  }

  return {
    projection_version: version,
    rules_version: requireString(root.rules_version, "rules_version"),
    generated_at: requireString(root.generated_at, "generated_at"),
    month: requireString(root.month, "month"),
    coverage: root.coverage === undefined || root.coverage === null
      ? undefined
      : validateCoverage(root.coverage, "coverage"),
    days,
    events,
    presentation,
  };
}
