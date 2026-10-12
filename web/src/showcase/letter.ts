/**
 * Real-data letter copy — presentation only, grounded in the projection.
 *
 * Every sentence here restates a fact the core already computed: amounts are
 * displayed as-is (money formats integer minors, never arithmetic), and every
 * qualitative claim mirrors the documented band semantics of the projection
 * (scoring.py): consumption_pressure EXTREME ⇔ net consumption ≥ income
 * (or consumption with no external income), saving_strength NONE ⇔
 * net storage ≤ 0, and so on. Nothing is invented, nothing recomputed.
 */

import type { PressureBand, StrengthBand, TownState } from "../town/adapter/townState";

// Format integer minor units as text; no floating-point money arithmetic.
export function money(minor: number): string {
  const digits = String(Math.abs(minor)).padStart(3, "0");
  return `${minor < 0 ? "−" : ""}¥${digits.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${digits.slice(-2)}`;
}

export interface Letter {
  heading: string;
  note: string;
}

const PRESSURE_HEADINGS: Record<PressureBand, string> = {
  LOW: "日子过得从容。",
  NORMAL: "收支保持着节奏。",
  HIGH: "生活热闹，开支也在提速。",
  EXTREME: "这一页，开支绷得比较紧。",
};

const SAVING_NAMES: Record<StrengthBand, string> = {
  NONE: "暂无",
  WEAK: "有限",
  MODERATE: "适中",
  STRONG: "充足",
};

/** The same pending predicate the source strip uses — one honest notion. */
export function hasPending(town: TownState): boolean {
  return (
    town.unresolved.refunds > 0 ||
    town.unresolved.transfer_legs > 0 ||
    town.unresolved.unknown_transactions > 0 ||
    !town.financial.balanced
  );
}

function pressureSentence(town: TownState): string {
  const f = town.financial;
  const net = money(f.net_life_consumption_minor);
  if (f.external_income_minor === 0) {
    // scoring: income=0 → either no consumption (LOW) or EXTREME pressure
    return f.net_life_consumption_minor === 0
      ? "本月没有外部收入记录，也没有生活支出。"
      : `本月没有外部收入记录，仍有生活支出 ${net}，压力读数因此到达「紧绷」。`;
  }
  switch (town.state.consumption_pressure.band) {
    case "LOW":
      return `本月外部收入 ${money(f.external_income_minor)}，净生活支出 ${net}，远在收入之内。`;
    case "NORMAL":
      return `本月外部收入 ${money(f.external_income_minor)}，净生活支出 ${net}，保持在收入的适中区间。`;
    case "HIGH":
      return `本月外部收入 ${money(f.external_income_minor)}，净生活支出 ${net}，已接近收入的全部。`;
    case "EXTREME":
      return `本月外部收入 ${money(f.external_income_minor)}，净生活支出 ${net}，达到或超过了收入。`;
  }
}

function savingSentence(town: TownState): string {
  const band = town.state.saving_strength.band;
  const change = money(town.financial.net_storage_change_minor);
  if (band === "NONE") {
    return `本期现金净变化为 ${change}，余裕暂无积累。`;
  }
  return `本期现金净变化 ${change}，余裕读数「${SAVING_NAMES[band]}」。`;
}

function pendingSentence(town: TownState): string {
  const u = town.unresolved;
  if (!hasPending(town)) {
    return `对账无待办事项，无需人工核实。`;
  }
  const parts: string[] = [];
  if (u.refunds > 0) parts.push(`退款 ${u.refunds} 笔`);
  if (u.transfer_legs > 0) parts.push(`转账 ${u.transfer_legs} 笔`);
  if (u.unknown_transactions > 0) parts.push(`未知交易 ${u.unknown_transactions} 笔`);
  const tail = parts.length > 0 ? `（${parts.join(" · ")}）` : "";
  return `账上还有等待核实的记录${tail}，差额 ${money(town.financial.unreconciled_minor)} 如实保留，不做自动修正。`;
}

/** The「小镇来信」for a real month: derived from bands, displays real figures. */
export function realLetter(town: TownState): Letter {
  const heading = PRESSURE_HEADINGS[town.state.consumption_pressure.band];
  const note = [
    pressureSentence(town),
    savingSentence(town),
    pendingSentence(town),
  ].join("");
  return { heading, note };
}
