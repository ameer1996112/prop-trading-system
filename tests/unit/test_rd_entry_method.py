import json
from dataclasses import replace
from pathlib import Path

import pytest

from prop_trading.domain.rd_entry_method import (
    DirectionalCloseMethod,
    EntryMethod,
    EntryMethodAction,
    EntryMethodContext,
    EntryMethodReason,
    RDEntryFillProfileV1,
    resolve_entry_method,
    utc_minute_in_window,
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
from prop_trading.domain.rd_entry_oracle import EntryOracleCase, evaluate_entry_stream

FIXTURES = Path("tests/fixtures/rd_entry_arbitration_cases_v2.json")


def candidate(
    *,
    model: EntryModelV2,
    direction: EntryDirection = EntryDirection.LONG,
    candidate_id_value: str | None = None,
) -> EntryCandidate:
    identity = EntryCandidateIdentity(
        setup_id="setup-1",
        model=model,
        direction=direction,
        event_anchor_epoch=1_700_000_000,
        trigger_ordinal=1,
    )
    return EntryCandidate(
        candidate_id=candidate_id_value or candidate_id(identity),
        setup_id=identity.setup_id,
        model=model,
        state=CandidateState.MATCHED,
        event_anchor_epoch=identity.event_anchor_epoch,
        trigger_ordinal=identity.trigger_ordinal,
        direction=identity.direction,
        source_claim_ids=("claim",),
        normalized_from=None,
        observed_at_epoch=identity.event_anchor_epoch,
    )


def evidence(
    selected: EntryCandidate,
    *,
    trigger_epoch: int = 1_699_948_800,
    trigger_ticks: int = 18_500,
) -> EntryCandidateEvidence:
    payload_sha256 = evidence_payload_sha256(
        candidate_id=selected.candidate_id,
        observed_trigger_epoch=trigger_epoch,
        observed_trigger_ticks=trigger_ticks,
        htf_context_minutes=(15,),
        fidelity=CandidateFidelity.EXACT,
        proof_plane=ProofPlane.CONFIRMED_5M,
        proof_resolution_seconds=300,
        coverage_start_epoch=trigger_epoch - 300,
        coverage_end_epoch=trigger_epoch,
        ambiguity_codes=(),
        passed_rule_ids=("ENTRY",),
        failed_rule_ids=(),
        source_claim_ids=("claim",),
    )
    identity = EntryEvidenceIdentity(
        candidate_id=selected.candidate_id,
        proof_plane=ProofPlane.CONFIRMED_5M,
        proof_resolution_seconds=300,
        coverage_start_epoch=trigger_epoch - 300,
        coverage_end_epoch=trigger_epoch,
        observed_trigger_epoch=trigger_epoch,
        payload_sha256=payload_sha256,
    )
    return EntryCandidateEvidence(
        evidence_id=evidence_id(identity),
        candidate_id=selected.candidate_id,
        observed_trigger_epoch=trigger_epoch,
        observed_trigger_ticks=trigger_ticks,
        htf_context_minutes=(15,),
        fidelity=CandidateFidelity.EXACT,
        proof_plane=ProofPlane.CONFIRMED_5M,
        proof_resolution_seconds=300,
        coverage_start_epoch=trigger_epoch - 300,
        coverage_end_epoch=trigger_epoch,
        ambiguity_codes=(),
        passed_rule_ids=("ENTRY",),
        failed_rule_ids=(),
        source_claim_ids=("claim",),
        payload_sha256=payload_sha256,
        observed_at_epoch=1_700_000_100,
    )


def paper_selection(
    *,
    model: EntryModelV2,
    direction: EntryDirection = EntryDirection.LONG,
    action: SelectionAction = SelectionAction.PAPER_ELIGIBLE,
) -> EntrySelection:
    selected = candidate(model=model, direction=direction)
    proof = evidence(selected)
    identity = EntrySelectionIdentity(
        setup_id=selected.setup_id,
        policy_version="rd-entry-arbitration-v2",
        revision=1,
        candidate_ids_considered=(selected.candidate_id,),
        canonical_candidate_id=selected.candidate_id,
        canonical_evidence_id=proof.evidence_id,
        reason=SelectionReason.ONLY_EXACT_TRIGGER,
        fidelity=CandidateFidelity.EXACT,
        action=action,
    )
    return EntrySelection(
        selection_id=selection_id(identity),
        setup_id=identity.setup_id,
        policy_version=identity.policy_version,
        revision=identity.revision,
        candidate_ids_considered=identity.candidate_ids_considered,
        canonical_candidate_id=identity.canonical_candidate_id,
        canonical_evidence_id=identity.canonical_evidence_id,
        canonical_model=model,
        reason=identity.reason,
        fidelity=identity.fidelity,
        action=identity.action,
        evaluated_at_epoch=1_700_000_100,
    )


def context(
    *,
    close_ticks: int = 18_500,
    direction: EntryDirection = EntryDirection.LONG,
) -> EntryMethodContext:
    return EntryMethodContext(
        feed_id="OANDA",
        symbol="GBPJPY",
        evaluated_at_epoch=1_700_000_100,
        trigger_epoch=1_699_948_800,
        trigger_ticks=close_ticks,
        direction=direction,
    )


def wick_profile(**overrides: object) -> RDEntryFillProfileV1:
    return make_profile(**overrides)


def make_profile(**overrides: object) -> RDEntryFillProfileV1:
    values: dict[str, object] = {
        "profile_id": "gbpjpy-london-wick-v1",
        "version": 1,
        "feed_id": "OANDA",
        "symbol": "GBPJPY",
        "session_start_minute_utc": 420,
        "session_end_minute_utc": 660,
        "dir_close_method": DirectionalCloseMethod.NEXT_CANDLE_WICK,
        "limit_offset_ticks": 1,
        "max_wait_seconds": 300,
        "evidence_manifest_sha256": "1" * 64,
        "status": "APPROVED",
        "approved_by": "operator",
        "approved_at_epoch": 1_700_000_000,
    }
    values.update(overrides)
    return RDEntryFillProfileV1(**values)  # type: ignore[arg-type]


def test_entry_method_taxonomy_is_closed() -> None:
    assert tuple(EntryMethod) == (
        EntryMethod.INTRABAR_FLIP,
        EntryMethod.CLOSE_CONFIRMATION,
        EntryMethod.NEXT_CANDLE_WICK,
    )


def test_wick_profile_requires_offset_and_exact_300_second_wait() -> None:
    with pytest.raises(ValueError, match="limit_offset_ticks"):
        make_profile(limit_offset_ticks=None)

    with pytest.raises(ValueError, match="max_wait_seconds"):
        make_profile(max_wait_seconds=299)


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("version", 0),
        ("profile_id", ""),
        ("feed_id", " "),
        ("symbol", ""),
        ("session_start_minute_utc", -1),
        ("session_end_minute_utc", 1440),
        ("approved_by", ""),
        ("approved_at_epoch", -1),
    ],
)
def test_profile_rejects_invalid_scalar_fields(field: str, value: object) -> None:
    with pytest.raises(ValueError, match=field):
        make_profile(**{field: value})


def test_profile_rejects_equal_session_bounds() -> None:
    with pytest.raises(ValueError, match="session"):
        make_profile(session_end_minute_utc=420)


@pytest.mark.parametrize("digest", ["0" * 64, "A" * 64, "1" * 63, "g" * 64])
def test_profile_requires_nonzero_lowercase_sha256_digest(digest: str) -> None:
    with pytest.raises(ValueError, match="evidence_manifest_sha256"):
        make_profile(evidence_manifest_sha256=digest)


def test_profile_requires_approved_status_and_directional_close_method() -> None:
    with pytest.raises(ValueError, match="status"):
        make_profile(status="PENDING")

    with pytest.raises(ValueError, match="dir_close_method"):
        make_profile(dir_close_method="NEXT_CANDLE_WICK")


def test_close_profile_forbids_limit_offset_ticks() -> None:
    profile = make_profile(
        dir_close_method=DirectionalCloseMethod.CLOSE_CONFIRMATION,
        limit_offset_ticks=None,
    )
    assert profile.limit_offset_ticks is None

    with pytest.raises(ValueError, match="limit_offset_ticks"):
        make_profile(
            dir_close_method=DirectionalCloseMethod.CLOSE_CONFIRMATION,
            limit_offset_ticks=1,
        )


@pytest.mark.parametrize(
    ("start", "end", "minute", "expected"),
    [
        (420, 660, 420, True),
        (420, 660, 659, True),
        (420, 660, 660, False),
        (1320, 120, 1380, True),
        (1320, 120, 60, True),
        (1320, 120, 120, False),
    ],
)
def test_profile_session_is_half_open_and_may_wrap_midnight(
    start: int, end: int, minute: int, expected: bool
) -> None:
    assert utc_minute_in_window(minute, start=start, end=end) is expected


def test_exact_htf_flip_always_selects_intrabar_method() -> None:
    selected = candidate(model=EntryModelV2.HTF_FLIP)
    result = resolve_entry_method(
        selection=paper_selection(model=EntryModelV2.HTF_FLIP),
        candidate=selected,
        evidence=evidence(selected),
        context=context(),
        profiles=(wick_profile(),),
    )

    assert result.method is EntryMethod.INTRABAR_FLIP
    assert result.action is EntryMethodAction.PAPER_ELIGIBLE
    assert result.profile_id is None


def test_directional_close_defaults_to_prompt_close() -> None:
    selected = candidate(model=EntryModelV2.DIR_CLOSE)
    result = resolve_entry_method(
        selection=paper_selection(model=EntryModelV2.DIR_CLOSE),
        candidate=selected,
        evidence=evidence(selected),
        context=context(),
        profiles=(),
    )

    assert result.method is EntryMethod.CLOSE_CONFIRMATION
    assert result.action is EntryMethodAction.PAPER_ELIGIBLE


def test_one_wick_profile_creates_one_pending_fill() -> None:
    selected = candidate(model=EntryModelV2.DIR_CLOSE)
    result = resolve_entry_method(
        selection=paper_selection(model=EntryModelV2.DIR_CLOSE),
        candidate=selected,
        evidence=evidence(selected),
        context=context(close_ticks=18_500, direction=EntryDirection.LONG),
        profiles=(wick_profile(limit_offset_ticks=3),),
    )

    assert result.method is EntryMethod.NEXT_CANDLE_WICK
    assert result.action is EntryMethodAction.PENDING_WICK
    assert result.limit_ticks == 18_497
    assert result.wait_until_epoch == result.trigger_epoch + 300


def test_conflicting_profiles_never_guess_or_open() -> None:
    selected = candidate(model=EntryModelV2.DIR_CLOSE)
    result = resolve_entry_method(
        selection=paper_selection(model=EntryModelV2.DIR_CLOSE),
        candidate=selected,
        evidence=evidence(selected),
        context=context(),
        profiles=(wick_profile(profile_id="a"), wick_profile(profile_id="b")),
    )

    assert result.method is None
    assert result.action is EntryMethodAction.SHADOW_ONLY
    assert result.reason is EntryMethodReason.CONFLICTING_FILL_PROFILES


def test_candidate_must_be_the_selection_owner() -> None:
    selected = candidate(
        model=EntryModelV2.DIR_CLOSE,
        candidate_id_value="f" * 64,
    )
    with pytest.raises(ValueError, match="canonical candidate"):
        resolve_entry_method(
            selection=paper_selection(model=EntryModelV2.DIR_CLOSE),
            candidate=selected,
            evidence=evidence(selected),
            context=context(),
            profiles=(),
        )


def test_selection_id_must_match_its_canonical_payload() -> None:
    selected = candidate(model=EntryModelV2.DIR_CLOSE)
    selection = replace(paper_selection(model=EntryModelV2.DIR_CLOSE), revision=2)

    with pytest.raises(ValueError, match="selection_id conflicts"):
        resolve_entry_method(
            selection=selection,
            candidate=selected,
            evidence=evidence(selected),
            context=context(),
            profiles=(),
        )


def test_shadow_selection_cannot_be_mutated_to_paper_without_a_new_identity() -> None:
    selected = candidate(model=EntryModelV2.DIR_CLOSE)
    shadow = paper_selection(
        model=EntryModelV2.DIR_CLOSE,
        action=SelectionAction.SHADOW_ONLY,
    )

    with pytest.raises(ValueError, match="selection_id conflicts"):
        resolve_entry_method(
            selection=replace(shadow, action=SelectionAction.PAPER_ELIGIBLE),
            candidate=selected,
            evidence=evidence(selected),
            context=context(),
            profiles=(),
        )


def test_candidate_id_must_match_its_canonical_payload() -> None:
    selected = candidate(model=EntryModelV2.DIR_CLOSE)
    altered = replace(selected, event_anchor_epoch=selected.event_anchor_epoch + 1)

    with pytest.raises(ValueError, match="candidate_id conflicts"):
        resolve_entry_method(
            selection=paper_selection(model=EntryModelV2.DIR_CLOSE),
            candidate=altered,
            evidence=evidence(altered),
            context=context(),
            profiles=(),
        )


def test_rejected_candidate_cannot_produce_a_method_decision() -> None:
    selected = candidate(model=EntryModelV2.DIR_CLOSE)
    rejected = replace(selected, state=CandidateState.REJECTED)

    with pytest.raises(ValueError, match="matched"):
        resolve_entry_method(
            selection=paper_selection(model=EntryModelV2.DIR_CLOSE),
            candidate=rejected,
            evidence=evidence(rejected),
            context=context(),
            profiles=(),
        )


def test_context_trigger_must_match_canonical_evidence() -> None:
    selected = candidate(model=EntryModelV2.DIR_CLOSE)

    with pytest.raises(ValueError, match="trigger"):
        resolve_entry_method(
            selection=paper_selection(model=EntryModelV2.DIR_CLOSE),
            candidate=selected,
            evidence=evidence(selected),
            context=replace(context(), trigger_epoch=1_700_100_000),
            profiles=(wick_profile(),),
        )


def test_context_evaluation_must_match_canonical_selection_evaluation() -> None:
    selected = candidate(model=EntryModelV2.DIR_CLOSE)

    with pytest.raises(ValueError, match="evaluation"):
        resolve_entry_method(
            selection=paper_selection(model=EntryModelV2.DIR_CLOSE),
            candidate=selected,
            evidence=evidence(selected),
            context=replace(context(), evaluated_at_epoch=1_700_000_101),
            profiles=(),
        )


def test_exact_prompt_close_profile_is_honored() -> None:
    selected = candidate(model=EntryModelV2.DIR_CLOSE)
    result = resolve_entry_method(
        selection=paper_selection(model=EntryModelV2.DIR_CLOSE),
        candidate=selected,
        evidence=evidence(selected),
        context=context(),
        profiles=(
            make_profile(
                profile_id="gbpjpy-london-close-v1",
                dir_close_method=DirectionalCloseMethod.CLOSE_CONFIRMATION,
                limit_offset_ticks=None,
            ),
        ),
    )

    assert result.method is EntryMethod.CLOSE_CONFIRMATION
    assert result.action is EntryMethodAction.PAPER_ELIGIBLE
    assert result.reason is EntryMethodReason.PROFILE_PROMPT_CLOSE
    assert result.profile_id == "gbpjpy-london-close-v1"


def test_short_wick_profile_adds_its_offset_to_the_frozen_trigger() -> None:
    selected = candidate(model=EntryModelV2.DIR_CLOSE, direction=EntryDirection.SHORT)
    result = resolve_entry_method(
        selection=paper_selection(
            model=EntryModelV2.DIR_CLOSE,
            direction=EntryDirection.SHORT,
        ),
        candidate=selected,
        evidence=evidence(selected),
        context=context(direction=EntryDirection.SHORT),
        profiles=(wick_profile(limit_offset_ticks=3),),
    )

    assert result.method is EntryMethod.NEXT_CANDLE_WICK
    assert result.limit_ticks == 18_503


def test_normalized_authoritative_htf_flip_remains_paper_eligible() -> None:
    loaded: object = json.loads(FIXTURES.read_text(encoding="utf-8"))
    assert isinstance(loaded, dict)
    case_mapping = next(
        item for item in loaded["cases"] if item["case_id"] == "htf-break-normalized"
    )
    assert isinstance(case_mapping, dict)
    result = evaluate_entry_stream(EntryOracleCase.from_mapping(case_mapping))
    selected = next(
        item
        for item in result.candidates
        if item.candidate_id == result.selection.canonical_candidate_id
    )
    proof = next(
        item
        for item in result.evidence
        if item.evidence_id == result.selection.canonical_evidence_id
    )

    decision = resolve_entry_method(
        selection=result.selection,
        candidate=selected,
        evidence=proof,
        context=EntryMethodContext(
            feed_id="OANDA",
            symbol="GBPJPY",
            evaluated_at_epoch=result.selection.evaluated_at_epoch,
            trigger_epoch=proof.observed_trigger_epoch,
            trigger_ticks=proof.observed_trigger_ticks,
            direction=selected.direction,
        ),
        profiles=(),
    )

    assert selected.state is CandidateState.NORMALIZED
    assert decision.method is EntryMethod.INTRABAR_FLIP
    assert decision.action is EntryMethodAction.PAPER_ELIGIBLE
