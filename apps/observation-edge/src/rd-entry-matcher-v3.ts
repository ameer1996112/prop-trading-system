import {
  candidateIdV3,
  evidenceIdV3,
  evidencePayloadSha256V3,
  SOURCE_CLAIMS_V3,
  type BocProofV3,
  type BocTier,
  type CandidateFidelityV3,
  type CandidateStateV3,
  type EntryCandidateEvidenceV3,
  type EntryCandidateV3,
  type EntryMatchRequestV3,
  type EntryModelV3,
  type EntryTriggerProofV3,
  type EvidenceReplayability,
  type OrderedCandleV3,
  type ProofPlaneV3,
} from "./rd-entry-domain-v3";

export interface EntryMatchResultV3 {
  readonly candidates: readonly EntryCandidateV3[];
  readonly evidence: readonly EntryCandidateEvidenceV3[];
}

interface EvidenceFieldsV3 {
  readonly observed_trigger_epoch: number;
  readonly trigger_sequence: number;
  readonly observed_trigger_ticks: number;
  readonly htf_context_minutes: readonly (15 | 30 | 60)[];
  readonly fidelity: CandidateFidelityV3;
  readonly proof_plane: ProofPlaneV3;
  readonly replayability: EvidenceReplayability;
  readonly coverage_start_epoch: number;
  readonly coverage_end_epoch: number;
  readonly boc_tier: BocTier | null;
  readonly reference_candle: OrderedCandleV3 | null;
  readonly ambiguity_codes: EntryCandidateEvidenceV3["ambiguity_codes"];
  readonly htf_open_ticks: number | null;
  readonly contact_candle: OrderedCandleV3 | null;
  readonly recross_candle: OrderedCandleV3 | null;
  readonly coverage_gap_detected: boolean | null;
  readonly full_lifecycle_ordered: boolean | null;
  readonly destination_seen_before_contact: boolean | null;
  readonly passed_rule_ids: readonly string[];
  readonly failed_rule_ids: readonly string[];
  readonly source_claim_ids: readonly string[];
}

function bocBreaksReference(
  request: EntryMatchRequestV3,
  proof: BocProofV3,
): boolean {
  return request.setup.direction === "LONG"
    ? proof.trigger_ticks > proof.reference_candle.high_ticks
    : proof.trigger_ticks < proof.reference_candle.low_ticks;
}

function strictBocContext(proof: BocProofV3): boolean {
  return (
    proof.htf_boundary_epoch === proof.trigger_candle_open_epoch &&
    proof.htf_context_minutes.length > 0 &&
    proof.htf_context_minutes.every(
      (context) =>
        (context === 15 || context === 30 || context === 60) &&
        proof.htf_boundary_epoch! % (context * 60) === 0,
    )
  );
}

function commonFailure(
  request: EntryMatchRequestV3,
  triggerEpoch: number,
): readonly string[] {
  if (request.setup.common_fidelity !== "EXACT") {
    return ["COMMON_SETUP_NOT_EXACT"];
  }
  if (request.setup.invalidated_before_entry) return ["SETUP_INVALIDATED"];
  if (
    request.setup.zone_engaged_epoch === null ||
    triggerEpoch < request.setup.zone_engaged_epoch
  ) {
    return ["ENTRY_BEFORE_ZONE_ENGAGEMENT"];
  }
  return [];
}

function realtimeFailure(
  proofPlane: ProofPlaneV3,
  replayability: EvidenceReplayability,
  isRealtime: boolean,
): readonly string[] {
  if (proofPlane === "REALTIME_TICK") {
    if (!isRealtime || replayability !== "LIVE_EXACT_NON_REPLAYABLE") {
      return ["REALTIME_EVIDENCE_NOT_LIVE"];
    }
  } else if (replayability !== "REPLAYABLE") {
    return ["EVIDENCE_REPLAYABILITY_MISMATCH"];
  }
  return [];
}

function contactsZone(
  request: EntryMatchRequestV3,
  candle: OrderedCandleV3,
): boolean {
  return (
    candle.low_ticks <= request.setup.zone_top_ticks &&
    candle.high_ticks >= request.setup.zone_bottom_ticks
  );
}

function recrossesHtfOpen(
  request: EntryMatchRequestV3,
  proof: EntryTriggerProofV3,
  candle: OrderedCandleV3,
): boolean {
  return request.setup.direction === "LONG"
    ? candle.high_ticks > proof.htf_open_ticks
    : candle.low_ticks < proof.htf_open_ticks;
}

function flipLifecycleFailure(
  request: EntryMatchRequestV3,
  proof: EntryTriggerProofV3,
): readonly string[] {
  if (proof.contact_candle === null || proof.recross_candle === null) {
    return ["HTF_FLIP_INCOMPLETE_LIFECYCLE"];
  }
  if (proof.coverage_gap_detected) return ["HTF_FLIP_COVERAGE_GAP"];
  if (!proof.full_lifecycle_ordered) return ["HTF_FLIP_ORDER_UNPROVEN"];
  if (proof.destination_seen_before_contact) {
    return ["HTF_FLIP_DESTINATION_BEFORE_CONTACT"];
  }
  if (proof.ambiguity_codes.length > 0) return ["HTF_FLIP_AMBIGUOUS"];
  if (proof.event_anchor_epoch > proof.contact_candle.open_epoch) {
    return ["HTF_FLIP_ANCHOR_AFTER_CONTACT"];
  }
  if (
    proof.htf_context_minutes.some(
      (context) =>
        proof.trigger_epoch >= proof.event_anchor_epoch + context * 60,
    )
  ) {
    return ["HTF_FLIP_TRIGGER_OUTSIDE_CONTEXT"];
  }
  if (!contactsZone(request, proof.contact_candle)) {
    return ["HTF_FLIP_CONTACT_OUTSIDE_ZONE"];
  }
  if (recrossesHtfOpen(request, proof, proof.contact_candle)) {
    return ["HTF_FLIP_CONTACT_ALREADY_RECROSSED"];
  }
  if (!recrossesHtfOpen(request, proof, proof.recross_candle)) {
    return ["HTF_FLIP_OPEN_NOT_RECROSSED"];
  }
  if (
    proof.htf_context_minutes.length === 0 ||
    proof.htf_context_minutes.some(
      (context) => proof.event_anchor_epoch % (context * 60) !== 0,
    )
  ) {
    return ["HTF_FLIP_CONTEXT_MISALIGNED"];
  }
  return [];
}

async function candidate(
  request: EntryMatchRequestV3,
  model: EntryModelV3,
  state: CandidateStateV3,
  eventAnchorEpoch: number,
  bocTier: BocTier | null,
  referenceCandleOpenEpoch: number | null,
  sourceClaimIds: readonly string[],
): Promise<EntryCandidateV3> {
  const identity = {
    setup_id: request.setup.setup_id,
    model,
    direction: request.setup.direction,
    event_anchor_epoch: eventAnchorEpoch,
    trigger_ordinal: 1,
    boc_tier: bocTier,
    reference_candle_open_epoch: referenceCandleOpenEpoch,
  } as const;
  return {
    candidate_id: await candidateIdV3(identity),
    ...identity,
    state,
    source_claim_ids: sourceClaimIds,
    observed_at_epoch: request.observed_at_epoch,
  };
}

async function evidence(
  request: EntryMatchRequestV3,
  value: EntryCandidateV3,
  fields: EvidenceFieldsV3,
): Promise<EntryCandidateEvidenceV3> {
  const reference = fields.reference_candle;
  const payload = {
    candidate_id: value.candidate_id,
    observed_trigger_epoch: fields.observed_trigger_epoch,
    trigger_sequence: fields.trigger_sequence,
    observed_trigger_ticks: fields.observed_trigger_ticks,
    htf_context_minutes: fields.htf_context_minutes,
    fidelity: fields.fidelity,
    proof_plane: fields.proof_plane,
    replayability: fields.replayability,
    coverage_start_epoch: fields.coverage_start_epoch,
    coverage_end_epoch: fields.coverage_end_epoch,
    ambiguity_codes: fields.ambiguity_codes,
    boc_tier: fields.boc_tier,
    reference_candle_open_epoch: reference?.open_epoch ?? null,
    reference_candle_open_ticks: reference?.open_ticks ?? null,
    reference_candle_high_ticks: reference?.high_ticks ?? null,
    reference_candle_low_ticks: reference?.low_ticks ?? null,
    reference_candle_close_ticks: reference?.close_ticks ?? null,
    htf_open_ticks: fields.htf_open_ticks,
    contact_candle: fields.contact_candle,
    recross_candle: fields.recross_candle,
    coverage_gap_detected: fields.coverage_gap_detected,
    full_lifecycle_ordered: fields.full_lifecycle_ordered,
    destination_seen_before_contact: fields.destination_seen_before_contact,
    passed_rule_ids: fields.passed_rule_ids,
    failed_rule_ids: fields.failed_rule_ids,
    source_claim_ids: fields.source_claim_ids,
  } as const;
  const payloadSha256 = await evidencePayloadSha256V3(payload);
  return {
    evidence_id: await evidenceIdV3({
      candidate_id: value.candidate_id,
      coverage_start_epoch: fields.coverage_start_epoch,
      coverage_end_epoch: fields.coverage_end_epoch,
      observed_trigger_epoch: fields.observed_trigger_epoch,
      trigger_sequence: fields.trigger_sequence,
      payload_sha256: payloadSha256,
      proof_plane: fields.proof_plane,
    }),
    ...payload,
    payload_sha256: payloadSha256,
    observed_at_epoch: request.observed_at_epoch,
  };
}

async function matchBoc(
  request: EntryMatchRequestV3,
  proof: BocProofV3,
): Promise<readonly [EntryCandidateV3, EntryCandidateEvidenceV3]> {
  const strict = strictBocContext(proof);
  const bocTier = strict ? "HTF_TIMED" : "DISCRETIONARY_5M";
  const ruleId = strict
    ? "ENTRY_BOC_HTF_TIMED"
    : "ENTRY_BOC_DISCRETIONARY_5M";
  const sourceClaimIds = strict
    ? SOURCE_CLAIMS_V3.BOC_HTF_TIMED
    : SOURCE_CLAIMS_V3.BOC_DISCRETIONARY_5M;
  const common = commonFailure(request, proof.trigger_epoch);
  const realtime = realtimeFailure(
    proof.proof_plane,
    proof.replayability,
    proof.is_realtime,
  );
  let state: CandidateStateV3;
  let fidelity = proof.fidelity;
  let passedRuleIds: readonly string[] = [];
  let failedRuleIds: readonly string[];
  if (common.length > 0) {
    state = "BLOCKED";
    failedRuleIds = common;
  } else if (!bocBreaksReference(request, proof)) {
    state = "REJECTED";
    failedRuleIds = ["BOC_WRONG_DIRECTION"];
  } else if (realtime.length > 0) {
    state = "BLOCKED";
    failedRuleIds = realtime;
  } else if (proof.fidelity !== "EXACT") {
    state = "BLOCKED";
    failedRuleIds = ["MODEL_EVIDENCE_NOT_EXACT"];
  } else if (!strict) {
    state = "MATCHED";
    fidelity = "DISCRETIONARY";
    failedRuleIds = ["BOC_DISCRETIONARY_CONTEXT_UNQUANTIFIED"];
  } else {
    state = "MATCHED";
    passedRuleIds = [ruleId];
    failedRuleIds = [];
  }
  if (failedRuleIds.length > 0 && fidelity === "EXACT") {
    fidelity = "UNRESOLVED";
  }
  const matchedCandidate = await candidate(
    request,
    "BOC",
    state,
    proof.reference_candle.open_epoch,
    bocTier,
    proof.reference_candle.open_epoch,
    sourceClaimIds,
  );
  return [
    matchedCandidate,
    await evidence(request, matchedCandidate, {
      observed_trigger_epoch: proof.trigger_epoch,
      trigger_sequence: proof.trigger_sequence,
      observed_trigger_ticks: proof.trigger_ticks,
      htf_context_minutes: proof.htf_context_minutes,
      fidelity,
      proof_plane: proof.proof_plane,
      replayability: proof.replayability,
      coverage_start_epoch: proof.coverage_start_epoch,
      coverage_end_epoch: proof.coverage_end_epoch,
      boc_tier: bocTier,
      reference_candle: proof.reference_candle,
      ambiguity_codes: [],
      htf_open_ticks: null,
      contact_candle: null,
      recross_candle: null,
      coverage_gap_detected: null,
      full_lifecycle_ordered: null,
      destination_seen_before_contact: null,
      passed_rule_ids: passedRuleIds,
      failed_rule_ids: failedRuleIds,
      source_claim_ids: sourceClaimIds,
    }),
  ];
}

async function matchClose(
  request: EntryMatchRequestV3,
  bar: OrderedCandleV3,
): Promise<readonly [EntryCandidateV3, EntryCandidateEvidenceV3]> {
  const common = commonFailure(request, bar.close_epoch);
  let state: CandidateStateV3;
  let passedRuleIds: readonly string[];
  let failedRuleIds: readonly string[];
  if (common.length > 0) {
    state = "BLOCKED";
    passedRuleIds = [];
    failedRuleIds = common;
  } else if (bar.close_epoch - bar.open_epoch !== 300) {
    state = "BLOCKED";
    passedRuleIds = [];
    failedRuleIds = ["DIR_CLOSE_NOT_CONFIRMED_5M"];
  } else {
    state = "MATCHED";
    passedRuleIds = ["ENTRY_DIR_CLOSE"];
    failedRuleIds = [];
  }
  const matchedCandidate = await candidate(
    request,
    "DIR_CLOSE",
    state,
    bar.open_epoch,
    null,
    null,
    SOURCE_CLAIMS_V3.DIR_CLOSE,
  );
  return [
    matchedCandidate,
    await evidence(request, matchedCandidate, {
      observed_trigger_epoch: bar.close_epoch,
      trigger_sequence: request.close_trigger_sequence,
      observed_trigger_ticks: bar.close_ticks,
      htf_context_minutes: [],
      fidelity: state === "MATCHED" ? "EXACT" : "UNRESOLVED",
      proof_plane: "CONFIRMED_5M",
      replayability: "REPLAYABLE",
      coverage_start_epoch: bar.open_epoch,
      coverage_end_epoch: bar.close_epoch,
      boc_tier: null,
      reference_candle: null,
      ambiguity_codes: [],
      htf_open_ticks: null,
      contact_candle: null,
      recross_candle: null,
      coverage_gap_detected: null,
      full_lifecycle_ordered: null,
      destination_seen_before_contact: null,
      passed_rule_ids: passedRuleIds,
      failed_rule_ids: failedRuleIds,
      source_claim_ids: SOURCE_CLAIMS_V3.DIR_CLOSE,
    }),
  ];
}

async function matchFlip(
  request: EntryMatchRequestV3,
  proof: EntryTriggerProofV3,
): Promise<readonly [EntryCandidateV3, EntryCandidateEvidenceV3]> {
  const common = commonFailure(request, proof.trigger_epoch);
  const lifecycle = flipLifecycleFailure(request, proof);
  const realtime = realtimeFailure(
    proof.proof_plane,
    proof.replayability,
    proof.is_realtime,
  );
  let state: CandidateStateV3;
  let passedRuleIds: readonly string[];
  let failedRuleIds: readonly string[];
  if (common.length > 0) {
    state = "BLOCKED";
    passedRuleIds = [];
    failedRuleIds = common;
  } else if (lifecycle.length > 0) {
    state = "BLOCKED";
    passedRuleIds = [];
    failedRuleIds = lifecycle;
  } else if (realtime.length > 0) {
    state = "BLOCKED";
    passedRuleIds = [];
    failedRuleIds = realtime;
  } else if (proof.fidelity !== "EXACT") {
    state = "BLOCKED";
    passedRuleIds = [];
    failedRuleIds = ["MODEL_EVIDENCE_NOT_EXACT"];
  } else {
    state = "MATCHED";
    passedRuleIds = ["ENTRY_HTF_FLIP"];
    failedRuleIds = [];
  }
  const matchedCandidate = await candidate(
    request,
    "HTF_FLIP",
    state,
    proof.event_anchor_epoch,
    null,
    null,
    SOURCE_CLAIMS_V3.HTF_FLIP,
  );
  return [
    matchedCandidate,
    await evidence(request, matchedCandidate, {
      observed_trigger_epoch: proof.trigger_epoch,
      trigger_sequence: proof.trigger_sequence,
      observed_trigger_ticks: proof.trigger_ticks,
      htf_context_minutes: proof.htf_context_minutes,
      fidelity: state === "MATCHED" ? "EXACT" : "UNRESOLVED",
      proof_plane: proof.proof_plane,
      replayability: proof.replayability,
      coverage_start_epoch: proof.coverage_start_epoch,
      coverage_end_epoch: proof.coverage_end_epoch,
      boc_tier: null,
      reference_candle: null,
      ambiguity_codes: proof.ambiguity_codes,
      htf_open_ticks: proof.htf_open_ticks,
      contact_candle: proof.contact_candle,
      recross_candle: proof.recross_candle,
      coverage_gap_detected: proof.coverage_gap_detected,
      full_lifecycle_ordered: proof.full_lifecycle_ordered,
      destination_seen_before_contact: proof.destination_seen_before_contact,
      passed_rule_ids: passedRuleIds,
      failed_rule_ids: failedRuleIds,
      source_claim_ids: SOURCE_CLAIMS_V3.HTF_FLIP,
    }),
  ];
}

export async function matchEntryCandidatesV3(
  request: EntryMatchRequestV3,
): Promise<EntryMatchResultV3> {
  const matched: Array<
    readonly [EntryCandidateV3, EntryCandidateEvidenceV3]
  > = [];
  if (request.boc_proof !== null) {
    matched.push(await matchBoc(request, request.boc_proof));
  }
  if (request.directional_close) {
    if (request.confirmed_bar === null) {
      throw new TypeError("directional_close requires confirmed_bar");
    }
    matched.push(await matchClose(request, request.confirmed_bar));
  }
  if (request.htf_flip_proof !== null) {
    matched.push(await matchFlip(request, request.htf_flip_proof));
  }
  return {
    candidates: matched.map(([item]) => item).sort((a, b) =>
      a.candidate_id.localeCompare(b.candidate_id),
    ),
    evidence: matched.map(([, item]) => item).sort((a, b) =>
      a.evidence_id.localeCompare(b.evidence_id),
    ),
  };
}
