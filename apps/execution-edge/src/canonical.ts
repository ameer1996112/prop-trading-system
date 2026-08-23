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
      if (Object.getOwnPropertySymbols(value).length > 0) {
        return invalid();
      }

      const keys = Object.keys(value);
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(value, String(index))) {
          return invalid();
        }
      }
      if (keys.length !== value.length) {
        return invalid();
      }

      return `[${value.map((entry) => serialize(entry, ancestors)).join(",")}]`;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return invalid();
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      return invalid();
    }

    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort(compareCodePoints);
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${serialize(record[key], ancestors)}`)
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
