export const INSERT_ENTRY_BATCH_SQL = `
INSERT INTO observation_entry_batches (
  batch_id, producer_instance_id, producer_sequence, kind, bar_close_epoch,
  strategy_id, strategy_version, rule_contract_version, execution_mode,
  symbol, ticker_id, feed, timeframe, tick_size, bar_open_epoch,
  detector_code_hash, settings_hash, chunk_count, first_receipt_id, first_seen_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

export const SELECT_ENTRY_BATCH_SQL = `
SELECT batch_id, producer_instance_id, producer_sequence, kind, bar_close_epoch,
  strategy_id, strategy_version, rule_contract_version, execution_mode,
  symbol, ticker_id, feed, timeframe, tick_size, bar_open_epoch,
  detector_code_hash, settings_hash, chunk_count, first_receipt_id, first_seen_at
FROM observation_entry_batches
WHERE batch_id = ?
LIMIT 1
`;

export const SELECT_ENTRY_BATCH_BY_SEQUENCE_SQL = `
SELECT batch_id, producer_instance_id, producer_sequence, kind, bar_close_epoch,
  strategy_id, strategy_version, rule_contract_version, execution_mode,
  symbol, ticker_id, feed, timeframe, tick_size, bar_open_epoch,
  detector_code_hash, settings_hash, chunk_count, first_receipt_id, first_seen_at
FROM observation_entry_batches
WHERE producer_instance_id = ? AND producer_sequence = ?
LIMIT 1
`;

export const SELECT_ENTRY_BATCH_BY_CLOSE_SQL = `
SELECT batch_id, producer_instance_id, producer_sequence, kind, bar_close_epoch,
  strategy_id, strategy_version, rule_contract_version, execution_mode,
  symbol, ticker_id, feed, timeframe, tick_size, bar_open_epoch,
  detector_code_hash, settings_hash, chunk_count, first_receipt_id, first_seen_at
FROM observation_entry_batches
WHERE producer_instance_id = ? AND bar_close_epoch = ?
LIMIT 1
`;

export const SELECT_ENTRY_SEQUENCE_NEIGHBORS_SQL = `
SELECT producer_sequence, bar_close_epoch, strategy_id, strategy_version,
  rule_contract_version, symbol, ticker_id, feed, timeframe, tick_size,
  detector_code_hash, settings_hash
FROM observation_entry_batches
WHERE producer_instance_id = ?
  AND (
    producer_sequence = (
      SELECT MAX(producer_sequence) FROM observation_entry_batches
      WHERE producer_instance_id = ? AND producer_sequence < ?
    )
    OR producer_sequence = (
      SELECT MIN(producer_sequence) FROM observation_entry_batches
      WHERE producer_instance_id = ? AND producer_sequence > ?
    )
  )
ORDER BY producer_sequence
`;

export const INSERT_MARKET_BAR_HEARTBEAT_SQL = `
INSERT INTO observation_market_bar_heartbeats (
  receipt_id, batch_id, schema_version, producer_role,
  producer_instance_id, producer_sequence, strategy_version,
  symbol, ticker_id, feed, timeframe, bar_open_epoch,
  bar_close_epoch, detector_code_hash, settings_hash, recorded_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

export const INSERT_ENTRY_CHUNK_SQL = `
INSERT INTO observation_entry_chunks (
  batch_id, chunk_index, chunk_count, receipt_id, payload_sha256,
  validated_payload_json, recorded_at
) VALUES (?, ?, ?, ?, ?, ?, ?)
`;

export const LIST_ENTRY_CHUNKS_SQL = `
SELECT batch_id, chunk_index, chunk_count, receipt_id, payload_sha256,
  validated_payload_json, recorded_at
FROM observation_entry_chunks
WHERE batch_id = ?
ORDER BY chunk_index
`;

export const INSERT_ENTRY_COMPLETION_SQL = `
INSERT INTO observation_entry_batch_completions (
  completion_id, batch_id, assembled_payload_sha256, completed_at
) VALUES (?, ?, ?, ?)
`;

export const SELECT_ENTRY_SETUP_EVENTS_SQL = `
SELECT event_id, setup_id, batch_id, receipt_id, confirmed_bar_close_epoch,
  proof_input_sha256, proof_input_json, recorded_at
FROM observation_entry_setup_events
WHERE setup_id = ?
ORDER BY confirmed_bar_close_epoch, event_id
`;

export const INSERT_ENTRY_SETUP_EVENT_SQL = `
INSERT INTO observation_entry_setup_events (
  event_id, setup_id, batch_id, receipt_id, confirmed_bar_close_epoch,
  proof_input_sha256, proof_input_json, recorded_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`;

export const SELECT_ENTRY_TERMINAL_SQL = `
SELECT setup_id, terminal_reason, terminal_epoch, first_batch_id,
  first_receipt_id, recorded_at
FROM observation_entry_setup_terminals
WHERE setup_id = ?
LIMIT 1
`;

export const INSERT_ENTRY_TERMINAL_SQL = `
INSERT INTO observation_entry_setup_terminals (
  setup_id, terminal_reason, terminal_epoch, first_batch_id,
  first_receipt_id, recorded_at
) VALUES (?, ?, ?, ?, ?, ?)
`;

export const SELECT_ENTRY_COMPLETION_SQL = `
SELECT completion_id, batch_id, assembled_payload_sha256, completed_at
FROM observation_entry_batch_completions
WHERE batch_id = ?
LIMIT 1
`;

export const SELECT_ENTRY_IDENTITIES_SQL = `
SELECT 'candidate' AS object_kind, candidate_id AS object_id, identity_sha256
FROM observation_entry_candidates
WHERE candidate_id IN (SELECT value FROM json_each(?))
UNION ALL
SELECT 'evidence', evidence_id, identity_sha256
FROM observation_entry_candidate_evidence
WHERE evidence_id IN (SELECT value FROM json_each(?))
UNION ALL
SELECT 'handling', handling_id, identity_sha256
FROM observation_entry_handling
WHERE handling_id IN (SELECT value FROM json_each(?))
`;

// Task 6 ingestion must preflight immutable identities and catalog rows, then
// submit only absent rows. These statements intentionally abort as a unit on
// any invalid or conflicting element so a bulk payload cannot persist partly.
export const INSERT_ENTRY_CANDIDATES_SQL = `
INSERT INTO observation_entry_candidates (
  candidate_id, setup_id, model, state, event_anchor_epoch, trigger_ordinal,
  direction, source_claim_ids_json, normalized_from, identity_sha256,
  first_receipt_id, observed_at_epoch
)
SELECT
  json_extract(value, '$.candidate_id'),
  json_extract(value, '$.setup_id'),
  json_extract(value, '$.model'),
  json_extract(value, '$.state'),
  json_extract(value, '$.event_anchor_epoch'),
  json_extract(value, '$.trigger_ordinal'),
  json_extract(value, '$.direction'),
  json_extract(value, '$.source_claim_ids_json'),
  json_extract(value, '$.normalized_from'),
  json_extract(value, '$.identity_sha256'),
  ?,
  json_extract(value, '$.observed_at_epoch')
FROM json_each(?)
`;

export const INSERT_ENTRY_EVIDENCE_SQL = `
INSERT INTO observation_entry_candidate_evidence (
  evidence_id, candidate_id, receipt_id, observed_trigger_epoch,
  observed_trigger_ticks, htf_context_minutes_json, fidelity, proof_plane,
  proof_resolution_seconds, coverage_start_epoch, coverage_end_epoch,
  ambiguity_codes_json, passed_rule_ids_json, failed_rule_ids_json,
  source_claim_ids_json, payload_sha256, identity_sha256, observed_at_epoch
)
SELECT
  json_extract(value, '$.evidence_id'),
  json_extract(value, '$.candidate_id'),
  ?,
  json_extract(value, '$.observed_trigger_epoch'),
  json_extract(value, '$.observed_trigger_ticks'),
  json_extract(value, '$.htf_context_minutes_json'),
  json_extract(value, '$.fidelity'),
  json_extract(value, '$.proof_plane'),
  json_extract(value, '$.proof_resolution_seconds'),
  json_extract(value, '$.coverage_start_epoch'),
  json_extract(value, '$.coverage_end_epoch'),
  json_extract(value, '$.ambiguity_codes_json'),
  json_extract(value, '$.passed_rule_ids_json'),
  json_extract(value, '$.failed_rule_ids_json'),
  json_extract(value, '$.source_claim_ids_json'),
  json_extract(value, '$.payload_sha256'),
  json_extract(value, '$.identity_sha256'),
  json_extract(value, '$.observed_at_epoch')
FROM json_each(?)
`;

export const INSERT_ENTRY_HANDLING_SQL = `
INSERT INTO observation_entry_handling (
  handling_id, candidate_id, evidence_id, receipt_id, handling_mode,
  attempt_kind, observed_epoch, observed_ticks, fidelity,
  source_claim_ids_json, identity_sha256
)
SELECT
  json_extract(value, '$.handling_id'),
  json_extract(value, '$.candidate_id'),
  json_extract(value, '$.evidence_id'),
  ?,
  json_extract(value, '$.handling_mode'),
  json_extract(value, '$.attempt_kind'),
  json_extract(value, '$.observed_epoch'),
  json_extract(value, '$.observed_ticks'),
  json_extract(value, '$.fidelity'),
  json_extract(value, '$.source_claim_ids_json'),
  json_extract(value, '$.identity_sha256')
FROM json_each(?)
`;

export const INSERT_PRODUCER_DIAGNOSTIC_SQL = `
INSERT INTO observation_entry_producer_diagnostics (
  diagnostic_id, batch_id, setup_id, candidate_refs_json,
  evidence_refs_json, realtime_evidence_refs_json, handling_refs_json,
  diagnostic_selection_json, observed_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

export const INSERT_ENTRY_SELECTION_SQL = `
INSERT INTO observation_entry_selections (
  selection_id, batch_id, setup_id, policy_version, revision,
  candidate_ids_considered_json, canonical_candidate_id,
  canonical_evidence_id, canonical_model, reason, fidelity,
  policy_action, action, effective_action_reason, evaluated_at_epoch
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

export const INSERT_ENTRY_EVALUATION_MEMBERS_SQL = `
INSERT INTO observation_entry_evaluation_members (
  selection_id, object_kind, object_id
)
SELECT
  json_extract(value, '$.selection_id'),
  json_extract(value, '$.object_kind'),
  json_extract(value, '$.object_id')
FROM json_each(?)
`;

export const INSERT_ENTRY_PARITY_SQL = `
INSERT INTO observation_entry_parity (
  parity_id, batch_id, setup_id, producer_diagnostic_id, selection_id,
  parity_status, mismatch_reason, compared_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`;

export const INSERT_ENTRY_QUARANTINE_SQL = `
INSERT INTO observation_entry_quarantine (
  quarantine_id, receipt_id, batch_id, producer_instance_id,
  producer_sequence, presented_bar_close_epoch, object_kind, object_id,
  existing_sha256, presented_sha256, reason, quarantined_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

export const INSERT_ENTRY_SOURCE_CLAIM_SQL = `
INSERT INTO observation_entry_source_claims (
  claim_id, contract_version, source_id, youtube_video_id, published_date,
  title_snapshot, channel_id, channel_handle, timestamp_start_seconds,
  timestamp_end_seconds, relationship, summary
) VALUES (?, '2.0.0', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

export const INSERT_ENTRY_SOURCE_RELATIONSHIP_SQL = `
INSERT INTO observation_entry_source_claim_relationships (
  claim_id, target_claim_id
) VALUES (?, ?)
`;
