"""Replayable lower-timeframe proof boundary for HTF flip candidates."""

from __future__ import annotations

from dataclasses import dataclass

from prop_trading.domain.canonical import canonical_sha256
from prop_trading.domain.rd_entry_matcher import SetupEntryFacts
from prop_trading.domain.rd_entry_models import (
    AmbiguityCode,
    CandidateFidelity,
    EntryDirection,
    HTFFlipProof,
    HTFFlipProofTranscript,
    OrderedCandle,
    ProofPlane,
)


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
class HTFFlipScanRequest:
    setup: SetupEntryFacts
    timeframe_minutes: int
    htf_open_epoch: int
    scan_cutoff_epoch: int
    htf_open_ticks: int
    children: tuple[OrderedCandle, ...]
    proof_resolution_seconds: int
    full_lifecycle_ordered: bool

    def __post_init__(self) -> None:
        if not isinstance(self.setup, SetupEntryFacts):
            raise ValueError("setup must be SetupEntryFacts")
        _require_int(self.timeframe_minutes, "timeframe_minutes", positive=True)
        if self.timeframe_minutes not in {15, 30, 60}:
            raise ValueError("timeframe_minutes must be one of 15, 30, 60")
        _require_int(self.htf_open_epoch, "htf_open_epoch", non_negative=True)
        _require_int(self.scan_cutoff_epoch, "scan_cutoff_epoch", non_negative=True)
        _require_int(self.htf_open_ticks, "htf_open_ticks")
        _require_int(
            self.proof_resolution_seconds,
            "proof_resolution_seconds",
            positive=True,
        )
        _require_bool(self.full_lifecycle_ordered, "full_lifecycle_ordered")
        if not isinstance(self.children, tuple) or not all(
            isinstance(candle, OrderedCandle) for candle in self.children
        ):
            raise ValueError("children must be a tuple of OrderedCandle values")

        resolution = self.proof_resolution_seconds
        coverage_seconds = self.scan_cutoff_epoch - self.htf_open_epoch
        context_seconds = self.timeframe_minutes * 60
        if resolution >= 300 or 300 % resolution != 0:
            raise ValueError("proof_resolution_seconds must divide 300 and be below 300")
        if not 0 < coverage_seconds <= context_seconds:
            raise ValueError("scan cutoff must be inside the HTF context")
        if coverage_seconds % 300 != 0:
            raise ValueError("scan cutoff must align to a completed five-minute slice")
        if coverage_seconds % resolution != 0:
            raise ValueError("scan cutoff must align to the proof resolution")


def _contacts_zone(setup: SetupEntryFacts, candle: OrderedCandle) -> bool:
    return candle.low_ticks <= setup.zone_top_ticks and candle.high_ticks >= setup.zone_bottom_ticks


def _recrosses_htf_open(
    direction: EntryDirection,
    htf_open_ticks: int,
    candle: OrderedCandle,
) -> bool:
    if direction is EntryDirection.LONG:
        return candle.high_ticks > htf_open_ticks
    return candle.low_ticks < htf_open_ticks


def _validate_transcript_shape(transcript: HTFFlipProofTranscript) -> None:
    if not isinstance(transcript, HTFFlipProofTranscript):
        raise ValueError("transcript must be an HTFFlipProofTranscript")

    context_end = transcript.htf_open_epoch + transcript.context_minutes * 60
    if not (transcript.htf_open_epoch < transcript.scan_cutoff_epoch <= context_end):
        raise ValueError("scan cutoff must be inside the HTF context")

    resolution = transcript.proof_resolution_seconds
    coverage_seconds = transcript.coverage_end_epoch - transcript.coverage_start_epoch
    if coverage_seconds % resolution != 0:
        raise ValueError("coverage length must align to proof resolution")
    expected_count = coverage_seconds // resolution
    if transcript.expected_child_count != expected_count:
        raise ValueError("expected child count does not match transcript coverage")
    if not 0 <= transcript.observed_child_count <= expected_count:
        raise ValueError("observed child count is outside the expected range")
    if transcript.gap_present != (
        transcript.observed_child_count != transcript.expected_child_count
    ):
        raise ValueError("gap flag must exactly reflect missing child coverage")

    for name, candle in (
        ("contact candle", transcript.contact_candle),
        ("recross candle", transcript.recross_candle),
    ):
        if candle is None:
            continue
        if (
            candle.open_epoch < transcript.coverage_start_epoch
            or candle.close_epoch > transcript.coverage_end_epoch
        ):
            raise ValueError(f"{name} lies outside transcript coverage")
        if candle.close_epoch - candle.open_epoch != resolution:
            raise ValueError(f"{name} must span one proof-resolution interval")
        if (candle.open_epoch - transcript.coverage_start_epoch) % resolution != 0:
            raise ValueError(f"{name} must be proof-resolution aligned")


def validate_htf_flip_transcript(
    setup: SetupEntryFacts,
    transcript: HTFFlipProofTranscript,
) -> HTFFlipProof:
    """Replay setup-dependent compact facts into the sole public HTF proof."""
    if not isinstance(setup, SetupEntryFacts):
        raise ValueError("setup must be SetupEntryFacts")
    _validate_transcript_shape(transcript)

    contact = transcript.contact_candle
    recross = transcript.recross_candle
    if contact is not None and not _contacts_zone(setup, contact):
        raise ValueError("contact candle does not contact the setup zone")
    if recross is not None and not _recrosses_htf_open(
        setup.direction,
        transcript.htf_open_ticks,
        recross,
    ):
        raise ValueError("recross candle does not cross the HTF open")
    if recross is not None and contact is None:
        raise ValueError("recross cannot precede the retained contact")
    if contact is not None and recross is not None:
        if transcript.same_child:
            if contact != recross:
                raise ValueError("same-child transcript candles differ")
        elif contact.close_epoch > recross.open_epoch:
            raise ValueError("distinct contact and recross are not chronological")

    matched = contact is not None and recross is not None
    contact_at_open = (
        contact is not None
        and setup.zone_bottom_ticks <= contact.open_ticks <= setup.zone_top_ticks
    )
    same_child_ambiguous = matched and transcript.same_child and not contact_at_open
    exact = (
        matched
        and not transcript.gap_present
        and transcript.expected_child_count == transcript.observed_child_count
        and transcript.full_lifecycle_ordered
        and not transcript.destination_seen_before_contact
        and not same_child_ambiguous
    )
    ambiguity_codes = tuple(
        code
        for present, code in (
            (
                same_child_ambiguous,
                AmbiguityCode.SAME_CHILD_BAR_ORDER,
            ),
            (
                transcript.gap_present,
                AmbiguityCode.MISSING_INTRABAR_COVERAGE,
            ),
        )
        if present
    )
    return HTFFlipProof(
        matched=matched,
        event_anchor_epoch=transcript.htf_open_epoch,
        trigger_epoch=recross.close_epoch if recross is not None else None,
        trigger_ticks=transcript.htf_open_ticks if recross is not None else None,
        htf_context_minutes=(transcript.context_minutes,),
        fidelity=(CandidateFidelity.EXACT if exact else CandidateFidelity.UNRESOLVED),
        proof_plane=ProofPlane.LOWER_TIMEFRAME_REPLAY,
        proof_resolution_seconds=transcript.proof_resolution_seconds,
        coverage_start_epoch=transcript.coverage_start_epoch,
        coverage_end_epoch=transcript.coverage_end_epoch,
        coverage_expected_child_count=transcript.expected_child_count,
        coverage_observed_child_count=transcript.observed_child_count,
        coverage_gap_detected=transcript.gap_present,
        contact_child=contact,
        recross_child=recross,
        destination_seen_before_contact=(transcript.destination_seen_before_contact),
        ambiguity_codes=ambiguity_codes,
        transcript_sha256=canonical_sha256(transcript.to_mapping()),
        full_lifecycle_ordered=transcript.full_lifecycle_ordered,
        transcript=transcript,
    )


def _valid_children_by_open(
    request: HTFFlipScanRequest,
) -> dict[int, OrderedCandle]:
    children_by_open: dict[int, OrderedCandle] = {}
    previous_open: int | None = None
    resolution = request.proof_resolution_seconds
    for candle in request.children:
        if previous_open is not None and candle.open_epoch <= previous_open:
            raise ValueError("children must be ordered oldest-first")
        previous_open = candle.open_epoch
        if (
            candle.open_epoch < request.htf_open_epoch
            or candle.close_epoch > request.scan_cutoff_epoch
        ):
            raise ValueError("children cannot extend outside the scan cutoff")
        if (candle.open_epoch - request.htf_open_epoch) % resolution != 0:
            raise ValueError("child open epochs must align to proof resolution")
        if candle.close_epoch - candle.open_epoch == resolution:
            children_by_open[candle.open_epoch] = candle
    return children_by_open


def scan_htf_flip(request: HTFFlipScanRequest) -> HTFFlipProof:
    """Scan oldest-first children and validate one replayable compact transcript."""
    if not isinstance(request, HTFFlipScanRequest):
        raise ValueError("request must be an HTFFlipScanRequest")

    children_by_open = _valid_children_by_open(request)
    resolution = request.proof_resolution_seconds
    expected_count = (request.scan_cutoff_epoch - request.htf_open_epoch) // resolution
    observed_count = len(children_by_open)
    gap_present = observed_count != expected_count

    contact: OrderedCandle | None = None
    recross: OrderedCandle | None = None
    destination_seen_before_contact = False
    for index in range(expected_count):
        candle = children_by_open.get(request.htf_open_epoch + index * resolution)
        if candle is None:
            if recross is None:
                contact = None
            continue
        if recross is not None:
            continue

        contacts = _contacts_zone(request.setup, candle)
        recrosses = _recrosses_htf_open(
            request.setup.direction,
            request.htf_open_ticks,
            candle,
        )
        if contact is None:
            if not contacts:
                destination_seen_before_contact = destination_seen_before_contact or recrosses
                continue
            contact = candle
            if recrosses:
                recross = candle
            continue
        if recrosses:
            recross = candle

    transcript = HTFFlipProofTranscript(
        context_minutes=request.timeframe_minutes,
        htf_open_epoch=request.htf_open_epoch,
        htf_open_ticks=request.htf_open_ticks,
        scan_cutoff_epoch=request.scan_cutoff_epoch,
        proof_resolution_seconds=request.proof_resolution_seconds,
        coverage_start_epoch=request.htf_open_epoch,
        coverage_end_epoch=request.scan_cutoff_epoch,
        expected_child_count=expected_count,
        observed_child_count=observed_count,
        gap_present=gap_present,
        full_lifecycle_ordered=request.full_lifecycle_ordered,
        destination_seen_before_contact=destination_seen_before_contact,
        contact_candle=contact,
        recross_candle=recross,
        same_child=(
            contact is not None
            and recross is not None
            and contact.open_epoch == recross.open_epoch
            and contact.close_epoch == recross.close_epoch
        ),
    )
    return validate_htf_flip_transcript(request.setup, transcript)
