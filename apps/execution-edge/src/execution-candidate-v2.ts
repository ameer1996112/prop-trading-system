import { canonicalStringify, sha256Hex } from "./canonical";

const SHA256 = /^[a-f0-9]{64}$/u;
const IDENTIFIER = /^[\x21-\x5b\x5d-\x7e]{1,160}$/u;
const TICK_SIZE = /^(?:0\.[0-9]{0,11}[1-9]|[1-9][0-9]*(?:\.[0-9]{0,11}[1-9])?)$/u;
const CANDIDATE_KEYS = [
  "schema_version", "proposal_schema_version", "logical_candidate_id",
  "candidate_body_sha256", "strategy_version", "execution_mode",
  "producer_instance_id", "producer_sequence", "delivery_kind",
  "ingest_integrity", "ticker_id", "source_symbol", "source_feed",
  "timeframe", "source_tick_size", "source_tick_capability_sha256",
  "detector_code_sha256", "settings_sha256", "provenance_sha256",
  "setup_id", "setup_revision", "selection_id", "entry_model",
  "liquidity_cohort", "selection_fidelity", "selection_action",
  "evidence_replayability", "direction", "zone_top_ticks", "zone_bottom_ticks",
  "zone_active_from_epoch", "engagement_candle", "source_bar", "wick_reference",
  "wick_reference_ticks", "buffer_policy_version", "buffer_ticks", "entry_ticks",
  "stop_ticks", "risk_distance_ticks", "target_ticks", "observed_at_epoch",
] as const;
const CANDLE_KEYS = [
  "open_epoch", "close_epoch", "open_ticks", "high_ticks", "low_ticks",
  "close_ticks", "closed",
] as const;
const BUFFER_TICKS = Object.freeze({ EURUSD: 2, GBPJPY: 3, USDJPY: 2, XAUUSD: 5, NAS100: 10 });

export interface ExecutionCandidateV2Candle {
  readonly open_epoch: number;
  readonly close_epoch: number;
  readonly open_ticks: number;
  readonly high_ticks: number;
  readonly low_ticks: number;
  readonly close_ticks: number;
  readonly closed: true;
}

export interface ExecutionCandidateV2 {
  readonly schema_version: "ExecutionCandidateV2";
  readonly proposal_schema_version: "rd-entry-execution-proposal-v2";
  readonly logical_candidate_id: string;
  readonly candidate_body_sha256: string;
  readonly strategy_version: "rd-entry-execution-proposal-v2";
  readonly execution_mode: "PAPER_ONLY";
  readonly producer_instance_id: string;
  readonly producer_sequence: number;
  readonly delivery_kind: "LIVE";
  readonly ingest_integrity: "LIVE_CONTIGUOUS";
  readonly ticker_id: string;
  readonly source_symbol: keyof typeof BUFFER_TICKS;
  readonly source_feed: string;
  readonly timeframe: "M5";
  readonly source_tick_size: string;
  readonly source_tick_capability_sha256: string;
  readonly detector_code_sha256: string;
  readonly settings_sha256: string;
  readonly provenance_sha256: string;
  readonly setup_id: string;
  readonly setup_revision: number;
  readonly selection_id: string;
  readonly entry_model: "DIR_CLOSE";
  readonly liquidity_cohort: "TWO_PLUS_CANDLES";
  readonly selection_fidelity: "EXACT";
  readonly selection_action: "PAPER_ELIGIBLE";
  readonly evidence_replayability: "REPLAYABLE";
  readonly direction: "LONG" | "SHORT";
  readonly zone_top_ticks: number;
  readonly zone_bottom_ticks: number;
  readonly zone_active_from_epoch: number;
  readonly engagement_candle: ExecutionCandidateV2Candle;
  readonly source_bar: ExecutionCandidateV2Candle;
  readonly wick_reference: "LOW" | "HIGH";
  readonly wick_reference_ticks: number;
  readonly buffer_policy_version: "rd-entry-wick-buffer-v1";
  readonly buffer_ticks: number;
  readonly entry_ticks: number;
  readonly stop_ticks: number;
  readonly risk_distance_ticks: number;
  readonly target_ticks: number;
  readonly observed_at_epoch: number;
}

function invalid(): never {
  throw new Error("EXECUTION_CANDIDATE_V2_INVALID");
}

function objectValue(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) invalid();
}

function safeInteger(value: unknown, minimum = Number.MIN_SAFE_INTEGER): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) invalid();
  return value;
}

function digest(value: unknown): string {
  if (typeof value !== "string" || !SHA256.test(value) || value === "0".repeat(64)) invalid();
  return value;
}

function identifier(value: unknown): string {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) invalid();
  return value;
}

function literal<T>(value: unknown, expected: T): T {
  if (value !== expected) invalid();
  return expected;
}

function candle(value: unknown): ExecutionCandidateV2Candle {
  const input = objectValue(value);
  exactKeys(input, CANDLE_KEYS);
  const result: ExecutionCandidateV2Candle = Object.freeze({
    open_epoch: safeInteger(input.open_epoch, 0),
    close_epoch: safeInteger(input.close_epoch, 0),
    open_ticks: safeInteger(input.open_ticks),
    high_ticks: safeInteger(input.high_ticks),
    low_ticks: safeInteger(input.low_ticks),
    close_ticks: safeInteger(input.close_ticks),
    closed: literal(input.closed, true),
  });
  if (
    result.open_epoch % 300 !== 0 || result.close_epoch - result.open_epoch !== 300 ||
    result.low_ticks > result.high_ticks || result.open_ticks < result.low_ticks ||
    result.open_ticks > result.high_ticks || result.close_ticks < result.low_ticks ||
    result.close_ticks > result.high_ticks
  ) invalid();
  return result;
}

export async function validateExecutionCandidateV2(value: unknown): Promise<ExecutionCandidateV2> {
  try {
    const input = objectValue(value);
    exactKeys(input, CANDIDATE_KEYS);
    const schemaVersion = literal(input.schema_version, "ExecutionCandidateV2");
    const proposalSchemaVersion = literal(input.proposal_schema_version, "rd-entry-execution-proposal-v2");
    const strategyVersion = literal(input.strategy_version, "rd-entry-execution-proposal-v2");
    const executionMode = literal(input.execution_mode, "PAPER_ONLY");
    const deliveryKind = literal(input.delivery_kind, "LIVE");
    const ingestIntegrity = literal(input.ingest_integrity, "LIVE_CONTIGUOUS");
    const timeframe = literal(input.timeframe, "M5");
    const entryModel = literal(input.entry_model, "DIR_CLOSE");
    const liquidityCohort = literal(input.liquidity_cohort, "TWO_PLUS_CANDLES");
    const selectionFidelity = literal(input.selection_fidelity, "EXACT");
    const selectionAction = literal(input.selection_action, "PAPER_ELIGIBLE");
    const evidenceReplayability = literal(input.evidence_replayability, "REPLAYABLE");
    const bufferPolicyVersion = literal(input.buffer_policy_version, "rd-entry-wick-buffer-v1");
    const sourceSymbol = input.source_symbol;
    if (typeof sourceSymbol !== "string" || !(sourceSymbol in BUFFER_TICKS)) invalid();
    const direction = input.direction;
    if (direction !== "LONG" && direction !== "SHORT") invalid();
    const engagement = candle(input.engagement_candle);
    const sourceBar = candle(input.source_bar);
    const logicalCandidateId = digest(input.logical_candidate_id);
    const candidateBodySha256 = digest(input.candidate_body_sha256);
    const sourceTickCapabilitySha256 = digest(input.source_tick_capability_sha256);
    const detectorCodeSha256 = digest(input.detector_code_sha256);
    const settingsSha256 = digest(input.settings_sha256);
    const provenanceSha256 = digest(input.provenance_sha256);
    const producerInstanceId = identifier(input.producer_instance_id);
    const tickerId = identifier(input.ticker_id);
    const sourceFeed = identifier(input.source_feed);
    const setupId = identifier(input.setup_id);
    const selectionId = identifier(input.selection_id);
    const producerSequence = safeInteger(input.producer_sequence, 1);
    const setupRevision = safeInteger(input.setup_revision, 1);
    const bufferTicks = safeInteger(input.buffer_ticks, 1);
    const riskDistanceTicks = safeInteger(input.risk_distance_ticks, 1);
    const zoneTop = safeInteger(input.zone_top_ticks);
    const zoneBottom = safeInteger(input.zone_bottom_ticks);
    const zoneActive = safeInteger(input.zone_active_from_epoch, 0);
    const wickReferenceTicks = safeInteger(input.wick_reference_ticks);
    const entryTicks = safeInteger(input.entry_ticks);
    const stopTicks = safeInteger(input.stop_ticks);
    const targetTicks = safeInteger(input.target_ticks);
    const observedAt = safeInteger(input.observed_at_epoch, 0);
    if (typeof input.source_tick_size !== "string" || input.source_tick_size.length > 32 || !TICK_SIZE.test(input.source_tick_size)) invalid();
    const wick = direction === "LONG" ? engagement.low_ticks : engagement.high_ticks;
    const expectedStop = direction === "LONG" ? wick - bufferTicks : wick + bufferTicks;
    const expectedRisk = direction === "LONG" ? entryTicks - stopTicks : stopTicks - entryTicks;
    const expectedTarget = direction === "LONG" ? entryTicks + 4 * riskDistanceTicks : entryTicks - 4 * riskDistanceTicks;
    if (
      zoneTop <= zoneBottom || engagement.high_ticks < zoneBottom || engagement.low_ticks > zoneTop ||
      zoneActive % 300 !== 0 || zoneActive > engagement.open_epoch || zoneActive >= sourceBar.close_epoch ||
      engagement.close_epoch > sourceBar.close_epoch || sourceBar.close_epoch > observedAt ||
      observedAt - sourceBar.close_epoch > 30 ||
      input.wick_reference !== (direction === "LONG" ? "LOW" : "HIGH") ||
      wickReferenceTicks !== wick || bufferTicks !== BUFFER_TICKS[sourceSymbol as keyof typeof BUFFER_TICKS] ||
      stopTicks !== expectedStop || riskDistanceTicks !== expectedRisk || targetTicks !== expectedTarget || entryTicks !== sourceBar.close_ticks ||
      !Number.isSafeInteger(expectedStop) || !Number.isSafeInteger(expectedRisk) || !Number.isSafeInteger(expectedTarget) ||
      (direction === "LONG" && !(sourceBar.close_ticks > sourceBar.open_ticks && sourceBar.close_ticks > zoneTop && stopTicks < wick)) ||
      (direction === "SHORT" && !(sourceBar.close_ticks < sourceBar.open_ticks && sourceBar.close_ticks < zoneBottom && stopTicks > wick))
    ) invalid();
    const expectedLogicalCandidateId = await sha256Hex(canonicalStringify({
      strategy_version: strategyVersion,
      wire_version: schemaVersion,
      ticker_id: tickerId,
      setup_id: setupId,
      setup_revision: setupRevision,
      selection_id: selectionId,
      source_bar_close_epoch: sourceBar.close_epoch,
    }));
    if (expectedLogicalCandidateId !== logicalCandidateId) invalid();
    const { candidate_body_sha256: _digest, ...body } = input;
    if (await sha256Hex(canonicalStringify(body)) !== candidateBodySha256) invalid();
    return Object.freeze({
      schema_version: schemaVersion,
      proposal_schema_version: proposalSchemaVersion,
      logical_candidate_id: logicalCandidateId,
      candidate_body_sha256: candidateBodySha256,
      strategy_version: strategyVersion,
      execution_mode: executionMode,
      producer_instance_id: producerInstanceId,
      producer_sequence: producerSequence,
      delivery_kind: deliveryKind,
      ingest_integrity: ingestIntegrity,
      ticker_id: tickerId,
      source_symbol: sourceSymbol as keyof typeof BUFFER_TICKS,
      source_feed: sourceFeed,
      timeframe,
      source_tick_size: input.source_tick_size,
      source_tick_capability_sha256: sourceTickCapabilitySha256,
      detector_code_sha256: detectorCodeSha256,
      settings_sha256: settingsSha256,
      provenance_sha256: provenanceSha256,
      setup_id: setupId,
      setup_revision: setupRevision,
      selection_id: selectionId,
      entry_model: entryModel,
      liquidity_cohort: liquidityCohort,
      selection_fidelity: selectionFidelity,
      selection_action: selectionAction,
      evidence_replayability: evidenceReplayability,
      direction,
      zone_top_ticks: zoneTop,
      zone_bottom_ticks: zoneBottom,
      zone_active_from_epoch: zoneActive,
      engagement_candle: engagement,
      source_bar: sourceBar,
      wick_reference: input.wick_reference as "LOW" | "HIGH",
      wick_reference_ticks: wickReferenceTicks,
      buffer_policy_version: bufferPolicyVersion,
      buffer_ticks: bufferTicks,
      entry_ticks: entryTicks,
      stop_ticks: stopTicks,
      risk_distance_ticks: riskDistanceTicks,
      target_ticks: targetTicks,
      observed_at_epoch: observedAt,
    });
  } catch {
    return invalid();
  }
}
