import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { readCounterV2 } from '../src/telemetry-values-v2';

const root = join(import.meta.dirname, '../../..');
const agent = join(root, 'mt5/TradeOpsAgent');

function read(relativePath: string): string {
  const path = join(agent, relativePath);
  expect(existsSync(path), `${relativePath} must exist`).toBe(true);
  return readFileSync(path, 'utf8');
}

describe('MT5 local telemetry record v2 source seam', () => {
  it('keeps the codec and synthetic fixture isolated and pure', () => {
    const codec = read('Include/TradeOpsTelemetryRecord.mqh');
    const native = read('Scripts/TradeOpsTelemetryRecordSelfTest.mq5');
    const active = read('TradeOpsAgent.mq5');

    expect(codec.split('\n').filter((line) => line.startsWith('#include')))
      .toEqual(['#include "TradeOpsTelemetryValues.mqh"']);
    expect(native.split('\n').filter((line) => line.startsWith('#include')))
      .toEqual(['#include "../Include/TradeOpsTelemetryRecord.mqh"']);
    expect(active).not.toContain('TradeOpsTelemetryRecord');
    const forbidden = /\b(?:File\w*|Folder\w*|WebRequest|Socket\w*|OrderSend\w*|CTrade|AccountInfo\w*|History\w*|PositionGet\w*|OrderGet\w*|OnTimer|OnTradeTransaction)\b|#import/u;
    expect(codec).not.toMatch(forbidden);
    expect(native).not.toMatch(forbidden);
    expect(codec).toContain('CryptEncode(CRYPT_HASH_SHA256,bytes,key,digest)==32');
    expect(codec).toContain('ArraySize(digest)==32');
    expect(codec.match(/Tov2CounterFromText\(/g)).toHaveLength(2);
    expect(codec).not.toMatch(/\b(?:double|StringToDouble|CharArrayToString)\b/u);
    expect(codec).toMatch(/string canonical_header="TOV2R1\|"\+parts\[1\]\+"\|"\+StringFormat\("%I64d",parsed_generation\)\+"\|"\+IntegerToString\(payload_count\);/u);
    expect(codec).not.toMatch(/string canonical_header=.*\\n";/u);
    expect(codec).toContain('if(!StringInit(header,header_end,32) || StringLen(header)!=header_end) return false;');
    expect(codec).toContain('if(!StringSetCharacter(header,index,(ushort)frame[index])) return false;');
    expect(codec).toContain('string candidate="";');
    expect(codec).toContain('if(StringLen(candidate)!=64) return false;');
    expect(codec).toContain('hex=candidate;');
    expect(codec).not.toContain('return StringLen(hex)==64;');
  });

  it('matches the three native golden vectors and exact SHA-256 framing', () => {
    const native = read('Scripts/TradeOpsTelemetryRecordSelfTest.mq5');
    const matches = [...native.matchAll(/^   Golden\((.*)\);$/gm)];
    expect(matches).toHaveLength(3);

    for (const match of matches) {
      const [kind, generationText, payloadHex, digest, expectedSize] = JSON.parse(`[${match[1]}]`) as [string, string, string, string, number];
      expect(String(readCounterV2(Number(generationText), 1))).toBe(generationText);
      const payload = Buffer.from(payloadHex, 'hex');
      expect(payload.toString('hex')).toBe(payloadHex);
      const header = Buffer.from(`TOV2R1|${kind}|${generationText}|${payload.length}\n`, 'ascii');
      const hash = createHash('sha256').update(Buffer.concat([header, payload])).digest('hex');
      expect(hash).toBe(digest);
      const frame = Buffer.concat([header, payload, Buffer.from(`\nSHA256|${digest}\n`, 'ascii')]);
      expect(frame.length).toBe(expectedSize);
      expect(frame.subarray(header.length, header.length + payload.length)).toEqual(payload);
    }
  });

  it('retains exhaustive corruption, bounds, and self-test evidence in the native fixture', () => {
    const native = read('Scripts/TradeOpsTelemetryRecordSelfTest.mq5');
    expect(native).toMatch(/for\(int length=0; length<ArraySize\(frame\); length\+\+\)/u);
    expect(native).toMatch(/for\(int index=0; index<ArraySize\(frame\); index\+\+\)/u);
    expect(native).toContain('mutated[index]^=1');
    expect(native).toContain('concatenated');
    expect(native).toContain('TOV2R1|EVENT|01|1');
    expect(native).toContain('TOV2R1|EVENT|9007199254740992|1');
    expect(native).toContain('ArrayResize(max_payload,262144)');
    expect(native).toContain('ArrayResize(oversized,262145)');
    expect(native).toContain('ArrayResize(overlong_frame,262346)');
    expect(native).toContain('ArrayResize(bad_kind_frame,1);');
    expect(native).toContain('bad_kind_frame[0]=99;');
    expect(native).toContain('ArrayResize(generation_frame,1);');
    expect(native).toContain('kind="sentinel"');
    expect(native).toContain('generation=123');
    expect(native).toContain('decoded[0]=99');
    expect(native).toContain('TOV2_RECORD_FAILURE');
    expect(native).toContain('TOV2_RECORD_PASS');
    expect(native).toContain('TOV2_RECORD_FAIL');
  });
});
