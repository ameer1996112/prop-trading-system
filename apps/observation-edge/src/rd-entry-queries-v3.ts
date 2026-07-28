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
) VALUES (?, ?, ?, ?, '3.0.0-contract3', '3.0.0', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
  effective_action_reason, co_triggered_models_json, evaluated_at_epoch,
  selected_trigger_epoch, selected_trigger_sequence, entry_ticks, stop_ticks,
  target_ticks, selection_json
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
  state, exit_event_id, outcome_r_millis, created_at, terminal_at
FROM observation_entry_v3_shadow_positions
WHERE setup_id = ? AND attempt_kind = ?
LIMIT 1
`;

export const INSERT_ENTRY_V3_SHADOW_POSITION_SQL = `
INSERT INTO observation_entry_v3_shadow_positions (
  candidate_id, setup_id, attempt_kind, direction, trigger_epoch,
  trigger_sequence, evaluated_at_epoch, entry_ticks, stop_ticks, target_ticks,
  state, exit_event_id, outcome_r_millis, created_at, terminal_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', NULL, NULL, ?, NULL)
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
