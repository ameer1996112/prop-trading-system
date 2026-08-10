import { describe, expect, it } from "vitest";

import { reconstructBrokerGeometryV1 } from "../src/broker-geometry-reconstruction-v1";
import {
  brokerBarEvidenceFixture,
  brokerCapabilityFixture,
  v2LongCandidateFixture,
  v2ShortCandidateFixture,
  v2ShortGeometryCandidateFixture,
} from "./support/broker-reconstruction-fixture";

describe("broker geometry reconstruction v1", () => {
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
});
