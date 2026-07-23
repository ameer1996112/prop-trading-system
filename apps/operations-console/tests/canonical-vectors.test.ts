import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  canonicalize,
  parseCanonicalJson,
  validateFixedDecimal,
} from "../src/lib/canonical";

type Vectors = {
  valid: Array<{ name: string; value: unknown; canonical_utf8: string; sha256: string }>;
  invalid: Array<{
    name: string;
    operation: "parse" | "fixed_decimal";
    raw_json?: string;
    value?: string;
    scale?: number;
  }>;
};

const vectors = JSON.parse(
  readFileSync(resolve(process.cwd(), "../../contracts/vectors/canonical-json-v1.json"), "utf8"),
) as Vectors;

describe("canonical JSON shared vectors", () => {
  for (const vector of vectors.valid) {
    it(vector.name, () => {
      const canonical = canonicalize(vector.value);
      expect(canonical).toBe(vector.canonical_utf8);
      expect(createHash("sha256").update(canonical, "utf8").digest("hex")).toBe(vector.sha256);
    });
  }

  for (const vector of vectors.invalid) {
    it(`rejects ${vector.name}`, () => {
      if (vector.operation === "parse") {
        expect(() => parseCanonicalJson(vector.raw_json ?? "")).toThrow();
      } else {
        expect(() => validateFixedDecimal(vector.value ?? "", vector.scale ?? 0)).toThrow();
      }
    });
  }

  it("rejects non-Unicode-scalar strings supplied directly", () => {
    expect(() => canonicalize({ value: "\ud800" })).toThrow();
    expect(() => canonicalize({ value: "\udc00" })).toThrow();
    expect(() => canonicalize({ value: "embedded\u0000null" })).toThrow();
  });

  it("rejects duplicate decoded keys at every nesting level", () => {
    expect(() => parseCanonicalJson('{"a":1,"\\u0061":2}')).toThrow(/duplicate/u);
    expect(() => parseCanonicalJson('{"outer":{"a":1,"a":2}}')).toThrow(/duplicate/u);
  });

  it("rejects non-JSON objects, sparse arrays, accessors, and hidden state", () => {
    const sparse = new Array(1);
    const extraArray = [1] as unknown[] & { extra?: number };
    extraArray.extra = 2;
    const accessor = Object.defineProperty({}, "value", {
      enumerable: true,
      get: () => 1,
    });
    const hidden = Object.defineProperty({}, "hidden", { value: 1 });
    const symbol = { [Symbol("hidden")]: 1 };
    const customPrototypeArray = [1];
    Object.setPrototypeOf(customPrototypeArray, { custom: true });
    class DerivedArray extends Array<number> {}
    const derivedArray = new DerivedArray();
    derivedArray.push(2);
    const hiddenArrayElement = Object.defineProperty([3], "0", {
      enumerable: false,
    });

    for (const value of [
      new Date(0),
      new Map([["a", 1]]),
      sparse,
      extraArray,
      accessor,
      hidden,
      symbol,
      customPrototypeArray,
      derivedArray,
      hiddenArrayElement,
    ]) {
      expect(() => canonicalize(value)).toThrow();
    }
  });
});
