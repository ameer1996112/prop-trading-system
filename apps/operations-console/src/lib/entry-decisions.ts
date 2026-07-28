import { fetchBounded, parseStrictResponse } from "./api";

export type EntryModel = "BOC" | "DIR_CLOSE" | "HTF_FLIP";
export type EntryAction =
  | "OBSERVE"
  | "PAPER_ELIGIBLE"
  | "SHADOW_ONLY"
  | "NONE";
export type EntryFidelity =
  | "EXACT"
  | "CALIBRATED"
  | "DISCRETIONARY"
  | "UNRESOLVED";

export type DecisionCandle = {
  openEpoch: number;
  closeEpoch: number | null;
  openTicks: number;
  highTicks: number;
  lowTicks: number;
  closeTicks: number;
};

export type EntryDecisionEvidence = {
  evidenceId: string;
  candidateId: string;
  observedTriggerEpoch: number | null;
  triggerSequence: number;
  observedTriggerTicks: number | null;
  fidelity: EntryFidelity;
  proofPlane:
    | "CONFIRMED_5M"
    | "LOWER_TIMEFRAME_REPLAY"
    | "REALTIME_TICK"
    | "EXTERNAL_ARCHIVED_TICK";
  replayability: "REPLAYABLE" | "LIVE_EXACT_NON_REPLAYABLE";
  htfContextMinutes: Array<15 | 30 | 60>;
  coverageStartEpoch: number;
  coverageEndEpoch: number;
  ambiguityCodes: Array<
    | "SHADOW_SAME_CHILD_BAR_ORDER"
    | "SHADOW_MISSING_INTRABAR_COVERAGE"
    | "SHADOW_REALTIME_ONLY_NOT_REPLAYABLE"
  >;
  passedRuleIds: string[];
  failedRuleIds: string[];
  referenceCandle: DecisionCandle | null;
  contactCandle: DecisionCandle | null;
  recrossCandle: DecisionCandle | null;
};

export type EntryDecisionCandidate = {
  candidateId: string;
  model: EntryModel;
  state: "MATCHED" | "BLOCKED" | "REJECTED";
  direction: "LONG" | "SHORT";
  eventAnchorEpoch: number;
  triggerOrdinal: number;
  bocTier: "HTF_TIMED" | "DISCRETIONARY_5M" | null;
  referenceCandleOpenEpoch: number | null;
  sourceClaimIds: string[];
  evidence: EntryDecisionEvidence;
};

export type EntryDecisionSelection = {
  selectionId: string;
  setupId: string;
  revision: number;
  canonicalCandidateId: string | null;
  canonicalEvidenceId: string | null;
  canonicalModel: EntryModel | null;
  reason:
    | "ONLY_EXACT_TRIGGER"
    | "EARLIEST_EXACT_TRIGGER"
    | "FALLBACK_TO_CONFIRMED_CLOSE"
    | "CO_TRIGGER_SAME_EVENT"
    | "CO_TRIGGER_PRICE_CONFLICT"
    | "NO_EXACT_CANDIDATE"
    | "SETUP_INVALIDATED"
    | "NO_CANDIDATE";
  fidelity: EntryFidelity | null;
  policyAction: EntryAction;
  action: EntryAction;
  effectiveActionReason:
    | "PROMOTION_IDENTITY_MISMATCH"
    | "PAPER_CONFIGURATION_UNAVAILABLE"
    | "NOT_SELECTED_ALREADY_OPEN"
    | null;
  coTriggeredModels: EntryModel[];
  evaluatedAtEpoch: number;
  selectedTriggerEpoch: number | null;
  selectedTriggerSequence: number | null;
};

export type EntryDecisionItem = {
  decisionId: string;
  setupId: string;
  symbol: string;
  direction: "LONG" | "SHORT";
  selection: EntryDecisionSelection;
  parity: {
    status: "MATCH" | "MISMATCH" | "NOT_PROVIDED";
    mismatchReason:
      | "CANDIDATE_IDENTITIES"
      | "EVIDENCE_IDENTITIES"
      | "SELECTED_CANDIDATE"
      | "REASON"
      | "ACTION"
      | "MULTIPLE"
      | null;
  };
  candidates: EntryDecisionCandidate[];
  tradePlan: {
    tickSize: string;
    entryTicks: number;
    stopTicks: number;
    targetTicks: number;
  };
  paperIntentId: string | null;
  trade: {
    entryPrice: string;
    stopLoss: string;
    takeProfit: string;
    state: "OPEN" | "SETTLED";
  } | null;
  shadowOutcome: {
    state: "OPEN" | "STOPPED" | "TARGET_HIT" | "AMBIGUOUS";
    outcomeRMillis: number | null;
  } | null;
};

export type EntryDecisionSnapshot = {
  state: "READY" | "EMPTY" | "ERROR";
  items: EntryDecisionItem[];
  message: string;
};

const models = new Set<EntryModel>(["BOC", "DIR_CLOSE", "HTF_FLIP"]);
const bocTiers = new Set(["HTF_TIMED", "DISCRETIONARY_5M"] as const);
const actions = new Set<EntryAction>([
  "OBSERVE",
  "PAPER_ELIGIBLE",
  "SHADOW_ONLY",
  "NONE",
]);
const candidateStates = new Set(["MATCHED", "BLOCKED", "REJECTED"] as const);
const fidelities = new Set<EntryFidelity>([
  "EXACT",
  "CALIBRATED",
  "DISCRETIONARY",
  "UNRESOLVED",
]);
const selectionReasons = new Set<EntryDecisionSelection["reason"]>([
  "ONLY_EXACT_TRIGGER",
  "EARLIEST_EXACT_TRIGGER",
  "FALLBACK_TO_CONFIRMED_CLOSE",
  "CO_TRIGGER_SAME_EVENT",
  "CO_TRIGGER_PRICE_CONFLICT",
  "NO_EXACT_CANDIDATE",
  "SETUP_INVALIDATED",
  "NO_CANDIDATE",
]);
const effectiveReasons = new Set<
  NonNullable<EntryDecisionSelection["effectiveActionReason"]>
>([
  "PROMOTION_IDENTITY_MISMATCH",
  "PAPER_CONFIGURATION_UNAVAILABLE",
  "NOT_SELECTED_ALREADY_OPEN",
]);
const proofPlanes = new Set<EntryDecisionEvidence["proofPlane"]>([
  "CONFIRMED_5M",
  "LOWER_TIMEFRAME_REPLAY",
  "REALTIME_TICK",
  "EXTERNAL_ARCHIVED_TICK",
]);
const replayabilities = new Set<EntryDecisionEvidence["replayability"]>([
  "REPLAYABLE",
  "LIVE_EXACT_NON_REPLAYABLE",
]);
const ambiguityCodes = new Set<EntryDecisionEvidence["ambiguityCodes"][number]>([
  "SHADOW_SAME_CHILD_BAR_ORDER",
  "SHADOW_MISSING_INTRABAR_COVERAGE",
  "SHADOW_REALTIME_ONLY_NOT_REPLAYABLE",
]);
const commonFailedRuleIds = [
  "COMMON_SETUP_NOT_EXACT",
  "ENTRY_BEFORE_ZONE_ENGAGEMENT",
  "SETUP_INVALIDATED",
  "HISTORICAL_ORDER_UNPROVEN",
] as const;
const failedRuleIdsByModel = new Map<EntryModel, ReadonlySet<string>>([
  [
    "BOC",
    new Set([
      ...commonFailedRuleIds,
      "MODEL_EVIDENCE_NOT_EXACT",
      "EVIDENCE_REPLAYABILITY_MISMATCH",
      "REALTIME_EVIDENCE_NOT_LIVE",
      "BOC_DISCRETIONARY_CONTEXT_UNQUANTIFIED",
      "BOC_WRONG_DIRECTION",
      "REALTIME_TRIGGER_EPOCH_UNREPRESENTABLE",
      "REALTIME_FIRST_CROSS_UNPROVEN",
    ]),
  ],
  [
    "DIR_CLOSE",
    new Set([...commonFailedRuleIds, "DIR_CLOSE_NOT_CONFIRMED_5M"]),
  ],
  [
    "HTF_FLIP",
    new Set([
      ...commonFailedRuleIds,
      "MODEL_EVIDENCE_NOT_EXACT",
      "EVIDENCE_REPLAYABILITY_MISMATCH",
      "REALTIME_EVIDENCE_NOT_LIVE",
      "HTF_FLIP_INCOMPLETE_LIFECYCLE",
      "HTF_FLIP_COVERAGE_GAP",
      "HTF_FLIP_ORDER_UNPROVEN",
      "HTF_FLIP_DESTINATION_BEFORE_CONTACT",
      "HTF_FLIP_AMBIGUOUS",
      "HTF_FLIP_ANCHOR_AFTER_CONTACT",
      "HTF_FLIP_TRIGGER_OUTSIDE_CONTEXT",
      "HTF_FLIP_CONTACT_OUTSIDE_ZONE",
      "HTF_FLIP_CONTACT_ALREADY_RECROSSED",
      "HTF_FLIP_OPEN_NOT_RECROSSED",
      "HTF_FLIP_CONTEXT_MISALIGNED",
      "HTF_FLIP_CAUSAL_EPOCH_UNREPRESENTABLE",
      "HTF_FLIP_INCOMPATIBLE_CONTEXTS",
      "HTF_FLIP_MISSING_INTRABAR_COVERAGE",
      "HTF_FLIP_LIFECYCLE_UNRESOLVED",
    ]),
  ],
]);
const passedRuleByModel = new Map<EntryModel, string>([
  ["BOC", "ENTRY_BOC_HTF_TIMED"],
  ["DIR_CLOSE", "ENTRY_DIR_CLOSE"],
  ["HTF_FLIP", "ENTRY_HTF_FLIP"],
]);
const evidenceRuleIds = new Set([
  ...passedRuleByModel.values(),
  ...[...failedRuleIdsByModel.values()].flatMap((ruleIds) => [...ruleIds]),
]);
const parityStatuses = new Set(["MATCH", "MISMATCH", "NOT_PROVIDED"] as const);
const parityReasons = new Set([
  "CANDIDATE_IDENTITIES",
  "EVIDENCE_IDENTITIES",
  "SELECTED_CANDIDATE",
  "REASON",
  "ACTION",
  "MULTIPLE",
] as const);
const shadowStates = new Set([
  "OPEN",
  "STOPPED",
  "TARGET_HIT",
  "AMBIGUOUS",
] as const);

class InvalidDecisionPayload extends Error {}

function fail(): never {
  throw new InvalidDecisionPayload();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  if (
    Object.keys(value).sort().join("\u0000") !==
    [...keys].sort().join("\u0000")
  ) {
    fail();
  }
}

function stringValue(value: unknown, maximum = 256): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximum ||
    value.trim() !== value
  ) {
    fail();
  }
  return value;
}

function integer(
  value: unknown,
  minimum = Number.MIN_SAFE_INTEGER,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    fail();
  }
  return value as number;
}

function nullableInteger(value: unknown, minimum = 0): number | null {
  return value === null ? null : integer(value, minimum);
}

function uniqueStrings(
  value: unknown,
  maximumItems: number,
  allowed?: ReadonlySet<string>,
): string[] {
  if (!Array.isArray(value) || value.length > maximumItems) fail();
  const result = value.map((item) => stringValue(item));
  if (
    new Set(result).size !== result.length ||
    (allowed !== undefined && result.some((item) => !allowed.has(item)))
  ) {
    fail();
  }
  return result;
}

function enumValue<T extends string>(value: unknown, allowed: ReadonlySet<T>): T {
  if (typeof value !== "string" || !allowed.has(value as T)) fail();
  return value as T;
}

function parseCandle(value: unknown, reference = false): DecisionCandle | null {
  if (value === null) return null;
  if (!isRecord(value)) fail();
  exactKeys(
    value,
    reference
      ? ["open_epoch", "open_ticks", "high_ticks", "low_ticks", "close_ticks"]
      : [
          "open_epoch",
          "close_epoch",
          "open_ticks",
          "high_ticks",
          "low_ticks",
          "close_ticks",
        ],
  );
  const candle = {
    openEpoch: integer(value.open_epoch, 0),
    closeEpoch: reference ? null : integer(value.close_epoch, 0),
    openTicks: integer(value.open_ticks),
    highTicks: integer(value.high_ticks),
    lowTicks: integer(value.low_ticks),
    closeTicks: integer(value.close_ticks),
  };
  if (
    (!reference &&
      (candle.closeEpoch === null || candle.closeEpoch <= candle.openEpoch)) ||
    candle.highTicks <
      Math.max(candle.openTicks, candle.closeTicks, candle.lowTicks) ||
    candle.lowTicks >
      Math.min(candle.openTicks, candle.closeTicks, candle.highTicks)
  ) {
    fail();
  }
  return candle;
}

function parseEvidence(value: unknown): EntryDecisionEvidence {
  if (!isRecord(value)) fail();
  exactKeys(value, [
    "evidence_id",
    "candidate_id",
    "observed_trigger_epoch",
    "trigger_sequence",
    "observed_trigger_ticks",
    "fidelity",
    "proof_plane",
    "replayability",
    "htf_context_minutes",
    "coverage_start_epoch",
    "coverage_end_epoch",
    "ambiguity_codes",
    "passed_rule_ids",
    "failed_rule_ids",
    "reference_candle",
    "contact_candle",
    "recross_candle",
  ]);
  const observedTriggerEpoch = nullableInteger(value.observed_trigger_epoch);
  const observedTriggerTicks =
    value.observed_trigger_ticks === null ? null : integer(value.observed_trigger_ticks);
  if ((observedTriggerEpoch === null) !== (observedTriggerTicks === null)) fail();
  if (!Array.isArray(value.htf_context_minutes) || value.htf_context_minutes.length > 3) {
    fail();
  }
  const contexts = value.htf_context_minutes.map((context) => {
    if (context !== 15 && context !== 30 && context !== 60) fail();
    return context;
  });
  if (
    new Set(contexts).size !== contexts.length ||
    contexts.join() !== [...contexts].sort((left, right) => left - right).join()
  ) {
    fail();
  }
  const coverageStartEpoch = integer(value.coverage_start_epoch, 0);
  const coverageEndEpoch = integer(value.coverage_end_epoch, 1);
  if (
    coverageEndEpoch <= coverageStartEpoch ||
    (observedTriggerEpoch !== null &&
      (observedTriggerEpoch < coverageStartEpoch ||
        observedTriggerEpoch > coverageEndEpoch))
  ) {
    fail();
  }
  const proofPlane = enumValue(value.proof_plane, proofPlanes);
  const replayability = enumValue(value.replayability, replayabilities);
  const fidelity = enumValue(value.fidelity, fidelities);
  const parsedAmbiguityCodes = uniqueStrings(
    value.ambiguity_codes,
    3,
    ambiguityCodes,
  ) as EntryDecisionEvidence["ambiguityCodes"];
  const passedRuleIds = uniqueStrings(value.passed_rule_ids, 4, evidenceRuleIds);
  const failedRuleIds = uniqueStrings(value.failed_rule_ids, 8, evidenceRuleIds);
  if (
    passedRuleIds.some((ruleId) => failedRuleIds.includes(ruleId)) ||
    (fidelity === "EXACT" &&
      (replayability !==
        (proofPlane === "REALTIME_TICK"
          ? "LIVE_EXACT_NON_REPLAYABLE"
          : "REPLAYABLE") ||
        passedRuleIds.length === 0 ||
        failedRuleIds.length !== 0 ||
        parsedAmbiguityCodes.length !== 0 ||
        observedTriggerEpoch === null))
  ) {
    fail();
  }
  return {
    evidenceId: stringValue(value.evidence_id),
    candidateId: stringValue(value.candidate_id),
    observedTriggerEpoch,
    triggerSequence: integer(value.trigger_sequence, 0),
    observedTriggerTicks,
    fidelity,
    proofPlane,
    replayability,
    htfContextMinutes: contexts,
    coverageStartEpoch,
    coverageEndEpoch,
    ambiguityCodes: parsedAmbiguityCodes,
    passedRuleIds,
    failedRuleIds,
    referenceCandle: parseCandle(value.reference_candle, true),
    contactCandle: parseCandle(value.contact_candle),
    recrossCandle: parseCandle(value.recross_candle),
  };
}

function parseCandidate(value: unknown): EntryDecisionCandidate {
  if (!isRecord(value)) fail();
  exactKeys(value, [
    "candidate_id",
    "model",
    "state",
    "direction",
    "event_anchor_epoch",
    "trigger_ordinal",
    "boc_tier",
    "reference_candle_open_epoch",
    "source_claim_ids",
    "evidence",
  ]);
  const model = enumValue(value.model, models);
  const bocTier =
    value.boc_tier === null ? null : enumValue(value.boc_tier, bocTiers);
  const referenceCandleOpenEpoch = nullableInteger(
    value.reference_candle_open_epoch,
  );
  if (
    model === "BOC"
      ? bocTier === null || referenceCandleOpenEpoch === null
      : bocTier !== null || referenceCandleOpenEpoch !== null
  ) {
    fail();
  }
  const evidence = parseEvidence(value.evidence);
  const candidateId = stringValue(value.candidate_id);
  const state = enumValue(value.state, candidateStates);
  const expectedPassedRule = passedRuleByModel.get(model)!;
  const allowedFailedRuleIds = failedRuleIdsByModel.get(model)!;
  const failedRuleId = evidence.failedRuleIds[0] ?? null;
  const exactMatched =
    state === "MATCHED" &&
    evidence.fidelity === "EXACT" &&
    evidence.passedRuleIds.length === 1 &&
    evidence.passedRuleIds[0] === expectedPassedRule &&
    evidence.failedRuleIds.length === 0;
  const discretionaryBoc =
    model === "BOC" &&
    state === "MATCHED" &&
    bocTier === "DISCRETIONARY_5M" &&
    evidence.fidelity === "DISCRETIONARY" &&
    evidence.passedRuleIds.length === 0 &&
    evidence.failedRuleIds.length === 1 &&
    evidence.failedRuleIds[0] ===
      "BOC_DISCRETIONARY_CONTEXT_UNQUANTIFIED";
  const retainedFailure =
    ((state === "BLOCKED" &&
      failedRuleId !== "BOC_WRONG_DIRECTION" &&
      failedRuleId !== "BOC_DISCRETIONARY_CONTEXT_UNQUANTIFIED") ||
      (state === "REJECTED" &&
        model === "BOC" &&
        failedRuleId === "BOC_WRONG_DIRECTION")) &&
    evidence.passedRuleIds.length === 0 &&
    evidence.failedRuleIds.length === 1 &&
    failedRuleId !== null &&
    allowedFailedRuleIds.has(failedRuleId) &&
    (evidence.fidelity === "UNRESOLVED" ||
      (model === "BOC" && evidence.fidelity !== "EXACT"));
  const hasCompleteFlipLifecycle =
    evidence.contactCandle !== null && evidence.recrossCandle !== null;
  const hasPartialFlipLifecycle =
    (evidence.contactCandle === null) !== (evidence.recrossCandle === null);
  const flipChronologyInvalid =
    hasCompleteFlipLifecycle &&
    (evidence.contactCandle!.closeEpoch === null ||
      evidence.recrossCandle!.closeEpoch === null ||
      evidence.contactCandle!.closeEpoch! >
        evidence.recrossCandle!.openEpoch ||
      evidence.observedTriggerEpoch !== evidence.recrossCandle!.closeEpoch ||
      evidence.observedTriggerTicks !== evidence.recrossCandle!.closeTicks);
  if (
    evidence.candidateId !== candidateId ||
    (!exactMatched && !discretionaryBoc && !retainedFailure) ||
    (model === "BOC") !== (evidence.referenceCandle !== null) ||
    (model === "BOC" &&
      (evidence.referenceCandle?.openEpoch !== referenceCandleOpenEpoch ||
        evidence.contactCandle !== null ||
        evidence.recrossCandle !== null ||
        (evidence.fidelity === "EXACT" &&
          (bocTier !== "HTF_TIMED" ||
            evidence.htfContextMinutes.length === 0)))) ||
    (model === "DIR_CLOSE" &&
      (evidence.htfContextMinutes.length !== 0 ||
        evidence.contactCandle !== null ||
        evidence.recrossCandle !== null ||
        evidence.proofPlane !== "CONFIRMED_5M" ||
        evidence.replayability !== "REPLAYABLE")) ||
    (model === "HTF_FLIP" &&
      (hasPartialFlipLifecycle ||
        flipChronologyInvalid ||
        (evidence.fidelity === "EXACT" &&
          (evidence.htfContextMinutes.length === 0 ||
            !hasCompleteFlipLifecycle))))
  ) {
    fail();
  }
  return {
    candidateId,
    model,
    state,
    direction:
      value.direction === "LONG" || value.direction === "SHORT"
        ? value.direction
        : fail(),
    eventAnchorEpoch: integer(value.event_anchor_epoch, 0),
    triggerOrdinal: integer(value.trigger_ordinal, 1),
    bocTier,
    referenceCandleOpenEpoch,
    sourceClaimIds: uniqueStrings(value.source_claim_ids, 16),
    evidence,
  };
}

function parseSelection(value: unknown): EntryDecisionSelection {
  if (!isRecord(value)) fail();
  exactKeys(value, [
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
    "policy_action",
    "action",
    "effective_action_reason",
    "co_triggered_models",
    "evaluated_at_epoch",
    "selected_trigger_epoch",
    "selected_trigger_sequence",
  ]);
  if (value.policy_version !== "rd-entry-arbitration-v3") fail();
  const canonicalCandidateId =
    value.canonical_candidate_id === null
      ? null
      : stringValue(value.canonical_candidate_id);
  const canonicalEvidenceId =
    value.canonical_evidence_id === null
      ? null
      : stringValue(value.canonical_evidence_id);
  const canonicalModel =
    value.canonical_model === null
      ? null
      : enumValue(value.canonical_model, models);
  if (
    (canonicalCandidateId === null) !== (canonicalEvidenceId === null) ||
    (canonicalCandidateId === null) !== (canonicalModel === null)
  ) {
    fail();
  }
  const effectiveActionReason =
    value.effective_action_reason === null
      ? null
      : enumValue(value.effective_action_reason, effectiveReasons);
  const coTriggeredModels = uniqueStrings(
    value.co_triggered_models,
    3,
    models,
  ) as EntryModel[];
  const selectedTriggerEpoch = nullableInteger(value.selected_trigger_epoch);
  const selectedTriggerSequence = nullableInteger(
    value.selected_trigger_sequence,
  );
  if ((selectedTriggerEpoch === null) !== (selectedTriggerSequence === null)) {
    fail();
  }
  const policyAction = enumValue(value.policy_action, actions);
  const action = enumValue(value.action, actions);
  const reason = enumValue(value.reason, selectionReasons);
  const fidelity =
    value.fidelity === null ? null : enumValue(value.fidelity, fidelities);
  if (
    (action === policyAction && effectiveActionReason !== null) ||
    (action !== policyAction && effectiveActionReason === null) ||
    (action !== policyAction &&
      (policyAction !== "PAPER_ELIGIBLE" || action !== "SHADOW_ONLY"))
  ) {
    fail();
  }
  const canonicalReasons = new Set<EntryDecisionSelection["reason"]>([
    "ONLY_EXACT_TRIGGER",
    "EARLIEST_EXACT_TRIGGER",
    "FALLBACK_TO_CONFIRMED_CLOSE",
    "CO_TRIGGER_SAME_EVENT",
  ]);
  const emptyReasonAction = new Map<EntryDecisionSelection["reason"], EntryAction>([
    ["CO_TRIGGER_PRICE_CONFLICT", "SHADOW_ONLY"],
    ["NO_EXACT_CANDIDATE", "SHADOW_ONLY"],
    ["SETUP_INVALIDATED", "NONE"],
    ["NO_CANDIDATE", "NONE"],
  ]);
  if (
    canonicalCandidateId === null
      ? fidelity !== null ||
        emptyReasonAction.get(reason) !== policyAction ||
        selectedTriggerEpoch !== null
      : fidelity !== "EXACT" ||
        policyAction !== "PAPER_ELIGIBLE" ||
        !canonicalReasons.has(reason) ||
        selectedTriggerEpoch === null
  ) {
    fail();
  }
  if (
    reason === "CO_TRIGGER_SAME_EVENT"
      ? coTriggeredModels.length < 2 ||
        canonicalModel === null ||
        !coTriggeredModels.includes(canonicalModel)
      : coTriggeredModels.length !== 0
  ) {
    fail();
  }
  return {
    selectionId: stringValue(value.selection_id),
    setupId: stringValue(value.setup_id),
    revision: integer(value.revision, 0),
    canonicalCandidateId,
    canonicalEvidenceId,
    canonicalModel,
    reason,
    fidelity,
    policyAction,
    action,
    effectiveActionReason,
    coTriggeredModels,
    evaluatedAtEpoch: integer(value.evaluated_at_epoch, 0),
    selectedTriggerEpoch,
    selectedTriggerSequence,
  };
}

function parseItem(value: unknown): EntryDecisionItem {
  if (!isRecord(value)) fail();
  exactKeys(value, [
    "decision_id",
    "setup_id",
    "symbol",
    "direction",
    "selection",
    "parity",
    "candidates",
    "trade_plan",
    "paper_intent_id",
    "trade",
    "shadow_outcome",
  ]);
  const setupId = stringValue(value.setup_id);
  const decisionId = stringValue(value.decision_id);
  const direction =
    value.direction === "LONG" || value.direction === "SHORT"
      ? value.direction
      : fail();
  const selection = parseSelection(value.selection);
  if (!Array.isArray(value.candidates) || value.candidates.length < 1 || value.candidates.length > 3) {
    fail();
  }
  const candidates = value.candidates.map(parseCandidate);
  const candidateById = new Map(
    candidates.map((candidate) => [candidate.candidateId, candidate]),
  );
  if (
    candidateById.size !== candidates.length ||
    new Set(candidates.map((candidate) => candidate.model)).size !==
      candidates.length ||
    candidates.some(
      (candidate) => candidate.direction !== direction,
    ) ||
    selection.setupId !== setupId ||
    selection.canonicalCandidateId !== null &&
      (candidateById.get(selection.canonicalCandidateId)?.model !==
        selection.canonicalModel ||
        candidateById.get(selection.canonicalCandidateId)?.state !== "MATCHED" ||
        candidateById.get(selection.canonicalCandidateId)?.evidence.evidenceId !==
          selection.canonicalEvidenceId ||
        candidateById.get(selection.canonicalCandidateId)?.evidence.fidelity !==
          "EXACT")
  ) {
    fail();
  }
  const evidenceIds = candidates.map(
    (candidate) => candidate.evidence.evidenceId,
  );
  if (new Set(evidenceIds).size !== evidenceIds.length) fail();
  const considered = new Set(
    isRecord(value.selection)
      ? uniqueStrings(value.selection.candidate_ids_considered, 3)
      : [],
  );
  if (
    considered.size !== candidates.length ||
    candidates.some((candidate) => !considered.has(candidate.candidateId))
  ) {
    fail();
  }
  if (!isRecord(value.parity)) fail();
  exactKeys(value.parity, ["status", "mismatch_reason"]);
  const parityStatus = enumValue(value.parity.status, parityStatuses);
  const mismatchReason =
    value.parity.mismatch_reason === null
      ? null
      : enumValue(value.parity.mismatch_reason, parityReasons);
  if ((parityStatus === "MISMATCH") !== (mismatchReason !== null)) fail();
  if (!isRecord(value.trade_plan)) fail();
  exactKeys(value.trade_plan, [
    "tick_size",
    "entry_ticks",
    "stop_ticks",
    "target_ticks",
  ]);
  const paperIntentId =
    value.paper_intent_id === null ? null : stringValue(value.paper_intent_id);
  let trade: EntryDecisionItem["trade"] = null;
  if (value.trade !== null) {
    if (!isRecord(value.trade)) fail();
    exactKeys(value.trade, [
      "entry_price",
      "stop_loss",
      "take_profit",
      "state",
    ]);
    trade = {
      entryPrice: stringValue(value.trade.entry_price, 64),
      stopLoss: stringValue(value.trade.stop_loss, 64),
      takeProfit: stringValue(value.trade.take_profit, 64),
      state:
        value.trade.state === "OPEN" || value.trade.state === "SETTLED"
          ? value.trade.state
          : fail(),
    };
  }
  if ((paperIntentId === null) !== (trade === null)) fail();
  let shadowOutcome: EntryDecisionItem["shadowOutcome"] = null;
  if (value.shadow_outcome !== null) {
    if (!isRecord(value.shadow_outcome)) fail();
    exactKeys(value.shadow_outcome, ["state", "outcome_r_millis"]);
    const state = enumValue(value.shadow_outcome.state, shadowStates);
    const outcomeRMillis =
      value.shadow_outcome.outcome_r_millis === null
        ? null
        : integer(value.shadow_outcome.outcome_r_millis, -1_000, 10_000);
    if ((state === "OPEN" || state === "AMBIGUOUS") !== (outcomeRMillis === null)) {
      fail();
    }
    shadowOutcome = { state, outcomeRMillis };
  }
  const canonicalCandidate =
    selection.canonicalCandidateId === null
      ? null
      : candidateById.get(selection.canonicalCandidateId) ?? null;
  if (
    canonicalCandidate === null
      ? selection.selectedTriggerEpoch !== null ||
        selection.selectedTriggerSequence !== null
      : canonicalCandidate.evidence.evidenceId !==
          selection.canonicalEvidenceId ||
        canonicalCandidate.evidence.observedTriggerEpoch !==
          selection.selectedTriggerEpoch ||
        canonicalCandidate.evidence.triggerSequence !==
          selection.selectedTriggerSequence
  ) {
    fail();
  }
  if ((selection.action === "PAPER_ELIGIBLE") !== (paperIntentId !== null)) {
    fail();
  }
  if (selection.reason === "CO_TRIGGER_SAME_EVENT") {
    const coTriggered = selection.coTriggeredModels.map(
      (model) => candidates.find((candidate) => candidate.model === model) ?? null,
    );
    if (
      canonicalCandidate === null ||
      coTriggered.some(
        (candidate) =>
          candidate === null ||
          candidate.state !== "MATCHED" ||
          candidate.evidence.fidelity !== "EXACT" ||
          candidate.evidence.observedTriggerEpoch !==
            canonicalCandidate.evidence.observedTriggerEpoch ||
          candidate.evidence.triggerSequence !==
            canonicalCandidate.evidence.triggerSequence ||
          candidate.evidence.observedTriggerTicks !==
            canonicalCandidate.evidence.observedTriggerTicks,
      )
    ) {
      fail();
    }
  }
  return {
    decisionId,
    setupId,
    symbol: stringValue(value.symbol, 64),
    direction,
    selection,
    parity: { status: parityStatus, mismatchReason },
    candidates,
    tradePlan: {
      tickSize: stringValue(value.trade_plan.tick_size, 32),
      entryTicks: integer(value.trade_plan.entry_ticks),
      stopTicks: integer(value.trade_plan.stop_ticks),
      targetTicks: integer(value.trade_plan.target_ticks),
    },
    paperIntentId,
    trade,
    shadowOutcome,
  };
}

function parseReport(value: unknown): EntryDecisionSnapshot {
  if (!isRecord(value)) fail();
  exactKeys(value, ["schema_version", "mode", "count", "items"]);
  if (
    value.schema_version !== "1.0" ||
    value.mode !== "PAPER_ONLY" ||
    !Array.isArray(value.items) ||
    value.items.length > 200 ||
    integer(value.count, 0, 200) !== value.items.length
  ) {
    fail();
  }
  const items = value.items.map(parseItem);
  if (new Set(items.map((item) => item.decisionId)).size !== items.length) {
    fail();
  }
  return items.length === 0
    ? {
        state: "EMPTY",
        items: [],
        message: "No RD entry decisions have been recorded.",
      }
    : {
        state: "READY",
        items,
        message: `${items.length} immutable RD entry ${
          items.length === 1 ? "decision" : "decisions"
        }.`,
      };
}

const ERROR_SNAPSHOT: EntryDecisionSnapshot = {
  state: "ERROR",
  items: [],
  message: "Entry decisions are unavailable or malformed.",
};

export async function loadEntryDecisions(
  credential: string,
  signal?: AbortSignal,
): Promise<EntryDecisionSnapshot> {
  try {
    if (credential.length < 1 || credential.length > 1_024) return ERROR_SNAPSHOT;
    const response = await fetchBounded(
      "/api/v1/rd-entry-decisions?limit=50",
      signal,
      { Authorization: `Bearer ${credential}` },
    );
    if (response.status !== 200) return ERROR_SNAPSHOT;
    return parseReport(await parseStrictResponse(response));
  } catch {
    return ERROR_SNAPSHOT;
  }
}
