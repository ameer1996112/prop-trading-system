import { describe, expect, it } from 'vitest';
import {
  Reader, bad, boundedBody, boolean, canonicalInput, check, choice, fixed,
  integer, list, nullable, object, reading, text,
} from '../src/telemetry-schema-v2';
import { parseFixedV2, readCounterV2 } from '../src/telemetry-values-v2';

const expectCode = (fn: () => unknown, code: string) => expect(fn).toThrow(code);

describe('telemetry schema v2 primitives', () => {
  it('provides stable assertion primitives', () => {
    expect(() => bad()).toThrow('TELEMETRY_INVALID');
    expect(() => bad('X')).toThrow('X');
    expect(() => check(true)).not.toThrow();
    expect(() => check(1 as unknown)).not.toThrow();
    expectCode(() => check(false), 'TELEMETRY_INVALID');
    const reader: Reader<number> = integer();
    expect(reader(4)).toBe(4);
    expectCode(() => integer(2)(1), 'TELEMETRY_COUNTER_INVALID');
  });

  it('validates booleans, bounded text, choices and nullable values', () => {
    expect(boolean(true)).toBe(true);
    expectCode(() => boolean(1), 'TELEMETRY_INVALID');
    expect(text(3)('abc')).toBe('abc');
    expectCode(() => text(3)('abcd'), 'TELEMETRY_INVALID');
    expectCode(() => text(3)('a\n'), 'TELEMETRY_INVALID');
    expect(text(4, /^A+$/u)('AA')).toBe('AA');
    expect(choice('A', 1, true, null)('A')).toBe('A');
    expectCode(() => choice('A', 1)(false), 'TELEMETRY_INVALID');
    expect(nullable(integer())(null)).toBeNull();
    expect(nullable(integer())(3)).toBe(3);
  });

  it('validates exact plain objects and dense arrays, freezing outputs', () => {
    const user = object({ id: text(10), count: integer() });
    expect(user({ id: 'x', count: 2 })).toEqual({ id: 'x', count: 2 });
    expect(Object.isFrozen(user({ id: 'x', count: 2 }))).toBe(true);
    for (const value of [null, [], Object.create({ id: 'x' }), { id: 'x' }, { id: 'x', count: 1, extra: 2 }]) {
      expectCode(() => user(value), 'TELEMETRY_INVALID');
    }
    expect(user(Object.assign(Object.create(null), { id: 'x', count: 2 }))).toEqual({ id: 'x', count: 2 });
    const protoShape = object(Object.fromEntries([['__proto__', object({ ok: boolean })]]));
    const protoValue = protoShape(JSON.parse('{"__proto__":{"ok":true}}'));
    expect(Object.prototype.hasOwnProperty.call(protoValue, '__proto__')).toBe(true);
    expect((protoValue as { readonly ['__proto__']: { readonly ok: boolean } }).__proto__).toEqual({ ok: true });
    expect(Object.getPrototypeOf(protoValue)).toBe(Object.prototype);
    const values = list(integer(), 2)([1, 2]);
    expect(values).toEqual([1, 2]);
    expect(Object.isFrozen(values)).toBe(true);
    expectCode(() => list(integer(), 3)([1, , 2]), 'TELEMETRY_INVALID');
    expectCode(() => list(integer(), 2)(Object.assign([1], { extra: 2 })), 'TELEMETRY_INVALID');
    expectCode(() => list(integer(), 2)([1, 2, 3]), 'TELEMETRY_INVALID');
    const hidden = [1]; Object.defineProperty(hidden, '0', { value: 1, enumerable: false });
    expectCode(() => list(integer(), 2)(hidden), 'TELEMETRY_INVALID');
    const accessor = [1]; Object.defineProperty(accessor, '0', { get: () => 1, enumerable: true });
    expectCode(() => list(integer(), 2)(accessor), 'TELEMETRY_INVALID');
    const extraIndex = [1]; Object.defineProperty(extraIndex, '00', { value: 2, enumerable: true });
    expectCode(() => list(integer(), 2)(extraIndex), 'TELEMETRY_INVALID');
  });

  it('reads fixed decimals and reading null/reason relationships', () => {
    expect(fixed({ value: '1.25', scale: 2 })).toEqual(parseFixedV2('1.25', 2));
    expectCode(() => fixed({ value: '1.2', scale: 2 }), 'TELEMETRY_DECIMAL_INVALID');
    expectCode(() => fixed({ value: '1.25', scale: 2, extra: 1 }), 'TELEMETRY_INVALID');
    expect(reading({ value: { value: '1.25', scale: 2 }, reason: null })).toEqual({ value: { value: '1.25', scale: 2 }, reason: null });
    expect(reading({ value: null, reason: 'READ_FAILED' })).toEqual({ value: null, reason: 'READ_FAILED' });
    const literalReason: 'READ_FAILED' | 'NOT_APPLICABLE' | 'NOT_SET' | 'UNAVAILABLE' | null = reading({ value: null, reason: 'READ_FAILED' }).reason;
    expect(literalReason).toBe('READ_FAILED');
    expectCode(() => reading({ value: null, reason: null }), 'TELEMETRY_INVALID');
    expectCode(() => reading({ value: { value: '1.25', scale: 2 }, reason: 'READ_FAILED' }), 'TELEMETRY_INVALID');
  });
});

describe('telemetry canonical input and body bounds', () => {
  it('accepts only exact canonical JSON and enforces depth/UTF-8', () => {
    expect(canonicalInput(new TextEncoder().encode('{"a":1}'))).toEqual({ a: 1 });
    expectCode(() => canonicalInput(new TextEncoder().encode('')), 'TELEMETRY_INVALID');
    for (const raw of [' {"a":1}', '\ufeff{"a":1}', '{"a":1,"a":2}', '{"a":1.0}', '{"a":1e0}']) {
      expectCode(() => canonicalInput(new TextEncoder().encode(raw)), 'TELEMETRY_INVALID');
    }
    const tooDeep = `${'['.repeat(17)}0${']'.repeat(17)}`;
    expectCode(() => canonicalInput(new TextEncoder().encode(tooDeep)), 'TELEMETRY_INVALID');
    expectCode(() => canonicalInput(new Uint8Array([0xc3, 0x28])), 'TELEMETRY_INVALID');
    const nested = (depth: number): unknown => depth === 0 ? 0 : [nested(depth - 1)];
    expect(canonicalInput(new TextEncoder().encode(JSON.stringify(nested(16))))).toEqual(nested(16));
    expectCode(() => canonicalInput(new TextEncoder().encode(JSON.stringify(nested(17)))), 'TELEMETRY_INVALID');
    const exact = new TextEncoder().encode('{"x":"ok"}');
    expect(canonicalInput(exact, exact.byteLength)).toEqual({ x: 'ok' });
    expectCode(() => canonicalInput(exact, exact.byteLength - 1), 'TELEMETRY_TOO_LARGE');
  });

  it('bounds request and response bodies, including lying headers and failures', async () => {
    const make = (body: BodyInit | null, headers?: HeadersInit) => new Request('https://example.test', headers === undefined ? { method: 'POST', body } : { method: 'POST', body, headers } as RequestInit);
    expect(await boundedBody(make(null))).toEqual(new Uint8Array());
    expect(await boundedBody(make('{"a":1}', { 'Content-Length': '999999' })).catch((e) => e.message)).toBe('TELEMETRY_TOO_LARGE');
    let headerCancelled = false;
    const headerStream = new ReadableStream<Uint8Array>({ cancel() { headerCancelled = true; } });
    await expect(boundedBody({ body: headerStream, headers: new Headers({ 'Content-Length': '999999' }) } as unknown as Request)).rejects.toThrow('TELEMETRY_TOO_LARGE');
    expect(headerCancelled).toBe(true);
    expect(await boundedBody(make('12345', { 'Content-Length': '1' }), 5)).toEqual(new TextEncoder().encode('12345'));
    expect(await boundedBody(new Response('ok'))).toEqual(new TextEncoder().encode('ok'));
    let cancelled = false;
    let pulls = 0;
    const stream = new ReadableStream<Uint8Array>({ pull(c) { pulls += 1; c.enqueue(pulls === 1 ? new Uint8Array([1, 2, 3]) : new Uint8Array([4, 5, 6])); }, cancel() { cancelled = true; } });
    await expect(boundedBody({ body: stream, headers: new Headers() } as unknown as Request, 5)).rejects.toThrow('TELEMETRY_TOO_LARGE');
    expect(cancelled).toBe(true);
    expect(stream.locked).toBe(false);
    const failing = new ReadableStream<Uint8Array>({ pull() { throw new Error('read-failure'); } });
    await expect(boundedBody({ body: failing, headers: new Headers() } as unknown as Request)).rejects.toThrow('read-failure');
  });
});

it('retains Stage 1 integer semantics', () => {
  expect(integer()(Number.MAX_SAFE_INTEGER)).toBe(readCounterV2(Number.MAX_SAFE_INTEGER));
  expectCode(() => integer()(Number.MAX_SAFE_INTEGER + 1), 'TELEMETRY_COUNTER_INVALID');
});
