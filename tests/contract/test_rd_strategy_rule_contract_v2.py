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

EXPECTED_SOURCES = {
    "rd-course-2024-03": ("kxh_3__oAqg", "2024-03-25"),
    "rd-5m-optimized-2025-03": ("84LZqvMiyos", "2025-03-15"),
    "rd-first-5m-live-2025-03": ("Gr0njSOtC10", "2025-03-20"),
    "rd-5m-howto-2025-05": ("f3X9T69y24c", "2025-05-20"),
    "rd-full-guide-2025-08": ("E5EBc1MtiXQ", "2025-08-17"),
    "rd-strategy-week-2025-11": ("UqYlKtPjKvY", "2025-11-20"),
    "rd-live-nc-2026-05": ("lo_7HDQK9WM", "2026-05-21"),
    "rd-live-5m-2026-06": ("zglv2r9xXnE", "2026-06-11"),
    "rd-futures-backtest-2026-07": ("T86aLDxzlbM", "2026-07-15"),
}

EXPECTED_TITLES = {
    "rd-course-2024-03": (
        "FULL course for LIQUIDITY supply and demand best NEW trading strategy 2026"
    ),
    "rd-5m-optimized-2025-03": "I Optimized The 5m Timeframe To Make it OP - RD Concepts",
    "rd-first-5m-live-2025-03": "First 5m livestream (1 win 1 loss) 1:2.5r trade on gj",
    "rd-5m-howto-2025-05": "How To Trade The 5m Timeframe (it's not the same)",
    "rd-full-guide-2025-08": "The Trading Strategy That Changed My Life - RD Concepts Full Guide",
    "rd-strategy-week-2025-11": (
        "The Strategy That Just Makes Sense - 6 Simple 1:4 Trades In 1 Week"
    ),
    "rd-live-nc-2026-05": "liquidity supply & demand live trading - 1:4 on NC",
    "rd-live-5m-2026-06": "Liquidity supply & demand live trading - 5m timeframe",
    "rd-futures-backtest-2026-07": "180% in 2 weeks - Full Futures Strategy Backtest Breakdown",
}

EXPECTED_CLAIMS = {
    "zone-untapped-2024-03",
    "standard-close-2024-03",
    "htf-flip-2024-03",
    "gold-break-exception-2025-03",
    "closure-or-flip-2025-03",
    "next-candle-wick-2025-05",
    "prompt-close-2025-05",
    "directional-close-2025-08",
    "htf-context-set-2025-08",
    "htf-flip-definition-2025-08",
    "htf-boundary-caution-2025-08",
    "discretionary-break-2025-11",
    "close-fallback-2025-11",
    "pure-flip-narrowing-2026-05",
    "reject-non-htf-break-2026-05",
    "directional-close-required-2026-06",
    "break-normalized-to-flip-2026-06",
    "model-continuation-2026-07",
}

EXPECTED_CLAIM_FACTS = {
    "zone-untapped-2024-03": ("rd-course-2024-03", 223, 298, "SUPPORTS", None),
    "standard-close-2024-03": ("rd-course-2024-03", 794, 876, "SUPPORTS", None),
    "htf-flip-2024-03": ("rd-course-2024-03", 892, 1005, "SUPPORTS", None),
    "gold-break-exception-2025-03": (
        "rd-5m-optimized-2025-03",
        193,
        223,
        "SUPPORTS",
        None,
    ),
    "closure-or-flip-2025-03": (
        "rd-first-5m-live-2025-03",
        3106,
        3149,
        "NARROWS",
        "standard-close-2024-03",
    ),
    "next-candle-wick-2025-05": ("rd-5m-howto-2025-05", 40, 97, "SUPPORTS", None),
    "prompt-close-2025-05": ("rd-5m-howto-2025-05", 211, 223, "SUPPORTS", None),
    "directional-close-2025-08": (
        "rd-full-guide-2025-08",
        999,
        1094,
        "NARROWS",
        "closure-or-flip-2025-03",
    ),
    "htf-context-set-2025-08": (
        "rd-full-guide-2025-08",
        1189,
        1198,
        "NARROWS",
        "htf-flip-2024-03",
    ),
    "htf-flip-definition-2025-08": (
        "rd-full-guide-2025-08",
        1270,
        1345,
        "NARROWS",
        "htf-flip-2024-03",
    ),
    "htf-boundary-caution-2025-08": (
        "rd-full-guide-2025-08",
        1906,
        2088,
        "SUPPORTS",
        None,
    ),
    "discretionary-break-2025-11": (
        "rd-strategy-week-2025-11",
        144,
        229,
        "SUPPORTS",
        None,
    ),
    "close-fallback-2025-11": (
        "rd-strategy-week-2025-11",
        362,
        430,
        "SUPPORTS",
        None,
    ),
    "pure-flip-narrowing-2026-05": (
        "rd-live-nc-2026-05",
        3647,
        3984,
        "NARROWS",
        "htf-flip-definition-2025-08",
    ),
    "reject-non-htf-break-2026-05": (
        "rd-live-nc-2026-05",
        4388,
        4395,
        "SUPERSEDES",
        "gold-break-exception-2025-03",
    ),
    "directional-close-required-2026-06": (
        "rd-live-5m-2026-06",
        655,
        665,
        "NARROWS",
        "directional-close-2025-08",
    ),
    "break-normalized-to-flip-2026-06": (
        "rd-live-5m-2026-06",
        679,
        694,
        "SUPERSEDES",
        "discretionary-break-2025-11",
    ),
    "model-continuation-2026-07": (
        "rd-futures-backtest-2026-07",
        247,
        2550,
        "SUPPORTS",
        None,
    ),
}

EXPECTED_INHERITED_RULE_IDS = {
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
}

EXPECTED_RULE_CLAIMS = {
    "ZONE_FIRST_ENGAGEMENT": ("zone-untapped-2024-03",),
    "ENTRY_DIR_CLOSE": (
        "standard-close-2024-03",
        "closure-or-flip-2025-03",
        "directional-close-2025-08",
        "directional-close-required-2026-06",
        "model-continuation-2026-07",
    ),
    "ENTRY_HTF_FLIP": (
        "htf-flip-2024-03",
        "htf-context-set-2025-08",
        "htf-flip-definition-2025-08",
        "pure-flip-narrowing-2026-05",
        "model-continuation-2026-07",
    ),
    "ENTRY_HTF_BOUNDARY_CAUTION": ("htf-boundary-caution-2025-08",),
    "ENTRY_BREAK_CANDLE_NORMALIZATION": (
        "gold-break-exception-2025-03",
        "discretionary-break-2025-11",
        "reject-non-htf-break-2026-05",
        "break-normalized-to-flip-2026-06",
    ),
    "ENTRY_REJECTION_RESPECT_DISABLED": (
        "closure-or-flip-2025-03",
        "directional-close-2025-08",
        "directional-close-required-2026-06",
    ),
    "ENTRY_NEXT_CANDLE_WICK_HANDLING": (
        "next-candle-wick-2025-05",
        "prompt-close-2025-05",
        "close-fallback-2025-11",
    ),
}


def payload() -> dict[str, object]:
    return RDStrategyRuleContractV2.model_validate_json(CONTRACT.read_bytes()).model_dump(
        mode="python"
    )


def test_official_inventory_and_claim_ids_are_frozen() -> None:
    contract = RDStrategyRuleContractV2.model_validate_json(CONTRACT.read_bytes())
    assert {
        source_id: (source.youtube_video_id, source.published_date)
        for source_id, source in contract.sources_by_id.items()
    } == EXPECTED_SOURCES
    assert {
        source_id: source.title_snapshot for source_id, source in contract.sources_by_id.items()
    } == EXPECTED_TITLES
    assert set(contract.claims_by_id) == EXPECTED_CLAIMS
    assert {
        claim_id: (
            claim.source_id,
            claim.timestamp_start_seconds,
            claim.timestamp_end_seconds,
            claim.relationship.value,
            claim.target_claim_id,
        )
        for claim_id, claim in contract.claims_by_id.items()
    } == EXPECTED_CLAIM_FACTS
    assert set(contract.inherited_rule_ids) == EXPECTED_INHERITED_RULE_IDS
    assert {
        rule_id: rule.source_claim_ids for rule_id, rule in contract.rules_by_id.items()
    } == EXPECTED_RULE_CLAIMS
    assert {
        claim_id for claim_ids in EXPECTED_RULE_CLAIMS.values() for claim_id in claim_ids
    } == EXPECTED_CLAIMS


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
    assert contract.automation_policy.arbitration_policy_version == "rd-entry-arbitration-v2"


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


def test_non_active_rule_cannot_be_relabelled_paper_eligible() -> None:
    value = payload()
    rules = value["rules_by_id"]
    assert isinstance(rules, dict)
    zone_first_engagement = rules["ZONE_FIRST_ENGAGEMENT"]
    assert isinstance(zone_first_engagement, dict)
    zone_first_engagement.update(
        {
            "fidelity": RuleFidelity.EXACT,
            "automation": "PAPER_EVALUATE",
            "proof_eligibility": "COMPLETE_REPLAYABLE_EXACT",
        }
    )
    with pytest.raises(ValidationError, match="paper-eligible rule set is not exact"):
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
    rule_policies = {
        "ZONE_FIRST_ENGAGEMENT": (RuleFidelity.EXACT, "SHADOW_ONLY", "NOT_ELIGIBLE"),
        "ENTRY_DIR_CLOSE": (
            RuleFidelity.EXACT,
            "PAPER_EVALUATE",
            "COMPLETE_REPLAYABLE_EXACT",
        ),
        "ENTRY_HTF_FLIP": (
            RuleFidelity.EXACT,
            "PAPER_EVALUATE",
            "COMPLETE_REPLAYABLE_EXACT",
        ),
        "ENTRY_HTF_BOUNDARY_CAUTION": (
            RuleFidelity.DISCRETIONARY,
            "SHADOW_ONLY",
            "NOT_ELIGIBLE",
        ),
        "ENTRY_BREAK_CANDLE_NORMALIZATION": (
            RuleFidelity.EXACT,
            "DISABLED",
            "NOT_ELIGIBLE",
        ),
        "ENTRY_REJECTION_RESPECT_DISABLED": (
            RuleFidelity.EXACT,
            "DISABLED",
            "NOT_ELIGIBLE",
        ),
        "ENTRY_NEXT_CANDLE_WICK_HANDLING": (
            RuleFidelity.DISCRETIONARY,
            "SHADOW_ONLY",
            "NOT_ELIGIBLE",
        ),
    }
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
            "fidelity": rule_policies[rule_id][0],
            "automation": rule_policies[rule_id][1],
            "proof_eligibility": rule_policies[rule_id][2],
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
    assert contract.automation_policy.paper_eligibility_requirement == "COMPLETE_REPLAYABLE_EXACT"


@pytest.mark.parametrize(
    ("mutate", "message"),
    [
        (
            lambda value: value["claims_by_id"]["claim-1"].update({"source_id": "official-old"}),
            "not older",
        ),
        (
            lambda value: value.update({"inherited_rule_ids": value["inherited_rule_ids"][:-1]}),
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
