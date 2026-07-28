"""Strict structural and canonical schema for RD entry arbitration v3 vectors."""

from __future__ import annotations

from typing import Annotated, Literal, Self

from pydantic import Field, model_validator

from prop_trading.contracts.models import ContractModel, Identifier, SafeInteger, Sha256
from prop_trading.domain.rd_entry_models import (
    AmbiguityCode as DomainAmbiguityCode,
)
from prop_trading.domain.rd_entry_models import (
    CandidateFidelity,
    SelectionAction,
)
from prop_trading.domain.rd_entry_models import (
    EntryDirection as DomainEntryDirection,
)
from prop_trading.domain.rd_entry_models import (
    ProofPlane as DomainProofPlane,
)
from prop_trading.domain.rd_entry_models_v3 import (
    POLICY_VERSION_V3,
    EntryCandidateIdentityV3,
    EntryEvidenceIdentityV3,
    EntrySelectionIdentityV3,
    candidate_id_v3,
    evidence_id_v3,
    evidence_payload_sha256_v3,
    selection_id_v3,
)
from prop_trading.domain.rd_entry_models_v3 import (
    BocTier as DomainBocTier,
)
from prop_trading.domain.rd_entry_models_v3 import (
    EntryModelV3 as DomainEntryModelV3,
)
from prop_trading.domain.rd_entry_models_v3 import (
    EvidenceReplayability as DomainEvidenceReplayability,
)
from prop_trading.domain.rd_entry_models_v3 import (
    SelectionReason as DomainSelectionReason,
)

NonNegativeInteger = Annotated[SafeInteger, Field(ge=0)]
PositiveInteger = Annotated[SafeInteger, Field(gt=0)]
Direction = Literal["LONG", "SHORT"]
Fidelity = Literal["EXACT", "CALIBRATED", "DISCRETIONARY", "UNRESOLVED"]
EntryModel = Literal["BOC", "DIR_CLOSE", "HTF_FLIP"]
BocTier = Literal["HTF_TIMED", "DISCRETIONARY_5M"]
CandidateState = Literal["MATCHED", "BLOCKED", "REJECTED"]
ProofPlane = Literal[
    "CONFIRMED_5M",
    "LOWER_TIMEFRAME_REPLAY",
    "REALTIME_TICK",
    "EXTERNAL_ARCHIVED_TICK",
]
Replayability = Literal["REPLAYABLE", "LIVE_EXACT_NON_REPLAYABLE"]
SelectionReason = Literal[
    "ONLY_EXACT_TRIGGER",
    "EARLIEST_EXACT_TRIGGER",
    "FALLBACK_TO_CONFIRMED_CLOSE",
    "CO_TRIGGER_SAME_EVENT",
    "CO_TRIGGER_PRICE_CONFLICT",
    "NO_EXACT_CANDIDATE",
    "SETUP_INVALIDATED",
    "NO_CANDIDATE",
]
SelectionActionValue = Literal["OBSERVE", "PAPER_ELIGIBLE", "SHADOW_ONLY", "NONE"]
PolicyVersion = Literal["rd-entry-arbitration-v3"]


class RDEntryCandleVectorV3(ContractModel):
    open_epoch: NonNegativeInteger
    close_epoch: NonNegativeInteger
    open_ticks: SafeInteger
    high_ticks: SafeInteger
    low_ticks: SafeInteger
    close_ticks: SafeInteger

    @model_validator(mode="after")
    def _chronology_and_ohlc_are_valid(self) -> Self:
        if self.close_epoch <= self.open_epoch:
            raise ValueError("candle epochs must increase")
        if self.high_ticks < max(
            self.open_ticks,
            self.close_ticks,
            self.low_ticks,
        ):
            raise ValueError("candle high is below an OHLC value")
        if self.low_ticks > min(
            self.open_ticks,
            self.close_ticks,
            self.high_ticks,
        ):
            raise ValueError("candle low is above an OHLC value")
        return self


class RDEntryBocProofVectorV3(ContractModel):
    reference_candle: RDEntryCandleVectorV3
    trigger_candle_open_epoch: NonNegativeInteger
    trigger_epoch: NonNegativeInteger
    trigger_sequence: NonNegativeInteger
    trigger_ticks: SafeInteger
    htf_boundary_epoch: NonNegativeInteger | None
    htf_context_minutes: tuple[Literal[15, 30, 60], ...] = Field(max_length=3)
    proof_plane: ProofPlane
    replayability: Replayability
    fidelity: Fidelity
    coverage_start_epoch: NonNegativeInteger
    coverage_end_epoch: NonNegativeInteger
    is_realtime: bool


class RDEntryTriggerProofVectorV3(ContractModel):
    event_anchor_epoch: NonNegativeInteger
    trigger_epoch: NonNegativeInteger
    trigger_sequence: NonNegativeInteger
    trigger_ticks: SafeInteger
    htf_context_minutes: tuple[Literal[15, 30, 60], ...] = Field(max_length=3)
    proof_plane: ProofPlane
    replayability: Replayability
    fidelity: Fidelity
    coverage_start_epoch: NonNegativeInteger
    coverage_end_epoch: NonNegativeInteger
    is_realtime: bool


class RDEntryOpenedSelectionSeedV3(ContractModel):
    confirmed_bar: RDEntryCandleVectorV3
    trigger_sequence: NonNegativeInteger
    revision: NonNegativeInteger
    evaluated_at_epoch: NonNegativeInteger


class RDEntryArbitrationInputV3(ContractModel):
    setup_id: Identifier
    direction: Direction
    zone_engaged_epoch: NonNegativeInteger | None
    common_fidelity: Fidelity
    setup_invalidated: bool
    boc_proof: RDEntryBocProofVectorV3 | None
    directional_close: bool
    confirmed_bar: RDEntryCandleVectorV3 | None
    close_trigger_sequence: NonNegativeInteger
    htf_flip_proof: RDEntryTriggerProofVectorV3 | None
    observed_at_epoch: NonNegativeInteger
    policy_version: PolicyVersion
    revision: NonNegativeInteger
    evaluated_at_epoch: NonNegativeInteger
    opened_selection_seed: RDEntryOpenedSelectionSeedV3 | None

    @model_validator(mode="after")
    def _close_fields_pair(self) -> Self:
        if self.directional_close != (self.confirmed_bar is not None):
            raise ValueError("directional_close and confirmed_bar must pair")
        return self


class RDEntryCandidateVectorV3(ContractModel):
    candidate_id: Sha256
    setup_id: Identifier
    model: EntryModel
    state: CandidateState
    direction: Direction
    event_anchor_epoch: NonNegativeInteger
    trigger_ordinal: PositiveInteger
    boc_tier: BocTier | None
    reference_candle_open_epoch: NonNegativeInteger | None
    source_claim_ids: tuple[Identifier, ...]
    observed_at_epoch: NonNegativeInteger

    @model_validator(mode="after")
    def _canonical_identity_matches(self) -> Self:
        identity = EntryCandidateIdentityV3(
            setup_id=self.setup_id,
            model=DomainEntryModelV3(self.model),
            direction=DomainEntryDirection(self.direction),
            event_anchor_epoch=self.event_anchor_epoch,
            trigger_ordinal=self.trigger_ordinal,
            boc_tier=DomainBocTier(self.boc_tier) if self.boc_tier is not None else None,
            reference_candle_open_epoch=self.reference_candle_open_epoch,
        )
        if self.candidate_id != candidate_id_v3(identity):
            raise ValueError("candidate_id conflicts with canonical identity")
        return self


class RDEntryEvidenceVectorV3(ContractModel):
    evidence_id: Sha256
    candidate_id: Sha256
    observed_trigger_epoch: NonNegativeInteger | None
    trigger_sequence: NonNegativeInteger
    observed_trigger_ticks: SafeInteger | None
    htf_context_minutes: tuple[Literal[15, 30, 60], ...] = Field(max_length=3)
    fidelity: Fidelity
    proof_plane: ProofPlane
    replayability: Replayability
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
    boc_tier: BocTier | None
    reference_candle_open_epoch: NonNegativeInteger | None
    reference_candle_open_ticks: SafeInteger | None
    reference_candle_high_ticks: SafeInteger | None
    reference_candle_low_ticks: SafeInteger | None
    reference_candle_close_ticks: SafeInteger | None
    passed_rule_ids: tuple[Identifier, ...]
    failed_rule_ids: tuple[Identifier, ...]
    source_claim_ids: tuple[Identifier, ...]
    payload_sha256: Sha256
    observed_at_epoch: NonNegativeInteger

    @model_validator(mode="after")
    def _canonical_digests_match(self) -> Self:
        payload_sha256 = evidence_payload_sha256_v3(
            candidate_id=self.candidate_id,
            observed_trigger_epoch=self.observed_trigger_epoch,
            trigger_sequence=self.trigger_sequence,
            observed_trigger_ticks=self.observed_trigger_ticks,
            htf_context_minutes=self.htf_context_minutes,
            fidelity=CandidateFidelity(self.fidelity),
            proof_plane=DomainProofPlane(self.proof_plane),
            replayability=DomainEvidenceReplayability(self.replayability),
            coverage_start_epoch=self.coverage_start_epoch,
            coverage_end_epoch=self.coverage_end_epoch,
            ambiguity_codes=tuple(DomainAmbiguityCode(item) for item in self.ambiguity_codes),
            boc_tier=(DomainBocTier(self.boc_tier) if self.boc_tier is not None else None),
            reference_candle_open_epoch=self.reference_candle_open_epoch,
            reference_candle_open_ticks=self.reference_candle_open_ticks,
            reference_candle_high_ticks=self.reference_candle_high_ticks,
            reference_candle_low_ticks=self.reference_candle_low_ticks,
            reference_candle_close_ticks=self.reference_candle_close_ticks,
            passed_rule_ids=self.passed_rule_ids,
            failed_rule_ids=self.failed_rule_ids,
            source_claim_ids=self.source_claim_ids,
        )
        if self.payload_sha256 != payload_sha256:
            raise ValueError("payload_sha256 conflicts with canonical evidence payload")
        identity = EntryEvidenceIdentityV3(
            candidate_id=self.candidate_id,
            proof_plane=DomainProofPlane(self.proof_plane),
            coverage_start_epoch=self.coverage_start_epoch,
            coverage_end_epoch=self.coverage_end_epoch,
            observed_trigger_epoch=self.observed_trigger_epoch,
            trigger_sequence=self.trigger_sequence,
            payload_sha256=payload_sha256,
        )
        if self.evidence_id != evidence_id_v3(identity):
            raise ValueError("evidence_id conflicts with canonical identity")
        return self


class RDEntrySelectionVectorV3(ContractModel):
    selection_id: Sha256
    setup_id: Identifier
    policy_version: PolicyVersion
    revision: NonNegativeInteger
    candidate_ids_considered: tuple[Sha256, ...]
    canonical_candidate_id: Sha256 | None
    canonical_evidence_id: Sha256 | None
    canonical_model: EntryModel | None
    reason: SelectionReason
    fidelity: Fidelity | None
    action: SelectionActionValue
    co_triggered_models: tuple[EntryModel, ...]
    evaluated_at_epoch: NonNegativeInteger

    @model_validator(mode="after")
    def _canonical_identity_matches(self) -> Self:
        identity = EntrySelectionIdentityV3(
            setup_id=self.setup_id,
            policy_version=POLICY_VERSION_V3,
            revision=self.revision,
            candidate_ids_considered=self.candidate_ids_considered,
            canonical_candidate_id=self.canonical_candidate_id,
            canonical_evidence_id=self.canonical_evidence_id,
            reason=DomainSelectionReason(self.reason),
            fidelity=(CandidateFidelity(self.fidelity) if self.fidelity is not None else None),
            action=SelectionAction(self.action),
            co_triggered_models=tuple(
                DomainEntryModelV3(model) for model in self.co_triggered_models
            ),
        )
        if self.selection_id != selection_id_v3(identity):
            raise ValueError("selection_id conflicts with canonical identity")
        return self


class RDEntryExpectedVectorV3(ContractModel):
    candidates: tuple[RDEntryCandidateVectorV3, ...]
    evidence: tuple[RDEntryEvidenceVectorV3, ...]
    selection: RDEntrySelectionVectorV3

    @model_validator(mode="after")
    def _records_are_sorted_and_owned(self) -> Self:
        candidate_ids = tuple(candidate.candidate_id for candidate in self.candidates)
        evidence_ids = tuple(item.evidence_id for item in self.evidence)
        if candidate_ids != tuple(sorted(candidate_ids)):
            raise ValueError("candidates must be ID-sorted")
        if evidence_ids != tuple(sorted(evidence_ids)):
            raise ValueError("evidence must be ID-sorted")
        if len(candidate_ids) != len(set(candidate_ids)):
            raise ValueError("candidate IDs must be unique")
        if len(evidence_ids) != len(set(evidence_ids)):
            raise ValueError("evidence IDs must be unique")
        if any(item.candidate_id not in set(candidate_ids) for item in self.evidence):
            raise ValueError("evidence references an unknown candidate")
        return self


class RDEntryArbitrationVectorCaseV3(ContractModel):
    case_id: Identifier
    input: RDEntryArbitrationInputV3
    expected: RDEntryExpectedVectorV3


class RDEntryArbitrationVectorsV3(ContractModel):
    schema_id: Literal["phase0.rd-entry-arbitration-vectors.v3"]
    rule_contract_version: Literal["3.0.0"]
    arbitration_policy_version: PolicyVersion
    cases: tuple[RDEntryArbitrationVectorCaseV3, ...] = Field(
        min_length=13,
        max_length=13,
    )

    @model_validator(mode="after")
    def _case_ids_are_unique(self) -> Self:
        case_ids = tuple(case.case_id for case in self.cases)
        if len(case_ids) != len(set(case_ids)):
            raise ValueError("case IDs must be unique")
        return self
