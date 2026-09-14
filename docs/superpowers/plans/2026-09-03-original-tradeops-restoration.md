# Original TradeOps Restoration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development for bounded implementation and review; use superpowers:executing-plans for integration.

**Goal:** Restore the approved original TradeOps frontend locally, preserving familiar page composition, styles, navigation and safe read-only paper-data adapters.

**Architecture:** Reuse the donor's presentation and CSS, replacing effectful providers with the existing single `useTradeOps` session. Original destinations are real static routes. Missing capabilities remain unavailable within each distinct page. No legacy clients, mock fallback, mutations or new remote services.

**Tech Stack:** Existing Next.js 16 / React 19 / TypeScript / Vitest, original Tailwind 4 styles and bundled fonts/icons. Donor revision `cc740a197209cef27374ca6166a505b14af54ab6`.

## Boundaries and preservation

- Work only in `apps/operations-console` and restoration docs in the existing feature worktree.
- Pre-restoration tracked diff, untracked sources and original screenshots are backed up under the desktop task's `restoration-evidence` directory. Preserve the reliability/session/transport changes.
- Do not edit donor source, infrastructure, Pine, EA, broker integration, databases, credentials or API contracts. No push, merge or deploy.
- UI adaptation must not equate paper records with broker trades or unknown values with zero. Keep per-currency aggregates independent.
- Source extraction is deliberate: import no legacy provider/hook tree. Unavailable actions have disabled controls and visible explanations.

## Task 1 — Baseline and original-source inventory

Files: approved spec; donor `frontend/src/components/layout/{Sidebar,TopBar,AppShell}.tsx`, `frontend/src/app/globals.css`, `frontend/src/styles/sovereign-terminal.css`; audit targeted page entrypoints and their presentation dependencies.

- [x] Back up current work and visual references.
- [x] Run `npm test -- --reporter=dot` in `apps/operations-console`; allow loopback for preview tests.
- [x] Record source/component provenance and identify effectful hooks to exclude.

## Task 2 — Original styles and shell

Files: `src/app/layout.tsx`; new `src/styles/original-tradeops.css`, `sovereign-terminal.css`; `postcss.config.mjs`, `package.json`, lockfile; `src/features/tradeops/{TradeOpsShell,navigation}.tsx/ts`, new `OriginalTopBar.tsx`; existing module CSS only for adapter panels.

- [x] RED: shell tests assert every original destination is available, original route mapping, separate API/broker status, disabled live/kill actions, collapsed and mobile keyboard navigation.
- [x] Add original CSS (including sovereign overrides) and required local fonts/Tailwind. No external font loading.
- [x] Reuse original shell/brand/group/header markup and dimensions (224/56px sidebar, 48px brand, 64px topbar, original compact spacing). Keep accessibility fixes.
- [x] Replace mode mutation provider with explicit read-only state. Replace remote topbar hooks with passed status; today broker PnL remains unavailable.
- [x] GREEN: run shell tests; typecheck.

## Task 3 — All original destinations and unavailable service pages

Files: `src/app/[view]/page.tsx`, `src/app/page.tsx`, `src/features/tradeops/navigation.ts`; new focused original-page presentation files in `src/features/tradeops/original/`; `tests/tradeops-original-pages.test.tsx`.

Static routes: `/accounts`, `/execution-quality`, `/risk`, `/alerts`, `/prop-firm`, `/analytics`, `/alert-setup`, `/optimizer`, `/strategies`, `/journal`, `/notifications`, `/settings`.

- [x] RED: render each page, verify distinctive original headings/sections/tabs and disabled unsupported actions with reasons; verify no network calls on navigation.
- [x] Extract actual original page presentation. Retain useful filters/tabs/local selection; never mount Supabase, Railway, MetaAPI, AI or stream providers.
- [x] Preserve Alert Setup's preset/timeframe/prefix/webhook/batch form structure, but disable creation/submission without a supported API. Do not expose credentials.
- [x] Preserve Settings' tabs/forms and unknown connection state; save and trading controls disabled. Notifications never pretends to be a live feed.
- [x] Keep Optimizer/Strategies/Prop Firm/Exec Quality recognizable with original metric/table/form layouts, unknown values and relevant unsupported-action explanations.
- [x] GREEN: page tests + safety import scan including nested presentation files.

## Task 4 — Dashboard and read-only original data pages

Files: `TradeOpsDashboard.tsx`, `AggregateBar.tsx`, `AccountStrip.tsx`, `PaperViews.tsx`, `SetupTable.tsx`, `SetupInspector.tsx`; new original dashboard panels where appropriate; `tests/tradeops-dashboard.test.tsx` and `tradeops-original-pages.test.tsx`.

- [x] RED: dashboard ordering asserts aggregate → status/session → accounts → trade permissions → open positions → Latest Signals/Live Log. Assert no promotional unlock wall.
- [x] Compact credential form remains accessible and clears input immediately. Dashboard structure remains visible while locked; protected values unavailable.
- [x] Restore Accounts/Risk/Analytics/Journal page headers and composition around typed paper sources. Keep current source-unit precision and record-window explanations.
- [x] Preserve original Strategy filter semantics (disabled if no source); show entry-model filter separately, not under a Strategy label.
- [x] Preserve inspector selection/focus, account filtering, stale indicators, credential purge on lock/rejection, one visible/online polling owner.
- [x] GREEN: dashboard, setup, session, polling and model tests.

## Task 5 — Static preview integration and review

Files: `scripts/tradeops-preview.mjs`, related tests only if nested static route handling requires adjustment; `docs/tradeops-preview.md`; new restoration audit/provenance doc.

- [x] Ensure direct static routes resolve without widening the six GET-only API allowlist or traversal protections.
- [x] Run typecheck, lint, complete tests, static build. Treat any disk/runtime issue as failed verification until rerun.
- [x] Spec-compliance review by independent reviewer; fix findings. Then code-quality review; fix important findings.
- [x] Browser-check restored dashboard top/lower, Accounts, Journal, Alert Setup and Settings, all destinations, sidebar collapse and mobile navigation. Compare with preserved original screenshots and donor source; no real secrets entered.
- [ ] Fresh original Journal/Settings screenshot comparison: the isolated reference preview stopped responding. This visual-only limitation is recorded in the audit; local restoration is ready for user review.
- [x] Record screenshots and honest remaining unavailable backend features. Present local preview; do not claim automated trading is complete.

## Acceptance checks

`npm run typecheck`, `npm run lint`, `npm test`, `npm run build` must pass freshly. Browser screenshots must show original hierarchy and density, not a fresh reinterpretation. No donor service requests or writes may occur. Local preview is the handoff; remote operations require separate user authorization.

## Plan self-review

The tasks cover all thirteen original destinations, donor CSS beyond tokens, real source reuse, original dashboard order, authentication, unavailable capabilities, currency/source truthfulness, request isolation and local visual evidence. Unsupported backend functionality is explicitly out of scope, not hidden behind disabled navigation. The user already approved implementation; no additional design approval checkpoint is required.
