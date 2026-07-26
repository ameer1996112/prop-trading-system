const MAX_DEPTH = 64;
const MAX_NODES = 20_000;
const JSON_NUMBER = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/;
const STRICT_JSON_NUMBER_TOKENS = new WeakSet<object>();
const STRICT_JSON_NUMBER_KEYS = [
  "type",
  "raw",
  "value",
  "isIntegerToken",
] as const;

export interface StrictJsonNumber {
  readonly type: "json-number";
  readonly raw: string;
  readonly value: number;
  readonly isIntegerToken: boolean;
}

export type StrictJsonValue =
  | null
  | boolean
  | string
  | StrictJsonNumber
  | StrictJsonValue[]
  | { [key: string]: StrictJsonValue };

export class StrictJsonError extends Error {
  constructor(message = "invalid JSON") {
    super(message);
    this.name = "StrictJsonError";
  }
}

function createStrictJsonNumber(
  raw: string,
  value: number,
  isIntegerToken: boolean,
): StrictJsonNumber {
  const token = Object.freeze({
    type: "json-number" as const,
    raw,
    value,
    isIntegerToken,
  });
  STRICT_JSON_NUMBER_TOKENS.add(token);
  return token;
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) {
        return true;
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

class Parser {
  private index = 0;
  private nodes = 0;

  constructor(private readonly source: string) {}

  parse(): StrictJsonValue {
    this.skipWhitespace();
    const value = this.parseValue(0);
    this.skipWhitespace();
    if (this.index !== this.source.length) {
      throw new StrictJsonError();
    }
    return value;
  }

  private countNode(): void {
    this.nodes += 1;
    if (this.nodes > MAX_NODES) {
      throw new StrictJsonError("JSON contains too many values");
    }
  }

  private parseValue(depth: number): StrictJsonValue {
    if (depth > MAX_DEPTH) {
      throw new StrictJsonError("JSON nesting is too deep");
    }
    this.countNode();
    const current = this.source[this.index];
    if (current === "{") {
      return this.parseObject(depth + 1);
    }
    if (current === "[") {
      return this.parseArray(depth + 1);
    }
    if (current === '"') {
      return this.parseString();
    }
    if (current === "t" && this.consumeLiteral("true")) {
      return true;
    }
    if (current === "f" && this.consumeLiteral("false")) {
      return false;
    }
    if (current === "n" && this.consumeLiteral("null")) {
      return null;
    }
    return this.parseNumber();
  }

  private parseObject(depth: number): { [key: string]: StrictJsonValue } {
    this.index += 1;
    this.skipWhitespace();
    const value: { [key: string]: StrictJsonValue } = Object.create(null) as {
      [key: string]: StrictJsonValue;
    };
    const keys = new Set<string>();
    if (this.source[this.index] === "}") {
      this.index += 1;
      return value;
    }
    while (this.index < this.source.length) {
      if (this.source[this.index] !== '"') {
        throw new StrictJsonError();
      }
      const key = this.parseString();
      if (keys.has(key)) {
        throw new StrictJsonError("duplicate JSON object key");
      }
      keys.add(key);
      this.skipWhitespace();
      if (this.source[this.index] !== ":") {
        throw new StrictJsonError();
      }
      this.index += 1;
      this.skipWhitespace();
      value[key] = this.parseValue(depth);
      this.skipWhitespace();
      const separator = this.source[this.index];
      if (separator === "}") {
        this.index += 1;
        return value;
      }
      if (separator !== ",") {
        throw new StrictJsonError();
      }
      this.index += 1;
      this.skipWhitespace();
    }
    throw new StrictJsonError();
  }

  private parseArray(depth: number): StrictJsonValue[] {
    this.index += 1;
    this.skipWhitespace();
    const value: StrictJsonValue[] = [];
    if (this.source[this.index] === "]") {
      this.index += 1;
      return value;
    }
    while (this.index < this.source.length) {
      value.push(this.parseValue(depth));
      this.skipWhitespace();
      const separator = this.source[this.index];
      if (separator === "]") {
        this.index += 1;
        return value;
      }
      if (separator !== ",") {
        throw new StrictJsonError();
      }
      this.index += 1;
      this.skipWhitespace();
    }
    throw new StrictJsonError();
  }

  private parseString(): string {
    const start = this.index;
    this.index += 1;
    let escaped = false;
    while (this.index < this.source.length) {
      const character = this.source[this.index];
      if (character === undefined) {
        throw new StrictJsonError();
      }
      const code = character.charCodeAt(0);
      if (!escaped && code < 0x20) {
        throw new StrictJsonError();
      }
      if (!escaped && character === '"') {
        this.index += 1;
        const token = this.source.slice(start, this.index);
        let decoded: unknown;
        try {
          decoded = JSON.parse(token) as unknown;
        } catch {
          throw new StrictJsonError();
        }
        if (typeof decoded !== "string" || hasUnpairedSurrogate(decoded)) {
          throw new StrictJsonError();
        }
        return decoded;
      }
      if (!escaped && character === "\\") {
        escaped = true;
      } else {
        escaped = false;
      }
      this.index += 1;
    }
    throw new StrictJsonError();
  }

  private parseNumber(): StrictJsonNumber {
    const remaining = this.source.slice(this.index);
    const match = JSON_NUMBER.exec(remaining);
    if (match === null) {
      throw new StrictJsonError();
    }
    const raw = match[0];
    this.index += raw.length;
    const next = this.source[this.index];
    if (
      next !== undefined &&
      next !== "," &&
      next !== "]" &&
      next !== "}" &&
      next !== " " &&
      next !== "\t" &&
      next !== "\r" &&
      next !== "\n"
    ) {
      throw new StrictJsonError();
    }
    const numeric = Number(raw);
    if (!Number.isFinite(numeric)) {
      throw new StrictJsonError("non-finite JSON number");
    }
    const isIntegerToken = !raw.includes(".") && !raw.includes("e") &&
      !raw.includes("E");
    if (isIntegerToken && !Number.isSafeInteger(numeric)) {
      throw new StrictJsonError("unsafe JSON integer");
    }
    return createStrictJsonNumber(raw, numeric, isIntegerToken);
  }

  private consumeLiteral(literal: string): boolean {
    if (
      this.source.slice(this.index, this.index + literal.length) !== literal
    ) {
      return false;
    }
    this.index += literal.length;
    return true;
  }

  private skipWhitespace(): void {
    while (this.index < this.source.length) {
      const character = this.source[this.index];
      if (
        character !== " " &&
        character !== "\t" &&
        character !== "\r" &&
        character !== "\n"
      ) {
        return;
      }
      this.index += 1;
    }
  }
}

export function parseStrictJson(bytes: Uint8Array): StrictJsonValue {
  let source: string;
  try {
    source = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: false,
    }).decode(bytes);
  } catch {
    throw new StrictJsonError("invalid UTF-8 JSON");
  }
  return new Parser(source).parse();
}

export function isStrictJsonNumber(value: unknown): value is StrictJsonNumber {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !STRICT_JSON_NUMBER_TOKENS.has(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    !Object.isFrozen(value)
  ) {
    return false;
  }

  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== STRICT_JSON_NUMBER_KEYS.length ||
    !STRICT_JSON_NUMBER_KEYS.every((key) => keys.includes(key))
  ) {
    return false;
  }

  const candidate = value as Record<
    (typeof STRICT_JSON_NUMBER_KEYS)[number],
    unknown
  >;
  if (
    candidate.type !== "json-number" ||
    typeof candidate.raw !== "string" ||
    typeof candidate.value !== "number" ||
    typeof candidate.isIntegerToken !== "boolean"
  ) {
    return false;
  }

  const match = JSON_NUMBER.exec(candidate.raw);
  const numeric = Number(candidate.raw);
  const isIntegerToken = !candidate.raw.includes(".") &&
    !candidate.raw.includes("e") &&
    !candidate.raw.includes("E");
  return (
    match?.[0] === candidate.raw &&
    Number.isFinite(numeric) &&
    Object.is(candidate.value, numeric) &&
    candidate.isIntegerToken === isIntegerToken &&
    (!isIntegerToken || Number.isSafeInteger(numeric))
  );
}
