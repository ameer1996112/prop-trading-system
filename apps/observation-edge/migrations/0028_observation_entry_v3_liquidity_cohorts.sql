-- Admit the exact contract-v3.1 experiment tuple while preserving every
-- contract-v3.0 audit row and its strict two-plus-candle default.
PRAGMA defer_foreign_keys = ON;

DROP TRIGGER observation_receipts_mirror_contract_v2;

CREATE TABLE observation_receipts_v31 (
    receipt_id TEXT PRIMARY KEY NOT NULL,
    received_at TEXT NOT NULL,
    idempotency_key TEXT NOT NULL UNIQUE,
    payload_sha256 TEXT NOT NULL,
    schema_version TEXT NOT NULL CHECK (
        schema_version IN ('1.0', '1.1', '1.2', '2.0', '3.0', '3.1')
    ),
    strategy_id TEXT NOT NULL CHECK (strategy_id = 'rd_liquidity_sd_5m_v1'),
    strategy_version TEXT NOT NULL CHECK (
        (schema_version = '1.0' AND strategy_version = '1.0.0-phase1')
        OR
        (schema_version = '1.1' AND strategy_version = '1.1.0-paper1')
        OR
        (schema_version = '1.2' AND strategy_version = '1.2.0-contract1')
        OR
        (schema_version = '2.0' AND strategy_version = '2.0.0-contract2')
        OR
        (schema_version = '3.0' AND strategy_version = '3.0.0-contract3')
        OR
        (schema_version = '3.1' AND strategy_version = '3.1.0-contract3')
    ),
    producer_instance_id TEXT NOT NULL,
    sequence INTEGER NOT NULL CHECK (
        (schema_version IN ('2.0', '3.0', '3.1') AND sequence >= 1)
        OR
        (schema_version IN ('1.0', '1.1', '1.2') AND sequence >= 0)
    ),
    symbol TEXT NOT NULL,
    ticker_id TEXT NOT NULL,
    feed TEXT NOT NULL,
    timeframe TEXT NOT NULL CHECK (timeframe = '5'),
    kind TEXT NOT NULL CHECK (kind IN ('incremental', 'snapshot')),
    CHECK (
        length(payload_sha256) = 64
        AND (
            schema_version IN ('1.0', '1.1', '1.2')
            OR payload_sha256 NOT GLOB '*[^0-9a-f]*'
        )
    )
) STRICT;

INSERT INTO observation_receipts_v31 (
    receipt_id, received_at, idempotency_key, payload_sha256,
    schema_version, strategy_id, strategy_version, producer_instance_id,
    sequence, symbol, ticker_id, feed, timeframe, kind
)
SELECT
    receipt_id, received_at, idempotency_key, payload_sha256,
    schema_version, strategy_id, strategy_version, producer_instance_id,
    sequence, symbol, ticker_id, feed, timeframe, kind
FROM observation_receipts;

DROP TABLE observation_receipts;
ALTER TABLE observation_receipts_v31 RENAME TO observation_receipts;

CREATE TRIGGER observation_receipts_mirror_contract_v2
AFTER INSERT ON observation_receipts
WHEN NEW.schema_version NOT IN ('3.0', '3.1')
BEGIN
    INSERT INTO observation_receipts_contract_v2_archive
    VALUES (
        NEW.receipt_id, NEW.received_at, NEW.idempotency_key,
        NEW.payload_sha256, NEW.schema_version, NEW.strategy_id,
        NEW.strategy_version, NEW.producer_instance_id, NEW.sequence,
        NEW.symbol, NEW.ticker_id, NEW.feed, NEW.timeframe, NEW.kind
    );
END;

CREATE INDEX idx_observation_receipts_received
    ON observation_receipts(received_at DESC, receipt_id DESC);
CREATE INDEX idx_observation_receipts_producer_sequence
    ON observation_receipts(producer_instance_id, sequence DESC);

DROP TRIGGER observation_entry_v3_events_no_update;
DROP TRIGGER observation_entry_v3_events_no_delete;
DROP TRIGGER observation_entry_v3_paper_links_authorization_guard;
DROP TRIGGER observation_entry_v3_shadow_positions_authorization_guard;

CREATE TABLE observation_entry_v3_events_v31 (
    event_id TEXT PRIMARY KEY NOT NULL,
    receipt_id TEXT NOT NULL UNIQUE
        REFERENCES observation_receipts(receipt_id) ON DELETE RESTRICT,
    producer_instance_id TEXT NOT NULL,
    producer_sequence INTEGER NOT NULL CHECK (producer_sequence >= 1),
    strategy_version TEXT NOT NULL,
    rule_contract_version TEXT NOT NULL,
    event_role TEXT NOT NULL CHECK (
        event_role IN ('ENTRY_DECISION', 'EXIT_FOLLOWUP')
    ),
    is_realtime INTEGER NOT NULL CHECK (is_realtime IN (0, 1)),
    symbol TEXT NOT NULL,
    tick_size TEXT NOT NULL,
    detector_code_hash TEXT NOT NULL,
    settings_hash TEXT NOT NULL,
    validated_payload_json TEXT NOT NULL CHECK (
        json_valid(validated_payload_json)
        AND json_type(validated_payload_json) = 'object'
    ),
    payload_sha256 TEXT NOT NULL CHECK (
        length(payload_sha256) = 64
        AND payload_sha256 NOT GLOB '*[^0-9a-f]*'
    ),
    observed_at_epoch INTEGER NOT NULL CHECK (observed_at_epoch >= 0),
    recorded_at TEXT NOT NULL,
    UNIQUE (producer_instance_id, producer_sequence),
    CHECK (
        (
            strategy_version = '3.0.0-contract3'
            AND rule_contract_version = '3.0.0'
        )
        OR
        (
            strategy_version = '3.1.0-contract3'
            AND rule_contract_version = '3.1.0'
        )
    )
) STRICT;

INSERT INTO observation_entry_v3_events_v31 (
    event_id, receipt_id, producer_instance_id, producer_sequence,
    strategy_version, rule_contract_version, event_role, is_realtime, symbol,
    tick_size, detector_code_hash, settings_hash, validated_payload_json,
    payload_sha256, observed_at_epoch, recorded_at
)
SELECT
    event_id, receipt_id, producer_instance_id, producer_sequence,
    strategy_version, rule_contract_version, event_role, is_realtime, symbol,
    tick_size, detector_code_hash, settings_hash, validated_payload_json,
    payload_sha256, observed_at_epoch, recorded_at
FROM observation_entry_v3_events;

DROP TABLE observation_entry_v3_events;
ALTER TABLE observation_entry_v3_events_v31
    RENAME TO observation_entry_v3_events;

CREATE TRIGGER observation_entry_v3_events_no_update
BEFORE UPDATE ON observation_entry_v3_events
BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TRIGGER observation_entry_v3_events_no_delete
BEFORE DELETE ON observation_entry_v3_events
BEGIN SELECT RAISE(ABORT, 'append-only table'); END;

ALTER TABLE observation_entry_v3_selections
    ADD COLUMN liquidity_cohort TEXT NOT NULL
    DEFAULT 'TWO_PLUS_CANDLES'
    CHECK (liquidity_cohort IN ('ONE_CANDLE', 'TWO_PLUS_CANDLES'));
ALTER TABLE observation_entry_v3_selections
    ADD COLUMN one_candle_enabled INTEGER NOT NULL
    DEFAULT 0 CHECK (one_candle_enabled IN (0, 1));

ALTER TABLE observation_entry_v3_shadow_positions
    ADD COLUMN liquidity_cohort TEXT NOT NULL
    DEFAULT 'TWO_PLUS_CANDLES'
    CHECK (liquidity_cohort IN ('ONE_CANDLE', 'TWO_PLUS_CANDLES'));
ALTER TABLE observation_entry_v3_shadow_positions
    ADD COLUMN one_candle_enabled INTEGER NOT NULL
    DEFAULT 0 CHECK (one_candle_enabled IN (0, 1));

CREATE TRIGGER observation_entry_v3_selections_liquidity_cohort_insert_guard
BEFORE INSERT ON observation_entry_v3_selections
WHEN NEW.liquidity_cohort = 'ONE_CANDLE' AND NEW.one_candle_enabled = 0
BEGIN
    SELECT RAISE(ABORT, 'one-candle cohort requires enabled flag');
END;

CREATE TRIGGER observation_entry_v3_selections_liquidity_cohort_update_guard
BEFORE UPDATE ON observation_entry_v3_selections
WHEN NEW.liquidity_cohort = 'ONE_CANDLE' AND NEW.one_candle_enabled = 0
BEGIN
    SELECT RAISE(ABORT, 'one-candle cohort requires enabled flag');
END;

CREATE TRIGGER observation_entry_v3_shadow_positions_liquidity_cohort_insert_guard
BEFORE INSERT ON observation_entry_v3_shadow_positions
WHEN NEW.liquidity_cohort = 'ONE_CANDLE' AND NEW.one_candle_enabled = 0
BEGIN
    SELECT RAISE(ABORT, 'one-candle cohort requires enabled flag');
END;

CREATE TRIGGER observation_entry_v3_shadow_positions_liquidity_cohort_update_guard
BEFORE UPDATE ON observation_entry_v3_shadow_positions
WHEN NEW.liquidity_cohort = 'ONE_CANDLE' AND NEW.one_candle_enabled = 0
BEGIN
    SELECT RAISE(ABORT, 'one-candle cohort requires enabled flag');
END;

CREATE TRIGGER observation_entry_v3_paper_links_authorization_guard
BEFORE INSERT ON observation_entry_v3_paper_links
WHEN NOT EXISTS (
    SELECT 1
    FROM observation_entry_v3_selections AS selection
    JOIN observation_entry_v3_events AS event
        ON event.event_id = selection.event_id
    WHERE selection.selection_id = NEW.selection_id
      AND selection.setup_id = NEW.setup_id
      AND selection.attempt_kind = NEW.attempt_kind
      AND selection.action = 'PAPER_ELIGIBLE'
      AND selection.liquidity_cohort = 'TWO_PLUS_CANDLES'
      AND event.event_role = 'ENTRY_DECISION'
)
BEGIN
    SELECT RAISE(ABORT, 'v3 paper link authorization rejected');
END;

CREATE TRIGGER observation_entry_v3_shadow_positions_authorization_guard
BEFORE INSERT ON observation_entry_v3_shadow_positions
WHEN NOT EXISTS (
    SELECT 1
    FROM observation_entry_v3_candidates AS candidate
    JOIN observation_entry_v3_events AS event
        ON event.event_id = candidate.event_id
    JOIN observation_entry_v3_selections AS selection
        ON selection.event_id = candidate.event_id
        AND selection.setup_id = candidate.setup_id
        AND selection.attempt_kind = NEW.attempt_kind
    WHERE candidate.candidate_id = NEW.candidate_id
      AND candidate.setup_id = NEW.setup_id
      AND candidate.state = 'MATCHED'
      AND event.event_role = 'ENTRY_DECISION'
      AND selection.liquidity_cohort = NEW.liquidity_cohort
      AND selection.one_candle_enabled = NEW.one_candle_enabled
      AND (
          (
              candidate.model = 'BOC'
              AND candidate.boc_tier = 'DISCRETIONARY_5M'
          )
          OR (
              selection.canonical_candidate_id = candidate.candidate_id
              AND selection.policy_action = 'PAPER_ELIGIBLE'
              AND selection.action = 'SHADOW_ONLY'
              AND selection.effective_action_reason =
                  'PAPER_CONFIGURATION_UNAVAILABLE'
          )
      )
)
BEGIN
    SELECT RAISE(ABORT, 'v3 shadow position authorization rejected');
END;

DROP TRIGGER observation_entry_v3_shadow_positions_state_guard;
CREATE TRIGGER observation_entry_v3_shadow_positions_state_guard
BEFORE UPDATE ON observation_entry_v3_shadow_positions
WHEN
    OLD.state <> 'OPEN'
    OR NEW.state = 'OPEN'
    OR NEW.candidate_id <> OLD.candidate_id
    OR NEW.setup_id <> OLD.setup_id
    OR NEW.attempt_kind <> OLD.attempt_kind
    OR NEW.direction <> OLD.direction
    OR NEW.trigger_epoch <> OLD.trigger_epoch
    OR NEW.trigger_sequence <> OLD.trigger_sequence
    OR NEW.evaluated_at_epoch <> OLD.evaluated_at_epoch
    OR NEW.entry_ticks <> OLD.entry_ticks
    OR NEW.stop_ticks <> OLD.stop_ticks
    OR NEW.target_ticks <> OLD.target_ticks
    OR NEW.liquidity_cohort <> OLD.liquidity_cohort
    OR NEW.one_candle_enabled <> OLD.one_candle_enabled
    OR NEW.created_at <> OLD.created_at
BEGIN
    SELECT RAISE(ABORT, 'shadow position transition rejected');
END;

PRAGMA foreign_key_check;
PRAGMA defer_foreign_keys = OFF;
