import {
  POLICY_VERSION_V3,
  selectionIdV3,
  validateEntryArbitrationInputV3,
  validateEntryEvaluationV3,
  type EntryArbitrationInputV3,
  type EntryCandidateEvidenceV3,
  type EntryCandidateV3,
  type EntryEvaluationV3,
  type EntryModelV3,
  type EntrySelectionV3,
  type SelectionActionV3,
  type SelectionReasonV3,
} from "./rd-entry-domain-v3";
import { matchEntryCandidatesV3 } from "./rd-entry-matcher-v3";

interface EligiblePair {
  readonly candidate: EntryCandidateV3;
  readonly evidence: EntryCandidateEvidenceV3;
}

const EXPECTED_RULES: Readonly<Record<EntryModelV3, string>> = {
  BOC: "ENTRY_BOC_HTF_TIMED",
  DIR_CLOSE: "ENTRY_DIR_CLOSE",
  HTF_FLIP: "ENTRY_HTF_FLIP",
};

function eventKey(evidence: EntryCandidateEvidenceV3): readonly [number, number] {
  if (evidence.observed_trigger_epoch === null) {
    throw new TypeError("eligible evidence requires trigger epoch");
  }
  return [evidence.observed_trigger_epoch, evidence.trigger_sequence];
}

function compareEvent(
  left: EntryCandidateEvidenceV3,
  right: EntryCandidateEvidenceV3,
): number {
  const a = eventKey(left);
  const b = eventKey(right);
  return a[0] - b[0] || a[1] - b[1];
}

export function exactEligibleV3(
  candidate: EntryCandidateV3,
  evidence: EntryCandidateEvidenceV3,
): boolean {
  if (
    candidate.state !== "MATCHED" ||
    evidence.fidelity !== "EXACT" ||
    evidence.observed_trigger_epoch === null ||
    evidence.ambiguity_codes.length !== 0 ||
    evidence.passed_rule_ids.length !== 1 ||
    evidence.passed_rule_ids[0] !== EXPECTED_RULES[candidate.model] ||
    evidence.failed_rule_ids.length !== 0 ||
    evidence.boc_tier !== candidate.boc_tier ||
    evidence.reference_candle_open_epoch !==
      candidate.reference_candle_open_epoch
  ) {
    return false;
  }
  if (candidate.model === "BOC") {
    if (
      candidate.boc_tier !== "HTF_TIMED" ||
      evidence.reference_candle_open_epoch === null
    ) {
      return false;
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
      return false;
    }
  } else if (candidate.model === "DIR_CLOSE") {
    if (
      evidence.coverage_end_epoch - evidence.coverage_start_epoch !== 300 ||
      evidence.observed_trigger_epoch !== evidence.coverage_end_epoch
    ) {
      return false;
    }
  } else {
    if (
      evidence.htf_open_ticks === null ||
      evidence.contact_candle === null ||
      evidence.recross_candle === null ||
      evidence.coverage_gap_detected !== false ||
      evidence.full_lifecycle_ordered !== true ||
      evidence.destination_seen_before_contact !== false
    ) {
      return false;
    }
    const recrossed =
      candidate.direction === "LONG"
        ? evidence.recross_candle.high_ticks > evidence.htf_open_ticks
        : evidence.recross_candle.low_ticks < evidence.htf_open_ticks;
    const contactAlreadyRecrossed =
      candidate.direction === "LONG"
        ? evidence.contact_candle.high_ticks > evidence.htf_open_ticks
        : evidence.contact_candle.low_ticks < evidence.htf_open_ticks;
    if (
      !recrossed ||
      contactAlreadyRecrossed ||
      candidate.event_anchor_epoch > evidence.contact_candle.open_epoch ||
      evidence.htf_context_minutes.length === 0 ||
      evidence.htf_context_minutes.some(
        (context) =>
          evidence.observed_trigger_epoch! >=
          candidate.event_anchor_epoch + context * 60,
      )
    ) {
      return false;
    }
  }
  if (
    candidate.model !== "HTF_FLIP" &&
    [
      evidence.htf_open_ticks,
      evidence.contact_candle,
      evidence.recross_candle,
      evidence.coverage_gap_detected,
      evidence.full_lifecycle_ordered,
      evidence.destination_seen_before_contact,
    ].some((value) => value !== null)
  ) {
    return false;
  }
  return (
    evidence.proof_plane === "LOWER_TIMEFRAME_REPLAY" ||
    evidence.proof_plane === "EXTERNAL_ARCHIVED_TICK" ||
    (evidence.proof_plane === "REALTIME_TICK" &&
      evidence.replayability === "LIVE_EXACT_NON_REPLAYABLE") ||
    (candidate.model === "DIR_CLOSE" &&
      evidence.proof_plane === "CONFIRMED_5M" &&
      evidence.replayability === "REPLAYABLE")
  );
}

async function selection(
  setupId: string,
  revision: number,
  evaluatedAtEpoch: number,
  candidateIdsConsidered: readonly string[],
  canonical: EligiblePair | null,
  reason: SelectionReasonV3,
  action: SelectionActionV3,
  coTriggeredModels: readonly EntryModelV3[] = [],
): Promise<EntrySelectionV3> {
  const identity = {
    setup_id: setupId,
    policy_version: POLICY_VERSION_V3,
    revision,
    candidate_ids_considered: candidateIdsConsidered,
    canonical_candidate_id: canonical?.candidate.candidate_id ?? null,
    canonical_evidence_id: canonical?.evidence.evidence_id ?? null,
    reason,
    fidelity: canonical?.evidence.fidelity ?? null,
    action,
    co_triggered_models: coTriggeredModels,
  } as const;
  return {
    selection_id: await selectionIdV3(identity),
    ...identity,
    canonical_model: canonical?.candidate.model ?? null,
    evaluated_at_epoch: evaluatedAtEpoch,
  };
}

export async function arbitrateEntryCandidatesV3(
  setupId: string,
  candidates: readonly EntryCandidateV3[],
  evidence: readonly EntryCandidateEvidenceV3[],
  setupInvalidated: boolean,
  revision: number,
  evaluatedAtEpoch: number,
  openedSelection: EntrySelectionV3 | null = null,
): Promise<EntrySelectionV3> {
  if (
    typeof setupId !== "string" ||
    setupId.length === 0 ||
    setupId.trim() !== setupId ||
    typeof setupInvalidated !== "boolean" ||
    !Number.isSafeInteger(revision) ||
    revision < 0 ||
    !Number.isSafeInteger(evaluatedAtEpoch) ||
    evaluatedAtEpoch < 0 ||
    candidates.some(
      (candidate) => candidate.observed_at_epoch > evaluatedAtEpoch,
    ) ||
    evidence.some((item) => item.observed_at_epoch > evaluatedAtEpoch)
  ) {
    throw new TypeError("invalid v3 arbitration request");
  }
  if (openedSelection !== null) {
    if (
      openedSelection.setup_id !== setupId ||
      openedSelection.action !== "PAPER_ELIGIBLE" ||
      openedSelection.evaluated_at_epoch > evaluatedAtEpoch
    ) {
      throw new TypeError("invalid opened v3 selection");
    }
    return openedSelection;
  }
  const candidatesById = new Map<string, EntryCandidateV3>();
  for (const candidate of candidates) {
    if (candidate.setup_id !== setupId) {
      throw new TypeError("candidate setup_id conflicts with arbitration");
    }
    const previous = candidatesById.get(candidate.candidate_id);
    if (previous !== undefined && JSON.stringify(previous) !== JSON.stringify(candidate)) {
      throw new TypeError("candidate identity conflict");
    }
    candidatesById.set(candidate.candidate_id, candidate);
  }
  const evidenceById = new Map<string, EntryCandidateEvidenceV3>();
  for (const item of evidence) {
    const previous = evidenceById.get(item.evidence_id);
    if (previous !== undefined && JSON.stringify(previous) !== JSON.stringify(item)) {
      throw new TypeError("evidence identity conflict");
    }
    evidenceById.set(item.evidence_id, item);
  }
  const grouped = new Map<string, EntryCandidateEvidenceV3[]>();
  for (const item of evidenceById.values()) {
    const candidate = candidatesById.get(item.candidate_id);
    if (candidate === undefined) {
      throw new TypeError("evidence references unknown candidate");
    }
    if (exactEligibleV3(candidate, item)) {
      const values = grouped.get(candidate.candidate_id) ?? [];
      values.push(item);
      grouped.set(candidate.candidate_id, values);
    }
  }
  const eligible: EligiblePair[] = [...grouped.entries()].map(
    ([candidateId, values]) => ({
      candidate: candidatesById.get(candidateId)!,
      evidence: [...values].sort(
        (left, right) =>
          compareEvent(left, right) ||
          left.evidence_id.localeCompare(right.evidence_id),
      )[0]!,
    }),
  );
  eligible.sort(
    (left, right) =>
      compareEvent(left.evidence, right.evidence) ||
      left.candidate.candidate_id.localeCompare(right.candidate.candidate_id),
  );
  const candidateIds = [...candidatesById.keys()].sort();
  if (setupInvalidated) {
    return selection(
      setupId,
      revision,
      evaluatedAtEpoch,
      candidateIds,
      null,
      "SETUP_INVALIDATED",
      "NONE",
    );
  }
  if (candidatesById.size === 0) {
    return selection(
      setupId,
      revision,
      evaluatedAtEpoch,
      candidateIds,
      null,
      "NO_CANDIDATE",
      "NONE",
    );
  }
  if (eligible.length === 0) {
    return selection(
      setupId,
      revision,
      evaluatedAtEpoch,
      candidateIds,
      null,
      "NO_EXACT_CANDIDATE",
      "SHADOW_ONLY",
    );
  }
  const firstEvent = eventKey(eligible[0]!.evidence);
  const earliest = eligible.filter((pair) => {
    const key = eventKey(pair.evidence);
    return key[0] === firstEvent[0] && key[1] === firstEvent[1];
  });
  const models = [...new Set(earliest.map((pair) => pair.candidate.model))];
  if (models.length > 1) {
    if (
      new Set(earliest.map((pair) => pair.evidence.observed_trigger_ticks))
        .size > 1
    ) {
      return selection(
        setupId,
        revision,
        evaluatedAtEpoch,
        candidateIds,
        null,
        "CO_TRIGGER_PRICE_CONFLICT",
        "SHADOW_ONLY",
      );
    }
    const canonical = [...earliest].sort((left, right) =>
      left.candidate.candidate_id.localeCompare(
        right.candidate.candidate_id,
      ),
    )[0]!;
    return selection(
      setupId,
      revision,
      evaluatedAtEpoch,
      candidateIds,
      canonical,
      "CO_TRIGGER_SAME_EVENT",
      "PAPER_ELIGIBLE",
      models.sort(),
    );
  }
  const canonical = earliest[0]!;
  const eligibleIds = new Set(eligible.map((pair) => pair.candidate.candidate_id));
  const hasBlockedAggressive = [...candidatesById.values()].some(
    (candidate) =>
      (candidate.model === "BOC" || candidate.model === "HTF_FLIP") &&
      !eligibleIds.has(candidate.candidate_id),
  );
  const reason: SelectionReasonV3 =
    canonical.candidate.model === "DIR_CLOSE" && hasBlockedAggressive
      ? "FALLBACK_TO_CONFIRMED_CLOSE"
      : candidatesById.size === 1
        ? "ONLY_EXACT_TRIGGER"
        : "EARLIEST_EXACT_TRIGGER";
  return selection(
    setupId,
    revision,
    evaluatedAtEpoch,
    candidateIds,
    canonical,
    reason,
    "PAPER_ELIGIBLE",
  );
}

async function evaluateWithoutOpenedSeed(
  input: EntryArbitrationInputV3,
): Promise<EntryEvaluationV3> {
  const matched = await matchEntryCandidatesV3({
    setup: {
      setup_id: input.setup_id,
      direction: input.direction,
      zone_top_ticks: input.zone_top_ticks,
      zone_bottom_ticks: input.zone_bottom_ticks,
      zone_engaged_epoch: input.zone_engaged_epoch,
      invalidated_before_entry: input.setup_invalidated,
      common_fidelity: input.common_fidelity,
    },
    boc_proof: input.boc_proof,
    directional_close: input.directional_close,
    confirmed_bar: input.confirmed_bar,
    close_trigger_sequence: input.close_trigger_sequence,
    htf_flip_proof: input.htf_flip_proof,
    observed_at_epoch: input.observed_at_epoch,
  });
  const result = {
    ...matched,
    selection: await arbitrateEntryCandidatesV3(
      input.setup_id,
      matched.candidates,
      matched.evidence,
      input.setup_invalidated,
      input.revision,
      input.evaluated_at_epoch,
    ),
  };
  validateEntryEvaluationV3(result);
  return result;
}

export async function evaluateEntryV3Bundle(
  input: EntryArbitrationInputV3,
): Promise<EntryEvaluationV3> {
  validateEntryArbitrationInputV3(input);
  if (input.opened_selection_seed === null) {
    return evaluateWithoutOpenedSeed(input);
  }
  const seed = input.opened_selection_seed;
  const opened = await evaluateWithoutOpenedSeed({
    ...input,
    common_fidelity: "EXACT",
    setup_invalidated: false,
    boc_proof: null,
    directional_close: true,
    confirmed_bar: seed.confirmed_bar,
    close_trigger_sequence: seed.trigger_sequence,
    htf_flip_proof: null,
    observed_at_epoch: seed.evaluated_at_epoch,
    revision: seed.revision,
    evaluated_at_epoch: seed.evaluated_at_epoch,
    opened_selection_seed: null,
  });
  return opened;
}
