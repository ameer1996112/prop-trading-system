import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { canonicalStringify } from '../src/canonical';
import {
  parseFixedV2,
  readCounterV2,
  readDigestV2,
  readIdentifierV2,
  readTicketV2,
} from '../src/telemetry-values-v2';
import { reading } from '../src/telemetry-schema-v2';

const root = join(import.meta.dirname, '../../..');
const agent = join(root, 'mt5/TradeOpsAgent');

function read(relativePath: string): string {
  const path = join(agent, relativePath);
  expect(existsSync(path), `${relativePath} must exist`).toBe(true);
  return readFileSync(path, 'utf8');
}

function vectors(name: string, minimum: number): unknown[][] {
  const native = read('Scripts/TradeOpsTelemetryValuesSelfTest.mq5');
  const pattern = new RegExp(`^   ${name}\\((.*)\\);$`, 'gm');
  const matches = [...native.matchAll(pattern)];
  expect(matches.length, `${name} vector count`).toBeGreaterThanOrEqual(minimum);
  return matches.map((match) => JSON.parse(`[${match[1]}]`) as unknown[]);
}

function accepted(action: () => unknown): boolean {
  try {
    action();
    return true;
  } catch {
    return false;
  }
}

describe('MT5 telemetry exact-values source seam', () => {
  it('is an isolated pure implementation and synthetic native fixture', () => {
    const values = read('Include/TradeOpsTelemetryValues.mqh');
    const script = read('Scripts/TradeOpsTelemetryValuesSelfTest.mq5');
    const ea = read('TradeOpsAgent.mq5');

    expect(values).toContain('bool Tov2FixedJson(');
    expect(values).toContain('StringFormat("%I64u",value)');
    expect(values).toContain('MathIsValidNumber(value)');
    expect(script).toContain('TOV2_VALUES_PASS');
    expect(script).toContain('ulong largest=~(ulong)0;');
    expect(script).toContain('CheckDouble(MathArcsin(2.0),2,"");');
    expect(script).not.toContain("StringInit('a',160)");
    expect(script).not.toContain("StringInit('a',161)");
    expect(script).toContain('string long_id="";');
    expect(script).toContain('for(int i=0;i<160;i++) long_id+="a";');
    expect(script).toContain('Check(Tov2Identifier(long_id),"160 character identifier");');
    expect(script).toContain('Check(!Tov2Identifier(long_id+"a"),"161 character identifier");');
    expect(values).not.toMatch(/\b(?:WebRequest|FileOpen|OrderSend|OrderSendAsync|CTrade|AccountInfo\w*|History\w*|PositionGet\w*|OrderGet\w*|OnTimer|OnTradeTransaction)\b|#import/u);
    expect(script).not.toMatch(/\b(?:WebRequest|FileOpen|OrderSend|OrderSendAsync|CTrade|AccountInfo\w*|History\w*|PositionGet\w*|OrderGet\w*|OnTimer|OnTradeTransaction)\b|#import/u);
    expect(values).not.toMatch(/^\s*#include/mu);
    expect(script.split('\n').filter((line) => line.startsWith('#include'))).toEqual(['#include "../Include/TradeOpsTelemetryValues.mqh"']);
    expect(ea).not.toContain('TradeOpsTelemetryValues');
  });

  it('keeps fixed-decimal vectors and known readings canonical', () => {
    for (const [raw, scale, expected] of vectors('CheckFixed', 26)) {
      const value = raw as string;
      const fixedScale = scale as number;
      const valid = expected as boolean;
      expect(accepted(() => parseFixedV2(value, fixedScale)), value).toBe(valid);
      if (valid) {
        const fixed = parseFixedV2(value, fixedScale);
        expect(canonicalStringify(fixed)).toBe(`{"scale":${fixedScale},"value":"${value}"}`);
        expect(canonicalStringify(reading({ value: fixed, reason: null }))).toBe(`{"reason":null,"value":{"scale":${fixedScale},"value":"${value}"}}`);
      }
    }
  });

  it('matches ticket, identifier, and digest literal vectors', () => {
    for (const [raw, expected] of vectors('CheckTicket', 11)) {
      expect(accepted(() => readTicketV2(raw)), String(raw)).toBe(expected as boolean);
    }
    for (const [raw, expected] of vectors('CheckIdentifier', 6)) {
      expect(accepted(() => readIdentifierV2(raw)), String(raw)).toBe(expected as boolean);
    }
    for (const [raw, expected] of vectors('CheckDigest', 5)) {
      expect(accepted(() => readDigestV2(raw)), String(raw)).toBe(expected as boolean);
    }
    expect(accepted(() => readIdentifierV2('a'.repeat(160)))).toBe(true);
    expect(accepted(() => readIdentifierV2('a'.repeat(161)))).toBe(false);
    expect(accepted(() => readIdentifierV2(String.fromCharCode(0x20ac)))).toBe(false);
  });

  it('matches counter vectors and enforces canonical decimal text', () => {
    for (const [raw, minimum, expected] of vectors('CheckCounter', 11)) {
      const value = raw as string;
      const floor = minimum as number;
      const valid = expected as boolean;
      const canonical = /^(0|[1-9][0-9]*)$/u.test(value);
      expect(canonical && accepted(() => readCounterV2(Number(value), floor)), value).toBe(valid);
    }
  });

  it('matches missing-reading reason vectors and canonical bytes', () => {
    for (const [raw, expected] of vectors('CheckMissing', 7)) {
      const reason = raw as string;
      const valid = expected as boolean;
      expect(accepted(() => reading({ value: null, reason: reason as never })), reason).toBe(valid);
      if (valid) {
        expect(canonicalStringify(reading({ value: null, reason: reason as never }))).toBe(`{"reason":"${reason}","value":null}`);
      }
    }
  });
});
