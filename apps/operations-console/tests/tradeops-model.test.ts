import { describe, expect, it } from "vitest";
import {
  buildAccountViews,
  formatMinor,
  formatMinorTotal,
  selectDecisions,
  selectIntents,
  summarizeAccounts,
  summarizeIntentWindow,
} from "../src/features/tradeops/model";
import type { PaperLedgerAccount } from "../src/features/tradeops/ledger-api";
import type { PaperSimulationAccount, PaperSimulationIntent } from "../src/lib/api";
import type { EntryDecisionItem } from "../src/lib/entry-decisions";

function ledger(overrides: Partial<PaperLedgerAccount> = {}): PaperLedgerAccount {
  return {
    accountId: "paper-a", label: "Paper A", currencyCode: "USD", currencyScale: 2,
    openingBalanceMinor: 1_000, ledgerDeltaMinor: -125, balanceMinor: 875,
    lastSequence: 1, createdAt: "2026-09-02T00:00:00Z", ...overrides,
  };
}

function simulation(overrides: Partial<PaperSimulationAccount> = {}): PaperSimulationAccount {
  return {
    accountId: "paper-a", label: "Paper A", currencyCode: "USD", currencyScale: 2,
    balanceMinor: 875, realizedPnlMinor: -125, openRiskMinor: 100, openPositions: 1,
    settledTrades: 4, winningTrades: 1, losingTrades: 3, maxDrawdownMinor: 200,
    ...overrides,
  };
}

function intent(overrides: Partial<PaperSimulationIntent> = {}): PaperSimulationIntent {
  return {
    intentId: "intent-a", symbol: "EURUSD", side: "BUY", entryPrice: "1.10",
    stopLoss: "1.09", takeProfit: "1.12", riskBps: 100, source: "TRADINGVIEW",
    sourceReceiptId: "receipt-a", setupId: "setup-a", selectedEntryModel: "BOC",
    coTriggeredModels: [], state: "OPEN", createdAt: "2026-09-02T00:00:00Z",
    outcomeRMillis: null, exitReason: null, settledAt: null,
    allocations: [{ accountId: "paper-a", riskAmountMinor: 100, balanceBeforeMinor: 1_000, pnlMinor: null }],
    ...overrides,
  };
}

function decision(overrides: Partial<EntryDecisionItem> = {}): EntryDecisionItem {
  return {
    decisionId: "decision-a", setupId: "setup-a", attemptKind: "INITIAL", symbol: "EURUSD",
    direction: "LONG", selection: {
      selectionId: "selection-a", setupId: "setup-a", revision: 1,
      canonicalCandidateId: null, canonicalEvidenceId: null, canonicalModel: "BOC",
      reason: "ONLY_EXACT_TRIGGER", fidelity: "EXACT", policyAction: "PAPER_ELIGIBLE",
      action: "PAPER_ELIGIBLE", effectiveActionReason: null, coTriggeredModels: [],
      evaluatedAtEpoch: 1_788_307_200, selectedTriggerEpoch: null, selectedTriggerSequence: null,
    },
    parity: { status: "NOT_PROVIDED", mismatchReason: null }, candidates: [],
    tradePlan: { tickSize: "0.00001", entryTicks: 110_000, stopTicks: 109_000, targetTicks: 112_000 },
    openedEconomicSelection: null, paperIntentId: "intent-a", trade: null, shadowOutcome: null,
    ...overrides,
  };
}

describe("minor-unit formatting", () => {
  it.each([
    [null, "USD", 2, "—"], [0, "USD", 2, "USD 0.00"],
    [-125, "USD", 2, "USD -1.25"], [123, "JPY", 0, "JPY 123"],
    [12_345, "KWD", 3, "KWD 12.345"], [1, "USD", 8, "USD 0.00000001"],
    [Number.MAX_SAFE_INTEGER, "USD", 2, "USD 90071992547409.91"],
    [Number.MIN_SAFE_INTEGER, "USD", 2, "USD -90071992547409.91"],
  ] as const)("formats %s %s at scale %s exactly", (value, currency, scale, expected) => {
    expect(formatMinor(value, currency, scale)).toBe(expected);
  });

  it.each([Number.MAX_SAFE_INTEGER + 1, 0.1, NaN, Infinity, -Infinity])("refuses unsafe input %s", (value) => {
    expect(formatMinor(value, "USD", 2)).toBe("—");
  });

  it.each([-1, 9, 1.5, NaN, Infinity])("refuses invalid scale %s", (scale) => {
    expect(formatMinor(123, "USD", scale)).toBe("—");
    expect(formatMinorTotal(123n, "USD", scale)).toBe("—");
  });

  it("formats exact aggregate totals beyond Number's safe range", () => {
    expect(formatMinorTotal(18_014_398_509_481_982n, "USD", 2)).toBe("USD 180143985094819.82");
    expect(formatMinorTotal(null, "USD", 2)).toBe("—");
  });
});

describe("read-only filters", () => {
  const a = intent();
  const b = intent({ intentId: "intent-b", symbol: "GBPUSD", setupId: "setup-b", selectedEntryModel: "HTF_FLIP" });
  const c = intent({ intentId: "intent-c", selectedEntryModel: "DIR_CLOSE", allocations: [{ ...a.allocations[0]!, accountId: "paper-b" }] });

  it("filters account allocations and selected entry model while preserving source order", () => {
    expect(selectIntents([c, b, a], "paper-a", null, "")).toEqual([b, a]);
    expect(selectIntents([c, b, a], "paper-a", "BOC", "")).toEqual([a]);
    expect(selectIntents([c, b, a], null, null, "")).toEqual([c, b, a]);
  });

  it.each(["eurusd", "INTENT-A", "  SETUP-A  "])("searches the intent's symbol, ID, and setup: %s", (query) => {
    expect(selectIntents([b, a], null, null, query)).toEqual([a]);
  });

  it("handles missing setup and model without synthetic matches", () => {
    expect(selectIntents([intent({ setupId: null, selectedEntryModel: null })], null, "BOC", "")).toEqual([]);
    expect(selectIntents([intent({ setupId: null })], null, null, "null")).toEqual([]);
  });

  it("links decisions to accounts only through explicit paperIntentId allocations", () => {
    const linked = decision();
    const shadow = decision({ decisionId: "shadow-a", paperIntentId: null, shadowOutcome: { state: "TARGET_HIT", outcomeRMillis: 2_000 } });
    const missing = decision({ decisionId: "missing-a", paperIntentId: "not-loaded" });
    const other = decision({ decisionId: "other-a", paperIntentId: "intent-c" });
    const decisions = [shadow, missing, other, linked];
    expect(selectDecisions(decisions, [a, c], "paper-a", null, "")).toEqual([linked]);
    expect(selectDecisions(decisions, [a, c], null, null, "")).toEqual(decisions);
    expect(selectDecisions(decisions, [], "paper-a", null, "")).toEqual([]);
  });

  it("filters the decision's canonical model, not its linked intent's model", () => {
    const base = decision();
    const selected = decision({ selection: { ...base.selection, canonicalModel: "HTF_FLIP" } });
    expect(selectDecisions([selected], [a], "paper-a", "HTF_FLIP", "")).toEqual([selected]);
    expect(selectDecisions([selected], [a], "paper-a", "BOC", "")).toEqual([]);
  });

  it.each(["eurusd", "DECISION-A", "  SETUP-A  "])("searches decision fields: %s", (query) => {
    expect(selectDecisions([decision({ decisionId: "other", symbol: "GBPUSD", setupId: "other" }), decision()], [], null, null, query)).toEqual([decision()]);
  });
});

describe("account views and source aggregates", () => {
  it("builds a stable union, preserving both source objects and missing halves", () => {
    const ledgerA = ledger();
    const ledgerB = ledger({ accountId: "paper-b" });
    const simulationA = simulation();
    const simulationC = simulation({ accountId: "paper-c" });
    const views = buildAccountViews([ledgerA, ledgerB], [simulationA, simulationC]);
    expect(views.map((view) => view.accountId)).toEqual(["paper-a", "paper-b", "paper-c"]);
    expect(views[0]).toMatchObject({ ledger: ledgerA, simulation: simulationA, currencyCompatibility: "MATCH", brokerEquityMinor: null, winRatePercent: 25 });
    expect(views[0]?.ledger).toBe(ledgerA);
    expect(views[0]?.simulation).toBe(simulationA);
    expect(views[1]).toMatchObject({ simulation: null, currencyCompatibility: "SINGLE_SOURCE", winRatePercent: null });
    expect(views[2]).toMatchObject({ ledger: null, currencyCompatibility: "SINGLE_SOURCE" });
    expect(views.every((view) => view.brokerEquityMinor === null)).toBe(true);
  });

  it("keeps zero balances and zero-trade win rate distinct from unavailable", () => {
    const views = buildAccountViews([ledger({ balanceMinor: 0 })], [simulation({ balanceMinor: 0, settledTrades: 0, winningTrades: 0, losingTrades: 0 })]);
    expect(views[0]?.ledger?.balanceMinor).toBe(0);
    expect(views[0]?.simulation?.balanceMinor).toBe(0);
    expect(views[0]?.winRatePercent).toBeNull();
    expect(buildAccountViews(null, null)).toEqual([]);
  });

  it.each([{ currencyCode: "EUR" }, { currencyScale: 3 }])("marks incompatible joins explicitly: %j", (overrides) => {
    const result = buildAccountViews([ledger()], [simulation(overrides)]);
    expect(result[0]?.currencyCompatibility).toBe("MISMATCH");
    const summary = summarizeAccounts([ledger()], [simulation(overrides)]);
    expect(summary.currencyMismatchAccountIds).toEqual(["paper-a"]);
    expect(summary.ledger?.groups[0]?.currencyCode).toBe("USD");
    expect(summary.simulation?.groups[0]).toMatchObject({ currencyCode: overrides.currencyCode ?? "USD", currencyScale: overrides.currencyScale ?? 2 });
  });

  it("preserves unavailable sources independently from known-empty sources", () => {
    expect(summarizeAccounts(null, null)).toEqual({ scope: "ACCOUNT_AGGREGATES", ledger: null, simulation: null, currencyMismatchAccountIds: [] });
    const empty = summarizeAccounts([], []);
    expect(empty.ledger).toEqual({ accountCount: 0, groups: [] });
    expect(empty.simulation).toEqual({ accountCount: 0, groups: [], openPositions: 0, settledTrades: 0, winningTrades: 0, losingTrades: 0, winRatePercent: null });
    expect(summarizeAccounts([], null).simulation).toBeNull();
    expect(summarizeAccounts(null, []).ledger).toBeNull();
  });

  it("groups monetary totals by both currency and scale without combining the two balance sources", () => {
    const ledgerAccounts = [ledger(), ledger({ accountId: "b", currencyCode: "EUR" }), ledger({ accountId: "c", currencyScale: 3 })];
    const simulationAccounts = [simulation(), simulation({ accountId: "b", currencyCode: "EUR" }), simulation({ accountId: "c", currencyScale: 3 })];
    const summary = summarizeAccounts(ledgerAccounts, simulationAccounts);
    expect(summary.ledger?.groups.map((group) => [group.currencyCode, group.currencyScale, group.balanceMinor])).toEqual([["USD", 2, 875n], ["EUR", 2, 875n], ["USD", 3, 875n]]);
    expect(summary.simulation?.groups.map((group) => group.balanceMinor)).toEqual([875n, 875n, 875n]);
    expect(summary.simulation?.groups[0]).toMatchObject({ realizedPnlMinor: -125n, openRiskMinor: 100n });
    expect(summary.simulation).toMatchObject({ openPositions: 3, settledTrades: 12, winningTrades: 3, losingTrades: 9, winRatePercent: 25 });
  });

  it("sums maximum-safe monetary inputs exactly even when the total exceeds Number's safe range", () => {
    const accounts = [ledger({ balanceMinor: Number.MAX_SAFE_INTEGER }), ledger({ accountId: "b", balanceMinor: Number.MAX_SAFE_INTEGER })];
    expect(summarizeAccounts(accounts, null).ledger?.groups[0]?.balanceMinor).toBe(18_014_398_509_481_982n);
    const simulations = [simulation({ realizedPnlMinor: Number.MIN_SAFE_INTEGER }), simulation({ accountId: "b", realizedPnlMinor: Number.MIN_SAFE_INTEGER })];
    expect(summarizeAccounts(null, simulations).simulation?.groups[0]?.realizedPnlMinor).toBe(-18_014_398_509_481_982n);
  });

  it("refuses unsafe monetary inputs without replacing unknown totals with zero", () => {
    expect(summarizeAccounts([ledger({ balanceMinor: Number.MAX_SAFE_INTEGER + 1 }), ledger({ accountId: "b" })], null).ledger?.groups[0]?.balanceMinor).toBeNull();
    expect(summarizeAccounts(null, [simulation({ realizedPnlMinor: 0.1 })]).simulation?.groups[0]?.realizedPnlMinor).toBeNull();
  });

  it("refuses overflowed count totals and invalid account win rates", () => {
    const summary = summarizeAccounts(null, [simulation({ openPositions: Number.MAX_SAFE_INTEGER }), simulation({ accountId: "b" })]);
    expect(summary.simulation?.openPositions).toBeNull();
    expect(buildAccountViews(null, [simulation({ settledTrades: 0, winningTrades: 1 })])[0]?.winRatePercent).toBeNull();
    expect(buildAccountViews(null, [simulation({ settledTrades: 1, winningTrades: 2 })])[0]?.winRatePercent).toBeNull();
  });
});

describe("loaded intent window metrics", () => {
  it("distinguishes unavailable data from an empty loaded window", () => {
    expect(summarizeIntentWindow(null)).toBeNull();
    expect(summarizeIntentWindow([])).toEqual({ scope: "LOADED_INTENT_WINDOW", outcomeBasis: "SETTLED_OUTCOME_R", intentCount: 0, openIntents: 0, settledIntents: 0, winningIntents: 0, losingIntents: 0, breakevenIntents: 0, unknownOutcomeIntents: 0, winRatePercent: null });
  });

  it("counts only the supplied window and keeps its outcomes separate from account aggregates", () => {
    const window = summarizeIntentWindow([
      intent(), intent({ intentId: "win", state: "SETTLED", outcomeRMillis: 2_000 }),
      intent({ intentId: "loss", state: "SETTLED", outcomeRMillis: -1_000 }),
      intent({ intentId: "flat", state: "SETTLED", outcomeRMillis: 0 }),
    ]);
    expect(window).toEqual({ scope: "LOADED_INTENT_WINDOW", outcomeBasis: "SETTLED_OUTCOME_R", intentCount: 4, openIntents: 1, settledIntents: 3, winningIntents: 1, losingIntents: 1, breakevenIntents: 1, unknownOutcomeIntents: 0, winRatePercent: 100 / 3 });
    expect(summarizeAccounts(null, [simulation({ settledTrades: 100, winningTrades: 60, losingTrades: 40 })]).simulation).toMatchObject({ settledTrades: 100, winRatePercent: 60 });
  });

  it("does not treat unknown settlement outcomes as breakeven or claim a known win rate", () => {
    const window = summarizeIntentWindow([intent({ state: "SETTLED", outcomeRMillis: null })]);
    expect(window).toMatchObject({ settledIntents: 1, winningIntents: 0, losingIntents: 0, breakevenIntents: 0, unknownOutcomeIntents: 1, winRatePercent: null });
  });

  it("counts multi-account intents once instead of treating allocations as trades", () => {
    const base = intent();
    expect(summarizeIntentWindow([intent({ allocations: [...base.allocations, { ...base.allocations[0]!, accountId: "paper-b" }] })])).toMatchObject({ intentCount: 1, openIntents: 1 });
  });
});
