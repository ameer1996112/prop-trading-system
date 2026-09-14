import { afterEach, describe, expect, it, vi } from "vitest";
import { parseMt5HealthSummary } from "../src/features/tradeops/mt5-health-contract.mjs";
import { loadMt5Health, Mt5AuthorizationError, mt5HeartbeatAge, mt5HeartbeatStatus } from "../src/features/tradeops/mt5-health";

export function healthFixture() {
  return { schema_version: "AgentHealthSummaryV1" as const, server_time_epoch: 1000, status: "ONLINE" as const,
    current: { last_accepted_epoch: 1000, request_sequence: 4, server_sequence: 4, terminal_build: 5200,
      source_symbol: "EURUSD", terminal_connection_state: "CONNECTED" as const,
      account_trade_permission: "ALLOWED" as const, terminal_trade_permission: "DENIED" as const, algo_trading_permission: "DENIED" as const },
    recent: [{ request_sequence: 5, result_code: "STALE_TIMESTAMP", server_sequence: null, received_at_epoch: 1000 }],
  };
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("strict MT5 health contract", () => {
  it("projects exactly the versioned health facts, without advancing heartbeat for rejected sync", () => {
    const wire = healthFixture();
    const result = parseMt5HealthSummary(wire);
    expect(result).toEqual(wire);
    expect(result).not.toBe(wire);
    expect(result.current?.request_sequence).toBe(4);
  });
  it("accepts no-data UNKNOWN without inventing finance or exposure", () => {
    expect(parseMt5HealthSummary({ schema_version: "AgentHealthSummaryV1", server_time_epoch: 1000, status: "UNKNOWN", current: null, recent: [] }).current).toBeNull();
  });
  it.each([
    { schema_version: "other" }, { balance: 100 }, { status: "READY" }, { server_time_epoch: NaN },
    { server_time_epoch: 999 }, { recent: Array.from({ length: 21 }, () => healthFixture().recent[0]) },
    { current: null }, { status: "STALE" },
  ])("rejects malformed or inconsistent envelope %j", (patch) => {
    expect(() => parseMt5HealthSummary({ ...healthFixture(), ...patch })).toThrow("Invalid MT5 health response");
  });
  it.each([{ positions: [] }, { terminal_connection_state: "UP" }, { account_trade_permission: "true" },
    { last_accepted_epoch: 1001 }, { terminal_build: -1 }, { request_sequence: Number.MAX_SAFE_INTEGER + 1 }, { source_symbol: "<script>" }])("rejects invalid current fields %j", (patch) => {
    const wire = healthFixture();
    expect(() => parseMt5HealthSummary({ ...wire, current: { ...wire.current, ...patch } })).toThrow();
  });
  it.each([{ result_code: "arbitrary private error" }, { received_at_epoch: 1001 }, { server_sequence: -1 }, { raw_payload: "private" }])("rejects untrusted audit fields %j", (patch) => {
    expect(() => parseMt5HealthSummary({ ...healthFixture(), recent: [{ ...healthFixture().recent[0], ...patch }] })).toThrow();
  });
  it("rejects out-of-order audit times", () => {
    const row = healthFixture().recent[0]!;
    expect(() => parseMt5HealthSummary({ ...healthFixture(), recent: [{ ...row, received_at_epoch: 900 }, row] })).toThrow();
  });
  it.each([[35, "ONLINE"], [36, "STALE"], [90, "STALE"], [91, "OFFLINE"]] as const)("validates %s-second boundary", (age, status) => {
    expect(parseMt5HealthSummary({ ...healthFixture(), server_time_epoch: 1000 + age, status }).status).toBe(status);
  });
  it("ages a cached heartbeat with elapsed time, independent of local clock offset", () => {
    const summary = parseMt5HealthSummary(healthFixture());
    expect(mt5HeartbeatAge(summary, 100, 36100)).toBe(36);
    expect(mt5HeartbeatStatus(summary, 100, 36100)).toBe("STALE");
    expect(mt5HeartbeatStatus(summary, 100, 91100)).toBe("OFFLINE");
    expect(mt5HeartbeatStatus(summary, 100, 99)).toBe("UNKNOWN");
    expect(mt5HeartbeatStatus(summary, null, 100)).toBe("UNKNOWN");
  });
});

describe("MT5 health read", () => {
  it("makes one same-origin GET without credentials and validates JSON", async () => {
    const request = vi.fn(async () => new Response(JSON.stringify(healthFixture()), { headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", request);
    expect(await loadMt5Health(new AbortController().signal)).toEqual(healthFixture());
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith("/api/v1/mt5-health-summary", expect.objectContaining({ method: "GET", credentials: "omit", redirect: "error", cache: "no-store" }));
    expect(request.mock.calls[0]).not.toContain("Authorization");
  });
  it.each([401, 403])("distinguishes HTTP %s without returning private error body", async (status) => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("private token", { status })));
    await expect(loadMt5Health(new AbortController().signal)).rejects.toBeInstanceOf(Mt5AuthorizationError);
  });
  it.each(["html", "oversize", "bad-schema", "http-error"])("rejects %s safely", async (kind) => {
    const body = kind === "oversize" ? " ".repeat(128 * 1024 + 1) : kind === "bad-schema" ? '{}' : "private upstream content";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status: kind === "http-error" ? 500 : 200, headers: { "Content-Type": kind === "html" ? "text/html" : "application/json" } })));
    await expect(loadMt5Health(new AbortController().signal)).rejects.toThrow("MT5 health is unavailable");
  });
  it("bounds a fetch ignoring abort without retrying", async () => {
    vi.useFakeTimers(); const request = vi.fn(() => new Promise<Response>(() => {})); vi.stubGlobal("fetch", request);
    const pending = loadMt5Health(new AbortController().signal);
    const assertion = expect(pending).rejects.toThrow("MT5 health is unavailable");
    await vi.advanceTimersByTimeAsync(6000); await assertion;
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("does not start an already cancelled request", async () => {
    const request = vi.fn(); vi.stubGlobal("fetch", request); const controller = new AbortController(); controller.abort();
    await expect(loadMt5Health(controller.signal)).rejects.toThrow(); expect(request).not.toHaveBeenCalled();
  });
});
