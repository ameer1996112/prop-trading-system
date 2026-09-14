# Micro-Retracement Liquidity Design

## Goal

Add an optional display-only liquidity experiment for shallow continuation pauses that do not satisfy the existing symmetric pivot-strength rule. The experiment should make the 08:40 GBPJPY demand-zone example observable without weakening strict setup eligibility or execution rules.

## Scope and safety boundary

Add `Enable micro-retracement liquidity (display only)` under the Liquidity settings. It defaults to `false`.

Micro-retracement candidates may update only the existing structural-liquidity display state. They must never update strict liquidity indexes, `liquidityQualified`, eligibility state, setup state, entry attempts, alerts, validation payloads, or setup-export payloads.

The existing symmetric structural-liquidity detector remains enabled and unchanged. When the experiment is disabled, chart behavior must remain identical to the current behavior.

## Qualification

A micro-retracement candidate consists of exactly one opposite-direction candle followed immediately by one continuation candle:

- For demand, the previous candle must be bearish and the current candle must be bullish with a high strictly above the previous candle's high. The candidate price is the previous candle's low, and its BOS level is the previous candle's high.
- For supply, the previous candle must be bullish and the current candle must be bearish with a low strictly below the previous candle's low. The candidate price is the previous candle's high, and its BOS level is the previous candle's low.
- Doji or neutral candles do not qualify as either the pause or continuation candle.
- The pause candle must occur after the owning zone's confirmation bar.
- Demand candidates must be strictly above the demand zone's top; supply candidates must be strictly below the supply zone's bottom.
- The owning zone must still be fresh and must not have been touched by the candidate-confirmation candle.
- The candidate must satisfy the existing `Bigger structure max distance (% of move)` limit.

The continuation candle is both candidate confirmation and BOS confirmation. No later candle may retroactively qualify a pause whose immediate successor failed to break its BOS level.

## Candidate integration and rendering

Micro candidates use the existing `StructureLiquidityLevel` representation and zone-specific structural candidate arbitration. They carry the `ONE_CANDLE` cohort and may compete with symmetric-pivot candidates using the existing closest-to-zone and same-price tie-breaking rules.

Rendering uses the existing structural liquidity line. The line begins at the pause candle's extreme and ends at the first later candle that touches or crosses that price, with the existing terminal-zone fallback. No additional labels, markers, or line styles are introduced.

## Testing

Static Pine regression tests must verify:

- the input exists and defaults to `false`;
- demand and supply micro candidates require the exact opposite-candle/continuation-candle sequence;
- doji candles are excluded;
- the pause bar must be after zone confirmation;
- the existing distance, freshness, and arbitration gates apply;
- the micro path writes only structural display state and cannot call or write strict eligibility, setup, entry, alert, or payload paths;
- disabling the toggle leaves the existing detector path unchanged.

The complete V3 Pine static test file must pass after implementation.
