import { validateSignalEvidenceV1, type SignalEvidenceEntryV1 } from "./signal-evidence-v1";
import type { Registration } from "./signal-admission-registration-v1";
import type { AdmissionCode, ReceiptOutcome, Safety, StreamState, Transport } from "./signal-admission-wire-v1";

export interface AdmissionReceipt {
  id: string; bodySha256: string; outcome: ReceiptOutcome; code: AdmissionCode | null;
}
export interface AttemptFact {
  formationHash: string;
  // Null until the first selected entry reserves this attempt. Formation facts
  // exist even when every earlier observation was NO_CANDIDATE.
  evidenceId: string | null; evidenceHash: string | null;
  triggerEpoch: number | null; selectionKey: string | null; disputed: boolean;
}
export interface AdmissionSnapshot {
  state: StreamState; revision: number; nextSequence: number; lastAcceptedAt: number | null;
  existingReceipt: AdmissionReceipt | null;
  // Both maps are restricted to the authenticated namespace/scope. The store
  // loads relevant keys only, preserving facts across registration generations.
  attempts: Record<string, AttemptFact>;
  evidenceFacts: Record<string, { attemptKey: string; evidenceHash: string }>;
}
export interface AdmissionEntryDecision {
  entry: SignalEvidenceEntryV1;
  action: "NEW" | "AUDIT_ONLY" | "NO_CANDIDATE";
  expiresAt: number | null;
  selectionKey: string | null;
}
export type AdmissionDecision = Safety & (
  | { kind: "DUPLICATE"; receipt: AdmissionReceipt; streamState: StreamState }
  | { kind: "BLOCKED"; code: "STREAM_BLOCKED" }
  | { kind: "QUARANTINE"; code: AdmissionCode; disputedAttemptKeys: readonly string[] }
  | { kind: "COMMIT"; entries: readonly AdmissionEntryDecision[] }
);
const safety = { authority: "EVIDENCE_ONLY", execution_allowed: false } as const;
function quarantine(code: AdmissionCode, disputedAttemptKeys: readonly string[] = []): AdmissionDecision {
  return { ...safety, kind: "QUARANTINE", code, disputedAttemptKeys };
}
function epoch(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0; }
function deadline(at: number, duration: number): number | null {
  if (!epoch(at) || !epoch(duration) || at > Number.MAX_SAFE_INTEGER - duration) return null;
  return at + duration;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(",")}}`;
  return JSON.stringify(value);
}
function selectionKey(entry: SignalEvidenceEntryV1): string | null {
  if (entry.selected === null) return null;
  const { candidate, evidence } = entry.selected;
  // Exclude refreshed observation/coverage metadata and chart-local identities,
  // retaining all actual trigger, reference-candle, lifecycle and proof facts.
  const refreshed = new Set(["candidate_id", "evidence_id", "payload_sha256", "observed_at_epoch", "coverage_start_epoch", "coverage_end_epoch", "trigger_sequence", "source_claim_ids"]);
  return canonical({ model: candidate.model, direction: candidate.direction, boc_tier: candidate.boc_tier,
    event_anchor_epoch: candidate.event_anchor_epoch, reference_candle_open_epoch: candidate.reference_candle_open_epoch,
    evidence: Object.fromEntries(Object.entries(evidence).filter(([key]) => !refreshed.has(key))) });
}

/** Pure preflight only. Caller authenticates first; Task 3 must reassert every
 * relevant stream, registry and immutable-fact guard in the transaction. */
export async function evaluateAdmission(t: Transport, r: Registration, snapshot: AdmissionSnapshot, now: number): Promise<AdmissionDecision> {
  const prior = snapshot.existingReceipt;
  if (prior !== null) return prior.bodySha256 === t.bodySha256
    ? { ...safety, kind: "DUPLICATE", receipt: { ...prior }, streamState: snapshot.state }
    : quarantine("BODY_CONFLICT");
  if (snapshot.state !== "ACTIVE" || snapshot.revision !== r.revision) return { ...safety, kind: "BLOCKED", code: "STREAM_BLOCKED" };
  if (!Number.isSafeInteger(t.sequence) || t.sequence <= 0 || t.sequence === Number.MAX_SAFE_INTEGER
    || !Number.isSafeInteger(snapshot.nextSequence) || snapshot.nextSequence <= 0) return quarantine("INVALID_EVIDENCE");
  if (t.sequence !== snapshot.nextSequence) return quarantine(t.sequence > snapshot.nextSequence ? "SEQUENCE_GAP" : "UNKNOWN_OLD_SEQUENCE");
  if (!epoch(now) || (snapshot.lastAcceptedAt !== null && !epoch(snapshot.lastAcceptedAt))) return quarantine("INVALID_EVIDENCE");
  if (snapshot.lastAcceptedAt !== null && now < snapshot.lastAcceptedAt) return quarantine("CLOCK_REGRESSION");
  const policy = r.freshness;
  if (![policy.max_event_age_seconds, policy.max_observation_age_seconds, policy.max_queue_age_seconds].every(n => epoch(n) && n > 0)
    || !epoch(policy.future_skew_seconds) || !epoch(r.activeUntil)) return quarantine("INVALID_EVIDENCE");
  const futureLimit = deadline(now, policy.future_skew_seconds);
  const queueLimit = deadline(now, policy.max_queue_age_seconds);
  if (futureLimit === null || queueLimit === null) return quarantine("INVALID_EVIDENCE");
  const validated = await validateSignalEvidenceV1(t.evidenceBytes, r.bindingBytes);
  if (validated.status !== "VALIDATED" || validated.entries.length === 0) return quarantine("INVALID_EVIDENCE");
  const entries: AdmissionEntryDecision[] = [];
  const seen = new Set<string>(); const conflicts = new Set<string>();
  for (const entry of validated.entries) {
    const observedAt = entry.source_observation.observed_at_epoch;
    const triggerAt = entry.selected?.evidence.observed_trigger_epoch ?? null;
    if (!epoch(observedAt) || (entry.selected !== null && !epoch(triggerAt))) return quarantine("INVALID_EVIDENCE");
    const observationLimit = deadline(observedAt, policy.max_observation_age_seconds);
    const eventLimit = triggerAt === null ? r.activeUntil : deadline(triggerAt, policy.max_event_age_seconds);
    if (observationLimit === null || eventLimit === null) return quarantine("INVALID_EVIDENCE");
    if (observedAt > futureLimit || (triggerAt !== null && triggerAt > futureLimit)) return quarantine("FUTURE");
    const expiresAt = Math.min(observationLimit, eventLimit, queueLimit, r.activeUntil);
    if (now >= expiresAt) return quarantine("STALE");
    const key = entry.attempt_key; const attempt = snapshot.attempts[key];
    const fact = snapshot.evidenceFacts[entry.evidence_id]; const selection = selectionKey(entry);
    if (seen.has(key) || (fact !== undefined && (fact.attemptKey !== key || fact.evidenceHash !== entry.evidence_body_sha256))
      || (attempt !== undefined && (attempt.disputed || attempt.formationHash !== entry.formation_body_sha256
        || (attempt.evidenceId === entry.evidence_id && attempt.evidenceHash !== entry.evidence_body_sha256)
        || (triggerAt !== null && attempt.triggerEpoch !== null && (triggerAt < attempt.triggerEpoch || (triggerAt === attempt.triggerEpoch && selection !== attempt.selectionKey)))))) conflicts.add(key);
    seen.add(key);
    const action = entry.selected === null ? "NO_CANDIDATE" : attempt?.evidenceId != null ? "AUDIT_ONLY" : "NEW";
    entries.push({ entry, action, expiresAt: action === "NEW" ? expiresAt : null, selectionKey: selection });
  }
  if (conflicts.size > 0) return quarantine("ATTEMPT_CONFLICT", [...conflicts].sort());
  return { ...safety, kind: "COMMIT", entries };
}
