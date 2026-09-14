import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { canonicalStringify, sha256Hex } from '../src/canonical';
import { acceptTelemetryV2, JOURNAL_SQL_V2, scopeV2, statementsV2 } from '../src/telemetry-repository-v2';
import { parseTelemetryV2, responseBytesV2 } from '../src/telemetry-wire-v2';
import { telemetryD1V2 } from './support/telemetry-d1-v2';
import { dealFixture, f, fixture, missing, NOW, positionFixture, r, signFixture, unsignedFixture } from './support/telemetry-fixture-v2';

type Harness = Awaited<ReturnType<typeof telemetryD1V2>>;
let local: Harness;
beforeEach(async () => { local = await telemetryD1V2(); });
afterEach(async () => { await local?.close(); });
const tables = ['telemetry_session_v2', 'telemetry_receipt_v2', 'telemetry_event_v2', 'telemetry_deal_current_v2'];
async function counts() { return Promise.all(tables.map((table) => local.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<number>('n'))); }
async function request(sequence = 1, ack = 0, events: any[] = [], mutate?: (raw: any) => void) {
  const raw = unsignedFixture(sequence, ack, events); mutate?.(raw);
  return parseTelemetryV2(await signFixture(raw));
}
async function rows(table: string) { return (await local.db.prepare(`SELECT * FROM ${table}`).all<any>()).results; }
function twoClaimBarrier() {
  let arrived = 0; let release!: () => void;
  const ready = new Promise<void>((resolve) => { release = resolve; });
  local.faults.beforeAcceptance = async () => { arrived += 1; if (arrived === 2) { delete local.faults.beforeAcceptance; release(); } await ready; };
}

describe('telemetry repository v2 — actual local D1', () => {
  it.each(['statements', 'accept'])('rejects a runtime-forged 33-event request before %s performs database work', async (entry) => {
    const parsed = await fixture();
    const forged: any = { ...parsed, events: Array.from({ length: 33 }, (_, index) => dealFixture(index + 1)),
      collection: { ...parsed.collection, produced_events: 33 }, diagnostics: { ...parsed.diagnostics, local_unsent_events: 33 } };
    const scope = await scopeV2(parsed);
    if (entry === 'statements') expect(() => statementsV2(local.db, forged, scope, 0, 33, NOW, '{}')).toThrow('TELEMETRY_TOO_LARGE');
    else await expect(acceptTelemetryV2(local.db, forged, NOW)).rejects.toThrow('TELEMETRY_TOO_LARGE');
    expect(local.metrics.queries).toBe(0);
    expect(local.metrics.writes).toBe(0);
    expect(await counts()).toEqual([0, 0, 0, 0]);
  });
  it.each([null, {}, 'not-an-array'])('rejects malformed runtime event lists before any D1 operation: %s', async (events) => {
    const parsed = await fixture(); const forged: any = { ...parsed, events };
    expect(() => statementsV2(local.db, forged, 'unused', 0, 0, NOW, '{}')).toThrow('TELEMETRY_INVALID');
    await expect(acceptTelemetryV2(local.db, forged, NOW)).rejects.toThrow('TELEMETRY_INVALID');
    expect(local.metrics.queries).toBe(0);
    expect(local.metrics.writes).toBe(0);
  });
  it('accepts all 32 valid events without truncation in the same four-statement transaction', async () => {
    const req = await fixture(1, 0, Array.from({ length: 32 }, (_, index) => dealFixture(index + 1)));
    const response = JSON.parse(await acceptTelemetryV2(local.db, req, NOW));
    expect(response.acknowledged_event_sequence).toBe(32);
    expect(await counts()).toEqual([1, 1, 32, 32]);
    expect(local.metrics.maxBatch).toBe(4);
  });
  it('commits a contiguous durable ACK and an indexed immutable journal in exactly four statements', async () => {
    const req = await fixture(1, 0, [dealFixture(1), dealFixture(2)]);
    const bytes = await acceptTelemetryV2(local.db, req, NOW);
    expect(JSON.parse(bytes)).toMatchObject({ acknowledged_event_sequence: 2, accepted_at_utc_seconds: NOW, mode: 'DRY_RUN', command: null });
    expect(await counts()).toEqual([1, 1, 2, 2]);
    expect((await rows(tables[0]!))[0]).toMatchObject({ last_request_sequence: 1, last_event_sequence: 2 });
    const journal = await local.db.prepare(JOURNAL_SQL_V2).bind(await scopeV2(req), 3).all<any>();
    expect(journal.results.map((row) => row.sequence)).toEqual([2, 1]);
    expect(JSON.parse(journal.results[0].projection_json).net_recorded).toEqual({ value: '9.70', scale: 2 });
    const plan = await local.db.prepare(`EXPLAIN QUERY PLAN ${JOURNAL_SQL_V2}`).bind(await scopeV2(req), 3).all<any>();
    expect(plan.results.some((row) => String(row.detail).includes('SEARCH'))).toBe(true);
    expect(local.metrics.maxBatch).toBe(4);
    expect(local.metrics.writes).toBeGreaterThan(0);
  });
  it('replays stale requests byte-for-byte without writes or refreshed acceptance time', async () => {
    const req = await fixture(1, 0, [dealFixture()]);
    const bytes = await acceptTelemetryV2(local.db, req, NOW);
    const writes = local.metrics.writes;
    expect(await acceptTelemetryV2(local.connect(), req, NOW + 3600)).toBe(bytes);
    expect(local.metrics.writes).toBe(writes);
    expect(JSON.parse(bytes).accepted_at_utc_seconds).toBe(NOW);
  });
  it('rejects changed bodies on an accepted sequence without writes', async () => {
    await acceptTelemetryV2(local.db, await fixture(), NOW);
    const changed = await request(1, 0, [], (raw) => { raw.diagnostics.terminal_build += 1; });
    const writes = local.metrics.writes;
    await expect(acceptTelemetryV2(local.db, changed, NOW)).rejects.toThrow('REPLAY_CONFLICT');
    expect(local.metrics.writes).toBe(writes);
  });
  it.each([0, 1, 2, 3, 4])('rolls back every table when a CHECK fails at transaction boundary %s, then retries', async (index) => {
    const req = await fixture(1, 0, [dealFixture()]); local.faults.beforeStatement = index;
    await expect(acceptTelemetryV2(local.db, req, NOW)).rejects.toThrow('TELEMETRY_STORAGE_UNAVAILABLE');
    expect(await counts()).toEqual([0, 0, 0, 0]);
    local.faults.beforeStatement = -1;
    expect(JSON.parse(await acceptTelemetryV2(local.db, req, NOW)).acknowledged_event_sequence).toBe(1);
    expect(await counts()).toEqual([1, 1, 1, 1]);
  });
  it('recovers the committed receipt after a lost reply without duplicate P&L', async () => {
    const req = await fixture(1, 0, [dealFixture()]); local.faults.afterCommit = true;
    const bytes = await acceptTelemetryV2(local.db, req, NOW);
    expect(await acceptTelemetryV2(local.db, req, NOW + 100)).toBe(bytes);
    expect(await counts()).toEqual([1, 1, 1, 1]);
    expect(JSON.parse((await rows(tables[2]!))[0].projection_json).net_recorded).toEqual({ value: '9.70', scale: 2 });
  });
  it('rejects fresh sequence gaps, stale NEW envelopes and mismatched client ACKs', async () => {
    await expect(acceptTelemetryV2(local.db, await fixture(), NOW + 31)).rejects.toThrow('STALE_ENVELOPE');
    await expect(acceptTelemetryV2(local.db, await fixture(), NOW - 31)).rejects.toThrow('STALE_ENVELOPE');
    await expect(acceptTelemetryV2(local.db, await fixture(2), NOW)).rejects.toThrow('SEQUENCE_INVALID');
    await expect(acceptTelemetryV2(local.db, await fixture(1, 0, [dealFixture(2)]), NOW)).rejects.toThrow('EVENT_SEQUENCE_INVALID');
    await expect(acceptTelemetryV2(local.db, await fixture(1, 1), NOW)).rejects.toThrow('EVENT_SEQUENCE_INVALID');
    expect(await counts()).toEqual([0, 0, 0, 0]);
  });
  it.each(['tracking', 'display', 'baseline'])('rejects immutable registration drift in %s', async (part) => {
    await acceptTelemetryV2(local.db, await fixture(), NOW);
    const changed = await request(2, 0, [], (raw) => {
      if (part === 'tracking') { raw.identity.tracking_id = 'changed'; raw.registration.boundary.tracking_id = 'changed'; }
      if (part === 'display') raw.registration.display.company = 'Changed Broker';
      if (part === 'baseline') { raw.registration.baseline.positions = [positionFixture()]; raw.registration.baseline.position_count = 1; }
    });
    await expect(acceptTelemetryV2(local.db, changed, NOW)).rejects.toThrow('IDENTITY_MISMATCH');
    expect(await counts()).toEqual([1, 1, 0, 0]);
  });
  it('retains original events while a cancellation revision replaces the current pointer', async () => {
    const first = await fixture(1, 0, [dealFixture()]);
    await acceptTelemetryV2(local.db, first, NOW);
    const event: any = dealFixture(2);
    Object.assign(event.record, { deal_id: '1', revision: 2, previous_record_sha256: first.events[0]!.record_sha256, type: 'BUY_CANCELED',
      profit: r('0.00'), commission: r('0.00'), swap: r('0.00'), fee: r('0.00') });
    await acceptTelemetryV2(local.db, await fixture(2, 1, [event]), NOW);
    expect(await counts()).toEqual([1, 2, 2, 1]);
    const journal = await rows(tables[2]!);
    expect(JSON.parse(journal[0].event_json)).toEqual(first.events[0]);
    expect(JSON.parse(journal[0].projection_json).net_recorded).toEqual({ value: '9.70', scale: 2 });
    expect(JSON.parse(journal[1].projection_json)).toMatchObject({ cancelled: true, net_recorded: { value: '0.00', scale: 2 } });
    expect((await rows(tables[3]!))[0]).toMatchObject({ sequence: 2, revision: 2, record_digest: journal[1].record_digest });
    const current = await local.db.prepare(`SELECT e.projection_json FROM telemetry_deal_current_v2 c
      JOIN telemetry_event_v2 e ON e.scope = c.scope AND e.sequence = c.sequence`).first<any>();
    expect(JSON.parse(current.projection_json).net_recorded).toEqual({ value: '0.00', scale: 2 });
    await expect(local.db.prepare('UPDATE telemetry_event_v2 SET event_json = event_json').run()).rejects.toThrow();
    await expect(local.db.prepare('DELETE FROM telemetry_event_v2').run()).rejects.toThrow();
  });
  it.each(['revision', 'previous digest', 'event ID'])('rolls back every attempted write on a conflicting %s', async (part) => {
    const first = await fixture(1, 0, [dealFixture()]); await acceptTelemetryV2(local.db, first, NOW);
    const event: any = dealFixture(2);
    Object.assign(event.record, { deal_id: '1', revision: 2, previous_record_sha256: first.events[0]!.record_sha256 });
    if (part === 'revision') event.record.revision = 3;
    if (part === 'previous digest') event.record.previous_record_sha256 = 'f'.repeat(64);
    if (part === 'event ID') event.event_id = 'event-1';
    await expect(acceptTelemetryV2(local.db, await fixture(2, 1, [event]), NOW)).rejects.toThrow('TELEMETRY_STORAGE_UNAVAILABLE');
    expect(await counts()).toEqual([1, 1, 1, 1]);
    expect((await rows(tables[0]!))[0].last_request_sequence).toBe(1);
    expect((await rows(tables[3]!))[0].revision).toBe(1);
  });
  it('preserves last complete snapshots after failed empty attempts, then clears complete empty exposure', async () => {
    const complete = await request(1, 0, [], (raw) => {
      raw.exposure.positions = [positionFixture()]; raw.exposure.position_count = 1;
      raw.exposure.orders = [{ ticket: '700', symbol: 'EURUSD.a', type: 'BUY_LIMIT', state: 'PLACED',
        volume_initial: f('1.00'), volume_current: f('0.50'), price: r('1.10000', 5), stop_limit_price: missing(), sl: missing(), tp: missing() }];
      raw.exposure.order_count = 1;
    });
    await acceptTelemetryV2(local.db, complete, NOW);
    const failed = await request(2, 0, [], (raw) => {
      raw.account.status = 'CAPTURE_FAILED'; for (const key of ['balance', 'equity', 'margin_used', 'margin_free', 'margin_level']) raw.account[key] = missing();
      raw.exposure.status = 'CAPTURE_FAILED'; raw.exposure.position_count = null; raw.exposure.order_count = null;
      raw.collection.record_gap = 'CAPTURE_FAILED';
    });
    const response = JSON.parse(await acceptTelemetryV2(local.db, failed, NOW));
    expect(response.coverage.state).toBe('DATA_MISSING');
    let session = (await rows(tables[0]!))[0];
    expect(JSON.parse(session.account_json)).toEqual(complete.account);
    expect(JSON.parse(session.exposure_json)).toEqual(complete.exposure);
    expect(JSON.parse(session.latest_json)).toMatchObject({ account_attempt: { status: 'CAPTURE_FAILED' }, exposure_attempt: { status: 'CAPTURE_FAILED', positions: [] }, coverage: { state: 'DATA_MISSING' } });
    await acceptTelemetryV2(local.db, await fixture(3), NOW);
    session = (await rows(tables[0]!))[0];
    expect(JSON.parse(session.exposure_json)).toMatchObject({ status: 'COMPLETE', positions: [], orders: [], position_count: 0, order_count: 0 });
  });
  it.each([false, true])('resolves concurrent first-registration claims across independent clients (identical=%s)', async (identical) => {
    const first = await fixture(1, 0, [dealFixture()]);
    const second = identical ? first : await request(1, 0, [dealFixture()], (raw) => { raw.diagnostics.terminal_build += 1; });
    twoClaimBarrier();
    const results = await Promise.allSettled([acceptTelemetryV2(local.db, first, NOW), acceptTelemetryV2(local.connect(), second, NOW + 1)]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(identical ? 2 : 1);
    if (identical) expect((results[0] as PromiseFulfilledResult<string>).value).toBe((results[1] as PromiseFulfilledResult<string>).value);
    else expect((results.find((result) => result.status === 'rejected') as PromiseRejectedResult).reason.message).toBe('REPLAY_CONFLICT');
    expect(await counts()).toEqual([1, 1, 1, 1]);
  });
  it('arbitrates competing next-sequence claims against the same previous sequence', async () => {
    await acceptTelemetryV2(local.db, await fixture(), NOW);
    const a = await fixture(2, 0, [dealFixture()]);
    const b = await request(2, 0, [dealFixture()], (raw) => { raw.diagnostics.terminal_build += 1; });
    twoClaimBarrier();
    const outcomes = await Promise.allSettled([acceptTelemetryV2(local.db, a, NOW), acceptTelemetryV2(local.connect(), b, NOW)]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect((outcomes.find((outcome) => outcome.status === 'rejected') as PromiseRejectedResult).reason.message).toBe('REPLAY_CONFLICT');
    expect(await counts()).toEqual([1, 2, 1, 1]);
  });
  it('returns historical receipts after the session has advanced', async () => {
    const first = await fixture(1, 0, [dealFixture()]); const bytes = await acceptTelemetryV2(local.db, first, NOW);
    await acceptTelemetryV2(local.db, await fixture(2, 1, [dealFixture(2)]), NOW + 1);
    const writes = local.metrics.writes;
    expect(await acceptTelemetryV2(local.db, first, NOW + 100)).toBe(bytes);
    expect(local.metrics.writes).toBe(writes);
  });
  it.each([false, true])('returns N receipt when N+1 commits before N reload (lost reply=%s)', async (lost) => {
    const first = await fixture(1, 0, [dealFixture()]); const second = await fixture(2, 1, [dealFixture(2)]);
    local.faults.afterAcceptance = async () => { await acceptTelemetryV2(local.connect(), second, NOW + 1); local.faults.afterCommit = lost; };
    const bytes = await acceptTelemetryV2(local.db, first, NOW);
    expect(JSON.parse(bytes)).toMatchObject({ request_sequence: 1, acknowledged_event_sequence: 1, accepted_at_utc_seconds: NOW });
    expect(await counts()).toEqual([1, 2, 2, 2]);
  });
  it('fails closed when a receipt ACK exceeds the stored session watermark', async () => {
    const req = await fixture(1, 0, [dealFixture()]);
    await acceptTelemetryV2(local.db, req, NOW);
    // Deliberate corruption of this disposable database, not a production bypass.
    await local.db.prepare('UPDATE telemetry_session_v2 SET last_event_sequence = 0').run();
    await expect(acceptTelemetryV2(local.db, req, NOW)).rejects.toThrow('TELEMETRY_STORAGE_UNAVAILABLE');
  });
  it.each([false, true])('fails closed on a contradictory watermark during postcommit reload (lost=%s)', async (lost) => {
    const req = await fixture(1, 0, [dealFixture()]);
    local.faults.afterAcceptance = async () => {
      await local.db.prepare('UPDATE telemetry_session_v2 SET last_event_sequence = 0').run();
      local.faults.afterCommit = lost;
    };
    await expect(acceptTelemetryV2(local.db, req, NOW)).rejects.toThrow('TELEMETRY_STORAGE_UNAVAILABLE');
    expect(await counts()).toEqual([1, 1, 1, 1]);
  });
  it.each(['ACK', 'hash', 'time', 'canonical', 'mode', 'command', 'request hash'])('rejects a corrupted stored response %s without writes', async (field) => {
    const req = await fixture(1, 0, [dealFixture()]);
    const original = await acceptTelemetryV2(local.db, req, NOW);
    const response = JSON.parse(original);
    if (field === 'ACK') response.acknowledged_event_sequence = 2;
    if (field === 'time') response.accepted_at_utc_seconds += 1;
    if (field === 'mode') response.mode = 'LIVE';
    if (field === 'command') response.command = {};
    if (field === 'request hash') response.request_body_sha256 = 'f'.repeat(64);
    delete response.response_body_sha256;
    response.response_body_sha256 = field === 'hash' ? 'f'.repeat(64) : await sha256Hex(canonicalStringify(response));
    const corrupted = field === 'canonical' ? `${original}\n` : canonicalStringify(response);
    // Production trigger stays immutable. Only this test database is altered.
    await local.db.prepare('DROP TRIGGER telemetry_receipt_v2_no_update').run();
    await local.db.prepare('UPDATE telemetry_receipt_v2 SET response_bytes = ?').bind(corrupted).run();
    const writes = local.metrics.writes;
    await expect(acceptTelemetryV2(local.db, req, NOW)).rejects.toThrow('TELEMETRY_STORAGE_UNAVAILABLE');
    expect(local.metrics.writes).toBe(writes);
  });
  it('fails closed on a missing historical receipt rather than reaccepting', async () => {
    const req = await fixture(1, 0, [dealFixture()]);
    await acceptTelemetryV2(local.db, req, NOW);
    await local.db.prepare('DROP TRIGGER telemetry_receipt_v2_no_delete').run();
    await local.db.prepare('DELETE FROM telemetry_receipt_v2').run();
    const writes = local.metrics.writes;
    await expect(acceptTelemetryV2(local.db, req, NOW)).rejects.toThrow('RECEIPT_MISSING');
    expect(local.metrics.writes).toBe(writes);
  });
  it('enforces immutable session identity and receipt update/delete guards in D1', async () => {
    await acceptTelemetryV2(local.db, await fixture(), NOW);
    for (const sql of [
      "UPDATE telemetry_session_v2 SET account_id = 'changed'",
      "UPDATE telemetry_session_v2 SET scope = 'changed'",
      "UPDATE telemetry_session_v2 SET identity_json = '{}'",
      "UPDATE telemetry_session_v2 SET registration_json = '{}'",
      'DELETE FROM telemetry_session_v2',
      'UPDATE telemetry_receipt_v2 SET response_bytes = response_bytes',
      'DELETE FROM telemetry_receipt_v2',
    ]) await expect(local.db.prepare(sql).run()).rejects.toThrow('LOCAL_D1_REJECTED');
    expect(await counts()).toEqual([1, 1, 0, 0]);
  });
  it.each(['scope', 'sequence', 'digest', 'ACK', 'time'])('rejects a receipt that does not match its session claim: %s', async (field) => {
    const req = await fixture(); const scope = await scopeV2(req); const response = await responseBytesV2(req, 0, NOW);
    const statements = statementsV2(local.db, req, scope, 0, 0, NOW, response);
    await statements[0]!.run();
    await expect(local.db.prepare(`INSERT INTO telemetry_receipt_v2
      (scope, request_sequence, request_digest, response_bytes, accepted_at, acknowledged_events) VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(field === 'scope' ? 'missing' : scope, field === 'sequence' ? 2 : 1, field === 'digest' ? 'f'.repeat(64) : req.body_sha256,
        response, field === 'time' ? NOW + 1 : NOW, field === 'ACK' ? 1 : 0).run()).rejects.toThrow('LOCAL_D1_REJECTED');
    expect(await counts()).toEqual([1, 0, 0, 0]);
  });
  it.each([
    ['absent pointer revision two', false, 2, null],
    ['new deal with nonnull previous digest', false, 1, 'f'.repeat(64)],
    ['existing pointer with null previous digest', true, 2, null],
  ])('rejects the NULL-safe revision case: %s', async (_name, existing, revision, previous) => {
    const req = await fixture(1, 0, existing ? [dealFixture()] : []);
    await acceptTelemetryV2(local.db, req, NOW);
    const sequence = existing ? 2 : 1;
    const before = await counts();
    await expect(local.db.prepare(`INSERT INTO telemetry_event_v2
      (scope, sequence, event_id, kind, deal_id, revision, previous_digest, record_digest, event_json, projection_json)
      VALUES (?, ?, ?, 'DEAL', '1', ?, ?, ?, '{}', NULL)`)
      .bind(await scopeV2(req), sequence, `new-${sequence}`, revision, previous, 'e'.repeat(64)).run()).rejects.toThrow('LOCAL_D1_REJECTED');
    expect(await counts()).toEqual(before);
  });
  it('admits mixed facts while refusing mismatched DEAL pointers on both insert and update', async () => {
    const protection = { sequence: 2, event_id: 'protection-2', observed_at_utc_seconds: NOW, record_sha256: 'a'.repeat(64),
      record: { kind: 'PROTECTION_OBSERVATION', position_id: '9007199254740993', ticket: '700', symbol: 'EURUSD.a', observed_at_broker_msc: NOW * 1000,
        sl: missing(), tp: missing(), source: 'POLL' } };
    const req = await fixture(1, 0, [dealFixture(), protection]);
    await acceptTelemetryV2(local.db, req, NOW);
    expect(await counts()).toEqual([1, 1, 2, 1]);
    expect((await rows(tables[2]!))[1].projection_json).toBeNull();
    const scope = await scopeV2(req), digest = req.events[0]!.record_sha256;
    for (const [dealId, sequence, revision, recordDigest] of [
      ['other-deal', 1, 1, digest], ['1', 1, 2, digest], ['1', 1, 1, 'f'.repeat(64)], ['1', 2, 1, req.events[1]!.record_sha256],
    ]) {
      await expect(local.db.prepare(`INSERT INTO telemetry_deal_current_v2 (scope, deal_id, sequence, revision, record_digest) VALUES (?, ?, ?, ?, ?)`)
        .bind(scope, dealId, sequence, revision, recordDigest).run()).rejects.toThrow('LOCAL_D1_REJECTED');
      await expect(local.db.prepare('UPDATE telemetry_deal_current_v2 SET deal_id = ?, sequence = ?, revision = ?, record_digest = ? WHERE scope = ?')
        .bind(dealId, sequence, revision, recordDigest, scope).run()).rejects.toThrow('LOCAL_D1_REJECTED');
    }
    expect((await rows(tables[3]!))[0]).toMatchObject({ deal_id: '1', sequence: 1, revision: 1, record_digest: digest });
  });
});
