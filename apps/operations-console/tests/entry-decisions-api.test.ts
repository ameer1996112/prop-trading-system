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
