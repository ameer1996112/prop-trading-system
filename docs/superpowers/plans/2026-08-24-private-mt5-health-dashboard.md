# Private MT5 Health Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Build a free, private, read-only workers.dev dashboard that displays the health of the existing Windows MT5 DRY_RUN heartbeat without adding trading, broker, or account authority.

**Architecture:** apps/execution-edge remains the sole authenticated MT5 ingress. Only a newly accepted (not replayed or rejected) DRY_RUN heartbeat writes a minimal agent_health_current_v1 D1 projection beside the immutable audit table. A separate apps/agent-health-console Worker binds to the same D1 database, serves a static same-origin page, and exposes only GET /api/v1/health-summary; Cloudflare Access protects this dashboard Worker, never the MT5 sync Worker.

**Tech Stack:** TypeScript 5.9, Cloudflare Workers, Cloudflare D1, Wrangler 4, Vitest 4, browser-native HTML/CSS/JavaScript, Cloudflare Access.

**Spec:** docs/superpowers/specs/2026-08-24-private-mt5-health-dashboard-design.md

## Global Constraints

- All existing execution-edge configuration remains EXECUTION_AUTHORITY_ENABLED="false" and EXECUTION_MODE_CEILING="DRY_RUN".
- The MT5 EA remains DRY_RUN-only; do not enable MT5 Algo Trading, add broker order APIs, modify the MT5 allowlist, or change Windows credentials.
- The dashboard must not expose bearer credentials, broker server/login information, fingerprints, raw payloads, balances, equity, margin, prices, positions, orders, signals, candidates, or execution controls.
- The dashboard is read-only: browser routes accept GET only; the new Worker contains no mutation endpoint and no Cloudflare/MT5/broker control binding.
- ONLINE means an accepted heartbeat is at most 20 seconds old; STALE is 21–60 seconds; OFFLINE is older than 60 seconds; UNKNOWN is no projection or a read failure.
- The first release is one configured dry-run account/installation only, with no user-selectable identifier, and returns at most 20 redacted audit records.
- Cloudflare deployment and Access configuration are explicit operator actions after all automated checks pass; no deployment is performed merely by implementing this plan.

---

## File map

- Create: apps/execution-edge/migrations/0002_agent_health_current.sql — current health projection table and no-delete guard.
- Create: apps/execution-edge/src/agent-health-projection-v1.ts — allowlisted projection types, accepted-heartbeat extraction, and state derivation.
- Modify: apps/execution-edge/src/index.ts — atomically persist audit plus projection only for a newly accepted heartbeat.
- Create: apps/execution-edge/test/agent-health-projection-v1.test.ts — projection field, state, and query-contract tests.
- Modify: apps/execution-edge/test/agent-sync-v1.test.ts — integration tests proving rejected and exact-retry syncs do not refresh health.
- Modify: scripts/verify-mt5-dry-run-boundary.mjs and apps/execution-edge/test/mt5-dry-run-boundary.test.ts — source isolation check for the dashboard Worker.
- Create: apps/agent-health-console/package.json, package-lock.json, tsconfig.json, vitest.config.ts — isolated Worker test/build toolchain matching execution-edge versions.
- Create: apps/agent-health-console/src/health-summary-v1.ts — D1 reads, response schema, redaction, and derived status.
- Create: apps/agent-health-console/src/dashboard-html.ts — static page, safe renderer, ten-second polling, and manual refresh.
- Create: apps/agent-health-console/src/index.ts — same-origin GET routing and static HTML response.
- Create: apps/agent-health-console/test/health-summary-v1.test.ts, test/dashboard-html.test.ts, test/worker.test.ts — endpoint, failure, rendering, and method tests.
- Create: apps/agent-health-console/wrangler.dry-run.jsonc, .gitignore, README.md — no-secret deployment configuration and Cloudflare Access runbook.
- Modify: docs/runbooks/mt5-dry-run-agent-local-verification.md — dashboard evidence after MT5 heartbeats remain healthy.

### Task 1: Define and test the minimal accepted-heartbeat projection

**Files:**
- Create: apps/execution-edge/migrations/0002_agent_health_current.sql
- Create: apps/execution-edge/src/agent-health-projection-v1.ts
- Create: apps/execution-edge/test/agent-health-projection-v1.test.ts

**Interfaces:**
- Consumes: AgentSyncRequestV1 from apps/execution-edge/src/agent-sync-v1.ts and an accepted server sequence from the account coordinator.
- Produces: AgentHealthProjectionV1, projectAcceptedHeartbeatV1(request, serverSequence, receivedAtEpoch), and deriveHealthStateV1(lastAcceptedEpoch, nowEpoch).

- [ ] **Step 1: Write the failing projection tests**

~~~
expect(projectAcceptedHeartbeatV1(request, 9, 1_787_472_010)).toEqual({
  account_id: "account-1", installation_id: "installation-1",
  last_accepted_epoch: 1_787_472_010, request_sequence: 2, server_sequence: 9,
  terminal_build: 4410, source_symbol: "EURUSD",
  terminal_connection_state: "CONNECTED", account_trade_permission: "DENIED",
  terminal_trade_permission: "DENIED", algo_trading_permission: "DENIED",
});
expect(deriveHealthStateV1(100, 120)).toBe("ONLINE");
expect(deriveHealthStateV1(100, 140)).toBe("STALE");
expect(deriveHealthStateV1(100, 161)).toBe("OFFLINE");
expect(deriveHealthStateV1(null, 161)).toBe("UNKNOWN");
~~~

Also assert the projection result has no digest, broker, raw-event, balance, equity, margin, price, order, or position key.

- [ ] **Step 2: Run the focused test to verify failure**

Run: npm --prefix apps/execution-edge test -- agent-health-projection-v1.test.ts

Expected: FAIL because the projection module does not exist.

- [ ] **Step 3: Implement the exact D1 table and pure projection module**

~~~
CREATE TABLE agent_health_current_v1 (
  account_id TEXT NOT NULL, installation_id TEXT NOT NULL,
  last_accepted_epoch INTEGER NOT NULL, request_sequence INTEGER NOT NULL,
  server_sequence INTEGER NOT NULL, terminal_build INTEGER NOT NULL,
  source_symbol TEXT NOT NULL, terminal_connection_state TEXT NOT NULL,
  account_trade_permission TEXT NOT NULL, terminal_trade_permission TEXT NOT NULL,
  algo_trading_permission TEXT NOT NULL,
  PRIMARY KEY (account_id, installation_id)
);
~~~

Add a BEFORE DELETE trigger that aborts with agent_health_current_v1 cannot be deleted. The application may upsert the current record, but the migration never creates a credential, financial, price, order, or position column.

In agent-health-projection-v1.ts, make source_symbol equal to the first validated account_snapshot.symbols[0].source_symbol; the MT5 request is canonical and preserves array order. Export exactly:

~~~
export type HealthStateV1 = "ONLINE" | "STALE" | "OFFLINE" | "UNKNOWN";
export function projectAcceptedHeartbeatV1(request: AgentSyncRequestV1, serverSequence: number, receivedAtEpoch: number): AgentHealthProjectionV1;
export function deriveHealthStateV1(lastAcceptedEpoch: number | null, nowEpoch: number): HealthStateV1;
~~~

- [ ] **Step 4: Re-run focused verification**

Run: npm --prefix apps/execution-edge test -- agent-health-projection-v1.test.ts && npm --prefix apps/execution-edge run typecheck

Expected: PASS.

- [ ] **Step 5: Commit**

~~~
git add apps/execution-edge/migrations/0002_agent_health_current.sql apps/execution-edge/src/agent-health-projection-v1.ts apps/execution-edge/test/agent-health-projection-v1.test.ts
git commit -m "feat: project accepted MT5 health"
~~~

### Task 2: Persist health only after a newly accepted sync

**Files:**
- Modify: apps/execution-edge/src/index.ts
- Modify: apps/execution-edge/test/agent-sync-v1.test.ts

**Interfaces:**
- Consumes: projectAcceptedHeartbeatV1 from Task 1 and the existing agent_sync_audit_v1 result.
- Produces: writeAcceptedSyncAuditAndHealth(env, request, serverSequence, receivedAtEpoch): Promise<void>.

- [ ] **Step 1: Add failing Worker integration tests**

Extend the existing fake D1 collector to capture batch() statements. Assert all three outcomes:

~~~
expect((await route(validBody, "Bearer " + SECRET)).status).toBe(200);
expect(dbRuns).toHaveLength(2); // audit INSERT + health UPSERT

await route(conflictingBody, "Bearer " + SECRET);
expect(dbRuns.filter((run) => run.query.includes("agent_health_current_v1"))).toHaveLength(0);

await route(exactRetryBody, "Bearer " + SECRET);
expect(dbRuns.filter((run) => run.query.includes("agent_health_current_v1"))).toHaveLength(1);
~~~

The exact retry writes only its append-only audit outcome. It must not refresh last_accepted_epoch, because retransmitted data must never create a false online signal.

- [ ] **Step 2: Run the integration test to verify failure**

Run: npm --prefix apps/execution-edge test -- agent-sync-v1.test.ts

Expected: FAIL because accepted sync currently writes only agent_sync_audit_v1.

- [ ] **Step 3: Implement the fail-closed accepted write**

Replace the current one-statement audit helper with writeSyncAudit(...) and writeAcceptedSyncAuditAndHealth(...). For a coordinator result of OK with replayed === false, use env.EXECUTION_DB.batch() to run the audit insert and this parameterized upsert together:

~~~
INSERT INTO agent_health_current_v1 (...) VALUES (...)
ON CONFLICT(account_id, installation_id) DO UPDATE SET
  last_accepted_epoch = excluded.last_accepted_epoch,
  request_sequence = excluded.request_sequence,
  server_sequence = excluded.server_sequence,
  terminal_build = excluded.terminal_build,
  source_symbol = excluded.source_symbol,
  terminal_connection_state = excluded.terminal_connection_state,
  account_trade_permission = excluded.account_trade_permission,
  terminal_trade_permission = excluded.terminal_trade_permission,
  algo_trading_permission = excluded.algo_trading_permission;
~~~

If either statement fails, return the existing AGENT_SYNC_AUDIT_UNAVAILABLE 503 response; do not return a success acknowledgement. For EXACT_RETRY, rejection, malformed input, authorization failure, or coordinator failure, never upsert the health table.

- [ ] **Step 4: Re-run focused verification**

Run: npm --prefix apps/execution-edge test -- agent-sync-v1.test.ts agent-health-projection-v1.test.ts && npm --prefix apps/execution-edge run lint

Expected: PASS; every successful response still has mode: "DRY_RUN" and command: null.

- [ ] **Step 5: Commit**

~~~
git add apps/execution-edge/src/index.ts apps/execution-edge/test/agent-sync-v1.test.ts
git commit -m "feat: persist accepted MT5 health"
~~~

### Task 3: Create the isolated, read-only health-console API

**Files:**
- Create: apps/agent-health-console/package.json
- Create: apps/agent-health-console/tsconfig.json
- Create: apps/agent-health-console/vitest.config.ts
- Create: apps/agent-health-console/src/health-summary-v1.ts
- Create: apps/agent-health-console/src/index.ts
- Create: apps/agent-health-console/test/health-summary-v1.test.ts
- Create: apps/agent-health-console/test/worker.test.ts

**Interfaces:**
- Consumes: agent_health_current_v1 and agent_sync_audit_v1 through an AGENT_HEALTH_DB D1 binding and server-configured account/installation values.
- Produces: GET /api/v1/health-summary with HealthSummaryResponseV1; all other API methods return a no-store 405/404 response.

- [ ] **Step 1: Write failing summary and routing tests**

~~~
type HealthSummaryResponseV1 = {
  schema_version: "AgentHealthSummaryV1"; server_time_epoch: number;
  status: "ONLINE" | "STALE" | "OFFLINE" | "UNKNOWN";
  current: null | {
    last_accepted_epoch: number; request_sequence: number; server_sequence: number;
    terminal_build: number; source_symbol: string; terminal_connection_state: string;
    account_trade_permission: string; terminal_trade_permission: string;
    algo_trading_permission: string;
  };
  recent: readonly { request_sequence: number; result_code: string; server_sequence: number | null; received_at_epoch: number }[];
};
~~~

Test an online record, a 21-second stale record, a 61-second offline record, an absent record, a D1 read exception, and exactly 20 newest audit records. Assert POST /api/v1/health-summary returns 405 and the success response has neither account_id nor installation_id nor any forbidden data field.

- [ ] **Step 2: Run the new tests to verify failure**

Run: npm --prefix apps/agent-health-console test -- health-summary-v1.test.ts worker.test.ts

Expected: FAIL because the isolated Worker does not exist.

- [ ] **Step 3: Implement the minimal Worker and summary query**

Create an independent package using the execution-edge versions: TypeScript 5.9.3, Vitest 4.1.10, Wrangler 4.113.0, @cloudflare/workers-types 5.20260723.1; scripts are test, typecheck, and build.

In health-summary-v1.ts, accept nowEpoch, accountId, and installationId from server Env values only. Query with bound values, never client parameters:

~~~
SELECT last_accepted_epoch, request_sequence, server_sequence, terminal_build,
       source_symbol, terminal_connection_state, account_trade_permission,
       terminal_trade_permission, algo_trading_permission
FROM agent_health_current_v1
WHERE account_id = ? AND installation_id = ?;

SELECT request_sequence, result_code, server_sequence, received_at_epoch
FROM agent_sync_audit_v1
WHERE account_id = ? AND installation_id = ?
ORDER BY received_at_epoch DESC, request_sequence DESC
LIMIT 20;
~~~

Return UNKNOWN with current: null and recent: [] on no row or caught D1 exception. Do not leak database error text. index.ts handles only GET /api/v1/health-summary, sends cache-control: no-store, and contains no POST, PUT, PATCH, DELETE, MT5, broker, candidate, or order route.

- [ ] **Step 4: Re-run API verification**

Run: npm --prefix apps/agent-health-console test -- health-summary-v1.test.ts worker.test.ts && npm --prefix apps/agent-health-console run typecheck

Expected: PASS.

- [ ] **Step 5: Commit**

~~~
git add apps/agent-health-console/package.json apps/agent-health-console/package-lock.json apps/agent-health-console/tsconfig.json apps/agent-health-console/vitest.config.ts apps/agent-health-console/src apps/agent-health-console/test
git commit -m "feat: add private MT5 health API"
~~~

### Task 4: Render the static dashboard with safe polling

**Files:**
- Create: apps/agent-health-console/src/dashboard-html.ts
- Modify: apps/agent-health-console/src/index.ts
- Create: apps/agent-health-console/test/dashboard-html.test.ts

**Interfaces:**
- Consumes: same-origin GET /api/v1/health-summary response from Task 3.
- Produces: renderDashboardHtml(): string and GET / HTML with an ONLINE, STALE, OFFLINE, or UNKNOWN display.

- [ ] **Step 1: Write failing page-content tests**

~~~
const html = renderDashboardHtml();
expect(html).toContain('fetch("/api/v1/health-summary"');
expect(html).toContain("10_000");
expect(html).toContain("Manual refresh");
expect(html).toContain("ONLINE");
expect(html).toContain("STALE");
expect(html).toContain("OFFLINE");
expect(html).toContain("UNKNOWN");
expect(html).not.toMatch(/balance|equity|margin|position|order|broker server|bearer/i);
~~~

In the Worker test, assert GET / returns text/html; charset=utf-8 and does not call D1.

- [ ] **Step 2: Run the page test to verify failure**

Run: npm --prefix apps/agent-health-console test -- dashboard-html.test.ts worker.test.ts

Expected: FAIL because dashboard-html.ts does not exist.

- [ ] **Step 3: Implement the single-page UI**

Use plain semantic HTML/CSS/JavaScript with no third-party client dependency. The page has this content:

~~~
MT5 DRY_RUN Health
large state badge: ONLINE | STALE | OFFLINE | UNKNOWN
last accepted heartbeat / age
terminal connection and three permission states
terminal build, source symbol, request/server sequences
latest 20 redacted synchronization outcomes
Manual refresh button
~~~

Use textContent, never innerHTML, for every response-derived value. Call the same-origin endpoint once on load and on setInterval(loadSummary, 10_000). The manual button calls only loadSummary. A network or parse failure clears response-derived values and renders UNKNOWN; it does not retry faster than the next interval. The root route serves only this static HTML with cache-control: no-store.

- [ ] **Step 4: Re-run UI verification**

Run: npm --prefix apps/agent-health-console test -- dashboard-html.test.ts worker.test.ts && npm --prefix apps/agent-health-console run build

Expected: PASS; Wrangler produces a dry-run bundle only.

- [ ] **Step 5: Commit**

~~~
git add apps/agent-health-console/src/dashboard-html.ts apps/agent-health-console/src/index.ts apps/agent-health-console/test/dashboard-html.test.ts apps/agent-health-console/test/worker.test.ts
git commit -m "feat: render MT5 health dashboard"
~~~

### Task 5: Enforce dashboard isolation and document configuration

**Files:**
- Modify: scripts/verify-mt5-dry-run-boundary.mjs
- Modify: apps/execution-edge/test/mt5-dry-run-boundary.test.ts
- Create: apps/agent-health-console/wrangler.dry-run.jsonc
- Create: apps/agent-health-console/.gitignore
- Create: apps/agent-health-console/README.md

**Interfaces:**
- Consumes: the D1 ID in apps/execution-edge/wrangler.dry-run.jsonc; non-secret dashboard vars DASHBOARD_ACCOUNT_ID and DASHBOARD_INSTALLATION_ID.
- Produces: a dashboard-specific source safety report and no-secret deployment/Access runbook.

- [ ] **Step 1: Write failing source-safety tests**

~~~
expect(scanHealthDashboardSource('export default { fetch(){ return new Response("ok"); } };')).toEqual([]);
expect(scanHealthDashboardSource('const endpoint = "/api/v1/agent/sync";')).toContain("DASHBOARD_MT5_SYNC_REFERENCE_FORBIDDEN");
expect(scanHealthDashboardSource('function placeOrder() {}')).toContain("DASHBOARD_EXECUTION_REFERENCE_FORBIDDEN");
expect(scanHealthDashboardSource('export default { async fetch(){ return fetch("https://broker.example"); } };')).toContain("DASHBOARD_OUTBOUND_NETWORK_FORBIDDEN");
~~~

Also assert runBoundaryVerifier() scans apps/agent-health-console/src while its existing execution-edge and MT5 logic remain unchanged.

- [ ] **Step 2: Run the boundary test to verify failure**

Run: npm --prefix apps/execution-edge test -- mt5-dry-run-boundary.test.ts

Expected: FAIL because the dashboard scanner does not exist.

- [ ] **Step 3: Implement the scoped dashboard scanner**

Scan all .ts files under apps/agent-health-console/src. Reject case-insensitive references to /api/v1/agent/sync, OrderSend, CTrade, PositionClose, OrderModify, OrderDelete, placeOrder, closePosition, candidate, execution authority, and literal outbound http:// or https:// fetch URLs. Allow only the relative same-origin fetch("/api/v1/health-summary"). Keep execution-edge scanning behavior exactly intact.

- [ ] **Step 4: Add no-secret Wrangler configuration and README**

Create a config named prop-trading-agent-health-console-dry-run with workers_dev: true, preview_urls: false, one D1 binding AGENT_HEALTH_DB using database ID 9385395b-b713-4ae9-a690-82737a5daaff, and only these non-secret vars:

~~~
"DASHBOARD_ACCOUNT_ID": "account-local-001",
"DASHBOARD_INSTALLATION_ID": "windows-mt5-dryrun-001"
~~~

Do not configure an MT5 bearer, broker secret, Durable Object, candidate inbox, execution authority, or Workers secret. Ignore .dev.vars.

The README has the exact operator order: run tests and dry-run builds; deploy dashboard only after owner approval; in Cloudflare Zero Trust create a Worker Access application for the new dashboard workers.dev hostname; allow only Ameer’s approved email; test browser sign-in; do not apply Access to the execution-edge sync Worker.

- [ ] **Step 5: Re-run isolation verification**

Run: npm --prefix apps/execution-edge test -- mt5-dry-run-boundary.test.ts && node scripts/verify-mt5-dry-run-boundary.mjs && npm --prefix apps/agent-health-console run typecheck

Expected: PASS with no violations.

- [ ] **Step 6: Commit**

~~~
git add scripts/verify-mt5-dry-run-boundary.mjs apps/execution-edge/test/mt5-dry-run-boundary.test.ts apps/agent-health-console/wrangler.dry-run.jsonc apps/agent-health-console/.gitignore apps/agent-health-console/README.md
git commit -m "test: isolate private health dashboard"
~~~

### Task 6: Full verification and operator-only rollout checklist

**Files:**
- Modify: docs/runbooks/mt5-dry-run-agent-local-verification.md

**Interfaces:**
- Consumes: completed Tasks 1–5 and a healthy MT5 SYNC_OK heartbeat.
- Produces: reproducible evidence that the dashboard is private, read-only, and does not interrupt the existing DRY_RUN heartbeat.

- [ ] **Step 1: Add the dashboard evidence checklist**

Append these exact completion checks:

~~~
1. execution-edge accepts a fresh DRY_RUN heartbeat and writes one projection.
2. health summary returns ONLINE and no forbidden field names.
3. after 21 seconds without a fresh accepted heartbeat it returns STALE.
4. after 61 seconds without a fresh accepted heartbeat it returns OFFLINE.
5. a missing projection or D1 error returns UNKNOWN.
6. Cloudflare Access email sign-in succeeds for the approved operator and fails outside the policy.
7. MT5 still displays SYNC_OK after Access protects only the dashboard hostname.
8. Algo Trading remains disabled and no order appears in MT5.
~~~

- [ ] **Step 2: Run every automated verification command**

Run:

~~~
npm --prefix apps/execution-edge test
npm --prefix apps/execution-edge run lint
npm --prefix apps/execution-edge run typecheck
npm --prefix apps/execution-edge run build
npm --prefix apps/agent-health-console test
npm --prefix apps/agent-health-console run typecheck
npm --prefix apps/agent-health-console run build
node scripts/verify-mt5-dry-run-boundary.mjs
~~~

Expected: all checks pass; both Wrangler builds are dry-run bundles; the boundary verifier reports zero violations.

- [ ] **Step 3: Commit the final runbook**

~~~
git add docs/runbooks/mt5-dry-run-agent-local-verification.md
git commit -m "docs: verify private MT5 health dashboard"
git status --short
~~~

Expected: clean working tree.

- [ ] **Step 4: Request explicit deployment approval**

Do not deploy automatically. Present verified commits and test results, then ask Ameer for approval to perform exactly two Cloudflare state changes: deploy the new dashboard Worker and configure its Cloudflare Access email policy. Do not change execution-edge, the MT5 EA, its WebRequest allowlist, Algo Trading, or broker account.

## Explicitly deferred

- Dashboard alerts, notifications, historical charts, multi-account selection, role management, custom domain, custom login, data export, and any write endpoint.
- Reading or displaying financial data, prices, positions, orders, broker server/login, credentials, Pine/TradingView signals, candidate data, or execution state.
- Demo, challenge, funded, or live trading; MetaApi; Railway; order entry; modifying/closing an order; enabling Algo Trading; or changing any MT5 configuration.
