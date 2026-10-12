import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { type LifeScene, type TownState, type TownStateMetrics } from "../town/adapter/townState";
import type { LedgerBoard } from "../town/adapter/ledgerBoard";
import type { LedgerReview, ReviewBucket, ReviewType } from "../town/adapter/ledgerReview";
import { ReplayEngine } from "../town/replay/replayEngine";
import { projectTownVisualState } from "../town/visual/townVisualProjector";
import { fetchLedgerBoard, fetchLedgerReview } from "../town/world/ledgerClient";
import { fetchAvailableMonths, fetchTownState, TownStateSourceError } from "../town/world/townStateClient";
import {
  availableYearKeys,
  fetchTownPeriod,
  type TownPeriodPayload,
} from "../town/world/townPeriodClient";
import { LedgerBoardPage } from "./LedgerBoard";
import { LedgerReviewPage } from "./LedgerReview";
import TownStage from "./TownStage";
import { ShowcaseWalkways } from "./town3d/showcaseTownMap";
import { SCENE_NAMES } from "./copy";
import { money, realLetter } from "./letter";
import { isLocalLedger, ledgerTransport } from "./demoSource";
import "./showcase.css";
import "./town3d/immersive.css";
import "./portfolio.css";

const Town3D = lazy(() => import("./town3d/Town3D"));
const metrics: { key: keyof TownStateMetrics; name: string; meaning: string }[] = [
  { key: "vitality", name: "生活气息", meaning: "活动天数与生活场景影响街上的人流；消费金额不参与活跃度评分。" },
  { key: "consumption_pressure", name: "支出节奏", meaning: "净生活支出相对收入的压力，影响公共空间的冷暖氛围。" },
  { key: "saving_strength", name: "日常余裕", meaning: "本期现金净变化相对收入的水平，影响街角绿地的花朵。它不代表账户余额。" },
];
const bandNames: Record<string, string> = { DORMANT: "安静", QUIET: "舒缓", ALIVE: "活跃", THRIVING: "热闹", LOW: "从容", NORMAL: "平稳", HIGH: "偏紧", EXTREME: "紧绷", NONE: "暂无", WEAK: "有限", MODERATE: "适中", STRONG: "充足" };

type PeriodKind = "month" | "year";

type RealData =
  | { kind: "connecting" }
  | {
      kind: "ready";
      months: string[];
      years: string[];
      periodKind: PeriodKind;
      periodKey: string;
      boardMonth: string;
      townState: TownState;
      periodPayload: TownPeriodPayload | null;
      loadingPeriod: boolean;
      periodError: string | null;
      periodLabel: string;
    }
  | { kind: "unavailable"; reason: string };

type ShowcasePage = "overview" | "board" | "review";

const monthLabel = (month: string) => `${month.replace("-", " 年 ")} 月`;
const yearLabel = (year: string) => `${year} 年`;

function periodLabel(kind: PeriodKind, key: string): string {
  return kind === "year" ? yearLabel(key) : monthLabel(key);
}

function boardMonthFor(kind: PeriodKind, key: string, months: string[]): string {
  if (kind === "month") return key;
  const inYear = months.filter((month) => month.startsWith(`${key}-`));
  return inYear[inYear.length - 1] ?? months[months.length - 1];
}

function pageFromHash(): ShowcasePage {
  const hash = window.location.hash;
  if (hash === "#review") return "review";
  if (hash === "#board" || hash === "#ledger") return "board";
  return "overview";
}

function hashFor(page: ShowcasePage): string {
  if (page === "review") return "#review";
  if (page === "board") return "#board";
  return "#overview";
}

function sourceMessage(error: unknown): string {
  return error instanceof TownStateSourceError ? error.message : String(error);
}

export default function Showcase() {
  const [real, setReal] = useState<RealData>({ kind: "connecting" });
  const [page, setPage] = useState<ShowcasePage>(pageFromHash);
  const [selected, setSelected] = useState<LifeScene | null>(null);
  const [why, setWhy] = useState<keyof TownStateMetrics | null>(null);
  const [board, setBoard] = useState<LedgerBoard | null>(null);
  const [boardLoading, setBoardLoading] = useState(false);
  const [boardError, setBoardError] = useState<string | null>(null);
  const [review, setReview] = useState<LedgerReview | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reviewType, setReviewType] = useState<ReviewType | "">("");
  const [reviewBucket, setReviewBucket] = useState<ReviewBucket | "">("");
  const [reviewQ, setReviewQ] = useState("");
  const [reviewOffset, setReviewOffset] = useState(0);
  // Data-driven replay：引擎持有 TownEvent 文档与时钟；文档按月取回。
  const replayRef = useRef<ReplayEngine | null>(null);
  const periodGenerationRef = useRef(0);
  if (!replayRef.current) replayRef.current = new ReplayEngine({ routes: new ShowcaseWalkways(), periodMontage: true });
  const [replayLoading, setReplayLoading] = useState(true);
  const [replayError, setReplayError] = useState<string | null>(null);

  useEffect(() => {
    const onHash = () => setPage(pageFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  function goTo(next: ShowcasePage) {
    setPage(next);
    window.history.replaceState(null, "", hashFor(next));
  }

  async function connect(isCancelled: () => boolean = () => false) {
    setReal({ kind: "connecting" });
    setReplayLoading(true);
    try {
      const months = await fetchAvailableMonths(ledgerTransport);
      if (months.length === 0) {
        if (!isCancelled()) setReal({ kind: "unavailable", reason: "账本中还没有任何交易月份" });
        return;
      }
      const latest = months[months.length - 1];
      const years = availableYearKeys(months);
      const { payload, document } = await fetchTownPeriod(latest, ledgerTransport);
      const townState = await fetchTownState(latest, ledgerTransport);
      if (!isCancelled()) {
        replayRef.current!.loadDocument(document);
        replayRef.current!.selectBusiestDay();
        replayRef.current!.play();
        setReplayLoading(false);
        setReal({
          kind: "ready",
          months,
          years,
          periodKind: "month",
          periodKey: latest,
          boardMonth: latest,
          townState,
          periodPayload: payload,
          loadingPeriod: false,
          periodError: null,
          periodLabel: periodLabel("month", latest),
        });
      }
    } catch (e: unknown) {
      if (!isCancelled()) {
        setReal({ kind: "unavailable", reason: e instanceof TownStateSourceError ? e.message : String(e) });
      }
    }
  }

  useEffect(() => {
    let cancelled = false;
    void connect(() => cancelled);
    return () => { cancelled = true; };
  }, []);

  async function switchPeriod(kind: PeriodKind, key: string) {
    if (real.kind !== "ready" || real.loadingPeriod) return;
    if (kind === real.periodKind && key === real.periodKey) return;
    const previous = real;
    setReal({ ...previous, loadingPeriod: true, periodError: null });
    const generation = Date.now();
    periodGenerationRef.current = generation;
    try {
      const boardMonth = boardMonthFor(kind, key, previous.months);
      const [{ payload, document }, townState] = await Promise.all([
        fetchTownPeriod(key, ledgerTransport),
        fetchTownState(boardMonth, ledgerTransport),
      ]);
      if (periodGenerationRef.current !== generation) return;
      replayRef.current!.loadDocument(document);
      replayRef.current!.selectBusiestDay();
      replayRef.current!.play();
      setReplayLoading(false);
      setReplayError(null);
      setReal({
        kind: "ready",
        months: previous.months,
        years: previous.years,
        periodKind: kind,
        periodKey: key,
        boardMonth,
        townState,
        periodPayload: payload,
        loadingPeriod: false,
        periodError: null,
        periodLabel: periodLabel(kind, key),
      });
      setSelected(null);
      setWhy(null);
      setBoard(null);
      setReview(null);
      setReviewOffset(0);
    } catch (e: unknown) {
      if (periodGenerationRef.current !== generation) return;
      const message = e instanceof TownStateSourceError ? e.message : String(e);
      setReplayError(message);
      setReplayLoading(false);
      setReal((current) => (
        current.kind === "ready"
          ? { ...current, loadingPeriod: false, periodError: message, periodLabel: periodLabel(current.periodKind, current.periodKey) }
          : current
      ));
    }
  }

  async function retryConnect() { await connect(); }

  useEffect(() => {
    if (real.kind !== "ready" || page !== "board") return;
    let cancelled = false;
    setBoardLoading(true);
    setBoardError(null);
    fetchLedgerBoard(real.boardMonth, ledgerTransport).then(
      (data) => {
        if (cancelled) return;
        setBoard(data);
        setBoardLoading(false);
      },
      (error: unknown) => {
        if (cancelled) return;
        setBoardLoading(false);
        setBoardError(sourceMessage(error));
      },
    );
    return () => { cancelled = true; };
  }, [page, real.kind, real.kind === "ready" ? real.boardMonth : ""]);

  useEffect(() => {
    if (real.kind !== "ready" || page !== "review") return;
    let cancelled = false;
    setReviewLoading(true);
    setReviewError(null);
    fetchLedgerReview({
      month: real.boardMonth,
      type: reviewType,
      bucket: reviewBucket,
      q: reviewQ,
      limit: 80,
      offset: reviewOffset,
    }, ledgerTransport).then(
      (data) => {
        if (cancelled) return;
        setReview(data);
        setReviewLoading(false);
      },
      (error: unknown) => {
        if (cancelled) return;
        setReviewLoading(false);
        setReviewError(sourceMessage(error));
      },
    );
    return () => { cancelled = true; };
  }, [page, reviewType, reviewBucket, reviewQ, reviewOffset, real.kind, real.kind === "ready" ? real.boardMonth : ""]);

  if (real.kind !== "ready") {
    return <ServicePanel status={real} onRetry={retryConnect} />;
  }

  const live = real;
  const town = live.townState;
  const f = live.periodPayload?.financial ?? town.financial;
  const visual = projectTownVisualState(town);
  const scene = selected ? town.scenes[selected] : null;
  const explanation = town.explanations.find((entry) => entry.metric === why);
  const letter = realLetter(town);

  return <div className="showcase">
    <aside className="town-sidebar">
      <a className="town-brand" href="./"><span className="brand-mark">⌂</span><span>生活小镇<small>LIVING TOWN</small></span></a>
      <div className="sidebar-caption">生活手记</div>
      <nav aria-label="页面导航">
        <a className={page === "overview" ? "nav-current" : undefined} href="#overview" onClick={(event) => { event.preventDefault(); goTo("overview"); }}><span>▦</span>小镇总览</a>
        <a className={page === "board" ? "nav-current" : undefined} href="#board" onClick={(event) => { event.preventDefault(); goTo("board"); }}><span>▤</span>月报看板</a>
        <a className={page === "review" ? "nav-current" : undefined} href="#review" onClick={(event) => { event.preventDefault(); goTo("review"); }}><span>☰</span>流水账本</a>
      </nav>
      <div className="sidebar-bottom"><span className="sprout">♧</span><p>把日子过成<br/>自己喜欢的样子。</p><small>本地优先 · 生活由你定义</small><a href="?workbench">本地工作台 ↗</a></div>
    </aside>
    <main className="showcase-main" id={page}>
      <div className="data-source-banner" role="status">{isLocalLedger ? "本机账本 · 只读展示" : "模拟数据演示 · 所有账户、商户和交易均为虚构"}</div>
      <header className="showcase-top">
        <p className="eyebrow showcase-top-eyebrow">YOUR LIFE, A LITTLE CLOSER</p>
        <div className="showcase-top-row">
          <h1>{page === "overview" ? "日常在这里，慢慢发生。" : page === "board" ? "这个月过成什么样" : "一笔一笔看清楚"}</h1>
          <div className="scenario-bar showcase-top-month" aria-label="账本周期">
            <span>{live.periodKind === "year" ? "翻阅年份" : "翻阅月份"}</span>
            <div className="period-kind-toggle" role="group" aria-label="周期类型">
              <button type="button" aria-pressed={live.periodKind === "month"} disabled={live.loadingPeriod} onClick={() => switchPeriod("month", live.periodKind === "year" ? live.boardMonth : live.periodKey)}>月度</button>
              <button type="button" aria-pressed={live.periodKind === "year"} disabled={live.loadingPeriod} onClick={() => switchPeriod("year", live.periodKey.slice(0, 4))}>年度</button>
            </div>
            <div aria-label="周期选择">
              {live.periodKind === "month" ? <>
                <button type="button" aria-label="上一月" disabled={live.loadingPeriod || live.months.indexOf(live.periodKey) <= 0} onClick={() => switchPeriod("month", live.months[live.months.indexOf(live.periodKey) - 1])}>‹</button>
                <select value={live.periodKey} disabled={live.loadingPeriod} onChange={(event) => switchPeriod("month", event.target.value)} aria-label="选择月份">
                  {live.months.map((month) => <option key={month} value={month}>{monthLabel(month)}</option>)}
                </select>
                <button type="button" aria-label="下一月" disabled={live.loadingPeriod || live.months.indexOf(live.periodKey) >= live.months.length - 1} onClick={() => switchPeriod("month", live.months[live.months.indexOf(live.periodKey) + 1])}>›</button>
              </> : <>
                <button type="button" aria-label="上一年" disabled={live.loadingPeriod || live.years.indexOf(live.periodKey) <= 0} onClick={() => switchPeriod("year", live.years[live.years.indexOf(live.periodKey) - 1])}>‹</button>
                <select value={live.periodKey} disabled={live.loadingPeriod} onChange={(event) => switchPeriod("year", event.target.value)} aria-label="选择年份">
                  {live.years.map((year) => <option key={year} value={year}>{yearLabel(year)}</option>)}
                </select>
                <button type="button" aria-label="下一年" disabled={live.loadingPeriod || live.years.indexOf(live.periodKey) >= live.years.length - 1} onClick={() => switchPeriod("year", live.years[live.years.indexOf(live.periodKey) + 1])}>›</button>
              </>}
            </div>
            {live.loadingPeriod && <small className="scenario-loading" role="status">正在取回 {live.periodLabel} …</small>}
          </div>
        </div>
      </header>
      {live.periodError && <p className="month-error" role="alert">取回 {live.periodLabel} 失败：{live.periodError}（仍显示上一期数据）</p>}
      {live.periodKind === "year" && page !== "overview" && (
        <p className="board-month-hint" role="status">年度小镇的看板与流水按月展示 · 当前月份 {monthLabel(live.boardMonth)}</p>
      )}
      {page === "overview" ? <>
      <section className="immersive-town" aria-label="生活小镇三维总览"><Suspense fallback={<div className="town-loading">正在搭建河岸街区…</div>}><Town3D visual={visual} replayEngine={replayRef.current}/></Suspense><button type="button" className="town-ledger-peek" onClick={() => goTo("board")}><span>这一页的生活支出</span><strong>{money(f.net_life_consumption_minor)}</strong><small>打开月报看板 ↗</small></button></section>
      <TownStage engine={replayRef.current} loading={replayLoading} error={replayError} periodMontage />
      <div className="overview-insights">
      <section className="money-grid" aria-label="本期生活账" aria-live="polite">
        <article><span>{live.periodKind === "year" ? "年度收入" : "本月收入"} <i>↙</i></span><strong>{money(f.external_income_minor)}</strong><small>来自生活系统外部的收入</small></article>
        <article className="spending-card"><span>净生活支出 <i>↗</i></span><strong>{money(f.net_life_consumption_minor)}</strong><small>消费 {money(f.life_consumption_minor)} · 返还 {money(f.energy_return_minor)}</small></article>
        <article><span>本期现金净变化 <i>≈</i></span><strong>{money(f.net_storage_change_minor)}</strong><small>包含投资往来后的现金增减</small></article>
        <article><span>投向未来 <i>↗</i></span><strong>{money(f.investment_export_minor)}</strong><small>长期投资转出 · 不计生活支出</small></article>
      </section>
        <aside className="town-letter"><p className="eyebrow">小镇来信 / THIS MONTH</p><h2>{letter.heading}</h2><p className="letter-text">{letter.note}</p><div className="state-readings">{metrics.map((metric) => <button key={metric.key} onClick={() => setWhy(metric.key)}><span>{metric.name}</span><strong>{bandNames[town.state[metric.key].band]}</strong><span className="reading-arrow">↗</span></button>)}</div><p className="letter-foot">小镇的热闹来自生活的发生，<br/>花得更多，不等于过得更好。</p></aside>
      </div>
      </> : page === "board" ? (
      <LedgerBoardPage
        town={town}
        board={board}
        loading={boardLoading}
        error={boardError}
        onOpenScene={setSelected}
        onOpenHealth={() => setWhy("data_health")}
        onOpenReview={() => goTo("review")}
      />
      ) : (
      <LedgerReviewPage
        town={town}
        review={review}
        loading={reviewLoading}
        error={reviewError}
        type={reviewType}
        bucket={reviewBucket}
        q={reviewQ}
        onType={(value) => { setReviewType(value); setReviewOffset(0); }}
        onBucket={(value) => { setReviewBucket(value); setReviewOffset(0); }}
        onSearch={(value) => { setReviewQ(value); setReviewOffset(0); }}
        onPage={setReviewOffset}
      />
      )}
      <section className="project-note" aria-label="项目说明">
        <div><p className="eyebrow">ABOUT THIS PROJECT</p><h2>让账本回到生活。</h2><p>生活小镇把日常现金流变成一座可以观看的微缩社区。交易触发到访、出行与配送，街区的热闹来自生活的发生。</p></div>
        <div><h3>数据有出处，表达有边界。</h3><p>Python 与 SQLite 负责整数金额、去重、分类和对账；React 与 Three.js 负责呈现。内部转账、退款与投资各有自己的语义，待核实的事项如实保留。</p><a href="https://github.com/TomNick777/living-town" target="_blank" rel="noreferrer">查看源码与设计 ↗</a></div>
      </section>
      <footer className="showcase-footer"><span>生活小镇 · 个人作品 · MIT</span><span>{isLocalLedger ? "本机账本模式" : "全合成演示 · 不连接个人账本"}</span></footer>
    </main>
    {(scene || why) && <div className="detail-backdrop" onClick={(event) => { if (event.target === event.currentTarget) { setSelected(null); setWhy(null); } }}><dialog open aria-modal="true" aria-labelledby="detail-title" ref={(node) => node?.focus()} tabIndex={-1} onKeyDown={(event) => { if (event.key === "Escape") { setSelected(null); setWhy(null); } if (event.key === "Tab") { event.preventDefault(); event.currentTarget.querySelector("button")?.focus(); } }}><button className="close-detail" aria-label="关闭详情" onClick={() => { setSelected(null); setWhy(null); }}>×</button><p className="eyebrow">生活有据可循</p><h2 id="detail-title">{scene && selected ? SCENE_NAMES[selected] : metrics.find((metric) => metric.key === why)?.name ?? "数据说明"}</h2>{scene ? <><strong className="detail-money">{money(scene.amount_minor)}</strong><p>{scene.transaction_count} 笔记录，发生在 {scene.active_days} 个活跃日。</p><p>上一期：{scene.previous_amount_minor === null ? "暂无可比数据" : money(scene.previous_amount_minor)}</p><p>口径：场景消费原额，返还在本月生活账单列。数据来自{isLocalLedger ? "本机账本" : "合成账本"}的月度投影。</p><code>scenes.{selected} · {town.period.month}</code></> : <><p>{metrics.find((metric) => metric.key === why)?.meaning ?? "状态读数由本地账本派生。未决事项保留待核实状态，不自动完成退款关联或转账配对。"}</p><p>来源月份：{town.period.month} · 生成时间：{town.generated_at}</p><div className="source-factors">{explanation?.factors.map((factor) => <p key={factor.name}><code>{factor.name}</code><span>{String(factor.value)}</span><small>{factor.detail}</small></p>)}</div><code>依据：{explanation?.rules_version ?? town.projection_version}</code></>}</dialog></div>}
  </div>;
}

function ServicePanel(props: { status: Extract<RealData, { kind: "connecting" | "unavailable" }>; onRetry: () => void }) {
  return <div className="showcase"><main className="showcase-main service-panel" role={props.status.kind === "unavailable" ? "alert" : undefined}>
    <p className="eyebrow">LIVING TOWN</p>
    {props.status.kind === "connecting" ? <>
      <h1>{isLocalLedger ? "正在连接本地账本…" : "正在打开生活小镇…"}</h1>
      <p>{isLocalLedger ? "读取生活小镇需要本地世界服务。" : "正在载入模拟生活与小镇活动。"}</p>
    </> : <>
      <h1>{isLocalLedger ? "本地账本服务不可用（SERVICE UNAVAILABLE）" : "模拟数据暂时无法加载"}</h1>
      <p>{isLocalLedger ? "无法连接本地世界服务，因此不能显示你的真实小镇。" : "请检查网络后重试。"}</p>
      <p className="service-reason">原因：{props.status.reason}</p>
      {isLocalLedger && <><p>请启动服务后重试：</p><pre>life-energy town world serve</pre></>}
    </>}
    <div className="service-actions">
      <button type="button" onClick={props.onRetry}>重试连接</button>
    </div>
  </main></div>;
}
