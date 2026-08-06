# Zone-Specific Closest Liquidity Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display exactly one liquidity line per visible fresh zone, selected from the zone's strict and structural candidates by the smallest valid proximal-edge distance.

**Architecture:** Add a pure display-arbitration helper that reads frozen strict and structural candidate fields without mutating detector state. Replace the separate render blocks with one lifecycle backed by `zone.liquidityLine`; retain `zone.structureLiquidityLine` only as a cleanup slot for stale objects created by the previous version.

**Tech Stack:** TradingView Pine Script v6, Python 3, pytest static Pine contract tests.

## Global Constraints

- Display-only: do not modify strict qualification, setup eligibility, entries, alerts, exports, payloads, or reviewed hashes.
- Each visible fresh zone owns zero or one primary line; do not deduplicate across zones.
- Demand distance is `candidate price - zone.top`; supply distance is `zone.bottom - candidate price`.
- Only strictly positive distances qualify.
- Equal prices within half a minimum tick select the earlier canonical swing bar.
- Structural candidates participate only while `Show bigger-structure liquidity` is enabled.
- Proof lines exist only when the strict candidate wins.
- Every `xloc.bar_index` endpoint continues through `liquiditySafeDrawingBar`.

## File Structure

- Modify `scripts/pinescript/SND_RD_5M_V3_THREE_ENTRY_LAB.pine`: add display arbitration and unify the zone-owned renderer.
- Modify `tests/static/test_rd_three_entry_pine.py`: add arbitration/lifecycle regressions and replace assertions requiring a second structural line object.
- Reference `docs/superpowers/specs/2026-08-06-zone-specific-closest-liquidity-display-design.md` for the authoritative safety boundary.

---

### Task 1: Add pure per-zone display arbitration

**Files:**
- Modify: `tests/static/test_rd_three_entry_pine.py:35-170`
- Modify: `scripts/pinescript/SND_RD_5M_V3_THREE_ENTRY_LAB.pine:711-751`

**Interfaces:**
- Consumes: `liquidityPriceDistanceToZone(RawZone zone, float price)`, strict candidate fields, structural candidate fields, and `showStructureLiquidityLines`.
- Produces: `liquidityDisplaySelection(RawZone zone) => [bool strictSelected, bool structureSelected, float selectedPrice, int selectedBar, bool selectedTaken, float selectedProofPrice, int selectedProofBar]`.

- [ ] **Step 1: Write the failing arbitration test**

Add near the existing liquidity rendering tests:

```python
def test_pine_v3_selects_the_closest_display_liquidity_per_zone() -> None:
    pine = source()
    selector = section(pine, "liquidityDisplaySelection(", "zoneText(")

    assert "bool strictAvailable = not na(zone.liquidityPrimaryIndex)" in selector
    assert "bool structureAvailable = showStructureLiquidityLines" in selector
    assert "liquidityPriceDistanceToZone(zone, zone.liquidityExtreme)" in selector
    assert "liquidityPriceDistanceToZone(zone, zone.structureLiquidityPrice)" in selector
    assert "strictDistance > 0" in selector
    assert "structureDistance > 0" in selector
    assert (
        "math.abs(zone.liquidityExtreme - zone.structureLiquidityPrice) "
        "<= syminfo.mintick * 0.5"
        in selector
    )
    assert "zone.liquidityExtremeBar <= zone.structureLiquidityBar" in selector
    assert "strictDistance < structureDistance - syminfo.mintick * 0.5" in selector
    assert "bool structureSelected = structureEligible and not strictSelected" in selector
    assert (
        "[strictSelected, structureSelected, selectedPrice, selectedBar, "
        "selectedTaken, selectedProofPrice, selectedProofBar]"
        in selector
    )
    for forbidden_write in (
        "liquidityPrimaryIndex :=",
        "liquidityQualified :=",
        "eligibilityState :=",
        "setupState :=",
        "entryAttempts",
        "alert(",
        "emitEntryPayload(",
    ):
        assert forbidden_write not in selector
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
pytest -q tests/static/test_rd_three_entry_pine.py -k selects_the_closest_display_liquidity_per_zone
```

Expected: FAIL because `liquidityDisplaySelection(` does not exist.

- [ ] **Step 3: Implement the minimal selector**

Insert after `liquidityRanksCloser` and before `zoneText`:

```pine
liquidityDisplaySelection(RawZone zone) =>
    bool strictAvailable = not na(zone.liquidityPrimaryIndex) and not na(zone.liquidityExtreme) and not na(zone.liquidityExtremeBar)
    bool structureAvailable = showStructureLiquidityLines and not na(zone.structureLiquidityPrice) and not na(zone.structureLiquidityBar)
    float strictDistance = strictAvailable ? liquidityPriceDistanceToZone(zone, zone.liquidityExtreme) : na
    float structureDistance = structureAvailable ? liquidityPriceDistanceToZone(zone, zone.structureLiquidityPrice) : na
    bool strictEligible = strictAvailable and strictDistance > 0
    bool structureEligible = structureAvailable and structureDistance > 0
    bool samePrice = strictEligible and structureEligible and math.abs(zone.liquidityExtreme - zone.structureLiquidityPrice) <= syminfo.mintick * 0.5
    bool strictCloser = strictEligible and structureEligible and strictDistance < structureDistance - syminfo.mintick * 0.5
    bool strictEarlierAtSamePrice = samePrice and zone.liquidityExtremeBar <= zone.structureLiquidityBar
    bool strictSelected = strictEligible and (not structureEligible or strictCloser or strictEarlierAtSamePrice)
    bool structureSelected = structureEligible and not strictSelected
    float selectedPrice = strictSelected ? zone.liquidityExtreme : structureSelected ? zone.structureLiquidityPrice : na
    int selectedBar = strictSelected ? zone.liquidityExtremeBar : structureSelected ? zone.structureLiquidityBar : na
    bool selectedTaken = strictSelected and not na(zone.liquiditySweptBar)
    float selectedProofPrice = strictSelected ? zone.liquidityAnchor : na
    int selectedProofBar = strictSelected ? zone.liquidityAnchorBar : na
    [strictSelected, structureSelected, selectedPrice, selectedBar, selectedTaken, selectedProofPrice, selectedProofBar]
```

Do not write the result back into `RawZone`; it is a read-only visual projection.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run the Step 2 command again. Expected: `1 passed` with remaining tests deselected.

- [ ] **Step 5: Run the complete static file**

```bash
pytest -q tests/static/test_rd_three_entry_pine.py
```

Expected: all tests pass. Renderer-contract changes belong only in Task 2.

- [ ] **Step 6: Commit Task 1**

```bash
git add scripts/pinescript/SND_RD_5M_V3_THREE_ENTRY_LAB.pine tests/static/test_rd_three_entry_pine.py
git commit -m "feat: select closest display liquidity per zone"
```

---

### Task 2: Render one winning liquidity path per zone

**Files:**
- Modify: `tests/static/test_rd_three_entry_pine.py:115-170`
- Modify: `tests/static/test_rd_three_entry_pine.py:585-635`
- Modify: `tests/static/test_rd_three_entry_pine.py:1380-1450`
- Modify: `scripts/pinescript/SND_RD_5M_V3_THREE_ENTRY_LAB.pine:788-877`

**Interfaces:**
- Consumes: `liquidityDisplaySelection` from Task 1, `liquidityDrawingRightBar`, `liquiditySafeDrawingBar`, and existing zone-owned drawing fields.
- Produces: one active primary object in `zone.liquidityLine`; `zone.structureLiquidityLine` is never created and is deleted when encountered; `zone.ownExtremeLine` exists only for a strict winner.

- [ ] **Step 1: Write the failing unified-renderer test**

```python
def test_pine_v3_renders_only_the_selected_zone_liquidity_candidate() -> None:
    pine = source()
    drawing = section(pine, "updateZoneDrawing(", "addUniqueLiquidityIndex(")

    assert (
        "[strictSelected, structureSelected, selectedPrice, selectedBar, "
        "selectedTaken, selectedProofPrice, selectedProofBar] = "
        "liquidityDisplaySelection(zone)"
        in drawing
    )
    assert "bool displayLiquidityVisible =" in drawing
    assert "liquidityDrawingRightBar(zone, selectedPrice, selectedBar)" in drawing
    assert "math.max(zone.originBar, selectedBar)" in drawing
    assert (
        "zone.liquidityLine := line.new(displayLeftBar, selectedPrice, "
        "displayRightBar, selectedPrice"
        in drawing
    )
    assert "line.set_xy1(zone.liquidityLine, displayLeftBar, selectedPrice)" in drawing
    assert "line.set_xy2(zone.liquidityLine, displayRightBar, selectedPrice)" in drawing
    assert "zone.structureLiquidityLine := line.new(" not in drawing
    assert "line.delete(zone.structureLiquidityLine)" in drawing
    assert "bool proofVisible = strictSelected and showLiquidityProofLines" in drawing
    assert "liquidityPriceLabelText(selectedPrice)" in drawing
```

- [ ] **Step 2: Replace obsolete structure-slot assertions**

Keep tests proving structural detection and `structureLiquidityPrice` storage, but replace assertions requiring `zone.structureLiquidityLine := line.new(...)`. Update final layering expectations to:

```python
assert "line.copy(zone.ownExtremeLine)" in final_drawing_pass
assert "line.copy(zone.liquidityLine)" in final_drawing_pass
assert "label.copy(zone.liquidityLabel)" in final_drawing_pass
assert "line.copy(zone.structureLiquidityLine)" not in final_drawing_pass
```

Update strict-path tests that refer to `liquidityLeftBar`, `liquidityRightBar`, `zone.liquidityExtreme`, `zone.liquidityAnchor`, or `proofLeftBar` inside `updateZoneDrawing` so they assert the unified selected values instead:

```python
assert (
    "zone.liquidityLine := line.new(displayLeftBar, selectedPrice, "
    "displayRightBar, selectedPrice"
    in drawing
)
assert "line.set_xy2(zone.liquidityLine, displayRightBar, selectedPrice)" in drawing
assert (
    "zone.ownExtremeLine := line.new(proofLeftBar, selectedProofPrice, "
    "displayRightBar, selectedProofPrice"
    in drawing
)
assert "liquidityPriceLabelText(selectedPrice)" in drawing
```

Do not change the `Raw audit` assertions for `LiquidityLevel` objects; that renderer remains separate and unchanged.

- [ ] **Step 3: Run focused renderer tests and verify RED**

```bash
pytest -q tests/static/test_rd_three_entry_pine.py -k "renders_only_the_selected_zone_liquidity_candidate or structure_liquidity or final_chart_bar"
```

Expected: FAIL because the renderer still maintains separate strict and structural line paths.

- [ ] **Step 4: Replace both render blocks with one winner-driven lifecycle**

Replace `structureAvailable`, `structurePreferred`, `zoneLiquidityVisible`, and `structureLiquidityVisible` drawing logic with:

```pine
    [strictSelected, structureSelected, selectedPrice, selectedBar, selectedTaken, selectedProofPrice, selectedProofBar] = liquidityDisplaySelection(zone)
    bool displayLiquidityVisible = visible and showLiquidityLines and displayMode != DISPLAY_RAW_AUDIT and (displayMode != DISPLAY_SETUPS_ONLY or zone.setupState == SETUP_ARMED) and (strictSelected or structureSelected) and not na(selectedPrice) and not na(selectedBar)
    if displayLiquidityVisible
        int displayRightBar = liquiditySafeDrawingBar(liquidityDrawingRightBar(zone, selectedPrice, selectedBar))
        int displayLeftBar = liquiditySafeDrawingBar(math.max(zone.originBar, selectedBar))
        color displayColor = selectedTaken ? liquiditySweptColor : liquidityPendingColor
        string displayStyle = selectedTaken ? line.style_dashed : line.style_solid
        if na(zone.liquidityLine)
            zone.liquidityLine := line.new(displayLeftBar, selectedPrice, displayRightBar, selectedPrice, xloc = xloc.bar_index, extend = extend.none, color = displayColor, style = displayStyle, width = liquidityPrimaryLineWidth)
        else
            line.set_xy1(zone.liquidityLine, displayLeftBar, selectedPrice)
            line.set_xy2(zone.liquidityLine, displayRightBar, selectedPrice)
            line.set_color(zone.liquidityLine, displayColor)
            line.set_style(zone.liquidityLine, displayStyle)
            line.set_width(zone.liquidityLine, liquidityPrimaryLineWidth)
        if not na(zone.structureLiquidityLine)
            line.delete(zone.structureLiquidityLine)
            zone.structureLiquidityLine := na

        if showLiquidityPriceLabels
            string displayLabelText = liquidityPriceLabelText(selectedPrice)
            color displayLabelTextColor = selectedTaken ? color.white : color.black
            if na(zone.liquidityLabel)
                zone.liquidityLabel := label.new(displayRightBar, selectedPrice, displayLabelText, xloc = xloc.bar_index, yloc = yloc.price, style = label.style_label_left, color = displayColor, textcolor = displayLabelTextColor, size = size.tiny)
            else
                label.set_xy(zone.liquidityLabel, displayRightBar, selectedPrice)
                label.set_text(zone.liquidityLabel, displayLabelText)
                label.set_color(zone.liquidityLabel, displayColor)
                label.set_textcolor(zone.liquidityLabel, displayLabelTextColor)
        else if not na(zone.liquidityLabel)
            label.delete(zone.liquidityLabel)
            zone.liquidityLabel := na

        bool proofVisible = strictSelected and showLiquidityProofLines and not na(selectedProofPrice) and not na(selectedProofBar)
        if proofVisible
            int proofLeftBar = liquiditySafeDrawingBar(math.max(zone.originBar, selectedProofBar))
            color proofColor = premiumVisuals ? color.new(color.gray, selectedTaken ? 45 : 12) : liquiditySecondaryColor
            string proofStyle = selectedTaken ? line.style_solid : line.style_dashed
            if na(zone.ownExtremeLine)
                zone.ownExtremeLine := line.new(proofLeftBar, selectedProofPrice, displayRightBar, selectedProofPrice, xloc = xloc.bar_index, extend = extend.none, color = proofColor, style = proofStyle, width = 1)
            else
                line.set_xy1(zone.ownExtremeLine, proofLeftBar, selectedProofPrice)
                line.set_xy2(zone.ownExtremeLine, displayRightBar, selectedProofPrice)
                line.set_color(zone.ownExtremeLine, proofColor)
                line.set_style(zone.ownExtremeLine, proofStyle)
                line.set_width(zone.ownExtremeLine, 1)
        else if not na(zone.ownExtremeLine)
            line.delete(zone.ownExtremeLine)
            zone.ownExtremeLine := na
    else
        if not na(zone.liquidityLine)
            line.delete(zone.liquidityLine)
            zone.liquidityLine := na
        if not na(zone.structureLiquidityLine)
            line.delete(zone.structureLiquidityLine)
            zone.structureLiquidityLine := na
        if not na(zone.ownExtremeLine)
            line.delete(zone.ownExtremeLine)
            zone.ownExtremeLine := na
        if not na(zone.liquidityLabel)
            label.delete(zone.liquidityLabel)
            zone.liquidityLabel := na
```

Keep `updateLiquidityDrawings(...)` unchanged because it is the `Raw audit` renderer.

- [ ] **Step 5: Remove obsolete final layering for the structural slot**

Delete this branch only:

```pine
if not na(zone.structureLiquidityLine)
    line raisedStructureLiquidityLine = line.copy(zone.structureLiquidityLine)
    line.delete(zone.structureLiquidityLine)
    zone.structureLiquidityLine := raisedStructureLiquidityLine
```

Keep `deleteZone` and unified-renderer cleanup for safe hot updates.

- [ ] **Step 6: Run focused renderer tests and verify GREEN**

Run the Step 3 command again. Expected: all selected tests pass.

- [ ] **Step 7: Run the complete static file**

```bash
pytest -q tests/static/test_rd_three_entry_pine.py
```

Expected: all tests pass. The existing `asyncio_mode` warning may remain; no new warnings are allowed.

- [ ] **Step 8: Commit Task 2**

```bash
git add scripts/pinescript/SND_RD_5M_V3_THREE_ENTRY_LAB.pine tests/static/test_rd_three_entry_pine.py
git commit -m "fix: render one closest liquidity line per zone"
```

---

### Task 3: Verify safety boundaries and TradingView behavior

**Files:**
- Verify: `scripts/pinescript/SND_RD_5M_V3_THREE_ENTRY_LAB.pine`
- Verify: `tests/static/test_rd_three_entry_pine.py`
- Reference: `docs/superpowers/specs/2026-08-06-zone-specific-closest-liquidity-display-design.md`

**Interfaces:**
- Consumes: completed selector and unified renderer from Tasks 1 and 2.
- Produces: verified Pine source ready for TradingView.

- [ ] **Step 1: Run the complete regression suite**

```bash
pytest -q tests/static/test_rd_three_entry_pine.py
```

Expected: all tests pass with zero failures.

- [ ] **Step 2: Check formatting and inspect the scoped diff**

```bash
git diff --check -- scripts/pinescript/SND_RD_5M_V3_THREE_ENTRY_LAB.pine tests/static/test_rd_three_entry_pine.py
git diff -- scripts/pinescript/SND_RD_5M_V3_THREE_ENTRY_LAB.pine tests/static/test_rd_three_entry_pine.py
```

Expected: `git diff --check` produces no output. Confirm the selector never writes strict qualification, setup, entry, alert, export, or payload fields.

- [ ] **Step 3: Compile the complete source in TradingView**

Replace the entire Pine Editor contents with `scripts/pinescript/SND_RD_5M_V3_THREE_ENTRY_LAB.pine` and choose **Update on chart**.

Expected: Pine v6 compilation succeeds, no `RE10026` appears, and each visible fresh zone has at most one primary liquidity line.

- [ ] **Step 4: Validate candidate arbitration on the reference chart**

For a zone with both candidates:

1. Measure strict and structural distance from the proximal edge.
2. Confirm the displayed line has the smaller positive distance.
3. Turn `Show bigger-structure liquidity` off and confirm the valid strict line appears.
4. Turn it on and confirm the display changes only when structure is closer.
5. Confirm separate visible zones retain separate lines.

- [ ] **Step 5: Validate object lifecycle**

Advance replay until a closer candidate confirms, or compare chart points where the winner differs.

Expected: the existing line moves to the winner, the old line disappears, labels follow the winner, and proof lines disappear for a structural winner.

- [ ] **Step 6: Commit only if verification exposes a missing regression**

Add a failing test first, apply the smallest correction, rerun the complete suite, then:

```bash
git add scripts/pinescript/SND_RD_5M_V3_THREE_ENTRY_LAB.pine tests/static/test_rd_three_entry_pine.py
git commit -m "test: cover closest liquidity chart regression"
```

If no correction is needed, do not create an empty commit.
