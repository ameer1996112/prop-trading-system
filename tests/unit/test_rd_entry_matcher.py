from __future__ import annotations

import json
from dataclasses import replace
from pathlib import Path

import pytest

from prop_trading.domain.canonical import canonical_sha256
from prop_trading.domain.rd_entry_matcher import (
    HTF_BOUNDARY_SOURCE_CLAIMS,
    MODEL_SOURCE_CLAIMS,
    NEXT_CANDLE_WICK_SOURCE_CLAIMS,
    EntryMatchRequest,
    SetupEntryFacts,
    match_entry_candidates,
)
from prop_trading.domain.rd_entry_models import (
    AmbiguityCode,
    AttemptKind,
    CandidateFidelity,
    CandidateState,
    EntryCandidateIdentity,
    EntryDirection,
    EntryEvidenceIdentity,
    EntryHandlingIdentity,
    EntryModelV2,
    HandlingMode,
    HTFFlipProof,
    HTFFlipProofTranscript,
    OrderedCandle,
    ProofPlane,
    SetupAttemptTerminalReason,
    candidate_id,
    evidence_id,
    handling_id,
)

CONTRACT = Path("config/phase0/rd-strategy-rule-contract-v2.json")


def _setup(
    *,
    direction: EntryDirection = EntryDirection.LONG,
    zone_top_ticks: int = 100,
    zone_bottom_ticks: int = 90,
    zone_engaged_epoch: int | None = 900,
    common_fidelity: CandidateFidelity = CandidateFidelity.EXACT,
) -> SetupEntryFacts:
    return SetupEntryFacts(
        setup_id="setup-1",
        direction=direction,
        zone_top_ticks=zone_top_ticks,
        zone_bottom_ticks=zone_bottom_ticks,
        zone_engaged_epoch=zone_engaged_epoch,
        invalidated_before_entry=False,
        common_fidelity=common_fidelity,
        terminal_reason=None,
        terminal_epoch=None,
    )


def _request(
    *,
    setup: SetupEntryFacts | None = None,
    open_epoch: int = 1_000,
    close_epoch: int = 1_300,
    open_ticks: int = 99,
    high_ticks: int = 103,
    low_ticks: int = 98,
    close_ticks: int = 102,
    htf_proofs: tuple[HTFFlipProof, ...] = (),
    generic_break: bool = False,
    rejection_respect: bool = False,
) -> EntryMatchRequest:
    return EntryMatchRequest(
        setup=setup or _setup(),
        confirmed_bar=OrderedCandle(
            open_epoch=open_epoch,
            close_epoch=close_epoch,
            open_ticks=open_ticks,
            high_ticks=high_ticks,
            low_ticks=low_ticks,
            close_ticks=close_ticks,
        ),
        htf_proofs=htf_proofs,
        generic_break_detected=generic_break,
        rejection_respect_detected=rejection_respect,
        attempt_kind=AttemptKind.INITIAL,
        trigger_ordinal=1,
    )


def _flip_proof(
    *,
    context_minutes: int = 15,
    event_anchor_epoch: int = 1_000,
    trigger_epoch: int = 1_120,
    trigger_ticks: int = 100,
    scan_cutoff_epoch: int = 1_300,
    proof_resolution_seconds: int = 60,
    fidelity: CandidateFidelity = CandidateFidelity.EXACT,
    matched: bool = True,
    ambiguity_codes: tuple[AmbiguityCode, ...] = (),
    full_lifecycle_ordered: bool = True,
    expected_child_count: int = 5,
    observed_child_count: int = 5,
    gap_present: bool = False,
) -> HTFFlipProof:
    contact = OrderedCandle(
        open_epoch=event_anchor_epoch,
        close_epoch=event_anchor_epoch + proof_resolution_seconds,
        open_ticks=102,
        high_ticks=103,
        low_ticks=95,
        close_ticks=97,
    )
    recross = OrderedCandle(
        open_epoch=trigger_epoch - proof_resolution_seconds,
        close_epoch=trigger_epoch,
        open_ticks=97,
        high_ticks=101,
        low_ticks=96,
        close_ticks=99,
    )
    transcript = HTFFlipProofTranscript(
        context_minutes=context_minutes,
        htf_open_epoch=event_anchor_epoch,
        htf_open_ticks=trigger_ticks,
        scan_cutoff_epoch=scan_cutoff_epoch,
        proof_resolution_seconds=proof_resolution_seconds,
        coverage_start_epoch=event_anchor_epoch,
        coverage_end_epoch=scan_cutoff_epoch,
        expected_child_count=expected_child_count,
        observed_child_count=observed_child_count,
        gap_present=gap_present,
        full_lifecycle_ordered=full_lifecycle_ordered,
        destination_seen_before_contact=False,
        contact_candle=contact if matched else None,
        recross_candle=recross if matched else None,
        same_child=False,
    )
    return HTFFlipProof(
        matched=matched,
        event_anchor_epoch=event_anchor_epoch,
        trigger_epoch=trigger_epoch if matched else None,
        trigger_ticks=trigger_ticks if matched else None,
        htf_context_minutes=(context_minutes,),
        fidelity=fidelity,
        proof_plane=ProofPlane.LOWER_TIMEFRAME_REPLAY,
        proof_resolution_seconds=proof_resolution_seconds,
        coverage_start_epoch=event_anchor_epoch,
        coverage_end_epoch=scan_cutoff_epoch,
        coverage_expected_child_count=expected_child_count,
        coverage_observed_child_count=observed_child_count,
        coverage_gap_detected=gap_present,
        contact_child=contact if matched else None,
        recross_child=recross if matched else None,
        destination_seen_before_contact=False,
        ambiguity_codes=ambiguity_codes,
        transcript_sha256=canonical_sha256(transcript.to_mapping()),
        full_lifecycle_ordered=full_lifecycle_ordered,
        transcript=transcript,
    )


def test_directional_close_and_legacy_observations_are_retained_independently() -> None:
    result = match_entry_candidates(_request(generic_break=True, rejection_respect=True))

    assert [candidate.model for candidate in result.candidates] == [
        EntryModelV2.DIR_CLOSE,
        EntryModelV2.LEGACY_BREAK_CANDLE,
        EntryModelV2.LEGACY_REJECTION_RESPECT,
    ]
    assert [candidate.state for candidate in result.candidates] == [
        CandidateState.MATCHED,
        CandidateState.REJECTED,
        CandidateState.REJECTED,
    ]


def test_rejection_only_never_becomes_directional_close() -> None:
    result = match_entry_candidates(
        _request(
            open_ticks=99,
            high_ticks=101,
            low_ticks=98,
            close_ticks=100,
            rejection_respect=True,
        )
    )

    assert [candidate.model for candidate in result.candidates] == [
        EntryModelV2.LEGACY_REJECTION_RESPECT
    ]


def test_directional_close_is_symmetric_for_supply() -> None:
    result = match_entry_candidates(
        _request(
            setup=_setup(
                direction=EntryDirection.SHORT,
                zone_top_ticks=110,
                zone_bottom_ticks=100,
            ),
            open_ticks=101,
            high_ticks=102,
            low_ticks=97,
            close_ticks=98,
        )
    )

    assert len(result.candidates) == 1
    assert result.candidates[0].model is EntryModelV2.DIR_CLOSE
    assert result.candidates[0].direction is EntryDirection.SHORT


def test_exact_close_with_calibrated_common_setup_stays_calibrated() -> None:
    result = match_entry_candidates(
        _request(setup=_setup(common_fidelity=CandidateFidelity.CALIBRATED))
    )

    assert result.evidence[0].fidelity is CandidateFidelity.CALIBRATED


def test_unengaged_or_invalidated_setup_emits_no_new_candidate() -> None:
    unengaged = match_entry_candidates(
        _request(setup=_setup(zone_engaged_epoch=None), generic_break=True)
    )
    invalidated_setup = replace(
        _setup(),
        invalidated_before_entry=True,
        terminal_reason=SetupAttemptTerminalReason.INVALIDATED,
        terminal_epoch=950,
    )
    invalidated = match_entry_candidates(_request(setup=invalidated_setup, generic_break=True))

    assert unengaged.candidates == ()
    assert invalidated.candidates == ()
    assert invalidated.evidence == ()
    assert invalidated.handling == ()


@pytest.mark.parametrize(
    ("terminal_reason", "terminal_epoch", "invalidated_before_entry"),
    [
        (SetupAttemptTerminalReason.INVALIDATED, None, True),
        (None, 950, False),
        (SetupAttemptTerminalReason.RETENTION_EVICTED, -1, False),
        (SetupAttemptTerminalReason.RETENTION_EVICTED, 899, False),
        (SetupAttemptTerminalReason.RETENTION_EVICTED, 950, True),
    ],
)
def test_terminal_shape_and_invalidation_facts_are_strict(
    terminal_reason: SetupAttemptTerminalReason | None,
    terminal_epoch: int | None,
    invalidated_before_entry: bool,
) -> None:
    with pytest.raises(ValueError, match="terminal|invalidated"):
        replace(
            _setup(),
            terminal_reason=terminal_reason,
            terminal_epoch=terminal_epoch,
            invalidated_before_entry=invalidated_before_entry,
        )


@pytest.mark.parametrize(
    ("attempt_kind", "trigger_ordinal"),
    [
        (AttemptKind.INITIAL, 2),
        (AttemptKind.RE_ENTRY, 1),
        (AttemptKind.RE_ENTRY, 0),
    ],
)
def test_attempt_kind_and_trigger_ordinal_must_agree(
    attempt_kind: AttemptKind,
    trigger_ordinal: int,
) -> None:
    with pytest.raises(ValueError, match="trigger_ordinal"):
        replace(
            _request(),
            attempt_kind=attempt_kind,
            trigger_ordinal=trigger_ordinal,
        )


def test_isolated_reentry_uses_attempt_scoped_setup_and_supplied_ordinal() -> None:
    request = replace(
        _request(),
        setup=replace(_setup(), setup_id="setup-1/re-entry/2"),
        attempt_kind=AttemptKind.RE_ENTRY,
        trigger_ordinal=2,
    )

    candidate = match_entry_candidates(request).candidates[0]

    assert candidate.setup_id == "setup-1/re-entry/2"
    assert candidate.trigger_ordinal == 2


@pytest.mark.parametrize(
    ("setup_fidelity", "trigger_fidelity", "expected"),
    [
        (
            CandidateFidelity.EXACT,
            CandidateFidelity.EXACT,
            CandidateFidelity.EXACT,
        ),
        (
            CandidateFidelity.CALIBRATED,
            CandidateFidelity.EXACT,
            CandidateFidelity.CALIBRATED,
        ),
        (
            CandidateFidelity.EXACT,
            CandidateFidelity.DISCRETIONARY,
            CandidateFidelity.DISCRETIONARY,
        ),
        (
            CandidateFidelity.UNRESOLVED,
            CandidateFidelity.EXACT,
            CandidateFidelity.UNRESOLVED,
        ),
        (
            CandidateFidelity.EXACT,
            CandidateFidelity.UNRESOLVED,
            CandidateFidelity.UNRESOLVED,
        ),
    ],
)
def test_fidelity_uses_closed_least_trusted_order(
    setup_fidelity: CandidateFidelity,
    trigger_fidelity: CandidateFidelity,
    expected: CandidateFidelity,
) -> None:
    proof = _flip_proof(fidelity=trigger_fidelity)
    result = match_entry_candidates(
        _request(
            setup=_setup(common_fidelity=setup_fidelity),
            open_ticks=101,
            close_ticks=100,
            htf_proofs=(proof,),
        )
    )

    assert result.evidence[0].fidelity is expected


def test_one_flip_combines_contexts_independent_of_input_order() -> None:
    proofs = (
        _flip_proof(context_minutes=60),
        _flip_proof(context_minutes=15),
        _flip_proof(context_minutes=30),
    )
    forward = match_entry_candidates(_request(open_ticks=101, close_ticks=100, htf_proofs=proofs))
    reverse = match_entry_candidates(
        _request(open_ticks=101, close_ticks=100, htf_proofs=tuple(reversed(proofs)))
    )

    assert forward == reverse
    assert len(forward.candidates) == 1
    assert forward.candidates[0].model is EntryModelV2.HTF_FLIP
    assert len(forward.evidence) == 1
    assert forward.evidence[0].htf_context_minutes == (15, 30, 60)


def test_mixed_context_fidelity_stays_separate_and_state_is_order_independent() -> None:
    unresolved = _flip_proof(
        context_minutes=15,
        fidelity=CandidateFidelity.UNRESOLVED,
        full_lifecycle_ordered=False,
    )
    exact = _flip_proof(context_minutes=30)
    forward = match_entry_candidates(
        _request(open_ticks=101, close_ticks=100, htf_proofs=(unresolved, exact))
    )
    reverse = match_entry_candidates(
        _request(open_ticks=101, close_ticks=100, htf_proofs=(exact, unresolved))
    )

    assert forward == reverse
    assert forward.candidates[0].state is CandidateState.MATCHED
    assert {(item.fidelity, item.htf_context_minutes) for item in forward.evidence} == {
        (CandidateFidelity.EXACT, (30,)),
        (CandidateFidelity.UNRESOLVED, (15,)),
    }


def test_all_unresolved_flip_proofs_emit_one_blocked_candidate() -> None:
    proof = _flip_proof(
        fidelity=CandidateFidelity.UNRESOLVED,
        ambiguity_codes=(AmbiguityCode.SAME_CHILD_BAR_ORDER,),
        full_lifecycle_ordered=False,
    )

    result = match_entry_candidates(_request(open_ticks=101, close_ticks=100, htf_proofs=(proof,)))

    assert result.candidates[0].state is CandidateState.BLOCKED
    assert result.evidence[0].failed_rule_ids == ("ENTRY_HTF_FLIP",)
    assert result.evidence[0].source_claim_ids == (
        *MODEL_SOURCE_CLAIMS[EntryModelV2.HTF_FLIP],
        *HTF_BOUNDARY_SOURCE_CLAIMS,
    )


def test_unmatched_flip_proof_is_not_a_candidate() -> None:
    result = match_entry_candidates(
        _request(
            open_ticks=101,
            close_ticks=100,
            htf_proofs=(_flip_proof(matched=False),),
        )
    )

    assert result.candidates == ()


def test_matching_htf_break_normalizes_without_rejected_legacy_duplicate() -> None:
    proof = _flip_proof(trigger_epoch=1_300, scan_cutoff_epoch=1_300)
    result = match_entry_candidates(
        _request(
            open_ticks=101,
            close_ticks=100,
            htf_proofs=(proof,),
            generic_break=True,
        )
    )

    assert [candidate.model for candidate in result.candidates] == [EntryModelV2.HTF_FLIP]
    assert result.candidates[0].state is CandidateState.NORMALIZED
    assert result.candidates[0].normalized_from is EntryModelV2.LEGACY_BREAK_CANDLE
    assert result.candidates[0].event_anchor_epoch == proof.event_anchor_epoch
    assert result.evidence[0].source_claim_ids == (
        *MODEL_SOURCE_CLAIMS[EntryModelV2.HTF_FLIP],
        *MODEL_SOURCE_CLAIMS[EntryModelV2.LEGACY_BREAK_CANDLE],
    )


def test_non_matching_generic_break_remains_independent_legacy_observation() -> None:
    proof = _flip_proof(trigger_epoch=1_120)
    result = match_entry_candidates(
        _request(
            open_ticks=101,
            close_ticks=100,
            htf_proofs=(proof,),
            generic_break=True,
        )
    )

    assert {candidate.model for candidate in result.candidates} == {
        EntryModelV2.HTF_FLIP,
        EntryModelV2.LEGACY_BREAK_CANDLE,
    }


def test_candidate_evidence_and_handling_ids_use_frozen_identities() -> None:
    request = _request()
    result = match_entry_candidates(request)
    candidate = result.candidates[0]
    evidence = result.evidence[0]
    handling = result.handling[0]

    assert candidate.candidate_id == candidate_id(
        EntryCandidateIdentity(
            setup_id=request.setup.setup_id,
            model=EntryModelV2.DIR_CLOSE,
            direction=EntryDirection.LONG,
            event_anchor_epoch=request.confirmed_bar.open_epoch,
            trigger_ordinal=1,
        )
    )
    assert evidence.evidence_id == evidence_id(
        EntryEvidenceIdentity(
            candidate_id=candidate.candidate_id,
            proof_plane=evidence.proof_plane,
            proof_resolution_seconds=evidence.proof_resolution_seconds,
            coverage_start_epoch=evidence.coverage_start_epoch,
            coverage_end_epoch=evidence.coverage_end_epoch,
            observed_trigger_epoch=evidence.observed_trigger_epoch,
            payload_sha256=evidence.payload_sha256,
        )
    )
    assert handling.handling_id == handling_id(
        EntryHandlingIdentity(
            candidate_id=candidate.candidate_id,
            evidence_id=evidence.evidence_id,
            handling_mode=HandlingMode.CLOSE_CONFIRMATION,
            attempt_kind=AttemptKind.INITIAL,
            observed_epoch=request.confirmed_bar.close_epoch,
            observed_ticks=request.confirmed_bar.close_ticks,
            fidelity=evidence.fidelity,
            source_claim_ids=MODEL_SOURCE_CLAIMS[EntryModelV2.DIR_CLOSE],
        )
    )


def test_evidence_payload_is_recomputed_from_final_expanded_mapping() -> None:
    proof = _flip_proof(context_minutes=30)
    evidence = match_entry_candidates(
        _request(open_ticks=101, close_ticks=100, htf_proofs=(proof,))
    ).evidence[0]
    expanded = {
        "ambiguity_codes": [item.value for item in evidence.ambiguity_codes],
        "candidate_id": evidence.candidate_id,
        "coverage_end_epoch": evidence.coverage_end_epoch,
        "coverage_start_epoch": evidence.coverage_start_epoch,
        "failed_rule_ids": list(evidence.failed_rule_ids),
        "fidelity": evidence.fidelity.value,
        "htf_context_minutes": list(evidence.htf_context_minutes),
        "observed_trigger_epoch": evidence.observed_trigger_epoch,
        "observed_trigger_ticks": evidence.observed_trigger_ticks,
        "passed_rule_ids": list(evidence.passed_rule_ids),
        "proof_plane": evidence.proof_plane.value,
        "proof_resolution_seconds": evidence.proof_resolution_seconds,
        "source_claim_ids": list(evidence.source_claim_ids),
    }

    assert evidence.payload_sha256 == canonical_sha256(expanded)
    assert evidence.payload_sha256 != proof.transcript_sha256


def test_confirmed_and_intrabar_matches_emit_matcher_owned_handling() -> None:
    proof = _flip_proof()
    result = match_entry_candidates(_request(htf_proofs=(proof,)))

    assert {
        (
            item.handling_mode,
            item.observed_epoch,
            item.observed_ticks,
            item.source_claim_ids,
        )
        for item in result.handling
    } == {
        (
            HandlingMode.CLOSE_CONFIRMATION,
            1_300,
            102,
            MODEL_SOURCE_CLAIMS[EntryModelV2.DIR_CLOSE],
        ),
        (
            HandlingMode.INTRABAR_FLIP,
            1_120,
            100,
            MODEL_SOURCE_CLAIMS[EntryModelV2.HTF_FLIP],
        ),
    }


def test_source_claim_constants_match_v2_contract_rules() -> None:
    rules = json.loads(CONTRACT.read_text())["rules_by_id"]

    assert MODEL_SOURCE_CLAIMS[EntryModelV2.DIR_CLOSE] == tuple(
        rules["ENTRY_DIR_CLOSE"]["source_claim_ids"]
    )
    assert MODEL_SOURCE_CLAIMS[EntryModelV2.HTF_FLIP] == tuple(
        rules["ENTRY_HTF_FLIP"]["source_claim_ids"]
    )
    assert MODEL_SOURCE_CLAIMS[EntryModelV2.LEGACY_BREAK_CANDLE] == tuple(
        rules["ENTRY_BREAK_CANDLE_NORMALIZATION"]["source_claim_ids"]
    )
    assert MODEL_SOURCE_CLAIMS[EntryModelV2.LEGACY_REJECTION_RESPECT] == tuple(
        rules["ENTRY_REJECTION_RESPECT_DISABLED"]["source_claim_ids"]
    )
    assert (
        tuple(rules["ENTRY_NEXT_CANDLE_WICK_HANDLING"]["source_claim_ids"])
        == NEXT_CANDLE_WICK_SOURCE_CLAIMS
    )
    assert (
        tuple(rules["ENTRY_HTF_BOUNDARY_CAUTION"]["source_claim_ids"]) == HTF_BOUNDARY_SOURCE_CLAIMS
    )


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("generic_break_detected", 1),
        ("rejection_respect_detected", None),
        ("htf_proofs", []),
        ("attempt_kind", "INITIAL"),
    ],
)
def test_match_request_rejects_non_canonical_field_types(
    field: str,
    value: object,
) -> None:
    with pytest.raises(ValueError, match=field):
        replace(_request(), **{field: value})
