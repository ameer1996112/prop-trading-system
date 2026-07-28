"""Immutable RD three-entry identities and canonical value objects."""

from __future__ import annotations

import re
from dataclasses import dataclass
from enum import StrEnum
from typing import Literal

from prop_trading.domain.canonical import canonical_sha256
from prop_trading.domain.rd_entry_models import (
    AmbiguityCode,
    CandidateFidelity,
    CandidateState,
    EntryDirection,
    OrderedCandle,
    ProofPlane,
    SelectionAction,
)

POLICY_VERSION_V3 = "rd-entry-arbitration-v3"


class EntryModelV3(StrEnum):
    BOC = "BOC"
    DIR_CLOSE = "DIR_CLOSE"
    HTF_FLIP = "HTF_FLIP"


class BocTier(StrEnum):
    HTF_TIMED = "HTF_TIMED"
    DISCRETIONARY_5M = "DISCRETIONARY_5M"


class EvidenceReplayability(StrEnum):
    REPLAYABLE = "REPLAYABLE"
    LIVE_EXACT_NON_REPLAYABLE = "LIVE_EXACT_NON_REPLAYABLE"


class SelectionReason(StrEnum):
    ONLY_EXACT_TRIGGER = "ONLY_EXACT_TRIGGER"
    EARLIEST_EXACT_TRIGGER = "EARLIEST_EXACT_TRIGGER"
    FALLBACK_TO_CONFIRMED_CLOSE = "FALLBACK_TO_CONFIRMED_CLOSE"
    CO_TRIGGER_SAME_EVENT = "CO_TRIGGER_SAME_EVENT"
    CO_TRIGGER_PRICE_CONFLICT = "CO_TRIGGER_PRICE_CONFLICT"
    NO_EXACT_CANDIDATE = "NO_EXACT_CANDIDATE"
    SETUP_INVALIDATED = "SETUP_INVALIDATED"
    NO_CANDIDATE = "NO_CANDIDATE"


_SHA256 = re.compile(r"^[0-9a-f]{64}$")


def _require_int(
    value: object,
    name: str,
    *,
    positive: bool = False,
    non_negative: bool = False,
) -> None:
    if type(value) is not int:
        raise ValueError(f"{name} must be an integer (bool is not allowed)")
    if positive and value <= 0:
        raise ValueError(f"{name} must be positive")
    if non_negative and value < 0:
        raise ValueError(f"{name} must be non-negative")


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


def _require_sorted_unique_contexts(values: tuple[int, ...]) -> None:
    if not isinstance(values, tuple):
        raise ValueError("htf_context_minutes must be a tuple")
    for value in values:
        _require_int(value, "htf_context_minutes", positive=True)
    if tuple(sorted(values)) != values or len(set(values)) != len(values):
        raise ValueError("htf_context_minutes must be sorted and unique")


def _require_unique_texts(values: tuple[str, ...], name: str) -> None:
    if not isinstance(values, tuple):
        raise ValueError(f"{name} must be a tuple")
    for value in values:
        _require_text(value, name)
    if len(set(values)) != len(values):
        raise ValueError(f"{name} must not contain duplicates")


def _require_optional_reference(
    *,
    boc_tier: BocTier | None,
    reference_candle_open_epoch: int | None,
    reference_candle_open_ticks: int | None = None,
    reference_candle_high_ticks: int | None = None,
    reference_candle_low_ticks: int | None = None,
    reference_candle_close_ticks: int | None = None,
) -> None:
    values = (
        reference_candle_open_epoch,
        reference_candle_open_ticks,
        reference_candle_high_ticks,
        reference_candle_low_ticks,
        reference_candle_close_ticks,
    )
    if boc_tier is None:
        if any(value is not None for value in values):
            raise ValueError("reference candle fields require a BOC tier")
        return
    _require_enum(boc_tier, BocTier, "boc_tier")
    if any(value is None for value in values):
        raise ValueError("BOC evidence requires complete reference OHLC")
    _require_int(reference_candle_open_epoch, "reference_candle_open_epoch", non_negative=True)
    for name, value in (
        ("reference_candle_open_ticks", reference_candle_open_ticks),
        ("reference_candle_high_ticks", reference_candle_high_ticks),
        ("reference_candle_low_ticks", reference_candle_low_ticks),
        ("reference_candle_close_ticks", reference_candle_close_ticks),
    ):
        _require_int(value, name)
    assert reference_candle_high_ticks is not None
    assert reference_candle_low_ticks is not None
    assert reference_candle_open_ticks is not None
    assert reference_candle_close_ticks is not None
    if reference_candle_high_ticks < max(
        reference_candle_open_ticks,
        reference_candle_close_ticks,
        reference_candle_low_ticks,
    ):
        raise ValueError("reference candle high is below an OHLC value")
    if reference_candle_low_ticks > min(
        reference_candle_open_ticks,
        reference_candle_close_ticks,
        reference_candle_high_ticks,
    ):
        raise ValueError("reference candle low is above an OHLC value")


@dataclass(frozen=True, slots=True)
class BocProof:
    reference_candle: OrderedCandle
    trigger_candle_open_epoch: int
    trigger_epoch: int
    trigger_sequence: int
    trigger_ticks: int
    htf_boundary_epoch: int | None
    htf_context_minutes: tuple[int, ...]
    proof_plane: ProofPlane
    replayability: EvidenceReplayability
    fidelity: CandidateFidelity
    coverage_start_epoch: int
    coverage_end_epoch: int
    is_realtime: bool

    def __post_init__(self) -> None:
        if not isinstance(self.reference_candle, OrderedCandle):
            raise ValueError("reference_candle must be an OrderedCandle")
        for name, value in (
            ("trigger_candle_open_epoch", self.trigger_candle_open_epoch),
            ("trigger_epoch", self.trigger_epoch),
            ("trigger_sequence", self.trigger_sequence),
            ("coverage_start_epoch", self.coverage_start_epoch),
            ("coverage_end_epoch", self.coverage_end_epoch),
        ):
            _require_int(value, name, non_negative=True)
        _require_int(self.trigger_ticks, "trigger_ticks")
        if self.htf_boundary_epoch is not None:
            _require_int(self.htf_boundary_epoch, "htf_boundary_epoch", non_negative=True)
        _require_sorted_unique_contexts(self.htf_context_minutes)
        _require_enum(self.proof_plane, ProofPlane, "proof_plane")
        _require_enum(self.replayability, EvidenceReplayability, "replayability")
        _require_enum(self.fidelity, CandidateFidelity, "fidelity")
        _require_bool(self.is_realtime, "is_realtime")
        if self.coverage_end_epoch <= self.coverage_start_epoch:
            raise ValueError("coverage epochs must increase")
        if not self.coverage_start_epoch <= self.trigger_epoch <= self.coverage_end_epoch:
            raise ValueError("trigger epoch must be inside coverage")


@dataclass(frozen=True, slots=True)
class EntryTriggerProofV3:
    event_anchor_epoch: int
    trigger_epoch: int
    trigger_sequence: int
    trigger_ticks: int
    htf_context_minutes: tuple[int, ...]
    proof_plane: ProofPlane
    replayability: EvidenceReplayability
    fidelity: CandidateFidelity
    coverage_start_epoch: int
    coverage_end_epoch: int
    is_realtime: bool

    def __post_init__(self) -> None:
        for name, value in (
            ("event_anchor_epoch", self.event_anchor_epoch),
            ("trigger_epoch", self.trigger_epoch),
            ("trigger_sequence", self.trigger_sequence),
            ("coverage_start_epoch", self.coverage_start_epoch),
            ("coverage_end_epoch", self.coverage_end_epoch),
        ):
            _require_int(value, name, non_negative=True)
        _require_int(self.trigger_ticks, "trigger_ticks")
        _require_sorted_unique_contexts(self.htf_context_minutes)
        _require_enum(self.proof_plane, ProofPlane, "proof_plane")
        _require_enum(self.replayability, EvidenceReplayability, "replayability")
        _require_enum(self.fidelity, CandidateFidelity, "fidelity")
        _require_bool(self.is_realtime, "is_realtime")
        if self.coverage_end_epoch <= self.coverage_start_epoch:
            raise ValueError("coverage epochs must increase")
        if not self.coverage_start_epoch <= self.trigger_epoch <= self.coverage_end_epoch:
            raise ValueError("trigger epoch must be inside coverage")


@dataclass(frozen=True, slots=True)
class EntryCandidateIdentityV3:
    setup_id: str
    model: EntryModelV3
    direction: EntryDirection
    event_anchor_epoch: int
    trigger_ordinal: int
    boc_tier: BocTier | None = None
    reference_candle_open_epoch: int | None = None

    def __post_init__(self) -> None:
        _require_text(self.setup_id, "setup_id")
        _require_enum(self.model, EntryModelV3, "model")
        _require_enum(self.direction, EntryDirection, "direction")
        _require_int(self.event_anchor_epoch, "event_anchor_epoch", non_negative=True)
        _require_int(self.trigger_ordinal, "trigger_ordinal", positive=True)
        if self.model is EntryModelV3.BOC:
            if self.boc_tier is None or self.reference_candle_open_epoch is None:
                raise ValueError("BOC identity requires tier and reference candle")
            _require_enum(self.boc_tier, BocTier, "boc_tier")
            _require_int(
                self.reference_candle_open_epoch,
                "reference_candle_open_epoch",
                non_negative=True,
            )
        elif self.boc_tier is not None or self.reference_candle_open_epoch is not None:
            raise ValueError("non-BOC identity cannot carry BOC fields")


@dataclass(frozen=True, slots=True)
class EntryEvidenceIdentityV3:
    candidate_id: str
    proof_plane: ProofPlane
    coverage_start_epoch: int
    coverage_end_epoch: int
    observed_trigger_epoch: int | None
    trigger_sequence: int
    payload_sha256: str

    def __post_init__(self) -> None:
        _require_sha256(self.candidate_id, "candidate_id")
        _require_enum(self.proof_plane, ProofPlane, "proof_plane")
        _require_int(self.coverage_start_epoch, "coverage_start_epoch", non_negative=True)
        _require_int(self.coverage_end_epoch, "coverage_end_epoch", non_negative=True)
        if self.coverage_end_epoch <= self.coverage_start_epoch:
            raise ValueError("coverage epochs must increase")
        if self.observed_trigger_epoch is not None:
            _require_int(
                self.observed_trigger_epoch,
                "observed_trigger_epoch",
                non_negative=True,
            )
        _require_int(self.trigger_sequence, "trigger_sequence", non_negative=True)
        _require_sha256(self.payload_sha256, "payload_sha256")


@dataclass(frozen=True, slots=True)
class EntrySelectionIdentityV3:
    setup_id: str
    policy_version: str
    revision: int
    candidate_ids_considered: tuple[str, ...]
    canonical_candidate_id: str | None
    canonical_evidence_id: str | None
    reason: SelectionReason
    fidelity: CandidateFidelity | None
    action: SelectionAction
    co_triggered_models: tuple[EntryModelV3, ...]

    def __post_init__(self) -> None:
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
            co_triggered_models=self.co_triggered_models,
        )


@dataclass(frozen=True, slots=True)
class EntryCandidateV3:
    candidate_id: str
    setup_id: str
    model: EntryModelV3
    state: CandidateState
    direction: EntryDirection
    event_anchor_epoch: int
    trigger_ordinal: int
    boc_tier: BocTier | None
    reference_candle_open_epoch: int | None
    source_claim_ids: tuple[str, ...]
    observed_at_epoch: int

    def __post_init__(self) -> None:
        _require_sha256(self.candidate_id, "candidate_id")
        identity = EntryCandidateIdentityV3(
            setup_id=self.setup_id,
            model=self.model,
            direction=self.direction,
            event_anchor_epoch=self.event_anchor_epoch,
            trigger_ordinal=self.trigger_ordinal,
            boc_tier=self.boc_tier,
            reference_candle_open_epoch=self.reference_candle_open_epoch,
        )
        if self.candidate_id != candidate_id_v3(identity):
            raise ValueError("candidate_id conflicts with its domain identity")
        _require_enum(self.state, CandidateState, "state")
        if self.state not in {
            CandidateState.MATCHED,
            CandidateState.BLOCKED,
            CandidateState.REJECTED,
        }:
            raise ValueError("v3 candidate state must be MATCHED, BLOCKED, or REJECTED")
        _require_unique_texts(self.source_claim_ids, "source_claim_ids")
        _require_int(self.observed_at_epoch, "observed_at_epoch", non_negative=True)

    def to_mapping(self) -> dict[str, object]:
        return {
            "candidate_id": self.candidate_id,
            "setup_id": self.setup_id,
            "model": self.model.value,
            "state": self.state.value,
            "direction": self.direction.value,
            "event_anchor_epoch": self.event_anchor_epoch,
            "trigger_ordinal": self.trigger_ordinal,
            "boc_tier": self.boc_tier.value if self.boc_tier is not None else None,
            "reference_candle_open_epoch": self.reference_candle_open_epoch,
            "source_claim_ids": list(self.source_claim_ids),
            "observed_at_epoch": self.observed_at_epoch,
        }


@dataclass(frozen=True, slots=True)
class EntryCandidateEvidenceV3:
    evidence_id: str
    candidate_id: str
    observed_trigger_epoch: int | None
    trigger_sequence: int
    observed_trigger_ticks: int | None
    htf_context_minutes: tuple[int, ...]
    fidelity: CandidateFidelity
    proof_plane: ProofPlane
    replayability: EvidenceReplayability
    coverage_start_epoch: int
    coverage_end_epoch: int
    ambiguity_codes: tuple[AmbiguityCode, ...]
    boc_tier: BocTier | None
    reference_candle_open_epoch: int | None
    reference_candle_open_ticks: int | None
    reference_candle_high_ticks: int | None
    reference_candle_low_ticks: int | None
    reference_candle_close_ticks: int | None
    passed_rule_ids: tuple[str, ...]
    failed_rule_ids: tuple[str, ...]
    source_claim_ids: tuple[str, ...]
    payload_sha256: str
    observed_at_epoch: int

    def __post_init__(self) -> None:
        _require_sha256(self.evidence_id, "evidence_id")
        _require_sha256(self.candidate_id, "candidate_id")
        if (self.observed_trigger_epoch is None) != (self.observed_trigger_ticks is None):
            raise ValueError("observed trigger epoch and ticks must both be present or absent")
        if self.observed_trigger_epoch is not None:
            _require_int(
                self.observed_trigger_epoch,
                "observed_trigger_epoch",
                non_negative=True,
            )
        _require_int(self.trigger_sequence, "trigger_sequence", non_negative=True)
        _require_sorted_unique_contexts(self.htf_context_minutes)
        _require_enum(self.fidelity, CandidateFidelity, "fidelity")
        _require_enum(self.proof_plane, ProofPlane, "proof_plane")
        _require_enum(self.replayability, EvidenceReplayability, "replayability")
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
        _require_optional_reference(
            boc_tier=self.boc_tier,
            reference_candle_open_epoch=self.reference_candle_open_epoch,
            reference_candle_open_ticks=self.reference_candle_open_ticks,
            reference_candle_high_ticks=self.reference_candle_high_ticks,
            reference_candle_low_ticks=self.reference_candle_low_ticks,
            reference_candle_close_ticks=self.reference_candle_close_ticks,
        )
        _require_unique_texts(self.passed_rule_ids, "passed_rule_ids")
        _require_unique_texts(self.failed_rule_ids, "failed_rule_ids")
        _require_unique_texts(self.source_claim_ids, "source_claim_ids")
        _require_sha256(self.payload_sha256, "payload_sha256")
        _require_int(self.observed_at_epoch, "observed_at_epoch", non_negative=True)
        identity = EntryEvidenceIdentityV3(
            candidate_id=self.candidate_id,
            proof_plane=self.proof_plane,
            coverage_start_epoch=self.coverage_start_epoch,
            coverage_end_epoch=self.coverage_end_epoch,
            observed_trigger_epoch=self.observed_trigger_epoch,
            trigger_sequence=self.trigger_sequence,
            payload_sha256=self.payload_sha256,
        )
        if self.evidence_id != evidence_id_v3(identity):
            raise ValueError("evidence_id conflicts with its domain identity")

    def to_mapping(self) -> dict[str, object]:
        return {
            "evidence_id": self.evidence_id,
            "candidate_id": self.candidate_id,
            "observed_trigger_epoch": self.observed_trigger_epoch,
            "trigger_sequence": self.trigger_sequence,
            "observed_trigger_ticks": self.observed_trigger_ticks,
            "htf_context_minutes": list(self.htf_context_minutes),
            "fidelity": self.fidelity.value,
            "proof_plane": self.proof_plane.value,
            "replayability": self.replayability.value,
            "coverage_start_epoch": self.coverage_start_epoch,
            "coverage_end_epoch": self.coverage_end_epoch,
            "ambiguity_codes": [item.value for item in self.ambiguity_codes],
            "boc_tier": self.boc_tier.value if self.boc_tier is not None else None,
            "reference_candle_open_epoch": self.reference_candle_open_epoch,
            "reference_candle_open_ticks": self.reference_candle_open_ticks,
            "reference_candle_high_ticks": self.reference_candle_high_ticks,
            "reference_candle_low_ticks": self.reference_candle_low_ticks,
            "reference_candle_close_ticks": self.reference_candle_close_ticks,
            "passed_rule_ids": list(self.passed_rule_ids),
            "failed_rule_ids": list(self.failed_rule_ids),
            "source_claim_ids": list(self.source_claim_ids),
            "payload_sha256": self.payload_sha256,
            "observed_at_epoch": self.observed_at_epoch,
        }


@dataclass(frozen=True, slots=True)
class EntrySelectionV3:
    selection_id: str
    setup_id: str
    policy_version: Literal["rd-entry-arbitration-v3"]
    revision: int
    candidate_ids_considered: tuple[str, ...]
    canonical_candidate_id: str | None
    canonical_evidence_id: str | None
    canonical_model: EntryModelV3 | None
    reason: SelectionReason
    fidelity: CandidateFidelity | None
    action: SelectionAction
    co_triggered_models: tuple[EntryModelV3, ...]
    evaluated_at_epoch: int

    def __post_init__(self) -> None:
        _require_sha256(self.selection_id, "selection_id")
        identity = EntrySelectionIdentityV3(
            setup_id=self.setup_id,
            policy_version=self.policy_version,
            revision=self.revision,
            candidate_ids_considered=self.candidate_ids_considered,
            canonical_candidate_id=self.canonical_candidate_id,
            canonical_evidence_id=self.canonical_evidence_id,
            reason=self.reason,
            fidelity=self.fidelity,
            action=self.action,
            co_triggered_models=self.co_triggered_models,
        )
        if self.selection_id != selection_id_v3(identity):
            raise ValueError("selection_id conflicts with its domain identity")
        if self.canonical_model is not None:
            _require_enum(self.canonical_model, EntryModelV3, "canonical_model")
        _require_int(self.evaluated_at_epoch, "evaluated_at_epoch", non_negative=True)

    def to_mapping(self) -> dict[str, object]:
        return {
            "selection_id": self.selection_id,
            "setup_id": self.setup_id,
            "policy_version": self.policy_version,
            "revision": self.revision,
            "candidate_ids_considered": list(self.candidate_ids_considered),
            "canonical_candidate_id": self.canonical_candidate_id,
            "canonical_evidence_id": self.canonical_evidence_id,
            "canonical_model": (
                self.canonical_model.value if self.canonical_model is not None else None
            ),
            "reason": self.reason.value,
            "fidelity": self.fidelity.value if self.fidelity is not None else None,
            "action": self.action.value,
            "co_triggered_models": [model.value for model in self.co_triggered_models],
            "evaluated_at_epoch": self.evaluated_at_epoch,
        }


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
    co_triggered_models: tuple[EntryModelV3, ...],
) -> None:
    _require_text(setup_id, "setup_id")
    if policy_version != POLICY_VERSION_V3:
        raise ValueError(f"policy_version must be {POLICY_VERSION_V3}")
    _require_int(revision, "revision", non_negative=True)
    if not isinstance(candidate_ids_considered, tuple):
        raise ValueError("candidate_ids_considered must be a tuple")
    for candidate_id_value in candidate_ids_considered:
        _require_sha256(candidate_id_value, "candidate_ids_considered")
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
    if not isinstance(co_triggered_models, tuple):
        raise ValueError("co_triggered_models must be a tuple")
    for model in co_triggered_models:
        _require_enum(model, EntryModelV3, "co_triggered_models")
    expected = tuple(sorted(set(co_triggered_models), key=lambda model: model.value))
    if co_triggered_models != expected:
        raise ValueError("co_triggered_models must be sorted and unique")
    if reason is SelectionReason.CO_TRIGGER_SAME_EVENT and len(co_triggered_models) < 2:
        raise ValueError("co-trigger selection requires multiple models")
    if reason is not SelectionReason.CO_TRIGGER_SAME_EVENT and co_triggered_models:
        raise ValueError("co-triggered models require CO_TRIGGER_SAME_EVENT")


def candidate_id_v3(identity: EntryCandidateIdentityV3) -> str:
    return canonical_sha256(
        {
            "boc_tier": identity.boc_tier.value if identity.boc_tier is not None else None,
            "direction": identity.direction.value,
            "event_anchor_epoch": identity.event_anchor_epoch,
            "model": identity.model.value,
            "reference_candle_open_epoch": identity.reference_candle_open_epoch,
            "setup_id": identity.setup_id,
            "trigger_ordinal": identity.trigger_ordinal,
        }
    )


def evidence_payload_sha256_v3(
    *,
    candidate_id: str,
    observed_trigger_epoch: int | None,
    trigger_sequence: int,
    observed_trigger_ticks: int | None,
    htf_context_minutes: tuple[int, ...],
    fidelity: CandidateFidelity,
    proof_plane: ProofPlane,
    replayability: EvidenceReplayability,
    coverage_start_epoch: int,
    coverage_end_epoch: int,
    ambiguity_codes: tuple[AmbiguityCode, ...],
    boc_tier: BocTier | None,
    reference_candle_open_epoch: int | None,
    reference_candle_open_ticks: int | None,
    reference_candle_high_ticks: int | None,
    reference_candle_low_ticks: int | None,
    reference_candle_close_ticks: int | None,
    passed_rule_ids: tuple[str, ...],
    failed_rule_ids: tuple[str, ...],
    source_claim_ids: tuple[str, ...],
) -> str:
    return canonical_sha256(
        {
            "ambiguity_codes": [item.value for item in ambiguity_codes],
            "boc_tier": boc_tier.value if boc_tier is not None else None,
            "candidate_id": candidate_id,
            "coverage_end_epoch": coverage_end_epoch,
            "coverage_start_epoch": coverage_start_epoch,
            "failed_rule_ids": list(failed_rule_ids),
            "fidelity": fidelity.value,
            "htf_context_minutes": list(htf_context_minutes),
            "observed_trigger_epoch": observed_trigger_epoch,
            "observed_trigger_ticks": observed_trigger_ticks,
            "passed_rule_ids": list(passed_rule_ids),
            "proof_plane": proof_plane.value,
            "reference_candle_close_ticks": reference_candle_close_ticks,
            "reference_candle_high_ticks": reference_candle_high_ticks,
            "reference_candle_low_ticks": reference_candle_low_ticks,
            "reference_candle_open_epoch": reference_candle_open_epoch,
            "reference_candle_open_ticks": reference_candle_open_ticks,
            "replayability": replayability.value,
            "source_claim_ids": list(source_claim_ids),
            "trigger_sequence": trigger_sequence,
        }
    )


def evidence_id_v3(identity: EntryEvidenceIdentityV3) -> str:
    return canonical_sha256(
        {
            "candidate_id": identity.candidate_id,
            "coverage_end_epoch": identity.coverage_end_epoch,
            "coverage_start_epoch": identity.coverage_start_epoch,
            "observed_trigger_epoch": identity.observed_trigger_epoch,
            "payload_sha256": identity.payload_sha256,
            "proof_plane": identity.proof_plane.value,
            "trigger_sequence": identity.trigger_sequence,
        }
    )


def selection_id_v3(identity: EntrySelectionIdentityV3) -> str:
    return canonical_sha256(
        {
            "action": identity.action.value,
            "candidate_ids_considered": list(identity.candidate_ids_considered),
            "canonical_candidate_id": identity.canonical_candidate_id,
            "canonical_evidence_id": identity.canonical_evidence_id,
            "co_triggered_models": [model.value for model in identity.co_triggered_models],
            "fidelity": identity.fidelity.value if identity.fidelity is not None else None,
            "policy_version": identity.policy_version,
            "reason": identity.reason.value,
            "revision": identity.revision,
            "setup_id": identity.setup_id,
        }
    )
