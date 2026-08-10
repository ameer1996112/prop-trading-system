# RD 5-Minute Strategy Rule Contract

Status: `FROZEN_FOR_PAPER_VALIDATION`
Contract version: `1.0.0`
Producer strategy version: `1.2.0-contract1`
Execution boundary: broker-free paper simulator only
Real-account execution: prohibited

## Purpose

This contract turns the RD video material into explicit, reviewable rules. It separates:

- what the source teaches;
- what can be evaluated deterministically from confirmed five-minute OHLC bars;
- what needs lower-timeframe or tick evidence;
- what remains visual, calibrated, discretionary, or unresolved.

Strategy fidelity means that the same frozen inputs produce the same rule decisions. It does not
mean a 100% win rate.

## Source precedence

Later material overrides earlier material only when it explicitly narrows or corrects a rule.
Silence in a later source does not automatically delete an earlier compatible rule.

1. `E5EBc1MtiXQ`, published 2025-08-17: primary structured five-minute guide.
2. `zglv2r9xXnE`, published 2026-06-11: later live clarifications and restrictions.
3. `LCydpj3CaHo`, published 2025-04-16: fills compatible entry and management gaps.
4. `kxh_3__oAqg`, published 2024-03-25: historical guidance only where not superseded.

Every implementation decision must use one of these fidelity labels:

- `EXACT`: deterministic rule stated clearly enough to encode and replay.
- `CALIBRATED`: numeric implementation derived from guidance or labeled examples.
- `DISCRETIONARY`: source requires visual judgment without a complete formula.
- `UNRESOLVED`: sources conflict or do not define the required behavior.

`DISCRETIONARY` and `UNRESOLVED` decisions are observation-only. They cannot authorize `OPEN`.

## Canonical five-minute lifecycle

The required order is:

```text
ZONE_CANDIDATE
  -> LIQUIDITY_FORMED
  -> OWN_EXTREME_BROKEN
  -> LIQUIDITY_SWEPT
  -> ZONE_ENGAGED
  -> ENTRY_CONFIRMED
```

Terminal alternatives are `INVALIDATED`, `STALE`, `SHADOW_ONLY`, and `REJECTED`.

The detector must persist the bar index and price provenance for every transition. A transition
is valid only when its bar index is strictly later than the preceding transition. If confirmed
five-minute OHLC cannot prove intrabar ordering, the setup is `SHADOW_ONLY`.

## Zone rules

| Rule ID | Fidelity | OPEN requirement | Rule |
|---|---|---:|---|
| `ZONE_ORIGIN_OPPOSITE_CANDLE` | `EXACT` | yes | Demand begins from the last bearish candle before bullish departure. Supply is symmetric. |
| `ZONE_ACCURACY_BOUNDS` | `UNRESOLVED` | yes | Body/wick accuracy bounds are required when the origin overshoots the first departure candle, but the exact “relevant wick” formula still needs labeled fixtures. |
| `ZONE_FRESH_UNTAPPED` | `EXACT` | yes | No later candle may touch the correctly bounded zone before the qualifying approach. |
| `ZONE_FIRST_ENGAGEMENT` | `EXACT` | yes | The first wick overlap after liquidity qualification engages the zone; touch alone is not an entry. |
| `ZONE_PRE_ENTRY_CLOSE_OUTSIDE` | `EXACT` | yes | Before entry, any confirmed close inside or through the zone invalidates the setup. Wicks may enter. |
| `ZONE_POST_ENTRY_NO_RETROACTIVE_INVALIDATION` | `EXACT` | no | A close inside after a valid entry does not erase the already-open trade. |

Evidence:

- Zone origin and bounds: <https://www.youtube.com/watch?v=E5EBc1MtiXQ&t=278s>
- Freshness: <https://www.youtube.com/watch?v=E5EBc1MtiXQ&t=234s>
- Pre-entry close invalidation: <https://www.youtube.com/watch?v=E5EBc1MtiXQ&t=1070s>
- Post-entry distinction: <https://www.youtube.com/watch?v=E5EBc1MtiXQ&t=1140s>

Zone geometry may be displayed while liquidity is still forming. A geometric candidate is not an
entry-eligible setup.

## Liquidity rules

| Rule ID | Fidelity | OPEN requirement | Rule |
|---|---|---:|---|
| `LIQ_NORMAL_TWO_OPPOSITE_CANDLES` | `EXACT` | yes | Normal demand liquidity contains at least two bearish candles forming a structural low. Supply is symmetric with bullish candles. |
| `LIQ_ONE_CANDLE_EXCEPTION` | `DISCRETIONARY` | yes | One candle requires a large retracement, meaningful structure, an obvious-zone fakeout into the real zone, clear direction, own-extreme proof, and normal distance. It remains shadow-only. |
| `LIQ_OWN_EXTREME_SAME_LEG` | `EXACT` | yes | Demand stores the structural high belonging to the specific liquidity leg; supply stores that leg's structural low. A generic pivot or zone-to-liquidity absolute maximum/minimum is invalid. |
| `LIQ_STRICT_OWN_EXTREME_BREAK` | `EXACT` | yes | Demand requires `high > own_high`; supply requires `low < own_low`. Equality is not a takeout. |
| `LIQ_ACTUAL_EXTREME_SWEPT` | `EXACT` | yes | After the own-extreme break, the specific liquidity low/high must be swept on the approach. |
| `LIQ_EVENT_ORDER` | `EXACT` | yes | Formation, own-extreme break, liquidity sweep, and zone engagement must occur on strictly increasing bars unless lower-timeframe evidence proves the intrabar order. |
| `LIQ_INTERNAL_REBREAK` | `CALIBRATED` | yes | One minor/internal break is insufficient. The later live guide requires additional structural re-break proof; exact structural segmentation needs fixtures. |
| `LIQ_DISTANCE_INFLUENCES_ZONE` | `DISCRETIONARY` | yes | Liquidity must be close enough to influence the zone. There is no universal ATR or pip formula. |
| `LIQ_REPLACEMENT_AFTER_STALE_MOVE` | `DISCRETIONARY` | yes | Meaningful retracement, consolidation, or another normal-zone visit consumes the original proof; replacement liquidity must qualify its own extreme. |
| `LIQ_MULTIPLE_CANDIDATE_ARBITRATION` | `UNRESOLVED` | yes | The sources do not define a deterministic nearest/latest/strongest winner. |

Evidence:

- Own high/low: <https://www.youtube.com/watch?v=E5EBc1MtiXQ&t=639s>
- Normal and one-candle liquidity: <https://www.youtube.com/watch?v=E5EBc1MtiXQ&t=1529s>
- Distance: <https://www.youtube.com/watch?v=E5EBc1MtiXQ&t=541s>
- Stale and replacement liquidity: <https://www.youtube.com/watch?v=E5EBc1MtiXQ&t=2108s>
- Internal liquidity clarification: <https://www.youtube.com/watch?v=zglv2r9xXnE&t=278s>

## Distance policy

ATR and relative-volume values may be recorded as telemetry, but they cannot independently qualify
liquidity.

| Symbol/profile | Source guidance | Fidelity | Current action |
|---|---|---|---|
| All supported 5m profiles | reference indicator exposes `Bigger Structure Max Distance (% of move) = 30` | `CALIBRATED` | `SHADOW_ONLY` |

The maximum zone-to-liquidity distance is 30% of the candidate's full zone-linked,
pre-retracement impulse. For demand, the detector takes the highest high from zone confirmation
through the candle before the liquidity swing; for supply it takes the lowest low across that same
causal range. This broad extreme is used only for the distance denominator. The continuation-BOS
level is the candidate's local opposite-candle-leg extreme: the leg high for demand and the leg low
for supply. This deliberately keeps mixed-color candles in the broader distance measurement without
requiring continuation price to break the entire originating move. Missing or zero impulse distance
fails closed. ATR and fixed asset-class pip fallbacks do not qualify liquidity.

## Entry models

### `DIR_CLOSE`

Fidelity: `EXACT`
Paper status: executable only when every required upstream decision is `EXACT`.

- Demand: after wick engagement, a bullish candle closes above the zone.
- Supply: after wick engagement, a bearish candle closes below the zone.
- The engagement candle itself may qualify.
- If it does not qualify, later rejection candles may be observed while every close continues to
  respect the zone.
- First touch without this confirmation is `WAIT`, never `OPEN`.

Evidence: <https://www.youtube.com/watch?v=LCydpj3CaHo&t=1120s>

### `HTF_FLIP`

Fidelity: `EXACT` definition, incomplete replay evidence
Paper status: `SHADOW_ONLY`.

- Only a newly opened 15m, 30m, or 1h candle qualifies.
- Demand: the new HTF candle makes its lower wick in the zone, then crosses above its own open.
- Supply is symmetric.
- Entry occurs on the intrabar flip.

Confirmed five-minute OHLC cannot prove this order. Tick or lower-timeframe replay is mandatory.

Evidence: <https://www.youtube.com/watch?v=E5EBc1MtiXQ&t=1260s>

### `BREAK_CANDLE`

Fidelity: superseded
Paper status: `DISABLED`.

The April 2025 generic break-candle model is not independently executable. The June 2026 live
guidance restricts it to higher-timeframe timing, where it is handled as `HTF_FLIP`.

Evidence: <https://www.youtube.com/watch?v=zglv2r9xXnE&t=670s>

### Higher-timeframe boundary caution

At minutes `:25` and `:55`, the default action is to wait for the new HTF candle and its flip.
The “far enough from stop” exception is unquantified and therefore shadow-only.

Evidence: <https://www.youtube.com/watch?v=E5EBc1MtiXQ&t=1900s>

## Stop, target, session, and risk separation

- Stop placement differs across source versions and sometimes by pair. Generic zone-distal or
  multi-bar deepest-wick stops are not source-faithful. Until a versioned per-pair table and
  trigger-candle provenance are approved, candidate trades remain shadow-only.
- The April 2025 TP/BE tables are retained as historical evidence, not silently promoted over
  later material.
- Break-even and one-minute trailing are optional management policies, not setup qualification.
- Session windows require pair/session backtest approval. Older personal hours are not a universal
  market rule.
- Scheduled high-impact news and prop-firm restrictions belong to the account-aware risk layer.
  They may veto a valid signal but may not rewrite the core setup.
- The separate 30-minute strategy must never be mixed into this five-minute contract.

## Automation gate

A broker-free paper `OPEN` is permitted only when:

1. the contract and producer versions match;
2. the source feed and five-minute timeframe match an approved profile;
3. every rule marked “OPEN requirement” has a recorded `PASS`;
4. every such decision has `EXACT` fidelity;
5. the strictly ordered lifecycle indices are present;
6. the selected model is executable;
7. account-aware paper readiness allows new risk.

Decision precedence is:

```text
invalid rule -> REJECT
missing entry confirmation -> WAIT
calibrated/discretionary/unresolved evidence -> SHADOW_ONLY
all exact requirements pass -> PAPER_OPEN
```

The Phase 0 strategy manifest remains `BLOCKED`. No part of this contract authorizes broker
connectivity or real-account execution.

## Golden validation cases

The validation dataset must contain at least:

- correct own high and wrong generic/global high;
- strict break and equality-only non-break;
- two consecutive opposite candles and nonconsecutive candle count;
- own-break before sweep and sweep-before-break;
- same-five-minute-bar ambiguous ordering;
- first touch without directional close;
- same-touch directional close;
- later directional close after respected rejection candles;
- close inside before entry;
- second distinct touch;
- approved, excessive, missing, and zero distance;
- one-candle exception;
- internal liquidity with only one break and with approved re-break proof;
- meaningful retracement requiring replacement liquidity;
- generic `BREAK_CANDLE`;
- HTF flip with and without lower-timeframe ordering evidence.

Each fixture must include the source feed, symbol, tick size, ordered OHLC bars, expected
transition indices, rule decisions, final action, and a human-reviewed source reference.

## Done means

- The typed contract and generated schema validate this frozen policy.
- A first fresh tap without `DIR_CLOSE` never produces `OPEN`.
- Non-exact required rules produce `SHADOW_ONLY`.
- Invalid rule order produces `REJECT`.
- The Pine producer and offline gate use the same contract version.
- Static tests, contract tests, and golden fixture tests pass.
- TradingView Bar Replay matches every approved five-minute fixture.
- HTF-flip execution remains disabled until lower-timeframe/tick replay parity is proven.
- The Phase 0 activation manifest remains `BLOCKED`.
