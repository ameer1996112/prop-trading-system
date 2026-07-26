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
        length(payload_sha256) = 64
        AND payload_sha256 NOT GLOB '*[^0-9a-f]*'
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

-- This child deliberately cascades when its parent is dropped. Keep the
-- append-only audit rows across the short parent-table replacement window.
CREATE TABLE observation_setup_evidence_entry_v2_backup AS
SELECT *
FROM observation_setup_evidence;

DROP TABLE observation_receipts;

ALTER TABLE observation_receipts_entry_v2
    RENAME TO observation_receipts;

INSERT INTO observation_setup_evidence
SELECT *
FROM observation_setup_evidence_entry_v2_backup;

DROP TABLE observation_setup_evidence_entry_v2_backup;

CREATE INDEX idx_observation_receipts_received
    ON observation_receipts(received_at DESC, receipt_id DESC);

CREATE INDEX idx_observation_receipts_producer_sequence
    ON observation_receipts(producer_instance_id, sequence DESC);

PRAGMA foreign_key_check;
PRAGMA defer_foreign_keys = OFF;
