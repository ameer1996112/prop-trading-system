from __future__ import annotations

import hashlib
import json
from copy import deepcopy
from pathlib import Path

import pytest
from pydantic import BaseModel, ValidationError

from prop_trading.contracts.models import (
    ActionGrantProtocol,
    ApprovedAlertManifest,
    CapacityEnvelope,
    CheckpointActiveSetup,
    CheckpointChunkBody,
    EvidenceStatus,
    GapTaintDeclaration,
    HeartbeatMetadata,
    RulePackResetMetadata,
    SourceProvenance,
    StrategyManifest,
)
from prop_trading.contracts.rd_entry_method_vectors_v1 import (
    load_rd_entry_method_vector_set_v1_json,
)
from prop_trading.contracts.rd_strategy_v3 import load_rd_strategy_contract_v3
from prop_trading.domain.canonical import canonical_json_bytes
from prop_trading.domain.rd_entry_models import (
    AmbiguityCode,
    CandidateFidelity,
    EntryEvidenceIdentity,
    EntrySelectionIdentity,
    ProofPlane,
    SelectionAction,
    SelectionReason,
    evidence_id,
    evidence_payload_sha256,
    selection_id,
)


def _load(model: type[BaseModel], path: str) -> BaseModel:
    return model.model_validate_json(Path(path).read_bytes())


def _json(path: str) -> dict[str, object]:
    loaded: object = json.loads(Path(path).read_text())
    assert isinstance(loaded, dict)
    return loaded


def test_frozen_foundation_contract_instances_are_valid_and_blocked() -> None:
    strategy = _load(StrategyManifest, "config/phase0/strategy-manifest.json")
    alert = _load(ApprovedAlertManifest, "config/phase0/approved-alert-manifest.json")
    action = _load(ActionGrantProtocol, "config/phase0/action-grant-protocol.json")
    capacity = _load(CapacityEnvelope, "config/phase0/capacity-envelope.json")
    rule = _load(RulePackResetMetadata, "config/phase0/synthetic-rule-pack-reset.json")

    assert strategy.activation_status is EvidenceStatus.BLOCKED
    assert strategy.pine.committed_clean is False
    assert alert.evidence_status is EvidenceStatus.UNVERIFIED
    assert alert.diagnostics_enabled is False
    assert action.single_use is True
    assert capacity.global_account_claims == 8
    assert rule.utc_period_semantics == "HALF_OPEN"
    assert len(rule.boundaries) == 3
    rd_strategy_v3 = load_rd_strategy_contract_v3()
    assert rd_strategy_v3.automation_policy.paper_only is True
    assert rd_strategy_v3.automation_policy.real_execution_allowed is False
    dst_duration = (
        rule.boundaries[2].utc_end.replace("Z", "+00:00"),
        rule.boundaries[2].utc_start.replace("Z", "+00:00"),
    )
    assert dst_duration == ("2026-03-29T23:00:00+00:00", "2026-03-29T00:00:00+00:00")


def test_strategy_cannot_claim_verified_with_missing_operator_or_clean_pine_evidence() -> None:
    payload = _json("config/phase0/strategy-manifest.json")
    payload["activation_status"] = "VERIFIED"
    with pytest.raises(ValidationError, match="activation evidence"):
        StrategyManifest.model_validate_json(json.dumps(payload))


def test_source_provenance_status_and_hash_claims_are_derived() -> None:
    clean = {
        "source_path": "candidate.pine",
        "source_repository_head": "b" * 40,
        "source_working_tree_status": "CLEAN",
        "working_content_sha256": "a" * 64,
        "head_content_sha256": "a" * 64,
        "content_matches_head": True,
        "committed_clean": True,
    }
    assert SourceProvenance.model_validate_json(json.dumps(clean)).committed_clean is True
    for change in (
        {"head_content_sha256": None},
        {"head_content_sha256": "c" * 64},
        {"content_matches_head": False},
        {"committed_clean": False},
    ):
        invalid = clean | change
        with pytest.raises(ValidationError, match="CLEAN|derived|dirty"):
            SourceProvenance.model_validate_json(json.dumps(invalid))

    modified_mode_only = clean | {
        "source_working_tree_status": "MODIFIED",
        "committed_clean": False,
    }
    assert (
        SourceProvenance.model_validate_json(json.dumps(modified_mode_only)).content_matches_head
        is True
    )
    modified_bytes = modified_mode_only | {
        "head_content_sha256": "c" * 64,
        "content_matches_head": False,
    }
    assert SourceProvenance.model_validate_json(json.dumps(modified_bytes)).committed_clean is False
    untracked = modified_bytes | {
        "source_working_tree_status": "UNTRACKED",
        "head_content_sha256": None,
    }
    assert SourceProvenance.model_validate_json(json.dumps(untracked)).content_matches_head is False
    with pytest.raises(ValidationError, match="UNTRACKED"):
        SourceProvenance.model_validate_json(
            json.dumps(untracked | {"head_content_sha256": "a" * 64})
        )
    with pytest.raises(ValidationError, match="committed_clean"):
        SourceProvenance.model_validate_json(
            json.dumps(modified_mode_only | {"committed_clean": True})
        )


@pytest.mark.parametrize("families", [[], ["HEARTBEAT"], ["HEARTBEAT"] * 3])
def test_alert_requires_exact_unique_payload_family_set(families: list[str]) -> None:
    payload = _json("config/phase0/approved-alert-manifest.json")
    payload["expected_payload_families"] = families
    with pytest.raises(ValidationError, match="exact unique"):
        ApprovedAlertManifest.model_validate_json(json.dumps(payload))


@pytest.mark.parametrize("bindings", [[], ["jti"], ["jti"] * 10])
def test_action_grant_requires_exact_unique_binding_set(bindings: list[str]) -> None:
    payload = _json("config/phase0/action-grant-protocol.json")
    payload["required_bindings"] = bindings
    with pytest.raises(ValidationError, match="exact unique"):
        ActionGrantProtocol.model_validate(payload)


def test_alert_cannot_claim_verified_without_redacted_configuration_and_recreation() -> None:
    payload = _json("config/phase0/approved-alert-manifest.json")
    payload["evidence_status"] = "VERIFIED"
    with pytest.raises(ValidationError, match="redacted configuration"):
        ApprovedAlertManifest.model_validate_json(json.dumps(payload))


@pytest.mark.parametrize(
    "timestamp",
    ["2026-02-30T00:00:00Z", "2026-01-01T25:00:00Z", "2026-13-01T00:00:00Z"],
)
def test_utc_timestamp_rejects_impossible_calendar_instants(timestamp: str) -> None:
    with pytest.raises(ValidationError, match="real UTC"):
        HeartbeatMetadata.model_validate(
            {
                "schema_id": "phase0.heartbeat.v1",
                "manifest_id": "alert-v1",
                "producer_identity": "producer-a",
                "stream_generation": 1,
                "sequence": 1,
                "confirmed_bar_close": timestamp,
                "timeframe_minutes": 5,
                "kind": "HEARTBEAT",
            }
        )


def _checkpoint_payload() -> dict[str, object]:
    setup_payload = {
        "natural_key": {
            "side": "DEMAND",
            "zone_key": "zone-a",
            "liquidity_key": "liquidity-a",
            "formation_bar_close": "2026-03-29T00:00:00Z",
        },
        "state": "WAITING_FOR_ELIGIBILITY",
        "reason_code": "WAIT_SETUP_ELIGIBILITY",
        "zone": {
            "top_ticks": 110,
            "bottom_ticks": 100,
            "origin_open": "2026-03-28T23:50:00Z",
            "origin_close": "2026-03-28T23:55:00Z",
        },
        "liquidity": {
            "price_ticks": 99,
            "origin_open": "2026-03-28T23:45:00Z",
            "origin_close": "2026-03-28T23:50:00Z",
        },
        "source_candle": {
            "open_time": "2026-03-28T23:55:00Z",
            "close_time": "2026-03-29T00:00:00Z",
            "open_ticks": 105,
            "high_ticks": 112,
            "low_ticks": 98,
            "close_ticks": 107,
        },
    }
    setup = CheckpointActiveSetup.model_validate_json(json.dumps(setup_payload))
    setups = [setup.model_dump(mode="json")]
    body_bytes = canonical_json_bytes(setups)
    digest = hashlib.sha256(body_bytes).hexdigest()
    identity = hashlib.sha256(
        canonical_json_bytes(setup.natural_key.model_dump(mode="json"))
    ).hexdigest()
    return {
        "schema_id": "phase0.checkpoint-chunk-body.v1",
        "metadata": {
            "schema_id": "phase0.checkpoint-chunk.v1",
            "manifest_id": "alert-v1",
            "producer_identity": "producer-a",
            "stream_generation": 1,
            "checkpoint_id": "checkpoint-a",
            "covers_through_sequence": 12,
            "logical_sequence": 12,
            "confirmed_bar_close": "2026-03-29T00:00:00Z",
            "full_set_count": 1,
            "full_set_sha256": digest,
            "chunk_index": 0,
            "chunk_count": 1,
            "chunk_bytes": len(body_bytes),
            "chunk_sha256": digest,
            "first_setup_identity": identity,
            "last_setup_identity": identity,
            "staged_only": True,
        },
        "setups": setups,
    }


def test_checkpoint_body_verifies_sequence_bar_order_count_bytes_and_digests() -> None:
    payload = _checkpoint_payload()
    parsed = CheckpointChunkBody.model_validate_json(json.dumps(payload))
    assert parsed.metadata.confirmed_bar_close == "2026-03-29T00:00:00Z"
    assert parsed.metadata.logical_sequence == 12
    for path, value, message in (
        (("metadata", "logical_sequence"), 11, "logical_sequence"),
        (("metadata", "chunk_sha256"), "a" * 64, "chunk_sha256"),
        (("metadata", "chunk_bytes"), 1, "chunk_bytes"),
        (("metadata", "full_set_count"), 2, "entire declared full set"),
    ):
        invalid = deepcopy(payload)
        current = invalid
        for key in path[:-1]:
            next_value = current[key]  # type: ignore[index]
            assert isinstance(next_value, dict)
            current = next_value
        current[path[-1]] = value
        with pytest.raises(ValidationError, match=message):
            CheckpointChunkBody.model_validate_json(json.dumps(invalid))


def test_checkpoint_body_rejects_non_monotonic_or_duplicate_sort_keys() -> None:
    payload = _checkpoint_payload()
    setups = payload["setups"]
    assert isinstance(setups, list)
    second = deepcopy(setups[0])
    assert isinstance(second, dict)
    setups.append(second)
    body_bytes = canonical_json_bytes(setups)
    digest = hashlib.sha256(body_bytes).hexdigest()
    metadata = payload["metadata"]
    assert isinstance(metadata, dict)
    metadata.update(
        full_set_count=2,
        full_set_sha256=digest,
        chunk_bytes=len(body_bytes),
        chunk_sha256=digest,
    )
    with pytest.raises(ValidationError, match="unique canonical natural-key"):
        CheckpointChunkBody.model_validate_json(json.dumps(payload))


def test_checkpoint_body_rejects_terminal_state_negative_oracle_and_unbound_fields() -> None:
    for path, value, message in (
        (("setups", 0, "state"), "TRIGGERED", "WAITING_FOR_ELIGIBILITY"),
        (("setups", 0, "reason_code"), "ARM_SETUP_AFTER_LIQUIDITY", "disagree"),
        (("setups", 0, "liquidity", "price_ticks"), 111, "demand liquidity"),
        (("setups", 0, "source_candle", "high_ticks"), 104, "high_ticks"),
    ):
        payload = _checkpoint_payload()
        current: object = payload
        for key in path[:-1]:
            assert isinstance(current, dict | list)
            current = current[key]  # type: ignore[index]
        assert isinstance(current, dict)
        current[path[-1]] = value
        with pytest.raises(ValidationError, match=message):
            CheckpointChunkBody.model_validate_json(json.dumps(payload))
    payload = _checkpoint_payload()
    setups = payload["setups"]
    assert isinstance(setups, list)
    assert isinstance(setups[0], dict)
    setups[0]["entry_ticks"] = 108
    with pytest.raises(ValidationError, match="Extra inputs"):
        CheckpointChunkBody.model_validate_json(json.dumps(payload))


def test_checkpoint_digest_binds_every_included_active_setup_body_byte() -> None:
    payload = _checkpoint_payload()
    setups = payload["setups"]
    assert isinstance(setups, list)
    assert isinstance(setups[0], dict)
    zone = setups[0]["zone"]
    assert isinstance(zone, dict)
    zone["top_ticks"] = 111
    with pytest.raises(ValidationError, match="chunk_sha256"):
        CheckpointChunkBody.model_validate_json(json.dumps(payload))


def test_checkpoint_allows_older_formation_but_binds_snapshot_candle_to_checkpoint() -> None:
    payload = _checkpoint_payload()
    setups = payload["setups"]
    assert isinstance(setups, list)
    setup = setups[0]
    assert isinstance(setup, dict)
    natural_key = setup["natural_key"]
    assert isinstance(natural_key, dict)
    natural_key["formation_bar_close"] = "2026-03-28T23:55:00Z"
    body_bytes = canonical_json_bytes(setups)
    digest = hashlib.sha256(body_bytes).hexdigest()
    identity = hashlib.sha256(canonical_json_bytes(natural_key)).hexdigest()
    metadata = payload["metadata"]
    assert isinstance(metadata, dict)
    metadata.update(
        full_set_sha256=digest,
        chunk_bytes=len(body_bytes),
        chunk_sha256=digest,
        first_setup_identity=identity,
        last_setup_identity=identity,
    )
    assert (
        CheckpointChunkBody.model_validate_json(json.dumps(payload))
        .setups[0]
        .natural_key.formation_bar_close
        == "2026-03-28T23:55:00Z"
    )

    for path, value, message in (
        (("setups", 0, "natural_key", "formation_bar_close"), "2026-03-29T00:05:00Z", "formation"),
        (("setups", 0, "source_candle", "close_time"), "2026-03-29T00:05:00Z", "source candle"),
    ):
        invalid = _checkpoint_payload()
        current: object = invalid
        for key in path[:-1]:
            assert isinstance(current, dict | list)
            current = current[key]  # type: ignore[index]
        assert isinstance(current, dict)
        current[path[-1]] = value
        with pytest.raises(ValidationError, match=message):
            CheckpointChunkBody.model_validate_json(json.dumps(invalid))


def test_checkpoint_timestamp_comparisons_preserve_nanoseconds_and_instant_equivalence() -> None:
    future_formation = _checkpoint_payload()
    setups = future_formation["setups"]
    assert isinstance(setups, list)
    setup = setups[0]
    assert isinstance(setup, dict)
    natural_key = setup["natural_key"]
    assert isinstance(natural_key, dict)
    natural_key["formation_bar_close"] = "2026-03-29T00:00:00.000000001Z"
    with pytest.raises(ValidationError, match="formation"):
        CheckpointChunkBody.model_validate_json(json.dumps(future_formation))

    equivalent_spelling = _checkpoint_payload()
    setups = equivalent_spelling["setups"]
    assert isinstance(setups, list)
    setup = setups[0]
    assert isinstance(setup, dict)
    source_candle = setup["source_candle"]
    assert isinstance(source_candle, dict)
    source_candle["open_time"] = "2026-03-28T23:55:00.0Z"
    source_candle["close_time"] = "2026-03-29T00:00:00.0Z"
    body_bytes = canonical_json_bytes(setups)
    digest = hashlib.sha256(body_bytes).hexdigest()
    metadata = equivalent_spelling["metadata"]
    assert isinstance(metadata, dict)
    metadata.update(
        full_set_sha256=digest,
        chunk_bytes=len(body_bytes),
        chunk_sha256=digest,
    )
    assert CheckpointChunkBody.model_validate_json(json.dumps(equivalent_spelling))


def test_checkpoint_rejects_non_five_minute_geometry() -> None:
    for geometry_name, close_field, invalid_close in (
        ("zone", "origin_close", "2026-03-28T23:50:01Z"),
        ("liquidity", "origin_close", "2026-03-28T23:45:01Z"),
        ("source_candle", "close_time", "2026-03-28T23:55:01Z"),
    ):
        payload = _checkpoint_payload()
        setups = payload["setups"]
        assert isinstance(setups, list)
        setup = setups[0]
        assert isinstance(setup, dict)
        geometry = setup[geometry_name]
        assert isinstance(geometry, dict)
        geometry[close_field] = invalid_close
        with pytest.raises(ValidationError, match="exactly 300 seconds"):
            CheckpointActiveSetup.model_validate(setup)


def _gap(reason: str) -> dict[str, object]:
    return {
        "schema_id": "phase0.gap-taint.v1",
        "gap_id": f"gap-{reason.lower()}",
        "producer_identity": "producer-a",
        "stream_generation": 2,
        "last_contiguous_sequence": None,
        "first_observed_after_gap": None,
        "conflicting_sequence": None,
        "previous_stream_generation": None,
        "affected_checkpoint_id": None,
        "detection_reason": reason,
        "allocations_frozen": True,
        "pre_gap_setups_permanently_tainted": True,
        "recovery_checkpoint_setups_permanently_tainted": True,
        "retrospective_execution_forbidden": True,
        "recovery_state": "GAP_FROZEN",
        "recovery_checkpoint_id": None,
    }


def test_gap_taint_reason_specific_evidence_never_invents_a_missing_width() -> None:
    sequence_gap = _gap("SEQUENCE_GAP") | {
        "last_contiguous_sequence": 4,
        "first_observed_after_gap": 7,
    }
    duplicate = _gap("CONFLICTING_DUPLICATE") | {"conflicting_sequence": 4}
    generation = _gap("UNPLANNED_GENERATION_RESET") | {"previous_stream_generation": 1}
    timeout = _gap("CHECKPOINT_TIMEOUT") | {"affected_checkpoint_id": "checkpoint-a"}
    for payload in (sequence_gap, duplicate, generation, timeout):
        assert GapTaintDeclaration.model_validate(payload).allocations_frozen is True
    invalid_gap = sequence_gap | {"first_observed_after_gap": 5}
    with pytest.raises(ValidationError, match="positive missing"):
        GapTaintDeclaration.model_validate(invalid_gap)


def test_gap_taint_recovery_requires_a_complete_checkpoint() -> None:
    payload = _gap("CHECKPOINT_TIMEOUT") | {
        "affected_checkpoint_id": "checkpoint-a",
        "recovery_state": "ACTIVE_FOR_NEW_LIFECYCLES",
    }
    with pytest.raises(ValidationError, match="complete checkpoint"):
        GapTaintDeclaration.model_validate(payload)


def _single_boundary_rule(
    *,
    zone: str,
    reset: str,
    local_date: str,
    label: str,
    utc_start: str,
    utc_end: str,
    resolution: str,
    offset: str,
) -> dict[str, object]:
    base = _json("config/phase0/synthetic-rule-pack-reset.json")
    base.update(iana_timezone=zone, local_reset_time=reset)
    base["boundaries"] = [
        {
            "local_period_date": local_date,
            "scheduled_local_label": label,
            "utc_start": utc_start,
            "utc_end": utc_end,
            "resolution": resolution,
            "utc_offset": offset,
        }
    ]
    return base


def test_rule_pack_derives_spring_gap_and_fall_fold_from_bundled_tzdb() -> None:
    spring = _single_boundary_rule(
        zone="Europe/London",
        reset="01:30:00",
        local_date="2026-03-29",
        label="2026-03-29T01:30:00 Europe/London",
        utc_start="2026-03-29T01:00:00Z",
        utc_end="2026-03-30T00:30:00Z",
        resolution="GAP_FORWARD",
        offset="+01:00",
    )
    fall = _single_boundary_rule(
        zone="Europe/London",
        reset="01:30:00",
        local_date="2026-10-25",
        label="2026-10-25T01:30:00 Europe/London",
        utc_start="2026-10-25T00:30:00Z",
        utc_end="2026-10-26T01:30:00Z",
        resolution="FOLD_EARLY",
        offset="+01:00",
    )
    assert RulePackResetMetadata.model_validate(spring).boundaries[0].resolution == "GAP_FORWARD"
    assert RulePackResetMetadata.model_validate(fall).boundaries[0].resolution == "FOLD_EARLY"


def test_rule_pack_derives_non_hour_lord_howe_transition() -> None:
    payload = _single_boundary_rule(
        zone="Australia/Lord_Howe",
        reset="02:15:00",
        local_date="2026-10-04",
        label="2026-10-04T02:15:00 Australia/Lord_Howe",
        utc_start="2026-10-03T15:30:00Z",
        utc_end="2026-10-04T15:15:00Z",
        resolution="GAP_FORWARD",
        offset="+11:00",
    )
    assert RulePackResetMetadata.model_validate(payload).boundaries[0].utc_start.endswith("Z")


@pytest.mark.parametrize(
    ("mutator", "message"),
    [
        (lambda payload: payload.update(boundaries=[]), "at least 1"),
        (
            lambda payload: payload["boundaries"][1].update(local_period_date="2026-02-30"),
            "real calendar",
        ),
        (
            lambda payload: payload["boundaries"][0].update(utc_end="2026-03-26T23:59:59Z"),
            "before utc_end",
        ),
    ],
)
def test_rule_pack_rejects_invalid_boundary_series(mutator: object, message: str) -> None:
    payload = _json("config/phase0/synthetic-rule-pack-reset.json")
    assert callable(mutator)
    mutator(payload)
    with pytest.raises(ValidationError, match=message):
        RulePackResetMetadata.model_validate(payload)


@pytest.mark.parametrize(
    ("change", "message"),
    [
        ({"iana_timezone": "Invalid/Nowhere"}, "absent from the pinned"),
        ({"iana_timezone": "../Europe/London"}, "unsupported or unsafe"),
        ({"tzdb_version": "2099z"}, "must match bundled"),
    ],
)
def test_rule_pack_rejects_unsupported_zone_or_tzdb(change: dict[str, str], message: str) -> None:
    payload = _json("config/phase0/synthetic-rule-pack-reset.json") | change
    with pytest.raises(ValidationError, match=message):
        RulePackResetMetadata.model_validate(payload)


@pytest.mark.parametrize(
    ("field", "value", "message"),
    [
        ("scheduled_local_label", "2026-03-29T00:00:00 UTC", "scheduled local label"),
        ("utc_start", "2026-03-26T23:00:00Z", "stored UTC period"),
        ("utc_end", "2026-03-30T00:00:00Z", "stored UTC period"),
        ("utc_offset", "+01:00", "stored UTC offset"),
        ("resolution", "FOLD_EARLY", "stored reset resolution"),
    ],
)
def test_rule_pack_rejects_false_derived_boundary_fact(
    field: str, value: str, message: str
) -> None:
    payload = _json("config/phase0/synthetic-rule-pack-reset.json")
    boundaries = payload["boundaries"]
    assert isinstance(boundaries, list)
    assert isinstance(boundaries[0], dict)
    boundaries[0][field] = value
    with pytest.raises(ValidationError, match=message):
        RulePackResetMetadata.model_validate(payload)


def test_contracts_forbid_unknown_fields() -> None:
    payload = _json("config/phase0/capacity-envelope.json")
    payload["silent_queue_overflow"] = True
    with pytest.raises(ValidationError, match="Extra inputs"):
        CapacityEnvelope.model_validate(payload)


def test_rd_entry_method_vectors_are_strict_and_domain_replayable() -> None:
    raw = Path("contracts/vectors/rd-entry-method-v1.json").read_bytes()
    payload = _json("contracts/vectors/rd-entry-method-v1.json")
    parsed = load_rd_entry_method_vector_set_v1_json(raw)

    assert len(parsed.cases) == 14
    assert {item.case_id for item in parsed.cases} == {
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

    changed = deepcopy(payload)
    changed["cases"][0]["expected"]["action"] = "NONE"
    with pytest.raises(ValidationError, match="canonical domain"):
        load_rd_entry_method_vector_set_v1_json(json.dumps(changed))

    unknown = deepcopy(payload)
    unknown["cases"][0]["input"]["unknown"] = True
    with pytest.raises(ValidationError, match="Extra inputs"):
        load_rd_entry_method_vector_set_v1_json(json.dumps(unknown))


def test_rd_entry_method_vector_cannot_erase_ambiguity_evidence() -> None:
    payload = _json("contracts/vectors/rd-entry-method-v1.json")
    paper_case = next(
        item for item in payload["cases"] if item["case_id"] == "dir_close_defaults_prompt"
    )
    paper_case["input"]["evidence"]["ambiguity_codes"] = ["SHADOW_MISSING_INTRABAR_COVERAGE"]

    with pytest.raises(ValidationError, match="canonical domain|paper eligible"):
        load_rd_entry_method_vector_set_v1_json(json.dumps(payload))

    coordinated = _json("contracts/vectors/rd-entry-method-v1.json")
    coordinated_case = next(
        item for item in coordinated["cases"] if item["case_id"] == "dir_close_defaults_prompt"
    )
    evidence = coordinated_case["input"]["evidence"]
    ambiguity = (AmbiguityCode.MISSING_INTRABAR_COVERAGE,)
    evidence["ambiguity_codes"] = [item.value for item in ambiguity]
    evidence["payload_sha256"] = evidence_payload_sha256(
        candidate_id=evidence["candidate_id"],
        observed_trigger_epoch=evidence["observed_trigger_epoch"],
        observed_trigger_ticks=evidence["observed_trigger_ticks"],
        htf_context_minutes=tuple(evidence["htf_context_minutes"]),
        fidelity=CandidateFidelity(evidence["fidelity"]),
        proof_plane=ProofPlane(evidence["proof_plane"]),
        proof_resolution_seconds=evidence["proof_resolution_seconds"],
        coverage_start_epoch=evidence["coverage_start_epoch"],
        coverage_end_epoch=evidence["coverage_end_epoch"],
        ambiguity_codes=ambiguity,
        passed_rule_ids=tuple(evidence["passed_rule_ids"]),
        failed_rule_ids=tuple(evidence["failed_rule_ids"]),
        source_claim_ids=tuple(evidence["source_claim_ids"]),
    )
    evidence["evidence_id"] = evidence_id(
        EntryEvidenceIdentity(
            candidate_id=evidence["candidate_id"],
            proof_plane=ProofPlane(evidence["proof_plane"]),
            proof_resolution_seconds=evidence["proof_resolution_seconds"],
            coverage_start_epoch=evidence["coverage_start_epoch"],
            coverage_end_epoch=evidence["coverage_end_epoch"],
            observed_trigger_epoch=evidence["observed_trigger_epoch"],
            payload_sha256=evidence["payload_sha256"],
        )
    )
    selection = coordinated_case["input"]["selection"]
    selection["canonical_evidence_id"] = evidence["evidence_id"]
    selection["selection_id"] = selection_id(
        EntrySelectionIdentity(
            setup_id=selection["setup_id"],
            policy_version=selection["policy_version"],
            revision=selection["revision"],
            candidate_ids_considered=tuple(selection["candidate_ids_considered"]),
            canonical_candidate_id=selection["canonical_candidate_id"],
            canonical_evidence_id=selection["canonical_evidence_id"],
            reason=SelectionReason(selection["reason"]),
            fidelity=CandidateFidelity(selection["fidelity"]),
            action=SelectionAction(selection["action"]),
        )
    )

    with pytest.raises(ValidationError, match="paper eligible"):
        load_rd_entry_method_vector_set_v1_json(json.dumps(coordinated))


def test_rd_entry_method_vector_loader_rejects_duplicate_keys_and_non_finite_values() -> None:
    raw = Path("contracts/vectors/rd-entry-method-v1.json").read_text(encoding="utf-8")
    duplicate = raw.replace(
        '"schema_id": "phase0.rd-entry-method-vectors.v1"',
        (
            '"schema_id": "phase0.rd-entry-method-vectors.v1", '
            '"schema_id": "phase0.rd-entry-method-vectors.v1"'
        ),
        1,
    )
    with pytest.raises(ValueError, match="duplicate JSON object key: schema_id"):
        load_rd_entry_method_vector_set_v1_json(duplicate)

    non_finite = raw.replace('"trigger_ticks": 18500', '"trigger_ticks": NaN', 1)
    with pytest.raises(ValueError, match="non-finite JSON number.*NaN"):
        load_rd_entry_method_vector_set_v1_json(non_finite)
