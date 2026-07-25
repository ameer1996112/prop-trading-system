from __future__ import annotations

from datetime import date
from enum import StrEnum
from itertools import chain
from typing import Literal

from pydantic import Field, model_validator

from prop_trading.contracts.models import (
    ContractModel,
    Identifier,
    LocalDate,
    RuleFidelity,
    Sha256,
)


class ClaimRelationship(StrEnum):
    SUPPORTS = "SUPPORTS"
    NARROWS = "NARROWS"
    SUPERSEDES = "SUPERSEDES"


class RDStrategySourceV2(ContractModel):
    youtube_video_id: Identifier
    published_date: LocalDate
    title_snapshot: str = Field(min_length=1, max_length=240)
    channel_id: Literal["UC54xbL96tU58iez3YbTVTAg"]
    channel_handle: Literal["@RD_Forex"]


class RDStrategySourceClaimV2(ContractModel):
    source_id: Identifier
    timestamp_start_seconds: int = Field(ge=0, le=86_400)
    timestamp_end_seconds: int = Field(gt=0, le=86_400)
    relationship: ClaimRelationship
    target_claim_id: Identifier | None
    summary: str = Field(min_length=1, max_length=1_000)

    @model_validator(mode="after")
    def _range_and_target_are_consistent(self) -> RDStrategySourceClaimV2:
        if self.timestamp_start_seconds >= self.timestamp_end_seconds:
            raise ValueError("claim timestamp range must increase")
        if (self.relationship is ClaimRelationship.SUPPORTS) != (self.target_claim_id is None):
            raise ValueError("claim relationship target is inconsistent")
        return self


class RDEntryRuleV2(ContractModel):
    category: Literal["ZONE", "LIQUIDITY", "ENTRY", "TIMEFRAME"]
    fidelity: RuleFidelity
    automation: Literal["PAPER_EVALUATE", "SHADOW_ONLY", "DISABLED"]
    proof_eligibility: Literal["COMPLETE_REPLAYABLE_EXACT", "NOT_ELIGIBLE"]
    open_requirement: bool
    summary: str = Field(min_length=1, max_length=1_000)
    source_claim_ids: tuple[Identifier, ...] = Field(min_length=1, max_length=16)
    unresolved_terms: tuple[str, ...] = Field(default=(), max_length=24)

    @model_validator(mode="after")
    def _paper_eligibility_is_proven(self) -> RDEntryRuleV2:
        if self.automation == "PAPER_EVALUATE" and (
            self.fidelity is not RuleFidelity.EXACT
            or self.proof_eligibility != "COMPLETE_REPLAYABLE_EXACT"
        ):
            raise ValueError("paper evaluation requires complete replayable exact evidence")
        if self.automation in {"SHADOW_ONLY", "DISABLED"} and (
            self.proof_eligibility != "NOT_ELIGIBLE"
        ):
            raise ValueError("shadow-only and disabled rules must be marked not eligible")
        return self


class RDStrategyAutomationPolicyV2(ContractModel):
    paper_only: Literal[True]
    real_execution_allowed: Literal[False]
    first_touch_action: Literal["ZONE_ENGAGED"]
    required_selection_fidelity: Literal["EXACT"]
    arbitration_policy_version: Literal["rd-entry-arbitration-v2"]
    current_producer_common_setup_fidelity: Literal["UNRESOLVED"]
    current_producer_promotion_eligible: Literal[False]
    realtime_evidence_action: Literal["SHADOW_ONLY"]
    paper_eligibility_requirement: Literal["COMPLETE_REPLAYABLE_EXACT"]
    active_entry_models: tuple[Literal["DIR_CLOSE"], Literal["HTF_FLIP"]]
    legacy_entry_models: tuple[
        Literal["LEGACY_BREAK_CANDLE"],
        Literal["LEGACY_REJECTION_RESPECT"],
    ]
    htf_context_minutes: tuple[Literal[15], Literal[30], Literal[60]]
    selection_actions: tuple[
        Literal["OBSERVE"],
        Literal["PAPER_ELIGIBLE"],
        Literal["SHADOW_ONLY"],
        Literal["NONE"],
    ]


REQUIRED_INHERITED_RULE_IDS = frozenset(
    {
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
)
REQUIRED_V2_RULE_IDS = frozenset(
    {
        "ZONE_FIRST_ENGAGEMENT",
        "ENTRY_DIR_CLOSE",
        "ENTRY_HTF_FLIP",
        "ENTRY_HTF_BOUNDARY_CAUTION",
        "ENTRY_BREAK_CANDLE_NORMALIZATION",
        "ENTRY_REJECTION_RESPECT_DISABLED",
        "ENTRY_NEXT_CANDLE_WICK_HANDLING",
    }
)
REQUIRED_V2_RULE_EVIDENCE_POLICIES = {
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
BASE_CONTRACT_SHA256 = "289cbf0bd1a59f3e3ca3ec12450f27bb326d210ec1e2444e17e7f90d10f17e28"


class RDStrategyRuleContractV2(ContractModel):
    schema_id: Literal["phase0.rd-strategy-rule-contract.v2"]
    contract_id: Identifier
    contract_version: Literal["2.0.0"]
    producer_strategy_version: Literal["2.0.0-contract2"]
    strategy_id: Literal["rd_liquidity_sd_5m_v1"]
    confirmed_timeframe_minutes: Literal[5]
    base_contract_sha256: Sha256
    inherited_rule_ids: tuple[Identifier, ...] = Field(min_length=1, max_length=32)
    sources_by_id: dict[Identifier, RDStrategySourceV2] = Field(min_length=1, max_length=32)
    claims_by_id: dict[Identifier, RDStrategySourceClaimV2] = Field(
        min_length=1,
        max_length=128,
    )
    rules_by_id: dict[Identifier, RDEntryRuleV2] = Field(min_length=1, max_length=64)
    automation_policy: RDStrategyAutomationPolicyV2

    @model_validator(mode="after")
    def _references_are_closed_and_chronological(self) -> RDStrategyRuleContractV2:
        if self.base_contract_sha256 != BASE_CONTRACT_SHA256:
            raise ValueError("base contract sha256 digest is not the frozen contract")
        if len(self.inherited_rule_ids) != len(set(self.inherited_rule_ids)):
            raise ValueError("inherited qualification rule IDs contain duplicates")
        if set(self.inherited_rule_ids) != REQUIRED_INHERITED_RULE_IDS:
            raise ValueError("inherited qualification rule set is not exact")
        if set(self.rules_by_id) != REQUIRED_V2_RULE_IDS:
            raise ValueError("v2 entry rule set is not exact")
        if {
            rule_id: (rule.fidelity, rule.automation, rule.proof_eligibility)
            for rule_id, rule in self.rules_by_id.items()
        } != REQUIRED_V2_RULE_EVIDENCE_POLICIES:
            raise ValueError("paper-eligible rule set is not exact")
        if REQUIRED_INHERITED_RULE_IDS & REQUIRED_V2_RULE_IDS:
            raise ValueError("inherited and v2 rule sets overlap")
        video_ids = [source.youtube_video_id for source in self.sources_by_id.values()]
        if len(video_ids) != len(set(video_ids)):
            raise ValueError("strategy source videos must be unique")
        if any(
            source.youtube_video_id in {"LCydpj3CaHo", "rO5els-o3Oo"}
            for source in self.sources_by_id.values()
        ):
            raise ValueError("third-party strategy source is prohibited")
        if any(
            date.fromisoformat(source.published_date) < date(2024, 3, 1)
            for source in self.sources_by_id.values()
        ):
            raise ValueError("strategy source predates approved review range")
        for claim_id, claim in self.claims_by_id.items():
            if claim.source_id not in self.sources_by_id:
                raise ValueError(f"claim source is unknown: {claim_id}")
            target_id = claim.target_claim_id
            if target_id is not None:
                target = self.claims_by_id.get(target_id)
                if target is None:
                    raise ValueError(f"claim target is unknown: {claim_id}")
                source_date = date.fromisoformat(self.sources_by_id[claim.source_id].published_date)
                target_date = date.fromisoformat(
                    self.sources_by_id[target.source_id].published_date
                )
                if source_date <= target_date:
                    raise ValueError(f"claim target is not older: {claim_id}")
        known_claims = set(self.claims_by_id)
        for rule_id, rule in self.rules_by_id.items():
            if len(rule.source_claim_ids) != len(set(rule.source_claim_ids)):
                raise ValueError(f"entry rule repeats a source claim: {rule_id}")
        referenced_claims = set(
            chain.from_iterable(rule.source_claim_ids for rule in self.rules_by_id.values())
        )
        if not referenced_claims.issubset(known_claims):
            raise ValueError("entry rule references an unknown claim")
        if known_claims != referenced_claims:
            raise ValueError("orphan source claim")
        return self
