from dataclasses import replace

import pytest

from prop_trading.domain.rd_entry_matcher import SetupEntryFacts
from prop_trading.domain.rd_entry_models import (
    AmbiguityCode,
    CandidateFidelity,
    EntryDirection,
    OrderedCandle,
)
from prop_trading.domain.rd_intrabar_oracle import (
    HTFFlipScanRequest,
    scan_htf_flip,
    validate_htf_flip_transcript,
)

OPEN_EPOCH = 1_721_808_000


def _setup(
    *,
    direction: EntryDirection = EntryDirection.LONG,
    zone_bottom_ticks: int = 95,
    zone_top_ticks: int = 97,
) -> SetupEntryFacts:
    return SetupEntryFacts(
        setup_id="setup-1",
        direction=direction,
        zone_top_ticks=zone_top_ticks,
        zone_bottom_ticks=zone_bottom_ticks,
        zone_engaged_epoch=OPEN_EPOCH,
        invalidated_before_entry=False,
        common_fidelity=CandidateFidelity.EXACT,
        terminal_reason=None,
        terminal_epoch=None,
    )


def _candle(
    index: int,
    *,
    open_ticks: int = 99,
    high_ticks: int = 100,
    low_ticks: int = 98,
    close_ticks: int = 99,
    open_epoch: int | None = None,
    close_epoch: int | None = None,
) -> OrderedCandle:
    start = OPEN_EPOCH + index * 60 if open_epoch is None else open_epoch
    end = start + 60 if close_epoch is None else close_epoch
    return OrderedCandle(
        open_epoch=start,
        close_epoch=end,
        open_ticks=open_ticks,
        high_ticks=high_ticks,
        low_ticks=low_ticks,
        close_ticks=close_ticks,
    )


def _request(
    children: tuple[OrderedCandle, ...],
    *,
    setup: SetupEntryFacts | None = None,
    timeframe_minutes: int = 15,
    cutoff_seconds: int = 300,
    htf_open_ticks: int = 100,
    proof_resolution_seconds: int = 60,
    full_lifecycle_ordered: bool = True,
) -> HTFFlipScanRequest:
    return HTFFlipScanRequest(
        setup=setup or _setup(),
        timeframe_minutes=timeframe_minutes,
        htf_open_epoch=OPEN_EPOCH,
        scan_cutoff_epoch=OPEN_EPOCH + cutoff_seconds,
        htf_open_ticks=htf_open_ticks,
        children=children,
        proof_resolution_seconds=proof_resolution_seconds,
        full_lifecycle_ordered=full_lifecycle_ordered,
    )


def _exact_demand_request() -> HTFFlipScanRequest:
    return _request(
        (
            _candle(
                0,
                open_ticks=100,
                high_ticks=100,
                low_ticks=100,
                close_ticks=100,
            ),
            _candle(1, low_ticks=96, close_ticks=97),
            _candle(2, high_ticks=101, close_ticks=100),
            _candle(3),
            _candle(4),
        )
    )


def _same_child_demand_request(
    *,
    zone_bottom_ticks: int = 95,
    zone_top_ticks: int = 97,
    child_open_ticks: int = 99,
) -> HTFFlipScanRequest:
    return _request(
        (
            _candle(
                0,
                open_ticks=100,
                high_ticks=100,
                low_ticks=100,
                close_ticks=100,
            ),
            _candle(
                1,
                open_ticks=child_open_ticks,
                high_ticks=101,
                low_ticks=96,
                close_ticks=99,
            ),
            _candle(2),
            _candle(3),
            _candle(4),
        ),
        setup=_setup(
            zone_bottom_ticks=zone_bottom_ticks,
            zone_top_ticks=zone_top_ticks,
        ),
    )


def test_distinct_child_contact_then_recross_is_exact() -> None:
    result = scan_htf_flip(_exact_demand_request())

    assert result.matched is True
    assert result.fidelity is CandidateFidelity.EXACT
    assert result.ambiguity_codes == ()
    assert result.trigger_epoch == OPEN_EPOCH + 180


def test_supply_contact_then_recross_is_symmetric() -> None:
    request = _request(
        (
            _candle(0, open_ticks=100, high_ticks=102, low_ticks=100, close_ticks=101),
            _candle(1, open_ticks=101, high_ticks=104, low_ticks=101, close_ticks=103),
            _candle(2, open_ticks=101, high_ticks=102, low_ticks=99, close_ticks=100),
            _candle(3),
            _candle(4),
        ),
        setup=_setup(
            direction=EntryDirection.SHORT,
            zone_bottom_ticks=103,
            zone_top_ticks=105,
        ),
    )

    result = scan_htf_flip(request)

    assert result.matched is True
    assert result.fidelity is CandidateFidelity.EXACT
    assert result.trigger_ticks == 100


def test_later_5m_slice_wick_recross_is_detected_even_if_child_closes_back() -> None:
    children = tuple(_candle(index) for index in range(15))
    children = (
        *children[:6],
        _candle(6, low_ticks=96, close_ticks=97),
        *children[7:11],
        _candle(11, high_ticks=103, close_ticks=99),
        *children[12:],
    )
    request = _request(children, cutoff_seconds=900)

    result = scan_htf_flip(request)

    assert request.scan_cutoff_epoch - request.htf_open_epoch == 900
    assert result.matched is True
    assert result.trigger_ticks == 100
    assert result.trigger_epoch == OPEN_EPOCH + 720
    assert result.coverage_end_epoch == request.scan_cutoff_epoch
    assert result.coverage_observed_child_count == 15


def test_same_child_low_and_high_are_ambiguous() -> None:
    result = scan_htf_flip(_same_child_demand_request())

    assert result.matched is True
    assert result.fidelity is CandidateFidelity.UNRESOLVED
    assert result.ambiguity_codes == (AmbiguityCode.SAME_CHILD_BAR_ORDER,)


def test_same_child_open_inside_zone_proves_contact_before_wick_recross() -> None:
    result = scan_htf_flip(
        _same_child_demand_request(
            zone_bottom_ticks=97,
            zone_top_ticks=99,
            child_open_ticks=98,
        )
    )

    assert result.matched is True
    assert result.fidelity is CandidateFidelity.EXACT
    assert result.ambiguity_codes == ()


def test_destination_before_contact_retains_shadow_observation() -> None:
    result = scan_htf_flip(
        _request(
            (
                _candle(0, high_ticks=101, close_ticks=100),
                _candle(1, low_ticks=96, close_ticks=97),
                _candle(2, high_ticks=101, close_ticks=100),
                _candle(3),
                _candle(4),
            )
        )
    )

    assert result.matched is True
    assert result.destination_seen_before_contact is True
    assert result.fidelity is CandidateFidelity.UNRESOLVED
    assert result.ambiguity_codes == ()


def test_incomplete_lifecycle_retains_only_unresolved_observation() -> None:
    result = scan_htf_flip(replace(_exact_demand_request(), full_lifecycle_ordered=False))

    assert result.matched is True
    assert result.fidelity is CandidateFidelity.UNRESOLVED
    assert result.ambiguity_codes == ()


def test_empty_children_fail_closed() -> None:
    result = scan_htf_flip(_request(()))

    assert result.matched is False
    assert result.contact_child is None
    assert result.recross_child is None
    assert result.fidelity is CandidateFidelity.UNRESOLVED
    assert result.ambiguity_codes == (AmbiguityCode.MISSING_INTRABAR_COVERAGE,)


def test_contact_before_gap_cannot_authorize_later_recross() -> None:
    result = scan_htf_flip(
        _request(
            (
                _candle(0, low_ticks=96, close_ticks=97),
                _candle(1),
                _candle(3, high_ticks=101, close_ticks=100),
                _candle(4),
            )
        )
    )

    assert result.matched is False
    assert result.contact_child is None
    assert result.recross_child is None
    assert result.fidelity is CandidateFidelity.UNRESOLVED
    assert result.ambiguity_codes == (AmbiguityCode.MISSING_INTRABAR_COVERAGE,)


def test_new_post_gap_contact_and_recross_is_shadow_only() -> None:
    result = scan_htf_flip(
        _request(
            (
                _candle(0, low_ticks=96, close_ticks=97),
                _candle(2, low_ticks=96, close_ticks=97),
                _candle(3, high_ticks=101, close_ticks=100),
                _candle(4),
            )
        )
    )

    assert result.matched is True
    assert result.contact_child == _candle(2, low_ticks=96, close_ticks=97)
    assert result.recross_child == _candle(3, high_ticks=101, close_ticks=100)
    assert result.fidelity is CandidateFidelity.UNRESOLVED
    assert result.ambiguity_codes == (AmbiguityCode.MISSING_INTRABAR_COVERAGE,)


def test_compact_transcript_replays_to_the_same_proof() -> None:
    request = _exact_demand_request()
    scanned = scan_htf_flip(request)
    replayed = validate_htf_flip_transcript(request.setup, scanned.transcript)

    assert replayed == scanned


@pytest.mark.parametrize(
    ("field", "value", "message"),
    [
        ("observed_child_count", 999, "observed child count"),
        ("same_child", True, "same_child must exactly reflect"),
        ("contact_candle", None, "recross_candle requires"),
    ],
)
def test_tampered_compact_transcript_is_rejected(
    field: str,
    value: object,
    message: str,
) -> None:
    request = _exact_demand_request()
    proof = scan_htf_flip(request)

    with pytest.raises(ValueError, match=message):
        validate_htf_flip_transcript(
            request.setup,
            replace(proof.transcript, **{field: value}),
        )


def test_semantically_tampered_contact_or_recross_is_rejected() -> None:
    request = _exact_demand_request()
    transcript = scan_htf_flip(request).transcript

    with pytest.raises(ValueError, match="contact candle"):
        validate_htf_flip_transcript(
            request.setup,
            replace(transcript, contact_candle=_candle(1)),
        )
    with pytest.raises(ValueError, match="recross candle"):
        validate_htf_flip_transcript(
            request.setup,
            replace(
                transcript,
                recross_candle=_candle(2),
            ),
        )


@pytest.mark.parametrize(
    ("changes", "message"),
    [
        (
            {
                "scan_cutoff_epoch": OPEN_EPOCH + 301,
                "coverage_end_epoch": OPEN_EPOCH + 301,
            },
            "coverage length",
        ),
        ({"expected_child_count": 4}, "expected child count"),
        ({"observed_child_count": 4}, "gap flag"),
        ({"gap_present": True}, "gap flag"),
        (
            {
                "scan_cutoff_epoch": OPEN_EPOCH + 960,
                "coverage_end_epoch": OPEN_EPOCH + 960,
            },
            "scan cutoff",
        ),
    ],
)
def test_transcript_count_boundary_and_alignment_invariants(
    changes: dict[str, object],
    message: str,
) -> None:
    request = _exact_demand_request()
    transcript = scan_htf_flip(request).transcript

    with pytest.raises(ValueError, match=message):
        validate_htf_flip_transcript(
            request.setup,
            replace(transcript, **changes),
        )


@pytest.mark.parametrize(
    ("changes", "message"),
    [
        ({"timeframe_minutes": 5}, "one of"),
        ({"scan_cutoff_epoch": OPEN_EPOCH}, "inside"),
        ({"scan_cutoff_epoch": OPEN_EPOCH + 301}, "five-minute"),
        ({"scan_cutoff_epoch": OPEN_EPOCH + 1_200}, "inside"),
        ({"proof_resolution_seconds": 300}, "divide 300"),
        ({"proof_resolution_seconds": 45}, "divide 300"),
        ({"htf_open_epoch": True}, "integer"),
        ({"full_lifecycle_ordered": 1}, "bool"),
    ],
)
def test_scan_request_rejects_invalid_boundaries_and_scalar_types(
    changes: dict[str, object],
    message: str,
) -> None:
    with pytest.raises(ValueError, match=message):
        replace(_exact_demand_request(), **changes)


def test_scan_rejects_children_outside_cutoff_or_not_oldest_first() -> None:
    future = (*_exact_demand_request().children, _candle(5))
    reversed_children = tuple(reversed(_exact_demand_request().children))

    with pytest.raises(ValueError, match="cutoff"):
        scan_htf_flip(_request(future))
    with pytest.raises(ValueError, match="oldest-first"):
        scan_htf_flip(_request(reversed_children))


def test_retained_candles_must_be_resolution_aligned_and_inside_coverage() -> None:
    request = _exact_demand_request()
    transcript = scan_htf_flip(request).transcript
    shifted_contact = OrderedCandle(
        open_epoch=OPEN_EPOCH + 61,
        close_epoch=OPEN_EPOCH + 121,
        open_ticks=99,
        high_ticks=100,
        low_ticks=96,
        close_ticks=97,
    )

    with pytest.raises(ValueError, match="aligned"):
        validate_htf_flip_transcript(
            request.setup,
            replace(transcript, contact_candle=shifted_contact),
        )


def test_same_interval_requires_identical_same_child_candle() -> None:
    request = _same_child_demand_request(
        zone_bottom_ticks=97,
        zone_top_ticks=99,
        child_open_ticks=98,
    )
    transcript = scan_htf_flip(request).transcript
    different_ohlc = replace(transcript.recross_candle, close_ticks=100)

    with pytest.raises(ValueError, match="same-child transcript candles differ"):
        validate_htf_flip_transcript(
            request.setup,
            replace(transcript, recross_candle=different_ohlc),
        )
