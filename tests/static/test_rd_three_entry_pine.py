import re
from pathlib import Path

PINE = Path("scripts/pinescript/SND_RD_5M_V3_THREE_ENTRY_LAB.pine")
PARITY = Path("apps/observation-edge/test/rd-entry-pine-v3-parity.test.ts")


def source() -> str:
    return PINE.read_text()


def section(text: str, start: str, end: str) -> str:
    start_at = text.index(start)
    return text[start_at : text.index(end, start_at)]


def assigned_expression(text: str, target: str) -> str:
    match = re.search(rf"^\s*{re.escape(target)}\s*:=\s*(.+)$", text, re.MULTILINE)
    assert match is not None, f"missing assignment for {target}"
    return match.group(1).strip()


def sibling_order_from_pine_unshifts(materializer: str) -> list[str]:
    source_insertions = sorted(
        [
            (materializer.index("array.unshift(zoneItems, standardZone)"), "standard"),
            (materializer.index("array.unshift(zoneItems, accuracyZone)"), "accuracy"),
        ]
    )
    zone_order: list[str] = []
    for _, geometry in source_insertions:
        zone_order.insert(0, geometry)
    return zone_order


def test_pine_v3_materializes_standard_and_accuracy_variants_from_one_confirmation() -> None:
    pine = source()
    raw_zone = section(pine, "type RawZone", "type EntryCore")
    assert "appendConfirmedZoneVariants(" in pine
    formation_id = section(
        pine, "candidateFormationId(", "candidateHasAccuracyGeometry("
    )
    builder = section(pine, "buildConfirmedZone(", "appendConfirmedZoneVariants(")
    materializer = section(
        pine, "appendConfirmedZoneVariants(", "zoneDistanceFromPrice("
    )
    diagnostics = section(pine, "diagnosticPayload(", "validationBatch("
    )
    confirmations = section(
        pine,
        "int direction = candleDirection(0)",
        "// Capture finalized same-bar transitions",
    )

    assert "string formationId" in raw_zone
    assert "candidateFormationId(" in pine
    assert '"RD3_FORMATION:"' in formation_id
    assert "syminfo.tickerid" in formation_id
    assert "timeframe.period" in formation_id
    assert 'demand ? "D:" : "S:"' in formation_id
    assert "candidate.originTime" in formation_id
    assert "originBar" not in formation_id
    assert (
        "buildConfirmedZone(Candidate candidate, bool demand, int zoneId, "
        "string formation, string formationId, bool accuracy)"
        in pine
    )
    assert "zone.formationId := formationId" in builder
    assert confirmations.count("appendConfirmedZoneVariants(") == 2
    assert confirmations.count("eventZone := standardZone") == 2
    assert confirmations.count("nextZoneId += createdCount") == 2
    assert materializer.count(
        "buildConfirmedZone(candidate, demand, nextZoneId, formation, "
        "formationId, false)"
    ) == 1
    assert materializer.count("candidateHasAccuracyGeometry(candidate, demand)") == 1
    assert materializer.count(
        "buildConfirmedZone(candidate, demand, nextZoneId + 1, formation, "
        "formationId, true)"
    ) == 1
    assert "array.unshift(zoneItems, standardZone)" in materializer
    assert "array.unshift(zoneItems, accuracyZone)" in materializer
    assert "int createdCount = 1" in materializer
    assert "createdCount := 2" in materializer
    assert "[standardZone, createdCount]" in materializer
    assert sibling_order_from_pine_unshifts(materializer) == ["standard", "accuracy"]
    for fresh_array in (
        "zone.liquidityIndexes := array.new<int>()",
        "zone.structureLiquidityIndexes := array.new<int>()",
        "zone.setupExportFromStates := array.new<string>()",
        "zone.setupExportToStates := array.new<string>()",
        "zone.setupExportReasons := array.new<string>()",
    ):
        assert fresh_array in builder
    for fresh_drawing in (
        "zone.zoneBox := na",
        "zone.liquidityLine := na",
        "zone.ownExtremeLine := na",
        "zone.structureLiquidityLine := na",
        "zone.liquidityLabel := na",
        "zone.debugLabel := na",
    ):
        assert fresh_drawing in builder
    assert '"\\"formation_id\\":\\"" + zone.formationId + "\\","' in diagnostics


def test_pine_v3_standard_sibling_claims_the_final_attempt_slot_at_119_of_120() -> None:
    pine = source()
    materializer = section(
        pine, "appendConfirmedZoneVariants(", "zoneDistanceFromPrice("
    )
    attempt_scan = section(
        pine, "materializeEngagedEntryAttempts(", "commonRuleResultsPayload("
    )
    cap_match = re.search(r"const int ENTRY_MAX_ATTEMPTS = (\d+)", pine)

    assert cap_match is not None
    assert "for zoneIndex = 0 to zoneCount - 1" in attempt_scan
    assert "RawZone zone = array.get(zoneItems, zoneIndex)" in attempt_scan
    assert attempt_scan.index("array.get(zoneItems, zoneIndex)") < attempt_scan.index(
        "ensureEntryAttempt(zone)"
    )

    cap = int(cap_match.group(1))
    attempt_count = cap - 1
    accepted: list[str] = []
    for geometry in sibling_order_from_pine_unshifts(materializer):
        if attempt_count < cap:
            accepted.append(geometry)
            attempt_count += 1

    assert cap == 120
    assert accepted == ["standard"]
    assert attempt_count == cap


def test_pine_v3_standard_sibling_survives_one_zone_retention() -> None:
    pine = source()
    materializer = section(
        pine, "appendConfirmedZoneVariants(", "zoneDistanceFromPrice("
    )
    eviction = section(
        pine, "evictOldestUnprotectedZone(", "if barstate.isfirst"
    )

    assert "int scanIndex = array.size(zoneItems) - 1" in eviction
    assert "array.remove(zoneItems, scanIndex)" in eviction

    retained = sibling_order_from_pine_unshifts(materializer)
    while len(retained) > 1:
        scan_index = len(retained) - 1
        retained.pop(scan_index)

    assert retained == ["standard"]


def test_pine_v3_clean_view_keeps_tapped_standard_zone_at_its_touch_endpoint() -> None:
    pine = source()
    curated_view = section(
        pine, "zoneIncludedInCuratedView(", "setupZoneRanksAhead("
    )
    zone_visible = section(pine, "zoneVisible(", "zoneBaseColor(")

    assert (
        'showTapped = input.bool(true, "Show tapped zones", group = "Display")'
        in pine
    )
    assert (
        "bool lifecycleIncluded = zone.state == STATE_FRESH ? showFresh : "
        "zone.state == STATE_TAPPED ? showTapped : showInvalidated"
        in curated_view
    )
    assert (
        "lifecycleIncluded and (displayMode != DISPLAY_QUALIFIED_ONLY or "
        "zone.liquidityQualified)"
        in curated_view
    )
    assert "showFresh and zoneIncludedInCuratedView(zone)" not in zone_visible


def test_pine_v3_declares_the_closed_three_model_contract() -> None:
    pine = source()

    assert 'const string ENTRY_MODEL_BOC = "BOC"' in pine
    assert 'const string ENTRY_MODEL_CLOSE = "DIR_CLOSE"' in pine
    assert 'const string ENTRY_MODEL_FLIP = "HTF_FLIP"' in pine
    assert 'const string ENTRY_SCHEMA_VERSION = "3.1"' in pine
    assert 'const string ENTRY_STRATEGY_VERSION = "3.1.0-contract3"' in pine
    assert 'const string ENTRY_RULE_CONTRACT_VERSION = "3.1.0"' in pine


def test_pine_v3_liquidity_lines_stop_at_the_first_touch_or_sweep_bar() -> None:
    pine = source()
    endpoint = section(
        pine, "liquidityFirstVisualSweepBar(", "liquidityDistanceToZone("
    )
    zone_drawing = section(pine, "updateZoneDrawing(", "addUniqueLiquidityIndex(")
    raw_audit_drawing = section(pine, "updateLiquidityDrawings(", "diagnosticPayload(")

    assert "liquidityFirstVisualSweepBar(" in endpoint
    assert "int rangeStart = priceBar + 1" in endpoint
    assert "int rangeEnd = zone.state == STATE_FRESH ? bar_index : zone.stateBar" in endpoint
    assert "zone.demand ? low[sourceOffset] <= price : high[sourceOffset] >= price" in endpoint
    assert "zone.demand ? low[sourceOffset] < price : high[sourceOffset] > price" not in endpoint
    assert (
        "not na(firstVisualSweepBar) "
        "? firstVisualSweepBar "
        ": zoneRightBar(zone)"
    ) in endpoint
    assert (
        "int liquidityRightBar = liquiditySafeDrawingBar(liquidityDrawingRightBar("
        "zone, zone.liquidityExtreme, zone.liquidityExtremeBar))"
    ) in zone_drawing
    assert (
        "int rightBar = liquiditySafeDrawingBar(liquidityDrawingRightBar("
        "ownerZone, level.nearExtreme, level.nearExtremeBar))"
    ) in raw_audit_drawing


def test_pine_v3_clips_historical_liquidity_coordinates_to_the_bar_index_window() -> None:
    pine = source()
    helper = section(
        pine, "liquiditySafeDrawingBar(", "liquidityFirstVisualSweepBar("
    )
    zone_drawing = section(pine, "updateZoneDrawing(", "addUniqueLiquidityIndex(")
    audit_drawing = section(pine, "updateLiquidityDrawings(", "diagnosticPayload(")

    assert "math.max(sourceBar, bar_index - 9999)" in helper
    assert (
        "int liquidityLeftBar = liquiditySafeDrawingBar("
        "math.max(zone.originBar, zone.liquidityExtremeBar))"
    ) in zone_drawing
    assert (
        "int proofLeftBar = liquiditySafeDrawingBar("
        "math.max(zone.originBar, zone.liquidityAnchorBar))"
    ) in zone_drawing
    assert (
        "int structureLeftBar = liquiditySafeDrawingBar("
        "math.max(zone.originBar, zone.structureLiquidityBar))"
    ) in zone_drawing
    assert (
        "int structureRightBar = liquiditySafeDrawingBar(liquidityDrawingRightBar("
        "zone, zone.structureLiquidityPrice, zone.structureLiquidityBar))"
    ) in zone_drawing
    assert (
        "int liquidityLeftBar = liquiditySafeDrawingBar("
        "math.max(ownerZone.originBar, level.nearExtremeBar))"
    ) in audit_drawing
    assert (
        "int proofLeftBar = liquiditySafeDrawingBar("
        "math.max(ownerZone.originBar, level.anchorBar))"
    ) in audit_drawing


def test_pine_v3_clips_zone_box_coordinates_to_the_bar_index_window() -> None:
    pine = source()
    zone_drawing = section(pine, "updateZoneDrawing(", "bool structureAvailable =")

    assert "int leftBar = liquiditySafeDrawingBar(zone.originBar)" in zone_drawing
    assert (
        "int rightBar = liquiditySafeDrawingBar(zoneRightBar(zone))"
        in zone_drawing
    )
    assert (
        "zone.zoneBox := box.new(leftBar, zone.top, rightBar, zone.bottom"
        in zone_drawing
    )
    assert "box.set_left(zone.zoneBox, leftBar)" in zone_drawing
    assert "box.set_right(zone.zoneBox, rightBar)" in zone_drawing
    assert "zone.debugLabel := label.new(leftBar," in zone_drawing


def test_pine_v3_proof_lines_share_the_primary_line_lifecycle_endpoint() -> None:
    pine = source()
    zone_drawing = section(pine, "updateZoneDrawing(", "addUniqueLiquidityIndex(")
    audit_drawing = section(pine, "updateLiquidityDrawings(", "diagnosticPayload(")

    assert (
        "zone.ownExtremeLine := line.new(proofLeftBar, zone.liquidityAnchor, "
        "liquidityRightBar, zone.liquidityAnchor"
        in zone_drawing
    )
    assert (
        "line.set_xy2(zone.ownExtremeLine, liquidityRightBar, zone.liquidityAnchor)"
        in zone_drawing
    )
    assert (
        "level.ownExtremeLine := line.new(proofLeftBar, level.anchor, "
        "rightBar, level.anchor"
        in audit_drawing
    )
    assert (
        "line.set_xy2(level.ownExtremeLine, rightBar, level.anchor)"
        in audit_drawing
    )


def test_pine_v3_renders_the_retracement_swing_as_the_canonical_liquidity_line() -> None:
    pine = source()
    zone_drawing = section(pine, "bool zoneLiquidityVisible =", "bool structureLiquidityVisible =")
    audit_drawing = section(pine, "updateLiquidityDrawings(", "diagnosticPayload(")

    assert (
        "int liquidityLeftBar = liquiditySafeDrawingBar("
        "math.max(zone.originBar, zone.liquidityExtremeBar))"
    ) in zone_drawing
    assert (
        "zone.liquidityLine := line.new(liquidityLeftBar, zone.liquidityExtreme, "
        "liquidityRightBar, zone.liquidityExtreme"
        in zone_drawing
    )
    assert "liquidityPriceLabelText(zone.liquidityExtreme)" in zone_drawing
    assert (
        "int liquidityLeftBar = liquiditySafeDrawingBar("
        "math.max(ownerZone.originBar, level.nearExtremeBar))"
    ) in audit_drawing
    assert (
        "level.liquidityLine := line.new(liquidityLeftBar, level.nearExtreme, "
        "rightBar, level.nearExtreme"
        in audit_drawing
    )
    assert "liquidityPriceLabelText(level.nearExtreme)" in audit_drawing


def test_pine_v3_reference_distance_uses_thirty_percent_of_the_full_distal_zone_impulse() -> None:
    pine = source()
    guidance = section(
        pine, "liquidityStructureMove(", "liquidityDistanceFidelity("
    )
    support = section(pine, "liquiditySupportsZone(", "liquidityRanksCloser(")

    assert (
        'liquidityStructureMaxDistancePercent = input.float(30.0, '
        '"Bigger structure max distance (% of move)", '
        'minval = 1.0, maxval = 100.0, step = 1.0, group = "Liquidity")'
        in pine
    )
    assert "liquidityStructureMove(RawZone zone, float bosLevel)" in guidance
    assert (
        "zone.demand ? bosLevel - zone.bottom : zone.top - bosLevel"
        in guidance
    )
    assert "zone.demand ? bosLevel - zone.top : zone.bottom - bosLevel" not in guidance
    assert "firstDepartureHigh" not in guidance
    assert "firstDepartureLow" not in guidance
    assert (
        "liquidityStructureMove(zone, bosLevel) * "
        "liquidityStructureMaxDistancePercent * 0.01"
        in guidance
    )
    assert "float guidanceMax = liquidityGuidanceMaxPrice(zone, level.anchor)" in support
    assert (
        "distance <= guidanceMax + syminfo.mintick * 0.5"
        in support
    )


def test_pine_v3_strict_liquidity_prefers_the_latest_valid_pivot() -> None:
    pine = source()
    arbitration = section(
        pine,
        "liquidityRanksCloser(",
        "zoneText(",
    )

    assert "bool newer = candidate.nearExtremeBar > primary.nearExtremeBar" in arbitration
    assert "bool sameBar = candidate.nearExtremeBar == primary.nearExtremeBar" in arbitration
    assert (
        "newer or (sameBar and candidateDistance < primaryDistance - syminfo.mintick * 0.5)"
        in arbitration
    )


def test_pine_v3_builds_structure_liquidity_from_video_retracement_evidence() -> None:
    pine = source()
    detector = section(
        pine,
        "confirmedStructureLiquidityPivot(",
        "refreshZoneStructureLiquidity(",
    )
    refresh = section(
        pine,
        "refreshZoneStructureLiquidity(",
        "zoneLiquidityTakenBar(",
    )

    assert "type StructureLiquidityLevel" in pine
    assert "int strength = liquidityPivotStrength" in detector
    assert "int strength = liquidityPivotStrength" in refresh
    assert "enableOneCandleLiquidity ? 1 : liquidityPivotStrength" not in pine
    assert "low[offset] < center" in detector
    assert "high[offset] > center" in detector
    assert "liquidityLegProof(demand, strength)" in detector
    assert "oppositeCandleCount >= minimumLiquidityOppositeCandles()" in detector
    assert "level.oppositeCandleCount := oppositeCandleCount" in detector
    assert "level.bosLevel := ownExtreme" in detector
    assert "level.bosLevelBar := ownExtremeBar" in detector
    assert (
        "level.cohort := oppositeCandleCount == 1 "
        "? LIQUIDITY_COHORT_ONE : LIQUIDITY_COHORT_TWO_PLUS"
    ) in detector


def test_pine_v3_micro_retracement_candidate_requires_one_opposite_candle_and_immediate_bos() -> None:
    pine = source()
    producer = section(
        pine,
        "confirmedMicroStructureLiquidity(",
        "refreshStructureLiquidityMoveReference(",
    )
    symmetric_append = section(
        pine,
        "appendConfirmedStructureLiquidityPivot(",
        "confirmedMicroStructureLiquidity(",
    )
    micro_append = section(
        producer,
        "appendConfirmedMicroStructureLiquidity(",
        "updateConfirmedStructureLiquidityPivots(",
    )
    update = section(
        pine,
        "updateConfirmedStructureLiquidityPivots(",
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
    assert "array.push(levels, level)" in micro_append
    assert "array.push(createdIndexes, array.size(levels) - 1)" in micro_append
    assert "level.microRetracement := false" in symmetric_append
    assert "if confirmedStructureLiquidityPivot(true, strength)" in update
    assert (
        "appendConfirmedStructureLiquidityPivot(true, strength, levels, createdIndexes)"
        in update
    )
    assert "if confirmedStructureLiquidityPivot(false, strength)" in update
    assert (
        "appendConfirmedStructureLiquidityPivot(false, strength, levels, createdIndexes)"
        in update
    )
    assert "if confirmedMicroStructureLiquidity(true)" in producer
    assert "if confirmedMicroStructureLiquidity(false)" in producer


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
    retracement_evidence = re.search(
        r"^\s*bool hasRetracementEvidence\s*=\s*(.+)$", refresh, re.MULTILINE
    )
    assert retracement_evidence is not None
    assert retracement_evidence.group(1).strip().endswith("and candleCountQualified")
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


def test_pine_v3_micro_retracement_includes_the_immediate_pre_swing_move_bar() -> None:
    pine = source()
    move_reference = section(
        pine,
        "structureLiquidityCandidateMoveReference(",
        "structureLiquidityBosConfirmed(",
    )
    refresh = section(
        pine,
        "refreshZoneStructureLiquidity(",
        "zoneLiquidityTakenBar(",
    )

    # Reproduces an early candidate: confirmation=08:30, pause=08:35,
    # continuation=08:40. The normal strength-2 cache reaches only 08:25,
    # while the candidate-specific pre-swing reference must include 08:30.
    confirmation_bar = 100
    pause_bar = 101
    continuation_bar = 102
    strength = 2
    assert continuation_bar - (strength + 1) < confirmation_bar
    assert pause_bar - 1 == confirmation_bar

    assert "float candidateMoveLevel = zone.structureMoveExtreme" in move_reference
    assert "int candidateMoveLevelBar = zone.structureMoveExtremeBar" in move_reference
    assert "if candidate.microRetracement" in move_reference
    assert "int preSwingBar = candidate.priceBar - 1" in move_reference
    assert "int preSwingOffset = bar_index - preSwingBar" in move_reference
    assert "preSwingBar >= zone.confirmationBar" in move_reference
    assert "preSwingOffset >= 0 and preSwingOffset < 5000" in move_reference
    assert (
        "float preSwingExtreme = zone.demand ? high[preSwingOffset] "
        ": low[preSwingOffset]"
        in move_reference
    )
    assert "zone.demand ? preSwingExtreme > candidateMoveLevel" in move_reference
    assert ": preSwingExtreme < candidateMoveLevel" in move_reference
    assert "[candidateMoveLevel, candidateMoveLevelBar]" in move_reference
    assert (
        "[candidateMoveLevel, candidateMoveLevelBar] = "
        "structureLiquidityCandidateMoveReference(zone, candidate)"
        in refresh
    )
    for forbidden in (
        "liquidityPrimaryIndex",
        "liquidityQualified",
        "eligibilityState",
        "setupState",
        "entryAttempts",
        "alertcondition(",
        "diagnosticPayload(",
    ):
        assert forbidden not in move_reference


def test_pine_v3_anchors_structure_liquidity_to_the_confirmed_pivot() -> None:
    pine = source()
    structure = section(
        pine,
        "appendConfirmedStructureLiquidityPivot(",
        "updateConfirmedStructureLiquidityPivots(",
    )

    assert (
        "[oppositeCandleCount, ownExtreme, ownExtremeBar, _, _] = "
        "liquidityLegProof(demand, strength)"
        in structure
    )
    assert "level.price := demand ? low[strength] : high[strength]" in structure
    assert "level.priceBar := bar_index - strength" in structure
    assert "level.price := legNearExtreme" not in structure
    assert "level.priceBar := legNearExtremeBar" not in structure


def test_pine_v3_stops_the_reversal_bridge_at_the_first_opposite_candle() -> None:
    pine = source()
    leg_proof = section(pine, "liquidityLegProof(", "confirmedLiquidityPivot(")

    assert (
        "bool insideReversalBridge = na(firstLegOffset) and bridgeAvailable"
        in leg_proof
    )
    assert "if insideReversalBridge" in leg_proof
    assert (
        "if liquidityCandleIsOpposite(demand, bridgeSourceOffset)\n"
        "                firstLegOffset := bridgeSourceOffset"
        in leg_proof
    )
    assert (
        "if bridgeAvailable\n"
        "            float candidateNearExtreme"
        not in leg_proof
    )


def test_pine_v3_caches_the_full_zone_linked_impulse_incrementally() -> None:
    pine = source()
    assert "refreshStructureLiquidityMoveReference(" in pine
    reference = section(
        pine,
        "refreshStructureLiquidityMoveReference(",
        "structureLiquidityBosConfirmed(",
    )
    refresh = section(
        pine,
        "refreshZoneStructureLiquidity(",
        "zoneLiquidityTakenBar(",
    )

    assert "float structureMoveExtreme" in pine
    assert "int structureMoveExtremeBar" in pine
    assert "int sourceOffset = strength + 1" in reference
    assert "int sourceBar = bar_index - sourceOffset" in reference
    assert "sourceBar >= zone.confirmationBar" in reference
    assert (
        "float candidateExtreme = zone.demand "
        "? high[sourceOffset] : low[sourceOffset]"
    ) in reference
    assert (
        "zone.demand ? candidateExtreme > extreme "
        ": candidateExtreme < extreme"
    ) in reference
    assert "zone.structureMoveExtreme := candidateExtreme" in reference
    assert "zone.structureMoveExtremeBar := sourceBar" in reference
    assert "for sourceBar" not in reference
    assert "refreshStructureLiquidityMoveReference(zone, strength)" in refresh
    assert "int candidateCount = array.size(createdIndexes)" in refresh
    assert "scanHistory" not in refresh
    assert "array.size(levels)" not in refresh


def test_pine_v3_requires_zone_linked_continuation_bos_for_structure_liquidity() -> None:
    pine = source()
    bos = section(
        pine,
        "structureLiquidityBosConfirmed(",
        "refreshZoneStructureLiquidity(",
    )
    refresh = section(
        pine,
        "refreshZoneStructureLiquidity(",
        "zoneLiquidityTakenBar(",
    )

    assert (
        'liquidityStructureStrictBos = input.bool(false, '
        '"Strict structural BOS (close beyond level)", group = "Liquidity")'
        in pine
    )
    assert "float bosLevel = candidate.bosLevel" in bos
    assert "firstDepartureHigh" not in bos
    assert "firstDepartureLow" not in bos
    assert "candidate.priceBar + 1" in bos
    assert "liquidityStructureStrictBos ? close[sourceOffset] > bosLevel : high[sourceOffset] > bosLevel" in bos
    assert "liquidityStructureStrictBos ? close[sourceOffset] < bosLevel : low[sourceOffset] < bosLevel" in bos
    assert "for sourceBar" not in bos
    assert "candidate.priceBar > zone.confirmationBar" in refresh
    assert (
        "[candidateMoveLevel, candidateMoveLevelBar] = "
        "structureLiquidityCandidateMoveReference(zone, candidate)"
        in refresh
    )
    assert "float completedMoveLevel = zone.structureMoveExtreme" in refresh
    assert "float guidanceMax = liquidityGuidanceMaxPrice(zone, completedMoveLevel)" in refresh
    assert "bool zoneStillUntouched = not structureLiquidityZoneTouched(zone)" in refresh
    assert "addUniqueLiquidityIndex(zone.structureLiquidityIndexes, candidateIndex)" in refresh
    assert "structureLiquidityBosConfirmed(zone, candidate)" in refresh
    assert "structureLiquidityBosLevels" not in refresh
    assert "bosBar > candidate.priceBar" in refresh
    assert "zone.structureLiquidityBosLevel := bosLevel" in refresh
    assert "zone.structureLiquidityBosBar := bosBar" in refresh


def test_pine_v3_micro_structure_bos_is_immediate_and_cannot_retro_confirm() -> None:
    pine = source()
    bos = section(
        pine,
        "structureLiquidityBosConfirmed(",
        "refreshZoneStructureLiquidity(",
    )

    assert (
        "bool immediateMicroBos = candidate.microRetracement and "
        "bar_index == candidate.priceBar + 1 and brokeStructure"
        in bos
    )
    assert (
        "bool standardBos = not candidate.microRetracement and "
        "formedBeforeBos and brokeStructure"
        in bos
    )
    assert "bool confirmed = immediateMicroBos or standardBos" in bos
    assert "bar_index >= candidate.priceBar + 1" in bos
    assert (
        "liquidityStructureStrictBos ? close[sourceOffset] > bosLevel "
        ": high[sourceOffset] > bosLevel"
        in bos
    )
    assert (
        "liquidityStructureStrictBos ? close[sourceOffset] < bosLevel "
        ": low[sourceOffset] < bosLevel"
        in bos
    )
    assert "bool confirmed = formedBeforeBos and brokeStructure" not in bos


def test_pine_v3_qualifies_structure_distance_only_after_bos_completes_the_move() -> None:
    pine = source()
    refresh = section(
        pine,
        "refreshZoneStructureLiquidity(",
        "zoneLiquidityTakenBar(",
    )
    discovery = section(
        refresh,
        "int candidateCount = array.size(createdIndexes)",
        "int linkedCandidateCount = array.size(zone.structureLiquidityIndexes)",
    )
    qualification = section(
        refresh,
        "int linkedCandidateCount = array.size(zone.structureLiquidityIndexes)",
        "true",
    )

    # A structurally valid retracement must survive discovery even when its
    # distance cannot be qualified until the continuation/BOS candle closes.
    assert "withinBiggerStructure" not in discovery
    assert (
        "if formedAfterConfirmation and correctSide and "
        "hasRetracementEvidence and newZoneLink"
        in discovery
    )

    # The BOS candle completes the impulse used by the 30% rule. Qualification
    # belongs here, immediately before selecting the one canonical line.
    assert "float completedMoveLevel = zone.structureMoveExtreme" in qualification
    assert "float bosMoveExtreme = zone.demand ? high : low" in qualification
    assert "float guidanceMax = liquidityGuidanceMaxPrice(zone, completedMoveLevel)" in qualification
    assert "bool withinBiggerStructure = not na(guidanceMax)" in qualification
    assert "if bosAfterSwing and withinBiggerStructure and closer" in qualification


def test_pine_v3_allows_an_older_closer_swing_to_replace_a_provisional_selection() -> None:
    pine = source()
    refresh = section(
        pine,
        "refreshZoneStructureLiquidity(",
        "zoneLiquidityTakenBar(",
    )

    # A deeper swing can require a later BOS than a newer micro swing. Once the
    # older swing confirms, distance arbitration must be able to select it.
    assert "selectionOpen" not in refresh
    assert (
        "bool closer = na(zone.structureLiquidityPrice) or distance < "
        "currentDistance - syminfo.mintick * 0.5 or earlierAtSamePrice"
        in refresh
    )


def test_pine_v3_prefers_the_earlier_swing_when_structure_prices_are_equal() -> None:
    pine = source()
    refresh = section(
        pine,
        "refreshZoneStructureLiquidity(",
        "zoneLiquidityTakenBar(",
    )

    assert (
        "float currentDistance = liquidityPriceDistanceToZone("
        "zone, zone.structureLiquidityPrice)"
        in refresh
    )
    assert (
        "bool sameDistance = math.abs(distance - currentDistance) <= "
        "syminfo.mintick * 0.5"
        in refresh
    )
    assert (
        "bool earlierAtSamePrice = sameDistance and "
        "candidate.priceBar < zone.structureLiquidityBar"
        in refresh
    )
    assert (
        "bool closer = na(zone.structureLiquidityPrice) or distance < "
        "currentDistance - syminfo.mintick * 0.5 or earlierAtSamePrice"
        in refresh
    )


def test_pine_v3_bigger_structure_liquidity_cannot_qualify_entries() -> None:
    pine = source()
    shadow_refresh = section(
        pine,
        "refreshZoneStructureLiquidity(",
        "zoneLiquidityTakenBar(",
    )

    assert "zone.structureLiquidityPrice :=" in shadow_refresh
    assert "zone.structureLiquidityBar :=" in shadow_refresh
    assert "liquidityPrimaryIndex" not in shadow_refresh
    assert "liquidityQualified" not in shadow_refresh
    assert "setupState" not in shadow_refresh
    assert "updateZoneEligibility(" not in shadow_refresh


def test_pine_v3_uses_shared_visual_settings_for_bigger_structure_liquidity() -> None:
    pine = source()
    structure_drawing = section(
        pine, "bool structureLiquidityVisible =", "addUniqueLiquidityIndex("
    )

    assert (
        'showStructureLiquidityLines = input.bool(true, '
        '"Show bigger-structure liquidity (display only)", group = "Display")'
        in pine
    )
    assert "zone.structureLiquidityLine := line.new(" in structure_drawing
    assert "zone.structureLiquidityPrice" in structure_drawing
    assert (
        "int structureRightBar = liquiditySafeDrawingBar(liquidityDrawingRightBar("
        "zone, zone.structureLiquidityPrice, zone.structureLiquidityBar))"
        in structure_drawing
    )
    assert "color = liquidityPendingColor" in structure_drawing
    assert (
        "line.set_color(zone.structureLiquidityLine, liquidityPendingColor)"
        in structure_drawing
    )
    assert "width = liquidityPrimaryLineWidth" in structure_drawing
    assert (
        "line.set_width(zone.structureLiquidityLine, liquidityPrimaryLineWidth)"
        in structure_drawing
    )
    assert "if showLiquidityPriceLabels" in structure_drawing
    assert (
        "liquidityPriceLabelText(zone.structureLiquidityPrice)"
        in structure_drawing
    )


def test_pine_v3_prefers_one_canonical_structure_liquidity_line_per_zone() -> None:
    pine = source()
    zone_drawing = section(pine, "updateZoneDrawing(", "addUniqueLiquidityIndex(")

    assert (
        "bool structurePreferred = structureAvailable and "
        "showStructureLiquidityLines"
        in zone_drawing
    )
    zone_visibility = re.search(
        r"^\s*bool zoneLiquidityVisible = (.+)$", zone_drawing, re.MULTILINE
    )
    structure_visibility = re.search(
        r"^\s*bool structureLiquidityVisible = (.+)$", zone_drawing, re.MULTILINE
    )
    assert zone_visibility is not None
    assert structure_visibility is not None
    assert "and not structurePreferred" in zone_visibility.group(1)
    assert "and structurePreferred" in structure_visibility.group(1)
    assert "structureDistinctFromStrict" not in zone_drawing


def test_pine_v3_one_candle_liquidity_defaults_off() -> None:
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
        "level.cohort := oppositeCandleCount == 1 "
        "? LIQUIDITY_COHORT_ONE : LIQUIDITY_COHORT_TWO_PLUS"
    ) in pine
    assert 'attempt.core.liquidityCohort := zone.liquidityCohort' in pine
    assert '"\\\"liquidity_cohort\\\":" + jsonString(attempt.core.liquidityCohort)' in pine
    assert '"\\\"one_candle_enabled\\\":" + str.tostring(enableOneCandleLiquidity)' in pine
    assert (
        "attempt.core.ruleLiqOneCandleException := "
        "attempt.core.ruleLiqNormalTwoOppositeCandles or "
        "(enableOneCandleLiquidity and oppositeCandleCount == 1)"
    ) in pine


def test_pine_v3_user_defined_types_have_unique_fields() -> None:
    current_type = None
    fields: dict[str, set[str]] = {}
    for line in source().splitlines():
        if line.startswith("type "):
            current_type = line.split()[1]
            fields[current_type] = set()
        elif current_type is not None and line.startswith("    ") and " " in line.strip():
            field = line.strip().split()[1]
            assert field not in fields[current_type], f"duplicate {current_type}.{field}"
            fields[current_type].add(field)
        elif line and not line.startswith("    "):
            current_type = None


def test_pine_v3_keeps_boc_distinct_and_classifies_its_timing() -> None:
    pine = source()

    assert "LEGACY_BREAK_CANDLE" not in pine
    assert "normalized_from" not in pine
    assert 'const string BOC_TIER_HTF = "HTF_TIMED"' in pine
    assert 'const string BOC_TIER_DISCRETIONARY = "DISCRETIONARY_5M"' in pine
    assert "BOC_DISCRETIONARY_CONTEXT_UNQUANTIFIED" in pine
    assert "bool htfTimed = opens15 or opens30 or opens60" in pine


def test_pine_v3_captures_immutable_boc_reference_and_independent_candidates() -> None:
    pine = source()

    for field in (
        "int referenceOpenEpoch",
        "int referenceOpenTicks",
        "int referenceHighTicks",
        "int referenceLowTicks",
        "int referenceCloseTicks",
        "bool bocEmitted",
        "bool closeEmitted",
        "bool flipEmitted",
        "bool paperDecisionEmitted",
    ):
        assert field in pine
    assert (
        "bool longBreak = attempt.core.demand and close > attempt.core.referenceHighPrice" in pine
    )
    assert (
        "bool shortBreak = not attempt.core.demand and close < attempt.core.referenceLowPrice"
        in pine
    )
    assert "attempt.boc.bocEmitted := true" in pine
    assert "attempt.flip.flipEmitted := true" in pine
    assert "attempt.core.paperDecisionEmitted := true" in pine
    assert "entryObservedEpoch(attempt, model)" in pine
    assert "entryEvaluationEpoch(attempt)" in pine
    assert (
        "bool candidateObservationOpen = not attempt.core.invalidatedBeforeEntry "
        "and zone.state != STATE_INVALIDATED "
        "and zone.setupState == SETUP_ARMED" in pine
    )


def test_pine_v3_guards_realtime_evidence_and_reviewed_hashes() -> None:
    pine = source()

    assert "barstate.isrealtime" in pine
    assert "LIVE_EXACT_NON_REPLAYABLE" in pine
    assert "CONFIRMED_5M" in pine
    assert 'input.string("", "Reviewed detector SHA-256"' in pine
    assert 'input.string("", "Reviewed settings SHA-256"' in pine
    assert "reviewedHashesValid" in pine
    assert 'string detectorHash = reviewedPromotion ? detectorCodeHash : "UNREVIEWED"' in pine
    assert 'string settingsHashValue = reviewedPromotion ? settingsHash : "UNREVIEWED"' in pine
    assert "if not reviewedProducerHashesValid()" not in pine
    for field in (
        "string bocProofPlane",
        "string bocReplayability",
        "string flipFidelity",
        "string flipProofPlane",
        "string flipReplayability",
    ):
        assert field in pine
    assert 'attempt.flip.flipFidelity == "EXACT"' in pine


def test_pine_v3_serializes_complete_sorted_common_rules() -> None:
    pine = source()
    required_rule_ids = (
        "LIQ_ACTUAL_EXTREME_SWEPT",
        "LIQ_DISTANCE_INFLUENCES_ZONE",
        "LIQ_EVENT_ORDER",
        "LIQ_INTERNAL_REBREAK",
        "LIQ_NORMAL_TWO_OPPOSITE_CANDLES",
        "LIQ_ONE_CANDLE_EXCEPTION",
        "LIQ_OWN_EXTREME_SAME_LEG",
        "LIQ_REPLACEMENT_AFTER_STALE_MOVE",
        "LIQ_STRICT_OWN_EXTREME_BREAK",
        "TIMEFRAME_FIVE_MINUTE_ONLY",
        "ZONE_ACCURACY_BOUNDS",
        "ZONE_FRESH_UNTAPPED",
        "ZONE_ORIGIN_OPPOSITE_CANDLE",
        "ZONE_PRE_ENTRY_CLOSE_OUTSIDE",
    )

    positions = [pine.index(f'\\"rule_id\\":\\"{rule_id}\\"') for rule_id in required_rule_ids]
    assert positions == sorted(positions)
    assert '"passed\\":true' not in pine
    assert "commonRuleResultsPayload(EntryAttempt attempt)" in pine
    for field in (
        "ruleLiqActualExtremeSwept",
        "ruleLiqDistanceInfluencesZone",
        "ruleLiqEventOrder",
        "ruleLiqInternalRebreak",
        "ruleLiqNormalTwoOppositeCandles",
        "ruleLiqOneCandleException",
        "ruleLiqOwnExtremeSameLeg",
        "ruleLiqReplacementAfterStaleMove",
        "ruleLiqStrictOwnExtremeBreak",
        "ruleTimeframeFiveMinuteOnly",
        "ruleZoneAccuracyBounds",
        "ruleZoneFreshUntapped",
        "ruleZoneOriginOppositeCandle",
        "ruleZonePreEntryCloseOutside",
    ):
        assert f"bool {field}" in pine
        assert f"str.tostring(attempt.core.{field})" in pine
    assert "attempt.core.commonRulesPass := attempt.core.ruleLiqActualExtremeSwept and" in pine


def test_pine_v3_tracks_15_30_60_flip_lifecycles_separately() -> None:
    pine = source()

    for field in (
        "int htf15AnchorEpoch",
        "int htf30AnchorEpoch",
        "int htf60AnchorEpoch",
        "bool htf15ContactSeen",
        "bool htf30ContactSeen",
        "bool htf60ContactSeen",
        "bool htf15DestinationBeforeContact",
        "bool htf30DestinationBeforeContact",
        "bool htf60DestinationBeforeContact",
        "int htf15ContactOpenEpoch",
        "int htf30ContactOpenEpoch",
        "int htf60ContactOpenEpoch",
        "int htf15ContactCloseTicks",
        "int htf30ContactCloseTicks",
        "int htf60ContactCloseTicks",
    ):
        assert field in pine
    assert "updateFlipContext(attempt, zone, 15)" in pine
    assert "updateFlipContext(attempt, zone, 30)" in pine
    assert "updateFlipContext(attempt, zone, 60)" in pine
    assert "math.max(epochSeconds(timenow), barEpoch + 1)" not in pine
    assert "finalizeFlipCandidate(attempt)" in pine
    assert "attempt.flip.flipContextMask" in pine
    assert "attempt.htf15.htf15TriggeredThisTick := false" in pine
    assert "attempt.htf30.htf30TriggeredThisTick := false" in pine
    assert "attempt.htf60.htf60TriggeredThisTick := false" in pine
    assert pine.rindex("updateFlipContext(attempt, zone, 60)") < pine.rindex(
        "flipTriggered := finalizeFlipCandidate(attempt)"
    )
    assert "bool compatible15 =" in pine
    assert "bool compatible30 =" in pine
    assert "bool compatible60 =" in pine


def test_pine_v3_exact_intrabar_evidence_requires_continuous_first_cross_coverage() -> None:
    pine = source()

    for field in (
        "bool bocCoverageReady",
        "bool bocPreviousNonBrokenSide",
        "int bocLastTickSequence",
        "int bocLastTickEpoch",
        "int bocPreviousTickTicks",
        "bool bocCoverageGapDetected",
        "bool htf15CoverageReady",
        "bool htf30CoverageReady",
        "bool htf60CoverageReady",
        "int htf15LastTickSequence",
        "int htf30LastTickSequence",
        "int htf60LastTickSequence",
    ):
        assert field in pine
    record_boc = section(pine, "recordBoc(", "captureFlipContact(")
    assert (
        "bool continuousCoverage = attempt.boc.bocCoverageReady "
        "and attempt.boc.bocLastTickSequence + 1 == tickSequence" in record_boc
    )
    assert (
        "bool firstCrossObserved = barstate.isrealtime "
        "and continuousCoverage "
        "and attempt.boc.bocPreviousNonBrokenSide and brokenNow" in record_boc
    )
    assert (
        "bool priorTickCausal = not na(attempt.boc.bocLastTickEpoch) "
        "and nowEpoch > attempt.boc.bocLastTickEpoch" in record_boc
    )
    assert "bool exactFirstCross = firstCrossObserved and priorTickCausal" in record_boc
    assert (
        "bool unrepresentableFirstCross = firstCrossObserved and not priorTickCausal" in record_boc
    )
    assert "int nowEpoch = entryClockEpoch()" in record_boc
    assert "attempt.boc.bocEventEpoch := nowEpoch" in record_boc
    assert assigned_expression(record_boc, "attempt.boc.bocFidelity") == (
        'exactFirstCross ? (htfTimed ? "EXACT" : "DISCRETIONARY") : "UNRESOLVED"'
    )
    assert (
        assigned_expression(record_boc, "attempt.boc.bocLastTickEpoch") == "epochSeconds(timenow)"
    )
    assert (
        assigned_expression(record_boc, "attempt.boc.bocPreviousTickTicks") == "priceTicks(close)"
    )
    assert "attempt.boc.bocCoverageStartEpoch" not in assigned_expression(
        record_boc, "attempt.boc.bocTriggerCausal"
    )
    assert "SHADOW_MISSING_INTRABAR_COVERAGE" in pine


def test_pine_v3_defers_same_second_audits_and_serializes_nullable_triggers() -> None:
    pine = source()

    for field in (
        "bool bocTriggerCausal",
        "bool bocAuditPending",
        "int bocCoverageEndEpoch",
        "int bocObservedAtEpoch",
        "string bocFailureCode",
        "bool flipTriggerCausal",
        "bool flipLifecycleCausal",
        "bool flipAuditPending",
        "int flipCoverageEndEpoch",
        "int flipObservedAtEpoch",
    ):
        assert field in pine
    assert "nullableEntryInt(bool present, int value)" in pine
    assert "nullableOrderedCandlePayload(bool present" in pine
    assert "attempt.boc.bocAuditPending and nowEpoch > attempt.boc.bocEventEpoch" in pine
    assert "attempt.flip.flipAuditPending and nowEpoch > attempt.flip.flipEventEpoch" in pine
    assert '"REALTIME_TRIGGER_EPOCH_UNREPRESENTABLE"' in pine
    assert '"HTF_FLIP_CAUSAL_EPOCH_UNREPRESENTABLE"' in pine
    assert "attempt.flip.flipCoverageGapDetected := selectedCoverageGap" in pine
    assert 'not compatible or attempt.flip.flipFidelity != "EXACT"' not in pine


def test_pine_v3_uses_event_clock_not_wall_clock_for_history() -> None:
    pine = source()

    assert "entryClockEpoch() =>" in pine
    assert "barstate.isrealtime ? epochSeconds(timenow) : epochSeconds(time_close)" in pine
    evaluation = pine[pine.index("entryEvaluationEpoch(") : pine.index("entryCandidatePayload(")]
    assert "entryClockEpoch()" in evaluation
    assert "epochSeconds(timenow)" not in evaluation
    assert "attempt.boc.bocObservedAtEpoch" in evaluation
    assert "attempt.flip.flipObservedAtEpoch" in evaluation


def test_pine_v3_emits_authoritative_bounded_event_bundles() -> None:
    pine = source()

    for key in (
        "schema_version",
        "producer_sequence",
        "event_id",
        "market_event",
        "exit_events",
        "candidates",
        "evidence",
        "selection_proposal",
        "trade_plan",
    ):
        assert f'\\"{key}\\"' in pine
    assert "const int ENTRY_MAX_PAYLOAD_CHARS = 35000" in pine
    assert 'string envelope = "{\\"credential\\":" + jsonString(entryV3Credential)' in pine
    assert '",\\"payload\\":" + payload + "}"' in pine
    assert "str.length(envelope) >= ENTRY_MAX_PAYLOAD_CHARS" in pine
    assert "ENTRY_V3_ENVELOPE_TOO_LARGE" in pine
    assert "nextEntrySequence()" in pine
    assert "array.set(entrySequenceState, 0, nextSequence)" in pine
    assert "alert(envelope, alert.freq_all)" in pine
    assert "alert(envelope, alert.freq_once_per_bar_close)" in pine


def test_pine_v3_delegates_closed_identity_derivation_to_the_edge() -> None:
    pine = source()

    assert 'model == ENTRY_MODEL_BOC ? "EDGE_DERIVED:BOC"' in pine
    assert 'model == ENTRY_MODEL_CLOSE ? "EDGE_DERIVED:DIR_CLOSE"' in pine
    assert '"EDGE_DERIVED:HTF_FLIP"' in pine
    assert 'string payloadSha = "EDGE_DERIVED"' in pine
    assert '\\"selection_id\\":\\"EDGE_DERIVED\\"' in pine
    for fake_digest in ("a" * 64, "b" * 64, "c" * 64, "d" * 64, "e" * 64, "f" * 64, "1" * 64):
        assert fake_digest not in pine


def test_pine_v3_emits_generic_exits_and_fails_closed_on_historical_ambiguity() -> None:
    pine = source()

    assert "bool stopHit =" in pine
    assert "bool targetHit =" in pine
    assert '"STOP_LOSS"' in pine
    assert '"TARGET"' in pine
    assert "AMBIGUOUS_SAME_BAR_EXIT" in pine
    assert "not barstate.isrealtime and stopHit and targetHit" in pine
    assert "barstate.isrealtime ? close <= stopPrice" in pine
    assert "barstate.isrealtime ? close >= targetPrice" in pine
    assert 'string reason = historicalAmbiguous ? "AMBIGUOUS_SAME_BAR_EXIT"' in pine
    assert "attempt.core.exitTerminal := true" in pine
    assert "monitorAttemptExit(attempt, zone)" in pine
    assert "else\n                monitorAttemptExit" not in pine
    assert pine.rindex(
        'emitEntryPayload(attempt, zone, intrabarCandidate, "[]", false)'
    ) < pine.rindex("monitorAttemptExit(attempt, zone)")


def test_pine_v3_exit_followups_use_current_market_event_facts() -> None:
    pine = source()

    assert "entryMarketEventPayload(EntryAttempt attempt, bool exitFollowup)" in pine
    assert "int marketEpoch = exitFollowup ? entryClockEpoch() : selectedEpoch" in pine
    assert "int marketSequence = exitFollowup ? tickSequence : selectedSequence" in pine
    assert "int marketTicks = exitFollowup ? priceTicks(close) : selectedTicks" in pine
    assert "int eventTicks = priceTicks(close)" in pine
    assert (
        "emitEntryPayload(attempt, zone, barstate.isrealtime, exitEvent, true)"
        in pine
    )


def test_pine_v3_freezes_one_trade_plan_for_payloads_and_exit_monitoring() -> None:
    pine = source()
    payload = section(pine, "entrySetupBundlePayload(", "entryMarketEventPayload(")
    exit_monitor = section(pine, "monitorAttemptExit(", "deleteZone(")

    assert "entryPlanFacts(attempt)" in payload
    assert "entrySelectedFacts(attempt)" not in payload
    assert "entryPlanFacts(attempt)" in exit_monitor
    assert "not na(attempt.core.stopTicks)" not in exit_monitor
    assert "not na(attempt.core.targetTicks)" not in exit_monitor


def test_pine_v3_separates_shadow_telemetry_from_actionable_human_alerts() -> None:
    pine = source()
    exit_monitor = section(pine, "monitorAttemptExit(", "deleteZone(")
    entry_loop = section(
        pine,
        "// Entry candidates are evaluated",
        "int drawCount = array.size(zones)",
    )

    # Shadow exits still reach the webhook observation plane.
    assert "monitorAttemptExit(attempt, zone)" in entry_loop
    assert "attempt.core.paperDecisionEmitted" not in entry_loop.split(
        "if bundleReady", 1
    )[1].split("monitorAttemptExit(attempt, zone)", 1)[0]
    assert "emitEntryPayload(attempt, zone, barstate.isrealtime, exitEvent, true)" in exit_monitor

    # Human notifications and chart markers require an actual paper selection.
    assert "actionableExit := attempt.core.paperDecisionEmitted" in exit_monitor
    assert "actionablePaperEntryThisUpdate := true" in entry_loop
    assert "actionablePaperExitThisUpdate := actionablePaperExitThisUpdate or actionableExit" in entry_loop
    assert "drawActionableEntry(attempt)" in entry_loop
    assert "drawActionableExit(attempt, exitReason, exitTicks)" in entry_loop
    assert 'alertcondition(actionablePaperEntryThisUpdate, "SND RD | Actionable paper entry"' in pine
    assert 'alertcondition(actionablePaperExitThisUpdate, "SND RD | Actionable paper exit"' in pine


def test_pine_v3_actionable_paper_path_requires_two_plus_liquidity() -> None:
    pine = source()
    eligibility = section(
        pine,
        "entryHasPaperEligibleSelection(",
        "entryBundleReadyToEmit(",
    )
    entry_loop = section(
        pine,
        "// Entry candidates are evaluated",
        "int drawCount = array.size(zones)",
    )

    assert (
        "bool twoPlusCandleLiquidity = "
        "attempt.core.liquidityCohort == LIQUIDITY_COHORT_TWO_PLUS"
    ) in eligibility
    assert (
        "twoPlusCandleLiquidity and not na(selectedEpoch) and "
        "(bocExact or closeExact or flipExact)"
    ) in eligibility
    assert (
        "if not attempt.core.paperDecisionEmitted and "
        "entryHasPaperEligibleSelection(attempt)"
    ) in entry_loop
    assert entry_loop.count("attempt.core.paperDecisionEmitted := true") == 1
    actionable_branch = section(
        entry_loop,
        "if not attempt.core.paperDecisionEmitted",
        "bool intrabarCandidate",
    )
    assert "actionablePaperEntryThisUpdate := true" in actionable_branch
    assert "drawActionableEntry(attempt)" in actionable_branch
    assert "actionableExit := attempt.core.paperDecisionEmitted" in section(
        pine, "monitorAttemptExit(", "deleteZone("
    )

    def locally_actionable(cohort: str, exact: bool, conflict: bool) -> bool:
        return cohort == "TWO_PLUS_CANDLES" and exact and not conflict

    assert not locally_actionable("ONE_CANDLE", exact=True, conflict=False)
    assert locally_actionable("TWO_PLUS_CANDLES", exact=True, conflict=False)


def test_pine_v3_actionable_chart_markers_use_the_frozen_plan() -> None:
    pine = source()
    entry_marker = section(pine, "drawActionableEntry(", "drawActionableExit(")
    exit_marker = section(pine, "drawActionableExit(", "recordDirectionalClose(")

    assert "showActionableTradeMarkers" in pine
    assert "entryPlanFacts(attempt)" in entry_marker
    assert '"PAPER " + (attempt.core.demand ? "LONG" : "SHORT")' in entry_marker
    assert '"\\nSL " + str.tostring(stopPrice, format.mintick)' in entry_marker
    assert '"\\nTP " + str.tostring(targetPrice, format.mintick)' in entry_marker
    assert "entryPlanFacts(attempt)" in exit_marker
    assert '"EXIT " + exitReason' in exit_marker


def test_pine_v3_freezes_setup_facts_and_protects_open_attempts_from_eviction() -> None:
    pine = source()

    assert "bool invalidatedBeforeEntry" in pine
    assert "bool demand" in pine
    assert "int zoneTopTicks" in pine
    assert "int zoneBottomTicks" in pine
    assert "attempt.core.invalidatedBeforeEntry := zone.state == STATE_INVALIDATED" in pine
    assert (
        '"\\"invalidated_before_entry\\":" + str.tostring(attempt.core.invalidatedBeforeEntry)'
        in pine
    )
    assert "zoneHasActiveAttempt(oldest.id)" in pine
    assert "protectedAttempt := not attempt.core.exitTerminal" in pine
    assert "retireOldestNonEconomicAttempt" not in pine
    assert "attempt.core.exitTerminal := true" not in section(
        pine,
        "evictOldestUnprotectedZone(",
        "if barstate.isfirst",
    )
    assert "entryRetentionBlocked := true" in pine
    assert '"ENTRY_VISUAL_RETENTION_BLOCKED_BY_ACTIVE_ATTEMPTS"' in pine
    assert '"ENTRY_ATTEMPT_HARD_CAP_REACHED"' in pine
    assert "const int ENTRY_MAX_ATTEMPTS = 120" in pine
    assert "array.size(entryAttempts) > ENTRY_MAX_ATTEMPTS" in pine
    assert "array.shift(entryAttempts)" not in pine


def test_pine_v3_retention_pressure_keeps_waiting_models_observable() -> None:
    pine = source()
    retention = section(
        pine,
        "while array.size(zones) > maxZones",
        "if array.size(entryAttempts) > ENTRY_MAX_ATTEMPTS",
    )

    assert "evictOldestUnprotectedZone(zones, entryAttempts)" in retention
    assert "retireOldestNonEconomicAttempt" not in retention
    assert "break" in retention
    assert "entryRetentionBlocked := true" in retention
    assert "attempt.boc.bocEmitted" not in retention
    assert "attempt.directionalClose.closeEmitted" not in retention
    assert "attempt.flip.flipEmitted" not in retention
    assert "attempt.core.exitTerminal" not in retention


def test_pine_v3_materializes_engagement_protection_before_zone_trimming() -> None:
    pine = source()
    confirmed_update = section(
        pine,
        "if barstate.isconfirmed and isFiveMinute and validationReady",
        "// Entry candidates are evaluated",
    )
    materialize_at = confirmed_update.index("materializeEngagedEntryAttempts(zones)")
    trim_at = confirmed_update.index("while array.size(zones) > maxZones")

    assert materialize_at < trim_at
    materializer = section(
        pine,
        "materializeEngagedEntryAttempts(",
        "zoneHasActiveAttempt(",
    )
    assert "ensureEntryAttempt(zone)" in materializer
    assert "zone.state == STATE_TAPPED and zone.setupState == SETUP_ARMED" in materializer


def test_pine_v3_flip_crossing_price_and_fixture_are_field_exact() -> None:
    pine = source()
    parity = PARITY.read_text()
    finalize = section(pine, "finalizeFlipCandidate(", "monitorAttemptExit(")

    assert assigned_expression(finalize, "attempt.flip.flipEventTicks") == "priceTicks(close)"
    assert assigned_expression(finalize, "attempt.flip.flipOpenTicks") == "openTicks"
    assert assigned_expression(finalize, "attempt.flip.flipFidelity") == (
        "compatible and exact and allExact and triggerCausal and lifecycleCausal "
        '? "EXACT" : "UNRESOLVED"'
    )
    assert assigned_expression(finalize, "attempt.flip.flipProofPlane") == (
        "barstate.isrealtime ? ENTRY_REALTIME_PLANE : ENTRY_CONFIRMED_PLANE"
    )

    flip_fixture = section(parity, "function exactFlipEvidence()", "function payloadEnvelope(")
    assert re.search(r"observed_trigger_ticks:\s*111,", flip_fixture)
    assert re.search(r"htf_open_ticks:\s*110,", flip_fixture)
    assert re.search(r"close_ticks:\s*111,", flip_fixture)


def test_pine_v3_static_branches_match_nullable_and_historical_fixture_clocks() -> None:
    pine = source()
    parity = PARITY.read_text()
    record_boc = section(pine, "recordBoc(", "captureFlipContact(")
    evidence_serializer = section(pine, "entryEvidencePayload(", "entryCandidatesPayload(")
    clock = section(pine, "entryClockEpoch()", "entryObservedEpoch(")

    assert (
        "attempt.boc.bocAuditPending := unrepresentableFirstCross or not coverageIntervalAdvanced"
        in record_boc
    )
    assert assigned_expression(record_boc, "attempt.boc.bocTriggerCausal") == (
        "not unrepresentableFirstCross"
    )
    assert 'unrepresentableFirstCross ? "REALTIME_TRIGGER_EPOCH_UNREPRESENTABLE"' in record_boc
    assert "nullableEntryInt(triggerCausal, triggerEpoch)" in evidence_serializer
    assert "nullableOrderedCandlePayload(lifecycleCausal" in evidence_serializer
    assert "barstate.isrealtime ? epochSeconds(timenow) : epochSeconds(time_close)" in clock

    same_second_boc = section(
        parity,
        'it("accepts a same-second BOC',
        'it("accepts a same-second flip',
    )
    for field in ("observed_trigger_epoch", "observed_trigger_ticks"):
        assert re.search(rf"{field}:\s*null,", same_second_boc)
    assert re.search(r"coverage_start_epoch:\s*2700,", same_second_boc)
    assert re.search(r"coverage_end_epoch:\s*2701,", same_second_boc)

    close_candidate = section(
        parity,
        "function closeCandidate(",
        "function exactCloseEvidence(",
    )
    close_evidence = section(
        parity,
        "function exactCloseEvidence(",
        "function flipCandidate(",
    )
    historical_close_followup = section(
        parity,
        'it("validates a Pine-emittable historical DIR_CLOSE',
        "\n  });\n",
    )
    assert re.search(r"observed_at_epoch:\s*2700,", close_candidate)
    assert re.search(r"observed_trigger_epoch:\s*2700,", close_evidence)
    assert re.search(r"evaluated_at_epoch:\s*3000,", historical_close_followup)
    assert re.search(r"isRealtime:\s*false,", historical_close_followup)


def test_pine_v3_producer_proposal_is_diagnostic_and_reason_accurate() -> None:
    pine = source()

    selection = pine[pine.index("entrySelectionPayload(") : pine.index("entrySelectedFacts(")]
    assert "bool blockedAggressive =" in selection
    assert 'blockedAggressive ? "FALLBACK_TO_CONFIRMED_CLOSE" : "ONLY_EXACT_TRIGGER"' in selection
    assert "bool canonicalUnknown = sameEventCount > 1 and not priceConflict" in selection
    assert 'string action = canonicalUnknown ? "OBSERVE"' in selection
    assert "string candidateId = canonicalUnknown" in selection
    assert "string evidenceId = canonicalUnknown" in selection
    assert "string model = canonicalUnknown" in selection
    assert "string fidelity = canonicalUnknown" in selection


def test_pine_v3_one_candle_selection_has_canonical_terminal_precedence() -> None:
    pine = source()
    selection = section(pine, "entrySelectionPayload(", "entrySelectedFacts(")

    assert (
        "bool oneCandleExperiment = "
        "attempt.core.liquidityCohort == LIQUIDITY_COHORT_ONE"
    ) in selection
    one_candle_override = section(selection, "if oneCandleExperiment", "string coModels")
    assert (
        'reason := "ONE_CANDLE_EXPERIMENT_NOT_PROMOTED"'
        in one_candle_override
    )
    assert 'action := "SHADOW_ONLY"' in one_candle_override
    for field in ("candidateId", "evidenceId", "model", "fidelity"):
        assert f'{field} := "null"' in one_candle_override
    assert "PAPER_ELIGIBLE" not in one_candle_override
    co_trigger_override = section(selection, "string coModels", '"{" +')
    assert (
        "if oneCandleExperiment\n"
        '        coModels := "[]"'
    ) in co_trigger_override
    assert (
        '"\\"candidate_ids_considered\\":" + entryCandidateIds(attempt)'
    ) in selection
    assert (
        'string commonFidelity = not reviewedHashesValid ? "UNRESOLVED" : '
        'oneCandleLiquidity ? (commonRulesPass ? "DISCRETIONARY" : '
        '"UNRESOLVED") : commonRulesPass ? "EXACT" : "UNRESOLVED"'
    ) in pine


def test_pine_v3_unreviewed_one_candle_payloads_are_fail_closed() -> None:
    pine = source()
    bundle = section(pine, "entrySetupBundlePayload(", "entryMarketEventPayload(")

    # The Worker permits paired UNREVIEWED hashes only for fully shadow-only
    # evidence. One-candle DISCRETIONARY fidelity is available after the
    # reviewed identity is configured, never while the producer is unreviewed.
    fidelity_match = re.search(
        r"^\s*string commonFidelity\s*=\s*(.+)$", bundle, re.MULTILINE
    )
    assert fidelity_match is not None
    fidelity = fidelity_match.group(1).strip()
    assert fidelity.startswith('not reviewedHashesValid ? "UNRESOLVED"')
    assert fidelity.index("not reviewedHashesValid") < fidelity.index(
        "oneCandleLiquidity"
    )


def test_pine_v3_serializer_has_task3_nullable_evidence_keys() -> None:
    pine = source()
    evidence = pine[pine.index("entryEvidencePayload(") : pine.index("entryCandidatesPayload(")]

    for key in (
        "observed_trigger_epoch",
        "observed_trigger_ticks",
        "coverage_start_epoch",
        "coverage_end_epoch",
        "htf_open_ticks",
        "contact_candle",
        "recross_candle",
        "coverage_gap_detected",
        "full_lifecycle_ordered",
        "destination_seen_before_contact",
    ):
        assert f'\\"{key}\\"' in evidence
    assert "nullableEntryInt(triggerCausal, triggerEpoch)" in evidence
    assert "nullableEntryInt(triggerCausal, triggerTicks)" in evidence
    assert "nullableOrderedCandlePayload(lifecycleCausal" in evidence


def test_pine_v3_has_only_schema_v3_alert_surface() -> None:
    pine = source()

    assert pine.count("alert(") == 3
    assert pine.count("alert(envelope, alert.freq_all)") == 2
    assert pine.count("alert(envelope, alert.freq_once_per_bar_close)") == 1


def test_pine_v3_same_child_flip_requires_later_continuous_tick() -> None:
    pine = source()
    update = section(pine, "updateFlipContext(", "finalizeFlipCandidate(")

    for field in (
        "int htf15ContactTickEpoch",
        "int htf15ContactTickSequence",
        "int htf30ContactTickEpoch",
        "int htf30ContactTickSequence",
        "int htf60ContactTickEpoch",
        "int htf60ContactTickSequence",
    ):
        assert field in pine
    assert "bool laterThanContact =" in update
    assert "tickSequence > contactTickSequence" in update
    assert "nowEpoch > contactTickEpoch" in update
    assert "bool sameChildExactRecross =" in update
    same_child = re.search(r"bool sameChildExactRecross = (.+)$", update, re.MULTILINE)
    assert same_child is not None
    assert "continuousCoverage" in same_child.group(1)
    assert "not coverageGapDetected" in same_child.group(1)
    assert "bool sameAtomicContactAndDestination =" in update
    assert "destinationBeforeContact := true" in update
    assert "contactCandleComplete or sameChildExactRecross" in update
    assert "bool contactCoverageContinuous =" in update
    assert "contactOpenEpoch := lastTickEpoch" in update
    assert "contactCloseEpoch := nowEpoch" in update
    assert "contactOpenTicks := previousTickTicks" in update
    assert "coverageGapDetected := true" in update


def test_pine_v3_contains_no_broker_or_live_execution_surface() -> None:
    pine = source()

    assert 'const string ENTRY_EXECUTION_MODE = "PAPER_ONLY"' in pine
    assert "const bool exportSetupEvents = false" in pine
    assert 'input.bool(false, "Export non-executable setup events"' not in pine
    assert "strategy.entry" not in pine
    assert "strategy.order" not in pine
    assert "strategy.exit" not in pine
    assert "broker" not in pine.lower()


def test_pine_v3_keeps_liquidity_visuals_clean_and_lightweight() -> None:
    pine = source()
    zone_drawings = section(pine, "bool zoneLiquidityVisible =", "addUniqueLiquidityIndex(")
    audit_drawings = section(pine, "updateLiquidityDrawings(", "diagnosticPayload(")

    assert (
        'liquidityPrimaryLineWidth = input.int(2, "Primary liquidity line width", '
        'minval = 1, maxval = 3, group = "Display")'
        in pine
    )
    assert (
        'showLiquidityPriceLabels = input.bool(false, "Show liquidity price labels", '
        'group = "Display")'
        in pine
    )
    assert (
        'liquidityPendingColor = input.color(color.new(color.orange, 18), '
        '"Liquidity pending", group = "Colors")'
        in pine
    )
    assert (
        'liquiditySweptColor = input.color(color.new(color.teal, 18), '
        '"Liquidity swept", group = "Colors")'
        in pine
    )
    assert (
        'liquiditySecondaryColor = input.color(color.new(color.gray, 55), '
        '"Liquidity own extreme", group = "Colors")'
        in pine
    )
    assert (
        "color primaryColor = liquidityTaken ? liquiditySweptColor : liquidityPendingColor"
        in zone_drawings
    )
    assert "width = liquidityPrimaryLineWidth" in zone_drawings
    assert "size = size.tiny" in zone_drawings
    assert "width = 1" in zone_drawings
    assert "line.set_width(zone.ownExtremeLine, 1)" in zone_drawings
    assert "liquidityPriceLabelText(zone.liquidityExtreme)" in zone_drawings
    assert (
        "color lineColor = level.taken ? liquiditySweptColor : liquidityPendingColor"
        in audit_drawings
    )
    assert "int lineWidth = liquidityPrimaryLineWidth" in audit_drawings
    assert "primary ? liquidityPrimaryLineWidth" not in audit_drawings
    assert "size = size.tiny" in audit_drawings
    assert "liquidityPriceLabelText(level.nearExtreme)" in audit_drawings


def test_pine_v3_keeps_optional_own_extreme_proof_lines_hidden_by_default() -> None:
    pine = source()
    zone_drawings = section(pine, "bool zoneLiquidityVisible =", "addUniqueLiquidityIndex(")
    audit_drawings = section(pine, "updateLiquidityDrawings(", "diagnosticPayload(")

    assert (
        'showLiquidityProofLines = input.bool(false, "Show liquidity proof lines", '
        'group = "Display")'
        in pine
    )
    assert "if showLiquidityProofLines" in zone_drawings
    assert (
        "zone.ownExtremeLine := line.new(proofLeftBar, zone.liquidityAnchor"
        in zone_drawings
    )
    assert "color ownExtremeColor = premiumVisuals ? color.new(color.gray" in zone_drawings
    assert "width = 1" in zone_drawings
    assert "if showLiquidityProofLines" in audit_drawings
    assert (
        "level.ownExtremeLine := line.new(proofLeftBar, level.anchor"
        in audit_drawings
    )
    assert "else if not na(level.ownExtremeLine)" in audit_drawings


def test_pine_v3_raises_zone_liquidity_above_boxes_created_later() -> None:
    pine = source()
    final_drawing_pass = section(
        pine, "int drawCount = array.size(zones)", "var table statusTable"
    )

    assert "if barstate.islast and drawCount > 0" in final_drawing_pass
    assert "line.copy(zone.ownExtremeLine)" in final_drawing_pass
    assert "line.copy(zone.liquidityLine)" in final_drawing_pass
    assert "label.copy(zone.liquidityLabel)" in final_drawing_pass
    assert final_drawing_pass.index("updateZoneDrawing(zone, zones)") < (
        final_drawing_pass.index("line.copy(zone.liquidityLine)")
    )


def test_pine_v3_only_refreshes_drawing_objects_on_the_last_chart_update() -> None:
    pine = source()
    drawing_refresh = section(
        pine, "bool refreshVisualsThisUpdate", "var table statusTable"
    )

    assert "bool refreshVisualsThisUpdate = barstate.islast" in drawing_refresh
    assert "if refreshVisualsThisUpdate" in drawing_refresh
    assert "updateZoneDrawing(zone, zones)" in drawing_refresh
    assert "updateLiquidityDrawings(liquidityLevels, drawnLiquidityIndexes, zones)" in (
        drawing_refresh
    )
    refresh_lines = drawing_refresh.splitlines()
    assert refresh_lines[:2] == [
        "bool refreshVisualsThisUpdate = barstate.islast",
        "if refreshVisualsThisUpdate",
    ]
    assert all(
        not line.strip()
        or line.startswith("    ")
        or line.startswith("// @lab-only-")
        for line in refresh_lines[2:]
    )


def test_pine_v3_skips_validation_heartbeat_json_when_telemetry_is_disabled() -> None:
    pine = source()
    confirmed_update = section(
        pine,
        "if barstate.isconfirmed and isFiveMinute and validationReady",
        "// Entry candidates are evaluated",
    )

    assert (
        "bool validationTelemetryEnabled = emitDiagnostics or validationCapture"
        in confirmed_update
    )
    assert (
        'string validationEvents = validationTelemetryEnabled ? validationHeartbeat() : ""'
        in confirmed_update
    )
    assert (
        "int validationEventCount = validationTelemetryEnabled ? 1 : 0"
        in confirmed_update
    )


def test_pine_v3_scans_across_the_reversal_bridge_to_the_opposite_leg() -> None:
    pine = source()
    leg_proof = section(pine, "liquidityLegProof(", "confirmedLiquidityPivot(")

    assert "int pivotOffset = strength" in leg_proof
    assert (
        "int firstLegOffset = na" in leg_proof
    )
    assert (
        "for bridgeOffset = 0 to strength" in leg_proof
    )
    assert (
        "int bridgeSourceOffset = pivotOffset + bridgeOffset" in leg_proof
    )
    assert (
        "bool insideReversalBridge = na(firstLegOffset) and bridgeAvailable"
        in leg_proof
    )
    assert "if insideReversalBridge" in leg_proof
    assert "if liquidityCandleIsOpposite(demand, bridgeSourceOffset)" in leg_proof
    assert (
        "int sourceOffset = na(firstLegOffset) "
        "? bar_index + 1 : firstLegOffset + legOffset"
        in leg_proof
    )
    assert (
        "confirmed := oppositeCandleCount >= minimumLiquidityOppositeCandles()"
        in pine
    )


def test_pine_v3_accepts_equal_extremes_as_liquidity_pivots() -> None:
    pine = source()
    pivot = section(pine, "confirmedLiquidityPivot(", "appendConfirmedLiquidityPivot(")

    assert "demand ? low[offset] < center : high[offset] > center" in pivot
    assert "low[offset] <= center" not in pivot
    assert "high[offset] >= center" not in pivot
