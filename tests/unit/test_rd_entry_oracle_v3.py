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
