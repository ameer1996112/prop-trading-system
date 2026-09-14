# Quentin Bot Shadow Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an isolated, deterministic `quentin-bot-shadow-v1` profile that records and evaluates Quentin-derived 5-minute supply, demand, liquidity, BOS, entry, and risk facts for nine requested symbols without changing the existing `3.1` contract or authorizing paper orders.

**Architecture:** Freeze an evidence-backed Python contract and golden vectors first, implement the same pure rules in an independent TypeScript `3.2` domain, then add a strict `3.2` wire/storage path and a default-off Pine profile that reuses `RawZone` geometry. Store all transitions append-only, expose cohort/gate reporting in the operations console, and require forward-shadow evidence plus explicit operator bindings before a later paper-canary plan may be approved.

**Tech Stack:** Pine Script v6, TypeScript, Cloudflare Workers, Cloudflare D1/SQLite, Vitest, Python 3.13, Pydantic v2, pytest, Next.js/React, Testing Library.

## Global Constraints

- Treat `docs/superpowers/specs/2026-08-04-quentin-bot-shadow-automation-design.md` as the approved product contract.
- Preserve `schema_version = "3.1"`, `strategy_version = "3.1.0-contract3"`, all existing `3.1` payload keys, validator behavior, storage behavior, and saved TradingView alert behavior exactly.
- Introduce only `schema_version = "3.2"`, `strategy_version = "3.2.0-contract3"`, `rule_contract_version = "3.2.0"`, and `profile_id = "quentin-bot-shadow-v1"` for the new profile.
- Keep the first release shadow-only even though the transport field remains `execution_mode = "PAPER_ONLY"`; `paper_eligible` must always be `false`, no paper intent may be inserted, and no broker or real-money path may be added.
- Accept only 5-minute observations for `USDJPY`, `GBPJPY`, `GBPCAD`, `EURUSD`, `GBPUSD`, `NZDJPY`, `NAS100`, `XAUUSD`, and `XPTUSD`.
- Preserve exact `ticker_id` and feed. Never infer health for one feed from another feed's receipt.
- Reuse existing `RawZone` geometry in this slice. Manual zone injection, 30-minute execution, automatic bias, and replacement of the zone engine remain out of scope.
- Keep `ONE_CANDLE` shadow-only and report it separately from `TWO_PLUS`; it can never become paper-eligible.
- Record wick-BOS and close-BOS separately. The Quentin cohort selects wick-BOS; the strict comparator selects close-BOS.
- Treat the existing 30% distance as telemetry only, never as a `3.2.0` hard gate.
- Require explicit reviewed bias, session, stop policy, and target policy bindings before a future promotion proposal; do not silently select risk policies.
- Use bounded Pine arrays, bounded per-zone scans, deterministic eviction, and static guards against full-history nested scans.
- Do not stage or overwrite unrelated dirty worktree changes. Each task commit lists only its own files.

---

## File and Module Map

### New rule-contract and oracle files

- `config/phase0/quentin-bot-shadow-contract-v1.json` — frozen rule/evidence contract.
- `contracts/schema/quentin-bot-shadow-contract-v1.schema.json` — exported JSON schema.
- `src/prop_trading/contracts/quentin_bot_shadow_v1.py` — strict Pydantic contract.
- `tests/contract/test_quentin_bot_shadow_contract_v1.py` — tuple, evidence, and safety invariants.
- `tests/fixtures/quentin_bot_shadow_cases_v1.json` — deterministic accepted/rejected cases with evidence references.
- `src/prop_trading/domain/quentin_bot_shadow_v1.py` — independent Python evaluator.
- `scripts/build_quentin_shadow_vectors_v1.py` — deterministic vector generator/checker.
- `contracts/vectors/quentin-bot-shadow-v1.json` — checked-in golden evaluations.
- `tests/unit/test_quentin_bot_shadow_v1.py` — rule and transition tests.

### New observation-edge files

- `apps/observation-edge/src/quentin-shadow-domain-v32.ts` — pure `3.2` evaluator and arithmetic checks.
- `apps/observation-edge/src/quentin-shadow-wire-v32.ts` — exact-key strict parser.
- `apps/observation-edge/src/quentin-shadow-queries-v32.ts` — D1 statements only.
- `apps/observation-edge/src/quentin-shadow-store-v32.ts` — idempotent append-only transition storage.
- `apps/observation-edge/src/quentin-shadow-metrics-v32.ts` — gate/cohort aggregation.
- `apps/observation-edge/test/quentin-shadow-domain-v32.test.ts` — TypeScript/Python vector parity.
- `apps/observation-edge/test/quentin-shadow-wire-v32.test.ts` — exact contract validation.
- `apps/observation-edge/test/quentin-shadow-store-v32.test.ts` — state/idempotency tests.
- `apps/observation-edge/test/quentin-shadow-metrics-v32.test.ts` — report validation.
- `apps/observation-edge/migrations/0029_quentin_shadow_v32.sql` — receipt widening and isolated shadow tables.

### Modified integration files

- `src/prop_trading/contracts/schema_registry.py` and `scripts/export_schemas.py` — register/export the frozen contract.
- `Makefile` — verify the new generated vector and schema.
- `apps/observation-edge/src/types.ts` — add only the `quentin-v32` validated variant and `3.2` environment bindings.
- `apps/observation-edge/src/validation.ts` — route exact `3.2` events to the isolated parser.
- `apps/observation-edge/src/index.ts` — authenticate, store, and report `3.2`; never call the paper simulator.
- `apps/observation-edge/test/worker.test.ts` — ingress, auth, regression, metrics, and idempotency coverage.
- `scripts/pinescript/SND_RD_5M_V3_THREE_ENTRY_LAB.pine` — default-off `3.2` profile branch while retaining the existing `3.1` branch byte-for-byte where possible.
- `tests/static/test_rd_three_entry_pine.py` — version, state-machine, bounds, and mutual-exclusion checks.
- `apps/operations-console/src/lib/quentin-shadow-report.ts` — strict API client.
- `apps/operations-console/src/components/QuentinShadowPanel.tsx` — per-symbol/cohort/gate report.
- `apps/operations-console/src/components/PaperSimulationPanel.tsx` — mount the shadow panel without adding controls that enable paper.
- `apps/operations-console/tests/quentin-shadow-report-api.test.ts` and `apps/operations-console/tests/quentin-shadow-panel.test.tsx` — client/UI tests.
- `docs/runbooks/quentin-bot-shadow-rollout.md` — alert creation, verification, rollback, and evidence gate.

### Core interfaces carried across tasks

```ts
export type QuentinBiasModeV32 = "LONG_ONLY" | "SHORT_ONLY" | "BOTH" | "OFF";
export type QuentinZoneSideV32 = "DEMAND" | "SUPPLY";
export type QuentinLiquidityCohortV32 = "ONE_CANDLE" | "TWO_PLUS";
export type QuentinBosModeV32 = "WICK" | "CLOSE";
export type QuentinEntryModelV32 = "DIR_CLOSE" | "BOC" | "NONE";
export type QuentinEventRoleV32 =
  | "SETUP_SNAPSHOT"
  | "ENTRY_DECISION"
  | "TERMINAL_OUTCOME";
export type QuentinShadowActionV32 = "OBSERVE" | "SHADOW_ELIGIBLE" | "REJECT";

export interface QuentinEvaluationV32 {
  readonly action: QuentinShadowActionV32;
  readonly selected_bos_mode: QuentinBosModeV32;
  readonly selected_entry_model: QuentinEntryModelV32;
  readonly shadow_eligible: boolean;
  readonly paper_eligible: false;
  readonly rejection_reasons: readonly string[];
}
```

The Python oracle, TypeScript evaluator, wire parser, D1 rows, Pine serializer, and console parser must use these exact enum spellings.

### Current code anchors before implementation

- `scripts/pinescript/SND_RD_5M_V3_THREE_ENTRY_LAB.pine:1` — current `3.1` constants; preserve them.
- `scripts/pinescript/SND_RD_5M_V3_THREE_ENTRY_LAB.pine:84` — current input groups; add the default-off Quentin group after the existing contract inputs.
- `scripts/pinescript/SND_RD_5M_V3_THREE_ENTRY_LAB.pine:198` — `RawZone`; copy immutable Quentin facts from this state rather than changing its geometry.
- `scripts/pinescript/SND_RD_5M_V3_THREE_ENTRY_LAB.pine:272` — `EntryCore`; do not extend this `3.1` type for `3.2` state.
- `scripts/pinescript/SND_RD_5M_V3_THREE_ENTRY_LAB.pine:1465` — current directional-close helper; leave it for `3.1` and add profile-specific strength evaluation.
- `scripts/pinescript/SND_RD_5M_V3_THREE_ENTRY_LAB.pine:1471` — current pre-entry invalidation helper; keep `3.2` terminal rules isolated.
- `scripts/pinescript/SND_RD_5M_V3_THREE_ENTRY_LAB.pine:1872` — current entry-state section; place new Quentin state functions after this section without changing existing state transitions.
- `scripts/pinescript/SND_RD_5M_V3_THREE_ENTRY_LAB.pine:2216` — current serializer section; add a separate serializer.
- `scripts/pinescript/SND_RD_5M_V3_THREE_ENTRY_LAB.pine:3346` — current candidate evaluation/emission; branch once here so one saved alert snapshot emits one contract.
- `apps/observation-edge/src/types.ts:14` — accepted schema/strategy unions.
- `apps/observation-edge/src/types.ts:43` — `ValidatedObservation` discriminated union.
- `apps/observation-edge/src/types.ts:677` — worker `Env` bindings.
- `apps/observation-edge/src/validation.ts:1016` — current version dispatch; insert exact `3.2` routing before legacy fallback.
- `apps/observation-edge/src/index.ts:1103` — observation validation/authentication flow.
- `apps/observation-edge/src/index.ts:1299` — current `3.1` store dispatch; add a sibling `quentin-v32` branch, never a fallthrough.
- `apps/observation-edge/src/index.ts:3678` — existing metrics response assembly.
- `apps/observation-edge/src/index.ts:3760` — existing authenticated metrics routing.
- `apps/operations-console/src/components/PaperSimulationPanel.tsx:503` — panel component entry.
- `apps/operations-console/src/components/PaperSimulationPanel.tsx:769` — existing cohort/decision panel mount point.

---

## Task 1: Freeze the Quentin Rule and Evidence Contract

**Files:**

- Create: `src/prop_trading/contracts/quentin_bot_shadow_v1.py`
- Create: `config/phase0/quentin-bot-shadow-contract-v1.json`
- Create: `tests/contract/test_quentin_bot_shadow_contract_v1.py`
- Modify: `src/prop_trading/contracts/schema_registry.py`
- Modify: `scripts/export_schemas.py`
- Create: `contracts/schema/quentin-bot-shadow-contract-v1.schema.json`
- Modify: `Makefile`

**Interfaces:** Consumes the approved design spec. Produces a strict frozen contract and schema; no runtime strategy code consumes it yet.

- [ ] **Step 1: Write the failing contract tests**

Add tests that load the JSON through a strict Pydantic model and require the immutable tuple, nine symbols, 5-minute timeframe, source video IDs, cohort/BOS/entry rules, and safety defaults.

```python
def test_contract_freezes_v32_shadow_tuple(contract: QuentinBotShadowContractV1) -> None:
    assert contract.profile_id == "quentin-bot-shadow-v1"
    assert contract.schema_version == "3.2"
    assert contract.strategy_version == "3.2.0-contract3"
    assert contract.rule_contract_version == "3.2.0"
    assert contract.execution_mode == "PAPER_ONLY"
    assert contract.timeframe == "5"
    assert contract.canonical_paper_enabled is False
    assert contract.promotion_binding is None
    assert contract.one_candle_paper_eligible is False


def test_contract_contains_exact_requested_symbols(contract: QuentinBotShadowContractV1) -> None:
    assert contract.symbols == (
        "USDJPY", "GBPJPY", "GBPCAD", "EURUSD", "GBPUSD",
        "NZDJPY", "NAS100", "XAUUSD", "XPTUSD",
    )
```

- [ ] **Step 2: Run the tests and confirm the missing module fails**

Run: `uv run pytest tests/contract/test_quentin_bot_shadow_contract_v1.py -q`

Expected: failure importing `prop_trading.contracts.quentin_bot_shadow_v1`.

- [ ] **Step 3: Implement the strict contract model and checked-in JSON**

Use `ConfigDict(extra="forbid", frozen=True)` and constrained literals. Encode the public evidence by handle and video ID, avoiding any unsupported private-code claim.

```python
class QuentinBotShadowContractV1(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    profile_id: Literal["quentin-bot-shadow-v1"]
    schema_version: Literal["3.2"]
    strategy_version: Literal["3.2.0-contract3"]
    rule_contract_version: Literal["3.2.0"]
    execution_mode: Literal["PAPER_ONLY"]
    timeframe: Literal["5"]
    symbols: tuple[RequestedSymbol, ...]
    evidence_channel_handle: Literal["@quentintrirex"]
    evidence_video_ids: tuple[EvidenceVideoId, ...]
    canonical_paper_enabled: Literal[False]
    promotion_binding: None
    one_candle_paper_eligible: Literal[False]
    selected_quentin_bos: Literal["WICK"]
    selected_strict_bos: Literal["CLOSE"]
    minimum_directional_body_ratio: Annotated[
        Decimal,
        Field(ge=Decimal("0.50"), le=Decimal("0.50")),
    ]
```

Register the schema under `quentin-bot-shadow-contract-v1` and add schema export/check commands to `Makefile`.

- [ ] **Step 4: Export and verify the schema**

Run:

```bash
uv run python scripts/export_schemas.py --output-dir contracts/schema
uv run pytest tests/contract/test_quentin_bot_shadow_contract_v1.py -q
uv run python scripts/export_schemas.py --output-dir contracts/schema --check
```

Expected: all commands pass and the schema rejects extra keys or a changed version tuple.

- [ ] **Step 5: Commit the contract slice**

```bash
git add src/prop_trading/contracts/quentin_bot_shadow_v1.py \
  config/phase0/quentin-bot-shadow-contract-v1.json \
  tests/contract/test_quentin_bot_shadow_contract_v1.py \
  src/prop_trading/contracts/schema_registry.py scripts/export_schemas.py \
  contracts/schema/quentin-bot-shadow-contract-v1.schema.json Makefile
git commit -m "feat: freeze Quentin shadow rule contract"
```

---

## Task 2: Build the Independent Python Oracle and Golden Fixture Set

**Files:**

- Create: `tests/fixtures/quentin_bot_shadow_cases_v1.json`
- Create: `src/prop_trading/domain/quentin_bot_shadow_v1.py`
- Create: `tests/unit/test_quentin_bot_shadow_v1.py`
- Create: `scripts/build_quentin_shadow_vectors_v1.py`
- Create: `contracts/vectors/quentin-bot-shadow-v1.json`
- Modify: `Makefile`

**Interfaces:** Consumes normalized OHLC/setup facts, not Pine objects. Produces deterministic `QuentinEvaluationV32`-equivalent vectors used by TypeScript parity tests.

- [ ] **Step 1: Add fixture coverage and failing oracle tests**

Create cases for both sides of: `ONE_CANDLE`, `TWO_PLUS`, pre-BOS retap, wick-only BOS, close-BOS, consumed candidate replacement, strong entry, weak BOC, same-bar BOC rejection, close-inside invalidation, all bias modes, session facts, both stop candidates, all target candidates, unavailable opposing liquidity, and duplicate event identity.

Every case contains an `evidence` object with `video_id`, integer `timestamp_seconds`, `expectation_class` (`QUENTIN`, `STRICT`, or `EXPERIMENT`), and a concise rationale.

```json
{
  "case_id": "demand_close_bos_strong_close",
  "facts": {
    "zone_side": "DEMAND",
    "liquidity_cohort": "TWO_PLUS",
    "bias": "BOTH",
    "zone_retapped_before_bos": false,
    "bos_wick_confirmed": true,
    "bos_close_confirmed": true,
    "entry_open_ticks": 100,
    "entry_high_ticks": 110,
    "entry_low_ticks": 96,
    "entry_close_ticks": 108,
    "entry_bar_after_reference": true,
    "close_location": "OUTSIDE_VALID"
  },
  "expected": {
    "action": "SHADOW_ELIGIBLE",
    "selected_bos_mode": "WICK",
    "selected_entry_model": "DIR_CLOSE",
    "shadow_eligible": true,
    "paper_eligible": false,
    "rejection_reasons": []
  },
  "evidence": {
    "video_id": "8u-uCksS4Ho",
    "timestamp_seconds": 753,
    "expectation_class": "STRICT",
    "rationale": "The detailed walkthrough supports continuation structure confirmation before the zone entry sequence."
  }
}
```

- [ ] **Step 2: Run the focused tests and confirm failure**

Run: `uv run pytest tests/unit/test_quentin_bot_shadow_v1.py -q`

Expected: missing evaluator/vector builder failures.

- [ ] **Step 3: Implement pure integer-tick evaluation**

Use integer ticks for all arithmetic. Return ordered, deduplicated rejection reasons. Implement the strong-candle rule exactly:

```python
def candle_strength(facts: QuentinSetupFactsV1) -> CandleStrengthV1:
    candle_range = facts.entry_high_ticks - facts.entry_low_ticks
    if candle_range <= 0:
        return CandleStrengthV1(body_ratio=Decimal("0"), directional=False, wick_balanced=False)
    body = abs(facts.entry_close_ticks - facts.entry_open_ticks)
    upper = facts.entry_high_ticks - max(facts.entry_open_ticks, facts.entry_close_ticks)
    lower = min(facts.entry_open_ticks, facts.entry_close_ticks) - facts.entry_low_ticks
    directional = (
        facts.entry_close_ticks > facts.entry_open_ticks
        if facts.zone_side == "DEMAND"
        else facts.entry_close_ticks < facts.entry_open_ticks
    )
    wick_balanced = lower > upper if facts.zone_side == "DEMAND" else upper > lower
    return CandleStrengthV1(
        body_ratio=Decimal(body) / Decimal(candle_range),
        directional=directional,
        wick_balanced=wick_balanced,
    )
```

The evaluator must always return `paper_eligible=False`. `ONE_CANDLE` may return `SHADOW_ELIGIBLE` but must include `ONE_CANDLE_SHADOW_ONLY` in its paper-blocking facts.

- [ ] **Step 4: Generate and check stable vectors**

Run:

```bash
uv run python scripts/build_quentin_shadow_vectors_v1.py \
  --fixtures tests/fixtures/quentin_bot_shadow_cases_v1.json \
  --output contracts/vectors/quentin-bot-shadow-v1.json
uv run python scripts/build_quentin_shadow_vectors_v1.py \
  --fixtures tests/fixtures/quentin_bot_shadow_cases_v1.json \
  --output contracts/vectors/quentin-bot-shadow-v1.json --check
uv run pytest tests/unit/test_quentin_bot_shadow_v1.py -q
```

Expected: stable canonical JSON and full case pass.

- [ ] **Step 5: Add the vector check to generated verification and commit**

```bash
git add tests/fixtures/quentin_bot_shadow_cases_v1.json \
  src/prop_trading/domain/quentin_bot_shadow_v1.py \
  tests/unit/test_quentin_bot_shadow_v1.py \
  scripts/build_quentin_shadow_vectors_v1.py \
  contracts/vectors/quentin-bot-shadow-v1.json Makefile
git commit -m "test: freeze Quentin shadow oracle vectors"
```

---

## Task 3: Implement the TypeScript `3.2` Domain with Vector Parity

**Files:**

- Create: `apps/observation-edge/src/quentin-shadow-domain-v32.ts`
- Create: `apps/observation-edge/test/quentin-shadow-domain-v32.test.ts`

**Interfaces:** Consumes exact integer-tick facts from the wire layer. Produces `QuentinEvaluationV32` and risk candidates without storage or HTTP dependencies.

- [ ] **Step 1: Write a failing vector-parity test**

Load `contracts/vectors/quentin-bot-shadow-v1.json`, execute every case, and compare the complete result object.

```ts
for (const vector of vectors.cases) {
  it(vector.case_id, () => {
    expect(evaluateQuentinSetupV32(vector.facts)).toEqual(vector.expected);
  });
}
```

Add direct tests for integer-tick stop/target arithmetic and rejection-reason ordering.

- [ ] **Step 2: Run the test and confirm the module is missing**

Run: `npm --prefix apps/observation-edge test -- quentin-shadow-domain-v32.test.ts`

Expected: import failure for `quentin-shadow-domain-v32`.

- [ ] **Step 3: Implement facts, risk candidates, and pure evaluation**

Export exact enums and interfaces from the file map. Centralize risk arithmetic:

```ts
export function buildRiskCandidatesV32(f: QuentinSetupFactsV32): QuentinRiskCandidatesV32 {
  const entryWickStop = f.zone_side === "DEMAND"
    ? f.entry_low_ticks - f.stop_buffer_ticks
    : f.entry_high_ticks + f.stop_buffer_ticks;
  const deepestStop = f.zone_side === "DEMAND"
    ? f.deepest_engagement_ticks - f.stop_buffer_ticks
    : f.deepest_engagement_ticks + f.stop_buffer_ticks;
  return {
    entry_wick: buildStopCandidate(f, "ENTRY_WICK", entryWickStop),
    deepest_engagement: buildStopCandidate(f, "DEEPEST_ENGAGEMENT", deepestStop),
    opposing_liquidity: buildOpposingTargetCandidate(f),
    fixed_3r: buildFixedRTargetCandidate(f, 3),
    fixed_4r: buildFixedRTargetCandidate(f, 4),
  };
}
```

Enforce chronological checks, direction/bias mapping, selected BOS cohort, BOC later-bar evidence, and terminal invalidation. The evaluator has no paper-intent function.

Session inclusion is a recorded fact but never a shadow-eligibility rejection in `3.2.0`. Bias `OFF` records facts and rejects an entry proposal; the default shadow bias is `BOTH`.

- [ ] **Step 4: Prove Python/TypeScript parity**

Run:

```bash
npm --prefix apps/observation-edge test -- quentin-shadow-domain-v32.test.ts
npm --prefix apps/observation-edge run typecheck
uv run python scripts/build_quentin_shadow_vectors_v1.py \
  --fixtures tests/fixtures/quentin_bot_shadow_cases_v1.json \
  --output contracts/vectors/quentin-bot-shadow-v1.json --check
```

Expected: exact parity for every fixture.

- [ ] **Step 5: Commit the domain slice**

```bash
git add apps/observation-edge/src/quentin-shadow-domain-v32.ts \
  apps/observation-edge/test/quentin-shadow-domain-v32.test.ts
git commit -m "feat: add Quentin shadow domain evaluator"
```

---

## Task 4: Add the Strict `3.2` Wire Contract and Routing Boundary

**Files:**

- Create: `apps/observation-edge/src/quentin-shadow-wire-v32.ts`
- Create: `apps/observation-edge/test/quentin-shadow-wire-v32.test.ts`
- Modify: `apps/observation-edge/src/types.ts`
- Modify: `apps/observation-edge/src/validation.ts`
- Modify: `apps/observation-edge/test/rd-entry-wire-v3.test.ts`

**Interfaces:** Consumes untrusted JSON. Produces `{ kind: "quentin-v32", observation, evaluation }` only for the exact `3.2` tuple; `3.1` continues through `validateEntryV3Payload` unchanged.

- [ ] **Step 1: Write failing exact-key and regression tests**

Cover valid payload, every required top-level group, unknown keys, enum changes, non-5-minute input, unsupported symbol, inconsistent tick arithmetic, unreviewed hashes, one-candle paper proposal, missing BOS facts, invalid BOC ordering, and changed `3.1` fixtures.

```ts
expect(validateObservation(validV32)).toMatchObject({ kind: "quentin-v32" });
expect(() => validateObservation({ ...validV32, extra: true }))
  .toThrowError(/QUENTIN_V32_UNKNOWN_KEY/);
expect(validateObservation(validV31)).toEqual(existingValidatedV31);
```

- [ ] **Step 2: Run tests and confirm `3.2` is not accepted**

Run:

```bash
npm --prefix apps/observation-edge test -- \
  quentin-shadow-wire-v32.test.ts rd-entry-wire-v3.test.ts
```

Expected: `3.2` cases fail while existing `3.1` tests remain green.

- [ ] **Step 3: Implement strict parser and validated union variant**

Use exact-key helpers from `strict-json.ts`, a 35,000-byte ceiling, finite safe integer ticks, and machine-readable errors beginning with `QUENTIN_V32_`.

```ts
export interface ValidatedQuentinShadowV32 {
  readonly kind: "quentin-v32";
  readonly observation: QuentinShadowPayloadV32;
  readonly evaluation: QuentinEvaluationV32;
}

export function validateQuentinShadowV32Payload(raw: unknown): ValidatedQuentinShadowV32 {
  const payload = parseExactQuentinPayload(raw);
  assertVersionTupleV32(payload);
  assertTransportFactsV32(payload);
  assertStateArithmeticV32(payload);
  const evaluation = evaluateQuentinSetupV32(payload.setup_facts);
  assertProducerEvaluationMatches(payload.evaluation, evaluation);
  return { kind: "quentin-v32", observation: payload, evaluation };
}
```

In `validation.ts`, route only `schema_version === "3.2"` to this parser. Do not expand the `3.1` parser's accepted versions.

- [ ] **Step 4: Verify strictness and compatibility**

Run:

```bash
npm --prefix apps/observation-edge test -- \
  quentin-shadow-wire-v32.test.ts rd-entry-wire-v3.test.ts rd-entry-parity-v3.test.ts
npm --prefix apps/observation-edge run typecheck
```

Expected: precise errors for malformed `3.2`; all `3.1` parity tests pass unchanged.

- [ ] **Step 5: Commit the wire slice**

```bash
git add apps/observation-edge/src/quentin-shadow-wire-v32.ts \
  apps/observation-edge/test/quentin-shadow-wire-v32.test.ts \
  apps/observation-edge/src/types.ts apps/observation-edge/src/validation.ts \
  apps/observation-edge/test/rd-entry-wire-v3.test.ts
git commit -m "feat: validate Quentin shadow v3.2 payloads"
```

---

## Task 5: Create Isolated Append-Only `3.2` Storage

**Files:**

- Create: `apps/observation-edge/migrations/0029_quentin_shadow_v32.sql`
- Create: `apps/observation-edge/src/quentin-shadow-queries-v32.ts`
- Create: `apps/observation-edge/src/quentin-shadow-store-v32.ts`
- Create: `apps/observation-edge/test/quentin-shadow-store-v32.test.ts`
- Modify: `tests/static/test_observation_receipt_migration.py`

**Interfaces:** Consumes authenticated `ValidatedQuentinShadowV32`. Produces an idempotent receipt plus append-only setup/evaluation/outcome rows. Produces no paper intent row.

- [ ] **Step 1: Write migration and store tests first**

Require:

- `observation_receipts` accepts the exact `3.2` tuple while preserving existing rows and checks;
- unique `(producer_instance_id, producer_sequence)` and unique `event_id` behavior;
- immutable setup identity `(profile_id, ticker_id, timeframe, setup_id)`;
- monotonic transition sequence;
- terminal setups cannot reopen;
- duplicate delivery returns the existing receipt and creates no new transition;
- no foreign key or trigger inserts into `paper_trade_intents`.

- [ ] **Step 2: Run focused tests and observe missing migration/store failures**

Run:

```bash
npm --prefix apps/observation-edge test -- quentin-shadow-store-v32.test.ts
uv run pytest tests/static/test_observation_receipt_migration.py -q
```

- [ ] **Step 3: Implement the migration**

Create:

```sql
CREATE TABLE observation_quentin_v32_setups (
    setup_key TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL CHECK (profile_id = 'quentin-bot-shadow-v1'),
    ticker_id TEXT NOT NULL,
    feed TEXT NOT NULL,
    symbol TEXT NOT NULL,
    timeframe TEXT NOT NULL CHECK (timeframe = '5'),
    setup_id TEXT NOT NULL,
    terminal INTEGER NOT NULL DEFAULT 0 CHECK (terminal IN (0, 1)),
    last_transition_sequence INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (profile_id, ticker_id, timeframe, setup_id)
);

CREATE TABLE observation_quentin_v32_events (
    receipt_id TEXT PRIMARY KEY REFERENCES observation_receipts(receipt_id) ON DELETE RESTRICT,
    event_id TEXT NOT NULL UNIQUE,
    setup_key TEXT NOT NULL REFERENCES observation_quentin_v32_setups(setup_key) ON DELETE RESTRICT,
    event_role TEXT NOT NULL CHECK (event_role IN ('SETUP_SNAPSHOT', 'ENTRY_DECISION', 'TERMINAL_OUTCOME')),
    transition_sequence INTEGER NOT NULL,
    payload_sha256 TEXT NOT NULL,
    evaluation_json TEXT NOT NULL CHECK (json_valid(evaluation_json)),
    received_at TEXT NOT NULL,
    UNIQUE (setup_key, transition_sequence)
);
```

Also create these exact tables:

- `observation_quentin_v32_evaluations`: one row per event with `liquidity_cohort`, both BOS booleans, selected BOS mode, selected entry model, bias, session inclusion, shadow eligibility, `paper_eligible` constrained to `0`, and rejection reasons as valid JSON.
- `observation_quentin_v32_shadow_trades`: at most one shadow open per setup with entry ticks, both stop candidates, three target candidates, selected policies nullable, and a `binding_reviewed` flag. This table never references `paper_trade_intents`.
- `observation_quentin_v32_outcomes`: at most one immutable terminal outcome per shadow trade with exit ticks, terminal reason, MFE/MAE ticks, and realized R numerator/denominator.
- `observation_quentin_v32_transport_diagnostics`: redacted `401`/`422` diagnostics containing status, machine error code, payload SHA-256, nullable ticker/feed/producer identity, and observed time; credentials and raw payloads are forbidden.

Keep the raw canonical JSON hash for audit, not as the sole query surface. Add no-update/no-delete triggers for accepted events, evaluations, shadow trades, and outcomes. Add a bounded retention cleanup only for transport diagnostics; accepted strategy evidence remains append-only.

- [ ] **Step 4: Implement store transaction and idempotency**

```ts
export async function appendQuentinShadowV32Observation(
  env: Env,
  validated: ValidatedQuentinShadowV32,
  payloadSha256: string,
): Promise<QuentinStoreResultV32> {
  const duplicate = await findQuentinEventById(env.OBSERVATION_DB, validated.observation.event_id);
  if (duplicate !== null) return { disposition: "DUPLICATE", receipt_id: duplicate.receipt_id };
  assertShadowOnly(validated);
  return insertQuentinTransitionBatch(env.OBSERVATION_DB, validated, payloadSha256);
}
```

Fail closed on a producer-sequence collision with different content, transition gaps, terminal reopen, or setup identity conflict.

- [ ] **Step 5: Verify migration and store behavior**

Run:

```bash
npm --prefix apps/observation-edge test -- quentin-shadow-store-v32.test.ts
uv run pytest tests/static/test_observation_receipt_migration.py -q
npm --prefix apps/observation-edge run typecheck
```

- [ ] **Step 6: Commit the storage slice**

```bash
git add apps/observation-edge/migrations/0029_quentin_shadow_v32.sql \
  apps/observation-edge/src/quentin-shadow-queries-v32.ts \
  apps/observation-edge/src/quentin-shadow-store-v32.ts \
  apps/observation-edge/test/quentin-shadow-store-v32.test.ts \
  tests/static/test_observation_receipt_migration.py
git commit -m "feat: store Quentin shadow v3.2 transitions"
```

---

## Task 6: Wire `3.2` Through Authenticated Ingress Without Paper Execution

**Files:**

- Modify: `apps/observation-edge/src/index.ts`
- Modify: `apps/observation-edge/src/types.ts`
- Modify: `apps/observation-edge/test/worker.test.ts`

**Interfaces:** Consumes `POST /api/v1/observations`. Produces `201` accepted, `200` duplicate, `401` credential mismatch, or precise `422 QUENTIN_V32_*`; it never calls paper simulator/ledger code for `quentin-v32`.

- [ ] **Step 1: Add failing worker tests**

Cover valid receipt, duplicate receipt, credential mismatch, validation error, body-size error, producer collision, and a spy proving paper functions are not called.

Require a redacted transport-diagnostic row for `401` and `422`, require that the row contains neither credential nor raw payload text, and require deletion only after 30 days. Accepted setup/event/evaluation/outcome rows must not participate in that cleanup.

```ts
expect(response.status).toBe(201);
expect(await response.json()).toMatchObject({
  schema_version: "3.2",
  strategy_version: "3.2.0-contract3",
  disposition: "ACCEPTED_SHADOW",
  paper_intent_created: false,
});
expect(fakeDb.rows("paper_trade_intents")).toHaveLength(0);
```

Add a byte-for-byte regression assertion for representative `3.1` success and error bodies.

- [ ] **Step 2: Run focused worker tests and confirm failure**

Run: `npm --prefix apps/observation-edge test -- worker.test.ts`

- [ ] **Step 3: Add isolated ingress dispatch**

Authenticate after strict parsing using the existing credential field semantics. Dispatch `quentin-v32` directly to `appendQuentinShadowV32Observation`. Return machine-readable details without echoing credentials or full payloads.

```ts
if (validated.kind === "quentin-v32") {
  const result = await appendQuentinShadowV32Observation(
    env,
    validated,
    await sha256Hex(canonicalBody),
  );
  return jsonResponse(result.disposition === "DUPLICATE" ? 200 : 201, {
    schema_version: "3.2",
    strategy_version: "3.2.0-contract3",
    disposition: result.disposition === "DUPLICATE" ? "DUPLICATE" : "ACCEPTED_SHADOW",
    receipt_id: result.receipt_id,
    paper_intent_created: false,
  });
}
```

Do not pass this variant to v2/v3 matching, readiness, ledger, or simulator functions.

On `401` or `422`, write only the HTTP status, machine error code, body SHA-256, safely parsed nullable identity fields, and observation time to `observation_quentin_v32_transport_diagnostics`. Run a delete query for diagnostics older than 30 days after a successful diagnostic insert; never delete accepted strategy evidence.

- [ ] **Step 4: Run ingress and full edge regressions**

Run:

```bash
npm --prefix apps/observation-edge test -- worker.test.ts quentin-shadow-wire-v32.test.ts
npm --prefix apps/observation-edge test
npm --prefix apps/observation-edge run lint
npm --prefix apps/observation-edge run typecheck
```

- [ ] **Step 5: Commit the ingress slice**

```bash
git add apps/observation-edge/src/index.ts apps/observation-edge/src/types.ts \
  apps/observation-edge/test/worker.test.ts
git commit -m "feat: ingest Quentin shadow observations"
```

---

## Task 7: Add the Default-Off Pine Profile and Zone/Liquidity/BOS State

**Files:**

- Modify: `scripts/pinescript/SND_RD_5M_V3_THREE_ENTRY_LAB.pine`
- Modify: `tests/static/test_rd_three_entry_pine.py`

**Interfaces:** Consumes the existing `RawZone` stream and chart bars. Produces bounded `QuentinZoneStateV32` facts only when `enableQuentinShadowV32` is true. The existing `3.1` branch remains the default.

- [ ] **Step 1: Add failing static tests for isolation and bounds**

Require:

- new profile input defaults false;
- exact `3.2` tuple constants exist separately from `3.1` constants;
- profile requires `timeframe.period == "5"` and requested symbol normalization;
- active/candidate arrays have explicit caps;
- candidate scans use bounded array sizes rather than `bar_index` history;
- `ONE_CANDLE` is marked shadow-only;
- distance ratio is serialized but never included in eligibility conjunctions;
- the default branch still serializes the existing `3.1` tuple.

- [ ] **Step 2: Run static tests and confirm missing profile failures**

Run: `uv run pytest tests/static/test_rd_three_entry_pine.py -q`

- [ ] **Step 3: Add isolated constants, inputs, and state types**

```pine
const string QUENTIN_SCHEMA_VERSION = "3.2"
const string QUENTIN_STRATEGY_VERSION = "3.2.0-contract3"
const string QUENTIN_RULE_CONTRACT_VERSION = "3.2.0"
const string QUENTIN_PROFILE_ID = "quentin-bot-shadow-v1"
const int QUENTIN_MAX_ACTIVE_ZONES = 24
const int QUENTIN_MAX_CANDIDATES_PER_ZONE = 8

enableQuentinShadowV32 = input.bool(false, "Enable Quentin 3.2 shadow profile", group = "Quentin 3.2 Shadow")
quentinBias = input.string("BOTH", "Bias", options = ["LONG_ONLY", "SHORT_ONLY", "BOTH", "OFF"], group = "Quentin 3.2 Shadow")
quentinLocalSession = input.session("0000-2359", "Observed session", group = "Quentin 3.2 Shadow")
```

Add types that store immutable origin/departure bars and prices, chronological liquidity candidates, consumed state, retap state, structure level, both BOS bars, engagement state, and terminal reason. Copy required `RawZone` values at confirmation so later drawing updates cannot rewrite facts.

- [ ] **Step 4: Implement bounded candidate ownership and BOS facts**

Each zone owns its own candidate array or bounded parallel arrays. Detect one or two-plus opposite-direction retracement candles after confirmation, reject a zone retap before BOS, retain consumed candidates, and promote only the next chronological valid candidate.

Record:

```pine
candidate.bosWickConfirmed := zone.isDemand ? high > candidate.structurePrice : low < candidate.structurePrice
candidate.bosCloseConfirmed := zone.isDemand ? close > candidate.structurePrice : close < candidate.structurePrice
candidate.distanceRatio := math.abs(candidate.liquidityPrice - candidate.structurePrice) / math.max(syminfo.mintick, zone.top - zone.bottom)
```

Use confirmed bars for stored transitions. The ratio is diagnostic only.

- [ ] **Step 5: Verify static bounds and existing Pine contract tests**

Run:

```bash
uv run pytest tests/static/test_rd_three_entry_pine.py -q
rg -n "for .*bar_index|while .*bar_index" scripts/pinescript/SND_RD_5M_V3_THREE_ENTRY_LAB.pine
```

Expected: tests pass and the search finds no new full-history scan.

- [ ] **Step 6: Commit the Pine state slice**

```bash
git add scripts/pinescript/SND_RD_5M_V3_THREE_ENTRY_LAB.pine \
  tests/static/test_rd_three_entry_pine.py
git commit -m "feat: track Quentin shadow zone liquidity state"
```

---

## Task 8: Implement Pine Engagement, Strong Entry, BOC, Bias, Session, and Risk Facts

**Files:**

- Modify: `scripts/pinescript/SND_RD_5M_V3_THREE_ENTRY_LAB.pine`
- Modify: `tests/static/test_rd_three_entry_pine.py`
- Modify: `tests/fixtures/quentin_bot_shadow_cases_v1.json`
- Modify: `contracts/vectors/quentin-bot-shadow-v1.json`

**Interfaces:** Consumes qualified Pine zone/candidate state. Produces a terminal or entry-decision fact set that matches the Python vectors; still no payload emission.

- [ ] **Step 1: Add failing static/formula assertions and any chart-derived fixture discovered during implementation**

Require exact body/wick formulas, confirmed outside close, close-inside terminal invalidation, immutable weak reference, later-bar BOC, explicit bias/session facts, deepest engagement, two stop candidates, three target candidates, and unavailable target reason.

- [ ] **Step 2: Run Python vector and Pine static tests red**

Run:

```bash
uv run pytest tests/static/test_rd_three_entry_pine.py tests/unit/test_quentin_bot_shadow_v1.py -q
uv run python scripts/build_quentin_shadow_vectors_v1.py \
  --fixtures tests/fixtures/quentin_bot_shadow_cases_v1.json \
  --output contracts/vectors/quentin-bot-shadow-v1.json --check
```

- [ ] **Step 3: Implement engagement and invalidation in transition order**

On first wick overlap, freeze engagement bar and initial deepest price. Update deepest engagement only until entry/terminal. A confirmed close inside or through the zone sets terminal state before entry/BOC evaluation.

- [ ] **Step 4: Implement strong directional and ordered BOC evaluation**

```pine
entryRange = high - low
entryBodyRatio = entryRange > 0 ? math.abs(close - open) / entryRange : 0.0
upperWick = high - math.max(open, close)
lowerWick = math.min(open, close) - low
directional = zone.isDemand ? close > open : close < open
wickBalanced = zone.isDemand ? lowerWick > upperWick : upperWick > lowerWick
strongDirectional = directional and entryBodyRatio >= 0.50 and wickBalanced and closeOutside
```

If the first directional outside close is weak, freeze its bar/high/low. Only `bar_index > referenceBar` may confirm historical BOC. Realtime same-bar observation is recorded as ordering telemetry but remains paper-ineligible.

- [ ] **Step 5: Calculate explicit risk candidates without choosing a policy**

Compute `ENTRY_WICK`, `DEEPEST_ENGAGEMENT`, `OPPOSING_LIQUIDITY`, `FIXED_3R`, and `FIXED_4R` in ticks. Set the opposing candidate unavailable with a reason when no valid level exists. Store reviewed flags and bound-policy names as explicit inputs whose defaults are unreviewed/unbound.

- [ ] **Step 6: Regenerate vectors when fixture evidence changed and verify**

Run:

```bash
uv run python scripts/build_quentin_shadow_vectors_v1.py \
  --fixtures tests/fixtures/quentin_bot_shadow_cases_v1.json \
  --output contracts/vectors/quentin-bot-shadow-v1.json
uv run pytest tests/unit/test_quentin_bot_shadow_v1.py tests/static/test_rd_three_entry_pine.py -q
npm --prefix apps/observation-edge test -- quentin-shadow-domain-v32.test.ts
```

- [ ] **Step 7: Commit the entry/risk slice**

```bash
git add scripts/pinescript/SND_RD_5M_V3_THREE_ENTRY_LAB.pine \
  tests/static/test_rd_three_entry_pine.py \
  tests/fixtures/quentin_bot_shadow_cases_v1.json \
  contracts/vectors/quentin-bot-shadow-v1.json
git commit -m "feat: evaluate Quentin shadow entries and risk facts"
```

---

## Task 9: Serialize and Emit Strict `3.2` Pine Events Safely

**Files:**

- Modify: `scripts/pinescript/SND_RD_5M_V3_THREE_ENTRY_LAB.pine`
- Modify: `tests/static/test_rd_three_entry_pine.py`
- Create: `apps/observation-edge/test/quentin-shadow-pine-v32-parity.test.ts`

**Interfaces:** Produces strict JSON accepted by `validateQuentinShadowV32Payload`. Exactly one alert contract is active per saved TradingView alert snapshot: default `3.1`, or opted-in Quentin `3.2`.

- [ ] **Step 1: Add failing serializer and mutual-exclusion tests**

Require every strict key, integer tick field, deterministic setup/event IDs, monotonic producer sequence, `paper_eligible:false`, bounded payload length, and branch exclusivity.

```python
assert "if enableQuentinShadowV32" in source
assert "else if emitEntryV3Events" in source
assert '"paper_eligible":false' in source
assert '"schema_version":"3.2"' in source
```

The TypeScript parity test feeds a representative serialized JSON fixture into the strict parser and compares the evaluator result.

- [ ] **Step 2: Run tests and confirm no serializer exists**

Run:

```bash
uv run pytest tests/static/test_rd_three_entry_pine.py -q
npm --prefix apps/observation-edge test -- quentin-shadow-pine-v32-parity.test.ts
```

- [ ] **Step 3: Implement canonical serializer and event roles**

Serialize all required transport/profile/zone/liquidity/BOS/engagement/entry/risk/evaluation fields. Use decimal-free integer ticks for prices and ratios as numerator/denominator pairs where exact recomputation is required. Escape strings with the existing Pine JSON helper.

Emit `SETUP_SNAPSHOT`, `ENTRY_DECISION`, and `TERMINAL_OUTCOME` once per transition. Build IDs from profile, ticker ID, timeframe, immutable setup ID, role, and transition sequence.

- [ ] **Step 4: Enforce profile branch exclusivity and fail-closed guards**

When `enableQuentinShadowV32` is true, suppress all existing `3.1` `alert()` emission in that saved alert snapshot. When false, execute the current `3.1` path exactly as before. Reject non-5-minute and unsupported-symbol `3.2` emissions locally while retaining visible diagnostic state.

- [ ] **Step 5: Verify wire acceptance, limits, and full regression**

Run:

```bash
uv run pytest tests/static/test_rd_three_entry_pine.py -q
npm --prefix apps/observation-edge test -- \
  quentin-shadow-pine-v32-parity.test.ts quentin-shadow-wire-v32.test.ts rd-entry-pine-v3-parity.test.ts
npm --prefix apps/observation-edge run typecheck
```

Expected: representative Pine JSON is accepted; the original `3.1` parity suite stays green.

- [ ] **Step 6: Commit the serializer slice**

```bash
git add scripts/pinescript/SND_RD_5M_V3_THREE_ENTRY_LAB.pine \
  tests/static/test_rd_three_entry_pine.py \
  apps/observation-edge/test/quentin-shadow-pine-v32-parity.test.ts
git commit -m "feat: emit Quentin shadow v3.2 events"
```

---

## Task 10: Add Cohort, Transport, and Forward-Gate Metrics

**Files:**

- Create: `apps/observation-edge/src/quentin-shadow-metrics-v32.ts`
- Create: `apps/observation-edge/test/quentin-shadow-metrics-v32.test.ts`
- Modify: `apps/observation-edge/src/quentin-shadow-queries-v32.ts`
- Modify: `apps/observation-edge/src/index.ts`
- Modify: `apps/observation-edge/test/worker.test.ts`

**Interfaces:** Produces authenticated `GET /api/v1/quentin-shadow-report` with per-symbol feed health, cohort confusion/performance, runtime/delivery counts, gate progress, and no control endpoint.

- [ ] **Step 1: Add failing report tests**

Require rows for all nine symbols even with zero receipts; exact feed/ticker identity; `ONE_CANDLE`/`TWO_PLUS`; wick/close BOS matrix; entry model counts; rejection reasons; 10-day/30-setup/6-symbol gate progress; runtime/401/422 counters; duplicate counts; and `promotion_ready:false` unless every condition is met.

- [ ] **Step 2: Run metrics and worker tests red**

Run:

```bash
npm --prefix apps/observation-edge test -- \
  quentin-shadow-metrics-v32.test.ts worker.test.ts
```

- [ ] **Step 3: Implement strict report assembly**

```ts
export interface QuentinShadowReportV1 {
  readonly schema_version: "quentin-shadow-report/v1";
  readonly generated_at: string;
  readonly symbols: readonly QuentinSymbolHealthRowV1[];
  readonly cohorts: readonly QuentinCohortRowV1[];
  readonly gate: {
    readonly trading_days_observed: number;
    readonly completed_setups: number;
    readonly symbols_with_completed_setups: number;
    readonly runtime_timeouts: number;
    readonly delivery_401: number;
    readonly delivery_422: number;
    readonly duplicate_economic_opens: 0;
    readonly required_bindings_reviewed: boolean;
    readonly promotion_ready: boolean;
  };
}
```

Report `promotion_ready` as a review candidate only; do not mutate environment bindings or create a paper intent.

- [ ] **Step 4: Add authenticated GET routing and verify**

Run:

```bash
npm --prefix apps/observation-edge test -- \
  quentin-shadow-metrics-v32.test.ts worker.test.ts
npm --prefix apps/observation-edge run typecheck
```

- [ ] **Step 5: Commit the metrics slice**

```bash
git add apps/observation-edge/src/quentin-shadow-metrics-v32.ts \
  apps/observation-edge/test/quentin-shadow-metrics-v32.test.ts \
  apps/observation-edge/src/quentin-shadow-queries-v32.ts \
  apps/observation-edge/src/index.ts apps/observation-edge/test/worker.test.ts
git commit -m "feat: report Quentin shadow gate metrics"
```

---

## Task 11: Render the Shadow Report in the Operations Console

**Files:**

- Create: `apps/operations-console/src/lib/quentin-shadow-report.ts`
- Create: `apps/operations-console/src/components/QuentinShadowPanel.tsx`
- Create: `apps/operations-console/tests/quentin-shadow-report-api.test.ts`
- Create: `apps/operations-console/tests/quentin-shadow-panel.test.tsx`
- Modify: `apps/operations-console/src/components/PaperSimulationPanel.tsx`

**Interfaces:** Consumes `GET /api/v1/quentin-shadow-report`. Produces a read-only panel; no enable-paper button is introduced.

- [ ] **Step 1: Write failing strict-client and UI tests**

Test rejection of missing/unknown enum values, all-nine-symbol rendering, feed identity, stale/missing status, cohort separation, rejection reasons, gate progress, and a prominent shadow-only label.

```tsx
expect(screen.getByText("Quentin bot shadow v1")).toBeInTheDocument();
expect(screen.getByText("Shadow only — paper disabled")).toBeInTheDocument();
expect(screen.getByText("ONE_CANDLE")).toBeInTheDocument();
expect(screen.getByText("TWO_PLUS")).toBeInTheDocument();
expect(screen.queryByRole("button", { name: /enable paper/i })).not.toBeInTheDocument();
```

- [ ] **Step 2: Run the focused console tests and confirm failure**

Run:

```bash
npm --prefix apps/operations-console test -- \
  quentin-shadow-report-api.test.ts quentin-shadow-panel.test.tsx
```

- [ ] **Step 3: Implement strict client mapping**

Validate response shape before mapping snake_case wire fields. Treat an absent symbol row as a client error because the edge contract promises all nine symbols.

- [ ] **Step 4: Implement the read-only panel and mount it**

Show:

- per-symbol ticker/feed/last receipt and transport status;
- completed setup counts;
- `ONE_CANDLE` versus `TWO_PLUS`;
- wick-BOS versus close-BOS;
- `DIR_CLOSE` versus `BOC`;
- top rejection reasons;
- every forward-gate counter and binding status.

Mount below readiness and above existing decision/paper details. Keep existing panels unchanged.

- [ ] **Step 5: Verify focused and full console checks**

Run:

```bash
npm --prefix apps/operations-console test -- \
  quentin-shadow-report-api.test.ts quentin-shadow-panel.test.tsx paper-simulation.test.tsx
npm --prefix apps/operations-console run lint
npm --prefix apps/operations-console run typecheck
npm --prefix apps/operations-console test
```

- [ ] **Step 6: Commit the console slice**

```bash
git add apps/operations-console/src/lib/quentin-shadow-report.ts \
  apps/operations-console/src/components/QuentinShadowPanel.tsx \
  apps/operations-console/tests/quentin-shadow-report-api.test.ts \
  apps/operations-console/tests/quentin-shadow-panel.test.tsx \
  apps/operations-console/src/components/PaperSimulationPanel.tsx
git commit -m "feat: display Quentin shadow evidence"
```

---

## Task 12: Add Rollout, Rollback, and Forward-Shadow Gate Tooling

**Files:**

- Create: `scripts/check_quentin_shadow_gate.py`
- Create: `tests/unit/test_check_quentin_shadow_gate.py`
- Create: `docs/runbooks/quentin-bot-shadow-rollout.md`
- Modify: `README.md`

**Interfaces:** Consumes an exported `quentin-shadow-report/v1`. Produces a non-mutating pass/fail report and operator checklist. It cannot enable promotion.

- [ ] **Step 1: Write failing gate-checker tests**

Cover insufficient days, setups, symbols, fixtures, bindings, runtime errors, 401/422 errors, duplicate opens, and a passing report. Require nonzero exit on every failed condition.

- [ ] **Step 2: Run the tests and confirm missing checker failure**

Run: `uv run pytest tests/unit/test_check_quentin_shadow_gate.py -q`

- [ ] **Step 3: Implement the read-only checker**

```python
def evaluate_gate(report: QuentinShadowReportV1) -> GateDecision:
    failures = tuple(
        reason
        for reason, passed in (
            ("TRADING_DAYS_LT_10", report.gate.trading_days_observed >= 10),
            ("COMPLETED_SETUPS_LT_30", report.gate.completed_setups >= 30),
            ("SYMBOL_COVERAGE_LT_6", report.gate.symbols_with_completed_setups >= 6),
            ("RUNTIME_TIMEOUTS_NONZERO", report.gate.runtime_timeouts == 0),
            ("DELIVERY_401_NONZERO", report.gate.delivery_401 == 0),
            ("DELIVERY_422_NONZERO", report.gate.delivery_422 == 0),
            ("DUPLICATE_OPENS_NONZERO", report.gate.duplicate_economic_opens == 0),
            ("BINDINGS_UNREVIEWED", report.gate.required_bindings_reviewed),
        )
        if not passed
    )
    return GateDecision(passed=not failures, failures=failures)
```

- [ ] **Step 4: Write the operator runbook**

Document exact sequence:

1. deploy migration and worker;
2. install the Pine version and enable Quentin `3.2` profile;
3. delete/disable old Myrtille and stale `3.1` alerts used for this experiment;
4. create `Any alert() function call` alerts for all nine symbols on 5-minute charts with the existing webhook URL;
5. verify exact `ticker_id`, feed, and first natural `3.2` receipt per symbol;
6. treat any new 401/422 or `RE10110` as a rollout failure;
7. observe 10 trading days and 30 completed setups across at least 6 symbols;
8. export the report and run the checker;
9. review explicit bias/session/stop/target bindings;
10. create a separate implementation plan for a user-approved five-day GBPJPY paper canary.

Rollback is: disable/delete `3.2` alerts and clear any future promotion binding. It must not require reverting `3.1`.

- [ ] **Step 5: Run full verification**

Run:

```bash
uv run pytest tests/contract/test_quentin_bot_shadow_contract_v1.py \
  tests/unit/test_quentin_bot_shadow_v1.py \
  tests/unit/test_check_quentin_shadow_gate.py \
  tests/static/test_rd_three_entry_pine.py \
  tests/static/test_observation_receipt_migration.py -q
npm --prefix apps/observation-edge test
npm --prefix apps/observation-edge run lint
npm --prefix apps/observation-edge run typecheck
npm --prefix apps/operations-console test
npm --prefix apps/operations-console run lint
npm --prefix apps/operations-console run typecheck
make verify-generated
```

Expected: all checks pass; no paper/broker execution path exists.

- [ ] **Step 6: Commit the rollout slice**

```bash
git add scripts/check_quentin_shadow_gate.py \
  tests/unit/test_check_quentin_shadow_gate.py \
  docs/runbooks/quentin-bot-shadow-rollout.md README.md
git commit -m "docs: add Quentin shadow rollout gate"
```

---

## Completion Review

- [ ] Confirm every acceptance criterion in the approved design has a passing automated test or an explicit forward-shadow gate row.
- [ ] Confirm representative `3.1` valid and invalid payload responses are unchanged.
- [ ] Confirm a valid `3.2` event creates only isolated receipt/shadow rows and zero paper rows.
- [ ] Confirm all nine requested symbols appear in the report with exact ticker/feed identity.
- [ ] Confirm `ONE_CANDLE`, `TWO_PLUS`, wick-BOS, close-BOS, `DIR_CLOSE`, and `BOC` are independently measurable.
- [ ] Confirm the Pine profile defaults off and cannot emit `3.1` and `3.2` from the same saved alert snapshot.
- [ ] Confirm `paper_eligible` is always false and no UI/API control can change it.
- [ ] Confirm no full-history nested Pine scan was introduced and all object/state collections are bounded.
- [ ] Confirm forward observation remains a promotion proposal only; paper execution requires a separately approved plan.
