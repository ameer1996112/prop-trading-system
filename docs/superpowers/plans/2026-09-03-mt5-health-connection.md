# MT5 Health Connection Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development for bounded proxy work and spec/code review; integrate locally with test-driven-development. Preserve the existing worktree. No commits or remote mutations.

**Goal:** Read the existing private MT5 health feed inside the restored Dashboard and Accounts without exposing credentials or enabling execution.

**Architecture:** One shared strict wire validator feeds a fixed-origin local GET proxy and the browser loader. Access login is an explicit CLI startup step; browser connection is an explicit read opt-in. The existing session owns all polling. Health is independent of paper authentication and cannot populate financial or exposure data.

**Tech Stack:** Existing Next.js/React/TypeScript/Vitest and Node preview server; installed cloudflared; no new dependencies or remote services.

## Task 1 — Shared contract and state semantics

Files: new `apps/operations-console/src/features/tradeops/mt5-health-contract.mjs`, accompanying `.d.mts`, `mt5-health.ts`; new `tests/tradeops-mt5-health.test.ts`.

- [x] Write failing validation/age/loader tests, then run `npm test -- tests/tradeops-mt5-health.test.ts` (expected missing exports/behavior).
- [x] Implement `parseMt5HealthSummary(value)` returning only the exact `AgentHealthSummaryV1` fields; invalid schema/keys/enums/timestamps/unsafe integers/>20 records throw a generic error. Require 35/90 heartbeat status consistency, null-current UNKNOWN, no future timestamps, and newest-first audit timestamps. No financial fields permitted.
- [x] Implement `mt5HeartbeatAge(summary, receivedAtMs, nowMs)` using server time plus nonnegative local elapsed seconds and `mt5HeartbeatStatus` that cannot retain ONLINE when the accepted heartbeat ages out. Invalid local clock input yields UNKNOWN.
- [x] Implement `loadMt5Health(signal)` for same-origin `/api/v1/mt5-health-summary`, GET only, no credentials/headers/storage; bounded response/timeout, generic errors and distinct `Mt5AuthorizationError` on 401/403.
- [x] Re-run focused tests green. Example boundary: `expect(mt5HeartbeatStatus(summary, 1000, 37000)).toBe('STALE')` for a freshly accepted heartbeat.

## Task 2 — Explicit Access startup and private proxy

Files: new `scripts/mt5-health-access.mjs`, `scripts/mt5-health-proxy.mjs`; modify `scripts/tradeops-preview.mjs`; new `tests/tradeops-mt5-proxy.test.ts` and `tests/tradeops-mt5-access.test.ts`.

- [x] First test one fixed GET route, forbidden methods/queries/cross-site requests, missing/expired authentication, capture-only subprocess output, token isolation, redirects, byte/time limits and cancellation. Run these files to observe red.
- [x] Add `--mt5-health` startup flag alongside existing `--port`; preserve existing parsePort tests/interface. It explicitly obtains an Access application token for the hardcoded health origin using cloudflared, never a shell or per-request subprocess. Login is operator-completed; missing CLI/token yields safe AUTH_REQUIRED, no raw diagnostic output.
- [x] `createPreviewServer` receives a test-injectable health token/session; otherwise disconnected. One `/api/v1/mt5-health-summary` GET maps to the fixed private endpoint. Strip incoming authorization/cookies, use only process-owned Cf-Access-Token, reject redirects and clear token on auth rejection. No-store, six seconds, 128 KiB, strict parser, safe error JSON `{error:'AUTH_REQUIRED'}` or generic failure. Deduplicate concurrent health upstream reads; no background network timer.
- [x] Server close clears owned token and aborts work. Existing six routes retain their current behavior. Re-run new tests and `tradeops-preview.test.ts` green.
- [x] Spec review then code-quality review; fix important findings before completion.

## Task 3 — Session and familiar UI integration

Files: modify `session.ts`, `use-tradeops.ts`, `TradeOpsDashboard.tsx`, `TradeOpsShell.tsx`, `OriginalTopBar.tsx`; create `Mt5HealthPanel.tsx`; focused session/panel tests.

- [x] RED tests: no health request before opt-in; connect joins existing refresh; request dedupe; hidden/offline/abort behavior; unauthorized health clears only health; disconnect/dispose purge; late replies ignored; paper credentials never reach health loader.
- [x] Add optional `mt5` loader and `mt5` resource plus `mt5Connection` state (`DISCONNECTED`, `CONNECTED`, `AUTH_REQUIRED`). `connectMt5()` and `disconnectMt5()` only change local read state. Hook connect performs the guarded existing refresh; no second polling effect. Auth failure stops further health reads until explicit reconnect.
- [x] RED component tests for both destinations, a separate EA badge, correctly aging status, reported terminal/permission flags, recent result codes, no finance/position inference, auth instructions, disconnect clearing, mobile-fit structure.
- [x] Mount the compact panel on Dashboard and Accounts. Add optional EA status to shell/topbar with UNKNOWN default. Keep existing layout/navigation/paper labels. A local display timer may age the badge but must never fetch. Explain Access reconnect CLI without asking for a credential in chat.
- [x] Run focused tests green and fix compatibility regressions in existing fixtures without weakening their assertions.

## Task 4 — Verification and local handoff

Files: `docs/tradeops-preview.md`, new `docs/audits/2026-09-03-mt5-health-connection.md`.

- [x] Run independent spec and quality reviews on complete implementation; resolve important findings.
- [x] Run `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, and `git diff --check`; do not call an interrupted or failed run successful.
- [x] Verify installed cloudflared behavior through help/docs, then explicitly start local preview with `--mt5-health`. Ask operator to complete normal Access sign-in if needed; never print/capture the token. If auth remains unavailable, keep UI AUTH_REQUIRED and record that live integration is unverified.
- [x] Browser-check Dashboard/Accounts, connection/disconnection, errors and mobile layout. Record screenshots without credentials. Verify no legacy or mutation requests.
- [x] Document exact launch command, local trusted-machine boundary, Cloudflared cache caveat, auth expiration, source missing financial fields and unchanged DRY_RUN authority. Preserve local uncommitted work; no push/deploy/EA/database/Access-policy changes.

## Plan self-review

The four tasks cover wire truthfulness, credential isolation, bounded transport, single polling ownership, stale and late-response races, familiar UI, tests and honest live-verification limits. Startup login is the only new authentication operation; no remote infrastructure changes are authorized. Review stages are independent and implementation stays in the already approved local worktree.
