-- Admit the versioned TradingView paper-automation envelope while preserving
-- every existing metadata-only receipt. Raw webhook payloads remain absent.
ALTER TABLE observation_receipts RENAME TO observation_receipts_v1;

CREATE TABLE observation_receipts (
    receipt_id TEXT PRIMARY KEY NOT NULL,
    received_at TEXT NOT NULL,
    idempotency_key TEXT NOT NULL UNIQUE,
    payload_sha256 TEXT NOT NULL,
    schema_version TEXT NOT NULL
        CHECK (schema_version IN ('1.0', '1.1')),
    strategy_id TEXT NOT NULL
        CHECK (strategy_id = 'rd_liquidity_sd_5m_v1'),
    strategy_version TEXT NOT NULL
        CHECK (
            (schema_version = '1.0' AND strategy_version = '1.0.0-phase1')
            OR
            (schema_version = '1.1' AND strategy_version = '1.1.0-paper1')
        ),
    producer_instance_id TEXT NOT NULL,
    sequence INTEGER NOT NULL CHECK (sequence >= 0),
    symbol TEXT NOT NULL,
    ticker_id TEXT NOT NULL,
    feed TEXT NOT NULL,
    timeframe TEXT NOT NULL CHECK (timeframe = '5'),
    kind TEXT NOT NULL CHECK (kind IN ('incremental', 'snapshot')),
    CHECK (length(payload_sha256) = 64)
) STRICT;

INSERT INTO observation_receipts (
    receipt_id,
    received_at,
    idempotency_key,
    payload_sha256,
    schema_version,
    strategy_id,
    strategy_version,
    producer_instance_id,
    sequence,
    symbol,
    ticker_id,
    feed,
    timeframe,
    kind
)
SELECT
    receipt_id,
    received_at,
    idempotency_key,
    payload_sha256,
    schema_version,
    strategy_id,
    strategy_version,
    producer_instance_id,
    sequence,
    symbol,
    ticker_id,
    feed,
    timeframe,
    kind
FROM observation_receipts_v1;

DROP TABLE observation_receipts_v1;

CREATE INDEX idx_observation_receipts_received
    ON observation_receipts(received_at DESC, receipt_id DESC);

CREATE INDEX idx_observation_receipts_producer_sequence
    ON observation_receipts(producer_instance_id, sequence DESC);

ALTER TABLE paper_trade_intents
    ADD COLUMN source TEXT NOT NULL DEFAULT 'MANUAL'
        CHECK (source IN ('MANUAL', 'TRADINGVIEW'));

ALTER TABLE paper_trade_intents
    ADD COLUMN source_receipt_id TEXT REFERENCES observation_receipts(receipt_id);
