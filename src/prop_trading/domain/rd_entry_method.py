"""Immutable RD entry fill-method and approved-profile value objects."""

from __future__ import annotations

import re
from dataclasses import dataclass
from enum import StrEnum


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
