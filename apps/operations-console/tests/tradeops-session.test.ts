import { describe, expect, it, vi } from "vitest";
import { PaperAuthorizationError, type ApiHealthSnapshot, type ObservationReceiptsSnapshot, type PaperReadinessSnapshot } from "../src/lib/api";
import { createTradeOpsSession, type TradeOpsLoaders } from "../src/features/tradeops/session";

const health: ApiHealthSnapshot = { state: "ONLINE", paperSimulator: "ENABLED", execution: "DISABLED", message: "Online." };
const receipts: ObservationReceiptsSnapshot = { state: "EMPTY", ingressEnabled: true, count: 0, items: [], message: "No receipts." };
const readiness: PaperReadinessSnapshot = {
  state: "DEGRADED", evaluatedAt: "2026-09-02T00:00:00Z", execution: "DISABLED",
  thresholds: { receiptMaxAgeSeconds: 60, staleTradeSeconds: 900, maxDailyLossBps: 500, maxTotalDrawdownBps: 1_000, maxOpenRiskBps: 300, maxOpenPositions: 4 },
  killSwitch: { enabled: false, reason: null, changedAt: null }, latestReceipt: null,
  openHealth: { openIntents: 0, staleOpenIntents: 0, oldestOpenIntentAt: null }, accounts: [], reasons: [],
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function makeLoaders(): TradeOpsLoaders {
  return {
    health: vi.fn(async () => health), receipts: vi.fn(async () => receipts),
    ledger: vi.fn(async () => []), simulation: vi.fn(async () => ({ accounts: [], intents: [] })),
    readiness: vi.fn(async () => readiness),
    decisions: vi.fn(async () => ({ state: "EMPTY" as const, items: [], message: "No decisions." })),
  };
}

const protectedKeys = ["ledger", "simulation", "readiness", "decisions"] as const;

function apiResponse(body: unknown, status = 200): Response {
  return { status, text: async () => JSON.stringify(body) } as Response;
}

const strictReceiptReport = {
  mode: "OBSERVATION_ONLY",
  ingress_enabled: true,
  count: 0,
  items: [],
};

describe("TradeOps data session", () => {
  it("uses the strict receipt loader: first failure stays empty, recovery is fresh, later failure retains cache", async () => {
    let receiptStatus = 503;
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      if (input.endsWith("/health/live")) {
        return apiResponse({ status: "ALIVE", mode: "OBSERVATION_ONLY", paper_simulator: "ENABLED", execution: "DISABLED" });
      }
      return apiResponse(receiptStatus === 200 ? strictReceiptReport : { detail: "disabled" }, receiptStatus);
    }));
    const session = createTradeOpsSession({ now: () => 100 });

    await session.refresh();
    expect(session.getSnapshot().receipts).toEqual({ data: null, lastSuccess: null, loading: false, stale: true, error: "Observation receipts are unavailable." });

    receiptStatus = 200;
    await session.refresh();
    const recovered = session.getSnapshot().receipts;
    expect(recovered).toEqual({ data: expect.objectContaining({ state: "EMPTY", ingressEnabled: true }), lastSuccess: 100, loading: false, stale: false, error: null });

    receiptStatus = 503;
    await session.refresh();
    expect(session.getSnapshot().receipts).toEqual({ ...recovered, stale: true, error: "Observation receipts are unavailable." });
    vi.unstubAllGlobals();
  });

  it("starts locked and reads only the two public resources", async () => {
    const loaders = makeLoaders();
    const session = createTradeOpsSession({ loaders, now: () => 100 });
    const initial = session.getSnapshot();
    expect(session.getSnapshot()).toBe(initial);
    expect(initial.unlocked).toBe(false);
    for (const key of ["health", "receipts", ...protectedKeys] as const) {
      expect(initial[key]).toEqual({ data: null, lastSuccess: null, loading: false, stale: true, error: null });
    }
    await session.refresh();
    expect(session.getSnapshot().health).toEqual({ data: health, lastSuccess: 100, loading: false, stale: false, error: null });
    expect(session.getSnapshot().receipts.data).toBe(receipts);
    for (const key of protectedKeys) expect(loaders[key]).not.toHaveBeenCalled();
  });

  it("deduplicates refreshes into one six-resource cycle with one abort signal", async () => {
    const loaders = makeLoaders();
    const pending = deferred<ApiHealthSnapshot>();
    loaders.health = vi.fn(() => pending.promise);
    const session = createTradeOpsSession({ loaders });
    session.unlock("memory-only-secret");
    const first = session.refresh();
    expect(session.refresh()).toBe(first);
    await Promise.resolve();
    const signal = vi.mocked(loaders.health).mock.calls[0]![0];
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(loaders.receipts).toHaveBeenCalledExactlyOnceWith(signal);
    for (const key of protectedKeys) expect(loaders[key]).toHaveBeenCalledExactlyOnceWith("memory-only-secret", signal);
    expect(session.getSnapshot().health.loading).toBe(true);
    pending.resolve(health);
    await first;
    expect(session.getSnapshot().health.loading).toBe(false);
    expect(JSON.stringify(session.getSnapshot())).not.toContain("memory-only-secret");
    expect(Object.keys(session)).not.toContain("credential");
  });

  it("publishes partial successes and retains failed resource data and timestamp", async () => {
    let time = 100;
    let failed = false;
    const loaders = makeLoaders();
    loaders.simulation = async () => {
      if (failed) throw new Error("do-not-serialize-this server body");
      return { accounts: [], intents: [] };
    };
    const session = createTradeOpsSession({ loaders, now: () => time });
    session.unlock("do-not-serialize-this");
    await session.refresh();
    const lastGood = session.getSnapshot().simulation;
    failed = true;
    time = 200;
    await session.refresh();
    expect(session.getSnapshot().simulation).toEqual({ ...lastGood, stale: true, error: "Paper simulation is unavailable." });
    expect(session.getSnapshot().health.lastSuccess).toBe(200);
    expect(session.getSnapshot().readiness.lastSuccess).toBe(200);
    expect(lastGood.lastSuccess).toBe(100);
    expect(JSON.stringify(session.getSnapshot())).not.toContain("do-not-serialize-this");
    expect(JSON.stringify(session.getSnapshot())).not.toContain("server body");
  });

  it("publishes completed resources while another resource remains in flight", async () => {
    const pending = deferred<PaperReadinessSnapshot>();
    const session = createTradeOpsSession({ loaders: { ...makeLoaders(), readiness: () => pending.promise }, now: () => 100 });
    session.unlock("secret");
    const cycle = session.refresh();
    await Promise.resolve();
    await Promise.resolve();
    expect(session.getSnapshot().health).toMatchObject({ data: health, loading: false, lastSuccess: 100 });
    expect(session.getSnapshot().simulation).toMatchObject({ data: { accounts: [], intents: [] }, loading: false });
    expect(session.getSnapshot().readiness).toMatchObject({ data: null, loading: true, lastSuccess: null });
    pending.resolve(readiness);
    await cycle;
    expect(session.getSnapshot().readiness.loading).toBe(false);
  });

  it("treats public OFFLINE and ERROR fallback values as failures without fake freshness", async () => {
    let failed = false;
    let time = 100;
    const session = createTradeOpsSession({ loaders: {
      ...makeLoaders(),
      health: async () => failed ? { ...health, state: "OFFLINE", message: "unsafe upstream body" } : health,
      receipts: async () => failed ? { ...receipts, state: "ERROR", message: "unsafe upstream body" } : receipts,
    }, now: () => time });
    await session.refresh();
    failed = true;
    time = 200;
    await session.refresh();
    expect(session.getSnapshot().health).toEqual({ data: health, lastSuccess: 100, loading: false, stale: true, error: "API health is unavailable." });
    expect(session.getSnapshot().receipts).toEqual({ data: receipts, lastSuccess: 100, loading: false, stale: true, error: "Observation receipts are unavailable." });
    expect(JSON.stringify(session.getSnapshot())).not.toContain("unsafe upstream body");
    const firstFailure = createTradeOpsSession({ loaders: { health: async () => ({ ...health, state: "OFFLINE" }), receipts: async () => ({ ...receipts, state: "ERROR" }) } });
    await firstFailure.refresh();
    expect(firstFailure.getSnapshot().health.data).toBeNull();
    expect(firstFailure.getSnapshot().health.lastSuccess).toBeNull();
  });

  it.each(protectedKeys)("locks and clears every protected resource when %s rejects authorization", async (key) => {
    let unauthorized = false;
    const loaders = makeLoaders();
    const original = loaders[key];
    Object.assign(loaders, { [key]: async (credential: string, signal: AbortSignal) => {
      if (unauthorized) throw new PaperAuthorizationError();
      return original(credential, signal);
    } });
    const session = createTradeOpsSession({ loaders });
    session.unlock("secret");
    await session.refresh();
    unauthorized = true;
    await session.refresh();
    expect(session.getSnapshot().unlocked).toBe(false);
    expect(session.getSnapshot().lockReason).toBe("AUTH_REJECTED");
    for (const protectedKey of protectedKeys) {
      expect(session.getSnapshot()[protectedKey]).toMatchObject({ data: null, lastSuccess: null, loading: false });
    }
  });

  it("purges synchronously on lock and ignores a late response from an abort-ignoring loader", async () => {
    const pending = deferred<PaperReadinessSnapshot>();
    const loaders = makeLoaders();
    loaders.readiness = vi.fn(() => pending.promise);
    const session = createTradeOpsSession({ loaders });
    session.unlock("secret");
    const cycle = session.refresh();
    await Promise.resolve();
    const signal = vi.mocked(loaders.readiness).mock.calls[0]![1]!;
    session.lock();
    expect(signal.aborted).toBe(true);
    expect(session.getSnapshot().unlocked).toBe(false);
    for (const key of protectedKeys) expect(session.getSnapshot()[key].data).toBeNull();
    pending.resolve(readiness);
    await cycle;
    expect(session.getSnapshot().readiness.data).toBeNull();
  });

  it.each(["success", "unauthorized"] as const)("cannot repopulate or lock credential B from credential A's late %s", async (outcome) => {
    const pending = deferred<PaperReadinessSnapshot>();
    const loaders = makeLoaders();
    loaders.readiness = vi.fn((credential) => credential === "A" ? pending.promise : Promise.resolve({ ...readiness, evaluatedAt: "2026-09-02T01:00:00Z" }));
    const session = createTradeOpsSession({ loaders });
    session.unlock("A");
    const oldCycle = session.refresh();
    await Promise.resolve();
    session.unlock("B");
    for (const key of protectedKeys) expect(session.getSnapshot()[key].data).toBeNull();
    await session.refresh();
    const current = session.getSnapshot();
    if (outcome === "success") pending.resolve(readiness);
    else pending.reject(new PaperAuthorizationError());
    await oldCycle;
    expect(session.getSnapshot()).toBe(current);
    expect(current.unlocked).toBe(true);
    expect(current.readiness.data?.evaluatedAt).toBe("2026-09-02T01:00:00Z");
  });

  it("pauses by aborting and marking last-known values stale, then permits a fresh cycle", async () => {
    const pending = deferred<ApiHealthSnapshot>();
    let delayed = false;
    let signal: AbortSignal | undefined;
    const session = createTradeOpsSession({ loaders: { ...makeLoaders(), health: async (nextSignal) => {
      signal = nextSignal;
      return delayed ? pending.promise : health;
    } } });
    session.unlock("secret");
    await session.refresh();
    const previous = session.getSnapshot().health;
    delayed = true;
    const oldCycle = session.refresh();
    await Promise.resolve();
    session.pause();
    expect(signal?.aborted).toBe(true);
    expect(session.getSnapshot().health).toEqual({ ...previous, stale: true });
    expect(session.getSnapshot().paused).toBe(true);
    expect(session.getSnapshot().unlocked).toBe(true);
    pending.resolve({ ...health, paperSimulator: "DISABLED" });
    await oldCycle;
    expect(session.getSnapshot().health.data).toBe(health);
    delayed = false;
    await session.refresh();
    expect(session.getSnapshot().paused).toBe(false);
    expect(session.getSnapshot().health.stale).toBe(false);
  });

  it("preserves credential B's dedupe slot when credential A finishes first", async () => {
    const old = deferred<PaperReadinessSnapshot>();
    const next = deferred<PaperReadinessSnapshot>();
    const session = createTradeOpsSession({ loaders: {
      ...makeLoaders(), readiness: (value) => value === "A" ? old.promise : next.promise,
    } });
    session.unlock("A");
    const oldCycle = session.refresh();
    await Promise.resolve();
    session.unlock("B");
    const newCycle = session.refresh();
    old.resolve(readiness);
    await oldCycle;
    expect(session.refresh()).toBe(newCycle);
    expect(session.getSnapshot().readiness.loading).toBe(true);
    next.resolve(readiness);
    await newCycle;
  });

  it("validates credential length without trimming or exposing values", () => {
    const session = createTradeOpsSession({ loaders: makeLoaders() });
    expect(() => session.unlock("")).toThrow("Paper operator credential is invalid.");
    expect(() => session.unlock("x".repeat(1_025))).toThrow("Paper operator credential is invalid.");
    expect(session.getSnapshot().unlocked).toBe(false);
    session.unlock(" ");
    expect(session.getSnapshot().unlocked).toBe(true);
    session.unlock("x".repeat(1_024));
    expect(session.getSnapshot().unlocked).toBe(true);
  });

  it("unsubscribes, then disposes by clearing credentials and aborting pending work", async () => {
    const loaders = makeLoaders();
    const pending = deferred<ApiHealthSnapshot>();
    loaders.health = vi.fn(() => pending.promise);
    const session = createTradeOpsSession({ loaders });
    const listener = vi.fn();
    const unsubscribe = session.subscribe(listener);
    session.unlock("secret");
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    const cycle = session.refresh();
    await Promise.resolve();
    expect(listener).toHaveBeenCalledTimes(1);
    const disposedListener = vi.fn();
    session.subscribe(disposedListener);
    session.dispose();
    const count = disposedListener.mock.calls.length;
    expect(vi.mocked(loaders.health).mock.calls[0]![0]!.aborted).toBe(true);
    pending.resolve(health);
    await cycle;
    await session.refresh();
    session.unlock("new secret");
    expect(loaders.health).toHaveBeenCalledTimes(1);
    expect(session.getSnapshot().unlocked).toBe(false);
    expect(disposedListener).toHaveBeenCalledTimes(count);
  });
});
