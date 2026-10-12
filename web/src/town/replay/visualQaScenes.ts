/**
 * Deterministic visual QA scene harness — lightweight, no screenshot framework.
 *
 * `?demo&visualQa=1&qaScene=transit|delivery|cafe|mixed` 把回放快进到
 * 固定的（日期 × 时钟 × 倍率）状态后冻结：同一账本月份 + 本文件
 * 参数 = 同一画面，可重复截图比对。人物可读性的最终验收仍然在默认
 * 页面（不带 visualQa）用肉眼完成，这里只负责「可重现」。
 *
 * 快进只用 ReplayEngine 的公开 tick（固定 dt 步长）；到达时钟后再推进
 * 若干步，等预期角色进入 ARRIVED/DWELLING（真正站在门口/站点），然后
 * setFrozen(true) 让渲染循环保持这一帧。日期取场景 pin 的 day；该日期
 * 不在当月数据里时回退到 busiest day（合成测试文档走这条路径）。
 */

import { ReplayEngine, type ReplaySpeed } from "./replayEngine";
import { isVisualQaMode } from "./visualQa";

export type QaSceneKey = "transit" | "delivery" | "cafe" | "mixed";

export interface QaScene {
  key: QaSceneKey;
  label: string;
  /** 固定日期（真实 2026-08 账本中确有对应事件的日子）。 */
  day: string;
  /** 快进到此回放时钟后等待角色就位并冻结。 */
  clockSeconds: number;
  speed: ReplaySpeed;
  /** 截图时应使用的验收视口（desktop 基准）。 */
  viewport: { width: number; height: number };
  /** 画面里必须能看到的角色（回归断言 + 就位等待条件）。 */
  expectRoles: string[];
  /** 就位等待：至少多少个 expectRoles 人物进入 ARRIVED/DWELLING 才冻结（默认 1）。 */
  minSettled?: number;
}

/** 本项目的主验收视口：1512×850 desktop。 */
export const QA_VIEWPORT = { width: 1512, height: 850 };

const scene = (
  key: QaSceneKey,
  label: string,
  day: string,
  hhmm: string,
  speed: ReplaySpeed,
  expectRoles: string[],
): QaScene => {
  const [hh, mm] = hhmm.split(":").map(Number);
  return { key, label, day, clockSeconds: hh * 3600 + mm * 60, speed, viewport: QA_VIEWPORT, expectRoles };
};

/**
 * 场景日期与时钟对着真实 2026-08 账本逐日核对过（events-2026-08 扫描）：
 * transit  = 08-16 09:00 两笔打车 → 站前乘客成组；
 * delivery = 08-07 08:34 拼多多 DELIVERY → 快递员携包裹走向住宅；
 * cafe     = 08-15 09:21/09:22 连续两笔文娱 VISIT → 同地小组停留（≥2 人就位）；
 * mixed    = 08-15 20:46 DELIVERY + 晚间 ambient 人潮。1× 是关键：8× 下
 *            白天积压会占满 event 上限（8），晚间快递事件会被 skip 掉。
 */
export const QA_SCENES: Record<QaSceneKey, QaScene> = {
  transit: scene("transit", "A · 车站候车", "2026-08-16", "09:02", 8, ["transit-passenger"]),
  delivery: scene("delivery", "B · 快递到家", "2026-08-07", "08:36", 8, ["courier"]),
  cafe: { ...scene("cafe", "C · 场馆小组停留", "2026-08-15", "09:24", 8, ["resident"]), minSettled: 2 },
  mixed: { ...scene("mixed", "D · 晚间混合人潮", "2026-08-15", "20:48", 1, ["courier"]), minSettled: 1 },
};

export function parseQaScene(
  search: string = typeof window !== "undefined" ? window.location.search : "",
  visualQa: boolean = isVisualQaMode(search),
): QaScene | null {
  if (!visualQa) return null;
  const raw = new URLSearchParams(search.startsWith("?") || search.length === 0 ? search : `?${search}`)
    .get("qaScene");
  if (raw && raw in QA_SCENES) return QA_SCENES[raw as QaSceneKey];
  return null;
}

const FAST_FORWARD_STEP = 0.1;
const MAX_FAST_FORWARD_TICKS = 4000;
/** 1× 下快递员从宅配站到住宅约 20 秒人物时 → 上限要覆盖最慢的就位路径。 */
const MAX_SETTLE_TICKS = 400;

function settledCount(engine: ReplayEngine, roles: string[]): { settled: number; total: number } {
  const snapshot = engine.getSnapshot();
  // 只数 event 人物：ambient 是背景群，不该替事件主角「就位」。
  const settled = snapshot.actors.filter(
    (actor) => (actor.phase === "ARRIVED" || actor.phase === "DWELLING") && roles.includes(actor.role),
  ).length;
  return { settled, total: snapshot.actors.length + snapshot.ambientActors.length };
}

function allLeaving(engine: ReplayEngine): boolean {
  const snapshot = engine.getSnapshot();
  const all = [...snapshot.actors, ...snapshot.ambientActors];
  return all.length > 0 && all.every((actor) => actor.phase === "LEAVING");
}

/**
 * 把引擎快进到场景状态并冻结（ready-to-observe）。返回实际选择的日期。
 * 固定 dt 推进：同一文档 + 同一场景 = 同一 actor 集合与位置。
 */
export function applyQaScene(engine: ReplayEngine, target: QaScene): string | null {
  const available = engine.availableDays();
  let day: string | null;
  if (available.includes(target.day)) {
    engine.selectDay(target.day);
    day = target.day;
  } else {
    day = engine.selectBusiestDay();
  }
  if (day === null) return null;
  engine.setSpeed(target.speed);
  engine.play();
  for (
    let i = 0;
    i < MAX_FAST_FORWARD_TICKS && engine.getSnapshot().clockSeconds < target.clockSeconds;
    i += 1
  ) {
    engine.tick(FAST_FORWARD_STEP);
  }
  // 就位等待：paused 时时钟不动，但 tickActors 仍推进人物（引擎既有
  // 语义），因此先暂停再走若干步，让刚触发的人物到达 ARRIVED/DWELLING
  // （真正站在门口/站点）后冻结。达不到预期也照常冻结
  // （best-effort，仍完全 deterministic）。
  engine.pause();
  const minSettled = target.minSettled ?? 1;
  for (let i = 0; i < MAX_SETTLE_TICKS; i += 1) {
    const { settled, total } = settledCount(engine, target.expectRoles);
    if (settled >= minSettled || total === 0) break;
    if (allLeaving(engine)) break; // 预期角色不会再就位：定格在最后的活人画面
    engine.tick(FAST_FORWARD_STEP);
  }
  engine.setFrozen(true);
  return day;
}
