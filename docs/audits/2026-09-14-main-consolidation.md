# Main consolidation handoff

Date: 2026-09-14

## Scope and recovery points

User authorized a squash merge to main preserving existing GitHub history. No force push,
branch deletion, deployment, alert activation or MT5 action is authorized by this integration.
The unrelated older developer checkout remains untouched.

Local source snapshots:

- Backend, MT5 and evidence: `84fe613` on `codex/mt5-stale-payload-recovery`.
- Dashboard and documentation: `af8df61` on `codex/tradeops-dashboard-migration`.
- Integration: `codex/consolidate-reviewed-project` in `/private/tmp/tradeops-integration-20260914`,
  based on GitHub main `528ad8f`; dashboard checkpoint `f14cf11`.

## Reconciliation review

Fourteen Git conflicts were resolved without choosing one branch wholesale. Main's readiness,
bulk database reads and polling recovery coexist with cohort metrics and new evidence modules.
Migration 0029 preserves the final schema and append-only constraints while rebuilding dependent
children safely. All thirty migrations and a populated upgrade were checked with foreign keys on.
The generated RELEASE retains main's prior source exactly after reversing only the new evidence
emitter additions. LAB is now its authoring source; historical schema-3.0 remains in Git history.
The evidence emitter defaults off. CI retains both main's paper-loop checks and the incoming
dashboard-integrity verification. Independent integration review's documentation findings were fixed.

## Verification

In the integration worktree, locked Python 3.12 and npm dependencies were installed. No caches,
dependency directories/links, runtime state or compiled MT5 binaries are included in the merge.

- Observation tests: 821 passed; typecheck passed.
- Execution tests: 690 passed; typecheck passed.
- Dashboard tests: 644 passed; lint, typecheck and production build passed.
- Python suite: 828 passed after adapting the evidence/legacy alert boundary assertion.
- Generated artifacts, evidence inventory, frozen specifications and static boundaries passed.
- Observation and execution Worker dry-run builds passed; neither command deployed.
- MT5 dry-run and demo-report source boundary verifiers passed.
- Native Pine compilation and native MQL runtime acceptance were not performed.
- Final repeat: all 828 Python tests, Ruff lint/format, mypy and diff whitespace checks passed.
- Frontend static-runtime and five-lockfile credential checks passed.
- Local `make container-check` failed while building the console during TypeScript checking.
  Docker inspection confirmed `OOMKilled=true`; the VM has approximately 2 GB RAM and two CPUs.
  The same console build passed natively. No VM settings were changed. The smoke-test cleanup
  left no running containers for its temporary Compose project. Container acceptance must be
  rerun in an adequately provisioned environment or GitHub CI before merging.

## Reviewed security baseline update

The initial integration retained GitHub main's baseline. A blanket baseline merge was rejected by
the safety reviewer; no equivalent inline suppressions or scanner exclusions were added.

A separate read-only reviewer inspected all 261 unexpected findings in 36 files:

- 254 hexadecimal findings: deterministic fixture digests, integrity/source pins, hash-validation
  test inputs and a derived synthetic native storage namespace key.
- Five keyword findings: synthetic authentication and credential-rejection test strings.
- One JWT: explicitly synthetic fixture with an invalid short signature.
- One private-key finding: header-only rejection-test input, containing no private-key material.

The reviewer recomputed 57 digest relationships; all matched. No live credential was identified.
Scan totals were 502 observed, 241 already baselined, 261 unexpected and zero stale entries.
Following the user's explicit approval, exactly these 261 reviewed false positives were added,
retaining all 241 existing entries. The update was guarded by the reviewed total and detector
category counts. Do not disable scanning, widen exclusions, or blanket-baseline future findings.
Publishing and the GitHub squash merge remain subject to a fresh scan and final CI.

## PR verification follow-up

PR 7's first CI run exposed a clean-environment dependency omission: Python's broker boundary
test invokes execution-edge Vitest, but the full bootstrap had not installed that package yet.
The bootstrap now installs its locked dependencies before backend checks. A regression test
running Make's dry-run output failed before the fix and passed after it.

GitGuardian separately flagged the already-reviewed synthetic JWT fixture. That test now
constructs its non-authenticating token at runtime from explicit fixture fields, rather than
storing a JWT literal. Its 32 tests passed unchanged. The one now-stale JWT baseline entry was
removed, reducing the approved baseline to 501 entries; a fresh scan reported zero new findings.
No scanner or CI check was disabled. GitHub checks must still pass before merging.
