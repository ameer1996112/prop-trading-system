import { describe, expect, it } from "vitest";

import { validateCohortMetricRow } from "../src/rd-entry-cohort-metrics";

const validRow = {
  liquidity_cohort: "ONE_CANDLE",
  one_candle_enabled: true,
  entry_model: "DIR_CLOSE",
  symbol: "XPTUSD",
  feed: "OANDA",
  trades: 5,
  wins: 2,
  losses: 1,
  resolved: 3,
  win_rate_bps: 6667,
  ambiguous: 1,
  open: 1,
} as const;

describe("liquidity cohort metric rows", () => {
  it("accepts a consistent resolved cohort aggregate", () => {
    expect(validateCohortMetricRow(validRow)).toEqual(validRow);
  });

  it.each([
    {
      name: "trade total",
      row: { ...validRow, trades: 6 },
    },
    {
      name: "resolved total",
      row: { ...validRow, resolved: 4 },
    },
    {
      name: "resolved win rate",
      row: { ...validRow, win_rate_bps: 6666 },
    },
    {
      name: "negative count",
      row: { ...validRow, open: -1, trades: 3 },
    },
  ])("rejects an inconsistent $name", ({ row }) => {
    expect(() => validateCohortMetricRow(row)).toThrow(TypeError);
  });

  it("accepts a zero-resolved aggregate only with a null win rate", () => {
    const row = {
      ...validRow,
      trades: 2,
      wins: 0,
      losses: 0,
      resolved: 0,
      win_rate_bps: null,
      ambiguous: 1,
      open: 1,
    };

    expect(validateCohortMetricRow(row)).toEqual(row);
    expect(() =>
      validateCohortMetricRow({ ...row, win_rate_bps: 0 }),
    ).toThrow(TypeError);
  });

  it.each([
    { ...validRow, liquidity_cohort: "UNKNOWN" },
    { ...validRow, entry_model: "UNKNOWN" },
    {
      ...validRow,
      liquidity_cohort: "ONE_CANDLE",
      one_candle_enabled: false,
    },
  ])("rejects an unsafe cohort identity", (row) => {
    expect(() => validateCohortMetricRow(row)).toThrow(TypeError);
  });
});
