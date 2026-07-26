import {
  rdEntryCanonicalValue,
  type AmbiguityCode,
  type CandidateFidelity,
  type CandidateState,
  type EntryDirection,
  type EntryMatchRequest,
  type EntryModelV2,
  type HandlingMode,
  type HTFFlipProof,
  type HTFFlipProofTranscript,
  type OrderedCandle,
  type ProofPlane,
  type SelectionReason,
  type SetupAttemptTerminalReason,
  type SetupEntryFacts,
} from "./rd-entry-domain";
import {
  evaluateEntryMatch,
  validateEntryRequestShape,
  validateHtfFlipProof,
} from "./rd-entry-matcher";
import { SOURCE_CLAIMS } from "./rd-entry-policy";
import { SOURCE_CLAIM_CATALOG } from "./rd-entry-source-catalog";
import {
  isStrictJsonNumber,
  type StrictJsonValue,
} from "./strict-json";
import type { CanonicalValue, ReceiptMetadata } from "./types";

type StrictObject = { [key: string]: StrictJsonValue };

type ConfirmedBarWire = {
  readonly oe: number;
  readonly ce: number;
  readonly o: number;
  readonly h: number;
  readonly l: number;
  readonly c: number;
  readonly gb: boolean;
  readonly rr: boolean;
};

type TranscriptCandleWire = {
  readonly oe: number;
  readonly ce: number;
  readonly o: number;
  readonly h: number;
  readonly l: number;
  readonly c: number;
};

type HtfTranscriptWire = {
  readonly m: 15 | 30 | 60;
  readonly ae: number;
  readonly ao: number;
  readonly cu: number;
  readonly rs: 60;
  readonly cs: number;
  readonly ce: number;
  readonly ec: number;
  readonly oc: number;
  readonly gp: boolean;
  readonly lo: boolean;
  readonly db: boolean;
  readonly cc: TranscriptCandleWire | null;
  readonly rc: TranscriptCandleWire | null;
  readonly sb: boolean;
};

type GraceBarWire = {
  readonly oe: number;
  readonly ce: number;
  readonly o: number;
  readonly h: number;
  readonly l: number;
  readonly c: number;
  readonly ak: "INITIAL";
};

type SetupFactsWire = {
  readonly zb: number;
  readonly zt: number;
  readonly ge: number | null;
  readonly iv: boolean;
  readonly cf: "EXACT" | "UNRESOLVED";
  readonly ak: "INITIAL";
  readonly et: true;
  readonly tr: SetupAttemptTerminalReason | null;
  readonly te: number | null;
  readonly b: readonly ConfirmedBarWire[];
  readonly x: readonly HtfTranscriptWire[];
  readonly ng: GraceBarWire | null;
};

type ProducerCandidateWire = {
  readonly i: number;
  readonly m: EntryModelV2;
  readonly st: CandidateState;
  readonly a: number;
  readonly o: number;
  readonly n: EntryModelV2 | null;
  readonly sc: readonly string[];
};

type ProducerEvidenceWire = {
  readonly i: number;
  readonly ci: number;
  readonly t: number | null;
  readonly px: number | null;
  readonly h: readonly (15 | 30 | 60)[];
  readonly f: CandidateFidelity;
  readonly p: ProofPlane;
  readonly r: number;
  readonly cs: number;
  readonly ce: number;
  readonly ac: readonly AmbiguityCode[];
  readonly pr: readonly string[];
  readonly fr: readonly string[];
  readonly sc: readonly string[];
};

type ProducerHandlingWire = {
  readonly ci: number;
  readonly ei: number;
  readonly m: HandlingMode;
  readonly a: "INITIAL";
  readonly t: number;
  readonly px: number | null;
  readonly f: CandidateFidelity;
  readonly sc: readonly string[];
};

type ProducerSelectionWire = {
  readonly v: "PINE_DIAGNOSTIC_ONLY";
  readonly k: string | null;
  readonly m: EntryModelV2 | null;
  readonly a: number | null;
  readonly o: number | null;
  readonly r: SelectionReason;
  readonly f: CandidateFidelity | null;
  readonly x: "SHADOW_ONLY" | "NONE";
} | null;

interface ParsedSetupBundle {
  readonly setupId: string;
  readonly direction: EntryDirection;
  readonly facts: SetupFactsWire;
  readonly candidates: readonly ProducerCandidateWire[];
  readonly evidence: readonly ProducerEvidenceWire[];
  readonly handling: readonly ProducerHandlingWire[];
  readonly selection: ProducerSelectionWire;
}

export interface ProducerCandidateReference {
  readonly model: EntryModelV2;
  readonly state: CandidateState;
  readonly event_anchor_epoch: number;
  readonly trigger_ordinal: number;
  readonly normalized_from: EntryModelV2 | null;
  readonly source_claim_ids: readonly string[];
}

export interface ProducerEvidenceReference {
  readonly candidate: ProducerCandidateReference;
  readonly observed_trigger_epoch: number | null;
  readonly observed_trigger_ticks: number | null;
  readonly htf_context_minutes: readonly (15 | 30 | 60)[];
  readonly fidelity: CandidateFidelity;
  readonly proof_plane: ProofPlane;
  readonly proof_resolution_seconds: number;
  readonly coverage_start_epoch: number;
  readonly coverage_end_epoch: number;
  readonly ambiguity_codes: readonly AmbiguityCode[];
  readonly passed_rule_ids: readonly string[];
  readonly failed_rule_ids: readonly string[];
  readonly source_claim_ids: readonly string[];
}

export interface ProducerHandlingReference {
  readonly candidate: ProducerCandidateReference;
  readonly evidence: ProducerEvidenceReference;
  readonly handling_mode: HandlingMode;
  readonly attempt_kind: "INITIAL";
  readonly observed_epoch: number;
  readonly observed_ticks: number | null;
  readonly fidelity: CandidateFidelity;
  readonly source_claim_ids: readonly string[];
}

export interface ProducerDiagnosticSelection {
  readonly version: "PINE_DIAGNOSTIC_ONLY";
  readonly semantic_key: string | null;
  readonly model: EntryModelV2 | null;
  readonly event_anchor_epoch: number | null;
  readonly trigger_ordinal: number | null;
  readonly reason: SelectionReason;
  readonly fidelity: CandidateFidelity | null;
  readonly action: "SHADOW_ONLY" | "NONE";
}

export interface ProducerDiagnostic {
  readonly candidates: readonly ProducerCandidateReference[];
  readonly evidence: readonly ProducerEvidenceReference[];
  readonly realtime_evidence: readonly ProducerEvidenceReference[];
  readonly handling: readonly ProducerHandlingReference[];
  readonly selection: ProducerDiagnosticSelection | null;
}

export interface EntryBatchSemanticIdentity {
  readonly producer_instance_id: string;
  readonly sequence: number;
  readonly kind: "snapshot" | "incremental";
  readonly bar_close_epoch: number;
}

export interface EntryBatchImmutableMetadata {
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
}

export interface ValidatedEntryWireBatch {
  readonly setupId: string;
  readonly retainedContext: readonly EntryMatchRequest[];
  readonly events: readonly EntryMatchRequest[];
  readonly producerDiagnostic: ProducerDiagnostic;
}

export interface ValidatedEntryV2Payload {
  readonly canonicalPayload: Readonly<Record<string, CanonicalValue>>;
  readonly metadata: ReceiptMetadata;
  readonly batchIdentity: EntryBatchSemanticIdentity;
  readonly batchMetadata: EntryBatchImmutableMetadata;
  readonly chunkIndex: number;
  readonly chunkCount: number;
  readonly entryBatches: readonly ValidatedEntryWireBatch[];
}

export const ENTRY_V2_MAX_MESSAGE_CHARACTERS = 35_000;
export const MAX_ENTRY_CHUNKS = 12;
export const MAX_ENTRY_SETUPS_PER_BATCH = 256;
export const MAX_ENTRY_BARS_PER_SETUP = 4;
export const MAX_ENTRY_HTF_TRANSCRIPTS_PER_SETUP = 3;
export const MAX_ENTRY_CANDIDATES_PER_SETUP = 4;
export const MAX_ENTRY_EVIDENCE_PER_CANDIDATE = 4;
export const MAX_ENTRY_EVIDENCE_PER_SETUP = 16;
export const MAX_ENTRY_HANDLING_PER_SETUP = 4;

const MAX_SAFE_INTEGER = 9_007_199_254_740_991;
const PINE_HTF_CONTEXT_MINUTES = [15, 30, 60] as const;
const WIRE_IDENTIFIER = /^[\x21-\x5b\x5d-\x7e]+$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const POSITIVE_DECIMAL =
  /^(?:0\.[0-9]*[1-9][0-9]*|[1-9][0-9]*(?:\.[0-9]+)?)$/u;
const ALL_ZERO_SHA256 = "0".repeat(64);
const TOP_LEVEL_KEYS = [
  "schema_version",
  "strategy_id",
  "strategy_version",
  "rule_contract_version",
  "execution_mode",
  "producer_instance_id",
  "sequence",
  "idempotency_key",
  "symbol",
  "ticker_id",
  "feed",
  "timeframe",
  "tick_size",
  "bar_open_epoch",
  "bar_close_epoch",
  "detector_code_hash",
  "settings_hash",
  "kind",
  "chunk_index",
  "chunk_count",
  "eb",
] as const;
const SETUP_BUNDLE_KEYS = ["s", "d", "f", "c", "e", "h", "q"] as const;
const SETUP_FACT_KEYS = [
  "zb",
  "zt",
  "ge",
  "iv",
  "cf",
  "ak",
  "et",
  "tr",
  "te",
  "ng",
  "b",
  "x",
] as const;
const CONFIRMED_BAR_KEYS = [
  "oe",
  "ce",
  "o",
  "h",
  "l",
  "c",
  "gb",
  "rr",
] as const;
const TRANSCRIPT_CANDLE_KEYS = ["oe", "ce", "o", "h", "l", "c"] as const;
const TRANSCRIPT_KEYS = [
  "m",
  "ae",
  "ao",
  "cu",
  "rs",
  "cs",
  "ce",
  "ec",
  "oc",
  "gp",
  "lo",
  "db",
  "cc",
  "rc",
  "sb",
] as const;
const GRACE_KEYS = ["oe", "ce", "o", "h", "l", "c", "ak"] as const;
const CANDIDATE_KEYS = ["i", "m", "st", "a", "o", "n", "sc"] as const;
const EVIDENCE_KEYS = [
  "i",
  "ci",
  "t",
  "px",
  "h",
  "f",
  "p",
  "r",
  "cs",
  "ce",
  "ac",
  "pr",
  "fr",
  "sc",
] as const;
const HANDLING_KEYS = ["ci", "ei", "m", "a", "t", "px", "f", "sc"] as const;
const SELECTION_KEYS = ["v", "k", "m", "a", "o", "r", "f", "x"] as const;
const ENTRY_MODELS = new Set<string>([
  "DIR_CLOSE",
  "HTF_FLIP",
  "LEGACY_BREAK_CANDLE",
  "LEGACY_REJECTION_RESPECT",
]);
const ACTIVE_MODELS = new Set<string>(["DIR_CLOSE", "HTF_FLIP"]);
const CANDIDATE_STATES = new Set<string>([
  "MATCHED",
  "BLOCKED",
  "REJECTED",
  "NORMALIZED",
]);
const FIDELITIES = new Set<string>([
  "EXACT",
  "CALIBRATED",
  "DISCRETIONARY",
  "UNRESOLVED",
]);
const PROOF_PLANES = new Set<string>([
  "CONFIRMED_5M",
  "LOWER_TIMEFRAME_REPLAY",
  "REALTIME_TICK",
  "EXTERNAL_ARCHIVED_TICK",
]);
const HANDLING_MODES = new Set<string>([
  "CLOSE_CONFIRMATION",
  "INTRABAR_FLIP",
  "NEXT_CANDLE_WICK",
  "AGGRESSIVE",
]);
const TERMINAL_REASONS = new Set<string>([
  "INVALIDATED",
  "BOTH_ACTIVE_MODELS_OBSERVED",
  "RETENTION_EVICTED",
]);
const SELECTION_REASONS = new Set<string>([
  "ONLY_EXACT_TRIGGER",
  "EARLIEST_EXACT_TRIGGER",
  "FALLBACK_TO_CONFIRMED_CLOSE",
  "NO_EXACT_CANDIDATE",
  "UNRESOLVED_SOURCE_PRIORITY",
  "SETUP_INVALIDATED",
  "NO_CANDIDATE",
]);
const AMBIGUITY_CODES = new Set<string>([
  "SHADOW_SAME_CHILD_BAR_ORDER",
  "SHADOW_MISSING_INTRABAR_COVERAGE",
  "SHADOW_REALTIME_ONLY_NOT_REPLAYABLE",
]);
const RULE_IDS = new Set<string>([
  "ENTRY_DIR_CLOSE",
  "ENTRY_BREAK_CANDLE_NORMALIZATION",
  "ENTRY_REJECTION_RESPECT_DISABLED",
  "ENTRY_HTF_FLIP",
  "ENTRY_HTF_ZONE_SIDE_FIRST",
]);
const SOURCE_CLAIM_IDS = new Set(
  SOURCE_CLAIM_CATALOG.map((item) => item.claim_id),
);

export class EntryV2ValidationError extends Error {
  constructor(message = "ENTRY_V2_INVALID") {
    super(message);
    this.name = "EntryV2ValidationError";
  }
}

export class EntryV2MessageTooLargeError extends EntryV2ValidationError {
  readonly status = 413;
  readonly code = "ENTRY_V2_MESSAGE_TOO_LARGE";

  constructor() {
    super("ENTRY_V2_MESSAGE_TOO_LARGE");
    this.name = "EntryV2MessageTooLargeError";
  }
}

function fail(code = "ENTRY_V2_INVALID"): never {
  throw new EntryV2ValidationError(code);
}

function asObject(value: StrictJsonValue, code = "ENTRY_V2_OBJECT"): StrictObject {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    isStrictJsonNumber(value)
  ) {
    return fail(code);
  }
  return value;
}

function field(
  object: StrictObject,
  key: string,
  code = "ENTRY_V2_MISSING_FIELD",
): StrictJsonValue {
  if (!Object.prototype.hasOwnProperty.call(object, key)) {
    return fail(code);
  }
  const value = object[key];
  return value === undefined ? fail(code) : value;
}

function exactKeys(
  object: StrictObject,
  keys: readonly string[],
  code = "ENTRY_V2_UNKNOWN_FIELD",
): void {
  const actual = Object.keys(object);
  const allowed = new Set(keys);
  if (
    actual.length !== keys.length ||
    actual.some((key) => !allowed.has(key)) ||
    keys.some((key) => !Object.prototype.hasOwnProperty.call(object, key))
  ) {
    fail(code);
  }
}

function asArray(
  value: StrictJsonValue,
  minimum: number,
  maximum: number,
  code = "ENTRY_V2_ARRAY_BOUND",
): StrictJsonValue[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    return fail(code);
  }
  return value;
}

function safeInteger(
  value: StrictJsonValue,
  minimum = 0,
  maximum = MAX_SAFE_INTEGER,
  code = "ENTRY_V2_SAFE_INTEGER",
): number {
  if (
    !isStrictJsonNumber(value) ||
    !value.isIntegerToken ||
    !Number.isSafeInteger(value.value) ||
    value.value < minimum ||
    value.value > maximum
  ) {
    return fail(code);
  }
  return value.value;
}

function nullableSafeInteger(
  value: StrictJsonValue,
  minimum = 0,
  maximum = MAX_SAFE_INTEGER,
  code = "ENTRY_V2_SAFE_INTEGER",
): number | null {
  return value === null ? null : safeInteger(value, minimum, maximum, code);
}

function asString(
  value: StrictJsonValue,
  minimum = 1,
  maximum = 256,
  code = "ENTRY_V2_STRING",
): string {
  if (
    typeof value !== "string" ||
    value.length < minimum ||
    value.length > maximum ||
    value.trim() !== value
  ) {
    return fail(code);
  }
  return value;
}

function wireIdentifier(value: StrictJsonValue, code = "ENTRY_V2_IDENTIFIER"): string {
  const text = asString(value, 1, 256, code);
  return WIRE_IDENTIFIER.test(text) ? text : fail(code);
}

function sha256(value: StrictJsonValue, code = "ENTRY_V2_SHA256"): string {
  const text = asString(value, 64, 64, code);
  return SHA256.test(text) && text !== ALL_ZERO_SHA256 ? text : fail(code);
}

function literal<const Value extends string | boolean>(
  value: StrictJsonValue,
  expected: Value,
  code = "ENTRY_V2_LITERAL",
): Value {
  return value === expected ? expected : fail(code);
}

function closedEnum<const Value extends string>(
  value: StrictJsonValue,
  allowed: ReadonlySet<string>,
  code: string,
): Value {
  return typeof value === "string" && allowed.has(value)
    ? (value as Value)
    : fail(code);
}

function asBoolean(value: StrictJsonValue, code = "ENTRY_V2_BOOLEAN"): boolean {
  return typeof value === "boolean" ? value : fail(code);
}

function uniqueClosedStrings(
  value: StrictJsonValue,
  maximum: number,
  allowed: ReadonlySet<string> | null,
  code: string,
): readonly string[] {
  const values = asArray(value, 0, maximum, code).map((item) =>
    wireIdentifier(item, code)
  );
  if (
    new Set(values).size !== values.length ||
    (allowed !== null && values.some((item) => !allowed.has(item)))
  ) {
    fail(code);
  }
  return values;
}

function sameValues<Value>(
  actual: readonly Value[],
  expected: readonly Value[],
): boolean {
  return (
    actual.length === expected.length &&
    actual.every((item, index) => item === expected[index])
  );
}

function uniqueValues<const Value extends string | number>(
  values: readonly Value[],
  code: string,
): readonly Value[] {
  if (new Set(values).size !== values.length) {
    fail(code);
  }
  return values;
}

export function validateEntryV2BodySize(body: Uint8Array): void {
  let text: string;
  try {
    text = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: false,
    }).decode(body);
  } catch {
    fail("ENTRY_V2_INVALID_UTF8");
  }
  if (text.length >= ENTRY_V2_MAX_MESSAGE_CHARACTERS) {
    throw new EntryV2MessageTooLargeError();
  }
}

function validateOhlc(
  open: number,
  high: number,
  low: number,
  close: number,
  code: string,
): void {
  if (
    high < Math.max(open, close, low) ||
    low > Math.min(open, close, high)
  ) {
    fail(code);
  }
}

function parseOrderedCandle(
  value: StrictJsonValue,
  keys: readonly string[],
  expectedDuration: number | null,
  code: string,
): OrderedCandle {
  const object = asObject(value, code);
  exactKeys(object, keys, code);
  const openEpoch = safeInteger(field(object, "oe", code), 0, MAX_SAFE_INTEGER, code);
  const closeEpoch = safeInteger(field(object, "ce", code), 0, MAX_SAFE_INTEGER, code);
  const openTicks = safeInteger(
    field(object, "o", code),
    -MAX_SAFE_INTEGER,
    MAX_SAFE_INTEGER,
    code,
  );
  const highTicks = safeInteger(
    field(object, "h", code),
    -MAX_SAFE_INTEGER,
    MAX_SAFE_INTEGER,
    code,
  );
  const lowTicks = safeInteger(
    field(object, "l", code),
    -MAX_SAFE_INTEGER,
    MAX_SAFE_INTEGER,
    code,
  );
  const closeTicks = safeInteger(
    field(object, "c", code),
    -MAX_SAFE_INTEGER,
    MAX_SAFE_INTEGER,
    code,
  );
  if (
    closeEpoch <= openEpoch ||
    (expectedDuration !== null && closeEpoch - openEpoch !== expectedDuration)
  ) {
    fail(code);
  }
  validateOhlc(openTicks, highTicks, lowTicks, closeTicks, code);
  return {
    open_epoch: openEpoch,
    close_epoch: closeEpoch,
    open_ticks: openTicks,
    high_ticks: highTicks,
    low_ticks: lowTicks,
    close_ticks: closeTicks,
  };
}

function parseConfirmedBar(value: StrictJsonValue): ConfirmedBarWire {
  const object = asObject(value, "ENTRY_CONFIRMED_BAR");
  const candle = parseOrderedCandle(
    value,
    CONFIRMED_BAR_KEYS,
    300,
    "ENTRY_CONFIRMED_BAR",
  );
  return {
    oe: candle.open_epoch,
    ce: candle.close_epoch,
    o: candle.open_ticks,
    h: candle.high_ticks,
    l: candle.low_ticks,
    c: candle.close_ticks,
    gb: asBoolean(field(object, "gb"), "ENTRY_CONFIRMED_BAR"),
    rr: asBoolean(field(object, "rr"), "ENTRY_CONFIRMED_BAR"),
  };
}

function confirmedBarCandle(value: ConfirmedBarWire): OrderedCandle {
  return {
    open_epoch: value.oe,
    close_epoch: value.ce,
    open_ticks: value.o,
    high_ticks: value.h,
    low_ticks: value.l,
    close_ticks: value.c,
  };
}

function parseTranscriptCandle(
  value: StrictJsonValue,
): TranscriptCandleWire {
  const candle = parseOrderedCandle(
    value,
    TRANSCRIPT_CANDLE_KEYS,
    60,
    "ENTRY_HTF_CANDLE",
  );
  return {
    oe: candle.open_epoch,
    ce: candle.close_epoch,
    o: candle.open_ticks,
    h: candle.high_ticks,
    l: candle.low_ticks,
    c: candle.close_ticks,
  };
}

function transcriptCandle(value: TranscriptCandleWire): OrderedCandle {
  return {
    open_epoch: value.oe,
    close_epoch: value.ce,
    open_ticks: value.o,
    high_ticks: value.h,
    low_ticks: value.l,
    close_ticks: value.c,
  };
}

function parseTranscript(value: StrictJsonValue): HtfTranscriptWire {
  const object = asObject(value, "ENTRY_HTF_TRANSCRIPT");
  exactKeys(object, TRANSCRIPT_KEYS, "ENTRY_HTF_TRANSCRIPT");
  const context = safeInteger(
    field(object, "m"),
    15,
    60,
    "ENTRY_HTF_CONTEXT",
  );
  if (!PINE_HTF_CONTEXT_MINUTES.includes(context as 15 | 30 | 60)) {
    fail("ENTRY_HTF_CONTEXT");
  }
  const htfOpenEpoch = safeInteger(
    field(object, "ae"),
    0,
    MAX_SAFE_INTEGER,
    "ENTRY_HTF_EPOCH",
  );
  const htfOpenTicks = safeInteger(
    field(object, "ao"),
    -MAX_SAFE_INTEGER,
    MAX_SAFE_INTEGER,
    "ENTRY_HTF_TICKS",
  );
  const cutoffEpoch = safeInteger(
    field(object, "cu"),
    0,
    MAX_SAFE_INTEGER,
    "ENTRY_HTF_EPOCH",
  );
  const resolution = safeInteger(
    field(object, "rs"),
    60,
    60,
    "ENTRY_HTF_PROOF_RESOLUTION",
  );
  const coverageStart = safeInteger(
    field(object, "cs"),
    0,
    MAX_SAFE_INTEGER,
    "ENTRY_HTF_COVERAGE",
  );
  const coverageEnd = safeInteger(
    field(object, "ce"),
    0,
    MAX_SAFE_INTEGER,
    "ENTRY_HTF_COVERAGE",
  );
  if (coverageEnd !== cutoffEpoch) {
    fail("HTF_TRANSCRIPT_COVERAGE_CUTOFF_MISMATCH");
  }
  if (coverageStart !== htfOpenEpoch) {
    fail("ENTRY_HTF_COVERAGE_START");
  }
  const coverageSeconds = cutoffEpoch - htfOpenEpoch;
  if (
    coverageSeconds <= 0 ||
    coverageSeconds > context * 60 ||
    coverageSeconds % resolution !== 0 ||
    cutoffEpoch % resolution !== 0 ||
    coverageStart % resolution !== 0
  ) {
    fail("ENTRY_HTF_COVERAGE");
  }
  const expectedCount = safeInteger(
    field(object, "ec"),
    0,
    MAX_SAFE_INTEGER,
    "ENTRY_HTF_EXPECTED_COUNT",
  );
  const observedCount = safeInteger(
    field(object, "oc"),
    0,
    MAX_SAFE_INTEGER,
    "ENTRY_HTF_OBSERVED_COUNT",
  );
  const gapPresent = asBoolean(
    field(object, "gp"),
    "ENTRY_HTF_COVERAGE_GAP",
  );
  if (
    expectedCount !== coverageSeconds / resolution ||
    observedCount > expectedCount ||
    gapPresent !== (observedCount !== expectedCount)
  ) {
    fail("ENTRY_HTF_COVERAGE_GAP");
  }
  const contactValue = field(object, "cc");
  const recrossValue = field(object, "rc");
  const contact = contactValue === null ? null : parseTranscriptCandle(contactValue);
  const recross = recrossValue === null ? null : parseTranscriptCandle(recrossValue);
  const sameChild = asBoolean(field(object, "sb"), "ENTRY_HTF_SAME_CHILD");
  const sameInterval =
    contact !== null &&
    recross !== null &&
    contact.oe === recross.oe &&
    contact.ce === recross.ce;
  if (sameChild !== sameInterval) {
    fail("ENTRY_HTF_SAME_CHILD");
  }
  if (
    sameChild &&
    contact !== null &&
    recross !== null &&
    (contact.o !== recross.o ||
      contact.h !== recross.h ||
      contact.l !== recross.l ||
      contact.c !== recross.c)
  ) {
    fail("ENTRY_HTF_SAME_CHILD");
  }
  if (
    contact !== null &&
    (contact.oe < coverageStart ||
      contact.ce > coverageEnd ||
      (contact.oe - coverageStart) % resolution !== 0)
  ) {
    fail("ENTRY_HTF_CANDLE_COVERAGE");
  }
  if (
    recross !== null &&
    (recross.oe < coverageStart ||
      recross.ce > coverageEnd ||
      (recross.oe - coverageStart) % resolution !== 0)
  ) {
    fail("ENTRY_HTF_CANDLE_COVERAGE");
  }
  if (
    contact !== null &&
    recross !== null &&
    !sameChild &&
    contact.ce > recross.oe
  ) {
    fail("ENTRY_HTF_CANDLE_ORDER");
  }
  return {
    m: context as 15 | 30 | 60,
    ae: htfOpenEpoch,
    ao: htfOpenTicks,
    cu: cutoffEpoch,
    rs: resolution as 60,
    cs: coverageStart,
    ce: coverageEnd,
    ec: expectedCount,
    oc: observedCount,
    gp: gapPresent,
    lo: asBoolean(field(object, "lo"), "ENTRY_HTF_ORDER"),
    db: asBoolean(field(object, "db"), "ENTRY_HTF_DESTINATION_ORDER"),
    cc: contact,
    rc: recross,
    sb: sameChild,
  };
}

function htfTranscript(value: HtfTranscriptWire): HTFFlipProofTranscript {
  return {
    context_minutes: value.m,
    htf_open_epoch: value.ae,
    htf_open_ticks: value.ao,
    scan_cutoff_epoch: value.cu,
    proof_resolution_seconds: value.rs,
    coverage_start_epoch: value.cs,
    coverage_end_epoch: value.ce,
    expected_child_count: value.ec,
    observed_child_count: value.oc,
    gap_present: value.gp,
    full_lifecycle_ordered: value.lo,
    destination_seen_before_contact: value.db,
    contact_candle: value.cc === null ? null : transcriptCandle(value.cc),
    recross_candle: value.rc === null ? null : transcriptCandle(value.rc),
    same_child: value.sb,
  };
}

async function expandTranscript(
  setup: SetupEntryFacts,
  value: HtfTranscriptWire,
): Promise<HTFFlipProof> {
  try {
    return await validateHtfFlipProof(setup, htfTranscript(value));
  } catch (error) {
    if (error instanceof EntryV2ValidationError) throw error;
    fail(
      error instanceof Error && error.message.length > 0
        ? `ENTRY_HTF_TRANSCRIPT:${error.message}`
        : "ENTRY_HTF_TRANSCRIPT",
    );
  }
}

function parseGrace(value: StrictJsonValue): GraceBarWire {
  const object = asObject(value, "ENTRY_GRACE_BAR");
  const candle = parseOrderedCandle(
    value,
    GRACE_KEYS,
    300,
    "ENTRY_GRACE_BAR",
  );
  return {
    oe: candle.open_epoch,
    ce: candle.close_epoch,
    o: candle.open_ticks,
    h: candle.high_ticks,
    l: candle.low_ticks,
    c: candle.close_ticks,
    ak: literal(field(object, "ak"), "INITIAL", "ENTRY_GRACE_ATTEMPT"),
  };
}

function sourceClaimsForModel(model: EntryModelV2): readonly string[] {
  switch (model) {
    case "DIR_CLOSE":
      return SOURCE_CLAIMS.DIR_CLOSE;
    case "HTF_FLIP":
      return SOURCE_CLAIMS.HTF_FLIP;
    case "LEGACY_BREAK_CANDLE":
      return SOURCE_CLAIMS.LEGACY_BREAK_CANDLE;
    case "LEGACY_REJECTION_RESPECT":
      return SOURCE_CLAIMS.LEGACY_REJECTION_RESPECT;
  }
}

function parseSourceClaims(
  value: StrictJsonValue,
  code: string,
): readonly string[] {
  return uniqueClosedStrings(
    value,
    SOURCE_CLAIM_IDS.size,
    SOURCE_CLAIM_IDS,
    code,
  );
}

function parseCandidate(value: StrictJsonValue): ProducerCandidateWire {
  const object = asObject(value, "ENTRY_DIAGNOSTIC_CANDIDATE");
  exactKeys(object, CANDIDATE_KEYS, "ENTRY_DIAGNOSTIC_CANDIDATE");
  const model = closedEnum<EntryModelV2>(
    field(object, "m"),
    ENTRY_MODELS,
    "ENTRY_DIAGNOSTIC_MODEL",
  );
  const state = closedEnum<CandidateState>(
    field(object, "st"),
    CANDIDATE_STATES,
    "ENTRY_DIAGNOSTIC_STATE",
  );
  const normalizedValue = field(object, "n");
  const normalizedFrom =
    normalizedValue === null
      ? null
      : closedEnum<EntryModelV2>(
          normalizedValue,
          ENTRY_MODELS,
          "ENTRY_DIAGNOSTIC_NORMALIZED_FROM",
        );
  if (
    (state === "NORMALIZED") !== (normalizedFrom !== null) ||
    (normalizedFrom !== null &&
      (model !== "HTF_FLIP" || normalizedFrom !== "LEGACY_BREAK_CANDLE"))
  ) {
    fail("ENTRY_DIAGNOSTIC_NORMALIZATION");
  }
  const ordinal = safeInteger(
    field(object, "o"),
    1,
    1,
    "ENTRY_DIAGNOSTIC_ORDINAL",
  );
  const sourceClaims = parseSourceClaims(
    field(object, "sc"),
    "ENTRY_DIAGNOSTIC_SOURCE_CLAIMS",
  );
  if (!sameValues(sourceClaims, sourceClaimsForModel(model))) {
    fail("ENTRY_DIAGNOSTIC_SOURCE_CLAIMS");
  }
  return {
    i: safeInteger(
      field(object, "i"),
      0,
      MAX_ENTRY_CANDIDATES_PER_SETUP - 1,
      "ENTRY_DIAGNOSTIC_CANDIDATE_INDEX",
    ),
    m: model,
    st: state,
    a: safeInteger(
      field(object, "a"),
      0,
      MAX_SAFE_INTEGER,
      "ENTRY_DIAGNOSTIC_ANCHOR",
    ),
    o: ordinal,
    n: normalizedFrom,
    sc: sourceClaims,
  };
}

function parseContexts(
  value: StrictJsonValue,
): readonly (15 | 30 | 60)[] {
  const contexts = asArray(
    value,
    0,
    MAX_ENTRY_HTF_TRANSCRIPTS_PER_SETUP,
    "ENTRY_DIAGNOSTIC_CONTEXT",
  ).map((item) =>
    safeInteger(item, 15, 60, "ENTRY_DIAGNOSTIC_CONTEXT")
  );
  if (
    contexts.some(
      (item) => !PINE_HTF_CONTEXT_MINUTES.includes(item as 15 | 30 | 60),
    ) ||
    contexts.some(
      (item, index) => index > 0 && item <= contexts[index - 1]!,
    )
  ) {
    fail("ENTRY_DIAGNOSTIC_CONTEXT");
  }
  return uniqueValues(
    contexts as (15 | 30 | 60)[],
    "ENTRY_DIAGNOSTIC_CONTEXT",
  );
}

function expectedConfirmedRule(model: EntryModelV2): string {
  switch (model) {
    case "DIR_CLOSE":
      return "ENTRY_DIR_CLOSE";
    case "LEGACY_BREAK_CANDLE":
      return "ENTRY_BREAK_CANDLE_NORMALIZATION";
    case "LEGACY_REJECTION_RESPECT":
      return "ENTRY_REJECTION_RESPECT_DISABLED";
    case "HTF_FLIP":
      return fail("ENTRY_DIAGNOSTIC_CONFIRMED_MODEL");
  }
}

function validHtfSourceClaims(
  values: readonly string[],
  candidate: ProducerCandidateWire,
): boolean {
  const required = [
    ...SOURCE_CLAIMS.HTF_FLIP,
    ...(candidate.n === "LEGACY_BREAK_CANDLE"
      ? SOURCE_CLAIMS.LEGACY_BREAK_CANDLE
      : []),
  ];
  const allowed = new Set<string>([
    ...required,
    ...SOURCE_CLAIMS.HTF_BOUNDARY,
  ]);
  return (
    required.every((item) => values.includes(item)) &&
    values.every((item) => allowed.has(item))
  );
}

function parseEvidence(
  value: StrictJsonValue,
  candidates: readonly ProducerCandidateWire[],
): ProducerEvidenceWire {
  const object = asObject(value, "ENTRY_DIAGNOSTIC_EVIDENCE");
  exactKeys(object, EVIDENCE_KEYS, "ENTRY_DIAGNOSTIC_EVIDENCE");
  const candidateIndex = safeInteger(
    field(object, "ci"),
    0,
    MAX_ENTRY_CANDIDATES_PER_SETUP - 1,
    "ENTRY_DIAGNOSTIC_CANDIDATE_REFERENCE",
  );
  const candidate = candidates[candidateIndex];
  if (candidate === undefined) {
    fail("ENTRY_DIAGNOSTIC_CANDIDATE_REFERENCE");
  }
  const triggerEpoch = nullableSafeInteger(
    field(object, "t"),
    0,
    MAX_SAFE_INTEGER,
    "ENTRY_DIAGNOSTIC_TRIGGER",
  );
  const triggerTicks = nullableSafeInteger(
    field(object, "px"),
    -MAX_SAFE_INTEGER,
    MAX_SAFE_INTEGER,
    "ENTRY_DIAGNOSTIC_TRIGGER",
  );
  if ((triggerEpoch === null) !== (triggerTicks === null)) {
    fail("ENTRY_DIAGNOSTIC_TRIGGER");
  }
  const contexts = parseContexts(field(object, "h"));
  const fidelity = closedEnum<CandidateFidelity>(
    field(object, "f"),
    FIDELITIES,
    "ENTRY_DIAGNOSTIC_FIDELITY",
  );
  const proofPlane = closedEnum<ProofPlane>(
    field(object, "p"),
    PROOF_PLANES,
    "ENTRY_DIAGNOSTIC_PROOF_PLANE",
  );
  if (proofPlane === "EXTERNAL_ARCHIVED_TICK") {
    fail("ENTRY_DIAGNOSTIC_PROOF_PLANE");
  }
  const resolution = safeInteger(
    field(object, "r"),
    0,
    300,
    "ENTRY_DIAGNOSTIC_RESOLUTION",
  );
  const coverageStart = safeInteger(
    field(object, "cs"),
    0,
    MAX_SAFE_INTEGER,
    "ENTRY_DIAGNOSTIC_COVERAGE",
  );
  const coverageEnd = safeInteger(
    field(object, "ce"),
    0,
    MAX_SAFE_INTEGER,
    "ENTRY_DIAGNOSTIC_COVERAGE",
  );
  const ambiguityCodes = uniqueClosedStrings(
    field(object, "ac"),
    AMBIGUITY_CODES.size,
    AMBIGUITY_CODES,
    "ENTRY_DIAGNOSTIC_AMBIGUITY",
  ) as readonly AmbiguityCode[];
  const passedRules = uniqueClosedStrings(
    field(object, "pr"),
    RULE_IDS.size,
    RULE_IDS,
    "ENTRY_DIAGNOSTIC_RULES",
  );
  const failedRules = uniqueClosedStrings(
    field(object, "fr"),
    RULE_IDS.size,
    RULE_IDS,
    "ENTRY_DIAGNOSTIC_RULES",
  );
  if (passedRules.some((item) => failedRules.includes(item))) {
    fail("ENTRY_DIAGNOSTIC_RULES");
  }
  const sourceClaims = parseSourceClaims(
    field(object, "sc"),
    "ENTRY_DIAGNOSTIC_SOURCE_CLAIMS",
  );

  if (proofPlane === "REALTIME_TICK") {
    if (
      triggerEpoch === null ||
      triggerTicks === null ||
      fidelity !== "UNRESOLVED" ||
      resolution !== 0 ||
      coverageStart !== triggerEpoch ||
      coverageEnd !== triggerEpoch ||
      !sameValues(ambiguityCodes, [
        "SHADOW_REALTIME_ONLY_NOT_REPLAYABLE",
      ]) ||
      contexts.length !== 0 ||
      !sameValues(sourceClaims, sourceClaimsForModel(candidate.m))
    ) {
      fail("ENTRY_REALTIME_EVIDENCE");
    }
  } else {
    if (
      resolution === 0 ||
      coverageEnd <= coverageStart ||
      (triggerEpoch !== null &&
        (triggerEpoch < coverageStart || triggerEpoch > coverageEnd)) ||
      ambiguityCodes.includes("SHADOW_REALTIME_ONLY_NOT_REPLAYABLE")
    ) {
      fail("ENTRY_DIAGNOSTIC_COVERAGE");
    }
    if (proofPlane === "CONFIRMED_5M") {
      const rule = expectedConfirmedRule(candidate.m);
      const active = candidate.m === "DIR_CLOSE";
      if (
        resolution !== 300 ||
        coverageEnd - coverageStart !== 300 ||
        contexts.length !== 0 ||
        ambiguityCodes.length !== 0 ||
        !sameValues(sourceClaims, sourceClaimsForModel(candidate.m)) ||
        !sameValues(passedRules, active ? [rule] : []) ||
        !sameValues(failedRules, active ? [] : [rule])
      ) {
        fail("ENTRY_DIAGNOSTIC_CONFIRMED_EVIDENCE");
      }
    } else if (
      candidate.m !== "HTF_FLIP" ||
      resolution !== 60 ||
      contexts.length === 0 ||
      !validHtfSourceClaims(sourceClaims, candidate) ||
      !(
        (sameValues(passedRules, ["ENTRY_HTF_FLIP"]) &&
          failedRules.every((item) => item === "ENTRY_HTF_ZONE_SIDE_FIRST")) ||
        (passedRules.length === 0 &&
          failedRules.includes("ENTRY_HTF_FLIP") &&
          failedRules.every(
            (item) =>
              item === "ENTRY_HTF_FLIP" ||
              item === "ENTRY_HTF_ZONE_SIDE_FIRST",
          ))
      )
    ) {
      fail("ENTRY_DIAGNOSTIC_HTF_EVIDENCE");
    }
  }

  return {
    i: safeInteger(
      field(object, "i"),
      0,
      MAX_ENTRY_EVIDENCE_PER_SETUP - 1,
      "ENTRY_DIAGNOSTIC_EVIDENCE_INDEX",
    ),
    ci: candidateIndex,
    t: triggerEpoch,
    px: triggerTicks,
    h: contexts,
    f: fidelity,
    p: proofPlane,
    r: resolution,
    cs: coverageStart,
    ce: coverageEnd,
    ac: ambiguityCodes,
    pr: passedRules,
    fr: failedRules,
    sc: sourceClaims,
  };
}

function expectedHandlingClaims(
  mode: HandlingMode,
  candidate: ProducerCandidateWire,
): readonly string[] {
  switch (mode) {
    case "CLOSE_CONFIRMATION":
    case "AGGRESSIVE":
      return sourceClaimsForModel(candidate.m);
    case "INTRABAR_FLIP":
      return SOURCE_CLAIMS.HTF_FLIP;
    case "NEXT_CANDLE_WICK":
      return SOURCE_CLAIMS.NEXT_CANDLE_WICK;
  }
}

function parseHandling(
  value: StrictJsonValue,
  candidates: readonly ProducerCandidateWire[],
  evidence: readonly ProducerEvidenceWire[],
): ProducerHandlingWire {
  const object = asObject(value, "ENTRY_DIAGNOSTIC_HANDLING");
  exactKeys(object, HANDLING_KEYS, "ENTRY_DIAGNOSTIC_HANDLING");
  const candidateIndex = safeInteger(
    field(object, "ci"),
    0,
    MAX_ENTRY_CANDIDATES_PER_SETUP - 1,
    "ENTRY_DIAGNOSTIC_CANDIDATE_REFERENCE",
  );
  const evidenceIndex = safeInteger(
    field(object, "ei"),
    0,
    MAX_ENTRY_EVIDENCE_PER_SETUP - 1,
    "ENTRY_DIAGNOSTIC_EVIDENCE_REFERENCE",
  );
  const candidate = candidates[candidateIndex];
  const evidenceRow = evidence[evidenceIndex];
  if (
    candidate === undefined ||
    evidenceRow === undefined ||
    evidenceRow.ci !== candidateIndex
  ) {
    fail("ENTRY_DIAGNOSTIC_REFERENCE");
  }
  if (evidenceRow.p === "REALTIME_TICK") {
    fail("ENTRY_REALTIME_HANDLING_REFERENCE");
  }
  const mode = closedEnum<HandlingMode>(
    field(object, "m"),
    HANDLING_MODES,
    "ENTRY_DIAGNOSTIC_HANDLING_MODE",
  );
  const sourceClaims = parseSourceClaims(
    field(object, "sc"),
    "ENTRY_DIAGNOSTIC_SOURCE_CLAIMS",
  );
  if (!sameValues(sourceClaims, expectedHandlingClaims(mode, candidate))) {
    fail("ENTRY_DIAGNOSTIC_SOURCE_CLAIMS");
  }
  if (
    (mode === "INTRABAR_FLIP" && candidate.m !== "HTF_FLIP") ||
    (mode === "NEXT_CANDLE_WICK" && candidate.m !== "DIR_CLOSE")
  ) {
    fail("ENTRY_DIAGNOSTIC_HANDLING_MODE");
  }
  return {
    ci: candidateIndex,
    ei: evidenceIndex,
    m: mode,
    a: literal(
      field(object, "a"),
      "INITIAL",
      "ENTRY_DIAGNOSTIC_ATTEMPT",
    ),
    t: safeInteger(
      field(object, "t"),
      0,
      MAX_SAFE_INTEGER,
      "ENTRY_DIAGNOSTIC_HANDLING_EPOCH",
    ),
    px: nullableSafeInteger(
      field(object, "px"),
      -MAX_SAFE_INTEGER,
      MAX_SAFE_INTEGER,
      "ENTRY_DIAGNOSTIC_HANDLING_TICKS",
    ),
    f: closedEnum<CandidateFidelity>(
      field(object, "f"),
      FIDELITIES,
      "ENTRY_DIAGNOSTIC_FIDELITY",
    ),
    sc: sourceClaims,
  };
}

function parseSelection(
  value: StrictJsonValue,
  candidates: readonly ProducerCandidateWire[],
  evidence: readonly ProducerEvidenceWire[],
): ProducerSelectionWire {
  if (value === null) return null;
  const object = asObject(value, "ENTRY_DIAGNOSTIC_SELECTION");
  exactKeys(object, SELECTION_KEYS, "ENTRY_DIAGNOSTIC_SELECTION");
  const action = closedEnum<"SHADOW_ONLY" | "NONE">(
    field(object, "x"),
    new Set(["SHADOW_ONLY", "NONE"]),
    "ENTRY_DIAGNOSTIC_SELECTION_ACTION",
  );
  const reason = closedEnum<SelectionReason>(
    field(object, "r"),
    SELECTION_REASONS,
    "ENTRY_DIAGNOSTIC_SELECTION_REASON",
  );
  const keyValue = field(object, "k");
  const modelValue = field(object, "m");
  const anchorValue = field(object, "a");
  const ordinalValue = field(object, "o");
  const fidelityValue = field(object, "f");
  if (action === "NONE") {
    if (
      keyValue !== null ||
      modelValue !== null ||
      anchorValue !== null ||
      ordinalValue !== null ||
      fidelityValue !== null
    ) {
      fail("ENTRY_DIAGNOSTIC_SELECTION_NULLABILITY");
    }
    return {
      v: literal(
        field(object, "v"),
        "PINE_DIAGNOSTIC_ONLY",
        "ENTRY_DIAGNOSTIC_SELECTION_VERSION",
      ),
      k: null,
      m: null,
      a: null,
      o: null,
      r: reason,
      f: null,
      x: "NONE",
    };
  }

  const key = wireIdentifier(keyValue, "ENTRY_DIAGNOSTIC_SELECTION_KEY");
  const model = closedEnum<EntryModelV2>(
    modelValue,
    ENTRY_MODELS,
    "ENTRY_DIAGNOSTIC_SELECTION_MODEL",
  );
  const anchor = safeInteger(
    anchorValue,
    0,
    MAX_SAFE_INTEGER,
    "ENTRY_DIAGNOSTIC_SELECTION_ANCHOR",
  );
  const ordinal = safeInteger(
    ordinalValue,
    1,
    1,
    "ENTRY_DIAGNOSTIC_ORDINAL",
  );
  const fidelity = closedEnum<CandidateFidelity>(
    fidelityValue,
    FIDELITIES,
    "ENTRY_DIAGNOSTIC_FIDELITY",
  );
  if (key !== `${model}:${anchor}:${ordinal}`) {
    fail("ENTRY_DIAGNOSTIC_SELECTION_KEY");
  }
  const candidateIndex = candidates.findIndex(
    (candidate) =>
      candidate.m === model &&
      candidate.a === anchor &&
      candidate.o === ordinal,
  );
  if (candidateIndex === -1) {
    fail("ENTRY_DIAGNOSTIC_SELECTION_REFERENCE");
  }
  const candidateEvidence = evidence.filter(
    (item) => item.ci === candidateIndex,
  );
  if (
    candidateEvidence.length === 0 ||
    candidateEvidence.every((item) => item.p === "REALTIME_TICK")
  ) {
    fail("ENTRY_REALTIME_SELECTION_REFERENCE");
  }
  if (
    !candidateEvidence.some(
      (item) => item.p !== "REALTIME_TICK" && item.f === fidelity,
    )
  ) {
    fail("ENTRY_DIAGNOSTIC_SELECTION_FIDELITY");
  }
  return {
    v: literal(
      field(object, "v"),
      "PINE_DIAGNOSTIC_ONLY",
      "ENTRY_DIAGNOSTIC_SELECTION_VERSION",
    ),
    k: key,
    m: model,
    a: anchor,
    o: ordinal,
    r: reason,
    f: fidelity,
    x: action,
  };
}

function parseDiagnosticBundle(
  object: StrictObject,
): Pick<ParsedSetupBundle, "candidates" | "evidence" | "handling" | "selection"> {
  const candidateValues = asArray(
    field(object, "c"),
    0,
    MAX_ENTRY_CANDIDATES_PER_SETUP,
    "ENTRY_DIAGNOSTIC_CANDIDATE_LIMIT",
  );
  const candidates = candidateValues.map(parseCandidate);
  if (
    candidates.some((candidate, index) => candidate.i !== index) ||
    new Set(
      candidates.map(
        (candidate) => `${candidate.m}:${candidate.a}:${candidate.o}`,
      ),
    ).size !== candidates.length
  ) {
    fail("ENTRY_DIAGNOSTIC_CANDIDATE_INDEX");
  }

  const evidenceValues = asArray(
    field(object, "e"),
    0,
    MAX_ENTRY_EVIDENCE_PER_SETUP,
    "ENTRY_DIAGNOSTIC_EVIDENCE_LIMIT",
  );
  const evidence = evidenceValues.map((item) =>
    parseEvidence(item, candidates)
  );
  const evidenceSemanticKeys = evidence.map((item) =>
    JSON.stringify([
      item.ci,
      item.t,
      item.px,
      item.h,
      item.f,
      item.p,
      item.r,
      item.cs,
      item.ce,
      item.ac,
      item.pr,
      item.fr,
      item.sc,
    ])
  );
  if (
    evidence.some((item, index) => item.i !== index) ||
    new Set(evidenceSemanticKeys).size !== evidenceSemanticKeys.length
  ) {
    fail("ENTRY_DIAGNOSTIC_EVIDENCE_INDEX");
  }
  const counts = new Map<number, number>();
  for (const item of evidence) {
    counts.set(item.ci, (counts.get(item.ci) ?? 0) + 1);
  }
  if (
    [...counts.values()].some(
      (count) => count > MAX_ENTRY_EVIDENCE_PER_CANDIDATE,
    )
  ) {
    fail("ENTRY_DIAGNOSTIC_EVIDENCE_PER_CANDIDATE_LIMIT");
  }

  const handling = asArray(
    field(object, "h"),
    0,
    MAX_ENTRY_HANDLING_PER_SETUP,
    "ENTRY_DIAGNOSTIC_HANDLING_LIMIT",
  ).map((item) => parseHandling(item, candidates, evidence));
  const handlingSemanticKeys = handling.map((item) =>
    JSON.stringify([
      item.ci,
      item.ei,
      item.m,
      item.a,
      item.t,
      item.px,
      item.f,
      item.sc,
    ])
  );
  if (
    new Set(handlingSemanticKeys).size !== handlingSemanticKeys.length
  ) {
    fail("ENTRY_DIAGNOSTIC_HANDLING_DUPLICATE");
  }
  const selection = parseSelection(field(object, "q"), candidates, evidence);
  return { candidates, evidence, handling, selection };
}

function parseSetupFacts(value: StrictJsonValue): SetupFactsWire {
  const object = asObject(value, "ENTRY_SETUP_FACTS");
  exactKeys(object, SETUP_FACT_KEYS, "ENTRY_SETUP_FACTS");
  const zoneBottom = safeInteger(
    field(object, "zb"),
    -MAX_SAFE_INTEGER,
    MAX_SAFE_INTEGER,
    "ENTRY_ZONE_BOUNDS",
  );
  const zoneTop = safeInteger(
    field(object, "zt"),
    -MAX_SAFE_INTEGER,
    MAX_SAFE_INTEGER,
    "ENTRY_ZONE_BOUNDS",
  );
  if (zoneTop <= zoneBottom) {
    fail("ENTRY_ZONE_BOUNDS");
  }
  const terminalValue = field(object, "tr");
  const terminalReason =
    terminalValue === null
      ? null
      : closedEnum<SetupAttemptTerminalReason>(
          terminalValue,
          TERMINAL_REASONS,
          "ENTRY_TERMINAL_REASON",
        );
  const terminalEpoch = nullableSafeInteger(
    field(object, "te"),
    0,
    MAX_SAFE_INTEGER,
    "ENTRY_TERMINAL_EPOCH",
  );
  if ((terminalReason === null) !== (terminalEpoch === null)) {
    fail("ENTRY_TERMINAL_PAIR");
  }
  const invalidated = asBoolean(field(object, "iv"), "ENTRY_INVALIDATED_FACT");
  if (
    (invalidated && terminalReason !== "INVALIDATED") ||
    (terminalReason === null && invalidated)
  ) {
    fail("ENTRY_INVALIDATED_FACT");
  }
  const bars = asArray(
    field(object, "b"),
    1,
    MAX_ENTRY_BARS_PER_SETUP,
    "ENTRY_BAR_LIMIT",
  ).map(parseConfirmedBar);
  for (let index = 1; index < bars.length; index += 1) {
    if (bars[index]!.oe !== bars[index - 1]!.ce) {
      fail("ENTRY_BAR_SESSION_CONTINUITY");
    }
  }
  if (
    terminalEpoch !== null &&
    terminalEpoch !== bars[bars.length - 1]!.ce
  ) {
    fail("ENTRY_TERMINAL_NOT_LAST_BAR");
  }
  const transcripts = asArray(
    field(object, "x"),
    0,
    MAX_ENTRY_HTF_TRANSCRIPTS_PER_SETUP,
    "ENTRY_HTF_TRANSCRIPT_LIMIT",
  ).map(parseTranscript);
  if (
    transcripts.some(
      (item, index) => index > 0 && item.m <= transcripts[index - 1]!.m,
    )
  ) {
    fail("ENTRY_HTF_CONTEXT_ORDER");
  }
  for (const transcript of transcripts) {
    const owners = bars.filter(
      (bar) => bar.oe < transcript.cu && transcript.cu <= bar.ce,
    );
    if (owners.length !== 1) {
      fail("HTF_TRANSCRIPT_WITHOUT_EMITTED_BAR");
    }
  }
  const graceValue = field(object, "ng");
  const grace = graceValue === null ? null : parseGrace(graceValue);
  if (grace !== null) {
    if (
      terminalReason !== "BOTH_ACTIVE_MODELS_OBSERVED" ||
      terminalEpoch === null ||
      grace.oe !== terminalEpoch ||
      grace.ce !== grace.oe + 300
    ) {
      fail("ENTRY_TERMINAL_GRACE");
    }
  }
  return {
    zb: zoneBottom,
    zt: zoneTop,
    ge: nullableSafeInteger(
      field(object, "ge"),
      0,
      MAX_SAFE_INTEGER,
      "ENTRY_ZONE_ENGAGEMENT",
    ),
    iv: invalidated,
    cf: closedEnum<"EXACT" | "UNRESOLVED">(
      field(object, "cf"),
      new Set(["EXACT", "UNRESOLVED"]),
      "ENTRY_COMMON_FIDELITY",
    ),
    ak: literal(field(object, "ak"), "INITIAL", "ENTRY_ATTEMPT_KIND"),
    et: literal(field(object, "et"), true, "ENTRY_ELIGIBILITY_PROOF"),
    tr: terminalReason,
    te: terminalEpoch,
    b: bars,
    x: transcripts,
    ng: grace,
  };
}

function parseSetupBundle(value: StrictJsonValue): ParsedSetupBundle {
  const object = asObject(value, "ENTRY_SETUP_BUNDLE");
  exactKeys(object, SETUP_BUNDLE_KEYS, "ENTRY_SETUP_BUNDLE");
  const diagnostic = parseDiagnosticBundle(object);
  return {
    setupId: wireIdentifier(field(object, "s"), "ENTRY_SETUP_ID"),
    direction: closedEnum<EntryDirection>(
      field(object, "d"),
      new Set(["LONG", "SHORT"]),
      "ENTRY_DIRECTION",
    ),
    facts: parseSetupFacts(field(object, "f")),
    ...diagnostic,
  };
}

function setupAtBar(
  bundle: ParsedSetupBundle,
  bar: ConfirmedBarWire,
): SetupEntryFacts {
  const terminal = bundle.facts.te === bar.ce;
  return {
    setup_id: bundle.setupId,
    direction: bundle.direction,
    zone_top_ticks: bundle.facts.zt,
    zone_bottom_ticks: bundle.facts.zb,
    zone_engaged_epoch: bundle.facts.ge,
    invalidated_before_entry: terminal ? bundle.facts.iv : false,
    common_fidelity: bundle.facts.cf,
    terminal_reason: terminal ? bundle.facts.tr : null,
    terminal_epoch: terminal ? bundle.facts.te : null,
  };
}

function directionalClose(request: EntryMatchRequest): boolean {
  const { confirmed_bar: bar, setup } = request;
  return setup.direction === "LONG"
    ? bar.close_ticks > bar.open_ticks &&
        bar.close_ticks > setup.zone_top_ticks
    : bar.close_ticks < bar.open_ticks &&
        bar.close_ticks < setup.zone_bottom_ticks;
}

function wrapRequestShape(request: EntryMatchRequest): void {
  try {
    validateEntryRequestShape(request);
  } catch (error) {
    fail(
      error instanceof Error && error.message.length > 0
        ? `ENTRY_REQUEST_SHAPE:${error.message}`
        : "ENTRY_REQUEST_SHAPE",
    );
  }
}

async function projectRequests(
  bundle: ParsedSetupBundle,
): Promise<{
  readonly retainedContext: readonly EntryMatchRequest[];
  readonly events: readonly EntryMatchRequest[];
  readonly normal: readonly EntryMatchRequest[];
}> {
  const requests: EntryMatchRequest[] = [];
  for (const bar of bundle.facts.b) {
    const setup = setupAtBar(bundle, bar);
    const proofs = await Promise.all(
      bundle.facts.x
        .filter(
          (transcript) =>
            bar.oe < transcript.cu && transcript.cu <= bar.ce,
        )
        .map((transcript) => expandTranscript(setup, transcript)),
    );
    const request: EntryMatchRequest = {
      setup,
      confirmed_bar: confirmedBarCandle(bar),
      htf_proofs: proofs,
      generic_break_detected: bar.gb,
      rejection_respect_detected: bar.rr,
      attempt_kind: "INITIAL",
      trigger_ordinal: 1,
    };
    wrapRequestShape(
      setup.zone_engaged_epoch !== null &&
        setup.zone_engaged_epoch > bar.ce
        ? {
            ...request,
            setup: {
              ...setup,
              zone_engaged_epoch: null,
            },
          }
        : request,
    );
    requests.push(request);
  }

  if (
    bundle.facts.ge !== null &&
    bundle.facts.ge > requests[requests.length - 1]!.confirmed_bar.close_epoch
  ) {
    fail("ENTRY_ZONE_ENGAGEMENT_CHRONOLOGY");
  }
  if (
    bundle.facts.tr === "INVALIDATED" &&
    bundle.facts.iv &&
    requests
      .slice(0, -1)
      .some(
        (request) =>
          directionalClose(request) ||
          request.htf_proofs.some((proof) => proof.matched),
      )
  ) {
    fail("ENTRY_INVALIDATED_FACT");
  }
  if (
    bundle.facts.tr === "INVALIDATED" &&
    bundle.facts.iv &&
    bundle.candidates.some((candidate) => ACTIVE_MODELS.has(candidate.m))
  ) {
    fail("ENTRY_INVALIDATED_FACT");
  }

  const current = requests[requests.length - 1]!;
  const events: EntryMatchRequest[] = [current];
  if (bundle.facts.ng !== null) {
    const earlier = requests.slice(0, -1);
    const htfSeenEarlier = earlier.some((request) =>
      request.htf_proofs.some((proof) => proof.matched)
    );
    const closeSeenEarlier = earlier.some(directionalClose);
    const htfSeenCurrent = current.htf_proofs.some((proof) => proof.matched);
    if (
      !htfSeenEarlier ||
      closeSeenEarlier ||
      htfSeenCurrent ||
      !directionalClose(current)
    ) {
      fail("ENTRY_TERMINAL_GRACE_TRANSITION");
    }
    const grace = bundle.facts.ng;
    const graceRequest: EntryMatchRequest = {
      setup: current.setup,
      confirmed_bar: {
        open_epoch: grace.oe,
        close_epoch: grace.ce,
        open_ticks: grace.o,
        high_ticks: grace.h,
        low_ticks: grace.l,
        close_ticks: grace.c,
      },
      htf_proofs: [],
      generic_break_detected: false,
      rejection_respect_detected: false,
      attempt_kind: "INITIAL",
      trigger_ordinal: 1,
    };
    wrapRequestShape(graceRequest);
    events.push(graceRequest);
  }
  return {
    retainedContext: requests.slice(0, -1),
    events,
    normal: requests,
  };
}

interface LocalCandidateView {
  readonly model: EntryModelV2;
  readonly state: CandidateState;
  readonly event_anchor_epoch: number;
  readonly trigger_ordinal: number;
  readonly normalized_from: EntryModelV2 | null;
  readonly source_claim_ids: readonly string[];
  readonly candidate_id: string;
}

interface LocalEvidenceView {
  readonly candidate: LocalCandidateView;
  readonly observed_trigger_epoch: number | null;
  readonly observed_trigger_ticks: number | null;
  readonly htf_context_minutes: readonly (15 | 30 | 60)[];
  readonly fidelity: CandidateFidelity;
  readonly proof_plane: ProofPlane;
  readonly proof_resolution_seconds: number;
  readonly coverage_start_epoch: number;
  readonly coverage_end_epoch: number;
  readonly ambiguity_codes: readonly AmbiguityCode[];
  readonly passed_rule_ids: readonly string[];
  readonly failed_rule_ids: readonly string[];
  readonly source_claim_ids: readonly string[];
  readonly evidence_id: string;
}

interface LocalHandlingView {
  readonly candidate: LocalCandidateView;
  readonly evidence: LocalEvidenceView;
  readonly handling_mode: HandlingMode;
  readonly observed_epoch: number;
  readonly observed_ticks: number | null;
  readonly fidelity: CandidateFidelity;
  readonly source_claim_ids: readonly string[];
}

async function localDiagnosticViews(
  requests: readonly EntryMatchRequest[],
): Promise<{
  readonly candidates: readonly LocalCandidateView[];
  readonly evidence: readonly LocalEvidenceView[];
  readonly handling: readonly LocalHandlingView[];
}> {
  const candidates: LocalCandidateView[] = [];
  const evidence: LocalEvidenceView[] = [];
  const handling: LocalHandlingView[] = [];
  for (const request of requests) {
    if (
      request.setup.zone_engaged_epoch !== null &&
      request.setup.zone_engaged_epoch > request.confirmed_bar.close_epoch
    ) {
      continue;
    }
    let result;
    try {
      result = await evaluateEntryMatch(request);
    } catch (error) {
      fail(
        error instanceof Error && error.message.length > 0
          ? `ENTRY_MATCH_PROJECTION:${error.message}`
          : "ENTRY_MATCH_PROJECTION",
      );
    }
    const byId = new Map<string, LocalCandidateView>();
    for (const candidate of result.candidates) {
      const view: LocalCandidateView = {
        model: candidate.model,
        state: candidate.state,
        event_anchor_epoch: candidate.event_anchor_epoch,
        trigger_ordinal: candidate.trigger_ordinal,
        normalized_from: candidate.normalized_from,
        source_claim_ids: candidate.source_claim_ids,
        candidate_id: candidate.candidate_id,
      };
      candidates.push(view);
      byId.set(candidate.candidate_id, view);
    }
    const evidenceById = new Map<string, LocalEvidenceView>();
    for (const item of result.evidence) {
      const candidate = byId.get(item.candidate_id);
      if (candidate === undefined) {
        fail("ENTRY_MATCH_PROJECTION");
      }
      const view: LocalEvidenceView = {
        candidate,
        observed_trigger_epoch: item.observed_trigger_epoch,
        observed_trigger_ticks: item.observed_trigger_ticks,
        htf_context_minutes: item.htf_context_minutes,
        fidelity: item.fidelity,
        proof_plane: item.proof_plane,
        proof_resolution_seconds: item.proof_resolution_seconds,
        coverage_start_epoch: item.coverage_start_epoch,
        coverage_end_epoch: item.coverage_end_epoch,
        ambiguity_codes: item.ambiguity_codes,
        passed_rule_ids: item.passed_rule_ids,
        failed_rule_ids: item.failed_rule_ids,
        source_claim_ids: item.source_claim_ids,
        evidence_id: item.evidence_id,
      };
      evidence.push(view);
      evidenceById.set(item.evidence_id, view);
    }
    for (const item of result.handling) {
      const candidate = byId.get(item.candidate_id);
      const evidenceItem = evidenceById.get(item.evidence_id);
      if (candidate === undefined || evidenceItem === undefined) {
        fail("ENTRY_MATCH_PROJECTION");
      }
      handling.push({
        candidate,
        evidence: evidenceItem,
        handling_mode: item.handling_mode,
        observed_epoch: item.observed_epoch,
        observed_ticks: item.observed_ticks,
        fidelity: item.fidelity,
        source_claim_ids: item.source_claim_ids,
      });
    }
  }
  return { candidates, evidence, handling };
}

function sameCandidateSemantic(
  local: LocalCandidateView,
  producer: ProducerCandidateWire,
): boolean {
  return (
    local.model === producer.m &&
    local.event_anchor_epoch === producer.a &&
    local.trigger_ordinal === producer.o
  );
}

function validateProducerAgainstLocalProjection(
  bundle: ParsedSetupBundle,
  local: {
    readonly candidates: readonly LocalCandidateView[];
    readonly evidence: readonly LocalEvidenceView[];
    readonly handling: readonly LocalHandlingView[];
  },
): void {
  for (const candidate of bundle.candidates) {
    const matches = local.candidates.filter((item) =>
      sameCandidateSemantic(item, candidate)
    );
    if (
      matches.length > 0 &&
      !matches.some(
        (item) =>
          item.state === candidate.st &&
          item.normalized_from === candidate.n &&
          sameValues(item.source_claim_ids, candidate.sc),
      )
    ) {
      fail("ENTRY_DIAGNOSTIC_CANDIDATE_CONTRADICTION");
    }
  }

  for (const evidence of bundle.evidence) {
    if (evidence.p === "REALTIME_TICK") continue;
    const candidate = bundle.candidates[evidence.ci]!;
    const matches = local.evidence.filter(
      (item) =>
        sameCandidateSemantic(item.candidate, candidate) &&
        item.proof_plane === evidence.p &&
        item.coverage_start_epoch === evidence.cs &&
        item.coverage_end_epoch === evidence.ce,
    );
    if (
      matches.length > 0 &&
      !matches.some(
        (item) =>
          item.observed_trigger_epoch === evidence.t &&
          item.observed_trigger_ticks === evidence.px &&
          sameValues(item.htf_context_minutes, evidence.h) &&
          item.fidelity === evidence.f &&
          item.proof_resolution_seconds === evidence.r &&
          sameValues(item.ambiguity_codes, evidence.ac) &&
          sameValues(item.passed_rule_ids, evidence.pr) &&
          sameValues(item.failed_rule_ids, evidence.fr) &&
          sameValues(item.source_claim_ids, evidence.sc),
      )
    ) {
      fail("ENTRY_DIAGNOSTIC_EVIDENCE_CONTRADICTION");
    }
  }

  for (const handling of bundle.handling) {
    const candidate = bundle.candidates[handling.ci]!;
    const evidence = bundle.evidence[handling.ei]!;
    const matches = local.handling.filter(
      (item) =>
        sameCandidateSemantic(item.candidate, candidate) &&
        item.handling_mode === handling.m &&
        item.evidence.proof_plane === evidence.p &&
        item.evidence.coverage_start_epoch === evidence.cs &&
        item.evidence.coverage_end_epoch === evidence.ce,
    );
    if (
      matches.length > 0 &&
      !matches.some(
        (item) =>
          item.observed_epoch === handling.t &&
          item.observed_ticks === handling.px &&
          item.fidelity === handling.f &&
          sameValues(item.source_claim_ids, handling.sc),
      )
    ) {
      fail("ENTRY_DIAGNOSTIC_HANDLING_CONTRADICTION");
    }
  }
}

function normalizeProducerDiagnostic(
  bundle: ParsedSetupBundle,
): ProducerDiagnostic {
  const candidates: ProducerCandidateReference[] = bundle.candidates.map(
    (candidate) => ({
      model: candidate.m,
      state: candidate.st,
      event_anchor_epoch: candidate.a,
      trigger_ordinal: candidate.o,
      normalized_from: candidate.n,
      source_claim_ids: [...candidate.sc],
    }),
  );
  const allEvidence: ProducerEvidenceReference[] = bundle.evidence.map(
    (item) => ({
      candidate: candidates[item.ci]!,
      observed_trigger_epoch: item.t,
      observed_trigger_ticks: item.px,
      htf_context_minutes: [...item.h],
      fidelity: item.f,
      proof_plane: item.p,
      proof_resolution_seconds: item.r,
      coverage_start_epoch: item.cs,
      coverage_end_epoch: item.ce,
      ambiguity_codes: [...item.ac],
      passed_rule_ids: [...item.pr],
      failed_rule_ids: [...item.fr],
      source_claim_ids: [...item.sc],
    }),
  );
  const handling: ProducerHandlingReference[] = bundle.handling.map((item) => ({
    candidate: candidates[item.ci]!,
    evidence: allEvidence[item.ei]!,
    handling_mode: item.m,
    attempt_kind: "INITIAL",
    observed_epoch: item.t,
    observed_ticks: item.px,
    fidelity: item.f,
    source_claim_ids: [...item.sc],
  }));
  const selection =
    bundle.selection === null
      ? null
      : {
          version: bundle.selection.v,
          semantic_key: bundle.selection.k,
          model: bundle.selection.m,
          event_anchor_epoch: bundle.selection.a,
          trigger_ordinal: bundle.selection.o,
          reason: bundle.selection.r,
          fidelity: bundle.selection.f,
          action: bundle.selection.x,
        };
  return {
    candidates,
    evidence: allEvidence.filter(
      (item) => item.proof_plane !== "REALTIME_TICK",
    ),
    realtime_evidence: allEvidence.filter(
      (item) => item.proof_plane === "REALTIME_TICK",
    ),
    handling,
    selection,
  };
}

async function validateSetupBundle(
  value: StrictJsonValue,
): Promise<ValidatedEntryWireBatch> {
  const bundle = parseSetupBundle(value);
  const requests = await projectRequests(bundle);
  const local = await localDiagnosticViews(requests.normal);
  validateProducerAgainstLocalProjection(bundle, local);
  return {
    setupId: bundle.setupId,
    retainedContext: requests.retainedContext,
    events: requests.events,
    producerDiagnostic: normalizeProducerDiagnostic(bundle),
  };
}

function canonicalEntryBatches(
  values: readonly ValidatedEntryWireBatch[],
): readonly CanonicalValue[] {
  return values.map((value) =>
    rdEntryCanonicalValue({
      setup_id: value.setupId,
      retained_context: value.retainedContext,
      events: value.events,
      producer_diagnostic: value.producerDiagnostic,
    })
  );
}

export async function validateEntryV2Payload(
  value: StrictJsonValue,
): Promise<ValidatedEntryV2Payload> {
  const object = asObject(value);
  exactKeys(object, TOP_LEVEL_KEYS);
  const schemaVersion = literal(
    field(object, "schema_version"),
    "2.0",
    "ENTRY_SCHEMA_VERSION",
  );
  const strategyId = literal(
    field(object, "strategy_id"),
    "rd_liquidity_sd_5m_v1",
    "ENTRY_STRATEGY_ID",
  );
  const strategyVersion = literal(
    field(object, "strategy_version"),
    "2.0.0-contract2",
    "ENTRY_STRATEGY_VERSION",
  );
  const ruleContractVersion = literal(
    field(object, "rule_contract_version"),
    "2.0.0",
    "ENTRY_RULE_CONTRACT_VERSION",
  );
  const executionMode = literal(
    field(object, "execution_mode"),
    "OBSERVATION_ONLY",
    "ENTRY_EXECUTION_MODE",
  );
  const producerInstanceId = wireIdentifier(
    field(object, "producer_instance_id"),
    "ENTRY_PRODUCER_INSTANCE_ID",
  );
  const sequence = safeInteger(
    field(object, "sequence"),
    1,
    MAX_SAFE_INTEGER,
    "ENTRY_SEQUENCE",
  );
  const symbol = wireIdentifier(field(object, "symbol"), "ENTRY_SYMBOL");
  const tickerId = wireIdentifier(field(object, "ticker_id"), "ENTRY_TICKER_ID");
  const feed = wireIdentifier(field(object, "feed"), "ENTRY_FEED");
  const timeframe = literal(
    field(object, "timeframe"),
    "5",
    "ENTRY_TIMEFRAME",
  );
  const tickSize = asString(
    field(object, "tick_size"),
    1,
    64,
    "ENTRY_TICK_SIZE",
  );
  if (!POSITIVE_DECIMAL.test(tickSize)) {
    fail("ENTRY_TICK_SIZE");
  }
  const barOpenEpoch = safeInteger(
    field(object, "bar_open_epoch"),
    0,
    MAX_SAFE_INTEGER,
    "ENTRY_BAR_EPOCH",
  );
  const barCloseEpoch = safeInteger(
    field(object, "bar_close_epoch"),
    0,
    MAX_SAFE_INTEGER,
    "ENTRY_BAR_EPOCH",
  );
  if (barCloseEpoch - barOpenEpoch !== 300) {
    fail("ENTRY_BAR_EPOCH");
  }
  const detectorCodeHash = sha256(
    field(object, "detector_code_hash"),
    "ENTRY_DETECTOR_HASH",
  );
  const settingsHash = sha256(
    field(object, "settings_hash"),
    "ENTRY_SETTINGS_HASH",
  );
  const kind = closedEnum<"snapshot" | "incremental">(
    field(object, "kind"),
    new Set(["snapshot", "incremental"]),
    "ENTRY_BATCH_KIND",
  );
  const chunkCount = safeInteger(
    field(object, "chunk_count"),
    1,
    MAX_ENTRY_CHUNKS,
    "ENTRY_CHUNK_COUNT",
  );
  const chunkIndex = safeInteger(
    field(object, "chunk_index"),
    0,
    chunkCount - 1,
    "ENTRY_CHUNK_INDEX",
  );
  const idempotencyKey = wireIdentifier(
    field(object, "idempotency_key"),
    "ENTRY_IDEMPOTENCY_KEY",
  );
  if (
    idempotencyKey !==
      `${producerInstanceId}:${sequence}:${kind}:${barCloseEpoch}:${chunkIndex}`
  ) {
    fail("ENTRY_IDEMPOTENCY_KEY");
  }

  const bundleValues = asArray(
    field(object, "eb"),
    0,
    MAX_ENTRY_SETUPS_PER_BATCH,
    "ENTRY_SETUP_LIMIT",
  );
  const entryBatches = await Promise.all(
    bundleValues.map(validateSetupBundle),
  );
  if (
    new Set(entryBatches.map((item) => item.setupId)).size !==
      entryBatches.length
  ) {
    fail("ENTRY_DUPLICATE_SETUP");
  }
  for (const entry of entryBatches) {
    const lastNormal =
      entry.events[0]?.confirmed_bar ??
      entry.retainedContext[entry.retainedContext.length - 1]?.confirmed_bar;
    if (
      lastNormal === undefined ||
      lastNormal.open_epoch !== barOpenEpoch ||
      lastNormal.close_epoch !== barCloseEpoch
    ) {
      fail("ENTRY_TOP_LEVEL_BAR_MISMATCH");
    }
  }

  const metadata: ReceiptMetadata = {
    idempotencyKey,
    schemaVersion,
    strategyId,
    strategyVersion,
    producerInstanceId,
    sequence,
    symbol,
    tickerId,
    feed,
    timeframe,
    kind,
  };
  const batchIdentity: EntryBatchSemanticIdentity = {
    producer_instance_id: producerInstanceId,
    sequence,
    kind,
    bar_close_epoch: barCloseEpoch,
  };
  const batchMetadata: EntryBatchImmutableMetadata = {
    strategy_id: strategyId,
    strategy_version: strategyVersion,
    rule_contract_version: ruleContractVersion,
    execution_mode: executionMode,
    symbol,
    ticker_id: tickerId,
    feed,
    timeframe,
    tick_size: tickSize,
    bar_open_epoch: barOpenEpoch,
    detector_code_hash: detectorCodeHash,
    settings_hash: settingsHash,
  };
  const canonicalPayload: Record<string, CanonicalValue> = {
    schema_version: schemaVersion,
    strategy_id: strategyId,
    strategy_version: strategyVersion,
    rule_contract_version: ruleContractVersion,
    execution_mode: executionMode,
    producer_instance_id: producerInstanceId,
    sequence,
    idempotency_key: idempotencyKey,
    symbol,
    ticker_id: tickerId,
    feed,
    timeframe,
    tick_size: tickSize,
    bar_open_epoch: barOpenEpoch,
    bar_close_epoch: barCloseEpoch,
    detector_code_hash: detectorCodeHash,
    settings_hash: settingsHash,
    kind,
    chunk_index: chunkIndex,
    chunk_count: chunkCount,
    entry_batches: canonicalEntryBatches(entryBatches),
  };
  return {
    canonicalPayload,
    metadata,
    batchIdentity,
    batchMetadata,
    chunkIndex,
    chunkCount,
    entryBatches,
  };
}
