/**
 * TownStage —— 生活小镇默认界面的「小镇时间」层。
 *
 * 产品收敛原则：小镇画面是主角；回放引擎、覆盖率统计、事件流等能力
 * 全部保留，但默认只暴露一个轻量时间条（播放/暂停 + 日期 · 时刻）。
 * Reset / 倍速 / 日期格 / 事件流 / 建筑档案等工程控制折叠进「控制台」
 * （即原 ReplayDeck），visualQa 模式自动展开控制台。
 * coverage 降级为角落 chip，点击才展开真实性明细——不删除诚实性。
 */
import { useState } from "react";
import { DAY_SECONDS, type ReplayEngine, type ReplaySnapshot } from "../town/replay/replayEngine";
import { isVisualQaMode } from "../town/replay/visualQa";
import { TARGET_PLACES } from "./town3d/townMap";
import ReplayDeck, { clockLabel, useIncomeToast, useReplaySnapshot } from "./ReplayDeck";
import { money } from "./letter";
import "./townStage.css";

const WEEKDAY_NAMES = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

/** "2026-08-16" → "8月16日 · 周日"。只做展示格式化，不触碰事实。 */
export function dayDateLabel(date: string | null): string {
  if (!date) return "----";
  const parts = date.split("-").map(Number);
  const weekday = new Date(parts[0], parts[1] - 1, parts[2]).getDay();
  return `${parts[1]}月${parts[2]}日 · ${WEEKDAY_NAMES[weekday]}`;
}

const ACTIVITY_NAMES: Record<string, string> = { QUIET: "安静", NORMAL: "日常", BUSY: "繁忙" };

export default function TownStage(props: { engine: ReplayEngine; loading: boolean; error: string | null; periodMontage?: boolean }) {
  const { engine, loading, error, periodMontage = false } = props;
  const snapshot = useReplaySnapshot(engine);
  const incomeToast = useIncomeToast(snapshot);
  const days = engine.availableDays();
  // visualQa 是开发验收通道：控制台默认展开，工程能力零删减。
  const [deckOpen, setDeckOpen] = useState(() => isVisualQaMode());
  const [coverageOpen, setCoverageOpen] = useState(false);

  const coverage = engine.coverage();
  const hasEvents = !loading && !error && days.length > 0;
  const playing = snapshot.status === "playing";
  const finished = snapshot.status === "finished";
  const dayIndex = snapshot.day ? days.indexOf(snapshot.day) : -1;
  const mappedPct = coverage.total === 0 ? 0 : Math.round((1 - coverage.unknownRatio) * 100);
  const progressPct = Math.min(100, (snapshot.clockSeconds / DAY_SECONDS) * 100);

  function togglePlay() {
    if (playing) {
      engine.pause();
      return;
    }
    if (finished) engine.reset();
    engine.play();
  }

  function stepDay(delta: number) {
    if (days.length < 2 || dayIndex < 0) return;
    engine.selectDay(days[(dayIndex + delta + days.length) % days.length]);
  }

  return <div className="town-stage">
    {hasEvents && !deckOpen && incomeToast && (
      <div className="town-stage-toast" role="status">
        +{money(incomeToast.amount_minor)}
        <small>{clockLabel(incomeToast.schedule_seconds)} 收入到账</small>
      </div>
    )}
    <div className="town-strip-zone">
      {hasEvents && (
        <div className="town-strip-overlay">
          {coverageOpen && coverage.total > 0 && (
            <div className="town-coverage-pop" role="region" aria-label="数据覆盖说明">
              <p className="town-coverage-pop-head">
                <strong>Town Visualization Coverage · 本月城市化率 {mappedPct}%</strong>
                <span>已映射 {coverage.mapped} · 未映射 {coverage.unknown}（共 {coverage.total} 件）</span>
              </p>
              <p className="town-coverage-pop-note">
                覆盖率表达「多少真实生活事件目前拥有城市表现」，不是识别准确率；未映射的事件照常记录，只是不演戏。
              </p>
              {coverage.unknownByCategory.length > 0 && (
                <ul className="town-coverage-pop-rows">
                  {coverage.unknownByCategory.map((bucket) => (
                    <li key={bucket.categoryCode ?? "NONE"}>
                      <span>{bucket.categoryName ?? bucket.categoryCode ?? "未分类"}</span>
                      <strong>{bucket.count} 件</strong>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {!deckOpen && <StageInspector engine={engine} snapshot={snapshot} onOpenConsole={() => setDeckOpen(true)} />}
        </div>
      )}
      <div className="town-time-strip" role="group" aria-label="小镇时间">
      {loading && <span className="town-strip-status" role="status">正在取回本期城市事件…</span>}
      {!loading && error && (
        <span className="town-strip-status is-error" role="status">
          当月城市事件取回失败 · <button type="button" className="town-strip-inline" onClick={() => setDeckOpen(true)}>查看原因 ⋯</button>
        </span>
      )}
      {hasEvents && <>
        <button
          type="button"
          className="town-strip-play"
          aria-label={playing ? "暂停小镇时间" : finished ? (periodMontage ? "重播本期" : "重播这一天") : "播放小镇时间"}
          onClick={togglePlay}
        >
          {playing ? "❚❚" : "▶"}
        </button>
        <span className="town-strip-daynav">
          {!periodMontage && <button type="button" aria-label="前一个有记录的日子" disabled={days.length < 2} onClick={() => stepDay(-1)}>‹</button>}
          <span className="town-strip-date" title={`${snapshot.firedCount}/${snapshot.totalEvents} 件事件已发生`}>
            {periodMontage
              ? `${snapshot.recent[0]?.occurred_at.slice(5, 10) ?? "期初"} · 本期缩时 ${clockLabel(snapshot.clockSeconds)}`
              : `${dayDateLabel(snapshot.day)} · ${clockLabel(snapshot.clockSeconds)}`}
          </span>
          {!periodMontage && <button type="button" aria-label="后一个有记录的日子" disabled={days.length < 2} onClick={() => stepDay(1)}>›</button>}
        </span>
        <span className="town-strip-progress" role="presentation"><i style={{ width: `${progressPct}%` }} /></span>
      </>}
      {!loading && !error && days.length === 0 && (
        <span className="town-strip-status">这个月没有可回放的生活事件。</span>
      )}
      {hasEvents && (
        <span className="town-strip-side">
          {coverage.total > 0 && (
            <button type="button" className="town-coverage-chip" aria-expanded={coverageOpen} onClick={() => setCoverageOpen(!coverageOpen)}>
              数据覆盖 {mappedPct}%
            </button>
          )}
          <button type="button" className="town-console-toggle" aria-expanded={deckOpen} onClick={() => setDeckOpen(!deckOpen)}>
            {deckOpen ? "收起控制台" : "⋯"}
          </button>
        </span>
      )}
      </div>
    </div>
    {deckOpen && <ReplayDeck engine={engine} loading={loading} error={error} />}
  </div>;
}

/** 点击小镇建筑后的轻量档案；完整事件流在控制台里。 */
function StageInspector(props: { engine: ReplayEngine; snapshot: ReplaySnapshot; onOpenConsole: () => void }) {
  const { engine, snapshot } = props;
  const target = snapshot.selectedTarget;
  const building = target ? snapshot.buildings[target] : null;
  const place = target ? TARGET_PLACES[target] : null;
  if (!target || !building || !place) return null;
  return <aside className="town-stage-inspector" aria-label="建筑档案">
    <div className="town-stage-inspector-head">
      <p>{target === "unknown" ? "未知去处" : "建筑档案"}</p>
      <h3>{place.label}<small>{building.visitorCount > 0 ? `今日到访 ${building.visitorCount} 次` : "今天还没被点亮"}</small></h3>
      <button type="button" aria-label="关闭建筑档案" onClick={() => engine.selectTarget(null)}>×</button>
    </div>
    <p className="town-stage-inspector-state">
      状态 {building.state === "active" ? "活跃" : "安静"} · 忙碌 {ACTIVITY_NAMES[building.activityLevel] ?? building.activityLevel}
    </p>
    {building.recentEvents.length > 0 && (
      <ul>
        {building.recentEvents.slice(0, 3).map((event) => (
          <li key={event.id}>
            <button type="button" onClick={() => engine.highlightEvent(event.id)}>
              <span>{clockLabel(event.schedule_seconds)}</span>
              <strong>{event.merchant ?? event.category_name ?? "未识别商户"}</strong>
              <em>{event.direction === "income" ? "+" : "−"}{money(event.amount_minor)}</em>
            </button>
          </li>
        ))}
      </ul>
    )}
    <button type="button" className="town-stage-inspector-more" onClick={props.onOpenConsole}>在控制台里看完整事件流 ↗</button>
  </aside>;
}
