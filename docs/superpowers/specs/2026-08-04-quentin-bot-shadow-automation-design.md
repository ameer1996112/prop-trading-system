# Quentin Bot Shadow Automation Design

**Date:** 2026-08-04
**Status:** Design direction approved; written specification awaiting review
**Profile ID:** `quentin-bot-shadow-v1`

## Objective

Build an isolated, observable automation profile for the public Supply, Demand,
and Liquidity rules demonstrated by Quentin Trirex. The first release must turn
the public rules into deterministic facts and shadow decisions without changing
the current `3.1` TradingView alert contract or placing real trades.

This is an evidence-driven approximation of the publicly demonstrated method.
It is not a claim of access to, or exact parity with, the creator's private EA,
source code, settings, or discretionary judgment.

## Decision summary

- Preserve the current `3.1` system and alerts unchanged.
- Introduce an isolated `3.2` shadow contract for this profile.
- Run on the 5-minute timeframe only.
- Treat directional bias as an explicit operator input.
- Record both wick-BOS and close-BOS facts; select wick-BOS for the Quentin-bot
  shadow profile and close-BOS for the strict comparison cohort.
- Keep one-candle liquidity as a shadow-only experiment and report it separately
  from the public two-plus-candle interpretation.
- Use the strong directional candle rule first and BOC only as the ordered
  fallback for a weak directional candle.
- Calculate, but do not silently choose between, the conflicting public stop and
  target models.
- Require historical fixtures and forward shadow evidence before one
  `PAPER_ONLY` canary is allowed.

## Evidence hierarchy

When public examples conflict, implementation decisions use this priority:

1. The latest public Supply, Demand, and Liquidity bot update.
2. Repeated behavior across several public automated-trade examples.
3. The detailed public educational explanations.
4. Existing project behavior, retained only when public sources do not resolve
   the rule.
5. A separately labelled experiment when no public source resolves the rule.

The evidence set includes:

- [Latest bot update and entry filter](https://www.youtube.com/watch?v=-95NiayOd5Y)
- [Detailed strategy walkthrough](https://www.youtube.com/watch?v=8u-uCksS4Ho)
- [Win-rate discussion](https://www.youtube.com/watch?v=6k73bJbqm74)
- [2026 strategy breakdown](https://www.youtube.com/watch?v=vEpP6_cmBUk)
- [Finished bot overview](https://www.youtube.com/watch?v=NhiyrYaoOio)
- [Bot update](https://www.youtube.com/watch?v=B87AvOqbL9s)
- [Wick-BOS automated example](https://www.youtube.com/watch?v=uQ0XrKwhDdg)
- [Consumed-liquidity replacement example](https://www.youtube.com/watch?v=F_WDrNxjA9Q)
- [Time-filter example](https://www.youtube.com/watch?v=odV290gw81c)
- [Manual-zone limitation example](https://www.youtube.com/watch?v=O76uFYEeNFk)

Exact video timestamps and example annotations belong in the validation fixture
manifest created during implementation. A fixture may add evidence, but it may
not silently change this contract.

## Scope

### Instruments

The profile covers only the requested nine symbols:

- `USDJPY`
- `GBPJPY`
- `GBPCAD`
- `EURUSD`
- `GBPUSD`
- `NZDJPY`
- `NAS100`
- `XAUUSD`
- `XPTUSD`

The payload must retain the exact TradingView `ticker_id` and feed in addition
to the normalized symbol. A receipt for one feed does not validate another feed.

### Timeframe

Only 5-minute chart events qualify. A non-5-minute event must fail validation
and must never create a paper intent. Public 30-minute examples remain evidence
for the general sequence, not authorization for a 30-minute implementation.

### Contract versions

This design introduces:

- `schema_version = "3.2"`
- `strategy_version = "3.2.0-contract3"`
- `rule_contract_version = "3.2.0"`
- `execution_mode = "PAPER_ONLY"`
- `profile_id = "quentin-bot-shadow-v1"`

The existing `3.1` ingress, storage, alerts, and strategy decisions remain
unchanged. A `3.2` event must not be accepted by a `3.1`-only validator through
fallback coercion.

## Strategy state machine

The profile follows this ordered state machine:

`zone -> liquidity candidate -> BOS -> zone engagement -> entry confirmation -> candidate risk plan -> terminal outcome`

Every transition records its source bar, event time, rule result, and rejection
reason. A later bar cannot retroactively manufacture an earlier transition.

### Terminal behavior

A setup becomes terminal when any of these occurs:

- its zone is invalidated;
- the configured age or session boundary expires it;
- a single paper intent is accepted;
- a reviewed kill switch disables the profile;
- required facts become contradictory or incomplete.

Terminal setups cannot reopen. Repeated TradingView alerts for the same setup
must be idempotent.

## Directional bias

Directional bias is an explicit, hashed profile setting with four values:

- `LONG_ONLY`
- `SHORT_ONLY`
- `BOTH`
- `OFF`

Shadow observation defaults to `BOTH`. Paper intent defaults to `OFF` until an
operator explicitly binds a reviewed bias to the symbol profile. `LONG_ONLY`
rejects supply entries, `SHORT_ONLY` rejects demand entries, and `OFF` records
facts without proposing entries.

Automatic market bias is out of scope. The system may later emit a bias
recommendation as telemetry, but it cannot change the bound bias in this
version.

## Zone rules

The first implementation reuses existing `RawZone` geometry so the new profile
can be compared without introducing two changing detectors at once. It must also
record the origin candle, departure candle, distal price, proximal price, and
zone direction as immutable facts.

Public geometry is interpreted as:

- demand: the last bearish origin candle before bullish departure;
- supply: the last bullish origin candle before bearish departure;
- the origin wick is included;
- the distal boundary may extend to the farther departure wick when the existing
  zone engine already applies that rule.

If the public example contains a zone that `RawZone` misses, the miss becomes an
annotated validation fixture. Manual chart-click zone injection and replacement
of the zone engine are not part of the first implementation slice.

## Liquidity qualification

### Cohorts

Every candidate is labelled exactly one of:

- `TWO_PLUS`: at least two consecutive opposite-direction retracement candles;
- `ONE_CANDLE`: exactly one opposite-direction retracement candle.

`TWO_PLUS` is the strict public-rule comparator. `ONE_CANDLE` is the user's
current test cohort and is shadow-only. It can never produce a paper intent in
`3.2.0`, even if all other facts pass.

### Candidate placement

For demand, liquidity is a retracement swing low above the demand zone. For
supply, liquidity is a retracement swing high below the supply zone. A candidate
must form after zone confirmation and must belong to that zone's chronological
sequence.

The candidate is rejected if price overlaps or retaps the owning zone between
zone confirmation and BOS qualification. A candidate from another zone or from
before this zone's confirmation cannot be borrowed.

### Candidate replacement

Each zone owns its own ordered candidate list. When a candidate is consumed
before a valid entry sequence begins, it is marked `CONSUMED` and the detector
may promote the next chronological valid candidate. The history is retained;
replacement does not delete the consumed candidate or rewrite its timestamps.

### BOS facts

The detector records both facts for every candidate:

- `bos_wick_confirmed`: price wicks through the continuation structure level;
- `bos_close_confirmed`: a confirmed candle closes through that level.

For demand, continuation breaks above the local bearish retracement-leg high.
For supply, continuation breaks below the local bullish retracement-leg low.
Both confirmations must occur after the liquidity swing.

`quentin-bot-shadow-v1` selects wick-BOS because public automated examples show
wick-only acceptance. The strict comparator selects close-BOS because the
detailed educational explanation uses candle-close confirmation. Both raw facts
remain visible for comparison.

The existing 30% structure-distance value is recorded as a diagnostic ratio. It
is not a hard `3.2.0` qualifier because the reviewed public evidence does not
establish that threshold as a universal rule.

## Zone engagement and invalidation

The first wick overlap with a qualified zone starts engagement. Touch alone is
not an entry.

After engagement:

- demand requires a confirmed close above the zone for an entry candidate;
- supply requires a confirmed close below the zone for an entry candidate;
- a confirmed close inside or through the zone invalidates the setup before
  entry;
- an invalidated setup cannot use BOC as a rescue path.

The profile records the first engagement bar and the deepest price reached from
engagement through entry confirmation.

## Entry models

### Strong directional close

For a confirmed candle with `range = high - low > 0`:

`body_ratio = abs(close - open) / range`

A demand strong entry candidate requires all of:

- bullish candle (`close > open`);
- confirmed close above the demand zone;
- `body_ratio >= 0.50`;
- lower wick greater than upper wick.

A supply strong entry candidate requires all of:

- bearish candle (`close < open`);
- confirmed close below the supply zone;
- `body_ratio >= 0.50`;
- upper wick greater than lower wick.

A passing candle records a `DIR_CLOSE` candidate on its confirmed close. The
exact body ratio and wick sizes are payload facts, not only booleans.

### Weak-candle BOC fallback

If the first directional close remains outside the zone but fails the strength
or wick-balance rule, it becomes the immutable BOC reference candle:

- demand waits for a later ordered break above its high;
- supply waits for a later ordered break below its low.

The break must occur after the reference candle. A same-bar inferred break is
shadow telemetry only because historical OHLC cannot prove intrabar ordering.
Only an observed later-bar or realtime ordered break can become paper-eligible.

If a candle closes inside or through the zone, the setup invalidates and no BOC
reference is created.

### Existing entry models

The existing `HTF_FLIP` model and current `3.1` BOC behavior are not changed or
promoted by this profile. Their facts may be stored for comparison, but
`quentin-bot-shadow-v1` selects only the strong `DIR_CLOSE` or its weak-candle
BOC fallback defined above.

## Session behavior

The profile records UTC and configured local-session facts for every setup.
Shadow collection defaults to all day so evidence is not discarded. Session is
not a hard shadow qualifier in `3.2.0`.

A paper profile must bind an explicit per-symbol session window before it is
enabled. Events outside that window remain observable but cannot produce a paper
intent. Session changes require a new settings hash.

## Risk-plan candidates

Public examples do not prove one universal stop or target model. The shadow
profile therefore calculates all reviewed candidates and makes no unreviewed
economic selection.

### Stop candidates

- `ENTRY_WICK`: demand uses entry-candle low minus the configured tick buffer;
  supply uses entry-candle high plus the buffer.
- `DEEPEST_ENGAGEMENT`: demand uses the lowest price from first engagement
  through entry minus the buffer; supply uses the highest price plus the buffer.

### Target candidates

- `OPPOSING_LIQUIDITY`: the next valid opposing liquidity level with a configured
  tick offset that reduces target distance.
- `FIXED_3R`: target at three times initial stop risk.
- `FIXED_4R`: target at four times initial stop risk.

Every candidate includes source prices, tick size, buffer/offset, risk distance,
reward distance, and resulting R multiple. If no opposing level exists, that
candidate is explicitly unavailable.

No paper order may be proposed until one stop policy and one target policy are
explicitly reviewed, bound to the symbol profile, and included in its settings
hash.

## Event and storage contract

A `3.2` event must include, at minimum:

- all existing contract identifiers and idempotency identifiers;
- normalized symbol, exact `ticker_id`, feed, timeframe, and tick size;
- profile ID, bias, session binding, settings hash, and reviewed-state flags;
- immutable zone geometry and origin/departure facts;
- liquidity cohort, candidate state, retap state, distance diagnostic, and both
  BOS facts;
- engagement and invalidation facts;
- entry model, body ratio, wick sizes, BOC reference, and ordering evidence;
- every stop/target candidate and availability reason;
- event role, setup ID, producer instance ID, producer sequence, and event time;
- shadow/paper eligibility plus all rejection reasons.

The observation edge validates `3.2` independently of `3.1`. Unknown enum
values, missing required facts, inconsistent arithmetic, an unreviewed settings
hash, or a forbidden one-candle paper proposal returns a precise validation
error and creates no economic intent.

Accepted observations are stored idempotently. Duplicate event IDs or repeated
producer sequences may add transport diagnostics but cannot create duplicate
setup transitions or paper opens.

## Failure behavior

- `401 Unauthorized` means credential mismatch and is never treated as a
  strategy rejection.
- `422 Unprocessable Content` means schema or rule-contract validation failed;
  its machine-readable rejection reason must be observable.
- Pine cannot safely retry economic events. Monitoring identifies delivery
  failures and the setup remains non-executable until a valid receipt exists.
- Any contract, hash, arithmetic, order, or state ambiguity fails closed.
- Existing `3.1` alerts cannot authorize a `3.2` paper intent.

## Runtime and chart-object constraints

The Pine implementation must use bounded arrays and bounded candidate scans.
It must not add full-history nested scans per active zone. Lines, labels, boxes,
and retained terminal states must remain below TradingView limits through
explicit caps and deterministic eviction of terminal display objects.

The profile must complete on every requested 5-minute chart without runtime
error `RE10110` or equivalent execution timeout.

## Validation plan

### Static and wire tests

- Pine static tests for version identifiers, bounded scans, cohort isolation,
  formulas, state transitions, and paper guards.
- Observation-edge tests for every `3.2` required field, enum, arithmetic rule,
  rejection reason, and `3.1` compatibility boundary.
- Idempotency tests proving duplicate receipts cannot create duplicate economic
  opens.

### Deterministic chart fixtures

The fixture set must contain accepted and rejected cases for:

- one-candle and two-plus-candle liquidity;
- zone retap before BOS;
- wick-BOS without close-BOS and later close-BOS;
- consumed liquidity and chronological replacement;
- strong and weak directional candles on both sides;
- wick-balance failure;
- valid later-bar BOC and invalid same-bar historical ordering;
- close-inside-zone invalidation;
- all four bias modes;
- session inclusion and exclusion facts;
- both stop calculations and all target calculations;
- unavailable opposing-liquidity target;
- duplicate event delivery.

Annotated screenshots from the public videos and user-supplied TradingView cases
form the expected-result manifest. Each fixture records why the public example
supports the expectation and whether it belongs to strict, Quentin-bot, or
one-candle experimental behavior.

### Forward shadow gate

Before paper canary review, the `3.2` profile must satisfy all of:

- at least 10 trading days of forward shadow observation;
- at least 30 completed setups across at least 6 of the 9 requested symbols;
- all reviewed deterministic fixtures pass;
- zero Pine runtime timeouts on the requested charts;
- zero new `401` or `422` deliveries from recreated `3.2` alerts;
- zero duplicate economic opens;
- separate performance/confusion reporting for `ONE_CANDLE`, `TWO_PLUS`,
  wick-BOS, and close-BOS cohorts;
- explicit review and binding of bias, session, stop, and target policy.

Meeting the gate does not automatically enable paper trading. It creates a
reviewable promotion proposal.

### Paper canary

After explicit user approval, start with `GBPJPY` because its current transport
path has already demonstrated healthy natural receipts. Run one symbol in
`PAPER_ONLY` for at least 5 trading days with:

- the promotion binding set to the reviewed profile hash;
- the global kill switch available;
- `ONE_CANDLE` still shadow-only;
- no broker or real-money connection;
- every intent and terminal outcome reconciled against chart evidence.

The other eight symbols remain shadow-only until the canary review passes.

## Safety and rollout controls

- `canonical_paper_enabled` defaults to `false`.
- `promotion_binding` defaults to `null`.
- the paper kill switch defaults to on/blocked;
- no event can bypass validator, reviewed hash, bias, session, risk-policy, or
  cohort guards;
- transport health alone never grants strategy eligibility;
- profitability claims and win-rate claims are not acceptance criteria;
- no real broker execution is authorized by this design.

Rollback is immediate: disable or delete `3.2` TradingView alerts and remove the
profile promotion binding. Because `3.1` is not mutated, rollback does not depend
on restoring the current production alert contract.

## Acceptance criteria

1. Existing `3.1` tests and alerts behave exactly as before.
2. Every `3.2` setup is traceable through the ordered state machine with explicit
   facts and rejection reasons.
3. Wick-BOS and close-BOS are both recorded and never conflated.
4. `ONE_CANDLE` and `TWO_PLUS` results are independently measurable, and
   `ONE_CANDLE` cannot create a paper intent.
5. Strong directional entry and weak-candle BOC fallback follow the exact body,
   wick, close, and ordering rules in this specification.
6. A close inside or through the zone terminates the setup before entry.
7. Consumed liquidity replacement is chronological, zone-specific, and
   auditable.
8. Bias, session, stop, and target decisions are explicit hashed bindings rather
   than hidden defaults.
9. Invalid, unauthorized, duplicate, or ambiguous events fail closed without an
   economic action.
10. The forward shadow gate is met and explicitly reviewed before a single
    `PAPER_ONLY` canary is enabled.
11. No real-money or broker-connected execution path is introduced.

## Out of scope

- Reverse engineering private code, protected indicators, or undisclosed EA
  settings.
- Claiming 100% parity with the creator's proprietary implementation.
- Automatic directional bias in `3.2.0`.
- Thirty-minute or multi-timeframe execution.
- Manual click-to-create zones in TradingView.
- Replacing the existing `RawZone` engine in the first slice.
- Promoting the one-candle cohort to paper trading.
- Choosing a stop/target model without reviewed evidence and explicit binding.
- Real-money trading, broker API execution, or profit guarantees.
