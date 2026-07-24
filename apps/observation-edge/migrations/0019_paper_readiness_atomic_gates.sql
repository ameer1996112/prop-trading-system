DROP TRIGGER IF EXISTS paper_kill_switch_events_no_update;
DROP TRIGGER IF EXISTS paper_kill_switch_events_no_delete;

ALTER TABLE paper_kill_switch_events
    RENAME TO paper_kill_switch_events_legacy;

CREATE TABLE paper_kill_switch_events (
    control_sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id TEXT NOT NULL UNIQUE,
    idempotency_key TEXT NOT NULL UNIQUE,
    payload_sha256 TEXT NOT NULL
        CHECK (length(payload_sha256) = 64 AND payload_sha256 NOT GLOB '*[^a-f0-9]*'),
    enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
    reason TEXT NOT NULL CHECK (length(reason) BETWEEN 3 AND 240),
    changed_at TEXT NOT NULL
) STRICT;

INSERT INTO paper_kill_switch_events (
    event_id,
    idempotency_key,
    payload_sha256,
    enabled,
    reason,
    changed_at
)
SELECT
    event_id,
    idempotency_key,
    payload_sha256,
    enabled,
    reason,
    changed_at
FROM paper_kill_switch_events_legacy
ORDER BY changed_at, event_id;

DROP TABLE paper_kill_switch_events_legacy;

CREATE TRIGGER paper_kill_switch_events_no_update
BEFORE UPDATE ON paper_kill_switch_events
BEGIN
    SELECT RAISE(ABORT, 'paper kill-switch events are append-only');
END;

CREATE TRIGGER paper_kill_switch_events_no_delete
BEFORE DELETE ON paper_kill_switch_events
BEGIN
    SELECT RAISE(ABORT, 'paper kill-switch events are append-only');
END;

CREATE TABLE paper_blocked_automation_intents (
    intent_id TEXT PRIMARY KEY,
    source_receipt_id TEXT NOT NULL
        REFERENCES observation_receipts(receipt_id),
    payload_sha256 TEXT NOT NULL
        CHECK (length(payload_sha256) = 64 AND payload_sha256 NOT GLOB '*[^a-f0-9]*'),
    reason_code TEXT NOT NULL CHECK (
        reason_code IN (
            'KILL_SWITCH_ENABLED',
            'RISK_LIMIT_REACHED',
            'SAFETY_GATE_RACE',
            'ACCOUNT_NOT_FOUND',
            'NON_POSITIVE_BALANCE'
        )
    ),
    blocked_at TEXT NOT NULL
) STRICT;

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

CREATE TRIGGER paper_trade_intents_no_blocked_collision
BEFORE INSERT ON paper_trade_intents
WHEN EXISTS (
    SELECT 1
    FROM paper_blocked_automation_intents
    WHERE intent_id = NEW.intent_id
)
BEGIN
    SELECT RAISE(ABORT, 'paper intent id already blocked');
END;

CREATE TRIGGER paper_blocked_intents_no_live_collision
BEFORE INSERT ON paper_blocked_automation_intents
WHEN EXISTS (
    SELECT 1
    FROM paper_trade_intents
    WHERE intent_id = NEW.intent_id
)
BEGIN
    SELECT RAISE(ABORT, 'paper intent id already live');
END;

CREATE VIEW paper_account_readiness_metrics AS
WITH settled AS (
    SELECT
        allocation.account_id,
        settlement.rowid AS settlement_order,
        settlement.settled_at,
        CAST(
            allocation.risk_amount_minor
            * settlement.outcome_r_millis
            / 1000 AS INTEGER
        ) AS pnl_minor
    FROM paper_trade_allocations AS allocation
    JOIN paper_trade_settlements AS settlement
        ON settlement.intent_id = allocation.intent_id
),
curve AS (
    SELECT
        account_id,
        settlement_order,
        settled_at,
        pnl_minor,
        SUM(pnl_minor) OVER (
            PARTITION BY account_id
            ORDER BY settled_at, settlement_order
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        ) AS cumulative_pnl_minor
    FROM settled
),
drawdowns AS (
    SELECT
        account_id,
        MAX(
            0,
            MAX(cumulative_pnl_minor) OVER (
                PARTITION BY account_id
                ORDER BY settled_at, settlement_order
                ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
            )
        ) - cumulative_pnl_minor AS drawdown_minor
    FROM curve
),
settled_stats AS (
    SELECT
        account_id,
        COALESCE(
            SUM(CASE WHEN date(settled_at) = date('now') THEN pnl_minor ELSE 0 END),
            0
        ) AS daily_pnl_minor
    FROM settled
    GROUP BY account_id
),
drawdown_stats AS (
    SELECT
        account_id,
        COALESCE(MAX(drawdown_minor), 0) AS max_drawdown_minor
    FROM drawdowns
    GROUP BY account_id
),
open_stats AS (
    SELECT
        allocation.account_id,
        COALESCE(SUM(allocation.risk_amount_minor), 0) AS open_risk_minor,
        COUNT(*) AS open_positions
    FROM paper_trade_allocations AS allocation
    LEFT JOIN paper_trade_settlements AS settlement
        ON settlement.intent_id = allocation.intent_id
    WHERE settlement.settlement_id IS NULL
    GROUP BY allocation.account_id
)
SELECT
    projection.account_id,
    projection.label,
    projection.opening_balance_minor,
    projection.balance_minor,
    COALESCE(settled_stats.daily_pnl_minor, 0) AS daily_pnl_minor,
    COALESCE(open_stats.open_risk_minor, 0) AS open_risk_minor,
    COALESCE(open_stats.open_positions, 0) AS open_positions,
    COALESCE(drawdown_stats.max_drawdown_minor, 0) AS max_drawdown_minor
FROM paper_account_projections AS projection
LEFT JOIN settled_stats
    ON settled_stats.account_id = projection.account_id
LEFT JOIN drawdown_stats
    ON drawdown_stats.account_id = projection.account_id
LEFT JOIN open_stats
    ON open_stats.account_id = projection.account_id;

CREATE TRIGGER paper_trade_allocations_readiness_gate
BEFORE INSERT ON paper_trade_allocations
WHEN
    NEW.intent_id IS NULL
    OR NEW.risk_amount_minor IS NULL
    OR NEW.balance_before_minor IS NULL
    OR NEW.risk_amount_minor <= 0
    OR COALESCE(
        (
            SELECT enabled
            FROM paper_kill_switch_events
            ORDER BY control_sequence DESC
            LIMIT 1
        ),
        1
    ) = 1
    OR EXISTS (
        SELECT 1
        FROM paper_account_readiness_metrics AS metric
        WHERE metric.account_id = NEW.account_id
          AND (
              metric.balance_minor <= 0
              OR MAX(0, -metric.daily_pnl_minor)
                    >= (
                        CAST(metric.opening_balance_minor / 10000 AS INTEGER) * 500
                        + CAST(
                            (
                                (metric.opening_balance_minor % 10000) * 500
                                + 9999
                            ) / 10000 AS INTEGER
                        )
                    )
              OR metric.max_drawdown_minor
                    >= (
                        CAST(metric.opening_balance_minor / 10000 AS INTEGER) * 1000
                        + CAST(
                            (
                                (metric.opening_balance_minor % 10000) * 1000
                                + 9999
                            ) / 10000 AS INTEGER
                        )
                    )
              OR metric.open_risk_minor + NEW.risk_amount_minor
                    > (
                        CAST(metric.balance_minor / 10000 AS INTEGER) * 200
                        + CAST(
                            (metric.balance_minor % 10000) * 200 / 10000
                            AS INTEGER
                        )
                    )
              OR metric.open_positions >= 4
          )
    )
BEGIN
    SELECT RAISE(ABORT, 'paper safety gate blocked allocation');
END;
