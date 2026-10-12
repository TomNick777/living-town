/**
 * MonthlyReport presentation tests: three-tier reading order, chart geometry
 * that follows content (no giant empty cards), and the hard rule that the
 * page only restates projected integers — never sums or recomputes money.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { validateTownState, type TownState } from "../src/town/adapter/townState";
import stable from "../src/fixtures/town-state/stable.json";
import MonthlyReport, { topScenes, trendGeometry, type ReportData } from "../src/showcase/MonthlyReport";

const town = validateTownState(stable) as TownState;

function report(overrides: Partial<ReportData> = {}): ReportData {
  return {
    series: [
      { month: "2026-03", external_income_minor: 900000, net_life_consumption_minor: 400000, investment_export_minor: 50000, net_storage_change_minor: 450000 },
      { month: "2026-04", external_income_minor: 950000, net_life_consumption_minor: 420000, investment_export_minor: 60000, net_storage_change_minor: 470000 },
      { month: "2026-05", external_income_minor: 988800, net_life_consumption_minor: 432100, investment_export_minor: 0, net_storage_change_minor: 556700 },
    ],
    days: [
      { date: "2026-05-01", life_event_count: 2, consumption_minor: 8800, income_minor: 0 },
      { date: "2026-05-02", life_event_count: 0, consumption_minor: 0, income_minor: 0 },
    ],
    merchants: {
      top: [
        { counterparty: "面家", scene: "DINING_SOCIAL", amount_minor: 30000, transaction_count: 5, return_minor: 0 },
        { counterparty: "其他商户", scene: "HOME", amount_minor: 12000, transaction_count: 3, return_minor: 200 },
      ],
      others: { merchant_count: 4, amount_minor: 9900 },
    },
    accounts: [
      { account_id: 1, account_name: "微信零钱", net_minor: -40000 },
      { account_id: null, account_name: "未知账户", net_minor: 988800 },
    ],
    ...overrides,
  };
}

function markup(props: Partial<Parameters<typeof MonthlyReport>[0]> = {}) {
  return renderToStaticMarkup(
    createElement(MonthlyReport, {
      town,
      board: report(),
      loading: false,
      error: null,
      onOpenScene: () => undefined,
      onOpenHealth: () => undefined,
      onOpenReview: () => undefined,
      ...props,
    }),
  );
}

describe("topScenes", () => {
  it("picks the biggest life scenes and never lists INVESTMENT / zero-share rows", () => {
    const picked = topScenes(town, 3);
    expect(picked.length).toBeGreaterThan(0);
    expect(picked.length).toBeLessThanOrEqual(3);
    expect(picked.map(([key]) => key)).not.toContain("INVESTMENT");
    expect(picked.map(([key]) => key)).not.toContain("OTHER");
    const amounts = picked.map(([, item]) => item.amount_minor);
    expect(amounts).toEqual([...amounts].sort((a, b) => b - a));
  });
});

describe("trendGeometry", () => {
  it("widens the plot with the number of months so wide screens fill the card", () => {
    expect(trendGeometry(1).width).toBe(560);
    expect(trendGeometry(12).width).toBe(1008);
    expect(trendGeometry(3).height).toBe(trendGeometry(12).height);
  });
});

describe("MonthlyReport markup", () => {
  it("reads tier 1 first: compact summary figures + where the money went", () => {
    const html = markup();
    expect(html).toContain("本月摘要");
    expect(html).toContain("外部收入");
    expect(html).toContain("¥9,888.00"); // 只格式化传入的投影整数
    expect(html).toContain("上月 ¥9,500.00");
    expect(html).toContain("钱主要花在哪里");
    expect(html).toContain("青川町月刊");
  });

  it("tier 2 keeps trend / lanes / mix with the chart filling the card", () => {
    const html = markup();
    expect(html).toContain("近月节奏");
    expect(html).toContain("钱怎么分开走");
    expect(html).toContain("花在哪些日常里");
    expect(html).toContain("rt-line series-income");
    expect(html).toContain("is-current"); // 当前月在图上被点名
  });

  it("tier 3 stays drill-down: calendar, merchants, accounts", () => {
    const html = markup();
    expect(html).toContain("哪天在过生活");
    expect(html).toContain("钱去了哪些地方");
    expect(html).toContain("各账户本月净流动");
    expect(html).toContain("¥300.00");
    expect(html).toContain("已冲减返还 ¥2.00");
  });

  it("keeps reconciliation honesty as one status line", () => {
    const html = markup();
    expect(html).toContain("report-status");
    const hasPendingText = html.includes("有记录还说不清") || html.includes("对账闭合");
    expect(hasPendingText).toBe(true);
  });

  it("degrades honestly without board data yet", () => {
    const html = markup({ board: null, loading: true });
    expect(html).toContain("正在取回本月账页");
    expect(html).toContain("正在等待账页数据");
    expect(html).not.toContain("上月");
    expect(html).not.toContain("NaN");
  });
});
