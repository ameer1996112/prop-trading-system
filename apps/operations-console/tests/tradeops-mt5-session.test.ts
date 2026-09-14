import { describe, expect, it, vi } from "vitest";
import { createTradeOpsSession, type TradeOpsLoaders } from "../src/features/tradeops/session";
import { Mt5AuthorizationError } from "../src/features/tradeops/mt5-health";
import type { Mt5HealthSummary } from "../src/features/tradeops/mt5-health-contract.mjs";

const summary: Mt5HealthSummary = { schema_version: "AgentHealthSummaryV1", server_time_epoch: 1000, status: "UNKNOWN", current: null, recent: [] };
function loaders(): Partial<TradeOpsLoaders> { return { health: async () => ({ state: "ONLINE", paperSimulator: "ENABLED", execution: "DISABLED", message: "Online" }),
  receipts: async () => ({ state: "EMPTY", ingressEnabled: true, count: 0, items: [], message: "Empty" }), ledger: async () => [],
  simulation: async () => ({ accounts: [], intents: [] }), readiness: async () => { throw new Error(); }, decisions: async () => ({ state: "EMPTY", items: [], message: "Empty" }) }; }
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

describe("opt-in MT5 health in shared session", () => {
  it("does not request health until explicit connect, independently of paper unlock", async () => {
    const mt5 = vi.fn(async () => summary); const session = createTradeOpsSession({ loaders: { ...loaders(), mt5 }, now: () => 10 });
    await session.refresh(); expect(mt5).not.toHaveBeenCalled();
    expect(session.getSnapshot().mt5Connection).toBe("DISCONNECTED");
    session.connectMt5(); await session.refresh();
    expect(mt5).toHaveBeenCalledTimes(1); expect(mt5).toHaveBeenCalledWith(expect.any(AbortSignal));
    expect(session.getSnapshot()).toMatchObject({ unlocked: false, mt5Connection: "CONNECTED", mt5: { data: summary, lastSuccess: 10 } });
  });
  it("deduplicates simultaneous refreshes and never passes a paper credential", async () => {
    const pending = deferred<Mt5HealthSummary>(); const mt5 = vi.fn(() => pending.promise);
    const session = createTradeOpsSession({ loaders: { ...loaders(), mt5 } });
    session.unlock("private-paper-credential"); session.connectMt5();
    const a = session.refresh(); const b = session.refresh(); expect(a).toBe(b); await Promise.resolve();
    expect(mt5.mock.calls).toEqual([[expect.any(AbortSignal)]]);
    pending.resolve(summary); await a;
    expect(JSON.stringify(session.getSnapshot())).not.toContain("private-paper-credential");
  });
  it("stops health reads and purges only health after Access expires", async () => {
    let expired = false; const mt5 = vi.fn(async () => { if (expired) throw new Mt5AuthorizationError(); return summary; });
    const session = createTradeOpsSession({ loaders: { ...loaders(), mt5 } }); session.unlock("paper"); session.connectMt5(); await session.refresh();
    expired = true; await session.refresh();
    expect(session.getSnapshot()).toMatchObject({ unlocked: true, mt5Connection: "AUTH_REQUIRED", mt5: { data: null, lastSuccess: null, loading: false } });
    const count = mt5.mock.calls.length; await session.refresh(); expect(mt5).toHaveBeenCalledTimes(count);
    expired = false; session.connectMt5(); await session.refresh(); expect(session.getSnapshot().mt5.data).toEqual(summary);
  });
  it("retains last good health with an explicit stale error on fetch failure", async () => {
    let failed = false; const session = createTradeOpsSession({ now: () => 10, loaders: { ...loaders(), mt5: async () => { if (failed) throw new Error("secret response"); return summary; } } });
    session.connectMt5(); await session.refresh(); failed = true; await session.refresh();
    expect(session.getSnapshot().mt5).toMatchObject({ data: summary, lastSuccess: 10, stale: true, error: "MT5 health is unavailable." });
    expect(JSON.stringify(session.getSnapshot())).not.toContain("secret response");
  });
  it.each(["disconnectMt5", "dispose"] as const)("%s aborts and purges health, ignoring late replies", async (action) => {
    const pending = deferred<Mt5HealthSummary>(); const mt5 = vi.fn<(signal: AbortSignal) => Promise<Mt5HealthSummary>>(() => pending.promise);
    const session = createTradeOpsSession({ loaders: { ...loaders(), mt5 } }); session.connectMt5(); const cycle = session.refresh(); await Promise.resolve();
    const signal = mt5.mock.calls[0]![0];
    session[action](); expect(signal.aborted).toBe(true); pending.resolve(summary); await cycle;
    expect(session.getSnapshot()).toMatchObject({ mt5Connection: "DISCONNECTED", mt5: { data: null, lastSuccess: null } });
  });
  it("a late old authorization failure cannot purge a reconnected session", async () => {
    const pending = deferred<Mt5HealthSummary>(); let first = true;
    const session = createTradeOpsSession({ loaders: { ...loaders(), mt5: () => { if (first) { first = false; return pending.promise; } return Promise.resolve(summary); } } });
    session.connectMt5(); const old = session.refresh(); await Promise.resolve(); session.disconnectMt5(); session.connectMt5(); await session.refresh();
    pending.reject(new Mt5AuthorizationError()); await old;
    expect(session.getSnapshot().mt5.data).toEqual(summary); expect(session.getSnapshot().mt5Connection).toBe("CONNECTED");
  });
  it("pause cancels reads and resume shares the same refresh owner", async () => {
    const mt5 = vi.fn(async () => summary); const session = createTradeOpsSession({ loaders: { ...loaders(), mt5 } });
    session.connectMt5(); await session.refresh(); session.pause();
    expect(session.getSnapshot()).toMatchObject({ paused: true, mt5: { data: summary, stale: true } });
    await session.refresh(); expect(mt5).toHaveBeenCalledTimes(2); expect(session.getSnapshot().mt5.stale).toBe(false);
  });
});
