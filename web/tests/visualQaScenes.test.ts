/**
 * Visual QA scene harness: gating, fixed-state reproducibility.
 *
 * 用合成 TownEvent 文档 + 真实路点图（TownWalkways）快进到固定时钟，
 * 断言场景包含预期角色，并且两次应用得到完全相同的 actor 状态 ——
 * 「可重复截图基准」的 deterministic 承诺。
 */

import { describe, expect, it } from "vitest";
import { ReplayEngine, type TownEvent, type TownEventsDocument } from "../src/town/replay/replayEngine";
import { TownWalkways } from "../src/showcase/town3d/townMap";
import {
  QA_SCENES,
  QA_VIEWPORT,
  applyQaScene,
  parseQaScene,
} from "../src/town/replay/visualQaScenes";

function makeEvent(overrides: Partial<TownEvent>): TownEvent {
  return {
    id: `te:${overrides.transaction_id}`,
    transaction_id: overrides.transaction_id ?? 1,
    occurred_at: "2026-08-12T08:00:00+08:00",
    time_precision: "SECOND",
    time_of_day_seconds: 8 * 3600,
    presentation_time: false,
    type: "PURCHASE",
    category_code: "FOOD",
    category_name: "餐饮美食",
    merchant: "测试商户",
    description: null,
    amount_minor: 3000,
    currency: "CNY",
    direction: "expense",
    target: "cafe",
    behavior: "VISIT",
    intensity: 0.4,
    rule: "test",
    transaction_type: "EXPENSE",
    schedule_seconds: 8 * 3600,
    ...overrides,
  } as TownEvent;
}

function engineWith(events: TownEvent[]): ReplayEngine {
  const document: TownEventsDocument = {
    projection_version: "town-events-v2",
    rules_version: "town-event-rules-v2",
    generated_at: "2026-09-01T00:00:00+00:00",
    month: "2026-08",
    days: [{ date: "2026-08-12", event_count: events.length, precise_time_count: events.length }],
    events,
  };
  const engine = new ReplayEngine({ routes: new TownWalkways() });
  engine.loadDocument(document);
  return engine;
}

describe("qaScene parsing", () => {
  it("only activates inside visual QA mode", () => {
    expect(parseQaScene("?demo&qaScene=transit", false)).toBeNull();
    expect(parseQaScene("?demo&visualQa=1&qaScene=transit", true)?.key).toBe("transit");
    expect(parseQaScene("?demo&visualQa=1", true)).toBeNull();
    expect(parseQaScene("?demo&visualQa=1&qaScene=bogus", true)).toBeNull();
  });

  it("defines the four acceptance scenes with the fixed desktop viewport", () => {
    expect(Object.keys(QA_SCENES).sort()).toEqual(["cafe", "delivery", "mixed", "transit"]);
    for (const scene of Object.values(QA_SCENES)) {
      expect(scene.viewport).toEqual(QA_VIEWPORT);
      expect(scene.clockSeconds).toBeGreaterThan(0);
      expect(scene.expectRoles.length).toBeGreaterThan(0);
      expect(scene.day).toMatch(/^2026-08-\d{2}$/);
    }
  });
});

describe("applyQaScene determinism", () => {
  const transitDay = [
    makeEvent({ transaction_id: 101, target: "transit", behavior: "TRANSIT", schedule_seconds: 8 * 3600 }),
    makeEvent({ transaction_id: 102, target: "home", behavior: "DELIVERY", schedule_seconds: 8 * 3600 + 60 }),
    makeEvent({ transaction_id: 103, target: "cafe", behavior: "VISIT", intensity: 0.8, schedule_seconds: 8 * 3600 + 30 }),
  ];

  function rolesAt(target: (typeof QA_SCENES)["transit"]): { roles: string[]; day: string | null } {
    const engine = engineWith(transitDay);
    const day = applyQaScene(engine, target);
    const snapshot = engine.getSnapshot();
    return {
      roles: [
        ...snapshot.actors.map((actor) => actor.role),
        ...snapshot.ambientActors.map((actor) => actor.role),
      ],
      day,
    };
  }

  it("fast-forwards to the pinned clock and freezes in a reproducible state", () => {
    const target = { ...QA_SCENES.transit, clockSeconds: 8 * 3600 + 400 };
    const first = engineWith(transitDay);
    const day = applyQaScene(first, target);
    expect(day).toBe("2026-08-12");
    const snapshot = first.getSnapshot();
    expect(snapshot.status).toBe("paused");
    expect(snapshot.clockSeconds).toBeGreaterThanOrEqual(target.clockSeconds);
    // 冻结后继续 tick 不改变任何画面状态（截图基准成立的前提）。
    const before = first.getSnapshot().actors.map((actor) => `${actor.phase}:${actor.position.x},${actor.position.z}`);
    first.tick(2);
    expect(first.getSnapshot().actors.map((actor) => `${actor.phase}:${actor.position.x},${actor.position.z}`)).toEqual(before);
    expect(first.getSnapshot().clockSeconds).toBe(snapshot.clockSeconds);
  });

  it("transit scene shows a transit-passenger, delivery scene a courier, cafe a group", () => {
    expect(rolesAt({ ...QA_SCENES.transit, clockSeconds: 8 * 3600 + 400 }).roles)
      .toContain("transit-passenger");
    expect(rolesAt({ ...QA_SCENES.delivery, clockSeconds: 8 * 3600 + 120 }).roles)
      .toContain("courier");
    const cafe = rolesAt({ ...QA_SCENES.cafe, clockSeconds: 8 * 3600 + 200 });
    expect(cafe.roles.filter((role) => role === "visitor" || role === "resident").length)
      .toBeGreaterThanOrEqual(2);
  });

  it("same document + same scene = identical actor states", () => {
    const scene = { ...QA_SCENES.mixed, clockSeconds: 8 * 3600 + 400 };
    const a = engineWith(transitDay);
    const b = engineWith(transitDay);
    applyQaScene(a, scene);
    applyQaScene(b, scene);
    const flatten = (engine: ReplayEngine) => engine.getSnapshot().actors.map(
      (actor) => `${actor.id}:${actor.role}:${actor.phase}:${actor.position.x.toFixed(6)},${actor.position.z.toFixed(6)}`,
    );
    expect(flatten(a)).toEqual(flatten(b));
  });

  it("returns null without loaded data", () => {
    const engine = new ReplayEngine({ routes: new TownWalkways() });
    expect(applyQaScene(engine, QA_SCENES.transit)).toBeNull();
  });
});
