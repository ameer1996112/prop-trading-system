import { afterEach, describe, expect, it, vi } from "vitest";

import { loadEntryDecisions } from "../src/lib/entry-decisions";

const payload = {
  schema_version: "1.0",
  mode: "PAPER_ONLY",
  count: 1,
  items: [
    {
      decision_id: "stored-selection-a",
      setup_id: "setup-a",
      symbol: "EURUSD",
      direction: "LONG",
      selection: {
        selection_id: "selection-a",
        setup_id: "setup-a",
        policy_version: "rd-entry-arbitration-v3",
        revision: 0,
        candidate_ids_considered: ["candidate-boc", "candidate-close", "candidate-flip"],
        canonical_candidate_id: "candidate-close",
        canonical_evidence_id: "evidence-close",
        canonical_model: "DIR_CLOSE",
        reason: "FALLBACK_TO_CONFIRMED_CLOSE",
        fidelity: "EXACT",
        policy_action: "PAPER_ELIGIBLE",
        action: "PAPER_ELIGIBLE",
        effective_action_reason: null,
        co_triggered_models: [],
        evaluated_at_epoch: 2_400,
        selected_trigger_epoch: 2_100,
        selected_trigger_sequence: 0,
      },
      parity: { status: "MATCH", mismatch_reason: null },
      candidates: [
        {
          candidate_id: "candidate-boc",
          model: "BOC",
          state: "BLOCKED",
          direction: "LONG",
          event_anchor_epoch: 900,
          trigger_ordinal: 1,
          boc_tier: "HTF_TIMED",
          reference_candle_open_epoch: 900,
          source_claim_ids: ["htf-timed-boc-2026-06"],
          evidence: {
            evidence_id: "evidence-boc",
            candidate_id: "candidate-boc",
            observed_trigger_epoch: 1_801,
            trigger_sequence: 5,
            observed_trigger_ticks: 111,
            fidelity: "UNRESOLVED",
            proof_plane: "REALTIME_TICK",
            replayability: "LIVE_EXACT_NON_REPLAYABLE",
            htf_context_minutes: [15, 30],
            coverage_start_epoch: 900,
            coverage_end_epoch: 2_400,
            ambiguity_codes: [],
            passed_rule_ids: [],
            failed_rule_ids: ["REALTIME_EVIDENCE_NOT_LIVE"],
            reference_candle: {
              open_epoch: 900,
              open_ticks: 105,
              high_ticks: 110,
              low_ticks: 100,
              close_ticks: 102,
            },
            contact_candle: null,
            recross_candle: null,
          },
        },
        {
          candidate_id: "candidate-close",
          model: "DIR_CLOSE",
          state: "MATCHED",
          direction: "LONG",
          event_anchor_epoch: 1_800,
          trigger_ordinal: 1,
          boc_tier: null,
          reference_candle_open_epoch: null,
          source_claim_ids: ["directional-close-2025-08"],
          evidence: {
            evidence_id: "evidence-close",
            candidate_id: "candidate-close",
            observed_trigger_epoch: 2_100,
            trigger_sequence: 0,
            observed_trigger_ticks: 109,
            fidelity: "EXACT",
            proof_plane: "CONFIRMED_5M",
            replayability: "REPLAYABLE",
            htf_context_minutes: [],
            coverage_start_epoch: 1_800,
            coverage_end_epoch: 2_100,
            ambiguity_codes: [],
            passed_rule_ids: ["ENTRY_DIR_CLOSE"],
            failed_rule_ids: [],
            reference_candle: null,
            contact_candle: null,
            recross_candle: null,
          },
        },
        {
          candidate_id: "candidate-flip",
          model: "HTF_FLIP",
          state: "BLOCKED",
          direction: "LONG",
          event_anchor_epoch: 1_800,
          trigger_ordinal: 1,
          boc_tier: null,
          reference_candle_open_epoch: null,
          source_claim_ids: ["htf-flip-2024-03"],
          evidence: {
            evidence_id: "evidence-flip",
            candidate_id: "candidate-flip",
            observed_trigger_epoch: 1_802,
            trigger_sequence: 6,
            observed_trigger_ticks: 112,
            fidelity: "UNRESOLVED",
            proof_plane: "REALTIME_TICK",
            replayability: "LIVE_EXACT_NON_REPLAYABLE",
            htf_context_minutes: [15, 30],
            coverage_start_epoch: 900,
            coverage_end_epoch: 2_400,
            ambiguity_codes: [],
            passed_rule_ids: [],
            failed_rule_ids: ["REALTIME_EVIDENCE_NOT_LIVE"],
            reference_candle: null,
            contact_candle: {
              open_epoch: 1_800,
              close_epoch: 1_801,
              open_ticks: 105,
              high_ticks: 111,
              low_ticks: 100,
              close_ticks: 105,
            },
            recross_candle: {
              open_epoch: 1_801,
              close_epoch: 1_802,
              open_ticks: 111,
              high_ticks: 113,
              low_ticks: 110,
              close_ticks: 112,
            },
          },
        },
      ],
      trade_plan: {
        tick_size: "0.00001",
        entry_ticks: 109,
        stop_ticks: 101,
        target_ticks: 151,
      },
      paper_intent_id: "intent-a",
      trade: {
        entry_price: "0.00109",
        stop_loss: "0.00101",
        take_profit: "0.00151",
        state: "OPEN",
      },
      shadow_outcome: null,
    },
  ],
};

type BackendFailedRuleCase = {
  readonly code: string;
  readonly model: "BOC" | "DIR_CLOSE" | "HTF_FLIP";
  readonly state?: "BLOCKED" | "MATCHED" | "REJECTED";
  readonly fidelity?:
    | "UNRESOLVED"
    | "CALIBRATED"
    | "DISCRETIONARY";
};

const backendFailedRuleCases: readonly BackendFailedRuleCase[] = [
  { code: "COMMON_SETUP_NOT_EXACT", model: "BOC" },
  { code: "COMMON_SETUP_NOT_EXACT", model: "DIR_CLOSE" },
  { code: "COMMON_SETUP_NOT_EXACT", model: "HTF_FLIP" },
  { code: "SETUP_INVALIDATED", model: "BOC" },
  { code: "SETUP_INVALIDATED", model: "DIR_CLOSE" },
  { code: "SETUP_INVALIDATED", model: "HTF_FLIP" },
  { code: "ENTRY_BEFORE_ZONE_ENGAGEMENT", model: "BOC" },
  { code: "ENTRY_BEFORE_ZONE_ENGAGEMENT", model: "DIR_CLOSE" },
  { code: "ENTRY_BEFORE_ZONE_ENGAGEMENT", model: "HTF_FLIP" },
  { code: "MODEL_EVIDENCE_NOT_EXACT", model: "BOC" },
  {
    code: "MODEL_EVIDENCE_NOT_EXACT",
    model: "BOC",
    fidelity: "CALIBRATED",
  },
  {
    code: "MODEL_EVIDENCE_NOT_EXACT",
    model: "BOC",
    fidelity: "DISCRETIONARY",
  },
  { code: "MODEL_EVIDENCE_NOT_EXACT", model: "HTF_FLIP" },
  { code: "EVIDENCE_REPLAYABILITY_MISMATCH", model: "BOC" },
  { code: "EVIDENCE_REPLAYABILITY_MISMATCH", model: "HTF_FLIP" },
  { code: "REALTIME_EVIDENCE_NOT_LIVE", model: "BOC" },
  { code: "REALTIME_EVIDENCE_NOT_LIVE", model: "HTF_FLIP" },
  { code: "BOC_WRONG_DIRECTION", model: "BOC", state: "REJECTED" },
  {
    code: "BOC_DISCRETIONARY_CONTEXT_UNQUANTIFIED",
    model: "BOC",
    state: "MATCHED",
    fidelity: "DISCRETIONARY",
  },
  { code: "DIR_CLOSE_NOT_CONFIRMED_5M", model: "DIR_CLOSE" },
  { code: "HTF_FLIP_INCOMPLETE_LIFECYCLE", model: "HTF_FLIP" },
  { code: "HTF_FLIP_COVERAGE_GAP", model: "HTF_FLIP" },
  { code: "HTF_FLIP_ORDER_UNPROVEN", model: "HTF_FLIP" },
  { code: "HTF_FLIP_DESTINATION_BEFORE_CONTACT", model: "HTF_FLIP" },
  { code: "HTF_FLIP_AMBIGUOUS", model: "HTF_FLIP" },
  { code: "HTF_FLIP_ANCHOR_AFTER_CONTACT", model: "HTF_FLIP" },
  { code: "HTF_FLIP_TRIGGER_OUTSIDE_CONTEXT", model: "HTF_FLIP" },
  { code: "HTF_FLIP_CONTACT_OUTSIDE_ZONE", model: "HTF_FLIP" },
  { code: "HTF_FLIP_CONTACT_ALREADY_RECROSSED", model: "HTF_FLIP" },
  { code: "HTF_FLIP_OPEN_NOT_RECROSSED", model: "HTF_FLIP" },
  { code: "HTF_FLIP_CONTEXT_MISALIGNED", model: "HTF_FLIP" },
  { code: "REALTIME_TRIGGER_EPOCH_UNREPRESENTABLE", model: "BOC" },
  { code: "REALTIME_FIRST_CROSS_UNPROVEN", model: "BOC" },
  { code: "HISTORICAL_ORDER_UNPROVEN", model: "BOC" },
  { code: "HISTORICAL_ORDER_UNPROVEN", model: "DIR_CLOSE" },
  { code: "HISTORICAL_ORDER_UNPROVEN", model: "HTF_FLIP" },
  { code: "HTF_FLIP_CAUSAL_EPOCH_UNREPRESENTABLE", model: "HTF_FLIP" },
  { code: "HTF_FLIP_INCOMPATIBLE_CONTEXTS", model: "HTF_FLIP" },
  { code: "HTF_FLIP_MISSING_INTRABAR_COVERAGE", model: "HTF_FLIP" },
  { code: "HTF_FLIP_LIFECYCLE_UNRESOLVED", model: "HTF_FLIP" },
];

function reportWithSingleFailedCandidate(
  model: "BOC" | "DIR_CLOSE" | "HTF_FLIP",
  code: string,
  state: "BLOCKED" | "MATCHED" | "REJECTED" = "BLOCKED",
  fidelity:
    | "UNRESOLVED"
    | "CALIBRATED"
    | "DISCRETIONARY" = "UNRESOLVED",
) {
  const source = structuredClone(payload.items[0]!);
  const candidate = source.candidates.find((item) => item.model === model)!;
  const emptyFlipFacts =
    model === "HTF_FLIP" &&
    (code === "HTF_FLIP_CONTEXT_MISALIGNED" ||
      code === "HTF_FLIP_INCOMPLETE_LIFECYCLE" ||
      code === "HTF_FLIP_CAUSAL_EPOCH_UNREPRESENTABLE" ||
      code === "HTF_FLIP_INCOMPATIBLE_CONTEXTS" ||
      code === "HTF_FLIP_MISSING_INTRABAR_COVERAGE" ||
      code === "HTF_FLIP_LIFECYCLE_UNRESOLVED" ||
      code === "HISTORICAL_ORDER_UNPROVEN");
  const failedCandidate = {
    ...candidate,
    state,
    boc_tier:
      model === "BOC" && fidelity === "DISCRETIONARY"
        ? "DISCRETIONARY_5M"
        : candidate.boc_tier,
    evidence: {
      ...candidate.evidence,
      fidelity,
      htf_context_minutes: emptyFlipFacts ? [] : candidate.evidence.htf_context_minutes,
      passed_rule_ids: [],
      failed_rule_ids: [code],
      contact_candle: emptyFlipFacts ? null : candidate.evidence.contact_candle,
      recross_candle: emptyFlipFacts ? null : candidate.evidence.recross_candle,
    },
  };
  return {
    ...payload,
    items: [
      {
        ...source,
        selection: {
          ...source.selection,
          candidate_ids_considered: [candidate.candidate_id],
          canonical_candidate_id: null,
          canonical_evidence_id: null,
          canonical_model: null,
          reason: "NO_EXACT_CANDIDATE",
          fidelity: null,
          policy_action: "SHADOW_ONLY",
          action: "SHADOW_ONLY",
          effective_action_reason: null,
          co_triggered_models: [],
          selected_trigger_epoch: null,
          selected_trigger_sequence: null,
        },
        candidates: [failedCandidate],
        paper_intent_id: null,
        trade: null,
      },
    ],
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("loadEntryDecisions", () => {
  it("strictly parses all three canonical model rows", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const snapshot = await loadEntryDecisions("operator-secret");

    expect(snapshot.state).toBe("READY");
    expect(snapshot.items[0]?.candidates.map((candidate) => candidate.model)).toEqual([
      "BOC",
      "DIR_CLOSE",
      "HTF_FLIP",
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/rd-entry-decisions?limit=50"),
      expect.objectContaining({
        cache: "no-store",
        headers: expect.objectContaining({
          Authorization: "Bearer operator-secret",
        }),
      }),
    );
  });

  it("keeps duplicate logical selection IDs when opaque decision IDs differ", async () => {
    const repeated = structuredClone(payload);
    repeated.count = 2;
    repeated.items.push({
      ...structuredClone(payload.items[0]!),
      decision_id: "stored-selection-b",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(repeated), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    const snapshot = await loadEntryDecisions("operator-secret");

    expect(snapshot.state).toBe("READY");
    expect(snapshot.items.map((item) => item.selection.selectionId)).toEqual([
      "selection-a",
      "selection-a",
    ]);
    expect(snapshot.items.map((item) => item.decisionId)).toEqual([
      "stored-selection-a",
      "stored-selection-b",
    ]);
  });

  it.each(backendFailedRuleCases)(
    "accepts backend-emitted $model failed rule $code",
    async ({ code, fidelity, model, state }) => {
      const response = reportWithSingleFailedCandidate(
        model,
        code,
        state,
        fidelity,
      );
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(JSON.stringify(response), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        ),
      );

      await expect(loadEntryDecisions("operator-secret")).resolves.toMatchObject({
        state: "READY",
        items: [
          {
            candidates: [
              {
                model,
                state: state ?? "BLOCKED",
                evidence: { failedRuleIds: [code] },
              },
            ],
          },
        ],
      });
    },
  );

  it("accepts all producer ambiguity codes on unresolved evidence", async () => {
    for (const ambiguityCode of [
      "SHADOW_SAME_CHILD_BAR_ORDER",
      "SHADOW_MISSING_INTRABAR_COVERAGE",
      "SHADOW_REALTIME_ONLY_NOT_REPLAYABLE",
    ]) {
      const response = reportWithSingleFailedCandidate(
        "HTF_FLIP",
        "HTF_FLIP_AMBIGUOUS",
      );
      const evidence = response.items[0]!.candidates[0]!.evidence as unknown as {
        ambiguity_codes: string[];
      };
      evidence.ambiguity_codes = [ambiguityCode];
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(JSON.stringify(response), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        ),
      );

      await expect(loadEntryDecisions("operator-secret")).resolves.toMatchObject({
        state: "READY",
      });
    }
  });

  it.each([
    {
      name: "unknown failed rule",
      response: reportWithSingleFailedCandidate(
        "HTF_FLIP",
        "HTF_FLIP_FUTURE_UNKNOWN",
      ),
    },
    {
      name: "known failed rule on the wrong model",
      response: reportWithSingleFailedCandidate(
        "DIR_CLOSE",
        "HTF_FLIP_COVERAGE_GAP",
      ),
    },
    {
      name: "exact flip without contexts or lifecycle",
      response: (() => {
        const response = structuredClone(payload);
        const flip = response.items[0]!.candidates.find(
          (candidate) => candidate.model === "HTF_FLIP",
        )!;
        flip.state = "MATCHED";
        flip.evidence.fidelity = "EXACT";
        flip.evidence.htf_context_minutes = [];
        flip.evidence.passed_rule_ids = ["ENTRY_HTF_FLIP"];
        flip.evidence.failed_rule_ids = [];
        flip.evidence.contact_candle = null;
        flip.evidence.recross_candle = null;
        return response;
      })(),
    },
    {
      name: "exact evidence with an ambiguity code",
      response: (() => {
        const response = structuredClone(payload);
        const close = response.items[0]!.candidates.find(
          (candidate) => candidate.model === "DIR_CLOSE",
        )!;
        const evidence = close.evidence as unknown as {
          ambiguity_codes: string[];
        };
        evidence.ambiguity_codes = [
          "SHADOW_MISSING_INTRABAR_COVERAGE",
        ];
        return response;
      })(),
    },
    {
      name: "partial blocked flip lifecycle",
      response: (() => {
        const response = reportWithSingleFailedCandidate(
          "HTF_FLIP",
          "HTF_FLIP_COVERAGE_GAP",
        );
        response.items[0]!.candidates[0]!.evidence.recross_candle = null;
        return response;
      })(),
    },
    {
      name: "reversed blocked flip lifecycle chronology",
      response: (() => {
        const response = reportWithSingleFailedCandidate(
          "HTF_FLIP",
          "HTF_FLIP_ORDER_UNPROVEN",
        );
        const evidence = response.items[0]!.candidates[0]!.evidence;
        evidence.contact_candle = {
          ...evidence.contact_candle!,
          close_epoch: 1_802,
        };
        return response;
      })(),
    },
  ])("rejects $name", async ({ response }) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(response), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    await expect(loadEntryDecisions("operator-secret")).resolves.toMatchObject({
      state: "ERROR",
      items: [],
    });
  });

  it("fails closed on unknown keys, enums, bounds, and nullable-field drift", async () => {
    for (const invalid of [
      { ...payload, credential: "leak" },
      {
        ...payload,
        items: [
          {
            ...payload.items[0],
            direction: "BOTH",
          },
        ],
      },
      {
        ...payload,
        items: [
          {
            ...payload.items[0]!,
            candidates: payload.items[0]!.candidates.map((candidate) =>
              candidate.model === "HTF_FLIP"
                ? {
                    ...candidate,
                    evidence: {
                      ...candidate.evidence,
                      evidence_id: "evidence-close",
                    },
                  }
                : candidate,
            ),
          },
        ],
      },
      {
        ...payload,
        items: [
          {
            ...payload.items[0]!,
            candidates: payload.items[0]!.candidates.map((candidate) =>
              candidate.model === "HTF_FLIP"
                ? {
                    ...candidate,
                    evidence: {
                      ...candidate.evidence,
                      observed_trigger_epoch: 800,
                    },
                  }
                : candidate,
            ),
          },
        ],
      },
      {
        ...payload,
        items: [
          {
            ...payload.items[0],
            candidates: [
              {
                ...payload.items[0]!.candidates[0]!,
                model: "BROKER_FILL",
              },
            ],
          },
        ],
      },
      {
        ...payload,
        items: [
          {
            ...payload.items[0],
            selection: {
              ...payload.items[0]!.selection,
              canonical_model: null,
              canonical_candidate_id: "candidate-close",
            },
          },
        ],
      },
    ]) {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(new Response(JSON.stringify(invalid), { status: 200 })),
      );
      const snapshot = await loadEntryDecisions("operator-secret");
      expect(snapshot).toMatchObject({ state: "ERROR", items: [] });
    }
  });

  it("rejects duplicate opaque IDs and coordinated cross-graph corruption", async () => {
    const baseItem = payload.items[0]!;
    const malformed = [
      {
        ...payload,
        count: 2,
        items: [baseItem, { ...baseItem }],
      },
      {
        ...payload,
        items: [
          {
            ...baseItem,
            selection: {
              ...baseItem.selection,
              selected_trigger_epoch: 2_101,
            },
          },
        ],
      },
      {
        ...payload,
        items: [
          {
            ...baseItem,
            candidates: baseItem.candidates.map((candidate) =>
              candidate.model === "BOC"
                ? {
                    ...candidate,
                    evidence: {
                      ...candidate.evidence,
                      candidate_id: "candidate-close",
                    },
                  }
                : candidate,
            ),
          },
        ],
      },
      {
        ...payload,
        items: [
          {
            ...baseItem,
            candidates: baseItem.candidates.map((candidate) =>
              candidate.model === "BOC"
                ? {
                    ...candidate,
                    reference_candle_open_epoch: 901,
                  }
                : candidate,
            ),
          },
        ],
      },
      {
        ...payload,
        items: [
          {
            ...baseItem,
            selection: {
              ...baseItem.selection,
              action: "PAPER_ELIGIBLE",
            },
            paper_intent_id: null,
            trade: null,
          },
        ],
      },
      {
        ...payload,
        items: [
          {
            ...baseItem,
            selection: {
              ...baseItem.selection,
              canonical_candidate_id: "candidate-flip",
              canonical_evidence_id: "evidence-flip",
              canonical_model: "HTF_FLIP",
              reason: "CO_TRIGGER_SAME_EVENT",
              co_triggered_models: ["BOC", "HTF_FLIP"],
              selected_trigger_epoch: 1_802,
              selected_trigger_sequence: 6,
            },
            candidates: baseItem.candidates.map((candidate) =>
              candidate.model === "BOC"
                ? {
                    ...candidate,
                    state: "MATCHED",
                    evidence: {
                      ...candidate.evidence,
                      observed_trigger_epoch: 1_802,
                      trigger_sequence: 6,
                      fidelity: "EXACT",
                      passed_rule_ids: ["ENTRY_BOC_HTF_TIMED"],
                      failed_rule_ids: [],
                    },
                  }
                : candidate.model === "HTF_FLIP"
                  ? {
                      ...candidate,
                      state: "MATCHED",
                      evidence: {
                        ...candidate.evidence,
                        fidelity: "EXACT",
                        passed_rule_ids: ["ENTRY_HTF_FLIP"],
                        failed_rule_ids: [],
                      },
                    }
                  : candidate,
            ),
          },
        ],
      },
    ];
    for (const invalid of malformed) {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(JSON.stringify(invalid), { status: 200 }),
        ),
      );
      await expect(loadEntryDecisions("operator-secret")).resolves.toMatchObject({
        state: "ERROR",
        items: [],
      });
    }
  });

  it("returns an explicit empty error snapshot and never reuses stale decisions", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const snapshot = await loadEntryDecisions("operator-secret");
    expect(snapshot).toEqual({
      state: "ERROR",
      items: [],
      message: "Entry decisions are unavailable or malformed.",
    });
  });
});
