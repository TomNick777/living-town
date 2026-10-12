/**
 * TownStage UI-convergence tests: the DEFAULT view exposes only the light
 * "小镇时间" strip (play + day · clock + coverage chip). Engineering console
 * controls (Reset / speeds / day grid / event feed) stay in ReplayDeck and
 * must NOT appear until the deck is open; visualQa mode opens it for the
 * acceptance harness. Coverage honesty stays reachable (chip, one click deep).
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { ReplayEngine, type TownEvent, type TownEventsDocument, type TownTarget } from "../src/town/replay/replayEngine";
import TownStage, { dayDateLabel } from "../src/showcase/TownStage";

const PORT: Record<string, { spawn: { x: number; z: number }; path: { x: number; z: number }[] }> = {
  restaurant: { spawn: { x: 0, z: -10 }, path: [{ x: 0, z: 0 }, { x: 0, z: 2 }] },
  supermarket: { spawn: { x: -10, z: -10 }, path: [{ x: -10, z: 2 }] },
  unknown: { spawn: { x: 0, z: 0 }, path: [{ x: 1, z: 1 }] },
  home: { spawn: { x: 5, z: 5 }, path: [{ x: 6, z: 6 }] },
  office: { spawn: { x: 7, z: 7 }, path: [{ x: 8, z: 8 }] },
  cafe: { spawn: { x: 9, z: 9 }, path: [{ x: 10, z: 10 }] },
  logistics: { spawn: { x: 11, z: 11 }, path: [{ x: 12, z: 12 }] },
  transit: { spawn: { x: 13, z: 13 }, path: [{ x: 14, z: 14 }] },
  clinic: { spawn: { x: 15, z: 15 }, path: [{ x: 16, z: 16 }] },
  leisure: { spawn: { x: 17, z: 17 }, path: [{ x: 18, z: 18 }] },
};

function routes() {
  return {
    routeFor(target: TownTarget) {
      const leg = PORT[target];
      if (!leg) return null;
      return { spawn: leg.spawn, path: leg.path };
    },
  };
}

let seq = 1;
function event(overrides: Partial<TownEvent>): TownEvent {
  seq += 1;
  return {
    id: `te:${seq}`,
    transaction_id: seq,
    occurred_at: "2026-08-15T09:12:00+08:00",
    time_precision: "SECOND",
    time_of_day_seconds: 9 * 3600 + 720,
    presentation_time: false,
    type: "DINING",
    category_code: "FOOD",
    category_name: "餐饮美食",
    merchant: "面家",
    description: null,
    amount_minor: 3600,
    currency: "CNY",
    direction: "expense",
    target: "restaurant",
    behavior: "VISIT",
    intensity: 0.4,
    rule: "category:FOOD->restaurant",
    transaction_type: "EXPENSE",
    schedule_seconds: 9 * 3600 + 720,
    ...overrides,
  };
}

function document(events: TownEvent[]): TownEventsDocument {
  return {
    projection_version: "town-events-v2",
    rules_version: "town-event-rules-v2",
    generated_at: "2026-09-01T00:00:00+00:00",
    month: "2026-08",
    days: [],
    events,
  };
}

function loadedEngine(events: TownEvent[]): ReplayEngine {
  const engine = new ReplayEngine({ routes: routes(), baseWalkSpeed: 100, maxWalkSpeed: 100 });
  engine.loadDocument(document(events));
  engine.selectBusiestDay();
  return engine;
}

const FIVE_EVENTS = [
  event({}),
  event({ merchant: "超市" }),
  event({ occurred_at: "2026-08-16T08:10:00+08:00", schedule_seconds: 8 * 3600 + 600 }),
  event({ target: "unknown", behavior: "UNKNOWN", category_code: "OTHER_EXPENSE", category_name: "其他支出", merchant: "杂货" }),
  event({ target: "unknown", behavior: "UNKNOWN", category_code: "SERVICES", category_name: "服务", merchant: "洗衣" }),
];
// busiest day 2026-08-15 has 4 events, 2 unknown → coverage 60%.

describe("dayDateLabel", () => {
  it("formats replay days quietly (date · weekday)", () => {
    expect(dayDateLabel("2026-08-16")).toBe("8月16日 · 周日");
    expect(dayDateLabel("2026-08-15")).toBe("8月15日 · 周六");
    expect(dayDateLabel(null)).toBe("----");
  });
});

describe("TownStage default strip", () => {
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).window;
  });

  it("shows only play + town time + coverage chip; console controls stay hidden", () => {
    const html = renderToStaticMarkup(
      createElement(TownStage, { engine: loadedEngine(FIVE_EVENTS), loading: false, error: null }),
    );
    expect(html).toContain("aria-label=\"小镇时间\"");
    expect(html).toContain("8月15日 · 周六 · 00:00");
    expect(html).toContain("▶");
    expect(html).toContain("数据覆盖 60%");
    // 工程控制不得出现在默认界面（能力仍在控制台内）。
    expect(html).not.toContain("Reset");
    expect(html).not.toContain("8×");
    expect(html).not.toContain("24×");
    expect(html).not.toContain("事件流");
    expect(html).not.toContain("选择日期");
    expect(html).not.toContain("DATA DRIVEN CITY");
    expect(html).not.toContain("Town Visualization Coverage"); // 展开明细才出现全称解释
  });

  it("keeps honest status surfaces for loading / empty months", () => {
    const loading = renderToStaticMarkup(
      createElement(TownStage, { engine: loadedEngine([]), loading: true, error: null }),
    );
    expect(loading).toContain("正在取回本期城市事件");
    const empty = renderToStaticMarkup(
      createElement(TownStage, { engine: loadedEngine([]), loading: false, error: null }),
    );
    expect(empty).toContain("这个月没有可回放的生活事件");
    const failed = renderToStaticMarkup(
      createElement(TownStage, { engine: loadedEngine([]), loading: false, error: "boom" }),
    );
    expect(failed).toContain("当月城市事件取回失败");
    expect(failed).toContain("查看原因");
  });

  it("visualQa mode opens the full console so engineering QA keeps everything", () => {
    (globalThis as Record<string, unknown>).window = { location: { search: "?demo&visualQa=1" } };
    const html = renderToStaticMarkup(
      createElement(TownStage, { engine: loadedEngine(FIVE_EVENTS), loading: false, error: null }),
    );
    expect(html).toContain("DATA DRIVEN CITY");
    expect(html).toContain("Reset");
    expect(html).toContain("8×");
    expect(html).toContain("Town Visualization Coverage");
  });
});
