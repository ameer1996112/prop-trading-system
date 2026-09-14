import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountCoordinatorV1 } from '../src/account-coordinator-v1';
import { telemetryD1V2 } from './support/telemetry-d1-v2';
import { dealFixture, fixture, NOW, signFixture, unsignedFixture } from './support/telemetry-fixture-v2';

type Harness = Awaited<ReturnType<typeof telemetryD1V2>>;
const pin = () => ({ installation_id: 'synthetic-installation', account_profile_sha256: 'a'.repeat(64), account_fingerprint_sha256: 'b'.repeat(64), safety_epoch: 7, last_accepted_request_sequence: 1 });
class PinStorage {
  writes = 0;
  constructor(private readonly value: unknown = pin(), private readonly fail = false, private readonly absent = false) {}
  async get<T>(key: string): Promise<T | undefined> { if (this.fail) throw new Error('storage unavailable'); return key === 'sync_state_v1' && !this.absent ? this.value as T : undefined; }
  async put(): Promise<void> { this.writes += 1; throw new Error('v2 must not write v1 state'); }
}
let local: Harness;
beforeEach(async () => { local = await telemetryD1V2(); vi.spyOn(Date, 'now').mockReturnValue(NOW * 1000); });
afterEach(async () => { vi.restoreAllMocks(); await local.close(); });
const coordinator = (storage: PinStorage, db: D1Database | undefined = local.db) => new AccountCoordinatorV1({ storage } as unknown as DurableObjectState, db === undefined ? undefined : { EXECUTION_DB: db });
const sync = async (instance: AccountCoordinatorV1, raw = unsignedFixture(1, 0, [dealFixture()])) => instance.fetch(new Request('https://internal.test/sync-v2', { method: 'POST', body: await signFixture(raw), headers: { 'content-type': 'application/json' } }));
const syncBytes = (instance: AccountCoordinatorV1, body: Uint8Array) => instance.fetch(new Request('https://internal.test/sync-v2', { method: 'POST', body, headers: { 'content-type': 'application/json' } }));

describe('account coordinator v2 route', () => {
  it('accepts a correctly pinned canonical request without writing v1 storage', async () => {
    const storage = new PinStorage(); const response = await sync(coordinator(storage));
    expect(response.status).toBe(200); expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ acknowledged_event_sequence: 1, mode: 'DRY_RUN', command: null });
    expect(storage.writes).toBe(0); expect(local.metrics.writes).toBeGreaterThan(0);
  });
  it.each([null, {}, { ...pin(), last_accepted_request_sequence: 0 }, { ...pin(), last_accepted_request_sequence: '1' }, { ...pin(), last_accepted_request_sequence: Number.MAX_SAFE_INTEGER + 1 }, { ...pin(), last_accepted_request_sequence: -1 }, { ...pin(), last_accepted_request_sequence: 1.5 }])('refuses an unsafe v1 pin before D1 work', async (value) => {
    const storage = new PinStorage(value); const response = await sync(coordinator(storage));
    expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ code: 'TELEMETRY_V1_REGISTRATION_REQUIRED', mode: 'DRY_RUN', command: null });
    expect(local.metrics.queries).toBe(0); expect(storage.writes).toBe(0);
  });
  it('refuses an absent v1 pin before D1 work', async () => {
    const storage = new PinStorage(pin(), false, true); const response = await sync(coordinator(storage));
    expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ code: 'TELEMETRY_V1_REGISTRATION_REQUIRED' });
    expect(local.metrics.queries).toBe(0); expect(storage.writes).toBe(0);
  });
  it.each(['installation_id', 'account_profile_sha256', 'account_fingerprint_sha256', 'safety_epoch'])('rejects a mismatched pinned %s before D1 writes', async (field) => {
    const changed: any = { ...pin(), [field]: field === 'safety_epoch' ? 8 : 'changed' };
    const response = await sync(coordinator(new PinStorage(changed)));
    expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ code: 'IDENTITY_MISMATCH' }); expect(local.metrics.writes).toBe(0);
  });
  it('maps missing environment, stale NEW, malformed body, and storage failure safely', async () => {
    expect((await sync(new AccountCoordinatorV1({ storage: new PinStorage() } as unknown as DurableObjectState))).status).toBe(503);
    vi.spyOn(Date, 'now').mockReturnValue((NOW + 31) * 1000);
    expect((await sync(coordinator(new PinStorage()))).status).toBe(400);
    vi.spyOn(Date, 'now').mockReturnValue(NOW * 1000);
    const malformed = await coordinator(new PinStorage()).fetch(new Request('https://internal.test/sync-v2', { method: 'POST', body: '{' }));
    expect(malformed.status).toBe(503); expect(await malformed.json()).toMatchObject({ code: 'TELEMETRY_UNAVAILABLE', command: null });
    const failedStorage = await sync(coordinator(new PinStorage(pin(), true)));
    expect(failedStorage.status).toBe(503); expect(await failedStorage.json()).toMatchObject({ code: 'TELEMETRY_UNAVAILABLE', command: null });
  });
  it('replays exact bytes after a restart without D1 writes or v1 mutation', async () => {
    const storage = new PinStorage(); const raw = unsignedFixture(1, 0, [dealFixture()]);
    const first = await sync(coordinator(storage), raw); const bytes = await first.text(); const writes = local.metrics.writes;
    vi.spyOn(Date, 'now').mockReturnValue((NOW + 100) * 1000);
    const retry = await sync(coordinator(storage, local.connect()), raw);
    expect(await retry.text()).toBe(bytes); expect(local.metrics.writes).toBe(writes); expect(storage.writes).toBe(0);
  });
  it('returns TELEMETRY_BUSY for a ninth same-instance request while eight are queued', async () => {
    let arrived!: () => void; const entered = new Promise<void>((resolve) => { arrived = resolve; });
    let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; });
    local.faults.beforeAcceptance = async () => { delete local.faults.beforeAcceptance; arrived(); await gate; };
    const instance = coordinator(new PinStorage()); const body = await signFixture(unsignedFixture(1, 0, [dealFixture()]));
    const accepted = [syncBytes(instance, body)]; await entered;
    for (let index = 1; index < 8; index += 1) accepted.push(syncBytes(instance, body));
    const busy = await syncBytes(instance, body);
    expect(busy.status).toBe(503); expect(await busy.json()).toMatchObject({ code: 'TELEMETRY_UNAVAILABLE', mode: 'DRY_RUN', command: null });
    release();
    const bytes = await Promise.all(accepted.map(async (response) => (await response).text()));
    expect(bytes.every((value) => value === bytes[0])).toBe(true);
    expect((await local.db.prepare('SELECT COUNT(*) AS n FROM telemetry_receipt_v2').first<number>('n'))).toBe(1);
  });
  it('exercises D1 CAS across two coordinator instances for a concurrent same-body arrival', async () => {
    let arrived = 0; let release!: () => void;
    const ready = new Promise<void>((resolve) => { release = resolve; });
    local.faults.beforeAcceptance = async () => { arrived += 1; if (arrived === 2) { delete local.faults.beforeAcceptance; release(); } await ready; };
    const raw = unsignedFixture(1, 0, [dealFixture()]);
    const [left, right] = await Promise.all([sync(coordinator(new PinStorage()), raw), sync(coordinator(new PinStorage(), local.connect()), raw)]);
    expect(left.status).toBe(200); expect(right.status).toBe(200); expect(await left.text()).toBe(await right.text());
  });
});
