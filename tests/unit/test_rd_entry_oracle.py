from __future__ import annotations

import json
from copy import deepcopy
from dataclasses import replace
from pathlib import Path

import pytest
from scripts.build_rd_entry_oracle_vectors import (
    build_vectors,
    load_fixture_document,
)

from prop_trading.contracts.rd_entry_vectors_v2 import (
    RDEntryArbitrationVectorsV2,
)
from prop_trading.domain.rd_entry_matcher import (
    NEXT_CANDLE_WICK_SOURCE_CLAIMS,
    EntryMatchRequest,
    SetupEntryFacts,
    match_entry_candidates,
)
from prop_trading.domain.rd_entry_models import (
    AttemptKind,
    CandidateFidelity,
    EntryDirection,
    EntryEvidenceIdentity,
    EntryHandlingIdentity,
    EntryModelV2,
    EntrySelectionIdentity,
    HandlingMode,
    OrderedCandle,
    ProofPlane,
    SelectionAction,
    SelectionReason,
    SetupAttemptTerminalReason,
    evidence_id,
    handling_id,
    selection_id,
)
from prop_trading.domain.rd_entry_oracle import (
    EntryOracleCase,
    EntryOracleEvent,
    evaluate_entry_stream,
)
from prop_trading.domain.rd_intrabar_oracle import (
    HTFFlipScanRequest,
    scan_htf_flip,
)

OPEN = 1_721_808_000
FIXTURES = Path("tests/fixtures/rd_entry_arbitration_cases_v2.json")
FROZEN_CASE_IDS = (
    "dir-close-engagement",
    "dir-close-later",
    "pre-entry-invalidation",
    "htf-flip-15m",
    "htf-flip-30m",
    "htf-flip-60m",
    "htf-flip-multi-context",
    "htf-flip-distinct-children",
    "htf-flip-same-child-ambiguous",
    "htf-flip-missing-coverage",
    "htf-flip-partial-coverage",
    "exact-flip-then-close",
    "exact-close-then-later-flip",
    "shadow-flip-then-close-fallback",
    "non-exact-only",
    "generic-break-rejected",
    "htf-break-normalized",
    "rejection-respect-rejected",
    "next-candle-wick-handling",
    "initial-attempt",
    "re-entry-attempt",
    "replay-realtime-one-candidate",
    "duplicate-event-idempotent",
    "out-of-order-events-deterministic",
)


def cases() -> list[dict[str, object]]:
    loaded: object = json.loads(FIXTURES.read_text(encoding="utf-8"))
    assert isinstance(loaded, dict)
    assert loaded["schema_id"] == "phase0.rd-entry-arbitration-fixture.v2"
    values = loaded["cases"]
    assert isinstance(values, list)
    assert all(isinstance(item, dict) for item in values)
    return values


def parsed_case(case_id: str) -> EntryOracleCase:
    return EntryOracleCase.from_mapping(
        next(item for item in cases() if item["case_id"] == case_id)
    )


def pine_case(case: EntryOracleCase) -> EntryOracleCase:
    events: list[EntryOracleEvent] = []
    for oracle_event in case.events:
        unresolved_setup = replace(
            oracle_event.base_match_request.setup,
            common_fidelity=CandidateFidelity.UNRESOLVED,
        )
        events.append(
            replace(
                oracle_event,
                base_match_request=replace(
                    oracle_event.base_match_request,
                    setup=unresolved_setup,
                ),
                htf_scan_requests=tuple(
                    replace(request, setup=unresolved_setup)
                    for request in oracle_event.htf_scan_requests
                ),
            )
        )
    return replace(case, events=tuple(events))


@pytest.mark.parametrize("case", cases(), ids=lambda item: item["case_id"])
def test_reviewed_fixture_matches_oracle(case: dict[str, object]) -> None:
    parsed = EntryOracleCase.from_mapping(case)
    result = evaluate_entry_stream(parsed)

    assert result.selection.policy_version == "rd-entry-arbitration-v2"
    assert result.to_mapping() == case["expected"]
    assert evaluate_entry_stream(pine_case(parsed)).to_mapping() == (case["pine_expected"])


def test_fixture_count_names_and_expanded_transcript_surface_are_frozen() -> None:
    assert tuple(item["case_id"] for item in cases()) == FROZEN_CASE_IDS
    assert len(cases()) == 24
    transcript_keys = {
        "context_minutes",
        "htf_open_epoch",
        "htf_open_ticks",
        "scan_cutoff_epoch",
        "proof_resolution_seconds",
        "coverage_start_epoch",
        "coverage_end_epoch",
        "expected_child_count",
        "observed_child_count",
        "gap_present",
        "full_lifecycle_ordered",
        "destination_seen_before_contact",
        "contact_candle",
        "recross_candle",
        "same_child",
    }
    for case in cases():
        assert case["input"]["policy_version"] == "rd-entry-arbitration-v2"
        assert case["expected"]["selection"]["policy_version"] == ("rd-entry-arbitration-v2")
        assert case["pine_expected"]["selection"]["policy_version"] == ("rd-entry-arbitration-v2")
        for expected_key in ("expected", "pine_expected"):
            assert "htf_transcripts" in case[expected_key]
            for transcript in case[expected_key]["htf_transcripts"]:
                assert set(transcript) == transcript_keys


def test_fixture_parser_rejects_unknown_or_conflicting_expected_records() -> None:
    unknown = deepcopy(cases()[0])
    unknown["expected"]["candidates"][0]["unknown"] = True
    with pytest.raises(ValueError, match="unknown"):
        EntryOracleCase.from_mapping(unknown)

    conflicting_id = deepcopy(cases()[0])
    conflicting_id["expected"]["candidates"][0]["candidate_id"] = "a" * 64
    with pytest.raises(ValueError, match="candidate_id|identity"):
        EntryOracleCase.from_mapping(conflicting_id)


def _coordinate_forged_evidence_payload(expected: dict[str, object]) -> None:
    evidence = expected["evidence"][0]
    old_evidence_id = evidence["evidence_id"]
    evidence["payload_sha256"] = "a" * 64
    forged_evidence_id = evidence_id(
        EntryEvidenceIdentity(
            candidate_id=evidence["candidate_id"],
            proof_plane=ProofPlane(evidence["proof_plane"]),
            proof_resolution_seconds=evidence["proof_resolution_seconds"],
            coverage_start_epoch=evidence["coverage_start_epoch"],
            coverage_end_epoch=evidence["coverage_end_epoch"],
            observed_trigger_epoch=evidence["observed_trigger_epoch"],
            payload_sha256=evidence["payload_sha256"],
        )
    )
    evidence["evidence_id"] = forged_evidence_id

    handling = next(item for item in expected["handling"] if item["evidence_id"] == old_evidence_id)
    handling["evidence_id"] = forged_evidence_id
    handling["handling_id"] = handling_id(
        EntryHandlingIdentity(
            candidate_id=handling["candidate_id"],
            evidence_id=handling["evidence_id"],
            handling_mode=HandlingMode(handling["handling_mode"]),
            attempt_kind=AttemptKind(handling["attempt_kind"]),
            observed_epoch=handling["observed_epoch"],
            observed_ticks=handling["observed_ticks"],
            fidelity=CandidateFidelity(handling["fidelity"]),
            source_claim_ids=tuple(handling["source_claim_ids"]),
        )
    )

    selection = expected["selection"]
    assert selection["canonical_evidence_id"] == old_evidence_id
    selection["canonical_evidence_id"] = forged_evidence_id
    selection["selection_id"] = selection_id(
        EntrySelectionIdentity(
            setup_id=selection["setup_id"],
            policy_version=selection["policy_version"],
            revision=selection["revision"],
            candidate_ids_considered=tuple(selection["candidate_ids_considered"]),
            canonical_candidate_id=selection["canonical_candidate_id"],
            canonical_evidence_id=selection["canonical_evidence_id"],
            reason=SelectionReason(selection["reason"]),
            fidelity=CandidateFidelity(selection["fidelity"]),
            action=SelectionAction(selection["action"]),
        )
    )


def test_fixture_parser_rejects_coordinated_forged_evidence_payload() -> None:
    forged = deepcopy(cases()[0])
    _coordinate_forged_evidence_payload(forged["expected"])

    with pytest.raises(ValueError, match="payload_sha256|payload digest"):
        EntryOracleCase.from_mapping(forged)


def test_fixture_replay_metadata_attempts_and_pine_support_are_explicit() -> None:
    for case in cases():
        for key in (
            "setup_id",
            "symbol",
            "feed",
            "calculation_start_epoch",
            "emission_start_epoch",
            "emission_end_epoch",
            "pine_supported",
        ):
            assert key in case
        assert type(case["pine_supported"]) is bool
        for oracle_event in case["input"]["events"]:
            request = oracle_event["match_request"]
            assert "attempt_kind" in request
            assert "trigger_ordinal" in request
    support = {item["case_id"]: item["pine_supported"] for item in cases()}
    assert {case_id for case_id, supported in support.items() if not supported} == {
        "re-entry-attempt",
        "replay-realtime-one-candidate",
    }
    initial = parsed_case("initial-attempt")
    reentry = parsed_case("re-entry-attempt")
    assert initial.setup_id != reentry.setup_id
    assert reentry.events[0].base_match_request.attempt_kind is AttemptKind.RE_ENTRY
    assert reentry.events[0].base_match_request.trigger_ordinal == 2


def test_partial_coverage_gap_resets_contact_then_stays_unresolved() -> None:
    partial = parsed_case("htf-flip-partial-coverage")
    first = scan_htf_flip(partial.events[0].htf_scan_requests[0])
    later = scan_htf_flip(partial.events[1].htf_scan_requests[0])

    assert first.coverage_gap_detected is True
    assert first.contact_child is None
    assert first.recross_child is None
    assert first.matched is False
    assert later.coverage_gap_detected is True
    assert later.contact_child is not None
    assert later.recross_child is not None
    assert later.fidelity is CandidateFidelity.UNRESOLVED


def recursive_key_present(value: object, key: str) -> bool:
    if isinstance(value, dict):
        return key in value or any(recursive_key_present(item, key) for item in value.values())
    if isinstance(value, list):
        return any(recursive_key_present(item, key) for item in value)
    return False


def differing_paths(
    left: object,
    right: object,
    *,
    path: str = "",
) -> set[str]:
    if isinstance(left, dict) and isinstance(right, dict):
        assert set(left) == set(right)
        return {
            changed
            for key in left
            for changed in differing_paths(
                left[key],
                right[key],
                path=f"{path}.{key}" if path else key,
            )
        }
    if isinstance(left, list) and isinstance(right, list):
        assert len(left) == len(right)
        return {
            changed
            for index, (left_item, right_item) in enumerate(zip(left, right, strict=True))
            for changed in differing_paths(
                left_item,
                right_item,
                path=f"{path}[{index}]",
            )
        }
    return {path} if left != right else set()


def replay_metadata_from_vector(case: dict[str, object]) -> dict[str, object]:
    return {
        key: case[key]
        for key in (
            "setup_id",
            "symbol",
            "feed",
            "calculation_start_epoch",
            "emission_start_epoch",
            "emission_end_epoch",
            "pine_supported",
        )
    }


def test_generated_edge_inputs_preserve_ids_and_have_no_child_arrays() -> None:
    fixture = load_fixture_document(FIXTURES)
    document = build_vectors(fixture)
    assert document["schema_id"] == "phase0.rd-entry-arbitration-vectors.v2"
    for raw, generated in zip(
        fixture["cases"],
        document["cases"],
        strict=True,
    ):
        for key in (
            "setup_id",
            "symbol",
            "feed",
            "calculation_start_epoch",
            "emission_start_epoch",
            "emission_end_epoch",
            "pine_supported",
        ):
            assert generated[key] == raw[key]
        assert [oracle_event["event_id"] for oracle_event in generated["edge_input"]["events"]] == [
            oracle_event["event_id"] for oracle_event in raw["input"]["events"]
        ]
        for key in ("children", "htf_scan_requests"):
            assert not recursive_key_present(generated["edge_input"], key)
            assert not recursive_key_present(generated["pine_edge_input"], key)
        assert differing_paths(
            generated["edge_input"],
            generated["pine_edge_input"],
        ) == {
            f"events[{index}].match_request.setup.common_fidelity"
            for index, oracle_event in enumerate(generated["edge_input"]["events"])
            if oracle_event["match_request"]["setup"]["common_fidelity"] != "UNRESOLVED"
        }


def test_edge_and_pine_inputs_replay_to_manually_reviewed_results() -> None:
    for generated in build_vectors(load_fixture_document(FIXTURES))["cases"]:
        metadata = replay_metadata_from_vector(generated)
        edge_case = EntryOracleCase.from_edge_mapping(
            generated["edge_input"],
            replay_metadata=metadata,
        )
        pine = EntryOracleCase.from_edge_mapping(
            generated["pine_edge_input"],
            replay_metadata=metadata,
        )

        assert evaluate_entry_stream(edge_case).to_mapping() == (generated["expected"])
        assert all(
            oracle_event.base_match_request.setup.common_fidelity is CandidateFidelity.UNRESOLVED
            for oracle_event in pine.events
        )
        assert evaluate_entry_stream(pine).to_mapping() == (generated["pine_expected"])


def test_vector_builder_rejects_unreviewed_expected_or_wrong_policy() -> None:
    changed_expected = deepcopy(load_fixture_document(FIXTURES))
    changed_expected["cases"][0]["expected"]["selection"]["reason"] = "NO_CANDIDATE"
    with pytest.raises(ValueError, match="expected|reviewed"):
        build_vectors(changed_expected)

    wrong_policy = deepcopy(load_fixture_document(FIXTURES))
    wrong_policy["cases"][0]["input"]["policy_version"] = "future-policy"
    with pytest.raises(ValueError, match="policy_version"):
        build_vectors(wrong_policy)


def test_strict_vector_document_validates_generated_surface() -> None:
    document = build_vectors(load_fixture_document(FIXTURES))

    parsed = RDEntryArbitrationVectorsV2.model_validate_json(json.dumps(document))

    assert len(parsed.cases) == 24
    unknown = deepcopy(document)
    unknown["cases"][0]["edge_input"]["events"][0]["match_request"]["unknown"] = True
    with pytest.raises(ValueError, match="Extra inputs|extra"):
        RDEntryArbitrationVectorsV2.model_validate_json(json.dumps(unknown))
    bool_epoch = deepcopy(document)
    bool_epoch["cases"][0]["emission_end_epoch"] = True
    with pytest.raises(ValueError, match="integer"):
        RDEntryArbitrationVectorsV2.model_validate_json(json.dumps(bool_epoch))


def test_strict_vector_document_rejects_duplicate_expected_ids() -> None:
    document = build_vectors(load_fixture_document(FIXTURES))
    duplicate = deepcopy(document)
    duplicate["cases"][0]["expected"]["candidates"].append(
        deepcopy(duplicate["cases"][0]["expected"]["candidates"][0])
    )

    with pytest.raises(ValueError, match="candidate IDs must be unique"):
        RDEntryArbitrationVectorsV2.model_validate_json(json.dumps(duplicate))


def test_strict_vector_document_rejects_coordinated_forged_evidence_payload() -> None:
    document = build_vectors(load_fixture_document(FIXTURES))
    forged = deepcopy(document)
    _coordinate_forged_evidence_payload(forged["cases"][0]["expected"])

    with pytest.raises(ValueError, match="payload_sha256|payload digest"):
        RDEntryArbitrationVectorsV2.model_validate_json(json.dumps(forged))


def _setup(
    *,
    setup_id: str = "setup-1",
    direction: EntryDirection = EntryDirection.LONG,
    zone_top_ticks: int = 97,
    zone_bottom_ticks: int = 95,
    terminal_reason: SetupAttemptTerminalReason | None = None,
    terminal_epoch: int | None = None,
    invalidated_before_entry: bool = False,
    common_fidelity: CandidateFidelity = CandidateFidelity.EXACT,
) -> SetupEntryFacts:
    return SetupEntryFacts(
        setup_id=setup_id,
        direction=direction,
        zone_top_ticks=zone_top_ticks,
        zone_bottom_ticks=zone_bottom_ticks,
        zone_engaged_epoch=OPEN,
        invalidated_before_entry=invalidated_before_entry,
        common_fidelity=common_fidelity,
        terminal_reason=terminal_reason,
        terminal_epoch=terminal_epoch,
    )


def _candle(
    open_epoch: int,
    *,
    seconds: int = 300,
    open_ticks: int = 99,
    high_ticks: int = 100,
    low_ticks: int = 98,
    close_ticks: int = 99,
) -> OrderedCandle:
    return OrderedCandle(
        open_epoch=open_epoch,
        close_epoch=open_epoch + seconds,
        open_ticks=open_ticks,
        high_ticks=high_ticks,
        low_ticks=low_ticks,
        close_ticks=close_ticks,
    )


def _request(
    bar: OrderedCandle,
    *,
    setup: SetupEntryFacts | None = None,
    generic_break: bool = False,
    rejection_respect: bool = False,
    attempt_kind: AttemptKind = AttemptKind.INITIAL,
    trigger_ordinal: int = 1,
) -> EntryMatchRequest:
    return EntryMatchRequest(
        setup=setup or _setup(),
        confirmed_bar=bar,
        htf_proofs=(),
        generic_break_detected=generic_break,
        rejection_respect_detected=rejection_respect,
        attempt_kind=attempt_kind,
        trigger_ordinal=trigger_ordinal,
    )


def _event(
    event_id: str,
    bar: OrderedCandle,
    *,
    setup: SetupEntryFacts | None = None,
    scans: tuple[HTFFlipScanRequest, ...] = (),
    generic_break: bool = False,
    rejection_respect: bool = False,
    attempt_kind: AttemptKind = AttemptKind.INITIAL,
    trigger_ordinal: int = 1,
) -> EntryOracleEvent:
    return EntryOracleEvent(
        event_id=event_id,
        base_match_request=_request(
            bar,
            setup=setup,
            generic_break=generic_break,
            rejection_respect=rejection_respect,
            attempt_kind=attempt_kind,
            trigger_ordinal=trigger_ordinal,
        ),
        htf_scan_requests=scans,
    )


def _scan(
    *,
    setup: SetupEntryFacts | None = None,
    context: int = 15,
    htf_open_epoch: int = OPEN,
    cutoff_seconds: int = 300,
    children: tuple[OrderedCandle, ...] | None = None,
    full_lifecycle_ordered: bool = True,
) -> HTFFlipScanRequest:
    minute_children = children or (
        _candle(
            htf_open_epoch,
            seconds=60,
            open_ticks=100,
            high_ticks=100,
            low_ticks=100,
            close_ticks=100,
        ),
        _candle(
            htf_open_epoch + 60,
            seconds=60,
            open_ticks=99,
            high_ticks=99,
            low_ticks=96,
            close_ticks=97,
        ),
        _candle(
            htf_open_epoch + 120,
            seconds=60,
            open_ticks=99,
            high_ticks=101,
            low_ticks=98,
            close_ticks=100,
        ),
        _candle(htf_open_epoch + 180, seconds=60),
        _candle(htf_open_epoch + 240, seconds=60),
    )
    return HTFFlipScanRequest(
        setup=setup or _setup(),
        timeframe_minutes=context,
        htf_open_epoch=htf_open_epoch,
        scan_cutoff_epoch=htf_open_epoch + cutoff_seconds,
        htf_open_ticks=100,
        children=minute_children,
        proof_resolution_seconds=60,
        full_lifecycle_ordered=full_lifecycle_ordered,
    )


def _close_event(
    event_id: str = "close",
    *,
    open_epoch: int = OPEN,
    setup: SetupEntryFacts | None = None,
    low_ticks: int = 98,
    attempt_kind: AttemptKind = AttemptKind.INITIAL,
    trigger_ordinal: int = 1,
) -> EntryOracleEvent:
    return _event(
        event_id,
        _candle(
            open_epoch,
            open_ticks=98,
            high_ticks=102,
            low_ticks=low_ticks,
            close_ticks=101,
        ),
        setup=setup,
        attempt_kind=attempt_kind,
        trigger_ordinal=trigger_ordinal,
    )


def _htf_event(
    event_id: str = "flip",
    *,
    setup: SetupEntryFacts | None = None,
    scan: HTFFlipScanRequest | None = None,
) -> EntryOracleEvent:
    actual_setup = setup or _setup()
    return _event(
        event_id,
        _candle(OPEN),
        setup=actual_setup,
        scans=(scan or _scan(setup=actual_setup),),
    )


def _case(
    events: tuple[EntryOracleEvent, ...],
    *,
    case_id: str = "case",
    setup_id: str = "setup-1",
    setup_invalidated: bool = False,
    emission_end_epoch: int = OPEN + 1_800,
) -> EntryOracleCase:
    return EntryOracleCase(
        case_id=case_id,
        setup_id=setup_id,
        symbol="GBPJPY",
        feed="OANDA",
        calculation_start_epoch=OPEN,
        emission_start_epoch=OPEN + 300,
        emission_end_epoch=emission_end_epoch,
        pine_supported=True,
        events=events,
        setup_invalidated=setup_invalidated,
        policy_version="rd-entry-arbitration-v2",
        revision=1,
        evaluated_at_epoch=emission_end_epoch,
    )


def _both_then_wick_case() -> EntryOracleCase:
    flip = _htf_event()
    close_epoch = OPEN + 600
    terminal = _setup(
        terminal_reason=SetupAttemptTerminalReason.BOTH_ACTIVE_MODELS_OBSERVED,
        terminal_epoch=close_epoch,
    )
    close = _close_event(open_epoch=OPEN + 300, setup=terminal)
    wick = _event(
        "wick",
        _candle(
            OPEN + 600,
            open_ticks=101,
            high_ticks=103,
            low_ticks=99,
            close_ticks=102,
        ),
        setup=terminal,
    )
    return _case((flip, close, wick))


def test_empty_reviewed_stream_fails_closed_without_a_candidate() -> None:
    result = evaluate_entry_stream(_case(()))

    assert result.candidates == ()
    assert result.evidence == ()
    assert result.handling == ()
    assert result.htf_transcripts == ()
    assert result.selection.reason is SelectionReason.NO_CANDIDATE
    assert result.selection.action is SelectionAction.NONE


def test_stream_accumulates_one_candidate_per_active_model() -> None:
    case = _both_then_wick_case()

    result = evaluate_entry_stream(case)

    assert {item.model for item in result.candidates} == {
        EntryModelV2.DIR_CLOSE,
        EntryModelV2.HTF_FLIP,
    }
    assert result.selection.canonical_model is EntryModelV2.HTF_FLIP
    assert result.selection.reason is SelectionReason.EARLIEST_EXACT_TRIGGER


def test_first_semantic_candidate_per_model_wins_with_dependents_suppressed() -> None:
    first = _close_event("first")
    later = _close_event("later", open_epoch=OPEN + 600)
    first_only = evaluate_entry_stream(_case((first,)))

    result = evaluate_entry_stream(_case((first, later)))

    assert result.candidates == first_only.candidates
    assert result.evidence == first_only.evidence
    assert result.handling == first_only.handling


def test_later_same_id_htf_candidate_with_changed_content_is_suppressed() -> None:
    first = _htf_event()
    later_scan = replace(
        _scan(),
        scan_cutoff_epoch=OPEN + 600,
        children=(
            *_scan().children,
            _candle(OPEN + 300, seconds=60),
            _candle(OPEN + 360, seconds=60),
            _candle(OPEN + 420, seconds=60),
            _candle(OPEN + 480, seconds=60),
            _candle(OPEN + 540, seconds=60),
        ),
    )
    later = _event(
        "later",
        _candle(OPEN + 300),
        scans=(later_scan,),
    )
    first_match = match_entry_candidates(
        replace(
            first.base_match_request,
            htf_proofs=(scan_htf_flip(first.htf_scan_requests[0]),),
        )
    )
    later_match = match_entry_candidates(
        replace(
            later.base_match_request,
            htf_proofs=(scan_htf_flip(later.htf_scan_requests[0]),),
        )
    )
    assert first_match.candidates[0].candidate_id == later_match.candidates[0].candidate_id
    assert first_match.candidates[0] != later_match.candidates[0]
    first_only = evaluate_entry_stream(_case((first,)))

    result = evaluate_entry_stream(_case((first, later)))

    assert result.candidates == first_only.candidates
    assert result.evidence == first_only.evidence
    assert result.handling == first_only.handling


def test_identical_candidate_replay_may_append_new_valid_evidence() -> None:
    facts = _setup()
    first = _event(
        "context-15",
        _candle(OPEN),
        setup=facts,
        scans=(_scan(setup=facts, context=15),),
    )
    later = _event(
        "context-30",
        _candle(OPEN),
        setup=facts,
        scans=(_scan(setup=facts, context=30),),
    )

    result = evaluate_entry_stream(_case((first, later)))

    assert len(result.candidates) == 1
    assert len(result.evidence) == 2
    assert {item.htf_context_minutes for item in result.evidence} == {
        (15,),
        (30,),
    }


def test_identical_duplicate_event_is_idempotent_and_conflict_is_rejected() -> None:
    close = _close_event()
    expected = evaluate_entry_stream(_case((close,)))

    assert evaluate_entry_stream(_case((close, close))) == expected
    with pytest.raises(ValueError, match="event_id|conflict"):
        evaluate_entry_stream(
            _case((close, replace(close, base_match_request=_request(_candle(OPEN)))))
        )


def test_one_case_cannot_change_immutable_attempt_facts() -> None:
    first = _close_event()
    changed_setup = replace(
        first.base_match_request.setup,
        common_fidelity=CandidateFidelity.CALIBRATED,
    )
    changed = _event(
        "changed",
        _candle(OPEN + 300),
        setup=changed_setup,
    )

    with pytest.raises(ValueError, match="immutable|attempt"):
        _case((first, changed))


def test_invalidation_before_any_candidate_selects_none() -> None:
    close_epoch = OPEN + 300
    setup = _setup(
        terminal_reason=SetupAttemptTerminalReason.INVALIDATED,
        terminal_epoch=close_epoch,
        invalidated_before_entry=True,
    )

    result = evaluate_entry_stream(
        _case((_event("invalidate", _candle(OPEN), setup=setup),), setup_invalidated=True)
    )

    assert result.candidates == ()
    assert result.selection.reason is SelectionReason.SETUP_INVALIDATED
    assert result.selection.action is SelectionAction.NONE


def test_invalidation_after_candidate_preserves_selection_and_evidence() -> None:
    close = _close_event()
    terminal_epoch = OPEN + 600
    invalidated = _setup(
        terminal_reason=SetupAttemptTerminalReason.INVALIDATED,
        terminal_epoch=terminal_epoch,
        invalidated_before_entry=False,
    )
    invalidation = _event(
        "invalidate",
        _candle(OPEN + 300),
        setup=invalidated,
    )
    first_only = evaluate_entry_stream(_case((close,)))

    result = evaluate_entry_stream(_case((close, invalidation)))

    assert result.candidates == first_only.candidates
    assert result.evidence == first_only.evidence
    assert result.selection == first_only.selection


def test_event_that_completes_both_must_terminalize_exactly_then() -> None:
    flip = _htf_event()
    nonterminal_close = _close_event(open_epoch=OPEN + 300)
    wrong_terminal = replace(
        nonterminal_close,
        base_match_request=replace(
            nonterminal_close.base_match_request,
            setup=_setup(
                terminal_reason=SetupAttemptTerminalReason.RETENTION_EVICTED,
                terminal_epoch=OPEN + 600,
            ),
        ),
    )

    with pytest.raises(ValueError, match="both|terminal"):
        evaluate_entry_stream(_case((flip, nonterminal_close)))
    with pytest.raises(ValueError, match="both|terminal|reason"):
        evaluate_entry_stream(_case((flip, wrong_terminal)))


def test_delayed_both_terminal_fact_is_rejected() -> None:
    flip = _htf_event()
    close = _close_event(open_epoch=OPEN + 300)
    delayed = _event(
        "delayed",
        _candle(OPEN + 600),
        setup=_setup(
            terminal_reason=SetupAttemptTerminalReason.BOTH_ACTIVE_MODELS_OBSERVED,
            terminal_epoch=OPEN + 900,
        ),
    )

    with pytest.raises(ValueError, match="both|terminal"):
        evaluate_entry_stream(_case((flip, close, delayed)))


def test_close_that_completes_both_gets_one_handling_only_grace() -> None:
    case = _both_then_wick_case()
    without_wick = evaluate_entry_stream(replace(case, events=case.events[:-1]))

    result = evaluate_entry_stream(case)

    wick = [item for item in result.handling if item.handling_mode is HandlingMode.NEXT_CANDLE_WICK]
    assert len(wick) == 1
    assert wick[0].fidelity is CandidateFidelity.DISCRETIONARY
    assert wick[0].source_claim_ids == NEXT_CANDLE_WICK_SOURCE_CLAIMS
    assert result.candidates == without_wick.candidates
    assert result.evidence == without_wick.evidence
    assert result.selection == without_wick.selection


def test_same_event_both_does_not_get_postterminal_grace() -> None:
    terminal = _setup(
        terminal_reason=SetupAttemptTerminalReason.BOTH_ACTIVE_MODELS_OBSERVED,
        terminal_epoch=OPEN + 300,
    )
    both = _close_event(setup=terminal)
    both = replace(
        both,
        htf_scan_requests=(_scan(setup=terminal),),
    )
    after = _event(
        "after",
        _candle(
            OPEN + 300,
            open_ticks=101,
            high_ticks=103,
            low_ticks=99,
            close_ticks=102,
        ),
        setup=terminal,
    )

    with pytest.raises(ValueError, match="terminal"):
        evaluate_entry_stream(_case((both, after)))


def test_terminal_grace_rejects_trigger_input_or_a_third_event() -> None:
    case = _both_then_wick_case()
    trigger_bearing = replace(
        case.events[-1],
        base_match_request=replace(
            case.events[-1].base_match_request,
            generic_break_detected=True,
        ),
    )
    third = replace(
        case.events[-1],
        event_id="third",
        base_match_request=replace(
            case.events[-1].base_match_request,
            confirmed_bar=_candle(OPEN + 900),
        ),
    )

    with pytest.raises(ValueError, match="grace|trigger"):
        evaluate_entry_stream(replace(case, events=(*case.events[:-1], trigger_bearing)))
    with pytest.raises(ValueError, match="terminal|event"):
        evaluate_entry_stream(replace(case, events=(*case.events, third)))


def test_invalidation_and_retention_terminals_have_no_grace() -> None:
    for reason in (
        SetupAttemptTerminalReason.INVALIDATED,
        SetupAttemptTerminalReason.RETENTION_EVICTED,
    ):
        terminal = _setup(terminal_reason=reason, terminal_epoch=OPEN + 600)
        after = _event("after", _candle(OPEN + 600), setup=terminal)
        with pytest.raises(ValueError, match="terminal"):
            evaluate_entry_stream(
                _case(
                    (
                        _close_event(),
                        _event("terminal", _candle(OPEN + 300), setup=terminal),
                        after,
                    )
                )
            )


def test_noncontiguous_terminal_grace_is_consumed_without_searching_later() -> None:
    case = _both_then_wick_case()
    noncontiguous = replace(
        case.events[-1],
        base_match_request=replace(
            case.events[-1].base_match_request,
            confirmed_bar=_candle(OPEN + 900),
        ),
    )
    later = replace(
        case.events[-1],
        event_id="later",
        base_match_request=replace(
            case.events[-1].base_match_request,
            confirmed_bar=_candle(
                OPEN + 1_200,
                open_ticks=101,
                high_ticks=103,
                low_ticks=99,
                close_ticks=102,
            ),
        ),
    )

    result = evaluate_entry_stream(replace(case, events=(*case.events[:-1], noncontiguous)))

    assert all(item.handling_mode is not HandlingMode.NEXT_CANDLE_WICK for item in result.handling)
    with pytest.raises(ValueError, match="terminal|event"):
        evaluate_entry_stream(replace(case, events=(*case.events[:-1], noncontiguous, later)))


def _edge_close_mapping() -> dict[str, object]:
    return {
        "setup_id": "setup-1",
        "events": [
            {
                "event_id": "close",
                "match_request": {
                    "setup": {
                        "setup_id": "setup-1",
                        "direction": "LONG",
                        "zone_top_ticks": 97,
                        "zone_bottom_ticks": 95,
                        "zone_engaged_epoch": OPEN,
                        "invalidated_before_entry": False,
                        "common_fidelity": "EXACT",
                        "terminal_reason": None,
                        "terminal_epoch": None,
                    },
                    "confirmed_bar": {
                        "open_epoch": OPEN,
                        "close_epoch": OPEN + 300,
                        "open_ticks": 98,
                        "high_ticks": 102,
                        "low_ticks": 98,
                        "close_ticks": 101,
                    },
                    "htf_proofs": [],
                    "generic_break_detected": False,
                    "rejection_respect_detected": False,
                    "attempt_kind": "INITIAL",
                    "trigger_ordinal": 1,
                },
            }
        ],
        "setup_invalidated": False,
        "policy_version": "rd-entry-arbitration-v2",
        "revision": 1,
        "evaluated_at_epoch": OPEN + 300,
    }


def _replay_metadata() -> dict[str, object]:
    return {
        "setup_id": "setup-1",
        "symbol": "GBPJPY",
        "feed": "OANDA",
        "calculation_start_epoch": OPEN,
        "emission_start_epoch": OPEN + 300,
        "emission_end_epoch": OPEN + 300,
        "pine_supported": True,
    }


def test_edge_mapping_parses_strictly_and_replays_without_a_scanner() -> None:
    parsed = EntryOracleCase.from_edge_mapping(
        _edge_close_mapping(),
        replay_metadata=_replay_metadata(),
    )

    result = evaluate_entry_stream(parsed)

    assert parsed.events[0].htf_scan_requests == ()
    assert result.selection.canonical_model is EntryModelV2.DIR_CLOSE
    assert result.to_mapping()["selection"]["policy_version"] == ("rd-entry-arbitration-v2")


@pytest.mark.parametrize(
    "mutate",
    [
        lambda value: value.update({"unknown": True}),
        lambda value: value.pop("revision"),
        lambda value: value.update({"revision": True}),
        lambda value: value.update({"evaluated_at_epoch": float(OPEN + 300)}),
        lambda value: value["events"][0]["match_request"]["confirmed_bar"].update(
            {"high_ticks": 97}
        ),
        lambda value: value["events"][0]["match_request"].update(
            {"attempt_kind": "INITIAL", "trigger_ordinal": 2}
        ),
    ],
)
def test_edge_mapping_rejects_unknown_missing_or_non_integer_fields(
    mutate: object,
) -> None:
    mapping = _edge_close_mapping()
    mutate(mapping)  # type: ignore[operator]

    with pytest.raises(
        ValueError,
        match="unknown|missing|integer|high|trigger_ordinal|INITIAL",
    ):
        EntryOracleCase.from_edge_mapping(
            mapping,
            replay_metadata=_replay_metadata(),
        )


def test_edge_mapping_rejects_conflicting_event_ids() -> None:
    mapping = _edge_close_mapping()
    conflicting = deepcopy(mapping["events"][0])  # type: ignore[index]
    conflicting["match_request"]["confirmed_bar"]["close_ticks"] = 100
    mapping["events"].append(conflicting)  # type: ignore[union-attr]

    with pytest.raises(ValueError, match="event_id|conflict"):
        EntryOracleCase.from_edge_mapping(
            mapping,
            replay_metadata=_replay_metadata(),
        )


def test_edge_mapping_revalidates_expanded_transcripts_semantically() -> None:
    mapping = _edge_close_mapping()
    transcript = scan_htf_flip(_scan()).transcript.to_mapping()
    match_request = mapping["events"][0]["match_request"]  # type: ignore[index]
    match_request["confirmed_bar"] = _candle(OPEN).to_mapping()
    match_request["htf_proofs"] = [transcript]

    parsed = EntryOracleCase.from_edge_mapping(
        mapping,
        replay_metadata=_replay_metadata(),
    )

    assert parsed.events[0].base_match_request.htf_proofs[0].matched is True
    tampered = deepcopy(mapping)
    tampered_transcript = tampered["events"][0]["match_request"]["htf_proofs"][0]
    tampered_transcript["recross_candle"]["high_ticks"] = 100
    with pytest.raises(ValueError, match="recross|cross"):
        EntryOracleCase.from_edge_mapping(
            tampered,
            replay_metadata=_replay_metadata(),
        )


@pytest.mark.parametrize(
    "next_bar",
    [
        _candle(
            OPEN + 300,
            open_ticks=101,
            high_ticks=103,
            low_ticks=101,
            close_ticks=102,
        ),
        _candle(
            OPEN + 600,
            open_ticks=101,
            high_ticks=103,
            low_ticks=99,
            close_ticks=102,
        ),
    ],
)
def test_absent_immediate_strict_counter_wick_emits_no_wick_handling(
    next_bar: OrderedCandle,
) -> None:
    result = evaluate_entry_stream(_case((_close_event(), _event("next", next_bar))))

    assert all(item.handling_mode is not HandlingMode.NEXT_CANDLE_WICK for item in result.handling)


def test_short_counter_wick_is_strict_and_symmetric() -> None:
    short = _setup(
        direction=EntryDirection.SHORT,
        zone_top_ticks=105,
        zone_bottom_ticks=103,
    )
    close = _event(
        "short-close",
        _candle(
            OPEN,
            open_ticks=104,
            high_ticks=104,
            low_ticks=99,
            close_ticks=100,
        ),
        setup=short,
    )
    equality = _event(
        "equal-high",
        _candle(
            OPEN + 300,
            open_ticks=100,
            high_ticks=100,
            low_ticks=98,
            close_ticks=99,
        ),
        setup=short,
    )
    strict = replace(
        equality,
        event_id="strict-high",
        base_match_request=replace(
            equality.base_match_request,
            confirmed_bar=_candle(
                OPEN + 300,
                open_ticks=100,
                high_ticks=102,
                low_ticks=98,
                close_ticks=99,
            ),
        ),
    )

    equal_result = evaluate_entry_stream(_case((close, equality)))
    strict_result = evaluate_entry_stream(_case((close, strict)))

    assert all(
        item.handling_mode is not HandlingMode.NEXT_CANDLE_WICK for item in equal_result.handling
    )
    assert (
        len(
            [
                item
                for item in strict_result.handling
                if item.handling_mode is HandlingMode.NEXT_CANDLE_WICK
            ]
        )
        == 1
    )


def test_later_wick_is_not_searched_after_immediate_window_closes() -> None:
    immediate_without_wick = _event(
        "immediate",
        _candle(
            OPEN + 300,
            open_ticks=101,
            high_ticks=103,
            low_ticks=101,
            close_ticks=102,
        ),
    )
    later_with_wick = _event(
        "later",
        _candle(
            OPEN + 600,
            open_ticks=102,
            high_ticks=103,
            low_ticks=99,
            close_ticks=101,
        ),
    )

    result = evaluate_entry_stream(_case((_close_event(), immediate_without_wick, later_with_wick)))

    assert all(item.handling_mode is not HandlingMode.NEXT_CANDLE_WICK for item in result.handling)
