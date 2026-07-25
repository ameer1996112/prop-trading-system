"""Build deterministic RD entry-method vectors from the reviewed fixture."""

from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from pathlib import Path
from typing import Literal, NoReturn

from pydantic import Field, model_validator

from prop_trading.contracts.models import ContractModel, Identifier, SafeInteger
from prop_trading.contracts.rd_entry_method_vectors_v1 import (
    Direction,
    EntryModel,
    Method,
    MethodAction,
    MethodReason,
    RDEntryFillProfileVectorV1,
    RDEntryMethodVectorSetV1,
    WickReplayEvidenceVectorV1,
    entry_method_decision_to_mapping,
)
from prop_trading.domain.rd_entry_method import (
    EntryMethodContext,
    EntryMethodDecision,
    resolve_entry_method,
    resolve_wick_fill,
)
from prop_trading.domain.rd_entry_models import (
    CandidateFidelity,
    CandidateState,
    EntryCandidate,
    EntryCandidateEvidence,
    EntryCandidateIdentity,
    EntryDirection,
    EntryEvidenceIdentity,
    EntryModelV2,
    EntrySelection,
    EntrySelectionIdentity,
    ProofPlane,
    SelectionAction,
    SelectionReason,
    candidate_id,
    evidence_id,
    evidence_payload_sha256,
    selection_id,
)

_FIXTURE_SCHEMA_ID = "phase0.rd-entry-method-fixture.v1"
_VECTOR_SCHEMA_ID = "phase0.rd-entry-method-vectors.v1"


class FixtureContextV1(ContractModel):
    feed_id: Identifier
    symbol: Identifier
    evaluated_at_epoch: SafeInteger = Field(ge=0)
    trigger_epoch: SafeInteger = Field(ge=0)
    trigger_ticks: SafeInteger


class FixtureExpectedV1(ContractModel):
    method: Method | None
    action: MethodAction
    reason: MethodReason
    profile_id: Identifier | None
    limit_ticks: SafeInteger | None
    wait_until_epoch: SafeInteger | None = Field(default=None, ge=0)
    fill_epoch: SafeInteger | None = Field(default=None, ge=0)
    fill_ticks: SafeInteger | None


class FixtureCaseV1(ContractModel):
    case_id: Identifier
    setup_id: Identifier
    model: EntryModel | None
    direction: Direction
    selection_action: Literal["PAPER_ELIGIBLE", "SHADOW_ONLY", "NONE"]
    profile_ids: tuple[Identifier, ...]
    wick_replay: WickReplayEvidenceVectorV1 | None
    expected: FixtureExpectedV1

    @model_validator(mode="after")
    def _candidate_and_profile_references_are_closed(self) -> FixtureCaseV1:
        if (self.model is None) != (self.selection_action == "NONE"):
            raise ValueError("only a no-candidate case may use selection action NONE")
        if len(self.profile_ids) != len(set(self.profile_ids)):
            raise ValueError("fixture profile references must be unique")
        return self


class FixtureSetV1(ContractModel):
    schema_id: Literal["phase0.rd-entry-method-fixture.v1"]
    context: FixtureContextV1
    profiles: tuple[RDEntryFillProfileVectorV1, ...]
    cases: tuple[FixtureCaseV1, ...] = Field(min_length=14, max_length=14)

    @model_validator(mode="after")
    def _identifiers_and_references_are_closed(self) -> FixtureSetV1:
        profile_ids = [item.profile_id for item in self.profiles]
        case_ids = [item.case_id for item in self.cases]
        if len(profile_ids) != len(set(profile_ids)):
            raise ValueError("fixture profile IDs must be unique")
        if len(case_ids) != len(set(case_ids)):
            raise ValueError("fixture case IDs must be unique")
        known_profiles = set(profile_ids)
        if any(
            profile_id not in known_profiles
            for case in self.cases
            for profile_id in case.profile_ids
        ):
            raise ValueError("fixture case references an unknown profile")
        return self


def _reject_constant(value: str) -> NoReturn:
    raise ValueError(f"non-finite JSON number is not allowed: {value}")


def _strict_object(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"duplicate JSON object key: {key}")
        result[key] = value
    return result


def load_fixture_document(path: Path) -> FixtureSetV1:
    loaded: object = json.loads(
        path.read_text(encoding="utf-8"),
        object_pairs_hook=_strict_object,
        parse_constant=_reject_constant,
    )
    return FixtureSetV1.model_validate_json(json.dumps(loaded, ensure_ascii=False))


def _candidate_for(case: FixtureCaseV1, context: FixtureContextV1) -> EntryCandidate | None:
    if case.model is None:
        return None
    identity = EntryCandidateIdentity(
        setup_id=case.setup_id,
        model=EntryModelV2(case.model),
        direction=EntryDirection(case.direction),
        event_anchor_epoch=context.trigger_epoch,
        trigger_ordinal=1,
    )
    return EntryCandidate(
        candidate_id=candidate_id(identity),
        setup_id=identity.setup_id,
        model=identity.model,
        state=CandidateState.MATCHED,
        event_anchor_epoch=identity.event_anchor_epoch,
        trigger_ordinal=identity.trigger_ordinal,
        direction=identity.direction,
        source_claim_ids=("rd-entry-method-vector-v1",),
        normalized_from=None,
        observed_at_epoch=context.trigger_epoch,
    )


def _evidence_for(
    candidate: EntryCandidate | None,
    context: FixtureContextV1,
) -> EntryCandidateEvidence | None:
    if candidate is None:
        return None
    coverage_start_epoch = context.trigger_epoch - 300
    payload_sha256 = evidence_payload_sha256(
        candidate_id=candidate.candidate_id,
        observed_trigger_epoch=context.trigger_epoch,
        observed_trigger_ticks=context.trigger_ticks,
        htf_context_minutes=(15,),
        fidelity=CandidateFidelity.EXACT,
        proof_plane=ProofPlane.CONFIRMED_5M,
        proof_resolution_seconds=300,
        coverage_start_epoch=coverage_start_epoch,
        coverage_end_epoch=context.trigger_epoch,
        ambiguity_codes=(),
        passed_rule_ids=("ENTRY_METHOD_VECTOR",),
        failed_rule_ids=(),
        source_claim_ids=("rd-entry-method-vector-v1",),
    )
    identity = EntryEvidenceIdentity(
        candidate_id=candidate.candidate_id,
        proof_plane=ProofPlane.CONFIRMED_5M,
        proof_resolution_seconds=300,
        coverage_start_epoch=coverage_start_epoch,
        coverage_end_epoch=context.trigger_epoch,
        observed_trigger_epoch=context.trigger_epoch,
        payload_sha256=payload_sha256,
    )
    return EntryCandidateEvidence(
        evidence_id=evidence_id(identity),
        candidate_id=candidate.candidate_id,
        observed_trigger_epoch=context.trigger_epoch,
        observed_trigger_ticks=context.trigger_ticks,
        htf_context_minutes=(15,),
        fidelity=CandidateFidelity.EXACT,
        proof_plane=ProofPlane.CONFIRMED_5M,
        proof_resolution_seconds=300,
        coverage_start_epoch=coverage_start_epoch,
        coverage_end_epoch=context.trigger_epoch,
        ambiguity_codes=(),
        passed_rule_ids=("ENTRY_METHOD_VECTOR",),
        failed_rule_ids=(),
        source_claim_ids=("rd-entry-method-vector-v1",),
        payload_sha256=payload_sha256,
        observed_at_epoch=context.evaluated_at_epoch,
    )


def _selection_for(
    case: FixtureCaseV1,
    candidate: EntryCandidate | None,
    evidence: EntryCandidateEvidence | None,
    context: FixtureContextV1,
) -> EntrySelection:
    identity = EntrySelectionIdentity(
        setup_id=case.setup_id,
        policy_version="rd-entry-arbitration-v2",
        revision=1,
        candidate_ids_considered=(candidate.candidate_id,) if candidate is not None else (),
        canonical_candidate_id=candidate.candidate_id if candidate is not None else None,
        canonical_evidence_id=evidence.evidence_id if evidence is not None else None,
        reason=(
            SelectionReason.ONLY_EXACT_TRIGGER
            if candidate is not None
            else SelectionReason.NO_CANDIDATE
        ),
        fidelity=CandidateFidelity.EXACT if candidate is not None else None,
        action=SelectionAction(case.selection_action),
    )
    return EntrySelection(
        selection_id=selection_id(identity),
        setup_id=identity.setup_id,
        policy_version=identity.policy_version,
        revision=identity.revision,
        candidate_ids_considered=identity.candidate_ids_considered,
        canonical_candidate_id=identity.canonical_candidate_id,
        canonical_evidence_id=identity.canonical_evidence_id,
        canonical_model=candidate.model if candidate is not None else None,
        reason=identity.reason,
        fidelity=identity.fidelity,
        action=identity.action,
        evaluated_at_epoch=context.evaluated_at_epoch,
    )


def _candidate_mapping(candidate: EntryCandidate | None) -> dict[str, object] | None:
    if candidate is None:
        return None
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


def _evidence_mapping(evidence: EntryCandidateEvidence | None) -> dict[str, object] | None:
    if evidence is None:
        return None
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


def _selection_mapping(selection: EntrySelection) -> dict[str, object]:
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
        "fidelity": selection.fidelity.value if selection.fidelity is not None else None,
        "action": selection.action.value,
        "evaluated_at_epoch": selection.evaluated_at_epoch,
    }


def _assert_reviewed_expected(
    case: FixtureCaseV1,
    decision: EntryMethodDecision,
) -> None:
    reviewed = case.expected.model_dump(mode="json")
    actual = entry_method_decision_to_mapping(decision)
    reviewed_actual = {
        key: actual[key]
        for key in (
            "method",
            "action",
            "reason",
            "profile_id",
            "limit_ticks",
            "wait_until_epoch",
            "fill_epoch",
            "fill_ticks",
        )
    }
    if reviewed_actual != reviewed:
        raise ValueError(f"{case.case_id} does not match its manually reviewed expected")


def build_vectors(fixture: FixtureSetV1) -> dict[str, object]:
    profiles_by_id = {item.profile_id: item for item in fixture.profiles}
    context = fixture.context
    vectors: list[dict[str, object]] = []
    for case in fixture.cases:
        candidate = _candidate_for(case, context)
        evidence = _evidence_for(candidate, context)
        selection = _selection_for(case, candidate, evidence, context)
        profiles = tuple(profiles_by_id[item] for item in case.profile_ids)
        method_context = {
            "feed_id": context.feed_id,
            "symbol": context.symbol,
            "evaluated_at_epoch": context.evaluated_at_epoch,
            "trigger_epoch": context.trigger_epoch,
            "trigger_ticks": context.trigger_ticks,
            "direction": case.direction,
        }
        input_mapping = {
            "selection": _selection_mapping(selection),
            "candidate": _candidate_mapping(candidate),
            "evidence": _evidence_mapping(evidence),
            "context": method_context,
            "profiles": [item.model_dump(mode="json") for item in profiles],
            "wick_replay": (
                case.wick_replay.model_dump(mode="json") if case.wick_replay is not None else None
            ),
        }
        decision = resolve_entry_method(
            selection=selection,
            candidate=candidate,
            evidence=evidence,
            context=_fixture_context_to_domain(context, case.direction),
            profiles=tuple(item.to_domain() for item in profiles),
        )
        if case.wick_replay is not None:
            decision = resolve_wick_fill(decision, case.wick_replay.to_domain())
        _assert_reviewed_expected(case, decision)
        vectors.append(
            {
                "case_id": case.case_id,
                "input": input_mapping,
                "expected": entry_method_decision_to_mapping(decision),
            }
        )
    result: dict[str, object] = {"schema_id": _VECTOR_SCHEMA_ID, "cases": vectors}
    RDEntryMethodVectorSetV1.model_validate_json(json.dumps(result, ensure_ascii=False))
    return result


def _fixture_context_to_domain(
    context: FixtureContextV1,
    direction: Direction,
) -> EntryMethodContext:
    return EntryMethodContext(
        feed_id=context.feed_id,
        symbol=context.symbol,
        evaluated_at_epoch=context.evaluated_at_epoch,
        trigger_epoch=context.trigger_epoch,
        trigger_ticks=context.trigger_ticks,
        direction=EntryDirection(direction),
    )


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
            raise SystemExit(f"RD entry method vectors are stale: {args.output}")
    else:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_bytes(rendered)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
