import {
  type AmbiguityCode,
  type AttemptKind,
  type CandidateFidelity,
  type CandidateState,
  canonicalStringifyRdEntry,
  type EntryCandidate,
  type EntryCandidateEvidence,
  type EntryDirection,
  type EntryEvaluation,
  type EntryHandlingObservation,
  type EntryModelV2,
  type EntrySelection,
  type HandlingMode,
  type HTFFlipProofTranscript,
  type OrderedCandle,
  type ProofPlane,
  type SelectionAction,
  type SelectionReason,
  type SetupAttemptTerminalReason,
  type SetupEntryFacts,
} from "./rd-entry-domain";
import {
  type EntryStreamEvent,
  evaluateEntryStream,
} from "./rd-entry-arbitrator";
import {
  type EdgeEntryMatchRequest,
  validateEntryRequestShape,
  validateHtfFlipProof,
} from "./rd-entry-matcher";
import {
  isStrictJsonNumber,
  parseStrictJson,
  type StrictJsonValue,
} from "./strict-json";

interface RawHtfScanRequest {
  readonly timeframe_minutes: 15 | 30 | 60;
  readonly htf_open_epoch: number;
  readonly scan_cutoff_epoch: number;
  readonly htf_open_ticks: number;
  readonly children: readonly OrderedCandle[];
  readonly proof_resolution_seconds: number;
  readonly full_lifecycle_ordered: boolean;
}

interface RawEntryEvent {
  readonly event_id: string;
  readonly match_request: EdgeEntryMatchRequest;
  readonly htf_scan_requests: readonly RawHtfScanRequest[];
}

interface RawEntryInput {
  readonly setup_id: string;
  readonly events: readonly RawEntryEvent[];
  readonly setup_invalidated: boolean;
  readonly policy_version: "rd-entry-arbitration-v2";
  readonly revision: number;
  readonly evaluated_at_epoch: number;
}

export interface RdEntryEdgeVectorInput {
  readonly setup_id: string;
  readonly events: readonly EntryStreamEvent[];
  readonly setup_invalidated: boolean;
  readonly policy_version: "rd-entry-arbitration-v2";
  readonly revision: number;
  readonly evaluated_at_epoch: number;
}

export interface RdEntryExpectedVector extends EntryEvaluation {
  readonly htf_transcripts: readonly HTFFlipProofTranscript[];
}

export interface RdEntryOracleVectorCase {
  readonly case_id: string;
  readonly setup_id: string;
  readonly symbol: string;
  readonly feed: string;
  readonly calculation_start_epoch: number;
  readonly emission_start_epoch: number;
  readonly emission_end_epoch: number;
  readonly pine_supported: boolean;
  readonly input: RawEntryInput;
  readonly edge_input: RdEntryEdgeVectorInput;
  readonly pine_edge_input: RdEntryEdgeVectorInput;
  readonly expected: RdEntryExpectedVector;
  readonly pine_expected: RdEntryExpectedVector;
}

export interface RdEntryOracleVectorDocument {
  readonly schema_id: "phase0.rd-entry-arbitration-vectors.v2";
  readonly cases: readonly RdEntryOracleVectorCase[];
}

type StrictObject = { [key: string]: StrictJsonValue };

const IDENTIFIER = /^[A-Za-z0-9_.:@|+/-]+$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const MAX_IDENTIFIER_LENGTH = 160;
const INPUT_KEYS = [
  "setup_id",
  "events",
  "setup_invalidated",
  "policy_version",
  "revision",
  "evaluated_at_epoch",
] as const;
const MATCH_REQUEST_KEYS = [
  "setup",
  "confirmed_bar",
  "htf_proofs",
  "generic_break_detected",
  "rejection_respect_detected",
  "attempt_kind",
  "trigger_ordinal",
] as const;

function fail(message: string): never {
  throw new TypeError(message);
}

function objectValue(value: StrictJsonValue, name: string): StrictObject {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    isStrictJsonNumber(value)
  ) {
    fail(`${name} must be an object`);
  }
  return value;
}

function arrayValue(
  value: StrictJsonValue,
  name: string,
  maximum?: number,
): StrictJsonValue[] {
  if (
    !Array.isArray(value) ||
    (maximum !== undefined && value.length > maximum)
  ) {
    fail(`${name} must be a bounded array`);
  }
  return value;
}

function exactKeys(
  value: StrictObject,
  keys: readonly string[],
  name: string,
): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    canonicalStringifyRdEntry(actual) !==
      canonicalStringifyRdEntry(expected)
  ) {
    fail(`${name} has unknown or missing fields`);
  }
}

function field(
  value: StrictObject,
  key: string,
  name: string,
): StrictJsonValue {
  if (!Object.hasOwn(value, key)) {
    fail(`${name} is missing ${key}`);
  }
  const result = value[key];
  if (result === undefined) fail(`${name} is missing ${key}`);
  return result;
}

function textValue(
  value: StrictJsonValue,
  name: string,
  identifier = false,
): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.trim() !== value ||
    (identifier &&
      (value.length > MAX_IDENTIFIER_LENGTH || !IDENTIFIER.test(value)))
  ) {
    fail(`${name} must be a non-empty closed string`);
  }
  return value;
}

function sha256Value(value: StrictJsonValue, name: string): string {
  if (
    typeof value !== "string" ||
    !SHA256.test(value) ||
    value === "0".repeat(64)
  ) {
    fail(`${name} must be a nonzero lowercase SHA-256`);
  }
  return value;
}

function booleanValue(value: StrictJsonValue, name: string): boolean {
  if (typeof value !== "boolean") fail(`${name} must be a boolean`);
  return value;
}

function integerValue(
  value: StrictJsonValue,
  name: string,
  minimum = -9_007_199_254_740_991,
): number {
  if (
    !isStrictJsonNumber(value) ||
    !value.isIntegerToken ||
    value.value < minimum
  ) {
    fail(`${name} must be a safe integer`);
  }
  return value.value;
}

function optionalInteger(
  value: StrictJsonValue,
  name: string,
  minimum = -9_007_199_254_740_991,
): number | null {
  return value === null ? null : integerValue(value, name, minimum);
}

function optionalSha256(
  value: StrictJsonValue,
  name: string,
): string | null {
  return value === null ? null : sha256Value(value, name);
}

function stringArray(
  value: StrictJsonValue,
  name: string,
  identifier = true,
): readonly string[] {
  const result = arrayValue(value, name).map((item, index) =>
    textValue(item, `${name}[${index}]`, identifier)
  );
  if (new Set(result).size !== result.length) {
    fail(`${name} must contain unique values`);
  }
  return result;
}

function directionValue(
  value: StrictJsonValue,
  name: string,
): EntryDirection {
  if (value === "LONG" || value === "SHORT") return value;
  return fail(`${name} has an unsupported direction`);
}

function fidelityValue(
  value: StrictJsonValue,
  name: string,
): CandidateFidelity {
  switch (value) {
    case "EXACT":
    case "CALIBRATED":
    case "DISCRETIONARY":
    case "UNRESOLVED":
      return value;
    default:
      return fail(`${name} has an unsupported fidelity`);
  }
}

function terminalReasonValue(
  value: StrictJsonValue,
  name: string,
): SetupAttemptTerminalReason | null {
  switch (value) {
    case null:
    case "INVALIDATED":
    case "BOTH_ACTIVE_MODELS_OBSERVED":
    case "RETENTION_EVICTED":
      return value;
    default:
      return fail(`${name} has an unsupported terminal reason`);
  }
}

function attemptKindValue(
  value: StrictJsonValue,
  name: string,
): AttemptKind {
  if (value === "INITIAL" || value === "RE_ENTRY") return value;
  return fail(`${name} has an unsupported attempt kind`);
}

function entryModelValue(
  value: StrictJsonValue,
  name: string,
): EntryModelV2 {
  switch (value) {
    case "DIR_CLOSE":
    case "HTF_FLIP":
    case "LEGACY_BREAK_CANDLE":
    case "LEGACY_REJECTION_RESPECT":
      return value;
    default:
      return fail(`${name} has an unsupported entry model`);
  }
}

function optionalEntryModel(
  value: StrictJsonValue,
  name: string,
): EntryModelV2 | null {
  return value === null ? null : entryModelValue(value, name);
}

function candidateStateValue(
  value: StrictJsonValue,
  name: string,
): CandidateState {
  switch (value) {
    case "MATCHED":
    case "BLOCKED":
    case "REJECTED":
    case "NORMALIZED":
      return value;
    default:
      return fail(`${name} has an unsupported candidate state`);
  }
}

function proofPlaneValue(
  value: StrictJsonValue,
  name: string,
): ProofPlane {
  switch (value) {
    case "CONFIRMED_5M":
    case "LOWER_TIMEFRAME_REPLAY":
    case "REALTIME_TICK":
    case "EXTERNAL_ARCHIVED_TICK":
      return value;
    default:
      return fail(`${name} has an unsupported proof plane`);
  }
}

function ambiguityValue(
  value: StrictJsonValue,
  name: string,
): AmbiguityCode {
  switch (value) {
    case "SHADOW_SAME_CHILD_BAR_ORDER":
    case "SHADOW_MISSING_INTRABAR_COVERAGE":
    case "SHADOW_REALTIME_ONLY_NOT_REPLAYABLE":
      return value;
    default:
      return fail(`${name} has an unsupported ambiguity code`);
  }
}

function handlingModeValue(
  value: StrictJsonValue,
  name: string,
): HandlingMode {
  switch (value) {
    case "CLOSE_CONFIRMATION":
    case "INTRABAR_FLIP":
    case "NEXT_CANDLE_WICK":
    case "AGGRESSIVE":
      return value;
    default:
      return fail(`${name} has an unsupported handling mode`);
  }
}

function selectionReasonValue(
  value: StrictJsonValue,
  name: string,
): SelectionReason {
  switch (value) {
    case "ONLY_EXACT_TRIGGER":
    case "EARLIEST_EXACT_TRIGGER":
    case "FALLBACK_TO_CONFIRMED_CLOSE":
    case "NO_EXACT_CANDIDATE":
    case "UNRESOLVED_SOURCE_PRIORITY":
    case "SETUP_INVALIDATED":
    case "NO_CANDIDATE":
      return value;
    default:
      return fail(`${name} has an unsupported selection reason`);
  }
}

function selectionActionValue(
  value: StrictJsonValue,
  name: string,
): SelectionAction {
  switch (value) {
    case "OBSERVE":
    case "PAPER_ELIGIBLE":
    case "SHADOW_ONLY":
    case "NONE":
      return value;
    default:
      return fail(`${name} has an unsupported selection action`);
  }
}

function contextValue(
  value: StrictJsonValue,
  name: string,
): 15 | 30 | 60 {
  const context = integerValue(value, name, 0);
  if (context === 15 || context === 30 || context === 60) return context;
  return fail(`${name} has an unsupported HTF context`);
}

function candleValue(
  value: StrictJsonValue,
  name: string,
): OrderedCandle {
  const object = objectValue(value, name);
  exactKeys(
    object,
    [
      "open_epoch",
      "close_epoch",
      "open_ticks",
      "high_ticks",
      "low_ticks",
      "close_ticks",
    ],
    name,
  );
  const candle: OrderedCandle = {
    open_epoch: integerValue(
      field(object, "open_epoch", name),
      `${name}.open_epoch`,
      0,
    ),
    close_epoch: integerValue(
      field(object, "close_epoch", name),
      `${name}.close_epoch`,
      0,
    ),
    open_ticks: integerValue(
      field(object, "open_ticks", name),
      `${name}.open_ticks`,
    ),
    high_ticks: integerValue(
      field(object, "high_ticks", name),
      `${name}.high_ticks`,
    ),
    low_ticks: integerValue(
      field(object, "low_ticks", name),
      `${name}.low_ticks`,
    ),
    close_ticks: integerValue(
      field(object, "close_ticks", name),
      `${name}.close_ticks`,
    ),
  };
  if (
    candle.close_epoch <= candle.open_epoch ||
    candle.high_ticks <
      Math.max(candle.open_ticks, candle.close_ticks, candle.low_ticks) ||
    candle.low_ticks >
      Math.min(candle.open_ticks, candle.close_ticks, candle.high_ticks)
  ) {
    fail(`${name} has invalid chronology or OHLC`);
  }
  return candle;
}

function setupValue(
  value: StrictJsonValue,
  name: string,
): SetupEntryFacts {
  const object = objectValue(value, name);
  exactKeys(
    object,
    [
      "setup_id",
      "direction",
      "zone_top_ticks",
      "zone_bottom_ticks",
      "zone_engaged_epoch",
      "invalidated_before_entry",
      "common_fidelity",
      "terminal_reason",
      "terminal_epoch",
    ],
    name,
  );
  const setup: SetupEntryFacts = {
    setup_id: textValue(
      field(object, "setup_id", name),
      `${name}.setup_id`,
      true,
    ),
    direction: directionValue(
      field(object, "direction", name),
      `${name}.direction`,
    ),
    zone_top_ticks: integerValue(
      field(object, "zone_top_ticks", name),
      `${name}.zone_top_ticks`,
    ),
    zone_bottom_ticks: integerValue(
      field(object, "zone_bottom_ticks", name),
      `${name}.zone_bottom_ticks`,
    ),
    zone_engaged_epoch: optionalInteger(
      field(object, "zone_engaged_epoch", name),
      `${name}.zone_engaged_epoch`,
      0,
    ),
    invalidated_before_entry: booleanValue(
      field(object, "invalidated_before_entry", name),
      `${name}.invalidated_before_entry`,
    ),
    common_fidelity: fidelityValue(
      field(object, "common_fidelity", name),
      `${name}.common_fidelity`,
    ),
    terminal_reason: terminalReasonValue(
      field(object, "terminal_reason", name),
      `${name}.terminal_reason`,
    ),
    terminal_epoch: optionalInteger(
      field(object, "terminal_epoch", name),
      `${name}.terminal_epoch`,
      0,
    ),
  };
  if (
    setup.zone_top_ticks <= setup.zone_bottom_ticks ||
    (setup.terminal_reason === null) !== (setup.terminal_epoch === null) ||
    (setup.invalidated_before_entry &&
      setup.terminal_reason !== "INVALIDATED") ||
    (setup.zone_engaged_epoch !== null &&
      setup.terminal_epoch !== null &&
      setup.terminal_epoch < setup.zone_engaged_epoch)
  ) {
    fail(`${name} has contradictory zone or terminal facts`);
  }
  return setup;
}

function transcriptValue(
  value: StrictJsonValue,
  name: string,
): HTFFlipProofTranscript {
  const object = objectValue(value, name);
  exactKeys(
    object,
    [
      "context_minutes",
      "htf_open_epoch",
      "htf_open_ticks",
      "scan_cutoff_epoch",
      "proof_resolution_seconds",
      "coverage_start_epoch",
      "coverage_end_epoch",
      "expected_child_count",
      "observed_child_count",
      "gap_present",
      "full_lifecycle_ordered",
      "destination_seen_before_contact",
      "contact_candle",
      "recross_candle",
      "same_child",
    ],
    name,
  );
  const contactValue = field(object, "contact_candle", name);
  const recrossValue = field(object, "recross_candle", name);
  return {
    context_minutes: contextValue(
      field(object, "context_minutes", name),
      `${name}.context_minutes`,
    ),
    htf_open_epoch: integerValue(
      field(object, "htf_open_epoch", name),
      `${name}.htf_open_epoch`,
      0,
    ),
    htf_open_ticks: integerValue(
      field(object, "htf_open_ticks", name),
      `${name}.htf_open_ticks`,
    ),
    scan_cutoff_epoch: integerValue(
      field(object, "scan_cutoff_epoch", name),
      `${name}.scan_cutoff_epoch`,
      0,
    ),
    proof_resolution_seconds: integerValue(
      field(object, "proof_resolution_seconds", name),
      `${name}.proof_resolution_seconds`,
      1,
    ),
    coverage_start_epoch: integerValue(
      field(object, "coverage_start_epoch", name),
      `${name}.coverage_start_epoch`,
      0,
    ),
    coverage_end_epoch: integerValue(
      field(object, "coverage_end_epoch", name),
      `${name}.coverage_end_epoch`,
      0,
    ),
    expected_child_count: integerValue(
      field(object, "expected_child_count", name),
      `${name}.expected_child_count`,
      0,
    ),
    observed_child_count: integerValue(
      field(object, "observed_child_count", name),
      `${name}.observed_child_count`,
      0,
    ),
    gap_present: booleanValue(
      field(object, "gap_present", name),
      `${name}.gap_present`,
    ),
    full_lifecycle_ordered: booleanValue(
      field(object, "full_lifecycle_ordered", name),
      `${name}.full_lifecycle_ordered`,
    ),
    destination_seen_before_contact: booleanValue(
      field(object, "destination_seen_before_contact", name),
      `${name}.destination_seen_before_contact`,
    ),
    contact_candle: contactValue === null
      ? null
      : candleValue(contactValue, `${name}.contact_candle`),
    recross_candle: recrossValue === null
      ? null
      : candleValue(recrossValue, `${name}.recross_candle`),
    same_child: booleanValue(
      field(object, "same_child", name),
      `${name}.same_child`,
    ),
  };
}

function matchRequestValue(
  value: StrictJsonValue,
  name: string,
): EdgeEntryMatchRequest {
  const object = objectValue(value, name);
  exactKeys(object, MATCH_REQUEST_KEYS, name);
  const transcripts = arrayValue(
    field(object, "htf_proofs", name),
    `${name}.htf_proofs`,
    3,
  ).map((item, index) => transcriptValue(item, `${name}.htf_proofs[${index}]`));
  const request: EdgeEntryMatchRequest = {
    setup: setupValue(field(object, "setup", name), `${name}.setup`),
    confirmed_bar: candleValue(
      field(object, "confirmed_bar", name),
      `${name}.confirmed_bar`,
    ),
    htf_proofs: transcripts,
    generic_break_detected: booleanValue(
      field(object, "generic_break_detected", name),
      `${name}.generic_break_detected`,
    ),
    rejection_respect_detected: booleanValue(
      field(object, "rejection_respect_detected", name),
      `${name}.rejection_respect_detected`,
    ),
    attempt_kind: attemptKindValue(
      field(object, "attempt_kind", name),
      `${name}.attempt_kind`,
    ),
    trigger_ordinal: integerValue(
      field(object, "trigger_ordinal", name),
      `${name}.trigger_ordinal`,
      1,
    ),
  };
  validateEntryRequestShape(request);
  const contexts = transcripts.map((proof) => proof.context_minutes);
  if (new Set(contexts).size !== contexts.length) {
    fail(`${name} contains duplicate proof contexts`);
  }
  return request;
}

function scanValue(
  value: StrictJsonValue,
  name: string,
): RawHtfScanRequest {
  const object = objectValue(value, name);
  exactKeys(
    object,
    [
      "timeframe_minutes",
      "htf_open_epoch",
      "scan_cutoff_epoch",
      "htf_open_ticks",
      "children",
      "proof_resolution_seconds",
      "full_lifecycle_ordered",
    ],
    name,
  );
  const scan: RawHtfScanRequest = {
    timeframe_minutes: contextValue(
      field(object, "timeframe_minutes", name),
      `${name}.timeframe_minutes`,
    ),
    htf_open_epoch: integerValue(
      field(object, "htf_open_epoch", name),
      `${name}.htf_open_epoch`,
      0,
    ),
    scan_cutoff_epoch: integerValue(
      field(object, "scan_cutoff_epoch", name),
      `${name}.scan_cutoff_epoch`,
      0,
    ),
    htf_open_ticks: integerValue(
      field(object, "htf_open_ticks", name),
      `${name}.htf_open_ticks`,
    ),
    children: arrayValue(
      field(object, "children", name),
      `${name}.children`,
      3_600,
    ).map((item, index) => candleValue(item, `${name}.children[${index}]`)),
    proof_resolution_seconds: integerValue(
      field(object, "proof_resolution_seconds", name),
      `${name}.proof_resolution_seconds`,
      1,
    ),
    full_lifecycle_ordered: booleanValue(
      field(object, "full_lifecycle_ordered", name),
      `${name}.full_lifecycle_ordered`,
    ),
  };
  const coverage = scan.scan_cutoff_epoch - scan.htf_open_epoch;
  if (
    coverage <= 0 ||
    coverage > scan.timeframe_minutes * 60 ||
    coverage % 300 !== 0 ||
    scan.proof_resolution_seconds >= 300 ||
    300 % scan.proof_resolution_seconds !== 0 ||
    coverage % scan.proof_resolution_seconds !== 0
  ) {
    fail(`${name} has invalid bounded resolution or coverage`);
  }
  let previousOpen: number | null = null;
  for (const child of scan.children) {
    if (
      (previousOpen !== null && child.open_epoch <= previousOpen) ||
      child.open_epoch < scan.htf_open_epoch ||
      child.close_epoch > scan.scan_cutoff_epoch ||
      (child.open_epoch - scan.htf_open_epoch) %
            scan.proof_resolution_seconds !==
        0
    ) {
      fail(`${name} has invalid child chronology or coverage`);
    }
    previousOpen = child.open_epoch;
  }
  return scan;
}

function rawEventValue(
  value: StrictJsonValue,
  name: string,
): RawEntryEvent {
  const object = objectValue(value, name);
  exactKeys(object, ["event_id", "match_request", "htf_scan_requests"], name);
  const event: RawEntryEvent = {
    event_id: textValue(
      field(object, "event_id", name),
      `${name}.event_id`,
      true,
    ),
    match_request: matchRequestValue(
      field(object, "match_request", name),
      `${name}.match_request`,
    ),
    htf_scan_requests: arrayValue(
      field(object, "htf_scan_requests", name),
      `${name}.htf_scan_requests`,
      3,
    ).map((item, index) =>
      scanValue(item, `${name}.htf_scan_requests[${index}]`)
    ),
  };
  if (
    event.match_request.htf_proofs.length > 0 &&
    event.htf_scan_requests.length > 0
  ) {
    fail(`${name} mixes raw scans and expanded proofs`);
  }
  const contexts = event.htf_scan_requests.map(
    (scan) => scan.timeframe_minutes,
  );
  if (new Set(contexts).size !== contexts.length) {
    fail(`${name} contains duplicate scan contexts`);
  }
  return event;
}

function edgeEventValue(
  value: StrictJsonValue,
  name: string,
): EntryStreamEvent {
  const object = objectValue(value, name);
  exactKeys(object, ["event_id", "match_request"], name);
  return {
    event_id: textValue(
      field(object, "event_id", name),
      `${name}.event_id`,
      true,
    ),
    match_request: matchRequestValue(
      field(object, "match_request", name),
      `${name}.match_request`,
    ),
  };
}

function rawInputValue(
  value: StrictJsonValue,
  name: string,
): RawEntryInput {
  const object = objectValue(value, name);
  exactKeys(object, INPUT_KEYS, name);
  const policy = field(object, "policy_version", name);
  if (policy !== "rd-entry-arbitration-v2") {
    fail(`${name}.policy_version is unsupported`);
  }
  return {
    setup_id: textValue(
      field(object, "setup_id", name),
      `${name}.setup_id`,
      true,
    ),
    events: arrayValue(field(object, "events", name), `${name}.events`).map(
      (item, index) => rawEventValue(item, `${name}.events[${index}]`),
    ),
    setup_invalidated: booleanValue(
      field(object, "setup_invalidated", name),
      `${name}.setup_invalidated`,
    ),
    policy_version: policy,
    revision: integerValue(
      field(object, "revision", name),
      `${name}.revision`,
      0,
    ),
    evaluated_at_epoch: integerValue(
      field(object, "evaluated_at_epoch", name),
      `${name}.evaluated_at_epoch`,
      0,
    ),
  };
}

function edgeInputValue(
  value: StrictJsonValue,
  name: string,
): RdEntryEdgeVectorInput {
  const object = objectValue(value, name);
  exactKeys(object, INPUT_KEYS, name);
  const policy = field(object, "policy_version", name);
  if (policy !== "rd-entry-arbitration-v2") {
    fail(`${name}.policy_version is unsupported`);
  }
  return {
    setup_id: textValue(
      field(object, "setup_id", name),
      `${name}.setup_id`,
      true,
    ),
    events: arrayValue(field(object, "events", name), `${name}.events`).map(
      (item, index) => edgeEventValue(item, `${name}.events[${index}]`),
    ),
    setup_invalidated: booleanValue(
      field(object, "setup_invalidated", name),
      `${name}.setup_invalidated`,
    ),
    policy_version: policy,
    revision: integerValue(
      field(object, "revision", name),
      `${name}.revision`,
      0,
    ),
    evaluated_at_epoch: integerValue(
      field(object, "evaluated_at_epoch", name),
      `${name}.evaluated_at_epoch`,
      0,
    ),
  };
}

function optionalFidelity(
  value: StrictJsonValue,
  name: string,
): CandidateFidelity | null {
  return value === null ? null : fidelityValue(value, name);
}

function candidateValue(
  value: StrictJsonValue,
  name: string,
): EntryCandidate {
  const object = objectValue(value, name);
  exactKeys(
    object,
    [
      "candidate_id",
      "setup_id",
      "model",
      "state",
      "event_anchor_epoch",
      "trigger_ordinal",
      "direction",
      "source_claim_ids",
      "normalized_from",
      "observed_at_epoch",
    ],
    name,
  );
  return {
    candidate_id: sha256Value(
      field(object, "candidate_id", name),
      `${name}.candidate_id`,
    ),
    setup_id: textValue(
      field(object, "setup_id", name),
      `${name}.setup_id`,
      true,
    ),
    model: entryModelValue(field(object, "model", name), `${name}.model`),
    state: candidateStateValue(
      field(object, "state", name),
      `${name}.state`,
    ),
    event_anchor_epoch: integerValue(
      field(object, "event_anchor_epoch", name),
      `${name}.event_anchor_epoch`,
      0,
    ),
    trigger_ordinal: integerValue(
      field(object, "trigger_ordinal", name),
      `${name}.trigger_ordinal`,
      1,
    ),
    direction: directionValue(
      field(object, "direction", name),
      `${name}.direction`,
    ),
    source_claim_ids: stringArray(
      field(object, "source_claim_ids", name),
      `${name}.source_claim_ids`,
    ),
    normalized_from: optionalEntryModel(
      field(object, "normalized_from", name),
      `${name}.normalized_from`,
    ),
    observed_at_epoch: integerValue(
      field(object, "observed_at_epoch", name),
      `${name}.observed_at_epoch`,
      0,
    ),
  };
}

function evidenceValue(
  value: StrictJsonValue,
  name: string,
): EntryCandidateEvidence {
  const object = objectValue(value, name);
  exactKeys(
    object,
    [
      "evidence_id",
      "candidate_id",
      "observed_trigger_epoch",
      "observed_trigger_ticks",
      "htf_context_minutes",
      "fidelity",
      "proof_plane",
      "proof_resolution_seconds",
      "coverage_start_epoch",
      "coverage_end_epoch",
      "ambiguity_codes",
      "passed_rule_ids",
      "failed_rule_ids",
      "source_claim_ids",
      "payload_sha256",
      "observed_at_epoch",
    ],
    name,
  );
  const contexts = arrayValue(
    field(object, "htf_context_minutes", name),
    `${name}.htf_context_minutes`,
    3,
  ).map((item, index) =>
    contextValue(item, `${name}.htf_context_minutes[${index}]`)
  );
  const ambiguityCodes = arrayValue(
    field(object, "ambiguity_codes", name),
    `${name}.ambiguity_codes`,
  ).map((item, index) =>
    ambiguityValue(item, `${name}.ambiguity_codes[${index}]`)
  );
  const evidence: EntryCandidateEvidence = {
    evidence_id: sha256Value(
      field(object, "evidence_id", name),
      `${name}.evidence_id`,
    ),
    candidate_id: sha256Value(
      field(object, "candidate_id", name),
      `${name}.candidate_id`,
    ),
    observed_trigger_epoch: optionalInteger(
      field(object, "observed_trigger_epoch", name),
      `${name}.observed_trigger_epoch`,
      0,
    ),
    observed_trigger_ticks: optionalInteger(
      field(object, "observed_trigger_ticks", name),
      `${name}.observed_trigger_ticks`,
    ),
    htf_context_minutes: contexts,
    fidelity: fidelityValue(
      field(object, "fidelity", name),
      `${name}.fidelity`,
    ),
    proof_plane: proofPlaneValue(
      field(object, "proof_plane", name),
      `${name}.proof_plane`,
    ),
    proof_resolution_seconds: integerValue(
      field(object, "proof_resolution_seconds", name),
      `${name}.proof_resolution_seconds`,
      1,
    ),
    coverage_start_epoch: integerValue(
      field(object, "coverage_start_epoch", name),
      `${name}.coverage_start_epoch`,
      0,
    ),
    coverage_end_epoch: integerValue(
      field(object, "coverage_end_epoch", name),
      `${name}.coverage_end_epoch`,
      0,
    ),
    ambiguity_codes: ambiguityCodes,
    passed_rule_ids: stringArray(
      field(object, "passed_rule_ids", name),
      `${name}.passed_rule_ids`,
    ),
    failed_rule_ids: stringArray(
      field(object, "failed_rule_ids", name),
      `${name}.failed_rule_ids`,
    ),
    source_claim_ids: stringArray(
      field(object, "source_claim_ids", name),
      `${name}.source_claim_ids`,
    ),
    payload_sha256: sha256Value(
      field(object, "payload_sha256", name),
      `${name}.payload_sha256`,
    ),
    observed_at_epoch: integerValue(
      field(object, "observed_at_epoch", name),
      `${name}.observed_at_epoch`,
      0,
    ),
  };
  if (
    (evidence.observed_trigger_epoch === null) !==
      (evidence.observed_trigger_ticks === null) ||
    evidence.coverage_end_epoch <= evidence.coverage_start_epoch ||
    canonicalStringifyRdEntry(contexts) !==
      canonicalStringifyRdEntry(
        [...contexts].sort((left, right) => left - right),
      ) ||
    new Set(contexts).size !== contexts.length ||
    new Set(ambiguityCodes).size !== ambiguityCodes.length
  ) {
    fail(`${name} has contradictory evidence fields`);
  }
  return evidence;
}

function handlingValue(
  value: StrictJsonValue,
  name: string,
): EntryHandlingObservation {
  const object = objectValue(value, name);
  exactKeys(
    object,
    [
      "handling_id",
      "candidate_id",
      "evidence_id",
      "handling_mode",
      "attempt_kind",
      "observed_epoch",
      "observed_ticks",
      "fidelity",
      "source_claim_ids",
    ],
    name,
  );
  return {
    handling_id: sha256Value(
      field(object, "handling_id", name),
      `${name}.handling_id`,
    ),
    candidate_id: sha256Value(
      field(object, "candidate_id", name),
      `${name}.candidate_id`,
    ),
    evidence_id: sha256Value(
      field(object, "evidence_id", name),
      `${name}.evidence_id`,
    ),
    handling_mode: handlingModeValue(
      field(object, "handling_mode", name),
      `${name}.handling_mode`,
    ),
    attempt_kind: attemptKindValue(
      field(object, "attempt_kind", name),
      `${name}.attempt_kind`,
    ),
    observed_epoch: integerValue(
      field(object, "observed_epoch", name),
      `${name}.observed_epoch`,
      0,
    ),
    observed_ticks: optionalInteger(
      field(object, "observed_ticks", name),
      `${name}.observed_ticks`,
    ),
    fidelity: fidelityValue(
      field(object, "fidelity", name),
      `${name}.fidelity`,
    ),
    source_claim_ids: stringArray(
      field(object, "source_claim_ids", name),
      `${name}.source_claim_ids`,
    ),
  };
}

function selectionValue(
  value: StrictJsonValue,
  name: string,
): EntrySelection {
  const object = objectValue(value, name);
  exactKeys(
    object,
    [
      "selection_id",
      "setup_id",
      "policy_version",
      "revision",
      "candidate_ids_considered",
      "canonical_candidate_id",
      "canonical_evidence_id",
      "canonical_model",
      "reason",
      "fidelity",
      "action",
      "evaluated_at_epoch",
    ],
    name,
  );
  const policy = field(object, "policy_version", name);
  if (policy !== "rd-entry-arbitration-v2") {
    fail(`${name}.policy_version is unsupported`);
  }
  const considered = arrayValue(
    field(object, "candidate_ids_considered", name),
    `${name}.candidate_ids_considered`,
  ).map((item, index) =>
    sha256Value(item, `${name}.candidate_ids_considered[${index}]`)
  );
  const selection: EntrySelection = {
    selection_id: sha256Value(
      field(object, "selection_id", name),
      `${name}.selection_id`,
    ),
    setup_id: textValue(
      field(object, "setup_id", name),
      `${name}.setup_id`,
      true,
    ),
    policy_version: policy,
    revision: integerValue(
      field(object, "revision", name),
      `${name}.revision`,
      0,
    ),
    candidate_ids_considered: considered,
    canonical_candidate_id: optionalSha256(
      field(object, "canonical_candidate_id", name),
      `${name}.canonical_candidate_id`,
    ),
    canonical_evidence_id: optionalSha256(
      field(object, "canonical_evidence_id", name),
      `${name}.canonical_evidence_id`,
    ),
    canonical_model: optionalEntryModel(
      field(object, "canonical_model", name),
      `${name}.canonical_model`,
    ),
    reason: selectionReasonValue(
      field(object, "reason", name),
      `${name}.reason`,
    ),
    fidelity: optionalFidelity(
      field(object, "fidelity", name),
      `${name}.fidelity`,
    ),
    action: selectionActionValue(
      field(object, "action", name),
      `${name}.action`,
    ),
    evaluated_at_epoch: integerValue(
      field(object, "evaluated_at_epoch", name),
      `${name}.evaluated_at_epoch`,
      0,
    ),
  };
  if (
    (selection.canonical_candidate_id === null) !==
      (selection.canonical_evidence_id === null) ||
    canonicalStringifyRdEntry(considered) !==
      canonicalStringifyRdEntry([...considered].sort()) ||
    new Set(considered).size !== considered.length
  ) {
    fail(`${name} has contradictory canonical selection fields`);
  }
  return selection;
}

function expectedValue(
  value: StrictJsonValue,
  name: string,
): RdEntryExpectedVector {
  const object = objectValue(value, name);
  exactKeys(
    object,
    ["htf_transcripts", "candidates", "evidence", "handling", "selection"],
    name,
  );
  const transcripts = arrayValue(
    field(object, "htf_transcripts", name),
    `${name}.htf_transcripts`,
    3,
  ).map((item, index) =>
    transcriptValue(item, `${name}.htf_transcripts[${index}]`)
  );
  const candidates = arrayValue(
    field(object, "candidates", name),
    `${name}.candidates`,
  ).map((item, index) => candidateValue(item, `${name}.candidates[${index}]`));
  const evidence = arrayValue(
    field(object, "evidence", name),
    `${name}.evidence`,
  ).map((item, index) => evidenceValue(item, `${name}.evidence[${index}]`));
  const handling = arrayValue(
    field(object, "handling", name),
    `${name}.handling`,
  ).map((item, index) => handlingValue(item, `${name}.handling[${index}]`));
  const selection = selectionValue(
    field(object, "selection", name),
    `${name}.selection`,
  );
  const contexts = transcripts.map((item) => item.context_minutes);
  const candidateIds = candidates.map((item) => item.candidate_id);
  const evidenceIds = evidence.map((item) => item.evidence_id);
  const handlingIds = handling.map((item) => item.handling_id);
  const candidateSet = new Set(candidateIds);
  const evidenceSet = new Set(evidenceIds);
  for (
    const [ids, fieldName] of [
      [candidateIds, "candidates"],
      [evidenceIds, "evidence"],
      [handlingIds, "handling"],
    ] as const
  ) {
    if (
      canonicalStringifyRdEntry(ids) !==
        canonicalStringifyRdEntry([...ids].sort()) ||
      new Set(ids).size !== ids.length
    ) {
      fail(`${name}.${fieldName} must be ID-sorted and unique`);
    }
  }
  if (
    canonicalStringifyRdEntry(contexts) !==
      canonicalStringifyRdEntry(
        [...contexts].sort((left, right) => left - right),
      ) ||
    new Set(contexts).size !== contexts.length ||
    evidence.some((item) => !candidateSet.has(item.candidate_id)) ||
    handling.some(
      (item) =>
        !candidateSet.has(item.candidate_id) ||
        !evidenceSet.has(item.evidence_id),
    )
  ) {
    fail(`${name} has an invalid owned result graph`);
  }
  return {
    htf_transcripts: transcripts,
    candidates,
    evidence,
    handling,
    selection,
  };
}

function caseValue(
  value: StrictJsonValue,
  name: string,
): RdEntryOracleVectorCase {
  const object = objectValue(value, name);
  exactKeys(
    object,
    [
      "case_id",
      "setup_id",
      "symbol",
      "feed",
      "calculation_start_epoch",
      "emission_start_epoch",
      "emission_end_epoch",
      "pine_supported",
      "input",
      "edge_input",
      "pine_edge_input",
      "expected",
      "pine_expected",
    ],
    name,
  );
  return {
    case_id: textValue(field(object, "case_id", name), `${name}.case_id`, true),
    setup_id: textValue(
      field(object, "setup_id", name),
      `${name}.setup_id`,
      true,
    ),
    symbol: textValue(field(object, "symbol", name), `${name}.symbol`, true),
    feed: textValue(field(object, "feed", name), `${name}.feed`, true),
    calculation_start_epoch: integerValue(
      field(object, "calculation_start_epoch", name),
      `${name}.calculation_start_epoch`,
      0,
    ),
    emission_start_epoch: integerValue(
      field(object, "emission_start_epoch", name),
      `${name}.emission_start_epoch`,
      0,
    ),
    emission_end_epoch: integerValue(
      field(object, "emission_end_epoch", name),
      `${name}.emission_end_epoch`,
      0,
    ),
    pine_supported: booleanValue(
      field(object, "pine_supported", name),
      `${name}.pine_supported`,
    ),
    input: rawInputValue(field(object, "input", name), `${name}.input`),
    edge_input: edgeInputValue(
      field(object, "edge_input", name),
      `${name}.edge_input`,
    ),
    pine_edge_input: edgeInputValue(
      field(object, "pine_edge_input", name),
      `${name}.pine_edge_input`,
    ),
    expected: expectedValue(
      field(object, "expected", name),
      `${name}.expected`,
    ),
    pine_expected: expectedValue(
      field(object, "pine_expected", name),
      `${name}.pine_expected`,
    ),
  };
}

function contactsZone(
  setup: SetupEntryFacts,
  candle: OrderedCandle,
): boolean {
  return (
    candle.low_ticks <= setup.zone_top_ticks &&
    candle.high_ticks >= setup.zone_bottom_ticks
  );
}

function recrossesHtfOpen(
  setup: SetupEntryFacts,
  htfOpenTicks: number,
  candle: OrderedCandle,
): boolean {
  return setup.direction === "LONG"
    ? candle.high_ticks > htfOpenTicks
    : candle.low_ticks < htfOpenTicks;
}

async function scanHtfFlip(
  setup: SetupEntryFacts,
  scan: RawHtfScanRequest,
): Promise<HTFFlipProofTranscript> {
  const childrenByOpen = new Map<number, OrderedCandle>();
  for (const child of scan.children) {
    if (
      child.close_epoch - child.open_epoch ===
        scan.proof_resolution_seconds
    ) {
      childrenByOpen.set(child.open_epoch, child);
    }
  }
  const expectedCount = (scan.scan_cutoff_epoch - scan.htf_open_epoch) /
    scan.proof_resolution_seconds;
  let contact: OrderedCandle | null = null;
  let recross: OrderedCandle | null = null;
  let destinationSeenBeforeContact = false;
  for (let index = 0; index < expectedCount; index += 1) {
    const child = childrenByOpen.get(
      scan.htf_open_epoch + index * scan.proof_resolution_seconds,
    );
    if (child === undefined) {
      contact = null;
      recross = null;
      continue;
    }
    if (recross !== null) continue;
    const contacts = contactsZone(setup, child);
    const recrosses = recrossesHtfOpen(setup, scan.htf_open_ticks, child);
    if (contact === null) {
      if (!contacts) {
        destinationSeenBeforeContact ||= recrosses;
        continue;
      }
      contact = child;
      if (recrosses) recross = child;
      continue;
    }
    if (recrosses) recross = child;
  }
  const transcript: HTFFlipProofTranscript = {
    context_minutes: scan.timeframe_minutes,
    htf_open_epoch: scan.htf_open_epoch,
    htf_open_ticks: scan.htf_open_ticks,
    scan_cutoff_epoch: scan.scan_cutoff_epoch,
    proof_resolution_seconds: scan.proof_resolution_seconds,
    coverage_start_epoch: scan.htf_open_epoch,
    coverage_end_epoch: scan.scan_cutoff_epoch,
    expected_child_count: expectedCount,
    observed_child_count: childrenByOpen.size,
    gap_present: childrenByOpen.size !== expectedCount,
    full_lifecycle_ordered: scan.full_lifecycle_ordered,
    destination_seen_before_contact: destinationSeenBeforeContact,
    contact_candle: contact,
    recross_candle: recross,
    same_child: contact !== null &&
      recross !== null &&
      contact.open_epoch === recross.open_epoch &&
      contact.close_epoch === recross.close_epoch,
  };
  return (await validateHtfFlipProof(setup, transcript)).transcript;
}

async function expandRawInput(
  input: RawEntryInput,
): Promise<RdEntryEdgeVectorInput> {
  const events: EntryStreamEvent[] = [];
  for (const event of input.events) {
    const proofs = event.match_request.htf_proofs.length > 0
      ? event.match_request.htf_proofs
      : await Promise.all(
        event.htf_scan_requests.map((scan) =>
          scanHtfFlip(event.match_request.setup, scan)
        ),
      );
    const transcripts = proofs.map((proof) => {
      if ("matched" in proof) return proof.transcript;
      return proof;
    }).sort(
      (left, right) =>
        left.context_minutes - right.context_minutes ||
        left.htf_open_epoch - right.htf_open_epoch ||
        left.scan_cutoff_epoch - right.scan_cutoff_epoch,
    );
    events.push({
      event_id: event.event_id,
      match_request: {
        ...event.match_request,
        htf_proofs: transcripts,
      },
    });
  }
  return {
    setup_id: input.setup_id,
    events,
    setup_invalidated: input.setup_invalidated,
    policy_version: input.policy_version,
    revision: input.revision,
    evaluated_at_epoch: input.evaluated_at_epoch,
  };
}

function pineProjection(
  input: RdEntryEdgeVectorInput,
): RdEntryEdgeVectorInput {
  return {
    ...input,
    events: input.events.map((event) => ({
      ...event,
      match_request: {
        ...event.match_request,
        setup: {
          ...event.match_request.setup,
          common_fidelity: "UNRESOLVED",
        },
      },
    })),
  };
}

function finalTranscripts(
  input: RdEntryEdgeVectorInput,
): readonly HTFFlipProofTranscript[] {
  const transcripts = new Map<number, HTFFlipProofTranscript>();
  const ordered = [...input.events].sort(
    (left, right) =>
      left.match_request.confirmed_bar.close_epoch -
        right.match_request.confirmed_bar.close_epoch ||
      left.event_id.localeCompare(right.event_id),
  );
  for (const event of ordered) {
    for (const proof of event.match_request.htf_proofs) {
      const transcript = "matched" in proof ? proof.transcript : proof;
      const previous = transcripts.get(transcript.context_minutes);
      if (
        previous === undefined ||
        transcript.htf_open_epoch > previous.htf_open_epoch ||
        (transcript.htf_open_epoch === previous.htf_open_epoch &&
          transcript.scan_cutoff_epoch > previous.scan_cutoff_epoch)
      ) {
        transcripts.set(transcript.context_minutes, transcript);
      }
    }
  }
  return [...transcripts.values()].sort(
    (left, right) => left.context_minutes - right.context_minutes,
  );
}

function evaluationWithTranscripts(
  evaluation: EntryEvaluation,
  input: RdEntryEdgeVectorInput,
): RdEntryExpectedVector {
  return {
    htf_transcripts: finalTranscripts(input),
    candidates: evaluation.candidates,
    evidence: evaluation.evidence,
    handling: evaluation.handling,
    selection: evaluation.selection,
  };
}

function assertCanonicalEqual(
  left: object,
  right: object,
  message: string,
): void {
  if (
    canonicalStringifyRdEntry(left) !==
      canonicalStringifyRdEntry(right)
  ) {
    fail(message);
  }
}

function eventIdentityMap(
  events: readonly { readonly event_id: string }[],
  name: string,
): void {
  const seen = new Map<string, string>();
  for (const event of events) {
    const canonical = canonicalStringifyRdEntry(event);
    const previous = seen.get(event.event_id);
    if (previous !== undefined && previous !== canonical) {
      fail(`${name} event ID carries conflicting immutable content`);
    }
    seen.set(event.event_id, canonical);
  }
}

async function validateCaseSemantics(
  vector: RdEntryOracleVectorCase,
  name: string,
): Promise<void> {
  if (
    !(
      vector.calculation_start_epoch <= vector.emission_start_epoch &&
      vector.emission_start_epoch <= vector.emission_end_epoch
    )
  ) {
    fail(`${name} replay metadata epochs are out of order`);
  }
  const inputs = [
    vector.input,
    vector.edge_input,
    vector.pine_edge_input,
  ] as const;
  if (
    inputs.some((input) => input.setup_id !== vector.setup_id) ||
    vector.expected.selection.setup_id !== vector.setup_id ||
    vector.pine_expected.selection.setup_id !== vector.setup_id
  ) {
    fail(`${name} setup IDs disagree across views`);
  }
  if (vector.pine_expected.selection.action === "PAPER_ELIGIBLE") {
    fail(`${name}.pine_expected is promotable`);
  }
  eventIdentityMap(vector.input.events, `${name}.input`);
  eventIdentityMap(vector.edge_input.events, `${name}.edge_input`);
  eventIdentityMap(vector.pine_edge_input.events, `${name}.pine_edge_input`);
  const rawIds = vector.input.events.map((event) => event.event_id);
  if (
    canonicalStringifyRdEntry(rawIds) !==
      canonicalStringifyRdEntry(
        vector.edge_input.events.map((event) => event.event_id),
      ) ||
    canonicalStringifyRdEntry(rawIds) !==
      canonicalStringifyRdEntry(
        vector.pine_edge_input.events.map((event) => event.event_id),
      )
  ) {
    fail(`${name} event views do not preserve raw order`);
  }
  for (const input of inputs) {
    for (const event of input.events) {
      const request = event.match_request;
      if (
        request.setup.setup_id !== vector.setup_id ||
        request.confirmed_bar.close_epoch < vector.emission_start_epoch ||
        request.confirmed_bar.close_epoch > vector.emission_end_epoch
      ) {
        fail(`${name} event lies outside setup or emission scope`);
      }
    }
  }
  if (
    vector.pine_edge_input.events.some(
      (event) => event.match_request.setup.common_fidelity !== "UNRESOLVED",
    )
  ) {
    fail(`${name} Pine input contains resolved common fidelity`);
  }

  const expanded = await expandRawInput(vector.input);
  assertCanonicalEqual(
    expanded,
    vector.edge_input,
    `${name}.edge_input is not the canonical raw expansion`,
  );
  assertCanonicalEqual(
    pineProjection(vector.edge_input),
    vector.pine_edge_input,
    `${name}.pine_edge_input changes more than common fidelity`,
  );

  const edgeEvaluation = await evaluateEntryStream(
    vector.edge_input.events,
    vector.edge_input.setup_invalidated,
    vector.edge_input.revision,
    vector.edge_input.evaluated_at_epoch,
  );
  assertCanonicalEqual(
    evaluationWithTranscripts(edgeEvaluation, vector.edge_input),
    vector.expected,
    `${name}.expected does not match Edge evaluation`,
  );
  const pineEvaluation = await evaluateEntryStream(
    vector.pine_edge_input.events,
    vector.pine_edge_input.setup_invalidated,
    vector.pine_edge_input.revision,
    vector.pine_edge_input.evaluated_at_epoch,
  );
  assertCanonicalEqual(
    evaluationWithTranscripts(pineEvaluation, vector.pine_edge_input),
    vector.pine_expected,
    `${name}.pine_expected does not match Pine evaluation`,
  );
}

export async function parseRdEntryOracleVectorDocument(
  bytes: Uint8Array,
): Promise<RdEntryOracleVectorDocument> {
  const root = objectValue(parseStrictJson(bytes), "document");
  exactKeys(root, ["schema_id", "cases"], "document");
  if (
    field(root, "schema_id", "document") !==
      "phase0.rd-entry-arbitration-vectors.v2"
  ) {
    fail("document.schema_id is unsupported");
  }
  const cases = arrayValue(field(root, "cases", "document"), "document.cases");
  if (cases.length !== 24) {
    fail("document must contain exactly 24 reviewed cases");
  }
  const parsed = cases.map((item, index) =>
    caseValue(item, `document.cases[${index}]`)
  );
  const caseIds = parsed.map((item) => item.case_id);
  if (new Set(caseIds).size !== caseIds.length) {
    fail("document case IDs must be unique");
  }
  const setupAttempts = new Map<string, Set<AttemptKind>>();
  for (const [index, vector] of parsed.entries()) {
    await validateCaseSemantics(vector, `document.cases[${index}]`);
    const attempts = setupAttempts.get(vector.setup_id) ??
      new Set<AttemptKind>();
    for (const event of vector.input.events) {
      attempts.add(event.match_request.attempt_kind);
    }
    setupAttempts.set(vector.setup_id, attempts);
  }
  if ([...setupAttempts.values()].some((attempts) => attempts.size > 1)) {
    fail("setup ID spans initial and re-entry attempts");
  }
  const unsupported = parsed
    .filter((item) => !item.pine_supported)
    .map((item) => item.case_id)
    .sort();
  if (
    canonicalStringifyRdEntry(unsupported) !==
      canonicalStringifyRdEntry(
        ["re-entry-attempt", "replay-realtime-one-candidate"].sort(),
      )
  ) {
    fail("pine_supported case set is not frozen");
  }
  return {
    schema_id: "phase0.rd-entry-arbitration-vectors.v2",
    cases: parsed,
  };
}
