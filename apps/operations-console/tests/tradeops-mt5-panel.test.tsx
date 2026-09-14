import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TradeOpsDashboard } from "../src/features/tradeops/TradeOpsDashboard";
import { Mt5AuthorizationError } from "../src/features/tradeops/mt5-health";
import type { Mt5HealthSummary } from "../src/features/tradeops/mt5-health-contract.mjs";

const summary: Mt5HealthSummary = { schema_version: "AgentHealthSummaryV1", server_time_epoch: 1000, status: "ONLINE",
  current: { last_accepted_epoch: 1000, request_sequence: 7, server_sequence: 7, terminal_build: 5200, source_symbol: "EURUSD",
    terminal_connection_state: "CONNECTED", account_trade_permission: "ALLOWED", terminal_trade_permission: "DENIED", algo_trading_permission: "DENIED" },
  recent: [{ request_sequence: 8, result_code: "STALE_TIMESTAMP", server_sequence: null, received_at_epoch: 1000 }] };
const publicLoaders = { health: async () => ({ state: "ONLINE" as const, execution: "DISABLED" as const, paperSimulator: "ENABLED" as const, message: "Online" }),
  receipts: async () => ({ state: "EMPTY" as const, ingressEnabled: true, count: 0, items: [], message: "Empty" }) };
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1000000); vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible"); vi.spyOn(navigator, "onLine", "get").mockReturnValue(true); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
async function click(name: string) { await act(async () => { fireEvent.click(screen.getByRole("button", { name })); }); }

describe("restored MT5 health panel", () => {
  it("reads health only after opt-in, shows separate EA facts on Dashboard and Accounts", async () => {
    const mt5 = vi.fn(async () => summary);
    render(<TradeOpsDashboard sessionOptions={{ loaders: { ...publicLoaders, mt5 } }} />); await act(async () => {});
    expect(mt5).not.toHaveBeenCalled(); expect(screen.getByRole("status", { name: "EA heartbeat status" })).toHaveTextContent("UNKNOWN");
    await click("Read MT5 health");
    expect(mt5).toHaveBeenCalledTimes(1); expect(screen.getByRole("status", { name: "EA heartbeat status" })).toHaveTextContent("ONLINE");
    const panel = within(screen.getByRole("region", { name: "MT5 health" }));
    expect(panel.getByText("CONNECTED")).toBeVisible(); expect(panel.getByText("5200")).toBeVisible();
    expect(panel.getByText(/permission flags.*not trading authority/i)).toBeVisible();
    expect(panel.getByText(/balance, equity, positions.*not supplied/i)).toBeVisible();
    fireEvent.click(panel.getByText("Recent sync results")); expect(panel.getByText("STALE_TIMESTAMP")).toBeVisible();
    fireEvent.click(screen.getByRole("link", { name: "Accounts" }));
    expect(screen.getByRole("region", { name: "MT5 health" })).toBeVisible(); expect(mt5).toHaveBeenCalledTimes(1);
    await click("Disconnect health feed"); expect(screen.queryByText("5200")).not.toBeInTheDocument(); expect(screen.queryByText("STALE_TIMESTAMP")).not.toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); }); expect(mt5).toHaveBeenCalledTimes(1);
  });
  it("shows Access instructions after auth failure and makes no automatic retry", async () => {
    const mt5 = vi.fn(async () => { throw new Mt5AuthorizationError(); });
    render(<TradeOpsDashboard sessionOptions={{ loaders: { ...publicLoaders, mt5 } }} />); await act(async () => {}); await click("Read MT5 health");
    expect(screen.getByText(/Cloudflare Access sign-in required/)).toBeVisible();
    expect(screen.getByText("npm run preview:tradeops -- --mt5-health")).toBeVisible();
    await act(async () => { await vi.advanceTimersByTimeAsync(90000); }); expect(mt5).toHaveBeenCalledTimes(1);
  });
  it("ages the badge while hidden without a second network polling loop", async () => {
    const mt5 = vi.fn(async () => summary);
    render(<TradeOpsDashboard sessionOptions={{ loaders: { ...publicLoaders, mt5 } }} />); await act(async () => {}); await click("Read MT5 health");
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); await vi.advanceTimersByTimeAsync(91000); });
    expect(screen.getByRole("status", { name: "EA heartbeat status" })).toHaveTextContent("OFFLINE"); expect(mt5).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/last-known health/i)).toBeVisible();
  });
  it.each(["paused", "fetch failure"])("keeps recent heartbeat age separate from %s transport state", async (cause) => {
    const mt5 = vi.fn(async () => summary);
    render(<TradeOpsDashboard sessionOptions={{ loaders: { ...publicLoaders, mt5 } }} />); await act(async () => {}); await click("Read MT5 health");
    if (cause === "paused") {
      vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
      await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    } else {
      mt5.mockRejectedValue(new Error("Network unavailable"));
      await click("Refresh data");
    }
    expect(screen.getByRole("status", { name: "EA heartbeat status" })).toHaveTextContent("ONLINE");
    expect(screen.getByText(/last-known health/i)).toBeVisible();
    await act(async () => { await vi.advanceTimersByTimeAsync(36000); });
    expect(screen.getByRole("status", { name: "EA heartbeat status" })).toHaveTextContent("STALE");
  });
});
