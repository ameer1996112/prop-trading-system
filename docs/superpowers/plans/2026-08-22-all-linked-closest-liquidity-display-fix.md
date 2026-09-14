# All-Linked Closest Liquidity Display Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make curated Pine views render the genuinely closest valid linked liquidity candidate with one liquidity owner per overlapping zone level, while leaving strict trading authority and Raw Audit unchanged.

**Architecture:** Keep discovery and `liquidityPrimaryIndex` unchanged. Extend the presentation selector to scan the read-only `liquidityLevels` array through each zone's existing linked indexes, then apply the existing structural comparison. Add a presentation-only owner helper that uses the existing curated ranking for overlapping visible zones; only drawing functions consume either result.

**Tech Stack:** Pine Script v6, generated LAB-to-RELEASE pipeline, Python static regression tests with pytest, Vitest Pine parity checks.

---

## File map

- Modify `tests/static/test_rd_three_entry_pine.py`: lock all-linked minimum-distance selection, fallback isolation, curated overlap ownership, call-site propagation, and Raw Audit isolation.
- Modify `scripts/pinescript/SND_RD_5M_V3_THREE_ENTRY_LAB.pine`: implement the read-only display selector and overlap owner; pass `liquidityLevels` only into the renderer.
- Generate `scripts/pinescript/SND_RD_5M_V3_RELEASE.pine`: never edit directly; regenerate from LAB.
- Modify `tests/unit/test_generate_rd_v3_release.py`: accept the intentionally reviewed protected-region digest.
- Modify `.secrets.baseline`: replace only the old protected-digest false-positive hash with the new deterministic digest hash.

### Task 1: Prove the all-linked selection and ownership defects

**Files:**
- Modify: `tests/static/test_rd_three_entry_pine.py:321-368`
- Modify: `tests/static/test_rd_three_entry_pine.py:895-907`
- Modify: `tests/static/test_rd_three_entry_pine.py:1722-1748`

- [ ] **Step 1: Replace the two-candidate selector assertion with an all-linked failing regression**

Use a selector section bounded by `liquidityDisplaySelection(` and `zoneText(`. Assert the intended Pine API and algorithm:

```python
def test_pine_v3_display_selects_the_closest_valid_linked_or_structure_candidate() -> None:
    pine = source()
    selector = section(pine, "liquidityDisplaySelection(", "zoneText(")

    assert "liquidityDisplaySelection(RawZone zone, array<LiquidityLevel> levels)" in selector
    assert "int linkedCount = array.size(zone.liquidityIndexes)" in selector
    assert "int levelCount = array.size(levels)" in selector
    assert "int candidateIndex = array.get(zone.liquidityIndexes, linkedOffset)" in selector
    assert "candidateIndex >= 0 and candidateIndex < levelCount" in selector
    assert "LiquidityLevel candidate = array.get(levels, candidateIndex)" in selector
    assert "candidate.nearExtremeBar > zone.originBar" in selector
    assert "liquiditySupportsZone(zone, candidate)" in selector
    assert "distance < strictDistance - syminfo.mintick * 0.5" in selector
    assert "candidate.nearExtremeBar < strictBar" in selector
    assert "if not strictAvailable" in selector
    assert "zone.liquidityExtreme" in selector
    assert "bool structureAvailable = showStructureLiquidityLines" in selector
```

- [ ] **Step 2: Add authority-isolation and primary-style assertions**

Extend the same test with exact forbidden writes and require alternate linked candidates not to inherit primary swept state:

```python
    assert "candidateIndex == zone.liquidityPrimaryIndex and not na(zone.liquiditySweptBar)" in selector
    for forbidden_write in (
        "liquidityPrimaryIndex :=",
        "pendingLiquidityPrimaryIndex :=",
        "liquidityQualified :=",
        "eligibilityState :=",
        "setupState :=",
        "entryAttempts",
        "alert(",
        "emitExecutionProposalV1ForAttempt(",
    ):
        assert forbidden_write not in selector
```

- [ ] **Step 3: Add a failing overlap-owner regression**

Add a focused test for a new helper between `zoneOwnsCuratedLiquidityDisplay(` and `zoneBaseColor(`:

```python
def test_pine_v3_gives_each_overlapping_curated_level_one_liquidity_owner() -> None:
    pine = source()
    owner = section(pine, "zoneOwnsCuratedLiquidityDisplay(", "zoneBaseColor(")
    drawing = section(pine, "updateZoneDrawing(", "addUniqueLiquidityIndex(")

    assert "displayMode == DISPLAY_RAW_AUDIT" in owner
    assert "zoneVisible(candidate, allZones)" in owner
    assert "candidate.demand == target.demand" in owner
    assert "zonesOverlap(candidate, target)" in owner
    assert "setupZoneRanksAhead(candidate, target" in owner
    assert "ownsDisplay := false" in owner
    assert "break" in owner
    assert "zoneOwnsCuratedLiquidityDisplay(zone, allZones)" in drawing
    assert "ownsLiquidityDisplay and showLiquidityLines" in drawing
```

- [ ] **Step 4: Require renderer and final call site to receive the read-only level array**

Update existing renderer assertions to require:

```python
assert "updateZoneDrawing(RawZone zone, array<RawZone> allZones, array<LiquidityLevel> levels)" in pine
assert "liquidityDisplaySelection(zone, levels)" in zone_drawing
assert "updateZoneDrawing(zone, zones, liquidityLevels)" in final_drawing_pass
```

Keep the existing Raw Audit assertions against `updateLiquidityDrawings(` unchanged, and retain `test_pine_v3_strict_liquidity_prefers_the_latest_valid_pivot` unchanged.

- [ ] **Step 5: Run the focused tests and verify RED**

Run:

```bash
UV_CACHE_DIR=/private/tmp/codex-uv-cache uv run pytest tests/static/test_rd_three_entry_pine.py -k 'closest_valid_linked or overlapping_curated_level or one_selected_candidate or raises_zone_liquidity or only_refreshes_drawing' -q
```

Expected: failures because `liquidityDisplaySelection` has no `levels` parameter, no linked-index loop exists, `zoneOwnsCuratedLiquidityDisplay` is absent, and the renderer still has the old signature.

- [ ] **Step 6: Commit the RED tests**

```bash
git add tests/static/test_rd_three_entry_pine.py
git commit -m "test: expose linked liquidity display regression"
```

### Task 2: Implement the display-only selector and overlap owner

**Files:**
- Modify: `scripts/pinescript/SND_RD_5M_V3_THREE_ENTRY_LAB.pine:696-713`
- Modify: `scripts/pinescript/SND_RD_5M_V3_THREE_ENTRY_LAB.pine:783-800`
- Modify: `scripts/pinescript/SND_RD_5M_V3_THREE_ENTRY_LAB.pine:813-865`
- Modify: `scripts/pinescript/SND_RD_5M_V3_THREE_ENTRY_LAB.pine:3668-3680`

- [ ] **Step 1: Add the curated liquidity-owner helper after `zoneVisible`**

```pine
zoneOwnsCuratedLiquidityDisplay(RawZone target, array<RawZone> allZones) =>
    bool ownsDisplay = true
    if displayMode != DISPLAY_RAW_AUDIT
        float targetDistance = zoneDistanceFromPrice(target)
        int candidateCount = array.size(allZones)
        if candidateCount > 0
            for candidateIndex = 0 to candidateCount - 1
                RawZone candidate = array.get(allZones, candidateIndex)
                bool competing = candidate.id != target.id and candidate.demand == target.demand and zonesOverlap(candidate, target) and zoneVisible(candidate, allZones)
                if competing
                    float candidateDistance = zoneDistanceFromPrice(candidate)
                    if setupZoneRanksAhead(candidate, target, candidateDistance, targetDistance)
                        ownsDisplay := false
                        break
    ownsDisplay
```

This helper reads visibility and ranking only. It does not modify zones.

- [ ] **Step 2: Replace `liquidityDisplaySelection` with the all-linked selector**

Implement these exact stages inside `liquidityDisplaySelection(RawZone zone, array<LiquidityLevel> levels)`:

```pine
    bool strictAvailable = false
    float strictPrice = na
    int strictBar = na
    float strictDistance = na
    float strictProofPrice = na
    int strictProofBar = na
    bool strictTaken = false
    int linkedCount = array.size(zone.liquidityIndexes)
    int levelCount = array.size(levels)
    if linkedCount > 0
        for linkedOffset = 0 to linkedCount - 1
            int candidateIndex = array.get(zone.liquidityIndexes, linkedOffset)
            if candidateIndex >= 0 and candidateIndex < levelCount
                LiquidityLevel candidate = array.get(levels, candidateIndex)
                float distance = liquidityDistanceToZone(zone, candidate)
                bool eligible = candidate.nearExtremeBar > zone.originBar and liquiditySupportsZone(zone, candidate)
                bool sameDistance = strictAvailable and math.abs(distance - strictDistance) <= syminfo.mintick * 0.5
                bool closer = not strictAvailable or distance < strictDistance - syminfo.mintick * 0.5 or (sameDistance and candidate.nearExtremeBar < strictBar)
                if eligible and closer
                    strictAvailable := true
                    strictPrice := candidate.nearExtreme
                    strictBar := candidate.nearExtremeBar
                    strictDistance := distance
                    strictProofPrice := candidate.anchor
                    strictProofBar := candidate.anchorBar
                    strictTaken := candidateIndex == zone.liquidityPrimaryIndex and not na(zone.liquiditySweptBar)
```

When `not strictAvailable`, populate the same temporary variables from the existing frozen strict fields only if their distance is positive. Then retain the existing structural availability, distance comparison, half-tick tie, and selected tuple, but return `strictPrice`, `strictBar`, `strictProofPrice`, `strictProofBar`, and `strictTaken` instead of reading the authority fields directly.

- [ ] **Step 3: Wire ownership and levels into the renderer**

Change the signature and selection call:

```pine
updateZoneDrawing(RawZone zone, array<RawZone> allZones, array<LiquidityLevel> levels) =>
    bool visible = zoneVisible(zone, allZones)
    bool ownsLiquidityDisplay = visible and zoneOwnsCuratedLiquidityDisplay(zone, allZones)
    // existing box rendering remains based on visible
    [strictSelected, structureSelected, selectedPrice, selectedBar, selectedTaken, selectedProofPrice, selectedProofBar] = liquidityDisplaySelection(zone, levels)
    bool displayLiquidityVisible = ownsLiquidityDisplay and showLiquidityLines and displayMode != DISPLAY_RAW_AUDIT and (displayMode != DISPLAY_SETUPS_ONLY or zone.setupState == SETUP_ARMED) and not na(selectedPrice) and not na(selectedBar)
```

Do not change line construction, label coordinates, proof handling, or cleanup beyond using this visibility predicate.

- [ ] **Step 4: Pass `liquidityLevels` from the last-bar drawing loop**

```pine
updateZoneDrawing(zone, zones, liquidityLevels)
```

Do not change `updateLiquidityDrawings(liquidityLevels, drawnLiquidityIndexes, zones)`; it remains the Raw Audit path.

- [ ] **Step 5: Run the focused tests and verify GREEN**

Run the Task 1 focused command again. Expected: all selected tests pass.

- [ ] **Step 6: Run the full Pine static file**

```bash
UV_CACHE_DIR=/private/tmp/codex-uv-cache uv run pytest tests/static/test_rd_three_entry_pine.py -q
```

Expected: all tests pass, including the unchanged newest-pivot authority and Raw Audit tests.

- [ ] **Step 7: Commit the LAB implementation**

```bash
git add scripts/pinescript/SND_RD_5M_V3_THREE_ENTRY_LAB.pine tests/static/test_rd_three_entry_pine.py
git commit -m "fix: select closest linked liquidity visual"
```

### Task 3: Regenerate RELEASE and verify the authority boundary

**Files:**
- Generate: `scripts/pinescript/SND_RD_5M_V3_RELEASE.pine`
- Modify: `tests/unit/test_generate_rd_v3_release.py:16`
- Modify: `.secrets.baseline`

- [ ] **Step 1: Regenerate and check RELEASE**

```bash
UV_CACHE_DIR=/private/tmp/codex-uv-cache uv run python scripts/generate_rd_v3_release.py
UV_CACHE_DIR=/private/tmp/codex-uv-cache uv run python scripts/generate_rd_v3_release.py --check
```

Expected: both commands exit 0 and RELEASE contains no LAB-only blocks.

- [ ] **Step 2: Run the release-generator test to obtain the reviewed digest**

```bash
UV_CACHE_DIR=/private/tmp/codex-uv-cache uv run pytest tests/unit/test_generate_rd_v3_release.py -q
```

Expected: the generator parity assertions pass and only the protected semantic digest assertion fails, reporting the new SHA-256.

- [ ] **Step 3: Replace the protected digest and its narrow secret baseline entry**

Update `PROTECTED_REGION_SHA256` to the exact digest printed in Step 2. Compute `sha1(new_digest_text)` and replace only the `tests/unit/test_generate_rd_v3_release.py` `Hex High Entropy String` entry in `.secrets.baseline`.

- [ ] **Step 4: Run the complete focused authority suite**

```bash
UV_CACHE_DIR=/private/tmp/codex-uv-cache uv run pytest tests/contract/test_rd_strategy_rule_contract_v3.py tests/static/test_rd_three_entry_pine.py tests/static/test_execution_proposal_v1_boundaries.py tests/static/test_migration_foundation.py tests/unit/test_generate_rd_v3_release.py -q
```

Expected: all tests pass with zero failures.

- [ ] **Step 5: Run edge Pine parity**

From `apps/observation-edge`:

```bash
npm test -- --run test/rd-entry-pine-v3-parity.test.ts
```

Expected: the parity test file passes.

- [ ] **Step 6: Run generated, secret, boundary, and frozen-spec gates**

```bash
UV_CACHE_DIR=/private/tmp/codex-uv-cache make verify-generated secret-scan boundary-check frozen-spec-check
git diff --check
```

Expected: all commands exit 0; no new secret findings, no execution surface, and generated artifacts match.

- [ ] **Step 7: Commit generated artifacts and verification metadata**

```bash
git add .secrets.baseline scripts/pinescript/SND_RD_5M_V3_RELEASE.pine tests/unit/test_generate_rd_v3_release.py
git commit -m "build: regenerate closest liquidity release"
```

### Task 4: TradingView replay handoff

**Files:**
- Read: `scripts/pinescript/SND_RD_5M_V3_RELEASE.pine`

- [ ] **Step 1: Confirm the worktree is clean and record HEAD**

```bash
git status --short
git log -1 --oneline
```

Expected: no status output and HEAD identifies the generated-release commit.

- [ ] **Step 2: Give the exact RELEASE file and replay checklist**

Ask the user to replace the TradingView editor contents with `scripts/pinescript/SND_RD_5M_V3_RELEASE.pine`, save, and update the chart. Replay USDJPY 5-minute around the recorded sequence with View `Clean`, `Show liquidity lines` enabled, and `Show bigger-structure liquidity` enabled.

Expected visual evidence:

- `LIQ 159.249` cannot jump to the farther `159.283` merely because the farther pivot is newer;
- a closer valid linked pivot replaces a farther display candidate;
- one overlapping curated level owns one visible liquidity line;
- Raw Audit still displays all linked evidence.

## Execution note

Task 2 review identified that calling `zoneVisible(candidate, allZones)` inside every ownership scan would create an O(z³) last-bar path. The implementation therefore precomputes a parallel `array<bool> visibleZones` once per render pass and passes it read-only to the ownership helper. This preserves the approved visible-zone ownership rule while keeping the render path at O(z²) plus linked-candidate scans.
