import {
  canonicalStringifyRdEntry,
  type EntryCandidate,
  type EntryCandidateEvidence,
  type EntryEvaluation,
  type EntryHandlingObservation,
  type EntryMatchRequest,
  type EntryModelV2,
  type EntrySelection,
  type HTFFlipProofTranscript,
  type SetupAttemptTerminalReason,
  type SetupEntryFacts,
} from "./rd-entry-domain";
import {
  buildEntryHandlingObservation,
  evaluateEntryMatch,
  isExpandedHtfFlipProof,
  validateEntryRequestShape,
  validateHtfFlipProof,
  type EdgeEntryMatchRequest,
} from "./rd-entry-matcher";
import {
  canonicalSha256,
  ENTRY_POLICY_VERSION,
  SOURCE_CLAIMS,
} from "./rd-entry-policy";

export interface EntryArbitrationRequest {
  readonly setup_id: string;
  readonly setup_invalidated: boolean;
  readonly revision: number;
  readonly candidates: EntryEvaluation["candidates"];
  readonly evidence: EntryEvaluation["evidence"];
  readonly evaluated_at_epoch: number;
}

export interface EntryStreamEvent {
  readonly event_id: string;
  readonly match_request: EdgeEntryMatchRequest | EntryMatchRequest;
}

type Decision = {
  readonly candidate: EntryCandidate | null;
  readonly evidence: EntryCandidateEvidence | null;
  readonly action: EntrySelection["action"];
  readonly reason: EntrySelection["reason"];
};

type TerminalFact = {
  readonly reason: SetupAttemptTerminalReason;
  readonly epoch: number;
};

const ACTIVE_MODELS = new Set<EntryModelV2>(["DIR_CLOSE", "HTF_FLIP"]);
const EXACT_PROOF_PLANES = new Set<EntryCandidateEvidence["proof_plane"]>([
  "CONFIRMED_5M",
  "LOWER_TIMEFRAME_REPLAY",
  "EXTERNAL_ARCHIVED_TICK",
]);
const ENTRY_MODELS = new Set<EntryModelV2>([
  "DIR_CLOSE",
  "HTF_FLIP",
  "LEGACY_BREAK_CANDLE",
  "LEGACY_REJECTION_RESPECT",
]);
const CANDIDATE_STATES = new Set<EntryCandidate["state"]>([
  "MATCHED",
  "BLOCKED",
  "REJECTED",
  "NORMALIZED",
]);
const FIDELITIES = new Set<EntryCandidateEvidence["fidelity"]>([
  "EXACT",
  "CALIBRATED",
  "DISCRETIONARY",
  "UNRESOLVED",
]);
const PROOF_PLANES = new Set<EntryCandidateEvidence["proof_plane"]>([
  "CONFIRMED_5M",
  "LOWER_TIMEFRAME_REPLAY",
  "REALTIME_TICK",
  "EXTERNAL_ARCHIVED_TICK",
]);
const AMBIGUITY_CODES = new Set<
  EntryCandidateEvidence["ambiguity_codes"][number]
>([
  "SHADOW_SAME_CHILD_BAR_ORDER",
  "SHADOW_MISSING_INTRABAR_COVERAGE",
  "SHADOW_REALTIME_ONLY_NOT_REPLAYABLE",
]);
const SHA256 = /^[0-9a-f]{64}$/u;

function fail(message: string): never {
  throw new TypeError(message);
}

function requireNonNegativeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail(`${name} must be a non-negative safe integer`);
  }
}

function requireClosedText(value: string, name: string): void {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.trim() !== value
  ) {
    fail(`${name} must be a non-empty closed string`);
  }
}

function sameCandidate(left: EntryCandidate, right: EntryCandidate): boolean {
  return (
    canonicalStringifyRdEntry(left) ===
    canonicalStringifyRdEntry(right)
  );
}

function sameEvidence(
  left: EntryCandidateEvidence,
  right: EntryCandidateEvidence,
): boolean {
  return (
    canonicalStringifyRdEntry(left) ===
    canonicalStringifyRdEntry(right)
  );
}

function sameHandling(
  left: EntryHandlingObservation,
  right: EntryHandlingObservation,
): boolean {
  return (
    canonicalStringifyRdEntry(left) ===
    canonicalStringifyRdEntry(right)
  );
}

function sameEvent(left: EntryStreamEvent, right: EntryStreamEvent): boolean {
  return (
    canonicalStringifyRdEntry(left) ===
    canonicalStringifyRdEntry(right)
  );
}

function mergeImmutable<T>(
  target: Map<string, T>,
  items: readonly T[],
  id: (item: T) => string,
  equal: (left: T, right: T) => boolean,
  conflictName: string,
): void {
  for (const item of items) {
    const key = id(item);
    const previous = target.get(key);
    if (previous !== undefined && !equal(previous, item)) {
      fail(`${conflictName} identity conflict: ${key}`);
    }
    target.set(key, item);
  }
}

function requireSha256(value: string, name: string): void {
  if (
    typeof value !== "string" ||
    !SHA256.test(value) ||
    value === "0".repeat(64)
  ) {
    fail(`${name} must be a nonzero lowercase SHA-256`);
  }
}

function requireUniqueTexts(
  values: readonly string[],
  name: string,
): void {
  if (
    !Array.isArray(values) ||
    values.some(
      (value) =>
        typeof value !== "string" ||
        value.length === 0 ||
        value.trim() !== value,
    ) ||
    new Set(values).size !== values.length
  ) {
    fail(`${name} must contain unique non-empty closed strings`);
  }
}

function validateCandidateDomain(candidate: EntryCandidate): void {
  requireSha256(candidate.candidate_id, "candidate_id");
  requireClosedText(candidate.setup_id, "candidate.setup_id");
  if (!ENTRY_MODELS.has(candidate.model)) {
    fail("candidate model is outside the closed candidate domain");
  }
  if (!CANDIDATE_STATES.has(candidate.state)) {
    fail("candidate state is outside the closed candidate domain");
  }
  if (candidate.direction !== "LONG" && candidate.direction !== "SHORT") {
    fail("candidate direction is outside the closed candidate domain");
  }
  requireNonNegativeInteger(
    candidate.event_anchor_epoch,
    "candidate.event_anchor_epoch",
  );
  requireNonNegativeInteger(
    candidate.trigger_ordinal,
    "candidate.trigger_ordinal",
  );
  if (candidate.trigger_ordinal === 0) {
    fail("candidate.trigger_ordinal must be positive");
  }
  requireUniqueTexts(
    candidate.source_claim_ids,
    "candidate.source_claim_ids",
  );
  if (
    candidate.normalized_from !== null &&
    !ENTRY_MODELS.has(candidate.normalized_from)
  ) {
    fail("candidate normalized_from is outside the closed candidate domain");
  }
  requireNonNegativeInteger(
    candidate.observed_at_epoch,
    "candidate.observed_at_epoch",
  );
}

function validateEvidenceDomain(evidence: EntryCandidateEvidence): void {
  requireSha256(evidence.evidence_id, "evidence_id");
  requireSha256(evidence.candidate_id, "evidence.candidate_id");
  requireSha256(evidence.payload_sha256, "evidence.payload_sha256");
  if (!FIDELITIES.has(evidence.fidelity)) {
    fail("evidence fidelity is outside the closed evidence domain");
  }
  if (!PROOF_PLANES.has(evidence.proof_plane)) {
    fail("evidence proof plane is outside the closed evidence domain");
  }
  if (
    !Array.isArray(evidence.htf_context_minutes) ||
    evidence.htf_context_minutes.some(
      (value) => !Number.isSafeInteger(value) || value <= 0,
    ) ||
    evidence.htf_context_minutes.some(
      (value, index) =>
        index > 0 && value <= evidence.htf_context_minutes[index - 1]!,
    )
  ) {
    fail("evidence HTF contexts must be sorted unique positive integers");
  }
  if (
    !Array.isArray(evidence.ambiguity_codes) ||
    evidence.ambiguity_codes.some((code) => !AMBIGUITY_CODES.has(code)) ||
    new Set(evidence.ambiguity_codes).size !==
      evidence.ambiguity_codes.length
  ) {
    fail("evidence ambiguity codes are outside the closed evidence domain");
  }
  requireUniqueTexts(evidence.passed_rule_ids, "evidence.passed_rule_ids");
  requireUniqueTexts(evidence.failed_rule_ids, "evidence.failed_rule_ids");
  requireUniqueTexts(
    evidence.source_claim_ids,
    "evidence.source_claim_ids",
  );
  requireNonNegativeInteger(
    evidence.observed_at_epoch,
    "evidence.observed_at_epoch",
  );
  if (evidence.observed_trigger_epoch !== null) {
    requireNonNegativeInteger(
      evidence.observed_trigger_epoch,
      "evidence.observed_trigger_epoch",
    );
    if (!Number.isSafeInteger(evidence.observed_trigger_ticks)) {
      fail("evidence.observed_trigger_ticks must be an integer");
    }
  }
}

async function validateCandidateIdentity(
  candidate: EntryCandidate,
  setupId: string,
): Promise<void> {
  validateCandidateDomain(candidate);
  if (candidate.setup_id !== setupId) {
    fail("candidate setup_id must match arbitration setup_id");
  }
  const authoritative = await canonicalSha256({
    direction: candidate.direction,
    event_anchor_epoch: candidate.event_anchor_epoch,
    model: candidate.model,
    setup_id: candidate.setup_id,
    trigger_ordinal: candidate.trigger_ordinal,
  });
  if (candidate.candidate_id !== authoritative) {
    fail("candidate identity conflicts with its canonical fields");
  }
}

async function validateEvidenceIdentity(
  evidence: EntryCandidateEvidence,
): Promise<void> {
  validateEvidenceDomain(evidence);
  if (
    (evidence.observed_trigger_epoch === null) !==
    (evidence.observed_trigger_ticks === null)
  ) {
    fail("evidence trigger epoch and ticks must both be present or absent");
  }
  requireNonNegativeInteger(
    evidence.proof_resolution_seconds,
    "proof_resolution_seconds",
  );
  if (evidence.proof_resolution_seconds === 0) {
    fail("proof_resolution_seconds must be positive");
  }
  requireNonNegativeInteger(
    evidence.coverage_start_epoch,
    "coverage_start_epoch",
  );
  requireNonNegativeInteger(
    evidence.coverage_end_epoch,
    "coverage_end_epoch",
  );
  if (evidence.coverage_end_epoch <= evidence.coverage_start_epoch) {
    fail("evidence coverage must increase");
  }
  if (
    evidence.observed_trigger_epoch !== null &&
    (evidence.observed_trigger_epoch < evidence.coverage_start_epoch ||
      evidence.observed_trigger_epoch > evidence.coverage_end_epoch)
  ) {
    fail("evidence trigger lies outside coverage");
  }
  const payload = await canonicalSha256({
    ambiguity_codes: evidence.ambiguity_codes,
    candidate_id: evidence.candidate_id,
    coverage_end_epoch: evidence.coverage_end_epoch,
    coverage_start_epoch: evidence.coverage_start_epoch,
    failed_rule_ids: evidence.failed_rule_ids,
    fidelity: evidence.fidelity,
    htf_context_minutes: evidence.htf_context_minutes,
    observed_trigger_epoch: evidence.observed_trigger_epoch,
    observed_trigger_ticks: evidence.observed_trigger_ticks,
    passed_rule_ids: evidence.passed_rule_ids,
    proof_plane: evidence.proof_plane,
    proof_resolution_seconds: evidence.proof_resolution_seconds,
    source_claim_ids: evidence.source_claim_ids,
  });
  if (evidence.payload_sha256 !== payload) {
    fail("evidence payload identity conflicts with its canonical fields");
  }
  const identity = await canonicalSha256({
    candidate_id: evidence.candidate_id,
    coverage_end_epoch: evidence.coverage_end_epoch,
    coverage_start_epoch: evidence.coverage_start_epoch,
    observed_trigger_epoch: evidence.observed_trigger_epoch,
    payload_sha256: payload,
    proof_plane: evidence.proof_plane,
    proof_resolution_seconds: evidence.proof_resolution_seconds,
  });
  if (evidence.evidence_id !== identity) {
    fail("evidence identity conflicts with its canonical fields");
  }
}

function exactEvidenceRank(
  left: EntryCandidateEvidence,
  right: EntryCandidateEvidence,
): number {
  if (
    left.observed_trigger_epoch === null ||
    right.observed_trigger_epoch === null
  ) {
    fail("exact canonical evidence lacks a trigger");
  }
  return (
    left.observed_trigger_epoch - right.observed_trigger_epoch ||
    left.proof_resolution_seconds - right.proof_resolution_seconds ||
    right.htf_context_minutes.length - left.htf_context_minutes.length ||
    left.coverage_end_epoch - right.coverage_end_epoch ||
    left.evidence_id.localeCompare(right.evidence_id)
  );
}

function isExactEligible(evidence: EntryCandidateEvidence): boolean {
  return (
    evidence.fidelity === "EXACT" &&
    EXACT_PROOF_PLANES.has(evidence.proof_plane) &&
    evidence.observed_trigger_epoch !== null &&
    evidence.ambiguity_codes.length === 0
  );
}

function selectCanonicalDecision(
  invalidated: boolean,
  active: readonly EntryCandidate[],
  exact: readonly EntryCandidate[],
  evidenceByCandidate: ReadonlyMap<string, EntryCandidateEvidence>,
  nonExactTriggerByCandidate: ReadonlyMap<string, number>,
): Decision {
  const none = (
    action: "NONE" | "SHADOW_ONLY",
    reason: EntrySelection["reason"],
  ): Decision => ({ candidate: null, evidence: null, action, reason });
  if (invalidated) return none("NONE", "SETUP_INVALIDATED");
  if (active.length === 0) return none("NONE", "NO_CANDIDATE");
  if (exact.length === 0) {
    return none("SHADOW_ONLY", "NO_EXACT_CANDIDATE");
  }

  const exactClose = exact.find((item) => item.model === "DIR_CLOSE");
  const exactCloseEvidence =
    exactClose === undefined
      ? undefined
      : evidenceByCandidate.get(exactClose.candidate_id);
  const hasEarlierNonExactFlip =
    exactCloseEvidence !== undefined &&
    exactCloseEvidence.observed_trigger_epoch !== null &&
    active.some((item) => {
      const trigger = nonExactTriggerByCandidate.get(item.candidate_id);
      return (
        item.model === "HTF_FLIP" &&
        !evidenceByCandidate.has(item.candidate_id) &&
        trigger !== undefined &&
        trigger < exactCloseEvidence.observed_trigger_epoch!
      );
    });
  if (exactClose !== undefined && hasEarlierNonExactFlip) {
    return {
      candidate: exactClose,
      evidence: exactCloseEvidence!,
      action: "PAPER_ELIGIBLE",
      reason: "FALLBACK_TO_CONFIRMED_CLOSE",
    };
  }
  if (exact.length === 1) {
    const candidate = exact[0]!;
    return {
      candidate,
      evidence: evidenceByCandidate.get(candidate.candidate_id)!,
      action: "PAPER_ELIGIBLE",
      reason: "ONLY_EXACT_TRIGGER",
    };
  }

  const first = exact[0]!;
  const firstEvidence = evidenceByCandidate.get(first.candidate_id)!;
  const firstTrigger = firstEvidence.observed_trigger_epoch;
  const earliestModels = new Set(
    exact
      .filter(
        (candidate) =>
          evidenceByCandidate.get(candidate.candidate_id)
            ?.observed_trigger_epoch === firstTrigger,
      )
      .map((candidate) => candidate.model),
  );
  if (earliestModels.size > 1) {
    return none("SHADOW_ONLY", "UNRESOLVED_SOURCE_PRIORITY");
  }
  return {
    candidate: first,
    evidence: firstEvidence,
    action: "PAPER_ELIGIBLE",
    reason: "EARLIEST_EXACT_TRIGGER",
  };
}

export async function arbitrateEntryCandidates(
  request: EntryArbitrationRequest,
): Promise<EntrySelection> {
  requireClosedText(request.setup_id, "setup_id");
  if (typeof request.setup_invalidated !== "boolean") {
    fail("setup_invalidated must be a boolean");
  }
  requireNonNegativeInteger(request.revision, "revision");
  requireNonNegativeInteger(
    request.evaluated_at_epoch,
    "evaluated_at_epoch",
  );

  const candidates = new Map<string, EntryCandidate>();
  mergeImmutable(
    candidates,
    request.candidates,
    (item) => item.candidate_id,
    sameCandidate,
    "candidate",
  );
  await Promise.all(
    [...candidates.values()].map((candidate) =>
      validateCandidateIdentity(candidate, request.setup_id)
    ),
  );
  const evidence = new Map<string, EntryCandidateEvidence>();
  mergeImmutable(
    evidence,
    request.evidence,
    (item) => item.evidence_id,
    sameEvidence,
    "evidence",
  );
  await Promise.all(
    [...evidence.values()].map(validateEvidenceIdentity),
  );
  for (const item of evidence.values()) {
    if (!candidates.has(item.candidate_id)) {
      fail(`evidence references unknown candidate: ${item.candidate_id}`);
    }
  }

  const active = [...candidates.values()].filter(
    (item) =>
      ACTIVE_MODELS.has(item.model) && item.state !== "REJECTED",
  );
  const exactEvidenceByCandidate = new Map<
    string,
    EntryCandidateEvidence
  >();
  const nonExactTriggerByCandidate = new Map<string, number>();
  for (const item of evidence.values()) {
    if (!active.some(
      (candidate) => candidate.candidate_id === item.candidate_id,
    )) {
      continue;
    }
    if (isExactEligible(item)) {
      const previous = exactEvidenceByCandidate.get(item.candidate_id);
      if (
        previous === undefined ||
        exactEvidenceRank(item, previous) < 0
      ) {
        exactEvidenceByCandidate.set(item.candidate_id, item);
      }
    } else if (
      item.proof_plane !== "REALTIME_TICK" &&
      item.observed_trigger_epoch !== null
    ) {
      const previous = nonExactTriggerByCandidate.get(item.candidate_id);
      if (
        previous === undefined ||
        item.observed_trigger_epoch < previous
      ) {
        nonExactTriggerByCandidate.set(
          item.candidate_id,
          item.observed_trigger_epoch,
        );
      }
    }
  }
  const exact = active
    .filter((item) => exactEvidenceByCandidate.has(item.candidate_id))
    .sort((left, right) => {
      const leftEvidence = exactEvidenceByCandidate.get(left.candidate_id)!;
      const rightEvidence = exactEvidenceByCandidate.get(
        right.candidate_id,
      )!;
      return (
        leftEvidence.observed_trigger_epoch! -
          rightEvidence.observed_trigger_epoch! ||
        left.model.localeCompare(right.model) ||
        left.candidate_id.localeCompare(right.candidate_id)
      );
    });
  const decision = selectCanonicalDecision(
    request.setup_invalidated,
    active,
    exact,
    exactEvidenceByCandidate,
    nonExactTriggerByCandidate,
  );
  const candidateIdsConsidered = active
    .map((item) => item.candidate_id)
    .sort();
  const identity = {
    action: decision.action,
    candidate_ids_considered: candidateIdsConsidered,
    canonical_candidate_id: decision.candidate?.candidate_id ?? null,
    canonical_evidence_id: decision.evidence?.evidence_id ?? null,
    fidelity: decision.evidence?.fidelity ?? null,
    policy_version: ENTRY_POLICY_VERSION,
    reason: decision.reason,
    revision: request.revision,
    setup_id: request.setup_id,
  };
  return {
    selection_id: await canonicalSha256(identity),
    setup_id: request.setup_id,
    policy_version: ENTRY_POLICY_VERSION,
    revision: request.revision,
    candidate_ids_considered: candidateIdsConsidered,
    canonical_candidate_id: identity.canonical_candidate_id,
    canonical_evidence_id: identity.canonical_evidence_id,
    canonical_model: decision.candidate?.model ?? null,
    reason: decision.reason,
    fidelity: decision.evidence?.fidelity ?? null,
    action: decision.action,
    evaluated_at_epoch: request.evaluated_at_epoch,
  };
}

function activeModels(
  values: ReadonlyMap<EntryModelV2, EntryCandidate>,
): Set<EntryModelV2> {
  return new Set(
    [...values.keys()].filter((model) => ACTIVE_MODELS.has(model)),
  );
}

function sameModelSet(
  left: ReadonlySet<EntryModelV2>,
  right: ReadonlySet<EntryModelV2>,
): boolean {
  return (
    left.size === right.size && [...left].every((model) => right.has(model))
  );
}

function mergeTerminalFact(
  current: TerminalFact | null,
  setup: SetupEntryFacts,
  confirmedEpoch: number,
  before: ReadonlySet<EntryModelV2>,
  after: ReadonlySet<EntryModelV2>,
): TerminalFact | null {
  const beforeBoth = before.has("DIR_CLOSE") && before.has("HTF_FLIP");
  const afterBoth = after.has("DIR_CLOSE") && after.has("HTF_FLIP");
  const completedBothNow = !beforeBoth && afterBoth;
  if (setup.terminal_reason === null) {
    if (
      setup.terminal_epoch !== null ||
      setup.invalidated_before_entry ||
      completedBothNow
    ) {
      fail("open event contradicts terminal state");
    }
    return current;
  }
  if (setup.terminal_epoch !== confirmedEpoch) {
    fail("terminal epoch is not the confirmed event epoch");
  }
  const presented = {
    reason: setup.terminal_reason,
    epoch: setup.terminal_epoch,
  };
  if (current !== null) {
    if (
      current.reason === presented.reason &&
      current.epoch === presented.epoch
    ) {
      return current;
    }
    fail("terminal setup fact changed");
  }
  if (
    completedBothNow &&
    presented.reason !== "BOTH_ACTIVE_MODELS_OBSERVED"
  ) {
    fail("both-model transition has the wrong terminal");
  }
  if (
    (presented.reason === "INVALIDATED" ||
      presented.reason === "RETENTION_EVICTED") &&
    !sameModelSet(before, after)
  ) {
    fail("invalidation or retention emitted a new active candidate");
  }
  if (presented.reason === "INVALIDATED") {
    if (setup.invalidated_before_entry !== (before.size === 0)) {
      fail("invalidation contradicts prior candidates");
    }
  } else if (setup.invalidated_before_entry) {
    fail("non-invalidation terminal is pre-entry invalidated");
  }
  if (
    presented.reason === "BOTH_ACTIVE_MODELS_OBSERVED" &&
    !completedBothNow
  ) {
    fail("BOTH terminal is not the completion event");
  }
  return presented;
}

function sameTranscript(
  left: HTFFlipProofTranscript,
  right: HTFFlipProofTranscript,
): boolean {
  return (
    canonicalStringifyRdEntry(left) ===
    canonicalStringifyRdEntry(right)
  );
}

function upsertLatestTranscript(
  transcripts: Map<number, HTFFlipProofTranscript>,
  transcript: HTFFlipProofTranscript,
): void {
  const previous = transcripts.get(transcript.context_minutes);
  if (previous === undefined) {
    transcripts.set(transcript.context_minutes, transcript);
    return;
  }
  const boundaryComparison =
    transcript.htf_open_epoch - previous.htf_open_epoch ||
    transcript.scan_cutoff_epoch - previous.scan_cutoff_epoch;
  if (boundaryComparison < 0) {
    fail("HTF transcript chronology moved backwards");
  }
  if (boundaryComparison === 0) {
    if (!sameTranscript(previous, transcript)) {
      fail("HTF transcript boundary has conflicting content");
    }
    return;
  }
  if (transcript.htf_open_epoch === previous.htf_open_epoch) {
    const previousStatic = {
      context_minutes: previous.context_minutes,
      coverage_start_epoch: previous.coverage_start_epoch,
      full_lifecycle_ordered: previous.full_lifecycle_ordered,
      htf_open_epoch: previous.htf_open_epoch,
      htf_open_ticks: previous.htf_open_ticks,
      proof_resolution_seconds: previous.proof_resolution_seconds,
    };
    const currentStatic = {
      context_minutes: transcript.context_minutes,
      coverage_start_epoch: transcript.coverage_start_epoch,
      full_lifecycle_ordered: transcript.full_lifecycle_ordered,
      htf_open_epoch: transcript.htf_open_epoch,
      htf_open_ticks: transcript.htf_open_ticks,
      proof_resolution_seconds: transcript.proof_resolution_seconds,
    };
    if (
      canonicalStringifyRdEntry(previousStatic) !==
      canonicalStringifyRdEntry(currentStatic)
    ) {
      fail("same-anchor HTF transcript changed static prefix facts");
    }
    const expectedDelta =
      transcript.expected_child_count - previous.expected_child_count;
    const observedDelta =
      transcript.observed_child_count - previous.observed_child_count;
    if (
      expectedDelta <= 0 ||
      observedDelta < 0 ||
      observedDelta > expectedDelta
    ) {
      fail("same-anchor HTF transcript prefix counts are not monotonic");
    }
    if (previous.gap_present && !transcript.gap_present) {
      fail("same-anchor HTF transcript erased a prior gap");
    }
    if (
      previous.destination_seen_before_contact &&
      !transcript.destination_seen_before_contact
    ) {
      fail("same-anchor HTF transcript erased destination history");
    }
    if (!previous.gap_present && !transcript.gap_present) {
      if (
        previous.contact_candle !== null &&
        !sameTranscriptCandle(
          previous.contact_candle,
          transcript.contact_candle,
        )
      ) {
        fail("same-anchor HTF transcript rewrote contact history");
      }
      if (
        previous.recross_candle !== null &&
        !sameTranscriptCandle(
          previous.recross_candle,
          transcript.recross_candle,
        )
      ) {
        fail("same-anchor HTF transcript rewrote recross history");
      }
    }
  }
  transcripts.set(transcript.context_minutes, transcript);
}

function sameTranscriptCandle(
  left: NonNullable<HTFFlipProofTranscript["contact_candle"]>,
  right: HTFFlipProofTranscript["contact_candle"],
): boolean {
  return (
    right !== null &&
    canonicalStringifyRdEntry(left) ===
      canonicalStringifyRdEntry(right)
  );
}

function immutableSetupFacts(setup: SetupEntryFacts) {
  return {
    common_fidelity: setup.common_fidelity,
    direction: setup.direction,
    setup_id: setup.setup_id,
    zone_bottom_ticks: setup.zone_bottom_ticks,
    zone_engaged_epoch: setup.zone_engaged_epoch,
    zone_top_ticks: setup.zone_top_ticks,
  };
}

function validateAttemptScope(
  events: readonly EntryStreamEvent[],
): void {
  const baseline = events[0]!.match_request;
  for (const event of events) {
    const request = event.match_request;
    requireClosedText(event.event_id, "event_id");
    if (
      canonicalStringifyRdEntry(immutableSetupFacts(request.setup)) !==
        canonicalStringifyRdEntry(
          immutableSetupFacts(baseline.setup),
        ) ||
      request.attempt_kind !== baseline.attempt_kind ||
      request.trigger_ordinal !== baseline.trigger_ordinal
    ) {
      fail("entry stream changed immutable setup or attempt facts");
    }
    if (
      (request.attempt_kind === "INITIAL" &&
        request.trigger_ordinal !== 1) ||
      (request.attempt_kind === "RE_ENTRY" &&
        request.trigger_ordinal < 2) ||
      request.trigger_ordinal < 1
    ) {
      fail("entry stream has an invalid attempt ordinal");
    }
  }
}

async function nextCandleWickHandling(
  previousEvent: EntryStreamEvent | null,
  currentEvent: EntryStreamEvent,
  directionalClose: EntryCandidate | null,
  evidenceById: ReadonlyMap<string, EntryCandidateEvidence>,
): Promise<EntryHandlingObservation | null> {
  if (previousEvent === null || directionalClose === null) return null;
  const previousClose =
    previousEvent.match_request.confirmed_bar.close_epoch;
  if (directionalClose.observed_at_epoch !== previousClose) return null;
  const current = currentEvent.match_request.confirmed_bar;
  if (
    current.open_epoch !== previousClose ||
    current.close_epoch !== current.open_epoch + 300
  ) {
    return null;
  }
  const closeEvidence = [...evidenceById.values()]
    .filter(
      (item) =>
        item.candidate_id === directionalClose.candidate_id &&
        item.proof_plane === "CONFIRMED_5M" &&
        item.observed_trigger_epoch === previousClose,
    )
    .sort((left, right) => left.evidence_id.localeCompare(right.evidence_id));
  if (closeEvidence.length === 0) return null;
  const observedTicks =
    directionalClose.direction === "LONG" &&
    current.low_ticks < Math.min(current.open_ticks, current.close_ticks)
      ? current.low_ticks
      : directionalClose.direction === "SHORT" &&
          current.high_ticks >
            Math.max(current.open_ticks, current.close_ticks)
        ? current.high_ticks
        : null;
  if (observedTicks === null) return null;
  return buildEntryHandlingObservation(
    directionalClose,
    closeEvidence[0]!,
    "NEXT_CANDLE_WICK",
    previousEvent.match_request.attempt_kind,
    current.close_epoch,
    observedTicks,
    "DISCRETIONARY",
    SOURCE_CLAIMS.NEXT_CANDLE_WICK,
  );
}

function exactTerminalGraceFacts(
  current: EntryStreamEvent,
  authority: EntryStreamEvent,
  terminal: TerminalFact,
): boolean {
  const request = current.match_request;
  const authorityRequest = authority.match_request;
  return (
    request.setup.terminal_reason === terminal.reason &&
    request.setup.terminal_epoch === terminal.epoch &&
    canonicalStringifyRdEntry(request.setup) ===
      canonicalStringifyRdEntry(authorityRequest.setup) &&
    request.attempt_kind === authorityRequest.attempt_kind &&
    request.trigger_ordinal === authorityRequest.trigger_ordinal &&
    request.htf_proofs.length === 0 &&
    !request.generic_break_detected &&
    !request.rejection_respect_detected
  );
}

export async function evaluateEntryStream(
  events: readonly EntryStreamEvent[],
  setupInvalidated: boolean,
  revision: number,
  evaluatedAtEpoch: number,
): Promise<EntryEvaluation> {
  if (events.length === 0) fail("entry stream is empty");
  if (typeof setupInvalidated !== "boolean") {
    fail("setupInvalidated must be a boolean");
  }
  requireNonNegativeInteger(revision, "revision");
  requireNonNegativeInteger(evaluatedAtEpoch, "evaluatedAtEpoch");
  const eventsById = new Map<string, EntryStreamEvent>();
  mergeImmutable(
    eventsById,
    events,
    (item) => item.event_id,
    sameEvent,
    "event stream",
  );
  const ordered = [...eventsById.values()].sort(
    (left, right) =>
      left.match_request.confirmed_bar.close_epoch -
        right.match_request.confirmed_bar.close_epoch ||
      left.event_id.localeCompare(right.event_id),
  );
  validateAttemptScope(ordered);
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1]!.match_request.confirmed_bar;
    const current = ordered[index]!.match_request.confirmed_bar;
    if (previous.close_epoch === current.close_epoch) {
      fail("distinct events share one confirmed close");
    }
    if (current.open_epoch < previous.close_epoch) {
      fail("distinct confirmed event bars overlap");
    }
  }
  if (
    evaluatedAtEpoch <
    ordered[ordered.length - 1]!.match_request.confirmed_bar.close_epoch
  ) {
    fail("evaluation epoch precedes the last confirmed event");
  }

  const setupId = ordered[0]!.match_request.setup.setup_id;
  if (
    ordered.some(
      (event) => event.match_request.setup.setup_id !== setupId,
    )
  ) {
    fail("entry stream mixes setup IDs");
  }
  const transcripts = new Map<number, HTFFlipProofTranscript>();
  const candidates = new Map<string, EntryCandidate>();
  const evidence = new Map<string, EntryCandidateEvidence>();
  const handling = new Map<string, EntryHandlingObservation>();
  const firstCandidateByModel = new Map<EntryModelV2, EntryCandidate>();
  let terminalFact: TerminalFact | null = null;
  let terminalWickGraceFrom: EntryStreamEvent | null = null;
  let terminalWickGraceConsumed = false;
  let previousEvent: EntryStreamEvent | null = null;

  for (const event of ordered) {
    const request = event.match_request;
    if (terminalFact !== null) {
      validateEntryRequestShape(request);
      if (
        terminalWickGraceFrom === null ||
        terminalWickGraceConsumed
      ) {
        fail("new authority event follows terminal setup fact");
      }
      if (
        !exactTerminalGraceFacts(
          event,
          terminalWickGraceFrom,
          terminalFact,
        )
      ) {
        fail("post-terminal grace contains changed or trigger facts");
      }
      const wick = await nextCandleWickHandling(
        terminalWickGraceFrom,
        event,
        firstCandidateByModel.get("DIR_CLOSE") ?? null,
        evidence,
      );
      if (wick !== null) {
        mergeImmutable(
          handling,
          [wick],
          (item) => item.handling_id,
          sameHandling,
          "handling",
        );
      }
      terminalWickGraceConsumed = true;
      previousEvent = event;
      continue;
    }

    const wick = await nextCandleWickHandling(
      previousEvent,
      event,
      firstCandidateByModel.get("DIR_CLOSE") ?? null,
      evidence,
    );
    if (wick !== null) {
      mergeImmutable(
        handling,
        [wick],
        (item) => item.handling_id,
        sameHandling,
        "handling",
      );
    }
    const before = activeModels(firstCandidateByModel);
    for (const proofInput of request.htf_proofs) {
      const proof = isExpandedHtfFlipProof(proofInput)
        ? await validateHtfFlipProof(
            request.setup,
            proofInput,
            proofInput.transcript.htf_open_ticks,
          )
        : await validateHtfFlipProof(request.setup, proofInput);
      upsertLatestTranscript(transcripts, proof.transcript);
    }
    const match = await evaluateEntryMatch(request);
    const acceptedCandidateIds = new Set<string>();
    for (const candidate of match.candidates) {
      const first = firstCandidateByModel.get(candidate.model);
      if (first !== undefined) {
        if (!sameCandidate(first, candidate)) continue;
        acceptedCandidateIds.add(first.candidate_id);
        continue;
      }
      mergeImmutable(
        candidates,
        [candidate],
        (item) => item.candidate_id,
        sameCandidate,
        "candidate",
      );
      firstCandidateByModel.set(candidate.model, candidate);
      acceptedCandidateIds.add(candidate.candidate_id);
    }
    mergeImmutable(
      evidence,
      match.evidence.filter((item) =>
        acceptedCandidateIds.has(item.candidate_id),
      ),
      (item) => item.evidence_id,
      sameEvidence,
      "evidence",
    );
    mergeImmutable(
      handling,
      match.handling.filter((item) =>
        acceptedCandidateIds.has(item.candidate_id),
      ),
      (item) => item.handling_id,
      sameHandling,
      "handling",
    );
    const after = activeModels(firstCandidateByModel);
    const dirCloseIntroducedNow =
      !before.has("DIR_CLOSE") && after.has("DIR_CLOSE");
    terminalFact = mergeTerminalFact(
      terminalFact,
      request.setup,
      request.confirmed_bar.close_epoch,
      before,
      after,
    );
    if (
      terminalFact?.reason === "BOTH_ACTIVE_MODELS_OBSERVED" &&
      dirCloseIntroducedNow &&
      before.has("HTF_FLIP")
    ) {
      terminalWickGraceFrom = event;
    }
    previousEvent = event;
  }

  const candidateValues = [...candidates.values()].sort((left, right) =>
    left.candidate_id.localeCompare(right.candidate_id),
  );
  const evidenceValues = [...evidence.values()].sort((left, right) =>
    left.evidence_id.localeCompare(right.evidence_id),
  );
  const handlingValues = [...handling.values()].sort((left, right) =>
    left.handling_id.localeCompare(right.handling_id),
  );
  const accumulatedInvalidated =
    terminalFact?.reason === "INVALIDATED" &&
    activeModels(firstCandidateByModel).size === 0;
  if (setupInvalidated !== accumulatedInvalidated) {
    fail("setup invalidation disagrees with terminal facts");
  }
  const selection = await arbitrateEntryCandidates({
    setup_id: setupId,
    setup_invalidated: accumulatedInvalidated,
    revision,
    candidates: candidateValues,
    evidence: evidenceValues,
    evaluated_at_epoch: evaluatedAtEpoch,
  });
  return {
    candidates: candidateValues,
    evidence: evidenceValues,
    handling: handlingValues,
    selection,
  };
}
