# V3 Paper Signal Authority Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stabilize one canonical V3.1 TradingView signal producer and observation-edge path that creates only authenticated paper/shadow evidence, with dual zone geometry, strict liquidity defaults, independent entry chronology, and no broker authority.

**Architecture:** The LAB Pine remains the single authoring source; a deterministic generator removes marked diagnostic-only blocks to create a release Pine with byte-identical protected detector/event code. Pine emits V3.1 observations and an independent default-off DIR_CLOSE paper proposal, while the observation edge performs strict versioned validation, idempotent persistence, and paper-only handling. Existing uncommitted work is treated as review evidence and is never copied wholesale.

**Tech Stack:** Pine Script v6, Python 3.12, pytest, Pydantic, JSON Schema 2020-12, TypeScript 5.9, Cloudflare Workers/D1, Vitest, Wrangler.

---

## Scope and file map

This plan implements Workstream A from
`docs/superpowers/specs/2026-08-21-v3-paper-signal-authority-migration-design.md`.
The independent `liquidity-supply-and-demand` research-hardening workstream gets
its own plan only after every acceptance gate in this plan passes.

### Pine ownership

- Modify `scripts/pinescript/SND_RD_5M_V3_THREE_ENTRY_LAB.pine`: canonical V3.1 detector, lifecycle, payload, and diagnostic source.
- Create `scripts/pinescript/SND_RD_5M_V3_RELEASE.pine`: generated release artifact; never edit by hand.
- Create `scripts/generate_rd_v3_release.py`: validate lab-only markers and generate the release artifact deterministically.
- Create `tests/unit/test_generate_rd_v3_release.py`: generator and protected-byte tests.
- Modify `tests/static/test_rd_three_entry_pine.py`: zone, lifecycle, cohort, chronology, and alert-surface contracts.
- Modify `tests/static/test_execution_proposal_v1_boundaries.py`: paper-only proposal and LAB/release capability boundaries.

### Contract ownership

- Modify `config/phase0/rd-strategy-rule-contract-v3.json`: canonical V3.1 contract bytes.
- Modify `docs/rd-strategy-rule-contract-v3.md`: human-readable V3.1 identity and safety rules.
- Modify `src/prop_trading/contracts/rd_strategy_v3.py`: Pydantic V3.1 literals.
- Modify `src/prop_trading/contracts/rd_entry_vectors_v3.py`: V3.1 vector-document literal.
- Modify `scripts/build_rd_entry_oracle_vectors_v3.py`: generate V3.1 vectors.
- Modify `contracts/schema/rd-strategy-rule-contract-v3.schema.json`: generated V3.1 schema.
- Modify `contracts/vectors/rd-entry-arbitration-v3.json`: generated V3.1 vectors.
- Modify `apps/observation-edge/src/rd-entry-vector-contract-v3.ts`: parse V3.1 oracle vectors.
- Modify `tests/contract/test_rd_strategy_rule_contract_v3.py`: canonical identity assertions.
- Modify `scripts/assert_frozen_specs.py`: reviewed V3.1 contract digest.

### Independent paper-proposal ownership

- Create `contracts/schema/rd-entry-execution-proposal-v1.schema.json`: closed Pine proposal contract.
- Create `contracts/schema/execution-candidate-v1.schema.json`: closed account-free candidate contract.
- Create `contracts/vectors/rd-entry-execution-proposal-v1.json`: reviewed positive and negative vectors.
- Create `docs/rd-entry-execution-proposal-v1.md`: authority and validation contract.
- Create `apps/observation-edge/src/execution-proposal-v1.ts`: strict proposal parser and candidate derivation.
- Create `apps/observation-edge/src/execution-proposal-ingestion.ts`: idempotent D1 composition and conflict handling.
- Create `apps/observation-edge/src/observation-outbox-dispatcher.ts`: disabled-by-default private delivery state machine.
- Create `apps/observation-edge/migrations/0029_observation_execution_proposal_v1.sql`: immutable proposal/paper/candidate facts and mutable delivery rows.
- Create `apps/observation-edge/test/execution-proposal-v1.test.ts`: schema/vector/domain parity.
- Create `apps/observation-edge/test/execution-proposal-ingestion.test.ts`: migration, authentication, idempotency, sequencing, and rollback tests.
- Create `apps/observation-edge/test/observation-outbox-dispatcher.test.ts`: lease, retry, expiry, and disabled-dispatch tests.
- Modify `apps/observation-edge/src/index.ts`: dispatch V1 proposals only on the existing authenticated observation route.
- Modify `apps/observation-edge/src/types.ts`: proposal binding and inert capability variables.
- Modify `apps/observation-edge/wrangler.jsonc`: all candidate emission/dispatch switches default false.
- Modify `tests/static/test_migration_foundation.py`: require contiguous migrations through 0029.
- Modify `docs/runbooks/rd-three-entry-paper-rollout.md`: migration and paper-only operational boundary.

## Task 1: Freeze the source inventory and clean baseline

**Files:**
- Create: `docs/reports/2026-08-21-v3-migration-source-inventory.md`

- [ ] **Step 1: Confirm the implementation worktree is isolated**

Run:

```bash
git status --short --branch
git rev-parse HEAD
git -C /Users/ameeramer/dev/projects/galilsoftware/sources/prop-trading-system status --short --branch
```

Expected: the implementation worktree contains only approved design/plan commits; the original checkout remains on `codex/fix-liquidity-display-arbitration` with its pre-existing modified and untracked files.

- [ ] **Step 2: Record the clean baseline test result**

Run:

```bash
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 python3 -m pytest -q -p no:cacheprovider \
  tests/static/test_rd_three_entry_pine.py \
  tests/static/test_execution_proposal_v1_boundaries.py \
  tests/static/test_migration_foundation.py
```

Expected baseline: `59 passed, 7 failed`. The failures must be limited to the absent independent proposal artifacts and the migration-count assertion that still stops before 0029. If another failure appears, stop and add it to the inventory before changing code.

- [ ] **Step 3: Hash every uncommitted candidate artifact before review**

Run:

```bash
git -C /Users/ameeramer/dev/projects/galilsoftware/sources/prop-trading-system diff --name-status
find /Users/ameeramer/dev/projects/galilsoftware/sources/prop-trading-system \
  -path '*/node_modules' -prune -o \
  \( -path '*/execution-proposal-v1.ts' \
     -o -path '*/execution-proposal-ingestion.ts' \
     -o -path '*/observation-outbox-dispatcher.ts' \
     -o -path '*/0029_observation_execution_proposal_v1.sql' \
     -o -path '*/rd-entry-execution-proposal-v1.schema.json' \
     -o -path '*/execution-candidate-v1.schema.json' \
     -o -path '*/rd-entry-execution-proposal-v1.json' \) \
  -type f -exec shasum -a 256 {} \;
```

Expected: each relevant untracked candidate has a SHA-256 digest; no file under `node_modules`, ZIP bundle, Phase C, account, broker, or MT5 scope is adopted.

- [ ] **Step 4: Write the inventory with an explicit disposition**

Create the report with this table and fill each digest from Step 3:

```markdown
# V3 migration source inventory

Base commit: 483c044
Original checkout: /Users/ameeramer/dev/projects/galilsoftware/sources/prop-trading-system

| Candidate | Digest | Disposition | Proof gate |
| --- | --- | --- | --- |
| V3 Pine dirty diff | Paste the `shasum -a 256` output for the binary diff verbatim | REVIEW_HUNKS_ONLY | Pine static tests + TradingView compile |
| execution proposal schemas/vectors | Paste each candidate file's `shasum -a 256` output verbatim | RECREATE_AND_COMPARE | schema/vector tests |
| proposal parser/ingestion/outbox | Paste each candidate file's `shasum -a 256` output verbatim | RECREATE_AND_COMPARE | Vitest + boundary scan |
| migration 0029 | Paste the candidate migration's `shasum -a 256` output verbatim | RECREATE_AND_COMPARE | fresh D1 migration tests |
| all other dirty/untracked paths | n/a | LEAVE_UNTOUCHED | original checkout status unchanged |
```

Replace every digest instruction with the recorded value before staging. No digest cell may still contain the word `Paste`.

- [ ] **Step 5: Verify and commit the inventory**

Run:

```bash
rg -n 'Paste|digest pending|value pending' docs/reports/2026-08-21-v3-migration-source-inventory.md
git diff --check
git add docs/reports/2026-08-21-v3-migration-source-inventory.md
git commit -m "docs: inventory V3 migration source"
```

Expected: `rg` prints nothing; commit contains only the inventory report.

## Task 2: Freeze one canonical V3.1 rule identity

**Files:**
- Modify: `tests/contract/test_rd_strategy_rule_contract_v3.py`
- Modify: `tests/static/test_boundaries.py`
- Modify: `config/phase0/rd-strategy-rule-contract-v3.json`
- Modify: `docs/rd-strategy-rule-contract-v3.md`
- Modify: `src/prop_trading/contracts/rd_strategy_v3.py`
- Modify: `src/prop_trading/contracts/rd_entry_vectors_v3.py`
- Modify: `scripts/build_rd_entry_oracle_vectors_v3.py`
- Modify: `apps/observation-edge/src/rd-entry-vector-contract-v3.ts`
- Modify: `contracts/schema/rd-strategy-rule-contract-v3.schema.json`
- Modify: `contracts/vectors/rd-entry-arbitration-v3.json`
- Modify: `scripts/assert_frozen_specs.py`

- [ ] **Step 1: Write failing V3.1 identity assertions**

Change the contract test assertions to:

```python
assert contract.contract_version == "3.1.0"
assert contract.producer_strategy_version == "3.1.0-contract3"
```

Add this boundary test:

```python
def test_active_v3_identity_is_consistent() -> None:
    contract = json.loads(
        Path("config/phase0/rd-strategy-rule-contract-v3.json").read_text()
    )
    pine = Path(
        "scripts/pinescript/SND_RD_5M_V3_THREE_ENTRY_LAB.pine"
    ).read_text()
    docs = Path("docs/rd-strategy-rule-contract-v3.md").read_text()

    assert contract["contract_version"] == "3.1.0"
    assert contract["producer_strategy_version"] == "3.1.0-contract3"
    assert 'ENTRY_SCHEMA_VERSION = "3.1"' in pine
    assert 'ENTRY_STRATEGY_VERSION = "3.1.0-contract3"' in pine
    assert 'ENTRY_RULE_CONTRACT_VERSION = "3.1.0"' in pine
    assert "contract version is `3.1.0`" in docs
    assert "producer version is `3.1.0-contract3`" in docs
```

- [ ] **Step 2: Run the tests and confirm the old 3.0 contract fails**

Run:

```bash
uv run pytest \
  tests/contract/test_rd_strategy_rule_contract_v3.py \
  tests/static/test_boundaries.py -q
```

Expected: FAIL on the old `3.0.0` and `3.0.0-contract3` values.

- [ ] **Step 3: Update the canonical contract, documentation, and Python literals**

Use these exact active values:

```json
"contract_version": "3.1.0",
"producer_strategy_version": "3.1.0-contract3"
```

Use these Pydantic literals:

```python
contract_version: Literal["3.1.0"]
producer_strategy_version: Literal["3.1.0-contract3"]
```

The V3 documentation introduction must say:

```markdown
The contract identity is `rd-5m-video-contract-v3`, the contract version is
`3.1.0`, the producer version is `3.1.0-contract3`, and the arbitration policy
is `rd-entry-arbitration-v3`.
```

- [ ] **Step 4: Move the oracle-vector document identity to V3.1**

Update both Python vector definitions and the TypeScript vector parser to use:

```text
rule_contract_version = 3.1.0
```

Do not remove the explicit V3.0 legacy branches from `rd-entry-wire-v3.ts` or `rd-entry-store-v3.ts`; stored V3.0 observations remain readable but cannot fall through to V3.1 parsing.

- [ ] **Step 5: Regenerate schema and oracle vectors**

Run:

```bash
uv run python scripts/export_schemas.py --output-dir contracts/schema
uv run python scripts/build_rd_entry_oracle_vectors_v3.py \
  --fixtures tests/fixtures/rd_entry_arbitration_cases_v3.json \
  --output contracts/vectors/rd-entry-arbitration-v3.json
```

Expected: generated schema constants and vector metadata say `3.1.0`; the 13 vector inputs and expected arbitration results are otherwise unchanged.

- [ ] **Step 6: Update the reviewed contract digest**

Freeze the superseding approved design alongside the new contract bytes:

```python
V3_PAPER_SIGNAL_AUTHORITY_DESIGN_SHA256 = (
    "ae3eaf99a7b29128662259941aae3969441d87243c713d1be57c5703b3dc69a2"
)
RD_STRATEGY_RULE_CONTRACT_V3_SHA256 = (
    "a9960e870fd563eb1e1de62725d0a26579198d7e0992726fd34cbc58a32e1345"
)
```

Extend `validate_frozen_v3_bytes(...)` (or add a focused companion validator)
so it checks
`docs/superpowers/specs/2026-08-21-v3-paper-signal-authority-migration-design.md`
against the new design digest. Keep the older July design and plan checks; the
new design explicitly authorizes only the V3.1 identity and safety changes in
this plan.

Run:

```bash
shasum -a 256 config/phase0/rd-strategy-rule-contract-v3.json
uv run python scripts/assert_frozen_specs.py
```

Expected digest: `a9960e870fd563eb1e1de62725d0a26579198d7e0992726fd34cbc58a32e1345`.

- [ ] **Step 7: Run contract and vector tests**

Run:

```bash
uv run pytest tests/contract/test_rd_strategy_rule_contract_v3.py \
  tests/static/test_boundaries.py -q
cd apps/observation-edge && npm test -- --run \
  test/rd-entry-vector-contract.test.ts \
  test/rd-entry-wire-v3.test.ts \
  test/rd-entry-store-v3.test.ts
```

Expected: PASS; explicit V3.0 compatibility fixtures still pass, and invalid mixed tuples remain rejected.

- [ ] **Step 8: Commit the frozen V3.1 identity**

Run:

```bash
git add config/phase0/rd-strategy-rule-contract-v3.json \
  docs/rd-strategy-rule-contract-v3.md \
  src/prop_trading/contracts/rd_strategy_v3.py \
  src/prop_trading/contracts/rd_entry_vectors_v3.py \
  scripts/build_rd_entry_oracle_vectors_v3.py \
  scripts/assert_frozen_specs.py \
  contracts/schema/rd-strategy-rule-contract-v3.schema.json \
  contracts/vectors/rd-entry-arbitration-v3.json \
  apps/observation-edge/src/rd-entry-vector-contract-v3.ts \
  tests/contract/test_rd_strategy_rule_contract_v3.py \
  tests/static/test_boundaries.py
git commit -m "fix: freeze canonical V3.1 rule identity"
```

## Task 3: Materialize independent standard and accuracy zones

**Files:**
- Modify: `tests/static/test_rd_three_entry_pine.py`
- Modify: `scripts/pinescript/SND_RD_5M_V3_THREE_ENTRY_LAB.pine`

- [ ] **Step 1: Add failing dual-geometry tests**

Add tests that require:

```python
assert "string formationId" in pine
assert "candidateFormationId(" in pine
assert (
    "buildConfirmedZone(Candidate candidate, bool demand, int zoneId, "
    "string formation, string formationId, bool accuracy)"
) in pine
assert "appendConfirmedZoneVariants(" in pine
assert confirmations.count("appendConfirmedZoneVariants(") == 2
assert confirmations.count("eventZone := standardZone") == 2
```

Within the materializer, assert exactly one standard creation and at most one accuracy sibling:

```python
assert materializer.count(
    "RawZone standardZone = buildConfirmedZone(candidate, demand, nextZoneId, formation, formationId, false)"
) == 1
assert materializer.count("if candidateHasAccuracyGeometry(candidate, demand)") == 1
assert materializer.count(
    "RawZone accuracyZone = buildConfirmedZone(candidate, demand, nextZoneId + 1, formation, formationId, true)"
) == 1
```

- [ ] **Step 2: Run the new test and verify the single-zone builder fails**

Run:

```bash
PYTHONPATH=src python3 -m pytest \
  tests/static/test_rd_three_entry_pine.py::test_pine_v3_materializes_standard_and_accuracy_variants_from_one_confirmation \
  -q
```

Expected: FAIL because the current builder replaces standard geometry with accuracy geometry.

- [ ] **Step 3: Add shared formation identity and explicit geometry selection**

Extend `RawZone` with:

```pine
    string formationId
```

Add:

```pine
candidateFormationId(Candidate candidate, bool demand) =>
    (demand ? "D:" : "S:") + str.tostring(candidate.originTime) + ":" + str.tostring(candidate.originBar)

candidateHasAccuracyGeometry(Candidate candidate, bool demand) =>
    demand ? candidate.originHigh > candidate.firstDepartureHigh : candidate.originLow < candidate.firstDepartureLow
```

Change the builder signature and assignments to:

```pine
buildConfirmedZone(Candidate candidate, bool demand, int zoneId, string formation, string formationId, bool accuracy) =>
    string geometry = accuracy ? GEOMETRY_ACCURACY : GEOMETRY_STANDARD
    float bodyHigh = math.max(candidate.originOpen, candidate.originClose)
    float bodyLow = math.min(candidate.originOpen, candidate.originClose)
    float frozenTop = accuracy and demand ? bodyHigh : candidate.originHigh
    float frozenBottom = accuracy and not demand ? bodyLow : candidate.originLow
    // Preserve the existing distal expansion and all existing field initialization.
    RawZone zone = RawZone.new()
    zone.id := zoneId
    zone.formationId := formationId
    zone.geometry := geometry
```

- [ ] **Step 4: Add one materializer used by both confirmation directions**

Implement:

```pine
appendConfirmedZoneVariants(Candidate candidate, bool demand, int nextZoneId, string formation, array<RawZone> zoneItems) =>
    string formationId = candidateFormationId(candidate, demand)
    RawZone standardZone = buildConfirmedZone(candidate, demand, nextZoneId, formation, formationId, false)
    array.unshift(zoneItems, standardZone)
    int createdCount = 1
    if candidateHasAccuracyGeometry(candidate, demand)
        RawZone accuracyZone = buildConfirmedZone(candidate, demand, nextZoneId + 1, formation, formationId, true)
        array.unshift(zoneItems, accuracyZone)
        createdCount := 2
    [standardZone, createdCount]
```

Replace each direct demand/supply `buildConfirmedZone` call with:

```pine
[standardZone, createdCount] = appendConfirmedZoneVariants(candidate, demand, nextZoneId, formation, zones)
nextZoneId += createdCount
eventZone := standardZone
```

Use the actual candidate variable and direction in each branch. Never share lifecycle fields, drawings, liquidity indexes, or entry attempts between siblings.

- [ ] **Step 5: Make tapped zones auditable in LAB clean view**

Set:

```pine
showTapped = input.bool(true, "Show tapped zones", group = "Display")
```

Use one lifecycle predicate in curated visibility:

```pine
zoneIncludedInCuratedView(RawZone zone) =>
    bool lifecycleIncluded = zone.state == STATE_FRESH ? showFresh : zone.state == STATE_TAPPED ? showTapped : showInvalidated
    displayMode == DISPLAY_SETUPS_ONLY ? setupIncludedInView(zone) : lifecycleIncluded and (displayMode != DISPLAY_QUALIFIED_ONLY or zone.liquidityQualified)
```

`zoneVisible` must call `zoneIncludedInCuratedView(zone)` without adding a second `showFresh` gate.

- [ ] **Step 6: Run all Pine static tests**

Run:

```bash
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 python3 -m pytest -q -p no:cacheprovider \
  tests/static/test_rd_three_entry_pine.py
```

Expected: PASS, including both demand/supply materialization, stable standard `eventZone`, independent IDs, and tapped-zone lifecycle visibility.

- [ ] **Step 7: Commit dual geometry**

Run:

```bash
git add scripts/pinescript/SND_RD_5M_V3_THREE_ENTRY_LAB.pine \
  tests/static/test_rd_three_entry_pine.py
git commit -m "fix: preserve standard and accuracy zone variants"
```

## Task 4: Default one-candle liquidity off and prove shadow-only handling

**Files:**
- Modify: `tests/static/test_rd_three_entry_pine.py`
- Modify: `scripts/pinescript/SND_RD_5M_V3_THREE_ENTRY_LAB.pine`
- Modify: `apps/observation-edge/src/rd-entry-store-v3.ts`
- Modify: `apps/observation-edge/test/rd-entry-store-v3.test.ts`

- [ ] **Step 1: Replace the unsafe default test**

Rename the existing default test and require:

```python
def test_pine_v3_one_candle_liquidity_defaults_off() -> None:
    pine = source()
    assert (
        'enableOneCandleLiquidity = input.bool(false, '
        '"Enable one-candle liquidity", group = "Liquidity")'
    ) in pine
    assert (
        "minimumLiquidityOppositeCandles() =>\n"
        "    enableOneCandleLiquidity ? 1 : 2"
    ) in pine
```

Keep the existing selection assertions that require `SHADOW_ONLY` and prohibit `PAPER_ELIGIBLE` inside the one-candle override.

- [ ] **Step 2: Run the test and verify the current true default fails**

Run:

```bash
PYTHONPATH=src python3 -m pytest \
  tests/static/test_rd_three_entry_pine.py::test_pine_v3_one_candle_liquidity_defaults_off \
  -q
```

Expected: FAIL on `input.bool(true, ...)`.

- [ ] **Step 3: Change only the default, not the observation capability**

Set:

```pine
enableOneCandleLiquidity = input.bool(false, "Enable one-candle liquidity", group = "Liquidity")
```

Preserve cohort serialization and the existing selection override. Use one canonical terminal reason:

```pine
action := "SHADOW_ONLY"
reason := "ONE_CANDLE_EXPERIMENT_NOT_PROMOTED"
```

- [ ] **Step 4: Add an edge negative test for attempted promotion**

Add `ONE_CANDLE_EXPERIMENT_NOT_PROMOTED` to `EffectiveActionReason`, then add a test that mutates a valid one-candle bundle to `PAPER_ELIGIBLE`, appends it, and asserts:

```ts
expect(result.evaluations[0]).toMatchObject({
  effectiveAction: "SHADOW_ONLY",
  effectiveActionReason: "ONE_CANDLE_EXPERIMENT_NOT_PROMOTED",
});
expect(result.paperIntentIds).toEqual([]);
```

Use the existing `oneCandlePayloadFor(...)`, `observation(...)`, and `payloadDigest(...)` helpers; do not invent a second fixture format.

Apply the override before promotion-identity, already-open, and paper-configuration checks:

```ts
if (
  selection.action === "PAPER_ELIGIBLE" &&
  bundle.setup.liquidity_cohort === "ONE_CANDLE"
) {
  effectiveAction = "SHADOW_ONLY";
  effectiveActionReason = "ONE_CANDLE_EXPERIMENT_NOT_PROMOTED";
} else if (selection.action === "PAPER_ELIGIBLE") {
  // Preserve the existing identity, already-open, and configuration checks.
}
```

- [ ] **Step 5: Run Pine and store tests**

Run:

```bash
PYTHONPATH=src python3 -m pytest tests/static/test_rd_three_entry_pine.py -q
cd apps/observation-edge && npm test -- --run test/rd-entry-store-v3.test.ts
```

Expected: PASS; strict two-plus-candle fixtures remain paper-eligible, one-candle fixtures never create paper intent.

- [ ] **Step 6: Commit the cohort safety default**

Run:

```bash
git add scripts/pinescript/SND_RD_5M_V3_THREE_ENTRY_LAB.pine \
  tests/static/test_rd_three_entry_pine.py \
  apps/observation-edge/src/rd-entry-store-v3.ts \
  apps/observation-edge/test/rd-entry-store-v3.test.ts
git commit -m "fix: keep one-candle liquidity shadow only"
```

## Task 5: Freeze the independent paper-proposal contracts

**Files:**
- Create: `contracts/schema/rd-entry-execution-proposal-v1.schema.json`
- Create: `contracts/schema/execution-candidate-v1.schema.json`
- Create: `contracts/vectors/rd-entry-execution-proposal-v1.json`
- Create: `docs/rd-entry-execution-proposal-v1.md`
- Create: `apps/observation-edge/src/execution-proposal-v1.ts`
- Create: `apps/observation-edge/test/execution-proposal-v1.test.ts`
- Modify: `contracts/README.md`

- [ ] **Step 1: Run the existing frozen-boundary test red**

Run:

```bash
PYTHONPATH=src python3 -m pytest \
  tests/static/test_execution_proposal_v1_boundaries.py::test_v1_contract_bytes_are_frozen_while_v2_reconstruction_is_paper_only \
  -q
```

Expected: FAIL because the three V1 contract/vector files do not exist.

- [ ] **Step 2: Create the closed proposal schema**

The proposal schema must use `additionalProperties: false` and require the exact fields pinned by `test_execution_proposal_v1_boundaries.py`. Its authority constants are:

```json
{
  "schema_version": { "const": "rd-entry-execution-proposal-v1" },
  "strategy_version": { "const": "rd-entry-execution-proposal-v1" },
  "execution_mode": { "const": "PAPER_ONLY" },
  "delivery_kind": { "const": "LIVE" },
  "ingest_integrity": { "const": "LIVE_CONTIGUOUS" },
  "timeframe": { "const": "M5" },
  "entry_model": { "const": "DIR_CLOSE" },
  "liquidity_cohort": { "const": "TWO_PLUS_CANDLES" },
  "selection_fidelity": { "const": "EXACT" },
  "selection_action": { "const": "PAPER_ELIGIBLE" },
  "evidence_replayability": { "const": "REPLAYABLE" }
}
```

The only V1 source symbols are `EURUSD`, `GBPJPY`, `USDJPY`, `XAUUSD`, and `NAS100`. Closed M5 candles require `closed: true` and safe integer-tick OHLC.

- [ ] **Step 3: Create the account-free candidate schema**

Require:

```json
{
  "schema_version": { "const": "ExecutionCandidateV1" },
  "proposal_schema_version": { "const": "rd-entry-execution-proposal-v1" },
  "execution_mode": { "const": "PAPER_ONLY" },
  "logical_candidate_id": { "$ref": "#/$defs/sha256" },
  "candidate_body_sha256": { "$ref": "#/$defs/sha256" }
}
```

Do not add account, broker, order, position, MT5, command, lot-size, or live-execution fields.

- [ ] **Step 4: Create reviewed bindings and vectors**

Before recreating the vector document, verify the candidate evidence file:

```bash
shasum -a 256 \
  /Users/ameeramer/dev/projects/galilsoftware/sources/prop-trading-system/contracts/vectors/rd-entry-execution-proposal-v1.json
```

Expected: `befa7307332e6ed3604910e59a660529632298d10f783c314025c9d341773076`.
Recreate those reviewed binding preimages and positive/negative cases byte-for-byte through `apply_patch`, then review them semantically. The negative cases must cover every closed field, wrong feed/tick size/hash, stale timing, unsafe integer, invalid wick direction, non-4R geometry, one-candle cohort, BOC, HTF_FLIP, shadow action, historical delivery, and unknown keys.

- [ ] **Step 5: Implement strict parsing and deterministic candidate derivation**

Expose the schema-matching `ExecutionProposalV1Candle`, `ExecutionProposalV1`, `ExecutionCandidateV1`, and `ExecutionProposalV1ReviewedIdentity` interfaces. The public validation functions are:

```ts
export function validateExecutionProposalV1(
  value: unknown,
  reviewedIdentityValue: unknown,
): ExecutionProposalV1;

export async function deriveExecutionCandidateV1(
  value: unknown,
  reviewedIdentityValue: unknown,
): Promise<ExecutionCandidateV1>;
```

Use `parseStrictJson` and exact-key validation. Derive the logical candidate ID and body digest from canonical JSON bytes; never accept either digest from Pine.

- [ ] **Step 6: Test schema, vector, and runtime parity**

Run:

```bash
cd apps/observation-edge && npm test -- --run test/execution-proposal-v1.test.ts
PYTHONPATH=src python3 -m pytest \
  tests/static/test_execution_proposal_v1_boundaries.py::test_v1_contract_bytes_are_frozen_while_v2_reconstruction_is_paper_only \
  -q
```

Expected: PASS and these exact frozen digests:

```text
rd-entry-execution-proposal-v1.schema.json fc4e48c143fbb798d76d24f600e3eb5fb8b6861224e8f33f5107a4b1ab8e7e8e
execution-candidate-v1.schema.json          9b679687d0b2e56795d4e675160c29a6d7c2d6d744886ea4187fd8fe6c61ac85
rd-entry-execution-proposal-v1.json        befa7307332e6ed3604910e59a660529632298d10f783c314025c9d341773076
```

If recreated bytes do not match, compare semantics field-by-field; do not weaken or update the frozen test merely to accept different bytes.

- [ ] **Step 7: Commit the frozen paper contract**

Run:

```bash
git add contracts/schema/rd-entry-execution-proposal-v1.schema.json \
  contracts/schema/execution-candidate-v1.schema.json \
  contracts/vectors/rd-entry-execution-proposal-v1.json \
  contracts/README.md docs/rd-entry-execution-proposal-v1.md \
  apps/observation-edge/src/execution-proposal-v1.ts \
  apps/observation-edge/test/execution-proposal-v1.test.ts
git commit -m "feat: freeze paper execution proposal v1"
```

## Task 6: Add immutable proposal ingestion and inert outbox state

**Files:**
- Create: `apps/observation-edge/migrations/0029_observation_execution_proposal_v1.sql`
- Create: `apps/observation-edge/src/execution-proposal-ingestion.ts`
- Create: `apps/observation-edge/src/observation-outbox-dispatcher.ts`
- Create: `apps/observation-edge/test/execution-proposal-ingestion.test.ts`
- Create: `apps/observation-edge/test/observation-outbox-dispatcher.test.ts`
- Modify: `apps/observation-edge/src/types.ts`
- Modify: `apps/observation-edge/src/index.ts`
- Modify: `apps/observation-edge/wrangler.jsonc`
- Modify: `tests/static/test_migration_foundation.py`
- Modify: `docs/runbooks/rd-three-entry-paper-rollout.md`

- [ ] **Step 1: Add the missing migration and route tests first**

Adopt the existing red tests in `tests/static/test_execution_proposal_v1_boundaries.py` and add Vitest cases for:

```ts
it("accepts proposal v1 on the existing authenticated observation route", async () => {});
it("replays an identical producer sequence idempotently", async () => {});
it("quarantines sequence gaps, out-of-order events, and body conflicts", async () => {});
it("rolls back event, result, checkpoint, payload, and delivery atomically", async () => {});
it("keeps candidate emission and dispatch independently disabled", async () => {});
it("expires rather than dispatches a stale candidate", async () => {});
```

- [ ] **Step 2: Run the new tests red**

Run:

```bash
cd apps/observation-edge && npm test -- --run \
  test/execution-proposal-ingestion.test.ts \
  test/observation-outbox-dispatcher.test.ts
```

Expected: FAIL because migration 0029 and the ingestion/dispatcher modules do not exist.

- [ ] **Step 3: Create strict migration 0029**

Create these tables as `STRICT`:

```text
observation_execution_proposal_v1_events
observation_execution_proposal_v1_paper_results
observation_execution_producer_checkpoints
observation_execution_producer_incidents
observation_execution_candidate_v1_payloads
observation_execution_candidate_v1_deliveries
```

Proposal, result, checkpoint, incident, and candidate payload facts are append-only through `BEFORE UPDATE` and `BEFORE DELETE` abort triggers. Only delivery lease/retry/acknowledgement state is mutable. Database checks enforce `PAPER_ONLY`, `DIR_CLOSE`, safe risk distance, direction-correct SL, and exact 4R target geometry.

- [ ] **Step 4: Add inert environment capabilities**

Extend `Env` with:

```ts
readonly RD_EXECUTION_PROPOSAL_V1_REVIEWED_IDENTITIES_JSON?: string;
readonly RD_EXECUTION_CANDIDATE_EMISSION_ENABLED?: string;
readonly RD_EXECUTION_CANDIDATE_DISPATCH_ENABLED?: string;
readonly RD_EXECUTION_RECEIVER_MANIFEST_SHA256?: string;
```

Set these Wrangler defaults:

```json
"RD_EXECUTION_CANDIDATE_EMISSION_ENABLED": "false",
"RD_EXECUTION_CANDIDATE_DISPATCH_ENABLED": "false",
"RD_EXECUTION_RECEIVER_MANIFEST_SHA256": "INERT_NOT_CONFIGURED"
```

- [ ] **Step 5: Implement atomic ingestion**

Expose:

```ts
export async function ingestExecutionProposalV1(
  env: Env,
  proposalBytes: Uint8Array,
  receivedAtEpoch: number,
): Promise<Response>;
```

The function must validate before writing, compute proposal/candidate digests, enforce contiguous producer sequence, return the stored response for an identical retry, quarantine conflicts, and compose the event, paper result, checkpoint, optional candidate payload, and optional delivery in one `env.DB.batch(...)` transaction.

- [ ] **Step 6: Route only the known proposal discriminator**

In the existing authenticated `/api/v1/tradingview/observations` handler, parse the strict envelope once. Dispatch to proposal ingestion only when:

```ts
payload.schema_version === "rd-entry-execution-proposal-v1"
```

All existing observation schemas retain their current routes. Do not add `/execution`, `/instructions`, `/dispatcher`, or `/receiver` public routes.

- [ ] **Step 7: Implement private, disabled-by-default outbox handling**

Expose claim/finalize functions whose public outcomes are:

```ts
type DeliveryStatus =
  | "PENDING"
  | "RETRY"
  | "CLAIMED"
  | "ACKNOWLEDGED"
  | "EXPIRED"
  | "FAILED_TERMINAL";
```

When dispatch is false or the receiver manifest is inert, no network call occurs. Expired candidates transition to `EXPIRED`; transient failures return to `RETRY` with bounded backoff; claims require a lease owner and expiry.

- [ ] **Step 8: Update migration and runbook assertions**

Require contiguous migrations through 0029 and document:

```text
D1 is migrated through 0029;
0028_observation_entry_v3_liquidity_cohorts.sql
0029_observation_execution_proposal_v1.sql
```

The runbook must state that candidate emission and dispatch are disabled and that no account or broker execution exists.

- [ ] **Step 9: Run ingestion, migration, and boundary tests**

Run:

```bash
cd apps/observation-edge && npm test -- --run \
  test/execution-proposal-ingestion.test.ts \
  test/observation-outbox-dispatcher.test.ts \
  test/worker.test.ts
cd ../.. && PYTHONPATH=src python3 -m pytest \
  tests/static/test_execution_proposal_v1_boundaries.py \
  tests/static/test_migration_foundation.py -q
```

Expected: PASS; database fault injection leaves zero partial rows; all authority flags remain false.

- [ ] **Step 10: Commit proposal ingestion**

Run:

```bash
git add apps/observation-edge/migrations/0029_observation_execution_proposal_v1.sql \
  apps/observation-edge/src/execution-proposal-ingestion.ts \
  apps/observation-edge/src/observation-outbox-dispatcher.ts \
  apps/observation-edge/src/index.ts apps/observation-edge/src/types.ts \
  apps/observation-edge/wrangler.jsonc \
  apps/observation-edge/test/execution-proposal-ingestion.test.ts \
  apps/observation-edge/test/observation-outbox-dispatcher.test.ts \
  tests/static/test_migration_foundation.py \
  docs/runbooks/rd-three-entry-paper-rollout.md
git commit -m "feat: ingest paper proposals without execution authority"
```

## Task 7: Emit an independent closed DIR_CLOSE proposal from Pine

**Files:**
- Modify: `tests/static/test_execution_proposal_v1_boundaries.py`
- Modify: `tests/static/test_rd_three_entry_pine.py`
- Modify: `scripts/pinescript/SND_RD_5M_V3_THREE_ENTRY_LAB.pine`

- [ ] **Step 1: Add the three-alert and non-mutation tests**

Require exactly:

```python
assert v3_emitter.count("alert(") == 2
assert proposal_emitter.count("alert(") == 1
assert proposal_emitter.count("alert(envelope, alert.freq_all)") == 1
assert "alert(envelope, alert.freq_once_per_bar_close)" not in proposal_emitter
assert pine.count("alert(") == 3
```

Retain every forbidden mutation in `test_proposal_path_cannot_mutate_or_promote_legacy_v3`.

- [ ] **Step 2: Run Pine proposal tests red**

Run:

```bash
PYTHONPATH=src python3 -m pytest \
  tests/static/test_execution_proposal_v1_boundaries.py::test_pine_proposal_is_closed_realtime_exact_dir_close_only \
  tests/static/test_execution_proposal_v1_boundaries.py::test_pine_proposal_serializes_frozen_geometry_and_exact_four_r \
  tests/static/test_rd_three_entry_pine.py::test_pine_v3_has_only_schema_v3_alert_surface \
  -q
```

Expected: FAIL because the proposal emitter is absent and Pine contains only two observation alerts.

- [ ] **Step 3: Add independent default-off proposal inputs and state**

Add:

```pine
emitExecutionProposalV1 = input.bool(false, "Emit execution proposal v1", group = "Automation")
executionProposalV1Credential = input.string("", "Execution proposal v1 credential", group = "Automation")
const int EXECUTION_PROPOSAL_V1_MAX_PAYLOAD_CHARS = 35000
var array<int> executionProposalV1SequenceState = array.new<int>(1, 0)
```

Keep `emitEntryV3Events` independent and default false.

- [ ] **Step 4: Implement closed eligibility**

`executionProposalV1Eligible(attempt)` must require all of:

```pine
barstate.isrealtime
barstate.isconfirmed
attempt.directionalClose.closeEmitted
attempt.core.liquidityCohort == LIQUIDITY_COHORT_TWO_PLUS
attempt.core.commonRulesPass
executionProposalV1ReviewedHashesValid()
executionProposalV1SupportedSymbol()
attempt.core.engagementEpoch - attempt.core.referenceOpenEpoch == 300
attempt.directionalClose.closeEventEpoch - attempt.directionalClose.closeOpenEpoch == 300
attempt.core.engagementEpoch <= attempt.directionalClose.closeEventEpoch
observedAtEpoch <= attempt.directionalClose.closeEventEpoch + 30
```

BOC, HTF_FLIP, one-candle, shadow, historical, unreviewed, stale, and non-M5 attempts return false.

- [ ] **Step 5: Serialize frozen exact-4R geometry**

Derive only from frozen attempt facts:

```pine
wickReferenceTicks = attempt.core.demand ? attempt.core.referenceLowTicks : attempt.core.referenceHighTicks
stopTicks = attempt.core.demand ? wickReferenceTicks - bufferTicks : wickReferenceTicks + bufferTicks
riskDistanceTicks = math.abs(entryTicks - stopTicks)
targetTicks = attempt.core.demand ? entryTicks + riskDistanceTicks * 4 : entryTicks - riskDistanceTicks * 4
```

Serialize the exact closed engagement and source candles, reviewed hashes, symbol/feed/tick size, strict cohort, `DIR_CLOSE`, `EXACT`, `PAPER_ELIGIBLE`, `REPLAYABLE`, `LIVE`, `LIVE_CONTIGUOUS`, and `PAPER_ONLY`.

- [ ] **Step 6: Emit without mutating V3 state**

Implement:

```pine
emitExecutionProposalV1ForAttempt(EntryAttempt attempt) =>
    bool emitted = false
    if emitExecutionProposalV1 and executionProposalV1Eligible(attempt)
        int nextSequence = array.get(executionProposalV1SequenceState, 0) + 1
        string payload = executionProposalV1Payload(attempt, nextSequence)
        string envelope = "{\"credential\":" + jsonString(executionProposalV1Credential) + ",\"payload\":" + payload + "}"
        if str.length(envelope) < EXECUTION_PROPOSAL_V1_MAX_PAYLOAD_CHARS
            alert(envelope, alert.freq_all)
            array.set(executionProposalV1SequenceState, 0, nextSequence)
            emitted := true
    emitted
```

Call it after existing observation emission and exit monitoring but before storing the updated attempt. It must not call `entryPlanFacts`, mutate entry/stop/target facts, mark a paper decision, draw a trade, or suppress observation emission.

- [ ] **Step 7: Run every Pine boundary test**

Run:

```bash
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 python3 -m pytest -q -p no:cacheprovider \
  tests/static/test_rd_three_entry_pine.py \
  tests/static/test_execution_proposal_v1_boundaries.py
```

Expected: PASS; Pine contains three alert call sites—two V3 observation frequencies and one independent realtime proposal frequency.

- [ ] **Step 8: Commit Pine proposal emission**

Run:

```bash
git add scripts/pinescript/SND_RD_5M_V3_THREE_ENTRY_LAB.pine \
  tests/static/test_rd_three_entry_pine.py \
  tests/static/test_execution_proposal_v1_boundaries.py
git commit -m "feat: emit independent paper DIR_CLOSE proposals"
```

## Task 8: Generate a minimal release Pine from the LAB source

**Files:**
- Create: `scripts/generate_rd_v3_release.py`
- Create: `tests/unit/test_generate_rd_v3_release.py`
- Create: `scripts/pinescript/SND_RD_5M_V3_RELEASE.pine`
- Modify: `scripts/pinescript/SND_RD_5M_V3_THREE_ENTRY_LAB.pine`
- Modify: `Makefile`
- Modify: `tests/static/test_execution_proposal_v1_boundaries.py`

- [ ] **Step 1: Write generator failure tests**

Add tests for duplicate, nested-crossed, unmatched-end, and unclosed markers:

```python
@pytest.mark.parametrize(
    ("source", "message"),
    [
        ("// @lab-only-end x\n", "unexpected lab-only end: x"),
        ("// @lab-only-begin x\n", "unclosed lab-only section: x"),
        ("// @lab-only-begin x\n// @lab-only-begin x\n", "duplicate lab-only section: x"),
        ("// @lab-only-begin x\n// @lab-only-begin y\n// @lab-only-end x\n", "crossed lab-only section: x"),
    ],
)
def test_generate_release_rejects_invalid_markers(source: str, message: str) -> None:
    with pytest.raises(ValueError, match=re.escape(message)):
        generate_release(source)
```

Add a positive test proving outside bytes are unchanged and marked bytes are absent.

- [ ] **Step 2: Run generator tests red**

Run:

```bash
uv run pytest tests/unit/test_generate_rd_v3_release.py -q
```

Expected: FAIL because the generator module does not exist.

- [ ] **Step 3: Implement deterministic marker stripping**

Implement:

```python
BEGIN = re.compile(r"^// @lab-only-begin ([a-z0-9-]+)\n$")
END = re.compile(r"^// @lab-only-end ([a-z0-9-]+)\n$")

def generate_release(source: str) -> str:
    stack: list[str] = []
    seen: set[str] = set()
    output: list[str] = []
    for line in source.splitlines(keepends=True):
        if match := BEGIN.fullmatch(line):
            name = match.group(1)
            if name in seen:
                raise ValueError(f"duplicate lab-only section: {name}")
            seen.add(name)
            stack.append(name)
        elif match := END.fullmatch(line):
            name = match.group(1)
            if not stack:
                raise ValueError(f"unexpected lab-only end: {name}")
            if stack[-1] != name:
                raise ValueError(f"crossed lab-only section: {name}")
            stack.pop()
        elif not stack:
            output.append(line)
    if stack:
        raise ValueError(f"unclosed lab-only section: {stack[-1]}")
    return "".join(output).replace(
        'indicator("SND RD 5M V3 THREE ENTRY LAB"',
        'indicator("SND RD 5M V3 RELEASE"',
        1,
    )
```

The CLI reads the LAB path, writes `SND_RD_5M_V3_RELEASE.pine`, and supports `--check` to compare generated bytes without writing.

- [ ] **Step 4: Mark only diagnostic-only LAB blocks**

Add paired markers around status-table rendering, debug-only labels, validation capture UI, and verbose audit drawings. Do not mark detector types/functions, zone/liquidity state transitions, entry attempts, chronology, payload builders, credential guards, or alert emitters. Each removed block must have no unmarked call site or required variable reference.

- [ ] **Step 5: Generate the release script and add drift checks**

Run:

```bash
uv run python scripts/generate_rd_v3_release.py
uv run python scripts/generate_rd_v3_release.py --check
```

Add this Makefile command under `verify-generated`:

```make
	$(PYTHON) scripts/generate_rd_v3_release.py --check
```

- [ ] **Step 6: Prove protected semantics and authority are identical**

The unit test must strip title and lab-only blocks, extract the protected region from the first V3 constant through the final alert-emission call, and assert equal SHA-256 digests for LAB and release. Static boundary tests must assert both files contain:

```text
ENTRY_EXECUTION_MODE = "PAPER_ONLY"
emitEntryPayload(
emitExecutionProposalV1ForAttempt(
```

and neither contains `strategy.entry`, `strategy.exit`, account, broker, order, MT5, command, or live-execution authority.

- [ ] **Step 7: Run generator and Pine tests**

Run:

```bash
uv run pytest tests/unit/test_generate_rd_v3_release.py \
  tests/static/test_rd_three_entry_pine.py \
  tests/static/test_execution_proposal_v1_boundaries.py -q
uv run python scripts/generate_rd_v3_release.py --check
```

Expected: PASS and no generated diff.

- [ ] **Step 8: Commit generator and release artifact**

Run:

```bash
git add scripts/generate_rd_v3_release.py \
  scripts/pinescript/SND_RD_5M_V3_THREE_ENTRY_LAB.pine \
  scripts/pinescript/SND_RD_5M_V3_RELEASE.pine \
  tests/unit/test_generate_rd_v3_release.py \
  tests/static/test_execution_proposal_v1_boundaries.py Makefile
git commit -m "build: generate V3 release Pine from LAB"
```

## Task 9: Run full local verification and record TradingView acceptance

**Files:**
- Create: `docs/reports/2026-08-21-v3-paper-signal-authority-verification.md`
- Modify only if a verified defect is found: files owned by Tasks 2–8

- [ ] **Step 1: Install locked dependencies**

Run:

```bash
uv sync --locked --python 3.12
cd apps/observation-edge && npm ci --ignore-scripts --no-audit --no-fund
```

Expected: lockfiles remain unchanged.

- [ ] **Step 2: Run focused verification**

Run:

```bash
uv run pytest \
  tests/contract/test_rd_strategy_rule_contract_v3.py \
  tests/static/test_rd_three_entry_pine.py \
  tests/static/test_execution_proposal_v1_boundaries.py \
  tests/static/test_migration_foundation.py \
  tests/unit/test_generate_rd_v3_release.py -q
cd apps/observation-edge && npm run lint && npm run typecheck && npm test && npm run build
```

Expected: every command exits zero; Wrangler build is dry-run only.

- [ ] **Step 3: Run repository safety checks**

Run:

```bash
uv run python scripts/generate_rd_v3_release.py --check
uv run python scripts/assert_frozen_specs.py
uv run python scripts/static_boundary_check.py --root .
make verify-generated
make secret-scan
```

Expected: generated artifacts match, no credential is committed, and no execution authority is found.

- [ ] **Step 4: Compile and add both scripts in TradingView**

For `SND_RD_5M_V3_THREE_ENTRY_LAB.pine` and `SND_RD_5M_V3_RELEASE.pine`:

1. Open a five-minute chart on a supported reviewed feed.
2. Paste the exact committed script bytes into a new Pine editor tab.
3. Save with the commit SHA in the title/description.
4. Compile and add to chart.
5. Record compiler output, script SHA-256, ticker ID, feed, tick size, timeframe, input snapshot, and UTC timestamp.

Expected: zero compiler errors; no persistent alert is created.

- [ ] **Step 5: Verify confirmed reload and realtime chronology**

Capture evidence for:

```text
confirmed DIR_CLOSE before reload == confirmed DIR_CLOSE after reload
historical BOC/HTF_FLIP from OHLC-only range == UNRESOLVED or absent
live ordered BOC == LIVE_EXACT_NON_REPLAYABLE
live ordered HTF_FLIP == LIVE_EXACT_NON_REPLAYABLE
same-event BOC/HTF_FLIP candidates == both retained
one-candle enabled observation == SHADOW_ONLY / ONE_CANDLE_EXPERIMENT_NOT_PROMOTED
```

If continuous realtime tick evidence is unavailable, mark the acceptance gate `NOT_PROVEN` and stop. Do not substitute historical replay or a synthetic HTTP request.

- [ ] **Step 6: Write the verification report**

The report must record exact artifact references for the commit, LAB SHA-256,
release SHA-256, contract SHA-256
`a9960e870fd563eb1e1de62725d0a26579198d7e0992726fd34cbc58a32e1345`, focused
tests, observation-edge lint/typecheck/test/build, generated/frozen/boundary/secret
checks, both TradingView compiles, confirmed reload parity, live BOC chronology,
live HTF_FLIP chronology, same-event co-trigger evidence, one-candle shadow
evidence, original-checkout status, and the overall `PASS` or `NOT_PROVEN` result.

Every line must contain an artifact reference or command result. `PASS` is prohibited if any line is missing or `NOT_PROVEN`.

- [ ] **Step 7: Confirm the original checkout was not modified**

Run:

```bash
git -C /Users/ameeramer/dev/projects/galilsoftware/sources/prop-trading-system status --short --branch
```

Expected: identical path/status inventory to Task 1 except for user changes made independently during implementation; no implementation commit or generated file appears there.

- [ ] **Step 8: Commit verification evidence**

Run:

```bash
git add docs/reports/2026-08-21-v3-paper-signal-authority-verification.md
git commit -m "test: record V3 paper signal authority verification"
```

Do not merge, deploy, create TradingView alerts, enable candidate emission/dispatch, or begin legacy Workstream B from this task.

## Final review gate

Before presenting completion:

```bash
git status --short
git log --oneline --decorate -12
git diff 483c044...HEAD --check
git diff 483c044...HEAD --stat
```

Expected: clean worktree; only the files listed in this plan changed; commits are separated by contract, Pine geometry, cohort safety, proposal contract, ingestion, Pine proposal, release generation, and verification evidence.
