import { expect, it } from "vitest";
import { dispatchSignalAdmission } from "../src/signal-admission-outbox-v1";
import { admitSignal, recheckSignalDelivery } from "../src/signal-admission-store-v1";
import { parseAdmissionTransport } from "../src/signal-admission-wire-v1";
import { fixture, encode } from "./support/signal-admission-fixture-v1";
import { createHash } from "node:crypto";
import { handleSignalEvidenceInbox } from "../../execution-edge/src/signal-evidence-inbox-v1";
import { createInboxDb } from "../../execution-edge/test/support/signal-evidence-inbox-d1-v1";
import { createAdmissionDb } from "./support/signal-admission-d1-v1";
const ack = (body: string, duplicate = false) => {
  const delivery = JSON.parse(body);
  return Response.json({ schema_version: "TradeOpsSignalDeliveryAckV1", authority: "EVIDENCE_ONLY", execution_allowed: false, delivery_id: delivery.delivery_id, delivery_body_sha256: delivery.delivery_body_sha256, status: duplicate ? "DUPLICATE" : "STORED" }, { status: duplicate ? 200 : 201 });
};
it("retries immutable bytes after a lost receiver acknowledgment", async () => {
  const h = await createAdmissionDb({ queuedAt: 100, expiresAt: 200 });
  try {
    const sent: string[] = [];
    expect(await dispatchSignalAdmission(h.db, async body => { sent.push(body); throw new Error("LOCAL_LOST_ACK"); }, () => 100)).toBe("RETRY");
    expect(await dispatchSignalAdmission(h.db, async body => { sent.push(body); return ack(body, true); }, () => 102)).toBe("ACKNOWLEDGED");
    expect(sent).toHaveLength(2); expect(sent[1]).toBe(sent[0]);
    expect(JSON.parse(sent[1]!).expires_at_epoch).toBe(200);
  } finally { await h.dispose(); }
});
it("is disabled without accessing the clock or sender", async () => {
  const forbidden = () => { throw new Error("must not call"); };
  expect(await dispatchSignalAdmission(null, forbidden, forbidden)).toBe("DISABLED");
});
it("does not send from an empty database", async () => {
  const h = await createAdmissionDb();
  try { expect(await dispatchSignalAdmission(h.db, async () => { throw new Error("must not send"); }, () => 100)).toBe("EMPTY"); }
  finally { await h.dispose(); }
});
it("recovers a sender crash only when its 30 second lease expires", async () => {
  const h = await createAdmissionDb({ queuedAt: 100, expiresAt: 300 });
  try {
    const first = await h.claim(100); expect(first?.status).toBe("CLAIMED");
    expect(await h.claim(129)).toBeNull();
    const second = await h.claim(130); expect(second?.token).not.toBe(first?.token);
    expect(second?.delivery_attempts).toBe(2);
    expect(await recheckSignalDelivery(h.db, first!.token!, 130)).toBe(false);
    expect(await recheckSignalDelivery(h.db, second!.token!, 130)).toBe(true);
  } finally { await h.dispose(); }
});
it("stops after five failed sends with 2,4,8,16 second retry delays", async () => {
  const h = await createAdmissionDb({ queuedAt: 100, expiresAt: 300 });
  try {
    for (const [index, time] of [100, 102, 106, 114, 130].entries()) {
      expect(await dispatchSignalAdmission(h.db, async () => { throw new Error("LOCAL_NETWORK_FAILURE"); }, () => time)).toBe(index === 4 ? "FAILED_TERMINAL" : "RETRY");
      const row = await h.db.prepare("SELECT * FROM signal_admission_v1_outbox").first();
      expect(row?.delivery_attempts).toBe(index + 1); expect(row?.expires_at_epoch).toBe(300);
      if (index < 4) {
        expect(row?.next_attempt_at_epoch).toBe(time + 2 ** (index + 1));
        expect(await h.claim(time + 1)).toBeNull();
      } else expect(row?.failure_reason).toBe("ATTEMPTS_EXHAUSTED");
    }
    expect(await h.count("attempts")).toBe(1);
    expect(await h.claim(200)).toBeNull();
  } finally { await h.dispose(); }
});
it("exhausts five crashed claims without a sixth send", async () => {
  const h = await createAdmissionDb({ queuedAt: 100, expiresAt: 400 });
  try {
    for (const time of [100, 130, 160, 190, 220]) expect((await h.claim(time))?.status).toBe("CLAIMED");
    const result = await h.claim(250); expect(result?.status).toBe("FAILED_TERMINAL"); expect(result?.delivery_attempts).toBe(5);
  } finally { await h.dispose(); }
});
it.each([408, 429, 500, 503, 599])("retries HTTP %s", async status => {
  const h = await createAdmissionDb({ queuedAt: 100, expiresAt: 200 });
  try { expect(await dispatchSignalAdmission(h.db, async () => new Response(null, { status }), () => 100)).toBe("RETRY"); }
  finally { await h.dispose(); }
});
it.each([202, 204, 301, 302, 307, 400, 401, 403, 404, 409, 422])("terminates HTTP %s", async status => {
  const h = await createAdmissionDb({ queuedAt: 100, expiresAt: 200 });
  try { expect(await dispatchSignalAdmission(h.db, async () => new Response(null, { status }), () => 100)).toBe("FAILED_TERMINAL"); }
  finally { await h.dispose(); }
});
it.each(["extra", "id", "hash", "authority", "execution", "status", "duplicate-key", "invalid-utf8", "oversized", "malformed"])('rejects %s acknowledgment', async mutation => {
  const h = await createAdmissionDb({ queuedAt: 100, expiresAt: 200 });
  try {
    expect(await dispatchSignalAdmission(h.db, async body => {
      const value = await ack(body).json() as Record<string, unknown>;
      if (mutation === "extra") value.extra = 1;
      if (mutation === "id") value.delivery_id = "wrong";
      if (mutation === "hash") value.delivery_body_sha256 = "wrong";
      if (mutation === "authority") value.authority = "TRADE";
      if (mutation === "execution") value.execution_allowed = true;
      if (mutation === "status") value.status = "DUPLICATE";
      const bytes = mutation === "invalid-utf8" ? new Uint8Array([255]) : mutation === "oversized" ? " ".repeat(16385) : mutation === "malformed" ? "{" : mutation === "duplicate-key" ? JSON.stringify(value).replace('{', '{"status":"STORED",') : JSON.stringify(value);
      return new Response(bytes, { status: 201 });
    }, () => 100)).toBe("FAILED_TERMINAL");
  } finally { await h.dispose(); }
});
it.each(["before-claim", "before-send", "after-send"])('expires %s without acknowledging late success', async stage => {
  const h = await createAdmissionDb({ queuedAt: 100, expiresAt: 200 });
  try {
    let calls = 0; let reads = 0;
    const clock = () => stage === "before-claim" || ++reads >= (stage === "before-send" ? 2 : 3) ? 200 : 100;
    expect(await dispatchSignalAdmission(h.db, async body => { calls++; return ack(body); }, clock)).toBe("EXPIRED");
    expect(calls).toBe(stage === "after-send" ? 1 : 0);
  } finally { await h.dispose(); }
});
it.each(["before-send", "after-send", "next-invocation"])('durably diagnoses clock regression %s', async stage => {
  const h = await createAdmissionDb({ queuedAt: 100, expiresAt: 200 });
  try {
    let calls = 0; let reads = 0;
    if (stage === "next-invocation") await h.claim(110);
    const clock = () => stage === "next-invocation" ? 109 : ++reads >= (stage === "before-send" ? 2 : 3) ? 99 : 100;
    expect(await dispatchSignalAdmission(h.db, async body => { calls++; return ack(body); }, clock)).toBe("FAILED_TERMINAL");
    expect(calls).toBe(stage === "after-send" ? 1 : 0);
    const row = await h.db.prepare("SELECT * FROM signal_admission_v1_outbox").first();
    expect(row?.failure_reason).toBe("CLOCK_REGRESSION"); expect(row?.lease_until_epoch).toBeNull();
    expect(row?.last_dispatch_at_epoch).toBe(stage === "next-invocation" ? 110 : 100);
  } finally { await h.dispose(); }
});
it.each(["dispute", "quarantine", "disabled", "retired"])('blocks %s after claim and late acknowledgment', async change => {
  const h = await createAdmissionDb({ queuedAt: 100, expiresAt: 200 });
  try {
    expect(await dispatchSignalAdmission(h.db, async body => {
      const sql = change === "dispute" ? "UPDATE signal_admission_v1_attempts SET disputed=1" : change === "disabled" ? "UPDATE signal_admission_v1_registrations SET enabled=0" : `UPDATE signal_admission_v1_streams SET state='${change === "retired" ? "RETIRED" : "QUARANTINED"}'`;
      await h.db.prepare(sql).run(); return ack(body);
    }, () => 100)).toBe("QUARANTINED");
    expect(await h.claim(130)).toBeNull();
  } finally { await h.dispose(); }
});
it("does not accept success after its lease elapsed", async () => {
  const h = await createAdmissionDb({ queuedAt: 100, expiresAt: 300 });
  try {
    let read = 0;
    expect(await dispatchSignalAdmission(h.db, async body => ack(body), () => ++read < 3 ? 100 : 131)).toBe("RETRY");
    expect((await h.claim(131))?.delivery_attempts).toBe(2);
  } finally { await h.dispose(); }
});
it("bounds a hung sender by six seconds", async () => {
  const h = await createAdmissionDb({ queuedAt: 100, expiresAt: 200 });
  try {
    expect(await dispatchSignalAdmission(h.db, () => new Promise(() => {}), () => 100)).toBe("RETRY");
  } finally { await h.dispose(); }
}, 10_000);
it("recovers a lost response from a real durable receiver as DUPLICATE", async () => {
  const h = await createAdmissionDb({ queuedAt: 2400, expiresAt: 2500 });
  const inbox = await createInboxDb();
  try {
    const token = "LOCAL_TEST_ONLY_OUTBOX_RECEIVER";
    const statuses: number[] = []; const sent: string[] = [];
    const sender = async (body: string) => {
      sent.push(body);
      const response = await handleSignalEvidenceInbox(new Request("https://local.test/internal/signal-evidence-v1", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body }),
        { EXECUTION_DB: inbox.db, SIGNAL_EVIDENCE_INBOX_ENABLED: "true", SIGNAL_DELIVERY_SECRET_SHA256: createHash("sha256").update(token).digest("hex") }, 2400);
      statuses.push(response.status);
      if (statuses.length === 1) throw new Error("LOCAL_LOST_RECEIVER_REPLY");
      return response;
    };
    expect(await dispatchSignalAdmission(h.db, sender, () => 2400)).toBe("RETRY");
    expect(await inbox.count()).toBe(1);
    expect(await dispatchSignalAdmission(h.db, sender, () => 2402)).toBe("ACKNOWLEDGED");
    expect(statuses).toEqual([201, 200]); expect(sent[1]).toBe(sent[0]); expect(await inbox.count()).toBe(1);
  } finally { await inbox.dispose(); await h.dispose(); }
});
it("isolates identical attempt keys across namespaces and sends one delivery per invocation", async () => {
  const h = await createAdmissionDb(); const f = await fixture();
  try {
    const first = { ...f.registration, freshness: { ...f.registration.freshness, max_event_age_seconds: 1000 } };
    const binding = JSON.parse(new TextDecoder().decode(first.bindingBytes)); binding.producer_namespace = "other-namespace";
    const scope = JSON.parse(first.scopeKey); scope.producer_namespace = binding.producer_namespace;
    const other = { ...first, registrationId: "other-registration", scopeKey: JSON.stringify(scope), bindingBytes: encode(binding) };
    await h.provision(first); await h.provision(other);
    await admitSignal(h.db, f.transport, first, f.now);
    await admitSignal(h.db, await parseAdmissionTransport(encode({ ...f.request, registration_id: other.registrationId })), other, f.now);
    const rows = (await h.db.prepare("SELECT namespace,attempt_key FROM signal_admission_v1_outbox").all<{ namespace: string; attempt_key: string }>()).results;
    expect(rows).toHaveLength(2); expect(rows[0]!.attempt_key).toBe(rows[1]!.attempt_key);
    await h.db.prepare("UPDATE signal_admission_v1_attempts SET disputed=1 WHERE namespace=?").bind(rows[0]!.namespace).run();
    let sends = 0;
    const results = [];
    for (let i = 0; i < 2; i++) results.push(await dispatchSignalAdmission(h.db, async body => { sends++; return ack(body); }, () => f.now));
    expect(results.sort()).toEqual(["ACKNOWLEDGED", "QUARANTINED"]); expect(sends).toBe(1);
  } finally { await h.dispose(); }
});
it.each(["dispute", "quarantine", "cutover"])('rechecks %s between claim and send', async change => {
  const h = await createAdmissionDb({ queuedAt: 100, expiresAt: 200 });
  try {
    const claim = await h.claim(100);
    const sql = change === "dispute" ? "UPDATE signal_admission_v1_attempts SET disputed=1" : change === "cutover" ? "UPDATE signal_admission_v1_registrations SET active_generation=2" : "UPDATE signal_admission_v1_streams SET state='QUARANTINED'";
    await h.db.prepare(sql).run();
    expect(await recheckSignalDelivery(h.db, claim!.token!, 100)).toBe(false);
    expect(await h.db.prepare("SELECT status FROM signal_admission_v1_outbox").first("status")).toBe("QUARANTINED");
    expect(await h.finalize(claim!.token!, "ACKNOWLEDGED", 100)).toBe(false);
  } finally { await h.dispose(); }
});
it("allows only one concurrent claim", async () => {
  const h = await createAdmissionDb({ queuedAt: 100, expiresAt: 200 });
  try {
    const claims = await Promise.all([h.claim(100), h.claim(100)]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(claims.find(Boolean)?.delivery_attempts).toBe(1);
  } finally { await h.dispose(); }
});
it("cancels an acknowledgment stream stalled beyond six seconds", async () => {
  const h = await createAdmissionDb({ queuedAt: 100, expiresAt: 200 });
  try {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
    expect(await dispatchSignalAdmission(h.db, async () => new Response(body, { status: 201 }), () => 100)).toBe("RETRY");
    expect(cancelled).toBe(true);
  } finally { await h.dispose(); }
}, 10_000);
it("cannot finalize using an obsolete lease token", async () => {
  const h = await createAdmissionDb({ queuedAt: 100, expiresAt: 200 });
  try {
    const first = await h.claim(100); const second = await h.claim(131);
    expect(first).not.toBeNull(); expect(second).not.toBeNull();
    expect(await h.finalize(first!.token!, "ACKNOWLEDGED", 132)).toBe(false);
    expect(await h.finalize(second!.token!, "ACKNOWLEDGED", 132)).toBe(true);
  } finally { await h.dispose(); }
});
