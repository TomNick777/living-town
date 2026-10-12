/**
 * Replay runtime tests: ordering, play/pause/reset, speed multiplier,
 * duplicate protection, actor lifecycle, building state binding.
 * Routes are synthetic — the real walkway graph is covered separately.
 */

import { describe, expect, it } from "vitest";
import {
  actorCountForIntensity,
  BASE_DAY_WALL_SECONDS,
  DAY_SECONDS,
  ReplayEngine,
  type TownEvent,
  type TownEventsDocument,
  type TownTarget,
} from "../src/town/replay/replayEngine";

let eventSeq = 100;

function makeEvent(overrides: Partial<TownEvent> = {}): TownEvent {
  eventSeq += 1;
  const occurredAt = overrides.occurred_at ?? "2026-07-12T12:20:00+08:00";
  return {
    id: overrides.id ?? `te:${eventSeq}`,
    transaction_id: overrides.transaction_id ?? eventSeq,
    occurred_at: occurredAt,
    time_precision: "SECOND",
    time_of_day_seconds: 12 * 3600,
    presentation_time: false,
    type: "DINING",
    category_code: "FOOD",
    category_name: "餐饮美食",
    merchant: "麦当劳",
    description: null,
    amount_minor: 3600,
    currency: "CNY",
    direction: "expense",
    target: "restaurant",
    behavior: "VISIT",
    intensity: 0.42,
    rule: "category:FOOD->restaurant",
    transaction_type: "EXPENSE",
    schedule_seconds: overrides.schedule_seconds ?? 12 * 3600,
    ...overrides,
  };
}

function makeDocument(events: TownEvent[]): TownEventsDocument {
  return {
    projection_version: "town-events-v2",
    rules_version: "town-event-rules-v2",
    generated_at: "2026-09-01T00:00:00+00:00",
    month: "2026-07",
    days: [{ date: "2026-07-12", event_count: events.length, precise_time_count: events.length }],
    events,
  };
}

function straightRoutes(port: Record<string, { spawn: { x: number; z: number }; path: { x: number; z: number }[] }>) {
  return {
    routeFor(target: TownTarget) {
      const leg = port[target];
      if (!leg) return null;
      return { spawn: leg.spawn, path: leg.path };
    },
  };
}

function spawnEngine(overrides: Partial<{ maxActors: number; walkSpeed: number }> = {}) {
  const port: Record<string, { spawn: { x: number; z: number }; path: { x: number; z: number }[] }> = {
    restaurant: { spawn: { x: 0, z: -10 }, path: [{ x: 0, z: 0 }, { x: 0, z: 2 }] },
    cafe: { spawn: { x: -10, z: -10 }, path: [{ x: -10, z: 2 }] },
    unknown: { spawn: { x: 0, z: 0 }, path: [{ x: 1, z: 1 }] }, // must never be asked
  };
  const walkSpeed = overrides.walkSpeed ?? 100; // default: near-instant walks
  const engine = new ReplayEngine({
    routes: straightRoutes(port),
    maxActors: overrides.maxActors,
    baseWalkSpeed: walkSpeed,
    maxWalkSpeed: walkSpeed,
  });
  return { engine, port };
}

const STEP = 1 / 60;

function runSeconds(engine: ReplayEngine, seconds: number) {
  for (let i = 0; i < Math.round(seconds / STEP); i += 1) engine.tick(STEP);
}

// ------------------------------------------------------------- scheduling

describe("replay scheduling", () => {
  it("sorts events chronologically and reports next event", () => {
    const { engine } = spawnEngine();
    const late = makeEvent({ schedule_seconds: 21 * 3600, merchant: "夜宵" });
    const early = makeEvent({ schedule_seconds: 8 * 3600, merchant: "早餐" });
    engine.loadDocument(makeDocument([late, early]));
    engine.selectDay("2026-07-12");
    expect(engine.getSnapshot().nextEvent?.merchant).toBe("早餐");
  });

  it("deduplicates events by transaction id (duplicate protection)", () => {
    const { engine } = spawnEngine();
    const event = makeEvent({ transaction_id: 7 });
    const copy = { ...event, id: "te:dup" };
    engine.loadDocument(makeDocument([event, copy]));
    engine.selectDay("2026-07-12");
    expect(engine.getSnapshot().totalEvents).toBe(1);
    engine.play();
    runSeconds(engine, BASE_DAY_WALL_SECONDS + 1);
    const snapshot = engine.getSnapshot();
    expect(snapshot.firedCount).toBe(1);
    expect(snapshot.recent).toHaveLength(1);
  });

  it("never fires the same event twice within one run", () => {
    const { engine } = spawnEngine();
    const event = makeEvent({ schedule_seconds: 0 });
    engine.loadDocument(makeDocument([event]));
    engine.selectDay("2026-07-12");
    engine.play();
    runSeconds(engine, 5);
    runSeconds(engine, 5);
    expect(engine.getSnapshot().firedCount).toBe(1);
  });
});

// ----------------------------------------------------------------- clock

describe("replay clock control", () => {
  function oneEventEngine() {
    const { engine } = spawnEngine();
    engine.loadDocument(makeDocument([makeEvent({ schedule_seconds: 3600 })]));
    engine.selectDay("2026-07-12");
    return engine;
  }

  it("does not advance while paused or before play", () => {
    const engine = oneEventEngine();
    runSeconds(engine, 10);
    expect(engine.getSnapshot().clockSeconds).toBe(0);
    expect(engine.getSnapshot().firedCount).toBe(0);
  });

  it("advances while playing and fires events at their schedule", () => {
    const engine = oneEventEngine();
    engine.play();
    runSeconds(engine, 10);
    const snapshot = engine.getSnapshot();
    // 10 wall seconds at 1× = 10/180 of a day = 4800 day-seconds > 3600
    expect(snapshot.clockSeconds).toBeGreaterThan(3600);
    expect(snapshot.firedCount).toBe(1);
    expect(snapshot.status).toBe("playing");
  });

  it("pause freezes the clock mid-run and play resumes", () => {
    const engine = oneEventEngine();
    engine.play();
    runSeconds(engine, 3);
    engine.pause();
    const paused = engine.getSnapshot();
    expect(paused.status).toBe("paused");
    runSeconds(engine, 5);
    expect(engine.getSnapshot().clockSeconds).toBe(paused.clockSeconds);
    engine.play();
    runSeconds(engine, 1);
    expect(engine.getSnapshot().clockSeconds).toBeGreaterThan(paused.clockSeconds);
  });

  it("reset restores the world: clock, actors, buildings, fired set", () => {
    const engine = oneEventEngine();
    engine.play();
    runSeconds(engine, 10);
    expect(engine.getSnapshot().firedCount).toBe(1);
    engine.reset();
    const snapshot = engine.getSnapshot();
    expect(snapshot.status).toBe("ready");
    expect(snapshot.clockSeconds).toBe(0);
    expect(snapshot.firedCount).toBe(0);
    expect(snapshot.actors).toHaveLength(0);
    expect(snapshot.recent).toHaveLength(0);
    expect(snapshot.buildings.restaurant?.lastEvent).toBeNull();
    expect(snapshot.buildings.restaurant?.visitorCount).toBe(0);
    // 事件仍可再次触发：fired 集合已清空
    engine.play();
    runSeconds(engine, 10);
    expect(engine.getSnapshot().firedCount).toBe(1);
  });

  it("speed multiplier scales the clock", () => {
    const engine = oneEventEngine();
    engine.setSpeed(8);
    engine.play();
    runSeconds(engine, 2);
    const at8 = engine.getSnapshot().clockSeconds;
    // 2 wall seconds at 8× = 2/180*8 of a day ≈ 7680 day-seconds
    expect(at8).toBeGreaterThan(7000);
    engine.setSpeed(1);
    const wallPosition = engine.getSnapshot().clockSeconds;
    engine.setSpeed(24);
    engine.play();
    runSeconds(engine, 1);
    expect(engine.getSnapshot().clockSeconds).toBeGreaterThan(wallPosition + DAY_SECONDS / 180 - 100);
  });

  it("reaches finished only after the day elapses", () => {
    const engine = oneEventEngine();
    engine.play();
    runSeconds(engine, BASE_DAY_WALL_SECONDS + 1);
    expect(engine.getSnapshot().status).toBe("finished");
  });

  it("selectDay switches days and resets", () => {
    const { engine } = spawnEngine();
    engine.loadDocument(makeDocument([
      makeEvent({ occurred_at: "2026-07-11T09:00:00+08:00", schedule_seconds: 9 * 3600 }),
      makeEvent({ occurred_at: "2026-07-12T09:00:00+08:00", schedule_seconds: 9 * 3600 }),
    ]));
    expect(engine.availableDays()).toEqual(["2026-07-11", "2026-07-12"]);
    engine.selectBusiestDay();
    // equal counts -> first day stays chosen deterministically
    expect(engine.currentDay()).toBe("2026-07-11");
    engine.selectDay("2026-07-12");
    expect(engine.currentDay()).toBe("2026-07-12");
    engine.selectDay("2026-07-99"); // unknown date is a no-op
    expect(engine.currentDay()).toBe("2026-07-12");
  });
});

// ---------------------------------------------------------------- actors

describe("actor lifecycle", () => {
  it("spawns an actor that walks the route, arrives, dwells, leaves, despawns", () => {
    const { engine } = spawnEngine({ walkSpeed: 10 }); // 12 米 ≈ 1.2 秒
    engine.loadDocument(makeDocument([makeEvent({ schedule_seconds: 0 })]));
    engine.selectDay("2026-07-12");
    engine.play();
    runSeconds(engine, 0.5);
    let snapshot = engine.getSnapshot();
    expect(snapshot.actors).toHaveLength(1);
    expect(snapshot.actors[0].phase).toBe("WALKING");
    expect(snapshot.actors[0].target).toBe("restaurant");
    // 走完 12 米 + 到达停顿 0.35s -> 停留
    runSeconds(engine, 2.5);
    snapshot = engine.getSnapshot();
    expect(snapshot.actors[0].phase).toBe("DWELLING");
    expect(snapshot.actors[0].position).toEqual({ x: 0, z: 2 }); // 门口
    // restaurant dwell ≈ 6.6s；观察时已过 ~1.45s，再等刚好进入返程
    runSeconds(engine, 6);
    snapshot = engine.getSnapshot();
    expect(snapshot.actors[0]?.phase).toBe("LEAVING");
    // 返程 + 淡出
    runSeconds(engine, 4);
    expect(engine.getSnapshot().actors).toHaveLength(0);
  });

  it("never spawns actors for unknown targets or unroutable targets", () => {
    const { engine } = spawnEngine();
    engine.loadDocument(makeDocument([
      makeEvent({ id: "te:u1", transaction_id: 901, target: "unknown", type: "UNKNOWN", schedule_seconds: 0 }),
      makeEvent({ id: "te:h1", transaction_id: 902, target: "home", type: "HOUSEHOLD", schedule_seconds: 0 }),
    ]));
    engine.selectDay("2026-07-12");
    engine.play();
    runSeconds(engine, 1);
    const snapshot = engine.getSnapshot();
    expect(snapshot.firedCount).toBe(2);
    expect(snapshot.actors).toHaveLength(0); // unknown 不猜；home 无路径不造人
    expect(snapshot.buildings.unknown?.lastEvent).not.toBeNull();
    expect(snapshot.buildings.home?.lastEvent).not.toBeNull();
    expect(snapshot.skippedActorCount).toBe(0);
  });

  it("caps concurrent actors and counts skips transparently", () => {
    const { engine } = spawnEngine();
    engine.loadDocument(makeDocument(
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) =>
        makeEvent({ id: `te:c${n}`, transaction_id: 1000 + n, schedule_seconds: 0 }),
      ),
    ));
    engine.selectDay("2026-07-12");
    engine.play();
    runSeconds(engine, 0.2);
    const snapshot = engine.getSnapshot();
    expect(snapshot.actors.length).toBeLessThanOrEqual(8);
    expect(snapshot.skippedActorCount).toBe(2);
    expect(snapshot.firedCount).toBe(10); // 事件本身一个不丢
  });
});

// -------------------------------------------------------------- buildings

describe("building state", () => {
  it("goes idle -> active on its event and back to idle after the window", () => {
    const { engine } = spawnEngine();
    engine.loadDocument(makeDocument([makeEvent({ schedule_seconds: 0, intensity: 0.42 })]));
    engine.selectDay("2026-07-12");
    expect(engine.getSnapshot().buildings.restaurant?.state).toBe("idle");
    engine.play();
    runSeconds(engine, 0.5);
    const active = engine.getSnapshot().buildings.restaurant;
    expect(active?.state).toBe("active");
    expect(active?.lastEvent?.merchant).toBe("麦当劳");
    expect(active?.visitorCount).toBe(1);
    // 建筑窗口以真实墙钟计（~7.4s），倍率与时钟无关
    runSeconds(engine, 4);
    expect(engine.getSnapshot().buildings.restaurant?.state).toBe("active");
    runSeconds(engine, 5);
    expect(engine.getSnapshot().buildings.restaurant?.state).toBe("idle");
  });

  it("binds each event to its own target building", () => {
    const { engine } = spawnEngine();
    engine.loadDocument(makeDocument([
      makeEvent({ id: "te:r", transaction_id: 71, schedule_seconds: 0, target: "restaurant" }),
      makeEvent({ id: "te:c", transaction_id: 72, schedule_seconds: 0, target: "cafe", type: "COFFEE" }),
    ]));
    engine.selectDay("2026-07-12");
    engine.play();
    runSeconds(engine, 0.5);
    const buildings = engine.getSnapshot().buildings;
    expect(buildings.restaurant?.lastEvent?.id).toBe("te:r");
    expect(buildings.cafe?.lastEvent?.id).toBe("te:c");
    expect(buildings.cafe?.visitorCount).toBe(1);
    expect(buildings.restaurant?.visitorCount).toBe(1);
  });

  it("keeps unknown as a building-less event record without visuals", () => {
    const { engine } = spawnEngine();
    engine.loadDocument(makeDocument([
      makeEvent({ target: "unknown", type: "UNKNOWN", behavior: "UNKNOWN", schedule_seconds: 0 }),
    ]));
    engine.selectDay("2026-07-12");
    engine.play();
    runSeconds(engine, 0.5);
    const snapshot = engine.getSnapshot();
    expect(snapshot.buildings.unknown?.state).toBe("active"); // 记录在案
    expect(snapshot.actors).toHaveLength(0); // 但没有动画来源
  });
});

// ------------------------------------------------------- V2 behaviors

/** 带 routeForEvent 的路线桩：可按行为分发，记录被请求过的事件。 */
function behaviorRoutes() {
  const visits: { spawn: { x: number; z: number }; path: { x: number; z: number }[] } = {
    spawn: { x: 0, z: -10 },
    path: [{ x: 0, z: 0 }, { x: 0, z: 2 }],
  };
  const requested: string[] = [];
  return {
    requested,
    routes: {
      routeFor(target: TownTarget) {
        return target === "unknown" ? null : { spawn: visits.spawn, path: [...visits.path] };
      },
      routeForEvent(event: TownEvent) {
        requested.push(`${event.behavior}:${event.target}`);
        if (event.behavior === "TRANSIT") {
          return {
            spawn: { x: -20, z: 15 },
            path: [{ x: -10, z: 15 }, { x: 0, z: 15 }],
            mode: "through" as const,
            role: "transit-passenger" as const,
          };
        }
        if (event.behavior === "DELIVERY") {
          return { spawn: { x: 5, z: 18 }, path: [{ x: 0, z: -10 }, { x: 0, z: 2 }], role: "courier" as const };
        }
        return { spawn: visits.spawn, path: [...visits.path] };
      },
    },
  };
}

function behaviorEngine(maxActors?: number) {
  const { routes } = behaviorRoutes();
  return new ReplayEngine({
    routes,
    maxActors,
    baseWalkSpeed: 100,
    maxWalkSpeed: 100,
  });
}

describe("v2 behavior semantics", () => {
  it("VISIT spawns walking actors (existing lifecycle preserved)", () => {
    const engine = behaviorEngine();
    engine.loadDocument(makeDocument([makeEvent({ behavior: "VISIT", schedule_seconds: 0 })]));
    engine.selectDay("2026-07-12");
    engine.play();
    runSeconds(engine, 0.5);
    const snapshot = engine.getSnapshot();
    expect(snapshot.actors).toHaveLength(1);
    expect(snapshot.actors[0].role).toBe("visitor");
    expect(snapshot.actors[0].mode).toBe("visit");
  });

  it("CREDIT never spawns a fake office visitor but raises an income pulse", () => {
    const { engine } = spawnEngine();
    engine.loadDocument(makeDocument([
      makeEvent({
        behavior: "CREDIT", type: "WORK", target: "office", direction: "income",
        amount_minor: 476958, merchant: "代发工资", schedule_seconds: 0,
      }),
    ]));
    engine.selectDay("2026-07-12");
    engine.play();
    runSeconds(engine, 1);
    const snapshot = engine.getSnapshot();
    expect(snapshot.actors).toHaveLength(0); // 工资 ≠ 人走到办公室
    expect(snapshot.buildings.office?.state).toBe("active"); // 办公楼短暂高亮
    expect(snapshot.incomePulses).toHaveLength(1);
    expect(snapshot.incomePulses[0].amountMinor).toBe(476958);
    runSeconds(engine, 4);
    expect(engine.getSnapshot().incomePulses).toHaveLength(0); // pulse 会过期
  });

  it("PASSIVE updates the building without any actor route", () => {
    const engine = behaviorEngine();
    engine.loadDocument(makeDocument([
      makeEvent({ behavior: "PASSIVE", type: "HOUSEHOLD", target: "home", schedule_seconds: 0 }),
    ]));
    engine.selectDay("2026-07-12");
    engine.play();
    runSeconds(engine, 1);
    const snapshot = engine.getSnapshot();
    expect(snapshot.actors).toHaveLength(0);
    expect(snapshot.buildings.home?.state).toBe("active");
  });

  it("TRANSIT uses a through-route passenger that fades at the exit, not a round trip", () => {
    const engine = behaviorEngine();
    engine.loadDocument(makeDocument([
      makeEvent({
        behavior: "TRANSIT", type: "TRANSIT", target: "transit",
        category_code: "TRANSPORT", merchant: "滴滴出行", schedule_seconds: 0,
      }),
    ]));
    engine.selectDay("2026-07-12");
    engine.play();
    runSeconds(engine, 0.5);
    let snapshot = engine.getSnapshot();
    expect(snapshot.actors).toHaveLength(1);
    expect(snapshot.actors[0].role).toBe("transit-passenger");
    expect(snapshot.actors[0].mode).toBe("through");
    // 路线 20 米、速度 100 -> 到终点后短停靠（约 2.15s），然后就地淡出。
    runSeconds(engine, 1.5);
    snapshot = engine.getSnapshot();
    expect(snapshot.actors[0].position.x).toBeGreaterThan(-5); // 已越过站点点位（x=-10）
    runSeconds(engine, 2);
    expect(engine.getSnapshot().actors).toHaveLength(0); // 在出口淡出，不走回头路
  });

  it("DELIVERY spawns one courier from the depot and pulses at home", () => {
    const engine = behaviorEngine();
    engine.loadDocument(makeDocument([
      makeEvent({
        behavior: "DELIVERY", type: "PARCEL", target: "logistics",
        category_code: "SHOPPING", merchant: "淘宝闪购", intensity: 0.95, schedule_seconds: 0,
      }),
    ]));
    engine.selectDay("2026-07-12");
    engine.play();
    runSeconds(engine, 0.5);
    const snapshot = engine.getSnapshot();
    // 即使 intensity 很高也只有 1 名 courier：一次网购 = 一次配送，
    // intensity 只放大配送 pulse，不换算成更多快递员。
    expect(snapshot.actors).toHaveLength(1);
    expect(snapshot.actors[0].role).toBe("courier");
    expect(snapshot.deliveryPulses).toHaveLength(1); // 住宅侧的配送反馈
  });
});

// ---------------------------------------------------- V2 actor counts

describe("v2 actor density", () => {
  it("maps intensity bands to 1..3 actors (amount never equals people directly)", () => {
    expect(actorCountForIntensity(0.15)).toBe(1);
    expect(actorCountForIntensity(0.42)).toBe(1);
    expect(actorCountForIntensity(0.5)).toBe(2);
    expect(actorCountForIntensity(0.67)).toBe(2);
    expect(actorCountForIntensity(0.75)).toBe(3);
    expect(actorCountForIntensity(1)).toBe(3);
  });

  it("spawns up to 3 staggered actors for a high-intensity visit", () => {
    const engine = behaviorEngine();
    engine.loadDocument(makeDocument([
      makeEvent({ behavior: "VISIT", intensity: 0.9, schedule_seconds: 0 }),
    ]));
    engine.selectDay("2026-07-12");
    engine.play();
    runSeconds(engine, 0.2);
    const snapshot = engine.getSnapshot();
    expect(snapshot.actors).toHaveLength(3);
    const delays = snapshot.actors.map((actor) => actor.delay);
    expect(delays[0]).toBeLessThanOrEqual(0);
    expect(delays[1]).toBeGreaterThan(delays[0]);
    expect(delays[2]).toBeGreaterThan(delays[1]);
    // 错峰等待中的角色尚未出现（opacity 0），出发后可见。
    expect(snapshot.actors[0].opacity).toBe(1);
    expect(snapshot.actors[2].opacity).toBe(0);
  });

  it("keeps the global actor cap and counts every skipped actor transparently", () => {
    const engine = behaviorEngine(8);
    engine.loadDocument(makeDocument(
      [0, 1, 2, 3, 4].map((n) =>
        makeEvent({ id: `te:hi${n}`, transaction_id: 2000 + n, intensity: 0.9, schedule_seconds: 0 }),
      ),
    ));
    engine.selectDay("2026-07-12");
    engine.play();
    runSeconds(engine, 0.2);
    const snapshot = engine.getSnapshot();
    expect(snapshot.actors.length).toBe(8);
    expect(snapshot.skippedActorCount).toBe(7); // 5 事件 × 3 人 = 15 -> 15-8
    expect(snapshot.firedCount).toBe(5); // 事件本身一个不丢
  });
});

// ------------------------------------------------- V2 building density

describe("v2 building activity level", () => {
  it("rises to BUSY with 3+ events in the window and decays back to QUIET", () => {
    const engine = behaviorEngine();
    engine.loadDocument(makeDocument([
      makeEvent({ id: "te:a", transaction_id: 31, schedule_seconds: 0 }),
      makeEvent({ id: "te:b", transaction_id: 32, schedule_seconds: 1 }),
      makeEvent({ id: "te:c", transaction_id: 33, schedule_seconds: 2 }),
    ]));
    engine.selectDay("2026-07-12");
    engine.play();
    runSeconds(engine, 1);
    expect(engine.getSnapshot().buildings.restaurant?.activityLevel).toBe("BUSY");
    // 20s 墙钟窗口过后衰减回 QUIET（人物已散，建筑恢复安静）。
    runSeconds(engine, 21);
    expect(engine.getSnapshot().buildings.restaurant?.activityLevel).toBe("QUIET");
    expect(engine.getSnapshot().buildings.restaurant?.state).toBe("idle");
  });

  it("stays NORMAL with a single event and resets with the world", () => {
    const engine = behaviorEngine();
    engine.loadDocument(makeDocument([makeEvent({ schedule_seconds: 0 })]));
    engine.selectDay("2026-07-12");
    expect(engine.getSnapshot().buildings.restaurant?.activityLevel).toBe("QUIET");
    engine.play();
    runSeconds(engine, 1);
    expect(engine.getSnapshot().buildings.restaurant?.activityLevel).toBe("NORMAL");
    engine.reset();
    expect(engine.getSnapshot().buildings.restaurant?.activityLevel).toBe("QUIET");
    expect(engine.getSnapshot().deliveryPulses).toHaveLength(0);
    expect(engine.getSnapshot().incomePulses).toHaveLength(0);
  });
});

// ------------------------------------------------------ V2 coverage

describe("v2 coverage summary", () => {
  it("counts mapped / unknown / ratio and ranks unknown categories", () => {
    const engine = behaviorEngine();
    engine.loadDocument(makeDocument([
      makeEvent({ target: "restaurant" }),
      makeEvent({ id: "te:t1", transaction_id: 41, target: "transit", type: "TRANSIT", behavior: "TRANSIT", category_code: "TRANSPORT", category_name: "交通出行" }),
      makeEvent({ id: "te:u1", transaction_id: 42, target: "unknown", type: "UNKNOWN", behavior: "UNKNOWN", category_code: "OTHER_EXPENSE", category_name: "其他支出" }),
      makeEvent({ id: "te:u2", transaction_id: 43, target: "unknown", type: "UNKNOWN", behavior: "UNKNOWN", category_code: "OTHER_EXPENSE", category_name: "其他支出" }),
      makeEvent({ id: "te:u3", transaction_id: 44, target: "unknown", type: "UNKNOWN", behavior: "UNKNOWN", category_code: null, category_name: null }),
    ]));
    const coverage = engine.coverage();
    expect(coverage.total).toBe(5);
    expect(coverage.mapped).toBe(2);
    expect(coverage.unknown).toBe(3);
    expect(coverage.unknownRatio).toBe(0.6);
    expect(coverage.unknownByCategory[0]).toMatchObject({ categoryCode: "OTHER_EXPENSE", count: 2 });
    expect(coverage.unknownByCategory[1]).toMatchObject({ categoryCode: null, count: 1 });
  });
});

// -------------------------------------------------- V2 deterministic

describe("v2 deterministic replay", () => {
  it("replays identically after reset (actors, pulses, order)", () => {
    const events = [
      makeEvent({ id: "te:d1", transaction_id: 51, schedule_seconds: 0 }),
      makeEvent({ id: "te:d2", transaction_id: 52, schedule_seconds: 1, intensity: 0.9 }),
      makeEvent({ id: "te:d3", transaction_id: 53, schedule_seconds: 2, behavior: "DELIVERY", type: "PARCEL", target: "logistics", merchant: "京东" }),
      makeEvent({ id: "te:d4", transaction_id: 54, schedule_seconds: 3, behavior: "CREDIT", type: "WORK", target: "office", direction: "income" }),
    ];
    const first = behaviorEngine();
    first.loadDocument(makeDocument(events));
    first.selectDay("2026-07-12");
    first.play();
    runSeconds(first, 2.5);
    const firstSnapshot = first.getSnapshot();

    first.reset();
    first.play();
    runSeconds(first, 2.5);
    const secondSnapshot = first.getSnapshot();

    expect(secondSnapshot.firedCount).toBe(firstSnapshot.firedCount);
    expect(secondSnapshot.recent.map((event) => event.id)).toEqual(firstSnapshot.recent.map((event) => event.id));
    expect(secondSnapshot.actors.map((actor) => [actor.id, actor.eventId, actor.role, actor.phase, actor.position.x, actor.position.z]))
      .toEqual(firstSnapshot.actors.map((actor) => [actor.id, actor.eventId, actor.role, actor.phase, actor.position.x, actor.position.z]));
    expect(secondSnapshot.deliveryPulses).toHaveLength(firstSnapshot.deliveryPulses.length);
  });

  it("two engines given the same document produce identical runs", () => {
    const events = [
      makeEvent({ id: "te:s1", transaction_id: 61, schedule_seconds: 0, intensity: 0.8 }),
      makeEvent({ id: "te:s2", transaction_id: 62, schedule_seconds: 5, behavior: "TRANSIT", type: "TRANSIT", target: "transit" }),
    ];
    const a = behaviorEngine();
    const b = behaviorEngine();
    a.loadDocument(makeDocument(events));
    b.loadDocument(makeDocument(events));
    a.selectDay("2026-07-12");
    b.selectDay("2026-07-12");
    a.play();
    b.play();
    runSeconds(a, 3);
    runSeconds(b, 3);
    const sa = a.getSnapshot();
    const sb = b.getSnapshot();
    expect(sb.actors.map((actor) => [actor.id, actor.role, actor.mode, actor.position.x, actor.position.z]))
      .toEqual(sa.actors.map((actor) => [actor.id, actor.role, actor.mode, actor.position.x, actor.position.z]));
  });
});
