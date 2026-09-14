import { describe, expect, it } from 'vitest';
import { canonicalStringify, sha256Hex } from '../src/canonical';
import { parseTelemetryV2, responseBytesV2, validateResponseV2 } from '../src/telemetry-wire-v2';
import { dealFixture, f, fixture, missing, NOW, positionFixture, r, signFixture, START, unsignedFixture } from './support/telemetry-fixture-v2';

const copy = (): Record<string, unknown> => structuredClone(unsignedFixture(2)) as Record<string, unknown>;
const field = (value: Record<string, unknown>, key: string): Record<string, unknown> => value[key] as Record<string, unknown>;
const decode = (bytes: Uint8Array): Record<string, any> => JSON.parse(new TextDecoder().decode(bytes)) as Record<string, any>;
const rehashRequest = async (raw: Record<string, any>): Promise<Uint8Array> => {
  delete raw.body_sha256;
  raw.body_sha256 = await sha256Hex(canonicalStringify(raw));
  return new TextEncoder().encode(canonicalStringify(raw));
};
const rehashResponse = async (raw: Record<string, any>): Promise<Uint8Array> => {
  delete raw.response_body_sha256;
  raw.response_body_sha256 = await sha256Hex(canonicalStringify(raw));
  return new TextEncoder().encode(canonicalStringify(raw));
};
const signed = async (raw: Record<string, any>): Promise<Record<string, any>> => decode(await signFixture(raw));

describe('telemetry wire v2', () => {
  it('returns independently mutable missing readings and parsed fixture requests', async () => {
    expect(typeof missing).toBe('function');
    expect(await fixture()).not.toBeInstanceOf(Uint8Array);
  });
  it('parses a signed canonical envelope and preserves uint64/decimal values', async () => {
    const request = await fixture(2, 0, [dealFixture(1)]);
    expect(request.events[0]?.record.kind).toBe('DEAL');
    expect(request.identity.tracking_boundary_sha256).toHaveLength(64);
  });
  it('keeps the golden request and dry-run response hashes stable', async () => {
    const request = await fixture(1, 0, [dealFixture()]);
    expect(await sha256Hex(canonicalStringify(request))).toBe('c9c0203007d5f7b9a6ff5bdddcbeda06032d1d37ccc02d20da2b39cb4365b9cb');
    const response = await responseBytesV2(request, 1, NOW);
    expect(await sha256Hex(response)).toBe('53629c12f1cc367b6b1b0ddf3aee0012229411acecea41d1e702df51c311fa11');
  });
  it('rejects an incorrect body hash', async () => {
    const raw = JSON.parse(new TextDecoder().decode(await signFixture(unsignedFixture()))) as Record<string, unknown>;
    raw.body_sha256 = 'a'.repeat(64);
    await expect(parseTelemetryV2(new TextEncoder().encode(canonicalStringify(raw)))).rejects.toThrow('TELEMETRY_DIGEST_INVALID');
  });
  it('rejects unknown authority fields', async () => {
    const signed = JSON.parse(new TextDecoder().decode(await signFixture(unsignedFixture()))) as Record<string, unknown>;
    signed.extra = true;
    await expect(parseTelemetryV2(new TextEncoder().encode(canonicalStringify(signed)))).rejects.toThrow();
  });
  it('accepts a pending order with exact fixed-volume arithmetic', async () => {
    const raw = copy();
    const exposure = field(raw, 'exposure');
    exposure.order_count = 1;
    exposure.orders = [{ ticket: '700', symbol: 'EURUSD.a', type: 'BUY_LIMIT', state: 'PLACED', volume_initial: f('1.00'), volume_current: f('0.50'), price: r('1.10000', 5), stop_limit_price: missing(), sl: missing(), tp: missing() }];
    await expect(parseTelemetryV2(await signFixture(raw))).resolves.toBeDefined();
  });
  it.each([
    ['current volume larger than initial', f('0.50'), f('0.51')],
    ['zero initial volume', f('0.00'), f('0.00')],
    ['mismatched volume scale', f('1.00'), f('0.500', 3)],
  ])('rejects pending orders with %s', async (_name, initial, current) => {
    const raw = copy();
    const exposure = field(raw, 'exposure');
    exposure.order_count = 1;
    exposure.orders = [{ ticket: '700', symbol: 'EURUSD.a', type: 'BUY_LIMIT', state: 'PLACED', volume_initial: initial, volume_current: current, price: r('1.10000', 5), stop_limit_price: missing(), sl: missing(), tp: missing() }];
    await expect(parseTelemetryV2(await signFixture(raw))).rejects.toThrow();
  });
  it('accepts an INOUT deal with a reconstructed .04 plus .06 split', async () => {
    const raw = copy();
    const event: any = dealFixture();
    event.record.entry = 'INOUT';
    event.record.volume = f('0.10');
    event.record.reversal_split = { source: 'RECONSTRUCTED_POSITION_VOLUME', closing_volume: f('0.04'), opening_volume: f('0.06') };
    raw.events = [event]; field(raw, 'collection').produced_events = 1; field(raw, 'diagnostics').local_unsent_events = 1;
    await expect(parseTelemetryV2(await signFixture(raw))).resolves.toBeDefined();
  });
  it('accepts an INOUT deal with an absent reversal split', async () => {
    const raw = copy();
    const event = dealFixture(); event.record.entry = 'INOUT'; event.record.reversal_split = null;
    raw.events = [event]; field(raw, 'collection').produced_events = 1; field(raw, 'diagnostics').local_unsent_events = 1;
    await expect(parseTelemetryV2(await signFixture(raw))).resolves.toBeDefined();
  });
  it.each([
    ['invalid sum', f('0.04'), f('0.05')],
    ['zero split', f('0.00'), f('0.10')],
    ['wrong split scale', f('0.040', 3), f('0.06')],
  ])('rejects an INOUT deal with %s', async (_name, closing, opening) => {
    const raw = copy(); const event: any = dealFixture();
    event.record.entry = 'INOUT';
    event.record.reversal_split = { source: 'RECONSTRUCTED_POSITION_VOLUME', closing_volume: closing, opening_volume: opening };
    raw.events = [event]; field(raw, 'collection').produced_events = 1; field(raw, 'diagnostics').local_unsent_events = 1;
    await expect(parseTelemetryV2(await signFixture(raw))).rejects.toThrow();
  });
  it('rejects a reversal split attached to an OUT deal', async () => {
    const raw = copy(); const event: any = dealFixture();
    event.record.reversal_split = { source: 'RECONSTRUCTED_POSITION_VOLUME', closing_volume: f('0.04'), opening_volume: f('0.06') };
    raw.events = [event]; field(raw, 'collection').produced_events = 1; field(raw, 'diagnostics').local_unsent_events = 1;
    await expect(parseTelemetryV2(await signFixture(raw))).rejects.toThrow();
  });
  it('accepts capture-failed account readings only when all readings are unavailable', async () => {
    const raw = copy();
    const account = field(raw, 'account');
    account.status = 'CAPTURE_FAILED';
    for (const key of ['balance', 'equity', 'margin_used', 'margin_free', 'margin_level']) account[key] = missing();
    await expect(parseTelemetryV2(await signFixture(raw))).resolves.toBeDefined();
  });
  it('accepts transaction-observation protection facts after the boundary', async () => {
    const raw = copy();
    raw.events = [{
      sequence: 1,
      event_id: 'protection-1',
      observed_at_utc_seconds: 1_800_000_010,
      record_sha256: 'a'.repeat(64),
      record: { kind: 'PROTECTION_OBSERVATION', position_id: '9007199254740993', ticket: '700', symbol: 'EURUSD.a', observed_at_broker_msc: 1_800_000_000_000, sl: missing(), tp: missing(), source: 'TRANSACTION_OBSERVATION' },
    }];
    field(raw, 'collection').produced_events = 1;
    field(raw, 'diagnostics').local_unsent_events = 1;
    await expect(parseTelemetryV2(await signFixture(raw))).resolves.toBeDefined();
  });
  it.each([
    ['prestart deal', START * 1000 - 1, '701'],
    ['excluded boundary deal', START * 1000, '700'],
  ])('rejects %s as TELEMETRY_BEFORE_TRACKING', async (_name, brokerTime, dealId) => {
    const raw = copy(); const event = dealFixture();
    event.record.broker_time_msc = brokerTime; event.record.deal_id = dealId;
    field(field(raw, 'registration'), 'boundary').excluded_boundary_deal_ids = ['700'];
    raw.events = [event]; field(raw, 'collection').produced_events = 1; field(raw, 'diagnostics').local_unsent_events = 1;
    await expect(parseTelemetryV2(await signFixture(raw))).rejects.toThrow('TELEMETRY_BEFORE_TRACKING');
  });
  it('accepts a new deal in the same boundary second', async () => {
    const raw = copy(); const event = dealFixture();
    event.record.broker_time_msc = START * 1000 + 999; event.record.deal_id = '701';
    field(field(raw, 'registration'), 'boundary').excluded_boundary_deal_ids = ['700'];
    raw.events = [event]; field(raw, 'collection').produced_events = 1; field(raw, 'diagnostics').local_unsent_events = 1;
    await expect(parseTelemetryV2(await signFixture(raw))).resolves.toBeDefined();
  });
  it('rejects a bad event record hash even when the envelope hash is repaired', async () => {
    const raw = await signed(unsignedFixture(1, 0, [dealFixture()]));
    raw.events[0].record_sha256 = 'f'.repeat(64);
    await expect(parseTelemetryV2(await rehashRequest(raw))).rejects.toThrow();
  });
  it.each([
    ['identity', (raw: Record<string, any>) => { raw.identity.private_note = true; }],
    ['diagnostics', (raw: Record<string, any>) => { raw.diagnostics.private_note = true; }],
    ['record', (raw: Record<string, any>) => { raw.events[0].record.private_note = true; }],
    ['exposure', (raw: Record<string, any>) => { raw.exposure.private_note = true; }],
  ])('rejects unknown nested %s fields with valid signed hashes', async (_name, mutate) => {
    const raw = copy(); raw.events = [dealFixture()]; field(raw, 'collection').produced_events = 1; field(raw, 'diagnostics').local_unsent_events = 1;
    mutate(raw);
    await expect(parseTelemetryV2(await signFixture(raw))).rejects.toThrow();
  });
  it.each([
    ['negative zero decimal', (raw: Record<string, any>) => { raw.account.balance.value.value = '-0.00'; }],
    ['exponent decimal', (raw: Record<string, any>) => { raw.account.balance.value.value = '1e4'; }],
    ['wrong decimal fraction length', (raw: Record<string, any>) => { raw.account.balance.value.value = '10000.0'; }],
    ['out-of-range uint64 ticket', (raw: Record<string, any>) => { raw.exposure.position_count = 1; raw.exposure.positions = [positionFixture()]; raw.exposure.positions[0].ticket = '18446744073709551616'; }],
    ['non-string uint64 ticket', (raw: Record<string, any>) => { raw.exposure.position_count = 1; raw.exposure.positions = [positionFixture()]; raw.exposure.positions[0].ticket = 7; }],
  ])('rejects malformed wire %s after a valid signed baseline', async (_name, mutate) => {
    const raw = await signed(unsignedFixture());
    mutate(raw);
    await expect(parseTelemetryV2(await rehashRequest(raw))).rejects.toThrow();
  });
  it.each([
    ['wrong complete counts', (raw: Record<string, unknown>) => { field(raw, 'exposure').position_count = 1; }],
    ['failed exposure with data', (raw: Record<string, unknown>) => { const exposure = field(raw, 'exposure'); exposure.status = 'CAPTURE_FAILED'; exposure.positions = [positionFixture()]; }],
    ['time before initialization', (raw: Record<string, unknown>) => { field(raw, 'account').observed_at_utc_seconds = 1; }],
    ['scan watermark past observation', (raw: Record<string, unknown>) => { field(raw, 'collection').scan_through_broker_msc = 1_800_000_011_000; }],
  ])('rejects %s', async (_name, mutate) => {
    const raw = copy();
    mutate(raw);
    await expect(parseTelemetryV2(await signFixture(raw))).rejects.toThrow();
  });
  it('enforces list maxima before semantic processing', async () => {
    const raw = copy();
    field(raw, 'exposure').positions = Array.from({ length: 129 }, () => ({}));
    await expect(parseTelemetryV2(await signFixture(raw))).rejects.toThrow();
    const events = Array.from({ length: 33 }, (_, index) => dealFixture(index + 1));
    await expect(fixture(34, 0, events)).rejects.toThrow();
  });
  it('makes and validates exact dry-run response bytes', async () => {
    const request = await fixture(2, 0, [dealFixture(1)]);
    const bytes = await responseBytesV2(request, 1, 1_800_000_011);
    expect(typeof bytes).toBe('string');
    await expect(validateResponseV2(new TextEncoder().encode(bytes), request)).resolves.toBe(bytes);
    const altered = JSON.parse(bytes); altered.mode = 'LIVE';
    await expect(validateResponseV2(new TextEncoder().encode(canonicalStringify(altered)), request)).rejects.toThrow();
    await expect(responseBytesV2(request, 0, 1_800_000_011)).rejects.toThrow();
  });
  it.each([
    ['command', (response: Record<string, any>) => { response.command = {}; }],
    ['tracking id', (response: Record<string, any>) => { response.identity.tracking_id = 'other-tracking'; }],
    ['request sequence', (response: Record<string, any>) => { response.request_sequence = 99; }],
    ['acknowledgement', (response: Record<string, any>) => { response.acknowledged_event_sequence = 0; }],
    ['request body hash', (response: Record<string, any>) => { response.request_body_sha256 = 'f'.repeat(64); }],
    ['derived coverage', (response: Record<string, any>) => { response.coverage.pending_events = 99; }],
  ])('rejects a rehashed response with altered %s correlation', async (_name, mutate) => {
    const request = await fixture(1, 0, [dealFixture()]);
    const response = JSON.parse(await responseBytesV2(request, 1, NOW)); mutate(response);
    await expect(validateResponseV2(await rehashResponse(response), request)).rejects.toThrow();
  });
  it('rejects an altered response hash', async () => {
    const request = await fixture(1, 0, [dealFixture()]);
    const response = JSON.parse(await responseBytesV2(request, 1, NOW)); response.response_body_sha256 = 'f'.repeat(64);
    await expect(validateResponseV2(new TextEncoder().encode(canonicalStringify(response)), request)).rejects.toThrow();
  });
  it('preserves max uint64 position identifiers and scale-five decimal precision', async () => {
    const raw: any = copy(); const position = positionFixture();
    raw.exposure.position_count = 1; raw.exposure.positions = [position];
    const parsed = await parseTelemetryV2(await signFixture(raw));
    expect(parsed.exposure.positions[0]?.ticket).toBe('18446744073709551615');
    expect(parsed.exposure.positions[0]?.position_id).toBe('9007199254740993');
    expect(parsed.exposure.positions[0]?.entry_price.value).toEqual(f('1.10000', 5));
  });
  it('returns a fresh missing-reading object on each call', () => {
    const first = missing() as { value: null; reason: string }; first.reason = 'READ_FAILED';
    expect(missing()).toEqual({ value: null, reason: 'UNAVAILABLE' });
  });
});
