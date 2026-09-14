import { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SetupTable, type SetupTableProps } from "../src/features/tradeops/SetupTable";
import { SetupInspector } from "../src/features/tradeops/SetupInspector";
import type { EntryDecisionItem, EntryModel } from "../src/lib/entry-decisions";
import type { PaperSimulationIntent } from "../src/lib/api";

function decision(symbol = "EURUSD", model: EntryModel = "DIR_CLOSE"): EntryDecisionItem {
  const candidateId = `candidate-${symbol}`;
  const evidenceId = `evidence-${symbol}`;
  const setupId = `setup-${symbol}`;
  return {
    decisionId: `decision-${symbol}`, setupId, attemptKind: "INITIAL", symbol, direction: "LONG",
    selection: {
      selectionId: `selection-${symbol}`, setupId, revision: 0,
      canonicalCandidateId: candidateId, canonicalEvidenceId: evidenceId, canonicalModel: model,
      reason: "FALLBACK_TO_CONFIRMED_CLOSE", fidelity: "EXACT", policyAction: "PAPER_ELIGIBLE",
      action: "SHADOW_ONLY", effectiveActionReason: "PROMOTION_IDENTITY_MISMATCH", coTriggeredModels: [],
      evaluatedAtEpoch: 2_400, selectedTriggerEpoch: 2_100, selectedTriggerSequence: 0,
    },
    parity: { status: "MISMATCH", mismatchReason: "ACTION" },
    candidates: [{
      candidateId, model, state: "MATCHED", direction: "LONG", eventAnchorEpoch: 1_800,
      triggerOrdinal: 1, bocTier: model === "BOC" ? "HTF_TIMED" : null,
      referenceCandleOpenEpoch: model === "BOC" ? 1_800 : null, sourceClaimIds: ["source-claim-a"],
      evidence: {
        evidenceId, candidateId, observedTriggerEpoch: 2_100, triggerSequence: 0, observedTriggerTicks: 109,
        fidelity: "EXACT", proofPlane: "CONFIRMED_5M", replayability: "REPLAYABLE",
        htfContextMinutes: model === "BOC" ? [15] : [], coverageStartEpoch: 1_800, coverageEndEpoch: 2_100,
        ambiguityCodes: [], passedRuleIds: [model === "BOC" ? "ENTRY_BOC_HTF_TIMED" : "ENTRY_DIR_CLOSE"],
        failedRuleIds: [], referenceCandle: model === "BOC" ? {
          openEpoch: 1_800, closeEpoch: 2_100, openTicks: 105, highTicks: 110, lowTicks: 100, closeTicks: 102,
        } : null, contactCandle: null, recrossCandle: null,
      },
    }],
    tradePlan: { tickSize: "0.00001", entryTicks: 109, stopTicks: 101, targetTicks: 151 },
    openedEconomicSelection: null, paperIntentId: null, trade: null,
    shadowOutcome: { state: "OPEN", outcomeRMillis: null },
  };
}

function evidenceDecision(): EntryDecisionItem {
  const item = decision();
  const rejected = decision("rejected", "BOC").candidates[0]!;
  rejected.state = "REJECTED";
  rejected.evidence.fidelity = "UNRESOLVED";
  rejected.evidence.passedRuleIds = [];
  rejected.evidence.failedRuleIds = ["BOC_WRONG_DIRECTION"];
  const blocked = decision("blocked").candidates[0]!;
  blocked.model = "HTF_FLIP";
  blocked.state = "BLOCKED";
  blocked.evidence.fidelity = "UNRESOLVED";
  blocked.evidence.proofPlane = "REALTIME_TICK";
  blocked.evidence.replayability = "LIVE_EXACT_NON_REPLAYABLE";
  blocked.evidence.htfContextMinutes = [15, 30];
  blocked.evidence.passedRuleIds = [];
  blocked.evidence.failedRuleIds = ["HTF_FLIP_ORDER_UNPROVEN"];
  blocked.evidence.ambiguityCodes = ["SHADOW_SAME_CHILD_BAR_ORDER"];
  blocked.evidence.contactCandle = {
    openEpoch: 1_800, closeEpoch: 1_900, openTicks: 105, highTicks: 111, lowTicks: 100, closeTicks: 105,
  };
  blocked.evidence.recrossCandle = {
    openEpoch: 1_900, closeEpoch: 2_100, openTicks: 105, highTicks: 112, lowTicks: 104, closeTicks: 109,
  };
  item.candidates.push(rejected, blocked);
  return item;
}

function linkedDecision(): EntryDecisionItem {
  const item = decision("GBPUSD", "BOC");
  item.selection.reason = "ONLY_EXACT_TRIGGER";
  item.selection.action = "PAPER_ELIGIBLE";
  item.selection.effectiveActionReason = null;
  item.paperIntentId = "intent-paper-a";
  item.trade = { entryPrice: "1.23450", stopLoss: "1.22000", takeProfit: "1.26000", state: "OPEN" };
  item.openedEconomicSelection = {
    decisionId: item.decisionId, selectionId: item.selection.selectionId,
    canonicalModel: "BOC", reason: "ONLY_EXACT_TRIGGER", evaluatedAtEpoch: 2_400,
  };
  return item;
}

const intent: PaperSimulationIntent = {
  intentId: "intent-paper-a", symbol: "GBPUSD", side: "BUY", entryPrice: "1.23450",
  stopLoss: "1.22000", takeProfit: "1.26000", riskBps: 100, source: "TRADINGVIEW",
  sourceReceiptId: "receipt-a", setupId: "setup-GBPUSD", selectedEntryModel: "BOC", coTriggeredModels: [],
  state: "OPEN", createdAt: "2026-09-02T12:00:00Z", outcomeRMillis: null, exitReason: null, settledAt: null,
  allocations: [{ accountId: "account-a", riskAmountMinor: 100, balanceBeforeMinor: 10_000, pnlMinor: null }],
};

function Harness(props: Partial<SetupTableProps>) {
  const [query, setQuery] = useState("");
  const [model, setModel] = useState<EntryModel | null>(null);
  return <SetupTable decisions={[evidenceDecision(), linkedDecision()]} intents={[intent]} status="ready"
    accountId={null} query={query} model={model} onQueryChange={setQuery} onModelChange={setModel} {...props} />;
}

afterEach(cleanup);

describe("TradeOps setup table", () => {
  it("searches EURUSD and switches the controlled entry-model filter", () => {
    render(<Harness />);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search setups" }), { target: { value: "eurusd" } });
    expect(screen.getByRole("button", { name: "Inspect EURUSD setup" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Inspect GBPUSD setup" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Entry model" }), { target: { value: "BOC" } });
    expect(screen.queryByRole("button", { name: "Inspect EURUSD setup" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Inspect GBPUSD setup" })).toBeVisible();
  });

  it("shows UTC seconds, effective action and readable raw reason codes", () => {
    render(<Harness />);
    const table = within(screen.getByRole("table", { name: "Setup decisions" }));
    expect(table.getAllByText("1970-01-01 00:40:00 UTC")).toHaveLength(2);
    expect(table.getByText("SHADOW_ONLY")).toBeVisible();
    expect(table.getByText("FALLBACK_TO_CONFIRMED_CLOSE")).toBeVisible();
    expect(table.getByText("PROMOTION_IDENTITY_MISMATCH")).toBeVisible();
    fireEvent.click(table.getByRole("button", { name: "Inspect linked paper intent intent-paper-a" }));
    const inspector = within(screen.getByRole("region", { name: "Setup evidence inspector" }));
    const paperDetails = inspector.getByRole("region", { name: "Linked paper intent details" });
    expect(paperDetails).toHaveAttribute("id", "paper-intent-intent-paper-a");
    expect(within(paperDetails).getByText("1.23450")).toBeVisible();
    expect(inspector.getByRole("link", { name: "Paper intent intent-paper-a" })).toHaveAttribute("href", "#paper-intent-intent-paper-a");
    expect(screen.getByText(/at most 50.*not an exhaustive/i)).toBeVisible();
  });

  it("opens current evidence and preserves rejection, shadow and all raw rule details", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Inspect EURUSD setup" }));
    expect(screen.getByRole("button", { name: "Inspect EURUSD setup" })).toHaveAttribute("aria-expanded", "true");
    const inspector = within(screen.getByRole("region", { name: "Setup evidence inspector" }));
    for (const text of ["MATCHED", "BLOCKED", "REJECTED", "BOC_WRONG_DIRECTION", "ENTRY_DIR_CLOSE",
      "HTF_FLIP_ORDER_UNPROVEN", "REPLAYABLE", "LIVE_EXACT_NON_REPLAYABLE", "SHADOW_SAME_CHILD_BAR_ORDER",
      "Break direction does not match the setup", "Parity mismatch · ACTION", "Shadow open"]) {
      expect(inspector.getAllByText(text).length).toBeGreaterThan(0);
    }
    expect(inspector.getByText(/Plan ticks are not broker fill prices/)).toBeVisible();
    expect(inspector.getByText(/Candidate evidence, receipts and PAPER_ELIGIBLE do not prove a filled order/)).toBeVisible();
    expect(inspector.getByText("0.00001")).toBeVisible();
    expect(within(inspector.getByRole("region", { name: "HTF_FLIP raw evidence" })).getByText("15m · 30m")).toBeVisible();
    expect(inspector.getByRole("heading", { name: "Raw evidence · HTF_FLIP" })).toBeVisible();
    expect(inspector.getByText(/O 105 · H 112 · L 104 · C 109 ticks/)).toBeVisible();
    fireEvent.click(inspector.getByRole("button", { name: "Close setup inspector" }));
    expect(screen.queryByRole("region", { name: "Setup evidence inspector" })).not.toBeInTheDocument();
  });

  it("shows supplied decimal paper prices and preserves latest versus opened selection", () => {
    const item = linkedDecision();
    item.selection.canonicalModel = "DIR_CLOSE";
    const latest = decision().candidates[0]!;
    item.candidates.push(latest);
    item.selection.canonicalCandidateId = latest.candidateId;
    item.selection.canonicalEvidenceId = latest.evidence.evidenceId;
    item.selection.action = "SHADOW_ONLY";
    item.selection.effectiveActionReason = "NOT_SELECTED_ALREADY_OPEN";
    render(<Harness decisions={[item]} />);
    fireEvent.click(screen.getByRole("button", { name: "Inspect GBPUSD setup" }));
    const inspector = within(screen.getByRole("region", { name: "Setup evidence inspector" }));
    for (const text of ["1.23450", "1.22000", "1.26000", "BOC already open", "NOT_SELECTED_ALREADY_OPEN"]) {
      expect(inspector.getAllByText(text).length).toBeGreaterThan(0);
    }
    expect(inspector.getByText(/Latest selection.*DIR_CLOSE/)).toBeVisible();
    expect(inspector.getByText(/Paper state.*OPEN/)).toBeVisible();
  });

  it("filters account membership only through linked intent allocations", () => {
    const { rerender } = render(<Harness accountId="account-a" />);
    expect(screen.getByRole("button", { name: "Inspect GBPUSD setup" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Inspect EURUSD setup" })).not.toBeInTheDocument();
    expect(screen.getByText(/unlinked decisions are excluded.*loaded intent window/i)).toBeVisible();
    rerender(<Harness accountId="account-a" intents={[{ ...intent, allocations: [{ ...intent.allocations[0]!, accountId: "account-b" }] }]} />);
    expect(screen.getByText("No setups match the current filters.")).toBeVisible();
  });

  it("retains all co-trigger models and distinguishes no selected model from no evidence", () => {
    const item = linkedDecision();
    item.selection.reason = "CO_TRIGGER_SAME_EVENT";
    item.openedEconomicSelection!.reason = "CO_TRIGGER_SAME_EVENT";
    item.selection.coTriggeredModels = ["BOC", "DIR_CLOSE"];
    item.candidates.push(decision().candidates[0]!);
    const { rerender } = render(<Harness decisions={[item]} />);
    fireEvent.click(screen.getByRole("button", { name: "Inspect GBPUSD setup" }));
    expect(screen.getByText("Co-trigger · BOC + Directional close")).toBeVisible();
    const blocked = evidenceDecision();
    blocked.candidates = blocked.candidates.filter((candidate) => candidate.state !== "MATCHED");
    blocked.selection = { ...blocked.selection, canonicalCandidateId: null, canonicalEvidenceId: null,
      canonicalModel: null, fidelity: null, reason: "NO_EXACT_CANDIDATE", policyAction: "SHADOW_ONLY",
      effectiveActionReason: null, selectedTriggerEpoch: null, selectedTriggerSequence: null };
    rerender(<Harness decisions={[blocked]} />);
    expect(within(screen.getByRole("table")).getByText("None selected")).toBeVisible();
    expect(screen.getByText("NO_EXACT_CANDIDATE")).toBeVisible();
  });

  it("clears a selected record on lock and does not restore it on unlock", () => {
    const { rerender } = render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Inspect EURUSD setup" }));
    rerender(<Harness status="unavailable" />);
    expect(screen.queryByRole("region", { name: "Setup evidence inspector" })).not.toBeInTheDocument();
    expect(screen.queryByText("BOC_WRONG_DIRECTION")).not.toBeInTheDocument();
    rerender(<Harness />);
    expect(screen.queryByRole("region", { name: "Setup evidence inspector" })).not.toBeInTheDocument();
  });

  it("clears selection when the current records or filters remove the decision", () => {
    const { rerender } = render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Inspect EURUSD setup" }));
    rerender(<Harness decisions={[]} />);
    expect(screen.queryByRole("region", { name: "Setup evidence inspector" })).not.toBeInTheDocument();
    rerender(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Inspect EURUSD setup" }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "GBPUSD" } });
    expect(screen.queryByRole("region", { name: "Setup evidence inspector" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "" } });
    expect(screen.queryByRole("region", { name: "Setup evidence inspector" })).not.toBeInTheDocument();
  });

  it("renders loading, unavailable and known-empty states without leaking supplied records", () => {
    const { rerender } = render(<Harness status="loading" />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading setup decisions");
    expect(screen.queryByText("EURUSD")).not.toBeInTheDocument();
    rerender(<Harness status="unavailable" />);
    expect(screen.getByText(/Setup decisions unavailable/)).toBeVisible();
    rerender(<Harness decisions={[]} />);
    expect(screen.getByText("No setup decisions in the loaded window.")).toBeVisible();
  });

  it("handles unrepresentable dates without crashing and retains the raw epoch", () => {
    const item = decision();
    item.selection.evaluatedAtEpoch = Number.MAX_SAFE_INTEGER;
    render(<Harness decisions={[item]} />);
    expect(screen.getByText("UTC unavailable")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Inspect EURUSD setup" }));
    expect(screen.getByText(/Raw evaluated epoch.*9007199254740991.*seconds/)).toBeVisible();
  });

  it("shows no more than the 50 returned records before applying filters", () => {
    const decisions = Array.from({ length: 51 }, (_, i) => decision(`SYMBOL${i}`));
    render(<Harness decisions={decisions} />);
    expect(screen.getAllByRole("button", { name: /Inspect .* setup/ })).toHaveLength(50);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "SYMBOL50" } });
    expect(screen.getByText("No setups match the current filters.")).toBeVisible();
  });
});

describe("SetupInspector current-record selection", () => {
  it("derives updated evidence by ID and renders nothing if that ID is missing", () => {
    const item = evidenceDecision();
    const { rerender } = render(<SetupInspector decisions={[item]} selectedId={item.decisionId} onClose={() => {}} />);
    expect(screen.getByText("Shadow open")).toBeVisible();
    rerender(<SetupInspector decisions={[{ ...item, shadowOutcome: { state: "TARGET_HIT", outcomeRMillis: 2_000 } }]} selectedId={item.decisionId} onClose={() => {}} />);
    expect(screen.getByText("Shadow target hit · 2.00R")).toBeVisible();
    expect(screen.queryByText("Shadow open")).not.toBeInTheDocument();
    rerender(<SetupInspector decisions={[]} selectedId={item.decisionId} onClose={() => {}} />);
    expect(screen.queryByRole("region", { name: "Setup evidence inspector" })).not.toBeInTheDocument();
  });
});
