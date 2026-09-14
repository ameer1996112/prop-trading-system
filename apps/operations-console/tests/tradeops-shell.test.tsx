import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TradeOpsShell } from "../src/features/tradeops/TradeOpsShell";
import { AccountStrip } from "../src/features/tradeops/AccountStrip";
import { AggregateBar } from "../src/features/tradeops/AggregateBar";
import { NAV_GROUPS } from "../src/features/tradeops/navigation";
import { buildAccountViews, summarizeAccounts } from "../src/features/tradeops/model";
import type { PaperLedgerAccount } from "../src/features/tradeops/ledger-api";
import type { PaperSimulationAccount } from "../src/lib/api";

afterEach(cleanup);

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
    balanceMinor: 950, realizedPnlMinor: -50, openRiskMinor: 100, openPositions: 1,
    settledTrades: 4, winningTrades: 1, losingTrades: 3, maxDrawdownMinor: 200, ...overrides,
  };
}

describe("TradeOps shell", () => {
  it("retains scoped evidence layout without importing the old app theme", () => {
    const css = readFileSync(resolve(process.cwd(), "src/features/tradeops/tradeops.module.css"), "utf8");
    for (const name of ["entry-decision-list", "entry-decision-heading", "entry-decision-states", "entry-decision-levels", "entry-candidate-grid"]) expect(css).toMatch(new RegExp(`\\.setupInspector :global\\(\\.${name}\\)\\s*\\{[^}]*display:\\s*grid`));
    expect(css).toMatch(/\.setupInspector :global\(\.entry-candidate-blocked\)[^{]*\{[^}]*border-top-color:/);
  });
  it("starts a newly selected page at the top of its own scroll container", () => {
    const { rerender } = render(<TradeOpsShell view="analytics" onViewChange={() => {}} apiStatus="UNKNOWN" />);
    screen.getByRole("main").scrollTop = 900;
    rerender(<TradeOpsShell view="journal" onViewChange={() => {}} apiStatus="UNKNOWN" />);
    expect(screen.getByRole("main").scrollTop).toBe(0);
  });
  it("keeps narrow-screen titles and controls on separate rows without reducing the desktop header", () => {
    // jsdom has no layout engine. Browser QA reproduced wrapped title text at
    // 390px; this contract guards the responsive rules that resolve that cause.
    const css = readFileSync(resolve(process.cwd(), "src/features/tradeops/tradeops.module.css"), "utf8");
    const mobile = css.match(/@media\s*\(max-width:\s*639px\)\s*\{([\s\S]*?)\n\}/)?.[1];
    expect(mobile).toBeDefined();
    expect(css).toMatch(/\.topbar\s*\{[^}]*height:\s*64px/);
    expect(css).toMatch(/\.headerIdentity\s*\{[^}]*flex-shrink:\s*0/);
    expect(css).toMatch(/\.headerTitle h1\s*\{[^}]*white-space:\s*nowrap/);
    expect(mobile).toMatch(/\.topbar\s*\{[^}]*height:\s*auto/);
    expect(mobile).toMatch(/\.topbar\s*\{[^}]*flex-direction:\s*column/);
    expect(mobile).toMatch(/\.topbar\s*\{[^}]*align-items:\s*stretch/);
    expect(mobile).toMatch(/\.headerActions\s*\{[^}]*justify-content:\s*flex-start/);
    expect(css).toMatch(/\.headerActions\s*\{[^}]*flex-wrap:\s*wrap/);
    expect(mobile).not.toMatch(/display:\s*none|overflow:\s*hidden|font-size:/);
  });

  it.each([
    ["dashboard", "Dashboard"], ["accounts", "Accounts"], ["risk", "Risk & Rules"],
    ["analytics", "Analytics"], ["journal", "Journal"],
  ] as const)("retains the complete %s title and keyboard-accessible header controls", (view, title) => {
    const refresh = vi.fn();
    const lock = vi.fn();
    render(<TradeOpsShell view={view} onViewChange={() => {}} apiStatus="STALE"
      refreshAction={<button type="button" onClick={refresh}>Refresh data</button>}
      credentialAction={<button type="button" onClick={lock}>Lock paper data</button>} />);
    const header = within(screen.getByRole("banner"));
    expect(header.getByRole("heading", { level: 1, name: title })).toBeVisible();
    expect(header.getByRole("status", { name: "API status" })).toHaveTextContent("API STALE");
    for (const name of ["Open navigation", "Refresh data", "Lock paper data"]) {
      const button = header.getByRole("button", { name });
      expect(button).toBeVisible();
      expect(button).toBeEnabled();
      button.focus();
      expect(button).toHaveFocus();
    }
    fireEvent.click(header.getByRole("button", { name: "Refresh data" }));
    fireEvent.click(header.getByRole("button", { name: "Lock paper data" }));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(lock).toHaveBeenCalledTimes(1);
  });

  it("preserves the original brand and navigation group order", () => {
    render(<TradeOpsShell view="dashboard" onViewChange={() => {}} apiStatus="UNKNOWN"><p>Panel content</p></TradeOpsShell>);
    expect(screen.getByText("TradeOps")).toBeInTheDocument();
    expect(screen.getByRole("main")).toHaveTextContent("Panel content");
    expect(NAV_GROUPS.map((group) => [group.label, group.items.map((item) => item.label)])).toEqual([
      ["Overview", ["Dashboard"]], ["Trading", ["Accounts", "Exec Quality"]],
      ["Monitoring", ["Risk & Rules", "Alerts", "Prop Firm"]], ["Analytics", ["Analytics"]],
      ["Automation", ["Alert Setup", "Optimizer"]], ["Strategy", ["Strategies"]],
      ["Ops", ["Journal", "Notifications", "Settings"]],
    ]);
  });

  it("provides keyboard-accessible original links for all restored views", () => {
    const onViewChange = vi.fn();
    const result = render(<TradeOpsShell view="dashboard" onViewChange={onViewChange} apiStatus="ONLINE" />);
    const navigation = screen.getByRole("navigation", { name: "TradeOps navigation" });
    const buttons = within(navigation).getAllByRole("link");
    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual(NAV_GROUPS.flatMap((group) => group.items.map((item) => item.label)));
    for (const button of buttons) {
      expect(button.tagName).toBe("A");
      expect(button.tabIndex).toBe(0);
      button.focus();
      expect(button).toHaveFocus();
    }
    fireEvent.click(within(navigation).getByRole("link", { name: "Accounts" }));
    expect(onViewChange).toHaveBeenCalledWith("accounts");
    expect(within(navigation).getByRole("link", { name: "Dashboard" })).toHaveAttribute("aria-current", "page");
    result.rerender(<TradeOpsShell view="accounts" onViewChange={onViewChange} apiStatus="ONLINE" />);
    expect(within(navigation).getByRole("link", { name: "Accounts" })).toHaveAttribute("aria-current", "page");
  });

  it("opens unsupported-service pages while mode and emergency actions stay disabled", () => {
    const onViewChange = vi.fn();
    render(<TradeOpsShell view="dashboard" onViewChange={onViewChange} apiStatus="UNKNOWN" />);
    const navigation = screen.getByRole("navigation", { name: "TradeOps navigation" });
    for (const name of ["Exec Quality", "Alerts", "Prop Firm", "Alert Setup", "Optimizer", "Strategies", "Notifications", "Settings"]) {
      const button = within(navigation).getByRole("link", { name });
      expect(button).toHaveAttribute("href");
      fireEvent.click(button);
    }
    expect(onViewChange).toHaveBeenCalledTimes(8);
    expect(screen.getByRole("button", { name: "Live" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Kill switch unavailable" })).toBeDisabled();
  });

  it("retains accessible names and reasons after collapse", () => {
    render(<TradeOpsShell view="dashboard" onViewChange={() => {}} apiStatus="UNKNOWN" />);
    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Accounts" })).toHaveAccessibleName("Accounts");
    expect(screen.getByRole("link", { name: "Optimizer" })).toHaveAttribute("title", "Optimizer");
  });

  it("closes mobile navigation with Escape and returns focus to the opener", () => {
    render(<TradeOpsShell view="dashboard" onViewChange={() => {}} apiStatus="UNKNOWN" />);
    const opener = screen.getByRole("button", { name: "Open navigation" });
    fireEvent.click(opener);
    const dialog = screen.getByRole("dialog", { name: "Navigation" });
    expect(within(dialog).getByRole("button", { name: "Close navigation" })).toHaveFocus();
    expect(screen.getByRole("main", { hidden: true }).closest("[inert]")).not.toBeNull();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it("traps mobile navigation focus and closes after selecting a supported view", () => {
    const onViewChange = vi.fn();
    render(<TradeOpsShell view="dashboard" onViewChange={onViewChange} apiStatus="UNKNOWN" />);
    const opener = screen.getByRole("button", { name: "Open navigation" });
    fireEvent.click(opener);
    const dialog = screen.getByRole("dialog", { name: "Navigation" });
    const close = within(dialog).getByRole("button", { name: "Close navigation" });
    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(within(dialog).getByRole("link", { name: "Settings" })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "Tab" });
    expect(close).toHaveFocus();
    fireEvent.click(within(dialog).getByRole("link", { name: "Accounts" }));
    expect(onViewChange).toHaveBeenCalledWith("accounts");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it.each(["ONLINE", "OFFLINE", "UNKNOWN", "STALE"] as const)("identifies API %s separately from broker status", (apiStatus) => {
    render(<TradeOpsShell view="dashboard" onViewChange={() => {}} apiStatus={apiStatus} />);
    expect(screen.getByRole("status", { name: "API status" })).toHaveTextContent(`API ${apiStatus}`);
    expect(screen.getByText("Broker status unavailable")).toBeInTheDocument();
    expect(screen.queryByText(/broker connected|synced/i)).not.toBeInTheDocument();
    for (const control of screen.getAllByRole("button", { name: /live|kill/i })) expect(control).toBeDisabled();
    expect(screen.getByText("Observation only · read-only")).toBeInTheDocument();
  });

  it("renders caller-supplied read-only refresh and credential actions", () => {
    render(<TradeOpsShell view="dashboard" onViewChange={() => {}} apiStatus="OFFLINE" refreshAction={<button>Refresh data</button>} credentialAction={<button>Operator credential</button>} />);
    expect(screen.getByRole("button", { name: "Refresh data" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Operator credential" })).toBeInTheDocument();
  });
});

describe("account strip", () => {
  it("keeps ledger balance and simulation-reported balance separate", () => {
    render(<AccountStrip accounts={buildAccountViews([ledger()], [simulation()])} status="ready" />);
    expect(screen.getByText("Ledger balance").nextElementSibling).toHaveTextContent("USD 8.75");
    expect(screen.getByText("Simulation-reported balance").nextElementSibling).toHaveTextContent("USD 9.50");
    expect(screen.getByText("Broker equity").nextElementSibling).toHaveTextContent("—");
    expect(screen.getByText("Win rate").nextElementSibling).toHaveTextContent("25.0%");
    expect(screen.getByText("PAPER")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.queryByText(/funded|live/i)).not.toBeInTheDocument();
  });

  it("shows missing sources as unavailable without replacing a known zero", () => {
    render(<AccountStrip accounts={buildAccountViews([ledger({ balanceMinor: 0 })], null)} status="ready" />);
    expect(screen.getByText("Ledger balance").nextElementSibling).toHaveTextContent("USD 0.00");
    expect(screen.getByText("Simulation-reported balance").nextElementSibling).toHaveTextContent("—");
    expect(screen.getByText("Simulation source unavailable")).toBeInTheDocument();
    expect(screen.getByText("Win rate").nextElementSibling).toHaveTextContent("—");
  });

  it("warns about currency and scale conflicts without merging source money", () => {
    render(<AccountStrip accounts={buildAccountViews([ledger()], [simulation({ currencyCode: "EUR", currencyScale: 3 })])} status="ready" />);
    expect(screen.getByText(/currency\/scale mismatch/i)).toBeInTheDocument();
    expect(screen.getByText("EUR 0.950")).toBeInTheDocument();
    expect(screen.getByText("USD 8.75")).toBeInTheDocument();
  });

  it("selects and clears an account without navigating", () => {
    const onAccountSelect = vi.fn();
    const accounts = buildAccountViews([ledger()], null);
    const result = render(<AccountStrip accounts={accounts} status="ready" selectedAccountId={null} onAccountSelect={onAccountSelect} />);
    fireEvent.click(screen.getByRole("button", { name: "Filter by Paper A" }));
    expect(onAccountSelect).toHaveBeenLastCalledWith("paper-a");
    result.rerender(<AccountStrip accounts={accounts} status="ready" selectedAccountId="paper-a" onAccountSelect={onAccountSelect} />);
    expect(screen.getByRole("button", { name: "Filter by Paper A" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Filter by Paper A" }));
    expect(onAccountSelect).toHaveBeenLastCalledWith(null);
  });

  it.each([["loading", "Loading paper accounts"], ["unavailable", "Paper accounts unavailable"], ["ready", "No paper accounts"]] as const)("renders the %s state explicitly", (status, message) => {
    render(<AccountStrip accounts={[]} status={status} />);
    expect(screen.getByText(message)).toBeInTheDocument();
  });
});

describe("account aggregate bar", () => {
  it("formats BigInt totals and separates currency AND scale groups by source", () => {
    const summary = summarizeAccounts([
      ledger({ balanceMinor: Number.MAX_SAFE_INTEGER }),
      ledger({ accountId: "b", balanceMinor: Number.MAX_SAFE_INTEGER }),
      ledger({ accountId: "c", currencyScale: 3 }),
      ledger({ accountId: "d", currencyCode: "EUR" }),
    ], [simulation()]);
    render(<AggregateBar summary={summary} status="ready" />);
    const ledgerGroup = screen.getByRole("group", { name: "Ledger account aggregates" });
    expect(within(ledgerGroup).getByText("USD 180143985094819.82")).toBeInTheDocument();
    expect(within(ledgerGroup).getByText("USD 0.875")).toBeInTheDocument();
    expect(within(ledgerGroup).getByText("EUR 8.75")).toBeInTheDocument();
    const simulationGroup = screen.getByRole("group", { name: "Simulation account aggregates" });
    expect(within(simulationGroup).getByText("USD 9.50")).toBeInTheDocument();
    expect(within(simulationGroup).getByText("USD -0.50")).toBeInTheDocument();
    expect(screen.getByText(/not the loaded intent window/i)).toBeInTheDocument();
  });

  it("keeps unavailable aggregates distinct from known empty", () => {
    const result = render(<AggregateBar summary={summarizeAccounts(null, null)} status="ready" />);
    expect(screen.getByText("Ledger unavailable")).toBeInTheDocument();
    expect(screen.getByText("Simulation unavailable")).toBeInTheDocument();
    expect(screen.queryByText("0.0%")).not.toBeInTheDocument();
    result.rerender(<AggregateBar summary={summarizeAccounts([], [])} status="ready" />);
    expect(screen.getByText("No ledger accounts")).toBeInTheDocument();
    expect(screen.getByText("No simulation accounts")).toBeInTheDocument();
  });

  it.each([["loading", "Loading account aggregates"], ["unavailable", "Account aggregates unavailable"]] as const)("shows %s without synthetic totals", (status, message) => {
    render(<AggregateBar summary={null} status={status} />);
    expect(screen.getByText(message)).toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });
});
