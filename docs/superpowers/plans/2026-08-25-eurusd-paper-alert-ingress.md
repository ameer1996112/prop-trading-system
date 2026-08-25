# EURUSD Paper-Alert Ingress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable and prove one authenticated EURUSD five-minute TradingView alert reaches the existing Cloudflare observation service as an immutable, non-executable receipt.

**Architecture:** This rollout reuses the existing `apps/observation-edge` ingress, D1 receipt store, and `/api/v1/observation-receipts` read surface. It adds an operator runbook and uses only existing paper-only configuration: ingress enabled, a hash-only TradingView credential secret, and candidate emission/dispatch disabled. Neither the execution-edge Worker nor the MT5 agent is a consumer of this path.

**Tech Stack:** TradingView Pine alert, Cloudflare Workers, Cloudflare D1, TypeScript/Vitest, Wrangler.

---

## File structure

- Create: `docs/runbooks/eurusd-paper-alert-rollout.md` — owner-facing, no-trade procedure for the single EURUSD alert.
- Create: `docs/superpowers/reports/2026-08-25-eurusd-paper-alert-ingress-verification.md` — redacted evidence report completed only after the acceptance gates pass.
- Verify only: `apps/observation-edge/wrangler.jsonc` — retain ingress enabled and all execution/candidate controls disabled.
- Verify only: `apps/observation-edge/src/index.ts` — retain the observation route and no broker/MT5 route.
- Verify only: `apps/observation-edge/test/worker.test.ts` and `apps/observation-edge/test/execution-proposal-ingestion.test.ts` — retain existing ingress, replay, and independently disabled candidate-control coverage.

No production TypeScript change is planned. The existing implementation already supplies the reviewed receipt-only behavior. This plan adds explicit operational evidence and must stop if source verification contradicts that premise.

### Task 1: Write the EURUSD operator runbook

**Files:**
- Create: `docs/runbooks/eurusd-paper-alert-rollout.md`
- Reference: `docs/superpowers/specs/2026-08-25-eurusd-paper-alert-ingress-design.md`
- Reference: `apps/observation-edge/README.md`

- [ ] **Step 1: Write the runbook’s fixed safety boundary**

Include this exact boundary at the start of the document:

```markdown
This rollout accepts one EURUSD five-minute TradingView observation only. It is
not a trade, an order, or a request to MT5. Do not change MT5, broker,
WebRequest, or Algo Trading settings. Keep
RD_EXECUTION_CANDIDATE_EMISSION_ENABLED=false,
RD_EXECUTION_CANDIDATE_DISPATCH_ENABLED=false, and
RD_EXECUTION_RECEIVER_MANIFEST_SHA256=INERT_NOT_CONFIGURED.
```

- [ ] **Step 2: Add the preflight commands and expected output**

```sh
cd apps/observation-edge
npm ci --ignore-scripts --no-audit --no-fund
npm test
npm run lint
npm run typecheck
npm run build
npx wrangler secret list
```

Expected: tests, lint, typecheck, and dry-run build pass; secret listing shows
these five names, and never their values:

```text
TRADINGVIEW_OBSERVATION_CREDENTIAL_SHA256
PAPER_LEDGER_ADMIN_CREDENTIAL_SHA256
RD_ENTRY_V3_DETECTOR_CODE_HASH
RD_ENTRY_V3_SETTINGS_HASH
RD_ENTRY_V3_SETTINGS_HASHES_JSON
```

The runbook must say to stop if any name is absent or if either candidate
control differs from `false` in `wrangler.jsonc`.

- [ ] **Step 3: Add the owner-only credential procedure**

Document that a new, dedicated credential is created and kept only in the
TradingView alert/script input. Store only its lower-case SHA-256 digest in the
remote secret using an interactive command, which prevents the raw value from
appearing in source or shell history:

```sh
cd apps/observation-edge
npx wrangler secret put TRADINGVIEW_OBSERVATION_CREDENTIAL_SHA256
```

Expected: Wrangler prompts for a value; paste the digest, not the raw
credential. The document must prohibit pasting either value into Git, D1,
screenshots, logs, config `vars`, or a command line.

- [ ] **Step 4: Add TradingView creation instructions**

Document the exact webhook destination format:

```text
https://prop-trading-observation-edge.ameer-1996112.workers.dev/api/v1/tradingview/observations
```

Require a five-minute EURUSD chart and the reviewed Pine `alert()` payload.
Require capturing the exact chart ticker ID, timeframe, broker/feed, timezone,
Pine source SHA-256, settings SHA-256, and a redacted screenshot of the alert.
Do not compose or paste an alternative manual JSON message; the reviewed Pine
`alert()` call provides the envelope.

- [ ] **Step 5: Add acceptance/failure criteria and validate the document**

The runbook must define these required outcomes: one `202/RECEIVED` receipt,
one exact replay returning `200/DUPLICATE`, a visible receipt in the operations
console/read API, and a current receipt heartbeat. It must define `401`, `409`,
or no current receipt as stop conditions and say they cannot trigger retries to
MT5, orders, or candidate dispatch.

Run:

```sh
git diff --check
rg -n -i '\b(TBD|TODO|FIXME|placeholder)\b' docs/runbooks/eurusd-paper-alert-rollout.md
```

Expected: `git diff --check` exits 0; the `rg` command produces no matches.

- [ ] **Step 6: Commit the documentation**

```sh
git add docs/runbooks/eurusd-paper-alert-rollout.md
git commit -m "docs: add EURUSD paper alert rollout runbook"
```

### Task 2: Verify the frozen paper-only ingress locally

**Files:**
- Verify: `apps/observation-edge/wrangler.jsonc`
- Verify: `apps/observation-edge/src/index.ts:3766-3785`
- Verify: `apps/observation-edge/test/worker.test.ts`
- Verify: `apps/observation-edge/test/execution-proposal-ingestion.test.ts`

- [ ] **Step 1: Verify the four remote safety values before deployment**

Run:

```sh
cd apps/observation-edge
node -e 'const fs=require("node:fs");const c=fs.readFileSync("wrangler.jsonc","utf8");for(const x of ["\"TRADINGVIEW_OBSERVATION_INGRESS_ENABLED\": \"true\"","\"RD_EXECUTION_CANDIDATE_EMISSION_ENABLED\": \"false\"","\"RD_EXECUTION_CANDIDATE_DISPATCH_ENABLED\": \"false\"","\"RD_EXECUTION_RECEIVER_MANIFEST_SHA256\": \"INERT_NOT_CONFIGURED\""])if(!c.includes(x))throw new Error(`missing ${x}`);console.log("paper-only configuration verified")'
```

Expected: `paper-only configuration verified`. Any failure stops the rollout.

- [ ] **Step 2: Run receipt, replay, and candidate-disable coverage**

Run:

```sh
cd apps/observation-edge
npx vitest run test/worker.test.ts test/execution-proposal-ingestion.test.ts
```

Expected: all selected tests pass, including valid receipt/replay handling and
independently disabled candidate emission/dispatch behavior.

- [ ] **Step 3: Run the full local verification suite**

Run:

```sh
make verify-observation
git status --short
```

Expected: the verification ends with `OBSERVATION VERIFICATION PASSED — ingress
records metadata and no execution surface exists`; the only permitted working
tree changes are the new runbook and later redacted report.

- [ ] **Step 4: Commit verification-only changes if any**

If Task 2 required no source change, make no commit. If a documentation-only
correction is necessary, commit only that file with:

```sh
git add docs/runbooks/eurusd-paper-alert-rollout.md
git commit -m "docs: clarify EURUSD paper alert checks"
```

### Task 3: Provision and deploy the existing observation Worker

**Files:**
- Verify: `apps/observation-edge/wrangler.jsonc`
- Verify: `apps/observation-edge/migrations/`
- Modify externally: Cloudflare Worker `prop-trading-observation-edge` and its
  already-bound D1 database only.

- [ ] **Step 1: Obtain a separate explicit remote-mutation approval**

Record that the approval covers only D1 migrations and deployment of
`prop-trading-observation-edge`; it does not cover MT5, broker, candidate
emission/dispatch, or a second symbol.

- [ ] **Step 2: Inspect remote D1 migration status before changing it**

Run:

```sh
cd apps/observation-edge
npx wrangler d1 migrations list DB --remote
```

Expected: identify only pending tracked observation migrations. Do not delete,
rename, or re-run a migration that the remote database reports as applied.

- [ ] **Step 3: Apply pending migrations exactly once**

Run only if Step 2 shows pending migrations:

```sh
cd apps/observation-edge
npm run db:migrate:remote
```

Expected: Wrangler reports each pending migration applied successfully. Stop on
any partial/error result; do not manually edit the remote database.

- [ ] **Step 4: Build the operations console and deploy the observation Worker**

Run:

```sh
cd apps/operations-console && npm ci --ignore-scripts --no-audit --no-fund && npm run build
cd ../observation-edge && npm run deploy
```

Expected: deployment output names `prop-trading-observation-edge`; its bindings
retain ingress enabled and both candidate controls disabled.

- [ ] **Step 5: Verify liveness is observation-only**

Run:

```sh
curl -sS https://prop-trading-observation-edge.ameer-1996112.workers.dev/health/live
```

Expected JSON includes `status: "ALIVE"`, `mode: "OBSERVATION_ONLY"`, and
`execution: "DISABLED"`. Any other value stops the rollout.

### Task 4: Create and prove the one EURUSD TradingView alert

**Files:**
- Verify: `scripts/pinescript/SND_RD_5M_V3_THREE_ENTRY_LAB.pine`
- Create: `docs/superpowers/reports/2026-08-25-eurusd-paper-alert-ingress-verification.md`

- [ ] **Step 1: Capture the reviewed EURUSD identity before creating the alert**

From the TradingView EURUSD five-minute chart, capture the exact ticker ID,
feed/broker, timeframe, timezone, and all Pine inputs. Compute the source hash:

```sh
shasum -a 256 scripts/pinescript/SND_RD_5M_V3_THREE_ENTRY_LAB.pine
```

Expected: a 64-character digest recorded only in the redacted evidence report.
Stop if the chart is not EURUSD or five minutes.

- [ ] **Step 2: Create exactly one Any-alert-function-call alert**

Use the webhook destination in Task 1 and the dedicated raw credential in the
reviewed Pine script input. Keep the alert message managed by Pine. Do not
enable a second alert, a second pair, paper intent creation, or candidate
emission/dispatch.

- [ ] **Step 3: Wait for a genuine market event and capture the receipt**

Use the existing operations console or:

```sh
curl -sS 'https://prop-trading-observation-edge.ameer-1996112.workers.dev/api/v1/observation-receipts?limit=20'
```

Expected: a redacted EURUSD receipt with `RECEIVED`/accepted outcome. Never
place the raw credential in the request or share it in the evidence report.

- [ ] **Step 4: Prove idempotent replay without synthetic broker traffic**

Wait for the TradingView/platform retry of the same alert, or use only the
existing reviewed test fixture in local verification. Do not handcraft a
production alert body. Expected production evidence is an existing receipt
recorded as `DUPLICATE`, with no new execution/candidate state.

- [ ] **Step 5: Write and validate the redacted verification report**

Record: deployment version, redacted destination structure, chart identity,
source/settings digests, receipt timestamps and codes, heartbeat freshness,
and confirmation that `/health/live` still reports `execution: "DISABLED"`.
Do not record credentials, raw payloads, account data, or broker data.

Run:

```sh
git diff --check
rg -n -i '\b(TBD|TODO|FIXME|placeholder|credential|secret)\b' docs/superpowers/reports/2026-08-25-eurusd-paper-alert-ingress-verification.md
```

Expected: `git diff --check` exits 0. Review any `rg` matches manually; the
report may refer to the word “credential” only to state that no value was
recorded.

- [ ] **Step 6: Commit the redacted evidence report**

```sh
git add docs/superpowers/reports/2026-08-25-eurusd-paper-alert-ingress-verification.md
git commit -m "docs: record EURUSD paper alert verification"
```

### Task 5: Observe one market session before widening scope

**Files:**
- Modify: `docs/superpowers/reports/2026-08-25-eurusd-paper-alert-ingress-verification.md`

- [ ] **Step 1: Observe through one complete active market session**

Confirm receipt freshness remains current, accepted/duplicate outcomes are
explainable, and the MT5 dashboard remains independently online. Do not treat
absence of a trade setup as a failure; only transport health is in scope.

- [ ] **Step 2: Recheck non-execution controls after observation**

Run:

```sh
curl -sS https://prop-trading-observation-edge.ameer-1996112.workers.dev/health/live
```

Expected: `execution: "DISABLED"`. Stop if it differs, even if receipts look
healthy.

- [ ] **Step 3: Close the report or stop**

Mark the report `VERIFIED` only if all Task 4 evidence and Task 5 checks pass.
Otherwise mark `NOT_PROVEN`, state the redacted failure class, and do not add a
pair or change an execution control.

- [ ] **Step 4: Commit the final report state**

```sh
git add docs/superpowers/reports/2026-08-25-eurusd-paper-alert-ingress-verification.md
git commit -m "docs: close EURUSD paper alert observation"
```
