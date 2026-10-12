"""Seed taxonomy and starter rules.

Category codes are stable identifiers; display names are separate. Starter
rules are absorbed from all-wallet-manager's proven keyword set (plus obvious
merchant rules) so the classifier is useful from the first import. Users
extend them with USER_EXPLICIT rules — never by editing facts.
"""

from __future__ import annotations

import sqlite3

CATEGORIES = [
    # code, name, kind, sort_order
    ("FOOD", "餐饮美食", "EXPENSE", 10),
    ("HOUSING", "居住", "EXPENSE", 20),
    ("TRANSPORT", "交通出行", "EXPENSE", 30),
    ("FAMILY", "家庭", "EXPENSE", 40),
    ("TELECOM", "通信网络", "EXPENSE", 50),
    ("ENTERTAINMENT", "娱乐休闲", "EXPENSE", 60),
    ("HEALTH", "医疗健康", "EXPENSE", 70),
    ("SHOPPING", "购物消费", "EXPENSE", 80),
    ("SERVICES", "生活服务", "EXPENSE", 90),
    ("EDUCATION", "教育学习", "EXPENSE", 100),
    ("OTHER_EXPENSE", "其他生活支出", "EXPENSE", 990),
    ("SALARY", "工资收入", "INCOME", 10),
    ("BONUS", "奖金", "INCOME", 20),
    ("OTHER_INCOME", "其他收入", "INCOME", 990),
    ("INTERNAL_TRANSFER", "内部转账", "SYSTEM", 800),
    ("INVESTMENT", "投资", "SYSTEM", 810),
    ("REFUND", "退款", "SYSTEM", 820),
]

# (priority_class, name, match_field, match_mode, pattern, category, applies_to, confidence, sort_order)
SEED_RULES = [
    ("MERCHANT", "麦当劳", "counterparty", "CONTAINS", "麦当劳", "FOOD", "EXPENSE", 0.95, 10),
    ("MERCHANT", "星巴克", "counterparty", "CONTAINS", "星巴克", "FOOD", "EXPENSE", 0.95, 11),
    ("MERCHANT", "瑞幸咖啡", "counterparty", "CONTAINS", "瑞幸", "FOOD", "EXPENSE", 0.95, 12),
    ("MERCHANT", "海底捞", "counterparty", "CONTAINS", "海底捞", "FOOD", "EXPENSE", 0.95, 13),
    ("MERCHANT", "滴滴出行", "counterparty", "CONTAINS", "滴滴", "TRANSPORT", "EXPENSE", 0.95, 20),
    ("MERCHANT", "京东", "counterparty", "CONTAINS", "京东", "SHOPPING", "EXPENSE", 0.9, 30),
    ("MERCHANT", "淘宝", "counterparty", "CONTAINS", "淘宝", "SHOPPING", "EXPENSE", 0.9, 31),
    ("MERCHANT", "拼多多", "counterparty", "CONTAINS", "拼多多", "SHOPPING", "EXPENSE", 0.9, 32),
    ("MERCHANT", "中国移动", "counterparty", "PREFIX", "中国移动", "TELECOM", "EXPENSE", 0.95, 40),
    ("KEYWORD", "外卖", "all_text", "CONTAINS", "外卖", "FOOD", "EXPENSE", 0.8, 110),
    ("KEYWORD", "餐饮", "all_text", "CONTAINS", "餐饮", "FOOD", "EXPENSE", 0.8, 111),
    ("KEYWORD", "地铁", "all_text", "CONTAINS", "地铁", "TRANSPORT", "EXPENSE", 0.8, 120),
    ("KEYWORD", "公交", "all_text", "CONTAINS", "公交", "TRANSPORT", "EXPENSE", 0.8, 121),
    ("KEYWORD", "加油", "all_text", "CONTAINS", "加油", "TRANSPORT", "EXPENSE", 0.8, 122),
    ("KEYWORD", "房租", "all_text", "CONTAINS", "房租", "HOUSING", "EXPENSE", 0.85, 130),
    ("KEYWORD", "水费", "all_text", "CONTAINS", "水费", "HOUSING", "EXPENSE", 0.8, 131),
    ("KEYWORD", "电费", "all_text", "CONTAINS", "电费", "HOUSING", "EXPENSE", 0.8, 132),
    ("KEYWORD", "燃气", "all_text", "CONTAINS", "燃气", "HOUSING", "EXPENSE", 0.8, 133),
    ("KEYWORD", "话费", "all_text", "CONTAINS", "话费", "TELECOM", "EXPENSE", 0.8, 140),
    ("KEYWORD", "宽带", "all_text", "CONTAINS", "宽带", "TELECOM", "EXPENSE", 0.8, 141),
    ("KEYWORD", "电影", "all_text", "CONTAINS", "电影", "ENTERTAINMENT", "EXPENSE", 0.8, 150),
    ("KEYWORD", "游戏", "all_text", "CONTAINS", "游戏", "ENTERTAINMENT", "EXPENSE", 0.8, 151),
    ("KEYWORD", "医院", "all_text", "CONTAINS", "医院", "HEALTH", "EXPENSE", 0.8, 160),
    ("KEYWORD", "药品", "all_text", "CONTAINS", "药品", "HEALTH", "EXPENSE", 0.8, 161),
    ("KEYWORD", "培训", "all_text", "CONTAINS", "培训", "EDUCATION", "EXPENSE", 0.8, 170),
    ("KEYWORD", "工资", "all_text", "CONTAINS", "工资", "SALARY", "INCOME", 0.85, 180),
    ("KEYWORD", "奖金", "all_text", "CONTAINS", "奖金", "BONUS", "INCOME", 0.85, 181),
]


def seed_categories(conn: sqlite3.Connection) -> None:
    conn.executemany(
        "INSERT OR IGNORE INTO categories (code, name, kind, sort_order) VALUES (?, ?, ?, ?)",
        CATEGORIES,
    )


def seed_rules(conn: sqlite3.Connection) -> None:
    existing = conn.execute("SELECT COUNT(*) FROM classification_rules").fetchone()[0]
    if existing:
        return
    conn.executemany(
        """
        INSERT INTO classification_rules
            (priority_class, name, match_field, match_mode, pattern, category_code,
             applies_to_type, confidence, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        SEED_RULES,
    )


def seed_all(conn: sqlite3.Connection) -> None:
    seed_categories(conn)
    seed_rules(conn)
    conn.commit()
