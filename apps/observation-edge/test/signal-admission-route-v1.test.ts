import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import { dispatchScheduledSignalAdmission, handleSignalAdmission, handleSignalAdmissionStatus } from "../src/signal-admission-route-v1";
import { createAdmissionDb } from "./support/signal-admission-d1-v1";
import { fixture, encode } from "./support/signal-admission-fixture-v1";

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
