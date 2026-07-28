# RD 5m BOC Three-Entry Arbitration Design

**Date:** 2026-07-28

**Status:** Approved for implementation planning

**Base commit:** `6b3a236`

**Execution scope:** broker-free paper trading only

## Summary

The RD 5m strategy has three canonical entry models:

1. `BOC` — break of candle;
2. `DIR_CLOSE` — directional close;
3. `HTF_FLIP` — higher-timeframe flip.

The current version 2 contract incorrectly treats break of candle as a legacy
observation and sometimes normalizes it to `HTF_FLIP`. The source videos show
that BOC and flip are distinct triggers. Version 3 restores BOC as a first-class
candidate while preserving the video's warning that arbitrary 5m BOC entries are
discretionary.

TradingView evaluates and reports every observed candidate. The backend verifies
the evidence, selects at most one candidate for an economic paper-trade action,
and retains all candidates for audit and comparison. The operations console shows
the selected model, all competing models, the selection reason, and the simulated
trade.

No part of this design enables broker or live-account execution.

## Source correction

The following interpretation supersedes the BOC sections of
`2026-07-24-rd-5m-multi-entry-arbitration-design.md` and contract version 2.

### BOC is not flip

The November 2025 lesson explicitly demonstrates an aggressive break-of-candle
entry after:

- a valid supply zone with liquidity;
- a meaningful penetration into the zone rather than an edge-only tap;
- a large rejection;
- a following candle that forms a small protective-side wick; and
- a break in the trade direction while volume is strong.

The lesson also says this particular 5m use is rare, depends on experience, and
does not have a complete mechanical rule.

Evidence:
[`UqYlKtPjKvY`, 2:24–3:49](https://www.youtube.com/watch?v=UqYlKtPjKvY&t=144s).

### Later guidance restricts BOC timing; it does not rename BOC

The June 2026 live lesson says a break of candle is technically available in the
shown geometry, but rejects taking it on a random candle and associates normal
eligibility with higher-timeframe timing, like a flip entry.

Evidence:
[`zglv2r9xXnE`, 11:19–11:34](https://www.youtube.com/watch?v=zglv2r9xXnE&t=679s).

The May 2026 live lesson similarly declines a break-of-candle entry because the
relevant candle is not a higher-timeframe-timed candle and warns about fakeouts.

Evidence:
[`lo_7HDQK9WM`, 1:13:08–1:13:15](https://www.youtube.com/watch?v=lo_7HDQK9WM&t=4388s).

### Contract consequence

- `BOC` becomes a canonical model.
- `HTF_FLIP` remains a separate canonical model.
- A BOC occurrence is never rewritten as a flip.
- The old `LEGACY_BREAK_CANDLE` value remains readable for historical records,
  but new producers do not emit it.
- The source material does not provide a universal static priority between BOC
  and flip. Arbitration therefore uses exact event chronology and eligibility,
  not a fabricated model ranking.

## Goals

- Represent all three video-supported entry models independently.
- Detect simultaneous or sequential candidates for the same setup.
- Open at most one paper trade for a setup attempt.
- Favor the earliest source-valid, exactly proven trigger so a 5m strategy does
  not wait unnecessarily.
- Keep discretionary 5m BOC visible without pretending that its missing
  thresholds are mechanical.
- Preserve enough evidence to reproduce why a model was selected or blocked.
- Make the current decision understandable in the app.

## Non-goals

- Broker integration, live trading, or trial-account execution.
- Inventing numeric definitions for "large rejection", "deep tap", "small wick",
  "high volume", or trader intuition.
- Selecting between unrelated setups or different symbols at portfolio level.
- Changing common zone, liquidity, freshness, distance, news, session, stop, or
  target rules except where candidate metadata must reference them.
- Automatically promoting a paper configuration to live use.

## Common setup gate

No entry model can bypass the common setup gate. Before candidate evaluation, the
setup must have:

- a valid supply or demand zone;
- the required liquidity relationship;
- acceptable freshness and structural state;
- a valid directional side;
- no invalidation or account-risk veto; and
- a recorded zone engagement.

First touch remains a lifecycle event, not an entry model.

## Canonical entry models

### `BOC`

BOC is an intrabar break of a previously established reference candle in the
trade direction.

For a demand/long setup:

- the BOC trigger level is the reference candle high;
- a trigger occurs when an ordered price event trades above that high.

For a supply/short setup:

- the BOC trigger level is the reference candle low;
- a trigger occurs when an ordered price event trades below that low.

The reference candle is the setup's qualifying engagement/rejection candle. It
must be stored by identity and immutable OHLC values; the backend must not infer
it later from a moving chart window.

The reference candle's opposite-side wick is context metadata, not a universal
hard requirement. The videos show both no-wick and small-wick discussions, so a
single zero-wick rule would be source-inaccurate.

#### Strict HTF-timed BOC

The paper-eligible BOC path is deliberately conservative:

- the break must occur during the first 5m child candle of a newly opened
  15m, 30m, or 60m candle;
- the applicable HTF boundary and context are recorded;
- the reference candle and trigger price are explicit;
- chronological crossing evidence is exact; and
- every common setup gate passes.

This is the automatable interpretation of the later instruction to use BOC only
on higher-timeframe timing, like flip entries. It is intentionally narrower than
the rare discretionary example.

#### Discretionary 5m BOC

A BOC occurring outside the strict HTF-timed path is still a canonical `BOC`
candidate, tagged:

```text
boc_tier = DISCRETIONARY_5M
action = SHADOW_ONLY
reason = BOC_DISCRETIONARY_CONTEXT_UNQUANTIFIED
```

TradingView reports it, the backend stores it, and the app displays it. It cannot
win paper arbitration until the discretionary conditions are converted into a
separately approved, reproducible rule using labelled examples.

This still "handles" the entry model: it measures when the model appeared and
what would have happened, without silently converting intuition into code.

### `DIR_CLOSE`

Directional close remains the confirmed-bar model.

For demand/long:

- after engagement, a bullish candle closes in the required direction and above
  the applicable zone boundary required by the common contract.

For supply/short:

- after engagement, a bearish candle closes in the required direction and below
  the applicable zone boundary required by the common contract.

The engagement candle may qualify. Otherwise later candles may qualify while the
setup remains valid. First touch without a qualifying close is `WAIT`.

Its semantic trigger time is the confirmed 5m close.

### `HTF_FLIP`

Flip remains an ordered intrabar lifecycle on a newly opened 15m, 30m, or 60m
candle.

For demand/long:

1. the new HTF candle opens;
2. price moves toward or into the demand zone and establishes the lower wick;
3. price crosses upward through that same HTF candle's open.

Supply/short is symmetric.

The trigger level is the HTF candle open. The HTF boundary, wick-side contact,
recross, and event order must be retained. A confirmed 5m range alone cannot
prove the sequence.

## Evidence planes

Candidate detection and economic action are separate.

| Proof plane | Can detect | Paper eligibility |
|---|---|---|
| `REALTIME_TICK` | BOC and flip in live TradingView execution | Eligible only when the ordered event and all required metadata are included in the alert |
| `LOWER_TIMEFRAME_REPLAY` | Historical BOC and flip ordering | Eligible when replay coverage is complete and exact |
| `EXTERNAL_ARCHIVED_TICK` | Historical/live ordered triggers | Eligible when coverage is complete and exact |
| `CONFIRMED_5M` | Directional close; coarse BOC/flip observations | Directional close only |

A realtime alert may authorize a broker-free paper trade even though the exact
tick path cannot be reconstructed after a TradingView reload. It must be labelled
`LIVE_EXACT_NON_REPLAYABLE`, never presented as historical proof, and never used
for live execution. Reloaded historical bars must not fabricate the same result.

## TradingView producer behavior

Pine maintains setup lifecycle independently from candidate lifecycle.

For every active setup it:

1. records engagement and the immutable BOC reference candle;
2. evaluates BOC, directional close, and flip independently;
3. emits each candidate once with semantic trigger time and price;
4. retains candidates even after another model is selected;
5. emits a decision bundle whenever the candidate set or selection changes; and
6. never opens more than one economic paper position for the setup attempt.

An alert bundle contains an array, not a single `entry_model` field:

```json
{
  "strategy_version": "3.0.0-contract3",
  "rule_contract_version": "3.0.0",
  "setup_id": "stable-setup-id",
  "attempt_kind": "INITIAL",
  "entry_candidates": [
    {
      "model": "BOC",
      "state": "MATCHED",
      "semantic_trigger_epoch": 1780000001,
      "trigger_ticks": 116419,
      "proof_plane": "REALTIME_TICK",
      "boc_tier": "HTF_TIMED",
      "reference_candle": {
        "open_epoch": 1779999600,
        "high_ticks": 116439,
        "low_ticks": 116419
      },
      "htf_context_minutes": [15]
    }
  ]
}
```

The payload also includes the existing strategy identity, symbol/feed identity,
tick size, zone, direction, stop/target inputs, sequence, idempotency, and source
claim metadata.

## Backend verification

The backend is authoritative for action.

It:

- validates contract and producer versions;
- validates setup identity and common gates;
- recomputes model-specific eligibility from supplied evidence;
- rejects impossible timestamps, price relationships, or HTF boundaries;
- deduplicates retransmitted candidates;
- stores candidate, evidence, handling, decision, and simulated-trade rows;
- performs canonical arbitration; and
- returns the current setup decision to the app.

TradingView's proposed selection may be stored for parity diagnostics, but it
cannot override the backend decision.

## One-trade arbitration

Arbitration version `rd-entry-arbitration-v3` operates per
`setup_id + attempt_kind`.

### Step 1: classify candidates

Each candidate receives:

- `PAPER_ELIGIBLE`;
- `SHADOW_ONLY`;
- `OBSERVE`; or
- `REJECTED`.

Only `PAPER_ELIGIBLE` candidates can win.

### Step 2: require exact evidence

Candidates with incomplete ordering, ambiguous identity, invalid HTF timing, or
unquantified discretionary context cannot win.

### Step 3: select chronologically

Sort eligible candidates by:

1. `semantic_trigger_epoch`;
2. subsecond/tick sequence when available; and
3. stable candidate identity only as a deterministic storage tie-break.

The earliest exactly proven eligible event wins. This yields the behavior implied
by the videos:

- an exact flip can enter before waiting for a close;
- an exact strict BOC can enter before waiting for a close;
- directional close is the reliable fallback when no earlier aggressive model is
  eligible.

There is no universal `BOC > FLIP` or `FLIP > BOC` ranking.

### Co-triggers

If one price event satisfies both strict BOC and flip:

- store both canonical candidates;
- record `co_triggered_models`;
- create only one paper trade at the shared event price;
- assign the primary reporting model to the candidate whose threshold was crossed
  first in the ordered stream;
- when one event atomically crosses both thresholds, label the decision
  `CO_TRIGGER_SAME_EVENT` and use a deterministic reporting tie-break without
  claiming it is a source-derived preference.

The economic result must not change because of the reporting tie-break.

### Decision freeze

After a paper trade is opened:

- the selected economic action is immutable;
- later candidates are still stored as `NOT_SELECTED_ALREADY_OPEN`;
- no second initial paper position is created; and
- re-entry, if enabled later, remains a separate attempt kind with its own risk
  authorization.

## Paper simulator

The existing broker-free paper simulator consumes the backend selection.

For the selected candidate it records:

- selected and co-triggered models;
- entry trigger time and ticks;
- BOC reference or flip HTF anchor as applicable;
- stop and target provenance;
- risk amount and configured pair weight;
- simulated lifecycle and outcome; and
- all candidates that lost or were blocked.

Shadow-only discretionary BOC observations receive hypothetical outcome tracking
but cannot create the setup's economic paper position.

## Operations console

The app becomes the place to understand, not create, the strategy decision.

### Alert/setup detail

Show:

- common setup status;
- all three model rows;
- `waiting`, `matched`, `shadow`, `blocked`, `selected`, or `not selected`;
- semantic trigger time and price;
- BOC tier and reference candle;
- flip HTF boundary and ordering proof;
- directional-close candle;
- selection reason;
- selected entry, stop, target, and risk; and
- TradingView/backend parity status.

### Paper positions

Show one paper position per setup attempt, including:

- selected model;
- co-triggered models;
- entry/SL/TP;
- current state and result; and
- a link back to the complete candidate audit.

### Safety

The console has no broker credentials, live-order button, or automatic live
promotion. A future trial-account phase requires a separate approved design.

## Contract and storage versioning

Contract version 3 uses:

```text
contract_id = rd-5m-video-contract-v3
contract_version = 3.0.0
producer_strategy_version = 3.0.0-contract3
arbitration_policy_version = rd-entry-arbitration-v3
active_entry_models = [BOC, DIR_CLOSE, HTF_FLIP]
legacy_entry_models = [LEGACY_BREAK_CANDLE, LEGACY_REJECTION_RESPECT]
```

Version 2 records remain immutable and readable. They are not retroactively
relabeled as BOC. New version 3 decisions use new IDs/hashes so they cannot
collide with earlier normalized records.

Schema migrations are additive where practical. Any semantic enum or identity
change that cannot be added safely receives a versioned table or payload parser.

## Failure behavior

Fail closed to observation/shadow when:

- the BOC reference candle is absent or mutable;
- the break direction or trigger level is inconsistent;
- strict BOC has no valid HTF opening boundary;
- intrabar ordering is inferred only from a 5m OHLC range;
- a flip lifecycle is incomplete;
- candidate timestamps precede setup engagement;
- producer and backend contract versions disagree;
- common setup fidelity is unresolved; or
- stop, target, or risk inputs are not approved.

Failing closed must not discard the observation.

## Required verification

Implementation is complete only when tests prove:

- all three canonical models parse, persist, and display;
- BOC is never normalized into flip;
- strict HTF-timed BOC can become paper eligible;
- non-HTF discretionary BOC is stored but cannot win;
- exact BOC or flip can beat a later directional close;
- a directional close wins when earlier aggressive candidates are absent or
  blocked;
- simultaneous candidates create one paper trade;
- later candidates cannot replace an opened paper decision;
- duplicate TradingView alerts are idempotent;
- replay gaps and ambiguous ordering fail closed;
- version 2 records remain readable;
- the app explains every selection and rejection reason; and
- no route or UI path can place a broker order.

## Approved design decision

The user approved the following BOC split:

- strict higher-timeframe-timed BOC is a tradeable paper candidate;
- rare discretionary 5m BOC is detected and evaluated in shadow mode until its
  qualitative conditions can be quantified from labelled examples.
