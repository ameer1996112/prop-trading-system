import { describe, expect, it } from "vitest";

import { isStrictJsonNumber, parseStrictJson } from "../src/strict-json";

function encoded(source: string): Uint8Array {
  return new TextEncoder().encode(source);
}

describe("strict JSON number identity", () => {
  it("recognizes parser-created numeric tokens", () => {
    const value = parseStrictJson(encoded("123"));

    expect(isStrictJsonNumber(value)).toBe(true);
    if (!isStrictJsonNumber(value)) {
      throw new TypeError("expected a strict JSON number");
    }
    expect(value).toMatchObject({
      type: "json-number",
      raw: "123",
      value: 123,
      isIntegerToken: true,
    });
  });

  it("rejects forged numeric tag objects parsed from JSON", () => {
    const value = parseStrictJson(
      encoded(
        '{"type":"json-number","raw":"1","value":1,"isIntegerToken":true}',
      ),
    );

    expect(isStrictJsonNumber(value)).toBe(false);
  });
});
