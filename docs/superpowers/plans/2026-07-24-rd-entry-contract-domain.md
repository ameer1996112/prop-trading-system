# RD Entry Contract and Oracle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Freeze the official RD entry-source contract and build the pure Python multi-candidate matcher, evidence identity, arbitration policy, and cross-language oracle vectors.

**Architecture:** Version 1 contract and gate files remain untouched. A focused v2 contract module references only approved v1 qualification rules and adds claim-level official sources; separate domain modules own semantic identities, model matching, lower-timeframe proof, and arbitration. A manually reviewed fixture drives the Python oracle and generated vectors consumed by TypeScript and Pine parity.

**Tech Stack:** Python 3.12, Pydantic 2.11, pytest 8.4, Ruff, mypy, canonical JSON/SHA-256

## Global Constraints

- New contract version is exactly `2.0.0`.
- New producer strategy version is exactly `2.0.0-contract2`.
- Producer `2.0.0-contract2` cannot prove complete common-setup provenance and
  is structurally ineligible for promotion; its Pine view forces common
  fidelity to `UNRESOLVED`.
- Arbitration policy version is exactly `rd-entry-arbitration-v2`.
- Confirmed chart timeframe is exactly 5 minutes.
- Official creator is exactly channel `UC54xbL96tU58iez3YbTVTAg`, handle `@RD_Forex`.
- Active models are exactly `DIR_CLOSE` and `HTF_FLIP`.
- Legacy models are exactly `LEGACY_BREAK_CANDLE` and `LEGACY_REJECTION_RESPECT`.
- First touch is `ZONE_ENGAGED`, not an entry.
- Only complete replayable `EXACT` evidence is paper-eligible.
- Realtime-only evidence is always shadow-only.
- Real execution is exactly `false`; no execution action is defined.
- Every `setup_id` is attempt-scoped. `INITIAL` requires
  `trigger_ordinal=1`; `RE_ENTRY` requires its own setup ID and an ordinal
  greater than or equal to `2`. V3 Pine is INITIAL-only in this increment.
- Terminality ends trigger matching. The sole post-terminal exception is one
  immediately following confirmed-bar event used only to observe
  `NEXT_CANDLE_WICK` when the terminal event introduced `DIR_CLOSE` while
  completing both active models.
- Preserve `src/prop_trading/domain/rd_entry_gate.py`, its fixture, and all v1 tests unchanged.
- Use integer epochs and integer price ticks in all identity and matching logic.
- Hash only canonical dictionaries through `canonical_sha256()`.

---

### Task 1: Define the strict v2 source-claim contract

**Files:**
- Create: `src/prop_trading/contracts/rd_strategy_v2.py`
- Create: `src/prop_trading/contracts/schema_registry.py`
- Create: `tests/contract/test_rd_strategy_rule_contract_v2.py`
- Modify: `scripts/export_schemas.py:10`

**Interfaces:**
- Consumes: `ContractModel`, `Identifier`, `LocalDate`, `RuleFidelity`, and `Sha256` from `prop_trading.contracts.models`.
- Produces: `RDStrategyRuleContractV2` and `SCHEMA_MODELS` containing `rd-strategy-rule-contract-v2`.

- [ ] **Step 1: Write failing tests for closed policy and source invariants**

```python
import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from prop_trading.contracts.rd_strategy_v2 import RDStrategyRuleContractV2

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
```

- [ ] **Step 2: Run the contract test and verify it fails**

Run:

```bash
uv run pytest tests/contract/test_rd_strategy_rule_contract_v2.py -v
```

Expected: collection fails with `ModuleNotFoundError: prop_trading.contracts.rd_strategy_v2`.

- [ ] **Step 3: Implement the closed v2 model surface**

Create `rd_strategy_v2.py` with these exact public enums and fixed tuples:

```python
from __future__ import annotations

from datetime import date
from enum import StrEnum
from itertools import chain
from typing import Literal, Mapping

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
        if (self.relationship is ClaimRelationship.SUPPORTS) != (
            self.target_claim_id is None
        ):
            raise ValueError("claim relationship target is inconsistent")
        return self


class RDEntryRuleV2(ContractModel):
    category: Literal["ZONE", "LIQUIDITY", "ENTRY", "TIMEFRAME"]
    fidelity: RuleFidelity
    automation: Literal["PAPER_EVALUATE", "SHADOW_ONLY", "DISABLED"]
    open_requirement: bool
    summary: str = Field(min_length=1, max_length=1_000)
    source_claim_ids: tuple[Identifier, ...] = Field(min_length=1, max_length=16)
    unresolved_terms: tuple[str, ...] = Field(default=(), max_length=24)


class RDStrategyAutomationPolicyV2(ContractModel):
    paper_only: Literal[True]
    real_execution_allowed: Literal[False]
    first_touch_action: Literal["ZONE_ENGAGED"]
    required_selection_fidelity: Literal["EXACT"]
    arbitration_policy_version: Literal["rd-entry-arbitration-v2"]
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
        if set(self.inherited_rule_ids) != REQUIRED_INHERITED_RULE_IDS:
            raise ValueError("inherited qualification rule set is not exact")
        if set(self.rules_by_id) != REQUIRED_V2_RULE_IDS:
            raise ValueError("v2 entry rule set is not exact")
        if REQUIRED_INHERITED_RULE_IDS & REQUIRED_V2_RULE_IDS:
            raise ValueError("inherited and v2 rule sets overlap")
        video_ids = [
            source.youtube_video_id for source in self.sources_by_id.values()
        ]
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
                source_date = date.fromisoformat(
                    self.sources_by_id[claim.source_id].published_date
                )
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
```

Create `schema_registry.py`:

```python
from prop_trading.contracts.models import SCHEMA_MODELS as V1_SCHEMA_MODELS
from prop_trading.contracts.rd_strategy_v2 import RDStrategyRuleContractV2

SCHEMA_MODELS = {
    **V1_SCHEMA_MODELS,
    "rd-strategy-rule-contract-v2": RDStrategyRuleContractV2,
}
```

Change `scripts/export_schemas.py` to import `SCHEMA_MODELS` from
`prop_trading.contracts.schema_registry`.

- [ ] **Step 4: Run the test to reach the missing-config failure**

Run:

```bash
uv run pytest tests/contract/test_rd_strategy_rule_contract_v2.py -v
```

Expected: tests import successfully and fail because
`config/phase0/rd-strategy-rule-contract-v2.json` does not exist.

- [ ] **Step 5: Commit the contract type boundary**

```bash
git add src/prop_trading/contracts/rd_strategy_v2.py \
  src/prop_trading/contracts/schema_registry.py \
  scripts/export_schemas.py \
  tests/contract/test_rd_strategy_rule_contract_v2.py
git commit -m "test: define RD strategy contract v2 invariants"
```

---

### Task 2: Freeze official source claims and generate schema v2

**Files:**
- Create: `config/phase0/rd-strategy-rule-contract-v2.json`
- Create: `contracts/schema/rd-strategy-rule-contract-v2.schema.json`
- Create: `docs/rd-strategy-rule-contract-v2.md`
- Modify: `contracts/README.md`
- Test: `tests/contract/test_rd_strategy_rule_contract_v2.py`

**Interfaces:**
- Consumes: `RDStrategyRuleContractV2`.
- Produces: validated official claims and the generated JSON Schema consumed by the edge and Pine plans.

- [ ] **Step 1: Add the exact source and claim inventory assertion**

Add this expected mapping to the contract test:

```python
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
    "rd-5m-optimized-2025-03": (
        "I Optimized The 5m Timeframe To Make it OP - RD Concepts"
    ),
    "rd-first-5m-live-2025-03": (
        "First 5m livestream (1 win 1 loss) 1:2.5r trade on gj"
    ),
    "rd-5m-howto-2025-05": "How To Trade The 5m Timeframe (it's not the same)",
    "rd-full-guide-2025-08": (
        "The Trading Strategy That Changed My Life - RD Concepts Full Guide"
    ),
    "rd-strategy-week-2025-11": (
        "The Strategy That Just Makes Sense - 6 Simple 1:4 Trades In 1 Week"
    ),
    "rd-live-nc-2026-05": "liquidity supply & demand live trading - 1:4 on NC",
    "rd-live-5m-2026-06": (
        "Liquidity supply & demand live trading - 5m timeframe"
    ),
    "rd-futures-backtest-2026-07": (
        "180% in 2 weeks - Full Futures Strategy Backtest Breakdown"
    ),
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


def test_official_inventory_and_claim_ids_are_frozen() -> None:
    contract = RDStrategyRuleContractV2.model_validate_json(CONTRACT.read_bytes())
    assert {
        source_id: (source.youtube_video_id, source.published_date)
        for source_id, source in contract.sources_by_id.items()
    } == EXPECTED_SOURCES
    assert {
        source_id: source.title_snapshot
        for source_id, source in contract.sources_by_id.items()
    } == EXPECTED_TITLES
    assert set(contract.claims_by_id) == EXPECTED_CLAIMS
    assert set(contract.inherited_rule_ids) == EXPECTED_INHERITED_RULE_IDS
    assert {
        rule_id: rule.source_claim_ids
        for rule_id, rule in contract.rules_by_id.items()
    } == EXPECTED_RULE_CLAIMS
    assert {
        claim_id
        for claim_ids in EXPECTED_RULE_CLAIMS.values()
        for claim_id in claim_ids
    } == EXPECTED_CLAIMS
```

- [ ] **Step 2: Run the inventory test and verify it fails**

Run:

```bash
uv run pytest tests/contract/test_rd_strategy_rule_contract_v2.py -v
```

Expected: fail because the v2 JSON file is absent.

- [ ] **Step 3: Create the v2 contract instance**

Use base contract SHA-256
`289cbf0bd1a59f3e3ca3ec12450f27bb326d210ec1e2444e17e7f90d10f17e28`.
Populate each source with the exact channel ID/handle and each claim with these
timestamp ranges and relationships:

```python
CLAIM_FACTS = {
    "zone-untapped-2024-03": ("rd-course-2024-03", 223, 298, "SUPPORTS", None),
    "standard-close-2024-03": ("rd-course-2024-03", 794, 876, "SUPPORTS", None),
    "htf-flip-2024-03": ("rd-course-2024-03", 892, 1005, "SUPPORTS", None),
    "gold-break-exception-2025-03": (
        "rd-5m-optimized-2025-03", 193, 223, "SUPPORTS", None
    ),
    "closure-or-flip-2025-03": (
        "rd-first-5m-live-2025-03", 3106, 3149, "NARROWS", "standard-close-2024-03"
    ),
    "next-candle-wick-2025-05": (
        "rd-5m-howto-2025-05", 40, 97, "SUPPORTS", None
    ),
    "prompt-close-2025-05": ("rd-5m-howto-2025-05", 211, 223, "SUPPORTS", None),
    "directional-close-2025-08": (
        "rd-full-guide-2025-08", 999, 1094, "NARROWS", "closure-or-flip-2025-03"
    ),
    "htf-context-set-2025-08": (
        "rd-full-guide-2025-08", 1189, 1198, "NARROWS", "htf-flip-2024-03"
    ),
    "htf-flip-definition-2025-08": (
        "rd-full-guide-2025-08", 1270, 1345, "NARROWS", "htf-flip-2024-03"
    ),
    "htf-boundary-caution-2025-08": (
        "rd-full-guide-2025-08", 1906, 2088, "SUPPORTS", None
    ),
    "discretionary-break-2025-11": (
        "rd-strategy-week-2025-11", 144, 229, "SUPPORTS", None
    ),
    "close-fallback-2025-11": (
        "rd-strategy-week-2025-11", 362, 430, "SUPPORTS", None
    ),
    "pure-flip-narrowing-2026-05": (
        "rd-live-nc-2026-05", 3647, 3984, "NARROWS", "htf-flip-definition-2025-08"
    ),
    "reject-non-htf-break-2026-05": (
        "rd-live-nc-2026-05", 4388, 4395, "SUPERSEDES", "gold-break-exception-2025-03"
    ),
    "directional-close-required-2026-06": (
        "rd-live-5m-2026-06", 655, 665, "NARROWS", "directional-close-2025-08"
    ),
    "break-normalized-to-flip-2026-06": (
        "rd-live-5m-2026-06", 679, 694, "SUPERSEDES", "discretionary-break-2025-11"
    ),
    "model-continuation-2026-07": (
        "rd-futures-backtest-2026-07", 247, 2550, "SUPPORTS", None
    ),
}
```

Use these exact v2 rule-to-claim references:

```python
RULE_CLAIMS = {
    "ZONE_FIRST_ENGAGEMENT": ["zone-untapped-2024-03"],
    "ENTRY_DIR_CLOSE": [
        "standard-close-2024-03",
        "closure-or-flip-2025-03",
        "directional-close-2025-08",
        "directional-close-required-2026-06",
        "model-continuation-2026-07",
    ],
    "ENTRY_HTF_FLIP": [
        "htf-flip-2024-03",
        "htf-context-set-2025-08",
        "htf-flip-definition-2025-08",
        "pure-flip-narrowing-2026-05",
        "model-continuation-2026-07",
    ],
    "ENTRY_HTF_BOUNDARY_CAUTION": ["htf-boundary-caution-2025-08"],
    "ENTRY_BREAK_CANDLE_NORMALIZATION": [
        "gold-break-exception-2025-03",
        "discretionary-break-2025-11",
        "reject-non-htf-break-2026-05",
        "break-normalized-to-flip-2026-06",
    ],
    "ENTRY_REJECTION_RESPECT_DISABLED": [
        "closure-or-flip-2025-03",
        "directional-close-2025-08",
        "directional-close-required-2026-06",
    ],
    "ENTRY_NEXT_CANDLE_WICK_HANDLING": [
        "next-candle-wick-2025-05",
        "prompt-close-2025-05",
        "close-fallback-2025-11",
    ],
}
```

Set `ENTRY_DIR_CLOSE` to `EXACT/PAPER_EVALUATE`, `ENTRY_HTF_FLIP` to
`EXACT/PAPER_EVALUATE`, both legacy rules to `DISABLED`, boundary caution to
`DISCRETIONARY/SHADOW_ONLY`, and next-candle handling to
`DISCRETIONARY/SHADOW_ONLY`. Set
`automation_policy.arbitration_policy_version` to exactly
`rd-entry-arbitration-v2`.

The inherited v1 list contains only these qualification rules:

```text
TIMEFRAME_FIVE_MINUTE_ONLY
ZONE_ORIGIN_OPPOSITE_CANDLE
ZONE_ACCURACY_BOUNDS
ZONE_FRESH_UNTAPPED
ZONE_PRE_ENTRY_CLOSE_OUTSIDE
LIQ_NORMAL_TWO_OPPOSITE_CANDLES
LIQ_ONE_CANDLE_EXCEPTION
LIQ_OWN_EXTREME_SAME_LEG
LIQ_STRICT_OWN_EXTREME_BREAK
LIQ_ACTUAL_EXTREME_SWEPT
LIQ_EVENT_ORDER
LIQ_INTERNAL_REBREAK
LIQ_DISTANCE_INFLUENCES_ZONE
LIQ_REPLACEMENT_AFTER_STALE_MOVE
```

Do not inherit v1 management, risk, Mangoe-backed, or single-model arbitration
rules.

- [ ] **Step 4: Generate and verify the JSON Schema**

Run:

```bash
uv run python scripts/export_schemas.py --output-dir contracts/schema
uv run python scripts/export_schemas.py --output-dir contracts/schema --check
uv run pytest tests/contract/test_rd_strategy_rule_contract.py \
  tests/contract/test_rd_strategy_rule_contract_v2.py -v
```

Expected: both v1 and v2 contract suites pass and the schema check exits zero.

- [ ] **Step 5: Document v2 contract authority**

Create `docs/rd-strategy-rule-contract-v2.md` with:

```markdown
# RD strategy rule contract v2

Version 2.0.0 governs 5m entry observation and paper selection only.
Version 1 remains frozen historical evidence.

- Official channel: `@RD_Forex` / `UC54xbL96tU58iez3YbTVTAg`
- Active models: `DIR_CLOSE`, `HTF_FLIP`
- Legacy observations: `LEGACY_BREAK_CANDLE`, `LEGACY_REJECTION_RESPECT`
- First touch: `ZONE_ENGAGED`
- Real execution: prohibited

Claim-level precedence is encoded in
`config/phase0/rd-strategy-rule-contract-v2.json`. Later silence does not
override compatible earlier rules. `NARROWS` and `SUPERSEDES` always point
to an older official claim.
```

Add links to v1 and v2 schemas in `contracts/README.md`.

- [ ] **Step 6: Commit the official contract**

```bash
git add config/phase0/rd-strategy-rule-contract-v2.json \
  contracts/schema/rd-strategy-rule-contract-v2.schema.json \
  contracts/README.md docs/rd-strategy-rule-contract-v2.md \
  tests/contract/test_rd_strategy_rule_contract_v2.py
git commit -m "feat: freeze official RD source claims"
```

---

### Task 3: Add semantic candidate, evidence, handling, and selection types

**Files:**
- Create: `src/prop_trading/domain/rd_entry_models.py`
- Create: `tests/unit/test_rd_entry_models.py`

**Interfaces:**
- Produces: all shared v2 enums/dataclasses plus `candidate_id()`,
  `evidence_id()`, `handling_id()`, and `selection_id()`.
- Consumed by: matcher, arbitrator, oracle, TypeScript vector implementation.

- [ ] **Step 1: Write failing identity and enum tests**

```python
from dataclasses import replace

import pytest

from prop_trading.domain.rd_entry_models import (
    EntryCandidateIdentity,
    EntryDirection,
    EntryEvidenceIdentity,
    EntryModelV2,
    ProofPlane,
    candidate_id,
    evidence_id,
)


def test_candidate_identity_is_semantic_and_proof_independent() -> None:
    identity = EntryCandidateIdentity(
        setup_id="setup-1",
        model=EntryModelV2.HTF_FLIP,
        direction=EntryDirection.LONG,
        event_anchor_epoch=1_721_808_000,
        trigger_ordinal=1,
    )
    assert len(candidate_id(identity)) == 64


def test_candidate_identity_rejects_zero_ordinal() -> None:
    with pytest.raises(ValueError):
        EntryCandidateIdentity(
            setup_id="setup-1",
            model=EntryModelV2.DIR_CLOSE,
            direction=EntryDirection.LONG,
            event_anchor_epoch=1_721_808_000,
            trigger_ordinal=0,
        )


def test_evidence_identity_changes_with_proof_plane() -> None:
    base = EntryEvidenceIdentity(
        candidate_id="a" * 64,
        proof_plane=ProofPlane.LOWER_TIMEFRAME_REPLAY,
        proof_resolution_seconds=60,
        coverage_start_epoch=1_721_808_000,
        coverage_end_epoch=1_721_808_300,
        observed_trigger_epoch=1_721_808_120,
        payload_sha256="b" * 64,
    )
    assert evidence_id(base) != evidence_id(
        replace(base, proof_plane=ProofPlane.REALTIME_TICK)
    )
```

- [ ] **Step 2: Run and verify the module is missing**

Run:

```bash
uv run pytest tests/unit/test_rd_entry_models.py -v
```

Expected: `ModuleNotFoundError`.

- [ ] **Step 3: Implement the exact enum and identity surface**

Define these closed enums:

```python
from dataclasses import dataclass
from enum import StrEnum
from typing import Literal

from prop_trading.domain.canonical import canonical_sha256


class EntryDirection(StrEnum):
    LONG = "LONG"
    SHORT = "SHORT"

class EntryModelV2(StrEnum):
    DIR_CLOSE = "DIR_CLOSE"
    HTF_FLIP = "HTF_FLIP"
    LEGACY_BREAK_CANDLE = "LEGACY_BREAK_CANDLE"
    LEGACY_REJECTION_RESPECT = "LEGACY_REJECTION_RESPECT"

class CandidateState(StrEnum):
    MATCHED = "MATCHED"
    BLOCKED = "BLOCKED"
    REJECTED = "REJECTED"
    NORMALIZED = "NORMALIZED"

class CandidateFidelity(StrEnum):
    EXACT = "EXACT"
    CALIBRATED = "CALIBRATED"
    DISCRETIONARY = "DISCRETIONARY"
    UNRESOLVED = "UNRESOLVED"

class ProofPlane(StrEnum):
    CONFIRMED_5M = "CONFIRMED_5M"
    LOWER_TIMEFRAME_REPLAY = "LOWER_TIMEFRAME_REPLAY"
    REALTIME_TICK = "REALTIME_TICK"
    EXTERNAL_ARCHIVED_TICK = "EXTERNAL_ARCHIVED_TICK"

class HandlingMode(StrEnum):
    CLOSE_CONFIRMATION = "CLOSE_CONFIRMATION"
    INTRABAR_FLIP = "INTRABAR_FLIP"
    NEXT_CANDLE_WICK = "NEXT_CANDLE_WICK"
    AGGRESSIVE = "AGGRESSIVE"

class AttemptKind(StrEnum):
    INITIAL = "INITIAL"
    RE_ENTRY = "RE_ENTRY"

class SetupAttemptTerminalReason(StrEnum):
    INVALIDATED = "INVALIDATED"
    BOTH_ACTIVE_MODELS_OBSERVED = "BOTH_ACTIVE_MODELS_OBSERVED"
    RETENTION_EVICTED = "RETENTION_EVICTED"

class SelectionAction(StrEnum):
    OBSERVE = "OBSERVE"
    PAPER_ELIGIBLE = "PAPER_ELIGIBLE"
    SHADOW_ONLY = "SHADOW_ONLY"
    NONE = "NONE"

class SelectionReason(StrEnum):
    ONLY_EXACT_TRIGGER = "ONLY_EXACT_TRIGGER"
    EARLIEST_EXACT_TRIGGER = "EARLIEST_EXACT_TRIGGER"
    FALLBACK_TO_CONFIRMED_CLOSE = "FALLBACK_TO_CONFIRMED_CLOSE"
    NO_EXACT_CANDIDATE = "NO_EXACT_CANDIDATE"
    UNRESOLVED_SOURCE_PRIORITY = "UNRESOLVED_SOURCE_PRIORITY"
    SETUP_INVALIDATED = "SETUP_INVALIDATED"
    NO_CANDIDATE = "NO_CANDIDATE"

class AmbiguityCode(StrEnum):
    SAME_CHILD_BAR_ORDER = "SHADOW_SAME_CHILD_BAR_ORDER"
    MISSING_INTRABAR_COVERAGE = "SHADOW_MISSING_INTRABAR_COVERAGE"
    REALTIME_ONLY_NOT_REPLAYABLE = "SHADOW_REALTIME_ONLY_NOT_REPLAYABLE"
```

Define these frozen slotted dataclasses after the enums. `HTFFlipProof` is part
of this shared model surface so the matcher can consume it in Task 4 before the
scanner starts producing it in Task 5:

```python
@dataclass(frozen=True, slots=True)
class OrderedCandle:
    open_epoch: int
    close_epoch: int
    open_ticks: int
    high_ticks: int
    low_ticks: int
    close_ticks: int


@dataclass(frozen=True, slots=True)
class HTFFlipProofTranscript:
    context_minutes: int
    htf_open_epoch: int
    htf_open_ticks: int
    scan_cutoff_epoch: int
    proof_resolution_seconds: int
    coverage_start_epoch: int
    coverage_end_epoch: int
    expected_child_count: int
    observed_child_count: int
    gap_present: bool
    full_lifecycle_ordered: bool
    destination_seen_before_contact: bool
    contact_candle: OrderedCandle | None
    recross_candle: OrderedCandle | None
    same_child: bool


@dataclass(frozen=True, slots=True)
class EntryCandidateIdentity:
    setup_id: str
    model: EntryModelV2
    direction: EntryDirection
    event_anchor_epoch: int
    trigger_ordinal: int


@dataclass(frozen=True, slots=True)
class EntryEvidenceIdentity:
    candidate_id: str
    proof_plane: ProofPlane
    proof_resolution_seconds: int
    coverage_start_epoch: int
    coverage_end_epoch: int
    observed_trigger_epoch: int | None
    payload_sha256: str


@dataclass(frozen=True, slots=True)
class EntryHandlingIdentity:
    candidate_id: str
    evidence_id: str
    handling_mode: HandlingMode
    attempt_kind: AttemptKind
    observed_epoch: int
    observed_ticks: int | None
    fidelity: CandidateFidelity
    source_claim_ids: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class EntrySelectionIdentity:
    setup_id: str
    policy_version: str
    revision: int
    candidate_ids_considered: tuple[str, ...]
    canonical_candidate_id: str | None
    canonical_evidence_id: str | None
    reason: SelectionReason
    fidelity: CandidateFidelity | None
    action: SelectionAction


@dataclass(frozen=True, slots=True)
class HTFFlipProof:
    matched: bool
    event_anchor_epoch: int
    trigger_epoch: int | None
    trigger_ticks: int | None
    htf_context_minutes: tuple[int, ...]
    fidelity: CandidateFidelity
    proof_plane: ProofPlane
    proof_resolution_seconds: int
    coverage_start_epoch: int
    coverage_end_epoch: int
    coverage_expected_child_count: int
    coverage_observed_child_count: int
    coverage_gap_detected: bool
    contact_child: OrderedCandle | None
    recross_child: OrderedCandle | None
    destination_seen_before_contact: bool
    ambiguity_codes: tuple[AmbiguityCode, ...]
    transcript_sha256: str
    full_lifecycle_ordered: bool
    transcript: HTFFlipProofTranscript


@dataclass(frozen=True, slots=True)
class EntryCandidate:
    candidate_id: str
    setup_id: str
    model: EntryModelV2
    state: CandidateState
    event_anchor_epoch: int
    trigger_ordinal: int
    direction: EntryDirection
    source_claim_ids: tuple[str, ...]
    normalized_from: EntryModelV2 | None
    observed_at_epoch: int


@dataclass(frozen=True, slots=True)
class EntryCandidateEvidence:
    evidence_id: str
    candidate_id: str
    observed_trigger_epoch: int | None
    observed_trigger_ticks: int | None
    htf_context_minutes: tuple[int, ...]
    fidelity: CandidateFidelity
    proof_plane: ProofPlane
    proof_resolution_seconds: int
    coverage_start_epoch: int
    coverage_end_epoch: int
    ambiguity_codes: tuple[AmbiguityCode, ...]
    passed_rule_ids: tuple[str, ...]
    failed_rule_ids: tuple[str, ...]
    source_claim_ids: tuple[str, ...]
    payload_sha256: str
    observed_at_epoch: int


@dataclass(frozen=True, slots=True)
class EntryHandlingObservation:
    handling_id: str
    candidate_id: str
    evidence_id: str
    handling_mode: HandlingMode
    attempt_kind: AttemptKind
    observed_epoch: int
    observed_ticks: int | None
    fidelity: CandidateFidelity
    source_claim_ids: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class EntrySelection:
    selection_id: str
    setup_id: str
    policy_version: Literal["rd-entry-arbitration-v2"]
    revision: int
    candidate_ids_considered: tuple[str, ...]
    canonical_candidate_id: str | None
    canonical_evidence_id: str | None
    canonical_model: EntryModelV2 | None
    reason: SelectionReason
    fidelity: CandidateFidelity | None
    action: SelectionAction
    evaluated_at_epoch: int
```

Implement `__post_init__` checks that reject empty IDs, negative epochs,
non-positive candidate trigger ordinals,
non-positive resolutions, invalid OHLC (`high < max(open, close, low)` or
`low > min(open, close, high)`), non-increasing coverage, unsorted or duplicate
HTF contexts, and mismatched nullable pairs (`trigger_epoch`/`trigger_ticks` and
the two canonical IDs). `HTFFlipProofTranscript` additionally requires context
minutes in `{15, 30, 60}`, a positive child resolution below 300 seconds that
divides 300, `coverage_start_epoch == htf_open_epoch`,
`coverage_end_epoch == scan_cutoff_epoch`, non-negative child counts, and
`same_child=True` exactly when both retained candle intervals are identical.
It rejects a recross without contact and validates both retained candles as
full `OrderedCandle` values. Require every SHA-256 field, including
`HTFFlipProof.transcript_sha256`, to be nonzero lowercase 64-hex. A parsed
`HTFFlipProof` is constructed by `validate_htf_flip_transcript()` so its
duplicated coverage, trigger, fidelity, ambiguity, and transcript digest fields
cannot disagree with its transcript. `EntryCandidateEvidence` intentionally has no `model`
field; callers join it to `EntryCandidate` through `candidate_id`. Handling is
stored only in `EntryHandlingObservation`. Require `candidate_ids_considered` to
be sorted and unique, every source-claim tuple to be duplicate-free, handling to
reference nonempty candidate/evidence hashes, and every selection policy version
to equal `rd-entry-arbitration-v2`.

Implement IDs exactly:

```python
def candidate_id(identity: EntryCandidateIdentity) -> str:
    return canonical_sha256(
        {
            "direction": identity.direction.value,
            "event_anchor_epoch": identity.event_anchor_epoch,
            "model": identity.model.value,
            "setup_id": identity.setup_id,
            "trigger_ordinal": identity.trigger_ordinal,
        }
    )


def evidence_id(identity: EntryEvidenceIdentity) -> str:
    return canonical_sha256(
        {
            "candidate_id": identity.candidate_id,
            "coverage_end_epoch": identity.coverage_end_epoch,
            "coverage_start_epoch": identity.coverage_start_epoch,
            "observed_trigger_epoch": identity.observed_trigger_epoch,
            "payload_sha256": identity.payload_sha256,
            "proof_plane": identity.proof_plane.value,
            "proof_resolution_seconds": identity.proof_resolution_seconds,
        }
    )


def handling_id(identity: EntryHandlingIdentity) -> str:
    return canonical_sha256(
        {
            "attempt_kind": identity.attempt_kind.value,
            "candidate_id": identity.candidate_id,
            "evidence_id": identity.evidence_id,
            "fidelity": identity.fidelity.value,
            "handling_mode": identity.handling_mode.value,
            "observed_epoch": identity.observed_epoch,
            "observed_ticks": identity.observed_ticks,
            "source_claim_ids": list(identity.source_claim_ids),
        }
    )


def selection_id(identity: EntrySelectionIdentity) -> str:
    return canonical_sha256(
        {
            "action": identity.action.value,
            "candidate_ids_considered": list(identity.candidate_ids_considered),
            "canonical_candidate_id": identity.canonical_candidate_id,
            "canonical_evidence_id": identity.canonical_evidence_id,
            "fidelity": (
                identity.fidelity.value
                if identity.fidelity is not None
                else None
            ),
            "policy_version": identity.policy_version,
            "reason": identity.reason.value,
            "revision": identity.revision,
            "setup_id": identity.setup_id,
        }
    )
```

`EntryEvidenceIdentity.payload_sha256` is not the receipt or chunk hash. It is
the authoritative SHA-256 of this expanded, credential-free proof mapping:

```python
{
    "ambiguity_codes": [item.value for item in evidence.ambiguity_codes],
    "candidate_id": evidence.candidate_id,
    "coverage_end_epoch": evidence.coverage_end_epoch,
    "coverage_start_epoch": evidence.coverage_start_epoch,
    "failed_rule_ids": list(evidence.failed_rule_ids),
    "fidelity": evidence.fidelity.value,
    "htf_context_minutes": list(evidence.htf_context_minutes),
    "observed_trigger_epoch": evidence.observed_trigger_epoch,
    "observed_trigger_ticks": evidence.observed_trigger_ticks,
    "passed_rule_ids": list(evidence.passed_rule_ids),
    "proof_plane": evidence.proof_plane.value,
    "proof_resolution_seconds": evidence.proof_resolution_seconds,
    "source_claim_ids": list(evidence.source_claim_ids),
}
```

Compute it with `canonical_sha256()` before constructing
`EntryEvidenceIdentity`, then store the same value on
`EntryCandidateEvidence.payload_sha256`. The receipt payload hash remains only
receipt/chunk provenance. This separation makes evidence IDs identical in
Python, TypeScript, Pine-log parity, and differently chunked transport.
`HTFFlipProof.transcript_sha256` is a separate integrity digest of the compact
HTF transcript. The matcher must never copy it into
`EntryCandidateEvidence.payload_sha256`; it always recomputes the frozen
expanded evidence mapping above after candidate ID, contexts, rules, fidelity,
and source claims are final.

- [ ] **Step 4: Run tests and static checks**

```bash
uv run pytest tests/unit/test_rd_entry_models.py -v
uv run ruff check src/prop_trading/domain/rd_entry_models.py \
  tests/unit/test_rd_entry_models.py
uv run mypy
```

Expected: all commands pass.

- [ ] **Step 5: Commit domain identities**

```bash
git add src/prop_trading/domain/rd_entry_models.py \
  tests/unit/test_rd_entry_models.py
git commit -m "feat: add RD entry candidate domain types"
```

---

### Task 4: Match directional close and legacy patterns independently

**Files:**
- Create: `src/prop_trading/domain/rd_entry_matcher.py`
- Create: `tests/unit/test_rd_entry_matcher.py`

**Interfaces:**
- Consumes: v2 domain types and exact setup facts.
- Produces: `match_entry_candidates(request: EntryMatchRequest) -> EntryMatchResult`.

- [ ] **Step 1: Write failing tests for close and legacy coexistence**

```python
def test_directional_close_and_legacy_break_are_both_retained() -> None:
    result = match_entry_candidates(demand_close_request(generic_break=True))
    assert [candidate.model for candidate in result.candidates] == [
        EntryModelV2.DIR_CLOSE,
        EntryModelV2.LEGACY_BREAK_CANDLE,
    ]
    assert result.candidates[0].state is CandidateState.MATCHED
    assert result.candidates[1].state is CandidateState.REJECTED


def test_rejection_only_never_becomes_directional_close() -> None:
    result = match_entry_candidates(
        demand_close_request(close_ticks=100, open_ticks=99, zone_top_ticks=100)
    )
    assert EntryModelV2.DIR_CLOSE not in {
        candidate.model for candidate in result.candidates
    }
    assert result.candidates[0].model is EntryModelV2.LEGACY_REJECTION_RESPECT


def test_exact_close_with_calibrated_common_setup_stays_non_exact() -> None:
    request = demand_close_request()
    request = replace(
        request,
        setup=replace(
            request.setup,
            common_fidelity=CandidateFidelity.CALIBRATED,
        ),
    )
    result = match_entry_candidates(request)
    assert result.evidence[0].fidelity is CandidateFidelity.CALIBRATED


@pytest.mark.parametrize(
    ("attempt_kind", "trigger_ordinal"),
    [
        (AttemptKind.INITIAL, 2),
        (AttemptKind.RE_ENTRY, 1),
    ],
)
def test_attempt_kind_and_trigger_ordinal_must_agree(
    attempt_kind: AttemptKind,
    trigger_ordinal: int,
) -> None:
    with pytest.raises(ValueError):
        replace(
            demand_close_request(),
            attempt_kind=attempt_kind,
            trigger_ordinal=trigger_ordinal,
        )


def test_isolated_reentry_uses_attempt_scoped_setup_and_ordinal() -> None:
    request = replace(
        demand_close_request(),
        setup=replace(
            demand_close_request().setup,
            setup_id="setup-1/re-entry/2",
        ),
        attempt_kind=AttemptKind.RE_ENTRY,
        trigger_ordinal=2,
    )
    candidate = match_entry_candidates(request).candidates[0]
    assert candidate.setup_id == "setup-1/re-entry/2"
    assert candidate.trigger_ordinal == 2
```

- [ ] **Step 2: Run and verify the matcher is missing**

```bash
uv run pytest tests/unit/test_rd_entry_matcher.py -v
```

Expected: import failure for `rd_entry_matcher`.

- [ ] **Step 3: Implement strict matcher requests and close predicates**

Define:

```python
@dataclass(frozen=True, slots=True)
class SetupEntryFacts:
    setup_id: str
    direction: EntryDirection
    zone_top_ticks: int
    zone_bottom_ticks: int
    zone_engaged_epoch: int | None
    invalidated_before_entry: bool
    common_fidelity: CandidateFidelity
    terminal_reason: SetupAttemptTerminalReason | None
    terminal_epoch: int | None


@dataclass(frozen=True, slots=True)
class EntryMatchRequest:
    setup: SetupEntryFacts
    confirmed_bar: OrderedCandle
    htf_proofs: tuple[HTFFlipProof, ...]
    generic_break_detected: bool
    rejection_respect_detected: bool
    attempt_kind: AttemptKind
    trigger_ordinal: int


@dataclass(frozen=True, slots=True)
class EntryMatchResult:
    candidates: tuple[EntryCandidate, ...]
    evidence: tuple[EntryCandidateEvidence, ...]
    handling: tuple[EntryHandlingObservation, ...]
```

`terminal_reason` and `terminal_epoch` are jointly nullable. Reject either field
without the other, a negative terminal epoch, a terminal epoch before
`zone_engaged_epoch`, or `invalidated_before_entry=True` without an
`INVALIDATED` terminal. For an `INVALIDATED` terminal, derive
`invalidated_before_entry` against the accumulated active-candidate set:
it is true exactly when no active candidate existed before invalidation. An
`INVALIDATED` terminal after one active candidate is valid with
`invalidated_before_entry=False` and may not erase that earlier candidate.
`RETENTION_EVICTED` is the only expiry representation in this increment; never
infer expiry from wall-clock time.

Require `INITIAL` to pair with `trigger_ordinal=1`. Require `RE_ENTRY` to pair
with `trigger_ordinal>=2` and a setup ID distinct from the originating initial
attempt; the fixture supplies that relation explicitly. The matcher never
derives an ordinal from event arrival order. Every candidate emitted for a
request uses `request.trigger_ordinal`.

Across an accumulated setup stream, the terminal transition is immutable and
one-way: reject a terminal-to-open transition or a changed reason or epoch.
After terminalization reject every trigger event. The oracle may consume one
post-terminal handling-only event under the narrow `NEXT_CANDLE_WICK` grace
defined in Task 7; that event never calls this matcher. Validate
`BOTH_ACTIVE_MODELS_OBSERVED` only after matching and require independently
derived candidates for both `DIR_CLOSE` and `HTF_FLIP`. The compact
cross-language setup-facts wire uses `tr` for the nullable terminal-reason enum
and `te` for the nullable terminal epoch.

Use exact predicates:

```python
def _directional_close(request: EntryMatchRequest) -> bool:
    bar = request.confirmed_bar
    zone = request.setup
    if zone.direction is EntryDirection.LONG:
        return bar.close_ticks > bar.open_ticks and bar.close_ticks > zone.zone_top_ticks
    return bar.close_ticks < bar.open_ticks and bar.close_ticks < zone.zone_bottom_ticks
```

Return immediately with no new active candidate when setup is not engaged or
`terminal_reason is INVALIDATED`. Existing candidates from earlier events remain
in the accumulated oracle stream. Otherwise evaluate close, generic break, and
rejection/respect independently. Attach official source claim IDs in the matcher;
do not accept source authority from the caller.

Combine common-setup fidelity with each trigger proof using the least-trusted
value under the closed order `EXACT`, `CALIBRATED`, `DISCRETIONARY`,
`UNRESOLVED`. An exact trigger over a calibrated setup is `CALIBRATED`, never
`EXACT`; an unresolved value on either side yields `UNRESOLVED`. Only resulting
`EXACT` evidence can be paper-eligible. Add the same cases to the generated
cross-language vector so TypeScript and Pine diagnostics cannot upgrade
calibrated setup provenance.

Freeze the matcher-owned mappings exactly:

```python
MODEL_SOURCE_CLAIMS: dict[EntryModelV2, tuple[str, ...]] = {
    EntryModelV2.DIR_CLOSE: (
        "standard-close-2024-03",
        "closure-or-flip-2025-03",
        "directional-close-2025-08",
        "directional-close-required-2026-06",
        "model-continuation-2026-07",
    ),
    EntryModelV2.HTF_FLIP: (
        "htf-flip-2024-03",
        "htf-context-set-2025-08",
        "htf-flip-definition-2025-08",
        "pure-flip-narrowing-2026-05",
        "model-continuation-2026-07",
    ),
    EntryModelV2.LEGACY_BREAK_CANDLE: (
        "gold-break-exception-2025-03",
        "discretionary-break-2025-11",
        "reject-non-htf-break-2026-05",
        "break-normalized-to-flip-2026-06",
    ),
    EntryModelV2.LEGACY_REJECTION_RESPECT: (
        "closure-or-flip-2025-03",
        "directional-close-2025-08",
        "directional-close-required-2026-06",
    ),
}
NEXT_CANDLE_WICK_SOURCE_CLAIMS = (
    "next-candle-wick-2025-05",
    "prompt-close-2025-05",
    "close-fallback-2025-11",
)
HTF_BOUNDARY_SOURCE_CLAIMS = ("htf-boundary-caution-2025-08",)
```

Ordinary candidate evidence uses its model tuple. Evidence downgraded specifically
by HTF-boundary uncertainty adds `HTF_BOUNDARY_SOURCE_CLAIMS`. A
`NEXT_CANDLE_WICK` handling observation uses
`NEXT_CANDLE_WICK_SOURCE_CLAIMS`; close-confirmation and intrabar-flip handling
use their candidate model tuple. Assert these constants equal the corresponding
v2 contract rule references so Python cannot drift from source authority.

For a break recognizer and HTF proof sharing the same HTF boundary and recross
epoch, emit one `HTF_FLIP` candidate with `state=NORMALIZED` and
`normalized_from=LEGACY_BREAK_CANDLE`; do not also emit a rejected legacy
candidate for that event. Its candidate source claims remain the `HTF_FLIP`
tuple, while its evidence source claims append the
`LEGACY_BREAK_CANDLE` tuple to prove the normalization. A generic break without
matching HTF proof emits only the rejected legacy candidate. A pure flip with no
break fact is `MATCHED` with `normalized_from=None`.

Process HTF proofs independent of input/context order. First group them by
`(event_anchor_epoch, trigger_epoch)`. Within a group, merge context minutes into
one sorted tuple only when every non-context evidence field is equal (proof
plane/resolution, coverage, trigger ticks, effective fidelity, ambiguity,
passed/failed rules, and source claims). Proofs that differ in fidelity,
ambiguity, transcript-derived coverage, or rule outcome remain separate
append-only evidence rows on the same candidate. Derive the candidate state
from the complete group before applying the common setup-fidelity downgrade:
`NORMALIZED` when the event satisfies the frozen break-normalization rule,
otherwise `MATCHED` when any underlying HTF trigger proof is exact/order-proven
and `BLOCKED` when every trigger proof remains ambiguous or unresolved. An
order-proven trigger over calibrated or unresolved common setup facts is still
a matched observation, but its effective evidence remains non-exact and
shadow-only. Never let 15m/30m/60m iteration order choose state, fidelity, or
canonical evidence.

Freeze event identity semantics as follows:

- the caller supplies `trigger_ordinal`; `AttemptKind.INITIAL` accepts exactly
  `1`;
- a future isolated `RE_ENTRY` lifecycle supplies an attempt-scoped setup ID and
  ordinal `2` or greater after an explicit re-arm; it never shares a stream with
  its INITIAL attempt, and the matcher never infers re-entry from duplicate
  market evidence;
- V3 Pine rejects any outbound ordinal other than `1` in this increment;
- `DIR_CLOSE` and both legacy observations use the confirmed bar
  `open_epoch` as `event_anchor_epoch` and its `close_epoch` as
  `observed_trigger_epoch`;
- `HTF_FLIP` uses the relevant `htf_open_epoch` as
  `event_anchor_epoch`; proofs combine on one candidate only when the HTF opening
  boundary and recross child close are the same, then retain every matching
  `15m`/`30m`/`1h` context;
- an HTF-timed break normalized to `HTF_FLIP` uses that same HTF opening
  boundary, never the later 5m close;
- lower-timeframe evidence records the recross child `close_epoch` separately as
  `observed_trigger_epoch`;
- `observed_at_epoch` is the confirmed 5m close for confirmed-bar facts and the
  scan cutoff for accumulated lower-timeframe proof.

- [ ] **Step 4: Run close/legacy tests**

```bash
uv run pytest tests/unit/test_rd_entry_matcher.py -v
```

Expected: all close, supply symmetry, invalidation, generic break, and rejection
tests pass.

- [ ] **Step 5: Commit independent matching**

```bash
git add src/prop_trading/domain/rd_entry_matcher.py \
  tests/unit/test_rd_entry_matcher.py
git commit -m "feat: match close and legacy entry candidates"
```

---

### Task 5: Prove replayable HTF flips from ordered child candles

**Files:**
- Create: `src/prop_trading/domain/rd_intrabar_oracle.py`
- Create: `tests/unit/test_rd_intrabar_oracle.py`
- Modify: `src/prop_trading/domain/rd_entry_matcher.py`
- Modify: `tests/unit/test_rd_entry_matcher.py`

**Interfaces:**
- Produces: `scan_htf_flip(request: HTFFlipScanRequest) -> HTFFlipProof`.
- Produces:
  `validate_htf_flip_transcript(setup: SetupEntryFacts, transcript: HTFFlipProofTranscript) -> HTFFlipProof`.
- Matcher consumes `HTFFlipProof` and combines contexts sharing one event anchor.

- [ ] **Step 1: Write failing ordered, ambiguous, and missing-coverage tests**

```python
def test_distinct_child_contact_then_recross_is_exact() -> None:
    result = scan_htf_flip(exact_demand_flip_request())
    assert result.matched is True
    assert result.fidelity is CandidateFidelity.EXACT
    assert result.ambiguity_codes == ()


def test_later_5m_slice_wick_recross_is_detected_even_if_child_closes_back() -> None:
    request = later_slice_demand_flip_request(
        trigger_child_high_ticks=103,
        trigger_child_close_ticks=99,
        htf_open_ticks=100,
        scan_cutoff_epoch=1_721_808_900,
    )
    result = scan_htf_flip(request)
    assert request.scan_cutoff_epoch - request.htf_open_epoch == 900
    assert result.matched is True
    assert result.trigger_ticks == 100
    assert result.coverage_end_epoch == request.scan_cutoff_epoch


def test_same_child_low_and_high_are_ambiguous() -> None:
    result = scan_htf_flip(same_child_demand_flip_request())
    assert result.matched is True
    assert result.fidelity is CandidateFidelity.UNRESOLVED
    assert result.ambiguity_codes == (AmbiguityCode.SAME_CHILD_BAR_ORDER,)


def test_same_child_open_inside_zone_proves_contact_before_wick_recross() -> None:
    result = scan_htf_flip(
        same_child_demand_flip_request(
            zone_bottom_ticks=97,
            zone_top_ticks=99,
            child_open_ticks=98,
        )
    )
    assert result.matched is True
    assert result.fidelity is CandidateFidelity.EXACT
    assert result.ambiguity_codes == ()


def test_gap_or_empty_children_fail_closed() -> None:
    result = scan_htf_flip(missing_coverage_request())
    assert result.matched is False
    assert result.ambiguity_codes == (AmbiguityCode.MISSING_INTRABAR_COVERAGE,)


def test_contact_before_gap_cannot_authorize_later_recross() -> None:
    result = scan_htf_flip(contact_gap_then_recross_request())
    assert result.matched is False
    assert result.contact_child is None
    assert result.recross_child is None
    assert result.fidelity is CandidateFidelity.UNRESOLVED
    assert result.ambiguity_codes == (AmbiguityCode.MISSING_INTRABAR_COVERAGE,)


def test_compact_transcript_replays_to_the_same_proof() -> None:
    scanned = scan_htf_flip(exact_demand_flip_request())
    replayed = validate_htf_flip_transcript(
        exact_demand_flip_request().setup,
        scanned.transcript,
    )
    assert replayed == scanned


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("observed_child_count", 999),
        ("same_child", True),
        ("contact_candle", None),
    ],
)
def test_tampered_compact_transcript_is_rejected(
    field: str,
    value: object,
) -> None:
    proof = scan_htf_flip(exact_demand_flip_request())
    with pytest.raises(ValueError):
        validate_htf_flip_transcript(
            exact_demand_flip_request().setup,
            replace(proof.transcript, **{field: value}),
        )
```

- [ ] **Step 2: Run and verify the scanner is missing**

```bash
uv run pytest tests/unit/test_rd_intrabar_oracle.py -v
```

Expected: import failure for `rd_intrabar_oracle`.

- [ ] **Step 3: Implement chronological scan and coverage validation**

Define requests with exact fields:

```python
@dataclass(frozen=True, slots=True)
class HTFFlipScanRequest:
    setup: SetupEntryFacts
    timeframe_minutes: int
    htf_open_epoch: int
    scan_cutoff_epoch: int
    htf_open_ticks: int
    children: tuple[OrderedCandle, ...]
    proof_resolution_seconds: int
    full_lifecycle_ordered: bool
```

Validation rules:

```python
def _coverage_is_contiguous(request: HTFFlipScanRequest) -> bool:
    children = request.children
    coverage_seconds = request.scan_cutoff_epoch - request.htf_open_epoch
    context_seconds = request.timeframe_minutes * 60
    resolution = request.proof_resolution_seconds
    expected_count = coverage_seconds // resolution if resolution > 0 else 0
    return (
        request.timeframe_minutes in {15, 30, 60}
        and 0 < resolution < 300
        and 300 % resolution == 0
        and 0 < coverage_seconds <= context_seconds
        and coverage_seconds % 300 == 0
        and coverage_seconds % resolution == 0
        and len(children) == expected_count
        and children[0].open_epoch == request.htf_open_epoch
        and children[-1].close_epoch == request.scan_cutoff_epoch
        and all(
            candle.close_epoch - candle.open_epoch == resolution
            for candle in children
        )
        and all(
            children[index - 1].close_epoch == children[index].open_epoch
            for index in range(1, len(children))
        )
)
```

Expose the compact replay bridge in the same module:

```python
def validate_htf_flip_transcript(
    setup: SetupEntryFacts,
    transcript: HTFFlipProofTranscript,
) -> HTFFlipProof:
    _validate_transcript_shape(transcript)
    contact = transcript.contact_candle
    recross = transcript.recross_candle
    if contact is not None and not _contacts_zone(setup, contact):
        raise ValueError("contact candle does not contact the setup zone")
    if recross is not None and not _recrosses_htf_open(
        setup.direction,
        transcript.htf_open_ticks,
        recross,
    ):
        raise ValueError("recross candle does not cross the HTF open")
    if recross is not None and contact is None:
        raise ValueError("recross cannot precede the retained contact")
    if contact is not None and recross is not None:
        if transcript.same_child:
            if contact != recross:
                raise ValueError("same-child transcript candles differ")
        elif contact.close_epoch > recross.open_epoch:
            raise ValueError("distinct contact and recross are not chronological")

    matched = contact is not None and recross is not None
    contact_at_open = (
        contact is not None
        and setup.zone_bottom_ticks <= contact.open_ticks <= setup.zone_top_ticks
    )
    same_child_ambiguous = (
        matched and transcript.same_child and not contact_at_open
    )
    exact = (
        matched
        and not transcript.gap_present
        and transcript.expected_child_count == transcript.observed_child_count
        and transcript.full_lifecycle_ordered
        and not transcript.destination_seen_before_contact
        and not same_child_ambiguous
    )
    ambiguity_codes = tuple(
        code
        for present, code in (
            (same_child_ambiguous, AmbiguityCode.SAME_CHILD_BAR_ORDER),
            (
                transcript.gap_present,
                AmbiguityCode.MISSING_INTRABAR_COVERAGE,
            ),
        )
        if present
    )
    return HTFFlipProof(
        matched=matched,
        event_anchor_epoch=transcript.htf_open_epoch,
        trigger_epoch=recross.close_epoch if recross is not None else None,
        trigger_ticks=transcript.htf_open_ticks if recross is not None else None,
        htf_context_minutes=(transcript.context_minutes,),
        fidelity=(
            CandidateFidelity.EXACT
            if exact
            else CandidateFidelity.UNRESOLVED
        ),
        proof_plane=ProofPlane.LOWER_TIMEFRAME_REPLAY,
        proof_resolution_seconds=transcript.proof_resolution_seconds,
        coverage_start_epoch=transcript.coverage_start_epoch,
        coverage_end_epoch=transcript.coverage_end_epoch,
        coverage_expected_child_count=transcript.expected_child_count,
        coverage_observed_child_count=transcript.observed_child_count,
        coverage_gap_detected=transcript.gap_present,
        contact_child=contact,
        recross_child=recross,
        destination_seen_before_contact=(
            transcript.destination_seen_before_contact
        ),
        ambiguity_codes=ambiguity_codes,
        transcript_sha256=canonical_sha256(transcript.to_mapping()),
        full_lifecycle_ordered=transcript.full_lifecycle_ordered,
        transcript=transcript,
    )
```

`_validate_transcript_shape()` enforces every `HTFFlipProofTranscript`
invariant from Task 3 and additionally requires:

- `htf_open_epoch < scan_cutoff_epoch <= htf_open_epoch + context_minutes * 60`;
- the cutoff and coverage length are aligned to `proof_resolution_seconds`;
- `expected_child_count ==
  (coverage_end_epoch - coverage_start_epoch) // proof_resolution_seconds`;
- `0 <= observed_child_count <= expected_child_count`;
- `gap_present == (observed_child_count != expected_child_count)`;
- every retained candle lies inside `[coverage_start_epoch,
  coverage_end_epoch]` and spans exactly one proof-resolution interval;
- `same_child` is true if and only if both full candle objects have the same
  open and close epochs; and
- `destination_seen_before_contact` prevents exact fidelity but does not erase a
  replay-observed, shadow-only candidate.

`HTFFlipProofTranscript.to_mapping()` emits exactly this expanded, sorted-key
shape; compact Pine names are transport aliases only:

```python
{
    "context_minutes": transcript.context_minutes,
    "htf_open_epoch": transcript.htf_open_epoch,
    "htf_open_ticks": transcript.htf_open_ticks,
    "scan_cutoff_epoch": transcript.scan_cutoff_epoch,
    "proof_resolution_seconds": transcript.proof_resolution_seconds,
    "coverage_start_epoch": transcript.coverage_start_epoch,
    "coverage_end_epoch": transcript.coverage_end_epoch,
    "expected_child_count": transcript.expected_child_count,
    "observed_child_count": transcript.observed_child_count,
    "gap_present": transcript.gap_present,
    "full_lifecycle_ordered": transcript.full_lifecycle_ordered,
    "destination_seen_before_contact": (
        transcript.destination_seen_before_contact
    ),
    "contact_candle": (
        transcript.contact_candle.to_mapping()
        if transcript.contact_candle is not None
        else None
    ),
    "recross_candle": (
        transcript.recross_candle.to_mapping()
        if transcript.recross_candle is not None
        else None
    ),
    "same_child": transcript.same_child,
}
```

An `OrderedCandle.to_mapping()` object has the six expanded keys
`open_epoch`, `close_epoch`, `open_ticks`, `high_ticks`, `low_ticks`, and
`close_ticks`. The Pine comparator expands `m/ae/ao/cu/rs/cs/ce/ec/oc/gp/lo/db/
cc/rc/sb` and child `oe/ce/o/h/l/c` into these exact names, then calls
`validate_htf_flip_transcript()`. It must not reimplement the matching,
coverage, same-child, or fidelity rules.

`children` is the accumulated oldest-first child stream from the HTF open through
the latest completed 5m slice, not merely the opening 5m slice and not the entire
future HTF candle. For example, a 30m context scanned after its third completed
5m slice has `scan_cutoff_epoch == htf_open_epoch + 900`; at 60-second proof
resolution it must carry exactly 15 contiguous children. A scan never requires
children after `scan_cutoff_epoch`, so a trigger in a later 5m slice remains
detectable without waiting for the 15m/30m/60m candle to close.

Scan oldest-first. Demand contact is zone overlap
`low_ticks <= zone_top_ticks and high_ticks >= zone_bottom_ticks`; supply is
symmetric. After contact is established in an earlier child, demand recross is a
later child with `high_ticks > htf_open_ticks`; supply uses
`low_ticks < htf_open_ticks`. Record the trigger at that child's close and retain
`proof_resolution_seconds` so this does not claim an exact tick timestamp. A
child opening inside the zone proves contact before that child's later range;
otherwise contact-and-recross visible only inside one child is unresolved.
Reject evidence when the destination-side move was already present before valid
contact. Require `full_lifecycle_ordered=True` for exact fidelity.

When the accumulated child stream has a missing slice or cadence break, set the
permanent coverage-gap flag and clear any contact retained from before that gap.
A later recross cannot reuse the pre-gap contact. Continue scanning only so a
new post-gap contact/recross can be retained as an `UNRESOLVED` observation;
the gap can never be repaired to `EXACT` for that HTF boundary. Add a direct
contact → gap → recross test that returns no match without a new post-gap
contact, plus the frozen `htf-flip-partial-coverage` cross-language vector.

`scan_htf_flip()` validates the raw children, finds the first contact and first
eligible recross in chronological order, builds one `HTFFlipProofTranscript`,
and returns only `validate_htf_flip_transcript(request.setup, transcript)`.
There is one rule implementation: the raw scanner discovers retained facts, and
the public validator decides match and fidelity. Transcript coverage is always
the full accumulated prefix from `htf_open_epoch` through
`request.scan_cutoff_epoch`, so `coverage_end_epoch == scan_cutoff_epoch` and
expected/observed counts cover that entire prefix even when the first recross
occurred earlier. The trigger remains the first retained recross candle's close
epoch. Only unobserved future children after the cutoff are outside the proof.
Populate:

- expected and observed child counts for the covered prefix;
- `coverage_gap_detected`;
- the first full contact child OHLC;
- the first full recross child OHLC;
- `destination_seen_before_contact`;
- the existing lifecycle, resolution, coverage, trigger, and ambiguity fields.

The contact and recross child may be the same object. In that case the transcript
is exact only when its open is inside the zone; otherwise it carries
`SHADOW_SAME_CHILD_BAR_ORDER`. Oracle vectors serialize this transcript under
each HTF proof so Pine can emit the bounded form and TypeScript can validate it
without retaining every 1m child in the alert payload.

- [ ] **Step 4: Add matcher normalization and multi-context tests**

Add tests proving:

```python
def test_one_flip_combines_15_30_60_contexts() -> None:
    result = match_entry_candidates(request_with_three_exact_flip_proofs())
    flip_candidates = [
        item for item in result.candidates if item.model is EntryModelV2.HTF_FLIP
    ]
    assert len(flip_candidates) == 1
    flip_evidence = [
        item
        for item in result.evidence
        if item.candidate_id == flip_candidates[0].candidate_id
    ]
    assert len(flip_evidence) == 1
    assert flip_evidence[0].htf_context_minutes == (15, 30, 60)


def test_mixed_context_fidelity_is_order_independent() -> None:
    forward = match_entry_candidates(
        request_with_exact_30m_and_unresolved_15m_proofs()
    )
    reverse = match_entry_candidates(
        request_with_exact_30m_and_unresolved_15m_proofs(reverse=True)
    )
    assert forward == reverse
    assert len(forward.candidates) == 1
    assert forward.candidates[0].state is CandidateState.MATCHED
    assert {
        (item.fidelity, item.htf_context_minutes)
        for item in forward.evidence
    } == {
        (CandidateFidelity.EXACT, (30,)),
        (CandidateFidelity.UNRESOLVED, (15,)),
    }


def test_htf_break_normalizes_to_flip() -> None:
    result = match_entry_candidates(request_with_htf_break_proof())
    assert result.candidates[0].model is EntryModelV2.HTF_FLIP
    assert result.candidates[0].normalized_from is EntryModelV2.LEGACY_BREAK_CANDLE
```

- [ ] **Step 5: Run targeted tests and commit**

```bash
uv run pytest tests/unit/test_rd_intrabar_oracle.py \
  tests/unit/test_rd_entry_matcher.py -v
git add src/prop_trading/domain/rd_intrabar_oracle.py \
  src/prop_trading/domain/rd_entry_matcher.py \
  tests/unit/test_rd_intrabar_oracle.py \
  tests/unit/test_rd_entry_matcher.py
git commit -m "feat: prove replayable HTF flip candidates"
```

---

### Task 6: Implement deterministic canonical arbitration

**Files:**
- Create: `src/prop_trading/domain/rd_entry_arbitrator.py`
- Create: `tests/unit/test_rd_entry_arbitrator.py`

**Interfaces:**
- Consumes: immutable candidates and evidence.
- Produces: `arbitrate_entry_candidates(request: EntryArbitrationRequest) -> EntrySelection`.

- [ ] **Step 1: Write failing arbitration tests**

```python
def test_exact_flip_precedes_later_exact_close() -> None:
    selection = arbitrate_entry_candidates(exact_flip_then_close())
    assert selection.policy_version == "rd-entry-arbitration-v2"
    assert selection.reason is SelectionReason.EARLIEST_EXACT_TRIGGER
    assert selection.canonical_model is EntryModelV2.HTF_FLIP
    assert selection.action is SelectionAction.PAPER_ELIGIBLE


def test_shadow_flip_falls_back_to_exact_close() -> None:
    selection = arbitrate_entry_candidates(shadow_flip_then_close())
    assert selection.reason is SelectionReason.FALLBACK_TO_CONFIRMED_CLOSE
    assert selection.canonical_model is EntryModelV2.DIR_CLOSE


def test_earlier_exact_close_is_not_replaced_by_a_later_flip() -> None:
    selection = arbitrate_entry_candidates(exact_close_then_later_flip())
    assert selection.reason is SelectionReason.EARLIEST_EXACT_TRIGGER
    assert selection.canonical_model is EntryModelV2.DIR_CLOSE
    assert selection.action is SelectionAction.PAPER_ELIGIBLE


def test_input_order_does_not_change_selection() -> None:
    request = exact_flip_then_close()
    reversed_request = replace(
        request,
        candidates=tuple(reversed(request.candidates)),
        evidence=tuple(reversed(request.evidence)),
    )
    assert arbitrate_entry_candidates(request) == arbitrate_entry_candidates(
        reversed_request
    )


def test_canonical_evidence_rank_is_stable_when_one_candidate_has_two_exact_proofs() -> None:
    request = candidate_with_two_exact_evidence()
    expected = min(request.evidence, key=canonical_exact_evidence_rank)
    forward = arbitrate_entry_candidates(request)
    reverse = arbitrate_entry_candidates(
        replace(request, evidence=tuple(reversed(request.evidence)))
    )
    assert forward == reverse
    assert forward.canonical_evidence_id == expected.evidence_id


def test_later_nonexact_flip_does_not_retroactively_make_close_a_fallback() -> None:
    selection = arbitrate_entry_candidates(exact_close_then_shadow_flip())
    assert selection.canonical_model is EntryModelV2.DIR_CLOSE
    assert selection.reason is SelectionReason.ONLY_EXACT_TRIGGER


def test_calibrated_common_setup_can_never_be_paper_eligible() -> None:
    request = calibrated_common_setup_with_exact_close_trigger()
    selection = arbitrate_entry_candidates(request)
    assert selection.reason is SelectionReason.NO_EXACT_CANDIDATE
    assert selection.action is SelectionAction.SHADOW_ONLY
```

- [ ] **Step 2: Run and verify the arbitrator is missing**

```bash
uv run pytest tests/unit/test_rd_entry_arbitrator.py -v
```

Expected: import failure for `rd_entry_arbitrator`.

- [ ] **Step 3: Implement the approved policy**

Define:

```python
from typing import Literal


@dataclass(frozen=True, slots=True)
class EntryArbitrationRequest:
    setup_id: str
    setup_invalidated: bool
    policy_version: Literal["rd-entry-arbitration-v2"]
    revision: int
    candidates: tuple[EntryCandidate, ...]
    evidence: tuple[EntryCandidateEvidence, ...]
    evaluated_at_epoch: int
```

The frozen field name `setup_invalidated` means “invalidated before the first
active-model candidate” at this arbitration boundary. The stream accumulator
sets it only from `invalidated_before_entry=True`; a later invalidation closes
matching but passes `False` here so it cannot erase the preceding valid
selection.

Derive candidate fidelity only from replayable evidence. Exact-eligible proof
planes are `CONFIRMED_5M`, `LOWER_TIMEFRAME_REPLAY`, and
`EXTERNAL_ARCHIVED_TICK`; exclude `REALTIME_TICK`, all ambiguity-coded evidence,
non-`EXACT` evidence, or evidence without an observed trigger. A candidate may
have multiple append-only exact evidence rows. Choose exactly one with this
frozen rank:

```python
def canonical_exact_evidence_rank(
    evidence: EntryCandidateEvidence,
) -> tuple[int, int, int, int, str]:
    if evidence.observed_trigger_epoch is None:
        raise ValueError("exact canonical evidence lacks a trigger")
    return (
        evidence.observed_trigger_epoch,
        evidence.proof_resolution_seconds,
        -len(evidence.htf_context_minutes),
        evidence.coverage_end_epoch,
        evidence.evidence_id,
    )
```

Group eligible evidence by candidate ID and take `min(..., key=...)` before
ranking candidates. Sort exact candidates by their canonical evidence's observed
trigger epoch, then model value, then candidate ID. The selected
`canonical_evidence_id` is always that ranked record, never whichever evidence
arrived or appeared first.

Apply in this order:

```text
invalidated -> NONE / SETUP_INVALIDATED
no active candidates -> NONE / NO_CANDIDATE
only non-exact active candidates -> SHADOW_ONLY / NO_EXACT_CANDIDATE
non-exact flip observed earlier than exact close -> PAPER_ELIGIBLE / FALLBACK_TO_CONFIRMED_CLOSE
one exact candidate with no shadow flip fallback -> PAPER_ELIGIBLE / ONLY_EXACT_TRIGGER
equal-time distinct active models -> SHADOW_ONLY / UNRESOLVED_SOURCE_PRIORITY
multiple exact candidates at distinct trigger epochs -> select the earliest /
EARLIEST_EXACT_TRIGGER
```

Set both `canonical_candidate_id` and `canonical_evidence_id` or set both to
`None`. The usual two-model ordering selects an exact `HTF_FLIP` that occurs
before the confirmed close. If an exact close is already earlier, a later flip
is still retained but cannot rewrite the earlier canonical trigger. In
particular, `FALLBACK_TO_CONFIRMED_CLOSE` requires at least one replayable
non-exact HTF-flip evidence row with a non-null observed trigger strictly earlier
than the exact close's canonical evidence. A same-time or later non-exact flip
does not retroactively create a fallback; with no other exact candidate the
reason remains `ONLY_EXACT_TRIGGER`. For this fallback test, “replayable
non-exact” excludes `REALTIME_TICK` and null-trigger evidence but deliberately
includes replay-observed ambiguity codes such as same-child order or partial
coverage. Those ambiguity codes prevent exact eligibility; they do not erase an
observed flip candidate.

- [ ] **Step 4: Run arbitration and complete domain tests**

```bash
uv run pytest tests/unit/test_rd_entry_models.py \
  tests/unit/test_rd_entry_matcher.py \
  tests/unit/test_rd_intrabar_oracle.py \
  tests/unit/test_rd_entry_arbitrator.py -v
```

Expected: all tests pass.

- [ ] **Step 5: Commit arbitration**

```bash
git add src/prop_trading/domain/rd_entry_arbitrator.py \
  tests/unit/test_rd_entry_arbitrator.py
git commit -m "feat: arbitrate RD entry candidates"
```

---

### Task 7: Build the manually reviewed oracle fixture and vectors

**Files:**
- Create: `src/prop_trading/domain/rd_entry_oracle.py`
- Create: `tests/fixtures/rd_entry_arbitration_cases_v2.json`
- Create: `contracts/vectors/rd-entry-arbitration-v2.json`
- Create: `contracts/schema/rd-entry-arbitration-vectors-v2.schema.json`
- Create: `scripts/build_rd_entry_oracle_vectors.py`
- Create: `tests/unit/test_rd_entry_oracle.py`
- Modify: `scripts/export_schemas.py`
- Modify: `Makefile`

**Interfaces:**
- Produces: `evaluate_entry_stream(case: EntryOracleCase) -> EntryOracleResult`.
- Produces: cross-language vector file consumed by the edge plan.

- [ ] **Step 1: Write a failing oracle fixture test**

```python
from __future__ import annotations

from dataclasses import replace
import json
from pathlib import Path

import pytest

from prop_trading.domain.rd_entry_oracle import (
    EntryOracleCase,
    EntryOracleEvent,
    evaluate_entry_stream,
)
from prop_trading.domain.rd_entry_models import EntryModelV2, OrderedCandle

FIXTURES = Path("tests/fixtures/rd_entry_arbitration_cases_v2.json")


def cases() -> list[dict[str, object]]:
    loaded: object = json.loads(FIXTURES.read_text(encoding="utf-8"))
    assert isinstance(loaded, dict)
    values = loaded["cases"]
    assert isinstance(values, list)
    assert all(isinstance(item, dict) for item in values)
    return values


@pytest.mark.parametrize("case", cases(), ids=lambda item: item["case_id"])
def test_reviewed_fixture_matches_oracle(case: dict[str, object]) -> None:
    parsed = EntryOracleCase.from_mapping(case)
    result = evaluate_entry_stream(parsed)
    assert result.selection.policy_version == "rd-entry-arbitration-v2"
    assert result.to_mapping() == case["expected"]


def test_fixture_count_and_expanded_transcript_surface_are_frozen() -> None:
    assert len(cases()) == 24
    assert all("htf_transcripts" in item["expected"] for item in cases())
    assert all("htf_transcripts" in item["pine_expected"] for item in cases())
    for case in cases():
        for expected_key in ("expected", "pine_expected"):
            for transcript in case[expected_key]["htf_transcripts"]:
                assert set(transcript) == {
                    "context_minutes",
                    "htf_open_epoch",
                    "htf_open_ticks",
                    "scan_cutoff_epoch",
                    "proof_resolution_seconds",
                    "coverage_start_epoch",
                    "coverage_end_epoch",
                    "expected_child_count",
                    "observed_child_count",
                    "gap_present",
                    "full_lifecycle_ordered",
                    "destination_seen_before_contact",
                    "contact_candle",
                    "recross_candle",
                    "same_child",
                }


def parsed_case(case_id: str) -> EntryOracleCase:
    return EntryOracleCase.from_mapping(
        next(item for item in cases() if item["case_id"] == case_id)
    )


def shifted_event(event: EntryOracleEvent, *, seconds: int) -> EntryOracleEvent:
    def shifted_candle(candle: OrderedCandle) -> OrderedCandle:
        return replace(
            candle,
            open_epoch=candle.open_epoch + seconds,
            close_epoch=candle.close_epoch + seconds,
        )

    setup = replace(
        event.base_match_request.setup,
        invalidated_before_entry=False,
        terminal_reason=None,
        terminal_epoch=None,
    )
    return replace(
        event,
        event_id=f"{event.event_id}-later",
        base_match_request=replace(
            event.base_match_request,
            setup=setup,
            confirmed_bar=shifted_candle(
                event.base_match_request.confirmed_bar
            ),
            htf_proofs=(),
        ),
        htf_scan_requests=tuple(
            replace(
                request,
                setup=setup,
                htf_open_epoch=request.htf_open_epoch + seconds,
                scan_cutoff_epoch=request.scan_cutoff_epoch + seconds,
                children=tuple(shifted_candle(item) for item in request.children),
            )
            for request in event.htf_scan_requests
        ),
    )


@pytest.mark.parametrize(
    ("case_id", "model"),
    [
        ("dir-close-later", EntryModelV2.DIR_CLOSE),
        ("htf-flip-15m", EntryModelV2.HTF_FLIP),
    ],
)
def test_first_semantic_candidate_per_model_wins(
    case_id: str,
    model: EntryModelV2,
) -> None:
    source = parsed_case(case_id)
    first = replace(
        source.events[0],
        base_match_request=replace(
            source.events[0].base_match_request,
            setup=replace(
                source.events[0].base_match_request.setup,
                invalidated_before_entry=False,
                terminal_reason=None,
                terminal_epoch=None,
            ),
        ),
    )
    two_events = replace(
        source,
        events=(first, shifted_event(first, seconds=3_600)),
        setup_invalidated=False,
    )
    first_only = evaluate_entry_stream(replace(two_events, events=(first,)))
    result = evaluate_entry_stream(two_events)

    assert tuple(item for item in result.candidates if item.model is model) == tuple(
        item for item in first_only.candidates if item.model is model
    )


def test_later_same_id_htf_candidate_with_changed_content_is_suppressed() -> None:
    source = parsed_case("htf-flip-15m")
    first, later = two_recross_events_in_same_htf_boundary(source.events[0])
    first_match = match_event(first)
    later_match = match_event(later)
    assert first_match.candidates[0].candidate_id == later_match.candidates[0].candidate_id
    assert first_match.candidates[0] != later_match.candidates[0]

    first_only = evaluate_entry_stream(
        replace(source, events=(first,), setup_invalidated=False)
    )
    accumulated = evaluate_entry_stream(
        replace(source, events=(first, later), setup_invalidated=False)
    )
    assert accumulated.candidates == first_only.candidates
    assert accumulated.evidence == first_only.evidence
    assert accumulated.handling == first_only.handling


def test_next_candle_counter_wick_is_handling_only() -> None:
    result = evaluate_entry_stream(parsed_case("next-candle-wick-handling"))
    wick = [
        item
        for item in result.handling
        if item.handling_mode is HandlingMode.NEXT_CANDLE_WICK
    ]
    close = next(
        item for item in result.candidates
        if item.model is EntryModelV2.DIR_CLOSE
    )
    assert len(wick) == 1
    assert wick[0].candidate_id == close.candidate_id
    assert wick[0].fidelity is CandidateFidelity.DISCRETIONARY
    assert wick[0].source_claim_ids == NEXT_CANDLE_WICK_SOURCE_CLAIMS
    assert len(result.candidates) == 1


@pytest.mark.parametrize(
    "case",
    [
        next_candle_long_case(low_equals_open=True),
        next_candle_short_case(high_equals_open=True),
        second_later_candle_only_wicks_case(),
    ],
)
def test_absent_immediate_strict_counter_wick_emits_no_wick_handling(
    case: EntryOracleCase,
) -> None:
    result = evaluate_entry_stream(case)
    assert all(
        item.handling_mode is not HandlingMode.NEXT_CANDLE_WICK
        for item in result.handling
    )


def test_close_that_completes_both_gets_one_handling_only_grace() -> None:
    case = both_models_close_terminal_then_wick_case()
    result = evaluate_entry_stream(case)
    assert {item.model for item in result.candidates} == {
        EntryModelV2.DIR_CLOSE,
        EntryModelV2.HTF_FLIP,
    }
    assert len(
        [
            item
            for item in result.handling
            if item.handling_mode is HandlingMode.NEXT_CANDLE_WICK
        ]
    ) == 1
    assert result.selection == evaluate_entry_stream(
        replace(case, events=case.events[:-1])
    ).selection


def test_terminal_handling_grace_rejects_trigger_input_or_a_third_event() -> None:
    case = both_models_close_terminal_then_wick_case()
    with pytest.raises(ValueError):
        evaluate_entry_stream(
            replace(
                case,
                events=(
                    *case.events,
                    handling_grace_event_after(case.events[-1]),
                ),
            )
        )
    with pytest.raises(ValueError):
        evaluate_entry_stream(
            replace(
                case,
                events=(
                    case.events[0],
                    case.events[1],
                    with_generic_break(case.events[-1]),
                ),
            )
        )
```

Add focused stream tests proving that invalidation before any active candidate
sets `setup_invalidated=True` and selects `NONE`, while invalidation after one
active candidate sets `invalidated_before_entry=False`, emits no candidate on
the invalidation event, preserves the earlier candidate/evidence, and keeps its
canonical selection. Also prove a nonterminal event that completes both active
models and a delayed `BOTH_ACTIVE_MODELS_OBSERVED` fact are rejected. The helper
`both_models_close_terminal_then_wick_case()` must freeze the opposite ordering:
an exact HTF candidate already exists, the next event introduces `DIR_CLOSE`
and terminalizes the attempt, and one contiguous bar follows solely for wick
handling. Also prove an invalidation/retention terminal has no grace and a
non-contiguous first post-terminal bar consumes the grace without searching a
later candle.

The fixture must contain these 24 named cases:

```text
dir-close-engagement
dir-close-later
pre-entry-invalidation
htf-flip-15m
htf-flip-30m
htf-flip-60m
htf-flip-multi-context
htf-flip-distinct-children
htf-flip-same-child-ambiguous
htf-flip-missing-coverage
htf-flip-partial-coverage
exact-flip-then-close
exact-close-then-later-flip
shadow-flip-then-close-fallback
non-exact-only
generic-break-rejected
htf-break-normalized
rejection-respect-rejected
next-candle-wick-handling
initial-attempt
re-entry-attempt
replay-realtime-one-candidate
duplicate-event-idempotent
out-of-order-events-deterministic
```

Every candle uses integer ticks and integer epochs. The re-entry case exercises
the domain contract only: it uses a distinct attempt-scoped setup ID,
`attempt_kind=RE_ENTRY`, and `trigger_ordinal=2`, and is never appended to the
initial attempt's event stream. V3 Pine remains `INITIAL`/ordinal `1` only.
Freeze `htf-flip-partial-coverage` as the contact → missing child slice → later
recross case. The gap clears retained contact state; a later recross without a
new post-gap contact cannot match or synthesize a candidate. If a new contact
and recross are subsequently observed, the proof remains `UNRESOLVED` because
the lifecycle contains a permanent coverage gap.
Every fixture input and expected selection sets `policy_version` to exactly
`rd-entry-arbitration-v2`; the generated vector builder rejects any other value.
Each fixture also contains a manually reviewed `pine_expected` object. It is the
expected result for the same market events after replacing only inherited
`setup.common_fidelity` with `UNRESOLVED`, matching the current V2-derived V3
producer. The ordinary `expected` object remains the domain/edge result for the
fixture's declared fidelity and continues to cover hypothetical complete
`EXACT` common provenance. These are two explicit oracle views, not an ignored
comparison field or a Pine-only paper override.

- [ ] **Step 2: Run and verify oracle imports fail**

```bash
uv run pytest tests/unit/test_rd_entry_oracle.py -v
```

Expected: import failure for `rd_entry_oracle`.

- [ ] **Step 3: Implement oracle composition without duplicating rules**

```python
from dataclasses import dataclass, replace
from typing import Literal


@dataclass(frozen=True, slots=True)
class EntryOracleEvent:
    event_id: str
    base_match_request: EntryMatchRequest
    htf_scan_requests: tuple[HTFFlipScanRequest, ...]


@dataclass(frozen=True, slots=True)
class EntryOracleCase:
    case_id: str
    setup_id: str
    symbol: str
    feed: str
    calculation_start_epoch: int
    emission_start_epoch: int
    emission_end_epoch: int
    pine_supported: bool
    events: tuple[EntryOracleEvent, ...]
    setup_invalidated: bool
    policy_version: Literal["rd-entry-arbitration-v2"]
    revision: int
    evaluated_at_epoch: int

    def arbitration_request(
        self,
        *,
        setup_invalidated: bool,
        candidates: tuple[EntryCandidate, ...],
        evidence: tuple[EntryCandidateEvidence, ...],
    ) -> EntryArbitrationRequest:
        return EntryArbitrationRequest(
            setup_id=self.setup_id,
            setup_invalidated=setup_invalidated,
            policy_version=self.policy_version,
            revision=self.revision,
            candidates=candidates,
            evidence=evidence,
            evaluated_at_epoch=self.evaluated_at_epoch,
        )


@dataclass(frozen=True, slots=True)
class EntryOracleResult:
    htf_transcripts: tuple[HTFFlipProofTranscript, ...]
    candidates: tuple[EntryCandidate, ...]
    evidence: tuple[EntryCandidateEvidence, ...]
    handling: tuple[EntryHandlingObservation, ...]
    selection: EntrySelection


ACTIVE_ENTRY_MODELS = frozenset({EntryModelV2.DIR_CLOSE, EntryModelV2.HTF_FLIP})


def _next_candle_wick_handling(
    previous_event: EntryOracleEvent | None,
    current_event: EntryOracleEvent,
    directional_close: EntryCandidate | None,
    evidence_by_id: Mapping[str, EntryCandidateEvidence],
) -> EntryHandlingObservation | None:
    if previous_event is None or directional_close is None:
        return None
    previous_close = previous_event.base_match_request.confirmed_bar.close_epoch
    if directional_close.observed_at_epoch != previous_close:
        return None
    current = current_event.base_match_request.confirmed_bar
    if (
        current.open_epoch != previous_close
        or current.close_epoch != current.open_epoch + 300
    ):
        return None
    close_evidence = sorted(
        (
            item
            for item in evidence_by_id.values()
            if item.candidate_id == directional_close.candidate_id
            and item.proof_plane is ProofPlane.CONFIRMED_5M
            and item.observed_trigger_epoch == previous_close
        ),
        key=lambda item: item.evidence_id,
    )
    if not close_evidence:
        return None
    observed_ticks = (
        current.low_ticks
        if directional_close.direction is EntryDirection.LONG
        and current.low_ticks < min(current.open_ticks, current.close_ticks)
        else current.high_ticks
        if directional_close.direction is EntryDirection.SHORT
        and current.high_ticks > max(current.open_ticks, current.close_ticks)
        else None
    )
    if observed_ticks is None:
        return None
    identity = EntryHandlingIdentity(
        candidate_id=directional_close.candidate_id,
        evidence_id=close_evidence[0].evidence_id,
        handling_mode=HandlingMode.NEXT_CANDLE_WICK,
        attempt_kind=previous_event.base_match_request.attempt_kind,
        observed_epoch=current.close_epoch,
        observed_ticks=observed_ticks,
        fidelity=CandidateFidelity.DISCRETIONARY,
        source_claim_ids=NEXT_CANDLE_WICK_SOURCE_CLAIMS,
    )
    return EntryHandlingObservation(
        handling_id=handling_id(identity),
        candidate_id=identity.candidate_id,
        evidence_id=identity.evidence_id,
        handling_mode=identity.handling_mode,
        attempt_kind=identity.attempt_kind,
        observed_epoch=identity.observed_epoch,
        observed_ticks=identity.observed_ticks,
        fidelity=identity.fidelity,
        source_claim_ids=identity.source_claim_ids,
    )


def _merge_terminal_fact(
    current: tuple[SetupAttemptTerminalReason, int] | None,
    setup: SetupEntryFacts,
    *,
    confirmed_epoch: int,
    active_models_before: frozenset[EntryModelV2],
    active_models_after: frozenset[EntryModelV2],
) -> tuple[SetupAttemptTerminalReason, int] | None:
    completed_both_now = (
        not ACTIVE_ENTRY_MODELS.issubset(active_models_before)
        and ACTIVE_ENTRY_MODELS.issubset(active_models_after)
    )
    presented = (
        None
        if setup.terminal_reason is None
        else (setup.terminal_reason, setup.terminal_epoch)
    )
    if presented is None:
        if setup.terminal_epoch is not None or setup.invalidated_before_entry:
            raise ValueError("open setup carries terminal state")
        if completed_both_now:
            raise ValueError("both-model transition must terminalize on this event")
        return current
    if setup.terminal_epoch is None or setup.terminal_epoch != confirmed_epoch:
        raise ValueError("terminal epoch must equal the confirmed event epoch")
    if current is not None:
        if current == presented:
            return current
        raise ValueError("terminal setup fact changed")

    reason = setup.terminal_reason
    if completed_both_now and (
        reason is not SetupAttemptTerminalReason.BOTH_ACTIVE_MODELS_OBSERVED
    ):
        raise ValueError("event completing both models has wrong terminal reason")
    if reason is SetupAttemptTerminalReason.INVALIDATED:
        if active_models_after != active_models_before:
            raise ValueError("invalidation event emitted a new active candidate")
        expected_before_entry = len(active_models_before) == 0
        if setup.invalidated_before_entry is not expected_before_entry:
            raise ValueError("invalidated_before_entry disagrees with prior candidates")
    elif setup.invalidated_before_entry:
        raise ValueError("non-invalidation terminal cannot be invalidated_before_entry")
    if (
        reason is SetupAttemptTerminalReason.BOTH_ACTIVE_MODELS_OBSERVED
        and not completed_both_now
    ):
        raise ValueError("both-model terminal is not the exact completion event")
    return (reason, setup.terminal_epoch)


def evaluate_entry_stream(case: EntryOracleCase) -> EntryOracleResult:
    htf_transcripts_by_context: dict[int, HTFFlipProofTranscript] = {}
    candidates_by_id: dict[str, EntryCandidate] = {}
    candidates_by_model: dict[EntryModelV2, EntryCandidate] = {}
    evidence_by_id: dict[str, EntryCandidateEvidence] = {}
    handling_by_id: dict[str, EntryHandlingObservation] = {}
    events_by_id: dict[str, EntryOracleEvent] = {}
    for event in case.events:
        _merge_immutable(events_by_id, (event,), key="event_id")
    ordered_events = tuple(
        sorted(
            events_by_id.values(),
            key=lambda item: (
                item.base_match_request.confirmed_bar.close_epoch,
                item.event_id,
            ),
        )
    )
    terminal_fact: tuple[SetupAttemptTerminalReason, int] | None = None
    terminal_wick_grace_from: EntryOracleEvent | None = None
    terminal_wick_grace_consumed = False
    previous_event: EntryOracleEvent | None = None
    for event in ordered_events:
        if terminal_fact is not None:
            if terminal_wick_grace_from is None or terminal_wick_grace_consumed:
                raise ValueError("new trigger event after terminal setup fact")
            presented = (
                event.base_match_request.setup.terminal_reason,
                event.base_match_request.setup.terminal_epoch,
            )
            if presented != terminal_fact:
                raise ValueError("post-terminal handling event changed terminal fact")
            if (
                event.base_match_request.htf_proofs
                or event.htf_scan_requests
                or event.base_match_request.generic_break_detected
                or event.base_match_request.rejection_respect_detected
                or event.base_match_request.setup
                != terminal_wick_grace_from.base_match_request.setup
                or event.base_match_request.attempt_kind
                is not terminal_wick_grace_from.base_match_request.attempt_kind
                or event.base_match_request.trigger_ordinal
                != terminal_wick_grace_from.base_match_request.trigger_ordinal
            ):
                raise ValueError("post-terminal grace contains trigger input")
            wick_handling = _next_candle_wick_handling(
                terminal_wick_grace_from,
                event,
                candidates_by_model.get(EntryModelV2.DIR_CLOSE),
                evidence_by_id,
            )
            if wick_handling is not None:
                _merge_immutable(
                    handling_by_id,
                    (wick_handling,),
                    key="handling_id",
                )
            terminal_wick_grace_consumed = True
            previous_event = event
            continue
        wick_handling = _next_candle_wick_handling(
            previous_event,
            event,
            candidates_by_model.get(EntryModelV2.DIR_CLOSE),
            evidence_by_id,
        )
        if wick_handling is not None:
            _merge_immutable(
                handling_by_id,
                (wick_handling,),
                key="handling_id",
            )
        active_models_before = frozenset(candidates_by_model) & ACTIVE_ENTRY_MODELS
        if (
            event.base_match_request.htf_proofs
            and event.htf_scan_requests
        ):
            raise ValueError("event mixes raw scans with expanded HTF proofs")
        proofs = (
            event.base_match_request.htf_proofs
            if event.base_match_request.htf_proofs
            else tuple(
                scan_htf_flip(request)
                for request in event.htf_scan_requests
            )
        )
        for proof in proofs:
            _upsert_latest_htf_transcript(
                htf_transcripts_by_context,
                proof.transcript,
            )
        match_result = match_entry_candidates(
            replace(event.base_match_request, htf_proofs=proofs)
        )
        accepted_candidate_ids: set[str] = set()
        for candidate in match_result.candidates:
            existing = candidates_by_model.get(candidate.model)
            if existing is not None:
                if existing != candidate:
                    continue
                accepted_candidate_ids.add(existing.candidate_id)
                continue
            _merge_immutable(candidates_by_id, (candidate,), key="candidate_id")
            candidates_by_model[candidate.model] = candidate
            accepted_candidate_ids.add(candidate.candidate_id)
        _merge_immutable(
            evidence_by_id,
            tuple(
                item
                for item in match_result.evidence
                if item.candidate_id in accepted_candidate_ids
            ),
            key="evidence_id",
        )
        _merge_immutable(
            handling_by_id,
            tuple(
                item
                for item in match_result.handling
                if item.candidate_id in accepted_candidate_ids
            ),
            key="handling_id",
        )
        active_models_after = frozenset(candidates_by_model) & ACTIVE_ENTRY_MODELS
        dir_close_introduced_now = (
            EntryModelV2.DIR_CLOSE not in active_models_before
            and EntryModelV2.DIR_CLOSE in active_models_after
        )
        terminal_fact = _merge_terminal_fact(
            terminal_fact,
            event.base_match_request.setup,
            confirmed_epoch=event.base_match_request.confirmed_bar.close_epoch,
            active_models_before=active_models_before,
            active_models_after=active_models_after,
        )
        if (
            terminal_fact is not None
            and terminal_fact[0]
            is SetupAttemptTerminalReason.BOTH_ACTIVE_MODELS_OBSERVED
            and dir_close_introduced_now
        ):
            terminal_wick_grace_from = event
        previous_event = event

    candidates = tuple(sorted(candidates_by_id.values(), key=lambda item: item.candidate_id))
    evidence = tuple(sorted(evidence_by_id.values(), key=lambda item: item.evidence_id))
    handling = tuple(sorted(handling_by_id.values(), key=lambda item: item.handling_id))
    accumulated_invalidated = (
        terminal_fact is not None
        and terminal_fact[0] is SetupAttemptTerminalReason.INVALIDATED
        and len(frozenset(candidates_by_model) & ACTIVE_ENTRY_MODELS) == 0
    )
    if case.setup_invalidated is not accumulated_invalidated:
        raise ValueError("case setup_invalidated disagrees with terminal fact")
    selection = arbitrate_entry_candidates(
        case.arbitration_request(
            setup_invalidated=accumulated_invalidated,
            candidates=candidates,
            evidence=evidence,
        )
    )
    return EntryOracleResult(
        htf_transcripts=tuple(
            htf_transcripts_by_context[context]
            for context in sorted(htf_transcripts_by_context)
        ),
        candidates=candidates,
        evidence=evidence,
        handling=handling,
        selection=selection,
    )
```

`_next_candle_wick_handling()` freezes the only supported next-candle
observation. The window is exactly the contiguous confirmed 5m candle whose
open equals the event close that created the accepted `DIR_CLOSE` candidate and
whose close is 300 seconds later. For `LONG`, a
counter-wick exists only when that next candle has
`low_ticks < min(open_ticks, close_ticks)`; for `SHORT`, only when
`high_ticks > max(open_ticks, close_ticks)`. Equality or a body-only counter
move is no wick. Record the
adverse extreme at the next candle close, reference the original confirmed-close
candidate and evidence, set `handling_mode=NEXT_CANDLE_WICK`,
copy `attempt_kind` from the close request, set `fidelity=DISCRETIONARY`, and
attach exactly
`NEXT_CANDLE_WICK_SOURCE_CLAIMS`. It creates no candidate or evidence and never
changes arbitration. If the contiguous candle is missing or has no
counter-wick, do not look at a later candle. A market-session gap therefore
produces no next-candle handling observation.

Normally a terminal fact is the last trigger event. If the exact event that
first establishes `BOTH_ACTIVE_MODELS_OBSERVED` also introduces the accepted
`DIR_CLOSE`, set `terminal_wick_grace_from` to that event. Accept at most the
immediately following ordered event, require it to repeat the immutable terminal
fact and the same attempt kind/ordinal, require empty HTF/legacy trigger inputs,
run only `_next_candle_wick_handling()`, and do not call the matcher, transcript
updater, terminal merger, or arbitrator again. The grace is consumed even when
the next available candle is non-contiguous or contains no strict counter-wick.
Any third event, any post-terminal event for `INVALIDATED` or
`RETENTION_EVICTED`, or any trigger-bearing grace event is an error.

Implement `from_mapping()`, `to_mapping()`, and `_merge_immutable()` directly in
this step: parsing rejects floats, duplicate event IDs, unordered candles,
invalid OHLC, unknown fields, and missing expected fields; mapping uses enum
values and sorted lists only. Each manually reviewed fixture case must explicitly
provide `symbol`, `feed`, `calculation_start_epoch`, `emission_start_epoch`,
`emission_end_epoch`, and boolean `pine_supported`. Require nonempty closed
identifiers, non-negative integer epochs,
`calculation_start_epoch <= emission_start_epoch <= emission_end_epoch`, and
every emitted event close inside the inclusive emission window. These fields are
Bar Replay metadata, not matcher inputs.
`EntryOracleCase.from_edge_mapping(edge_input, *, replay_metadata)` accepts the
scanner-free `edge_input` shape frozen below plus those seven top-level replay
fields, creates events with empty
`htf_scan_requests`, and parses every bounded `match_request.htf_proofs[]`
transcript through `validate_htf_flip_transcript()`; producer-supplied match or
fidelity flags are never trusted. `_merge_immutable()` accepts an identical duplicate
as idempotent and raises `ValueError` when the same ID carries different immutable
content. This accumulated event stream is required for a later `DIR_CLOSE` to be
arbitrated against an earlier HTF proof. Keep the first candidate for each model
per setup attempt. An identical replay of the same candidate ID is idempotent and
may append new valid evidence for that candidate; a later different candidate ID
for an already-observed model, plus its dependent evidence and handling, is
suppressed. Compare the full candidate object before its ID: once a model exists,
only a byte-for-byte/dataclass-equal candidate object is an idempotent candidate
replay whose new valid evidence may be merged. Suppress every non-identical
candidate object and all its dependents, even when the semantic ID happens to be
the same (for example, a second HTF recross at the same boundary changes
observation content without changing anchor-plus-ordinal identity). A conflicting
same-`event_id` input remains an error during event deduplication and never
reaches this suppression rule.

`_upsert_latest_htf_transcript()` keys the bounded transcript surface by
`context_minutes`, exactly like Pine. For one context, compare
`(htf_open_epoch, scan_cutoff_epoch)`: a greater pair replaces the prior
transcript, an identical pair with identical content is idempotent, an identical
pair with different content is a conflict, and a lower pair is a chronology
error. `EntryOracleResult.to_mapping()` always emits all three-or-fewer final
records as expanded `expected.htf_transcripts`, sorted by `context_minutes`,
using `HTFFlipProofTranscript.to_mapping()`. The manually reviewed fixture must
contain that key for every one of the frozen 24 cases, including `[]` when no HTF
context was scanned. The generated vector builder compares these expanded
transcripts before writing output; it never derives expected transcripts from
Pine diagnostics.

Add `_merge_terminal_fact()` beside
`_merge_immutable()`: it accepts repeated identical open or terminal facts,
permits exactly one open-to-terminal transition, and rejects terminal-to-open
or changed reason/epoch. Identical same-`event_id` replays are removed before
chronological processing and remain idempotent. `evaluate_entry_stream()` owns
the single handling-only post-terminal grace above; `_merge_terminal_fact()`
never accepts it as a new trigger event.
For `INVALIDATED`, require the event to emit no new candidate and set
`invalidated_before_entry=True` exactly when the prior active-candidate set is
empty. An invalidation after one active model retains that earlier candidate and
uses `invalidated_before_entry=False`, so arbitration does not erase a valid
result. Require `BOTH_ACTIVE_MODELS_OBSERVED` on the exact event where the
independently accumulated active-model set transitions from fewer than two
models to both `DIR_CLOSE` and `HTF_FLIP`. A nonterminal event that completes
both is invalid; a delayed `BOTH_ACTIVE_MODELS_OBSERVED` is invalid; and
`INVALIDATED` or `RETENTION_EVICTED` cannot label the event that completes both.
`RETENTION_EVICTED` remains an explicit producer lifecycle fact and is never
synthesized from elapsed time.

- [ ] **Step 4: Implement the deterministic vector builder**

Follow the repository's `--output`/`--check` convention. The builder first compares
computed output with each manually reviewed `expected` object. It then builds a
second case by replacing every event's
`match_request.setup.common_fidelity` with `UNRESOLVED`, evaluates that case,
and compares it with the manually reviewed `pine_expected` object. Only then does it
write canonical normalized vectors. Each generated case preserves the existing
raw scanner fixture under `input`, adds a scanner-free top-level `edge_input`,
adds the current-producer top-level `pine_edge_input`, and preserves both
`expected` and `pine_expected`. It also preserves these exact top-level replay fields
without deriving defaults:

```text
setup_id
symbol
feed
calculation_start_epoch
emission_start_epoch
emission_end_epoch
pine_supported
```

Set `pine_supported=true` for every case implemented by the V3 historical
producer, including `next-candle-wick-handling`. Set it to `false` for
`re-entry-attempt` and `replay-realtime-one-candidate`: re-entry is domain-only
in this increment and realtime `varip` arrival order is intentionally absent
from historical Bar Replay. No builder or Plan-3 tool may infer support from the
case name.

Every serialized `match_request` includes `attempt_kind` and
`trigger_ordinal`. The builder rejects INITIAL with any ordinal except `1`,
RE_ENTRY with an ordinal below `2`, or fixture cases that reuse one setup ID for
an initial and re-entry attempt.

Freeze `edge_input` exactly as:

```python
{
    "setup_id": case.setup_id,
    "events": [
        {
            "event_id": event.event_id,
            "match_request": replace(
                event.base_match_request,
                htf_proofs=(
                    event.base_match_request.htf_proofs
                    if event.base_match_request.htf_proofs
                    else tuple(
                        scan_htf_flip(request)
                        for request in event.htf_scan_requests
                    )
                ),
            ).to_mapping(),
        }
        for event in case.events
    ],
    "setup_invalidated": case.setup_invalidated,
    "policy_version": case.policy_version,
    "revision": case.revision,
    "evaluated_at_epoch": case.evaluated_at_epoch,
}
```

Freeze `pine_edge_input` as a deep immutable copy of `edge_input` in which the
only changed values are every
`events[].match_request.setup.common_fidelity == "UNRESOLVED"`. Reject the
builder output if any other path differs. This surface exists because current
Pine can prove entry-trigger chronology but cannot yet prove complete exact
common-setup provenance. Plan 2 consumes `edge_input`/`expected`; Plan 3 consumes
`pine_edge_input`/`pine_expected`.

The builder rejects an event that mixes pre-expanded `htf_proofs` with raw
`htf_scan_requests`. It preserves raw event order and IDs exactly, even for the
out-of-order determinism case. It then parses `edge_input` through
`EntryOracleCase.from_edge_mapping(..., replay_metadata=...)`, evaluates it, and
requires:

```python
assert (
    evaluate_entry_stream(raw_case).to_mapping()
    == evaluate_entry_stream(edge_case).to_mapping()
    == fixture_case["expected"]
)
assert (
    evaluate_entry_stream(pine_case).to_mapping()
    == fixture_case["pine_expected"]
)
```

No `children` or `htf_scan_requests` key may occur anywhere under `edge_input`;
bounded `match_request.htf_proofs[]` contain expanded transcripts, not raw child
arrays. Add a strict Pydantic vector document to the focused schema registry and
export `rd-entry-arbitration-vectors-v2.schema.json`.

Add focused tests:

```python
def test_generated_edge_input_preserves_event_ids_and_has_no_child_arrays() -> None:
    document = build_vectors(load_fixture_document())
    for raw, generated in zip(load_fixture_document()["cases"], document["cases"]):
        for key in (
            "setup_id",
            "symbol",
            "feed",
            "calculation_start_epoch",
            "emission_start_epoch",
            "emission_end_epoch",
            "pine_supported",
        ):
            assert generated[key] == raw[key]
        assert [
            event["event_id"] for event in generated["edge_input"]["events"]
        ] == [event["event_id"] for event in raw["input"]["events"]]
        assert not recursive_key_present(generated["edge_input"], "children")
        assert not recursive_key_present(
            generated["edge_input"],
            "htf_scan_requests",
        )
        assert not recursive_key_present(
            generated["pine_edge_input"],
            "children",
        )
        assert not recursive_key_present(
            generated["pine_edge_input"],
            "htf_scan_requests",
        )
        assert (
            differing_paths(
                generated["edge_input"],
                generated["pine_edge_input"],
            )
            == {
                f"events[{index}].match_request.setup.common_fidelity"
                for index, event in enumerate(generated["edge_input"]["events"])
                if event["match_request"]["setup"]["common_fidelity"]
                != "UNRESOLVED"
            }
        )


def test_edge_input_replays_to_the_same_manually_reviewed_result() -> None:
    for generated in build_vectors(load_fixture_document())["cases"]:
        edge_case = EntryOracleCase.from_edge_mapping(
            generated["edge_input"],
            replay_metadata={
                key: generated[key]
                for key in (
                    "setup_id",
                    "symbol",
                    "feed",
                    "calculation_start_epoch",
                    "emission_start_epoch",
                    "emission_end_epoch",
                    "pine_supported",
                )
            },
        )
        assert evaluate_entry_stream(edge_case).to_mapping() == generated["expected"]


def test_pine_input_replays_to_the_reviewed_fail_closed_result() -> None:
    for generated in build_vectors(load_fixture_document())["cases"]:
        pine_case = EntryOracleCase.from_edge_mapping(
            generated["pine_edge_input"],
            replay_metadata={
                key: generated[key]
                for key in (
                    "setup_id",
                    "symbol",
                    "feed",
                    "calculation_start_epoch",
                    "emission_start_epoch",
                    "emission_end_epoch",
                    "pine_supported",
                )
            },
        )
        assert all(
            event.base_match_request.setup.common_fidelity
            is CandidateFidelity.UNRESOLVED
            for event in pine_case.events
        )
        assert (
            evaluate_entry_stream(pine_case).to_mapping()
            == generated["pine_expected"]
        )
```

Run:

```bash
uv run python scripts/build_rd_entry_oracle_vectors.py \
  --fixtures tests/fixtures/rd_entry_arbitration_cases_v2.json \
  --output contracts/vectors/rd-entry-arbitration-v2.json
uv run python scripts/build_rd_entry_oracle_vectors.py \
  --fixtures tests/fixtures/rd_entry_arbitration_cases_v2.json \
  --output contracts/vectors/rd-entry-arbitration-v2.json \
  --check
```

Expected: both commands exit zero.

Generate and check the vector schema:

```bash
uv run python scripts/export_schemas.py --output-dir contracts/schema
uv run python scripts/export_schemas.py --output-dir contracts/schema --check
```

- [ ] **Step 5: Add the vector check to `verify-generated`**

Add this command to the Makefile target:

```make
	$(PYTHON) scripts/build_rd_entry_oracle_vectors.py \
		--fixtures tests/fixtures/rd_entry_arbitration_cases_v2.json \
		--output contracts/vectors/rd-entry-arbitration-v2.json --check
```

- [ ] **Step 6: Run full contract/domain verification**

```bash
uv run ruff format --check .
uv run ruff check .
uv run mypy
uv run pytest tests/contract/test_rd_strategy_rule_contract.py \
  tests/contract/test_rd_strategy_rule_contract_v2.py \
  tests/unit/test_rd_entry_models.py \
  tests/unit/test_rd_entry_matcher.py \
  tests/unit/test_rd_intrabar_oracle.py \
  tests/unit/test_rd_entry_arbitrator.py \
  tests/unit/test_rd_entry_oracle.py -v
uv run python scripts/export_schemas.py --output-dir contracts/schema --check
```

Expected: every command passes.

- [ ] **Step 7: Commit oracle vectors**

```bash
git add src/prop_trading/domain/rd_entry_oracle.py \
  tests/fixtures/rd_entry_arbitration_cases_v2.json \
  contracts/vectors/rd-entry-arbitration-v2.json \
  contracts/schema/rd-entry-arbitration-vectors-v2.schema.json \
  scripts/build_rd_entry_oracle_vectors.py \
  tests/unit/test_rd_entry_oracle.py scripts/export_schemas.py Makefile
git commit -m "test: add RD multi-entry golden oracle"
```
