/**
 * Ledger Board adapter — validates GET /api/ledger-board JSON.
 * Presentation only: no financial arithmetic, no invented buckets.
 */

export const SUPPORTED_BOARD_VERSION = "ledger-board-v1";

export interface LedgerSeriesPoint {
  month: string;
  external_income_minor: number;
  net_life_consumption_minor: number;
  investment_export_minor: number;
  net_storage_change_minor: number;
  unreconciled_minor: number;
  balanced: boolean;
}

export interface LedgerDay {
  date: string;
  life_event_count: number;
  consumption_count: number;
  consumption_minor: number;
  income_count: number;
  income_minor: number;
}

export interface LedgerMerchant {
  counterparty: string;
  scene: string;
  transaction_count: number;
  amount_minor: number;
  consumption_minor: number;
  return_minor: number;
}

export interface LedgerMerchantOthers {
  merchant_count: number;
  transaction_count: number;
  amount_minor: number;
}

export interface LedgerAccountFlow {
  account_id: number | null;
  account_name: string;
  net_minor: number;
}

export interface LedgerBoard {
  projection_version: string;
  generated_at: string;
  month: string;
  series: LedgerSeriesPoint[];
  days: LedgerDay[];
  merchants: { top: LedgerMerchant[]; others: LedgerMerchantOthers };
  accounts: LedgerAccountFlow[];
}

export class LedgerBoardContractError extends Error {
  constructor(message: string) {
    super(`LedgerBoard contract violation: ${message}`);
    this.name = "LedgerBoardContractError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) throw new LedgerBoardContractError(`${path} must be an object`);
  return value;
}

function requireInt(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new LedgerBoardContractError(`${path} must be an integer`);
  }
  return value;
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new LedgerBoardContractError(`${path} must be a non-empty string`);
  }
  return value;
}

const MONTH_RE = /^\d{4}-\d{2}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function validateLedgerBoard(input: unknown): LedgerBoard {
  const root = requireRecord(input, "ledgerBoard");
  const version = requireString(root.projection_version, "projection_version");
  if (version !== SUPPORTED_BOARD_VERSION) {
    throw new LedgerBoardContractError(`unsupported projection_version "${version}"`);
  }
  const month = requireString(root.month, "month");
  if (!MONTH_RE.test(month)) throw new LedgerBoardContractError("month must be YYYY-MM");
  requireString(root.generated_at, "generated_at");
  if (!Array.isArray(root.series)) throw new LedgerBoardContractError("series must be a list");
  if (!Array.isArray(root.days)) throw new LedgerBoardContractError("days must be a list");

  const series = root.series.map((raw, index) => {
    const point = requireRecord(raw, `series[${index}]`);
    const pointMonth = requireString(point.month, `series[${index}].month`);
    if (!MONTH_RE.test(pointMonth)) throw new LedgerBoardContractError(`series[${index}].month must be YYYY-MM`);
    if (typeof point.balanced !== "boolean") {
      throw new LedgerBoardContractError(`series[${index}].balanced must be boolean`);
    }
    return {
      month: pointMonth,
      external_income_minor: requireInt(point.external_income_minor, `series[${index}].external_income_minor`),
      net_life_consumption_minor: requireInt(point.net_life_consumption_minor, `series[${index}].net_life_consumption_minor`),
      investment_export_minor: requireInt(point.investment_export_minor, `series[${index}].investment_export_minor`),
      net_storage_change_minor: requireInt(point.net_storage_change_minor, `series[${index}].net_storage_change_minor`),
      unreconciled_minor: requireInt(point.unreconciled_minor, `series[${index}].unreconciled_minor`),
      balanced: point.balanced,
    };
  });

  const days = root.days.map((raw, index) => {
    const day = requireRecord(raw, `days[${index}]`);
    const date = requireString(day.date, `days[${index}].date`);
    if (!DAY_RE.test(date)) throw new LedgerBoardContractError(`days[${index}].date must be YYYY-MM-DD`);
    return {
      date,
      life_event_count: requireInt(day.life_event_count, `days[${index}].life_event_count`),
      consumption_count: requireInt(day.consumption_count, `days[${index}].consumption_count`),
      consumption_minor: requireInt(day.consumption_minor, `days[${index}].consumption_minor`),
      income_count: requireInt(day.income_count, `days[${index}].income_count`),
      income_minor: requireInt(day.income_minor, `days[${index}].income_minor`),
    };
  });

  const merchants = requireRecord(root.merchants, "merchants");
  if (!Array.isArray(merchants.top)) throw new LedgerBoardContractError("merchants.top must be a list");
  const top = merchants.top.map((raw, index) => {
    const item = requireRecord(raw, `merchants.top[${index}]`);
    return {
      counterparty: requireString(item.counterparty, `merchants.top[${index}].counterparty`),
      scene: requireString(item.scene, `merchants.top[${index}].scene`),
      transaction_count: requireInt(item.transaction_count, `merchants.top[${index}].transaction_count`),
      amount_minor: requireInt(item.amount_minor, `merchants.top[${index}].amount_minor`),
      consumption_minor: requireInt(item.consumption_minor, `merchants.top[${index}].consumption_minor`),
      return_minor: requireInt(item.return_minor, `merchants.top[${index}].return_minor`),
    };
  });
  const othersRaw = requireRecord(merchants.others, "merchants.others");
  const others = {
    merchant_count: requireInt(othersRaw.merchant_count, "merchants.others.merchant_count"),
    transaction_count: requireInt(othersRaw.transaction_count, "merchants.others.transaction_count"),
    amount_minor: requireInt(othersRaw.amount_minor, "merchants.others.amount_minor"),
  };

  if (!Array.isArray(root.accounts)) throw new LedgerBoardContractError("accounts must be a list");
  const accounts = root.accounts.map((raw, index) => {
    const item = requireRecord(raw, `accounts[${index}]`);
    if (item.account_id !== null && (typeof item.account_id !== "number" || !Number.isInteger(item.account_id))) {
      throw new LedgerBoardContractError(`accounts[${index}].account_id must be integer or null`);
    }
    return {
      account_id: item.account_id as number | null,
      account_name: requireString(item.account_name, `accounts[${index}].account_name`),
      net_minor: requireInt(item.net_minor, `accounts[${index}].net_minor`),
    };
  });

  return {
    projection_version: version,
    generated_at: root.generated_at as string,
    month,
    series,
    days,
    merchants: { top, others },
    accounts,
  };
}
