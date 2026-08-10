import { canonicalStringify, sha256Hex } from "./canonical";

const SHA256 = /^[a-f0-9]{64}$/u;
const IDENTIFIER = /^[\x21-\x5b\x5d-\x7e]{1,160}$/u;
const TICK_SIZE = /^(?:0\.[0-9]{0,11}[1-9]|[1-9][0-9]*(?:\.[0-9]{0,11}[1-9])?)$/u;
const CAPABILITY_KEYS = [
  "schema_version", "capability_sha256", "account_profile_sha256", "source_symbol",
  "broker_symbol", "source_tick_size", "broker_tick_size", "buffer_policy_version",
  "source_buffer_ticks", "broker_buffer_ticks", "divergence_tolerance_source_ticks",
] as const;

export const INERT_GEOMETRY_POLICY = Object.freeze({
  EURUSD: { buffer: 2, tolerance: 3 },
  GBPJPY: { buffer: 3, tolerance: 5 },
  USDJPY: { buffer: 2, tolerance: 5 },
  XAUUSD: { buffer: 5, tolerance: 10 },
  NAS100: { buffer: 10, tolerance: 20 },
});

export interface BrokerSymbolCapabilityV1 {
  readonly schema_version: "BrokerSymbolCapabilityV1";
  readonly capability_sha256: string;
  readonly account_profile_sha256: string;
  readonly source_symbol: keyof typeof INERT_GEOMETRY_POLICY;
  readonly broker_symbol: string;
  readonly source_tick_size: string;
  readonly broker_tick_size: string;
  readonly buffer_policy_version: "rd-entry-wick-buffer-v1";
  readonly source_buffer_ticks: number;
  readonly broker_buffer_ticks: number;
  readonly divergence_tolerance_source_ticks: number;
}

function invalid(): never {
  throw new Error("BROKER_SYMBOL_CAPABILITY_INVALID");
}

function objectValue(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) invalid();
}

function digest(value: unknown): string {
  if (typeof value !== "string" || !SHA256.test(value) || value === "0".repeat(64)) invalid();
  return value;
}

function identifier(value: unknown): string {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) invalid();
  return value;
}

function positiveSafeInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) invalid();
  return value;
}

function tickSizePriceUnits(value: unknown): bigint {
  if (typeof value !== "string" || value.length > 32 || !TICK_SIZE.test(value)) invalid();
  const [whole, fraction = ""] = value.split(".");
  const units = BigInt(whole!) * 1_000_000_000_000n + BigInt(fraction.padEnd(12, "0"));
  if (units <= 0n) invalid();
  return units;
}

function ceilDiv(left: bigint, right: bigint): bigint {
  if (left <= 0n || right <= 0n) invalid();
  return (left + right - 1n) / right;
}

export async function validateBrokerSymbolCapabilityV1(
  value: unknown,
): Promise<BrokerSymbolCapabilityV1> {
  try {
    const input = objectValue(value);
    exactKeys(input, CAPABILITY_KEYS);
    if (input.schema_version !== "BrokerSymbolCapabilityV1") invalid();
    if (input.buffer_policy_version !== "rd-entry-wick-buffer-v1") invalid();
    const sourceSymbol = input.source_symbol;
    if (typeof sourceSymbol !== "string" || !(sourceSymbol in INERT_GEOMETRY_POLICY)) invalid();
    const capabilitySha256 = digest(input.capability_sha256);
    const accountProfileSha256 = digest(input.account_profile_sha256);
    const brokerSymbol = identifier(input.broker_symbol);
    const sourceTickSize = input.source_tick_size;
    const brokerTickSize = input.broker_tick_size;
    const sourceTickUnits = tickSizePriceUnits(sourceTickSize);
    const brokerTickUnits = tickSizePriceUnits(brokerTickSize);
    const sourceBufferTicks = positiveSafeInteger(input.source_buffer_ticks);
    const brokerBufferTicks = positiveSafeInteger(input.broker_buffer_ticks);
    const tolerance = positiveSafeInteger(input.divergence_tolerance_source_ticks);
    const policy = INERT_GEOMETRY_POLICY[sourceSymbol as keyof typeof INERT_GEOMETRY_POLICY];
    const expectedBrokerBuffer = ceilDiv(BigInt(sourceBufferTicks) * sourceTickUnits, brokerTickUnits);
    if (
      sourceBufferTicks !== policy.buffer || tolerance !== policy.tolerance ||
      expectedBrokerBuffer > BigInt(Number.MAX_SAFE_INTEGER) ||
      brokerBufferTicks !== Number(expectedBrokerBuffer)
    ) invalid();
    const { capability_sha256: _digest, ...body } = input;
    if (await sha256Hex(canonicalStringify(body)) !== capabilitySha256) invalid();
    return Object.freeze({
      schema_version: "BrokerSymbolCapabilityV1",
      capability_sha256: capabilitySha256,
      account_profile_sha256: accountProfileSha256,
      source_symbol: sourceSymbol as keyof typeof INERT_GEOMETRY_POLICY,
      broker_symbol: brokerSymbol,
      source_tick_size: sourceTickSize as string,
      broker_tick_size: brokerTickSize as string,
      buffer_policy_version: "rd-entry-wick-buffer-v1",
      source_buffer_ticks: sourceBufferTicks,
      broker_buffer_ticks: brokerBufferTicks,
      divergence_tolerance_source_ticks: tolerance,
    });
  } catch {
    return invalid();
  }
}
