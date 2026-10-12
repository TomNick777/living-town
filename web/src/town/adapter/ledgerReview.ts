/**
 * Ledger Review adapter — validates GET /api/ledger-review JSON.
 * Lists canonical facts. The UI must not sum amount_minor into a new total.
 */

export const SUPPORTED_REVIEW_VERSION = "ledger-review-v1";

export const REVIEW_TYPES = ["INCOME", "EXPENSE", "TRANSFER", "REFUND", "INVESTMENT", "UNKNOWN"] as const;
export type ReviewType = (typeof REVIEW_TYPES)[number];

export const REVIEW_BUCKETS = [
  "unpaired_transfer",
  "unresolved_refund",
  "unknown_type",
  "unattributed_account",
  "unclassified",
  "pending",
] as const;
export type ReviewBucket = (typeof REVIEW_BUCKETS)[number];

export interface LedgerReviewItem {
  transaction_id: number;
  occurred_at: string;
  source: string | null;
  counterparty: string | null;
  description: string | null;
  amount_minor: number;
  currency: string;
  direction: string;
  transaction_type: ReviewType;
  status: string | null;
  account_name: string | null;
  category_code: string | null;
  category_name: string | null;
  scene: string | null;
  classification_source: string | null;
  manual_override: boolean;
  flags: string[];
}

export interface LedgerReview {
  projection_version: string;
  generated_at: string;
  month: string;
  total_count: number;
  limit: number;
  offset: number;
  type_counts: Record<ReviewType, number>;
  bucket_counts: Record<ReviewBucket, number>;
  transactions: LedgerReviewItem[];
}

export class LedgerReviewContractError extends Error {
  constructor(message: string) {
    super(`LedgerReview contract violation: ${message}`);
    this.name = "LedgerReviewContractError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) throw new LedgerReviewContractError(`${path} must be an object`);
  return value;
}

function requireInt(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new LedgerReviewContractError(`${path} must be an integer`);
  }
  return value;
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new LedgerReviewContractError(`${path} must be a non-empty string`);
  }
  return value;
}

function nullableString(value: unknown, path: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new LedgerReviewContractError(`${path} must be a string or null`);
  return value;
}

export function validateLedgerReview(input: unknown): LedgerReview {
  const root = requireRecord(input, "ledgerReview");
  const version = requireString(root.projection_version, "projection_version");
  if (version !== SUPPORTED_REVIEW_VERSION) {
    throw new LedgerReviewContractError(`unsupported projection_version "${version}"`);
  }
  requireString(root.month, "month");
  requireString(root.generated_at, "generated_at");
  const typeCountsRaw = requireRecord(root.type_counts, "type_counts");
  const type_counts = {} as Record<ReviewType, number>;
  for (const kind of REVIEW_TYPES) {
    type_counts[kind] = requireInt(typeCountsRaw[kind], `type_counts.${kind}`);
  }
  const bucketCountsRaw = requireRecord(root.bucket_counts, "bucket_counts");
  const bucket_counts = {} as Record<ReviewBucket, number>;
  for (const kind of REVIEW_BUCKETS) {
    bucket_counts[kind] = requireInt(bucketCountsRaw[kind], `bucket_counts.${kind}`);
  }
  if (!Array.isArray(root.transactions)) {
    throw new LedgerReviewContractError("transactions must be a list");
  }
  const transactions = root.transactions.map((raw, index) => {
    const item = requireRecord(raw, `transactions[${index}]`);
    const transactionType = requireString(item.transaction_type, `transactions[${index}].transaction_type`);
    if (!(REVIEW_TYPES as readonly string[]).includes(transactionType)) {
      throw new LedgerReviewContractError(`transactions[${index}].transaction_type is unknown`);
    }
    if (typeof item.manual_override !== "boolean") {
      throw new LedgerReviewContractError(`transactions[${index}].manual_override must be boolean`);
    }
    if (!Array.isArray(item.flags) || item.flags.some((flag) => typeof flag !== "string")) {
      throw new LedgerReviewContractError(`transactions[${index}].flags must be a string list`);
    }
    return {
      transaction_id: requireInt(item.transaction_id, `transactions[${index}].transaction_id`),
      occurred_at: requireString(item.occurred_at, `transactions[${index}].occurred_at`),
      source: nullableString(item.source, `transactions[${index}].source`),
      counterparty: nullableString(item.counterparty, `transactions[${index}].counterparty`),
      description: nullableString(item.description, `transactions[${index}].description`),
      amount_minor: requireInt(item.amount_minor, `transactions[${index}].amount_minor`),
      currency: requireString(item.currency, `transactions[${index}].currency`),
      direction: requireString(item.direction, `transactions[${index}].direction`),
      transaction_type: transactionType as ReviewType,
      status: nullableString(item.status, `transactions[${index}].status`),
      account_name: nullableString(item.account_name, `transactions[${index}].account_name`),
      category_code: nullableString(item.category_code, `transactions[${index}].category_code`),
      category_name: nullableString(item.category_name, `transactions[${index}].category_name`),
      scene: nullableString(item.scene, `transactions[${index}].scene`),
      classification_source: nullableString(item.classification_source, `transactions[${index}].classification_source`),
      manual_override: item.manual_override,
      flags: item.flags as string[],
    };
  });
  return {
    projection_version: version,
    generated_at: root.generated_at as string,
    month: root.month as string,
    total_count: requireInt(root.total_count, "total_count"),
    limit: requireInt(root.limit, "limit"),
    offset: requireInt(root.offset, "offset"),
    type_counts,
    bucket_counts,
    transactions,
  };
}
