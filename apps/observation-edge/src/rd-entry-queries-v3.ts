export const SELECT_ENTRY_V3_EVENT_BY_RECEIPT_SQL = `
SELECT event_id, payload_sha256
FROM observation_entry_v3_events
WHERE receipt_id = ?
LIMIT 1
`;

export const SELECT_ENTRY_V3_EVENT_BY_ID_SQL = `
SELECT event_id, receipt_id, payload_sha256
FROM observation_entry_v3_events
WHERE event_id = ?
LIMIT 1
`;

export const SELECT_ENTRY_V3_EVENT_BY_PRODUCER_SEQUENCE_SQL = `
SELECT event_id, receipt_id, payload_sha256
FROM observation_entry_v3_events
WHERE producer_instance_id = ? AND producer_sequence = ?
LIMIT 1
`;

export const INSERT_ENTRY_V3_EVENT_SQL = `
INSERT INTO observation_entry_v3_events (
  event_id, receipt_id, producer_instance_id, producer_sequence,
  strategy_version, rule_contract_version, event_role, is_realtime, symbol,
  tick_size, detector_code_hash, settings_hash, validated_payload_json,
  payload_sha256, observed_at_epoch, recorded_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

export const SELECT_ENTRY_V3_EVENT_DISPOSITION_SQL = `
SELECT event_id, receipt_id, disposition, conflict_code, recorded_at
FROM observation_entry_v3_event_dispositions
WHERE event_id = ?
LIMIT 1
`;

export const INSERT_ENTRY_V3_EVENT_DISPOSITION_SQL = `
INSERT INTO observation_entry_v3_event_dispositions (
  event_id, receipt_id, disposition, conflict_code, recorded_at
) VALUES (?, ?, ?, ?, ?)
`;

export const INSERT_ENTRY_V3_CANDIDATES_SQL = `
INSERT INTO observation_entry_v3_candidates (
  candidate_id, logical_candidate_id, event_id, setup_id, model, state,
  direction, event_anchor_epoch, trigger_ordinal, boc_tier,
  reference_candle_open_epoch, source_claim_ids_json, candidate_json,
  observed_at_epoch
)
SELECT
  json_extract(value, '$.candidate_id'),
  json_extract(value, '$.logical_candidate_id'),
  json_extract(value, '$.event_id'),
  json_extract(value, '$.setup_id'),
  json_extract(value, '$.model'),
  json_extract(value, '$.state'),
  json_extract(value, '$.direction'),
  json_extract(value, '$.event_anchor_epoch'),
  json_extract(value, '$.trigger_ordinal'),
  json_extract(value, '$.boc_tier'),
  json_extract(value, '$.reference_candle_open_epoch'),
  json_extract(value, '$.source_claim_ids_json'),
  json_extract(value, '$.candidate_json'),
  json_extract(value, '$.observed_at_epoch')
FROM json_each(?)
`;

export const INSERT_ENTRY_V3_EVIDENCE_SQL = `
INSERT INTO observation_entry_v3_evidence (
  evidence_id, logical_evidence_id, event_id, candidate_id,
  logical_candidate_id, observed_trigger_epoch, trigger_sequence,
  observed_trigger_ticks, fidelity, proof_plane, replayability, evidence_json,
  observed_at_epoch
)
SELECT
  json_extract(value, '$.evidence_id'),
  json_extract(value, '$.logical_evidence_id'),
  json_extract(value, '$.event_id'),
  json_extract(value, '$.candidate_id'),
  json_extract(value, '$.logical_candidate_id'),
  json_extract(value, '$.observed_trigger_epoch'),
  json_extract(value, '$.trigger_sequence'),
  json_extract(value, '$.observed_trigger_ticks'),
  json_extract(value, '$.fidelity'),
  json_extract(value, '$.proof_plane'),
  json_extract(value, '$.replayability'),
  json_extract(value, '$.evidence_json'),
  json_extract(value, '$.observed_at_epoch')
FROM json_each(?)
`;

export const INSERT_ENTRY_V3_SELECTIONS_SQL = `
INSERT INTO observation_entry_v3_selections (
  selection_id, logical_selection_id, event_id, setup_id, attempt_kind,
  policy_version, revision, canonical_candidate_id, canonical_evidence_id,
  canonical_model, reason, fidelity, policy_action, action,
  effective_action_reason, liquidity_cohort, one_candle_enabled,
  co_triggered_models_json, evaluated_at_epoch, selected_trigger_epoch,
  selected_trigger_sequence, entry_ticks, stop_ticks, target_ticks,
  selection_json
)
SELECT
  json_extract(value, '$.selection_id'),
  json_extract(value, '$.logical_selection_id'),
  json_extract(value, '$.event_id'),
  json_extract(value, '$.setup_id'),
  json_extract(value, '$.attempt_kind'),
  'rd-entry-arbitration-v3',
  json_extract(value, '$.revision'),
  json_extract(value, '$.canonical_candidate_id'),
  json_extract(value, '$.canonical_evidence_id'),
  json_extract(value, '$.canonical_model'),
  json_extract(value, '$.reason'),
  json_extract(value, '$.fidelity'),
  json_extract(value, '$.policy_action'),
  json_extract(value, '$.action'),
  json_extract(value, '$.effective_action_reason'),
  json_extract(value, '$.liquidity_cohort'),
  json_extract(value, '$.one_candle_enabled'),
  json_extract(value, '$.co_triggered_models_json'),
  json_extract(value, '$.evaluated_at_epoch'),
  json_extract(value, '$.selected_trigger_epoch'),
  json_extract(value, '$.selected_trigger_sequence'),
  json_extract(value, '$.entry_ticks'),
  json_extract(value, '$.stop_ticks'),
  json_extract(value, '$.target_ticks'),
  json_extract(value, '$.selection_json')
FROM json_each(?)
`;

export const INSERT_ENTRY_V3_SELECTION_MEMBERS_SQL = `
INSERT INTO observation_entry_v3_selection_members (
  selection_id, object_kind, object_id
)
SELECT
  json_extract(value, '$.selection_id'),
  json_extract(value, '$.object_kind'),
  json_extract(value, '$.object_id')
FROM json_each(?)
`;

export const INSERT_ENTRY_V3_PARITY_SQL = `
INSERT INTO observation_entry_v3_parity (
  parity_id, event_id, selection_id, parity_status, mismatch_reason, compared_at
)
SELECT
  json_extract(value, '$.parity_id'),
  json_extract(value, '$.event_id'),
  json_extract(value, '$.selection_id'),
  json_extract(value, '$.parity_status'),
  json_extract(value, '$.mismatch_reason'),
  json_extract(value, '$.compared_at')
FROM json_each(?)
`;

export const SELECT_ENTRY_V3_PAPER_LINK_SQL = `
SELECT
  setup_id, attempt_kind, selection_id, intent_id, direction, trigger_epoch,
  trigger_sequence, evaluated_at_epoch, entry_ticks, stop_ticks, target_ticks,
  created_at
FROM observation_entry_v3_paper_links
WHERE setup_id = ? AND attempt_kind = ?
LIMIT 1
`;

export const INSERT_ENTRY_V3_PAPER_LINK_SQL = `
INSERT INTO observation_entry_v3_paper_links (
  setup_id, attempt_kind, selection_id, intent_id, direction, trigger_epoch,
  trigger_sequence, evaluated_at_epoch, entry_ticks, stop_ticks, target_ticks,
  created_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

export const LIST_ENTRY_V3_PAPER_INTENT_IDS_SQL = `
SELECT link.intent_id
FROM observation_entry_v3_paper_links AS link
JOIN observation_entry_v3_selections AS selection
  ON selection.selection_id = link.selection_id
WHERE selection.event_id = ?
ORDER BY link.intent_id
`;

export const LIST_ENTRY_V3_STORED_DECISIONS_SQL = `
SELECT
  selection.setup_id,
  selection.action,
  selection.effective_action_reason,
  selection.liquidity_cohort,
  selection.one_candle_enabled,
  parity.parity_status,
  parity.mismatch_reason
FROM observation_entry_v3_selections AS selection
JOIN observation_entry_v3_parity AS parity
  ON parity.selection_id = selection.selection_id
WHERE selection.event_id = ?
ORDER BY selection.setup_id
`;

export const SELECT_ENTRY_V3_SHADOW_POSITION_SQL = `
SELECT
  candidate_id, setup_id, attempt_kind, direction, trigger_epoch,
  trigger_sequence, evaluated_at_epoch, entry_ticks, stop_ticks, target_ticks,
  state, exit_event_id, outcome_r_millis, liquidity_cohort,
  one_candle_enabled, created_at, terminal_at
FROM observation_entry_v3_shadow_positions
WHERE setup_id = ? AND attempt_kind = ?
LIMIT 1
`;

export const INSERT_ENTRY_V3_SHADOW_POSITION_SQL = `
INSERT INTO observation_entry_v3_shadow_positions (
  candidate_id, setup_id, attempt_kind, direction, trigger_epoch,
  trigger_sequence, evaluated_at_epoch, entry_ticks, stop_ticks, target_ticks,
  state, exit_event_id, outcome_r_millis, liquidity_cohort,
  one_candle_enabled, created_at, terminal_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', NULL, NULL, ?, ?, ?, NULL)
`;

export const TERMINATE_ENTRY_V3_SHADOW_POSITION_SQL = `
UPDATE observation_entry_v3_shadow_positions
SET state = ?, exit_event_id = ?, outcome_r_millis = ?, terminal_at = ?
WHERE candidate_id = ? AND state = 'OPEN'
`;

export const SELECT_ENTRY_V3_EXIT_APPLICATION_SQL = `
SELECT
  application_id, event_id, exit_event_id, setup_id, attempt_kind,
  target_kind, intent_id, candidate_id, terminal_code, outcome_r_millis,
  applied_at
FROM observation_entry_v3_exit_applications
WHERE target_kind = ? AND setup_id = ? AND attempt_kind = ?
LIMIT 1
`;

export const INSERT_ENTRY_V3_EXIT_APPLICATION_SQL = `
INSERT INTO observation_entry_v3_exit_applications (
  application_id, event_id, exit_event_id, setup_id, attempt_kind,
  target_kind, intent_id, candidate_id, terminal_code, outcome_r_millis,
  applied_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

export const LIST_ENTRY_V3_DECISIONS_SQL = `
WITH ranked_selections AS (
  SELECT
    stored_selection.*,
    stored_selection.rowid AS ingest_ordinal,
    ROW_NUMBER() OVER (
      PARTITION BY stored_selection.setup_id, stored_selection.attempt_kind
      ORDER BY
        stored_selection.evaluated_at_epoch DESC,
        stored_selection.rowid DESC
    ) AS attempt_revision_rank
  FROM observation_entry_v3_selections AS stored_selection
)
SELECT
  selection.selection_id,
  selection.logical_selection_id,
  selection.event_id,
  selection.setup_id,
  selection.attempt_kind,
  selection.policy_action,
  selection.action,
  selection.effective_action_reason,
  selection.liquidity_cohort,
  selection.one_candle_enabled,
  selection.canonical_candidate_id,
  selection.canonical_evidence_id,
  selection.co_triggered_models_json,
  selection.evaluated_at_epoch,
  selection.selected_trigger_epoch,
  selection.selected_trigger_sequence,
  selection.entry_ticks,
  selection.stop_ticks,
  selection.target_ticks,
  selection.selection_json,
  event.symbol,
  event.tick_size
FROM ranked_selections AS selection
JOIN observation_entry_v3_events AS event
  ON event.event_id = selection.event_id
WHERE selection.attempt_revision_rank = 1
ORDER BY selection.evaluated_at_epoch DESC, selection.ingest_ordinal DESC
LIMIT ?
`;

// This readiness query is intentionally independent of the schema-1.1 paper
// automation receipt stream. Historical 3.0 ingress remains supported, but
// canonical RELEASE rollout readiness requires the exact 3.1 producer tuple.
export const SELECT_LATEST_RD_ENTRY_V3_RECEIPT_SQL = `
SELECT
  receipt.received_at,
  event.event_id,
  receipt.ticker_id,
  receipt.schema_version,
  event.strategy_version,
  event.rule_contract_version,
  event.detector_code_hash,
  event.settings_hash
FROM observation_receipts AS receipt
JOIN observation_entry_v3_events AS event
  ON event.receipt_id = receipt.receipt_id
WHERE receipt.schema_version = '3.1'
  AND event.strategy_version = '3.1.0-contract3'
  AND event.rule_contract_version = '3.1.0'
  AND (? IS NULL OR receipt.ticker_id = ?)
ORDER BY receipt.received_at DESC, event.rowid DESC
LIMIT 1
`;

export const SELECT_LATEST_RD_ENTRY_V3_DECISION_SQL = `
SELECT
  selection.policy_action,
  selection.action AS effective_action,
  selection.effective_action_reason,
  link.intent_id AS paper_intent_id
FROM observation_entry_v3_selections AS selection
JOIN observation_entry_v3_events AS event
  ON event.event_id = selection.event_id
JOIN observation_receipts AS receipt
  ON receipt.receipt_id = event.receipt_id
LEFT JOIN observation_entry_v3_paper_links AS link
  ON link.selection_id = selection.selection_id
WHERE (? IS NULL OR receipt.ticker_id = ?)
ORDER BY selection.evaluated_at_epoch DESC, selection.rowid DESC
LIMIT 1
`;

// Migrations 0028 and 0029 recreate this table. The resulting table SQL is a
// compact, deterministic schema witness without exposing D1 internals.
export const SELECT_RD_ENTRY_V3_SELECTIONS_SCHEMA_SQL = `
SELECT sql
FROM sqlite_master
WHERE type = 'table' AND name = 'observation_entry_v3_selections'
LIMIT 1
`;

export const LIST_ENTRY_V3_DECISION_CANDIDATES_SQL = `
SELECT
  member.selection_id,
  member.object_id AS member_object_id,
  candidate.candidate_id,
  candidate.logical_candidate_id,
  candidate.event_id,
  candidate.setup_id,
  candidate.candidate_json
FROM observation_entry_v3_selection_members AS member
JOIN observation_entry_v3_candidates AS candidate
  ON candidate.candidate_id = member.object_id
WHERE
  member.object_kind = 'CANDIDATE'
  AND member.selection_id IN (SELECT value FROM json_each(?))
ORDER BY
  member.selection_id,
  CASE candidate.model
    WHEN 'BOC' THEN 1
    WHEN 'DIR_CLOSE' THEN 2
    ELSE 3
  END,
  candidate.candidate_id
LIMIT ?
`;

export const LIST_ENTRY_V3_DECISION_EVIDENCE_SQL = `
SELECT
  member.selection_id,
  member.object_id AS member_object_id,
  evidence.evidence_id,
  evidence.logical_evidence_id,
  evidence.event_id,
  evidence.candidate_id,
  evidence.logical_candidate_id,
  evidence.evidence_json
FROM observation_entry_v3_selection_members AS member
JOIN observation_entry_v3_evidence AS evidence
  ON evidence.evidence_id = member.object_id
WHERE
  member.object_kind = 'EVIDENCE'
  AND member.selection_id IN (SELECT value FROM json_each(?))
ORDER BY member.selection_id, evidence.evidence_id
LIMIT ?
`;

export const LIST_ENTRY_V3_DECISION_MEMBERS_SQL = `
SELECT selection_id, object_kind, object_id
FROM observation_entry_v3_selection_members
WHERE selection_id IN (SELECT value FROM json_each(?))
ORDER BY selection_id, object_kind, object_id
LIMIT ?
`;

export const LIST_ENTRY_V3_DECISION_PARITY_SQL = `
SELECT event_id, selection_id, parity_status, mismatch_reason
FROM observation_entry_v3_parity
WHERE selection_id IN (SELECT value FROM json_each(?))
ORDER BY selection_id
LIMIT ?
`;

export const LIST_ENTRY_V3_DECISION_PAPER_SQL = `
SELECT
  current_selection.selection_id,
  opened_selection.selection_id AS opened_decision_id,
  opened_selection.logical_selection_id AS opened_selection_id,
  opened_selection.canonical_model AS opened_canonical_model,
  opened_selection.reason AS opened_reason,
  opened_selection.evaluated_at_epoch AS opened_evaluated_at_epoch,
  link.intent_id,
  intent.entry_price,
  intent.stop_loss,
  intent.take_profit,
  CASE WHEN settlement.settlement_id IS NULL THEN 'OPEN' ELSE 'SETTLED' END
    AS trade_state
FROM observation_entry_v3_paper_links AS link
JOIN observation_entry_v3_selections AS current_selection
  ON current_selection.setup_id = link.setup_id
  AND current_selection.attempt_kind = link.attempt_kind
JOIN observation_entry_v3_selections AS opened_selection
  ON opened_selection.selection_id = link.selection_id
JOIN paper_trade_intents AS intent ON intent.intent_id = link.intent_id
LEFT JOIN paper_trade_settlements AS settlement
  ON settlement.intent_id = intent.intent_id
WHERE current_selection.selection_id IN (SELECT value FROM json_each(?))
ORDER BY current_selection.selection_id
LIMIT ?
`;

export const LIST_ENTRY_V3_DECISION_SHADOW_SQL = `
SELECT
  member.selection_id,
  shadow.candidate_id,
  shadow.state,
  shadow.outcome_r_millis,
  shadow.liquidity_cohort,
  shadow.one_candle_enabled
FROM observation_entry_v3_selection_members AS member
JOIN observation_entry_v3_shadow_positions AS shadow
  ON shadow.candidate_id = member.object_id
WHERE
  member.object_kind = 'CANDIDATE'
  AND member.selection_id IN (SELECT value FROM json_each(?))
ORDER BY member.selection_id, shadow.candidate_id
LIMIT ?
`;
