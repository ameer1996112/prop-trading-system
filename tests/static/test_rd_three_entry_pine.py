from pathlib import Path


PINE = Path("scripts/pinescript/SND_RD_5M_V3_THREE_ENTRY_LAB.pine")


def source() -> str:
    return PINE.read_text()


def test_pine_v3_declares_the_closed_three_model_contract() -> None:
    pine = source()

    assert 'const string ENTRY_MODEL_BOC = "BOC"' in pine
    assert 'const string ENTRY_MODEL_CLOSE = "DIR_CLOSE"' in pine
    assert 'const string ENTRY_MODEL_FLIP = "HTF_FLIP"' in pine
    assert 'const string ENTRY_SCHEMA_VERSION = "3.0"' in pine
    assert 'const string ENTRY_STRATEGY_VERSION = "3.0.0-contract3"' in pine
    assert 'const string ENTRY_RULE_CONTRACT_VERSION = "3.0.0"' in pine


def test_pine_v3_user_defined_types_have_unique_fields() -> None:
    current_type = None
    fields: dict[str, set[str]] = {}
    for line in source().splitlines():
        if line.startswith("type "):
            current_type = line.split()[1]
            fields[current_type] = set()
        elif current_type is not None and line.startswith("    ") and " " in line.strip():
            field = line.strip().split()[1]
            assert field not in fields[current_type], (
                f"duplicate {current_type}.{field}"
            )
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
    assert "bool longBreak = attempt.demand and close > attempt.referenceHighPrice" in pine
    assert "bool shortBreak = not attempt.demand and close < attempt.referenceLowPrice" in pine
    assert "attempt.bocEmitted := true" in pine
    assert "attempt.flipEmitted := true" in pine
    assert "attempt.paperDecisionEmitted := true" in pine
    assert "entryObservedEpoch(attempt, model)" in pine
    assert "entryEvaluationEpoch(attempt)" in pine
    assert "bool candidateObservationOpen = not attempt.invalidatedBeforeEntry and zone.state != STATE_INVALIDATED and zone.setupState == SETUP_ARMED" in pine


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
    assert "attempt.flipFidelity == \"EXACT\"" in pine


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
        assert f"str.tostring(attempt.{field})" in pine
    assert "attempt.commonRulesPass := attempt.ruleLiqActualExtremeSwept and" in pine


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
    assert "attempt.flipContextMask" in pine
    assert "attempt.htf15TriggeredThisTick := false" in pine
    assert "attempt.htf30TriggeredThisTick := false" in pine
    assert "attempt.htf60TriggeredThisTick := false" in pine
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
        "bool bocCoverageGapDetected",
        "bool htf15CoverageReady",
        "bool htf30CoverageReady",
        "bool htf60CoverageReady",
        "int htf15LastTickSequence",
        "int htf30LastTickSequence",
        "int htf60LastTickSequence",
    ):
        assert field in pine
    assert "bool continuousCoverage = attempt.bocCoverageReady and attempt.bocLastTickSequence + 1 == tickSequence" in pine
    assert "bool exactFirstCross = barstate.isrealtime and continuousCoverage and attempt.bocPreviousNonBrokenSide and brokenNow" in pine
    record_boc = pine[pine.index("recordBoc("):pine.index("captureFlipContact(")]
    assert "int nowEpoch = entryClockEpoch()" in record_boc
    assert "attempt.bocEventEpoch := nowEpoch" in record_boc
    assert 'attempt.bocFidelity := exactFirstCross and epochAdvanced ? (htfTimed ? "EXACT" : "DISCRETIONARY") : "UNRESOLVED"' in pine
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
    assert "attempt.bocAuditPending and nowEpoch > attempt.bocEventEpoch" in pine
    assert "attempt.flipAuditPending and nowEpoch > attempt.flipEventEpoch" in pine
    assert '"REALTIME_TRIGGER_EPOCH_UNREPRESENTABLE"' in pine
    assert '"HTF_FLIP_CAUSAL_EPOCH_UNREPRESENTABLE"' in pine
    assert "attempt.flipCoverageGapDetected := selectedCoverageGap" in pine
    assert "not compatible or attempt.flipFidelity != \"EXACT\"" not in pine


def test_pine_v3_uses_event_clock_not_wall_clock_for_history() -> None:
    pine = source()

    assert "entryClockEpoch() =>" in pine
    assert "barstate.isrealtime ? epochSeconds(timenow) : epochSeconds(time_close)" in pine
    evaluation = pine[pine.index("entryEvaluationEpoch("):pine.index("entryCandidatePayload(")]
    assert "entryClockEpoch()" in evaluation
    assert "epochSeconds(timenow)" not in evaluation
    assert "attempt.bocObservedAtEpoch" in evaluation
    assert "attempt.flipObservedAtEpoch" in evaluation


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
    assert "str.length(payload) >= ENTRY_MAX_PAYLOAD_CHARS" in pine
    assert "ENTRY_V3_PAYLOAD_TOO_LARGE" in pine
    assert "nextEntrySequence()" in pine
    assert "array.set(entrySequenceState, 0, nextSequence)" in pine
    assert "alert(payload, alert.freq_all)" in pine
    assert "alert(payload, alert.freq_once_per_bar_close)" in pine


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
    assert "attempt.exitTerminal := true" in pine
    assert "monitorAttemptExit(attempt, zone)" in pine
    assert "else\n                monitorAttemptExit" not in pine
    assert pine.rindex('emitEntryPayload(attempt, zone, intrabarCandidate, "[]", false)') < pine.rindex(
        "monitorAttemptExit(attempt, zone)"
    )


def test_pine_v3_freezes_setup_facts_and_protects_open_attempts_from_eviction() -> None:
    pine = source()

    assert "bool invalidatedBeforeEntry" in pine
    assert "bool demand" in pine
    assert "int zoneTopTicks" in pine
    assert "int zoneBottomTicks" in pine
    assert "attempt.invalidatedBeforeEntry := zone.state == STATE_INVALIDATED" in pine
    assert '"\\"invalidated_before_entry\\":" + str.tostring(attempt.invalidatedBeforeEntry)' in pine
    assert "zoneHasActiveAttempt(oldest.id)" in pine
    assert "protectedAttempt := not attempt.exitTerminal" in pine
    assert "retireOldestNonEconomicAttempt" in pine
    assert "not attempt.paperDecisionEmitted" in pine
    assert '"ENTRY_ATTEMPT_RETIRED_AT_CAP:"' in pine
    assert "const int ENTRY_MAX_ATTEMPTS = 120" in pine
    assert "array.size(entryAttempts) > ENTRY_MAX_ATTEMPTS" in pine
    assert "array.shift(entryAttempts)" not in pine


def test_pine_v3_producer_proposal_is_diagnostic_and_reason_accurate() -> None:
    pine = source()

    selection = pine[pine.index("entrySelectionPayload("):pine.index("entrySelectedFacts(")]
    assert "bool blockedAggressive =" in selection
    assert 'blockedAggressive ? "FALLBACK_TO_CONFIRMED_CLOSE" : "ONLY_EXACT_TRIGGER"' in selection
    assert "bool canonicalUnknown = sameEventCount > 1 and not priceConflict" in selection
    assert 'string action = canonicalUnknown ? "OBSERVE"' in selection
    assert 'string candidateId = canonicalUnknown' in selection
    assert 'string evidenceId = canonicalUnknown' in selection
    assert 'string model = canonicalUnknown' in selection
    assert 'string fidelity = canonicalUnknown' in selection


def test_pine_v3_serializer_has_task3_nullable_evidence_keys() -> None:
    pine = source()
    evidence = pine[pine.index("entryEvidencePayload("):pine.index("entryCandidatesPayload(")]

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

    assert pine.count("alert(") == 2
    assert pine.count("alert(payload, alert.freq_all)") == 1
    assert pine.count("alert(payload, alert.freq_once_per_bar_close)") == 1


def test_pine_v3_contains_no_broker_or_live_execution_surface() -> None:
    pine = source()

    assert 'const string ENTRY_EXECUTION_MODE = "PAPER_ONLY"' in pine
    assert "const bool exportSetupEvents = false" in pine
    assert 'input.bool(false, "Export non-executable setup events"' not in pine
    assert "strategy.entry" not in pine
    assert "strategy.order" not in pine
    assert "strategy.exit" not in pine
    assert "broker" not in pine.lower()
