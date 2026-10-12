/**
 * Town State transport client — the read path for real ledger data.
 *
 * Same discipline as client.ts (world transport): the web never reads
 * SQLite and never recomputes a financial figure; it consumes the JSON
 * projections served by `life-energy town world serve` and validates them
 * through the adapter before anything renders.
 *
 * Fail-closed: any network error, non-200, or contract violation throws
 * TownStateSourceError. Callers must surface SERVICE UNAVAILABLE, never
 * silently substitute synthetic fixtures for real data.
 */

import { validateTownState, type TownState } from "../adapter/townState";

export const MONTHS_ENDPOINT = "/api/months";
export const TOWN_STATE_ENDPOINT = "/api/town-state";

const MONTH_RE = /^\d{4}-\d{2}$/;

export class TownStateSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TownStateSourceError";
  }
}

export function townStateUrl(month: string): string {
  return `${TOWN_STATE_ENDPOINT}?month=${encodeURIComponent(month)}`;
}

async function fetchJson(endpoint: string, fetchImpl: typeof fetch): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(endpoint);
  } catch {
    throw new TownStateSourceError("ledger service unreachable");
  }
  if (!response.ok) {
    throw new TownStateSourceError(`ledger service responded HTTP ${response.status}`);
  }
  try {
    return await response.json();
  } catch {
    throw new TownStateSourceError("ledger service returned malformed JSON");
  }
}

/**
 * Months that actually contain canonical transactions, ascending. An empty
 * list is a legitimate answer (an empty ledger) and is returned as-is.
 */
export async function fetchAvailableMonths(fetchImpl: typeof fetch = fetch): Promise<string[]> {
  const payload = await fetchJson(MONTHS_ENDPOINT, fetchImpl);
  if (typeof payload !== "object" || payload === null || !Array.isArray((payload as { months?: unknown }).months)) {
    throw new TownStateSourceError("months payload must be {months: [...]}");
  }
  const months = (payload as { months: unknown[] }).months;
  if (months.some((month) => typeof month !== "string" || !MONTH_RE.test(month))) {
    throw new TownStateSourceError("months payload contains a non-YYYY-MM entry");
  }
  return months as string[];
}

/** The validated Town State of one real month, exactly as the core projected it. */
export async function fetchTownState(month: string, fetchImpl: typeof fetch = fetch): Promise<TownState> {
  if (!MONTH_RE.test(month)) {
    throw new TownStateSourceError(`month must be YYYY-MM, got ${JSON.stringify(month)}`);
  }
  const payload = await fetchJson(townStateUrl(month), fetchImpl);
  try {
    return validateTownState(payload);
  } catch (cause) {
    throw new TownStateSourceError(
      `town state for ${month} violates the contract: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
}
