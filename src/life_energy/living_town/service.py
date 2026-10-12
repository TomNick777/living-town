"""Human-facing formatting for Town State (CLI is the only interface).

Only formatting lives here: no queries, no scoring, no writes. The JSON
shape (TownState.to_dict) is the contract; this module is a courtesy view
for the terminal.
"""

from __future__ import annotations

from .models import TownState
from .rules import RULES_VERSION

BAND_LABELS = {
    # vitality
    "DORMANT": "沉睡",
    "QUIET": "安静",
    "ALIVE": "有生活气息",
    "THRIVING": "生机勃勃",
    # stability
    "FRAGILE": "脆弱",
    "MODERATE": "尚稳",
    "SOLID": "稳健",
    # generic
    "NONE": "无",
    "WEAK": "偏弱",
    "STRONG": "强劲",
    # pressure
    "LOW": "低",
    "NORMAL": "正常",
    "HIGH": "偏高",
    "EXTREME": "穿底",
    # data health
    "NEEDS_WORK": "需要整理",
    "REVIEW": "有待复核",
    "HEALTHY": "健康",
}

SCENE_LABELS = {
    "HOME": "家",
    "COMMUTE": "通勤",
    "DINING_SOCIAL": "餐饮社交",
    "FAMILY": "家庭",
    "DAILY_CONVENIENCE": "日常便利",
    "LEARNING": "学习",
    "HEALTH": "健康",
    "LEISURE": "休闲",
    "CONSTRUCTION_PROJECT": "阶段建设",
    "INVESTMENT": "投资外输",
    "OTHER": "其他",
}

TREND_LABELS = {"UP": "↑", "DOWN": "↓", "FLAT": "→", "UNKNOWN": "?"}

METRIC_LABELS = {
    "vitality": "生活活力",
    "stability": "系统稳定",
    "consumption_pressure": "消费压力",
    "saving_strength": "结余储能",
    "investment_outflow": "投资外输",
    "data_health": "数据健康",
}


def fmt_minor(amount_minor: int) -> str:
    sign = "-" if amount_minor < 0 else ""
    return f"{sign}¥{abs(amount_minor) // 100}.{abs(amount_minor) % 100:02d}"


def _band_label(band: str) -> str:
    label = BAND_LABELS.get(band, band)
    return f"{band}({label})" if label != band else band


def format_town_state(state: TownState) -> str:
    lines = [
        f"生活小镇 Town State — {state.period.month}"
        f"（{state.period.start} .. {state.period.end}, projection {state.projection_version}）",
        "",
        "== 财务事实（复用 energy 口径，整数分）",
        f"  外部收入:            {fmt_minor(state.financial.external_income_minor):>12}",
        f"  生活消耗(毛):        {fmt_minor(state.financial.life_consumption_minor):>12}"
        f"   退款返还: {fmt_minor(state.financial.energy_return_minor)}",
        f"  生活消耗(净):        {fmt_minor(state.financial.net_life_consumption_minor):>12}",
        f"  投资外输:            {fmt_minor(state.financial.investment_export_minor):>12}"
        f"   ({state.financial.investment_export_count} 笔, → 海獭控股)",
        f"  投资回流:            {fmt_minor(state.financial.investment_import_minor):>12}",
        f"  净结余:              {fmt_minor(state.financial.net_storage_change_minor):>12}",
        f"  内部流动(出腿):      {fmt_minor(state.financial.internal_transfer_minor):>12}",
        f"  未决差额:            {fmt_minor(state.financial.unreconciled_minor):>12}"
        f"   恒等式: {'BALANCED' if state.financial.balanced else 'UNRECONCILED'}",
        "",
        "== 小镇状态",
    ]
    for name, metric in state.state.items():
        lines.append(
            f"  {METRIC_LABELS.get(name, name):<8} {_band_label(metric.band):<16} score={metric.score:.3f}"
        )
    lines.append("")
    lines.append("== 未决（如实呈现，不自动修正）")
    lines.append(
        f"  未配对转账腿 {state.unresolved.transfer_legs} | "
        f"UNRESOLVED 退款 {state.unresolved.refunds} | "
        f"UNKNOWN 交易 {state.unresolved.unknown_transactions} | "
        f"能量未决 {state.unresolved.energy_unknown_count}"
    )
    lines.append("")
    lines.append("== 场景活动")
    if state.scenes:
        for scene in state.scenes:
            share = f"{scene.share_of_consumption * 100:.1f}%" if scene.share_of_consumption is not None else "-"
            trend = TREND_LABELS.get(scene.trend_vs_previous_period, "?")
            lines.append(
                f"  {SCENE_LABELS.get(scene.scene, scene.scene):<6}({scene.scene:<17}) "
                f"{fmt_minor(scene.amount_minor):>11}  {scene.transaction_count:>3} 笔  "
                f"{scene.active_days:>2} 天  占消费 {share:>6}  环比 {trend}"
            )
    else:
        lines.append("  （本期无场景活动）")
    if state.projects:
        lines.append("")
        lines.append("== 阶段建设")
        for project in state.projects:
            lines.append(f"  [{project.status}] {project.name} ({project.project_type})")
    lines.append("")
    lines.append("explain: life-energy town explain --month " + state.period.month)
    return "\n".join(lines)


def format_scenes(state: TownState) -> str:
    lines = [f"生活小镇场景 — {state.period.month}"]
    if not state.scenes:
        lines.append("  （本期无场景活动）")
    for scene in state.scenes:
        share = f"{scene.share_of_consumption * 100:.1f}%" if scene.share_of_consumption is not None else "-"
        lines.append(
            f"  {scene.scene:<17} {fmt_minor(scene.amount_minor):>11}  "
            f"{scene.transaction_count:>3} 笔  {scene.active_days:>2} 天  "
            f"占消费 {share:>6}  环比 {scene.trend_vs_previous_period}"
            f"（上期 {fmt_minor(scene.previous_amount_minor) if scene.previous_amount_minor is not None else '无数据'}）"
        )
    return "\n".join(lines)


def format_explanations(state: TownState) -> str:
    lines = [f"生活小镇解释 — {state.period.month}（rules {RULES_VERSION}）"]
    for name, metric in state.state.items():
        lines.append("")
        lines.append(
            f"== {name} · {METRIC_LABELS.get(name, name)} = {_band_label(metric.band)}  score={metric.score:.4f}"
        )
        for factor in metric.factors:
            value = factor.value
            if isinstance(value, float):
                value = f"{value:.4f}"
            lines.append(f"    {factor.name:<28} {value}  {factor.detail}")
    return "\n".join(lines)
