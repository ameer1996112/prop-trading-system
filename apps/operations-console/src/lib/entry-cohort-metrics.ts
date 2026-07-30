import { fetchBounded, parseStrictResponse } from "./api";

export type LiquidityCohortMetric = {
  liquidityCohort: "ONE_CANDLE" | "TWO_PLUS_CANDLES";
  oneCandleEnabled: boolean;
  entryModel: "BOC" | "DIR_CLOSE" | "HTF_FLIP";
  symbol: string;
  feed: string;
  trades: number;
  wins: number;
  losses: number;
  resolved: number;
  winRateBps: number | null;
  ambiguous: number;
  open: number;
};

export type EntryCohortMetricsSnapshot = {
  state: "READY" | "EMPTY" | "ERROR";
  items: LiquidityCohortMetric[];
  message: string;
};

const cohortNames = new Set(["ONE_CANDLE", "TWO_PLUS_CANDLES"] as const);
const entryModels = new Set(["BOC", "DIR_CLOSE", "HTF_FLIP"] as const);
const storedIdentifier = /^[\x21-\x5b\x5d-\x7e]+$/u;

class InvalidCohortMetricsPayload extends Error {}

function fail(): never {
  throw new InvalidCohortMetricsPayload(
    "Liquidity cohort metrics are malformed.",
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  return (
    Object.keys(value).sort().join("\u0000") ===
    [...expected].sort().join("\u0000")
  );
}

function count(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) fail();
  return value as number;
}

function identifier(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > 256 ||
    !storedIdentifier.test(value)
  ) {
    fail();
  }
  return value;
}

function parseMetric(value: unknown): LiquidityCohortMetric {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "liquidity_cohort",
      "one_candle_enabled",
      "entry_model",
      "symbol",
      "feed",
      "trades",
      "wins",
      "losses",
      "resolved",
      "win_rate_bps",
      "ambiguous",
      "open",
    ]) ||
    !cohortNames.has(
      value.liquidity_cohort as "ONE_CANDLE" | "TWO_PLUS_CANDLES",
    ) ||
    typeof value.one_candle_enabled !== "boolean" ||
    !entryModels.has(value.entry_model as "BOC" | "DIR_CLOSE" | "HTF_FLIP")
  ) {
    fail();
  }

  const liquidityCohort = value.liquidity_cohort as
    | "ONE_CANDLE"
    | "TWO_PLUS_CANDLES";
  const oneCandleEnabled = value.one_candle_enabled;
  const trades = count(value.trades);
  const wins = count(value.wins);
  const losses = count(value.losses);
  const resolved = count(value.resolved);
  const ambiguous = count(value.ambiguous);
  const open = count(value.open);
  const expectedWinRateBps =
    resolved === 0
      ? null
      : Number(
          (10_000n * BigInt(wins) + BigInt(resolved) / 2n) /
            BigInt(resolved),
        );

  if (
    (liquidityCohort === "ONE_CANDLE" && !oneCandleEnabled) ||
    BigInt(resolved) !== BigInt(wins) + BigInt(losses) ||
    BigInt(trades) !==
      BigInt(resolved) + BigInt(ambiguous) + BigInt(open) ||
    (resolved === 0
      ? value.win_rate_bps !== null
      : !Number.isSafeInteger(value.win_rate_bps) ||
        value.win_rate_bps !== expectedWinRateBps)
  ) {
    fail();
  }

  return {
    liquidityCohort,
    oneCandleEnabled,
    entryModel: value.entry_model as "BOC" | "DIR_CLOSE" | "HTF_FLIP",
    symbol: identifier(value.symbol),
    feed: identifier(value.feed),
    trades,
    wins,
    losses,
    resolved,
    winRateBps: value.win_rate_bps as number | null,
    ambiguous,
    open,
  };
}

function parseMetricsReport(value: unknown): EntryCohortMetricsSnapshot {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["schema_version", "mode", "items"]) ||
    value.schema_version !== "rd-entry-cohort-metrics/v1" ||
    value.mode !== "PAPER_SIMULATION_ONLY" ||
    !Array.isArray(value.items)
  ) {
    fail();
  }
  const items = value.items.map(parseMetric);
  const identities = items.map((item) =>
    [
      item.liquidityCohort,
      String(item.oneCandleEnabled),
      item.entryModel,
      item.symbol,
      item.feed,
    ].join("\u0000"),
  );
  if (new Set(identities).size !== identities.length) fail();

  return items.length === 0
    ? {
        state: "EMPTY",
        items: [],
        message: "No liquidity cohort trades have been recorded.",
      }
    : {
        state: "READY",
        items,
        message: `${items.length} liquidity cohort ${
          items.length === 1 ? "row" : "rows"
        }.`,
      };
}

export async function loadEntryCohortMetrics(
  credential: string,
  signal?: AbortSignal,
): Promise<EntryCohortMetricsSnapshot> {
  if (credential.length < 1 || credential.length > 1_024) {
    throw new Error("Paper operator credential is invalid.");
  }
  const response = await fetchBounded(
    "/api/v1/rd-entry-cohort-metrics",
    signal,
    { Authorization: `Bearer ${credential}` },
  );
  if (response.status === 401) {
    throw new Error("Paper operator credential was rejected.");
  }
  if (response.status !== 200) {
    throw new Error("Liquidity cohort metrics are unavailable.");
  }
  try {
    return parseMetricsReport(await parseStrictResponse(response));
  } catch (error) {
    if (error instanceof InvalidCohortMetricsPayload) throw error;
    throw new InvalidCohortMetricsPayload(
      "Liquidity cohort metrics are malformed.",
    );
  }
}
