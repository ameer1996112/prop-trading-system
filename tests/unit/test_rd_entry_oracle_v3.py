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


def _rehash_candidate(candidate: dict[str, object]) -> None:
    candidate["candidate_id"] = canonical_sha256(
        {
            "boc_tier": candidate["boc_tier"],
            "direction": candidate["direction"],
            "event_anchor_epoch": candidate["event_anchor_epoch"],
            "model": candidate["model"],
            "reference_candle_open_epoch": candidate["reference_candle_open_epoch"],
            "setup_id": candidate["setup_id"],
            "trigger_ordinal": candidate["trigger_ordinal"],
        }
    )


def _rehash_expected_graph(case: dict[str, object]) -> None:
    expected = case["expected"]
    assert isinstance(expected, dict)
    candidates = expected["candidates"]
    evidence = expected["evidence"]
    assert isinstance(candidates, list)
    assert isinstance(evidence, list)
    selection = _selection(case)

    candidate_id_changes: dict[object, object] = {}
    for candidate in candidates:
        old_candidate_id = candidate["candidate_id"]
        _rehash_candidate(candidate)
        candidate_id_changes[old_candidate_id] = candidate["candidate_id"]

    evidence_id_changes: dict[object, object] = {}
    for item in evidence:
        old_evidence_id = item["evidence_id"]
        item["candidate_id"] = candidate_id_changes[item["candidate_id"]]
        _rehash_evidence(item)
        evidence_id_changes[old_evidence_id] = item["evidence_id"]

    candidates.sort(key=lambda item: item["candidate_id"])
    evidence.sort(key=lambda item: item["evidence_id"])
    selection["candidate_ids_considered"] = [candidate["candidate_id"] for candidate in candidates]
    if selection["canonical_candidate_id"] is not None:
        selection["canonical_candidate_id"] = candidate_id_changes[
            selection["canonical_candidate_id"]
        ]
        selection["canonical_evidence_id"] = evidence_id_changes[selection["canonical_evidence_id"]]
    _rehash_selection(selection)


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


def test_vector_contract_rejects_flip_trigger_tick_different_from_recross_close() -> None:
    forged = deepcopy(generated())
    case = next(  # type: ignore[union-attr]
        item for item in forged["cases"] if item["case_id"] == "flip_before_boc"
    )
    case["input"]["htf_flip_proof"]["trigger_ticks"] = 112

    with pytest.raises(ValueError, match="trigger.*recross.*close"):
        _validate_forged(forged)


def test_vector_contract_binds_coordinated_input_actual_tick_to_expected_evidence() -> None:
    forged = deepcopy(generated())
    case = next(  # type: ignore[union-attr]
        item for item in forged["cases"] if item["case_id"] == "flip_before_boc"
    )
    flip_proof = case["input"]["htf_flip_proof"]
    flip_proof["trigger_ticks"] = 112
    flip_proof["recross_candle"]["close_ticks"] = 112

    with pytest.raises(ValueError, match="event|lifecycle|actual"):
        _validate_forged(forged)


@pytest.mark.parametrize(
    ("field", "value", "message"),
    [
        ("contact_candle", None, "recross.*contact"),
        ("coverage_start_epoch", 1_801, "contact.*coverage"),
        ("coverage_end_epoch", 1_801, "trigger.*coverage"),
        (
            "contact_candle",
            {
                "open_epoch": 1_800,
                "close_epoch": 1_802,
                "open_ticks": 105,
                "high_ticks": 110,
                "low_ticks": 100,
                "close_ticks": 105,
            },
            "contact.*recross",
        ),
        ("trigger_epoch", 1_803, "trigger.*recross.*close"),
    ],
)
def test_vector_contract_rejects_incomplete_flip_proof_chronology(
    field: str,
    value: object,
    message: str,
) -> None:
    forged = deepcopy(generated())
    case = next(  # type: ignore[union-attr]
        item for item in forged["cases"] if item["case_id"] == "flip_before_boc"
    )
    case["input"]["htf_flip_proof"][field] = value

    with pytest.raises(ValueError, match=message):
        _validate_forged(forged)


@pytest.mark.parametrize(
    ("field", "value", "message"),
    [
        ("htf_open_ticks", 109, "threshold|HTF open"),
        ("event_anchor_epoch", 1_500, "anchor"),
        ("trigger_sequence", 6, "sequence|event"),
        ("htf_context_minutes", [15], "context"),
    ],
)
def test_vector_contract_binds_flip_input_event_to_expected_evidence(
    field: str,
    value: object,
    message: str,
) -> None:
    forged = deepcopy(generated())
    case = next(  # type: ignore[union-attr]
        item for item in forged["cases"] if item["case_id"] == "flip_before_boc"
    )
    case["input"]["htf_flip_proof"][field] = value

    with pytest.raises(ValueError, match=message):
        _validate_forged(forged)


@pytest.mark.parametrize(
    ("candle_name", "field", "value"),
    [
        ("contact_candle", "close_ticks", 106),
        ("recross_candle", "open_ticks", 109),
    ],
)
def test_vector_contract_binds_flip_input_candles_to_expected_evidence(
    candle_name: str,
    field: str,
    value: int,
) -> None:
    forged = deepcopy(generated())
    case = next(  # type: ignore[union-attr]
        item for item in forged["cases"] if item["case_id"] == "flip_before_boc"
    )
    case["input"]["htf_flip_proof"][candle_name][field] = value

    with pytest.raises(ValueError, match="contact|recross|lifecycle"):
        _validate_forged(forged)


def test_vector_contract_rejects_long_flip_with_wrong_side_input_threshold() -> None:
    forged = deepcopy(generated())
    case = next(  # type: ignore[union-attr]
        item for item in forged["cases"] if item["case_id"] == "flip_before_boc"
    )
    case["input"]["htf_flip_proof"]["htf_open_ticks"] = 112

    with pytest.raises(ValueError, match="LONG|threshold|HTF open|cross"):
        _validate_forged(forged)


def test_vector_contract_rejects_fully_rehashed_short_wrong_side_actual_close() -> None:
    forged = deepcopy(generated())
    case = next(  # type: ignore[union-attr]
        item
        for item in forged["cases"]
        if item["case_id"] == "close_fallback_after_blocked_aggressive_models"
    )
    case["input"]["boc_proof"] = None
    case["input"]["direction"] = "SHORT"
    expected = case["expected"]
    boc_candidate = next(
        candidate for candidate in expected["candidates"] if candidate["model"] == "BOC"
    )
    expected["candidates"].remove(boc_candidate)
    expected["evidence"] = [
        item
        for item in expected["evidence"]
        if item["candidate_id"] != boc_candidate["candidate_id"]
    ]
    for candidate in expected["candidates"]:
        candidate["direction"] = "SHORT"
    _rehash_expected_graph(case)

    with pytest.raises(ValueError, match="SHORT|actual close|HTF open|cross"):
        _validate_forged(forged)


def test_vector_contract_binds_input_direction_to_expected_candidates() -> None:
    forged = deepcopy(generated())
    case = next(  # type: ignore[union-attr]
        item for item in forged["cases"] if item["case_id"] == "flip_before_boc"
    )
    case["input"]["direction"] = "SHORT"

    with pytest.raises(ValueError, match="direction"):
        _validate_forged(forged)


def test_vector_contract_binds_expected_claims_to_candidate_model() -> None:
    forged = deepcopy(generated())
    case = next(  # type: ignore[union-attr]
        item for item in forged["cases"] if item["case_id"] == "flip_before_boc"
    )
    expected = case["expected"]
    flip_candidate = next(
        candidate for candidate in expected["candidates"] if candidate["model"] == "HTF_FLIP"
    )
    flip_evidence = next(
        item
        for item in expected["evidence"]
        if item["candidate_id"] == flip_candidate["candidate_id"]
    )
    forged_claims = ["htf-flip-2024-03"]
    flip_candidate["source_claim_ids"] = forged_claims
    flip_evidence["source_claim_ids"] = forged_claims
    _rehash_evidence(flip_evidence)
    expected["evidence"].sort(key=lambda item: item["evidence_id"])
    selection = _selection(case)
    selection["canonical_evidence_id"] = flip_evidence["evidence_id"]
    _rehash_selection(selection)

    with pytest.raises(ValueError, match="claim"):
        _validate_forged(forged)


def test_vector_contract_binds_input_evaluation_to_expected_selection() -> None:
    forged = deepcopy(generated())
    case = next(  # type: ignore[union-attr]
        item for item in forged["cases"] if item["case_id"] == "flip_before_boc"
    )
    case["input"]["evaluated_at_epoch"] = 2_500

    with pytest.raises(ValueError, match="evaluat"):
        _validate_forged(forged)


def test_vector_contract_rejects_missing_blocked_flip_evidence() -> None:
    forged = deepcopy(generated())
    case = next(  # type: ignore[union-attr]
        item
        for item in forged["cases"]
        if item["case_id"] == "close_fallback_after_blocked_aggressive_models"
    )
    expected = case["expected"]
    flip_candidate = next(
        candidate for candidate in expected["candidates"] if candidate["model"] == "HTF_FLIP"
    )
    expected["evidence"] = [
        item
        for item in expected["evidence"]
        if item["candidate_id"] != flip_candidate["candidate_id"]
    ]

    with pytest.raises(ValueError, match="evidence|graph"):
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
