"""Build deterministic RD three-entry arbitration vectors from reviewed fixtures."""

from __future__ import annotations

import argparse
import json
import math
import sys
from collections.abc import Sequence
from pathlib import Path
from typing import NoReturn

from prop_trading.contracts.rd_entry_vectors_v3 import (
    RDEntryArbitrationInputV3,
    RDEntryArbitrationVectorsV3,
    RDEntryBocProofVectorV3,
    RDEntryCandleVectorV3,
    RDEntryOpenedSelectionSeedV3,
    RDEntryTriggerProofVectorV3,
)
from prop_trading.contracts.rd_strategy_v3 import load_rd_strategy_contract_v3
from prop_trading.domain.rd_entry_arbitrator_v3 import (
    EntryArbitrationRequestV3,
    arbitrate_entry_candidates_v3,
)
from prop_trading.domain.rd_entry_matcher_v3 import (
    EntryMatchRequestV3,
    EntryMatchResultV3,
    SetupEntryFactsV3,
    match_entry_candidates_v3,
)
from prop_trading.domain.rd_entry_models import (
    AmbiguityCode,
    CandidateFidelity,
    EntryDirection,
    OrderedCandle,
    ProofPlane,
)
from prop_trading.domain.rd_entry_models_v3 import (
    BocProof,
    EntrySelectionV3,
    EntryTriggerProofV3,
    EvidenceReplayability,
)

_FIXTURE_SCHEMA_ID = "phase0.rd-entry-arbitration-fixture.v3"


def _reject_constant(value: str) -> NoReturn:
    raise ValueError(f"non-finite JSON constant is forbidden: {value}")


def _strict_object(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"duplicate JSON key: {key}")
        result[key] = value
    return result


def load_fixture_document(path: Path) -> dict[str, object]:
    loaded: object = json.loads(
        path.read_text(encoding="utf-8"),
        object_pairs_hook=_strict_object,
        parse_constant=_reject_constant,
    )
    if not isinstance(loaded, dict):
        raise ValueError("fixture document must be an object")
    if set(loaded) != {"schema_id", "cases"}:
        raise ValueError("fixture document keys are not exact")
    if loaded["schema_id"] != _FIXTURE_SCHEMA_ID:
        raise ValueError(f"fixture schema_id must be {_FIXTURE_SCHEMA_ID}")
    cases = loaded["cases"]
    if not isinstance(cases, list) or len(cases) != 13:
        raise ValueError("fixture document must contain exactly 13 cases")
    return loaded


def _candle(value: RDEntryCandleVectorV3) -> OrderedCandle:
    return OrderedCandle(
        open_epoch=value.open_epoch,
        close_epoch=value.close_epoch,
        open_ticks=value.open_ticks,
        high_ticks=value.high_ticks,
        low_ticks=value.low_ticks,
        close_ticks=value.close_ticks,
    )


def _boc_proof(value: RDEntryBocProofVectorV3 | None) -> BocProof | None:
    if value is None:
        return None
    return BocProof(
        reference_candle=_candle(value.reference_candle),
        trigger_candle_open_epoch=value.trigger_candle_open_epoch,
        trigger_epoch=value.trigger_epoch,
        trigger_sequence=value.trigger_sequence,
        trigger_ticks=value.trigger_ticks,
        htf_boundary_epoch=value.htf_boundary_epoch,
        htf_context_minutes=value.htf_context_minutes,
        proof_plane=ProofPlane(value.proof_plane),
        replayability=EvidenceReplayability(value.replayability),
        fidelity=CandidateFidelity(value.fidelity),
        coverage_start_epoch=value.coverage_start_epoch,
        coverage_end_epoch=value.coverage_end_epoch,
        is_realtime=value.is_realtime,
    )


def _trigger_proof(
    value: RDEntryTriggerProofVectorV3 | None,
) -> EntryTriggerProofV3 | None:
    if value is None:
        return None
    return EntryTriggerProofV3(
        event_anchor_epoch=value.event_anchor_epoch,
        trigger_epoch=value.trigger_epoch,
        trigger_sequence=value.trigger_sequence,
        trigger_ticks=value.trigger_ticks,
        htf_open_ticks=value.htf_open_ticks,
        htf_context_minutes=value.htf_context_minutes,
        proof_plane=ProofPlane(value.proof_plane),
        replayability=EvidenceReplayability(value.replayability),
        fidelity=CandidateFidelity(value.fidelity),
        coverage_start_epoch=value.coverage_start_epoch,
        coverage_end_epoch=value.coverage_end_epoch,
        is_realtime=value.is_realtime,
        contact_candle=(
            _candle(value.contact_candle) if value.contact_candle is not None else None
        ),
        recross_candle=(
            _candle(value.recross_candle) if value.recross_candle is not None else None
        ),
        coverage_gap_detected=value.coverage_gap_detected,
        full_lifecycle_ordered=value.full_lifecycle_ordered,
        destination_seen_before_contact=value.destination_seen_before_contact,
        ambiguity_codes=tuple(AmbiguityCode(code) for code in value.ambiguity_codes),
    )


def _setup(value: RDEntryArbitrationInputV3) -> SetupEntryFactsV3:
    return SetupEntryFactsV3(
        setup_id=value.setup_id,
        direction=EntryDirection(value.direction),
        zone_top_ticks=value.zone_top_ticks,
        zone_bottom_ticks=value.zone_bottom_ticks,
        zone_engaged_epoch=value.zone_engaged_epoch,
        invalidated_before_entry=value.setup_invalidated,
        common_fidelity=CandidateFidelity(value.common_fidelity),
    )


def _opened_selection(
    value: RDEntryArbitrationInputV3,
    seed: RDEntryOpenedSelectionSeedV3 | None,
) -> tuple[EntryMatchResultV3, EntrySelectionV3] | None:
    if seed is None:
        return None
    contract = load_rd_strategy_contract_v3()
    match = match_entry_candidates_v3(
        EntryMatchRequestV3(
            setup=SetupEntryFactsV3(
                setup_id=value.setup_id,
                direction=EntryDirection(value.direction),
                zone_top_ticks=value.zone_top_ticks,
                zone_bottom_ticks=value.zone_bottom_ticks,
                zone_engaged_epoch=value.zone_engaged_epoch,
                invalidated_before_entry=False,
                common_fidelity=CandidateFidelity.EXACT,
            ),
            rule_contract=contract,
            boc_proof=None,
            directional_close=True,
            confirmed_bar=_candle(seed.confirmed_bar),
            close_trigger_sequence=seed.trigger_sequence,
            htf_flip_proof=None,
            observed_at_epoch=seed.evaluated_at_epoch,
        )
    )
    selection = arbitrate_entry_candidates_v3(
        EntryArbitrationRequestV3(
            setup_id=value.setup_id,
            candidates=match.candidates,
            evidence=match.evidence,
            setup_invalidated=False,
            policy_version="rd-entry-arbitration-v3",
            revision=seed.revision,
            evaluated_at_epoch=seed.evaluated_at_epoch,
        )
    )
    return match, selection


def _evaluate(value: RDEntryArbitrationInputV3) -> dict[str, object]:
    contract = load_rd_strategy_contract_v3()
    result = match_entry_candidates_v3(
        EntryMatchRequestV3(
            setup=_setup(value),
            rule_contract=contract,
            boc_proof=_boc_proof(value.boc_proof),
            directional_close=value.directional_close,
            confirmed_bar=(
                _candle(value.confirmed_bar) if value.confirmed_bar is not None else None
            ),
            close_trigger_sequence=value.close_trigger_sequence,
            htf_flip_proof=_trigger_proof(value.htf_flip_proof),
            observed_at_epoch=value.observed_at_epoch,
        )
    )
    opened = _opened_selection(value, value.opened_selection_seed)
    selection = arbitrate_entry_candidates_v3(
        EntryArbitrationRequestV3(
            setup_id=value.setup_id,
            candidates=result.candidates,
            evidence=result.evidence,
            setup_invalidated=value.setup_invalidated,
            policy_version="rd-entry-arbitration-v3",
            revision=value.revision,
            evaluated_at_epoch=value.evaluated_at_epoch,
            opened_selection=opened[1] if opened is not None else None,
        )
    )
    output_result = opened[0] if opened is not None else result
    return {
        "candidates": [candidate.to_mapping() for candidate in output_result.candidates],
        "evidence": [item.to_mapping() for item in output_result.evidence],
        "selection": selection.to_mapping(),
    }


def build_vectors(document: dict[str, object]) -> dict[str, object]:
    if document.get("schema_id") != _FIXTURE_SCHEMA_ID:
        raise ValueError(f"fixture schema_id must be {_FIXTURE_SCHEMA_ID}")
    raw_cases = document.get("cases")
    if not isinstance(raw_cases, list) or len(raw_cases) != 13:
        raise ValueError("fixture document must contain exactly 13 cases")
    cases: list[dict[str, object]] = []
    seen: set[str] = set()
    for raw_case in raw_cases:
        if not isinstance(raw_case, dict) or set(raw_case) != {"case_id", "input"}:
            raise ValueError("each fixture case must contain exactly case_id and input")
        case_id = raw_case["case_id"]
        if not isinstance(case_id, str) or not case_id:
            raise ValueError("case_id must be a non-empty string")
        if case_id in seen:
            raise ValueError(f"duplicate case_id: {case_id}")
        seen.add(case_id)
        parsed_input = RDEntryArbitrationInputV3.model_validate_json(
            json.dumps(raw_case["input"], allow_nan=False)
        )
        cases.append(
            {
                "case_id": case_id,
                "input": parsed_input.model_dump(mode="json"),
                "expected": _evaluate(parsed_input),
            }
        )
    vectors = {
        "schema_id": "phase0.rd-entry-arbitration-vectors.v3",
        "rule_contract_version": "3.0.0",
        "arbitration_policy_version": "rd-entry-arbitration-v3",
        "cases": cases,
    }
    return RDEntryArbitrationVectorsV3.model_validate_json(
        json.dumps(vectors, allow_nan=False)
    ).model_dump(mode="json")


def _json_bytes(value: dict[str, object]) -> bytes:
    rendered = json.dumps(
        value,
        indent=2,
        sort_keys=True,
        allow_nan=False,
    )
    if any(not math.isfinite(item) for item in _floats(value)):
        raise ValueError("vectors cannot contain non-finite floats")
    return (rendered + "\n").encode()


def _floats(value: object) -> list[float]:
    if isinstance(value, float):
        return [value]
    if isinstance(value, dict):
        return [item for child in value.values() for item in _floats(child)]
    if isinstance(value, list):
        return [item for child in value for item in _floats(child)]
    return []


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--fixtures", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args(argv)
    rendered = _json_bytes(build_vectors(load_fixture_document(args.fixtures)))
    if args.check:
        if not args.output.exists() or args.output.read_bytes() != rendered:
            print(f"stale generated vectors: {args.output}", file=sys.stderr)
            return 1
        return 0
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(rendered)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
