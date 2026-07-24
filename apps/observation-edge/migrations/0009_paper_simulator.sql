-- Broker-free paper trade intents, immutable account allocations, and settlement facts.
CREATE TABLE paper_trade_intents (
    intent_id TEXT PRIMARY KEY NOT NULL,
    idempotency_key TEXT NOT NULL UNIQUE,
    payload_sha256 TEXT NOT NULL,
    symbol TEXT NOT NULL,
    side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
    entry_price TEXT NOT NULL,
    stop_loss TEXT NOT NULL,
    take_profit TEXT NOT NULL,
    risk_bps INTEGER NOT NULL CHECK (risk_bps BETWEEN 1 AND 500),
    created_at TEXT NOT NULL,
    CHECK (length(intent_id) BETWEEN 1 AND 128),
    CHECK (intent_id NOT IN ('.', '..')),
    CHECK (intent_id NOT GLOB '*[^A-Za-z0-9_.:-]*'),
    CHECK (idempotency_key = 'paper-intent:' || intent_id),
    CHECK (
        length(payload_sha256) = 64
        AND payload_sha256 NOT GLOB '*[^0-9a-f]*'
    ),
    CHECK (length(symbol) BETWEEN 1 AND 32),
    CHECK (symbol = upper(symbol)),
    CHECK (symbol NOT GLOB '*[^A-Z0-9._:-]*'),
    CHECK (length(entry_price) BETWEEN 1 AND 21),
    CHECK (length(stop_loss) BETWEEN 1 AND 21),
    CHECK (length(take_profit) BETWEEN 1 AND 21)
) STRICT;

CREATE TABLE paper_trade_allocations (
    allocation_id TEXT PRIMARY KEY NOT NULL,
    intent_id TEXT NOT NULL
        REFERENCES paper_trade_intents(intent_id) ON DELETE RESTRICT,
    account_id TEXT NOT NULL
        REFERENCES paper_accounts(account_id) ON DELETE RESTRICT,
    risk_amount_minor INTEGER NOT NULL,
    balance_before_minor INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    CHECK (risk_amount_minor BETWEEN 1 AND 9007199254740991),
    CHECK (
        balance_before_minor BETWEEN -9007199254740991 AND 9007199254740991
    ),
    UNIQUE (intent_id, account_id)
) STRICT;

CREATE TABLE paper_trade_settlements (
    settlement_id TEXT PRIMARY KEY NOT NULL,
    intent_id TEXT NOT NULL UNIQUE
        REFERENCES paper_trade_intents(intent_id) ON DELETE RESTRICT,
    idempotency_key TEXT NOT NULL UNIQUE,
    payload_sha256 TEXT NOT NULL,
    outcome_r_millis INTEGER NOT NULL
        CHECK (outcome_r_millis BETWEEN -1000 AND 10000),
    exit_reason TEXT NOT NULL CHECK (exit_reason IN ('STOP', 'TARGET', 'MANUAL')),
    settled_at TEXT NOT NULL,
    CHECK (idempotency_key = 'paper-settlement:' || intent_id),
    CHECK (
        length(payload_sha256) = 64
        AND payload_sha256 NOT GLOB '*[^0-9a-f]*'
    )
) STRICT;

CREATE INDEX idx_paper_trade_intents_created
    ON paper_trade_intents(created_at DESC, intent_id);

CREATE INDEX idx_paper_trade_allocations_account
    ON paper_trade_allocations(account_id, created_at DESC, intent_id);

CREATE INDEX idx_paper_trade_settlements_settled
    ON paper_trade_settlements(settled_at DESC, settlement_id);

CREATE VIEW paper_account_projections AS
WITH manual_totals AS (
    SELECT
        account_id,
        COALESCE(SUM(amount_minor), 0) AS manual_delta_minor,
        COALESCE(MAX(sequence), 0) AS last_sequence
    FROM paper_ledger_entries
    GROUP BY account_id
),
simulated_totals AS (
    SELECT
        allocation.account_id,
        COALESCE(
            SUM(
                CAST(
                    allocation.risk_amount_minor
                    * settlement.outcome_r_millis
                    / 1000 AS INTEGER
                )
            ),
            0
        ) AS simulated_pnl_minor
    FROM paper_trade_allocations AS allocation
    JOIN paper_trade_settlements AS settlement
        ON settlement.intent_id = allocation.intent_id
    GROUP BY allocation.account_id
)
SELECT
    account.account_id,
    account.mode,
    account.label,
    account.currency_code,
    account.currency_scale,
    account.opening_balance_minor,
    account.created_at,
    COALESCE(manual.manual_delta_minor, 0)
        + COALESCE(simulated.simulated_pnl_minor, 0) AS ledger_delta_minor,
    account.opening_balance_minor
        + COALESCE(manual.manual_delta_minor, 0)
        + COALESCE(simulated.simulated_pnl_minor, 0) AS balance_minor,
    COALESCE(manual.last_sequence, 0) AS last_sequence
FROM paper_accounts AS account
LEFT JOIN manual_totals AS manual ON manual.account_id = account.account_id
LEFT JOIN simulated_totals AS simulated
    ON simulated.account_id = account.account_id;
