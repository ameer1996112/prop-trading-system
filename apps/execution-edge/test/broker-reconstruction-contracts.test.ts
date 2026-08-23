import { describe, expect, it } from "vitest";

import { validateBrokerSymbolCapabilityV1 } from "../src/broker-symbol-capability-v1";
import { canonicalStringify, sha256Hex } from "../src/canonical";
import { validateExecutionCandidateV2 } from "../src/execution-candidate-v2";
import {
  brokerCapabilityFixture,
  v2LongCandidateFixture,
} from "./support/broker-reconstruction-fixture";

async function withCandidateBody(
  candidate: Record<string, unknown>,
  updates: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { candidate_body_sha256: _digest, ...body } = candidate;
  const nextBody = { ...body, ...updates };
  return {
    ...nextBody,
    candidate_body_sha256: await sha256Hex(canonicalStringify(nextBody)),
  };
}

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

  it("keeps the inert policy immutable when validating later capabilities", async () => {
    const capability = await brokerCapabilityFixture();
    const policy = (await import("../src/broker-symbol-capability-v1")).INERT_GEOMETRY_POLICY;
    expect(Reflect.set(policy.EURUSD, "buffer", 999)).toBe(false);
    expect(policy.EURUSD.buffer).toBe(2);
    await expect(validateBrokerSymbolCapabilityV1(capability)).resolves.toMatchObject({
      source_buffer_ticks: 2,
      divergence_tolerance_source_ticks: 3,
    });
  });

  it("rejects V2 candidate unknown fields and untrusted digests", async () => {
    const candidate = await v2LongCandidateFixture();
    for (const value of [
      { ...candidate, unexpected: true },
      { ...candidate, candidate_body_sha256: "4".repeat(64) },
      { ...candidate, logical_candidate_id: "5".repeat(64) },
    ]) {
      await expect(validateExecutionCandidateV2(value)).rejects.toThrow(
        "EXECUTION_CANDIDATE_V2_INVALID",
      );
    }
  });

  it("rejects changed canonical source fields when their digests are not recomputed", async () => {
    const candidate = await v2LongCandidateFixture();
    const capability = await brokerCapabilityFixture();
    await expect(validateExecutionCandidateV2({
      ...candidate,
      source_tick_size: "0.001",
    })).rejects.toThrow("EXECUTION_CANDIDATE_V2_INVALID");
    await expect(validateBrokerSymbolCapabilityV1({
      ...capability,
      source_symbol: "GBPJPY",
    })).rejects.toThrow("BROKER_SYMBOL_CAPABILITY_INVALID");
  });

  it("rejects noncanonical V2 decimals and every invalid zone activation boundary", async () => {
    const candidate = await v2LongCandidateFixture();
    const noncanonical = await withCandidateBody(candidate, { source_tick_size: "0.000010" });
    await expect(validateExecutionCandidateV2(noncanonical)).rejects.toThrow(
      "EXECUTION_CANDIDATE_V2_INVALID",
    );
    for (const zoneActive of [1_786_391_101, 1_786_391_700, 1_786_392_000]) {
      await expect(validateExecutionCandidateV2(
        await withCandidateBody(candidate, { zone_active_from_epoch: zoneActive }),
      )).rejects.toThrow("EXECUTION_CANDIDATE_V2_INVALID");
    }
  });
});
