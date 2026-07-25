"""Build deterministic scanner-free vectors from the reviewed RD oracle fixture."""

from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from copy import deepcopy
from dataclasses import replace
from pathlib import Path
from typing import NoReturn

from prop_trading.contracts.rd_entry_vectors_v2 import (
    RDEntryArbitrationVectorsV2,
)
from prop_trading.domain.rd_entry_models import (
    AttemptKind,
    CandidateFidelity,
    SelectionAction,
)
from prop_trading.domain.rd_entry_oracle import (
    EntryOracleCase,
    EntryOracleEvent,
    entry_oracle_case_to_edge_mapping,
    evaluate_entry_stream,
)

_FIXTURE_SCHEMA_ID = "phase0.rd-entry-arbitration-fixture.v2"
_VECTOR_SCHEMA_ID = "phase0.rd-entry-arbitration-vectors.v2"
_POLICY_VERSION = "rd-entry-arbitration-v2"
_REPLAY_FIELDS = (
    "setup_id",
    "symbol",
    "feed",
    "calculation_start_epoch",
    "emission_start_epoch",
    "emission_end_epoch",
    "pine_supported",
)


def _reject_constant(value: str) -> NoReturn:
    raise ValueError(f"non-finite JSON number is not allowed: {value}")


def _strict_object(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"duplicate JSON object key: {key}")
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
    return loaded


def _fixture_cases(document: dict[str, object]) -> list[dict[str, object]]:
    if set(document) != {"schema_id", "cases"}:
        raise ValueError("fixture document has unknown or missing fields")
    if document["schema_id"] != _FIXTURE_SCHEMA_ID:
        raise ValueError(f"fixture schema_id must be {_FIXTURE_SCHEMA_ID}")
    cases = document["cases"]
    if not isinstance(cases, list) or not all(isinstance(item, dict) for item in cases):
        raise ValueError("fixture cases must be an array of objects")
    if len(cases) != 24:
        raise ValueError("fixture must contain exactly 24 reviewed cases")
    case_ids = [item.get("case_id") for item in cases]
    if any(not isinstance(item, str) or not item for item in case_ids):
        raise ValueError("fixture case_id values must be non-empty strings")
    if len(set(case_ids)) != len(case_ids):
        raise ValueError("fixture case_id values must be unique")
    return cases


def _pine_case(case: EntryOracleCase) -> EntryOracleCase:
    events: list[EntryOracleEvent] = []
    for event in case.events:
        pine_setup = replace(
            event.base_match_request.setup,
            common_fidelity=CandidateFidelity.UNRESOLVED,
        )
        events.append(
            replace(
                event,
                base_match_request=replace(
                    event.base_match_request,
                    setup=pine_setup,
                ),
                htf_scan_requests=tuple(
                    replace(request, setup=pine_setup) for request in event.htf_scan_requests
                ),
            )
        )
    return replace(case, events=tuple(events))


def _pine_edge_input(edge_input: dict[str, object]) -> dict[str, object]:
    pine = deepcopy(edge_input)
    events = pine["events"]
    if not isinstance(events, list):
        raise ValueError("edge events must be an array")
    for item in events:
        if not isinstance(item, dict):
            raise ValueError("edge event must be an object")
        request = item.get("match_request")
        if not isinstance(request, dict):
            raise ValueError("edge match_request must be an object")
        setup = request.get("setup")
        if not isinstance(setup, dict):
            raise ValueError("edge setup must be an object")
        setup["common_fidelity"] = CandidateFidelity.UNRESOLVED.value
    return pine


def _differing_paths(
    left: object,
    right: object,
    *,
    path: str = "",
) -> set[str]:
    if isinstance(left, dict) and isinstance(right, dict):
        if set(left) != set(right):
            raise ValueError("edge and Pine inputs have different object keys")
        return {
            changed
            for key in left
            for changed in _differing_paths(
                left[key],
                right[key],
                path=f"{path}.{key}" if path else key,
            )
        }
    if isinstance(left, list) and isinstance(right, list):
        if len(left) != len(right):
            raise ValueError("edge and Pine inputs have different array lengths")
        return {
            changed
            for index, (left_item, right_item) in enumerate(zip(left, right, strict=True))
            for changed in _differing_paths(
                left_item,
                right_item,
                path=f"{path}[{index}]",
            )
        }
    return {path} if left != right else set()


def _expected_pine_paths(edge_input: dict[str, object]) -> set[str]:
    events = edge_input["events"]
    if not isinstance(events, list):
        raise ValueError("edge events must be an array")
    paths: set[str] = set()
    for index, item in enumerate(events):
        if not isinstance(item, dict):
            raise ValueError("edge event must be an object")
        request = item.get("match_request")
        if not isinstance(request, dict):
            raise ValueError("edge match_request must be an object")
        setup = request.get("setup")
        if not isinstance(setup, dict):
            raise ValueError("edge setup must be an object")
        if setup.get("common_fidelity") != CandidateFidelity.UNRESOLVED.value:
            paths.add(f"events[{index}].match_request.setup.common_fidelity")
    return paths


def _replay_metadata(raw: dict[str, object]) -> dict[str, object]:
    return {key: raw[key] for key in _REPLAY_FIELDS}


def _validate_attempt_scopes(cases: Sequence[EntryOracleCase]) -> None:
    attempts_by_setup: dict[str, set[AttemptKind]] = {}
    for case in cases:
        for event in case.events:
            request = event.base_match_request
            attempts_by_setup.setdefault(case.setup_id, set()).add(request.attempt_kind)
            if request.attempt_kind is AttemptKind.INITIAL:
                if request.trigger_ordinal != 1:
                    raise ValueError("INITIAL attempts require trigger_ordinal 1")
            elif request.trigger_ordinal < 2:
                raise ValueError("RE_ENTRY attempts require trigger_ordinal 2 or greater")
    reused = [setup_id for setup_id, kinds in attempts_by_setup.items() if len(kinds) > 1]
    if reused:
        raise ValueError(
            "fixture reuses setup_id across initial and re-entry attempts: "
            + ", ".join(sorted(reused))
        )


def build_vectors(document: dict[str, object]) -> dict[str, object]:
    raw_cases = _fixture_cases(document)
    parsed_cases = [EntryOracleCase.from_mapping(item) for item in raw_cases]
    _validate_attempt_scopes(parsed_cases)

    vectors: list[dict[str, object]] = []
    for raw, case in zip(raw_cases, parsed_cases, strict=True):
        if case.policy_version != _POLICY_VERSION:
            raise ValueError(f"policy_version must be {_POLICY_VERSION}")
        expected = raw["expected"]
        pine_expected = raw["pine_expected"]
        raw_result = evaluate_entry_stream(case).to_mapping()
        if raw_result != expected:
            raise ValueError(f"{case.case_id} does not match its manually reviewed expected")
        pine_result = evaluate_entry_stream(_pine_case(case)).to_mapping()
        if pine_result != pine_expected:
            raise ValueError(f"{case.case_id} does not match its reviewed pine_expected")
        pine_selection = pine_result["selection"]
        if not isinstance(pine_selection, dict):
            raise ValueError(f"{case.case_id} Pine selection must be an object")
        if pine_selection.get("action") == SelectionAction.PAPER_ELIGIBLE.value:
            raise ValueError(f"{case.case_id} current Pine view must be non-promotable")

        edge_input = entry_oracle_case_to_edge_mapping(case)
        pine_edge_input = _pine_edge_input(edge_input)
        changed = _differing_paths(edge_input, pine_edge_input)
        expected_changes = _expected_pine_paths(edge_input)
        if changed != expected_changes:
            raise ValueError(f"{case.case_id} Pine input changed paths outside common_fidelity")

        metadata = _replay_metadata(raw)
        edge_case = EntryOracleCase.from_edge_mapping(
            edge_input,
            replay_metadata=metadata,
        )
        edge_result = evaluate_entry_stream(edge_case).to_mapping()
        if edge_result != expected:
            raise ValueError(f"{case.case_id} scanner-free Edge input changed reviewed output")
        parsed_pine_case = EntryOracleCase.from_edge_mapping(
            pine_edge_input,
            replay_metadata=metadata,
        )
        parsed_pine_result = evaluate_entry_stream(parsed_pine_case).to_mapping()
        if parsed_pine_result != pine_expected:
            raise ValueError(f"{case.case_id} scanner-free Pine input changed reviewed output")

        vectors.append(
            {
                "case_id": case.case_id,
                **metadata,
                "input": deepcopy(raw["input"]),
                "edge_input": edge_input,
                "pine_edge_input": pine_edge_input,
                "expected": deepcopy(expected),
                "pine_expected": deepcopy(pine_expected),
            }
        )
    result: dict[str, object] = {
        "schema_id": _VECTOR_SCHEMA_ID,
        "cases": vectors,
    }
    RDEntryArbitrationVectorsV2.model_validate_json(json.dumps(result, ensure_ascii=False))
    return result


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--fixtures", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args(argv)
    document = build_vectors(load_fixture_document(args.fixtures))
    rendered = (json.dumps(document, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode()
    if args.check:
        if not args.output.exists() or args.output.read_bytes() != rendered:
            raise SystemExit(f"RD entry oracle vectors are stale: {args.output}")
    else:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_bytes(rendered)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
