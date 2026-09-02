import {
  candidateIdV3,
  evidenceIdV3,
  evidencePayloadSha256V3,
  selectionIdV3,
  validateEntryCandidateV3,
  validateEntryEvaluationV3,
  validateEntryEvidenceV3,
  validateLiquidityCohortV3,
  validateOrderedCandleV3,
  validateSelectionShapeV3,
  type CandidateFidelityV3,
  type EntryCandidateEvidenceV3,
  type EntryCandidateV3,
  type EntryDirectionV3,
  type EntryEvaluationV3,
  type EntryModelV3,
  type EntrySelectionV3,
  type OrderedCandleV3,
  type SetupEntryFactsV3,
} from "./rd-entry-domain-v3";
import { arbitrateEntryCandidatesV3 } from "./rd-entry-arbitrator-v3";
import {
  isStrictJsonNumber,
  type StrictJsonValue,
} from "./strict-json";
import type {
  CanonicalObject,
  ReceiptMetadata,
} from "./types";

export const ENTRY_V3_MAX_PAYLOAD_CHARACTERS = 35_000;
export const REQUIRED_COMMON_RULE_IDS_V3 = [
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
] as const;

const TOP_LEVEL_KEYS = [
  "schema_version",
  "strategy_id",
  "strategy_version",
  "rule_contract_version",
  "execution_mode",
  "producer_instance_id",
  "producer_sequence",
  "event_id",
  "is_realtime",
  "symbol",
  "ticker_id",
  "feed",
  "timeframe",
  "tick_size",
  "detector_code_hash",
  "settings_hash",
  "observed_at_epoch",
  "market_event",
  "exit_events",
  "setups",
] as const;
const SETUP_BUNDLE_KEYS = [
  "setup",
  "candidates",
  "evidence",
  "selection_proposal",
  "trade_plan",
] as const;
const SETUP_KEYS_V30 = [
  "setup_id",
  "direction",
  "zone_top_ticks",
  "zone_bottom_ticks",
  "zone_engaged_epoch",
  "invalidated_before_entry",
  "common_fidelity",
  "common_rule_results",
] as const;
const SETUP_KEYS_V31 = [
  ...SETUP_KEYS_V30,
  "liquidity_cohort",
  "one_candle_enabled",
] as const;
const CANDIDATE_KEYS = [
  "candidate_id",
  "setup_id",
  "model",
  "state",
  "direction",
  "event_anchor_epoch",
  "trigger_ordinal",
  "boc_tier",
  "reference_candle_open_epoch",
  "source_claim_ids",
  "observed_at_epoch",
] as const;
const EVIDENCE_KEYS = [
  "evidence_id",
  "candidate_id",
  "observed_trigger_epoch",
  "trigger_sequence",
  "observed_trigger_ticks",
  "htf_context_minutes",
  "fidelity",
  "proof_plane",
  "replayability",
  "coverage_start_epoch",
  "coverage_end_epoch",
  "ambiguity_codes",
  "boc_tier",
  "reference_candle_open_epoch",
  "reference_candle_open_ticks",
  "reference_candle_high_ticks",
  "reference_candle_low_ticks",
  "reference_candle_close_ticks",
  "htf_open_ticks",
  "contact_candle",
  "recross_candle",
  "coverage_gap_detected",
  "full_lifecycle_ordered",
  "destination_seen_before_contact",
  "passed_rule_ids",
  "failed_rule_ids",
  "source_claim_ids",
  "payload_sha256",
  "observed_at_epoch",
] as const;
const SELECTION_KEYS = [
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
  "co_triggered_models",
  "evaluated_at_epoch",
] as const;
const CANDLE_KEYS = [
  "open_epoch",
  "close_epoch",
  "open_ticks",
  "high_ticks",
  "low_ticks",
  "close_ticks",
] as const;
const MARKET_EVENT_KEYS = [
  "epoch",
  "sequence",
  "tick_price_ticks",
  "barstate_isconfirmed",
  "confirmed_bar",
] as const;
const TRADE_PLAN_KEYS = [
  "direction",
  "entry_ticks",
  "stop_ticks",
  "target_ticks",
] as const;
const EXIT_EVENT_KEYS = [
  "event_id",
  "setup_id",
  "exit_reason",
  "epoch",
  "sequence",
  "price_ticks",
] as const;
const SHA256 = /^[a-f0-9]{64}$/u;
const EDGE_DERIVED_DIGEST = "EDGE_DERIVED";
const EDGE_DERIVED_REFERENCE =
  /^EDGE_DERIVED:(BOC|DIR_CLOSE|HTF_FLIP)$/u;
const IDENTIFIER = /^[\x21-\x5b\x5d-\x7e]+$/u;
const POSITIVE_DECIMAL =
  /^(?:0\.[0-9]*[1-9][0-9]*|[1-9][0-9]*(?:\.[0-9]+)?)$/u;
const ONE_CANDLE_EXPECTED_FAILED_RULES = new Set([
  "LIQ_INTERNAL_REBREAK",
  "LIQ_NORMAL_TWO_OPPOSITE_CANDLES",
]);

type EntryV3SchemaVersion = "3.0" | "3.1";

export class EntryV3ValidationError extends Error {
  constructor(message = "ENTRY_V3_INVALID") {
    super(message);
    this.name = "EntryV3ValidationError";
  }
}

export interface EntryV3CommonRuleResult {
  readonly rule_id: (typeof REQUIRED_COMMON_RULE_IDS_V3)[number];
  readonly passed: boolean;
}

export interface EntryV3ReviewedProducerHashes {
  readonly detector_code_hash: string;
  readonly settings_hash: string;
}

export interface EntryV3MarketEvent {
  readonly epoch: number;
  readonly sequence: number;
  readonly tick_price_ticks: number;
  readonly barstate_isconfirmed: boolean;
  readonly confirmed_bar: OrderedCandleV3 | null;
}

export interface EntryV3TradePlan {
  readonly direction: EntryDirectionV3;
  readonly entry_ticks: number;
  readonly stop_ticks: number;
  readonly target_ticks: number;
}

export interface EntryV3ExitEvent {
  readonly event_id: string;
  readonly setup_id: string;
  readonly exit_reason:
    | "STOP_LOSS"
    | "TARGET"
    | "AMBIGUOUS_SAME_BAR_EXIT";
  readonly epoch: number;
  readonly sequence: number;
  readonly price_ticks: number;
}

/**
 * Internal authorization boundary derived from the closed raw payload.
 * Task 5 may create an intent only for ENTRY_DECISION; EXIT_FOLLOWUP is audit
 * plus a conditional update to an already-linked durable attempt.
 */
export type EntryV3EventRole = "ENTRY_DECISION" | "EXIT_FOLLOWUP";

export interface ValidatedEntryV3Bundle {
  readonly setup: SetupEntryFactsV3;
  readonly commonRuleResults: readonly EntryV3CommonRuleResult[];
  readonly candidates: readonly EntryCandidateV3[];
  readonly evidence: readonly EntryCandidateEvidenceV3[];
  readonly selectionProposal: EntrySelectionV3;
  readonly evaluation: EntryEvaluationV3;
  readonly tradePlan: EntryV3TradePlan;
}

export interface ValidatedEntryV3Payload {
  readonly canonicalPayload: CanonicalObject;
  readonly metadata: ReceiptMetadata;
  readonly eventRole: EntryV3EventRole;
  readonly producerSequence: number;
  readonly eventId: string;
  readonly isRealtime: boolean;
  readonly detectorCodeHash: string;
  readonly settingsHash: string;
  readonly tickSize: string;
  readonly observedAtEpoch: number;
  readonly marketEvent: EntryV3MarketEvent;
  readonly exitEvents: readonly EntryV3ExitEvent[];
  readonly entryBundles: readonly ValidatedEntryV3Bundle[];
}

function fail(code = "ENTRY_V3_INVALID"): never {
  throw new EntryV3ValidationError(code);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const result = value as Record<string, unknown>;
  return `{${Object.keys(result)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(result[key])}`)
    .join(",")}}`;
}

function plain(value: StrictJsonValue): unknown {
  if (isStrictJsonNumber(value)) {
    if (!Number.isSafeInteger(value.value) && value.isIntegerToken) {
      fail();
    }
    return value.value;
  }
  if (Array.isArray(value)) return value.map(plain);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, plain(child)]),
    );
  }
  return value;
}

function object(value: unknown, code = "ENTRY_V3_OBJECT"): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return fail(code);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  code = "ENTRY_V3_KEYS",
): void {
  if (
    Object.keys(value).sort().join("\u0000") !==
    [...keys].sort().join("\u0000")
  ) {
    fail(code);
  }
}

function integer(value: unknown, minimum = 0): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum
  ) {
    return fail();
  }
  return value;
}

function signedInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) return fail();
  return value;
}

function text(value: unknown, maximum = 256): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum ||
    value.trim() !== value
  ) {
    return fail();
  }
  return value;
}

function identifier(value: unknown): string {
  const result = text(value);
  return IDENTIFIER.test(result) ? result : fail();
}

function digest(value: unknown): string {
  const result = text(value, 64);
  return SHA256.test(result) && result !== "0".repeat(64) ? result : fail();
}

function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") return fail();
  return value;
}

function values(value: unknown, minimum: number, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    return fail();
  }
  return value;
}

function stringValues(value: unknown, maximum = 32): readonly string[] {
  const result = values(value, 0, maximum).map(identifier);
  if (new Set(result).size !== result.length) fail();
  return result;
}

function parseCandle(value: unknown, requireFiveMinutes = false): OrderedCandleV3 {
  const result = object(value);
  exactKeys(result, CANDLE_KEYS);
  const candle: OrderedCandleV3 = {
    open_epoch: integer(result.open_epoch),
    close_epoch: integer(result.close_epoch),
    open_ticks: signedInteger(result.open_ticks),
    high_ticks: signedInteger(result.high_ticks),
    low_ticks: signedInteger(result.low_ticks),
    close_ticks: signedInteger(result.close_ticks),
  };
  try {
    validateOrderedCandleV3(candle);
  } catch {
    return fail();
  }
  if (
    requireFiveMinutes &&
    (candle.close_epoch - candle.open_epoch !== 300 ||
      candle.open_epoch % 300 !== 0)
  ) {
    fail();
  }
  return candle;
}

function parseCandidate(value: unknown): EntryCandidateV3 {
  const result = object(value);
  exactKeys(result, CANDIDATE_KEYS);
  const candidate = {
    candidate_id: digest(result.candidate_id),
    setup_id: identifier(result.setup_id),
    model: result.model,
    state: result.state,
    direction: result.direction,
    event_anchor_epoch: integer(result.event_anchor_epoch),
    trigger_ordinal: integer(result.trigger_ordinal, 1),
    boc_tier: result.boc_tier,
    reference_candle_open_epoch:
      result.reference_candle_open_epoch === null
        ? null
        : integer(result.reference_candle_open_epoch),
    source_claim_ids: stringValues(result.source_claim_ids),
    observed_at_epoch: integer(result.observed_at_epoch),
  } as EntryCandidateV3;
  try {
    validateEntryCandidateV3(candidate);
  } catch {
    return fail();
  }
  return candidate;
}

function edgeDerivedModel(value: unknown): EntryModelV3 {
  const result = text(value);
  const match = EDGE_DERIVED_REFERENCE.exec(result);
  return match === null ? fail() : (match[1] as EntryModelV3);
}

function edgeDerivedReference(model: EntryModelV3): string {
  return `${EDGE_DERIVED_DIGEST}:${model}`;
}

async function parseEdgeDerivedCandidate(
  value: unknown,
): Promise<EntryCandidateV3> {
  const result = object(value);
  exactKeys(result, CANDIDATE_KEYS);
  const referenceModel = edgeDerivedModel(result.candidate_id);
  const provisional = parseCandidate({
    ...result,
    candidate_id: "a".repeat(64),
  });
  if (referenceModel !== provisional.model) fail();
  return {
    ...provisional,
    candidate_id: await candidateIdV3(provisional),
  };
}

function nullableInteger(value: unknown): number | null {
  return value === null ? null : signedInteger(value);
}

function nullableBoolean(value: unknown): boolean | null {
  return value === null ? null : boolean(value);
}

function parseEvidence(value: unknown): EntryCandidateEvidenceV3 {
  const result = object(value);
  exactKeys(result, EVIDENCE_KEYS);
  const evidence = {
    evidence_id: digest(result.evidence_id),
    candidate_id: digest(result.candidate_id),
    observed_trigger_epoch:
      result.observed_trigger_epoch === null
        ? null
        : integer(result.observed_trigger_epoch),
    trigger_sequence: integer(result.trigger_sequence),
    observed_trigger_ticks: nullableInteger(result.observed_trigger_ticks),
    htf_context_minutes: values(result.htf_context_minutes, 0, 3).map(
      (item) => integer(item, 15),
    ),
    fidelity: result.fidelity,
    proof_plane: result.proof_plane,
    replayability: result.replayability,
    coverage_start_epoch: integer(result.coverage_start_epoch),
    coverage_end_epoch: integer(result.coverage_end_epoch),
    ambiguity_codes: stringValues(result.ambiguity_codes, 3),
    boc_tier: result.boc_tier,
    reference_candle_open_epoch:
      result.reference_candle_open_epoch === null
        ? null
        : integer(result.reference_candle_open_epoch),
    reference_candle_open_ticks: nullableInteger(
      result.reference_candle_open_ticks,
    ),
    reference_candle_high_ticks: nullableInteger(
      result.reference_candle_high_ticks,
    ),
    reference_candle_low_ticks: nullableInteger(
      result.reference_candle_low_ticks,
    ),
    reference_candle_close_ticks: nullableInteger(
      result.reference_candle_close_ticks,
    ),
    htf_open_ticks: nullableInteger(result.htf_open_ticks),
    contact_candle:
      result.contact_candle === null ? null : parseCandle(result.contact_candle),
    recross_candle:
      result.recross_candle === null ? null : parseCandle(result.recross_candle),
    coverage_gap_detected: nullableBoolean(result.coverage_gap_detected),
    full_lifecycle_ordered: nullableBoolean(result.full_lifecycle_ordered),
    destination_seen_before_contact: nullableBoolean(
      result.destination_seen_before_contact,
    ),
    passed_rule_ids: stringValues(result.passed_rule_ids),
    failed_rule_ids: stringValues(result.failed_rule_ids),
    source_claim_ids: stringValues(result.source_claim_ids),
    payload_sha256: digest(result.payload_sha256),
    observed_at_epoch: integer(result.observed_at_epoch),
  } as EntryCandidateEvidenceV3;
  try {
    validateEntryEvidenceV3(evidence);
  } catch {
    return fail();
  }
  return evidence;
}

async function parseEdgeDerivedEvidence(
  value: unknown,
  candidateByModel: ReadonlyMap<EntryModelV3, EntryCandidateV3>,
): Promise<EntryCandidateEvidenceV3> {
  const result = object(value);
  exactKeys(result, EVIDENCE_KEYS);
  const candidateModel = edgeDerivedModel(result.candidate_id);
  const evidenceModel = edgeDerivedModel(result.evidence_id);
  const candidate = candidateByModel.get(candidateModel);
  if (
    candidate === undefined ||
    candidateModel !== evidenceModel ||
    result.payload_sha256 !== EDGE_DERIVED_DIGEST
  ) {
    fail();
  }
  const provisional = parseEvidence({
    ...result,
    evidence_id: "a".repeat(64),
    candidate_id: candidate.candidate_id,
    payload_sha256: "b".repeat(64),
  });
  const {
    evidence_id: _,
    payload_sha256: __,
    observed_at_epoch: ___,
    ...payload
  } = provisional;
  const payloadSha256 = await evidencePayloadSha256V3(payload);
  const withPayloadDigest = {
    ...provisional,
    payload_sha256: payloadSha256,
  };
  return {
    ...withPayloadDigest,
    evidence_id: await evidenceIdV3(withPayloadDigest),
  };
}

function parseSelection(value: unknown): EntrySelectionV3 {
  const result = object(value);
  exactKeys(result, SELECTION_KEYS);
  const selection = {
    selection_id: digest(result.selection_id),
    setup_id: identifier(result.setup_id),
    policy_version: result.policy_version,
    revision: integer(result.revision),
    candidate_ids_considered: stringValues(result.candidate_ids_considered),
    canonical_candidate_id:
      result.canonical_candidate_id === null
        ? null
        : digest(result.canonical_candidate_id),
    canonical_evidence_id:
      result.canonical_evidence_id === null
        ? null
        : digest(result.canonical_evidence_id),
    canonical_model: result.canonical_model,
    reason: result.reason,
    fidelity: result.fidelity,
    action: result.action,
    co_triggered_models: stringValues(result.co_triggered_models, 3),
    evaluated_at_epoch: integer(result.evaluated_at_epoch),
  } as EntrySelectionV3;
  try {
    validateSelectionShapeV3(selection);
  } catch {
    return fail();
  }
  return selection;
}

const ENTRY_MODELS_V3 = new Set<EntryModelV3>([
  "BOC",
  "DIR_CLOSE",
  "HTF_FLIP",
]);
const SELECTION_REASONS_V3 = new Set([
  "ONLY_EXACT_TRIGGER",
  "EARLIEST_EXACT_TRIGGER",
  "FALLBACK_TO_CONFIRMED_CLOSE",
  "CO_TRIGGER_SAME_EVENT",
  "CO_TRIGGER_PRICE_CONFLICT",
  "NO_EXACT_CANDIDATE",
  "ONE_CANDLE_EXPERIMENT_NOT_PROMOTED",
  "SETUP_INVALIDATED",
  "NO_CANDIDATE",
]);
const SELECTION_FIDELITIES_V3 = new Set<CandidateFidelityV3>([
  "EXACT",
  "CALIBRATED",
  "DISCRETIONARY",
  "UNRESOLVED",
]);
const SELECTION_ACTIONS_V3 = new Set([
  "OBSERVE",
  "PAPER_ELIGIBLE",
  "SHADOW_ONLY",
  "NONE",
]);

interface EdgeDerivedSelectionSeed {
  readonly setup_id: string;
  readonly revision: number;
  readonly evaluated_at_epoch: number;
}

function parseEdgeDerivedSelectionSeed(
  value: unknown,
  candidateModels: readonly EntryModelV3[],
): EdgeDerivedSelectionSeed {
  const result = object(value);
  exactKeys(result, SELECTION_KEYS);
  if (
    result.selection_id !== EDGE_DERIVED_DIGEST ||
    result.policy_version !== "rd-entry-arbitration-v3"
  ) {
    fail();
  }
  const setupId = identifier(result.setup_id);
  const considered = stringValues(result.candidate_ids_considered, 3);
  const expectedConsidered = candidateModels
    .map(edgeDerivedReference)
    .sort();
  if (
    considered.join("\u0000") !== expectedConsidered.join("\u0000")
  ) {
    fail();
  }
  const candidateReference =
    result.canonical_candidate_id === null
      ? null
      : edgeDerivedModel(result.canonical_candidate_id);
  const evidenceReference =
    result.canonical_evidence_id === null
      ? null
      : edgeDerivedModel(result.canonical_evidence_id);
  if (
    (candidateReference === null) !== (evidenceReference === null) ||
    candidateReference !== evidenceReference ||
    (candidateReference !== null &&
      !candidateModels.includes(candidateReference))
  ) {
    fail();
  }
  const canonicalModel = result.canonical_model;
  if (
    canonicalModel !== null &&
    (!ENTRY_MODELS_V3.has(canonicalModel as EntryModelV3) ||
      canonicalModel !== candidateReference)
  ) {
    fail();
  }
  if (
    (canonicalModel === null) !== (candidateReference === null) ||
    !SELECTION_REASONS_V3.has(result.reason as string) ||
    (result.fidelity !== null &&
      !SELECTION_FIDELITIES_V3.has(result.fidelity as CandidateFidelityV3)) ||
    !SELECTION_ACTIONS_V3.has(result.action as string)
  ) {
    fail();
  }
  const coTriggeredModels = stringValues(result.co_triggered_models, 3);
  if (
    coTriggeredModels.some(
      (model) => !ENTRY_MODELS_V3.has(model as EntryModelV3),
    ) ||
    coTriggeredModels.join("\u0000") !==
      [...coTriggeredModels].sort().join("\u0000")
  ) {
    fail();
  }
  return {
    setup_id: setupId,
    revision: integer(result.revision),
    evaluated_at_epoch: integer(result.evaluated_at_epoch),
  };
}

function isEdgeDerivedMarker(value: unknown): boolean {
  if (typeof value === "string") {
    return value.startsWith(EDGE_DERIVED_DIGEST);
  }
  return false;
}

function bundleUsesEdgeDerivedIdentity(
  bundle: Record<string, unknown>,
): boolean {
  const candidates = Array.isArray(bundle.candidates)
    ? bundle.candidates
    : [];
  const evidence = Array.isArray(bundle.evidence) ? bundle.evidence : [];
  const selection =
    bundle.selection_proposal !== null &&
    typeof bundle.selection_proposal === "object" &&
    !Array.isArray(bundle.selection_proposal)
      ? (bundle.selection_proposal as Record<string, unknown>)
      : {};
  return (
    candidates.some(
      (item) =>
        item !== null &&
        typeof item === "object" &&
        !Array.isArray(item) &&
        isEdgeDerivedMarker(
          (item as Record<string, unknown>).candidate_id,
        ),
    ) ||
    evidence.some(
      (item) =>
        item !== null &&
        typeof item === "object" &&
        !Array.isArray(item) &&
        [
          (item as Record<string, unknown>).candidate_id,
          (item as Record<string, unknown>).evidence_id,
          (item as Record<string, unknown>).payload_sha256,
        ].some(isEdgeDerivedMarker),
    ) ||
    [
      selection.selection_id,
      selection.canonical_candidate_id,
      selection.canonical_evidence_id,
      ...(Array.isArray(selection.candidate_ids_considered)
        ? selection.candidate_ids_considered
        : []),
    ].some(isEdgeDerivedMarker)
  );
}

async function verifyCanonicalDigests(
  evaluation: EntryEvaluationV3,
): Promise<void> {
  for (const candidate of evaluation.candidates) {
    if ((await candidateIdV3(candidate)) !== candidate.candidate_id) fail();
  }
  for (const evidence of evaluation.evidence) {
    const { evidence_id: _, payload_sha256: __, observed_at_epoch: ___, ...payload } =
      evidence;
    const payloadSha256 = await evidencePayloadSha256V3(payload);
    if (
      payloadSha256 !== evidence.payload_sha256 ||
      (await evidenceIdV3(evidence)) !== evidence.evidence_id
    ) {
      fail();
    }
  }
  if ((await selectionIdV3(evaluation.selection)) !== evaluation.selection.selection_id) {
    fail();
  }
}

function parseCommonRules(
  value: unknown,
): readonly EntryV3CommonRuleResult[] {
  const result = values(
    value,
    REQUIRED_COMMON_RULE_IDS_V3.length,
    REQUIRED_COMMON_RULE_IDS_V3.length,
  ).map((item) => {
    const rule = object(item);
    exactKeys(rule, ["rule_id", "passed"]);
    return {
      rule_id: identifier(rule.rule_id),
      passed: boolean(rule.passed),
    };
  });
  if (
    result.map((item) => item.rule_id).join() !==
      REQUIRED_COMMON_RULE_IDS_V3.join()
  ) {
    fail();
  }
  return result as readonly EntryV3CommonRuleResult[];
}

function validateCommonRules(
  schemaVersion: EntryV3SchemaVersion,
  setup: SetupEntryFactsV3,
  rules: readonly EntryV3CommonRuleResult[],
  unreviewedProducer: boolean,
): void {
  const byId = new Map(rules.map((item) => [item.rule_id, item.passed]));
  if (
    schemaVersion === "3.0" &&
    byId.get("LIQ_NORMAL_TWO_OPPOSITE_CANDLES") !== true
  ) {
    fail("ENTRY_V3_LEGACY_LIQUIDITY_CLASSIFICATION");
  }
  if (setup.liquidity_cohort === "TWO_PLUS_CANDLES") {
    if (!unreviewedProducer && rules.some((item) => !item.passed)) fail();
    return;
  }
  if (byId.get("LIQ_ONE_CANDLE_EXCEPTION") !== true) fail();
  const allowedFailedRules = new Set(ONE_CANDLE_EXPECTED_FAILED_RULES);
  if (setup.common_fidelity === "UNRESOLVED") {
    allowedFailedRules.add("LIQ_DISTANCE_INFLUENCES_ZONE");
  }
  if (
    rules.some(
      (item) => !item.passed && !allowedFailedRules.has(item.rule_id),
    )
  ) {
    fail();
  }
}

function parseSetup(
  value: unknown,
  unreviewedProducer: boolean,
  schemaVersion: EntryV3SchemaVersion,
): {
  readonly facts: SetupEntryFactsV3;
  readonly commonRules: readonly EntryV3CommonRuleResult[];
} {
  const result = object(value);
  exactKeys(
    result,
    schemaVersion === "3.0" ? SETUP_KEYS_V30 : SETUP_KEYS_V31,
  );
  const facts = {
    setup_id: identifier(result.setup_id),
    direction: result.direction,
    zone_top_ticks: signedInteger(result.zone_top_ticks),
    zone_bottom_ticks: signedInteger(result.zone_bottom_ticks),
    zone_engaged_epoch:
      result.zone_engaged_epoch === null
        ? null
        : integer(result.zone_engaged_epoch),
    invalidated_before_entry: boolean(result.invalidated_before_entry),
    common_fidelity: result.common_fidelity,
    liquidity_cohort:
      schemaVersion === "3.0"
        ? "TWO_PLUS_CANDLES"
        : result.liquidity_cohort,
    one_candle_enabled:
      schemaVersion === "3.0"
        ? false
        : boolean(result.one_candle_enabled),
  } as SetupEntryFactsV3;
  if (
    (facts.direction !== "LONG" && facts.direction !== "SHORT") ||
    facts.zone_top_ticks <= facts.zone_bottom_ticks ||
    !["EXACT", "CALIBRATED", "DISCRETIONARY", "UNRESOLVED"].includes(
      facts.common_fidelity,
    )
  ) {
    fail();
  }
  try {
    validateLiquidityCohortV3(facts);
  } catch {
    fail();
  }
  const commonRules = parseCommonRules(result.common_rule_results);
  validateCommonRules(
    schemaVersion,
    facts,
    commonRules,
    unreviewedProducer,
  );
  return {
    facts,
    commonRules,
  };
}

function parseTradePlan(
  value: unknown,
  expectedDirection: EntryDirectionV3,
): EntryV3TradePlan {
  const result = object(value);
  exactKeys(result, TRADE_PLAN_KEYS);
  const direction = result.direction;
  const plan = {
    direction,
    entry_ticks: signedInteger(result.entry_ticks),
    stop_ticks: signedInteger(result.stop_ticks),
    target_ticks: signedInteger(result.target_ticks),
  } as EntryV3TradePlan;
  if (
    direction !== expectedDirection ||
    (direction === "LONG"
      ? !(plan.stop_ticks < plan.entry_ticks &&
          plan.entry_ticks < plan.target_ticks)
      : direction === "SHORT"
        ? !(plan.target_ticks < plan.entry_ticks &&
            plan.entry_ticks < plan.stop_ticks)
        : true)
  ) {
    fail();
  }
  return plan;
}

function validateUnreviewedBundle(
  setup: SetupEntryFactsV3,
  candidates: readonly EntryCandidateV3[],
  evidence: readonly EntryCandidateEvidenceV3[],
  producerSelectionValue: unknown,
  canonicalSelection: EntrySelectionV3,
): void {
  const producerSelection = object(producerSelectionValue);
  const producerAction = producerSelection.action;
  const producerReason = producerSelection.reason;
  const expectedShadowReason =
    setup.liquidity_cohort === "ONE_CANDLE"
      ? "ONE_CANDLE_EXPERIMENT_NOT_PROMOTED"
      : "NO_EXACT_CANDIDATE";
  if (
    setup.common_fidelity !== "UNRESOLVED" ||
    candidates.some((candidate) => candidate.state === "MATCHED") ||
    evidence.some(
      (item) =>
        item.fidelity === "EXACT" ||
        item.passed_rule_ids.length !== 0 ||
        item.failed_rule_ids.length !== 1 ||
        item.failed_rule_ids[0] !== "COMMON_SETUP_NOT_EXACT",
    ) ||
    (producerAction !== "SHADOW_ONLY" && producerAction !== "NONE") ||
    (producerAction === "SHADOW_ONLY"
      ? producerReason !== expectedShadowReason
      : producerReason !== "SETUP_INVALIDATED" &&
        producerReason !== "NO_CANDIDATE") ||
    producerSelection.canonical_candidate_id !== null ||
    producerSelection.canonical_evidence_id !== null ||
    producerSelection.canonical_model !== null ||
    producerSelection.fidelity !== null ||
    values(producerSelection.co_triggered_models, 0, 3).length !== 0 ||
    (canonicalSelection.action !== "SHADOW_ONLY" &&
      canonicalSelection.action !== "NONE") ||
    canonicalSelection.canonical_candidate_id !== null ||
    canonicalSelection.canonical_evidence_id !== null ||
    canonicalSelection.canonical_model !== null
  ) {
    fail("ENTRY_V3_UNREVIEWED_PROMOTION_ATTEMPT");
  }
}

async function parseBundle(
  value: unknown,
  unreviewedProducer: boolean,
  schemaVersion: EntryV3SchemaVersion,
): Promise<ValidatedEntryV3Bundle> {
  const result = object(value);
  exactKeys(result, SETUP_BUNDLE_KEYS);
  const setup = parseSetup(result.setup, unreviewedProducer, schemaVersion);
  const usesEdgeDerivedIdentity = bundleUsesEdgeDerivedIdentity(result);
  const candidateValues = values(result.candidates, 0, 3);
  const candidates = usesEdgeDerivedIdentity
    ? await Promise.all(candidateValues.map(parseEdgeDerivedCandidate))
    : candidateValues.map(parseCandidate);
  const candidateModels = candidates.map((item) => item.model);
  const candidateByModel = new Map(
    candidates.map((item) => [item.model, item] as const),
  );
  const evidenceValues = values(result.evidence, 0, 12);
  const evidence = usesEdgeDerivedIdentity
    ? await Promise.all(
        evidenceValues.map((item) =>
          parseEdgeDerivedEvidence(item, candidateByModel),
        ),
      )
    : evidenceValues.map(parseEvidence);
  if (
    new Set(candidates.map((item) => item.candidate_id)).size !==
      candidates.length ||
    (usesEdgeDerivedIdentity &&
      new Set(candidateModels).size !== candidates.length) ||
    new Set(evidence.map((item) => item.evidence_id)).size !== evidence.length ||
    (usesEdgeDerivedIdentity &&
      (evidence.length !== candidates.length ||
        new Set(evidence.map((item) => item.candidate_id)).size !==
          evidence.length)) ||
    candidates.some(
      (item) =>
        item.setup_id !== setup.facts.setup_id ||
        item.direction !== setup.facts.direction,
    )
  ) {
    fail();
  }
  const selectionSeed = usesEdgeDerivedIdentity
    ? parseEdgeDerivedSelectionSeed(result.selection_proposal, candidateModels)
    : parseSelection(result.selection_proposal);
  if (selectionSeed.setup_id !== setup.facts.setup_id) fail();
  const canonicalSelection = await arbitrateEntryCandidatesV3(
    setup.facts.setup_id,
    candidates,
    evidence,
    setup.facts.invalidated_before_entry,
    selectionSeed.revision,
    selectionSeed.evaluated_at_epoch,
    null,
    setup.facts.liquidity_cohort,
  );
  const producerSelection = object(result.selection_proposal);
  const truthfulOneCandleTerminal =
    producerSelection.action === "SHADOW_ONLY" &&
    producerSelection.reason === "ONE_CANDLE_EXPERIMENT_NOT_PROMOTED" &&
    producerSelection.canonical_candidate_id === null &&
    producerSelection.canonical_evidence_id === null &&
    producerSelection.canonical_model === null &&
    producerSelection.fidelity === null &&
    values(producerSelection.co_triggered_models, 0, 3).length === 0;
  if (
    setup.facts.liquidity_cohort === "ONE_CANDLE" &&
    !truthfulOneCandleTerminal
  ) {
    fail("ENTRY_V3_ONE_CANDLE_TERMINAL_MISMATCH");
  }
  if (
    !usesEdgeDerivedIdentity &&
    canonicalJson(canonicalSelection) !== canonicalJson(selectionSeed)
  ) {
    fail();
  }
  if (unreviewedProducer) {
    validateUnreviewedBundle(
      setup.facts,
      candidates,
      evidence,
      result.selection_proposal,
      canonicalSelection,
    );
  }
  const evaluation = {
    candidates: [...candidates].sort((a, b) =>
      a.candidate_id.localeCompare(b.candidate_id),
    ),
    evidence: [...evidence].sort((a, b) =>
      a.evidence_id.localeCompare(b.evidence_id),
    ),
    selection: canonicalSelection,
  };
  try {
    validateEntryEvaluationV3(evaluation);
  } catch {
    return fail();
  }
  await verifyCanonicalDigests(evaluation);
  if (
    canonicalSelection.action === "PAPER_ELIGIBLE" &&
    (setup.facts.common_fidelity !== "EXACT" ||
      setup.facts.invalidated_before_entry ||
      setup.facts.zone_engaged_epoch === null ||
      evaluation.evidence.some(
        (item) =>
          item.observed_trigger_epoch !== null &&
          item.observed_trigger_epoch < setup.facts.zone_engaged_epoch!,
      ))
  ) {
    fail();
  }
  return {
    setup: setup.facts,
    commonRuleResults: setup.commonRules,
    candidates: evaluation.candidates,
    evidence: evaluation.evidence,
    selectionProposal: canonicalSelection,
    evaluation,
    tradePlan: parseTradePlan(result.trade_plan, setup.facts.direction),
  };
}

function selectedAuthoritativePairs(
  evaluation: EntryEvaluationV3,
): readonly {
  readonly candidate: EntryCandidateV3;
  readonly evidence: EntryCandidateEvidenceV3;
}[] {
  const selection = evaluation.selection;
  if (
    selection.action !== "PAPER_ELIGIBLE" ||
    selection.canonical_candidate_id === null ||
    selection.canonical_evidence_id === null
  ) {
    return [];
  }
  const canonicalEvidence = evaluation.evidence.find(
    (item) => item.evidence_id === selection.canonical_evidence_id,
  );
  if (
    canonicalEvidence === undefined ||
    canonicalEvidence.observed_trigger_epoch === null
  ) {
    return fail();
  }
  const candidateById = new Map(
    evaluation.candidates.map((item) => [item.candidate_id, item]),
  );
  const selectedModels =
    selection.co_triggered_models.length === 0
      ? [selection.canonical_model]
      : selection.co_triggered_models;
  return evaluation.evidence
    .filter(
      (item) =>
        item.fidelity === "EXACT" &&
        item.observed_trigger_epoch ===
          canonicalEvidence.observed_trigger_epoch &&
        item.trigger_sequence === canonicalEvidence.trigger_sequence,
    )
    .map((evidence) => {
      const candidate = candidateById.get(evidence.candidate_id);
      return candidate === undefined ? fail() : { candidate, evidence };
    })
    .filter(({ candidate }) => selectedModels.includes(candidate.model));
}

function validateAuthoritativePaperFacts(
  setup: SetupEntryFactsV3,
  evaluation: EntryEvaluationV3,
  marketEvent: EntryV3MarketEvent,
  tradePlan: EntryV3TradePlan,
  eventRole: EntryV3EventRole,
): void {
  const pairs = selectedAuthoritativePairs(evaluation);
  if (evaluation.selection.action !== "PAPER_ELIGIBLE") return;
  if (
    pairs.length === 0 ||
    pairs.some(
      ({ evidence }) =>
        evidence.observed_trigger_ticks !== tradePlan.entry_ticks ||
        (eventRole === "ENTRY_DECISION" &&
          (evidence.observed_trigger_epoch !== marketEvent.epoch ||
            evidence.trigger_sequence !== marketEvent.sequence ||
            evidence.observed_trigger_ticks !== marketEvent.tick_price_ticks)),
    ) ||
    (eventRole === "ENTRY_DECISION" &&
      tradePlan.entry_ticks !== marketEvent.tick_price_ticks)
  ) {
    fail();
  }
  for (const { candidate, evidence } of pairs) {
    if (candidate.model === "BOC") {
      if (
        candidate.reference_candle_open_epoch === null ||
        candidate.event_anchor_epoch !==
          candidate.reference_candle_open_epoch ||
        candidate.reference_candle_open_epoch % 300 !== 0 ||
        evidence.reference_candle_open_epoch !==
          candidate.reference_candle_open_epoch ||
        evidence.reference_candle_high_ticks === null ||
        evidence.reference_candle_low_ticks === null ||
        evidence.observed_trigger_ticks === null ||
        (candidate.direction === "LONG"
          ? evidence.observed_trigger_ticks <=
            evidence.reference_candle_high_ticks
          : evidence.observed_trigger_ticks >=
            evidence.reference_candle_low_ticks)
      ) {
        fail();
      }
      continue;
    }
    if (candidate.model === "DIR_CLOSE") {
      if (
        candidate.event_anchor_epoch !== evidence.coverage_start_epoch ||
        candidate.event_anchor_epoch % 300 !== 0 ||
        evidence.coverage_end_epoch - evidence.coverage_start_epoch !== 300 ||
        evidence.observed_trigger_epoch !== evidence.coverage_end_epoch ||
        evidence.observed_trigger_ticks === null ||
        (candidate.direction === "LONG"
          ? evidence.observed_trigger_ticks <= setup.zone_top_ticks
          : evidence.observed_trigger_ticks >= setup.zone_bottom_ticks)
      ) {
        fail();
      }
      if (eventRole === "EXIT_FOLLOWUP") continue;
      const bar = marketEvent.confirmed_bar;
      if (
        !marketEvent.barstate_isconfirmed ||
        bar === null ||
        candidate.event_anchor_epoch !== bar.open_epoch ||
        bar.open_epoch !== evidence.coverage_start_epoch ||
        bar.close_epoch !== evidence.coverage_end_epoch ||
        evidence.observed_trigger_epoch !== bar.close_epoch ||
        evidence.observed_trigger_ticks !== bar.close_ticks
      ) {
        fail();
      }
      continue;
    }
    const contact = evidence.contact_candle;
    const recross = evidence.recross_candle;
    const triggerEpoch = evidence.observed_trigger_epoch;
    if (
      contact === null ||
      recross === null ||
      triggerEpoch === null ||
      evidence.htf_context_minutes.length === 0 ||
      evidence.htf_context_minutes.some(
        (context) =>
          candidate.event_anchor_epoch % (context * 60) !== 0 ||
          contact.open_epoch < candidate.event_anchor_epoch ||
          triggerEpoch >=
            candidate.event_anchor_epoch + context * 60,
      ) ||
      contact.open_epoch < evidence.coverage_start_epoch ||
      contact.close_epoch > evidence.coverage_end_epoch ||
      recross.open_epoch < evidence.coverage_start_epoch ||
      recross.close_epoch > evidence.coverage_end_epoch ||
      triggerEpoch !== recross.close_epoch ||
      evidence.observed_trigger_ticks !== recross.close_ticks ||
      evidence.htf_open_ticks === null ||
      (candidate.direction === "LONG"
        ? recross.close_ticks <= evidence.htf_open_ticks
        : recross.close_ticks >= evidence.htf_open_ticks) ||
      (candidate.direction === "LONG"
        ? contact.high_ticks > evidence.htf_open_ticks
        : contact.low_ticks < evidence.htf_open_ticks) ||
      contact.low_ticks > setup.zone_top_ticks ||
      contact.high_ticks < setup.zone_bottom_ticks
    ) {
      fail();
    }
  }
}

function parseMarketEvent(value: unknown): EntryV3MarketEvent {
  const result = object(value);
  exactKeys(result, MARKET_EVENT_KEYS);
  const barstateIsConfirmed = boolean(result.barstate_isconfirmed);
  const confirmedBar =
    result.confirmed_bar === null
      ? null
      : parseCandle(result.confirmed_bar, true);
  if (barstateIsConfirmed !== (confirmedBar !== null)) fail();
  const event = {
    epoch: integer(result.epoch),
    sequence: integer(result.sequence),
    tick_price_ticks: signedInteger(result.tick_price_ticks),
    barstate_isconfirmed: barstateIsConfirmed,
    confirmed_bar: confirmedBar,
  };
  if (
    confirmedBar !== null &&
    (event.epoch !== confirmedBar.close_epoch ||
      event.tick_price_ticks !== confirmedBar.close_ticks)
  ) {
    fail();
  }
  return event;
}

function parseExitEvent(value: unknown): EntryV3ExitEvent {
  const result = object(value);
  exactKeys(result, EXIT_EVENT_KEYS);
  const reason = result.exit_reason;
  if (
    reason !== "STOP_LOSS" &&
    reason !== "TARGET" &&
    reason !== "AMBIGUOUS_SAME_BAR_EXIT"
  ) {
    fail();
  }
  return {
    event_id: identifier(result.event_id),
    setup_id: identifier(result.setup_id),
    exit_reason: reason,
    epoch: integer(result.epoch),
    sequence: integer(result.sequence),
    price_ticks: signedInteger(result.price_ticks),
  };
}

function validatedExitCausalEpoch(
  bundle: ValidatedEntryV3Bundle,
): number {
  const selection = bundle.evaluation.selection;
  if (selection.canonical_evidence_id !== null) {
    const selectedEvidence = bundle.evaluation.evidence.find(
      (evidence) => evidence.evidence_id === selection.canonical_evidence_id,
    );
    if (selectedEvidence === undefined) fail();
    if (selectedEvidence.observed_trigger_epoch !== null) {
      return selectedEvidence.observed_trigger_epoch;
    }
  }
  return selection.evaluated_at_epoch;
}

function exitLevelHits(
  bundle: ValidatedEntryV3Bundle,
  marketEvent: EntryV3MarketEvent,
  isRealtime: boolean,
): {
  readonly stopHit: boolean;
  readonly targetHit: boolean;
} {
  const plan = bundle.tradePlan;
  const confirmedBar = marketEvent.confirmed_bar;
  if (isRealtime || confirmedBar === null) {
    return {
      stopHit:
        plan.direction === "LONG"
          ? marketEvent.tick_price_ticks <= plan.stop_ticks
          : marketEvent.tick_price_ticks >= plan.stop_ticks,
      targetHit:
        plan.direction === "LONG"
          ? marketEvent.tick_price_ticks >= plan.target_ticks
          : marketEvent.tick_price_ticks <= plan.target_ticks,
    };
  }
  return {
    stopHit:
      plan.direction === "LONG"
        ? confirmedBar.low_ticks <= plan.stop_ticks
        : confirmedBar.high_ticks >= plan.stop_ticks,
    targetHit:
      plan.direction === "LONG"
        ? confirmedBar.high_ticks >= plan.target_ticks
        : confirmedBar.low_ticks <= plan.target_ticks,
  };
}

function validateExitFollowup(
  exitEvents: readonly EntryV3ExitEvent[],
  isRealtime: boolean,
  marketEvent: EntryV3MarketEvent,
  entryBundles: readonly ValidatedEntryV3Bundle[],
): void {
  if (exitEvents.length === 0) return;
  if (
    new Set(exitEvents.map((event) => event.event_id)).size !==
      exitEvents.length ||
    new Set(exitEvents.map((event) => event.setup_id)).size !==
      exitEvents.length
  ) {
    fail("ENTRY_V3_EXIT_EVENT_CONFLICT");
  }
  const exitSetupIds = [...exitEvents]
    .map((event) => event.setup_id)
    .sort();
  const bundleSetupIds = [...entryBundles]
    .map((bundle) => bundle.setup.setup_id)
    .sort();
  if (
    exitSetupIds.join("\u0000") !== bundleSetupIds.join("\u0000")
  ) {
    fail("ENTRY_V3_EXIT_SETUP_MISMATCH");
  }
  const bundleBySetupId = new Map(
    entryBundles.map((bundle) => [bundle.setup.setup_id, bundle] as const),
  );
  for (const event of exitEvents) {
    const bundle = bundleBySetupId.get(event.setup_id);
    if (
      bundle === undefined ||
      event.epoch !== marketEvent.epoch ||
      event.sequence !== marketEvent.sequence ||
      event.price_ticks !== marketEvent.tick_price_ticks ||
      event.epoch < validatedExitCausalEpoch(bundle)
    ) {
      fail("ENTRY_V3_EXIT_NOT_CAUSAL");
    }
    const { stopHit, targetHit } = exitLevelHits(
      bundle,
      marketEvent,
      isRealtime,
    );
    if (event.exit_reason === "AMBIGUOUS_SAME_BAR_EXIT") {
      if (
        isRealtime ||
        !marketEvent.barstate_isconfirmed ||
        marketEvent.confirmed_bar === null
      ) {
        fail("ENTRY_V3_AMBIGUOUS_EXIT_NOT_HISTORICAL");
      }
      if (!stopHit || !targetHit) {
        fail("ENTRY_V3_AMBIGUOUS_EXIT_NOT_CAUSAL");
      }
      continue;
    }
    if (
      (!isRealtime &&
        (!marketEvent.barstate_isconfirmed ||
          marketEvent.confirmed_bar === null)) ||
      (!isRealtime && stopHit && targetHit) ||
      (event.exit_reason === "STOP_LOSS" ? !stopHit : !targetHit)
    ) {
      fail("ENTRY_V3_EXIT_LEVEL_NOT_HIT");
    }
  }
}

export async function validateEntryV3Payload(
  raw: StrictJsonValue,
  reviewedHashes?: EntryV3ReviewedProducerHashes,
): Promise<ValidatedEntryV3Payload> {
  // Promotion identity is an economic authorization boundary owned by the
  // transactional store. Wire validation retains syntactically valid producer
  // hashes so mismatches can still be persisted and diagnosed fail-closed.
  void reviewedHashes;
  const decoded = plain(raw);
  const serialized = JSON.stringify(decoded);
  if (serialized.length >= ENTRY_V3_MAX_PAYLOAD_CHARACTERS) {
    fail("ENTRY_V3_MESSAGE_TOO_LARGE");
  }
  const payload = object(decoded);
  exactKeys(payload, TOP_LEVEL_KEYS);
  const schemaVersion = payload.schema_version;
  const isLegacyV30 =
    schemaVersion === "3.0" &&
    payload.strategy_version === "3.0.0-contract3" &&
    payload.rule_contract_version === "3.0.0";
  const isCohortAwareV31 =
    schemaVersion === "3.1" &&
    payload.strategy_version === "3.1.0-contract3" &&
    payload.rule_contract_version === "3.1.0";
  if (
    (!isLegacyV30 && !isCohortAwareV31) ||
    payload.strategy_id !== "rd_liquidity_sd_5m_v1" ||
    payload.execution_mode !== "PAPER_ONLY" ||
    payload.timeframe !== "5"
  ) {
    fail();
  }
  const validatedSchemaVersion = schemaVersion as EntryV3SchemaVersion;
  const producerInstanceId = identifier(payload.producer_instance_id);
  const producerSequence = integer(payload.producer_sequence);
  const eventId = identifier(payload.event_id);
  const isRealtime = boolean(payload.is_realtime);
  const symbol = identifier(payload.symbol);
  const tickerId = identifier(payload.ticker_id);
  const feed = identifier(payload.feed);
  const tickSize = text(payload.tick_size, 64);
  if (!POSITIVE_DECIMAL.test(tickSize)) fail();
  const detectorUnreviewed = payload.detector_code_hash === "UNREVIEWED";
  const settingsUnreviewed = payload.settings_hash === "UNREVIEWED";
  if (detectorUnreviewed !== settingsUnreviewed) {
    fail("ENTRY_V3_PROMOTION_IDENTITY_MISMATCH");
  }
  const unreviewedProducer = detectorUnreviewed;
  const detectorCodeHash = unreviewedProducer
    ? "UNREVIEWED"
    : digest(payload.detector_code_hash);
  const settingsHash = unreviewedProducer
    ? "UNREVIEWED"
    : digest(payload.settings_hash);
  const observedAtEpoch = integer(payload.observed_at_epoch);
  const marketEvent = parseMarketEvent(payload.market_event);
  if (marketEvent.epoch > observedAtEpoch) fail();
  const exitEvents = values(payload.exit_events, 0, 32).map(parseExitEvent);
  const eventRole: EntryV3EventRole =
    exitEvents.length === 0 ? "ENTRY_DECISION" : "EXIT_FOLLOWUP";
  const setupValues = values(payload.setups, 1, 32);
  const entryBundles: ValidatedEntryV3Bundle[] = [];
  for (const value of setupValues) {
    entryBundles.push(
      await parseBundle(
        value,
        unreviewedProducer,
        validatedSchemaVersion,
      ),
    );
  }
  if (
    new Set(entryBundles.map((item) => item.setup.setup_id)).size !==
      entryBundles.length
  ) {
    fail();
  }
  validateExitFollowup(
    exitEvents,
    isRealtime,
    marketEvent,
    entryBundles,
  );
  for (const bundle of entryBundles) {
    if (
      bundle.candidates.some(
        (candidate) => candidate.observed_at_epoch > observedAtEpoch,
      ) ||
      bundle.evidence.some(
        (evidence) =>
          evidence.observed_at_epoch > observedAtEpoch ||
          (eventRole === "ENTRY_DECISION" &&
            evidence.proof_plane === "REALTIME_TICK" &&
            !isRealtime),
      ) ||
      bundle.selectionProposal.evaluated_at_epoch > observedAtEpoch
    ) {
      fail();
    }
    validateAuthoritativePaperFacts(
      bundle.setup,
      bundle.evaluation,
      marketEvent,
      bundle.tradePlan,
      eventRole,
    );
  }
  const canonicalSetups = entryBundles.map((bundle) => ({
    setup: {
      ...bundle.setup,
      common_rule_results: bundle.commonRuleResults,
    },
    candidates: bundle.candidates,
    evidence: bundle.evidence,
    selection_proposal: bundle.selectionProposal,
    trade_plan: bundle.tradePlan,
  }));
  const canonicalPayload = {
    ...payload,
    setups: canonicalSetups,
  } as unknown as CanonicalObject;
  return {
    canonicalPayload,
    metadata: {
      idempotencyKey: eventId,
      schemaVersion: validatedSchemaVersion,
      strategyId: "rd_liquidity_sd_5m_v1",
      strategyVersion: isLegacyV30
        ? "3.0.0-contract3"
        : "3.1.0-contract3",
      producerInstanceId,
      sequence: producerSequence,
      symbol,
      tickerId,
      feed,
      timeframe: "5",
      kind: "incremental",
    },
    eventRole,
    producerSequence,
    eventId,
    isRealtime,
    detectorCodeHash,
    settingsHash,
    tickSize,
    observedAtEpoch,
    marketEvent,
    exitEvents,
    entryBundles,
  };
}

export function validateEntryV3BodySize(raw: Uint8Array): void {
  if (new TextDecoder().decode(raw).length >= ENTRY_V3_MAX_PAYLOAD_CHARACTERS) {
    fail("ENTRY_V3_MESSAGE_TOO_LARGE");
  }
}
