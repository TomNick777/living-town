/**
 * MonthlyReport —— 「青川町月刊 · 镇务账页」 presentation 层。
 *
 * 只读呈现：数字全部来自传入的 TownState / ledger-board 投影结果；
 * 这里只做选择、排序与画图，绝不求和/重算任何财务值。
 * 三层阅读顺序：本月摘要 → 钱怎么过日子 → 生活细节（drill-down）。
 *
 * 本文件刻意只 import 已提交的 townState 适配器与 letter 工具，
 * 自带展示用类型（结构上兼容 ledger-board JSON），避免与进行中的
 * ledger WIP 文件耦合。
 */
import { useState, type CSSProperties } from "react";
import type { LifeScene, TownSceneActivity, TownState } from "../town/adapter/townState";
import { hasPending, money } from "./letter";
import "./monthlyReport.css";

// ---- 展示用数据形状（ledger-board 投影的结构化子集） ----

export interface ReportSeriesPoint {
  month: string;
  external_income_minor: number;
  net_life_consumption_minor: number;
  investment_export_minor: number;
  net_storage_change_minor: number;
}

export interface ReportDay {
  date: string;
  life_event_count: number;
  consumption_minor: number;
  income_minor: number;
}

export interface ReportMerchant {
  counterparty: string;
  scene: string;
  amount_minor: number;
  transaction_count: number;
  return_minor: number;
}

export interface ReportAccountFlow {
  account_id: number | string | null;
  account_name: string;
  net_minor: number;
}

export interface ReportData {
  series: ReportSeriesPoint[];
  days: ReportDay[];
  merchants: { top: ReportMerchant[]; others: { merchant_count: number; amount_minor: number } };
  accounts: ReportAccountFlow[];
}

const SCENE_NAMES: Record<LifeScene, string> = {
  HOME: "家的日常",
  COMMUTE: "出门与通勤",
  DINING_SOCIAL: "餐桌与相聚",
  FAMILY: "家人与陪伴",
  DAILY_CONVENIENCE: "日常采买",
  LEARNING: "学习与成长",
  HEALTH: "健康照顾",
  LEISURE: "休闲时光",
  CONSTRUCTION_PROJECT: "阶段计划",
  INVESTMENT: "长期投资",
  OTHER: "其他生活支出",
};

/** 纯展示排序：并列时按场景名，保证确定性。不改动任何金额。 */
export function topScenes(town: TownState, limit: number): [LifeScene, TownSceneActivity][] {
  return (Object.entries(town.scenes) as [LifeScene, TownSceneActivity][])
    .filter(([key, item]) => key !== "INVESTMENT" && key !== "OTHER" && (item.share_of_consumption ?? 0) > 0)
    .sort((a, b) => b[1].amount_minor - a[1].amount_minor || a[0].localeCompare(b[0]))
    .slice(0, limit);
}

function maxAbs(values: readonly number[]): number {
  let peak = 0;
  for (const value of values) {
    const abs = value < 0 ? -value : value;
    if (abs > peak) peak = abs;
  }
  return peak;
}

function barShare(amount: number, peak: number): number {
  if (peak <= 0) return 0;
  return Math.min(1, amount < 0 ? -amount / peak : amount / peak);
}

export interface ReportProps {
  town: TownState;
  board: ReportData | null;
  loading: boolean;
  error: string | null;
  onOpenScene: (scene: LifeScene) => void;
  onOpenHealth: () => void;
  onOpenReview: () => void;
}

export default function MonthlyReport(props: ReportProps) {
  const { town, board } = props;
  const f = town.financial;
  const pending = hasPending(town);
  const [selectedDay, setSelectedDay] = useState<ReportDay | null>(null);
  const highlights = topScenes(town, 3);
  const series = board?.series ?? [];
  const currentIndex = series.findIndex((point) => point.month === town.period.month);
  const current = currentIndex >= 0 ? series[currentIndex] : series[series.length - 1];
  const previous = currentIndex > 0 ? series[currentIndex - 1] : null;

  return <section className="monthly-report" aria-label="生活月报">
    <header className="report-head">
      <p className="eyebrow">青川町月刊 · 镇务账页 / {town.period.month}</p>
      <span className="report-head-note">与小镇总览使用同一期记录，退款与转账分别呈现</span>
    </header>
    {props.error && <p className="month-error" role="alert">{props.error}</p>}
    {props.loading && <p className="report-loading" role="status">正在取回本月账页…</p>}

    {/* 第一层：本月摘要——一屏内先回答四个问题 */}
    <section className="report-summary" aria-label="本月摘要" aria-live="polite">
      <div className="report-figures">
        <span className="report-figure">
          <small>外部收入</small>
          <strong>{money(f.external_income_minor)}</strong>
          {previous && <em>上月 {money(previous.external_income_minor)}</em>}
        </span>
        <span className="report-figure is-spending">
          <small>净生活支出</small>
          <strong>{money(f.net_life_consumption_minor)}</strong>
          <em>消费 {money(f.life_consumption_minor)} · 返还 {money(f.energy_return_minor)}</em>
        </span>
        <span className="report-figure">
          <small>现金净变化</small>
          <strong>{money(f.net_storage_change_minor)}</strong>
          <em>含投资往来 · 不是账户余额</em>
        </span>
        <span className="report-figure">
          <small>投向未来</small>
          <strong>{money(f.investment_export_minor)}</strong>
          <em>长期投资转出 · 不计生活支出</em>
        </span>
      </div>
      <div className="report-highlights" aria-label="钱主要花在哪里">
        <small>钱主要花在哪里</small>
        {highlights.length === 0 ? <p className="report-empty">这个月还没有可分摊的生活支出。</p> : (
          <ol>
            {highlights.map(([key, item]) => (
              <li key={key}>
                <button type="button" onClick={() => props.onOpenScene(key)}>
                  <span>{SCENE_NAMES[key]}</span>
                  <strong>{money(item.amount_minor)}</strong>
                  <em>{((item.share_of_consumption ?? 0) * 100).toFixed(0)}%</em>
                </button>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>

    {/* 对账诚实性：一行状态，不占整块版面 */}
    <div className={`report-status ${pending ? "is-open" : ""}`}>
      <span className="report-status-dot" aria-hidden="true" />
      <p>
        {pending
          ? <>有记录还说不清：待关联退款 {town.unresolved.refunds} · 待配对转账 {town.unresolved.transfer_legs} · 未知 {town.unresolved.unknown_transactions} · 差额 <strong>{money(f.unreconciled_minor)}</strong></>
          : <>对账闭合 · 来源月份 {town.period.month} · 投影 {town.projection_version}</>}
      </p>
      <button type="button" onClick={props.onOpenHealth}>口径说明</button>
      <button type="button" onClick={props.onOpenReview}>去流水核对</button>
    </div>

    {/* 第二层：钱怎么过日子 */}
    <h2 className="report-tier">钱怎么过日子</h2>
    <div className="report-grid">
      <article className="report-card report-trend">
        <div className="report-card-head">
          <p className="eyebrow">MONTHS / 近月节奏</p>
          <ul className="report-legend">
            {current && <li><i className="dot series-income" />外部收入 <strong>{money(current.external_income_minor)}</strong></li>}
            {current && <li><i className="dot series-life" />净生活支出 <strong>{money(current.net_life_consumption_minor)}</strong></li>}
            {current && <li><i className="dot series-capital" />投向未来 <strong>{money(current.investment_export_minor)}</strong></li>}
            {current && <li><i className="dot series-result" />现金净变化 <strong>{money(current.net_storage_change_minor)}</strong></li>}
          </ul>
        </div>
        {board ? <TrendChart series={board.series} currentMonth={town.period.month} /> : <p className="report-empty">正在等待账页数据…</p>}
      </article>

      <article className="report-card report-lanes">
        <div className="report-card-head">
          <p className="eyebrow">CASH LANES / 钱怎么分开走</p>
          <span>转账与投资单列，不混入收支</span>
        </div>
        <Lanes financial={f} />
      </article>

      <article className="report-card report-mix">
        <div className="report-card-head">
          <p className="eyebrow">LIFE MIX / 花在哪些日常里</p>
          <span>生活场景 · 不是会计科目</span>
        </div>
        <Mix scenes={town.scenes} onOpenScene={props.onOpenScene} />
      </article>
    </div>

    {/* 第三层：生活细节（drill-down） */}
    <h2 className="report-tier">生活细节</h2>
    <div className="report-grid report-grid-details">
      <article className="report-card report-calendar">
        <div className="report-card-head">
          <p className="eyebrow">DAYS / 哪天在过生活</p>
          <span>点 = 有生活记录 · 底色 = 当天支出</span>
        </div>
        {board && <Calendar days={board.days} selected={selectedDay?.date ?? null} onSelect={setSelectedDay} />}
        {selectedDay && (
          <p className="report-day-caption">
            {selectedDay.date}：生活 {selectedDay.life_event_count} 笔 · 支出 {money(selectedDay.consumption_minor)} · 收入 {money(selectedDay.income_minor)}
          </p>
        )}
      </article>
      <article className="report-card report-merchants">
        <div className="report-card-head">
          <p className="eyebrow">WHERE / 钱去了哪些地方</p>
          <span>只计生活消费，返还已冲减</span>
        </div>
        {board && <Merchants merchants={board.merchants.top} othersAmount={board.merchants.others.amount_minor} othersCount={board.merchants.others.merchant_count} />}
      </article>
      <article className="report-card report-accounts">
        <div className="report-card-head">
          <p className="eyebrow">ACCOUNTS / 各账户本月净流动</p>
          <span>不是余额，只是本期进出</span>
        </div>
        {board && <Accounts accounts={board.accounts} />}
      </article>
    </div>
  </section>;
}

// ---- 内部图表组件：纯展示，输入均为投影好的整数 ----

const SERIES_LINES: { key: keyof ReportSeriesPoint; name: string; className: string }[] = [
  { key: "external_income_minor", name: "外部收入", className: "series-income" },
  { key: "net_life_consumption_minor", name: "净生活支出", className: "series-life" },
  { key: "investment_export_minor", name: "投向未来", className: "series-capital" },
  { key: "net_storage_change_minor", name: "现金净变化", className: "series-result" },
];

/** 图表高度跟随内容：viewBox 宽度按月数扩展，避免宽屏下大面积空白。 */
export function trendGeometry(count: number): { width: number; height: number } {
  return { width: Math.max(560, count * 84), height: 208 };
}

function TrendChart(props: { series: ReportSeriesPoint[]; currentMonth: string }) {
  if (props.series.length === 0) return <p className="report-empty">还没有可对比的月份。</p>;
  const { width, height } = trendGeometry(props.series.length);
  const pad = { left: 44, right: 14, top: 14, bottom: 24 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const values = props.series.flatMap((point) => SERIES_LINES.map((line) => point[line.key] as number));
  const peak = maxAbs(values);
  const count = props.series.length;
  const xAt = (index: number) => pad.left + (count === 1 ? innerW / 2 : (index / (count - 1)) * innerW);
  const yAt = (amount: number) => (peak === 0 ? pad.top + innerH / 2 : pad.top + innerH / 2 - (amount / peak) * (innerH / 2));
  return (
    <div className="report-trend-plot">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`近 ${count} 个月现金流趋势，单位元`}>
        {[peak, peak / 2, 0, -peak / 2, -peak].map((value, index) => (
          <g key={index}>
            <line x1={pad.left} y1={yAt(value)} x2={width - pad.right} y2={yAt(value)} className={value === 0 ? "rt-axis" : "rt-grid"} />
            {peak > 0 && index % 2 === 0 && (
              <text x={pad.left - 6} y={yAt(value) + 3} className="rt-tick">{Math.round(value / 100 / 1000)}k</text>
            )}
          </g>
        ))}
        {props.series.map((point, index) => (
          <text key={point.month} x={xAt(index)} y={height - 6} className={point.month === props.currentMonth ? "rt-label is-current" : "rt-label"}>
            {point.month.slice(5)}月
          </text>
        ))}
        {SERIES_LINES.map((line) => {
          const d = props.series.map((point, index) => `${index === 0 ? "M" : "L"}${xAt(index).toFixed(1)} ${yAt(point[line.key] as number).toFixed(1)}`).join(" ");
          return <path key={line.key} d={d} className={`rt-line ${line.className}`} fill="none" />;
        })}
        {props.series.map((point, index) =>
          point.month === props.currentMonth
            ? SERIES_LINES.map((line) => (
              <circle key={line.key} cx={xAt(index)} cy={yAt(point[line.key] as number)} r="3.4" className={`rt-dot ${line.className}`} />
            ))
            : null,
        )}
      </svg>
    </div>
  );
}

const LANE_ROWS: { key: keyof TownState["financial"]; name: string; lane: string }[] = [
  { key: "external_income_minor", name: "外部收入", lane: "income" },
  { key: "net_life_consumption_minor", name: "净生活支出", lane: "life" },
  { key: "investment_export_minor", name: "投向未来", lane: "capital" },
  { key: "investment_import_minor", name: "投资赎回", lane: "capital" },
  { key: "net_storage_change_minor", name: "现金净变化", lane: "result" },
  { key: "internal_transfer_minor", name: "账户间流动", lane: "transfer" },
  { key: "unreconciled_minor", name: "对账差额", lane: "warning" },
];

function Lanes(props: { financial: TownState["financial"] }) {
  const items = LANE_ROWS.map((row) => ({ ...row, amount: props.financial[row.key] as number }));
  const peak = maxAbs(items.map((item) => item.amount));
  return (
    <ul className="report-lanes-list">
      {items.map((item) => (
        <li key={item.key} className={`lane-${item.lane}`}>
          <span>{item.name}</span>
          <i style={{ width: `${barShare(item.amount, peak) * 100}%` }} />
          <strong>{money(item.amount)}</strong>
        </li>
      ))}
    </ul>
  );
}

function Mix(props: { scenes: Partial<Record<LifeScene, TownSceneActivity>>; onOpenScene: (scene: LifeScene) => void }) {
  const items = (Object.entries(props.scenes) as [LifeScene, TownSceneActivity][])
    .filter(([key, item]) => key !== "INVESTMENT" && item && (item.share_of_consumption ?? 0) > 0)
    .sort((a, b) => b[1].amount_minor - a[1].amount_minor || a[0].localeCompare(b[0]));
  if (items.length === 0) return <p className="report-empty">这个月没有可分摊的生活支出。</p>;
  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  return (
    <div className="report-mix-body">
      <svg viewBox="0 0 120 120" className="report-mix-donut" aria-hidden="true">
        <circle cx="60" cy="60" r={radius} fill="none" stroke="#edf0e6" strokeWidth="15" />
        {items.map(([key, item], index) => {
          const length = (item.share_of_consumption ?? 0) * circumference;
          const dash = <circle key={key} cx="60" cy="60" r={radius} fill="none" strokeWidth="15"
            stroke={`var(--slice-${index % 6})`} strokeDasharray={`${length} ${circumference - length}`} strokeDashoffset={-offset} transform="rotate(-90 60 60)" />;
          offset += length;
          return dash;
        })}
      </svg>
      <ul className="report-mix-rows">
        {items.map(([key, item], index) => (
          <li key={key}>
            <button type="button" onClick={() => props.onOpenScene(key)}>
              <i className={`slice-${index % 6}`} />
              <span>{SCENE_NAMES[key]}</span>
              <b>{((item.share_of_consumption ?? 0) * 100).toFixed(0)}%</b>
              <strong>{money(item.amount_minor)}</strong>
              <small>{item.transaction_count} 笔 · {item.active_days} 天</small>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];

function Calendar(props: { days: ReportDay[]; selected: string | null; onSelect: (day: ReportDay | null) => void }) {
  if (props.days.length === 0) return <p className="report-empty">这个月没有日历数据。</p>;
  const peak = maxAbs(props.days.map((day) => day.consumption_minor));
  const first = props.days[0].date.split("-").map(Number);
  const weekday = new Date(first[0], first[1] - 1, first[2]).getDay();
  const mondayFirst = weekday === 0 ? 6 : weekday - 1;
  return (
    <div className="report-calendar">
      <div className="rc-weekdays">{WEEKDAYS.map((label) => <span key={label}>{label}</span>)}</div>
      <div className="rc-grid">
        {Array.from({ length: mondayFirst }, (_, index) => <span key={`pad-${index}`} className="rc-pad" />)}
        {props.days.map((entry) => (
          <button
            type="button"
            key={entry.date}
            className={props.selected === entry.date ? "rc-day is-selected" : "rc-day"}
            style={{ "--heat": barShare(entry.consumption_minor, peak).toFixed(3) } as CSSProperties}
            onClick={() => props.onSelect(props.selected === entry.date ? null : entry)}
            aria-label={`${entry.date}，生活记录 ${entry.life_event_count} 笔`}
          >
            <strong>{Number(entry.date.slice(8))}</strong>
            {entry.life_event_count > 0 && <i className="rc-dot" />}
          </button>
        ))}
      </div>
    </div>
  );
}

function Merchants(props: { merchants: ReportMerchant[]; othersAmount: number; othersCount: number }) {
  if (props.merchants.length === 0) return <p className="report-empty">这个月没有可排名的生活消费商户。</p>;
  const peak = maxAbs([...props.merchants.map((item) => item.amount_minor), props.othersAmount]);
  return (
    <ol className="report-merchant-list">
      {props.merchants.map((item, index) => (
        <li key={item.counterparty}>
          <span className="merchant-rank">{index + 1}</span>
          <span className="merchant-name">
            <strong>{item.counterparty}</strong>
            <small>{SCENE_NAMES[item.scene as LifeScene] ?? item.scene} · {item.transaction_count} 笔{item.return_minor > 0 ? ` · 已冲减返还 ${money(item.return_minor)}` : ""}</small>
          </span>
          <i style={{ width: `${barShare(item.amount_minor, peak) * 100}%` }} />
          <em>{money(item.amount_minor)}</em>
        </li>
      ))}
      {props.othersCount > 0 && (
        <li className="merchant-others">
          <span className="merchant-rank">·</span>
          <span className="merchant-name"><strong>其余商户</strong><small>{props.othersCount} 家</small></span>
          <i style={{ width: `${barShare(props.othersAmount, peak) * 100}%` }} />
          <em>{money(props.othersAmount)}</em>
        </li>
      )}
    </ol>
  );
}

function Accounts(props: { accounts: ReportAccountFlow[] }) {
  if (props.accounts.length === 0) return <p className="report-empty">这个月没有账户流动。</p>;
  const peak = maxAbs(props.accounts.map((item) => item.net_minor));
  return (
    <ul className="report-account-list">
      {props.accounts.map((item) => (
        <li key={String(item.account_id)} className={item.net_minor < 0 ? "is-out" : "is-in"}>
          <span>{item.account_name}</span>
          <i style={{ width: `${barShare(item.net_minor, peak) * 100}%` }} />
          <strong>{money(item.net_minor)}</strong>
        </li>
      ))}
    </ul>
  );
}
