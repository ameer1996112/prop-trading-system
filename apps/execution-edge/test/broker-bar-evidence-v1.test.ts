import { describe, expect, it } from "vitest";

import { validateBrokerBarEvidenceV1 } from "../src/contracts-v1";
import {
  brokerBarEvidenceFixture,
  brokerCapabilityFixture,
} from "./support/broker-reconstruction-fixture";

const M5 = 300;

function threeM5Bars(): Record<string, unknown>[] {
  return [
    { open_epoch: 1_786_391_100, close_epoch: 1_786_391_400, open_ticks: 1080, high_ticks: 1090, low_ticks: 1060, close_ticks: 1080, closed: true },
    { open_epoch: 1_786_391_400, close_epoch: 1_786_391_700, open_ticks: 1040, high_ticks: 1110, low_ticks: 1000, close_ticks: 1100, closed: true },
    { open_epoch: 1_786_391_700, close_epoch: 1_786_392_000, open_ticks: 1040, high_ticks: 1110, low_ticks: 1000, close_ticks: 1100, closed: true },
  ];
}

async function validEvidence(): Promise<{ readonly evidence: Record<string, unknown>; readonly capabilitySha256: string }> {
  const capability = await brokerCapabilityFixture();
  return {
    evidence: brokerBarEvidenceFixture(threeM5Bars(), capability),
    capabilitySha256: capability.capability_sha256 as string,
  };
}

async function expectInvalid(value: unknown, expectedCapabilitySha256?: string): Promise<void> {
  const { capabilitySha256 } = await validEvidence();
  expect(() => validateBrokerBarEvidenceV1(value, expectedCapabilitySha256 ?? capabilitySha256))
    .toThrow("BROKER_BAR_EVIDENCE_INVALID");
}

describe("BrokerBarEvidenceV1", () => {
  it("accepts and deeply freezes a valid contiguous three-bar M5 batch", async () => {
    const { evidence, capabilitySha256 } = await validEvidence();

    const actual = validateBrokerBarEvidenceV1(evidence, capabilitySha256);

    expect(actual).toEqual(evidence);
    expect(Object.isFrozen(actual)).toBe(true);
    expect(Object.isFrozen(actual.bars)).toBe(true);
    expect(Object.isFrozen(actual.bars[0])).toBe(true);
    expect(Reflect.set(actual.bars[0]!, "close_ticks", 1)).toBe(false);
    expect(actual.bars[0]!.close_ticks).toBe(1080);
  });

  it.each([
    ["unknown top-level field", (evidence: Record<string, unknown>) => ({ ...evidence, unexpected: true })],
    ["unknown bar field", (evidence: Record<string, unknown>) => ({
      ...evidence,
      bars: [{ ...evidence.bars as Record<string, unknown>[][0], unexpected: true }, ...(evidence.bars as Record<string, unknown>[]).slice(1)],
    })],
    ["wrong schema version", (evidence: Record<string, unknown>) => ({ ...evidence, schema_version: "OtherV1" })],
    ["invalid account profile digest", (evidence: Record<string, unknown>) => ({ ...evidence, account_profile_sha256: "G".repeat(64) })],
    ["empty bars", (evidence: Record<string, unknown>) => ({ ...evidence, bars: [] })],
    ["unclosed bar", (evidence: Record<string, unknown>) => ({ ...evidence, bars: [{ ...(evidence.bars as Record<string, unknown>[])[0]!, closed: false }, ...(evidence.bars as Record<string, unknown>[]).slice(1)] })],
    ["invalid OHLC ordering", (evidence: Record<string, unknown>) => ({ ...evidence, bars: [{ ...(evidence.bars as Record<string, unknown>[])[0]!, low_ticks: 1091 }, ...(evidence.bars as Record<string, unknown>[]).slice(1)] })],
    ["overlapping bars", (evidence: Record<string, unknown>) => ({ ...evidence, bars: [{ ...(evidence.bars as Record<string, unknown>[])[0]! }, { ...(evidence.bars as Record<string, unknown>[])[1]!, open_epoch: 1_786_391_300 }, ...(evidence.bars as Record<string, unknown>[]).slice(2)] })],
    ["duplicated bars", (evidence: Record<string, unknown>) => ({ ...evidence, bars: [(evidence.bars as Record<string, unknown>[])[0]!, (evidence.bars as Record<string, unknown>[])[0]!, ...(evidence.bars as Record<string, unknown>[]).slice(2)] })],
    ["descending bars", (evidence: Record<string, unknown>) => ({ ...evidence, bars: [...(evidence.bars as Record<string, unknown>[])].reverse() })],
    ["internal gap", (evidence: Record<string, unknown>) => ({ ...evidence, bars: [(evidence.bars as Record<string, unknown>[])[0]!, (evidence.bars as Record<string, unknown>[])[2]!] })],
    ["observed before final close", (evidence: Record<string, unknown>) => ({ ...evidence, observed_at_epoch: 1_786_391_999 })],
    ["observation lag over 30 seconds", (evidence: Record<string, unknown>) => ({ ...evidence, observed_at_epoch: 1_786_392_031 })],
    ["unsafe epoch", (evidence: Record<string, unknown>) => ({ ...evidence, observed_at_epoch: Number.MAX_SAFE_INTEGER + 1 })],
    ["unsafe ticks", (evidence: Record<string, unknown>) => ({ ...evidence, bars: [{ ...(evidence.bars as Record<string, unknown>[])[0]!, open_ticks: Number.MAX_SAFE_INTEGER + 1 }, ...(evidence.bars as Record<string, unknown>[]).slice(1)] })],
    ["zero account profile digest", (evidence: Record<string, unknown>) => ({ ...evidence, account_profile_sha256: "0".repeat(64) })],
    ["zero capability digest", (evidence: Record<string, unknown>) => ({ ...evidence, symbol_capability_sha256: "0".repeat(64) })],
    ["zero reconciliation digest", (evidence: Record<string, unknown>) => ({ ...evidence, reconciliation_sha256: "0".repeat(64) })],
  ])("rejects %s", async (_caseName, mutate) => {
    const { evidence } = await validEvidence();
    await expectInvalid(mutate(evidence));
  });

  it("rejects a capability digest that differs from the expected digest", async () => {
    const { evidence } = await validEvidence();
    await expectInvalid(evidence, "f".repeat(64));
  });

  it.each([
    ["M5 duration", "M5", 60],
    ["M1 duration", "M1", M5],
  ])("rejects a %s mismatch", async (_caseName, timeframe, duration) => {
    const { evidence } = await validEvidence();
    const bars = threeM5Bars().map((bar, index) => ({
      ...bar,
      open_epoch: 1_786_391_100 + index * duration,
      close_epoch: 1_786_391_100 + (index + 1) * duration,
    }));
    await expectInvalid({
      ...evidence,
      timeframe,
      bars,
      observed_at_epoch: bars.at(-1)!.close_epoch + 1,
    });
  });

  it.each([
    ["M5", 1_786_391_101, 1_786_391_401],
    ["M1", 1_786_391_120, 1_786_391_180],
  ])("rejects off-grid %s epochs", async (timeframe, openEpoch, closeEpoch) => {
    const { evidence } = await validEvidence();
    await expectInvalid({
      ...evidence,
      timeframe,
      bars: [{ ...threeM5Bars()[0]!, open_epoch: openEpoch, close_epoch: closeEpoch }],
      observed_at_epoch: closeEpoch,
    });
  });

  it("rejects 513 bars", async () => {
    const { evidence } = await validEvidence();
    const bars = Array.from({ length: 513 }, (_, index) => ({
      open_epoch: 1_786_238_100 + index * M5,
      close_epoch: 1_786_238_400 + index * M5,
      open_ticks: 100,
      high_ticks: 110,
      low_ticks: 90,
      close_ticks: 105,
      closed: true,
    }));
    await expectInvalid({ ...evidence, bars, observed_at_epoch: bars.at(-1)!.close_epoch });
  });
});
