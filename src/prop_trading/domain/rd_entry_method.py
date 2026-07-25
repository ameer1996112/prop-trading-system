"""Immutable RD entry fill-method and approved-profile value objects."""

from __future__ import annotations

import re
from dataclasses import dataclass
from enum import StrEnum

from prop_trading.domain.canonical import canonical_sha256
from prop_trading.domain.rd_entry_models import (
    EntryCandidate,
    EntryDirection,
    EntryModelV2,
    EntrySelection,
    SelectionAction,
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


def _require_sha256(value: object, name: str) -> None:
    if (
        not isinstance(value, str)
        or _SHA256.fullmatch(value) is None
        or value == "0" * 64
    ):
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


def resolve_entry_method(
    *,
    selection: EntrySelection,
    candidate: EntryCandidate | None,
    context: EntryMethodContext,
    profiles: tuple[RDEntryFillProfileV1, ...],
) -> EntryMethodDecision:
    """Resolve exactly one fill method only after canonical candidate arbitration."""
    if not isinstance(selection, EntrySelection):
        raise ValueError("selection must be an EntrySelection")
    if not isinstance(context, EntryMethodContext):
        raise ValueError("context must be an EntryMethodContext")
    if not isinstance(profiles, tuple) or not all(
        isinstance(profile, RDEntryFillProfileV1) for profile in profiles
    ):
        raise ValueError("profiles must be a tuple of RDEntryFillProfileV1 values")

    if selection.canonical_candidate_id is None:
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
    if candidate.setup_id != selection.setup_id or candidate.model is not selection.canonical_model:
        raise ValueError("candidate must agree with the canonical selection")
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
