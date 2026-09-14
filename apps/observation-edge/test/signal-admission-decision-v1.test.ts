import { describe, expect, it } from "vitest";
import { evaluateAdmission } from "../src/signal-admission-decision-v1";
import { fixture } from "./support/signal-admission-fixture-v1";
import { encode } from "./support/signal-admission-fixture-v1";
import { parseAdmissionTransport } from "../src/signal-admission-wire-v1";
import { validateSignalEvidenceV1 } from "../src/signal-evidence-v1";

async function eligible(caseId?: string) {
  const f = await fixture(caseId);
  const validated = await validateSignalEvidenceV1(f.transport.evidenceBytes, f.registration.bindingBytes);
  if (validated.status !== "VALIDATED") throw new Error("invalid fixture");
  const trigger = validated.entries[0]!.selected?.evidence.observed_trigger_epoch ?? f.now;
  // Existing literal vectors intentionally contain old event times. This explicit
  // test policy override preserves all proof chronology; it is never a default.
  f.registration = { ...f.registration, freshness: { ...f.registration.freshness, max_event_age_seconds: f.now - trigger + 30 } };
  return f;
}
async function run(f: Awaited<ReturnType<typeof fixture>>) { return evaluateAdmission(f.transport, f.registration, f.snapshot, f.now); }
function deriveBocIds(f: Awaited<ReturnType<typeof fixture>>) {
  for (const bundle of f.input.observation.setups) {
    bundle.candidates[0].candidate_id = "EDGE_DERIVED:BOC";
    Object.assign(bundle.evidence[0], { candidate_id: "EDGE_DERIVED:BOC", evidence_id: "EDGE_DERIVED:BOC", payload_sha256: "EDGE_DERIVED" });
    Object.assign(bundle.selection_proposal, { selection_id: "EDGE_DERIVED", candidate_ids_considered: ["EDGE_DERIVED:BOC"], canonical_candidate_id: "EDGE_DERIVED:BOC", canonical_evidence_id: "EDGE_DERIVED:BOC" });
  }
}
async function reserve(f: Awaited<ReturnType<typeof fixture>>) {
  const d = await run(f);
  if (d.kind !== "COMMIT") throw new Error(JSON.stringify(d));
  const e = d.entries[0]!;
  f.snapshot.attempts[e.entry.attempt_key] = { formationHash: e.entry.formation_body_sha256, evidenceId: e.entry.selected ? e.entry.evidence_id : null, evidenceHash: e.entry.selected ? e.entry.evidence_body_sha256 : null, triggerEpoch: e.entry.selected?.evidence.observed_trigger_epoch ?? null, selectionKey: e.selectionKey, disputed: false };
  f.snapshot.evidenceFacts[e.entry.evidence_id] = { attemptKey: e.entry.attempt_key, evidenceHash: e.entry.evidence_body_sha256 };
  return e;
}

describe("durable admission decisions", () => {
  it("quarantines a missing message before considering candidate content", async () => {
    const f = await fixture();
    f.snapshot.nextSequence = f.transport.sequence + 1;
    expect(await evaluateAdmission(f.transport, f.registration, f.snapshot, f.now)).toMatchObject({ kind: "QUARANTINE", code: "UNKNOWN_OLD_SEQUENCE" });
  });
  it.each([
    ["strict_long_boc_only", "BOC", "LONG"], ["strict_short_boc_only", "BOC", "SHORT"],
    ["close_fallback_after_blocked_aggressive_models", "DIR_CLOSE", "LONG"],
    ["close_fallback_after_blocked_aggressive_models_short", "DIR_CLOSE", "SHORT"],
    ["flip_before_boc", "HTF_FLIP", "LONG"], ["flip_before_boc_short", "HTF_FLIP", "SHORT"],
  ])("admits %s with unchanged proof", async (id, model, direction) => {
    const f = await eligible(id); const d = await run(f);
    expect(d).toMatchObject({ kind: "COMMIT", authority: "EVIDENCE_ONLY", execution_allowed: false, entries: [{ action: "NEW", expiresAt: f.now + 20, entry: { selected: { candidate: { model, direction } } } }] });
  });
  it("preserves fixture policy and fails loudly for missing cases", async () => {
    const f = await fixture(); expect(f.registration.freshness.max_event_age_seconds).toBe(30);
    expect(await run(f)).toMatchObject({ kind: "QUARANTINE", code: "STALE" });
    await expect(fixture("missing")).rejects.toThrow("missing signal evidence fixture");
  });
  it("uses validator co-trigger arbitration", async () => {
    const f = await eligible("boc_flip_same_event");
    expect(await run(f)).toMatchObject({ kind: "COMMIT", entries: [{ action: "NEW", entry: { selected: { candidate: { model: "HTF_FLIP" } } } }] });
  });
  it.each(["ACTIVE", "QUARANTINED", "RETIRED"] as const)("returns immutable prior receipt after expiry in %s", async state => {
    const f = await fixture(); f.snapshot.state = state; f.now += 500;
    f.snapshot.existingReceipt = { id: "prior", bodySha256: f.transport.bodySha256, outcome: "REJECTED", code: "STALE" };
    f.transport = { ...f.transport, evidenceBytes: encode({ invalid: true }) };
    expect(await run(f)).toMatchObject({ kind: "DUPLICATE", receipt: f.snapshot.existingReceipt, streamState: state });
  });
  it("prior identity conflict precedes blocked stream", async () => {
    const f = await fixture(); f.snapshot.state = "QUARANTINED";
    f.snapshot.existingReceipt = { id: "prior", bodySha256: "0".repeat(64), outcome: "ACCEPTED", code: null };
    expect(await run(f)).toMatchObject({ kind: "QUARANTINE", code: "BODY_CONFLICT" });
  });
  it.each(["QUARANTINED", "RETIRED"] as const)("blocks %s stream", async state => {
    const f = await fixture(); f.snapshot.state = state;
    expect(await run(f)).toMatchObject({ kind: "BLOCKED", code: "STREAM_BLOCKED" });
  });
  it("blocks registry revision mismatch", async () => { const f = await fixture(); f.snapshot.revision++;
    expect(await run(f)).toMatchObject({ kind: "BLOCKED", code: "STREAM_BLOCKED" }); });
  it("quarantines gaps before validation", async () => {
    const f = await fixture(); f.transport = { ...f.transport, sequence: 2, evidenceBytes: encode({}) };
    expect(await run(f)).toMatchObject({ kind: "QUARANTINE", code: "SEQUENCE_GAP" });
  });
  it.each([Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1, 0])("rejects unusable sequence %s", async sequence => {
    const f = await eligible(); f.transport = { ...f.transport, sequence }; f.snapshot.nextSequence = sequence;
    expect(await run(f)).toMatchObject({ kind: "QUARANTINE", code: "INVALID_EVIDENCE" });
  });
  it("rejects clock regression", async () => { const f = await eligible(); f.snapshot.lastAcceptedAt = f.now + 1;
    expect(await run(f)).toMatchObject({ kind: "QUARANTINE", code: "CLOCK_REGRESSION" }); });
  it.each([NaN, -1, Number.MAX_SAFE_INTEGER])("rejects unsafe server arithmetic %s", async now => { const f = await eligible(); f.now = now;
    expect(await run(f)).toMatchObject({ kind: "QUARANTINE", code: "INVALID_EVIDENCE" }); });
  it.each([29, 30])("enforces observation/event stale equality %s", async age => {
    const f = await eligible(); f.now += age;
    expect(await run(f)).toMatchObject(age === 29 ? { kind: "COMMIT", entries: [{ expiresAt: f.now + 1 }] } : { kind: "QUARANTINE", code: "STALE" });
  });
  it.each([2, 3])("enforces observation future-skew equality %s", async skew => {
    const f = await eligible(); f.now -= skew;
    expect(await run(f)).toMatchObject(skew === 2 ? { kind: "COMMIT" } : { kind: "QUARANTINE", code: "FUTURE" });
  });
  it("caps expiry by registration", async () => { const f = await eligible(); f.registration = { ...f.registration, activeUntil: f.now + 5 };
    expect(await run(f)).toMatchObject({ kind: "COMMIT", entries: [{ expiresAt: f.now + 5 }] }); });
  it("retains no-candidate formation without reserving, then admits selection", async () => {
    const f = await eligible("same_event_price_conflict"); const e = await reserve(f);
    expect(e).toMatchObject({ action: "NO_CANDIDATE", expiresAt: null, selectionKey: null });
    const selected = await eligible(); selected.snapshot = f.snapshot;
    selected.request.evidence.observation.producer_sequence = 2; selected.request.evidence.observation.event_id = "pine-evidence-v1:2";
    selected.transport = await parseAdmissionTransport(encode(selected.request)); selected.snapshot.nextSequence = 2;
    expect(await run(selected)).toMatchObject({ kind: "COMMIT", entries: [{ action: "NEW" }] });
  });
  it("never creates a second reservation across generations", async () => {
    const f = await eligible(); await reserve(f); f.request.generation = 2;
    f.transport = await parseAdmissionTransport(encode(f.request)); f.registration = { ...f.registration, generation: 2 };
    expect(await run(f)).toMatchObject({ kind: "COMMIT", entries: [{ action: "AUDIT_ONLY", expiresAt: null }] });
  });
  it.each(["formation", "identity", "earlier", "same-time-selection", "disputed"])("quarantines %s attempt conflicts", async conflict => {
    const f = await eligible(); const e = await reserve(f); const prior = f.snapshot.attempts[e.entry.attempt_key]!;
    if (conflict === "formation") prior.formationHash = "0".repeat(64);
    if (conflict === "identity") f.snapshot.evidenceFacts[e.entry.evidence_id]!.evidenceHash = "0".repeat(64);
    if (conflict === "earlier") prior.triggerEpoch! += 1;
    if (conflict === "same-time-selection") prior.selectionKey = "different";
    if (conflict === "disputed") prior.disputed = true;
    expect(await run(f)).toMatchObject({ kind: "QUARANTINE", code: "ATTEMPT_CONFLICT", disputedAttemptKeys: [e.entry.attempt_key] });
  });
  it("consistent later evidence is audit only", async () => {
    const f = await eligible(); const e = await reserve(f); f.snapshot.attempts[e.entry.attempt_key]!.triggerEpoch! -= 1;
    expect(await run(f)).toMatchObject({ kind: "COMMIT", entries: [{ action: "AUDIT_ONLY", expiresAt: null }] });
  });
  it("rejects ambiguous same-envelope attempts atomically", async () => {
    const f = await eligible(); const copy = structuredClone(f.input.observation.setups[0]);
    copy.setup.setup_id = "another-setup";
    copy.candidates[0].setup_id = copy.setup.setup_id;
    copy.selection_proposal.setup_id = copy.setup.setup_id;
    f.input.observation.setups.push(copy); f.input.formations.push({ ...f.input.formations[0], setup_id: "another-setup" });
    deriveBocIds(f);
    f.transport = await parseAdmissionTransport(encode(f.request));
    expect(await validateSignalEvidenceV1(f.transport.evidenceBytes, f.registration.bindingBytes)).toEqual({ status: "REJECTED", code: "INVALID_FORMATION" });
    expect(await run(f)).toMatchObject({ kind: "QUARANTINE", code: "INVALID_EVIDENCE" });
  });
  it.each(["missing-observation", "unsafe-observation", "missing-trigger"])("rejects %s", async mode => {
    const f = await eligible();
    if (mode === "missing-observation") delete f.input.observation.observed_at_epoch;
    if (mode === "unsafe-observation") f.input.observation.observed_at_epoch = Number.MAX_SAFE_INTEGER + 1;
    if (mode === "missing-trigger") f.input.observation.setups[0].evidence[0].observed_trigger_epoch = null;
    // Invalid inner bytes intentionally bypass the already-tested outer parser.
    f.transport = { ...f.transport, evidenceBytes: encode(f.input) };
    expect(await run(f)).toMatchObject({ kind: "QUARANTINE", code: "INVALID_EVIDENCE" });
  });
  it("rejects trigger chronology beyond observation before freshness", async () => {
    const f = await eligible(); f.input.observation.setups[0].evidence[0].observed_trigger_epoch = f.now + 3;
    f.transport = await parseAdmissionTransport(encode(f.request));
    expect(await run(f)).toMatchObject({ kind: "QUARANTINE", code: "INVALID_EVIDENCE" });
  });
  it("detects changed formation before any reservation", async () => {
    const f = await eligible("same_event_price_conflict"); const e = await reserve(f);
    f.snapshot.attempts[e.entry.attempt_key]!.formationHash = "0".repeat(64);
    expect(await run(f)).toMatchObject({ kind: "QUARANTINE", code: "ATTEMPT_CONFLICT", disputedAttemptKeys: [e.entry.attempt_key] });
  });
  it("does not mutate snapshot or validated transport", async () => {
    const f = await eligible(); const before = structuredClone({ snapshot: f.snapshot, bytes: f.transport.evidenceBytes });
    await run(f); expect(f.snapshot).toEqual(before.snapshot); expect(f.transport.evidenceBytes).toEqual(before.bytes);
  });
  it("admits fresh BOC using the exact default 30/30/2/20 policy", async () => {
    const f = await fixture(); deriveBocIds(f);
    // Reconstruct a valid observation immediately after the unchanged HTF-timed
    // trigger. Refresh every observation/coverage claim and derive new digests.
    f.now = 1802; f.input.observation.observed_at_epoch = f.now;
    const bundle = f.input.observation.setups[0];
    bundle.candidates[0].observed_at_epoch = f.now;
    bundle.evidence[0].observed_at_epoch = f.now;
    bundle.evidence[0].coverage_end_epoch = f.now;
    bundle.selection_proposal.evaluated_at_epoch = f.now;
    f.transport = await parseAdmissionTransport(encode(f.request));
    expect(await run(f)).toMatchObject({ kind: "COMMIT", entries: [{ action: "NEW", expiresAt: f.now + 20 }] });
  });
});
