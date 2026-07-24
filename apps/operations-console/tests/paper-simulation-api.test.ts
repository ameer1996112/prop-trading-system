import { afterEach, describe, expect, it, vi } from "vitest";

import {
  loadPaperReadiness,
  loadPaperSimulationSummary,
  setPaperReadinessKillSwitch,
} from "../src/lib/api";

function response(body: unknown, status = 200): Response {
  return {
    status,
    text: async () => JSON.stringify(body),
  } as Response;
}

function summary(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: "1.0",
    mode: "PAPER_SIMULATION_ONLY",
    account_count: 1,
    intent_count: 1,
    accounts: [
      {
        account_id: "paper-a",
        label: "Paper A",
        currency_code: "USD",
        currency_scale: 2,
        balance_minor: 10_075_000,
        realized_pnl_minor: 75_000,
        open_risk_minor: 0,
        open_positions: 0,
        settled_trades: 1,
        winning_trades: 1,
        losing_trades: 0,
        max_drawdown_minor: 0,
      },
    ],
    intents: [
      {
        intent_id: "intent-a",
        symbol: "EURUSD",
        side: "BUY",
        entry_price: "1.17",
        stop_loss: "1.16",
        take_profit: "1.19",
        risk_bps: 50,
        source: "TRADINGVIEW",
        source_receipt_id: "receipt-a",
        state: "SETTLED",
        created_at: "2026-07-23T10:00:00Z",
        settlement: {
          outcome_r_millis: 1500,
          exit_reason: "TARGET",
          settled_at: "2026-07-23T10:05:00Z",
        },
        allocations: [
          {
            account_id: "paper-a",
            risk_amount_minor: 50_000,
            balance_before_minor: 10_000_000,
            pnl_minor: 75_000,
          },
        ],
      },
    ],
    ...overrides,
  };
}

function readiness(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: "1.0",
    mode: "PAPER_ONLY",
    state: "DEGRADED",
    evaluated_at: "2026-07-23T10:06:00Z",
    thresholds: {
      receipt_max_age_seconds: 60,
      stale_trade_seconds: 900,
      max_daily_loss_bps: 500,
      max_total_drawdown_bps: 1_000,
      max_open_risk_bps: 300,
      max_open_positions: 4,
    },
    kill_switch: {
      enabled: false,
      reason: "Paper monitor enabled",
      changed_at: "2026-07-23T09:00:00Z",
    },
    latest_receipt: {
      receipt_id: "receipt-a",
      received_at: "2026-07-23T10:04:29Z",
      producer_instance_id: "tradingview-paper-eurusd:monitor",
      sequence: 17,
      symbol: "EURUSD",
      age_seconds: 91,
    },
    open_health: {
      open_intents: 1,
      stale_open_intents: 0,
      oldest_open_intent_at: "2026-07-23T10:02:00Z",
    },
    accounts: [
      {
        account_id: "paper-a",
        label: "Paper A",
        state: "READY",
        daily_pnl_minor: 75_000,
        daily_loss_bps: 0,
        total_drawdown_bps: 0,
        open_risk_bps: 50,
        open_positions: 1,
        reasons: [],
      },
    ],
    reasons: [
      {
        code: "RECEIPT_STALE",
        account_id: null,
        message: "Latest automation receipt is stale",
      },
    ],
    execution: "DISABLED",
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("loadPaperSimulationSummary", () => {
  it("loads protected account and intent projections without retaining auth in data", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(summary())));

    const result = await loadPaperSimulationSummary("operator-secret");

    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/paper-simulations/summary?limit=50",
      expect.objectContaining({
        cache: "no-store",
        headers: {
          Accept: "application/json",
          Authorization: "Bearer operator-secret",
        },
      }),
    );
    expect(result).toMatchObject({
      accounts: [
        {
          accountId: "paper-a",
          balanceMinor: 10_075_000,
          realizedPnlMinor: 75_000,
        },
      ],
      intents: [
        {
          intentId: "intent-a",
          state: "SETTLED",
          source: "TRADINGVIEW",
          sourceReceiptId: "receipt-a",
          outcomeRMillis: 1500,
          allocations: [{ pnlMinor: 75_000 }],
        },
      ],
    });
    expect(result).not.toHaveProperty("credential");
  });

  it("reports rejected credentials and malformed summaries", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({}, 401)));
    await expect(loadPaperSimulationSummary("wrong")).rejects.toThrow(
      "credential was rejected",
    );

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(response(summary({ account_count: 2 }))),
    );
    await expect(loadPaperSimulationSummary("operator-secret")).rejects.toThrow(
      "counts do not match",
    );
  });
});

describe("paper readiness API", () => {
  it("strictly parses protected readiness evidence without retaining auth", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(readiness())));

    const result = await loadPaperReadiness("operator-secret");

    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/paper-readiness",
      expect.objectContaining({
        cache: "no-store",
        headers: {
          Accept: "application/json",
          Authorization: "Bearer operator-secret",
        },
      }),
    );
    expect(result).toMatchObject({
      state: "DEGRADED",
      execution: "DISABLED",
      latestReceipt: {
        receiptId: "receipt-a",
        ageSeconds: 91,
      },
      openHealth: {
        openIntents: 1,
        staleOpenIntents: 0,
      },
      accounts: [
        {
          accountId: "paper-a",
          openRiskBps: 50,
          state: "READY",
        },
      ],
      reasons: [{ code: "RECEIPT_STALE", accountId: null }],
    });
    expect(result).not.toHaveProperty("credential");
  });

  it("rejects unsafe readiness states and inconsistent open-health evidence", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(response(readiness({ execution: "ENABLED" }))),
    );
    await expect(loadPaperReadiness("operator-secret")).rejects.toThrow(
      "report is malformed",
    );

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        response(
          readiness({
            open_health: {
              open_intents: 0,
              stale_open_intents: 1,
              oldest_open_intent_at: null,
            },
          }),
        ),
      ),
    );
    await expect(loadPaperReadiness("operator-secret")).rejects.toThrow(
      "open health is malformed",
    );
  });

  it("posts audited kill-switch controls with a unique idempotency key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      response(
        {
          schema_version: "1.0",
          status: "APPLIED",
          kill_switch: {
            enabled: true,
            reason: "Readiness drill",
            changed_at: "2026-07-23T10:07:00Z",
          },
        },
        201,
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const first = await setPaperReadinessKillSwitch(
      "operator-secret",
      true,
      "  Readiness drill  ",
    );
    await setPaperReadinessKillSwitch("operator-secret", true, "Readiness drill");

    expect(first).toEqual({
      status: "APPLIED",
      killSwitch: {
        enabled: true,
        reason: "Readiness drill",
        changedAt: "2026-07-23T10:07:00Z",
      },
    });
    const calls = fetchMock.mock.calls as [string, RequestInit][];
    expect(calls[0]?.[0]).toBe("/api/v1/paper-readiness/kill-switch");
    expect(calls[0]?.[1]).toEqual(
      expect.objectContaining({
        body: JSON.stringify({
          schema_version: "1.0",
          enabled: true,
          reason: "Readiness drill",
        }),
        cache: "no-store",
        method: "POST",
      }),
    );
    const firstHeaders = calls[0]?.[1].headers as Record<string, string>;
    const secondHeaders = calls[1]?.[1].headers as Record<string, string>;
    expect(firstHeaders).toMatchObject({
      Accept: "application/json",
      Authorization: "Bearer operator-secret",
      "Content-Type": "application/json",
    });
    expect(firstHeaders["Idempotency-Key"]).toMatch(/^paper-readiness:/u);
    expect(secondHeaders["Idempotency-Key"]).not.toBe(
      firstHeaders["Idempotency-Key"],
    );
  });
});
