import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TradeOpsShell } from "../src/features/tradeops/TradeOpsShell";
import { NAV_GROUPS } from "../src/features/tradeops/navigation";
import { TradeOpsDashboard } from "../src/features/tradeops/TradeOpsDashboard";

afterEach(cleanup);

describe("original TradeOps restoration", () => {
  it("makes all thirteen original pages navigable without enabling execution", () => {
    const onViewChange = vi.fn();
    render(<TradeOpsShell view="dashboard" onViewChange={onViewChange} apiStatus="UNKNOWN" />);
    const nav = within(screen.getByRole("navigation", { name: "TradeOps navigation" }));
    const items = NAV_GROUPS.flatMap((group) => group.items);
    expect(items).toHaveLength(13);
    for (const item of items) {
      const link = nav.getByRole("link", { name: item.label });
      expect(link).toHaveAttribute("href");
      fireEvent.click(link);
      expect(onViewChange).toHaveBeenLastCalledWith(item.view);
    }
    expect(screen.getByRole("button", { name: "Live" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Kill switch unavailable" })).toBeDisabled();
    expect(screen.getByText("Broker status unavailable")).toBeInTheDocument();
  });

  it("keeps the familiar dashboard structure visible while private data is locked", () => {
    const pending = () => new Promise<never>(() => {});
    render(<TradeOpsDashboard sessionOptions={{ loaders: { health: pending, receipts: pending, ledger: pending, simulation: pending, readiness: pending, decisions: pending } }} />);
    expect(screen.queryByText("Unlock your paper workspace")).not.toBeInTheDocument();
    expect(screen.getByRole("form", { name: "Unlock paper data" })).toBeInTheDocument();
    const sections = ["Account aggregates", "Market sessions", "Paper accounts", "Trade permissions", "Open paper positions", "Setup decisions panel"];
    const nodes = sections.map((name) => screen.getByRole("region", { name }));
    for (let i = 1; i < nodes.length; i++) {
      expect(nodes[i - 1]!.compareDocumentPosition(nodes[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(screen.getByRole("heading", { name: "Latest Signals" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Strategy" })).toBeDisabled();
  });
});
