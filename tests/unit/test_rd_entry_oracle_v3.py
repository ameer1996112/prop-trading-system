from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path

import pytest
from scripts.build_rd_entry_oracle_vectors_v3 import (
    build_vectors,
    load_fixture_document,
)

from prop_trading.contracts.rd_entry_vectors_v3 import (
    RDEntryArbitrationVectorsV3,
)
from prop_trading.domain.canonical import canonical_sha256

FIXTURES = Path("tests/fixtures/rd_entry_arbitration_cases_v3.json")
VECTORS = Path("contracts/vectors/rd-entry-arbitration-v3.json")
FROZEN_CASE_IDS = (
    "strict_long_boc_only",
    "strict_short_boc_only",
    "discretionary_boc_shadow",
    "boc_before_close",
    "flip_before_boc",
    "boc_flip_same_event",
    "same_event_price_conflict",
    "close_fallback_after_blocked_aggressive_models",
    "realtime_claim_not_realtime",
    "boc_wrong_direction",
    "boc_before_engagement",
    "opened_selection_is_frozen",
    "invalidated_setup_none",
)


def generated() -> dict[str, object]:
    return build_vectors(load_fixture_document(FIXTURES))


def cases_by_id() -> dict[str, dict[str, object]]:
    document = generated()
    cases = document["cases"]
    assert isinstance(cases, list)
    assert all(isinstance(case, dict) for case in cases)
    return {case["case_id"]: case for case in cases}  # type: ignore[misc]


def test_fixture_case_names_are_frozen() -> None:
    fixture = load_fixture_document(FIXTURES)
    cases = fixture["cases"]
    assert isinstance(cases, list)
    assert tuple(case["case_id"] for case in cases) == FROZEN_CASE_IDS  # type: ignore[index]


def test_generated_vectors_pass_the_strict_contract() -> None:
    parsed = RDEntryArbitrationVectorsV3.model_validate_json(
        json.dumps(generated(), allow_nan=False)
    )

    assert len(parsed.cases) == 13
    assert parsed.schema_id == "phase0.rd-entry-arbitration-vectors.v3"


def test_reviewed_outcomes_cover_chronology_co_trigger_and_fail_closed_paths() -> None:
    cases = cases_by_id()

    assert cases["boc_before_close"]["expected"]["selection"]["canonical_model"] == "BOC"  # type: ignore[index]
    assert cases["flip_before_boc"]["expected"]["selection"]["canonical_model"] == "HTF_FLIP"  # type: ignore[index]
    assert (
        cases["boc_flip_same_event"]["expected"]["selection"]["reason"] == "CO_TRIGGER_SAME_EVENT"  # type: ignore[index]
    )
    assert cases["boc_flip_same_event"]["expected"]["selection"]["co_triggered_models"] == [
        "BOC",
        "HTF_FLIP",
    ]  # type: ignore[index]
    assert (
        cases["same_event_price_conflict"]["expected"]["selection"]["action"] == "SHADOW_ONLY"  # type: ignore[index]
    )
    assert (
        cases["invalidated_setup_none"]["expected"]["selection"]["action"] == "NONE"  # type: ignore[index]
    )


def test_atomic_boc_flip_vector_retains_shared_actual_tick_beyond_threshold() -> None:
    case = cases_by_id()["boc_flip_same_event"]
    input_data = case["input"]
    expected = case["expected"]
    boc_proof = input_data["boc_proof"]
    flip_proof = input_data["htf_flip_proof"]
    selection = expected["selection"]

    assert boc_proof["trigger_epoch"] == flip_proof["trigger_epoch"]
    assert boc_proof["trigger_sequence"] == flip_proof["trigger_sequence"]
    assert boc_proof["trigger_ticks"] == flip_proof["trigger_ticks"]
    assert flip_proof["trigger_ticks"] == flip_proof["recross_candle"]["close_ticks"]
    assert flip_proof["trigger_ticks"] > flip_proof["htf_open_ticks"]
    assert selection["reason"] == "CO_TRIGGER_SAME_EVENT"
    assert selection["action"] == "PAPER_ELIGIBLE"
    assert selection["co_triggered_models"] == ["BOC", "HTF_FLIP"]


def test_checked_in_vectors_are_a_stable_regeneration() -> None:
    checked_in: object = json.loads(VECTORS.read_text(encoding="utf-8"))

    assert checked_in == generated()
    assert generated() == generated()


def _selection(case: dict[str, object]) -> dict[str, object]:
    expected = case["expected"]
    assert isinstance(expected, dict)
    selection = expected["selection"]
    assert isinstance(selection, dict)
    return selection


def _rehash_selection(selection: dict[str, object]) -> None:
    selection["selection_id"] = canonical_sha256(
        {
            "action": selection["action"],
            "candidate_ids_considered": selection["candidate_ids_considered"],
            "canonical_candidate_id": selection["canonical_candidate_id"],
            "canonical_evidence_id": selection["canonical_evidence_id"],
            "co_triggered_models": selection["co_triggered_models"],
            "fidelity": selection["fidelity"],
            "policy_version": selection["policy_version"],
            "reason": selection["reason"],
            "revision": selection["revision"],
            "setup_id": selection["setup_id"],
        }
    )


def _rehash_evidence(evidence: dict[str, object]) -> None:
    payload_keys = (
        "ambiguity_codes",
        "boc_tier",
        "candidate_id",
        "contact_candle",
        "coverage_end_epoch",
        "coverage_gap_detected",
        "coverage_start_epoch",
        "destination_seen_before_contact",
        "failed_rule_ids",
        "fidelity",
        "full_lifecycle_ordered",
        "htf_context_minutes",
        "htf_open_ticks",
        "observed_trigger_epoch",
        "observed_trigger_ticks",
        "passed_rule_ids",
        "proof_plane",
        "reference_candle_close_ticks",
        "reference_candle_high_ticks",
        "reference_candle_low_ticks",
        "reference_candle_open_epoch",
        "reference_candle_open_ticks",
        "recross_candle",
        "replayability",
        "source_claim_ids",
        "trigger_sequence",
    )
    evidence["payload_sha256"] = canonical_sha256({key: evidence[key] for key in payload_keys})
    evidence["evidence_id"] = canonical_sha256(
        {
            "candidate_id": evidence["candidate_id"],
            "coverage_end_epoch": evidence["coverage_end_epoch"],
            "coverage_start_epoch": evidence["coverage_start_epoch"],
            "observed_trigger_epoch": evidence["observed_trigger_epoch"],
            "payload_sha256": evidence["payload_sha256"],
            "proof_plane": evidence["proof_plane"],
            "trigger_sequence": evidence["trigger_sequence"],
        }
    )


def _validate_forged(document: dict[str, object]) -> None:
    RDEntryArbitrationVectorsV3.model_validate_json(json.dumps(document, allow_nan=False))


def test_vector_contract_rejects_unknown_considered_candidate() -> None:
    forged = deepcopy(generated())
    case = forged["cases"][0]  # type: ignore[index]
    selection = _selection(case)  # type: ignore[arg-type]
    selection["candidate_ids_considered"] = ["b" * 64]
    _rehash_selection(selection)

    with pytest.raises(ValueError, match="considered|candidate"):
        _validate_forged(forged)


def test_vector_contract_rejects_canonical_evidence_owned_by_another_candidate() -> None:
    forged = deepcopy(generated())
    case = next(  # type: ignore[union-attr]
        item for item in forged["cases"] if item["case_id"] == "boc_before_close"
    )
    expected = case["expected"]
    selection = _selection(case)
    evidence = expected["evidence"]
    canonical_candidate_id = selection["canonical_candidate_id"]
    other = next(item for item in evidence if item["candidate_id"] != canonical_candidate_id)
    selection["canonical_evidence_id"] = other["evidence_id"]
    _rehash_selection(selection)

    with pytest.raises(ValueError, match="canonical.*evidence|ownership"):
        _validate_forged(forged)


@pytest.mark.parametrize(
    ("field", "value", "message"),
    [
        ("canonical_model", "HTF_FLIP", "canonical.*model"),
        ("fidelity", "DISCRETIONARY", "canonical.*fidelity"),
    ],
)
def test_vector_contract_rejects_canonical_field_disagreement(
    field: str,
    value: str,
    message: str,
) -> None:
    forged = deepcopy(generated())
    case = forged["cases"][0]  # type: ignore[index]
    selection = _selection(case)  # type: ignore[arg-type]
    selection[field] = value
    _rehash_selection(selection)

    with pytest.raises(ValueError, match=message):
        _validate_forged(forged)


def test_vector_contract_rejects_observation_after_selection_evaluation() -> None:
    forged = deepcopy(generated())
    case = forged["cases"][0]  # type: ignore[index]
    expected = case["expected"]  # type: ignore[index]
    selection = _selection(case)  # type: ignore[arg-type]
    expected["candidates"][0]["observed_at_epoch"] = selection["evaluated_at_epoch"] + 1

    with pytest.raises(ValueError, match="observed|evaluation"):
        _validate_forged(forged)


def test_vector_contract_rejects_flip_anchor_after_contact() -> None:
    forged = deepcopy(generated())
    case = next(  # type: ignore[union-attr]
        item for item in forged["cases"] if item["case_id"] == "flip_before_boc"
    )
    case["input"]["htf_flip_proof"]["event_anchor_epoch"] = 2_700

    with pytest.raises(ValueError, match="anchor.*contact"):
        _validate_forged(forged)


def test_vector_contract_rejects_exact_flip_without_actual_close_cross() -> None:
    forged = deepcopy(generated())
    case = next(  # type: ignore[union-attr]
        item for item in forged["cases"] if item["case_id"] == "flip_before_boc"
    )
    input_data = case["input"]
    flip_proof = input_data["htf_flip_proof"]
    flip_proof["trigger_ticks"] = 109
    flip_proof["recross_candle"]["close_ticks"] = 109
    expected = case["expected"]
    selection = _selection(case)
    evidence = next(
        item
        for item in expected["evidence"]
        if item["candidate_id"] == selection["canonical_candidate_id"]
    )
    evidence["observed_trigger_ticks"] = 109
    evidence["recross_candle"]["close_ticks"] = 109
    _rehash_evidence(evidence)
    expected["evidence"].sort(key=lambda item: item["evidence_id"])
    selection["canonical_evidence_id"] = evidence["evidence_id"]
    _rehash_selection(selection)

    with pytest.raises(ValueError, match="cross|side|HTF open"):
        _validate_forged(forged)


def test_vector_contract_rejects_blocked_nonexact_failed_canonical_action() -> None:
    forged = deepcopy(generated())
    case = next(  # type: ignore[union-attr]
        item
        for item in forged["cases"]
        if item["case_id"] == "close_fallback_after_blocked_aggressive_models"
    )
    expected = case["expected"]
    blocked_candidate = next(item for item in expected["candidates"] if item["state"] == "BLOCKED")
    blocked_evidence = next(
        item
        for item in expected["evidence"]
        if item["candidate_id"] == blocked_candidate["candidate_id"]
    )
    selection = _selection(case)
    selection["canonical_candidate_id"] = blocked_candidate["candidate_id"]
    selection["canonical_evidence_id"] = blocked_evidence["evidence_id"]
    selection["canonical_model"] = blocked_candidate["model"]
    selection["fidelity"] = blocked_evidence["fidelity"]
    selection["reason"] = "ONLY_EXACT_TRIGGER"
    selection["action"] = "PAPER_ELIGIBLE"
    selection["co_triggered_models"] = []
    _rehash_selection(selection)

    with pytest.raises(ValueError, match="paper|eligible|matched|exact|failed"):
        _validate_forged(forged)


def test_vector_contract_rejects_blocked_candidate_with_exact_evidence() -> None:
    forged = deepcopy(generated())
    case = forged["cases"][0]  # type: ignore[index]
    candidate = case["expected"]["candidates"][0]  # type: ignore[index]
    candidate["state"] = "BLOCKED"

    with pytest.raises(ValueError, match="paper|eligible|matched"):
        _validate_forged(forged)
