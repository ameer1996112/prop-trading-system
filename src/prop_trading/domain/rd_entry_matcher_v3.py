"""Pure matcher for independent RD BOC, directional-close, and HTF-flip facts."""

from __future__ import annotations

from dataclasses import dataclass

from prop_trading.contracts.rd_strategy_v3 import RDStrategyRuleContractV3
from prop_trading.domain.rd_entry_models import (
    CandidateFidelity,
    CandidateState,
    EntryDirection,
    OrderedCandle,
    ProofPlane,
)
from prop_trading.domain.rd_entry_models_v3 import (
    BocProof,
    BocTier,
    EntryCandidateEvidenceV3,
    EntryCandidateIdentityV3,
    EntryCandidateV3,
    EntryEvidenceIdentityV3,
    EntryModelV3,
    EntryTriggerProofV3,
    EvidenceReplayability,
    candidate_id_v3,
    evidence_id_v3,
    evidence_payload_sha256_v3,
)


def _require_int(value: object, name: str, *, non_negative: bool = False) -> None:
    if type(value) is not int:
        raise ValueError(f"{name} must be an integer (bool is not allowed)")
    if non_negative and value < 0:
        raise ValueError(f"{name} must be non-negative")


def _require_bool(value: object, name: str) -> None:
    if type(value) is not bool:
        raise ValueError(f"{name} must be a bool")


@dataclass(frozen=True, slots=True)
class SetupEntryFactsV3:
    setup_id: str
    direction: EntryDirection
    zone_engaged_epoch: int | None
    invalidated_before_entry: bool
    common_fidelity: CandidateFidelity

    def __post_init__(self) -> None:
        if not isinstance(self.setup_id, str) or not self.setup_id.strip():
            raise ValueError("setup_id must be a non-empty string")
        if not isinstance(self.direction, EntryDirection):
            raise ValueError("direction must be an EntryDirection")
        if self.zone_engaged_epoch is not None:
            _require_int(self.zone_engaged_epoch, "zone_engaged_epoch", non_negative=True)
        _require_bool(self.invalidated_before_entry, "invalidated_before_entry")
        if not isinstance(self.common_fidelity, CandidateFidelity):
            raise ValueError("common_fidelity must be a CandidateFidelity")


@dataclass(frozen=True, slots=True)
class EntryMatchRequestV3:
    setup: SetupEntryFactsV3
    rule_contract: RDStrategyRuleContractV3
    boc_proof: BocProof | None
    directional_close: bool
    confirmed_bar: OrderedCandle | None
    close_trigger_sequence: int
    htf_flip_proof: EntryTriggerProofV3 | None
    observed_at_epoch: int

    def __post_init__(self) -> None:
        if not isinstance(self.setup, SetupEntryFactsV3):
            raise ValueError("setup must be SetupEntryFactsV3")
        if not isinstance(self.rule_contract, RDStrategyRuleContractV3):
            raise ValueError("rule_contract must be RDStrategyRuleContractV3")
        if self.rule_contract.automation_policy.arbitration_policy_version != (
            "rd-entry-arbitration-v3"
        ):
            raise ValueError("rule contract must authorize rd-entry-arbitration-v3")
        if self.boc_proof is not None and not isinstance(self.boc_proof, BocProof):
            raise ValueError("boc_proof must be BocProof or None")
        _require_bool(self.directional_close, "directional_close")
        if self.confirmed_bar is not None and not isinstance(
            self.confirmed_bar,
            OrderedCandle,
        ):
            raise ValueError("confirmed_bar must be OrderedCandle or None")
        if self.directional_close and self.confirmed_bar is None:
            raise ValueError("directional_close requires confirmed_bar")
        _require_int(
            self.close_trigger_sequence,
            "close_trigger_sequence",
            non_negative=True,
        )
        if self.htf_flip_proof is not None and not isinstance(
            self.htf_flip_proof,
            EntryTriggerProofV3,
        ):
            raise ValueError("htf_flip_proof must be EntryTriggerProofV3 or None")
        _require_int(self.observed_at_epoch, "observed_at_epoch", non_negative=True)


@dataclass(frozen=True, slots=True)
class EntryMatchResultV3:
    candidates: tuple[EntryCandidateV3, ...]
    evidence: tuple[EntryCandidateEvidenceV3, ...]


@dataclass(frozen=True, slots=True)
class _EvidenceFields:
    observed_trigger_epoch: int
    trigger_sequence: int
    observed_trigger_ticks: int
    htf_context_minutes: tuple[int, ...]
    fidelity: CandidateFidelity
    proof_plane: ProofPlane
    replayability: EvidenceReplayability
    coverage_start_epoch: int
    coverage_end_epoch: int
    boc_tier: BocTier | None
    reference_candle: OrderedCandle | None
    passed_rule_ids: tuple[str, ...]
    failed_rule_ids: tuple[str, ...]
    source_claim_ids: tuple[str, ...]


def _boc_breaks_reference(direction: EntryDirection, proof: BocProof) -> bool:
    if direction is EntryDirection.LONG:
        return proof.trigger_ticks > proof.reference_candle.high_ticks
    return proof.trigger_ticks < proof.reference_candle.low_ticks


def _strict_boc_context(proof: BocProof) -> bool:
    return (
        proof.htf_boundary_epoch == proof.trigger_candle_open_epoch
        and bool(proof.htf_context_minutes)
        and all(context in {15, 30, 60} for context in proof.htf_context_minutes)
        and all(
            proof.htf_boundary_epoch % (context * 60) == 0 for context in proof.htf_context_minutes
        )
    )


def _claims(request: EntryMatchRequestV3, rule_id: str) -> tuple[str, ...]:
    return request.rule_contract.rules_by_id[rule_id].source_claim_ids


def _common_failure(
    setup: SetupEntryFactsV3,
    trigger_epoch: int,
) -> tuple[CandidateState, tuple[str, ...]] | None:
    if setup.common_fidelity is not CandidateFidelity.EXACT:
        return CandidateState.BLOCKED, ("COMMON_SETUP_NOT_EXACT",)
    if setup.invalidated_before_entry:
        return CandidateState.BLOCKED, ("SETUP_INVALIDATED",)
    if setup.zone_engaged_epoch is None or trigger_epoch < setup.zone_engaged_epoch:
        return CandidateState.BLOCKED, ("ENTRY_BEFORE_ZONE_ENGAGEMENT",)
    return None


def _realtime_failure(
    *,
    proof_plane: ProofPlane,
    replayability: EvidenceReplayability,
    is_realtime: bool,
) -> tuple[str, ...]:
    if proof_plane is ProofPlane.REALTIME_TICK:
        if not is_realtime or replayability is not EvidenceReplayability.LIVE_EXACT_NON_REPLAYABLE:
            return ("REALTIME_EVIDENCE_NOT_LIVE",)
    elif replayability is not EvidenceReplayability.REPLAYABLE:
        return ("EVIDENCE_REPLAYABILITY_MISMATCH",)
    return ()


def _candidate(
    request: EntryMatchRequestV3,
    *,
    model: EntryModelV3,
    state: CandidateState,
    event_anchor_epoch: int,
    boc_tier: BocTier | None,
    reference_candle_open_epoch: int | None,
    source_claim_ids: tuple[str, ...],
) -> EntryCandidateV3:
    identity = EntryCandidateIdentityV3(
        setup_id=request.setup.setup_id,
        model=model,
        direction=request.setup.direction,
        event_anchor_epoch=event_anchor_epoch,
        trigger_ordinal=1,
        boc_tier=boc_tier,
        reference_candle_open_epoch=reference_candle_open_epoch,
    )
    return EntryCandidateV3(
        candidate_id=candidate_id_v3(identity),
        setup_id=request.setup.setup_id,
        model=model,
        state=state,
        direction=request.setup.direction,
        event_anchor_epoch=event_anchor_epoch,
        trigger_ordinal=1,
        boc_tier=boc_tier,
        reference_candle_open_epoch=reference_candle_open_epoch,
        source_claim_ids=source_claim_ids,
        observed_at_epoch=request.observed_at_epoch,
    )


def _evidence(
    request: EntryMatchRequestV3,
    candidate: EntryCandidateV3,
    fields: _EvidenceFields,
) -> EntryCandidateEvidenceV3:
    reference = fields.reference_candle
    reference_open_epoch = reference.open_epoch if reference is not None else None
    reference_open_ticks = reference.open_ticks if reference is not None else None
    reference_high_ticks = reference.high_ticks if reference is not None else None
    reference_low_ticks = reference.low_ticks if reference is not None else None
    reference_close_ticks = reference.close_ticks if reference is not None else None
    payload_sha256 = evidence_payload_sha256_v3(
        candidate_id=candidate.candidate_id,
        observed_trigger_epoch=fields.observed_trigger_epoch,
        trigger_sequence=fields.trigger_sequence,
        observed_trigger_ticks=fields.observed_trigger_ticks,
        htf_context_minutes=fields.htf_context_minutes,
        fidelity=fields.fidelity,
        proof_plane=fields.proof_plane,
        replayability=fields.replayability,
        coverage_start_epoch=fields.coverage_start_epoch,
        coverage_end_epoch=fields.coverage_end_epoch,
        ambiguity_codes=(),
        boc_tier=fields.boc_tier,
        reference_candle_open_epoch=reference_open_epoch,
        reference_candle_open_ticks=reference_open_ticks,
        reference_candle_high_ticks=reference_high_ticks,
        reference_candle_low_ticks=reference_low_ticks,
        reference_candle_close_ticks=reference_close_ticks,
        passed_rule_ids=fields.passed_rule_ids,
        failed_rule_ids=fields.failed_rule_ids,
        source_claim_ids=fields.source_claim_ids,
    )
    identity = EntryEvidenceIdentityV3(
        candidate_id=candidate.candidate_id,
        proof_plane=fields.proof_plane,
        coverage_start_epoch=fields.coverage_start_epoch,
        coverage_end_epoch=fields.coverage_end_epoch,
        observed_trigger_epoch=fields.observed_trigger_epoch,
        trigger_sequence=fields.trigger_sequence,
        payload_sha256=payload_sha256,
    )
    return EntryCandidateEvidenceV3(
        evidence_id=evidence_id_v3(identity),
        candidate_id=candidate.candidate_id,
        observed_trigger_epoch=fields.observed_trigger_epoch,
        trigger_sequence=fields.trigger_sequence,
        observed_trigger_ticks=fields.observed_trigger_ticks,
        htf_context_minutes=fields.htf_context_minutes,
        fidelity=fields.fidelity,
        proof_plane=fields.proof_plane,
        replayability=fields.replayability,
        coverage_start_epoch=fields.coverage_start_epoch,
        coverage_end_epoch=fields.coverage_end_epoch,
        ambiguity_codes=(),
        boc_tier=fields.boc_tier,
        reference_candle_open_epoch=reference_open_epoch,
        reference_candle_open_ticks=reference_open_ticks,
        reference_candle_high_ticks=reference_high_ticks,
        reference_candle_low_ticks=reference_low_ticks,
        reference_candle_close_ticks=reference_close_ticks,
        passed_rule_ids=fields.passed_rule_ids,
        failed_rule_ids=fields.failed_rule_ids,
        source_claim_ids=fields.source_claim_ids,
        payload_sha256=payload_sha256,
        observed_at_epoch=request.observed_at_epoch,
    )


def _match_boc(
    request: EntryMatchRequestV3,
    proof: BocProof,
) -> tuple[EntryCandidateV3, EntryCandidateEvidenceV3]:
    strict = _strict_boc_context(proof)
    tier = BocTier.HTF_TIMED if strict else BocTier.DISCRETIONARY_5M
    rule_id = "ENTRY_BOC_HTF_TIMED" if strict else "ENTRY_BOC_DISCRETIONARY_5M"
    source_claim_ids = _claims(request, rule_id)
    common_failure = _common_failure(request.setup, proof.trigger_epoch)
    realtime_failure = _realtime_failure(
        proof_plane=proof.proof_plane,
        replayability=proof.replayability,
        is_realtime=proof.is_realtime,
    )

    fidelity = proof.fidelity
    passed_rule_ids: tuple[str, ...] = ()
    failed_rule_ids: tuple[str, ...]
    if common_failure is not None:
        state, failed_rule_ids = common_failure
    elif not _boc_breaks_reference(request.setup.direction, proof):
        state = CandidateState.REJECTED
        failed_rule_ids = ("BOC_WRONG_DIRECTION",)
    elif realtime_failure:
        state = CandidateState.BLOCKED
        failed_rule_ids = realtime_failure
    elif proof.fidelity is not CandidateFidelity.EXACT:
        state = CandidateState.BLOCKED
        failed_rule_ids = ("MODEL_EVIDENCE_NOT_EXACT",)
    elif not strict:
        state = CandidateState.MATCHED
        fidelity = CandidateFidelity.DISCRETIONARY
        failed_rule_ids = ("BOC_DISCRETIONARY_CONTEXT_UNQUANTIFIED",)
    else:
        state = CandidateState.MATCHED
        passed_rule_ids = (rule_id,)
        failed_rule_ids = ()

    candidate = _candidate(
        request,
        model=EntryModelV3.BOC,
        state=state,
        event_anchor_epoch=proof.reference_candle.open_epoch,
        boc_tier=tier,
        reference_candle_open_epoch=proof.reference_candle.open_epoch,
        source_claim_ids=source_claim_ids,
    )
    evidence = _evidence(
        request,
        candidate,
        _EvidenceFields(
            observed_trigger_epoch=proof.trigger_epoch,
            trigger_sequence=proof.trigger_sequence,
            observed_trigger_ticks=proof.trigger_ticks,
            htf_context_minutes=proof.htf_context_minutes,
            fidelity=fidelity,
            proof_plane=proof.proof_plane,
            replayability=proof.replayability,
            coverage_start_epoch=proof.coverage_start_epoch,
            coverage_end_epoch=proof.coverage_end_epoch,
            boc_tier=tier,
            reference_candle=proof.reference_candle,
            passed_rule_ids=passed_rule_ids,
            failed_rule_ids=failed_rule_ids,
            source_claim_ids=source_claim_ids,
        ),
    )
    return candidate, evidence


def _match_close(
    request: EntryMatchRequestV3,
    bar: OrderedCandle,
) -> tuple[EntryCandidateV3, EntryCandidateEvidenceV3]:
    rule_id = "ENTRY_DIR_CLOSE"
    source_claim_ids = _claims(request, rule_id)
    common_failure = _common_failure(request.setup, bar.close_epoch)
    passed_rule_ids: tuple[str, ...]
    if common_failure is None:
        state = CandidateState.MATCHED
        passed_rule_ids = (rule_id,)
        failed_rule_ids: tuple[str, ...] = ()
    else:
        state, failed_rule_ids = common_failure
        passed_rule_ids = ()
    candidate = _candidate(
        request,
        model=EntryModelV3.DIR_CLOSE,
        state=state,
        event_anchor_epoch=bar.open_epoch,
        boc_tier=None,
        reference_candle_open_epoch=None,
        source_claim_ids=source_claim_ids,
    )
    evidence = _evidence(
        request,
        candidate,
        _EvidenceFields(
            observed_trigger_epoch=bar.close_epoch,
            trigger_sequence=request.close_trigger_sequence,
            observed_trigger_ticks=bar.close_ticks,
            htf_context_minutes=(),
            fidelity=CandidateFidelity.EXACT,
            proof_plane=ProofPlane.CONFIRMED_5M,
            replayability=EvidenceReplayability.REPLAYABLE,
            coverage_start_epoch=bar.open_epoch,
            coverage_end_epoch=bar.close_epoch,
            boc_tier=None,
            reference_candle=None,
            passed_rule_ids=passed_rule_ids,
            failed_rule_ids=failed_rule_ids,
            source_claim_ids=source_claim_ids,
        ),
    )
    return candidate, evidence


def _match_flip(
    request: EntryMatchRequestV3,
    proof: EntryTriggerProofV3,
) -> tuple[EntryCandidateV3, EntryCandidateEvidenceV3]:
    rule_id = "ENTRY_HTF_FLIP"
    source_claim_ids = _claims(request, rule_id)
    common_failure = _common_failure(request.setup, proof.trigger_epoch)
    realtime_failure = _realtime_failure(
        proof_plane=proof.proof_plane,
        replayability=proof.replayability,
        is_realtime=proof.is_realtime,
    )
    if common_failure is not None:
        state, failed_rule_ids = common_failure
        passed_rule_ids: tuple[str, ...] = ()
    elif realtime_failure:
        state = CandidateState.BLOCKED
        passed_rule_ids = ()
        failed_rule_ids = realtime_failure
    elif proof.fidelity is not CandidateFidelity.EXACT:
        state = CandidateState.BLOCKED
        passed_rule_ids = ()
        failed_rule_ids = ("MODEL_EVIDENCE_NOT_EXACT",)
    else:
        state = CandidateState.MATCHED
        passed_rule_ids = (rule_id,)
        failed_rule_ids = ()
    candidate = _candidate(
        request,
        model=EntryModelV3.HTF_FLIP,
        state=state,
        event_anchor_epoch=proof.event_anchor_epoch,
        boc_tier=None,
        reference_candle_open_epoch=None,
        source_claim_ids=source_claim_ids,
    )
    evidence = _evidence(
        request,
        candidate,
        _EvidenceFields(
            observed_trigger_epoch=proof.trigger_epoch,
            trigger_sequence=proof.trigger_sequence,
            observed_trigger_ticks=proof.trigger_ticks,
            htf_context_minutes=proof.htf_context_minutes,
            fidelity=proof.fidelity,
            proof_plane=proof.proof_plane,
            replayability=proof.replayability,
            coverage_start_epoch=proof.coverage_start_epoch,
            coverage_end_epoch=proof.coverage_end_epoch,
            boc_tier=None,
            reference_candle=None,
            passed_rule_ids=passed_rule_ids,
            failed_rule_ids=failed_rule_ids,
            source_claim_ids=source_claim_ids,
        ),
    )
    return candidate, evidence


def match_entry_candidates_v3(request: EntryMatchRequestV3) -> EntryMatchResultV3:
    """Emit each observed v3 entry model independently and retain blocked facts."""
    matched: list[tuple[EntryCandidateV3, EntryCandidateEvidenceV3]] = []
    if request.boc_proof is not None:
        matched.append(_match_boc(request, request.boc_proof))
    if request.directional_close:
        assert request.confirmed_bar is not None
        matched.append(_match_close(request, request.confirmed_bar))
    if request.htf_flip_proof is not None:
        matched.append(_match_flip(request, request.htf_flip_proof))
    return EntryMatchResultV3(
        candidates=tuple(sorted((item[0] for item in matched), key=lambda item: item.candidate_id)),
        evidence=tuple(sorted((item[1] for item in matched), key=lambda item: item.evidence_id)),
    )
