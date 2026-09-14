export interface LiquidityCohortMetricRow {
  readonly liquidity_cohort: "ONE_CANDLE" | "TWO_PLUS_CANDLES";
  readonly one_candle_enabled: boolean;
  readonly entry_model: "BOC" | "DIR_CLOSE" | "HTF_FLIP";
  readonly symbol: string;
  readonly feed: string;
  readonly trades: number;
  readonly wins: number;
  readonly losses: number;
  readonly resolved: number;
  readonly win_rate_bps: number | null;
  readonly ambiguous: number;
  readonly open: number;
}

const STORED_IDENTIFIER = /^[\x21-\x5b\x5d-\x7e]+$/u;

function isCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isStoredIdentity(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 256 &&
    STORED_IDENTIFIER.test(value)
  );
}

export function validateCohortMetricRow(
  value: unknown,
): LiquidityCohortMetricRow {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("invalid liquidity cohort metric row");
  }
  const row = value as Record<string, unknown>;
  const liquidityCohort = row.liquidity_cohort;
  const oneCandleEnabled = row.one_candle_enabled;
  const entryModel = row.entry_model;
  const trades = row.trades;
  const wins = row.wins;
  const losses = row.losses;
  const resolved = row.resolved;
  const ambiguous = row.ambiguous;
  const open = row.open;
  const winRateBps = row.win_rate_bps;
  const countsAreSafe =
    isCount(trades) &&
    isCount(wins) &&
    isCount(losses) &&
    isCount(resolved) &&
    isCount(ambiguous) &&
    isCount(open);
  const totalsAreConsistent =
    countsAreSafe &&
    BigInt(resolved) === BigInt(wins) + BigInt(losses) &&
    BigInt(trades) ===
      BigInt(resolved) + BigInt(ambiguous) + BigInt(open);
  const expectedWinRateBps =
    countsAreSafe && resolved > 0
      ? Number(
          (10_000n * BigInt(wins) + BigInt(resolved) / 2n) /
            BigInt(resolved),
        )
      : null;

  if (
    (liquidityCohort !== "ONE_CANDLE" &&
      liquidityCohort !== "TWO_PLUS_CANDLES") ||
    typeof oneCandleEnabled !== "boolean" ||
    (liquidityCohort === "ONE_CANDLE" && !oneCandleEnabled) ||
    (entryModel !== "BOC" &&
      entryModel !== "DIR_CLOSE" &&
      entryModel !== "HTF_FLIP") ||
    !isStoredIdentity(row.symbol) ||
    !isStoredIdentity(row.feed) ||
    !totalsAreConsistent ||
    (resolved === 0
      ? winRateBps !== null
      : !Number.isSafeInteger(winRateBps) ||
        winRateBps !== expectedWinRateBps)
  ) {
    throw new TypeError("invalid liquidity cohort metric row");
  }

  return value as LiquidityCohortMetricRow;
}
