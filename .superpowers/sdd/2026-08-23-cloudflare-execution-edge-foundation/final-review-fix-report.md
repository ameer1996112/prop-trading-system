# Cloudflare Execution Edge Foundation — final review fix report

Date: 2026-08-24

Branch: `codex/cloudflare-execution-edge-plan`

Implementation commit: `dec073b fix: harden execution edge safety contracts`
Status: implementation and complete local verification GREEN

This report is committed after the implementation commit so it can name that immutable commit. Its
own documentation commit is intentionally reported in the final handoff and `git log`; a Git commit
cannot truthfully contain its own hash.

## Scope and safety result

The final whole-branch fix wave addresses all six review findings without changing either approved
plan, the SDD progress ledger, `apps/observation-edge`, Pine, Wrangler versions/configuration, or the
observation-edge toolchain. No deploy, remote D1 operation, broker/MT5 connection, authority
activation, or external state change occurred.

The foundation remains structurally inert:

- `CANDIDATE_INBOX_ENABLED="false"`
- `AGENT_SYNC_ENABLED="false"`
- `EXECUTION_AUTHORITY_ENABLED="false"`
- `EXECUTION_MODE_CEILING="DRY_RUN"`
- `ROUTING_MANIFEST_SHA256="INERT_NOT_CONFIGURED"`
- Reconstruction results remain `authority="PAPER_ONLY"`,
  `real_execution_allowed=false`, and `command=null` for every outcome.
- `TradeCommandV1.execution_mode` remains `DRY_RUN` and
  `TradeCommandV1.real_execution_allowed` remains `false`.

## TDD evidence

All commands below ran from `apps/execution-edge` unless a repository-root path is shown.

### 1. First qualifying directional-close reconstruction

RED command:

```text
npm test -- broker-geometry-reconstruction-v1.test.ts
```

RED result:

```text
Test Files  1 failed (1)
Tests       2 failed | 31 passed (33)
```

The two expected failures proved the defect directly:

- an earlier qualifying directional close was returned as `MATCH` instead of `BLOCKED`;
- a later directional close after an intervening close inside the zone was returned as `MATCH`
  instead of `BLOCKED`.

GREEN command:

```text
npm test -- broker-geometry-reconstruction-v1.test.ts broker-reconstruction-contracts.test.ts
```

GREEN result:

```text
Test Files  2 passed (2)
Tests       39 passed (39)
```

Coverage now proves same-engagement-candle qualification, a valid later close after a respecting
candle, an earlier qualifying close/candidate mismatch, and intervening invalidation. The scan starts
at the first engagement, accepts the first qualifying close, stops on a pre-entry close inside or
through the zone, and requires the derived close epoch to equal `candidate.source_bar.close_epoch`.
Stable `GEOMETRY_MISMATCH`, null non-match geometry, and inert authority are preserved.

The previous long/short fixtures masked the bug because their engagement candles already qualified
while the nominated source bars were one candle later. The fixture source now uses a non-qualifying
respecting engagement followed by the first qualifying source bar. The checked-in vector was
regenerated from `generate-broker-reconstruction-vector.ts`; candidate bodies, evidence OHLC,
expected bodies, and digests changed together. No digest-only edit was made.

Successful vector generation commands:

```text
./node_modules/.bin/esbuild test/support/generate-broker-reconstruction-vector.ts --bundle --platform=node --format=esm --outfile=test/support/.vector-generator-runner.mjs
node test/support/.vector-generator-runner.mjs
```

### 2. Command pins, response freeze exclusion, and decision branches

RED command:

```text
npm test -- contract-schema-v1.test.ts
```

RED result:

```text
Test Files  1 failed (1)
Tests       3 failed | 40 passed (43)
```

The expected failures showed that the eight required command pins were unknown, a command-bearing
response could not validate against the upgraded fixture, and `BLOCKED/DECISION_EXPIRED` remained
accepted.

GREEN command:

```text
npm test -- contract-schema-v1.test.ts config-and-schema-boundaries.test.ts
```

GREEN result:

```text
Test Files  2 passed (2)
Tests       64 passed (64)
```

Contract choices:

- Standalone and embedded `TradeCommandV1` now require
  `candidate_body_sha256`, `reconstruction_sha256`, `prop_rule_pack_sha256`,
  `news_calendar_pack_sha256`, `execution_policy_sha256`, `reservation_id`,
  `account_fingerprint_sha256`, and `command_body_sha256`.
- Tests compare the complete command object shape and every referenced definition between the
  standalone and embedded schemas, then reject each absent or malformed pin in both locations.
- A response conditional requires `command=null` whenever `freeze_reasons` has at least one item.
  Empty reasons permit either null or one inert command. The schema description records that the
  future runtime validator must enforce the same rule before serialization.
- `ExecutionDecisionV1` uses three disjoint `oneOf` branches:
  `DRY_RUN_AUTHORIZED/AUTHORIZED/non-null reservation`,
  `EXPIRED/DECISION_EXPIRED/null reservation`, and
  `BLOCKED/blocked-reason/null reservation`. Tests cover every allowed blocked reason, the two other
  allowed mappings, all cross-outcome reason combinations, and reservation nullability.
- JSON Schema freezes presence and shape. The future command runtime validator must compare every
  valid-shaped pin to trusted coordinator state, verify the canonical command body digest, and
  retain the existing trusted-time/lease arithmetic checks.

### 3. Append-only agent facts and complete pre-command snapshot

RED command:

```text
npm test -- agent-fold-contracts-v1.test.ts
```

RED result:

```text
Test Files  1 failed (1)
Tests       1 failed | 37 passed (38)
```

The expected acceptance failure showed that the prior heartbeat fact could not carry tri-state
permissions or broker/Windows clocks; the existing schemas also lacked the richer facts and
snapshot used by the test.

GREEN commands and results:

```text
npm test -- agent-fold-contracts-v1.test.ts
Test Files  1 passed (1)
Tests       38 passed (38)

npm test -- agent-fold-contracts-v1.test.ts contract-schema-v1.test.ts config-and-schema-boundaries.test.ts
Test Files  3 passed (3)
Tests       102 passed (102)
```

Contract choices:

- `AgentEventV1` now has bounded, kind-selected strict facts for heartbeat, terminal state, submit
  state, order state, deal state, position state, protection state, close-attempt state,
  unattributed exposure state, and reconciliation state.
- Submit facts preserve `JOURNALED`, `SENT`, `ACK_REJECTED`, `ACK_ACCEPTED`, and `ACK_UNKNOWN`, plus
  command/lease/reservation/request attribution and requested/filled/residual volume.
- Order/deal/position/protection/close facts preserve attributed, unattributed, or unknown request
  identity without turning unknown into false certainty. Multiple immutable deal facts coexist.
- Position facts represent `ABSENT`, `OPEN`, `PARTIAL`, and `CLOSED` with explicit volume and
  weighted fill. Protection represents `REQUIRED`, `VERIFIED`, `MISSING_DEFINITE`, `UNKNOWN`, and
  `BREACHED`. Close attempts represent `JOURNALED`, `SENT`, `ACK_UNKNOWN`, and `RECONCILED`.
- Unattributed exposure distinguishes priced/unpriced risk and retains exposure/protection state.
  Reconciliation retains watermarks, overlapping history bounds, sweep stability, and the exact
  orders, deals, positions, and unattributed exposure identities seen.
- `AgentSyncRequestV1.account_snapshot` requires terminal build, EA and manifest digests, account
  fingerprint, broker and Windows clocks, tri-state connection/trading permissions, balance,
  equity, margin/free-margin/margin-level, 1..5 detailed symbol synchronization/capability states,
  bounded open orders, bounded positions with protection/deal identity, and a reconciliation
  watermark with stable-sweep count.
- Required fields that may genuinely be unknown use explicit `UNKNOWN` or null values where
  appropriate; omission is rejected, and the schema description requires future runtime
  authorization to block unknown/stale/changed/unstable/non-permitted inputs.
- Tests validate a full append-only fold containing a journaled submit, unknown acknowledgement,
  residual order, two deals, partial position/weighted fill, verified protection, ambiguous close,
  unpriced unattributed exposure, and unknown reconciliation. Separate tests reject every missing
  top-level snapshot input, representative nested inputs, missing fact inputs, oversize arrays,
  unknown fields, and credential-shaped payload additions.
- `scripts/generate-execution-edge-agent-contracts.mjs` is the shared source for the standalone
  event and embedded sync event definitions, preventing silent drift.

### 4. Environment-specific `.dev.vars` ignore boundary

RED command:

```text
npm test -- gitignore-boundaries.test.ts
```

RED result:

```text
Test Files  1 failed (1)
Tests       3 failed | 2 passed (5)
```

The exact `.dev.vars` path was ignored, but `.dev.vars.local`, `.dev.vars.preview`, and
`.dev.vars.production` were not.

GREEN command/result:

```text
npm test -- gitignore-boundaries.test.ts
Test Files  1 passed (1)
Tests       5 passed (5)
```

`.gitignore` now ignores `apps/execution-edge/.dev.vars*` and explicitly unignores
`apps/execution-edge/.dev.vars.example`. The test uses `git check-ignore --no-index` for variants
and `git ls-files --error-unmatch` to prove the names-only example remains tracked.

## Complete verification

The first complete verifier attempt is recorded because evidence must include failures, not hide
them:

```text
./scripts/verify-execution-edge-foundation.sh
Test Files  11 passed (11)
Tests       222 passed (222)
lint        FAILED on test-only TypeScript inference errors
build       not reached
```

The test-only fixtures were given explicit event/fold/candle types. Focused typecheck then passed:

```text
npm run lint
tsc --noEmit --pretty false
exit 0
```

Corrected complete verifier command:

```text
./scripts/verify-execution-edge-foundation.sh
```

Corrected complete verifier output:

```text
Test Files  11 passed (11)
Tests       222 passed (222)
lint        tsc --noEmit --pretty false — exit 0
typecheck   tsc --noEmit — exit 0
build       wrangler deploy --dry-run --outdir dist — exit 0
Total Upload: 2.27 KiB / gzip: 0.90 KiB
--dry-run: exiting now.
Execution edge foundation verification passed.
```

The build reported only the inert `CandidateInbox`, `AccountCoordinator`, inert D1 binding, and the
five exact inert environment values. It did not deploy or contact remote D1.

The first report-only cached diff check found three Markdown hard-break trailing spaces on this
report's metadata lines. They were removed. The corrected final commands were:

```text
git diff --cached --check
git status --short --branch
git diff --name-only HEAD -- apps/observation-edge scripts/pinescript docs/superpowers/plans .superpowers/sdd/2026-08-23-cloudflare-execution-edge-foundation/progress.md
```

The corrected diff check and protected-path query printed no findings; status showed only this
requested report staged on `codex/cloudflare-execution-edge-plan`.

## Changed files

Domain logic and generated broker vector:

- `apps/execution-edge/src/broker-geometry-reconstruction-v1.ts`
- `apps/execution-edge/test/broker-geometry-reconstruction-v1.test.ts`
- `apps/execution-edge/test/support/broker-reconstruction-fixture.ts`
- `apps/execution-edge/test/support/generate-broker-reconstruction-vector.ts`
- `contracts/vectors/broker-geometry-reconstruction-v1.json`

Contracts and contract tests:

- `contracts/schema/trade-command-v1.schema.json`
- `contracts/schema/agent-sync-response-v1.schema.json`
- `contracts/schema/execution-decision-v1.schema.json`
- `contracts/schema/agent-event-v1.schema.json`
- `contracts/schema/agent-sync-request-v1.schema.json`
- `apps/execution-edge/test/contract-schema-v1.test.ts`
- `apps/execution-edge/test/agent-fold-contracts-v1.test.ts`
- `scripts/generate-execution-edge-agent-contracts.mjs`

Local-secret boundary:

- `.gitignore`
- `apps/execution-edge/test/gitignore-boundaries.test.ts`

## Self-review

- Parsed every changed JSON artifact and verified every local `#/$defs/*` reference resolves.
- Compared standalone/embedded TradeCommand shapes and referenced primitive definitions exactly.
- Confirmed every MATCH broker vector has no qualifying engagement before a later nominated source
  bar.
- Confirmed no changed path is under `apps/observation-edge` or `scripts/pinescript`.
- Confirmed the plan and `.superpowers/.../progress.md` ledger are unchanged.
- Confirmed `.dev.vars` suffixes are ignored and `.dev.vars.example` is tracked.
- Confirmed `git diff --cached --check` was clean before implementation commit `dec073b`.
- Confirmed no credential field, generic order payload, `LIVE`, `EVALUATION`, deployment, remote D1,
  MT5, broker, or authority activation was added.

## Concerns and deferred work

1. Per the binding review ruling, the four high-severity transitive development-tool audit findings
   under the pinned Wrangler/Miniflare/Sharp/Undici toolchain are deliberately not changed here.
   Wrangler and the observation-edge toolchain are pinned across the deployed observation system;
   they require a separate coordinated dependency/security review. The advisories remain present in
   local/CI development dependencies until that review, but are not bundled into this inert Worker
   runtime.
2. These are frozen structural contracts, not active protocol authorization. A future runtime
   validator must verify canonical body digests, compare every immutable command pin to trusted
   coordinator state, enforce the freeze-reason/command exclusion again, enforce safe lease duration
   arithmetic using trusted server-adjusted time, and block every unknown/stale/changed/unstable
   snapshot input before persistence, authorization, or execution.
3. No Cloudflare or MT5 runtime integration exists in this wave. The next separately reviewed phase
   remains signed `/api/v1/agent/sync` plus an MQL5 `DRY_RUN` receiver only; no demo/live promotion is
   authorized.
