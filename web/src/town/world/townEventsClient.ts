/**
 * TownEvents transport. Same fail-closed discipline as Town State /
 * ledger review: the browser never opens SQLite and never recomputes
 * event semantics (target / intensity / schedule come from the service).
 */

import { validateTownEvents, type TownEventsDocument } from "../adapter/townEvents";
import { TownStateSourceError } from "./townStateClient";

export const TOWN_EVENTS_ENDPOINT = "/api/town-events";

const MONTH_RE = /^\d{4}-\d{2}$/;

export function townEventsUrl(month: string): string {
  return `${TOWN_EVENTS_ENDPOINT}?month=${encodeURIComponent(month)}`;
}

export async function fetchTownEvents(month: string, fetchImpl: typeof fetch = fetch): Promise<TownEventsDocument> {
  if (!MONTH_RE.test(month)) {
    throw new TownStateSourceError(`month must be YYYY-MM, got ${JSON.stringify(month)}`);
  }
  let response: Response;
  try {
    response = await fetchImpl(townEventsUrl(month));
  } catch {
    throw new TownStateSourceError("ledger service unreachable");
  }
  if (!response.ok) {
    throw new TownStateSourceError(`ledger service responded HTTP ${response.status}`);
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new TownStateSourceError("ledger service returned malformed JSON");
  }
  try {
    return validateTownEvents(payload);
  } catch (cause) {
    throw new TownStateSourceError(
      `town events for ${month} violate the contract: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
}
