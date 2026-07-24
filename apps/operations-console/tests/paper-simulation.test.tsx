import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  loadPaperReadiness: vi.fn(),
  loadPaperSimulationSummary: vi.fn(),
  setPaperReadinessKillSwitch: vi.fn(),
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
  vi.clearAllMocks();
});

describe("PaperSimulationPanel", () => {
  it("loads summary and readiness together, refreshes, and locks again", async () => {
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
  });

  it("engages the kill switch and reloads authoritative evidence", async () => {
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
});
