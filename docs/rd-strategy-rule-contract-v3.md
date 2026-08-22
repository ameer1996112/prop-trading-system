# RD strategy rule contract v3

Contract v3 is the reviewed, paper-only RD 5-minute entry contract. Its machine-readable source is
[`config/phase0/rd-strategy-rule-contract-v3.json`](../config/phase0/rd-strategy-rule-contract-v3.json).
The contract identity is `rd-5m-video-contract-v3`, the contract version is `3.1.0`,
the producer version is `3.1.0-contract3`, and the arbitration policy is
`rd-entry-arbitration-v3`.

## Closed entry-model set

Version 3 evaluates exactly three canonical entry models:

- `BOC`: an ordered intrabar break of an immutable reference candle. A BOC is never renamed or
  normalized to a flip.
- `DIR_CLOSE`: an exact confirmed five-minute directional close after engagement.
- `HTF_FLIP`: an ordered contact-and-open-recross lifecycle on a newly opened 15m, 30m, or 60m
  candle.

First touch remains `ZONE_ENGAGED`, not an entry. Version 2
`LEGACY_BREAK_CANDLE` and `LEGACY_REJECTION_RESPECT` records remain readable but are not valid
version 3 producer values.

## Zone invalidation clarification

An ordinary wick may enter a zone and records engagement. A later confirmed five-minute bar whose
wick crosses the zone's distal boundary invalidates the zone and prevents any new entry candidate:
`low < bottom` for demand and `high > top` for supply. Merely touching the distal boundary is not a
breach. The inherited close rule remains stricter at the proximal boundary: a confirmed close
inside or through the zone also invalidates it.

## BOC eligibility split

Strict `HTF_TIMED` BOC is eligible for paper arbitration only on the first five-minute child of a
new 15m, 30m, or 60m candle, with exact ordered evidence, an immutable reference candle, and all
common setup rules passing.

`DISCRETIONARY_5M` BOC remains a real, separately recorded BOC observation, but it is always
`SHADOW_ONLY` with reason `BOC_DISCRETIONARY_CONTEXT_UNQUANTIFIED`. It cannot create a paper
intent. This preserves the qualitative video example without inventing a mechanical threshold.

## Arbitration and evidence

The edge, not TradingView, authorizes the paper decision. It validates the producer and contract
versions, common setup evidence, candidate-specific facts, reviewed detector/settings identities,
event chronology, price geometry, and HTF timing.

Eligible candidates are ordered by semantic trigger epoch, exact event sequence, then stable
candidate identity only as a storage tie-break. There is no fixed model rank. A single atomic
event may co-trigger BOC and flip; both candidates are retained, the decision is marked
`CO_TRIGGER_SAME_EVENT`, and only one economic paper intent is created.

`REALTIME_TICK` evidence can be exact only during realtime Pine execution and is labelled
`LIVE_EXACT_NON_REPLAYABLE`. Historical evaluation must not reconstruct it from a five-minute
OHLC range. Confirmed-five-minute evidence can authorize `DIR_CLOSE`, but cannot prove an
intrabar BOC or flip ordering.

A realtime flip contact and recross may occur in the same five-minute child only when retained
contact epoch/sequence facts prove that the recross came from a strictly later, continuously
observed tick. The same atomic tick, a sequence gap, historical OHLC, or an unrepresentable
same-second ordering cannot fabricate `EXACT` evidence.

## Decision freeze and paper boundary

One initial setup attempt creates at most one paper intent. After a paper decision opens, the
economic selection is immutable. Later candidates remain visible as
`NOT_SELECTED_ALREADY_OPEN`; they cannot replace the opened decision. Re-entry is not authorized
by the current wire contract.

The bounded decision read model returns only the latest revision for each
`(setup_id, attempt_kind)` while retaining every raw revision in append-only storage. A latest
`NOT_SELECTED_ALREADY_OPEN` revision separately exposes the immutable opened economic selection
and its paper-intent link; it is not presented as a newly selected trade.

The Pine visual zone target never terminalizes an engaged attempt. Active attempts, including
discretionary shadow observations and models still waiting for later evidence, remain in bounded
lifecycle state until genuine invalidation or exit. If active attempts prevent visual trimming,
the producer exposes a retention-blocked diagnostic and refuses new attempt state at the hard cap.

Paper eligibility also requires a configured immutable PAPER_ONLY account, risk in the contract
range, and reviewed nonzero detector/settings SHA-256 values that match the edge configuration.
Missing or inconsistent authority fails closed to audit or shadow. All observations remain
broker-free: contract v3 sets `paper_only` to true and `real_execution_allowed` to false.

## Source correction

The BOC interpretation is frozen from these reviewed lesson excerpts:

- discretionary aggressive break example: `UqYlKtPjKvY`, 2:24–3:49;
- rejection of a non-HTF-timed random BOC: `lo_7HDQK9WM`, 1:13:08–1:13:15;
- higher-timeframe timing requirement: `zglv2r9xXnE`, 11:19–11:34.

These sources restrict when BOC is eligible; they do not turn BOC into `HTF_FLIP`.

## Verification and rollout

Run `make verify-observation` to check the contract, generated schema and vectors, Python/edge
parity, persistence, console, boundary scan, and build artifacts. The paper-only deployment and
rollback procedure is
[`docs/runbooks/rd-three-entry-paper-rollout.md`](runbooks/rd-three-entry-paper-rollout.md).
