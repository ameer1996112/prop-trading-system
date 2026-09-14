import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OriginalServicePage } from "../src/features/tradeops/original/OriginalServicePage";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("original unsupported service pages", () => {
  it.each([
    ["execution-quality", "Pipeline Traces", "TCA Metrics", "TCA Metrics"],
    ["alerts", "All", "Critical", "Info"],
    ["alert-setup", "Results", "Timeline", "Approved"],
  ])("supports roving keyboard focus for %s tabs without any service requests", (view, first, second, last) => {
    const fetchSpy = vi.fn(() => { throw new Error("Service access forbidden"); });
    vi.stubGlobal("fetch", fetchSpy);
    render(<OriginalServicePage view={view} />);
    const firstTab = screen.getByRole("tab", { name: first });
    firstTab.focus();
    fireEvent.keyDown(firstTab, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: second })).toHaveFocus();
    expect(screen.getByRole("tab", { name: second })).toHaveAttribute("aria-selected", "true");
    expect(firstTab).toHaveAttribute("tabindex", "-1");
    fireEvent.keyDown(document.activeElement!, { key: "End" });
    expect(screen.getByRole("tab", { name: last })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    expect(firstTab).toHaveFocus();
    fireEvent.keyDown(firstTab, { key: "ArrowLeft" });
    expect(screen.getByRole("tab", { name: last })).toHaveFocus();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([
    ["execution-quality", "Execution Quality"], ["alerts", "Alerts"],
    ["prop-firm", "Prop Firm Challenge"], ["alert-setup", "Alert Setup"],
    ["optimizer", "Optimizer"], ["strategies", "Strategy Studio"],
    ["notifications", "Notification Settings"], ["settings", "Settings"],
  ])("renders the %s original presentation without service requests", (view, heading) => {
    const fetchSpy = vi.fn(() => { throw new Error("No service access permitted"); });
    vi.stubGlobal("fetch", fetchSpy);
    render(<OriginalServicePage view={view} />);
    expect(screen.getByRole("heading", { name: heading, level: 1 })).toBeInTheDocument();
    expect(screen.getAllByText(/unavailable/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/demo account|all clear|safe to trade|backend offline.*demo/i)).not.toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("switches execution tabs locally and keeps unavailable TCA metrics unknown", () => {
    render(<OriginalServicePage view="execution-quality" />);
    expect(screen.getByRole("table", { name: "Pipeline traces" })).toBeInTheDocument();
    for (const column of ["Symbol", "Side", "Correlation ID", "Account", "Total", "Time"]) expect(screen.getByRole("columnheader", { name: column })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "TCA Metrics" }));
    expect(screen.queryByRole("table", { name: "Pipeline traces" })).not.toBeInTheDocument();
    for (const label of ["Avg Slippage", "Avg Spread Cost", "Avg Execution Time", "Total Trades"]) {
      expect(within(screen.getByRole("group", { name: label })).getByText("—")).toBeInTheDocument();
    }
    expect(screen.getByRole("heading", { name: "Slippage by Symbol (Last 30 Days)" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Slippage by Hour (UTC)" })).toBeInTheDocument();
    const latency = within(screen.getByRole("region", { name: "Latency Breakdown (Last 7 Days)" }));
    for (const label of ["Signal → Submit", "Submit → Fill", "Total", "P95 Latency", "P99 Latency"]) expect(latency.getByText(label)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "30d" }));
    expect(screen.getByRole("button", { name: "30d" })).toHaveAttribute("aria-pressed", "true");
  });

  it("filters alerts without claiming a healthy or empty remote queue", () => {
    render(<OriginalServicePage view="alerts" />);
    fireEvent.click(screen.getByRole("tab", { name: "Critical" }));
    expect(screen.getByRole("tab", { name: "Critical" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("region", { name: "Active alerts" })).toHaveTextContent("Unavailable");
    expect(screen.getByRole("region", { name: "Dead Letters" })).toHaveTextContent("Unavailable");
    expect(screen.getByRole("button", { name: "Acknowledge All" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Clear All" })).toBeDisabled();
  });

  it("preserves the prop-firm section sequence and neutral health gauge", () => {
    render(<OriginalServicePage view="prop-firm" />);
    const names = ["Challenge Health", "Account Overview", "Equity Curve", "Daily P&L", "Challenge Metrics", "Challenge Rules", "Payout Readiness", "Performance Summary", "Daily Performance Calendar"];
    const sections = names.map((name) => screen.getByRole("region", { name }));
    sections.slice(1).forEach((section, index) => expect(sections[index]!.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy());
    expect(screen.getByRole("img", { name: "Challenge health unavailable" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reset Daily" })).toBeDisabled();
  });

  it("keeps alert setup form drafts and result tabs local while launches remain disabled", () => {
    render(<OriginalServicePage view="alert-setup" />);
    const name = screen.getByRole("textbox", { name: "Alert name" });
    fireEvent.change(name, { target: { value: "Local draft" } });
    expect(name).toHaveValue("Local draft");
    for (const tab of ["Results", "Timeline", "History", "Approved"]) {
      fireEvent.click(screen.getByRole("tab", { name: tab }));
      expect(screen.getByRole("tab", { name: tab })).toHaveAttribute("aria-selected", "true");
      expect(screen.getByRole("tabpanel")).toHaveTextContent("Unavailable");
    }
    expect(screen.getByRole("button", { name: "Start Batch" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel Batch" })).toBeDisabled();
  });

  it("retains optimizer run analysis and history while local form changes never launch runs", () => {
    render(<OriginalServicePage view="optimizer" />);
    expect(screen.getByRole("region", { name: "Run launcher" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Active run" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Portfolio overview" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Run comparison & history" })).toHaveTextContent("Unavailable");
    fireEvent.change(screen.getByRole("combobox", { name: "Mode" }), { target: { value: "Validate" } });
    expect(screen.getByRole("textbox", { name: "Source run ID" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start Run" })).toBeDisabled();
  });

  it("retains independent multi-broker draft selections without requests or execution", () => {
    const fetchSpy = vi.fn(() => { throw new Error("Service access forbidden"); });
    vi.stubGlobal("fetch", fetchSpy);
    render(<OriginalServicePage view="optimizer" />);
    const mode = screen.getByRole("combobox", { name: "Mode" });
    fireEvent.change(mode, { target: { value: "Multi-Broker Validate" } });
    const brokers = within(screen.getByRole("group", { name: "Broker set" }));
    fireEvent.click(brokers.getByRole("checkbox", { name: "Vantage" }));
    fireEvent.click(brokers.getByRole("checkbox", { name: "OANDA" }));
    expect(brokers.getByRole("checkbox", { name: "Vantage" })).toBeChecked();
    expect(brokers.getByRole("checkbox", { name: "OANDA" })).toBeChecked();
    expect(brokers.getByRole("checkbox", { name: "FXCM" })).not.toBeChecked();
    fireEvent.change(mode, { target: { value: "Bayesian" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Broker" }), { target: { value: "FXCM" } });
    fireEvent.change(mode, { target: { value: "Multi-Broker Validate" } });
    expect(screen.getByRole("checkbox", { name: "Vantage" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "OANDA" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "FXCM" })).not.toBeChecked();
    fireEvent.click(screen.getByRole("checkbox", { name: "Vantage" }));
    expect(screen.getByRole("checkbox", { name: "Vantage" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "OANDA" })).toBeChecked();
    expect(screen.getByRole("button", { name: "Start Run" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel Run" })).toBeDisabled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("allows strategy JSON drafting but never validation, creation, activation, or saving", () => {
    render(<OriginalServicePage view="strategies" />);
    const editor = screen.getByRole("textbox", { name: "Strategy configuration JSON" });
    fireEvent.change(editor, { target: { value: '{"name":"draft"}' } });
    expect(editor).toHaveValue('{"name":"draft"}');
    for (const action of ["New", "Validate", "Save", "Activation unavailable"]) expect(screen.getByRole("button", { name: action })).toBeDisabled();
  });

  it("shows routing categories without inventing notification settings", () => {
    render(<OriginalServicePage view="notifications" />);
    const table = within(screen.getByRole("table", { name: "Notification Routing" }));
    for (const column of ["Alert Type", "Discord", "Telegram", "Discord Channel"]) expect(table.getByRole("columnheader", { name: column })).toBeInTheDocument();
    for (const name of ["Trade Signals", "Trade Closes", "Risk Alerts", "Guard Alerts", "Bug / System Errors"]) expect(table.getByRole("row", { name: new RegExp(name) })).toHaveTextContent("Unavailable");
    expect(screen.queryAllByRole("switch")).toHaveLength(0);
  });

  it("preserves settings section order and treats timezone as a local unsaved draft", () => {
    const storageSpy = vi.spyOn(Storage.prototype, "setItem");
    render(<OriginalServicePage view="settings" />);
    const names = ["Display Timezone", "Connection Status", "AI / ML / RAG Configuration", "System Health", "TradingView MCP", "Rollover Guard", "Broker Sync Controls", "Alert Rules", "Environment", "Infrastructure"];
    const sections = names.map((name) => screen.getByRole("region", { name }));
    sections.slice(1).forEach((section, index) => expect(sections[index]!.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "UTC UTC" }));
    expect(screen.getByRole("button", { name: "UTC UTC" })).toHaveAttribute("aria-pressed", "true");
    expect(storageSpy).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Sync All Accounts" })).toBeDisabled();
    storageSpy.mockRestore();
  });
});
