import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const lifecycleMocks = vi.hoisted(() => ({
  loadEntryCohortMetrics: vi.fn(),
  loadEntryDecisions: vi.fn(),
  loadPaperReadiness: vi.fn(),
  loadPaperSimulationSummary: vi.fn(),
}));

vi.mock("../src/lib/entry-cohort-metrics", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/lib/entry-cohort-metrics")>();
  return {
    ...actual,
    loadEntryCohortMetrics: lifecycleMocks.loadEntryCohortMetrics,
  };
});

vi.mock("../src/lib/entry-decisions", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/lib/entry-decisions")>();
  return {
    ...actual,
    loadEntryDecisions: lifecycleMocks.loadEntryDecisions,
  };
});

vi.mock("../src/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/api")>();
  return {
    ...actual,
    loadPaperReadiness: lifecycleMocks.loadPaperReadiness,
    loadPaperSimulationSummary: lifecycleMocks.loadPaperSimulationSummary,
  };
});

vi.mock("../src/components/EntryDecisionPanel", () => ({
  EntryDecisionPanel: () => <div>Entry decision ledger placeholder</div>,
}));

import { LiquidityCohortPanel } from "../src/components/LiquidityCohortPanel";
import { PaperSimulationPanel } from "../src/components/PaperSimulationPanel";
import type { EntryCohortMetricsSnapshot } from "../src/lib/entry-cohort-metrics";

const snapshot: EntryCohortMetricsSnapshot = {
  state: "READY",
  message: "3 liquidity cohort rows.",
  items: [
    {
      liquidityCohort: "ONE_CANDLE",
      oneCandleEnabled: true,
      entryModel: "BOC",
      symbol: "XPTUSD",
      feed: "OANDA",
      trades: 5,
      wins: 2,
      losses: 1,
      resolved: 3,
      winRateBps: 6667,
      ambiguous: 1,
      open: 1,
    },
    {
      liquidityCohort: "TWO_PLUS_CANDLES",
      oneCandleEnabled: false,
      entryModel: "HTF_FLIP",
      symbol: "NAS100",
      feed: "CAPITALCOM",
      trades: 1,
      wins: 0,
      losses: 0,
      resolved: 0,
      winRateBps: null,
      ambiguous: 0,
      open: 1,
    },
    {
      liquidityCohort: "TWO_PLUS_CANDLES",
      oneCandleEnabled: true,
      entryModel: "HTF_FLIP",
      symbol: "NAS100",
      feed: "CAPITALCOM",
      trades: 1,
      wins: 1,
      losses: 0,
      resolved: 1,
      winRateBps: 10_000,
      ambiguous: 0,
      open: 0,
    },
  ],
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("LiquidityCohortPanel", () => {
  it("groups compact performance rows by liquidity cohort", () => {
    render(<LiquidityCohortPanel snapshot={snapshot} />);

    const panel = screen.getByRole("region", { name: "Liquidity experiment" });
    expect(
      within(panel).getByRole("heading", { name: "Liquidity experiment" }),
    ).toBeInTheDocument();
    expect(
      within(panel).getByText("COHORT OUTCOMES · PAPER SIMULATION ONLY"),
    ).toBeInTheDocument();
    expect(
      within(panel).queryByText("SHADOW COMPARISON · PAPER SIMULATION ONLY"),
    ).not.toBeInTheDocument();
    expect(within(panel).getByText("ONE CANDLE")).toBeInTheDocument();
    expect(within(panel).getByText("TWO PLUS CANDLES")).toBeInTheDocument();
    expect(within(panel).getByText("66.67%")).toBeInTheDocument();
    expect(within(panel).getByText("3 resolved")).toBeInTheDocument();
    expect(within(panel).getByText("No resolved trades")).toBeInTheDocument();
    expect(within(panel).getByText("0 resolved")).toBeInTheDocument();
    expect(within(panel).getByText("XPTUSD / OANDA")).toBeInTheDocument();
    expect(within(panel).getAllByText("NAS100 / CAPITALCOM")).toHaveLength(2);
    expect(within(panel).getAllByText("HTF FLIP")).toHaveLength(2);
    expect(within(panel).getByRole("columnheader", { name: "Setting" })).toBeVisible();
    expect(within(panel).getByRole("columnheader", { name: "Ambiguous" })).toBeVisible();
    expect(within(panel).getByRole("columnheader", { name: "Open" })).toBeVisible();

    const nasRows = within(panel)
      .getAllByRole("row")
      .filter((row) => within(row).queryByText("NAS100 / CAPITALCOM") !== null);
    expect(nasRows).toHaveLength(2);
    expect(within(nasRows[0]!).getByText("STRICT")).toBeInTheDocument();
    expect(within(nasRows[1]!).getByText("EXPERIMENT ON")).toBeInTheDocument();

    const oneCandleRow = within(panel)
      .getByText("XPTUSD / OANDA")
      .closest("tr");
    expect(oneCandleRow).not.toBeNull();
    expect(
      within(oneCandleRow!).getByText("66.67%").parentElement,
    ).toHaveClass("liquidity-cohort-rate");
    expect(within(oneCandleRow!).getByText("3 resolved")).toHaveClass(
      "liquidity-cohort-resolved",
    );
    expect(
      oneCandleRow!.querySelectorAll(".liquidity-cohort-number"),
    ).toHaveLength(5);
    expect(within(panel).getByRole("table").parentElement).toHaveClass(
      "liquidity-cohort-table-wrap",
    );
  });

  it.each([
    [
      "EMPTY",
      "No liquidity cohort trades have been recorded.",
      "No liquidity cohort trades have been recorded.",
      "liquidity-cohort-state-neutral",
    ],
    [
      "ERROR",
      "Liquidity cohort metrics are unavailable or malformed.",
      "Liquidity cohort metrics are unavailable or malformed.",
      "liquidity-cohort-state-error",
    ],
  ] as const)(
    "renders a usable %s state",
    (state, message, expected, stateClass) => {
      render(
        <LiquidityCohortPanel
          snapshot={{ state, items: [], message }}
        />,
      );

      const panel = screen.getByRole("region", { name: "Liquidity experiment" });
      expect(panel).toHaveTextContent(expected);
      expect(within(panel).getByRole("status")).toHaveClass(stateClass);
      expect(within(panel).queryByRole("alert")).not.toBeInTheDocument();
    },
  );

  it("uses the protected paper refresh lifecycle and renders before trade cards", async () => {
    lifecycleMocks.loadEntryCohortMetrics.mockResolvedValue(snapshot);
    lifecycleMocks.loadEntryDecisions.mockResolvedValue({
      state: "EMPTY",
      items: [],
      message: "No entry decisions.",
    });
    lifecycleMocks.loadPaperSimulationSummary.mockResolvedValue({
      accounts: [
        {
          accountId: "paper-a",
          label: "Paper A",
          currencyCode: "USD",
          currencyScale: 2,
          balanceMinor: 10_000_000,
          realizedPnlMinor: 0,
          openRiskMinor: 0,
          openPositions: 0,
          settledTrades: 0,
          winningTrades: 0,
          losingTrades: 0,
          maxDrawdownMinor: 0,
        },
      ],
      intents: [],
    });
    lifecycleMocks.loadPaperReadiness.mockResolvedValue({
      state: "READY",
      evaluatedAt: "2026-07-30T12:00:00Z",
      thresholds: {
        receiptMaxAgeSeconds: 60,
        staleTradeSeconds: 900,
        maxDailyLossBps: 500,
        maxTotalDrawdownBps: 1_000,
        maxOpenRiskBps: 300,
        maxOpenPositions: 4,
      },
      killSwitch: { enabled: false, reason: null, changedAt: null },
      latestReceipt: null,
      openHealth: {
        openIntents: 0,
        staleOpenIntents: 0,
        oldestOpenIntentAt: null,
      },
      accounts: [],
      reasons: [],
      execution: "DISABLED",
    });
    render(<PaperSimulationPanel />);

    fireEvent.change(screen.getByLabelText("Paper operator credential"), {
      target: { value: "operator-secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "UNLOCK" }));

    const experimentHeading = await screen.findByRole("heading", {
      name: "Liquidity experiment",
    });
    expect(lifecycleMocks.loadEntryCohortMetrics).toHaveBeenCalledWith(
      "operator-secret",
      expect.any(AbortSignal),
    );
    const readinessHeading = screen.getByRole("heading", {
      name: "Paper readiness",
    });
    const accountHeading = screen.getByRole("heading", { name: "Paper A" });
    expect(
      readinessHeading.compareDocumentPosition(experimentHeading) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      experimentHeading.compareDocumentPosition(accountHeading) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "REFRESH" }));
    await waitFor(() =>
      expect(lifecycleMocks.loadEntryCohortMetrics).toHaveBeenCalledTimes(2),
    );
  });
});
