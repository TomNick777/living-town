import { useState } from "react";
import type { TownState } from "../town/adapter/townState";
import type { LedgerReview, LedgerReviewItem, ReviewBucket, ReviewType } from "../town/adapter/ledgerReview";
import { REVIEW_TYPES } from "../town/adapter/ledgerReview";
import { DIRECTION_NAMES, FLAG_NAMES, SCENE_NAMES, TYPE_NAMES } from "./copy";
import { hasPending, money } from "./letter";

const TYPE_FILTERS: { id: ReviewType | ""; label: string }[] = [
  { id: "", label: "全部" },
  ...REVIEW_TYPES.map((id) => ({ id, label: TYPE_NAMES[id] })),
];

const BUCKET_FILTERS: { id: ReviewBucket | ""; label: string }[] = [
  { id: "", label: "全部状态" },
  { id: "pending", label: "待核实" },
  { id: "unpaired_transfer", label: FLAG_NAMES.unpaired_transfer },
  { id: "unresolved_refund", label: FLAG_NAMES.unresolved_refund },
  { id: "unknown_type", label: FLAG_NAMES.unknown_type },
  { id: "unclassified", label: FLAG_NAMES.unclassified },
  { id: "unattributed_account", label: FLAG_NAMES.unattributed_account },
];

export function LedgerReviewPage(props: {
  town: TownState;
  review: LedgerReview | null;
  loading: boolean;
  error: string | null;
  type: ReviewType | "";
  bucket: ReviewBucket | "";
  q: string;
  onType: (value: ReviewType | "") => void;
  onBucket: (value: ReviewBucket | "") => void;
  onSearch: (value: string) => void;
  onPage: (offset: number) => void;
}) {
  const { town, review } = props;
  const pending = hasPending(town);
  const [selected, setSelected] = useState<LedgerReviewItem | null>(null);
  const [draft, setDraft] = useState(props.q);

  const total = review?.total_count ?? 0;
  const offset = review?.offset ?? 0;
  const limit = review?.limit ?? 80;
  const canPrev = offset > 0;
  const canNext = offset + limit < total;

  return (
    <section className="ledger-review" aria-label="流水账本">
      <p className="page-kicker">按类型、状态与关键词查看每笔记录。待核实事项保留原样。</p>
      {props.error && <p className="month-error" role="alert">{props.error}</p>}

      <section className={`board-pending ${pending ? "is-open" : ""}`}>
        <div>
          <strong>{pending ? "未决事项仍在" : "本期没有未决旗标"}</strong>
          <p>
            退款 {town.unresolved.refunds} · 转账 {town.unresolved.transfer_legs} · 未知 {town.unresolved.unknown_transactions} ·
            差额 {money(town.financial.unreconciled_minor)}
          </p>
        </div>
      </section>

      <div className="review-filters">
        <div className="chip-row" aria-label="类型">
          {TYPE_FILTERS.map((item) => (
            <button key={item.id || "all"} type="button" aria-pressed={props.type === item.id} onClick={() => props.onType(item.id)}>
              {item.label}
              {review && item.id !== "" ? ` ${review.type_counts[item.id]}` : ""}
            </button>
          ))}
        </div>
        <div className="chip-row" aria-label="未决分桶">
          {BUCKET_FILTERS.map((item) => (
            <button key={item.id || "all-status"} type="button" aria-pressed={props.bucket === item.id} onClick={() => props.onBucket(item.id)}>
              {item.label}
              {review && item.id !== "" ? ` ${review.bucket_counts[item.id]}` : ""}
            </button>
          ))}
        </div>
        <form
          className="review-search"
          onSubmit={(event) => {
            event.preventDefault();
            props.onSearch(draft.trim());
          }}
        >
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="对手方 / 摘要 / 账户"
            aria-label="搜索"
          />
          <button type="submit">筛选</button>
        </form>
      </div>

      <div className="review-table-wrap">
        {props.loading && <p className="scenario-loading" role="status">正在取回流水…</p>}
        <table className="review-table">
          <thead>
            <tr>
              <th>时间</th>
              <th>类型</th>
              <th>对方</th>
              <th>账户</th>
              <th>场景</th>
              <th>金额</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            {(review?.transactions ?? []).map((item) => (
              <tr
                key={item.transaction_id}
                tabIndex={0}
                aria-label={`${item.occurred_at.slice(0, 16)} ${TYPE_NAMES[item.transaction_type]} ${item.counterparty || "未填写对手方"} ${money(item.amount_minor)}`}
                onClick={() => setSelected(item)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setSelected(item);
                  }
                }}
              >
                <td>{item.occurred_at.replace("T", " ").slice(0, 16)}</td>
                <td><span className={`type-pill type-${item.transaction_type}`}>{TYPE_NAMES[item.transaction_type]}</span></td>
                <td>
                  <strong>{item.counterparty || "—"}</strong>
                  <small>{item.description || ""}</small>
                </td>
                <td>{item.account_name || "未归属"}</td>
                <td>{item.scene ? (SCENE_NAMES[item.scene as keyof typeof SCENE_NAMES] ?? item.scene) : (item.category_name || "—")}</td>
                <td className={item.direction === "INFLOW" ? "is-in" : item.direction === "OUTFLOW" ? "is-out" : ""}>
                  {item.direction === "OUTFLOW" ? "−" : item.direction === "INFLOW" ? "+" : ""}
                  {money(item.amount_minor)}
                </td>
                <td>{item.flags.length ? item.flags.map((flag) => FLAG_NAMES[flag] ?? flag).join(" · ") : "已解释"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {review && review.transactions.length === 0 && !props.loading && <p className="chart-empty">没有符合筛选的记录。</p>}
      </div>

      {review && (
        <div className="review-pager">
          <span>本页 {review.transactions.length} 笔 · 筛选后 {review.total_count} 笔</span>
          <div>
            <button type="button" disabled={!canPrev || props.loading} onClick={() => props.onPage(Math.max(0, offset - limit))}>上一页</button>
            <button type="button" disabled={!canNext || props.loading} onClick={() => props.onPage(offset + limit)}>下一页</button>
          </div>
        </div>
      )}

      {selected && (
        <div className="detail-backdrop" onClick={(event) => { if (event.target === event.currentTarget) setSelected(null); }}>
          <dialog open aria-modal="true" aria-labelledby="tx-title">
            <button className="close-detail" aria-label="关闭详情" onClick={() => setSelected(null)}>×</button>
            <p className="eyebrow">LEDGER ROW</p>
            <h2 id="tx-title">{selected.counterparty || "未填写对手方"}</h2>
            <strong className="detail-money">{money(selected.amount_minor)}</strong>
            <p>{TYPE_NAMES[selected.transaction_type]} · {DIRECTION_NAMES[selected.direction] ?? selected.direction} · {selected.occurred_at.replace("T", " ")}</p>
            <p>账户 {selected.account_name || "未归属"} · 来源 {selected.source || "—"}</p>
            <p>摘要 {selected.description || "—"}</p>
            <p>分类 {selected.category_name || selected.category_code || "未分类"}{selected.manual_override ? " · 人工覆盖" : ""}</p>
            <p>场景 {selected.scene ? (SCENE_NAMES[selected.scene as keyof typeof SCENE_NAMES] ?? selected.scene) : "（非生活场景）"}</p>
            <p>状态 {selected.flags.length ? selected.flags.map((flag) => FLAG_NAMES[flag] ?? flag).join(" · ") : "已解释"}</p>
            <code>transaction_id {selected.transaction_id}</code>
          </dialog>
        </div>
      )}
    </section>
  );
}
