import { describe, expect, it } from "vitest";
import { hasPending, money, realLetter } from "../src/showcase/letter";
import type { TownState } from "../src/town/adapter/townState";
import stable from "../../tests/fixtures/town-showcase/stable.json";

const base = structuredClone(stable) as TownState;

/** A town state with specific bands/figures; only the fields under test differ. */
function townWith(overrides: {
  income?: number;
  net?: number;
  storage?: number;
  unreconciled?: number;
  pressure?: string;
  saving?: string;
  balanced?: boolean;
  refunds?: number;
  legs?: number;
}): TownState {
  const next = structuredClone(base);
  next.financial.external_income_minor = overrides.income ?? 1000000;
  next.financial.net_life_consumption_minor = overrides.net ?? 400000;
  next.financial.net_storage_change_minor = overrides.storage ?? 100000;
  next.financial.unreconciled_minor = overrides.unreconciled ?? 0;
  next.state.consumption_pressure = { score: 0.4, band: (overrides.pressure ?? "NORMAL") as never };
  next.state.saving_strength = { score: 0.3, band: (overrides.saving ?? "MODERATE") as never };
  next.financial.balanced = overrides.balanced ?? true;
  next.unresolved.refunds = overrides.refunds ?? 0;
  next.unresolved.transfer_legs = overrides.legs ?? 0;
  next.unresolved.unknown_transactions = 0;
  return next;
}

describe("money formatting", () => {
  it("renders integer minors without any float arithmetic", () => {
    expect(money(0)).toBe("¥0.00");
    expect(money(5)).toBe("¥0.05");
    expect(money(123456789)).toBe("¥1,234,567.89");
    expect(money(-2517)).toBe("−¥25.17");
  });
});

describe("realLetter stays grounded in the projection", () => {
  it("EXTREME pressure + NONE saving + pending reads exactly as scored", () => {
    const letter = realLetter(
      townWith({ income: 476958, net: 522986, storage: -508347, unreconciled: 2517, pressure: "EXTREME", saving: "NONE", balanced: false, refunds: 6, legs: 20 }),
    );
    expect(letter.heading).toBe("这一页，开支绷得比较紧。");
    expect(letter.note).toContain("¥4,769.58");
    expect(letter.note).toContain("¥5,229.86");
    expect(letter.note).toContain("达到或超过了收入");
    expect(letter.note).toContain("余裕暂无积累");
    expect(letter.note).toContain("退款 6 笔 · 转账 20 笔");
    expect(letter.note).toContain("¥25.17");
    expect(letter.note).toContain("不做自动修正");
  });

  it("LOW pressure + STRONG saving + clean ledger gets the calm copy", () => {
    const letter = realLetter(townWith({ income: 1000000, net: 300000, storage: 400000, pressure: "LOW", saving: "STRONG" }));
    expect(letter.heading).toBe("日子过得从容。");
    expect(letter.note).toContain("远在收入之内");
    expect(letter.note).toContain("余裕读数「充足」");
    expect(letter.note).toContain("对账无待办事项");
  });

  it("non-salary months are stated as such, both with and without spending", () => {
    const spending = realLetter(townWith({ income: 0, net: 120000, pressure: "EXTREME" }));
    expect(spending.note).toContain("没有外部收入记录");
    expect(spending.note).toContain("紧绷");
    const quiet = realLetter(townWith({ income: 0, net: 0, pressure: "LOW" }));
    expect(quiet.note).toContain("也没有生活支出");
  });

  it("hasPending follows the same predicate as the source strip", () => {
    expect(hasPending(townWith({}))).toBe(false);
    expect(hasPending(townWith({ balanced: false }))).toBe(true);
    expect(hasPending(townWith({ legs: 1 }))).toBe(true);
  });
});
