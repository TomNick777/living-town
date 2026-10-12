-- Life Energy schema v1
--
-- Three hard layers:
--   Layer 1  raw evidence      : import_batches / raw_records   (append-only, immutable)
--   Layer 2  canonical ledger  : transactions                   (what actually happened to money)
--   Layer 3  derived           : interpretation / pairings      (recomputable, overridable, provenance-carrying)
--
-- Money representation: INTEGER minor units (fen). ¥10.23 -> 1023.
-- amount_minor is always >= 0; direction (INFLOW/OUTFLOW/NEUTRAL) carries the sign.

-- ---------------------------------------------------------------- accounts

CREATE TABLE IF NOT EXISTS accounts (
    account_id    INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL UNIQUE,
    account_type  TEXT NOT NULL CHECK (account_type IN ('CASH', 'CREDIT', 'INVESTMENT', 'EXTERNAL')),
    institution   TEXT,
    masked_number TEXT,
    owner_role    TEXT,
    notes         TEXT,
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Deterministic channel payment-method -> account attribution.
-- Unmatched payment methods leave transactions unattributed (source_account_id NULL);
-- attribution never guesses.
CREATE TABLE IF NOT EXISTS account_aliases (
    alias_id    INTEGER PRIMARY KEY AUTOINCREMENT,
    channel     TEXT NOT NULL,
    alias_value TEXT NOT NULL,
    match_mode  TEXT NOT NULL DEFAULT 'EXACT' CHECK (match_mode IN ('EXACT', 'PREFIX')),
    account_id  INTEGER NOT NULL REFERENCES accounts(account_id),
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (channel, alias_value)
);

-- ------------------------------------------------- Layer 1: raw evidence

CREATE TABLE IF NOT EXISTS import_batches (
    batch_id        TEXT PRIMARY KEY,
    source_type     TEXT NOT NULL,              -- wechat | alipay | bank:<adapter>
    source_filename TEXT NOT NULL,              -- basename only, never a moved/renamed original
    source_sha256   TEXT NOT NULL,
    parser_name     TEXT NOT NULL,
    parser_version  TEXT NOT NULL,
    imported_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    total_rows      INTEGER NOT NULL DEFAULT 0,
    imported_rows   INTEGER NOT NULL DEFAULT 0,
    duplicate_rows  INTEGER NOT NULL DEFAULT 0,
    skipped_rows    INTEGER NOT NULL DEFAULT 0,
    notes           TEXT
);

-- A file hash present in the ledger means: already imported, do not re-import.
CREATE UNIQUE INDEX IF NOT EXISTS idx_import_batches_sha ON import_batches(source_sha256);

CREATE TABLE IF NOT EXISTS raw_records (
    raw_record_id           INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id                TEXT NOT NULL REFERENCES import_batches(batch_id),
    row_index               INTEGER NOT NULL,
    source_row_identity     TEXT,               -- channel-native row id, or 'row:<n>'
    raw_payload             TEXT NOT NULL,      -- the original row, JSON, untouched
    parser_name             TEXT NOT NULL,
    parser_version          TEXT NOT NULL,
    canonical_transaction_id INTEGER,           -- set only when a canonical row was created
    status                  TEXT NOT NULL CHECK (status IN ('IMPORTED', 'DUPLICATE', 'SKIPPED')),
    status_note             TEXT,
    created_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_raw_records_batch ON raw_records(batch_id);
CREATE INDEX IF NOT EXISTS idx_raw_records_canonical ON raw_records(canonical_transaction_id);

-- --------------------------------------------- Layer 2: canonical ledger

CREATE TABLE IF NOT EXISTS transactions (
    transaction_id        INTEGER PRIMARY KEY AUTOINCREMENT,
    occurred_at           TEXT NOT NULL,        -- ISO8601, +08:00
    posted_at             TEXT,                 -- channel value date if it exists
    source                TEXT NOT NULL,        -- wechat | alipay | bank:<adapter>
    source_account_id     INTEGER REFERENCES accounts(account_id),
    counterparty          TEXT,
    merchant              TEXT,
    description           TEXT,
    amount_minor          INTEGER NOT NULL CHECK (amount_minor >= 0),
    currency              TEXT NOT NULL DEFAULT 'CNY',
    direction             TEXT NOT NULL CHECK (direction IN ('INFLOW', 'OUTFLOW', 'NEUTRAL')),
    transaction_type      TEXT NOT NULL
        CHECK (transaction_type IN ('INCOME', 'EXPENSE', 'TRANSFER', 'REFUND', 'INVESTMENT', 'UNKNOWN')),
    status                TEXT,                 -- channel status, evidence only
    source_reference      TEXT NOT NULL,        -- channel-native id (or deterministic synthetic id)
    canonical_fingerprint TEXT NOT NULL,        -- sha256 over stable semantic fields
    import_batch_id       TEXT NOT NULL REFERENCES import_batches(batch_id),
    raw_record_id         INTEGER UNIQUE REFERENCES raw_records(raw_record_id),
    created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (source, source_reference)
);

CREATE INDEX IF NOT EXISTS idx_tx_occurred ON transactions(occurred_at);
CREATE INDEX IF NOT EXISTS idx_tx_type ON transactions(transaction_type);
CREATE INDEX IF NOT EXISTS idx_tx_direction ON transactions(direction);
CREATE INDEX IF NOT EXISTS idx_tx_fingerprint ON transactions(canonical_fingerprint);
CREATE INDEX IF NOT EXISTS idx_tx_account ON transactions(source_account_id);

-- ------------------------------------------------- Layer 3: derived data

CREATE TABLE IF NOT EXISTS categories (
    code        TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    kind        TEXT NOT NULL CHECK (kind IN ('EXPENSE', 'INCOME', 'SYSTEM')),
    description TEXT,
    sort_order  INTEGER NOT NULL DEFAULT 100
);

CREATE TABLE IF NOT EXISTS classification_rules (
    rule_id         INTEGER PRIMARY KEY AUTOINCREMENT,
    priority_class  TEXT NOT NULL CHECK (priority_class IN ('USER_EXPLICIT', 'MERCHANT', 'KEYWORD', 'HEURISTIC')),
    name            TEXT NOT NULL,
    match_field     TEXT NOT NULL CHECK (match_field IN ('counterparty', 'merchant', 'description', 'all_text')),
    match_mode      TEXT NOT NULL DEFAULT 'CONTAINS' CHECK (match_mode IN ('CONTAINS', 'EQUALS', 'PREFIX')),
    pattern         TEXT NOT NULL,
    category_code   TEXT NOT NULL REFERENCES categories(code),
    applies_to_type TEXT CHECK (applies_to_type IS NULL OR applies_to_type IN
                       ('INCOME', 'EXPENSE', 'TRANSFER', 'REFUND', 'INVESTMENT', 'UNKNOWN')),
    confidence      REAL NOT NULL DEFAULT 0.8,
    enabled         INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    sort_order      INTEGER NOT NULL DEFAULT 100,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_rules_class_order ON classification_rules(priority_class, sort_order);

-- One current interpretation per transaction. Recompute never touches rows
-- with is_manual_override = 1. All automatic conclusions carry provenance.
CREATE TABLE IF NOT EXISTS transaction_interpretation (
    transaction_id            INTEGER PRIMARY KEY REFERENCES transactions(transaction_id),
    category_code             TEXT REFERENCES categories(code),
    subcategory               TEXT,
    merchant_normalized       TEXT,
    account_override_id       INTEGER REFERENCES accounts(account_id),
    role_override             TEXT,
    investment_attribution    TEXT,             -- e.g. SECURITIES / FUND / PENSION
    classification_source     TEXT CHECK (classification_source IS NULL OR classification_source IN
                                 ('MANUAL', 'USER_EXPLICIT', 'MERCHANT', 'KEYWORD', 'HEURISTIC', 'NONE')),
    classification_rule_id    INTEGER REFERENCES classification_rules(rule_id),
    classification_evidence   TEXT,             -- JSON: matched field / value / pattern
    classification_confidence REAL,
    energy_type               TEXT CHECK (energy_type IS NULL OR energy_type IN
                                 ('ENERGY_INPUT', 'ENERGY_CONSUMPTION', 'ENERGY_TRANSFER',
                                  'ENERGY_EXPORT', 'ENERGY_IMPORT', 'ENERGY_RETURN', 'ENERGY_UNKNOWN')),
    energy_derived_from       TEXT,             -- JSON provenance for the energy reading
    is_manual_override        INTEGER NOT NULL DEFAULT 0 CHECK (is_manual_override IN (0, 1)),
    interpretation_version    INTEGER NOT NULL DEFAULT 0,
    derived_at                TEXT
);

-- Internal transfers: two canonical transactions are one real movement of money.
CREATE TABLE IF NOT EXISTS transfer_pairs (
    pair_id            INTEGER PRIMARY KEY AUTOINCREMENT,
    out_transaction_id INTEGER NOT NULL UNIQUE REFERENCES transactions(transaction_id),
    in_transaction_id  INTEGER NOT NULL UNIQUE REFERENCES transactions(transaction_id),
    pair_status        TEXT NOT NULL CHECK (pair_status IN ('CONFIRMED', 'PROBABLE', 'UNCERTAIN')),
    match_reason       TEXT NOT NULL,           -- JSON evidence: amounts, window, channels
    fee_minor          INTEGER NOT NULL DEFAULT 0 CHECK (fee_minor >= 0),
    paired_by          TEXT NOT NULL CHECK (paired_by IN ('AUTO', 'MANUAL')),
    created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    CHECK (out_transaction_id <> in_transaction_id)
);

CREATE INDEX IF NOT EXISTS idx_transfer_pairs_in ON transfer_pairs(in_transaction_id);

-- Rejection / confirmation memory: keeps rejected pairs from being re-suggested.
CREATE TABLE IF NOT EXISTS transfer_pair_decisions (
    decision_id        INTEGER PRIMARY KEY AUTOINCREMENT,
    out_transaction_id INTEGER NOT NULL REFERENCES transactions(transaction_id),
    in_transaction_id  INTEGER NOT NULL REFERENCES transactions(transaction_id),
    decision           TEXT NOT NULL CHECK (decision IN ('REJECTED', 'CONFIRMED')),
    created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (out_transaction_id, in_transaction_id)
);

-- Refunds are not income: every refund links back to its original expense,
-- or is explicitly UNRESOLVED. Never silently treated as external income.
CREATE TABLE IF NOT EXISTS refund_links (
    refund_link_id         INTEGER PRIMARY KEY AUTOINCREMENT,
    refund_transaction_id  INTEGER NOT NULL UNIQUE REFERENCES transactions(transaction_id),
    original_transaction_id INTEGER REFERENCES transactions(transaction_id),
    link_status            TEXT NOT NULL CHECK (link_status IN ('CONFIRMED', 'PROBABLE', 'UNRESOLVED')),
    match_reason           TEXT,                -- JSON evidence
    confidence             REAL,
    paired_by              TEXT NOT NULL CHECK (paired_by IN ('AUTO', 'MANUAL')),
    created_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    CHECK (refund_transaction_id <> original_transaction_id)
);

CREATE INDEX IF NOT EXISTS idx_refund_links_original ON refund_links(original_transaction_id);
