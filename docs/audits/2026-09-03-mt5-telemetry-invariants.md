# MT5 telemetry invariants — Stage 1 verification

Date: 2026-09-03

Status: Stage 1 implementation, regression, and independent reviews complete locally. All changes remain uncommitted; no runtime functionality has been activated.

## Scope

Implement the approved first-stage pure reporting helpers and tests. No endpoint, durable storage, EA collector, or dashboard integration is activated by this stage. The existing system remains on its unchanged runtime path.

Backend worktree: `/Users/ameeramer/.config/superpowers/worktrees/prop-trading-system/mt5-stale-payload-recovery`

Branch: `codex/mt5-stale-payload-recovery`

Starting HEAD: `8a801423bc19b3bb27c8e24f45d2800a9deb6881`

Documentation worktree: `/Users/ameeramer/.config/superpowers/worktrees/prop-trading-system/tradeops-dashboard-migration`

Execution plan: `docs/superpowers/plans/2026-09-03-mt5-telemetry-invariants.md`

## Baseline evidence

Commands ran in the backend worktree before implementation:

- `git status --short`: clean.
- `git rev-parse HEAD`: matched the planned revision above.
- Planned telemetry source/test path search: no existing matches.
- `npm --prefix apps/execution-edge test`: 308 tests across 16 files passed.
- `npm --prefix apps/execution-edge run typecheck`: passed.
- `node scripts/verify-mt5-dry-run-boundary.mjs`: passed.

The first test invocation could not write Vitest's temporary configuration due to sandbox permissions. Narrow permissions for its `.vite-temp` and `.vite` cache directories were granted, then the baseline succeeded. This was an environment startup failure, not a test failure.

Recorded SHA-256 fingerprints of 440 existing tracked backend files and 96 existing tracked/untracked frontend application files for final unchanged-content verification. No dependencies were installed or upgraded.

## Task evidence

### Exact values and identifiers

- Implementer observed the expected missing-module RED result before implementation.
- Corrected an initial test interpretation: abbreviated decimals and empty text are invalid; an empty *list* sums to zero.
- Focused suite: 4 tests passed; package typecheck passed. The controller independently reran both.
- Independent specification review: passed.
- Independent quality review: no blocking findings. Suggested regression assertions for scale 16, negative totals, and intermediate overflow followed by cancellation were added and re-reviewed; no remaining findings.
- Supplemental read-only checks: controller verified 75 decimal boundaries; quality reviewer reported 402 checks. These are additional ad-hoc checks, not extra Vitest test cases.

### Immutable start boundary

- Implementer observed the expected missing-module RED result before implementation.
- Focused suite: 5 tests passed; package typecheck passed. The controller independently reran both.
- Independent specification review: passed. The validated-boundary requirement on deal inclusion is a caller precondition, not a claim of broker-side capture or persistence.
- Added durable checks for exactly 1024 exclusions and for a previously excluded ticket becoming eligible after the first second.
- Supplemental controller check: 6,004 millisecond/capacity assertions passed. This is separate from the five Vitest cases.
- Independent quality review: passed with no findings; reviewer ran 11 additional focused read-only checks.

### Truthful coverage

- Implementer observed the expected missing-module RED result before implementation.
- Focused suite: 8 tests passed; package typecheck passed. The controller independently reran both.
- Contradictory input fixtures were corrected before completion: a finished scan needs its own timestamp even when acknowledgements remain pending; primitive counter errors retain their specific error code.
- Independent specification review: passed.
- Supplemental controller check: 1,152 combinations of start state, counters, scan state/timestamp, record gaps, and observation gaps passed. These are separate from the eight Vitest cases.
- Independent quality review: passed with no findings; reviewer ran 12 additional focused read-only checks.

### Request admission and exact replay

- Implementer observed the expected missing-module RED result before implementation.
- Controller identified receipt primitive-error normalization that differed from the specified validation order. Added a regression; controller observed RED (8 passing / 1 failing), then GREEN (9 passing) and typecheck after correction.
- Supplemental controller check: 792 assertions covered contiguous new batches of every supported size, unchanged caller state, exact stale/older retries, conflicting digests, and missing receipts. This simulates decisions only, not durable database commits.
- Independent specification review found that inherited array values could masquerade as present event elements. The implementer observed the new regression fail (9 passing / 1 failing), added own-element validation, and obtained GREEN. Controller independently reran the resulting 10-test suite and typecheck successfully. Specification re-review passed.
- Independent quality review: passed with no findings; reviewer ran 12 additional focused read-only checks.
- The response string-length guard is a domain bound, not the later wire layer's encoded-byte/schema/digest validation. Those caller responsibilities remain explicit.

## Final regression

Executed from the backend worktree after all per-task reviews passed:

| Check | Actual result |
| --- | --- |
| `npm --prefix apps/execution-edge test -- test/telemetry-values-v2.test.ts test/telemetry-cutover-v2.test.ts test/telemetry-coverage-v2.test.ts test/telemetry-admission-v2.test.ts` | 27 tests / 4 files passed |
| `npm --prefix apps/execution-edge test` | 335 tests / 20 files passed |
| `npm --prefix apps/execution-edge run typecheck` | Passed |
| `npm --prefix apps/execution-edge run lint` | Passed |
| `node scripts/verify-mt5-dry-run-boundary.mjs` | Passed without changing the checker or integrity manifest |
| `git diff --check` | Passed |
| Per-new-file `git diff --no-index --check /dev/null <file>` | All eight new files passed |
| Existing backend SHA-256 comparison | All 440 tracked files unchanged |
| Existing frontend SHA-256 comparison | All 96 application files unchanged; no additional frontend files |
| Backend status and HEAD | Exactly eight intended untracked TypeScript files; HEAD unchanged |

Final combined independent review: PASS, with no Critical, Important, or Minor findings. The final reviewer inspected all eight new files and the existing canonical helper, verified the lack of existing runtime imports, and passed 781 additional in-memory checks. No live-service, Windows compiler, or installed-EA verification is claimed by these local checks.

## Handoff

The test-first/subagent-review workflow produced the four planned pure modules and four test files. Per-task specification and quality reviews, the corrective regression loops, and a separate final combined review are complete. The finishing workflow keeps the existing branch/worktree in place under the approved local/uncommitted boundary.

Follow-on update: the detailed Stage 2 plan for strict wire validation and durable receiver/database transactions is now written and checked in a disposable planning copy. See `docs/superpowers/plans/2026-09-03-mt5-telemetry-receiver.md` and `docs/audits/2026-09-03-mt5-telemetry-receiver-plan.md`. The planning checkbox is complete; application implementation is still pending. Keep the current EA installed; there is no new EA or Pine artifact to upload from this work.

## Activation boundary

No commit, push, merge, deployment, D1 migration, Cloudflare configuration/secret change, TradingView change, EA installation, or broker action is included. This stage cannot populate real account finances or journal records; those depend on later receiver, collector, and private-display stages.
