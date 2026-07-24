export const INSERT_RECEIPT_SQL = `
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
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

export const SELECT_RECEIPT_SQL = `
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
FROM observation_receipts
WHERE idempotency_key = ?
LIMIT 1
`;

export const LIST_RECEIPTS_SQL = `
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
FROM observation_receipts
ORDER BY received_at DESC, receipt_id DESC
LIMIT ?
`;

export const INSERT_SETUP_EVIDENCE_SQL = `
INSERT INTO observation_setup_evidence (
  evidence_id,
  receipt_id,
  recorded_at,
  event_index,
  event_kind,
  symbol,
  side,
  zone_key,
  liquidity_key,
  formation_bar_close_epoch,
  from_state,
  to_state,
  reason_code,
  decision,
  entry_model,
  rule_passes_json,
  liquidity_formed_epoch,
  own_extreme_broken_epoch,
  liquidity_swept_epoch,
  zone_engaged_epoch,
  entry_confirmed_epoch,
  zone_top,
  zone_bottom,
  zone_origin_open_epoch,
  zone_origin_close_epoch,
  liquidity_price,
  liquidity_origin_open_epoch,
  liquidity_origin_close_epoch,
  source_open_epoch,
  source_close_epoch,
  source_open,
  source_high,
  source_low,
  source_close
)
SELECT
  json_extract(value, '$.evidenceId'),
  ?,
  ?,
  json_extract(value, '$.eventIndex'),
  json_extract(value, '$.eventKind'),
  json_extract(value, '$.symbol'),
  json_extract(value, '$.side'),
  json_extract(value, '$.zoneKey'),
  json_extract(value, '$.liquidityKey'),
  json_extract(value, '$.formationBarCloseEpoch'),
  json_extract(value, '$.fromState'),
  json_extract(value, '$.toState'),
  json_extract(value, '$.reasonCode'),
  json_extract(value, '$.decision'),
  json_extract(value, '$.entryModel'),
  json_extract(value, '$.rulePassesJson'),
  json_extract(value, '$.liquidityFormedEpoch'),
  json_extract(value, '$.ownExtremeBrokenEpoch'),
  json_extract(value, '$.liquiditySweptEpoch'),
  json_extract(value, '$.zoneEngagedEpoch'),
  json_extract(value, '$.entryConfirmedEpoch'),
  json_extract(value, '$.zoneTop'),
  json_extract(value, '$.zoneBottom'),
  json_extract(value, '$.zoneOriginOpenEpoch'),
  json_extract(value, '$.zoneOriginCloseEpoch'),
  json_extract(value, '$.liquidityPrice'),
  json_extract(value, '$.liquidityOriginOpenEpoch'),
  json_extract(value, '$.liquidityOriginCloseEpoch'),
  json_extract(value, '$.sourceOpenEpoch'),
  json_extract(value, '$.sourceCloseEpoch'),
  json_extract(value, '$.sourceOpen'),
  json_extract(value, '$.sourceHigh'),
  json_extract(value, '$.sourceLow'),
  json_extract(value, '$.sourceClose')
FROM json_each(?)
`;

export const LIST_SETUP_EVIDENCE_SQL = `
SELECT
  evidence_id,
  receipt_id,
  recorded_at,
  event_index,
  event_kind,
  symbol,
  side,
  zone_key,
  liquidity_key,
  formation_bar_close_epoch,
  from_state,
  to_state,
  reason_code,
  decision,
  entry_model,
  rule_passes_json,
  liquidity_formed_epoch,
  own_extreme_broken_epoch,
  liquidity_swept_epoch,
  zone_engaged_epoch,
  entry_confirmed_epoch,
  zone_top,
  zone_bottom,
  zone_origin_open_epoch,
  zone_origin_close_epoch,
  liquidity_price,
  liquidity_origin_open_epoch,
  liquidity_origin_close_epoch,
  source_open_epoch,
  source_close_epoch,
  source_open,
  source_high,
  source_low,
  source_close
FROM observation_setup_evidence
ORDER BY recorded_at DESC, evidence_id DESC
LIMIT ?
`;
