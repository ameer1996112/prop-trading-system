# Remaining-Symbol Paper Alerts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add strict paper-only M5 DIR_CLOSE alerts for VANTAGE:GBPCAD, VANTAGE:GBPUSD, VANTAGE:NZDJPY, and OANDA:XPTUSD without changing the five active V1 alerts or enabling any execution surface.

**Architecture:** Branch from the reconciled source commit, retain frozen V1 byte-for-byte, and add a parallel V2 proposal validator/emitter/ingestion path. Canonical per-symbol evidence generates reviewed hashes; the observation edge accepts both versions but remains observation-only, while TradingView creates four new V2 alert snapshots on the existing webhook.

**Tech Stack:** Pine Script v6, TypeScript 5.9, Cloudflare Workers/D1, Vitest 4, Python 3.12, pytest, JSON Schema 2020-12, Wrangler 4, agent-browser.

**Spec:** `docs/superpowers/specs/2026-08-14-remaining-symbol-paper-alerts-design.md`

## Global Constraints

- Implement in a clean worktree based on `refs/heads/codex/child-01-source-reconciliation` at `c55f7de6e62eb1f23fb7869f43e2791066f74a09`; never edit the dirty main checkout.
- Cherry-pick design commit `1b1c682` into the implementation branch before the first RED test.
- Preserve frozen V1 schema, vector, runtime behavior, and the five active V1 TradingView alerts.
- V2 remains `PAPER_ONLY`, account-free, and reachable only through the existing authenticated observation ingress.
- `RD_EXECUTION_CANDIDATE_EMISSION_ENABLED=false`, `RD_EXECUTION_CANDIDATE_DISPATCH_ENABLED=false`, `RD_ENTRY_CANONICAL_PAPER_ENABLED=false`, and execution health status `DISABLED` are hard gates.
- Supported new identities are exactly `VANTAGE:GBPCAD`, `VANTAGE:GBPUSD`, `VANTAGE:NZDJPY`, and `OANDA:XPTUSD` at `M5`.
- Tick sizes are exact reviewed feed capabilities: GBPCAD `0.00001`, GBPUSD `0.00001`, NZDJPY `0.001`, XPTUSD `0.001`.
- Paper buffer fixtures are exact: GBPCAD `2`, GBPUSD `2`, NZDJPY `2`, XPTUSD `5`; exact 4R is mandatory.
- One-candle and micro-retracement qualification remain OFF; BOC and HTF_FLIP remain ineligible.
- No secret value may enter Git, test output, screenshots, reports, shell history, or the final response.
- Every production behavior change follows RED -> observed failure -> minimal GREEN -> full regression -> commit.
- No Cloudflare deployment, TradingView source update, or alert creation occurs until Tasks 1-5 pass independent review.
- No synthetic request may be described as a genuine TradingView receipt.

---

### Task 1: Isolated Baseline and Canonical Identity Evidence

**Files:**
- Create: `contracts/schema/rd-entry-paper-identity-evidence-v2.schema.json`
- Create: `tools/rd_entry_v2_identity.py`
- Create: `scripts/build_rd_entry_v2_identities.py`
- Create: `config/phase0/rd-entry-paper-v2-identities/VANTAGE-GBPCAD.json`
- Create: `config/phase0/rd-entry-paper-v2-identities/VANTAGE-GBPUSD.json`
- Create: `config/phase0/rd-entry-paper-v2-identities/VANTAGE-NZDJPY.json`
- Create: `config/phase0/rd-entry-paper-v2-identities/OANDA-XPTUSD.json`
- Create: `config/phase0/rd-entry-paper-v2-reviewed-identities.json`
- Test: `tests/unit/test_rd_entry_v2_identity.py`

**Interfaces:**
- Consumes: reconciled source commit `c55f7de6e62eb1f23fb7869f43e2791066f74a09`; common detector digest `fcdfb5d9407a31e71b891006c37b136ce240f9514bf639899f9eb784c58719d6`; common provenance digest `4d2006dfe0315dacefdcb7e38c73aa9a53c897ad490848c30bd00baea1ae14f3`.
- Produces: `load_identity_evidence(path: Path) -> IdentityEvidenceV2`; `derive_reviewed_identity(evidence: IdentityEvidenceV2) -> dict[str, str]`; deterministic reviewed-identity JSON consumed by Tasks 2, 5, and 7.

- [ ] **Step 1: Create the isolated worktree**

Run using `superpowers:using-git-worktrees`:

```bash
git worktree add .worktrees/remaining-symbol-paper-alerts \
  -b codex/remaining-symbol-paper-alerts \
  refs/heads/codex/child-01-source-reconciliation
cd .worktrees/remaining-symbol-paper-alerts
git cherry-pick 1b1c682
git status --short
```

Expected: the new worktree is clean and contains the approved design; the original checkout's status and fingerprints are unchanged.

- [ ] **Step 2: Write RED schema and canonical-hash tests**

Add tests that demand a closed evidence object and deterministic hashes:

```python
def test_derives_exact_reviewed_identity_from_canonical_evidence(tmp_path: Path) -> None:
    evidence = write_evidence(tmp_path, ticker_id="VANTAGE:GBPCAD", tick_size="0.00001")
    identity = derive_reviewed_identity(load_identity_evidence(evidence))
    assert identity["ticker_id"] == "VANTAGE:GBPCAD"
    assert identity["source_symbol"] == "GBPCAD"
    assert identity["source_feed"] == "VANTAGE"
    assert identity["source_tick_size"] == "0.00001"
    assert re.fullmatch(r"[a-f0-9]{64}", identity["settings_sha256"])
    assert re.fullmatch(r"[a-f0-9]{64}", identity["source_tick_capability_sha256"])


@pytest.mark.parametrize(
    ("ticker_id", "symbol", "feed", "tick_size", "buffer_ticks", "tolerance"),
    [
        ("VANTAGE:GBPCAD", "GBPCAD", "VANTAGE", "0.00001", 2, 3),
        ("VANTAGE:GBPUSD", "GBPUSD", "VANTAGE", "0.00001", 2, 3),
        ("VANTAGE:NZDJPY", "NZDJPY", "VANTAGE", "0.001", 2, 5),
        ("OANDA:XPTUSD", "XPTUSD", "OANDA", "0.001", 5, 10),
    ],
)
def test_checked_in_identity_is_exact(
    ticker_id: str,
    symbol: str,
    feed: str,
    tick_size: str,
    buffer_ticks: int,
    tolerance: int,
) -> None:
    evidence_path = Path("config/phase0/rd-entry-paper-v2-identities") / (
        ticker_id.replace(":", "-") + ".json"
    )
    evidence = load_identity_evidence(evidence_path)
    identity = derive_reviewed_identity(evidence)
    assert evidence.ticker_id == ticker_id
    assert evidence.source_symbol == symbol
    assert evidence.source_feed == feed
    assert evidence.source_tick_size == tick_size
    assert evidence.pine_inputs["buffer_ticks"] == buffer_ticks
    assert evidence.pine_inputs["divergence_tolerance_ticks"] == tolerance
    assert evidence.pine_inputs["target_r_multiple"] == 4
    assert evidence.pine_inputs["enable_one_candle"] is False
    assert evidence.pine_inputs["enable_micro_retracement"] is False
    assert identity["source_tick_size"] == tick_size
```

The test must also reject unknown fields, a secret/credential field, wrong ticker/feed pairs, floats, zero digests, one-candle true, micro-retracement true, target multiple other than 4, and noncanonical decimals.

- [ ] **Step 3: Run RED and record the expected failure**

Run:

```bash
uv run pytest -q tests/unit/test_rd_entry_v2_identity.py
```

Expected: collection fails because `tools.rd_entry_v2_identity` and the evidence schema do not exist.

- [ ] **Step 4: Implement the closed evidence model and generator**

Use canonical UTF-8 JSON with sorted keys and no insignificant whitespace:

```python
def canonical_bytes(value: Mapping[str, object]) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        allow_nan=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")


def digest(value: Mapping[str, object]) -> str:
    return hashlib.sha256(canonical_bytes(value)).hexdigest()


def derive_reviewed_identity(evidence: IdentityEvidenceV2) -> dict[str, str]:
    return {
        "ticker_id": evidence.ticker_id,
        "source_symbol": evidence.source_symbol,
        "source_feed": evidence.source_feed,
        "detector_code_sha256": evidence.detector_code_sha256,
        "settings_sha256": digest(evidence.pine_inputs),
        "provenance_sha256": evidence.provenance_sha256,
        "source_tick_capability_sha256": digest(evidence.tick_capability),
        "source_tick_size": evidence.source_tick_size,
        "buffer_policy_version": "rd-entry-wick-buffer-v1",
    }
```

Each checked-in evidence file must contain the complete nonsecret Pine input profile, including display inputs, pivot strength `2`, distance `30`, `enable_one_candle=false`, `enable_micro_retracement=false`, `emit_contract_v3=false`, `emit_execution_proposal_v1=false`, `emit_execution_proposal_v2=true`, validation capture false, buffer ticks, and target multiple `4`. The credential is represented only as `credential_binding="TRADINGVIEW_OBSERVATION_CREDENTIAL_SHA256"`.

- [ ] **Step 5: Generate and verify reviewed identities**

Run:

```bash
uv run python scripts/build_rd_entry_v2_identities.py \
  --evidence-dir config/phase0/rd-entry-paper-v2-identities \
  --output config/phase0/rd-entry-paper-v2-reviewed-identities.json
uv run python scripts/build_rd_entry_v2_identities.py \
  --evidence-dir config/phase0/rd-entry-paper-v2-identities \
  --output config/phase0/rd-entry-paper-v2-reviewed-identities.json \
  --check
uv run pytest -q tests/unit/test_rd_entry_v2_identity.py
uv run ruff check tools/rd_entry_v2_identity.py scripts/build_rd_entry_v2_identities.py tests/unit/test_rd_entry_v2_identity.py
```

Expected: four identities, stable byte-for-byte output, all tests and lint pass.

- [ ] **Step 6: Commit Task 1**

```bash
git add contracts/schema/rd-entry-paper-identity-evidence-v2.schema.json \
  tools/rd_entry_v2_identity.py scripts/build_rd_entry_v2_identities.py \
  config/phase0/rd-entry-paper-v2-identities \
  config/phase0/rd-entry-paper-v2-reviewed-identities.json \
  tests/unit/test_rd_entry_v2_identity.py
git commit -m "feat: derive reviewed v2 paper identities"
```

---

### Task 2: Strict V2 Proposal and Candidate Contracts

**Files:**
- Modify: `contracts/schema/rd-entry-execution-proposal-v2.schema.json`
- Modify: `contracts/schema/execution-candidate-v2.schema.json`
- Create: `contracts/vectors/rd-entry-execution-proposal-v2.json`
- Create: `apps/observation-edge/src/execution-proposal-v2.ts`
- Create: `apps/observation-edge/test/execution-proposal-v2.test.ts`
- Modify: `tests/static/test_execution_proposal_v1_boundaries.py`

**Interfaces:**
- Consumes: Task 1 reviewed identities.
- Produces: `validateExecutionProposalV2(value: unknown, identity: unknown): ExecutionProposalV2`; `deriveExecutionCandidateV2(value: unknown, identity: unknown): Promise<ExecutionCandidateV2>`; `ExecutionProposalV2ValidationError`.

- [ ] **Step 1: Write RED tests for nine exact symbols and V1 isolation**

Add a table test with exact policies:

```ts
const policies = {
  EURUSD: [2, 3], GBPJPY: [3, 5], USDJPY: [2, 5],
  XAUUSD: [5, 10], NAS100: [10, 20],
  GBPCAD: [2, 3], GBPUSD: [2, 3], NZDJPY: [2, 5], XPTUSD: [5, 10],
} as const;

it.each(Object.entries(policies))("accepts reviewed %s V2 geometry", async (symbol, policy) => {
  const candidate = await deriveExecutionCandidateV2(
    proposalFixture({ symbol, bufferTicks: policy[0] }),
    identityFixture(symbol),
  );
  expect(candidate.execution_mode).toBe("PAPER_ONLY");
  expect(candidate.target_ticks).toBe(
    candidate.direction === "LONG"
      ? candidate.entry_ticks + 4 * candidate.risk_distance_ticks
      : candidate.entry_ticks - 4 * candidate.risk_distance_ticks,
  );
});
```

Add negative cases for wrong feed, tick size, all four digests, buffer, `zone_active_from_epoch` alignment/order, candle timing, stale observation, stop/risk/target mismatch, unknown fields, arithmetic overflow, and V2 input presented to V1.

- [ ] **Step 2: Run RED**

```bash
(cd apps/observation-edge && npm test -- --run test/execution-proposal-v2.test.ts)
uv run pytest -q tests/static/test_execution_proposal_v1_boundaries.py
```

Expected: V2 runtime import fails and the new symbols are absent from both V2 schemas.

- [ ] **Step 3: Implement minimal closed V2 runtime**

Define exact symbol policies:

```ts
export const EXECUTION_PROPOSAL_V2_SYMBOL_POLICIES = Object.freeze({
  EURUSD: Object.freeze({ minimumBufferTicks: 2, divergenceToleranceTicks: 3 }),
  GBPJPY: Object.freeze({ minimumBufferTicks: 3, divergenceToleranceTicks: 5 }),
  USDJPY: Object.freeze({ minimumBufferTicks: 2, divergenceToleranceTicks: 5 }),
  XAUUSD: Object.freeze({ minimumBufferTicks: 5, divergenceToleranceTicks: 10 }),
  NAS100: Object.freeze({ minimumBufferTicks: 10, divergenceToleranceTicks: 20 }),
  GBPCAD: Object.freeze({ minimumBufferTicks: 2, divergenceToleranceTicks: 3 }),
  GBPUSD: Object.freeze({ minimumBufferTicks: 2, divergenceToleranceTicks: 3 }),
  NZDJPY: Object.freeze({ minimumBufferTicks: 2, divergenceToleranceTicks: 5 }),
  XPTUSD: Object.freeze({ minimumBufferTicks: 5, divergenceToleranceTicks: 10 }),
} as const);
```

V2 validation duplicates no V1 mutation. It validates exact keys, canonical decimals, nonzero SHA-256 values, reviewed binding equality, aligned zone activation, closed M5 candles, real-time freshness, structural wick stop, exact risk, and exact 4R with safe-integer arithmetic. Candidate identity includes `strategy_version`, `wire_version`, `ticker_id`, setup/revision/selection, and source-bar close epoch; candidate-body SHA covers every candidate field except itself.

- [ ] **Step 4: Update schemas and vectors**

Add exactly `GBPCAD`, `GBPUSD`, `NZDJPY`, and `XPTUSD` to both V2 symbol enums. Do not modify either V1 schema or the V1 vector. Generate V2 vectors from the runtime fixtures and require a `--check` mode or a byte-comparison test.

- [ ] **Step 5: Verify GREEN and frozen V1**

```bash
(cd apps/observation-edge && npm test -- --run test/execution-proposal-v2.test.ts test/execution-proposal-v1.test.ts)
uv run pytest -q tests/static/test_execution_proposal_v1_boundaries.py
(cd apps/observation-edge && npm run typecheck)
git diff --check
```

Expected: V2 accepts the nine exact symbols; V1 byte-digest assertions remain unchanged and pass.

- [ ] **Step 6: Commit Task 2**

```bash
git add contracts/schema/rd-entry-execution-proposal-v2.schema.json \
  contracts/schema/execution-candidate-v2.schema.json \
  contracts/vectors/rd-entry-execution-proposal-v2.json \
  apps/observation-edge/src/execution-proposal-v2.ts \
  apps/observation-edge/test/execution-proposal-v2.test.ts \
  tests/static/test_execution_proposal_v1_boundaries.py
git commit -m "feat: validate nine-symbol v2 paper proposals"
```

---

### Task 3: Version-Isolated Observation Ingestion

**Files:**
- Create: `apps/observation-edge/src/execution-proposal-storage.ts`
- Modify: `apps/observation-edge/src/execution-proposal-ingestion.ts`
- Create: `apps/observation-edge/src/execution-proposal-v2-ingestion.ts`
- Modify: `apps/observation-edge/src/index.ts`
- Modify: `apps/observation-edge/src/types.ts`
- Create: `apps/observation-edge/test/execution-proposal-v2-ingestion.test.ts`
- Modify: `apps/observation-edge/test/execution-proposal-ingestion.test.ts`

**Interfaces:**
- Consumes: Task 2 V2 validator/candidate.
- Produces: `isExecutionProposalV2Envelope(value: unknown): boolean`; `validateExecutionProposalV2Envelope(value, reviewedJson)`; `ingestExecutionProposalV2(env, envelope)`; shared `ingestStoredExecutionProposal(env, input)` preserving V1 response/replay semantics.

- [ ] **Step 1: Characterize V1 before refactoring**

Add tests proving the exact existing V1 response body, status, idempotent replay, checkpoint transition, gap quarantine, candidate conflict, and disabled-dispatch behavior. These tests must pass before production edits.

Run:

```bash
(cd apps/observation-edge && npm test -- --run test/execution-proposal-ingestion.test.ts)
```

Expected: PASS on the unmodified V1 implementation.

- [ ] **Step 2: Write V2 RED ingestion tests**

```ts
it("stores one valid V2 paper result without dispatch", async () => {
  const response = await ingestExecutionProposalV2(env, validV2Envelope());
  expect(response.status).toBe(202);
  expect(JSON.parse(response.body)).toMatchObject({
    proposal_schema_version: "rd-entry-execution-proposal-v2",
    execution: "PAPER_ONLY",
    status: "RECEIVED",
  });
  expect(response.deliveryCreated).toBe(false);
});

it("does not fall through from invalid V2 to V1", async () => {
  const response = await postObservation(invalidV2Envelope());
  expect(response.status).toBe(422);
  expect(await proposalEventCount(env.DB)).toBe(0);
});
```

Cover exact retry, producer gap, out-of-order, sequence conflict, body conflict, missing V2 registry, disabled V2 ingress, and unavailable D1.

- [ ] **Step 3: Run RED**

```bash
(cd apps/observation-edge && npm test -- --run test/execution-proposal-v2-ingestion.test.ts)
```

Expected: FAIL because V2 routing and ingestion do not exist.

- [ ] **Step 4: Extract version-neutral storage without changing V1**

Define the adapter consumed by the shared state machine:

```ts
export interface StoredExecutionProposalInput {
  readonly proposalSchemaVersion: "rd-entry-execution-proposal-v1" | "rd-entry-execution-proposal-v2";
  readonly producerInstanceId: string;
  readonly producerSequence: number;
  readonly proposalJson: string;
  readonly proposalSha256: string;
  readonly logicalCandidateId: string;
  readonly candidateBodySha256: string;
  readonly candidateJson: string;
  readonly deliveryMode: "PRESERVE_V1" | "DISABLED";
}
```

Move only D1 checkpoint/event/conflict logic into `execution-proposal-storage.ts`. V1 and V2 wrappers validate first, then adapt to this input. V2 must always adapt with `deliveryMode: "DISABLED"`; V1 adapts with `deliveryMode: "PRESERVE_V1"` so the extraction cannot silently alter its established behavior. V1 characterization tests must remain byte-for-byte green.

- [ ] **Step 5: Route by explicit schema with no fallback**

In the observation handler:

```ts
if (isExecutionProposalV2Envelope(parsedBody)) {
  return handleExecutionProposalV2(request, env, parsedBody);
}
if (isExecutionProposalV1Envelope(parsedBody)) {
  return handleExecutionProposalV1(request, env, parsedBody);
}
```

An object declaring either proposal schema is owned by that branch; its validation error returns its version-specific 422 and never enters legacy observation parsing.

- [ ] **Step 6: Verify GREEN**

```bash
(cd apps/observation-edge && npm test -- --run \
  test/execution-proposal-v1.test.ts \
  test/execution-proposal-v2.test.ts \
  test/execution-proposal-ingestion.test.ts \
  test/execution-proposal-v2-ingestion.test.ts)
(cd apps/observation-edge && npm run typecheck)
```

Expected: all V1 and V2 validation/ingestion tests pass; V2 creates no delivery.

- [ ] **Step 7: Commit Task 3**

```bash
git add apps/observation-edge/src/execution-proposal-storage.ts \
  apps/observation-edge/src/execution-proposal-ingestion.ts \
  apps/observation-edge/src/execution-proposal-v2-ingestion.ts \
  apps/observation-edge/src/index.ts apps/observation-edge/src/types.ts \
  apps/observation-edge/test/execution-proposal-ingestion.test.ts \
  apps/observation-edge/test/execution-proposal-v2-ingestion.test.ts
git commit -m "feat: ingest v2 proposals as paper only"
```

---

### Task 4: Independent Pine V2 Emitter

**Files:**
- Modify: `scripts/pinescript/SND_RD_5M_V3_THREE_ENTRY_LAB.pine`
- Create: `tests/static/test_execution_proposal_v2_pine.py`
- Modify: `tests/static/test_execution_proposal_v1_boundaries.py`
- Modify: `tests/static/test_rd_three_entry_pine.py`

**Interfaces:**
- Consumes: Task 2 wire fields/policies and Task 1 reviewed hashes.
- Produces: default-OFF Pine V2 `alert()` payload compatible with `validateExecutionProposalV2Envelope`.

- [ ] **Step 1: Write RED Pine boundary tests**

Tests require:

```python
def test_v2_emitter_is_independent_default_off_and_nine_symbol_closed() -> None:
    pine = PINE.read_text(encoding="utf-8")
    assert 'emitExecutionProposalV2 = input.bool(false, "Emit execution proposal v2"' in pine
    for symbol in ("EURUSD", "GBPJPY", "USDJPY", "XAUUSD", "NAS100", "GBPCAD", "GBPUSD", "NZDJPY", "XPTUSD"):
        assert f'sourceSymbol == "{symbol}"' in pine
    assert '"zone_active_from_epoch"' in pine
```

Also assert V1 functions and frozen artifacts remain present, V2 is confirmed/realtime/M5/DIR_CLOSE/two-plus only, one-candle and micro-retracement cannot promote, V2 sequence/state is independent, payload is bounded before sequence commit, and no broker/order/MT5/WebRequest surface appears.

- [ ] **Step 2: Run RED**

```bash
uv run pytest -q tests/static/test_execution_proposal_v2_pine.py tests/static/test_execution_proposal_v1_boundaries.py
```

Expected: FAIL because the V2 Pine input and emitter are absent.

- [ ] **Step 3: Add immutable V2 state fields and inputs**

Add `zoneActiveFromEpoch` and `executionProposalV2Emitted` to `EntryCore`; initialize zone activation from `epochSeconds(zone.confirmationTime)`. Add a dedicated V2 producer sequence and these inputs under Automation:

```pine
emitExecutionProposalV2 = input.bool(false, "Emit execution proposal v2", group = "Automation")
executionProposalV2DetectorCodeSha256 = input.string("", "V2 reviewed detector SHA-256", group = "Automation")
executionProposalV2SettingsSha256 = input.string("", "V2 reviewed settings SHA-256", group = "Automation")
executionProposalV2ProvenanceSha256 = input.string("", "V2 reviewed provenance SHA-256", group = "Automation")
executionProposalV2SourceTickCapabilitySha256 = input.string("", "V2 reviewed tick-capability SHA-256", group = "Automation")
```

Reuse the existing dedicated proposal credential without serializing it inside the payload; the envelope contains it only at the authentication boundary.

- [ ] **Step 4: Implement exact V2 eligibility and serialization**

The V2 symbol/buffer function returns exactly:

```pine
sourceSymbol == "EURUSD" ? 2 : sourceSymbol == "GBPJPY" ? 3 :
 sourceSymbol == "USDJPY" ? 2 : sourceSymbol == "XAUUSD" ? 5 :
 sourceSymbol == "NAS100" ? 10 : sourceSymbol == "GBPCAD" ? 2 :
 sourceSymbol == "GBPUSD" ? 2 : sourceSymbol == "NZDJPY" ? 2 :
 sourceSymbol == "XPTUSD" ? 5 : na
```

Serialize `zone_active_from_epoch=attempt.core.zoneActiveFromEpoch`; require it aligned to 300 seconds, not after engagement open, and before source close. Calculate stop from the immutable engagement wick, risk from entry to stop, and target as exactly `entry +/- risk * 4`. Set the V2 emitted flag only after the bounded payload is accepted by `alert()`.

- [ ] **Step 5: Verify GREEN and Pine invariants**

```bash
uv run pytest -q \
  tests/static/test_execution_proposal_v2_pine.py \
  tests/static/test_execution_proposal_v1_boundaries.py \
  tests/static/test_rd_three_entry_pine.py
uv run ruff check tests/static/test_execution_proposal_v2_pine.py
```

Expected: all Pine static tests pass and V1 digest checks are unchanged.

- [ ] **Step 6: Commit Task 4**

```bash
git add scripts/pinescript/SND_RD_5M_V3_THREE_ENTRY_LAB.pine \
  tests/static/test_execution_proposal_v2_pine.py \
  tests/static/test_execution_proposal_v1_boundaries.py \
  tests/static/test_rd_three_entry_pine.py
git commit -m "feat: emit independent v2 paper proposals"
```

---

### Task 5: Closed Configuration, Runbook, and Release Gates

**Files:**
- Modify: `apps/observation-edge/wrangler.jsonc`
- Modify: `apps/observation-edge/src/types.ts`
- Create: `docs/rd-entry-execution-proposal-v2.md`
- Modify: `docs/runbooks/tradingview-paper-bridge.md`
- Create: `tests/static/test_execution_proposal_v2_boundaries.py`
- Modify: `scripts/static_boundary_check.py`

**Interfaces:**
- Consumes: Task 1 registry and Tasks 2-4 contract/runtime/Pine behavior.
- Produces: `RD_EXECUTION_PROPOSAL_V2_INGRESS_ENABLED`; `RD_EXECUTION_PROPOSAL_V2_REVIEWED_IDENTITIES_JSON`; static release gate proving paper-only configuration.

- [ ] **Step 1: Write RED configuration tests**

Require exact keys and safety values:

```python
def test_v2_ingress_is_paper_only_and_dispatch_stays_disabled() -> None:
    config = json.loads(WRANGLER.read_text(encoding="utf-8"))
    variables = config["vars"]
    assert variables["RD_EXECUTION_PROPOSAL_V2_INGRESS_ENABLED"] == "false"
    assert json.loads(variables["RD_EXECUTION_PROPOSAL_V2_REVIEWED_IDENTITIES_JSON"]) == reviewed_registry()
    assert variables["RD_EXECUTION_CANDIDATE_EMISSION_ENABLED"] == "false"
    assert variables["RD_EXECUTION_CANDIDATE_DISPATCH_ENABLED"] == "false"
    assert variables["RD_ENTRY_CANONICAL_PAPER_ENABLED"] == "false"
```

Add mutation cases for an extra identity, wrong feed, altered hash/tick size/buffer policy, V1 registry loss, any dispatch/emission/canonical-paper true value, execution route, order/MT5/WebRequest text, or a secret value in config.

- [ ] **Step 2: Run RED**

```bash
uv run pytest -q tests/static/test_execution_proposal_v2_boundaries.py
```

Expected: FAIL because V2 environment keys and documentation are absent.

- [ ] **Step 3: Add closed V2 configuration while preserving V1**

Add to `Env`:

```ts
readonly RD_EXECUTION_PROPOSAL_V2_INGRESS_ENABLED?: string;
readonly RD_EXECUTION_PROPOSAL_V2_REVIEWED_IDENTITIES_JSON?: string;
```

Insert the generated Task 1 registry as the exact JSON string. Preserve the five current V1 reviewed identities rather than reverting the registry to `{}`. Keep V2 ingress false in the implementation commit; Task 6 changes only that one gate after full verification.

- [ ] **Step 4: Document operator semantics and rollback**

Document exact symbols/feeds/tick sizes/buffers, identity digest generation, response meanings, first-real-event reconciliation, alert snapshot immutability, health gates, and rollback. State that the fixtures do not claim profitability and cannot authorize demo/live execution.

- [ ] **Step 5: Verify configuration GREEN**

```bash
uv run pytest -q tests/static/test_execution_proposal_v2_boundaries.py tests/static/test_execution_proposal_v1_boundaries.py
uv run python scripts/static_boundary_check.py --root .
uv run ruff check tests/static/test_execution_proposal_v2_boundaries.py scripts/static_boundary_check.py
git diff --check
```

Expected: exact registries pass, all authority mutations fail, V2 remains disabled.

- [ ] **Step 6: Commit Task 5**

```bash
git add apps/observation-edge/wrangler.jsonc apps/observation-edge/src/types.ts \
  docs/rd-entry-execution-proposal-v2.md docs/runbooks/tradingview-paper-bridge.md \
  tests/static/test_execution_proposal_v2_boundaries.py scripts/static_boundary_check.py
git commit -m "docs: gate v2 paper proposal rollout"
```

---

### Task 6: Full Verification and Observation-Edge Deployment

**Files:**
- Modify: `apps/observation-edge/wrangler.jsonc` (only V2 ingress false -> true after all predeploy gates)
- Create: `docs/reports/2026-08-14-remaining-symbol-paper-alerts-verification.md`

**Interfaces:**
- Consumes: Tasks 1-5 reviewed branch.
- Produces: deployed observation-edge version with V1+V2 ingestion, execution disabled, and a hash-bound verification report.

- [ ] **Step 1: Run the focused and full local suites**

```bash
uv run pytest -q \
  tests/unit/test_rd_entry_v2_identity.py \
  tests/static/test_execution_proposal_v2_pine.py \
  tests/static/test_execution_proposal_v2_boundaries.py \
  tests/static/test_execution_proposal_v1_boundaries.py \
  tests/static/test_rd_three_entry_pine.py
(cd apps/observation-edge && npm ci --ignore-scripts --no-audit --no-fund)
(cd apps/observation-edge && npm test)
(cd apps/observation-edge && npm run typecheck)
(cd apps/observation-edge && npm run build)
uv run python scripts/static_boundary_check.py --root .
git diff --check
```

Expected: every command exits zero; dry-run build contains no execution capability.

- [ ] **Step 2: Obtain independent review**

Review Tasks 1-5 for schema/runtime parity, identity-preimage reproducibility, V1 byte isolation, version routing, producer chronology, D1 atomicity, no dispatch, Pine non-repainting boundaries, secret safety, and rollback. Required verdict: `APPROVED`; any P0/P1/P2 finding returns to the owning task with a new RED regression.

- [ ] **Step 3: Arm only V2 paper ingress and rerun gates**

Change:

```json
"RD_EXECUTION_PROPOSAL_V2_INGRESS_ENABLED": "true"
```

Do not change any other authority variable. Rerun Task 6 Step 1 and inspect `git diff -- apps/observation-edge/wrangler.jsonc` to prove a one-value gate change.

- [ ] **Step 4: Commit the reviewed ingress gate**

```bash
git add apps/observation-edge/wrangler.jsonc
git commit -m "chore: enable reviewed v2 paper ingress"
```

- [ ] **Step 5: Deploy the observation edge**

From `apps/observation-edge`, with the already authenticated operator session:

```bash
npx wrangler deploy --dry-run --outdir dist
npx wrangler deploy
```

Do not apply a D1 migration because this design reuses the existing version-neutral proposal tables. Stop if Wrangler reports a migration, resource replacement, secret deletion, changed service binding, or any non-observation deployment.

- [ ] **Step 6: Verify deployed health before alerts**

```bash
curl -fsS https://prop-trading-observation-edge.ameer-1996112.workers.dev/health/live
```

Require exact safety meanings: `status=ALIVE`, `mode=OBSERVATION_ONLY`, paper simulator enabled, canonical paper disabled, and `execution=DISABLED`. Record the deployment version ID and SHA-256 digests of schemas, Pine, registries, and test outputs in the verification report; never record the credential.

- [ ] **Step 7: Commit the verification report**

```bash
git add docs/reports/2026-08-14-remaining-symbol-paper-alerts-verification.md
git commit -m "docs: verify v2 paper proposal deployment"
```

---

### Task 7: Publish Pine V2 and Create Four TradingView Alerts

**Files:**
- Create outside Git: `/private/tmp/remaining-symbol-paper-alerts-20260814/tradingview-alert-evidence.json`
- Create outside Git: `/private/tmp/remaining-symbol-paper-alerts-20260814/tradingview-alerts.png`
- Modify: `docs/reports/2026-08-14-remaining-symbol-paper-alerts-verification.md` (append redacted evidence hashes and active-status summary)

**Interfaces:**
- Consumes: deployed Task 6 edge, reviewed Pine source, Task 1 hash registry, existing TradingView credential/webhook.
- Produces: four active open-ended 5m alerts and redacted evidence; no MT5 or broker action.

- [ ] **Step 1: Compile and save the reviewed Pine source**

Using the controlled TradingView browser session, open Pine Editor, replace the source with the exact reviewed `scripts/pinescript/SND_RD_5M_V3_THREE_ENTRY_LAB.pine` bytes, save a new version, add it to the chart, and confirm zero compile errors. Do not delete or edit the five active V1 alerts; TradingView continues running their immutable snapshots.

- [ ] **Step 2: Verify each chart identity before editing inputs**

For each exact chart, require 5m and feed label:

```text
Vantage GBPCAD
Vantage GBPUSD
Vantage NZDJPY
OANDA XPTUSD
```

Stop on symbol search ambiguity, a different provider, non-5m interval, or a chart-reported tick precision inconsistent with Task 1 evidence.

- [ ] **Step 3: Apply exact strict V2 inputs**

For each chart, set the Task 1 detector/settings/provenance/tick-capability digests; set V1 emission OFF, V2 emission ON, one-candle OFF, micro-retracement OFF, validation capture OFF, and leave stop/target legacy diagnostic fields unchanged. Save the layout after each symbol and re-open settings to verify values before alert creation.

- [ ] **Step 4: Create each alert**

Create exactly one alert per new identity:

```text
Condition: SND RD 5M V3 THREE ENTRY LAB -> Any alert() function call
Interval: Same as chart, 5 minutes
Expiration: Open-ended
Webhook: existing observation endpoint
```

The webhook field must equal the existing observation URL. Never print or capture the credential. Create no price-only, named `alertcondition`, contract-v3, V1, demo, or execution alert.

- [ ] **Step 5: Verify account-level active alerts**

Open TradingView Alerts and assert all nine symbols show `5m` and `Active`:

```text
USDJPY GBPJPY EURUSD XAUUSD NAS100 GBPCAD GBPUSD NZDJPY XPTUSD
```

Capture a redacted screenshot that excludes credentials and alert payload details. Build canonical evidence containing only account label, symbol, feed, timeframe, active status, alert type, open-ended status, webhook origin/path, settings/tick hash, creation timestamp, and screenshot SHA-256.

- [ ] **Step 6: Verify no execution change**

Recheck Worker health and confirm `execution=DISABLED`. Confirm no execution-edge, MT5, EA, WebRequest, order, position, or broker action occurred. Do not fabricate a setup to force an alert.

- [ ] **Step 7: Append final redacted evidence and commit**

```bash
git add docs/reports/2026-08-14-remaining-symbol-paper-alerts-verification.md
git commit -m "docs: record remaining TradingView paper alerts"
```

Expected report result: four new V2 alerts active, five V1 alerts unchanged, nine total active 5m alerts, observation-only Worker healthy, execution disabled.

---

### Task 8: First-Genuine-Event Reconciliation Runbook

**Files:**
- Modify: `docs/runbooks/tradingview-paper-bridge.md`
- Create: `docs/reports/2026-08-14-remaining-symbol-first-event-status.md`

**Interfaces:**
- Consumes: Task 7 active alerts and future genuine TradingView events.
- Produces: operator procedure and an initially `WAITING_FOR_GENUINE_EVENT` status; later event evidence is a separate operational update.

- [ ] **Step 1: Write the reconciliation checklist**

For the first genuine event from each new identity, record and reconcile:

```text
TradingView alert-log timestamp and symbol
HTTP receipt status/code
proposal schema version
producer instance and sequence
logical candidate ID and candidate body digest
paper result status
accepted or rejected reason
stored stop/risk/target geometry
execution = PAPER_ONLY
```

The checklist must explain `202 RECEIVED`, exact `200` replay, producer quarantine responses, `401 INVALID_CREDENTIAL`, V2 `422`, and `503`, with recovery that never resends a changed economic event under the same identity.

- [ ] **Step 2: Create the waiting status report**

The report states that no genuine receipt has occurred yet unless TradingView's Log and the observation receipt prove otherwise. It must not count a health request, manual curl, historical replay, or synthetic fixture as a strategy event.

- [ ] **Step 3: Run documentation and safety checks**

```bash
rg -n "WAITING_FOR_GENUINE_EVENT|PAPER_ONLY|execution.*DISABLED" \
  docs/runbooks/tradingview-paper-bridge.md \
  docs/reports/2026-08-14-remaining-symbol-first-event-status.md
uv run python scripts/static_boundary_check.py --root .
git diff --check
```

- [ ] **Step 4: Commit Task 8**

```bash
git add docs/runbooks/tradingview-paper-bridge.md \
  docs/reports/2026-08-14-remaining-symbol-first-event-status.md
git commit -m "docs: add genuine v2 event reconciliation"
```

## Final Acceptance Gate

- [ ] Clean implementation worktree; original dirty checkout fingerprints unchanged.
- [ ] Every Task 1-5 RED failure was observed before implementation and recorded in its task report.
- [ ] V1 schema/vector/runtime/Pine behavior and five active alert snapshots remain unchanged.
- [ ] Four canonical evidence artifacts reproduce all reviewed settings/tick hashes.
- [ ] V2 schema/runtime/Pine/edge accept exactly the nine reviewed symbols and reject all mismatches.
- [ ] Focused tests, full observation-edge tests, TypeScript checks, Ruff, static boundary scan, dry-run build, and diff check pass.
- [ ] Independent review is `APPROVED` with no P0/P1/P2 findings.
- [ ] Deployed Worker health remains observation-only with execution disabled.
- [ ] TradingView lists nine total active 5m alerts and the four new feeds are exact.
- [ ] No secret, MT5, demo/live execution, order, broker mutation, or false receipt claim occurred.
