import { readFileSync } from "node:fs";

import { canonicalStringify, sha256Hex } from "../../src/canonical";

const proposalVector = JSON.parse(
  readFileSync(
    new URL("../../../../contracts/vectors/rd-entry-execution-proposal-v1.json", import.meta.url),
    "utf8",
  ),
) as {
  readonly accept_cases: readonly { readonly proposal: Record<string, unknown> }[];
};

async function v2CandidateFromProposal(index: number): Promise<Record<string, unknown>> {
  const proposal = structuredClone(proposalVector.accept_cases[index]!.proposal);
  const engagement = proposal.engagement_candle as Record<string, unknown>;
  const sourceBar = proposal.source_bar as Record<string, unknown>;
  engagement.open_epoch = 1_786_391_400;
  engagement.close_epoch = 1_786_391_700;
  sourceBar.open_epoch = 1_786_391_700;
  sourceBar.close_epoch = 1_786_392_000;
  proposal.observed_at_epoch = 1_786_392_001;
  proposal.strategy_version = "rd-entry-execution-proposal-v2";
  proposal.zone_active_from_epoch = 1_786_391_100;

  const identity = {
    strategy_version: "rd-entry-execution-proposal-v2",
    wire_version: "ExecutionCandidateV2",
    ticker_id: proposal.ticker_id,
    setup_id: proposal.setup_id,
    setup_revision: proposal.setup_revision,
    selection_id: proposal.selection_id,
    source_bar_close_epoch: sourceBar.close_epoch,
  };
  const logicalCandidateId = await sha256Hex(canonicalStringify(identity));
  const body = {
    ...proposal,
    schema_version: "ExecutionCandidateV2",
    proposal_schema_version: "rd-entry-execution-proposal-v2",
    logical_candidate_id: logicalCandidateId,
  };
  const candidateBodySha256 = await sha256Hex(canonicalStringify(body));
  return {
    ...body,
    candidate_body_sha256: candidateBodySha256,
  };
}

export async function v2LongCandidateFixture(): Promise<Record<string, unknown>> {
  return v2CandidateFromProposal(0);
}

export async function v2ShortCandidateFixture(): Promise<Record<string, unknown>> {
  return v2CandidateFromProposal(1);
}

export type BrokerCapabilityFixtureOverrides = Readonly<Record<string, unknown>>;

export async function brokerCapabilityFixture(
  overrides: BrokerCapabilityFixtureOverrides = {},
): Promise<Record<string, unknown>> {
  const base = {
    schema_version: "BrokerSymbolCapabilityV1",
    account_profile_sha256: "3".repeat(64),
    source_symbol: "EURUSD",
    broker_symbol: "EURUSD",
    source_tick_size: "0.00001",
    broker_tick_size: "0.00001",
    buffer_policy_version: "rd-entry-wick-buffer-v1",
    source_buffer_ticks: 2,
    broker_buffer_ticks: 2,
    divergence_tolerance_source_ticks: 3,
  };
  const body = { ...base, ...overrides };
  const capabilitySha256 = await sha256Hex(canonicalStringify(body));
  return {
    ...body,
    capability_sha256: overrides.capability_sha256 ?? capabilitySha256,
  };
}
