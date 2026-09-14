import { expect, it } from "vitest";
import { admitSignal, AdmissionUnavailableError, installGeneration, loadAdmissionSnapshot } from "../src/signal-admission-store-v1";
import { fixture, encode } from "./support/signal-admission-fixture-v1";
import { createAdmissionDb } from "./support/signal-admission-d1-v1";
import { parseAdmissionTransport } from "../src/signal-admission-wire-v1";
import { admissionFactKeys } from "../src/signal-admission-decision-v1";
import { canonicalSha256 } from "../src/rd-entry-policy";
async function setup(caseId?: string) {
  const f = await fixture(caseId);
  f.registration = { ...f.registration, freshness: { ...f.registration.freshness, max_event_age_seconds: 1000 } };
  const h = await createAdmissionDb(); await h.provision(f.registration);
  return { ...f, h };
}
async function sequence(f: Awaited<ReturnType<typeof fixture>>, n: number) {
  const request = structuredClone(f.request); request.evidence.observation.producer_sequence = n;
  request.evidence.observation.event_id = `${request.evidence.observation.producer_instance_id}:${n}`;
  return parseAdmissionTransport(encode(request));
}
it("returns an evidence-only durable admission", async () => {
  const f = await fixture();
  const r = { ...f.registration, freshness: { ...f.registration.freshness, max_event_age_seconds: 1000 } };
  const h = await createAdmissionDb();
  try {
    await h.provision(r);
    expect(await admitSignal(h.db, f.transport, r, f.now)).toMatchObject({ authority: "EVIDENCE_ONLY", execution_allowed: false, outcome: "ACCEPTED" });
    expect(await h.count("receipts")).toBe(1);
    expect(await h.count("outbox")).toBe(1);
  } finally { await h.dispose(); }
});
it("retains subsequent conflict evidence on an already quarantined stream", async () => {
  const f = await setup(); const { h } = f;
  try {
    const accepted = await admitSignal(h.db, f.transport, f.registration, f.now);
    const original = await h.db.prepare("SELECT * FROM signal_admission_v1_attempts").first();
    const delivery = await h.db.prepare("SELECT delivery_id,body,delivery_body_sha256 FROM signal_admission_v1_outbox").first();
    const receipt = await h.db.prepare("SELECT * FROM signal_admission_v1_receipts").first();
    await admitSignal(h.db, await sequence(f, 3), f.registration, f.now);
    const changed = structuredClone(f.request); changed.evidence.observation.observed_at_epoch += 1;
    const conflict = await parseAdmissionTransport(encode(changed));
    const responses = await Promise.all([admitSignal(h.db, conflict, f.registration, f.now), admitSignal(h.db, conflict, f.registration, f.now)]);
    for (const response of responses) expect(response).toMatchObject({code:"BODY_CONFLICT", receipt_id:accepted.receipt_id, stream_state:"QUARANTINED"});
    expect(await h.db.prepare("SELECT * FROM signal_admission_v1_attempts").first()).toEqual({...original, disputed:1});
    expect(await h.db.prepare("SELECT delivery_id,body,delivery_body_sha256 FROM signal_admission_v1_outbox").first()).toEqual(delivery);
    expect(await h.db.prepare("SELECT * FROM signal_admission_v1_receipts WHERE sequence=1").first()).toEqual(receipt);
    const next = {...f.registration, generation:2, revision:2};
    await installGeneration(h.db, 1, next, "LOCAL_REVIEW_NEXT");
    expect(await admitSignal(h.db, await parseAdmissionTransport(encode({...f.request,generation:2})), next, f.now)).toMatchObject({code:"ATTEMPT_CONFLICT"});
  } finally { await h.dispose(); }
});
it.each([0,1,2,3,4])("rolls back quarantined receipt conflict at write %s", async afterWrite => {
  const f = await setup(); const { h } = f;
  try {
    await admitSignal(h.db, f.transport, f.registration, f.now);
    await admitSignal(h.db, await sequence(f, 3), f.registration, f.now);
    const audits = await h.count("audit");
    h.faults.afterWrite = afterWrite;
    await expect(admitSignal(h.db, {...f.transport,bodySha256:"f".repeat(64)}, f.registration, f.now)).rejects.toBeInstanceOf(AdmissionUnavailableError);
    expect(await h.count("audit")).toBe(audits);
    expect(await h.db.prepare("SELECT disputed FROM signal_admission_v1_attempts").first("disputed")).toBe(0);
    expect(await h.db.prepare("SELECT state,reason FROM signal_admission_v1_streams").first()).toEqual({state:"QUARANTINED",reason:"SEQUENCE_GAP"});
  } finally { await h.dispose(); }
});
it("fences quarantined conflict against generation retirement", async () => {
  const f = await setup(); const { h } = f;
  try {
    await admitSignal(h.db, f.transport, f.registration, f.now);
    await admitSignal(h.db, await sequence(f, 3), f.registration, f.now);
    h.faults.beforeBatch = () => installGeneration(h.db, 1, {...f.registration,generation:2,revision:2}, "LOCAL_REVIEW_RACE");
    expect(await admitSignal(h.db, {...f.transport,bodySha256:"f".repeat(64)}, f.registration, f.now)).toMatchObject({code:"STREAM_BLOCKED",stream_state:"RETIRED"});
    expect(await h.db.prepare("SELECT disputed FROM signal_admission_v1_attempts").first("disputed")).toBe(0);
  } finally { await h.dispose(); }
});
it.each([0,1,2,3,4,5,6])("rolls back all writes after persistence boundary %s", async afterWrite => {
  const f = await setup(); const { h } = f;
  try {
    h.faults.afterWrite = afterWrite;
    await expect(admitSignal(h.db, f.transport, f.registration, f.now)).rejects.toBeInstanceOf(AdmissionUnavailableError);
    for (const table of ["receipts", "evidence", "receipt_evidence", "attempts", "outbox", "guards"]) expect(await h.count(table)).toBe(0);
    expect(await loadAdmissionSnapshot(h.db, f.transport)).toMatchObject({nextSequence:1,state:"ACTIVE"});
    expect(h.metrics.admissionBatches).toBe(1);
  } finally { await h.dispose(); }
});
it("rolls back earlier receipt and evidence when a later named guard fails", async () => {
  const f = await setup(); const { h } = f;
  try {
    await expect(h.db.batch([
      h.db.prepare("INSERT INTO signal_admission_v1_receipts VALUES(?,1,1,'receipt',?,'ACCEPTED',NULL,2400)").bind(f.registration.registrationId,"a".repeat(64)),
      h.db.prepare("INSERT INTO signal_admission_v1_evidence VALUES('e','n','a',?,'receipt','{}','EVIDENCE_ONLY',0)").bind("b".repeat(64)),
      h.db.prepare("INSERT INTO signal_admission_v1_guards VALUES('fail-later',0)"),
    ])).rejects.toThrow("signal_admission_v1_cas");
    for (const table of ["receipts","evidence","attempts","outbox","guards"]) expect(await h.count(table)).toBe(0);
  } finally { await h.dispose(); }
});
it("concurrent exact receipts commit once and return the immutable duplicate", async () => {
  const f = await setup(); const { h } = f;
  try {
    const responses = await Promise.all([admitSignal(h.db,f.transport,f.registration,f.now),admitSignal(h.db,f.transport,f.registration,f.now)]);
    expect(responses.map(r=>r.duplicate).sort()).toEqual([false,true]);
    expect(responses[0]!.receipt_id).toBe(responses[1]!.receipt_id);
    for (const table of ["receipts","evidence","attempts","outbox"]) expect(await h.count(table)).toBe(1);
    expect(await h.db.prepare("SELECT body_sha256 FROM signal_admission_v1_receipts").first("body_sha256")).toBe(f.transport.bodySha256);
    const before = await h.db.prepare("SELECT body,delivery_body_sha256,expires_at_epoch FROM signal_admission_v1_outbox").first();
    expect(await admitSignal(h.db,f.transport,f.registration,100000)).toMatchObject({duplicate:true,outcome:"ACCEPTED"});
    expect(await h.db.prepare("SELECT body,delivery_body_sha256,expires_at_epoch FROM signal_admission_v1_outbox").first()).toEqual(before);
  } finally { await h.dispose(); }
});
it("concurrent changed receipt quarantines without replacing its winner", async () => {
  const f = await setup(); const { h } = f;
  try {
    const changed = { ...f.transport, bodySha256:"f".repeat(64) };
    const results = await Promise.all([admitSignal(h.db,f.transport,f.registration,f.now),admitSignal(h.db,changed,f.registration,f.now)]);
    expect(results.map(r=>r.outcome).sort()).toEqual(["ACCEPTED","REJECTED"]);
    expect(results.find(r=>r.outcome==="REJECTED")).toMatchObject({code:"BODY_CONFLICT",stream_state:"QUARANTINED"});
    expect(await h.count("receipts")).toBe(1);
    const original = await h.db.prepare("SELECT body_sha256 FROM signal_admission_v1_receipts").first<string>("body_sha256");
    expect([f.transport.bodySha256,changed.bodySha256]).toContain(original);
    expect(await h.db.prepare("SELECT disputed FROM signal_admission_v1_attempts").first("disputed")).toBe(1);
    expect(await h.db.prepare("SELECT status FROM signal_admission_v1_outbox").first("status")).toBe("QUARANTINED");
    const winner = original===f.transport.bodySha256 ? f.transport : changed;
    expect(await admitSignal(h.db,winner,f.registration,f.now)).toMatchObject({duplicate:true,outcome:"ACCEPTED",stream_state:"QUARANTINED"});
  } finally { await h.dispose(); }
});
it("lost commit response throws unavailable; retry retrieves one original receipt", async () => {
  const f = await setup(); const { h } = f;
  try {
    h.faults.afterCommit=true;
    await expect(admitSignal(h.db,f.transport,f.registration,f.now)).rejects.toBeInstanceOf(AdmissionUnavailableError);
    expect(await admitSignal(h.db,f.transport,f.registration,f.now)).toMatchObject({duplicate:true,outcome:"ACCEPTED"});
    expect(await h.count("receipts")).toBe(1); expect(await h.count("outbox")).toBe(1);
  } finally { await h.dispose(); }
});
it("retains no-candidate formations and every later evidence without replacing reservation", async () => {
  const f = await setup("same_event_price_conflict"); const { h } = f;
  try {
    expect(await admitSignal(h.db,f.transport,f.registration,f.now)).toMatchObject({outcome:"NO_CANDIDATE"});
    expect(await h.count("evidence")).toBe(1); expect(await h.count("outbox")).toBe(0);
    expect(await h.db.prepare("SELECT evidence_id,trigger_epoch,selection_key FROM signal_admission_v1_attempts").first()).toEqual({evidence_id:null,trigger_epoch:null,selection_key:null});
    const selected=await fixture();
    expect(await admitSignal(h.db,await sequence(selected,2),f.registration,f.now)).toMatchObject({outcome:"ACCEPTED"});
    const original=await h.db.prepare("SELECT * FROM signal_admission_v1_attempts").first();
    expect(await admitSignal(h.db,await sequence(selected,3),f.registration,f.now)).toMatchObject({outcome:"AUDIT_ONLY"});
    expect(await h.db.prepare("SELECT * FROM signal_admission_v1_attempts").first()).toEqual(original);
    expect(await h.count("evidence")).toBe(3); expect(await h.count("receipt_evidence")).toBe(3); expect(await h.count("outbox")).toBe(1);
    const keys=await admissionFactKeys(f.transport,f.registration.bindingBytes);
    // Snapshot retains no-candidate identity facts across generation and receipt keys.
    await installGeneration(h.db,1,{...f.registration,generation:2,revision:2},"test cutover");
    const request={...f.request,generation:2};
    const snapshot=await loadAdmissionSnapshot(h.db,await parseAdmissionTransport(encode(request)));
    expect(snapshot.evidenceFacts[keys[0]!.evidenceId]).toBeDefined();
  } finally { await h.dispose(); }
});
it("cutover retains reservation, retires old stream and deduplicates new generation", async () => {
  const f=await setup(); const {h}=f;
  try {
    await admitSignal(h.db,f.transport,f.registration,f.now);
    const next={...f.registration,generation:2,revision:2};
    await installGeneration(h.db,1,next,"test cutover");
    const t=await parseAdmissionTransport(encode({...f.request,generation:2}));
    expect(await admitSignal(h.db,t,next,f.now)).toMatchObject({outcome:"AUDIT_ONLY"});
    expect(await admitSignal(h.db,f.transport,f.registration,f.now)).toMatchObject({duplicate:true,stream_state:"RETIRED"});
    expect(await h.count("outbox")).toBe(1); expect(await h.count("attempts")).toBe(1);
    await expect(installGeneration(h.db,1,next,"stale revision")).rejects.toBeInstanceOf(AdmissionUnavailableError);
    expect(await h.count("streams")).toBe(2);
  } finally { await h.dispose(); }
});
it.each(["PENDING", "CLAIMED"])("later-generation receipt conflict disputes reused evidence and cancels original %s delivery", async status => {
  const f=await setup(); const {h}=f;
  try {
    await admitSignal(h.db,f.transport,f.registration,f.now);
    if (status === "CLAIMED") await h.db.prepare("UPDATE signal_admission_v1_outbox SET status='CLAIMED',claim_token='old-generation-claim',lease_until_epoch=2410").run();
    const next={...f.registration,generation:2,revision:2};
    await installGeneration(h.db,1,next,"test cutover");
    const t=await parseAdmissionTransport(encode({...f.request,generation:2}));
    expect(await admitSignal(h.db,t,next,f.now)).toMatchObject({outcome:"AUDIT_ONLY"});
    expect(await h.count("evidence")).toBe(1);
    expect(await h.count("receipt_evidence")).toBe(2);
    expect(await admitSignal(h.db,{...t,bodySha256:"f".repeat(64)},next,f.now)).toMatchObject({code:"BODY_CONFLICT"});
    expect(await h.db.prepare("SELECT disputed FROM signal_admission_v1_attempts").first("disputed")).toBe(1);
    expect(await h.db.prepare("SELECT generation,status,claim_token,lease_until_epoch FROM signal_admission_v1_outbox").first()).toEqual({generation:1,status:"QUARANTINED",claim_token:null,lease_until_epoch:null});
    expect(await h.count("receipts")).toBe(2); expect(await h.count("outbox")).toBe(1);
  } finally { await h.dispose(); }
});
it("rolls back a reused-evidence association with its later receipt", async () => {
  const f=await setup(); const {h}=f;
  try {
    await admitSignal(h.db,f.transport,f.registration,f.now);
    const next={...f.registration,generation:2,revision:2};
    await installGeneration(h.db,1,next,"test cutover");
    const t=await parseAdmissionTransport(encode({...f.request,generation:2}));
    h.faults.afterWrite=1; // receipt followed by association, before cursor
    await expect(admitSignal(h.db,t,next,f.now)).rejects.toBeInstanceOf(AdmissionUnavailableError);
    for (const table of ["receipts","evidence","receipt_evidence","attempts","outbox"]) expect(await h.count(table)).toBe(1);
    expect(await loadAdmissionSnapshot(h.db,t)).toMatchObject({nextSequence:1,existingReceipt:null});
    expect(await h.count("guards")).toBe(0);
    h.faults.afterWrite=-1;
    expect(await admitSignal(h.db,t,next,f.now)).toMatchObject({outcome:"AUDIT_ONLY"});
    expect(await h.count("receipt_evidence")).toBe(2);
  } finally { await h.dispose(); }
});
it("receipt evidence associations are immutable and must match namespace, attempt and accepted receipt", async () => {
  const f=await setup(); const {h}=f;
  try {
    const accepted=await admitSignal(h.db,f.transport,f.registration,f.now);
    const row=await h.db.prepare("SELECT evidence_id,namespace,attempt_key FROM signal_admission_v1_receipt_evidence").first<{evidence_id:string;namespace:string;attempt_key:string}>();
    for (const sql of ["UPDATE signal_admission_v1_receipt_evidence SET attempt_key='other'", "DELETE FROM signal_admission_v1_receipt_evidence"]) await expect(h.db.prepare(sql).run()).rejects.toThrow("receipt evidence association");
    for (const [namespace,attemptKey] of [["wrong-namespace",row!.attempt_key],[row!.namespace,"wrong-attempt"]]) {
      await expect(h.db.prepare("INSERT INTO signal_admission_v1_receipt_evidence VALUES(?,?,?,?)").bind(accepted.receipt_id,row!.evidence_id,namespace,attemptKey).run()).rejects.toThrow("inconsistent receipt evidence association");
    }
    const rejected=await admitSignal(h.db,await sequence(f,3),f.registration,f.now);
    expect(rejected).toMatchObject({outcome:"REJECTED",code:"SEQUENCE_GAP"});
    await expect(h.db.prepare("INSERT INTO signal_admission_v1_receipt_evidence VALUES(?,?,?,?)").bind(rejected.receipt_id,row!.evidence_id,row!.namespace,row!.attempt_key).run()).rejects.toThrow("inconsistent receipt evidence association");
    expect(await h.count("receipt_evidence")).toBe(1);
  } finally { await h.dispose(); }
});
it("fences admission prepared before generation cutover", async () => {
  const f=await setup(); const {h}=f;
  try {
    h.faults.beforeBatch=()=>installGeneration(h.db,1,{...f.registration,generation:2,revision:2},"raced cutover");
    expect(await admitSignal(h.db,f.transport,f.registration,f.now)).toMatchObject({outcome:"REJECTED",code:"STREAM_BLOCKED",stream_state:"RETIRED"});
    expect(await h.count("receipts")).toBe(0); expect(await h.count("outbox")).toBe(0);
  } finally { await h.dispose(); }
});
it("rejects stale registry preflight without writes", async () => {
  const f=await setup(); const {h}=f;
  try {
    expect(await admitSignal(h.db,f.transport,{...f.registration,revision:2},f.now)).toMatchObject({code:"STREAM_BLOCKED"});
    expect(await h.count("receipts")).toBe(0);
  } finally { await h.dispose(); }
});
it("enforces unique active registration scope in a provisioning race", async () => {
  const f=await fixture(); const h=await createAdmissionDb();
  try {
    const results=await Promise.allSettled([h.provision(f.registration),h.provision({...f.registration,registrationId:"other-registration"})]);
    expect(results.map(r=>r.status).sort()).toEqual(["fulfilled","rejected"]);
    expect(await h.count("registrations")).toBe(1); expect(await h.count("streams")).toBe(1);
  } finally { await h.dispose(); }
});
it.each([0,1,2,3,4])("rolls quarantine back after write %s", async afterWrite => {
  const f=await setup(); const {h}=f;
  try {
    await admitSignal(h.db,f.transport,f.registration,f.now);
    h.faults.afterWrite=afterWrite;
    await expect(admitSignal(h.db,{...f.transport,bodySha256:"f".repeat(64)},f.registration,f.now)).rejects.toBeInstanceOf(AdmissionUnavailableError);
    expect(await h.count("audit")).toBe(1);
    expect(await h.db.prepare("SELECT state FROM signal_admission_v1_streams").first("state")).toBe("ACTIVE");
    expect(await h.db.prepare("SELECT disputed FROM signal_admission_v1_attempts").first("disputed")).toBe(0);
    expect(await h.db.prepare("SELECT status FROM signal_admission_v1_outbox").first("status")).toBe("PENDING");
  } finally { await h.dispose(); }
});
it("two generations racing for one economic attempt produce only one reservation", async () => {
  const f=await setup(); const {h}=f;
  try {
    const next={...f.registration,generation:2,revision:2};
    const t=await parseAdmissionTransport(encode({...f.request,generation:2}));
    let release!:()=>void; const waiting=new Promise<void>(resolve=>{release=resolve;});
    let entered!:()=>void; const started=new Promise<void>(resolve=>{entered=resolve;});
    h.faults.beforeBatch=async()=>{entered();await waiting;};
    const old=admitSignal(h.db,f.transport,f.registration,f.now);
    await started;
    await installGeneration(h.db,1,next,"raced generation");
    const fresh=admitSignal(h.db,t,next,f.now);
    release();
    const results=await Promise.all([old,fresh]);
    expect(results[0]).toMatchObject({code:"STREAM_BLOCKED"});
    expect(results[1]).toMatchObject({outcome:"ACCEPTED"});
    for (const table of ["receipts","attempts","outbox"]) expect(await h.count(table)).toBe(1);
    expect(await h.db.prepare("SELECT generation FROM signal_admission_v1_outbox").first("generation")).toBe(2);
  } finally { await h.dispose(); }
});
it("cutover rollback restores registry and old stream after later insert fails", async () => {
  const f=await setup(); const {h}=f;
  try {
    await h.db.prepare("INSERT INTO signal_admission_v1_streams(registration_id,generation,registry_revision,revision,next_sequence,state) VALUES(?,2,2,1,1,'RETIRED')").bind(f.registration.registrationId).run();
    await expect(installGeneration(h.db,1,{...f.registration,generation:2,revision:2},"conflicting generation")).rejects.toBeInstanceOf(AdmissionUnavailableError);
    expect(await h.db.prepare("SELECT active_generation,revision FROM signal_admission_v1_registrations").first()).toEqual({active_generation:1,revision:1});
    expect(await h.db.prepare("SELECT state,revision FROM signal_admission_v1_streams WHERE generation=1").first()).toEqual({state:"ACTIVE",revision:1});
    expect(await h.count("guards")).toBe(0);
  } finally { await h.dispose(); }
});
it("rejects incoherent nullable reservations and fractional integer fields", async () => {
  const f=await setup(); const {h}=f;
  try {
    await expect(h.db.prepare("INSERT INTO signal_admission_v1_attempts(namespace,attempt_key,formation_hash,evidence_hash) VALUES('n','k',?,?)").bind("a".repeat(64),"b".repeat(64)).run()).rejects.toThrow();
    await expect(h.db.prepare("UPDATE signal_admission_v1_streams SET next_sequence=1.5").run()).rejects.toThrow();
    expect(await h.count("attempts")).toBe(0);
    expect(await loadAdmissionSnapshot(h.db,f.transport)).toMatchObject({nextSequence:1});
  } finally { await h.dispose(); }
});
it("loads only bounded relevant fact keys despite unrelated retained attempts", async () => {
  const f=await setup(); const {h}=f;
  try {
    await h.db.batch(Array.from({length:100},(_,i)=>h.db.prepare("INSERT INTO signal_admission_v1_attempts(namespace,attempt_key,formation_hash) VALUES(?,?,?)").bind(JSON.parse(f.registration.scopeKey).producer_namespace,`unrelated-${i}`,"a".repeat(64))));
    const before=h.metrics.reads;
    const snapshot=await loadAdmissionSnapshot(h.db,f.transport);
    expect(Object.keys(snapshot.attempts)).toEqual([]);
    expect(Object.keys(snapshot.evidenceFacts)).toEqual([]);
    expect(h.metrics.reads-before).toBe(4);
    expect(Object.keys(snapshot).sort()).toEqual(["attempts","evidenceFacts","existingReceipt","lastAcceptedAt","nextSequence","revision","state"].sort());
  } finally { await h.dispose(); }
});
it("never accepts a zero-row cursor update and bounds CAS retries at three", async () => {
  const f=await setup(); const {h}=f;
  try {
    await h.db.prepare("CREATE TRIGGER local_ignore_cursor BEFORE UPDATE ON signal_admission_v1_streams BEGIN SELECT RAISE(IGNORE); END").run();
    await expect(admitSignal(h.db,f.transport,f.registration,f.now)).rejects.toBeInstanceOf(AdmissionUnavailableError);
    expect(h.metrics.admissionBatches).toBe(3);
    for (const table of ["receipts","evidence","attempts","outbox","guards"]) expect(await h.count(table)).toBe(0);
  } finally { await h.dispose(); }
});
it("reclassifies a reservation inserted after the bounded absence snapshot", async () => {
  const f=await setup(); const {h}=f;
  try {
    const [key]=await admissionFactKeys(f.transport,f.registration.bindingBytes);
    const namespace=JSON.parse(f.registration.scopeKey).producer_namespace;
    h.faults.beforeBatch=async()=>{ await h.db.prepare("INSERT INTO signal_admission_v1_attempts(namespace,attempt_key,formation_hash) VALUES(?,?,?)").bind(namespace,key!.attemptKey,"f".repeat(64)).run(); };
    expect(await admitSignal(h.db,f.transport,f.registration,f.now)).toMatchObject({code:"ATTEMPT_CONFLICT",outcome:"REJECTED"});
    expect(h.metrics.admissionBatches).toBe(2);
    expect(await h.count("outbox")).toBe(0); expect(await h.count("evidence")).toBe(0);
    expect(await h.db.prepare("SELECT disputed,formation_hash FROM signal_admission_v1_attempts").first()).toEqual({disputed:1,formation_hash:"f".repeat(64)});
  } finally { await h.dispose(); }
});
it("independent authoritative namespaces may reserve the same raw attempt key", async () => {
  const f=await setup(); const {h}=f;
  try {
    const binding=JSON.parse(new TextDecoder().decode(f.registration.bindingBytes)); binding.producer_namespace="other-namespace";
    const scope=JSON.parse(f.registration.scopeKey); scope.producer_namespace=binding.producer_namespace;
    const other={...f.registration,registrationId:"other-registration",scopeKey:JSON.stringify(scope),bindingBytes:encode(binding)};
    await h.provision(other);
    const t=await parseAdmissionTransport(encode({...f.request,registration_id:other.registrationId}));
    const results=await Promise.all([admitSignal(h.db,f.transport,f.registration,f.now),admitSignal(h.db,t,other,f.now)]);
    expect(results.map(r=>r.outcome)).toEqual(["ACCEPTED","ACCEPTED"]);
    const rows=(await h.db.prepare("SELECT namespace,attempt_key FROM signal_admission_v1_attempts").all<{namespace:string;attempt_key:string}>()).results;
    expect(rows).toHaveLength(2); expect(rows[0]!.attempt_key).toBe(rows[1]!.attempt_key);
    await admitSignal(h.db,{...f.transport,bodySha256:"f".repeat(64)},f.registration,f.now);
    expect(await h.db.prepare("SELECT disputed FROM signal_admission_v1_attempts WHERE namespace='other-namespace'").first("disputed")).toBe(0);
    expect(await h.db.prepare("SELECT status FROM signal_admission_v1_outbox WHERE namespace='other-namespace'").first("status")).toBe("PENDING");
  } finally { await h.dispose(); }
});
it("formation conflict cancels a claimed delivery and sticks across cutover", async () => {
  const f=await setup(); const {h}=f;
  try {
    await admitSignal(h.db,f.transport,f.registration,f.now);
    await h.db.prepare("UPDATE signal_admission_v1_outbox SET status='CLAIMED',claim_token='local-claim',lease_until_epoch=2410").run();
    f.request.evidence.formations[0].origin_open_ticks-=1;
    const conflict=await sequence(f,2);
    expect(await admitSignal(h.db,conflict,f.registration,f.now)).toMatchObject({code:"ATTEMPT_CONFLICT"});
    expect(await h.db.prepare("SELECT status,claim_token,lease_until_epoch FROM signal_admission_v1_outbox").first()).toEqual({status:"QUARANTINED",claim_token:null,lease_until_epoch:null});
    await expect(h.db.prepare("UPDATE signal_admission_v1_attempts SET disputed=0").run()).rejects.toThrow("immutable reservation");
    await expect(h.db.prepare("UPDATE signal_admission_v1_streams SET state='ACTIVE'").run()).rejects.toThrow("sticky stream");
    const next={...f.registration,generation:2,revision:2}; await installGeneration(h.db,1,next,"reviewed replacement");
    const clean=await fixture();
    const t=await parseAdmissionTransport(encode({...clean.request,generation:2}));
    expect(await admitSignal(h.db,t,next,f.now)).toMatchObject({code:"ATTEMPT_CONFLICT"});
    expect(await h.count("outbox")).toBe(1);
  } finally { await h.dispose(); }
});
it("stores exact canonical delivery identity and digest with immutable evidence bytes", async () => {
  const f=await setup(); const {h}=f;
  try {
    await admitSignal(h.db,f.transport,f.registration,f.now);
    const row=await h.db.prepare("SELECT body,delivery_body_sha256 FROM signal_admission_v1_outbox").first<{body:string;delivery_body_sha256:string}>();
    const delivery=JSON.parse(row!.body); const {delivery_body_sha256,...unsigned}=delivery;
    expect(delivery_body_sha256).toBe(await canonicalSha256(unsigned));
    expect(delivery.delivery_id).toBe(await canonicalSha256({schema_version:"TradeOpsSignalDeliveryIdentityV1",attempt_key:delivery.attempt_key,evidence_id:delivery.evidence_id}));
    expect(delivery.evidence).toEqual(JSON.parse((await h.db.prepare("SELECT body FROM signal_admission_v1_evidence").first<string>("body"))!));
    expect(row!.body).not.toContain(f.request.credential);
    for (const query of ["UPDATE signal_admission_v1_receipts SET body_sha256='changed'", "UPDATE signal_admission_v1_evidence SET body='{}'", "UPDATE signal_admission_v1_outbox SET body='{}'", "DELETE FROM signal_admission_v1_attempts"]) await expect(h.db.prepare(query).run()).rejects.toThrow();
    expect(await h.count("outbox")).toBe(1);
  } finally { await h.dispose(); }
});
