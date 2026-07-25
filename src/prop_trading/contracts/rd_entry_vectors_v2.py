"""Strict schema model for scanner-free RD entry arbitration vectors."""

from __future__ import annotations

from itertools import pairwise
from typing import Annotated, Literal

from pydantic import Field, model_validator

from prop_trading.contracts.models import (
    ContractModel,
    Identifier,
    SafeInteger,
    Sha256,
)
from prop_trading.domain.rd_entry_models import (
    AmbiguityCode as DomainAmbiguityCode,
)
from prop_trading.domain.rd_entry_models import (
    CandidateFidelity,
    evidence_payload_sha256,
)
from prop_trading.domain.rd_entry_models import (
    ProofPlane as DomainProofPlane,
)

NonNegativeInteger = Annotated[SafeInteger, Field(ge=0)]
PositiveInteger = Annotated[SafeInteger, Field(gt=0)]
ContextMinutes = Literal[15, 30, 60]
PolicyVersion = Literal["rd-entry-arbitration-v2"]
Direction = Literal["LONG", "SHORT"]
Fidelity = Literal["EXACT", "CALIBRATED", "DISCRETIONARY", "UNRESOLVED"]
AttemptKind = Literal["INITIAL", "RE_ENTRY"]
TerminalReason = Literal[
    "INVALIDATED",
    "BOTH_ACTIVE_MODELS_OBSERVED",
    "RETENTION_EVICTED",
]
EntryModel = Literal[
    "DIR_CLOSE",
    "HTF_FLIP",
    "LEGACY_BREAK_CANDLE",
    "LEGACY_REJECTION_RESPECT",
]
CandidateState = Literal["MATCHED", "BLOCKED", "REJECTED", "NORMALIZED"]
ProofPlane = Literal[
    "CONFIRMED_5M",
    "LOWER_TIMEFRAME_REPLAY",
    "REALTIME_TICK",
    "EXTERNAL_ARCHIVED_TICK",
]
HandlingMode = Literal[
    "CLOSE_CONFIRMATION",
    "INTRABAR_FLIP",
    "NEXT_CANDLE_WICK",
    "AGGRESSIVE",
]
AmbiguityCode = Literal[
    "SHADOW_SAME_CHILD_BAR_ORDER",
    "SHADOW_MISSING_INTRABAR_COVERAGE",
    "SHADOW_REALTIME_ONLY_NOT_REPLAYABLE",
]
SelectionReason = Literal[
    "ONLY_EXACT_TRIGGER",
    "EARLIEST_EXACT_TRIGGER",
    "FALLBACK_TO_CONFIRMED_CLOSE",
    "NO_EXACT_CANDIDATE",
    "UNRESOLVED_SOURCE_PRIORITY",
    "SETUP_INVALIDATED",
    "NO_CANDIDATE",
]
SelectionAction = Literal[
    "OBSERVE",
    "PAPER_ELIGIBLE",
    "SHADOW_ONLY",
    "NONE",
]


class RDEntryCandleVectorV2(ContractModel):
    open_epoch: NonNegativeInteger
    close_epoch: NonNegativeInteger
    open_ticks: SafeInteger
    high_ticks: SafeInteger
    low_ticks: SafeInteger
    close_ticks: SafeInteger

    @model_validator(mode="after")
    def _chronology_and_ohlc_are_valid(self) -> RDEntryCandleVectorV2:
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


class RDEntrySetupVectorV2(ContractModel):
    setup_id: Identifier
    direction: Direction
    zone_top_ticks: SafeInteger
    zone_bottom_ticks: SafeInteger
    zone_engaged_epoch: NonNegativeInteger | None
    invalidated_before_entry: bool
    common_fidelity: Fidelity
    terminal_reason: TerminalReason | None
    terminal_epoch: NonNegativeInteger | None

    @model_validator(mode="after")
    def _zone_and_terminal_are_consistent(self) -> RDEntrySetupVectorV2:
        if self.zone_top_ticks <= self.zone_bottom_ticks:
            raise ValueError("zone top must be above zone bottom")
        if (self.terminal_reason is None) != (self.terminal_epoch is None):
            raise ValueError("terminal reason and epoch must occur together")
        if self.invalidated_before_entry and self.terminal_reason != "INVALIDATED":
            raise ValueError("pre-entry invalidation requires INVALIDATED terminal")
        if (
            self.zone_engaged_epoch is not None
            and self.terminal_epoch is not None
            and self.terminal_epoch < self.zone_engaged_epoch
        ):
            raise ValueError("terminal epoch precedes zone engagement")
        return self


class RDEntryHTFTranscriptVectorV2(ContractModel):
    context_minutes: ContextMinutes
    htf_open_epoch: NonNegativeInteger
    htf_open_ticks: SafeInteger
    scan_cutoff_epoch: NonNegativeInteger
    proof_resolution_seconds: PositiveInteger
    coverage_start_epoch: NonNegativeInteger
    coverage_end_epoch: NonNegativeInteger
    expected_child_count: NonNegativeInteger
    observed_child_count: NonNegativeInteger
    gap_present: bool
    full_lifecycle_ordered: bool
    destination_seen_before_contact: bool
    contact_candle: RDEntryCandleVectorV2 | None
    recross_candle: RDEntryCandleVectorV2 | None
    same_child: bool

    @model_validator(mode="after")
    def _coverage_and_retained_children_are_consistent(
        self,
    ) -> RDEntryHTFTranscriptVectorV2:
        if self.coverage_start_epoch != self.htf_open_epoch:
            raise ValueError("coverage start must equal HTF open")
        if self.coverage_end_epoch != self.scan_cutoff_epoch:
            raise ValueError("coverage end must equal scan cutoff")
        if self.coverage_end_epoch <= self.coverage_start_epoch:
            raise ValueError("transcript coverage must increase")
        resolution = self.proof_resolution_seconds
        if resolution >= 300 or 300 % resolution:
            raise ValueError("proof resolution must divide five minutes")
        coverage = self.coverage_end_epoch - self.coverage_start_epoch
        if coverage % resolution:
            raise ValueError("coverage must align to proof resolution")
        if self.expected_child_count != coverage // resolution:
            raise ValueError("expected child count disagrees with coverage")
        if not 0 <= self.observed_child_count <= self.expected_child_count:
            raise ValueError("observed child count is outside coverage")
        if self.gap_present != (self.observed_child_count != self.expected_child_count):
            raise ValueError("gap flag disagrees with child counts")
        if self.recross_candle is not None and self.contact_candle is None:
            raise ValueError("recross requires retained contact")
        same_interval = (
            self.contact_candle is not None
            and self.recross_candle is not None
            and self.contact_candle.open_epoch == self.recross_candle.open_epoch
            and self.contact_candle.close_epoch == self.recross_candle.close_epoch
        )
        if self.same_child != same_interval:
            raise ValueError("same_child disagrees with retained intervals")
        return self


class RDEntryMatchRequestVectorV2(ContractModel):
    setup: RDEntrySetupVectorV2
    confirmed_bar: RDEntryCandleVectorV2
    htf_proofs: tuple[RDEntryHTFTranscriptVectorV2, ...] = Field(max_length=3)
    generic_break_detected: bool
    rejection_respect_detected: bool
    attempt_kind: AttemptKind
    trigger_ordinal: PositiveInteger

    @model_validator(mode="after")
    def _attempt_and_proofs_are_bounded(self) -> RDEntryMatchRequestVectorV2:
        if self.confirmed_bar.close_epoch - self.confirmed_bar.open_epoch != 300:
            raise ValueError("confirmed bar must span five minutes")
        if self.attempt_kind == "INITIAL" and self.trigger_ordinal != 1:
            raise ValueError("INITIAL attempts require ordinal 1")
        if self.attempt_kind == "RE_ENTRY" and self.trigger_ordinal < 2:
            raise ValueError("RE_ENTRY attempts require ordinal 2 or greater")
        contexts = [item.context_minutes for item in self.htf_proofs]
        if len(contexts) != len(set(contexts)):
            raise ValueError("HTF proof contexts must be unique")
        return self


class RDEntryHTFScanRequestVectorV2(ContractModel):
    timeframe_minutes: ContextMinutes
    htf_open_epoch: NonNegativeInteger
    scan_cutoff_epoch: NonNegativeInteger
    htf_open_ticks: SafeInteger
    children: tuple[RDEntryCandleVectorV2, ...] = Field(max_length=3_600)
    proof_resolution_seconds: PositiveInteger
    full_lifecycle_ordered: bool

    @model_validator(mode="after")
    def _scan_bounds_and_order_are_valid(self) -> RDEntryHTFScanRequestVectorV2:
        coverage = self.scan_cutoff_epoch - self.htf_open_epoch
        if not 0 < coverage <= self.timeframe_minutes * 60:
            raise ValueError("scan cutoff lies outside HTF context")
        if coverage % 300:
            raise ValueError("scan cutoff must align to five minutes")
        if (
            self.proof_resolution_seconds >= 300
            or 300 % self.proof_resolution_seconds
            or coverage % self.proof_resolution_seconds
        ):
            raise ValueError("scan proof resolution is invalid")
        opens = [item.open_epoch for item in self.children]
        if any(left >= right for left, right in pairwise(opens)):
            raise ValueError("scan children must be ordered oldest-first")
        return self


class RDEntryRawEventVectorV2(ContractModel):
    event_id: Identifier
    match_request: RDEntryMatchRequestVectorV2
    htf_scan_requests: tuple[RDEntryHTFScanRequestVectorV2, ...] = Field(max_length=3)

    @model_validator(mode="after")
    def _proof_surface_is_not_mixed(self) -> RDEntryRawEventVectorV2:
        if self.match_request.htf_proofs and self.htf_scan_requests:
            raise ValueError("raw scans and expanded proofs cannot be mixed")
        contexts = [item.timeframe_minutes for item in self.htf_scan_requests]
        if len(contexts) != len(set(contexts)):
            raise ValueError("raw scan contexts must be unique")
        return self


class RDEntryEdgeEventVectorV2(ContractModel):
    event_id: Identifier
    match_request: RDEntryMatchRequestVectorV2


class RDEntryRawInputVectorV2(ContractModel):
    setup_id: Identifier
    events: tuple[RDEntryRawEventVectorV2, ...]
    setup_invalidated: bool
    policy_version: PolicyVersion
    revision: NonNegativeInteger
    evaluated_at_epoch: NonNegativeInteger


class RDEntryEdgeInputVectorV2(ContractModel):
    setup_id: Identifier
    events: tuple[RDEntryEdgeEventVectorV2, ...]
    setup_invalidated: bool
    policy_version: PolicyVersion
    revision: NonNegativeInteger
    evaluated_at_epoch: NonNegativeInteger


class RDEntryCandidateVectorV2(ContractModel):
    candidate_id: Sha256
    setup_id: Identifier
    model: EntryModel
    state: CandidateState
    event_anchor_epoch: NonNegativeInteger
    trigger_ordinal: PositiveInteger
    direction: Direction
    source_claim_ids: tuple[Identifier, ...]
    normalized_from: EntryModel | None
    observed_at_epoch: NonNegativeInteger


class RDEntryEvidenceVectorV2(ContractModel):
    evidence_id: Sha256
    candidate_id: Sha256
    observed_trigger_epoch: NonNegativeInteger | None
    observed_trigger_ticks: SafeInteger | None
    htf_context_minutes: tuple[ContextMinutes, ...] = Field(max_length=3)
    fidelity: Fidelity
    proof_plane: ProofPlane
    proof_resolution_seconds: PositiveInteger
    coverage_start_epoch: NonNegativeInteger
    coverage_end_epoch: NonNegativeInteger
    ambiguity_codes: tuple[AmbiguityCode, ...]
    passed_rule_ids: tuple[Identifier, ...]
    failed_rule_ids: tuple[Identifier, ...]
    source_claim_ids: tuple[Identifier, ...]
    payload_sha256: Sha256
    observed_at_epoch: NonNegativeInteger

    @model_validator(mode="after")
    def _evidence_pairs_and_contexts_are_valid(
        self,
    ) -> RDEntryEvidenceVectorV2:
        if (self.observed_trigger_epoch is None) != (self.observed_trigger_ticks is None):
            raise ValueError("observed trigger epoch and ticks must pair")
        if self.coverage_end_epoch <= self.coverage_start_epoch:
            raise ValueError("evidence coverage must increase")
        if tuple(sorted(self.htf_context_minutes)) != self.htf_context_minutes:
            raise ValueError("HTF contexts must be sorted")
        if len(set(self.htf_context_minutes)) != len(self.htf_context_minutes):
            raise ValueError("HTF contexts must be unique")
        authoritative_payload_sha256 = evidence_payload_sha256(
            candidate_id=self.candidate_id,
            observed_trigger_epoch=self.observed_trigger_epoch,
            observed_trigger_ticks=self.observed_trigger_ticks,
            htf_context_minutes=self.htf_context_minutes,
            fidelity=CandidateFidelity(self.fidelity),
            proof_plane=DomainProofPlane(self.proof_plane),
            proof_resolution_seconds=self.proof_resolution_seconds,
            coverage_start_epoch=self.coverage_start_epoch,
            coverage_end_epoch=self.coverage_end_epoch,
            ambiguity_codes=tuple(DomainAmbiguityCode(item) for item in self.ambiguity_codes),
            passed_rule_ids=self.passed_rule_ids,
            failed_rule_ids=self.failed_rule_ids,
            source_claim_ids=self.source_claim_ids,
        )
        if self.payload_sha256 != authoritative_payload_sha256:
            raise ValueError("payload_sha256 conflicts with its expanded payload digest")
        return self


class RDEntryHandlingVectorV2(ContractModel):
    handling_id: Sha256
    candidate_id: Sha256
    evidence_id: Sha256
    handling_mode: HandlingMode
    attempt_kind: AttemptKind
    observed_epoch: NonNegativeInteger
    observed_ticks: SafeInteger | None
    fidelity: Fidelity
    source_claim_ids: tuple[Identifier, ...]


class RDEntrySelectionVectorV2(ContractModel):
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
    action: SelectionAction
    evaluated_at_epoch: NonNegativeInteger

    @model_validator(mode="after")
    def _canonical_selection_fields_pair(self) -> RDEntrySelectionVectorV2:
        if (self.canonical_candidate_id is None) != (self.canonical_evidence_id is None):
            raise ValueError("canonical candidate and evidence must pair")
        if tuple(sorted(self.candidate_ids_considered)) != (self.candidate_ids_considered):
            raise ValueError("candidate IDs considered must be sorted")
        if len(set(self.candidate_ids_considered)) != len(self.candidate_ids_considered):
            raise ValueError("candidate IDs considered must be unique")
        return self


class RDEntryExpectedVectorV2(ContractModel):
    htf_transcripts: tuple[RDEntryHTFTranscriptVectorV2, ...] = Field(max_length=3)
    candidates: tuple[RDEntryCandidateVectorV2, ...]
    evidence: tuple[RDEntryEvidenceVectorV2, ...]
    handling: tuple[RDEntryHandlingVectorV2, ...]
    selection: RDEntrySelectionVectorV2

    @model_validator(mode="after")
    def _records_are_sorted_and_owned(self) -> RDEntryExpectedVectorV2:
        contexts = tuple(item.context_minutes for item in self.htf_transcripts)
        if contexts != tuple(sorted(contexts)) or len(set(contexts)) != len(contexts):
            raise ValueError("transcripts must be context-sorted and unique")
        candidate_ids = tuple(item.candidate_id for item in self.candidates)
        evidence_ids = tuple(item.evidence_id for item in self.evidence)
        handling_ids = tuple(item.handling_id for item in self.handling)
        if candidate_ids != tuple(sorted(candidate_ids)):
            raise ValueError("candidates must be ID-sorted")
        if len(candidate_ids) != len(set(candidate_ids)):
            raise ValueError("candidate IDs must be unique")
        if evidence_ids != tuple(sorted(evidence_ids)):
            raise ValueError("evidence must be ID-sorted")
        if len(evidence_ids) != len(set(evidence_ids)):
            raise ValueError("evidence IDs must be unique")
        if handling_ids != tuple(sorted(handling_ids)):
            raise ValueError("handling must be ID-sorted")
        if len(handling_ids) != len(set(handling_ids)):
            raise ValueError("handling IDs must be unique")
        candidate_set = set(candidate_ids)
        evidence_set = set(evidence_ids)
        if any(item.candidate_id not in candidate_set for item in self.evidence):
            raise ValueError("evidence references an unknown candidate")
        if any(
            item.candidate_id not in candidate_set or item.evidence_id not in evidence_set
            for item in self.handling
        ):
            raise ValueError("handling references an unknown record")
        return self


def _event_id_map(
    events: tuple[RDEntryRawEventVectorV2, ...] | tuple[RDEntryEdgeEventVectorV2, ...],
) -> dict[str, RDEntryRawEventVectorV2 | RDEntryEdgeEventVectorV2]:
    values: dict[
        str,
        RDEntryRawEventVectorV2 | RDEntryEdgeEventVectorV2,
    ] = {}
    for event in events:
        previous = values.get(event.event_id)
        if previous is not None and previous != event:
            raise ValueError("event ID carries conflicting immutable content")
        values[event.event_id] = event
    return values


class RDEntryArbitrationVectorCaseV2(ContractModel):
    case_id: Identifier
    setup_id: Identifier
    symbol: Identifier
    feed: Identifier
    calculation_start_epoch: NonNegativeInteger
    emission_start_epoch: NonNegativeInteger
    emission_end_epoch: NonNegativeInteger
    pine_supported: bool
    input: RDEntryRawInputVectorV2
    edge_input: RDEntryEdgeInputVectorV2
    pine_edge_input: RDEntryEdgeInputVectorV2
    expected: RDEntryExpectedVectorV2
    pine_expected: RDEntryExpectedVectorV2

    @model_validator(mode="after")
    def _metadata_and_views_are_consistent(
        self,
    ) -> RDEntryArbitrationVectorCaseV2:
        if not (
            self.calculation_start_epoch <= self.emission_start_epoch <= self.emission_end_epoch
        ):
            raise ValueError("replay metadata epochs are out of order")
        inputs = (self.input, self.edge_input, self.pine_edge_input)
        if any(item.setup_id != self.setup_id for item in inputs):
            raise ValueError("input setup IDs must match vector setup ID")
        if any(item.policy_version != "rd-entry-arbitration-v2" for item in inputs):
            raise ValueError("all vector views must use the frozen policy")
        if self.expected.selection.setup_id != self.setup_id or (
            self.pine_expected.selection.setup_id != self.setup_id
        ):
            raise ValueError("selection setup ID must match vector setup ID")
        if self.pine_expected.selection.action == "PAPER_ELIGIBLE":
            raise ValueError("current Pine expectation must be non-promotable")
        _event_id_map(self.input.events)
        _event_id_map(self.edge_input.events)
        _event_id_map(self.pine_edge_input.events)
        raw_ids = tuple(item.event_id for item in self.input.events)
        if raw_ids != tuple(item.event_id for item in self.edge_input.events):
            raise ValueError("Edge event IDs must preserve raw order")
        if raw_ids != tuple(item.event_id for item in self.pine_edge_input.events):
            raise ValueError("Pine event IDs must preserve raw order")
        for item in inputs:
            for event in item.events:
                request = event.match_request
                if request.setup.setup_id != self.setup_id:
                    raise ValueError("event setup ID must match vector setup ID")
                close_epoch = request.confirmed_bar.close_epoch
                if not (self.emission_start_epoch <= close_epoch <= self.emission_end_epoch):
                    raise ValueError("event close lies outside emission window")
        if any(
            event.match_request.setup.common_fidelity != "UNRESOLVED"
            for event in self.pine_edge_input.events
        ):
            raise ValueError("Pine input common fidelity must be UNRESOLVED")
        return self


class RDEntryArbitrationVectorsV2(ContractModel):
    schema_id: Literal["phase0.rd-entry-arbitration-vectors.v2"]
    cases: tuple[RDEntryArbitrationVectorCaseV2, ...] = Field(
        min_length=24,
        max_length=24,
    )

    @model_validator(mode="after")
    def _case_and_attempt_scopes_are_closed(
        self,
    ) -> RDEntryArbitrationVectorsV2:
        case_ids = [item.case_id for item in self.cases]
        if len(case_ids) != len(set(case_ids)):
            raise ValueError("vector case IDs must be unique")
        setup_attempts: dict[str, set[str]] = {}
        for case in self.cases:
            for event in case.input.events:
                setup_attempts.setdefault(case.setup_id, set()).add(
                    event.match_request.attempt_kind
                )
        if any(len(kinds) > 1 for kinds in setup_attempts.values()):
            raise ValueError("setup ID cannot span initial and re-entry attempts")
        unsupported = {item.case_id for item in self.cases if not item.pine_supported}
        if unsupported != {
            "re-entry-attempt",
            "replay-realtime-one-candidate",
        }:
            raise ValueError("pine_supported case set is not frozen")
        return self
