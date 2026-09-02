import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  loadEntryDecisions: vi.fn(),
  loadPaperReadiness: vi.fn(),
  loadPaperSimulationSummary: vi.fn(),
  setPaperReadinessKillSwitch: vi.fn(),
}));

vi.mock("../src/lib/entry-decisions", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/lib/entry-decisions")>();
  return {
    ...actual,
    loadEntryDecisions: apiMocks.loadEntryDecisions,
  };
});

vi.mock("../src/components/EntryDecisionPanel", () => ({
  EntryDecisionPanel: ({
    initialSnapshot,
  }: {
    initialSnapshot: { state: string; message: string };
  }) => (
    <div data-testid="decision-snapshot">
      {initialSnapshot.state}: {initialSnapshot.message}
    </div>
  ),
}));

vi.mock("../src/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/api")>();
  return {
    ...actual,
    loadPaperReadiness: apiMocks.loadPaperReadiness,
    loadPaperSimulationSummary: apiMocks.loadPaperSimulationSummary,
    setPaperReadinessKillSwitch: apiMocks.setPaperReadinessKillSwitch,
  };
});

import { PaperSimulationPanel } from "../src/components/PaperSimulationPanel";

const snapshot = {
  accounts: [
    {
      accountId: "paper-a",
      label: "Paper A",
      currencyCode: "USD",
      currencyScale: 2,
      balanceMinor: 10_075_000,
      realizedPnlMinor: 75_000,
      openRiskMinor: 0,
      openPositions: 0,
      settledTrades: 1,
      winningTrades: 1,
      losingTrades: 0,
      maxDrawdownMinor: 0,
    },
  ],
  intents: [
    {
      intentId: "intent-a",
      symbol: "EURUSD",
      side: "BUY" as const,
      entryPrice: "1.17",
      stopLoss: "1.16",
      takeProfit: "1.19",
      riskBps: 50,
      source: "TRADINGVIEW" as const,
      sourceReceiptId: "receipt-a",
      setupId: null,
      selectedEntryModel: null,
      coTriggeredModels: [],
      state: "SETTLED" as const,
      createdAt: "2026-07-23T10:00:00Z",
      outcomeRMillis: 1500,
      exitReason: "TARGET" as const,
      settledAt: "2026-07-23T10:05:00Z",
      allocations: [
        {
          accountId: "paper-a",
          riskAmountMinor: 50_000,
          balanceBeforeMinor: 10_000_000,
          pnlMinor: 75_000,
        },
      ],
    },
  ],
};

const readiness = {
  state: "DEGRADED" as const,
  evaluatedAt: "2026-07-23T10:06:00Z",
  thresholds: {
    receiptMaxAgeSeconds: 60,
    staleTradeSeconds: 900,
    maxDailyLossBps: 500,
    maxTotalDrawdownBps: 1_000,
    maxOpenRiskBps: 300,
    maxOpenPositions: 4,
  },
  killSwitch: {
    enabled: false,
    reason: "Paper monitor enabled",
    changedAt: "2026-07-23T09:00:00Z",
  },
  latestReceipt: {
    receiptId: "receipt-a",
    receivedAt: "2026-07-23T10:04:29Z",
    producerInstanceId: "tradingview-paper-eurusd:monitor",
    sequence: 17,
    symbol: "EURUSD",
    ageSeconds: 91,
  },
  openHealth: {
    openIntents: 1,
    staleOpenIntents: 0,
    oldestOpenIntentAt: "2026-07-23T10:02:00Z",
  },
  accounts: [
    {
      accountId: "paper-a",
      label: "Paper A",
      state: "READY" as const,
      dailyPnlMinor: 75_000,
      dailyLossBps: 0,
      totalDrawdownBps: 0,
      openRiskBps: 50,
      openPositions: 1,
      reasons: [],
    },
  ],
  reasons: [
    {
      code: "RECEIPT_STALE" as const,
      accountId: null,
      message: "Latest automation receipt is stale",
    },
  ],
  execution: "DISABLED" as const,
};

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

async function unlockPanel() {
  apiMocks.loadEntryDecisions.mockResolvedValue({
    state: "EMPTY", items: [], message: "No decisions recorded.",
  });
  apiMocks.loadPaperSimulationSummary.mockResolvedValue(snapshot);
  apiMocks.loadPaperReadiness.mockResolvedValue(readiness);
  const rendered = render(<PaperSimulationPanel />);
  await act(async () => {
    fireEvent.change(screen.getByLabelText("Paper operator credential"), {
      target: { value: "operator-secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "UNLOCK" }));
  });
  return rendered;
}

function stoppedReadiness() {
  return {
    ...readiness,
    state: "STOPPED" as const,
    killSwitch: { enabled: true, reason: "Readiness drill", changedAt: "2026-07-23T10:07:00Z" },
  };
}

describe("PaperSimulationPanel", () => {
  it("reconciles immediately when a pending mutation fails after reconnection", async () => {
    vi.useFakeTimers();
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    await unlockPanel();
    const mutation = deferred<{ status: string; killSwitch: typeof readiness.killSwitch }>();
    apiMocks.setPaperReadinessKillSwitch.mockImplementation(() => mutation.promise);
    // The server applied the control, but its acknowledgement was lost.
    apiMocks.loadPaperReadiness.mockResolvedValue(stoppedReadiness());
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Required operator reason"), {
        target: { value: "Readiness drill" },
      });
      fireEvent.click(screen.getByRole("button", { name: "ENGAGE" }));
      online.mockReturnValue(false);
      window.dispatchEvent(new Event("offline"));
      online.mockReturnValue(true);
      window.dispatchEvent(new Event("online"));
    });
    expect(apiMocks.loadPaperReadiness).toHaveBeenCalledTimes(1);
    await act(async () => { mutation.reject(new Error("Acknowledgement timed out.")); });
    expect(apiMocks.loadPaperReadiness).toHaveBeenCalledTimes(2);
    expect(apiMocks.setPaperReadinessKillSwitch).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Paper kill switch engaged")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "RELEASE" })).toBeEnabled();
    expect(screen.getByRole("alert")).toHaveTextContent("Acknowledgement timed out.");
  });

  it("finishes a control while hidden without polling or replaying it, then reconciles on return", async () => {
    vi.useFakeTimers();
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    await unlockPanel();
    const stopped = stoppedReadiness();
    const mutation = deferred<{ status: string; killSwitch: typeof readiness.killSwitch }>();
    apiMocks.setPaperReadinessKillSwitch.mockImplementation(() => mutation.promise);
    apiMocks.loadPaperReadiness.mockResolvedValue(stopped);
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Required operator reason"), {
        target: { value: "Readiness drill" },
      });
      fireEvent.click(screen.getByRole("button", { name: "ENGAGE" }));
    });
    await act(async () => {
      visibility.mockReturnValue("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
      mutation.resolve({ status: "APPLIED", killSwitch: stopped.killSwitch });
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(apiMocks.loadPaperReadiness).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "RELEASE" })).toBeDisabled();
    await act(async () => {
      visibility.mockReturnValue("visible");
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(apiMocks.loadPaperReadiness).toHaveBeenCalledTimes(2);
    expect(apiMocks.setPaperReadinessKillSwitch).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "RELEASE" })).toBeEnabled();
  });

  it("does not restore protected data or poll after locking an in-flight refresh", async () => {
    vi.useFakeTimers();
    await unlockPanel();
    const delayed = deferred<typeof snapshot>();
    apiMocks.loadPaperSimulationSummary.mockImplementationOnce(() => delayed.promise);
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    const signal = apiMocks.loadPaperSimulationSummary.mock.calls[1]![1] as AbortSignal;
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "LOCK" }));
      delayed.resolve(snapshot);
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(signal.aborted).toBe(true);
    expect(apiMocks.loadPaperSimulationSummary).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Operator access required")).toBeInTheDocument();
    expect(screen.queryByLabelText("Paper kill switch released")).not.toBeInTheDocument();
  });

  it("pauses hidden reads and keeps control disabled until the recovery snapshot arrives", async () => {
    vi.useFakeTimers();
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    await unlockPanel();
    const oldSummary = deferred<typeof snapshot>();
    apiMocks.loadPaperSimulationSummary.mockImplementationOnce(() => oldSummary.promise);
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    const oldSignal = apiMocks.loadPaperReadiness.mock.calls[1]![1] as AbortSignal;
    await act(async () => {
      visibility.mockReturnValue("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(90_000);
    });
    expect(oldSignal.aborted).toBe(true);
    expect(apiMocks.loadPaperReadiness).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/Updates paused/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ENGAGE" })).toBeDisabled();

    const recovery = deferred<typeof snapshot>();
    apiMocks.loadPaperSimulationSummary.mockImplementationOnce(() => recovery.promise);
    await act(async () => {
      visibility.mockReturnValue("visible");
      document.dispatchEvent(new Event("visibilitychange"));
      oldSummary.resolve(snapshot);
    });
    expect(apiMocks.loadPaperReadiness).toHaveBeenCalledTimes(3);
    expect(screen.getByRole("button", { name: "ENGAGE" })).toBeDisabled();
    expect(screen.getByText(/Snapshot stale/)).toBeInTheDocument();
    await act(async () => { recovery.resolve(snapshot); });
    expect(screen.getByRole("button", { name: "ENGAGE" })).toBeEnabled();
    expect(screen.queryByText(/Snapshot stale/)).not.toBeInTheDocument();
  });

  it("rejects offline controls and refreshes on reconnection without resending a mutation", async () => {
    vi.useFakeTimers();
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    await unlockPanel();
    apiMocks.setPaperReadinessKillSwitch.mockRejectedValue(new Error("Network offline."));
    await act(async () => {
      online.mockReturnValue(false);
      window.dispatchEvent(new Event("offline"));
      fireEvent.change(screen.getByLabelText("Required operator reason"), {
        target: { value: "Offline drill" },
      });
      fireEvent.submit(screen.getByRole("form", { name: "Paper kill switch control" }));
      await vi.advanceTimersByTimeAsync(90_000);
    });
    expect(apiMocks.loadPaperReadiness).toHaveBeenCalledTimes(1);
    expect(apiMocks.setPaperReadinessKillSwitch).not.toHaveBeenCalled();
    await act(async () => {
      online.mockReturnValue(true);
      window.dispatchEvent(new Event("online"));
    });
    expect(apiMocks.loadPaperReadiness).toHaveBeenCalledTimes(2);
    expect(apiMocks.setPaperReadinessKillSwitch).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "ENGAGE" })).toBeEnabled();
  });

  it("keeps controls blocked after a failed refresh until a successful manual refresh", async () => {
    await unlockPanel();
    apiMocks.loadPaperReadiness.mockRejectedValueOnce(new Error("Readiness unavailable."));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "REFRESH" }));
    });
    expect(screen.getByText(/Snapshot stale/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ENGAGE" })).toBeDisabled();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "REFRESH" }));
    });
    expect(screen.getByRole("button", { name: "ENGAGE" })).toBeEnabled();
  });

  it("keeps controls blocked when both a mutation and its reconciliation fail", async () => {
    await unlockPanel();
    apiMocks.setPaperReadinessKillSwitch.mockRejectedValueOnce(new Error("Acknowledgement lost."));
    apiMocks.loadPaperReadiness.mockRejectedValueOnce(new Error("Readiness unavailable."));
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Required operator reason"), {
        target: { value: "Readiness drill" },
      });
      fireEvent.click(screen.getByRole("button", { name: "ENGAGE" }));
    });
    expect(apiMocks.setPaperReadinessKillSwitch).toHaveBeenCalledTimes(1);
    expect(apiMocks.loadPaperReadiness).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/Snapshot stale/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ENGAGE" })).toBeDisabled();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "REFRESH" }));
    });
    expect(screen.getByRole("button", { name: "ENGAGE" })).toBeEnabled();
    expect(apiMocks.setPaperReadinessKillSwitch).toHaveBeenCalledTimes(1);
  });

  it("discards an older poll that completes after a confirmed kill-switch change", async () => {
    vi.useFakeTimers();
    await unlockPanel();
    const oldSummary = deferred<typeof snapshot>();
    apiMocks.loadPaperSimulationSummary.mockImplementationOnce(() => oldSummary.promise);
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    const oldSignal = apiMocks.loadPaperReadiness.mock.calls[1]![1] as AbortSignal;
    const stopped = stoppedReadiness();
    apiMocks.loadPaperReadiness.mockResolvedValue(stopped);
    apiMocks.setPaperReadinessKillSwitch.mockResolvedValue({
      status: "APPLIED", killSwitch: stopped.killSwitch,
    });
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Required operator reason"), {
        target: { value: "Readiness drill" },
      });
      fireEvent.click(screen.getByRole("button", { name: "ENGAGE" }));
    });
    expect(screen.getByLabelText("Paper kill switch engaged")).toBeInTheDocument();

    // Deliberately ignore cancellation at the network mock: the component must
    // still reject the old result when the other two requests finish later.
    await act(async () => { oldSummary.resolve(snapshot); });
    expect(screen.getByLabelText("Paper kill switch engaged")).toBeInTheDocument();
    expect(oldSignal.aborted).toBe(true);
    expect(apiMocks.loadPaperReadiness).toHaveBeenCalledTimes(3);
  });

  it("does not start background reads while a control mutation is pending", async () => {
    vi.useFakeTimers();
    const rendered = await unlockPanel();
    const mutation = deferred<{ status: string; killSwitch: typeof readiness.killSwitch }>();
    apiMocks.setPaperReadinessKillSwitch.mockImplementation(() => mutation.promise);
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Required operator reason"), {
        target: { value: "Readiness drill" },
      });
      fireEvent.click(screen.getByRole("button", { name: "ENGAGE" }));
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(apiMocks.loadPaperReadiness).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "APPLYING…" })).toBeDisabled();
    rendered.unmount();
    const signal = apiMocks.setPaperReadinessKillSwitch.mock.calls[0]![3] as AbortSignal;
    expect(signal.aborted).toBe(true);
    await act(async () => {
      mutation.resolve({ status: "APPLIED", killSwitch: stoppedReadiness().killSwitch });
    });
    expect(apiMocks.loadPaperReadiness).toHaveBeenCalledTimes(1);
  });

  it("loads summary and readiness together, refreshes, and locks again", async () => {
    apiMocks.loadEntryDecisions.mockResolvedValue({
      state: "EMPTY",
      items: [],
      message: "No decisions recorded.",
    });
    apiMocks.loadPaperSimulationSummary.mockResolvedValue(snapshot);
    apiMocks.loadPaperReadiness.mockResolvedValue(readiness);
    render(<PaperSimulationPanel />);

    expect(screen.getByText("Operator access required")).toBeInTheDocument();
    const input = screen.getByLabelText("Paper operator credential");
    fireEvent.change(input, { target: { value: "operator-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "UNLOCK" }));

    await waitFor(() => expect(screen.getAllByText("Paper A")).toHaveLength(3));
    expect(apiMocks.loadPaperSimulationSummary).toHaveBeenCalledWith(
      "operator-secret",
      expect.any(AbortSignal),
    );
    expect(apiMocks.loadPaperReadiness).toHaveBeenCalledWith(
      "operator-secret",
      expect.any(AbortSignal),
    );
    expect(apiMocks.loadEntryDecisions).toHaveBeenCalledWith(
      "operator-secret",
      expect.any(AbortSignal),
    );
    expect(
      screen.getByRole("status", { name: "Paper readiness DEGRADED" }),
    ).toHaveTextContent("DEGRADED");
    expect(screen.getByText("Latest automation receipt is stale")).toBeInTheDocument();
    expect(screen.getByText("91s")).toBeInTheDocument();
    expect(screen.getByText("tradingview-paper-eurusd:monitor")).toBeInTheDocument();
    expect(screen.getByLabelText("Paper kill switch released")).toBeInTheDocument();
    expect(screen.getByText("$100,750.00")).toBeInTheDocument();
    expect(screen.getAllByText("+$750.00")).toHaveLength(3);
    expect(screen.getByText("EURUSD")).toBeInTheDocument();
    expect(screen.getByText("1.50R · TARGET")).toBeInTheDocument();
    expect(screen.getByText("AUTO · TRADINGVIEW")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "REFRESH" }));
    await waitFor(() =>
      expect(apiMocks.loadPaperSimulationSummary).toHaveBeenCalledTimes(2),
    );
    expect(apiMocks.loadPaperReadiness).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole("button", { name: "LOCK" }));
    expect(screen.getByText("Operator access required")).toBeInTheDocument();
    expect(screen.getByLabelText("Paper operator credential")).toHaveValue("");
  });

  it("shows rejected credentials without revealing the presented value", async () => {
    apiMocks.loadEntryDecisions.mockResolvedValue({
      state: "ERROR",
      items: [],
      message: "Entry decisions are unavailable or malformed.",
    });
    apiMocks.loadPaperSimulationSummary.mockRejectedValue(
      new Error("Paper operator credential was rejected."),
    );
    apiMocks.loadPaperReadiness.mockResolvedValue(readiness);
    render(<PaperSimulationPanel />);
    fireEvent.change(screen.getByLabelText("Paper operator credential"), {
      target: { value: "wrong-secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "UNLOCK" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Paper operator credential was rejected.",
    );
    expect(screen.queryByText("wrong-secret")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Paper operator credential")).toHaveValue("");
  });

  it("requires a reason and preserves visible evidence when control fails", async () => {
    apiMocks.loadEntryDecisions.mockResolvedValue({
      state: "EMPTY",
      items: [],
      message: "No decisions recorded.",
    });
    apiMocks.loadPaperSimulationSummary.mockResolvedValue(snapshot);
    apiMocks.loadPaperReadiness.mockResolvedValue(readiness);
    apiMocks.setPaperReadinessKillSwitch.mockRejectedValue(
      new Error("Paper readiness control is unavailable."),
    );
    render(<PaperSimulationPanel />);
    fireEvent.change(screen.getByLabelText("Paper operator credential"), {
      target: { value: "operator-secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "UNLOCK" }));
    await screen.findByRole("status", { name: "Paper readiness DEGRADED" });

    fireEvent.submit(screen.getByRole("form", { name: "Paper kill switch control" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter a required operator reason",
    );

    fireEvent.change(screen.getByLabelText("Required operator reason"), {
      target: { value: "Readiness drill" },
    });
    fireEvent.submit(screen.getByRole("form", { name: "Paper kill switch control" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Paper readiness control is unavailable.",
    );
    expect(apiMocks.setPaperReadinessKillSwitch).toHaveBeenCalledWith(
      "operator-secret",
      true,
      "Readiness drill",
      expect.any(AbortSignal),
    );
    expect(
      screen.getByRole("status", { name: "Paper readiness DEGRADED" }),
    ).toBeInTheDocument();
    expect(screen.getByText("$100,750.00")).toBeInTheDocument();
    expect(screen.queryByText("operator-secret")).not.toBeInTheDocument();
    expect(apiMocks.loadPaperReadiness).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: "ENGAGE" })).toBeEnabled();
  });

  it("engages the kill switch and reloads authoritative evidence", async () => {
    apiMocks.loadEntryDecisions.mockResolvedValue({
      state: "EMPTY",
      items: [],
      message: "No decisions recorded.",
    });
    const stopped = {
      ...readiness,
      state: "STOPPED" as const,
      killSwitch: {
        enabled: true,
        reason: "Readiness drill",
        changedAt: "2026-07-23T10:07:00Z",
      },
      reasons: [
        {
          code: "KILL_SWITCH_ENABLED" as const,
          accountId: null,
          message: "Paper kill switch is enabled",
        },
      ],
    };
    apiMocks.loadPaperSimulationSummary.mockResolvedValue(snapshot);
    apiMocks.loadPaperReadiness
      .mockResolvedValueOnce(readiness)
      .mockResolvedValueOnce(stopped);
    apiMocks.setPaperReadinessKillSwitch.mockResolvedValue({
      status: "APPLIED",
      killSwitch: stopped.killSwitch,
    });
    render(<PaperSimulationPanel />);
    fireEvent.change(screen.getByLabelText("Paper operator credential"), {
      target: { value: "operator-secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "UNLOCK" }));
    await screen.findByRole("status", { name: "Paper readiness DEGRADED" });
    fireEvent.change(screen.getByLabelText("Required operator reason"), {
      target: { value: "Readiness drill" },
    });
    fireEvent.click(screen.getByRole("button", { name: "ENGAGE" }));

    expect(
      await screen.findByRole("status", { name: "Paper readiness STOPPED" }),
    ).toBeInTheDocument();
    await waitFor(() => expect(apiMocks.loadPaperReadiness).toHaveBeenCalledTimes(2));
    expect(screen.getByLabelText("Paper kill switch engaged")).toBeInTheDocument();
  });

  it("links a v3 paper row to its selected model and keeps co-trigger context", async () => {
    apiMocks.loadEntryDecisions.mockResolvedValue({
      state: "EMPTY",
      items: [],
      message: "No decisions recorded.",
    });
    apiMocks.loadPaperReadiness.mockResolvedValue(readiness);
    apiMocks.loadPaperSimulationSummary.mockResolvedValue({
      ...snapshot,
      intents: [
        {
          ...snapshot.intents[0]!,
          setupId: "setup-a",
          selectedEntryModel: "HTF_FLIP",
          coTriggeredModels: ["BOC"],
        },
      ],
    });
    render(<PaperSimulationPanel />);
    fireEvent.change(screen.getByLabelText("Paper operator credential"), {
      target: { value: "operator-secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "UNLOCK" }));

    expect(await screen.findByText("HTF FLIP selected")).toHaveAttribute(
      "href",
      "#entry-decisions",
    );
    expect(screen.getByText("Co-trigger · BOC")).toBeInTheDocument();
    expect(screen.getByText("EURUSD").closest("article")).toHaveAttribute(
      "id",
      "paper-intent-intent-a",
    );
  });

  it("replaces stale READY decisions when sibling refreshes fail", async () => {
    apiMocks.loadEntryDecisions
      .mockResolvedValueOnce({
        state: "READY",
        items: [],
        message: "Prior READY cards",
      })
      .mockResolvedValueOnce({
        state: "ERROR",
        items: [],
        message: "Decision refresh failed closed",
      });
    apiMocks.loadPaperSimulationSummary
      .mockResolvedValueOnce(snapshot)
      .mockRejectedValueOnce(new Error("Paper simulator refresh failed."));
    apiMocks.loadPaperReadiness.mockResolvedValue(readiness);
    render(<PaperSimulationPanel />);
    fireEvent.change(screen.getByLabelText("Paper operator credential"), {
      target: { value: "operator-secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "UNLOCK" }));
    expect(await screen.findByText("READY: Prior READY cards")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "REFRESH" }));

    expect(
      await screen.findByText("ERROR: Decision refresh failed closed"),
    ).toBeInTheDocument();
    expect(screen.queryByText("READY: Prior READY cards")).not.toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Paper simulator refresh failed.",
    );
  });
});
