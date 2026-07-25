import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from prop_trading.contracts.models import RuleFidelity
from prop_trading.contracts.rd_strategy_v2 import (
    ClaimRelationship,
    RDEntryRuleV2,
    RDStrategyRuleContractV2,
)

CONTRACT = Path("config/phase0/rd-strategy-rule-contract-v2.json")
OFFICIAL_CHANNEL = "UC54xbL96tU58iez3YbTVTAg"
PROHIBITED_VIDEOS = {"LCydpj3CaHo", "rO5els-o3Oo"}


def payload() -> dict[str, object]:
    loaded: object = json.loads(CONTRACT.read_text(encoding="utf-8"))
    assert isinstance(loaded, dict)
    return loaded


def test_v2_policy_is_closed_and_paper_only() -> None:
    contract = RDStrategyRuleContractV2.model_validate_json(CONTRACT.read_bytes())
    assert contract.contract_version == "2.0.0"
    assert contract.producer_strategy_version == "2.0.0-contract2"
    assert contract.base_contract_sha256 == (
        "289cbf0bd1a59f3e3ca3ec12450f27bb326d210ec1e2444e17e7f90d10f17e28"
    )
    assert contract.automation_policy.paper_only is True
    assert contract.automation_policy.real_execution_allowed is False
    assert contract.automation_policy.active_entry_models == (
        "DIR_CLOSE",
        "HTF_FLIP",
    )
    assert contract.automation_policy.legacy_entry_models == (
        "LEGACY_BREAK_CANDLE",
        "LEGACY_REJECTION_RESPECT",
    )
    assert contract.automation_policy.htf_context_minutes == (15, 30, 60)
    assert (
        contract.automation_policy.arbitration_policy_version
        == "rd-entry-arbitration-v2"
    )


def test_v2_sources_are_official_and_exclude_third_parties() -> None:
    contract = RDStrategyRuleContractV2.model_validate_json(CONTRACT.read_bytes())
    assert all(source.channel_id == OFFICIAL_CHANNEL for source in contract.sources_by_id.values())
    assert all(source.channel_handle == "@RD_Forex" for source in contract.sources_by_id.values())
    assert PROHIBITED_VIDEOS.isdisjoint(
        source.youtube_video_id for source in contract.sources_by_id.values()
    )


def test_narrowing_must_target_an_older_known_claim() -> None:
    value = payload()
    claims = value["claims_by_id"]
    assert isinstance(claims, dict)
    claim = claims["break-normalized-to-flip-2026-06"]
    assert isinstance(claim, dict)
    claim["target_claim_id"] = "missing-claim"
    with pytest.raises(ValidationError, match="target"):
        RDStrategyRuleContractV2.model_validate(value)


def valid_contract_payload() -> dict[str, object]:
    inherited_rule_ids = (
        "TIMEFRAME_FIVE_MINUTE_ONLY",
        "ZONE_ORIGIN_OPPOSITE_CANDLE",
        "ZONE_ACCURACY_BOUNDS",
        "ZONE_FRESH_UNTAPPED",
        "ZONE_PRE_ENTRY_CLOSE_OUTSIDE",
        "LIQ_NORMAL_TWO_OPPOSITE_CANDLES",
        "LIQ_ONE_CANDLE_EXCEPTION",
        "LIQ_OWN_EXTREME_SAME_LEG",
        "LIQ_STRICT_OWN_EXTREME_BREAK",
        "LIQ_ACTUAL_EXTREME_SWEPT",
        "LIQ_EVENT_ORDER",
        "LIQ_INTERNAL_REBREAK",
        "LIQ_DISTANCE_INFLUENCES_ZONE",
        "LIQ_REPLACEMENT_AFTER_STALE_MOVE",
    )
    rule_ids = (
        "ZONE_FIRST_ENGAGEMENT",
        "ENTRY_DIR_CLOSE",
        "ENTRY_HTF_FLIP",
        "ENTRY_HTF_BOUNDARY_CAUTION",
        "ENTRY_BREAK_CANDLE_NORMALIZATION",
        "ENTRY_REJECTION_RESPECT_DISABLED",
        "ENTRY_NEXT_CANDLE_WICK_HANDLING",
    )
    claim_ids = tuple(f"claim-{index}" for index in range(len(rule_ids)))
    claims: dict[str, object] = {
        claim_ids[0]: {
            "source_id": "official-old",
            "timestamp_start_seconds": 0,
            "timestamp_end_seconds": 1,
            "relationship": ClaimRelationship.SUPPORTS,
            "target_claim_id": None,
            "summary": "older source claim",
        },
        claim_ids[1]: {
            "source_id": "official-current",
            "timestamp_start_seconds": 1,
            "timestamp_end_seconds": 2,
            "relationship": ClaimRelationship.NARROWS,
            "target_claim_id": claim_ids[0],
            "summary": "newer narrowing claim",
        },
    }
    claims.update(
        {
            claim_id: {
                "source_id": "official-current",
                "timestamp_start_seconds": index,
                "timestamp_end_seconds": index + 1,
                "relationship": ClaimRelationship.SUPPORTS,
                "target_claim_id": None,
                "summary": f"claim {index}",
            }
            for index, claim_id in enumerate(claim_ids[2:], start=2)
        }
    )
    rules = {
        rule_id: {
            "category": "ENTRY",
            "fidelity": RuleFidelity.EXACT,
            "automation": "PAPER_EVALUATE",
            "proof_eligibility": "COMPLETE_REPLAYABLE_EXACT",
            "open_requirement": True,
            "summary": f"rule {index}",
            "source_claim_ids": (claim_ids[index],),
        }
        for index, rule_id in enumerate(rule_ids)
    }
    return {
        "schema_id": "phase0.rd-strategy-rule-contract.v2",
        "contract_id": "rd-contract-v2",
        "contract_version": "2.0.0",
        "producer_strategy_version": "2.0.0-contract2",
        "strategy_id": "rd_liquidity_sd_5m_v1",
        "confirmed_timeframe_minutes": 5,
        "base_contract_sha256": "289cbf0bd1a59f3e3ca3ec12450f27bb326d210ec1e2444e17e7f90d10f17e28",
        "inherited_rule_ids": inherited_rule_ids,
        "sources_by_id": {
            "official-old": {
                "youtube_video_id": "official-old-video",
                "published_date": "2024-03-01",
                "title_snapshot": "Official old",
                "channel_id": OFFICIAL_CHANNEL,
                "channel_handle": "@RD_Forex",
            },
            "official-current": {
                "youtube_video_id": "official-current-video",
                "published_date": "2024-04-01",
                "title_snapshot": "Official current",
                "channel_id": OFFICIAL_CHANNEL,
                "channel_handle": "@RD_Forex",
            },
        },
        "claims_by_id": claims,
        "rules_by_id": rules,
        "automation_policy": {
            "paper_only": True,
            "real_execution_allowed": False,
            "first_touch_action": "ZONE_ENGAGED",
            "required_selection_fidelity": "EXACT",
            "arbitration_policy_version": "rd-entry-arbitration-v2",
            "current_producer_common_setup_fidelity": "UNRESOLVED",
            "current_producer_promotion_eligible": False,
            "realtime_evidence_action": "SHADOW_ONLY",
            "paper_eligibility_requirement": "COMPLETE_REPLAYABLE_EXACT",
            "active_entry_models": ("DIR_CLOSE", "HTF_FLIP"),
            "legacy_entry_models": (
                "LEGACY_BREAK_CANDLE",
                "LEGACY_REJECTION_RESPECT",
            ),
            "htf_context_minutes": (15, 30, 60),
            "selection_actions": (
                "OBSERVE",
                "PAPER_ELIGIBLE",
                "SHADOW_ONLY",
                "NONE",
            ),
        },
    }


@pytest.mark.parametrize(
    ("fidelity", "automation", "proof_eligibility", "message"),
    [
        ("CALIBRATED", "PAPER_EVALUATE", "COMPLETE_REPLAYABLE_EXACT", "paper evaluation"),
        ("EXACT", "PAPER_EVALUATE", "NOT_ELIGIBLE", "paper evaluation"),
        ("EXACT", "SHADOW_ONLY", "COMPLETE_REPLAYABLE_EXACT", "not eligible"),
        ("EXACT", "DISABLED", "COMPLETE_REPLAYABLE_EXACT", "not eligible"),
    ],
)
def test_rule_proof_eligibility_fails_closed(
    fidelity: str, automation: str, proof_eligibility: str, message: str
) -> None:
    with pytest.raises(ValidationError, match=message):
        RDEntryRuleV2.model_validate(
            {
                "category": "ENTRY",
                "fidelity": RuleFidelity(fidelity),
                "automation": automation,
                "proof_eligibility": proof_eligibility,
                "open_requirement": True,
                "summary": "test rule",
                "source_claim_ids": ("claim-0",),
            }
        )


def test_complete_replayable_exact_evidence_is_the_only_paper_eligible_shape() -> None:
    contract = RDStrategyRuleContractV2.model_validate(valid_contract_payload())
    assert contract.automation_policy.current_producer_common_setup_fidelity == "UNRESOLVED"
    assert contract.automation_policy.current_producer_promotion_eligible is False
    assert contract.automation_policy.realtime_evidence_action == "SHADOW_ONLY"
    assert (
        contract.automation_policy.paper_eligibility_requirement
        == "COMPLETE_REPLAYABLE_EXACT"
    )


@pytest.mark.parametrize(
    ("mutate", "message"),
    [
        (
            lambda value: value["claims_by_id"]["claim-1"].update(
                {"source_id": "official-old"}
            ),
            "not older",
        ),
        (
            lambda value: value.update(
                {"inherited_rule_ids": value["inherited_rule_ids"][:-1]}
            ),
            "inherited qualification rule set is not exact",
        ),
        (
            lambda value: value["rules_by_id"].pop("ENTRY_HTF_FLIP"),
            "v2 entry rule set is not exact",
        ),
        (
            lambda value: value["sources_by_id"]["official-old"].update(
                {"youtube_video_id": "LCydpj3CaHo"}
            ),
            "prohibited",
        ),
        (
            lambda value: value["sources_by_id"]["official-old"].update(
                {"youtube_video_id": "official-current-video"}
            ),
            "unique",
        ),
        (
            lambda value: value["rules_by_id"]["ENTRY_DIR_CLOSE"].update(
                {"source_claim_ids": ("claim-1", "claim-1")}
            ),
            "repeats",
        ),
        (
            lambda value: value["rules_by_id"]["ZONE_FIRST_ENGAGEMENT"].update(
                {"source_claim_ids": ("claim-1",)}
            ),
            "orphan",
        ),
        (
            lambda value: value["automation_policy"].update(
                {"current_producer_common_setup_fidelity": "EXACT"}
            ),
            "UNRESOLVED",
        ),
        (
            lambda value: value["automation_policy"].update(
                {"current_producer_promotion_eligible": True}
            ),
            "False",
        ),
        (
            lambda value: value["automation_policy"].update(
                {"realtime_evidence_action": "PAPER_EVALUATE"}
            ),
            "SHADOW_ONLY",
        ),
        (
            lambda value: value["automation_policy"].update(
                {"paper_eligibility_requirement": "NOT_ELIGIBLE"}
            ),
            "COMPLETE_REPLAYABLE_EXACT",
        ),
    ],
)
def test_contract_closure_invariants_fail_closed(mutate: object, message: str) -> None:
    value = valid_contract_payload()
    assert callable(mutate)
    mutate(value)
    with pytest.raises(ValidationError, match=message):
        RDStrategyRuleContractV2.model_validate(value)
