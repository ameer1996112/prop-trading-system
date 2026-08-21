# V3 Paper Signal Authority Migration Design

**Date:** 2026-08-21

**Status:** Approved for implementation planning

**Base commit:** `483c044`

**Authority scope:** local validation and broker-free paper/shadow evidence only

## Summary

Make `prop-trading-system` the canonical home of the RD five-minute signal
contract. TradingView Pine detects and reports zones, liquidity, and the three
entry models. The observation edge authenticates, validates, persists, and
arbitrates those observations into paper-only intents. No component in this
milestone may create a broker command, connect an account, or enable demo or
live execution.

The current `liquidity-supply-and-demand` Pine strategy becomes a clearly
labelled research/backtesting implementation. It is not a second live signal
authority. Its audited risk and metadata defects are corrected in a separately
reviewable workstream after the V3 contract is stable.

This design supersedes any earlier assumption that the monolithic legacy Pine
strategy should remain a supported live alternative. It also supersedes the
paper-promotion portion of the 2026-07-30 one-candle experiment for this
milestone: one-candle observations may be measured, but remain shadow-only.

## Why this architecture

The legacy strategy evaluates confirmed five-minute OHLC and collapses entry
models through fixed precedence. It cannot truthfully reproduce ordered
intrabar BOC and HTF flip lifecycles. It also mixes detection, position sizing,
orders, exits, webhook emission, display, and research metadata in one Pine
script.

V3 already has the safer boundary:

- Pine is the sole setup and entry-event creator;
- BOC, DIR_CLOSE, and HTF_FLIP remain independent candidates;
- realtime exact evidence is distinguished from historical replayable evidence;
- the edge validates and arbitrates observations;
- the producer is explicitly `PAPER_ONLY`; and
- broker and account authority are absent.

The migration therefore promotes V3's evidence architecture instead of
converting V3 into another monolithic TradingView `strategy()`.

## Goals

- Freeze one internally consistent V3.1 strategy and rule identity.
- Complete standard-plus-accuracy zone materialization without merging their
  lifecycles.
- Preserve all three entry models and same-event co-triggers independently.
- Keep one-candle liquidity default-off and shadow-only when enabled.
- Emit bounded, authenticated observation and diagnostic paper-proposal
  envelopes without broker authority.
- Validate, deduplicate, store, and paper-arbitrate observations fail-closed.
- Separate the diagnostic LAB Pine from a minimal release producer without
  allowing detector drift.
- Preserve the user's existing dirty checkout and unrelated work.
- Make the legacy Pine's research-only role explicit and later correct its
  audited research defects without reconnecting it to live delivery.

## Non-goals

- Demo or live MT5 execution.
- Broker accounts, orders, positions, commands, or execution credentials.
- Cloud deployment or TradingView alert creation in this milestone.
- Profitability claims, parameter optimization, or prop-challenge guarantees.
- Reimplementing the RD detector in Python, TypeScript, Cloudflare, or MT5.
- Promoting discretionary five-minute BOC or one-candle liquidity to an
  executable cohort.
- Silently changing an existing TradingView alert snapshot.
- Cleaning or absorbing unrelated changes from the current dirty checkout.

## Repository and workstream boundaries

### Workstream A: canonical V3 signal authority

`prop-trading-system` owns:

- the V3.1 rule contract and reviewed source claims;
- LAB and release Pine producers;
- observation and paper-proposal wire contracts;
- observation-edge validation, storage, and paper arbitration;
- deterministic fixtures, parity tests, and acceptance evidence.

This is the first implementation workstream and must become green before the
legacy strategy is modified.

### Workstream B: legacy research hardening

`liquidity-supply-and-demand` remains available for comparative backtesting and
research. A separate commit series will:

- mark the Pine and relevant documentation as research/backtest-only;
- remove its live webhook emission surface and reject its legacy strategy
  identity as live authority;
- retain `risk_per_trade_pct` as the one risk input, remove the contradictory
  `risk_pct` input, and use `strategy.equity` consistently in long and short
  sizing, research metadata, and the risk table;
- block new research entries when simulated equity is unavailable or nonpositive;
- remove the false claim that a confirmed-bar backtest enforces an exact
  two-minute intrabar hold, replace it with `min_discretionary_hold_bars`, and
  apply that gate only to discretionary/time-based closes while protective
  SL/TP orders remain active;
- default one-candle liquidity off;
- map `BREAK_CANDLE` consistently to BOC in research metadata;
- remove the stale hard-coded news input and calendar; and
- repair or retire stale Pine tests and missing-script references.

Workstream B cannot add live authority. Its behavior changes require their own
red-green tests and a focused review after Workstream A is accepted.

## Canonical V3.1 identity

All active V3 components use one tuple:

```text
schema_version = 3.1
strategy_id = rd_liquidity_sd_5m_v1
strategy_version = 3.1.0-contract3
rule_contract_version = 3.1.0
execution_mode = PAPER_ONLY
arbitration_policy = rd-entry-arbitration-v3
```

The tuple must match in:

- Pine constants;
- the machine-readable rule-contract JSON;
- rule-contract documentation;
- JSON schemas and positive vectors;
- TypeScript runtime validators;
- persistence compatibility rules;
- tests and runbooks.

V3.0 records may remain readable through an explicit legacy parser. They never
fall through to V3.1 validation, acquire missing V3.1 fields, or become a V3.1
paper intent by inference.

Reviewed detector and settings hashes are derived from canonical bytes with a
documented preimage. `UNREVIEWED`, missing, stale, or mismatched hashes preserve
the observation for diagnostics when safe, but cannot create a paper-eligible
selection.

## Zone geometry and lifecycle

A confirmed formation always creates a `STANDARD` zone using the complete
origin-candle range required by the rule contract.

If the same formation satisfies the accuracy-bound predicate, it additionally
creates an `ACCURACY` zone with the refined body boundary. Accuracy geometry is
not a replacement for the standard rectangle.

Each variant has:

- a distinct stable zone ID;
- an explicit shared formation/provenance ID;
- immutable frozen bounds;
- independent fresh, tapped, invalidated, liquidity, setup, and entry-attempt
  lifecycle state; and
- deterministic display and retention behavior.

The standard zone is the event's primary reference for compatibility. Tests
must prove that adding an accuracy sibling does not mutate or suppress the
standard zone's strict eligibility. When both variants yield candidates, they
remain separate setup identities and are not deduplicated merely because their
ranges overlap.

Tapped zones are visible by default in the LAB clean view through their touch
endpoint so operators can audit lifecycle transitions. Release-producer display
is minimal and does not affect detector state.

## Liquidity cohorts

Strict normal evidence requires `TWO_PLUS_CANDLES`.

`Enable one-candle liquidity` defaults to `false`. When enabled, a qualifying
one-candle structure may be observed and stored with cohort `ONE_CANDLE`, but it
is always:

```text
action = SHADOW_ONLY
reason = ONE_CANDLE_EXPERIMENT_NOT_PROMOTED
```

It cannot win paper arbitration, become a diagnostic paper proposal, or be
normalized to the strict cohort. All other structural, same-leg, break, sweep,
distance, and chronology requirements continue to apply.

Changing the flag changes the reviewed settings identity and requires a new
TradingView alert snapshot in any later deployment milestone.

## Entry attempt state and chronology

Zone engagement creates one bounded attempt state. First touch is
`ZONE_ENGAGED`, not an entry.

The attempt evaluates independently:

- `BOC`: ordered intrabar break of the immutable engagement reference candle;
- `DIR_CLOSE`: confirmed five-minute directional close satisfying the frozen
  zone boundary; and
- `HTF_FLIP`: ordered contact and open-recross on a newly opened 15m, 30m, or
  60m candle.

Candidate creation does not use a model-priority `if/else` chain. Candidates
retain semantic event epoch, producer sequence, trigger ticks, proof plane,
fidelity, source candle, and model-specific evidence. Same-event candidates are
preserved as co-triggers.

Realtime BOC and HTF_FLIP can be exact only when Pine observed the required
ordered tick lifecycle continuously. They are tagged
`LIVE_EXACT_NON_REPLAYABLE`. Reloaded historical bars cannot recreate them.
Incomplete or range-only history becomes unresolved or shadow evidence.

DIR_CLOSE is selected only from a confirmed five-minute bar and is replayable
when its source candle and timing evidence are complete.

## Pine producer surfaces

### LAB producer

`SND_RD_5M_V3_THREE_ENTRY_LAB.pine` remains the diagnostic authoring surface.
It contains full drawings, lifecycle inspection, audit labels, and bounded
debug information.

### Release producer

A generated `SND_RD_5M_V3_RELEASE.pine` contains the same detector, lifecycle,
candidate, and payload semantics with only bounded operational diagnostics. It
is still an `indicator()` and remains `PAPER_ONLY`.

The LAB script is the single authoring source. Diagnostic-only sections are
bounded by paired `// @lab-only-begin <name>` and
`// @lab-only-end <name>` comments. A deterministic Python generator validates
properly nested, uniquely named pairs and removes only those complete sections
to produce the release script. Missing, duplicate, crossed, or unclosed markers
fail generation. Everything outside the markers is copied byte-for-byte. CI
regenerates the release file and fails on a diff, and a static test hashes the
protected detector/event bytes from both variants.

Neither producer contains `strategy.entry`, `strategy.exit`, broker fields,
account fields, order fields, command fields, or live-execution modes.

## Observation and diagnostic proposal flow

The data flow is:

```text
TradingView V3.1 Pine
    -> authenticated bounded observation envelope
    -> strict V3.1 ingress validation
    -> idempotent observation and candidate persistence
    -> chronology and common-rule verification
    -> paper-only arbitration
    -> immutable paper intent or typed rejection
```

Pine may emit two logically independent surfaces:

1. the complete V3.1 observation bundle; and
2. a diagnostic paper proposal for an exact Pine-side selection.

The diagnostic proposal is evidence, not authority. The edge recomputes its
eligibility and selection from the complete observation. A missing, conflicting,
or invalid proposal cannot suppress valid stored observations and cannot bypass
edge arbitration.

Every envelope includes a stable event ID, producer generation/instance and
sequence as defined by the active paper contract, exact strategy identity,
symbol/feed/tick-size identity, detector/settings hashes, observed time,
candidate facts, and bounded setup facts. Unknown fields fail strict validation
for that version.

Ingress is idempotent. Repeated identical events return the recorded result;
reused identities with different bytes are quarantined as conflicts. Version
validation never falls back to another parser after failure.

## Fail-closed behavior

No paper intent is created when any required condition is missing or invalid,
including:

- unsafe or missing producer credentials;
- oversized or malformed envelopes;
- unknown schema, strategy, rule, or policy versions;
- unsupported symbol/feed/tick-size bindings;
- missing, stale, or unreviewed hashes;
- invalid or non-tick-aligned zone, entry, stop, or target geometry;
- impossible event ordering or timestamps;
- missing exact chronology for an aggressive model;
- historical recreation of a realtime-only event;
- one-candle or discretionary BOC promotion attempts;
- sequence conflicts or identity/body conflicts; or
- an execution mode other than `PAPER_ONLY`.

Safe rejected observations are retained with typed reasons. Secret-bearing or
structurally unsafe input is rejected before persistence where required by the
credential boundary. Logs and diagnostics must not expose credentials.

## Dirty-worktree isolation

The existing `prop-trading-system` checkout contains extensive modified and
untracked user work. It is evidence to inventory, not an implementation base to
overwrite.

Implementation uses an isolated `codex/` worktree from a recorded commit. Before
porting any relevant uncommitted Pine, contract, test, or observation-edge hunk,
the plan records:

- source path and source commit;
- exact diff or digest;
- why the hunk is in scope;
- whether it is adopted, replaced, or left untouched; and
- the test that proves the adopted behavior.

No unrelated dirty hunk is staged or committed. The original checkout remains
unchanged.

## Testing strategy

Implementation is test-driven and records the red-green sequence.

### Pine static contracts

- standard geometry always materializes;
- accuracy geometry is an independent sibling;
- both demand and supply confirmation paths create variants correctly;
- tapped lifecycle visibility is correct in LAB clean view;
- one-candle defaults off and remains shadow-only;
- all three entry models are independent and co-triggers are preserved;
- realtime versus confirmed proof planes cannot be conflated;
- observation and proposal emitters are independent and bounded;
- LAB/release protected semantics cannot drift;
- no broker, order, account, command, or `strategy.*` execution surface exists.

### Machine contract and edge tests

- one canonical V3.1 positive vector passes every parser;
- wrong version, feed, tick size, hash, geometry, chronology, cohort, fidelity,
  action, mode, and unknown fields fail closed;
- V3.0 and V3.1 remain explicitly isolated;
- duplicate, retry, out-of-order, gap, and body-conflict cases are deterministic;
- proposal disagreement cannot override observation-derived arbitration;
- one-candle and discretionary BOC never create paper intents;
- persisted rejection reasons and candidate evidence are complete.

### TradingView acceptance

Both Pine variants must:

- compile with zero errors;
- add to a five-minute chart successfully;
- preserve confirmed-bar results across reload;
- avoid creating historical BOC/flip events from OHLC range alone;
- demonstrate live ordered BOC and HTF_FLIP evidence through recorded tick
  scenarios;
- preserve same-event co-triggers; and
- remain within Pine object, history, execution, and alert payload limits.

TradingView acceptance produces evidence artifacts; it does not create or
modify persistent production alerts in this milestone.

### Legacy research tests

Workstream B begins only after V3 acceptance. Its tests prove truthful risk
sizing and display, research-resolution hold semantics, strict liquidity by
default, correct BOC metadata, absence of a stale active news claim, and an
explicit no-live-authority boundary.

## Acceptance criteria

Workstream A is complete only when:

- all targeted Pine, Python, TypeScript, schema, vector, type-check, and build
  checks pass;
- V3.1 identity is identical across every active artifact;
- LAB and release producer protected semantics are proven equivalent;
- standard and accuracy zones coexist correctly;
- exact/replayable chronology rules pass positive and negative evidence tests;
- the edge produces only paper intents and typed rejections;
- static capability scans find no broker or live-execution authority;
- TradingView compile, reload, and recorded tick evidence pass; and
- the original dirty checkout is unchanged.

Workstream B is complete only when its focused tests pass and the legacy Pine is
unambiguously research/backtest-only. Completion of either workstream does not
authorize deployment, alert recreation, demo trading, or live trading.

## Rollback

Work occurs on isolated branches and creates no deployment or alert mutation.
Rollback is therefore repository-only: stop using the candidate branch and
return to the reviewed base commit. No database, Cloudflare, TradingView alert,
MT5, broker, or account rollback is required.

## Follow-up boundary

After both workstreams are reviewed, a separate design and approval are required
for any deployed paper-alert rollout. Demo MT5 execution requires another
independent design, evidence gate, and explicit owner approval. Live or prop-firm
execution is not implied by successful paper validation.
