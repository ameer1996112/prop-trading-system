export const SELECT_LATEST_PAPER_KILL_SWITCH_SQL = `
SELECT
  control_sequence,
  event_id,
  idempotency_key,
  payload_sha256,
  enabled,
  reason,
  changed_at
FROM paper_kill_switch_events
ORDER BY control_sequence DESC
LIMIT 1
`;

export const SELECT_PAPER_KILL_SWITCH_BY_IDEMPOTENCY_SQL = `
SELECT
  control_sequence,
  event_id,
  idempotency_key,
  payload_sha256,
  enabled,
  reason,
  changed_at
FROM paper_kill_switch_events
WHERE idempotency_key = ?
LIMIT 1
`;

export const INSERT_PAPER_KILL_SWITCH_EVENT_SQL = `
INSERT OR IGNORE INTO paper_kill_switch_events (
  event_id,
  idempotency_key,
  payload_sha256,
  enabled,
  reason,
  changed_at
) VALUES (?, ?, ?, ?, ?, ?)
`;

export const SELECT_LATEST_PAPER_AUTOMATION_RECEIPT_SQL = `
SELECT
  receipt_id,
  received_at,
  producer_instance_id,
  sequence,
  symbol
FROM observation_receipts
WHERE schema_version = '1.1'
ORDER BY received_at DESC, receipt_id DESC
LIMIT 1
`;

export const LIST_PAPER_DAILY_PNL_SQL = `
SELECT
  p.account_id,
  COALESCE(SUM(
    CASE
      WHEN s.settled_at >= ? AND s.settled_at < ?
      THEN CAST(a.risk_amount_minor * s.outcome_r_millis / 1000 AS INTEGER)
      ELSE 0
    END
  ), 0) AS daily_pnl_minor
FROM paper_account_projections AS p
LEFT JOIN paper_trade_allocations AS a ON a.account_id = p.account_id
LEFT JOIN paper_trade_settlements AS s ON s.intent_id = a.intent_id
GROUP BY p.account_id
ORDER BY p.account_id
`;

export const SELECT_PAPER_OPEN_INTENT_HEALTH_SQL = `
SELECT
  COUNT(*) AS open_intents,
  COALESCE(SUM(CASE WHEN i.created_at < ? THEN 1 ELSE 0 END), 0)
    AS stale_open_intents,
  MIN(i.created_at) AS oldest_open_intent_at
FROM paper_trade_intents AS i
LEFT JOIN paper_trade_settlements AS s ON s.intent_id = i.intent_id
WHERE s.settlement_id IS NULL
`;

export const LIST_PAPER_ACCOUNT_READINESS_METRICS_SQL = `
SELECT
  account_id,
  label,
  opening_balance_minor,
  balance_minor,
  daily_pnl_minor,
  open_risk_minor,
  open_positions,
  max_drawdown_minor
FROM paper_account_readiness_metrics
ORDER BY account_id
`;

export const SELECT_PAPER_ACCOUNT_READINESS_METRIC_SQL = `
SELECT
  account_id,
  label,
  opening_balance_minor,
  balance_minor,
  daily_pnl_minor,
  open_risk_minor,
  open_positions,
  max_drawdown_minor
FROM paper_account_readiness_metrics
WHERE account_id = ?
LIMIT 1
`;

export const INSERT_BLOCKED_PAPER_AUTOMATION_INTENT_SQL = `
INSERT INTO paper_blocked_automation_intents (
  intent_id,
  source_receipt_id,
  payload_sha256,
  reason_code,
  blocked_at
) VALUES (?, ?, ?, ?, ?)
`;

export const SELECT_BLOCKED_PAPER_AUTOMATION_INTENT_SQL = `
SELECT
  intent_id,
  source_receipt_id,
  payload_sha256,
  reason_code,
  blocked_at
FROM paper_blocked_automation_intents
WHERE intent_id = ?
LIMIT 1
`;
