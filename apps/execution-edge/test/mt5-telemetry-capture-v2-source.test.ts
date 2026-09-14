import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { canonicalStringify } from '../src/canonical';
import { parseTelemetryV2 } from '../src/telemetry-wire-v2';
import { signFixture, unsignedFixture } from './support/telemetry-fixture-v2';

const root = join(import.meta.dirname, '../../..');
const agent = join(root, 'mt5/TradeOpsAgent');
const read = (path: string) => {
  expect(existsSync(join(agent, path)), `${path} must exist`).toBe(true);
  return readFileSync(join(agent, path), 'utf8');
};

// Source-boundary and wire-vector checks only: this suite does not execute or emulate MQL.
describe('MT5 capture v2 source boundary (not an MQL emulator)', () => {
  it('uses the documented MQL5 dividend and tax enum identifiers', () => {
    const native = read('Include/TradeOpsNativeCaptureBroker.mqh');
    const selftest = read('Scripts/TradeOpsTelemetryCaptureSelfTest.mq5');
    for (const [identifier, wire] of [['DEAL_DIVIDEND', 'DIVIDEND'], ['DEAL_DIVIDEND_FRANKED', 'DIVIDEND_FRANKED'], ['DEAL_TAX', 'TAX']]) {
      expect(native).toContain(`if(raw==${identifier}) return "${wire}";`);
      expect(selftest).toContain(`Tov2NativeDealType(${identifier})=="${wire}"`);
    }
    expect(native).not.toMatch(/\bDEAL_TYPE_(?:DIVIDEND(?:_FRANKED)?|TAX)\b/u);
  });

  it('keeps the bounded synthetic history buffer out of inline local objects', () => {
    const fake = read('Scripts/Support/TradeOpsTelemetryCaptureBroker.mqh');
    expect(fake).toContain('Tov2CaptureHistoryRow deals[];');
    expect(fake).not.toMatch(/Tov2CaptureHistoryRow\s+deals\s*\[\s*\d+\s*\]/u);
    expect(fake).toContain('ArrayResize(deals,2048)!=2048');
    expect(fake).toContain('deal_count>=ArraySize(deals)');
    const selftest = read('Scripts/TradeOpsTelemetryCaptureSelfTest.mq5');
    expect(selftest.match(/FakeHistoryAllocationBounds\(/gu)).toHaveLength(2);
  });

  it('provides durable capture through a committed read seam and the State append boundary', () => {
    const state = read('Include/TradeOpsTelemetryState.mqh');
    const checkpoint = read('Include/TradeOpsCaptureStateCodec.mqh');
    const collector = read('Include/TradeOpsJournalCollector.mqh');
    expect(state).toContain('int ReadCaptureContext(');
    expect(checkpoint).toContain('TCAP1');
    expect(checkpoint).toContain('capture.v1');
    for (const method of ['PrepareEnrollment(', 'InitializeFrozen(', 'Recover(', 'Poll(', 'MarkDirty(']) expect(collector).toContain(method);
    expect(collector).toContain('ReadCaptureContext(');
    expect(collector).toContain('.Append(');
    for (const source of [checkpoint, collector]) {
      expect(source).not.toMatch(/\b(?:OrderSend\w*|OrderCheck|CTrade|SymbolSelect|WebRequest|File\w*|Folder\w*|Socket\w*|OnTimer|OnTradeTransaction)\b|#import/u);
      expect(source).not.toMatch(/\b(?:Print\w*|CreateExact|PublishDiagnostic|PreparePending|AcceptResponse)\s*\(/u);
    }
    expect(read('TradeOpsAgent.mq5')).not.toMatch(/TradeOps(?:JournalCollector|CaptureStateCodec)/u);
  });

  it('pins the shared UTF-8 netstring checkpoint vector without claiming native execution', () => {
    const vectors = JSON.parse(read('fixtures/telemetry-capture-v2.json')) as Array<{
      name: string; checkpoint?: { schema: string; canonical: string; sha256: string; fields: string[] };
    }>;
    const vector = vectors.find((entry) => entry.name === 'registration')?.checkpoint;
    expect(vector).toBeDefined();
    if (!vector) throw new Error('checkpoint vector is absent');
    expect(vector.schema).toBe('capture.v1');
    expect(vector.fields).toHaveLength(33);
    expect(vector.fields[17]).toBe('1800000000');
    expect(vector.fields[0]).toBe('TCAP1');
    expect(vector.fields[5]).toBe('2');
    expect(vector.fields[6]).toBe('0');
    const independentFraming = vector.fields.map((value) => `${Buffer.byteLength(value, 'utf8')}:${value},`).join('');
    expect(independentFraming).toBe(vector.canonical);
    expect(createHash('sha256').update(vector.canonical, 'utf8').digest('hex')).toBe(vector.sha256);
    expect(read('Scripts/TradeOpsTelemetryCaptureSelfTest.mq5')).toContain(JSON.stringify(vector.canonical));
    expect(read('Scripts/TradeOpsTelemetryCaptureSelfTest.mq5')).toContain(vector.sha256);
  });

  it('keeps native collector, recovery and trusted adapter scenarios available for Windows execution', () => {
    const source = read('Scripts/TradeOpsTelemetryCaptureSelfTest.mq5');
    for (const name of ['DurableEnrollmentAndCodec', 'CollectorBoundaryRace', 'CollectorHistoryAndProtection',
      'CollectorAcknowledgedCorrection', 'CollectorHistoryFailures', 'CollectorUnsupportedAndMissing',
      'CollectorClockAndIdentity', 'CollectorCrashMatrix', 'CollectorOldWindowCorrection',
      'CheckpointRejectsMalformedAndRegression', 'CaptureReadGuardAndCorruption', 'CollectorCapacityAndDuplicates']) {
      expect(source).toContain(`${name}(`);
    }
    const adapter = read('Scripts/Support/TradeOpsTelemetryCaptureOutbox.mqh');
    expect(adapter).not.toMatch(/\b(?:ReadCaptureContext|OrderSend\w*|WebRequest|File\w*)\s*\(/u);
    expect(adapter).toContain('context.root_sha!=m_root');
    expect(source).toContain('collector=new CTov2JournalCollector;');
    expect(source).toContain('UninitializedRigHelpersFailClosed(');
  });

  it('isolates account capture and restricts the native adapter to broker read APIs', () => {
    const types = read('Include/TradeOpsCaptureTypes.mqh');
    const codec = read('Include/TradeOpsCaptureCodec.mqh');
    const snapshot = read('Include/TradeOpsAccountSnapshot.mqh');
    const native = read('Include/TradeOpsNativeCaptureBroker.mqh');
    const fake = read('Scripts/Support/TradeOpsTelemetryCaptureBroker.mqh');
    const selftest = read('Scripts/TradeOpsTelemetryCaptureSelfTest.mq5');
    const forbidden = /\b(?:OrderSend\w*|OrderCheck|CTrade|SymbolSelect|WebRequest|File\w*|Folder\w*|Socket\w*|OnTimer|OnTradeTransaction)\b|#import/u;
    for (const source of [types, codec, snapshot, native, fake, selftest]) expect(source).not.toMatch(forbidden);
    expect(native).not.toMatch(/\b(?:Print\w*|HistoryDealSelect)\s*\(/u);
    expect(native).toContain('HistoryDealGetTicket(');
    expect(native).toContain('HistorySelect(');
    expect(native).toContain('ResetLastError()');
    expect(types).toContain('EnrollmentClockReady(');
    expect(native).toContain('GetTickCount64()');
    expect(native).toContain('CTov2CaptureQuoteFreshness');
    expect(types).toContain('class ITov2CaptureBroker');
    expect(types).toContain('TOV2_CAPTURE_UNSUPPORTED');
    expect(snapshot).toContain('LastComplete(');
    expect(snapshot).toContain('account.status!="COMPLETE"');
    expect(snapshot).toContain('exposure.status!="COMPLETE"');
    expect(snapshot).toContain('StablePosition(');
    expect(snapshot).toContain('StableOrder(');
    expect(selftest).toContain('../Include/TradeOpsNativeCaptureBroker.mqh');
    expect(selftest).toContain('TOV2_CAPTURE_PASS checks=');
    expect(selftest).toContain('TOV2_CAPTURE_FAIL checks=');
    expect(read('TradeOpsAgent.mq5')).not.toMatch(/TradeOps(?:Capture|AccountSnapshot|NativeCaptureBroker)/u);
  });

  it('validates actual canonical vectors with the production receiver and independent hashes', async () => {
    const vectors = JSON.parse(read('fixtures/telemetry-capture-v2.json')) as Array<{ name: string; kind: string; currency_scale: number; canonical: string; sha256: string }>;
    expect(vectors.length).toBeGreaterThanOrEqual(8);
    const selftest = read('Scripts/TradeOpsTelemetryCaptureSelfTest.mq5');
    for (const vector of vectors) {
      const payload = JSON.parse(vector.canonical);
      expect(canonicalStringify(payload), vector.name).toBe(vector.canonical);
      expect(createHash('sha256').update(vector.canonical, 'utf8').digest('hex'), vector.name).toBe(vector.sha256);
      expect(selftest, vector.name).toContain(JSON.stringify(vector.canonical));
      const raw = unsignedFixture();
      raw.registration.display.currency_scale = vector.currency_scale;
      for (const key of ['balance', 'equity', 'margin_used', 'margin_free']) raw.account[key] = { reason: null, value: { scale: vector.currency_scale, value: vector.currency_scale === 0 ? '0' : `0.${'0'.repeat(vector.currency_scale)}` } };
      if (vector.kind === 'account') raw.account = payload;
      else if (vector.kind === 'exposure') raw.exposure = payload;
      else if (vector.kind === 'registration') { raw.registration = payload; raw.identity.tracking_id = payload.boundary.tracking_id; raw.identity.account_fingerprint_sha256 = payload.boundary.account_fingerprint_sha256; }
      else {
        raw.events = [{ sequence: 1, event_id: 'capture-vector', observed_at_utc_seconds: raw.sent_at_utc_seconds, record_sha256: vector.sha256, record: payload }];
        raw.collection.produced_events = 1; raw.diagnostics.local_unsent_events = 1;
      }
      await expect(parseTelemetryV2(await signFixture(raw)), vector.name).resolves.toBeDefined();
    }
  });

  it('keeps native behavioral cases for failure, races, precision, unsigned tickets and retention', () => {
    const source = read('Scripts/TradeOpsTelemetryCaptureSelfTest.mq5');
    for (const name of ['ScaleCases', 'UnsignedTickets', 'MissingReadings', 'ExposureBounds', 'DuplicateIds', 'MembershipRace', 'IdentitySwitch', 'RetainsLastComplete', 'HistoryOutcomes', 'DealMappings', 'CodecRejectsMalformed']) expect(source).toContain(`${name}(`);
    expect(source).toContain('18446744073709551615');
    expect(source).toContain('9223372036854775808');
    expect(source).toContain('129');
    expect(source).toContain('128');
    expect(source).not.toMatch(/\binput\b/u);
  });
});
