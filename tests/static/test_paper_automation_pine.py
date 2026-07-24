from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PINE = ROOT / "scripts/pinescript/SND_RD_5M_V2_LAB.pine"
RULE_CONTRACT = ROOT / "config/phase0/rd-strategy-rule-contract.json"

SOURCE = PINE.read_text(encoding="utf-8")
CONTRACT = json.loads(RULE_CONTRACT.read_text(encoding="utf-8"))


def pine_function_body(name: str) -> str:
    lines = SOURCE.splitlines()
    signature_prefix = f"{name}("
    for index, line in enumerate(lines):
        if line.startswith(signature_prefix) and line.endswith("=>"):
            body: list[str] = []
            for candidate in lines[index + 1 :]:
                if candidate and not candidate[0].isspace():
                    break
                body.append(candidate)
            return "\n".join(body)
    raise AssertionError(f"Pine function not found: {name}")


def main_confirmed_bar_block() -> str:
    marker = "if barstate.isconfirmed and isFiveMinute and validationReady"
    assert marker in SOURCE
    return SOURCE.split(marker, maxsplit=1)[1]


def contract_open_rule_catalog() -> list[tuple[str, str]]:
    return [
        (rule["rule_id"], rule["fidelity"])
        for rule in CONTRACT["rules"]
        if rule["open_requirement"] is True
    ]


def pine_rule_catalog() -> list[tuple[str, str]]:
    body = pine_function_body("setupExportRuleCatalogPayload")
    return re.findall(
        r'setupExportRuleCatalogItem\("([A-Z0-9_]+)", "([A-Z]+)"\)',
        body,
    )


def test_v12_runtime_versions_match_the_machine_contract() -> None:
    assert 'const string SETUP_EXPORT_SCHEMA = "1.2"' in SOURCE
    assert f'const string RD_RULE_CONTRACT_VERSION = "{CONTRACT["contract_version"]}"' in SOURCE
    assert (
        f'const string SETUP_EXPORT_STRATEGY_VERSION = "{CONTRACT["producer_strategy_version"]}"'
    ) in SOURCE

    context = pine_function_body("setupExportContextFields")
    assert '\\"rule_contract_version\\":' in context
    assert '\\"rule_catalog\\":' in context
    assert "setupExportRuleCatalogPayload()" in context
    assert '\\"execution_mode\\":\\"OBSERVATION_ONLY\\"' in context


def test_pine_rule_catalog_exactly_matches_open_requirements() -> None:
    expected = contract_open_rule_catalog()
    actual = pine_rule_catalog()

    assert len(expected) == 22
    assert len(actual) == len(set(actual)), "Pine catalog contains duplicate rule IDs"
    assert actual == expected


def test_each_runtime_setup_emits_compact_rule_evidence() -> None:
    evidence = pine_function_body("setupExportRuleEvidencePayload")
    passes_expression = evidence.split("string rulePasses =", maxsplit=1)[1].split(
        "string lifecycle =", maxsplit=1
    )[0]

    assert (
        "bool engagementOrdered = zoneEngaged and sequenceOrdered and "
        "zone.liquiditySweptBar < zone.stateBar"
    ) in evidence
    assert "not zoneEngaged or" not in evidence
    assert passes_expression.count("str.tostring(") == len(contract_open_rule_catalog())
    assert '\\"decision\\":' in evidence
    assert '\\"entry_model\\":' in evidence
    assert '\\"rule_passes\\":' in evidence
    assert '\\"lifecycle\\":' in evidence
    assert '\\"rules\\":' not in evidence

    for epoch_name in (
        "liquidity_formed_epoch",
        "own_extreme_broken_epoch",
        "liquidity_swept_epoch",
        "zone_engaged_epoch",
        "entry_confirmed_epoch",
    ):
        assert f'\\"{epoch_name}\\":' in evidence

    transition = pine_function_body("setupExportTransitionPayload")
    snapshot_item = pine_function_body("setupExportSnapshotItemPayload")
    assert '\\"rule_evidence\\":' in transition
    assert "setupExportRuleEvidencePayload(zone, toState)" in transition
    assert '\\"rule_evidence\\":' in snapshot_item
    assert "setupExportRuleEvidencePayload(zone, zone.exportedSetupState)" in snapshot_item


def test_v12_has_no_open_settle_or_paper_command_path() -> None:
    prohibited = (
        "paper_commands",
        "paperAutomation",
        "PaperTrade",
        "queuePaperOpen",
        "paperOpenCommandPayload",
        "paperSettlementCommandPayload",
        "collectPaperSettlements",
        "EXACT_RULE_GATE_READY",
        "SETUP_TRIGGERED",
        "paperRiskBps",
        "paperRewardR",
        '\\"action\\":\\"OPEN\\"',
        '\\"action\\":\\"SETTLE\\"',
        "strategy.entry",
        "strategy.exit",
    )
    for token in prohibited:
        assert token not in SOURCE

    snapshot = pine_function_body("setupExportSnapshotPayload")
    incremental = pine_function_body("setupExportIncrementalPayload")
    assert "active_setups" in snapshot
    assert "transitions" in incremental


def test_non_exact_and_same_bar_paths_are_shadow_only() -> None:
    update = pine_function_body("updateSetupState")

    assert ("transitionSetup(zone, SETUP_SHADOW_ONLY, SHADOW_NON_EXACT_REQUIRED_RULES)") in update
    assert ("transitionSetup(zone, SETUP_SHADOW_ONLY, SHADOW_AMBIGUOUS_SAME_BAR_ORDER)") in update
    assert ("transitionSetup(zone, SETUP_SHADOW_ONLY, SHADOW_AMBIGUOUS_SAME_BAR_ROUTE)") in update
    assert 'zone.setupEntryModel := "DIR_CLOSE"' in update
    assert "zone.setupEntryConfirmedTime := time_close" in update
    assert "SETUP_TRIGGERED" not in update

    ambiguity = pine_function_body("setupHasAmbiguousLifecycleOrder")
    assert "zone.liquidityTakenBar >= zone.liquiditySweptBar" in ambiguity
    assert "zone.liquiditySweptBar >= zone.stateBar" in ambiguity


def test_liquidity_is_refreshed_before_zone_engagement() -> None:
    main = main_confirmed_bar_block()
    refresh_position = main.index(
        "[primaryAvailable, primaryTaken, primarySwept, primaryChanged] = refreshZoneLiquidity("
    )
    engagement_position = main.index("bool reachedOrCrossed = zoneReachedOrCrossed(zone)")

    assert refresh_position < engagement_position

    refresh = pine_function_body("refreshZoneLiquidity")
    assert "primaryTakenBar == bar_index" in refresh
    assert "sweptOnOwnBreakBar" in refresh
    assert "primarySweptBar := bar_index" in refresh


def test_primary_replacement_exports_old_identity_then_resets() -> None:
    refresh = pine_function_body("refreshZoneLiquidity")
    reset = pine_function_body("applyPendingLiquidityReplacement")
    main = main_confirmed_bar_block()

    assert "str.length(zone.exportedSetupState) > 0" in refresh
    assert "zone.pendingLiquidityPrimaryIndex := candidateIndex" in refresh
    assert "zone.setupState := SETUP_SHADOW_ONLY" in refresh
    assert "SHADOW_LIQUIDITY_PRIMARY_REPLACED" in refresh

    for reset_statement in (
        "zone.liquidityQualified := false",
        "zone.setupLiquidityAnchor := na",
        "zone.setupLiquidityExtremeTime := na",
        'zone.exportedSetupState := ""',
        "array.clear(zone.setupExportFromStates)",
        "array.clear(zone.setupExportToStates)",
        "array.clear(zone.setupExportReasons)",
    ):
        assert reset_statement in reset

    assert main.index("collectCanonicalSetupTransitions(") < main.index(
        "applyPendingLiquidityReplacement("
    )


def test_initial_snapshot_preserves_same_bar_transitions() -> None:
    main = main_confirmed_bar_block()

    snapshot_at_start = main.index(
        "collectCanonicalSetupSnapshot(zones, setupSnapshotItemsAtBarStart)"
    )
    clear_transition_buffers = main.index("clearSetupExportTransitionBuffers(zones)")
    collect_transitions = main.index("collectCanonicalSetupTransitions(")
    emit_snapshot = main.index("emitSetupExportSnapshot(setupSnapshotItemsAtBarStart)")
    retained_incremental = main.index("if array.size(setupExportItems) > 0", emit_snapshot)

    assert snapshot_at_start < clear_transition_buffers
    assert collect_transitions < emit_snapshot < retained_incremental
    assert "array.clear(setupExportItems)" not in main
    assert (
        "emitSetupExportIncremental(setupExportItems, setupExportBatchSequence)"
        in main[retained_incremental:]
    )


def test_strict_own_break_then_sweep_remains_encoded() -> None:
    taken = pine_function_body("zoneLiquidityTakenBar")
    swept = pine_function_body("zoneLiquiditySweptBar")
    eligibility = pine_function_body("updateZoneEligibility")

    assert "high[sourceOffset] > anchor" in taken
    assert "low[sourceOffset] < anchor" in taken
    assert "int rangeStart = ownExtremeTakenBar + 1" in swept
    assert "low[sourceOffset] < primary.nearExtreme" in swept
    assert "high[sourceOffset] > primary.nearExtreme" in swept
    assert (
        "zone.liquidityFormedBar < zone.liquidityTakenBar and "
        "zone.liquidityTakenBar < zone.liquiditySweptBar"
    ) in eligibility


def test_pre_entry_invalidation_and_directional_close_remain_exact() -> None:
    invalidation = pine_function_body("zoneCloseInvalidBeforeEntry")
    directional_close = pine_function_body("directionalCloseConfirmedForZone")

    assert "zone.demand ? close <= zone.top : close >= zone.bottom" in invalidation
    assert "close > open and close > zone.top" in directional_close
    assert "close < open and close < zone.bottom" in directional_close
