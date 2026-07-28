export const INSERT_PAPER_TRADE_INTENT_SQL = `
INSERT INTO paper_trade_intents (
  intent_id,
  idempotency_key,
  payload_sha256,
  symbol,
  side,
  entry_price,
  stop_loss,
  take_profit,
  risk_bps,
  created_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

export const INSERT_AUTOMATED_PAPER_TRADE_INTENT_SQL = `
INSERT INTO paper_trade_intents (
  intent_id,
  idempotency_key,
  payload_sha256,
  symbol,
  side,
  entry_price,
  stop_loss,
  take_profit,
  risk_bps,
  source,
  source_receipt_id,
  created_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'TRADINGVIEW', ?, ?)
`;

// Contract-v3 provenance is linked immutably through
// observation_entry_v3_paper_links -> selection -> event -> receipt. The
// pre-v3 source_receipt_id foreign key intentionally remains attached to the
// retained contract-v2 receipt parent.
export const INSERT_ENTRY_V3_PAPER_TRADE_INTENT_SQL = `
INSERT INTO paper_trade_intents (
  intent_id,
  idempotency_key,
  payload_sha256,
  symbol,
  side,
  entry_price,
  stop_loss,
  take_profit,
  risk_bps,
  source,
  source_receipt_id,
  created_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'TRADINGVIEW', NULL, ?)
`;

export const SELECT_PAPER_TRADE_INTENT_SQL = `
SELECT
  intent_id,
  idempotency_key,
  payload_sha256,
  symbol,
  side,
  entry_price,
  stop_loss,
  take_profit,
  risk_bps,
  source,
  source_receipt_id,
  created_at
FROM paper_trade_intents
WHERE intent_id = ?
LIMIT 1
`;

export const INSERT_PAPER_TRADE_ALLOCATION_SQL = `
WITH account_state AS (
  SELECT
    account_id,
    balance_minor,
    CAST(balance_minor * ? / 10000 AS INTEGER) AS risk_amount_minor
  FROM paper_account_projections
  WHERE account_id = ?
),
matching_intent AS (
  SELECT intent_id
  FROM paper_trade_intents
  WHERE intent_id = ? AND payload_sha256 = ?
)
INSERT INTO paper_trade_allocations (
  allocation_id,
  intent_id,
  account_id,
  risk_amount_minor,
  balance_before_minor,
  created_at
)
VALUES (
  ?,
  (SELECT intent_id FROM matching_intent),
  ?,
  (
    SELECT risk_amount_minor
    FROM account_state
    WHERE balance_minor > 0 AND risk_amount_minor > 0
  ),
  (
    SELECT balance_minor
    FROM account_state
    WHERE balance_minor > 0 AND risk_amount_minor > 0
  ),
  ?
)
`;

export const LIST_PAPER_TRADE_ALLOCATIONS_SQL = `
SELECT
  allocation_id,
  intent_id,
  account_id,
  risk_amount_minor,
  balance_before_minor,
  created_at
FROM paper_trade_allocations
WHERE intent_id = ?
ORDER BY account_id
`;

export const INSERT_PAPER_TRADE_SETTLEMENT_SQL = `
INSERT INTO paper_trade_settlements (
  settlement_id,
  intent_id,
  idempotency_key,
  payload_sha256,
  outcome_r_millis,
  exit_reason,
  settled_at
) VALUES (?, ?, ?, ?, ?, ?, ?)
`;

export const SELECT_PAPER_TRADE_SETTLEMENT_SQL = `
SELECT
  settlement_id,
  intent_id,
  idempotency_key,
  payload_sha256,
  outcome_r_millis,
  exit_reason,
  settled_at
FROM paper_trade_settlements
WHERE intent_id = ?
LIMIT 1
`;

export const LIST_PAPER_SIMULATION_ROWS_SQL = `
SELECT
  i.intent_id,
  i.symbol,
  i.side,
  i.entry_price,
  i.stop_loss,
  i.take_profit,
  i.risk_bps,
  i.source,
  i.source_receipt_id,
  i.created_at,
  a.account_id,
  a.risk_amount_minor,
  a.balance_before_minor,
  s.settlement_id,
  s.outcome_r_millis,
  s.exit_reason,
  s.settled_at,
  CASE
    WHEN s.settlement_id IS NULL THEN NULL
    ELSE CAST(a.risk_amount_minor * s.outcome_r_millis / 1000 AS INTEGER)
  END AS pnl_minor
FROM paper_trade_intents AS i
JOIN paper_trade_allocations AS a ON a.intent_id = i.intent_id
LEFT JOIN paper_trade_settlements AS s ON s.intent_id = i.intent_id
WHERE i.intent_id IN (
  SELECT intent_id
  FROM paper_trade_intents
  ORDER BY created_at DESC, intent_id
  LIMIT ?
)
ORDER BY i.created_at DESC, i.intent_id, a.account_id
`;

export const LIST_PAPER_SIMULATION_ACCOUNT_STATS_SQL = `
WITH settled AS (
  SELECT
    a.account_id,
    s.settlement_id,
    s.rowid AS settlement_order,
    s.settled_at,
    CAST(a.risk_amount_minor * s.outcome_r_millis / 1000 AS INTEGER)
      AS pnl_minor
  FROM paper_trade_allocations AS a
  JOIN paper_trade_settlements AS s ON s.intent_id = a.intent_id
),
curve AS (
  SELECT
    account_id,
    settlement_id,
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
    COALESCE(SUM(pnl_minor), 0) AS realized_pnl_minor,
    COUNT(*) AS settled_trades,
    SUM(CASE WHEN pnl_minor > 0 THEN 1 ELSE 0 END) AS winning_trades,
    SUM(CASE WHEN pnl_minor < 0 THEN 1 ELSE 0 END) AS losing_trades
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
    a.account_id,
    COALESCE(SUM(a.risk_amount_minor), 0) AS open_risk_minor,
    COUNT(*) AS open_positions
  FROM paper_trade_allocations AS a
  LEFT JOIN paper_trade_settlements AS s ON s.intent_id = a.intent_id
  WHERE s.settlement_id IS NULL
  GROUP BY a.account_id
)
SELECT
  p.account_id,
  p.mode,
  p.label,
  p.currency_code,
  p.currency_scale,
  p.opening_balance_minor,
  p.created_at,
  p.ledger_delta_minor,
  p.balance_minor,
  p.last_sequence,
  COALESCE(ss.realized_pnl_minor, 0) AS realized_pnl_minor,
  COALESCE(os.open_risk_minor, 0) AS open_risk_minor,
  COALESCE(os.open_positions, 0) AS open_positions,
  COALESCE(ss.settled_trades, 0) AS settled_trades,
  COALESCE(ss.winning_trades, 0) AS winning_trades,
  COALESCE(ss.losing_trades, 0) AS losing_trades,
  COALESCE(ds.max_drawdown_minor, 0) AS max_drawdown_minor
FROM paper_account_projections AS p
LEFT JOIN settled_stats AS ss ON ss.account_id = p.account_id
LEFT JOIN drawdown_stats AS ds ON ds.account_id = p.account_id
LEFT JOIN open_stats AS os ON os.account_id = p.account_id
ORDER BY p.created_at DESC, p.account_id
`;
