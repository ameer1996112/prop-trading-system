-- Admit the entry-contract receipt version while preserving every historical
-- receipt and its downstream references. Validation is deferred only while
-- the replacement parent table is reconstructed inside this migration.
PRAGMA defer_foreign_keys = ON;

CREATE TABLE observation_receipts_entry_v2 (
    receipt_id TEXT PRIMARY KEY NOT NULL,
    received_at TEXT NOT NULL,
    idempotency_key TEXT NOT NULL UNIQUE,
    payload_sha256 TEXT NOT NULL,
    schema_version TEXT NOT NULL
        CHECK (schema_version IN ('1.0', '1.1', '1.2', '2.0')),
    strategy_id TEXT NOT NULL
        CHECK (strategy_id = 'rd_liquidity_sd_5m_v1'),
    strategy_version TEXT NOT NULL
        CHECK (
            (schema_version = '1.0' AND strategy_version = '1.0.0-phase1')
            OR
            (schema_version = '1.1' AND strategy_version = '1.1.0-paper1')
            OR
            (schema_version = '1.2' AND strategy_version = '1.2.0-contract1')
            OR
            (schema_version = '2.0' AND strategy_version = '2.0.0-contract2')
        ),
    producer_instance_id TEXT NOT NULL,
    sequence INTEGER NOT NULL CHECK (
        (schema_version = '2.0' AND sequence >= 1)
        OR
        (schema_version IN ('1.0', '1.1', '1.2') AND sequence >= 0)
    ),
    symbol TEXT NOT NULL,
    ticker_id TEXT NOT NULL,
    feed TEXT NOT NULL,
    timeframe TEXT NOT NULL CHECK (timeframe = '5'),
    kind TEXT NOT NULL CHECK (kind IN ('incremental', 'snapshot')),
    CHECK (
        (
            schema_version IN ('1.0', '1.1', '1.2')
            AND length(payload_sha256) = 64
        )
        OR
        (
            schema_version = '2.0'
            AND length(payload_sha256) = 64
            AND payload_sha256 NOT GLOB '*[^0-9a-f]*'
        )
    )
) STRICT;

INSERT INTO observation_receipts_entry_v2 (
    receipt_id, received_at, idempotency_key, payload_sha256,
    schema_version, strategy_id, strategy_version, producer_instance_id,
    sequence, symbol, ticker_id, feed, timeframe, kind
)
SELECT
    receipt_id, received_at, idempotency_key, payload_sha256,
    schema_version, strategy_id, strategy_version, producer_instance_id,
    sequence, symbol, ticker_id, feed, timeframe, kind
FROM observation_receipts;

-- The following two consumers use deferred NO ACTION foreign keys. Detach
-- their receipt links before dropping the parent, then restore them after the
-- replacement parent is in place so commit-time FK enforcement remains live.
CREATE TABLE paper_trade_intent_receipt_refs_entry_v2_backup AS
SELECT intent_id, source_receipt_id
FROM paper_trade_intents
WHERE source_receipt_id IS NOT NULL;

CREATE TABLE paper_blocked_automation_intents_entry_v2_backup AS
SELECT *
FROM paper_blocked_automation_intents;

DROP TRIGGER paper_trade_intents_no_update;
DROP TRIGGER paper_trade_intents_no_delete;
DROP TRIGGER paper_blocked_automation_intents_no_update;
DROP TRIGGER paper_blocked_automation_intents_no_delete;

UPDATE paper_trade_intents
SET source_receipt_id = NULL
WHERE source_receipt_id IS NOT NULL;

DELETE FROM paper_blocked_automation_intents;

-- This child deliberately cascades when its parent is dropped. Keep the
-- append-only audit rows across the short parent-table replacement window.
CREATE TABLE observation_setup_evidence_entry_v2_backup AS
SELECT *
FROM observation_setup_evidence;

DROP TABLE observation_receipts;

ALTER TABLE observation_receipts_entry_v2
    RENAME TO observation_receipts;

UPDATE paper_trade_intents
SET source_receipt_id = (
    SELECT source_receipt_id
    FROM paper_trade_intent_receipt_refs_entry_v2_backup AS backup
    WHERE backup.intent_id = paper_trade_intents.intent_id
)
WHERE EXISTS (
    SELECT 1
    FROM paper_trade_intent_receipt_refs_entry_v2_backup AS backup
    WHERE backup.intent_id = paper_trade_intents.intent_id
);

INSERT INTO paper_blocked_automation_intents
SELECT *
FROM paper_blocked_automation_intents_entry_v2_backup;

INSERT INTO observation_setup_evidence
SELECT *
FROM observation_setup_evidence_entry_v2_backup;

DROP TABLE paper_trade_intent_receipt_refs_entry_v2_backup;
DROP TABLE paper_blocked_automation_intents_entry_v2_backup;
DROP TABLE observation_setup_evidence_entry_v2_backup;

CREATE TRIGGER paper_trade_intents_no_update
BEFORE UPDATE ON paper_trade_intents
BEGIN
    SELECT RAISE(ABORT, 'paper trade intents are immutable');
END;

CREATE TRIGGER paper_trade_intents_no_delete
BEFORE DELETE ON paper_trade_intents
BEGIN
    SELECT RAISE(ABORT, 'paper trade intents are append-only');
END;

CREATE TRIGGER paper_blocked_automation_intents_no_update
BEFORE UPDATE ON paper_blocked_automation_intents
BEGIN
    SELECT RAISE(ABORT, 'blocked paper automation intents are append-only');
END;

CREATE TRIGGER paper_blocked_automation_intents_no_delete
BEFORE DELETE ON paper_blocked_automation_intents
BEGIN
    SELECT RAISE(ABORT, 'blocked paper automation intents are append-only');
END;

CREATE INDEX idx_observation_receipts_received
    ON observation_receipts(received_at DESC, receipt_id DESC);

CREATE INDEX idx_observation_receipts_producer_sequence
    ON observation_receipts(producer_instance_id, sequence DESC);

PRAGMA foreign_key_check;
