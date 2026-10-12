import { validateTownEvents, type TownEvent, type TownEventsDocument } from "../adapter/townEvents";
import { fetchTownEvents } from "./townEventsClient";
import { fetchAvailableMonths, fetchTownState, TownStateSourceError } from "./townStateClient";

const MONTH_RE = /^\d{4}-\d{2}$/;

export const TOWN_PERIOD_ENDPOINT = "/api/town-period";

export interface TownPeriodFinancial {
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

export interface TownPeriodActivity {
  ledger_transaction_count: number;
  town_event_count: number;
  active_day_count: number;
  active_dates: string[];
  places: { target: string; count: number }[];
  coverage: TownEventsDocument["coverage"];
}

export interface TownPeriodPayload {
  projection_version: string;
  rules_version: string;
  generated_at: string;
  period: {
    kind: "month" | "year";
    key: string;
    start: string;
    end_exclusive: string;
    end_inclusive: string;
    available_months: string[];
    months_with_data: string[];
    date_coverage: { first: string | null; last: string | null };
  };
  financial: TownPeriodFinancial;
  activity: TownPeriodActivity;
  months: { month: string; has_data: boolean; start: string; end: string }[];
  events: TownEventsDocument["events"];
  days: TownEventsDocument["days"];
  presentation: TownEventsDocument["presentation"];
  coverage: TownEventsDocument["coverage"];
}

function asDocument(payload: TownPeriodPayload): TownEventsDocument {
  return validateTownEvents({
    projection_version: payload.projection_version === "town-period-v1"
      ? "town-events-v2"
      : payload.projection_version,
    rules_version: payload.rules_version,
    generated_at: payload.generated_at,
    month: payload.period.key,
    coverage: payload.coverage,
    days: payload.days,
    events: payload.events,
    presentation: payload.presentation,
  });
}

function applyClientPeriodMontage(events: TownEvent[]): TownEvent[] {
  const cloned = events.map((event) => ({ ...event }));
  const byDay = new Map<string, TownEvent[]>();
  for (const event of cloned) {
    const day = event.occurred_at.slice(0, 10);
    const bucket = byDay.get(day);
    if (bucket) bucket.push(event);
    else byDay.set(day, [event]);
  }
  const ordered: TownEvent[] = [];
  for (const day of [...byDay.keys()].sort()) {
    const dayEvents = byDay.get(day)!;
    const precise = dayEvents.filter((event) => event.time_precision === "SECOND");
    const daySlots = dayEvents.length - precise.length;
    let slotIndex = 0;
    for (const event of [...dayEvents].sort((a, b) =>
      a.occurred_at.localeCompare(b.occurred_at) || a.transaction_id - b.transaction_id,
    )) {
      if (event.time_precision === "SECOND") {
        event.schedule_seconds = event.time_of_day_seconds;
      } else {
        event.schedule_seconds = daySlots <= 0
          ? 43200
          : Math.floor(((slotIndex + 0.5) / daySlots) * 86400);
        event.presentation_time = true;
        slotIndex += 1;
      }
    }
    dayEvents.sort((a, b) =>
      a.schedule_seconds - b.schedule_seconds ||
      a.occurred_at.localeCompare(b.occurred_at) ||
      a.transaction_id - b.transaction_id,
    );
    ordered.push(...dayEvents);
  }
  const total = ordered.length;
  for (let index = 0; index < ordered.length; index += 1) {
    const event = ordered[index];
    event.schedule_seconds = total === 0 ? 0 : Math.floor(((index + 0.5) / total) * 86400);
    event.presentation_time = true;
  }
  return ordered;
}

async function fetchLegacyMonthPeriod(
  month: string,
  fetchImpl: typeof fetch,
): Promise<{ payload: TownPeriodPayload; document: TownEventsDocument }> {
  const [townState, eventsDoc, availableMonths] = await Promise.all([
    fetchTownState(month, fetchImpl),
    fetchTownEvents(month, fetchImpl),
    fetchAvailableMonths(fetchImpl),
  ]);
  const events = applyClientPeriodMontage(eventsDoc.events);
  const activeDates = [...new Set(events.map((event) => event.occurred_at.slice(0, 10)))].sort();
  const places = new Map<string, number>();
  for (const event of events) places.set(event.target, (places.get(event.target) ?? 0) + 1);
  const coverage = eventsDoc.coverage ?? {
    total: events.length,
    mapped: events.filter((event) => event.target !== "unknown").length,
    unknown: events.filter((event) => event.target === "unknown").length,
    unknown_ratio: events.length === 0 ? 0 : 0,
    unknown_by_category: [],
  };
  const presentation = {
    version: "town-period-presentation-v1",
    mode: "period_montage" as const,
    montage_label: month,
    timeline_seconds: 86400,
    event_count: events.length,
  };
  const payload: TownPeriodPayload = {
    projection_version: "town-period-v1",
    rules_version: eventsDoc.rules_version,
    generated_at: townState.generated_at,
    period: {
      kind: "month",
      key: month,
      start: townState.period.start,
      end_exclusive: "",
      end_inclusive: townState.period.end,
      available_months: availableMonths,
      months_with_data: availableMonths.includes(month) ? [month] : [],
      date_coverage: {
        first: activeDates[0] ?? null,
        last: activeDates[activeDates.length - 1] ?? null,
      },
    },
    financial: { ...townState.financial },
    activity: {
      ledger_transaction_count: 0,
      town_event_count: events.length,
      active_day_count: activeDates.length,
      active_dates: activeDates,
      places: [...places.entries()].map(([target, count]) => ({ target, count })),
      coverage,
    },
    months: [{
      month,
      has_data: availableMonths.includes(month),
      start: townState.period.start,
      end: townState.period.end,
    }],
    events,
    days: eventsDoc.days,
    presentation,
    coverage,
  };
  return {
    payload,
    document: validateTownEvents({
      projection_version: eventsDoc.projection_version,
      rules_version: eventsDoc.rules_version,
      generated_at: eventsDoc.generated_at,
      month,
      coverage,
      days: eventsDoc.days,
      events,
      presentation,
    }),
  };
}

export async function fetchTownPeriod(
  period: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ payload: TownPeriodPayload; document: TownEventsDocument }> {
  let response: Response;
  try {
    response = await fetchImpl(`${TOWN_PERIOD_ENDPOINT}?period=${encodeURIComponent(period)}`, {
      cache: "no-store",
    });
  } catch {
    throw new TownStateSourceError("ledger service unreachable");
  }
  if (response.status === 404 && MONTH_RE.test(period)) {
    return fetchLegacyMonthPeriod(period, fetchImpl);
  }
  if (!response.ok) {
    throw new TownStateSourceError(`HTTP ${response.status}`);
  }
  const payload = (await response.json()) as TownPeriodPayload;
  if (payload.projection_version !== "town-period-v1") {
    throw new TownStateSourceError(`unsupported town-period version: ${payload.projection_version}`);
  }
  return { payload, document: asDocument(payload) };
}

export function latestMonthInPeriod(payload: TownPeriodPayload): string | null {
  const months = payload.period.months_with_data;
  return months.length ? months[months.length - 1] : null;
}

export function availableYearKeys(months: string[]): string[] {
  const years = new Set(months.map((month) => month.slice(0, 4)));
  return [...years].sort();
}
