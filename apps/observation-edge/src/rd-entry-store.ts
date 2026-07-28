import { evaluateEntryStream } from "./rd-entry-arbitrator";
import {
  canonicalStringifyRdEntry,
  type EntryEvaluation,
  type EntryMatchRequest,
} from "./rd-entry-domain";
import {
  compareProducerDiagnostic,
  effectiveSelection,
  type EffectiveEntrySelection,
  type ParityMismatchReason,
  type ParityStatus,
} from "./rd-entry-parity";
import { canonicalSha256 } from "./rd-entry-policy";
import {
  INSERT_ENTRY_BATCH_SQL,
  INSERT_ENTRY_CANDIDATES_SQL,
  INSERT_ENTRY_CHUNK_SQL,
  INSERT_ENTRY_COMPLETION_SQL,
  INSERT_ENTRY_EVALUATION_MEMBERS_SQL,
  INSERT_ENTRY_EVIDENCE_SQL,
  INSERT_ENTRY_HANDLING_SQL,
  INSERT_ENTRY_PARITY_SQL,
  INSERT_ENTRY_QUARANTINE_SQL,
  INSERT_ENTRY_SELECTION_SQL,
  INSERT_ENTRY_SETUP_EVENT_SQL,
  INSERT_ENTRY_SOURCE_CLAIM_SQL,
  INSERT_ENTRY_SOURCE_RELATIONSHIP_SQL,
  INSERT_ENTRY_TERMINAL_SQL,
  INSERT_MARKET_BAR_HEARTBEAT_SQL,
  INSERT_PRODUCER_DIAGNOSTIC_SQL,
  LIST_ENTRY_CHUNKS_SQL,
  SELECT_ENTRY_BATCH_BY_CLOSE_SQL,
  SELECT_ENTRY_BATCH_BY_SEQUENCE_SQL,
  SELECT_ENTRY_BATCH_SQL,
  SELECT_ENTRY_COMPLETION_SQL,
  SELECT_ENTRY_IDENTITIES_SQL,
  SELECT_ENTRY_SEQUENCE_NEIGHBORS_SQL,
  SELECT_ENTRY_SETUP_EVENTS_SQL,
  SELECT_ENTRY_TERMINAL_SQL,
} from "./rd-entry-queries";
import { SOURCE_CLAIM_CATALOG } from "./rd-entry-source-catalog";
import {
  MAX_ENTRY_SETUPS_PER_BATCH,
  type EntryBatchImmutableMetadata,
  type EntryBatchSemanticIdentity,
  type ProducerDiagnosticSelection,
  type ValidatedEntryWireBatch,
} from "./rd-entry-wire";
import {
  INSERT_RECEIPT_SQL,
  SELECT_RECEIPT_SQL,
} from "./queries";
import { RD_ENTRY_PROMOTION_BINDING } from "./generated/rd-entry-promotion-binding";
import type {
  Env,
  StoredEntrySetupEvent,
  StoredEntrySetupTerminal,
  StoredReceipt,
  ValidatedObservation,
} from "./types";

export type EntryStoreConflictCode =
  | "INCONSISTENT_CHUNK_COUNT"
  | "INCONSISTENT_BATCH_METADATA"
  | "DUPLICATE_SETUP_ACROSS_CHUNKS"
  | "BATCH_SETUP_LIMIT"
  | "IMMUTABLE_ID_CONFLICT"
  | "EVENT_STREAM_CONTEXT_MISSING"
  | "EVENT_STREAM_CONFLICT"
  | "TERMINAL_FACT_CONFLICT";

export class EntryStoreConflict extends Error {
  quarantineId: string | null = null;

  constructor(readonly code: EntryStoreConflictCode) {
    super(code);
    this.name = "EntryStoreConflict";
  }
}

export interface StoredValidatedChunk {
  readonly batchId: string;
  readonly batchIdentity: EntryBatchSemanticIdentity;
  readonly batchMetadata: EntryBatchImmutableMetadata;
  readonly chunkIndex: number;
  readonly chunkCount: number;
  readonly payloadSha256: string;
  readonly receiptId: string;
  readonly entryBatches: readonly ValidatedEntryWireBatch[];
}

export interface AssembledValidatedSetup extends ValidatedEntryWireBatch {
  readonly origin: {
    readonly receiptId: string;
    readonly chunkIndex: number;
  };
}

export type ChunkAssembly =
  | {
      readonly status: "INCOMPLETE";
      readonly missingIndexes: readonly number[];
      readonly setups: readonly [];
    }
  | {
      readonly status: "COMPLETE";
      readonly missingIndexes: readonly [];
      readonly setups: readonly AssembledValidatedSetup[];
      readonly assembledPayloadSha256: string;
    };

export async function assembleValidatedChunks(
  chunks: readonly StoredValidatedChunk[],
): Promise<ChunkAssembly> {
  const ordered = [...chunks].sort(
    (left, right) => left.chunkIndex - right.chunkIndex,
  );
  const first = ordered[0];
  const count = first?.chunkCount ?? 0;
  if (
    count < 1 ||
    ordered.some((item) => item.chunkCount !== count)
  ) {
    throw new EntryStoreConflict("INCONSISTENT_CHUNK_COUNT");
  }
  if (
    first === undefined ||
    ordered.some(
      (item) =>
        item.batchId !== first.batchId ||
        canonicalStringifyRdEntry(item.batchIdentity) !==
          canonicalStringifyRdEntry(first.batchIdentity) ||
        canonicalStringifyRdEntry(item.batchMetadata) !==
          canonicalStringifyRdEntry(first.batchMetadata),
    )
  ) {
    throw new EntryStoreConflict("INCONSISTENT_BATCH_METADATA");
  }
  const byIndex = new Map(ordered.map((item) => [item.chunkIndex, item]));
  const missingIndexes = Array.from(
    { length: count },
    (_value, index) => index,
  ).filter((index) => !byIndex.has(index));
  if (missingIndexes.length > 0) {
    return { status: "INCOMPLETE", missingIndexes, setups: [] };
  }
  const setups = ordered.flatMap((item) =>
    item.entryBatches.map((setup) => ({
      ...setup,
      origin: {
        receiptId: item.receiptId,
        chunkIndex: item.chunkIndex,
      },
    })),
  );
  if (setups.length > MAX_ENTRY_SETUPS_PER_BATCH) {
    throw new EntryStoreConflict("BATCH_SETUP_LIMIT");
  }
  const setupIds = setups.map((item) => item.setupId);
  if (new Set(setupIds).size !== setupIds.length) {
    throw new EntryStoreConflict("DUPLICATE_SETUP_ACROSS_CHUNKS");
  }
  const assembledPayloadSha256 = await canonicalSha256(
    ordered.map((item) => ({
      chunk_index: item.chunkIndex,
      payload_sha256: item.payloadSha256,
    })),
  );
  return {
    status: "COMPLETE",
    missingIndexes: [],
    setups,
    assembledPayloadSha256,
  };
}

const SHA256 = /^[0-9a-f]{64}$/u;
const GIT_COMMIT = /^[0-9a-f]{40}$/u;
const SELECT_ENTRY_REVISION_SQL = `
SELECT COALESCE(MAX(revision), 0) AS max_revision
FROM observation_entry_selections
WHERE setup_id = ?
`;
const SELECT_ENTRY_QUARANTINE_SQL = `
SELECT quarantine_id, reason
FROM observation_entry_quarantine
WHERE quarantine_id = ?
LIMIT 1
`;
const SELECT_ENTRY_SOURCE_CLAIM_SQL = `
SELECT claim_id, contract_version, source_id, youtube_video_id, published_date,
  title_snapshot, channel_id, channel_handle, timestamp_start_seconds,
  timestamp_end_seconds, relationship, summary
FROM observation_entry_source_claims
WHERE claim_id = ?
LIMIT 1
`;
const SELECT_ENTRY_SOURCE_RELATIONSHIP_SQL = `
SELECT claim_id, target_claim_id
FROM observation_entry_source_claim_relationships
WHERE claim_id = ?
LIMIT 1
`;

interface StoredEntryBatchRow {
  readonly batch_id: string;
  readonly producer_instance_id: string;
  readonly producer_sequence: number;
  readonly kind: "snapshot" | "incremental";
  readonly bar_close_epoch: number;
  readonly strategy_id: "rd_liquidity_sd_5m_v1";
  readonly strategy_version: "2.0.0-contract2";
  readonly rule_contract_version: "2.0.0";
  readonly execution_mode: "OBSERVATION_ONLY";
  readonly symbol: string;
  readonly ticker_id: string;
  readonly feed: string;
  readonly timeframe: "5";
  readonly tick_size: string;
  readonly bar_open_epoch: number;
  readonly detector_code_hash: string;
  readonly settings_hash: string;
  readonly chunk_count: number;
  readonly first_receipt_id: string;
  readonly first_seen_at: string;
}

interface StoredEntryChunkRow {
  readonly batch_id: string;
  readonly chunk_index: number;
  readonly chunk_count: number;
  readonly receipt_id: string;
  readonly payload_sha256: string;
  readonly validated_payload_json: string;
  readonly recorded_at: string;
}

interface StoredEntryCompletionRow {
  readonly completion_id: string;
  readonly batch_id: string;
  readonly assembled_payload_sha256: string;
  readonly completed_at: string;
}

interface StoredIdentityRow {
  readonly object_kind: "candidate" | "evidence" | "handling";
  readonly object_id: string;
  readonly identity_sha256: string;
}

interface StoredSourceClaimRow {
  readonly claim_id: string;
  readonly contract_version: "2.0.0";
  readonly source_id: string;
  readonly youtube_video_id: string;
  readonly published_date: string;
  readonly title_snapshot: string;
  readonly channel_id: string;
  readonly channel_handle: string;
  readonly timestamp_start_seconds: number;
  readonly timestamp_end_seconds: number;
  readonly relationship: string;
  readonly summary: string;
}

interface StreamEvent {
  readonly eventId: string;
  readonly input: EntryMatchRequest;
  readonly proofInputSha256: string;
  readonly receiptId: string;
  readonly batchId: string;
  readonly chunkIndex: number;
  readonly isNew: boolean;
}

interface PreparedEvaluation {
  readonly entry: AssembledValidatedSetup;
  readonly backend: EntryEvaluation;
  readonly parityStatus: ParityStatus;
  readonly parityMismatchReason: ParityMismatchReason | null;
  readonly producerDiagnosticSelection: ProducerDiagnosticSelection | null;
  readonly selection: EffectiveEntrySelection;
  readonly diagnosticId: string;
  readonly parityId: string;
  readonly stream: readonly StreamEvent[];
  readonly newEvents: readonly StreamEvent[];
  readonly terminal: {
    readonly reason: NonNullable<
      EntryMatchRequest["setup"]["terminal_reason"]
    >;
    readonly epoch: number;
    readonly batchId: string;
    readonly receiptId: string;
  } | null;
}

export type EntryAppendResult =
  | {
      readonly status: "ACCEPTED";
      readonly record: StoredReceipt;
      readonly inserted: boolean;
      readonly assemblyStatus: "INCOMPLETE" | "COMPLETE";
      readonly batchId: string;
      readonly missingChunkIndexes: readonly number[];
      readonly evaluations: readonly {
        readonly producerDiagnosticSelection:
          ProducerDiagnosticSelection | null;
        readonly selection: EffectiveEntrySelection;
        readonly parityStatus: ParityStatus;
        readonly parityMismatchReason: ParityMismatchReason | null;
      }[];
    }
  | {
      readonly status: "CONFLICT";
      readonly conflictCode:
        | "SEQUENCE_CONFLICT"
        | "BAR_CLOSE_CONFLICT"
        | "SEQUENCE_TIME_CONFLICT"
        | "PRODUCER_IDENTITY_CONFLICT";
      readonly quarantineId: string;
      readonly batchId: string;
      readonly record: null;
    };

export class EntryStoreIdempotencyConflict extends Error {
  constructor() {
    super("IDEMPOTENCY_CONFLICT");
    this.name = "EntryStoreIdempotencyConflict";
  }
}

export interface EntryCodeIdentity {
  readonly rule_contract_version: string;
  readonly strategy_version: string;
  readonly detector_code_hash: string;
  readonly settings_hash: string;
}

function promotionBindingIsWellFormed(): boolean {
  const value = RD_ENTRY_PROMOTION_BINDING;
  return (
    value !== null &&
    SHA256.test(value.report_sha256) &&
    GIT_COMMIT.test(value.source_commit) &&
    SHA256.test(value.pine_artifact_sha256) &&
    value.rule_contract_version.length > 0 &&
    value.producer_strategy_version.length > 0 &&
    SHA256.test(value.detector_code_hash) &&
    SHA256.test(value.settings_hash) &&
    SHA256.test(value.build_metadata_digest)
  );
}

export function promotionDeploymentArmed(env: Env): boolean {
  const approved = RD_ENTRY_PROMOTION_BINDING;
  return (
    promotionBindingIsWellFormed() &&
    approved !== null &&
    env.RD_ENTRY_CANONICAL_PAPER_ENABLED === "true" &&
    env.RD_ENTRY_PROMOTION_REPORT_SHA256 === approved.report_sha256 &&
    env.RD_ENTRY_PROMOTION_SOURCE_COMMIT === approved.source_commit &&
    env.RD_ENTRY_PROMOTION_PINE_SHA256 === approved.pine_artifact_sha256 &&
    env.CF_VERSION_METADATA?.tag === approved.build_metadata_digest
  );
}

export function promotionCodeIdentityMatches(
  identity: EntryCodeIdentity,
): boolean {
  const approved = RD_ENTRY_PROMOTION_BINDING;
  return (
    approved !== null &&
    identity.rule_contract_version === approved.rule_contract_version &&
    identity.strategy_version === approved.producer_strategy_version &&
    identity.detector_code_hash === approved.detector_code_hash &&
    identity.settings_hash === approved.settings_hash
  );
}

export function canonicalPaperSelectionConfigured(
  env: Env,
  identity: EntryCodeIdentity,
): boolean {
  return (
    promotionDeploymentArmed(env) &&
    promotionCodeIdentityMatches(identity)
  );
}

function batchIdentityFromRow(
  row: StoredEntryBatchRow,
): EntryBatchSemanticIdentity {
  return {
    producer_instance_id: row.producer_instance_id,
    sequence: row.producer_sequence,
    kind: row.kind,
    bar_close_epoch: row.bar_close_epoch,
  };
}

function batchMetadataFromRow(
  row: StoredEntryBatchRow,
): EntryBatchImmutableMetadata {
  return {
    strategy_id: row.strategy_id,
    strategy_version: row.strategy_version,
    rule_contract_version: row.rule_contract_version,
    execution_mode: row.execution_mode,
    symbol: row.symbol,
    ticker_id: row.ticker_id,
    feed: row.feed,
    timeframe: row.timeframe,
    tick_size: row.tick_size,
    bar_open_epoch: row.bar_open_epoch,
    detector_code_hash: row.detector_code_hash,
    settings_hash: row.settings_hash,
  };
}

function sameBatchIdentity(
  row: StoredEntryBatchRow,
  identity: EntryBatchSemanticIdentity,
  batchId: string,
): boolean {
  return (
    row.batch_id === batchId &&
    canonicalStringifyRdEntry(batchIdentityFromRow(row)) ===
      canonicalStringifyRdEntry(identity)
  );
}

function sameBatchMetadata(
  row: StoredEntryBatchRow,
  metadata: EntryBatchImmutableMetadata,
): boolean {
  return (
    canonicalStringifyRdEntry(batchMetadataFromRow(row)) ===
      canonicalStringifyRdEntry(metadata)
  );
}

function sameProducerIdentity(
  row: Pick<
    StoredEntryBatchRow,
    | "strategy_id"
    | "strategy_version"
    | "rule_contract_version"
    | "symbol"
    | "ticker_id"
    | "feed"
    | "timeframe"
    | "tick_size"
    | "detector_code_hash"
    | "settings_hash"
  >,
  metadata: EntryBatchImmutableMetadata,
): boolean {
  return (
    row.strategy_id === metadata.strategy_id &&
    row.strategy_version === metadata.strategy_version &&
    row.rule_contract_version === metadata.rule_contract_version &&
    row.symbol === metadata.symbol &&
    row.ticker_id === metadata.ticker_id &&
    row.feed === metadata.feed &&
    row.timeframe === metadata.timeframe &&
    row.tick_size === metadata.tick_size &&
    row.detector_code_hash === metadata.detector_code_hash &&
    row.settings_hash === metadata.settings_hash
  );
}

async function recordContinuityConflict(
  env: Env,
  observation: Extract<ValidatedObservation, { version: "entry-v2" }>,
  batchId: string,
  conflictCode: Extract<
    EntryAppendResult,
    { status: "CONFLICT" }
  >["conflictCode"],
  existing: StoredEntryBatchRow | null,
  quarantinedAt: string,
): Promise<Extract<EntryAppendResult, { status: "CONFLICT" }>> {
  const presentedSha256 = await canonicalSha256({
    batch_identity: observation.batchIdentity,
    batch_metadata: observation.batchMetadata,
    chunk_count: observation.chunkCount,
  });
  const existingSha256 =
    existing === null
      ? null
      : await canonicalSha256({
          batch_identity: batchIdentityFromRow(existing),
          batch_metadata: batchMetadataFromRow(existing),
          chunk_count: existing.chunk_count,
        });
  const quarantineId = await canonicalSha256({
    batch_id: batchId,
    conflict_code: conflictCode,
    existing_sha256: existingSha256,
    presented_sha256: presentedSha256,
  });
  const previous = await env.DB
    .prepare(SELECT_ENTRY_QUARANTINE_SQL)
    .bind(quarantineId)
    .first<{ readonly quarantine_id: string }>();
  if (previous === null) {
    try {
      await env.DB
        .prepare(INSERT_ENTRY_QUARANTINE_SQL)
        .bind(
          quarantineId,
          null,
          batchId,
          observation.batchIdentity.producer_instance_id,
          observation.batchIdentity.sequence,
          observation.batchIdentity.bar_close_epoch,
          "BATCH",
          batchId,
          existingSha256,
          presentedSha256,
          conflictCode,
          quarantinedAt,
        )
        .run();
    } catch {
      const raced = await env.DB
        .prepare(SELECT_ENTRY_QUARANTINE_SQL)
        .bind(quarantineId)
        .first<{ readonly quarantine_id: string }>();
      if (raced === null) throw new Error("entry quarantine unavailable");
    }
  }
  return {
    status: "CONFLICT",
    conflictCode,
    quarantineId,
    batchId,
    record: null,
  };
}

function insertReceiptStatement(
  env: Env,
  receiptId: string,
  receivedAt: string,
  observation: Extract<ValidatedObservation, { version: "entry-v2" }>,
  payloadSha256: string,
): D1PreparedStatement {
  const metadata = observation.metadata;
  return env.DB
    .prepare(INSERT_RECEIPT_SQL)
    .bind(
      receiptId,
      receivedAt,
      metadata.idempotencyKey,
      payloadSha256,
      metadata.schemaVersion,
      metadata.strategyId,
      metadata.strategyVersion,
      metadata.producerInstanceId,
      metadata.sequence,
      metadata.symbol,
      metadata.tickerId,
      metadata.feed,
      metadata.timeframe,
      metadata.kind,
    );
}

function insertBatchStatement(
  env: Env,
  batchId: string,
  receiptId: string,
  receivedAt: string,
  observation: Extract<ValidatedObservation, { version: "entry-v2" }>,
): D1PreparedStatement {
  const identity = observation.batchIdentity;
  const metadata = observation.batchMetadata;
  return env.DB
    .prepare(INSERT_ENTRY_BATCH_SQL)
    .bind(
      batchId,
      identity.producer_instance_id,
      identity.sequence,
      identity.kind,
      identity.bar_close_epoch,
      metadata.strategy_id,
      metadata.strategy_version,
      metadata.rule_contract_version,
      metadata.execution_mode,
      metadata.symbol,
      metadata.ticker_id,
      metadata.feed,
      metadata.timeframe,
      metadata.tick_size,
      metadata.bar_open_epoch,
      metadata.detector_code_hash,
      metadata.settings_hash,
      observation.chunkCount,
      receiptId,
      receivedAt,
    );
}

function insertHeartbeatStatement(
  env: Env,
  batchId: string,
  receiptId: string,
  receivedAt: string,
  observation: Extract<ValidatedObservation, { version: "entry-v2" }>,
): D1PreparedStatement {
  const identity = observation.batchIdentity;
  const metadata = observation.batchMetadata;
  return env.DB
    .prepare(INSERT_MARKET_BAR_HEARTBEAT_SQL)
    .bind(
      receiptId,
      batchId,
      "2.0",
      "ENTRY_V3_CANARY",
      identity.producer_instance_id,
      identity.sequence,
      metadata.strategy_version,
      metadata.symbol,
      metadata.ticker_id,
      metadata.feed,
      metadata.timeframe,
      metadata.bar_open_epoch,
      identity.bar_close_epoch,
      metadata.detector_code_hash,
      metadata.settings_hash,
      receivedAt,
    );
}

function sanitizedChunkDocument(
  observation: Extract<ValidatedObservation, { version: "entry-v2" }>,
) {
  return {
    batch_identity: observation.batchIdentity,
    batch_metadata: observation.batchMetadata,
    chunk_index: observation.chunkIndex,
    chunk_count: observation.chunkCount,
    entry_batches: observation.entryBatches,
  };
}

function storedValidatedChunk(row: StoredEntryChunkRow): StoredValidatedChunk {
  const parsed = JSON.parse(row.validated_payload_json) as {
    readonly batch_identity: EntryBatchSemanticIdentity;
    readonly batch_metadata: EntryBatchImmutableMetadata;
    readonly chunk_index: number;
    readonly chunk_count: number;
    readonly entry_batches: readonly ValidatedEntryWireBatch[];
  };
  return {
    batchId: row.batch_id,
    batchIdentity: parsed.batch_identity,
    batchMetadata: parsed.batch_metadata,
    chunkIndex: parsed.chunk_index,
    chunkCount: parsed.chunk_count,
    payloadSha256: row.payload_sha256,
    receiptId: row.receipt_id,
    entryBatches: parsed.entry_batches,
  };
}

function insertChunkStatement(
  env: Env,
  batchId: string,
  receiptId: string,
  receivedAt: string,
  observation: Extract<ValidatedObservation, { version: "entry-v2" }>,
  payloadSha256: string,
): D1PreparedStatement {
  return env.DB
    .prepare(INSERT_ENTRY_CHUNK_SQL)
    .bind(
      batchId,
      observation.chunkIndex,
      observation.chunkCount,
      receiptId,
      payloadSha256,
      canonicalStringifyRdEntry(sanitizedChunkDocument(observation)),
      receivedAt,
    );
}

async function selectReceipt(
  env: Env,
  idempotencyKey: string,
): Promise<StoredReceipt | null> {
  return env.DB
    .prepare(SELECT_RECEIPT_SQL)
    .bind(idempotencyKey)
    .first<StoredReceipt>();
}

async function replayResult(
  env: Env,
  observation: Extract<ValidatedObservation, { version: "entry-v2" }>,
  batchId: string,
  existing: StoredReceipt,
): Promise<EntryAppendResult> {
  const chunks = await env.DB
    .prepare(LIST_ENTRY_CHUNKS_SQL)
    .bind(batchId)
    .all<StoredEntryChunkRow>();
  const indexes = new Set(chunks.results.map((item) => item.chunk_index));
  const missing = Array.from(
    { length: observation.chunkCount },
    (_value, index) => index,
  ).filter((index) => !indexes.has(index));
  const completion = await env.DB
    .prepare(SELECT_ENTRY_COMPLETION_SQL)
    .bind(batchId)
    .first<StoredEntryCompletionRow>();
  return {
    status: "ACCEPTED",
    record: existing,
    inserted: false,
    assemblyStatus:
      completion !== null || missing.length === 0 ? "COMPLETE" : "INCOMPLETE",
    batchId,
    missingChunkIndexes: completion !== null ? [] : missing,
    evaluations: [],
  };
}

function retainedContextConflict(
  retainedContext: readonly EntryMatchRequest[],
  stored: readonly StreamEvent[],
): EntryStoreConflictCode | null {
  for (const item of retainedContext) {
    const existing = stored.find(
      (value) =>
        value.input.confirmed_bar.close_epoch ===
        item.confirmed_bar.close_epoch,
    );
    if (existing === undefined) return "EVENT_STREAM_CONTEXT_MISSING";
    if (
      canonicalStringifyRdEntry(existing.input) !==
      canonicalStringifyRdEntry(item)
    ) {
      return "EVENT_STREAM_CONFLICT";
    }
  }
  return null;
}

function validateEvaluationOwnership(
  setupId: string,
  backend: EntryEvaluation,
): void {
  const candidates = new Map(
    backend.candidates.map((item) => [item.candidate_id, item]),
  );
  const evidence = new Map(
    backend.evidence.map((item) => [item.evidence_id, item]),
  );
  if (backend.candidates.some((item) => item.setup_id !== setupId)) {
    throw new EntryStoreConflict("IMMUTABLE_ID_CONFLICT");
  }
  for (const item of backend.evidence) {
    if (!candidates.has(item.candidate_id)) {
      throw new EntryStoreConflict("IMMUTABLE_ID_CONFLICT");
    }
  }
  for (const item of backend.handling) {
    const proof = evidence.get(item.evidence_id);
    if (
      proof === undefined ||
      proof.candidate_id !== item.candidate_id ||
      !candidates.has(item.candidate_id)
    ) {
      throw new EntryStoreConflict("IMMUTABLE_ID_CONFLICT");
    }
  }
  const selection = backend.selection;
  if (selection.canonical_candidate_id === null) {
    if (
      selection.canonical_evidence_id !== null ||
      selection.canonical_model !== null
    ) {
      throw new EntryStoreConflict("IMMUTABLE_ID_CONFLICT");
    }
    return;
  }
  const candidate = candidates.get(selection.canonical_candidate_id);
  const proof =
    selection.canonical_evidence_id === null
      ? undefined
      : evidence.get(selection.canonical_evidence_id);
  if (
    candidate === undefined ||
    proof === undefined ||
    proof.candidate_id !== candidate.candidate_id ||
    !selection.candidate_ids_considered.includes(candidate.candidate_id) ||
    selection.canonical_model !== candidate.model
  ) {
    throw new EntryStoreConflict("IMMUTABLE_ID_CONFLICT");
  }
}

async function loadStream(
  env: Env,
  entry: AssembledValidatedSetup,
  batchId: string,
): Promise<{
  readonly stream: readonly StreamEvent[];
  readonly newEvents: readonly StreamEvent[];
}> {
  const rows = await env.DB
    .prepare(SELECT_ENTRY_SETUP_EVENTS_SQL)
    .bind(entry.setupId)
    .all<StoredEntrySetupEvent>();
  const stored: StreamEvent[] = rows.results.map((item) => ({
    eventId: item.event_id,
    input: JSON.parse(item.proof_input_json) as EntryMatchRequest,
    proofInputSha256: item.proof_input_sha256,
    receiptId: item.receipt_id,
    batchId: item.batch_id,
    chunkIndex: -1,
    isNew: false,
  }));
  const contextConflict = retainedContextConflict(
    entry.retainedContext,
    stored,
  );
  if (contextConflict !== null) {
    throw new EntryStoreConflict(contextConflict);
  }
  const current = await Promise.all(
    entry.events.map(async (input) => {
      const proofInputSha256 = await canonicalSha256(input);
      return {
        eventId: await canonicalSha256({
          confirmed_bar_close_epoch: input.confirmed_bar.close_epoch,
          proof_input_sha256: proofInputSha256,
          setup_id: entry.setupId,
        }),
        input,
        proofInputSha256,
        receiptId: entry.origin.receiptId,
        batchId,
        chunkIndex: entry.origin.chunkIndex,
        isNew: true,
      } satisfies StreamEvent;
    }),
  );
  const combined = new Map<number, StreamEvent>(
    stored.map((item) => [item.input.confirmed_bar.close_epoch, item]),
  );
  const newEvents: StreamEvent[] = [];
  for (const item of current) {
    const closeEpoch = item.input.confirmed_bar.close_epoch;
    const existing = combined.get(closeEpoch);
    if (existing !== undefined) {
      if (existing.proofInputSha256 !== item.proofInputSha256) {
        throw new EntryStoreConflict("EVENT_STREAM_CONFLICT");
      }
      continue;
    }
    combined.set(closeEpoch, item);
    newEvents.push(item);
  }
  const stream = [...combined.values()].sort(
    (left, right) =>
      left.input.confirmed_bar.close_epoch -
        right.input.confirmed_bar.close_epoch ||
      left.eventId.localeCompare(right.eventId),
  );
  return { stream, newEvents };
}

function accumulatedInvalidated(stream: readonly StreamEvent[]): boolean {
  return stream.some(
    (item) =>
      item.input.setup.terminal_reason === "INVALIDATED" &&
      item.input.setup.invalidated_before_entry,
  );
}

async function prepareEvaluation(
  env: Env,
  entry: AssembledValidatedSetup,
  batchId: string,
  metadata: EntryBatchImmutableMetadata,
): Promise<PreparedEvaluation> {
  const { stream, newEvents } = await loadStream(env, entry, batchId);
  const revision = await env.DB
    .prepare(SELECT_ENTRY_REVISION_SQL)
    .bind(entry.setupId)
    .first<{ readonly max_revision: number }>();
  const nextRevision = Number(revision?.max_revision ?? 0) + 1;
  let backend: EntryEvaluation;
  try {
    backend = await evaluateEntryStream(
      stream.map((item) => ({
        event_id: item.eventId,
        match_request: item.input,
      })),
      accumulatedInvalidated(stream),
      nextRevision,
      stream.at(-1)!.input.confirmed_bar.close_epoch,
    );
  } catch {
    throw new EntryStoreConflict("TERMINAL_FACT_CONFLICT");
  }
  validateEvaluationOwnership(entry.setupId, backend);
  const parity = compareProducerDiagnostic(
    backend,
    entry.producerDiagnostic,
  );
  const promotionIdentityMismatch =
    promotionDeploymentArmed(env) &&
    RD_ENTRY_PROMOTION_BINDING !== null &&
    (metadata.detector_code_hash !==
      RD_ENTRY_PROMOTION_BINDING.detector_code_hash ||
      metadata.settings_hash !== RD_ENTRY_PROMOTION_BINDING.settings_hash);
  const selection = effectiveSelection(
    backend.selection,
    parity,
    canonicalPaperSelectionConfigured(env, metadata),
    promotionIdentityMismatch,
  );
  const diagnosticId = await canonicalSha256({
    batch_id: batchId,
    producer_diagnostic: entry.producerDiagnostic,
    setup_id: entry.setupId,
  });
  const parityId = await canonicalSha256({
    batch_id: batchId,
    mismatch_reason: parity.mismatchReason,
    parity_status: parity.status,
    producer_diagnostic_id: diagnosticId,
    selection_id: selection.selection_id,
    setup_id: entry.setupId,
  });
  const terminalEvent = stream.find(
    (item) => item.input.setup.terminal_reason !== null,
  );
  const terminal =
    terminalEvent === undefined ||
    terminalEvent.input.setup.terminal_reason === null ||
    terminalEvent.input.setup.terminal_epoch === null
      ? null
      : {
          reason: terminalEvent.input.setup.terminal_reason,
          epoch: terminalEvent.input.setup.terminal_epoch,
          batchId: terminalEvent.batchId,
          receiptId: terminalEvent.receiptId,
        };
  return {
    entry,
    backend,
    parityStatus: parity.status,
    parityMismatchReason: parity.mismatchReason,
    producerDiagnosticSelection: entry.producerDiagnostic.selection,
    selection,
    diagnosticId,
    parityId,
    stream,
    newEvents,
    terminal,
  };
}

async function preflightIdentities(
  env: Env,
  evaluations: readonly PreparedEvaluation[],
): Promise<{
  readonly existingCandidates: ReadonlySet<string>;
  readonly existingEvidence: ReadonlySet<string>;
  readonly existingHandling: ReadonlySet<string>;
}> {
  const candidateIds = [
    ...new Set(
      evaluations.flatMap((item) =>
        item.backend.candidates.map((value) => value.candidate_id),
      ),
    ),
  ];
  const evidenceIds = [
    ...new Set(
      evaluations.flatMap((item) =>
        item.backend.evidence.map((value) => value.evidence_id),
      ),
    ),
  ];
  const handlingIds = [
    ...new Set(
      evaluations.flatMap((item) =>
        item.backend.handling.map((value) => value.handling_id),
      ),
    ),
  ];
  const result = await env.DB
    .prepare(SELECT_ENTRY_IDENTITIES_SQL)
    .bind(
      JSON.stringify(candidateIds),
      JSON.stringify(evidenceIds),
      JSON.stringify(handlingIds),
    )
    .all<StoredIdentityRow>();
  const expected = new Map<string, string>([
    ...candidateIds.map((id) => [`candidate:${id}`, id] as const),
    ...evidenceIds.map((id) => [`evidence:${id}`, id] as const),
    ...handlingIds.map((id) => [`handling:${id}`, id] as const),
  ]);
  for (const row of result.results) {
    if (
      expected.get(`${row.object_kind}:${row.object_id}`) !==
      row.identity_sha256
    ) {
      throw new EntryStoreConflict("IMMUTABLE_ID_CONFLICT");
    }
  }
  return {
    existingCandidates: new Set(
      result.results
        .filter((item) => item.object_kind === "candidate")
        .map((item) => item.object_id),
    ),
    existingEvidence: new Set(
      result.results
        .filter((item) => item.object_kind === "evidence")
        .map((item) => item.object_id),
    ),
    existingHandling: new Set(
      result.results
        .filter((item) => item.object_kind === "handling")
        .map((item) => item.object_id),
    ),
  };
}

function sourceClaimDescriptor(value: StoredSourceClaimRow) {
  return {
    channel_handle: value.channel_handle,
    channel_id: value.channel_id,
    claim_id: value.claim_id,
    contract_version: value.contract_version,
    published_date: value.published_date,
    relationship: value.relationship,
    source_id: value.source_id,
    summary: value.summary,
    timestamp_end_seconds: value.timestamp_end_seconds,
    timestamp_start_seconds: value.timestamp_start_seconds,
    title_snapshot: value.title_snapshot,
    youtube_video_id: value.youtube_video_id,
  };
}

async function sourceCatalogStatements(
  env: Env,
): Promise<readonly D1PreparedStatement[]> {
  const statements: D1PreparedStatement[] = [];
  const missingRelationships: Array<{
    readonly claimId: string;
    readonly targetClaimId: string;
  }> = [];
  for (const item of SOURCE_CLAIM_CATALOG) {
    const existing = await env.DB
      .prepare(SELECT_ENTRY_SOURCE_CLAIM_SQL)
      .bind(item.claim_id)
      .first<StoredSourceClaimRow>();
    const expected = {
      channel_handle: item.channel_handle,
      channel_id: item.channel_id,
      claim_id: item.claim_id,
      contract_version: "2.0.0",
      published_date: item.published_date,
      relationship: item.relationship,
      source_id: item.source_id,
      summary: item.summary,
      timestamp_end_seconds: item.timestamp_end_seconds,
      timestamp_start_seconds: item.timestamp_start_seconds,
      title_snapshot: item.title_snapshot,
      youtube_video_id: item.youtube_video_id,
    };
    if (
      existing !== null &&
      canonicalStringifyRdEntry(sourceClaimDescriptor(existing)) !==
        canonicalStringifyRdEntry(expected)
    ) {
      throw new EntryStoreConflict("IMMUTABLE_ID_CONFLICT");
    }
    if (existing === null) {
      statements.push(
        env.DB
          .prepare(INSERT_ENTRY_SOURCE_CLAIM_SQL)
          .bind(
            item.claim_id,
            item.source_id,
            item.youtube_video_id,
            item.published_date,
            item.title_snapshot,
            item.channel_id,
            item.channel_handle,
            item.timestamp_start_seconds,
            item.timestamp_end_seconds,
            item.relationship,
            item.summary,
          ),
      );
    }
    if (item.target_claim_id !== null) {
      const relationship = await env.DB
        .prepare(SELECT_ENTRY_SOURCE_RELATIONSHIP_SQL)
        .bind(item.claim_id)
        .first<{
          readonly claim_id: string;
          readonly target_claim_id: string;
        }>();
      if (
        relationship !== null &&
        relationship.target_claim_id !== item.target_claim_id
      ) {
        throw new EntryStoreConflict("IMMUTABLE_ID_CONFLICT");
      }
      if (relationship === null) {
        missingRelationships.push({
          claimId: item.claim_id,
          targetClaimId: item.target_claim_id,
        });
      }
    }
  }
  for (const item of missingRelationships) {
    statements.push(
      env.DB
        .prepare(INSERT_ENTRY_SOURCE_RELATIONSHIP_SQL)
        .bind(item.claimId, item.targetClaimId),
    );
  }
  return statements;
}

async function evaluationStatements(
  env: Env,
  batchId: string,
  receivedAt: string,
  evaluations: readonly PreparedEvaluation[],
): Promise<readonly D1PreparedStatement[]> {
  const identities = await preflightIdentities(env, evaluations);
  const statements: D1PreparedStatement[] = [
    ...(await sourceCatalogStatements(env)),
  ];
  const insertedCandidates = new Set<string>();
  const insertedEvidence = new Set<string>();
  const insertedHandling = new Set<string>();
  for (const evaluation of evaluations) {
    const existingTerminal = await env.DB
      .prepare(SELECT_ENTRY_TERMINAL_SQL)
      .bind(evaluation.entry.setupId)
      .first<StoredEntrySetupTerminal>();
    if (existingTerminal !== null) {
      if (
        evaluation.terminal === null ||
        existingTerminal.terminal_reason !== evaluation.terminal.reason ||
        existingTerminal.terminal_epoch !== evaluation.terminal.epoch
      ) {
        throw new EntryStoreConflict("TERMINAL_FACT_CONFLICT");
      }
    }
    for (const event of evaluation.newEvents) {
      statements.push(
        env.DB
          .prepare(INSERT_ENTRY_SETUP_EVENT_SQL)
          .bind(
            event.eventId,
            evaluation.entry.setupId,
            batchId,
            event.receiptId,
            event.input.confirmed_bar.close_epoch,
            event.proofInputSha256,
            canonicalStringifyRdEntry(event.input),
            receivedAt,
          ),
      );
    }
    if (evaluation.terminal !== null && existingTerminal === null) {
      statements.push(
        env.DB
          .prepare(INSERT_ENTRY_TERMINAL_SQL)
          .bind(
            evaluation.entry.setupId,
            evaluation.terminal.reason,
            evaluation.terminal.epoch,
            evaluation.terminal.batchId,
            evaluation.terminal.receiptId,
            receivedAt,
          ),
      );
    }
    for (const candidate of evaluation.backend.candidates) {
      if (
        identities.existingCandidates.has(candidate.candidate_id) ||
        insertedCandidates.has(candidate.candidate_id)
      ) {
        continue;
      }
      statements.push(
        env.DB
          .prepare(INSERT_ENTRY_CANDIDATES_SQL)
          .bind(
            evaluation.entry.origin.receiptId,
            JSON.stringify([
              {
                candidate_id: candidate.candidate_id,
                setup_id: candidate.setup_id,
                model: candidate.model,
                state: candidate.state,
                event_anchor_epoch: candidate.event_anchor_epoch,
                trigger_ordinal: candidate.trigger_ordinal,
                direction: candidate.direction,
                source_claim_ids_json: JSON.stringify(
                  candidate.source_claim_ids,
                ),
                normalized_from: candidate.normalized_from,
                identity_sha256: candidate.candidate_id,
                observed_at_epoch: candidate.observed_at_epoch,
              },
            ]),
          ),
      );
      insertedCandidates.add(candidate.candidate_id);
    }
    for (const evidence of evaluation.backend.evidence) {
      if (
        identities.existingEvidence.has(evidence.evidence_id) ||
        insertedEvidence.has(evidence.evidence_id)
      ) {
        continue;
      }
      statements.push(
        env.DB
          .prepare(INSERT_ENTRY_EVIDENCE_SQL)
          .bind(
            evaluation.entry.origin.receiptId,
            JSON.stringify([
              {
                evidence_id: evidence.evidence_id,
                candidate_id: evidence.candidate_id,
                observed_trigger_epoch: evidence.observed_trigger_epoch,
                observed_trigger_ticks: evidence.observed_trigger_ticks,
                htf_context_minutes_json: JSON.stringify(
                  evidence.htf_context_minutes,
                ),
                fidelity: evidence.fidelity,
                proof_plane: evidence.proof_plane,
                proof_resolution_seconds: evidence.proof_resolution_seconds,
                coverage_start_epoch: evidence.coverage_start_epoch,
                coverage_end_epoch: evidence.coverage_end_epoch,
                ambiguity_codes_json: JSON.stringify(
                  evidence.ambiguity_codes,
                ),
                passed_rule_ids_json: JSON.stringify(
                  evidence.passed_rule_ids,
                ),
                failed_rule_ids_json: JSON.stringify(
                  evidence.failed_rule_ids,
                ),
                source_claim_ids_json: JSON.stringify(
                  evidence.source_claim_ids,
                ),
                payload_sha256: evidence.payload_sha256,
                identity_sha256: evidence.evidence_id,
                observed_at_epoch: evidence.observed_at_epoch,
              },
            ]),
          ),
      );
      insertedEvidence.add(evidence.evidence_id);
    }
    for (const handling of evaluation.backend.handling) {
      if (
        identities.existingHandling.has(handling.handling_id) ||
        insertedHandling.has(handling.handling_id)
      ) {
        continue;
      }
      statements.push(
        env.DB
          .prepare(INSERT_ENTRY_HANDLING_SQL)
          .bind(
            evaluation.entry.origin.receiptId,
            JSON.stringify([
              {
                handling_id: handling.handling_id,
                candidate_id: handling.candidate_id,
                evidence_id: handling.evidence_id,
                handling_mode: handling.handling_mode,
                attempt_kind: handling.attempt_kind,
                observed_epoch: handling.observed_epoch,
                observed_ticks: handling.observed_ticks,
                fidelity: handling.fidelity,
                source_claim_ids_json: JSON.stringify(
                  handling.source_claim_ids,
                ),
                identity_sha256: handling.handling_id,
              },
            ]),
          ),
      );
      insertedHandling.add(handling.handling_id);
    }
    const producer = evaluation.entry.producerDiagnostic;
    statements.push(
      env.DB
        .prepare(INSERT_PRODUCER_DIAGNOSTIC_SQL)
        .bind(
          evaluation.diagnosticId,
          batchId,
          evaluation.entry.setupId,
          JSON.stringify(producer.candidates),
          JSON.stringify(producer.evidence),
          JSON.stringify(producer.realtime_evidence),
          JSON.stringify(producer.handling),
          producer.selection === null
            ? null
            : JSON.stringify(producer.selection),
          receivedAt,
        ),
    );
    const selection = evaluation.selection;
    statements.push(
      env.DB
        .prepare(INSERT_ENTRY_SELECTION_SQL)
        .bind(
          selection.selection_id,
          batchId,
          selection.setup_id,
          selection.policy_version,
          selection.revision,
          JSON.stringify(selection.candidate_ids_considered),
          selection.canonical_candidate_id,
          selection.canonical_evidence_id,
          selection.canonical_model,
          selection.reason,
          selection.fidelity,
          selection.policy_action,
          selection.action,
          selection.effective_action_reason,
          selection.evaluated_at_epoch,
        ),
    );
    const members = [
      ...evaluation.backend.candidates.map((item) => ({
        selection_id: selection.selection_id,
        object_kind: "CANDIDATE",
        object_id: item.candidate_id,
      })),
      ...evaluation.backend.evidence.map((item) => ({
        selection_id: selection.selection_id,
        object_kind: "EVIDENCE",
        object_id: item.evidence_id,
      })),
      ...evaluation.backend.handling.map((item) => ({
        selection_id: selection.selection_id,
        object_kind: "HANDLING",
        object_id: item.handling_id,
      })),
    ];
    if (members.length > 0) {
      statements.push(
        env.DB
          .prepare(INSERT_ENTRY_EVALUATION_MEMBERS_SQL)
          .bind(JSON.stringify(members)),
      );
    }
    statements.push(
      env.DB
        .prepare(INSERT_ENTRY_PARITY_SQL)
        .bind(
          evaluation.parityId,
          batchId,
          evaluation.entry.setupId,
          evaluation.diagnosticId,
          selection.selection_id,
          evaluation.parityStatus,
          evaluation.parityMismatchReason,
          receivedAt,
        ),
    );
  }
  return statements;
}

async function verifyRepeatedIdentities(
  env: Env,
  evaluations: readonly PreparedEvaluation[],
): Promise<void> {
  const candidateIds = evaluations.flatMap((item) =>
    item.backend.candidates.map((value) => value.candidate_id),
  );
  const evidenceIds = evaluations.flatMap((item) =>
    item.backend.evidence.map((value) => value.evidence_id),
  );
  const handlingIds = evaluations.flatMap((item) =>
    item.backend.handling.map((value) => value.handling_id),
  );
  const result = await env.DB
    .prepare(SELECT_ENTRY_IDENTITIES_SQL)
    .bind(
      JSON.stringify(candidateIds),
      JSON.stringify(evidenceIds),
      JSON.stringify(handlingIds),
    )
    .all<StoredIdentityRow>();
  const expectedCount =
    new Set(candidateIds).size +
    new Set(evidenceIds).size +
    new Set(handlingIds).size;
  if (
    result.results.length !== expectedCount ||
    result.results.some((item) => item.object_id !== item.identity_sha256)
  ) {
    throw new Error("entry identity verification failed");
  }
}

async function appendEntryV2ObservationAttempt(
  env: Env,
  observation: Extract<ValidatedObservation, { version: "entry-v2" }>,
  payloadSha256: string,
): Promise<EntryAppendResult> {
  if (env.DB === undefined || env.DB === null) {
    throw new Error("entry storage unavailable");
  }
  const batchId = await canonicalSha256(observation.batchIdentity);
  const existingReceipt = await selectReceipt(
    env,
    observation.metadata.idempotencyKey,
  );
  if (existingReceipt !== null) {
    if (existingReceipt.payload_sha256 !== payloadSha256) {
      throw new EntryStoreIdempotencyConflict();
    }
    return replayResult(env, observation, batchId, existingReceipt);
  }

  const receivedAt = new Date().toISOString();
  const bySequence = await env.DB
    .prepare(SELECT_ENTRY_BATCH_BY_SEQUENCE_SQL)
    .bind(
      observation.batchIdentity.producer_instance_id,
      observation.batchIdentity.sequence,
    )
    .first<StoredEntryBatchRow>();
  if (
    bySequence !== null &&
    !sameBatchIdentity(bySequence, observation.batchIdentity, batchId)
  ) {
    return recordContinuityConflict(
      env,
      observation,
      batchId,
      "SEQUENCE_CONFLICT",
      bySequence,
      receivedAt,
    );
  }
  const byClose = await env.DB
    .prepare(SELECT_ENTRY_BATCH_BY_CLOSE_SQL)
    .bind(
      observation.batchIdentity.producer_instance_id,
      observation.batchIdentity.bar_close_epoch,
    )
    .first<StoredEntryBatchRow>();
  if (
    byClose !== null &&
    !sameBatchIdentity(byClose, observation.batchIdentity, batchId)
  ) {
    return recordContinuityConflict(
      env,
      observation,
      batchId,
      "BAR_CLOSE_CONFLICT",
      byClose,
      receivedAt,
    );
  }
  const storedBatch = await env.DB
    .prepare(SELECT_ENTRY_BATCH_SQL)
    .bind(batchId)
    .first<StoredEntryBatchRow>();
  if (
    storedBatch !== null &&
    storedBatch.chunk_count !== observation.chunkCount
  ) {
    throw new EntryStoreConflict("INCONSISTENT_CHUNK_COUNT");
  }
  if (
    storedBatch !== null &&
    !sameBatchMetadata(storedBatch, observation.batchMetadata)
  ) {
    throw new EntryStoreConflict("INCONSISTENT_BATCH_METADATA");
  }
  const neighbors = await env.DB
    .prepare(SELECT_ENTRY_SEQUENCE_NEIGHBORS_SQL)
    .bind(
      observation.batchIdentity.producer_instance_id,
      observation.batchIdentity.producer_instance_id,
      observation.batchIdentity.sequence,
      observation.batchIdentity.producer_instance_id,
      observation.batchIdentity.sequence,
    )
    .all<StoredEntryBatchRow>();
  for (const neighbor of neighbors.results) {
    if (!sameProducerIdentity(neighbor, observation.batchMetadata)) {
      return recordContinuityConflict(
        env,
        observation,
        batchId,
        "PRODUCER_IDENTITY_CONFLICT",
        null,
        receivedAt,
      );
    }
    if (
      (neighbor.producer_sequence < observation.batchIdentity.sequence &&
        neighbor.bar_close_epoch >=
          observation.batchIdentity.bar_close_epoch) ||
      (neighbor.producer_sequence > observation.batchIdentity.sequence &&
        neighbor.bar_close_epoch <= observation.batchIdentity.bar_close_epoch)
    ) {
      return recordContinuityConflict(
        env,
        observation,
        batchId,
        "SEQUENCE_TIME_CONFLICT",
        null,
        receivedAt,
      );
    }
  }

  const existingChunks = await env.DB
    .prepare(LIST_ENTRY_CHUNKS_SQL)
    .bind(batchId)
    .all<StoredEntryChunkRow>();
  const currentDocument = sanitizedChunkDocument(observation);
  const existingIndex = existingChunks.results.find(
    (item) => item.chunk_index === observation.chunkIndex,
  );
  if (
    existingIndex !== undefined &&
    (existingIndex.payload_sha256 !== payloadSha256 ||
      existingIndex.validated_payload_json !==
        canonicalStringifyRdEntry(currentDocument))
  ) {
    throw new EntryStoreConflict("IMMUTABLE_ID_CONFLICT");
  }
  const receiptId = crypto.randomUUID();
  const currentChunk: StoredValidatedChunk = {
    batchId,
    batchIdentity: observation.batchIdentity,
    batchMetadata: observation.batchMetadata,
    chunkIndex: observation.chunkIndex,
    chunkCount: observation.chunkCount,
    payloadSha256,
    receiptId,
    entryBatches: observation.entryBatches,
  };
  const assembly = await assembleValidatedChunks([
    ...existingChunks.results.map(storedValidatedChunk),
    currentChunk,
  ]);
  const baseStatements: D1PreparedStatement[] = [
    insertReceiptStatement(
      env,
      receiptId,
      receivedAt,
      observation,
      payloadSha256,
    ),
    ...(storedBatch === null
      ? [
          insertBatchStatement(
            env,
            batchId,
            receiptId,
            receivedAt,
            observation,
          ),
        ]
      : []),
    insertHeartbeatStatement(
      env,
      batchId,
      receiptId,
      receivedAt,
      observation,
    ),
    insertChunkStatement(
      env,
      batchId,
      receiptId,
      receivedAt,
      observation,
      payloadSha256,
    ),
  ];
  if (assembly.status === "INCOMPLETE") {
    await env.DB.batch(baseStatements);
    const record = await selectReceipt(
      env,
      observation.metadata.idempotencyKey,
    );
    if (record === null || record.receipt_id !== receiptId) {
      throw new Error("entry receipt unavailable");
    }
    return {
      status: "ACCEPTED",
      record,
      inserted: true,
      assemblyStatus: "INCOMPLETE",
      batchId,
      missingChunkIndexes: assembly.missingIndexes,
      evaluations: [],
    };
  }

  const evaluations = await Promise.all(
    assembly.setups.map((entry) =>
      prepareEvaluation(env, entry, batchId, observation.batchMetadata),
    ),
  );
  const completionId = await canonicalSha256({
    assembled_payload_sha256: assembly.assembledPayloadSha256,
    batch_id: batchId,
  });
  const statements = [
    ...baseStatements,
    ...(await evaluationStatements(
      env,
      batchId,
      receivedAt,
      evaluations,
    )),
    env.DB
      .prepare(INSERT_ENTRY_COMPLETION_SQL)
      .bind(
        completionId,
        batchId,
        assembly.assembledPayloadSha256,
        receivedAt,
      ),
  ];
  await env.DB.batch(statements);
  await verifyRepeatedIdentities(env, evaluations);
  const record = await selectReceipt(
    env,
    observation.metadata.idempotencyKey,
  );
  if (record === null || record.receipt_id !== receiptId) {
    throw new Error("entry receipt unavailable");
  }
  return {
    status: "ACCEPTED",
    record,
    inserted: true,
    assemblyStatus: "COMPLETE",
    batchId,
    missingChunkIndexes: [],
    evaluations: evaluations.map((item) => ({
      producerDiagnosticSelection: item.producerDiagnosticSelection,
      selection: item.selection,
      parityStatus: item.parityStatus,
      parityMismatchReason: item.parityMismatchReason,
    })),
  };
}

function quarantineObjectKind(
  code: EntryStoreConflictCode,
): "BATCH" | "CHUNK" | "SETUP_EVENT" | "SETUP_TERMINAL" {
  if (
    code === "EVENT_STREAM_CONTEXT_MISSING" ||
    code === "EVENT_STREAM_CONFLICT"
  ) {
    return "SETUP_EVENT";
  }
  if (code === "TERMINAL_FACT_CONFLICT") return "SETUP_TERMINAL";
  if (code === "IMMUTABLE_ID_CONFLICT") return "CHUNK";
  return "BATCH";
}

async function recordStoreConflict(
  env: Env,
  observation: Extract<ValidatedObservation, { version: "entry-v2" }>,
  batchId: string,
  conflict: EntryStoreConflict,
): Promise<string> {
  const presentedSha256 = await canonicalSha256(
    sanitizedChunkDocument(observation),
  );
  const quarantineId = await canonicalSha256({
    batch_id: batchId,
    chunk_index: observation.chunkIndex,
    object_kind: quarantineObjectKind(conflict.code),
    presented_sha256: presentedSha256,
    reason: conflict.code,
  });
  const previous = await env.DB
    .prepare(SELECT_ENTRY_QUARANTINE_SQL)
    .bind(quarantineId)
    .first<{ readonly quarantine_id: string }>();
  if (previous !== null) return quarantineId;
  try {
    await env.DB
      .prepare(INSERT_ENTRY_QUARANTINE_SQL)
      .bind(
        quarantineId,
        null,
        batchId,
        null,
        null,
        null,
        quarantineObjectKind(conflict.code),
        batchId,
        null,
        presentedSha256,
        conflict.code,
        new Date().toISOString(),
      )
      .run();
  } catch {
    const raced = await env.DB
      .prepare(SELECT_ENTRY_QUARANTINE_SQL)
      .bind(quarantineId)
      .first<{ readonly quarantine_id: string }>();
    if (raced === null) throw new Error("entry quarantine unavailable");
  }
  return quarantineId;
}

export async function appendEntryV2Observation(
  env: Env,
  observation: Extract<ValidatedObservation, { version: "entry-v2" }>,
  payloadSha256: string,
): Promise<EntryAppendResult> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await appendEntryV2ObservationAttempt(
        env,
        observation,
        payloadSha256,
      );
    } catch (error) {
      if (error instanceof EntryStoreConflict) {
        const batchId = await canonicalSha256(observation.batchIdentity);
        error.quarantineId = await recordStoreConflict(
          env,
          observation,
          batchId,
          error,
        );
        throw error;
      }
      if (
        attempt === 0 &&
        String(error).toLowerCase().includes("unique constraint")
      ) {
        continue;
      }
      throw error;
    }
  }
  throw new Error("entry storage retry exhausted");
}
