# Micro-Retracement Liquidity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an off-by-default, display-only micro-retracement candidate that recognizes one opposite candle followed immediately by a continuation BOS without changing strict liquidity or execution behavior.

**Architecture:** Extend the existing display-only `StructureLiquidityLevel` producer with a source flag and a second candidate detector. Feed qualifying micro candidates into the existing zone-specific freshness, side, distance, BOS, arbitration, and drawing path; keep the strict `LiquidityLevel` path untouched.

**Tech Stack:** Pine Script v6, Python 3.12, pytest static source-contract tests

---

### Task 1: Lock the micro-candidate contract

**Files:**
- Modify: `tests/static/test_rd_three_entry_pine.py`
- Modify: `scripts/pinescript/SND_RD_5M_V3_THREE_ENTRY_LAB.pine:95-105,189-198,1185-1225`

- [ ] **Step 1: Write the failing producer-contract test**

Add this test near the existing structural-liquidity tests:

```python
def test_pine_v3_micro_retracement_candidate_requires_one_opposite_candle_and_immediate_bos() -> None:
    pine = source()
    producer = section(
        pine,
        "confirmedMicroStructureLiquidity(",
        "refreshStructureLiquidityMoveReference(",
    )

    assert (
        'enableMicroRetracementLiquidity = input.bool(false, '
        '"Enable micro-retracement liquidity (display only)", group = "Liquidity")'
        in pine
    )
    assert "bool microRetracement" in pine
    assert "bool sourceAvailable = bar_index >= 2" in producer
    assert "bool pauseIsOpposite = liquidityCandleIsOpposite(demand, 1)" in producer
    assert "bool priorIsOpposite = liquidityCandleIsOpposite(demand, 2)" in producer
    assert "bool continuationCandle = demand ? close > open : close < open" in producer
    assert "bool breaksPauseExtreme = demand ? high > high[1] : low < low[1]" in producer
    assert (
        "enableMicroRetracementLiquidity and sourceAvailable and pauseIsOpposite "
        "and not priorIsOpposite and continuationCandle and breaksPauseExtreme"
        in producer
    )
    assert "level.price := demand ? low[1] : high[1]" in producer
    assert "level.priceBar := bar_index - 1" in producer
    assert "level.bosLevel := demand ? high[1] : low[1]" in producer
    assert "level.bosLevelBar := bar_index - 1" in producer
    assert "level.oppositeCandleCount := 1" in producer
    assert "level.cohort := LIQUIDITY_COHORT_ONE" in producer
    assert "level.microRetracement := true" in producer
    assert "level.microRetracement := false" in pine
    assert "if confirmedMicroStructureLiquidity(true)" in producer
    assert "if confirmedMicroStructureLiquidity(false)" in producer
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
.venv/bin/pytest -q tests/static/test_rd_three_entry_pine.py -k micro_retracement_candidate
```

Expected: FAIL because the input, source flag, and micro producer do not exist.

- [ ] **Step 3: Add the off-by-default input and source flag**

Add the input beside the existing structural-liquidity settings:

```pine
enableMicroRetracementLiquidity = input.bool(false, "Enable micro-retracement liquidity (display only)", group = "Liquidity")
```

Extend `StructureLiquidityLevel`:

```pine
type StructureLiquidityLevel
    bool demand
    float price
    int priceBar
    float bosLevel
    int bosLevelBar
    int oppositeCandleCount
    string cohort
    bool microRetracement
```

Set the flag to `false` in `appendConfirmedStructureLiquidityPivot()` so the existing symmetric producer remains explicit:

```pine
    level.cohort := oppositeCandleCount == 1 ? LIQUIDITY_COHORT_ONE : LIQUIDITY_COHORT_TWO_PLUS
    level.microRetracement := false
```

- [ ] **Step 4: Implement the micro producer and connect it to structural candidate discovery**

Add these functions after `appendConfirmedStructureLiquidityPivot()` and before `updateConfirmedStructureLiquidityPivots()`, then extend the update function as shown:

```pine
confirmedMicroStructureLiquidity(bool demand) =>
    bool sourceAvailable = bar_index >= 2
    bool pauseIsOpposite = sourceAvailable and liquidityCandleIsOpposite(demand, 1)
    bool priorIsOpposite = sourceAvailable and liquidityCandleIsOpposite(demand, 2)
    bool continuationCandle = demand ? close > open : close < open
    bool breaksPauseExtreme = demand ? high > high[1] : low < low[1]
    enableMicroRetracementLiquidity and sourceAvailable and pauseIsOpposite and not priorIsOpposite and continuationCandle and breaksPauseExtreme

appendConfirmedMicroStructureLiquidity(bool demand, array<StructureLiquidityLevel> levels, array<int> createdIndexes) =>
    StructureLiquidityLevel level = StructureLiquidityLevel.new()
    level.demand := demand
    level.price := demand ? low[1] : high[1]
    level.priceBar := bar_index - 1
    level.bosLevel := demand ? high[1] : low[1]
    level.bosLevelBar := bar_index - 1
    level.oppositeCandleCount := 1
    level.cohort := LIQUIDITY_COHORT_ONE
    level.microRetracement := true
    array.push(levels, level)
    array.push(createdIndexes, array.size(levels) - 1)
```

Update discovery without changing the symmetric calls:

```pine
updateConfirmedStructureLiquidityPivots(array<StructureLiquidityLevel> levels, array<int> createdIndexes) =>
    array.clear(createdIndexes)
    int strength = liquidityPivotStrength
    if confirmedStructureLiquidityPivot(true, strength)
        appendConfirmedStructureLiquidityPivot(true, strength, levels, createdIndexes)
    if confirmedStructureLiquidityPivot(false, strength)
        appendConfirmedStructureLiquidityPivot(false, strength, levels, createdIndexes)
    if confirmedMicroStructureLiquidity(true)
        appendConfirmedMicroStructureLiquidity(true, levels, createdIndexes)
    if confirmedMicroStructureLiquidity(false)
        appendConfirmedMicroStructureLiquidity(false, levels, createdIndexes)
    true
```

- [ ] **Step 5: Run the producer test and verify GREEN**

Run:

```bash
.venv/bin/pytest -q tests/static/test_rd_three_entry_pine.py -k micro_retracement_candidate
```

Expected: PASS.

- [ ] **Step 6: Commit the producer**

```bash
git add scripts/pinescript/SND_RD_5M_V3_THREE_ENTRY_LAB.pine tests/static/test_rd_three_entry_pine.py
git commit -m "feat: detect display-only micro retracements"
```

### Task 2: Route micro candidates through structural-only gates

**Files:**
- Modify: `tests/static/test_rd_three_entry_pine.py`
- Modify: `scripts/pinescript/SND_RD_5M_V3_THREE_ENTRY_LAB.pine:1247-1292`

- [ ] **Step 1: Write the failing isolation and gate test**

Add:

```python
def test_pine_v3_micro_retracements_reuse_structural_gates_without_execution_authority() -> None:
    pine = source()
    producer = section(
        pine,
        "confirmedMicroStructureLiquidity(",
        "refreshStructureLiquidityMoveReference(",
    )
    refresh = section(
        pine,
        "refreshZoneStructureLiquidity(",
        "zoneLiquidityTakenBar(",
    )

    assert (
        "bool candleCountQualified = candidate.microRetracement or "
        "candidate.oppositeCandleCount >= minimumLiquidityOppositeCandles()"
        in refresh
    )
    assert "candidateMoveLevelBar < candidate.priceBar" in refresh
    assert "candidate.priceBar > zone.confirmationBar" in refresh
    assert "candidate.demand == zone.demand and distance > 0" in refresh
    assert "bool zoneStillUntouched = not structureLiquidityZoneTouched(zone)" in refresh
    assert "distance <= guidanceMax + syminfo.mintick * 0.5" in refresh
    assert "bosBar > candidate.priceBar" in refresh
    assert "bool closer = na(zone.structureLiquidityPrice)" in refresh
    assert "zone.structureLiquidityPrice := candidate.price" in refresh

    for forbidden in (
        "liquidityPrimaryIndex",
        "liquidityQualified",
        "eligibilityState",
        "setupState",
        "entryAttempts",
        "alertcondition(",
        "diagnosticPayload(",
    ):
        assert forbidden not in producer
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
.venv/bin/pytest -q tests/static/test_rd_three_entry_pine.py -k micro_retracements_reuse
```

Expected: FAIL because the structural refresh still applies the global opposite-candle minimum to every candidate.

- [ ] **Step 3: Allow tagged micro candidates through only the structural candle-count gate**

Inside the new-candidate loop in `refreshZoneStructureLiquidity()`, split the candle-count condition from the shared retracement evidence:

```pine
                    bool candleCountQualified = candidate.microRetracement or candidate.oppositeCandleCount >= minimumLiquidityOppositeCandles()
                    bool hasRetracementEvidence = not na(candidate.bosLevel) and not na(candidate.bosLevelBar) and candidate.bosLevelBar <= candidate.priceBar and not na(candidateMoveLevel) and not na(candidateMoveLevelBar) and candidateMoveLevelBar < candidate.priceBar and candleCountQualified
```

Do not alter `refreshZoneLiquidity()`, `zoneLiquiditySweptBar()`, `updateZoneEligibility()`, or any setup/entry function.

- [ ] **Step 4: Run the gate test and verify GREEN**

Run:

```bash
.venv/bin/pytest -q tests/static/test_rd_three_entry_pine.py -k micro_retracements_reuse
```

Expected: PASS.

- [ ] **Step 5: Run all structural-liquidity tests**

Run:

```bash
.venv/bin/pytest -q tests/static/test_rd_three_entry_pine.py -k 'structure_liquidity or structural_bos or micro_retracement'
```

Expected: all selected tests PASS.

- [ ] **Step 6: Commit structural integration**

```bash
git add scripts/pinescript/SND_RD_5M_V3_THREE_ENTRY_LAB.pine tests/static/test_rd_three_entry_pine.py
git commit -m "feat: arbitrate micro liquidity as structural display"
```

### Task 3: Verify safety, defaults, and regression coverage

**Files:**
- Verify: `scripts/pinescript/SND_RD_5M_V3_THREE_ENTRY_LAB.pine`
- Verify: `tests/static/test_rd_three_entry_pine.py`
- Verify: `docs/superpowers/specs/2026-08-06-micro-retracement-liquidity-design.md`

- [ ] **Step 1: Run the complete V3 Pine static suite**

Run:

```bash
.venv/bin/pytest -q tests/static/test_rd_three_entry_pine.py
```

Expected: all tests PASS.

- [ ] **Step 2: Verify formatting and whitespace**

Run:

```bash
git diff --check
```

Expected: exit status `0` with no output.

- [ ] **Step 3: Inspect the safety boundary directly**

Run:

```bash
rg -n "enableMicroRetracementLiquidity|microRetracement|liquidityPrimaryIndex|liquidityQualified|updateZoneEligibility|alertcondition" scripts/pinescript/SND_RD_5M_V3_THREE_ENTRY_LAB.pine
```

Expected: micro-retracement writes occur only in the structural candidate producer and structural refresh. Strict eligibility and alert references remain outside that producer.

- [ ] **Step 4: Review the final diff against the design**

Confirm all of the following:

- the new input defaults to `false`;
- exactly one opposite candle is required because candle `[2]` cannot also be opposite;
- the immediate candle must resume direction and strictly break candle `[1]`;
- the candidate uses candle `[1]`'s near extreme and BOS extreme;
- shared structural freshness, side, distance, and arbitration remain intact;
- strict liquidity, setup, entry, alert, and payload code is unchanged.

- [ ] **Step 5: Commit any final test-only adjustments**

If verification required a test-only correction, commit only those test changes:

```bash
git add tests/static/test_rd_three_entry_pine.py
git commit -m "test: lock micro liquidity safety boundary"
```

If no adjustment was required, skip this commit.
