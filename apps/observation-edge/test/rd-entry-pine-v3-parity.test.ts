import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  evaluateEntryV3Bundle,
} from "../src/rd-entry-arbitrator-v3";
import type {
  EntryArbitrationInputV3,
} from "../src/rd-entry-domain-v3";
import {
  validateEntryV3Payload,
} from "../src/rd-entry-wire-v3";
import { parseStrictJson } from "../src/strict-json";

const vectors = JSON.parse(
  readFileSync(
    new URL(
      "../../../contracts/vectors/rd-entry-arbitration-v3.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as {
  cases: Array<{
    case_id: string;
    input: EntryArbitrationInputV3;
    expected: {
      candidates: Array<Record<string, unknown>>;
      evidence: Array<Record<string, unknown>>;
      selection: Record<string, unknown>;
    };
  }>;
};

const reviewedHashes = {
  detector_code_hash: "a".repeat(64),
  settings_hash: "b".repeat(64),
} as const;

const requiredRuleIds = [
  "LIQ_ACTUAL_EXTREME_SWEPT",
  "LIQ_DISTANCE_INFLUENCES_ZONE",
  "LIQ_EVENT_ORDER",
  "LIQ_INTERNAL_REBREAK",
  "LIQ_NORMAL_TWO_OPPOSITE_CANDLES",
  "LIQ_ONE_CANDLE_EXCEPTION",
  "LIQ_OWN_EXTREME_SAME_LEG",
  "LIQ_REPLACEMENT_AFTER_STALE_MOVE",
  "LIQ_STRICT_OWN_EXTREME_BREAK",
  "TIMEFRAME_FIVE_MINUTE_ONLY",
  "ZONE_ACCURACY_BOUNDS",
  "ZONE_FRESH_UNTAPPED",
  "ZONE_ORIGIN_OPPOSITE_CANDLE",
  "ZONE_PRE_ENTRY_CLOSE_OUTSIDE",
] as const;

function vector(caseId: string) {
  return structuredClone(
    vectors.cases.find((item) => item.case_id === caseId)!,
  );
}

function pinePayload(caseId: string): {
  payload: Record<string, unknown>;
  input: EntryArbitrationInputV3;
} {
  const fixture = vector(caseId);
  const { input, expected } = fixture;
  const selection = expected.selection;
  const canonicalEvidence = expected.evidence.find(
    (item) => item.evidence_id === selection.canonical_evidence_id,
  )!;
  const direction = input.direction;
  const entryTicks = canonicalEvidence.observed_trigger_ticks as number;
  const confirmedBar =
    selection.canonical_model === "DIR_CLOSE" ? input.confirmed_bar : null;
  const observedAtEpoch = Math.max(
    input.observed_at_epoch,
    selection.evaluated_at_epoch as number,
  );
  return {
    input,
    payload: {
      schema_version: "3.0",
      strategy_id: "rd_liquidity_sd_5m_v1",
      strategy_version: "3.0.0-contract3",
      rule_contract_version: "3.0.0",
      execution_mode: "PAPER_ONLY",
      producer_instance_id: "pine-v3",
      producer_sequence: canonicalEvidence.trigger_sequence,
      event_id: `pine-v3:${caseId}`,
      is_realtime: canonicalEvidence.proof_plane === "REALTIME_TICK",
      symbol: "EURUSD",
      ticker_id: "OANDA:EURUSD",
      feed: "OANDA",
      timeframe: "5",
      tick_size: "0.00001",
      detector_code_hash: reviewedHashes.detector_code_hash,
      settings_hash: reviewedHashes.settings_hash,
      observed_at_epoch: observedAtEpoch,
      market_event: {
        epoch: canonicalEvidence.observed_trigger_epoch,
        sequence: canonicalEvidence.trigger_sequence,
        tick_price_ticks: entryTicks,
        barstate_isconfirmed: confirmedBar !== null,
        confirmed_bar: confirmedBar,
      },
      exit_events: [],
      setups: [
        {
          setup: {
            setup_id: input.setup_id,
            direction,
            zone_top_ticks: input.zone_top_ticks,
            zone_bottom_ticks: input.zone_bottom_ticks,
            zone_engaged_epoch: input.zone_engaged_epoch,
            invalidated_before_entry: input.setup_invalidated,
            common_fidelity: input.common_fidelity,
            common_rule_results: requiredRuleIds.map((rule_id) => ({
              rule_id,
              passed: true,
            })),
          },
          candidates: expected.candidates,
          evidence: expected.evidence,
          selection_proposal: selection,
          trade_plan: {
            direction,
            entry_ticks: entryTicks,
            stop_ticks: direction === "LONG" ? entryTicks - 10 : entryTicks + 10,
            target_ticks: direction === "LONG" ? entryTicks + 20 : entryTicks - 20,
          },
        },
      ],
    },
  };
}

function strict(value: unknown) {
  return parseStrictJson(new TextEncoder().encode(JSON.stringify(value)));
}

function useEdgeDerivedReferences(value: Record<string, unknown>): void {
  const bundle = (value.setups as Array<Record<string, unknown>>)[0]!;
  const candidates = bundle.candidates as Array<Record<string, unknown>>;
  const evidence = bundle.evidence as Array<Record<string, unknown>>;
  const selection = bundle.selection_proposal as Record<string, unknown>;
  const modelByCandidateId = new Map(
    candidates.map((item) => [
      item.candidate_id as string,
      item.model as string,
    ]),
  );
  const modelByEvidenceId = new Map(
    evidence.map((item) => [
      item.evidence_id as string,
      modelByCandidateId.get(item.candidate_id as string)!,
    ]),
  );
  const canonicalCandidateModel =
    selection.canonical_candidate_id === null
      ? null
      : modelByCandidateId.get(selection.canonical_candidate_id as string)!;
  const canonicalEvidenceModel =
    selection.canonical_evidence_id === null
      ? null
      : modelByEvidenceId.get(selection.canonical_evidence_id as string)!;
  for (const candidate of candidates) {
    candidate.candidate_id = `EDGE_DERIVED:${candidate.model as string}`;
  }
  for (const item of evidence) {
    const model = modelByCandidateId.get(item.candidate_id as string);
    item.candidate_id = `EDGE_DERIVED:${model!}`;
    item.evidence_id = `EDGE_DERIVED:${model!}`;
    item.payload_sha256 = "EDGE_DERIVED";
  }
  selection.selection_id = "EDGE_DERIVED";
  selection.candidate_ids_considered = candidates
    .map((item) => item.candidate_id as string)
    .sort();
  selection.canonical_candidate_id =
    canonicalCandidateModel === null
      ? null
      : `EDGE_DERIVED:${canonicalCandidateModel}`;
  selection.canonical_evidence_id =
    canonicalEvidenceModel === null
      ? null
      : `EDGE_DERIVED:${canonicalEvidenceModel}`;
}

describe("RD Pine v3 payload parity", () => {
  it("keeps BOC and flip when the same tick satisfies both", async () => {
    const fixture = pinePayload("boc_flip_same_event");
    useEdgeDerivedReferences(fixture.payload);
    const parsed = await validateEntryV3Payload(
      strict(fixture.payload),
      reviewedHashes,
    );
    const evaluated = await evaluateEntryV3Bundle(fixture.input);

    expect(parsed.entryBundles[0]!.evaluation).toEqual(evaluated);
    expect(evaluated.selection.reason).toBe("CO_TRIGGER_SAME_EVENT");
    expect(evaluated.selection.co_triggered_models).toEqual([
      "BOC",
      "HTF_FLIP",
    ]);
    expect(JSON.stringify(parsed.canonicalPayload)).not.toContain(
      "EDGE_DERIVED",
    );
    expect(
      parsed.entryBundles[0]!.candidates.every((item) =>
        /^[a-f0-9]{64}$/u.test(item.candidate_id),
      ),
    ).toBe(true);
    expect(
      parsed.entryBundles[0]!.evidence.every(
        (item) =>
          /^[a-f0-9]{64}$/u.test(item.evidence_id) &&
          /^[a-f0-9]{64}$/u.test(item.payload_sha256),
      ),
    ).toBe(true);
    expect(
      /^[a-f0-9]{64}$/u.test(
        parsed.entryBundles[0]!.selectionProposal.selection_id,
      ),
    ).toBe(true);
  });

  it("keeps an exact strict BOC distinct from directional close", async () => {
    const fixture = pinePayload("strict_long_boc_only");
    useEdgeDerivedReferences(fixture.payload);
    const parsed = await validateEntryV3Payload(
      strict(fixture.payload),
      reviewedHashes,
    );
    const evaluated = await evaluateEntryV3Bundle(fixture.input);

    expect(parsed.entryBundles[0]!.evaluation).toEqual(evaluated);
    expect(evaluated.selection.canonical_model).toBe("BOC");
    expect(evaluated.candidates.map((item) => item.model)).toEqual(["BOC"]);
  });
});
