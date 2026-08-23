export type CanonicalValue =
  | null
  | boolean
  | number
  | string
  | readonly CanonicalValue[]
  | Readonly<{ [key: string]: CanonicalValue }>;

const INVALID = "CANONICAL_JSON_INVALID";

function invalid(): never {
  throw new Error(INVALID);
}

function compareCodePoints(left: string, right: string): number {
  const leftPoints = Array.from(left, (character) => character.codePointAt(0) ?? invalid());
  const rightPoints = Array.from(right, (character) => character.codePointAt(0) ?? invalid());
  const length = Math.min(leftPoints.length, rightPoints.length);

  for (let index = 0; index < length; index += 1) {
    const leftPoint = leftPoints[index];
    const rightPoint = rightPoints[index];
    if (leftPoint === undefined || rightPoint === undefined) {
      return invalid();
    }
    if (leftPoint !== rightPoint) {
      return leftPoint < rightPoint ? -1 : 1;
    }
  }

  return leftPoints.length - rightPoints.length;
}

function serialize(value: unknown, ancestors: Set<object>): string {
  if (value === null) {
    return "null";
  }

  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "boolean":
      return value ? "true" : "false";
    case "number": {
      if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) {
        return invalid();
      }
      return JSON.stringify(value);
    }
    case "object":
      break;
    default:
      return invalid();
  }

  if (ancestors.has(value)) {
    return invalid();
  }
  ancestors.add(value);

  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) {
        return invalid();
      }

      const ownKeys = Reflect.ownKeys(value);
      const expectedIndexes = new Set<string>();
      for (let index = 0; index < value.length; index += 1) {
        const key = String(index);
        expectedIndexes.add(key);
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
          return invalid();
        }
      }
      const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
      if (
        lengthDescriptor === undefined ||
        lengthDescriptor.enumerable ||
        !("value" in lengthDescriptor) ||
        lengthDescriptor.value !== value.length
      ) {
        return invalid();
      }
      for (const key of ownKeys) {
        if (typeof key !== "string" || (key !== "length" && !expectedIndexes.has(key))) {
          return invalid();
        }
      }

      const items: string[] = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (descriptor === undefined || !("value" in descriptor)) {
          return invalid();
        }
        items.push(serialize(descriptor.value, ancestors));
      }
      return `[${items.join(",")}]`;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return invalid();
    }
    const properties: Array<readonly [string, unknown]> = [];
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") {
        return invalid();
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
        return invalid();
      }
      properties.push([key, descriptor.value]);
    }

    properties.sort(([left], [right]) => compareCodePoints(left, right));
    return `{${properties
      .map(([key, entry]) => `${JSON.stringify(key)}:${serialize(entry, ancestors)}`)
      .join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}

export function canonicalStringify(value: CanonicalValue): string;
export function canonicalStringify(value: unknown): string;
export function canonicalStringify(value: unknown): string {
  return serialize(value, new Set<object>());
}

export async function sha256Hex(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
