import { describe, expect, it } from "vitest";

import { canonicalStringify, sha256Hex } from "../src/canonical";

describe("canonical JSON", () => {
  it("sorts object keys recursively by Unicode code point", () => {
    const astralKey = String.fromCodePoint(0x10000);
    const privateUseKey = String.fromCodePoint(0xe000);
    const value = {
      [astralKey]: { z: 1, a: 2 },
      [privateUseKey]: 3,
      a: 4,
    };

    expect(canonicalStringify(value)).toBe(`{"a":4,"${privateUseKey}":3,"${astralKey}":{"a":2,"z":1}}`);
  });

  it("preserves array order", () => {
    expect(canonicalStringify({ values: [3, 1, 2] })).toBe('{"values":[3,1,2]}');
  });

  it("uses JSON escaping for strings", () => {
    expect(canonicalStringify({ text: 'quote " line\n\ttab' })).toBe(
      '{"text":"quote \\\" line\\n\\ttab"}',
    );
  });

  it("serializes supported primitive values deterministically", () => {
    expect(canonicalStringify({ nil: null, yes: true, no: false, integer: -42, decimal: 1.25 })).toBe(
      '{"decimal":1.25,"integer":-42,"nil":null,"no":false,"yes":true}',
    );
  });

  it("gives equivalent objects identical bytes and SHA-256", async () => {
    const first = canonicalStringify({ b: 2, a: 1 });
    const second = canonicalStringify({ a: 1, b: 2 });

    expect(new TextEncoder().encode(first)).toEqual(new TextEncoder().encode(second));
    await expect(sha256Hex(first)).resolves.toBe(await sha256Hex(second));
  });

  it("rejects unsupported values with CANONICAL_JSON_INVALID", () => {
    const invalidValues: unknown[] = [
      undefined,
      () => undefined,
      Symbol("symbol"),
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      [1, , 3],
      new Date("2026-01-01T00:00:00.000Z"),
      new Map([["key", "value"]]),
      new (class NotPlain {})(),
      Number.MAX_SAFE_INTEGER + 1,
      Number.MIN_SAFE_INTEGER - 1,
    ];

    for (const value of invalidValues) {
      expect(() => canonicalStringify(value as never)).toThrow("CANONICAL_JSON_INVALID");
    }

    expect(() => canonicalStringify({ value: undefined } as never)).toThrow(
      "CANONICAL_JSON_INVALID",
    );
    expect(() => canonicalStringify({ value: Symbol("symbol") } as never)).toThrow(
      "CANONICAL_JSON_INVALID",
    );
  });

  it("rejects symbols used as object keys", () => {
    const value = { normal: 1, [Symbol("key")]: 2 };
    expect(() => canonicalStringify(value as never)).toThrow("CANONICAL_JSON_INVALID");
  });

  it("rejects cyclic and sparse nested arrays", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => canonicalStringify(cyclic as never)).toThrow("CANONICAL_JSON_INVALID");

    const nested = [[, 1]];
    expect(() => canonicalStringify(nested as never)).toThrow("CANONICAL_JSON_INVALID");
  });

  it("hashes abc with SHA-256 lowercase hexadecimal", async () => {
    await expect(sha256Hex("abc")).resolves.toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});
