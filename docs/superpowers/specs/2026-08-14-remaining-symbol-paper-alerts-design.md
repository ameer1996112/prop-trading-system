# Remaining-symbol paper alerts design

Date: 2026-08-14

Status: approved design; implementation not started

## Objective

Add strict, server-side TradingView paper alerts for four reviewed source identities:

- `VANTAGE:GBPCAD`
- `VANTAGE:GBPUSD`
- `VANTAGE:NZDJPY`
- `OANDA:XPTUSD`

The alerts must behave like the existing reviewed paper alerts: confirmed five-minute
`DIR_CLOSE`, `TWO_PLUS_CANDLES`, a structural wick stop, and an exact 4R paper target. They must
never authorize an MT5, demo, or live order.

## Current boundary

The active `rd-entry-execution-proposal-v1` contract is frozen and accepts only EURUSD, GBPJPY,
USDJPY, XAUUSD, and NAS100. Its five current TradingView alerts remain active and immutable.
TradingView snapshots source code and inputs when an alert is created, so this change must not
silently reinterpret or mutate those existing alerts.

The four requested identities have no reviewed V1 binding. Reusing another symbol's settings or
tick-capability digest would fail validation and would destroy the evidence chain. Modifying the
frozen V1 contract is therefore out of scope.

## Chosen architecture

Introduce a parallel, versioned V2 paper-proposal path while retaining V1 unchanged. V2 supports
all nine reviewed symbols, but this rollout creates V2 alerts only for the four new identities.
The observation edge accepts V1 and V2 side by side and stores both as paper-only observations.

V2 remains account-free. It has no broker account, order, position, credential, command, terminal,
or execution authority. Candidate dispatch remains disabled. The existing observation webhook is
reused; no second public ingress is added.

## Reviewed identity evidence

Before a symbol can enter the V2 identity registry, generate a canonical, immutable evidence
artifact containing:

- exact TradingView ticker ID, source symbol, and source feed;
- timeframe `M5`;
- exact `syminfo.mintick` captured from the selected TradingView feed;
- detector-code digest and provenance digest;
- complete strategy input profile;
- strict cohort settings: one-candle OFF and micro-retracement OFF;
- proposal emission ON and legacy contract-v3 emission OFF;
- buffer-policy version and paper-only buffer ticks;
- canonical artifact digest, settings digest, and tick-capability digest.

The implementation must derive hashes from canonical evidence bytes. It must not invent, copy, or
manually type a digest without a reproducible preimage. Feed or tick-size ambiguity blocks that
symbol without blocking the other reviewed identities.

The initial paper-only buffer fixtures are conservative asset-class values:

| Identity | Buffer ticks | Divergence tolerance ticks |
| --- | ---: | ---: |
| `VANTAGE:GBPCAD` | 2 | 3 |
| `VANTAGE:GBPUSD` | 2 | 3 |
| `VANTAGE:NZDJPY` | 2 | 5 |
| `OANDA:XPTUSD` | 5 | 10 |

These values are paper-observation fixtures, not profitability claims and not production trading
parameters. Changing one requires a new evidence artifact, new digest, and recreated alert.

## Contract and validation

The V2 wire contract accepts only:

- execution mode `PAPER_ONLY`;
- delivery kind `LIVE` with `LIVE_CONTIGUOUS` integrity;
- timeframe `M5`;
- entry model `DIR_CLOSE`;
- liquidity cohort `TWO_PLUS_CANDLES`;
- selection fidelity `EXACT` and action `PAPER_ELIGIBLE`;
- replayable, closed five-minute engagement and source candles;
- the exact reviewed ticker/feed/tick-size/hash binding;
- a direction-aware engagement wick stop;
- the exact per-symbol buffer fixture;
- safe integer-tick risk and an exact 4R target;
- an observation no more than 30 seconds after the source-bar close.

Unknown fields, unsupported symbols, historical/backfilled delivery, one-candle liquidity,
micro-retracement qualification, incorrect feeds, stale observations, geometry disagreement,
unsafe arithmetic, or any binding mismatch fail closed. A rejected proposal creates no paper
intent and no dispatchable candidate.

## Pine behavior

Add a separate V2 proposal emitter and explicit default-OFF input. The existing V1 emitter and
active V1 alerts remain unchanged. The V2 emitter observes frozen detector state and cannot mutate
selection, drawings, legacy paper simulation, stop/target state, or another producer's sequence.

The emitter serializes the exact reviewed identity, source tick size, confirmed candle evidence,
structural wick, buffer, stop, risk, and 4R target. It emits only through `alert()` on a real-time,
confirmed M5 bar. Payload generation remains inert unless the dedicated credential, all reviewed
hashes, supported identity, and V2 emission switch are valid.

## Observation-edge flow

The existing endpoint continues to receive authenticated TradingView alerts:

```text
TradingView V1 or V2 paper proposal
        -> authenticated observation ingress
        -> version-specific strict validation
        -> idempotent paper observation/result
        -> immutable audit and producer checkpoint
```

V1 and V2 use independent version-aware validation but share the existing credential boundary,
storage durability, idempotency, producer-gap quarantine, and paper-result reporting. A version
cannot fall back to the other version after validation fails.

## Deployment and alert creation

Implementation occurs in a clean isolated worktree because the current source checkout contains
unrelated user changes. The reviewed change is tested and deployed only to the observation edge.
Deployment must preserve:

- `mode=OBSERVATION_ONLY`;
- paper simulator enabled;
- canonical paper promotion disabled;
- candidate dispatch disabled;
- execution disabled.

After deployment and health verification, create four TradingView alerts with their exact feed and
identity profile. Each alert uses `Any alert() function call`, the five-minute chart, open-ended
expiry, and the existing observation webhook. Alert creation is complete only when TradingView's
Alerts panel reports every new symbol as `Active`.

## Testing and acceptance

Use test-driven development. Required automated evidence includes:

- RED tests proving the four identities are rejected before V2 support exists;
- schema/runtime parity and exact symbol/feed enum coverage;
- positive vectors for all nine identities and negative vectors for wrong feed, tick size, digest,
  buffer, candle timing, stop, risk, target, and unknown fields;
- exact 4R and safe-integer boundary tests;
- version isolation: invalid V2 never falls through to V1 and V1 bytes/behavior remain frozen;
- Pine static tests for confirmed M5 DIR_CLOSE, strict cohorts, independent default-OFF emission,
  payload bounds, and absence of broker/order surfaces;
- observation-ingestion tests for receipt, retry replay, sequence gap/out-of-order/conflict, and
  candidate-body conflict;
- deployment health proof showing observation-only and execution-disabled state;
- TradingView proof showing GBPCAD, GBPUSD, NZDJPY, and XPTUSD active at 5m with exact alert
  snapshots and the expected webhook.

No synthetic request may be represented as a real TradingView receipt. The first genuine setup for
each identity must later be reconciled against the TradingView Alert Log and observation receipt.

## Failure handling and rollback

A symbol with incomplete identity evidence remains unsupported and gets no alert. A failed deploy
or failed health check stops alert creation. A failed alert verification deletes or disables only
the new malformed alert; existing V1 alerts remain untouched.

Rollback disables the V2 emission/ingress gate and the four V2 alerts, then restores the last
reviewed observation-edge deployment. It does not change the existing five V1 alerts, MT5, or any
broker state.

## Explicit non-goals

- no MT5 connection, EA installation, Algo Trading, order, position, or broker mutation;
- no demo/live execution or authority promotion;
- no claim that paper performance predicts profitability;
- no optimization of strategy rules or buffer values in this change;
- no one-candle, BOC, HTF_FLIP, or micro-retracement entry promotion;
- no modification or recreation of the existing five V1 alerts.
