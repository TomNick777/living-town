import type { CSSProperties } from "react";
import type { LifeScene, TownFinancial, TownSceneActivity } from "../town/adapter/townState";
import type { LedgerAccountFlow, LedgerDay, LedgerMerchant, LedgerSeriesPoint } from "../town/adapter/ledgerBoard";
import { FLOW_BUCKETS, SCENE_NAMES } from "./copy";
import { money } from "./letter";
import { barShare, maxAbs } from "./scale";

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];

export function FlowBuckets(props: { financial: TownFinancial }) {
  const items = FLOW_BUCKETS.map((bucket) => ({ ...bucket, amount: props.financial[bucket.key] }));
  const peak = maxAbs(items.map((item) => item.amount));
  return (
    <ul className="flow-buckets">
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

export function SceneMix(props: { scenes: Partial<Record<LifeScene, TownSceneActivity>> }) {
  const items = Object.entries(props.scenes)
    .filter(([key, item]) => key !== "INVESTMENT" && item && item.share_of_consumption !== null)
    .map(([key, item]) => ({ key: key as LifeScene, item: item as TownSceneActivity }));
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  const slices = items.map((entry, index) => {
    const share = entry.item.share_of_consumption ?? 0;
    const length = share * circumference;
    const slice = { ...entry, index, dash: length, offset };
    offset += length;
    return slice;
  });
  if (items.length === 0) {
    return <p className="chart-empty">这个月没有可分摊的生活支出。</p>;
  }
  return (
    <div className="scene-mix">
      <svg viewBox="0 0 120 120" className="scene-donut" aria-hidden="true">
        <circle cx="60" cy="60" r={radius} fill="none" stroke="#edf0e6" strokeWidth="16" />
        {slices.map((slice) => (
          <circle
            key={slice.key}
            cx="60"
            cy="60"
            r={radius}
            fill="none"
            strokeWidth="16"
            stroke={`var(--slice-${slice.index % 6})`}
            strokeDasharray={`${slice.dash} ${circumference - slice.dash}`}
            strokeDashoffset={-slice.offset}
            transform="rotate(-90 60 60)"
          />
        ))}
      </svg>
      <ul>
        {items.map((entry, index) => (
          <li key={entry.key}>
            <i className={`slice-${index % 6}`} />
            <span>{SCENE_NAMES[entry.key]}</span>
            <strong>{entry.item.share_of_consumption === null ? "—" : `${(entry.item.share_of_consumption * 100).toFixed(1)}%`}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}

const SERIES_LINES: { key: keyof LedgerSeriesPoint; name: string; className: string }[] = [
  { key: "external_income_minor", name: "外部收入", className: "series-income" },
  { key: "net_life_consumption_minor", name: "净生活支出", className: "series-life" },
  { key: "investment_export_minor", name: "投向未来", className: "series-capital" },
  { key: "net_storage_change_minor", name: "现金净变化", className: "series-result" },
];

export function TrendChart(props: { series: LedgerSeriesPoint[] }) {
  if (props.series.length === 0) {
    return <p className="chart-empty">还没有可对比的月份。</p>;
  }
  const values = props.series.flatMap((point) => SERIES_LINES.map((line) => point[line.key] as number));
  const peak = maxAbs(values);
  const width = 640;
  const height = 180;
  const pad = 16;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  const count = props.series.length;
  const xAt = (index: number) => pad + (count === 1 ? innerW / 2 : (index / (count - 1)) * innerW);
  const yAt = (amount: number) => {
    if (peak === 0) return pad + innerH / 2;
    return pad + innerH / 2 - (amount / peak) * (innerH / 2);
  };
  return (
    <div className="trend-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="近月现金流趋势">
        <line x1={pad} y1={pad + innerH / 2} x2={width - pad} y2={pad + innerH / 2} className="trend-axis" />
        {SERIES_LINES.map((line) => {
          const d = props.series.map((point, index) => `${index === 0 ? "M" : "L"}${xAt(index)} ${yAt(point[line.key] as number)}`).join(" ");
          return <path key={line.key} d={d} className={line.className} fill="none" />;
        })}
        {props.series.map((point, index) => (
          <text key={point.month} x={xAt(index)} y={height - 2} className="trend-label">{point.month.slice(5)}</text>
        ))}
      </svg>
      <ul className="trend-legend">
        {SERIES_LINES.map((line) => <li key={line.key} className={line.className}>{line.name}</li>)}
      </ul>
    </div>
  );
}

export function LifeCalendar(props: { days: LedgerDay[]; onSelect?: (day: LedgerDay) => void; selected?: string | null }) {
  if (props.days.length === 0) return <p className="chart-empty">这个月没有日历数据。</p>;
  const peak = maxAbs(props.days.map((day) => day.consumption_minor));
  const first = props.days[0].date;
  const [year, month, day] = first.split("-").map(Number);
  const weekday = new Date(year, month - 1, day).getDay();
  const mondayFirst = weekday === 0 ? 6 : weekday - 1;
  return (
    <div className="life-calendar">
      <div className="calendar-weekdays">{WEEKDAYS.map((label) => <span key={label}>{label}</span>)}</div>
      <div className="calendar-grid">
        {Array.from({ length: mondayFirst }, (_, index) => <span key={`pad-${index}`} className="calendar-pad" />)}
        {props.days.map((entry) => {
          const intensity = barShare(entry.consumption_minor, peak);
          return (
            <button
              type="button"
              key={entry.date}
              className={props.selected === entry.date ? "calendar-day is-selected" : "calendar-day"}
              style={{ "--heat": intensity.toFixed(3) } as CSSProperties}
              onClick={() => props.onSelect?.(entry)}
              aria-label={`${entry.date}，生活记录 ${entry.life_event_count} 笔`}
            >
              <strong>{Number(entry.date.slice(8))}</strong>
              {entry.life_event_count > 0 && <i className="life-dot" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function MerchantBars(props: { merchants: LedgerMerchant[]; othersAmount: number; othersCount: number }) {
  const peak = maxAbs([...props.merchants.map((item) => item.amount_minor), props.othersAmount]);
  if (props.merchants.length === 0) return <p className="chart-empty">这个月没有可排名的生活消费商户。</p>;
  return (
    <ul className="merchant-bars">
      {props.merchants.map((item) => (
        <li key={item.counterparty}>
          <span>
            <strong>{item.counterparty}</strong>
            <small>{SCENE_NAMES[item.scene as LifeScene] ?? item.scene} · {item.transaction_count} 笔{item.return_minor > 0 ? ` · 已冲减返还 ${money(item.return_minor)}` : ""}</small>
          </span>
          <i style={{ width: `${barShare(item.amount_minor, peak) * 100}%` }} />
          <em>{money(item.amount_minor)}</em>
        </li>
      ))}
      {props.othersCount > 0 && (
        <li className="merchant-others">
          <span><strong>其余商户</strong><small>{props.othersCount} 家</small></span>
          <i style={{ width: `${barShare(props.othersAmount, peak) * 100}%` }} />
          <em>{money(props.othersAmount)}</em>
        </li>
      )}
    </ul>
  );
}

export function AccountFlows(props: { accounts: LedgerAccountFlow[] }) {
  if (props.accounts.length === 0) return <p className="chart-empty">这个月没有账户流动。</p>;
  const peak = maxAbs(props.accounts.map((item) => item.net_minor));
  return (
    <ul className="account-flows">
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
