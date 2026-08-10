const PRICE_SCALE = 1_000_000_000_000n;
const TICK_SIZE = /^(?:0\.[0-9]{0,11}[1-9]|[1-9][0-9]*(?:\.[0-9]{0,11}[1-9])?)$/u;

function invalid(): never {
  throw new Error("EXACT_PRICE_INVALID");
}

function positiveSafeWireTicks(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) invalid();
}

function positivePriceUnits(value: bigint): void {
  if (value <= 0n) invalid();
}

export function parseTickSizeToPriceUnits(value: string): bigint {
  if (!TICK_SIZE.test(value)) invalid();
  const [whole, fraction = ""] = value.split(".");
  const units = BigInt(whole!) * PRICE_SCALE + BigInt(fraction.padEnd(12, "0"));
  positivePriceUnits(units);
  return units;
}

export function ticksToPriceUnits(ticks: number, tickSizeUnits: bigint): bigint {
  positiveSafeWireTicks(ticks);
  positivePriceUnits(tickSizeUnits);
  return BigInt(ticks) * tickSizeUnits;
}

export function ceilPriceUnitsToTicks(distanceUnits: bigint, tickSizeUnits: bigint): bigint {
  positivePriceUnits(distanceUnits);
  positivePriceUnits(tickSizeUnits);
  return (distanceUnits + tickSizeUnits - 1n) / tickSizeUnits;
}

export function safeBrokerTicks(value: bigint): number {
  if (value < BigInt(Number.MIN_SAFE_INTEGER) || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("EXACT_PRICE_OUT_OF_RANGE");
  }
  return Number(value);
}
