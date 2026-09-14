import { canonicalStringify } from './canonical';
import { parseFixedV2, readCounterV2, type FixedDecimalV2 } from './telemetry-values-v2';

export type Reader<T> = (value: unknown) => T;

export function bad(code = 'TELEMETRY_INVALID'): never { throw new Error(code); }
export function check(ok: unknown, code = 'TELEMETRY_INVALID'): asserts ok { if (!ok) bad(code); }
export function integer(minimum = 0): Reader<number> { return (value) => readCounterV2(value, minimum); }
export const boolean: Reader<boolean> = (value) => { if (typeof value !== 'boolean') bad(); return value; };
export function text(max: number, pattern = /^[^\u0000-\u001f\u007f]+$/u): Reader<string> {
  return (value) => { if (typeof value !== 'string' || value.length > max || !pattern.test(value)) bad(); return value; };
}
export function choice<const T extends readonly (string | number | boolean | null)[]>(...values: T): Reader<T[number]> {
  return (value) => { if (!values.some((entry) => Object.is(entry, value))) bad(); return value as T[number]; };
}
export function nullable<T>(reader: Reader<T>): Reader<T | null> { return (value) => value === null ? null : reader(value); }

function exactPlain(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) bad();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) bad();
  const own = Reflect.ownKeys(value);
  if (own.length !== keys.length || own.some((key) => typeof key !== 'string' || !keys.includes(key))) bad();
  for (const key of own) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) bad();
  }
  return value as Record<string, unknown>;
}
export function object<const S extends Record<string, Reader<unknown>>>(shape: S): Reader<{ readonly [K in keyof S]: ReturnType<S[K]> }> {
  const keys = Object.keys(shape);
  return (value) => {
    const source = exactPlain(value, keys);
    const result = Object.fromEntries(keys.map((key) => [key, shape[key]?.(source[key])]));
    return Object.freeze(result) as { readonly [K in keyof S]: ReturnType<S[K]> };
  };
}
export function list<T>(reader: Reader<T>, max: number): Reader<readonly T[]> {
  return (value) => {
    if (!Array.isArray(value) || value.length > max || Object.getPrototypeOf(value) !== Array.prototype) bad();
    const keys = Reflect.ownKeys(value);
    if (keys.length !== value.length + 1 || !keys.includes('length')) bad();
    for (let index = 0; index < value.length; index += 1) {
      if (!keys.includes(String(index))) bad();
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) bad();
    }
    if (keys.some((key) => key !== 'length' && (typeof key !== 'string' || !/^\d+$/u.test(key) || Number(key) >= value.length))) bad();
    const result = Array.from({ length: value.length }, (_, index) => reader(Object.getOwnPropertyDescriptor(value, String(index))?.value));
    return Object.freeze(result);
  };
}

export const fixed: Reader<FixedDecimalV2> = (value) => {
  const source = exactPlain(value, ['value', 'scale']);
  return parseFixedV2(text(36)(source.value), integer()(source.scale));
};
const readingReason = nullable(choice('READ_FAILED', 'NOT_APPLICABLE', 'NOT_SET', 'UNAVAILABLE'));
export type ReadingReason = 'READ_FAILED' | 'NOT_APPLICABLE' | 'NOT_SET' | 'UNAVAILABLE';
export const reading: Reader<{ value: FixedDecimalV2 | null; reason: ReadingReason | null }> = (value) => {
  const source = exactPlain(value, ['value', 'reason']);
  const result = { value: nullable(fixed)(source.value), reason: readingReason(source.reason) };
  if ((result.value === null) !== (result.reason !== null)) bad();
  return Object.freeze(result);
};

function depth(value: unknown, level: number): void {
  if (level > 16) bad();
  if (value !== null && typeof value === 'object') for (const child of Array.isArray(value) ? value : Object.values(value)) depth(child, level + 1);
}
export function canonicalInput(bytes: Uint8Array, max = 256 * 1024): unknown {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) bad();
  if (bytes.byteLength > max) bad('TELEMETRY_TOO_LARGE');
  let raw: string;
  try { raw = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); } catch { bad(); }
  try { const value: unknown = JSON.parse(raw); depth(value, 0); check(canonicalStringify(value) === raw); return value; } catch (error) { if (error instanceof Error && error.message === 'TELEMETRY_TOO_LARGE') throw error; bad(); }
}

export async function boundedBody(input: Request | Response, max = 256 * 1024): Promise<Uint8Array> {
  const length = input.headers.get('content-length');
  if (length !== null && /^\d+$/u.test(length) && Number(length) > max) {
    if (input.body !== null) { const reader = input.body.getReader(); try { await reader.cancel(); } catch { /* ignore */ } finally { reader.releaseLock(); } }
    bad('TELEMETRY_TOO_LARGE');
  }
  if (input.body === null) return new Uint8Array();
  const reader = input.body.getReader(); const chunks: Uint8Array[] = []; let total = 0;
  try { while (true) { const item = await reader.read(); if (item.done) break; total += item.value.byteLength; if (total > max) bad('TELEMETRY_TOO_LARGE'); chunks.push(item.value); } } catch (error) { try { await reader.cancel(); } catch { /* ignore */ } throw error; } finally { reader.releaseLock(); }
  const result = new Uint8Array(total); let offset = 0; for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; } return result;
}
