import { afterEach, describe, expect, it, vi } from "vitest";

import { loadApiHealth, loadObservationReceipts } from "../src/lib/api";

const digest = "a".repeat(64);

function receipt(overrides: Record<string, unknown> = {}) {
  return {
    receipt_id: "0198fc4a-4863-7000-8000-000000000001",
    idempotency_key: "lab-alert-42",
    producer_instance_id: "tv-lab-primary",
    symbol: "EURUSD",
    feed: "OANDA",
    kind: "ALERT_OBSERVATION",
    sequence: 42,
    status: "RECEIVED",
    payload_sha256: digest,
    received_at: "2026-07-23T10:00:00Z",
    ...overrides,
  };
}

function report(items: unknown[] = [receipt()], overrides: Record<string, unknown> = {}) {
  return {
    mode: "OBSERVATION_ONLY",
    ingress_enabled: true,
    count: items.length,
    items,
    ...overrides,
  };
}

function response(body: unknown, status = 200): Response {
  return {
    status,
    text: async () => JSON.stringify(body),
  } as Response;
}

function mockReceiptApi(body: unknown, status = 200) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(body, status)));
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("loadApiHealth", () => {
  it("accepts the live observation mode and exposes simulator/execution state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        response({
          status: "ALIVE",
          mode: "OBSERVATION_ONLY",
          paper_simulator: "ENABLED",
          execution: "DISABLED",
        }),
      ),
    );

    await expect(loadApiHealth()).resolves.toEqual({
      state: "ONLINE",
      paperSimulator: "ENABLED",
      execution: "DISABLED",
      message:
        "Observation API is online. Protected paper simulation is enabled; broker execution is disabled.",
    });
  });

  it("fails closed on obsolete or executable health documents", async () => {
    for (const body of [
      {
        status: "ALIVE",
        mode: "FOUNDATION_OBSERVATION_ONLY",
        paper_simulator: "ENABLED",
        execution: "DISABLED",
      },
      {
        status: "ALIVE",
        mode: "OBSERVATION_ONLY",
        paper_simulator: "ENABLED",
        execution: "ENABLED",
      },
    ]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(body)));
      await expect(loadApiHealth()).resolves.toMatchObject({
        state: "OFFLINE",
        paperSimulator: "UNKNOWN",
        execution: "UNKNOWN",
      });
    }
  });
});

describe("loadObservationReceipts", () => {
  it("loads same-origin metadata and discards identifiers and fingerprints", async () => {
    mockReceiptApi(report());

    const snapshot = await loadObservationReceipts();

    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/observation-receipts?limit=50",
      expect.objectContaining({
        cache: "no-store",
        headers: { Accept: "application/json" },
        signal: expect.any(AbortSignal),
      }),
    );
    expect(snapshot).toMatchObject({
      state: "RECEIVED",
      ingressEnabled: true,
      items: [
        {
          source: "OTHER",
          symbol: "EURUSD",
          feed: "OANDA",
          kind: "ALERT_OBSERVATION",
          sequence: 42,
          status: "RECEIVED",
          receivedAt: "2026-07-23T10:00:00Z",
        },
      ],
    });
    expect(snapshot.items[0]).not.toHaveProperty("idempotencyKey");
    expect(snapshot.items[0]).not.toHaveProperty("payloadSha256");
    expect(snapshot.items[0]).not.toHaveProperty("receiptId");
  });

  it("classifies TradingView and smoke-test receipts without exposing producer identifiers", async () => {
    mockReceiptApi(
      report([
        receipt({ producer_instance_id: "tradingview-v3-gbpjpy", symbol: "GBPJPY" }),
        receipt({
          producer_instance_id: "shadow-smoke-gbpusd",
          symbol: "GBPUSD",
          sequence: 43,
        }),
      ]),
    );

    const snapshot = await loadObservationReceipts();

    expect(snapshot.items).toEqual([
      expect.objectContaining({ source: "TRADINGVIEW", symbol: "GBPJPY" }),
      expect.objectContaining({ source: "TEST", symbol: "GBPUSD" }),
    ]);
    expect(snapshot.items[0]).not.toHaveProperty("producerInstanceId");
    expect(snapshot.items[1]).not.toHaveProperty("producerInstanceId");
  });

  it("retries one transient read failure before returning receipt state", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("network interrupted"))
      .mockResolvedValueOnce(response(report()));
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadObservationReceipts()).resolves.toMatchObject({
      state: "RECEIVED",
      count: 1,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("distinguishes enabled empty state from blocked ingress", async () => {
    mockReceiptApi(report([]));
    await expect(loadObservationReceipts()).resolves.toMatchObject({
      state: "EMPTY",
      ingressEnabled: true,
      items: [],
    });

    mockReceiptApi(report([receipt()], { ingress_enabled: false }));
    await expect(loadObservationReceipts()).resolves.toMatchObject({
      state: "BLOCKED",
      ingressEnabled: false,
      count: 1,
    });
  });

  it("treats 503 as blocked, never empty-success", async () => {
    mockReceiptApi({ detail: "disabled" }, 503);
    await expect(loadObservationReceipts()).resolves.toMatchObject({
      state: "BLOCKED",
      ingressEnabled: false,
      items: [],
    });
  });

  it.each([
    report([], { mode: "EXECUTION" }),
    report([], { count: 1 }),
    report([receipt({ status: "BLOCKED" })]),
    report([receipt({ payload_sha256: "A".repeat(64) })]),
    report([receipt({ received_at: "2026-02-30T00:00:00Z" })]),
  ])("fails closed on malformed receipt reports", async (body) => {
    mockReceiptApi(body);
    await expect(loadObservationReceipts()).resolves.toMatchObject({
      state: "ERROR",
      ingressEnabled: null,
      items: [],
    });
  });

  it("maps unexpected statuses and network failures to error", async () => {
    mockReceiptApi({}, 500);
    await expect(loadObservationReceipts()).resolves.toMatchObject({ state: "ERROR" });

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await expect(loadObservationReceipts()).resolves.toMatchObject({ state: "ERROR" });
  });
});
