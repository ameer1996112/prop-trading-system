import { describe, expect, it } from "vitest";

import { validateBrokerSymbolCapabilityV1 } from "../src/broker-symbol-capability-v1";
import { validateExecutionCandidateV2 } from "../src/execution-candidate-v2";
import {
  brokerCapabilityFixture,
  v2LongCandidateFixture,
} from "./support/broker-reconstruction-fixture";

describe("broker reconstruction contracts", () => {
  it("accepts a canonical paper-only V2 candidate and binds zone activation into identity", async () => {
    const candidate = await v2LongCandidateFixture();
    await expect(validateExecutionCandidateV2(candidate)).resolves.toMatchObject({
      schema_version: "ExecutionCandidateV2",
      proposal_schema_version: "rd-entry-execution-proposal-v2",
      strategy_version: "rd-entry-execution-proposal-v2",
      execution_mode: "PAPER_ONLY",
      zone_active_from_epoch: 1_786_391_100,
    });
  });

  it("accepts only exact inert broker symbol capability digests and buffer policies", async () => {
    const capability = await brokerCapabilityFixture();
    await expect(validateBrokerSymbolCapabilityV1(capability)).resolves.toMatchObject({
      schema_version: "BrokerSymbolCapabilityV1",
      source_symbol: "EURUSD",
      broker_symbol: "EURUSD",
      source_buffer_ticks: 2,
      broker_buffer_ticks: 2,
      divergence_tolerance_source_ticks: 3,
    });
    for (const value of [
      { ...capability, unexpected: true },
      { ...capability, capability_sha256: "4".repeat(64) },
      await brokerCapabilityFixture({ source_buffer_ticks: 3 }),
      await brokerCapabilityFixture({ divergence_tolerance_source_ticks: 4 }),
      await brokerCapabilityFixture({ source_tick_size: "0.000010" }),
      await brokerCapabilityFixture({
        source_tick_size: "0.000015",
        broker_tick_size: "0.00002",
        broker_buffer_ticks: 1,
      }),
    ]) {
      await expect(validateBrokerSymbolCapabilityV1(value)).rejects.toThrow(
        "BROKER_SYMBOL_CAPABILITY_INVALID",
      );
    }
  });
});
