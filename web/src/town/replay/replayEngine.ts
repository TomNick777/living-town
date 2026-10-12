/**
 * Replay runtime: TownEvent 序列 -> 时钟 -> 建筑状态 -> 人物状态机。
 *
 * 这是表达层的 presentation runtime，不是第二套账本：它只消费
 * /api/town-events 的已投影事件，绝不解释流水、绝不计算财务语义。
 * 时钟是「一天中的秒数」（0..86400），按倍率压缩推进；动画阶段
 * 只读这里的 snapshot，不回源账本。
 *
 * V2 行为语义（与投影端 behavior 对应，全部是 presentation semantics）：
 * - VISIT     spawn -> 路径 -> 建筑 -> dwell -> 原路离开（resident/visitor）；
 * - TRANSIT   街口 spawn -> transit hub 短暂停靠 -> 出口淡出（through，
 *              不伪装真实 GPS 行程）；
 * - DELIVERY  配送员（courier）从宅配站到住宅往返 + 住宅配送 pulse，
 *              每次1 名 courier：一次网购 = 一次配送，intensity 只放大脉冲；
 * - CREDIT    收入 pulse + UI 反馈，绝不生成「工资到账人到办公室」的人物；
 * - PASSIVE   只做建筑状态反馈，不产生人物路线；
 * - UNKNOWN   诚实 no-op：记录在案，无任何动画来源。
 *
 * 人物状态机：WALKING -> ARRIVED -> DWELLING -> LEAVING -> (移除)；
 * 多人物事件按 intensity 生成 1..3 个（错峰出发），全局仍受 maxActors 约束。
 * 建筑状态：idle -> active（事件绑定 + 有界时长）-> idle；另有
 * activityLevel（QUIET/NORMAL/BUSY）＝ replay 时间窗口内的繁忙程度，
 * 是 presentation runtime state，不写回任何账本或世界领域模型。
 */

import type { TownBehavior, TownEvent, TownEventsDocument, TownTarget } from "../adapter/townEvents";
import {
  DEFAULT_MAX_AMBIENT_ACTORS,
  DEFAULT_MAX_EVENT_ACTORS,
  DEFAULT_MAX_TOTAL_ACTORS,
  measureCrowd,
  planAmbientSpawns,
  type AmbientStreetKind,
  type CrowdMetrics,
} from "./crowdDirector";
import { eventDwellWallSeconds, eventStaggerDelay, hash32 } from "./eventPresence";
import { timeOfDayPhase, type TimeOfDayPhase } from "./timeOfDay";

export type { TownEvent, TownEventsDocument, TownTarget, TownBehavior };
export type { AmbientStreetKind, CrowdMetrics };

export const DAY_SECONDS = 86400;
/** 1× 把一天压缩为 180 秒真实时间。 */
export const BASE_DAY_WALL_SECONDS = 180;
export const REPLAY_SPEEDS = [1, 8, 24] as const;
export type ReplaySpeed = (typeof REPLAY_SPEEDS)[number];

export type ReplayStatus = "ready" | "playing" | "paused" | "finished";
export type BuildingState = "idle" | "active";
export type ActivityLevel = "QUIET" | "NORMAL" | "BUSY";

/** 人物只是 presentation role，不是 NPC：同一个人形表达不同的城市活动。 */
export type ActorRole = "resident" | "visitor" | "courier" | "transit-passenger";

export interface RoutePoint {
  x: number;
  z: number;
}

export interface ActorRoute {
  /** 出生点（家门 / 街口 / 宅配站）。 */
  spawn: RoutePoint;
  /** 出生点 -> 目标门/出口的路径（不含 spawn，含终点）。 */
  path: RoutePoint[];
  /** through = 走到终点就地淡出（TRANSIT）；缺省 = 原路返回。 */
  mode?: "visit" | "through";
  /** 该路线对应的人物角色（DELIVERY 路线 = courier 等）。 */
  role?: ActorRole;
}

export interface ReplayRoutes {
  /** 返回 null = 该目标没有可走的路（不制造穿墙人物）。 */
  routeFor(target: TownTarget, seed: number): ActorRoute | null;
  /** V2：按事件语义取路线（TRANSIT/DELIVERY 需要非对称路线）。
   * 未实现时引擎回退到 routeFor(target, seed)（VISIT 兼容）。 */
  routeForEvent?(event: TownEvent, index: number): ActorRoute | null;
  /** 场所 ambient：由 activityLevel 派生，不是一笔流水。缺省 = 不造背景人。 */
  ambientPlaceRoute?(target: TownTarget, seed: number): ActorRoute | null;
  /** 街道 ambient：presentation 人流，不对应交易。缺省 = 不造背景人。 */
  ambientStreetRoute?(kind: AmbientStreetKind, seed: number): ActorRoute | null;
}

export type ActorPhase = "WALKING" | "ARRIVED" | "DWELLING" | "LEAVING";

export interface ActorState {
  id: number;
  eventId: string;
  target: TownTarget;
  role: ActorRole;
  phase: ActorPhase;
  route: RoutePoint[];
  /** 当前段下标；WALKING 走 [0..n-1]，LEAVING 原路返回。 */
  leg: number;
  legProgress: number;
  position: RoutePoint;
  /** 朝向（弧度，renderer 直接用于旋转）。 */
  heading: number;
  phaseRemaining: number;
  opacity: number;
  /** 同一事件多人物时的错峰墙钟（>0 时原地等待，不画出来）。 */
  delay: number;
  /** visit = 原路返回；through = 终点就地淡出。 */
  mode: "visit" | "through";
  /** 到达后的停留墙钟（由 eventId+target 确定性产生）。 */
  dwellWall: number;
}

/**
 * 背景人口：只表达「这个地方目前比较活跃」，不是 TownEvent。
 * 禁止携带 transactionId / merchant / amount / source fact。
 */
export interface AmbientActorState {
  id: number;
  kind: "ambient";
  seed: string;
  role: ActorRole;
  target: TownTarget | null;
  streetKind: AmbientStreetKind | null;
  phase: ActorPhase;
  route: RoutePoint[];
  leg: number;
  legProgress: number;
  position: RoutePoint;
  heading: number;
  phaseRemaining: number;
  opacity: number;
  delay: number;
  mode: "visit" | "through";
  dwellWall: number;
}

export interface BuildingRuntime {
  target: TownTarget;
  state: BuildingState;
  /** 繁忙程度：当前 replay 窗口内的事件数 + intensity 的派生观感。 */
  activityLevel: ActivityLevel;
  intensity: number;
  activeUntilWall: number | null;
  lastEvent: TownEvent | null;
  visitorCount: number;
  recentEvents: TownEvent[];
}

/** CREDIT 的城市反馈：办公楼（收入来源）pulse + UI 金额提示。 */
export interface IncomePulse {
  eventId: string;
  amountMinor: number;
  untilWall: number;
}

/** DELIVERY 的终点反馈：宅配送达住宅的 pulse（表现隐喻，非事实位置）。 */
export interface DeliveryPulse {
  eventId: string;
  untilWall: number;
}

export interface ReplaySnapshot {
  status: ReplayStatus;
  day: string | null;
  clockSeconds: number;
  speed: ReplaySpeed;
  totalEvents: number;
  firedCount: number;
  nextEvent: TownEvent | null;
  buildings: Record<string, BuildingRuntime>;
  actors: ActorState[];
  /** 背景人口：与 actors（事件人物）隔离，renderer 分开上色。 */
  ambientActors: AmbientActorState[];
  crowd: CrowdMetrics;
  timeOfDayPhase: TimeOfDayPhase;
  /** 最近触发的事件（新在前，含 unknown）。 */
  recent: TownEvent[];
  highlightedEventId: string | null;
  selectedTarget: TownTarget | null;
  /** 因并发上限被跳过的人物个数（透明，不静默丢弃事件本身）。 */
  skippedActorCount: number;
  incomePulses: IncomePulse[];
  deliveryPulses: DeliveryPulse[];
}

export interface ReplayEngineOptions {
  routes: ReplayRoutes;
  /** Explicit presentation montage; retains event dates and uses supplied period schedule. */
  periodMontage?: boolean;
  maxActors?: number;
  maxAmbientActors?: number;
  maxTotalActors?: number;
  /** 每档倍率下的人物墙钟速度上限（米/秒）。 */
  baseWalkSpeed?: number;
  maxWalkSpeed?: number;
}

/** Town Visualization Coverage：当月文档的映射/未知统计（只读投影结果）。 */
export interface CoverageSummary {
  total: number;
  mapped: number;
  unknown: number;
  unknownRatio: number;
  unknownByCategory: { categoryCode: string | null; categoryName: string | null; count: number }[];
}

const DEFAULT_MAX_ACTORS = DEFAULT_MAX_EVENT_ACTORS;
const DEFAULT_BASE_WALK_SPEED = 2.2;
const DEFAULT_MAX_WALK_SPEED = 9;
const ARRIVED_WALL_SECONDS = 0.35;
const BUILDING_ACTIVE_BASE_WALL_SECONDS = 5;
/** activityLevel 的回看窗口（墙钟秒）与档位。 */
const ACTIVITY_WINDOW_WALL_SECONDS = 20;
const BUSY_EVENT_THRESHOLD = 3;
/** intensity -> 单事件人数（上限 3；金额永远不直接等于人数）。 */
const INTENSITY_HIGH = 0.75;
const INTENSITY_MEDIUM = 0.5;

export function actorCountForIntensity(intensity: number): number {
  if (intensity >= INTENSITY_HIGH) return 3;
  if (intensity >= INTENSITY_MEDIUM) return 2;
  return 1;
}

interface ScheduledDay {
  date: string;
  events: TownEvent[];
}

function clonePoint(point: RoutePoint): RoutePoint {
  return { x: point.x, z: point.z };
}

function segmentLength(a: RoutePoint, b: RoutePoint): number {
  return Math.hypot(b.x - a.x, b.z - a.z);
}

export class ReplayEngine {
  private readonly routes: ReplayRoutes;
  private readonly periodMontage: boolean;
  private readonly maxActors: number;
  private readonly maxAmbientActors: number;
  private readonly maxTotalActors: number;
  private readonly baseWalkSpeed: number;
  private readonly maxWalkSpeed: number;

  private days: ScheduledDay[] = [];
  private dayIndex = -1;
  private firedIds = new Set<string>();
  private nextEventIndex = 0;
  private actors: ActorState[] = [];
  private ambientActors: AmbientActorState[] = [];
  private actorSeq = 0;
  private ambientSeq = 0;
  private skippedActorCount = 0;
  private skippedAmbientCount = 0;
  private deniedAmbientSeeds = new Set<string>();
  private readonly buildings = new Map<string, BuildingRuntime>();
  private recent: TownEvent[] = [];
  private incomePulses: IncomePulse[] = [];
  private deliveryPulses: DeliveryPulse[] = [];
  private monthCoverage: CoverageSummary = {
    total: 0, mapped: 0, unknown: 0, unknownRatio: 0, unknownByCategory: [],
  };
  /** 每栋建筑的 active 墙钟时刻（activityLevel 的回看窗口数据）。 */
  private readonly activations = new Map<string, number[]>();
  private statusValue: ReplayStatus = "ready";
  private clock = 0;
  /** 播放中累计的真实秒数（不随倍率缩放）：建筑 active 窗口、
   * 人物停留都用它，保证任何倍率下视觉反馈时长是稳定的。 */
  private wallPlayed = 0;
  private speedValue: ReplaySpeed = 1;
  /** 仅 visual QA 截图基准使用：true 时 tick 完全停摆，画面保持最后一帧。 */
  private frozenValue = false;
  private highlightedEventId: string | null = null;
  private selectedTarget: TownTarget | null = null;
  private listeners = new Set<() => void>();

  constructor(options: ReplayEngineOptions) {
    this.routes = options.routes;
    this.periodMontage = options.periodMontage ?? false;
    this.maxActors = options.maxActors ?? DEFAULT_MAX_ACTORS;
    this.maxAmbientActors = options.maxAmbientActors ?? DEFAULT_MAX_AMBIENT_ACTORS;
    this.maxTotalActors = options.maxTotalActors ?? DEFAULT_MAX_TOTAL_ACTORS;
    this.baseWalkSpeed = options.baseWalkSpeed ?? DEFAULT_BASE_WALK_SPEED;
    this.maxWalkSpeed = options.maxWalkSpeed ?? DEFAULT_MAX_WALK_SPEED;
  }

  // ------------------------------------------------------------ document

  loadDocument(document: TownEventsDocument): void {
    // duplicate protection：同一事实只调度一次。
    const seen = new Set<number>();
    const unique: TownEvent[] = [];
    for (const event of document.events) {
      if (seen.has(event.transaction_id)) continue;
      seen.add(event.transaction_id);
      unique.push(event);
    }
    const montage = this.periodMontage || document.presentation?.mode === "period_montage";
    if (montage) {
      const label = document.presentation?.montage_label ?? document.month;
      const events = unique.sort((a, b) =>
        a.schedule_seconds - b.schedule_seconds ||
        a.occurred_at.localeCompare(b.occurred_at) ||
        a.transaction_id - b.transaction_id,
      );
      this.days = events.length ? [{ date: label, events }] : [];
    } else {
      const byDay = new Map<string, TownEvent[]>();
      for (const event of unique) {
        const date = event.occurred_at.slice(0, 10);
        const list = byDay.get(date);
        if (list) list.push(event);
        else byDay.set(date, [event]);
      }
      this.days = [...byDay.entries()]
        .map(([date, events]) => ({
          date,
          events: events.sort((a, b) =>
            a.schedule_seconds - b.schedule_seconds ||
            a.occurred_at.localeCompare(b.occurred_at) ||
            a.transaction_id - b.transaction_id,
          ),
        }))
        .sort((a, b) => a.date.localeCompare(b.date));
    }
    this.dayIndex = -1;
    this.highlightedEventId = null;
    this.selectedTarget = null;
    this.monthCoverage = summarizeCoverage(document.events);
    this.reset();
  }

  availableDays(): string[] {
    return this.days.map((day) => day.date);
  }

  dayEventCount(date: string): number {
    return this.days.find((day) => day.date === date)?.events.length ?? 0;
  }

  /** 当月 Town Visualization Coverage（来自已加载文档，只读统计）。 */
  coverage(): CoverageSummary {
    return this.monthCoverage;
  }

  /** 选择要回放的一天；默认给「事件最多的日子」用。 */
  selectBusiestDay(): string | null {
    let best: ScheduledDay | null = null;
    for (const day of this.days) {
      if (!best || day.events.length > best.events.length) best = day;
    }
    if (!best) return null;
    this.selectDay(best.date);
    return best.date;
  }

  selectDay(date: string): void {
    const index = this.days.findIndex((day) => day.date === date);
    if (index < 0) return;
    this.dayIndex = index;
    this.reset();
  }

  currentDay(): string | null {
    return this.dayIndex >= 0 ? this.days[this.dayIndex].date : null;
  }

  // -------------------------------------------------------------- control

  play(): void {
    if (this.dayIndex < 0 || this.statusValue === "finished") return;
    this.statusValue = "playing";
    this.emit();
  }

  pause(): void {
    if (this.statusValue !== "playing") return;
    this.statusValue = "paused";
    this.emit();
  }

  /** Reset：世界恢复（时钟归零、人物清空、建筑回 idle、fired 清空）。
   * actorSeq 一并归零：同一天重放的 id 序列保持一致（deterministic replay）。 */
  reset(): void {
    this.statusValue = "ready";
    this.frozenValue = false;
    this.clock = 0;
    this.wallPlayed = 0;
    this.nextEventIndex = 0;
    this.firedIds = new Set();
    this.actors = [];
    this.ambientActors = [];
    this.actorSeq = 0;
    this.ambientSeq = 0;
    this.skippedActorCount = 0;
    this.skippedAmbientCount = 0;
    this.deniedAmbientSeeds = new Set();
    this.recent = [];
    this.incomePulses = [];
    this.deliveryPulses = [];
    this.buildings.clear();
    this.activations.clear();
    this.emit();
  }

  setSpeed(speed: ReplaySpeed): void {
    if (!REPLAY_SPEEDS.includes(speed)) return;
    this.speedValue = speed;
    this.emit();
  }

  setFrozen(frozen: boolean): void {
    if (this.frozenValue === frozen) return;
    this.frozenValue = frozen;
    if (frozen) this.pause();
    this.emit();
  }

  highlightEvent(eventId: string | null): void {
    this.highlightedEventId = eventId;
    const event = this.recent.find((candidate) => candidate.id === eventId);
    this.selectedTarget = event ? event.target : null;
    this.emit();
  }

  selectTarget(target: TownTarget | null): void {
    this.selectedTarget = target;
    this.emit();
  }

  // ---------------------------------------------------------------- clock

  /** 每帧推进；paused/ready 时时钟不动，但人物残部仍会收尾。frozen（QA 截图）时完全停摆。 */
  tick(wallDt: number): void {
    if (this.frozenValue) return;
    const dt = Math.min(Math.max(wallDt, 0), 0.1);
    if (this.statusValue === "playing") {
      this.wallPlayed += dt;
      this.clock += dt * (DAY_SECONDS / BASE_DAY_WALL_SECONDS) * this.speedValue;
      this.fireDueEvents();
      if (this.clock >= DAY_SECONDS && this.nextEventIndex >= this.currentEvents().length) {
        this.statusValue = "finished";
      }
    }
    this.tickActors(dt);
    this.expireBuildings();
    this.tickAmbientDirector();
    this.tickAmbientActors(dt);
    this.expirePulses();
    this.emitThrottled();
  }

  // ------------------------------------------------------------- snapshot

  getSnapshot(): ReplaySnapshot {
    const events = this.currentEvents();
    const buildings: Record<string, BuildingRuntime> = {};
    for (const [target, runtime] of this.buildings) buildings[target] = runtime;
    for (const event of events) {
      if (!buildings[event.target]) {
        buildings[event.target] = {
          target: event.target,
          state: "idle",
          activityLevel: "QUIET",
          intensity: 0,
          activeUntilWall: null,
          lastEvent: null,
          visitorCount: 0,
          recentEvents: [],
        };
      }
    }
    return {
      status: this.statusValue,
      day: this.currentDay(),
      clockSeconds: Math.min(this.clock, DAY_SECONDS),
      speed: this.speedValue,
      totalEvents: events.length,
      firedCount: this.firedIds.size,
      nextEvent: this.nextEventIndex < events.length ? events[this.nextEventIndex] : null,
      buildings,
      actors: this.actors,
      ambientActors: this.ambientActors,
      crowd: measureCrowd({
        eventActors: this.actors.length,
        ambientActors: this.ambientActors.length,
        buildings: this.buildings.values(),
        skippedEventActors: this.skippedActorCount,
        skippedAmbientActors: this.skippedAmbientCount,
        clockSeconds: Math.min(this.clock, DAY_SECONDS),
      }),
      timeOfDayPhase: timeOfDayPhase(this.clock),
      recent: this.recent,
      highlightedEventId: this.highlightedEventId,
      selectedTarget: this.selectedTarget,
      skippedActorCount: this.skippedActorCount,
      incomePulses: this.incomePulses,
      deliveryPulses: this.deliveryPulses,
    };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // -------------------------------------------------------------- internals

  private currentEvents(): TownEvent[] {
    return this.dayIndex >= 0 ? this.days[this.dayIndex].events : [];
  }

  private fireDueEvents(): void {
    const events = this.currentEvents();
    while (this.nextEventIndex < events.length) {
      const event = events[this.nextEventIndex];
      if (event.schedule_seconds > this.clock) break;
      this.nextEventIndex += 1;
      if (this.firedIds.has(event.id)) continue; // duplicate protection
      this.firedIds.add(event.id);
      this.applyEvent(event);
    }
  }

  private applyEvent(event: TownEvent): void {
    this.recent.unshift(event);
    if (this.recent.length > 30) this.recent.length = 30;

    const building = this.buildingRuntime(event.target);
    building.lastEvent = event;
    building.intensity = event.intensity;
    building.visitorCount += 1;
    building.recentEvents.unshift(event);
    if (building.recentEvents.length > 8) building.recentEvents.length = 8;
    building.activeUntilWall = this.wallNow() + BUILDING_ACTIVE_BASE_WALL_SECONDS + event.intensity * 5;
    this.activationTimes(event.target).push(this.wallNow());

    if (event.behavior === "CREDIT") {
      // 工资到账：城市收入反馈。事实只有「发生了收入」——
      // 不生成任何「人走进办公楼」的人物。
      this.incomePulses.push({
        eventId: event.id,
        amountMinor: event.amount_minor,
        untilWall: this.wallNow() + 3.2,
      });
      return;
    }
    if (event.behavior === "PASSIVE" || event.behavior === "UNKNOWN") return; // 不猜，不制造动画
    if (event.behavior === "DELIVERY") {
      // 配送隐喻的终点反馈：包裹抵达住宅（表现，不是事实位置重建）。
      this.deliveryPulses.push({
        eventId: event.id,
        untilWall: this.wallNow() + 2.6,
      });
      this.spawnActors(event, 1);
      return;
    }
    // VISIT / TRANSIT：intensity -> 1..3 人（错峰出发，共享全局上限）。
    // 纵深防御：无论 behavior 写什么，unknown 目标永不产生人物。
    if (event.target === "unknown") return;
    this.spawnActors(event, actorCountForIntensity(event.intensity));
  }

  private spawnActors(event: TownEvent, count: number): void {
    for (let index = 0; index < count; index += 1) {
      if (this.actors.length >= this.maxActors) {
        this.skippedActorCount += 1; // 计数透明：人物被跳过，事件本身不丢
        continue;
      }
      const route = this.routes.routeForEvent
        ? this.routes.routeForEvent(event, index)
        : this.routes.routeFor(event.target, event.transaction_id + index);
      if (!route || route.path.length === 0) return; // 无路线不造人
      const points = [clonePoint(route.spawn), ...route.path.map(clonePoint)];
      const role = route.role ?? defaultRoleFor(event, route);
      this.actorSeq += 1;
      this.actors.push({
        id: this.actorSeq,
        eventId: event.id,
        target: event.target,
        role,
        phase: "WALKING",
        route: points,
        leg: 0,
        legProgress: 0,
        position: clonePoint(route.spawn),
        heading: this.headingBetween(points[0], points[1] ?? points[0]),
        phaseRemaining: 0,
        opacity: 0, // 错峰等待期不显示，出发时淡入
        delay: eventStaggerDelay(event.id, index, count, event.behavior),
        mode: route.mode ?? "visit",
        dwellWall: eventDwellWallSeconds(role, event.target, event.id),
      });
    }
  }

  private buildingRuntime(target: TownTarget): BuildingRuntime {
    let runtime = this.buildings.get(target);
    if (!runtime) {
      runtime = {
        target,
        state: "idle",
        activityLevel: "QUIET",
        intensity: 0,
        activeUntilWall: null,
        lastEvent: null,
        visitorCount: 0,
        recentEvents: [],
      };
      this.buildings.set(target, runtime);
    }
    return runtime;
  }

  private activationTimes(target: TownTarget): number[] {
    let list = this.activations.get(target);
    if (!list) {
      list = [];
      this.activations.set(target, list);
    }
    return list;
  }

  private wallNow(): number {
    return this.wallPlayed;
  }

  private tickActors(dt: number): void {
    const speedFactor = Math.max(1, this.speedValue);
    const walkSpeed = Math.min(this.maxWalkSpeed, this.baseWalkSpeed * speedFactor);
    for (const actor of this.actors) this.tickMover(actor, dt, walkSpeed, speedFactor);
    this.actors = this.actors.filter((actor) => actor.opacity > 0 || actor.delay > 0);
  }

  private tickAmbientActors(dt: number): void {
    const speedFactor = Math.max(1, this.speedValue);
    const walkSpeed = Math.min(this.maxWalkSpeed, this.baseWalkSpeed * speedFactor);
    for (const actor of this.ambientActors) this.tickMover(actor, dt, walkSpeed, speedFactor);
    this.ambientActors = this.ambientActors.filter((actor) => actor.opacity > 0 || actor.delay > 0);
  }

  private tickAmbientDirector(): void {
    if (this.statusValue !== "playing") return;
    if (!this.routes.ambientPlaceRoute && !this.routes.ambientStreetRoute) return;
    const ambientBudget = Math.min(
      this.maxAmbientActors,
      Math.max(0, this.maxTotalActors - this.actors.length),
    );
    if (this.ambientActors.length > ambientBudget) {
      this.ambientActors = this.ambientActors.slice(0, ambientBudget);
    }
    const plan = planAmbientSpawns({
      clockSeconds: this.clock,
      wallNow: this.wallNow(),
      day: this.currentDay(),
      buildings: this.buildings,
      eventActorCount: this.actors.length,
      ambientActors: this.ambientActors,
      skippedAmbientActors: this.skippedAmbientCount,
    });
    this.skippedAmbientCount += plan.skipped;
    const liveSeeds = new Set(this.ambientActors.map((actor) => actor.seed));
    const deny = (seed: string): void => {
      if (this.deniedAmbientSeeds.has(seed)) return;
      this.deniedAmbientSeeds.add(seed);
      this.skippedAmbientCount += 1;
    };
    for (const intent of plan.spawns) {
      if (liveSeeds.has(intent.seed)) continue;
      if (this.ambientActors.length >= this.maxAmbientActors) {
        deny(intent.seed);
        continue;
      }
      if (this.actors.length + this.ambientActors.length >= this.maxTotalActors) {
        deny(intent.seed);
        continue;
      }
      const seedNumber = hash32(intent.seed);
      const route = intent.kind === "place" && intent.target
        ? this.routes.ambientPlaceRoute?.(intent.target, seedNumber) ?? null
        : intent.streetKind
          ? this.routes.ambientStreetRoute?.(intent.streetKind, seedNumber) ?? null
          : null;
      if (!route || route.path.length === 0) {
        deny(intent.seed);
        continue;
      }
      const points = [clonePoint(route.spawn), ...route.path.map(clonePoint)];
      this.ambientSeq += 1;
      this.ambientActors.push({
        id: this.ambientSeq,
        kind: "ambient",
        seed: intent.seed,
        role: route.role ?? intent.role,
        target: intent.target,
        streetKind: intent.streetKind,
        phase: "WALKING",
        route: points,
        leg: 0,
        legProgress: 0,
        position: clonePoint(route.spawn),
        heading: this.headingBetween(points[0], points[1] ?? points[0]),
        phaseRemaining: 0,
        opacity: 1,
        delay: 0,
        mode: route.mode ?? (intent.kind === "street" ? "through" : "visit"),
        dwellWall: intent.dwellWall,
      });
      liveSeeds.add(intent.seed);
    }
  }

  private tickMover(actor: ActorState | AmbientActorState, dt: number, walkSpeed: number, speedFactor: number): void {
    if (actor.delay > 0) {
      actor.delay -= dt;
      if (actor.delay <= 0) actor.opacity = 1;
      return;
    }
    if (actor.opacity === 0) actor.opacity = 1;
    switch (actor.phase) {
      case "WALKING":
      case "LEAVING":
        this.advanceAlongRoute(actor, walkSpeed * dt);
        break;
      case "ARRIVED":
      case "DWELLING":
        actor.phaseRemaining -= dt;
        if (actor.phaseRemaining > 0) break;
        if (actor.phase === "ARRIVED") {
          actor.phase = "DWELLING";
          actor.phaseRemaining = Math.max(1, actor.dwellWall / speedFactor);
        } else if (actor.mode === "through") {
          actor.phase = "LEAVING";
          actor.route = [];
          actor.leg = 0;
          actor.legProgress = 0;
        } else {
          actor.phase = "LEAVING";
          actor.route = [...actor.route].reverse();
          actor.leg = 0;
          actor.legProgress = 0;
        }
        break;
    }
    if (actor.phase === "LEAVING" && actor.leg >= actor.route.length - 1) {
      actor.opacity = Math.max(0, actor.opacity - dt * 2.5);
    }
  }

  /** 沿折线前进给定距离；走完按阶段转入 ARRIVED（去程）或原地淡出（归程）。 */
  private advanceAlongRoute(actor: ActorState | AmbientActorState, distance: number): void {
    let remaining = distance;
    while (remaining > 0 && actor.leg < actor.route.length - 1) {
      const from = actor.route[actor.leg];
      const to = actor.route[actor.leg + 1];
      const length = segmentLength(from, to);
      if (length <= 0) {
        actor.leg += 1;
        actor.legProgress = 0;
        continue;
      }
      const step = Math.min(remaining, length - actor.legProgress * length);
      actor.legProgress += step / length;
      remaining -= step;
      actor.heading = this.headingBetween(from, to);
      actor.position = {
        x: from.x + (to.x - from.x) * actor.legProgress,
        z: from.z + (to.z - from.z) * actor.legProgress,
      };
      if (actor.legProgress >= 1) {
        actor.leg += 1;
        actor.legProgress = 0;
      }
    }
    if (actor.leg >= actor.route.length - 1 && actor.phase === "WALKING") {
      actor.phase = "ARRIVED";
      actor.phaseRemaining = ARRIVED_WALL_SECONDS;
    }
  }

  private headingBetween(from: RoutePoint, to: RoutePoint): number {
    return Math.atan2(to.x - from.x, to.z - from.z);
  }

  private expireBuildings(): void {
    const now = this.wallNow();
    for (const runtime of this.buildings.values()) {
      const active = runtime.activeUntilWall !== null && runtime.activeUntilWall > now;
      runtime.state = active ? "active" : "idle";
      if (!active) runtime.activeUntilWall = null;
      const times = this.activations.get(runtime.target) ?? [];
      while (times.length > 0 && times[0] <= now - ACTIVITY_WINDOW_WALL_SECONDS) times.shift();
      runtime.activityLevel =
        times.length >= BUSY_EVENT_THRESHOLD ? "BUSY"
          : times.length >= 1 ? "NORMAL" : "QUIET";
    }
  }

  private expirePulses(): void {
    const now = this.wallNow();
    this.incomePulses = this.incomePulses.filter((pulse) => pulse.untilWall > now);
    this.deliveryPulses = this.deliveryPulses.filter((pulse) => pulse.untilWall > now);
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  private lastEmit = 0;

  private emitThrottled(): void {
    // tick 每帧调用；listener（React）按需节流。
    const now = Date.now();
    if (now - this.lastEmit >= 100) {
      this.lastEmit = now;
      this.emit();
    }
  }
}

function defaultRoleFor(event: TownEvent, route: ActorRoute): ActorRole {
  if (route.role) return route.role;
  if (event.behavior === "TRANSIT") return "transit-passenger";
  if (event.behavior === "DELIVERY") return "courier";
  return "visitor";
}

function summarizeCoverage(events: TownEvent[]): CoverageSummary {
  const byCategory = new Map<string, { categoryCode: string | null; categoryName: string | null; count: number }>();
  let unknown = 0;
  for (const event of events) {
    if (event.target !== "unknown") continue;
    unknown += 1;
    const key = event.category_code ?? "NONE";
    const bucket = byCategory.get(key);
    if (bucket) bucket.count += 1;
    else byCategory.set(key, {
      categoryCode: event.category_code,
      categoryName: event.category_name,
      count: 1,
    });
  }
  return {
    total: events.length,
    mapped: events.length - unknown,
    unknown,
    unknownRatio: events.length === 0 ? 0 : Math.round((unknown / events.length) * 1000) / 1000,
    unknownByCategory: [...byCategory.values()].sort((a, b) =>
      b.count - a.count || (a.categoryCode ?? "NONE").localeCompare(b.categoryCode ?? "NONE")),
  };
}
