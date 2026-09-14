import { describe, expect, it } from 'vitest';
import {
  parseFixedV2,
  readCounterV2,
  readDigestV2,
  readIdentifierV2,
  readTicketV2,
  sumFixedV2,
} from '../src/telemetry-values-v2';

const decimalError = 'TELEMETRY_DECIMAL_INVALID';

describe('telemetry values v2', () => {
  it('parses exact signed fixed decimals', () => {
    expect(sumFixedV2(['100.00', '-2.50', '-0.25', '-0.10'].map((value) => parseFixedV2(value, 2)), 2)).toEqual({ value: '97.15', scale: 2 });
    expect(sumFixedV2([], 3)).toEqual({ value: '0.000', scale: 3 });
    expect(() => parseFixedV2('', 3)).toThrow(decimalError);
    expect(sumFixedV2([parseFixedV2('-0.10', 2), parseFixedV2('0.10', 2)], 2)).toEqual({ value: '0.00', scale: 2 });
    expect(sumFixedV2([parseFixedV2('9007199254740993.01', 2), parseFixedV2('0.01', 2)], 2)).toEqual({ value: '9007199254740993.02', scale: 2 });
    expect(Object.isFrozen(parseFixedV2('1.00', 2))).toBe(true);
    expect(parseFixedV2('1.0000000000000000', 16)).toEqual({ value: '1.0000000000000000', scale: 16 });
    expect(sumFixedV2([parseFixedV2('-1.00', 2), parseFixedV2('0.25', 2)], 2)).toEqual({ value: '-0.75', scale: 2 });
    expect(sumFixedV2([parseFixedV2('999999999999999999', 0), parseFixedV2('1', 0), parseFixedV2('-1', 0)], 0)).toEqual({ value: '999999999999999999', scale: 0 });
  });

  it('rejects malformed fixed decimals with the stable error', () => {
    for (const value of [null, 1.2, '', '.25', '-.25', '1e3', '01.00', '+1.00', '-0.00', '1.0', 'NaN']) {
      expect(() => parseFixedV2(value, 2)).toThrow(decimalError);
    }
    expect(() => parseFixedV2('1', 17)).toThrow(decimalError);
    expect(() => parseFixedV2('1', -1)).toThrow(decimalError);
    expect(() => sumFixedV2([], 1e9)).toThrow(decimalError);
    expect(() => sumFixedV2([parseFixedV2('1.00', 2), parseFixedV2('1.000', 3)], 2)).toThrow(decimalError);
    expect(() => parseFixedV2('999999999999999999', 0)).not.toThrow();
    expect(() => sumFixedV2([parseFixedV2('999999999999999999', 0), parseFixedV2('1', 0)], 0)).toThrow(decimalError);
  });

  it('accepts only uint64 decimal ticket text', () => {
    expect(readTicketV2('18446744073709551615')).toBe('18446744073709551615');
    for (const value of [0, 9007199254740992, '0', '01', '-1', '18446744073709551616']) {
      expect(() => readTicketV2(value)).toThrow('TELEMETRY_TICKET_INVALID');
    }
  });

  it('validates counters, identifiers, and digests', () => {
    expect(readCounterV2(0)).toBe(0);
    expect(() => readCounterV2(0, 1)).toThrow('TELEMETRY_COUNTER_INVALID');
    expect(() => readCounterV2(Number.MAX_SAFE_INTEGER + 1)).toThrow('TELEMETRY_COUNTER_INVALID');
    expect(readIdentifierV2('account-local-001')).toBe('account-local-001');
    expect(() => readIdentifierV2('account-local-001\n')).toThrow('TELEMETRY_IDENTIFIER_INVALID');
    expect(readDigestV2('abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789')).toBe('abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789');
    expect(() => readDigestV2('0000000000000000000000000000000000000000000000000000000000000000')).toThrow('TELEMETRY_DIGEST_INVALID');
    expect(() => readDigestV2('ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789')).toThrow('TELEMETRY_DIGEST_INVALID');
  });
});
