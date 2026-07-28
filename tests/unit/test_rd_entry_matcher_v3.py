from __future__ import annotations

from dataclasses import replace

import pytest

from prop_trading.contracts.rd_strategy_v3 import (
    RDStrategyRuleContractV3,
    load_rd_strategy_contract_v3,
)
from prop_trading.domain.rd_entry_matcher_v3 import (
    EntryMatchRequestV3,
    SetupEntryFactsV3,
    match_entry_candidates_v3,
)
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
    EntryModelV3,
    EntryTriggerProofV3,
    EvidenceReplayability,
)


def bar(
    *,
    open_epoch: int = 900,
    open_ticks: int = 105,
    high: int = 110,
    low: int = 100,
    close: int = 102,
) -> OrderedCandle:
    return OrderedCandle(
        open_epoch=open_epoch,
        close_epoch=open_epoch + 300,
        open_ticks=open_ticks,
        high_ticks=high,
        low_ticks=low,
        close_ticks=close,
    )


def boc(
    *,
    reference: OrderedCandle | None = None,
    trigger_candle_open_epoch: int = 1_800,
    trigger_epoch: int = 1_801,
    trigger_sequence: int = 7,
    trigger_ticks: int = 111,
    htf_boundary_epoch: int | None = 1_800,
    contexts: tuple[int, ...] = (15, 30),
    plane: ProofPlane = ProofPlane.REALTIME_TICK,
    replayability: EvidenceReplayability = (EvidenceReplayability.LIVE_EXACT_NON_REPLAYABLE),
    fidelity: CandidateFidelity = CandidateFidelity.EXACT,
    is_realtime: bool = True,
) -> BocProof:
    return BocProof(
        reference_candle=reference or bar(),
        trigger_candle_open_epoch=trigger_candle_open_epoch,
        trigger_epoch=trigger_epoch,
        trigger_sequence=trigger_sequence,
        trigger_ticks=trigger_ticks,
        htf_boundary_epoch=htf_boundary_epoch,
        htf_context_minutes=contexts,
        proof_plane=plane,
        replayability=replayability,
        fidelity=fidelity,
        coverage_start_epoch=900,
        coverage_end_epoch=max(2_100, trigger_epoch),
        is_realtime=is_realtime,
    )


def flip(
    *,
    event_anchor_epoch: int = 1_800,
    trigger_epoch: int = 1_802,
    trigger_sequence: int = 8,
    trigger_ticks: int = 112,
    plane: ProofPlane = ProofPlane.REALTIME_TICK,
    replayability: EvidenceReplayability = (EvidenceReplayability.LIVE_EXACT_NON_REPLAYABLE),
    is_realtime: bool = True,
    coverage_gap_detected: bool = False,
    full_lifecycle_ordered: bool = True,
    contact_already_recrossed: bool = False,
) -> EntryTriggerProofV3:
    contact = OrderedCandle(
        open_epoch=trigger_epoch - 2,
        close_epoch=trigger_epoch - 1,
        open_ticks=105,
        high_ticks=(trigger_ticks + 1 if contact_already_recrossed else 110),
        low_ticks=100,
        close_ticks=105,
    )
    recross = OrderedCandle(
        open_epoch=trigger_epoch - 1,
        close_epoch=trigger_epoch,
        open_ticks=110,
        high_ticks=max(trigger_ticks + 1, 112),
        low_ticks=109,
        close_ticks=trigger_ticks,
    )
    return EntryTriggerProofV3(
        event_anchor_epoch=event_anchor_epoch,
        trigger_epoch=trigger_epoch,
        trigger_sequence=trigger_sequence,
        trigger_ticks=trigger_ticks,
        htf_open_ticks=trigger_ticks,
        htf_context_minutes=(15, 30),
        proof_plane=plane,
        replayability=replayability,
        fidelity=CandidateFidelity.EXACT,
        coverage_start_epoch=900,
        coverage_end_epoch=2_100,
        is_realtime=is_realtime,
        contact_candle=contact,
        recross_candle=recross,
        coverage_gap_detected=coverage_gap_detected,
        full_lifecycle_ordered=full_lifecycle_ordered,
        destination_seen_before_contact=False,
        ambiguity_codes=(),
    )


def contract() -> RDStrategyRuleContractV3:
    return load_rd_strategy_contract_v3()


def request(
    *,
    direction: EntryDirection = EntryDirection.LONG,
    common_fidelity: CandidateFidelity = CandidateFidelity.EXACT,
    zone_engaged_epoch: int | None = 800,
    reference: OrderedCandle | None = None,
    boc_proof: BocProof | None = None,
    directional_close: bool = False,
    confirmed_bar: OrderedCandle | None = None,
    htf_flip_proof: EntryTriggerProofV3 | None = None,
) -> EntryMatchRequestV3:
    proof = boc_proof
    if proof is not None and reference is not None:
        proof = replace(proof, reference_candle=reference)
    return EntryMatchRequestV3(
        setup=SetupEntryFactsV3(
            setup_id="setup-1",
            direction=direction,
            zone_top_ticks=103,
            zone_bottom_ticks=97,
            zone_engaged_epoch=zone_engaged_epoch,
            invalidated_before_entry=False,
            common_fidelity=common_fidelity,
        ),
        rule_contract=contract(),
        boc_proof=proof,
        directional_close=directional_close,
        confirmed_bar=confirmed_bar,
        close_trigger_sequence=0,
        htf_flip_proof=htf_flip_proof,
        observed_at_epoch=2_400,
    )


def only(values: tuple[object, ...], **expected: object) -> object:
    matches = [
        value
        for value in values
        if all(getattr(value, name) == wanted for name, wanted in expected.items())
    ]
    assert len(matches) == 1
    return matches[0]


def test_strict_short_boc_matches_on_first_htf_child() -> None:
    reference = bar(open_epoch=900, high=110, low=100, close=102)
    result = match_entry_candidates_v3(
        request(
            direction=EntryDirection.SHORT,
            reference=reference,
            boc_proof=boc(
                reference=reference,
                trigger_candle_open_epoch=1_800,
                trigger_epoch=1_801,
                trigger_sequence=7,
                trigger_ticks=99,
                htf_boundary_epoch=1_800,
                contexts=(15, 30),
                is_realtime=True,
            ),
        )
    )

    candidate = only(result.candidates, model=EntryModelV3.BOC)
    evidence = only(result.evidence, candidate_id=candidate.candidate_id)
    assert candidate.boc_tier is BocTier.HTF_TIMED
    assert candidate.state is CandidateState.MATCHED
    assert evidence.passed_rule_ids == ("ENTRY_BOC_HTF_TIMED",)
    assert evidence.replayability is EvidenceReplayability.LIVE_EXACT_NON_REPLAYABLE


def test_strict_long_boc_breaks_above_reference_high() -> None:
    result = match_entry_candidates_v3(request(boc_proof=boc(trigger_ticks=111)))

    candidate = only(result.candidates, model=EntryModelV3.BOC)
    evidence = only(result.evidence, candidate_id=candidate.candidate_id)
    assert candidate.state is CandidateState.MATCHED
    assert evidence.observed_trigger_ticks == 111
    assert evidence.reference_candle_high_ticks == 110


def test_non_boundary_boc_is_retained_but_shadow_only() -> None:
    result = match_entry_candidates_v3(
        request(
            boc_proof=boc(
                trigger_candle_open_epoch=2_100,
                trigger_epoch=2_101,
                htf_boundary_epoch=None,
                contexts=(),
            )
        )
    )

    candidate = only(result.candidates, model=EntryModelV3.BOC)
    evidence = only(result.evidence, candidate_id=candidate.candidate_id)
    assert candidate.boc_tier is BocTier.DISCRETIONARY_5M
    assert evidence.fidelity is CandidateFidelity.DISCRETIONARY
    assert evidence.failed_rule_ids == ("BOC_DISCRETIONARY_CONTEXT_UNQUANTIFIED",)


def test_wrong_direction_boc_is_rejected() -> None:
    result = match_entry_candidates_v3(
        request(direction=EntryDirection.LONG, boc_proof=boc(trigger_ticks=99))
    )

    candidate = only(result.candidates, model=EntryModelV3.BOC)
    evidence = only(result.evidence, candidate_id=candidate.candidate_id)
    assert candidate.state is CandidateState.REJECTED
    assert evidence.failed_rule_ids == ("BOC_WRONG_DIRECTION",)


def test_boc_before_zone_engagement_is_blocked() -> None:
    result = match_entry_candidates_v3(
        request(zone_engaged_epoch=1_900, boc_proof=boc(trigger_epoch=1_801))
    )

    candidate = only(result.candidates, model=EntryModelV3.BOC)
    evidence = only(result.evidence, candidate_id=candidate.candidate_id)
    assert candidate.state is CandidateState.BLOCKED
    assert evidence.failed_rule_ids == ("ENTRY_BEFORE_ZONE_ENGAGEMENT",)


def test_replay_boc_is_exact_and_replayable() -> None:
    result = match_entry_candidates_v3(
        request(
            boc_proof=boc(
                plane=ProofPlane.LOWER_TIMEFRAME_REPLAY,
                replayability=EvidenceReplayability.REPLAYABLE,
                is_realtime=False,
            )
        )
    )

    evidence = only(result.evidence, boc_tier=BocTier.HTF_TIMED)
    assert evidence.fidelity is CandidateFidelity.EXACT
    assert evidence.replayability is EvidenceReplayability.REPLAYABLE


def test_realtime_claim_on_non_realtime_event_is_blocked() -> None:
    result = match_entry_candidates_v3(request(boc_proof=boc(is_realtime=False)))

    candidate = only(result.candidates, model=EntryModelV3.BOC)
    evidence = only(result.evidence, candidate_id=candidate.candidate_id)
    assert candidate.state is CandidateState.BLOCKED
    assert evidence.failed_rule_ids == ("REALTIME_EVIDENCE_NOT_LIVE",)


@pytest.mark.parametrize("model", [EntryModelV3.BOC, EntryModelV3.HTF_FLIP])
def test_replayability_mismatch_is_retained_as_blocked_evidence(
    model: EntryModelV3,
) -> None:
    result = match_entry_candidates_v3(
        request(
            boc_proof=(
                boc(
                    plane=ProofPlane.LOWER_TIMEFRAME_REPLAY,
                    replayability=EvidenceReplayability.LIVE_EXACT_NON_REPLAYABLE,
                    is_realtime=False,
                )
                if model is EntryModelV3.BOC
                else None
            ),
            htf_flip_proof=(
                flip(
                    plane=ProofPlane.LOWER_TIMEFRAME_REPLAY,
                    replayability=EvidenceReplayability.LIVE_EXACT_NON_REPLAYABLE,
                    is_realtime=False,
                )
                if model is EntryModelV3.HTF_FLIP
                else None
            ),
        )
    )

    candidate = only(result.candidates, model=model)
    evidence = only(result.evidence, candidate_id=candidate.candidate_id)
    assert candidate.state is CandidateState.BLOCKED
    assert evidence.fidelity is CandidateFidelity.UNRESOLVED
    assert evidence.failed_rule_ids == ("EVIDENCE_REPLAYABILITY_MISMATCH",)


def test_unresolved_common_setup_blocks_every_entry_model() -> None:
    result = match_entry_candidates_v3(
        request(
            common_fidelity=CandidateFidelity.UNRESOLVED,
            boc_proof=boc(),
            directional_close=True,
            confirmed_bar=bar(open_epoch=1_800, close=109),
            htf_flip_proof=flip(),
        )
    )

    assert {candidate.state for candidate in result.candidates} == {CandidateState.BLOCKED}
    assert len(result.candidates) == 3
    assert all("COMMON_SETUP_NOT_EXACT" in evidence.failed_rule_ids for evidence in result.evidence)


def test_boc_and_flip_are_emitted_independently_at_same_event() -> None:
    result = match_entry_candidates_v3(
        request(
            boc_proof=boc(trigger_epoch=1_802, trigger_sequence=7, trigger_ticks=111),
            htf_flip_proof=flip(
                trigger_epoch=1_802,
                trigger_sequence=7,
                trigger_ticks=111,
            ),
        )
    )

    assert {candidate.model for candidate in result.candidates} == {
        EntryModelV3.BOC,
        EntryModelV3.HTF_FLIP,
    }


def test_flip_requires_ordered_contact_then_open_recross() -> None:
    result = match_entry_candidates_v3(request(htf_flip_proof=flip()))

    candidate = only(result.candidates, model=EntryModelV3.HTF_FLIP)
    evidence = only(result.evidence, candidate_id=candidate.candidate_id)
    assert candidate.state is CandidateState.MATCHED
    assert evidence.passed_rule_ids == ("ENTRY_HTF_FLIP",)


def test_flip_with_coverage_gap_is_blocked() -> None:
    result = match_entry_candidates_v3(request(htf_flip_proof=flip(coverage_gap_detected=True)))

    candidate = only(result.candidates, model=EntryModelV3.HTF_FLIP)
    evidence = only(result.evidence, candidate_id=candidate.candidate_id)
    assert candidate.state is CandidateState.BLOCKED
    assert evidence.failed_rule_ids == ("HTF_FLIP_COVERAGE_GAP",)


def test_flip_without_ordered_lifecycle_is_blocked() -> None:
    result = match_entry_candidates_v3(request(htf_flip_proof=flip(full_lifecycle_ordered=False)))

    candidate = only(result.candidates, model=EntryModelV3.HTF_FLIP)
    evidence = only(result.evidence, candidate_id=candidate.candidate_id)
    assert candidate.state is CandidateState.BLOCKED
    assert evidence.failed_rule_ids == ("HTF_FLIP_ORDER_UNPROVEN",)


def test_flip_contact_that_already_recrossed_cannot_nominate_later_trigger() -> None:
    result = match_entry_candidates_v3(request(htf_flip_proof=flip(contact_already_recrossed=True)))

    candidate = only(result.candidates, model=EntryModelV3.HTF_FLIP)
    evidence = only(result.evidence, candidate_id=candidate.candidate_id)
    assert candidate.state is CandidateState.BLOCKED
    assert evidence.failed_rule_ids == ("HTF_FLIP_CONTACT_ALREADY_RECROSSED",)


def test_directional_close_must_be_exactly_five_minutes() -> None:
    one_minute = OrderedCandle(
        open_epoch=1_800,
        close_epoch=1_860,
        open_ticks=105,
        high_ticks=110,
        low_ticks=100,
        close_ticks=109,
    )
    result = match_entry_candidates_v3(request(directional_close=True, confirmed_bar=one_minute))

    candidate = only(result.candidates, model=EntryModelV3.DIR_CLOSE)
    evidence = only(result.evidence, candidate_id=candidate.candidate_id)
    assert candidate.state is CandidateState.BLOCKED
    assert evidence.failed_rule_ids == ("DIR_CLOSE_NOT_CONFIRMED_5M",)
