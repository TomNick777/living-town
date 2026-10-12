import { useEffect, useRef, useState } from "react";
import {
  BASE_DAY_WALL_SECONDS,
  DAY_SECONDS,
  REPLAY_SPEEDS,
  ReplayEngine,
  type ReplaySnapshot,
  type ReplaySpeed,
  type TownBehavior,
  type TownEvent,
  type TownTarget,
} from "../town/replay/replayEngine";
import { TARGET_PLACES } from "./town3d/townMap";
import { isVisualQaMode } from "../town/replay/visualQa";
import { applyQaScene, parseQaScene, type QaScene } from "../town/replay/visualQaScenes";
import { money } from "./letter";
import "./replayDeck.css";

const TARGET_BADGE: Record<TownTarget, string> = {
  home: "home 住宅",
  office: "office 办公",
  restaurant: "restaurant 餐馆",
  cafe: "cafe 咖啡",
  supermarket: "supermarket 超市",
  logistics: "logistics 宅配",
  transit: "transit 车站",
  clinic: "clinic 诊所",
  leisure: "leisure 文娱",
  unknown: "unknown 未知",
};

/** 行为是表现语义，不是事实位置——标签只说「城市如何表达它」。 */
const BEHAVIOR_BADGE: Record<TownBehavior, string> = {
  VISIT: "到访",
  TRANSIT: "通勤",
  DELIVERY: "配送",
  CREDIT: "入账",
  PASSIVE: "静态",
  UNKNOWN: "未识别",
};

export function clockLabel(seconds: number): string {
  const total = Math.floor(seconds);
  const hh = Math.floor(total / 3600) % 24;
  const mm = Math.floor(total / 60) % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function eventTimeLabel(event: TownEvent): string {
  return clockLabel(event.schedule_seconds);
}

function amountLabel(event: TownEvent): string {
  return `${event.direction === "income" ? "+" : "−"}${money(event.amount_minor)}`;
}

export function useReplaySnapshot(engine: ReplayEngine): ReplaySnapshot {
  const [snapshot, setSnapshot] = useState<ReplaySnapshot>(() => engine.getSnapshot());
  useEffect(() => {
    setSnapshot(engine.getSnapshot());
    return engine.subscribe(() => setSnapshot(engine.getSnapshot()));
  }, [engine]);
  return snapshot;
}

/** 工资到账 toast：CREDIT 的 UI 反馈。事实是「发生了收入」，
 * toast 只呈现金额与时刻，不暗示用户人在哪里。Reset（recent 清空、
 * 状态回 ready）时同步清掉：重放必须和第一次播放表现一致。 */
export function useIncomeToast(snapshot: ReplaySnapshot): TownEvent | null {
  const [toast, setToast] = useState<TownEvent | null>(null);
  const timer = useRef<number | null>(null);
  const toastId = useRef<string | null>(null);
  const latest = snapshot.recent[0];
  const cleared = snapshot.status === "ready" && snapshot.recent.length === 0;
  useEffect(() => {
    if (cleared) {
      toastId.current = null;
      setToast(null);
      return;
    }
    if (!latest || latest.behavior !== "CREDIT" || latest.id === toastId.current) return;
    toastId.current = latest.id;
    setToast(latest);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToast(null), 4500);
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, [cleared, latest?.id, latest?.behavior]);
  return toast;
}

function CoveragePanel({ engine }: { engine: ReplayEngine }) {
  const [open, setOpen] = useState(false);
  const coverage = engine.coverage();
  if (coverage.total === 0) return null;
  const mappedPct = Math.round((1 - coverage.unknownRatio) * 100);
  const maxBucket = coverage.unknownByCategory[0]?.count ?? 0;
  return (
    <div className="replay-coverage">
      <button
        type="button"
        className="replay-coverage-head"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span className="replay-coverage-title">Town Visualization Coverage · 本月城市化率</span>
        <span className="replay-coverage-ratio">{mappedPct}%</span>
        <span className="replay-coverage-counts">
          已映射 {coverage.mapped} · 未映射 {coverage.unknown}（共 {coverage.total} 件）
        </span>
        <span className="replay-coverage-toggle">{open ? "收起 ▲" : "未映射明细 ▼"}</span>
      </button>
      <div className="replay-coverage-bar" role="presentation">
        <div className="replay-coverage-fill" style={{ width: `${mappedPct}%` }} />
      </div>
      <p className="replay-coverage-note">
        覆盖率表达「多少真实生活事件目前拥有城市表现」，不是识别准确率；未映射的事件照常记录，只是不演戏。
      </p>
      {open && (
        <div className="replay-coverage-detail">
          {coverage.unknownByCategory.length === 0 ? (
            <p className="replay-coverage-row">这个月没有未映射的事件。</p>
          ) : (
            coverage.unknownByCategory.map((bucket) => (
              <div key={bucket.categoryCode ?? "NONE"} className="replay-coverage-row">
                <span className="replay-coverage-row-name">{bucket.categoryName ?? bucket.categoryCode ?? "未分类"}</span>
                <span className="replay-coverage-row-bar">
                  <span style={{ width: `${maxBucket === 0 ? 0 : (bucket.count / maxBucket) * 100}%` }} />
                </span>
                <span className="replay-coverage-row-count">{bucket.count} 件</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function CrowdPanel({ snapshot, qaScene }: { snapshot: ReplaySnapshot; qaScene: QaScene | null }) {
  const crowd = snapshot.crowd;
  return (
    <div className="replay-crowd" aria-label="场景密度（仅开发验收）">
      <p className="replay-crowd-title">Crowd density · 表现性人口（不是真实行人轨迹）</p>
      {qaScene && (
        <p className="replay-crowd-line">
          Visual QA scene {qaScene.label} · {snapshot.day} · 目标 {clockLabel(qaScene.clockSeconds)} · {qaScene.speed}× · viewport {qaScene.viewport.width}×{qaScene.viewport.height}
        </p>
      )}
      <p className="replay-crowd-line">
        {crowd.timeOfDayPhase}
        {" · "}event {crowd.eventActors}
        {" · "}ambient {crowd.ambientActors}
        {" · "}total {crowd.totalActors}
        {" · "}BUSY {crowd.busyBuildings} / NORMAL {crowd.normalBuildings} / QUIET {crowd.quietBuildings}
        {" · "}skip event {crowd.skippedEventActors} / ambient {crowd.skippedAmbientActors}
      </p>
    </div>
  );
}

export default function ReplayDeck(props: {
  engine: ReplayEngine;
  loading: boolean;
  error: string | null;
}) {
  const { engine, loading, error } = props;
  const snapshot = useReplaySnapshot(engine);
  const incomeToast = useIncomeToast(snapshot);
  const days = engine.availableDays();
  // Visual QA harness：`?visualQa=1&qaScene=…` 时把回放钉到固定场景。
  const qaScene = parseQaScene();
  const qaApplied = useRef(false);
  useEffect(() => {
    if (!qaScene || loading || error || qaApplied.current) return;
    if (engine.availableDays().length === 0) return;
    qaApplied.current = true;
    applyQaScene(engine, qaScene);
  }, [qaScene, loading, error, engine]);
  const selectedTarget = snapshot.selectedTarget;
  const building = selectedTarget ? snapshot.buildings[selectedTarget] : null;
  const place = selectedTarget ? TARGET_PLACES[selectedTarget] : null;
  const presentationUsed = snapshot.recent.some((event) => event.presentation_time);

  return (
    <section className="replay-deck" aria-label="真实流水回放">
      <div className="replay-head">
        <p className="eyebrow">DATA DRIVEN CITY / 真实流水回放</p>
        <p className="replay-note">
          账本事实驱动城市：到访走进建筑、交通经过车站、网购从宅配站配送到家、
          工资化作收入反馈、固定支出让住宅安静地亮一下。无法识别的消费只记录、不演戏。
        </p>
      </div>
      {!loading && !error && <CoveragePanel engine={engine} />}
      {!loading && !error && isVisualQaMode() && <CrowdPanel snapshot={snapshot} qaScene={qaScene} />}
      {incomeToast && (
        <div className="replay-income-toast" role="status">
          +{money(incomeToast.amount_minor)}
          <small>{clockLabel(incomeToast.schedule_seconds)} 收入到账</small>
        </div>
      )}
      {loading && <p className="replay-status" role="status">正在取回当月城市事件…</p>}
      {error && <p className="replay-status replay-error" role="alert">{error}</p>}
      {!loading && !error && days.length === 0 && (
        <p className="replay-status">这个月没有可回放的生活事件。</p>
      )}
      {!loading && !error && days.length > 0 && (
        <>
          <div className="replay-controls">
            <div className="replay-days" role="group" aria-label="选择日期">
              {days.map((day) => (
                <button
                  key={day}
                  type="button"
                  aria-pressed={snapshot.day === day}
                  onClick={() => engine.selectDay(day)}
                >
                  {day.slice(5)}<small>{engine.dayEventCount(day)}笔</small>
                </button>
              ))}
            </div>
            <div className="replay-transport">
              <button
                type="button"
                className="replay-play"
                aria-label={snapshot.status === "playing" ? "暂停回放" : "播放回放"}
                onClick={() => (snapshot.status === "playing" ? engine.pause() : engine.play())}
                disabled={snapshot.status === "finished" && snapshot.day === null}
              >
                {snapshot.status === "playing" ? "Ⅱ 暂停" : "▷ 播放"}
              </button>
              <button type="button" onClick={() => engine.reset()}>↺ Reset</button>
              <div className="replay-speeds" role="group" aria-label="播放速度">
                {REPLAY_SPEEDS.map((speed: ReplaySpeed) => (
                  <button
                    key={speed}
                    type="button"
                    aria-pressed={snapshot.speed === speed}
                    onClick={() => engine.setSpeed(speed)}
                  >
                    {speed}×
                  </button>
                ))}
              </div>
              <span className="replay-clock" aria-live="off">
                {snapshot.day ?? "----"} · {clockLabel(snapshot.clockSeconds)}
              </span>
            </div>
          </div>
          <div className="replay-progress" role="presentation">
            <div
              className="replay-progress-fill"
              style={{ width: `${Math.min(100, (snapshot.clockSeconds / DAY_SECONDS) * 100)}%` }}
            />
          </div>
          <div className="replay-body">
            <div className="replay-feed" aria-label="事件流">
              <p className="replay-feed-title">
                事件流 {snapshot.firedCount}/{snapshot.totalEvents}
                <span> · 1× 全天 {BASE_DAY_WALL_SECONDS} 秒</span>
              </p>
              {snapshot.recent.length === 0 && (
                <p className="replay-feed-empty">按下播放，让这一天在小镇里发生。</p>
              )}
              <ul>
                {snapshot.recent.slice(0, 8).map((event) => (
                  <li key={event.id}>
                    <button
                      type="button"
                      className={snapshot.highlightedEventId === event.id ? "is-highlighted" : undefined}
                      onClick={() => engine.highlightEvent(snapshot.highlightedEventId === event.id ? null : event.id)}
                    >
                      <span className="replay-feed-time">{eventTimeLabel(event)}</span>
                      <strong>{event.merchant ?? event.category_name ?? "未识别商户"}</strong>
                      <span className="replay-feed-amount">{amountLabel(event)}</span>
                      <span className={`replay-feed-behavior bh-${event.behavior}`}>
                        {BEHAVIOR_BADGE[event.behavior]}
                      </span>
                      <span className={`replay-feed-target target-${event.target}`}>
                        {TARGET_BADGE[event.target]}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              {presentationUsed && (
                <p className="replay-presentation-note">
                  标记为顺序演示的事件在账本里只有日期，没有真实时刻——时间是回放安排，不是事实。
                </p>
              )}
            </div>
            <aside className="replay-inspector" aria-label="建筑事件详情">
              {selectedTarget && building && place ? (
                <>
                  <p className="eyebrow">{selectedTarget === "unknown" ? "未知去处" : "建筑档案"}</p>
                  <h3>{place.label}</h3>
                  <p className="replay-inspector-state">
                    状态 {building.state === "active" ? "活跃" : "安静"} · 忙碌 {building.activityLevel === "BUSY" ? "繁忙" : building.activityLevel === "NORMAL" ? "日常" : "安静"} · 今日到访 {building.visitorCount} 次
                  </p>
                  {building.recentEvents.length === 0 ? (
                    <p className="replay-feed-empty">这一天它还没有被真实的流水点亮。</p>
                  ) : (
                    <ul>
                      {building.recentEvents.map((event) => (
                        <li key={event.id}>
                          <button
                            type="button"
                            onClick={() => engine.highlightEvent(event.id)}
                          >
                            <span className="replay-feed-time">{eventTimeLabel(event)}</span>
                            <strong>{event.merchant ?? event.category_name ?? "未识别商户"}</strong>
                            <span className="replay-feed-amount">{amountLabel(event)}</span>
                            <small>{event.category_name ?? "未分类"}</small>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <button type="button" className="replay-inspector-close" onClick={() => engine.selectTarget(null)}>
                    关闭建筑档案
                  </button>
                </>
              ) : (
                <p className="replay-feed-empty">
                  点击小镇里的建筑（餐馆 / 咖啡 / 超市 / 宅配站 / 车站 / 诊所 / 文娱馆 / 住宅 / 办公），
                  查看驱动它的真实流水。
                </p>
              )}
            </aside>
          </div>
        </>
      )}
    </section>
  );
}
