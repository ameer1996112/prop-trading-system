# One-Candle Liquidity Experiment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in one-candle liquidity cohort, simulate its entry outcomes without economic authorization, and report comparable win-rate metrics by cohort, entry model, and symbol.

**Architecture:** Pine classifies the selected liquidity level as `ONE_CANDLE` or `TWO_PLUS_CANDLES` and emits the immutable cohort with each V3 setup. The edge validates and stores the cohort, routes one-candle selections only into the existing shadow-position simulator, and aggregates completed shadow and paper outcomes through a dedicated metrics endpoint. The operations console renders the cohort comparison; no one-candle path can create an economically authorized paper intent or reach a live/broker boundary.

**Tech Stack:** Pine Script v6, TypeScript 5.9, Cloudflare Workers and D1, Vitest 4, Next.js 16, React 19, Testing Library, pytest static contract tests.

## Global Constraints

- `Enable one-candle liquidity` defaults to `false`.
- Flag off must preserve the current two-candle detector exactly.
- Flag on still requires pivot, zone side, formation-after-origin, own-extreme break, later sweep, event order, and distance checks.
- The closest valid candidate wins across both cohorts when the flag is on.
- Cohort values are exactly `ONE_CANDLE` and `TWO_PLUS_CANDLES`.
- One-candle entries are simulated only in shadow storage and never create paper-account intents.
- Broker and live execution remain disabled and reject `ONE_CANDLE`.
- The existing entry models remain exactly `BOC`, `DIR_CLOSE`, and `HTF_FLIP`.
- Win rate is `wins / (wins + losses)`; open and ambiguous outcomes are excluded and the resolved sample size is displayed.
- Existing uncommitted edits to `SND_RD_5M_V3_THREE_ENTRY_LAB.pine` and `test_rd_three_entry_pine.py` implement the separate liquidity-line endpoint fix and must be preserved.

---

## File Structure

- `scripts/pinescript/SND_RD_5M_V3_THREE_ENTRY_LAB.pine` — owns the user flag, liquidity-candidate classification, selected cohort freeze, and payload serialization.
- `tests/static/test_rd_three_entry_pine.py` — enforces Pine source invariants, including strict-default compatibility and cohort serialization.
- `apps/observation-edge/src/rd-entry-domain-v3.ts` — defines `LiquidityCohortV3` and carries it through authoritative V3 setup facts.
- `apps/observation-edge/src/rd-entry-wire-v3.ts` — parses legacy 3.0 payloads and the new 3.1 cohort-aware payload.
- `apps/observation-edge/src/rd-entry-arbitrator-v3.ts` — keeps one-candle selections shadow-only.
- `apps/observation-edge/src/rd-entry-store-v3.ts` — stores cohort identity and opens/settles experimental shadow positions.
- `apps/observation-edge/src/rd-entry-queries-v3.ts` — persists cohort fields and exposes decision/metric queries.
- `apps/observation-edge/src/rd-entry-cohort-metrics.ts` — validates and assembles cohort metric rows independently of HTTP rendering.
- `apps/observation-edge/src/index.ts` — exposes `GET /api/v1/rd-entry-cohort-metrics`.
- `apps/observation-edge/migrations/0028_observation_entry_v3_liquidity_cohorts.sql` — adds backward-compatible cohort columns and indexes.
- `apps/operations-console/src/lib/entry-cohort-metrics.ts` — strictly parses the metrics response.
- `apps/operations-console/src/components/LiquidityCohortPanel.tsx` — renders cohort win-rate comparison.
- Existing V3 wire, store, worker, and console test files receive focused coverage; no unrelated refactor is included.

### Task 1: Pine flag, candidate classification, and frozen cohort

**Files:**
- Modify: `scripts/pinescript/SND_RD_5M_V3_THREE_ENTRY_LAB.pine`
- Modify: `tests/static/test_rd_three_entry_pine.py`

**Interfaces:**
- Produces: input `enableOneCandleLiquidity: bool`.
- Produces: cohort constants `LIQUIDITY_COHORT_ONE` and `LIQUIDITY_COHORT_TWO_PLUS`.
- Produces: helper `minimumLiquidityOppositeCandles() -> int`.
- Produces: `LiquidityLevel.cohort`, `RawZone.liquidityCohort`, and `EntryCore.liquidityCohort`.
- Preserves: `liquidityDrawingRightBar()` from the existing uncommitted visual fix.

- [ ] **Step 1: Add failing static tests for the opt-in detector**

Add:

```python
def test_pine_v3_one_candle_liquidity_is_opt_in_and_strict_by_default() -> None:
    pine = source()
    assert (
        'enableOneCandleLiquidity = input.bool(false, '
        '"Enable one-candle liquidity", group = "Liquidity")'
    ) in pine
    assert (
        "minimumLiquidityOppositeCandles() =>\n"
        "    enableOneCandleLiquidity ? 1 : 2"
    ) in pine
    pivot = section(pine, "confirmedLiquidityPivot(", "appendConfirmedLiquidityPivot(")
    assert "oppositeCandleCount >= minimumLiquidityOppositeCandles()" in pivot


def test_pine_v3_freezes_and_serializes_liquidity_cohort() -> None:
    pine = source()
    for field in (
        "string cohort",
        "string liquidityCohort",
    ):
        assert field in pine
    assert 'const string LIQUIDITY_COHORT_ONE = "ONE_CANDLE"' in pine
    assert 'const string LIQUIDITY_COHORT_TWO_PLUS = "TWO_PLUS_CANDLES"' in pine
    assert 'const string ENTRY_SCHEMA_VERSION = "3.1"' in pine
    assert 'const string ENTRY_STRATEGY_VERSION = "3.1.0-contract3"' in pine
    assert 'const string ENTRY_RULE_CONTRACT_VERSION = "3.1.0"' in pine
    assert (
        'level.cohort := oppositeCandleCount == 1 '
        '? LIQUIDITY_COHORT_ONE : LIQUIDITY_COHORT_TWO_PLUS'
    ) in pine
    assert 'attempt.core.liquidityCohort := zone.liquidityCohort' in pine
    assert '"\\"liquidity_cohort\\":" + jsonString(attempt.core.liquidityCohort)' in pine
    assert '"\\"one_candle_enabled\\":" + str.tostring(enableOneCandleLiquidity)' in pine
    assert (
        "attempt.core.ruleLiqOneCandleException := "
        "attempt.core.ruleLiqNormalTwoOppositeCandles or "
        "(enableOneCandleLiquidity and oppositeCandleCount == 1)"
    ) in pine
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
pytest -q \
  tests/static/test_rd_three_entry_pine.py::test_pine_v3_one_candle_liquidity_is_opt_in_and_strict_by_default \
  tests/static/test_rd_three_entry_pine.py::test_pine_v3_freezes_and_serializes_liquidity_cohort
```

Expected: both tests fail because the flag and cohort fields do not exist.

- [ ] **Step 3: Implement the minimal Pine classification**

Add these declarations:

```pine
const string LIQUIDITY_COHORT_ONE = "ONE_CANDLE"
const string LIQUIDITY_COHORT_TWO_PLUS = "TWO_PLUS_CANDLES"
const string ENTRY_SCHEMA_VERSION = "3.1"
const string ENTRY_STRATEGY_VERSION = "3.1.0-contract3"
const string ENTRY_RULE_CONTRACT_VERSION = "3.1.0"

enableOneCandleLiquidity = input.bool(
  false,
  "Enable one-candle liquidity",
  group = "Liquidity"
)

minimumLiquidityOppositeCandles() =>
    enableOneCandleLiquidity ? 1 : 2
```

Add `string cohort` to `LiquidityLevel`, add `string liquidityCohort` to
`RawZone` and `EntryCore`, initialize them to `""`, and classify new levels:

```pine
level.cohort := oppositeCandleCount == 1
  ? LIQUIDITY_COHORT_ONE
  : LIQUIDITY_COHORT_TWO_PLUS
```

Change only the confirmation threshold:

```pine
confirmed := oppositeCandleCount >= minimumLiquidityOppositeCandles()
```

When a primary is selected, copy `primary.cohort` to the zone. When an entry
attempt is created, freeze the zone cohort on the attempt. Serialize both
fields inside each setup object:

```pine
"\\"liquidity_cohort\\":" + jsonString(attempt.core.liquidityCohort) + ","
+"\\"one_candle_enabled\\":" + str.tostring(enableOneCandleLiquidity) + ","
```

Keep the normal rule exact and make the exception explicit:

```pine
attempt.core.ruleLiqNormalTwoOppositeCandles := oppositeCandleCount >= 2
attempt.core.ruleLiqOneCandleException :=
  attempt.core.ruleLiqNormalTwoOppositeCandles or
  (enableOneCandleLiquidity and oppositeCandleCount == 1)
```

For a selected `ONE_CANDLE`, serialize `common_fidelity` as `DISCRETIONARY`
when the remaining common rules, including calibrated distance, pass; serialize
it as `UNRESOLVED` when the market has no calibrated distance profile. Never
serialize `EXACT` for `ONE_CANDLE`. Normal two-plus liquidity retains the
current exact/common-rule calculation.

Do not modify `liquidityRanksCloser`; this preserves closest-valid arbitration.

- [ ] **Step 4: Run the Pine static suite and verify GREEN**

Run:

```bash
pytest -q tests/static/test_rd_three_entry_pine.py
```

Expected: all tests pass, including the pre-existing liquidity-line endpoint test.

- [ ] **Step 5: Commit the Pine detector slice**

```bash
git add scripts/pinescript/SND_RD_5M_V3_THREE_ENTRY_LAB.pine tests/static/test_rd_three_entry_pine.py
git commit -m "feat: add one-candle liquidity cohort flag"
```

### Task 2: Versioned V3.1 wire contract and fail-closed domain rules

**Files:**
- Modify: `apps/observation-edge/src/rd-entry-domain-v3.ts`
- Modify: `apps/observation-edge/src/rd-entry-wire-v3.ts`
- Modify: `apps/observation-edge/src/rd-entry-arbitrator-v3.ts`
- Modify: `apps/observation-edge/src/types.ts`
- Modify: `apps/observation-edge/test/rd-entry-wire-v3.test.ts`
- Modify: `apps/observation-edge/test/rd-entry-pine-v3-parity.test.ts`

**Interfaces:**
- Produces: `export type LiquidityCohortV3 = "ONE_CANDLE" | "TWO_PLUS_CANDLES"`.
- Extends: `SetupEntryFactsV3` with `liquidity_cohort` and `one_candle_enabled`.
- Accepts: legacy `3.0 / 3.0.0-contract3 / 3.0.0`.
- Accepts: cohort-aware `3.1 / 3.1.0-contract3 / 3.1.0`.
- Guarantees: `ONE_CANDLE` implies `one_candle_enabled === true` and
  `common_fidelity` is never `EXACT`.
- Guarantees: one-candle arbitration action is `SHADOW_ONLY`, never `PAPER_ELIGIBLE`.

- [ ] **Step 1: Add failing wire tests**

Create a `oneCandlePayload()` fixture by cloning the existing valid payload and setting:

```ts
payload.schema_version = "3.1";
payload.strategy_version = "3.1.0-contract3";
payload.rule_contract_version = "3.1.0";
setup.liquidity_cohort = "ONE_CANDLE";
setup.one_candle_enabled = true;
setup.common_fidelity = "DISCRETIONARY";
rule("LIQ_NORMAL_TWO_OPPOSITE_CANDLES").passed = false;
rule("LIQ_ONE_CANDLE_EXCEPTION").passed = true;
rule("LIQ_INTERNAL_REBREAK").passed = false;
selection.action = "SHADOW_ONLY";
selection.reason = "NO_EXACT_CANDIDATE";
```

Add tests asserting:

```ts
it("accepts tagged one-candle V3.1 payloads as shadow-only", async () => {
  const result = await validateEntryV3Payload(oneCandlePayload());
  expect(result.entryBundles[0]!.setup).toMatchObject({
    liquidity_cohort: "ONE_CANDLE",
    one_candle_enabled: true,
    common_fidelity: "DISCRETIONARY",
  });
  expect(result.entryBundles[0]!.evaluation.selection.action).toBe("SHADOW_ONLY");
});

it.each([
  ["disabled flag", (setup) => { setup.one_candle_enabled = false; }],
  ["exact fidelity", (setup) => { setup.common_fidelity = "EXACT"; }],
  ["paper action", (_setup, selection) => { selection.action = "PAPER_ELIGIBLE"; }],
])("rejects unsafe one-candle payload: %s", async (_name, mutate) => {
  const payload = oneCandlePayload();
  mutate(setupOf(payload), selectionOf(payload));
  await expect(validateEntryV3Payload(payload)).rejects.toThrow();
});
```

Keep an explicit regression test proving an unchanged 3.0 fixture still validates
and is normalized to `TWO_PLUS_CANDLES` with `one_candle_enabled: false`.

- [ ] **Step 2: Run the wire and parity tests and verify RED**

Run:

```bash
npm --prefix apps/observation-edge test -- \
  rd-entry-wire-v3.test.ts rd-entry-pine-v3-parity.test.ts
```

Expected: failures for unknown setup keys and unsupported 3.1 versions.

- [ ] **Step 3: Add cohort-aware domain types and validators**

In `rd-entry-domain-v3.ts`:

```ts
export type LiquidityCohortV3 =
  | "ONE_CANDLE"
  | "TWO_PLUS_CANDLES";

export interface SetupEntryFactsV3 {
  // existing fields
  readonly liquidity_cohort: LiquidityCohortV3;
  readonly one_candle_enabled: boolean;
}
```

Add:

```ts
export function validateLiquidityCohortV3(
  setup: SetupEntryFactsV3,
): void {
  if (
    (setup.liquidity_cohort === "ONE_CANDLE" &&
      (!setup.one_candle_enabled || setup.common_fidelity === "EXACT")) ||
    (setup.liquidity_cohort === "TWO_PLUS_CANDLES" &&
      setup.common_fidelity === "DISCRETIONARY")
  ) {
    throw new TypeError("invalid liquidity cohort");
  }
}
```

Invoke it from `validateEntryArbitrationInputV3` and every setup validation path.
Copy both fields through `evaluateWithoutOpenedSeed`.

- [ ] **Step 4: Parse 3.0 and 3.1 without weakening legacy validation**

Keep the existing 3.0 exact key list. Add `SETUP_KEYS_V31` containing
`liquidity_cohort` and `one_candle_enabled`.

Normalize legacy 3.0 setup facts only after its rule vector proves
`LIQ_NORMAL_TWO_OPPOSITE_CANDLES`; otherwise reject it. The normalized fields
are:

```ts
{
  liquidity_cohort: "TWO_PLUS_CANDLES",
  one_candle_enabled: false,
}
```

For 3.1 require the new fields and exact version tuple. Reject any other version
combination. Add a one-candle common-rule validator that always permits these
two experimental failures:

```ts
const ONE_CANDLE_EXPECTED_FAILED_RULES = new Set([
  "LIQ_INTERNAL_REBREAK",
  "LIQ_NORMAL_TWO_OPPOSITE_CANDLES",
]);
```

`LIQ_ONE_CANDLE_EXCEPTION` must pass. When `common_fidelity` is
`DISCRETIONARY`, all remaining rules must pass. When it is `UNRESOLVED`,
`LIQ_DISTANCE_INFLUENCES_ZONE` may also fail for a market with no calibrated
distance profile; all structural, sweep, and event-order rules must still
pass. Force canonical one-candle selection action to `SHADOW_ONLY`.

- [ ] **Step 5: Add an explicit arbitrator safety guard**

Before returning any `PAPER_ELIGIBLE` selection:

```ts
if (input.liquidity_cohort === "ONE_CANDLE") {
  return selection(
    setupId,
    revision,
    evaluatedAtEpoch,
    candidateIds,
    null,
    "NO_EXACT_CANDIDATE",
    "SHADOW_ONLY",
  );
}
```

Also assert in validation that an opened-selection seed can never be supplied
for `ONE_CANDLE`.

- [ ] **Step 6: Run tests and type checking and verify GREEN**

Run:

```bash
npm --prefix apps/observation-edge test -- \
  rd-entry-wire-v3.test.ts rd-entry-pine-v3-parity.test.ts
npm --prefix apps/observation-edge run typecheck
```

Expected: both suites and type checking pass.

- [ ] **Step 7: Commit the wire contract slice**

```bash
git add \
  apps/observation-edge/src/rd-entry-domain-v3.ts \
  apps/observation-edge/src/rd-entry-wire-v3.ts \
  apps/observation-edge/src/rd-entry-arbitrator-v3.ts \
  apps/observation-edge/src/types.ts \
  apps/observation-edge/test/rd-entry-wire-v3.test.ts \
  apps/observation-edge/test/rd-entry-pine-v3-parity.test.ts
git commit -m "feat: validate one-candle V3 experiment"
```

### Task 3: Backward-compatible cohort persistence

**Files:**
- Create: `apps/observation-edge/migrations/0028_observation_entry_v3_liquidity_cohorts.sql`
- Modify: `apps/observation-edge/src/rd-entry-queries-v3.ts`
- Modify: `apps/observation-edge/src/rd-entry-store-v3.ts`
- Modify: `apps/observation-edge/test/rd-entry-store-v3.test.ts`
- Modify: `apps/observation-edge/test/worker.test.ts`

**Interfaces:**
- Adds: `observation_entry_v3_selections.liquidity_cohort`.
- Adds: `observation_entry_v3_selections.one_candle_enabled`.
- Adds: the same immutable fields to `observation_entry_v3_shadow_positions`.
- Legacy rows default to `TWO_PLUS_CANDLES` and `0`.
- V3.1 receipts and events accept the exact new version tuple.

- [ ] **Step 1: Add failing store tests**

Add a one-candle fixture and assert:

```ts
expect(insertedSelection).toMatchObject({
  liquidity_cohort: "ONE_CANDLE",
  one_candle_enabled: 1,
  action: "SHADOW_ONLY",
});
expect(insertedPaperLinks).toHaveLength(0);
expect(insertedShadowPosition).toMatchObject({
  liquidity_cohort: "ONE_CANDLE",
  one_candle_enabled: 1,
  state: "OPEN",
});
```

Add a migration assertion in `worker.test.ts` that legacy selections read as
`TWO_PLUS_CANDLES / 0` and the receipt/event version checks include 3.1.

- [ ] **Step 2: Run store tests and verify RED**

Run:

```bash
npm --prefix apps/observation-edge test -- \
  rd-entry-store-v3.test.ts worker.test.ts
```

Expected: missing cohort columns/bindings and unsupported 3.1 version failures.

- [ ] **Step 3: Write migration 0028**

Rebuild only tables whose existing `CHECK` constraints enumerate version values:

```sql
(schema_version = '3.0' AND strategy_version = '3.0.0-contract3')
OR
(schema_version = '3.1' AND strategy_version = '3.1.0-contract3')
```

Allow event tuples:

```sql
(strategy_version = '3.0.0-contract3' AND rule_contract_version = '3.0.0')
OR
(strategy_version = '3.1.0-contract3' AND rule_contract_version = '3.1.0')
```

Add:

```sql
ALTER TABLE observation_entry_v3_selections
  ADD COLUMN liquidity_cohort TEXT NOT NULL
  DEFAULT 'TWO_PLUS_CANDLES'
  CHECK (liquidity_cohort IN ('ONE_CANDLE', 'TWO_PLUS_CANDLES'));
ALTER TABLE observation_entry_v3_selections
  ADD COLUMN one_candle_enabled INTEGER NOT NULL
  DEFAULT 0 CHECK (one_candle_enabled IN (0, 1));
ALTER TABLE observation_entry_v3_shadow_positions
  ADD COLUMN liquidity_cohort TEXT NOT NULL
  DEFAULT 'TWO_PLUS_CANDLES'
  CHECK (liquidity_cohort IN ('ONE_CANDLE', 'TWO_PLUS_CANDLES'));
ALTER TABLE observation_entry_v3_shadow_positions
  ADD COLUMN one_candle_enabled INTEGER NOT NULL
  DEFAULT 0 CHECK (one_candle_enabled IN (0, 1));
```

Add cross-field insert/update triggers rejecting
`ONE_CANDLE + one_candle_enabled = 0`.

- [ ] **Step 4: Extend SQL bindings and stored row guards**

Update selection and shadow inserts to bind:

```ts
bundle.setup.liquidity_cohort,
bundle.setup.one_candle_enabled ? 1 : 0,
```

Extend decision listing rows and output with:

```ts
liquidity_cohort: row.liquidity_cohort,
one_candle_enabled: row.one_candle_enabled === 1,
```

Reject malformed database rows before returning them.

- [ ] **Step 5: Run store, migration, and worker tests and verify GREEN**

Run:

```bash
npm --prefix apps/observation-edge test -- \
  rd-entry-store-v3.test.ts worker.test.ts
npm --prefix apps/observation-edge run typecheck
```

Expected: tests and type checking pass.

- [ ] **Step 6: Commit the persistence slice**

```bash
git add \
  apps/observation-edge/migrations/0028_observation_entry_v3_liquidity_cohorts.sql \
  apps/observation-edge/src/rd-entry-queries-v3.ts \
  apps/observation-edge/src/rd-entry-store-v3.ts \
  apps/observation-edge/test/rd-entry-store-v3.test.ts \
  apps/observation-edge/test/worker.test.ts
git commit -m "feat: persist liquidity experiment cohorts"
```

### Task 4: One-candle shadow simulation and terminal outcomes

**Files:**
- Modify: `apps/observation-edge/src/rd-entry-store-v3.ts`
- Modify: `apps/observation-edge/test/rd-entry-store-v3.test.ts`

**Interfaces:**
- Produces: `experimentalOneCandlePair(bundle)`.
- Opens: exactly one shadow position per setup/attempt for a canonical one-candle trigger.
- Settles: existing `STOPPED`, `TARGET_HIT`, and `AMBIGUOUS` states.
- Forbids: `INSERT_ENTRY_V3_PAPER_TRADE_INTENT_SQL` for `ONE_CANDLE`.

- [ ] **Step 1: Add failing lifecycle tests**

Cover a one-candle BOC, DIR_CLOSE, and HTF_FLIP entry. For each model assert an
entry decision opens one shadow position and zero paper intents. Then send
separate stop, target, and historical same-bar exit payloads and assert:

```ts
expect(shadow.state).toBe("TARGET_HIT"); // or STOPPED / AMBIGUOUS
expect(shadow.outcome_r_millis).toBe(2000); // target example
expect(paperIntents).toHaveLength(0);
expect(paperSettlements).toHaveLength(0);
```

Add a test that the same setup cannot open both a normal paper link and a
one-candle shadow position.

- [ ] **Step 2: Run focused lifecycle tests and verify RED**

Run:

```bash
npm --prefix apps/observation-edge test -- rd-entry-store-v3.test.ts
```

Expected: no experimental shadow pair is selected.

- [ ] **Step 3: Add one-candle shadow selection**

Implement:

```ts
function experimentalOneCandlePair(
  bundle: ValidatedEntryV3Bundle,
): {
  readonly candidateIndex: number;
  readonly evidence: EntryCandidateEvidenceV3;
} | null {
  if (
    bundle.setup.liquidity_cohort !== "ONE_CANDLE" ||
    !bundle.setup.one_candle_enabled ||
    bundle.evaluation.selection.action !== "SHADOW_ONLY"
  ) return null;
  const pairs = bundle.evaluation.candidates.flatMap((candidate, candidateIndex) => {
    const evidence = bundle.evaluation.evidence.find(
      (item) => item.candidate_id === candidate.candidate_id,
    );
    return evidence === undefined ||
      evidence.observed_trigger_epoch === null ||
      evidence.observed_trigger_ticks === null
      ? []
      : [{ candidateIndex, evidence }];
  });
  pairs.sort(
    (left, right) =>
      left.evidence.observed_trigger_epoch! -
        right.evidence.observed_trigger_epoch! ||
      left.evidence.trigger_sequence - right.evidence.trigger_sequence ||
      bundle.evaluation.candidates[left.candidateIndex]!.candidate_id.localeCompare(
        bundle.evaluation.candidates[right.candidateIndex]!.candidate_id,
      ),
  );
  return pairs[0] ?? null;
}
```

Include it in shadow arbitration:

```ts
const shadowPair =
  experimentalOneCandlePair(bundle) ??
  discretionaryBocPair(bundle) ??
  configurationFallbackPair;
```

Before any paper-intent insert, add an invariant that throws if the setup cohort
is `ONE_CANDLE`. Reuse the existing shadow settlement path; do not duplicate exit
math.

- [ ] **Step 4: Run lifecycle and type tests and verify GREEN**

Run:

```bash
npm --prefix apps/observation-edge test -- rd-entry-store-v3.test.ts
npm --prefix apps/observation-edge run typecheck
```

Expected: all pass.

- [ ] **Step 5: Commit the simulation slice**

```bash
git add \
  apps/observation-edge/src/rd-entry-store-v3.ts \
  apps/observation-edge/test/rd-entry-store-v3.test.ts
git commit -m "feat: simulate one-candle liquidity outcomes"
```

### Task 5: Cohort metrics query and authenticated API

**Files:**
- Create: `apps/observation-edge/src/rd-entry-cohort-metrics.ts`
- Modify: `apps/observation-edge/src/rd-entry-queries-v3.ts`
- Modify: `apps/observation-edge/src/index.ts`
- Create: `apps/observation-edge/test/rd-entry-cohort-metrics.test.ts`
- Modify: `apps/observation-edge/test/worker.test.ts`

**Interfaces:**
- Produces: `GET /api/v1/rd-entry-cohort-metrics`.
- Produces response schema `rd-entry-cohort-metrics/v1`.
- Each row keys by `liquidity_cohort`, `one_candle_enabled`, `entry_model`,
  `symbol`, and `feed`.
- Each row reports `trades`, `wins`, `losses`, `resolved`, `win_rate_bps`,
  `ambiguous`, and `open`.

- [ ] **Step 1: Add failing pure aggregation tests**

Define:

```ts
export interface LiquidityCohortMetricRow {
  liquidity_cohort: "ONE_CANDLE" | "TWO_PLUS_CANDLES";
  one_candle_enabled: boolean;
  entry_model: "BOC" | "DIR_CLOSE" | "HTF_FLIP";
  symbol: string;
  feed: string;
  trades: number;
  wins: number;
  losses: number;
  resolved: number;
  win_rate_bps: number | null;
  ambiguous: number;
  open: number;
}
```

Test:

```ts
expect(validateCohortMetricRow({
  liquidity_cohort: "ONE_CANDLE",
  one_candle_enabled: true,
  entry_model: "DIR_CLOSE",
  symbol: "XPTUSD",
  feed: "OANDA",
  trades: 5,
  wins: 2,
  losses: 1,
  resolved: 3,
  win_rate_bps: 6667,
  ambiguous: 1,
  open: 1,
})).toBeDefined();
```

Reject inconsistent totals, non-null win rate with zero resolved trades, and
unknown cohorts/models.

- [ ] **Step 2: Run the new test and verify RED**

Run:

```bash
npm --prefix apps/observation-edge test -- rd-entry-cohort-metrics.test.ts
```

Expected: module not found.

- [ ] **Step 3: Add the aggregate SQL**

Aggregate paper links for `TWO_PLUS_CANDLES` and shadow positions for
`ONE_CANDLE`, union them, then group by cohort/experiment-setting/model/symbol/feed.
This keeps strict two-plus results separate from two-plus results observed while
the experimental flag is enabled. Compute:

```sql
SUM(CASE WHEN state IN ('STOPPED', 'TARGET_HIT') THEN 1 ELSE 0 END) AS resolved,
CASE
  WHEN SUM(CASE WHEN state IN ('STOPPED', 'TARGET_HIT') THEN 1 ELSE 0 END) = 0
  THEN NULL
  ELSE CAST(
    10000 * SUM(CASE WHEN state = 'TARGET_HIT' THEN 1 ELSE 0 END)
    / SUM(CASE WHEN state IN ('STOPPED', 'TARGET_HIT') THEN 1 ELSE 0 END)
    AS INTEGER
  )
END AS win_rate_bps
```

Use the stored canonical candidate model, event symbol, and receipt feed. Do not
derive cohort from rule text or historical price values.

- [ ] **Step 4: Add the authenticated route**

Implement `listEntryCohortMetrics(request, env)` using
`requirePaperAuthorization`. Return:

```json
{
  "schema_version": "rd-entry-cohort-metrics/v1",
  "mode": "PAPER_SIMULATION_ONLY",
  "items": []
}
```

Add the exact GET-only route and reject malformed database rows with 503.

- [ ] **Step 5: Add route authorization and response tests**

Assert 401 without credentials, 405 for POST, 200 for safe rows, and 503 for
inconsistent totals.

- [ ] **Step 6: Run tests and verify GREEN**

Run:

```bash
npm --prefix apps/observation-edge test -- \
  rd-entry-cohort-metrics.test.ts worker.test.ts
npm --prefix apps/observation-edge run typecheck
```

Expected: all pass.

- [ ] **Step 7: Commit the metrics API slice**

```bash
git add \
  apps/observation-edge/src/rd-entry-cohort-metrics.ts \
  apps/observation-edge/src/rd-entry-queries-v3.ts \
  apps/observation-edge/src/index.ts \
  apps/observation-edge/test/rd-entry-cohort-metrics.test.ts \
  apps/observation-edge/test/worker.test.ts
git commit -m "feat: report liquidity cohort win rates"
```

### Task 6: Operations-console cohort comparison

**Files:**
- Create: `apps/operations-console/src/lib/entry-cohort-metrics.ts`
- Create: `apps/operations-console/src/components/LiquidityCohortPanel.tsx`
- Modify: `apps/operations-console/src/components/PaperSimulationPanel.tsx`
- Create: `apps/operations-console/tests/entry-cohort-metrics-api.test.ts`
- Create: `apps/operations-console/tests/liquidity-cohort-panel.test.tsx`

**Interfaces:**
- Produces: `loadEntryCohortMetrics(credential, signal?)`.
- Produces: `LiquidityCohortPanel`.
- Displays: cohort, model, symbol/feed, trades, resolved sample, wins/losses,
  win rate, ambiguous, and open.

- [ ] **Step 1: Add failing strict-parser tests**

Use a valid fixture with one row from each cohort. Assert the loader requests
`/api/v1/rd-entry-cohort-metrics`, maps snake_case fields, and rejects:

```ts
{ resolved: 3, wins: 2, losses: 0 }
{ resolved: 0, win_rate_bps: 5000 }
{ liquidity_cohort: "UNKNOWN" }
{ liquidity_cohort: "ONE_CANDLE", one_candle_enabled: false }
```

- [ ] **Step 2: Add failing component tests**

Assert:

```tsx
expect(screen.getByRole("heading", {
  name: "Liquidity experiment",
})).toBeInTheDocument();
expect(screen.getByText("ONE CANDLE")).toBeInTheDocument();
expect(screen.getByText("66.67%")).toBeInTheDocument();
expect(screen.getByText("3 resolved")).toBeInTheDocument();
```

Also verify `No resolved trades` when `winRateBps` is null.

- [ ] **Step 3: Run the console tests and verify RED**

Run:

```bash
npm --prefix apps/operations-console test -- \
  entry-cohort-metrics-api.test.ts liquidity-cohort-panel.test.tsx
```

Expected: modules/components not found.

- [ ] **Step 4: Implement the strict API client**

Export:

```ts
export type LiquidityCohortMetric = {
  liquidityCohort: "ONE_CANDLE" | "TWO_PLUS_CANDLES";
  oneCandleEnabled: boolean;
  entryModel: "BOC" | "DIR_CLOSE" | "HTF_FLIP";
  symbol: string;
  feed: string;
  trades: number;
  wins: number;
  losses: number;
  resolved: number;
  winRateBps: number | null;
  ambiguous: number;
  open: number;
};
```

Validate every arithmetic invariant before returning data.

- [ ] **Step 5: Implement the panel**

Render one compact table grouped by cohort. Format `winRateBps / 100` to two
decimal places and always show resolved sample size next to win rate. Add the
panel to `PaperSimulationPanel` below account readiness and above individual
trade cards. Use the existing operator credential and refresh lifecycle.

- [ ] **Step 6: Run console tests, lint, and type checking and verify GREEN**

Run:

```bash
npm --prefix apps/operations-console test -- \
  entry-cohort-metrics-api.test.ts liquidity-cohort-panel.test.tsx
npm --prefix apps/operations-console run typecheck
npm --prefix apps/operations-console run lint
```

Expected: all pass with zero lint warnings.

- [ ] **Step 7: Commit the console slice**

```bash
git add \
  apps/operations-console/src/lib/entry-cohort-metrics.ts \
  apps/operations-console/src/components/LiquidityCohortPanel.tsx \
  apps/operations-console/src/components/PaperSimulationPanel.tsx \
  apps/operations-console/tests/entry-cohort-metrics-api.test.ts \
  apps/operations-console/tests/liquidity-cohort-panel.test.tsx
git commit -m "feat: display liquidity cohort performance"
```

### Task 7: Full verification and TradingView rollout documentation

**Files:**
- Modify: `docs/runbooks/rd-three-entry-paper-rollout.md`
- Modify: `README.md`

**Interfaces:**
- Documents the default-off safety behavior.
- Documents separate settings hashes for flag-off and flag-on alerts.
- Documents alert recreation and cohort-metric verification.

- [ ] **Step 1: Add exact runbook instructions**

Document two profiles:

```text
STRICT:
  Enable one-candle liquidity = false
  liquidity cohort = TWO_PLUS_CANDLES

EXPERIMENT:
  Enable one-candle liquidity = true
  liquidity cohort = ONE_CANDLE or TWO_PLUS_CANDLES
  one-candle economic action = SHADOW_ONLY
```

State that each alert snapshots its inputs and must be recreated after toggling.
Require distinct reviewed settings hashes for the two profiles. Add:

```text
GET /api/v1/rd-entry-cohort-metrics
```

and explain the resolved win-rate denominator.

- [ ] **Step 2: Run every relevant test suite**

Run:

```bash
pytest -q tests/static/test_rd_three_entry_pine.py
npm --prefix apps/observation-edge test
npm --prefix apps/observation-edge run typecheck
npm --prefix apps/observation-edge run build
npm --prefix apps/operations-console test
npm --prefix apps/operations-console run typecheck
npm --prefix apps/operations-console run lint
npm --prefix apps/operations-console run build
```

Expected: every command exits zero. Record any pre-existing unrelated warning
separately; do not suppress it.

- [ ] **Step 3: Verify the safety invariants from source**

Run:

```bash
rg -n 'ONE_CANDLE|PAPER_ELIGIBLE|INSERT_ENTRY_V3_PAPER_TRADE_INTENT_SQL' \
  apps/observation-edge/src
```

Confirm every path capable of inserting a paper intent rejects
`liquidity_cohort === "ONE_CANDLE"` and no broker/live execution path exists.

- [ ] **Step 4: Commit documentation and verification notes**

```bash
git add README.md docs/runbooks/rd-three-entry-paper-rollout.md
git commit -m "docs: add one-candle experiment rollout"
```

- [ ] **Step 5: Prepare the TradingView handoff**

After deployment, update the saved Pine script, create separate experiment
alerts only for the approved markets, and verify the first accepted receipt
contains:

```json
{
  "schema_version": "3.1",
  "strategy_version": "3.1.0-contract3",
  "rule_contract_version": "3.1.0",
  "liquidity_cohort": "ONE_CANDLE",
  "one_candle_enabled": true
}
```

Do not claim the experiment is collecting outcomes until a 2xx receipt is stored
and the cohort appears in `GET /api/v1/rd-entry-cohort-metrics`.
