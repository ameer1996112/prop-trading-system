# Video-Derived Liquidity Detector Design

**Date:** 2026-07-31
**Status:** Approved for implementation

## Objective

Upgrade the V3 TradingView indicator's display-only structural-liquidity detector so it follows the shared logic from the three reference videos instead of attaching the nearest unconfirmed pivot to an existing zone.

The upgrade must detect the complete sequence:

`zone -> opposite-direction retracement -> swing liquidity -> continuation BOS -> return/sweep`

The existing strict liquidity path that controls setup eligibility, paper entries, alerts, and payloads remains unchanged until chart comparison proves the new detector matches the intended examples.

## Source rules

### Zone origin

- Demand begins at the last bearish candle before the bullish departure.
- Supply begins at the last bullish candle before the bearish departure.
- Existing V3 `RawZone` objects remain the source of zone geometry in this iteration.

### Local retracement liquidity

- A demand zone looks for a bearish retracement ending in a swing low above the zone.
- A supply zone looks for a bullish retracement ending in a swing high below the zone.
- The symmetric pivot confirms the reversal structure and supplies the canonical liquidity price and bar: the pivot-center low for demand or high for supply. The bounded reversal bridge and full opposite-candle leg remain proof inputs for candle count and BOS context, but they do not replace the displayed pivot price/bar.
- Strict mode requires at least two opposite-direction candles.
- When `Enable one-candle liquidity` is enabled, a one-candle retracement may qualify, but it must satisfy every remaining swing, side, distance, freshness, and BOS rule. This setting changes only the required opposite-candle count; it does not reduce the configured liquidity pivot strength.
- Equal lows/highs may form liquidity; a candidate is rejected only when another candle in the pivot window extends strictly beyond its extreme.

### Freshness and side

- The liquidity swing must form after the zone is confirmed.
- Demand liquidity must be strictly above the demand zone's top.
- Supply liquidity must be strictly below the supply zone's bottom.
- The retracement must not touch or overlap the originating zone before the liquidity swing is confirmed.
- The candidate must be within `Bigger structure max distance (% of move)`, measured as a percentage of that candidate's full zone-linked pre-retracement impulse. For demand, the far end is the highest high from zone confirmation through the candle before the liquidity swing. For supply, it is the lowest low across that same range. The default remains 30% to mirror the reference indicator setting.

### Continuation break of structure

- A swing is provisional until price subsequently breaks the candidate's local opposite-candle-leg extreme in the continuation direction.
- Demand requires a break above the high of the local bearish retracement leg that formed the swing low.
- Supply requires a break below the low of the local bullish retracement leg that formed the swing high.
- The broader zone-linked pre-retracement extreme remains the distance denominator only; it is not reused as the BOS level.
- `Strict structural BOS` selects candle-close confirmation. When disabled, a wick through the level confirms BOS. It defaults to disabled to match the observed reference setting.
- BOS must occur after the liquidity swing and while the zone is still fresh.

### Candidate arbitration

- Only BOS-confirmed candidates are eligible for the structural display line.
- The closest valid BOS-confirmed candidate to the zone wins while the zone remains fresh.
- An older, deeper swing may replace a provisional newer swing when its higher structural BOS confirms later. Spurious one-bar micro-pivots are prevented by retaining the configured pivot-strength window even when one-candle retracements are enabled.
- When two candidates resolve to the same price within half a minimum tick, the earlier swing bar wins so the displayed line begins at the canonical first occurrence.
- Structural candidates never write `liquidityPrimaryIndex`, `liquidityQualified`, eligibility state, setup state, entry attempts, alerts, or payloads.

## Rendering

- Draw the structural liquidity at the full retracement leg's lowest low for demand and highest high for supply.
- Use a thin grey line (`width = 1`) without a price label.
- Start the line at the bar that printed that retracement-leg extreme.
- End the line at the first candle whose wick touches or crosses the liquidity price. If no such interaction has occurred, end it at the zone's first terminal interaction bar; otherwise extend it to the current bar.
- Do not draw a duplicate structural line when its price equals the strict primary liquidity line within half a minimum tick.

## State model

Each `StructureLiquidityLevel` records:

- direction (`demand`);
- retracement-leg extreme price and bar;
- opposite-candle count and cohort;
- whether a zone-linked BOS has confirmed it is stored on the owning zone rather than globally.

Each `RawZone` records parallel candidate indexes and frozen, zone-specific BOS references, plus the selected structural swing, its bar, BOS level, and BOS bar. This keeps candidate selection zone-specific because the same swing can have different structural extremes and validity relative to different zones.

## Safety boundary

This iteration is visual calibration only:

- existing strict setup qualification is unchanged;
- existing alerts do not gain structural-liquidity authority;
- existing payload schemas and reviewed hashes are unchanged;
- no live or broker-connected path may consume structural liquidity.

## Acceptance criteria

1. A pivot without a later continuation BOS is not displayed.
2. A valid demand swing above a fresh zone displays only after bullish BOS.
3. A valid supply swing below a fresh zone displays only after bearish BOS.
4. Strict BOS uses closes; relaxed BOS uses wicks.
5. Candidates that touch the zone, form before confirmation, appear on the wrong side, or exceed the 30% distance are rejected.
6. Strict two-candle mode rejects one-candle retracements; the enabled experiment accepts them without bypassing the configured pivot-strength or other rules.
7. The closest BOS-confirmed candidate is displayed; an older closer swing can replace a provisional selection after its later BOS, and equal-price candidates select the earlier swing bar.
8. Structural lines remain thin, grey, label-free, and entry-inert.
9. Existing Pine static/contract tests continue to pass.

## Out of scope

- Replacing the current `RawZone` formation engine.
- Promoting structural liquidity into setup eligibility or execution.
- Claiming exact parity with the protected reference indicator without chart-by-chart visual validation.
- Automatically updating existing TradingView alerts.
