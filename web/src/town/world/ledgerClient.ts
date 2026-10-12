/**
 * Ledger board / review transport. Same fail-closed discipline as Town State:
 * the browser never opens SQLite and never recomputes a financial figure.
 */

import { validateLedgerBoard, type LedgerBoard } from "../adapter/ledgerBoard";
import { validateLedgerReview, type LedgerReview, type ReviewBucket, type ReviewType } from "../adapter/ledgerReview";
import { TownStateSourceError } from "./townStateClient";

export const LEDGER_BOARD_ENDPOINT = "/api/ledger-board";
export const LEDGER_REVIEW_ENDPOINT = "/api/ledger-review";

const MONTH_RE = /^\d{4}-\d{2}$/;

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

export function ledgerBoardUrl(month: string): string {
  return `${LEDGER_BOARD_ENDPOINT}?month=${encodeURIComponent(month)}`;
}

export function ledgerReviewUrl(params: {
  month: string;
  type?: ReviewType | "";
  bucket?: ReviewBucket | "";
  q?: string;
  limit?: number;
  offset?: number;
}): string {
  const query = new URLSearchParams({ month: params.month });
  if (params.type) query.set("type", params.type);
  if (params.bucket) query.set("bucket", params.bucket);
  if (params.q) query.set("q", params.q);
  if (params.limit !== undefined) query.set("limit", String(params.limit));
  if (params.offset !== undefined) query.set("offset", String(params.offset));
  return `${LEDGER_REVIEW_ENDPOINT}?${query.toString()}`;
}

export async function fetchLedgerBoard(month: string, fetchImpl: typeof fetch = fetch): Promise<LedgerBoard> {
  if (!MONTH_RE.test(month)) {
    throw new TownStateSourceError(`month must be YYYY-MM, got ${JSON.stringify(month)}`);
  }
  const payload = await fetchJson(ledgerBoardUrl(month), fetchImpl);
  try {
    return validateLedgerBoard(payload);
  } catch (cause) {
    throw new TownStateSourceError(
      `ledger board for ${month} violates the contract: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
}

export async function fetchLedgerReview(
  params: {
    month: string;
    type?: ReviewType | "";
    bucket?: ReviewBucket | "";
    q?: string;
    limit?: number;
    offset?: number;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<LedgerReview> {
  if (!MONTH_RE.test(params.month)) {
    throw new TownStateSourceError(`month must be YYYY-MM, got ${JSON.stringify(params.month)}`);
  }
  const payload = await fetchJson(ledgerReviewUrl(params), fetchImpl);
  try {
    return validateLedgerReview(payload);
  } catch (cause) {
    throw new TownStateSourceError(
      `ledger review for ${params.month} violates the contract: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
}
