# V3 migration source inventory

Date: 2026-08-21

This inventory freezes evidence for the approved V3.1 paper-only signal-authority migration. The source baseline is commit `483c044` in the original checkout at `/Users/ameeramer/dev/projects/galilsoftware/sources/prop-trading-system`. The implementation worktree is isolated at commit `607a7770110f98b488e5df9fd8b49d3e95a9e569` on `codex/v3-paper-signal-authority-design`; the original checkout is on `codex/fix-liquidity-display-arbitration` and remains dirty.

## Isolation and clean-baseline proof

The required status checks produced:

```text
implementation: ## codex/v3-paper-signal-authority-design
implementation HEAD: 607a7770110f98b488e5df9fd8b49d3e95a9e569
original: ## codex/fix-liquidity-display-arbitration
```

The immutable original-checkout status snapshot (captured with the exact command below, including its trailing newline) is:

```text
## codex/fix-liquidity-display-arbitration
 M PLAN-REVIEW-LOG.md
 M PLAN.md
 M apps/observation-edge/src/index.ts
 M apps/observation-edge/src/types.ts
 M apps/observation-edge/vitest.config.ts
 M apps/observation-edge/wrangler.jsonc
 M docs/runbooks/rd-three-entry-paper-rollout.md
 M scripts/pinescript/SND_RD_5M_V3_THREE_ENTRY_LAB.pine
 M tests/static/test_migration_foundation.py
 M tests/static/test_rd_three_entry_pine.py
?? LIQUIDITY-PLAN-REVIEW-LOG.md
?? LIQUIDITY-PLAN.md
?? TradeOps-Windows-Task7-20260811.zip
?? apps/execution-edge/migrations/
?? apps/execution-edge/node_modules
?? apps/execution-edge/package-lock.json
?? apps/execution-edge/package.json
?? apps/execution-edge/src/account-coordinator.ts
?? apps/execution-edge/src/agent-installation-v1.ts
?? apps/execution-edge/src/agent-sync-v1.ts
?? apps/execution-edge/src/candidate-delivery-v1.ts
?? apps/execution-edge/src/candidate-inbox.ts
?? apps/execution-edge/src/canonical.ts
?? apps/execution-edge/src/contracts-v1.ts
?? apps/execution-edge/src/execution-audit.ts
?? apps/execution-edge/src/index.ts
?? apps/execution-edge/src/types.ts
?? apps/execution-edge/test/account-coordinator.test.ts
?? apps/execution-edge/test/account-profile-contracts-v1.test.ts
?? apps/execution-edge/test/agent-sync-coordinator.test.ts
?? apps/execution-edge/test/agent-sync-http.test.ts
?? apps/execution-edge/test/audit-delivery.test.ts
?? apps/execution-edge/test/candidate-inbox.test.ts
?? apps/execution-edge/test/candidate-receiver.test.ts
?? apps/execution-edge/test/candidate-routing.test.ts
?? apps/execution-edge/test/execution-contracts-v1.test.ts
?? apps/execution-edge/test/support/agent-sync-fixture.ts
?? apps/execution-edge/test/support/candidate-fixture.ts
?? apps/execution-edge/test/support/cloudflare-workers.ts
?? apps/execution-edge/test/support/sqlite-d1.ts
?? apps/execution-edge/test/support/sqlite-durable-state.ts
?? apps/execution-edge/tsconfig.json
?? apps/execution-edge/vitest.config.ts
?? apps/execution-edge/wrangler.jsonc
?? apps/observation-edge/migrations/0029_observation_execution_proposal_v1.sql
?? apps/observation-edge/src/execution-proposal-ingestion.ts
?? apps/observation-edge/src/execution-proposal-v1.ts
?? apps/observation-edge/src/observation-outbox-dispatcher.ts
?? apps/observation-edge/test/execution-proposal-ingestion.test.ts
?? apps/observation-edge/test/execution-proposal-v1.test.ts
?? apps/observation-edge/test/observation-outbox-dispatcher.test.ts
?? apps/observation-edge/test/support/
?? config/phase_c/
?? contracts/schema/account-profile-v1.schema.json
?? contracts/schema/agent-event-v1.schema.json
?? contracts/schema/agent-sync-request-v1.schema.json
?? contracts/schema/agent-sync-response-v1.schema.json
?? contracts/schema/broker-bar-evidence-v1.schema.json
?? contracts/schema/execution-candidate-v1.schema.json
?? contracts/schema/execution-decision-v1.schema.json
?? contracts/schema/news-calendar-pack-v1.schema.json
?? contracts/schema/phase-c-shadow-observation-v1.schema.json
?? contracts/schema/prop-rule-pack-v1.schema.json
?? contracts/schema/rd-entry-execution-proposal-v1.schema.json
?? contracts/schema/routing-manifest-v1.schema.json
?? contracts/schema/signed-account-profile-v1.schema.json
?? contracts/schema/trade-command-v1.schema.json
?? contracts/vectors/execution-edge-v1.json
?? contracts/vectors/rd-entry-execution-proposal-v1.json
?? docs/rd-entry-execution-proposal-v1.md
?? docs/reports/
?? docs/runbooks/phase-c-shadow-observation.md
?? docs/runbooks/tradingview-paper-bridge.md
?? docs/superpowers/plans/01-source-reconciliation-and-durability.md
?? docs/superpowers/plans/2026-08-10-broker-geometry-reconstruction-v2.md
?? docs/superpowers/plans/2026-08-12-phase-c-shadow-observation.md
?? docs/superpowers/specs/2026-08-10-broker-geometry-reconstruction-v2-design.md
?? docs/superpowers/specs/2026-08-12-phase-c-shadow-observation-design.md
?? phase-c-shadow-windows.zip
?? scripts/build_phase_c_shadow_report.py
?? scripts/phase_c_shadow.py
?? src/prop_trading/domain/liquidity_display_oracle.py
?? tests/fixtures/liquidity_display_cases_v1.json
?? tests/fixtures/phase_c_shadow_news.json
?? tests/fixtures/phase_c_shadow_ten_session_synthetic.jsonl
?? tests/fixtures/phase_c_shadow_valid_records.jsonl
?? tests/static/test_phase_c_shadow_boundaries.py
?? tests/static/test_phase_c_shadow_safety.py
?? tests/unit/test_liquidity_display_oracle.py
?? tests/unit/test_phase_c_shadow_cli.py
?? tests/unit/test_phase_c_shadow_evaluator.py
?? tests/unit/test_phase_c_shadow_journal.py
?? tests/unit/test_phase_c_shadow_models.py
?? tests/unit/test_phase_c_shadow_report.py
?? tools/phase_c_shadow/
```

Snapshot digest (SHA-256 over the exact status bytes) is `3d81f2b6c9fbcc11658b50294e02b6b027e1396e6fcd348c112eff381ca54b76`. It is reproducible with:

```text
git -C /Users/ameeramer/dev/projects/galilsoftware/sources/prop-trading-system status --short --branch | shasum -a 256
```

The original checkout has user-owned modified and untracked paths. No source file was copied from it and no command in this inventory modified it.

The exact baseline command was:

```text
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 python3 -m pytest -q -p no:cacheprovider tests/static/test_rd_three_entry_pine.py tests/static/test_execution_proposal_v1_boundaries.py tests/static/test_migration_foundation.py
```

Result: `59 passed, 7 failed`.

The seven expected failures are limited to the approved migration gap:

| Category | Failures | Interpretation |
| --- | --- | --- |
| Independent proposal artifacts absent | `test_both_execution_authority_flags_are_independent_and_default_false`; `test_pine_proposal_is_closed_realtime_exact_dir_close_only`; `test_pine_proposal_serializes_frozen_geometry_and_exact_four_r`; `test_proposal_path_cannot_mutate_or_promote_legacy_v3`; `test_observation_edge_remains_account_free_and_private_transport_only`; `test_v1_contract_bytes_are_frozen_while_v2_reconstruction_is_paper_only` | The clean implementation worktree intentionally does not yet contain the independent V1 proposal Pine/functions, ingestion/outbox files, or proposal schema required by these boundary tests. |
| Migration count stops before 0029 | `test_rd_rollout_tracks_every_edge_migration_through_0027` | The clean worktree contains migrations through 0028; candidate 0029 is source evidence only and is not adopted by this task. |

No failure outside these two categories occurred. The warning about the unknown `asyncio_mode` pytest option is non-failing and does not alter the baseline classification.

## Candidate evidence and dispositions

Digests are SHA-256 of the exact candidate bytes in the original checkout. The Pine digest is the required binary git-diff digest, not a digest of a copied file. It is reproducible with:

```text
git -C /Users/ameeramer/dev/projects/galilsoftware/sources/prop-trading-system diff --binary -- scripts/pinescript/SND_RD_5M_V3_THREE_ENTRY_LAB.pine | shasum -a 256
```

| Evidence category | Candidate path or diff | SHA-256 | Disposition |
| --- | --- | --- | --- |
| V3 Pine dirty diff | `scripts/pinescript/SND_RD_5M_V3_THREE_ENTRY_LAB.pine` binary diff | `dd22474b0ae3e111a59156379b181d3e8e308e59e25d9d69a7161964d6d98845` | REVIEW_HUNKS_ONLY |
| Execution proposal schema | `contracts/schema/rd-entry-execution-proposal-v1.schema.json` | `fc4e48c143fbb798d76d24f600e3eb5fb8b6861224e8f33f5107a4b1ab8e7e8e` | RECREATE_AND_COMPARE |
| Execution candidate schema | `contracts/schema/execution-candidate-v1.schema.json` | `9b679687d0b2e56795d4e675160c29a6d7c2d6d744886ea4187fd8fe6c61ac85` | RECREATE_AND_COMPARE |
| Execution proposal vector | `contracts/vectors/rd-entry-execution-proposal-v1.json` | `befa7307332e6ed3604910e59a660529632298d10f783c314025c9d341773076` | RECREATE_AND_COMPARE |
| Proposal parser/domain | `apps/observation-edge/src/execution-proposal-v1.ts` | `43e309c18ffeb38808fe82b76e76301e290a4d7aacb9e6efdbd4e44fc49777ce` | RECREATE_AND_COMPARE |
| Proposal ingestion | `apps/observation-edge/src/execution-proposal-ingestion.ts` | `0caea012bf4872a26b135bda2bfee6a4823008156e68cc904d3c9ab844545523` | RECREATE_AND_COMPARE |
| Observation outbox | `apps/observation-edge/src/observation-outbox-dispatcher.ts` | `480b61c999bcecd23920e963aa26fa278121ca9c73883ded621a2c8db60dc3ce` | RECREATE_AND_COMPARE |
| Migration 0029 | `apps/observation-edge/migrations/0029_observation_execution_proposal_v1.sql` | `b5dd466f2186d5253e99e41cab641ed5c63930807289f3bb4d1f761e62b097ab` | RECREATE_AND_COMPARE |

`REVIEW_HUNKS_ONLY` means the dirty Pine diff may be consulted for narrowly identified behavior, with no wholesale adoption. `RECREATE_AND_COMPARE` means implementation work must be independently recreated and compared against this digest and the proof gates below; it is not source adoption.

## Other dirty and untracked paths

All other original-checkout changes are explicitly excluded and receive `LEAVE_UNTOUCHED`: `PLAN-REVIEW-LOG.md`, `PLAN.md`, modified observation-edge index/types/config files, `docs/runbooks/rd-three-entry-paper-rollout.md`, both static test modifications, `LIQUIDITY-PLAN-REVIEW-LOG.md`, `LIQUIDITY-PLAN.md`, `TradeOps-Windows-Task7-20260811.zip`, all `apps/execution-edge/**` (including `node_modules`), observation-edge proposal tests/support fixtures, all non-proposal contracts and vectors, `docs/rd-entry-execution-proposal-v1.md`, phase-C docs/plans/specs/configuration/scripts/fixtures/tests/tools, `phase-c-shadow-windows.zip`, and all remaining untracked paths shown by `git status --short`.

This exclusion includes account, broker, MT5, node_modules, ZIP, and Phase C scope. No unrelated dirty or untracked path is adopted.

## Proof gates

Before any candidate is recreated, the implementation must pass all of the following gates:

1. Re-run the exact baseline command and account only for the seven classified failures until the migration is implemented.
2. Preserve the frozen original-checkout status snapshot and digest; any status-byte mismatch requires review before adoption. Recompute every listed candidate SHA-256 digest directly from the unchanged original checkout; any mismatch stops adoption.
3. Keep Pine proposal authority independent from legacy V3 entry emission, closed-candle/realtime eligibility exact, direction/geometry frozen, and risk geometry exactly four-R.
4. Validate the proposal and execution-candidate schema/vector bytes, plus parser, ingestion, outbox, and migration behavior with focused tests, including account-free private transport boundaries.
5. Preserve migration ordering and prove the new migration follows 0028 without changing prior migrations.
6. Re-run `git diff --check` and the targeted static tests; failures outside the seven baseline failures block the migration.

The original checkout remains unchanged relative to the frozen status snapshot and digest, and this report is the sole artifact created by this inventory task.
