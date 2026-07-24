import {
  isStrictJsonNumber,
  type StrictJsonValue,
} from "./strict-json";
import type {
  CanonicalObject,
  PaperAccountCreateCommand,
  PaperLedgerAppendCommand,
} from "./types";

const MAX_SAFE_INTEGER = 9_007_199_254_740_991;
const ACCOUNT_ID = /^[A-Za-z0-9_.:-]+$/;
const CURRENCY_CODE = /^[A-Z]{3}$/;
const PRINTABLE_LABEL = /^[\x20-\x5b\x5d-\x7e]+$/;

type StrictObject = { [key: string]: StrictJsonValue };

export class PaperContractError extends Error {
  constructor() {
    super("invalid paper ledger contract");
    this.name = "PaperContractError";
  }
}

function fail(): never {
  throw new PaperContractError();
}

function asObject(value: StrictJsonValue): StrictObject {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    isStrictJsonNumber(value)
  ) {
    return fail();
  }
  return value;
}

function exactKeys(object: StrictObject, keys: readonly string[]): void {
  const actual = Object.keys(object);
  if (
    actual.length !== keys.length ||
    actual.some((key) => !keys.includes(key)) ||
    keys.some((key) => !Object.prototype.hasOwnProperty.call(object, key))
  ) {
    fail();
  }
}

function field(object: StrictObject, key: string): StrictJsonValue {
  const value = object[key];
  if (value === undefined) {
    return fail();
  }
  return value;
}

function text(
  value: StrictJsonValue,
  minimum: number,
  maximum: number,
): string {
  if (
    typeof value !== "string" ||
    value.length < minimum ||
    value.length > maximum
  ) {
    return fail();
  }
  return value;
}

function integer(
  value: StrictJsonValue,
  minimum: number,
  maximum: number,
): number {
  if (
    !isStrictJsonNumber(value) ||
    !value.isIntegerToken ||
    !Number.isSafeInteger(value.value) ||
    value.value < minimum ||
    value.value > maximum
  ) {
    return fail();
  }
  return value.value;
}

function accountIdIsValid(value: string): boolean {
  return (
    value !== "." &&
    value !== ".." &&
    value.length >= 1 &&
    value.length <= 128 &&
    ACCOUNT_ID.test(value)
  );
}

export function validatePaperAccountCreate(
  value: StrictJsonValue,
): PaperAccountCreateCommand {
  const object = asObject(value);
  exactKeys(object, [
    "schema_version",
    "account_id",
    "label",
    "currency_code",
    "currency_scale",
    "opening_balance_minor",
  ]);
  if (field(object, "schema_version") !== "1.0") {
    fail();
  }
  const accountId = text(field(object, "account_id"), 1, 128);
  const label = text(field(object, "label"), 1, 80);
  const currencyCode = text(field(object, "currency_code"), 3, 3);
  if (
    !accountIdIsValid(accountId) ||
    !PRINTABLE_LABEL.test(label) ||
    label.trim() !== label ||
    !CURRENCY_CODE.test(currencyCode)
  ) {
    fail();
  }
  return {
    schema_version: "1.0",
    account_id: accountId,
    label,
    currency_code: currencyCode,
    currency_scale: integer(field(object, "currency_scale"), 0, 8),
    opening_balance_minor: integer(
      field(object, "opening_balance_minor"),
      0,
      MAX_SAFE_INTEGER,
    ),
  };
}

export function validatePaperLedgerAppend(
  value: StrictJsonValue,
): PaperLedgerAppendCommand {
  const object = asObject(value);
  exactKeys(object, [
    "schema_version",
    "sequence",
    "entry_kind",
    "amount_minor",
  ]);
  if (
    field(object, "schema_version") !== "1.0" ||
    field(object, "entry_kind") !== "MANUAL_ADJUSTMENT"
  ) {
    fail();
  }
  const amountMinor = integer(
    field(object, "amount_minor"),
    -MAX_SAFE_INTEGER,
    MAX_SAFE_INTEGER,
  );
  if (amountMinor === 0) {
    fail();
  }
  return {
    schema_version: "1.0",
    sequence: integer(field(object, "sequence"), 1, MAX_SAFE_INTEGER),
    entry_kind: "MANUAL_ADJUSTMENT",
    amount_minor: amountMinor,
  };
}

export function accountCanonicalCommand(
  command: PaperAccountCreateCommand,
): CanonicalObject {
  return { ...command };
}

export function ledgerCanonicalCommand(
  accountId: string,
  command: PaperLedgerAppendCommand,
): CanonicalObject {
  return {
    account_id: accountId,
    ...command,
  };
}

export function validatePaperAccountId(value: string): string {
  if (!accountIdIsValid(value)) {
    return fail();
  }
  return value;
}
