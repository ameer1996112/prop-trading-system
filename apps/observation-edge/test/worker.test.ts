import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { handleRequest } from "../src/index";
import {
  INSERT_RECEIPT_SQL,
  INSERT_SETUP_EVIDENCE_SQL,
  LIST_RECEIPTS_SQL,
  LIST_SETUP_EVIDENCE_SQL,
  SELECT_RECEIPT_SQL,
} from "../src/queries";
import type {
  Env,
  StoredEntryCandidate,
  StoredEntryCandidateEvidence,
  StoredEntryEvaluationMember,
  StoredEntryHandling,
  StoredEntryParity,
  StoredEntrySelection,
  StoredEntrySetupEvent,
  StoredEntrySetupTerminal,
  StoredEntrySourceClaim,
  StoredMarketBarHeartbeat,
  StoredProducerDiagnostic,
  StoredReceipt,
  StoredSetupEvidence,
} from "../src/types";

const CREDENTIAL = "edge-test-secret";
const BASE_URL = "https://prop-trading-observation-edge.example";
const ENTRY_STORAGE_TABLES = [
  "observation_entry_batches",
  "observation_market_bar_heartbeats",
  "observation_entry_chunks",
  "observation_entry_batch_completions",
  "observation_entry_setup_events",
  "observation_entry_setup_terminals",
  "observation_entry_candidates",
  "observation_entry_candidate_evidence",
  "observation_entry_handling",
  "observation_entry_producer_diagnostics",
  "observation_entry_selections",
  "observation_entry_evaluation_members",
  "observation_entry_parity",
  "observation_entry_source_claims",
  "observation_entry_source_claim_relationships",
  "observation_entry_quarantine",
] as const;

const ENTRY_STORAGE_IDS = {
  batch: "b".repeat(64),
  candidate: "c".repeat(64),
  completion: "d".repeat(64),
  evidence: "e".repeat(64),
  event: "a".repeat(64),
  handling: "f".repeat(64),
  parity: "2".repeat(64),
  payload: "9".repeat(64),
  selection: "1".repeat(64),
} as const;

const ENTRY_STORAGE_ROW_TYPE_FIXTURES = {
  candidate: {
    candidate_id: ENTRY_STORAGE_IDS.candidate,
    setup_id: "setup-entry-storage",
    model: "DIR_CLOSE",
    state: "MATCHED",
    event_anchor_epoch: 1721808300,
    trigger_ordinal: 1,
    direction: "LONG",
    source_claim_ids_json: '["standard-close-2024-03"]',
    normalized_from: null,
    identity_sha256: ENTRY_STORAGE_IDS.candidate,
    first_receipt_id: "receipt-entry-storage-v3",
    observed_at_epoch: 1721808300,
  } satisfies StoredEntryCandidate,
  evidence: {
    evidence_id: ENTRY_STORAGE_IDS.evidence,
    candidate_id: ENTRY_STORAGE_IDS.candidate,
    receipt_id: "receipt-entry-storage-v3",
    observed_trigger_epoch: 1721808300,
    observed_trigger_ticks: 110000,
    htf_context_minutes_json: "[]",
    fidelity: "EXACT",
    proof_plane: "CONFIRMED_5M",
    proof_resolution_seconds: 300,
    coverage_start_epoch: 1721808000,
    coverage_end_epoch: 1721808300,
    ambiguity_codes_json: "[]",
    passed_rule_ids_json: '["ENTRY_DIR_CLOSE"]',
    failed_rule_ids_json: "[]",
    source_claim_ids_json: '["standard-close-2024-03"]',
    payload_sha256: ENTRY_STORAGE_IDS.payload,
    identity_sha256: ENTRY_STORAGE_IDS.evidence,
    observed_at_epoch: 1721808300,
  } satisfies StoredEntryCandidateEvidence,
  evaluationMember: {
    selection_id: ENTRY_STORAGE_IDS.selection,
    object_kind: "CANDIDATE",
    object_id: ENTRY_STORAGE_IDS.candidate,
  } satisfies StoredEntryEvaluationMember,
  handling: {
    handling_id: ENTRY_STORAGE_IDS.handling,
    candidate_id: ENTRY_STORAGE_IDS.candidate,
    evidence_id: ENTRY_STORAGE_IDS.evidence,
    receipt_id: "receipt-entry-storage-v3",
    handling_mode: "CLOSE_CONFIRMATION",
    attempt_kind: "INITIAL",
    observed_epoch: 1721808300,
    observed_ticks: 110000,
    fidelity: "EXACT",
    source_claim_ids_json: '["standard-close-2024-03"]',
    identity_sha256: ENTRY_STORAGE_IDS.handling,
  } satisfies StoredEntryHandling,
  heartbeat: {
    receipt_id: "receipt-entry-storage-v3",
    batch_id: ENTRY_STORAGE_IDS.batch,
    schema_version: "2.0",
    producer_role: "ENTRY_V3_CANARY",
    producer_instance_id: "entry-v3-canary-producer",
    producer_sequence: 1,
    strategy_version: "2.0.0-contract2",
    symbol: "EURUSD",
    ticker_id: "VANTAGE:EURUSD",
    feed: "VANTAGE",
    timeframe: "5",
    bar_open_epoch: 1721808000,
    bar_close_epoch: 1721808300,
    detector_code_hash: "3".repeat(64),
    settings_hash: "4".repeat(64),
    recorded_at: "2026-07-24T10:00:00Z",
  } satisfies StoredMarketBarHeartbeat,
  parity: {
    parity_id: ENTRY_STORAGE_IDS.parity,
    batch_id: ENTRY_STORAGE_IDS.batch,
    setup_id: "setup-entry-storage",
    producer_diagnostic_id: "diagnostic-entry-storage",
    selection_id: ENTRY_STORAGE_IDS.selection,
    parity_status: "MISMATCH",
    mismatch_reason: "DIAGNOSTIC_ACTION",
    compared_at: "2026-07-24T10:00:03Z",
  } satisfies StoredEntryParity,
  producerDiagnostic: {
    diagnostic_id: "diagnostic-entry-storage",
    batch_id: ENTRY_STORAGE_IDS.batch,
    setup_id: "setup-entry-storage",
    candidate_refs_json: "[]",
    evidence_refs_json: "[]",
    realtime_evidence_refs_json: "[]",
    handling_refs_json: "[]",
    diagnostic_selection_json: null,
    observed_at: "2026-07-24T10:00:00Z",
  } satisfies StoredProducerDiagnostic,
  selection: {
    selection_id: ENTRY_STORAGE_IDS.selection,
    batch_id: ENTRY_STORAGE_IDS.batch,
    setup_id: "setup-entry-storage",
    policy_version: "rd-entry-arbitration-v2",
    revision: 1,
    candidate_ids_considered_json: JSON.stringify([
      ENTRY_STORAGE_IDS.candidate,
    ]),
    canonical_candidate_id: ENTRY_STORAGE_IDS.candidate,
    canonical_evidence_id: ENTRY_STORAGE_IDS.evidence,
    canonical_model: "DIR_CLOSE",
    reason: "ONLY_EXACT_TRIGGER",
    fidelity: "EXACT",
    policy_action: "PAPER_ELIGIBLE",
    action: "SHADOW_ONLY",
    effective_action_reason: "PROMOTION_IDENTITY_MISMATCH",
    evaluated_at_epoch: 1721808300,
  } satisfies StoredEntrySelection,
  setupEvent: {
    event_id: ENTRY_STORAGE_IDS.event,
    setup_id: "setup-entry-storage",
    batch_id: ENTRY_STORAGE_IDS.batch,
    receipt_id: "receipt-entry-storage-v3",
    confirmed_bar_close_epoch: 1721808300,
    proof_input_sha256: ENTRY_STORAGE_IDS.payload,
    proof_input_json: '{"confirmed_bar":{"close_epoch":1721808300}}',
    recorded_at: "2026-07-24T10:00:00Z",
  } satisfies StoredEntrySetupEvent,
  setupTerminal: {
    setup_id: "setup-entry-storage",
    terminal_reason: "BOTH_ACTIVE_MODELS_OBSERVED",
    terminal_epoch: 1721808300,
    first_batch_id: ENTRY_STORAGE_IDS.batch,
    first_receipt_id: "receipt-entry-storage-v3",
    recorded_at: "2026-07-24T10:00:02Z",
  } satisfies StoredEntrySetupTerminal,
  sourceClaim: {
    claim_id: "standard-close-2024-03",
    contract_version: "2.0.0",
    source_id: "rd-course-2024-03",
    youtube_video_id: "kxh_3__oAqg",
    published_date: "2024-03-25",
    title_snapshot:
      "FULL course for LIQUIDITY supply and demand best NEW trading strategy 2026",
    channel_id: "UC54xbL96tU58iez3YbTVTAg",
    channel_handle: "@RD_Forex",
    timestamp_start_seconds: 794,
    timestamp_end_seconds: 876,
    relationship: "SUPPORTS",
    summary: "Official claim covering the standard close entry model.",
  } satisfies StoredEntrySourceClaim,
} as const;

function applyObservationMigrationsThrough(
  database: DatabaseSync,
  root: string,
  lastMigration: number,
): void {
  const migrations = readdirSync(`${root}/migrations`)
    .filter((name) => /^\d{4}_.*\.sql$/u.test(name))
    .filter((name) => Number(name.slice(0, 4)) <= lastMigration)
    .sort();
  expect(migrations.at(-1)?.slice(0, 4)).toBe(
    String(lastMigration).padStart(4, "0"),
  );
  for (const migration of migrations) {
    database.exec("BEGIN");
    try {
      database.exec(readFileSync(`${root}/migrations/${migration}`, "utf8"));
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
}

function insertEntryStorageReceipt(
  database: DatabaseSync,
  fields: {
    readonly receiptId: string;
    readonly schemaVersion: "1.2" | "2.0";
    readonly strategyVersion: "1.2.0-contract1" | "2.0.0-contract2";
    readonly producerInstanceId: string;
    readonly sequence: number;
    readonly payloadSha256?: string;
    readonly symbol?: string;
    readonly tickerId?: string;
    readonly feed?: string;
    readonly kind?: "incremental" | "snapshot";
  },
): void {
  database
    .prepare(
      `INSERT INTO observation_receipts (
        receipt_id, received_at, idempotency_key, payload_sha256,
        schema_version, strategy_id, strategy_version, producer_instance_id,
        sequence, symbol, ticker_id, feed, timeframe, kind
      ) VALUES (
        ?, '2026-07-24T10:00:00Z', ?, ?,
        ?, 'rd_liquidity_sd_5m_v1', ?, ?,
        ?, ?, ?, ?, '5', ?
      )`,
    )
    .run(
      fields.receiptId,
      `entry-storage:${fields.receiptId}`,
      fields.payloadSha256 ?? ENTRY_STORAGE_IDS.payload,
      fields.schemaVersion,
      fields.strategyVersion,
      fields.producerInstanceId,
      fields.sequence,
      fields.symbol ?? "EURUSD",
      fields.tickerId ?? "VANTAGE:EURUSD",
      fields.feed ?? "VANTAGE",
      fields.kind ?? "snapshot",
    );
}

function seedEntryStorage(database: DatabaseSync): void {
  insertEntryStorageReceipt(database, {
    receiptId: "receipt-entry-storage-legacy",
    schemaVersion: "1.2",
    strategyVersion: "1.2.0-contract1",
    producerInstanceId: "legacy-reference-producer",
    sequence: 0,
    payloadSha256: "A".repeat(64),
  });
  insertEntryStorageReceipt(database, {
    receiptId: "receipt-entry-storage-v3",
    schemaVersion: "2.0",
    strategyVersion: "2.0.0-contract2",
    producerInstanceId: "entry-v3-canary-producer",
    sequence: 1,
  });

  database
    .prepare(
      `INSERT INTO observation_entry_batches (
        batch_id, producer_instance_id, producer_sequence, kind,
        bar_close_epoch, strategy_id, strategy_version, rule_contract_version,
        execution_mode, symbol, ticker_id, feed, timeframe, tick_size,
        bar_open_epoch, detector_code_hash, settings_hash, chunk_count,
        first_receipt_id, first_seen_at
      ) VALUES (
        ?, 'entry-v3-canary-producer', 1, 'snapshot',
        1721808300, 'rd_liquidity_sd_5m_v1', '2.0.0-contract2', '2.0.0',
        'OBSERVATION_ONLY', 'EURUSD', 'VANTAGE:EURUSD', 'VANTAGE', '5', '0.00001',
        1721808000, ?, ?, 1, 'receipt-entry-storage-v3',
        '2026-07-24T10:00:00Z'
      )`,
    )
    .run(ENTRY_STORAGE_IDS.batch, "3".repeat(64), "4".repeat(64));
  database
    .prepare(
      `INSERT INTO observation_market_bar_heartbeats (
        receipt_id, batch_id, schema_version, producer_role,
        producer_instance_id, producer_sequence, strategy_version,
        symbol, ticker_id, feed, timeframe, bar_open_epoch, bar_close_epoch,
        detector_code_hash, settings_hash, recorded_at
      ) VALUES (
        'receipt-entry-storage-legacy', NULL, '1.2', 'LEGACY_REFERENCE',
        'legacy-reference-producer', 0, '1.2.0-contract1',
        'EURUSD', 'VANTAGE:EURUSD', 'VANTAGE', '5',
        1721808000, 1721808300, NULL, NULL, '2026-07-24T10:00:00Z'
      )`,
    )
    .run();
  database
    .prepare(
      `INSERT INTO observation_market_bar_heartbeats (
        receipt_id, batch_id, schema_version, producer_role,
        producer_instance_id, producer_sequence, strategy_version,
        symbol, ticker_id, feed, timeframe, bar_open_epoch, bar_close_epoch,
        detector_code_hash, settings_hash, recorded_at
      ) VALUES (
        'receipt-entry-storage-v3', ?, '2.0', 'ENTRY_V3_CANARY',
        'entry-v3-canary-producer', 1, '2.0.0-contract2',
        'EURUSD', 'VANTAGE:EURUSD', 'VANTAGE', '5',
        1721808000, 1721808300, ?, ?, '2026-07-24T10:00:00Z'
      )`,
    )
    .run(ENTRY_STORAGE_IDS.batch, "3".repeat(64), "4".repeat(64));
  database
    .prepare(
      `INSERT INTO observation_entry_chunks (
        batch_id, chunk_index, chunk_count, receipt_id, payload_sha256,
        validated_payload_json, recorded_at
      ) VALUES (?, 0, 1, 'receipt-entry-storage-v3', ?, '{"eb":[]}',
        '2026-07-24T10:00:00Z')`,
    )
    .run(ENTRY_STORAGE_IDS.batch, ENTRY_STORAGE_IDS.payload);
  database
    .prepare(
      `INSERT INTO observation_entry_batch_completions (
        completion_id, batch_id, assembled_payload_sha256, completed_at
      ) VALUES (?, ?, ?, '2026-07-24T10:00:01Z')`,
    )
    .run(
      ENTRY_STORAGE_IDS.completion,
      ENTRY_STORAGE_IDS.batch,
      ENTRY_STORAGE_IDS.payload,
    );
  database
    .prepare(
      `INSERT INTO observation_entry_setup_events (
        event_id, setup_id, batch_id, receipt_id, confirmed_bar_close_epoch,
        proof_input_sha256, proof_input_json, recorded_at
      ) VALUES (
        ?, 'setup-entry-storage', ?, 'receipt-entry-storage-v3', 1721808300,
        ?, '{"confirmed_bar":{"close_epoch":1721808300}}',
        '2026-07-24T10:00:00Z'
      )`,
    )
    .run(
      ENTRY_STORAGE_IDS.event,
      ENTRY_STORAGE_IDS.batch,
      ENTRY_STORAGE_IDS.payload,
    );
  database
    .prepare(
      `INSERT INTO observation_entry_setup_terminals (
        setup_id, terminal_reason, terminal_epoch, first_batch_id,
        first_receipt_id, recorded_at
      ) VALUES (
        'setup-entry-storage', 'BOTH_ACTIVE_MODELS_OBSERVED', 1721808300, ?,
        'receipt-entry-storage-v3', '2026-07-24T10:00:02Z'
      )`,
    )
    .run(ENTRY_STORAGE_IDS.batch);
  database
    .prepare(
      `INSERT INTO observation_entry_source_claims (
        claim_id, contract_version, source_id, youtube_video_id, published_date,
        title_snapshot, channel_id, channel_handle, timestamp_start_seconds,
        timestamp_end_seconds, relationship, summary
      ) VALUES (
        'standard-close-2024-03', '2.0.0', 'rd-course-2024-03',
        'kxh_3__oAqg', '2024-03-25',
        'FULL course for LIQUIDITY supply and demand best NEW trading strategy 2026',
        'UC54xbL96tU58iez3YbTVTAg', '@RD_Forex', 794, 876, 'SUPPORTS',
        'Official claim covering the standard close entry model.'
      )`,
    )
    .run();
  database
    .prepare(
      `INSERT INTO observation_entry_source_claims (
        claim_id, contract_version, source_id, youtube_video_id, published_date,
        title_snapshot, channel_id, channel_handle, timestamp_start_seconds,
        timestamp_end_seconds, relationship, summary
      ) VALUES (
        'closure-or-flip-2025-03', '2.0.0', 'rd-first-5m-live-2025-03',
        'Gr0njSOtC10', '2025-03-20',
        'First 5m livestream (1 win 1 loss) 1:2.5r trade on gj',
        'UC54xbL96tU58iez3YbTVTAg', '@RD_Forex', 3106, 3149, 'NARROWS',
        'Official narrowing claim for close-or-flip selection.'
      )`,
    )
    .run();
  database
    .prepare(
      `INSERT INTO observation_entry_source_claim_relationships (
        claim_id, target_claim_id
      ) VALUES ('closure-or-flip-2025-03', 'standard-close-2024-03')`,
    )
    .run();
  database
    .prepare(
      `INSERT INTO observation_entry_candidates (
        candidate_id, setup_id, model, state, event_anchor_epoch,
        trigger_ordinal, direction, source_claim_ids_json, normalized_from,
        identity_sha256, first_receipt_id, observed_at_epoch
      ) VALUES (
        ?, 'setup-entry-storage', 'DIR_CLOSE', 'MATCHED', 1721808300,
        1, 'LONG', '["standard-close-2024-03"]', NULL,
        ?, 'receipt-entry-storage-v3', 1721808300
      )`,
    )
    .run(ENTRY_STORAGE_IDS.candidate, ENTRY_STORAGE_IDS.candidate);
  database
    .prepare(
      `INSERT INTO observation_entry_candidate_evidence (
        evidence_id, candidate_id, receipt_id, observed_trigger_epoch,
        observed_trigger_ticks, htf_context_minutes_json, fidelity, proof_plane,
        proof_resolution_seconds, coverage_start_epoch, coverage_end_epoch,
        ambiguity_codes_json, passed_rule_ids_json, failed_rule_ids_json,
        source_claim_ids_json, payload_sha256, identity_sha256, observed_at_epoch
      ) VALUES (
        ?, ?, 'receipt-entry-storage-v3', 1721808300, 110000,
        '[]', 'EXACT', 'CONFIRMED_5M', 300, 1721808000, 1721808300,
        '[]', '["ENTRY_DIR_CLOSE"]', '[]', '["standard-close-2024-03"]',
        ?, ?, 1721808300
      )`,
    )
    .run(
      ENTRY_STORAGE_IDS.evidence,
      ENTRY_STORAGE_IDS.candidate,
      ENTRY_STORAGE_IDS.payload,
      ENTRY_STORAGE_IDS.evidence,
    );
  database
    .prepare(
      `INSERT INTO observation_entry_handling (
        handling_id, candidate_id, evidence_id, receipt_id, handling_mode,
        attempt_kind, observed_epoch, observed_ticks, fidelity,
        source_claim_ids_json, identity_sha256
      ) VALUES (
        ?, ?, ?, 'receipt-entry-storage-v3', 'CLOSE_CONFIRMATION',
        'INITIAL', 1721808300, 110000, 'EXACT',
        '["standard-close-2024-03"]', ?
      )`,
    )
    .run(
      ENTRY_STORAGE_IDS.handling,
      ENTRY_STORAGE_IDS.candidate,
      ENTRY_STORAGE_IDS.evidence,
      ENTRY_STORAGE_IDS.handling,
    );
  database
    .prepare(
      `INSERT INTO observation_entry_producer_diagnostics (
        diagnostic_id, batch_id, setup_id, candidate_refs_json,
        evidence_refs_json, realtime_evidence_refs_json, handling_refs_json,
        diagnostic_selection_json, observed_at
      ) VALUES (
        'diagnostic-entry-storage', ?, 'setup-entry-storage',
        '[{"model":"DIR_CLOSE"}]', '[{"proof_plane":"CONFIRMED_5M"}]',
        '[{"proof_plane":"REALTIME_TICK","proof_resolution_seconds":0,
           "observed_trigger_epoch":1721808300,
           "coverage_start_epoch":1721808300,
           "coverage_end_epoch":1721808300}]',
        '[{"handling_mode":"CLOSE_CONFIRMATION"}]',
        '{"version":"PINE_DIAGNOSTIC_ONLY","action":"SHADOW_ONLY"}',
        '2026-07-24T10:00:00Z'
      )`,
    )
    .run(ENTRY_STORAGE_IDS.batch);
  database
    .prepare(
      `INSERT INTO observation_entry_selections (
        selection_id, batch_id, setup_id, policy_version, revision,
        candidate_ids_considered_json, canonical_candidate_id,
        canonical_evidence_id, canonical_model, reason, fidelity,
        policy_action, action, effective_action_reason, evaluated_at_epoch
      ) VALUES (
        ?, ?, 'setup-entry-storage', 'rd-entry-arbitration-v2', 1,
        ?, ?, ?, 'DIR_CLOSE', 'ONLY_EXACT_TRIGGER', 'EXACT',
        'PAPER_ELIGIBLE', 'SHADOW_ONLY', 'PROMOTION_IDENTITY_MISMATCH',
        1721808300
      )`,
    )
    .run(
      ENTRY_STORAGE_IDS.selection,
      ENTRY_STORAGE_IDS.batch,
      JSON.stringify([ENTRY_STORAGE_IDS.candidate]),
      ENTRY_STORAGE_IDS.candidate,
      ENTRY_STORAGE_IDS.evidence,
    );
  database
    .prepare(
      `INSERT INTO observation_entry_evaluation_members (
        selection_id, object_kind, object_id
      ) VALUES (?, 'CANDIDATE', ?)`,
    )
    .run(ENTRY_STORAGE_IDS.selection, ENTRY_STORAGE_IDS.candidate);
  database
    .prepare(
      `INSERT INTO observation_entry_parity (
        parity_id, batch_id, setup_id, producer_diagnostic_id, selection_id,
        parity_status, mismatch_reason, compared_at
      ) VALUES (
        ?, ?, 'setup-entry-storage', 'diagnostic-entry-storage', ?,
        'MISMATCH', 'DIAGNOSTIC_ACTION', '2026-07-24T10:00:03Z'
      )`,
    )
    .run(
      ENTRY_STORAGE_IDS.parity,
      ENTRY_STORAGE_IDS.batch,
      ENTRY_STORAGE_IDS.selection,
    );
  database
    .prepare(
      `INSERT INTO observation_entry_quarantine (
        quarantine_id, receipt_id, batch_id, producer_instance_id,
        producer_sequence, presented_bar_close_epoch, object_kind, object_id,
        existing_sha256, presented_sha256, reason, quarantined_at
      ) VALUES (
        'quarantine-entry-storage', 'receipt-entry-storage-v3', ?,
        NULL, NULL, NULL, 'CANDIDATE', ?, ?, ?,
        'IMMUTABLE_ID_CONFLICT', '2026-07-24T10:00:04Z'
      )`,
    )
    .run(
      ENTRY_STORAGE_IDS.batch,
      ENTRY_STORAGE_IDS.candidate,
      ENTRY_STORAGE_IDS.candidate,
      ENTRY_STORAGE_IDS.payload,
    );
}

function seedAlternateEntryOwnership(database: DatabaseSync): void {
  database
    .prepare(
      `INSERT INTO observation_entry_candidates (
        candidate_id, setup_id, model, state, event_anchor_epoch,
        trigger_ordinal, direction, source_claim_ids_json, normalized_from,
        identity_sha256, first_receipt_id, observed_at_epoch
      ) VALUES (
        ?, 'setup-entry-storage-other', 'HTF_FLIP', 'MATCHED', 1721808300,
        1, 'LONG', '["standard-close-2024-03"]', NULL,
        ?, 'receipt-entry-storage-v3', 1721808300
      )`,
    )
    .run("5".repeat(64), "5".repeat(64));
  database
    .prepare(
      `INSERT INTO observation_entry_candidate_evidence (
        evidence_id, candidate_id, receipt_id, observed_trigger_epoch,
        observed_trigger_ticks, htf_context_minutes_json, fidelity, proof_plane,
        proof_resolution_seconds, coverage_start_epoch, coverage_end_epoch,
        ambiguity_codes_json, passed_rule_ids_json, failed_rule_ids_json,
        source_claim_ids_json, payload_sha256, identity_sha256, observed_at_epoch
      ) VALUES (
        ?, ?, 'receipt-entry-storage-v3', 1721808300, 110000,
        '[15]', 'EXACT', 'LOWER_TIMEFRAME_REPLAY', 60,
        1721808000, 1721808300, '[]', '["ENTRY_HTF_FLIP"]', '[]',
        '["standard-close-2024-03"]', ?, ?, 1721808300
      )`,
    )
    .run(
      "6".repeat(64),
      "5".repeat(64),
      ENTRY_STORAGE_IDS.payload,
      "6".repeat(64),
    );
  database
    .prepare(
      `INSERT INTO observation_entry_handling (
        handling_id, candidate_id, evidence_id, receipt_id, handling_mode,
        attempt_kind, observed_epoch, observed_ticks, fidelity,
        source_claim_ids_json, identity_sha256
      ) VALUES (
        ?, ?, ?, 'receipt-entry-storage-v3', 'INTRABAR_FLIP',
        'INITIAL', 1721808300, 110000, 'EXACT',
        '["standard-close-2024-03"]', ?
      )`,
    )
    .run("7".repeat(64), "5".repeat(64), "6".repeat(64), "7".repeat(64));
}

class FakeStatement {
  private values: unknown[] = [];

  constructor(
    private readonly database: FakeD1,
    private readonly sql: string,
  ) {}

  bind(...values: unknown[]): FakeStatement {
    this.values = values;
    return this;
  }

  async run(): Promise<D1Result> {
    if (this.sql === INSERT_RECEIPT_SQL) {
      const record: StoredReceipt = {
        receipt_id: String(this.values[0]),
        received_at: String(this.values[1]),
        idempotency_key: String(this.values[2]),
        payload_sha256: String(this.values[3]),
        schema_version: String(this.values[4]) as StoredReceipt["schema_version"],
        strategy_id: String(this.values[5]) as "rd_liquidity_sd_5m_v1",
        strategy_version: String(this.values[6]) as StoredReceipt["strategy_version"],
        producer_instance_id: String(this.values[7]),
        sequence: Number(this.values[8]),
        symbol: String(this.values[9]),
        ticker_id: String(this.values[10]),
        feed: String(this.values[11]),
        timeframe: String(this.values[12]) as "5",
        kind: String(this.values[13]) as "incremental" | "snapshot",
      };
      if (this.database.records.has(record.idempotency_key)) {
        throw new Error(
          "D1_ERROR: UNIQUE constraint failed: observation_receipts.idempotency_key",
        );
      }
      this.database.records.set(record.idempotency_key, record);
      return {
        success: true,
        results: [],
        meta: { changes: 1 },
      } as unknown as D1Result;
    }
    if (this.sql === INSERT_SETUP_EVIDENCE_SQL) {
      if (this.database.failEvidenceWrites) {
        throw new Error("D1_ERROR: injected evidence failure");
      }
      const receiptId = String(this.values[0]);
      const recordedAt = String(this.values[1]);
      const rows = JSON.parse(String(this.values[2])) as Record<string, unknown>[];
      for (const row of rows) {
        const nullableNumber = (value: unknown): number | null =>
          value === null ? null : Number(value);
        const record: StoredSetupEvidence = {
          evidence_id: String(row.evidenceId),
          receipt_id: receiptId,
          recorded_at: recordedAt,
          event_index: Number(row.eventIndex),
          event_kind: String(row.eventKind) as StoredSetupEvidence["event_kind"],
          symbol: String(row.symbol),
          side: String(row.side) as StoredSetupEvidence["side"],
          zone_key: String(row.zoneKey),
          liquidity_key: String(row.liquidityKey),
          formation_bar_close_epoch: Number(row.formationBarCloseEpoch),
          from_state:
            row.fromState === null ? null : String(row.fromState),
          to_state: String(row.toState),
          reason_code: String(row.reasonCode),
          decision: String(row.decision) as StoredSetupEvidence["decision"],
          entry_model:
            row.entryModel === null
              ? null
              : (String(row.entryModel) as StoredSetupEvidence["entry_model"]),
          rule_passes_json: String(row.rulePassesJson),
          liquidity_formed_epoch: nullableNumber(row.liquidityFormedEpoch),
          own_extreme_broken_epoch: nullableNumber(row.ownExtremeBrokenEpoch),
          liquidity_swept_epoch: nullableNumber(row.liquiditySweptEpoch),
          zone_engaged_epoch: nullableNumber(row.zoneEngagedEpoch),
          entry_confirmed_epoch: nullableNumber(row.entryConfirmedEpoch),
          zone_top: String(row.zoneTop),
          zone_bottom: String(row.zoneBottom),
          zone_origin_open_epoch: Number(row.zoneOriginOpenEpoch),
          zone_origin_close_epoch: Number(row.zoneOriginCloseEpoch),
          liquidity_price: String(row.liquidityPrice),
          liquidity_origin_open_epoch: Number(row.liquidityOriginOpenEpoch),
          liquidity_origin_close_epoch: Number(row.liquidityOriginCloseEpoch),
          source_open_epoch: Number(row.sourceOpenEpoch),
          source_close_epoch: Number(row.sourceCloseEpoch),
          source_open: String(row.sourceOpen),
          source_high: String(row.sourceHigh),
          source_low: String(row.sourceLow),
          source_close: String(row.sourceClose),
        };
        const receiptExists = [...this.database.records.values()].some(
          (receipt) => receipt.receipt_id === record.receipt_id,
        );
        if (!receiptExists) {
          throw new Error("D1_ERROR: FOREIGN KEY constraint failed");
        }
        const duplicate = [...this.database.evidence.values()].some(
          (existing) =>
            existing.receipt_id === record.receipt_id &&
            existing.event_kind === record.event_kind &&
            existing.event_index === record.event_index,
        );
        if (duplicate) {
          throw new Error(
            "D1_ERROR: UNIQUE constraint failed: observation_setup_evidence",
          );
        }
        this.database.evidence.set(record.evidence_id, record);
      }
      return {
        success: true,
        results: [],
        meta: { changes: rows.length },
      } as unknown as D1Result;
    }
    throw new Error("unexpected run statement");
  }

  async first<T>(): Promise<T | null> {
    if (!this.sql.includes("WHERE idempotency_key = ?")) {
      throw new Error("unexpected first statement");
    }
    return (
      (this.database.records.get(String(this.values[0])) as T | undefined) ?? null
    );
  }

  async all<T>(): Promise<D1Result<T>> {
    const limit = Number(this.values[0]);
    let results: T[];
    if (this.sql === LIST_RECEIPTS_SQL) {
      results = [...this.database.records.values()]
        .sort((left, right) => {
          const byTime = right.received_at.localeCompare(left.received_at);
          return byTime !== 0
            ? byTime
            : right.receipt_id.localeCompare(left.receipt_id);
        })
        .slice(0, limit) as T[];
    } else if (this.sql === LIST_SETUP_EVIDENCE_SQL) {
      results = [...this.database.evidence.values()]
        .sort((left, right) => {
          const byTime = right.recorded_at.localeCompare(left.recorded_at);
          return byTime !== 0
            ? byTime
            : right.evidence_id.localeCompare(left.evidence_id);
        })
        .slice(0, limit) as T[];
    } else {
      throw new Error("unexpected all statement");
    }
    return {
      success: true,
      results,
      meta: {},
    } as unknown as D1Result<T>;
  }
}

class FakeD1 {
  readonly records = new Map<string, StoredReceipt>();
  readonly evidence = new Map<string, StoredSetupEvidence>();
  readonly preparedSql: string[] = [];

  constructor(readonly failEvidenceWrites = false) {}

  prepare(sql: string): FakeStatement {
    this.preparedSql.push(sql);
    return new FakeStatement(this, sql);
  }

  async batch(statements: D1PreparedStatement[]): Promise<D1Result[]> {
    const receiptSnapshot = new Map(this.records);
    const evidenceSnapshot = new Map(this.evidence);
    try {
      const results: D1Result[] = [];
      for (const statement of statements) {
        results.push(await (statement as unknown as FakeStatement).run());
      }
      return results;
    } catch (error) {
      this.records.clear();
      this.evidence.clear();
      for (const [key, value] of receiptSnapshot) {
        this.records.set(key, value);
      }
      for (const [key, value] of evidenceSnapshot) {
        this.evidence.set(key, value);
      }
      throw error;
    }
  }
}

class FailingD1 {
  prepare(): never {
    throw new Error("D1 unavailable");
  }
}

async function sha256(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function environment(
  database: FakeD1 | FailingD1 = new FakeD1(),
  overrides: Partial<Env> = {},
): Promise<Env> {
  return {
    DB: database as unknown as D1Database,
    TRADINGVIEW_OBSERVATION_INGRESS_ENABLED: "true",
    TRADINGVIEW_OBSERVATION_CREDENTIAL_SHA256: await sha256(CREDENTIAL),
    TRADINGVIEW_OBSERVATION_MAX_BODY_BYTES: "262144",
    ...overrides,
  };
}

function incrementalPayload(): Record<string, unknown> {
  return {
    schema_version: "1.0",
    strategy_id: "rd_liquidity_sd_5m_v1",
    strategy_version: "1.0.0-phase1",
    producer_instance_id: "pine-lab-01",
    sequence: 1,
    idempotency_key: "pine-lab-01:1",
    symbol: "XAUUSD",
    ticker_id: "OANDA:XAUUSD",
    feed: "OANDA",
    timeframe: "5",
    timezone: "Etc/UTC",
    bar_open_epoch: 1_710_000_000_000,
    bar_close_epoch: 1_710_000_300_000,
    detector_code_hash: "a".repeat(64),
    settings_hash: "b".repeat(64),
    kind: "incremental",
    chunk_index: 0,
    chunk_count: 1,
    transitions: [
      {
        transition_index: 0,
        natural_key: {
          side: "DEMAND",
          zone_key: "demand|1710000000000",
          liquidity_key: "swing-low|1709999700000",
          formation_bar_close_epoch: 1_710_000_000_000,
        },
        from_state: null,
        to_state: "WAITING_FOR_ELIGIBILITY",
        reason_code: "WAIT_SETUP_ELIGIBILITY",
        zone: {
          top: 2_150.25,
          bottom: 2_149.75,
          origin_bar_open_epoch: 1_709_999_700_000,
          origin_bar_close_epoch: 1_710_000_000_000,
        },
        liquidity: {
          price: 2_149.5,
          origin_bar_open_epoch: 1_709_999_700_000,
          origin_bar_close_epoch: 1_710_000_000_000,
        },
        source_candle: {
          open_epoch: 1_710_000_000_000,
          close_epoch: 1_710_000_300_000,
          open: 2_150,
          high: 2_151,
          low: 2_149.5,
          close: 2_150.5,
        },
      },
    ],
  };
}

const CONTRACT_OPEN_RULES = [
  ["ZONE_ORIGIN_OPPOSITE_CANDLE", "EXACT"],
  ["ZONE_ACCURACY_BOUNDS", "UNRESOLVED"],
  ["ZONE_FRESH_UNTAPPED", "EXACT"],
  ["ZONE_FIRST_ENGAGEMENT", "EXACT"],
  ["ZONE_PRE_ENTRY_CLOSE_OUTSIDE", "EXACT"],
  ["LIQ_NORMAL_TWO_OPPOSITE_CANDLES", "EXACT"],
  ["LIQ_ONE_CANDLE_EXCEPTION", "DISCRETIONARY"],
  ["LIQ_OWN_EXTREME_SAME_LEG", "EXACT"],
  ["LIQ_STRICT_OWN_EXTREME_BREAK", "EXACT"],
  ["LIQ_ACTUAL_EXTREME_SWEPT", "EXACT"],
  ["LIQ_EVENT_ORDER", "EXACT"],
  ["LIQ_INTERNAL_REBREAK", "CALIBRATED"],
  ["LIQ_DISTANCE_INFLUENCES_ZONE", "DISCRETIONARY"],
  ["LIQ_REPLACEMENT_AFTER_STALE_MOVE", "DISCRETIONARY"],
  ["LIQ_MULTIPLE_CANDIDATE_ARBITRATION", "UNRESOLVED"],
  ["ENTRY_DIR_CLOSE", "EXACT"],
  ["ENTRY_HTF_FLIP", "EXACT"],
  ["ENTRY_HTF_BOUNDARY_CAUTION", "DISCRETIONARY"],
  ["MANAGEMENT_STOP_TRIGGER_CANDLE", "UNRESOLVED"],
  ["MANAGEMENT_TP_BE_TABLE", "UNRESOLVED"],
  ["RISK_SESSION_PROFILE", "CALIBRATED"],
  ["TIMEFRAME_FIVE_MINUTE_ONLY", "EXACT"],
] as const;

function contractRuleEvidence(): Record<string, unknown> {
  return {
    decision: "WAIT",
    entry_model: "DIR_CLOSE",
    rule_passes: CONTRACT_OPEN_RULES.map(
      ([ruleId]) =>
        ruleId === "LIQ_EVENT_ORDER" ||
        ruleId === "TIMEFRAME_FIVE_MINUTE_ONLY",
    ),
    lifecycle: {
      liquidity_formed_epoch: 1_709_999_400_000,
      own_extreme_broken_epoch: 1_709_999_700_000,
      liquidity_swept_epoch: 1_710_000_000_000,
      zone_engaged_epoch: 1_710_000_100_000,
      entry_confirmed_epoch: null,
    },
  };
}

function contractIncrementalPayload(): Record<string, unknown> {
  const payload = incrementalPayload();
  payload.schema_version = "1.2";
  payload.strategy_version = "1.2.0-contract1";
  payload.rule_contract_version = "1.0.0";
  payload.execution_mode = "OBSERVATION_ONLY";
  payload.rule_catalog = CONTRACT_OPEN_RULES.map(([ruleId, fidelity]) => ({
    rule_id: ruleId,
    fidelity,
  }));
  const transition = (payload.transitions as Record<string, unknown>[])[0];
  if (transition !== undefined) {
    transition.rule_evidence = contractRuleEvidence();
  }
  return payload;
}

function entryV2Payload(): Record<string, unknown> {
  return {
    schema_version: "2.0",
    strategy_id: "rd_liquidity_sd_5m_v1",
    strategy_version: "2.0.0-contract2",
    rule_contract_version: "2.0.0",
    execution_mode: "OBSERVATION_ONLY",
    producer_instance_id: "pine-v3-worker",
    sequence: 1,
    idempotency_key: "pine-v3-worker:1:incremental:1721808300:0",
    symbol: "EURUSD",
    ticker_id: "OANDA:EURUSD",
    feed: "OANDA",
    timeframe: "5",
    tick_size: "0.00001",
    bar_open_epoch: 1_721_808_000,
    bar_close_epoch: 1_721_808_300,
    detector_code_hash: "a".repeat(64),
    settings_hash: "b".repeat(64),
    kind: "incremental",
    chunk_index: 0,
    chunk_count: 1,
    eb: [
      {
        s: "worker-setup",
        d: "LONG",
        f: {
          zb: 90,
          zt: 100,
          ge: 1_721_808_010,
          iv: false,
          cf: "EXACT",
          ak: "INITIAL",
          et: true,
          tr: null,
          te: null,
          ng: null,
          b: [
            {
              oe: 1_721_808_000,
              ce: 1_721_808_300,
              o: 99,
              h: 105,
              l: 95,
              c: 103,
              gb: false,
              rr: false,
            },
          ],
          x: [],
        },
        c: [],
        e: [],
        h: [],
        q: null,
      },
    ],
  };
}

function snapshotPayload(): Record<string, unknown> {
  const payload = incrementalPayload();
  delete payload.chunk_index;
  delete payload.chunk_count;
  delete payload.transitions;
  payload.sequence = 0;
  payload.idempotency_key = "pine-lab-01:0";
  payload.kind = "snapshot";
  payload.last_confirmed_bar_close_epoch = 1_710_000_300_000;
  payload.active_setups = [];
  return payload;
}

function contractSnapshotPayload(): Record<string, unknown> {
  const payload = contractIncrementalPayload();
  const transition = (
    payload.transitions as Record<string, unknown>[]
  )[0] as Record<string, unknown>;
  const evidence = transition.rule_evidence as Record<string, unknown>;
  const lifecycle = evidence.lifecycle as Record<string, unknown>;
  const rulePasses = evidence.rule_passes as boolean[];
  const eventOrderIndex = CONTRACT_OPEN_RULES.findIndex(
    ([ruleId]) => ruleId === "LIQ_EVENT_ORDER",
  );

  evidence.entry_model = null;
  lifecycle.liquidity_swept_epoch = null;
  lifecycle.zone_engaged_epoch = null;
  lifecycle.entry_confirmed_epoch = null;
  if (eventOrderIndex !== -1) {
    rulePasses[eventOrderIndex] = false;
  }

  delete payload.chunk_index;
  delete payload.chunk_count;
  delete payload.transitions;
  payload.sequence = 0;
  payload.idempotency_key = "pine-lab-01:0";
  payload.kind = "snapshot";
  payload.last_confirmed_bar_close_epoch = payload.bar_close_epoch;
  payload.active_setups = [
    {
      natural_key: transition.natural_key,
      state: "WAITING_FOR_ELIGIBILITY",
      reason_code: transition.reason_code,
      zone: transition.zone,
      liquidity: transition.liquidity,
      source_candle: transition.source_candle,
      rule_evidence: evidence,
    },
  ];
  return payload;
}

function postBody(payload: Record<string, unknown>, credential = CREDENTIAL): Request {
  return new Request(`${BASE_URL}/api/v1/tradingview/observations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ credential, payload }),
  });
}

async function body(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

describe("observation edge Worker", () => {
  it("keeps liveness public while ingress defaults fail-closed", async () => {
    const disabled = {
      DB: new FakeD1() as unknown as D1Database,
    } as Env;
    const live = await handleRequest(
      new Request(`${BASE_URL}/health/live`),
      disabled,
    );
    const posted = await handleRequest(
      new Request(`${BASE_URL}/api/v1/tradingview/observations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "not-json",
      }),
      disabled,
    );
    const listed = await handleRequest(
      new Request(`${BASE_URL}/api/v1/observation-receipts`),
      disabled,
    );

    expect(live.status).toBe(200);
    expect(await body(live)).toEqual({
      status: "ALIVE",
      mode: "OBSERVATION_ONLY",
      paper_simulator: "DISABLED",
      canonical_paper: "DISABLED",
      deployment_version: {
        id: null,
        tag: null,
      },
      execution: "DISABLED",
    });
    expect(posted.status).toBe(503);
    expect((await body(posted)).error).toMatchObject({
      code: "INGRESS_DISABLED",
    });
    expect(listed.status).toBe(503);
  });

  it("persists one metadata receipt and implements duplicate/conflict semantics", async () => {
    const database = new FakeD1();
    const env = await environment(database);
    const first = await handleRequest(postBody(incrementalPayload()), env);
    const duplicate = await handleRequest(postBody(incrementalPayload()), env);
    const conflicting = incrementalPayload();
    conflicting.settings_hash = "c".repeat(64);
    const conflict = await handleRequest(postBody(conflicting), env);
    const listed = await handleRequest(
      new Request(`${BASE_URL}/api/v1/observation-receipts?limit=50`),
      env,
    );

    const firstBody = await body(first);
    const duplicateBody = await body(duplicate);
    const listBody = await body(listed);
    expect(first.status).toBe(202);
    expect(firstBody.status).toBe("RECEIVED");
    expect(duplicate.status).toBe(200);
    expect(duplicateBody.status).toBe("DUPLICATE");
    expect(duplicateBody.receipt_id).toBe(firstBody.receipt_id);
    expect(conflict.status).toBe(409);
    expect((await body(conflict)).error).toMatchObject({
      code: "IDEMPOTENCY_CONFLICT",
    });
    expect(listed.status).toBe(200);
    expect(listBody).toMatchObject({
      mode: "OBSERVATION_ONLY",
      ingress_enabled: true,
      count: 1,
    });
    expect(database.records).toHaveLength(1);
    expect(database.evidence).toHaveLength(0);
    const stored = [...database.records.values()][0];
    expect(stored).toBeDefined();
    expect(stored).not.toHaveProperty("credential");
    expect(stored).not.toHaveProperty("payload");
    expect(database.preparedSql).toContain(INSERT_RECEIPT_SQL);
    expect(database.preparedSql).toContain(SELECT_RECEIPT_SQL);
    expect(database.preparedSql).toContain(LIST_RECEIPTS_SQL);
  });

  it("accepts the required empty snapshot form", async () => {
    const env = await environment();
    const response = await handleRequest(postBody(snapshotPayload()), env);
    const responseBody = await body(response);

    expect(response.status).toBe(202);
    expect(responseBody).toMatchObject({
      kind: "snapshot",
      sequence: 0,
      status: "RECEIVED",
    });
  });

  it("accepts a contract-versioned snapshot with a waiting active setup", async () => {
    const response = await handleRequest(
      postBody(contractSnapshotPayload()),
      await environment(),
    );

    expect(response.status).toBe(202);
    expect(await body(response)).toMatchObject({
      kind: "snapshot",
      schema_version: "1.2",
      sequence: 0,
      status: "RECEIVED",
      strategy_version: "1.2.0-contract1",
    });
  });

  it("atomically persists and returns sanitized contract setup evidence", async () => {
    const database = new FakeD1();
    const env = await environment(database);
    const first = await handleRequest(
      postBody(contractIncrementalPayload()),
      env,
    );
    const duplicate = await handleRequest(
      postBody(contractIncrementalPayload()),
      env,
    );
    const listed = await handleRequest(
      new Request(`${BASE_URL}/api/v1/observation-setup-evidence?limit=10`),
      env,
    );

    expect(first.status).toBe(202);
    expect(duplicate.status).toBe(200);
    expect((await body(duplicate)).status).toBe("DUPLICATE");
    expect(database.records).toHaveLength(1);
    expect(database.evidence).toHaveLength(1);
    expect(database.preparedSql).toContain(INSERT_SETUP_EVIDENCE_SQL);
    expect(database.preparedSql).toContain(LIST_SETUP_EVIDENCE_SQL);

    const stored = [...database.evidence.values()][0];
    expect(stored).toMatchObject({
      event_index: 0,
      event_kind: "transition",
      symbol: "XAUUSD",
      side: "DEMAND",
      zone_key: "demand|1710000000000",
      liquidity_key: "swing-low|1709999700000",
      from_state: null,
      to_state: "WAITING_FOR_ELIGIBILITY",
      reason_code: "WAIT_SETUP_ELIGIBILITY",
      decision: "WAIT",
      entry_model: "DIR_CLOSE",
      source_open: "2150",
      source_high: "2151",
      source_low: "2149.5",
      source_close: "2150.5",
    });
    expect(stored).not.toHaveProperty("credential");
    expect(stored).not.toHaveProperty("payload");
    expect(stored).not.toHaveProperty("canonical_payload");
    expect(JSON.parse(stored?.rule_passes_json ?? "[]")).toHaveLength(22);

    const listedBody = await body(listed);
    expect(listed.status).toBe(200);
    expect(listedBody).toMatchObject({
      mode: "OBSERVATION_ONLY",
      execution: "DISABLED",
      count: 1,
    });
    const items = listedBody.items as Record<string, unknown>[];
    expect(items[0]).toMatchObject({
      receipt_id: stored?.receipt_id,
      event_index: 0,
      event_kind: "transition",
      symbol: "XAUUSD",
      decision: "WAIT",
    });
    expect(items[0]?.rule_passes).toHaveLength(22);
    expect(items[0]).not.toHaveProperty("rule_passes_json");
    expect(JSON.stringify(listedBody)).not.toContain(CREDENTIAL);
    expect(JSON.stringify(listedBody)).not.toContain("canonical_payload");
  });

  it("rolls back the contract receipt when evidence persistence fails", async () => {
    const database = new FakeD1(true);
    const response = await handleRequest(
      postBody(contractIncrementalPayload()),
      await environment(database),
    );

    expect(response.status).toBe(503);
    expect(database.records).toHaveLength(0);
    expect(database.evidence).toHaveLength(0);
  });

  it("accepts contract-versioned shadow evidence and an empty 1.2 heartbeat", async () => {
    const evidenceDatabase = new FakeD1();
    const evidenceResponse = await handleRequest(
      postBody(contractIncrementalPayload()),
      await environment(evidenceDatabase),
    );
    const heartbeat = contractIncrementalPayload();
    heartbeat.transitions = [];
    heartbeat.sequence = 2;
    heartbeat.idempotency_key = "pine-lab-01:2";
    const heartbeatDatabase = new FakeD1();
    const heartbeatResponse = await handleRequest(
      postBody(heartbeat),
      await environment(heartbeatDatabase),
    );

    expect(evidenceResponse.status).toBe(202);
    expect(await body(evidenceResponse)).toMatchObject({
      schema_version: "1.2",
      strategy_version: "1.2.0-contract1",
      status: "RECEIVED",
    });
    expect(heartbeatResponse.status).toBe(202);
    expect(evidenceDatabase.evidence).toHaveLength(1);
    expect(heartbeatDatabase.records).toHaveLength(1);
    expect(heartbeatDatabase.evidence).toHaveLength(0);
  });

  it("retains same-bar ambiguity as validated shadow evidence", async () => {
    const payload = contractIncrementalPayload();
    const transition = (payload.transitions as Record<string, unknown>[])[0];
    const evidence = transition?.rule_evidence as Record<string, unknown>;
    if (transition !== undefined) {
      transition.from_state = "ARMED";
      transition.to_state = "SHADOW_ONLY";
      transition.reason_code = "SHADOW_AMBIGUOUS_SAME_BAR_ORDER";
    }
    const lifecycle = evidence.lifecycle as Record<string, unknown>;
    lifecycle.zone_engaged_epoch = lifecycle.liquidity_swept_epoch;
    evidence.decision = "SHADOW_ONLY";
    const rulePasses = evidence.rule_passes as boolean[];
    const eventOrderIndex = CONTRACT_OPEN_RULES.findIndex(
      ([ruleId]) => ruleId === "LIQ_EVENT_ORDER",
    );
    if (eventOrderIndex !== -1) {
      rulePasses[eventOrderIndex] = false;
    }

    const response = await handleRequest(postBody(payload), await environment());

    expect(response.status).toBe(202);
  });

  it("retains rejected engagement when prerequisite lifecycle events are absent", async () => {
    const payload = contractIncrementalPayload();
    const transition = (payload.transitions as Record<string, unknown>[])[0];
    const evidence = transition?.rule_evidence as Record<string, unknown>;
    if (transition !== undefined) {
      transition.to_state = "REJECTED";
      transition.reason_code = "REJECT_TARGET_TAP_WITHOUT_ELIGIBILITY";
    }
    const lifecycle = evidence.lifecycle as Record<string, unknown>;
    lifecycle.own_extreme_broken_epoch = null;
    lifecycle.liquidity_swept_epoch = null;
    evidence.decision = "REJECT";
    const rulePasses = evidence.rule_passes as boolean[];
    const eventOrderIndex = CONTRACT_OPEN_RULES.findIndex(
      ([ruleId]) => ruleId === "LIQ_EVENT_ORDER",
    );
    if (eventOrderIndex !== -1) {
      rulePasses[eventOrderIndex] = false;
    }

    const response = await handleRequest(postBody(payload), await environment());

    expect(response.status).toBe(202);
  });

  it.each([
    [
      "missing contract version",
      (payload: Record<string, unknown>) => {
        delete payload.rule_contract_version;
      },
    ],
    [
      "missing rule catalog",
      (payload: Record<string, unknown>) => {
        delete payload.rule_catalog;
      },
    ],
    [
      "executable mode",
      (payload: Record<string, unknown>) => {
        payload.execution_mode = "PAPER_OPEN";
      },
    ],
    [
      "missing rule evidence",
      (payload: Record<string, unknown>) => {
        const transition = (payload.transitions as Record<string, unknown>[])[0];
        if (transition !== undefined) {
          delete transition.rule_evidence;
        }
      },
    ],
    [
      "paper open decision",
      (payload: Record<string, unknown>) => {
        const transition = (payload.transitions as Record<string, unknown>[])[0];
        const evidence = transition?.rule_evidence as Record<string, unknown>;
        evidence.decision = "PAPER_OPEN";
      },
    ],
    [
      "wrong frozen fidelity",
      (payload: Record<string, unknown>) => {
        const catalog = payload.rule_catalog as Record<string, unknown>[];
        catalog[0]!.fidelity = "DISCRETIONARY";
      },
    ],
    [
      "event-order claim without strict lifecycle",
      (payload: Record<string, unknown>) => {
        const transition = (payload.transitions as Record<string, unknown>[])[0];
        const evidence = transition?.rule_evidence as Record<string, unknown>;
        const lifecycle = evidence.lifecycle as Record<string, unknown>;
        lifecycle.zone_engaged_epoch = lifecycle.liquidity_swept_epoch;
      },
    ],
    [
      "paper command field on observation-only schema",
      (payload: Record<string, unknown>) => {
        payload.paper_commands = [];
      },
    ],
  ])("rejects malformed 1.2 evidence: %s", async (_name, mutate) => {
    const payload = contractIncrementalPayload();
    mutate(payload);

    const response = await handleRequest(
      postBody(payload),
      await environment(),
    );

    expect(response.status).toBe(422);
    expect((await body(response)).error).toMatchObject({
      code: "INVALID_OBSERVATION",
    });
  });

  it("rejects a bad credential without echoing it", async () => {
    const rejected = "do-not-echo-this-secret";
    const env = await environment();
    const response = await handleRequest(
      postBody(incrementalPayload(), rejected),
      env,
    );
    const text = await response.text();

    expect(response.status).toBe(401);
    expect(text).toContain("INVALID_CREDENTIAL");
    expect(text).not.toContain(rejected);
  });

  it("bounds the body before parsing and never echoes oversized content", async () => {
    const oversized = "private-" + "x".repeat(2_000);
    const env = await environment(new FakeD1(), {
      TRADINGVIEW_OBSERVATION_MAX_BODY_BYTES: "1024",
    });
    const response = await handleRequest(
      postBody(incrementalPayload(), oversized),
      env,
    );
    const text = await response.text();

    expect(response.status).toBe(413);
    expect(text).toContain("BODY_TOO_LARGE");
    expect(text).not.toContain(oversized);
  });

  it("accepts a 34,999-character v2 envelope and rejects 35,000 before D1", async () => {
    const acceptedDatabase = new FakeD1();
    const rejectedDatabase = new FakeD1();
    const envelope = JSON.stringify({
      credential: CREDENTIAL,
      payload: entryV2Payload(),
    });
    const acceptedText = envelope.padEnd(34_999, " ");
    const rejectedText = envelope.padEnd(35_000, " ");
    const request = (text: string) =>
      new Request(`${BASE_URL}/api/v1/tradingview/observations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: text,
      });

    const accepted = await handleRequest(
      request(acceptedText),
      await environment(acceptedDatabase),
    );
    const rejected = await handleRequest(
      request(rejectedText),
      await environment(rejectedDatabase),
    );

    expect(accepted.status).toBe(202);
    expect(rejected.status).toBe(413);
    expect(await body(rejected)).toMatchObject({
      error: { code: "ENTRY_V2_MESSAGE_TOO_LARGE" },
    });
    expect(acceptedDatabase.preparedSql.join("\n").toLowerCase()).not.toContain(
      "paper_trade",
    );
    expect(rejectedDatabase.preparedSql).toHaveLength(0);
  });

  it("preserves a valid 35,000-character legacy 1.0 envelope", async () => {
    const database = new FakeD1();
    const envelope = JSON.stringify({
      credential: CREDENTIAL,
      payload: incrementalPayload(),
    });
    const padded = envelope.padEnd(35_000, " ");
    const response = await handleRequest(
      new Request(`${BASE_URL}/api/v1/tradingview/observations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: padded,
      }),
      await environment(database),
    );

    expect(padded).toHaveLength(35_000);
    expect(response.status).toBe(202);
    expect(await body(response)).toMatchObject({
      schema_version: "1.0",
      status: "RECEIVED",
    });
    expect(database.records).toHaveLength(1);
  });

  it("fails malformed v2 closed fields before any D1 preparation", async () => {
    const database = new FakeD1();
    const value = entryV2Payload();
    const setup = (value.eb as Record<string, unknown>[])[0]!;
    const facts = setup.f as Record<string, unknown>;
    facts.re_entry = true;

    const response = await handleRequest(
      postBody(value),
      await environment(database),
    );

    expect(response.status).toBe(422);
    expect(await body(response)).toMatchObject({
      error: { code: "INVALID_OBSERVATION" },
    });
    expect(database.preparedSql).toHaveLength(0);
  });

  it.each([
    ["extra keys", (payload: Record<string, unknown>) => (payload.extra = true)],
    [
      "corrupt backslash identifier",
      (payload: Record<string, unknown>) => {
        payload.producer_instance_id = "pine\\corrupt";
        payload.idempotency_key = "pine\\corrupt:1";
      },
    ],
    [
      "idempotency mismatch",
      (payload: Record<string, unknown>) =>
        (payload.idempotency_key = "pine-lab-01:2"),
    ],
    [
      "unsafe integer",
      (payload: Record<string, unknown>) =>
        (payload.sequence = 9_007_199_254_740_992),
    ],
    [
      "invalid zone geometry",
      (payload: Record<string, unknown>) => {
        const transition = (payload.transitions as Record<string, unknown>[])[0];
        const zone = transition?.zone as Record<string, unknown>;
        zone.top = 2_149;
      },
    ],
    [
      "future transition candle",
      (payload: Record<string, unknown>) => {
        const transition = (payload.transitions as Record<string, unknown>[])[0];
        const candle = transition?.source_candle as Record<string, unknown>;
        candle.close_epoch = 1_710_000_600_000;
      },
    ],
    [
      "non-contiguous transition index",
      (payload: Record<string, unknown>) => {
        const transition = (payload.transitions as Record<string, unknown>[])[0];
        if (transition !== undefined) {
          transition.transition_index = 1;
        }
      },
    ],
    [
      "empty incremental transitions",
      (payload: Record<string, unknown>) => (payload.transitions = []),
    ],
  ])("rejects malformed contract: %s", async (_name, mutate) => {
    const payload = incrementalPayload();
    mutate(payload);
    const response = await handleRequest(
      postBody(payload),
      await environment(),
    );
    expect(response.status).toBe(422);
    expect((await body(response)).error).toMatchObject({
      code: "INVALID_OBSERVATION",
    });
  });

  it("rejects duplicate object keys and non-finite JSON spellings", async () => {
    const env = await environment();
    const payloadJson = JSON.stringify(incrementalPayload());
    const duplicate = new Request(
      `${BASE_URL}/api/v1/tradingview/observations`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: `{"credential":"${CREDENTIAL}","credential":"${CREDENTIAL}","payload":${payloadJson}}`,
      },
    );
    const nonFinite = new Request(
      `${BASE_URL}/api/v1/tradingview/observations`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          credential: CREDENTIAL,
          payload: incrementalPayload(),
        }).replace('"top":2150.25', '"top":NaN'),
      },
    );

    expect((await handleRequest(duplicate, env)).status).toBe(422);
    expect((await handleRequest(nonFinite, env)).status).toBe(422);
  });

  it("sanitizes D1 failures and validates list limits", async () => {
    const failingEnv = await environment(new FailingD1());
    const post = await handleRequest(postBody(incrementalPayload()), failingEnv);
    const list = await handleRequest(
      new Request(`${BASE_URL}/api/v1/observation-receipts`),
      failingEnv,
    );
    const validEnv = await environment();
    const invalidLimit = await handleRequest(
      new Request(`${BASE_URL}/api/v1/observation-receipts?limit=201`),
      validEnv,
    );
    const invalidEvidenceLimit = await handleRequest(
      new Request(
        `${BASE_URL}/api/v1/observation-setup-evidence?limit=0&limit=1`,
      ),
      validEnv,
    );

    expect(post.status).toBe(503);
    expect(list.status).toBe(503);
    expect(invalidLimit.status).toBe(422);
    expect(invalidEvidenceLimit.status).toBe(422);
    expect(await body(invalidEvidenceLimit)).toMatchObject({
      error: { code: "INVALID_LIMIT" },
    });
  });

  it("rejects unsupported methods and malformed media without invoking D1", async () => {
    const database = new FakeD1();
    const env = await environment(database);
    const method = await handleRequest(
      new Request(`${BASE_URL}/api/v1/tradingview/observations`),
      env,
    );
    const media = await handleRequest(
      new Request(`${BASE_URL}/api/v1/tradingview/observations`, {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: "secret raw content",
      }),
      env,
    );

    expect(method.status).toBe(405);
    expect(media.status).toBe(422);
    expect(database.preparedSql).toHaveLength(0);
  });
});

describe("deployment contract", () => {
  it("routes only API/health through the Worker and keeps the credential a secret", () => {
    const root = fileURLToPath(new URL("..", import.meta.url));
    const config = JSON.parse(
      readFileSync(`${root}/wrangler.jsonc`, "utf8"),
    ) as Record<string, unknown>;
    const assets = config.assets as Record<string, unknown>;
    const databases = config.d1_databases as Record<string, unknown>[];
    const variables = config.vars as Record<string, unknown>;

    expect(config.compatibility_date).toBe("2026-07-23");
    expect(config.workers_dev).toBe(true);
    expect(config.preview_urls).toBe(false);
    expect(assets.directory).toBe("../operations-console/out");
    expect(assets.run_worker_first).toEqual(["/api/*", "/health/*"]);
    expect(databases[0]?.binding).toBe("DB");
    expect(variables).not.toHaveProperty(
      "TRADINGVIEW_OBSERVATION_CREDENTIAL_SHA256",
    );
  });

  it("defines metadata-only D1 storage with atomic idempotency", () => {
    const root = fileURLToPath(new URL("..", import.meta.url));
    const migration = readFileSync(
      `${root}/migrations/0001_observation_receipts.sql`,
      "utf8",
    ).toLowerCase();

    expect(migration).toContain("idempotency_key text not null unique");
    expect(migration).toContain("payload_sha256 text not null");
    expect(migration).not.toMatch(/^\s*(credential|payload)\s+text/gm);
    expect(INSERT_RECEIPT_SQL).toContain("INSERT INTO observation_receipts");
    expect(INSERT_RECEIPT_SQL).not.toContain("INSERT OR IGNORE");
  });

  it("upgrades receipt storage for contract-v2 without breaking references", () => {
    const root = fileURLToPath(new URL("..", import.meta.url));
    const migration = readFileSync(
      `${root}/migrations/0020_observation_receipts_contract_v2.sql`,
      "utf8",
    ).toLowerCase();

    expect(migration).toContain("pragma defer_foreign_keys = on");
    expect(migration).toContain(
      "schema_version in ('1.0', '1.1', '1.2')",
    );
    expect(migration).toContain(
      "(schema_version = '1.2' and strategy_version = '1.2.0-contract1')",
    );
    expect(migration).toContain(
      "insert into observation_receipts_contract_v2",
    );
    expect(migration).toContain("from observation_receipts");
    expect(migration).toContain(
      "rename to observation_receipts",
    );
    expect(migration).toContain("pragma foreign_key_check");
    expect(migration).toContain("pragma defer_foreign_keys = off");
    expect(migration).not.toMatch(/^\s*(credential|payload)\s+text/gm);
  });

  it("admits entry schema 2.0 while copying every legacy receipt", () => {
    const root = fileURLToPath(new URL("..", import.meta.url));
    const migration = readFileSync(
      `${root}/migrations/0022_observation_receipts_entry_v2.sql`,
      "utf8",
    ).toLowerCase();

    expect(migration).toContain("pragma defer_foreign_keys = on");
    expect(migration).toContain(
      "schema_version in ('1.0', '1.1', '1.2', '2.0')",
    );
    expect(migration).toContain(
      "(schema_version = '2.0' and strategy_version = '2.0.0-contract2')",
    );
    expect(migration).toContain("(schema_version = '2.0' and sequence >= 1)");
    expect(migration).toContain(
      "(schema_version in ('1.0', '1.1', '1.2') and sequence >= 0)",
    );
    expect(migration).toContain("insert into observation_receipts_entry_v2");
    expect(migration).toContain("from observation_receipts");
    expect(migration).toContain("pragma foreign_key_check");
    expect(migration).not.toContain("pragma defer_foreign_keys = off");
    expect(migration).toMatch(
      /schema_version in \('1\.0', '1\.1', '1\.2'\)\s+and\s+length\(payload_sha256\) = 64/su,
    );
    expect(migration).toMatch(
      /schema_version = '2\.0'\s+and\s+length\(payload_sha256\) = 64\s+and\s+payload_sha256 not glob '\*\[\^0-9a-f\]\*'/su,
    );
    expect(migration).not.toMatch(
      /^\s*(credential|payload|raw_payload|canonical_payload)\s+text/gmu,
    );
  });

  it("defines immutable normalized entry storage and parity audit rows", () => {
    const root = fileURLToPath(new URL("..", import.meta.url));
    const migration = readFileSync(
      `${root}/migrations/0023_observation_entries.sql`,
      "utf8",
    ).toLowerCase();

    for (const table of ENTRY_STORAGE_TABLES) {
      expect(migration).toContain(`create table ${table}`);
    }
    expect(migration).toContain("paper_eligible");
    expect(migration).toContain("shadow_only");
    expect(migration).not.toMatch(/execute|broker|order_command/u);
    expect(migration).toContain("entry candidates are immutable");
    expect(migration).toContain("entry evidence is append-only");
    expect(migration).toContain("entry selections are immutable");
    expect(migration).toContain("pragma foreign_key_check");
  });

  it("applies the entry schema with closed foreign keys and continuity indexes", () => {
    const root = fileURLToPath(new URL("..", import.meta.url));
    const database = new DatabaseSync(":memory:");
    database.exec("PRAGMA foreign_keys = ON");
    applyObservationMigrationsThrough(database, root, 23);

    expect(
      database
        .prepare(
          `SELECT name
           FROM sqlite_schema
           WHERE type = 'table'
             AND (
               name LIKE 'observation_entry_%'
               OR name = 'observation_market_bar_heartbeats'
             )
           ORDER BY name`,
        )
        .all()
        .map((row) => row.name),
    ).toEqual([...ENTRY_STORAGE_TABLES].sort());

    const immutableTriggerPrefixes = [
      "observation_entry_batches",
      "observation_market_bar_heartbeats",
      "observation_entry_chunks",
      "observation_entry_completions",
      "observation_entry_setup_events",
      "observation_entry_terminals",
      "observation_entry_candidates",
      "observation_entry_evidence",
      "observation_entry_handling",
      "observation_entry_diagnostics",
      "observation_entry_selections",
      "observation_entry_evaluation_members",
      "observation_entry_parity",
      "observation_entry_source_claims",
      "observation_entry_source_relationships",
      "observation_entry_quarantine",
    ];
    expect(
      database
        .prepare(
          `SELECT name
           FROM sqlite_schema
           WHERE type = 'trigger'
             AND (
               name LIKE 'observation_entry_%_no_update'
               OR name LIKE 'observation_entry_%_no_delete'
               OR name = 'observation_market_bar_heartbeats_no_update'
               OR name = 'observation_market_bar_heartbeats_no_delete'
             )
           ORDER BY name`,
        )
        .all()
        .map((row) => row.name),
    ).toEqual(
      immutableTriggerPrefixes
        .flatMap((prefix) => [`${prefix}_no_delete`, `${prefix}_no_update`])
        .sort(),
    );

    const expectedIndexes = new Map<string, readonly string[]>([
      ["idx_entry_chunks_batch", ["batch_id", "chunk_index"]],
      [
        "idx_market_bar_heartbeat_schedule",
        [
          "producer_role",
          "symbol",
          "ticker_id",
          "feed",
          "timeframe",
          "bar_close_epoch",
        ],
      ],
      [
        "idx_entry_batches_producer_sequence",
        ["producer_instance_id", "producer_sequence"],
      ],
      ["idx_entry_candidates_setup", ["setup_id", "observed_at_epoch"]],
      ["idx_entry_candidates_model", ["model", "observed_at_epoch"]],
      [
        "idx_entry_evidence_candidate",
        ["candidate_id", "observed_at_epoch"],
      ],
      ["idx_entry_evidence_fidelity", ["fidelity", "observed_at_epoch"]],
      ["idx_entry_selections_setup_revision", ["setup_id", "revision"]],
      ["idx_entry_selections_reason", ["reason", "evaluated_at_epoch"]],
      ["idx_entry_parity_status", ["parity_status", "compared_at"]],
      [
        "idx_entry_evaluation_members_selection",
        ["selection_id", "object_kind"],
      ],
      ["idx_entry_terminals_epoch", ["terminal_epoch", "setup_id"]],
      [
        "idx_entry_setup_events_stream",
        ["setup_id", "confirmed_bar_close_epoch", "event_id"],
      ],
    ]);
    for (const [indexName, columns] of expectedIndexes) {
      expect(
        database
          .prepare(`PRAGMA index_info('${indexName}')`)
          .all()
          .map((row) => row.name),
      ).toEqual(columns);
    }

    const foreignKeys = (
      table: (typeof ENTRY_STORAGE_TABLES)[number],
    ): readonly Record<string, unknown>[] =>
      database
        .prepare(`PRAGMA foreign_key_list('${table}')`)
        .all() as Record<string, unknown>[];
    expect(foreignKeys("observation_entry_batches")).toEqual([
      expect.objectContaining({
        table: "observation_receipts",
        from: "first_receipt_id",
        to: "receipt_id",
        on_delete: "RESTRICT",
      }),
    ]);
    expect(foreignKeys("observation_market_bar_heartbeats")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: "observation_entry_batches",
          from: "batch_id",
          to: "batch_id",
          on_delete: "RESTRICT",
        }),
        expect.objectContaining({
          table: "observation_receipts",
          from: "receipt_id",
          to: "receipt_id",
          on_delete: "RESTRICT",
        }),
      ]),
    );
    expect(foreignKeys("observation_entry_chunks")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: "observation_entry_batches",
          from: "batch_id",
          to: "batch_id",
          on_delete: "RESTRICT",
        }),
        expect.objectContaining({
          table: "observation_receipts",
          from: "receipt_id",
          to: "receipt_id",
          on_delete: "RESTRICT",
        }),
      ]),
    );
    expect(foreignKeys("observation_entry_batch_completions")).toEqual([
      expect.objectContaining({
        table: "observation_entry_batches",
        from: "batch_id",
        to: "batch_id",
        on_delete: "RESTRICT",
      }),
    ]);
    expect(foreignKeys("observation_entry_setup_events")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: "observation_entry_batches",
          from: "batch_id",
          to: "batch_id",
          on_delete: "RESTRICT",
        }),
        expect.objectContaining({
          table: "observation_receipts",
          from: "receipt_id",
          to: "receipt_id",
          on_delete: "RESTRICT",
        }),
      ]),
    );
    expect(foreignKeys("observation_entry_setup_terminals")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: "observation_entry_batches",
          from: "first_batch_id",
          to: "batch_id",
          on_delete: "RESTRICT",
        }),
        expect.objectContaining({
          table: "observation_receipts",
          from: "first_receipt_id",
          to: "receipt_id",
          on_delete: "RESTRICT",
        }),
      ]),
    );
    expect(foreignKeys("observation_entry_candidate_evidence")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: "observation_entry_candidates",
          from: "candidate_id",
          to: "candidate_id",
          on_delete: "RESTRICT",
        }),
        expect.objectContaining({
          table: "observation_receipts",
          from: "receipt_id",
          to: "receipt_id",
          on_delete: "RESTRICT",
        }),
      ]),
    );
    expect(foreignKeys("observation_entry_handling")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: "observation_entry_candidates",
          from: "candidate_id",
          to: "candidate_id",
          on_delete: "RESTRICT",
        }),
        expect.objectContaining({
          table: "observation_entry_candidate_evidence",
          from: "evidence_id",
          to: "evidence_id",
          on_delete: "RESTRICT",
        }),
        expect.objectContaining({
          table: "observation_receipts",
          from: "receipt_id",
          to: "receipt_id",
          on_delete: "RESTRICT",
        }),
      ]),
    );
    expect(foreignKeys("observation_entry_selections")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: "observation_entry_batches",
          from: "batch_id",
          to: "batch_id",
          on_delete: "RESTRICT",
        }),
        expect.objectContaining({
          table: "observation_entry_candidates",
          from: "canonical_candidate_id",
          to: "candidate_id",
          on_delete: "RESTRICT",
        }),
        expect.objectContaining({
          table: "observation_entry_candidate_evidence",
          from: "canonical_evidence_id",
          to: "evidence_id",
          on_delete: "RESTRICT",
        }),
      ]),
    );
    expect(
      foreignKeys("observation_entry_source_claim_relationships"),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: "observation_entry_source_claims",
          from: "claim_id",
          to: "claim_id",
          on_delete: "RESTRICT",
        }),
        expect.objectContaining({
          table: "observation_entry_source_claims",
          from: "target_claim_id",
          to: "claim_id",
          on_delete: "RESTRICT",
        }),
      ]),
    );
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);

    const columns = ENTRY_STORAGE_TABLES.flatMap((table) =>
      database
        .prepare(`PRAGMA table_info('${table}')`)
        .all()
        .map((row) => String(row.name)),
    );
    expect(columns).not.toEqual(
      expect.arrayContaining([
        "credential",
        "raw_credential",
        "raw_payload",
        "broker",
        "order_command",
        "live_execution",
      ]),
    );
  });

  it("normalizes legacy milliseconds and v3 seconds to one bar schedule identity", () => {
    const root = fileURLToPath(new URL("..", import.meta.url));
    const database = new DatabaseSync(":memory:");
    database.exec("PRAGMA foreign_keys = ON");
    applyObservationMigrationsThrough(database, root, 23);
    seedEntryStorage(database);

    const rows = database
      .prepare(
        `SELECT
           schema_version, producer_role, producer_instance_id,
           detector_code_hash, settings_hash, symbol, ticker_id, feed,
           timeframe, bar_open_epoch, bar_close_epoch
         FROM observation_market_bar_heartbeats
         ORDER BY schema_version`,
      )
      .all();
    expect(rows).toEqual([
      {
        schema_version: "1.2",
        producer_role: "LEGACY_REFERENCE",
        producer_instance_id: "legacy-reference-producer",
        detector_code_hash: null,
        settings_hash: null,
        symbol: "EURUSD",
        ticker_id: "VANTAGE:EURUSD",
        feed: "VANTAGE",
        timeframe: "5",
        bar_open_epoch: 1721808000,
        bar_close_epoch: 1721808300,
      },
      {
        schema_version: "2.0",
        producer_role: "ENTRY_V3_CANARY",
        producer_instance_id: "entry-v3-canary-producer",
        detector_code_hash: "3".repeat(64),
        settings_hash: "4".repeat(64),
        symbol: "EURUSD",
        ticker_id: "VANTAGE:EURUSD",
        feed: "VANTAGE",
        timeframe: "5",
        bar_open_epoch: 1721808000,
        bar_close_epoch: 1721808300,
      },
    ]);
    expect(
      rows.map(
        (row) =>
          `${row.symbol}|${row.ticker_id}|${row.feed}|${row.timeframe}|` +
          `${row.bar_open_epoch}|${row.bar_close_epoch}`,
      ),
    ).toEqual([
      "EURUSD|VANTAGE:EURUSD|VANTAGE|5|1721808000|1721808300",
      "EURUSD|VANTAGE:EURUSD|VANTAGE|5|1721808000|1721808300",
    ]);

    insertEntryStorageReceipt(database, {
      receiptId: "receipt-entry-storage-raw-ms",
      schemaVersion: "1.2",
      strategyVersion: "1.2.0-contract1",
      producerInstanceId: "legacy-raw-ms",
      sequence: 0,
    });
    expect(() =>
      database
        .prepare(
          `INSERT INTO observation_market_bar_heartbeats (
            receipt_id, batch_id, schema_version, producer_role,
            producer_instance_id, producer_sequence, strategy_version,
            symbol, ticker_id, feed, timeframe, bar_open_epoch, bar_close_epoch,
            detector_code_hash, settings_hash, recorded_at
          ) VALUES (
            'receipt-entry-storage-raw-ms', NULL, '1.2', 'LEGACY_REFERENCE',
            'legacy-raw-ms', 0, '1.2.0-contract1',
            'EURUSD', 'VANTAGE:EURUSD', 'VANTAGE', '5',
            1721808000000, 1721808300000, NULL, NULL,
            '2026-07-24T10:00:00Z'
          )`,
        )
        .run(),
    ).toThrow(/CHECK constraint failed/u);
  });

  it("binds each batch to its first authenticated v3 receipt", () => {
    const root = fileURLToPath(new URL("..", import.meta.url));
    const database = new DatabaseSync(":memory:");
    database.exec("PRAGMA foreign_keys = ON");
    applyObservationMigrationsThrough(database, root, 23);

    const matchingReceiptId = "receipt-batch-provenance-matching";
    insertEntryStorageReceipt(database, {
      receiptId: matchingReceiptId,
      schemaVersion: "2.0",
      strategyVersion: "2.0.0-contract2",
      producerInstanceId: "batch-provenance-producer",
      sequence: 7,
    });
    insertEntryStorageReceipt(database, {
      receiptId: "receipt-batch-provenance-unrelated",
      schemaVersion: "2.0",
      strategyVersion: "2.0.0-contract2",
      producerInstanceId: "unrelated-producer",
      sequence: 99,
      symbol: "GBPUSD",
      tickerId: "VANTAGE:GBPUSD",
      feed: "OTHER",
      kind: "incremental",
    });
    insertEntryStorageReceipt(database, {
      receiptId: "receipt-batch-provenance-legacy",
      schemaVersion: "1.2",
      strategyVersion: "1.2.0-contract1",
      producerInstanceId: "batch-provenance-producer",
      sequence: 7,
    });

    type BatchFields = {
      batchId: string;
      producerInstanceId: string;
      producerSequence: string | number | null;
      kind: "incremental" | "snapshot";
      symbol: string;
      tickerId: string;
      feed: string;
      barOpenEpoch: number;
      barCloseEpoch: number;
      firstReceiptId: string | number | null;
    };
    const baseBatch: BatchFields = {
      batchId: "8".repeat(64),
      producerInstanceId: "batch-provenance-producer",
      producerSequence: 7,
      kind: "snapshot",
      symbol: "EURUSD",
      tickerId: "VANTAGE:EURUSD",
      feed: "VANTAGE",
      barOpenEpoch: 1721810100,
      barCloseEpoch: 1721810400,
      firstReceiptId: matchingReceiptId,
    };
    const insertBatch = (
      overrides: Partial<BatchFields> = {},
    ): void => {
      const batch = { ...baseBatch, ...overrides };
      database
        .prepare(
          `INSERT INTO observation_entry_batches (
            batch_id, producer_instance_id, producer_sequence, kind,
            bar_close_epoch, strategy_id, strategy_version,
            rule_contract_version, execution_mode, symbol, ticker_id, feed,
            timeframe, tick_size, bar_open_epoch, detector_code_hash,
            settings_hash, chunk_count, first_receipt_id, first_seen_at
          ) VALUES (
            ?, ?, ?, ?, ?,
            'rd_liquidity_sd_5m_v1', '2.0.0-contract2', '2.0.0',
            'OBSERVATION_ONLY', ?, ?, ?, '5', '0.00001', ?,
            ?, ?, 1, ?, '2026-07-24T10:00:00Z'
          )`,
        )
        .run(
          batch.batchId,
          batch.producerInstanceId,
          batch.producerSequence,
          batch.kind,
          batch.barCloseEpoch,
          batch.symbol,
          batch.tickerId,
          batch.feed,
          batch.barOpenEpoch,
          "3".repeat(64),
          "4".repeat(64),
          batch.firstReceiptId,
        );
    };

    expect(() =>
      insertBatch({
        firstReceiptId: "receipt-batch-provenance-unrelated",
      }),
    ).toThrow(/batch first receipt provenance mismatch/u);
    expect(() =>
      insertBatch({
        firstReceiptId: "receipt-batch-provenance-legacy",
      }),
    ).toThrow(/batch first receipt provenance mismatch/u);
    expect(() => insertBatch({ firstReceiptId: null })).toThrow(
      /batch first receipt provenance mismatch/u,
    );
    expect(() => insertBatch({ firstReceiptId: 123 })).toThrow(
      /batch first receipt provenance mismatch/u,
    );
    expect(() => insertBatch({ producerSequence: 7.5 })).toThrow(
      /cannot store REAL value in INTEGER column/u,
    );
    expect(
      database
        .prepare(
          `SELECT COUNT(*) AS count
           FROM observation_market_bar_heartbeats
           WHERE receipt_id = ?`,
        )
        .get(matchingReceiptId),
    ).toEqual({ count: 0 });

    expect(() => insertBatch()).not.toThrow();
    database
      .prepare(
        `INSERT INTO observation_market_bar_heartbeats (
          receipt_id, batch_id, schema_version, producer_role,
          producer_instance_id, producer_sequence, strategy_version,
          symbol, ticker_id, feed, timeframe, bar_open_epoch, bar_close_epoch,
          detector_code_hash, settings_hash, recorded_at
        ) VALUES (
          ?, ?, '2.0', 'ENTRY_V3_CANARY',
          'batch-provenance-producer', 7, '2.0.0-contract2',
          'EURUSD', 'VANTAGE:EURUSD', 'VANTAGE', '5',
          1721810100, 1721810400, ?, ?, '2026-07-24T10:00:00Z'
        )`,
      )
      .run(
        matchingReceiptId,
        baseBatch.batchId,
        "3".repeat(64),
        "4".repeat(64),
      );
    expect(
      database
        .prepare(
          `SELECT batch_id
           FROM observation_market_bar_heartbeats
           WHERE receipt_id = ?`,
        )
        .get(matchingReceiptId),
    ).toEqual({ batch_id: baseBatch.batchId });

    const coercibleReceiptId = "receipt-batch-provenance-coercible";
    insertEntryStorageReceipt(database, {
      receiptId: coercibleReceiptId,
      schemaVersion: "2.0",
      strategyVersion: "2.0.0-contract2",
      producerInstanceId: "batch-provenance-coercible",
      sequence: 8,
    });
    expect(() =>
      insertBatch({
        batchId: "7".repeat(64),
        producerInstanceId: "batch-provenance-coercible",
        producerSequence: "8",
        barOpenEpoch: 1721810400,
        barCloseEpoch: 1721810700,
        firstReceiptId: coercibleReceiptId,
      }),
    ).not.toThrow();
    expect(
      database
        .prepare(
          `SELECT producer_sequence, typeof(producer_sequence) AS storage_type
           FROM observation_entry_batches
           WHERE batch_id = ?`,
        )
        .get("7".repeat(64)),
    ).toEqual({ producer_sequence: 8, storage_type: "integer" });
  });

  it("binds heartbeat provenance to its receipt and v3 batch", () => {
    const root = fileURLToPath(new URL("..", import.meta.url));
    const database = new DatabaseSync(":memory:");
    database.exec("PRAGMA foreign_keys = ON");
    applyObservationMigrationsThrough(database, root, 23);
    seedEntryStorage(database);

    type HeartbeatFields = {
      batchId: string | null;
      schemaVersion: string;
      producerRole: string;
      producerInstanceId: string;
      producerSequence: number;
      strategyVersion: string;
      symbol: string;
      tickerId: string;
      feed: string;
      barOpenEpoch: number;
      barCloseEpoch: number;
      detectorCodeHash: string | null;
      settingsHash: string | null;
    };
    const baseHeartbeat: HeartbeatFields = {
      batchId: ENTRY_STORAGE_IDS.batch,
      schemaVersion: "2.0",
      producerRole: "ENTRY_V3_CANARY",
      producerInstanceId: "entry-v3-canary-producer",
      producerSequence: 1,
      strategyVersion: "2.0.0-contract2",
      symbol: "EURUSD",
      tickerId: "VANTAGE:EURUSD",
      feed: "VANTAGE",
      barOpenEpoch: 1721808000,
      barCloseEpoch: 1721808300,
      detectorCodeHash: "3".repeat(64),
      settingsHash: "4".repeat(64),
    };
    const insertHeartbeat = (
      receiptId: string,
      overrides: Partial<HeartbeatFields> = {},
    ): void => {
      const heartbeat = { ...baseHeartbeat, ...overrides };
      database
        .prepare(
          `INSERT INTO observation_market_bar_heartbeats (
            receipt_id, batch_id, schema_version, producer_role,
            producer_instance_id, producer_sequence, strategy_version,
            symbol, ticker_id, feed, timeframe, bar_open_epoch, bar_close_epoch,
            detector_code_hash, settings_hash, recorded_at
          ) VALUES (
            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '5', ?, ?, ?, ?,
            '2026-07-24T10:00:00Z'
          )`,
        )
        .run(
          receiptId,
          heartbeat.batchId,
          heartbeat.schemaVersion,
          heartbeat.producerRole,
          heartbeat.producerInstanceId,
          heartbeat.producerSequence,
          heartbeat.strategyVersion,
          heartbeat.symbol,
          heartbeat.tickerId,
          heartbeat.feed,
          heartbeat.barOpenEpoch,
          heartbeat.barCloseEpoch,
          heartbeat.detectorCodeHash,
          heartbeat.settingsHash,
        );
    };

    insertEntryStorageReceipt(database, {
      receiptId: "receipt-heartbeat-wrong-schema",
      schemaVersion: "1.2",
      strategyVersion: "1.2.0-contract1",
      producerInstanceId: "entry-v3-canary-producer",
      sequence: 1,
    });
    expect(() =>
      insertHeartbeat("receipt-heartbeat-wrong-schema"),
    ).toThrow(/heartbeat receipt provenance mismatch/u);

    const batchMismatchCases: ReadonlyArray<{
      receiptId: string;
      receipt: Parameters<typeof insertEntryStorageReceipt>[1];
      heartbeat: Partial<HeartbeatFields>;
    }> = [
      {
        receiptId: "receipt-heartbeat-wrong-producer",
        receipt: {
          receiptId: "receipt-heartbeat-wrong-producer",
          schemaVersion: "2.0",
          strategyVersion: "2.0.0-contract2",
          producerInstanceId: "other-entry-v3-producer",
          sequence: 1,
        },
        heartbeat: { producerInstanceId: "other-entry-v3-producer" },
      },
      {
        receiptId: "receipt-heartbeat-wrong-sequence",
        receipt: {
          receiptId: "receipt-heartbeat-wrong-sequence",
          schemaVersion: "2.0",
          strategyVersion: "2.0.0-contract2",
          producerInstanceId: "entry-v3-canary-producer",
          sequence: 2,
        },
        heartbeat: { producerSequence: 2 },
      },
      {
        receiptId: "receipt-heartbeat-wrong-market",
        receipt: {
          receiptId: "receipt-heartbeat-wrong-market",
          schemaVersion: "2.0",
          strategyVersion: "2.0.0-contract2",
          producerInstanceId: "entry-v3-canary-producer",
          sequence: 1,
          symbol: "GBPUSD",
          tickerId: "VANTAGE:GBPUSD",
          feed: "OTHER",
        },
        heartbeat: {
          symbol: "GBPUSD",
          tickerId: "VANTAGE:GBPUSD",
          feed: "OTHER",
        },
      },
      {
        receiptId: "receipt-heartbeat-wrong-schedule",
        receipt: {
          receiptId: "receipt-heartbeat-wrong-schedule",
          schemaVersion: "2.0",
          strategyVersion: "2.0.0-contract2",
          producerInstanceId: "entry-v3-canary-producer",
          sequence: 1,
        },
        heartbeat: {
          barOpenEpoch: 1721808300,
          barCloseEpoch: 1721808600,
        },
      },
      {
        receiptId: "receipt-heartbeat-wrong-detector",
        receipt: {
          receiptId: "receipt-heartbeat-wrong-detector",
          schemaVersion: "2.0",
          strategyVersion: "2.0.0-contract2",
          producerInstanceId: "entry-v3-canary-producer",
          sequence: 1,
        },
        heartbeat: { detectorCodeHash: "5".repeat(64) },
      },
      {
        receiptId: "receipt-heartbeat-wrong-settings",
        receipt: {
          receiptId: "receipt-heartbeat-wrong-settings",
          schemaVersion: "2.0",
          strategyVersion: "2.0.0-contract2",
          producerInstanceId: "entry-v3-canary-producer",
          sequence: 1,
        },
        heartbeat: { settingsHash: "6".repeat(64) },
      },
    ];
    for (const mismatch of batchMismatchCases) {
      insertEntryStorageReceipt(database, mismatch.receipt);
      expect(() =>
        insertHeartbeat(mismatch.receiptId, mismatch.heartbeat),
      ).toThrow(/heartbeat batch provenance mismatch/u);
    }

    insertEntryStorageReceipt(database, {
      receiptId: "receipt-heartbeat-zero-hash",
      schemaVersion: "2.0",
      strategyVersion: "2.0.0-contract2",
      producerInstanceId: "entry-v3-canary-producer",
      sequence: 1,
    });
    expect(() =>
      insertHeartbeat("receipt-heartbeat-zero-hash", {
        detectorCodeHash: "0".repeat(64),
      }),
    ).toThrow();

    insertEntryStorageReceipt(database, {
      receiptId: "receipt-heartbeat-valid-v3",
      schemaVersion: "2.0",
      strategyVersion: "2.0.0-contract2",
      producerInstanceId: "entry-v3-canary-producer",
      sequence: 1,
    });
    expect(() =>
      insertHeartbeat("receipt-heartbeat-valid-v3"),
    ).not.toThrow();
  });

  it("enforces closed entry enums, JSON shapes, and authoritative proof planes", () => {
    const root = fileURLToPath(new URL("..", import.meta.url));
    const database = new DatabaseSync(":memory:");
    database.exec("PRAGMA foreign_keys = ON");
    applyObservationMigrationsThrough(database, root, 23);
    seedEntryStorage(database);

    const insertCandidateAs = (
      candidateId: string,
      model: string,
      sourceClaimIdsJson = '["standard-close-2024-03"]',
    ): void => {
      database
        .prepare(
          `INSERT INTO observation_entry_candidates (
            candidate_id, setup_id, model, state, event_anchor_epoch,
            trigger_ordinal, direction, source_claim_ids_json, normalized_from,
            identity_sha256, first_receipt_id, observed_at_epoch
          ) VALUES (
            ?, 'setup-entry-storage', ?, 'MATCHED', 1721808300,
            1, 'LONG', ?, NULL, ?, 'receipt-entry-storage-v3', 1721808300
          )`,
        )
        .run(candidateId, model, sourceClaimIdsJson, candidateId);
    };
    insertCandidateAs("5".repeat(64), "HTF_FLIP");
    insertCandidateAs("6".repeat(64), "LEGACY_BREAK_CANDLE");
    insertCandidateAs("7".repeat(64), "LEGACY_REJECTION_RESPECT");
    expect(
      database
        .prepare(
          `SELECT DISTINCT model
           FROM observation_entry_candidates
           ORDER BY model`,
        )
        .all()
        .map((row) => row.model),
    ).toEqual([
      "DIR_CLOSE",
      "HTF_FLIP",
      "LEGACY_BREAK_CANDLE",
      "LEGACY_REJECTION_RESPECT",
    ]);
    expect(() => insertCandidateAs("8".repeat(64), "BROKER_FILL")).toThrow(
      /CHECK constraint failed/u,
    );
    expect(() => insertCandidateAs("8".repeat(64), "DIR_CLOSE", "{}")).toThrow(
      /CHECK constraint failed/u,
    );

    expect(() =>
      database
        .prepare(
          `INSERT INTO observation_entry_candidate_evidence (
            evidence_id, candidate_id, receipt_id, observed_trigger_epoch,
            observed_trigger_ticks, htf_context_minutes_json, fidelity,
            proof_plane, proof_resolution_seconds, coverage_start_epoch,
            coverage_end_epoch, ambiguity_codes_json, passed_rule_ids_json,
            failed_rule_ids_json, source_claim_ids_json, payload_sha256,
            identity_sha256, observed_at_epoch
          ) SELECT
            ?, candidate_id, receipt_id, observed_trigger_epoch,
            observed_trigger_ticks, htf_context_minutes_json, fidelity,
            'REALTIME_TICK', 1, coverage_start_epoch, coverage_end_epoch,
            ambiguity_codes_json, passed_rule_ids_json, failed_rule_ids_json,
            source_claim_ids_json, payload_sha256, ?, observed_at_epoch
          FROM observation_entry_candidate_evidence
          WHERE evidence_id = ?`,
        )
        .run(
          "8".repeat(64),
          "8".repeat(64),
          ENTRY_STORAGE_IDS.evidence,
        ),
    ).toThrow(/CHECK constraint failed/u);
    expect(() =>
      database
        .prepare(
          `INSERT INTO observation_entry_candidate_evidence (
            evidence_id, candidate_id, receipt_id, observed_trigger_epoch,
            observed_trigger_ticks, htf_context_minutes_json, fidelity,
            proof_plane, proof_resolution_seconds, coverage_start_epoch,
            coverage_end_epoch, ambiguity_codes_json, passed_rule_ids_json,
            failed_rule_ids_json, source_claim_ids_json, payload_sha256,
            identity_sha256, observed_at_epoch
          ) SELECT
            ?, candidate_id, receipt_id, observed_trigger_epoch,
            observed_trigger_ticks, '{}', fidelity, proof_plane,
            proof_resolution_seconds, coverage_start_epoch, coverage_end_epoch,
            ambiguity_codes_json, passed_rule_ids_json, failed_rule_ids_json,
            source_claim_ids_json, payload_sha256, ?, observed_at_epoch
          FROM observation_entry_candidate_evidence
          WHERE evidence_id = ?`,
        )
        .run(
          "8".repeat(64),
          "8".repeat(64),
          ENTRY_STORAGE_IDS.evidence,
        ),
    ).toThrow(/CHECK constraint failed/u);

    const insertDiagnostic = (
      diagnosticId: string,
      candidateRefsJson: string,
      realtimeEvidenceRefsJson: string,
    ): void => {
      database
        .prepare(
          `INSERT INTO observation_entry_producer_diagnostics (
            diagnostic_id, batch_id, setup_id, candidate_refs_json,
            evidence_refs_json, realtime_evidence_refs_json,
            handling_refs_json, diagnostic_selection_json, observed_at
          ) VALUES (
            ?, ?, 'setup-entry-storage', ?, '[]', ?, '[]', NULL,
            '2026-07-24T10:00:00Z'
          )`,
        )
        .run(
          diagnosticId,
          ENTRY_STORAGE_IDS.batch,
          candidateRefsJson,
          realtimeEvidenceRefsJson,
        );
    };
    expect(() =>
      insertDiagnostic("diagnostic-scalar", "{}", "[]"),
    ).toThrow(/CHECK constraint failed/u);
    expect(() =>
      insertDiagnostic(
        "diagnostic-bad-realtime-resolution",
        "[]",
        `[{
          "proof_plane":"REALTIME_TICK",
          "proof_resolution_seconds":1,
          "observed_trigger_epoch":1721808300,
          "coverage_start_epoch":1721808300,
          "coverage_end_epoch":1721808300
        }]`,
      ),
    ).toThrow(/realtime evidence must be diagnostic point coverage/u);
    expect(() =>
      insertDiagnostic(
        "diagnostic-bad-realtime-coverage",
        "[]",
        `[{
          "proof_plane":"REALTIME_TICK",
          "proof_resolution_seconds":0,
          "observed_trigger_epoch":1721808300,
          "coverage_start_epoch":1721808000,
          "coverage_end_epoch":1721808300
        }]`,
      ),
    ).toThrow(/realtime evidence must be diagnostic point coverage/u);
    insertDiagnostic(
      "diagnostic-valid-realtime",
      "[]",
      `[{
        "proof_plane":"REALTIME_TICK",
        "proof_resolution_seconds":0,
        "observed_trigger_epoch":1721808300,
        "coverage_start_epoch":1721808300,
        "coverage_end_epoch":1721808300
      }]`,
    );
    expect(
      database
        .prepare(
          `SELECT json_array_length(realtime_evidence_refs_json) AS count
           FROM observation_entry_producer_diagnostics
           WHERE diagnostic_id = 'diagnostic-valid-realtime'`,
        )
        .get(),
    ).toEqual({ count: 1 });
  });

  it("rejects duplicate or ambiguous diagnostic proof-plane keys", () => {
    const root = fileURLToPath(new URL("..", import.meta.url));
    const database = new DatabaseSync(":memory:");
    database.exec("PRAGMA foreign_keys = ON");
    applyObservationMigrationsThrough(database, root, 23);
    seedEntryStorage(database);

    const insertDiagnostic = (
      diagnosticId: string,
      evidenceRefsJson: string,
      realtimeEvidenceRefsJson: string,
    ): void => {
      database
        .prepare(
          `INSERT INTO observation_entry_producer_diagnostics (
            diagnostic_id, batch_id, setup_id, candidate_refs_json,
            evidence_refs_json, realtime_evidence_refs_json,
            handling_refs_json, diagnostic_selection_json, observed_at
          ) VALUES (
            ?, ?, 'setup-entry-storage', '[]', ?, ?, '[]', NULL,
            '2026-07-24T10:00:00Z'
          )`,
        )
        .run(
          diagnosticId,
          ENTRY_STORAGE_IDS.batch,
          evidenceRefsJson,
          realtimeEvidenceRefsJson,
        );
    };
    const duplicateEvidenceProofPlane =
      '[{"proof_plane":"CONFIRMED_5M","proof_plane":"REALTIME_TICK"}]';
    expect(
      JSON.parse(duplicateEvidenceProofPlane)[0].proof_plane,
    ).toBe("REALTIME_TICK");
    expect(() =>
      insertDiagnostic(
        "diagnostic-duplicate-evidence-proof-plane",
        duplicateEvidenceProofPlane,
        "[]",
      ),
    ).toThrow(/diagnostic evidence proof planes invalid/u);

    for (const [diagnosticId, evidenceRefsJson] of [
      ["diagnostic-missing-evidence-proof-plane", '[{"fidelity":"EXACT"}]'],
      ["diagnostic-numeric-evidence-proof-plane", '[{"proof_plane":5}]'],
      [
        "diagnostic-unknown-evidence-proof-plane",
        '[{"proof_plane":"UNTRUSTED"}]',
      ],
      [
        "diagnostic-realtime-in-authoritative-evidence",
        '[{"proof_plane":"REALTIME_TICK"}]',
      ],
    ] as const) {
      expect(() =>
        insertDiagnostic(diagnosticId, evidenceRefsJson, "[]"),
      ).toThrow(/diagnostic evidence proof planes invalid/u);
    }

    const validRealtimeFields = [
      '"proof_plane":"REALTIME_TICK"',
      '"proof_resolution_seconds":0',
      '"observed_trigger_epoch":1721808300',
      '"coverage_start_epoch":1721808300',
      '"coverage_end_epoch":1721808300',
    ];
    for (const [diagnosticId, realtimeEvidenceRefsJson] of [
      [
        "diagnostic-duplicate-realtime-proof-plane",
        `[{${validRealtimeFields.join(
          ",",
        )},"proof_plane":"CONFIRMED_5M"}]`,
      ],
      [
        "diagnostic-duplicate-realtime-resolution",
        `[{${validRealtimeFields.join(
          ",",
        )},"proof_resolution_seconds":0}]`,
      ],
      [
        "diagnostic-missing-realtime-epoch",
        `[{${validRealtimeFields
          .filter((field) => !field.startsWith('"observed_trigger_epoch"'))
          .join(",")}}]`,
      ],
      [
        "diagnostic-string-realtime-coverage",
        `[{${validRealtimeFields
          .filter((field) => !field.startsWith('"coverage_end_epoch"'))
          .join(",")},"coverage_end_epoch":"1721808300"}]`,
      ],
    ] as const) {
      expect(() =>
        insertDiagnostic(diagnosticId, "[]", realtimeEvidenceRefsJson),
      ).toThrow(/realtime evidence must be diagnostic point coverage/u);
    }

    expect(() =>
      insertDiagnostic(
        "diagnostic-exact-proof-key-shapes",
        '[{"proof_plane":"LOWER_TIMEFRAME_REPLAY"}]',
        `[{${validRealtimeFields.join(",")},"fidelity":"EXACT"}]`,
      ),
    ).not.toThrow();
  });

  it("hardens persisted entry arrays, hashes, epochs, and claim relationships", () => {
    const root = fileURLToPath(new URL("..", import.meta.url));
    const database = new DatabaseSync(":memory:");
    database.exec("PRAGMA foreign_keys = ON");
    applyObservationMigrationsThrough(database, root, 23);
    seedEntryStorage(database);
    insertEntryStorageReceipt(database, {
      receiptId: "receipt-negative-open-batch",
      schemaVersion: "2.0",
      strategyVersion: "2.0.0-contract2",
      producerInstanceId: "negative-open-producer",
      sequence: 99,
    });

    expect(() =>
      database
        .prepare(
          `INSERT INTO observation_entry_batches (
            batch_id, producer_instance_id, producer_sequence, kind,
            bar_close_epoch, strategy_id, strategy_version,
            rule_contract_version, execution_mode, symbol, ticker_id, feed,
            timeframe, tick_size, bar_open_epoch, detector_code_hash,
            settings_hash, chunk_count, first_receipt_id, first_seen_at
          ) SELECT
            ?, 'negative-open-producer', 99, kind,
            200, strategy_id, strategy_version,
            rule_contract_version, execution_mode, symbol, ticker_id, feed,
            timeframe, tick_size, -100, detector_code_hash,
            settings_hash, chunk_count, 'receipt-negative-open-batch',
            first_seen_at
          FROM observation_entry_batches
          WHERE batch_id = ?`,
        )
        .run("8".repeat(64), ENTRY_STORAGE_IDS.batch),
    ).toThrow(/CHECK constraint failed/u);

    const insertQuarantineWithHashes = (
      quarantineId: string,
      existingSha256: string | null,
      presentedSha256: string,
    ): void => {
      database
        .prepare(
          `INSERT INTO observation_entry_quarantine (
            quarantine_id, receipt_id, batch_id, producer_instance_id,
            producer_sequence, presented_bar_close_epoch, object_kind,
            object_id, existing_sha256, presented_sha256, reason,
            quarantined_at
          ) VALUES (
            ?, 'receipt-entry-storage-v3', ?, NULL, NULL, NULL, 'CANDIDATE',
            ?, ?, ?, 'IMMUTABLE_ID_CONFLICT', '2026-07-24T10:00:04Z'
          )`,
        )
        .run(
          quarantineId,
          ENTRY_STORAGE_IDS.batch,
          ENTRY_STORAGE_IDS.candidate,
          existingSha256,
          presentedSha256,
        );
    };
    expect(() =>
      insertQuarantineWithHashes(
        "quarantine-uppercase-existing-hash",
        "A".repeat(64),
        "a".repeat(64),
      ),
    ).toThrow(/CHECK constraint failed/u);
    expect(() =>
      insertQuarantineWithHashes(
        "quarantine-short-presented-hash",
        null,
        "abc",
      ),
    ).toThrow(/CHECK constraint failed/u);
    expect(() =>
      insertQuarantineWithHashes(
        "quarantine-valid-domain-hashes",
        null,
        "a".repeat(64),
      ),
    ).not.toThrow();

    const insertCandidateClaims = (sourceClaimIdsJson: string): void => {
      database
        .prepare(
          `INSERT INTO observation_entry_candidates (
            candidate_id, setup_id, model, state, event_anchor_epoch,
            trigger_ordinal, direction, source_claim_ids_json, normalized_from,
            identity_sha256, first_receipt_id, observed_at_epoch
          ) SELECT
            ?, setup_id, model, state, event_anchor_epoch,
            trigger_ordinal, direction, ?, normalized_from,
            ?, first_receipt_id, observed_at_epoch
          FROM observation_entry_candidates
          WHERE candidate_id = ?`,
        )
        .run(
          "8".repeat(64),
          sourceClaimIdsJson,
          "8".repeat(64),
          ENTRY_STORAGE_IDS.candidate,
        );
    };
    for (const sourceClaimIdsJson of [
      "[1]",
      '["standard-close-2024-03","standard-close-2024-03"]',
      '["missing-source-claim"]',
    ]) {
      expect(() => insertCandidateClaims(sourceClaimIdsJson)).toThrow(
        /entry source claims invalid/u,
      );
    }

    type EvidenceArrays = {
      htfContexts: string;
      ambiguityCodes: string;
      passedRuleIds: string;
      failedRuleIds: string;
      sourceClaimIds: string;
    };
    const validEvidenceArrays: EvidenceArrays = {
      htfContexts: "[]",
      ambiguityCodes: "[]",
      passedRuleIds: '["ENTRY_DIR_CLOSE"]',
      failedRuleIds: "[]",
      sourceClaimIds: '["standard-close-2024-03"]',
    };
    const insertEvidenceArrays = (
      overrides: Partial<EvidenceArrays>,
    ): void => {
      const arrays = { ...validEvidenceArrays, ...overrides };
      database
        .prepare(
          `INSERT INTO observation_entry_candidate_evidence (
            evidence_id, candidate_id, receipt_id, observed_trigger_epoch,
            observed_trigger_ticks, htf_context_minutes_json, fidelity,
            proof_plane, proof_resolution_seconds, coverage_start_epoch,
            coverage_end_epoch, ambiguity_codes_json, passed_rule_ids_json,
            failed_rule_ids_json, source_claim_ids_json, payload_sha256,
            identity_sha256, observed_at_epoch
          ) SELECT
            ?, candidate_id, receipt_id, observed_trigger_epoch,
            observed_trigger_ticks, ?, fidelity,
            proof_plane, proof_resolution_seconds, coverage_start_epoch,
            coverage_end_epoch, ?, ?, ?, ?, payload_sha256,
            ?, observed_at_epoch
          FROM observation_entry_candidate_evidence
          WHERE evidence_id = ?`,
        )
        .run(
          "8".repeat(64),
          arrays.htfContexts,
          arrays.ambiguityCodes,
          arrays.passedRuleIds,
          arrays.failedRuleIds,
          arrays.sourceClaimIds,
          "8".repeat(64),
          ENTRY_STORAGE_IDS.evidence,
        );
    };
    expect(() =>
      insertEvidenceArrays({ sourceClaimIds: "[1]" }),
    ).toThrow(/entry source claims invalid/u);
    for (const htfContexts of [
      "[10]",
      '["15"]',
      "[15,15]",
      "[30,15]",
    ]) {
      expect(() => insertEvidenceArrays({ htfContexts })).toThrow(
        /entry evidence arrays invalid/u,
      );
    }
    for (const ambiguityCodes of [
      '["UNKNOWN"]',
      "[1]",
      '["SHADOW_SAME_CHILD_BAR_ORDER","SHADOW_SAME_CHILD_BAR_ORDER"]',
    ]) {
      expect(() => insertEvidenceArrays({ ambiguityCodes })).toThrow(
        /entry evidence arrays invalid/u,
      );
    }
    for (const passedRuleIds of [
      '["UNKNOWN"]',
      "[1]",
      '["ENTRY_DIR_CLOSE","ENTRY_DIR_CLOSE"]',
    ]) {
      expect(() => insertEvidenceArrays({ passedRuleIds })).toThrow(
        /entry evidence arrays invalid/u,
      );
    }
    expect(() =>
      insertEvidenceArrays({
        passedRuleIds: '["ENTRY_DIR_CLOSE"]',
        failedRuleIds: '["ENTRY_DIR_CLOSE"]',
      }),
    ).toThrow(/entry evidence arrays invalid/u);

    expect(() =>
      database
        .prepare(
          `INSERT INTO observation_entry_handling (
            handling_id, candidate_id, evidence_id, receipt_id, handling_mode,
            attempt_kind, observed_epoch, observed_ticks, fidelity,
            source_claim_ids_json, identity_sha256
          ) SELECT
            ?, candidate_id, evidence_id, receipt_id, handling_mode,
            attempt_kind, observed_epoch, observed_ticks, fidelity,
            '[1]', ?
          FROM observation_entry_handling
          WHERE handling_id = ?`,
        )
        .run(
          "8".repeat(64),
          "8".repeat(64),
          ENTRY_STORAGE_IDS.handling,
        ),
    ).toThrow(/entry source claims invalid/u);

    const insertSourceClaim = (
      claimId: string,
      publishedDate: string,
      relationship: "NARROWS" | "SUPPORTS",
    ): void => {
      database
        .prepare(
          `INSERT INTO observation_entry_source_claims (
            claim_id, contract_version, source_id, youtube_video_id,
            published_date, title_snapshot, channel_id, channel_handle,
            timestamp_start_seconds, timestamp_end_seconds, relationship,
            summary
          ) VALUES (
            ?, '2.0.0', ?, 'testVideo', ?, 'Test claim',
            'UC54xbL96tU58iez3YbTVTAg', '@RD_Forex',
            1, 2, ?, 'Relationship validation fixture.'
          )`,
        )
        .run(claimId, `source:${claimId}`, publishedDate, relationship);
    };
    expect(() =>
      database
        .prepare(
          `INSERT INTO observation_entry_source_claim_relationships (
            claim_id, target_claim_id
          ) VALUES ('standard-close-2024-03', 'closure-or-flip-2025-03')`,
        )
        .run(),
    ).toThrow(/source relationship invalid/u);

    insertSourceClaim(
      "narrowing-before-target",
      "2024-01-01",
      "NARROWS",
    );
    expect(() =>
      database
        .prepare(
          `INSERT INTO observation_entry_source_claim_relationships (
            claim_id, target_claim_id
          ) VALUES ('narrowing-before-target', 'closure-or-flip-2025-03')`,
        )
        .run(),
    ).toThrow(/source relationship invalid/u);

    insertSourceClaim(
      "narrowing-after-target",
      "2026-01-01",
      "NARROWS",
    );
    expect(() =>
      database
        .prepare(
          `INSERT INTO observation_entry_source_claim_relationships (
            claim_id, target_claim_id
          ) VALUES ('narrowing-after-target', 'standard-close-2024-03')`,
        )
        .run(),
    ).not.toThrow();
  });

  it("allows promotion mismatch only as a paper-to-shadow reduction", () => {
    const root = fileURLToPath(new URL("..", import.meta.url));
    const database = new DatabaseSync(":memory:");
    database.exec("PRAGMA foreign_keys = ON");
    applyObservationMigrationsThrough(database, root, 23);
    seedEntryStorage(database);

    const insertSelection = (
      selectionId: string,
      revision: number,
      policyAction: string,
      action: string,
      reason: string | null,
      canonicalModel = "DIR_CLOSE",
    ): void => {
      database
        .prepare(
          `INSERT INTO observation_entry_selections (
            selection_id, batch_id, setup_id, policy_version, revision,
            candidate_ids_considered_json, canonical_candidate_id,
            canonical_evidence_id, canonical_model, reason, fidelity,
            policy_action, action, effective_action_reason, evaluated_at_epoch
          ) VALUES (
            ?, ?, 'setup-entry-storage', 'rd-entry-arbitration-v2', ?,
            ?, ?, ?, ?, 'ONLY_EXACT_TRIGGER', 'EXACT', ?, ?, ?, 1721808300
          )`,
        )
        .run(
          selectionId,
          ENTRY_STORAGE_IDS.batch,
          revision,
          JSON.stringify([ENTRY_STORAGE_IDS.candidate]),
          ENTRY_STORAGE_IDS.candidate,
          ENTRY_STORAGE_IDS.evidence,
          canonicalModel,
          policyAction,
          action,
          reason,
        );
    };
    insertSelection("3".repeat(64), 2, "OBSERVE", "OBSERVE", null);
    expect(() =>
      insertSelection("4".repeat(64), 3, "PAPER_ELIGIBLE", "PAPER_ELIGIBLE", null),
    ).not.toThrow();
    expect(() =>
      insertSelection(
        "5".repeat(64),
        4,
        "PAPER_ELIGIBLE",
        "SHADOW_ONLY",
        null,
      ),
    ).toThrow(/CHECK constraint failed/u);
    expect(() =>
      insertSelection(
        "5".repeat(64),
        4,
        "OBSERVE",
        "SHADOW_ONLY",
        "PROMOTION_IDENTITY_MISMATCH",
      ),
    ).toThrow(/CHECK constraint failed/u);
    expect(() =>
      insertSelection(
        "5".repeat(64),
        4,
        "PAPER_ELIGIBLE",
        "PAPER_ELIGIBLE",
        "PROMOTION_IDENTITY_MISMATCH",
      ),
    ).toThrow(/CHECK constraint failed/u);
    expect(() =>
      insertSelection("5".repeat(64), 4, "PAPER_ELIGIBLE", "EXECUTE", null),
    ).toThrow(/CHECK constraint failed/u);
    expect(() =>
      insertSelection("5".repeat(64), 4, "OBSERVE", "OBSERVE", null, "LEGACY_BREAK_CANDLE"),
    ).toThrow(/CHECK constraint failed/u);

    expect(
      database
        .prepare(
          `SELECT policy_action, action, effective_action_reason
           FROM observation_entry_selections
           ORDER BY revision`,
        )
        .all(),
    ).toEqual([
      {
        policy_action: "PAPER_ELIGIBLE",
        action: "SHADOW_ONLY",
        effective_action_reason: "PROMOTION_IDENTITY_MISMATCH",
      },
      {
        policy_action: "OBSERVE",
        action: "OBSERVE",
        effective_action_reason: null,
      },
      {
        policy_action: "PAPER_ELIGIBLE",
        action: "PAPER_ELIGIBLE",
        effective_action_reason: null,
      },
    ]);
  });

  it("records every conflict class in append-only credential-free quarantine", () => {
    const root = fileURLToPath(new URL("..", import.meta.url));
    const database = new DatabaseSync(":memory:");
    database.exec("PRAGMA foreign_keys = ON");
    applyObservationMigrationsThrough(database, root, 23);
    seedEntryStorage(database);

    const reasons = [
      "IMMUTABLE_ID_CONFLICT",
      "INCONSISTENT_CHUNK_COUNT",
      "INCONSISTENT_BATCH_METADATA",
      "DUPLICATE_SETUP_ACROSS_CHUNKS",
      "BATCH_SETUP_LIMIT",
      "INCOMPLETE_BATCH",
      "EVENT_STREAM_CONTEXT_MISSING",
      "EVENT_STREAM_CONFLICT",
      "TERMINAL_FACT_CONFLICT",
      "SEQUENCE_CONFLICT",
      "BAR_CLOSE_CONFLICT",
      "SEQUENCE_TIME_CONFLICT",
      "PRODUCER_IDENTITY_CONFLICT",
    ] as const;
    for (const [index, reason] of reasons.entries()) {
      if (reason === "IMMUTABLE_ID_CONFLICT") continue;
      database
        .prepare(
          `INSERT INTO observation_entry_quarantine (
            quarantine_id, receipt_id, batch_id, producer_instance_id,
            producer_sequence, presented_bar_close_epoch, object_kind, object_id,
            existing_sha256, presented_sha256, reason, quarantined_at
          ) VALUES (
            ?, 'receipt-entry-storage-v3', ?, 'entry-v3-canary-producer',
            1, 1721808300, 'BATCH', ?, NULL, ?, ?, '2026-07-24T10:00:04Z'
          )`,
        )
        .run(
          `quarantine-entry-storage-${String(index).padStart(2, "0")}`,
          ENTRY_STORAGE_IDS.batch,
          ENTRY_STORAGE_IDS.batch,
          ENTRY_STORAGE_IDS.payload,
          reason,
        );
    }
    expect(
      database
        .prepare(
          `SELECT reason
           FROM observation_entry_quarantine
           ORDER BY reason`,
        )
        .all()
        .map((row) => row.reason),
    ).toEqual([...reasons].sort());
    expect(() =>
      database
        .prepare(
          `INSERT INTO observation_entry_quarantine (
            quarantine_id, receipt_id, batch_id, producer_instance_id,
            producer_sequence, presented_bar_close_epoch, object_kind, object_id,
            existing_sha256, presented_sha256, reason, quarantined_at
          ) VALUES (
            'quarantine-missing-conflict-identity', NULL, NULL, NULL,
            NULL, NULL, 'BATCH', 'unknown', NULL, ?,
            'SEQUENCE_CONFLICT', '2026-07-24T10:00:04Z'
          )`,
        )
        .run(ENTRY_STORAGE_IDS.payload),
    ).toThrow(/CHECK constraint failed/u);
    expect(
      database
        .prepare("PRAGMA table_info('observation_entry_quarantine')")
        .all()
        .map((row) => row.name),
    ).not.toEqual(
      expect.arrayContaining([
        "credential",
        "raw_credential",
        "raw_payload",
        "payload_json",
      ]),
    );
  });

  it("rejects updates and deletes on every entry audit projection", () => {
    const root = fileURLToPath(new URL("..", import.meta.url));
    const database = new DatabaseSync(":memory:");
    database.exec("PRAGMA foreign_keys = ON");
    applyObservationMigrationsThrough(database, root, 23);
    seedEntryStorage(database);

    const messages = new Map<string, readonly [string, string]>([
      [
        "observation_entry_candidates",
        ["entry candidates are immutable", "entry candidates are append-only"],
      ],
      [
        "observation_entry_candidate_evidence",
        ["entry evidence is immutable", "entry evidence is append-only"],
      ],
      [
        "observation_entry_handling",
        ["entry handling is immutable", "entry handling is append-only"],
      ],
      [
        "observation_entry_selections",
        ["entry selections are immutable", "entry selections are append-only"],
      ],
    ]);
    for (const table of ENTRY_STORAGE_TABLES) {
      const [updateMessage, deleteMessage] = messages.get(table) ?? [
        `${table} rows are immutable`,
        `${table} rows are append-only`,
      ];
      expect(() =>
        database.exec(`UPDATE ${table} SET rowid = rowid`),
      ).toThrow(updateMessage);
      expect(() => database.exec(`DELETE FROM ${table}`)).toThrow(
        deleteMessage,
      );
    }
  });

  it("blocks REPLACE for every primary and alternate immutable identity", () => {
    const root = fileURLToPath(new URL("..", import.meta.url));
    const database = new DatabaseSync(":memory:");
    database.exec("PRAGMA foreign_keys = ON");
    database.exec("PRAGMA recursive_triggers = OFF");
    applyObservationMigrationsThrough(database, root, 23);
    seedEntryStorage(database);
    expect(
      database.prepare("PRAGMA recursive_triggers").get(),
    ).toEqual({ recursive_triggers: 0 });

    const snapshot = (): ReadonlyMap<string, readonly unknown[]> =>
      new Map(
        ENTRY_STORAGE_TABLES.map((table) => [
          table,
          database.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
        ]),
      );
    const expectSnapshot = (
      expected: ReadonlyMap<string, readonly unknown[]>,
    ): void => {
      for (const table of ENTRY_STORAGE_TABLES) {
        expect(
          database.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
        ).toEqual(expected.get(table));
      }
    };
    const primaryReplacements = new Map<string, string>([
      [
        "observation_entry_quarantine",
        `INSERT OR REPLACE INTO observation_entry_quarantine
         SELECT quarantine_id, receipt_id, batch_id, producer_instance_id,
           producer_sequence, presented_bar_close_epoch, object_kind, object_id,
           existing_sha256, presented_sha256, reason,
           '2099-01-01T00:00:00Z'
         FROM observation_entry_quarantine`,
      ],
      [
        "observation_entry_parity",
        `INSERT OR REPLACE INTO observation_entry_parity
         SELECT parity_id, batch_id, setup_id, producer_diagnostic_id,
           selection_id, parity_status, mismatch_reason,
           '2099-01-01T00:00:00Z'
         FROM observation_entry_parity`,
      ],
      [
        "observation_entry_evaluation_members",
        `INSERT OR REPLACE INTO observation_entry_evaluation_members
         SELECT selection_id, object_kind, object_id
         FROM observation_entry_evaluation_members`,
      ],
      [
        "observation_entry_selections",
        `INSERT OR REPLACE INTO observation_entry_selections
         SELECT selection_id, batch_id, setup_id, policy_version, revision,
           candidate_ids_considered_json, canonical_candidate_id,
           canonical_evidence_id, canonical_model, reason, fidelity,
           policy_action, action, effective_action_reason,
           evaluated_at_epoch + 1
         FROM observation_entry_selections`,
      ],
      [
        "observation_entry_producer_diagnostics",
        `INSERT OR REPLACE INTO observation_entry_producer_diagnostics
         SELECT diagnostic_id, batch_id, setup_id, candidate_refs_json,
           evidence_refs_json, realtime_evidence_refs_json, handling_refs_json,
           diagnostic_selection_json, '2099-01-01T00:00:00Z'
         FROM observation_entry_producer_diagnostics`,
      ],
      [
        "observation_entry_handling",
        `INSERT OR REPLACE INTO observation_entry_handling
         SELECT handling_id, candidate_id, evidence_id, receipt_id,
           handling_mode, attempt_kind, observed_epoch + 1, observed_ticks,
           fidelity, source_claim_ids_json, identity_sha256
         FROM observation_entry_handling`,
      ],
      [
        "observation_entry_candidate_evidence",
        `INSERT OR REPLACE INTO observation_entry_candidate_evidence
         SELECT evidence_id, candidate_id, receipt_id, observed_trigger_epoch,
           observed_trigger_ticks, htf_context_minutes_json, fidelity,
           proof_plane, proof_resolution_seconds, coverage_start_epoch,
           coverage_end_epoch, ambiguity_codes_json, passed_rule_ids_json,
           failed_rule_ids_json, source_claim_ids_json, payload_sha256,
           identity_sha256, observed_at_epoch + 1
         FROM observation_entry_candidate_evidence`,
      ],
      [
        "observation_entry_candidates",
        `INSERT OR REPLACE INTO observation_entry_candidates
         SELECT candidate_id, setup_id, model, state, event_anchor_epoch,
           trigger_ordinal, direction, source_claim_ids_json, normalized_from,
           identity_sha256, first_receipt_id, observed_at_epoch + 1
         FROM observation_entry_candidates`,
      ],
      [
        "observation_entry_source_claim_relationships",
        `INSERT OR REPLACE INTO observation_entry_source_claim_relationships
         SELECT claim_id, target_claim_id
         FROM observation_entry_source_claim_relationships`,
      ],
      [
        "observation_entry_source_claims",
        `INSERT OR REPLACE INTO observation_entry_source_claims
         SELECT claim_id, contract_version, source_id, youtube_video_id,
           published_date, title_snapshot, channel_id, channel_handle,
           timestamp_start_seconds, timestamp_end_seconds, relationship,
           summary || ' changed'
         FROM observation_entry_source_claims
         WHERE claim_id = 'standard-close-2024-03'`,
      ],
      [
        "observation_entry_setup_terminals",
        `INSERT OR REPLACE INTO observation_entry_setup_terminals
         SELECT setup_id, terminal_reason, terminal_epoch, first_batch_id,
           first_receipt_id, '2099-01-01T00:00:00Z'
         FROM observation_entry_setup_terminals`,
      ],
      [
        "observation_entry_setup_events",
        `INSERT OR REPLACE INTO observation_entry_setup_events
         SELECT event_id, setup_id, batch_id, receipt_id,
           confirmed_bar_close_epoch, proof_input_sha256, proof_input_json,
           '2099-01-01T00:00:00Z'
         FROM observation_entry_setup_events`,
      ],
      [
        "observation_entry_batch_completions",
        `INSERT OR REPLACE INTO observation_entry_batch_completions
         SELECT completion_id, batch_id, assembled_payload_sha256,
           '2099-01-01T00:00:00Z'
         FROM observation_entry_batch_completions`,
      ],
      [
        "observation_entry_chunks",
        `INSERT OR REPLACE INTO observation_entry_chunks
         SELECT batch_id, chunk_index, chunk_count, receipt_id, payload_sha256,
           validated_payload_json, '2099-01-01T00:00:00Z'
         FROM observation_entry_chunks`,
      ],
      [
        "observation_market_bar_heartbeats",
        `INSERT OR REPLACE INTO observation_market_bar_heartbeats
         SELECT receipt_id, batch_id, schema_version, producer_role,
           producer_instance_id, producer_sequence, strategy_version, symbol,
           ticker_id, feed, timeframe, bar_open_epoch, bar_close_epoch,
           detector_code_hash, settings_hash, '2099-01-01T00:00:00Z'
         FROM observation_market_bar_heartbeats
         WHERE schema_version = '1.2'`,
      ],
      [
        "observation_entry_batches",
        `INSERT OR REPLACE INTO observation_entry_batches
         SELECT batch_id, producer_instance_id, producer_sequence, kind,
           bar_close_epoch, strategy_id, strategy_version,
           rule_contract_version, execution_mode, symbol, ticker_id, feed,
           timeframe, tick_size, bar_open_epoch, detector_code_hash,
           settings_hash, chunk_count, first_receipt_id,
           '2099-01-01T00:00:00Z'
         FROM observation_entry_batches`,
      ],
    ]);
    const beforePrimaryReplacements = snapshot();
    for (const [table, sql] of primaryReplacements) {
      expect(() => database.exec(sql), table).toThrow(
        new RegExp(`${table} immutable insert conflict`, "u"),
      );
      expectSnapshot(beforePrimaryReplacements);
    }

    insertEntryStorageReceipt(database, {
      receiptId: "receipt-replace-alternate-batch",
      schemaVersion: "2.0",
      strategyVersion: "2.0.0-contract2",
      producerInstanceId: "alternate-key-producer",
      sequence: 5,
    });
    insertEntryStorageReceipt(database, {
      receiptId: "receipt-replace-close-conflict",
      schemaVersion: "2.0",
      strategyVersion: "2.0.0-contract2",
      producerInstanceId: "entry-v3-canary-producer",
      sequence: 11,
    });
    database.exec(`
      INSERT INTO observation_entry_batches (
        batch_id, producer_instance_id, producer_sequence, kind,
        bar_close_epoch, strategy_id, strategy_version, rule_contract_version,
        execution_mode, symbol, ticker_id, feed, timeframe, tick_size,
        bar_open_epoch, detector_code_hash, settings_hash, chunk_count,
        first_receipt_id, first_seen_at
      )
      SELECT
        '${"0".repeat(63)}5', 'alternate-key-producer', 5, kind,
        bar_close_epoch + 300, strategy_id, strategy_version,
        rule_contract_version, execution_mode, symbol, ticker_id, feed,
        timeframe, tick_size, bar_open_epoch + 300, detector_code_hash,
        settings_hash, 1, 'receipt-replace-alternate-batch', first_seen_at
      FROM observation_entry_batches
      WHERE batch_id = '${ENTRY_STORAGE_IDS.batch}'
    `);
    const alternateKeyReplacements = [
      `INSERT OR REPLACE INTO observation_entry_batches
       SELECT '${"0".repeat(63)}6', producer_instance_id, producer_sequence,
         kind, bar_close_epoch + 600, strategy_id, strategy_version,
         rule_contract_version, execution_mode, symbol, ticker_id, feed,
         timeframe, tick_size, bar_open_epoch + 600, detector_code_hash,
         settings_hash, chunk_count, first_receipt_id, first_seen_at
       FROM observation_entry_batches
       WHERE batch_id = '${ENTRY_STORAGE_IDS.batch}'`,
      `INSERT OR REPLACE INTO observation_entry_batches
       SELECT '${"0".repeat(63)}7', producer_instance_id,
         producer_sequence + 10, kind, bar_close_epoch, strategy_id,
         strategy_version, rule_contract_version, execution_mode, symbol,
         ticker_id, feed, timeframe, tick_size, bar_open_epoch,
         detector_code_hash, settings_hash, chunk_count,
         'receipt-replace-close-conflict', first_seen_at
       FROM observation_entry_batches
       WHERE batch_id = '${ENTRY_STORAGE_IDS.batch}'`,
      `INSERT OR REPLACE INTO observation_entry_chunks
       SELECT '${"0".repeat(63)}5', 0, 1, receipt_id, payload_sha256,
         validated_payload_json, recorded_at
       FROM observation_entry_chunks`,
      `INSERT OR REPLACE INTO observation_entry_batch_completions
       SELECT '${"0".repeat(63)}6', batch_id, assembled_payload_sha256,
         completed_at
       FROM observation_entry_batch_completions`,
      `INSERT OR REPLACE INTO observation_entry_setup_events
       SELECT '${"0".repeat(63)}6', setup_id, batch_id, receipt_id,
         confirmed_bar_close_epoch, proof_input_sha256, proof_input_json,
         recorded_at
       FROM observation_entry_setup_events`,
      `INSERT OR REPLACE INTO observation_entry_candidates
       SELECT '${"0".repeat(63)}6', setup_id, model, state,
         event_anchor_epoch, trigger_ordinal, direction, source_claim_ids_json,
         normalized_from, identity_sha256, first_receipt_id, observed_at_epoch
       FROM observation_entry_candidates`,
      `INSERT OR REPLACE INTO observation_entry_candidate_evidence
       SELECT '${"0".repeat(63)}6', candidate_id, receipt_id,
         observed_trigger_epoch, observed_trigger_ticks,
         htf_context_minutes_json, fidelity, proof_plane,
         proof_resolution_seconds, coverage_start_epoch, coverage_end_epoch,
         ambiguity_codes_json, passed_rule_ids_json, failed_rule_ids_json,
         source_claim_ids_json, payload_sha256, identity_sha256,
         observed_at_epoch
       FROM observation_entry_candidate_evidence`,
      `INSERT OR REPLACE INTO observation_entry_handling
       SELECT '${"0".repeat(63)}6', candidate_id, evidence_id, receipt_id,
         handling_mode, attempt_kind, observed_epoch, observed_ticks, fidelity,
         source_claim_ids_json, identity_sha256
       FROM observation_entry_handling`,
      `INSERT OR REPLACE INTO observation_entry_selections
       SELECT '${"0".repeat(63)}6', batch_id, setup_id, policy_version,
         revision, candidate_ids_considered_json, canonical_candidate_id,
         canonical_evidence_id, canonical_model, reason, fidelity,
         policy_action, action, effective_action_reason, evaluated_at_epoch
       FROM observation_entry_selections`,
    ];
    const beforeAlternateReplacements = snapshot();
    for (const sql of alternateKeyReplacements) {
      expect(() => database.exec(sql)).toThrow(/immutable insert conflict/u);
      expectSnapshot(beforeAlternateReplacements);
    }
  });

  it("rejects cross-owned handling and incoherent canonical selections", () => {
    const root = fileURLToPath(new URL("..", import.meta.url));
    const database = new DatabaseSync(":memory:");
    database.exec("PRAGMA foreign_keys = ON");
    applyObservationMigrationsThrough(database, root, 23);
    seedEntryStorage(database);
    seedAlternateEntryOwnership(database);

    expect(() =>
      database
        .prepare(
          `INSERT INTO observation_entry_handling (
            handling_id, candidate_id, evidence_id, receipt_id, handling_mode,
            attempt_kind, observed_epoch, observed_ticks, fidelity,
            source_claim_ids_json, identity_sha256
          ) VALUES (
            ?, ?, ?, 'receipt-entry-storage-v3', 'CLOSE_CONFIRMATION',
            'INITIAL', 1721808300, 110000, 'EXACT',
            '["standard-close-2024-03"]', ?
          )`,
        )
        .run(
          "8".repeat(64),
          ENTRY_STORAGE_IDS.candidate,
          "6".repeat(64),
          "8".repeat(64),
        ),
    ).toThrow(/handling evidence ownership mismatch/u);

    const insertCanonicalSelection = (
      setupId: string,
      consideredIds: readonly string[],
      candidateId: string,
      evidenceId: string,
      model: "DIR_CLOSE" | "HTF_FLIP",
    ): void => {
      database
        .prepare(
          `INSERT INTO observation_entry_selections (
            selection_id, batch_id, setup_id, policy_version, revision,
            candidate_ids_considered_json, canonical_candidate_id,
            canonical_evidence_id, canonical_model, reason, fidelity,
            policy_action, action, effective_action_reason, evaluated_at_epoch
          ) VALUES (
            ?, ?, ?, 'rd-entry-arbitration-v2', 2, ?, ?, ?, ?,
            'ONLY_EXACT_TRIGGER', 'EXACT', 'OBSERVE', 'OBSERVE', NULL,
            1721808300
          )`,
        )
        .run(
          "3".repeat(64),
          ENTRY_STORAGE_IDS.batch,
          setupId,
          JSON.stringify(consideredIds),
          candidateId,
          evidenceId,
          model,
        );
    };
    expect(() =>
      insertCanonicalSelection(
        "setup-entry-storage-other",
        ["5".repeat(64)],
        ENTRY_STORAGE_IDS.candidate,
        ENTRY_STORAGE_IDS.evidence,
        "DIR_CLOSE",
      ),
    ).toThrow(/selection (?:ownership mismatch|candidates considered invalid)/u);
    expect(() =>
      insertCanonicalSelection(
        "setup-entry-storage",
        [ENTRY_STORAGE_IDS.candidate],
        ENTRY_STORAGE_IDS.candidate,
        "6".repeat(64),
        "DIR_CLOSE",
      ),
    ).toThrow(/selection ownership mismatch/u);
    expect(() =>
      insertCanonicalSelection(
        "setup-entry-storage",
        [ENTRY_STORAGE_IDS.candidate],
        ENTRY_STORAGE_IDS.candidate,
        ENTRY_STORAGE_IDS.evidence,
        "HTF_FLIP",
      ),
    ).toThrow(/selection ownership mismatch/u);
  });

  it("validates considered candidates and polymorphic evaluation ownership", () => {
    const root = fileURLToPath(new URL("..", import.meta.url));
    const database = new DatabaseSync(":memory:");
    database.exec("PRAGMA foreign_keys = ON");
    applyObservationMigrationsThrough(database, root, 23);
    seedEntryStorage(database);
    seedAlternateEntryOwnership(database);

    const insertNoCandidateSelection = (
      candidateIdsJson: string,
    ): void => {
      database
        .prepare(
          `INSERT INTO observation_entry_selections (
            selection_id, batch_id, setup_id, policy_version, revision,
            candidate_ids_considered_json, canonical_candidate_id,
            canonical_evidence_id, canonical_model, reason, fidelity,
            policy_action, action, effective_action_reason, evaluated_at_epoch
          ) VALUES (
            ?, ?, 'setup-entry-storage', 'rd-entry-arbitration-v2', 2,
            ?, NULL, NULL, NULL, 'NO_CANDIDATE', NULL,
            'NONE', 'NONE', NULL, 1721808300
          )`,
        )
        .run("3".repeat(64), ENTRY_STORAGE_IDS.batch, candidateIdsJson);
    };
    for (const candidateIdsJson of [
      "[1]",
      "[null]",
      JSON.stringify([
        ENTRY_STORAGE_IDS.candidate,
        ENTRY_STORAGE_IDS.candidate,
      ]),
      JSON.stringify(["0".repeat(64)]),
      JSON.stringify(["5".repeat(64)]),
    ]) {
      expect(
        () => insertNoCandidateSelection(candidateIdsJson),
        candidateIdsJson,
      ).toThrow(/selection candidates considered invalid/u);
    }
    expect(() =>
      database
        .prepare(
          `INSERT INTO observation_entry_selections (
            selection_id, batch_id, setup_id, policy_version, revision,
            candidate_ids_considered_json, canonical_candidate_id,
            canonical_evidence_id, canonical_model, reason, fidelity,
            policy_action, action, effective_action_reason, evaluated_at_epoch
          ) VALUES (
            ?, ?, 'setup-entry-storage', 'rd-entry-arbitration-v2', 2,
            '[]', ?, ?, 'DIR_CLOSE', 'ONLY_EXACT_TRIGGER', 'EXACT',
            'OBSERVE', 'OBSERVE', NULL, 1721808300
          )`,
        )
        .run(
          "3".repeat(64),
          ENTRY_STORAGE_IDS.batch,
          ENTRY_STORAGE_IDS.candidate,
          ENTRY_STORAGE_IDS.evidence,
        ),
    ).toThrow(/selection candidates considered invalid/u);

    const insertEvaluationMember = (
      objectKind: "CANDIDATE" | "EVIDENCE" | "HANDLING",
      objectId: string,
    ): void => {
      database
        .prepare(
          `INSERT INTO observation_entry_evaluation_members (
            selection_id, object_kind, object_id
          ) VALUES (?, ?, ?)`,
        )
        .run(ENTRY_STORAGE_IDS.selection, objectKind, objectId);
    };
    for (const [objectKind, objectId] of [
      ["CANDIDATE", "0".repeat(64)],
      ["CANDIDATE", "5".repeat(64)],
      ["EVIDENCE", "0".repeat(64)],
      ["EVIDENCE", "6".repeat(64)],
      ["HANDLING", "0".repeat(64)],
      ["HANDLING", "7".repeat(64)],
    ] as const) {
      expect(
        () => insertEvaluationMember(objectKind, objectId),
        `${objectKind}:${objectId}`,
      ).toThrow(/evaluation member ownership mismatch/u);
    }
  });

  it("requires parity batch and setup agreement across both owners", () => {
    const root = fileURLToPath(new URL("..", import.meta.url));
    const database = new DatabaseSync(":memory:");
    database.exec("PRAGMA foreign_keys = ON");
    applyObservationMigrationsThrough(database, root, 23);
    seedEntryStorage(database);
    seedAlternateEntryOwnership(database);
    insertEntryStorageReceipt(database, {
      receiptId: "receipt-parity-other-batch",
      schemaVersion: "2.0",
      strategyVersion: "2.0.0-contract2",
      producerInstanceId: "parity-other-producer",
      sequence: 2,
    });
    database.exec(`
      INSERT INTO observation_entry_batches (
        batch_id, producer_instance_id, producer_sequence, kind,
        bar_close_epoch, strategy_id, strategy_version, rule_contract_version,
        execution_mode, symbol, ticker_id, feed, timeframe, tick_size,
        bar_open_epoch, detector_code_hash, settings_hash, chunk_count,
        first_receipt_id, first_seen_at
      )
      SELECT
        '${"0".repeat(63)}5', 'parity-other-producer', 2, kind,
        bar_close_epoch + 300, strategy_id, strategy_version,
        rule_contract_version, execution_mode, symbol, ticker_id, feed,
        timeframe, tick_size, bar_open_epoch + 300, detector_code_hash,
        settings_hash, 1, 'receipt-parity-other-batch', first_seen_at
      FROM observation_entry_batches
      WHERE batch_id = '${ENTRY_STORAGE_IDS.batch}'
    `);
    database
      .prepare(
        `INSERT INTO observation_entry_producer_diagnostics (
          diagnostic_id, batch_id, setup_id, candidate_refs_json,
          evidence_refs_json, realtime_evidence_refs_json, handling_refs_json,
          diagnostic_selection_json, observed_at
        ) VALUES (
          'diagnostic-entry-storage-other', ?,
          'setup-entry-storage-other', '[]', '[]', '[]', '[]', NULL,
          '2026-07-24T10:00:00Z'
        )`,
      )
      .run(ENTRY_STORAGE_IDS.batch);
    database
      .prepare(
        `INSERT INTO observation_entry_selections (
          selection_id, batch_id, setup_id, policy_version, revision,
          candidate_ids_considered_json, canonical_candidate_id,
          canonical_evidence_id, canonical_model, reason, fidelity,
          policy_action, action, effective_action_reason, evaluated_at_epoch
        ) VALUES (
          ?, ?, 'setup-entry-storage-other', 'rd-entry-arbitration-v2', 1,
          ?, ?, ?, 'HTF_FLIP', 'ONLY_EXACT_TRIGGER', 'EXACT',
          'OBSERVE', 'OBSERVE', NULL, 1721808300
        )`,
      )
      .run(
        "4".repeat(64),
        ENTRY_STORAGE_IDS.batch,
        JSON.stringify(["5".repeat(64)]),
        "5".repeat(64),
        "6".repeat(64),
      );

    const insertParity = (
      batchId: string,
      setupId: string,
      diagnosticId: string,
      selectionId: string,
    ): void => {
      database
        .prepare(
          `INSERT INTO observation_entry_parity (
            parity_id, batch_id, setup_id, producer_diagnostic_id,
            selection_id, parity_status, mismatch_reason, compared_at
          ) VALUES (
            ?, ?, ?, ?, ?, 'MATCH', NULL, '2026-07-24T10:00:03Z'
          )`,
        )
        .run("3".repeat(64), batchId, setupId, diagnosticId, selectionId);
    };
    expect(() =>
      insertParity(
        `${"0".repeat(63)}5`,
        "setup-entry-storage",
        "diagnostic-entry-storage",
        ENTRY_STORAGE_IDS.selection,
      ),
    ).toThrow(/parity ownership mismatch/u);
    expect(() =>
      insertParity(
        ENTRY_STORAGE_IDS.batch,
        "setup-entry-storage-other",
        "diagnostic-entry-storage",
        ENTRY_STORAGE_IDS.selection,
      ),
    ).toThrow(/parity ownership mismatch/u);
    expect(() =>
      insertParity(
        ENTRY_STORAGE_IDS.batch,
        "setup-entry-storage",
        "diagnostic-entry-storage-other",
        ENTRY_STORAGE_IDS.selection,
      ),
    ).toThrow(/parity ownership mismatch/u);
    expect(() =>
      insertParity(
        ENTRY_STORAGE_IDS.batch,
        "setup-entry-storage",
        "diagnostic-entry-storage",
        "4".repeat(64),
      ),
    ).toThrow(/parity ownership mismatch/u);
  });

  it("executes entry storage SQL constants with complete row shapes", async () => {
    const queries = await import("../src/rd-entry-queries");
    const root = fileURLToPath(new URL("..", import.meta.url));
    const database = new DatabaseSync(":memory:");
    database.exec("PRAGMA foreign_keys = ON");
    applyObservationMigrationsThrough(database, root, 23);
    insertEntryStorageReceipt(database, {
      receiptId: "receipt-entry-query-v3",
      schemaVersion: "2.0",
      strategyVersion: "2.0.0-contract2",
      producerInstanceId: "entry-query-producer",
      sequence: 1,
    });
    for (const sequence of [2, 3]) {
      insertEntryStorageReceipt(database, {
        receiptId: `receipt-entry-query-v3-${sequence}`,
        schemaVersion: "2.0",
        strategyVersion: "2.0.0-contract2",
        producerInstanceId: "entry-query-producer",
        sequence,
      });
    }

    const insertBatch = (
      batchId: string,
      sequence: number,
      barOpenEpoch: number,
      barCloseEpoch: number,
    ): void => {
      database.prepare(queries.INSERT_ENTRY_BATCH_SQL).run(
        batchId,
        "entry-query-producer",
        sequence,
        "snapshot",
        barCloseEpoch,
        "rd_liquidity_sd_5m_v1",
        "2.0.0-contract2",
        "2.0.0",
        "OBSERVATION_ONLY",
        "EURUSD",
        "VANTAGE:EURUSD",
        "VANTAGE",
        "5",
        "0.00001",
        barOpenEpoch,
        "3".repeat(64),
        "4".repeat(64),
        1,
        sequence === 1
          ? "receipt-entry-query-v3"
          : `receipt-entry-query-v3-${sequence}`,
        "2026-07-24T10:00:00Z",
      );
    };
    insertBatch(ENTRY_STORAGE_IDS.batch, 1, 1721808000, 1721808300);
    insertBatch("8".repeat(64), 2, 1721808300, 1721808600);
    insertBatch("7".repeat(64), 3, 1721808600, 1721808900);
    expect(
      database
        .prepare(queries.SELECT_ENTRY_BATCH_SQL)
        .get(ENTRY_STORAGE_IDS.batch),
    ).toMatchObject({
      batch_id: ENTRY_STORAGE_IDS.batch,
      producer_sequence: 1,
      bar_open_epoch: 1721808000,
      bar_close_epoch: 1721808300,
      execution_mode: "OBSERVATION_ONLY",
    });
    expect(
      database
        .prepare(queries.SELECT_ENTRY_BATCH_BY_SEQUENCE_SQL)
        .get("entry-query-producer", 2),
    ).toMatchObject({
      batch_id: "8".repeat(64),
      producer_sequence: 2,
    });
    expect(
      database
        .prepare(queries.SELECT_ENTRY_BATCH_BY_CLOSE_SQL)
        .get("entry-query-producer", 1721808900),
    ).toMatchObject({
      batch_id: "7".repeat(64),
      producer_sequence: 3,
    });
    expect(
      database
        .prepare(queries.SELECT_ENTRY_SEQUENCE_NEIGHBORS_SQL)
        .all(
          "entry-query-producer",
          "entry-query-producer",
          2,
          "entry-query-producer",
          2,
        )
        .map((row) => ({
          producer_sequence: row.producer_sequence,
          bar_close_epoch: row.bar_close_epoch,
        })),
    ).toEqual([
      { producer_sequence: 1, bar_close_epoch: 1721808300 },
      { producer_sequence: 3, bar_close_epoch: 1721808900 },
    ]);

    database.prepare(queries.INSERT_MARKET_BAR_HEARTBEAT_SQL).run(
      "receipt-entry-query-v3",
      ENTRY_STORAGE_IDS.batch,
      "2.0",
      "ENTRY_V3_CANARY",
      "entry-query-producer",
      1,
      "2.0.0-contract2",
      "EURUSD",
      "VANTAGE:EURUSD",
      "VANTAGE",
      "5",
      1721808000,
      1721808300,
      "3".repeat(64),
      "4".repeat(64),
      "2026-07-24T10:00:00Z",
    );
    database.prepare(queries.INSERT_ENTRY_CHUNK_SQL).run(
      ENTRY_STORAGE_IDS.batch,
      0,
      1,
      "receipt-entry-query-v3",
      ENTRY_STORAGE_IDS.payload,
      '{"eb":[]}',
      "2026-07-24T10:00:00Z",
    );
    expect(
      database
        .prepare(queries.LIST_ENTRY_CHUNKS_SQL)
        .all(ENTRY_STORAGE_IDS.batch),
    ).toEqual([
      {
        batch_id: ENTRY_STORAGE_IDS.batch,
        chunk_index: 0,
        chunk_count: 1,
        receipt_id: "receipt-entry-query-v3",
        payload_sha256: ENTRY_STORAGE_IDS.payload,
        validated_payload_json: '{"eb":[]}',
        recorded_at: "2026-07-24T10:00:00Z",
      },
    ]);
    database.prepare(queries.INSERT_ENTRY_COMPLETION_SQL).run(
      ENTRY_STORAGE_IDS.completion,
      ENTRY_STORAGE_IDS.batch,
      ENTRY_STORAGE_IDS.payload,
      "2026-07-24T10:00:01Z",
    );
    expect(
      database
        .prepare(queries.SELECT_ENTRY_COMPLETION_SQL)
        .get(ENTRY_STORAGE_IDS.batch),
    ).toEqual({
      completion_id: ENTRY_STORAGE_IDS.completion,
      batch_id: ENTRY_STORAGE_IDS.batch,
      assembled_payload_sha256: ENTRY_STORAGE_IDS.payload,
      completed_at: "2026-07-24T10:00:01Z",
    });
    database.prepare(queries.INSERT_ENTRY_SETUP_EVENT_SQL).run(
      ENTRY_STORAGE_IDS.event,
      "setup-entry-query",
      ENTRY_STORAGE_IDS.batch,
      "receipt-entry-query-v3",
      1721808300,
      ENTRY_STORAGE_IDS.payload,
      '{"confirmed_bar":{"close_epoch":1721808300}}',
      "2026-07-24T10:00:00Z",
    );
    expect(
      database
        .prepare(queries.SELECT_ENTRY_SETUP_EVENTS_SQL)
        .all("setup-entry-query"),
    ).toEqual([
      ENTRY_STORAGE_ROW_TYPE_FIXTURES.setupEvent,
    ].map((event) => ({ ...event, setup_id: "setup-entry-query", receipt_id: "receipt-entry-query-v3" })));
    database.prepare(queries.INSERT_ENTRY_TERMINAL_SQL).run(
      "setup-entry-query",
      "BOTH_ACTIVE_MODELS_OBSERVED",
      1721808300,
      ENTRY_STORAGE_IDS.batch,
      "receipt-entry-query-v3",
      "2026-07-24T10:00:02Z",
    );
    expect(
      database
        .prepare(queries.SELECT_ENTRY_TERMINAL_SQL)
        .get("setup-entry-query"),
    ).toEqual({
      ...ENTRY_STORAGE_ROW_TYPE_FIXTURES.setupTerminal,
      setup_id: "setup-entry-query",
      first_receipt_id: "receipt-entry-query-v3",
    });

    const insertSourceClaim = (
      claimId: string,
      sourceId: string,
      videoId: string,
      publishedDate: string,
      title: string,
      start: number,
      end: number,
      relationship: "SUPPORTS" | "NARROWS",
      summary: string,
    ): void => {
      database.prepare(queries.INSERT_ENTRY_SOURCE_CLAIM_SQL).run(
        claimId,
        sourceId,
        videoId,
        publishedDate,
        title,
        "UC54xbL96tU58iez3YbTVTAg",
        "@RD_Forex",
        start,
        end,
        relationship,
        summary,
      );
    };
    insertSourceClaim(
      "standard-close-2024-03",
      "rd-course-2024-03",
      "kxh_3__oAqg",
      "2024-03-25",
      "FULL course for LIQUIDITY supply and demand best NEW trading strategy 2026",
      794,
      876,
      "SUPPORTS",
      "Official claim covering the standard close entry model.",
    );
    insertSourceClaim(
      "closure-or-flip-2025-03",
      "rd-first-5m-live-2025-03",
      "Gr0njSOtC10",
      "2025-03-20",
      "First 5m livestream (1 win 1 loss) 1:2.5r trade on gj",
      3106,
      3149,
      "NARROWS",
      "Official narrowing claim for close-or-flip selection.",
    );
    database.prepare(queries.INSERT_ENTRY_SOURCE_RELATIONSHIP_SQL).run(
      "closure-or-flip-2025-03",
      "standard-close-2024-03",
    );
    expect(() =>
      database.prepare(queries.INSERT_ENTRY_SOURCE_CLAIM_SQL).run(
        "unofficial-claim",
        "unofficial-source",
        "unofficial",
        "2026-07-24",
        "Untrusted metadata",
        "UNOFFICIAL_CHANNEL",
        "@unofficial",
        0,
        1,
        "SUPPORTS",
        "Must not persist.",
      ),
    ).toThrow(/CHECK constraint failed/u);
    expect(
      database
        .prepare(
          `SELECT *
           FROM observation_entry_source_claims
           WHERE claim_id = 'standard-close-2024-03'`,
        )
        .get(),
    ).toEqual(ENTRY_STORAGE_ROW_TYPE_FIXTURES.sourceClaim);
    expect(
      database
        .prepare(
          `SELECT claim_id
           FROM observation_entry_source_claims
           WHERE claim_id = 'unofficial-claim'`,
        )
        .all(),
    ).toEqual([]);

    database.prepare(queries.INSERT_ENTRY_CANDIDATES_SQL).run(
      "receipt-entry-query-v3",
      JSON.stringify([
        {
          candidate_id: ENTRY_STORAGE_IDS.candidate,
          setup_id: "setup-entry-query",
          model: "DIR_CLOSE",
          state: "MATCHED",
          event_anchor_epoch: 1721808300,
          trigger_ordinal: 1,
          direction: "LONG",
          source_claim_ids_json: '["standard-close-2024-03"]',
          normalized_from: null,
          identity_sha256: ENTRY_STORAGE_IDS.candidate,
          observed_at_epoch: 1721808300,
        },
      ]),
    );
    database.prepare(queries.INSERT_ENTRY_EVIDENCE_SQL).run(
      "receipt-entry-query-v3",
      JSON.stringify([
        {
          evidence_id: ENTRY_STORAGE_IDS.evidence,
          candidate_id: ENTRY_STORAGE_IDS.candidate,
          observed_trigger_epoch: 1721808300,
          observed_trigger_ticks: 110000,
          htf_context_minutes_json: "[]",
          fidelity: "EXACT",
          proof_plane: "CONFIRMED_5M",
          proof_resolution_seconds: 300,
          coverage_start_epoch: 1721808000,
          coverage_end_epoch: 1721808300,
          ambiguity_codes_json: "[]",
          passed_rule_ids_json: '["ENTRY_DIR_CLOSE"]',
          failed_rule_ids_json: "[]",
          source_claim_ids_json: '["standard-close-2024-03"]',
          payload_sha256: ENTRY_STORAGE_IDS.payload,
          identity_sha256: ENTRY_STORAGE_IDS.evidence,
          observed_at_epoch: 1721808300,
        },
      ]),
    );
    database.prepare(queries.INSERT_ENTRY_HANDLING_SQL).run(
      "receipt-entry-query-v3",
      JSON.stringify([
        {
          handling_id: ENTRY_STORAGE_IDS.handling,
          candidate_id: ENTRY_STORAGE_IDS.candidate,
          evidence_id: ENTRY_STORAGE_IDS.evidence,
          handling_mode: "CLOSE_CONFIRMATION",
          attempt_kind: "INITIAL",
          observed_epoch: 1721808300,
          observed_ticks: 110000,
          fidelity: "EXACT",
          source_claim_ids_json: '["standard-close-2024-03"]',
          identity_sha256: ENTRY_STORAGE_IDS.handling,
        },
      ]),
    );
    expect(
      database
        .prepare(queries.SELECT_ENTRY_IDENTITIES_SQL)
        .all(
          JSON.stringify([ENTRY_STORAGE_IDS.candidate]),
          JSON.stringify([ENTRY_STORAGE_IDS.evidence]),
          JSON.stringify([ENTRY_STORAGE_IDS.handling]),
        ),
    ).toEqual([
      {
        object_kind: "candidate",
        object_id: ENTRY_STORAGE_IDS.candidate,
        identity_sha256: ENTRY_STORAGE_IDS.candidate,
      },
      {
        object_kind: "evidence",
        object_id: ENTRY_STORAGE_IDS.evidence,
        identity_sha256: ENTRY_STORAGE_IDS.evidence,
      },
      {
        object_kind: "handling",
        object_id: ENTRY_STORAGE_IDS.handling,
        identity_sha256: ENTRY_STORAGE_IDS.handling,
      },
    ]);
    expect(
      database
        .prepare(
          `SELECT *
           FROM observation_entry_candidates
           WHERE candidate_id = ?`,
        )
        .get(ENTRY_STORAGE_IDS.candidate),
    ).toEqual({
      ...ENTRY_STORAGE_ROW_TYPE_FIXTURES.candidate,
      setup_id: "setup-entry-query",
      first_receipt_id: "receipt-entry-query-v3",
    });
    expect(
      database
        .prepare(
          `SELECT *
           FROM observation_entry_candidate_evidence
           WHERE evidence_id = ?`,
        )
        .get(ENTRY_STORAGE_IDS.evidence),
    ).toEqual({
      ...ENTRY_STORAGE_ROW_TYPE_FIXTURES.evidence,
      receipt_id: "receipt-entry-query-v3",
    });
    expect(
      database
        .prepare(
          `SELECT *
           FROM observation_entry_handling
           WHERE handling_id = ?`,
        )
        .get(ENTRY_STORAGE_IDS.handling),
    ).toEqual({
      ...ENTRY_STORAGE_ROW_TYPE_FIXTURES.handling,
      receipt_id: "receipt-entry-query-v3",
    });

    database.prepare(queries.INSERT_PRODUCER_DIAGNOSTIC_SQL).run(
      "diagnostic-entry-query",
      ENTRY_STORAGE_IDS.batch,
      "setup-entry-query",
      "[]",
      "[]",
      "[]",
      "[]",
      null,
      "2026-07-24T10:00:00Z",
    );
    database.prepare(queries.INSERT_ENTRY_SELECTION_SQL).run(
      ENTRY_STORAGE_IDS.selection,
      ENTRY_STORAGE_IDS.batch,
      "setup-entry-query",
      "rd-entry-arbitration-v2",
      1,
      JSON.stringify([ENTRY_STORAGE_IDS.candidate]),
      ENTRY_STORAGE_IDS.candidate,
      ENTRY_STORAGE_IDS.evidence,
      "DIR_CLOSE",
      "ONLY_EXACT_TRIGGER",
      "EXACT",
      "PAPER_ELIGIBLE",
      "SHADOW_ONLY",
      "PROMOTION_IDENTITY_MISMATCH",
      1721808300,
    );
    database.prepare(queries.INSERT_ENTRY_EVALUATION_MEMBERS_SQL).run(
      JSON.stringify([
        {
          selection_id: ENTRY_STORAGE_IDS.selection,
          object_kind: "CANDIDATE",
          object_id: ENTRY_STORAGE_IDS.candidate,
        },
      ]),
    );
    database.prepare(queries.INSERT_ENTRY_PARITY_SQL).run(
      ENTRY_STORAGE_IDS.parity,
      ENTRY_STORAGE_IDS.batch,
      "setup-entry-query",
      "diagnostic-entry-query",
      ENTRY_STORAGE_IDS.selection,
      "MISMATCH",
      "DIAGNOSTIC_ACTION",
      "2026-07-24T10:00:03Z",
    );
    database.prepare(queries.INSERT_ENTRY_QUARANTINE_SQL).run(
      "quarantine-entry-query",
      "receipt-entry-query-v3",
      ENTRY_STORAGE_IDS.batch,
      null,
      null,
      null,
      "CANDIDATE",
      ENTRY_STORAGE_IDS.candidate,
      ENTRY_STORAGE_IDS.candidate,
      ENTRY_STORAGE_IDS.payload,
      "IMMUTABLE_ID_CONFLICT",
      "2026-07-24T10:00:04Z",
    );
    expect(
      database
        .prepare(
          `SELECT *
           FROM observation_entry_producer_diagnostics
           WHERE diagnostic_id = 'diagnostic-entry-query'`,
        )
        .get(),
    ).toEqual({
      ...ENTRY_STORAGE_ROW_TYPE_FIXTURES.producerDiagnostic,
      diagnostic_id: "diagnostic-entry-query",
      setup_id: "setup-entry-query",
    });
    expect(
      database
        .prepare(
          `SELECT *
           FROM observation_entry_selections
           WHERE selection_id = ?`,
        )
        .get(ENTRY_STORAGE_IDS.selection),
    ).toEqual({
      ...ENTRY_STORAGE_ROW_TYPE_FIXTURES.selection,
      setup_id: "setup-entry-query",
    });
    expect(
      database
        .prepare("SELECT * FROM observation_entry_evaluation_members")
        .get(),
    ).toEqual(ENTRY_STORAGE_ROW_TYPE_FIXTURES.evaluationMember);
    expect(
      database.prepare("SELECT * FROM observation_entry_parity").get(),
    ).toEqual({
      ...ENTRY_STORAGE_ROW_TYPE_FIXTURES.parity,
      setup_id: "setup-entry-query",
      producer_diagnostic_id: "diagnostic-entry-query",
    });
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("aborts bulk entry inserts atomically instead of silently skipping rows", async () => {
    const queries = await import("../src/rd-entry-queries");
    const root = fileURLToPath(new URL("..", import.meta.url));
    const database = new DatabaseSync(":memory:");
    database.exec("PRAGMA foreign_keys = ON");
    applyObservationMigrationsThrough(database, root, 23);
    seedEntryStorage(database);

    const candidate = (candidateId: string, model: string) => ({
      candidate_id: candidateId,
      setup_id: "setup-entry-storage",
      model,
      state: "MATCHED",
      event_anchor_epoch: 1721808300,
      trigger_ordinal: 2,
      direction: "LONG",
      source_claim_ids_json: '["standard-close-2024-03"]',
      normalized_from: null,
      identity_sha256: candidateId,
      observed_at_epoch: 1721808300,
    });
    expect(() =>
      database.prepare(queries.INSERT_ENTRY_CANDIDATES_SQL).run(
        "receipt-entry-storage-v3",
        JSON.stringify([
          candidate("8".repeat(64), "HTF_FLIP"),
          candidate("7".repeat(64), "BROKER_FILL"),
        ]),
      ),
    ).toThrow(/CHECK constraint failed/u);
    expect(
      database
        .prepare(
          `SELECT candidate_id
           FROM observation_entry_candidates
           WHERE candidate_id IN (?, ?)`,
        )
        .all("8".repeat(64), "7".repeat(64)),
    ).toEqual([]);

    const evidence = (evidenceId: string, fidelity: string) => ({
      evidence_id: evidenceId,
      candidate_id: ENTRY_STORAGE_IDS.candidate,
      observed_trigger_epoch: 1721808300,
      observed_trigger_ticks: 110000,
      htf_context_minutes_json: "[]",
      fidelity,
      proof_plane: "CONFIRMED_5M",
      proof_resolution_seconds: 300,
      coverage_start_epoch: 1721808000,
      coverage_end_epoch: 1721808300,
      ambiguity_codes_json: "[]",
      passed_rule_ids_json: '["ENTRY_DIR_CLOSE"]',
      failed_rule_ids_json: "[]",
      source_claim_ids_json: '["standard-close-2024-03"]',
      payload_sha256: ENTRY_STORAGE_IDS.payload,
      identity_sha256: evidenceId,
      observed_at_epoch: 1721808300,
    });
    expect(() =>
      database.prepare(queries.INSERT_ENTRY_EVIDENCE_SQL).run(
        "receipt-entry-storage-v3",
        JSON.stringify([
          evidence("8".repeat(64), "EXACT"),
          evidence("7".repeat(64), "UNTRUSTED"),
        ]),
      ),
    ).toThrow(/CHECK constraint failed/u);
    expect(
      database
        .prepare(
          `SELECT evidence_id
           FROM observation_entry_candidate_evidence
           WHERE evidence_id IN (?, ?)`,
        )
        .all("8".repeat(64), "7".repeat(64)),
    ).toEqual([]);

    const handling = (handlingId: string, handlingMode: string) => ({
      handling_id: handlingId,
      candidate_id: ENTRY_STORAGE_IDS.candidate,
      evidence_id: ENTRY_STORAGE_IDS.evidence,
      handling_mode: handlingMode,
      attempt_kind: "INITIAL",
      observed_epoch: 1721808300,
      observed_ticks: 110000,
      fidelity: "EXACT",
      source_claim_ids_json: '["standard-close-2024-03"]',
      identity_sha256: handlingId,
    });
    expect(() =>
      database.prepare(queries.INSERT_ENTRY_HANDLING_SQL).run(
        "receipt-entry-storage-v3",
        JSON.stringify([
          handling("8".repeat(64), "CLOSE_CONFIRMATION"),
          handling("7".repeat(64), "MARKET_ORDER"),
        ]),
      ),
    ).toThrow(/CHECK constraint failed/u);
    expect(
      database
        .prepare(
          `SELECT handling_id
           FROM observation_entry_handling
           WHERE handling_id IN (?, ?)`,
        )
        .all("8".repeat(64), "7".repeat(64)),
    ).toEqual([]);

    for (const statement of [
      queries.INSERT_ENTRY_CANDIDATES_SQL,
      queries.INSERT_ENTRY_EVIDENCE_SQL,
      queries.INSERT_ENTRY_HANDLING_SQL,
      queries.INSERT_ENTRY_SOURCE_CLAIM_SQL,
      queries.INSERT_ENTRY_SOURCE_RELATIONSHIP_SQL,
    ]) {
      expect(statement.toUpperCase()).not.toContain("OR IGNORE");
    }
  });

  it("keeps Task 4 receipt hashes and fails deferred entry FKs at commit", () => {
    const root = fileURLToPath(new URL("..", import.meta.url));
    const database = new DatabaseSync(":memory:");
    database.exec("PRAGMA foreign_keys = ON");
    applyObservationMigrationsThrough(database, root, 22);
    insertEntryStorageReceipt(database, {
      receiptId: "receipt-entry-storage-compatible-legacy",
      schemaVersion: "1.2",
      strategyVersion: "1.2.0-contract1",
      producerInstanceId: "compatible-legacy",
      sequence: 0,
      payloadSha256: "A".repeat(64),
    });
    insertEntryStorageReceipt(database, {
      receiptId: "receipt-entry-storage-compatible-v3",
      schemaVersion: "2.0",
      strategyVersion: "2.0.0-contract2",
      producerInstanceId: "compatible-v3",
      sequence: 1,
    });

    const migration = readFileSync(
      `${root}/migrations/0023_observation_entries.sql`,
      "utf8",
    );
    expect(migration.toLowerCase()).not.toContain(
      "pragma defer_foreign_keys = off",
    );
    database.exec("BEGIN");
    database.exec(migration);
    database.exec("COMMIT");
    expect(
      database
        .prepare(
          `SELECT receipt_id, payload_sha256
           FROM observation_receipts
           WHERE receipt_id LIKE 'receipt-entry-storage-compatible-%'
           ORDER BY receipt_id`,
        )
        .all(),
    ).toEqual([
      {
        receipt_id: "receipt-entry-storage-compatible-legacy",
        payload_sha256: "A".repeat(64),
      },
      {
        receipt_id: "receipt-entry-storage-compatible-v3",
        payload_sha256: ENTRY_STORAGE_IDS.payload,
      },
    ]);
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);

    const rollbackDatabase = new DatabaseSync(":memory:");
    rollbackDatabase.exec("PRAGMA foreign_keys = ON");
    applyObservationMigrationsThrough(rollbackDatabase, root, 22);
    const migrationWithDeferredViolation = migration.replace(
      "PRAGMA foreign_key_check;",
      `INSERT INTO observation_market_bar_heartbeats (
        receipt_id, batch_id, schema_version, producer_role,
        producer_instance_id, producer_sequence, strategy_version,
        symbol, ticker_id, feed, timeframe, bar_open_epoch, bar_close_epoch,
        detector_code_hash, settings_hash, recorded_at
      ) VALUES (
        'missing-receipt', NULL, '1.2', 'LEGACY_REFERENCE',
        'deferred-producer', 0, '1.2.0-contract1',
        'EURUSD', 'VANTAGE:EURUSD', 'VANTAGE', '5',
        1721808000, 1721808300, NULL, NULL, '2026-07-24T10:00:00Z'
      );
      PRAGMA foreign_key_check;`,
    );
    rollbackDatabase.exec("BEGIN");
    rollbackDatabase.exec("PRAGMA defer_foreign_keys = ON");
    rollbackDatabase.exec(migrationWithDeferredViolation);
    expect(
      rollbackDatabase.prepare("PRAGMA foreign_key_check").all(),
    ).toEqual([
      expect.objectContaining({
        table: "observation_market_bar_heartbeats",
        parent: "observation_receipts",
      }),
    ]);
    expect(() => rollbackDatabase.exec("COMMIT")).toThrow(
      /FOREIGN KEY constraint failed/u,
    );
    rollbackDatabase.exec("ROLLBACK");
    expect(
      rollbackDatabase
        .prepare(
          `SELECT name
           FROM sqlite_schema
           WHERE type = 'table'
             AND name = 'observation_market_bar_heartbeats'`,
        )
        .all(),
    ).toEqual([]);
  });

  it("migrates legacy receipt references and rejects entry schema sequence zero", () => {
    const root = fileURLToPath(new URL("..", import.meta.url));
    const database = new DatabaseSync(":memory:");
    const payloadSha256 = "a".repeat(64);
    database.exec("PRAGMA foreign_keys = ON");
    for (const migration of readdirSync(`${root}/migrations`)
      .filter((name) => /^00(?:0[1-9]|1[0-9]|2[01])_.*\.sql$/u.test(name))
      .sort()) {
      database.exec(readFileSync(`${root}/migrations/${migration}`, "utf8"));
    }

    const insertReceipt = database.prepare(`
      INSERT INTO observation_receipts (
        receipt_id, received_at, idempotency_key, payload_sha256,
        schema_version, strategy_id, strategy_version, producer_instance_id,
        sequence, symbol, ticker_id, feed, timeframe, kind
      ) VALUES (?, ?, ?, ?, ?, 'rd_liquidity_sd_5m_v1', ?, ?, ?, ?, ?, ?, '5', ?)
    `);
    const insertLegacyReceipt = (
      receiptId: string,
      schemaVersion: "1.0" | "1.1" | "1.2",
      strategyVersion: "1.0.0-phase1" | "1.1.0-paper1" | "1.2.0-contract1",
      legacyPayloadSha256: string,
    ): void => {
      insertReceipt.run(
        receiptId,
        "2026-07-24T10:00:00Z",
        `legacy:${receiptId}`,
        legacyPayloadSha256,
        schemaVersion,
        strategyVersion,
        "legacy-producer",
        0,
        "EURUSD",
        "VANTAGE:EURUSD",
        "VANTAGE",
        "snapshot",
      );
    };

    insertLegacyReceipt("receipt-v1", "1.0", "1.0.0-phase1", "A".repeat(64));
    insertLegacyReceipt("receipt-v11", "1.1", "1.1.0-paper1", payloadSha256);
    insertLegacyReceipt("receipt-v12", "1.2", "1.2.0-contract1", payloadSha256);
    database
      .prepare(
        `INSERT INTO paper_trade_intents (
          intent_id, idempotency_key, payload_sha256, symbol, side,
          entry_price, stop_loss, take_profit, risk_bps, created_at,
          source, source_receipt_id
        ) VALUES (?, ?, ?, 'EURUSD', 'BUY', '1.10', '1.09', '1.12', 100, ?, 'TRADINGVIEW', ?)`,
      )
      .run(
        "intent-v1",
        "paper-intent:intent-v1",
        payloadSha256,
        "2026-07-24T10:00:00Z",
        "receipt-v1",
      );
    database
      .prepare(
        `INSERT INTO paper_blocked_automation_intents (
          intent_id, source_receipt_id, payload_sha256, reason_code, blocked_at
        ) VALUES (?, ?, ?, 'KILL_SWITCH_ENABLED', ?)`,
      )
      .run(
        "blocked-v11",
        "receipt-v11",
        payloadSha256,
        "2026-07-24T10:00:00Z",
      );
    database
      .prepare(
        `INSERT INTO observation_setup_evidence (
          evidence_id, receipt_id, recorded_at, event_index, event_kind,
          symbol, side, zone_key, liquidity_key, formation_bar_close_epoch,
          from_state, to_state, reason_code, decision, entry_model,
          rule_passes_json, liquidity_formed_epoch, own_extreme_broken_epoch,
          liquidity_swept_epoch, zone_engaged_epoch, entry_confirmed_epoch,
          zone_top, zone_bottom, zone_origin_open_epoch, zone_origin_close_epoch,
          liquidity_price, liquidity_origin_open_epoch, liquidity_origin_close_epoch,
          source_open_epoch, source_close_epoch, source_open, source_high,
          source_low, source_close
        ) VALUES (?, ?, ?, 0, 'transition', 'EURUSD', 'DEMAND', 'zone-v12',
          'liquidity-v12', 100, NULL, 'ACTIVE', 'TEST', 'WAIT', NULL, ?,
          NULL, NULL, NULL, NULL, NULL, '1.10', '1.09', 1, 2, '1.11', 3, 4,
          5, 100, '1.10', '1.12', '1.09', '1.11')`,
      )
      .run(
        "evidence-v12",
        "receipt-v12",
        "2026-07-24T10:00:00Z",
        JSON.stringify(Array.from({ length: 22 }, () => true)),
      );

    database.exec("BEGIN");
    database.exec(
      readFileSync(
        `${root}/migrations/0022_observation_receipts_entry_v2.sql`,
        "utf8",
      ),
    );
    database.exec("COMMIT");

    expect(
      database
        .prepare(
          `SELECT
             receipt_id, received_at, idempotency_key, payload_sha256,
             schema_version, strategy_id, strategy_version, producer_instance_id,
             sequence, symbol, ticker_id, feed, timeframe, kind
           FROM observation_receipts
           WHERE receipt_id LIKE 'receipt-v%'
           ORDER BY receipt_id`,
        )
        .all(),
    ).toEqual([
      {
        receipt_id: "receipt-v1",
        received_at: "2026-07-24T10:00:00Z",
        idempotency_key: "legacy:receipt-v1",
        payload_sha256: "A".repeat(64),
        schema_version: "1.0",
        strategy_id: "rd_liquidity_sd_5m_v1",
        strategy_version: "1.0.0-phase1",
        producer_instance_id: "legacy-producer",
        sequence: 0,
        symbol: "EURUSD",
        ticker_id: "VANTAGE:EURUSD",
        feed: "VANTAGE",
        timeframe: "5",
        kind: "snapshot",
      },
      {
        receipt_id: "receipt-v11",
        received_at: "2026-07-24T10:00:00Z",
        idempotency_key: "legacy:receipt-v11",
        payload_sha256: payloadSha256,
        schema_version: "1.1",
        strategy_id: "rd_liquidity_sd_5m_v1",
        strategy_version: "1.1.0-paper1",
        producer_instance_id: "legacy-producer",
        sequence: 0,
        symbol: "EURUSD",
        ticker_id: "VANTAGE:EURUSD",
        feed: "VANTAGE",
        timeframe: "5",
        kind: "snapshot",
      },
      {
        receipt_id: "receipt-v12",
        received_at: "2026-07-24T10:00:00Z",
        idempotency_key: "legacy:receipt-v12",
        payload_sha256: payloadSha256,
        schema_version: "1.2",
        strategy_id: "rd_liquidity_sd_5m_v1",
        strategy_version: "1.2.0-contract1",
        producer_instance_id: "legacy-producer",
        sequence: 0,
        symbol: "EURUSD",
        ticker_id: "VANTAGE:EURUSD",
        feed: "VANTAGE",
        timeframe: "5",
        kind: "snapshot",
      },
    ]);
    expect(
      database
        .prepare(
          `SELECT source_receipt_id FROM paper_trade_intents WHERE intent_id = 'intent-v1'`,
        )
        .get(),
    ).toEqual({ source_receipt_id: "receipt-v1" });
    expect(
      database
        .prepare(
          `SELECT source_receipt_id
           FROM paper_blocked_automation_intents
           WHERE intent_id = 'blocked-v11'`,
        )
        .get(),
    ).toEqual({ source_receipt_id: "receipt-v11" });
    expect(
      database
        .prepare(
          `SELECT * FROM observation_setup_evidence WHERE evidence_id = 'evidence-v12'`,
        )
        .get(),
    ).toEqual({
      evidence_id: "evidence-v12",
      receipt_id: "receipt-v12",
      recorded_at: "2026-07-24T10:00:00Z",
      event_index: 0,
      event_kind: "transition",
      symbol: "EURUSD",
      side: "DEMAND",
      zone_key: "zone-v12",
      liquidity_key: "liquidity-v12",
      formation_bar_close_epoch: 100,
      from_state: null,
      to_state: "ACTIVE",
      reason_code: "TEST",
      decision: "WAIT",
      entry_model: null,
      rule_passes_json: JSON.stringify(Array.from({ length: 22 }, () => true)),
      liquidity_formed_epoch: null,
      own_extreme_broken_epoch: null,
      liquidity_swept_epoch: null,
      zone_engaged_epoch: null,
      entry_confirmed_epoch: null,
      zone_top: "1.10",
      zone_bottom: "1.09",
      zone_origin_open_epoch: 1,
      zone_origin_close_epoch: 2,
      liquidity_price: "1.11",
      liquidity_origin_open_epoch: 3,
      liquidity_origin_close_epoch: 4,
      source_open_epoch: 5,
      source_close_epoch: 100,
      source_open: "1.10",
      source_high: "1.12",
      source_low: "1.09",
      source_close: "1.11",
    });
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(
      database
        .prepare(
          `SELECT name, sql
           FROM sqlite_schema
           WHERE type = 'index'
             AND name IN (
               'idx_observation_receipts_received',
               'idx_observation_receipts_producer_sequence'
             )
           ORDER BY name`,
        )
        .all()
        .map((index) => ({
          name: index.name,
          sql: String(index.sql).replace(/\s+/gu, " ").trim(),
        })),
    ).toEqual([
      {
        name: "idx_observation_receipts_producer_sequence",
        sql: "CREATE INDEX idx_observation_receipts_producer_sequence ON observation_receipts(producer_instance_id, sequence DESC)",
      },
      {
        name: "idx_observation_receipts_received",
        sql: "CREATE INDEX idx_observation_receipts_received ON observation_receipts(received_at DESC, receipt_id DESC)",
      },
    ]);
    const receiptForeignKey = (table: string, column: string): unknown =>
      database
        .prepare(`PRAGMA foreign_key_list('${table}')`)
        .all()
        .find((foreignKey) => foreignKey.from === column);
    expect(
      receiptForeignKey("paper_trade_intents", "source_receipt_id"),
    ).toMatchObject({
      table: "observation_receipts",
      from: "source_receipt_id",
      to: "receipt_id",
      on_update: "NO ACTION",
      on_delete: "NO ACTION",
    });
    expect(
      receiptForeignKey("paper_blocked_automation_intents", "source_receipt_id"),
    ).toMatchObject({
      table: "observation_receipts",
      from: "source_receipt_id",
      to: "receipt_id",
      on_update: "NO ACTION",
      on_delete: "NO ACTION",
    });
    expect(
      receiptForeignKey("observation_setup_evidence", "receipt_id"),
    ).toMatchObject({
      table: "observation_receipts",
      from: "receipt_id",
      to: "receipt_id",
      on_update: "NO ACTION",
      on_delete: "CASCADE",
    });
    expect(
      database
        .prepare(
          `SELECT name, sql
           FROM sqlite_schema
           WHERE type = 'trigger'
             AND name IN (
               'paper_blocked_automation_intents_no_delete',
               'paper_blocked_automation_intents_no_update',
               'paper_trade_intents_no_delete',
               'paper_trade_intents_no_update'
             )
           ORDER BY name`,
        )
        .all()
        .map((trigger) => ({
          name: trigger.name,
          sql: String(trigger.sql).replace(/\s+/gu, " ").trim(),
        })),
    ).toEqual([
      {
        name: "paper_blocked_automation_intents_no_delete",
        sql: "CREATE TRIGGER paper_blocked_automation_intents_no_delete BEFORE DELETE ON paper_blocked_automation_intents BEGIN SELECT RAISE(ABORT, 'blocked paper automation intents are append-only'); END",
      },
      {
        name: "paper_blocked_automation_intents_no_update",
        sql: "CREATE TRIGGER paper_blocked_automation_intents_no_update BEFORE UPDATE ON paper_blocked_automation_intents BEGIN SELECT RAISE(ABORT, 'blocked paper automation intents are append-only'); END",
      },
      {
        name: "paper_trade_intents_no_delete",
        sql: "CREATE TRIGGER paper_trade_intents_no_delete BEFORE DELETE ON paper_trade_intents BEGIN SELECT RAISE(ABORT, 'paper trade intents are append-only'); END",
      },
      {
        name: "paper_trade_intents_no_update",
        sql: "CREATE TRIGGER paper_trade_intents_no_update BEFORE UPDATE ON paper_trade_intents BEGIN SELECT RAISE(ABORT, 'paper trade intents are immutable'); END",
      },
    ]);

    expect(() =>
      insertReceipt.run(
        "receipt-v2-zero",
        "2026-07-24T10:00:01Z",
        "entry-v2:zero",
        payloadSha256,
        "2.0",
        "2.0.0-contract2",
        "entry-producer",
        0,
        "EURUSD",
        "VANTAGE:EURUSD",
        "VANTAGE",
        "snapshot",
      ),
    ).toThrow(/CHECK constraint failed/u);
    insertReceipt.run(
      "receipt-v2-one",
      "2026-07-24T10:00:01Z",
      "entry-v2:one",
      payloadSha256,
      "2.0",
      "2.0.0-contract2",
      "entry-producer",
      1,
      "EURUSD",
      "VANTAGE:EURUSD",
      "VANTAGE",
      "snapshot",
    );
    expect(
      database
        .prepare(
          `SELECT
             receipt_id, received_at, idempotency_key, payload_sha256,
             schema_version, strategy_id, strategy_version, producer_instance_id,
             sequence, symbol, ticker_id, feed, timeframe, kind
           FROM observation_receipts
           WHERE receipt_id = 'receipt-v2-one'`,
        )
        .get(),
    ).toEqual({
      receipt_id: "receipt-v2-one",
      received_at: "2026-07-24T10:00:01Z",
      idempotency_key: "entry-v2:one",
      payload_sha256: payloadSha256,
      schema_version: "2.0",
      strategy_id: "rd_liquidity_sd_5m_v1",
      strategy_version: "2.0.0-contract2",
      producer_instance_id: "entry-producer",
      sequence: 1,
      symbol: "EURUSD",
      ticker_id: "VANTAGE:EURUSD",
      feed: "VANTAGE",
      timeframe: "5",
      kind: "snapshot",
    });
    expect(() =>
      insertReceipt.run(
        "receipt-v2-uppercase-hash",
        "2026-07-24T10:00:01Z",
        "entry-v2:uppercase-hash",
        "B".repeat(64),
        "2.0",
        "2.0.0-contract2",
        "entry-producer",
        1,
        "EURUSD",
        "VANTAGE:EURUSD",
        "VANTAGE",
        "snapshot",
      ),
    ).toThrow(/CHECK constraint failed/u);
    expect(() =>
      insertReceipt.run(
        "receipt-v2-malformed-hash",
        "2026-07-24T10:00:01Z",
        "entry-v2:malformed-hash",
        "g".repeat(64),
        "2.0",
        "2.0.0-contract2",
        "entry-producer",
        1,
        "EURUSD",
        "VANTAGE:EURUSD",
        "VANTAGE",
        "snapshot",
      ),
    ).toThrow(/CHECK constraint failed/u);
    expect(() =>
      insertReceipt.run(
        "receipt-v2-legacy-strategy",
        "2026-07-24T10:00:01Z",
        "entry-v2:legacy-strategy",
        payloadSha256,
        "2.0",
        "1.2.0-contract1",
        "entry-producer",
        1,
        "EURUSD",
        "VANTAGE:EURUSD",
        "VANTAGE",
        "snapshot",
      ),
    ).toThrow(/CHECK constraint failed/u);
    expect(() =>
      insertReceipt.run(
        "receipt-v1-entry-strategy",
        "2026-07-24T10:00:01Z",
        "legacy:entry-strategy",
        payloadSha256,
        "1.0",
        "2.0.0-contract2",
        "legacy-producer",
        0,
        "EURUSD",
        "VANTAGE:EURUSD",
        "VANTAGE",
        "snapshot",
      ),
    ).toThrow(/CHECK constraint failed/u);
    const receiptsBeforeRepeat = database
      .prepare(
        `SELECT
           receipt_id, received_at, idempotency_key, payload_sha256,
           schema_version, strategy_id, strategy_version, producer_instance_id,
           sequence, symbol, ticker_id, feed, timeframe, kind
         FROM observation_receipts
         ORDER BY receipt_id`,
      )
      .all();
    const evidenceBeforeRepeat = database
      .prepare("SELECT * FROM observation_setup_evidence ORDER BY evidence_id")
      .all();
    database.exec("BEGIN");
    database.exec(
      readFileSync(
        `${root}/migrations/0022_observation_receipts_entry_v2.sql`,
        "utf8",
      ),
    );
    database.exec("COMMIT");
    expect(
      database
        .prepare(
          `SELECT
             receipt_id, received_at, idempotency_key, payload_sha256,
             schema_version, strategy_id, strategy_version, producer_instance_id,
             sequence, symbol, ticker_id, feed, timeframe, kind
           FROM observation_receipts
           ORDER BY receipt_id`,
        )
        .all(),
    ).toEqual(receiptsBeforeRepeat);
    expect(
      database
        .prepare("SELECT * FROM observation_setup_evidence ORDER BY evidence_id")
        .all(),
    ).toEqual(evidenceBeforeRepeat);
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("fails deferred receipt FK violations at commit and rolls the rebuild back", () => {
    const root = fileURLToPath(new URL("..", import.meta.url));
    const database = new DatabaseSync(":memory:");
    const payloadSha256 = "a".repeat(64);
    database.exec("PRAGMA foreign_keys = ON");
    for (const migration of readdirSync(root + "/migrations")
      .filter((name) => /^00(?:0[1-9]|1[0-9]|2[01])_.*\.sql$/u.test(name))
      .sort()) {
      database.exec(readFileSync(root + "/migrations/" + migration, "utf8"));
    }
    database
      .prepare(
        "INSERT INTO observation_receipts VALUES (?, ?, ?, ?, '1.2', " +
          "'rd_liquidity_sd_5m_v1', '1.2.0-contract1', " +
          "'rollback-producer', 0, 'EURUSD', 'VANTAGE:EURUSD', " +
          "'VANTAGE', '5', 'snapshot')",
      )
      .run(
        "receipt-rollback",
        "2026-07-24T10:00:00Z",
        "legacy:receipt-rollback",
        payloadSha256,
      );
    const migration = readFileSync(
      root + "/migrations/0022_observation_receipts_entry_v2.sql",
      "utf8",
    ).replace(
      "PRAGMA foreign_key_check;",
      "INSERT INTO paper_blocked_automation_intents (" +
        "intent_id, source_receipt_id, payload_sha256, reason_code, blocked_at" +
        ") VALUES (" +
        "'blocked-unresolved', 'missing-receipt', '" +
        payloadSha256 +
        "', 'KILL_SWITCH_ENABLED', '2026-07-24T10:00:00Z');" +
        "PRAGMA foreign_key_check;",
    );

    database.exec("BEGIN");
    database.exec(migration);
    expect(() => database.exec("COMMIT")).toThrow(
      /FOREIGN KEY constraint failed/u,
    );
    database.exec("ROLLBACK");

    expect(
      database
        .prepare(
          "SELECT receipt_id, schema_version, strategy_version, sequence, " +
            "payload_sha256 FROM observation_receipts",
        )
        .all(),
    ).toEqual([
      {
        receipt_id: "receipt-rollback",
        schema_version: "1.2",
        strategy_version: "1.2.0-contract1",
        sequence: 0,
        payload_sha256: payloadSha256,
      },
    ]);
    expect(
      database
        .prepare(
          "SELECT name FROM sqlite_schema WHERE type = 'table' " +
            "AND name = 'observation_receipts_entry_v2'",
        )
        .all(),
    ).toEqual([]);
    expect(
      database
        .prepare(
          "SELECT intent_id FROM paper_blocked_automation_intents " +
            "WHERE intent_id = 'blocked-unresolved'",
        )
        .all(),
    ).toEqual([]);
  });

  it("stores sanitized setup evidence with strict receipt ownership", () => {
    const root = fileURLToPath(new URL("..", import.meta.url));
    const migration = readFileSync(
      `${root}/migrations/0021_observation_setup_evidence.sql`,
      "utf8",
    ).toLowerCase();

    expect(migration).toContain(
      "references observation_receipts(receipt_id) on delete cascade",
    );
    expect(migration).toContain(
      "unique (receipt_id, event_kind, event_index)",
    );
    expect(migration).toContain("json_array_length(rule_passes_json) = 22");
    expect(migration).toContain(
      "idx_observation_setup_evidence_recorded",
    );
    expect(migration).toContain("pragma foreign_key_check");
    expect(migration).not.toMatch(
      /^\s*(credential|payload|raw_payload|canonical_payload)\s+text/gm,
    );
  });
});
