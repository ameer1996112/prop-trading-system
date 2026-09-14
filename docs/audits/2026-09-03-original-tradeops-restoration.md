# Original TradeOps restoration — local verification

Date: 2026-09-03. Local implementation and verification complete; remaining limitations are recorded below.

## Scope and provenance

The user approved restoring the familiar original frontend, not another redesign. Donor `liquidity-supply-and-demand` revision `cc740a197209cef27374ca6166a505b14af54ab6`; destination `apps/operations-console` on `codex/tradeops-dashboard-migration`, base `18e29ce68d9e9fc89311163e95dd2b71f040c527`.

Original global CSS and Sovereign Terminal CSS are copied with provenance headers. Original fonts are bundled locally. Shell dimensions/navigation, dashboard ordering, account cards, Risk monitor, Journal and Performance Intelligence sections use source-derived presentation. The eight service-dependent pages have per-file donor references and `original/PROVENANCE.md`. Legacy data hooks, service providers, mutation handlers and sample values are excluded.

Before overlapping edits, the existing tracked diff and untracked files were preserved under the task workspace's `restoration-evidence/` directory. Original reference screenshots are preserved there in `original-screenshots/`. Donor source remains unchanged. Earlier uncommitted reliability/session/transport changes were retained.

## Deliberate adaptations

- All thirteen original page destinations are navigable. Unsupported writes are disabled within their own pages, not replaced by locked navigation.
- A compact tab-memory credential form replaces legacy authentication. API and broker status stay separate; broker PnL, equity, fills and live permissions are unavailable.
- The existing six bounded GET routes and single visible/online network poll remain unchanged. The isolated header clock only updates local presentation.
- Current paper data is explicitly labeled. Ledger and simulation sources remain separate, with exact minor-unit formatting and per-currency/scale aggregates. No cross-currency totals or broker equity inference.
- Risk retains original Fleet Summary/account-card/Guard Rails composition. Per-account selection filters cards and source diagnostics consistently. The Fleet Summary remains explicitly all-account.
- Account and settled-intent inspection resolve current loaded records; lock/rejection removes protected data and resets inspection state. Journal settlement filters operate locally on its table. Window statistics are explicitly not lifetime performance.
- Historical chart slots and service-only sections show unavailable states. The original Prop Firm sample values, Settings defaults and operational success labels are not evidence and are not copied as live state.
- Original fixed-UTC session hours are labeled reference-only: no DST/holiday/live-session claims. The display-only clock is hidden on narrower desktop widths to preserve header space.
- Keyboard-accessible local tabs, mobile focus containment, and explicit disabled-control descriptions are retained. Sidebar/main scrolling is constrained to the viewport.

## Verification record

- Baseline: 470 tests passed before restoration.
- TDD: new navigation/composition/service-page/keyboard/account-inspection/record-inspection/risk-filter tests were observed failing before their implementation.
- Initial integrated restoration: 499 tests passed before final regression coverage.
- Final full suite: 503 tests passed across 24 files. Typecheck, lint and static production build each exited successfully on the final source. The build emitted all thirteen original destinations.
- Independent spec and code-quality reviews completed. Findings corrected include original account/risk/journal/analytics composition, multi-broker selection, scoped inspector layout/state styles, and main-scroll reset on navigation. Reviewers reported no remaining critical or important findings.
- Browser: all thirteen destinations opened successfully; direct Journal reload resolved; sidebar collapse, local tabs, mobile navigation, Escape/focus return, and route scroll reset were verified. Desktop 1280×720 and mobile 390×844 checks showed no horizontal overflow.
- Screenshots saved in `restoration-evidence/restored-screenshots/`: dashboard top/lower, Accounts, Journal, Alert Setup, Settings, mobile navigation and mobile Journal. Comparison uses the four preserved approved original screenshots and donor source. The isolated old preview subsequently stopped responding; fresh original Journal/Settings screenshots could not be captured. Exact pixel parity for those pages is not claimed.
- Fresh browser network capture covering reload and navigation through all thirteen pages contained 23 requests, all GET requests to `127.0.0.1:4173`. These were local assets plus the two public observation routes; no legacy-service request or mutation was observed. The fresh capture was neither truncated nor paginated. Authenticated routes were not exercised in this browser session.
- No real credential was entered. Populated account/intent inspection and protected-session behavior were verified with test fixtures, not authenticated production screenshots.

Local preview remains at `http://127.0.0.1:4173/`. Changes remain uncommitted in the existing feature worktree for user review.

## Dependency limitations

`npm audit --omit=dev --json` reports three high-severity production dependency entries in the existing Next.js 16.2.11 dependency tree (Next.js, PostCSS and Sharp). The reported fix is a framework update; it was not mixed into this frontend restoration. The install audit counted six high entries including development dependencies. This is not a clean security audit and the preview is not approved for production deployment by these checks.

## Boundaries

No commits, push, merge, deployment, database changes, migrations, secrets, Cloudflare resources/bindings, Pine/TradingView, EA/MT5 or broker operations were performed for this restoration. No Supabase/Railway/MetaAPI/AI service was started or connected. Authenticated production data remains unverified without an operator-entered credential. Fixture-based tests establish UI behavior, not actual trading readiness or profitability.
