import { StrictMode } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiHealthSnapshot } from "../src/lib/api";
import * as sessionModule from "../src/features/tradeops/session";
import { type TradeOpsLoaders } from "../src/features/tradeops/session";
import { useTradeOps } from "../src/features/tradeops/use-tradeops";

const health: ApiHealthSnapshot = { state: "ONLINE", paperSimulator: "ENABLED", execution: "DISABLED", message: "Online." };

function loaders(): TradeOpsLoaders {
  return {
    health: vi.fn(async () => health),
    receipts: vi.fn(async () => ({ state: "EMPTY" as const, ingressEnabled: true, count: 0, items: [], message: "No receipts." })),
    ledger: vi.fn(async () => []),
    simulation: vi.fn(async () => ({ accounts: [], intents: [] })),
    readiness: vi.fn(async () => ({
      state: "DEGRADED" as const, evaluatedAt: "2026-09-02T00:00:00Z", execution: "DISABLED" as const,
      thresholds: { receiptMaxAgeSeconds: 60, staleTradeSeconds: 900, maxDailyLossBps: 500, maxTotalDrawdownBps: 1_000, maxOpenRiskBps: 300, maxOpenPositions: 4 },
      killSwitch: { enabled: false, reason: null, changedAt: null }, latestReceipt: null,
      openHealth: { openIntents: 0, staleOpenIntents: 0, oldestOpenIntentAt: null }, accounts: [], reasons: [],
    })),
    decisions: vi.fn(async () => ({ state: "EMPTY" as const, items: [], message: "No decisions." })),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("TradeOps shared polling hook", () => {
  it.each(["hidden", "offline"] as const)("does not request on initial %s, unlock, or manual refresh; recovers exactly once", async (condition) => {
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue(condition === "hidden" ? "hidden" : "visible");
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(condition !== "offline");
    const api = loaders();
    const { result } = renderHook(() => useTradeOps({ loaders: api }));
    await act(async () => {
      result.current.unlock("secret");
      await result.current.refresh();
      await vi.advanceTimersByTimeAsync(90_000);
    });
    for (const loader of Object.values(api)) expect(loader).not.toHaveBeenCalled();
    expect(result.current.snapshot.paused).toBe(true);
    expect(result.current.snapshot.unlocked).toBe(true);
    await act(async () => {
      visibility.mockReturnValue("visible");
      online.mockReturnValue(true);
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("online"));
      window.dispatchEvent(new Event("online"));
    });
    for (const loader of Object.values(api)) expect(loader).toHaveBeenCalledTimes(1);
    expect(result.current.snapshot.health.data).toBe(health);
    expect(result.current.snapshot.paused).toBe(false);
  });

  it("uses one 30-second timer and a stable session through local view rerenders", async () => {
    const api = loaders();
    const { result, rerender } = renderHook(({ view }) => { void view; return useTradeOps({ loaders: api }); }, { initialProps: { view: "overview" } });
    await act(async () => { await Promise.resolve(); });
    const actions = { refresh: result.current.refresh, unlock: result.current.unlock, lock: result.current.lock };
    rerender({ view: "accounts" });
    rerender({ view: "receipts" });
    expect(result.current.refresh).toBe(actions.refresh);
    expect(result.current.unlock).toBe(actions.unlock);
    expect(result.current.lock).toBe(actions.lock);
    expect(vi.getTimerCount()).toBe(1);
    expect(api.health).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(29_999); });
    expect(api.health).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(api.health).toHaveBeenCalledTimes(2);
    expect(api.receipts).toHaveBeenCalledTimes(2);
    expect(api.ledger).not.toHaveBeenCalled();
  });

  it("aborts on offline, retains stale data, and deduplicates recovery plus manual refresh", async () => {
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    const api = loaders();
    const signals: AbortSignal[] = [];
    let delay = false;
    let finish!: (value: ApiHealthSnapshot) => void;
    api.health = vi.fn((signal) => {
      signals.push(signal!);
      return delay ? new Promise<ApiHealthSnapshot>((resolve) => { finish = resolve; }) : Promise.resolve(health);
    });
    const { result } = renderHook(() => useTradeOps({ loaders: api }));
    await act(async () => { await Promise.resolve(); });
    const lastSuccess = result.current.snapshot.health.lastSuccess;
    delay = true;
    let pending!: Promise<void>;
    await act(async () => { pending = result.current.refresh(); await Promise.resolve(); });
    act(() => {
      online.mockReturnValue(false);
      window.dispatchEvent(new Event("offline"));
    });
    expect(signals[1]!.aborted).toBe(true);
    expect(result.current.snapshot.health).toMatchObject({ data: health, stale: true, lastSuccess });
    await act(async () => { finish({ ...health, paperSimulator: "DISABLED" }); await pending; });
    expect(result.current.snapshot.health.data).toBe(health);
    delay = false;
    await act(async () => {
      online.mockReturnValue(true);
      window.dispatchEvent(new Event("online"));
      window.dispatchEvent(new Event("online"));
      document.dispatchEvent(new Event("visibilitychange"));
      await result.current.refresh();
    });
    expect(api.health).toHaveBeenCalledTimes(3);
    expect(result.current.snapshot.health.stale).toBe(false);
  });

  it("survives StrictMode setup-cleanup-setup with a live controller and only one timer", async () => {
    const api = loaders();
    const signals: AbortSignal[] = [];
    api.health = vi.fn(async (signal) => { signals.push(signal!); return health; });
    const { result, unmount } = renderHook(() => useTradeOps({ loaders: api }), { wrapper: StrictMode });
    await act(async () => { await Promise.resolve(); });
    expect(result.current.snapshot.health.data).toBe(health);
    expect(signals.at(-1)?.aborted).toBe(false);
    expect(vi.getTimerCount()).toBe(1);
    const previous = vi.mocked(api.health).mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(api.health).toHaveBeenCalledTimes(previous + 1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("aborts and locks on true unmount, removes listeners, and rejects late updates", async () => {
    const create = vi.spyOn(sessionModule, "createTradeOpsSession");
    const api = loaders();
    const finish: Array<(value: ApiHealthSnapshot) => void> = [];
    api.health = vi.fn(() => new Promise<ApiHealthSnapshot>((resolve) => { finish.push(resolve); }));
    const { result, unmount } = renderHook(() => useTradeOps({ loaders: api }));
    const session = create.mock.results[0]!.value as sessionModule.TradeOpsSession;
    await act(async () => { await Promise.resolve(); });
    await act(async () => { result.current.unlock("unmount-secret"); await Promise.resolve(); });
    const signal = vi.mocked(api.health).mock.calls.at(-1)![0]!;
    const lastSnapshot = result.current.snapshot;
    unmount();
    expect(signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(session.getSnapshot().unlocked).toBe(false);
    for (const key of ["ledger", "simulation", "readiness", "decisions"] as const) {
      expect(session.getSnapshot()[key].data).toBeNull();
    }
    const locked = session.getSnapshot();
    const calls = vi.mocked(api.health).mock.calls.length;
    await act(async () => {
      finish.forEach((resolve) => resolve(health));
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("online"));
      await vi.advanceTimersByTimeAsync(90_000);
    });
    expect(api.health).toHaveBeenCalledTimes(calls);
    expect(result.current.snapshot).toBe(lastSnapshot);
    expect(session.getSnapshot()).toBe(locked);
    expect(JSON.stringify(lastSnapshot)).not.toContain("unmount-secret");
  });
});
