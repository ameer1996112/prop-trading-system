# MT5 DRY_RUN Agent Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect one personal Windows MT5 terminal to the separate Cloudflare execution edge for authenticated, append-only health synchronization while making broker orders structurally impossible.

**Architecture:** `apps/observation-edge` remains the only TradingView ingress and stays broker-free. `apps/execution-edge` gains only `POST /api/v1/agent/sync`: a bearer-authenticated, idempotent heartbeat endpoint routed to one account Durable Object. The MT5 EA polls outbound over HTTPS and reports terminal/account state; every successful response is `DRY_RUN`, carries `command: null`, and the EA contains no `OrderSend`, `CTrade`, order-modification, or close operation.

**Tech Stack:** TypeScript 5.9, Cloudflare Workers/Durable Objects/D1, Wrangler 4, Vitest 4, MQL5, MT5 `WebRequest`.

---

## Safety envelope

- No deployment, Cloudflare resource creation, secret upload, MT5 WebRequest allowlist change, EA installation, Algo Trading enablement, demo order, or live order is part of this plan.
- The only permitted EA network destination is the configured HTTPS execution-edge origin. The source never opens an inbound port, imports a DLL, invokes a shell, stores an account password, or contains an order API call.
- `EXECUTION_MODE_CEILING` remains exactly `DRY_RUN`; `EXECUTION_AUTHORITY_ENABLED` remains exactly `false`; response `command` is always `null`; `real_execution_allowed` never becomes `true`.
- A missing/invalid agent secret, changed account fingerprint, stale timestamp, malformed body digest, duplicate conflict, or sequence gap yields a fail-closed response and no state that can authorize a broker action.

## File map

- Modify: `apps/execution-edge/src/index.ts` — bounded request handling, bearer authentication, inert-vs-agent-sync configuration gate, and Durable Object routing.
- Create: `apps/execution-edge/src/agent-sync-v1.ts` — strict request parser, canonical digest verification, authenticated response builder, and error vocabulary.
- Create: `apps/execution-edge/src/account-coordinator-v1.ts` — one-account Durable Object state for enrollment pins, replay cache, monotonically increasing request/server sequences, and heartbeat snapshot.
- Create: `apps/execution-edge/migrations/0001_agent_sync.sql` — append-only audit records for accepted/rejected sync decisions; no command/order table.
- Modify: `apps/execution-edge/wrangler.jsonc`, `.dev.vars.example`, `README.md` — explicit local-only agent-sync bindings and operator safety instructions; remote values stay absent.
- Create: `apps/execution-edge/test/agent-sync-v1.test.ts` and `test/account-coordinator-v1.test.ts` — protocol, authentication, replay, and no-command tests.
- Create: `mt5/TradeOpsAgent/TradeOpsAgent.mq5` — one-chart heartbeat EA.
- Create: `mt5/TradeOpsAgent/Include/TradeOpsConfig.mqh`, `Include/TradeOpsCanonicalJson.mqh`, `Include/TradeOpsSync.mqh`, and `Scripts/TradeOpsAgentSelfTest.mq5` — isolated configuration, deterministic JSON/digest support, sync transport, and pure self-tests.
- Create: `mt5/TradeOpsAgent/README.md` and `mt5/TradeOpsAgent/fixtures/agent-sync-v1.json` — installation evidence and cross-runtime fixture instructions.
- Modify: `.gitignore` — ignore `*.ex5`, MT5 journal output, and local `TradeOpsAgent` secrets without ignoring `.mq5`, `.mqh`, or fixtures.
- Create: `scripts/verify-mt5-dry-run-boundary.mjs` — static source guard that rejects broker order APIs, DLL imports, secret literals, and authority escalation in the EA/Worker source.

### Task 1: Freeze the no-order agent boundary

**Files:**
- Create: `scripts/verify-mt5-dry-run-boundary.mjs`
- Create: `apps/execution-edge/test/mt5-dry-run-boundary.test.ts`
- Modify: `.gitignore`

- [ ] **Step 1: Write the failing boundary tests**

Assert that the Worker source has no `execution_mode` value other than `DRY_RUN`, no `real_execution_allowed: true`, and the EA tree has no case-insensitive `OrderSend`, `CTrade`, `PositionClose`, `OrderDelete`, `OrderModify`, `WebRequest` URL literal, `#import`, or credential-shaped value.

```ts
expect(runBoundaryVerifier()).toEqual({ ok: true, violations: [] });
expect(scan("void f(){ OrderSend(r,q); }")).toContain("MT5_ORDER_API_FORBIDDEN");
expect(scan('#import "x.dll"')).toContain("MT5_DLL_IMPORT_FORBIDDEN");
```

- [ ] **Step 2: Run the test and observe failure**

Run: `npm --prefix apps/execution-edge test -- mt5-dry-run-boundary.test.ts`

Expected: FAIL because the verifier does not exist.

- [ ] **Step 3: Implement the scanner and ignored local artifacts**

The scanner must read only version-controlled source directories, skip `node_modules`, `.git`, `dist`, and MT5 generated files, return sorted violations, and never print file contents. Add exactly these ignore patterns:

```gitignore
*.ex5
mt5/TradeOpsAgent/local/
mt5/TradeOpsAgent/journal/
```

- [ ] **Step 4: Re-run the boundary test**

Run: `npm --prefix apps/execution-edge test -- mt5-dry-run-boundary.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add .gitignore scripts/verify-mt5-dry-run-boundary.mjs apps/execution-edge/test/mt5-dry-run-boundary.test.ts
git commit -m "test: guard MT5 dry-run boundary"
```

### Task 2: Implement strict authenticated sync parsing

**Files:**
- Create: `apps/execution-edge/src/agent-sync-v1.ts`
- Create: `apps/execution-edge/test/agent-sync-v1.test.ts`
- Modify: `apps/execution-edge/src/index.ts`

- [ ] **Step 1: Write failing request/response tests**

Use one canonical valid `AgentSyncRequestV1` fixture. Test the exact cases below:

```ts
await expect(parseAgentSyncRequest(body, { nowEpoch: 1_787_472_010 }))
  .resolves.toMatchObject({ request_sequence: 2, events: [] });
await expect(parseAgentSyncRequest(bodyWithExtraKey, context)).rejects.toThrow("AGENT_SYNC_INVALID");
await expect(parseAgentSyncRequest(bodyWithWrongDigest, context)).rejects.toThrow("AGENT_SYNC_BODY_DIGEST_MISMATCH");
await expect(parseAgentSyncRequest(staleBody, context)).rejects.toThrow("AGENT_SYNC_TIMESTAMP_INVALID");
expect(await createDryRunResponse(input, 3)).toMatchObject({
  schema_version: "AgentSyncResponseV1", mode: "DRY_RUN", command: null,
});
```

- [ ] **Step 2: Run tests and observe failure**

Run: `npm --prefix apps/execution-edge test -- agent-sync-v1.test.ts`

Expected: FAIL because `agent-sync-v1.ts` does not exist.

- [ ] **Step 3: Implement `agent-sync-v1.ts`**

Accept a bounded UTF-8 JSON body of at most 256 KiB; reject duplicate keys, unknown fields, non-safe integers, non-lowercase SHA-256 digests, invalid schema versions, body-digest self-reference errors, and `sent_at_epoch` more than 30 seconds from Worker time. Recompute `body_sha256` from the canonical request with `body_sha256` omitted. Require `Authorization: Bearer <token>` to be checked in constant time against the SHA-256 digest held only in `AGENT_SYNC_SHARED_SECRET_SHA256`.

Return only this response shape for accepted syncs:

```ts
{
  schema_version: "AgentSyncResponseV1",
  response_body_sha256: "<recomputed canonical SHA-256>",
  server_sequence: nextServerSequence,
  server_time_epoch: nowEpoch,
  mode: "DRY_RUN",
  freeze_reasons: [],
  acknowledged_event_sequence: highestAcceptedEventSequence,
  evidence_requests: [],
  command: null,
}
```

`response_body_sha256` is computed from the same object with that field omitted. The parser does not issue commands or evaluate candidates.

- [ ] **Step 4: Add bounded Worker routing tests**

Test that the route only accepts `POST`, returns `401` for absent/incorrect bearer, `400` for invalid body, `409` for replay conflict, `503` when `AGENT_SYNC_ENABLED !== "true"`, and can never return a non-null command.

- [ ] **Step 5: Run focused verification**

Run: `npm --prefix apps/execution-edge test -- agent-sync-v1.test.ts worker-shell.test.ts && npm --prefix apps/execution-edge run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/execution-edge/src/agent-sync-v1.ts apps/execution-edge/src/index.ts apps/execution-edge/test/agent-sync-v1.test.ts apps/execution-edge/test/worker-shell.test.ts
git commit -m "feat: add authenticated dry-run agent sync"
```

### Task 3: Add one-account replay and heartbeat coordination

**Files:**
- Create: `apps/execution-edge/src/account-coordinator-v1.ts`
- Create: `apps/execution-edge/test/account-coordinator-v1.test.ts`
- Create: `apps/execution-edge/migrations/0001_agent_sync.sql`
- Modify: `apps/execution-edge/src/index.ts`

- [ ] **Step 1: Write failing coordinator tests**

The tests must prove:

```ts
expect(await coordinator.sync(firstRequest)).toMatchObject({ server_sequence: 1, command: null });
expect(await coordinator.sync(exactRetry)).toEqual(firstResponse);
await expect(coordinator.sync(conflictingReuse)).rejects.toThrow("AGENT_SYNC_REPLAY_CONFLICT");
await expect(coordinator.sync(sequenceGap)).rejects.toThrow("AGENT_SYNC_SEQUENCE_GAP");
expect(await coordinator.status()).toMatchObject({ mode: "DRY_RUN", last_request_sequence: 1 });
```

- [ ] **Step 2: Run tests and observe failure**

Run: `npm --prefix apps/execution-edge test -- account-coordinator-v1.test.ts`

Expected: FAIL because the durable coordinator module does not exist.

- [ ] **Step 3: Implement durable state and audit storage**

Key all Durable Object instances by exact `account_id`. Store only installation ID, account profile digest, account fingerprint digest, safety epoch, last accepted request sequence, last response bytes/digest, last acknowledged event sequence, and a redacted heartbeat summary. A changed identity or account fingerprint returns `409` and records a rejected audit result; it does not re-enroll. The response replay cache contains only the most recent accepted sequence and canonical response bytes.

Create a D1 table `agent_sync_audit_v1` with an opaque audit ID, account ID, installation ID, request sequence, request body SHA-256, result code, server sequence, received epoch, and no credential, broker password, account login, full payload, price geometry, or order field.

- [ ] **Step 4: Preserve unconditional no-command behavior**

All coordinator outcomes return a `DRY_RUN` response with `command: null`. The Durable Object exposes no public owner mutation and does not accept candidate data. The Worker addresses it only after bearer authentication and request validation.

- [ ] **Step 5: Run focused verification**

Run: `npm --prefix apps/execution-edge test -- account-coordinator-v1.test.ts agent-sync-v1.test.ts && npm --prefix apps/execution-edge run lint`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/execution-edge/src/account-coordinator-v1.ts apps/execution-edge/src/index.ts apps/execution-edge/migrations/0001_agent_sync.sql apps/execution-edge/test/account-coordinator-v1.test.ts
git commit -m "feat: coordinate dry-run agent heartbeats"
```

### Task 4: Make local and future Cloudflare configuration explicit

**Files:**
- Modify: `apps/execution-edge/wrangler.jsonc`
- Modify: `apps/execution-edge/.dev.vars.example`
- Modify: `apps/execution-edge/README.md`
- Modify: `apps/execution-edge/test/config-and-schema-boundaries.test.ts`

- [ ] **Step 1: Write failing configuration tests**

Require the config to keep `workers_dev=false`, `preview_urls=false`, `EXECUTION_AUTHORITY_ENABLED="false"`, and `EXECUTION_MODE_CEILING="DRY_RUN"`. For local test environments only, permit `AGENT_SYNC_ENABLED="true"` only when `AGENT_SYNC_SHARED_SECRET_SHA256` is supplied and non-placeholder. Remote D1 IDs and remote Durable Object migration deployment remain prohibited by the test.

- [ ] **Step 2: Run tests and observe failure**

Run: `npm --prefix apps/execution-edge test -- config-and-schema-boundaries.test.ts`

Expected: FAIL until the assertions and configuration documentation agree.

- [ ] **Step 3: Implement configuration documentation**

Document the exact local flow:

```sh
cp .dev.vars.example .dev.vars
# Add only AGENT_SYNC_SHARED_SECRET_SHA256=<lowercase sha256>; never add raw bearer text.
npx wrangler dev --local
```

Document that a later deployment requires a separate owner approval, a non-placeholder D1 ID, a Cloudflare secret binding, and a deployed origin before MT5 is configured. Do not add a deploy command that could mutate Cloudflare state.

- [ ] **Step 4: Run config verification**

Run: `npm --prefix apps/execution-edge test -- config-and-schema-boundaries.test.ts && npm --prefix apps/execution-edge run build`

Expected: PASS; Wrangler performs a dry-run bundle only.

- [ ] **Step 5: Commit**

```bash
git add apps/execution-edge/wrangler.jsonc apps/execution-edge/.dev.vars.example apps/execution-edge/README.md apps/execution-edge/test/config-and-schema-boundaries.test.ts
git commit -m "docs: define local dry-run agent configuration"
```

### Task 5: Build the non-trading MT5 heartbeat EA

**Files:**
- Create: `mt5/TradeOpsAgent/TradeOpsAgent.mq5`
- Create: `mt5/TradeOpsAgent/Include/TradeOpsConfig.mqh`
- Create: `mt5/TradeOpsAgent/Include/TradeOpsCanonicalJson.mqh`
- Create: `mt5/TradeOpsAgent/Include/TradeOpsSync.mqh`
- Create: `mt5/TradeOpsAgent/Scripts/TradeOpsAgentSelfTest.mq5`
- Create: `mt5/TradeOpsAgent/fixtures/agent-sync-v1.json`
- Create: `mt5/TradeOpsAgent/README.md`

- [ ] **Step 1: Write source-level test fixtures first**

The fixture must contain one redacted canonical sync request/response pair with SHA-256 values produced by TypeScript. Self-tests must verify canonical key ordering, payload digest, response digest, `mode == "DRY_RUN"`, and `command == null`.

- [ ] **Step 2: Implement minimal EA lifecycle**

`OnInit` must reject any profile string other than `DRY_RUN`, initialize a 5-second timer, and create no trade object. `OnTimer` must be reentrancy-guarded, collect only terminal build, broker-server hash, account fingerprint SHA-256, connection/trading-permission state, broker and Windows epochs, then construct a bounded zero-event request. `OnDeinit` kills the timer. `OnTradeTransaction` is omitted because this phase neither submits nor tracks orders.

Use `WebRequest("POST", endpoint, authorizationHeaders, timeoutMs, requestBytes, responseBytes, responseHeaders)` only from the timer path; timeout is 1,500 ms. The endpoint and raw bearer token are read from a local configuration file that is never compiled, committed, logged, or copied into fixtures. Failure only updates a local redacted status line and waits for the next timer; it never retries in a tight loop.

- [ ] **Step 3: Implement hard response rejection**

Before accepting a response, verify HTTPS configuration, HTTP 200, strict JSON shape, canonical response digest, `mode == "DRY_RUN"`, and `command == null`. Any response with a non-null command, a missing digest, wrong server sequence, or unknown property is rejected and rendered `SYNC_REJECTED`; there is no code path that converts a command into an MT5 request.

- [ ] **Step 4: Write operator instructions**

The README must instruct the operator to compile but not attach the EA yet; keep Algo Trading disabled; leave DLL imports disabled; make no WebRequest allowlist entry until the edge is separately deployed and an operator has approved the origin. It must list the expected single-chart attachment (`EURUSD`, M5), status labels, local-secret file location, and redacted proof to capture after future installation.

- [ ] **Step 5: Run static verifier and source checks**

Run: `node scripts/verify-mt5-dry-run-boundary.mjs && npm --prefix apps/execution-edge test -- mt5-dry-run-boundary.test.ts`

Expected: PASS with zero broker-capable API references.

- [ ] **Step 6: Commit**

```bash
git add mt5/TradeOpsAgent scripts/verify-mt5-dry-run-boundary.mjs apps/execution-edge/test/mt5-dry-run-boundary.test.ts
git commit -m "feat: add MT5 dry-run heartbeat agent"
```

### Task 6: Full local verification and operator handoff

**Files:**
- Modify: `apps/execution-edge/README.md`
- Create: `docs/runbooks/mt5-dry-run-agent-local-verification.md`

- [ ] **Step 1: Add an explicit local-only verification runbook**

The runbook must distinguish three states: source verified locally, Worker running locally, and later Windows attachment. It must explicitly say none of these is demo, evaluation, or live activation.

- [ ] **Step 2: Run all automated checks**

Run:

```bash
npm --prefix apps/execution-edge test
npm --prefix apps/execution-edge run lint
npm --prefix apps/execution-edge run typecheck
npm --prefix apps/execution-edge run build
node scripts/verify-mt5-dry-run-boundary.mjs
./scripts/verify-execution-edge-foundation.sh
```

Expected: all tests pass; all Worker builds are dry-run only; boundary verifier reports zero violations.

- [ ] **Step 3: Inspect Git state and commit documentation**

```bash
git status --short
git add apps/execution-edge/README.md docs/runbooks/mt5-dry-run-agent-local-verification.md
git commit -m "docs: add MT5 dry-run verification runbook"
git status --short
```

Expected: clean working tree. Report the branch and commits, exact test count, and confirmation that no Cloudflare, MT5, broker, or TradingView state changed.

## Explicitly deferred

- Creating Cloudflare D1 or Durable Object production resources; deploying execution-edge; setting remote secrets; or enabling `AGENT_SYNC_ENABLED` remotely.
- Attaching the EA to MT5, adding a WebRequest allowlist entry, enabling Algo Trading, or sending any request from the user’s Windows machine.
- Candidate intake, broker-bar reconstruction authorization, risk reservations, trade leases, order sizing, order submission, trade lifecycle folds, dashboard execution panels, demo canaries, or live/funded authority.
