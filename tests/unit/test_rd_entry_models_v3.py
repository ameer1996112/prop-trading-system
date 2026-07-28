from __future__ import annotations

from dataclasses import FrozenInstanceError, replace

import pytest

from prop_trading.domain.rd_entry_models import (
    CandidateFidelity,
    CandidateState,
    EntryDirection,
    OrderedCandle,
    ProofPlane,
)
from prop_trading.domain.rd_entry_models_v3 import (
    BocProof,
    BocTier,
    EntryCandidateEvidenceV3,
    EntryCandidateIdentityV3,
    EntryCandidateV3,
    EntryEvidenceIdentityV3,
    EntryModelV3,
    EvidenceReplayability,
    candidate_id_v3,
    evidence_id_v3,
    evidence_payload_sha256_v3,
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


def _reference_candle(*, open_epoch: int = 900) -> OrderedCandle:
    return OrderedCandle(
        open_epoch=open_epoch,
        close_epoch=open_epoch + 300,
        open_ticks=105,
        high_ticks=110,
        low_ticks=100,
        close_ticks=102,
    )


def _boc_proof() -> BocProof:
    return BocProof(
        reference_candle=_reference_candle(),
        trigger_candle_open_epoch=1_800,
        trigger_epoch=1_801,
        trigger_sequence=7,
        trigger_ticks=111,
        htf_boundary_epoch=1_800,
        htf_context_minutes=(15, 30),
        proof_plane=ProofPlane.REALTIME_TICK,
        replayability=EvidenceReplayability.LIVE_EXACT_NON_REPLAYABLE,
        fidelity=CandidateFidelity.EXACT,
        coverage_start_epoch=900,
        coverage_end_epoch=2_400,
        is_realtime=True,
    )


def test_boc_reference_must_precede_trigger_candle() -> None:
    with pytest.raises(ValueError, match="reference candle must precede"):
        replace(_boc_proof(), reference_candle=_reference_candle(open_epoch=1_800))


@pytest.mark.parametrize("trigger_epoch", [1_799, 2_100])
def test_boc_trigger_must_be_inside_its_five_minute_candle(
    trigger_epoch: int,
) -> None:
    with pytest.raises(ValueError, match="trigger.*five-minute candle"):
        replace(_boc_proof(), trigger_epoch=trigger_epoch)


def _close_evidence(
    *,
    trigger_epoch: int = 1_200,
    coverage_start_epoch: int = 900,
    coverage_end_epoch: int = 1_200,
    observed_at_epoch: int = 1_200,
    proof_plane: ProofPlane = ProofPlane.CONFIRMED_5M,
    replayability: EvidenceReplayability = EvidenceReplayability.REPLAYABLE,
    passed_rule_ids: tuple[str, ...] = ("ENTRY_DIR_CLOSE",),
    failed_rule_ids: tuple[str, ...] = (),
) -> EntryCandidateEvidenceV3:
    candidate_id = "a" * 64
    payload_sha256 = evidence_payload_sha256_v3(
        candidate_id=candidate_id,
        observed_trigger_epoch=trigger_epoch,
        trigger_sequence=0,
        observed_trigger_ticks=109,
        htf_context_minutes=(),
        fidelity=CandidateFidelity.EXACT,
        proof_plane=proof_plane,
        replayability=replayability,
        coverage_start_epoch=coverage_start_epoch,
        coverage_end_epoch=coverage_end_epoch,
        ambiguity_codes=(),
        boc_tier=None,
        reference_candle_open_epoch=None,
        reference_candle_open_ticks=None,
        reference_candle_high_ticks=None,
        reference_candle_low_ticks=None,
        reference_candle_close_ticks=None,
        htf_open_ticks=None,
        contact_candle=None,
        recross_candle=None,
        coverage_gap_detected=None,
        full_lifecycle_ordered=None,
        destination_seen_before_contact=None,
        passed_rule_ids=passed_rule_ids,
        failed_rule_ids=failed_rule_ids,
        source_claim_ids=("claim-1",),
    )
    identity = EntryEvidenceIdentityV3(
        candidate_id=candidate_id,
        proof_plane=proof_plane,
        coverage_start_epoch=coverage_start_epoch,
        coverage_end_epoch=coverage_end_epoch,
        observed_trigger_epoch=trigger_epoch,
        trigger_sequence=0,
        payload_sha256=payload_sha256,
    )
    return EntryCandidateEvidenceV3(
        evidence_id=evidence_id_v3(identity),
        candidate_id=candidate_id,
        observed_trigger_epoch=trigger_epoch,
        trigger_sequence=0,
        observed_trigger_ticks=109,
        htf_context_minutes=(),
        fidelity=CandidateFidelity.EXACT,
        proof_plane=proof_plane,
        replayability=replayability,
        coverage_start_epoch=coverage_start_epoch,
        coverage_end_epoch=coverage_end_epoch,
        ambiguity_codes=(),
        boc_tier=None,
        reference_candle_open_epoch=None,
        reference_candle_open_ticks=None,
        reference_candle_high_ticks=None,
        reference_candle_low_ticks=None,
        reference_candle_close_ticks=None,
        htf_open_ticks=None,
        contact_candle=None,
        recross_candle=None,
        coverage_gap_detected=None,
        full_lifecycle_ordered=None,
        destination_seen_before_contact=None,
        passed_rule_ids=passed_rule_ids,
        failed_rule_ids=failed_rule_ids,
        source_claim_ids=("claim-1",),
        payload_sha256=payload_sha256,
        observed_at_epoch=observed_at_epoch,
    )


def test_evidence_trigger_must_be_inside_coverage() -> None:
    with pytest.raises(ValueError, match="trigger.*coverage"):
        _close_evidence(trigger_epoch=899)


def test_evidence_coverage_must_not_extend_past_observation() -> None:
    with pytest.raises(ValueError, match="coverage.*observation"):
        _close_evidence(coverage_end_epoch=1_300)


def test_non_realtime_plane_requires_replayable_evidence() -> None:
    with pytest.raises(ValueError, match="replayability.*proof plane"):
        _close_evidence(
            proof_plane=ProofPlane.LOWER_TIMEFRAME_REPLAY,
            replayability=EvidenceReplayability.LIVE_EXACT_NON_REPLAYABLE,
        )


def test_exact_evidence_cannot_carry_failed_rules() -> None:
    with pytest.raises(ValueError, match="exact evidence.*failed"):
        _close_evidence(failed_rule_ids=("COMMON_SETUP_NOT_EXACT",))


def test_evidence_rejects_coordinated_forged_payload_digest() -> None:
    evidence = _close_evidence()
    forged_payload_sha256 = "b" * 64
    forged_identity = EntryEvidenceIdentityV3(
        candidate_id=evidence.candidate_id,
        proof_plane=evidence.proof_plane,
        coverage_start_epoch=evidence.coverage_start_epoch,
        coverage_end_epoch=evidence.coverage_end_epoch,
        observed_trigger_epoch=evidence.observed_trigger_epoch,
        trigger_sequence=evidence.trigger_sequence,
        payload_sha256=forged_payload_sha256,
    )

    with pytest.raises(ValueError, match="payload digest"):
        replace(
            evidence,
            payload_sha256=forged_payload_sha256,
            evidence_id=evidence_id_v3(forged_identity),
        )
