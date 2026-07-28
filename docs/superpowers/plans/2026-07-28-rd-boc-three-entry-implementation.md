# RD BOC Three-Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore BOC as a first-class RD 5m entry model, evaluate BOC, directional close, and flip concurrently, select one paper trade by exact event chronology, and explain the result in the operations console.

**Architecture:** Contract version 3 and a Python oracle freeze the corrected model domain and golden arbitration behavior. A versioned TypeScript edge path validates TradingView event bundles, mirrors the oracle, persists immutable candidate/selection facts, and creates at most one broker-free paper intent. A separate Pine v3 producer emits all candidate events, while the Next.js console reads a bounded decision API and displays the selected and competing models.

**Tech Stack:** Python 3.12, Pydantic 2.11, pytest 8.4, Pine Script v6, TypeScript 5.9, Cloudflare Workers/D1, Vitest 4.1, Next.js 16, React 19

## Global Constraints

- Strategy scope is RD Forex/RD Concepts 5-minute behavior only.
- Contract ID is exactly `rd-5m-video-contract-v3`.
- Contract version is exactly `3.0.0`.
- Producer strategy version is exactly `3.0.0-contract3`.
- Arbitration policy version is exactly `rd-entry-arbitration-v3`.
- Active entry models are exactly `BOC`, `DIR_CLOSE`, and `HTF_FLIP`.
- `LEGACY_BREAK_CANDLE` and `LEGACY_REJECTION_RESPECT` remain readable only in version 2 records.
- A version 3 BOC is never normalized into `HTF_FLIP`.
- Strict BOC is paper-eligible only on the first 5m child of a newly opened 15m, 30m, or 60m candle with exact ordered evidence.
- Non-HTF discretionary 5m BOC is always `SHADOW_ONLY` with reason `BOC_DISCRETIONARY_CONTEXT_UNQUANTIFIED`.
- `DIR_CLOSE` is paper-eligible from an exact confirmed 5m close after engagement.
- `HTF_FLIP` is paper-eligible only from an exact ordered HTF contact-and-open-recross lifecycle.
- `REALTIME_TICK` may be paper-eligible only when marked `LIVE_EXACT_NON_REPLAYABLE` and received from a realtime Pine execution.
- Realtime evidence is never presented as replayable historical proof.
- Paper eligibility requires exact common-setup evidence and reviewed nonzero detector/settings hashes that match the deployed edge configuration.
- Earliest exact eligible semantic trigger wins; there is no universal BOC-versus-flip rank.
- An atomic same-event BOC/flip co-trigger creates one paper trade and retains both model identities.
- One `setup_id + attempt_kind` creates at most one economic paper intent.
- A selected economic decision is immutable; later candidates are retained as `NOT_SELECTED_ALREADY_OPEN`.
- First touch records `ZONE_ENGAGED`, never an entry.
- Existing version 1 and version 2 observation records and APIs remain readable.
- New wire and database structures are additive and versioned.
- Paper accounts are selected only from `RD_ENTRY_PAPER_ACCOUNT_IDS`; risk is bounded by `RD_ENTRY_PAPER_RISK_BPS` in the inclusive range `1..500`.
- No broker credential, order command, live-order route, or live-account action is introduced.
- Every task follows test-first development and ends with a focused commit.

---

## File structure

### Contract and Python oracle

- `config/phase0/rd-strategy-rule-contract-v3.json` — frozen source claims, BOC split, three-model policy, and paper-only constraints.
- `contracts/schema/rd-strategy-rule-contract-v3.schema.json` — generated JSON Schema for contract v3.
- `src/prop_trading/contracts/rd_strategy_v3.py` — strict Pydantic model and cross-reference validation.
- `src/prop_trading/domain/rd_entry_models_v3.py` — immutable v3 candidate, proof, evidence, selection, and identity types.
- `src/prop_trading/domain/rd_entry_matcher_v3.py` — model-specific BOC, directional-close, and flip matching.
- `src/prop_trading/domain/rd_entry_arbitrator_v3.py` — chronology, co-trigger, shadow, and decision-freeze rules.
- `src/prop_trading/contracts/rd_entry_vectors_v3.py` — strict golden-vector loader.
- `scripts/build_rd_entry_oracle_vectors_v3.py` — deterministic v3 vector generator.
- `tests/fixtures/rd_entry_arbitration_cases_v3.json` — reviewed positive, negative, co-trigger, and freeze cases.
- `contracts/vectors/rd-entry-arbitration-v3.json` — generated cross-language oracle.

### Edge producer contract and authority

- `apps/observation-edge/src/rd-entry-domain-v3.ts` — TypeScript mirror of v3 identities and values.
- `apps/observation-edge/src/rd-entry-matcher-v3.ts` — authoritative edge matcher.
- `apps/observation-edge/src/rd-entry-arbitrator-v3.ts` — authoritative edge arbitration.
- `apps/observation-edge/src/rd-entry-wire-v3.ts` — strict unchunked event-bundle parser.
- `apps/observation-edge/src/rd-entry-vector-contract-v3.ts` — golden-vector parser for Vitest.
- `apps/observation-edge/src/rd-entry-store-v3.ts` — append-only v3 persistence and paper-decision bridge.
- `apps/observation-edge/src/rd-entry-queries-v3.ts` — parameterized v3 writes and bounded decision reads.
- `apps/observation-edge/migrations/0024_observation_entries_v3.sql` — versioned v3 event, candidate, evidence, selection, paper-link, and shadow-position tables.

### TradingView producer

- `scripts/pinescript/SND_RD_5M_V3_THREE_ENTRY_LAB.pine` — separate contract-v3 alert producer.
- `tests/static/test_rd_three_entry_pine.py` — source invariants, versioning, realtime gates, and payload limits.
- `apps/observation-edge/test/rd-entry-pine-v3-parity.test.ts` — compact alert fixtures versus edge authority.

### API and console

- `apps/observation-edge/src/index.ts` — route v3 ingress and bounded read API.
- `apps/operations-console/src/lib/entry-decisions.ts` — strict decision response types and parser.
- `apps/operations-console/src/components/EntryDecisionPanel.tsx` — selected/competing model UI.
- `apps/operations-console/src/components/FoundationDashboard.tsx` — panel integration.
- `apps/operations-console/src/components/PaperSimulationPanel.tsx` — selected-model context on paper positions.
- `docs/runbooks/rd-three-entry-paper-rollout.md` — deployment, TradingView alert, smoke-test, and rollback procedure.

---

### Task 1: Freeze contract version 3 and the corrected source claims

**Files:**

- Create: `config/phase0/rd-strategy-rule-contract-v3.json`
- Create: `src/prop_trading/contracts/rd_strategy_v3.py`
- Create: `tests/contract/test_rd_strategy_rule_contract_v3.py`
- Modify: `src/prop_trading/contracts/schema_registry.py`
- Modify: `scripts/export_schemas.py`
- Modify: `tests/contract/test_contracts.py`
- Modify: `scripts/assert_frozen_specs.py`
- Modify: `Makefile`
- Generate: `contracts/schema/rd-strategy-rule-contract-v3.schema.json`

**Interfaces:**

- Consumes: frozen v2 source catalog and the approved design at `docs/superpowers/specs/2026-07-28-rd-boc-three-entry-arbitration-design.md`.
- Produces: `RDStrategyRuleContractV3`, `load_rd_strategy_contract_v3()`, rule IDs `ENTRY_BOC_HTF_TIMED` and `ENTRY_BOC_DISCRETIONARY_5M`, and the exact three-model automation policy.

- [ ] **Step 1: Write failing v3 contract tests**

Add tests that load the new JSON through Pydantic and reject every unsafe mutation:

```python
def test_v3_contract_restores_boc_as_a_distinct_active_model() -> None:
    contract = load_rd_strategy_contract_v3()

    assert contract.contract_version == "3.0.0"
    assert contract.producer_strategy_version == "3.0.0-contract3"
    assert contract.automation_policy.active_entry_models == (
        "BOC",
        "DIR_CLOSE",
        "HTF_FLIP",
    )
    assert contract.automation_policy.arbitration_policy_version == (
        "rd-entry-arbitration-v3"
    )
    assert contract.rules_by_id["ENTRY_BOC_HTF_TIMED"].automation == "PAPER_EVALUATE"
    assert (
        contract.rules_by_id["ENTRY_BOC_DISCRETIONARY_5M"].automation
        == "SHADOW_ONLY"
    )


@pytest.mark.parametrize(
    ("path", "value"),
    [
        (("automation_policy", "real_execution_allowed"), True),
        (
            ("automation_policy", "active_entry_models"),
            ["DIR_CLOSE", "HTF_FLIP"],
        ),
        (
            ("rules_by_id", "ENTRY_BOC_DISCRETIONARY_5M", "automation"),
            "PAPER_EVALUATE",
        ),
    ],
)
def test_v3_contract_rejects_unsafe_mutations(
    path: tuple[str, ...],
    value: object,
) -> None:
    payload = json.loads(CONTRACT_PATH.read_text())
    target = payload
    for key in path[:-1]:
        target = target[key]
    target[path[-1]] = value

    with pytest.raises(ValidationError):
        RDStrategyRuleContractV3.model_validate(payload)
```

- [ ] **Step 2: Run the contract tests and verify failure**

Run:

```bash
uv run pytest tests/contract/test_rd_strategy_rule_contract_v3.py -v
```

Expected: collection fails because `rd_strategy_v3` and the v3 JSON do not exist.

- [ ] **Step 3: Implement the strict Pydantic contract**

Create closed literals and exact-set validation:

```python
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


class RDStrategyRuleContractV3(ContractModel):
    schema_id: Literal["phase0.rd-strategy-rule-contract.v3"]
    contract_id: Literal["rd-5m-video-contract-v3"]
    contract_version: Literal["3.0.0"]
    producer_strategy_version: Literal["3.0.0-contract3"]
    strategy_id: Literal["rd_liquidity_sd_5m_v1"]
    confirmed_timeframe_minutes: Literal[5]
    sources_by_id: dict[Identifier, RDStrategySourceV3]
    claims_by_id: dict[Identifier, RDStrategySourceClaimV3]
    rules_by_id: dict[Identifier, RDEntryRuleV3]
    automation_policy: RDStrategyAutomationPolicyV3

    @model_validator(mode="after")
    def _closed_v3_contract(self) -> Self:
        if set(self.rules_by_id) != REQUIRED_V3_RULE_IDS:
            raise ValueError("v3 entry rule set is not exact")
        if self.automation_policy.active_entry_models != (
            "BOC",
            "DIR_CLOSE",
            "HTF_FLIP",
        ):
            raise ValueError("v3 active entry model order is not exact")
        if (
            self.rules_by_id["ENTRY_BOC_DISCRETIONARY_5M"].automation
            != "SHADOW_ONLY"
        ):
            raise ValueError("discretionary 5m BOC must remain shadow-only")
        return self
```

Use source claims:

```text
discretionary-break-2025-11 -> UqYlKtPjKvY, 144..229
reject-non-htf-break-2026-05 -> lo_7HDQK9WM, 4388..4395
htf-timed-boc-2026-06 -> zglv2r9xXnE, 679..694
```

Do not retain the erroneous claim name `break-normalized-to-flip-2026-06` in
contract v3.

- [ ] **Step 4: Add the exact v3 JSON contract**

The contract policy and BOC rules must contain these values:

```json
{
  "contract_id": "rd-5m-video-contract-v3",
  "contract_version": "3.0.0",
  "producer_strategy_version": "3.0.0-contract3",
  "rules_by_id": {
    "ENTRY_BOC_HTF_TIMED": {
      "category": "ENTRY",
      "fidelity": "EXACT",
      "automation": "PAPER_EVALUATE",
      "proof_eligibility": "ORDERED_EXACT",
      "source_claim_ids": [
        "discretionary-break-2025-11",
        "reject-non-htf-break-2026-05",
        "htf-timed-boc-2026-06"
      ]
    },
    "ENTRY_BOC_DISCRETIONARY_5M": {
      "category": "ENTRY",
      "fidelity": "DISCRETIONARY",
      "automation": "SHADOW_ONLY",
      "proof_eligibility": "NOT_ELIGIBLE",
      "source_claim_ids": ["discretionary-break-2025-11"]
    }
  },
  "automation_policy": {
    "paper_only": true,
    "real_execution_allowed": false,
    "first_touch_action": "ZONE_ENGAGED",
    "required_selection_fidelity": "EXACT",
    "required_common_setup_fidelity": "EXACT",
    "arbitration_policy_version": "rd-entry-arbitration-v3",
    "realtime_evidence_action": "LIVE_EXACT_NON_REPLAYABLE",
    "active_entry_models": ["BOC", "DIR_CLOSE", "HTF_FLIP"],
    "htf_context_minutes": [15, 30, 60]
  }
}
```

Copy all still-valid common qualification claim references from v2 rather than
changing setup qualification in this task.

- [ ] **Step 5: Register and generate the schema**

Add `RDStrategyRuleContractV3` to `SCHEMA_MODELS`, then run:

```bash
uv run python scripts/export_schemas.py --output-dir contracts/schema
uv run pytest tests/contract/test_rd_strategy_rule_contract_v3.py \
  tests/contract/test_contracts.py -v
```

Expected: all selected tests pass and
`contracts/schema/rd-strategy-rule-contract-v3.schema.json` is generated.

- [ ] **Step 6: Verify formatting, static checks, and generated-file stability**

Run:

```bash
uv run ruff format src/prop_trading/contracts/rd_strategy_v3.py \
  tests/contract/test_rd_strategy_rule_contract_v3.py
uv run ruff check src/prop_trading/contracts/rd_strategy_v3.py \
  tests/contract/test_rd_strategy_rule_contract_v3.py
uv run mypy
uv run python scripts/export_schemas.py --output-dir contracts/schema --check
git diff --check
```

Expected: every command succeeds.

- [ ] **Step 7: Commit the contract**

```bash
git add config/phase0/rd-strategy-rule-contract-v3.json \
  contracts/schema/rd-strategy-rule-contract-v3.schema.json \
  src/prop_trading/contracts/rd_strategy_v3.py \
  src/prop_trading/contracts/schema_registry.py \
  scripts/export_schemas.py scripts/assert_frozen_specs.py Makefile \
  tests/contract/test_rd_strategy_rule_contract_v3.py \
  tests/contract/test_contracts.py
git commit -m "feat: freeze RD three-entry contract v3"
```

---

### Task 2: Build the Python BOC matcher and chronological oracle

**Files:**

- Create: `src/prop_trading/domain/rd_entry_models_v3.py`
- Create: `src/prop_trading/domain/rd_entry_matcher_v3.py`
- Create: `src/prop_trading/domain/rd_entry_arbitrator_v3.py`
- Create: `src/prop_trading/contracts/rd_entry_vectors_v3.py`
- Create: `scripts/build_rd_entry_oracle_vectors_v3.py`
- Create: `tests/fixtures/rd_entry_arbitration_cases_v3.json`
- Create: `tests/unit/test_rd_entry_models_v3.py`
- Create: `tests/unit/test_rd_entry_matcher_v3.py`
- Create: `tests/unit/test_rd_entry_arbitrator_v3.py`
- Create: `tests/unit/test_rd_entry_oracle_v3.py`
- Generate: `contracts/vectors/rd-entry-arbitration-v3.json`
- Modify: `Makefile`

**Interfaces:**

- Consumes: `RDStrategyRuleContractV3`.
- Produces: `EntryModelV3`, `BocTier`, `BocProof`, `EntryCandidateV3`, `EntryCandidateEvidenceV3`, `EntrySelectionV3`, `match_entry_candidates_v3()`, and `arbitrate_entry_candidates_v3()`.

- [ ] **Step 1: Write failing immutable-model and identity tests**

Test the closed enum, BOC reference requirements, and identity separation:

```python
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
```

- [ ] **Step 2: Run the model tests and verify failure**

Run:

```bash
uv run pytest tests/unit/test_rd_entry_models_v3.py -v
```

Expected: import failure for `rd_entry_models_v3`.

- [ ] **Step 3: Implement v3 immutable types and canonical IDs**

Use these closed values:

```python
class EntryModelV3(StrEnum):
    BOC = "BOC"
    DIR_CLOSE = "DIR_CLOSE"
    HTF_FLIP = "HTF_FLIP"


class BocTier(StrEnum):
    HTF_TIMED = "HTF_TIMED"
    DISCRETIONARY_5M = "DISCRETIONARY_5M"


class EvidenceReplayability(StrEnum):
    REPLAYABLE = "REPLAYABLE"
    LIVE_EXACT_NON_REPLAYABLE = "LIVE_EXACT_NON_REPLAYABLE"


@dataclass(frozen=True, slots=True)
class BocProof:
    reference_candle: OrderedCandle
    trigger_candle_open_epoch: int
    trigger_epoch: int
    trigger_sequence: int
    trigger_ticks: int
    htf_boundary_epoch: int | None
    htf_context_minutes: tuple[int, ...]
    proof_plane: ProofPlane
    replayability: EvidenceReplayability
    fidelity: CandidateFidelity
    coverage_start_epoch: int
    coverage_end_epoch: int
    is_realtime: bool
```

Enforce:

```python
if model is EntryModelV3.BOC:
    if boc_tier is None or reference_candle_open_epoch is None:
        raise ValueError("BOC identity requires tier and reference candle")
elif boc_tier is not None or reference_candle_open_epoch is not None:
    raise ValueError("non-BOC identity cannot carry BOC fields")
```

Add `trigger_sequence`, `replayability`, `boc_tier`, reference OHLC, and
`co_triggered_models` to the canonical evidence/selection payloads so Python and
TypeScript hash the same fields.

- [ ] **Step 4: Write failing BOC matcher tests**

Cover long/short symmetry, HTF boundary eligibility, discretionary shadow,
wrong-direction breaks, pre-engagement events, and realtime/replay labeling:

```python
def test_strict_short_boc_matches_on_first_htf_child() -> None:
    result = match_entry_candidates_v3(
        request(
            direction=EntryDirection.SHORT,
            reference=bar(open_epoch=900, high=110, low=100, close=102),
            boc_proof=boc(
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
    assert evidence.failed_rule_ids == (
        "BOC_DISCRETIONARY_CONTEXT_UNQUANTIFIED",
    )


def test_unresolved_common_setup_blocks_every_entry_model() -> None:
    result = match_entry_candidates_v3(
        request(
            common_fidelity=CandidateFidelity.UNRESOLVED,
            boc_proof=strict_boc_proof(),
            directional_close=True,
            htf_flip_proof=exact_flip_proof(),
        )
    )

    assert {candidate.state for candidate in result.candidates} == {
        CandidateState.BLOCKED
    }
    assert all(
        "COMMON_SETUP_NOT_EXACT" in evidence.failed_rule_ids
        for evidence in result.evidence
    )
```

- [ ] **Step 5: Implement `match_entry_candidates_v3()`**

Use explicit directional and boundary checks:

```python
def _boc_breaks_reference(direction: EntryDirection, proof: BocProof) -> bool:
    if direction is EntryDirection.LONG:
        return proof.trigger_ticks > proof.reference_candle.high_ticks
    return proof.trigger_ticks < proof.reference_candle.low_ticks


def _strict_boc_context(proof: BocProof) -> bool:
    return (
        proof.htf_boundary_epoch == proof.trigger_candle_open_epoch
        and bool(proof.htf_context_minutes)
        and all(context in {15, 30, 60} for context in proof.htf_context_minutes)
        and all(
            proof.htf_boundary_epoch % (context * 60) == 0
            for context in proof.htf_context_minutes
        )
    )
```

The matcher must emit BOC, close, and flip independently. It must not suppress a
BOC because flip also matches. Realtime BOC/flip evidence is exact only when
`is_realtime` is true and replayability is
`LIVE_EXACT_NON_REPLAYABLE`; otherwise it is blocked.

Before any model-specific rule can pass, require
`request.setup.common_fidelity is CandidateFidelity.EXACT`. Retain blocked
candidates with failed rule `COMMON_SETUP_NOT_EXACT` so a missing common gate is
visible rather than silently discarded.

- [ ] **Step 6: Write failing chronology, co-trigger, and freeze tests**

```python
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


def test_opened_selection_cannot_be_replaced() -> None:
    opened = exact_selection(model=EntryModelV3.DIR_CLOSE, revision=1)
    selection = arbitrate_entry_candidates_v3(
        arbitration(
            exact_boc(trigger_epoch=900, sequence=1),
            opened_selection=opened,
        )
    )

    assert selection == opened
```

- [ ] **Step 7: Implement chronological arbitration**

Rank exact candidates with:

```python
def _event_key(evidence: EntryCandidateEvidenceV3) -> tuple[int, int]:
    if evidence.observed_trigger_epoch is None:
        raise ValueError("eligible evidence requires a trigger epoch")
    return (evidence.observed_trigger_epoch, evidence.trigger_sequence)


eligible.sort(
    key=lambda pair: (
        *_event_key(pair.evidence),
        pair.candidate.candidate_id,
    )
)
```

When every eligible candidate sharing the earliest event key has more than one
model, set:

```python
reason = SelectionReason.CO_TRIGGER_SAME_EVENT
co_triggered_models = tuple(sorted(models, key=lambda model: model.value))
canonical = min(earliest, key=lambda pair: pair.candidate.candidate_id)
```

The candidate-ID tie-break is reporting-only. All co-trigger candidates must have
the same trigger ticks; otherwise return `SHADOW_ONLY` with
`CO_TRIGGER_PRICE_CONFLICT`.

- [ ] **Step 8: Add reviewed fixtures and generate v3 golden vectors**

The fixture must include at least these named cases:

```json
[
  "strict_long_boc_only",
  "strict_short_boc_only",
  "discretionary_boc_shadow",
  "boc_before_close",
  "flip_before_boc",
  "boc_flip_same_event",
  "same_event_price_conflict",
  "close_fallback_after_blocked_aggressive_models",
  "realtime_claim_not_realtime",
  "boc_wrong_direction",
  "boc_before_engagement",
  "opened_selection_is_frozen",
  "invalidated_setup_none"
]
```

Generate and verify:

```bash
uv run python scripts/build_rd_entry_oracle_vectors_v3.py \
  --fixtures tests/fixtures/rd_entry_arbitration_cases_v3.json \
  --output contracts/vectors/rd-entry-arbitration-v3.json
uv run pytest tests/unit/test_rd_entry_models_v3.py \
  tests/unit/test_rd_entry_matcher_v3.py \
  tests/unit/test_rd_entry_arbitrator_v3.py \
  tests/unit/test_rd_entry_oracle_v3.py -v
uv run python scripts/build_rd_entry_oracle_vectors_v3.py \
  --fixtures tests/fixtures/rd_entry_arbitration_cases_v3.json \
  --output contracts/vectors/rd-entry-arbitration-v3.json --check
```

Expected: all tests pass and regeneration produces no diff.

- [ ] **Step 9: Run static checks and commit**

```bash
uv run ruff format src/prop_trading/domain/rd_entry_models_v3.py \
  src/prop_trading/domain/rd_entry_matcher_v3.py \
  src/prop_trading/domain/rd_entry_arbitrator_v3.py \
  src/prop_trading/contracts/rd_entry_vectors_v3.py \
  scripts/build_rd_entry_oracle_vectors_v3.py \
  tests/unit/test_rd_entry_models_v3.py \
  tests/unit/test_rd_entry_matcher_v3.py \
  tests/unit/test_rd_entry_arbitrator_v3.py \
  tests/unit/test_rd_entry_oracle_v3.py
uv run ruff check .
uv run mypy
git diff --check
git add src/prop_trading/domain/rd_entry_models_v3.py \
  src/prop_trading/domain/rd_entry_matcher_v3.py \
  src/prop_trading/domain/rd_entry_arbitrator_v3.py \
  src/prop_trading/contracts/rd_entry_vectors_v3.py \
  scripts/build_rd_entry_oracle_vectors_v3.py \
  tests/fixtures/rd_entry_arbitration_cases_v3.json \
  contracts/vectors/rd-entry-arbitration-v3.json \
  tests/unit/test_rd_entry_models_v3.py \
  tests/unit/test_rd_entry_matcher_v3.py \
  tests/unit/test_rd_entry_arbitrator_v3.py \
  tests/unit/test_rd_entry_oracle_v3.py Makefile
git commit -m "feat: add RD BOC chronology oracle"
```

---

### Task 3: Mirror contract v3 at the Cloudflare observation edge

**Files:**

- Create: `apps/observation-edge/src/rd-entry-domain-v3.ts`
- Create: `apps/observation-edge/src/rd-entry-matcher-v3.ts`
- Create: `apps/observation-edge/src/rd-entry-arbitrator-v3.ts`
- Create: `apps/observation-edge/src/rd-entry-wire-v3.ts`
- Create: `apps/observation-edge/src/rd-entry-vector-contract-v3.ts`
- Create: `apps/observation-edge/test/rd-entry-domain-v3.test.ts`
- Create: `apps/observation-edge/test/rd-entry-wire-v3.test.ts`
- Create: `apps/observation-edge/test/rd-entry-parity-v3.test.ts`
- Modify: `apps/observation-edge/src/types.ts`
- Modify: `apps/observation-edge/src/validation.ts`

**Interfaces:**

- Consumes: `contracts/vectors/rd-entry-arbitration-v3.json`.
- Produces: `validateEntryV3Payload(raw)`, `evaluateEntryV3Bundle(bundle)`, `EntryEvaluationV3`, and the `entry-v3` observation variant consumed by Task 5.

- [ ] **Step 1: Write failing vector parity tests**

```typescript
import vectors from "../../../contracts/vectors/rd-entry-arbitration-v3.json";
import { evaluateEntryV3Bundle } from "../src/rd-entry-arbitrator-v3";
import { parseEntryV3Vector } from "../src/rd-entry-vector-contract-v3";

it.each(vectors.cases)("$case_id matches the Python oracle", async (raw) => {
  const vector = parseEntryV3Vector(raw);
  const actual = await evaluateEntryV3Bundle(vector.edge_input);

  expect(actual).toEqual(vector.expected);
});
```

- [ ] **Step 2: Run parity and verify failure**

Run:

```bash
cd apps/observation-edge
npm test -- rd-entry-parity-v3.test.ts
```

Expected: module resolution fails for the v3 edge files.

- [ ] **Step 3: Implement the TypeScript v3 domain**

Mirror the Python field names exactly:

```typescript
export const ACTIVE_ENTRY_MODELS_V3 = [
  "BOC",
  "DIR_CLOSE",
  "HTF_FLIP",
] as const;

export type EntryModelV3 = (typeof ACTIVE_ENTRY_MODELS_V3)[number];
export type BocTier = "HTF_TIMED" | "DISCRETIONARY_5M";
export type EvidenceReplayability =
  | "REPLAYABLE"
  | "LIVE_EXACT_NON_REPLAYABLE";

export interface EntryCandidateV3 {
  readonly candidate_id: string;
  readonly setup_id: string;
  readonly model: EntryModelV3;
  readonly state: "MATCHED" | "BLOCKED" | "REJECTED";
  readonly direction: "LONG" | "SHORT";
  readonly event_anchor_epoch: number;
  readonly trigger_ordinal: number;
  readonly boc_tier: BocTier | null;
  readonly reference_candle_open_epoch: number | null;
  readonly source_claim_ids: readonly string[];
  readonly observed_at_epoch: number;
}
```

Port the Python canonical identity fields without renaming, omitting, or adding
keys.

- [ ] **Step 4: Implement strict wire parsing with failing validation tests**

Use an unchunked event bundle with exact top-level keys:

```typescript
const TOP_LEVEL_KEYS = [
  "schema_version",
  "strategy_id",
  "strategy_version",
  "rule_contract_version",
  "execution_mode",
  "producer_instance_id",
  "producer_sequence",
  "event_id",
  "is_realtime",
  "symbol",
  "ticker_id",
  "feed",
  "timeframe",
  "tick_size",
  "detector_code_hash",
  "settings_hash",
  "observed_at_epoch",
  "market_event",
  "exit_events",
  "setups",
] as const;
```

Require:

```typescript
schema_version === "3.0"
strategy_version === "3.0.0-contract3"
rule_contract_version === "3.0.0"
execution_mode === "PAPER_ONLY"
timeframe === "5"
1 <= setups.length && setups.length <= 32
payload length < 35_000 characters
```

Each setup carries `setup`, `candidates`, `evidence`, `selection_proposal`, and
`trade_plan`. The top-level event also carries one immutable `market_event`
containing epoch, sequence, and tick price, plus a confirmed 5m OHLC bar when
`barstate.isconfirmed`. `trade_plan` contains integer `stop_ticks` and
`target_ticks`; it does not contain an account ID, broker name, order type, or
credential.

`setup.common_rule_results` contains the exact inherited rule-ID set from
contract v3, sorted by rule ID, with a boolean pass value for each rule. The
parser rejects missing, duplicate, unknown, or false required rules. The edge
revalidates directional zone geometry, engagement chronology, and invalidation
facts; reviewed producer hash binding covers rule computations that cannot be
reconstructed from one alert.

Test unknown keys, duplicate candidate IDs, BOC without reference OHLC,
`REALTIME_TICK` with `is_realtime=false`, invalid stop/target direction, and
version mismatches.

Also prove a payload replayed from a historical bar cannot claim realtime proof:

```typescript
it("rejects historical realtime evidence", () => {
  expect(() => validateEntryV3Payload({
    ...realtimeBocPayload,
    is_realtime: false,
  })).toThrowError(EntryV3ValidationError);
});
```

- [ ] **Step 5: Port matcher and arbitration and pass golden parity**

Use the same eligibility predicate:

```typescript
function exactEligible(
  candidate: EntryCandidateV3,
  evidence: EntryCandidateEvidenceV3,
): boolean {
  if (
    candidate.state !== "MATCHED" ||
    evidence.fidelity !== "EXACT" ||
    evidence.observed_trigger_epoch === null ||
    evidence.ambiguity_codes.length !== 0
  ) {
    return false;
  }
  if (candidate.model === "BOC" && candidate.boc_tier !== "HTF_TIMED") {
    return false;
  }
  return (
    evidence.proof_plane === "LOWER_TIMEFRAME_REPLAY" ||
    evidence.proof_plane === "EXTERNAL_ARCHIVED_TICK" ||
    (
      evidence.proof_plane === "REALTIME_TICK" &&
      evidence.replayability === "LIVE_EXACT_NON_REPLAYABLE"
    ) ||
    (
      candidate.model === "DIR_CLOSE" &&
      evidence.proof_plane === "CONFIRMED_5M"
    )
  );
}
```

Run:

```bash
cd apps/observation-edge
npm test -- rd-entry-domain-v3.test.ts rd-entry-wire-v3.test.ts \
  rd-entry-parity-v3.test.ts
npm run typecheck
npm run lint
```

Expected: all selected tests and static checks pass.

- [ ] **Step 6: Add the `entry-v3` validation variant**

Extend the observation union:

```typescript
| {
    readonly version: "entry-v3";
    readonly metadata: ObservationMetadata;
    readonly canonicalPayload: CanonicalObject;
    readonly entryBundles: readonly ValidatedEntryV3Bundle[];
    readonly paperCommands: readonly [];
  }
```

Route only `schema_version: "3.0"` to `validateEntryV3Payload`. Keep all earlier
branches unchanged.

- [ ] **Step 7: Run edge regression and commit**

```bash
cd apps/observation-edge
npm test
npm run typecheck
npm run lint
cd ../..
git diff --check
git add apps/observation-edge/src/rd-entry-domain-v3.ts \
  apps/observation-edge/src/rd-entry-matcher-v3.ts \
  apps/observation-edge/src/rd-entry-arbitrator-v3.ts \
  apps/observation-edge/src/rd-entry-wire-v3.ts \
  apps/observation-edge/src/rd-entry-vector-contract-v3.ts \
  apps/observation-edge/src/types.ts \
  apps/observation-edge/src/validation.ts \
  apps/observation-edge/test/rd-entry-domain-v3.test.ts \
  apps/observation-edge/test/rd-entry-wire-v3.test.ts \
  apps/observation-edge/test/rd-entry-parity-v3.test.ts
git commit -m "feat: validate RD three-entry bundles at edge"
```

---

### Task 4: Create the TradingView three-model alert producer

**Files:**

- Create: `scripts/pinescript/SND_RD_5M_V3_THREE_ENTRY_LAB.pine`
- Create: `tests/static/test_rd_three_entry_pine.py`
- Create: `apps/observation-edge/test/rd-entry-pine-v3-parity.test.ts`

**Interfaces:**

- Consumes: the Task 3 `schema_version: "3.0"` wire contract.
- Produces: one realtime/confirmed event bundle containing all observed candidates and one diagnostic selection proposal.

- [ ] **Step 1: Write failing Pine source-invariant tests**

```python
PINE = Path("scripts/pinescript/SND_RD_5M_V3_THREE_ENTRY_LAB.pine")


def test_pine_v3_declares_all_three_models_and_versions() -> None:
    source = PINE.read_text()

    assert 'const string ENTRY_MODEL_BOC = "BOC"' in source
    assert 'const string ENTRY_MODEL_CLOSE = "DIR_CLOSE"' in source
    assert 'const string ENTRY_MODEL_FLIP = "HTF_FLIP"' in source
    assert 'const string ENTRY_SCHEMA_VERSION = "3.0"' in source
    assert 'const string ENTRY_STRATEGY_VERSION = "3.0.0-contract3"' in source


def test_pine_v3_never_normalizes_boc_to_flip() -> None:
    source = PINE.read_text()

    assert "LEGACY_BREAK_CANDLE" not in source
    assert "normalized_from" not in source
    assert "BOC_DISCRETIONARY_CONTEXT_UNQUANTIFIED" in source


def test_realtime_evidence_is_guarded() -> None:
    source = PINE.read_text()

    assert "barstate.isrealtime" in source
    assert "LIVE_EXACT_NON_REPLAYABLE" in source
```

- [ ] **Step 2: Run static tests and verify failure**

Run:

```bash
uv run pytest tests/static/test_rd_three_entry_pine.py -v
```

Expected: failure because the Pine v3 file does not exist.

- [ ] **Step 3: Copy the qualified setup engine into a separate v3 producer**

Start from `SND_RD_5M_V2_LAB.pine`, retain its zone/liquidity/setup machinery,
and remove the single `setupEntryModel` terminal decision. Add independent
candidate state:

```pine
const string ENTRY_MODEL_BOC = "BOC"
const string ENTRY_MODEL_CLOSE = "DIR_CLOSE"
const string ENTRY_MODEL_FLIP = "HTF_FLIP"
const string BOC_TIER_HTF = "HTF_TIMED"
const string BOC_TIER_DISCRETIONARY = "DISCRETIONARY_5M"
const string ENTRY_SCHEMA_VERSION = "3.0"
const string ENTRY_STRATEGY_VERSION = "3.0.0-contract3"
const string ENTRY_RULE_CONTRACT_VERSION = "3.0.0"

detectorCodeHash = input.string("", "Reviewed detector SHA-256", group = "Automation")
settingsHash = input.string("", "Reviewed settings SHA-256", group = "Automation")

type EntryAttempt
    string setupId
    int engagementEpoch
    int referenceOpenEpoch
    int referenceHighTicks
    int referenceLowTicks
    bool bocEmitted
    bool closeEmitted
    bool flipEmitted
    bool paperDecisionEmitted
    bool stopEventEmitted
    bool targetEventEmitted
```

Do not mark the setup terminal when the first model fires. Continue observing the
other models for audit.

Serialize the complete sorted v3 common-rule result set for each setup. Do not
emit `common_fidelity = EXACT` unless every required common rule passes and both
reviewed hashes are 64-character lowercase nonzero SHA-256 values. Otherwise
emit the candidates as blocked observations.

- [ ] **Step 4: Implement BOC arming and strict/discretionary classification**

Use the immutable engagement/rejection candle as the reference:

```pine
bool longBreak = direction == DIRECTION_DEMAND and high > referenceHigh
bool shortBreak = direction == DIRECTION_SUPPLY and low < referenceLow
bool bocTriggered = not bocEmitted and (longBreak or shortBreak)

bool opens15 = minute(time) % 15 == 0
bool opens30 = minute(time) % 30 == 0
bool opens60 = minute(time) == 0
bool htfTimed = opens15 or opens30 or opens60
string bocTier = htfTimed ? BOC_TIER_HTF : BOC_TIER_DISCRETIONARY
```

For realtime execution, capture the first crossing update with `timenow`, a
monotonic per-producer `tickSequence`, and the directional trigger level. For
historical confirmed bars, emit BOC only as non-exact observation unless lower
timeframe replay facts are present.

- [ ] **Step 5: Keep close and flip independent**

Directional close remains confirmed-only:

```pine
bool directionalClose =
    barstate.isconfirmed and zoneEngaged and
    (
        (direction == DIRECTION_DEMAND and close > open and close > zoneTop) or
        (direction == DIRECTION_SUPPLY and close < open and close < zoneBottom)
    )
```

Flip maintains HTF open, contact, and recross state separately for 15m, 30m, and
60m contexts. A BOC alert must never set `flipEmitted`, and a flip alert must
never set `bocEmitted`.

- [ ] **Step 6: Serialize all candidates into one bounded event bundle**

Emit exact model fields:

```json
{
  "schema_version": "3.0",
  "strategy_version": "3.0.0-contract3",
  "rule_contract_version": "3.0.0",
  "execution_mode": "PAPER_ONLY",
  "detector_code_hash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "settings_hash": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "is_realtime": true,
  "setups": [
    {
      "candidates": [],
      "evidence": [],
      "selection_proposal": {},
      "trade_plan": {
        "stop_ticks": 116500,
        "target_ticks": 116000
      }
    }
  ]
}
```

Call `alert(payload, alert.freq_all)` for first realtime intrabar BOC/flip
crossings and `alert(payload, alert.freq_once_per_bar_close)` for close or
historical observation bundles. Refuse to emit a payload at or above 35,000
characters and surface a chart diagnostic instead.

While a setup has any matched candidate, monitor its approved stop and target.
Emit a generic setup exit event on the first realtime crossing:

```pine
bool stopHit =
    (direction == DIRECTION_DEMAND and low <= stopPrice) or
    (direction == DIRECTION_SUPPLY and high >= stopPrice)
bool targetHit =
    (direction == DIRECTION_DEMAND and high >= targetPrice) or
    (direction == DIRECTION_SUPPLY and low <= targetPrice)
```

Serialize `exit_events` with `setup_id`, `attempt_kind`, `event_epoch`,
`event_sequence`, `event_ticks`, and `exit_reason` (`STOP` or `TARGET`). On a
historical bar that contains both stop and target, emit
`AMBIGUOUS_SAME_BAR_EXIT` instead of choosing an outcome. The backend ignores an
exit event when no v3 paper link or shadow position exists.

- [ ] **Step 7: Add compact Pine-to-edge parity fixtures**

In Vitest, feed representative Pine-shaped JSON through
`validateEntryV3Payload()` and `evaluateEntryV3Bundle()`:

```typescript
it("keeps BOC and flip when the same tick satisfies both", async () => {
  const parsed = validateEntryV3Payload(sameEventBocFlipPayload);
  const result = await evaluateEntryV3Bundle(parsed.entryBundles[0]!);

  expect(result.selection.reason).toBe("CO_TRIGGER_SAME_EVENT");
  expect(result.selection.co_triggered_models).toEqual(["BOC", "HTF_FLIP"]);
});
```

- [ ] **Step 8: Run Pine and edge checks and commit**

```bash
uv run pytest tests/static/test_rd_three_entry_pine.py -v
cd apps/observation-edge
npm test -- rd-entry-pine-v3-parity.test.ts rd-entry-wire-v3.test.ts
npm run typecheck
cd ../..
git diff --check
git add scripts/pinescript/SND_RD_5M_V3_THREE_ENTRY_LAB.pine \
  tests/static/test_rd_three_entry_pine.py \
  apps/observation-edge/test/rd-entry-pine-v3-parity.test.ts
git commit -m "feat: emit RD BOC close and flip alerts"
```

---

### Task 5: Persist version 3 decisions and create one paper intent

**Files:**

- Create: `apps/observation-edge/migrations/0024_observation_entries_v3.sql`
- Create: `apps/observation-edge/src/rd-entry-queries-v3.ts`
- Create: `apps/observation-edge/src/rd-entry-store-v3.ts`
- Create: `apps/observation-edge/test/rd-entry-store-v3.test.ts`
- Modify: `apps/observation-edge/src/index.ts`
- Modify: `apps/observation-edge/src/types.ts`
- Modify: `apps/observation-edge/src/paper-simulator-queries.ts`
- Modify: `apps/observation-edge/test/worker.test.ts`
- Modify: `apps/observation-edge/wrangler.jsonc`
- Modify: `.env.example`
- Modify: `tests/static/test_migration_foundation.py`

**Interfaces:**

- Consumes: validated `entry-v3` bundles and `EntryEvaluationV3`.
- Produces: `appendEntryV3Observation()`, immutable v3 rows, one `paper_trade_intents` row per setup attempt, and an immutable selection-to-intent link.

- [ ] **Step 1: Write failing migration tests**

Require the additive tables and append-only triggers:

```typescript
it("installs the v3 entry and paper decision schema", () => {
  expect(tableNames()).toEqual(expect.arrayContaining([
    "observation_entry_v3_events",
    "observation_entry_v3_candidates",
    "observation_entry_v3_evidence",
    "observation_entry_v3_selections",
    "observation_entry_v3_selection_members",
    "observation_entry_v3_parity",
    "observation_entry_v3_paper_links",
    "observation_entry_v3_shadow_positions",
  ]));
  expect(triggerNames()).toEqual(expect.arrayContaining([
    "observation_entry_v3_candidates_no_update",
    "observation_entry_v3_candidates_no_delete",
    "observation_entry_v3_selections_no_update",
    "observation_entry_v3_selections_no_delete",
    "observation_entry_v3_parity_no_update",
    "observation_entry_v3_parity_no_delete",
    "observation_entry_v3_paper_links_no_update",
    "observation_entry_v3_paper_links_no_delete",
    "observation_entry_v3_shadow_positions_no_delete",
  ]));
});
```

- [ ] **Step 2: Run store tests and verify failure**

Run:

```bash
cd apps/observation-edge
npm test -- rd-entry-store-v3.test.ts
```

Expected: failure because migration 0024 and the v3 store do not exist.

- [ ] **Step 3: Add the parallel append-only v3 tables**

Use a versioned event table:

```sql
CREATE TABLE observation_entry_v3_events (
    event_id TEXT PRIMARY KEY NOT NULL,
    receipt_id TEXT NOT NULL UNIQUE
        REFERENCES observation_receipts(receipt_id) ON DELETE RESTRICT,
    producer_instance_id TEXT NOT NULL,
    producer_sequence INTEGER NOT NULL CHECK (producer_sequence >= 1),
    strategy_version TEXT NOT NULL
        CHECK (strategy_version = '3.0.0-contract3'),
    rule_contract_version TEXT NOT NULL
        CHECK (rule_contract_version = '3.0.0'),
    is_realtime INTEGER NOT NULL CHECK (is_realtime IN (0, 1)),
    symbol TEXT NOT NULL,
    validated_payload_json TEXT NOT NULL CHECK (
        json_valid(validated_payload_json)
        AND json_type(validated_payload_json) = 'object'
    ),
    payload_sha256 TEXT NOT NULL,
    observed_at_epoch INTEGER NOT NULL CHECK (observed_at_epoch >= 0),
    UNIQUE (producer_instance_id, producer_sequence)
) STRICT;
```

The candidate table permits exactly `BOC`, `DIR_CLOSE`, and `HTF_FLIP`. Add
nullable BOC tier/reference columns with a CHECK requiring all BOC columns for
`model='BOC'` and forbidding them for other models.

The selection table uses policy `rd-entry-arbitration-v3`, stores
`co_triggered_models_json`, and permits reason `CO_TRIGGER_SAME_EVENT`.

Create `observation_entry_v3_parity` with one immutable row per selection. Store
`MATCH`, `MISMATCH`, or `NOT_PROVIDED` plus a closed mismatch reason covering
candidate identities, evidence identities, selected candidate, reason, action,
and multiple differences. The producer proposal is diagnostic only.

The paper link table has:

```sql
CREATE TABLE observation_entry_v3_paper_links (
    setup_id TEXT NOT NULL,
    attempt_kind TEXT NOT NULL CHECK (attempt_kind IN ('INITIAL', 'RE_ENTRY')),
    selection_id TEXT NOT NULL UNIQUE
        REFERENCES observation_entry_v3_selections(selection_id)
        ON DELETE RESTRICT,
    intent_id TEXT NOT NULL UNIQUE
        REFERENCES paper_trade_intents(intent_id) ON DELETE RESTRICT,
    created_at TEXT NOT NULL,
    PRIMARY KEY (setup_id, attempt_kind)
) STRICT;
```

This primary key enforces the one-trade rule at the database boundary.

Create `observation_entry_v3_shadow_positions` for discretionary BOC outcome
measurement. It stores candidate ID, setup/attempt identity, entry/stop/target
ticks, `OPEN | STOPPED | TARGET_HIT | AMBIGUOUS` state, exit event identity, and
`outcome_r_millis`. Allow exactly one monotonic state update from `OPEN` to a
terminal state with a trigger that rejects any second update; forbid deletion.
This table never references `paper_trade_intents` and never changes account
balances.

- [ ] **Step 4: Write failing persistence and idempotency tests**

Cover:

```typescript
it("persists BOC and flip without normalization", async () => {
  const result = await appendEntryV3Observation(env, receipt, validBundle);

  expect(result.evaluation.selection.canonical_model).toBe("BOC");
  expect(await modelsFor(result.setupId)).toEqual(["BOC", "HTF_FLIP"]);
  expect(await normalizedRows()).toEqual([]);
});

it("replaying one event is idempotent", async () => {
  const first = await appendEntryV3Observation(env, receipt, validBundle);
  const second = await appendEntryV3Observation(env, receipt, validBundle);

  expect(second).toEqual(first);
  expect(await count("observation_entry_v3_events")).toBe(1);
});

it("later candidates cannot create a second paper intent", async () => {
  await appendEntryV3Observation(env, firstReceipt, closeWinsBundle);
  await appendEntryV3Observation(env, laterReceipt, earlierTimestampBocBundle);

  expect(await count("observation_entry_v3_paper_links")).toBe(1);
  expect(await count("paper_trade_intents")).toBe(1);
});

it("tracks discretionary BOC without allocating paper-account risk", async () => {
  await appendEntryV3Observation(env, entryReceipt, discretionaryBocBundle);
  await appendEntryV3Observation(env, exitReceipt, targetExitBundle);

  expect(await count("observation_entry_v3_shadow_positions")).toBe(1);
  expect(await shadowState()).toEqual({
    state: "TARGET_HIT",
    outcome_r_millis: 4_000,
  });
  expect(await count("paper_trade_intents")).toBe(0);
  expect(await count("paper_trade_allocations")).toBe(0);
});

it("settles the selected paper intent from one exact exit event", async () => {
  await appendEntryV3Observation(env, entryReceipt, strictBocBundle);
  await appendEntryV3Observation(env, exitReceipt, stopExitBundle);

  expect(await paperSettlement()).toEqual({
    exit_reason: "STOP",
    outcome_r_millis: -1_000,
  });
});

it("stores producer disagreement without changing edge authority", async () => {
  const result = await appendEntryV3Observation(
    env,
    receipt,
    proposalSelectsFlipButEdgeSelectsBoc,
  );

  expect(result.evaluation.selection.canonical_model).toBe("BOC");
  expect(await parityRow()).toEqual({
    parity_status: "MISMATCH",
    mismatch_reason: "SELECTED_CANDIDATE",
  });
});
```

- [ ] **Step 5: Implement transactional append and decision freeze**

`appendEntryV3Observation()` must:

1. insert or replay the receipt/event;
2. evaluate the bundle using edge authority;
3. compare the producer proposal and insert parity diagnostics;
4. insert candidates, evidence, selection, and parity immutably;
5. load any existing paper link for `setup_id + attempt_kind`;
6. retain the existing economic decision if present;
7. create a paper intent only for a new `PAPER_ELIGIBLE` selection;
8. insert the paper link in the same D1 batch as the paper intent and allocations;
9. create a non-economic shadow position for a discretionary BOC; and
10. apply each exact exit event once to the linked paper intent and/or shadow
   position.

Derive the intent ID deterministically:

```typescript
const intentId = `rd-entry-v3:${selection.selection_id}`;
```

Convert tick prices with the validated decimal tick size, then pass the existing
paper simulator command:

```typescript
const intent: PaperTradeIntentCommand = {
  schema_version: "1.0",
  intent_id: intentId,
  symbol: event.symbol,
  side: setup.direction === "LONG" ? "BUY" : "SELL",
  entry_price: ticksToDecimal(evidence.observed_trigger_ticks, event.tick_size),
  stop_loss: ticksToDecimal(setup.trade_plan.stop_ticks, event.tick_size),
  take_profit: ticksToDecimal(setup.trade_plan.target_ticks, event.tick_size),
  risk_bps: config.riskBps,
  account_ids: config.accountIds,
};
```

Reuse the existing paper allocation SQL and safe-balance checks; do not duplicate
risk arithmetic.

For a target exit, compute the realized R from entry/stop/target ticks and pass
the resulting integer millirisk to the existing settlement path. A stop always
settles at `-1000`. Reject an exit preceding the entry, a wrong-side exit price,
duplicate conflicting exits, and `AMBIGUOUS_SAME_BAR_EXIT`; the ambiguous case
leaves the economic paper intent open and marks only the shadow projection
`AMBIGUOUS`.

- [ ] **Step 6: Add closed paper configuration**

Add:

```text
RD_ENTRY_PAPER_ACCOUNT_IDS=paper-primary
RD_ENTRY_PAPER_RISK_BPS=50
RD_ENTRY_V3_DETECTOR_CODE_HASH=
RD_ENTRY_V3_SETTINGS_HASH=
```

Parse account IDs as a sorted, unique comma-separated list matching the existing
paper account ID validator. Reject missing/invalid configuration by downgrading
the effective action to `SHADOW_ONLY` with
`PAPER_CONFIGURATION_UNAVAILABLE`; never partially allocate.

Require both reviewed hashes to be nonzero lowercase SHA-256 values and equal to
the event metadata. A mismatch downgrades the effective action to `SHADOW_ONLY`
with `PROMOTION_IDENTITY_MISMATCH`; candidate detection, storage, and parity
comparison continue.

- [ ] **Step 7: Route version 3 ingestion**

In the TradingView observation handler:

```typescript
if (observation.version === "entry-v3") {
  const result = await appendEntryV3Observation(
    env,
    observation.metadata,
    payloadSha256,
    observation.entryBundles,
  );
  return jsonResponse({
    status: result.inserted ? "RECEIVED" : "DUPLICATE",
    event_id: result.eventId,
    evaluations: result.evaluations,
    paper_intent_ids: result.paperIntentIds,
    execution: "PAPER_ONLY",
  }, result.inserted ? 202 : 200);
}
```

Keep the response free of raw credentials and full validated payloads.

- [ ] **Step 8: Run migration, store, and worker regression**

```bash
cd apps/observation-edge
npm run db:migrate:local
npm test -- rd-entry-store-v3.test.ts worker.test.ts
npm run typecheck
npm run lint
cd ../..
uv run pytest tests/static/test_migration_foundation.py -v
git diff --check
```

Expected: all checks pass, duplicate delivery is idempotent, and one setup
creates no more than one paper intent.

- [ ] **Step 9: Commit persistence and paper integration**

```bash
git add apps/observation-edge/migrations/0024_observation_entries_v3.sql \
  apps/observation-edge/src/rd-entry-queries-v3.ts \
  apps/observation-edge/src/rd-entry-store-v3.ts \
  apps/observation-edge/src/index.ts \
  apps/observation-edge/src/types.ts \
  apps/observation-edge/src/paper-simulator-queries.ts \
  apps/observation-edge/test/rd-entry-store-v3.test.ts \
  apps/observation-edge/test/worker.test.ts \
  apps/observation-edge/wrangler.jsonc .env.example \
  tests/static/test_migration_foundation.py
git commit -m "feat: open one paper intent from RD entry v3"
```

---

### Task 6: Add the bounded decision API and operations-console explanation

**Files:**

- Modify: `apps/observation-edge/src/rd-entry-queries-v3.ts`
- Modify: `apps/observation-edge/src/index.ts`
- Modify: `apps/observation-edge/test/worker.test.ts`
- Create: `apps/operations-console/src/lib/entry-decisions.ts`
- Create: `apps/operations-console/src/components/EntryDecisionPanel.tsx`
- Create: `apps/operations-console/tests/entry-decisions-api.test.ts`
- Create: `apps/operations-console/tests/entry-decision-panel.test.tsx`
- Modify: `apps/operations-console/src/components/FoundationDashboard.tsx`
- Modify: `apps/operations-console/src/components/PaperSimulationPanel.tsx`
- Modify: `apps/operations-console/tests/dashboard.test.tsx`
- Modify: `apps/operations-console/tests/paper-simulation.test.tsx`
- Modify: `apps/operations-console/src/app/styles.css`

**Interfaces:**

- Consumes: immutable v3 decision rows and paper links.
- Produces: `GET /api/v1/rd-entry-decisions?limit=N`, `loadEntryDecisions()`, and `EntryDecisionPanel`.

- [ ] **Step 1: Write failing bounded API tests**

```typescript
it("returns selected and competing entry models", async () => {
  await seedThreeModelDecision(db);

  const response = await worker.fetch(
    request("/api/v1/rd-entry-decisions?limit=20"),
    env,
  );
  const body = await response.json<EntryDecisionResponse>();

  expect(response.status).toBe(200);
  expect(body.mode).toBe("PAPER_ONLY");
  expect(body.items[0]!.selection.canonical_model).toBe("BOC");
  expect(body.items[0]!.candidates.map((item) => item.model)).toEqual([
    "BOC",
    "DIR_CLOSE",
    "HTF_FLIP",
  ]);
});

it.each(["0", "201", "x", "1&limit=2"])(
  "rejects invalid limit %s",
  async (limit) => {
    const response = await worker.fetch(
      request(`/api/v1/rd-entry-decisions?limit=${limit}`),
      env,
    );
    expect(response.status).toBe(422);
  },
);
```

- [ ] **Step 2: Implement one bounded read query**

Fetch at most `1..200` selections ordered by:

```sql
ORDER BY s.evaluated_at_epoch DESC, s.selection_id DESC
LIMIT ?
```

Then fetch candidate/evidence/member rows with one bounded `IN` query per table.
Do not issue one query per selection. Return:

```typescript
interface EntryDecisionItem {
  readonly setup_id: string;
  readonly symbol: string;
  readonly direction: "LONG" | "SHORT";
  readonly selection: EntrySelectionV3;
  readonly parity: {
    readonly status: "MATCH" | "MISMATCH" | "NOT_PROVIDED";
    readonly mismatch_reason: string | null;
  };
  readonly candidates: readonly EntryDecisionCandidate[];
  readonly paper_intent_id: string | null;
  readonly trade: {
    readonly entry_price: string;
    readonly stop_loss: string;
    readonly take_profit: string;
    readonly state: "OPEN" | "SETTLED";
  } | null;
  readonly shadow_outcome: {
    readonly state: "OPEN" | "STOPPED" | "TARGET_HIT" | "AMBIGUOUS";
    readonly outcome_r_millis: number | null;
  } | null;
}
```

Do not return `validated_payload_json`, environment values, or credential data.

- [ ] **Step 3: Route and verify the API**

Add:

```typescript
if (url.pathname === "/api/v1/rd-entry-decisions") {
  if (request.method !== "GET") {
    return errorResponse(405, "METHOD_NOT_ALLOWED", "Method not allowed");
  }
  return listRdEntryDecisions(request, env);
}
```

Run:

```bash
cd apps/observation-edge
npm test -- worker.test.ts
npm run typecheck
```

Expected: API tests pass without changing older endpoints.

- [ ] **Step 4: Write failing console parser and rendering tests**

```typescript
it("parses all three canonical model rows", async () => {
  mockFetch(entryDecisionPayload);

  const snapshot = await loadEntryDecisions();

  expect(snapshot.items[0]!.candidates.map((candidate) => candidate.model))
    .toEqual(["BOC", "DIR_CLOSE", "HTF_FLIP"]);
});

it("shows why discretionary BOC did not win", async () => {
  render(<EntryDecisionPanel initialSnapshot={discretionaryBocSnapshot} />);

  expect(screen.getByText("Discretionary 5m BOC")).toBeInTheDocument();
  expect(
    screen.getByText("Context is not mechanically quantified"),
  ).toBeInTheDocument();
  expect(screen.getByText("Directional close selected")).toBeInTheDocument();
});
```

- [ ] **Step 5: Implement strict client parsing**

`entry-decisions.ts` must reject unknown models, tiers, states, actions, and
reasons. Use:

```typescript
const models = new Set(["BOC", "DIR_CLOSE", "HTF_FLIP"] as const);
const bocTiers = new Set(["HTF_TIMED", "DISCRETIONARY_5M"] as const);
const actions = new Set([
  "OBSERVE",
  "PAPER_ELIGIBLE",
  "SHADOW_ONLY",
  "NONE",
] as const);
```

Fetch with the existing bounded timeout and same-origin endpoint helper. Return a
safe empty snapshot with an error label on transport failure; do not reuse stale
items as current decisions.

- [ ] **Step 6: Build `EntryDecisionPanel`**

For each setup card show:

```text
Symbol / direction
Selected model and reason
Entry / stop / target
Paper intent link or "No paper trade"
BOC row: tier, reference candle, trigger, status
Directional close row: close candle, trigger, status
Flip row: HTF contexts, trigger, status
Co-trigger badge when present
TradingView/backend parity status
```

Use plain status text in addition to color. Map
`BOC_DISCRETIONARY_CONTEXT_UNQUANTIFIED` to
`Context is not mechanically quantified`.

- [ ] **Step 7: Link paper positions to the selected entry model**

Extend the paper summary query with a left join to
`observation_entry_v3_paper_links` and v3 selections. Add optional response
fields:

```typescript
readonly setup_id: string | null;
readonly selected_entry_model: "BOC" | "DIR_CLOSE" | "HTF_FLIP" | null;
readonly co_triggered_models: readonly ("BOC" | "DIR_CLOSE" | "HTF_FLIP")[];
```

Older manual and TradingView v1 intents return null/empty context.

- [ ] **Step 8: Run console and edge checks**

```bash
cd apps/operations-console
npm test -- entry-decisions-api.test.ts entry-decision-panel.test.tsx \
  dashboard.test.tsx paper-simulation.test.tsx
npm run typecheck
npm run lint
npm run build
cd ../observation-edge
npm test -- worker.test.ts
npm run typecheck
cd ../..
git diff --check
```

Expected: all selected tests, type checks, lint, and production build pass.

- [ ] **Step 9: Commit the API and UI**

```bash
git add apps/observation-edge/src/rd-entry-queries-v3.ts \
  apps/observation-edge/src/index.ts \
  apps/observation-edge/test/worker.test.ts \
  apps/operations-console/src/lib/entry-decisions.ts \
  apps/operations-console/src/components/EntryDecisionPanel.tsx \
  apps/operations-console/src/components/FoundationDashboard.tsx \
  apps/operations-console/src/components/PaperSimulationPanel.tsx \
  apps/operations-console/src/app/styles.css \
  apps/operations-console/tests/entry-decisions-api.test.ts \
  apps/operations-console/tests/entry-decision-panel.test.tsx \
  apps/operations-console/tests/dashboard.test.tsx \
  apps/operations-console/tests/paper-simulation.test.tsx
git commit -m "feat: explain RD entry decisions in console"
```

---

### Task 7: Verify safety, document rollout, and prepare deployment

**Files:**

- Create: `docs/runbooks/rd-three-entry-paper-rollout.md`
- Modify: `README.md`
- Create: `docs/rd-strategy-rule-contract-v3.md`
- Modify: `docs/worklog.md`
- Modify: `Makefile`
- Modify: `.github/workflows/phase0.yml`
- Modify: `scripts/static_boundary_check.py`
- Test: all Python, edge, and console suites

**Interfaces:**

- Consumes: Tasks 1–6.
- Produces: one reproducible verification command, paper-only deployment steps,
  TradingView alert instructions, smoke tests, and rollback instructions.

- [ ] **Step 1: Write failing boundary assertions**

Add repository checks:

```python
def test_contract_v3_has_no_live_execution_surface() -> None:
    contract = json.loads(
        Path("config/phase0/rd-strategy-rule-contract-v3.json").read_text()
    )
    assert contract["automation_policy"]["paper_only"] is True
    assert contract["automation_policy"]["real_execution_allowed"] is False


def test_v3_files_do_not_contain_broker_actions() -> None:
    forbidden = {
        "place_order",
        "broker_secret",
        "metatrader_login",
        "live_order",
    }
    source = "\n".join(
        path.read_text()
        for path in Path("apps/observation-edge/src").glob("*v3.ts")
    ).lower()
    assert forbidden.isdisjoint(source.split())
```

- [ ] **Step 2: Run boundary tests and verify the new checks fail**

Run:

```bash
uv run pytest tests/static/test_boundaries.py -v
```

Expected: failure until the v3 config and source set are included in the boundary
checker.

- [ ] **Step 3: Extend the global verification target**

Add v3 generated-vector checking:

```make
$(PYTHON) scripts/build_rd_entry_oracle_vectors_v3.py \
	--fixtures tests/fixtures/rd_entry_arbitration_cases_v3.json \
	--output contracts/vectors/rd-entry-arbitration-v3.json --check
```

Ensure GitHub Actions caches both Node lockfiles:

```yaml
cache-dependency-path: |
  apps/observation-edge/package-lock.json
  apps/operations-console/package-lock.json
```

- [ ] **Step 4: Write the paper rollout runbook**

Document these exact stages:

```text
1. Run make verify-observation.
2. Apply D1 migration 0024 remotely.
3. Compute and configure the reviewed detector and settings SHA-256 values.
4. Deploy the observation edge.
5. Deploy the operations console.
6. Create or verify the configured paper account.
7. Add SND_RD_5M_V3_THREE_ENTRY_LAB.pine to the 5m TradingView chart.
8. Create one "Any alert() function call" webhook alert using the v3 webhook.
9. Send one signed synthetic DIR_CLOSE payload and confirm one paper intent.
10. Replay the identical payload and confirm no additional intent.
11. Send strict BOC, flip, co-trigger, and discretionary BOC smoke payloads.
12. Confirm the app shows three rows and at most one paper position per setup.
13. Keep all broker/live execution disabled.
```

Rollback is:

```text
1. Disable the TradingView v3 alert.
2. Leave version 3 rows immutable.
3. Redeploy the previous edge/console release if necessary.
4. Do not delete migration 0024 or historical paper intents.
```

- [ ] **Step 5: Run the complete local verification**

Run:

```bash
make verify-observation
```

Expected final line:

```text
OBSERVATION VERIFICATION PASSED — ingress records metadata and no execution surface exists
```

- [ ] **Step 6: Inspect the production build artifacts**

Run:

```bash
cd apps/observation-edge
npm run build
cd ../operations-console
npm run build
cd ../..
git status --short
git diff --check
```

Expected: both builds succeed; only intended source, generated schema/vector, and
documentation files are changed.

- [ ] **Step 7: Commit verification and rollout documentation**

```bash
git add docs/runbooks/rd-three-entry-paper-rollout.md README.md \
  docs/rd-strategy-rule-contract-v3.md docs/worklog.md Makefile \
  .github/workflows/phase0.yml scripts/static_boundary_check.py \
  tests/static/test_boundaries.py
git commit -m "docs: add RD three-entry paper rollout"
```

- [ ] **Step 8: Stop before production mutation**

Present:

```text
Verified commit:
D1 migration to apply:
Edge artifact:
Console artifact:
Required environment variable names:
TradingView script:
Smoke payload results:
```

Request explicit deployment approval before applying the remote D1 migration,
deploying either service, or changing the TradingView alert.

---

## Dependency order

```text
Task 1 contract
  -> Task 2 Python oracle
  -> Task 3 edge parity and wire
  -> Task 4 Pine producer
  -> Task 5 persistence and paper intent
  -> Task 6 decision API and console
  -> Task 7 verification and deployment handoff
```

Each task is independently reviewable. Do not begin the next task until the
current task's tests, static checks, and commit succeed.

## Completion criteria

The implementation is complete when:

- contract v3 freezes BOC, directional close, and flip as distinct active models;
- Python and TypeScript produce identical results for every v3 golden vector;
- TradingView emits all observed candidate models without terminalizing the
  setup after the first candidate;
- strict HTF-timed BOC can win a paper decision;
- discretionary 5m BOC is stored and shown but never creates the paper intent;
- BOC is never normalized into flip;
- earliest exact event chronology selects the paper trade;
- co-triggering BOC and flip create one paper intent;
- later candidates cannot replace an opened economic decision;
- the console shows all candidates, the selected model, the reason, and the
  linked paper position;
- older observation records remain readable;
- `make verify-observation` passes; and
- no broker or live execution surface exists.
