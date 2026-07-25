"""Strict cross-language vectors for canonical RD entry-method resolution."""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import Field, model_validator

from prop_trading.contracts.models import ContractModel, Identifier, SafeInteger, Sha256
from prop_trading.domain.rd_entry_method import (
    DirectionalCloseMethod,
    EntryMethod,
    EntryMethodAction,
    EntryMethodContext,
    EntryMethodDecision,
    EntryMethodReason,
    RDEntryFillProfileV1,
    WickReplayEvidence,
    entry_method_decision_id,
    resolve_entry_method,
    resolve_wick_fill,
)
from prop_trading.domain.rd_entry_models import (
    CandidateFidelity,
    CandidateState,
    EntryCandidate,
    EntryCandidateEvidence,
    EntryDirection,
    EntryModelV2,
    EntrySelection,
    ProofPlane,
    SelectionAction,
    SelectionReason,
)

NonNegativeInteger = Annotated[SafeInteger, Field(ge=0)]
PositiveInteger = Annotated[SafeInteger, Field(gt=0)]
Direction = Literal["LONG", "SHORT"]
EntryModel = Literal["DIR_CLOSE", "HTF_FLIP"]
Method = Literal["INTRABAR_FLIP", "CLOSE_CONFIRMATION", "NEXT_CANDLE_WICK"]
MethodAction = Literal["PAPER_ELIGIBLE", "PENDING_WICK", "SHADOW_ONLY", "MISSED", "NONE"]
MethodReason = Literal[
    "HTF_FLIP_SELECTED",
    "DEFAULT_PROMPT_CLOSE",
    "PROFILE_PROMPT_CLOSE",
    "PROFILE_WICK_PENDING",
    "WICK_REPLAY_FILLED",
    "MISSED_WICK_FILL",
    "CONFLICTING_FILL_PROFILES",
    "INCOMPLETE_WICK_REPLAY",
    "CANDIDATE_NOT_PAPER_ELIGIBLE",
    "NO_CANONICAL_CANDIDATE",
]
ReplayProofPlane = Literal[
    "LOWER_TIMEFRAME_REPLAY",
    "EXTERNAL_ARCHIVED_TICK",
    "REALTIME_TICK",
]


class RDEntryMethodCandidateVectorV1(ContractModel):
    candidate_id: Sha256
    setup_id: Identifier
    model: EntryModel
    state: Literal["MATCHED", "NORMALIZED"]
    event_anchor_epoch: NonNegativeInteger
    trigger_ordinal: PositiveInteger
    direction: Direction
    source_claim_ids: tuple[Identifier, ...]
    normalized_from: (
        Literal[
            "DIR_CLOSE",
            "HTF_FLIP",
            "LEGACY_BREAK_CANDLE",
            "LEGACY_REJECTION_RESPECT",
        ]
        | None
    )
    observed_at_epoch: NonNegativeInteger

    def to_domain(self) -> EntryCandidate:
        return EntryCandidate(
            candidate_id=self.candidate_id,
            setup_id=self.setup_id,
            model=EntryModelV2(self.model),
            state=CandidateState(self.state),
            event_anchor_epoch=self.event_anchor_epoch,
            trigger_ordinal=self.trigger_ordinal,
            direction=EntryDirection(self.direction),
            source_claim_ids=self.source_claim_ids,
            normalized_from=(
                EntryModelV2(self.normalized_from) if self.normalized_from is not None else None
            ),
            observed_at_epoch=self.observed_at_epoch,
        )


class RDEntryMethodEvidenceVectorV1(ContractModel):
    evidence_id: Sha256
    candidate_id: Sha256
    observed_trigger_epoch: NonNegativeInteger
    observed_trigger_ticks: SafeInteger
    htf_context_minutes: tuple[Literal[15, 30, 60], ...]
    fidelity: Literal["EXACT"]
    proof_plane: Literal[
        "CONFIRMED_5M",
        "LOWER_TIMEFRAME_REPLAY",
        "EXTERNAL_ARCHIVED_TICK",
    ]
    proof_resolution_seconds: PositiveInteger
    coverage_start_epoch: NonNegativeInteger
    coverage_end_epoch: NonNegativeInteger
    ambiguity_codes: tuple[
        Literal[
            "SHADOW_SAME_CHILD_BAR_ORDER",
            "SHADOW_MISSING_INTRABAR_COVERAGE",
            "SHADOW_REALTIME_ONLY_NOT_REPLAYABLE",
        ],
        ...,
    ]
    passed_rule_ids: tuple[Identifier, ...]
    failed_rule_ids: tuple[Identifier, ...]
    source_claim_ids: tuple[Identifier, ...]
    payload_sha256: Sha256
    observed_at_epoch: NonNegativeInteger

    def to_domain(self) -> EntryCandidateEvidence:
        return EntryCandidateEvidence(
            evidence_id=self.evidence_id,
            candidate_id=self.candidate_id,
            observed_trigger_epoch=self.observed_trigger_epoch,
            observed_trigger_ticks=self.observed_trigger_ticks,
            htf_context_minutes=self.htf_context_minutes,
            fidelity=CandidateFidelity(self.fidelity),
            proof_plane=ProofPlane(self.proof_plane),
            proof_resolution_seconds=self.proof_resolution_seconds,
            coverage_start_epoch=self.coverage_start_epoch,
            coverage_end_epoch=self.coverage_end_epoch,
            ambiguity_codes=(),
            passed_rule_ids=self.passed_rule_ids,
            failed_rule_ids=self.failed_rule_ids,
            source_claim_ids=self.source_claim_ids,
            payload_sha256=self.payload_sha256,
            observed_at_epoch=self.observed_at_epoch,
        )


class RDEntryMethodSelectionVectorV1(ContractModel):
    selection_id: Sha256
    setup_id: Identifier
    policy_version: Literal["rd-entry-arbitration-v2"]
    revision: NonNegativeInteger
    candidate_ids_considered: tuple[Sha256, ...]
    canonical_candidate_id: Sha256 | None
    canonical_evidence_id: Sha256 | None
    canonical_model: EntryModel | None
    reason: Literal[
        "ONLY_EXACT_TRIGGER",
        "EARLIEST_EXACT_TRIGGER",
        "FALLBACK_TO_CONFIRMED_CLOSE",
        "NO_EXACT_CANDIDATE",
        "UNRESOLVED_SOURCE_PRIORITY",
        "SETUP_INVALIDATED",
        "NO_CANDIDATE",
    ]
    fidelity: Literal["EXACT", "CALIBRATED", "DISCRETIONARY", "UNRESOLVED"] | None
    action: Literal["PAPER_ELIGIBLE", "SHADOW_ONLY", "NONE"]
    evaluated_at_epoch: NonNegativeInteger

    def to_domain(self) -> EntrySelection:
        return EntrySelection(
            selection_id=self.selection_id,
            setup_id=self.setup_id,
            policy_version=self.policy_version,
            revision=self.revision,
            candidate_ids_considered=self.candidate_ids_considered,
            canonical_candidate_id=self.canonical_candidate_id,
            canonical_evidence_id=self.canonical_evidence_id,
            canonical_model=(
                EntryModelV2(self.canonical_model) if self.canonical_model is not None else None
            ),
            reason=SelectionReason(self.reason),
            fidelity=CandidateFidelity(self.fidelity) if self.fidelity is not None else None,
            action=SelectionAction(self.action),
            evaluated_at_epoch=self.evaluated_at_epoch,
        )


class RDEntryMethodContextVectorV1(ContractModel):
    feed_id: Identifier
    symbol: Identifier
    evaluated_at_epoch: NonNegativeInteger
    trigger_epoch: NonNegativeInteger
    trigger_ticks: SafeInteger
    direction: Direction

    def to_domain(self) -> EntryMethodContext:
        return EntryMethodContext(
            feed_id=self.feed_id,
            symbol=self.symbol,
            evaluated_at_epoch=self.evaluated_at_epoch,
            trigger_epoch=self.trigger_epoch,
            trigger_ticks=self.trigger_ticks,
            direction=EntryDirection(self.direction),
        )


class RDEntryFillProfileVectorV1(ContractModel):
    profile_id: Identifier
    version: PositiveInteger
    feed_id: Identifier
    symbol: Identifier
    session_start_minute_utc: Annotated[SafeInteger, Field(ge=0, le=1439)]
    session_end_minute_utc: Annotated[SafeInteger, Field(ge=0, le=1439)]
    dir_close_method: Literal["CLOSE_CONFIRMATION", "NEXT_CANDLE_WICK"]
    limit_offset_ticks: PositiveInteger | None
    max_wait_seconds: Literal[300]
    evidence_manifest_sha256: Sha256
    status: Literal["APPROVED"]
    approved_by: Identifier
    approved_at_epoch: NonNegativeInteger

    def to_domain(self) -> RDEntryFillProfileV1:
        return RDEntryFillProfileV1(
            profile_id=self.profile_id,
            version=self.version,
            feed_id=self.feed_id,
            symbol=self.symbol,
            session_start_minute_utc=self.session_start_minute_utc,
            session_end_minute_utc=self.session_end_minute_utc,
            dir_close_method=DirectionalCloseMethod(self.dir_close_method),
            limit_offset_ticks=self.limit_offset_ticks,
            max_wait_seconds=self.max_wait_seconds,
            evidence_manifest_sha256=self.evidence_manifest_sha256,
            status=self.status,
            approved_by=self.approved_by,
            approved_at_epoch=self.approved_at_epoch,
        )


class WickReplayEvidenceVectorV1(ContractModel):
    proof_plane: ReplayProofPlane
    coverage_start_epoch: NonNegativeInteger
    coverage_end_epoch: NonNegativeInteger
    coverage_complete: bool
    session_gap: bool
    touched_epoch: NonNegativeInteger | None
    observed_low_ticks: SafeInteger
    observed_high_ticks: SafeInteger

    def to_domain(self) -> WickReplayEvidence:
        return WickReplayEvidence(
            proof_plane=ProofPlane(self.proof_plane),
            coverage_start_epoch=self.coverage_start_epoch,
            coverage_end_epoch=self.coverage_end_epoch,
            coverage_complete=self.coverage_complete,
            session_gap=self.session_gap,
            touched_epoch=self.touched_epoch,
            observed_low_ticks=self.observed_low_ticks,
            observed_high_ticks=self.observed_high_ticks,
        )


class EntryMethodDecisionVectorV1(ContractModel):
    decision_id: Sha256
    selection_id: Sha256
    setup_id: Identifier
    candidate_id: Sha256 | None
    method: Method | None
    action: MethodAction
    reason: MethodReason
    profile_id: Identifier | None
    trigger_epoch: NonNegativeInteger | None
    trigger_ticks: SafeInteger | None
    limit_ticks: SafeInteger | None
    wait_until_epoch: NonNegativeInteger | None
    fill_epoch: NonNegativeInteger | None
    fill_ticks: SafeInteger | None
    evaluated_at_epoch: NonNegativeInteger

    @model_validator(mode="after")
    def _identity_is_canonical(self) -> EntryMethodDecisionVectorV1:
        authoritative_id = entry_method_decision_id(
            selection_id=self.selection_id,
            setup_id=self.setup_id,
            candidate_id=self.candidate_id,
            method=EntryMethod(self.method) if self.method is not None else None,
            action=EntryMethodAction(self.action),
            reason=EntryMethodReason(self.reason),
            profile_id=self.profile_id,
            trigger_epoch=self.trigger_epoch,
            trigger_ticks=self.trigger_ticks,
            limit_ticks=self.limit_ticks,
            wait_until_epoch=self.wait_until_epoch,
            fill_epoch=self.fill_epoch,
            fill_ticks=self.fill_ticks,
            evaluated_at_epoch=self.evaluated_at_epoch,
        )
        if self.decision_id != authoritative_id:
            raise ValueError("decision_id conflicts with canonical domain identity")
        return self


class RDEntryMethodInputVectorV1(ContractModel):
    selection: RDEntryMethodSelectionVectorV1
    candidate: RDEntryMethodCandidateVectorV1 | None
    evidence: RDEntryMethodEvidenceVectorV1 | None
    context: RDEntryMethodContextVectorV1
    profiles: tuple[RDEntryFillProfileVectorV1, ...]
    wick_replay: WickReplayEvidenceVectorV1 | None

    def evaluate(self) -> EntryMethodDecision:
        decision = resolve_entry_method(
            selection=self.selection.to_domain(),
            candidate=self.candidate.to_domain() if self.candidate is not None else None,
            evidence=self.evidence.to_domain() if self.evidence is not None else None,
            context=self.context.to_domain(),
            profiles=tuple(item.to_domain() for item in self.profiles),
        )
        if self.wick_replay is not None:
            decision = resolve_wick_fill(decision, self.wick_replay.to_domain())
        return decision


def entry_method_decision_to_mapping(decision: EntryMethodDecision) -> dict[str, object]:
    return {
        "decision_id": decision.decision_id,
        "selection_id": decision.selection_id,
        "setup_id": decision.setup_id,
        "candidate_id": decision.candidate_id,
        "method": decision.method.value if decision.method is not None else None,
        "action": decision.action.value,
        "reason": decision.reason.value,
        "profile_id": decision.profile_id,
        "trigger_epoch": decision.trigger_epoch,
        "trigger_ticks": decision.trigger_ticks,
        "limit_ticks": decision.limit_ticks,
        "wait_until_epoch": decision.wait_until_epoch,
        "fill_epoch": decision.fill_epoch,
        "fill_ticks": decision.fill_ticks,
        "evaluated_at_epoch": decision.evaluated_at_epoch,
    }


class RDEntryMethodVectorCaseV1(ContractModel):
    case_id: Identifier
    input: RDEntryMethodInputVectorV1
    expected: EntryMethodDecisionVectorV1

    @model_validator(mode="after")
    def _expected_is_canonical_domain_result(self) -> RDEntryMethodVectorCaseV1:
        try:
            actual = entry_method_decision_to_mapping(self.input.evaluate())
        except ValueError as exc:
            raise ValueError(f"input violates canonical domain semantics: {exc}") from exc
        if actual != self.expected.model_dump(mode="json"):
            raise ValueError("expected does not match canonical domain evaluation")
        return self


_REQUIRED_CASE_IDS = frozenset(
    {
        "htf_ignores_wick_profile",
        "dir_close_defaults_prompt",
        "dir_close_explicit_prompt",
        "dir_close_wick_pending_long",
        "dir_close_wick_pending_short",
        "conflicting_profiles_shadow",
        "wick_long_filled_exact",
        "wick_short_filled_exact",
        "wick_complete_missed",
        "wick_incomplete_shadow",
        "wick_gap_shadow",
        "wick_realtime_shadow",
        "noneligible_candidate_shadow",
        "no_candidate_none",
    }
)


class RDEntryMethodVectorSetV1(ContractModel):
    schema_id: Literal["phase0.rd-entry-method-vectors.v1"]
    cases: tuple[RDEntryMethodVectorCaseV1, ...] = Field(min_length=14, max_length=14)

    @model_validator(mode="after")
    def _reviewed_case_set_is_frozen(self) -> RDEntryMethodVectorSetV1:
        case_ids = [item.case_id for item in self.cases]
        if len(case_ids) != len(set(case_ids)):
            raise ValueError("entry-method vector case IDs must be unique")
        if frozenset(case_ids) != _REQUIRED_CASE_IDS:
            raise ValueError("entry-method vector case set is not frozen")
        return self
