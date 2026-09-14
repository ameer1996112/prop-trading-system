# Restored TradeOps — read-only MT5 health connection

Date: 2026-09-03

Status: approved for local implementation by the user's “ok lets continue” on 2026-09-03. Discovery found that the existing service cannot provide account financial and exposure fields; this first implementation is explicitly health-only. Deployment and EA changes remain out of scope.

## Evidence and limits

- Destination: existing `codex/tradeops-dashboard-migration` worktree, HEAD `18e29ce68d9e9fc89311163e95dd2b71f040c527`, including the user's uncommitted frontend restoration. Preserve all of it.
- Historical integration source: `codex/mt5-stale-payload-recovery`, revision `8a80142`. Relevant files are `apps/agent-health-console/src/health-summary-v1.ts`, `apps/execution-edge/src/agent-health-projection-v1.ts`, and `mt5/TradeOpsAgent/Include/TradeOpsSync.mqh`. Do not merge that branch or copy its execution service into the frontend branch.
- A read-only public health request to the existing execution Worker returned `ok: true`, `DRY_RUN_AGENT_SYNC`, agent sync enabled, candidate inbox disabled, execution authority disabled, and execution ceiling `DRY_RUN`. This proves the reported Worker mode, not a current EA heartbeat or broker connection.
- An unauthenticated GET to the existing health-summary endpoint returned HTTP 302 to the account's Cloudflare Access login. No redirect was followed and no credential was read. This is evidence of a login challenge, not a complete Access-policy audit or authenticated API compatibility test.
- The source `AgentHealthSummaryV1` contains last accepted heartbeat, terminal build, source symbol, terminal connection/permission flags, sequences, and up to 20 redacted sync outcomes. It does not return account login/server/demo identity, balance, equity, or positions.
- The historical EA source explicitly sends null financial values and empty order/position arrays. Those arrays are placeholders, not proof of no broker exposure. The currently installed Windows binary has not been independently matched to this source.

## Approaches

1. **Recommended: adapt the existing private health read into the restored frontend.** Keeps the familiar interface and existing remote services, adds no execution authority, and requires no Worker deployment or EA change. Account financial/exposure data remains unavailable.
2. **Expand EA telemetry and its private read API now.** Can eventually supply verified demo identity, balances and positions, but needs installed-EA source/build verification, schema/privacy decisions, tests, and separately approved rollout. It exceeds this initial non-invasive connection step.
3. **Keep the old health dashboard as a separate link.** No adapter work, but leaves the user with two interfaces and does not achieve the integrated dashboard request.

## Selected implementation boundary

Implement option 1 locally after scope approval. Extend only `apps/operations-console` and its documentation/tests. Keep the restored layout; add a compact MT5 health section to Dashboard and Accounts, and separate EA status from the existing observation-API badge. No redesign or new dashboard destination.

Show last accepted sync time and age, heartbeat freshness, terminal connection, account/terminal/Algo Trading permission flags, terminal build, source symbol, and a recent synchronization timeline. Label permission flags as reported diagnostics, never trading authority. Show rejected result codes without inventing explanations absent from the source. Do not label a heartbeat as a fill or a confirmed demo-account identity.

Keep broker balance/equity, account login/server, positions, and trade journal unavailable with a specific explanation: this health feed does not supply them. Existing paper accounts/positions remain distinctly labeled and are never joined to an MT5 account based on guessed IDs or matching symbols.

## Private transport and authentication

- Add one fixed same-origin local GET route, `/api/v1/mt5-health-summary`, mapping only to `https://prop-trading-agent-health-console-dry-run.ameer-1996112.workers.dev/api/v1/health-summary`. No query parameters, arbitrary upstreams, account selectors, or redirect following.
- Preserve the six existing observation/paper routes and their credential rules. Never forward the paper operator credential, browser cookies, or an EA bearer to the MT5 health service.
- Use the operator's existing Cloudflare Access identity through the installed `cloudflared` CLI, not a new service token or changed Access policy. An explicit local startup authentication option obtains the application token with captured subprocess output; never print the token, pass it through shell interpolation/command arguments, or return it to the frontend. Login may require the operator to complete the normal browser sign-in. Do not extract browser cookies or bypass the login boundary.
- The preview process holds its copy in memory and sends it only to the fixed health origin in `Cf-Access-Token`. Cloudflared may maintain its normal local authentication cache; do not claim authentication is wholly memory-only or delete unrelated cache entries. No new repository token file or browser storage is introduced.
- Token acquisition happens only through the explicit startup action, not a GET handler or polling timer. Failed or expired authentication yields a named local `AUTH_REQUIRED` state; stop authenticated polling until the operator reconnects. Do not recursively launch login from failed requests.
- Preserve loopback binding, Host/Origin/Sec-Fetch-Site defenses and no-store responses. Apply a six-second timeout, a 128 KiB health-response limit, JSON/schema validation, and redacted errors. Local shutdown clears process-owned credentials. Document that a trusted local machine/process boundary is required; this is not a multi-user hosted authentication design.

Cloudflare documents application-token retrieval and the `Cf-Access-Token` header in its [CLI Access guidance](https://developers.cloudflare.com/cloudflare-one/tutorials/cli/). Validate the installed CLI behavior in implementation; an incompatible or unsuccessful login must fail closed, without policy changes.

## State and refresh

Integrate the health read into the existing single visible/online 30-second refresh owner. No one-second network timer and no new EA polling. At most one additional read per cycle when explicitly connected; deduplicate concurrent manual/automatic refreshes. This nominally adds at most 2,880 reads/day if visible continuously, excluding manual refreshes/retries; it is not an account-wide free-tier guarantee.

Keep authentication, fetch success/failure, payload validity, accepted-heartbeat age, and terminal connection as distinct facts. Accept only the versioned, bounded schema; reject invalid timestamps, unsafe integers, unexpected state values and inconsistent status. The inspected implementation uses online through 35 seconds, stale through 90 seconds, then offline; an older design document says 20/60. Treat that discrepancy explicitly: validate the deployed response before pinning compatibility, and do not silently substitute the old document's thresholds.

Age the last accepted heartbeat using the server response clock plus elapsed local time; never keep an old ONLINE badge merely because a response is cached. A rejected sync must not advance the accepted-heartbeat timestamp. On network failure retain last-known permitted data with a visible stale/error label and timestamp. Authentication failure or disconnect clears private health data, selection and pending requests; late responses cannot repopulate it. Never display raw upstream HTML, token-bearing redirects or stack traces.

## Verification and handoff

- Test valid/invalid payloads, null current state, maximum history, time boundaries, clock skew, permission distinctions, stale/rejected syncs, and missing account financial/exposure data.
- Test fixed-origin/path routing, denied methods/queries, forbidden cross-site requests, bounds/timeouts, token isolation, no redirects, no credential logging and authentication expiration.
- Test single-owner polling, hidden/offline behavior, aborts, authentication purge, concurrent refresh deduplication and late-response races.
- Preserve the existing 503-test restoration baseline. Run focused tests, full tests, typecheck, lint, static build and diff checks; independently review the authentication/data boundary.
- Browser-check Dashboard/Accounts, mobile layout and error/locked states. Verify real health only after the operator completes Access sign-in; fixtures and public Worker health are not proof of an active EA connection.
- Keep work local and uncommitted. Do not push, merge, deploy, apply migrations, change bindings/secrets/Access policies, modify TradingView/Pine, change EA/MT5 configuration, or perform broker actions.

## Self-review and next gate

This is one health-read adapter, not account telemetry, signal execution or journaling. Source gaps and authentication requirements are explicit. The user reviews this written scope before an implementation plan. Full account telemetry is a separate follow-up after the installed EA source/build and required privacy/precision fields are verified.
