"""Immutable RD entry fill-method and approved-profile value objects."""

from __future__ import annotations

import re
from dataclasses import dataclass
from enum import StrEnum

from prop_trading.domain.canonical import canonical_sha256
from prop_trading.domain.rd_entry_models import (
    CandidateFidelity,
    CandidateState,
    EntryCandidate,
    EntryCandidateEvidence,
    EntryCandidateIdentity,
    EntryDirection,
    EntryEvidenceIdentity,
    EntryModelV2,
    EntrySelection,
    EntrySelectionIdentity,
    ProofPlane,
    SelectionAction,
    candidate_id,
    evidence_id,
    evidence_payload_sha256,
    selection_id,
)


class EntryMethod(StrEnum):
    INTRABAR_FLIP = "INTRABAR_FLIP"
    CLOSE_CONFIRMATION = "CLOSE_CONFIRMATION"
    NEXT_CANDLE_WICK = "NEXT_CANDLE_WICK"


class DirectionalCloseMethod(StrEnum):
    CLOSE_CONFIRMATION = "CLOSE_CONFIRMATION"
    NEXT_CANDLE_WICK = "NEXT_CANDLE_WICK"


class EntryMethodAction(StrEnum):
    PAPER_ELIGIBLE = "PAPER_ELIGIBLE"
    PENDING_WICK = "PENDING_WICK"
    SHADOW_ONLY = "SHADOW_ONLY"
    MISSED = "MISSED"
    NONE = "NONE"


class EntryMethodReason(StrEnum):
    HTF_FLIP_SELECTED = "HTF_FLIP_SELECTED"
    DEFAULT_PROMPT_CLOSE = "DEFAULT_PROMPT_CLOSE"
    PROFILE_PROMPT_CLOSE = "PROFILE_PROMPT_CLOSE"
    PROFILE_WICK_PENDING = "PROFILE_WICK_PENDING"
    WICK_REPLAY_FILLED = "WICK_REPLAY_FILLED"
    MISSED_WICK_FILL = "MISSED_WICK_FILL"
    CONFLICTING_FILL_PROFILES = "CONFLICTING_FILL_PROFILES"
    INCOMPLETE_WICK_REPLAY = "INCOMPLETE_WICK_REPLAY"
    CANDIDATE_NOT_PAPER_ELIGIBLE = "CANDIDATE_NOT_PAPER_ELIGIBLE"
    NO_CANONICAL_CANDIDATE = "NO_CANONICAL_CANDIDATE"


_SHA256 = re.compile(r"^[0-9a-f]{64}$")
_PAPER_PROOF_PLANES = frozenset(
    (
        ProofPlane.CONFIRMED_5M,
        ProofPlane.LOWER_TIMEFRAME_REPLAY,
        ProofPlane.EXTERNAL_ARCHIVED_TICK,
    )
)


def _require_nonempty_text(value: object, name: str) -> None:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{name} must be a non-empty string")


def _require_int(value: object, name: str, *, minimum: int | None = None) -> None:
    if type(value) is not int:
        raise ValueError(f"{name} must be an integer (bool is not allowed)")
    if minimum is not None and value < minimum:
        raise ValueError(f"{name} must be at least {minimum}")


@dataclass(frozen=True, slots=True)
class RDEntryFillProfileV1:
    profile_id: str
    version: int
    feed_id: str
    symbol: str
    session_start_minute_utc: int
    session_end_minute_utc: int
    dir_close_method: DirectionalCloseMethod
    limit_offset_ticks: int | None
    max_wait_seconds: int
    evidence_manifest_sha256: str
    status: str
    approved_by: str
    approved_at_epoch: int

    def __post_init__(self) -> None:
        _require_nonempty_text(self.profile_id, "profile_id")
        _require_int(self.version, "version", minimum=1)
        _require_nonempty_text(self.feed_id, "feed_id")
        _require_nonempty_text(self.symbol, "symbol")
        _require_int(self.session_start_minute_utc, "session_start_minute_utc", minimum=0)
        _require_int(self.session_end_minute_utc, "session_end_minute_utc", minimum=0)
        if self.session_start_minute_utc > 1439:
            raise ValueError("session_start_minute_utc must be at most 1439")
        if self.session_end_minute_utc > 1439:
            raise ValueError("session_end_minute_utc must be at most 1439")
        if self.session_start_minute_utc == self.session_end_minute_utc:
            raise ValueError("session start and end must differ")
        if not isinstance(self.dir_close_method, DirectionalCloseMethod):
            raise ValueError("dir_close_method must be a DirectionalCloseMethod")
        _require_int(self.max_wait_seconds, "max_wait_seconds")
        if self.max_wait_seconds != 300:
            raise ValueError("max_wait_seconds must equal 300")
        if self.status != "APPROVED":
            raise ValueError("status must be exactly APPROVED")
        _require_nonempty_text(self.approved_by, "approved_by")
        _require_int(self.approved_at_epoch, "approved_at_epoch", minimum=0)
        if (
            not isinstance(self.evidence_manifest_sha256, str)
            or _SHA256.fullmatch(self.evidence_manifest_sha256) is None
            or self.evidence_manifest_sha256 == "0" * 64
        ):
            raise ValueError(
                "evidence_manifest_sha256 must be a nonzero lowercase SHA-256 hex digest"
            )
        if self.dir_close_method is DirectionalCloseMethod.NEXT_CANDLE_WICK:
            _require_int(self.limit_offset_ticks, "limit_offset_ticks", minimum=1)
        elif self.limit_offset_ticks is not None:
            raise ValueError("limit_offset_ticks must be None for close profiles")


def utc_minute_in_window(minute: int, *, start: int, end: int) -> bool:
    if start < end:
        return start <= minute < end
    return minute >= start or minute < end


@dataclass(frozen=True, slots=True)
class EntryMethodContext:
    feed_id: str
    symbol: str
    evaluated_at_epoch: int
    trigger_epoch: int
    trigger_ticks: int
    direction: EntryDirection

    def __post_init__(self) -> None:
        _require_nonempty_text(self.feed_id, "feed_id")
        _require_nonempty_text(self.symbol, "symbol")
        _require_int(self.evaluated_at_epoch, "evaluated_at_epoch", minimum=0)
        _require_int(self.trigger_epoch, "trigger_epoch", minimum=0)
        _require_int(self.trigger_ticks, "trigger_ticks")
        if not isinstance(self.direction, EntryDirection):
            raise ValueError("direction must be an EntryDirection")


@dataclass(frozen=True, slots=True)
class EntryMethodDecision:
    decision_id: str
    selection_id: str
    setup_id: str
    candidate_id: str | None
    method: EntryMethod | None
    action: EntryMethodAction
    reason: EntryMethodReason
    profile_id: str | None
    trigger_epoch: int | None
    trigger_ticks: int | None
    limit_ticks: int | None
    wait_until_epoch: int | None
    fill_epoch: int | None
    fill_ticks: int | None
    evaluated_at_epoch: int

    def __post_init__(self) -> None:
        _require_sha256(self.decision_id, "decision_id")
        _require_sha256(self.selection_id, "selection_id")
        _require_nonempty_text(self.setup_id, "setup_id")
        if self.candidate_id is not None:
            _require_sha256(self.candidate_id, "candidate_id")
        if self.method is not None and not isinstance(self.method, EntryMethod):
            raise ValueError("method must be an EntryMethod or None")
        if not isinstance(self.action, EntryMethodAction):
            raise ValueError("action must be an EntryMethodAction")
        if not isinstance(self.reason, EntryMethodReason):
            raise ValueError("reason must be an EntryMethodReason")
        if self.profile_id is not None:
            _require_nonempty_text(self.profile_id, "profile_id")
        for name, value in (
            ("trigger_epoch", self.trigger_epoch),
            ("trigger_ticks", self.trigger_ticks),
            ("limit_ticks", self.limit_ticks),
            ("wait_until_epoch", self.wait_until_epoch),
            ("fill_epoch", self.fill_epoch),
            ("fill_ticks", self.fill_ticks),
        ):
            if value is not None:
                _require_int(value, name, minimum=0 if name.endswith("epoch") else None)
        _require_int(self.evaluated_at_epoch, "evaluated_at_epoch", minimum=0)


@dataclass(frozen=True, slots=True)
class WickReplayEvidence:
    proof_plane: ProofPlane
    coverage_start_epoch: int
    coverage_end_epoch: int
    coverage_complete: bool
    session_gap: bool
    touched_epoch: int | None
    observed_low_ticks: int
    observed_high_ticks: int

    def __post_init__(self) -> None:
        if not isinstance(self.proof_plane, ProofPlane) or self.proof_plane not in {
            ProofPlane.LOWER_TIMEFRAME_REPLAY,
            ProofPlane.EXTERNAL_ARCHIVED_TICK,
            ProofPlane.REALTIME_TICK,
        }:
            raise ValueError("proof_plane is not valid wick replay evidence")
        _require_int(self.coverage_start_epoch, "coverage_start_epoch", minimum=0)
        _require_int(self.coverage_end_epoch, "coverage_end_epoch", minimum=0)
        if self.coverage_end_epoch <= self.coverage_start_epoch:
            raise ValueError("wick replay coverage epochs must increase")
        if type(self.coverage_complete) is not bool:
            raise ValueError("coverage_complete must be a boolean")
        if type(self.session_gap) is not bool:
            raise ValueError("session_gap must be a boolean")
        if self.touched_epoch is not None:
            _require_int(self.touched_epoch, "touched_epoch", minimum=0)
            if not (self.coverage_start_epoch <= self.touched_epoch < self.coverage_end_epoch):
                raise ValueError("touched_epoch must lie inside replay coverage")
        _require_int(self.observed_low_ticks, "observed_low_ticks")
        _require_int(self.observed_high_ticks, "observed_high_ticks")
        if self.observed_low_ticks > self.observed_high_ticks:
            raise ValueError("observed low ticks must not exceed observed high ticks")


def _require_sha256(value: object, name: str) -> None:
    if not isinstance(value, str) or _SHA256.fullmatch(value) is None or value == "0" * 64:
        raise ValueError(f"{name} must be a nonzero lowercase SHA-256 hex digest")


def entry_method_decision_id(
    *,
    selection_id: str,
    setup_id: str,
    candidate_id: str | None,
    method: EntryMethod | None,
    action: EntryMethodAction,
    reason: EntryMethodReason,
    profile_id: str | None,
    trigger_epoch: int | None,
    trigger_ticks: int | None,
    limit_ticks: int | None,
    wait_until_epoch: int | None,
    fill_epoch: int | None,
    fill_ticks: int | None,
    evaluated_at_epoch: int,
) -> str:
    """Return the stable identity of one post-arbitration method decision."""
    return canonical_sha256(
        {
            "action": action.value,
            "candidate_id": candidate_id,
            "evaluated_at_epoch": evaluated_at_epoch,
            "fill_epoch": fill_epoch,
            "fill_ticks": fill_ticks,
            "limit_ticks": limit_ticks,
            "method": method.value if method is not None else None,
            "profile_id": profile_id,
            "reason": reason.value,
            "selection_id": selection_id,
            "setup_id": setup_id,
            "trigger_epoch": trigger_epoch,
            "trigger_ticks": trigger_ticks,
            "wait_until_epoch": wait_until_epoch,
        }
    )


def _decision(
    *,
    selection: EntrySelection,
    candidate_id: str | None,
    method: EntryMethod | None,
    action: EntryMethodAction,
    reason: EntryMethodReason,
    profile_id: str | None,
    trigger_epoch: int | None,
    trigger_ticks: int | None,
    limit_ticks: int | None,
    wait_until_epoch: int | None,
    fill_epoch: int | None,
    fill_ticks: int | None,
    evaluated_at_epoch: int,
) -> EntryMethodDecision:
    return EntryMethodDecision(
        decision_id=entry_method_decision_id(
            selection_id=selection.selection_id,
            setup_id=selection.setup_id,
            candidate_id=candidate_id,
            method=method,
            action=action,
            reason=reason,
            profile_id=profile_id,
            trigger_epoch=trigger_epoch,
            trigger_ticks=trigger_ticks,
            limit_ticks=limit_ticks,
            wait_until_epoch=wait_until_epoch,
            fill_epoch=fill_epoch,
            fill_ticks=fill_ticks,
            evaluated_at_epoch=evaluated_at_epoch,
        ),
        selection_id=selection.selection_id,
        setup_id=selection.setup_id,
        candidate_id=candidate_id,
        method=method,
        action=action,
        reason=reason,
        profile_id=profile_id,
        trigger_epoch=trigger_epoch,
        trigger_ticks=trigger_ticks,
        limit_ticks=limit_ticks,
        wait_until_epoch=wait_until_epoch,
        fill_epoch=fill_epoch,
        fill_ticks=fill_ticks,
        evaluated_at_epoch=evaluated_at_epoch,
    )


def _validate_decision_identity(decision: EntryMethodDecision) -> None:
    authoritative_id = entry_method_decision_id(
        selection_id=decision.selection_id,
        setup_id=decision.setup_id,
        candidate_id=decision.candidate_id,
        method=decision.method,
        action=decision.action,
        reason=decision.reason,
        profile_id=decision.profile_id,
        trigger_epoch=decision.trigger_epoch,
        trigger_ticks=decision.trigger_ticks,
        limit_ticks=decision.limit_ticks,
        wait_until_epoch=decision.wait_until_epoch,
        fill_epoch=decision.fill_epoch,
        fill_ticks=decision.fill_ticks,
        evaluated_at_epoch=decision.evaluated_at_epoch,
    )
    if decision.decision_id != authoritative_id:
        raise ValueError("decision_id conflicts with its canonical identity")


def _resolved_wick_decision(
    pending: EntryMethodDecision,
    *,
    action: EntryMethodAction,
    reason: EntryMethodReason,
    fill_epoch: int | None,
    fill_ticks: int | None,
) -> EntryMethodDecision:
    return EntryMethodDecision(
        decision_id=entry_method_decision_id(
            selection_id=pending.selection_id,
            setup_id=pending.setup_id,
            candidate_id=pending.candidate_id,
            method=pending.method,
            action=action,
            reason=reason,
            profile_id=pending.profile_id,
            trigger_epoch=pending.trigger_epoch,
            trigger_ticks=pending.trigger_ticks,
            limit_ticks=pending.limit_ticks,
            wait_until_epoch=pending.wait_until_epoch,
            fill_epoch=fill_epoch,
            fill_ticks=fill_ticks,
            evaluated_at_epoch=pending.evaluated_at_epoch,
        ),
        selection_id=pending.selection_id,
        setup_id=pending.setup_id,
        candidate_id=pending.candidate_id,
        method=pending.method,
        action=action,
        reason=reason,
        profile_id=pending.profile_id,
        trigger_epoch=pending.trigger_epoch,
        trigger_ticks=pending.trigger_ticks,
        limit_ticks=pending.limit_ticks,
        wait_until_epoch=pending.wait_until_epoch,
        fill_epoch=fill_epoch,
        fill_ticks=fill_ticks,
        evaluated_at_epoch=pending.evaluated_at_epoch,
    )


def resolve_wick_fill(
    pending: EntryMethodDecision,
    evidence: WickReplayEvidence,
) -> EntryMethodDecision:
    """Resolve one frozen pending wick from immutable five-minute replay coverage."""
    if not isinstance(pending, EntryMethodDecision):
        raise ValueError("pending must be an EntryMethodDecision")
    if not isinstance(evidence, WickReplayEvidence):
        raise ValueError("evidence must be WickReplayEvidence")
    if (
        pending.method is not EntryMethod.NEXT_CANDLE_WICK
        or pending.action is not EntryMethodAction.PENDING_WICK
        or pending.reason is not EntryMethodReason.PROFILE_WICK_PENDING
        or pending.candidate_id is None
        or pending.profile_id is None
        or pending.trigger_epoch is None
        or pending.trigger_ticks is None
        or pending.limit_ticks is None
        or pending.wait_until_epoch is None
        or pending.fill_epoch is not None
        or pending.fill_ticks is not None
        or pending.wait_until_epoch - pending.trigger_epoch != 300
        or pending.limit_ticks == pending.trigger_ticks
    ):
        raise ValueError("decision must be one unresolved pending wick")
    _validate_decision_identity(pending)

    exact_coverage = (
        evidence.coverage_start_epoch == pending.trigger_epoch
        and evidence.coverage_end_epoch == pending.wait_until_epoch
        and evidence.coverage_end_epoch - evidence.coverage_start_epoch == 300
    )
    replayable = evidence.proof_plane in {
        ProofPlane.LOWER_TIMEFRAME_REPLAY,
        ProofPlane.EXTERNAL_ARCHIVED_TICK,
    }
    if (
        not replayable
        or not exact_coverage
        or not evidence.coverage_complete
        or evidence.session_gap
    ):
        return _resolved_wick_decision(
            pending,
            action=EntryMethodAction.SHADOW_ONLY,
            reason=EntryMethodReason.INCOMPLETE_WICK_REPLAY,
            fill_epoch=None,
            fill_ticks=None,
        )

    is_long = pending.limit_ticks < pending.trigger_ticks
    touched = (
        evidence.observed_low_ticks <= pending.limit_ticks
        if is_long
        else evidence.observed_high_ticks >= pending.limit_ticks
    )
    if touched:
        if evidence.touched_epoch is None:
            raise ValueError("touched_epoch is required for a replay-confirmed fill")
        return _resolved_wick_decision(
            pending,
            action=EntryMethodAction.PAPER_ELIGIBLE,
            reason=EntryMethodReason.WICK_REPLAY_FILLED,
            fill_epoch=evidence.touched_epoch,
            fill_ticks=pending.limit_ticks,
        )
    if evidence.touched_epoch is not None:
        raise ValueError("touched_epoch cannot claim a limit touch outside observed prices")
    return _resolved_wick_decision(
        pending,
        action=EntryMethodAction.MISSED,
        reason=EntryMethodReason.MISSED_WICK_FILL,
        fill_epoch=None,
        fill_ticks=None,
    )


def _matching_profiles(
    *,
    context: EntryMethodContext,
    profiles: tuple[RDEntryFillProfileV1, ...],
) -> tuple[RDEntryFillProfileV1, ...]:
    utc_minute = (context.trigger_epoch // 60) % 1_440
    return tuple(
        profile
        for profile in profiles
        if profile.feed_id == context.feed_id
        and profile.symbol == context.symbol
        and utc_minute_in_window(
            utc_minute,
            start=profile.session_start_minute_utc,
            end=profile.session_end_minute_utc,
        )
    )


def _validate_selection_identity(selection: EntrySelection) -> None:
    authoritative_id = selection_id(
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
    if selection.selection_id != authoritative_id:
        raise ValueError("selection_id conflicts with its canonical identity")


def _validate_authoritative_candidate(
    *,
    selection: EntrySelection,
    candidate: EntryCandidate,
) -> None:
    authoritative_id = candidate_id(
        EntryCandidateIdentity(
            setup_id=candidate.setup_id,
            model=candidate.model,
            direction=candidate.direction,
            event_anchor_epoch=candidate.event_anchor_epoch,
            trigger_ordinal=candidate.trigger_ordinal,
        )
    )
    if candidate.candidate_id != authoritative_id:
        raise ValueError("candidate_id conflicts with its canonical identity")
    if candidate.state not in {CandidateState.MATCHED, CandidateState.NORMALIZED}:
        raise ValueError("canonical candidate must remain matched or normalized")
    if candidate.observed_at_epoch > selection.evaluated_at_epoch:
        raise ValueError("canonical candidate observation exceeds selection evaluation")
    if (
        candidate.candidate_id != selection.canonical_candidate_id
        or candidate.candidate_id not in selection.candidate_ids_considered
        or candidate.setup_id != selection.setup_id
        or candidate.model is not selection.canonical_model
    ):
        raise ValueError("candidate must agree with the canonical selection")


def _validate_authoritative_evidence(
    *,
    selection: EntrySelection,
    candidate: EntryCandidate,
    evidence: EntryCandidateEvidence | None,
    context: EntryMethodContext,
) -> None:
    if evidence is None:
        raise ValueError("canonical evidence is required for a canonical candidate")
    if evidence.candidate_id != candidate.candidate_id:
        raise ValueError("canonical evidence must belong to the canonical candidate")
    if evidence.evidence_id != selection.canonical_evidence_id:
        raise ValueError("canonical evidence must match the selection")
    payload_sha256 = evidence_payload_sha256(
        candidate_id=evidence.candidate_id,
        observed_trigger_epoch=evidence.observed_trigger_epoch,
        observed_trigger_ticks=evidence.observed_trigger_ticks,
        htf_context_minutes=evidence.htf_context_minutes,
        fidelity=evidence.fidelity,
        proof_plane=evidence.proof_plane,
        proof_resolution_seconds=evidence.proof_resolution_seconds,
        coverage_start_epoch=evidence.coverage_start_epoch,
        coverage_end_epoch=evidence.coverage_end_epoch,
        ambiguity_codes=evidence.ambiguity_codes,
        passed_rule_ids=evidence.passed_rule_ids,
        failed_rule_ids=evidence.failed_rule_ids,
        source_claim_ids=evidence.source_claim_ids,
    )
    if evidence.payload_sha256 != payload_sha256:
        raise ValueError("canonical evidence payload conflicts with its identity")
    authoritative_id = evidence_id(
        EntryEvidenceIdentity(
            candidate_id=evidence.candidate_id,
            proof_plane=evidence.proof_plane,
            proof_resolution_seconds=evidence.proof_resolution_seconds,
            coverage_start_epoch=evidence.coverage_start_epoch,
            coverage_end_epoch=evidence.coverage_end_epoch,
            observed_trigger_epoch=evidence.observed_trigger_epoch,
            payload_sha256=evidence.payload_sha256,
        )
    )
    if evidence.evidence_id != authoritative_id:
        raise ValueError("canonical evidence ID conflicts with its identity")
    if (
        selection.fidelity is not evidence.fidelity
        or evidence.fidelity is not CandidateFidelity.EXACT
        or evidence.proof_plane not in _PAPER_PROOF_PLANES
        or evidence.observed_trigger_epoch is None
        or evidence.observed_trigger_ticks is None
        or evidence.ambiguity_codes
    ):
        raise ValueError("canonical evidence is not paper eligible")
    if not (
        evidence.coverage_start_epoch
        <= evidence.observed_trigger_epoch
        <= evidence.coverage_end_epoch
        <= evidence.observed_at_epoch
        <= selection.evaluated_at_epoch
    ):
        raise ValueError("canonical evidence timing exceeds selection evaluation")
    if (
        context.evaluated_at_epoch != selection.evaluated_at_epoch
        or context.trigger_epoch != evidence.observed_trigger_epoch
        or context.trigger_ticks != evidence.observed_trigger_ticks
        or context.trigger_epoch > context.evaluated_at_epoch
    ):
        raise ValueError("context trigger and evaluation must match canonical evidence")


def resolve_entry_method(
    *,
    selection: EntrySelection,
    candidate: EntryCandidate | None,
    evidence: EntryCandidateEvidence | None,
    context: EntryMethodContext,
    profiles: tuple[RDEntryFillProfileV1, ...],
) -> EntryMethodDecision:
    """Resolve exactly one fill method only after canonical candidate arbitration."""
    if not isinstance(selection, EntrySelection):
        raise ValueError("selection must be an EntrySelection")
    if not isinstance(context, EntryMethodContext):
        raise ValueError("context must be an EntryMethodContext")
    if evidence is not None and not isinstance(evidence, EntryCandidateEvidence):
        raise ValueError("evidence must be an EntryCandidateEvidence or None")
    if not isinstance(profiles, tuple) or not all(
        isinstance(profile, RDEntryFillProfileV1) for profile in profiles
    ):
        raise ValueError("profiles must be a tuple of RDEntryFillProfileV1 values")

    _validate_selection_identity(selection)
    if selection.canonical_candidate_id is None:
        if selection.canonical_model is not None:
            raise ValueError("selection canonical model requires a canonical candidate")
        return _decision(
            selection=selection,
            candidate_id=None,
            method=None,
            action=EntryMethodAction.NONE,
            reason=EntryMethodReason.NO_CANONICAL_CANDIDATE,
            profile_id=None,
            trigger_epoch=None,
            trigger_ticks=None,
            limit_ticks=None,
            wait_until_epoch=None,
            fill_epoch=None,
            fill_ticks=None,
            evaluated_at_epoch=context.evaluated_at_epoch,
        )

    if candidate is None or candidate.candidate_id != selection.canonical_candidate_id:
        raise ValueError("candidate must be the selection's canonical candidate")
    _validate_authoritative_candidate(selection=selection, candidate=candidate)
    _validate_authoritative_evidence(
        selection=selection,
        candidate=candidate,
        evidence=evidence,
        context=context,
    )
    if candidate.direction is not context.direction:
        raise ValueError("context direction must match the canonical candidate")

    if selection.action is not SelectionAction.PAPER_ELIGIBLE:
        return _decision(
            selection=selection,
            candidate_id=candidate.candidate_id,
            method=None,
            action=EntryMethodAction.SHADOW_ONLY,
            reason=EntryMethodReason.CANDIDATE_NOT_PAPER_ELIGIBLE,
            profile_id=None,
            trigger_epoch=context.trigger_epoch,
            trigger_ticks=context.trigger_ticks,
            limit_ticks=None,
            wait_until_epoch=None,
            fill_epoch=None,
            fill_ticks=None,
            evaluated_at_epoch=context.evaluated_at_epoch,
        )

    if candidate.model is EntryModelV2.HTF_FLIP:
        return _decision(
            selection=selection,
            candidate_id=candidate.candidate_id,
            method=EntryMethod.INTRABAR_FLIP,
            action=EntryMethodAction.PAPER_ELIGIBLE,
            reason=EntryMethodReason.HTF_FLIP_SELECTED,
            profile_id=None,
            trigger_epoch=context.trigger_epoch,
            trigger_ticks=context.trigger_ticks,
            limit_ticks=None,
            wait_until_epoch=None,
            fill_epoch=context.trigger_epoch,
            fill_ticks=context.trigger_ticks,
            evaluated_at_epoch=context.evaluated_at_epoch,
        )

    if candidate.model is not EntryModelV2.DIR_CLOSE:
        raise ValueError("canonical candidate must use an active trigger model")

    matches = _matching_profiles(context=context, profiles=profiles)
    if len(matches) > 1:
        return _decision(
            selection=selection,
            candidate_id=candidate.candidate_id,
            method=None,
            action=EntryMethodAction.SHADOW_ONLY,
            reason=EntryMethodReason.CONFLICTING_FILL_PROFILES,
            profile_id=None,
            trigger_epoch=context.trigger_epoch,
            trigger_ticks=context.trigger_ticks,
            limit_ticks=None,
            wait_until_epoch=None,
            fill_epoch=None,
            fill_ticks=None,
            evaluated_at_epoch=context.evaluated_at_epoch,
        )
    if not matches:
        return _decision(
            selection=selection,
            candidate_id=candidate.candidate_id,
            method=EntryMethod.CLOSE_CONFIRMATION,
            action=EntryMethodAction.PAPER_ELIGIBLE,
            reason=EntryMethodReason.DEFAULT_PROMPT_CLOSE,
            profile_id=None,
            trigger_epoch=context.trigger_epoch,
            trigger_ticks=context.trigger_ticks,
            limit_ticks=None,
            wait_until_epoch=None,
            fill_epoch=context.trigger_epoch,
            fill_ticks=context.trigger_ticks,
            evaluated_at_epoch=context.evaluated_at_epoch,
        )

    profile = matches[0]
    if profile.dir_close_method is DirectionalCloseMethod.CLOSE_CONFIRMATION:
        return _decision(
            selection=selection,
            candidate_id=candidate.candidate_id,
            method=EntryMethod.CLOSE_CONFIRMATION,
            action=EntryMethodAction.PAPER_ELIGIBLE,
            reason=EntryMethodReason.PROFILE_PROMPT_CLOSE,
            profile_id=profile.profile_id,
            trigger_epoch=context.trigger_epoch,
            trigger_ticks=context.trigger_ticks,
            limit_ticks=None,
            wait_until_epoch=None,
            fill_epoch=context.trigger_epoch,
            fill_ticks=context.trigger_ticks,
            evaluated_at_epoch=context.evaluated_at_epoch,
        )

    assert profile.limit_offset_ticks is not None
    limit_ticks = (
        context.trigger_ticks - profile.limit_offset_ticks
        if context.direction is EntryDirection.LONG
        else context.trigger_ticks + profile.limit_offset_ticks
    )
    return _decision(
        selection=selection,
        candidate_id=candidate.candidate_id,
        method=EntryMethod.NEXT_CANDLE_WICK,
        action=EntryMethodAction.PENDING_WICK,
        reason=EntryMethodReason.PROFILE_WICK_PENDING,
        profile_id=profile.profile_id,
        trigger_epoch=context.trigger_epoch,
        trigger_ticks=context.trigger_ticks,
        limit_ticks=limit_ticks,
        wait_until_epoch=context.trigger_epoch + profile.max_wait_seconds,
        fill_epoch=None,
        fill_ticks=None,
        evaluated_at_epoch=context.evaluated_at_epoch,
    )
