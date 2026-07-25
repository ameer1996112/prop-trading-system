import pytest

from prop_trading.domain.rd_entry_method import (
    DirectionalCloseMethod,
    EntryMethod,
    RDEntryFillProfileV1,
    utc_minute_in_window,
)


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
