from __future__ import annotations

import json
from pathlib import Path

from scripts.build_rd_entry_oracle_vectors_v3 import (
    build_vectors,
    load_fixture_document,
)

from prop_trading.contracts.rd_entry_vectors_v3 import (
    RDEntryArbitrationVectorsV3,
)

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
