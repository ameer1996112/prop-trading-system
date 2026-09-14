import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { expect, it } from 'vitest';
import { canonicalStringify, sha256Hex } from '../src/canonical';
import { parseTelemetryV2, responseBytesV2, validateResponseV2 } from '../src/telemetry-wire-v2';

// Receiver semantics are the oracle for the independent MQL5 native assertions.
async function repairedRequest(value: Record<string, any>): Promise<Uint8Array> {
  for (const event of value.events) event.record_sha256 = await sha256Hex(canonicalStringify(event.record));
  value.identity.tracking_boundary_sha256 = await sha256Hex(canonicalStringify(value.registration.boundary));
  delete value.body_sha256;
  value.body_sha256 = await sha256Hex(canonicalStringify(value));
  return new TextEncoder().encode(canonicalStringify(value));
}

it('accepts receiver-supported reversal splits and rejects inconsistent sums', async () => {
  const value = requestFor('one-deal-scale-2');
  const record = value.events[0].record;
  record.entry = 'INOUT';
  record.reversal_split = { source: 'RECONSTRUCTED_POSITION_VOLUME', closing_volume: { scale: 2, value: '0.03' }, opening_volume: { scale: 2, value: '0.07' } };
  await expect(parseTelemetryV2(await repairedRequest(value))).resolves.toMatchObject({ events: [{ record: { reversal_split: record.reversal_split } }] });
  record.reversal_split.opening_volume.value = '0.08';
  await expect(parseTelemetryV2(await repairedRequest(value))).rejects.toThrow();
});

it.each(['0.00', '-0.10'])('accepts nontrading volume %s but rejects it for trading', async (volume) => {
  const value = requestFor('one-deal-scale-2');
  Object.assign(value.events[0].record, { type: 'BALANCE', entry: 'NONE', volume: { scale: 2, value: volume } });
  await expect(parseTelemetryV2(await repairedRequest(value))).resolves.toBeDefined();
  Object.assign(value.events[0].record, { type: 'BUY', entry: 'OUT' });
  await expect(parseTelemetryV2(await repairedRequest(value))).rejects.toThrow();
});

it('accepts a known margin level at zero used margin and rejects failed account known values', async () => {
  const value = requestFor('idle-complete-scale-2');
  value.account.margin_level = { reason: null, value: { scale: 2, value: '0.00' } };
  await expect(parseTelemetryV2(await repairedRequest(value))).resolves.toBeDefined();
  value.account.status = 'CAPTURE_FAILED';
  await expect(parseTelemetryV2(await repairedRequest(value))).rejects.toThrow();
});

it('leaves committed-prefix proof to the State adapter', async () => {
  const value = requestFor('32-contiguous-events-scale-2');
  [value.events[0], value.events[1]] = [value.events[1], value.events[0]];
  value.events[2].sequence = 1;
  await expect(parseTelemetryV2(await repairedRequest(value))).resolves.toBeDefined();
});

it.each([
  ['counter', (v: Record<string, any>) => { v.diagnostics.local_unsent_events++; }],
  ['accepted sequence', (v: Record<string, any>) => { v.diagnostics.last_accepted_request_sequence++; }],
  ['before start', (v: Record<string, any>) => { v.events[0].record.broker_time_msc = v.registration.boundary.started_at_broker_msc - 1; }],
  ['event time', (v: Record<string, any>) => { v.events[0].observed_at_utc_seconds = v.sent_at_utc_seconds + 1; }],
  ['watermark', (v: Record<string, any>) => { v.collection.scan_through_broker_msc = null; }],
  ['revision', (v: Record<string, any>) => { v.events[0].record.revision = 2; }],
  ['duplicate deal', (v: Record<string, any>) => { v.events.push({ ...structuredClone(v.events[0]), event_id: 'different-id' }); }],
  ['boundary identity', (v: Record<string, any>) => { v.identity.tracking_id = 'different'; }],
  ['currency scale', (v: Record<string, any>) => { v.events[0].record.profit.value = { scale: 0, value: '10' }; }],
  ['unknown enum', (v: Record<string, any>) => { v.diagnostics.terminal_connection_state = 'READY'; }],
])('rejects repaired %s relationship violations', async (_label, mutate) => {
  const value = requestFor('one-deal-scale-2');
  mutate(value);
  await expect(parseTelemetryV2(await repairedRequest(value))).rejects.toThrow();
});

type WireVector = Readonly<{
  name: string;
  request_utf8: string;
  response_utf8: string;
  request_sha256: string;
  response_sha256: string;
}>;

const vectors = JSON.parse(
  readFileSync(new URL('../../../mt5/TradeOpsAgent/fixtures/telemetry-wire-v2.json', import.meta.url), 'utf8'),
) as readonly WireVector[];
const encoder = new TextEncoder();

function fullExposureRequest(): Record<string, any> {
  const value = requestFor('idle-complete-scale-2');
  const position = requestFor('unicode-symbol-company-scale-2').exposure.positions[0];
  const missing = { reason: 'UNAVAILABLE', value: null };
  const order = { ticket: '1', symbol: 'S', type: 'BUY_LIMIT', state: 'PLACED', volume_initial: { scale: 2, value: '0.10' }, volume_current: { scale: 2, value: '0.10' }, price: missing, stop_limit_price: missing, sl: missing, tp: missing };
  for (const exposure of [value.exposure, value.registration.baseline]) {
    exposure.positions = Array.from({ length: 128 }, (_, index) => ({ ...structuredClone(position), ticket: String(1000 + index), position_id: String(2000 + index), symbol: 'S' }));
    exposure.orders = Array.from({ length: 128 }, (_, index) => ({ ...structuredClone(order), ticket: String(3000 + index) }));
    exposure.position_count = 128;
    exposure.order_count = 128;
  }
  return value;
}

it('accepts exactly 262144 UTF-8 bytes and rejects 262145 without whitespace padding', async () => {
  const value = fullExposureRequest();
  let remaining = 262144 - encoder.encode(canonicalStringify(value)).length;
  expect(remaining).toBeGreaterThan(0);
  for (const exposure of [value.exposure, value.registration.baseline]) for (const row of [...exposure.positions, ...exposure.orders]) {
    const extra = Math.min(189, remaining);
    row.symbol += '界'.repeat(Math.floor(extra / 3)) + (extra % 3 === 2 ? 'é' : extra % 3 === 1 ? 'a' : '');
    remaining -= extra;
  }
  expect(remaining).toBe(0);
  const bytes = await repairedRequest(value);
  expect(bytes.byteLength).toBe(262144);
  await expect(parseTelemetryV2(bytes)).resolves.toBeDefined();
  value.diagnostics.source_symbol += 'x';
  const tooLarge = await repairedRequest(value);
  expect(tooLarge.byteLength).toBe(262145);
  await expect(parseTelemetryV2(tooLarge)).rejects.toThrow('TELEMETRY_TOO_LARGE');
});

it.each(['positions', 'orders'])('rejects 129 %s before accepting any request', async (key) => {
  const value = fullExposureRequest();
  value.exposure[key].push({ ...value.exposure[key][0], ticket: '9999', ...(key === 'positions' ? { position_id: '9998' } : {}) });
  value.exposure[key === 'positions' ? 'position_count' : 'order_count'] = 129;
  await expect(parseTelemetryV2(await repairedRequest(value))).rejects.toThrow();
});

it('rejects 33 otherwise valid events', async () => {
  const value = requestFor('32-contiguous-events-scale-2');
  const event = structuredClone(value.events[0]);
  event.event_id = 'event-33'; event.sequence = 33; event.record.deal_id = '33';
  value.events.push(event); value.collection.produced_events = 33; value.diagnostics.local_unsent_events = 33;
  await expect(parseTelemetryV2(await repairedRequest(value))).rejects.toThrow();
});

it.each([
  ['BOM', (raw: string) => '\uFEFF' + raw],
  ['trailing bytes', (raw: string) => raw + '\n'],
  ['whitespace', (raw: string) => raw.replace('{', '{ ')],
  ['duplicate key', (raw: string) => raw.replace('"request_sequence":1', '"request_sequence":1,"request_sequence":1')],
  ['extra key', (raw: string) => raw.replace('"request_sequence":1', '"request_sequence":1,"rogue":null')],
  ['missing key', (raw: string) => raw.replace('"request_sequence":1,', '')],
  ['noncanonical number', (raw: string) => raw.replace('"request_sequence":1', '"request_sequence":1.0')],
  ['escaped ASCII', (raw: string) => raw.replace('EURUSD', '\\u0045URUSD')],
  ['lone surrogate', (raw: string) => raw.replace('EURUSD', '\\ud800')],
  ['body hash', (raw: string) => raw.replace(/"body_sha256":"[a-f0-9]{64}"/u, '"body_sha256":"' + 'a'.repeat(64) + '"')],
])('rejects malformed %s request', async (_name, alter) => {
  await expect(parseTelemetryV2(encoder.encode(alter(vectors[0]!.request_utf8)))).rejects.toThrow();
});

it('rejects malformed UTF-8', async () => {
  const raw = encoder.encode(vectors[0]!.request_utf8);
  raw[1] = 0xff;
  await expect(parseTelemetryV2(raw)).rejects.toThrow();
});

it.each(['record', 'boundary'])('independently rejects a wrong %s digest with a repaired envelope', async (part) => {
  const value = requestFor('one-deal-scale-2');
  if (part === 'record') value.events[0].record_sha256 = 'a'.repeat(64);
  else value.identity.tracking_boundary_sha256 = 'a'.repeat(64);
  delete value.body_sha256;
  value.body_sha256 = await sha256Hex(canonicalStringify(value));
  await expect(parseTelemetryV2(encoder.encode(canonicalStringify(value)))).rejects.toThrow();
});

it('applies frozen-second exclusions only inside the boundary second', async () => {
  const value = requestFor('one-deal-scale-2');
  const record = value.events[0].record;
  value.registration.boundary.excluded_boundary_deal_ids = [record.deal_id];
  record.broker_time_msc = value.registration.boundary.started_at_broker_msc + 999;
  await expect(parseTelemetryV2(await repairedRequest(value))).rejects.toThrow();
  record.broker_time_msc++;
  await expect(parseTelemetryV2(await repairedRequest(value))).resolves.toBeDefined();
});

const wholeHash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const requestFor = (name: string): Record<string, any> => {
  const vector = vectors.find((candidate) => candidate.name === name);
  expect(vector, name).toBeDefined();
  return JSON.parse(vector?.request_utf8 ?? '{}') as Record<string, any>;
};

it.each(vectors)('accepts fixed wire vector $name', async (vector) => {
  const pending = encoder.encode(vector.request_utf8);
  const response = encoder.encode(vector.response_utf8);
  expect(wholeHash(pending)).toBe(vector.request_sha256);
  expect(wholeHash(response)).toBe(vector.response_sha256);

  const requestObject = JSON.parse(vector.request_utf8) as Record<string, unknown>;
  const responseObject = JSON.parse(vector.response_utf8) as Record<string, unknown>;
  expect(canonicalStringify(requestObject)).toBe(vector.request_utf8);
  expect(canonicalStringify(responseObject)).toBe(vector.response_utf8);
  const requestBody = { ...requestObject };
  const responseBody = { ...responseObject };
  delete requestBody.body_sha256;
  delete responseBody.response_body_sha256;
  expect(await sha256Hex(canonicalStringify(requestBody))).toBe(requestObject.body_sha256);
  expect(await sha256Hex(canonicalStringify(responseBody))).toBe(responseObject.response_body_sha256);

  const parsed = await parseTelemetryV2(pending);
  const acceptedAt = responseObject.accepted_at_utc_seconds as number;
  const acknowledgement = responseObject.acknowledged_event_sequence as number;
  expect(await responseBytesV2(parsed, acknowledgement, acceptedAt)).toBe(vector.response_utf8);
  expect(await validateResponseV2(response, parsed)).toBe(vector.response_utf8);
});

it('covers every native receiver scenario with literal bytes', () => {
  expect(vectors.map(({ name }) => name)).toEqual([
    'idle-complete-scale-2',
    'one-deal-scale-2',
    'protection-scale-2',
    '32-contiguous-events-scale-2',
    'produced-backlog-beyond-uploaded-prefix-scale-2',
    'record-gap-scale-2',
    'observation-gap-scale-2',
    'unfinished-scan-scale-2',
    'unicode-symbol-company-scale-2',
    'large-tickets-scale-2',
    'currency-scale-0-incomplete-account',
    'currency-scale-8-incomplete-exposure',
  ]);

  const idle = requestFor('idle-complete-scale-2');
  expect(idle.registration.display.currency_scale).toBe(2);
  expect(idle.events).toEqual([]);
  expect(requestFor('one-deal-scale-2').events[0].record.kind).toBe('DEAL');
  expect(requestFor('protection-scale-2').events[0].record.kind).toBe('PROTECTION_OBSERVATION');

  const contiguous = requestFor('32-contiguous-events-scale-2');
  expect(contiguous.events.map((event: Record<string, unknown>) => event.sequence)).toEqual(
    Array.from({ length: 32 }, (_, index) => index + 1),
  );
  const backlog = requestFor('produced-backlog-beyond-uploaded-prefix-scale-2');
  expect({
    acknowledged: backlog.last_acknowledged_event_sequence,
    first_uploaded: backlog.events[0].sequence,
    last_uploaded: backlog.events.at(-1).sequence,
    produced: backlog.collection.produced_events,
  }).toEqual({ acknowledged: 5, first_uploaded: 6, last_uploaded: 10, produced: 40 });
  expect(requestFor('record-gap-scale-2').collection.record_gap).toBe('HISTORY_UNAVAILABLE');
  expect(requestFor('observation-gap-scale-2').collection.observation_gap).toBe(true);
  expect(requestFor('unfinished-scan-scale-2').collection).toMatchObject({
    scan_finished: false,
    scan_through_broker_msc: null,
  });

  const unicode = requestFor('unicode-symbol-company-scale-2');
  expect(unicode.registration.display.company).toBe('ברוקר בדיקה 東京');
  expect(unicode.exposure.positions[0].symbol).toBe('זהב.测试');
  const large = requestFor('large-tickets-scale-2');
  expect(large.events[0].record.deal_id).toBe('18446744073709551615');
  expect(large.exposure.positions[0].position_id).toBe('18446744073709551613');

  const scaleZero = requestFor('currency-scale-0-incomplete-account');
  expect(scaleZero.registration.display.currency_scale).toBe(0);
  expect(scaleZero.account.status).toBe('CAPTURE_FAILED');
  for (const key of ['balance', 'equity', 'margin_used', 'margin_free', 'margin_level']) {
    expect(scaleZero.account[key]).toEqual({ reason: 'UNAVAILABLE', value: null });
  }
  expect(scaleZero.exposure.positions[0].floating_profit.value.scale).toBe(0);
  expect(scaleZero.exposure.positions[0].swap.value.scale).toBe(0);
  const scaleEight = requestFor('currency-scale-8-incomplete-exposure');
  expect(scaleEight.registration.display.currency_scale).toBe(8);
  expect(scaleEight.exposure).toMatchObject({
    status: 'LIMIT_EXCEEDED',
    position_count: null,
    order_count: null,
    positions: [],
    orders: [],
  });
});

it('rejects semantically altered request and response bytes after digest repair', async () => {
  const source = vectors.find(({ name }) => name === 'one-deal-scale-2');
  expect(source).toBeDefined();
  if (source === undefined) return;

  const request = JSON.parse(source.request_utf8) as Record<string, any>;
  request.collection.produced_events = 0;
  delete request.body_sha256;
  request.body_sha256 = await sha256Hex(canonicalStringify(request));
  await expect(parseTelemetryV2(encoder.encode(canonicalStringify(request)))).rejects.toThrow();

  const parsed = await parseTelemetryV2(encoder.encode(source.request_utf8));
  const response = JSON.parse(source.response_utf8) as Record<string, any>;
  response.acknowledged_event_sequence = 0;
  delete response.response_body_sha256;
  response.response_body_sha256 = await sha256Hex(canonicalStringify(response));
  await expect(validateResponseV2(encoder.encode(canonicalStringify(response)), parsed)).rejects.toThrow();
});

async function repairedResponse(value: Record<string, any>): Promise<Uint8Array> {
  delete value.response_body_sha256;
  value.response_body_sha256 = await sha256Hex(canonicalStringify(value));
  return encoder.encode(canonicalStringify(value));
}

const alternateDigest = (value: string): string => `${value[0] === 'a' ? 'b' : 'a'}${value.slice(1)}`;
const identityMutations = [
  ['account_id', (value: any) => { value.account_id = `${value.account_id}-other`; }],
  ['installation_id', (value: any) => { value.installation_id = `${value.installation_id}-other`; }],
  ['tracking_id', (value: any) => { value.tracking_id = `${value.tracking_id}-other`; }],
  ['safety_epoch', (value: any) => { value.safety_epoch += 1; }],
  ['account_profile_sha256', (value: any) => { value.account_profile_sha256 = alternateDigest(value.account_profile_sha256); }],
  ['account_fingerprint_sha256', (value: any) => { value.account_fingerprint_sha256 = alternateDigest(value.account_fingerprint_sha256); }],
  ['tracking_boundary_sha256', (value: any) => { value.tracking_boundary_sha256 = alternateDigest(value.tracking_boundary_sha256); }],
] as const;

it.each(vectors)('rejects every rehashed correlated response mutation in $name', async (vector) => {
  const parsed = await parseTelemetryV2(encoder.encode(vector.request_utf8));
  const original = JSON.parse(vector.response_utf8) as Record<string, any>;
  const reject = async (mutate: (value: Record<string, any>) => void): Promise<void> => {
    const value = structuredClone(original);
    mutate(value);
    await expect(validateResponseV2(await repairedResponse(value), parsed)).rejects.toThrow();
  };

  for (const [_field, mutate] of identityMutations) await reject((value) => mutate(value.identity));
  await reject((value) => { value.request_sequence += 1; });
  await reject((value) => { value.request_body_sha256 = alternateDigest(value.request_body_sha256); });
  await reject((value) => { value.acknowledged_event_sequence += 1; });
  if (original.acknowledged_event_sequence > 0) {
    await reject((value) => { value.acknowledged_event_sequence -= 1; });
  }
  await reject((value) => { value.accepted_at_utc_seconds = 0; });
  await reject((value) => { value.coverage.state = value.coverage.state === 'UP_TO_DATE' ? 'CATCHING_UP' : 'UP_TO_DATE'; });
  await reject((value) => { value.coverage.through_broker_msc = value.coverage.through_broker_msc === null ? 1800000010000 : null; });
  await reject((value) => { value.coverage.pending_events += 1; });
  await reject((value) => { value.coverage.reason = value.coverage.reason === null ? 'HISTORY_UNAVAILABLE' : 'CLOCK_DISCONTINUITY'; });
  await reject((value) => { value.coverage.observation_gap = !value.coverage.observation_gap; });
  await reject((value) => { value.mode = 'LIVE'; });
  await reject((value) => { value.command = { kind: 'BUY' }; });
  await reject((value) => { value.rogue = null; });
  await reject((value) => { value.schema_version = 'AgentSyncResponseV1'; });
});

it('rejects a rehashed acknowledgement below the final event', async () => {
  const vector = vectors.find(({ response_utf8 }) => JSON.parse(response_utf8).acknowledged_event_sequence > 0);
  expect(vector).toBeDefined();
  if (vector === undefined) return;
  const parsed = await parseTelemetryV2(encoder.encode(vector.request_utf8));
  const value = JSON.parse(vector.response_utf8) as Record<string, any>;
  value.acknowledged_event_sequence -= 1;
  await expect(validateResponseV2(await repairedResponse(value), parsed)).rejects.toThrow();
});

it('rejects malformed and oversized response bytes', async () => {
  const vector = vectors[0];
  expect(vector).toBeDefined();
  if (vector === undefined) return;
  const parsed = await parseTelemetryV2(encoder.encode(vector.request_utf8));
  const duplicate = vector.response_utf8.replace('"request_sequence":1', '"request_sequence":1,"request_sequence":1');
  await expect(validateResponseV2(encoder.encode(duplicate), parsed)).rejects.toThrow();
  await expect(validateResponseV2(encoder.encode(vector.response_utf8.slice(0, -1)), parsed)).rejects.toThrow();
  await expect(validateResponseV2(encoder.encode(`${vector.response_utf8}${'x'.repeat(16385)}`), parsed)).rejects.toThrow('TELEMETRY_TOO_LARGE');
});

function zipEntries(bytes: Buffer): readonly string[] {
  const names: string[] = [];
  for (let offset = 0; offset + 46 <= bytes.length;) {
    if (bytes.readUInt32LE(offset) !== 0x02014b50) { offset += 1; continue; }
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    names.push(bytes.subarray(offset + 46, offset + 46 + nameLength).toString('utf8'));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return names;
}

it('packages a deterministic exact source closure and verifies extracted bytes', () => {
  const first = mkdtempSync(join(tmpdir(), 'tov2-wire-package-a-'));
  const second = mkdtempSync(join(tmpdir(), 'tov2-wire-package-b-'));
  try {
    const script = new URL('../../../scripts/package-mt5-wire-selftest.mjs', import.meta.url);
    const firstOutput = execFileSync(process.execPath, [script.pathname, '--output-dir', first], { encoding: 'utf8' });
    const secondOutput = execFileSync(process.execPath, [script.pathname, '--output-dir', second], { encoding: 'utf8' });
    expect(firstOutput).toContain('MT5_WIRE_PACKAGE_PASS');
    expect(secondOutput).toContain('MT5_WIRE_PACKAGE_PASS');
    const [firstName] = readdirSync(first);
    const [secondName] = readdirSync(second);
    if (firstName === undefined || secondName === undefined) throw new Error('package output missing');
    expect(firstName).toBe('tradeops-telemetry-wire-selftest-v2.0.0-source.zip');
    expect(secondName).toBe(firstName);
    const firstBytes = readFileSync(join(first, firstName));
    expect(firstBytes).toEqual(readFileSync(join(second, secondName)));
    expect(zipEntries(firstBytes)).toEqual([
      'MANIFEST.json',
      'MQL5/Scripts/TradeOpsTelemetryWireSelfTest-v2.0.0/Include/TradeOpsCaptureCodec.mqh',
      'MQL5/Scripts/TradeOpsTelemetryWireSelfTest-v2.0.0/Include/TradeOpsCaptureTypes.mqh',
      'MQL5/Scripts/TradeOpsTelemetryWireSelfTest-v2.0.0/Include/TradeOpsTelemetryRecord.mqh',
      'MQL5/Scripts/TradeOpsTelemetryWireSelfTest-v2.0.0/Include/TradeOpsTelemetryResponseV2.mqh',
      'MQL5/Scripts/TradeOpsTelemetryWireSelfTest-v2.0.0/Include/TradeOpsTelemetryValues.mqh',
      'MQL5/Scripts/TradeOpsTelemetryWireSelfTest-v2.0.0/Include/TradeOpsTelemetryWireTypes.mqh',
      'MQL5/Scripts/TradeOpsTelemetryWireSelfTest-v2.0.0/Include/TradeOpsTelemetryWireV2.mqh',
      'MQL5/Scripts/TradeOpsTelemetryWireSelfTest-v2.0.0/Scripts/TradeOpsTelemetryWireSelfTest.mq5',
      'README.txt',
      'SHA256SUMS.txt',
    ]);
    expect(firstBytes.includes(Buffer.from('MQL5/Include/'))).toBe(false);
    expect(firstBytes.includes(Buffer.from('Do not copy the archive\'s whole MQL5 tree over an existing terminal tree.'))).toBe(true);
    expect(firstBytes.includes(Buffer.from('MQL5\\Scripts\\TradeOpsTelemetryWireSelfTest-v2.0.0\\Scripts\\TradeOpsTelemetryWireSelfTest.mq5'))).toBe(true);
    expect(firstBytes.includes(Buffer.from('.ex5'))).toBe(false);
  } finally {
    rmSync(first, { recursive: true, force: true });
    rmSync(second, { recursive: true, force: true });
  }
});
