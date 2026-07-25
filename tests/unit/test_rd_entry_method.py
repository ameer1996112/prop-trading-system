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
    EntryCandidateIdentity,
    EntryDirection,
    EntryModelV2,
    EntrySelection,
    EntrySelectionIdentity,
    SelectionAction,
    SelectionReason,
    candidate_id,
    selection_id,
)


def candidate(
    *,
    model: EntryModelV2,
    candidate_id_value: str | None = None,
) -> EntryCandidate:
    identity = EntryCandidateIdentity(
        setup_id="setup-1",
        model=model,
        direction=EntryDirection.LONG,
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


def paper_selection(*, model: EntryModelV2) -> EntrySelection:
    selected = candidate(model=model)
    identity = EntrySelectionIdentity(
        setup_id=selected.setup_id,
        policy_version="rd-entry-arbitration-v2",
        revision=1,
        candidate_ids_considered=(selected.candidate_id,),
        canonical_candidate_id=selected.candidate_id,
        canonical_evidence_id="e" * 64,
        reason=SelectionReason.ONLY_EXACT_TRIGGER,
        fidelity=CandidateFidelity.EXACT,
        action=SelectionAction.PAPER_ELIGIBLE,
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
    result = resolve_entry_method(
        selection=paper_selection(model=EntryModelV2.HTF_FLIP),
        candidate=candidate(model=EntryModelV2.HTF_FLIP),
        context=context(),
        profiles=(wick_profile(),),
    )

    assert result.method is EntryMethod.INTRABAR_FLIP
    assert result.action is EntryMethodAction.PAPER_ELIGIBLE
    assert result.profile_id is None


def test_directional_close_defaults_to_prompt_close() -> None:
    result = resolve_entry_method(
        selection=paper_selection(model=EntryModelV2.DIR_CLOSE),
        candidate=candidate(model=EntryModelV2.DIR_CLOSE),
        context=context(),
        profiles=(),
    )

    assert result.method is EntryMethod.CLOSE_CONFIRMATION
    assert result.action is EntryMethodAction.PAPER_ELIGIBLE


def test_one_wick_profile_creates_one_pending_fill() -> None:
    result = resolve_entry_method(
        selection=paper_selection(model=EntryModelV2.DIR_CLOSE),
        candidate=candidate(model=EntryModelV2.DIR_CLOSE),
        context=context(close_ticks=18_500, direction=EntryDirection.LONG),
        profiles=(wick_profile(limit_offset_ticks=3),),
    )

    assert result.method is EntryMethod.NEXT_CANDLE_WICK
    assert result.action is EntryMethodAction.PENDING_WICK
    assert result.limit_ticks == 18_497
    assert result.wait_until_epoch == result.trigger_epoch + 300


def test_conflicting_profiles_never_guess_or_open() -> None:
    result = resolve_entry_method(
        selection=paper_selection(model=EntryModelV2.DIR_CLOSE),
        candidate=candidate(model=EntryModelV2.DIR_CLOSE),
        context=context(),
        profiles=(wick_profile(profile_id="a"), wick_profile(profile_id="b")),
    )

    assert result.method is None
    assert result.action is EntryMethodAction.SHADOW_ONLY
    assert result.reason is EntryMethodReason.CONFLICTING_FILL_PROFILES


def test_candidate_must_be_the_selection_owner() -> None:
    with pytest.raises(ValueError, match="canonical candidate"):
        resolve_entry_method(
            selection=paper_selection(model=EntryModelV2.DIR_CLOSE),
            candidate=candidate(
                model=EntryModelV2.DIR_CLOSE,
                candidate_id_value="f" * 64,
            ),
            context=context(),
            profiles=(),
        )
