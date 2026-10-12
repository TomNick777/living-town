/** Static transport for Python-generated synthetic projections. No money is calculated here. */
import type { LedgerBoard } from "../town/adapter/ledgerBoard";
import type { LedgerReview } from "../town/adapter/ledgerReview";
import type { TownState } from "../town/adapter/townState";
import type { TownPeriodPayload } from "../town/world/townPeriodClient";

interface DemoBundle {
  schema_version: "portfolio-demo-v1";
  synthetic: true;
  months: Record<string, { state: TownState; period: TownPeriodPayload; board: LedgerBoard; review: LedgerReview }>;
  years: Record<string, TownPeriodPayload>;
}

function validateBundle(value: unknown): DemoBundle {
  if (!value || typeof value !== "object") throw new Error("模拟数据文件格式不正确");
  const bundle = value as DemoBundle;
  if (bundle.schema_version !== "portfolio-demo-v1" || bundle.synthetic !== true ||
      !bundle.months || !bundle.years || !Object.keys(bundle.months).length) {
    throw new Error("模拟数据版本或来源标记不正确");
  }
  return bundle;
}

export function createDemoTransport(fetchImpl: typeof fetch, base = "/"): typeof fetch {
  let pending: Promise<DemoBundle> | undefined;
  function load(): Promise<DemoBundle> {
    pending ??= fetchImpl(`${base}demo/ledger.json`).then(async response => {
      if (!response.ok) throw new Error(`模拟数据加载失败（HTTP ${response.status}）`);
      return validateBundle(await response.json());
    }).catch(error => { pending = undefined; throw error; });
    return pending;
  }
  return async input => {
    const url = new URL(input instanceof Request ? input.url : String(input), "https://demo.invalid");
    const data = await load();
    const month = url.searchParams.get("month") ?? "";
    const entry = data.months[month];
    let body: unknown;
    switch (url.pathname) {
      case "/api/months": body = { months: Object.keys(data.months).sort() }; break;
      case "/api/town-state": body = entry?.state; break;
      case "/api/town-period": {
        const period = url.searchParams.get("period") ?? "";
        body = data.months[period]?.period ?? data.years[period];
        break;
      }
      case "/api/ledger-board": body = entry?.board; break;
      case "/api/ledger-review": {
        if (!entry) break;
        const type = url.searchParams.get("type");
        const bucket = url.searchParams.get("bucket");
        const needle = (url.searchParams.get("q") ?? "").trim().toLocaleLowerCase();
        const limit = Number(url.searchParams.get("limit") ?? 80);
        const offset = Number(url.searchParams.get("offset") ?? 0);
        if (!Number.isInteger(limit) || limit < 1 || limit > 200 || !Number.isInteger(offset) || offset < 0) {
          return Response.json({ error: "Invalid pagination" }, { status: 400 });
        }
        // Only select rows. Financials and full-period type/bucket counts remain backend snapshots.
        const rows = entry.review.transactions.filter(item =>
          (!type || item.transaction_type === type) &&
          (!bucket || (bucket === "pending" ? item.flags.length > 0 : item.flags.includes(bucket))) &&
          (!needle || [item.counterparty, item.description, item.account_name, item.source]
            .filter(Boolean).join(" ").toLocaleLowerCase().includes(needle)),
        );
        body = { ...entry.review, total_count: rows.length, offset, limit, transactions: rows.slice(offset, offset + limit) };
        break;
      }
    }
    return body === undefined
      ? Response.json({ error: "Synthetic snapshot not found" }, { status: 404 })
      : Response.json(body);
  };
}

export const isLocalLedger = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("local");
export const ledgerTransport = isLocalLedger ? fetch : createDemoTransport(fetch, import.meta.env.BASE_URL);
