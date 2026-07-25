from __future__ import annotations

from dataclasses import replace

import pytest

from prop_trading.domain.canonical import canonical_sha256
from prop_trading.domain.rd_entry_arbitrator import (
    EntryArbitrationRequest,
    arbitrate_entry_candidates,
    canonical_exact_evidence_rank,
)
from prop_trading.domain.rd_entry_models import (
    AmbiguityCode,
    CandidateFidelity,
    CandidateState,
    EntryCandidate,
    EntryCandidateEvidence,
    EntryCandidateIdentity,
    EntryDirection,
    EntryEvidenceIdentity,
    EntryModelV2,
    EntrySelectionIdentity,
    ProofPlane,
    SelectionAction,
    SelectionReason,
    candidate_id,
    evidence_id,
    selection_id,
)

SETUP_ID = "setup-1"
POLICY_VERSION = "rd-entry-arbitration-v2"


def _candidate(
    model: EntryModelV2,
    *,
    anchor: int,
    setup_id: str = SETUP_ID,
    state: CandidateState = CandidateState.MATCHED,
    ordinal: int = 1,
) -> EntryCandidate:
    identity = EntryCandidateIdentity(
        setup_id=setup_id,
        model=model,
        direction=EntryDirection.LONG,
        event_anchor_epoch=anchor,
        trigger_ordinal=ordinal,
    )
    return EntryCandidate(
        candidate_id=candidate_id(identity),
        setup_id=setup_id,
        model=model,
        state=state,
        event_anchor_epoch=anchor,
        trigger_ordinal=ordinal,
        direction=EntryDirection.LONG,
        source_claim_ids=("claim",),
        normalized_from=None,
        observed_at_epoch=anchor,
    )


def _evidence(
    candidate: EntryCandidate,
    *,
    trigger: int | None,
    fidelity: CandidateFidelity = CandidateFidelity.EXACT,
    plane: ProofPlane = ProofPlane.LOWER_TIMEFRAME_REPLAY,
    resolution: int = 60,
    contexts: tuple[int, ...] = (15,),
    coverage_end: int = 1_500,
    ambiguity: tuple[AmbiguityCode, ...] = (),
    salt: str = "base",
    forced_evidence_id: str | None = None,
) -> EntryCandidateEvidence:
    payload_sha256 = canonical_sha256({"salt": salt})
    identity = EntryEvidenceIdentity(
        candidate_id=candidate.candidate_id,
        proof_plane=plane,
        proof_resolution_seconds=resolution,
        coverage_start_epoch=900,
        coverage_end_epoch=coverage_end,
        observed_trigger_epoch=trigger,
        payload_sha256=payload_sha256,
    )
    return EntryCandidateEvidence(
        evidence_id=forced_evidence_id or evidence_id(identity),
        candidate_id=candidate.candidate_id,
        observed_trigger_epoch=trigger,
        observed_trigger_ticks=100 if trigger is not None else None,
        htf_context_minutes=contexts,
        fidelity=fidelity,
        proof_plane=plane,
        proof_resolution_seconds=resolution,
        coverage_start_epoch=900,
        coverage_end_epoch=coverage_end,
        ambiguity_codes=ambiguity,
        passed_rule_ids=("ENTRY",),
        failed_rule_ids=(),
        source_claim_ids=("claim",),
        payload_sha256=payload_sha256,
        observed_at_epoch=coverage_end,
    )


def _request(
    candidates: tuple[EntryCandidate, ...] = (),
    evidence: tuple[EntryCandidateEvidence, ...] = (),
    *,
    invalidated: bool = False,
) -> EntryArbitrationRequest:
    return EntryArbitrationRequest(
        setup_id=SETUP_ID,
        setup_invalidated=invalidated,
        policy_version=POLICY_VERSION,
        revision=2,
        candidates=candidates,
        evidence=evidence,
        evaluated_at_epoch=2_000,
    )


def _exact_flip_then_close() -> EntryArbitrationRequest:
    flip = _candidate(EntryModelV2.HTF_FLIP, anchor=1_000)
    close = _candidate(EntryModelV2.DIR_CLOSE, anchor=1_200)
    return _request(
        (flip, close),
        (
            _evidence(flip, trigger=1_120, salt="flip"),
            _evidence(
                close,
                trigger=1_300,
                plane=ProofPlane.CONFIRMED_5M,
                resolution=300,
                salt="close",
            ),
        ),
    )


def _shadow_flip_then_close(
    *,
    flip_trigger: int | None = 1_120,
    plane: ProofPlane = ProofPlane.LOWER_TIMEFRAME_REPLAY,
    ambiguity: tuple[AmbiguityCode, ...] = (AmbiguityCode.SAME_CHILD_BAR_ORDER,),
) -> EntryArbitrationRequest:
    flip = _candidate(
        EntryModelV2.HTF_FLIP,
        anchor=1_000,
        state=CandidateState.BLOCKED,
    )
    close = _candidate(EntryModelV2.DIR_CLOSE, anchor=1_200)
    return _request(
        (flip, close),
        (
            _evidence(
                flip,
                trigger=flip_trigger,
                fidelity=CandidateFidelity.UNRESOLVED,
                plane=plane,
                ambiguity=ambiguity,
                salt="flip-shadow",
            ),
            _evidence(
                close,
                trigger=1_300,
                plane=ProofPlane.CONFIRMED_5M,
                resolution=300,
                salt="close",
            ),
        ),
    )


def test_exact_flip_precedes_later_exact_close() -> None:
    selection = arbitrate_entry_candidates(_exact_flip_then_close())

    assert selection.policy_version == POLICY_VERSION
    assert selection.reason is SelectionReason.EARLIEST_EXACT_TRIGGER
    assert selection.canonical_model is EntryModelV2.HTF_FLIP
    assert selection.fidelity is CandidateFidelity.EXACT
    assert selection.action is SelectionAction.PAPER_ELIGIBLE


def test_shadow_flip_falls_back_to_exact_close() -> None:
    selection = arbitrate_entry_candidates(_shadow_flip_then_close())

    assert selection.reason is SelectionReason.FALLBACK_TO_CONFIRMED_CLOSE
    assert selection.canonical_model is EntryModelV2.DIR_CLOSE
    assert selection.action is SelectionAction.PAPER_ELIGIBLE


def test_earlier_exact_close_is_not_replaced_by_a_later_flip() -> None:
    request = _exact_flip_then_close()
    flip, close = request.candidates
    flip_evidence, close_evidence = request.evidence
    request = replace(
        request,
        evidence=(
            replace(flip_evidence, observed_trigger_epoch=1_400),
            replace(close_evidence, observed_trigger_epoch=1_300),
        ),
    )

    selection = arbitrate_entry_candidates(request)

    assert selection.reason is SelectionReason.EARLIEST_EXACT_TRIGGER
    assert selection.canonical_model is EntryModelV2.DIR_CLOSE
    assert selection.canonical_candidate_id == close.candidate_id
    assert selection.action is SelectionAction.PAPER_ELIGIBLE
    assert flip.model is EntryModelV2.HTF_FLIP


def test_input_order_does_not_change_selection() -> None:
    request = _exact_flip_then_close()
    reversed_request = replace(
        request,
        candidates=tuple(reversed(request.candidates)),
        evidence=tuple(reversed(request.evidence)),
    )

    assert arbitrate_entry_candidates(request) == arbitrate_entry_candidates(reversed_request)


def test_canonical_evidence_rank_uses_every_frozen_tiebreaker() -> None:
    candidate = _candidate(EntryModelV2.HTF_FLIP, anchor=1_000)
    evidence = (
        _evidence(candidate, trigger=1_121, salt="later-trigger"),
        _evidence(candidate, trigger=1_120, resolution=120, salt="coarse"),
        _evidence(candidate, trigger=1_120, contexts=(15,), salt="one-context"),
        _evidence(
            candidate,
            trigger=1_120,
            contexts=(15, 30),
            coverage_end=1_600,
            salt="later-coverage",
        ),
        _evidence(
            candidate,
            trigger=1_120,
            contexts=(15, 30),
            forced_evidence_id="a" * 64,
            salt="winner",
        ),
        _evidence(
            candidate,
            trigger=1_120,
            contexts=(15, 30),
            forced_evidence_id="b" * 64,
            salt="id-tie",
        ),
    )
    request = _request((candidate,), evidence)

    forward = arbitrate_entry_candidates(request)
    reverse = arbitrate_entry_candidates(
        replace(request, evidence=tuple(reversed(request.evidence)))
    )

    assert canonical_exact_evidence_rank(evidence[-2]) == (
        1_120,
        60,
        -2,
        1_500,
        "a" * 64,
    )
    assert forward == reverse
    assert forward.canonical_evidence_id == "a" * 64


def test_canonical_evidence_rank_rejects_a_null_trigger() -> None:
    candidate = _candidate(EntryModelV2.HTF_FLIP, anchor=1_000)

    with pytest.raises(ValueError, match="exact canonical evidence lacks a trigger"):
        canonical_exact_evidence_rank(_evidence(candidate, trigger=None))


@pytest.mark.parametrize("flip_trigger", [1_300, 1_301])
def test_same_time_or_later_nonexact_flip_does_not_make_close_a_fallback(
    flip_trigger: int,
) -> None:
    selection = arbitrate_entry_candidates(_shadow_flip_then_close(flip_trigger=flip_trigger))

    assert selection.canonical_model is EntryModelV2.DIR_CLOSE
    assert selection.reason is SelectionReason.ONLY_EXACT_TRIGGER


def test_realtime_or_null_trigger_flip_does_not_make_close_a_fallback() -> None:
    realtime = arbitrate_entry_candidates(_shadow_flip_then_close(plane=ProofPlane.REALTIME_TICK))
    null_trigger = arbitrate_entry_candidates(_shadow_flip_then_close(flip_trigger=None))

    assert realtime.reason is SelectionReason.ONLY_EXACT_TRIGGER
    assert null_trigger.reason is SelectionReason.ONLY_EXACT_TRIGGER


@pytest.mark.parametrize(
    "ambiguity",
    [
        (AmbiguityCode.SAME_CHILD_BAR_ORDER,),
        (AmbiguityCode.MISSING_INTRABAR_COVERAGE,),
    ],
)
def test_replay_ambiguity_still_supports_close_fallback(
    ambiguity: tuple[AmbiguityCode, ...],
) -> None:
    selection = arbitrate_entry_candidates(_shadow_flip_then_close(ambiguity=ambiguity))

    assert selection.reason is SelectionReason.FALLBACK_TO_CONFIRMED_CLOSE


def test_nonexact_evidence_on_an_exact_flip_candidate_does_not_create_fallback() -> None:
    request = _exact_flip_then_close()
    flip = request.candidates[0]
    request = replace(
        request,
        evidence=(
            _evidence(
                flip,
                trigger=1_050,
                fidelity=CandidateFidelity.UNRESOLVED,
                ambiguity=(AmbiguityCode.SAME_CHILD_BAR_ORDER,),
                salt="shadow",
            ),
            *request.evidence,
        ),
    )

    selection = arbitrate_entry_candidates(request)

    assert selection.reason is SelectionReason.EARLIEST_EXACT_TRIGGER
    assert selection.canonical_model is EntryModelV2.HTF_FLIP


def test_current_unresolved_common_setup_can_never_be_paper_eligible() -> None:
    close = _candidate(EntryModelV2.DIR_CLOSE, anchor=1_200)
    request = _request(
        (close,),
        (
            _evidence(
                close,
                trigger=1_300,
                fidelity=CandidateFidelity.UNRESOLVED,
                plane=ProofPlane.CONFIRMED_5M,
            ),
        ),
    )

    selection = arbitrate_entry_candidates(request)

    assert selection.reason is SelectionReason.NO_EXACT_CANDIDATE
    assert selection.action is SelectionAction.SHADOW_ONLY
    assert selection.canonical_candidate_id is None
    assert selection.canonical_evidence_id is None
    assert selection.fidelity is None


@pytest.mark.parametrize(
    "plane",
    [
        ProofPlane.CONFIRMED_5M,
        ProofPlane.LOWER_TIMEFRAME_REPLAY,
        ProofPlane.EXTERNAL_ARCHIVED_TICK,
    ],
)
def test_only_frozen_replayable_planes_can_be_exact(plane: ProofPlane) -> None:
    close = _candidate(EntryModelV2.DIR_CLOSE, anchor=1_200)
    selection = arbitrate_entry_candidates(
        _request((close,), (_evidence(close, trigger=1_300, plane=plane),))
    )

    assert selection.reason is SelectionReason.ONLY_EXACT_TRIGGER
    assert selection.action is SelectionAction.PAPER_ELIGIBLE


@pytest.mark.parametrize(
    ("changes", "reason"),
    [
        ({"plane": ProofPlane.REALTIME_TICK}, SelectionReason.NO_EXACT_CANDIDATE),
        (
            {"ambiguity": (AmbiguityCode.SAME_CHILD_BAR_ORDER,)},
            SelectionReason.NO_EXACT_CANDIDATE,
        ),
        (
            {"fidelity": CandidateFidelity.CALIBRATED},
            SelectionReason.NO_EXACT_CANDIDATE,
        ),
        ({"trigger": None}, SelectionReason.NO_EXACT_CANDIDATE),
    ],
)
def test_ineligible_proof_never_authorizes_paper(
    changes: dict[str, object],
    reason: SelectionReason,
) -> None:
    close = _candidate(EntryModelV2.DIR_CLOSE, anchor=1_200)
    evidence_args: dict[str, object] = {"trigger": 1_300}
    evidence_args.update(changes)
    evidence = _evidence(close, **evidence_args)  # type: ignore[arg-type]

    selection = arbitrate_entry_candidates(_request((close,), (evidence,)))

    assert selection.reason is reason
    assert selection.action is SelectionAction.SHADOW_ONLY


def test_invalidated_before_first_active_candidate_precedes_all_other_policy() -> None:
    request = replace(_exact_flip_then_close(), setup_invalidated=True)

    selection = arbitrate_entry_candidates(request)

    assert selection.reason is SelectionReason.SETUP_INVALIDATED
    assert selection.action is SelectionAction.NONE
    assert selection.canonical_candidate_id is None
    assert selection.canonical_evidence_id is None
    assert selection.canonical_model is None


def test_later_invalidation_flag_false_cannot_erase_an_existing_candidate() -> None:
    request = _exact_flip_then_close()

    before_terminal = arbitrate_entry_candidates(request)
    after_later_invalidation = arbitrate_entry_candidates(
        replace(request, revision=3, evaluated_at_epoch=2_100, setup_invalidated=False)
    )

    assert after_later_invalidation.canonical_candidate_id == (
        before_terminal.canonical_candidate_id
    )
    assert after_later_invalidation.action is SelectionAction.PAPER_ELIGIBLE


def test_no_active_candidate_returns_none() -> None:
    selection = arbitrate_entry_candidates(_request())

    assert selection.reason is SelectionReason.NO_CANDIDATE
    assert selection.action is SelectionAction.NONE
    assert selection.fidelity is None


def test_equal_time_distinct_active_models_fail_closed() -> None:
    request = _exact_flip_then_close()
    request = replace(
        request,
        evidence=tuple(replace(item, observed_trigger_epoch=1_300) for item in request.evidence),
    )

    selection = arbitrate_entry_candidates(request)

    assert selection.reason is SelectionReason.UNRESOLVED_SOURCE_PRIORITY
    assert selection.action is SelectionAction.SHADOW_ONLY
    assert selection.canonical_candidate_id is None
    assert selection.canonical_evidence_id is None


def test_equal_time_same_model_uses_stable_candidate_id_order() -> None:
    first = _candidate(EntryModelV2.HTF_FLIP, anchor=1_000)
    second = _candidate(EntryModelV2.HTF_FLIP, anchor=1_001)
    request = _request(
        (first, second),
        (
            _evidence(first, trigger=1_120, salt="first"),
            _evidence(second, trigger=1_120, salt="second"),
        ),
    )

    selection = arbitrate_entry_candidates(request)

    assert selection.reason is SelectionReason.EARLIEST_EXACT_TRIGGER
    assert selection.canonical_candidate_id == min(
        first.candidate_id,
        second.candidate_id,
    )


def test_legacy_and_rejected_candidates_are_never_active_or_considered() -> None:
    legacy = _candidate(EntryModelV2.LEGACY_BREAK_CANDLE, anchor=1_000)
    rejected_close = _candidate(
        EntryModelV2.DIR_CLOSE,
        anchor=1_200,
        state=CandidateState.REJECTED,
    )
    selection = arbitrate_entry_candidates(
        _request(
            (legacy, rejected_close),
            (
                _evidence(legacy, trigger=1_100, salt="legacy"),
                _evidence(rejected_close, trigger=1_300, salt="rejected"),
            ),
        )
    )

    assert selection.reason is SelectionReason.NO_CANDIDATE
    assert selection.candidate_ids_considered == ()
    assert selection.canonical_model is None


def test_considered_candidate_ids_are_active_sorted_and_unique() -> None:
    request = _exact_flip_then_close()
    flip, close = request.candidates
    request = replace(request, candidates=(close, flip, close))

    selection = arbitrate_entry_candidates(request)

    assert selection.candidate_ids_considered == tuple(
        sorted({flip.candidate_id, close.candidate_id})
    )


def test_identical_duplicate_evidence_is_idempotent() -> None:
    request = _exact_flip_then_close()
    request = replace(request, evidence=(*request.evidence, request.evidence[0]))

    assert arbitrate_entry_candidates(request) == arbitrate_entry_candidates(
        replace(request, evidence=request.evidence[:-1])
    )


def test_conflicting_candidate_identity_fails_closed() -> None:
    request = _exact_flip_then_close()
    flip = request.candidates[0]
    conflict = replace(flip, model=EntryModelV2.DIR_CLOSE)

    with pytest.raises(ValueError, match="candidate identity conflict"):
        arbitrate_entry_candidates(
            replace(request, candidates=(flip, conflict, request.candidates[1]))
        )


def test_conflicting_evidence_ownership_fails_closed() -> None:
    request = _exact_flip_then_close()
    flip_evidence = request.evidence[0]
    ownership_conflict = replace(
        flip_evidence,
        candidate_id=request.candidates[1].candidate_id,
    )

    with pytest.raises(ValueError, match="evidence identity conflict"):
        arbitrate_entry_candidates(replace(request, evidence=(flip_evidence, ownership_conflict)))


def test_dangling_evidence_fails_closed() -> None:
    request = _exact_flip_then_close()

    with pytest.raises(ValueError, match="unknown candidate"):
        arbitrate_entry_candidates(replace(request, candidates=(request.candidates[0],)))


def test_candidate_setup_must_match_arbitration_setup() -> None:
    other = _candidate(
        EntryModelV2.DIR_CLOSE,
        anchor=1_200,
        setup_id="setup-2",
    )

    with pytest.raises(ValueError, match="candidate setup_id"):
        arbitrate_entry_candidates(_request((other,), (_evidence(other, trigger=1_300),)))


def test_selection_id_uses_the_frozen_task_3_identity() -> None:
    request = _exact_flip_then_close()

    selection = arbitrate_entry_candidates(request)

    assert selection.selection_id == selection_id(
        EntrySelectionIdentity(
            setup_id=selection.setup_id,
            policy_version=selection.policy_version,
            revision=selection.revision,
            candidate_ids_considered=selection.candidate_ids_considered,
            canonical_candidate_id=selection.canonical_candidate_id,
            canonical_evidence_id=selection.canonical_evidence_id,
            reason=selection.reason,
            fidelity=selection.fidelity,
            action=selection.action,
        )
    )
