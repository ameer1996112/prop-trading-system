"""Immutable, cross-language-stable RD entry identities and value objects."""

from __future__ import annotations

import re
from dataclasses import dataclass
from enum import StrEnum
from typing import Literal

from prop_trading.domain.canonical import canonical_sha256


class EntryDirection(StrEnum):
    LONG = "LONG"
    SHORT = "SHORT"


class EntryModelV2(StrEnum):
    DIR_CLOSE = "DIR_CLOSE"
    HTF_FLIP = "HTF_FLIP"
    LEGACY_BREAK_CANDLE = "LEGACY_BREAK_CANDLE"
    LEGACY_REJECTION_RESPECT = "LEGACY_REJECTION_RESPECT"


class CandidateState(StrEnum):
    MATCHED = "MATCHED"
    BLOCKED = "BLOCKED"
    REJECTED = "REJECTED"
    NORMALIZED = "NORMALIZED"


class CandidateFidelity(StrEnum):
    EXACT = "EXACT"
    CALIBRATED = "CALIBRATED"
    DISCRETIONARY = "DISCRETIONARY"
    UNRESOLVED = "UNRESOLVED"


class ProofPlane(StrEnum):
    CONFIRMED_5M = "CONFIRMED_5M"
    LOWER_TIMEFRAME_REPLAY = "LOWER_TIMEFRAME_REPLAY"
    REALTIME_TICK = "REALTIME_TICK"
    EXTERNAL_ARCHIVED_TICK = "EXTERNAL_ARCHIVED_TICK"


class HandlingMode(StrEnum):
    CLOSE_CONFIRMATION = "CLOSE_CONFIRMATION"
    INTRABAR_FLIP = "INTRABAR_FLIP"
    NEXT_CANDLE_WICK = "NEXT_CANDLE_WICK"
    AGGRESSIVE = "AGGRESSIVE"


class AttemptKind(StrEnum):
    INITIAL = "INITIAL"
    RE_ENTRY = "RE_ENTRY"


class SetupAttemptTerminalReason(StrEnum):
    INVALIDATED = "INVALIDATED"
    BOTH_ACTIVE_MODELS_OBSERVED = "BOTH_ACTIVE_MODELS_OBSERVED"
    RETENTION_EVICTED = "RETENTION_EVICTED"


class SelectionAction(StrEnum):
    OBSERVE = "OBSERVE"
    PAPER_ELIGIBLE = "PAPER_ELIGIBLE"
    SHADOW_ONLY = "SHADOW_ONLY"
    NONE = "NONE"


class SelectionReason(StrEnum):
    ONLY_EXACT_TRIGGER = "ONLY_EXACT_TRIGGER"
    EARLIEST_EXACT_TRIGGER = "EARLIEST_EXACT_TRIGGER"
    FALLBACK_TO_CONFIRMED_CLOSE = "FALLBACK_TO_CONFIRMED_CLOSE"
    NO_EXACT_CANDIDATE = "NO_EXACT_CANDIDATE"
    UNRESOLVED_SOURCE_PRIORITY = "UNRESOLVED_SOURCE_PRIORITY"
    SETUP_INVALIDATED = "SETUP_INVALIDATED"
    NO_CANDIDATE = "NO_CANDIDATE"


class AmbiguityCode(StrEnum):
    SAME_CHILD_BAR_ORDER = "SHADOW_SAME_CHILD_BAR_ORDER"
    MISSING_INTRABAR_COVERAGE = "SHADOW_MISSING_INTRABAR_COVERAGE"
    REALTIME_ONLY_NOT_REPLAYABLE = "SHADOW_REALTIME_ONLY_NOT_REPLAYABLE"


_SHA256 = re.compile(r"^[0-9a-f]{64}$")
_POLICY_VERSION = "rd-entry-arbitration-v2"


def _require_int(
    value: object,
    name: str,
    *,
    positive: bool = False,
    non_negative: bool = False,
) -> None:
    if type(value) is not int:
        raise ValueError(f"{name} must be an integer (bool is not allowed)")
    if (non_negative and value < 0) or (positive and value <= 0):
        comparison = "positive" if positive else "non-negative"
        raise ValueError(f"{name} must be {comparison}")


def _require_bool(value: object, name: str) -> None:
    if type(value) is not bool:
        raise ValueError(f"{name} must be a bool")


def _require_text(value: object, name: str) -> None:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{name} must be a non-empty string")


def _require_sha256(value: object, name: str) -> None:
    if not isinstance(value, str) or _SHA256.fullmatch(value) is None or value == "0" * 64:
        raise ValueError(f"{name} must be a nonzero lowercase SHA-256 hex digest")


def _require_enum(value: object, enum_type: type[StrEnum], name: str) -> None:
    if not isinstance(value, enum_type):
        raise ValueError(f"{name} must be a {enum_type.__name__}")


def _require_sorted_unique_contexts(values: tuple[int, ...], name: str) -> None:
    if not isinstance(values, tuple):
        raise ValueError(f"{name} must be a tuple")
    for value in values:
        _require_int(value, name, positive=True)
    if tuple(sorted(values)) != values or len(set(values)) != len(values):
        raise ValueError(f"{name} must be sorted and unique")


def _require_unique_texts(values: tuple[str, ...], name: str) -> None:
    if not isinstance(values, tuple):
        raise ValueError(f"{name} must be a tuple")
    for value in values:
        _require_text(value, name)
    if len(set(values)) != len(values):
        raise ValueError(f"{name} must not contain duplicates")


def _require_optional_trigger_pair(epoch: int | None, ticks: int | None, name: str) -> None:
    if (epoch is None) != (ticks is None):
        raise ValueError(f"{name} epoch and ticks must both be present or absent")
    if epoch is not None:
        _require_int(epoch, f"{name}_epoch", non_negative=True)
        _require_int(ticks, f"{name}_ticks")


@dataclass(frozen=True, slots=True)
class OrderedCandle:
    open_epoch: int
    close_epoch: int
    open_ticks: int
    high_ticks: int
    low_ticks: int
    close_ticks: int

    def __post_init__(self) -> None:
        _require_int(self.open_epoch, "open_epoch", non_negative=True)
        _require_int(self.close_epoch, "close_epoch", non_negative=True)
        for name, value in (
            ("open_ticks", self.open_ticks),
            ("high_ticks", self.high_ticks),
            ("low_ticks", self.low_ticks),
            ("close_ticks", self.close_ticks),
        ):
            _require_int(value, name)
        if self.close_epoch <= self.open_epoch:
            raise ValueError("close_epoch must be after open_epoch")
        if self.high_ticks < max(self.open_ticks, self.close_ticks, self.low_ticks):
            raise ValueError("high_ticks is below candle values")
        if self.low_ticks > min(self.open_ticks, self.close_ticks, self.high_ticks):
            raise ValueError("low_ticks is above candle values")

    def to_mapping(self) -> dict[str, int]:
        return {
            "open_epoch": self.open_epoch,
            "close_epoch": self.close_epoch,
            "open_ticks": self.open_ticks,
            "high_ticks": self.high_ticks,
            "low_ticks": self.low_ticks,
            "close_ticks": self.close_ticks,
        }


@dataclass(frozen=True, slots=True)
class HTFFlipProofTranscript:
    context_minutes: int
    htf_open_epoch: int
    htf_open_ticks: int
    scan_cutoff_epoch: int
    proof_resolution_seconds: int
    coverage_start_epoch: int
    coverage_end_epoch: int
    expected_child_count: int
    observed_child_count: int
    gap_present: bool
    full_lifecycle_ordered: bool
    destination_seen_before_contact: bool
    contact_candle: OrderedCandle | None
    recross_candle: OrderedCandle | None
    same_child: bool

    def __post_init__(self) -> None:
        _require_int(self.context_minutes, "context_minutes", positive=True)
        if self.context_minutes not in {15, 30, 60}:
            raise ValueError("context_minutes must be one of 15, 30, 60")
        for name, value in (
            ("htf_open_epoch", self.htf_open_epoch),
            ("htf_open_ticks", self.htf_open_ticks),
            ("scan_cutoff_epoch", self.scan_cutoff_epoch),
            ("proof_resolution_seconds", self.proof_resolution_seconds),
            ("coverage_start_epoch", self.coverage_start_epoch),
            ("coverage_end_epoch", self.coverage_end_epoch),
            ("expected_child_count", self.expected_child_count),
            ("observed_child_count", self.observed_child_count),
        ):
            _require_int(
                value,
                name,
                positive=name == "proof_resolution_seconds",
                non_negative=name
                in {
                    "htf_open_epoch",
                    "scan_cutoff_epoch",
                    "coverage_start_epoch",
                    "coverage_end_epoch",
                    "expected_child_count",
                    "observed_child_count",
                },
            )
        if self.proof_resolution_seconds >= 300 or 300 % self.proof_resolution_seconds != 0:
            raise ValueError("proof_resolution_seconds must divide 300 and be below 300")
        if self.coverage_start_epoch != self.htf_open_epoch:
            raise ValueError("coverage_start_epoch must equal htf_open_epoch")
        if self.coverage_end_epoch != self.scan_cutoff_epoch:
            raise ValueError("coverage_end_epoch must equal scan_cutoff_epoch")
        if self.coverage_end_epoch <= self.coverage_start_epoch:
            raise ValueError("coverage must have increasing epochs")
        for name, value in (
            ("gap_present", self.gap_present),
            ("full_lifecycle_ordered", self.full_lifecycle_ordered),
            ("destination_seen_before_contact", self.destination_seen_before_contact),
            ("same_child", self.same_child),
        ):
            _require_bool(value, name)
        for name, candle in (
            ("contact_candle", self.contact_candle),
            ("recross_candle", self.recross_candle),
        ):
            if candle is not None and not isinstance(candle, OrderedCandle):
                raise ValueError(f"{name} must be an OrderedCandle or None")
        if self.recross_candle is not None and self.contact_candle is None:
            raise ValueError("recross_candle requires contact_candle")
        same_interval = (
            self.contact_candle is not None
            and self.recross_candle is not None
            and self.contact_candle.open_epoch == self.recross_candle.open_epoch
            and self.contact_candle.close_epoch == self.recross_candle.close_epoch
        )
        if self.same_child != same_interval:
            raise ValueError("same_child must exactly reflect retained candle intervals")

    def to_mapping(self) -> dict[str, int | bool | dict[str, int] | None]:
        return {
            "context_minutes": self.context_minutes,
            "htf_open_epoch": self.htf_open_epoch,
            "htf_open_ticks": self.htf_open_ticks,
            "scan_cutoff_epoch": self.scan_cutoff_epoch,
            "proof_resolution_seconds": self.proof_resolution_seconds,
            "coverage_start_epoch": self.coverage_start_epoch,
            "coverage_end_epoch": self.coverage_end_epoch,
            "expected_child_count": self.expected_child_count,
            "observed_child_count": self.observed_child_count,
            "gap_present": self.gap_present,
            "full_lifecycle_ordered": self.full_lifecycle_ordered,
            "destination_seen_before_contact": self.destination_seen_before_contact,
            "contact_candle": (
                self.contact_candle.to_mapping() if self.contact_candle is not None else None
            ),
            "recross_candle": (
                self.recross_candle.to_mapping() if self.recross_candle is not None else None
            ),
            "same_child": self.same_child,
        }


@dataclass(frozen=True, slots=True)
class EntryCandidateIdentity:
    setup_id: str
    model: EntryModelV2
    direction: EntryDirection
    event_anchor_epoch: int
    trigger_ordinal: int

    def __post_init__(self) -> None:
        _require_text(self.setup_id, "setup_id")
        _require_enum(self.model, EntryModelV2, "model")
        _require_enum(self.direction, EntryDirection, "direction")
        _require_int(self.event_anchor_epoch, "event_anchor_epoch", non_negative=True)
        _require_int(self.trigger_ordinal, "trigger_ordinal", positive=True)


@dataclass(frozen=True, slots=True)
class EntryEvidenceIdentity:
    candidate_id: str
    proof_plane: ProofPlane
    proof_resolution_seconds: int
    coverage_start_epoch: int
    coverage_end_epoch: int
    observed_trigger_epoch: int | None
    payload_sha256: str

    def __post_init__(self) -> None:
        _require_sha256(self.candidate_id, "candidate_id")
        _require_enum(self.proof_plane, ProofPlane, "proof_plane")
        _require_int(self.proof_resolution_seconds, "proof_resolution_seconds", positive=True)
        _require_int(self.coverage_start_epoch, "coverage_start_epoch", non_negative=True)
        _require_int(self.coverage_end_epoch, "coverage_end_epoch", non_negative=True)
        if self.coverage_end_epoch <= self.coverage_start_epoch:
            raise ValueError("coverage epochs must increase")
        if self.observed_trigger_epoch is not None:
            _require_int(self.observed_trigger_epoch, "observed_trigger_epoch", non_negative=True)
        _require_sha256(self.payload_sha256, "payload_sha256")


@dataclass(frozen=True, slots=True)
class EntryHandlingIdentity:
    candidate_id: str
    evidence_id: str
    handling_mode: HandlingMode
    attempt_kind: AttemptKind
    observed_epoch: int
    observed_ticks: int | None
    fidelity: CandidateFidelity
    source_claim_ids: tuple[str, ...]

    def __post_init__(self) -> None:
        _require_sha256(self.candidate_id, "candidate_id")
        _require_sha256(self.evidence_id, "evidence_id")
        _require_enum(self.handling_mode, HandlingMode, "handling_mode")
        _require_enum(self.attempt_kind, AttemptKind, "attempt_kind")
        _require_int(self.observed_epoch, "observed_epoch", non_negative=True)
        if self.observed_ticks is not None:
            _require_int(self.observed_ticks, "observed_ticks")
        _require_enum(self.fidelity, CandidateFidelity, "fidelity")
        _require_unique_texts(self.source_claim_ids, "source_claim_ids")


@dataclass(frozen=True, slots=True)
class EntrySelectionIdentity:
    setup_id: str
    policy_version: str
    revision: int
    candidate_ids_considered: tuple[str, ...]
    canonical_candidate_id: str | None
    canonical_evidence_id: str | None
    reason: SelectionReason
    fidelity: CandidateFidelity | None
    action: SelectionAction

    def __post_init__(self) -> None:
        _validate_selection_identity(self)


@dataclass(frozen=True, slots=True)
class HTFFlipProof:
    matched: bool
    event_anchor_epoch: int
    trigger_epoch: int | None
    trigger_ticks: int | None
    htf_context_minutes: tuple[int, ...]
    fidelity: CandidateFidelity
    proof_plane: ProofPlane
    proof_resolution_seconds: int
    coverage_start_epoch: int
    coverage_end_epoch: int
    coverage_expected_child_count: int
    coverage_observed_child_count: int
    coverage_gap_detected: bool
    contact_child: OrderedCandle | None
    recross_child: OrderedCandle | None
    destination_seen_before_contact: bool
    ambiguity_codes: tuple[AmbiguityCode, ...]
    transcript_sha256: str
    full_lifecycle_ordered: bool
    transcript: HTFFlipProofTranscript

    def __post_init__(self) -> None:
        """Validate structure; Task 5 is the public semantic construction boundary."""
        _require_bool(self.matched, "matched")
        _require_int(self.event_anchor_epoch, "event_anchor_epoch", non_negative=True)
        _require_optional_trigger_pair(self.trigger_epoch, self.trigger_ticks, "trigger")
        _require_sorted_unique_contexts(self.htf_context_minutes, "htf_context_minutes")
        _require_enum(self.fidelity, CandidateFidelity, "fidelity")
        _require_enum(self.proof_plane, ProofPlane, "proof_plane")
        _require_int(self.proof_resolution_seconds, "proof_resolution_seconds", positive=True)
        for name, value in (
            ("coverage_start_epoch", self.coverage_start_epoch),
            ("coverage_end_epoch", self.coverage_end_epoch),
            ("coverage_expected_child_count", self.coverage_expected_child_count),
            ("coverage_observed_child_count", self.coverage_observed_child_count),
        ):
            _require_int(value, name, non_negative=True)
        if self.coverage_end_epoch <= self.coverage_start_epoch:
            raise ValueError("coverage epochs must increase")
        _require_bool(self.coverage_gap_detected, "coverage_gap_detected")
        _require_bool(self.destination_seen_before_contact, "destination_seen_before_contact")
        _require_bool(self.full_lifecycle_ordered, "full_lifecycle_ordered")
        for name, candle in (
            ("contact_child", self.contact_child),
            ("recross_child", self.recross_child),
        ):
            if candle is not None and not isinstance(candle, OrderedCandle):
                raise ValueError(f"{name} must be an OrderedCandle or None")
        if not isinstance(self.ambiguity_codes, tuple):
            raise ValueError("ambiguity_codes must be a tuple")
        for code in self.ambiguity_codes:
            _require_enum(code, AmbiguityCode, "ambiguity_codes")
        if len(set(self.ambiguity_codes)) != len(self.ambiguity_codes):
            raise ValueError("ambiguity_codes must not contain duplicates")
        _require_sha256(self.transcript_sha256, "transcript_sha256")
        if not isinstance(self.transcript, HTFFlipProofTranscript):
            raise ValueError("transcript must be an HTFFlipProofTranscript")

        transcript = self.transcript
        expected_trigger_epoch = (
            transcript.recross_candle.close_epoch if transcript.recross_candle is not None else None
        )
        expected_trigger_ticks = (
            transcript.htf_open_ticks if transcript.recross_candle is not None else None
        )
        if (
            self.event_anchor_epoch != transcript.htf_open_epoch
            or self.htf_context_minutes != (transcript.context_minutes,)
            or self.proof_plane is not ProofPlane.LOWER_TIMEFRAME_REPLAY
            or self.proof_resolution_seconds != transcript.proof_resolution_seconds
            or self.coverage_start_epoch != transcript.coverage_start_epoch
            or self.coverage_end_epoch != transcript.coverage_end_epoch
            or self.coverage_expected_child_count != transcript.expected_child_count
            or self.coverage_observed_child_count != transcript.observed_child_count
            or self.coverage_gap_detected != transcript.gap_present
            or self.contact_child != transcript.contact_candle
            or self.recross_child != transcript.recross_candle
            or self.destination_seen_before_contact != transcript.destination_seen_before_contact
            or self.full_lifecycle_ordered != transcript.full_lifecycle_ordered
            or self.trigger_epoch != expected_trigger_epoch
            or self.trigger_ticks != expected_trigger_ticks
            or self.transcript_sha256 != canonical_sha256(transcript.to_mapping())
        ):
            raise ValueError("HTF proof fields must agree with its transcript")


@dataclass(frozen=True, slots=True)
class EntryCandidate:
    candidate_id: str
    setup_id: str
    model: EntryModelV2
    state: CandidateState
    event_anchor_epoch: int
    trigger_ordinal: int
    direction: EntryDirection
    source_claim_ids: tuple[str, ...]
    normalized_from: EntryModelV2 | None
    observed_at_epoch: int

    def __post_init__(self) -> None:
        _require_sha256(self.candidate_id, "candidate_id")
        _require_text(self.setup_id, "setup_id")
        _require_enum(self.model, EntryModelV2, "model")
        _require_enum(self.state, CandidateState, "state")
        _require_int(self.event_anchor_epoch, "event_anchor_epoch", non_negative=True)
        _require_int(self.trigger_ordinal, "trigger_ordinal", positive=True)
        _require_enum(self.direction, EntryDirection, "direction")
        _require_unique_texts(self.source_claim_ids, "source_claim_ids")
        if self.normalized_from is not None:
            _require_enum(self.normalized_from, EntryModelV2, "normalized_from")
        _require_int(self.observed_at_epoch, "observed_at_epoch", non_negative=True)


@dataclass(frozen=True, slots=True)
class EntryCandidateEvidence:
    evidence_id: str
    candidate_id: str
    observed_trigger_epoch: int | None
    observed_trigger_ticks: int | None
    htf_context_minutes: tuple[int, ...]
    fidelity: CandidateFidelity
    proof_plane: ProofPlane
    proof_resolution_seconds: int
    coverage_start_epoch: int
    coverage_end_epoch: int
    ambiguity_codes: tuple[AmbiguityCode, ...]
    passed_rule_ids: tuple[str, ...]
    failed_rule_ids: tuple[str, ...]
    source_claim_ids: tuple[str, ...]
    payload_sha256: str
    observed_at_epoch: int

    def __post_init__(self) -> None:
        _require_sha256(self.evidence_id, "evidence_id")
        _require_sha256(self.candidate_id, "candidate_id")
        _require_optional_trigger_pair(
            self.observed_trigger_epoch, self.observed_trigger_ticks, "observed_trigger"
        )
        _require_sorted_unique_contexts(self.htf_context_minutes, "htf_context_minutes")
        _require_enum(self.fidelity, CandidateFidelity, "fidelity")
        _require_enum(self.proof_plane, ProofPlane, "proof_plane")
        _require_int(self.proof_resolution_seconds, "proof_resolution_seconds", positive=True)
        _require_int(self.coverage_start_epoch, "coverage_start_epoch", non_negative=True)
        _require_int(self.coverage_end_epoch, "coverage_end_epoch", non_negative=True)
        if self.coverage_end_epoch <= self.coverage_start_epoch:
            raise ValueError("coverage epochs must increase")
        if not isinstance(self.ambiguity_codes, tuple):
            raise ValueError("ambiguity_codes must be a tuple")
        for code in self.ambiguity_codes:
            _require_enum(code, AmbiguityCode, "ambiguity_codes")
        if len(set(self.ambiguity_codes)) != len(self.ambiguity_codes):
            raise ValueError("ambiguity_codes must not contain duplicates")
        _require_unique_texts(self.passed_rule_ids, "passed_rule_ids")
        _require_unique_texts(self.failed_rule_ids, "failed_rule_ids")
        _require_unique_texts(self.source_claim_ids, "source_claim_ids")
        _require_sha256(self.payload_sha256, "payload_sha256")
        _require_int(self.observed_at_epoch, "observed_at_epoch", non_negative=True)


@dataclass(frozen=True, slots=True)
class EntryHandlingObservation:
    handling_id: str
    candidate_id: str
    evidence_id: str
    handling_mode: HandlingMode
    attempt_kind: AttemptKind
    observed_epoch: int
    observed_ticks: int | None
    fidelity: CandidateFidelity
    source_claim_ids: tuple[str, ...]

    def __post_init__(self) -> None:
        _require_sha256(self.handling_id, "handling_id")
        EntryHandlingIdentity(
            candidate_id=self.candidate_id,
            evidence_id=self.evidence_id,
            handling_mode=self.handling_mode,
            attempt_kind=self.attempt_kind,
            observed_epoch=self.observed_epoch,
            observed_ticks=self.observed_ticks,
            fidelity=self.fidelity,
            source_claim_ids=self.source_claim_ids,
        )


@dataclass(frozen=True, slots=True)
class EntrySelection:
    selection_id: str
    setup_id: str
    policy_version: Literal["rd-entry-arbitration-v2"]
    revision: int
    candidate_ids_considered: tuple[str, ...]
    canonical_candidate_id: str | None
    canonical_evidence_id: str | None
    canonical_model: EntryModelV2 | None
    reason: SelectionReason
    fidelity: CandidateFidelity | None
    action: SelectionAction
    evaluated_at_epoch: int

    def __post_init__(self) -> None:
        _require_sha256(self.selection_id, "selection_id")
        _validate_selection_fields(
            setup_id=self.setup_id,
            policy_version=self.policy_version,
            revision=self.revision,
            candidate_ids_considered=self.candidate_ids_considered,
            canonical_candidate_id=self.canonical_candidate_id,
            canonical_evidence_id=self.canonical_evidence_id,
            reason=self.reason,
            fidelity=self.fidelity,
            action=self.action,
        )
        if self.canonical_model is not None:
            _require_enum(self.canonical_model, EntryModelV2, "canonical_model")
        _require_int(self.evaluated_at_epoch, "evaluated_at_epoch", non_negative=True)


def _validate_selection_identity(identity: EntrySelectionIdentity) -> None:
    _validate_selection_fields(
        setup_id=identity.setup_id,
        policy_version=identity.policy_version,
        revision=identity.revision,
        candidate_ids_considered=identity.candidate_ids_considered,
        canonical_candidate_id=identity.canonical_candidate_id,
        canonical_evidence_id=identity.canonical_evidence_id,
        reason=identity.reason,
        fidelity=identity.fidelity,
        action=identity.action,
    )


def _validate_selection_fields(
    *,
    setup_id: str,
    policy_version: str,
    revision: int,
    candidate_ids_considered: tuple[str, ...],
    canonical_candidate_id: str | None,
    canonical_evidence_id: str | None,
    reason: SelectionReason,
    fidelity: CandidateFidelity | None,
    action: SelectionAction,
) -> None:
    _require_text(setup_id, "setup_id")
    if policy_version != _POLICY_VERSION:
        raise ValueError(f"policy_version must be {_POLICY_VERSION}")
    _require_int(revision, "revision", non_negative=True)
    if not isinstance(candidate_ids_considered, tuple):
        raise ValueError("candidate_ids_considered must be a tuple")
    for candidate in candidate_ids_considered:
        _require_sha256(candidate, "candidate_ids_considered")
    if tuple(sorted(candidate_ids_considered)) != candidate_ids_considered:
        raise ValueError("candidate_ids_considered must be sorted")
    if len(set(candidate_ids_considered)) != len(candidate_ids_considered):
        raise ValueError("candidate_ids_considered must not contain duplicates")
    if (canonical_candidate_id is None) != (canonical_evidence_id is None):
        raise ValueError("canonical candidate and evidence IDs must both be present or absent")
    if canonical_candidate_id is not None:
        _require_sha256(canonical_candidate_id, "canonical_candidate_id")
        _require_sha256(canonical_evidence_id, "canonical_evidence_id")
    _require_enum(reason, SelectionReason, "reason")
    if fidelity is not None:
        _require_enum(fidelity, CandidateFidelity, "fidelity")
    _require_enum(action, SelectionAction, "action")


def candidate_id(identity: EntryCandidateIdentity) -> str:
    return canonical_sha256(
        {
            "direction": identity.direction.value,
            "event_anchor_epoch": identity.event_anchor_epoch,
            "model": identity.model.value,
            "setup_id": identity.setup_id,
            "trigger_ordinal": identity.trigger_ordinal,
        }
    )


def evidence_id(identity: EntryEvidenceIdentity) -> str:
    return canonical_sha256(
        {
            "candidate_id": identity.candidate_id,
            "coverage_end_epoch": identity.coverage_end_epoch,
            "coverage_start_epoch": identity.coverage_start_epoch,
            "observed_trigger_epoch": identity.observed_trigger_epoch,
            "payload_sha256": identity.payload_sha256,
            "proof_plane": identity.proof_plane.value,
            "proof_resolution_seconds": identity.proof_resolution_seconds,
        }
    )


def handling_id(identity: EntryHandlingIdentity) -> str:
    return canonical_sha256(
        {
            "attempt_kind": identity.attempt_kind.value,
            "candidate_id": identity.candidate_id,
            "evidence_id": identity.evidence_id,
            "fidelity": identity.fidelity.value,
            "handling_mode": identity.handling_mode.value,
            "observed_epoch": identity.observed_epoch,
            "observed_ticks": identity.observed_ticks,
            "source_claim_ids": list(identity.source_claim_ids),
        }
    )


def selection_id(identity: EntrySelectionIdentity) -> str:
    return canonical_sha256(
        {
            "action": identity.action.value,
            "candidate_ids_considered": list(identity.candidate_ids_considered),
            "canonical_candidate_id": identity.canonical_candidate_id,
            "canonical_evidence_id": identity.canonical_evidence_id,
            "fidelity": identity.fidelity.value if identity.fidelity is not None else None,
            "policy_version": identity.policy_version,
            "reason": identity.reason.value,
            "revision": identity.revision,
            "setup_id": identity.setup_id,
        }
    )
