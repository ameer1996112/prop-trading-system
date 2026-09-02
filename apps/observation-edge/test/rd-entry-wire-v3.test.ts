import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  candidateIdV3,
  evidenceIdV3,
  evidencePayloadSha256V3,
  selectionIdV3,
  type EntryCandidateEvidenceV3,
  type EntrySelectionV3,
} from "../src/rd-entry-domain-v3";
import {
  ENTRY_V3_MAX_PAYLOAD_CHARACTERS,
  EntryV3ValidationError,
  validateEntryV3BodySize,
  validateEntryV3Payload,
} from "../src/rd-entry-wire-v3";
import { parseStrictJson } from "../src/strict-json";
import { validateObservationEnvelope } from "../src/validation";

const vectorDocument = JSON.parse(
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
    input: Record<string, unknown>;
    expected: Record<string, unknown>;
  }>;
};
const digest = "a".repeat(64);
const reviewedHashes = {
  detector_code_hash: digest,
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

function strict(value: unknown) {
  return parseStrictJson(new TextEncoder().encode(JSON.stringify(value)));
}

function payload(): Record<string, unknown> {
  const vector = structuredClone(
    vectorDocument.cases.find(
      (item) => item.case_id === "strict_long_boc_only",
    )!,
  );
  const input = vector.input;
  const reference = (input.boc_proof as {
    reference_candle: Record<string, unknown>;
  }).reference_candle;
  return {
    schema_version: "3.0",
    strategy_id: "rd_liquidity_sd_5m_v1",
    strategy_version: "3.0.0-contract3",
    rule_contract_version: "3.0.0",
    execution_mode: "PAPER_ONLY",
    producer_instance_id: "pine-v3",
    producer_sequence: 1,
    event_id: "pine-v3:1",
    is_realtime: true,
    symbol: "EURUSD",
    ticker_id: "OANDA:EURUSD",
    feed: "OANDA",
    timeframe: "5",
    tick_size: "0.00001",
    detector_code_hash: digest,
    settings_hash: "b".repeat(64),
    observed_at_epoch: 2400,
    market_event: {
      epoch: 1801,
      sequence: 7,
      tick_price_ticks: 111,
      barstate_isconfirmed: false,
      confirmed_bar: null,
    },
    exit_events: [],
    setups: [
      {
        setup: {
          setup_id: input.setup_id,
          direction: input.direction,
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
        candidates: vector.expected.candidates,
        evidence: vector.expected.evidence,
        selection_proposal: vector.expected.selection,
        trade_plan: {
          direction: "LONG",
          entry_ticks: 111,
          stop_ticks: 96,
          target_ticks: 141,
        },
      },
    ],
  };
}

function payloadFor(caseId: string): Record<string, unknown> {
  const vector = structuredClone(
    vectorDocument.cases.find((item) => item.case_id === caseId)!,
  );
  const input = vector.input;
  const expected = vector.expected as {
    candidates: Array<Record<string, unknown>>;
    evidence: Array<Record<string, unknown>>;
    selection: Record<string, unknown>;
  };
  const selection = expected.selection;
  const canonicalEvidence = expected.evidence.find(
    (item) => item.evidence_id === selection.canonical_evidence_id,
  ) ?? expected.evidence[0]!;
  const direction = input.direction as "LONG" | "SHORT";
  const entryTicks = canonicalEvidence.observed_trigger_ticks as number;
  const confirmedBar =
    selection.canonical_model === "DIR_CLOSE"
      ? ((input.opened_selection_seed as
          | { confirmed_bar: Record<string, unknown> }
          | null)?.confirmed_bar ??
        input.confirmed_bar)
      : null;
  const observedAtEpoch = Math.max(
    input.observed_at_epoch as number,
    selection.evaluated_at_epoch as number,
  );
  return {
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
  };
}

function unreviewedPayload(): Record<string, unknown> {
  const value = payloadFor("boc_before_engagement");
  value.detector_code_hash = "UNREVIEWED";
  value.settings_hash = "UNREVIEWED";
  const bundle = (value.setups as Array<Record<string, unknown>>)[0]!;
  const setup = bundle.setup as Record<string, unknown>;
  setup.common_fidelity = "UNRESOLVED";
  const commonRules = setup.common_rule_results as Array<
    Record<string, unknown>
  >;
  commonRules[0]!.passed = false;
  const evidence = (bundle.evidence as Array<Record<string, unknown>>)[0]!;
  evidence.fidelity = "UNRESOLVED";
  evidence.passed_rule_ids = [];
  evidence.failed_rule_ids = ["COMMON_SETUP_NOT_EXACT"];
  useEdgeDerivedReferences(value);
  return value;
}

function historicalAmbiguousExitPayload(): Record<string, unknown> {
  const value = payloadFor("discretionary_boc_shadow");
  const bundle = (value.setups as Array<Record<string, unknown>>)[0]!;
  const setup = bundle.setup as Record<string, unknown>;
  const evidence = (bundle.evidence as Array<Record<string, unknown>>)[0]!;
  evidence.proof_plane = "LOWER_TIMEFRAME_REPLAY";
  evidence.replayability = "REPLAYABLE";
  value.is_realtime = false;
  value.observed_at_epoch = 2700;
  value.market_event = {
    epoch: 2700,
    sequence: 0,
    tick_price_ticks: 111,
    barstate_isconfirmed: true,
    confirmed_bar: {
      open_epoch: 2400,
      close_epoch: 2700,
      open_ticks: 111,
      high_ticks: 140,
      low_ticks: 90,
      close_ticks: 111,
    },
  };
  useEdgeDerivedReferences(value);
  const marketEvent = value.market_event as Record<string, unknown>;
  value.exit_events = [
    {
      event_id: `${setup.setup_id as string}:exit:AMBIGUOUS_SAME_BAR_EXIT:0`,
      setup_id: setup.setup_id,
      exit_reason: "AMBIGUOUS_SAME_BAR_EXIT",
      epoch: marketEvent.epoch,
      sequence: marketEvent.sequence,
      price_ticks: marketEvent.tick_price_ticks,
    },
  ];
  return value;
}

function laterRealtimeExitPayload(
  exitReason: "STOP_LOSS" | "TARGET",
  priceTicks: number,
): Record<string, unknown> {
  const value = payload();
  value.producer_sequence = 8;
  value.event_id = `pine-v3:exit:${exitReason}:8`;
  value.observed_at_epoch = 3000;
  value.market_event = {
    epoch: 3000,
    sequence: 8,
    tick_price_ticks: priceTicks,
    barstate_isconfirmed: false,
    confirmed_bar: null,
  };
  value.exit_events = [
    {
      event_id: `setup-strict-long:exit:${exitReason}:8`,
      setup_id: "setup-strict-long",
      exit_reason: exitReason,
      epoch: 3000,
      sequence: 8,
      price_ticks: priceTicks,
    },
  ];
  return value;
}

function laterRealtimeShortExitPayload(
  exitReason: "STOP_LOSS" | "TARGET",
): Record<string, unknown> {
  const value = payloadFor("strict_short_boc_only");
  const bundle = (value.setups as Array<Record<string, unknown>>)[0]!;
  const setup = bundle.setup as Record<string, unknown>;
  const plan = bundle.trade_plan as Record<string, unknown>;
  const priceTicks =
    exitReason === "STOP_LOSS"
      ? (plan.stop_ticks as number) + 1
      : (plan.target_ticks as number) - 1;
  value.producer_sequence = 10;
  value.event_id = `pine-v3:short-exit:${exitReason}:10`;
  value.observed_at_epoch = 3000;
  value.market_event = {
    epoch: 3000,
    sequence: 10,
    tick_price_ticks: priceTicks,
    barstate_isconfirmed: false,
    confirmed_bar: null,
  };
  value.exit_events = [
    {
      event_id: `${setup.setup_id as string}:exit:${exitReason}:10`,
      setup_id: setup.setup_id,
      exit_reason: exitReason,
      epoch: 3000,
      sequence: 10,
      price_ticks: priceTicks,
    },
  ];
  return value;
}

function laterExactPaperAmbiguousExitPayload(): Record<string, unknown> {
  const value = payload();
  value.producer_sequence = 9;
  value.event_id = "pine-v3:exit:AMBIGUOUS_SAME_BAR_EXIT:9";
  value.is_realtime = false;
  value.observed_at_epoch = 2700;
  value.market_event = {
    epoch: 2700,
    sequence: 9,
    tick_price_ticks: 111,
    barstate_isconfirmed: true,
    confirmed_bar: {
      open_epoch: 2400,
      close_epoch: 2700,
      open_ticks: 112,
      high_ticks: 145,
      low_ticks: 90,
      close_ticks: 111,
    },
  };
  value.exit_events = [
    {
      event_id: "setup-strict-long:exit:AMBIGUOUS_SAME_BAR_EXIT:9",
      setup_id: "setup-strict-long",
      exit_reason: "AMBIGUOUS_SAME_BAR_EXIT",
      epoch: 2700,
      sequence: 9,
      price_ticks: 111,
    },
  ];
  return value;
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

function setupOf(value: Record<string, unknown>): Record<string, unknown> {
  const bundle = (value.setups as Array<Record<string, unknown>>)[0]!;
  return bundle.setup as Record<string, unknown>;
}

function selectionOf(value: Record<string, unknown>): Record<string, unknown> {
  const bundle = (value.setups as Array<Record<string, unknown>>)[0]!;
  return bundle.selection_proposal as Record<string, unknown>;
}

function rule(
  value: Record<string, unknown>,
  ruleId: (typeof requiredRuleIds)[number],
): Record<string, unknown> {
  return (
    setupOf(value).common_rule_results as Array<Record<string, unknown>>
  ).find((item) => item.rule_id === ruleId)!;
}

function tagOneCandlePayload(value: Record<string, unknown>): void {
  value.schema_version = "3.1";
  value.strategy_version = "3.1.0-contract3";
  value.rule_contract_version = "3.1.0";
  const setup = setupOf(value);
  setup.liquidity_cohort = "ONE_CANDLE";
  setup.one_candle_enabled = true;
  setup.common_fidelity = "DISCRETIONARY";
  rule(value, "LIQ_NORMAL_TWO_OPPOSITE_CANDLES").passed = false;
  rule(value, "LIQ_ONE_CANDLE_EXCEPTION").passed = true;
  rule(value, "LIQ_INTERNAL_REBREAK").passed = false;
}

function oneCandlePayload(): Record<string, unknown> {
  const value = payload();
  useEdgeDerivedReferences(value);
  tagOneCandlePayload(value);
  const selection = selectionOf(value);
  selection.canonical_candidate_id = null;
  selection.canonical_evidence_id = null;
  selection.canonical_model = null;
  selection.reason = "ONE_CANDLE_EXPERIMENT_NOT_PROMOTED";
  selection.fidelity = null;
  selection.action = "SHADOW_ONLY";
  selection.co_triggered_models = [];
  return value;
}

async function concreteOneCandleNonePayload(
  reason: "SETUP_INVALIDATED" | "NO_CANDIDATE",
): Promise<Record<string, unknown>> {
  const value = payload();
  tagOneCandlePayload(value);
  const bundle = (
    value.setups as Array<Record<string, unknown>>
  )[0]!;
  const setup = bundle.setup as Record<string, unknown>;
  const selection = bundle.selection_proposal as Record<string, unknown>;
  if (reason === "SETUP_INVALIDATED") {
    setup.invalidated_before_entry = true;
  } else {
    bundle.candidates = [];
    bundle.evidence = [];
    selection.candidate_ids_considered = [];
  }
  selection.canonical_candidate_id = null;
  selection.canonical_evidence_id = null;
  selection.canonical_model = null;
  selection.reason = reason;
  selection.fidelity = null;
  selection.action = "NONE";
  selection.co_triggered_models = [];
  selection.selection_id = await selectionIdV3(
    selection as unknown as EntrySelectionV3,
  );
  return value;
}

async function rehashEvidenceAndSelection(
  value: Record<string, unknown>,
  evidenceIndex: number,
): Promise<void> {
  const setup = (value.setups as Array<Record<string, unknown>>)[0]!;
  const evidence = (setup.evidence as Array<Record<string, unknown>>)[
    evidenceIndex
  ]!;
  const previousEvidenceId = evidence.evidence_id;
  const {
    evidence_id: _,
    payload_sha256: __,
    observed_at_epoch: ___,
    ...payloadFields
  } = evidence;
  evidence.payload_sha256 = await evidencePayloadSha256V3(
    payloadFields as unknown as Omit<
      EntryCandidateEvidenceV3,
      "evidence_id" | "payload_sha256" | "observed_at_epoch"
    >,
  );
  evidence.evidence_id = await evidenceIdV3(
    evidence as unknown as EntryCandidateEvidenceV3,
  );
  const selection = setup.selection_proposal as Record<string, unknown>;
  if (selection.canonical_evidence_id === previousEvidenceId) {
    selection.canonical_evidence_id = evidence.evidence_id;
  }
  selection.selection_id = await selectionIdV3(
    selection as unknown as EntrySelectionV3,
  );
}

async function rehashCandidateGraph(
  value: Record<string, unknown>,
  candidateIndex: number,
): Promise<void> {
  const bundle = (value.setups as Array<Record<string, unknown>>)[0]!;
  const candidates = bundle.candidates as Array<Record<string, unknown>>;
  const candidate = candidates[candidateIndex]!;
  const previousCandidateId = candidate.candidate_id;
  candidate.candidate_id = await candidateIdV3(
    candidate as unknown as Parameters<typeof candidateIdV3>[0],
  );
  const selection = bundle.selection_proposal as Record<string, unknown>;
  const considered = selection.candidate_ids_considered as string[];
  selection.candidate_ids_considered = considered
    .map((id) =>
      id === previousCandidateId ? (candidate.candidate_id as string) : id,
    )
    .sort();
  if (selection.canonical_candidate_id === previousCandidateId) {
    selection.canonical_candidate_id = candidate.candidate_id;
  }
  const evidence = bundle.evidence as Array<Record<string, unknown>>;
  for (let index = 0; index < evidence.length; index += 1) {
    const item = evidence[index]!;
    if (item.candidate_id !== previousCandidateId) continue;
    item.candidate_id = candidate.candidate_id;
    await rehashEvidenceAndSelection(value, index);
  }
  selection.selection_id = await selectionIdV3(
    selection as unknown as EntrySelectionV3,
  );
}

async function addLaterExactBocEvidence(
  value: Record<string, unknown>,
): Promise<string> {
  const bundle = (value.setups as Array<Record<string, unknown>>)[0]!;
  const evidence = bundle.evidence as Array<Record<string, unknown>>;
  const original = evidence[0]!;
  const canonicalEvidenceId = original.evidence_id as string;
  const later = structuredClone(original);
  later.evidence_id = "c".repeat(64);
  later.payload_sha256 = "d".repeat(64);
  later.observed_trigger_epoch =
    (original.observed_trigger_epoch as number) + 1;
  later.trigger_sequence = (original.trigger_sequence as number) + 1;
  later.observed_trigger_ticks =
    (original.observed_trigger_ticks as number) + 1;
  evidence.push(later);
  await rehashEvidenceAndSelection(value, evidence.length - 1);
  evidence.reverse();
  return canonicalEvidenceId;
}

describe("RD entry v3 wire", () => {
  it("accepts tagged one-candle V3.1 payloads as shadow-only", async () => {
    const result = await validateEntryV3Payload(
      strict(oneCandlePayload()),
      reviewedHashes,
    );

    expect(result.entryBundles[0]!.setup).toMatchObject({
      liquidity_cohort: "ONE_CANDLE",
      one_candle_enabled: true,
      common_fidelity: "DISCRETIONARY",
    });
    expect(result.entryBundles[0]!.evaluation.selection).toMatchObject({
      action: "SHADOW_ONLY",
      reason: "NO_EXACT_CANDIDATE",
      canonical_candidate_id: null,
      canonical_evidence_id: null,
    });
  });

  it.each([
    ["invalidated", "SETUP_INVALIDATED"],
    ["zero-candidate", "NO_CANDIDATE"],
  ] as const)(
    "accepts a Pine-shaped %s one-candle override and derives NONE",
    async (_name, expectedReason) => {
      const value = oneCandlePayload();
      const bundle = (value.setups as Array<Record<string, unknown>>)[0]!;
      if (expectedReason === "SETUP_INVALIDATED") {
        (bundle.setup as Record<string, unknown>).invalidated_before_entry = true;
      } else {
        bundle.candidates = [];
        bundle.evidence = [];
        (bundle.selection_proposal as Record<string, unknown>)
          .candidate_ids_considered = [];
      }

      const result = await validateEntryV3Payload(
        strict(value),
        reviewedHashes,
      );

      expect(result.entryBundles[0]!.evaluation.selection).toMatchObject({
        action: "NONE",
        reason: expectedReason,
        canonical_candidate_id: null,
        canonical_evidence_id: null,
      });
    },
  );

  it.each([
    ["invalidated", "SETUP_INVALIDATED"],
    ["zero-candidate", "NO_CANDIDATE"],
  ] as const)(
    "rejects a concrete-identity %s one-candle alternate terminal",
    async (_name, reason) => {
      const value = await concreteOneCandleNonePayload(reason);
      expect(JSON.stringify(value)).not.toContain("EDGE_DERIVED");

      await expect(
        validateEntryV3Payload(strict(value), reviewedHashes),
      ).rejects.toBeInstanceOf(EntryV3ValidationError);
    },
  );

  it.each([
    ["disabled flag", (setup: Record<string, unknown>) => {
      setup.one_candle_enabled = false;
    }],
    ["exact fidelity", (setup: Record<string, unknown>) => {
      setup.common_fidelity = "EXACT";
    }],
    [
      "paper action",
      (
        _setup: Record<string, unknown>,
        selection: Record<string, unknown>,
      ) => {
        selection.action = "PAPER_ELIGIBLE";
      },
    ],
    [
      "none action",
      (
        _setup: Record<string, unknown>,
        selection: Record<string, unknown>,
      ) => {
        selection.action = "NONE";
      },
    ],
    [
      "alternate reason",
      (
        _setup: Record<string, unknown>,
        selection: Record<string, unknown>,
      ) => {
        selection.reason = "NO_EXACT_CANDIDATE";
      },
    ],
    [
      "canonical pointers",
      (
        _setup: Record<string, unknown>,
        selection: Record<string, unknown>,
      ) => {
        selection.canonical_candidate_id = "EDGE_DERIVED:BOC";
        selection.canonical_evidence_id = "EDGE_DERIVED:BOC";
        selection.canonical_model = "BOC";
      },
    ],
    [
      "fidelity",
      (
        _setup: Record<string, unknown>,
        selection: Record<string, unknown>,
      ) => {
        selection.fidelity = "EXACT";
      },
    ],
    [
      "co-trigger",
      (
        _setup: Record<string, unknown>,
        selection: Record<string, unknown>,
      ) => {
        selection.co_triggered_models = ["BOC"];
      },
    ],
  ])("rejects unsafe one-candle payload: %s", async (_name, mutate) => {
    const value = oneCandlePayload();
    mutate(setupOf(value), selectionOf(value));
    await expect(
      validateEntryV3Payload(strict(value), reviewedHashes),
    ).rejects.toThrow();
  });

  it("normalizes a valid legacy V3.0 setup to the two-plus-candle cohort", async () => {
    const result = await validateEntryV3Payload(
      strict(payload()),
      reviewedHashes,
    );

    expect(result.entryBundles[0]!.setup).toMatchObject({
      liquidity_cohort: "TWO_PLUS_CANDLES",
      one_candle_enabled: false,
    });
  });

  it("rejects a legacy V3.0 setup without normal two-candle proof", async () => {
    const value = payload();
    rule(value, "LIQ_NORMAL_TWO_OPPOSITE_CANDLES").passed = false;

    await expect(
      validateEntryV3Payload(strict(value), reviewedHashes),
    ).rejects.toThrow();
  });

  it("accepts an exact strict BOC bundle", async () => {
    const result = await validateEntryV3Payload(
      strict(payload()),
      reviewedHashes,
    );
    expect(result.entryBundles).toHaveLength(1);
    expect(result.entryBundles[0]!.evaluation.selection.action).toBe(
      "PAPER_ELIGIBLE",
    );
    expect(result.eventRole).toBe("ENTRY_DECISION");
    expect(result.canonicalPayload).not.toHaveProperty("eventRole");
  });

  it("accepts multiple canonical evidence rows and selects the earliest ENTRY_DECISION", async () => {
    const value = payload();
    const expectedEvidenceId = await addLaterExactBocEvidence(value);

    const result = await validateEntryV3Payload(strict(value), reviewedHashes);
    expect(result.eventRole).toBe("ENTRY_DECISION");
    expect(result.entryBundles[0]!.evidence).toHaveLength(2);
    expect(
      result.entryBundles[0]!.evaluation.selection.canonical_evidence_id,
    ).toBe(expectedEvidenceId);
    expect(result.entryBundles[0]!.evaluation.selection.action).toBe(
      "PAPER_ELIGIBLE",
    );
  });

  it("accepts multiple canonical evidence rows and preserves the earliest EXIT_FOLLOWUP entry", async () => {
    const value = laterRealtimeExitPayload("TARGET", 142);
    const expectedEvidenceId = await addLaterExactBocEvidence(value);

    const result = await validateEntryV3Payload(strict(value), reviewedHashes);
    expect(result.eventRole).toBe("EXIT_FOLLOWUP");
    expect(result.entryBundles[0]!.evidence).toHaveLength(2);
    expect(
      result.entryBundles[0]!.evaluation.selection.canonical_evidence_id,
    ).toBe(expectedEvidenceId);
    expect(result.exitEvents[0]!.exit_reason).toBe("TARGET");
  });

  it("rejects a rehashed comma-collision in model source claims", async () => {
    const value = payload();
    const bundle = (value.setups as Array<Record<string, unknown>>)[0]!;
    const candidate = (bundle.candidates as Array<Record<string, unknown>>)[0]!;
    const evidence = (bundle.evidence as Array<Record<string, unknown>>)[0]!;
    const canonicalClaims = candidate.source_claim_ids as string[];
    const collision = [canonicalClaims.join(",")];
    candidate.source_claim_ids = collision;
    evidence.source_claim_ids = collision;
    await rehashEvidenceAndSelection(value, 0);

    await expect(
      validateEntryV3Payload(strict(value), reviewedHashes),
    ).rejects.toBeInstanceOf(EntryV3ValidationError);
  });

  it("routes schema 3.0 through the entry-v3 observation union", async () => {
    const result = await validateObservationEnvelope(
      strict({ credential: "secret", payload: payload() }),
      undefined,
      reviewedHashes,
    );
    expect(result.version).toBe("entry-v3");
    if (result.version === "entry-v3") {
      expect(result.paperCommands).toEqual([]);
      expect(result.eventRole).toBe("ENTRY_DECISION");
      expect(result.entryBundles[0]!.evaluation.selection.canonical_model).toBe(
        "BOC",
      );
    }
  });

  it("routes an UNREVIEWED audit observation without configured hashes", async () => {
    const result = await validateObservationEnvelope(
      strict({ credential: "secret", payload: unreviewedPayload() }),
    );

    expect(result.version).toBe("entry-v3");
    if (result.version === "entry-v3") {
      expect(result.paperCommands).toEqual([]);
      expect(result.entryBundles[0]!.evaluation.selection.action).toBe(
        "SHADOW_ONLY",
      );
    }
  });

  it.each([
    ["unknown top-level key", (value: Record<string, unknown>) => {
      value.broker = "forbidden";
    }],
    ["version mismatch", (value: Record<string, unknown>) => {
      value.strategy_version = "2.0.0-contract2";
    }],
    ["historical realtime evidence", (value: Record<string, unknown>) => {
      value.is_realtime = false;
    }],
    ["invalid stop direction", (value: Record<string, unknown>) => {
      const setup = (value.setups as Array<Record<string, unknown>>)[0]!;
      (setup.trade_plan as Record<string, unknown>).stop_ticks = 112;
    }],
    ["BOC without reference OHLC", (value: Record<string, unknown>) => {
      const setup = (value.setups as Array<Record<string, unknown>>)[0]!;
      const evidence = (setup.evidence as Array<Record<string, unknown>>)[0]!;
      evidence.reference_candle_high_ticks = null;
    }],
    ["duplicate candidate IDs", (value: Record<string, unknown>) => {
      const setup = (value.setups as Array<Record<string, unknown>>)[0]!;
      const candidates = setup.candidates as Array<Record<string, unknown>>;
      candidates.push(structuredClone(candidates[0]!));
    }],
  ])("rejects %s", async (_name, mutate) => {
    const value = payload();
    mutate(value);
    await expect(
      validateEntryV3Payload(strict(value), reviewedHashes),
    ).rejects.toBeInstanceOf(EntryV3ValidationError);
  });

  it.each([
    ["detector", { detector_code_hash: "c".repeat(64) }],
    ["settings", { settings_hash: "c".repeat(64) }],
  ])("retains a reviewed %s hash mismatch for store diagnostics", async (
    _name,
    overrides,
  ) => {
    const result = await validateEntryV3Payload(strict(payload()), {
      ...reviewedHashes,
      ...overrides,
    });
    expect(result.detectorCodeHash).toBe(digest);
    expect(result.settingsHash).toBe("b".repeat(64));
    expect(result.entryBundles[0]?.evaluation.selection.action).toBe(
      "PAPER_ELIGIBLE",
    );
  });

  it("canonicalizes a blocked UNREVIEWED observation without paper promotion", async () => {
    const result = await validateEntryV3Payload(strict(unreviewedPayload()));
    const bundle = result.entryBundles[0]!;

    expect(bundle.evaluation.selection).toMatchObject({
      action: "SHADOW_ONLY",
      canonical_candidate_id: null,
      canonical_evidence_id: null,
      canonical_model: null,
    });
    expect(bundle.candidates.every((candidate) => candidate.state === "BLOCKED"))
      .toBe(true);
    expect(bundle.evidence.every((evidence) => evidence.fidelity !== "EXACT"))
      .toBe(true);
    expect(JSON.stringify(result.canonicalPayload)).not.toContain(
      "EDGE_DERIVED",
    );
    expect(
      bundle.candidates.every((candidate) =>
        /^[a-f0-9]{64}$/u.test(candidate.candidate_id),
      ),
    ).toBe(true);
    expect(
      bundle.evidence.every(
        (evidence) =>
          /^[a-f0-9]{64}$/u.test(evidence.evidence_id) &&
          /^[a-f0-9]{64}$/u.test(evidence.payload_sha256),
      ),
    ).toBe(true);
    expect(bundle.evaluation.selection.selection_id).toMatch(
      /^[a-f0-9]{64}$/u,
    );
  });

  it.each([
    ["mixed detector sentinel", "UNREVIEWED", reviewedHashes.settings_hash],
    ["mixed settings sentinel", reviewedHashes.detector_code_hash, "UNREVIEWED"],
    ["similar lowercase pair", "unreviewed", "unreviewed"],
    ["similar suffixed pair", "UNREVIEWED-1", "UNREVIEWED-1"],
    ["missing detector hash", undefined, "UNREVIEWED"],
    ["missing settings hash", "UNREVIEWED", undefined],
  ])(
    "rejects %s",
    async (_name, detectorCodeHash, settingsHash) => {
      const value = unreviewedPayload();
      value.detector_code_hash = detectorCodeHash;
      value.settings_hash = settingsHash;

      await expect(
        validateEntryV3Payload(strict(value), reviewedHashes),
      ).rejects.toBeInstanceOf(EntryV3ValidationError);
    },
  );

  it.each(["STOP_LOSS", "TARGET"] as const)(
    "applies short-direction geometry to later realtime %s follow-ups",
    async (exitReason) => {
      const result = await validateEntryV3Payload(
        strict(laterRealtimeShortExitPayload(exitReason)),
        reviewedHashes,
      );

      expect(result.eventRole).toBe("EXIT_FOLLOWUP");
      expect(result.exitEvents[0]!.exit_reason).toBe(exitReason);
    },
  );

  it.each([
    ["a missing common rule", (rules: Array<Record<string, unknown>>) => {
      rules.pop();
    }],
    ["an unknown common rule", (rules: Array<Record<string, unknown>>) => {
      rules[0]!.rule_id = "UNKNOWN_RULE";
    }],
    ["an unsorted common rule set", (rules: Array<Record<string, unknown>>) => {
      [rules[0], rules[1]] = [rules[1]!, rules[0]!];
    }],
  ])("rejects UNREVIEWED with %s", async (_name, mutate) => {
    const value = unreviewedPayload();
    const bundle = (value.setups as Array<Record<string, unknown>>)[0]!;
    const setup = bundle.setup as Record<string, unknown>;
    mutate(setup.common_rule_results as Array<Record<string, unknown>>);

    await expect(
      validateEntryV3Payload(strict(value)),
    ).rejects.toBeInstanceOf(EntryV3ValidationError);
  });

  it("still rejects false common rules in reviewed hash mode", async () => {
    const value = payload();
    const bundle = (value.setups as Array<Record<string, unknown>>)[0]!;
    const setup = bundle.setup as Record<string, unknown>;
    const commonRules = setup.common_rule_results as Array<
      Record<string, unknown>
    >;
    commonRules[0]!.passed = false;

    await expect(
      validateEntryV3Payload(strict(value), reviewedHashes),
    ).rejects.toBeInstanceOf(EntryV3ValidationError);
  });

  it.each([
    ["EXACT common fidelity", (value: Record<string, unknown>) => {
      const bundle = (value.setups as Array<Record<string, unknown>>)[0]!;
      (bundle.setup as Record<string, unknown>).common_fidelity = "EXACT";
    }],
    ["a MATCHED candidate", (value: Record<string, unknown>) => {
      const bundle = (value.setups as Array<Record<string, unknown>>)[0]!;
      (bundle.candidates as Array<Record<string, unknown>>)[0]!.state =
        "MATCHED";
    }],
    ["EXACT evidence", (value: Record<string, unknown>) => {
      const bundle = (value.setups as Array<Record<string, unknown>>)[0]!;
      const evidence = (bundle.evidence as Array<Record<string, unknown>>)[0]!;
      evidence.fidelity = "EXACT";
      evidence.passed_rule_ids = ["ENTRY_BOC_HTF_TIMED"];
      evidence.failed_rule_ids = [];
    }],
    ["a passed model rule", (value: Record<string, unknown>) => {
      const bundle = (value.setups as Array<Record<string, unknown>>)[0]!;
      const evidence = (bundle.evidence as Array<Record<string, unknown>>)[0]!;
      evidence.passed_rule_ids = ["ENTRY_BOC_HTF_TIMED"];
    }],
    ["an exact selection reason", (value: Record<string, unknown>) => {
      const bundle = (value.setups as Array<Record<string, unknown>>)[0]!;
      const selection = bundle.selection_proposal as Record<string, unknown>;
      selection.reason = "ONLY_EXACT_TRIGGER";
    }],
    ["a canonical paper selection", (value: Record<string, unknown>) => {
      const bundle = (value.setups as Array<Record<string, unknown>>)[0]!;
      const selection = bundle.selection_proposal as Record<string, unknown>;
      selection.canonical_candidate_id = "EDGE_DERIVED:BOC";
      selection.canonical_evidence_id = "EDGE_DERIVED:BOC";
      selection.canonical_model = "BOC";
      selection.reason = "ONLY_EXACT_TRIGGER";
      selection.fidelity = "EXACT";
      selection.action = "PAPER_ELIGIBLE";
    }],
  ])("rejects UNREVIEWED promotion via %s", async (_name, mutate) => {
    const value = unreviewedPayload();
    mutate(value);

    await expect(
      validateEntryV3Payload(strict(value)),
    ).rejects.toBeInstanceOf(EntryV3ValidationError);
  });

  it("accepts historical same-bar ambiguity only as non-economic exit audit", async () => {
    const value = historicalAmbiguousExitPayload();
    const result = await validateEntryV3Payload(strict(value), reviewedHashes);

    expect(result.exitEvents).toEqual([
      expect.objectContaining({
        exit_reason: "AMBIGUOUS_SAME_BAR_EXIT",
        epoch: result.marketEvent.epoch,
        sequence: result.marketEvent.sequence,
        price_ticks: result.marketEvent.tick_price_ticks,
      }),
    ]);
    expect(result.eventRole).toBe("EXIT_FOLLOWUP");
    expect(result.entryBundles[0]!.evaluation.selection).toMatchObject({
      action: "SHADOW_ONLY",
      canonical_candidate_id: null,
      canonical_evidence_id: null,
      canonical_model: null,
    });
  });

  it("accepts a later exact-paper ambiguity as an exit-only follow-up", async () => {
    const result = await validateObservationEnvelope(
      strict({
        credential: "secret",
        payload: laterExactPaperAmbiguousExitPayload(),
      }),
      undefined,
      reviewedHashes,
    );

    expect(result.version).toBe("entry-v3");
    if (result.version === "entry-v3") {
      expect(result.eventRole).toBe("EXIT_FOLLOWUP");
      expect(result.paperCommands).toEqual([]);
      expect(result.canonicalPayload).not.toHaveProperty("eventRole");
      expect(result.entryBundles[0]!.evaluation.selection.action).toBe(
        "PAPER_ELIGIBLE",
      );
      expect(result.exitEvents[0]!.exit_reason).toBe(
        "AMBIGUOUS_SAME_BAR_EXIT",
      );
    }
  });

  it.each([
    ["STOP_LOSS", 95],
    ["TARGET", 142],
  ] as const)(
    "accepts a later realtime %s follow-up without reopening paper intent",
    async (exitReason, priceTicks) => {
      const value = laterRealtimeExitPayload(exitReason, priceTicks);
      const result = await validateObservationEnvelope(
        strict({ credential: "secret", payload: value }),
        undefined,
        reviewedHashes,
      );

      expect(result.version).toBe("entry-v3");
      if (result.version === "entry-v3") {
        expect(result.eventRole).toBe("EXIT_FOLLOWUP");
        expect(result.paperCommands).toEqual([]);
        expect(result.entryBundles[0]!.evaluation.selection.action).toBe(
          "PAPER_ELIGIBLE",
        );
        expect(result.exitEvents[0]!.exit_reason).toBe(exitReason);
      }
    },
  );

  it("keeps an unlinked setup follow-up as Task 3 audit metadata only", async () => {
    const result = await validateObservationEnvelope(
      strict({
        credential: "secret",
        payload: laterRealtimeExitPayload("STOP_LOSS", 95),
      }),
      undefined,
      reviewedHashes,
    );

    expect(result.version).toBe("entry-v3");
    if (result.version === "entry-v3") {
      expect(result.eventRole).toBe("EXIT_FOLLOWUP");
      expect(result.exitEvents[0]!.setup_id).toBe("setup-strict-long");
      expect(result.paperCommands).toEqual([]);
    }
  });

  it.each([
    ["STOP_LOSS", 97],
    ["TARGET", 140],
  ] as const)(
    "rejects a realtime %s follow-up on the wrong side of its level",
    async (exitReason, priceTicks) => {
      await expect(
        validateEntryV3Payload(
          strict(laterRealtimeExitPayload(exitReason, priceTicks)),
          reviewedHashes,
        ),
      ).rejects.toBeInstanceOf(EntryV3ValidationError);
    },
  );

  it.each(["STOP_LOSS", "TARGET"] as const)(
    "rejects historical dual-hit bars claiming %s instead of ambiguity",
    async (exitReason) => {
      const value = laterExactPaperAmbiguousExitPayload();
      (value.exit_events as Array<Record<string, unknown>>)[0] = {
        event_id: `setup-strict-long:exit:${exitReason}:9`,
        setup_id: "setup-strict-long",
        exit_reason: exitReason,
        epoch: 2700,
        sequence: 9,
        price_ticks: 111,
      };

      await expect(
        validateEntryV3Payload(strict(value), reviewedHashes),
      ).rejects.toBeInstanceOf(EntryV3ValidationError);
    },
  );

  it("rejects a historical stop/target exit without a confirmed 5m bar", async () => {
    const value = laterRealtimeExitPayload("STOP_LOSS", 95);
    value.is_realtime = false;

    await expect(
      validateEntryV3Payload(strict(value), reviewedHashes),
    ).rejects.toBeInstanceOf(EntryV3ValidationError);
  });

  it("uses the realtime close tick rather than the bar range for an exit claim", async () => {
    const value = laterRealtimeExitPayload("STOP_LOSS", 111);
    value.market_event = {
      epoch: 3000,
      sequence: 8,
      tick_price_ticks: 111,
      barstate_isconfirmed: true,
      confirmed_bar: {
        open_epoch: 2700,
        close_epoch: 3000,
        open_ticks: 112,
        high_ticks: 145,
        low_ticks: 90,
        close_ticks: 111,
      },
    };
    const exitEvent = (value.exit_events as Array<Record<string, unknown>>)[0]!;
    exitEvent.price_ticks = 111;

    await expect(
      validateEntryV3Payload(strict(value), reviewedHashes),
    ).rejects.toBeInstanceOf(EntryV3ValidationError);
  });

  it.each([
    ["epoch", 2999],
    ["sequence", 9],
    ["price_ticks", 94],
  ] as const)(
    "rejects an exit whose %s does not bind the current market event",
    async (field, replacement) => {
      const value = laterRealtimeExitPayload("STOP_LOSS", 95);
      const exitEvent = (value.exit_events as Array<Record<string, unknown>>)[0]!;
      exitEvent[field] = replacement;

      await expect(
        validateEntryV3Payload(strict(value), reviewedHashes),
      ).rejects.toBeInstanceOf(EntryV3ValidationError);
    },
  );

  it("rejects an exit before the selected trigger", async () => {
    const value = laterRealtimeExitPayload("STOP_LOSS", 95);
    value.market_event = {
      epoch: 1800,
      sequence: 8,
      tick_price_ticks: 95,
      barstate_isconfirmed: false,
      confirmed_bar: null,
    };
    const exitEvent = (value.exit_events as Array<Record<string, unknown>>)[0]!;
    exitEvent.epoch = 1800;

    await expect(
      validateEntryV3Payload(strict(value), reviewedHashes),
    ).rejects.toBeInstanceOf(EntryV3ValidationError);
  });

  it("rejects an exit follow-up carrying an unrelated setup bundle", async () => {
    const value = laterRealtimeExitPayload("STOP_LOSS", 95);
    const unrelated = payloadFor("strict_short_boc_only");
    (value.setups as Array<Record<string, unknown>>).push(
      (unrelated.setups as Array<Record<string, unknown>>)[0]!,
    );

    await expect(
      validateEntryV3Payload(strict(value), reviewedHashes),
    ).rejects.toBeInstanceOf(EntryV3ValidationError);
  });

  it.each([
    ["duplicate", (events: Array<Record<string, unknown>>) => {
      events.push(structuredClone(events[0]!));
    }],
    ["conflicting", (events: Array<Record<string, unknown>>) => {
      events.push({
        ...events[0],
        event_id: "setup-strict-long:exit:TARGET:8",
        exit_reason: "TARGET",
      });
    }],
  ])("rejects %s exit events for one setup", async (_name, mutate) => {
    const value = laterRealtimeExitPayload("STOP_LOSS", 95);
    mutate(value.exit_events as Array<Record<string, unknown>>);

    await expect(
      validateEntryV3Payload(strict(value), reviewedHashes),
    ).rejects.toBeInstanceOf(EntryV3ValidationError);
  });

  it("rejects one exit event ID mapped to two setup bundles", async () => {
    const value = laterRealtimeExitPayload("STOP_LOSS", 95);
    const second = payload();
    const secondBundle = (
      second.setups as Array<Record<string, unknown>>
    )[0]!;
    const secondSetup = secondBundle.setup as Record<string, unknown>;
    secondSetup.setup_id = "setup-strict-long-unlinked";
    for (const candidate of secondBundle.candidates as Array<
      Record<string, unknown>
    >) {
      candidate.setup_id = secondSetup.setup_id;
    }
    (secondBundle.selection_proposal as Record<string, unknown>).setup_id =
      secondSetup.setup_id;
    useEdgeDerivedReferences(second);
    (value.setups as Array<Record<string, unknown>>).push(secondBundle);
    (value.exit_events as Array<Record<string, unknown>>).push({
      event_id: "setup-strict-long:exit:STOP_LOSS:8",
      setup_id: secondSetup.setup_id,
      exit_reason: "STOP_LOSS",
      epoch: 3000,
      sequence: 8,
      price_ticks: 95,
    });

    await expect(
      validateEntryV3Payload(strict(value), reviewedHashes),
    ).rejects.toBeInstanceOf(EntryV3ValidationError);
  });

  it("allows an exact entry candidate and same-event ambiguity only as follow-up audit", async () => {
    const value = payloadFor("opened_selection_is_frozen");
    const marketEvent = value.market_event as Record<string, unknown>;
    const confirmedBar = marketEvent.confirmed_bar as Record<string, unknown>;
    const bundle = (value.setups as Array<Record<string, unknown>>)[0]!;
    const plan = bundle.trade_plan as Record<string, unknown>;
    confirmedBar.high_ticks = (plan.target_ticks as number) + 1;
    confirmedBar.low_ticks = (plan.stop_ticks as number) - 1;
    value.exit_events = [
      {
        event_id: "setup-opened-frozen:exit:AMBIGUOUS_SAME_BAR_EXIT:0",
        setup_id: "setup-opened-frozen",
        exit_reason: "AMBIGUOUS_SAME_BAR_EXIT",
        epoch: marketEvent.epoch,
        sequence: marketEvent.sequence,
        price_ticks: marketEvent.tick_price_ticks,
      },
    ];

    const result = await validateEntryV3Payload(strict(value), reviewedHashes);

    expect(result.eventRole).toBe("EXIT_FOLLOWUP");
    expect(result.entryBundles[0]!.evaluation.selection.action).toBe(
      "PAPER_ELIGIBLE",
    );
  });

  it.each(["STOP_LOSS", "TARGET"] as const)(
    "rejects an exit for an unknown setup even when %s is otherwise shaped",
    async (exitReason) => {
      const value = laterRealtimeExitPayload(
        exitReason,
        exitReason === "STOP_LOSS" ? 95 : 142,
      );
      const event = (value.exit_events as Array<Record<string, unknown>>)[0]!;
      event.setup_id = "unknown-setup";
      event.event_id = `unknown-setup:exit:${exitReason}:8`;

      await expect(
        validateEntryV3Payload(strict(value), reviewedHashes),
      ).rejects.toBeInstanceOf(EntryV3ValidationError);
    },
  );

  it.each(["STOP_LOSS", "TARGET"] as const)(
    "accepts a confirmed historical single-hit %s follow-up",
    async (exitReason) => {
      const value = laterExactPaperAmbiguousExitPayload();
      const marketEvent = value.market_event as Record<string, unknown>;
      const bar = marketEvent.confirmed_bar as Record<string, unknown>;
      if (exitReason === "STOP_LOSS") {
        bar.high_ticks = 130;
      } else {
        bar.low_ticks = 100;
      }
      (value.exit_events as Array<Record<string, unknown>>)[0] = {
        event_id: `setup-strict-long:exit:${exitReason}:9`,
        setup_id: "setup-strict-long",
        exit_reason: exitReason,
        epoch: 2700,
        sequence: 9,
        price_ticks: 111,
      };

      const result = await validateEntryV3Payload(strict(value), reviewedHashes);
      expect(result.eventRole).toBe("EXIT_FOLLOWUP");
      expect(result.exitEvents[0]!.exit_reason).toBe(exitReason);
    },
  );

  it("preserves entry-decision authoritative market-event binding", async () => {
    const value = payload();
    (value.market_event as Record<string, unknown>).epoch = 1802;

    await expect(
      validateEntryV3Payload(strict(value), reviewedHashes),
    ).rejects.toBeInstanceOf(EntryV3ValidationError);
  });

  it.each(["STOP_LOSS", "TARGET"] as const)(
    "preserves exact %s exit parsing only with causal validation",
    async (exitReason) => {
      const value = laterRealtimeExitPayload(
        exitReason,
        exitReason === "STOP_LOSS" ? 95 : 142,
      );
      value.exit_events = [
        {
          event_id: `setup-strict-long:exit:${exitReason}:8`,
          setup_id: "setup-strict-long",
          exit_reason: exitReason,
          epoch: 3000,
          sequence: 8,
          price_ticks: exitReason === "STOP_LOSS" ? 95 : 142,
        },
      ];

      const result = await validateEntryV3Payload(
        strict(value),
        reviewedHashes,
      );
      expect(result.exitEvents[0]!.exit_reason).toBe(exitReason);
    },
  );

  it.each([
    ["a realtime payload", (value: Record<string, unknown>) => {
      value.is_realtime = true;
    }],
    ["no confirmed historical bar", (value: Record<string, unknown>) => {
      const marketEvent = value.market_event as Record<string, unknown>;
      marketEvent.barstate_isconfirmed = false;
      marketEvent.confirmed_bar = null;
    }],
    ["a bar missing the target", (value: Record<string, unknown>) => {
      const marketEvent = value.market_event as Record<string, unknown>;
      const confirmedBar = marketEvent.confirmed_bar as Record<string, unknown>;
      confirmedBar.high_ticks = 120;
    }],
    ["a noncanonical epoch", (value: Record<string, unknown>) => {
      const exitEvent = (value.exit_events as Array<Record<string, unknown>>)[0]!;
      exitEvent.epoch = (exitEvent.epoch as number) - 1;
    }],
    ["a noncanonical sequence", (value: Record<string, unknown>) => {
      const exitEvent = (value.exit_events as Array<Record<string, unknown>>)[0]!;
      exitEvent.sequence = (exitEvent.sequence as number) + 1;
    }],
    ["a selected exit price", (value: Record<string, unknown>) => {
      const exitEvent = (value.exit_events as Array<Record<string, unknown>>)[0]!;
      exitEvent.price_ticks = 101;
    }],
    ["an unknown setup", (value: Record<string, unknown>) => {
      const exitEvent = (value.exit_events as Array<Record<string, unknown>>)[0]!;
      exitEvent.setup_id = "unknown-setup";
    }],
  ])("rejects ambiguous exit audit with %s", async (_name, mutate) => {
    const value = historicalAmbiguousExitPayload();
    mutate(value);

    await expect(
      validateEntryV3Payload(strict(value), reviewedHashes),
    ).rejects.toBeInstanceOf(EntryV3ValidationError);
  });

  it("rejects a rehashed BOC that does not break the reference candle", async () => {
    const value = payload();
    const setup = (value.setups as Array<Record<string, unknown>>)[0]!;
    const evidence = (setup.evidence as Array<Record<string, unknown>>)[0]!;
    evidence.observed_trigger_ticks = evidence.reference_candle_high_ticks;
    (value.market_event as Record<string, unknown>).tick_price_ticks =
      evidence.reference_candle_high_ticks;
    (setup.trade_plan as Record<string, unknown>).entry_ticks =
      evidence.reference_candle_high_ticks;
    (setup.trade_plan as Record<string, unknown>).stop_ticks =
      (evidence.reference_candle_high_ticks as number) - 10;
    (setup.trade_plan as Record<string, unknown>).target_ticks =
      (evidence.reference_candle_high_ticks as number) + 20;
    await rehashEvidenceAndSelection(value, 0);

    await expect(
      validateEntryV3Payload(strict(value), reviewedHashes),
    ).rejects.toBeInstanceOf(EntryV3ValidationError);
  });

  it("rejects an exact directional close that does not clear the zone", async () => {
    const value = payloadFor("opened_selection_is_frozen");
    const setup = (
      (value.setups as Array<Record<string, unknown>>)[0]!.setup as Record<
        string,
        unknown
      >
    );
    const market = value.market_event as {
      confirmed_bar: { close_ticks: number };
    };
    setup.zone_top_ticks = market.confirmed_bar.close_ticks + 1;

    await expect(
      validateEntryV3Payload(strict(value), reviewedHashes),
    ).rejects.toBeInstanceOf(EntryV3ValidationError);
  });

  it("rejects an exact HTF flip whose contact is outside the setup zone", async () => {
    const value = payloadFor("flip_before_boc");
    const bundle = (value.setups as Array<Record<string, unknown>>)[0]!;
    const setup = bundle.setup as Record<string, unknown>;
    const flipEvidence = (
      bundle.evidence as Array<Record<string, unknown>>
    ).find((item) => item.htf_open_ticks !== null)!;
    const contact = flipEvidence.contact_candle as { high_ticks: number };
    setup.zone_bottom_ticks = contact.high_ticks + 1;
    setup.zone_top_ticks = contact.high_ticks + 10;

    await expect(
      validateEntryV3Payload(strict(value), reviewedHashes),
    ).rejects.toBeInstanceOf(EntryV3ValidationError);
  });

  it("rejects a rehashed BOC candidate whose event anchor differs from its reference", async () => {
    const value = payload();
    const bundle = (value.setups as Array<Record<string, unknown>>)[0]!;
    const candidate = (bundle.candidates as Array<Record<string, unknown>>)[0]!;
    candidate.event_anchor_epoch =
      (candidate.reference_candle_open_epoch as number) + 300;
    await rehashCandidateGraph(value, 0);

    await expect(
      validateEntryV3Payload(strict(value), reviewedHashes),
    ).rejects.toBeInstanceOf(EntryV3ValidationError);
  });

  it("rejects a fully rehashed BOC reference that is not five-minute aligned", async () => {
    const value = payload();
    const bundle = (value.setups as Array<Record<string, unknown>>)[0]!;
    const candidate = (bundle.candidates as Array<Record<string, unknown>>)[0]!;
    const evidence = (bundle.evidence as Array<Record<string, unknown>>)[0]!;
    candidate.event_anchor_epoch = 901;
    candidate.reference_candle_open_epoch = 901;
    evidence.reference_candle_open_epoch = 901;
    await rehashCandidateGraph(value, 0);

    await expect(
      validateEntryV3Payload(strict(value), reviewedHashes),
    ).rejects.toBeInstanceOf(EntryV3ValidationError);
  });

  it("rejects a rehashed directional-close anchor that differs from the confirmed bar", async () => {
    const value = payloadFor("opened_selection_is_frozen");
    const bundle = (value.setups as Array<Record<string, unknown>>)[0]!;
    const candidate = (bundle.candidates as Array<Record<string, unknown>>)[0]!;
    candidate.event_anchor_epoch =
      ((value.market_event as {
        confirmed_bar: { open_epoch: number };
      }).confirmed_bar.open_epoch as number) + 1;
    await rehashCandidateGraph(value, 0);

    await expect(
      validateEntryV3Payload(strict(value), reviewedHashes),
    ).rejects.toBeInstanceOf(EntryV3ValidationError);
  });

  it.each([
    ["boc tier", "boc_tier", "UNKNOWN_TIER"],
    ["ambiguity code", "ambiguity_codes", ["UNKNOWN_AMBIGUITY"]],
  ])("rejects an unknown %s", async (_name, field, replacement) => {
    const value = payload();
    const bundle = (value.setups as Array<Record<string, unknown>>)[0]!;
    const evidence = (bundle.evidence as Array<Record<string, unknown>>)[0]!;
    evidence[field] = replacement;
    if (field === "boc_tier") {
      (bundle.candidates as Array<Record<string, unknown>>)[0]!.boc_tier =
        replacement;
    }
    await expect(
      validateEntryV3Payload(strict(value), reviewedHashes),
    ).rejects.toBeInstanceOf(EntryV3ValidationError);
  });

  it("enforces the raw 35,000-character boundary", () => {
    expect(() =>
      validateEntryV3BodySize(
        new TextEncoder().encode(
          " ".repeat(ENTRY_V3_MAX_PAYLOAD_CHARACTERS - 1),
        ),
      ),
    ).not.toThrow();
    expect(() =>
      validateEntryV3BodySize(
        new TextEncoder().encode(" ".repeat(ENTRY_V3_MAX_PAYLOAD_CHARACTERS)),
      ),
    ).toThrow(EntryV3ValidationError);
  });

  it("rejects a whitespace-inflated raw schema-3 body", async () => {
    const compact = JSON.stringify({
      credential: "secret",
      payload: payload(),
    });
    const inflated = `${compact.slice(0, -1)}${" ".repeat(35_000)}}`;
    await expect(
      validateObservationEnvelope(
        parseStrictJson(new TextEncoder().encode(inflated)),
        new TextEncoder().encode(inflated),
        reviewedHashes,
      ),
    ).rejects.toBeInstanceOf(EntryV3ValidationError);
  });

  it("canonicalizes a Pine-shaped strict BOC bundle to the Python oracle", async () => {
    const value = payloadFor("strict_long_boc_only");
    useEdgeDerivedReferences(value);
    const result = await validateEntryV3Payload(
      strict(value),
      reviewedHashes,
    );
    const expected = vectorDocument.cases.find(
      (item) => item.case_id === "strict_long_boc_only",
    )!.expected;

    expect(result.entryBundles[0]!.evaluation).toEqual(expected);
    expect(JSON.stringify(result.canonicalPayload)).not.toContain(
      "EDGE_DERIVED",
    );
  });

  it("ignores a forged Pine selection and derives shadow semantics", async () => {
    const value = payloadFor("discretionary_boc_shadow");
    useEdgeDerivedReferences(value);
    const bundle = (value.setups as Array<Record<string, unknown>>)[0]!;
    bundle.selection_proposal = {
      ...(bundle.selection_proposal as Record<string, unknown>),
      selection_id: "EDGE_DERIVED",
      canonical_candidate_id: "EDGE_DERIVED:BOC",
      canonical_evidence_id: "EDGE_DERIVED:BOC",
      canonical_model: "BOC",
      reason: "ONLY_EXACT_TRIGGER",
      fidelity: "EXACT",
      action: "PAPER_ELIGIBLE",
      co_triggered_models: [],
    };

    const result = await validateEntryV3Payload(
      strict(value),
      reviewedHashes,
    );
    expect(result.entryBundles[0]!.evaluation.selection).toMatchObject({
      canonical_candidate_id: null,
      canonical_evidence_id: null,
      canonical_model: null,
      reason: "NO_EXACT_CANDIDATE",
      fidelity: null,
      action: "SHADOW_ONLY",
    });
  });

  it("rejects an EDGE_DERIVED candidate-model collision", async () => {
    const value = payload();
    useEdgeDerivedReferences(value);
    const bundle = (value.setups as Array<Record<string, unknown>>)[0]!;
    const candidates = bundle.candidates as Array<Record<string, unknown>>;
    candidates.push(structuredClone(candidates[0]!));

    await expect(
      validateEntryV3Payload(strict(value), reviewedHashes),
    ).rejects.toBeInstanceOf(EntryV3ValidationError);
  });

  it.each([
    ["wrong model reference", "EDGE_DERIVED:HTF_FLIP"],
    ["malformed reference", "EDGE_DERIVED:BOC:EXTRA"],
  ])("rejects a Pine candidate with %s", async (_name, reference) => {
    const value = payload();
    useEdgeDerivedReferences(value);
    const bundle = (value.setups as Array<Record<string, unknown>>)[0]!;
    (bundle.candidates as Array<Record<string, unknown>>)[0]!.candidate_id =
      reference;

    await expect(
      validateEntryV3Payload(strict(value), reviewedHashes),
    ).rejects.toBeInstanceOf(EntryV3ValidationError);
  });

  it("rejects mixed canonical and EDGE_DERIVED identity claims", async () => {
    const value = payload();
    const originalCandidateId = (
      (
        (value.setups as Array<Record<string, unknown>>)[0]!
          .candidates as Array<Record<string, unknown>>
      )[0]!.candidate_id
    );
    useEdgeDerivedReferences(value);
    const bundle = (value.setups as Array<Record<string, unknown>>)[0]!;
    (bundle.candidates as Array<Record<string, unknown>>)[0]!.candidate_id =
      originalCandidateId;

    await expect(
      validateEntryV3Payload(strict(value), reviewedHashes),
    ).rejects.toBeInstanceOf(EntryV3ValidationError);
  });
});
