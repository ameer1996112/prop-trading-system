import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { handleRequest } from "../src/index";
import { SOURCE_CLAIMS } from "../src/rd-entry-policy";
import {
  INSERT_RECEIPT_SQL,
  INSERT_SETUP_EVIDENCE_SQL,
  LIST_RECEIPTS_SQL,
  LIST_SETUP_EVIDENCE_SQL,
  SELECT_RECEIPT_SQL,
} from "../src/queries";
import {
  LIST_ENTRY_V3_DECISION_CANDIDATES_SQL,
  LIST_ENTRY_V3_DECISION_EVIDENCE_SQL,
  LIST_ENTRY_V3_DECISION_MEMBERS_SQL,
  LIST_ENTRY_V3_DECISION_PAPER_SQL,
  LIST_ENTRY_V3_DECISION_PARITY_SQL,
  LIST_ENTRY_V3_DECISION_SHADOW_SQL,
  LIST_ENTRY_V3_DECISIONS_SQL,
} from "../src/rd-entry-queries-v3";
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
type SqliteInput =
  | null
  | number
  | bigint
  | string
  | NodeJS.ArrayBufferView;

function sqliteValue(
  row: Readonly<Record<string, SqliteInput>>,
  key: string,
): SqliteInput {
  const value = row[key];
  if (value === undefined) {
    throw new Error(`Missing SQLite column ${key}`);
  }
  return value;
}
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
    if (/^\s*SELECT\b/iu.test(this.sql)) {
      return {
        success: true,
        results: this.database.sqlite
          .prepare(this.sql)
          .all(...(this.values as SqliteInput[])),
        meta: {},
      } as unknown as D1Result;
    }
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
      this.database.sqlite
        .prepare(this.sql)
        .run(...(this.values as SqliteInput[]));
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
      this.database.sqlite
        .prepare(this.sql)
        .run(...(this.values as SqliteInput[]));
      return {
        success: true,
        results: [],
        meta: { changes: rows.length },
      } as unknown as D1Result;
    }
    const result = this.database.sqlite
      .prepare(this.sql)
      .run(...(this.values as SqliteInput[]));
    if (!this.database.inBatch) {
      this.database.syncEntryMaps();
    }
    return {
      success: true,
      results: [],
      meta: { changes: Number(result.changes) },
    } as unknown as D1Result;
  }

  async first<T>(): Promise<T | null> {
    if (this.sql.includes("WHERE idempotency_key = ?")) {
      return (
        (this.database.records.get(String(this.values[0])) as T | undefined) ??
        null
      );
    }
    return (
      (this.database.sqlite
        .prepare(this.sql)
        .get(...(this.values as SqliteInput[])) as T | undefined) ?? null
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
      results = this.database.sqlite
        .prepare(this.sql)
        .all(...(this.values as SqliteInput[])) as T[];
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
  readonly batches = new Map<string, Record<string, unknown>>();
  readonly chunks = new Map<string, Record<string, unknown>>();
  readonly setupEvents = new Map<string, StoredEntrySetupEvent>();
  readonly terminals = new Map<string, StoredEntrySetupTerminal>();
  readonly candidates = new Map<string, StoredEntryCandidate>();
  readonly entryEvidence = new Map<string, StoredEntryCandidateEvidence>();
  readonly handling = new Map<string, StoredEntryHandling>();
  readonly producerDiagnostics: StoredProducerDiagnostic[] = [];
  readonly selections: StoredEntrySelection[] = [];
  readonly parity: StoredEntryParity[] = [];
  readonly completions = new Map<string, Record<string, unknown>>();
  readonly quarantine = new Map<string, Record<string, unknown>>();
  readonly marketBarHeartbeats: StoredMarketBarHeartbeat[] = [];
  readonly paperTradeIntents: Record<string, unknown>[] = [];
  readonly preparedSql: string[] = [];
  readonly sqlite = new DatabaseSync(":memory:");
  inBatch = false;
  private entryBatchRaceInjected = false;

  constructor(
    readonly failEvidenceWrites = false,
    private readonly failEntryBatchOnce = false,
  ) {
    const root = fileURLToPath(new URL("..", import.meta.url));
    this.sqlite.exec("PRAGMA foreign_keys = ON");
    applyObservationMigrationsThrough(this.sqlite, root, 28);
    this.syncEntryMaps();
  }

  private replaceMap<T>(
    target: Map<string, T>,
    rows: readonly T[],
    key: (row: T) => string,
  ): void {
    target.clear();
    for (const row of rows) {
      target.set(key(row), row);
    }
  }

  private replaceArray<T>(target: T[], rows: readonly T[]): void {
    target.splice(0, target.length, ...rows);
  }

  syncEntryMaps(): void {
    const rows = <T>(table: string): T[] =>
      this.sqlite.prepare(`SELECT * FROM ${table}`).all() as T[];
    this.replaceMap(
      this.batches,
      rows<Record<string, unknown>>("observation_entry_batches"),
      (item) => String(item.batch_id),
    );
    this.replaceMap(
      this.chunks,
      rows<Record<string, unknown>>("observation_entry_chunks"),
      (item) => `${String(item.batch_id)}:${String(item.chunk_index)}`,
    );
    this.replaceMap(
      this.setupEvents,
      rows<StoredEntrySetupEvent>("observation_entry_setup_events"),
      (item) => item.event_id,
    );
    this.replaceMap(
      this.terminals,
      rows<StoredEntrySetupTerminal>("observation_entry_setup_terminals"),
      (item) => item.setup_id,
    );
    this.replaceMap(
      this.candidates,
      rows<StoredEntryCandidate>("observation_entry_candidates"),
      (item) => item.candidate_id,
    );
    this.replaceMap(
      this.entryEvidence,
      rows<StoredEntryCandidateEvidence>(
        "observation_entry_candidate_evidence",
      ),
      (item) => item.evidence_id,
    );
    this.replaceMap(
      this.handling,
      rows<StoredEntryHandling>("observation_entry_handling"),
      (item) => item.handling_id,
    );
    this.replaceArray(
      this.producerDiagnostics,
      rows<StoredProducerDiagnostic>(
        "observation_entry_producer_diagnostics",
      ),
    );
    this.replaceArray(
      this.selections,
      rows<StoredEntrySelection>("observation_entry_selections"),
    );
    this.replaceArray(
      this.parity,
      rows<StoredEntryParity>("observation_entry_parity"),
    );
    this.replaceMap(
      this.completions,
      rows<Record<string, unknown>>(
        "observation_entry_batch_completions",
      ),
      (item) => String(item.completion_id),
    );
    this.replaceMap(
      this.quarantine,
      rows<Record<string, unknown>>("observation_entry_quarantine"),
      (item) => String(item.quarantine_id),
    );
    this.replaceArray(
      this.marketBarHeartbeats,
      rows<StoredMarketBarHeartbeat>("observation_market_bar_heartbeats"),
    );
    this.replaceArray(
      this.paperTradeIntents,
      rows<Record<string, unknown>>("paper_trade_intents"),
    );
  }

  prepare(sql: string): FakeStatement {
    this.preparedSql.push(sql);
    return new FakeStatement(this, sql);
  }

  async batch(statements: D1PreparedStatement[]): Promise<D1Result[]> {
    const receiptSnapshot = new Map(this.records);
    const evidenceSnapshot = new Map(this.evidence);
    this.sqlite.exec("BEGIN");
    this.inBatch = true;
    try {
      const results: D1Result[] = [];
      for (const statement of statements) {
        results.push(await (statement as unknown as FakeStatement).run());
      }
      const selectionCount = Number(
        (
          this.sqlite
            .prepare(
              "SELECT COUNT(*) AS count FROM observation_entry_selections",
            )
            .get() as { readonly count: number }
        ).count,
      );
      if (
        this.failEntryBatchOnce &&
        !this.entryBatchRaceInjected &&
        selectionCount > 0
      ) {
        this.entryBatchRaceInjected = true;
        throw new Error(
          "D1_ERROR: observation_entry_selections immutable insert conflict: SQLITE_CONSTRAINT",
        );
      }
      this.sqlite.exec("COMMIT");
      this.inBatch = false;
      this.syncEntryMaps();
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      this.inBatch = false;
      this.records.clear();
      this.evidence.clear();
      for (const [key, value] of receiptSnapshot) {
        this.records.set(key, value);
      }
      for (const [key, value] of evidenceSnapshot) {
        this.evidence.set(key, value);
      }
      this.syncEntryMaps();
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

function entryV2Setup(
  value: Record<string, unknown>,
): Record<string, unknown> {
  return (value.eb as Record<string, unknown>[])[0]!;
}

function addConfirmedEntryV2Diagnostic(
  value: Record<string, unknown>,
): void {
  const setup = entryV2Setup(value);
  setup.c = [
    {
      i: 0,
      m: "DIR_CLOSE",
      st: "MATCHED",
      a: 1_721_808_000,
      o: 1,
      n: null,
      sc: [...SOURCE_CLAIMS.DIR_CLOSE],
    },
  ];
  setup.e = [
    {
      i: 0,
      ci: 0,
      t: 1_721_808_300,
      px: 103,
      h: [],
      f: "EXACT",
      p: "CONFIRMED_5M",
      r: 300,
      cs: 1_721_808_000,
      ce: 1_721_808_300,
      ac: [],
      pr: ["ENTRY_DIR_CLOSE"],
      fr: [],
      sc: [...SOURCE_CLAIMS.DIR_CLOSE],
    },
  ];
  setup.h = [
    {
      ci: 0,
      ei: 0,
      m: "CLOSE_CONFIRMATION",
      a: "INITIAL",
      t: 1_721_808_300,
      px: 103,
      f: "EXACT",
      sc: [...SOURCE_CLAIMS.DIR_CLOSE],
    },
  ];
  setup.q = {
    v: "PINE_DIAGNOSTIC_ONLY",
    k: "DIR_CLOSE:1721808000:1",
    m: "DIR_CLOSE",
    a: 1_721_808_000,
    o: 1,
    r: "ONLY_EXACT_TRIGGER",
    f: "EXACT",
    x: "SHADOW_ONLY",
  };
}

function configureEntryV2Batch(
  value: Record<string, unknown>,
  {
    producerInstanceId = String(value.producer_instance_id),
    sequence,
    kind = "incremental",
    closeEpoch,
    setupId,
    directionalClose = true,
  }: {
    readonly producerInstanceId?: string;
    readonly sequence: number;
    readonly kind?: "snapshot" | "incremental";
    readonly closeEpoch: number;
    readonly setupId: string;
    readonly directionalClose?: boolean;
  },
): void {
  value.producer_instance_id = producerInstanceId;
  value.sequence = sequence;
  value.kind = kind;
  value.bar_open_epoch = closeEpoch - 300;
  value.bar_close_epoch = closeEpoch;
  value.idempotency_key =
    `${producerInstanceId}:${sequence}:${kind}:${closeEpoch}:0`;
  const setup = entryV2Setup(value);
  setup.s = setupId;
  const facts = setup.f as Record<string, unknown>;
  const bar = (facts.b as Record<string, unknown>[]).at(-1)!;
  bar.oe = closeEpoch - 300;
  bar.ce = closeEpoch;
  bar.c = directionalClose ? 103 : 99;
  bar.h = directionalClose ? 105 : 100;
}

function currentMatchedEntryTranscript(
  closeEpoch: number,
): Record<string, unknown> {
  const htfOpenEpoch = closeEpoch - 300;
  return {
    m: 15,
    ae: htfOpenEpoch,
    ao: 100,
    cu: closeEpoch,
    rs: 60,
    cs: htfOpenEpoch,
    ce: closeEpoch,
    ec: 5,
    oc: 5,
    gp: false,
    lo: true,
    db: false,
    cc: {
      oe: closeEpoch - 180,
      ce: closeEpoch - 120,
      o: 95,
      h: 98,
      l: 89,
      c: 96,
    },
    rc: {
      oe: closeEpoch - 120,
      ce: closeEpoch - 60,
      o: 96,
      h: 101,
      l: 94,
      c: 100,
    },
    sb: false,
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

function entryV3WorkerPayload(
  caseId = "strict_long_boc_only",
): Record<string, unknown> {
  const vectors = JSON.parse(
    readFileSync(
      new URL(
        "../../../contracts/vectors/rd-entry-arbitration-v3.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as {
    cases: Array<{
      case_id: string;
      input: Record<string, unknown>;
      expected: {
        candidates: Array<Record<string, unknown>>;
        evidence: Array<Record<string, unknown>>;
        selection: Record<string, unknown>;
      };
    }>;
  };
  const vector = structuredClone(
    vectors.cases.find((item) => item.case_id === caseId)!,
  );
  const evidence = vector.expected.evidence[0]!;
  const input = vector.input;
  const commonRuleIds = [
    "LIQ_ACTUAL_EXTREME_SWEPT",
    "LIQ_DISTANCE_INFLUENCES_ZONE",
    "LIQ_EVENT_ORDER",
    "LIQ_INTERNAL_REBREAK",
    "LIQ_NORMAL_TWO_OPPOSITE_CANDLES",
    "LIQ_ONE_CANDLE_EXCEPTION",
    "LIQ_OWN_EXTREME_SAME_LEG",
    "LIQ_REPLACEMENT_AFTER_STALE_MOVE",
    "LIQ_STRICT_OWN_EXTREME_BREAK",
    "TIMEFRAME_FIVE_MINUTE_ONLY",
    "ZONE_ACCURACY_BOUNDS",
    "ZONE_FRESH_UNTAPPED",
    "ZONE_ORIGIN_OPPOSITE_CANDLE",
    "ZONE_PRE_ENTRY_CLOSE_OUTSIDE",
  ];
  return {
    schema_version: "3.0",
    strategy_id: "rd_liquidity_sd_5m_v1",
    strategy_version: "3.0.0-contract3",
    rule_contract_version: "3.0.0",
    execution_mode: "PAPER_ONLY",
    producer_instance_id: "worker-v3",
    producer_sequence: 1,
    event_id: "worker-v3:1",
    is_realtime: true,
    symbol: "EURUSD",
    ticker_id: "OANDA:EURUSD",
    feed: "OANDA",
    timeframe: "5",
    tick_size: "0.00001",
    detector_code_hash: "a".repeat(64),
    settings_hash: "b".repeat(64),
    observed_at_epoch: 2400,
    market_event: {
      epoch: evidence.observed_trigger_epoch,
      sequence: evidence.trigger_sequence,
      tick_price_ticks: evidence.observed_trigger_ticks,
      barstate_isconfirmed: false,
      confirmed_bar: null,
    },
    exit_events: [],
    setups: [
      {
        setup: {
          setup_id: input.setup_id,
          direction: input.direction,
          zone_top_ticks: input.zone_top_ticks,
          zone_bottom_ticks: input.zone_bottom_ticks,
          zone_engaged_epoch: input.zone_engaged_epoch,
          invalidated_before_entry: input.setup_invalidated,
          common_fidelity: input.common_fidelity,
          common_rule_results: commonRuleIds.map((rule_id) => ({
            rule_id,
            passed: true,
          })),
        },
        candidates: vector.expected.candidates,
        evidence: vector.expected.evidence,
        selection_proposal: vector.expected.selection,
        trade_plan: {
          direction: "LONG",
          entry_ticks: evidence.observed_trigger_ticks,
          stop_ticks: 101,
          target_ticks: 151,
        },
      },
    ],
  };
}

function seedEntryV3Decision(
  database: FakeD1,
  caseId: string,
): void {
  const vectors = JSON.parse(
    readFileSync(
      new URL(
        "../../../contracts/vectors/rd-entry-arbitration-v3.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as {
    cases: Array<{
      case_id: string;
      expected: {
        candidates: Array<Record<string, unknown>>;
        evidence: Array<Record<string, unknown>>;
        selection: Record<string, unknown>;
      };
    }>;
  };
  const expected = structuredClone(
    vectors.cases.find((item) => item.case_id === caseId)!.expected,
  );
  const eventId = `decision-event:${caseId}`;
  const receiptId = `decision-receipt:${caseId}`;
  database.sqlite
    .prepare(
      `INSERT INTO observation_receipts (
        receipt_id, received_at, idempotency_key, payload_sha256,
        schema_version, strategy_id, strategy_version, producer_instance_id,
        sequence, symbol, ticker_id, feed, timeframe, kind
      ) VALUES (?, '2026-07-28T00:00:00Z', ?, ?, '3.0',
        'rd_liquidity_sd_5m_v1', '3.0.0-contract3', 'decision-test-producer',
        1, 'EURUSD', 'OANDA:EURUSD', 'OANDA', '5', 'incremental')`,
    )
    .run(receiptId, `decision:${caseId}`, "9".repeat(64));
  database.sqlite
    .prepare(
      `INSERT INTO observation_entry_v3_events (
        event_id, receipt_id, producer_instance_id, producer_sequence,
        strategy_version, rule_contract_version, event_role, is_realtime,
        symbol, tick_size, detector_code_hash, settings_hash,
        validated_payload_json, payload_sha256, observed_at_epoch, recorded_at
      ) VALUES (?, ?, 'decision-test-producer', 1, '3.0.0-contract3',
        '3.0.0', 'ENTRY_DECISION', 1, 'EURUSD', '0.00001', ?, ?,
        ?, ?, 2400, '2026-07-28T00:00:00Z')`,
    )
    .run(
      eventId,
      receiptId,
      "a".repeat(64),
      "b".repeat(64),
      JSON.stringify({ credential: CREDENTIAL, payload: "not-for-read-api" }),
      "9".repeat(64),
    );
  const candidateRows = new Map<string, string>();
  for (const [index, candidate] of expected.candidates.entries()) {
    const logicalId = String(candidate.candidate_id);
    const rowId = `stored-candidate:${index}:${logicalId}`;
    candidateRows.set(logicalId, rowId);
    database.sqlite
      .prepare(
        `INSERT INTO observation_entry_v3_candidates (
          candidate_id, logical_candidate_id, event_id, setup_id, model,
          state, direction, event_anchor_epoch, trigger_ordinal, boc_tier,
          reference_candle_open_epoch, source_claim_ids_json, candidate_json,
          observed_at_epoch
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        rowId,
        logicalId,
        eventId,
        candidate.setup_id as string,
        candidate.model as string,
        candidate.state as string,
        candidate.direction as string,
        candidate.event_anchor_epoch as number,
        candidate.trigger_ordinal as number,
        candidate.boc_tier as string | null,
        candidate.reference_candle_open_epoch as number | null,
        JSON.stringify(candidate.source_claim_ids),
        JSON.stringify(candidate),
        candidate.observed_at_epoch as number,
      );
  }
  const evidenceRows = new Map<string, string>();
  for (const [index, evidence] of expected.evidence.entries()) {
    const logicalId = String(evidence.evidence_id);
    const logicalCandidateId = String(evidence.candidate_id);
    const rowId = `stored-evidence:${index}:${logicalId}`;
    evidenceRows.set(logicalId, rowId);
    database.sqlite
      .prepare(
        `INSERT INTO observation_entry_v3_evidence (
          evidence_id, logical_evidence_id, event_id, candidate_id,
          logical_candidate_id, observed_trigger_epoch, trigger_sequence,
          observed_trigger_ticks, fidelity, proof_plane, replayability,
          evidence_json, observed_at_epoch
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        rowId,
        logicalId,
        eventId,
        candidateRows.get(logicalCandidateId)!,
        logicalCandidateId,
        evidence.observed_trigger_epoch as number | null,
        evidence.trigger_sequence as number,
        evidence.observed_trigger_ticks as number | null,
        evidence.fidelity as string,
        evidence.proof_plane as string,
        evidence.replayability as string,
        JSON.stringify(evidence),
        evidence.observed_at_epoch as number,
      );
  }
  const selection = expected.selection;
  const selectedEvidence = expected.evidence.find(
    (evidence) =>
      evidence.evidence_id === selection.canonical_evidence_id,
  );
  const selectionRowId = `stored-selection:${String(selection.selection_id)}`;
  database.sqlite
    .prepare(
      `INSERT INTO observation_entry_v3_selections (
        selection_id, logical_selection_id, event_id, setup_id, attempt_kind,
        policy_version, revision, canonical_candidate_id,
        canonical_evidence_id, canonical_model, reason, fidelity,
        policy_action, action, effective_action_reason,
        co_triggered_models_json, evaluated_at_epoch, selected_trigger_epoch,
        selected_trigger_sequence, entry_ticks, stop_ticks, target_ticks,
        selection_json
      ) VALUES (?, ?, ?, ?, 'INITIAL', 'rd-entry-arbitration-v3', ?, ?, ?, ?,
        ?, ?, ?, 'SHADOW_ONLY', 'PROMOTION_IDENTITY_MISMATCH', ?, ?, ?, ?,
        109, 101, 151, ?)`,
    )
    .run(
      selectionRowId,
      selection.selection_id as string,
      eventId,
      selection.setup_id as string,
      selection.revision as number,
      candidateRows.get(String(selection.canonical_candidate_id)) ?? null,
      evidenceRows.get(String(selection.canonical_evidence_id)) ?? null,
      selection.canonical_model as string | null,
      selection.reason as string,
      selection.fidelity as string | null,
      selection.action as string,
      JSON.stringify(selection.co_triggered_models),
      selection.evaluated_at_epoch as number,
      (selectedEvidence?.observed_trigger_epoch as number | null) ?? null,
      (selectedEvidence?.trigger_sequence as number | undefined) ?? null,
      JSON.stringify(selection),
    );
  for (const rowId of candidateRows.values()) {
    database.sqlite
      .prepare(
        `INSERT INTO observation_entry_v3_selection_members (
          selection_id, object_kind, object_id
        ) VALUES (?, 'CANDIDATE', ?)`,
      )
      .run(selectionRowId, rowId);
  }
  for (const rowId of evidenceRows.values()) {
    database.sqlite
      .prepare(
        `INSERT INTO observation_entry_v3_selection_members (
          selection_id, object_kind, object_id
        ) VALUES (?, 'EVIDENCE', ?)`,
      )
      .run(selectionRowId, rowId);
  }
  database.sqlite
    .prepare(
      `INSERT INTO observation_entry_v3_parity (
        parity_id, event_id, selection_id, parity_status, mismatch_reason,
        compared_at
      ) VALUES (?, ?, ?, 'MATCH', NULL, '2026-07-28T00:00:00Z')`,
    )
    .run(`parity:${caseId}`, eventId, selectionRowId);
}

function cloneEntryV3DecisionEvent(
  database: FakeD1,
  caseId: string,
  suffix: string,
  exactEventId = false,
): {
  readonly originalSelectionId: string;
  readonly clonedSelectionId: string;
  readonly originalCandidateIds: Map<string, string>;
  readonly clonedCandidateIds: Map<string, string>;
  readonly originalEvidenceIds: Map<string, string>;
  readonly clonedEvidenceIds: Map<string, string>;
} {
  const originalEventId = exactEventId ? caseId : `decision-event:${caseId}`;
  const clonedEventId = `zz-decision-event:${suffix}`;
  const clonedReceiptId = `zz-decision-receipt:${suffix}`;
  const event = database.sqlite
    .prepare(
      `SELECT *
       FROM observation_entry_v3_events
       WHERE event_id = ?`,
    )
    .get(originalEventId) as Record<string, SqliteInput>;
  database.sqlite
    .prepare(
      `INSERT INTO observation_receipts (
        receipt_id, received_at, idempotency_key, payload_sha256,
        schema_version, strategy_id, strategy_version, producer_instance_id,
        sequence, symbol, ticker_id, feed, timeframe, kind
      ) VALUES (?, '2026-07-28T00:00:01Z', ?, ?, '3.0',
        'rd_liquidity_sd_5m_v1', '3.0.0-contract3', ?, 1, ?, ?,
        'OANDA', '5', 'incremental')`,
    )
    .run(
      clonedReceiptId,
      `decision-clone:${suffix}`,
      sqliteValue(event, "payload_sha256"),
      `decision-clone-producer:${suffix}`,
      sqliteValue(event, "symbol"),
      `OANDA:${String(sqliteValue(event, "symbol"))}`,
    );
  database.sqlite
    .prepare(
      `INSERT INTO observation_entry_v3_events (
        event_id, receipt_id, producer_instance_id, producer_sequence,
        strategy_version, rule_contract_version, event_role, is_realtime,
        symbol, tick_size, detector_code_hash, settings_hash,
        validated_payload_json, payload_sha256, observed_at_epoch, recorded_at
      ) VALUES (?, ?, ?, 1, '3.0.0-contract3', '3.0.0', 'ENTRY_DECISION',
        ?, ?, ?, ?, ?, ?, ?, ?, '2026-07-28T00:00:01Z')`,
    )
    .run(
      clonedEventId,
      clonedReceiptId,
      `decision-clone-producer:${suffix}`,
      sqliteValue(event, "is_realtime"),
      sqliteValue(event, "symbol"),
      sqliteValue(event, "tick_size"),
      sqliteValue(event, "detector_code_hash"),
      sqliteValue(event, "settings_hash"),
      sqliteValue(event, "validated_payload_json"),
      sqliteValue(event, "payload_sha256"),
      sqliteValue(event, "observed_at_epoch"),
    );
  const originalCandidateIds = new Map<string, string>();
  const clonedCandidateIds = new Map<string, string>();
  const candidates = database.sqlite
    .prepare(
      `SELECT *
       FROM observation_entry_v3_candidates
       WHERE event_id = ?
       ORDER BY candidate_id`,
    )
    .all(originalEventId) as Array<Record<string, SqliteInput>>;
  for (const candidate of candidates) {
    const logicalId = String(candidate.logical_candidate_id);
    const clonedId = `zz:${suffix}:${String(candidate.candidate_id)}`;
    originalCandidateIds.set(logicalId, String(candidate.candidate_id));
    clonedCandidateIds.set(logicalId, clonedId);
    database.sqlite
      .prepare(
        `INSERT INTO observation_entry_v3_candidates (
          candidate_id, logical_candidate_id, event_id, setup_id, model,
          state, direction, event_anchor_epoch, trigger_ordinal, boc_tier,
          reference_candle_open_epoch, source_claim_ids_json, candidate_json,
          observed_at_epoch
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        clonedId,
        logicalId,
        clonedEventId,
        sqliteValue(candidate, "setup_id"),
        sqliteValue(candidate, "model"),
        sqliteValue(candidate, "state"),
        sqliteValue(candidate, "direction"),
        sqliteValue(candidate, "event_anchor_epoch"),
        sqliteValue(candidate, "trigger_ordinal"),
        sqliteValue(candidate, "boc_tier"),
        sqliteValue(candidate, "reference_candle_open_epoch"),
        sqliteValue(candidate, "source_claim_ids_json"),
        sqliteValue(candidate, "candidate_json"),
        sqliteValue(candidate, "observed_at_epoch"),
      );
  }
  const originalEvidenceIds = new Map<string, string>();
  const clonedEvidenceIds = new Map<string, string>();
  const evidenceRows = database.sqlite
    .prepare(
      `SELECT *
       FROM observation_entry_v3_evidence
       WHERE event_id = ?
       ORDER BY evidence_id`,
    )
    .all(originalEventId) as Array<Record<string, SqliteInput>>;
  for (const evidence of evidenceRows) {
    const logicalId = String(evidence.logical_evidence_id);
    const logicalCandidateId = String(evidence.logical_candidate_id);
    const clonedId = `zz:${suffix}:${String(evidence.evidence_id)}`;
    originalEvidenceIds.set(logicalId, String(evidence.evidence_id));
    clonedEvidenceIds.set(logicalId, clonedId);
    database.sqlite
      .prepare(
        `INSERT INTO observation_entry_v3_evidence (
          evidence_id, logical_evidence_id, event_id, candidate_id,
          logical_candidate_id, observed_trigger_epoch, trigger_sequence,
          observed_trigger_ticks, fidelity, proof_plane, replayability,
          evidence_json, observed_at_epoch
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        clonedId,
        logicalId,
        clonedEventId,
        clonedCandidateIds.get(logicalCandidateId)!,
        logicalCandidateId,
        sqliteValue(evidence, "observed_trigger_epoch"),
        sqliteValue(evidence, "trigger_sequence"),
        sqliteValue(evidence, "observed_trigger_ticks"),
        sqliteValue(evidence, "fidelity"),
        sqliteValue(evidence, "proof_plane"),
        sqliteValue(evidence, "replayability"),
        sqliteValue(evidence, "evidence_json"),
        sqliteValue(evidence, "observed_at_epoch"),
      );
  }
  const selection = database.sqlite
    .prepare(
      `SELECT *
       FROM observation_entry_v3_selections
       WHERE event_id = ?`,
    )
    .get(originalEventId) as Record<string, SqliteInput>;
  const originalSelectionId = String(selection.selection_id);
  const clonedSelectionId = `00:${suffix}:${originalSelectionId}`;
  const canonicalCandidateLogical =
    selection.canonical_candidate_id === null
      ? null
      : (database.sqlite
          .prepare(
            `SELECT logical_candidate_id
             FROM observation_entry_v3_candidates
             WHERE candidate_id = ?`,
          )
          .get(sqliteValue(selection, "canonical_candidate_id")) as {
          logical_candidate_id: string;
        }).logical_candidate_id;
  const canonicalEvidenceLogical =
    selection.canonical_evidence_id === null
      ? null
      : (database.sqlite
          .prepare(
            `SELECT logical_evidence_id
             FROM observation_entry_v3_evidence
             WHERE evidence_id = ?`,
          )
          .get(sqliteValue(selection, "canonical_evidence_id")) as {
          logical_evidence_id: string;
        }).logical_evidence_id;
  database.sqlite
    .prepare(
      `INSERT INTO observation_entry_v3_selections (
        selection_id, logical_selection_id, event_id, setup_id, attempt_kind,
        policy_version, revision, canonical_candidate_id,
        canonical_evidence_id, canonical_model, reason, fidelity,
        policy_action, action, effective_action_reason,
        co_triggered_models_json, evaluated_at_epoch, selected_trigger_epoch,
        selected_trigger_sequence, entry_ticks, stop_ticks, target_ticks,
        selection_json
      ) VALUES (?, ?, ?, ?, ?, 'rd-entry-arbitration-v3', ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      clonedSelectionId,
      sqliteValue(selection, "logical_selection_id"),
      clonedEventId,
      sqliteValue(selection, "setup_id"),
      sqliteValue(selection, "attempt_kind"),
      sqliteValue(selection, "revision"),
      canonicalCandidateLogical === null
        ? null
        : (clonedCandidateIds.get(canonicalCandidateLogical) ?? null),
      canonicalEvidenceLogical === null
        ? null
        : (clonedEvidenceIds.get(canonicalEvidenceLogical) ?? null),
      sqliteValue(selection, "canonical_model"),
      sqliteValue(selection, "reason"),
      sqliteValue(selection, "fidelity"),
      sqliteValue(selection, "policy_action"),
      sqliteValue(selection, "action"),
      sqliteValue(selection, "effective_action_reason"),
      sqliteValue(selection, "co_triggered_models_json"),
      sqliteValue(selection, "evaluated_at_epoch"),
      sqliteValue(selection, "selected_trigger_epoch"),
      sqliteValue(selection, "selected_trigger_sequence"),
      sqliteValue(selection, "entry_ticks"),
      sqliteValue(selection, "stop_ticks"),
      sqliteValue(selection, "target_ticks"),
      sqliteValue(selection, "selection_json"),
    );
  for (const candidateId of clonedCandidateIds.values()) {
    database.sqlite
      .prepare(
        `INSERT INTO observation_entry_v3_selection_members (
          selection_id, object_kind, object_id
        ) VALUES (?, 'CANDIDATE', ?)`,
      )
      .run(clonedSelectionId, candidateId);
  }
  for (const evidenceId of clonedEvidenceIds.values()) {
    database.sqlite
      .prepare(
        `INSERT INTO observation_entry_v3_selection_members (
          selection_id, object_kind, object_id
        ) VALUES (?, 'EVIDENCE', ?)`,
      )
      .run(clonedSelectionId, evidenceId);
  }
  database.sqlite
    .prepare(
      `INSERT INTO observation_entry_v3_parity (
        parity_id, event_id, selection_id, parity_status, mismatch_reason,
        compared_at
      ) VALUES (?, ?, ?, 'MATCH', NULL, '2026-07-28T00:00:01Z')`,
    )
    .run(`zz-parity:${suffix}`, clonedEventId, clonedSelectionId);
  return {
    originalSelectionId,
    clonedSelectionId,
    originalCandidateIds,
    clonedCandidateIds,
    originalEvidenceIds,
    clonedEvidenceIds,
  };
}

function entryV3WorkerExitPayload(
  base: Record<string, unknown>,
  eventId: string,
  exitReason: "STOP_LOSS" | "TARGET",
  sequence: number,
): Record<string, unknown> {
  const payload = structuredClone(base);
  const bundle = (payload.setups as Array<Record<string, unknown>>)[0]!;
  const setup = bundle.setup as Record<string, unknown>;
  const plan = bundle.trade_plan as Record<string, unknown>;
  const priceTicks =
    exitReason === "STOP_LOSS" ? plan.stop_ticks : plan.target_ticks;
  payload.event_id = eventId;
  payload.producer_sequence = sequence;
  payload.observed_at_epoch = 3000 + sequence;
  payload.market_event = {
    epoch: 3000 + sequence,
    sequence,
    tick_price_ticks: priceTicks,
    barstate_isconfirmed: false,
    confirmed_bar: null,
  };
  payload.exit_events = [
    {
      event_id: `${eventId}:exit`,
      setup_id: setup.setup_id,
      exit_reason: exitReason,
      epoch: 3000 + sequence,
      sequence,
      price_ticks: priceTicks,
    },
  ];
  return payload;
}

function installWorkerPaperAccount(database: FakeD1): void {
  database.sqlite
    .prepare(
      `INSERT INTO paper_accounts (
        account_id, mode, label, currency_code, currency_scale,
        opening_balance_minor, idempotency_key, payload_sha256, created_at
      ) VALUES (?, 'PAPER_ONLY', ?, 'USD', 2, ?, ?, ?, ?)`,
    )
    .run(
      "paper-primary",
      "Primary",
      5_000_000,
      "paper-account:paper-primary",
      "9".repeat(64),
      "2026-07-28T00:00:00.000Z",
    );
  database.sqlite
    .prepare(
      `INSERT INTO paper_kill_switch_events (
        event_id, idempotency_key, payload_sha256, enabled, reason, changed_at
      ) VALUES (?, ?, ?, 0, ?, ?)`,
    )
    .run(
      "paper-kill-switch-worker-disabled",
      "paper-kill-switch:worker-disabled",
      "8".repeat(64),
      "TEST_DISABLED",
      "2026-07-28T00:00:01.000Z",
    );
}

async function body(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

describe("observation edge Worker", () => {
  it("returns a protected, bounded v3 decision ledger with all competing models", async () => {
    const database = new FakeD1();
    const env = await environment(database, {
      PAPER_LEDGER_ENABLED: "true",
      PAPER_LEDGER_ADMIN_CREDENTIAL_SHA256: await sha256(CREDENTIAL),
      RD_ENTRY_V3_DETECTOR_CODE_HASH: "c".repeat(64),
      RD_ENTRY_V3_SETTINGS_HASH: "d".repeat(64),
    });
    seedEntryV3Decision(
      database,
      "close_fallback_after_blocked_aggressive_models",
    );

    const response = await handleRequest(
      new Request(`${BASE_URL}/api/v1/rd-entry-decisions?limit=20`, {
        headers: { Authorization: `Bearer ${CREDENTIAL}` },
      }),
      env,
    );
    const report = await body(response);

    expect(response.status).toBe(200);
    expect(report.mode).toBe("PAPER_ONLY");
    const items = report.items as Array<Record<string, unknown>>;
    expect(items).toHaveLength(1);
    expect(items[0]?.selection).toMatchObject({
      canonical_model: "DIR_CLOSE",
      policy_action: "PAPER_ELIGIBLE",
      action: "SHADOW_ONLY",
      effective_action_reason: "PROMOTION_IDENTITY_MISMATCH",
    });
    expect(
      (items[0]?.candidates as Array<Record<string, unknown>>).map(
        (candidate) => candidate.model,
      ),
    ).toEqual(["BOC", "DIR_CLOSE", "HTF_FLIP"]);
    expect(JSON.stringify(report)).not.toContain("validated_payload_json");
    expect(JSON.stringify(report)).not.toContain(CREDENTIAL);
    expect(JSON.stringify(report)).not.toContain("RD_ENTRY_");
    expect(new TextEncoder().encode(JSON.stringify(report)).byteLength).toBeLessThan(
      1_048_576,
    );

    const decisionQueries = database.preparedSql.filter((sql) =>
      sql.includes("observation_entry_v3_"),
    );
    expect(
      decisionQueries.filter((sql) =>
        sql.includes("observation_entry_v3_candidates"),
      ),
    ).toHaveLength(1);
    expect(
      decisionQueries.filter((sql) =>
        sql.includes("observation_entry_v3_evidence"),
      ),
    ).toHaveLength(1);
  });

  it.each([
    "/api/v1/rd-entry-decisions",
    "/api/v1/rd-entry-decisions?limit=0",
    "/api/v1/rd-entry-decisions?limit=201",
    "/api/v1/rd-entry-decisions?limit=x",
    "/api/v1/rd-entry-decisions?limit=1&limit=2",
    "/api/v1/rd-entry-decisions?limit=20&cursor=secret",
  ])("rejects a non-exact decision limit query: %s", async (path) => {
    const env = await environment(new FakeD1(), {
      PAPER_LEDGER_ENABLED: "true",
      PAPER_LEDGER_ADMIN_CREDENTIAL_SHA256: await sha256(CREDENTIAL),
    });
    const response = await handleRequest(
      new Request(`${BASE_URL}${path}`, {
        headers: { Authorization: `Bearer ${CREDENTIAL}` },
      }),
      env,
    );
    expect(response.status).toBe(422);
  });

  it("authenticates the decision ledger like existing protected reads", async () => {
    const env = await environment(new FakeD1(), {
      PAPER_LEDGER_ENABLED: "true",
      PAPER_LEDGER_ADMIN_CREDENTIAL_SHA256: await sha256(CREDENTIAL),
    });
    const unauthorized = await handleRequest(
      new Request(`${BASE_URL}/api/v1/rd-entry-decisions?limit=20`),
      env,
    );
    const wrongMethod = await handleRequest(
      new Request(`${BASE_URL}/api/v1/rd-entry-decisions?limit=20`, {
        method: "POST",
        headers: { Authorization: `Bearer ${CREDENTIAL}` },
      }),
      env,
    );
    const empty = await handleRequest(
      new Request(`${BASE_URL}/api/v1/rd-entry-decisions?limit=20`, {
        headers: { Authorization: `Bearer ${CREDENTIAL}` },
      }),
      env,
    );
    expect(unauthorized.status).toBe(401);
    expect(wrongMethod.status).toBe(405);
    expect(await body(empty)).toEqual({
      schema_version: "1.0",
      mode: "PAPER_ONLY",
      count: 0,
      items: [],
    });
  });

  it("returns the later same-epoch attempt revision even when its ID sorts earlier", async () => {
    const database = new FakeD1();
    seedEntryV3Decision(database, "discretionary_boc_shadow");
    const sourceCandidate = database.sqlite
      .prepare(
        `SELECT candidate_id, setup_id, direction
         FROM observation_entry_v3_candidates
         WHERE event_id = ? AND model = 'BOC'`,
      )
      .get("decision-event:discretionary_boc_shadow") as {
      candidate_id: string;
      setup_id: string;
      direction: "LONG" | "SHORT";
    };
    const sourceEvidence = database.sqlite
      .prepare(
        `SELECT observed_trigger_epoch, trigger_sequence, observed_trigger_ticks
         FROM observation_entry_v3_evidence
         WHERE candidate_id = ?`,
      )
      .get(sourceCandidate.candidate_id) as {
      observed_trigger_epoch: number;
      trigger_sequence: number;
      observed_trigger_ticks: number;
    };
    database.sqlite
      .prepare(
        `INSERT INTO observation_entry_v3_shadow_positions (
          candidate_id, setup_id, attempt_kind, direction, trigger_epoch,
          trigger_sequence, evaluated_at_epoch, entry_ticks, stop_ticks,
          target_ticks, state, exit_event_id, outcome_r_millis, created_at,
          terminal_at
        ) VALUES (?, ?, 'INITIAL', ?, ?, ?, 2400, ?, 101, 151, 'OPEN',
          NULL, NULL, '2026-07-28T00:00:00Z', NULL)`,
      )
      .run(
        sourceCandidate.candidate_id,
        sourceCandidate.setup_id,
        sourceCandidate.direction,
        sourceEvidence.observed_trigger_epoch,
        sourceEvidence.trigger_sequence,
        sourceEvidence.observed_trigger_ticks,
      );
    const clone = cloneEntryV3DecisionEvent(
      database,
      "discretionary_boc_shadow",
      "later-same-setup",
    );
    expect(
      clone.clonedSelectionId.localeCompare(clone.originalSelectionId),
    ).toBeLessThan(0);
    const env = await environment(database, {
      PAPER_LEDGER_ENABLED: "true",
      PAPER_LEDGER_ADMIN_CREDENTIAL_SHA256: await sha256(CREDENTIAL),
    });
    const response = await handleRequest(
      new Request(`${BASE_URL}/api/v1/rd-entry-decisions?limit=20`, {
        headers: { Authorization: `Bearer ${CREDENTIAL}` },
      }),
      env,
    );
    const report = await body(response);
    const items = report.items as Array<Record<string, unknown>>;
    expect(response.status).toBe(200);
    expect(items).toHaveLength(1);
    expect(items[0]?.decision_id).toBe(clone.clonedSelectionId);
    expect(items[0]?.shadow_outcome).toBeNull();
  });

  it("limits current cards by attempt and preserves the immutable opened paper selection", async () => {
    const database = new FakeD1();
    installWorkerPaperAccount(database);
    const env = await environment(database, {
      PAPER_LEDGER_ENABLED: "true",
      PAPER_LEDGER_ADMIN_CREDENTIAL_SHA256: await sha256(CREDENTIAL),
      RD_ENTRY_V3_DETECTOR_CODE_HASH: "a".repeat(64),
      RD_ENTRY_V3_SETTINGS_HASH: "b".repeat(64),
      RD_ENTRY_PAPER_ACCOUNT_IDS: "paper-primary",
      RD_ENTRY_PAPER_RISK_BPS: "50",
    });
    const first = entryV3WorkerPayload();
    const firstResponse = await handleRequest(postBody(first), env);
    expect(firstResponse.status).toBe(202);
    const opened = database.sqlite
      .prepare(
        `SELECT selection_id, logical_selection_id
         FROM observation_entry_v3_selections`,
      )
      .get() as { selection_id: string; logical_selection_id: string };

    const clone = cloneEntryV3DecisionEvent(
      database,
      "worker-v3:1",
      "paper-followup",
      true,
    );
    database.sqlite.exec(
      "DROP TRIGGER observation_entry_v3_selections_no_update",
    );
    database.sqlite
      .prepare(
        `UPDATE observation_entry_v3_selections
         SET action = 'SHADOW_ONLY',
             effective_action_reason = 'NOT_SELECTED_ALREADY_OPEN'
         WHERE selection_id = ?`,
      )
      .run(clone.clonedSelectionId);

    const response = await handleRequest(
      new Request(`${BASE_URL}/api/v1/rd-entry-decisions?limit=1`, {
        headers: { Authorization: `Bearer ${CREDENTIAL}` },
      }),
      env,
    );
    const report = await body(response);
    const items = report.items as Array<Record<string, unknown>>;
    expect(response.status).toBe(200);
    expect(items).toHaveLength(1);
    expect(items[0]?.decision_id).toBe(clone.clonedSelectionId);
    expect(items[0]?.selection).toMatchObject({
      action: "SHADOW_ONLY",
      effective_action_reason: "NOT_SELECTED_ALREADY_OPEN",
    });
    expect(items[0]?.opened_economic_selection).toEqual({
      decision_id: opened.selection_id,
      selection_id: opened.logical_selection_id,
      canonical_model: "BOC",
      reason: "ONLY_EXACT_TRIGGER",
      evaluated_at_epoch: 2400,
    });
    expect(items[0]).toMatchObject({
      paper_intent_id: expect.any(String),
      trade: { state: "OPEN" },
    });
    expect(
      database.sqlite
        .prepare(
          `SELECT COUNT(*) AS count
           FROM observation_entry_v3_selections`,
        )
        .get(),
    ).toEqual({ count: 2 });
  });

  it("fails closed when selection members are grafted across v3 events", async () => {
    const database = new FakeD1();
    seedEntryV3Decision(
      database,
      "close_fallback_after_blocked_aggressive_models",
    );
    const clone = cloneEntryV3DecisionEvent(
      database,
      "close_fallback_after_blocked_aggressive_models",
      "foreign-graph",
    );
    const bocLogicalId = [...clone.originalCandidateIds.keys()].find(
      (logicalId) => {
        const row = database.sqlite
          .prepare(
            `SELECT model
             FROM observation_entry_v3_candidates
             WHERE candidate_id = ?`,
          )
          .get(clone.originalCandidateIds.get(logicalId)!) as { model: string };
        return row.model === "BOC";
      },
    )!;
    const bocEvidenceLogicalId = [...clone.originalEvidenceIds.keys()].find(
      (logicalId) => {
        const row = database.sqlite
          .prepare(
            `SELECT logical_candidate_id
             FROM observation_entry_v3_evidence
             WHERE evidence_id = ?`,
          )
          .get(clone.originalEvidenceIds.get(logicalId)!) as {
          logical_candidate_id: string;
        };
        return row.logical_candidate_id === bocLogicalId;
      },
    )!;
    database.sqlite.exec(
      "DROP TRIGGER observation_entry_v3_selection_members_no_delete",
    );
    database.sqlite
      .prepare(
        `DELETE FROM observation_entry_v3_selection_members
         WHERE selection_id = ? AND object_id IN (?, ?)`,
      )
      .run(
        clone.clonedSelectionId,
        clone.clonedCandidateIds.get(bocLogicalId)!,
        clone.clonedEvidenceIds.get(bocEvidenceLogicalId)!,
      );
    database.sqlite
      .prepare(
        `INSERT INTO observation_entry_v3_selection_members (
          selection_id, object_kind, object_id
        ) VALUES (?, 'CANDIDATE', ?), (?, 'EVIDENCE', ?)`,
      )
      .run(
        clone.clonedSelectionId,
        clone.originalCandidateIds.get(bocLogicalId)!,
        clone.clonedSelectionId,
        clone.originalEvidenceIds.get(bocEvidenceLogicalId)!,
      );
    const env = await environment(database, {
      PAPER_LEDGER_ENABLED: "true",
      PAPER_LEDGER_ADMIN_CREDENTIAL_SHA256: await sha256(CREDENTIAL),
    });
    const response = await handleRequest(
      new Request(`${BASE_URL}/api/v1/rd-entry-decisions?limit=20`, {
        headers: { Authorization: `Bearer ${CREDENTIAL}` },
      }),
      env,
    );
    expect(response.status).toBe(503);
    expect(await body(response)).toMatchObject({
      error: { code: "ENTRY_DECISIONS_UNAVAILABLE" },
    });
  });

  it.each(["selected trigger tuple", "co-trigger JSON"] as const)(
    "fails closed when normalized %s conflicts with the raw selection graph",
    async (conflict) => {
      const database = new FakeD1();
      seedEntryV3Decision(
        database,
        "close_fallback_after_blocked_aggressive_models",
      );
      database.sqlite.exec(
        "DROP TRIGGER observation_entry_v3_selections_no_update",
      );
      if (conflict === "selected trigger tuple") {
        database.sqlite
          .prepare(
            `UPDATE observation_entry_v3_selections
             SET selected_trigger_sequence = selected_trigger_sequence + 1`,
          )
          .run();
      } else {
        database.sqlite
          .prepare(
            `UPDATE observation_entry_v3_selections
             SET co_triggered_models_json = '["BOC"]'`,
          )
          .run();
      }
      const env = await environment(database, {
        PAPER_LEDGER_ENABLED: "true",
        PAPER_LEDGER_ADMIN_CREDENTIAL_SHA256: await sha256(CREDENTIAL),
      });

      const response = await handleRequest(
        new Request(`${BASE_URL}/api/v1/rd-entry-decisions?limit=20`, {
          headers: { Authorization: `Bearer ${CREDENTIAL}` },
        }),
        env,
      );

      expect(response.status).toBe(503);
      expect(await body(response)).toMatchObject({
        error: { code: "ENTRY_DECISIONS_UNAVAILABLE" },
      });
    },
  );

  it("caps every related decision graph query before assembly", () => {
    for (const query of [
      LIST_ENTRY_V3_DECISION_MEMBERS_SQL,
      LIST_ENTRY_V3_DECISION_CANDIDATES_SQL,
      LIST_ENTRY_V3_DECISION_EVIDENCE_SQL,
      LIST_ENTRY_V3_DECISION_PARITY_SQL,
      LIST_ENTRY_V3_DECISION_PAPER_SQL,
      LIST_ENTRY_V3_DECISION_SHADOW_SQL,
    ]) {
      expect(query).toMatch(/LIMIT \?/u);
    }
  });

  it("adds the v3 decision ordering index in an additive migration", () => {
    const root = fileURLToPath(new URL("..", import.meta.url));
    const database = new DatabaseSync(":memory:");
    database.exec("PRAGMA foreign_keys = ON");
    applyObservationMigrationsThrough(database, root, 24);
    const migration = readFileSync(
      `${root}/migrations/0025_observation_entry_v3_decision_order.sql`,
      "utf8",
    );
    database.exec(migration);
    expect(migration).toContain(
      "observation_entry_v3_selections(evaluated_at_epoch DESC, selection_id DESC)",
    );
    expect(
      database
        .prepare("PRAGMA index_list('observation_entry_v3_selections')")
        .all(),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "idx_observation_entry_v3_selections_decision_order",
        }),
      ]),
    );
    expect(
      database
        .prepare(
          "PRAGMA index_xinfo('idx_observation_entry_v3_selections_decision_order')",
        )
        .all(),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "evaluated_at_epoch", desc: 1 }),
        expect.objectContaining({ name: "selection_id", desc: 1 }),
      ]),
    );
  });

  it("indexes latest append order per v3 setup attempt without rewriting history", () => {
    const root = fileURLToPath(new URL("..", import.meta.url));
    const database = new DatabaseSync(":memory:");
    database.exec("PRAGMA foreign_keys = ON");
    applyObservationMigrationsThrough(database, root, 25);
    const before = database
      .prepare(
        `SELECT COUNT(*) AS count
         FROM observation_entry_v3_selections`,
      )
      .get();
    const migration = readFileSync(
      `${root}/migrations/0026_observation_entry_v3_attempt_order.sql`,
      "utf8",
    );
    database.exec(migration);

    expect(migration).toContain(
      "idx_observation_entry_v3_selections_attempt_order",
    );
    expect(migration).toContain("setup_id");
    expect(migration).toContain("attempt_kind");
    expect(migration).toContain("evaluated_at_epoch DESC");
    expect(LIST_ENTRY_V3_DECISIONS_SQL).toContain(
      "stored_selection.rowid AS ingest_ordinal",
    );
    expect(LIST_ENTRY_V3_DECISIONS_SQL).toContain(
      "stored_selection.rowid DESC",
    );
    expect(
      database
        .prepare(
          `SELECT COUNT(*) AS count
           FROM observation_entry_v3_selections`,
        )
        .get(),
    ).toEqual(before);
    expect(
      database
        .prepare("PRAGMA index_list('observation_entry_v3_selections')")
        .all(),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "idx_observation_entry_v3_selections_attempt_order",
        }),
      ]),
    );
    database.exec(
      readFileSync(
        `${root}/migrations/0027_observation_entry_v3_paper_fallback_shadow.sql`,
        "utf8",
      ),
    );
    database.exec(
      readFileSync(
        `${root}/migrations/0028_observation_entry_v3_liquidity_cohorts.sql`,
        "utf8",
      ),
    );
    const plan = database
      .prepare(`EXPLAIN QUERY PLAN ${LIST_ENTRY_V3_DECISIONS_SQL}`)
      .all(20) as Array<{ detail: string }>;
    expect(plan.map((step) => step.detail).join("\n")).toContain(
      "idx_observation_entry_v3_selections_attempt_order",
    );
  });

  it("migrates legacy v3 cohorts and admits only exact v3.1 receipt and event tuples", () => {
    const root = fileURLToPath(new URL("..", import.meta.url));
    const database = new DatabaseSync(":memory:");
    database.exec("PRAGMA foreign_keys = ON");
    applyObservationMigrationsThrough(database, root, 27);
    database
      .prepare(
        `INSERT INTO observation_receipts (
          receipt_id, received_at, idempotency_key, payload_sha256,
          schema_version, strategy_id, strategy_version, producer_instance_id,
          sequence, symbol, ticker_id, feed, timeframe, kind
        ) VALUES (
          'legacy-v3-receipt', '2026-07-30T00:00:00Z', 'legacy-v3', ?,
          '3.0', 'rd_liquidity_sd_5m_v1', '3.0.0-contract3',
          'legacy-v3-producer', 1, 'EURUSD', 'OANDA:EURUSD', 'OANDA', '5',
          'incremental'
        )`,
      )
      .run("a".repeat(64));
    database
      .prepare(
        `INSERT INTO observation_entry_v3_events (
          event_id, receipt_id, producer_instance_id, producer_sequence,
          strategy_version, rule_contract_version, event_role, is_realtime,
          symbol, tick_size, detector_code_hash, settings_hash,
          validated_payload_json, payload_sha256, observed_at_epoch, recorded_at
        ) VALUES (
          'legacy-v3-event', 'legacy-v3-receipt', 'legacy-v3-producer', 1,
          '3.0.0-contract3', '3.0.0', 'ENTRY_DECISION', 1, 'EURUSD',
          '0.00001', ?, ?, '{}', ?, 1, '2026-07-30T00:00:00Z'
        )`,
      )
      .run("b".repeat(64), "c".repeat(64), "a".repeat(64));
    database
      .prepare(
        `INSERT INTO observation_entry_v3_selections (
          selection_id, logical_selection_id, event_id, setup_id, attempt_kind,
          policy_version, revision, canonical_candidate_id,
          canonical_evidence_id, canonical_model, reason, fidelity,
          policy_action, action, effective_action_reason,
          co_triggered_models_json, evaluated_at_epoch, selected_trigger_epoch,
          selected_trigger_sequence, entry_ticks, stop_ticks, target_ticks,
          selection_json
        ) VALUES (
          'legacy-v3-selection', 'legacy-v3-logical-selection',
          'legacy-v3-event', 'legacy-v3-setup', 'INITIAL',
          'rd-entry-arbitration-v3', 0, NULL, NULL, NULL, 'NO_CANDIDATE',
          NULL, 'NONE', 'NONE', NULL, '[]', 1, NULL, NULL, 100, 90, 120, '{}'
        )`,
      )
      .run();

    database.exec("BEGIN");
    database.exec(
      readFileSync(
        `${root}/migrations/0028_observation_entry_v3_liquidity_cohorts.sql`,
        "utf8",
      ),
    );
    database.exec("COMMIT");

    expect(
      database
        .prepare(
          `SELECT liquidity_cohort, one_candle_enabled
           FROM observation_entry_v3_selections
           WHERE selection_id = 'legacy-v3-selection'`,
        )
        .get(),
    ).toEqual({
      liquidity_cohort: "TWO_PLUS_CANDLES",
      one_candle_enabled: 0,
    });
    database
      .prepare(
        `INSERT INTO observation_receipts (
          receipt_id, received_at, idempotency_key, payload_sha256,
          schema_version, strategy_id, strategy_version, producer_instance_id,
          sequence, symbol, ticker_id, feed, timeframe, kind
        ) VALUES (
          'v31-receipt', '2026-07-30T00:00:01Z', 'v31', ?, '3.1',
          'rd_liquidity_sd_5m_v1', '3.1.0-contract3', 'v31-producer', 1,
          'EURUSD', 'OANDA:EURUSD', 'OANDA', '5', 'incremental'
        )`,
      )
      .run("d".repeat(64));
    database
      .prepare(
        `INSERT INTO observation_entry_v3_events (
          event_id, receipt_id, producer_instance_id, producer_sequence,
          strategy_version, rule_contract_version, event_role, is_realtime,
          symbol, tick_size, detector_code_hash, settings_hash,
          validated_payload_json, payload_sha256, observed_at_epoch, recorded_at
        ) VALUES (
          'v31-event', 'v31-receipt', 'v31-producer', 1,
          '3.1.0-contract3', '3.1.0', 'ENTRY_DECISION', 1, 'EURUSD',
          '0.00001', ?, ?, '{}', ?, 1, '2026-07-30T00:00:01Z'
        )`,
      )
      .run("e".repeat(64), "f".repeat(64), "d".repeat(64));
    database
      .prepare(
        `INSERT INTO observation_receipts (
          receipt_id, received_at, idempotency_key, payload_sha256,
          schema_version, strategy_id, strategy_version, producer_instance_id,
          sequence, symbol, ticker_id, feed, timeframe, kind
        ) VALUES (
          'v31-bad-event-receipt', '2026-07-30T00:00:02Z',
          'v31-bad-event', ?, '3.1', 'rd_liquidity_sd_5m_v1',
          '3.1.0-contract3', 'v31-bad-event-producer', 1, 'EURUSD',
          'OANDA:EURUSD', 'OANDA', '5', 'incremental'
        )`,
      )
      .run("2".repeat(64));
    expect(() =>
      database
        .prepare(
          `INSERT INTO observation_entry_v3_events (
            event_id, receipt_id, producer_instance_id, producer_sequence,
            strategy_version, rule_contract_version, event_role, is_realtime,
            symbol, tick_size, detector_code_hash, settings_hash,
            validated_payload_json, payload_sha256, observed_at_epoch,
            recorded_at
          ) VALUES (
            'v31-bad-event', 'v31-bad-event-receipt',
            'v31-bad-event-producer', 1, '3.1.0-contract3', '3.0.0',
            'ENTRY_DECISION', 1, 'EURUSD', '0.00001', ?, ?, '{}', ?, 1,
            '2026-07-30T00:00:02Z'
          )`,
        )
        .run("3".repeat(64), "4".repeat(64), "2".repeat(64)),
    ).toThrow();
    expect(() =>
      database
        .prepare(
          `INSERT INTO observation_entry_v3_selections (
            selection_id, logical_selection_id, event_id, setup_id,
            attempt_kind, policy_version, revision, canonical_candidate_id,
            canonical_evidence_id, canonical_model, reason, fidelity,
            policy_action, action, effective_action_reason,
            co_triggered_models_json, evaluated_at_epoch,
            selected_trigger_epoch, selected_trigger_sequence, entry_ticks,
            stop_ticks, target_ticks, selection_json, liquidity_cohort,
            one_candle_enabled
          ) VALUES (
            'malformed-v31-selection', 'malformed-v31-logical', 'v31-event',
            'malformed-v31-setup', 'INITIAL', 'rd-entry-arbitration-v3', 0,
            NULL, NULL, NULL, 'NO_CANDIDATE', NULL, 'NONE', 'NONE', NULL,
            '[]', 1, NULL, NULL, 100, 90, 120, '{}', 'ONE_CANDLE', 0
          )`,
        )
        .run(),
    ).toThrow(/one-candle cohort requires enabled flag/u);
    expect(() =>
      database
        .prepare(
          `INSERT INTO observation_receipts (
            receipt_id, received_at, idempotency_key, payload_sha256,
            schema_version, strategy_id, strategy_version,
            producer_instance_id, sequence, symbol, ticker_id, feed,
            timeframe, kind
          ) VALUES (
            'bad-v31-receipt', '2026-07-30T00:00:02Z', 'bad-v31', ?, '3.1',
            'rd_liquidity_sd_5m_v1', '3.0.0-contract3', 'bad-v31-producer', 1,
            'EURUSD', 'OANDA:EURUSD', 'OANDA', '5', 'incremental'
          )`,
        )
        .run("1".repeat(64)),
    ).toThrow();
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    database.close();
  });

  it("routes bounded v3 audit responses and returns explicit conflicts", async () => {
    const database = new FakeD1();
    const env = await environment(database, {
      RD_ENTRY_V3_DETECTOR_CODE_HASH: "c".repeat(64),
      RD_ENTRY_V3_SETTINGS_HASH: "d".repeat(64),
    });
    const payload = entryV3WorkerPayload();
    const accepted = await handleRequest(postBody(payload), env);
    const acceptedBody = await body(accepted);
    expect(accepted.status).toBe(202);
    expect(Object.keys(acceptedBody).sort()).toEqual([
      "evaluations",
      "event_id",
      "execution",
      "paper_intent_ids",
      "status",
    ]);
    expect(JSON.stringify(acceptedBody)).not.toContain(CREDENTIAL);
    expect(JSON.stringify(acceptedBody)).not.toContain("setups");

    const duplicate = await handleRequest(postBody(payload), env);
    expect(duplicate.status).toBe(200);
    expect(await body(duplicate)).toMatchObject({ status: "DUPLICATE" });

    const conflicting = structuredClone(payload);
    conflicting.detector_code_hash = "e".repeat(64);
    const conflict = await handleRequest(postBody(conflicting), env);
    expect(conflict.status).toBe(409);
    expect(await body(conflict)).toMatchObject({
      error: { code: "IDEMPOTENCY_CONFLICT" },
    });

    const sequenceConflictPayload = structuredClone(payload);
    sequenceConflictPayload.event_id = "worker-v3:sequence-collision";
    const sequenceConflict = await handleRequest(
      postBody(sequenceConflictPayload),
      env,
    );
    expect(sequenceConflict.status).toBe(409);
    expect(await body(sequenceConflict)).toMatchObject({
      error: { code: "PRODUCER_SEQUENCE_CONFLICT" },
    });
  });

  it("replays a stored v3 exit conflict as the same bounded 409", async () => {
    const database = new FakeD1();
    installWorkerPaperAccount(database);
    const env = await environment(database, {
      PAPER_LEDGER_ENABLED: "true",
      PAPER_LEDGER_ADMIN_CREDENTIAL_SHA256: await sha256(CREDENTIAL),
      RD_ENTRY_V3_DETECTOR_CODE_HASH: "a".repeat(64),
      RD_ENTRY_V3_SETTINGS_HASH: "b".repeat(64),
      RD_ENTRY_PAPER_ACCOUNT_IDS: "paper-primary",
      RD_ENTRY_PAPER_RISK_BPS: "50",
    });
    const entry = entryV3WorkerPayload();
    const entryResponse = await handleRequest(postBody(entry), env);
    const entryBody = await body(entryResponse);
    expect(entryResponse.status).toBe(202);
    expect(entryBody).toMatchObject({
      evaluations: [{ action: "PAPER_ELIGIBLE" }],
    });
    expect(
      database.sqlite
        .prepare("SELECT COUNT(*) AS count FROM paper_trade_intents")
        .get(),
    ).toEqual({ count: 1 });
    const protectedHeaders = {
      Authorization: `Bearer ${CREDENTIAL}`,
    };
    const decisionResponse = await handleRequest(
      new Request(`${BASE_URL}/api/v1/rd-entry-decisions?limit=20`, {
        headers: protectedHeaders,
      }),
      env,
    );
    expect(decisionResponse.status).toBe(200);
    expect(await body(decisionResponse)).toMatchObject({
      items: [
        {
          setup_id: "setup-strict-long",
          selection: { canonical_model: "BOC", action: "PAPER_ELIGIBLE" },
          paper_intent_id: expect.any(String),
          trade: { state: "OPEN" },
        },
      ],
    });
    const summaryResponse = await handleRequest(
      new Request(`${BASE_URL}/api/v1/paper-simulations/summary?limit=20`, {
        headers: protectedHeaders,
      }),
      env,
    );
    expect(summaryResponse.status).toBe(200);
    expect(await body(summaryResponse)).toMatchObject({
      intents: [
        {
          setup_id: "setup-strict-long",
          selected_entry_model: "BOC",
          co_triggered_models: [],
          source_receipt_id: null,
        },
      ],
    });

    const stop = entryV3WorkerExitPayload(
      entry,
      "worker-v3:paper-stop",
      "STOP_LOSS",
      2,
    );
    expect((await handleRequest(postBody(stop), env)).status).toBe(202);
    expect(
      database.sqlite
        .prepare("SELECT COUNT(*) AS count FROM paper_trade_settlements")
        .get(),
    ).toEqual({ count: 1 });
    const acceptedReplay = await handleRequest(postBody(stop), env);
    expect(acceptedReplay.status).toBe(200);
    expect(await body(acceptedReplay)).toMatchObject({ status: "DUPLICATE" });

    const target = entryV3WorkerExitPayload(
      entry,
      "worker-v3:paper-target-conflict",
      "TARGET",
      3,
    );
    const first = await handleRequest(postBody(target), env);
    const firstBody = await body(first);
    expect(first.status).toBe(409);
    expect(firstBody).toMatchObject({
      error: { code: "EXIT_CONFLICT" },
    });
    expect(Object.keys(firstBody)).toEqual(["error"]);
    expect(Object.keys(firstBody.error as Record<string, unknown>).sort()).toEqual(
      ["code", "message"],
    );
    expect(JSON.stringify(firstBody)).not.toContain(CREDENTIAL);
    expect(JSON.stringify(firstBody)).not.toContain("setups");

    const replay = await handleRequest(postBody(target), env);
    expect(replay.status).toBe(409);
    expect(await body(replay)).toEqual(firstBody);
  });

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

  it("accepts v2 in shadow while canonical paper defaults false", async () => {
    const response = await handleRequest(
      postBody(entryV2Payload()),
      await environment(),
    );

    expect(response.status).toBe(202);
    expect(await body(response)).toMatchObject({
      assembly: { status: "COMPLETE" },
      canonical_paper_enabled: false,
      evaluation_count: 1,
      execution: "DISABLED",
    });
  });

  it("keeps paper shadowed when only the canonical flag is enabled", async () => {
    const database = new FakeD1();
    const response = await handleRequest(
      postBody(entryV2Payload()),
      await environment(database, {
        RD_ENTRY_CANONICAL_PAPER_ENABLED: "true",
      }),
    );

    expect(response.status).toBe(202);
    expect(await body(response)).toMatchObject({
      canonical_paper_enabled: false,
      execution: "DISABLED",
    });
    expect(database.selections).toHaveLength(1);
    expect(database.selections[0]).toMatchObject({
      policy_action: "PAPER_ELIGIBLE",
      action: "SHADOW_ONLY",
      effective_action_reason: null,
    });
    expect(database.paperTradeIntents).toHaveLength(0);
  });

  it("persists one complete evaluation atomically without paper intents", async () => {
    const database = new FakeD1();
    const response = await handleRequest(
      postBody(entryV2Payload()),
      await environment(database),
    );

    expect(response.status).toBe(202);
    expect(await body(response)).toMatchObject({
      assembly: { status: "COMPLETE" },
      evaluation_count: 1,
      execution: "DISABLED",
    });
    expect(database.candidates.size).toBeGreaterThan(0);
    expect(database.selections).toHaveLength(1);
    expect(database.selections[0]?.action).toBe("SHADOW_ONLY");
    expect(database.paperTradeIntents).toHaveLength(0);
  });

  it("stores a producer mismatch separately and forces authoritative shadow", async () => {
    const database = new FakeD1();
    const value = entryV2Payload();
    addConfirmedEntryV2Diagnostic(value);
    const diagnostic = entryV2Setup(value);
    diagnostic.q = {
      ...(diagnostic.q as Record<string, unknown>),
      r: "FALLBACK_TO_CONFIRMED_CLOSE",
    };

    const response = await handleRequest(
      postBody(value),
      await environment(database),
    );

    expect(response.status).toBe(202);
    expect(database.producerDiagnostics).toHaveLength(1);
    expect(database.parity[0]).toMatchObject({
      parity_status: "MISMATCH",
      mismatch_reason: "REASON",
    });
    expect(database.selections[0]).toMatchObject({
      policy_action: "PAPER_ELIGIBLE",
      action: "SHADOW_ONLY",
    });
  });

  it("assembles two chunks out of order and preserves both receipt origins", async () => {
    const database = new FakeD1();
    const second = entryV2Payload();
    second.chunk_index = 1;
    second.chunk_count = 2;
    second.idempotency_key =
      "pine-v3-worker:1:incremental:1721808300:1";
    entryV2Setup(second).s = "worker-setup-b";
    const first = entryV2Payload();
    first.chunk_count = 2;
    entryV2Setup(first).s = "worker-setup-a";

    const incomplete = await handleRequest(
      postBody(second),
      await environment(database),
    );
    const complete = await handleRequest(
      postBody(first),
      await environment(database),
    );

    expect(await body(incomplete)).toMatchObject({
      assembly: {
        status: "INCOMPLETE",
        missing_chunk_indexes: [0],
      },
    });
    expect(await body(complete)).toMatchObject({
      assembly: {
        status: "COMPLETE",
        missing_chunk_indexes: [],
      },
      evaluation_count: 2,
    });
    const receiptByIdempotency = new Map(
      [...database.records.values()].map((item) => [
        item.idempotency_key,
        item.receipt_id,
      ]),
    );
    expect(
      [...database.setupEvents.values()]
        .sort((left, right) => left.setup_id.localeCompare(right.setup_id))
        .map((item) => [item.setup_id, item.receipt_id]),
    ).toEqual([
      [
        "worker-setup-a",
        receiptByIdempotency.get(String(first.idempotency_key)),
      ],
      [
        "worker-setup-b",
        receiptByIdempotency.get(String(second.idempotency_key)),
      ],
    ]);
    const candidateReceiptById = new Map(
      [...database.candidates.values()].map((item) => [
        item.candidate_id,
        {
          setupId: item.setup_id,
          receiptId: item.first_receipt_id,
        },
      ]),
    );
    expect(
      [...candidateReceiptById.values()].sort((left, right) =>
        left.setupId.localeCompare(right.setupId),
      ),
    ).toEqual([
      {
        setupId: "worker-setup-a",
        receiptId: receiptByIdempotency.get(String(first.idempotency_key)),
      },
      {
        setupId: "worker-setup-b",
        receiptId: receiptByIdempotency.get(String(second.idempotency_key)),
      },
    ]);
    for (const evidence of database.entryEvidence.values()) {
      expect(evidence.receipt_id).toBe(
        candidateReceiptById.get(evidence.candidate_id)?.receiptId,
      );
    }
    for (const handling of database.handling.values()) {
      expect(handling.receipt_id).toBe(
        candidateReceiptById.get(handling.candidate_id)?.receiptId,
      );
    }
  });

  it("normalizes compatible legacy and v3 heartbeats onto one schedule epoch", async () => {
    const database = new FakeD1();
    const env = await environment(database);
    const legacy = contractIncrementalPayload();
    const v3 = entryV2Payload();
    v3.producer_instance_id = "pine-v3-compatible-heartbeat";
    v3.idempotency_key =
      "pine-v3-compatible-heartbeat:1:incremental:1710000300:0";
    v3.bar_open_epoch = 1_710_000_000;
    v3.bar_close_epoch = 1_710_000_300;
    const setup = entryV2Setup(v3);
    setup.s = "compatible-heartbeat-setup";
    const facts = setup.f as Record<string, unknown>;
    facts.ge = 1_710_000_010;
    const bar = (facts.b as Record<string, unknown>[])[0]!;
    bar.oe = 1_710_000_000;
    bar.ce = 1_710_000_300;

    const legacyResponse = await handleRequest(postBody(legacy), env);
    const v3Response = await handleRequest(postBody(v3), env);

    expect(legacyResponse.status).toBe(202);
    expect(v3Response.status).toBe(202);
    expect(
      database.marketBarHeartbeats
        .map((item) => ({
          producer_role: item.producer_role,
          bar_open_epoch: item.bar_open_epoch,
          bar_close_epoch: item.bar_close_epoch,
        }))
        .sort((left, right) =>
          left.producer_role.localeCompare(right.producer_role),
        ),
    ).toEqual([
      {
        producer_role: "ENTRY_V3_CANARY",
        bar_open_epoch: 1_710_000_000,
        bar_close_epoch: 1_710_000_300,
      },
      {
        producer_role: "LEGACY_REFERENCE",
        bar_open_epoch: 1_710_000_000,
        bar_close_epoch: 1_710_000_300,
      },
    ]);
  });

  it("persists q null as not provided and keeps the effective action closed", async () => {
    const database = new FakeD1();
    const value = entryV2Payload();
    configureEntryV2Batch(value, {
      sequence: 1,
      closeEpoch: 1_721_808_300,
      setupId: "not-provided-setup",
      directionalClose: false,
    });

    const response = await handleRequest(
      postBody(value),
      await environment(database),
    );

    expect(response.status).toBe(202);
    expect(await body(response)).toMatchObject({
      parity: {
        matches: 0,
        mismatches: 0,
        not_provided: 1,
      },
      canonical_paper_enabled: false,
      execution: "DISABLED",
    });
    expect(database.parity[0]).toMatchObject({
      parity_status: "NOT_PROVIDED",
      mismatch_reason: null,
    });
    expect(database.selections[0]).toMatchObject({
      policy_action: "NONE",
      action: "NONE",
    });
  });

  it("recomputes a prior flip plus later close as selection revision two", async () => {
    const database = new FakeD1();
    const env = await environment(database);
    const flip = entryV2Payload();
    configureEntryV2Batch(flip, {
      sequence: 1,
      closeEpoch: 1_721_808_300,
      setupId: "stored-stream-setup",
      directionalClose: false,
    });
    const flipFacts = entryV2Setup(flip).f as Record<string, unknown>;
    flipFacts.x = [currentMatchedEntryTranscript(1_721_808_300)];

    const close = entryV2Payload();
    configureEntryV2Batch(close, {
      sequence: 2,
      kind: "snapshot",
      closeEpoch: 1_721_808_600,
      setupId: "stored-stream-setup",
    });
    const closeFacts = entryV2Setup(close).f as Record<string, unknown>;
    closeFacts.tr = "BOTH_ACTIVE_MODELS_OBSERVED";
    closeFacts.te = 1_721_808_600;
    closeFacts.ng = {
      oe: 1_721_808_600,
      ce: 1_721_808_900,
      o: 103,
      h: 104,
      l: 98,
      c: 102,
      ak: "INITIAL",
    };

    const first = await handleRequest(postBody(flip), env);
    const second = await handleRequest(postBody(close), env);

    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    expect(
      database.selections
        .map((item) => ({
          revision: item.revision,
          canonical_model: item.canonical_model,
        }))
        .sort((left, right) => left.revision - right.revision),
    ).toEqual([
      { revision: 1, canonical_model: "HTF_FLIP" },
      { revision: 2, canonical_model: "HTF_FLIP" },
    ]);
    expect(
      [...database.candidates.values()]
        .map((item) => item.model)
        .sort(),
    ).toEqual(["DIR_CLOSE", "HTF_FLIP"]);
    expect(database.terminals.get("stored-stream-setup")).toMatchObject({
      terminal_reason: "BOTH_ACTIVE_MODELS_OBSERVED",
      terminal_epoch: 1_721_808_600,
    });
    expect(database.setupEvents).toHaveLength(3);
    expect(database.parity.at(-1)).toMatchObject({
      parity_status: "MISMATCH",
      mismatch_reason: "MULTIPLE",
    });
    expect(database.selections.at(-1)?.action).toBe("SHADOW_ONLY");
    expect(
      [...database.handling.values()].some(
        (item) =>
          item.handling_mode === "NEXT_CANDLE_WICK" &&
          item.observed_epoch === 1_721_808_900,
      ),
    ).toBe(true);
  });

  it("quarantines a first-live snapshot whose retained context is absent", async () => {
    const database = new FakeD1();
    const value = entryV2Payload();
    configureEntryV2Batch(value, {
      sequence: 1,
      kind: "snapshot",
      closeEpoch: 1_721_808_300,
      setupId: "missing-context-setup",
    });
    const facts = entryV2Setup(value).f as Record<string, unknown>;
    facts.b = [
      {
        oe: 1_721_807_700,
        ce: 1_721_808_000,
        o: 98,
        h: 102,
        l: 96,
        c: 99,
        gb: false,
        rr: false,
      },
      ...(facts.b as Record<string, unknown>[]),
    ];

    const response = await handleRequest(
      postBody(value),
      await environment(database),
    );

    expect(response.status).toBe(409);
    expect(await body(response)).toMatchObject({
      error: { code: "EVENT_STREAM_CONTEXT_MISSING" },
      execution: "DISABLED",
    });
    expect(database.quarantine.size).toBe(1);
    expect([...database.quarantine.values()][0]).toMatchObject({
      receipt_id: null,
      reason: "EVENT_STREAM_CONTEXT_MISSING",
    });
    expect(database.records).toHaveLength(0);
    expect(database.setupEvents).toHaveLength(0);
  });

  it("persists explicit invalidation and retention terminal facts from the stored stream", async () => {
    const beforeDatabase = new FakeD1();
    const before = entryV2Payload();
    configureEntryV2Batch(before, {
      sequence: 1,
      closeEpoch: 1_721_808_300,
      setupId: "invalid-before-entry",
      directionalClose: false,
    });
    const beforeFacts = entryV2Setup(before).f as Record<string, unknown>;
    beforeFacts.iv = true;
    beforeFacts.tr = "INVALIDATED";
    beforeFacts.te = 1_721_808_300;
    const beforeEnv = await environment(beforeDatabase);

    const beforeResponse = await handleRequest(
      postBody(before),
      beforeEnv,
    );

    expect(beforeResponse.status).toBe(202);
    expect(beforeDatabase.terminals.get("invalid-before-entry")).toMatchObject({
      terminal_reason: "INVALIDATED",
      terminal_epoch: 1_721_808_300,
    });
    expect(
      JSON.parse(
        [...beforeDatabase.setupEvents.values()][0]?.proof_input_json ?? "{}",
      ),
    ).toMatchObject({
      setup: { invalidated_before_entry: true },
    });
    const terminalMutation = entryV2Payload();
    configureEntryV2Batch(terminalMutation, {
      sequence: 2,
      closeEpoch: 1_721_808_600,
      setupId: "invalid-before-entry",
      directionalClose: false,
    });
    const mutationResponse = await handleRequest(
      postBody(terminalMutation),
      beforeEnv,
    );
    expect(mutationResponse.status).toBe(409);
    expect(await body(mutationResponse)).toMatchObject({
      error: { code: "TERMINAL_FACT_CONFLICT" },
    });
    expect(beforeDatabase.terminals).toHaveLength(1);

    const afterDatabase = new FakeD1();
    const afterEnv = await environment(afterDatabase);
    const active = entryV2Payload();
    configureEntryV2Batch(active, {
      sequence: 1,
      closeEpoch: 1_721_808_300,
      setupId: "invalid-after-entry",
    });
    const invalidated = entryV2Payload();
    configureEntryV2Batch(invalidated, {
      sequence: 2,
      closeEpoch: 1_721_808_600,
      setupId: "invalid-after-entry",
      directionalClose: false,
    });
    const invalidatedFacts = entryV2Setup(invalidated).f as Record<
      string,
      unknown
    >;
    invalidatedFacts.iv = false;
    invalidatedFacts.tr = "INVALIDATED";
    invalidatedFacts.te = 1_721_808_600;

    expect((await handleRequest(postBody(active), afterEnv)).status).toBe(202);
    expect(
      (await handleRequest(postBody(invalidated), afterEnv)).status,
    ).toBe(202);
    expect(afterDatabase.terminals.get("invalid-after-entry")).toMatchObject({
      terminal_reason: "INVALIDATED",
      terminal_epoch: 1_721_808_600,
    });
    expect(
      [...afterDatabase.candidates.values()].map((item) => item.model),
    ).toEqual(["DIR_CLOSE"]);

    const retentionDatabase = new FakeD1();
    const retention = entryV2Payload();
    configureEntryV2Batch(retention, {
      sequence: 1,
      closeEpoch: 1_721_808_300,
      setupId: "retention-evicted",
      directionalClose: false,
    });
    const retentionFacts = entryV2Setup(retention).f as Record<
      string,
      unknown
    >;
    retentionFacts.tr = "RETENTION_EVICTED";
    retentionFacts.te = 1_721_808_300;

    expect(
      (
        await handleRequest(
          postBody(retention),
          await environment(retentionDatabase),
        )
      ).status,
    ).toBe(202);
    expect(retentionDatabase.terminals.get("retention-evicted")).toMatchObject({
      terminal_reason: "RETENTION_EVICTED",
    });
  });

  it("quarantines a BOTH terminal until both stored active models exist", async () => {
    const database = new FakeD1();
    const value = entryV2Payload();
    configureEntryV2Batch(value, {
      sequence: 1,
      closeEpoch: 1_721_808_300,
      setupId: "invalid-both-terminal",
    });
    const facts = entryV2Setup(value).f as Record<string, unknown>;
    facts.tr = "BOTH_ACTIVE_MODELS_OBSERVED";
    facts.te = 1_721_808_300;

    const response = await handleRequest(
      postBody(value),
      await environment(database),
    );

    expect(response.status).toBe(409);
    expect(await body(response)).toMatchObject({
      error: { code: "TERMINAL_FACT_CONFLICT" },
      execution: "DISABLED",
    });
    expect(database.terminals).toHaveLength(0);
    expect(database.selections).toHaveLength(0);
    expect(database.quarantine.size).toBe(1);
  });

  it("retries one complete selection revision race without partial persistence", async () => {
    const database = new FakeD1(false, true);
    const response = await handleRequest(
      postBody(entryV2Payload()),
      await environment(database),
    );

    expect(response.status).toBe(202);
    expect(await body(response)).toMatchObject({
      assembly: { status: "COMPLETE" },
      evaluation_count: 1,
      execution: "DISABLED",
    });
    expect(database.records).toHaveLength(1);
    expect(database.chunks).toHaveLength(1);
    expect(database.setupEvents).toHaveLength(1);
    expect(database.selections).toHaveLength(1);
    expect(database.parity).toHaveLength(1);
    expect(database.completions).toHaveLength(1);
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
    const secrets = config.secrets as { readonly required: readonly string[] };
    const secretNames = [
      "TRADINGVIEW_OBSERVATION_CREDENTIAL_SHA256",
      "PAPER_LEDGER_ADMIN_CREDENTIAL_SHA256",
      "RD_ENTRY_V3_DETECTOR_CODE_HASH",
      "RD_ENTRY_V3_SETTINGS_HASH",
      "RD_ENTRY_V3_SETTINGS_HASHES_JSON",
    ];

    expect(config.compatibility_date).toBe("2026-07-23");
    expect(config.workers_dev).toBe(true);
    expect(config.preview_urls).toBe(false);
    expect(assets.directory).toBe("../operations-console/out");
    expect(assets.run_worker_first).toEqual(["/api/*", "/health/*"]);
    expect(databases[0]?.binding).toBe("DB");
    for (const name of secretNames) {
      expect(variables).not.toHaveProperty(name);
    }
    expect(secrets.required).toEqual(expect.arrayContaining(secretNames));
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

  it("enforces producer chronology and code identity inside the batch insert", () => {
    const root = fileURLToPath(new URL("..", import.meta.url));
    const database = new DatabaseSync(":memory:");
    database.exec("PRAGMA foreign_keys = ON");
    applyObservationMigrationsThrough(database, root, 23);
    for (const sequence of [1, 2, 3]) {
      insertEntryStorageReceipt(database, {
        receiptId: `receipt-batch-guard-${sequence}`,
        schemaVersion: "2.0",
        strategyVersion: "2.0.0-contract2",
        producerInstanceId: "batch-guard-producer",
        sequence,
      });
    }
    const insertBatch = (
      batchId: string,
      sequence: number,
      closeEpoch: number,
      detectorCodeHash = "3".repeat(64),
    ): void => {
      database
        .prepare(
          `INSERT INTO observation_entry_batches (
            batch_id, producer_instance_id, producer_sequence, kind,
            bar_close_epoch, strategy_id, strategy_version,
            rule_contract_version, execution_mode, symbol, ticker_id, feed,
            timeframe, tick_size, bar_open_epoch, detector_code_hash,
            settings_hash, chunk_count, first_receipt_id, first_seen_at
          ) VALUES (
            ?, 'batch-guard-producer', ?, 'snapshot', ?,
            'rd_liquidity_sd_5m_v1', '2.0.0-contract2', '2.0.0',
            'OBSERVATION_ONLY', 'EURUSD', 'VANTAGE:EURUSD', 'VANTAGE',
            '5', '0.00001', ?, ?, ?, 1, ?,
            '2026-07-28T06:00:00Z'
          )`,
        )
        .run(
          batchId,
          sequence,
          closeEpoch,
          closeEpoch - 300,
          detectorCodeHash,
          "4".repeat(64),
          `receipt-batch-guard-${sequence}`,
        );
    };

    insertBatch("1".repeat(64), 2, 1_721_808_600);
    expect(() =>
      insertBatch("2".repeat(64), 1, 1_721_808_900),
    ).toThrow(/observation_entry_batches sequence time conflict/u);
    expect(() =>
      insertBatch(
        "3".repeat(64),
        3,
        1_721_808_900,
        "5".repeat(64),
      ),
    ).toThrow(/observation_entry_batches producer identity conflict/u);
    expect(
      database
        .prepare(
          `SELECT producer_sequence, bar_close_epoch
           FROM observation_entry_batches`,
        )
        .all(),
    ).toEqual([
      { producer_sequence: 2, bar_close_epoch: 1_721_808_600 },
    ]);
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

  it("allows fail-closed shadow while restricting promotion mismatch", () => {
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
    ).not.toThrow();
    expect(() =>
      insertSelection(
        "6".repeat(64),
        5,
        "OBSERVE",
        "SHADOW_ONLY",
        null,
      ),
    ).not.toThrow();
    expect(() =>
      insertSelection(
        "7".repeat(64),
        6,
        "OBSERVE",
        "SHADOW_ONLY",
        "PROMOTION_IDENTITY_MISMATCH",
      ),
    ).toThrow(/CHECK constraint failed/u);
    expect(() =>
      insertSelection(
        "7".repeat(64),
        6,
        "PAPER_ELIGIBLE",
        "PAPER_ELIGIBLE",
        "PROMOTION_IDENTITY_MISMATCH",
      ),
    ).toThrow(/CHECK constraint failed/u);
    expect(() =>
      insertSelection("7".repeat(64), 6, "PAPER_ELIGIBLE", "EXECUTE", null),
    ).toThrow(/CHECK constraint failed/u);
    expect(() =>
      insertSelection("7".repeat(64), 6, "OBSERVE", "OBSERVE", null, "LEGACY_BREAK_CANDLE"),
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
      {
        policy_action: "PAPER_ELIGIBLE",
        action: "SHADOW_ONLY",
        effective_action_reason: null,
      },
      {
        policy_action: "OBSERVE",
        action: "SHADOW_ONLY",
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

  it("upgrades populated receipts for contract v3 without detaching v2 children", () => {
    const root = fileURLToPath(new URL("..", import.meta.url));
    const database = new DatabaseSync(":memory:");
    database.exec("PRAGMA foreign_keys = ON");
    applyObservationMigrationsThrough(database, root, 23);
    insertEntryStorageReceipt(database, {
      receiptId: "receipt-before-v3",
      schemaVersion: "2.0",
      strategyVersion: "2.0.0-contract2",
      producerInstanceId: "before-v3",
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
          ?, 'before-v3', 1, 'snapshot', 1721808300,
          'rd_liquidity_sd_5m_v1', '2.0.0-contract2', '2.0.0',
          'OBSERVATION_ONLY', 'EURUSD', 'VANTAGE:EURUSD', 'VANTAGE', '5',
          '0.00001', 1721808000, ?, ?, 1, 'receipt-before-v3',
          '2026-07-28T00:00:00Z'
        )`,
      )
      .run("1".repeat(64), "2".repeat(64), "3".repeat(64));
    database.exec("BEGIN");
    database.exec(
      readFileSync(
        `${root}/migrations/0024_observation_entries_v3.sql`,
        "utf8",
      ),
    );
    database.exec("COMMIT");

    database
      .prepare(
        `INSERT INTO observation_receipts (
          receipt_id, received_at, idempotency_key, payload_sha256,
          schema_version, strategy_id, strategy_version, producer_instance_id,
          sequence, symbol, ticker_id, feed, timeframe, kind
        ) VALUES (
          'receipt-v3', '2026-07-28T00:00:00Z', 'event-v3', ?,
          '3.0', 'rd_liquidity_sd_5m_v1', '3.0.0-contract3', 'producer-v3',
          1, 'EURUSD', 'OANDA:EURUSD', 'OANDA', '5', 'incremental'
        )`,
      )
      .run("a".repeat(64));
    insertEntryStorageReceipt(database, {
      receiptId: "receipt-after-v3-v2",
      schemaVersion: "2.0",
      strategyVersion: "2.0.0-contract2",
      producerInstanceId: "after-v3-v2",
      sequence: 2,
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
          ?, 'after-v3-v2', 2, 'snapshot', 1721808600,
          'rd_liquidity_sd_5m_v1', '2.0.0-contract2', '2.0.0',
          'OBSERVATION_ONLY', 'EURUSD', 'VANTAGE:EURUSD', 'VANTAGE', '5',
          '0.00001', 1721808300, ?, ?, 1, 'receipt-after-v3-v2',
          '2026-07-28T00:05:00Z'
        )`,
      )
      .run("4".repeat(64), "5".repeat(64), "6".repeat(64));

    expect(
      database
        .prepare(
          "SELECT receipt_id FROM observation_receipts ORDER BY receipt_id",
        )
        .all(),
    ).toEqual([
      { receipt_id: "receipt-after-v3-v2" },
      { receipt_id: "receipt-before-v3" },
      { receipt_id: "receipt-v3" },
    ]);
    expect(
      database
        .prepare(
          `SELECT receipt_id
           FROM observation_receipts_contract_v2_archive
           ORDER BY receipt_id`,
        )
        .all(),
    ).toEqual([
      { receipt_id: "receipt-after-v3-v2" },
      { receipt_id: "receipt-before-v3" },
    ]);
    expect(
      database
        .prepare(
          `SELECT batch_id, first_receipt_id
           FROM observation_entry_batches
           ORDER BY batch_id`,
        )
        .all(),
    ).toEqual([
      {
        batch_id: "1".repeat(64),
        first_receipt_id: "receipt-before-v3",
      },
      {
        batch_id: "4".repeat(64),
        first_receipt_id: "receipt-after-v3-v2",
      },
    ]);
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
});
