import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import { dispatchScheduledSignalAdmission, handleSignalAdmission, handleSignalAdmissionStatus } from "../src/signal-admission-route-v1";
import { createAdmissionDb } from "./support/signal-admission-d1-v1";
import { fixture, encode } from "./support/signal-admission-fixture-v1";
import { admitSignal, installGeneration } from "../src/signal-admission-store-v1";

const safety = { authority: "EVIDENCE_ONLY", execution_allowed: false } as const;

describe("signal admission route", () => {
  it("keeps signal admission unreachable by default", async () => {
    const response = await worker.fetch(new Request("https://fixture.invalid/api/v1/signal-evidence", { method: "POST" }), {
      DB: {} as D1Database,
      SIGNAL_ADMISSION_ENABLED: "false",
      SIGNAL_ADMISSION_DISPATCH_ENABLED: "false",
      SIGNAL_ADMISSION_STATUS_ENABLED: "false",
      SIGNAL_EVIDENCE_INBOX_ENABLED: "false",
    });
    expect(response.status).toBe(404);
  });

  it("authenticates against the durable registry and returns the durable receipt", async () => {
    const h = await createAdmissionDb(); const f = await fixture();
    const registration = { ...f.registration, freshness: { ...f.registration.freshness, max_event_age_seconds: 1000 } };
    await h.provision(registration);
    const response = await handleSignalAdmission(new Request("https://fixture.invalid/api/v1/signal-evidence", {
      method: "POST", headers: { "content-type": "application/json" }, body: encode(f.request),
    }), { DB: h.db, SIGNAL_ADMISSION_ENABLED: "true" }, () => f.now);
    const payload = await response.json();
    expect(response.status, JSON.stringify(payload)).toBe(202);
    expect(payload).toMatchObject({ ...safety, schema_version: "TradeOpsSignalAdmissionResponseV1", outcome: "ACCEPTED", duplicate: false });
    await h.dispose();
  });

  it("rejects bad credentials generically without mutating the stream", async () => {
    const h = await createAdmissionDb(); const f = await fixture();
    const registration = { ...f.registration, freshness: { ...f.registration.freshness, max_event_age_seconds: 1000 } };
    await h.provision(registration);
    const request = { ...f.request, credential: "wrong-local-test-secret" };
    const response = await handleSignalAdmission(new Request("https://fixture.invalid/api/v1/signal-evidence", {
      method: "POST", headers: { "content-type": "application/json" }, body: encode(request),
    }), { DB: h.db, SIGNAL_ADMISSION_ENABLED: "true" }, () => f.now);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ schema_version: "TradeOpsSignalAdmissionResponseV1", ...safety,
      receipt_id: null, outcome: "REJECTED", code: null, duplicate: false, stream_state: null });
    expect(await h.db.prepare("SELECT next_sequence FROM signal_admission_v1_streams").first<number>("next_sequence")).toBe(1);
    await h.dispose();
  });

  it("samples the admission clock once for authentication and persistence", async () => {
    const h = await createAdmissionDb(); const f = await fixture();
    const registration = { ...f.registration, freshness: { ...f.registration.freshness, max_event_age_seconds: 1000 } };
    await h.provision(registration); let calls = 0;
    const response = await handleSignalAdmission(new Request("https://fixture.invalid/api/v1/signal-evidence", {
      method: "POST", headers: { "content-type": "application/json" }, body: encode(f.request),
    }), { DB: h.db, SIGNAL_ADMISSION_ENABLED: "true" }, () => { calls += 1; return f.now; });
    expect(response.status).toBe(202); expect(calls).toBe(1); await h.dispose();
  });

  it("cancels and rejects request bodies beyond the outer byte cap", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({ pull(controller) { controller.enqueue(new Uint8Array(278529)); }, cancel() { cancelled = true; } });
    const response = await handleSignalAdmission(new Request("https://fixture.invalid/api/v1/signal-evidence", {
      method: "POST", headers: { "content-type": "application/json" }, body, duplex: "half",
    } as RequestInit), { DB: {} as D1Database, SIGNAL_ADMISSION_ENABLED: "true" }, () => 1);
    expect(response.status).toBe(413); expect(cancelled).toBe(true);
  });

  it("redacts interrupted request stream failures into the frozen response", async () => {
    const body = new ReadableStream<Uint8Array>({ pull() { throw new Error("LOCAL_SENSITIVE_UPLOAD_FAILURE"); } });
    const response = await handleSignalAdmission(new Request("https://fixture.invalid/api/v1/signal-evidence", {
      method: "POST", headers: { "content-type": "application/json" }, body, duplex: "half",
    } as RequestInit), { DB: {} as D1Database, SIGNAL_ADMISSION_ENABLED: "true" }, () => 1);
    expect(response.status).toBe(400);
    const text = await response.text();
    expect(text).not.toContain("LOCAL_SENSITIVE_UPLOAD_FAILURE");
    expect(JSON.parse(text)).toEqual({ schema_version: "TradeOpsSignalAdmissionResponseV1", ...safety,
      receipt_id: null, outcome: "REJECTED", code: null, duplicate: false, stream_state: null });
  });
});

describe("scheduled private dispatch", () => {
  it("sends at most one queued delivery to the fixed private receiver with redirects refused", async () => {
    const h = await createAdmissionDb({ queuedAt: 2400, expiresAt: 2500 }); const calls: Array<{ input: RequestInfo; init?: RequestInit }> = [];
    const receiver = { fetch: async (input: RequestInfo, init?: RequestInit) => {
      calls.push({ input, ...(init === undefined ? {} : { init }) }); const body = JSON.parse(String(init?.body));
      return Response.json({ schema_version: "TradeOpsSignalDeliveryAckV1", ...safety, delivery_id: body.delivery_id, delivery_body_sha256: body.delivery_body_sha256, status: "STORED" }, { status: 201 });
    } } as Fetcher;
    await dispatchScheduledSignalAdmission({ DB: h.db, SIGNAL_ADMISSION_DISPATCH_ENABLED: "true", SIGNAL_EVIDENCE_RECEIVER: receiver, SIGNAL_DELIVERY_SECRET: "local-delivery-secret" }, () => 2401);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ input: "https://signal-evidence.internal/internal/signal-evidence-v1", init: { method: "POST", redirect: "manual", headers: { authorization: "Bearer local-delivery-secret" } } });
    await h.dispose();
  });

  it("does nothing when any dispatch gate is absent", async () => {
    const fetch = vi.fn();
    await dispatchScheduledSignalAdmission({ DB: {} as D1Database, SIGNAL_ADMISSION_DISPATCH_ENABLED: "false", SIGNAL_EVIDENCE_RECEIVER: { fetch } as unknown as Fetcher, SIGNAL_DELIVERY_SECRET: "x" }, () => 1);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("private signal admission status", () => {
  it("caps all lists at 50 with newest sequence first and deterministic identity ties", async () => {
    const h = await createAdmissionDb(); const f = await fixture("same_event_price_conflict");
    const r = {...f.registration,freshness:{...f.registration.freshness,max_event_age_seconds:1000}};
    const operator = "LOCAL_TEST_STATUS_BOUNDS";
    try {
      await h.provision(r);
      await admitSignal(h.db,f.transport,r,f.now);
      const association = await h.db.prepare("SELECT * FROM signal_admission_v1_receipt_evidence").first<{evidence_id:string;attempt_key:string;namespace:string}>();
      await h.db.batch(Array.from({length:55},(_,i) => h.db.prepare("INSERT INTO signal_admission_v1_receipts VALUES(?,1,?,?,?,'NO_CANDIDATE',NULL,?)").bind(r.registrationId,i+2,`receipt-${i+2}`,"a".repeat(64),f.now)));
      await h.db.batch(Array.from({length:55},(_,i) => h.db.prepare("INSERT INTO signal_admission_v1_receipt_evidence VALUES(?,?,?,?)").bind(`receipt-${i+2}`,association!.evidence_id,association!.namespace,association!.attempt_key)));
      await h.db.batch(Array.from({length:55},(_,i) => h.db.prepare("INSERT INTO signal_admission_v1_evidence VALUES(?,?,?,?,?,'{}','EVIDENCE_ONLY',0)").bind(`evidence-${i}`,association!.namespace,`attempt-${i}`,"b".repeat(64),`receipt-${56-Math.floor(i/2)}`)));
      await h.db.batch(Array.from({length:55},(_,i) => h.db.prepare("INSERT INTO signal_admission_v1_attempts(namespace,attempt_key,formation_hash) VALUES(?,?,?)").bind(association!.namespace,`attempt-${i}`,"a".repeat(64))));
      await h.db.batch(Array.from({length:55},(_,i) => h.db.prepare("INSERT INTO signal_admission_v1_outbox(delivery_id,namespace,attempt_key,registration_id,generation,receipt_id,evidence_id,delivery_body_sha256,body,admitted_at_epoch,expires_at_epoch,status,next_attempt_at_epoch,authority,execution_allowed) VALUES(?,?,?,?,1,?,?,?,'{}',?,?, 'PENDING',?,'EVIDENCE_ONLY',0)").bind(`delivery-${String(54-i).padStart(2,"0")}`,association!.namespace,`attempt-${i}`,r.registrationId,`receipt-${56-Math.floor(i/2)}`,`evidence-${i}`,"b".repeat(64),f.now,f.now+10,f.now)));
      const response = await handleSignalAdmissionStatus(new Request(`https://local.test/status?registration_id=${r.registrationId}&generation=1`,{headers:{authorization:`Bearer ${operator}`}}),{DB:h.db,SIGNAL_ADMISSION_STATUS_ENABLED:"true",SIGNAL_ADMISSION_OPERATOR_SECRET_SHA256:createHash("sha256").update(operator).digest("hex"),SIGNAL_ADMISSION_OPERATOR_SCOPE_JSON:JSON.stringify({registration_ids:[r.registrationId]})});
      const payload = await response.json() as {receipts:Array<{sequence:number;outcome:string}>;attempt_associations:Array<{sequence:number;attempt_key:string}>;delivery_summaries:Array<{sequence:number;delivery_id:string}>};
      expect(response.status).toBe(200);
      for (const rows of [payload.receipts,payload.attempt_associations,payload.delivery_summaries]) expect(rows).toHaveLength(50);
      expect(payload.receipts.map(row=>row.sequence)).toEqual(Array.from({length:50},(_,i)=>56-i));
      expect(payload.attempt_associations.map(row=>row.sequence)).toEqual(payload.receipts.map(row=>row.sequence));
      expect(payload.receipts.every(row=>row.outcome === "NO_CANDIDATE")).toBe(true);
      expect(payload.attempt_associations.every(row=>row.attempt_key === association!.attempt_key)).toBe(true);
      expect(payload.delivery_summaries).toEqual([...payload.delivery_summaries].sort((a,b)=>b.sequence-a.sequence || a.delivery_id.localeCompare(b.delivery_id)));
      expect(payload.delivery_summaries.slice(0,2).map(row=>row.delivery_id)).toEqual(["delivery-53","delivery-54"]);
    } finally { await h.dispose(); }
  });
  it("denies valid but out-of-scope operators before any lookup", async () => {
    const prepare = vi.fn(); const operator = "LOCAL_TEST_SCOPE";
    const response = await handleSignalAdmissionStatus(new Request("https://local.test/status?registration_id=outside&generation=1",{headers:{authorization:`Bearer ${operator}`}}),{DB:{prepare} as unknown as D1Database,SIGNAL_ADMISSION_STATUS_ENABLED:"true",SIGNAL_ADMISSION_OPERATOR_SECRET_SHA256:createHash("sha256").update(operator).digest("hex"),SIGNAL_ADMISSION_OPERATOR_SCOPE_JSON:'{"registration_ids":["inside"]}'});
    expect(response.status).toBe(403); expect(prepare).not.toHaveBeenCalled();
  });
  it("shows empty, quarantined and retired streams with bounded attempt associations", async () => {
    const h = await createAdmissionDb(); const f = await fixture();
    const r = {...f.registration,freshness:{...f.registration.freshness,max_event_age_seconds:1000}};
    const operator = "LOCAL_TEST_STATUS";
    const env = {DB:h.db,SIGNAL_ADMISSION_STATUS_ENABLED:"true",SIGNAL_ADMISSION_OPERATOR_SECRET_SHA256:createHash("sha256").update(operator).digest("hex"),SIGNAL_ADMISSION_OPERATOR_SCOPE_JSON:JSON.stringify({registration_ids:[r.registrationId]})};
    const status = (generation = 1) => handleSignalAdmissionStatus(new Request(`https://local.test/status?registration_id=${r.registrationId}&generation=${generation}`, {headers:{authorization:`Bearer ${operator}`}}), env);
    try {
      await h.provision(r);
      expect(await (await status()).json()).toMatchObject({stream:{state:"ACTIVE",reason:null},receipts:[],attempt_associations:[],delivery_summaries:[]});
      expect((await status(2)).status).toBe(404);
      const accepted = await admitSignal(h.db,f.transport,r,f.now);
      const claim = await h.claim(f.now); await h.finalize(claim!.token!,"ACKNOWLEDGED",f.now);
      await admitSignal(h.db,{...f.transport,bodySha256:"f".repeat(64)},r,f.now);
      const association = await h.db.prepare("SELECT receipt_id,evidence_id,attempt_key FROM signal_admission_v1_receipt_evidence").first();
      const payload = await (await status()).json();
      expect(payload).toMatchObject({stream:{state:"QUARANTINED",reason:"BODY_CONFLICT"},receipts:[{receipt_id:accepted.receipt_id,outcome:"ACCEPTED"}],attempt_associations:[{...association,sequence:1,disputed:true}],delivery_summaries:[{status:"ACKNOWLEDGED"}]});
      await installGeneration(h.db,1,{...r,generation:2,revision:2},"LOCAL_REVIEW_RETIRE");
      expect(await (await status()).json()).toMatchObject({stream:{state:"RETIRED",reason:"LOCAL_REVIEW_RETIRE"}});
    } finally { await h.dispose(); }
  });
  it("requires an authenticated configured scope and returns newest receipts first", async () => {
    const h = await createAdmissionDb(); const f = await fixture();
    const registration = { ...f.registration, freshness: { ...f.registration.freshness, max_event_age_seconds: 1000 } };
    await h.provision(registration);
    await handleSignalAdmission(new Request("https://fixture.invalid/api/v1/signal-evidence", {
      method: "POST", headers: { "content-type": "application/json" }, body: encode(f.request),
    }), { DB: h.db, SIGNAL_ADMISSION_ENABLED: "true" }, () => f.now);
    const operator = "operator-local-test-secret";
    const env = { DB: h.db, SIGNAL_ADMISSION_STATUS_ENABLED: "true", SIGNAL_ADMISSION_OPERATOR_SECRET_SHA256: createHash("sha256").update(operator).digest("hex"), SIGNAL_ADMISSION_OPERATOR_SCOPE_JSON: JSON.stringify({ registration_ids: [f.registration.registrationId] }) };
    const response = await handleSignalAdmissionStatus(new Request(`https://fixture.invalid/api/v1/signal-admission-status?registration_id=${f.registration.registrationId}&generation=1`, { headers: { authorization: `Bearer ${operator}` } }), env);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ...safety, schema_version: "TradeOpsSignalAdmissionStatusV1", registration_id: f.registration.registrationId, generation: 1, receipts: [{ sequence: 1 }] });
    const denied = await handleSignalAdmissionStatus(new Request("https://fixture.invalid/api/v1/signal-admission-status?registration_id=other&generation=1", { headers: { authorization: `Bearer ${operator}` } }), env);
    expect(denied.status).toBe(403);
    await h.dispose();
  });

  it("fails closed for malformed scope before touching storage", async () => {
    const prepare = vi.fn(); const operator = "operator-local-test-secret";
    const response = await handleSignalAdmissionStatus(new Request("https://fixture.invalid/api/v1/signal-admission-status?registration_id=x&generation=1", { headers: { authorization: `Bearer ${operator}` } }), {
      DB: { prepare } as unknown as D1Database, SIGNAL_ADMISSION_STATUS_ENABLED: "true", SIGNAL_ADMISSION_OPERATOR_SECRET_SHA256: createHash("sha256").update(operator).digest("hex"), SIGNAL_ADMISSION_OPERATOR_SCOPE_JSON: '{"registration_ids":["x"],"extra":true}',
    });
    expect(response.status).toBe(403); expect(prepare).not.toHaveBeenCalled();
  });
});
