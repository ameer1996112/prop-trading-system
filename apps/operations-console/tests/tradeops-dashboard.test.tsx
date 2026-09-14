import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TradeOpsDashboard } from "../src/features/tradeops/TradeOpsDashboard";
import { PaperAuthorizationError, type PaperReadinessSnapshot, type PaperSimulationAccount, type PaperSimulationIntent } from "../src/lib/api";
import type { EntryDecisionItem, EntryModel } from "../src/lib/entry-decisions";
import type { PaperLedgerAccount } from "../src/features/tradeops/ledger-api";
import type { TradeOpsLoaders } from "../src/features/tradeops/session";

const time = "2026-09-02T12:00:00Z";
function ledger(accountId = "paper-a", currencyCode = "EUR", currencyScale = 2): PaperLedgerAccount {
  return { accountId, label: accountId === "paper-a" ? "Paper A" : "Paper B", currencyCode, currencyScale,
    openingBalanceMinor: 10_000, ledgerDeltaMinor: 0, balanceMinor: 10_000, lastSequence: 1, createdAt: time };
}
function account(accountId = "paper-a", currencyCode = "EUR", currencyScale = 2): PaperSimulationAccount {
  return { accountId, label: accountId === "paper-a" ? "Paper A" : "Paper B", currencyCode, currencyScale,
    balanceMinor: 10_000, realizedPnlMinor: 0, openRiskMinor: 100, openPositions: 1,
    settledTrades: 9, winningTrades: 6, losingTrades: 3, maxDrawdownMinor: 200 };
}
function intent(symbol = "EURUSD", accountId = "paper-a", model: EntryModel = "BOC", state: "OPEN" | "SETTLED" = "OPEN"): PaperSimulationIntent {
  return { intentId: `intent-${symbol}`, symbol, side: "BUY", entryPrice: "1.234500000", stopLoss: "1.220000000", takeProfit: "1.260000000",
    riskBps: 100, source: "TRADINGVIEW", sourceReceiptId: `receipt-${symbol}`, setupId: `setup-${symbol}`,
    selectedEntryModel: model, coTriggeredModels: [model], state, createdAt: time,
    outcomeRMillis: state === "SETTLED" ? 2_000 : null, exitReason: state === "SETTLED" ? "TARGET" : null,
    settledAt: state === "SETTLED" ? "2026-09-02T13:00:00Z" : null,
    allocations: [{ accountId, riskAmountMinor: 100, balanceBeforeMinor: 10_000, pnlMinor: state === "SETTLED" ? 200 : null }] };
}
function decision(record: PaperSimulationIntent): EntryDecisionItem {
  return { decisionId: `decision-${record.symbol}`, setupId: record.setupId!, attemptKind: "INITIAL", symbol: record.symbol, direction: "LONG",
    selection: { selectionId: `selection-${record.symbol}`, setupId: record.setupId!, revision: 0,
      canonicalCandidateId: null, canonicalEvidenceId: null, canonicalModel: record.selectedEntryModel,
      reason: "NO_CANDIDATE", fidelity: null, policyAction: "OBSERVE", action: "OBSERVE", effectiveActionReason: null,
      coTriggeredModels: [], evaluatedAtEpoch: 2_400, selectedTriggerEpoch: null, selectedTriggerSequence: null },
    parity: { status: "NOT_PROVIDED", mismatchReason: null }, candidates: [],
    tradePlan: { tickSize: "0.00001", entryTicks: 123450, stopTicks: 122000, targetTicks: 126000 },
    openedEconomicSelection: null, paperIntentId: record.intentId,
    trade: { entryPrice: record.entryPrice, stopLoss: record.stopLoss, takeProfit: record.takeProfit, state: record.state }, shadowOutcome: null };
}
function readiness(): PaperReadinessSnapshot {
  return { state: "DEGRADED", evaluatedAt: time, execution: "DISABLED",
    thresholds: { receiptMaxAgeSeconds: 60, staleTradeSeconds: 900, maxDailyLossBps: 500, maxTotalDrawdownBps: 1_000, maxOpenRiskBps: 300, maxOpenPositions: 4 },
    killSwitch: { enabled: false, reason: null, changedAt: null },
    latestReceipt: { receiptId: "receipt-latest", receivedAt: time, producerInstanceId: "producer-a", sequence: 7, symbol: "EURUSD", ageSeconds: 12 },
    openHealth: { openIntents: 2, staleOpenIntents: 1, oldestOpenIntentAt: time },
    accounts: [{ accountId: "paper-a", label: "Paper A", state: "STOPPED", dailyPnlMinor: -150, dailyLossBps: 600, totalDrawdownBps: 700, openRiskBps: 100, openPositions: 1,
      reasons: [{ code: "DAILY_LOSS_LIMIT", accountId: "paper-a", message: "Daily paper loss threshold reached." }] }],
    reasons: [{ code: "STALE_OPEN_INTENT", accountId: null, message: "One paper intent is stale." }] };
}
function loaders(): TradeOpsLoaders {
  const intents = [intent(), intent("GBPUSD", "paper-b", "DIR_CLOSE"), intent("USDJPY", "paper-a", "BOC", "SETTLED")];
  return {
    health: vi.fn<TradeOpsLoaders["health"]>(async () => ({ state: "ONLINE", paperSimulator: "ENABLED", execution: "DISABLED", message: "Online." })),
    receipts: vi.fn<TradeOpsLoaders["receipts"]>(async () => ({ state: "RECEIVED", ingressEnabled: true, count: 3, message: "Recent observations.",
      items: (["TEST", "TRADINGVIEW", "OTHER"] as const).map((source, index) => ({ source, symbol: "PUBLIC-SYMBOL", feed: "FXCM", kind: "CANDLE", sequence: index + 7, status: "RECEIVED" as const, receivedAt: time })) })),
    ledger: vi.fn(async () => [ledger(), ledger("paper-b", "USD", 3)]),
    simulation: vi.fn(async () => ({ accounts: [account(), account("paper-b", "USD", 3)], intents })),
    readiness: vi.fn(async () => readiness()),
    decisions: vi.fn<TradeOpsLoaders["decisions"]>(async () => ({ state: "READY", items: intents.map(decision), message: "Latest decisions." })),
  };
}
async function mount(api = loaders()) {
  render(<TradeOpsDashboard sessionOptions={{ loaders: api, now: () => Date.parse(time) }} />);
  await act(async () => {});
  return api;
}
async function unlock() {
  const input = screen.getByLabelText("Paper operator credential") as HTMLInputElement;
  fireEvent.change(input, { target: { value: "test-only-memory-value" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Unlock paper data" })); });
  expect(input.value).toBe("");
}
function navigate(name: string) { fireEvent.click(within(screen.getByRole("navigation", { name: "TradeOps navigation" })).getByRole("link", { name })); }
function positions() { return within(screen.getByRole("region", { name: "Open paper positions" })); }

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("Unexpected network request in composed-loader test"); }));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("TradeOps composed read-only dashboard", () => {
  it("keeps source inspection on Accounts and removes unrelated intent filters", async () => {
    await mount(); await unlock(); navigate("Accounts");
    expect(screen.queryByRole("searchbox", { name: "Search paper intents" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Inspect paper account Paper A" }));
    expect(screen.getByRole("region", { name: "Account source details" })).toBeVisible();
    navigate("Risk & Rules");
    expect(screen.queryByRole("combobox", { name: "Entry model" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Fleet Summary" })).toBeVisible();
    expect(screen.getByText("Guard Rails")).toBeVisible();
  });
  it("filters original Risk account cards while keeping Fleet Summary all-account", async () => {
    const api = loaders(); const data = readiness();
    data.accounts.push({ ...data.accounts[0]!, accountId: "paper-b", label: "Paper B", reasons: [] });
    api.readiness = vi.fn(async () => data);
    await mount(api); await unlock(); navigate("Risk & Rules");
    expect(screen.getAllByText("Guard Rails")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Filter by Paper B" }));
    expect(screen.getAllByText("Guard Rails")).toHaveLength(1);
    expect(screen.queryByText("DAILY_LOSS_LIMIT · Daily paper loss threshold reached.")).not.toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Fleet Summary" })).getByText("Total Accounts").nextElementSibling).toHaveTextContent("2");
  });
  it("opens a loaded paper journal record and clears it when the session locks", async () => {
    await mount(); await unlock(); navigate("Journal");
    fireEvent.click(screen.getByRole("button", { name: "Inspect USDJPY paper trade" }));
    expect(screen.getByRole("region", { name: "Paper trade details" })).toHaveTextContent("receipt-USDJPY");
    fireEvent.change(screen.getByRole("combobox", { name: "Settlement status" }), { target: { value: "STOP" } });
    expect(screen.queryByRole("button", { name: "Inspect USDJPY paper trade" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Paper trade details" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Lock paper data" }));
    expect(screen.queryByText("receipt-USDJPY")).not.toBeInTheDocument();
  });
  it("keeps one compact unlock path on each original page without requesting private data", async () => {
    const api = await mount();
    for (const view of ["Dashboard", "Accounts", "Risk & Rules", "Analytics", "Journal"]) {
      navigate(view);
      expect(screen.getAllByRole("form", { name: "Unlock paper data" })).toHaveLength(1);
      expect(screen.queryByRole("heading", { name: "Unlock your paper workspace" })).not.toBeInTheDocument();
      if (view === "Dashboard") {
        expect(screen.getByRole("region", { name: "Observation log" })).toBeVisible();
        expect(screen.getByRole("region", { name: "Account aggregates" })).toBeInTheDocument();
        expect(screen.getByRole("region", { name: "Open paper positions" })).toBeInTheDocument();
      }
    }
    for (const key of ["ledger", "simulation", "readiness", "decisions"] as const) expect(api[key]).not.toHaveBeenCalled();
    await unlock();
    expect(screen.queryByRole("form", { name: "Unlock paper data" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Paper journal" })).toBeVisible();
  });

  it("keeps diagnostics collapsed by default and expands existing resources without extra requests", async () => {
    const api = await mount();
    const details = screen.getByText("Connection details").closest("details")!;
    expect(details).not.toHaveAttribute("open");
    const calls = Object.values(api).map((loader) => vi.mocked(loader).mock.calls.length);
    fireEvent.click(screen.getByText("Connection details"));
    expect(details).toHaveAttribute("open");
    expect(screen.getByRole("status", { name: "API health freshness" })).toHaveTextContent("Current");
    expect(screen.getByRole("status", { name: "Ledger freshness" })).toHaveTextContent("Locked");
    fireEvent.click(screen.getByText("Connection details"));
    expect(details).not.toHaveAttribute("open");
    expect(Object.values(api).map((loader) => vi.mocked(loader).mock.calls.length)).toEqual(calls);
  });

  it("keeps failed and paused resources visible even when connection details are collapsed", async () => {
    const api = await mount(); await unlock();
    vi.mocked(api.decisions).mockRejectedValueOnce(new Error("private-upstream-detail"));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Refresh data" })); });
    const status = screen.getByRole("status", { name: "Connection summary" });
    expect(status).toBeVisible();
    expect(status).toHaveTextContent(/Decisions.*unavailable/i);
    expect(status).toHaveTextContent(/Decisions.*last successful data is stale/i);
    const warning = screen.getByRole("status", { name: "Data freshness warning" });
    expect(warning).toBeVisible();
    expect(warning).toHaveTextContent(/Retained data is stale.*Decisions/);
    expect(warning.compareDocumentPosition(screen.getByRole("region", { name: "Open paper positions" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText("Connection details").closest("details")).not.toHaveAttribute("open");
    expect(screen.queryByText(/private-upstream-detail/)).not.toBeInTheDocument();
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    await act(async () => { window.dispatchEvent(new Event("offline")); });
    expect(status).toHaveTextContent(/Polling paused.*stale/i);
  });

  it("starts locked with public observations and no protected reads", async () => {
    const api = await mount();
    const input = screen.getByLabelText("Paper operator credential");
    expect(input).toHaveAttribute("type", "password");
    expect(input).toHaveAttribute("maxlength", "1024");
    expect(input).toHaveValue("");
    for (const key of ["ledger", "simulation", "readiness", "decisions"] as const) expect(api[key]).not.toHaveBeenCalled();
    const log = within(screen.getByRole("region", { name: "Observation log" }));
    for (const source of ["TEST", "TRADINGVIEW", "OTHER"]) expect(log.getByText(source)).toBeVisible();
    expect(log.getAllByText("PUBLIC-SYMBOL")).toHaveLength(3);
    expect(log.getAllByText(/FXCM/)).toHaveLength(3);
    expect(log.getAllByText(/CANDLE/)).toHaveLength(3);
    expect(log.getAllByText(/2026-09-02/)).toHaveLength(3);
    expect(log.getAllByText(/RECEIVED/).length).toBeGreaterThanOrEqual(3);
    expect(log.getByText(/Sequence 7/)).toBeVisible();
    expect(screen.getByText(/Legacy Supabase history is not connected/)).toBeVisible();
    expect(screen.getByText("Broker status unavailable")).toBeVisible();
  });

  it("unlocks with an immediately cleared input, filters real panels locally, and does not create more polling", async () => {
    const api = await mount();
    await unlock();
    expect(screen.queryByLabelText("Paper operator credential")).not.toBeInTheDocument();
    expect(positions().getByText("EURUSD")).toBeVisible();
    expect(positions().getByText("GBPUSD")).toBeVisible();
    expect(positions().queryByText("USDJPY")).not.toBeInTheDocument();
    expect(positions().getAllByText("1.234500000")).toHaveLength(2);
    expect(positions().getAllByText("1.220000000")).toHaveLength(2);
    expect(positions().getAllByText("1.260000000")).toHaveLength(2);
    expect(document.getElementById("paper-record-intent-EURUSD")).not.toBeNull();
    const calls = Object.values(api).map((loader) => vi.mocked(loader).mock.calls.length);
    fireEvent.click(screen.getByRole("button", { name: "Filter by Paper A" }));
    expect(positions().queryByText("GBPUSD")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Inspect GBPUSD setup" })).not.toBeInTheDocument();
    expect(screen.getByText(/Observations are unfiltered and account-independent/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Filter by Paper A" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Entry model" }), { target: { value: "DIR_CLOSE" } });
    expect(positions().queryByText("EURUSD")).not.toBeInTheDocument();
    expect(positions().getByText("GBPUSD")).toBeVisible();
    fireEvent.change(screen.getByRole("combobox", { name: "Entry model" }), { target: { value: "" } });
    fireEvent.change(screen.getByRole("searchbox", { name: "Search setups" }), { target: { value: "EURUSD" } });
    expect(positions().queryByText("GBPUSD")).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "" } });
    for (const view of ["Accounts", "Risk & Rules", "Analytics", "Journal", "Dashboard"]) navigate(view);
    expect(Object.values(api).map((loader) => vi.mocked(loader).mock.calls.length)).toEqual(calls);
    // One composed network poll and one isolated display-clock tick.
    expect(vi.getTimerCount()).toBe(2);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps settled records in the paper journal with allocation and source provenance", async () => {
    await mount(); await unlock(); navigate("Journal");
    const journal = within(screen.getByRole("region", { name: "Paper journal" }));
    expect(journal.getByText("USDJPY")).toBeVisible();
    expect(journal.queryByText("EURUSD")).not.toBeInTheDocument();
    for (const text of ["TRADINGVIEW", "receipt-USDJPY", "setup-USDJPY", "BOC", "TARGET", "2026-09-02T13:00:00Z", "paper-a", "EUR 2.00", "EUR 1.00", "EUR 100.00", "1.234500000"]) {
      expect(journal.getAllByText(text).length).toBeGreaterThan(0);
    }
    expect(journal.getByText(/Latest returned intent window, at most 50 records/)).toBeVisible();
    expect(journal.getByText(/not complete history/)).toBeVisible();
    expect(screen.queryByRole("button", { name: /close position|settle|buy|sell|execute|enable kill|disable kill/i })).not.toBeInTheDocument();
  });

  it("shows readiness thresholds, global and per-account reasons, and read-only kill switch state", async () => {
    await mount(); await unlock(); navigate("Risk & Rules");
    const risk = within(screen.getByRole("region", { name: "Paper risk and readiness" }));
    expect(risk.getByText("DEGRADED")).toBeVisible();
    expect(risk.getByText(/STALE_OPEN_INTENT/)).toBeVisible();
    expect(risk.getByText(/DAILY_LOSS_LIMIT/)).toBeVisible();
    expect(risk.getByText("Daily paper loss threshold reached.")).toBeVisible();
    expect(risk.getByText("EUR -1.50")).toBeVisible();
    expect(risk.getByText(/500 bps/)).toBeVisible();
    expect(risk.getByText(/1,?000 bps/)).toBeVisible();
    expect(risk.getByText(/300 bps/)).toBeVisible();
    expect(risk.getByText(/60 seconds/)).toBeVisible();
    expect(risk.getByText(/900 seconds/)).toBeVisible();
    expect(risk.getByText(/Kill switch: DISABLED · read-only/)).toBeVisible();
    expect(risk.getByText(/READY describes paper readiness, not permission for live trading/)).toBeVisible();
  });

  it("never assumes a readiness currency when account sources are absent or disagree", async () => {
    const api = loaders();
    api.ledger = vi.fn(async () => [ledger()]);
    api.simulation = vi.fn(async () => ({ accounts: [account("paper-a", "USD")], intents: [] }));
    const data = readiness();
    data.accounts.push({ ...data.accounts[0]!, accountId: "unknown-account", label: "Unknown account", dailyPnlMinor: 0, reasons: [] });
    api.readiness = vi.fn(async () => data);
    await mount(api); await unlock(); navigate("Risk & Rules");
    const risk = within(screen.getByRole("region", { name: "Paper risk and readiness" }));
    expect(risk.getByText(/Currency\/scale conflict.*-150 minor units/)).toBeVisible();
    expect(risk.getByText(/Currency unavailable.*0 minor units/)).toBeVisible();
    expect(risk.queryByText("USD -1.50")).not.toBeInTheDocument();
    expect(risk.queryByText("USD 0.00")).not.toBeInTheDocument();
  });

  it("uses the joined account union and distinguishes zero from an unavailable source", async () => {
    const api = loaders();
    api.ledger = vi.fn(async () => [{ ...ledger(), balanceMinor: 0 }]);
    api.simulation = vi.fn(async () => ({ accounts: [account("paper-b", "USD", 3)], intents: [] }));
    await mount(api); await unlock(); navigate("Accounts");
    expect(screen.getByRole("button", { name: "Inspect paper account Paper A" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Inspect paper account Paper B" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Inspect paper account Paper A" }));
    const accounts = within(screen.getByRole("region", { name: "Account source details" }));
    expect(accounts.getByText("paper-a")).toBeVisible();
    expect(accounts.getByText("Ledger balance").nextElementSibling).toHaveTextContent("EUR 0.00");
    expect(accounts.getByText("Simulation source unavailable")).toBeVisible();
    expect(accounts.getByText(/Broker equity unavailable/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Inspect paper account Paper B" }));
    const simulationOnly = within(screen.getByRole("region", { name: "Account source details" }));
    expect(simulationOnly.getByText("paper-b")).toBeVisible();
    expect(simulationOnly.getByText("Ledger source unavailable")).toBeVisible();
    expect(simulationOnly.getByText(/Broker equity unavailable/)).toBeVisible();
  });

  it("separates source account aggregates by currency and scale from distinct loaded-window outcomes", async () => {
    const api = loaders();
    const shared = intent("USDJPY", "paper-a", "BOC", "SETTLED");
    shared.allocations.push({ accountId: "paper-b", riskAmountMinor: 100, balanceBeforeMinor: 10_000, pnlMinor: 200 });
    api.ledger = vi.fn(async () => [ledger(), ledger("paper-b", "EUR", 3), ledger("paper-c", "USD", 2)]);
    api.simulation = vi.fn(async () => ({ accounts: [account(), account("paper-b", "EUR", 3)], intents: [intent(), shared] }));
    await mount(api); await unlock(); navigate("Analytics");
    const analytics = within(screen.getByRole("region", { name: "Paper analytics" }));
    expect(analytics.getByText("Distinct loaded intents").nextElementSibling).toHaveTextContent("2");
    expect(analytics.getByText("Settled intents").nextElementSibling).toHaveTextContent("1");
    expect(analytics.getByText("Winning intents").nextElementSibling).toHaveTextContent("1");
    const aggregate = within(screen.getByRole("region", { name: "Account aggregates" }));
    expect(aggregate.getAllByText("EUR · scale 2").length).toBeGreaterThan(0);
    expect(aggregate.getAllByText("EUR · scale 3").length).toBeGreaterThan(0);
    expect(aggregate.getByText("USD · scale 2")).toBeVisible();
    expect(aggregate.getByText("Settled trades").nextElementSibling).toHaveTextContent("18");
    expect(analytics.getByText(/No broker performance or equity curve is available/)).toBeVisible();
  });

  it.each(["lock", "authorization rejection"])("purges data, filters, inspector, and input on %s", async (mode) => {
    const api = await mount(); await unlock();
    fireEvent.click(screen.getByRole("button", { name: "Filter by Paper A" }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "setup-EURUSD" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Entry model" }), { target: { value: "BOC" } });
    fireEvent.click(screen.getByRole("button", { name: "Inspect EURUSD setup" }));
    expect(screen.getByRole("region", { name: "Setup evidence inspector" })).toBeInTheDocument();
    if (mode === "lock") fireEvent.click(screen.getByRole("button", { name: "Lock paper data" }));
    else {
      vi.mocked(api.readiness).mockRejectedValueOnce(new PaperAuthorizationError());
      await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Refresh data" })); });
      expect(screen.getByRole("alert")).toHaveTextContent("Paper operator credential was rejected. Enter a valid credential to retry.");
    }
    expect(screen.getByLabelText("Paper operator credential")).toHaveValue("");
    expect(screen.queryByRole("region", { name: "Setup evidence inspector" })).not.toBeInTheDocument();
    expect(screen.getByRole("searchbox")).toHaveValue("");
    expect(screen.getByRole("combobox", { name: "Entry model" })).toHaveValue("");
    expect(screen.queryByText("paper-a")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Filter by Paper A" })).not.toBeInTheDocument();
    await unlock();
    expect(positions().getByText("EURUSD")).toBeVisible();
    expect(positions().getByText("GBPUSD")).toBeVisible();
    expect(screen.getByRole("searchbox")).toHaveValue("");
    expect(screen.getByRole("combobox", { name: "Entry model" })).toHaveValue("");
  });

  it("retains cached panels during refresh and errors with resource-specific freshness and stale API status", async () => {
    const api = await mount(); await unlock();
    let finish!: (value: Awaited<ReturnType<TradeOpsLoaders["simulation"]>>) => void;
    vi.mocked(api.simulation).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    vi.mocked(api.health).mockRejectedValueOnce(new Error("upstream-private-detail"));
    vi.mocked(api.decisions).mockRejectedValueOnce(new Error("upstream-private-detail"));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Refresh data" })); });
    expect(positions().getByText("EURUSD")).toBeVisible();
    expect(screen.getByRole("button", { name: "Inspect EURUSD setup" })).toBeVisible();
    expect(screen.getByRole("status", { name: "API status" })).toHaveTextContent("API STALE");
    expect(screen.getByRole("status", { name: "Simulation freshness" })).toHaveTextContent(/Refreshing.*Last success/);
    expect(screen.getByRole("status", { name: "Decisions freshness" })).toHaveTextContent(/Stale.*Entry decisions are unavailable.*Last success/);
    expect(screen.getByRole("status", { name: "Ledger freshness" })).toHaveTextContent(/Current.*Last success/);
    expect(screen.queryByText(/upstream-private-detail/)).not.toBeInTheDocument();
    await act(async () => { finish({ accounts: [account()], intents: [intent()] }); });
    expect(screen.getByRole("status", { name: "Simulation freshness" })).toHaveTextContent(/Current.*Last success/);
  });

  it("caps the loaded intent window before filtering and labels an empty successful window as zero", async () => {
    const api = loaders();
    api.simulation = vi.fn(async () => ({ accounts: [account()], intents: Array.from({ length: 51 }, (_, i) => intent(`SYMBOL${i}`)) }));
    await mount(api); await unlock();
    expect(positions().getAllByRole("row")).toHaveLength(51);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "SYMBOL50" } });
    expect(positions().getByText("No open paper intents match the loaded window filters.")).toBeVisible();
    vi.mocked(api.simulation).mockResolvedValueOnce({ accounts: [], intents: [] });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Refresh data" })); });
    navigate("Analytics");
    const analytics = within(screen.getByRole("region", { name: "Paper analytics" }));
    expect(analytics.getByText("Distinct loaded intents").nextElementSibling).toHaveTextContent("0");
  });

  it("keeps stale labels visible while retrying a previously failed resource", async () => {
    const api = await mount(); await unlock();
    vi.mocked(api.simulation).mockRejectedValueOnce(new Error("temporary failure"));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Refresh data" })); });
    let finish!: (value: Awaited<ReturnType<TradeOpsLoaders["simulation"]>>) => void;
    vi.mocked(api.simulation).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Refresh data" })); });
    expect(screen.getByRole("status", { name: "Simulation freshness" })).toHaveTextContent(/Refreshing.*Stale/);
    expect(screen.getByRole("status", { name: "Data freshness warning" })).toHaveTextContent(/Retained data is stale.*Simulation/);
    expect(positions().getByText("EURUSD")).toBeVisible();
    await act(async () => { finish({ accounts: [account()], intents: [intent()] }); });
    expect(screen.queryByRole("status", { name: "Data freshness warning" })).not.toBeInTheDocument();
  });

  it("uses only six allowlisted GET routes with real loaders through unlock, filtering, navigation, refresh, and lock", async () => {
    const writes = vi.spyOn(Storage.prototype, "setItem");
    const replies: Record<string, unknown> = {
      "/health/live": { status: "ALIVE", mode: "OBSERVATION_ONLY", paper_simulator: "ENABLED", execution: "DISABLED" },
      "/api/v1/observation-receipts?limit=50": { mode: "OBSERVATION_ONLY", ingress_enabled: true, count: 0, items: [] },
      "/api/v1/paper-accounts?limit=200": { mode: "PAPER_ONLY", count: 1, items: [{ schema_version: "1.0", mode: "PAPER_ONLY", account_id: "paper-a", label: "Paper A", currency_code: "EUR", currency_scale: 2, opening_balance_minor: 10000, ledger_delta_minor: 0, balance_minor: 10000, last_sequence: 0, created_at: time }] },
      "/api/v1/paper-simulations/summary?limit=50": { schema_version: "1.0", mode: "PAPER_SIMULATION_ONLY", account_count: 0, intent_count: 0, accounts: [], intents: [] },
      "/api/v1/rd-entry-decisions?limit=50": { schema_version: "1.0", mode: "PAPER_ONLY", count: 0, items: [] },
      "/api/v1/paper-readiness": { schema_version: "1.0", mode: "PAPER_ONLY", state: "DEGRADED", evaluated_at: time, execution: "DISABLED",
        thresholds: { receipt_max_age_seconds: 60, stale_trade_seconds: 900, max_daily_loss_bps: 500, max_total_drawdown_bps: 1000, max_open_risk_bps: 300, max_open_positions: 4 },
        kill_switch: { enabled: false, reason: null, changed_at: null }, latest_receipt: null,
        open_health: { open_intents: 0, stale_open_intents: 0, oldest_open_intent_at: null }, accounts: [], reasons: [] },
    };
    const requests: Array<{ path: string; method: string }> = [];
    const network = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "http://localhost");
      const path = `${url.pathname}${url.search}`;
      requests.push({ path, method: init?.method ?? "GET" });
      if (!(path in replies)) throw new Error("Unapproved request path");
      return new Response(JSON.stringify(replies[path]), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", network);
    render(<TradeOpsDashboard />);
    await act(async () => {});
    expect(requests).toHaveLength(2);
    await unlock();
    expect(requests).toHaveLength(8);
    for (const label of ["Ledger", "Simulation", "Readiness", "Decisions"]) expect(screen.getByRole("status", { name: `${label} freshness` })).toHaveTextContent("Current");
    fireEvent.click(screen.getByRole("button", { name: "Filter by Paper A" }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "local-only-query" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Entry model" }), { target: { value: "BOC" } });
    for (const view of ["Accounts", "Risk & Rules", "Analytics", "Journal", "Dashboard"]) navigate(view);
    expect(requests).toHaveLength(8);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Refresh data" })); });
    expect(requests).toHaveLength(14);
    fireEvent.click(screen.getByRole("button", { name: "Lock paper data" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Refresh data" })); });
    expect(requests).toHaveLength(16);
    expect(new Set(requests.map((request) => request.path))).toEqual(new Set(Object.keys(replies)));
    expect(new Set(requests.map((request) => request.method))).toEqual(new Set(["GET"]));
    expect(writes).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /execute|close position|settle|enable kill|disable kill/i })).not.toBeInTheDocument();
  });
});
