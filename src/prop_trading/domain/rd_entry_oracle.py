"""Strict accumulated event-stream oracle for reviewed RD entry cases."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, replace
from enum import StrEnum
from typing import Literal, Self

from prop_trading.domain.rd_entry_arbitrator import (
    EntryArbitrationRequest,
    arbitrate_entry_candidates,
)
from prop_trading.domain.rd_entry_matcher import (
    NEXT_CANDLE_WICK_SOURCE_CLAIMS,
    EntryMatchRequest,
    SetupEntryFacts,
    match_entry_candidates,
)
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
    EntrySelection,
    EntrySelectionIdentity,
    HandlingMode,
    HTFFlipProofTranscript,
    OrderedCandle,
    ProofPlane,
    SelectionAction,
    SelectionReason,
    SetupAttemptTerminalReason,
    candidate_id,
    evidence_id,
    evidence_payload_sha256,
    handling_id,
    selection_id,
)
from prop_trading.domain.rd_intrabar_oracle import (
    HTFFlipScanRequest,
    scan_htf_flip,
    validate_htf_flip_transcript,
)

ACTIVE_ENTRY_MODELS = frozenset(
    {
        EntryModelV2.DIR_CLOSE,
        EntryModelV2.HTF_FLIP,
    }
)
_CANDLE_KEYS = frozenset(
    {
        "open_epoch",
        "close_epoch",
        "open_ticks",
        "high_ticks",
        "low_ticks",
        "close_ticks",
    }
)
_TRANSCRIPT_KEYS = frozenset(
    {
        "context_minutes",
        "htf_open_epoch",
        "htf_open_ticks",
        "scan_cutoff_epoch",
        "proof_resolution_seconds",
        "coverage_start_epoch",
        "coverage_end_epoch",
        "expected_child_count",
        "observed_child_count",
        "gap_present",
        "full_lifecycle_ordered",
        "destination_seen_before_contact",
        "contact_candle",
        "recross_candle",
        "same_child",
    }
)
_SETUP_KEYS = frozenset(
    {
        "setup_id",
        "direction",
        "zone_top_ticks",
        "zone_bottom_ticks",
        "zone_engaged_epoch",
        "invalidated_before_entry",
        "common_fidelity",
        "terminal_reason",
        "terminal_epoch",
    }
)
_MATCH_REQUEST_KEYS = frozenset(
    {
        "setup",
        "confirmed_bar",
        "htf_proofs",
        "generic_break_detected",
        "rejection_respect_detected",
        "attempt_kind",
        "trigger_ordinal",
    }
)
_SCAN_REQUEST_KEYS = frozenset(
    {
        "timeframe_minutes",
        "htf_open_epoch",
        "scan_cutoff_epoch",
        "htf_open_ticks",
        "children",
        "proof_resolution_seconds",
        "full_lifecycle_ordered",
    }
)
_INPUT_KEYS = frozenset(
    {
        "setup_id",
        "events",
        "setup_invalidated",
        "policy_version",
        "revision",
        "evaluated_at_epoch",
    }
)
_REPLAY_METADATA_KEYS = frozenset(
    {
        "setup_id",
        "symbol",
        "feed",
        "calculation_start_epoch",
        "emission_start_epoch",
        "emission_end_epoch",
        "pine_supported",
    }
)
_FIXTURE_CASE_KEYS = frozenset(
    {
        "case_id",
        *_REPLAY_METADATA_KEYS,
        "input",
        "expected",
        "pine_expected",
    }
)
_CANDIDATE_KEYS = frozenset(
    {
        "candidate_id",
        "setup_id",
        "model",
        "state",
        "event_anchor_epoch",
        "trigger_ordinal",
        "direction",
        "source_claim_ids",
        "normalized_from",
        "observed_at_epoch",
    }
)
_EVIDENCE_KEYS = frozenset(
    {
        "evidence_id",
        "candidate_id",
        "observed_trigger_epoch",
        "observed_trigger_ticks",
        "htf_context_minutes",
        "fidelity",
        "proof_plane",
        "proof_resolution_seconds",
        "coverage_start_epoch",
        "coverage_end_epoch",
        "ambiguity_codes",
        "passed_rule_ids",
        "failed_rule_ids",
        "source_claim_ids",
        "payload_sha256",
        "observed_at_epoch",
    }
)
_HANDLING_KEYS = frozenset(
    {
        "handling_id",
        "candidate_id",
        "evidence_id",
        "handling_mode",
        "attempt_kind",
        "observed_epoch",
        "observed_ticks",
        "fidelity",
        "source_claim_ids",
    }
)
_SELECTION_KEYS = frozenset(
    {
        "selection_id",
        "setup_id",
        "policy_version",
        "revision",
        "candidate_ids_considered",
        "canonical_candidate_id",
        "canonical_evidence_id",
        "canonical_model",
        "reason",
        "fidelity",
        "action",
        "evaluated_at_epoch",
    }
)


def _require_closed_text(value: object, name: str) -> None:
    if not isinstance(value, str) or not value or value != value.strip():
        raise ValueError(f"{name} must be a non-empty closed string")


def _require_non_negative_int(value: object, name: str) -> None:
    if type(value) is not int:
        raise ValueError(f"{name} must be an integer (bool is not allowed)")
    if value < 0:
        raise ValueError(f"{name} must be non-negative")


def _strict_mapping(
    value: object,
    *,
    name: str,
    keys: frozenset[str],
) -> dict[str, object]:
    if not isinstance(value, dict) or not all(isinstance(key, str) for key in value):
        raise ValueError(f"{name} must be an object")
    present = frozenset(value)
    missing = keys - present
    unknown = present - keys
    if missing:
        raise ValueError(f"{name} is missing fields: {sorted(missing)}")
    if unknown:
        raise ValueError(f"{name} has unknown fields: {sorted(unknown)}")
    return value


def _strict_list(value: object, name: str, *, maximum: int | None = None) -> list[object]:
    if not isinstance(value, list):
        raise ValueError(f"{name} must be an array")
    if maximum is not None and len(value) > maximum:
        raise ValueError(f"{name} exceeds its maximum length of {maximum}")
    return value


def _as_int(
    value: object,
    name: str,
    *,
    non_negative: bool = False,
) -> int:
    if type(value) is not int:
        raise ValueError(f"{name} must be an integer (bool is not allowed)")
    if non_negative and value < 0:
        raise ValueError(f"{name} must be non-negative")
    return value


def _as_optional_int(
    value: object,
    name: str,
    *,
    non_negative: bool = False,
) -> int | None:
    if value is None:
        return None
    return _as_int(value, name, non_negative=non_negative)


def _as_bool(value: object, name: str) -> bool:
    if type(value) is not bool:
        raise ValueError(f"{name} must be a bool")
    return value


def _as_text(value: object, name: str) -> str:
    _require_closed_text(value, name)
    assert isinstance(value, str)
    return value


def _as_text_tuple(
    value: object,
    name: str,
    *,
    maximum: int | None = None,
) -> tuple[str, ...]:
    return tuple(
        _as_text(item, f"{name}[{index}]")
        for index, item in enumerate(_strict_list(value, name, maximum=maximum))
    )


def _as_int_tuple(
    value: object,
    name: str,
    *,
    maximum: int | None = None,
) -> tuple[int, ...]:
    return tuple(
        _as_int(item, f"{name}[{index}]")
        for index, item in enumerate(_strict_list(value, name, maximum=maximum))
    )


def _as_enum[EnumT: StrEnum](
    value: object,
    enum_type: type[EnumT],
    name: str,
) -> EnumT:
    if not isinstance(value, str):
        raise ValueError(f"{name} must be a {enum_type.__name__} value")
    try:
        return enum_type(value)
    except ValueError as exc:
        raise ValueError(f"{name} must be a {enum_type.__name__} value") from exc


def _as_enum_tuple[EnumT: StrEnum](
    value: object,
    enum_type: type[EnumT],
    name: str,
) -> tuple[EnumT, ...]:
    return tuple(
        _as_enum(item, enum_type, f"{name}[{index}]")
        for index, item in enumerate(_strict_list(value, name))
    )


def _parse_candle(value: object, name: str) -> OrderedCandle:
    mapping = _strict_mapping(value, name=name, keys=_CANDLE_KEYS)
    return OrderedCandle(
        open_epoch=_as_int(
            mapping["open_epoch"],
            f"{name}.open_epoch",
            non_negative=True,
        ),
        close_epoch=_as_int(
            mapping["close_epoch"],
            f"{name}.close_epoch",
            non_negative=True,
        ),
        open_ticks=_as_int(mapping["open_ticks"], f"{name}.open_ticks"),
        high_ticks=_as_int(mapping["high_ticks"], f"{name}.high_ticks"),
        low_ticks=_as_int(mapping["low_ticks"], f"{name}.low_ticks"),
        close_ticks=_as_int(mapping["close_ticks"], f"{name}.close_ticks"),
    )


def _parse_setup(value: object, name: str) -> SetupEntryFacts:
    mapping = _strict_mapping(value, name=name, keys=_SETUP_KEYS)
    terminal_value = mapping["terminal_reason"]
    terminal_reason = (
        None
        if terminal_value is None
        else _as_enum(
            terminal_value,
            SetupAttemptTerminalReason,
            f"{name}.terminal_reason",
        )
    )
    return SetupEntryFacts(
        setup_id=_as_text(mapping["setup_id"], f"{name}.setup_id"),
        direction=_as_enum(
            mapping["direction"],
            EntryDirection,
            f"{name}.direction",
        ),
        zone_top_ticks=_as_int(
            mapping["zone_top_ticks"],
            f"{name}.zone_top_ticks",
        ),
        zone_bottom_ticks=_as_int(
            mapping["zone_bottom_ticks"],
            f"{name}.zone_bottom_ticks",
        ),
        zone_engaged_epoch=_as_optional_int(
            mapping["zone_engaged_epoch"],
            f"{name}.zone_engaged_epoch",
            non_negative=True,
        ),
        invalidated_before_entry=_as_bool(
            mapping["invalidated_before_entry"],
            f"{name}.invalidated_before_entry",
        ),
        common_fidelity=_as_enum(
            mapping["common_fidelity"],
            CandidateFidelity,
            f"{name}.common_fidelity",
        ),
        terminal_reason=terminal_reason,
        terminal_epoch=_as_optional_int(
            mapping["terminal_epoch"],
            f"{name}.terminal_epoch",
            non_negative=True,
        ),
    )


def _parse_transcript(value: object, name: str) -> HTFFlipProofTranscript:
    mapping = _strict_mapping(value, name=name, keys=_TRANSCRIPT_KEYS)
    contact_value = mapping["contact_candle"]
    recross_value = mapping["recross_candle"]
    return HTFFlipProofTranscript(
        context_minutes=_as_int(
            mapping["context_minutes"],
            f"{name}.context_minutes",
        ),
        htf_open_epoch=_as_int(
            mapping["htf_open_epoch"],
            f"{name}.htf_open_epoch",
            non_negative=True,
        ),
        htf_open_ticks=_as_int(
            mapping["htf_open_ticks"],
            f"{name}.htf_open_ticks",
        ),
        scan_cutoff_epoch=_as_int(
            mapping["scan_cutoff_epoch"],
            f"{name}.scan_cutoff_epoch",
            non_negative=True,
        ),
        proof_resolution_seconds=_as_int(
            mapping["proof_resolution_seconds"],
            f"{name}.proof_resolution_seconds",
        ),
        coverage_start_epoch=_as_int(
            mapping["coverage_start_epoch"],
            f"{name}.coverage_start_epoch",
            non_negative=True,
        ),
        coverage_end_epoch=_as_int(
            mapping["coverage_end_epoch"],
            f"{name}.coverage_end_epoch",
            non_negative=True,
        ),
        expected_child_count=_as_int(
            mapping["expected_child_count"],
            f"{name}.expected_child_count",
            non_negative=True,
        ),
        observed_child_count=_as_int(
            mapping["observed_child_count"],
            f"{name}.observed_child_count",
            non_negative=True,
        ),
        gap_present=_as_bool(
            mapping["gap_present"],
            f"{name}.gap_present",
        ),
        full_lifecycle_ordered=_as_bool(
            mapping["full_lifecycle_ordered"],
            f"{name}.full_lifecycle_ordered",
        ),
        destination_seen_before_contact=_as_bool(
            mapping["destination_seen_before_contact"],
            f"{name}.destination_seen_before_contact",
        ),
        contact_candle=(
            None
            if contact_value is None
            else _parse_candle(contact_value, f"{name}.contact_candle")
        ),
        recross_candle=(
            None
            if recross_value is None
            else _parse_candle(recross_value, f"{name}.recross_candle")
        ),
        same_child=_as_bool(
            mapping["same_child"],
            f"{name}.same_child",
        ),
    )


def _parse_match_request(value: object, name: str) -> EntryMatchRequest:
    mapping = _strict_mapping(value, name=name, keys=_MATCH_REQUEST_KEYS)
    setup = _parse_setup(mapping["setup"], f"{name}.setup")
    transcript_values = _strict_list(
        mapping["htf_proofs"],
        f"{name}.htf_proofs",
        maximum=3,
    )
    transcripts = tuple(
        _parse_transcript(item, f"{name}.htf_proofs[{index}]")
        for index, item in enumerate(transcript_values)
    )
    if len({item.context_minutes for item in transcripts}) != len(transcripts):
        raise ValueError(f"{name}.htf_proofs has duplicate context_minutes")
    proofs = tuple(validate_htf_flip_transcript(setup, transcript) for transcript in transcripts)
    return EntryMatchRequest(
        setup=setup,
        confirmed_bar=_parse_candle(
            mapping["confirmed_bar"],
            f"{name}.confirmed_bar",
        ),
        htf_proofs=proofs,
        generic_break_detected=_as_bool(
            mapping["generic_break_detected"],
            f"{name}.generic_break_detected",
        ),
        rejection_respect_detected=_as_bool(
            mapping["rejection_respect_detected"],
            f"{name}.rejection_respect_detected",
        ),
        attempt_kind=_as_enum(
            mapping["attempt_kind"],
            AttemptKind,
            f"{name}.attempt_kind",
        ),
        trigger_ordinal=_as_int(
            mapping["trigger_ordinal"],
            f"{name}.trigger_ordinal",
        ),
    )


def _parse_scan_request(
    value: object,
    *,
    setup: SetupEntryFacts,
    name: str,
) -> HTFFlipScanRequest:
    mapping = _strict_mapping(value, name=name, keys=_SCAN_REQUEST_KEYS)
    children = tuple(
        _parse_candle(item, f"{name}.children[{index}]")
        for index, item in enumerate(
            _strict_list(
                mapping["children"],
                f"{name}.children",
                maximum=3_600,
            )
        )
    )
    request = HTFFlipScanRequest(
        setup=setup,
        timeframe_minutes=_as_int(
            mapping["timeframe_minutes"],
            f"{name}.timeframe_minutes",
        ),
        htf_open_epoch=_as_int(
            mapping["htf_open_epoch"],
            f"{name}.htf_open_epoch",
            non_negative=True,
        ),
        scan_cutoff_epoch=_as_int(
            mapping["scan_cutoff_epoch"],
            f"{name}.scan_cutoff_epoch",
            non_negative=True,
        ),
        htf_open_ticks=_as_int(
            mapping["htf_open_ticks"],
            f"{name}.htf_open_ticks",
        ),
        children=children,
        proof_resolution_seconds=_as_int(
            mapping["proof_resolution_seconds"],
            f"{name}.proof_resolution_seconds",
        ),
        full_lifecycle_ordered=_as_bool(
            mapping["full_lifecycle_ordered"],
            f"{name}.full_lifecycle_ordered",
        ),
    )
    scan_htf_flip(request)
    return request


def _parse_event(
    value: object,
    *,
    name: str,
    expanded: bool,
) -> EntryOracleEvent:
    keys = (
        frozenset({"event_id", "match_request"})
        if expanded
        else frozenset({"event_id", "match_request", "htf_scan_requests"})
    )
    mapping = _strict_mapping(value, name=name, keys=keys)
    match_request = _parse_match_request(
        mapping["match_request"],
        f"{name}.match_request",
    )
    scan_values = (
        []
        if expanded
        else _strict_list(
            mapping["htf_scan_requests"],
            f"{name}.htf_scan_requests",
            maximum=3,
        )
    )
    scans = tuple(
        _parse_scan_request(
            item,
            setup=match_request.setup,
            name=f"{name}.htf_scan_requests[{index}]",
        )
        for index, item in enumerate(scan_values)
    )
    if match_request.htf_proofs and scans:
        raise ValueError("event mixes raw scans with expanded HTF proofs")
    if len({item.timeframe_minutes for item in scans}) != len(scans):
        raise ValueError(f"{name}.htf_scan_requests has duplicate contexts")
    return EntryOracleEvent(
        event_id=_as_text(mapping["event_id"], f"{name}.event_id"),
        base_match_request=match_request,
        htf_scan_requests=scans,
    )


def _validate_event_identities(events: tuple[EntryOracleEvent, ...]) -> None:
    unique: dict[str, EntryOracleEvent] = {}
    for event in events:
        _merge_immutable(unique, (event,), key="event_id")


def _parse_candidate(value: object, name: str) -> EntryCandidate:
    mapping = _strict_mapping(value, name=name, keys=_CANDIDATE_KEYS)
    normalized_value = mapping["normalized_from"]
    identity = EntryCandidateIdentity(
        setup_id=_as_text(mapping["setup_id"], f"{name}.setup_id"),
        model=_as_enum(mapping["model"], EntryModelV2, f"{name}.model"),
        direction=_as_enum(
            mapping["direction"],
            EntryDirection,
            f"{name}.direction",
        ),
        event_anchor_epoch=_as_int(
            mapping["event_anchor_epoch"],
            f"{name}.event_anchor_epoch",
            non_negative=True,
        ),
        trigger_ordinal=_as_int(
            mapping["trigger_ordinal"],
            f"{name}.trigger_ordinal",
        ),
    )
    parsed = EntryCandidate(
        candidate_id=_as_text(
            mapping["candidate_id"],
            f"{name}.candidate_id",
        ),
        setup_id=identity.setup_id,
        model=identity.model,
        state=_as_enum(mapping["state"], CandidateState, f"{name}.state"),
        event_anchor_epoch=identity.event_anchor_epoch,
        trigger_ordinal=identity.trigger_ordinal,
        direction=identity.direction,
        source_claim_ids=_as_text_tuple(
            mapping["source_claim_ids"],
            f"{name}.source_claim_ids",
        ),
        normalized_from=(
            None
            if normalized_value is None
            else _as_enum(
                normalized_value,
                EntryModelV2,
                f"{name}.normalized_from",
            )
        ),
        observed_at_epoch=_as_int(
            mapping["observed_at_epoch"],
            f"{name}.observed_at_epoch",
            non_negative=True,
        ),
    )
    if parsed.candidate_id != candidate_id(identity):
        raise ValueError(f"{name}.candidate_id conflicts with its identity")
    return parsed


def _parse_evidence(value: object, name: str) -> EntryCandidateEvidence:
    mapping = _strict_mapping(value, name=name, keys=_EVIDENCE_KEYS)
    parsed = EntryCandidateEvidence(
        evidence_id=_as_text(mapping["evidence_id"], f"{name}.evidence_id"),
        candidate_id=_as_text(
            mapping["candidate_id"],
            f"{name}.candidate_id",
        ),
        observed_trigger_epoch=_as_optional_int(
            mapping["observed_trigger_epoch"],
            f"{name}.observed_trigger_epoch",
            non_negative=True,
        ),
        observed_trigger_ticks=_as_optional_int(
            mapping["observed_trigger_ticks"],
            f"{name}.observed_trigger_ticks",
        ),
        htf_context_minutes=_as_int_tuple(
            mapping["htf_context_minutes"],
            f"{name}.htf_context_minutes",
            maximum=3,
        ),
        fidelity=_as_enum(
            mapping["fidelity"],
            CandidateFidelity,
            f"{name}.fidelity",
        ),
        proof_plane=_as_enum(
            mapping["proof_plane"],
            ProofPlane,
            f"{name}.proof_plane",
        ),
        proof_resolution_seconds=_as_int(
            mapping["proof_resolution_seconds"],
            f"{name}.proof_resolution_seconds",
        ),
        coverage_start_epoch=_as_int(
            mapping["coverage_start_epoch"],
            f"{name}.coverage_start_epoch",
            non_negative=True,
        ),
        coverage_end_epoch=_as_int(
            mapping["coverage_end_epoch"],
            f"{name}.coverage_end_epoch",
            non_negative=True,
        ),
        ambiguity_codes=_as_enum_tuple(
            mapping["ambiguity_codes"],
            AmbiguityCode,
            f"{name}.ambiguity_codes",
        ),
        passed_rule_ids=_as_text_tuple(
            mapping["passed_rule_ids"],
            f"{name}.passed_rule_ids",
        ),
        failed_rule_ids=_as_text_tuple(
            mapping["failed_rule_ids"],
            f"{name}.failed_rule_ids",
        ),
        source_claim_ids=_as_text_tuple(
            mapping["source_claim_ids"],
            f"{name}.source_claim_ids",
        ),
        payload_sha256=_as_text(
            mapping["payload_sha256"],
            f"{name}.payload_sha256",
        ),
        observed_at_epoch=_as_int(
            mapping["observed_at_epoch"],
            f"{name}.observed_at_epoch",
            non_negative=True,
        ),
    )
    authoritative_payload_sha256 = evidence_payload_sha256(
        candidate_id=parsed.candidate_id,
        observed_trigger_epoch=parsed.observed_trigger_epoch,
        observed_trigger_ticks=parsed.observed_trigger_ticks,
        htf_context_minutes=parsed.htf_context_minutes,
        fidelity=parsed.fidelity,
        proof_plane=parsed.proof_plane,
        proof_resolution_seconds=parsed.proof_resolution_seconds,
        coverage_start_epoch=parsed.coverage_start_epoch,
        coverage_end_epoch=parsed.coverage_end_epoch,
        ambiguity_codes=parsed.ambiguity_codes,
        passed_rule_ids=parsed.passed_rule_ids,
        failed_rule_ids=parsed.failed_rule_ids,
        source_claim_ids=parsed.source_claim_ids,
    )
    if parsed.payload_sha256 != authoritative_payload_sha256:
        raise ValueError(f"{name}.payload_sha256 conflicts with its expanded payload digest")
    identity = EntryEvidenceIdentity(
        candidate_id=parsed.candidate_id,
        proof_plane=parsed.proof_plane,
        proof_resolution_seconds=parsed.proof_resolution_seconds,
        coverage_start_epoch=parsed.coverage_start_epoch,
        coverage_end_epoch=parsed.coverage_end_epoch,
        observed_trigger_epoch=parsed.observed_trigger_epoch,
        payload_sha256=parsed.payload_sha256,
    )
    if parsed.evidence_id != evidence_id(identity):
        raise ValueError(f"{name}.evidence_id conflicts with its identity")
    return parsed


def _parse_handling(value: object, name: str) -> EntryHandlingObservation:
    mapping = _strict_mapping(value, name=name, keys=_HANDLING_KEYS)
    identity = EntryHandlingIdentity(
        candidate_id=_as_text(
            mapping["candidate_id"],
            f"{name}.candidate_id",
        ),
        evidence_id=_as_text(
            mapping["evidence_id"],
            f"{name}.evidence_id",
        ),
        handling_mode=_as_enum(
            mapping["handling_mode"],
            HandlingMode,
            f"{name}.handling_mode",
        ),
        attempt_kind=_as_enum(
            mapping["attempt_kind"],
            AttemptKind,
            f"{name}.attempt_kind",
        ),
        observed_epoch=_as_int(
            mapping["observed_epoch"],
            f"{name}.observed_epoch",
            non_negative=True,
        ),
        observed_ticks=_as_optional_int(
            mapping["observed_ticks"],
            f"{name}.observed_ticks",
        ),
        fidelity=_as_enum(
            mapping["fidelity"],
            CandidateFidelity,
            f"{name}.fidelity",
        ),
        source_claim_ids=_as_text_tuple(
            mapping["source_claim_ids"],
            f"{name}.source_claim_ids",
        ),
    )
    parsed = EntryHandlingObservation(
        handling_id=_as_text(
            mapping["handling_id"],
            f"{name}.handling_id",
        ),
        candidate_id=identity.candidate_id,
        evidence_id=identity.evidence_id,
        handling_mode=identity.handling_mode,
        attempt_kind=identity.attempt_kind,
        observed_epoch=identity.observed_epoch,
        observed_ticks=identity.observed_ticks,
        fidelity=identity.fidelity,
        source_claim_ids=identity.source_claim_ids,
    )
    if parsed.handling_id != handling_id(identity):
        raise ValueError(f"{name}.handling_id conflicts with its identity")
    return parsed


def _parse_selection(value: object, name: str) -> EntrySelection:
    mapping = _strict_mapping(value, name=name, keys=_SELECTION_KEYS)
    canonical_candidate_value = mapping["canonical_candidate_id"]
    canonical_evidence_value = mapping["canonical_evidence_id"]
    canonical_model_value = mapping["canonical_model"]
    fidelity_value = mapping["fidelity"]
    identity = EntrySelectionIdentity(
        setup_id=_as_text(mapping["setup_id"], f"{name}.setup_id"),
        policy_version=_parse_policy_version(mapping["policy_version"]),
        revision=_as_int(
            mapping["revision"],
            f"{name}.revision",
            non_negative=True,
        ),
        candidate_ids_considered=_as_text_tuple(
            mapping["candidate_ids_considered"],
            f"{name}.candidate_ids_considered",
        ),
        canonical_candidate_id=(
            None
            if canonical_candidate_value is None
            else _as_text(
                canonical_candidate_value,
                f"{name}.canonical_candidate_id",
            )
        ),
        canonical_evidence_id=(
            None
            if canonical_evidence_value is None
            else _as_text(
                canonical_evidence_value,
                f"{name}.canonical_evidence_id",
            )
        ),
        reason=_as_enum(
            mapping["reason"],
            SelectionReason,
            f"{name}.reason",
        ),
        fidelity=(
            None
            if fidelity_value is None
            else _as_enum(
                fidelity_value,
                CandidateFidelity,
                f"{name}.fidelity",
            )
        ),
        action=_as_enum(
            mapping["action"],
            SelectionAction,
            f"{name}.action",
        ),
    )
    parsed = EntrySelection(
        selection_id=_as_text(
            mapping["selection_id"],
            f"{name}.selection_id",
        ),
        setup_id=identity.setup_id,
        policy_version="rd-entry-arbitration-v2",
        revision=identity.revision,
        candidate_ids_considered=identity.candidate_ids_considered,
        canonical_candidate_id=identity.canonical_candidate_id,
        canonical_evidence_id=identity.canonical_evidence_id,
        canonical_model=(
            None
            if canonical_model_value is None
            else _as_enum(
                canonical_model_value,
                EntryModelV2,
                f"{name}.canonical_model",
            )
        ),
        reason=identity.reason,
        fidelity=identity.fidelity,
        action=identity.action,
        evaluated_at_epoch=_as_int(
            mapping["evaluated_at_epoch"],
            f"{name}.evaluated_at_epoch",
            non_negative=True,
        ),
    )
    if parsed.selection_id != selection_id(identity):
        raise ValueError(f"{name}.selection_id conflicts with its identity")
    return parsed


def _require_id_sorted_unique[ValueT](
    values: tuple[ValueT, ...],
    *,
    key: str,
    name: str,
) -> None:
    identities = tuple(getattr(value, key) for value in values)
    if identities != tuple(sorted(identities)):
        raise ValueError(f"{name} must be ID-sorted")
    if len(set(identities)) != len(identities):
        raise ValueError(f"{name} IDs must be unique")


def _validate_result_surface(value: object, name: str) -> None:
    mapping = _strict_mapping(
        value,
        name=name,
        keys=frozenset(
            {
                "htf_transcripts",
                "candidates",
                "evidence",
                "handling",
                "selection",
            }
        ),
    )
    transcripts = _strict_list(
        mapping["htf_transcripts"],
        f"{name}.htf_transcripts",
        maximum=3,
    )
    parsed_transcripts = tuple(
        _parse_transcript(item, f"{name}.htf_transcripts[{index}]")
        for index, item in enumerate(transcripts)
    )
    contexts = tuple(item.context_minutes for item in parsed_transcripts)
    if contexts != tuple(sorted(contexts)) or len(set(contexts)) != len(contexts):
        raise ValueError(f"{name}.htf_transcripts must be context-sorted")
    candidates = tuple(
        _parse_candidate(item, f"{name}.candidates[{index}]")
        for index, item in enumerate(_strict_list(mapping["candidates"], f"{name}.candidates"))
    )
    evidence = tuple(
        _parse_evidence(item, f"{name}.evidence[{index}]")
        for index, item in enumerate(_strict_list(mapping["evidence"], f"{name}.evidence"))
    )
    handling = tuple(
        _parse_handling(item, f"{name}.handling[{index}]")
        for index, item in enumerate(_strict_list(mapping["handling"], f"{name}.handling"))
    )
    selection = _parse_selection(mapping["selection"], f"{name}.selection")
    _require_id_sorted_unique(
        candidates,
        key="candidate_id",
        name=f"{name}.candidates",
    )
    _require_id_sorted_unique(
        evidence,
        key="evidence_id",
        name=f"{name}.evidence",
    )
    _require_id_sorted_unique(
        handling,
        key="handling_id",
        name=f"{name}.handling",
    )
    candidate_by_id = {item.candidate_id: item for item in candidates}
    evidence_by_id = {item.evidence_id: item for item in evidence}
    if any(item.candidate_id not in candidate_by_id for item in evidence):
        raise ValueError(f"{name}.evidence references an unknown candidate")
    for item in handling:
        referenced_evidence = evidence_by_id.get(item.evidence_id)
        if (
            item.candidate_id not in candidate_by_id
            or referenced_evidence is None
            or referenced_evidence.candidate_id != item.candidate_id
        ):
            raise ValueError(f"{name}.handling references an unknown or foreign record")
    considered = set(selection.candidate_ids_considered)
    if not considered.issubset(candidate_by_id):
        raise ValueError(f"{name}.selection considers an unknown candidate")
    if selection.canonical_candidate_id is None:
        if selection.canonical_model is not None:
            raise ValueError(f"{name}.selection canonical model requires a candidate")
        return
    canonical_evidence_id = selection.canonical_evidence_id
    if canonical_evidence_id is None:
        raise ValueError(f"{name}.selection canonical evidence requires a candidate")
    canonical_candidate = candidate_by_id.get(selection.canonical_candidate_id)
    canonical_evidence = evidence_by_id.get(canonical_evidence_id)
    if (
        canonical_candidate is None
        or selection.canonical_candidate_id not in considered
        or canonical_evidence is None
        or canonical_evidence.candidate_id != selection.canonical_candidate_id
        or selection.canonical_model is not canonical_candidate.model
    ):
        raise ValueError(f"{name}.selection references an inconsistent canonical record")


@dataclass(frozen=True, slots=True)
class EntryOracleEvent:
    event_id: str
    base_match_request: EntryMatchRequest
    htf_scan_requests: tuple[HTFFlipScanRequest, ...]

    def __post_init__(self) -> None:
        _require_closed_text(self.event_id, "event_id")
        if not isinstance(self.base_match_request, EntryMatchRequest):
            raise ValueError("base_match_request must be an EntryMatchRequest")
        if not isinstance(self.htf_scan_requests, tuple) or not all(
            isinstance(item, HTFFlipScanRequest) for item in self.htf_scan_requests
        ):
            raise ValueError("htf_scan_requests must contain HTFFlipScanRequest values")
        if any(item.setup != self.base_match_request.setup for item in self.htf_scan_requests):
            raise ValueError("HTF scan setup must match the event match request setup")


@dataclass(frozen=True, slots=True)
class EntryOracleCase:
    case_id: str
    setup_id: str
    symbol: str
    feed: str
    calculation_start_epoch: int
    emission_start_epoch: int
    emission_end_epoch: int
    pine_supported: bool
    events: tuple[EntryOracleEvent, ...]
    setup_invalidated: bool
    policy_version: Literal["rd-entry-arbitration-v2"]
    revision: int
    evaluated_at_epoch: int

    @classmethod
    def from_mapping(cls, value: object) -> Self:
        mapping = _strict_mapping(
            value,
            name="fixture case",
            keys=_FIXTURE_CASE_KEYS,
        )
        _validate_result_surface(mapping["expected"], "fixture case.expected")
        _validate_result_surface(
            mapping["pine_expected"],
            "fixture case.pine_expected",
        )
        replay_metadata = {key: mapping[key] for key in _REPLAY_METADATA_KEYS}
        return cls._from_input_mapping(
            mapping["input"],
            replay_metadata=replay_metadata,
            case_id=_as_text(mapping["case_id"], "fixture case.case_id"),
            expanded=False,
        )

    @classmethod
    def from_edge_mapping(
        cls,
        edge_input: object,
        *,
        replay_metadata: Mapping[str, object],
    ) -> Self:
        metadata = _strict_mapping(
            dict(replay_metadata),
            name="replay_metadata",
            keys=_REPLAY_METADATA_KEYS,
        )
        return cls._from_input_mapping(
            edge_input,
            replay_metadata=metadata,
            case_id=_as_text(metadata["setup_id"], "replay_metadata.setup_id"),
            expanded=True,
        )

    @classmethod
    def _from_input_mapping(
        cls,
        value: object,
        *,
        replay_metadata: Mapping[str, object],
        case_id: str,
        expanded: bool,
    ) -> Self:
        mapping = _strict_mapping(value, name="oracle input", keys=_INPUT_KEYS)
        events = tuple(
            _parse_event(
                item,
                name=f"oracle input.events[{index}]",
                expanded=expanded,
            )
            for index, item in enumerate(_strict_list(mapping["events"], "oracle input.events"))
        )
        _validate_event_identities(events)
        metadata_setup_id = _as_text(
            replay_metadata["setup_id"],
            "replay_metadata.setup_id",
        )
        input_setup_id = _as_text(mapping["setup_id"], "oracle input.setup_id")
        if input_setup_id != metadata_setup_id:
            raise ValueError("input setup_id must match replay metadata setup_id")
        return cls(
            case_id=case_id,
            setup_id=input_setup_id,
            symbol=_as_text(
                replay_metadata["symbol"],
                "replay_metadata.symbol",
            ),
            feed=_as_text(replay_metadata["feed"], "replay_metadata.feed"),
            calculation_start_epoch=_as_int(
                replay_metadata["calculation_start_epoch"],
                "replay_metadata.calculation_start_epoch",
                non_negative=True,
            ),
            emission_start_epoch=_as_int(
                replay_metadata["emission_start_epoch"],
                "replay_metadata.emission_start_epoch",
                non_negative=True,
            ),
            emission_end_epoch=_as_int(
                replay_metadata["emission_end_epoch"],
                "replay_metadata.emission_end_epoch",
                non_negative=True,
            ),
            pine_supported=_as_bool(
                replay_metadata["pine_supported"],
                "replay_metadata.pine_supported",
            ),
            events=events,
            setup_invalidated=_as_bool(
                mapping["setup_invalidated"],
                "oracle input.setup_invalidated",
            ),
            policy_version=_parse_policy_version(mapping["policy_version"]),
            revision=_as_int(
                mapping["revision"],
                "oracle input.revision",
                non_negative=True,
            ),
            evaluated_at_epoch=_as_int(
                mapping["evaluated_at_epoch"],
                "oracle input.evaluated_at_epoch",
                non_negative=True,
            ),
        )

    def __post_init__(self) -> None:
        for text_name, text_value in (
            ("case_id", self.case_id),
            ("setup_id", self.setup_id),
            ("symbol", self.symbol),
            ("feed", self.feed),
        ):
            _require_closed_text(text_value, text_name)
        for epoch_name, epoch_value in (
            ("calculation_start_epoch", self.calculation_start_epoch),
            ("emission_start_epoch", self.emission_start_epoch),
            ("emission_end_epoch", self.emission_end_epoch),
            ("revision", self.revision),
            ("evaluated_at_epoch", self.evaluated_at_epoch),
        ):
            _require_non_negative_int(epoch_value, epoch_name)
        if not (
            self.calculation_start_epoch <= self.emission_start_epoch <= self.emission_end_epoch
        ):
            raise ValueError("replay epochs must be calculation <= emission start <= end")
        if type(self.pine_supported) is not bool:
            raise ValueError("pine_supported must be a bool")
        if not isinstance(self.events, tuple) or not all(
            isinstance(item, EntryOracleEvent) for item in self.events
        ):
            raise ValueError("events must contain EntryOracleEvent values")
        if type(self.setup_invalidated) is not bool:
            raise ValueError("setup_invalidated must be a bool")
        if self.policy_version != "rd-entry-arbitration-v2":
            raise ValueError("policy_version must be rd-entry-arbitration-v2")
        baseline_request = self.events[0].base_match_request if self.events else None
        for event in self.events:
            request = event.base_match_request
            if request.setup.setup_id != self.setup_id:
                raise ValueError("event setup_id must match case setup_id")
            if baseline_request is not None:
                baseline_setup = baseline_request.setup
                immutable_setup = (
                    request.setup.setup_id,
                    request.setup.direction,
                    request.setup.zone_top_ticks,
                    request.setup.zone_bottom_ticks,
                    request.setup.zone_engaged_epoch,
                    request.setup.common_fidelity,
                )
                baseline_immutable_setup = (
                    baseline_setup.setup_id,
                    baseline_setup.direction,
                    baseline_setup.zone_top_ticks,
                    baseline_setup.zone_bottom_ticks,
                    baseline_setup.zone_engaged_epoch,
                    baseline_setup.common_fidelity,
                )
                if immutable_setup != baseline_immutable_setup or (
                    request.attempt_kind,
                    request.trigger_ordinal,
                ) != (
                    baseline_request.attempt_kind,
                    baseline_request.trigger_ordinal,
                ):
                    raise ValueError("event changed immutable setup or attempt facts")
            close_epoch = request.confirmed_bar.close_epoch
            if not self.emission_start_epoch <= close_epoch <= self.emission_end_epoch:
                raise ValueError("event close lies outside the inclusive emission window")

    def arbitration_request(
        self,
        *,
        setup_invalidated: bool,
        candidates: tuple[EntryCandidate, ...],
        evidence: tuple[EntryCandidateEvidence, ...],
    ) -> EntryArbitrationRequest:
        return EntryArbitrationRequest(
            setup_id=self.setup_id,
            setup_invalidated=setup_invalidated,
            policy_version=self.policy_version,
            revision=self.revision,
            candidates=candidates,
            evidence=evidence,
            evaluated_at_epoch=self.evaluated_at_epoch,
        )


@dataclass(frozen=True, slots=True)
class EntryOracleResult:
    htf_transcripts: tuple[HTFFlipProofTranscript, ...]
    candidates: tuple[EntryCandidate, ...]
    evidence: tuple[EntryCandidateEvidence, ...]
    handling: tuple[EntryHandlingObservation, ...]
    selection: EntrySelection

    def to_mapping(self) -> dict[str, object]:
        return {
            "htf_transcripts": [
                item.to_mapping()
                for item in sorted(
                    self.htf_transcripts,
                    key=lambda transcript: transcript.context_minutes,
                )
            ],
            "candidates": [
                _candidate_to_mapping(item)
                for item in sorted(
                    self.candidates,
                    key=lambda candidate: candidate.candidate_id,
                )
            ],
            "evidence": [
                _evidence_to_mapping(item)
                for item in sorted(
                    self.evidence,
                    key=lambda evidence: evidence.evidence_id,
                )
            ],
            "handling": [
                _handling_to_mapping(item)
                for item in sorted(
                    self.handling,
                    key=lambda handling: handling.handling_id,
                )
            ],
            "selection": _selection_to_mapping(self.selection),
        }


def _parse_policy_version(value: object) -> Literal["rd-entry-arbitration-v2"]:
    if value != "rd-entry-arbitration-v2":
        raise ValueError("policy_version must be rd-entry-arbitration-v2")
    return "rd-entry-arbitration-v2"


def _setup_to_mapping(setup: SetupEntryFacts) -> dict[str, object]:
    return {
        "setup_id": setup.setup_id,
        "direction": setup.direction.value,
        "zone_top_ticks": setup.zone_top_ticks,
        "zone_bottom_ticks": setup.zone_bottom_ticks,
        "zone_engaged_epoch": setup.zone_engaged_epoch,
        "invalidated_before_entry": setup.invalidated_before_entry,
        "common_fidelity": setup.common_fidelity.value,
        "terminal_reason": (
            setup.terminal_reason.value if setup.terminal_reason is not None else None
        ),
        "terminal_epoch": setup.terminal_epoch,
    }


def entry_match_request_to_mapping(request: EntryMatchRequest) -> dict[str, object]:
    """Serialize one scanner-free matcher input using validated transcripts only."""
    return {
        "setup": _setup_to_mapping(request.setup),
        "confirmed_bar": request.confirmed_bar.to_mapping(),
        "htf_proofs": [
            proof.transcript.to_mapping()
            for proof in sorted(
                request.htf_proofs,
                key=lambda proof: (
                    proof.transcript.context_minutes,
                    proof.transcript.htf_open_epoch,
                    proof.transcript.scan_cutoff_epoch,
                ),
            )
        ],
        "generic_break_detected": request.generic_break_detected,
        "rejection_respect_detected": request.rejection_respect_detected,
        "attempt_kind": request.attempt_kind.value,
        "trigger_ordinal": request.trigger_ordinal,
    }


def _candidate_to_mapping(candidate: EntryCandidate) -> dict[str, object]:
    return {
        "candidate_id": candidate.candidate_id,
        "setup_id": candidate.setup_id,
        "model": candidate.model.value,
        "state": candidate.state.value,
        "event_anchor_epoch": candidate.event_anchor_epoch,
        "trigger_ordinal": candidate.trigger_ordinal,
        "direction": candidate.direction.value,
        "source_claim_ids": list(candidate.source_claim_ids),
        "normalized_from": (
            candidate.normalized_from.value if candidate.normalized_from is not None else None
        ),
        "observed_at_epoch": candidate.observed_at_epoch,
    }


def _evidence_to_mapping(evidence: EntryCandidateEvidence) -> dict[str, object]:
    return {
        "evidence_id": evidence.evidence_id,
        "candidate_id": evidence.candidate_id,
        "observed_trigger_epoch": evidence.observed_trigger_epoch,
        "observed_trigger_ticks": evidence.observed_trigger_ticks,
        "htf_context_minutes": list(evidence.htf_context_minutes),
        "fidelity": evidence.fidelity.value,
        "proof_plane": evidence.proof_plane.value,
        "proof_resolution_seconds": evidence.proof_resolution_seconds,
        "coverage_start_epoch": evidence.coverage_start_epoch,
        "coverage_end_epoch": evidence.coverage_end_epoch,
        "ambiguity_codes": [item.value for item in evidence.ambiguity_codes],
        "passed_rule_ids": list(evidence.passed_rule_ids),
        "failed_rule_ids": list(evidence.failed_rule_ids),
        "source_claim_ids": list(evidence.source_claim_ids),
        "payload_sha256": evidence.payload_sha256,
        "observed_at_epoch": evidence.observed_at_epoch,
    }


def _handling_to_mapping(handling: EntryHandlingObservation) -> dict[str, object]:
    return {
        "handling_id": handling.handling_id,
        "candidate_id": handling.candidate_id,
        "evidence_id": handling.evidence_id,
        "handling_mode": handling.handling_mode.value,
        "attempt_kind": handling.attempt_kind.value,
        "observed_epoch": handling.observed_epoch,
        "observed_ticks": handling.observed_ticks,
        "fidelity": handling.fidelity.value,
        "source_claim_ids": list(handling.source_claim_ids),
    }


def _selection_to_mapping(selection: EntrySelection) -> dict[str, object]:
    return {
        "selection_id": selection.selection_id,
        "setup_id": selection.setup_id,
        "policy_version": selection.policy_version,
        "revision": selection.revision,
        "candidate_ids_considered": list(selection.candidate_ids_considered),
        "canonical_candidate_id": selection.canonical_candidate_id,
        "canonical_evidence_id": selection.canonical_evidence_id,
        "canonical_model": (
            selection.canonical_model.value if selection.canonical_model is not None else None
        ),
        "reason": selection.reason.value,
        "fidelity": (selection.fidelity.value if selection.fidelity is not None else None),
        "action": selection.action.value,
        "evaluated_at_epoch": selection.evaluated_at_epoch,
    }


def _merge_immutable[ValueT](
    destination: dict[str, ValueT],
    values: tuple[ValueT, ...],
    *,
    key: str,
) -> None:
    for value in values:
        identity = getattr(value, key)
        if not isinstance(identity, str):
            raise ValueError(f"{key} must be a string")
        prior = destination.get(identity)
        if prior is not None and prior != value:
            raise ValueError(f"{key} identity conflict: {identity}")
        destination[identity] = value


def _upsert_latest_htf_transcript(
    transcripts: dict[int, HTFFlipProofTranscript],
    transcript: HTFFlipProofTranscript,
) -> None:
    previous = transcripts.get(transcript.context_minutes)
    if previous is None:
        transcripts[transcript.context_minutes] = transcript
        return
    previous_boundary = (previous.htf_open_epoch, previous.scan_cutoff_epoch)
    current_boundary = (transcript.htf_open_epoch, transcript.scan_cutoff_epoch)
    if current_boundary < previous_boundary:
        raise ValueError("HTF transcript chronology moved backwards")
    if current_boundary == previous_boundary:
        if transcript != previous:
            raise ValueError("HTF transcript boundary has conflicting content")
        return
    transcripts[transcript.context_minutes] = transcript


def _next_candle_wick_handling(
    previous_event: EntryOracleEvent | None,
    current_event: EntryOracleEvent,
    directional_close: EntryCandidate | None,
    evidence_by_id: Mapping[str, EntryCandidateEvidence],
) -> EntryHandlingObservation | None:
    if previous_event is None or directional_close is None:
        return None
    previous_close = previous_event.base_match_request.confirmed_bar.close_epoch
    if directional_close.observed_at_epoch != previous_close:
        return None
    current = current_event.base_match_request.confirmed_bar
    if current.open_epoch != previous_close or current.close_epoch != current.open_epoch + 300:
        return None
    close_evidence = sorted(
        (
            item
            for item in evidence_by_id.values()
            if item.candidate_id == directional_close.candidate_id
            and item.proof_plane is ProofPlane.CONFIRMED_5M
            and item.observed_trigger_epoch == previous_close
        ),
        key=lambda item: item.evidence_id,
    )
    if not close_evidence:
        return None
    observed_ticks = (
        current.low_ticks
        if directional_close.direction is EntryDirection.LONG
        and current.low_ticks < min(current.open_ticks, current.close_ticks)
        else current.high_ticks
        if directional_close.direction is EntryDirection.SHORT
        and current.high_ticks > max(current.open_ticks, current.close_ticks)
        else None
    )
    if observed_ticks is None:
        return None
    identity = EntryHandlingIdentity(
        candidate_id=directional_close.candidate_id,
        evidence_id=close_evidence[0].evidence_id,
        handling_mode=HandlingMode.NEXT_CANDLE_WICK,
        attempt_kind=previous_event.base_match_request.attempt_kind,
        observed_epoch=current.close_epoch,
        observed_ticks=observed_ticks,
        fidelity=CandidateFidelity.DISCRETIONARY,
        source_claim_ids=NEXT_CANDLE_WICK_SOURCE_CLAIMS,
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


def _merge_terminal_fact(
    current: tuple[SetupAttemptTerminalReason, int] | None,
    setup: SetupEntryFacts,
    *,
    confirmed_epoch: int,
    active_models_before: frozenset[EntryModelV2],
    active_models_after: frozenset[EntryModelV2],
) -> tuple[SetupAttemptTerminalReason, int] | None:
    completed_both_now = not ACTIVE_ENTRY_MODELS.issubset(
        active_models_before
    ) and ACTIVE_ENTRY_MODELS.issubset(active_models_after)
    presented = (
        None if setup.terminal_reason is None else (setup.terminal_reason, setup.terminal_epoch)
    )
    if presented is None:
        if setup.terminal_epoch is not None or setup.invalidated_before_entry:
            raise ValueError("open setup carries terminal state")
        if completed_both_now:
            raise ValueError("both-model transition must terminalize on this event")
        return current
    if setup.terminal_epoch is None or setup.terminal_epoch != confirmed_epoch:
        raise ValueError("terminal epoch must equal the confirmed event epoch")
    if current is not None:
        if current == presented:
            return current
        raise ValueError("terminal setup fact changed")

    reason = setup.terminal_reason
    if completed_both_now and (
        reason is not SetupAttemptTerminalReason.BOTH_ACTIVE_MODELS_OBSERVED
    ):
        raise ValueError("event completing both models has wrong terminal reason")
    if reason is SetupAttemptTerminalReason.INVALIDATED:
        if active_models_after != active_models_before:
            raise ValueError("invalidation event emitted a new active candidate")
        expected_before_entry = len(active_models_before) == 0
        if setup.invalidated_before_entry is not expected_before_entry:
            raise ValueError("invalidated_before_entry disagrees with prior candidates")
    elif setup.invalidated_before_entry:
        raise ValueError("non-invalidation terminal cannot be invalidated_before_entry")
    if reason is SetupAttemptTerminalReason.BOTH_ACTIVE_MODELS_OBSERVED and not completed_both_now:
        raise ValueError("both-model terminal is not the exact completion event")
    assert reason is not None
    assert setup.terminal_epoch is not None
    return (reason, setup.terminal_epoch)


def evaluate_entry_stream(case: EntryOracleCase) -> EntryOracleResult:
    """Evaluate the accumulated reviewed event stream."""
    htf_transcripts_by_context: dict[int, HTFFlipProofTranscript] = {}
    candidates_by_id: dict[str, EntryCandidate] = {}
    candidates_by_model: dict[EntryModelV2, EntryCandidate] = {}
    evidence_by_id: dict[str, EntryCandidateEvidence] = {}
    handling_by_id: dict[str, EntryHandlingObservation] = {}
    events_by_id: dict[str, EntryOracleEvent] = {}
    for event in case.events:
        _merge_immutable(events_by_id, (event,), key="event_id")
    ordered_events = tuple(
        sorted(
            events_by_id.values(),
            key=lambda item: (
                item.base_match_request.confirmed_bar.close_epoch,
                item.event_id,
            ),
        )
    )
    terminal_fact: tuple[SetupAttemptTerminalReason, int] | None = None
    terminal_wick_grace_from: EntryOracleEvent | None = None
    terminal_wick_grace_consumed = False
    previous_event: EntryOracleEvent | None = None
    for event in ordered_events:
        if terminal_fact is not None:
            if terminal_wick_grace_from is None or terminal_wick_grace_consumed:
                raise ValueError("new trigger event after terminal setup fact")
            presented = (
                event.base_match_request.setup.terminal_reason,
                event.base_match_request.setup.terminal_epoch,
            )
            if presented != terminal_fact:
                raise ValueError("post-terminal handling event changed terminal fact")
            if (
                event.base_match_request.htf_proofs
                or event.htf_scan_requests
                or event.base_match_request.generic_break_detected
                or event.base_match_request.rejection_respect_detected
                or event.base_match_request.setup
                != terminal_wick_grace_from.base_match_request.setup
                or event.base_match_request.attempt_kind
                is not terminal_wick_grace_from.base_match_request.attempt_kind
                or event.base_match_request.trigger_ordinal
                != terminal_wick_grace_from.base_match_request.trigger_ordinal
            ):
                raise ValueError("post-terminal grace contains trigger input")
            wick_handling = _next_candle_wick_handling(
                terminal_wick_grace_from,
                event,
                candidates_by_model.get(EntryModelV2.DIR_CLOSE),
                evidence_by_id,
            )
            if wick_handling is not None:
                _merge_immutable(
                    handling_by_id,
                    (wick_handling,),
                    key="handling_id",
                )
            terminal_wick_grace_consumed = True
            previous_event = event
            continue

        wick_handling = _next_candle_wick_handling(
            previous_event,
            event,
            candidates_by_model.get(EntryModelV2.DIR_CLOSE),
            evidence_by_id,
        )
        if wick_handling is not None:
            _merge_immutable(
                handling_by_id,
                (wick_handling,),
                key="handling_id",
            )

        active_models_before = frozenset(candidates_by_model) & ACTIVE_ENTRY_MODELS
        if event.base_match_request.htf_proofs and event.htf_scan_requests:
            raise ValueError("event mixes raw scans with expanded HTF proofs")
        proofs = (
            event.base_match_request.htf_proofs
            if event.base_match_request.htf_proofs
            else tuple(scan_htf_flip(request) for request in event.htf_scan_requests)
        )
        for proof in proofs:
            _upsert_latest_htf_transcript(
                htf_transcripts_by_context,
                proof.transcript,
            )
        match_result = match_entry_candidates(replace(event.base_match_request, htf_proofs=proofs))
        accepted_candidate_ids: set[str] = set()
        for candidate in match_result.candidates:
            existing = candidates_by_model.get(candidate.model)
            if existing is not None:
                if existing != candidate:
                    continue
                accepted_candidate_ids.add(existing.candidate_id)
                continue
            _merge_immutable(
                candidates_by_id,
                (candidate,),
                key="candidate_id",
            )
            candidates_by_model[candidate.model] = candidate
            accepted_candidate_ids.add(candidate.candidate_id)
        _merge_immutable(
            evidence_by_id,
            tuple(
                item
                for item in match_result.evidence
                if item.candidate_id in accepted_candidate_ids
            ),
            key="evidence_id",
        )
        _merge_immutable(
            handling_by_id,
            tuple(
                item
                for item in match_result.handling
                if item.candidate_id in accepted_candidate_ids
            ),
            key="handling_id",
        )
        active_models_after = frozenset(candidates_by_model) & ACTIVE_ENTRY_MODELS
        dir_close_introduced_now = (
            EntryModelV2.DIR_CLOSE not in active_models_before
            and EntryModelV2.DIR_CLOSE in active_models_after
        )
        terminal_fact = _merge_terminal_fact(
            terminal_fact,
            event.base_match_request.setup,
            confirmed_epoch=event.base_match_request.confirmed_bar.close_epoch,
            active_models_before=active_models_before,
            active_models_after=active_models_after,
        )
        if (
            terminal_fact is not None
            and terminal_fact[0] is SetupAttemptTerminalReason.BOTH_ACTIVE_MODELS_OBSERVED
            and dir_close_introduced_now
            and EntryModelV2.HTF_FLIP in active_models_before
        ):
            terminal_wick_grace_from = event
        previous_event = event

    candidates = tuple(sorted(candidates_by_id.values(), key=lambda item: item.candidate_id))
    evidence = tuple(sorted(evidence_by_id.values(), key=lambda item: item.evidence_id))
    handling = tuple(sorted(handling_by_id.values(), key=lambda item: item.handling_id))
    accumulated_invalidated = (
        terminal_fact is not None
        and terminal_fact[0] is SetupAttemptTerminalReason.INVALIDATED
        and len(frozenset(candidates_by_model) & ACTIVE_ENTRY_MODELS) == 0
    )
    if case.setup_invalidated is not accumulated_invalidated:
        raise ValueError("case setup_invalidated disagrees with terminal fact")
    selection = arbitrate_entry_candidates(
        case.arbitration_request(
            setup_invalidated=accumulated_invalidated,
            candidates=candidates,
            evidence=evidence,
        )
    )
    return EntryOracleResult(
        htf_transcripts=tuple(
            htf_transcripts_by_context[context] for context in sorted(htf_transcripts_by_context)
        ),
        candidates=candidates,
        evidence=evidence,
        handling=handling,
        selection=selection,
    )
