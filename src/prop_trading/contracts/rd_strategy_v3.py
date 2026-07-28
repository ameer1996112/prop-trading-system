from __future__ import annotations

from datetime import date
from enum import StrEnum
from itertools import chain
from pathlib import Path
from typing import Literal, Self

from pydantic import Field, model_validator

from prop_trading.contracts.models import (
    ContractModel,
    Identifier,
    LocalDate,
    RuleFidelity,
    Sha256,
)


class ClaimRelationshipV3(StrEnum):
    SUPPORTS = "SUPPORTS"
    NARROWS = "NARROWS"
    SUPERSEDES = "SUPERSEDES"


class RDStrategySourceV3(ContractModel):
    youtube_video_id: Identifier
    published_date: LocalDate
    title_snapshot: str = Field(min_length=1, max_length=240)
    channel_id: Literal["UC54xbL96tU58iez3YbTVTAg"]
    channel_handle: Literal["@RD_Forex"]


class RDStrategySourceClaimV3(ContractModel):
    source_id: Identifier
    timestamp_start_seconds: int = Field(ge=0, le=86_400)
    timestamp_end_seconds: int = Field(gt=0, le=86_400)
    relationship: ClaimRelationshipV3
    target_claim_id: Identifier | None
    summary: str = Field(min_length=1, max_length=1_000)

    @model_validator(mode="after")
    def _range_and_target_are_consistent(self) -> Self:
        if self.timestamp_start_seconds >= self.timestamp_end_seconds:
            raise ValueError("claim timestamp range must increase")
        if (self.relationship is ClaimRelationshipV3.SUPPORTS) != (self.target_claim_id is None):
            raise ValueError("claim relationship target is inconsistent")
        return self


class RDEntryRuleV3(ContractModel):
    category: Literal["ZONE", "LIQUIDITY", "ENTRY", "TIMEFRAME"]
    fidelity: RuleFidelity
    automation: Literal["PAPER_EVALUATE", "SHADOW_ONLY", "DISABLED"]
    proof_eligibility: Literal["ORDERED_EXACT", "NOT_ELIGIBLE"]
    open_requirement: bool
    summary: str = Field(min_length=1, max_length=1_000)
    source_claim_ids: tuple[Identifier, ...] = Field(min_length=1, max_length=16)
    unresolved_terms: tuple[str, ...] = Field(default=(), max_length=24)

    @model_validator(mode="after")
    def _paper_eligibility_is_ordered_and_exact(self) -> Self:
        if self.automation == "PAPER_EVALUATE" and (
            self.fidelity is not RuleFidelity.EXACT or self.proof_eligibility != "ORDERED_EXACT"
        ):
            raise ValueError("paper evaluation requires ordered exact evidence")
        if self.automation in {"SHADOW_ONLY", "DISABLED"} and (
            self.proof_eligibility != "NOT_ELIGIBLE"
        ):
            raise ValueError("shadow-only and disabled rules must be marked not eligible")
        return self


class RDStrategyAutomationPolicyV3(ContractModel):
    paper_only: Literal[True]
    real_execution_allowed: Literal[False]
    first_touch_action: Literal["ZONE_ENGAGED"]
    required_selection_fidelity: Literal["EXACT"]
    required_common_setup_fidelity: Literal["EXACT"]
    arbitration_policy_version: Literal["rd-entry-arbitration-v3"]
    realtime_evidence_action: Literal["LIVE_EXACT_NON_REPLAYABLE"]
    active_entry_models: tuple[
        Literal["BOC"],
        Literal["DIR_CLOSE"],
        Literal["HTF_FLIP"],
    ]
    htf_context_minutes: tuple[Literal[15], Literal[30], Literal[60]]


REQUIRED_V3_RULE_IDS = frozenset(
    {
        "ZONE_FIRST_ENGAGEMENT",
        "ENTRY_BOC_HTF_TIMED",
        "ENTRY_BOC_DISCRETIONARY_5M",
        "ENTRY_DIR_CLOSE",
        "ENTRY_HTF_FLIP",
        "ENTRY_REJECTION_RESPECT_DISABLED",
    }
)
BASE_CONTRACT_SHA256 = "289cbf0bd1a59f3e3ca3ec12450f27bb326d210ec1e2444e17e7f90d10f17e28"
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
REQUIRED_V3_RULE_EVIDENCE_POLICIES = {
    "ZONE_FIRST_ENGAGEMENT": (RuleFidelity.EXACT, "SHADOW_ONLY", "NOT_ELIGIBLE"),
    "ENTRY_BOC_HTF_TIMED": (RuleFidelity.EXACT, "PAPER_EVALUATE", "ORDERED_EXACT"),
    "ENTRY_BOC_DISCRETIONARY_5M": (
        RuleFidelity.DISCRETIONARY,
        "SHADOW_ONLY",
        "NOT_ELIGIBLE",
    ),
    "ENTRY_DIR_CLOSE": (RuleFidelity.EXACT, "PAPER_EVALUATE", "ORDERED_EXACT"),
    "ENTRY_HTF_FLIP": (RuleFidelity.EXACT, "PAPER_EVALUATE", "ORDERED_EXACT"),
    "ENTRY_REJECTION_RESPECT_DISABLED": (RuleFidelity.EXACT, "DISABLED", "NOT_ELIGIBLE"),
}
REQUIRED_V3_RULE_SOURCE_CLAIM_IDS = {
    "ZONE_FIRST_ENGAGEMENT": ("zone-untapped-2024-03",),
    "ENTRY_BOC_HTF_TIMED": (
        "discretionary-break-2025-11",
        "reject-non-htf-break-2026-05",
        "htf-timed-boc-2026-06",
    ),
    "ENTRY_BOC_DISCRETIONARY_5M": ("discretionary-break-2025-11",),
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
    "ENTRY_REJECTION_RESPECT_DISABLED": (
        "closure-or-flip-2025-03",
        "directional-close-2025-08",
        "directional-close-required-2026-06",
    ),
}


class RDStrategyRuleContractV3(ContractModel):
    schema_id: Literal["phase0.rd-strategy-rule-contract.v3"]
    contract_id: Literal["rd-5m-video-contract-v3"]
    contract_version: Literal["3.0.0"]
    producer_strategy_version: Literal["3.0.0-contract3"]
    strategy_id: Literal["rd_liquidity_sd_5m_v1"]
    confirmed_timeframe_minutes: Literal[5]
    base_contract_sha256: Sha256
    inherited_rule_ids: tuple[Identifier, ...] = Field(min_length=1, max_length=32)
    sources_by_id: dict[Identifier, RDStrategySourceV3] = Field(min_length=1, max_length=32)
    claims_by_id: dict[Identifier, RDStrategySourceClaimV3] = Field(
        min_length=1,
        max_length=128,
    )
    rules_by_id: dict[Identifier, RDEntryRuleV3] = Field(min_length=1, max_length=64)
    automation_policy: RDStrategyAutomationPolicyV3

    @model_validator(mode="after")
    def _closed_v3_contract(self) -> Self:
        if self.base_contract_sha256 != BASE_CONTRACT_SHA256:
            raise ValueError("base contract sha256 digest is not the frozen contract")
        if len(self.inherited_rule_ids) != len(set(self.inherited_rule_ids)):
            raise ValueError("inherited qualification rule IDs contain duplicates")
        if set(self.inherited_rule_ids) != REQUIRED_INHERITED_RULE_IDS:
            raise ValueError("inherited qualification rule set is not exact")
        if set(self.rules_by_id) != REQUIRED_V3_RULE_IDS:
            raise ValueError("v3 entry rule set is not exact")
        if {
            rule_id: (rule.fidelity, rule.automation, rule.proof_eligibility)
            for rule_id, rule in self.rules_by_id.items()
        } != REQUIRED_V3_RULE_EVIDENCE_POLICIES:
            raise ValueError("v3 rule evidence policy is not exact")
        if {
            rule_id: rule.source_claim_ids for rule_id, rule in self.rules_by_id.items()
        } != REQUIRED_V3_RULE_SOURCE_CLAIM_IDS:
            raise ValueError("v3 rule source claims are not exact")
        if self.automation_policy.active_entry_models != (
            "BOC",
            "DIR_CLOSE",
            "HTF_FLIP",
        ):
            raise ValueError("v3 active entry model order is not exact")
        if self.rules_by_id["ENTRY_BOC_DISCRETIONARY_5M"].automation != "SHADOW_ONLY":
            raise ValueError("discretionary 5m BOC must remain shadow-only")
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
            if claim.target_claim_id is not None:
                target = self.claims_by_id.get(claim.target_claim_id)
                if target is None:
                    raise ValueError(f"claim target is unknown: {claim_id}")
                if date.fromisoformat(
                    self.sources_by_id[claim.source_id].published_date
                ) <= date.fromisoformat(self.sources_by_id[target.source_id].published_date):
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


def load_rd_strategy_contract_v3() -> RDStrategyRuleContractV3:
    contract_path = Path("config/phase0/rd-strategy-rule-contract-v3.json")
    return RDStrategyRuleContractV3.model_validate_json(contract_path.read_bytes())
