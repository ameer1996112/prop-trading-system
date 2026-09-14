import { afterEach, describe, expect, it, vi } from "vitest";

import { PaperAuthorizationError } from "../src/lib/api";
import { loadPaperLedgerAccounts } from "../src/features/tradeops/ledger-api";

// Mirrors listPaperAccounts in observation-edge/src/index.ts.
function account(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: "1.0",
    account_id: "paper-a",
    mode: "PAPER_ONLY",
    label: "Paper A",
    currency_code: "USD",
    currency_scale: 2,
    opening_balance_minor: 1_000_000,
    ledger_delta_minor: 0,
    balance_minor: 1_000_000,
    last_sequence: 0,
    created_at: "2026-09-02T09:00:00Z",
    ...overrides,
  };
}

function report(items: unknown[] = [account()], overrides: Record<string, unknown> = {}) {
  return { mode: "PAPER_ONLY", count: items.length, items, ...overrides };
}

function serve(value: unknown, status = 200) {
  const fetchMock = vi.fn<typeof fetch>(async () =>
    new Response(JSON.stringify(value), { status }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("loadPaperLedgerAccounts", () => {
  it("projects the actual ledger wire contract without inventing P&L", async () => {
    const fetchMock = serve(report());
    const result = await loadPaperLedgerAccounts("operator-secret");
    expect(result).toEqual([{
      accountId: "paper-a",
      label: "Paper A",
      currencyCode: "USD",
      currencyScale: 2,
      openingBalanceMinor: 1_000_000,
      ledgerDeltaMinor: 0,
      balanceMinor: 1_000_000,
      lastSequence: 0,
      createdAt: "2026-09-02T09:00:00Z",
    }]);
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      "/api/v1/paper-accounts?limit=200",
      expect.objectContaining({
        cache: "no-store",
        headers: { Accept: "application/json", Authorization: "Bearer operator-secret" },
        signal: expect.any(AbortSignal),
      }),
    );
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(request.method ?? "GET").toBe("GET");
    expect(request.body).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain("operator-secret");
  });

  it("accepts an empty report and the 200-account boundary", async () => {
    serve(report([]));
    await expect(loadPaperLedgerAccounts("x")).resolves.toEqual([]);
    serve(report(Array.from({ length: 200 }, (_, i) => account({ account_id: `paper-${i}` }))));
    await expect(loadPaperLedgerAccounts("x")).resolves.toHaveLength(200);
  });

  it.each([0, -100, Number.MIN_SAFE_INTEGER])("preserves a valid balance of %s", async (balance) => {
    serve(report([account({
      opening_balance_minor: 0,
      ledger_delta_minor: balance,
      balance_minor: balance,
    })]));
    await expect(loadPaperLedgerAccounts("x")).resolves.toMatchObject([{ balanceMinor: balance }]);
  });

  it("accepts maximum safe values and contract text boundaries", async () => {
    serve(report([account({
      account_id: "a_.:-".repeat(25) + "abc",
      label: "A".repeat(80),
      currency_scale: 8,
      opening_balance_minor: Number.MAX_SAFE_INTEGER,
      ledger_delta_minor: -Number.MAX_SAFE_INTEGER,
      balance_minor: 0,
      last_sequence: Number.MAX_SAFE_INTEGER,
      created_at: "2024-02-29T23:59:59.123456789Z",
    })]));
    await expect(loadPaperLedgerAccounts("x".repeat(1_024))).resolves.toHaveLength(1);
  });

  const malformedAccounts: Array<[string, Record<string, unknown>]> = [
    ["schema", { schema_version: "2.0" }],
    ["mode", { mode: "LIVE" }],
    ...["", ".", "..", "a/b", " a", "a b", "a".repeat(129)].map((value): [string, Record<string, unknown>] => ["account id " + value, { account_id: value }]),
    ...["", " A", "A ", "A\\B", "A\nB", "A\tB", "é", "A".repeat(81)].map((value): [string, Record<string, unknown>] => ["label " + value, { label: value }]),
    ...["usd", "US", "USDD", "U1D", 123].map((value): [string, Record<string, unknown>] => ["currency " + value, { currency_code: value }]),
    ...[-1, 9, 1.5, "2"].map((value): [string, Record<string, unknown>] => ["scale " + value, { currency_scale: value }]),
    ["negative opening balance", { opening_balance_minor: -1, balance_minor: -1 }],
    ["fractional opening balance", { opening_balance_minor: 1.5 }],
    ["unsafe opening balance", { opening_balance_minor: Number.MAX_SAFE_INTEGER + 1 }],
    ["unsafe delta", { ledger_delta_minor: Number.MIN_SAFE_INTEGER - 1 }],
    ["unsafe balance", { balance_minor: Number.MAX_SAFE_INTEGER + 1 }],
    ["fractional delta", { ledger_delta_minor: 0.1 }],
    ["fractional balance", { balance_minor: 1.1 }],
    ["string balance", { balance_minor: "1000000" }],
    ["negative sequence", { last_sequence: -1 }],
    ["fractional sequence", { last_sequence: 0.5 }],
    ["unsafe sequence", { last_sequence: Number.MAX_SAFE_INTEGER + 1 }],
    ["inconsistent balance", { ledger_delta_minor: 1 }],
    ["overflowing sum", { opening_balance_minor: Number.MAX_SAFE_INTEGER, ledger_delta_minor: 2, balance_minor: Number.MAX_SAFE_INTEGER }],
    ...["", "not-a-date", "2026-02-29T09:00:00Z", "2026-04-31T09:00:00Z", "2026-09-02T24:00:00Z", "2026-09-02T09:60:00Z", "2026-09-02T09:00:60Z", "2026-09-02", "2026-09-02T09:00:00+00:00"].map((value): [string, Record<string, unknown>] => ["timestamp " + value, { created_at: value }]),
    ["unknown field", { realized_pnl_minor: 20 }],
    ["missing field", { label: undefined }],
  ];

  it.each(malformedAccounts)("rejects malformed account: %s", async (_name, overrides) => {
    serve(report([account(overrides)]));
    await expect(loadPaperLedgerAccounts("x")).rejects.toThrow();
  });

  it.each([
    ["wrong mode", report([], { mode: "PAPER_SIMULATION_ONLY" })],
    ["wrong count", report([], { count: 1 })],
    ["fractional count", report([], { count: 0.5 })],
    ["string count", report([], { count: "0" })],
    ["negative count", report([], { count: -1 })],
    ["unsafe count", report([], { count: Number.MAX_SAFE_INTEGER + 1 })],
    ["duplicate IDs", report([account(), account()])],
    ["too many items", report(Array.from({ length: 201 }, (_, i) => account({ account_id: `a-${i}` })))],
    ["unknown envelope field", report([], { schema_version: "1.0" })],
    ["non-array items", report([], { items: {} })],
    ["non-object item", report([null])],
    ["non-object envelope", null],
  ])("rejects malformed report: %s", async (_name, value) => {
    serve(value);
    await expect(loadPaperLedgerAccounts("x")).rejects.toThrow();
  });

  it("rejects non-strict JSON including duplicate keys", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"mode":"LIVE","mode":"PAPER_ONLY","count":0,"items":[]}')));
    await expect(loadPaperLedgerAccounts("x")).rejects.toThrow("strict canonical-profile JSON");
  });

  it.each(["", "x".repeat(1_025)])("validates credential length before fetching", async (credential) => {
    const fetchMock = serve(report());
    await expect(loadPaperLedgerAccounts(credential)).rejects.toThrow("Paper operator credential is invalid.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws a safe typed error for 401 without replaying the request", async () => {
    const fetchMock = serve({ error: "operator-secret" }, 401);
    await expect(loadPaperLedgerAccounts("operator-secret")).rejects.toBeInstanceOf(PaperAuthorizationError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([403, 404, 429, 500, 503])("fails safely on HTTP %s without parsing or adding retries", async (status) => {
    const fetchMock = serve({ error: "operator-secret" }, status);
    await expect(loadPaperLedgerAccounts("operator-secret")).rejects.toThrow("Paper ledger accounts are unavailable.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("propagates a pre-aborted caller without making a request", async () => {
    const fetchMock = serve(report());
    const controller = new AbortController();
    const reason = new DOMException("Aborted", "AbortError");
    controller.abort(reason);
    await expect(loadPaperLedgerAccounts("x", controller.signal)).rejects.toBe(reason);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps caller cancellation connected while consuming the response body", async () => {
    const controller = new AbortController();
    let markBodyStarted!: () => void;
    const bodyStarted = new Promise<void>((resolve) => { markBodyStarted = resolve; });
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => new Response(new ReadableStream({
      start(stream) {
        init?.signal?.addEventListener("abort", () => stream.error(init.signal?.reason), { once: true });
        markBodyStarted();
      },
    })));
    vi.stubGlobal("fetch", fetchMock);
    const pending = loadPaperLedgerAccounts("x", controller.signal);
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await bodyStarted;
    controller.abort();
    await rejected;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("uses only the existing two bounded read attempts when response bodies stall", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => new Response(new ReadableStream({
      start(stream) {
        init?.signal?.addEventListener("abort", () => stream.error(init.signal?.reason), { once: true });
      },
    })));
    vi.stubGlobal("fetch", fetchMock);
    const rejected = expect(loadPaperLedgerAccounts("x")).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(12_001);
    await rejected;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });
});
