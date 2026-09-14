import { writeFileSync } from "node:fs";

import { reconstructBrokerGeometryV1 } from "../../src/broker-geometry-reconstruction-v1";
import {
  brokerBarEvidenceFixture,
  brokerCapabilityFixture,
  v2LongCandidateFixture,
  v2ShortCandidateFixture,
} from "./broker-reconstruction-fixture";

const output = new URL(
  "../../../../contracts/vectors/broker-geometry-reconstruction-v1.json",
  import.meta.url,
);

const inertGeometryPolicy = {
  EURUSD: { buffer: 2, tolerance: 3 },
  GBPJPY: { buffer: 3, tolerance: 5 },
  USDJPY: { buffer: 2, tolerance: 5 },
  XAUUSD: { buffer: 5, tolerance: 10 },
  NAS100: { buffer: 10, tolerance: 20 },
};

const longBars = [
  { open_epoch: 1_786_391_100, close_epoch: 1_786_391_400, open_ticks: 1080, high_ticks: 1090, low_ticks: 1060, close_ticks: 1080, closed: true },
  { open_epoch: 1_786_391_400, close_epoch: 1_786_391_700, open_ticks: 1100, high_ticks: 1110, low_ticks: 1000, close_ticks: 1080, closed: true },
  { open_epoch: 1_786_391_700, close_epoch: 1_786_392_000, open_ticks: 1040, high_ticks: 1110, low_ticks: 1000, close_ticks: 1100, closed: true },
] as const;

const shortBars = [
  { open_epoch: 1_786_391_100, close_epoch: 1_786_391_400, open_ticks: 1930, high_ticks: 1940, low_ticks: 1900, close_ticks: 1920, closed: true },
  { open_epoch: 1_786_391_400, close_epoch: 1_786_391_700, open_ticks: 1900, high_ticks: 2000, low_ticks: 1880, close_ticks: 1920, closed: true },
  { open_epoch: 1_786_391_700, close_epoch: 1_786_392_000, open_ticks: 1970, high_ticks: 2000, low_ticks: 1880, close_ticks: 1900, closed: true },
] as const;

const longCandidate = await v2LongCandidateFixture();
const shortCandidate = await v2ShortCandidateFixture();
const eurusd = await brokerCapabilityFixture();
const gbpjpy = await brokerCapabilityFixture({
  source_symbol: "GBPJPY",
  broker_symbol: "GBPJPY",
  source_tick_size: "0.001",
  broker_tick_size: "0.001",
  source_buffer_ticks: 3,
  broker_buffer_ticks: 3,
  divergence_tolerance_source_ticks: 5,
});

async function vectorCase(
  caseId: string,
  candidate: Record<string, unknown>,
  capability: Record<string, unknown>,
  bars: readonly Record<string, unknown>[],
) {
  const evidence = brokerBarEvidenceFixture(bars, capability);
  return {
    case_id: caseId,
    candidate,
    capability,
    evidence,
    expected: await reconstructBrokerGeometryV1(candidate, evidence, capability),
  };
}

const vector = {
  vector_version: "broker-geometry-reconstruction-v1",
  canonicalization: "UTF-8 JSON with recursively sorted object keys, preserved array order, safe integers only, and Unicode scalar strings only",
  inert_geometry_policy: inertGeometryPolicy,
  capabilities: { eurusd, gbpjpy },
  candidate_digests: {
    v2_long: {
      logical_candidate_id: longCandidate.logical_candidate_id,
      candidate_body_sha256: longCandidate.candidate_body_sha256,
    },
    v2_short: {
      logical_candidate_id: shortCandidate.logical_candidate_id,
      candidate_body_sha256: shortCandidate.candidate_body_sha256,
    },
  },
  cases: [
    await vectorCase("long_match", longCandidate, eurusd, longBars),
    await vectorCase("short_match", shortCandidate, gbpjpy, shortBars),
    await vectorCase("data_gap", longCandidate, eurusd, [longBars[2]]),
    await vectorCase("divergence_block", longCandidate, eurusd, [
      longBars[0],
      { ...longBars[1], low_ticks: 990 },
      { ...longBars[2], low_ticks: 990 },
    ]),
  ],
};

writeFileSync(output, `${JSON.stringify(vector, null, 2)}\n`);
