from __future__ import annotations

import pytest

from prop_trading.domain.rd_entry_arbitrator_v3 import (
    EntryArbitrationRequestV3,
    arbitrate_entry_candidates_v3,
)
from prop_trading.domain.rd_entry_models import (
    CandidateFidelity,
    CandidateState,
    EntryDirection,
    OrderedCandle,
    ProofPlane,
    SelectionAction,
)
from prop_trading.domain.rd_entry_models_v3 import (
    POLICY_VERSION_V3,
    BocTier,
    EntryCandidateEvidenceV3,
    EntryCandidateIdentityV3,
    EntryCandidateV3,
    EntryEvidenceIdentityV3,
    EntryModelV3,
    EntrySelectionIdentityV3,
    EntrySelectionV3,
    EvidenceReplayability,
    SelectionReason,
    candidate_id_v3,
    evidence_id_v3,
    evidence_payload_sha256_v3,
    selection_id_v3,
)


def candidate_evidence(
    model: EntryModelV3,
    *,
    trigger_epoch: int,
    sequence: int,
    ticks: int,
    state: CandidateState = CandidateState.MATCHED,
    fidelity: CandidateFidelity = CandidateFidelity.EXACT,
    setup_id: str = "setup-1",
    anchor_salt: int = 0,
    passed_rule_ids: tuple[str, ...] | None = None,
    coverage_start_epoch: int | None = None,
    coverage_end_epoch: int | None = None,
    event_anchor_epoch_override: int | None = None,
) -> tuple[EntryCandidateV3, EntryCandidateEvidenceV3]:
    tier = BocTier.HTF_TIMED if model is EntryModelV3.BOC else None
    reference_open_epoch = 600 + anchor_salt if model is EntryModelV3.BOC else None
    event_anchor_epoch = (
        event_anchor_epoch_override
        if event_anchor_epoch_override is not None
        else (reference_open_epoch or 900 + anchor_salt)
    )
    effective_coverage_start = (
        coverage_start_epoch
        if coverage_start_epoch is not None
        else (trigger_epoch - 300 if model is EntryModelV3.DIR_CLOSE else 900)
    )
    effective_coverage_end = (
        coverage_end_epoch
        if coverage_end_epoch is not None
        else (trigger_epoch if model is EntryModelV3.DIR_CLOSE else 2_000)
    )
    identity = EntryCandidateIdentityV3(
        setup_id=setup_id,
        model=model,
        direction=EntryDirection.LONG,
        event_anchor_epoch=event_anchor_epoch,
        trigger_ordinal=1,
        boc_tier=tier,
        reference_candle_open_epoch=reference_open_epoch,
    )
    candidate = EntryCandidateV3(
        candidate_id=candidate_id_v3(identity),
        setup_id=setup_id,
        model=model,
        state=state,
        direction=EntryDirection.LONG,
        event_anchor_epoch=event_anchor_epoch,
        trigger_ordinal=1,
        boc_tier=tier,
        reference_candle_open_epoch=reference_open_epoch,
        source_claim_ids=("claim-1",),
        observed_at_epoch=2_000,
    )
    plane = ProofPlane.CONFIRMED_5M if model is EntryModelV3.DIR_CLOSE else ProofPlane.REALTIME_TICK
    replayability = (
        EvidenceReplayability.REPLAYABLE
        if model is EntryModelV3.DIR_CLOSE
        else EvidenceReplayability.LIVE_EXACT_NON_REPLAYABLE
    )
    reference_fields = (
        {
            "reference_candle_open_epoch": reference_open_epoch,
            "reference_candle_open_ticks": 100,
            "reference_candle_high_ticks": 110,
            "reference_candle_low_ticks": 90,
            "reference_candle_close_ticks": 105,
        }
        if model is EntryModelV3.BOC
        else {
            "reference_candle_open_epoch": None,
            "reference_candle_open_ticks": None,
            "reference_candle_high_ticks": None,
            "reference_candle_low_ticks": None,
            "reference_candle_close_ticks": None,
        }
    )
    flip_fields: dict[str, object]
    if model is EntryModelV3.HTF_FLIP:
        flip_fields = {
            "htf_open_ticks": ticks,
            "contact_candle": OrderedCandle(
                open_epoch=900,
                close_epoch=trigger_epoch - 1,
                open_ticks=100,
                high_ticks=ticks - 1,
                low_ticks=90,
                close_ticks=100,
            ),
            "recross_candle": OrderedCandle(
                open_epoch=trigger_epoch - 1,
                close_epoch=trigger_epoch,
                open_ticks=ticks - 1,
                high_ticks=ticks + 1,
                low_ticks=ticks - 2,
                close_ticks=ticks,
            ),
            "coverage_gap_detected": False,
            "full_lifecycle_ordered": True,
            "destination_seen_before_contact": False,
        }
    else:
        flip_fields = {
            "htf_open_ticks": None,
            "contact_candle": None,
            "recross_candle": None,
            "coverage_gap_detected": None,
            "full_lifecycle_ordered": None,
            "destination_seen_before_contact": None,
        }
    authoritative_passed_rule_ids = passed_rule_ids or (
        {
            EntryModelV3.BOC: "ENTRY_BOC_HTF_TIMED",
            EntryModelV3.DIR_CLOSE: "ENTRY_DIR_CLOSE",
            EntryModelV3.HTF_FLIP: "ENTRY_HTF_FLIP",
        }[model],
    )
    payload = evidence_payload_sha256_v3(
        candidate_id=candidate.candidate_id,
        observed_trigger_epoch=trigger_epoch,
        trigger_sequence=sequence,
        observed_trigger_ticks=ticks,
        htf_context_minutes=(15,) if model is not EntryModelV3.DIR_CLOSE else (),
        fidelity=fidelity,
        proof_plane=plane,
        replayability=replayability,
        coverage_start_epoch=effective_coverage_start,
        coverage_end_epoch=effective_coverage_end,
        ambiguity_codes=(),
        boc_tier=tier,
        passed_rule_ids=authoritative_passed_rule_ids,
        failed_rule_ids=(),
        source_claim_ids=("claim-1",),
        **reference_fields,
        **flip_fields,
    )
    evidence_identity = EntryEvidenceIdentityV3(
        candidate_id=candidate.candidate_id,
        proof_plane=plane,
        coverage_start_epoch=effective_coverage_start,
        coverage_end_epoch=effective_coverage_end,
        observed_trigger_epoch=trigger_epoch,
        trigger_sequence=sequence,
        payload_sha256=payload,
    )
    evidence = EntryCandidateEvidenceV3(
        evidence_id=evidence_id_v3(evidence_identity),
        candidate_id=candidate.candidate_id,
        observed_trigger_epoch=trigger_epoch,
        trigger_sequence=sequence,
        observed_trigger_ticks=ticks,
        htf_context_minutes=(15,) if model is not EntryModelV3.DIR_CLOSE else (),
        fidelity=fidelity,
        proof_plane=plane,
        replayability=replayability,
        coverage_start_epoch=effective_coverage_start,
        coverage_end_epoch=effective_coverage_end,
        ambiguity_codes=(),
        boc_tier=tier,
        passed_rule_ids=authoritative_passed_rule_ids,
        failed_rule_ids=(),
        source_claim_ids=("claim-1",),
        payload_sha256=payload,
        observed_at_epoch=2_000,
        **reference_fields,
        **flip_fields,
    )
    return candidate, evidence


def exact_boc(
    *,
    trigger_epoch: int,
    sequence: int,
    ticks: int = 111,
) -> tuple[EntryCandidateV3, EntryCandidateEvidenceV3]:
    return candidate_evidence(
        EntryModelV3.BOC,
        trigger_epoch=trigger_epoch,
        sequence=sequence,
        ticks=ticks,
    )


def exact_close(
    *,
    trigger_epoch: int,
    sequence: int,
    ticks: int = 112,
) -> tuple[EntryCandidateV3, EntryCandidateEvidenceV3]:
    return candidate_evidence(
        EntryModelV3.DIR_CLOSE,
        trigger_epoch=trigger_epoch,
        sequence=sequence,
        ticks=ticks,
    )


def exact_flip(
    *,
    trigger_epoch: int,
    sequence: int,
    ticks: int = 111,
) -> tuple[EntryCandidateV3, EntryCandidateEvidenceV3]:
    return candidate_evidence(
        EntryModelV3.HTF_FLIP,
        trigger_epoch=trigger_epoch,
        sequence=sequence,
        ticks=ticks,
    )


def exact_selection(
    *,
    model: EntryModelV3,
    revision: int,
) -> EntrySelectionV3:
    candidate, evidence = candidate_evidence(
        model,
        trigger_epoch=1_300,
        sequence=0,
        ticks=112,
    )
    identity = EntrySelectionIdentityV3(
        setup_id="setup-1",
        policy_version=POLICY_VERSION_V3,
        revision=revision,
        candidate_ids_considered=(candidate.candidate_id,),
        canonical_candidate_id=candidate.candidate_id,
        canonical_evidence_id=evidence.evidence_id,
        reason=SelectionReason.ONLY_EXACT_TRIGGER,
        fidelity=CandidateFidelity.EXACT,
        action=SelectionAction.PAPER_ELIGIBLE,
        co_triggered_models=(),
    )
    return EntrySelectionV3(
        selection_id=selection_id_v3(identity),
        setup_id="setup-1",
        policy_version=POLICY_VERSION_V3,
        revision=revision,
        candidate_ids_considered=(candidate.candidate_id,),
        canonical_candidate_id=candidate.candidate_id,
        canonical_evidence_id=evidence.evidence_id,
        canonical_model=model,
        reason=SelectionReason.ONLY_EXACT_TRIGGER,
        fidelity=CandidateFidelity.EXACT,
        action=SelectionAction.PAPER_ELIGIBLE,
        co_triggered_models=(),
        evaluated_at_epoch=2_000,
    )


def arbitration(
    *pairs: tuple[EntryCandidateV3, EntryCandidateEvidenceV3],
    setup_invalidated: bool = False,
    opened_selection: EntrySelectionV3 | None = None,
) -> EntryArbitrationRequestV3:
    return EntryArbitrationRequestV3(
        setup_id="setup-1",
        candidates=tuple(pair[0] for pair in pairs),
        evidence=tuple(pair[1] for pair in pairs),
        setup_invalidated=setup_invalidated,
        policy_version=POLICY_VERSION_V3,
        revision=2,
        evaluated_at_epoch=2_000,
        opened_selection=opened_selection,
    )


def test_earliest_exact_boc_beats_later_close() -> None:
    selection = arbitrate_entry_candidates_v3(
        arbitration(
            exact_boc(trigger_epoch=1_001, sequence=2),
            exact_close(trigger_epoch=1_300, sequence=0),
        )
    )

    assert selection.canonical_model is EntryModelV3.BOC
    assert selection.reason is SelectionReason.EARLIEST_EXACT_TRIGGER
    assert selection.action is SelectionAction.PAPER_ELIGIBLE


def test_sequence_orders_candidates_within_same_epoch() -> None:
    selection = arbitrate_entry_candidates_v3(
        arbitration(
            exact_boc(trigger_epoch=1_001, sequence=9),
            exact_flip(trigger_epoch=1_001, sequence=2),
        )
    )

    assert selection.canonical_model is EntryModelV3.HTF_FLIP
    assert selection.reason is SelectionReason.EARLIEST_EXACT_TRIGGER


def test_same_event_boc_and_flip_create_a_co_trigger() -> None:
    selection = arbitrate_entry_candidates_v3(
        arbitration(
            exact_boc(trigger_epoch=1_001, sequence=2),
            exact_flip(trigger_epoch=1_001, sequence=2),
        )
    )

    assert selection.reason is SelectionReason.CO_TRIGGER_SAME_EVENT
    assert selection.co_triggered_models == (
        EntryModelV3.BOC,
        EntryModelV3.HTF_FLIP,
    )
    assert selection.action is SelectionAction.PAPER_ELIGIBLE


def test_same_event_price_conflict_is_shadow_only() -> None:
    selection = arbitrate_entry_candidates_v3(
        arbitration(
            exact_boc(trigger_epoch=1_001, sequence=2, ticks=111),
            exact_flip(trigger_epoch=1_001, sequence=2, ticks=112),
        )
    )

    assert selection.reason is SelectionReason.CO_TRIGGER_PRICE_CONFLICT
    assert selection.action is SelectionAction.SHADOW_ONLY
    assert selection.canonical_candidate_id is None


def test_confirmed_close_is_fallback_after_blocked_aggressive_models() -> None:
    blocked_boc = candidate_evidence(
        EntryModelV3.BOC,
        trigger_epoch=1_001,
        sequence=2,
        ticks=111,
        state=CandidateState.BLOCKED,
    )
    blocked_flip = candidate_evidence(
        EntryModelV3.HTF_FLIP,
        trigger_epoch=1_002,
        sequence=3,
        ticks=112,
        state=CandidateState.BLOCKED,
    )
    selection = arbitrate_entry_candidates_v3(
        arbitration(
            blocked_boc,
            blocked_flip,
            exact_close(trigger_epoch=1_300, sequence=0),
        )
    )

    assert selection.canonical_model is EntryModelV3.DIR_CLOSE
    assert selection.reason is SelectionReason.FALLBACK_TO_CONFIRMED_CLOSE
    assert selection.action is SelectionAction.PAPER_ELIGIBLE


def test_opened_selection_cannot_be_replaced() -> None:
    opened = exact_selection(model=EntryModelV3.DIR_CLOSE, revision=1)
    selection = arbitrate_entry_candidates_v3(
        arbitration(
            exact_boc(trigger_epoch=900, sequence=1),
            opened_selection=opened,
        )
    )

    assert selection == opened


def test_invalidated_setup_cannot_select_an_exact_candidate() -> None:
    selection = arbitrate_entry_candidates_v3(
        arbitration(
            exact_boc(trigger_epoch=1_001, sequence=2),
            setup_invalidated=True,
        )
    )

    assert selection.reason is SelectionReason.SETUP_INVALIDATED
    assert selection.action is SelectionAction.NONE
    assert selection.canonical_candidate_id is None


def test_wrong_model_rule_cannot_bypass_exact_eligibility() -> None:
    forged = candidate_evidence(
        EntryModelV3.HTF_FLIP,
        trigger_epoch=1_001,
        sequence=2,
        ticks=111,
        passed_rule_ids=("ENTRY_BOC_HTF_TIMED",),
    )

    selection = arbitrate_entry_candidates_v3(arbitration(forged))

    assert selection.reason is SelectionReason.NO_EXACT_CANDIDATE
    assert selection.action is SelectionAction.SHADOW_ONLY


def test_one_minute_close_evidence_cannot_bypass_exact_eligibility() -> None:
    forged = candidate_evidence(
        EntryModelV3.DIR_CLOSE,
        trigger_epoch=1_300,
        sequence=0,
        ticks=112,
        coverage_start_epoch=1_240,
        coverage_end_epoch=1_300,
    )

    selection = arbitrate_entry_candidates_v3(arbitration(forged))

    assert selection.reason is SelectionReason.NO_EXACT_CANDIDATE
    assert selection.action is SelectionAction.SHADOW_ONLY


@pytest.mark.parametrize("anchor_epoch", [0, 1_800])
def test_flip_anchor_or_context_chronology_cannot_bypass_exact_eligibility(
    anchor_epoch: int,
) -> None:
    forged = candidate_evidence(
        EntryModelV3.HTF_FLIP,
        trigger_epoch=1_001,
        sequence=2,
        ticks=111,
        event_anchor_epoch_override=anchor_epoch,
    )

    selection = arbitrate_entry_candidates_v3(arbitration(forged))

    assert selection.reason is SelectionReason.NO_EXACT_CANDIDATE
    assert selection.action is SelectionAction.SHADOW_ONLY
