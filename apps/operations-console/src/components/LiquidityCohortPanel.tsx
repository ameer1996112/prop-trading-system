import type {
  EntryCohortMetricsSnapshot,
  LiquidityCohortMetric,
} from "../lib/entry-cohort-metrics";

const cohorts = ["ONE_CANDLE", "TWO_PLUS_CANDLES"] as const;

function displayLabel(value: string): string {
  return value.replaceAll("_", " ");
}

function metricRows(
  items: LiquidityCohortMetric[],
  cohort: LiquidityCohortMetric["liquidityCohort"],
): LiquidityCohortMetric[] {
  return items.filter((item) => item.liquidityCohort === cohort);
}

export function LiquidityCohortPanel({
  snapshot,
}: {
  snapshot: EntryCohortMetricsSnapshot;
}) {
  return (
    <section
      aria-labelledby="liquidity-experiment-heading"
      className="liquidity-cohort-panel"
      id="liquidity-experiment"
    >
      <header>
        <div>
          <span>SHADOW COMPARISON · PAPER SIMULATION ONLY</span>
          <h3 id="liquidity-experiment-heading">Liquidity experiment</h3>
        </div>
        <p>Compare outcomes without changing paper-trade eligibility.</p>
      </header>

      {snapshot.state !== "READY" ? (
        <p
          aria-live="polite"
          className={[
            "liquidity-cohort-state",
            snapshot.state === "ERROR"
              ? "liquidity-cohort-state-error"
              : "liquidity-cohort-state-neutral",
          ].join(" ")}
          role="status"
        >
          {snapshot.message}
        </p>
      ) : (
        <div className="liquidity-cohort-table-wrap">
          <table>
            <caption>
              Entry-model outcomes grouped by liquidity confirmation cohort
            </caption>
            <thead>
              <tr>
                <th scope="col">Model</th>
                <th scope="col">Setting</th>
                <th scope="col">Symbol / feed</th>
                <th scope="col">Trades</th>
                <th scope="col">Wins / losses</th>
                <th scope="col">Win rate</th>
                <th scope="col">Ambiguous</th>
                <th scope="col">Open</th>
              </tr>
            </thead>
            {cohorts.map((cohort) => {
              const rows = metricRows(snapshot.items, cohort);
              if (rows.length === 0) return null;
              return (
                <tbody key={cohort}>
                  <tr>
                    <th
                      className="liquidity-cohort-group"
                      colSpan={8}
                      scope="rowgroup"
                    >
                      {displayLabel(cohort)}
                    </th>
                  </tr>
                  {rows.map((item) => (
                    <tr
                      key={[
                        item.liquidityCohort,
                        item.oneCandleEnabled,
                        item.entryModel,
                        item.symbol,
                        item.feed,
                      ].join(":")}
                    >
                      <th scope="row">{displayLabel(item.entryModel)}</th>
                      <td>
                        <span
                          className={[
                            "liquidity-cohort-setting",
                            item.oneCandleEnabled
                              ? "liquidity-cohort-setting-enabled"
                              : "liquidity-cohort-setting-strict",
                          ].join(" ")}
                        >
                          {item.oneCandleEnabled
                            ? "EXPERIMENT ON"
                            : "STRICT"}
                        </span>
                      </td>
                      <td>{item.symbol} / {item.feed}</td>
                      <td className="liquidity-cohort-number">{item.trades}</td>
                      <td className="liquidity-cohort-number">
                        {item.wins} / {item.losses}
                      </td>
                      <td className="liquidity-cohort-number">
                        <div className="liquidity-cohort-rate">
                          <strong>
                            {item.winRateBps === null
                              ? "No resolved trades"
                              : `${(item.winRateBps / 100).toFixed(2)}%`}
                          </strong>
                          <span className="liquidity-cohort-resolved">
                            {item.resolved} resolved
                          </span>
                        </div>
                      </td>
                      <td className="liquidity-cohort-number">
                        {item.ambiguous}
                      </td>
                      <td className="liquidity-cohort-number">{item.open}</td>
                    </tr>
                  ))}
                </tbody>
              );
            })}
          </table>
        </div>
      )}
    </section>
  );
}
