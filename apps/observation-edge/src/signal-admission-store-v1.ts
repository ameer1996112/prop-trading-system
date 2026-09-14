import { admissionFactKeys, evaluateAdmission, type AdmissionSnapshot, type AttemptFact } from "./signal-admission-decision-v1";
import { readRegistration, type Registration } from "./signal-admission-registration-v1";
import type { AdmissionCode, ReceiptOutcome, Safety, StreamState, Transport } from "./signal-admission-wire-v1";

export type AdmissionResult = Safety & {
  schema_version: "TradeOpsSignalAdmissionResponseV1"; receipt_id: string | null;
  outcome: ReceiptOutcome; code: AdmissionCode | null; duplicate: boolean; stream_state: StreamState;
};
export class AdmissionUnavailableError extends Error {
  constructor() { super("signal admission unavailable"); this.name = "AdmissionUnavailableError"; }
}
const P = "signal_admission_v1_";
const safety = { authority: "EVIDENCE_ONLY", execution_allowed: false } as const;
const encoder = new TextEncoder();
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
async function hash(value: unknown): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(canonical(value)))), b => b.toString(16).padStart(2, "0")).join("");
}
function registrationJson(r: Registration): string {
  return canonical({ schema_version: "TradeOpsSignalAdmissionRegistrationV1", registration_id: r.registrationId,
    generation: r.generation, revision: r.revision, scope_key: r.scopeKey, producer_instance_id: r.producerInstanceId,
    credential_sha256: r.credentialSha256, reviewed_binding: JSON.parse(new TextDecoder().decode(r.bindingBytes)),
    active_from: r.activeFrom, active_until: r.activeUntil, enabled: r.enabled, freshness: r.freshness });
}
type Snapshot = AdmissionSnapshot & { casRevision: number; namespace: string; registration: Registration; factKeys: readonly { attemptKey: string; evidenceId: string }[] };
const attemptColumns = "formation_hash AS formationHash,evidence_id AS evidenceId,evidence_hash AS evidenceHash,trigger_epoch AS triggerEpoch,selection_key AS selectionKey,disputed";
async function snapshot(db: D1Database, t: Transport): Promise<Snapshot> {
  const row = await db.prepare(`SELECT s.state,s.revision AS casRevision,s.registry_revision AS revision,s.next_sequence AS nextSequence,s.last_accepted_at AS lastAcceptedAt,r.namespace,r.registration_json FROM ${P}streams s JOIN ${P}registrations r USING(registration_id) WHERE s.registration_id=? AND s.generation=?`).bind(t.registrationId, t.generation).first<{
    state: StreamState; casRevision: number; revision: number; nextSequence: number; lastAcceptedAt: number | null; namespace: string; registration_json: string;
  }>();
  if (!row) throw new AdmissionUnavailableError();
  const registration = readRegistration(encoder.encode(row.registration_json));
  if (!registration) throw new AdmissionUnavailableError();
  const existingReceipt = await db.prepare(`SELECT receipt_id AS id,body_sha256 AS bodySha256,outcome,code FROM ${P}receipts WHERE registration_id=? AND generation=? AND sequence=?`).bind(t.registrationId, t.generation, t.sequence).first<NonNullable<AdmissionSnapshot["existingReceipt"]>>();
  const attempts: Snapshot["attempts"] = Object.create(null);
  const evidenceFacts: Snapshot["evidenceFacts"] = Object.create(null);
  let factKeys: Snapshot["factKeys"] = [];
  if (!existingReceipt && row.state === "ACTIVE") {
    const keys = await admissionFactKeys(t, registration.bindingBytes);
    factKeys = keys;
    for (const { attemptKey, evidenceId } of keys) {
      const attempt = await db.prepare(`SELECT ${attemptColumns} FROM ${P}attempts WHERE namespace=? AND attempt_key=?`).bind(row.namespace, attemptKey).first<Omit<AttemptFact, "disputed"> & { disputed: number }>();
      if (attempt) attempts[attemptKey] = { ...attempt, disputed: attempt.disputed === 1 };
      const evidence = await db.prepare(`SELECT attempt_key AS attemptKey,evidence_hash AS evidenceHash FROM ${P}evidence WHERE namespace=? AND evidence_id=?`).bind(row.namespace, evidenceId).first<{ attemptKey: string; evidenceHash: string }>();
      if (evidence) evidenceFacts[evidenceId] = evidence;
    }
  }
  return { state: row.state, revision: row.revision, casRevision: row.casRevision, nextSequence: row.nextSequence,
    lastAcceptedAt: row.lastAcceptedAt, namespace: row.namespace, registration, existingReceipt, attempts, evidenceFacts, factKeys };
}
export async function loadAdmissionSnapshot(db: D1Database, t: Transport): Promise<AdmissionSnapshot> {
  try {
    const { state, revision, nextSequence, lastAcceptedAt, existingReceipt, attempts, evidenceFacts } = await snapshot(db, t);
    return { state, revision, nextSequence, lastAcceptedAt, existingReceipt, attempts, evidenceFacts };
  } catch { throw new AdmissionUnavailableError(); }
}
function response(outcome: ReceiptOutcome, code: AdmissionCode | null, receiptId: string | null, duplicate: boolean, state: StreamState): AdmissionResult {
  return { schema_version: "TradeOpsSignalAdmissionResponseV1", ...safety, receipt_id: receiptId, outcome, code, duplicate, stream_state: state };
}
function contention(error: unknown): boolean { return String(error).includes("CHECK constraint failed: signal_admission_v1_cas"); }

/** Caller authenticates transport before entering this persistence boundary. */
export async function admitSignal(db: D1Database, t: Transport, r: Registration, now: number): Promise<AdmissionResult> {
  for (let retry = 0; retry < 3; retry += 1) {
    try {
      const s = await snapshot(db, t);
      const decision = await evaluateAdmission(t, r, s, now);
      if (decision.kind === "DUPLICATE") return response(decision.receipt.outcome, decision.receipt.code, decision.receipt.id, true, decision.streamState);
      if (decision.kind === "BLOCKED" || r.revision !== s.registration.revision || r.generation !== s.registration.generation
        || registrationJson(r) !== registrationJson(s.registration)) return response("REJECTED", "STREAM_BLOCKED", null, false, s.state);
      if (s.state !== "ACTIVE") return response("REJECTED", decision.kind === "QUARANTINE" ? decision.code : "STREAM_BLOCKED", null, false, s.state);
      const statements: D1PreparedStatement[] = [];
      const tokens: string[] = [];
      const sql = (query: string, ...values: (string | number | null)[]) => db.prepare(query).bind(...values);
      const guard = (condition: string, ...values: (string | number | null)[]) => {
        const token = crypto.randomUUID(); tokens.push(token);
        statements.push(sql(`INSERT INTO ${P}guards(token,ok) SELECT ?,CASE WHEN ${condition} THEN 1 ELSE 0 END`, token, ...values));
      };
      guard(`EXISTS(SELECT 1 FROM ${P}streams s JOIN ${P}registrations r USING(registration_id) WHERE s.registration_id=? AND s.generation=? AND s.revision=? AND s.registry_revision=? AND s.next_sequence=? AND s.state='ACTIVE' AND r.revision=? AND r.active_generation=s.generation AND r.enabled=1 AND r.namespace=? AND r.registration_json=?)`, t.registrationId, t.generation, s.casRevision, r.revision, s.nextSequence, r.revision, s.namespace, registrationJson(r));
      const receiptId = await hash({ schema_version: "TradeOpsSignalReceiptIdentityV1", registration_id: t.registrationId, generation: t.generation, sequence: t.sequence });
      guard(s.existingReceipt
        ? `EXISTS(SELECT 1 FROM ${P}receipts WHERE registration_id=? AND generation=? AND sequence=? AND body_sha256=?)`
        : `NOT EXISTS(SELECT 1 FROM ${P}receipts WHERE registration_id=? AND generation=? AND sequence=?)`, t.registrationId, t.generation, t.sequence, ...(s.existingReceipt ? [s.existingReceipt.bodySha256] : []));
      const insertReceipt = (outcome: ReceiptOutcome, code: AdmissionCode | null) => statements.push(sql(`INSERT INTO ${P}receipts(registration_id,generation,sequence,receipt_id,body_sha256,outcome,code,admitted_at) VALUES(?,?,?,?,?,?,?,?)`, t.registrationId, t.generation, t.sequence, receiptId, t.bodySha256, outcome, code, now));
      for (const { attemptKey, evidenceId } of s.factKeys) {
        const a = s.attempts[attemptKey];
        guard(a ? `EXISTS(SELECT 1 FROM ${P}attempts WHERE namespace=? AND attempt_key=? AND formation_hash=? AND evidence_id IS ? AND evidence_hash IS ? AND trigger_epoch IS ? AND selection_key IS ? AND disputed=?)`
          : `NOT EXISTS(SELECT 1 FROM ${P}attempts WHERE namespace=? AND attempt_key=?)`, s.namespace, attemptKey, ...(a ? [a.formationHash, a.evidenceId, a.evidenceHash, a.triggerEpoch, a.selectionKey, a.disputed ? 1 : 0] : []));
        const e = s.evidenceFacts[evidenceId];
        guard(e ? `EXISTS(SELECT 1 FROM ${P}evidence WHERE namespace=? AND evidence_id=? AND attempt_key=? AND evidence_hash=?)`
          : `NOT EXISTS(SELECT 1 FROM ${P}evidence WHERE evidence_id=?)`, ...(e ? [s.namespace, evidenceId, e.attemptKey, e.evidenceHash] : [evidenceId]));
      }
      let result: AdmissionResult;
      if (decision.kind === "QUARANTINE") {
        if (!s.existingReceipt) insertReceipt("REJECTED", decision.code);
        statements.push(sql(`INSERT INTO ${P}audit(audit_id,registration_id,generation,sequence,body_sha256,reason,authority,execution_allowed) VALUES(?,?,?,?,?,?,'EVIDENCE_ONLY',0)`, crypto.randomUUID(), t.registrationId, t.generation, t.sequence, t.bodySha256, decision.code));
        for (const key of decision.disputedAttemptKeys) statements.push(sql(`UPDATE ${P}attempts SET disputed=1 WHERE namespace=? AND attempt_key=?`, s.namespace, key));
        if (decision.code === "BODY_CONFLICT") statements.push(sql(`UPDATE ${P}attempts SET disputed=1 WHERE namespace=? AND attempt_key IN (SELECT attempt_key FROM ${P}receipt_evidence WHERE namespace=? AND receipt_id=?)`, s.namespace, s.namespace, receiptId));
        statements.push(sql(`UPDATE ${P}outbox SET status='QUARANTINED',claim_token=NULL,lease_until_epoch=NULL WHERE namespace=? AND status IN ('PENDING','RETRY','CLAIMED') AND registration_id=? AND generation=?`, s.namespace, t.registrationId, t.generation));
        for (const key of decision.disputedAttemptKeys) statements.push(sql(`UPDATE ${P}outbox SET status='QUARANTINED',claim_token=NULL,lease_until_epoch=NULL WHERE namespace=? AND attempt_key=? AND status IN ('PENDING','RETRY','CLAIMED')`, s.namespace, key));
        if (decision.code === "BODY_CONFLICT") statements.push(sql(`UPDATE ${P}outbox SET status='QUARANTINED',claim_token=NULL,lease_until_epoch=NULL WHERE namespace=? AND attempt_key IN (SELECT attempt_key FROM ${P}receipt_evidence WHERE namespace=? AND receipt_id=?) AND status IN ('PENDING','RETRY','CLAIMED')`, s.namespace, s.namespace, receiptId));
        statements.push(sql(`UPDATE ${P}streams SET state='QUARANTINED',reason=?,revision=revision+1 WHERE registration_id=? AND generation=?`, decision.code, t.registrationId, t.generation));
        result = response("REJECTED", decision.code, s.existingReceipt?.id ?? receiptId, false, "QUARANTINED");
      } else {
        const outcome = decision.entries.some(e => e.action === "NEW") ? "ACCEPTED" : decision.entries.some(e => e.action === "AUDIT_ONLY") ? "AUDIT_ONLY" : "NO_CANDIDATE";
        insertReceipt(outcome, null);
        for (const { entry, action, expiresAt, selectionKey } of decision.entries) {
          if (!s.evidenceFacts[entry.evidence_id]) statements.push(sql(`INSERT INTO ${P}evidence(evidence_id,namespace,attempt_key,evidence_hash,receipt_id,body,authority,execution_allowed) VALUES(?,?,?,?,?,?,'EVIDENCE_ONLY',0)`, entry.evidence_id, s.namespace, entry.attempt_key, entry.evidence_body_sha256, receiptId, canonical(entry)));
          if (!s.attempts[entry.attempt_key]) statements.push(sql(`INSERT INTO ${P}attempts(namespace,attempt_key,formation_hash) VALUES(?,?,?)`, s.namespace, entry.attempt_key, entry.formation_body_sha256));
          statements.push(sql(`INSERT INTO ${P}receipt_evidence(receipt_id,evidence_id,namespace,attempt_key) VALUES(?,?,?,?)`, receiptId, entry.evidence_id, s.namespace, entry.attempt_key));
          guard("changes()=1");
          if (action === "NEW") {
            statements.push(sql(`UPDATE ${P}attempts SET evidence_id=?,evidence_hash=?,trigger_epoch=?,selection_key=? WHERE namespace=? AND attempt_key=? AND evidence_id IS NULL AND disputed=0`, entry.evidence_id, entry.evidence_body_sha256, entry.selected!.evidence.observed_trigger_epoch!, selectionKey, s.namespace, entry.attempt_key));
            guard("changes()=1");
            const deliveryId = await hash({ schema_version: "TradeOpsSignalDeliveryIdentityV1", attempt_key: entry.attempt_key, evidence_id: entry.evidence_id });
            const body = { schema_version: "TradeOpsSignalDeliveryV1", ...safety, delivery_id: deliveryId, receipt_id: receiptId,
              registration_id: t.registrationId, generation: t.generation, attempt_key: entry.attempt_key, evidence_id: entry.evidence_id,
              evidence_body_sha256: entry.evidence_body_sha256, admitted_at_epoch: now, expires_at_epoch: expiresAt!, evidence: entry };
            const digest = await hash(body);
            statements.push(sql(`INSERT INTO ${P}outbox(delivery_id,namespace,attempt_key,registration_id,generation,receipt_id,evidence_id,delivery_body_sha256,body,admitted_at_epoch,expires_at_epoch,status,next_attempt_at_epoch,authority,execution_allowed) VALUES(?,?,?,?,?,?,?,?,?,?,?,'PENDING',?,'EVIDENCE_ONLY',0)`, deliveryId, s.namespace, entry.attempt_key, t.registrationId, t.generation, receiptId, entry.evidence_id, digest, canonical({ ...body, delivery_body_sha256: digest }), now, expiresAt!, now));
          }
        }
        statements.push(sql(`UPDATE ${P}streams SET next_sequence=next_sequence+1,revision=revision+1,last_accepted_at=? WHERE registration_id=? AND generation=? AND revision=?`, now, t.registrationId, t.generation, s.casRevision));
        result = response(outcome, null, receiptId, false, "ACTIVE");
      }
      guard("changes()=1");
      for (const token of tokens) statements.push(sql(`DELETE FROM ${P}guards WHERE token=?`, token));
      await db.batch(statements);
      return result;
    } catch (error) { if (!contention(error) || retry === 2) throw new AdmissionUnavailableError(); }
  }
  throw new AdmissionUnavailableError();
}

/** Internal provisioning only. previousRevision=0 bootstraps a new registration. */
export async function installGeneration(db: D1Database, previousRevision: number, nextRegistration: Registration, reason: string): Promise<void> {
  try {
    const json = registrationJson(nextRegistration);
    const r = readRegistration(encoder.encode(json));
    if (!r || !Number.isSafeInteger(previousRevision) || previousRevision < 0 || r.revision !== previousRevision + 1 || !reason || reason.length > 160) throw new AdmissionUnavailableError();
    const namespace = JSON.parse(r.scopeKey).producer_namespace as string;
    const token = crypto.randomUUID(); const q = (sql: string, ...args: (string | number)[]) => db.prepare(sql).bind(...args);
    const statements: D1PreparedStatement[] = [];
    if (previousRevision === 0) {
      statements.push(q(`INSERT INTO ${P}registrations(registration_id,namespace,scope_key,active_generation,revision,enabled,registration_json) VALUES(?,?,?,?,?,?,?)`, r.registrationId, namespace, r.scopeKey, r.generation, r.revision, r.enabled ? 1 : 0, json));
    } else {
      statements.push(q(`INSERT INTO ${P}guards(token,ok) SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM ${P}registrations WHERE registration_id=? AND revision=? AND active_generation<? AND namespace=? AND scope_key=?) THEN 1 ELSE 0 END`, token, r.registrationId, previousRevision, r.generation, namespace, r.scopeKey));
      statements.push(q(`UPDATE ${P}streams SET state='RETIRED',reason=?,revision=revision+1 WHERE registration_id=? AND generation=(SELECT active_generation FROM ${P}registrations WHERE registration_id=?)`, reason, r.registrationId, r.registrationId));
      statements.push(q(`INSERT INTO ${P}guards(token,ok) SELECT ?,CASE WHEN changes()=1 THEN 1 ELSE 0 END`, `${token}:retire`));
      statements.push(q(`UPDATE ${P}registrations SET active_generation=?,revision=?,enabled=?,registration_json=? WHERE registration_id=? AND revision=?`, r.generation, r.revision, r.enabled ? 1 : 0, json, r.registrationId, previousRevision));
      statements.push(q(`INSERT INTO ${P}guards(token,ok) SELECT ?,CASE WHEN changes()=1 THEN 1 ELSE 0 END`, `${token}:registry`));
    }
    statements.push(q(`INSERT INTO ${P}streams(registration_id,generation,registry_revision,revision,next_sequence,state) VALUES(?,?,?,?,1,'ACTIVE')`, r.registrationId, r.generation, r.revision, 1));
    statements.push(q(`INSERT INTO ${P}audit(audit_id,registration_id,generation,reason,authority,execution_allowed) VALUES(?,?,?,?,'EVIDENCE_ONLY',0)`, crypto.randomUUID(), r.registrationId, r.generation, reason));
    for (const suffix of ["", ":retire", ":registry"]) statements.push(q(`DELETE FROM ${P}guards WHERE token=?`, `${token}${suffix}`));
    await db.batch(statements);
  } catch { throw new AdmissionUnavailableError(); }
}
