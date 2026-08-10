import { describe, expect, it } from "vitest";

import { canonicalStringify, sha256Hex } from "../src/canonical";
import { reconstructBrokerGeometryV1 } from "../src/broker-geometry-reconstruction-v1";
import {
  brokerBarEvidenceFixture,
  brokerCapabilityFixture,
  v2LongCandidateFixture,
  v2LongCandidateForSymbolFixture,
  v2ShortCandidateFixture,
  v2ShortGeometryCandidateFixture,
} from "./support/broker-reconstruction-fixture";

describe("broker geometry reconstruction v1", () => {
  function longBars() {
    return [
      { open_epoch: 1_786_391_100, close_epoch: 1_786_391_400, open_ticks: 1080, high_ticks: 1090, low_ticks: 1060, close_ticks: 1080, closed: true },
      { open_epoch: 1_786_391_400, close_epoch: 1_786_391_700, open_ticks: 1040, high_ticks: 1110, low_ticks: 1000, close_ticks: 1100, closed: true },
      { open_epoch: 1_786_391_700, close_epoch: 1_786_392_000, open_ticks: 1040, high_ticks: 1110, low_ticks: 1000, close_ticks: 1100, closed: true },
    ];
  }

  function expectNullBlockedFields(result: Awaited<ReturnType<typeof reconstructBrokerGeometryV1>>) {
    expect(result).toMatchObject({
      matched_engagement_open_epoch: null,
      matched_source_bar_close_epoch: null,
      broker_entry_ticks: null,
      broker_wick_ticks: null,
      broker_stop_ticks: null,
      broker_risk_distance_ticks: null,
      broker_target_ticks: null,
      maximum_divergence_price_units: null,
      authority: "PAPER_ONLY",
      real_execution_allowed: false,
      command: null,
    });
  }

  it.each([
    ["starts after zone activation", longBars().slice(1), "BROKER_EVIDENCE_MISSING"],
    ["ends before directional source close", longBars().slice(0, 2), "BROKER_EVIDENCE_MISSING"],
    ["has an internal missing M5 interval", [longBars()[0]!, longBars()[2]!], "BROKER_EVIDENCE_GAP"],
  ])("returns DATA_GAP when evidence %s", async (_caseName, bars, reasonCode) => {
    const candidate = await v2LongCandidateFixture();
    const capability = await brokerCapabilityFixture();
    const evidence = brokerBarEvidenceFixture(bars, capability);

    const result = await reconstructBrokerGeometryV1(candidate, evidence, capability);

    expect(result).toMatchObject({ outcome: "DATA_GAP", reason_code: reasonCode });
    expectNullBlockedFields(result);
  });

  it("blocks identity, capability, timeframe, and profile disagreement without geometry", async () => {
    const candidate = await v2LongCandidateFixture();
    const capability = await brokerCapabilityFixture();
    const sourceMismatchCandidate = await v2LongCandidateForSymbolFixture("GBPJPY", "0.001", 3);
    const cases = [
      ["source symbol", sourceMismatchCandidate, brokerBarEvidenceFixture(longBars(), capability), capability],
      ["broker symbol", candidate, { ...brokerBarEvidenceFixture(longBars(), capability), broker_symbol: "OTHER_EURUSD" }, capability],
      ["account profile", candidate, { ...brokerBarEvidenceFixture(longBars(), capability), account_profile_sha256: "5".repeat(64) }, capability],
      ["capability digest", candidate, { ...brokerBarEvidenceFixture(longBars(), capability), symbol_capability_sha256: "6".repeat(64) }, capability],
      ["timeframe", candidate, { ...brokerBarEvidenceFixture(longBars(), capability), timeframe: "M1", bars: longBars().flatMap((bar) => [
        { ...bar, close_epoch: bar.open_epoch + 60 },
        { ...bar, open_epoch: bar.open_epoch + 60, close_epoch: bar.open_epoch + 120 },
        { ...bar, open_epoch: bar.open_epoch + 120, close_epoch: bar.open_epoch + 180 },
        { ...bar, open_epoch: bar.open_epoch + 180, close_epoch: bar.open_epoch + 240 },
        { ...bar, open_epoch: bar.open_epoch + 240, close_epoch: bar.close_epoch },
      ]) }, capability],
    ] as const;

    for (const [_caseName, caseCandidate, evidence, caseCapability] of cases) {
      const result = await reconstructBrokerGeometryV1(caseCandidate, evidence, caseCapability);
      expect(result).toMatchObject({ outcome: "BLOCKED", reason_code: "BROKER_CAPABILITY_MISMATCH" });
      expectNullBlockedFields(result);
    }
  });

  it("blocks a first touch mismatch and a directional-close mismatch as geometry", async () => {
    const candidate = await v2LongCandidateFixture();
    const capability = await brokerCapabilityFixture();
    const earlyTouch = longBars();
    earlyTouch[0] = { ...earlyTouch[0]!, low_ticks: 1050 };
    const wrongDirection = longBars();
    wrongDirection[2] = { ...wrongDirection[2]!, open_ticks: 1100, close_ticks: 1040 };

    for (const bars of [earlyTouch, wrongDirection]) {
      const result = await reconstructBrokerGeometryV1(candidate, brokerBarEvidenceFixture(bars, capability), capability);
      expect(result).toMatchObject({ outcome: "BLOCKED", reason_code: "GEOMETRY_MISMATCH" });
      expectNullBlockedFields(result);
    }
  });

  it("rejects invalid structural input with the stable reconstruction input error", async () => {
    const candidate = await v2LongCandidateFixture();
    const capability = await brokerCapabilityFixture();
    await expect(reconstructBrokerGeometryV1(
      { ...candidate, unexpected: true },
      brokerBarEvidenceFixture(longBars(), capability),
      capability,
    )).rejects.toThrow("BROKER_RECONSTRUCTION_INPUT_INVALID");
  });

  it("accepts a corresponding OHLC divergence of exactly three EURUSD ticks", async () => {
    const candidate = await v2LongCandidateFixture();
    const capability = await brokerCapabilityFixture();
    const bars = longBars();
    bars[1] = { ...bars[1]!, high_ticks: 1113 };
    const result = await reconstructBrokerGeometryV1(candidate, brokerBarEvidenceFixture(bars, capability), capability);
    expect(result).toMatchObject({
      outcome: "MATCH",
      reason_code: "NONE",
      maximum_divergence_price_units: 30_000_000,
    });
  });

  it("blocks a corresponding OHLC divergence of four EURUSD ticks", async () => {
    const candidate = await v2LongCandidateFixture();
    const capability = await brokerCapabilityFixture();
    const bars = longBars();
    bars[1] = { ...bars[1]!, high_ticks: 1114 };
    const result = await reconstructBrokerGeometryV1(candidate, brokerBarEvidenceFixture(bars, capability), capability);
    expect(result).toMatchObject({ outcome: "BLOCKED", reason_code: "GEOMETRY_MISMATCH" });
    expectNullBlockedFields(result);
  });

  it("blocks a real-price broker risk distance that differs by four EURUSD ticks", async () => {
    const candidate = await v2LongCandidateFixture();
    const capability = await brokerCapabilityFixture();
    const bars = longBars();
    bars[1] = { ...bars[1]!, low_ticks: 996 };
    const result = await reconstructBrokerGeometryV1(candidate, brokerBarEvidenceFixture(bars, capability), capability);
    expect(result).toMatchObject({ outcome: "BLOCKED", reason_code: "GEOMETRY_MISMATCH" });
    expectNullBlockedFields(result);
  });

  it.each([
    ["EURUSD", "0.00001", 2, 3],
    ["GBPJPY", "0.001", 3, 5],
    ["USDJPY", "0.001", 2, 5],
    ["XAUUSD", "0.01", 5, 10],
    ["NAS100", "0.1", 10, 20],
  ] as const)("matches the inert %s policy", async (sourceSymbol, tickSize, buffer, tolerance) => {
    const candidate = await v2LongCandidateForSymbolFixture(sourceSymbol, tickSize, buffer);
    const capability = await brokerCapabilityFixture({
      source_symbol: sourceSymbol,
      broker_symbol: sourceSymbol === "NAS100" ? "USTEC" : sourceSymbol,
      source_tick_size: tickSize,
      broker_tick_size: tickSize,
      source_buffer_ticks: buffer,
      broker_buffer_ticks: buffer,
      divergence_tolerance_source_ticks: tolerance,
    });
    const result = await reconstructBrokerGeometryV1(candidate, brokerBarEvidenceFixture(longBars(), capability), capability);
    expect(result).toMatchObject({ outcome: "MATCH", reason_code: "NONE" });
  });

  it("reconstructs the first LONG zone touch with literal broker geometry", async () => {
    const candidate = await v2LongCandidateFixture();
    const capability = await brokerCapabilityFixture();
    const evidence = brokerBarEvidenceFixture([
      { open_epoch: 1_786_391_100, close_epoch: 1_786_391_400, open_ticks: 1080, high_ticks: 1090, low_ticks: 1060, close_ticks: 1080, closed: true },
      { open_epoch: 1_786_391_400, close_epoch: 1_786_391_700, open_ticks: 1040, high_ticks: 1110, low_ticks: 1000, close_ticks: 1100, closed: true },
      { open_epoch: 1_786_391_700, close_epoch: 1_786_392_000, open_ticks: 1040, high_ticks: 1110, low_ticks: 1000, close_ticks: 1100, closed: true },
    ], capability);

    const result = await reconstructBrokerGeometryV1(candidate, evidence, capability);

    expect(result).toMatchObject({
      outcome: "MATCH",
      reason_code: "NONE",
      matched_engagement_open_epoch: 1_786_391_400,
      matched_source_bar_close_epoch: 1_786_392_000,
      broker_entry_ticks: 1100,
      broker_wick_ticks: 1000,
      broker_stop_ticks: 998,
      broker_risk_distance_ticks: 102,
      broker_target_ticks: 1508,
      maximum_divergence_price_units: 0,
      authority: "PAPER_ONLY",
      real_execution_allowed: false,
      command: null,
    });
    expect(result.reconstruction_body_sha256).toBe("f4998d8b52e7d484cb9cac37e1739338bef6dc38a83342f72a937657c8f3f028");
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("reconstructs SHORT geometry only for a bearish close strictly below the zone", async () => {
    const candidate = await v2ShortGeometryCandidateFixture();
    const capability = await brokerCapabilityFixture();
    const evidence = brokerBarEvidenceFixture([
      { open_epoch: 1_786_391_100, close_epoch: 1_786_391_400, open_ticks: 1030, high_ticks: 1040, low_ticks: 1000, close_ticks: 1020, closed: true },
      { open_epoch: 1_786_391_400, close_epoch: 1_786_391_700, open_ticks: 1080, high_ticks: 1120, low_ticks: 1040, close_ticks: 1070, closed: true },
      { open_epoch: 1_786_391_700, close_epoch: 1_786_392_000, open_ticks: 1100, high_ticks: 1120, low_ticks: 990, close_ticks: 1000, closed: true },
    ], capability);

    const result = await reconstructBrokerGeometryV1(candidate, evidence, capability);

    expect(result).toMatchObject({
      outcome: "MATCH",
      reason_code: "NONE",
      broker_entry_ticks: 1000,
      broker_wick_ticks: 1120,
      broker_stop_ticks: 1122,
      broker_risk_distance_ticks: 122,
      broker_target_ticks: 512,
      authority: "PAPER_ONLY",
      real_execution_allowed: false,
      command: null,
    });
  });

  it("replays the canonical GBPJPY SHORT vector with a deterministic digest", async () => {
    const candidate = await v2ShortCandidateFixture();
    const capability = await brokerCapabilityFixture({
      source_symbol: "GBPJPY",
      broker_symbol: "GBPJPY",
      source_tick_size: "0.001",
      broker_tick_size: "0.001",
      source_buffer_ticks: 3,
      broker_buffer_ticks: 3,
      divergence_tolerance_source_ticks: 5,
    });
    const evidence = brokerBarEvidenceFixture([
      { open_epoch: 1_786_391_100, close_epoch: 1_786_391_400, open_ticks: 1930, high_ticks: 1940, low_ticks: 1900, close_ticks: 1920, closed: true },
      { open_epoch: 1_786_391_400, close_epoch: 1_786_391_700, open_ticks: 1970, high_ticks: 2000, low_ticks: 1880, close_ticks: 1900, closed: true },
      { open_epoch: 1_786_391_700, close_epoch: 1_786_392_000, open_ticks: 1970, high_ticks: 2000, low_ticks: 1880, close_ticks: 1900, closed: true },
    ], capability);

    const result = await reconstructBrokerGeometryV1(candidate, evidence, capability);

    expect(result).toMatchObject({
      outcome: "MATCH",
      reason_code: "NONE",
      broker_entry_ticks: 1900,
      broker_wick_ticks: 2000,
      broker_stop_ticks: 2003,
      broker_risk_distance_ticks: 103,
      broker_target_ticks: 1488,
      maximum_divergence_price_units: 0,
      reconstruction_body_sha256: "d426f4963bf495c78cc1ebc06c43e823114ea2e26321f0456440f7ae33002a6f",
      authority: "PAPER_ONLY",
      real_execution_allowed: false,
      command: null,
    });
  });

  it("Task 5 boundary executes the public reconstruction artifact", async () => {
    const candidate = await v2LongCandidateFixture();
    const capability = await brokerCapabilityFixture();
    const evidence = brokerBarEvidenceFixture(longBars(), capability);

    const first = await reconstructBrokerGeometryV1(
      structuredClone(candidate),
      structuredClone(evidence),
      structuredClone(capability),
    );
    const replay = await reconstructBrokerGeometryV1(
      structuredClone(candidate),
      structuredClone(evidence),
      structuredClone(capability),
    );
    const firstBytes = new TextEncoder().encode(canonicalStringify(first));
    const replayBytes = new TextEncoder().encode(canonicalStringify(replay));
    const { reconstruction_body_sha256: firstDigest, ...firstBody } = first;
    const { reconstruction_body_sha256: replayDigest, ...replayBody } = replay;

    expect(firstBytes).toEqual(replayBytes);
    expect(firstDigest).toBe(replayDigest);
    expect(firstDigest).toBe("f4998d8b52e7d484cb9cac37e1739338bef6dc38a83342f72a937657c8f3f028");
    await expect(sha256Hex(canonicalStringify(firstBody))).resolves.toBe(firstDigest);
    await expect(sha256Hex(canonicalStringify(replayBody))).resolves.toBe(replayDigest);
    expect(first).toMatchObject({
      outcome: "MATCH",
      reason_code: "NONE",
      authority: "PAPER_ONLY",
      real_execution_allowed: false,
      command: null,
    });
    expect(Object.isFrozen(first)).toBe(true);

    const evidenceIdentityChanged = {
      ...evidence,
      evidence_id: "broker-evidence-reconstruction-v2",
    };
    const capabilityDigestChanged = await brokerCapabilityFixture({
      broker_symbol: "EURUSD-REPLAY",
    });
    const changedEvidence = await reconstructBrokerGeometryV1(
      structuredClone(candidate),
      structuredClone(evidenceIdentityChanged),
      structuredClone(capability),
    );
    const changedCapability = await reconstructBrokerGeometryV1(
      structuredClone(candidate),
      brokerBarEvidenceFixture(longBars(), capabilityDigestChanged),
      structuredClone(capabilityDigestChanged),
    );

    expect(changedEvidence.evidence_id).toBe(evidenceIdentityChanged.evidence_id);
    expect(changedEvidence.reconstruction_body_sha256).not.toBe(firstDigest);
    expect(changedCapability.capability_sha256).toBe(capabilityDigestChanged.capability_sha256);
    expect(changedCapability.reconstruction_body_sha256).not.toBe(firstDigest);
    expect(changedCapability.reconstruction_body_sha256).not.toBe(
      changedEvidence.reconstruction_body_sha256,
    );
    for (const result of [changedEvidence, changedCapability]) {
      const { reconstruction_body_sha256: digest, ...body } = result;
      await expect(sha256Hex(canonicalStringify(body))).resolves.toBe(digest);
      expect(result.authority).toBe("PAPER_ONLY");
      expect(result.real_execution_allowed).toBe(false);
      expect(result.command).toBeNull();
    }
  });

  it("blocks valid evidence that derives nonpositive LONG broker geometry", async () => {
    const candidate = await v2LongCandidateFixture();
    const capability = await brokerCapabilityFixture();
    const evidence = brokerBarEvidenceFixture([
      { open_epoch: 1_786_391_100, close_epoch: 1_786_391_400, open_ticks: 1080, high_ticks: 1090, low_ticks: 1060, close_ticks: 1080, closed: true },
      { open_epoch: 1_786_391_400, close_epoch: 1_786_391_700, open_ticks: 1040, high_ticks: 1110, low_ticks: 0, close_ticks: 1100, closed: true },
      { open_epoch: 1_786_391_700, close_epoch: 1_786_392_000, open_ticks: 1040, high_ticks: 1110, low_ticks: 1000, close_ticks: 1100, closed: true },
    ], capability);

    const result = await reconstructBrokerGeometryV1(candidate, evidence, capability);

    expect(result).toMatchObject({
      outcome: "BLOCKED",
      reason_code: "GEOMETRY_MISMATCH",
      matched_engagement_open_epoch: null,
      matched_source_bar_close_epoch: null,
      broker_entry_ticks: null,
      broker_wick_ticks: null,
      broker_stop_ticks: null,
      broker_risk_distance_ticks: null,
      broker_target_ticks: null,
      maximum_divergence_price_units: null,
      authority: "PAPER_ONLY",
      real_execution_allowed: false,
      command: null,
    });
  });

  it("blocks valid evidence whose derived 4R target is outside safe broker ticks", async () => {
    const candidate = await v2LongCandidateFixture();
    const capability = await brokerCapabilityFixture();
    const evidence = brokerBarEvidenceFixture([
      { open_epoch: 1_786_391_100, close_epoch: 1_786_391_400, open_ticks: 1080, high_ticks: 1090, low_ticks: 1060, close_ticks: 1080, closed: true },
      { open_epoch: 1_786_391_400, close_epoch: 1_786_391_700, open_ticks: 1040, high_ticks: 1110, low_ticks: 1000, close_ticks: 1100, closed: true },
      { open_epoch: 1_786_391_700, close_epoch: 1_786_392_000, open_ticks: Number.MAX_SAFE_INTEGER - 1, high_ticks: Number.MAX_SAFE_INTEGER, low_ticks: 1000, close_ticks: Number.MAX_SAFE_INTEGER, closed: true },
    ], capability);

    const result = await reconstructBrokerGeometryV1(candidate, evidence, capability);

    expect(result).toMatchObject({
      outcome: "BLOCKED",
      reason_code: "GEOMETRY_MISMATCH",
      matched_engagement_open_epoch: null,
      matched_source_bar_close_epoch: null,
      broker_entry_ticks: null,
      broker_wick_ticks: null,
      broker_stop_ticks: null,
      broker_risk_distance_ticks: null,
      broker_target_ticks: null,
      maximum_divergence_price_units: null,
      authority: "PAPER_ONLY",
      real_execution_allowed: false,
      command: null,
    });
  });

  it("blocks valid evidence whose exact divergence is outside safe wire units", async () => {
    const candidate = await v2LongCandidateFixture();
    const { candidate_body_sha256: _oldDigest, ...body } = candidate;
    const updatedBody = { ...body, source_tick_size: "1" };
    const updatedCandidate = {
      ...updatedBody,
      candidate_body_sha256: await sha256Hex(canonicalStringify(updatedBody)),
    };
    const capability = await brokerCapabilityFixture({
      source_tick_size: "1",
      broker_tick_size: "1",
    });
    const evidence = brokerBarEvidenceFixture([
      { open_epoch: 1_786_391_100, close_epoch: 1_786_391_400, open_ticks: 1080, high_ticks: 1090, low_ticks: 1060, close_ticks: 1080, closed: true },
      { open_epoch: 1_786_391_400, close_epoch: 1_786_391_700, open_ticks: 1040, high_ticks: 12000, low_ticks: 1000, close_ticks: 1100, closed: true },
      { open_epoch: 1_786_391_700, close_epoch: 1_786_392_000, open_ticks: 1040, high_ticks: 1110, low_ticks: 1000, close_ticks: 1100, closed: true },
    ], capability);

    const result = await reconstructBrokerGeometryV1(updatedCandidate, evidence, capability);

    expect(result).toMatchObject({
      outcome: "BLOCKED",
      reason_code: "GEOMETRY_MISMATCH",
      matched_engagement_open_epoch: null,
      matched_source_bar_close_epoch: null,
      broker_entry_ticks: null,
      broker_wick_ticks: null,
      broker_stop_ticks: null,
      broker_risk_distance_ticks: null,
      broker_target_ticks: null,
      maximum_divergence_price_units: null,
      authority: "PAPER_ONLY",
      real_execution_allowed: false,
      command: null,
    });
  });
});
