import { describe, expect, it } from "vitest";

import { validateBrokerSymbolCapabilityV1 } from "../src/broker-symbol-capability-v1";
import {
  ceilPriceUnitsToTicks,
  parseTickSizeToPriceUnits,
  safeBrokerTicks,
  ticksToPriceUnits,
} from "../src/exact-price-v1";
import { brokerCapabilityFixture } from "./support/broker-reconstruction-fixture";

describe("exact price v1", () => {
  it("parses canonical decimal tick sizes into common price units", () => {
    expect(parseTickSizeToPriceUnits("0.00001")).toBe(10_000_000n);
    expect(parseTickSizeToPriceUnits("0.1")).toBe(100_000_000_000n);
    expect(parseTickSizeToPriceUnits("1")).toBe(1_000_000_000_000n);
  });

  it("rejects noncanonical and unrepresentable decimal tick sizes", () => {
    for (const value of ["0", "-1", "01", ".1", "1.0", "1e-5", "0.0000000000001"]) {
      expect(() => parseTickSizeToPriceUnits(value)).toThrow("EXACT_PRICE_INVALID");
    }
  });

  it("multiplies safe wire ticks with exact bigint arithmetic", () => {
    expect(ticksToPriceUnits(1100, 10_000_000n)).toBe(11_000_000_000n);
  });

  it("rejects nonpositive inputs and unsafe wire ticks before multiplication", () => {
    for (const [ticks, tickSizeUnits] of [
      [0, 1n],
      [-1, 1n],
      [1, 0n],
      [1, -1n],
      [Number.MAX_SAFE_INTEGER + 1, 1n],
    ] as const) {
      expect(() => ticksToPriceUnits(ticks, tickSizeUnits)).toThrow("EXACT_PRICE_INVALID");
    }
  });

  it("ceil-converts positive exact price distances to broker ticks", () => {
    expect(ceilPriceUnitsToTicks(20_000_001n, 10_000_000n)).toBe(3n);
  });

  it("rejects nonpositive exact price distances and tick sizes", () => {
    for (const [distanceUnits, tickSizeUnits] of [[0n, 1n], [-1n, 1n], [1n, 0n], [1n, -1n]] as const) {
      expect(() => ceilPriceUnitsToTicks(distanceUnits, tickSizeUnits)).toThrow("EXACT_PRICE_INVALID");
    }
  });

  it("converts only positive bigint broker ticks that fit the safe wire domain", () => {
    for (const value of [0n, -1n, BigInt(Number.MIN_SAFE_INTEGER) - 1n]) {
      expect(() => safeBrokerTicks(value)).toThrow("EXACT_PRICE_INVALID");
    }
    expect(safeBrokerTicks(BigInt(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER);
    expect(() => safeBrokerTicks(BigInt(Number.MAX_SAFE_INTEGER) + 1n)).toThrow(
      "EXACT_PRICE_OUT_OF_RANGE",
    );
  });

  it("uses the exact ceiling for broker buffer capability validation", async () => {
    const insufficient = await brokerCapabilityFixture({
      source_tick_size: "0.000015",
      broker_tick_size: "0.00002",
      broker_buffer_ticks: 1,
    });
    await expect(validateBrokerSymbolCapabilityV1(insufficient)).rejects.toThrow(
      "BROKER_SYMBOL_CAPABILITY_INVALID",
    );

    const sufficient = await brokerCapabilityFixture({
      source_tick_size: "0.000015",
      broker_tick_size: "0.00002",
      broker_buffer_ticks: 2,
    });
    await expect(validateBrokerSymbolCapabilityV1(sufficient)).resolves.toMatchObject({
      broker_buffer_ticks: 2,
    });
  });
});
