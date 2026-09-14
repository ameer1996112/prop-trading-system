import type { CanonicalObject } from "./types";
import { isStrictJsonNumber, parseStrictJson } from "./strict-json";

export const EXECUTION_PROPOSAL_V1 = Object.freeze({
  schemaVersion: "rd-entry-execution-proposal-v1",
  strategyVersion: "rd-entry-execution-proposal-v1",
  candidateWireVersion: "ExecutionCandidateV1",
  bufferPolicyVersion: "rd-entry-wick-buffer-v1",
  executionMode: "PAPER_ONLY",
} as const);

export const EXECUTION_PROPOSAL_V1_SYMBOL_POLICIES = Object.freeze({
  EURUSD: Object.freeze({ minimumBufferTicks: 2, divergenceToleranceTicks: 3 }),
  GBPJPY: Object.freeze({ minimumBufferTicks: 3, divergenceToleranceTicks: 5 }),
  USDJPY: Object.freeze({ minimumBufferTicks: 2, divergenceToleranceTicks: 5 }),
  XAUUSD: Object.freeze({ minimumBufferTicks: 5, divergenceToleranceTicks: 10 }),
  NAS100: Object.freeze({ minimumBufferTicks: 10, divergenceToleranceTicks: 20 }),
} as const);

export type ExecutionProposalV1SourceSymbol =
  keyof typeof EXECUTION_PROPOSAL_V1_SYMBOL_POLICIES;
export type ExecutionProposalV1Direction = "LONG" | "SHORT";

export interface ExecutionProposalV1Candle {
  readonly open_epoch: number;
  readonly close_epoch: number;
  readonly open_ticks: number;
  readonly high_ticks: number;
  readonly low_ticks: number;
  readonly close_ticks: number;
  readonly closed: true;
}

export interface ExecutionProposalV1 {
  readonly schema_version: "rd-entry-execution-proposal-v1";
  readonly strategy_version: "rd-entry-execution-proposal-v1";
  readonly execution_mode: "PAPER_ONLY";
  readonly producer_instance_id: string;
  readonly producer_sequence: number;
  readonly delivery_kind: "LIVE";
  readonly ingest_integrity: "LIVE_CONTIGUOUS";
  readonly ticker_id: string;
  readonly source_symbol: ExecutionProposalV1SourceSymbol;
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
  readonly direction: ExecutionProposalV1Direction;
  readonly zone_top_ticks: number;
  readonly zone_bottom_ticks: number;
  readonly engagement_candle: ExecutionProposalV1Candle;
  readonly source_bar: ExecutionProposalV1Candle;
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

export interface ExecutionCandidateV1
  extends Omit<ExecutionProposalV1, "schema_version"> {
  readonly schema_version: "ExecutionCandidateV1";
  readonly proposal_schema_version: "rd-entry-execution-proposal-v1";
  readonly logical_candidate_id: string;
  readonly candidate_body_sha256: string;
}

/**
 * Trusted, immutable edge configuration for one reviewed source identity.
 * It is deliberately account-free and is copied/frozen before comparison.
 */
export interface ExecutionProposalV1ReviewedIdentity {
  readonly ticker_id: string;
  readonly source_symbol: ExecutionProposalV1SourceSymbol;
  readonly source_feed: string;
  readonly detector_code_sha256: string;
  readonly settings_sha256: string;
  readonly provenance_sha256: string;
  readonly source_tick_capability_sha256: string;
  readonly source_tick_size: string;
  readonly buffer_policy_version: "rd-entry-wick-buffer-v1";
}

const PROPOSAL_KEYS = [
  "schema_version",
  "strategy_version",
  "execution_mode",
  "producer_instance_id",
  "producer_sequence",
  "delivery_kind",
  "ingest_integrity",
  "ticker_id",
  "source_symbol",
  "source_feed",
  "timeframe",
  "source_tick_size",
  "source_tick_capability_sha256",
  "detector_code_sha256",
  "settings_sha256",
  "provenance_sha256",
  "setup_id",
  "setup_revision",
  "selection_id",
  "entry_model",
  "liquidity_cohort",
  "selection_fidelity",
  "selection_action",
  "evidence_replayability",
  "direction",
  "zone_top_ticks",
  "zone_bottom_ticks",
  "engagement_candle",
  "source_bar",
  "wick_reference",
  "wick_reference_ticks",
  "buffer_policy_version",
  "buffer_ticks",
  "entry_ticks",
  "stop_ticks",
  "risk_distance_ticks",
  "target_ticks",
  "observed_at_epoch",
] as const;

const CANDLE_KEYS = [
  "open_epoch",
  "close_epoch",
  "open_ticks",
  "high_ticks",
  "low_ticks",
  "close_ticks",
  "closed",
] as const;
const REVIEWED_IDENTITY_KEYS = [
  "ticker_id",
  "source_symbol",
  "source_feed",
  "detector_code_sha256",
  "settings_sha256",
  "provenance_sha256",
  "source_tick_capability_sha256",
  "source_tick_size",
  "buffer_policy_version",
] as const;
const SHA256 = /^[a-f0-9]{64}$/u;
const IDENTIFIER = /^[\x21-\x5b\x5d-\x7e]{1,160}$/u;
const CANONICAL_POSITIVE_DECIMAL =
  /^(?:0\.[0-9]{0,11}[1-9]|[1-9][0-9]*(?:\.[0-9]{0,11}[1-9])?)$/u;
const MAX_TICK_SIZE_CHARACTERS = 32;

export class ExecutionProposalV1ValidationError extends Error {
  constructor() {
    super("EXECUTION_PROPOSAL_V1_INVALID");
    this.name = "ExecutionProposalV1ValidationError";
  }
}

function invalid(): never {
  throw new ExecutionProposalV1ValidationError();
}

function strictJsonInput(value: unknown): unknown {
  try {
    if (!(value instanceof Uint8Array)) return value;
    return parseStrictJson(value);
  } catch {
    return invalid();
  }
}

function objectValue(value: unknown): Record<string, unknown> {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return invalid();
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return invalid();

    const safeValue = Object.create(null) as Record<string, unknown>;
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") return invalid();
      const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        !("value" in descriptor)
      ) {
        return invalid();
      }
      Object.defineProperty(safeValue, key, {
        value: descriptor.value,
        enumerable: true,
        writable: false,
        configurable: false,
      });
    }
    return safeValue;
  } catch {
    return invalid();
  }
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): void {
  try {
    const actual = Reflect.ownKeys(value);
    const sortedExpected = [...expected].sort();
    if (
      actual.some((key) => typeof key !== "string") ||
      actual.length !== sortedExpected.length ||
      (actual as string[]).sort().some(
        (key, index) => key !== sortedExpected[index],
      )
    ) {
      invalid();
    }
  } catch {
    invalid();
  }
}

function identifier(value: unknown): string {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) return invalid();
  return value;
}

function digest(value: unknown): string {
  if (
    typeof value !== "string" ||
    !SHA256.test(value) ||
    value === "0".repeat(64)
  ) {
    return invalid();
  }
  return value;
}

function canonicalTickSize(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > MAX_TICK_SIZE_CHARACTERS ||
    !CANONICAL_POSITIVE_DECIMAL.test(value)
  ) {
    return invalid();
  }
  return value;
}

function safeInteger(value: unknown, minimum?: number): number {
  const numericValue = isStrictJsonNumber(value)
    ? value.isIntegerToken
      ? value.value
      : invalid()
    : value;
  if (
    typeof numericValue !== "number" ||
    !Number.isSafeInteger(numericValue) ||
    (minimum !== undefined && numericValue < minimum)
  ) {
    return invalid();
  }
  return numericValue;
}

function literal<const T extends string>(value: unknown, expected: T): T {
  if (value !== expected) return invalid();
  return expected;
}

function candle(value: unknown): ExecutionProposalV1Candle {
  const input = objectValue(value);
  exactKeys(input, CANDLE_KEYS);
  if (input.closed !== true) invalid();
  const result: ExecutionProposalV1Candle = {
    open_epoch: safeInteger(input.open_epoch, 0),
    close_epoch: safeInteger(input.close_epoch, 0),
    open_ticks: safeInteger(input.open_ticks),
    high_ticks: safeInteger(input.high_ticks),
    low_ticks: safeInteger(input.low_ticks),
    close_ticks: safeInteger(input.close_ticks),
    closed: true,
  };
  if (
    result.open_epoch % 300 !== 0 ||
    result.close_epoch - result.open_epoch !== 300 ||
    result.low_ticks > result.high_ticks ||
    result.open_ticks < result.low_ticks ||
    result.open_ticks > result.high_ticks ||
    result.close_ticks < result.low_ticks ||
    result.close_ticks > result.high_ticks
  ) {
    invalid();
  }
  return Object.freeze({ ...result, closed: true });
}

function sourceSymbol(value: unknown): ExecutionProposalV1SourceSymbol {
  if (
    value !== "EURUSD" &&
    value !== "GBPJPY" &&
    value !== "USDJPY" &&
    value !== "XAUUSD" &&
    value !== "NAS100"
  ) {
    return invalid();
  }
  return value;
}

function direction(value: unknown): ExecutionProposalV1Direction {
  if (value !== "LONG" && value !== "SHORT") return invalid();
  return value;
}

function reviewedIdentity(
  value: unknown,
): Readonly<ExecutionProposalV1ReviewedIdentity> {
  const input = objectValue(strictJsonInput(value));
  exactKeys(input, REVIEWED_IDENTITY_KEYS);
  return Object.freeze({
    ticker_id: identifier(input.ticker_id),
    source_symbol: sourceSymbol(input.source_symbol),
    source_feed: identifier(input.source_feed),
    detector_code_sha256: digest(input.detector_code_sha256),
    settings_sha256: digest(input.settings_sha256),
    provenance_sha256: digest(input.provenance_sha256),
    source_tick_capability_sha256: digest(
      input.source_tick_capability_sha256,
    ),
    source_tick_size: canonicalTickSize(input.source_tick_size),
    buffer_policy_version: literal(
      input.buffer_policy_version,
      EXECUTION_PROPOSAL_V1.bufferPolicyVersion,
    ),
  });
}

export function validateExecutionProposalV1(
  value: unknown,
  reviewedIdentityValue: unknown,
): ExecutionProposalV1 {
  const input = objectValue(strictJsonInput(value));
  exactKeys(input, PROPOSAL_KEYS);
  const binding = reviewedIdentity(reviewedIdentityValue);
  const symbol = sourceSymbol(input.source_symbol);
  const proposalDirection = direction(input.direction);
  const tickerId = identifier(input.ticker_id);
  const sourceFeed = identifier(input.source_feed);
  const sourceTickSize = canonicalTickSize(input.source_tick_size);
  const sourceTickCapabilitySha256 = digest(
    input.source_tick_capability_sha256,
  );
  const detectorCodeSha256 = digest(input.detector_code_sha256);
  const settingsSha256 = digest(input.settings_sha256);
  const provenanceSha256 = digest(input.provenance_sha256);
  const bufferPolicyVersion = literal(
    input.buffer_policy_version,
    EXECUTION_PROPOSAL_V1.bufferPolicyVersion,
  );
  const engagement = candle(input.engagement_candle);
  const sourceBar = candle(input.source_bar);
  const zoneTop = safeInteger(input.zone_top_ticks);
  const zoneBottom = safeInteger(input.zone_bottom_ticks);
  const wickReferenceTicks = safeInteger(input.wick_reference_ticks);
  const bufferTicks = safeInteger(input.buffer_ticks, 1);
  const entryTicks = safeInteger(input.entry_ticks);
  const stopTicks = safeInteger(input.stop_ticks);
  const riskDistanceTicks = safeInteger(input.risk_distance_ticks, 1);
  const targetTicks = safeInteger(input.target_ticks);
  const observedAtEpoch = safeInteger(input.observed_at_epoch, 0);
  const policy = EXECUTION_PROPOSAL_V1_SYMBOL_POLICIES[symbol];
  const expectedWick = proposalDirection === "LONG" ? "LOW" : "HIGH";
  const expectedWickTicks =
    proposalDirection === "LONG" ? engagement.low_ticks : engagement.high_ticks;
  const expectedStop = proposalDirection === "LONG"
    ? expectedWickTicks - bufferTicks
    : expectedWickTicks + bufferTicks;
  const expectedRisk = proposalDirection === "LONG"
    ? entryTicks - stopTicks
    : stopTicks - entryTicks;
  const expectedTarget = proposalDirection === "LONG"
    ? entryTicks + 4 * expectedRisk
    : entryTicks - 4 * expectedRisk;

  if (
    zoneTop <= zoneBottom ||
    engagement.high_ticks < zoneBottom ||
    engagement.low_ticks > zoneTop ||
    engagement.close_epoch > sourceBar.close_epoch ||
    sourceBar.close_epoch > observedAtEpoch ||
    observedAtEpoch - sourceBar.close_epoch > 30 ||
    input.wick_reference !== expectedWick ||
    wickReferenceTicks !== expectedWickTicks ||
    bufferTicks !== policy.minimumBufferTicks ||
    stopTicks !== expectedStop ||
    riskDistanceTicks !== expectedRisk ||
    targetTicks !== expectedTarget ||
    !Number.isSafeInteger(expectedStop) ||
    !Number.isSafeInteger(expectedRisk) ||
    !Number.isSafeInteger(expectedTarget) ||
    entryTicks !== sourceBar.close_ticks ||
    (proposalDirection === "LONG" &&
      !(sourceBar.close_ticks > sourceBar.open_ticks &&
        sourceBar.close_ticks > zoneTop &&
        stopTicks < expectedWickTicks)) ||
    (proposalDirection === "SHORT" &&
      !(sourceBar.close_ticks < sourceBar.open_ticks &&
        sourceBar.close_ticks < zoneBottom &&
        stopTicks > expectedWickTicks))
  ) {
    invalid();
  }

  if (
    tickerId !== binding.ticker_id ||
    symbol !== binding.source_symbol ||
    sourceFeed !== binding.source_feed ||
    detectorCodeSha256 !== binding.detector_code_sha256 ||
    settingsSha256 !== binding.settings_sha256 ||
    provenanceSha256 !== binding.provenance_sha256 ||
    sourceTickCapabilitySha256 !==
      binding.source_tick_capability_sha256 ||
    sourceTickSize !== binding.source_tick_size ||
    bufferPolicyVersion !== binding.buffer_policy_version
  ) {
    invalid();
  }

  return Object.freeze({
    schema_version: literal(input.schema_version, EXECUTION_PROPOSAL_V1.schemaVersion),
    strategy_version: literal(
      input.strategy_version,
      EXECUTION_PROPOSAL_V1.strategyVersion,
    ),
    execution_mode: literal(input.execution_mode, "PAPER_ONLY"),
    producer_instance_id: identifier(input.producer_instance_id),
    producer_sequence: safeInteger(input.producer_sequence, 1),
    delivery_kind: literal(input.delivery_kind, "LIVE"),
    ingest_integrity: literal(input.ingest_integrity, "LIVE_CONTIGUOUS"),
    ticker_id: tickerId,
    source_symbol: symbol,
    source_feed: sourceFeed,
    timeframe: literal(input.timeframe, "M5"),
    source_tick_size: sourceTickSize,
    source_tick_capability_sha256: sourceTickCapabilitySha256,
    detector_code_sha256: detectorCodeSha256,
    settings_sha256: settingsSha256,
    provenance_sha256: provenanceSha256,
    setup_id: identifier(input.setup_id),
    setup_revision: safeInteger(input.setup_revision, 1),
    selection_id: identifier(input.selection_id),
    entry_model: literal(input.entry_model, "DIR_CLOSE"),
    liquidity_cohort: literal(input.liquidity_cohort, "TWO_PLUS_CANDLES"),
    selection_fidelity: literal(input.selection_fidelity, "EXACT"),
    selection_action: literal(input.selection_action, "PAPER_ELIGIBLE"),
    evidence_replayability: literal(input.evidence_replayability, "REPLAYABLE"),
    direction: proposalDirection,
    zone_top_ticks: zoneTop,
    zone_bottom_ticks: zoneBottom,
    engagement_candle: engagement,
    source_bar: sourceBar,
    wick_reference: expectedWick,
    wick_reference_ticks: wickReferenceTicks,
    buffer_policy_version: bufferPolicyVersion,
    buffer_ticks: bufferTicks,
    entry_ticks: entryTicks,
    stop_ticks: stopTicks,
    risk_distance_ticks: riskDistanceTicks,
    target_ticks: targetTicks,
    observed_at_epoch: observedAtEpoch,
  });
}

async function sha256(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(bytes), (item) =>
    item.toString(16).padStart(2, "0"),
  ).join("");
}

function executionCandidateV1Identity(
  proposal: ExecutionProposalV1,
): CanonicalObject {
  return {
    strategy_version: proposal.strategy_version,
    wire_version: EXECUTION_PROPOSAL_V1.candidateWireVersion,
    ticker_id: proposal.ticker_id,
    setup_id: proposal.setup_id,
    setup_revision: proposal.setup_revision,
    selection_id: proposal.selection_id,
    source_bar_close_epoch: proposal.source_bar.close_epoch,
  };
}

function hasOnlyUnicodeScalars(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function canonicalExecutionStringify(
  value: unknown,
  depth = 0,
  budget = { remaining: 256 },
): string {
  budget.remaining -= 1;
  if (budget.remaining < 0 || depth > 16) return invalid();
  if (value === null || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) return invalid();
    return JSON.stringify(value);
  }
  if (typeof value === "string") {
    if (!hasOnlyUnicodeScalars(value)) return invalid();
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value
      .map((item) => canonicalExecutionStringify(item, depth + 1, budget))
      .join(",")}]`;
  }
  if (value === null || typeof value !== "object") return invalid();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return invalid();
  const object = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => {
      if (!hasOnlyUnicodeScalars(key)) return invalid();
      return `${JSON.stringify(key)}:${canonicalExecutionStringify(
        object[key],
        depth + 1,
        budget,
      )}`;
    })
    .join(",")}}`;
}

export async function deriveExecutionCandidateV1(
  value: unknown,
  reviewedIdentityValue: unknown,
): Promise<ExecutionCandidateV1> {
  const proposal = validateExecutionProposalV1(value, reviewedIdentityValue);
  const logicalCandidateId = await sha256(
    canonicalExecutionStringify(executionCandidateV1Identity(proposal)),
  );
  const { schema_version: proposalSchemaVersion, ...proposalBody } = proposal;
  const body = {
    ...proposalBody,
    schema_version: EXECUTION_PROPOSAL_V1.candidateWireVersion,
    proposal_schema_version: proposalSchemaVersion,
    logical_candidate_id: logicalCandidateId,
  } as const;
  const candidateBodySha256 = await sha256(
    canonicalExecutionStringify(body),
  );
  return Object.freeze({
    ...body,
    candidate_body_sha256: candidateBodySha256,
  });
}
