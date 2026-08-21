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

Digests are SHA-256 of the exact candidate bytes in the original checkout. The Pine digest is the required binary git-diff digest (`git diff --binary ... | shasum -a 256`), not a digest of a copied file.

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
2. Recompute every listed SHA-256 digest directly from the unchanged original checkout; any mismatch requires review and stops adoption.
3. Keep Pine proposal authority independent from legacy V3 entry emission, closed-candle/realtime eligibility exact, direction/geometry frozen, and risk geometry exactly four-R.
4. Validate the proposal and execution-candidate schema/vector bytes, plus parser, ingestion, outbox, and migration behavior with focused tests, including account-free private transport boundaries.
5. Preserve migration ordering and prove the new migration follows 0028 without changing prior migrations.
6. Re-run `git diff --check` and the targeted static tests; failures outside the seven baseline failures block the migration.

The original checkout remains unchanged, and this report is the sole artifact created by this inventory task.
