-- Migration 2: allow ENERGY_INVESTMENT_INTERNAL in the interpretation check.
--
-- Fund-to-fund conversions (基金转换) never touch the life cash system; they
-- are now a distinct energy reading instead of surfacing as unreconciled.
-- SQLite cannot alter a CHECK constraint, so the table is rebuilt in place
-- (create-with-new-check, copy, drop, rename) — the documented SQLite
-- migration pattern. Data is copied row-for-row; nothing is dropped.

CREATE TABLE IF NOT EXISTS transaction_interpretation_new (
    transaction_id            INTEGER PRIMARY KEY REFERENCES transactions(transaction_id),
    category_code             TEXT REFERENCES categories(code),
    subcategory               TEXT,
    merchant_normalized       TEXT,
    account_override_id       INTEGER REFERENCES accounts(account_id),
    role_override             TEXT,
    investment_attribution    TEXT,
    classification_source     TEXT CHECK (classification_source IS NULL OR classification_source IN
                                 ('MANUAL', 'USER_EXPLICIT', 'MERCHANT', 'KEYWORD', 'HEURISTIC', 'NONE')),
    classification_rule_id    INTEGER REFERENCES classification_rules(rule_id),
    classification_evidence   TEXT,
    classification_confidence REAL,
    energy_type               TEXT CHECK (energy_type IS NULL OR energy_type IN
                                 ('ENERGY_INPUT', 'ENERGY_CONSUMPTION', 'ENERGY_TRANSFER',
                                  'ENERGY_EXPORT', 'ENERGY_IMPORT', 'ENERGY_RETURN',
                                  'ENERGY_INVESTMENT_INTERNAL', 'ENERGY_UNKNOWN')),
    energy_derived_from       TEXT,
    is_manual_override        INTEGER NOT NULL DEFAULT 0 CHECK (is_manual_override IN (0, 1)),
    interpretation_version    INTEGER NOT NULL DEFAULT 0,
    derived_at                TEXT
);

INSERT INTO transaction_interpretation_new SELECT * FROM transaction_interpretation;
DROP TABLE transaction_interpretation;
ALTER TABLE transaction_interpretation_new RENAME TO transaction_interpretation;
