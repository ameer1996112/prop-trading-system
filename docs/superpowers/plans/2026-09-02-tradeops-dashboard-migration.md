# TradeOps Dashboard Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a local, read-only preview of the older TradeOps dashboard using current Cloudflare paper and observation data, without changing deployed services or the older Supabase database.

**Architecture:** Port source-derived presentation into the existing static Next.js console. A typed adapter and a single session controller supply all views. A loopback-only, fixed-upstream GET proxy enables local preview without changing production CORS.

**Tech Stack:** Existing Next.js 16.2.11, React 19.2.8, TypeScript, Vitest, Testing Library, Node 22+ HTTP server; donor-derived CSS and Lucide icons. No new server-side runtime is deployed.

---

## Authority and workspace

Approved spec: `docs/superpowers/specs/2026-09-02-tradeops-dashboard-migration-design.md`.

All target paths below are relative to:
`/Users/ameeramer/.config/superpowers/worktrees/prop-trading-system/tradeops-dashboard-migration`.

Work only on `codex/tradeops-dashboard-migration`, based on `528ad8f33324b9a254f74e1988367caf6d3a7cad`. The spec was committed as `3fb990b` before this plan. Existing baseline: 139 frontend tests passed in 11 files; the feature worktree was clean before plan edits.

The read-only donor is:
`/Users/ameeramer/.config/superpowers/worktrees/liquidity-supply-and-demand/prop-pine-v3-production-consolidation`, at `cc740a197209cef27374ca6166a505b14af54ab6`.

Follow the donor's AGENTS.md when inspecting it: announce the Frontend module, 1–3 exact files, and expected findings; read large files in at most 200-line sections. Do not start its backend or access its environment files. The target has no scoped AGENTS.md discovered during planning.

Use `apply_patch` for source and documentation edits. Request narrow filesystem escalation for this worktree as needed. Stage exact task files only. No push, PR, merge, deployment, migrations, secret changes, Supabase requests, TradingView edits, EA edits, or broker actions.

## File responsibilities

All paths in this table start with `apps/operations-console/` unless stated otherwise.

| File | Responsibility |
| --- | --- |
| `src/lib/api.ts` | Preserve bounded requests; add a recognizable authentication error without changing current error text |
| `src/lib/entry-decisions.ts` | Expose strict protected decision loading while preserving existing fallback loader behavior |
| `src/features/tradeops/ledger-api.ts` | Strict parser and bounded GET for paper account projections |
| `src/features/tradeops/model.ts` | Pure currency-aware, provenance-aware data selection and metrics |
| `src/features/tradeops/session.ts` | Snapshot state, credential lifetime, cancellation, stale state, and refresh deduplication |
| `src/features/tradeops/use-tradeops.ts` | React subscription and one existing visible/online polling timer |
| `src/features/tradeops/navigation.ts` | Original navigation groups and explicit feature availability |
| `src/features/tradeops/TradeOpsShell.tsx` | Source-derived sidebar, mobile navigation, top bar, and readonly mode controls |
| `src/features/tradeops/AccountStrip.tsx` | Source-derived selectable paper account cards |
| `src/features/tradeops/AggregateBar.tsx` | Source-derived metrics strip with scoped, currency-separated metrics |
| `src/features/tradeops/SetupTable.tsx` | Search/filter/select entry decisions, no trade submission |
| `src/features/tradeops/SetupInspector.tsx` | Selected decision, evidence, model reasoning, and paper linkage |
| `src/features/tradeops/PaperViews.tsx` | Paper positions, journal, analytics, readonly risk, and accounts views |
| `src/features/tradeops/TradeOpsDashboard.tsx` | Composition and local navigation/filter state; only consumer of the session hook |
| `src/features/tradeops/tradeops.module.css` | Source-derived styles, focus states, responsive layout |
| `src/app/page.tsx`, `src/app/layout.tsx` | New root composition and accurate metadata |
| `scripts/tradeops-preview.mjs` | Local static server and fixed GET-only forwarding |
| `tests/tradeops-*.test.ts[x]` | Adapter, session, interaction, transport, and safety regression tests |
| Repository-root `docs/tradeops-preview.md` | Local launch instructions, data meaning, disconnected features |
| Repository-root `docs/audits/2026-09-02-tradeops-preview-verification.md` | Actual verification evidence, source provenance, and limitations |

Keep existing FoundationDashboard, PaperSimulationPanel, EntryDecisionPanel, API mutation helpers, and their tests intact. Do not mount legacy mutation panels within TradeOps. Use scoped CSS so the existing components are not accidentally restyled or behaviorally changed.

## Task 1: Verify provenance and capture the original layout contract

**Files:** Read donor `frontend/src/app/page.tsx`, `frontend/src/components/layout/AppShell.tsx`, `frontend/src/components/layout/Sidebar.tsx`, `frontend/src/components/layout/TopBar.tsx`, `frontend/src/components/dashboard/AccountStrip.tsx`, `frontend/src/components/dashboard/AggregateBar.tsx`, and `frontend/src/app/globals.css` in announced batches. Create the verification audit file above.

- [x] Verify exact source revision and clean status with `git rev-parse HEAD` and `git status --short` in the donor worktree. Check component headers and root license candidates using targeted paths. Record source provenance and any applicable attribution; do not assume third-party assets are unlicensed or freely copyable.
- [x] Record the actual shell geometry: expanded sidebar 224px, collapsed 56px, main top bar 64px, sidebar brand row 48px, content maximum width 1800–2000px, dense numeric tables, compact responsive account-card grid (2/3/4/5 columns with gap-2), selected-row inspector. Reuse these structural choices, not a new dashboard redesign. Task 1 source inspection corrected the earlier generic 48px header and horizontal-strip claims.
- [x] Record the source visual tokens, using the following target-scoped declarations as the port contract:

```css
.root {
  --to-bg: #080b10;
  --to-surface: #0d1117;
  --to-surface-raised: #161b22;
  --to-border: #21262d;
  --to-text-primary: #e6eaf0;
  --to-text-secondary: #8b95a5;
  --to-warning: #f0b90b;
  --to-long: #0ecb81;
  --to-short: #f6465d;
  --to-info: #3b82f6;
  background: var(--to-bg);
  color: var(--to-text-primary);
  min-height: 100dvh;
  font-family: Inter, system-ui, sans-serif;
  font-size: 13px;
}
```

- [x] Document exclusions: donor live mode setter, broker position mutations, old `/backend` proxy, Supabase/mock hooks, market streams, copilot, and fabricated signal-derived positions.
- [x] Commit only the provenance audit. Do not start either old or current execution service.

Task 1 completed in `d2d7f7f` and `d2701537`; separate spec and quality reviews passed. Main-agent baseline rerun: 139 tests passed in 11 files. No application code was changed by Task 1.

## Task 2: Add strict read-only account and decision APIs

**Files:** Create `src/features/tradeops/ledger-api.ts`, `tests/tradeops-ledger-api.test.ts`. Modify `src/lib/api.ts`, `src/lib/entry-decisions.ts`; extend their existing tests.

- [x] Write failing parser tests for the exact wire format returned by `listPaperAccounts` in `apps/observation-edge/src/index.ts`:

```ts
const wire = {
  mode: "PAPER_ONLY", count: 1,
  items: [{ schema_version: "1.0", account_id: "paper-a", mode: "PAPER_ONLY",
    label: "Paper A", currency_code: "USD", currency_scale: 2,
    opening_balance_minor: 1000000, ledger_delta_minor: 0,
    balance_minor: 1000000, last_sequence: 0,
    created_at: "2026-09-02T09:00:00Z" }],
};
```

Both the account mode and outer mode must be `PAPER_ONLY`, as verified against `PaperAccountProjection` in the backend types. Reject count mismatch, duplicate account IDs, non-safe integers, invalid currency/scale, invalid timestamps, and inconsistent opening balance plus ledger delta; compare the balance equation using BigInt to avoid intermediate overflow. Preserve zero and negative valid balances. Do not compute simulation PnL from ledger deltas.

- [x] Run `npm test -- tests/tradeops-ledger-api.test.ts` in the console and observe the missing-feature failure before implementation.
- [x] Implement the typed `PaperLedgerAccount` projection with camel-case fields and `loadPaperLedgerAccounts(credential, signal)`. Use `fetchBounded('/api/v1/paper-accounts?limit=200', signal, { Authorization: 'Bearer ' + credential })` and `parseStrictResponse`; no raw unbounded `fetch` or new retries.
- [x] Add this exact error class to `src/lib/api.ts` and use it for protected HTTP 401 responses, retaining the message expected by existing tests:

```ts
export class PaperAuthorizationError extends Error {
  constructor() {
    super("Paper operator credential was rejected.");
    this.name = "PaperAuthorizationError";
  }
}
```

- [x] Expose `loadEntryDecisionsStrict(credential, signal)` in `entry-decisions.ts`, using the existing private `parseReport`. It throws `PaperAuthorizationError` on 401 and a fixed safe unavailable error on other non-200 responses. The existing `loadEntryDecisions` delegates to the strict function inside its current try/catch and returns the existing ERROR snapshot, preserving compatibility.
- [x] Test strict 401 rejection, original fallback behavior, malformed reports, safe query bounds, and cancellation. All API calls remain GET.
- [x] Run `npm test -- tests/tradeops-ledger-api.test.ts tests/entry-decisions-api.test.ts tests/paper-simulation-api.test.ts tests/bounded-response.test.ts`; then commit the exact API and test files.

Task 2 completed in `484dc5b`; independent spec and code-quality reviews passed. Main-agent verification: 161 targeted tests and TypeScript checks passed.

## Task 3: Build provenance-aware selectors and metrics

**Files:** Create `src/features/tradeops/model.ts`, `tests/tradeops-model.test.ts`.

- [x] Write failing tests for missing-versus-zero and per-currency grouping. Use actual `PaperSimulationAccount` and `PaperSimulationIntent` types from `src/lib/api.ts` and `EntryDecisionItem` from `src/lib/entry-decisions.ts`.

```ts
expect(formatMinor(null, "USD", 2)).toBe("—");
expect(formatMinor(0, "USD", 2)).toBe("USD 0.00");
expect(formatMinor(-125, "USD", 2)).toBe("USD -1.25");
expect(formatMinor(123, "JPY", 0)).toBe("JPY 123");
expect(formatMinor(12345, "KWD", 3)).toBe("KWD 12.345");
```

- [x] Implement exact minor-unit formatting without floating-point rounding for safe integer minor values:

```ts
export function formatMinor(value: number | null, currency: string, scale: number): string {
  if (value === null || !Number.isSafeInteger(value) || !Number.isInteger(scale) || scale < 0 || scale > 8) return "—";
  const sign = value < 0 ? "-" : "";
  const digits = BigInt(value).toString().replace("-", "").padStart(scale + 1, "0");
  const amount = scale === 0 ? digits : `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
  return `${currency} ${sign}${amount}`;
}
```

- [x] Define and test `selectIntents(intents, accountId, model, query)`: account filtering uses `allocations[].accountId`, model filtering uses `selectedEntryModel`, query matches symbol/intent/setup ID, preserving source ordering. A null account/model means all, not an inferred default.
- [x] Label the model filter Entry model, not Strategy: the current API provides BOC/DIR_CLOSE/HTF_FLIP models but no generic strategy catalog. Keep the donor's Strategy navigation unavailable with a reason instead of inventing selectable strategies.
- [x] Define and test `selectDecisions(decisions, intents, accountId, model, query)`: account attribution uses an explicit matching `paperIntentId` and its allocations. With an account selected, unlinked decisions are excluded with UI explanation; never invent account ownership for rejected or unallocated setups. Model filtering uses `selection.canonicalModel`.
- [x] Build account view models from the union of ledger and simulation IDs. Keep ledger balance and simulation balance as separate named values. A missing half of the join stays null. Do not silently overwrite one balance with the other.
- [x] Calculate win rate only when settled trade count is greater than zero. Separate source-provided account aggregates from metrics computed over the loaded intent window. Group monetary totals by both currency code and scale; use BigInt sums or refuse unsafe totals. Never create one mixed-currency total.
- [x] Test window counts, empty loaded windows, unknown equity, conflicting scales, missing account joins, and shadow-only decisions with no paper intent. Run `npm test -- tests/tradeops-model.test.ts`, then commit these two files.

Task 3 complete at `a453d09`; independent spec and quality reviews passed. Spec reviewer independently verified 42 model tests and the full 276-test console suite.

## Task 4: One data session with tab-memory credentials

**Files:** Create `src/features/tradeops/session.ts`, `src/features/tradeops/use-tradeops.ts`, `tests/tradeops-session.test.ts`, `tests/tradeops-polling.test.tsx`.

- [x] Define a `TradeOpsSnapshot` containing independent resource states for health, receipts, ledger accounts, simulation summary, readiness, and decisions. Each resource has nullable data, last-success timestamp, loading/stale flags, and fixed safe error text. No credential is present in any snapshot.
- [x] Write deferred-promise tests before the controller: start a protected read, lock, resolve the old promise, and assert protected data remains null. Repeat for credential A replaced by B. Test that parallel refresh requests share one in-flight cycle.
- [x] Implement `createTradeOpsSession()` with `getSnapshot`, `subscribe`, `refresh`, `unlock`, `lock`, `pause`, and `dispose`. Credentials remain in its closure, never in returned state. `unlock` validates length 1–1024 and clears old protected state before incrementing the session generation. `lock` also aborts and clears all protected state synchronously.
- [x] A refresh starts two public reads; an unlocked refresh also starts the four protected reads. Maintain one AbortController and generation per cycle. Apply a result only if its generation is current and it was not aborted. An authentication error from any protected endpoint locks all protected data; a transient error retains only previously successful data and marks it stale. A newer failure is never represented as a new successful timestamp.
- [x] `pause` aborts requests, advances the generation, and marks snapshots stale without deleting legitimate last-known data. `dispose` performs lock/abort and removes subscriptions. Filter or view changes do not invoke refresh.
- [x] Build the hook using a stable session instance and React `useSyncExternalStore`. Use existing `startVisiblePolling` once at 30,000ms, passing `refresh` and `pause`; clean up polling and session on unmount. Ensure React StrictMode setup/cleanup/setup can resume correctly rather than reusing a permanently disposed controller.
- [x] Test hidden initial mount, offline pause, exactly one recovery refresh despite duplicate events, unmount cleanup, repeated manual refresh, partial endpoint failure, unauthorized clearing, and no secrets in serialized snapshots.
- [x] Run `npm test -- tests/tradeops-session.test.ts tests/tradeops-polling.test.tsx`; then run the existing dashboard/paper-simulation tests. Commit only the new controller, hook, and tests.

Task 4 complete at `81d8bb6`; independent spec and quality reviews passed. Independently verified 42 targeted/regression tests, typecheck, and scoped ESLint. Hook cleanup locks/aborts rather than terminally disposing the controller so StrictMode can resume; actual unmount purge is tested.

## Task 5: Port the TradeOps shell and account presentation

**Files:** Create `navigation.ts`, `TradeOpsShell.tsx`, `AccountStrip.tsx`, `AggregateBar.tsx`, `tradeops.module.css` under `src/features/tradeops`; create `tests/tradeops-shell.test.tsx`. Modify package/lock only for individually necessary presentation dependencies.

- [x] Write rendering tests before porting: TradeOps brand, grouped navigation, keyboard-focusable available views, unavailable items with reasons, collapsed sidebar labels, mobile menu, API status distinct from broker state, and no enabled LIVE/close-order control.
- [x] Preserve the donor's exact navigation group order: Overview, Trading, Monitoring, Analytics, Automation, Strategy, Ops. Active preview views are Dashboard, Accounts, Risk & Rules, Analytics, Journal. All other original items are visibly unavailable; render native disabled buttons plus adjacent explanatory text, not broken links.
- [x] Port layout markup and classes from donor AppShell/Sidebar/TopBar into props-only target components. Translate utility classes into the scoped stylesheet rather than importing all legacy providers. Keep local sidebar collapse/mobile state; keep API polling out of shell components. Mobile navigation uses an accessible toggle and Escape/selection closes it; keyboard focus returns to the toggle.
- [x] Retain the original branded icon style using only needed Lucide imports. If the existing donor-pinned package is reused, install an exact compatible version and record it in the lockfile; inspect package metadata and license first. Do not add the old complete dependency tree or downgrade Next/React. Preserve licensed local font assets when available; never require Google Fonts network calls for the preview.
- [x] Port the account strip and aggregate strip presentation, substituting Task 3 view models. Label cards PAPER; omit fabricated equity bars and prop-firm status. Show separate ledger/simulation balances when both exist. Summary values include their source/window label. Use text alongside status colors.
- [x] Add scoped focus-visible styling, reduced-motion support, horizontally scrollable tables and responsive account cards, and layout breakpoints at 768px and 1280px. Make unavailable text readable rather than inheriting the donor's lowest-contrast dim text.
- [x] Run `npm test -- tests/tradeops-shell.test.tsx`, `npm run typecheck`, and `npm run lint`. Commit only presentation/dependency/test files.

Task 5 complete at `f31e925`; independent spec and quality reviews passed. 22 shell tests verified independently; implementer reports 320 full-suite tests. Main also ran normal `npm run typecheck` and `npm run lint` successfully. Browser fidelity remains Task 9.

## Task 6: Setup table and evidence inspector

**Files:** Create `SetupTable.tsx`, `SetupInspector.tsx`, `tests/tradeops-setups.test.tsx`; extend the scoped stylesheet.

- [x] Write interaction tests for actual source records: search EURUSD, switch entry model, select a row, inspect a rejected reason, retain shadow-only status, and show a linked paper intent. Use complete typed fixtures adapted from `tests/entry-decision-panel.test.tsx`; keep fixtures under tests only.
- [x] Port the donor SignalTable/SignalInspector presentation after inspecting those exact files in an announced Frontend batch. Use `EntryDecisionItem`, not legacy Supabase signal types. Columns: evaluated UTC, symbol, direction, selected model, fidelity, effective action, reason, paper link. Include the underlying reason code in readable detail, not just a colored badge.
- [x] The inspector is a selected-record region with a close button. Include all candidate models, matched/blocked/rejected state, passed/failed rule IDs, proof plane, replayability, parity, co-trigger models, trade-plan ticks and tick size, actual paper price fields when supplied, and shadow outcome. Use the existing EntryDecisionPanel rendering for preserved reasoning where it can accept a single-item snapshot without polling; do not remove details simply to fit the older design.
- [x] State clearly that plan ticks are not broker fill prices. Do not convert candidate presence, a receipt, or PAPER_ELIGIBLE into a filled order. Derive selection from current snapshot by ID so locking/removal clears the inspector rather than retaining copied sensitive records.
- [x] Run `npm test -- tests/tradeops-setups.test.tsx tests/entry-decision-panel.test.tsx` and commit only setup presentation/tests/styles.

Task 6 complete at `7be2bfa`; independent spec and quality reviews passed. Main independently ran the 17 setup/existing-panel tests successfully. Typecheck and scoped lint passed; paper links resolve within the inspector instead of assuming an intent row is mounted.

## Task 7: Read-only views and root integration

**Files:** Create `PaperViews.tsx`, `TradeOpsDashboard.tsx`, `tests/tradeops-dashboard.test.tsx`, `tests/tradeops-safety.test.ts`. Modify `src/app/page.tsx`, `src/app/layout.tsx`, and scoped styles.

- [x] Write full-dashboard tests with mocked network loaders, not mocked shell/panels. Assert the locked initial view, credential entry clearing after submit, explicit unlock failure, account/model/search filtering, navigation without extra polling, paper journal, readiness reasons, and unknown broker/Supabase state.
- [x] Implement paper positions from OPEN intents and paper journal from SETTLED intents only. Retain entry/stop/target decimal strings, allocations, source, model, exit reason, and settlement timestamp. No mutation buttons. Display that the list is the latest returned window, at most 50 intents, not an exhaustive ledger.
- [x] Implement Accounts using the joined account view models; Risk & Rules using the returned readiness state, thresholds, reasons, per-account reasons, and readonly kill-switch state. READY must be labeled paper readiness. Analytics uses returned account aggregates with clearly scoped per-currency summaries and loaded-window counts; no synthetic equity curve or reconstructed broker performance.
- [x] Compose the session once in TradeOpsDashboard. Public observation log remains available when locked and shows source TEST/TRADINGVIEW/OTHER, receipt time, symbol, feed, kind, sequence, and status. The log is account-independent; explain this when an account filter is active.
- [x] Use a password input with an accessible label for the operator credential. Clear the input upon submit and lock; pass the value to the session only. Do not prefill from localStorage, environment, browser cookies, or copied deployment secrets. Add a visible lock button and last-success/stale indicators.
- [x] Replace root composition with:

```tsx
import { TradeOpsDashboard } from "../features/tradeops/TradeOpsDashboard";

export default function Home() {
  return <TradeOpsDashboard />;
}
```

- [x] Change only metadata text in layout to `TradeOps · Paper Operations` with a description that identifies read-only paper/observation data. Preserve the existing strict static-export configuration. Keep old components and tests intact.
- [x] Add static safety tests over the new feature module: no imports of mutation helpers, no `/backend`, Supabase, MetaAPI, Railway, storage writes, or embedded credentials. Combine these with interaction tests proving no mutation is made; string scans alone are not sufficient.
- [x] Run the complete frontend suite, typecheck, lint, and static build. Commit exact integration files after all pass.

Task 7 complete at `a7175dd`; independent spec and quality reviews passed. Main independently verified 348 tests across 19 files, typecheck, lint, and a same-origin static export. The 16 new integration/safety tests cover six-GET-only interaction, credential/filter/inspector purge, and stale indicators during retries.

## Task 8: Safe local preview server

**Files:** Create `scripts/tradeops-preview.mjs`, `tests/tradeops-preview.test.ts`; add `preview:tradeops` to package scripts without altering existing commands.

- [x] Write pure policy tests before the server. Use this fixed allowlist; only routes marked protected may forward the operator Authorization header:

```js
export const UPSTREAM = "https://prop-trading-observation-edge.ameer-1996112.workers.dev";
export const ROUTES = new Map([
  ["/health/live", { protected: false, limit: null }],
  ["/api/v1/observation-receipts", { protected: false, limit: 200 }],
  ["/api/v1/paper-accounts", { protected: true, limit: 200 }],
  ["/api/v1/paper-simulations/summary", { protected: true, limit: 200 }],
  ["/api/v1/paper-readiness", { protected: true, limit: null }],
  ["/api/v1/rd-entry-decisions", { protected: true, limit: 200 }],
]);
```

- [x] Accept only GET for forwarded API requests. Reject duplicate/unknown query parameters, limit values outside 1–200 or not canonical positive integers, and query parameters on no-limit routes. Return 405 for mutations and 404 for unlisted API/health paths. Do not forward redirects or caller-specified hosts.
- [x] Bind to `127.0.0.1` with a default port of 4173. Accept Host exactly `127.0.0.1:<actualPort>` or `localhost:<actualPort>`; reject unexpected ports/hosts. For browser Origin, require exact same origin. Reject `Sec-Fetch-Site: cross-site` even for requests lacking Origin. Do not enable CORS.
- [x] Forward only Accept JSON and, for protected routes, a syntactically bounded Bearer credential. Reject malformed or multi-value authorization headers. Drop all cookies and unrelated headers. Do not print requests, headers, upstream bodies, or errors containing credentials.
- [x] Bound the upstream request including streamed response body to six seconds and 2MiB; cancel when the local request closes. Use redirect `error`, no retries in this server, no caching, and only return JSON media types for API routes. Return fixed safe 502/504 errors on failures.
- [x] Serve only the static `out/` directory resolved relative to the script. Use realpath containment checks, reject traversal/encoded separators/NUL/backslash/symlinks escaping the root, and use a fixed MIME map. Unknown assets return 404 rather than source files. Require an existing exported `index.html` at startup. No runtime command execution or arbitrary upstream configuration.
- [x] Test the policy with fake upstream responses: rejected mutation/paths/origins/hosts, parameter bounds, public credential stripping, protected forwarding, redirects, bad content type, body limit, timeout, disconnect, and static traversal. Do not make real network calls in tests.
- [x] Add the exact package command `"preview:tradeops": "node scripts/tradeops-preview.mjs"`. Verify `NEXT_PUBLIC_API_BASE_URL` is unset for the local same-origin export; never bake credentials into it.
- [x] Run `npm test -- tests/tradeops-preview.test.ts`, full tests, lint, typecheck, build; commit exact preview/test/package files.

Task 8 complete at `3f50cad`; independent spec and quality reviews passed. Main independently verified the full 457-test suite, typecheck, lint and same-origin static export. Quality reviewer independently ran all 109 proxy/policy tests, including real six-second deadlines and loopback-only transport. No external upstream requests were made by those tests.

## Task 9: Browser verification and local handoff

**Files:** Create `docs/tradeops-preview.md`; update the verification audit and plan checkboxes.

- [x] Read the browser-control skill before controlling a browser. Start the exported preview using `npm run preview:tradeops` in the console. Request network/loopback permissions only as needed. Do not deploy.
- [x] Open a new local preview tab rather than replacing the user's production tab. Check desktop at 1440×1000 and mobile at 390×844. Compare shell, navigation, account strip, table density, typography, and colors with the pinned donor source/reference. Capture actual screenshots and fix clipping, focus problems, unreadable text, and accidental redesigns. Protected tables/cards are fixture-tested rather than production-verified; actual checks also included 320×700.
- [x] Verify public GET integration with the current observation Worker. A failed network permission or production availability check must be reported honestly; it is not a reason to invent fixture data or change production.
- [x] Without a voluntarily supplied operator credential, verify the locked state and record authenticated integration as unverified. Automated fixtures validate unlocked rendering and session behavior, but do not count as production account evidence. Never request credentials pasted into chat; the user can enter the existing operator credential in the preview UI.
- [x] Check DevTools/network evidence: only allowlisted GET calls, one 30-second refresh cycle, no legacy `/backend`/Supabase/MetaAPI requests, no request on navigation/filter changes, stale status offline, and one refresh after recovery. Do not display secrets in screenshots or logs.
- [x] Run final commands in `apps/operations-console`:

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

Expected: all tests pass, zero TypeScript/lint errors, successful static export. Then run `git diff --check` from the feature worktree root. Record actual test counts and commands; do not reuse the baseline count as the final result.

- [x] Audit the final diff: only console files and explicitly scoped documentation; no Worker business logic, database migrations, configuration bindings, secrets, Pine, EA, or TradingView changes. Confirm the source donor remains unchanged.
- [x] Document launch commands, loopback URL, what is connected, why some features are unavailable, loaded-window metrics, and credential lifetime. Record source attribution and visual/functional verification limits. Commit those docs and updated checkboxes.
- [x] Present the local preview link and concise verification results. State clearly that production and Supabase remain unchanged. Keep the feature branch/worktree for review; do not push, merge, or deploy without separate user instruction.

Task 9 evidence: browser public GETs and navigation, offline stale retention/recovery, 30-second shared cadence, desktop/mobile geometry and focus verified. Mobile fix `b6e09d3` and integration corrections `145fe19` passed independent review. Main final run: 467 tests across 20 files, typecheck/lint/static build/diff check passed. No credential supplied; protected production integration remains unverified. Detailed evidence and limits are in the verification audit; launch instructions are in `docs/tradeops-preview.md`.

## Self-review coverage

Spec sections map to tasks: source/isolation → 1; API meaning → 2–3; session safety → 4; visual fidelity → 5–6; five read-only views → 7; GET-only local transport → 8; local acceptance and no deployment → 9. Supabase and paid-service exclusions apply to every task and are rechecked in 7 and 9.

The initial plan commit contained no frontend implementation. Completed checkboxes above now record the subsequent reviewed work and fresh verification evidence; they do not authorize deployment or execution.
