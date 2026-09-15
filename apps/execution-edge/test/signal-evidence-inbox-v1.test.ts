import { afterEach, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { handleSignalEvidenceInbox, type InboxEnv } from '../src/signal-evidence-inbox-v1';
import { createInboxDb } from './support/signal-evidence-inbox-d1-v1';
import worker, { type Env } from '../src/index';

const vectors = JSON.parse(await readFile(new URL('../../../contracts/vectors/signal-admission-v1.json', import.meta.url), 'utf8'));
// Independent test oracle: never call the receiver's serializer or digest code.
function canonical(value: any): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}
const digest = (value: any) => createHash('sha256').update(canonical(value)).digest('hex');
const credentialDigest = createHash('sha256').update(vectors.delivery_credential).digest('hex');
function rehash(body: any, inner = false) {
  if (inner) { delete body.evidence.evidence_body_sha256; body.evidence.evidence_body_sha256 = digest(body.evidence); body.evidence_body_sha256 = body.evidence.evidence_body_sha256; }
  delete body.delivery_body_sha256; body.delivery_body_sha256 = digest(body);
}
const disposals: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.all(disposals.splice(0).map(dispose => dispose())); });

async function inboxFixture(vector = vectors.deliveries[0]) {
  const local = await createInboxDb(); disposals.push(local.dispose);
  const body = structuredClone(vector.body);
  const env: InboxEnv = { EXECUTION_DB: local.db, SIGNAL_EVIDENCE_INBOX_ENABLED: 'true', SIGNAL_DELIVERY_SECRET_SHA256: credentialDigest };
  return { ...local, body, env, now: 2401, request: (raw = JSON.stringify(body), authorization = `Bearer ${vectors.delivery_credential}`) => new Request('https://inbox.test/internal/signal-evidence-v1', { method: 'POST', headers: { 'content-type': 'application/json', authorization }, body: raw }) };
}

describe('private evidence inbox V1', () => {
  it('stores the shared literal delivery before acknowledging', async () => {
    const f = await inboxFixture();
    const response = await handleSignalEvidenceInbox(f.request(), f.env, f.now);
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual(vectors.deliveries[0].stored_ack);
    expect(await f.count()).toBe(1);
  });

  it.each(vectors.deliveries as Array<{ case_id: string; accepted: boolean; body: any; stored_ack: any; duplicate_ack: any }>)('matches literal vector $case_id and exact duplicate acknowledgment', async vector => {
    const f = await inboxFixture(vector);
    const first = await handleSignalEvidenceInbox(f.request(), f.env, f.now);
    expect(first.status).toBe(vector.accepted ? 201 : 422);
    if (vector.accepted) {
      expect(await first.json()).toEqual(vector.stored_ack);
      const retry = await handleSignalEvidenceInbox(f.request(), f.env, 3000);
      expect(retry.status).toBe(200); expect(await retry.json()).toEqual(vector.duplicate_ack);
    }
    expect(await f.count()).toBe(vector.accepted ? 1 : 0);
  });

  it('does not acknowledge a mismatched delivery digest', async () => {
    const f = await inboxFixture(); f.body.delivery_body_sha256 = '0'.repeat(64);
    expect((await handleSignalEvidenceInbox(f.request(), f.env, f.now)).status).toBe(422);
    expect(await f.count()).toBe(0);
  });

  it('recomputes the nested evidence digest even when the outer digest matches', async () => {
    const f = await inboxFixture(); f.body.evidence.source_observation.event_id = 'changed'; rehash(f.body);
    expect((await handleSignalEvidenceInbox(f.request(), f.env, f.now)).status).toBe(422); expect(await f.count()).toBe(0);
  });

  const mutations: Array<[string, (body: any) => void]> = [
    ['outer command', b => { b.command = null; }],
    ['inner account', b => { b.evidence.account_id = 'account'; }],
    ['selection volume', b => { b.evidence.selected.volume = 1; }],
    ['candidate command', b => { b.evidence.selected.candidate.command = 'BUY'; }],
    ['source order', b => { b.evidence.source_observation.order = {}; }],
    ['nested source extra', b => { b.evidence.source_observation.setups[0].setup.account = 'x'; }],
    ['outer authority', b => { b.authority = 'EXECUTION'; }],
    ['inner execution', b => { b.evidence.execution_allowed = true; }],
    ['wrong attempt', b => { b.attempt_key = '1'.repeat(64); }],
    ['wrong evidence', b => { b.evidence_id = '1'.repeat(64); }],
    ['wrong receipt', b => { b.receipt_id = '1'.repeat(64); }],
    ['wrong delivery ID', b => { b.delivery_id = '1'.repeat(64); }],
    ['unknown selected model', b => { b.evidence.selected.candidate.model = 'MARKET'; }],
    ['unknown evaluation model', b => { b.evidence.edge_evaluation.candidates[0].model = 'MARKET'; }],
    ['unknown source model', b => { b.evidence.source_observation.setups[0].candidates[0].model = 'MARKET'; }],
    ['wrong selected identity', b => { b.evidence.selected.evidence.candidate_id = '1'.repeat(64); }],
    ['wrong selection identity', b => { b.evidence.edge_evaluation.selection.canonical_evidence_id = '1'.repeat(64); }],
    ['wrong selected copy', b => { b.evidence.selected.evidence.observed_trigger_ticks++; }],
    ['relabelled fidelity', b => { b.evidence.selected.evidence.replayability = 'REPLAYABLE'; }],
    ['changed namespace without identity', b => { b.evidence.reviewed_binding.producer_namespace = 'other'; }],
    ['binding mismatch', b => { b.evidence.reviewed_binding.ticker_id = 'OTHER'; }],
    ['unreviewed zero detector digest', b => { b.evidence.reviewed_binding.detector_code_hash = '0'.repeat(64); b.evidence.source_observation.detector_code_hash = '0'.repeat(64); }],
    ['unreviewed zero settings digest', b => { b.evidence.reviewed_binding.settings_hash = '0'.repeat(64); b.evidence.source_observation.settings_hash = '0'.repeat(64); }],
    ['generation zero', b => { b.generation = 0; }],
    ['sequence zero', b => { b.evidence.source_observation.producer_sequence = 0; }],
    ['negative admission', b => { b.admitted_at_epoch = -1; }],
    ['empty expiry window', b => { b.expires_at_epoch = b.admitted_at_epoch; }],
    ['unsafe expiry', b => { b.expires_at_epoch = Number.MAX_SAFE_INTEGER + 1; }],
    ['bad digest spelling', b => { b.evidence.formation_body_sha256 = 'A'.repeat(64); }],
    ['changed formation identity', b => { b.evidence.formation.origin_epoch += 300; }],
    ['duplicate candidate identity', b => { b.evidence.edge_evaluation.candidates.push(b.evidence.edge_evaluation.candidates[0]); }],
  ];
  it.each(mutations)('rejects %s with independently recomputed body hashes', async (_name, mutate) => {
    const f = await inboxFixture(); mutate(f.body); rehash(f.body, true);
    expect((await handleSignalEvidenceInbox(f.request(), f.env, f.now)).status).toBe(422); expect(await f.count()).toBe(0);
  });

  it('retains exactly one immutable row under concurrent duplicates', async () => {
    const f = await inboxFixture();
    const results = await Promise.all(Array.from({ length: 8 }, () => handleSignalEvidenceInbox(f.request(), f.env, f.now)));
    expect(results.filter(r => r.status === 201)).toHaveLength(1); expect(results.filter(r => r.status === 200)).toHaveLength(7);
    expect(await f.count()).toBe(1);
    await expect(f.db.prepare('UPDATE signal_evidence_inbox_v1 SET received_at_epoch=3000').run()).rejects.toThrow();
    await expect(f.db.prepare('DELETE FROM signal_evidence_inbox_v1').run()).rejects.toThrow();
    const row = await f.db.prepare('SELECT * FROM signal_evidence_inbox_v1').first<any>();
    expect(row.authority).toBe('EVIDENCE_ONLY'); expect(row.execution_allowed).toBe(0); expect(row.body).toBe(canonical(f.body));
    expect(JSON.stringify(row)).not.toContain(vectors.delivery_credential);
  });

  it('returns conflict for a valid changed body under the same delivery ID', async () => {
    const f = await inboxFixture(); expect((await handleSignalEvidenceInbox(f.request(), f.env, f.now)).status).toBe(201);
    f.body.expires_at_epoch++; rehash(f.body);
    expect((await handleSignalEvidenceInbox(f.request(), f.env, f.now)).status).toBe(409); expect(await f.count()).toBe(1);
  });

  it('arbitrates conflicting deliveries for one namespaced attempt without replacement', async () => {
    const f = await inboxFixture(); const second = structuredClone(f.body);
    second.evidence.source_observation.event_id = 'second-event';
    second.evidence.evidence_id = digest({ domain: 'tradeops-signal-evidence-id-v1', producer_namespace: second.evidence.reviewed_binding.producer_namespace, producer_instance_id: second.evidence.source_observation.producer_instance_id, event_id: 'second-event', producer_sequence: second.evidence.source_observation.producer_sequence, attempt_key: second.attempt_key });
    second.evidence_id = second.evidence.evidence_id;
    second.delivery_id = digest({ schema_version: 'TradeOpsSignalDeliveryIdentityV1', attempt_key: second.attempt_key, evidence_id: second.evidence_id }); rehash(second, true);
    const results = await Promise.all([handleSignalEvidenceInbox(f.request(), f.env, f.now), handleSignalEvidenceInbox(f.request(JSON.stringify(second)), f.env, f.now)]);
    expect(results.map(r => r.status).sort()).toEqual([201, 409]); expect(await f.count()).toBe(1);
  });

  it('allows the same economic key in a different validated namespace', async () => {
    const f = await inboxFixture(); expect((await handleSignalEvidenceInbox(f.request(), f.env, f.now)).status).toBe(201);
    const e = f.body.evidence; e.reviewed_binding.producer_namespace = 'another-namespace';
    e.evidence_id = digest({ domain: 'tradeops-signal-evidence-id-v1', producer_namespace: e.reviewed_binding.producer_namespace, producer_instance_id: e.source_observation.producer_instance_id, event_id: e.source_observation.event_id, producer_sequence: e.source_observation.producer_sequence, attempt_key: e.attempt_key });
    f.body.evidence_id = e.evidence_id; f.body.delivery_id = digest({ schema_version: 'TradeOpsSignalDeliveryIdentityV1', attempt_key: e.attempt_key, evidence_id: e.evidence_id }); rehash(f.body, true);
    expect((await handleSignalEvidenceInbox(f.request(), f.env, f.now)).status).toBe(201); expect(await f.count()).toBe(2);
  });

  it.each([2399, 2420, 3000])('refuses a new delivery outside its immutable time window at %s', async now => {
    const f = await inboxFixture(); expect((await handleSignalEvidenceInbox(f.request(), f.env, now)).status).toBe(422); expect(await f.count()).toBe(0);
  });

  it.each(['', 'Bearer wrong', 'Basic abc', `Bearer ${vectors.delivery_credential} extra`])('uses the same generic authentication response for %s', async authorization => {
    const f = await inboxFixture(); const response = await handleSignalEvidenceInbox(f.request(undefined, authorization), f.env, f.now);
    expect(response.status).toBe(401); expect(await response.json()).toEqual({ authority: 'EVIDENCE_ONLY', execution_allowed: false, error: 'UNAUTHORIZED' }); expect(await f.count()).toBe(0);
  });

  it.each([undefined, '', 'bad', 'A'.repeat(64)])('fails closed with missing or malformed service secret %s', async secret => {
    const f = await inboxFixture(); delete f.env.SIGNAL_DELIVERY_SECRET_SHA256; if (secret !== undefined) f.env.SIGNAL_DELIVERY_SECRET_SHA256 = secret;
    const response = await handleSignalEvidenceInbox(f.request(), f.env, f.now); expect(response.status).toBe(401); expect(await response.text()).not.toContain(vectors.delivery_credential);
  });

  it('is off by default and rejects methods before storage access', async () => {
    const env: InboxEnv = { get EXECUTION_DB(): D1Database { throw new Error('must not access DB'); } };
    expect((await handleSignalEvidenceInbox(new Request('https://inbox.test/'), env, 2400)).status).toBe(404);
    env.SIGNAL_EVIDENCE_INBOX_ENABLED = 'true';
    expect((await handleSignalEvidenceInbox(new Request('https://inbox.test/'), env, 2400)).status).toBe(405);
  });

  it.each(['{"schema_version":1,"schema_version":2}', '{', '[1]', '{"x":1e1}', '{"x":-0}', '{"x":1.0}', '{"x":9007199254740992}', '['.repeat(66) + '0' + ']'.repeat(66), '[' + '0,'.repeat(20000) + '0]'])('rejects malformed, noncanonical or over-budget JSON', async raw => {
    const f = await inboxFixture(); const r = await handleSignalEvidenceInbox(f.request(raw), f.env, f.now);
    expect([400, 422]).toContain(r.status); expect(await f.count()).toBe(0);
  });

  it('bounds streamed body bytes even without Content-Length', async () => {
    const f = await inboxFixture(); let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({ pull(controller) { controller.enqueue(new Uint8Array(140000)); }, cancel() { cancelled = true; } });
    const request = new Request(f.request().url, { method: 'POST', headers: f.request().headers, body: stream, duplex: 'half' } as RequestInit);
    const response = await handleSignalEvidenceInbox(request, f.env, f.now);
    expect(response.status).toBe(413); expect(cancelled).toBe(true); expect(await f.count()).toBe(0);
  });

  it('redacts storage faults and keeps every error no-store', async () => {
    const f = await inboxFixture(); f.env.EXECUTION_DB = { prepare() { throw new Error('private database details'); } } as unknown as D1Database;
    const response = await handleSignalEvidenceInbox(f.request(), f.env, f.now);
    expect(response.status).toBe(503); expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ authority: 'EVIDENCE_ONLY', execution_allowed: false, error: 'UNAVAILABLE' });
  });

  it('resolves a lost database commit reply on a later duplicate without replay', async () => {
    const f = await inboxFixture(); let lost = false;
    const wrapped = new Proxy(f.db, { get(target, key) {
      if (key !== 'prepare') { const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value; }
      return (sql: string) => {
        function wrap(statement: D1PreparedStatement): D1PreparedStatement {
          return new Proxy(statement, { get(target, key) {
            if (key === 'bind') return (...values: unknown[]) => wrap(target.bind(...values));
            if (key === 'run' && sql.includes('INSERT INTO signal_evidence_inbox_v1')) return async () => { const result = await target.run(); if (!lost) { lost = true; throw new Error('LOCAL_LOST_REPLY'); } return result; };
            const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
          } });
        }
        return wrap(target.prepare(sql));
      };
    } });
    f.env.EXECUTION_DB = wrapped;
    expect((await handleSignalEvidenceInbox(f.request(), f.env, f.now)).status).toBe(503); expect(await f.count()).toBe(1);
    const retry = await handleSignalEvidenceInbox(f.request(), f.env, 3000);
    expect(retry.status).toBe(200); expect(await retry.json()).toEqual(vectors.deliveries[0].duplicate_ack); expect(await f.count()).toBe(1);
  });

  it('rejects oversized inner evidence below the outer transport cap', async () => {
    const f = await inboxFixture(); const rules = f.body.evidence.source_observation.setups[0].setup.common_rule_results;
    while (canonical(f.body.evidence).length <= 262144) rules.push({ rule_id: 'x'.repeat(250), passed: true });
    rehash(f.body, true); expect(canonical(f.body).length).toBeLessThan(278528);
    expect((await handleSignalEvidenceInbox(f.request(), f.env, f.now)).status).toBe(422); expect(await f.count()).toBe(0);
  });

  it('rejects malformed UTF-8 and unsupported content type', async () => {
    const f = await inboxFixture();
    const invalid = new Request(f.request().url, { method: 'POST', headers: f.request().headers, body: new Uint8Array([0xc3, 0x28]) });
    expect((await handleSignalEvidenceInbox(invalid, f.env, f.now)).status).toBe(422);
    const request = f.request(); request.headers.set('content-type', 'text/plain');
    expect((await handleSignalEvidenceInbox(request, f.env, f.now)).status).toBe(415); expect(await f.count()).toBe(0);
  });

  it('never accesses execution capabilities through the gated Worker route', async () => {
    const f = await inboxFixture();
    const env = { ...f.env, CANDIDATE_INBOX_ENABLED: 'false', AGENT_SYNC_ENABLED: 'false', EXECUTION_AUTHORITY_ENABLED: 'false', EXECUTION_MODE_CEILING: 'DRY_RUN', ROUTING_MANIFEST_SHA256: 'INERT_NOT_CONFIGURED',
      get ACCOUNT_COORDINATOR(): DurableObjectNamespace { throw new Error('account capability must remain unreachable'); },
      get CANDIDATE_INBOX(): DurableObjectNamespace { throw new Error('candidate capability must remain unreachable'); },
    } as Env;
    const fetch = worker.fetch as (request: Request, env: Env, ctx: ExecutionContext) => Promise<Response>;
    const originalNow = Date.now; Date.now = () => f.now * 1000;
    try {
      const r = await fetch(f.request(), env, {} as ExecutionContext);
      expect(r.status).toBe(201); expect(await r.json()).toEqual(vectors.deliveries[0].stored_ack);
      env.SIGNAL_EVIDENCE_INBOX_ENABLED = 'false';
      const disabled = await fetch(f.request(), env, {} as ExecutionContext);
      expect(disabled.status).toBe(404); expect(await disabled.json()).toEqual({ authority: 'EVIDENCE_ONLY', execution_allowed: false, error: 'NOT_FOUND' });
    } finally { Date.now = originalNow; }
    expect(await f.db.prepare('SELECT count(*) AS n FROM agent_sync_audit_v1').first<number>('n')).toBe(0);
  });

  it('ships both execution profiles with the inbox disabled', async () => {
    for (const name of ['wrangler.jsonc', 'wrangler.dry-run.jsonc']) {
      const config = JSON.parse(await readFile(new URL(`../${name}`, import.meta.url), 'utf8'));
      expect(config.vars.SIGNAL_EVIDENCE_INBOX_ENABLED).toBe('false');
      expect(config.vars.EXECUTION_AUTHORITY_ENABLED).toBe('false');
      expect(config.vars.SIGNAL_DELIVERY_SECRET_SHA256).toBeUndefined();
    }
  });

  it.each(['candidate_id', 'evidence_id', 'payload_sha256', 'selection_id'])('rejects a consistently substituted selected %s', async field => {
    const f = await inboxFixture(); const e = f.body.evidence;
    const original = field === 'candidate_id' ? e.selected.candidate.candidate_id : field === 'selection_id' ? e.edge_evaluation.selection.selection_id : e.selected.evidence[field];
    const changed = JSON.parse(JSON.stringify(f.body).replaceAll(original, '1'.repeat(64)));
    rehash(changed, true);
    expect((await handleSignalEvidenceInbox(f.request(JSON.stringify(changed)), f.env, f.now)).status).toBe(422); expect(await f.count()).toBe(0);
  });

  it('preserves already validated records observed before the enclosing observation', async () => {
    const f = await inboxFixture(); f.body.evidence.source_observation.observed_at_epoch++;
    rehash(f.body, true);
    expect((await handleSignalEvidenceInbox(f.request(), f.env, f.now)).status).toBe(201);
  });

  it('does not convert a database insert failure to a duplicate acknowledgment', async () => {
    const f = await inboxFixture();
    await f.db.prepare("CREATE TRIGGER local_inbox_insert_fault BEFORE INSERT ON signal_evidence_inbox_v1 BEGIN SELECT RAISE(ABORT,'LOCAL_PRIVATE_FAULT'); END").run();
    const r = await handleSignalEvidenceInbox(f.request(), f.env, f.now);
    expect(r.status).toBe(503); expect(await r.text()).not.toContain('LOCAL_PRIVATE_FAULT'); expect(await f.count()).toBe(0);
  });

  it('makes all response classes evidence-only and no-store', async () => {
    const f = await inboxFixture(); const statuses: number[] = [];
    const calls = [
      () => handleSignalEvidenceInbox(f.request(), { ...f.env, SIGNAL_EVIDENCE_INBOX_ENABLED: 'false' }, f.now),
      () => handleSignalEvidenceInbox(new Request(f.request().url), f.env, f.now),
      () => handleSignalEvidenceInbox(f.request(undefined, 'Bearer wrong'), f.env, f.now),
      () => handleSignalEvidenceInbox(f.request('{'), f.env, f.now),
      () => handleSignalEvidenceInbox(f.request('x'.repeat(278529)), f.env, f.now),
      () => handleSignalEvidenceInbox(f.request(), f.env, f.now),
      () => handleSignalEvidenceInbox(f.request(), f.env, f.now),
      () => { f.body.expires_at_epoch++; rehash(f.body); return handleSignalEvidenceInbox(f.request(), f.env, f.now); },
    ];
    for (const call of calls) {
      const r = await call(); statuses.push(r.status); expect(r.headers.get('cache-control')).toBe('no-store');
      const body = await r.json(); expect(body).toMatchObject({ authority: 'EVIDENCE_ONLY', execution_allowed: false });
      expect(body).not.toHaveProperty('command'); expect(JSON.stringify(body)).not.toContain(vectors.delivery_credential);
    }
    expect(statuses).toEqual([404, 405, 401, 422, 413, 201, 200, 409]);
  });
});
