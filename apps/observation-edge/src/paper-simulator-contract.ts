import {
  isStrictJsonNumber,
  type StrictJsonValue,
} from "./strict-json";
import type {
  CanonicalObject,
  PaperTradeIntentCommand,
  PaperTradeSettlementCommand,
  PaperTradeSide,
} from "./types";
import { validatePaperAccountId } from "./paper-ledger-contract";

const MAX_SAFE_INTEGER = 9_007_199_254_740_991;
const INTENT_ID = /^[A-Za-z0-9_.:-]+$/;
const SYMBOL = /^[A-Z0-9._:-]+$/;
const DECIMAL_PRICE = /^(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,8})?$/;

type StrictObject = { [key: string]: StrictJsonValue };

export class PaperSimulatorContractError extends Error {
  constructor() {
    super("invalid paper simulator contract");
    this.name = "PaperSimulatorContractError";
  }
}

function fail(): never {
  throw new PaperSimulatorContractError();
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

function text(value: StrictJsonValue, minimum: number, maximum: number): string {
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

function price(value: StrictJsonValue): string {
  const result = text(value, 1, 21);
  if (!DECIMAL_PRICE.test(result) || decimalToScaled(result).value <= 0n) {
    return fail();
  }
  return result;
}

function decimalToScaled(value: string): { value: bigint; scale: number } {
  const [whole = "", fractional = ""] = value.split(".");
  return {
    value: BigInt(`${whole}${fractional}`),
    scale: fractional.length,
  };
}

function compareDecimals(left: string, right: string): number {
  const parsedLeft = decimalToScaled(left);
  const parsedRight = decimalToScaled(right);
  const scale = Math.max(parsedLeft.scale, parsedRight.scale);
  const leftValue =
    parsedLeft.value * 10n ** BigInt(scale - parsedLeft.scale);
  const rightValue =
    parsedRight.value * 10n ** BigInt(scale - parsedRight.scale);
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
}

function intentId(value: StrictJsonValue): string {
  const result = text(value, 1, 128);
  if (
    result === "." ||
    result === ".." ||
    !INTENT_ID.test(result)
  ) {
    return fail();
  }
  return result;
}

function symbol(value: StrictJsonValue): string {
  const result = text(value, 1, 32);
  if (!SYMBOL.test(result)) {
    return fail();
  }
  return result;
}

function side(value: StrictJsonValue): PaperTradeSide {
  if (value !== "BUY" && value !== "SELL") {
    return fail();
  }
  return value;
}

function accountIds(value: StrictJsonValue): readonly string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 50) {
    return fail();
  }
  const validated = value.map((item) => {
    if (typeof item !== "string") {
      return fail();
    }
    return validatePaperAccountId(item);
  });
  if (new Set(validated).size !== validated.length) {
    return fail();
  }
  return [...validated].sort((left, right) => left.localeCompare(right));
}

export function validatePaperTradeIntent(
  value: StrictJsonValue,
): PaperTradeIntentCommand {
  const object = asObject(value);
  exactKeys(object, [
    "schema_version",
    "intent_id",
    "symbol",
    "side",
    "entry_price",
    "stop_loss",
    "take_profit",
    "risk_bps",
    "account_ids",
  ]);
  if (field(object, "schema_version") !== "1.0") {
    fail();
  }
  const parsedSide = side(field(object, "side"));
  const entryPrice = price(field(object, "entry_price"));
  const stopLoss = price(field(object, "stop_loss"));
  const takeProfit = price(field(object, "take_profit"));
  const stopVsEntry = compareDecimals(stopLoss, entryPrice);
  const targetVsEntry = compareDecimals(takeProfit, entryPrice);
  if (
    (parsedSide === "BUY" && !(stopVsEntry < 0 && targetVsEntry > 0)) ||
    (parsedSide === "SELL" && !(stopVsEntry > 0 && targetVsEntry < 0))
  ) {
    fail();
  }
  return {
    schema_version: "1.0",
    intent_id: intentId(field(object, "intent_id")),
    symbol: symbol(field(object, "symbol")),
    side: parsedSide,
    entry_price: entryPrice,
    stop_loss: stopLoss,
    take_profit: takeProfit,
    risk_bps: integer(field(object, "risk_bps"), 1, 500),
    account_ids: accountIds(field(object, "account_ids")),
  };
}

export function validatePaperTradeSettlement(
  value: StrictJsonValue,
): PaperTradeSettlementCommand {
  const object = asObject(value);
  exactKeys(object, [
    "schema_version",
    "outcome_r_millis",
    "exit_reason",
  ]);
  if (field(object, "schema_version") !== "1.0") {
    fail();
  }
  const exitReason = field(object, "exit_reason");
  if (
    exitReason !== "STOP" &&
    exitReason !== "TARGET" &&
    exitReason !== "MANUAL"
  ) {
    fail();
  }
  const outcomeRMillis = integer(
    field(object, "outcome_r_millis"),
    -1_000,
    10_000,
  );
  if (
    (exitReason === "STOP" && outcomeRMillis > 0) ||
    (exitReason === "TARGET" && outcomeRMillis < 0)
  ) {
    fail();
  }
  return {
    schema_version: "1.0",
    outcome_r_millis: outcomeRMillis,
    exit_reason: exitReason,
  };
}

export function tradeIntentCanonicalCommand(
  command: PaperTradeIntentCommand,
): CanonicalObject {
  return {
    ...command,
    account_ids: [...command.account_ids],
  };
}

export function tradeSettlementCanonicalCommand(
  intentIdValue: string,
  command: PaperTradeSettlementCommand,
): CanonicalObject {
  return {
    intent_id: intentIdValue,
    ...command,
  };
}

export function validatePaperIntentId(value: string): string {
  if (
    value.length < 1 ||
    value.length > 128 ||
    value === "." ||
    value === ".." ||
    !INTENT_ID.test(value)
  ) {
    return fail();
  }
  return value;
}

export function pnlRemainsSafe(
  riskAmountMinor: number,
  outcomeRMillis: number,
): boolean {
  const pnl =
    (BigInt(riskAmountMinor) * BigInt(outcomeRMillis)) / 1_000n;
  const maximum = BigInt(MAX_SAFE_INTEGER);
  return pnl >= -maximum && pnl <= maximum;
}
