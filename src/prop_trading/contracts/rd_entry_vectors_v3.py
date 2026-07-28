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
    OrderedCandle,
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
    EntryCandidateEvidenceV3,
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

    @model_validator(mode="after")
    def _five_minute_causality_is_valid(self) -> Self:
        if (
            self.reference_candle.close_epoch - self.reference_candle.open_epoch != 300
            or self.reference_candle.open_epoch % 300 != 0
        ):
            raise ValueError("BOC reference candle must be an aligned five-minute candle")
        if self.trigger_candle_open_epoch % 300 != 0:
            raise ValueError("BOC trigger candle must align to five minutes")
        if self.reference_candle.close_epoch > self.trigger_candle_open_epoch:
            raise ValueError("BOC reference candle must precede trigger candle")
        if not (
            self.trigger_candle_open_epoch
            <= self.trigger_epoch
            < self.trigger_candle_open_epoch + 300
        ):
            raise ValueError("BOC trigger must be inside its five-minute candle")
        return self


class RDEntryTriggerProofVectorV3(ContractModel):
    event_anchor_epoch: NonNegativeInteger
    trigger_epoch: NonNegativeInteger
    trigger_sequence: NonNegativeInteger
    trigger_ticks: SafeInteger
    htf_open_ticks: SafeInteger
    htf_context_minutes: tuple[Literal[15, 30, 60], ...] = Field(max_length=3)
    proof_plane: ProofPlane
    replayability: Replayability
    fidelity: Fidelity
    coverage_start_epoch: NonNegativeInteger
    coverage_end_epoch: NonNegativeInteger
    is_realtime: bool
    contact_candle: RDEntryCandleVectorV3 | None
    recross_candle: RDEntryCandleVectorV3 | None
    coverage_gap_detected: bool
    full_lifecycle_ordered: bool
    destination_seen_before_contact: bool
    ambiguity_codes: tuple[
        Literal[
            "SHADOW_SAME_CHILD_BAR_ORDER",
            "SHADOW_MISSING_INTRABAR_COVERAGE",
            "SHADOW_REALTIME_ONLY_NOT_REPLAYABLE",
        ],
        ...,
    ]

    @model_validator(mode="after")
    def _htf_anchor_chronology_is_valid(self) -> Self:
        if (
            self.contact_candle is not None
            and self.event_anchor_epoch > self.contact_candle.open_epoch
        ):
            raise ValueError("HTF anchor must precede contact")
        if self.htf_context_minutes and any(
            self.trigger_epoch >= self.event_anchor_epoch + context * 60
            for context in self.htf_context_minutes
        ):
            raise ValueError("trigger must remain inside every HTF context")
        return self


class RDEntryOpenedSelectionSeedV3(ContractModel):
    confirmed_bar: RDEntryCandleVectorV3
    trigger_sequence: NonNegativeInteger
    revision: NonNegativeInteger
    evaluated_at_epoch: NonNegativeInteger


class RDEntryArbitrationInputV3(ContractModel):
    setup_id: Identifier
    direction: Direction
    zone_top_ticks: SafeInteger
    zone_bottom_ticks: SafeInteger
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
        if self.zone_top_ticks <= self.zone_bottom_ticks:
            raise ValueError("zone top must be above zone bottom")
        if self.confirmed_bar is not None and (
            self.confirmed_bar.close_epoch - self.confirmed_bar.open_epoch != 300
        ):
            raise ValueError("confirmed close must be a 300-second candle")
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
    htf_open_ticks: SafeInteger | None
    contact_candle: RDEntryCandleVectorV3 | None
    recross_candle: RDEntryCandleVectorV3 | None
    coverage_gap_detected: bool | None
    full_lifecycle_ordered: bool | None
    destination_seen_before_contact: bool | None
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
            htf_open_ticks=self.htf_open_ticks,
            contact_candle=(
                OrderedCandle(
                    open_epoch=self.contact_candle.open_epoch,
                    close_epoch=self.contact_candle.close_epoch,
                    open_ticks=self.contact_candle.open_ticks,
                    high_ticks=self.contact_candle.high_ticks,
                    low_ticks=self.contact_candle.low_ticks,
                    close_ticks=self.contact_candle.close_ticks,
                )
                if self.contact_candle is not None
                else None
            ),
            recross_candle=(
                OrderedCandle(
                    open_epoch=self.recross_candle.open_epoch,
                    close_epoch=self.recross_candle.close_epoch,
                    open_ticks=self.recross_candle.open_ticks,
                    high_ticks=self.recross_candle.high_ticks,
                    low_ticks=self.recross_candle.low_ticks,
                    close_ticks=self.recross_candle.close_ticks,
                )
                if self.recross_candle is not None
                else None
            ),
            coverage_gap_detected=self.coverage_gap_detected,
            full_lifecycle_ordered=self.full_lifecycle_ordered,
            destination_seen_before_contact=self.destination_seen_before_contact,
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
        EntryCandidateEvidenceV3(
            evidence_id=self.evidence_id,
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
            htf_open_ticks=self.htf_open_ticks,
            contact_candle=(
                OrderedCandle(**self.contact_candle.model_dump())
                if self.contact_candle is not None
                else None
            ),
            recross_candle=(
                OrderedCandle(**self.recross_candle.model_dump())
                if self.recross_candle is not None
                else None
            ),
            coverage_gap_detected=self.coverage_gap_detected,
            full_lifecycle_ordered=self.full_lifecycle_ordered,
            destination_seen_before_contact=self.destination_seen_before_contact,
            passed_rule_ids=self.passed_rule_ids,
            failed_rule_ids=self.failed_rule_ids,
            source_claim_ids=self.source_claim_ids,
            payload_sha256=self.payload_sha256,
            observed_at_epoch=self.observed_at_epoch,
        )
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
        if self.selection.candidate_ids_considered != candidate_ids:
            raise ValueError("selection candidate IDs considered must match candidate records")
        if any(
            candidate.observed_at_epoch > self.selection.evaluated_at_epoch
            for candidate in self.candidates
        ) or any(
            item.observed_at_epoch > self.selection.evaluated_at_epoch for item in self.evidence
        ):
            raise ValueError("records cannot be observed after selection evaluation")

        candidate_by_id = {candidate.candidate_id: candidate for candidate in self.candidates}
        evidence_by_id = {item.evidence_id: item for item in self.evidence}
        expected_rules = {
            "BOC": "ENTRY_BOC_HTF_TIMED",
            "DIR_CLOSE": "ENTRY_DIR_CLOSE",
            "HTF_FLIP": "ENTRY_HTF_FLIP",
        }
        for item in self.evidence:
            candidate = candidate_by_id[item.candidate_id]
            if item.fidelity != "EXACT":
                continue
            if item.passed_rule_ids != (expected_rules[candidate.model],) or item.failed_rule_ids:
                raise ValueError("exact evidence rule result conflicts with candidate model")
            if candidate.model == "DIR_CLOSE" and (
                item.coverage_end_epoch - item.coverage_start_epoch != 300
                or item.observed_trigger_epoch != item.coverage_end_epoch
            ):
                raise ValueError("exact close evidence must cover one five-minute bar")
            if candidate.model == "BOC":
                assert item.reference_candle_open_epoch is not None
                assert item.observed_trigger_epoch is not None
                trigger_open = (item.observed_trigger_epoch // 300) * 300
                if (
                    item.reference_candle_open_epoch + 300 > trigger_open
                    or not item.htf_context_minutes
                    or any(
                        trigger_open % (context * 60) != 0 for context in item.htf_context_minutes
                    )
                ):
                    raise ValueError("exact BOC evidence violates causal HTF timing")
            if candidate.model == "HTF_FLIP":
                if (
                    item.htf_open_ticks is None
                    or item.contact_candle is None
                    or item.recross_candle is None
                    or item.coverage_gap_detected is not False
                    or item.full_lifecycle_ordered is not True
                    or item.destination_seen_before_contact is not False
                ):
                    raise ValueError("exact flip evidence lacks ordered lifecycle proof")
                contact_crossed = (
                    item.contact_candle.high_ticks > item.htf_open_ticks
                    if candidate.direction == "LONG"
                    else item.contact_candle.low_ticks < item.htf_open_ticks
                )
                if contact_crossed:
                    raise ValueError("flip contact already crossed the HTF open")
                actual_close_crossed = (
                    item.recross_candle.close_ticks > item.htf_open_ticks
                    if candidate.direction == "LONG"
                    else item.recross_candle.close_ticks < item.htf_open_ticks
                )
                if not actual_close_crossed:
                    raise ValueError("flip actual close did not cross the HTF open")
        canonical_candidate_id = self.selection.canonical_candidate_id
        canonical_evidence_id = self.selection.canonical_evidence_id
        if canonical_candidate_id is None:
            if self.selection.canonical_model is not None or self.selection.fidelity is not None:
                raise ValueError("empty canonical selection cannot carry model or fidelity")
            return self
        canonical_candidate = candidate_by_id.get(canonical_candidate_id)
        if canonical_candidate is None:
            raise ValueError("canonical candidate is absent from candidate records")
        assert canonical_evidence_id is not None
        canonical_evidence = evidence_by_id.get(canonical_evidence_id)
        if canonical_evidence is None:
            raise ValueError("canonical evidence is absent from evidence records")
        if canonical_evidence.candidate_id != canonical_candidate_id:
            raise ValueError("canonical evidence ownership conflicts with candidate")
        if self.selection.canonical_model != canonical_candidate.model:
            raise ValueError("canonical model conflicts with candidate")
        if self.selection.fidelity != canonical_evidence.fidelity:
            raise ValueError("canonical fidelity conflicts with evidence")
        if self.selection.action == "PAPER_ELIGIBLE" and (
            canonical_candidate.state != "MATCHED"
            or canonical_evidence.fidelity != "EXACT"
            or canonical_evidence.failed_rule_ids
            or canonical_evidence.passed_rule_ids != (expected_rules[canonical_candidate.model],)
        ):
            raise ValueError("paper eligible selection requires matched exact evidence")
        if canonical_candidate.model == "HTF_FLIP":
            assert canonical_evidence.contact_candle is not None
            assert canonical_evidence.observed_trigger_epoch is not None
            if (
                canonical_candidate.event_anchor_epoch
                > canonical_evidence.contact_candle.open_epoch
                or not canonical_evidence.htf_context_minutes
                or any(
                    canonical_evidence.observed_trigger_epoch
                    >= canonical_candidate.event_anchor_epoch + context * 60
                    for context in canonical_evidence.htf_context_minutes
                )
            ):
                raise ValueError("canonical flip violates HTF anchor chronology")
        return self


class RDEntryArbitrationVectorCaseV3(ContractModel):
    case_id: Identifier
    input: RDEntryArbitrationInputV3
    expected: RDEntryExpectedVectorV3

    @model_validator(mode="after")
    def _setup_identity_matches(self) -> Self:
        if self.expected.selection.setup_id != self.input.setup_id or any(
            candidate.setup_id != self.input.setup_id for candidate in self.expected.candidates
        ):
            raise ValueError("case setup identity is inconsistent")
        return self


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
