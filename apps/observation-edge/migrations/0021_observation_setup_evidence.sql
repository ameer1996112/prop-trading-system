-- Persist only validated, sanitized strategy-rule evidence. This table is an
-- observation audit projection and has no broker or execution relationship.
CREATE TABLE observation_setup_evidence (
    evidence_id TEXT PRIMARY KEY NOT NULL,
    receipt_id TEXT NOT NULL
        REFERENCES observation_receipts(receipt_id) ON DELETE CASCADE,
    recorded_at TEXT NOT NULL CHECK (length(recorded_at) BETWEEN 20 AND 32),
    event_index INTEGER NOT NULL CHECK (event_index BETWEEN 0 AND 1023),
    event_kind TEXT NOT NULL
        CHECK (event_kind IN ('transition', 'active_setup')),
    symbol TEXT NOT NULL CHECK (length(symbol) BETWEEN 1 AND 256),
    side TEXT NOT NULL CHECK (side IN ('DEMAND', 'SUPPLY')),
    zone_key TEXT NOT NULL CHECK (length(zone_key) BETWEEN 1 AND 256),
    liquidity_key TEXT NOT NULL CHECK (length(liquidity_key) BETWEEN 1 AND 256),
    formation_bar_close_epoch INTEGER NOT NULL
        CHECK (formation_bar_close_epoch >= 0),
    from_state TEXT,
    to_state TEXT NOT NULL CHECK (length(to_state) BETWEEN 1 AND 256),
    reason_code TEXT NOT NULL CHECK (length(reason_code) BETWEEN 1 AND 256),
    decision TEXT NOT NULL
        CHECK (decision IN ('WAIT', 'SHADOW_ONLY', 'REJECT')),
    entry_model TEXT
        CHECK (entry_model IS NULL OR entry_model IN ('DIR_CLOSE', 'HTF_FLIP')),
    rule_passes_json TEXT NOT NULL
        CHECK (
            json_valid(rule_passes_json)
            AND json_type(rule_passes_json) = 'array'
            AND json_array_length(rule_passes_json) = 22
        ),
    liquidity_formed_epoch INTEGER
        CHECK (liquidity_formed_epoch IS NULL OR liquidity_formed_epoch >= 0),
    own_extreme_broken_epoch INTEGER
        CHECK (own_extreme_broken_epoch IS NULL OR own_extreme_broken_epoch >= 0),
    liquidity_swept_epoch INTEGER
        CHECK (liquidity_swept_epoch IS NULL OR liquidity_swept_epoch >= 0),
    zone_engaged_epoch INTEGER
        CHECK (zone_engaged_epoch IS NULL OR zone_engaged_epoch >= 0),
    entry_confirmed_epoch INTEGER
        CHECK (entry_confirmed_epoch IS NULL OR entry_confirmed_epoch >= 0),
    zone_top TEXT NOT NULL CHECK (length(zone_top) BETWEEN 1 AND 64),
    zone_bottom TEXT NOT NULL CHECK (length(zone_bottom) BETWEEN 1 AND 64),
    zone_origin_open_epoch INTEGER NOT NULL
        CHECK (zone_origin_open_epoch >= 0),
    zone_origin_close_epoch INTEGER NOT NULL
        CHECK (zone_origin_close_epoch > zone_origin_open_epoch),
    liquidity_price TEXT NOT NULL
        CHECK (length(liquidity_price) BETWEEN 1 AND 64),
    liquidity_origin_open_epoch INTEGER NOT NULL
        CHECK (liquidity_origin_open_epoch >= 0),
    liquidity_origin_close_epoch INTEGER NOT NULL
        CHECK (liquidity_origin_close_epoch > liquidity_origin_open_epoch),
    source_open_epoch INTEGER NOT NULL CHECK (source_open_epoch >= 0),
    source_close_epoch INTEGER NOT NULL
        CHECK (source_close_epoch > source_open_epoch),
    source_open TEXT NOT NULL CHECK (length(source_open) BETWEEN 1 AND 64),
    source_high TEXT NOT NULL CHECK (length(source_high) BETWEEN 1 AND 64),
    source_low TEXT NOT NULL CHECK (length(source_low) BETWEEN 1 AND 64),
    source_close TEXT NOT NULL CHECK (length(source_close) BETWEEN 1 AND 64),
    UNIQUE (receipt_id, event_kind, event_index),
    CHECK (formation_bar_close_epoch <= source_close_epoch),
    CHECK (zone_origin_close_epoch <= source_close_epoch),
    CHECK (liquidity_origin_close_epoch <= source_close_epoch),
    CHECK (
        liquidity_formed_epoch IS NULL
        OR liquidity_formed_epoch <= source_close_epoch
    ),
    CHECK (
        own_extreme_broken_epoch IS NULL
        OR own_extreme_broken_epoch <= source_close_epoch
    ),
    CHECK (
        liquidity_swept_epoch IS NULL
        OR liquidity_swept_epoch <= source_close_epoch
    ),
    CHECK (
        zone_engaged_epoch IS NULL
        OR zone_engaged_epoch <= source_close_epoch
    ),
    CHECK (
        entry_confirmed_epoch IS NULL
        OR entry_confirmed_epoch <= source_close_epoch
    )
) STRICT;

CREATE INDEX idx_observation_setup_evidence_recorded
    ON observation_setup_evidence(recorded_at DESC, evidence_id DESC);

CREATE INDEX idx_observation_setup_evidence_receipt
    ON observation_setup_evidence(receipt_id, event_kind, event_index);

CREATE INDEX idx_observation_setup_evidence_symbol_recorded
    ON observation_setup_evidence(symbol, recorded_at DESC);

PRAGMA foreign_key_check;
