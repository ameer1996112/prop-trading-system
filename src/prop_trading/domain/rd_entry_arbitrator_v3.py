"""Chronological one-trade arbitration for the RD three-entry contract."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from prop_trading.domain.rd_entry_models import (
    CandidateFidelity,
    CandidateState,
    ProofPlane,
    SelectionAction,
)
from prop_trading.domain.rd_entry_models_v3 import (
    POLICY_VERSION_V3,
    BocTier,
    EntryCandidateEvidenceV3,
    EntryCandidateV3,
    EntryModelV3,
    EntrySelectionIdentityV3,
    EntrySelectionV3,
    EvidenceReplayability,
    SelectionReason,
    selection_id_v3,
)


def _require_non_negative_int(value: object, name: str) -> None:
    if type(value) is not int:
        raise ValueError(f"{name} must be an integer (bool is not allowed)")
    if value < 0:
        raise ValueError(f"{name} must be non-negative")


@dataclass(frozen=True, slots=True)
class EntryArbitrationRequestV3:
    setup_id: str
    candidates: tuple[EntryCandidateV3, ...]
    evidence: tuple[EntryCandidateEvidenceV3, ...]
    setup_invalidated: bool
    policy_version: Literal["rd-entry-arbitration-v3"]
    revision: int
    evaluated_at_epoch: int
    opened_selection: EntrySelectionV3 | None = None

    def __post_init__(self) -> None:
        if not isinstance(self.setup_id, str) or not self.setup_id.strip():
            raise ValueError("setup_id must be a non-empty string")
        if not isinstance(self.candidates, tuple):
            raise ValueError("candidates must be a tuple")
        if not isinstance(self.evidence, tuple):
            raise ValueError("evidence must be a tuple")
        for candidate in self.candidates:
            if not isinstance(candidate, EntryCandidateV3):
                raise ValueError("candidates must contain EntryCandidateV3")
            if candidate.observed_at_epoch > self.evaluated_at_epoch:
                raise ValueError("candidate cannot be observed after evaluation")
        for item in self.evidence:
            if not isinstance(item, EntryCandidateEvidenceV3):
                raise ValueError("evidence must contain EntryCandidateEvidenceV3")
            if item.observed_at_epoch > self.evaluated_at_epoch:
                raise ValueError("evidence cannot be observed after evaluation")
        if type(self.setup_invalidated) is not bool:
            raise ValueError("setup_invalidated must be a bool")
        if self.policy_version != POLICY_VERSION_V3:
            raise ValueError(f"policy_version must be {POLICY_VERSION_V3}")
        _require_non_negative_int(self.revision, "revision")
        _require_non_negative_int(self.evaluated_at_epoch, "evaluated_at_epoch")
        if self.opened_selection is not None:
            if not isinstance(self.opened_selection, EntrySelectionV3):
                raise ValueError("opened_selection must be EntrySelectionV3 or None")
            if self.opened_selection.setup_id != self.setup_id:
                raise ValueError("opened selection setup_id must match arbitration setup_id")
            if self.opened_selection.action is not SelectionAction.PAPER_ELIGIBLE:
                raise ValueError("opened selection must be paper eligible")


@dataclass(frozen=True, slots=True)
class _EligiblePair:
    candidate: EntryCandidateV3
    evidence: EntryCandidateEvidenceV3


def _event_key(evidence: EntryCandidateEvidenceV3) -> tuple[int, int]:
    if evidence.observed_trigger_epoch is None:
        raise ValueError("eligible evidence requires a trigger epoch")
    return (evidence.observed_trigger_epoch, evidence.trigger_sequence)


def _exact_eligible(
    candidate: EntryCandidateV3,
    evidence: EntryCandidateEvidenceV3,
) -> bool:
    if (
        candidate.state is not CandidateState.MATCHED
        or evidence.fidelity is not CandidateFidelity.EXACT
        or evidence.observed_trigger_epoch is None
        or evidence.ambiguity_codes
    ):
        return False
    if candidate.model is EntryModelV3.BOC and candidate.boc_tier is not BocTier.HTF_TIMED:
        return False
    expected_rule = {
        EntryModelV3.BOC: "ENTRY_BOC_HTF_TIMED",
        EntryModelV3.DIR_CLOSE: "ENTRY_DIR_CLOSE",
        EntryModelV3.HTF_FLIP: "ENTRY_HTF_FLIP",
    }[candidate.model]
    if evidence.passed_rule_ids != (expected_rule,) or evidence.failed_rule_ids:
        return False
    if (
        evidence.boc_tier is not candidate.boc_tier
        or evidence.reference_candle_open_epoch != candidate.reference_candle_open_epoch
    ):
        return False
    if candidate.model is EntryModelV3.BOC:
        assert evidence.reference_candle_open_epoch is not None
        trigger_candle_open_epoch = (evidence.observed_trigger_epoch // 300) * 300
        if (
            evidence.reference_candle_open_epoch + 300 > trigger_candle_open_epoch
            or not evidence.htf_context_minutes
            or any(
                trigger_candle_open_epoch % (context * 60) != 0
                for context in evidence.htf_context_minutes
            )
        ):
            return False
    elif candidate.model is EntryModelV3.DIR_CLOSE:
        if (
            evidence.coverage_end_epoch - evidence.coverage_start_epoch != 300
            or evidence.observed_trigger_epoch != evidence.coverage_end_epoch
        ):
            return False
    else:
        if (
            evidence.htf_open_ticks is None
            or evidence.contact_candle is None
            or evidence.recross_candle is None
            or evidence.coverage_gap_detected is not False
            or evidence.full_lifecycle_ordered is not True
            or evidence.destination_seen_before_contact is not False
        ):
            return False
        recrossed = (
            evidence.recross_candle.high_ticks > evidence.htf_open_ticks
            if candidate.direction.value == "LONG"
            else evidence.recross_candle.low_ticks < evidence.htf_open_ticks
        )
        if not recrossed:
            return False
        contact_already_recrossed = (
            evidence.contact_candle.high_ticks > evidence.htf_open_ticks
            if candidate.direction.value == "LONG"
            else evidence.contact_candle.low_ticks < evidence.htf_open_ticks
        )
        if contact_already_recrossed:
            return False
        if (
            candidate.event_anchor_epoch > evidence.contact_candle.open_epoch
            or not evidence.htf_context_minutes
            or any(
                evidence.observed_trigger_epoch >= candidate.event_anchor_epoch + context * 60
                for context in evidence.htf_context_minutes
            )
        ):
            return False
    if candidate.model is not EntryModelV3.HTF_FLIP and any(
        value is not None
        for value in (
            evidence.htf_open_ticks,
            evidence.contact_candle,
            evidence.recross_candle,
            evidence.coverage_gap_detected,
            evidence.full_lifecycle_ordered,
            evidence.destination_seen_before_contact,
        )
    ):
        return False
    return (
        evidence.proof_plane is ProofPlane.LOWER_TIMEFRAME_REPLAY
        or evidence.proof_plane is ProofPlane.EXTERNAL_ARCHIVED_TICK
        or (
            evidence.proof_plane is ProofPlane.REALTIME_TICK
            and evidence.replayability is EvidenceReplayability.LIVE_EXACT_NON_REPLAYABLE
        )
        or (
            candidate.model is EntryModelV3.DIR_CLOSE
            and evidence.proof_plane is ProofPlane.CONFIRMED_5M
        )
    )


def _unique_candidates(
    request: EntryArbitrationRequestV3,
) -> dict[str, EntryCandidateV3]:
    unique: dict[str, EntryCandidateV3] = {}
    for candidate in request.candidates:
        if candidate.setup_id != request.setup_id:
            raise ValueError("candidate setup_id must match arbitration setup_id")
        previous = unique.get(candidate.candidate_id)
        if previous is not None and previous != candidate:
            raise ValueError(f"candidate identity conflict: {candidate.candidate_id}")
        unique[candidate.candidate_id] = candidate
    return unique


def _unique_evidence(
    values: tuple[EntryCandidateEvidenceV3, ...],
) -> dict[str, EntryCandidateEvidenceV3]:
    unique: dict[str, EntryCandidateEvidenceV3] = {}
    for item in values:
        previous = unique.get(item.evidence_id)
        if previous is not None and previous != item:
            raise ValueError(f"evidence identity conflict: {item.evidence_id}")
        unique[item.evidence_id] = item
    return unique


def _eligible_pairs(
    candidates_by_id: dict[str, EntryCandidateV3],
    evidence_by_id: dict[str, EntryCandidateEvidenceV3],
) -> list[_EligiblePair]:
    grouped: dict[str, list[EntryCandidateEvidenceV3]] = {}
    for evidence in evidence_by_id.values():
        candidate = candidates_by_id.get(evidence.candidate_id)
        if candidate is None:
            raise ValueError(f"evidence references unknown candidate: {evidence.candidate_id}")
        if _exact_eligible(candidate, evidence):
            grouped.setdefault(candidate.candidate_id, []).append(evidence)
    eligible = [
        _EligiblePair(
            candidate=candidates_by_id[candidate_id],
            evidence=min(
                evidence,
                key=lambda item: (*_event_key(item), item.evidence_id),
            ),
        )
        for candidate_id, evidence in grouped.items()
    ]
    eligible.sort(
        key=lambda pair: (
            *_event_key(pair.evidence),
            pair.candidate.candidate_id,
        )
    )
    return eligible


def _selection(
    request: EntryArbitrationRequestV3,
    *,
    candidate_ids_considered: tuple[str, ...],
    canonical: _EligiblePair | None,
    reason: SelectionReason,
    action: SelectionAction,
    co_triggered_models: tuple[EntryModelV3, ...] = (),
) -> EntrySelectionV3:
    identity = EntrySelectionIdentityV3(
        setup_id=request.setup_id,
        policy_version=request.policy_version,
        revision=request.revision,
        candidate_ids_considered=candidate_ids_considered,
        canonical_candidate_id=(
            canonical.candidate.candidate_id if canonical is not None else None
        ),
        canonical_evidence_id=(canonical.evidence.evidence_id if canonical is not None else None),
        reason=reason,
        fidelity=canonical.evidence.fidelity if canonical is not None else None,
        action=action,
        co_triggered_models=co_triggered_models,
    )
    return EntrySelectionV3(
        selection_id=selection_id_v3(identity),
        setup_id=request.setup_id,
        policy_version=request.policy_version,
        revision=request.revision,
        candidate_ids_considered=candidate_ids_considered,
        canonical_candidate_id=identity.canonical_candidate_id,
        canonical_evidence_id=identity.canonical_evidence_id,
        canonical_model=canonical.candidate.model if canonical is not None else None,
        reason=reason,
        fidelity=identity.fidelity,
        action=action,
        co_triggered_models=co_triggered_models,
        evaluated_at_epoch=request.evaluated_at_epoch,
    )


def arbitrate_entry_candidates_v3(
    request: EntryArbitrationRequestV3,
) -> EntrySelectionV3:
    """Choose the earliest exactly proven economic event, once per setup attempt."""
    if request.opened_selection is not None:
        return request.opened_selection

    candidates_by_id = _unique_candidates(request)
    evidence_by_id = _unique_evidence(request.evidence)
    candidate_ids_considered = tuple(sorted(candidates_by_id))
    eligible = _eligible_pairs(candidates_by_id, evidence_by_id)

    if request.setup_invalidated:
        return _selection(
            request,
            candidate_ids_considered=candidate_ids_considered,
            canonical=None,
            reason=SelectionReason.SETUP_INVALIDATED,
            action=SelectionAction.NONE,
        )
    if not candidates_by_id:
        return _selection(
            request,
            candidate_ids_considered=candidate_ids_considered,
            canonical=None,
            reason=SelectionReason.NO_CANDIDATE,
            action=SelectionAction.NONE,
        )
    if not eligible:
        return _selection(
            request,
            candidate_ids_considered=candidate_ids_considered,
            canonical=None,
            reason=SelectionReason.NO_EXACT_CANDIDATE,
            action=SelectionAction.SHADOW_ONLY,
        )

    earliest_event = _event_key(eligible[0].evidence)
    earliest = [pair for pair in eligible if _event_key(pair.evidence) == earliest_event]
    models = {pair.candidate.model for pair in earliest}
    if len(models) > 1:
        trigger_ticks = {pair.evidence.observed_trigger_ticks for pair in earliest}
        if len(trigger_ticks) > 1:
            return _selection(
                request,
                candidate_ids_considered=candidate_ids_considered,
                canonical=None,
                reason=SelectionReason.CO_TRIGGER_PRICE_CONFLICT,
                action=SelectionAction.SHADOW_ONLY,
            )
        canonical = min(earliest, key=lambda pair: pair.candidate.candidate_id)
        return _selection(
            request,
            candidate_ids_considered=candidate_ids_considered,
            canonical=canonical,
            reason=SelectionReason.CO_TRIGGER_SAME_EVENT,
            action=SelectionAction.PAPER_ELIGIBLE,
            co_triggered_models=tuple(sorted(models, key=lambda model: model.value)),
        )

    canonical = earliest[0]
    has_blocked_aggressive_model = any(
        candidate.model in {EntryModelV3.BOC, EntryModelV3.HTF_FLIP}
        and candidate.candidate_id not in {pair.candidate.candidate_id for pair in eligible}
        for candidate in candidates_by_id.values()
    )
    if canonical.candidate.model is EntryModelV3.DIR_CLOSE and has_blocked_aggressive_model:
        reason = SelectionReason.FALLBACK_TO_CONFIRMED_CLOSE
    elif len(candidates_by_id) == 1:
        reason = SelectionReason.ONLY_EXACT_TRIGGER
    else:
        reason = SelectionReason.EARLIEST_EXACT_TRIGGER
    return _selection(
        request,
        candidate_ids_considered=candidate_ids_considered,
        canonical=canonical,
        reason=reason,
        action=SelectionAction.PAPER_ELIGIBLE,
    )
