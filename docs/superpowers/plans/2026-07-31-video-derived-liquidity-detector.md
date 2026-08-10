# Video-Derived Liquidity Detector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the display-only nearest-pivot liquidity approximation with a zone-linked retracement-swing and continuation-BOS detector derived from the three reference videos.

**Architecture:** Preserve the existing strict liquidity and entry engines. Use the configured pivot-strength window to confirm reversal structure, use the confirmed pivot center as the structural price/bar, then let each fresh `RawZone` confirm BOS and select the closest valid candidate. The full retracement leg remains evidence for candle count and BOS context.

**Tech Stack:** Pine Script v6, Python/pytest static contract tests.

## Global Constraints

- Structural liquidity is display-only and cannot mutate setup eligibility, entry attempts, alerts, or payloads.
- Demand uses swing-low liquidity above the zone; supply uses swing-high liquidity below the zone.
- The default maximum distance is 30% of the candidate's full pre-retracement impulse.
- One-candle retracements are accepted only when the existing experiment input is enabled; that input changes the minimum opposite-candle count without changing the configured pivot strength.
- Structural BOS defaults to wick confirmation; strict mode uses candle closes.
- Preserve all unrelated user changes in the dirty worktree.
- Do not create a git commit unless the user requests one.

---

### Task 1: Lock the structural detector contract

**Files:**
- Modify: `tests/static/test_rd_three_entry_pine.py`
- Test: `tests/static/test_rd_three_entry_pine.py`

**Interfaces:**
- Consumes: `scripts/pinescript/SND_RD_5M_V3_THREE_ENTRY_LAB.pine`
- Produces: failing assertions for retracement evidence, BOS confirmation, zone freshness, and display-only isolation.

- [ ] **Step 1: Replace the nearest-pivot expectations with video-derived expectations**

Add focused tests that require:

```python
assert "int oppositeCandleCount" in detector_type
assert "structureLiquidityBosConfirmed(" in refresh
assert "candidate.priceBar > zone.confirmationBar" in refresh
assert "not zoneReachedOrCrossed(zone)" in refresh
```

- [ ] **Step 2: Add strict/relaxed BOS expectations**

Require a `Strict structural BOS` input defaulting to `false`, with close-based confirmation in strict mode and high/low confirmation in relaxed mode.

- [ ] **Step 3: Run the focused tests and verify RED**

Run:

```bash
pytest -q tests/static/test_rd_three_entry_pine.py -k 'structure_liquidity or structural_bos'
```

Expected: failures identifying the missing BOS and retracement contract.

### Task 2: Enrich structural swing candidates

**Files:**
- Modify: `scripts/pinescript/SND_RD_5M_V3_THREE_ENTRY_LAB.pine`
- Test: `tests/static/test_rd_three_entry_pine.py`

**Interfaces:**
- Consumes: `liquidityLegProof(bool demand, int strength)` and `minimumLiquidityOppositeCandles()`.
- Produces: `StructureLiquidityLevel` values containing the confirmed pivot price/bar, `oppositeCandleCount`, and `cohort`.

- [ ] **Step 1: Add structural candidate evidence fields**

Add `oppositeCandleCount` and `cohort` to `StructureLiquidityLevel`.

- [ ] **Step 2: Require the video-derived retracement leg**

Make `confirmedStructureLiquidityPivot()` require `liquidityLegProof()` to meet `minimumLiquidityOppositeCandles()` while preserving equal-high/equal-low pivots and the configured `liquidityPivotStrength` window.

- [ ] **Step 3: Populate immutable candidate evidence**

Copy the count and `ONE_CANDLE`/`TWO_PLUS_CANDLES` cohort when appending the structural candidate. Use the confirmed symmetric pivot center and its bar as the candidate price/bar. Continue scanning the complete opposite leg plus bounded reversal bridge for proof, stopping at the first opposite candle so older pre-leg candles cannot leak into the evidence.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run:

```bash
pytest -q tests/static/test_rd_three_entry_pine.py -k 'structure_liquidity'
```

Expected: candidate-evidence tests pass; BOS tests remain red.

### Task 3: Add zone-linked BOS confirmation

**Files:**
- Modify: `scripts/pinescript/SND_RD_5M_V3_THREE_ENTRY_LAB.pine`
- Test: `tests/static/test_rd_three_entry_pine.py`

**Interfaces:**
- Consumes: each structural candidate's frozen local opposite-candle-leg extreme and `zoneReachedOrCrossed(RawZone zone)`. The broader zone-linked impulse extreme is retained separately for distance qualification.
- Produces: `structureLiquidityBosLevel`, `structureLiquidityBosBar`, and a selected BOS-confirmed structural line per zone.

- [ ] **Step 1: Add BOS input and zone state**

Add:

```pine
liquidityStructureStrictBos = input.bool(false, "Strict structural BOS (close beyond level)", group = "Liquidity")
```

Store the selected BOS level/bar on `RawZone` and initialize them in `buildConfirmedZone()`.

- [ ] **Step 2: Implement continuation confirmation**

Create `structureLiquidityBosReference(RawZone zone, StructureLiquidityLevel candidate)` by scanning from zone confirmation through the candle before the swing: highest high for demand and lowest low for supply. Freeze that reference on the zone-candidate link. Create `structureLiquidityBosConfirmed(RawZone zone, StructureLiquidityLevel candidate, float bosLevel)` using that zone-specific reference. Require BOS after the swing; use closes in strict mode and wicks otherwise.

- [ ] **Step 3: Tighten candidate association**

In `refreshZoneStructureLiquidity()`, require candidate formation after zone confirmation, correct side, fresh/no-touch state, distance, retracement evidence, and BOS before arbitration.

- [ ] **Step 4: Preserve closest-candidate arbitration**

Select the smallest positive distance among BOS-confirmed candidates while the zone remains fresh. Allow an older closer swing to replace a provisional newer selection when its structural BOS confirms later; when prices are equal within half a tick, prefer the earlier swing bar. Rely on the configured pivot-strength window to exclude one-bar micro-pivots.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run:

```bash
pytest -q tests/static/test_rd_three_entry_pine.py -k 'structure_liquidity or structural_bos'
```

Expected: all structural detector tests pass.

### Task 4: Verify rendering and safety isolation

**Files:**
- Modify: `tests/static/test_rd_three_entry_pine.py`
- Modify only if required: `scripts/pinescript/SND_RD_5M_V3_THREE_ENTRY_LAB.pine`

**Interfaces:**
- Consumes: selected `RawZone.structureLiquidityPrice` and `RawZone.structureLiquidityBar`.
- Produces: thin grey label-free line with no setup/entry authority.

- [ ] **Step 1: Assert rendering behavior**

Verify width `1`, grey color, swing-bar start, first-touch-or-sweep endpoint with terminal-zone fallback, and no liquidity price label.

- [ ] **Step 2: Assert execution isolation**

Verify the structural refresh section cannot write `liquidityPrimaryIndex`, `liquidityQualified`, `setupState`, or call `updateZoneEligibility()`.

- [ ] **Step 3: Run the complete static test file**

Run:

```bash
pytest -q tests/static/test_rd_three_entry_pine.py
```

Expected: all tests pass.

### Task 5: Full regression and handoff

**Files:**
- Review: `scripts/pinescript/SND_RD_5M_V3_THREE_ENTRY_LAB.pine`
- Review: `tests/static/test_rd_three_entry_pine.py`
- Review: `docs/superpowers/specs/2026-07-31-video-derived-liquidity-detector-design.md`

**Interfaces:**
- Consumes: completed detector and tests.
- Produces: verified full Pine source ready to paste into TradingView Desktop.

- [ ] **Step 1: Run all relevant static tests**

Run:

```bash
pytest -q tests/static/test_rd_three_entry_pine.py tests/static/test_paper_automation_pine.py
```

- [ ] **Step 2: Check patch integrity**

Run:

```bash
git diff --check
git diff --stat
```

- [ ] **Step 3: Review every acceptance criterion**

Confirm the detector requires zone-linked retracement, continuation BOS, correct side, freshness, distance, and configurable candle count while remaining display-only.

- [ ] **Step 4: Copy the complete Pine source**

Run:

```bash
pbcopy < scripts/pinescript/SND_RD_5M_V3_THREE_ENTRY_LAB.pine
```

Expected: the full current Pine source is available to paste into TradingView Desktop.
