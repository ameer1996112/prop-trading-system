import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { readCounterV2, readTicketV2 } from '../src/telemetry-values-v2';
import { readIdentityV2 } from '../src/telemetry-wire-v2';

const agent = join(import.meta.dirname, '../../../mt5/TradeOpsAgent');

function source(path: string): string {
  const full = join(agent, path);
  expect(existsSync(full), path).toBe(true);
  return readFileSync(full, 'utf8');
}

function hash(bytes: string | Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function reference(
  kind: string, generation: number, ordinal: number, sha: string,
  sequence = 0, eventId = '-', recordSha = '-', dealId = '-', revision = 0,
): string {
  return [kind, generation, ordinal, sha, sequence, eventId, recordSha, dealId, revision].join(',');
}

function localPayload(fields: readonly (string | number)[]): Buffer {
  return Buffer.from(fields.join('\n') + '\n', 'ascii');
}

function record(payload: Buffer, generation: number): Buffer {
  const prefix = Buffer.concat([
    Buffer.from('TOV2R1|CHECKPOINT|' + generation + '|' + payload.length + '\n', 'ascii'),
    payload,
  ]);
  return Buffer.concat([prefix, Buffer.from('\nSHA256|' + hash(prefix) + '\n', 'ascii')]);
}

function vectors(): Map<string, { generation: number; payload: Buffer; frame: Buffer }> {
  const identity = [
    'account.demo', 'install.demo', 'tracking.demo', 1,
    'd'.repeat(64), 'e'.repeat(64), 'f'.repeat(64),
  ].join('~');
  const initial: (string | number)[] = [
    'TOV2S1', 1, 0, '-', identity, reference('REGISTRATION', 1, 0, 'a'.repeat(64)),
    0, 0, 0, reference('CAPTURE', 1, 1, 'b'.repeat(64)), 'synthetic.capture.1',
    'CATCHING_UP', '-', 0, '-', 0, 0, 0, 0, '-', 0, '-', '-', 0, 0, 0, 'NONE',
  ];
  const pending = initial.slice();
  Object.assign(pending, {
    1: 3, 2: 2, 3: 'c'.repeat(64), 6: 2,
    9: reference('CAPTURE', 2, 3, 'b'.repeat(64)),
    12: reference('PENDING', 3, 1, '5'.repeat(64), 1),
    13: 1, 14: '6'.repeat(64), 16: 2, 17: 2, 18: 2, 25: 2,
  });
  pending.push(
    reference('EVENT', 2, 1, '1'.repeat(64), 1, 'event.1', '2'.repeat(64), '42', 1),
    reference('EVENT', 2, 2, '3'.repeat(64), 2, 'event.2', '4'.repeat(64), '43', 1),
  );
  const stateFrame = record(localPayload(pending), 3);
  const commit = [
    'TOV2C1', 3, 2, 'c'.repeat(64), 'a'.repeat(64), hash(stateFrame), 'PREPARE',
  ];
  return new Map([
    ['INIT_STATE', { generation: 1, payload: localPayload(initial), frame: record(localPayload(initial), 1) }],
    ['PENDING_STATE', { generation: 3, payload: localPayload(pending), frame: stateFrame }],
    ['PREPARE_COMMIT', { generation: 3, payload: localPayload(commit), frame: record(localPayload(commit), 3) }],
  ]);
}

describe('MT5 local storage codec source and vector seam', () => {
  it('keeps the new codec pure and outside the active EA', () => {
    const codec = source('Include/TradeOpsTelemetryStorageCodec.mqh');
    const native = source('Scripts/TradeOpsTelemetryStorageCodecSelfTest.mq5');
    const active = source('TradeOpsAgent.mq5');
    expect(codec.split('\n').filter((line) => line.startsWith('#include')))
      .toEqual(['#include "TradeOpsTelemetryRecord.mqh"']);
    expect(native.split('\n').filter((line) => line.startsWith('#include')))
      .toEqual(['#include "../Include/TradeOpsTelemetryStorageCodec.mqh"']);
    expect(active).not.toContain('TradeOpsTelemetryStorageCodec');
    const forbidden = /\b(?:File\w*|Folder\w*|WebRequest|Socket\w*|OrderSend\w*|CTrade|AccountInfo\w*|History\w*|PositionGet\w*|OrderGet\w*|OnTimer|OnTradeTransaction|TimeCurrent|TimeLocal|GetTickCount\w*)\b|#import/u;
    expect(codec).not.toMatch(forbidden);
    expect(native).not.toMatch(forbidden);
    expect(codec).not.toMatch(/\b(?:double|StringToDouble|CharArrayToString)\b/u);
    expect(codec).toContain('n>TOV2_RECORD_FRAME_MAX');
    expect(codec).toContain('CryptEncode(CRYPT_HASH_SHA256,bytes,key,digest)!=32');
    expect(codec).toContain('ArraySize(digest)!=32');
  });

  it('stages aliased buffers and uses named queue bounds', () => {
    const codec = source('Include/TradeOpsTelemetryStorageCodec.mqh');
    const native = source('Scripts/TradeOpsTelemetryStorageCodecSelfTest.mq5');
    const copy = codec.slice(
      codec.indexOf('bool Tov2LocalCopy'),
      codec.indexOf('bool Tov2LocalIdentity'),
    );
    const matches = codec.slice(
      codec.indexOf('bool Tov2LocalFrameMatches'),
      codec.indexOf('struct Tov2LocalState'),
    );
    const copyStage = copy.indexOf('ArrayCopy(staged,source,0,0,n)');
    const copyClear = copy.indexOf('ArrayResize(destination,0)');
    const frameStage = matches.indexOf('Tov2LocalCopy(frame,staged)');
    const frameClear = matches.indexOf('ArrayResize(payload,0)');
    expect(copyStage).toBeGreaterThan(-1);
    expect(copyStage).toBeLessThan(copyClear);
    expect(frameStage).toBeGreaterThan(-1);
    expect(frameStage).toBeLessThan(frameClear);
    expect(matches).toContain('Tov2LocalHash(staged,sha)');
    expect(matches).toContain('Tov2RecordDecode(staged,kind,generation,candidate)');
    expect(codec).toContain('Tov2LocalRef events[TOV2_LOCAL_EVENTS]');
    expect(codec).toContain('for(int i=0;i<TOV2_LOCAL_EVENTS;i++)');
    expect(codec).toContain('s.event_count>TOV2_LOCAL_EVENTS');
    expect(codec).toContain('s.pending_count>TOV2_LOCAL_BATCH');
    expect(codec).toContain('pending_count>TOV2_LOCAL_BATCH || event_count>TOV2_LOCAL_EVENTS');
    expect(native).toContain('Tov2LocalCopy(raw,raw)');
    expect(native).toContain('Tov2LocalFrameMatches(r,aliased_frame,aliased_frame)');
    expect(native).toContain('out.events[TOV2_LOCAL_EVENTS-1].ordinal==TOV2_LOCAL_EVENTS');
    expect(native).toContain('Tov2LocalStateEncode(out,decoded)');
  });

  it('declares static-array bounds as MQL5 preprocessor constants', () => {
    const codec = source('Include/TradeOpsTelemetryStorageCodec.mqh');
    expect(codec).toContain('#define TOV2_LOCAL_EVENTS 512');
    expect(codec).toContain('#define TOV2_LOCAL_BATCH 32');
    expect(codec).not.toContain('const int TOV2_LOCAL_EVENTS=512;');
    expect(codec).not.toContain('const int TOV2_LOCAL_BATCH=32;');
  });

  it('matches independent metadata and full-file golden vectors', () => {
    const native = source('Scripts/TradeOpsTelemetryStorageCodecSelfTest.mq5');
    const calls = [...native.matchAll(/^   Golden\((.*)\);$/gm)];
    expect(calls).toHaveLength(3);
    const expected = vectors();
    const names: string[] = [];
    for (const call of calls) {
      const capture = call[1];
      expect(capture).toBeDefined();
      if (capture === undefined) throw new Error('missing golden call capture');
      const args = JSON.parse('[' + capture.replace(',payload,', ',') + ']') as
        [string, number, string, number, string, number];
      const [name, generation, payloadHash, payloadSize, frameHash, frameSize] = args;
      names.push(name);
      const vector = expected.get(name);
      expect(vector, name).toBeDefined();
      if (!vector) throw new Error('unknown golden vector');
      expect(generation).toBe(vector.generation);
      expect(payloadSize).toBe(vector.payload.length);
      expect(payloadHash).toBe(hash(vector.payload));
      expect(frameSize).toBe(vector.frame.length);
      expect(frameHash).toBe(hash(vector.frame));
      expect(frameHash).not.toBe(payloadHash);
    }
    expect(new Set(names)).toEqual(new Set(expected.keys()));
  });

  it('preserves existing values and records code byte-for-byte', () => {
    expect(hash(source('Include/TradeOpsTelemetryValues.mqh')))
      .toBe('0016223e32d8d0cf960a3b015581518948a8a2e1464196c0d8f7952d4dc9ea4f');
    expect(hash(source('Include/TradeOpsTelemetryRecord.mqh')))
      .toBe('7a0f42d1d481487ba812f6ef2b18faaf3f80143980388f4f54efd8075d977685');
  });

  it('agrees with existing receiver identity and integer boundaries', () => {
    const identity = {
      account_id: 'account.demo', installation_id: 'install.demo', tracking_id: 'tracking.demo',
      safety_epoch: 0, account_profile_sha256: 'd'.repeat(64),
      account_fingerprint_sha256: 'e'.repeat(64), tracking_boundary_sha256: 'f'.repeat(64),
    };
    expect(readIdentityV2(identity)).toEqual(identity);
    expect(readCounterV2(9007199254740991)).toBe(9007199254740991);
    expect(() => readCounterV2(9007199254740992)).toThrow();
    expect(readTicketV2('18446744073709551615')).toBe('18446744073709551615');
    expect(() => readTicketV2('18446744073709551616')).toThrow();
    const native = source('Scripts/TradeOpsTelemetryStorageCodecSelfTest.mq5');
    expect(native).toContain(hash('TOV2-INSTALL|install.demo'));
    expect(native).toContain(hash(Buffer.alloc(262345, 165)));
    expect(native).toContain('identity.zero_epoch_compatible');
  });

  it('retains native rejection and output-clearing cases', () => {
    const native = source('Scripts/TradeOpsTelemetryStorageCodecSelfTest.mq5');
    for (const label of [
      'state.unknown_schema', 'state.overflow', 'state.unknown_error',
      'state.extra_lf', 'state.missing_lf', 'state.crlf_rejected',
      'state.absent_pending_metadata', 'state.absent_ack_metadata',
      'events.duplicate_id', 'events.duplicate_revision', 'events.sequence',
      'pending.repeated_deal', 'pending.repeated_deal_prefix', 'pending.frozen_produced',
      'heartbeat.nonzero_prior', 'heartbeat.no_ack_reset',
      'ack.exact_event', 'ack.exact_request', 'ack.pending_association',
      'reference.path_collision', 'reference.future', 'reference.traversal',
      'queue.512', 'queue.513_rejected', 'queue.negative_rejected',
      'queue.512_decode', 'queue.512_reencode', 'copy.self_alias', 'match.self_alias',
      'match.generation', 'match.kind', 'match.digest',
      'commit.schema', 'commit.parent_order', 'commit.not_state', 'state.not_commit',
      'hash.full_frame_max', 'hash.oversized_clear', 'hash.empty_clear',
      'error.required_for_gap', 'error.named_gap', 'error.reconciliation',
    ]) expect(native, label).toContain('"' + label + '"');
    expect(native).toContain('TOV2_STORAGE_CODEC_PASS');
    expect(native).toContain('TOV2_STORAGE_CODEC_FAIL');
    expect(native).toContain('TOV2_STORAGE_CODEC_FAILURE');
    expect(native).toContain('out.generation==0 && out.identity==""');
  });
});
