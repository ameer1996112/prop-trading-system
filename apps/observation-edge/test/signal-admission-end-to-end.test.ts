import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { handleSignalAdmission } from "../src/signal-admission-route-v1";
import { dispatchSignalAdmission } from "../src/signal-admission-outbox-v1";
import { installGeneration } from "../src/signal-admission-store-v1";
import { validateSignalEvidenceV1 } from "../src/signal-evidence-v1";
import { handleSignalEvidenceInbox } from "../../execution-edge/src/signal-evidence-inbox-v1";
import { createInboxDb } from "../../execution-edge/test/support/signal-evidence-inbox-d1-v1";
import { createAdmissionDb } from "./support/signal-admission-d1-v1";
import { fixture, encode } from "./support/signal-admission-fixture-v1";

const safety = { authority: "EVIDENCE_ONLY", execution_allowed: false } as const;

// Some source vectors request EDGE_DERIVED identities. Compare every semantic
// field independently while allowing only those documented identity rewrites.
function semanticObservation(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(semanticObservation);
  if (value === null || typeof value !== "object") return value;
  const derived = new Set(["candidate_id", "evidence_id", "payload_sha256", "selection_id",
    "candidate_ids_considered", "canonical_candidate_id", "canonical_evidence_id"]);
  return Object.fromEntries(Object.entries(value).filter(([key]) => !derived.has(key))
    .map(([key, entry]) => [key, semanticObservation(entry)]));
}

async function createAdmissionIntegration(caseId = "strict_long_boc_only") {
  const observation = await createAdmissionDb();
  let inbox: Awaited<ReturnType<typeof createInboxDb>>;
  try { inbox = await createInboxDb(); } catch (error) { await observation.dispose(); throw error; }
  try {
    const f = await fixture(caseId);
    const validated = await validateSignalEvidenceV1(f.transport.evidenceBytes, f.registration.bindingBytes);
    if (validated.status !== "VALIDATED" || !validated.entries[0]?.selected) throw new Error("invalid positive vector");
    const triggerEpoch = validated.entries[0].selected.evidence.observed_trigger_epoch;
    if (triggerEpoch === null) throw new Error("positive vector lacks trigger time");
    // Preserve semantic event times. This allowance is explicit fixture policy,
    // never a deployment default or operational freshness recommendation.
    const registration = { ...f.registration, freshness: { ...f.registration.freshness,
      max_event_age_seconds: f.now - triggerEpoch + 30 } };
    await observation.provision(registration);
    let now = f.now;
    const sent: string[] = [];
    const receiverStatuses: number[] = [];
    const admit = (request = f.request) => handleSignalAdmission(new Request("https://local.test/api/v1/signal-evidence", {
      method: "POST", headers: { "content-type": "application/json" }, body: encode(request),
    }), { DB: observation.db, SIGNAL_ADMISSION_ENABLED: "true" }, () => now);
    const localDeliveryCredential = "LOCAL_TEST_ONLY_E2E_DELIVERY";
    const receive = (body: string) => handleSignalEvidenceInbox(new Request("https://local.test/internal/signal-evidence-v1", {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${localDeliveryCredential}` }, body,
    }), { EXECUTION_DB: inbox.db, SIGNAL_EVIDENCE_INBOX_ENABLED: "true",
      SIGNAL_DELIVERY_SECRET_SHA256: createHash("sha256").update(localDeliveryCredential).digest("hex") }, now);
    const dispatch = (options: { loseAcknowledgment?: boolean; afterCommit?: () => Promise<void> } = {}) =>
      dispatchSignalAdmission(observation.db, async body => {
        sent.push(body);
        const response = await receive(body);
        receiverStatuses.push(response.status);
        if (response.ok) {
          await options.afterCommit?.();
          if (options.loseAcknowledgment) throw new Error("LOCAL_TEST_LOST_ACK_AFTER_COMMIT");
        }
        return response;
      }, () => now);
    return { observation, inbox, f, registration, sent, receiverStatuses, admit, receive, dispatch,
      advanceToRetry: async () => {
        const retryAt = await observation.db.prepare("SELECT next_attempt_at_epoch FROM signal_admission_v1_outbox WHERE status='RETRY'").first<number>("next_attempt_at_epoch");
        if (retryAt === null) throw new Error("missing retry");
        now = retryAt;
      },
      deliveryStatus: () => observation.db.prepare("SELECT status FROM signal_admission_v1_outbox").first<string>("status"),
      dispose: async () => { try { await inbox.dispose(); } finally { await observation.dispose(); } },
    };
  } catch (error) { await inbox.dispose(); await observation.dispose(); throw error; }
}

describe("signal admission across isolated observation and execution D1", () => {
  // Catches acknowledging a send without receiver persistence or retry creating
  // another candidate; sender call counts alone cannot prove either property.
  it("stores one candidate when the first acknowledgment is lost", async () => {
    const h = await createAdmissionIntegration();
    try {
      expect((await h.admit()).status).toBe(202);
      expect(await h.dispatch({ loseAcknowledgment: true })).toBe("RETRY");
      expect(await h.inbox.count()).toBe(1);
      await h.advanceToRetry();
      expect(await h.dispatch()).toBe("ACKNOWLEDGED");
      expect(await h.inbox.count()).toBe(1);
      expect(await h.deliveryStatus()).toBe("ACKNOWLEDGED");
      expect(h.receiverStatuses).toEqual([201, 200]);
      expect(h.sent[1]).toBe(h.sent[0]);
    } finally { await h.dispose(); }
  });

  // Catches model/direction loss, altered chronology/fidelity, or cross-service
  // byte disagreement along the production route, queue and decoder boundary.
  it.each([
    ["strict_long_boc_only", "BOC", "LONG"], ["strict_short_boc_only", "BOC", "SHORT"],
    ["close_fallback_after_blocked_aggressive_models", "DIR_CLOSE", "LONG"],
    ["close_fallback_after_blocked_aggressive_models_short", "DIR_CLOSE", "SHORT"],
    ["flip_before_boc", "HTF_FLIP", "LONG"], ["flip_before_boc_short", "HTF_FLIP", "SHORT"],
  ])("delivers %s with unchanged selected evidence", async (caseId, model, direction) => {
    const h = await createAdmissionIntegration(caseId);
    try {
      const response = await h.admit();
      expect(response.status).toBe(202);
      expect(await response.json()).toMatchObject({ ...safety, outcome: "ACCEPTED", duplicate: false });
      expect(await h.observation.count("receipts")).toBe(1);
      expect(await h.observation.count("attempts")).toBe(1);
      expect(await h.observation.count("outbox")).toBe(1);
      expect(await h.dispatch()).toBe("ACKNOWLEDGED");
      expect(await h.inbox.count()).toBe(1);
      const row = await h.inbox.db.prepare("SELECT body,authority,execution_allowed FROM signal_evidence_inbox_v1").first<{ body: string; authority: string; execution_allowed: number }>();
      expect(row).toMatchObject({ authority: "EVIDENCE_ONLY", execution_allowed: 0 });
      expect(row!.body).toBe(h.sent[0]);
      const delivered = JSON.parse(row!.body);
      expect(delivered).toMatchObject(safety);
      expect(delivered.evidence).toMatchObject({ ...safety, selected: { candidate: { model, direction } } });
      expect(semanticObservation(delivered.evidence.source_observation)).toEqual(semanticObservation(h.f.input.observation));
      const storedEvidence = await h.observation.db.prepare("SELECT body FROM signal_admission_v1_evidence").first<string>("body");
      expect(delivered.evidence).toEqual(JSON.parse(storedEvidence!));
      expect(row!.body).not.toContain(h.f.request.credential);
    } finally { await h.dispose(); }
  });

  it("replays an authenticated duplicate without another reservation or delivery", async () => {
    const h = await createAdmissionIntegration();
    try {
      const first = await (await h.admit()).json();
      expect(await h.dispatch()).toBe("ACKNOWLEDGED");
      const replay = await h.admit();
      expect(replay.status).toBe(200);
      expect(await replay.json()).toEqual({ ...first as object, duplicate: true });
      expect(await h.observation.count("receipts")).toBe(1);
      expect(await h.observation.count("attempts")).toBe(1);
      expect(await h.observation.count("outbox")).toBe(1);
      expect(await h.dispatch()).toBe("EMPTY");
      expect(await h.inbox.count()).toBe(1);
    } finally { await h.dispose(); }
  });

  it("quarantines a body conflict while the same attempt in another namespace delivers", async () => {
    const h = await createAdmissionIntegration();
    try {
      const binding = JSON.parse(new TextDecoder().decode(h.registration.bindingBytes));
      binding.producer_namespace = "other-e2e-namespace";
      const scope = JSON.parse(h.registration.scopeKey); scope.producer_namespace = binding.producer_namespace;
      const other = { ...h.registration, registrationId: "other-e2e-registration", scopeKey: JSON.stringify(scope), bindingBytes: encode(binding) };
      await h.observation.provision(other);
      expect((await h.admit()).status).toBe(202);
      expect((await h.admit({ ...h.f.request, registration_id: other.registrationId })).status).toBe(202);
      const attempts = (await h.observation.db.prepare("SELECT namespace,attempt_key FROM signal_admission_v1_attempts").all<{ namespace: string; attempt_key: string }>()).results;
      expect(attempts).toHaveLength(2);
      expect(attempts[0]!.attempt_key).toBe(attempts[1]!.attempt_key);
      expect(attempts[0]!.namespace).not.toBe(attempts[1]!.namespace);
      const conflict = structuredClone(h.f.request); conflict.evidence.observation.observed_at_epoch++;
      const response = await h.admit(conflict);
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ ...safety, code: "BODY_CONFLICT", stream_state: "QUARANTINED" });
      for (let i = 0; i < 2; i++) await h.dispatch();
      const states = (await h.observation.db.prepare("SELECT status FROM signal_admission_v1_outbox").all<{ status: string }>()).results.map(row => row.status).sort();
      expect(states).toEqual(["ACKNOWLEDGED", "QUARANTINED"]);
      expect(await h.inbox.count()).toBe(1);
      const body = await h.inbox.db.prepare("SELECT body FROM signal_evidence_inbox_v1").first<string>("body");
      expect(JSON.parse(body!).evidence.reviewed_binding.producer_namespace).toBe("other-e2e-namespace");
      expect(await h.observation.count("attempts")).toBe(2);
    } finally { await h.dispose(); }
  });

  it("authenticates before exact replay after credential rejection and generation retirement", async () => {
    const h = await createAdmissionIntegration();
    try {
      expect((await h.admit()).status).toBe(202);
      const original = await h.observation.db.prepare("SELECT * FROM signal_admission_v1_receipts").all();
      const denied = await h.admit({ ...h.f.request, credential: "LOCAL_TEST_WRONG_CREDENTIAL" });
      expect(denied.status).toBe(401);
      expect(await denied.json()).toMatchObject({ ...safety, receipt_id: null, stream_state: null });
      expect(await h.observation.db.prepare("SELECT state FROM signal_admission_v1_streams").first("state")).toBe("ACTIVE");
      await installGeneration(h.observation.db, 1, { ...h.registration, generation: 2, revision: 2 }, "LOCAL_TEST_RETIREMENT");
      const retiredReplay = await h.admit();
      expect(retiredReplay.status).toBe(401);
      expect(await retiredReplay.json()).toMatchObject({ ...safety, receipt_id: null, stream_state: null });
      expect((await h.observation.db.prepare("SELECT * FROM signal_admission_v1_receipts").all()).results).toEqual(original.results);
      expect(await h.observation.db.prepare("SELECT state FROM signal_admission_v1_streams WHERE generation=1").first("state")).toBe("RETIRED");
      expect(await h.observation.count("attempts")).toBe(1);
      await h.dispatch();
      expect(await h.inbox.count()).toBe(0);
      expect(await h.deliveryStatus()).toBe("QUARANTINED");
    } finally { await h.dispose(); }
  });

  it("retains historical evidence only after quarantine races the receiver commit", async () => {
    const h = await createAdmissionIntegration();
    try {
      expect((await h.admit()).status).toBe(202);
      expect(await h.dispatch({ afterCommit: async () => {
        expect(await h.inbox.count()).toBe(1);
        const conflict = structuredClone(h.f.request); conflict.evidence.observation.observed_at_epoch++;
        expect((await h.admit(conflict)).status).toBe(409);
      } })).toBe("QUARANTINED");
      expect(await h.deliveryStatus()).toBe("QUARANTINED");
      expect(await h.inbox.count()).toBe(1);
      const row = await h.inbox.db.prepare("SELECT * FROM signal_evidence_inbox_v1").first();
      expect(row).toMatchObject({ authority: "EVIDENCE_ONLY", execution_allowed: 0 });
      expect(JSON.parse(String(row!.body))).toMatchObject(safety);
      const duplicate = await h.receive(h.sent[0]!);
      expect(duplicate.status).toBe(200);
      expect(await duplicate.json()).toMatchObject({ ...safety, status: "DUPLICATE" });
      expect(await h.inbox.count()).toBe(1);
      expect(await h.observation.count("attempts")).toBe(1);
      expect(await h.dispatch()).toBe("EMPTY");
    } finally { await h.dispose(); }
  });
});
