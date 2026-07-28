from __future__ import annotations

from dataclasses import FrozenInstanceError

import pytest

from prop_trading.domain.rd_entry_models import CandidateState, EntryDirection
from prop_trading.domain.rd_entry_models_v3 import (
    BocTier,
    EntryCandidateIdentityV3,
    EntryCandidateV3,
    EntryModelV3,
    candidate_id_v3,
)


def test_v3_models_are_exactly_three_active_models() -> None:
    assert tuple(EntryModelV3) == (
        EntryModelV3.BOC,
        EntryModelV3.DIR_CLOSE,
        EntryModelV3.HTF_FLIP,
    )


def test_boc_candidate_identity_includes_reference_and_tier() -> None:
    strict = candidate_id_v3(
        EntryCandidateIdentityV3(
            setup_id="setup-1",
            model=EntryModelV3.BOC,
            direction=EntryDirection.SHORT,
            event_anchor_epoch=1_000,
            trigger_ordinal=1,
            boc_tier=BocTier.HTF_TIMED,
            reference_candle_open_epoch=1_000,
        )
    )
    discretionary = candidate_id_v3(
        EntryCandidateIdentityV3(
            setup_id="setup-1",
            model=EntryModelV3.BOC,
            direction=EntryDirection.SHORT,
            event_anchor_epoch=1_000,
            trigger_ordinal=1,
            boc_tier=BocTier.DISCRETIONARY_5M,
            reference_candle_open_epoch=1_000,
        )
    )

    assert strict != discretionary


def test_boc_identity_requires_tier_and_reference_candle() -> None:
    with pytest.raises(ValueError, match="BOC identity requires tier and reference candle"):
        EntryCandidateIdentityV3(
            setup_id="setup-1",
            model=EntryModelV3.BOC,
            direction=EntryDirection.LONG,
            event_anchor_epoch=1_000,
            trigger_ordinal=1,
            boc_tier=None,
            reference_candle_open_epoch=None,
        )


def test_non_boc_identity_rejects_boc_fields() -> None:
    with pytest.raises(ValueError, match="non-BOC identity cannot carry BOC fields"):
        EntryCandidateIdentityV3(
            setup_id="setup-1",
            model=EntryModelV3.DIR_CLOSE,
            direction=EntryDirection.LONG,
            event_anchor_epoch=1_000,
            trigger_ordinal=1,
            boc_tier=BocTier.HTF_TIMED,
            reference_candle_open_epoch=900,
        )


def test_identity_is_immutable() -> None:
    identity = EntryCandidateIdentityV3(
        setup_id="setup-1",
        model=EntryModelV3.DIR_CLOSE,
        direction=EntryDirection.LONG,
        event_anchor_epoch=1_000,
        trigger_ordinal=1,
    )

    with pytest.raises(FrozenInstanceError):
        identity.trigger_ordinal = 2  # type: ignore[misc]


def test_v3_candidate_rejects_legacy_normalized_state() -> None:
    identity = EntryCandidateIdentityV3(
        setup_id="setup-1",
        model=EntryModelV3.DIR_CLOSE,
        direction=EntryDirection.LONG,
        event_anchor_epoch=1_000,
        trigger_ordinal=1,
    )

    with pytest.raises(ValueError, match="v3 candidate state"):
        EntryCandidateV3(
            candidate_id=candidate_id_v3(identity),
            setup_id=identity.setup_id,
            model=identity.model,
            state=CandidateState.NORMALIZED,
            direction=identity.direction,
            event_anchor_epoch=identity.event_anchor_epoch,
            trigger_ordinal=identity.trigger_ordinal,
            boc_tier=None,
            reference_candle_open_epoch=None,
            source_claim_ids=("claim-1",),
            observed_at_epoch=1_100,
        )
