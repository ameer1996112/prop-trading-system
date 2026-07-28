import { canonicalSha256 } from "./rd-entry-policy";

export const ACTIVE_ENTRY_MODELS_V3 = [
  "BOC",
  "DIR_CLOSE",
  "HTF_FLIP",
] as const;
export const SELECTION_ACTIONS_V3 = [
  "OBSERVE",
  "PAPER_ELIGIBLE",
  "SHADOW_ONLY",
  "NONE",
] as const;
export const POLICY_VERSION_V3 = "rd-entry-arbitration-v3" as const;

export type EntryModelV3 = (typeof ACTIVE_ENTRY_MODELS_V3)[number];
export type BocTier = "HTF_TIMED" | "DISCRETIONARY_5M";
export type EvidenceReplayability =
  | "REPLAYABLE"
  | "LIVE_EXACT_NON_REPLAYABLE";
export type EntryDirectionV3 = "LONG" | "SHORT";
export type CandidateStateV3 = "MATCHED" | "BLOCKED" | "REJECTED";
export type CandidateFidelityV3 =
  | "EXACT"
  | "CALIBRATED"
  | "DISCRETIONARY"
  | "UNRESOLVED";
export type ProofPlaneV3 =
  | "CONFIRMED_5M"
  | "LOWER_TIMEFRAME_REPLAY"
  | "REALTIME_TICK"
  | "EXTERNAL_ARCHIVED_TICK";
export type AmbiguityCodeV3 =
  | "SHADOW_SAME_CHILD_BAR_ORDER"
  | "SHADOW_MISSING_INTRABAR_COVERAGE"
  | "SHADOW_REALTIME_ONLY_NOT_REPLAYABLE";
export type SelectionActionV3 = (typeof SELECTION_ACTIONS_V3)[number];
export type SelectionReasonV3 =
  | "ONLY_EXACT_TRIGGER"
  | "EARLIEST_EXACT_TRIGGER"
  | "FALLBACK_TO_CONFIRMED_CLOSE"
  | "CO_TRIGGER_SAME_EVENT"
  | "CO_TRIGGER_PRICE_CONFLICT"
  | "NO_EXACT_CANDIDATE"
  | "SETUP_INVALIDATED"
  | "NO_CANDIDATE";

export interface OrderedCandleV3 {
  readonly open_epoch: number;
  readonly close_epoch: number;
  readonly open_ticks: number;
  readonly high_ticks: number;
  readonly low_ticks: number;
  readonly close_ticks: number;
}

export interface BocProofV3 {
  readonly reference_candle: OrderedCandleV3;
  readonly trigger_candle_open_epoch: number;
  readonly trigger_epoch: number;
  readonly trigger_sequence: number;
  readonly trigger_ticks: number;
  readonly htf_boundary_epoch: number | null;
  readonly htf_context_minutes: readonly (15 | 30 | 60)[];
  readonly proof_plane: ProofPlaneV3;
  readonly replayability: EvidenceReplayability;
  readonly fidelity: CandidateFidelityV3;
  readonly coverage_start_epoch: number;
  readonly coverage_end_epoch: number;
  readonly is_realtime: boolean;
}

export interface EntryTriggerProofV3 {
  readonly event_anchor_epoch: number;
  readonly trigger_epoch: number;
  readonly trigger_sequence: number;
  readonly trigger_ticks: number;
  readonly htf_open_ticks: number;
  readonly htf_context_minutes: readonly (15 | 30 | 60)[];
  readonly proof_plane: ProofPlaneV3;
  readonly replayability: EvidenceReplayability;
  readonly fidelity: CandidateFidelityV3;
  readonly coverage_start_epoch: number;
  readonly coverage_end_epoch: number;
  readonly is_realtime: boolean;
  readonly contact_candle: OrderedCandleV3 | null;
  readonly recross_candle: OrderedCandleV3 | null;
  readonly coverage_gap_detected: boolean;
  readonly full_lifecycle_ordered: boolean;
  readonly destination_seen_before_contact: boolean;
  readonly ambiguity_codes: readonly AmbiguityCodeV3[];
}

export interface SetupEntryFactsV3 {
  readonly setup_id: string;
  readonly direction: EntryDirectionV3;
  readonly zone_top_ticks: number;
  readonly zone_bottom_ticks: number;
  readonly zone_engaged_epoch: number | null;
  readonly invalidated_before_entry: boolean;
  readonly common_fidelity: CandidateFidelityV3;
}

export interface EntryMatchRequestV3 {
  readonly setup: SetupEntryFactsV3;
  readonly boc_proof: BocProofV3 | null;
  readonly directional_close: boolean;
  readonly confirmed_bar: OrderedCandleV3 | null;
  readonly close_trigger_sequence: number;
  readonly htf_flip_proof: EntryTriggerProofV3 | null;
  readonly observed_at_epoch: number;
}

export interface EntryCandidateV3 {
  readonly candidate_id: string;
  readonly setup_id: string;
  readonly model: EntryModelV3;
  readonly state: CandidateStateV3;
  readonly direction: EntryDirectionV3;
  readonly event_anchor_epoch: number;
  readonly trigger_ordinal: number;
  readonly boc_tier: BocTier | null;
  readonly reference_candle_open_epoch: number | null;
  readonly source_claim_ids: readonly string[];
  readonly observed_at_epoch: number;
}

export interface EntryCandidateEvidenceV3 {
  readonly evidence_id: string;
  readonly candidate_id: string;
  readonly observed_trigger_epoch: number | null;
  readonly trigger_sequence: number;
  readonly observed_trigger_ticks: number | null;
  readonly htf_context_minutes: readonly (15 | 30 | 60)[];
  readonly fidelity: CandidateFidelityV3;
  readonly proof_plane: ProofPlaneV3;
  readonly replayability: EvidenceReplayability;
  readonly coverage_start_epoch: number;
  readonly coverage_end_epoch: number;
  readonly ambiguity_codes: readonly AmbiguityCodeV3[];
  readonly boc_tier: BocTier | null;
  readonly reference_candle_open_epoch: number | null;
  readonly reference_candle_open_ticks: number | null;
  readonly reference_candle_high_ticks: number | null;
  readonly reference_candle_low_ticks: number | null;
  readonly reference_candle_close_ticks: number | null;
  readonly htf_open_ticks: number | null;
  readonly contact_candle: OrderedCandleV3 | null;
  readonly recross_candle: OrderedCandleV3 | null;
  readonly coverage_gap_detected: boolean | null;
  readonly full_lifecycle_ordered: boolean | null;
  readonly destination_seen_before_contact: boolean | null;
  readonly passed_rule_ids: readonly string[];
  readonly failed_rule_ids: readonly string[];
  readonly source_claim_ids: readonly string[];
  readonly payload_sha256: string;
  readonly observed_at_epoch: number;
}

export interface EntrySelectionV3 {
  readonly selection_id: string;
  readonly setup_id: string;
  readonly policy_version: typeof POLICY_VERSION_V3;
  readonly revision: number;
  readonly candidate_ids_considered: readonly string[];
  readonly canonical_candidate_id: string | null;
  readonly canonical_evidence_id: string | null;
  readonly canonical_model: EntryModelV3 | null;
  readonly reason: SelectionReasonV3;
  readonly fidelity: CandidateFidelityV3 | null;
  readonly action: SelectionActionV3;
  readonly co_triggered_models: readonly EntryModelV3[];
  readonly evaluated_at_epoch: number;
}

export interface EntryEvaluationV3 {
  readonly candidates: readonly EntryCandidateV3[];
  readonly evidence: readonly EntryCandidateEvidenceV3[];
  readonly selection: EntrySelectionV3;
}

export interface EntryArbitrationInputV3 {
  readonly setup_id: string;
  readonly direction: EntryDirectionV3;
  readonly zone_top_ticks: number;
  readonly zone_bottom_ticks: number;
  readonly zone_engaged_epoch: number | null;
  readonly common_fidelity: CandidateFidelityV3;
  readonly setup_invalidated: boolean;
  readonly boc_proof: BocProofV3 | null;
  readonly directional_close: boolean;
  readonly confirmed_bar: OrderedCandleV3 | null;
  readonly close_trigger_sequence: number;
  readonly htf_flip_proof: EntryTriggerProofV3 | null;
  readonly observed_at_epoch: number;
  readonly policy_version: typeof POLICY_VERSION_V3;
  readonly revision: number;
  readonly evaluated_at_epoch: number;
  readonly opened_selection_seed: {
    readonly confirmed_bar: OrderedCandleV3;
    readonly trigger_sequence: number;
    readonly revision: number;
    readonly evaluated_at_epoch: number;
  } | null;
}

export const SOURCE_CLAIMS_V3 = {
  BOC_HTF_TIMED: [
    "discretionary-break-2025-11",
    "reject-non-htf-break-2026-05",
    "htf-timed-boc-2026-06",
  ],
  BOC_DISCRETIONARY_5M: ["discretionary-break-2025-11"],
  DIR_CLOSE: [
    "standard-close-2024-03",
    "closure-or-flip-2025-03",
    "directional-close-2025-08",
    "directional-close-required-2026-06",
    "model-continuation-2026-07",
  ],
  HTF_FLIP: [
    "htf-flip-2024-03",
    "htf-context-set-2025-08",
    "htf-flip-definition-2025-08",
    "pure-flip-narrowing-2026-05",
    "model-continuation-2026-07",
  ],
} as const;

const SHA256 = /^[a-f0-9]{64}$/u;
const ENTRY_MODELS = new Set<string>(ACTIVE_ENTRY_MODELS_V3);
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
const EXPECTED_RULES: Readonly<Record<EntryModelV3, string>> = {
  BOC: "ENTRY_BOC_HTF_TIMED",
  DIR_CLOSE: "ENTRY_DIR_CLOSE",
  HTF_FLIP: "ENTRY_HTF_FLIP",
};

function fail(message: string): never {
  throw new TypeError(message);
}

function safeInteger(value: number, name: string, minimum?: number): void {
  if (
    !Number.isSafeInteger(value) ||
    (minimum !== undefined && value < minimum)
  ) {
    fail(`${name} must be a safe integer`);
  }
}

function unique(values: readonly string[], name: string): void {
  if (
    values.some((value) => typeof value !== "string" || value.length === 0) ||
    new Set(values).size !== values.length
  ) {
    fail(`${name} must contain unique non-empty strings`);
  }
}

function digest(value: string, name: string): void {
  if (!SHA256.test(value) || value === "0".repeat(64)) {
    fail(`${name} must be a nonzero lowercase SHA-256`);
  }
}

export function validateOrderedCandleV3(
  candle: OrderedCandleV3,
  name = "candle",
): void {
  for (const key of [
    "open_epoch",
    "close_epoch",
    "open_ticks",
    "high_ticks",
    "low_ticks",
    "close_ticks",
  ] as const) {
    safeInteger(candle[key], `${name}.${key}`, key.endsWith("epoch") ? 0 : undefined);
  }
  if (
    candle.close_epoch <= candle.open_epoch ||
    candle.high_ticks <
      Math.max(
        candle.open_ticks,
        candle.close_ticks,
        candle.low_ticks,
      ) ||
    candle.low_ticks >
      Math.min(
        candle.open_ticks,
        candle.close_ticks,
        candle.high_ticks,
      )
  ) {
    fail(`${name} chronology or OHLC is invalid`);
  }
}

export async function candidateIdV3(
  identity: Pick<
    EntryCandidateV3,
    | "setup_id"
    | "model"
    | "direction"
    | "event_anchor_epoch"
    | "trigger_ordinal"
    | "boc_tier"
    | "reference_candle_open_epoch"
  >,
): Promise<string> {
  return canonicalSha256({
    boc_tier: identity.boc_tier,
    direction: identity.direction,
    event_anchor_epoch: identity.event_anchor_epoch,
    model: identity.model,
    reference_candle_open_epoch: identity.reference_candle_open_epoch,
    setup_id: identity.setup_id,
    trigger_ordinal: identity.trigger_ordinal,
  });
}

type EvidencePayloadFields = Omit<
  EntryCandidateEvidenceV3,
  "evidence_id" | "payload_sha256" | "observed_at_epoch"
>;

export async function evidencePayloadSha256V3(
  value: EvidencePayloadFields,
): Promise<string> {
  return canonicalSha256({
    ambiguity_codes: value.ambiguity_codes,
    boc_tier: value.boc_tier,
    candidate_id: value.candidate_id,
    contact_candle: value.contact_candle,
    coverage_end_epoch: value.coverage_end_epoch,
    coverage_gap_detected: value.coverage_gap_detected,
    coverage_start_epoch: value.coverage_start_epoch,
    destination_seen_before_contact: value.destination_seen_before_contact,
    failed_rule_ids: value.failed_rule_ids,
    fidelity: value.fidelity,
    full_lifecycle_ordered: value.full_lifecycle_ordered,
    htf_context_minutes: value.htf_context_minutes,
    htf_open_ticks: value.htf_open_ticks,
    observed_trigger_epoch: value.observed_trigger_epoch,
    observed_trigger_ticks: value.observed_trigger_ticks,
    passed_rule_ids: value.passed_rule_ids,
    proof_plane: value.proof_plane,
    reference_candle_close_ticks: value.reference_candle_close_ticks,
    reference_candle_high_ticks: value.reference_candle_high_ticks,
    reference_candle_low_ticks: value.reference_candle_low_ticks,
    reference_candle_open_epoch: value.reference_candle_open_epoch,
    reference_candle_open_ticks: value.reference_candle_open_ticks,
    recross_candle: value.recross_candle,
    replayability: value.replayability,
    source_claim_ids: value.source_claim_ids,
    trigger_sequence: value.trigger_sequence,
  });
}

export async function evidenceIdV3(
  value: Pick<
    EntryCandidateEvidenceV3,
    | "candidate_id"
    | "coverage_start_epoch"
    | "coverage_end_epoch"
    | "observed_trigger_epoch"
    | "trigger_sequence"
    | "payload_sha256"
    | "proof_plane"
  >,
): Promise<string> {
  return canonicalSha256({
    candidate_id: value.candidate_id,
    coverage_end_epoch: value.coverage_end_epoch,
    coverage_start_epoch: value.coverage_start_epoch,
    observed_trigger_epoch: value.observed_trigger_epoch,
    payload_sha256: value.payload_sha256,
    proof_plane: value.proof_plane,
    trigger_sequence: value.trigger_sequence,
  });
}

export async function selectionIdV3(
  value: Omit<EntrySelectionV3, "selection_id" | "canonical_model" | "evaluated_at_epoch">,
): Promise<string> {
  return canonicalSha256({
    action: value.action,
    candidate_ids_considered: value.candidate_ids_considered,
    canonical_candidate_id: value.canonical_candidate_id,
    canonical_evidence_id: value.canonical_evidence_id,
    co_triggered_models: value.co_triggered_models,
    fidelity: value.fidelity,
    policy_version: value.policy_version,
    reason: value.reason,
    revision: value.revision,
    setup_id: value.setup_id,
  });
}

export function validateEntryCandidateV3(candidate: EntryCandidateV3): void {
  digest(candidate.candidate_id, "candidate_id");
  if (
    typeof candidate.setup_id !== "string" ||
    candidate.setup_id.length === 0 ||
    !ENTRY_MODELS.has(candidate.model) ||
    !["MATCHED", "BLOCKED", "REJECTED"].includes(candidate.state) ||
    !["LONG", "SHORT"].includes(candidate.direction)
  ) {
    fail("candidate enum or identity field is invalid");
  }
  safeInteger(candidate.event_anchor_epoch, "event_anchor_epoch", 0);
  safeInteger(candidate.trigger_ordinal, "trigger_ordinal", 1);
  safeInteger(candidate.observed_at_epoch, "observed_at_epoch", 0);
  if (
    candidate.model === "BOC"
      ? candidate.boc_tier === null ||
        candidate.reference_candle_open_epoch === null
      : candidate.boc_tier !== null ||
        candidate.reference_candle_open_epoch !== null
  ) {
    fail("candidate BOC identity fields are inconsistent");
  }
  if (candidate.reference_candle_open_epoch !== null) {
    safeInteger(
      candidate.reference_candle_open_epoch,
      "reference_candle_open_epoch",
      0,
    );
  }
  unique(candidate.source_claim_ids, "source_claim_ids");
}

function exactEvidenceRuleIsConsistent(
  candidate: EntryCandidateV3,
  evidence: EntryCandidateEvidenceV3,
): boolean {
  return (
    evidence.passed_rule_ids.length === 1 &&
    evidence.passed_rule_ids[0] === EXPECTED_RULES[candidate.model] &&
    evidence.failed_rule_ids.length === 0
  );
}

export function validateEntryEvidenceV3(
  evidence: EntryCandidateEvidenceV3,
): void {
  digest(evidence.evidence_id, "evidence_id");
  digest(evidence.candidate_id, "candidate_id");
  digest(evidence.payload_sha256, "payload_sha256");
  if (
    (evidence.observed_trigger_epoch === null) !==
    (evidence.observed_trigger_ticks === null)
  ) {
    fail("trigger epoch and ticks must pair");
  }
  for (const [name, value, minimum] of [
    ["trigger_sequence", evidence.trigger_sequence, 0],
    ["coverage_start_epoch", evidence.coverage_start_epoch, 0],
    ["coverage_end_epoch", evidence.coverage_end_epoch, 0],
    ["observed_at_epoch", evidence.observed_at_epoch, 0],
  ] as const) {
    safeInteger(value, name, minimum);
  }
  if (
    !FIDELITIES.has(evidence.fidelity) ||
    !PROOF_PLANES.has(evidence.proof_plane) ||
    !["REPLAYABLE", "LIVE_EXACT_NON_REPLAYABLE"].includes(
      evidence.replayability,
    ) ||
    evidence.coverage_end_epoch <= evidence.coverage_start_epoch ||
    evidence.coverage_end_epoch > evidence.observed_at_epoch
  ) {
    fail("evidence fidelity, plane, or coverage is invalid");
  }
  if (
    evidence.observed_trigger_epoch !== null &&
    (evidence.observed_trigger_epoch < evidence.coverage_start_epoch ||
      evidence.observed_trigger_epoch > evidence.coverage_end_epoch ||
      evidence.observed_trigger_epoch > evidence.observed_at_epoch)
  ) {
    fail("trigger lies outside causal coverage");
  }
  if (
    [...evidence.htf_context_minutes].sort((a, b) => a - b).join() !==
      evidence.htf_context_minutes.join() ||
    new Set(evidence.htf_context_minutes).size !==
      evidence.htf_context_minutes.length ||
    evidence.htf_context_minutes.some(
      (value) => value !== 15 && value !== 30 && value !== 60,
    )
  ) {
    fail("HTF contexts must be sorted, unique, and supported");
  }
  unique(evidence.ambiguity_codes, "ambiguity_codes");
  unique(evidence.passed_rule_ids, "passed_rule_ids");
  unique(evidence.failed_rule_ids, "failed_rule_ids");
  unique(evidence.source_claim_ids, "source_claim_ids");
  if (
    evidence.passed_rule_ids.some((rule) =>
      evidence.failed_rule_ids.includes(rule),
    ) ||
    (evidence.fidelity === "EXACT" &&
      (evidence.failed_rule_ids.length !== 0 ||
        evidence.passed_rule_ids.length === 0))
  ) {
    fail("evidence rule results are inconsistent");
  }
  const referenceValues = [
    evidence.reference_candle_open_epoch,
    evidence.reference_candle_open_ticks,
    evidence.reference_candle_high_ticks,
    evidence.reference_candle_low_ticks,
    evidence.reference_candle_close_ticks,
  ];
  if (
    evidence.boc_tier === null
      ? referenceValues.some((value) => value !== null)
      : referenceValues.some((value) => value === null)
  ) {
    fail("BOC evidence requires complete reference OHLC");
  }
  if (evidence.boc_tier !== null) {
    const [openEpoch, open, high, low, close] = referenceValues as number[];
    safeInteger(openEpoch!, "reference_candle_open_epoch", 0);
    for (const [name, value] of [
      ["reference_candle_open_ticks", open],
      ["reference_candle_high_ticks", high],
      ["reference_candle_low_ticks", low],
      ["reference_candle_close_ticks", close],
    ] as const) {
      safeInteger(value!, name);
    }
    if (high! < Math.max(open!, close!, low!) || low! > Math.min(open!, close!, high!)) {
      fail("reference OHLC is invalid");
    }
  }
  const flipValues = [
    evidence.htf_open_ticks,
    evidence.contact_candle,
    evidence.recross_candle,
    evidence.coverage_gap_detected,
    evidence.full_lifecycle_ordered,
    evidence.destination_seen_before_contact,
  ];
  if (flipValues.some((value) => value !== null)) {
    if (flipValues.some((value) => value === null)) {
      fail("flip evidence lifecycle fields must be complete");
    }
    validateOrderedCandleV3(evidence.contact_candle!, "contact_candle");
    validateOrderedCandleV3(evidence.recross_candle!, "recross_candle");
    if (
      evidence.contact_candle!.close_epoch >
        evidence.recross_candle!.open_epoch ||
      evidence.observed_trigger_epoch !==
        evidence.recross_candle!.close_epoch ||
      evidence.observed_trigger_ticks !== evidence.htf_open_ticks
    ) {
      fail("flip lifecycle chronology is inconsistent");
    }
  }
  const expectedReplayability =
    evidence.proof_plane === "REALTIME_TICK"
      ? "LIVE_EXACT_NON_REPLAYABLE"
      : "REPLAYABLE";
  if (
    evidence.fidelity === "EXACT" &&
    evidence.replayability !== expectedReplayability
  ) {
    fail("exact proof plane and replayability are inconsistent");
  }
}

export function validateSelectionShapeV3(selection: EntrySelectionV3): void {
  digest(selection.selection_id, "selection_id");
  if (
    selection.policy_version !== POLICY_VERSION_V3 ||
    typeof selection.setup_id !== "string" ||
    selection.setup_id.length === 0
  ) {
    fail("selection identity is invalid");
  }
  safeInteger(selection.revision, "revision", 0);
  safeInteger(selection.evaluated_at_epoch, "evaluated_at_epoch", 0);
  unique(selection.candidate_ids_considered, "candidate_ids_considered");
  if (
    [...selection.candidate_ids_considered].sort().join() !==
    selection.candidate_ids_considered.join()
  ) {
    fail("candidate IDs considered must be sorted");
  }
  if (
    (selection.canonical_candidate_id === null) !==
      (selection.canonical_evidence_id === null) ||
    (selection.canonical_candidate_id === null) !==
      (selection.canonical_model === null)
  ) {
    fail("canonical selection pointers and model must agree");
  }
  if (selection.canonical_candidate_id !== null) {
    digest(selection.canonical_candidate_id, "canonical_candidate_id");
    digest(selection.canonical_evidence_id!, "canonical_evidence_id");
  }
  const sortedModels = [...new Set(selection.co_triggered_models)].sort();
  if (sortedModels.join() !== selection.co_triggered_models.join()) {
    fail("co-triggered models must be sorted and unique");
  }
  const canonicalReasons = new Set<SelectionReasonV3>([
    "ONLY_EXACT_TRIGGER",
    "EARLIEST_EXACT_TRIGGER",
    "FALLBACK_TO_CONFIRMED_CLOSE",
    "CO_TRIGGER_SAME_EVENT",
  ]);
  const emptyActions: Partial<Record<SelectionReasonV3, SelectionActionV3>> = {
    CO_TRIGGER_PRICE_CONFLICT: "SHADOW_ONLY",
    NO_EXACT_CANDIDATE: "SHADOW_ONLY",
    SETUP_INVALIDATED: "NONE",
    NO_CANDIDATE: "NONE",
  };
  if (selection.canonical_candidate_id !== null) {
    if (
      selection.fidelity !== "EXACT" ||
      selection.action !== "PAPER_ELIGIBLE" ||
      !canonicalReasons.has(selection.reason)
    ) {
      fail("canonical action, reason, and fidelity are inconsistent");
    }
  } else if (
    selection.fidelity !== null ||
    emptyActions[selection.reason] !== selection.action
  ) {
    fail("canonical-null action, reason, and fidelity are inconsistent");
  }
  if (
    selection.reason === "CO_TRIGGER_SAME_EVENT"
      ? selection.co_triggered_models.length < 2
      : selection.co_triggered_models.length !== 0
  ) {
    fail("co-trigger fields are inconsistent");
  }
}

export function validateEntryEvaluationV3(
  evaluation: EntryEvaluationV3,
): void {
  const candidateIds = evaluation.candidates.map((item) => item.candidate_id);
  const evidenceIds = evaluation.evidence.map((item) => item.evidence_id);
  for (const candidate of evaluation.candidates) {
    validateEntryCandidateV3(candidate);
  }
  for (const evidence of evaluation.evidence) {
    validateEntryEvidenceV3(evidence);
  }
  validateSelectionShapeV3(evaluation.selection);
  if (
    candidateIds.join() !== [...candidateIds].sort().join() ||
    evidenceIds.join() !== [...evidenceIds].sort().join() ||
    new Set(candidateIds).size !== candidateIds.length ||
    new Set(evidenceIds).size !== evidenceIds.length ||
    evaluation.selection.candidate_ids_considered.join() !== candidateIds.join()
  ) {
    fail("evaluation records must be unique, sorted, and selected");
  }
  const candidateById = new Map(
    evaluation.candidates.map((candidate) => [candidate.candidate_id, candidate]),
  );
  const evidenceById = new Map(
    evaluation.evidence.map((evidence) => [evidence.evidence_id, evidence]),
  );
  for (const evidence of evaluation.evidence) {
    const candidate = candidateById.get(evidence.candidate_id);
    if (candidate === undefined) fail("evidence references unknown candidate");
    if (
      evidence.fidelity === "EXACT" &&
      !exactEvidenceRuleIsConsistent(candidate, evidence)
    ) {
      fail("exact evidence rule results conflict with candidate model");
    }
    if (evidence.fidelity !== "EXACT") continue;
    if (
      candidate.model === "DIR_CLOSE" &&
      (evidence.coverage_end_epoch - evidence.coverage_start_epoch !== 300 ||
        evidence.observed_trigger_epoch !== evidence.coverage_end_epoch)
    ) {
      fail("exact close evidence must cover one five-minute bar");
    }
    if (candidate.model === "BOC") {
      if (
        evidence.reference_candle_open_epoch === null ||
        evidence.observed_trigger_epoch === null
      ) {
        fail("exact BOC evidence requires reference and trigger epochs");
      }
      const triggerOpen =
        Math.floor(evidence.observed_trigger_epoch / 300) * 300;
      if (
        evidence.reference_candle_open_epoch + 300 > triggerOpen ||
        evidence.htf_context_minutes.length === 0 ||
        evidence.htf_context_minutes.some(
          (context) => triggerOpen % (context * 60) !== 0,
        )
      ) {
        fail("exact BOC evidence violates causal HTF timing");
      }
    }
    if (candidate.model === "HTF_FLIP") {
      if (
        evidence.htf_open_ticks === null ||
        evidence.contact_candle === null ||
        evidence.recross_candle === null ||
        evidence.coverage_gap_detected !== false ||
        evidence.full_lifecycle_ordered !== true ||
        evidence.destination_seen_before_contact !== false ||
        candidate.event_anchor_epoch > evidence.contact_candle.open_epoch ||
        evidence.htf_context_minutes.length === 0 ||
        evidence.observed_trigger_epoch === null ||
        evidence.htf_context_minutes.some(
          (context) =>
            evidence.observed_trigger_epoch! >=
            candidate.event_anchor_epoch + context * 60,
        )
      ) {
        fail("exact flip evidence lacks ordered lifecycle chronology");
      }
      const contactCrossed =
        candidate.direction === "LONG"
          ? evidence.contact_candle.high_ticks > evidence.htf_open_ticks
          : evidence.contact_candle.low_ticks < evidence.htf_open_ticks;
      if (contactCrossed) fail("flip contact already crossed the HTF open");
    }
  }
  const selection = evaluation.selection;
  if (selection.canonical_candidate_id === null) return;
  const candidate = candidateById.get(selection.canonical_candidate_id);
  const evidence = evidenceById.get(selection.canonical_evidence_id!);
  if (
    candidate === undefined ||
    evidence === undefined ||
    evidence.candidate_id !== candidate.candidate_id ||
    selection.canonical_model !== candidate.model ||
    selection.fidelity !== evidence.fidelity
  ) {
    fail("canonical selection graph is inconsistent");
  }
  if (
    selection.action === "PAPER_ELIGIBLE" &&
    (candidate.state !== "MATCHED" ||
      evidence.fidelity !== "EXACT" ||
      !exactEvidenceRuleIsConsistent(candidate, evidence))
  ) {
    fail("paper eligible selection requires matched exact evidence");
  }
  if (candidate.model === "HTF_FLIP") {
    if (
      evidence.contact_candle === null ||
      evidence.observed_trigger_epoch === null ||
      candidate.event_anchor_epoch > evidence.contact_candle.open_epoch ||
      evidence.htf_context_minutes.length === 0 ||
      evidence.htf_context_minutes.some(
        (context) =>
          evidence.observed_trigger_epoch! >=
          candidate.event_anchor_epoch + context * 60,
      )
    ) {
      fail("canonical flip violates anchor chronology");
    }
  }
}
