from dataclasses import replace

import pytest

from prop_trading.domain.canonical import canonical_sha256
from prop_trading.domain.rd_entry_models import (
    AmbiguityCode,
    AttemptKind,
    CandidateFidelity,
    CandidateState,
    EntryCandidate,
    EntryCandidateEvidence,
    EntryCandidateIdentity,
    EntryDirection,
    EntryEvidenceIdentity,
    EntryHandlingIdentity,
    EntryHandlingObservation,
    EntryModelV2,
    EntrySelection,
    EntrySelectionIdentity,
    HandlingMode,
    HTFFlipProof,
    HTFFlipProofTranscript,
    OrderedCandle,
    ProofPlane,
    SelectionAction,
    SelectionReason,
    candidate_id,
    evidence_id,
    handling_id,
    selection_id,
)


def _candle(*, open_epoch: int = 0, close_epoch: int = 60) -> OrderedCandle:
    return OrderedCandle(
        open_epoch=open_epoch,
        close_epoch=close_epoch,
        open_ticks=100,
        high_ticks=120,
        low_ticks=90,
        close_ticks=110,
    )


def _transcript(**changes: object) -> HTFFlipProofTranscript:
    values: dict[str, object] = {
        "context_minutes": 15,
        "htf_open_epoch": 1_721_808_000,
        "htf_open_ticks": 100,
        "scan_cutoff_epoch": 1_721_808_300,
        "proof_resolution_seconds": 60,
        "coverage_start_epoch": 1_721_808_000,
        "coverage_end_epoch": 1_721_808_300,
        "expected_child_count": 5,
        "observed_child_count": 5,
        "gap_present": False,
        "full_lifecycle_ordered": True,
        "destination_seen_before_contact": False,
        "contact_candle": _candle(),
        "recross_candle": _candle(open_epoch=60, close_epoch=120),
        "same_child": False,
    }
    values.update(changes)
    return HTFFlipProofTranscript(**values)  # type: ignore[arg-type]


def _handling_observation() -> EntryHandlingObservation:
    return EntryHandlingObservation(
        handling_id="c" * 64,
        candidate_id="a" * 64,
        evidence_id="b" * 64,
        handling_mode=HandlingMode.AGGRESSIVE,
        attempt_kind=AttemptKind.INITIAL,
        observed_epoch=1,
        observed_ticks=None,
        fidelity=CandidateFidelity.EXACT,
        source_claim_ids=("claim",),
    )


def _selection() -> EntrySelection:
    return EntrySelection(
        selection_id="c" * 64,
        setup_id="setup",
        policy_version="rd-entry-arbitration-v2",
        revision=0,
        candidate_ids_considered=("a" * 64, "b" * 64),
        canonical_candidate_id="a" * 64,
        canonical_evidence_id="b" * 64,
        canonical_model=EntryModelV2.DIR_CLOSE,
        reason=SelectionReason.ONLY_EXACT_TRIGGER,
        fidelity=CandidateFidelity.EXACT,
        action=SelectionAction.PAPER_ELIGIBLE,
        evaluated_at_epoch=1,
    )


def test_candidate_identity_is_semantic_and_proof_independent() -> None:
    identity = EntryCandidateIdentity(
        setup_id="setup-1",
        model=EntryModelV2.HTF_FLIP,
        direction=EntryDirection.LONG,
        event_anchor_epoch=1_721_808_000,
        trigger_ordinal=1,
    )

    assert len(candidate_id(identity)) == 64


def test_candidate_identity_rejects_zero_ordinal() -> None:
    with pytest.raises(ValueError, match="trigger_ordinal must be positive"):
        EntryCandidateIdentity(
            setup_id="setup-1",
            model=EntryModelV2.DIR_CLOSE,
            direction=EntryDirection.LONG,
            event_anchor_epoch=1_721_808_000,
            trigger_ordinal=0,
        )


def test_evidence_identity_changes_with_proof_plane() -> None:
    base = EntryEvidenceIdentity(
        candidate_id="a" * 64,
        proof_plane=ProofPlane.LOWER_TIMEFRAME_REPLAY,
        proof_resolution_seconds=60,
        coverage_start_epoch=1_721_808_000,
        coverage_end_epoch=1_721_808_300,
        observed_trigger_epoch=1_721_808_120,
        payload_sha256="b" * 64,
    )

    assert evidence_id(base) != evidence_id(
        replace(base, proof_plane=ProofPlane.REALTIME_TICK)
    )


def test_identity_hashes_use_the_cross_language_canonical_payloads() -> None:
    candidate = EntryCandidateIdentity(
        setup_id="setup-1",
        model=EntryModelV2.DIR_CLOSE,
        direction=EntryDirection.LONG,
        event_anchor_epoch=1,
        trigger_ordinal=1,
    )
    evidence = EntryEvidenceIdentity(
        candidate_id="a" * 64,
        proof_plane=ProofPlane.CONFIRMED_5M,
        proof_resolution_seconds=300,
        coverage_start_epoch=0,
        coverage_end_epoch=300,
        observed_trigger_epoch=None,
        payload_sha256="b" * 64,
    )
    handling = EntryHandlingIdentity(
        candidate_id="a" * 64,
        evidence_id="b" * 64,
        handling_mode=HandlingMode.AGGRESSIVE,
        attempt_kind=AttemptKind.INITIAL,
        observed_epoch=1,
        observed_ticks=None,
        fidelity=CandidateFidelity.EXACT,
        source_claim_ids=("claim-a",),
    )
    selection = EntrySelectionIdentity(
        setup_id="setup-1",
        policy_version="rd-entry-arbitration-v2",
        revision=0,
        candidate_ids_considered=("a" * 64,),
        canonical_candidate_id="a" * 64,
        canonical_evidence_id="b" * 64,
        reason=SelectionReason.ONLY_EXACT_TRIGGER,
        fidelity=CandidateFidelity.EXACT,
        action=SelectionAction.PAPER_ELIGIBLE,
    )

    assert candidate_id(candidate) == canonical_sha256(
        {
            "direction": "LONG",
            "event_anchor_epoch": 1,
            "model": "DIR_CLOSE",
            "setup_id": "setup-1",
            "trigger_ordinal": 1,
        }
    )
    assert evidence_id(evidence) == canonical_sha256(
        {
            "candidate_id": "a" * 64,
            "coverage_end_epoch": 300,
            "coverage_start_epoch": 0,
            "observed_trigger_epoch": None,
            "payload_sha256": "b" * 64,
            "proof_plane": "CONFIRMED_5M",
            "proof_resolution_seconds": 300,
        }
    )
    assert handling_id(handling) == canonical_sha256(
        {
            "attempt_kind": "INITIAL",
            "candidate_id": "a" * 64,
            "evidence_id": "b" * 64,
            "fidelity": "EXACT",
            "handling_mode": "AGGRESSIVE",
            "observed_epoch": 1,
            "observed_ticks": None,
            "source_claim_ids": ["claim-a"],
        }
    )
    assert selection_id(selection) == canonical_sha256(
        {
            "action": "PAPER_ELIGIBLE",
            "candidate_ids_considered": ["a" * 64],
            "canonical_candidate_id": "a" * 64,
            "canonical_evidence_id": "b" * 64,
            "fidelity": "EXACT",
            "policy_version": "rd-entry-arbitration-v2",
            "reason": "ONLY_EXACT_TRIGGER",
            "revision": 0,
            "setup_id": "setup-1",
        }
    )


@pytest.mark.parametrize("value", [True, False, 1.5])
def test_integer_epochs_and_ticks_reject_booleans_and_non_integers(value: object) -> None:
    with pytest.raises(ValueError, match="must be an integer"):
        EntryCandidateIdentity(
            setup_id="setup-1",
            model=EntryModelV2.DIR_CLOSE,
            direction=EntryDirection.LONG,
            event_anchor_epoch=value,  # type: ignore[arg-type]
            trigger_ordinal=1,
        )
    with pytest.raises(ValueError, match="must be an integer"):
        OrderedCandle(
            open_epoch=0,
            close_epoch=60,
            open_ticks=value,  # type: ignore[arg-type]
            high_ticks=120,
            low_ticks=90,
            close_ticks=110,
        )


def test_ordered_candle_rejects_invalid_interval_and_ohlc() -> None:
    with pytest.raises(ValueError, match="close_epoch must be after open_epoch"):
        _candle(open_epoch=60, close_epoch=60)
    with pytest.raises(ValueError, match="high_ticks is below candle values"):
        OrderedCandle(0, 60, 100, 105, 90, 110)


def test_ticks_are_integers_but_only_epochs_are_non_negative() -> None:
    candle = OrderedCandle(
        open_epoch=0,
        close_epoch=60,
        open_ticks=-100,
        high_ticks=-80,
        low_ticks=-120,
        close_ticks=-90,
    )

    assert candle.close_ticks == -90
    with pytest.raises(ValueError, match="open_epoch must be non-negative"):
        OrderedCandle(-1, 60, 100, 120, 90, 110)


def test_transcript_mapping_and_validation_preserve_full_candle_structure() -> None:
    transcript = _transcript()

    assert transcript.to_mapping() == {
        "context_minutes": 15,
        "htf_open_epoch": 1_721_808_000,
        "htf_open_ticks": 100,
        "scan_cutoff_epoch": 1_721_808_300,
        "proof_resolution_seconds": 60,
        "coverage_start_epoch": 1_721_808_000,
        "coverage_end_epoch": 1_721_808_300,
        "expected_child_count": 5,
        "observed_child_count": 5,
        "gap_present": False,
        "full_lifecycle_ordered": True,
        "destination_seen_before_contact": False,
        "contact_candle": {
            "open_epoch": 0,
            "close_epoch": 60,
            "open_ticks": 100,
            "high_ticks": 120,
            "low_ticks": 90,
            "close_ticks": 110,
        },
        "recross_candle": {
            "open_epoch": 60,
            "close_epoch": 120,
            "open_ticks": 100,
            "high_ticks": 120,
            "low_ticks": 90,
            "close_ticks": 110,
        },
        "same_child": False,
    }
    with pytest.raises(ValueError, match="context_minutes must be one of"):
        _transcript(context_minutes=5)
    with pytest.raises(ValueError, match="same_child must exactly reflect"):
        _transcript(recross_candle=_candle(), same_child=False)
    with pytest.raises(ValueError, match="recross_candle requires contact_candle"):
        _transcript(contact_candle=None, recross_candle=_candle())


def test_htf_proof_rejects_structural_fields_that_disagree_with_transcript() -> None:
    transcript = _transcript()
    proof = HTFFlipProof(
        matched=True,
        event_anchor_epoch=transcript.htf_open_epoch,
        trigger_epoch=transcript.recross_candle.close_epoch,
        trigger_ticks=transcript.htf_open_ticks,
        htf_context_minutes=(15,),
        fidelity=CandidateFidelity.EXACT,
        proof_plane=ProofPlane.LOWER_TIMEFRAME_REPLAY,
        proof_resolution_seconds=60,
        coverage_start_epoch=transcript.coverage_start_epoch,
        coverage_end_epoch=transcript.coverage_end_epoch,
        coverage_expected_child_count=5,
        coverage_observed_child_count=5,
        coverage_gap_detected=False,
        contact_child=transcript.contact_candle,
        recross_child=transcript.recross_candle,
        destination_seen_before_contact=False,
        ambiguity_codes=(AmbiguityCode.SAME_CHILD_BAR_ORDER,),
        transcript_sha256=canonical_sha256(transcript.to_mapping()),
        full_lifecycle_ordered=True,
        transcript=transcript,
    )

    assert proof.transcript is transcript
    with pytest.raises(ValueError, match="HTF proof fields must agree"):
        replace(proof, trigger_ticks=99)
    with pytest.raises(ValueError, match="HTF proof fields must agree"):
        replace(proof, proof_plane=ProofPlane.CONFIRMED_5M)
    with pytest.raises(ValueError, match="HTF proof fields must agree"):
        replace(proof, transcript_sha256="c" * 64)


def test_candidate_evidence_has_no_model_and_validates_evidence_identity_shape() -> None:
    evidence = EntryCandidateEvidence(
        evidence_id="b" * 64,
        candidate_id="a" * 64,
        observed_trigger_epoch=None,
        observed_trigger_ticks=None,
        htf_context_minutes=(15, 30),
        fidelity=CandidateFidelity.EXACT,
        proof_plane=ProofPlane.CONFIRMED_5M,
        proof_resolution_seconds=300,
        coverage_start_epoch=0,
        coverage_end_epoch=300,
        ambiguity_codes=(),
        passed_rule_ids=("rule-a",),
        failed_rule_ids=(),
        source_claim_ids=("claim-a",),
        payload_sha256="c" * 64,
        observed_at_epoch=300,
    )

    assert not hasattr(evidence, "model")
    with pytest.raises(ValueError, match="observed_trigger epoch and ticks"):
        replace(evidence, observed_trigger_ticks=100)
    with pytest.raises(ValueError, match="htf_context_minutes must be sorted"):
        replace(evidence, htf_context_minutes=(30, 15))


def test_handling_observation_rejects_duplicate_source_claim_ids() -> None:
    with pytest.raises(ValueError, match="source_claim_ids must not contain duplicates"):
        replace(_handling_observation(), source_claim_ids=("claim", "claim"))


def test_selection_rejects_unsorted_or_duplicate_candidate_ids_considered() -> None:
    selection = _selection()

    with pytest.raises(ValueError, match="candidate_ids_considered must be sorted"):
        replace(selection, candidate_ids_considered=("b" * 64, "a" * 64))
    with pytest.raises(ValueError, match="candidate_ids_considered must not contain duplicates"):
        replace(selection, candidate_ids_considered=("a" * 64, "a" * 64))


def test_selection_rejects_exactly_one_null_canonical_id() -> None:
    with pytest.raises(
        ValueError, match="canonical candidate and evidence IDs must both be present or absent"
    ):
        replace(_selection(), canonical_evidence_id=None)


def test_candidate_attempt_ordinal_must_be_positive_for_every_attempt_kind() -> None:
    with pytest.raises(ValueError, match="trigger_ordinal must be positive"):
        EntryCandidate(
            candidate_id="a" * 64,
            setup_id="setup",
            model=EntryModelV2.DIR_CLOSE,
            state=CandidateState.MATCHED,
            event_anchor_epoch=0,
            trigger_ordinal=0,
            direction=EntryDirection.LONG,
            source_claim_ids=(),
            normalized_from=None,
            observed_at_epoch=0,
        )
