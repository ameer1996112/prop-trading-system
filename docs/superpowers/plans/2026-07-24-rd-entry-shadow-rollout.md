# RD Entry Shadow Canary and Guarded Paper Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy the version-2 RD entry observation path without disturbing version-1 alerts, prove historical and forward parity, and permit canonical paper eligibility only after a machine-readable canary report passes and the operator explicitly approves promotion.

**Architecture:** A frozen Python rollout policy evaluates committed historical parity and a sanitized forward snapshot from the Cloudflare edge. The first deployment keeps `RD_ENTRY_CANONICAL_PAPER_ENABLED=false`, so schema-2 observations, candidate storage, backend arbitration, API projections, and the console run in shadow. The current `2.0.0-contract2` policy is structurally observation-only. A later reviewed exact-provenance successor may promote only by atomically changing the paper-eligibility flag, generating a compile-time promotion binding, and proving its environment, per-receipt detector/settings identity, and live Cloudflare Version Metadata tag against one immutable evidence chain; schema 2.0 still cannot express a paper command, broker action, or real execution.

**Tech Stack:** Python 3.12, pytest, JSON, Cloudflare Workers/D1, Wrangler 4.113.0, TradingView Pine Script v6

## Global Constraints

- Complete Plans 1–3 and their commit gates before beginning this plan.
- Preserve every schema `1.0`, `1.1`, and `1.2` route and stored row.
- Keep the existing V2 TradingView alert active until V3 receipts and console projections are verified.
- Apply only backward-compatible D1 migrations. Worker rollback does not reverse a D1 migration.
- Keep `RD_ENTRY_CANONICAL_PAPER_ENABLED=false` through historical parity and the complete forward canary.
- A passing report is necessary but not sufficient for promotion; explicit operator approval is also required.
- Enabling canonical paper eligibility does not create paper intents and does not add `paper_commands`.
- Any Pine/edge/oracle disagreement, `NOT_PROVIDED` parity, quarantine,
  conflicting immutable ID, incomplete/in-flight post-grace batch, mixed code
  identity, unknown source claim, or non-exact paper selection makes the canary
  fail.
- Never store the raw TradingView credential in Git, D1, a report, a command transcript, a browser field other than the Pine input, or Worker configuration.
- Keep real execution disabled. This plan has no broker route, order route, account credential, or provider integration.
- Under the frozen `2.0.0-contract2` producer, common setup fidelity is always
  `UNRESOLVED`; therefore Task 7 is intentionally unreachable in this version.
  Its promotion mechanics are a fail-closed template for a separately reviewed,
  version-bumped exact-provenance contract, policy, vectors, historical capture,
  and fresh forward canary. Current artifacts must never be reused to cross that
  boundary.

---

### Task 1: Freeze the rollout policy and fail-closed evaluator

**Files:**

- Create: `config/phase0/rd-entry-rollout-policy-v2.json`
- Create: `src/prop_trading/domain/rd_entry_rollout.py`
- Create: `tests/unit/test_rd_entry_rollout.py`
- Create: `tests/fixtures/rd_entry_rollout_historical_pass.json`
- Create: `tests/fixtures/rd_entry_rollout_policy_successor_exact_pass.json`
- Create: `tests/fixtures/rd_entry_rollout_historical_successor_exact_pass.json`
- Create: `tests/fixtures/rd_entry_rollout_forward_successor_exact_pass.json`
- Create: `tests/fixtures/rd_entry_rollout_forward_current_unresolved.json`
- Create: `tests/fixtures/rd_entry_rollout_forward_fail.json`

- [ ] **Step 1: Write the failing policy tests**

Add tests that load the real policy and fixture snapshots:

```python
from __future__ import annotations

import json
from pathlib import Path

import pytest

from prop_trading.domain.rd_entry_rollout import (
    RolloutStatus,
    evaluate_rd_entry_rollout,
)

ROOT = Path(__file__).resolve().parents[2]
POLICY = json.loads(
    (ROOT / "config/phase0/rd-entry-rollout-policy-v2.json").read_text(encoding="utf-8")
)
SUCCESSOR_EXACT_POLICY = json.loads(
    (
        ROOT
        / "tests/fixtures/rd_entry_rollout_policy_successor_exact_pass.json"
    ).read_text(encoding="utf-8")
)


def load_fixture(name: str) -> dict[str, object]:
    return json.loads(
        (ROOT / "tests/fixtures" / name).read_text(encoding="utf-8")
    )


def test_future_reviewed_exact_canary_passes_the_promotion_gate() -> None:
    decision = evaluate_rd_entry_rollout(
        policy_document=SUCCESSOR_EXACT_POLICY,
        historical_report=load_fixture(
            "rd_entry_rollout_historical_successor_exact_pass.json"
        ),
        forward_snapshot=load_fixture(
            "rd_entry_rollout_forward_successor_exact_pass.json"
        ),
    )

    assert decision.status is RolloutStatus.PASS
    assert decision.paper_selection_may_be_enabled is True
    assert decision.reasons == ()


def test_current_unresolved_setup_can_pass_observation_checks_but_not_promotion() -> None:
    decision = evaluate_rd_entry_rollout(
        policy_document=POLICY,
        historical_report=load_fixture("rd_entry_rollout_historical_pass.json"),
        forward_snapshot=load_fixture(
            "rd_entry_rollout_forward_current_unresolved.json"
        ),
    )

    assert decision.status is RolloutStatus.COLLECTING
    assert decision.paper_selection_may_be_enabled is False
    assert decision.reasons == (
        "CURRENT_PRODUCER_NOT_PROMOTABLE",
        "INSUFFICIENT_EXACT_DIR_CLOSE_CANDIDATES",
        "INSUFFICIENT_EXACT_HTF_FLIP_CANDIDATES",
        "MISSING_EXACT_HTF_CONTEXT_15M",
        "MISSING_EXACT_HTF_CONTEXT_30M",
        "MISSING_EXACT_HTF_CONTEXT_1H",
    )


def test_current_contract_cannot_pass_with_forged_exact_counters() -> None:
    snapshot = load_fixture("rd_entry_rollout_forward_current_unresolved.json")
    snapshot["exact_candidates_by_model"] = {"DIR_CLOSE": 18, "HTF_FLIP": 12}
    snapshot["observed_exact_htf_contexts"] = ["15m", "30m", "1h"]

    decision = evaluate_rd_entry_rollout(
        policy_document=POLICY,
        historical_report=load_fixture("rd_entry_rollout_historical_pass.json"),
        forward_snapshot=snapshot,
    )

    assert decision.status is RolloutStatus.COLLECTING
    assert decision.paper_selection_may_be_enabled is False
    assert decision.reasons == ("CURRENT_PRODUCER_NOT_PROMOTABLE",)


def test_current_contract_rejects_a_promotable_capability_claim() -> None:
    policy = json.loads(json.dumps(POLICY))
    policy["promotion"]["producer_contract_capability"] = (
        "EXACT_COMMON_SETUP_PROVENANCE"
    )
    policy["promotion"]["paper_promotion_allowed"] = True

    with pytest.raises(
        ValueError,
        match="2.0.0-contract2 is structurally observation-only",
    ):
        evaluate_rd_entry_rollout(
            policy_document=policy,
            historical_report=load_fixture("rd_entry_rollout_historical_pass.json"),
            forward_snapshot=load_fixture(
                "rd_entry_rollout_forward_current_unresolved.json"
            ),
        )


def test_any_parity_mismatch_fails_closed() -> None:
    decision = evaluate_rd_entry_rollout(
        policy_document=POLICY,
        historical_report=load_fixture("rd_entry_rollout_historical_pass.json"),
        forward_snapshot=load_fixture("rd_entry_rollout_forward_fail.json"),
    )

    assert decision.status is RolloutStatus.FAIL
    assert decision.paper_selection_may_be_enabled is False
    assert "FORWARD_PARITY_MISMATCH" in decision.reasons


def test_threshold_shortfall_remains_collecting() -> None:
    snapshot = load_fixture("rd_entry_rollout_forward_successor_exact_pass.json")
    snapshot["distinct_trading_dates"] = 9

    decision = evaluate_rd_entry_rollout(
        policy_document=SUCCESSOR_EXACT_POLICY,
        historical_report=load_fixture(
            "rd_entry_rollout_historical_successor_exact_pass.json"
        ),
        forward_snapshot=snapshot,
    )

    assert decision.status is RolloutStatus.COLLECTING
    assert decision.paper_selection_may_be_enabled is False
    assert decision.reasons == ("INSUFFICIENT_FORWARD_TRADING_DATES",)


def test_non_exact_paper_selection_is_a_hard_failure() -> None:
    snapshot = load_fixture("rd_entry_rollout_forward_successor_exact_pass.json")
    snapshot["non_exact_paper_eligible_count"] = 1

    decision = evaluate_rd_entry_rollout(
        policy_document=SUCCESSOR_EXACT_POLICY,
        historical_report=load_fixture(
            "rd_entry_rollout_historical_successor_exact_pass.json"
        ),
        forward_snapshot=snapshot,
    )

    assert decision.status is RolloutStatus.FAIL
    assert decision.paper_selection_may_be_enabled is False
    assert "NON_EXACT_PAPER_SELECTION" in decision.reasons


def test_snapshot_before_the_fixed_batch_grace_is_rejected() -> None:
    snapshot = load_fixture("rd_entry_rollout_forward_successor_exact_pass.json")
    snapshot["snapshot_captured_at"] = "2026-07-18T00:14:59Z"

    with pytest.raises(ValueError, match="batch completion grace"):
        evaluate_rd_entry_rollout(
            policy_document=SUCCESSOR_EXACT_POLICY,
            historical_report=load_fixture(
                "rd_entry_rollout_historical_successor_exact_pass.json"
            ),
            forward_snapshot=snapshot,
        )
```

Also create `tests/fixtures/rd_entry_rollout_historical_pass.json` by copying the
exact Plan-3 comparator result for its complete `pine_supported=true` manifest
subset, with zero missing cases and zero mismatches.

- [ ] **Step 2: Run the tests and verify the expected failure**

Run:

```bash
uv run pytest tests/unit/test_rd_entry_rollout.py -v
```

Expected: collection fails with
`ModuleNotFoundError: No module named 'prop_trading.domain.rd_entry_rollout'`.

- [ ] **Step 3: Add the closed policy document**

Write `config/phase0/rd-entry-rollout-policy-v2.json` exactly as:

```json
{
  "schema_id": "phase0.rd-entry-rollout-policy.v2",
  "policy_version": "2.0.0",
  "strategy_id": "rd_liquidity_sd_5m_v1",
  "rule_contract_version": "2.0.0",
  "observation_schema_version": "2.0",
  "producer_strategy_version": "2.0.0-contract2",
  "historical": {
    "minimum_case_match_rate_bps": 10000,
    "maximum_mismatches": 0,
    "maximum_missing_cases": 0
  },
  "forward": {
    "batch_completion_grace_seconds": 900,
    "minimum_distinct_trading_dates": 10,
    "minimum_completed_setup_attempts": 30,
    "minimum_exact_candidates_by_model": {
      "DIR_CLOSE": 5,
      "HTF_FLIP": 5
    },
    "required_exact_htf_contexts": [
      "15m",
      "30m",
      "1h"
    ],
    "minimum_batch_completion_rate_bps": 10000,
    "maximum_incomplete_batches": 0,
    "maximum_in_flight_batches": 0,
    "maximum_parity_mismatches": 0,
    "maximum_parity_not_provided": 0,
    "maximum_oracle_replay_mismatches": 0,
    "maximum_quarantined_objects": 0,
    "maximum_conflicting_duplicates": 0,
    "maximum_sequence_gaps": 0,
    "maximum_sequence_conflicts": 0,
    "maximum_heartbeat_schedule_mismatches": 0,
    "minimum_heartbeat_reference_bar_count": 1,
    "maximum_identity_mismatches": 0,
    "maximum_unknown_source_claims": 0,
    "maximum_non_exact_paper_eligible": 0
  },
  "promotion": {
    "producer_contract_capability": "UNRESOLVED_OBSERVATION_ONLY",
    "paper_promotion_allowed": false,
    "operator_approval_required": true,
    "maximum_evidence_age_seconds": 86400,
    "real_execution_allowed": false
  }
}
```

The fixture date count is derived from UTC receipt dates. A completed setup attempt
is a distinct setup ID with a persisted, valid terminal fact from Plan 1:
`INVALIDATED`, `BOTH_ACTIVE_MODELS_OBSERVED`, or `RETENTION_EVICTED`.
For `INVALIDATED`, `invalidated_before_entry` is true exactly when no active
candidate preceded invalidation; invalidation after one active model is valid with
`invalidated_before_entry=false` and retains that candidate.
`BOTH_ACTIVE_MODELS_OBSERVED` must be independently derivable from retained
`DIR_CLOSE` and `HTF_FLIP` candidates; `RETENTION_EVICTED` is the only expiry in
this increment. Open attempts do not count, and wall-clock time never implies
terminal state.

The existing V2 setup provenance is `CALIBRATED`, not `EXACT`; Plan 3 therefore
maps it to effective `UNRESOLVED`. Observation, parity, storage, and console
rollout may complete, but this paper-promotion policy cannot pass until a
separate reviewed contract proves complete exact common-setup provenance. Do
not lower these minima or relabel calibrated setup evidence to manufacture a
passing canary.

The parser hard-codes the safe pairing for this frozen producer:
`producer_strategy_version="2.0.0-contract2"` is valid only with
`producer_contract_capability="UNRESOLVED_OBSERVATION_ONLY"` and
`paper_promotion_allowed=false`. Changing either field is malformed policy,
not a route to `PASS`. The explicit
`rd_entry_rollout_policy_successor_exact_pass.json` unit fixture uses a
different, conspicuously test-only successor identity,
`3.0.0-contract3-exact-test-only`, together with
`producer_contract_capability="EXACT_COMMON_SETUP_PROVENANCE"` and
`paper_promotion_allowed=true`; its historical and forward fixtures carry the
same identity. It exists only to prove that the generic evaluator can pass a
future reviewed contract. Production tooling rejects the test-only identity,
and Task 7 requires a separately reviewed, committed successor policy rather
than copying this fixture.

- [ ] **Step 4: Implement the typed evaluator**

Create these public types and function in
`src/prop_trading/domain/rd_entry_rollout.py`:

```python
class RolloutStatus(StrEnum):
    COLLECTING = "COLLECTING"
    FAIL = "FAIL"
    PASS = "PASS"


@dataclass(frozen=True, slots=True)
class RDEntryRolloutDecision:
    policy_version: str
    status: RolloutStatus
    paper_selection_may_be_enabled: bool
    reasons: tuple[str, ...]
    metrics_sha256: str


def evaluate_rd_entry_rollout(
    *,
    policy_document: Mapping[str, object],
    historical_report: Mapping[str, object],
    forward_snapshot: Mapping[str, object],
) -> RDEntryRolloutDecision:
    policy = _parse_policy(policy_document)
    historical = _parse_historical_report(historical_report, policy)
    forward = _parse_forward_snapshot(forward_snapshot, policy)
    hard_failures = _hard_failure_reasons(policy, historical, forward)
    collecting = _collecting_reasons(policy, historical, forward)
    status = (
        RolloutStatus.FAIL
        if hard_failures
        else RolloutStatus.COLLECTING
        if collecting
        else RolloutStatus.PASS
    )
    reasons = _ordered_reasons((*hard_failures, *collecting))
    return RDEntryRolloutDecision(
        policy_version=policy.policy_version,
        status=status,
        paper_selection_may_be_enabled=(
            status is RolloutStatus.PASS
            and policy.promotion.paper_promotion_allowed
        ),
        reasons=reasons,
        metrics_sha256=canonical_sha256(
            {"historical": historical.as_canonical(), "forward": forward.as_canonical()}
        ),
    )
```

Use `canonical_sha256()` for `metrics_sha256`. Parse every integer as a
non-boolean, non-negative integer. Reject unknown keys, duplicate model/context
entries, mismatched versions, rates outside `0..10000`, and a report that claims
more matches than total cases. `_parse_historical_report()` consumes the exact
Plan-3 schema: its `policy_version` is `rd-entry-arbitration-v2`, not the rollout
policy's `2.0.0`; require `mismatch_count == len(mismatches)`,
`missing_count == len(missing_cases)`, unique diagnostic case IDs,
`len(diagnostics) == total_cases`, and counts consistent with diagnostic
statuses. Classify insufficient sample counts as
`COLLECTING`; classify parity, safety, identity, source, or completion violations
as `FAIL`. Treat the forward window as the half-open UTC interval
`[window_started_at, window_ended_at)`. Require
`snapshot_captured_at >= window_ended_at + batch_completion_grace_seconds`; the
grace is exactly 900 seconds. Also require
`snapshot_captured_at <= window_ended_at +
promotion.maximum_evidence_age_seconds`; an already stale capture cannot pass.
Include every batch whose first receipt is inside
the query window. After the grace, any such batch without its completion row is
a hard failure. A promotion-capable snapshot must be `FINAL`, have zero
in-flight and incomplete batches, zero `MISMATCH` and `NOT_PROVIDED` parity
rows, zero Python-oracle replay mismatches, zero quarantined objects, zero
immutable conflicts, zero sequence gaps, zero sequence conflicts, zero heartbeat
schedule mismatches, a nonzero policy-minimum heartbeat reference count, zero
unknown claims, zero identity mismatches, and exactly one
strategy/version/detector/settings code identity. Any nonempty sorted set of
producer instance IDs may share that code identity across restarts. Require
`parity_match_count + parity_mismatch_count + parity_not_provided_count ==
evaluation_count` and
`heartbeat_schedule_match_count + heartbeat_schedule_mismatch_count ==
heartbeat_reference_bar_count`. The reference count is the number of
producer-interval × compatible-reference-epoch comparisons, not merely the
number of distinct epochs; this keeps the partition exact across multiple
producer instances. `heartbeat_reference_bar_count == 0` or a count below the
policy minimum is `COLLECTING`; a malformed partition is `FAIL`. Do not
silently exclude an in-flight batch, infer setup expiry, or count an open setup
as completed. Sort reason codes by a frozen tuple, never by discovery order.

Always add `CURRENT_PRODUCER_NOT_PROMOTABLE` to the collecting reasons for
`2.0.0-contract2`, even if an input snapshot claims exact counters. A policy
with `paper_promotion_allowed=false` can never return `PASS`; when no hard
failure exists it remains `COLLECTING`.

Freeze distinct hard-failure reasons for
`FORWARD_INCOMPLETE_BATCH`, `FORWARD_IN_FLIGHT_BATCH`,
`FORWARD_PARITY_MISMATCH`, `FORWARD_PARITY_NOT_PROVIDED`,
`ORACLE_REPLAY_MISMATCH`, `QUARANTINED_OBJECT`,
`CONFLICTING_IMMUTABLE_ID`, `SEQUENCE_GAP`, `SEQUENCE_CONFLICT`,
`HEARTBEAT_SCHEDULE_MISMATCH`, `HEARTBEAT_COVERAGE_PARTITION_MISMATCH`,
`UNKNOWN_SOURCE_CLAIM`,
`CANARY_IDENTITY_MISMATCH`, and `NON_EXACT_PAPER_SELECTION`; do not collapse
them into one generic parity failure.

- [ ] **Step 5: Complete the pass and fail fixtures**

The pass fixture must contain:

```json
{
  "schema_id": "phase0.rd-entry-forward-snapshot.v2",
  "policy_version": "3.0.0-test-only",
  "window_started_at": "2026-07-06T00:00:00Z",
  "window_ended_at": "2026-07-18T00:00:00Z",
  "snapshot_captured_at": "2026-07-18T00:15:00Z",
  "source_window_status": "FINAL",
  "capture_deadline": "2026-07-18T00:15:00Z",
  "page_count": 2,
  "evaluation_count": 30,
  "distinct_trading_dates": 10,
  "completed_setup_attempts": 30,
  "exact_candidates_by_model": {
    "DIR_CLOSE": 18,
    "HTF_FLIP": 12
  },
  "observed_exact_htf_contexts": [
    "15m",
    "30m",
    "1h"
  ],
  "batch_count": 40,
  "complete_batch_count": 40,
  "incomplete_batch_count": 0,
  "in_flight_batch_count": 0,
  "quarantined_object_count": 0,
  "parity_match_count": 30,
  "parity_mismatch_count": 0,
  "parity_not_provided_count": 0,
  "oracle_replay_mismatch_count": 0,
  "conflicting_duplicate_count": 0,
  "sequence_gap_count": 0,
  "sequence_conflict_count": 0,
  "heartbeat_schedule_match_count": 40,
  "heartbeat_schedule_mismatch_count": 0,
  "heartbeat_reference_bar_count": 40,
  "identity_mismatch_count": 0,
  "unknown_source_claim_count": 0,
  "non_exact_paper_eligible_count": 0,
  "code_identities": [
    {
      "producer_instance_ids": [
        "rd-entry-v3-shadow-a",
        "rd-entry-v3-shadow-b"
      ],
      "strategy_id": "rd_liquidity_sd_5m_v1",
      "strategy_version": "3.0.0-contract3-exact-test-only",
      "detector_code_hash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "settings_hash": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    }
  ]
}
```

This is the synthetic
`rd_entry_rollout_forward_successor_exact_pass.json` fixture. Its explicit
successor policy and historical fixture use the same
`3.0.0-contract3-exact-test-only` identity. The current-calibrated and failure
fixtures retain `2.0.0-contract2` and can never unlock promotion.

The fail fixture changes `parity_match_count` to `29` and
`parity_mismatch_count` to `1`. Add parameterized boundary tests for every
frozen threshold and hard-failure metric, including each strict-zero counter,
the parity and heartbeat partition equations, zero and below-minimum heartbeat
reference coverage, final-window requirement, exactly one code identity, and a
sorted nonempty producer-instance set.

The historical pass fixture uses the exact Plan-3 comparator schema. Do not
invent a second meaning for `policy_version`, turn mismatch arrays into counts,
or assume every domain-only vector is Pine-supported. Copy the complete
generated comparator report without reshaping it, then assert:

The Plan-3 report is explicitly evaluated against each supported vector's
`pine_edge_input`/`pine_expected` view, where current V3 common setup fidelity
is `UNRESOLVED`. A fully matched historical report therefore proves detector
parity while remaining compatible with a failed paper-promotion gate; it must
not be reinterpreted against `edge_input`/`expected` to manufacture exact
common provenance.

The successor historical test fixture is separately generated from the
test-only successor manifest/oracle/settings identity and proves exact common
setup provenance for that synthetic contract. It must not copy the current
historical bytes and change only a version field.

```python
assert historical["schema_id"] == "phase0.rd-entry-historical-parity.v2"
assert historical["policy_version"] == "rd-entry-arbitration-v2"
assert historical["total_cases"] == len(manifest["case_ids"])
assert historical["matched_cases"] == historical["total_cases"]
assert historical["case_match_rate_bps"] == 10_000
assert historical["mismatch_count"] == len(historical["mismatches"]) == 0
assert historical["missing_count"] == len(historical["missing_cases"]) == 0
```

The fixture's
`diagnostics` length equals `total_cases`, its case IDs are unique, and all
diagnostics are `MATCHED`. Parsers derive the supported total from the manifest
and never hardcode `23`, `24`, or any other count.

- [ ] **Step 6: Run the targeted tests**

Run:

```bash
uv run pytest tests/unit/test_rd_entry_rollout.py -v
uv run ruff check src/prop_trading/domain/rd_entry_rollout.py tests/unit/test_rd_entry_rollout.py
uv run mypy
```

Expected: all rollout tests pass, Ruff reports no errors, and mypy exits `0`.

- [ ] **Step 7: Commit the policy and evaluator**

```bash
git add config/phase0/rd-entry-rollout-policy-v2.json \
  src/prop_trading/domain/rd_entry_rollout.py \
  tests/unit/test_rd_entry_rollout.py \
  tests/fixtures/rd_entry_rollout_historical_pass.json \
  tests/fixtures/rd_entry_rollout_policy_successor_exact_pass.json \
  tests/fixtures/rd_entry_rollout_historical_successor_exact_pass.json \
  tests/fixtures/rd_entry_rollout_forward_successor_exact_pass.json \
  tests/fixtures/rd_entry_rollout_forward_current_unresolved.json \
  tests/fixtures/rd_entry_rollout_forward_fail.json
git commit -m "feat: freeze RD entry rollout gates"
```

---

### Task 2: Build reproducible historical and forward canary reports

**Files:**

- Create: `scripts/capture_rd_entry_canary.py`
- Create: `scripts/build_rd_entry_rollout_report.py`
- Create: `scripts/build_rd_entry_edge_metadata.py`
- Create: `scripts/record_rd_entry_edge_deployment.py`
- Create: `scripts/generate_rd_entry_promotion_binding.py`
- Create: `scripts/verify_rd_entry_promotion.py`
- Create: `tests/unit/test_rd_entry_canary_capture.py`
- Create: `tests/unit/test_rd_entry_edge_provenance.py`
- Create: `tests/unit/test_rd_entry_promotion.py`
- Create: `tests/unit/test_rd_entry_rollout_report.py`
- Create: `tests/fixtures/rd_entry_evaluations_canary_pass_v2.json`
- Create: `tests/fixtures/rd_entry_evaluations_canary_page_1_v2.json`
- Create: `tests/fixtures/rd_entry_evaluations_canary_page_2_v2.json`
- Create: `contracts/schema/rd-entry-forward-capture-v2.schema.json`
- Create: `contracts/schema/rd-entry-edge-build-metadata-v2.schema.json`
- Create: `contracts/schema/rd-entry-edge-deployment-v2.schema.json`
- Create: `contracts/schema/rd-entry-rollout-report-v2.schema.json`
- Create: `contracts/schema/rd-entry-promotion-evidence-v2.schema.json`
- Create: `config/phase0/rd-entry-pine-v3-forward-settings.json`
- Create: `reports/rd-entry-historical-parity-v2.json`
- Modify: `scripts/export_schemas.py`
- Modify: `Makefile`

- [ ] **Step 1: Write the failing report-builder tests**

Test the CLI entry function with temporary output paths:

```python
def test_builder_emits_a_passing_canonical_report(tmp_path: Path) -> None:
    output = tmp_path / "report.json"
    exit_code = main(
        [
            "--policy",
            "tests/fixtures/rd_entry_rollout_policy_successor_exact_pass.json",
            "--historical",
            "tests/fixtures/rd_entry_rollout_historical_successor_exact_pass.json",
            "--historical-manifest",
            "tests/fixtures/rd_pine_parity/manifest.json",
            "--oracle",
            "contracts/vectors/rd-entry-arbitration-v2.json",
            "--forward",
            "tests/fixtures/rd_entry_rollout_forward_successor_exact_pass.json",
            "--pine-source",
            "scripts/pinescript/SND_RD_5M_V3_MULTI_ENTRY_LAB.pine",
            "--historical-pine-settings",
            "config/phase0/rd-entry-pine-v3-parity-settings.json",
            "--forward-pine-settings",
            "config/phase0/rd-entry-pine-v3-forward-settings.json",
            "--output",
            str(output),
        ]
    )

    report = json.loads(output.read_text(encoding="utf-8"))
    assert exit_code == 0
    assert report["status"] == "PASS"
    assert report["paper_selection_may_be_enabled"] is True
    assert report["real_execution_allowed"] is False
    assert report["reasons"] == []


def test_builder_returns_two_for_a_failed_canary(tmp_path: Path) -> None:
    output = tmp_path / "report.json"
    exit_code = main(
        [
            "--policy",
            "config/phase0/rd-entry-rollout-policy-v2.json",
            "--historical",
            "tests/fixtures/rd_entry_rollout_historical_pass.json",
            "--historical-manifest",
            "tests/fixtures/rd_pine_parity/manifest.json",
            "--oracle",
            "contracts/vectors/rd-entry-arbitration-v2.json",
            "--forward",
            "tests/fixtures/rd_entry_rollout_forward_fail.json",
            "--pine-source",
            "scripts/pinescript/SND_RD_5M_V3_MULTI_ENTRY_LAB.pine",
            "--historical-pine-settings",
            "config/phase0/rd-entry-pine-v3-parity-settings.json",
            "--forward-pine-settings",
            "config/phase0/rd-entry-pine-v3-forward-settings.json",
            "--output",
            str(output),
        ]
    )

    assert exit_code == 2
```

Add tests that `--check` returns `1` for stale bytes, canonical JSON ends with one
newline, timestamps come from the observation window rather than wall-clock time,
and keys named `credential`, `authorization`, `token`, `secret`, or
`paper_commands` make input validation fail.

Create `tests/unit/test_rd_entry_canary_capture.py` with an injected, ordered
fake HTTP reader. Prove all of these boundaries:

```python
def test_capture_follows_every_opaque_cursor_and_keeps_window_fixed() -> None:
    capture = capture_canary_pages(
        edge_base_url="https://edge.example",
        since="2026-07-06T00:00:00Z",
        until="2026-07-18T00:00:00Z",
        captured_at="2026-07-18T00:15:00Z",
        fetch_json=two_page_fake(),
    )
    assert len(capture["pages"]) == 2
    assert capture["pages"][-1]["page"] == {
        "has_more": False,
        "next_cursor": None,
    }
    assert requested_cursors() == [None, "opaque-page-2"]


@pytest.mark.parametrize(
    "fault",
    [
        "repeated-cursor",
        "missing-final-page",
        "changed-window",
        "changed-canary-summary",
        "duplicate-setup-across-pages",
        "non-null-filter",
        "open-grace",
        "canonical-paper-enabled",
        "forbidden-key",
        "cross-origin-redirect",
    ],
)
def test_capture_fails_closed_without_writing_partial_output(
    fault: str,
    tmp_path: Path,
) -> None:
    output = tmp_path / "capture.json"
    with pytest.raises(CanaryCaptureError):
        capture_canary_to_path(
            edge_base_url="https://edge.example",
            since="2026-07-06T00:00:00Z",
            until="2026-07-18T00:00:00Z",
            captured_at="2026-07-18T00:15:00Z",
            output_path=output,
            fetch_json=faulting_page_reader(fault),
        )
    assert not output.exists()
```

Also prove the report builder rejects a capture with one missing page even when
the first-page canary aggregate would pass, replays every returned
`proof_inputs` stream through `evaluate_entry_stream()`, and reports a mismatch
for any changed candidate, evidence, handling, terminal, or authoritative
selection field.

In `test_rd_entry_promotion.py`, freeze the verifier clock and prove each changed
bound byte, a zero/all-uppercase digest, a source change outside the four report
files, a different edge/Pine identity, a dirty tree, and `now > fresh_until`
fails before approval. Prove `fresh_until` is exactly
`window_ended_at + 86400`, regardless of a later `captured_at`.

In `test_rd_entry_edge_provenance.py`, use injected subprocess, Wrangler JSON,
and health readers. Prove build metadata is rejected unless the source commit
is the clean checked-out commit and its recorded tree OID is exactly
`git rev-parse <source_commit>^{tree}`. Prove the upload tag is the lowercase
SHA-256 of the exact canonical build-metadata bytes, not an operator-entered
label or a Wrangler message. Prove the deployment record rejects a listed
version ID, runtime `CF_VERSION_METADATA.id`, or runtime
`CF_VERSION_METADATA.tag` mismatch; the runtime tag must equal that build
metadata digest. Add generator golden tests proving the disabled runtime
promotion binding is exactly `null`, PASS evidence produces deterministic
TypeScript bytes, and any changed report/source/Pine/detector/settings/build
digest fails generation.

Add focused summary tests proving `UNRESOLVED`, realtime-only, or otherwise
non-replayable evidence does not increment either
`exact_candidates_by_model` or `observed_exact_htf_contexts`, and two producer
instance IDs with the same code identity pass while a second detector/settings
identity fails.

- [ ] **Step 2: Run the tests and verify the expected failure**

Run:

```bash
uv run pytest tests/unit/test_rd_entry_canary_capture.py \
  tests/unit/test_rd_entry_promotion.py \
  tests/unit/test_rd_entry_rollout_report.py -v
```

Expected: collection fails because the capture and report modules do not exist.

- [ ] **Step 3: Implement the report builder**

First create a production-forward settings profile separate from the historical
Bar Replay profile:

```json
{
  "schema_version": "rd-entry-pine-v3-forward-settings/v2",
  "detector_inputs": {
    "ticker_id": "OANDA:GBPJPY",
    "chart_type": "STANDARD_CANDLES",
    "chart_timeframe_minutes": 5,
    "lower_timeframe_minutes": 1,
    "max_zones": 120,
    "projection_bars": 120,
    "display_mode": "Raw audit",
    "premium_visuals": false,
    "clean_zones_per_level": 1,
    "setup_outcome_bars": 12,
    "show_fresh": true,
    "show_tapped": false,
    "show_invalidated": false,
    "show_liquidity_lines": false,
    "show_liquidity_proof_lines": false,
    "show_status_panel": false,
    "liquidity_pivot_strength": 2,
    "show_labels": false,
    "emit_diagnostics": false,
    "export_setup_events": true,
    "observe_realtime_entry_ticks": false,
    "producer_tag": "rd-entry-v3-forward-shadow",
    "execution_mode": "OBSERVATION_ONLY"
  },
  "runtime_inputs": {
    "validation_capture": false
  }
}
```

Use the Plan-3 settings validator to print and then add the exact
`detector_code_hash` and `settings_hash`; the latter is the canonical SHA-256 of
this forward `detector_inputs` object. Validate the same strict key set as the
historical profile. The two hashes must differ because
`export_setup_events`/`producer_tag` differ. Paste only the forward settings hash
into the live alert. A live receipt carrying the historical-parity settings
hash is an identity mismatch, not acceptable evidence.

Implement the capture script first. Expose
`capture_canary_pages(*, edge_base_url: str, since: str, until: str,
captured_at: str, fetch_json: FetchJson = fetch_json_without_credentials) ->
dict[str, object]` for pure page traversal, plus
`capture_canary_to_path` with the same keyword inputs and an additional
`output_path: Path`, returning `dict[str, object]`, for the atomic writer
exercised above.

Accept only an HTTPS origin with no user info, query, or fragment. Every request
is a GET with only `Accept: application/json`; never accept an authorization,
cookie, webhook, token, secret, or arbitrary-header CLI option. Start with
`limit=200&since=<fixed>&until=<fixed>`, follow only the returned opaque
`next_cursor`, and repeat the same limit/window on every page. Reject a redirect
to another origin.

Validate before writing anything:

- response `mode` is `OBSERVATION_ONLY`, `execution` is `DISABLED`, and
  `canonical_paper_enabled` is false;
- `count == len(items) <= 200`;
- setup IDs are unique within and across pages;
- every non-final page has `has_more=true` and a new non-null cursor;
- exactly one final page has `has_more=false` and `next_cursor=null`;
- the entire `canary` object is canonically identical on every page;
- its window equals the requested half-open interval, status is `FINAL`, grace
  is 900, and `captured_at >= capture_deadline`;
- its deployment version ID is nonempty and its version tag is lowercase
  64-hex; both remain identical across pages;
- every `canary.applied_filters` value is null; and
- forbidden key names are absent recursively from every page.

Cap traversal at 10,000 pages, reject cursor cycles, HTTP failures, malformed
JSON, duplicate/unknown keys, noncanonical timestamps, and any incomplete
chain. Write canonical JSON atomically only after the final-page check. The
credential-free capture document has exactly:

```python
{
    "schema_id": "phase0.rd-entry-forward-capture.v2",
    "captured_at": captured_at,
    "window_since": since,
    "window_until": until,
    "page_limit": 200,
    "pages": pages,
}
```

Then expose from `build_rd_entry_rollout_report.py`:

```python
def build_report(
    *,
    policy_path: Path,
    historical_path: Path,
    forward_path: Path,
    source_commit: str,
    bindings: Mapping[str, object],
) -> dict[str, object]:
    policy = load_strict_json(policy_path)
    historical = load_strict_json(historical_path)
    forward = load_strict_json(forward_path)
    decision = evaluate_rd_entry_rollout(
        policy_document=policy,
        historical_report=historical,
        forward_snapshot=forward,
    )
    return serialize_rollout_report(policy, historical, forward, decision)


def main(argv: Sequence[str] | None = None) -> int:
    arguments = parse_arguments(argv)
    report = build_report(
        policy_path=arguments.policy,
        historical_path=arguments.historical,
        forward_path=arguments.forward,
        source_commit=arguments.source_commit,
        bindings=build_evidence_bindings(arguments),
    )
    write_or_check_canonical_report(
        report=report,
        output_path=arguments.output,
        check=arguments.check,
    )
    return 0 if report["status"] == "PASS" else 2
```

The output shape is:

```json
{
  "schema_id": "phase0.rd-entry-rollout-report.v2",
  "policy_version": "2.0.0",
  "strategy_id": "rd_liquidity_sd_5m_v1",
  "source_commit": "40 lowercase hexadecimal characters",
  "window_started_at": "UTC timestamp copied from input",
  "window_ended_at": "UTC timestamp copied from input",
  "snapshot_captured_at": "UTC timestamp copied from input",
  "fresh_until": "window_ended_at plus 86400 seconds",
  "historical": {},
  "forward": {},
  "bindings": {
    "edge_shadow_version_id": "recorded Cloudflare application version",
    "edge_shadow_version_tag": "64 lowercase build-metadata digest",
    "edge_shadow_build_metadata_sha256": "same 64 lowercase digest",
    "policy_sha256": "64 lowercase hexadecimal characters",
    "historical_report_sha256": "64 lowercase hexadecimal characters",
    "forward_capture_sha256": "64 lowercase hexadecimal characters",
    "pine_source_sha256": "64 lowercase hexadecimal characters",
    "historical_pine_settings_sha256": "64 lowercase hexadecimal characters",
    "forward_pine_settings_sha256": "64 lowercase hexadecimal characters",
    "detector_code_hash": "64 lowercase hexadecimal characters",
    "settings_hash": "64 lowercase hexadecimal characters"
  },
  "metrics_sha256": "64 lowercase hexadecimal characters",
  "status": "PASS",
  "paper_selection_may_be_enabled": true,
  "real_execution_allowed": false,
  "reasons": []
}
```

Pass `source_commit` from `git rev-parse HEAD`; verify it is lowercase 40-hex
and is the current `HEAD`. Capture starts from a clean tree. During evidence
generation, permit only the declared forward capture/summary/decision/promotion
output paths to be new or modified; reject every other dirty or untracked path.
The committed Plan-3 historical comparator report remains byte-for-byte in its
own `phase0.rd-entry-historical-parity.v2` schema. It has no rollout `status` or
`paper_selection_may_be_enabled` fields. The separate rollout report above
embeds the validated historical metrics under `historical`, binds the original
file hash, and is the only document that carries `PASS|FAIL|COLLECTING` and
enablement fields. The builder exits `0` for `PASS`, `2` for a valid
`FAIL|COLLECTING` report, and `1` for malformed input or stale `--check` output.
Rebuild the shadow build-metadata preimage from `source_commit`, require its
digest to equal the capture's runtime deployment tag, and require
`--edge-shadow-version-id` to equal the capture's runtime deployment ID.

Add the exact normalization surface
`summarize_forward_evaluations(*, capture_document: Mapping[str, object],
policy_document: Mapping[str, object], pine_source_path: Path,
pine_settings_path: Path) -> dict[str, object]`.

It accepts only the cursor-complete capture schema above, revalidates the entire
page chain, and performs no network access. For every item:

1. parse every `proof_inputs[].match_request` as a Plan-1 expanded
   `EntryMatchRequest`; validate every embedded bounded HTF transcript through
   `validate_htf_flip_transcript()`;
2. preserve the API `event_id` and chronological order, build an
   `EntryOracleCase`, and replay the full accumulated stream through
   `evaluate_entry_stream()`—never evaluate only the last event;
3. compare the resulting candidates, evidence, handling, terminal derivation,
   and selection to the API authoritative objects. Compare API
   `selection.action` to the expected shadow-forced action, but compare its
   `policy_action` to the oracle action;
4. require `parity_status == "MATCH"`, a non-null producer diagnostic, and a
   null mismatch reason; and
5. record a deterministic mismatch path instead of trusting a page-level
   parity claim.

Construct that case with `setup_id` from the item, event IDs and match requests
from `proof_inputs`, `setup_invalidated` from the last proof input's derived
`invalidated_before_entry` fact, and policy version/revision/evaluation epoch
from the authoritative selection. `EntryOracleCase` re-derives and validates
the invalidation flag and terminal transition. Require each proof input's
stored `proof_input_sha256` and `event_id` to recompute before creating the
case. The evaluation's cohort batch and selection must be inside
`[since,until)`. Historical proof inputs needed to replay that setup may predate
`since`; require their receipt/batch provenance to exist and to have been
recorded no later than the fixed capture deadline. Reject any post-deadline
proof input, but do not discard valid pre-window replay context.

After replaying all setups, derive unique semantic candidate counts by model
only when the candidate has at least one `EXACT` replayable evidence row, the
exact union of HTF contexts from those same exact evidence rows, and completed
attempts from valid explicit terminal facts. Require the derived
completed-attempt count to equal `canary.completed_attempts`. Set
`distinct_trading_dates` from the window-wide
`canary.distinct_receipt_dates`, which counts cohort chunk-receipt UTC dates
through the fixed capture deadline; do not derive it from only paginated setup
items because an empty heartbeat batch has no item. Copy
batch, quarantine, immutable-conflict, sequence-gap, sequence-conflict,
heartbeat-schedule-mismatch, unknown-claim, and all three parity counts from the
identical window-wide
aggregate, but validate their equations and strict-zero gates. Group aggregate
identities by `(strategy_id, strategy_version, detector_code_hash,
settings_hash)`, emit all code-identity groups in canonical sorted order, and
emit each nonempty producer-instance-ID set sorted. A restart may change
`producer_instance_id`; it may not change code or settings within one canary
window. Set `identity_mismatch_count` to zero only when there is exactly one
group and it matches the policy/Pine settings; a well-formed second group
produces a deterministic `FAIL` report rather than being hidden. Independently
require for the sole passing group:

```python
identity["detector_code_hash"] == sha256_file(pine_source_path)
identity["detector_code_hash"] == settings["detector_code_hash"]
identity["settings_hash"] == canonical_sha256(settings["detector_inputs"])
identity["settings_hash"] == settings["settings_hash"]
```

The summary's `exact_candidates_by_model` and
`observed_exact_htf_contexts` come only from the replayed domain objects; they
are not operator-entered counters. Map domain context minutes
`15/30/60` to policy labels `15m/30m/1h` exactly; reject any other value. Its
`oracle_replay_mismatch_count` and `identity_mismatch_count` are exact derived
counts. Derive `non_exact_paper_eligible_count` from authoritative
`selection.policy_action == "PAPER_ELIGIBLE"` with non-`EXACT` canonical
evidence; the shadow-forced effective `selection.action` cannot hide it. Reject
duplicate setup IDs, missing authoritative fields, an
unrepresented page, malformed identities, malformed proof provenance, a terminal
count disagreement, or a parity partition that does not equal the aggregate
evaluation count.

The CLI accepts `--forward-capture` together with
`--forward-summary-output`; those arguments are mutually exclusive with
`--forward`. Use the two paginated fixtures to prove they normalize exactly to
`rd_entry_rollout_forward_successor_exact_pass.json`; separately normalize the
current-provenance fixture to
`rd_entry_rollout_forward_current_unresolved.json`.

Implement the deployment-provenance tools in this task as one closed chain.
`build_rd_entry_edge_metadata.py` reads a clean source commit and its exact tree
OID, hashes the Worker source/config/lock/migration inputs, and canonicalizes the
intended runtime state (`null` binding plus disabled flag for shadow, or the
generated binding payload plus exact promotion variables for a successor).
`build_metadata_digest` is the SHA-256 of that canonical object before its
digest field is added; this avoids self-reference while binding every
behavior-affecting byte and the source tree.
`record_rd_entry_edge_deployment.py` requires runtime
`CF_VERSION_METADATA.id/tag`, the Wrangler-listed version ID, and the expected
digest; it rejects unless the IDs agree and the tag equals the digest. The
evaluations API repeats this credential-free `{id,tag}` in its canary aggregate,
so every capture binds the runtime version that served it.

For a successor promotion, `generate_rd_entry_promotion_binding.py` derives the
binding and intended enabled Wrangler mapping from already committed PASS
evidence, computes promotion build metadata over that exact normalized
transition, and writes deterministic TypeScript. The build digest deliberately
excludes only its own output field; changing any other binding, environment,
source-tree, detector, settings, or report byte changes the digest. Tests
recompute the preimage independently and reject a hand-entered tag, message,
version ID, source commit, or digest.

Finally, write a separate `phase0.rd-entry-promotion-evidence.v2` manifest after
the forward summary and decision bytes exist. It contains the report
`source_commit`, edge shadow version ID, snapshot/fresh-until timestamps, and
SHA-256 digests of the policy, historical report, forward capture, forward
summary, rollout decision, Pine source, and Pine settings files, plus the
detector/settings semantic hashes. The manifest has no self-hash and no
credential. `verify_rd_entry_promotion.py` recomputes every digest, validates
the single code identity and sorted producer-instance set, requires `PASS`,
`paper_selection_may_be_enabled=true`,
`real_execution_allowed=false`, requires the current UTC time to be no later
than `fresh_until` (computed from the closed window end, never from a later
recapture time), and verifies the bound source commit is an ancestor whose
non-report implementation/Pine/config files are unchanged. Between
`source_commit` and `HEAD`, the verifier permits changes only to
`rd-entry-forward-capture-v2.json`, `rd-entry-forward-canary-v2.json`,
`rd-entry-rollout-decision-v2.json`, and
`rd-entry-promotion-evidence-v2.json` under `reports/`; any other changed path
fails and requires a new shadow deployment/canary binding.
Its explicit `--allow-intended-promotion-diff --check-wrangler <path>` mode is
the only exception: it allows the dirty `wrangler.jsonc` whose semantic diff is
exactly the false-to-true flag change plus the three manifest-equal environment
values and the generated promotion-binding file whose bytes exactly match
fresh generator output. Any other dirty path, generated byte, or Wrangler key
still fails.

Freeze the manifest keys exactly:

```json
{
  "schema_id": "phase0.rd-entry-promotion-evidence.v2",
  "source_commit": "40 lowercase hex",
  "edge_shadow_version_id": "opaque nonempty Wrangler version ID",
  "edge_shadow_version_tag": "64 lowercase build-metadata digest",
  "edge_shadow_build_metadata_sha256": "same 64 lowercase digest",
  "window_ended_at": "UTC Z timestamp",
  "snapshot_captured_at": "UTC Z timestamp",
  "fresh_until": "UTC Z timestamp",
  "policy_sha256": "64 lowercase hex",
  "historical_report_sha256": "64 lowercase hex",
  "forward_capture_sha256": "64 lowercase hex",
  "forward_summary_sha256": "64 lowercase hex",
  "rollout_decision_sha256": "64 lowercase hex",
  "pine_source_sha256": "64 lowercase hex",
  "historical_pine_settings_sha256": "64 lowercase hex",
  "forward_pine_settings_sha256": "64 lowercase hex",
  "detector_code_hash": "64 lowercase hex",
  "settings_hash": "64 lowercase hex",
  "strategy_id": "rd_liquidity_sd_5m_v1",
  "rule_contract_version": "exact version copied from the rollout policy",
  "producer_strategy_version": "exact version copied from the rollout policy",
  "producer_instance_ids": ["sorted", "nonempty"]
}
```

Every digest hashes exact file bytes. In particular,
`rollout_decision_sha256` is the value later placed in
`RD_ENTRY_PROMOTION_REPORT_SHA256`.

- [ ] **Step 4: Register and generate the evidence schemas**

Add strict Pydantic models for the cursor-complete capture, Edge build metadata,
Edge deployment record, rollout report, and promotion-evidence manifest to the
focused v2 schema registry introduced in Plan 1. Register
`rd-entry-forward-capture-v2`, `rd-entry-edge-build-metadata-v2`,
`rd-entry-edge-deployment-v2`, `rd-entry-rollout-report-v2`, and
`rd-entry-promotion-evidence-v2`, then run:

```bash
uv run python scripts/export_schemas.py --output-dir contracts/schema
uv run python scripts/export_schemas.py --output-dir contracts/schema --check
```

Expected: all five strict schemas are generated, then the check reports no
diff.

- [ ] **Step 5: Generate the committed historical parity report**

First run the Plan-3 comparator:

```bash
uv run python scripts/compare_rd_pine_parity.py \
  --manifest tests/fixtures/rd_pine_parity/manifest.json \
  --oracle contracts/vectors/rd-entry-arbitration-v2.json \
  --output reports/rd-entry-historical-parity-v2.json
```

Expected: the report contains every `pine_supported=true` case bound by the
manifest, `mismatch_count: 0`, `mismatches: []`, `missing_count: 0`, and
`missing_cases: []`. Its total is derived from manifest `case_ids`; domain-only
vectors remain in the oracle without being misclassified as missing Pine cases.

Verify stable bytes:

```bash
uv run python scripts/compare_rd_pine_parity.py \
  --manifest tests/fixtures/rd_pine_parity/manifest.json \
  --oracle contracts/vectors/rd-entry-arbitration-v2.json \
  --output reports/rd-entry-historical-parity-v2.json \
  --check
```

Expected: exit `0` with `RD ENTRY PINE PARITY CHECK PASSED`.

- [ ] **Step 6: Add generated checks to the root proof**

Add the parity `--check` command to `verify-generated` and add a
`verify-rd-entry-rollout` Make target that runs the policy, cursor-capture,
oracle-replay report, promotion-verifier unit tests plus all three schema
validations. Make `verify-observation` depend on it.

Run:

```bash
make verify-rd-entry-rollout
```

Expected final line:

```text
RD ENTRY ROLLOUT POLICY VERIFIED — paper eligibility remains gated
```

- [ ] **Step 7: Commit the report tooling**

```bash
git add scripts/build_rd_entry_rollout_report.py \
  scripts/capture_rd_entry_canary.py \
  scripts/build_rd_entry_edge_metadata.py \
  scripts/record_rd_entry_edge_deployment.py \
  scripts/generate_rd_entry_promotion_binding.py \
  scripts/verify_rd_entry_promotion.py \
  tests/unit/test_rd_entry_canary_capture.py \
  tests/unit/test_rd_entry_edge_provenance.py \
  tests/unit/test_rd_entry_promotion.py \
  tests/unit/test_rd_entry_rollout_report.py \
  tests/fixtures/rd_entry_evaluations_canary_pass_v2.json \
  tests/fixtures/rd_entry_evaluations_canary_page_1_v2.json \
  tests/fixtures/rd_entry_evaluations_canary_page_2_v2.json \
  contracts/schema/rd-entry-rollout-report-v2.schema.json \
  contracts/schema/rd-entry-forward-capture-v2.schema.json \
  contracts/schema/rd-entry-edge-build-metadata-v2.schema.json \
  contracts/schema/rd-entry-edge-deployment-v2.schema.json \
  contracts/schema/rd-entry-promotion-evidence-v2.schema.json \
  config/phase0/rd-entry-pine-v3-forward-settings.json \
  reports/rd-entry-historical-parity-v2.json \
  scripts/export_schemas.py \
  Makefile
git commit -m "test: add RD entry rollout report gate"
```

---

### Task 3: Write the dual-version deployment and incident runbook

**Files:**

- Create: `docs/runbooks/rd-entry-v2-shadow-rollout.md`
- Modify: `README.md`
- Modify: `docs/development.md`
- Modify: `apps/observation-edge/README.md`
- Modify: `docs/architecture.md`
- Modify: `docs/threat-model.md`

- [ ] **Step 1: Add a failing documentation boundary test**

Extend `tests/static/test_boundaries.py` so it requires the new runbook to contain:

```python
required_rollout_statements = (
    "RD_ENTRY_CANONICAL_PAPER_ENABLED=false",
    "RD_ENTRY_PROMOTION_REPORT_SHA256 binds the rollout decision bytes",
    "RD_ENTRY_PROMOTION_SOURCE_COMMIT and RD_ENTRY_PROMOTION_PINE_SHA256",
    "schema 1.0, 1.1, and 1.2 remain accepted",
    "schema 2.0 cannot contain paper_commands",
    "Worker rollback does not reverse D1 migrations",
    "pause the V3 TradingView alert before Worker rollback",
    "explicit operator approval",
    "real execution remains disabled",
)
```

Also assert that the active edge documentation lists
`GET /api/v1/observation-entry-evaluations`.

- [ ] **Step 2: Run the test and verify the expected failure**

Run:

```bash
uv run pytest tests/static/test_boundaries.py -v
```

Expected: failure because `docs/runbooks/rd-entry-v2-shadow-rollout.md` does not
exist.

- [ ] **Step 3: Write the runbook as an exact state machine**

Document these states and legal transitions:

```text
LOCAL_VERIFIED
  -> EDGE_SHADOW
  -> V3_FORWARD_SHADOW
  -> CANARY_PASS
  -> PAPER_SELECTION_ELIGIBLE

EDGE_SHADOW | V3_FORWARD_SHADOW | CANARY_PASS
  -> V3_PAUSED
  -> EDGE_SHADOW

PAPER_SELECTION_ELIGIBLE
  -> V3_PAUSED
  -> EDGE_SHADOW
```

For each state, list entry checks, expected health/API values, who approves the
transition, and the rollback action. State that a failed or collecting report
cannot transition to `PAPER_SELECTION_ELIGIBLE`.

- [ ] **Step 4: Document secret-safe TradingView setup**

The runbook must instruct the operator to:

1. Paste V3 source into a new TradingView indicator without modifying the V2
   source.
2. Enter the raw observation credential only in V3's private script input.
3. Create an alert using `Any alert() function call`.
4. Use the existing Cloudflare URL ending in
   `/api/v1/tradingview/observations`.
5. Keep V2 enabled until the V3 snapshot, incremental receipt, candidate list,
   evidence list, and backend selection are visible.
6. Never paste the credential into the webhook URL or alert name.

- [ ] **Step 5: Update the architecture and threat model**

Document that the edge is the sole v2 selection authority, Pine selection is
diagnostic, D1 stores append-only proof, and `PAPER_ELIGIBLE` is a classification
only. Add threats and mitigations for chunk withholding, producer/backend
disagreement, source-claim spoofing, and a stale canary report.

- [ ] **Step 6: Run documentation and boundary checks**

Run:

```bash
uv run pytest tests/static/test_boundaries.py -v
uv run python scripts/static_boundary_check.py --root .
```

Expected: both commands exit `0`; the boundary checker still reports no broker or
real-execution surface.

- [ ] **Step 7: Commit the runbook**

```bash
git add docs/runbooks/rd-entry-v2-shadow-rollout.md \
  README.md \
  docs/development.md \
  apps/observation-edge/README.md \
  docs/architecture.md \
  docs/threat-model.md \
  tests/static/test_boundaries.py
git commit -m "docs: add RD entry shadow rollout runbook"
```

---

### Task 4: Prove the release locally before any external change

**Files:**

- Verify only; no file changes expected.

- [ ] **Step 1: Confirm the branch is clean and based on the intended release**

Run:

```bash
git status --short
git log -1 --oneline
```

Expected: `git status --short` prints nothing. Record the full commit with:

```bash
git rev-parse HEAD
```

- [ ] **Step 2: Run the complete repository proof**

Run:

```bash
make verify-observation
```

Expected final line:

```text
OBSERVATION VERIFICATION PASSED — ingress records metadata and no execution surface exists
```

- [ ] **Step 3: Rehearse the D1 migrations locally**

Run:

```bash
cd apps/observation-edge
npx wrangler d1 migrations list DB --local
npm run db:migrate:local
npx wrangler d1 migrations list DB --local
```

Expected: the first list includes migrations `0022` and `0023`; the apply command
succeeds; the second list reports no pending migrations.

- [ ] **Step 4: Run the Worker build and local integration tests after migration**

Run:

```bash
npm test
npm run build
```

Expected: Vitest passes and Wrangler dry-run emits a Worker bundle without a
configuration error.

- [ ] **Step 5: Verify the shadow flag in the exact deploy artifact**

Run from `apps/observation-edge`:

```bash
rg -n '"RD_ENTRY_CANONICAL_PAPER_ENABLED": "false"' wrangler.jsonc
rg -n 'RD_ENTRY_PROMOTION_(REPORT_SHA256|SOURCE_COMMIT|PINE_SHA256)' \
  wrangler.jsonc
rg -n 'strategy\\.entry|strategy\\.exit' \
  ../../scripts/pinescript/SND_RD_5M_V3_MULTI_ENTRY_LAB.pine
npm test
```

Expected: the first command finds exactly one false flag. The next two commands
exit `1` with no matches: shadow configuration has no promotion bindings and
Pine has no strategy execution calls. The Worker tests pass and explicitly
prove schema 2.0 rejects `paper_commands`; the compatibility tests separately
cover legacy schema 1.1.

---

### Task 5: Apply D1 migrations and deploy the dual-version edge in shadow

**Files:**

- External Cloudflare state changes only after operator approval.

- [ ] **Step 1: Record the current Worker deployment**

From `apps/observation-edge`, run:

```bash
npx wrangler deployments list
```

Expected: Wrangler lists the recent deployments. Copy the current version ID and
release commit into the private operator record; do not put credentials in that
record.

- [ ] **Step 2: Confirm only the intended migrations are pending remotely**

Run:

```bash
npx wrangler d1 migrations list DB --remote
```

Expected: only `0022_observation_receipts_entry_v2.sql` and
`0023_observation_entries.sql` are pending. Stop if any unreviewed migration is
listed.

- [ ] **Step 3: Apply the remote migrations**

Run:

```bash
npm run db:migrate:remote
```

Expected: both migrations apply successfully and Wrangler records a D1 backup.
Do not attempt a destructive down migration.

- [ ] **Step 4: Deploy the Worker and static console**

From a clean tree, generate the deterministic shadow build metadata into a
temporary file, extract its digest, and use that digest as the Cloudflare
version tag:

```bash
SOURCE_COMMIT="$(git rev-parse HEAD)"
BUILD_METADATA_FILE="$(mktemp)"
uv run python ../../scripts/build_rd_entry_edge_metadata.py \
  --source-commit "$SOURCE_COMMIT" \
  --mode shadow \
  --output "$BUILD_METADATA_FILE"
BUILD_METADATA_DIGEST="$(
  uv run python ../../scripts/build_rd_entry_edge_metadata.py \
    --check "$BUILD_METADATA_FILE" \
    --print-digest
)"
npx wrangler deploy \
  --tag "$BUILD_METADATA_DIGEST" \
  --message "rd-entry shadow source=$SOURCE_COMMIT"
```

Expected: Wrangler reports a successful deployment for
`prop-trading-observation-edge` and prints the stable `workers.dev` hostname.
The tag is the canonical build-metadata digest; the message is descriptive only
and is never trusted as provenance.

- [ ] **Step 5: Verify health and read projections**

In a shell variable that contains only the public origin, set `EDGE_BASE_URL` to
the hostname printed by Wrangler. Then run:

```bash
curl -fsS "$EDGE_BASE_URL/health/live"
curl -fsS "$EDGE_BASE_URL/api/v1/observation-receipts?limit=5"
curl -fsS "$EDGE_BASE_URL/api/v1/observation-entry-evaluations?limit=5"
```

Expected:

- health returns HTTP `200`, `status: "LIVE"`, and `execution: "DISABLED"`;
- legacy receipts still deserialize;
- entry evaluations return a valid empty or populated schema-2 collection;
- the console loads from the same origin.

- [ ] **Step 6: Verify version-1 compatibility from a real existing alert**

Wait for the next V2 five-minute alert receipt, then query:

```bash
curl -fsS "$EDGE_BASE_URL/api/v1/observation-receipts?limit=20"
```

Expected: a recent schema-`1.2`, strategy-`1.2.0-contract1` receipt is present and
the V2 alert remains active.

- [ ] **Step 7: Record the new deployment ID**

Run the deployment recorder against Wrangler's JSON output and the public
health response:

```bash
WRANGLER_DEPLOYMENTS_JSON="$(mktemp)"
RD_ENTRY_PRIVATE_DEPLOYMENT_RECORD="$(mktemp)"
npx wrangler deployments list --json > "$WRANGLER_DEPLOYMENTS_JSON"
uv run python ../../scripts/record_rd_entry_edge_deployment.py \
  --build-metadata "$BUILD_METADATA_FILE" \
  --wrangler-deployments-json "$WRANGLER_DEPLOYMENTS_JSON" \
  --health-url "$EDGE_BASE_URL/health/live" \
  --output "$RD_ENTRY_PRIVATE_DEPLOYMENT_RECORD"
```

Expected: the new deployment appears first; its listed ID equals runtime
`CF_VERSION_METADATA.id`, and runtime `tag` equals `BUILD_METADATA_DIGEST`.
Record both the pre-deploy and post-deploy version IDs in the private operator
record. The temporary build metadata and private record are not committed and
contain no credentials.

---

### Task 6: Publish V3 and complete the forward shadow canary

**Files:**

- Create after the observation window:
  `reports/rd-entry-forward-capture-v2.json`
- Create after the observation window:
  `reports/rd-entry-forward-canary-v2.json`
- Create after the observation window:
  `reports/rd-entry-rollout-decision-v2.json`
- Create after the observation window:
  `reports/rd-entry-promotion-evidence-v2.json`

- [ ] **Step 1: Complete the manual TradingView compile gate**

On a 5-minute chart, paste
`scripts/pinescript/SND_RD_5M_V3_MULTI_ENTRY_LAB.pine` into a new TradingView
indicator and save it under a V3 name. Compilation must complete with zero errors
and zero warnings caused by tuple width, lower-timeframe history, or alert
payload size.

- [ ] **Step 2: Complete historical Bar Replay before creating the alert**

Run every manifest-bound `pine_supported=true` case. Export the diagnostic
captures using the Plan-3 runbook and rerun:

```bash
uv run python scripts/compare_rd_pine_parity.py \
  --manifest tests/fixtures/rd_pine_parity/manifest.json \
  --oracle contracts/vectors/rd-entry-arbitration-v2.json \
  --output reports/rd-entry-historical-parity-v2.json \
  --check
```

Expected: `RD ENTRY PINE PARITY CHECK PASSED`. Bar Replay proves calculations, not
webhook delivery.

- [ ] **Step 3: Create a separate V3 shadow alert**

Set only the private Pine input credential, create an `Any alert() function call`
alert, and point it to the Cloudflare observation endpoint. Apply every value
from `config/phase0/rd-entry-pine-v3-forward-settings.json`, including
`export_setup_events=true`; paste that file's exact detector/settings hashes
into their dedicated inputs. Keep the V2 alert enabled. Confirm the V3 alert
name includes `V3 SHADOW` but includes no credential. Do not paste the
historical-parity settings hash into this forward alert.

- [ ] **Step 4: Verify the first complete V3 batch**

After the first snapshot/incremental delivery, query:

```bash
curl -fsS "$EDGE_BASE_URL/api/v1/observation-receipts?limit=20"
curl -fsS "$EDGE_BASE_URL/api/v1/observation-entry-evaluations?limit=20"
```

Expected:

- schema `2.0` and strategy `2.0.0-contract2` are present;
- the batch is complete before a selection revision appears;
- candidate/evidence IDs are populated;
- producer selection is labelled diagnostic;
- authoritative selection is edge-computed;
- every selection action is `SHADOW_ONLY` or `NONE` while the flag is false.

- [ ] **Step 5: Inspect the operations console**

Confirm that one setup with multiple candidates renders both candidates, their
evidence planes, HTF contexts, ambiguity codes, canonical or `NONE`, reason,
policy version, and official RD citations. Confirm legacy receipts remain visible.

- [ ] **Step 6: Accumulate the frozen current-producer observation sample**

Leave V2 and V3 running until the delivery/observation sample is meaningful:

- at least 10 distinct UTC trading dates;
- at least 30 completed setup attempts;
- at least 5 observed candidates for each active model, regardless of effective
  common-setup fidelity;
- observed `15m`, `30m`, and `1h` HTF contexts;
- 100% batch completion and a nonempty independent heartbeat-reference
  schedule covering the active V3 interval through the exclusive window end;
- zero parity mismatches, conflicting duplicates, sequence gaps/conflicts,
  heartbeat-schedule mismatches, unknown claims, and non-exact paper-eligible
  selections.

Do not wait indefinitely for the policy's exact-candidate/context promotion
minima: current V3 intentionally exports common setup fidelity as
`UNRESOLVED`, so those minima cannot be met in this increment. This first
forward window is expected to finish as a valid observation report with
`COLLECTING` (or `FAIL` if a hard invariant breaks). After a separate reviewed
exact-provenance contract is implemented, repeat a completely fresh forward
window and then require the unchanged exact minima before promotion.

If any hard-failure metric becomes non-zero, pause V3, keep V2 active, and remain
in `EDGE_SHADOW`.

- [ ] **Step 7: Capture a sanitized forward snapshot**

Freeze `CANARY_SINCE` and exclusive `CANARY_UNTIL` before querying. Do not move
either boundary after inspecting results. Wait until at least 900 seconds after
`CANARY_UNTIL`, then query the exact half-open interval. The report must include
every batch first received in that interval; no in-flight batch is implicitly
excluded.

Require a clean source tree, record the exact shadow source commit and the
currently deployed edge application version, and run the credential-free,
cursor-following capture client:

```bash
git status --short
SOURCE_COMMIT="$(git rev-parse HEAD)"
uv run python scripts/capture_rd_entry_canary.py \
  --edge-base-url "$EDGE_BASE_URL" \
  --since "$CANARY_SINCE" \
  --until "$CANARY_UNTIL" \
  --output reports/rd-entry-forward-capture-v2.json
```

Expected: `git status --short` is empty before capture. The client follows every
opaque cursor until the unique final page, uses no auth/cookie/custom header,
stores neither the edge origin nor request headers, and exits nonzero without a
partial output on any page or invariant failure.

Set `EDGE_SHADOW_VERSION_ID` to the post-deploy application version recorded in
Task 5 (it is an opaque deployment identifier, not a credential). Then run the
Plan-4 Python-oracle normalizer for the current fail-closed producer:

```bash
uv run python scripts/build_rd_entry_rollout_report.py \
  --policy config/phase0/rd-entry-rollout-policy-v2.json \
  --historical reports/rd-entry-historical-parity-v2.json \
  --historical-manifest tests/fixtures/rd_pine_parity/manifest.json \
  --oracle contracts/vectors/rd-entry-arbitration-v2.json \
  --forward-capture reports/rd-entry-forward-capture-v2.json \
  --pine-source scripts/pinescript/SND_RD_5M_V3_MULTI_ENTRY_LAB.pine \
  --historical-pine-settings config/phase0/rd-entry-pine-v3-parity-settings.json \
  --forward-pine-settings config/phase0/rd-entry-pine-v3-forward-settings.json \
  --source-commit "$SOURCE_COMMIT" \
  --edge-shadow-version-id "$EDGE_SHADOW_VERSION_ID" \
  --forward-summary-output reports/rd-entry-forward-canary-v2.json \
  --output reports/rd-entry-rollout-decision-v2.json
```

The script validates that the capture contains no credential, authorization
header, token, secret, raw request body, or paper command; replays every full
proof-input stream through the Python oracle; validates exact candidate,
context, terminal, parity, and identity counts; and binds every evidence digest.
With the current V3-mapped `UNRESOLVED` common setup provenance, expected is a
valid `COLLECTING` or `FAIL` decision with
`paper_selection_may_be_enabled: false` and
`real_execution_allowed: false`; the exact-setup minima must not be bypassed.
`COLLECTING` writes the capture, summary, and decision and returns the documented
nonzero collecting exit code; `FAIL` also returns nonzero. Neither status writes
`rd-entry-promotion-evidence-v2.json`, and a stale promotion-evidence file from
an earlier run is an error rather than reusable output.
After a separate approved, version-bumped exact-provenance contract and matching
rollout policy are implemented and a fresh full canary meets every retained
quantitative/safety gate, expected becomes exit `0`,
`status: "PASS"`, `paper_selection_may_be_enabled: true`, and
`real_execution_allowed: false`. For that later fresh PASS only, rerun the same
command with
`--promotion-evidence-output reports/rd-entry-promotion-evidence-v2.json`.

Before evaluating either result, the builder validates the full historical
digest chain: the report's `manifest_sha256` equals the supplied manifest bytes;
the manifest's Pine source, historical settings, capture, and oracle hashes
match the supplied/current artifacts; and its `oracle_sha256` equals both the
historical report and supplied oracle. It separately requires every forward
receipt identity to match the supplied forward settings hash and current Pine
source hash. Bind all of those artifact hashes, the rule-contract version, and
the producer strategy version into the rollout decision and, for PASS,
promotion evidence.

- [ ] **Step 8: Commit the immutable canary evidence**

For the current `COLLECTING` observation cycle, commit only the non-promotion
evidence if it is useful to retain:

```bash
git add reports/rd-entry-historical-parity-v2.json \
  reports/rd-entry-forward-capture-v2.json \
  reports/rd-entry-forward-canary-v2.json \
  reports/rd-entry-rollout-decision-v2.json
git commit -m "test: record RD entry shadow observation canary"
```

Do not create or commit promotion evidence for a `FAIL` or `COLLECTING` report;
Task 7 remains dormant. For the later fresh `PASS`, commit exactly the five
bound report files (the four above plus
`reports/rd-entry-promotion-evidence-v2.json`) and record:

```bash
git add reports/rd-entry-historical-parity-v2.json \
  reports/rd-entry-forward-capture-v2.json \
  reports/rd-entry-forward-canary-v2.json \
  reports/rd-entry-rollout-decision-v2.json \
  reports/rd-entry-promotion-evidence-v2.json
git commit -m "test: record passing RD entry shadow canary"
EVIDENCE_COMMIT="$(git rev-parse HEAD)"
```

The manifest-bound `SOURCE_COMMIT` is the clean code/deployment state before
report generation. `EVIDENCE_COMMIT` is its report-only descendant and is the
required parent of the later promotion commit.

---

### Task 7: Dormant successor-contract promotion template

**Files:**

- Modify only after a passing report and explicit approval:
  `apps/observation-edge/wrangler.jsonc`
- Generate only after the same approval:
  `apps/observation-edge/src/generated/rd-entry-promotion-binding.ts`
- Modify:
  `docs/runbooks/rd-entry-v2-shadow-rollout.md`

Do not execute this task for rule contract `2.0.0` / producer
`2.0.0-contract2`. A successor implementation must first bump and review the
rule/producer/vector/settings/policy identities, regenerate both oracle views,
produce a new zero-mismatch historical manifest/report for that exact source,
and complete a fresh forward PASS. The steps below then apply to those successor
artifacts; no current `UNRESOLVED` evidence or report can be relabeled or
grandfathered.

- [ ] **Step 1: Present the promotion evidence for explicit approval**

Immediately before asking, verify the committed evidence against the current
clock and source tree:

```bash
git status --short
uv run python scripts/verify_rd_entry_promotion.py \
  --evidence reports/rd-entry-promotion-evidence-v2.json
cd apps/observation-edge
npx wrangler deployments list
cd ../..
```

Expected: the tree is clean; every bound file hash passes; the decision is a
fresh `PASS`; the bound source/Pine/settings identity is unchanged; and the
currently active shadow application version equals the manifest's
`edge_shadow_version_id`. If the evidence is past `fresh_until`, the active
version differs, or any source/Pine/config digest changed, stop and repeat the
shadow evidence cycle. Never refresh freshness by merely recapturing an old
window: `fresh_until` is derived from `window_ended_at`.

Report the release commit, historical case counts, forward window dates, completed
setup count, model/context coverage, batch completion rate, and every hard-failure
counter, plus the rollout-decision SHA-256, detector/settings hashes, and bound
edge version. Ask the operator to approve the transition from `CANARY_PASS` to
`PAPER_SELECTION_ELIGIBLE`.

Do not continue without an explicit approval response.

- [ ] **Step 2: Set the guarded flag and verified bindings atomically**

Read the exact values from the already verified promotion-evidence manifest.
`RD_ENTRY_PROMOTION_REPORT_SHA256` is always the SHA-256 of the committed
`reports/rd-entry-rollout-decision-v2.json` bytes—not the promotion-evidence
manifest hash. Change:

```json
{
  "RD_ENTRY_CANONICAL_PAPER_ENABLED": "false"
}
```

to these four environment values in the same `wrangler.jsonc` edit:

```json
{
  "RD_ENTRY_CANONICAL_PAPER_ENABLED": "true",
  "RD_ENTRY_PROMOTION_REPORT_SHA256": "<promotion-evidence.rollout_decision_sha256>",
  "RD_ENTRY_PROMOTION_SOURCE_COMMIT": "<promotion-evidence.source_commit>",
  "RD_ENTRY_PROMOTION_PINE_SHA256": "<promotion-evidence.pine_source_sha256>"
}
```

All three bindings must be exact lowercase values from the verified manifest;
do not type substitute hashes. Missing, malformed, or merely different valid
hex keeps runtime canonical paper classification disabled. Do not change
`PAPER_LEDGER_ENABLED`, ingress credentials, schema versions, Pine source, D1
schema, or any execution boundary in this commit.

Generate—not hand-edit—the compile-time binding against that exact intended
Wrangler mapping:

```bash
uv run python scripts/generate_rd_entry_promotion_binding.py \
  --evidence reports/rd-entry-promotion-evidence-v2.json \
  --wrangler apps/observation-edge/wrangler.jsonc \
  --output apps/observation-edge/src/generated/rd-entry-promotion-binding.ts
```

The generator verifies the evidence commit/tree and computes the normalized
promotion build-metadata digest described in Task 2. The emitted object binds
the report/source/Pine/detector/settings fields plus that digest. A manually
edited binding or a digest computed over a different intended Wrangler mapping
fails verification.

- [ ] **Step 3: Run the full proof again**

Run:

```bash
uv run python scripts/verify_rd_entry_promotion.py \
  --evidence reports/rd-entry-promotion-evidence-v2.json \
  --check-wrangler apps/observation-edge/wrangler.jsonc \
  --allow-intended-promotion-diff
make verify-observation
```

Expected final line:

```text
OBSERVATION VERIFICATION PASSED — ingress records metadata and no execution surface exists
```

Before running tests, the verifier recomputes the committed rollout-decision
hash and asserts all four Wrangler values exactly match the manifest. The
feature-flag tests must prove missing or changed bindings keep the feature
disabled and that only complete exact canonical selections can change from
`SHADOW_ONLY` to `PAPER_ELIGIBLE`; schema 2.0 still rejects `paper_commands`.

- [ ] **Step 4: Commit the promotion**

After the exact-binding verifier and repository proof pass, append the
credential-free approval timestamp, approver, decision SHA-256, source commit,
Pine SHA-256, and pre-promotion edge version to the runbook record. Then commit:

```bash
git add apps/observation-edge/wrangler.jsonc \
  apps/observation-edge/src/generated/rd-entry-promotion-binding.ts \
  docs/runbooks/rd-entry-v2-shadow-rollout.md
git commit -m "chore: enable RD canonical paper selection"
PROMOTION_COMMIT="$(git rev-parse HEAD)"
```

Record `PROMOTION_COMMIT` and the manifest-bound
`PRE_PROMOTION_VERSION_ID=EDGE_SHADOW_VERSION_ID` in the credential-free
operator record before deploying.

- [ ] **Step 5: Deploy the promotion**

Immediately before deployment, rerun the verifier against the committed
promotion and the still-active shadow version:

```bash
git status --short
uv run python scripts/verify_rd_entry_promotion.py \
  --evidence reports/rd-entry-promotion-evidence-v2.json \
  --check-wrangler apps/observation-edge/wrangler.jsonc \
  --allow-committed-promotion "$PROMOTION_COMMIT"
cd apps/observation-edge
npx wrangler deployments list
```

`--allow-committed-promotion` is fail-closed. It requires a clean tree and
requires the promotion commit's parent to equal the recorded
`EVIDENCE_COMMIT`. That parent must be a descendant of the manifest-bound
`source_commit`; the complete diff from `source_commit` to `EVIDENCE_COMMIT`
may touch only the five manifest-bound report files, and their bytes must match
all recorded hashes. The promotion commit itself may touch only
`apps/observation-edge/wrangler.jsonc`,
`apps/observation-edge/src/generated/rd-entry-promotion-binding.ts`, and
`docs/runbooks/rd-entry-v2-shadow-rollout.md`. The Wrangler diff must contain
exactly the four verified bindings, the generated TypeScript must exactly equal
fresh generator output, and the runbook diff must be credential-free and bind
the approval record. It rechecks current time against `fresh_until`,
the complete historical-manifest/oracle/Pine/settings/forward evidence chain,
and that the active deployment is still the bound shadow version. Any other
intermediate or promotion diff, stale clock, dirty file, or deployment change
stops the release and requires a new evidence cycle.

From `apps/observation-edge`, run:

```bash
BUILD_METADATA_DIGEST="$(
  uv run python ../../scripts/generate_rd_entry_promotion_binding.py \
    --evidence ../../reports/rd-entry-promotion-evidence-v2.json \
    --wrangler wrangler.jsonc \
    --check src/generated/rd-entry-promotion-binding.ts \
    --print-build-metadata-digest
)"
npx wrangler deploy \
  --tag "$BUILD_METADATA_DIGEST" \
  --message "rd-entry reviewed paper promotion"
```

Expected: Wrangler creates a new deployment tagged with the exact embedded
build digest; no D1 migration is pending. Record the new runtime version ID/tag
and require the tag to equal `BUILD_METADATA_DIGEST` before accepting any
effective paper classification.

- [ ] **Step 6: Verify classification without execution**

After the next exact eligible setup, query:

```bash
curl -fsS "$EDGE_BASE_URL/api/v1/observation-entry-evaluations?limit=20"
```

Expected: an exact canonical candidate may show `PAPER_ELIGIBLE`, but no paper
intent, paper command, external order, or broker action is created.

- [ ] **Step 7: Use the safe rollback sequence on any anomaly**

First pause the V3 TradingView alert while leaving V2 active. Create a traceable
reversal of the promotion commit so the deploy comes from a clean commit with the
flag back at `false`, all three environment evidence values absent, and the
generated promotion binding restored to exact `null`; then test and deploy that
exact commit:

```bash
git revert --no-edit "$PROMOTION_COMMIT"
git status --short
cd apps/observation-edge
npm test
npm run build
ROLLBACK_BUILD_METADATA_FILE="$(mktemp)"
uv run python ../../scripts/build_rd_entry_edge_metadata.py \
  --source-commit "$(git rev-parse HEAD)" \
  --mode shadow \
  --output "$ROLLBACK_BUILD_METADATA_FILE"
ROLLBACK_BUILD_METADATA_DIGEST="$(
  uv run python ../../scripts/build_rd_entry_edge_metadata.py \
    --check "$ROLLBACK_BUILD_METADATA_FILE" \
    --print-digest
)"
npx wrangler deploy --tag "$ROLLBACK_BUILD_METADATA_DIGEST" \
  --message "Restore RD entry shadow classification"
```

Expected: `git status --short` is empty before the deploy, and the new deployment
has the flag back at `false`, removes all three promotion environment values,
restores the generated binding to `null`, and reports
`canonical_paper: "DISABLED"` and `execution: "DISABLED"`.

If the current code cannot deploy, use the recorded pre-promotion application
version:

```bash
npx wrangler rollback "$PRE_PROMOTION_VERSION_ID" \
  --yes \
  --message "Restore RD entry shadow classification"
```

Expected: the Worker returns to the previous shadow deployment. Do not reverse
`0022` or `0023`; their schema is backward-compatible and their evidence remains
append-only.

- [ ] **Step 8: Record the final state**

Update the runbook with the deployment ID, release commit, decision-report SHA-256,
approval date, and either `PAPER_SELECTION_ELIGIBLE` or `EDGE_SHADOW`. Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors and only the intended runbook evidence change
before its final documentation commit. Commit it:

```bash
git add docs/runbooks/rd-entry-v2-shadow-rollout.md
git commit -m "docs: record final RD entry rollout state"
```
