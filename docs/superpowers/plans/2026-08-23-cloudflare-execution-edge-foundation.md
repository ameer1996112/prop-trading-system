# Cloudflare Execution Edge Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task by task. Use `superpowers:test-driven-development` for every behavior change and `superpowers:verification-before-completion` before claiming completion.

**Goal:** Complete the already-started `apps/execution-edge` as a buildable, strictly validated, fail-closed Cloudflare Worker foundation while keeping all command authority disabled and all broker-facing outputs limited to `DRY_RUN`.

**Architecture:** Preserve `apps/observation-edge` as the existing public TradingView ingress and account-free proposal boundary. Build a separate execution Worker with its own inert D1 binding and SQLite Durable Object namespaces. This phase freezes the cross-runtime JSON contracts, validates authenticated broker-bar evidence, and proves the existing broker-geometry reconstruction with deterministic vectors. It does not connect MT5, create a production D1 database, deploy the Worker, issue orders, or enable candidate intake.

**Tech Stack:** TypeScript 5.9, Cloudflare Workers and SQLite Durable Objects, Wrangler 4, Vitest 4, JSON Schema Draft 2020-12, Web Crypto SHA-256.

---

## Scope and safety invariants

- Work in `/Users/ameeramer/Documents/ChatGPT/Trading/prop-trading-system-v3-design`.
- Treat `docs/superpowers/plans/2026-08-10-local-mt5-prop-automation.md` as the approved system architecture. This plan implements only its inert execution-edge contract foundation.
- Do not edit the Pine release, the deployed observation Worker configuration, or its remote D1 database.
- Do not run `wrangler deploy`, `wrangler d1 create`, `wrangler d1 migrations apply --remote`, or any command that changes Cloudflare state.
- Keep these five values exact throughout the phase:

  ```json
  {
    "CANDIDATE_INBOX_ENABLED": "false",
    "AGENT_SYNC_ENABLED": "false",
    "EXECUTION_AUTHORITY_ENABLED": "false",
    "EXECUTION_MODE_CEILING": "DRY_RUN",
    "ROUTING_MANIFEST_SHA256": "INERT_NOT_CONFIGURED"
  }
  ```

- No schema or TypeScript type may carry a broker password, account password, generic order payload, `LIVE` authority, or `EVALUATION` authority.
- `BrokerGeometryReconstructionV1` remains side-effect free with `authority="PAPER_ONLY"`, `real_execution_allowed=false`, and `command=null` for every outcome.
- Each task ends with a focused commit. Do not mix unrelated Pine changes into these commits.

## Baseline inventory

Already present and retained:

- `apps/execution-edge/src/exact-price-v1.ts`
- `apps/execution-edge/src/execution-candidate-v2.ts`
- `apps/execution-edge/src/broker-symbol-capability-v1.ts`
- `apps/execution-edge/src/broker-geometry-reconstruction-v1.ts`
- `apps/execution-edge/test/exact-price-v1.test.ts`
- `apps/execution-edge/test/broker-reconstruction-contracts.test.ts`
- `apps/execution-edge/test/broker-geometry-reconstruction-v1.test.ts`
- `apps/execution-edge/test/config-and-schema-boundaries.test.ts`
- `contracts/schema/rd-entry-execution-proposal-v2.schema.json`
- `contracts/schema/execution-candidate-v2.schema.json`
- `contracts/schema/broker-symbol-capability-v1.schema.json`
- `contracts/schema/broker-geometry-reconstruction-v1.schema.json`
- `contracts/vectors/broker-geometry-reconstruction-v1.json`

The current expected failure is structural: `apps/execution-edge` has no package/tooling, `src/canonical.ts` and `src/contracts-v1.ts` are missing, the Worker entry point/configuration is missing, and eleven boundary schemas referenced by the existing tests are missing.

## Task 1: Bootstrap an independently buildable, inert Worker

**Files:**

- Create: `apps/execution-edge/package.json`
- Create: `apps/execution-edge/tsconfig.json`
- Create: `apps/execution-edge/vitest.config.ts`
- Create: `apps/execution-edge/wrangler.jsonc`
- Create: `apps/execution-edge/src/index.ts`
- Create: `apps/execution-edge/test/worker-shell.test.ts`

- [ ] **Step 1: Write the failing Worker-shell test**

  Add `test/worker-shell.test.ts` that imports the default Worker and both Durable Object classes. Assert:

  1. `GET /health/live` returns `200` with this exact JSON shape:

     ```json
     {
       "ok": true,
       "service": "prop-trading-execution-edge",
       "mode": "INERT_FOUNDATION",
       "candidate_inbox": "DISABLED",
       "agent_sync": "DISABLED",
       "execution_authority": "DISABLED",
       "execution_mode_ceiling": "DRY_RUN"
     }
     ```

  2. Any request to `/api/v1/agent/sync` returns `503` and `{"error":"AGENT_SYNC_DISABLED"}`.
  3. Any other route returns `404` and `{"error":"NOT_FOUND"}`.
  4. `CandidateInbox` and `AccountCoordinator` are exported constructors.

- [ ] **Step 2: Create package and TypeScript configuration**

  Mirror the pinned development dependency versions from `apps/observation-edge/package.json`. The package must be private, ESM, and expose these scripts:

  ```json
  {
    "build": "wrangler deploy --dry-run --outdir dist",
    "lint": "tsc --noEmit --pretty false",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  }
  ```

  Copy the strict compiler options from `apps/observation-edge/tsconfig.json`, scoped only to `src/**/*.ts`, `test/**/*.ts`, and `vitest.config.ts`. Copy its Vitest node configuration.

- [ ] **Step 3: Create the inert Wrangler configuration**

  `wrangler.jsonc` must define:

  - `name: "prop-trading-execution-edge"`
  - `main: "src/index.ts"`
  - `compatibility_date: "2026-07-23"`, matching the already-tested observation Worker toolchain
  - `workers_dev: false` and `preview_urls: false`
  - the five exact inert variables from the safety section
  - one D1 binding named `EXECUTION_DB`, database name `prop-trading-execution-edge-inert`, and all-zero database ID
  - Durable Object bindings for `CandidateInbox` and `AccountCoordinator`
  - an initial migration tag with both classes under `new_sqlite_classes`

- [ ] **Step 4: Run the test and confirm RED**

  Run:

  ```bash
  cd apps/execution-edge
  npm install --ignore-scripts
  npm test -- worker-shell.test.ts
  ```

  Expected: failure because `src/index.ts` does not exist.

- [ ] **Step 5: Implement the minimum fail-closed Worker shell**

  In `src/index.ts`:

  - Define a typed `Env` containing the D1 binding, both DO namespaces, and literal/string configuration variables.
  - Export `CandidateInbox` and `AccountCoordinator` classes. Their constructors accept `DurableObjectState` and `Env`; their public `fetch()` methods always return `503` with `{"error":"FOUNDATION_ONLY"}`. They must not read or write storage yet.
  - Export the default module Worker with an async `fetch(request, env)` handler.
  - Return the health response only for `GET /health/live`.
  - Return disabled for every method on `/api/v1/agent/sync`.
  - Return not-found otherwise.
  - Set `content-type: application/json; charset=utf-8` and `cache-control: no-store` on every response.
  - Derive health status from the exact inert environment values and return `500` with `{"error":"UNSAFE_CONFIGURATION"}` if any authority flag or ceiling differs.

- [ ] **Step 6: Run focused verification**

  ```bash
  npm test -- worker-shell.test.ts config-and-schema-boundaries.test.ts
  npm run typecheck
  npm run build
  ```

  Expected at this point: Worker shell tests pass; boundary/type/build commands can still fail only because Tasks 2-4 have not created required modules and schemas.

- [ ] **Step 7: Commit**

  ```bash
  git add apps/execution-edge/package.json apps/execution-edge/package-lock.json apps/execution-edge/tsconfig.json apps/execution-edge/vitest.config.ts apps/execution-edge/wrangler.jsonc apps/execution-edge/src/index.ts apps/execution-edge/test/worker-shell.test.ts
  git commit -m "build: bootstrap inert execution edge"
  ```

## Task 2: Add deterministic canonical JSON and SHA-256

**Files:**

- Create: `apps/execution-edge/src/canonical.ts`
- Create: `apps/execution-edge/test/canonical.test.ts`

- [ ] **Step 1: Write canonicalization tests first**

  Cover these exact behaviors:

  - object keys are recursively sorted by Unicode code point;
  - array order is preserved;
  - strings use JSON escaping;
  - `null`, booleans, safe integers, and finite decimals serialize deterministically;
  - the equivalent objects `{b:2,a:1}` and `{a:1,b:2}` produce the same bytes and SHA-256;
  - `undefined`, functions, symbols, `NaN`, infinities, sparse arrays, non-plain objects, and integers outside JavaScript's safe range throw `CANONICAL_JSON_INVALID`;
  - `sha256Hex("abc")` equals `ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad`.

- [ ] **Step 2: Run the test and confirm RED**

  ```bash
  cd apps/execution-edge
  npm test -- canonical.test.ts
  ```

  Expected: module-not-found failure for `src/canonical.ts`.

- [ ] **Step 3: Implement the canonical module**

  Export:

  ```ts
  export type CanonicalValue =
    | null
    | boolean
    | number
    | string
    | readonly CanonicalValue[]
    | Readonly<{ [key: string]: CanonicalValue }>;

  export function canonicalStringify(value: CanonicalValue): string;
  export async function sha256Hex(value: string | Uint8Array): Promise<string>;
  ```

  Use recursive sorted-key serialization and `crypto.subtle.digest("SHA-256", bytes)`. Validate values before serialization; never coerce `undefined` to `null`. Use `TextEncoder` for strings and return lowercase hexadecimal.

- [ ] **Step 4: Verify canonical parity with existing vectors**

  ```bash
  npm test -- canonical.test.ts broker-reconstruction-contracts.test.ts
  npm run typecheck
  ```

  Expected: canonical tests pass. Broker contract tests progress past imports and can fail only on the missing `contracts-v1.ts` or schemas.

- [ ] **Step 5: Commit**

  ```bash
  git add apps/execution-edge/src/canonical.ts apps/execution-edge/test/canonical.test.ts
  git commit -m "feat: add execution contract canonical hashing"
  ```

## Task 3: Freeze the broker-bar evidence contract and validator

**Files:**

- Create: `contracts/schema/broker-bar-evidence-v1.schema.json`
- Create: `apps/execution-edge/src/contracts-v1.ts`
- Create: `apps/execution-edge/test/broker-bar-evidence-v1.test.ts`

- [ ] **Step 1: Write validator tests from the existing reconstruction fixture**

  Use `brokerBarEvidenceFixture()` and assert that a valid three-bar M5 batch is accepted and deeply immutable. Add rejection cases for:

  - unknown top-level and bar fields;
  - wrong `schema_version`, symbol-capability digest, timeframe, or account profile digest;
  - empty bars and 513 bars;
  - unclosed bars;
  - a bar not exactly 300 seconds for M5 or 60 seconds for M1;
  - off-grid epochs;
  - invalid OHLC ordering;
  - overlapping, duplicated, descending, or internally gapped bars;
  - `observed_at_epoch` earlier than the last close or more than 30 seconds after it;
  - unsafe tick/epoch integers and zero/all-zero digests.

  Gap recovery is intentionally owned by `broker-geometry-reconstruction-v1.ts`; the base validator must reject internal gaps.

- [ ] **Step 2: Run the test and confirm RED**

  ```bash
  cd apps/execution-edge
  npm test -- broker-bar-evidence-v1.test.ts
  ```

  Expected: module-not-found failure for `src/contracts-v1.ts`.

- [ ] **Step 3: Freeze the strict JSON schema**

  Define `BrokerBarEvidenceV1` as a strict object with these required fields and no others:

  ```text
  schema_version = "BrokerBarEvidenceV1"
  evidence_id, installation_id, account_id = printable identifiers, 1..160 characters
  account_profile_sha256, symbol_capability_sha256, reconciliation_sha256 = nonzero lowercase SHA-256
  source_symbol = EURUSD | GBPJPY | USDJPY | XAUUSD | NAS100
  broker_symbol = printable identifier
  timeframe = M5 | M1
  reconciliation_cursor = printable identifier
  bars = 1..512 strict BrokerBarV1 objects
  observed_at_epoch = nonnegative safe integer
  ```

  Each `BrokerBarV1` requires exactly `open_epoch`, `close_epoch`, `open_ticks`, `high_ticks`, `low_ticks`, `close_ticks`, and `closed=true`. Epochs are nonnegative safe integers and prices are signed safe integers.

- [ ] **Step 4: Implement the runtime validator**

  `contracts-v1.ts` exports `BrokerBarV1`, `BrokerBarEvidenceV1`, and:

  ```ts
  export function validateBrokerBarEvidenceV1(
    value: unknown,
    expectedCapabilitySha256: string,
  ): BrokerBarEvidenceV1;
  ```

  Follow the exact-key, identifier, digest, and safe-integer style already used in `execution-candidate-v2.ts`. Enforce:

  - capability digest equals the expected digest;
  - bar duration/grid match the timeframe;
  - OHLC is internally valid;
  - bars are contiguous and strictly increasing;
  - the last bar is closed before observation and observation lag is `0..30` seconds;
  - all returned objects and the returned bar array are frozen;
  - every validation failure throws exactly `BROKER_BAR_EVIDENCE_INVALID`.

- [ ] **Step 5: Run broker evidence and reconstruction tests**

  ```bash
  npm test -- broker-bar-evidence-v1.test.ts broker-geometry-reconstruction-v1.test.ts broker-reconstruction-contracts.test.ts
  npm run typecheck
  ```

  Expected: all selected tests pass except schema-boundary assertions for the ten contracts created in Task 4.

- [ ] **Step 6: Commit**

  ```bash
  git add contracts/schema/broker-bar-evidence-v1.schema.json apps/execution-edge/src/contracts-v1.ts apps/execution-edge/test/broker-bar-evidence-v1.test.ts
  git commit -m "feat: validate bounded broker bar evidence"
  ```

## Task 4: Freeze the remaining account, sync, decision, and routing schemas

**Files:**

- Create: `contracts/schema/account-profile-v1.schema.json`
- Create: `contracts/schema/signed-account-profile-v1.schema.json`
- Create: `contracts/schema/prop-rule-pack-v1.schema.json`
- Create: `contracts/schema/news-calendar-pack-v1.schema.json`
- Create: `contracts/schema/agent-sync-request-v1.schema.json`
- Create: `contracts/schema/agent-sync-response-v1.schema.json`
- Create: `contracts/schema/trade-command-v1.schema.json`
- Create: `contracts/schema/agent-event-v1.schema.json`
- Create: `contracts/schema/execution-decision-v1.schema.json`
- Create: `contracts/schema/routing-manifest-v1.schema.json`
- Create: `apps/execution-edge/test/contract-schema-v1.test.ts`

- [ ] **Step 1: Write schema tests before schemas**

  Extend the existing lightweight schema test helper and add one positive inert fixture plus the following negative cases per contract: unknown field, missing required field, invalid enum, unsafe integer, malformed digest, and forbidden authority. Assert every root and nested object has `additionalProperties:false`.

- [ ] **Step 2: Run and confirm RED**

  ```bash
  cd apps/execution-edge
  npm test -- contract-schema-v1.test.ts config-and-schema-boundaries.test.ts
  ```

  Expected: missing-schema failures.

- [ ] **Step 3: Create strict account and policy schemas**

  Freeze the following minimum complete contracts:

  - `AccountProfileV1`: profile ID/digest inputs, internal account ID, account fingerprint digest, environment=`DEMO`, server identifier, currency=`USD`, margin mode, balance class, authority ceiling=`DRY_RUN`, exact five-symbol source-to-broker map, risk limits in integer basis points, and profile validity epochs. It contains no current mode and no credential-shaped field.
  - `SignedAccountProfileV1`: the exact envelope `{schema_version, profile, profile_sha256, issuer_id, key_id, issued_at_epoch, not_before_epoch, expires_at_epoch, safety_epoch, mac_alg, mac_hex}` with `mac_alg="HMAC-SHA256"`.
  - `PropRulePackV1`: pack digest/version, environment=`DEMO`, integer daily/overall loss basis points, integer risk-per-trade basis points, maximum concurrent ideas, weekend/news restrictions, issue/validity epochs, and `authority_ceiling="DRY_RUN"`.
  - `NewsCalendarPackV1`: pack digest/version, UTC coverage start/end epochs, issuer, issue epoch, and 0..512 strict events containing event ID, currencies, impact=`HIGH`, start/end epochs, and title.

- [ ] **Step 4: Create strict sync and event schemas**

  Freeze:

  - `AgentEventV1`: immutable event ID, installation/account/profile/safety bindings, monotonic sequence, UTC observed epoch, kind enum (`HEARTBEAT`, `TERMINAL_STATE`, `ORDER_STATE`, `DEAL_STATE`, `POSITION_STATE`, `PROTECTION_STATE`, `RECONCILIATION_STATE`), body digest, and a bounded strict fact object selected by kind.
  - `AgentSyncRequestV1`: installation/account/profile/safety bindings, monotonic request sequence, last acknowledged server sequence, nonce, sent epoch, exact body digest, one strict account snapshot, 0..256 agent events, and 0..8 `BrokerBarEvidenceV1` values.
  - `AgentSyncResponseV1`: server sequence/time, mode=`DRY_RUN`, freeze reasons, acknowledged event sequence, 0..8 evidence requests, and `command` either null or `TradeCommandV1`.

  Authentication credentials stay in the HTTPS authorization header and are never fields in these payloads.

- [ ] **Step 5: Create strict decision, command, and routing schemas**

  Freeze:

  - `ExecutionDecisionV1`: candidate/account/profile/capability/reconstruction/rule/news/safety bindings; outcome `BLOCKED|DRY_RUN_AUTHORIZED|EXPIRED`; stable reason code; integer modeled risk; reservation ID or null; created/expiry epochs; `authority="DRY_RUN"`; `real_execution_allowed=false`.
  - `TradeCommandV1`: command/lease/candidate/decision/account/installation/profile/capability/safety bindings; direction; broker symbol; integer entry/stop/target ticks; integer volume steps; issue/expiry epochs no more than 30 seconds apart; `execution_mode` const `DRY_RUN`; `real_execution_allowed` const false. It must not admit arbitrary instruction text, arbitrary order JSON, `LIVE`, or `EVALUATION`.
  - `RoutingManifestV1`: manifest digest/version, issue/validity epochs, `authority_ceiling="DRY_RUN"`, and 0..32 strict routes mapping a supported source symbol to internal account/profile/capability digests. No broker or account credential is present.

- [ ] **Step 6: Run all schema tests**

  ```bash
  npm test -- contract-schema-v1.test.ts config-and-schema-boundaries.test.ts
  ```

  Expected: all strictness, forbidden-field, inert-command, and observation-boundary tests pass.

- [ ] **Step 7: Commit**

  ```bash
  git add contracts/schema/account-profile-v1.schema.json contracts/schema/signed-account-profile-v1.schema.json contracts/schema/prop-rule-pack-v1.schema.json contracts/schema/news-calendar-pack-v1.schema.json contracts/schema/agent-sync-request-v1.schema.json contracts/schema/agent-sync-response-v1.schema.json contracts/schema/trade-command-v1.schema.json contracts/schema/agent-event-v1.schema.json contracts/schema/execution-decision-v1.schema.json contracts/schema/routing-manifest-v1.schema.json apps/execution-edge/test/contract-schema-v1.test.ts
  git commit -m "feat: freeze inert execution edge contracts"
  ```

## Task 5: Prove the broker reconstruction module against schemas and vectors

**Files:**

- Modify: `apps/execution-edge/test/broker-geometry-reconstruction-v1.test.ts`
- Modify: `apps/execution-edge/test/broker-reconstruction-contracts.test.ts`
- Modify only if a test exposes a defect: `apps/execution-edge/src/broker-geometry-reconstruction-v1.ts`
- Modify only if a test exposes a defect: `apps/execution-edge/src/broker-symbol-capability-v1.ts`
- Modify only if a test exposes a defect: `apps/execution-edge/src/execution-candidate-v2.ts`
- Modify only if a test exposes a defect: `contracts/vectors/broker-geometry-reconstruction-v1.json`

- [ ] **Step 1: Add missing invariant tests**

  Add tests proving:

  - all reconstruction results validate against `broker-geometry-reconstruction-v1.schema.json`;
  - reconstruction never mutates candidate, evidence, or capability input;
  - changing one canonical source field without recomputing its digest is rejected;
  - a valid replay run twice returns byte-identical canonical output;
  - M1 evidence cannot silently substitute for required M5 evidence;
  - evidence whose last close is outside the candidate 30-second TTL cannot match;
  - every `DATA_GAP` and `BLOCKED` result has all geometry fields null;
  - no result contains `command`, authority, or execution values other than the inert constants.

- [ ] **Step 2: Run the focused suite and confirm any new RED case**

  ```bash
  cd apps/execution-edge
  npm test -- broker-geometry-reconstruction-v1.test.ts broker-reconstruction-contracts.test.ts
  ```

- [ ] **Step 3: Make only the smallest domain fix required**

  Preserve all existing stable error strings and vector bytes. If a vector must change because the implementation previously violated the frozen schema, update the vector generator/source and commit the resulting literal vector together; never hand-edit only the expected digest.

- [ ] **Step 4: Run exact-price and geometry verification**

  ```bash
  npm test -- exact-price-v1.test.ts broker-bar-evidence-v1.test.ts broker-reconstruction-contracts.test.ts broker-geometry-reconstruction-v1.test.ts
  npm run typecheck
  ```

  Expected: zero failed tests and zero TypeScript errors.

- [ ] **Step 5: Commit**

  ```bash
  git add apps/execution-edge/test/broker-geometry-reconstruction-v1.test.ts apps/execution-edge/test/broker-reconstruction-contracts.test.ts apps/execution-edge/src/broker-geometry-reconstruction-v1.ts apps/execution-edge/src/broker-symbol-capability-v1.ts apps/execution-edge/src/execution-candidate-v2.ts contracts/vectors/broker-geometry-reconstruction-v1.json
  git commit -m "test: harden broker geometry reconstruction"
  ```

  Before committing, unstage any unchanged optional file so the commit contains only actual changes.

## Task 6: Add local-only documentation and verification guardrails

**Files:**

- Create: `apps/execution-edge/README.md`
- Create: `apps/execution-edge/.dev.vars.example`
- Create: `scripts/verify-execution-edge-foundation.sh`
- Modify: `.gitignore` only if local Wrangler/dev-var paths are not already ignored

- [ ] **Step 1: Add a failing verification-script smoke test**

  The shell script must fail unless all five inert values are present exactly in `wrangler.jsonc`. It must also fail if any of these appear in the execution-edge source/config/contracts: `EXECUTION_AUTHORITY_ENABLED.*true`, `EXECUTION_MODE_CEILING.*LIVE`, `broker_password`, `account_password`, or `generic_instruction`.

- [ ] **Step 2: Implement the verification script**

  Use `set -euo pipefail`, resolve the repository root from the script location, run static safety checks, then execute:

  ```bash
  npm --prefix apps/execution-edge test
  npm --prefix apps/execution-edge run lint
  npm --prefix apps/execution-edge run typecheck
  npm --prefix apps/execution-edge run build
  ```

  The script must not contact Cloudflare or invoke a remote database.

- [ ] **Step 3: Document the operational boundary**

  `README.md` must state:

  - this phase is an inert contract/reconstruction foundation;
  - the existing `apps/observation-edge` remains the TradingView ingress;
  - no Windows MT5 agent is connected yet;
  - health is local-only until a separately approved deployment;
  - all candidate, sync, and execution authority flags must remain false;
  - exact install/test/build commands;
  - `.dev.vars` is local and secret, and `.dev.vars.example` contains names only, never values;
  - the next phase is signed `/api/v1/agent/sync` plus an MQL5 DRY_RUN receiver, followed by demo-only paper/canary promotion.

- [ ] **Step 4: Run complete local verification**

  ```bash
  ./scripts/verify-execution-edge-foundation.sh
  git diff --check
  git status --short
  ```

  Expected: all tests, lint, typecheck, and dry-run build pass; `git diff --check` prints nothing; only intended files are modified.

- [ ] **Step 5: Commit**

  ```bash
  git add apps/execution-edge/README.md apps/execution-edge/.dev.vars.example scripts/verify-execution-edge-foundation.sh .gitignore
  git commit -m "docs: document inert execution edge workflow"
  ```

  Omit `.gitignore` from the commit if no change was needed.

## Task 7: Final safety and plan-compliance review

**Files:** Read all changed files; modify only defects discovered by review.

- [ ] **Step 1: Verify approved-scope coverage**

  Confirm the resulting diff establishes:

  - a separately named and separately bound execution Worker;
  - no edits to the deployed observation Worker configuration;
  - deterministic canonical hashing;
  - strict broker evidence plus the eleven required boundary contracts;
  - passing existing price/candidate/capability/reconstruction vectors;
  - an inert health surface and disabled sync surface;
  - no deployment, remote migration, broker connection, or execution activation.

- [ ] **Step 2: Scan for placeholders and unsafe authority**

  ```bash
  rg -n "TODO|FIXME|XXX|TBD|placeholder|generic_instruction|order_payload|broker_password|account_password" apps/execution-edge contracts/schema scripts/verify-execution-edge-foundation.sh
  rg -n 'EXECUTION_AUTHORITY_ENABLED|EXECUTION_MODE_CEILING|execution_mode|real_execution_allowed' apps/execution-edge contracts/schema
  ```

  Expected: the placeholder/credential scan has no hits except explicit negative-test regexes or explanatory documentation; authority hits show only false, `DRY_RUN`, or `PAPER_ONLY` values.

- [ ] **Step 3: Run the final clean-room command**

  ```bash
  ./scripts/verify-execution-edge-foundation.sh
  git diff --check
  git log --oneline -7
  git status --short --branch
  ```

  Expected: verification passes, no whitespace errors, commits are focused, and the worktree is clean.

- [ ] **Step 4: Record the handoff**

  Report the exact test count, dry-run Worker bundle result, branch name, commit hashes, and confirmation that no Cloudflare or MT5 state changed. The next implementation plan must cover only signed agent sync and the Windows MQL5 `DRY_RUN` receiver; it must not promote demo or live authority.

## Deferred work requiring a separate plan and approval

The following are intentionally excluded from this phase:

1. Creating the production execution-edge D1 database and Durable Object resources.
2. Deploying `prop-trading-execution-edge` or adding a public route/domain.
3. Implementing agent enrollment, authentication, HMAC verification, replay storage, or `/api/v1/agent/sync` behavior.
4. Creating the MQL5 Expert Advisor, installing it in MT5, or adding its endpoint to MetaTrader's WebRequest allowlist.
5. Enabling candidate inbox emission/dispatch from `observation-edge`.
6. Issuing a command that can submit, modify, or close a broker order.
7. Adding `DEMO_CANARY`, evaluation, funded, or live modes.
8. Migrating the operations dashboard to execution-edge data.

Each deferred item crosses a new trust or operational boundary and therefore needs its own reviewed plan, local tests, and explicit owner authorization.
