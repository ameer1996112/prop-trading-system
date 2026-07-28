import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { EntryDecisionPanel } from "../src/components/EntryDecisionPanel";
import type { EntryDecisionSnapshot } from "../src/lib/entry-decisions";

const discretionarySnapshot: EntryDecisionSnapshot = {
  state: "READY",
  message: "One immutable decision.",
  items: [
    {
      setupId: "setup-discretionary",
      symbol: "GBPUSD",
      direction: "LONG",
      selection: {
        selectionId: "selection-a",
        setupId: "setup-discretionary",
        revision: 0,
        canonicalCandidateId: "candidate-close",
        canonicalEvidenceId: "evidence-close",
        canonicalModel: "DIR_CLOSE",
        reason: "FALLBACK_TO_CONFIRMED_CLOSE",
        fidelity: "EXACT",
        policyAction: "PAPER_ELIGIBLE",
        action: "SHADOW_ONLY",
        effectiveActionReason: "PROMOTION_IDENTITY_MISMATCH",
        coTriggeredModels: [],
        evaluatedAtEpoch: 2_400,
        selectedTriggerEpoch: 2_100,
        selectedTriggerSequence: 0,
      },
      parity: { status: "MISMATCH", mismatchReason: "ACTION" },
      candidates: [
        {
          candidateId: "candidate-boc",
          model: "BOC",
          state: "MATCHED",
          direction: "LONG",
          eventAnchorEpoch: 900,
          triggerOrdinal: 1,
          bocTier: "DISCRETIONARY_5M",
          referenceCandleOpenEpoch: 900,
          sourceClaimIds: ["discretionary-break-2025-11"],
          evidence: {
            evidenceId: "evidence-boc",
            observedTriggerEpoch: 2_101,
            triggerSequence: 4,
            observedTriggerTicks: 111,
            fidelity: "DISCRETIONARY",
            proofPlane: "REALTIME_TICK",
            replayability: "LIVE_EXACT_NON_REPLAYABLE",
            htfContextMinutes: [],
            coverageStartEpoch: 900,
            coverageEndEpoch: 2_400,
            ambiguityCodes: [],
            passedRuleIds: [],
            failedRuleIds: ["BOC_DISCRETIONARY_CONTEXT_UNQUANTIFIED"],
            referenceCandle: {
              openEpoch: 900,
              closeEpoch: null,
              openTicks: 105,
              highTicks: 110,
              lowTicks: 100,
              closeTicks: 102,
            },
            contactCandle: null,
            recrossCandle: null,
          },
        },
        {
          candidateId: "candidate-close",
          model: "DIR_CLOSE",
          state: "MATCHED",
          direction: "LONG",
          eventAnchorEpoch: 1_800,
          triggerOrdinal: 1,
          bocTier: null,
          referenceCandleOpenEpoch: null,
          sourceClaimIds: ["directional-close-2025-08"],
          evidence: {
            evidenceId: "evidence-close",
            observedTriggerEpoch: 2_100,
            triggerSequence: 0,
            observedTriggerTicks: 109,
            fidelity: "EXACT",
            proofPlane: "CONFIRMED_5M",
            replayability: "REPLAYABLE",
            htfContextMinutes: [],
            coverageStartEpoch: 1_800,
            coverageEndEpoch: 2_100,
            ambiguityCodes: [],
            passedRuleIds: ["ENTRY_DIR_CLOSE"],
            failedRuleIds: [],
            referenceCandle: null,
            contactCandle: null,
            recrossCandle: null,
          },
        },
      ],
      tradePlan: {
        tickSize: "0.00001",
        entryTicks: 109,
        stopTicks: 101,
        targetTicks: 151,
      },
      paperIntentId: null,
      trade: null,
      shadowOutcome: { state: "OPEN", outcomeRMillis: null },
    },
  ],
};

afterEach(cleanup);

describe("EntryDecisionPanel", () => {
  it("explains why discretionary BOC did not win with semantic status text", () => {
    render(<EntryDecisionPanel initialSnapshot={discretionarySnapshot} />);

    expect(screen.getByRole("region", { name: "Entry decision ledger" })).toBeVisible();
    expect(screen.getByText("Discretionary 5m BOC")).toBeInTheDocument();
    expect(screen.getByText("Context is not mechanically quantified")).toBeInTheDocument();
    expect(screen.getByText("Directional close selected")).toBeInTheDocument();
    expect(screen.getByText("Parity mismatch · ACTION")).toBeInTheDocument();
    expect(screen.getByText("No paper trade")).toBeInTheDocument();
    expect(screen.getByText("Shadow open")).toBeInTheDocument();
  });

  it("shows co-trigger and paper linkage without color-only meaning", () => {
    const coTriggered: EntryDecisionSnapshot = {
      ...discretionarySnapshot,
      items: [
        {
          ...discretionarySnapshot.items[0]!,
          selection: {
            ...discretionarySnapshot.items[0]!.selection,
            canonicalModel: "HTF_FLIP",
            coTriggeredModels: ["BOC"],
            action: "PAPER_ELIGIBLE",
            effectiveActionReason: null,
          },
          paperIntentId: "intent-a",
          trade: {
            entryPrice: "1.1",
            stopLoss: "1.0",
            takeProfit: "1.3",
            state: "OPEN",
          },
        },
      ],
    };
    render(<EntryDecisionPanel initialSnapshot={coTriggered} />);
    expect(screen.getByText("Co-trigger · BOC + HTF flip")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Paper intent intent-a" })).toHaveAttribute(
      "href",
      "#paper-intent-intent-a",
    );
  });

  it("renders explicit empty and error states accessibly", () => {
    const { rerender } = render(
      <EntryDecisionPanel
        initialSnapshot={{ state: "EMPTY", items: [], message: "No decisions recorded." }}
      />,
    );
    expect(screen.getByText("No decisions recorded.")).toBeInTheDocument();
    rerender(
      <EntryDecisionPanel
        initialSnapshot={{ state: "ERROR", items: [], message: "Decision API unavailable." }}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Decision API unavailable.");
  });
});
