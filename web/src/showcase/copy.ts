import type { LifeScene, TownFinancial } from "../town/adapter/townState";

export const SCENE_NAMES: Record<LifeScene, string> = {
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

export const TYPE_NAMES: Record<string, string> = {
  INCOME: "外部收入",
  EXPENSE: "生活支出",
  TRANSFER: "账户流动",
  REFUND: "返还",
  INVESTMENT: "投资往来",
  UNKNOWN: "未知",
};

export const FLAG_NAMES: Record<string, string> = {
  unpaired_transfer: "待配对转账",
  unresolved_refund: "待关联退款",
  unknown_type: "未知类型",
  unattributed_account: "未归属账户",
  unclassified: "未分类",
};

export const TREND_NAMES: Record<string, string> = {
  UP: "较上月升",
  DOWN: "较上月降",
  FLAT: "与上月持平",
  UNKNOWN: "暂无环比",
};

export function trendLabel(trend: string): string {
  return TREND_NAMES[trend] ?? "暂无环比";
}

export const DIRECTION_NAMES: Record<string, string> = {
  INFLOW: "流入",
  OUTFLOW: "流出",
  NEUTRAL: "中性",
};

type AmountKey = Exclude<keyof TownFinancial, "balanced">;

export const FLOW_BUCKETS: { key: AmountKey; name: string; lane: string }[] = [
  { key: "external_income_minor", name: "外部收入", lane: "income" },
  { key: "life_consumption_minor", name: "生活支出（毛）", lane: "life" },
  { key: "energy_return_minor", name: "返还", lane: "life" },
  { key: "net_life_consumption_minor", name: "净生活支出", lane: "life" },
  { key: "investment_export_minor", name: "投向未来", lane: "capital" },
  { key: "investment_import_minor", name: "投资赎回", lane: "capital" },
  { key: "net_storage_change_minor", name: "现金净变化", lane: "result" },
  { key: "internal_transfer_minor", name: "账户间流动", lane: "transfer" },
  { key: "unreconciled_minor", name: "对账差额", lane: "warning" },
];
