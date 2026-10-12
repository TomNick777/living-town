import { describe, expect, it, vi } from "vitest";
import { validateLedgerBoard } from "../src/town/adapter/ledgerBoard";
import { validateLedgerReview } from "../src/town/adapter/ledgerReview";
import { fetchLedgerBoard, fetchLedgerReview, ledgerBoardUrl, ledgerReviewUrl } from "../src/town/world/ledgerClient";
import { TownStateSourceError } from "../src/town/world/townStateClient";
import { maxAbs, barShare } from "../src/showcase/scale";

const board = {
  projection_version: "ledger-board-v1",
  generated_at: "2026-09-16T00:00:00+00:00",
  month: "2026-08",
  series: [
    {
      month: "2026-08",
      external_income_minor: 100,
      net_life_consumption_minor: 40,
      investment_export_minor: 10,
      net_storage_change_minor: 50,
      unreconciled_minor: 0,
      balanced: true,
    },
  ],
  days: [
    {
      date: "2026-08-01",
      life_event_count: 1,
      consumption_count: 1,
      consumption_minor: 40,
      income_count: 0,
      income_minor: 0,
    },
  ],
  merchants: {
    top: [
      {
        counterparty: "麦当劳",
        scene: "DINING_SOCIAL",
        transaction_count: 1,
        amount_minor: 40,
        consumption_minor: 40,
        return_minor: 0,
      },
    ],
    others: { merchant_count: 0, transaction_count: 0, amount_minor: 0 },
  },
  accounts: [{ account_id: 1, account_name: "微信零钱", net_minor: -40 }],
};

const review = {
  projection_version: "ledger-review-v1",
  generated_at: "2026-09-16T00:00:00+00:00",
  month: "2026-08",
  total_count: 1,
  limit: 80,
  offset: 0,
  type_counts: { INCOME: 0, EXPENSE: 1, TRANSFER: 0, REFUND: 0, INVESTMENT: 0, UNKNOWN: 0 },
  bucket_counts: {
    unpaired_transfer: 0,
    unresolved_refund: 0,
    unknown_type: 0,
    unattributed_account: 0,
    unclassified: 0,
    pending: 0,
  },
  transactions: [
    {
      transaction_id: 1,
      occurred_at: "2026-08-01T12:00:00+08:00",
      source: "wechat",
      counterparty: "麦当劳",
      description: "套餐",
      amount_minor: 40,
      currency: "CNY",
      direction: "OUTFLOW",
      transaction_type: "EXPENSE",
      status: "支付成功",
      account_name: "微信零钱",
      category_code: "FOOD",
      category_name: "餐饮美食",
      scene: "DINING_SOCIAL",
      classification_source: "MERCHANT",
      manual_override: false,
      flags: [],
    },
  ],
};

function ok(payload: unknown) {
  return Promise.resolve(new Response(JSON.stringify(payload), { status: 200 }));
}

describe("ledger board adapter", () => {
  it("accepts a valid board and rejects a version drift", () => {
    expect(validateLedgerBoard(board).merchants.top[0].counterparty).toBe("麦当劳");
    expect(() => validateLedgerBoard({ ...board, projection_version: "ledger-board-v2" })).toThrow(/unsupported/);
  });
});

describe("ledger review adapter", () => {
  it("accepts a valid review and rejects unknown types", () => {
    expect(validateLedgerReview(review).total_count).toBe(1);
    const bad = structuredClone(review);
    bad.transactions[0].transaction_type = "FOOD";
    expect(() => validateLedgerReview(bad)).toThrow(/transaction_type/);
  });
});

describe("ledger client", () => {
  it("requests documented endpoints and fails closed", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok(board));
    await expect(fetchLedgerBoard("2026-08", fetchImpl as unknown as typeof fetch)).resolves.toMatchObject({ month: "2026-08" });
    expect(fetchImpl.mock.calls[0][0]).toBe(ledgerBoardUrl("2026-08"));
    const reviewFetch = vi.fn().mockResolvedValue(ok(review));
    await expect(
      fetchLedgerReview({ month: "2026-08", type: "EXPENSE" }, reviewFetch as unknown as typeof fetch),
    ).resolves.toMatchObject({ total_count: 1 });
    expect(reviewFetch.mock.calls[0][0]).toBe(ledgerReviewUrl({ month: "2026-08", type: "EXPENSE" }));
    await expect(fetchLedgerBoard("2026/08", vi.fn() as unknown as typeof fetch)).rejects.toThrow(TownStateSourceError);
  });
});

describe("presentation scale", () => {
  it("does not invent a financial total, only a layout peak", () => {
    expect(maxAbs([0, -80, 40])).toBe(80);
    expect(barShare(40, 80)).toBe(0.5);
    expect(barShare(0, 0)).toBe(0);
  });
});
