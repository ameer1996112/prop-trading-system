# Three-model signal evidence — source audit

Date: 2026-09-14
Implementation baseline: `8a801423bc19b3bb27c8e24f45d2800a9deb6881`
Implementation branch/worktree: `codex/mt5-stale-payload-recovery`
Status: source-tested; external demo readiness is not established

## Delivered boundary

The milestone adds an immutable bytes-only validator for BOC, DIR_CLOSE and HTF_FLIP evidence, restart-stable formation/evidence identities, literal contract vectors, and a separately gated Pine evidence emitter. The public bridge accepts producer envelope bytes and separately supplied reviewed-binding bytes. It returns only rejected results or `EVIDENCE_ONLY` entries with execution disabled.

There is no route, worker entry point, store, database, execution adapter or EA integration. A TypeScript-AST capability guard recursively enumerates checked-in production TypeScript/JavaScript files and inspects static imports, re-exports, string-literal dynamic imports and string-literal CommonJS requires. It resolves relative specifiers against known source files, rejects any production consumer of the new modules, restricts both pure modules to exact closed local dependency allowlists, and rejects every builtin or external-package import. Controlled synthetic route, `node:fs/promises`, `node:cluster`, `node:readline` and `node:perf_hooks` cases prove those prohibited edges are detected. The static scanner does not claim to resolve computed/obfuscated runtime module loading or non-JavaScript language linkage; repository/source-preservation checks and later native acceptance remain separate controls.

Every successful result container and entry across all nine literal vectors, including co-trigger and `NO_CANDIDATE`, has `authority: "EVIDENCE_ONLY"`, `execution_allowed: false`, and no account, volume or command field at its authority-bearing level. A separate test requires all six model/direction IDs listed below to exist. Full validated source observations and edge evaluations remain attached for audit. Their nested paper plan is source evidence, not bridge-granted authority.

## Model/direction acceptance fixtures

| Model | Direction | Literal fixture | Outcome |
|---|---|---|---|
| BOC | LONG | `strict_long_boc_only` | selected exact evidence |
| BOC | SHORT | `strict_short_boc_only` | selected exact evidence |
| DIR_CLOSE | LONG | `close_fallback_after_blocked_aggressive_models` | selected fallback evidence |
| DIR_CLOSE | SHORT | `close_fallback_after_blocked_aggressive_models_short` | selected fallback evidence |
| HTF_FLIP | LONG | `flip_before_boc` | selected lifecycle evidence |
| HTF_FLIP | SHORT | `flip_before_boc_short` | selected lifecycle evidence |

Co-trigger/arbitration coverage also includes `boc_flip_same_event`, `boc_before_close`, and `same_event_price_conflict`. The conflicting-price fixture produces `NO_CANDIDATE`; no producer-selected or arbitrary winner is accepted. The vectors cover economic identity exclusions, formation diagnostic changes, canonical normalization, complete proof retention, duplicate economic evidence rejection, no-candidate semantics and isolated evidence sequencing.

## Canonical literal goldens

The checked-in `contracts/vectors/signal-evidence-v1.json` stores literal canonical preimages and independently fixed SHA-256 outputs. Tests hash those literal strings and compare bridge output; they do not derive expected values with bridge serialization.

| Fixture | Attempt | Formation body | Evidence ID | Evidence body |
|---|---|---|---|---|
| `strict_long_boc_only` | `cc02ed5d…4df33` | `f9ff60bb…c56c1` | `af0e91d3…63844` | `e654fc12…fe0cc` |
| `strict_short_boc_only` | `e908a5ca…4e87b` | `bc76bbb8…aa5ad` | `3299efa4…b5c2` | `467e1b38…23828` |
| `close_fallback_after_blocked_aggressive_models` | `cc02ed5d…4df33` | `f9ff60bb…c56c1` | `39fb55f9…0f971` | `ae037469…2a6d7` |
| `close_fallback_after_blocked_aggressive_models_short` | `e908a5ca…4e87b` | `bc23fe88…bf1f` | `5d143d83…37526` | `739b4917…17358` |
| `flip_before_boc` | `cc02ed5d…4df33` | `f9ff60bb…c56c1` | `7de8c909…613ef` | `175b19b6…1719` |
| `flip_before_boc_short` | `e908a5ca…4e87b` | `bc23fe88…bf1f` | `f80fded2…2fd` | `957e7240…a9a9` |
| `boc_flip_same_event` | `cc02ed5d…4df33` | `f9ff60bb…c56c1` | `5541cae4…d8fe0` | `940e04e0…ac433` |
| `same_event_price_conflict` | `cc02ed5d…4df33` | `f9ff60bb…c56c1` | `54e2b43d…6bba9` | `97e5432c…f30b1e` |
| `boc_before_close` | `cc02ed5d…4df33` | `f9ff60bb…c56c1` | `e674ff34…3719b` | `2a7fa47f…76b7` |

## Files in this milestone

- `apps/observation-edge/src/signal-evidence-identity-v1.ts`
- `apps/observation-edge/src/signal-evidence-v1.ts`
- `apps/observation-edge/test/signal-evidence-identity-v1.test.ts`
- `apps/observation-edge/test/signal-evidence-v1.test.ts`
- `apps/observation-edge/test/signal-evidence-pine-parity.test.ts`
- `apps/observation-edge/test/signal-evidence-capability-v1.test.ts`
- `contracts/vectors/signal-evidence-identity-v1.json`
- `contracts/vectors/signal-evidence-v1.json`
- `scripts/pinescript/SND_RD_5M_V3_THREE_ENTRY_LAB.pine`
- generated `scripts/pinescript/SND_RD_5M_V3_RELEASE.pine`
- `tests/unit/test_signal_evidence_pine.py`
- reviewed protected-region golden in `tests/unit/test_generate_rd_v3_release.py`

The implementation ledger records exact local dependency-symlink reuse and preservation of all uncommitted baseline artifacts. The 90-file protected manifest reports zero mismatches, including old execution-protocol contracts/fixtures and EA sources. Existing execution-edge tracked diffs match the captured pre-task baseline byte-for-byte. No credentials, alerts, remote state, MT5 state or orders were changed.

## Verification

Commands were run in `/Users/ameeramer/.config/superpowers/worktrees/prop-trading-system/mt5-stale-payload-recovery` unless a different working directory is stated.

- From `apps/observation-edge`, `npm test`: **787 passed / 24 files**.
- From `apps/observation-edge`, `npm run typecheck`: PASS (`tsc --noEmit`).
- `python3 -m pytest -q -p no:cacheprovider tests/unit/test_generate_rd_v3_release.py tests/unit/test_signal_evidence_pine.py`: **45 passed, 1 warning** in 0.36s. The warning is the existing `PytestConfigWarning: Unknown config option: asyncio_mode`; cache-provider disabling avoids sandbox cache writes and does not alter test policy.
- `python3 scripts/generate_rd_v3_release.py --check`: PASS.
- `git diff --check`: PASS.
- A local Node SHA-256 verifier loaded `.superpowers/sdd/2026-09-14-three-model-signal-evidence/protected-manifest.json`, required every named file to exist, hashed its current bytes, and compared all 90 entries: **90 present, 0 mismatches**. This one-time audit evidence is not a dependency of the shipped capability test.
- `git diff -- apps/execution-edge/package-lock.json apps/execution-edge/package.json apps/execution-edge/src/account-coordinator-v1.ts apps/execution-edge/src/index.ts | cmp -s - .superpowers/sdd/2026-09-14-three-model-signal-evidence/baseline-tracked.diff`: PASS, establishing the pre-existing tracked execution-edge diff is byte-identical to the captured baseline. Comparing `baseline-status.txt` with current `git status --short` confirmed every pre-task dirty entry remains present; only declared milestone files were added beyond it.

Tests against generated Pine text are not native Pine compilation. Native TradingView compilation and runtime acceptance remain pending for both LAB and RELEASE, including default-off legacy behavior, each realtime model/direction, repeated intrabar sequencing, error non-consumption, exact epoch/tick conversion and identifier/string boundaries.

## Final review and handoff record

On 2026-09-14, independent whole-change review approved the source-tested milestone with no critical, important or actionable minor findings. Parent verification after the final test fix passed: 787 tests across 24 files (run started 12:45:57), TypeScript typecheck, and 45 Python tests with the single pre-existing `asyncio_mode` warning (0.52s). Generator consistency and whitespace checks passed. All 90 protected files matched, baseline dirty entries remained present, and HEAD stayed at `8a801423bc19b3bb27c8e24f45d2800a9deb6881`.

Recorded implementation rulings, in order:

1. Keep work uncommitted and retain review records under the project constraints; extra local audit artifacts remain.
2. Reuse matching installed execution-edge development dependencies through an observation-edge local symlink; the removable symlink remains instead of installing dependencies.
3. Treat source/capability guards as supplemental, not native Pine proof; external compiler/runtime acceptance remains required.
4. Reject duplicate derived evidence IDs within one envelope as `INVALID_FORMATION`; redundant same-formation bundles are refused, while cross-message uniqueness remains a later durable-admission responsibility.

No deployment, alert activation, MT5 operation, credential change, commit, merge or cleanup was performed.

## Disabled capabilities and mandatory later gates

This milestone does not authenticate producers, reserve attempts, prove persistent continuity, enforce freshness, establish cross-restart uniqueness, reconstruct broker geometry, select account/volume, apply account/broker/risk policy, create commands, route to an EA, acknowledge delivery, enable alerts or claim profitability.

Before any demo execution or dashboard end-to-end activation, a separate reviewed admission design must implement generation and sequence pins, receipt/body conflict handling, one INITIAL attempt reservation, freshness, account/broker/risk checks and a transactional outbox. Native Pine acceptance is also mandatory. Until those gates pass, the evidence emitter remains default off and evidence remains non-authoritative.
