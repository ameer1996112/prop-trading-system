import { describe, expect, it } from "vitest";

import { validateEntryV3Payload } from "../src/rd-entry-wire-v3";
import { parseStrictJson } from "../src/strict-json";
import { validateObservationEnvelope } from "../src/validation";

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

const bocClaims = [
  "discretionary-break-2025-11",
  "reject-non-htf-break-2026-05",
  "htf-timed-boc-2026-06",
];

const flipClaims = [
  "htf-flip-2024-03",
  "htf-context-set-2025-08",
  "htf-flip-definition-2025-08",
  "pure-flip-narrowing-2026-05",
  "model-continuation-2026-07",
];

const closeClaims = [
  "standard-close-2024-03",
  "closure-or-flip-2025-03",
  "directional-close-2025-08",
  "directional-close-required-2026-06",
  "model-continuation-2026-07",
];

function strict(value: unknown) {
  return parseStrictJson(new TextEncoder().encode(JSON.stringify(value)));
}

function pineSerializedEnvelope(
  credential: string,
  payload: Record<string, unknown>,
): Uint8Array {
  return new TextEncoder().encode(
    `{"credential":${JSON.stringify(credential)},"payload":${JSON.stringify(payload)}}`,
  );
}

function commonRules(falseRule?: (typeof requiredRuleIds)[number]) {
  return requiredRuleIds.map((rule_id) => ({
    rule_id,
    passed: rule_id !== falseRule,
  }));
}

function bocCandidate(setupId: string, state: "MATCHED" | "BLOCKED") {
  return {
    candidate_id: "EDGE_DERIVED:BOC",
    setup_id: setupId,
    model: "BOC",
    state,
    direction: "LONG",
    event_anchor_epoch: 900,
    trigger_ordinal: 1,
    boc_tier: "HTF_TIMED",
    reference_candle_open_epoch: 900,
    source_claim_ids: bocClaims,
    observed_at_epoch: 2702,
  };
}

function exactBocEvidence(setupId: string) {
  void setupId;
  return {
    evidence_id: "EDGE_DERIVED:BOC",
    candidate_id: "EDGE_DERIVED:BOC",
    observed_trigger_epoch: 2702,
    trigger_sequence: 5,
    observed_trigger_ticks: 111,
    htf_context_minutes: [15],
    fidelity: "EXACT",
    proof_plane: "REALTIME_TICK",
    replayability: "LIVE_EXACT_NON_REPLAYABLE",
    coverage_start_epoch: 2700,
    coverage_end_epoch: 2702,
    ambiguity_codes: [],
    boc_tier: "HTF_TIMED",
    reference_candle_open_epoch: 900,
    reference_candle_open_ticks: 105,
    reference_candle_high_ticks: 110,
    reference_candle_low_ticks: 100,
    reference_candle_close_ticks: 102,
    htf_open_ticks: null,
    contact_candle: null,
    recross_candle: null,
    coverage_gap_detected: null,
    full_lifecycle_ordered: null,
    destination_seen_before_contact: null,
    passed_rule_ids: ["ENTRY_BOC_HTF_TIMED"],
    failed_rule_ids: [],
    source_claim_ids: bocClaims,
    payload_sha256: "EDGE_DERIVED",
    observed_at_epoch: 2702,
  };
}

function closeCandidate(setupId: string) {
  return {
    candidate_id: "EDGE_DERIVED:DIR_CLOSE",
    setup_id: setupId,
    model: "DIR_CLOSE",
    state: "MATCHED",
    direction: "LONG",
    event_anchor_epoch: 2400,
    trigger_ordinal: 1,
    boc_tier: null,
    reference_candle_open_epoch: null,
    source_claim_ids: closeClaims,
    observed_at_epoch: 2700,
  };
}

function exactCloseEvidence() {
  return {
    evidence_id: "EDGE_DERIVED:DIR_CLOSE",
    candidate_id: "EDGE_DERIVED:DIR_CLOSE",
    observed_trigger_epoch: 2700,
    trigger_sequence: 0,
    observed_trigger_ticks: 111,
    htf_context_minutes: [],
    fidelity: "EXACT",
    proof_plane: "CONFIRMED_5M",
    replayability: "REPLAYABLE",
    coverage_start_epoch: 2400,
    coverage_end_epoch: 2700,
    ambiguity_codes: [],
    boc_tier: null,
    reference_candle_open_epoch: null,
    reference_candle_open_ticks: null,
    reference_candle_high_ticks: null,
    reference_candle_low_ticks: null,
    reference_candle_close_ticks: null,
    htf_open_ticks: null,
    contact_candle: null,
    recross_candle: null,
    coverage_gap_detected: null,
    full_lifecycle_ordered: null,
    destination_seen_before_contact: null,
    passed_rule_ids: ["ENTRY_DIR_CLOSE"],
    failed_rule_ids: [],
    source_claim_ids: closeClaims,
    payload_sha256: "EDGE_DERIVED",
    observed_at_epoch: 2700,
  };
}

function flipCandidate(setupId: string) {
  return {
    candidate_id: "EDGE_DERIVED:HTF_FLIP",
    setup_id: setupId,
    model: "HTF_FLIP",
    state: "MATCHED",
    direction: "LONG",
    event_anchor_epoch: 1800,
    trigger_ordinal: 1,
    boc_tier: null,
    reference_candle_open_epoch: null,
    source_claim_ids: flipClaims,
    observed_at_epoch: 2702,
  };
}

function exactFlipEvidence() {
  return {
    evidence_id: "EDGE_DERIVED:HTF_FLIP",
    candidate_id: "EDGE_DERIVED:HTF_FLIP",
    observed_trigger_epoch: 2702,
    trigger_sequence: 5,
    observed_trigger_ticks: 111,
    htf_context_minutes: [30],
    fidelity: "EXACT",
    proof_plane: "REALTIME_TICK",
    replayability: "LIVE_EXACT_NON_REPLAYABLE",
    coverage_start_epoch: 1800,
    coverage_end_epoch: 2702,
    ambiguity_codes: [],
    boc_tier: null,
    reference_candle_open_epoch: null,
    reference_candle_open_ticks: null,
    reference_candle_high_ticks: null,
    reference_candle_low_ticks: null,
    reference_candle_close_ticks: null,
    htf_open_ticks: 110,
    contact_candle: {
      open_epoch: 2100,
      close_epoch: 2400,
      open_ticks: 105,
      high_ticks: 110,
      low_ticks: 100,
      close_ticks: 105,
    },
    recross_candle: {
      open_epoch: 2701,
      close_epoch: 2702,
      open_ticks: 110,
      high_ticks: 112,
      low_ticks: 109,
      close_ticks: 111,
    },
    coverage_gap_detected: false,
    full_lifecycle_ordered: true,
    destination_seen_before_contact: false,
    passed_rule_ids: ["ENTRY_HTF_FLIP"],
    failed_rule_ids: [],
    source_claim_ids: flipClaims,
    payload_sha256: "EDGE_DERIVED",
    observed_at_epoch: 2702,
  };
}

function payloadEnvelope(
  setupId: string,
  candidates: Array<Record<string, unknown>>,
  evidence: Array<Record<string, unknown>>,
  selection: Record<string, unknown>,
  options: {
    detectorHash?: string;
    settingsHash?: string;
    commonFidelity?: "EXACT" | "UNRESOLVED";
    falseRule?: (typeof requiredRuleIds)[number];
    isRealtime?: boolean;
    marketEvent?: Record<string, unknown>;
    exitEvents?: Array<Record<string, unknown>>;
    observedAtEpoch?: number;
    entryTicks?: number;
  } = {},
) {
  const entryTicks = options.entryTicks ?? 111;
  return {
    schema_version: "3.0",
    strategy_id: "rd_liquidity_sd_5m_v1",
    strategy_version: "3.0.0-contract3",
    rule_contract_version: "3.0.0",
    execution_mode: "PAPER_ONLY",
    producer_instance_id: "pine-v3-independent-fixture",
    producer_sequence: 5,
    event_id: `pine-v3-independent-fixture:${setupId}`,
    is_realtime: options.isRealtime ?? true,
    symbol: "EURUSD",
    ticker_id: "OANDA:EURUSD",
    feed: "OANDA",
    timeframe: "5",
    tick_size: "0.00001",
    detector_code_hash:
      options.detectorHash ?? reviewedHashes.detector_code_hash,
    settings_hash: options.settingsHash ?? reviewedHashes.settings_hash,
    observed_at_epoch: options.observedAtEpoch ?? 2702,
    market_event: options.marketEvent ?? {
      epoch: 2702,
      sequence: 5,
      tick_price_ticks: entryTicks,
      barstate_isconfirmed: false,
      confirmed_bar: null,
    },
    exit_events: options.exitEvents ?? [],
    setups: [
      {
        setup: {
          setup_id: setupId,
          direction: "LONG",
          zone_top_ticks: 103,
          zone_bottom_ticks: 97,
          zone_engaged_epoch: 800,
          invalidated_before_entry: false,
          common_fidelity: options.commonFidelity ?? "EXACT",
          common_rule_results: commonRules(options.falseRule),
        },
        candidates,
        evidence,
        selection_proposal: selection,
        trade_plan: {
          direction: "LONG",
          entry_ticks: entryTicks,
          stop_ticks: entryTicks - 10,
          target_ticks: entryTicks + 20,
        },
      },
    ],
  };
}

describe("RD Pine v3 independent raw payload parity", () => {
  it("passes the complete Pine alert envelope through ingress validation", async () => {
    const setupId = "setup-pine-envelope";
    const payload = payloadEnvelope(
      setupId,
      [bocCandidate(setupId, "MATCHED")],
      [exactBocEvidence(setupId)],
      {
        selection_id: "EDGE_DERIVED",
        setup_id: setupId,
        policy_version: "rd-entry-arbitration-v3",
        revision: 5,
        candidate_ids_considered: ["EDGE_DERIVED:BOC"],
        canonical_candidate_id: "EDGE_DERIVED:BOC",
        canonical_evidence_id: "EDGE_DERIVED:BOC",
        canonical_model: "BOC",
        reason: "ONLY_EXACT_TRIGGER",
        fidelity: "EXACT",
        action: "PAPER_ELIGIBLE",
        co_triggered_models: [],
        evaluated_at_epoch: 2702,
      },
    );
    const credential = 'pine-"quoted"\\credential';
    const raw = pineSerializedEnvelope(credential, payload);

    const observation = await validateObservationEnvelope(
      parseStrictJson(raw),
      raw,
      reviewedHashes,
    );

    expect(observation.version).toBe("entry-v3");
    if (observation.version !== "entry-v3") {
      throw new Error("expected entry-v3 observation");
    }
    expect(observation.credential).toBe(credential);
    expect(observation.entryBundles).toHaveLength(1);
  });

  it("accepts a causally ordered realtime contact and recross in one child candle", async () => {
    const setupId = "setup-same-child-flip";
    const evidence = {
      ...exactFlipEvidence(),
      coverage_start_epoch: 2700,
      contact_candle: {
        open_epoch: 2700,
        close_epoch: 2701,
        open_ticks: 103,
        high_ticks: 108,
        low_ticks: 100,
        close_ticks: 108,
      },
      recross_candle: {
        open_epoch: 2701,
        close_epoch: 2702,
        open_ticks: 108,
        high_ticks: 111,
        low_ticks: 108,
        close_ticks: 111,
      },
    };
    const payload = payloadEnvelope(
      setupId,
      [flipCandidate(setupId)],
      [evidence],
      {
        selection_id: "EDGE_DERIVED",
        setup_id: setupId,
        policy_version: "rd-entry-arbitration-v3",
        revision: 5,
        candidate_ids_considered: ["EDGE_DERIVED:HTF_FLIP"],
        canonical_candidate_id: "EDGE_DERIVED:HTF_FLIP",
        canonical_evidence_id: "EDGE_DERIVED:HTF_FLIP",
        canonical_model: "HTF_FLIP",
        reason: "ONLY_EXACT_TRIGGER",
        fidelity: "EXACT",
        action: "PAPER_ELIGIBLE",
        co_triggered_models: [],
        evaluated_at_epoch: 2702,
      },
    );

    const parsed = await validateEntryV3Payload(strict(payload), reviewedHashes);

    expect(parsed.entryBundles[0]!.evaluation.selection.canonical_model).toBe(
      "HTF_FLIP",
    );
    expect(parsed.entryBundles[0]!.evidence[0]).toMatchObject({
      fidelity: "EXACT",
      full_lifecycle_ordered: true,
      coverage_gap_detected: false,
    });
  });

  it("rejects an exact same-atomic-tick flip transcript", async () => {
    const setupId = "setup-same-tick-flip";
    const evidence = {
      ...exactFlipEvidence(),
      contact_candle: {
        open_epoch: 2701,
        close_epoch: 2702,
        open_ticks: 103,
        high_ticks: 111,
        low_ticks: 100,
        close_ticks: 111,
      },
      recross_candle: {
        open_epoch: 2702,
        close_epoch: 2702,
        open_ticks: 111,
        high_ticks: 111,
        low_ticks: 111,
        close_ticks: 111,
      },
    };
    const payload = payloadEnvelope(
      setupId,
      [flipCandidate(setupId)],
      [evidence],
      {
        selection_id: "EDGE_DERIVED",
        setup_id: setupId,
        policy_version: "rd-entry-arbitration-v3",
        revision: 5,
        candidate_ids_considered: ["EDGE_DERIVED:HTF_FLIP"],
        canonical_candidate_id: "EDGE_DERIVED:HTF_FLIP",
        canonical_evidence_id: "EDGE_DERIVED:HTF_FLIP",
        canonical_model: "HTF_FLIP",
        reason: "ONLY_EXACT_TRIGGER",
        fidelity: "EXACT",
        action: "PAPER_ELIGIBLE",
        co_triggered_models: [],
        evaluated_at_epoch: 2702,
      },
    );

    await expect(
      validateEntryV3Payload(strict(payload), reviewedHashes),
    ).rejects.toThrow();
  });

  it("rejects exact same-child flip evidence with a coverage gap", async () => {
    const setupId = "setup-same-child-gap";
    const evidence = {
      ...exactFlipEvidence(),
      coverage_gap_detected: true,
    };
    const payload = payloadEnvelope(
      setupId,
      [flipCandidate(setupId)],
      [evidence],
      {
        selection_id: "EDGE_DERIVED",
        setup_id: setupId,
        policy_version: "rd-entry-arbitration-v3",
        revision: 5,
        candidate_ids_considered: ["EDGE_DERIVED:HTF_FLIP"],
        canonical_candidate_id: "EDGE_DERIVED:HTF_FLIP",
        canonical_evidence_id: "EDGE_DERIVED:HTF_FLIP",
        canonical_model: "HTF_FLIP",
        reason: "ONLY_EXACT_TRIGGER",
        fidelity: "EXACT",
        action: "PAPER_ELIGIBLE",
        co_triggered_models: [],
        evaluated_at_epoch: 2702,
      },
    );

    await expect(
      validateEntryV3Payload(strict(payload), reviewedHashes),
    ).rejects.toThrow();
  });

  it("aggregates simultaneous 15m/30m BOC and flip facts before selection", async () => {
    const setupId = "setup-independent-boc-flip";
    const payload = payloadEnvelope(
      setupId,
      [bocCandidate(setupId, "MATCHED"), flipCandidate(setupId)],
      [exactBocEvidence(setupId), exactFlipEvidence()],
      {
        selection_id: "EDGE_DERIVED",
        setup_id: setupId,
        policy_version: "rd-entry-arbitration-v3",
        revision: 5,
        candidate_ids_considered: [
          "EDGE_DERIVED:BOC",
          "EDGE_DERIVED:HTF_FLIP",
        ],
        canonical_candidate_id: null,
        canonical_evidence_id: null,
        canonical_model: null,
        reason: "CO_TRIGGER_SAME_EVENT",
        fidelity: null,
        action: "OBSERVE",
        co_triggered_models: ["BOC", "HTF_FLIP"],
        evaluated_at_epoch: 2702,
      },
    );

    const parsed = await validateEntryV3Payload(strict(payload), reviewedHashes);
    const evaluation = parsed.entryBundles[0]!.evaluation;

    expect(evaluation.selection.reason).toBe("CO_TRIGGER_SAME_EVENT");
    expect(evaluation.selection.co_triggered_models).toEqual([
      "BOC",
      "HTF_FLIP",
    ]);
    expect(
      evaluation.evidence.find((item) =>
        evaluation.candidates.find(
          (candidate) =>
            candidate.candidate_id === item.candidate_id &&
            candidate.model === "HTF_FLIP",
        ),
      )!.htf_context_minutes,
    ).toEqual([30]);
    const rawSelection = (
      (payload.setups as Array<Record<string, unknown>>)[0]!
        .selection_proposal as Record<string, unknown>
    );
    expect(rawSelection).toMatchObject({
      canonical_candidate_id: null,
      canonical_evidence_id: null,
      canonical_model: null,
      reason: "CO_TRIGGER_SAME_EVENT",
      fidelity: null,
      action: "OBSERVE",
    });
    const rawEvidence = (
      (payload.setups as Array<Record<string, unknown>>)[0]!
        .evidence as Array<Record<string, unknown>>
    );
    expect(rawEvidence.map((item) => item.observed_trigger_ticks)).toEqual([
      111,
      111,
    ]);
    expect(rawEvidence[1]!.htf_open_ticks).toBe(110);
    expect((payload.market_event as Record<string, unknown>).tick_price_ticks).toBe(
      111,
    );
    expect(JSON.stringify(parsed.canonicalPayload)).not.toContain(
      "EDGE_DERIVED",
    );
  });

  it("keeps a strict BOC distinct and derives every sentinel identity", async () => {
    const setupId = "setup-independent-strict-boc";
    const payload = payloadEnvelope(
      setupId,
      [bocCandidate(setupId, "MATCHED")],
      [exactBocEvidence(setupId)],
      {
        selection_id: "EDGE_DERIVED",
        setup_id: setupId,
        policy_version: "rd-entry-arbitration-v3",
        revision: 5,
        candidate_ids_considered: ["EDGE_DERIVED:BOC"],
        canonical_candidate_id: "EDGE_DERIVED:BOC",
        canonical_evidence_id: "EDGE_DERIVED:BOC",
        canonical_model: "BOC",
        reason: "ONLY_EXACT_TRIGGER",
        fidelity: "EXACT",
        action: "PAPER_ELIGIBLE",
        co_triggered_models: [],
        evaluated_at_epoch: 2702,
      },
    );

    const parsed = await validateEntryV3Payload(strict(payload), reviewedHashes);
    const bundle = parsed.entryBundles[0]!;

    expect(bundle.evaluation.selection.canonical_model).toBe("BOC");
    expect(bundle.evaluation.candidates.map((item) => item.model)).toEqual([
      "BOC",
    ]);
    expect(
      bundle.candidates.every((item) => /^[a-f0-9]{64}$/u.test(item.candidate_id)),
    ).toBe(true);
    expect(
      bundle.evidence.every(
        (item) =>
          /^[a-f0-9]{64}$/u.test(item.evidence_id) &&
          /^[a-f0-9]{64}$/u.test(item.payload_sha256),
      ),
    ).toBe(true);
  });

  it("accepts a truthful unreviewed blocked observation without suppressing it", async () => {
    const setupId = "setup-independent-unreviewed";
    const blockedEvidence = {
      ...exactBocEvidence(setupId),
      fidelity: "UNRESOLVED",
      ambiguity_codes: ["SHADOW_MISSING_INTRABAR_COVERAGE"],
      passed_rule_ids: [],
      failed_rule_ids: ["COMMON_SETUP_NOT_EXACT"],
    };
    const payload = payloadEnvelope(
      setupId,
      [bocCandidate(setupId, "BLOCKED")],
      [blockedEvidence],
      {
        selection_id: "EDGE_DERIVED",
        setup_id: setupId,
        policy_version: "rd-entry-arbitration-v3",
        revision: 5,
        candidate_ids_considered: ["EDGE_DERIVED:BOC"],
        canonical_candidate_id: null,
        canonical_evidence_id: null,
        canonical_model: null,
        reason: "NO_EXACT_CANDIDATE",
        fidelity: null,
        action: "SHADOW_ONLY",
        co_triggered_models: [],
        evaluated_at_epoch: 2702,
      },
      {
        detectorHash: "UNREVIEWED",
        settingsHash: "UNREVIEWED",
        commonFidelity: "UNRESOLVED",
        falseRule: "LIQ_DISTANCE_INFLUENCES_ZONE",
      },
    );

    const parsed = await validateEntryV3Payload(strict(payload), reviewedHashes);
    const bundle = parsed.entryBundles[0]!;

    expect(bundle.commonRuleResults).toContainEqual({
      rule_id: "LIQ_DISTANCE_INFLUENCES_ZONE",
      passed: false,
    });
    expect(bundle.evaluation.selection.action).toBe("SHADOW_ONLY");
    expect(bundle.evaluation.selection.canonical_model).toBeNull();
    expect(bundle.evidence[0]!.failed_rule_ids).toEqual([
      "COMMON_SETUP_NOT_EXACT",
    ]);
  });

  it("emits one terminal historical ambiguity audit instead of inventing exit order", async () => {
    const setupId = "setup-independent-ambiguous-exit";
    const candidate = {
      ...bocCandidate(setupId, "MATCHED"),
      boc_tier: "DISCRETIONARY_5M",
      source_claim_ids: ["discretionary-break-2025-11"],
    };
    const evidence = {
      ...exactBocEvidence(setupId),
      htf_context_minutes: [],
      fidelity: "DISCRETIONARY",
      proof_plane: "LOWER_TIMEFRAME_REPLAY",
      replayability: "REPLAYABLE",
      ambiguity_codes: ["SHADOW_SAME_CHILD_BAR_ORDER"],
      boc_tier: "DISCRETIONARY_5M",
      passed_rule_ids: [],
      failed_rule_ids: ["BOC_DISCRETIONARY_CONTEXT_UNQUANTIFIED"],
      source_claim_ids: ["discretionary-break-2025-11"],
    };
    const payload = payloadEnvelope(
      setupId,
      [candidate],
      [evidence],
      {
        selection_id: "EDGE_DERIVED",
        setup_id: setupId,
        policy_version: "rd-entry-arbitration-v3",
        revision: 5,
        candidate_ids_considered: ["EDGE_DERIVED:BOC"],
        canonical_candidate_id: null,
        canonical_evidence_id: null,
        canonical_model: null,
        reason: "NO_EXACT_CANDIDATE",
        fidelity: null,
        action: "SHADOW_ONLY",
        co_triggered_models: [],
        evaluated_at_epoch: 3000,
      },
      {
        isRealtime: false,
        observedAtEpoch: 3000,
        marketEvent: {
          epoch: 3000,
          sequence: 6,
          tick_price_ticks: 115,
          barstate_isconfirmed: true,
          confirmed_bar: {
            open_epoch: 2700,
            close_epoch: 3000,
            open_ticks: 112,
            high_ticks: 140,
            low_ticks: 90,
            close_ticks: 115,
          },
        },
        exitEvents: [
          {
            event_id: `${setupId}:exit:AMBIGUOUS_SAME_BAR_EXIT:6`,
            setup_id: setupId,
            exit_reason: "AMBIGUOUS_SAME_BAR_EXIT",
            epoch: 3000,
            sequence: 6,
            price_ticks: 115,
          },
        ],
      },
    );

    const parsed = await validateEntryV3Payload(strict(payload), reviewedHashes);

    expect(parsed.exitEvents).toHaveLength(1);
    expect(parsed.exitEvents[0]!.exit_reason).toBe(
      "AMBIGUOUS_SAME_BAR_EXIT",
    );
    expect(parsed.entryBundles[0]!.selectionProposal.action).toBe("SHADOW_ONLY");
  });

  it("accepts a same-second BOC as nullable blocked evidence after the next actual second", async () => {
    const setupId = "setup-pine-same-second-boc";
    const payload = payloadEnvelope(
      setupId,
      [
        {
          candidate_id: "EDGE_DERIVED:BOC",
          setup_id: setupId,
          model: "BOC",
          state: "BLOCKED",
          direction: "LONG",
          event_anchor_epoch: 900,
          trigger_ordinal: 1,
          boc_tier: "HTF_TIMED",
          reference_candle_open_epoch: 900,
          source_claim_ids: bocClaims,
          observed_at_epoch: 2701,
        },
      ],
      [
        {
          evidence_id: "EDGE_DERIVED:BOC",
          candidate_id: "EDGE_DERIVED:BOC",
          observed_trigger_epoch: null,
          trigger_sequence: 5,
          observed_trigger_ticks: null,
          htf_context_minutes: [15],
          fidelity: "UNRESOLVED",
          proof_plane: "REALTIME_TICK",
          replayability: "LIVE_EXACT_NON_REPLAYABLE",
          coverage_start_epoch: 2700,
          coverage_end_epoch: 2701,
          ambiguity_codes: ["SHADOW_MISSING_INTRABAR_COVERAGE"],
          boc_tier: "HTF_TIMED",
          reference_candle_open_epoch: 900,
          reference_candle_open_ticks: 105,
          reference_candle_high_ticks: 110,
          reference_candle_low_ticks: 100,
          reference_candle_close_ticks: 102,
          htf_open_ticks: null,
          contact_candle: null,
          recross_candle: null,
          coverage_gap_detected: null,
          full_lifecycle_ordered: null,
          destination_seen_before_contact: null,
          passed_rule_ids: [],
          failed_rule_ids: ["REALTIME_TRIGGER_EPOCH_UNREPRESENTABLE"],
          source_claim_ids: bocClaims,
          payload_sha256: "EDGE_DERIVED",
          observed_at_epoch: 2701,
        },
      ],
      {
        selection_id: "EDGE_DERIVED",
        setup_id: setupId,
        policy_version: "rd-entry-arbitration-v3",
        revision: 5,
        candidate_ids_considered: ["EDGE_DERIVED:BOC"],
        canonical_candidate_id: null,
        canonical_evidence_id: null,
        canonical_model: null,
        reason: "NO_EXACT_CANDIDATE",
        fidelity: null,
        action: "SHADOW_ONLY",
        co_triggered_models: [],
        evaluated_at_epoch: 2701,
      },
      {
        observedAtEpoch: 2701,
        marketEvent: {
          epoch: 2700,
          sequence: 5,
          tick_price_ticks: 111,
          barstate_isconfirmed: false,
          confirmed_bar: null,
        },
      },
    );

    const parsed = await validateEntryV3Payload(strict(payload), reviewedHashes);
    const bundle = parsed.entryBundles[0]!;

    expect(bundle.candidates[0]!.state).toBe("BLOCKED");
    expect(bundle.evidence[0]).toMatchObject({
      observed_trigger_epoch: null,
      observed_trigger_ticks: null,
      coverage_start_epoch: 2700,
      coverage_end_epoch: 2701,
      fidelity: "UNRESOLVED",
      failed_rule_ids: ["REALTIME_TRIGGER_EPOCH_UNREPRESENTABLE"],
    });
  });

  it("accepts a same-second flip with the entire lifecycle tuple null", async () => {
    const setupId = "setup-pine-same-second-flip";
    const payload = payloadEnvelope(
      setupId,
      [
        {
          candidate_id: "EDGE_DERIVED:HTF_FLIP",
          setup_id: setupId,
          model: "HTF_FLIP",
          state: "BLOCKED",
          direction: "LONG",
          event_anchor_epoch: 1800,
          trigger_ordinal: 1,
          boc_tier: null,
          reference_candle_open_epoch: null,
          source_claim_ids: flipClaims,
          observed_at_epoch: 2701,
        },
      ],
      [
        {
          evidence_id: "EDGE_DERIVED:HTF_FLIP",
          candidate_id: "EDGE_DERIVED:HTF_FLIP",
          observed_trigger_epoch: null,
          trigger_sequence: 5,
          observed_trigger_ticks: null,
          htf_context_minutes: [30],
          fidelity: "UNRESOLVED",
          proof_plane: "REALTIME_TICK",
          replayability: "LIVE_EXACT_NON_REPLAYABLE",
          coverage_start_epoch: 1800,
          coverage_end_epoch: 2701,
          ambiguity_codes: ["SHADOW_MISSING_INTRABAR_COVERAGE"],
          boc_tier: null,
          reference_candle_open_epoch: null,
          reference_candle_open_ticks: null,
          reference_candle_high_ticks: null,
          reference_candle_low_ticks: null,
          reference_candle_close_ticks: null,
          htf_open_ticks: null,
          contact_candle: null,
          recross_candle: null,
          coverage_gap_detected: null,
          full_lifecycle_ordered: null,
          destination_seen_before_contact: null,
          passed_rule_ids: [],
          failed_rule_ids: ["HTF_FLIP_CAUSAL_EPOCH_UNREPRESENTABLE"],
          source_claim_ids: flipClaims,
          payload_sha256: "EDGE_DERIVED",
          observed_at_epoch: 2701,
        },
      ],
      {
        selection_id: "EDGE_DERIVED",
        setup_id: setupId,
        policy_version: "rd-entry-arbitration-v3",
        revision: 5,
        candidate_ids_considered: ["EDGE_DERIVED:HTF_FLIP"],
        canonical_candidate_id: null,
        canonical_evidence_id: null,
        canonical_model: null,
        reason: "NO_EXACT_CANDIDATE",
        fidelity: null,
        action: "SHADOW_ONLY",
        co_triggered_models: [],
        evaluated_at_epoch: 2701,
      },
      {
        observedAtEpoch: 2701,
        marketEvent: {
          epoch: 2700,
          sequence: 5,
          tick_price_ticks: 111,
          barstate_isconfirmed: false,
          confirmed_bar: null,
        },
      },
    );

    const parsed = await validateEntryV3Payload(strict(payload), reviewedHashes);
    const evidence = parsed.entryBundles[0]!.evidence[0]!;

    expect(evidence).toMatchObject({
      observed_trigger_epoch: null,
      observed_trigger_ticks: null,
      htf_open_ticks: null,
      contact_candle: null,
      recross_candle: null,
      coverage_gap_detected: null,
      full_lifecycle_ordered: null,
      destination_seen_before_contact: null,
    });
  });

  it("uses the confirmed event epoch for every historical observation clock", async () => {
    const setupId = "setup-pine-historical-boc";
    const payload = payloadEnvelope(
      setupId,
      [
        {
          candidate_id: "EDGE_DERIVED:BOC",
          setup_id: setupId,
          model: "BOC",
          state: "BLOCKED",
          direction: "LONG",
          event_anchor_epoch: 900,
          trigger_ordinal: 1,
          boc_tier: "HTF_TIMED",
          reference_candle_open_epoch: 900,
          source_claim_ids: bocClaims,
          observed_at_epoch: 3000,
        },
      ],
      [
        {
          evidence_id: "EDGE_DERIVED:BOC",
          candidate_id: "EDGE_DERIVED:BOC",
          observed_trigger_epoch: 3000,
          trigger_sequence: 0,
          observed_trigger_ticks: 111,
          htf_context_minutes: [15],
          fidelity: "UNRESOLVED",
          proof_plane: "CONFIRMED_5M",
          replayability: "REPLAYABLE",
          coverage_start_epoch: 900,
          coverage_end_epoch: 3000,
          ambiguity_codes: ["SHADOW_SAME_CHILD_BAR_ORDER"],
          boc_tier: "HTF_TIMED",
          reference_candle_open_epoch: 900,
          reference_candle_open_ticks: 105,
          reference_candle_high_ticks: 110,
          reference_candle_low_ticks: 100,
          reference_candle_close_ticks: 102,
          htf_open_ticks: null,
          contact_candle: null,
          recross_candle: null,
          coverage_gap_detected: null,
          full_lifecycle_ordered: null,
          destination_seen_before_contact: null,
          passed_rule_ids: [],
          failed_rule_ids: ["HISTORICAL_ORDER_UNPROVEN"],
          source_claim_ids: bocClaims,
          payload_sha256: "EDGE_DERIVED",
          observed_at_epoch: 3000,
        },
      ],
      {
        selection_id: "EDGE_DERIVED",
        setup_id: setupId,
        policy_version: "rd-entry-arbitration-v3",
        revision: 0,
        candidate_ids_considered: ["EDGE_DERIVED:BOC"],
        canonical_candidate_id: null,
        canonical_evidence_id: null,
        canonical_model: null,
        reason: "NO_EXACT_CANDIDATE",
        fidelity: null,
        action: "SHADOW_ONLY",
        co_triggered_models: [],
        evaluated_at_epoch: 3000,
      },
      {
        isRealtime: false,
        observedAtEpoch: 3000,
        marketEvent: {
          epoch: 3000,
          sequence: 0,
          tick_price_ticks: 111,
          barstate_isconfirmed: true,
          confirmed_bar: {
            open_epoch: 2700,
            close_epoch: 3000,
            open_ticks: 105,
            high_ticks: 112,
            low_ticks: 100,
            close_ticks: 111,
          },
        },
      },
    );

    const parsed = await validateEntryV3Payload(strict(payload), reviewedHashes);
    const bundle = parsed.entryBundles[0]!;

    expect(
      (parsed.canonicalPayload as Record<string, unknown>).observed_at_epoch,
    ).toBe(3000);
    expect(bundle.candidates[0]!.observed_at_epoch).toBe(3000);
    expect(bundle.evidence[0]!.observed_at_epoch).toBe(3000);
    expect(bundle.selectionProposal.evaluated_at_epoch).toBe(3000);
  });

  it("validates a Pine-emittable historical DIR_CLOSE later ambiguity as EXIT_FOLLOWUP", async () => {
    const setupId = "setup-pine-close-paper-ambiguity";
    const payload = payloadEnvelope(
      setupId,
      [closeCandidate(setupId)],
      [exactCloseEvidence()],
      {
        selection_id: "EDGE_DERIVED",
        setup_id: setupId,
        policy_version: "rd-entry-arbitration-v3",
        revision: 6,
        candidate_ids_considered: ["EDGE_DERIVED:DIR_CLOSE"],
        canonical_candidate_id: "EDGE_DERIVED:DIR_CLOSE",
        canonical_evidence_id: "EDGE_DERIVED:DIR_CLOSE",
        canonical_model: "DIR_CLOSE",
        reason: "ONLY_EXACT_TRIGGER",
        fidelity: "EXACT",
        action: "PAPER_ELIGIBLE",
        co_triggered_models: [],
        evaluated_at_epoch: 3000,
      },
      {
        isRealtime: false,
        observedAtEpoch: 3000,
        entryTicks: 111,
        marketEvent: {
          epoch: 3000,
          sequence: 0,
          tick_price_ticks: 111,
          barstate_isconfirmed: true,
          confirmed_bar: {
            open_epoch: 2700,
            close_epoch: 3000,
            open_ticks: 111,
            high_ticks: 140,
            low_ticks: 90,
            close_ticks: 111,
          },
        },
        exitEvents: [
          {
            event_id: `${setupId}:exit:AMBIGUOUS_SAME_BAR_EXIT:0`,
            setup_id: setupId,
            exit_reason: "AMBIGUOUS_SAME_BAR_EXIT",
            epoch: 3000,
            sequence: 0,
            price_ticks: 111,
          },
        ],
      },
    );

    const parsed = await validateEntryV3Payload(strict(payload), reviewedHashes);

    expect(parsed.eventRole).toBe("EXIT_FOLLOWUP");
    expect(parsed.entryBundles[0]!.selectionProposal.action).toBe(
      "PAPER_ELIGIBLE",
    );
    expect(parsed.exitEvents[0]!.exit_reason).toBe(
      "AMBIGUOUS_SAME_BAR_EXIT",
    );
  });
});
