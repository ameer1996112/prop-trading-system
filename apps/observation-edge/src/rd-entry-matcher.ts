import {
  canonicalStringifyRdEntry,
  type AmbiguityCode,
  type CandidateFidelity,
  type CandidateState,
  type EntryCandidate,
  type EntryCandidateEvidence,
  type EntryHandlingObservation,
  type EntryMatchRequest,
  type EntryModelV2,
  type HandlingMode,
  type HTFFlipProof,
  type HTFFlipProofTranscript,
  type OrderedCandle,
  type ProofPlane,
  type SetupEntryFacts,
} from "./rd-entry-domain";
import { canonicalSha256, SOURCE_CLAIMS } from "./rd-entry-policy";

export interface EdgeEntryMatchRequest
  extends Omit<EntryMatchRequest, "htf_proofs"> {
  readonly htf_proofs: readonly (
    | HTFFlipProof
    | HTFFlipProofTranscript
  )[];
}

export interface EntryMatchResult {
  readonly candidates: readonly EntryCandidate[];
  readonly evidence: readonly EntryCandidateEvidence[];
  readonly handling: readonly EntryHandlingObservation[];
}

type ProofInput = EdgeEntryMatchRequest["htf_proofs"][number];

const CANDIDATE_FIDELITIES = new Set<CandidateFidelity>([
  "EXACT",
  "CALIBRATED",
  "DISCRETIONARY",
  "UNRESOLVED",
]);
const TERMINAL_REASONS = new Set<NonNullable<
  SetupEntryFacts["terminal_reason"]
>>([
  "INVALIDATED",
  "BOTH_ACTIVE_MODELS_OBSERVED",
  "RETENTION_EVICTED",
]);
const FIDELITY_TRUST: Readonly<Record<CandidateFidelity, number>> = {
  EXACT: 0,
  CALIBRATED: 1,
  DISCRETIONARY: 2,
  UNRESOLVED: 3,
};

function fail(message: string): never {
  throw new TypeError(message);
}

function requireSafeInteger(
  value: number,
  name: string,
  minimum?: number,
): void {
  if (
    !Number.isSafeInteger(value) ||
    (minimum !== undefined && value < minimum)
  ) {
    fail(`${name} must be a safe integer`);
  }
}

function requireBoolean(value: boolean, name: string): void {
  if (typeof value !== "boolean") fail(`${name} must be a boolean`);
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

function requireExactKeys(
  value: object,
  keys: readonly string[],
  name: string,
): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (canonicalStringifyRdEntry(actual) !== canonicalStringifyRdEntry(expected)) {
    fail(`${name} has unknown or missing fields`);
  }
}

function validateSetup(setup: SetupEntryFacts): void {
  requireExactKeys(
    setup,
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
    "setup",
  );
  requireClosedText(setup.setup_id, "setup.setup_id");
  if (setup.direction !== "LONG" && setup.direction !== "SHORT") {
    fail("setup.direction is unsupported");
  }
  requireSafeInteger(setup.zone_top_ticks, "setup.zone_top_ticks");
  requireSafeInteger(setup.zone_bottom_ticks, "setup.zone_bottom_ticks");
  if (setup.zone_top_ticks <= setup.zone_bottom_ticks) {
    fail("setup zone bounds are inverted");
  }
  if (setup.zone_engaged_epoch !== null) {
    requireSafeInteger(
      setup.zone_engaged_epoch,
      "setup.zone_engaged_epoch",
      0,
    );
  }
  requireBoolean(
    setup.invalidated_before_entry,
    "setup.invalidated_before_entry",
  );
  if (!CANDIDATE_FIDELITIES.has(setup.common_fidelity)) {
    fail("setup.common_fidelity is unsupported");
  }
  if (
    setup.terminal_reason !== null &&
    !TERMINAL_REASONS.has(setup.terminal_reason)
  ) {
    fail("setup.terminal_reason is unsupported");
  }
  if ((setup.terminal_reason === null) !== (setup.terminal_epoch === null)) {
    fail("setup terminal reason and epoch must both be present or absent");
  }
  if (setup.terminal_epoch !== null) {
    requireSafeInteger(setup.terminal_epoch, "setup.terminal_epoch", 0);
    if (
      setup.zone_engaged_epoch !== null &&
      setup.terminal_epoch < setup.zone_engaged_epoch
    ) {
      fail("setup terminal precedes engagement");
    }
  }
  if (
    setup.invalidated_before_entry &&
    setup.terminal_reason !== "INVALIDATED"
  ) {
    fail("pre-entry invalidation requires an INVALIDATED terminal");
  }
}

function validateCandle(candle: OrderedCandle, name: string): void {
  requireExactKeys(
    candle,
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
  requireSafeInteger(candle.open_epoch, `${name}.open_epoch`, 0);
  requireSafeInteger(candle.close_epoch, `${name}.close_epoch`, 0);
  requireSafeInteger(candle.open_ticks, `${name}.open_ticks`);
  requireSafeInteger(candle.high_ticks, `${name}.high_ticks`);
  requireSafeInteger(candle.low_ticks, `${name}.low_ticks`);
  requireSafeInteger(candle.close_ticks, `${name}.close_ticks`);
  if (candle.close_epoch <= candle.open_epoch) {
    fail(`${name} has a non-increasing interval`);
  }
  if (
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
    fail(`${name} has invalid OHLC bounds`);
  }
}

function leastTrusted(
  first: CandidateFidelity,
  second: CandidateFidelity,
): CandidateFidelity {
  return FIDELITY_TRUST[first] >= FIDELITY_TRUST[second]
    ? first
    : second;
}

function validateCompletedHtfPrefix(
  transcript: HTFFlipProofTranscript,
): number {
  const context = transcript.context_minutes;
  if (context !== 15 && context !== 30 && context !== 60) {
    fail("HTF context must be 15, 30, or 60 minutes");
  }
  requireSafeInteger(transcript.htf_open_epoch, "htf_open_epoch", 0);
  requireSafeInteger(transcript.scan_cutoff_epoch, "scan_cutoff_epoch", 0);
  requireSafeInteger(
    transcript.proof_resolution_seconds,
    "proof_resolution_seconds",
    1,
  );
  const resolution = transcript.proof_resolution_seconds;
  if (resolution >= 300 || 300 % resolution !== 0) {
    fail("HTF proof resolution must divide five minutes and be below it");
  }
  const coverageSeconds =
    transcript.scan_cutoff_epoch - transcript.htf_open_epoch;
  if (
    coverageSeconds <= 0 ||
    coverageSeconds > context * 60 ||
    coverageSeconds % 300 !== 0 ||
    coverageSeconds % resolution !== 0
  ) {
    fail("HTF transcript is not a completed bounded prefix");
  }
  return coverageSeconds / resolution;
}

function sameCandle(
  left: OrderedCandle | null,
  right: OrderedCandle | null,
): boolean {
  return (
    canonicalStringifyRdEntry(left) === canonicalStringifyRdEntry(right)
  );
}

export function isExpandedHtfFlipProof(
  value: ProofInput,
): value is HTFFlipProof {
  return "matched" in value;
}

function transcriptProofInput(value: ProofInput): value is HTFFlipProofTranscript {
  return !isExpandedHtfFlipProof(value);
}

async function expandTranscript(
  setup: SetupEntryFacts,
  transcript: HTFFlipProofTranscript,
): Promise<HTFFlipProof> {
  requireExactKeys(
    transcript,
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
    "HTF transcript",
  );
  requireSafeInteger(transcript.htf_open_ticks, "htf_open_ticks");
  requireSafeInteger(
    transcript.coverage_start_epoch,
    "coverage_start_epoch",
    0,
  );
  requireSafeInteger(
    transcript.coverage_end_epoch,
    "coverage_end_epoch",
    0,
  );
  requireSafeInteger(
    transcript.expected_child_count,
    "expected_child_count",
    0,
  );
  requireSafeInteger(
    transcript.observed_child_count,
    "observed_child_count",
    0,
  );
  requireBoolean(transcript.gap_present, "gap_present");
  requireBoolean(
    transcript.full_lifecycle_ordered,
    "full_lifecycle_ordered",
  );
  requireBoolean(
    transcript.destination_seen_before_contact,
    "destination_seen_before_contact",
  );
  requireBoolean(transcript.same_child, "same_child");

  const expectedCount = validateCompletedHtfPrefix(transcript);
  if (
    transcript.coverage_start_epoch !== transcript.htf_open_epoch ||
    transcript.coverage_end_epoch !== transcript.scan_cutoff_epoch
  ) {
    fail("HTF transcript coverage disagrees with its scan boundary");
  }
  if (
    transcript.expected_child_count !== expectedCount ||
    transcript.observed_child_count > expectedCount ||
    transcript.gap_present !==
      (transcript.observed_child_count !== transcript.expected_child_count)
  ) {
    fail("HTF transcript child coverage is contradictory");
  }

  const retainedIntervals = new Set<string>();
  for (const [name, candle] of [
    ["contact candle", transcript.contact_candle],
    ["recross candle", transcript.recross_candle],
  ] as const) {
    if (candle === null) continue;
    validateCandle(candle, name);
    if (
      candle.open_epoch < transcript.coverage_start_epoch ||
      candle.close_epoch > transcript.coverage_end_epoch ||
      candle.close_epoch - candle.open_epoch !==
        transcript.proof_resolution_seconds ||
      (candle.open_epoch - transcript.coverage_start_epoch) %
        transcript.proof_resolution_seconds !==
        0
    ) {
      fail(`${name} lies outside or is misaligned with transcript coverage`);
    }
    retainedIntervals.add(`${candle.open_epoch}:${candle.close_epoch}`);
  }
  if (transcript.observed_child_count < retainedIntervals.size) {
    fail("observed child count is below retained candle intervals");
  }

  const contact = transcript.contact_candle;
  const recross = transcript.recross_candle;
  if (recross !== null && contact === null) {
    fail("HTF recross requires a retained contact");
  }
  const sameInterval =
    contact !== null &&
    recross !== null &&
    contact.open_epoch === recross.open_epoch &&
    contact.close_epoch === recross.close_epoch;
  if (transcript.same_child !== sameInterval) {
    fail("same_child contradicts retained candle intervals");
  }
  if (sameInterval && !sameCandle(contact, recross)) {
    fail("same-child transcript candles differ");
  }
  if (
    contact !== null &&
    !(
      contact.low_ticks <= setup.zone_top_ticks &&
      contact.high_ticks >= setup.zone_bottom_ticks
    )
  ) {
    fail("contact candle does not overlap the setup zone");
  }
  const recrosses = (candle: OrderedCandle): boolean =>
    setup.direction === "LONG"
      ? candle.high_ticks > transcript.htf_open_ticks
      : candle.low_ticks < transcript.htf_open_ticks;
  if (recross !== null && !recrosses(recross)) {
    fail("recross candle does not cross the HTF open");
  }
  if (
    contact !== null &&
    recross !== null &&
    !sameInterval &&
    contact.close_epoch > recross.open_epoch
  ) {
    fail("distinct contact and recross candles are not chronological");
  }
  if (
    contact !== null &&
    recrosses(contact) &&
    (!transcript.same_child || !sameCandle(contact, recross))
  ) {
    fail("contact already crosses the HTF open without same-child proof");
  }

  const matched = contact !== null && recross !== null;
  const contactAtOpen =
    contact !== null &&
    contact.open_ticks >= setup.zone_bottom_ticks &&
    contact.open_ticks <= setup.zone_top_ticks;
  const sameChildAmbiguous =
    matched && transcript.same_child && !contactAtOpen;
  const exact =
    matched &&
    !transcript.gap_present &&
    transcript.expected_child_count === transcript.observed_child_count &&
    transcript.full_lifecycle_ordered &&
    !transcript.destination_seen_before_contact &&
    !sameChildAmbiguous;
  const ambiguityCodes: AmbiguityCode[] = [];
  if (sameChildAmbiguous) {
    ambiguityCodes.push("SHADOW_SAME_CHILD_BAR_ORDER");
  }
  if (transcript.gap_present) {
    ambiguityCodes.push("SHADOW_MISSING_INTRABAR_COVERAGE");
  }
  return {
    matched,
    event_anchor_epoch: transcript.htf_open_epoch,
    trigger_epoch: recross?.close_epoch ?? null,
    trigger_ticks: recross === null ? null : transcript.htf_open_ticks,
    htf_context_minutes: [transcript.context_minutes],
    fidelity: exact ? "EXACT" : "UNRESOLVED",
    proof_plane: "LOWER_TIMEFRAME_REPLAY",
    proof_resolution_seconds: transcript.proof_resolution_seconds,
    coverage_start_epoch: transcript.coverage_start_epoch,
    coverage_end_epoch: transcript.coverage_end_epoch,
    coverage_expected_child_count: transcript.expected_child_count,
    coverage_observed_child_count: transcript.observed_child_count,
    coverage_gap_detected: transcript.gap_present,
    contact_child: contact,
    recross_child: recross,
    destination_seen_before_contact:
      transcript.destination_seen_before_contact,
    ambiguity_codes: ambiguityCodes,
    transcript_sha256: await canonicalSha256(transcript),
    full_lifecycle_ordered: transcript.full_lifecycle_ordered,
    transcript,
  };
}

function expandedProofComparable(proof: HTFFlipProof) {
  return {
    matched: proof.matched,
    event_anchor_epoch: proof.event_anchor_epoch,
    trigger_epoch: proof.trigger_epoch,
    trigger_ticks: proof.trigger_ticks,
    htf_context_minutes: proof.htf_context_minutes,
    fidelity: proof.fidelity,
    proof_plane: proof.proof_plane,
    proof_resolution_seconds: proof.proof_resolution_seconds,
    coverage_start_epoch: proof.coverage_start_epoch,
    coverage_end_epoch: proof.coverage_end_epoch,
    coverage_expected_child_count: proof.coverage_expected_child_count,
    coverage_observed_child_count: proof.coverage_observed_child_count,
    coverage_gap_detected: proof.coverage_gap_detected,
    contact_child: proof.contact_child,
    recross_child: proof.recross_child,
    destination_seen_before_contact:
      proof.destination_seen_before_contact,
    ambiguity_codes: proof.ambiguity_codes,
    transcript_sha256: proof.transcript_sha256,
    full_lifecycle_ordered: proof.full_lifecycle_ordered,
    transcript: proof.transcript,
  };
}

export async function validateHtfFlipProof(
  setup: SetupEntryFacts,
  proof: HTFFlipProofTranscript,
): Promise<HTFFlipProof>;
export async function validateHtfFlipProof(
  setup: SetupEntryFacts,
  proof: HTFFlipProof,
  htfOpenTicks: number,
): Promise<HTFFlipProof>;
export async function validateHtfFlipProof(
  setup: SetupEntryFacts,
  proof: ProofInput,
  htfOpenTicks?: number,
): Promise<HTFFlipProof> {
  validateSetup(setup);
  const transcript = transcriptProofInput(proof)
    ? proof
    : proof.transcript;
  const expanded = await expandTranscript(setup, transcript);
  if (
    htfOpenTicks !== undefined &&
    htfOpenTicks !== transcript.htf_open_ticks
  ) {
    fail("HTF opening ticks disagree with the transcript");
  }
  if (
    !transcriptProofInput(proof) &&
    canonicalStringifyRdEntry(expandedProofComparable(proof)) !==
      canonicalStringifyRdEntry(expandedProofComparable(expanded))
  ) {
    fail("HTF proof fields contradict its bounded transcript");
  }
  return transcriptProofInput(proof) ? expanded : proof;
}

function directionalClose(request: EdgeEntryMatchRequest): boolean {
  const bar = request.confirmed_bar;
  const setup = request.setup;
  return setup.direction === "LONG"
    ? bar.close_ticks > bar.open_ticks &&
        bar.close_ticks > setup.zone_top_ticks
    : bar.close_ticks < bar.open_ticks &&
        bar.close_ticks < setup.zone_bottom_ticks;
}

function modelSourceClaims(model: EntryModelV2): readonly string[] {
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

async function buildCandidate(
  request: EdgeEntryMatchRequest,
  model: EntryModelV2,
  state: CandidateState,
  eventAnchorEpoch: number,
  observedAtEpoch: number,
  normalizedFrom: EntryModelV2 | null = null,
): Promise<EntryCandidate> {
  const candidate_id = await canonicalSha256({
    direction: request.setup.direction,
    event_anchor_epoch: eventAnchorEpoch,
    model,
    setup_id: request.setup.setup_id,
    trigger_ordinal: request.trigger_ordinal,
  });
  return {
    candidate_id,
    setup_id: request.setup.setup_id,
    model,
    state,
    event_anchor_epoch: eventAnchorEpoch,
    trigger_ordinal: request.trigger_ordinal,
    direction: request.setup.direction,
    source_claim_ids: modelSourceClaims(model),
    normalized_from: normalizedFrom,
    observed_at_epoch: observedAtEpoch,
  };
}

interface EvidenceFields {
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
  readonly observed_at_epoch: number;
}

async function buildEvidence(
  candidate: EntryCandidate,
  fields: EvidenceFields,
): Promise<EntryCandidateEvidence> {
  const payload_sha256 = await canonicalSha256({
    ambiguity_codes: fields.ambiguity_codes,
    candidate_id: candidate.candidate_id,
    coverage_end_epoch: fields.coverage_end_epoch,
    coverage_start_epoch: fields.coverage_start_epoch,
    failed_rule_ids: fields.failed_rule_ids,
    fidelity: fields.fidelity,
    htf_context_minutes: fields.htf_context_minutes,
    observed_trigger_epoch: fields.observed_trigger_epoch,
    observed_trigger_ticks: fields.observed_trigger_ticks,
    passed_rule_ids: fields.passed_rule_ids,
    proof_plane: fields.proof_plane,
    proof_resolution_seconds: fields.proof_resolution_seconds,
    source_claim_ids: fields.source_claim_ids,
  });
  const evidence_id = await canonicalSha256({
    candidate_id: candidate.candidate_id,
    coverage_end_epoch: fields.coverage_end_epoch,
    coverage_start_epoch: fields.coverage_start_epoch,
    observed_trigger_epoch: fields.observed_trigger_epoch,
    payload_sha256,
    proof_plane: fields.proof_plane,
    proof_resolution_seconds: fields.proof_resolution_seconds,
  });
  return {
    evidence_id,
    candidate_id: candidate.candidate_id,
    observed_trigger_epoch: fields.observed_trigger_epoch,
    observed_trigger_ticks: fields.observed_trigger_ticks,
    htf_context_minutes: fields.htf_context_minutes,
    fidelity: fields.fidelity,
    proof_plane: fields.proof_plane,
    proof_resolution_seconds: fields.proof_resolution_seconds,
    coverage_start_epoch: fields.coverage_start_epoch,
    coverage_end_epoch: fields.coverage_end_epoch,
    ambiguity_codes: fields.ambiguity_codes,
    passed_rule_ids: fields.passed_rule_ids,
    failed_rule_ids: fields.failed_rule_ids,
    source_claim_ids: fields.source_claim_ids,
    payload_sha256,
    observed_at_epoch: fields.observed_at_epoch,
  };
}

export async function buildEntryHandlingObservation(
  candidate: EntryCandidate,
  evidence: EntryCandidateEvidence,
  handlingMode: HandlingMode,
  attemptKind: EdgeEntryMatchRequest["attempt_kind"],
  observedEpoch: number,
  observedTicks: number | null,
  fidelity: CandidateFidelity,
  sourceClaimIds: readonly string[],
): Promise<EntryHandlingObservation> {
  const handling_id = await canonicalSha256({
    attempt_kind: attemptKind,
    candidate_id: candidate.candidate_id,
    evidence_id: evidence.evidence_id,
    fidelity,
    handling_mode: handlingMode,
    observed_epoch: observedEpoch,
    observed_ticks: observedTicks,
    source_claim_ids: sourceClaimIds,
  });
  return {
    handling_id,
    candidate_id: candidate.candidate_id,
    evidence_id: evidence.evidence_id,
    handling_mode: handlingMode,
    attempt_kind: attemptKind,
    observed_epoch: observedEpoch,
    observed_ticks: observedTicks,
    fidelity,
    source_claim_ids: sourceClaimIds,
  };
}

async function appendConfirmedMatch(
  request: EdgeEntryMatchRequest,
  model: "DIR_CLOSE" | "LEGACY_BREAK_CANDLE" | "LEGACY_REJECTION_RESPECT",
  state: CandidateState,
  candidates: EntryCandidate[],
  evidenceRows: EntryCandidateEvidence[],
  handlingRows: EntryHandlingObservation[],
): Promise<void> {
  const candidate = await buildCandidate(
    request,
    model,
    state,
    request.confirmed_bar.open_epoch,
    request.confirmed_bar.close_epoch,
  );
  const ruleId =
    model === "DIR_CLOSE"
      ? "ENTRY_DIR_CLOSE"
      : model === "LEGACY_BREAK_CANDLE"
        ? "ENTRY_BREAK_CANDLE_NORMALIZATION"
        : "ENTRY_REJECTION_RESPECT_DISABLED";
  const active = model === "DIR_CLOSE";
  const evidence = await buildEvidence(candidate, {
    observed_trigger_epoch: request.confirmed_bar.close_epoch,
    observed_trigger_ticks: request.confirmed_bar.close_ticks,
    htf_context_minutes: [],
    fidelity: leastTrusted(
      request.setup.common_fidelity,
      "EXACT",
    ),
    proof_plane: "CONFIRMED_5M",
    proof_resolution_seconds: 300,
    coverage_start_epoch: request.confirmed_bar.open_epoch,
    coverage_end_epoch: request.confirmed_bar.close_epoch,
    ambiguity_codes: [],
    passed_rule_ids: active ? [ruleId] : [],
    failed_rule_ids: active ? [] : [ruleId],
    source_claim_ids: modelSourceClaims(model),
    observed_at_epoch: request.confirmed_bar.close_epoch,
  });
  candidates.push(candidate);
  evidenceRows.push(evidence);
  handlingRows.push(
    await buildEntryHandlingObservation(
      candidate,
      evidence,
      "CLOSE_CONFIRMATION",
      request.attempt_kind,
      evidence.observed_trigger_epoch ?? evidence.observed_at_epoch,
      evidence.observed_trigger_ticks,
      evidence.fidelity,
      modelSourceClaims(model),
    ),
  );
}

function uniqueClaims(
  ...groups: readonly (readonly string[])[]
): readonly string[] {
  return [...new Set(groups.flatMap((group) => [...group]))];
}

function proofIsOrderProven(proof: HTFFlipProof): boolean {
  return (
    proof.fidelity === "EXACT" &&
    proof.full_lifecycle_ordered &&
    proof.ambiguity_codes.length === 0
  );
}

function proofBoundaryContainsConfirmedBar(
  request: EdgeEntryMatchRequest,
  proof: HTFFlipProof,
): boolean {
  return proof.htf_context_minutes.some(
    (context) =>
      proof.event_anchor_epoch <= request.confirmed_bar.open_epoch &&
      request.confirmed_bar.close_epoch <=
        proof.event_anchor_epoch + context * 60,
  );
}

interface PreparedProof {
  readonly proof: HTFFlipProof;
  readonly fidelity: CandidateFidelity;
  readonly passedRuleIds: readonly string[];
  readonly failedRuleIds: readonly string[];
  readonly sourceClaimIds: readonly string[];
}

function evidenceGroupingKey(item: PreparedProof): string {
  const proof = item.proof;
  return canonicalStringifyRdEntry({
    ambiguity_codes: proof.ambiguity_codes,
    coverage_end_epoch: proof.coverage_end_epoch,
    coverage_expected_child_count: proof.coverage_expected_child_count,
    coverage_gap_detected: proof.coverage_gap_detected,
    coverage_observed_child_count: proof.coverage_observed_child_count,
    coverage_start_epoch: proof.coverage_start_epoch,
    failed_rule_ids: item.failedRuleIds,
    fidelity: item.fidelity,
    proof_plane: proof.proof_plane,
    proof_resolution_seconds: proof.proof_resolution_seconds,
    source_claim_ids: item.sourceClaimIds,
    transcript_scan_cutoff_epoch: proof.transcript.scan_cutoff_epoch,
    trigger_ticks: proof.trigger_ticks,
    passed_rule_ids: item.passedRuleIds,
  });
}

async function appendHtfGroup(
  request: EdgeEntryMatchRequest,
  proofs: readonly HTFFlipProof[],
  normalized: boolean,
  candidates: EntryCandidate[],
  evidenceRows: EntryCandidateEvidence[],
  handlingRows: EntryHandlingObservation[],
): Promise<void> {
  const orderProven = proofs.some(proofIsOrderProven);
  const candidate = await buildCandidate(
    request,
    "HTF_FLIP",
    normalized ? "NORMALIZED" : orderProven ? "MATCHED" : "BLOCKED",
    proofs[0]!.event_anchor_epoch,
    Math.max(...proofs.map((proof) => proof.transcript.scan_cutoff_epoch)),
    normalized ? "LEGACY_BREAK_CANDLE" : null,
  );
  candidates.push(candidate);

  const prepared = proofs.map((proof): PreparedProof => {
    const proofExact = proofIsOrderProven(proof);
    return {
      proof,
      fidelity: leastTrusted(
        request.setup.common_fidelity,
        proof.fidelity,
      ),
      passedRuleIds: proofExact ? ["ENTRY_HTF_FLIP"] : [],
      failedRuleIds: proofExact
        ? []
        : [
            "ENTRY_HTF_FLIP",
            ...(proof.destination_seen_before_contact &&
              !proof.coverage_gap_detected
              ? ["ENTRY_HTF_ZONE_SIDE_FIRST"]
              : []),
          ],
      sourceClaimIds: uniqueClaims(
        SOURCE_CLAIMS.HTF_FLIP,
        normalized ? SOURCE_CLAIMS.LEGACY_BREAK_CANDLE : [],
        proof.full_lifecycle_ordered ? [] : SOURCE_CLAIMS.HTF_BOUNDARY,
      ),
    };
  });
  const grouped = new Map<string, PreparedProof[]>();
  for (const item of prepared) {
    const key = evidenceGroupingKey(item);
    grouped.set(key, [...(grouped.get(key) ?? []), item]);
  }
  for (const key of [...grouped.keys()].sort()) {
    const proofGroup = grouped.get(key)!;
    const representative = proofGroup[0]!;
    const evidence = await buildEvidence(candidate, {
      observed_trigger_epoch: representative.proof.trigger_epoch,
      observed_trigger_ticks: representative.proof.trigger_ticks,
      htf_context_minutes: [
        ...new Set(
          proofGroup.flatMap((item) => [
            ...item.proof.htf_context_minutes,
          ]),
        ),
      ].sort((left, right) => left - right),
      fidelity: representative.fidelity,
      proof_plane: representative.proof.proof_plane,
      proof_resolution_seconds:
        representative.proof.proof_resolution_seconds,
      coverage_start_epoch: representative.proof.coverage_start_epoch,
      coverage_end_epoch: representative.proof.coverage_end_epoch,
      ambiguity_codes: representative.proof.ambiguity_codes,
      passed_rule_ids: representative.passedRuleIds,
      failed_rule_ids: representative.failedRuleIds,
      source_claim_ids: representative.sourceClaimIds,
      observed_at_epoch:
        representative.proof.transcript.scan_cutoff_epoch,
    });
    evidenceRows.push(evidence);
    handlingRows.push(
      await buildEntryHandlingObservation(
        candidate,
        evidence,
        "INTRABAR_FLIP",
        request.attempt_kind,
        evidence.observed_trigger_epoch ?? evidence.observed_at_epoch,
        evidence.observed_trigger_ticks,
        evidence.fidelity,
        SOURCE_CLAIMS.HTF_FLIP,
      ),
    );
  }
}

function validateAttempt(request: EdgeEntryMatchRequest): void {
  if (request.attempt_kind !== "INITIAL" && request.attempt_kind !== "RE_ENTRY") {
    fail("attempt_kind is unsupported");
  }
  requireSafeInteger(request.trigger_ordinal, "trigger_ordinal", 1);
  if (
    (request.attempt_kind === "INITIAL" &&
      request.trigger_ordinal !== 1) ||
    (request.attempt_kind === "RE_ENTRY" &&
      request.trigger_ordinal < 2)
  ) {
    fail("attempt kind contradicts trigger ordinal");
  }
}

export function validateEntryRequestShape(
  request: EdgeEntryMatchRequest | EntryMatchRequest,
): void {
  requireExactKeys(
    request,
    [
      "setup",
      "confirmed_bar",
      "htf_proofs",
      "generic_break_detected",
      "rejection_respect_detected",
      "attempt_kind",
      "trigger_ordinal",
    ],
    "entry match request",
  );
  validateSetup(request.setup);
  validateCandle(request.confirmed_bar, "confirmed_bar");
  if (
    request.confirmed_bar.close_epoch -
      request.confirmed_bar.open_epoch !==
    300
  ) {
    fail("confirmed_bar must span exactly five minutes");
  }
  requireBoolean(
    request.generic_break_detected,
    "generic_break_detected",
  );
  requireBoolean(
    request.rejection_respect_detected,
    "rejection_respect_detected",
  );
  validateAttempt(request);
  if (
    request.setup.zone_engaged_epoch !== null &&
    request.setup.zone_engaged_epoch > request.confirmed_bar.close_epoch
  ) {
    fail("zone engagement follows the confirmed event");
  }
  if (!Array.isArray(request.htf_proofs) || request.htf_proofs.length > 3) {
    fail("htf_proofs must contain at most three bounded proofs");
  }
}

export async function evaluateEntryMatch(
  request: EdgeEntryMatchRequest | EntryMatchRequest,
): Promise<EntryMatchResult> {
  validateEntryRequestShape(request);
  if (
    request.setup.terminal_epoch !== null &&
    request.setup.terminal_epoch !== request.confirmed_bar.close_epoch
  ) {
    fail("terminal fact is not contemporaneous with the event");
  }
  const proofs = await Promise.all(
    request.htf_proofs.map((proof) =>
      transcriptProofInput(proof)
        ? validateHtfFlipProof(request.setup, proof)
        : validateHtfFlipProof(
            request.setup,
            proof,
            proof.transcript.htf_open_ticks,
          )
    ),
  );
  const contexts = proofs.map((proof) => proof.htf_context_minutes[0]!);
  if (new Set(contexts).size !== contexts.length) {
    fail("htf_proofs contains duplicate context_minutes");
  }
  for (const proof of proofs) {
    if (
      proof.coverage_end_epoch > request.confirmed_bar.close_epoch ||
      proof.transcript.scan_cutoff_epoch !== proof.coverage_end_epoch
    ) {
      fail("HTF proof cutoff follows the confirmed event");
    }
    if (
      proof.matched &&
      (proof.trigger_epoch === null ||
        proof.trigger_epoch < proof.coverage_start_epoch ||
        proof.trigger_epoch > proof.coverage_end_epoch ||
        (request.setup.zone_engaged_epoch !== null &&
          request.setup.zone_engaged_epoch > proof.trigger_epoch))
    ) {
      fail("HTF trigger lies outside accepted setup chronology");
    }
  }

  if (
    request.setup.zone_engaged_epoch === null ||
    request.setup.invalidated_before_entry ||
    request.setup.terminal_reason === "INVALIDATED" ||
    request.setup.terminal_reason === "RETENTION_EVICTED"
  ) {
    return { candidates: [], evidence: [], handling: [] };
  }

  const candidates: EntryCandidate[] = [];
  const evidenceRows: EntryCandidateEvidence[] = [];
  const handlingRows: EntryHandlingObservation[] = [];
  if (directionalClose(request)) {
    await appendConfirmedMatch(
      request,
      "DIR_CLOSE",
      "MATCHED",
      candidates,
      evidenceRows,
      handlingRows,
    );
  }

  const proofGroups = new Map<string, HTFFlipProof[]>();
  for (const proof of proofs
    .filter((item) => item.matched)
    .sort(
      (left, right) =>
        left.event_anchor_epoch - right.event_anchor_epoch ||
        (left.trigger_epoch ?? 0) - (right.trigger_epoch ?? 0) ||
        left.htf_context_minutes[0]! - right.htf_context_minutes[0]!,
    )) {
    if (proof.trigger_epoch === null) {
      fail("matched HTF proof lacks a trigger");
    }
    const key = `${proof.event_anchor_epoch}:${proof.trigger_epoch}`;
    proofGroups.set(key, [...(proofGroups.get(key) ?? []), proof]);
  }
  const groupByCandidateId = new Map<string, string>();
  for (const [key, group] of proofGroups) {
    const proof = group[0]!;
    const semanticId = await canonicalSha256({
      direction: request.setup.direction,
      event_anchor_epoch: proof.event_anchor_epoch,
      model: "HTF_FLIP",
      setup_id: request.setup.setup_id,
      trigger_ordinal: request.trigger_ordinal,
    });
    const previous = groupByCandidateId.get(semanticId);
    if (previous !== undefined && previous !== key) {
      fail("HTF proof groups cause a candidate identity collision");
    }
    groupByCandidateId.set(semanticId, key);
  }

  let breakNormalized = false;
  for (const key of [...proofGroups.keys()].sort((left, right) => {
    const leftParts = left.split(":").map(Number);
    const rightParts = right.split(":").map(Number);
    return (
      leftParts[0]! - rightParts[0]! ||
      leftParts[1]! - rightParts[1]!
    );
  })) {
    const group = proofGroups.get(key)!.sort(
      (left, right) =>
        left.htf_context_minutes[0]! - right.htf_context_minutes[0]! ||
        left.fidelity.localeCompare(right.fidelity) ||
        left.transcript_sha256.localeCompare(right.transcript_sha256),
    );
    const normalized =
      request.generic_break_detected &&
      group[0]!.trigger_epoch === request.confirmed_bar.close_epoch &&
      group.some((proof) =>
        proofBoundaryContainsConfirmedBar(request, proof)
      );
    breakNormalized ||= normalized;
    await appendHtfGroup(
      request,
      group,
      normalized,
      candidates,
      evidenceRows,
      handlingRows,
    );
  }
  if (request.generic_break_detected && !breakNormalized) {
    await appendConfirmedMatch(
      request,
      "LEGACY_BREAK_CANDLE",
      "REJECTED",
      candidates,
      evidenceRows,
      handlingRows,
    );
  }
  if (request.rejection_respect_detected) {
    await appendConfirmedMatch(
      request,
      "LEGACY_REJECTION_RESPECT",
      "REJECTED",
      candidates,
      evidenceRows,
      handlingRows,
    );
  }
  return {
    candidates,
    evidence: evidenceRows,
    handling: handlingRows,
  };
}
