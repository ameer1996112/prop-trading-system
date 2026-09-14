import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker, { AccountCoordinator, type Env } from '../src/index';
import { handleTelemetryV2 } from '../src/telemetry-sync-v2';
import { canonicalStringify, sha256Hex } from '../src/canonical';
import { localD1V2 } from './support/telemetry-d1-v2';
import { dealFixture, NOW, signFixture, unsignedFixture } from './support/telemetry-fixture-v2';

const bearer = 'synthetic-only-not-a-real-credential';
const pin = () => ({ installation_id: 'synthetic-installation', account_profile_sha256: 'a'.repeat(64),
  account_fingerprint_sha256: 'b'.repeat(64), safety_epoch: 7, last_accepted_request_sequence: 42 });
class PinStorage {
  writes = 0;
  constructor(readonly value: unknown) {}
  async get<T>(key: string): Promise<T | undefined> { return key === 'sync_state_v1' ? structuredClone(this.value) as T : undefined; }
  async put(): Promise<void> { this.writes += 1; throw new Error('V2_MUST_NOT_WRITE_V1'); }
}
type Harness = Awaited<ReturnType<typeof localD1V2>>;
type Intercept = (response: Response) => Response | Promise<Response>;
let local: Harness, env: Env, storage: PinStorage, body: Uint8Array;
let intercept: Intercept | undefined;
let accounts: string[], forwarded: { url: string; method: string; type: string | null; authorization: string | null; body: string }[];
let instances: Map<string, AccountCoordinator>;
const fetchWorker = worker.fetch as (request: Request, env: Env, context: ExecutionContext) => Promise<Response>;
async function incoming(options: { method?: string; headers?: Record<string, string>; payload?: BodyInit; query?: string; environment?: Env } = {}) {
  const method = options.method ?? 'POST';
  const headers = { authorization: `Bearer ${bearer}`, 'content-type': 'application/json', ...options.headers };
  const request = new Request(`https://execution-edge.test/api/v2/agent/sync${options.query ?? ''}`, {
    method, headers, ...(method === 'GET' || method === 'HEAD' ? {} : { body: options.payload ?? body }),
  });
  return fetchWorker(request, options.environment ?? env, {} as ExecutionContext);
}
async function expectFailure(response: Response, status: number, error: string, canonical = true) {
  expect(response.status).toBe(status);
  expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
  expect(response.headers.get('cache-control')).toBe('no-store');
  const bytes = await response.text();
  expect(JSON.parse(bytes)).toEqual({ error, mode: 'DRY_RUN', command: null });
  if (canonical) expect(bytes).toBe(canonicalStringify({ error, mode: 'DRY_RUN', command: null }));
}
beforeEach(async () => {
  local = await localD1V2(); storage = new PinStorage(pin()); instances = new Map(); accounts = []; forwarded = []; intercept = undefined;
  vi.spyOn(Date, 'now').mockReturnValue(NOW * 1000);
  body = await signFixture(unsignedFixture(1, 0, [dealFixture()]));
  env = {
    EXECUTION_DB: local.db, CANDIDATE_INBOX: {} as DurableObjectNamespace,
    CANDIDATE_INBOX_ENABLED: 'false', AGENT_SYNC_ENABLED: 'true', EXECUTION_AUTHORITY_ENABLED: 'false',
    EXECUTION_MODE_CEILING: 'DRY_RUN', ROUTING_MANIFEST_SHA256: 'INERT_NOT_CONFIGURED',
    AGENT_SYNC_SHARED_SECRET_SHA256: await sha256Hex(bearer),
    ACCOUNT_COORDINATOR: {
      idFromName(name: string) { accounts.push(name); return { name }; },
      get(id: { name: string }) {
        return { async fetch(request: Request) {
          forwarded.push({ url: request.url, method: request.method, type: request.headers.get('content-type'),
            authorization: request.headers.get('authorization'), body: await request.clone().text() });
          let instance = instances.get(id.name);
          if (instance === undefined) { instance = new AccountCoordinator({ storage } as unknown as DurableObjectState, env); instances.set(id.name, instance); }
          const response = await instance.fetch(request);
          return intercept === undefined ? response : intercept(response);
        } };
      },
    } as unknown as DurableObjectNamespace,
  };
});
afterEach(async () => { vi.restoreAllMocks(); await local?.close(); });

describe('public telemetry v2 — exported Worker and coordinator with actual D1', () => {
  it('exports the public handler and accepts exact canonical bytes without touching v1 state or authority', async () => {
    expect(typeof handleTelemetryV2).toBe('function');
    const response = await incoming();
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('no-store');
    const bytes = await response.text(); const result = JSON.parse(bytes);
    expect(result).toMatchObject({ schema_version: 'AgentSyncResponseV2', request_sequence: 1, acknowledged_event_sequence: 1, accepted_at_utc_seconds: NOW, mode: 'DRY_RUN', command: null });
    expect(bytes).toBe(canonicalStringify(result));
    expect(accounts).toEqual(['synthetic-account']);
    expect(forwarded).toEqual([{ url: 'https://account-coordinator.internal/sync-v2', method: 'POST', type: 'application/json', authorization: null, body: new TextDecoder().decode(body) }]);
    expect(storage.writes).toBe(0); expect(await storage.get('sync_state_v1')).toEqual(pin());
    expect(await local.db.prepare('SELECT COUNT(*) AS n FROM telemetry_receipt_v2').first<number>('n')).toBe(1);
  });
  it('returns original bytes on a stale retry after a coordinator restart with no extra D1 or pin writes', async () => {
    const first = await incoming(); expect(first.status).toBe(200); const bytes = await first.text(); const writes = local.metrics.writes;
    instances.clear(); vi.spyOn(Date, 'now').mockReturnValue((NOW + 100) * 1000);
    const retry = await incoming(); expect(retry.status).toBe(200); expect(await retry.text()).toBe(bytes);
    expect(local.metrics.writes).toBe(writes); expect(storage.writes).toBe(0); expect(await storage.get('sync_state_v1')).toEqual(pin());
  });
  it('rejects an absent pin independently of identity comparison before D1 access', async () => {
    storage = new PinStorage(undefined);
    await expectFailure(await incoming(), 409, 'TELEMETRY_V1_REGISTRATION_REQUIRED');
    expect(local.metrics.queries).toBe(0); expect(storage.writes).toBe(0);
  });
  it('rejects a full-shaped but mismatched existing pin before D1 access', async () => {
    storage = new PinStorage({ ...pin(), installation_id: 'another-installation' });
    await expectFailure(await incoming(), 409, 'IDENTITY_MISMATCH');
    expect(local.metrics.queries).toBe(0); expect(storage.writes).toBe(0);
  });
  it.each(['', 'Bearer incorrect', 'Basic synthetic', `bearer ${bearer}`])('rejects missing or invalid bearer %s before routing or D1', async (authorization) => {
    await expectFailure(await incoming({ headers: { authorization } }), 401, 'UNAUTHORIZED');
    expect(accounts).toEqual([]); expect(local.metrics.queries).toBe(0);
  });
  it('checks disabled state before method, authentication, and body', async () => {
    await expectFailure(await incoming({ method: 'GET', headers: { authorization: '' }, environment: { ...env, AGENT_SYNC_ENABLED: 'false' } }), 503, 'AGENT_SYNC_DISABLED');
    expect(accounts).toEqual([]); expect(local.metrics.queries).toBe(0);
  });
  it.each(['GET', 'PUT', 'DELETE', 'OPTIONS'])('rejects %s before authentication or D1', async (method) => {
    await expectFailure(await incoming({ method, headers: { authorization: '' } }), 405, 'METHOD_NOT_ALLOWED');
    expect(accounts).toEqual([]); expect(local.metrics.queries).toBe(0);
  });
  it.each([
    ['query', { query: '?account_id=other' }],
    ['encoding', { headers: { 'content-encoding': 'gzip' } }],
    ['empty encoding header', { headers: { 'content-encoding': '' } }],
    ['wrong MIME', { headers: { 'content-type': 'text/plain' } }],
    ['extra MIME parameter', { headers: { 'content-type': 'application/json; charset=utf-8; x=1' } }],
    ['wrong charset', { headers: { 'content-type': 'application/json; charset=utf-16' } }],
    ['missing MIME', { headers: { 'content-type': '' } }],
  ] as const)('rejects invalid %s before D1', async (_name, options) => {
    await expectFailure(await incoming(options), 400, 'TELEMETRY_INVALID');
    expect(accounts).toEqual([]); expect(local.metrics.queries).toBe(0);
  });
  it('accepts the permitted UTF-8 MIME variant case-insensitively', async () => {
    expect((await incoming({ headers: { 'content-type': 'Application/JSON; Charset=UTF-8' } })).status).toBe(200);
  });
  it.each(['malformed', 'noncanonical', 'invalid UTF-8'])('rejects a %s request without routing', async (kind) => {
    const payload = kind === 'malformed' ? '{' : kind === 'noncanonical' ? `${new TextDecoder().decode(body)}\n` : new Uint8Array([0xff]);
    await expectFailure(await incoming({ payload }), 400, 'TELEMETRY_INVALID');
    expect(accounts).toEqual([]); expect(local.metrics.queries).toBe(0);
  });
  it('rejects oversize announced and actual bodies as 413 before D1', async () => {
    await expectFailure(await incoming({ headers: { 'content-length': String(256 * 1024 + 1) } }), 413, 'TELEMETRY_TOO_LARGE');
    await expectFailure(await incoming({ payload: ' '.repeat(256 * 1024 + 1) }), 413, 'TELEMETRY_TOO_LARGE');
    expect(accounts).toEqual([]); expect(local.metrics.queries).toBe(0);
  });
  it('bounds streaming bodies without relying on content-length and cancels excess data', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({ pull(controller) { controller.enqueue(new Uint8Array(128 * 1024)); }, cancel() { cancelled = true; } });
    const request = new Request('https://execution-edge.test/api/v2/agent/sync', {
      method: 'POST', headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' }, body: stream, duplex: 'half',
    } as RequestInit);
    await expectFailure(await fetchWorker(request, env, {} as ExecutionContext), 413, 'TELEMETRY_TOO_LARGE');
    expect(cancelled).toBe(true); expect(local.metrics.queries).toBe(0);
  });
  it('accepts a canonical body split across streaming chunks', async () => {
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(body.slice(0, 200)); controller.enqueue(body.slice(200)); controller.close(); } });
    const request = new Request('https://execution-edge.test/api/v2/agent/sync', {
      method: 'POST', headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' }, body: stream, duplex: 'half',
    } as RequestInit);
    expect((await fetchWorker(request, env, {} as ExecutionContext)).status).toBe(200);
  });
  it.each([
    ['IDENTITY_MISMATCH', 409], ['REPLAY_CONFLICT', 409], ['SEQUENCE_INVALID', 409], ['EVENT_SEQUENCE_INVALID', 409],
    ['TELEMETRY_V1_REGISTRATION_REQUIRED', 409], ['STALE_ENVELOPE', 400], ['TELEMETRY_UNAVAILABLE', 503],
  ] as const)('maps only the allowlisted coordinator error %s with matching status', async (code, status) => {
    intercept = () => new Response(JSON.stringify({ code, mode: 'DRY_RUN', command: null }), { status });
    await expectFailure(await incoming(), status, code);
  });
  it.each(['malformed', 'extra key', 'unknown code', 'wrong status', 'authority', 'command', 'array', 'invalid UTF-8', 'oversize'])('fails closed on a non-200 coordinator %s', async (kind) => {
    const value: any = { code: 'REPLAY_CONFLICT', mode: 'DRY_RUN', command: null };
    if (kind === 'extra key') value.debug = 'private';
    if (kind === 'unknown code') value.code = 'INTERNAL_DATABASE_ERROR';
    if (kind === 'authority') value.mode = 'LIVE';
    if (kind === 'command') value.command = {};
    const payload = kind === 'malformed' ? '{' : kind === 'array' ? '[]' : kind === 'invalid UTF-8' ? new Uint8Array([0xff])
      : kind === 'oversize' ? ' '.repeat(16 * 1024 + 1) : JSON.stringify(value);
    intercept = () => new Response(payload, { status: kind === 'wrong status' ? 400 : 409 });
    await expectFailure(await incoming(), 503, 'TELEMETRY_UNAVAILABLE');
  });
  it.each(['tracking', 'sequence', 'request hash', 'ACK', 'coverage', 'mode', 'command', 'response hash', 'noncanonical'])('fails closed on a corrupted successful response %s', async (kind) => {
    intercept = async (upstream) => {
      const value: any = await upstream.json();
      if (kind === 'tracking') value.identity.tracking_id = 'different-tracking';
      if (kind === 'sequence') value.request_sequence = 2;
      if (kind === 'request hash') value.request_body_sha256 = 'f'.repeat(64);
      if (kind === 'ACK') value.acknowledged_event_sequence = 2;
      if (kind === 'coverage') value.coverage.pending_events = 1;
      if (kind === 'mode') value.mode = 'LIVE';
      if (kind === 'command') value.command = {};
      delete value.response_body_sha256;
      value.response_body_sha256 = kind === 'response hash' ? 'f'.repeat(64) : await sha256Hex(canonicalStringify(value));
      return new Response(`${canonicalStringify(value)}${kind === 'noncanonical' ? '\n' : ''}`);
    };
    await expectFailure(await incoming(), 503, 'TELEMETRY_UNAVAILABLE');
  });
  it.each(['transport', 'oversize success', 'malformed success'])('fails closed on coordinator %s', async (kind) => {
    intercept = () => { if (kind === 'transport') throw new Error('synthetic transport failure'); return new Response(kind === 'oversize success' ? ' '.repeat(16 * 1024 + 1) : '{'); };
    await expectFailure(await incoming(), 503, 'TELEMETRY_UNAVAILABLE');
  });
  it.each([
    ['CANDIDATE_INBOX_ENABLED', 'true'], ['EXECUTION_AUTHORITY_ENABLED', 'true'], ['EXECUTION_MODE_CEILING', 'LIVE'],
    ['ROUTING_MANIFEST_SHA256', 'f'.repeat(64)], ['AGENT_SYNC_ENABLED', 'invalid'],
  ])('cannot bypass the existing unsafe configuration guard: %s', async (key, value) => {
    await expectFailure(await incoming({ environment: { ...env, [key]: value } as Env }), 500, 'UNSAFE_CONFIGURATION', false);
    expect(accounts).toEqual([]); expect(local.metrics.queries).toBe(0);
  });
});
