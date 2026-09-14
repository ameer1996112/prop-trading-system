# Original TradeOps frontend restoration

Date: 2026-09-03

Status: Approved and implemented locally. The user confirmed the original screenshots and then approved implementation with “ok lets do it”. Verification and remaining limitations are recorded in `docs/audits/2026-09-03-original-tradeops-restoration.md`; no deployment or execution changes are authorized.

## Outcome and reference

Restore the actual frontend the user already knows. Familiarity takes priority over a new aesthetic. Reuse its page components, layout, styles and interactions; adapt data connections separately. This is not another recreation of the old appearance using a simplified dashboard.

- Donor: `liquidity-supply-and-demand`, revision `cc740a197209cef27374ca6166a505b14af54ab6`.
- Donor worktree: `/Users/ameeramer/.config/superpowers/worktrees/liquidity-supply-and-demand/prop-pine-v3-production-consolidation`.
- Destination: `prop-trading-system`, `apps/operations-console`, branch `codex/tradeops-dashboard-migration`.
- Existing destination HEAD: `5975104e9f314d29bc8140be1ba7adbfc18ed0ad`.
- Approved running reference: `http://127.0.0.1:4174/`.
- Screenshots: `/private/tmp/tradeops-original-preview.lzagb6/screenshots/` (`dashboard.png`, `dashboard-lower.png`, `accounts.png`, `alert-setup.png`). These are temporary artifacts; preserve copies in the task's local evidence directory before cleanup.

The reference uses an archived frontend copy, without environment files, with its backend routes blocked and external browser connections restricted. Missing backend data and built-in sample figures are not account evidence. Disk limits required a shared Next.js 16.2.11 / React runtime instead of the donor's locked Next.js 16.1.6 runtime. The source UI and styles were retained; only temporary development/runtime configuration changed. Screenshots establish the approved appearance, not exact runtime parity or trading readiness.

## Decision

The previous approach ported selected presentation patterns into five read-only views. It lost familiar page composition and left most navigation disabled. Further styling of that port would retain those limitations. Running the entire old system unchanged would restore integrations the user wants to replace. The selected approach is source-level frontend reuse with isolated data adapters.

This specification supersedes the earlier preview's styling freedom and blanket disabling of unsupported navigation. It does not supersede authentication, truthful data, request limits or trading safety boundaries.

## Preserve the familiar interface

- Original sidebar groups, page names, ordering, expanded/collapsed behavior and routes.
- Original top bar, typography, dark surfaces, amber accents, spacing, borders, icons and density. Inspect both `globals.css` and `styles/sovereign-terminal.css`; the original appearance is not captured by color tokens alone.
- Original dashboard order: aggregate strip; status and market-session panels; accounts; trade permissions; open positions; Latest Signals beside Live Log; signal inspector.
- Original page layouts, table columns, filters, tabs and detail interactions where their meaning is supported. Do not silently replace a strategy filter with an entry-model filter.
- Reuse existing responsive behavior. Preserve keyboard access and correct genuine accessibility defects without introducing a new visual direction.

Keep the original page destinations navigable, including Exec Quality, Alerts, Prop Firm, Alert Setup, Optimizer, Strategies, Notifications and Settings. Render the actual reusable page content, not identical placeholder cards. Fields without a connected source display an explicit unavailable state; operations requiring an unavailable backend remain disabled with an explanation. Navigable does not mean operational.

## Integration boundary

Extract legacy data hooks and mutation handlers from presentation components. Route supported reads through a shared, typed adapter using the current six observation/paper endpoints. Retain the existing bounded requests, one visible/online polling cycle, cancellation, stale indicators and tab-memory credential handling. Do not mount legacy providers that reconnect Supabase, Railway, MetaAPI, AI tools or market streams automatically.

Preserve table structure where practical, but label paper records as paper. Unknown broker equity, fills, execution latency, permission status and lifetime performance remain unavailable, never fabricated or defaulted to zero. Original sample data is allowed only in an explicitly labeled, isolated visual test harness; it must not enter the connected console.

Keep authentication available in a compact control consistent with the old shell, with an accessible credential form when needed. Do not replace the dashboard with promotional feature descriptions. No credential persistence in browser storage, URLs or screenshots.

The current APIs do not provide all original page data. Restoring frontend pages does not implement missing execution, alert-creation, settings-write or broker services. Those adapters and backend capabilities are a separate implementation scope. Do not enable trading by restoring the original Live-mode button.

## Verification and completion

1. Compare the restored UI against the running original at matching viewport sizes, scroll positions and equivalent explicit offline/test states. Capture dashboard, accounts, journal, alert setup and settings, plus a mobile navigation check.
2. Verify every original navigation destination, key filters and detail-panel interactions; unavailable backend operations must fail closed and communicate why.
3. Preserve tests for credential purge, session races, stale data, bounded polling, currency units and paper/broker distinctions. Add coverage for original section ordering and navigation.
4. Verify no request targets legacy services; no mutations or sample-data fallback occur in the connected console.
5. Run typecheck, lint, tests and build when sufficient disk space is available. A space-related failure is not a passing check.
6. Present the local restored frontend for user review. Do not call the full automated trading system complete.

## Work preservation and limits

The destination contains uncommitted visual-refresh and reliability changes. Preserve them before replacing overlapping UI; do not reset the worktree or discard unrelated changes. Reuse verified session, transport and data safeguards where possible. Preserve donor provenance and applicable font/icon notices.

This phase does not change Pine, strategy rules, risk sizing, TradingView alerts, MT5/EA, broker execution, Cloudflare resources/secrets, D1/Supabase data or schemas. No push, merge or deployment is included. No broad disk cleanup is authorized; dependency reuse and cleanup of this task's own disposable artifacts are permitted.

The immediate next step after written-scope review is an implementation plan for this frontend restoration. Connecting real execution and historical data follows separately, without redesigning the restored interface.

## Planning checkpoint

- [x] Inspect the old and current frontend context.
- [x] Render the old frontend locally and capture the user's confirmed visual reference.
- [x] Resolve the preserve-versus-redesign choice and compare migration approaches.
- [x] Record the proposed restoration boundaries and review for ambiguity.
- [x] User review of this written scope.
- [x] Implementation plan, then local restoration and verification, with reference-preview and authenticated-data limitations recorded in the audit.
