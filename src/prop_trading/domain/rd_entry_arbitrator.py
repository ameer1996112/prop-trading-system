"""Deterministic canonical arbitration over immutable RD entry evidence."""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from typing import Literal

from prop_trading.domain.rd_entry_models import (
    CandidateFidelity,
    CandidateState,
    EntryCandidate,
    EntryCandidateEvidence,
    EntryModelV2,
    EntrySelection,
    EntrySelectionIdentity,
    ProofPlane,
    SelectionAction,
    SelectionReason,
    selection_id,
)

_POLICY_VERSION = "rd-entry-arbitration-v2"
_ACTIVE_MODELS = frozenset((EntryModelV2.DIR_CLOSE, EntryModelV2.HTF_FLIP))
_EXACT_PROOF_PLANES = frozenset(
    (
        ProofPlane.CONFIRMED_5M,
        ProofPlane.LOWER_TIMEFRAME_REPLAY,
        ProofPlane.EXTERNAL_ARCHIVED_TICK,
    )
)


@dataclass(frozen=True, slots=True)
class EntryArbitrationRequest:
    setup_id: str
    setup_invalidated: bool
    policy_version: Literal["rd-entry-arbitration-v2"]
    revision: int
    candidates: tuple[EntryCandidate, ...]
    evidence: tuple[EntryCandidateEvidence, ...]
    evaluated_at_epoch: int

    def __post_init__(self) -> None:
        if not isinstance(self.setup_id, str) or not self.setup_id.strip():
            raise ValueError("setup_id must be a non-empty string")
        if type(self.setup_invalidated) is not bool:
            raise ValueError("setup_invalidated must be a bool")
        if self.policy_version != _POLICY_VERSION:
            raise ValueError(f"policy_version must be {_POLICY_VERSION}")
        _require_non_negative_int(self.revision, "revision")
        if not isinstance(self.candidates, tuple):
            raise ValueError("candidates must be a tuple")
        if not all(isinstance(item, EntryCandidate) for item in self.candidates):
            raise ValueError("candidates must contain EntryCandidate values")
        if not isinstance(self.evidence, tuple):
            raise ValueError("evidence must be a tuple")
        if not all(isinstance(item, EntryCandidateEvidence) for item in self.evidence):
            raise ValueError("evidence must contain EntryCandidateEvidence values")
        _require_non_negative_int(self.evaluated_at_epoch, "evaluated_at_epoch")


def _require_non_negative_int(value: object, name: str) -> None:
    if type(value) is not int:
        raise ValueError(f"{name} must be an integer (bool is not allowed)")
    if value < 0:
        raise ValueError(f"{name} must be non-negative")


def canonical_exact_evidence_rank(
    evidence: EntryCandidateEvidence,
) -> tuple[int, int, int, int, str]:
    """Return the frozen total order for one candidate's exact proof records."""
    if evidence.observed_trigger_epoch is None:
        raise ValueError("exact canonical evidence lacks a trigger")
    return (
        evidence.observed_trigger_epoch,
        evidence.proof_resolution_seconds,
        -len(evidence.htf_context_minutes),
        evidence.coverage_end_epoch,
        evidence.evidence_id,
    )


def arbitrate_entry_candidates(request: EntryArbitrationRequest) -> EntrySelection:
    """Select one canonical exact trigger, or fail closed without one."""
    candidates_by_id = _unique_candidates(request)
    evidence_by_id = _unique_evidence(request.evidence)
    _validate_evidence_ownership(candidates_by_id, evidence_by_id)

    active = tuple(
        candidate
        for candidate in candidates_by_id.values()
        if candidate.model in _ACTIVE_MODELS and candidate.state is not CandidateState.REJECTED
    )
    candidate_ids_considered = tuple(sorted(candidate.candidate_id for candidate in active))
    canonical_evidence_by_candidate = _canonical_exact_evidence(
        active,
        evidence_by_id.values(),
    )
    exact = sorted(
        (
            candidate
            for candidate in active
            if candidate.candidate_id in canonical_evidence_by_candidate
        ),
        key=lambda candidate: _exact_candidate_rank(
            candidate,
            canonical_evidence_by_candidate[candidate.candidate_id],
        ),
    )
    nonexact_trigger_by_candidate = _earliest_nonexact_trigger(evidence_by_id.values())

    candidate: EntryCandidate | None = None
    evidence: EntryCandidateEvidence | None = None
    action: SelectionAction
    reason: SelectionReason

    if request.setup_invalidated:
        action = SelectionAction.NONE
        reason = SelectionReason.SETUP_INVALIDATED
    elif not active:
        action = SelectionAction.NONE
        reason = SelectionReason.NO_CANDIDATE
    elif not exact:
        action = SelectionAction.SHADOW_ONLY
        reason = SelectionReason.NO_EXACT_CANDIDATE
    else:
        exact_close = next(
            (item for item in exact if item.model is EntryModelV2.DIR_CLOSE),
            None,
        )
        if exact_close is not None and _has_earlier_nonexact_flip(
            exact_close,
            active,
            canonical_evidence_by_candidate,
            nonexact_trigger_by_candidate,
        ):
            candidate = exact_close
            evidence = canonical_evidence_by_candidate[exact_close.candidate_id]
            action = SelectionAction.PAPER_ELIGIBLE
            reason = SelectionReason.FALLBACK_TO_CONFIRMED_CLOSE
        elif len(exact) == 1:
            candidate = exact[0]
            evidence = canonical_evidence_by_candidate[candidate.candidate_id]
            action = SelectionAction.PAPER_ELIGIBLE
            reason = SelectionReason.ONLY_EXACT_TRIGGER
        elif _earliest_exact_models_are_ambiguous(
            exact,
            canonical_evidence_by_candidate,
        ):
            action = SelectionAction.SHADOW_ONLY
            reason = SelectionReason.UNRESOLVED_SOURCE_PRIORITY
        else:
            candidate = exact[0]
            evidence = canonical_evidence_by_candidate[candidate.candidate_id]
            action = SelectionAction.PAPER_ELIGIBLE
            reason = SelectionReason.EARLIEST_EXACT_TRIGGER

    identity = EntrySelectionIdentity(
        setup_id=request.setup_id,
        policy_version=request.policy_version,
        revision=request.revision,
        candidate_ids_considered=candidate_ids_considered,
        canonical_candidate_id=(candidate.candidate_id if candidate is not None else None),
        canonical_evidence_id=(evidence.evidence_id if evidence is not None else None),
        reason=reason,
        fidelity=evidence.fidelity if evidence is not None else None,
        action=action,
    )
    return EntrySelection(
        selection_id=selection_id(identity),
        setup_id=request.setup_id,
        policy_version=request.policy_version,
        revision=request.revision,
        candidate_ids_considered=candidate_ids_considered,
        canonical_candidate_id=identity.canonical_candidate_id,
        canonical_evidence_id=identity.canonical_evidence_id,
        canonical_model=candidate.model if candidate is not None else None,
        reason=reason,
        fidelity=identity.fidelity,
        action=action,
        evaluated_at_epoch=request.evaluated_at_epoch,
    )


def _unique_candidates(
    request: EntryArbitrationRequest,
) -> dict[str, EntryCandidate]:
    unique: dict[str, EntryCandidate] = {}
    for candidate in request.candidates:
        if candidate.setup_id != request.setup_id:
            raise ValueError("candidate setup_id must match arbitration setup_id")
        previous = unique.get(candidate.candidate_id)
        if previous is not None and previous != candidate:
            raise ValueError(f"candidate identity conflict: {candidate.candidate_id}")
        unique[candidate.candidate_id] = candidate
    return unique


def _unique_evidence(
    evidence: tuple[EntryCandidateEvidence, ...],
) -> dict[str, EntryCandidateEvidence]:
    unique: dict[str, EntryCandidateEvidence] = {}
    for item in evidence:
        previous = unique.get(item.evidence_id)
        if previous is not None and previous != item:
            raise ValueError(f"evidence identity conflict: {item.evidence_id}")
        unique[item.evidence_id] = item
    return unique


def _validate_evidence_ownership(
    candidates_by_id: dict[str, EntryCandidate],
    evidence_by_id: dict[str, EntryCandidateEvidence],
) -> None:
    for item in evidence_by_id.values():
        if item.candidate_id not in candidates_by_id:
            raise ValueError(f"evidence references unknown candidate: {item.candidate_id}")


def _canonical_exact_evidence(
    active: tuple[EntryCandidate, ...],
    evidence: Iterable[EntryCandidateEvidence],
) -> dict[str, EntryCandidateEvidence]:
    active_ids = {candidate.candidate_id for candidate in active}
    grouped: dict[str, list[EntryCandidateEvidence]] = {}
    for item in evidence:
        if item.candidate_id in active_ids and _is_exact_eligible(item):
            grouped.setdefault(item.candidate_id, []).append(item)
    return {
        candidate_id: min(items, key=canonical_exact_evidence_rank)
        for candidate_id, items in grouped.items()
    }


def _is_exact_eligible(evidence: EntryCandidateEvidence) -> bool:
    return (
        evidence.fidelity is CandidateFidelity.EXACT
        and evidence.proof_plane in _EXACT_PROOF_PLANES
        and evidence.observed_trigger_epoch is not None
        and not evidence.ambiguity_codes
    )


def _exact_candidate_rank(
    candidate: EntryCandidate,
    evidence: EntryCandidateEvidence,
) -> tuple[int, str, str]:
    if evidence.observed_trigger_epoch is None:
        raise ValueError("exact canonical evidence lacks a trigger")
    return (
        evidence.observed_trigger_epoch,
        candidate.model.value,
        candidate.candidate_id,
    )


def _earliest_nonexact_trigger(
    evidence: Iterable[EntryCandidateEvidence],
) -> dict[str, int]:
    earliest: dict[str, int] = {}
    for item in evidence:
        if (
            item.proof_plane is ProofPlane.REALTIME_TICK
            or item.observed_trigger_epoch is None
            or _is_exact_eligible(item)
        ):
            continue
        previous = earliest.get(item.candidate_id)
        if previous is None or item.observed_trigger_epoch < previous:
            earliest[item.candidate_id] = item.observed_trigger_epoch
    return earliest


def _has_earlier_nonexact_flip(
    exact_close: EntryCandidate,
    active: tuple[EntryCandidate, ...],
    exact_evidence: dict[str, EntryCandidateEvidence],
    nonexact_trigger: dict[str, int],
) -> bool:
    close_evidence = exact_evidence[exact_close.candidate_id]
    close_trigger = close_evidence.observed_trigger_epoch
    if close_trigger is None:
        raise ValueError("exact canonical evidence lacks a trigger")
    return any(
        candidate.model is EntryModelV2.HTF_FLIP
        and candidate.candidate_id not in exact_evidence
        and (trigger := nonexact_trigger.get(candidate.candidate_id)) is not None
        and trigger < close_trigger
        for candidate in active
    )


def _earliest_exact_models_are_ambiguous(
    exact: list[EntryCandidate],
    evidence: dict[str, EntryCandidateEvidence],
) -> bool:
    first_trigger = evidence[exact[0].candidate_id].observed_trigger_epoch
    if first_trigger is None:
        raise ValueError("exact canonical evidence lacks a trigger")
    earliest_models = {
        candidate.model
        for candidate in exact
        if evidence[candidate.candidate_id].observed_trigger_epoch == first_trigger
    }
    return len(earliest_models) > 1
