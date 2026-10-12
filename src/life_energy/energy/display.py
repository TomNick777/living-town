"""Human-facing labels for energy types (display only — never storage)."""


def type_label(energy_type: str) -> str:
    return {
        "ENERGY_INPUT": "能量输入 (Energy Input)",
        "ENERGY_CONSUMPTION": "能量消耗 (Energy Consumption)",
        "ENERGY_TRANSFER": "能量迁移 (Energy Transfer)",
        "ENERGY_EXPORT": "能量外输 (Energy Export)",
        "ENERGY_IMPORT": "能量回流 (Energy Import)",
        "ENERGY_RETURN": "能量返还 (Energy Return)",
        "ENERGY_INVESTMENT_INTERNAL": "投资系统内迁移 (Investment Internal)",
        "ENERGY_UNKNOWN": "未知能量 (Energy Unknown / unreconciled)",
    }.get(energy_type, energy_type)
