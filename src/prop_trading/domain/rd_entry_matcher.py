"""Pure single-event matcher for RD directional-close and HTF-flip entry facts."""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass

from prop_trading.domain.canonical import canonical_sha256
from prop_trading.domain.rd_entry_models import (
    AmbiguityCode,
    AttemptKind,
    CandidateFidelity,
    CandidateState,
    EntryCandidate,
    EntryCandidateEvidence,
    EntryCandidateIdentity,
    EntryDirection,
    EntryEvidenceIdentity,
    EntryHandlingIdentity,
    EntryHandlingObservation,
    EntryModelV2,
    HandlingMode,
    HTFFlipProof,
    OrderedCandle,
    ProofPlane,
    SetupAttemptTerminalReason,
    candidate_id,
    evidence_id,
    handling_id,
)

MODEL_SOURCE_CLAIMS: dict[EntryModelV2, tuple[str, ...]] = {
    EntryModelV2.DIR_CLOSE: (
        "standard-close-2024-03",
        "closure-or-flip-2025-03",
        "directional-close-2025-08",
        "directional-close-required-2026-06",
        "model-continuation-2026-07",
    ),
    EntryModelV2.HTF_FLIP: (
        "htf-flip-2024-03",
        "htf-context-set-2025-08",
        "htf-flip-definition-2025-08",
        "pure-flip-narrowing-2026-05",
        "model-continuation-2026-07",
    ),
    EntryModelV2.LEGACY_BREAK_CANDLE: (
        "gold-break-exception-2025-03",
        "discretionary-break-2025-11",
        "reject-non-htf-break-2026-05",
        "break-normalized-to-flip-2026-06",
    ),
    EntryModelV2.LEGACY_REJECTION_RESPECT: (
        "closure-or-flip-2025-03",
        "directional-close-2025-08",
        "directional-close-required-2026-06",
    ),
}
NEXT_CANDLE_WICK_SOURCE_CLAIMS = (
    "next-candle-wick-2025-05",
    "prompt-close-2025-05",
    "close-fallback-2025-11",
)
HTF_BOUNDARY_SOURCE_CLAIMS = ("htf-boundary-caution-2025-08",)

_FIDELITY_TRUST = {
    CandidateFidelity.EXACT: 0,
    CandidateFidelity.CALIBRATED: 1,
    CandidateFidelity.DISCRETIONARY: 2,
    CandidateFidelity.UNRESOLVED: 3,
}


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


@dataclass(frozen=True, slots=True)
class SetupEntryFacts:
    setup_id: str
    direction: EntryDirection
    zone_top_ticks: int
    zone_bottom_ticks: int
    zone_engaged_epoch: int | None
    invalidated_before_entry: bool
    common_fidelity: CandidateFidelity
    terminal_reason: SetupAttemptTerminalReason | None
    terminal_epoch: int | None

    def __post_init__(self) -> None:
        if not isinstance(self.setup_id, str) or not self.setup_id.strip():
            raise ValueError("setup_id must be a non-empty string")
        if not isinstance(self.direction, EntryDirection):
            raise ValueError("direction must be an EntryDirection")
        _require_int(self.zone_top_ticks, "zone_top_ticks")
        _require_int(self.zone_bottom_ticks, "zone_bottom_ticks")
        if self.zone_top_ticks <= self.zone_bottom_ticks:
            raise ValueError("zone_top_ticks must be above zone_bottom_ticks")
        if self.zone_engaged_epoch is not None:
            _require_int(self.zone_engaged_epoch, "zone_engaged_epoch", non_negative=True)
        _require_bool(self.invalidated_before_entry, "invalidated_before_entry")
        if not isinstance(self.common_fidelity, CandidateFidelity):
            raise ValueError("common_fidelity must be a CandidateFidelity")
        if self.terminal_reason is not None and not isinstance(
            self.terminal_reason, SetupAttemptTerminalReason
        ):
            raise ValueError("terminal_reason must be a SetupAttemptTerminalReason or None")
        if (self.terminal_reason is None) != (self.terminal_epoch is None):
            raise ValueError("terminal_reason and terminal_epoch must both be present or absent")
        if self.terminal_epoch is not None:
            _require_int(self.terminal_epoch, "terminal_epoch", non_negative=True)
            if (
                self.zone_engaged_epoch is not None
                and self.terminal_epoch < self.zone_engaged_epoch
            ):
                raise ValueError("terminal_epoch cannot precede zone_engaged_epoch")
        if self.invalidated_before_entry and (
            self.terminal_reason is not SetupAttemptTerminalReason.INVALIDATED
        ):
            raise ValueError("invalidated_before_entry requires an INVALIDATED terminal")


@dataclass(frozen=True, slots=True)
class EntryMatchRequest:
    setup: SetupEntryFacts
    confirmed_bar: OrderedCandle
    htf_proofs: tuple[HTFFlipProof, ...]
    generic_break_detected: bool
    rejection_respect_detected: bool
    attempt_kind: AttemptKind
    trigger_ordinal: int

    def __post_init__(self) -> None:
        if not isinstance(self.setup, SetupEntryFacts):
            raise ValueError("setup must be SetupEntryFacts")
        if not isinstance(self.confirmed_bar, OrderedCandle):
            raise ValueError("confirmed_bar must be OrderedCandle")
        if self.confirmed_bar.close_epoch - self.confirmed_bar.open_epoch != 300:
            raise ValueError("confirmed_bar must span exactly five minutes")
        if not isinstance(self.htf_proofs, tuple):
            raise ValueError("htf_proofs must be a tuple")
        if not all(isinstance(proof, HTFFlipProof) for proof in self.htf_proofs):
            raise ValueError("htf_proofs must contain only HTFFlipProof values")
        _require_bool(self.generic_break_detected, "generic_break_detected")
        _require_bool(self.rejection_respect_detected, "rejection_respect_detected")
        if not isinstance(self.attempt_kind, AttemptKind):
            raise ValueError("attempt_kind must be an AttemptKind")
        _require_int(self.trigger_ordinal, "trigger_ordinal", positive=True)
        if self.attempt_kind is AttemptKind.INITIAL and self.trigger_ordinal != 1:
            raise ValueError("INITIAL attempts require trigger_ordinal 1")
        if self.attempt_kind is AttemptKind.RE_ENTRY and self.trigger_ordinal < 2:
            raise ValueError("RE_ENTRY attempts require trigger_ordinal 2 or greater")


@dataclass(frozen=True, slots=True)
class EntryMatchResult:
    candidates: tuple[EntryCandidate, ...]
    evidence: tuple[EntryCandidateEvidence, ...]
    handling: tuple[EntryHandlingObservation, ...]

    def __post_init__(self) -> None:
        for values, expected_type, name in (
            (self.candidates, EntryCandidate, "candidates"),
            (self.evidence, EntryCandidateEvidence, "evidence"),
            (self.handling, EntryHandlingObservation, "handling"),
        ):
            if not isinstance(values, tuple) or not all(
                isinstance(value, expected_type) for value in values
            ):
                raise ValueError(f"{name} must be a tuple of {expected_type.__name__}")


@dataclass(frozen=True, slots=True)
class _EvidenceFields:
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
    observed_at_epoch: int


def _least_trusted(first: CandidateFidelity, second: CandidateFidelity) -> CandidateFidelity:
    return max((first, second), key=_FIDELITY_TRUST.__getitem__)


def _directional_close(request: EntryMatchRequest) -> bool:
    bar = request.confirmed_bar
    zone = request.setup
    if zone.direction is EntryDirection.LONG:
        return bar.close_ticks > bar.open_ticks and bar.close_ticks > zone.zone_top_ticks
    return bar.close_ticks < bar.open_ticks and bar.close_ticks < zone.zone_bottom_ticks


def _candidate(
    request: EntryMatchRequest,
    *,
    model: EntryModelV2,
    state: CandidateState,
    event_anchor_epoch: int,
    observed_at_epoch: int,
    normalized_from: EntryModelV2 | None = None,
) -> EntryCandidate:
    identity = EntryCandidateIdentity(
        setup_id=request.setup.setup_id,
        model=model,
        direction=request.setup.direction,
        event_anchor_epoch=event_anchor_epoch,
        trigger_ordinal=request.trigger_ordinal,
    )
    return EntryCandidate(
        candidate_id=candidate_id(identity),
        setup_id=request.setup.setup_id,
        model=model,
        state=state,
        event_anchor_epoch=event_anchor_epoch,
        trigger_ordinal=request.trigger_ordinal,
        direction=request.setup.direction,
        source_claim_ids=MODEL_SOURCE_CLAIMS[model],
        normalized_from=normalized_from,
        observed_at_epoch=observed_at_epoch,
    )


def _evidence_payload(candidate: EntryCandidate, fields: _EvidenceFields) -> str:
    return canonical_sha256(
        {
            "ambiguity_codes": [item.value for item in fields.ambiguity_codes],
            "candidate_id": candidate.candidate_id,
            "coverage_end_epoch": fields.coverage_end_epoch,
            "coverage_start_epoch": fields.coverage_start_epoch,
            "failed_rule_ids": list(fields.failed_rule_ids),
            "fidelity": fields.fidelity.value,
            "htf_context_minutes": list(fields.htf_context_minutes),
            "observed_trigger_epoch": fields.observed_trigger_epoch,
            "observed_trigger_ticks": fields.observed_trigger_ticks,
            "passed_rule_ids": list(fields.passed_rule_ids),
            "proof_plane": fields.proof_plane.value,
            "proof_resolution_seconds": fields.proof_resolution_seconds,
            "source_claim_ids": list(fields.source_claim_ids),
        }
    )


def _evidence(candidate: EntryCandidate, fields: _EvidenceFields) -> EntryCandidateEvidence:
    payload_sha256 = _evidence_payload(candidate, fields)
    identity = EntryEvidenceIdentity(
        candidate_id=candidate.candidate_id,
        proof_plane=fields.proof_plane,
        proof_resolution_seconds=fields.proof_resolution_seconds,
        coverage_start_epoch=fields.coverage_start_epoch,
        coverage_end_epoch=fields.coverage_end_epoch,
        observed_trigger_epoch=fields.observed_trigger_epoch,
        payload_sha256=payload_sha256,
    )
    return EntryCandidateEvidence(
        evidence_id=evidence_id(identity),
        candidate_id=candidate.candidate_id,
        observed_trigger_epoch=fields.observed_trigger_epoch,
        observed_trigger_ticks=fields.observed_trigger_ticks,
        htf_context_minutes=fields.htf_context_minutes,
        fidelity=fields.fidelity,
        proof_plane=fields.proof_plane,
        proof_resolution_seconds=fields.proof_resolution_seconds,
        coverage_start_epoch=fields.coverage_start_epoch,
        coverage_end_epoch=fields.coverage_end_epoch,
        ambiguity_codes=fields.ambiguity_codes,
        passed_rule_ids=fields.passed_rule_ids,
        failed_rule_ids=fields.failed_rule_ids,
        source_claim_ids=fields.source_claim_ids,
        payload_sha256=payload_sha256,
        observed_at_epoch=fields.observed_at_epoch,
    )


def _handling(
    request: EntryMatchRequest,
    candidate: EntryCandidate,
    evidence: EntryCandidateEvidence,
    *,
    handling_mode: HandlingMode,
) -> EntryHandlingObservation:
    source_claim_ids = MODEL_SOURCE_CLAIMS[candidate.model]
    identity = EntryHandlingIdentity(
        candidate_id=candidate.candidate_id,
        evidence_id=evidence.evidence_id,
        handling_mode=handling_mode,
        attempt_kind=request.attempt_kind,
        observed_epoch=(
            evidence.observed_trigger_epoch
            if evidence.observed_trigger_epoch is not None
            else evidence.observed_at_epoch
        ),
        observed_ticks=evidence.observed_trigger_ticks,
        fidelity=evidence.fidelity,
        source_claim_ids=source_claim_ids,
    )
    return EntryHandlingObservation(
        handling_id=handling_id(identity),
        candidate_id=identity.candidate_id,
        evidence_id=identity.evidence_id,
        handling_mode=identity.handling_mode,
        attempt_kind=identity.attempt_kind,
        observed_epoch=identity.observed_epoch,
        observed_ticks=identity.observed_ticks,
        fidelity=identity.fidelity,
        source_claim_ids=identity.source_claim_ids,
    )


def _confirmed_fields(
    request: EntryMatchRequest,
    *,
    model: EntryModelV2,
) -> _EvidenceFields:
    rule_id = {
        EntryModelV2.DIR_CLOSE: "ENTRY_DIR_CLOSE",
        EntryModelV2.LEGACY_BREAK_CANDLE: "ENTRY_BREAK_CANDLE_NORMALIZATION",
        EntryModelV2.LEGACY_REJECTION_RESPECT: "ENTRY_REJECTION_RESPECT_DISABLED",
    }[model]
    active = model is EntryModelV2.DIR_CLOSE
    return _EvidenceFields(
        observed_trigger_epoch=request.confirmed_bar.close_epoch,
        observed_trigger_ticks=request.confirmed_bar.close_ticks,
        htf_context_minutes=(),
        fidelity=_least_trusted(request.setup.common_fidelity, CandidateFidelity.EXACT),
        proof_plane=ProofPlane.CONFIRMED_5M,
        proof_resolution_seconds=300,
        coverage_start_epoch=request.confirmed_bar.open_epoch,
        coverage_end_epoch=request.confirmed_bar.close_epoch,
        ambiguity_codes=(),
        passed_rule_ids=(rule_id,) if active else (),
        failed_rule_ids=() if active else (rule_id,),
        source_claim_ids=MODEL_SOURCE_CLAIMS[model],
        observed_at_epoch=request.confirmed_bar.close_epoch,
    )


def _append_confirmed_match(
    request: EntryMatchRequest,
    *,
    model: EntryModelV2,
    state: CandidateState,
    candidates: list[EntryCandidate],
    evidence_rows: list[EntryCandidateEvidence],
    handling_rows: list[EntryHandlingObservation],
) -> None:
    candidate = _candidate(
        request,
        model=model,
        state=state,
        event_anchor_epoch=request.confirmed_bar.open_epoch,
        observed_at_epoch=request.confirmed_bar.close_epoch,
    )
    evidence = _evidence(candidate, _confirmed_fields(request, model=model))
    candidates.append(candidate)
    evidence_rows.append(evidence)
    handling_rows.append(
        _handling(
            request,
            candidate,
            evidence,
            handling_mode=HandlingMode.CLOSE_CONFIRMATION,
        )
    )


def _unique_claims(*claim_groups: Iterable[str]) -> tuple[str, ...]:
    return tuple(dict.fromkeys(claim for group in claim_groups for claim in group))


def _proof_is_order_proven(proof: HTFFlipProof) -> bool:
    return (
        proof.fidelity is CandidateFidelity.EXACT
        and proof.full_lifecycle_ordered
        and not proof.ambiguity_codes
    )


def _htf_evidence_key(
    proof: HTFFlipProof,
    *,
    effective_fidelity: CandidateFidelity,
    passed_rule_ids: tuple[str, ...],
    failed_rule_ids: tuple[str, ...],
    source_claim_ids: tuple[str, ...],
) -> tuple[object, ...]:
    return (
        proof.trigger_ticks,
        effective_fidelity.value,
        proof.proof_plane.value,
        proof.proof_resolution_seconds,
        proof.coverage_start_epoch,
        proof.coverage_end_epoch,
        proof.coverage_expected_child_count,
        proof.coverage_observed_child_count,
        proof.coverage_gap_detected,
        tuple(code.value for code in proof.ambiguity_codes),
        passed_rule_ids,
        failed_rule_ids,
        source_claim_ids,
        proof.transcript.scan_cutoff_epoch,
    )


def _append_htf_group(
    request: EntryMatchRequest,
    proofs: tuple[HTFFlipProof, ...],
    *,
    normalized: bool,
    candidates: list[EntryCandidate],
    evidence_rows: list[EntryCandidateEvidence],
    handling_rows: list[EntryHandlingObservation],
) -> None:
    order_proven = any(_proof_is_order_proven(proof) for proof in proofs)
    state = (
        CandidateState.NORMALIZED
        if normalized
        else CandidateState.MATCHED
        if order_proven
        else CandidateState.BLOCKED
    )
    candidate = _candidate(
        request,
        model=EntryModelV2.HTF_FLIP,
        state=state,
        event_anchor_epoch=proofs[0].event_anchor_epoch,
        observed_at_epoch=max(proof.transcript.scan_cutoff_epoch for proof in proofs),
        normalized_from=EntryModelV2.LEGACY_BREAK_CANDLE if normalized else None,
    )
    candidates.append(candidate)

    grouped: dict[tuple[object, ...], list[HTFFlipProof]] = {}
    for proof in proofs:
        proof_exact = _proof_is_order_proven(proof)
        passed_rule_ids = ("ENTRY_HTF_FLIP",) if proof_exact else ()
        failed_rule_ids = () if proof_exact else ("ENTRY_HTF_FLIP",)
        boundary_claims = HTF_BOUNDARY_SOURCE_CLAIMS if not proof.full_lifecycle_ordered else ()
        source_claim_ids = _unique_claims(
            MODEL_SOURCE_CLAIMS[EntryModelV2.HTF_FLIP],
            MODEL_SOURCE_CLAIMS[EntryModelV2.LEGACY_BREAK_CANDLE] if normalized else (),
            boundary_claims,
        )
        effective_fidelity = _least_trusted(request.setup.common_fidelity, proof.fidelity)
        key = _htf_evidence_key(
            proof,
            effective_fidelity=effective_fidelity,
            passed_rule_ids=passed_rule_ids,
            failed_rule_ids=failed_rule_ids,
            source_claim_ids=source_claim_ids,
        )
        grouped.setdefault(key, []).append(proof)

    for key in sorted(grouped, key=repr):
        proof_group = grouped[key]
        representative = proof_group[0]
        proof_exact = _proof_is_order_proven(representative)
        passed_rule_ids = ("ENTRY_HTF_FLIP",) if proof_exact else ()
        failed_rule_ids = () if proof_exact else ("ENTRY_HTF_FLIP",)
        source_claim_ids = _unique_claims(
            MODEL_SOURCE_CLAIMS[EntryModelV2.HTF_FLIP],
            MODEL_SOURCE_CLAIMS[EntryModelV2.LEGACY_BREAK_CANDLE] if normalized else (),
            HTF_BOUNDARY_SOURCE_CLAIMS if not representative.full_lifecycle_ordered else (),
        )
        fields = _EvidenceFields(
            observed_trigger_epoch=representative.trigger_epoch,
            observed_trigger_ticks=representative.trigger_ticks,
            htf_context_minutes=tuple(
                sorted({minute for proof in proof_group for minute in proof.htf_context_minutes})
            ),
            fidelity=_least_trusted(request.setup.common_fidelity, representative.fidelity),
            proof_plane=representative.proof_plane,
            proof_resolution_seconds=representative.proof_resolution_seconds,
            coverage_start_epoch=representative.coverage_start_epoch,
            coverage_end_epoch=representative.coverage_end_epoch,
            ambiguity_codes=representative.ambiguity_codes,
            passed_rule_ids=passed_rule_ids,
            failed_rule_ids=failed_rule_ids,
            source_claim_ids=source_claim_ids,
            observed_at_epoch=representative.transcript.scan_cutoff_epoch,
        )
        evidence = _evidence(candidate, fields)
        evidence_rows.append(evidence)
        handling_rows.append(
            _handling(
                request,
                candidate,
                evidence,
                handling_mode=HandlingMode.INTRABAR_FLIP,
            )
        )


def match_entry_candidates(request: EntryMatchRequest) -> EntryMatchResult:
    """Match one confirmed event without deriving chronology or attempt order."""
    if not isinstance(request, EntryMatchRequest):
        raise ValueError("request must be EntryMatchRequest")
    if request.setup.zone_engaged_epoch is None or (
        request.setup.terminal_reason is SetupAttemptTerminalReason.INVALIDATED
    ):
        return EntryMatchResult(candidates=(), evidence=(), handling=())

    candidates: list[EntryCandidate] = []
    evidence_rows: list[EntryCandidateEvidence] = []
    handling_rows: list[EntryHandlingObservation] = []

    if _directional_close(request):
        _append_confirmed_match(
            request,
            model=EntryModelV2.DIR_CLOSE,
            state=CandidateState.MATCHED,
            candidates=candidates,
            evidence_rows=evidence_rows,
            handling_rows=handling_rows,
        )

    matched_proofs = tuple(proof for proof in request.htf_proofs if proof.matched)
    proof_groups: dict[tuple[int, int], list[HTFFlipProof]] = {}
    for proof in matched_proofs:
        if proof.trigger_epoch is None:
            raise ValueError("matched HTF proof must carry a trigger epoch")
        proof_groups.setdefault((proof.event_anchor_epoch, proof.trigger_epoch), []).append(proof)

    break_normalized = False
    for group_key in sorted(proof_groups):
        proofs = tuple(
            sorted(
                proof_groups[group_key],
                key=lambda proof: (
                    proof.htf_context_minutes,
                    proof.fidelity.value,
                    proof.transcript_sha256,
                ),
            )
        )
        normalized = (
            request.generic_break_detected and group_key[1] == request.confirmed_bar.close_epoch
        )
        break_normalized = break_normalized or normalized
        _append_htf_group(
            request,
            proofs,
            normalized=normalized,
            candidates=candidates,
            evidence_rows=evidence_rows,
            handling_rows=handling_rows,
        )

    if request.generic_break_detected and not break_normalized:
        _append_confirmed_match(
            request,
            model=EntryModelV2.LEGACY_BREAK_CANDLE,
            state=CandidateState.REJECTED,
            candidates=candidates,
            evidence_rows=evidence_rows,
            handling_rows=handling_rows,
        )
    if request.rejection_respect_detected:
        _append_confirmed_match(
            request,
            model=EntryModelV2.LEGACY_REJECTION_RESPECT,
            state=CandidateState.REJECTED,
            candidates=candidates,
            evidence_rows=evidence_rows,
            handling_rows=handling_rows,
        )

    return EntryMatchResult(
        candidates=tuple(candidates),
        evidence=tuple(evidence_rows),
        handling=tuple(handling_rows),
    )
