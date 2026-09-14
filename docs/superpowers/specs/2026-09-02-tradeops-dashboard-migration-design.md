# TradeOps dashboard migration — local preview

Date: 2026-09-02

Status: User approved the written design on 2026-09-02. Local preview completed and verified on 2026-09-03: task-level and final correction reviews passed; 467 tests, typecheck, lint and static build passed. Browser public/locked integration and desktop/mobile checks passed; protected production integration remains unverified without an operator-supplied credential. Nothing has been pushed, merged or deployed.

## Outcome

Restore the older project's recognizable TradeOps dashboard inside the current operations console. Reuse its layout and presentational components, adapting their data contracts to the current Cloudflare APIs. The first deliverable is a working local preview, not a production deployment or a claim of automated broker execution.

The user wants the older dashboard, not another redesign of the basic Paper Lab page. Preserve the original dark terminal styling, navigation, dense account cards, summary strip, tables, and detail inspector. Differences must be driven by truthful data, accessibility, or removal of unsupported dependencies.

## Source and isolation

- Target repository: `ameer1996112/prop-trading-system`.
- Target application: `apps/operations-console`.
- Target base: `528ad8f33324b9a254f74e1988367caf6d3a7cad`.
- Isolated branch: `codex/tradeops-dashboard-migration`.
- Donor repository: `ameer1996112/liquidity-supply-and-demand`.
- Donor revision: `cc740a197209cef27374ca6166a505b14af54ab6`.
- Donor components: `frontend/src/components/layout` and `frontend/src/components/dashboard`; root composition is `frontend/src/app/page.tsx`.

The donor repository and deployed release stay untouched. Check donor licenses and preserve required attribution before copying source or assets.

## Chosen approach

Port the actual TradeOps presentation into the current static-export application and place a small typed adapter between the current API models and the UI. This preserves recognizable styling while retaining the current request, authentication, and polling safeguards.

Copying the complete old frontend would reintroduce FastAPI, Supabase mock fallbacks, paid-service integrations, and broker mutation hooks. Restyling Paper Lab from scratch would not satisfy the request to reuse TradeOps. Neither is part of this migration.

## First preview scope

The dashboard includes the original shell, sidebar, top bar, summary strip, account strip, setup table, paper-position table, observation log, and selected-setup inspector. Account and strategy filters operate on available records. Search, loading, empty, locked, stale, and error states must be usable.

Provide read-only Accounts, Risk & Rules, Journal, and Analytics views using existing paper API data. Journal is explicitly a paper journal; Analytics describes only the scope of the returned data. Do not imply a complete lifetime ledger when the API returns a bounded window.

Keep other original navigation items visible but unavailable with a short reason when their backend is missing. Do not route them to broken pages or load old hooks to make them appear functional. Full parity with all legacy dashboard features is a later project.

Live-mode switches, broker order actions, account mutations, risk-policy edits, and paper mutations are disabled in this preview. There must be no active close-position, partial-close, stop/target-edit, or live-mode handler inherited from the donor components.

## Data mapping and meaning

| TradeOps surface | Current data source | Required meaning |
| --- | --- | --- |
| Service connection | `GET /health/live` | API availability and returned mode, not broker connectivity |
| Observation log | `GET /api/v1/observation-receipts` | Received observations, not fills or eligible setups |
| Setup table and inspector | `GET /api/v1/rd-entry-decisions` | Candidate evidence, eligibility, rejection reasons, model selection, and paper linkage |
| Account strip and Accounts | `GET /api/v1/paper-accounts`, joined by account ID to simulation summary | Paper identity, ledger balances, currency, scale, and separately sourced simulation statistics |
| Paper positions and Journal | `GET /api/v1/paper-simulations/summary` | Paper intents, allocations, states, settlements, and simulation account statistics |
| Risk & Rules | `GET /api/v1/paper-readiness` | Read-only paper readiness, reasons, and kill-switch state |
| Analytics and summary strip | Existing account aggregates and returned paper records | Explicit provenance and window; no broker performance claims |

Use existing validated response types and query limits. Protected data remains locked until the user supplies the existing operator credential. Public API availability alone cannot unlock it.

Missing balances, equity, PnL, win rate, or broker state display as unavailable, not zero. Zero is valid only when explicitly reported or correctly computed from a known complete domain. Respect currency scale and do not add different currencies together. A mixed-currency summary shows per-currency totals instead of one monetary number.

Do not use signal-derived synthetic positions when broker data is missing. The old fallback from missing Supabase configuration to mock signals or statistics is prohibited. Test fixtures are allowed only in automated tests or an explicitly labeled test harness, not as an ordinary preview fallback.

Retain distinction among observation, shadow-only evaluation, paper eligibility, opened paper intent, and settlement. Show rule failures, fidelity, entry model, setup identity, and linked intent when supplied. Never rename paper `READY` to permission for live trading.

## Component boundaries

1. **TradeOps presentation:** source-derived shell, navigation, cards, tables, and inspector accepting typed props. No network calls or credentials inside display components.
2. **Dashboard adapter:** converts current API records into explicit view models without inventing missing fields. Keeps units, source, and snapshot scope attached to metrics.
3. **Shared data/session controller:** owns bounded reads, polling, unlock/lock, stale states, and cancellation. Views consume the shared snapshot; they do not each add polling loops.
4. **Local preview transport:** serves the static export and forwards a fixed read-only route allowlist to the current observation Worker. It is development tooling, not production infrastructure.

Retain the target's current Next.js and React versions and `output: 'export'`. Copy only needed presentation dependencies and assets. Do not import the old standalone server configuration, `/backend` rewrite, Supabase client, trading-mode provider, AI copilot hooks, or market-stream hooks.

## Styling fidelity

Use the donor's existing visual system: near-black background, charcoal panels, subtle borders, amber accents, green/red outcomes, Inter-style UI typography, and monospace numbers. Preserve its compact desktop sidebar and account-card composition, with functioning mobile navigation and readable narrow-screen tables.

Reuse the source layout rather than inventing a new visual direction. Add visible keyboard focus, appropriate labels, and sufficient contrast where needed. Connection text says API online or offline; it must not use the old generic LIVE label to imply an attached broker.

## Request and credential safeguards

Preserve the existing six-second bounded request/body timeout, caller cancellation, at most two GET attempts, and no automatic POST retries. Poll at the existing 30-second cadence only while visible and online. Share reads across mounted views and request only data needed by the current session; do not add per-row or per-panel timers.

Keep the operator credential in tab memory only. Never put it in URLs, local storage, logs, source, build output, or screenshots. Locking clears protected data and cancels requests; session-generation checks prevent an older request from restoring data after lock. Public results may remain visible with their own timestamps.

During hidden/offline/error periods, show last-success timestamps and stale status. Resume with one refresh when appropriate rather than overlapping catch-up requests. An unauthorized response must not become a blank success or mock data.

## Local preview transport

The current Worker does not expose cross-origin browser access. Do not change production CORS to support this preview.

Use a loopback-only preview server that serves the static export and forwards only the six distinct GET routes listed above to `https://prop-trading-observation-edge.ameer-1996112.workers.dev`. Validate paths, supported query parameters and their bounds, loopback Host, and browser Origin when present. Reject other API routes, mutation methods, arbitrary upstream destinations, redirects, and filesystem traversal. Bound upstream response size and time.

Bind to loopback, not all network interfaces. Do not forward browser cookies or unrelated headers. Forward the existing authentication header only for the protected allowlisted routes, only after user entry; do not discover stored credentials. Disable sensitive request logging. The transport is not included in the deployed static bundle and cannot submit a trade or alter an account.

The future production UI would use same-origin Worker APIs. Deploying it requires a separate decision after preview acceptance.

## Supabase and cost boundaries

The older Supabase database is preserved, with no reads, writes, schema changes, credential discovery, or historical imports in this phase. Explain in the UI that legacy history is not connected; do not conflate it with current paper records. A historical adapter requires its own authorization and provenance design later.

No Railway, MetaAPI, AI API, paid market feed, or paid infrastructure is introduced. Reuse the existing API and conservative polling. This design does not promise unlimited usage or change the user's Cloudflare plan.

## Acceptance and verification

- Unmodified target frontend baseline: 139 tests passed across 11 files before this migration.
- Adapter tests cover unavailable versus zero, currency scaling and mixed currencies, bounded-window metrics, and paper versus broker status.
- Interaction tests cover account/strategy filters, inspector selection, navigation, locked/empty/error states, and disabled controls.
- Preserve authentication purge, session-race, abort, visible/online polling, stale recovery, and existing request-reliability tests.
- Transport tests reject mutations, unlisted paths, invalid origins/hosts, redirects, oversized responses, invalid limits, and traversal; verify credentials are not logged or forwarded elsewhere.
- Static export builds successfully with no old server rewrites or paid-service dependencies.
- Compare the implemented dashboard with the pinned donor's actual component/layout reference at desktop and mobile sizes. Inspect screenshots and console/network errors.
- Verify an unlocked preview uses only allowlisted GET requests. Without a credential, protected panels remain locked; do not claim authenticated integration testing if no credential was supplied.
- Confirm no production deploy, broker action, Supabase access, schema migration, or secret change occurred.

## Explicit non-goals

No Pine changes, strategy-rule changes, position-sizing changes, MT5 or EA changes, TradingView alert edits, broker execution, database migration, Cloudflare bindings/secrets changes, or production deployment. No promise that dashboard availability proves trade execution or strategy profitability.

## Handoff gate

After the user reviews this written design, create the implementation plan and build the local preview on the isolated branch. Present the actual preview with verification results and remaining unavailable integrations. Request separate authorization before pushing/merging or deploying; do not replace the user's deployed dashboard during preview work.
