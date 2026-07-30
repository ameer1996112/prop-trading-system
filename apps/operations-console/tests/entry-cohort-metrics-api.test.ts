import { afterEach, describe, expect, it, vi } from "vitest";

import { loadEntryCohortMetrics } from "../src/lib/entry-cohort-metrics";

const validPayload = {
  schema_version: "rd-entry-cohort-metrics/v1",
  mode: "PAPER_SIMULATION_ONLY",
  items: [
    {
      liquidity_cohort: "ONE_CANDLE",
      one_candle_enabled: true,
      entry_model: "BOC",
      symbol: "XPTUSD",
      feed: "OANDA",
      trades: 5,
      wins: 2,
      losses: 1,
      resolved: 3,
      win_rate_bps: 6667,
      ambiguous: 1,
      open: 1,
    },
    {
      liquidity_cohort: "TWO_PLUS_CANDLES",
      one_candle_enabled: false,
      entry_model: "HTF_FLIP",
      symbol: "NAS100",
      feed: "CAPITALCOM",
      trades: 1,
      wins: 0,
      losses: 0,
      resolved: 0,
      win_rate_bps: null,
      ambiguous: 0,
      open: 1,
    },
  ],
};

function response(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("loadEntryCohortMetrics", () => {
  it("requests the protected cohort endpoint and maps both cohorts", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(validPayload));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    const snapshot = await loadEntryCohortMetrics(
      "operator-secret",
      controller.signal,
    );

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/rd-entry-cohort-metrics"),
      expect.objectContaining({
        cache: "no-store",
        headers: expect.objectContaining({
          Authorization: "Bearer operator-secret",
        }),
        signal: expect.any(AbortSignal),
      }),
    );
    expect(snapshot).toEqual({
      state: "READY",
      message: "2 liquidity cohort rows.",
      items: [
        {
          liquidityCohort: "ONE_CANDLE",
          oneCandleEnabled: true,
          entryModel: "BOC",
          symbol: "XPTUSD",
          feed: "OANDA",
          trades: 5,
          wins: 2,
          losses: 1,
          resolved: 3,
          winRateBps: 6667,
          ambiguous: 1,
          open: 1,
        },
        {
          liquidityCohort: "TWO_PLUS_CANDLES",
          oneCandleEnabled: false,
          entryModel: "HTF_FLIP",
          symbol: "NAS100",
          feed: "CAPITALCOM",
          trades: 1,
          wins: 0,
          losses: 0,
          resolved: 0,
          winRateBps: null,
          ambiguous: 0,
          open: 1,
        },
      ],
    });
  });

  it.each([
    ["resolved does not equal wins plus losses", { resolved: 3, wins: 2, losses: 0 }],
    ["zero resolved has a win rate", { resolved: 0, win_rate_bps: 5000 }],
    ["the cohort is unknown", { liquidity_cohort: "UNKNOWN" }],
    [
      "one-candle liquidity is disabled",
      { liquidity_cohort: "ONE_CANDLE", one_candle_enabled: false },
    ],
    ["trades do not equal all outcomes", { trades: 4 }],
    ["the rounded win rate is inconsistent", { win_rate_bps: 6666 }],
  ])("rejects a row when %s", async (_label, change) => {
    const invalid = structuredClone(validPayload);
    Object.assign(invalid.items[0]!, change);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(invalid)));

    await expect(loadEntryCohortMetrics("operator-secret")).rejects.toThrow(
      "Liquidity cohort metrics are malformed.",
    );
  });

  it("returns a usable empty state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        response({
          schema_version: "rd-entry-cohort-metrics/v1",
          mode: "PAPER_SIMULATION_ONLY",
          items: [],
        }),
      ),
    );

    await expect(loadEntryCohortMetrics("operator-secret")).resolves.toEqual({
      state: "EMPTY",
      items: [],
      message: "No liquidity cohort trades have been recorded.",
    });
  });
});
