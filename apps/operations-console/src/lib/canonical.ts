export type CanonicalValue =
  | string
  | number
  | boolean
  | null
  | CanonicalValue[]
  | { [key: string]: CanonicalValue };

const keyPattern = /^[A-Za-z0-9_.:-]+$/;
const fixedDecimalPattern = /^-?(?:0|[1-9][0-9]*)\.([0-9]+)$/;
const hexadecimalPattern = /^[0-9A-Fa-f]{4}$/;

export class CanonicalizationError extends Error {}

export function validateFixedDecimal(value: string, scale: number): void {
  const match = fixedDecimalPattern.exec(value);
  if (match === null || match[1]?.length !== scale) {
    throw new CanonicalizationError(`expected a plain decimal string with scale ${scale}`);
  }
}

function assertUnicodeScalarString(value: string, location: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit === 0) {
      throw new CanonicalizationError(
        `${location}: U+0000 is outside the PostgreSQL-compatible JSON profile`,
      );
    } else if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new CanonicalizationError(`${location}: lone high surrogate is forbidden`);
      }
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new CanonicalizationError(`${location}: lone low surrogate is forbidden`);
    }
  }
}

function ownDataProperties(value: object, location: string): Map<string, unknown> {
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new CanonicalizationError(`${location}: objects must use a plain or null prototype`);
  }
  const properties = new Map<string, unknown>();
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") {
      throw new CanonicalizationError(`${location}: symbol properties are forbidden`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
      throw new CanonicalizationError(
        `${location}: only enumerable string-keyed data properties are permitted`,
      );
    }
    properties.set(key, descriptor.value);
  }
  return properties;
}

function serialize(value: unknown, location: string): string {
  if (value === null || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "string") {
    assertUnicodeScalarString(value, location);
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new CanonicalizationError(`${location}: only safe integers are permitted`);
    }
    return String(value);
  }
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) {
      throw new CanonicalizationError(`${location}: arrays must use the ordinary Array prototype`);
    }
    const ownKeys = Reflect.ownKeys(value);
    if (
      ownKeys.length !== value.length + 1 ||
      ownKeys.at(-1) !== "length" ||
      !Array.from({ length: value.length }, (_, index) => String(index)).every(
        (key, index) => ownKeys[index] === key,
      )
    ) {
      throw new CanonicalizationError(
        `${location}: arrays must be dense and contain only indexed elements`,
      );
    }
    const items: string[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
        throw new CanonicalizationError(
          `${location}[${index}]: array elements must be enumerable data properties`,
        );
      }
      items.push(serialize(descriptor.value, `${location}[${index}]`));
    }
    return `[${items.join(",")}]`;
  }
  if (typeof value === "object") {
    const properties = ownDataProperties(value, location);
    const keys = [...properties.keys()].sort();
    const members = keys.map((key) => {
      assertUnicodeScalarString(key, `${location} key`);
      if (!keyPattern.test(key)) {
        throw new CanonicalizationError(`${location}: key is outside the ASCII profile`);
      }
      return `${JSON.stringify(key)}:${serialize(properties.get(key), `${location}.${key}`)}`;
    });
    return `{${members.join(",")}}`;
  }
  throw new CanonicalizationError(`${location}: unsupported canonical value`);
}

export function canonicalize(value: unknown): string {
  return serialize(value, "$");
}

/** A deliberately small JSON parser that preserves the evidence JSON.parse discards. */
class StrictJsonParser {
  private offset = 0;

  constructor(private readonly raw: string) {}

  parse(): CanonicalValue {
    this.skipWhitespace();
    const value = this.parseValue();
    this.skipWhitespace();
    if (this.offset !== this.raw.length) this.fail("unexpected trailing input");
    return value;
  }

  private fail(message: string): never {
    throw new CanonicalizationError(`${message} at UTF-16 offset ${this.offset}`);
  }

  private peek(): string | undefined {
    return this.raw[this.offset];
  }

  private skipWhitespace(): void {
    while (/\s/u.test(this.peek() ?? "") && " \t\r\n".includes(this.peek() ?? "")) {
      this.offset += 1;
    }
  }

  private parseValue(): CanonicalValue {
    const character = this.peek();
    if (character === '"') return this.parseString();
    if (character === "{") return this.parseObject();
    if (character === "[") return this.parseArray();
    if (character === "t") return this.parseLiteral("true", true);
    if (character === "f") return this.parseLiteral("false", false);
    if (character === "n") return this.parseLiteral("null", null);
    if (character === "-" || (character !== undefined && /[0-9]/u.test(character))) {
      return this.parseInteger();
    }
    return this.fail("expected a JSON value");
  }

  private parseLiteral<T extends boolean | null>(token: string, value: T): T {
    if (this.raw.slice(this.offset, this.offset + token.length) !== token) {
      this.fail(`invalid ${token} literal`);
    }
    this.offset += token.length;
    return value;
  }

  private parseInteger(): number {
    const start = this.offset;
    if (this.peek() === "-") this.offset += 1;
    if (this.peek() === "0") {
      this.offset += 1;
      if (/[0-9]/u.test(this.peek() ?? "")) this.fail("leading-zero integer is forbidden");
    } else {
      if (!/[1-9]/u.test(this.peek() ?? "")) this.fail("invalid integer");
      while (/[0-9]/u.test(this.peek() ?? "")) this.offset += 1;
    }
    if (this.peek() === "." || this.peek() === "e" || this.peek() === "E") {
      this.fail("binary float and exponent JSON numbers are forbidden");
    }
    const token = this.raw.slice(start, this.offset);
    const value = Number(token);
    if (!Number.isSafeInteger(value)) this.fail("integer is outside the cross-language range");
    return value;
  }

  private parseString(): string {
    this.offset += 1;
    let result = "";
    while (this.offset < this.raw.length) {
      const character = this.raw[this.offset];
      if (character === '"') {
        this.offset += 1;
        return result;
      }
      if (character === "\\") {
        this.offset += 1;
        result += this.parseEscape();
        continue;
      }
      const unit = this.raw.charCodeAt(this.offset);
      if (unit < 0x20) this.fail("unescaped control character is forbidden");
      if (unit >= 0xd800 && unit <= 0xdbff) {
        const next = this.raw.charCodeAt(this.offset + 1);
        if (!(next >= 0xdc00 && next <= 0xdfff)) this.fail("lone high surrogate is forbidden");
        result += character ?? "";
        result += this.raw[this.offset + 1] ?? "";
        this.offset += 2;
        continue;
      }
      if (unit >= 0xdc00 && unit <= 0xdfff) this.fail("lone low surrogate is forbidden");
      result += character ?? "";
      this.offset += 1;
    }
    return this.fail("unterminated string");
  }

  private parseEscape(): string {
    const escape = this.raw[this.offset];
    this.offset += 1;
    const simple: Record<string, string> = {
      '"': '"',
      "\\": "\\",
      "/": "/",
      b: "\b",
      f: "\f",
      n: "\n",
      r: "\r",
      t: "\t",
    };
    if (escape !== undefined && Object.prototype.hasOwnProperty.call(simple, escape)) {
      return simple[escape] ?? "";
    }
    if (escape !== "u") return this.fail("invalid string escape");
    const first = this.readHexUnit();
    if (first >= 0xd800 && first <= 0xdbff) {
      if (this.raw.slice(this.offset, this.offset + 2) !== "\\u") {
        return this.fail("escaped high surrogate is not followed by an escaped low surrogate");
      }
      this.offset += 2;
      const second = this.readHexUnit();
      if (!(second >= 0xdc00 && second <= 0xdfff)) {
        return this.fail("escaped high surrogate has an invalid low surrogate");
      }
      return String.fromCodePoint(0x10000 + ((first - 0xd800) << 10) + (second - 0xdc00));
    }
    if (first >= 0xdc00 && first <= 0xdfff) return this.fail("lone escaped low surrogate is forbidden");
    return String.fromCharCode(first);
  }

  private readHexUnit(): number {
    const token = this.raw.slice(this.offset, this.offset + 4);
    if (!hexadecimalPattern.test(token)) this.fail("invalid Unicode escape");
    this.offset += 4;
    return Number.parseInt(token, 16);
  }

  private parseArray(): CanonicalValue[] {
    this.offset += 1;
    this.skipWhitespace();
    const result: CanonicalValue[] = [];
    if (this.peek() === "]") {
      this.offset += 1;
      return result;
    }
    while (true) {
      result.push(this.parseValue());
      this.skipWhitespace();
      if (this.peek() === "]") {
        this.offset += 1;
        return result;
      }
      if (this.peek() !== ",") this.fail("expected ',' or ']' in array");
      this.offset += 1;
      this.skipWhitespace();
    }
  }

  private parseObject(): Record<string, CanonicalValue> {
    this.offset += 1;
    this.skipWhitespace();
    const result = Object.create(null) as Record<string, CanonicalValue>;
    const keys = new Set<string>();
    if (this.peek() === "}") {
      this.offset += 1;
      return result;
    }
    while (true) {
      if (this.peek() !== '"') this.fail("object key must be a string");
      const key = this.parseString();
      if (keys.has(key)) this.fail(`duplicate object key ${JSON.stringify(key)}`);
      keys.add(key);
      this.skipWhitespace();
      if (this.peek() !== ":") this.fail("expected ':' after object key");
      this.offset += 1;
      this.skipWhitespace();
      result[key] = this.parseValue();
      this.skipWhitespace();
      if (this.peek() === "}") {
        this.offset += 1;
        return result;
      }
      if (this.peek() !== ",") this.fail("expected ',' or '}' in object");
      this.offset += 1;
      this.skipWhitespace();
    }
  }
}

export function parseCanonicalJson(raw: string): CanonicalValue {
  const parsed = new StrictJsonParser(raw).parse();
  canonicalize(parsed);
  return parsed;
}
