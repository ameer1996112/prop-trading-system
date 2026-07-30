# One-Candle Liquidity Experiment Design

**Date:** 2026-07-30
**Status:** Approved for implementation planning

## Objective

Measure whether one-candle liquidity improves or degrades paper-trading win rate without
changing the existing strict two-candle strategy when the experiment is disabled and without
allowing discretionary evidence to reach live execution.

## User-facing behavior

The V3 TradingView indicator gains a boolean input named
`Enable one-candle liquidity`, defaulting to `false`.

- When the input is off, liquidity requires at least two consecutive opposite candles. This
  must be behaviorally identical to the current detector.
- When the input is on, a candidate may contain one opposite candle. It must still satisfy
  every other applicable liquidity requirement: a confirmed structural pivot, correct side of
  the zone, formation after the zone origin, same-leg own extreme, strict own-extreme break,
  later sweep, valid event ordering, and the existing distance policy.
- Enabling the experiment adds one-candle candidates; it does not make every isolated candle
  liquidity.
- Candidate arbitration remains distance-based. The closest valid candidate wins regardless
  of whether it has one candle or two or more candles. This makes the experiment capable of
  selecting a closer one-candle structure such as the observed 1599.896 candidate instead of
  a farther two-candle candidate such as 1606.695, provided the closer structure passes all
  remaining rules.

TradingView snapshots indicator inputs when an alert is created. Alerts must therefore be
recreated after changing this input.

## Classification and data flow

Every selected liquidity candidate is assigned one immutable cohort:

- `ONE_CANDLE`
- `TWO_PLUS_CANDLES`

The cohort is copied from the liquidity level to its owning zone, then frozen onto the entry
attempt. V3 entry payloads and paper outcome events include the cohort so later candidate
replacement cannot relabel an existing trade.

The experiment-enabled setting is also serialized in the producer settings identity. Alerts
with different flag values must not share a reviewed settings hash.

## Paper eligibility and safety boundary

One-candle setups may produce paper-simulator entries and their stop, target, and ambiguous-exit
outcomes. They remain discretionary evidence:

- `LIQ_NORMAL_TWO_OPPOSITE_CANDLES` passes only for `TWO_PLUS_CANDLES`.
- `LIQ_ONE_CANDLE_EXCEPTION` passes only for a selected `ONE_CANDLE` candidate while the input
  is enabled.
- Paper eligibility accepts the normal path or the explicitly enabled experimental path.
- The experimental path is tagged and cannot be promoted to exact/common production evidence.
- Broker and live-execution paths reject `ONE_CANDLE` regardless of settings, hashes, entry
  model, or outcome history.

The existing three entry models—`BOC`, `DIR_CLOSE`, and `HTF_FLIP`—continue to compete under the
current arbitration policy. Liquidity cohort is an independent analysis dimension, not a fourth
entry model.

## Metrics

Paper results are aggregated separately by:

- liquidity cohort;
- entry model;
- symbol and feed;
- experiment setting;
- outcome: win, loss, ambiguous, or still open.

The dashboard exposes trade count, wins, losses, resolved win rate, ambiguous count, and open
count. Win rate excludes open and ambiguous outcomes and displays the resolved sample size.
The normal cohort remains visible while the experiment is enabled so the two cohorts can be
compared over the same market period.

## Compatibility and versioning

The new input defaults to off, preserving existing charts and strategy behavior. The V3 payload
contract and detector version must be incremented because the payload gains cohort metadata and
paper eligibility gains an experimental branch. Consumers must reject unknown or missing cohort
values for the new version rather than silently merging data.

Existing stored V3 records remain readable as legacy strict-mode observations and are treated as
`TWO_PLUS_CANDLES` only when their version predates this feature and their recorded rule results
prove the two-candle requirement.

## Testing

Implementation is test-first and covers:

1. The new input exists, defaults to off, and strict mode still requires two candles.
2. A one-candle pivot is rejected when the input is off.
3. The same pivot is accepted when the input is on and all other rules pass.
4. Enabling the input does not bypass pivot, side, origin, break, sweep, order, or distance rules.
5. Distance arbitration can select a closer one-candle candidate over a farther two-candle
   candidate.
6. Cohort metadata is frozen onto entry and outcome payloads.
7. Normal and experimental paper entries are accepted into separate metric cohorts.
8. One-candle evidence is rejected by every live-execution gate.
9. Legacy strict records remain readable without contaminating experimental results.
10. Existing Pine parity, wire-contract, storage, simulator, dashboard, and worker tests pass.

## Out of scope

- Defining a universal discretionary quality score for one-candle liquidity.
- Changing zone geometry or the three entry-model definitions.
- Allowing one-candle evidence in live or broker-connected trading.
- Automatically modifying existing TradingView alerts.
