# TradeOps local-preview verification — 2026-09-02

## Status and scope

The source-derived dashboard and local preview transport are complete and verified through implementation `145fe19` on 2026-09-03. Each task and the final corrective wave passed independent spec and quality review; the main final run passed 467 tests, typecheck, lint and static export. Actual browser checks cover public/locked states; authenticated production integration remains unverified. The source-provenance observations below describe the initial read-only inspection; subsequent implementation evidence is recorded separately. No deployment, broker operation, Supabase activity, or environment-secret discovery was performed.

## Source provenance and attribution

- Donor repository: `liquidity-supply-and-demand`.
- Read-only donor worktree: `/Users/ameeramer/.config/superpowers/worktrees/liquidity-supply-and-demand/prop-pine-v3-production-consolidation`.
- Verified donor HEAD: `cc740a197209cef27374ca6166a505b14af54ab6`.
- Source commit date/title: `2026-08-21`, `fix: harden frozen RD V3 isolation gates`.
- Donor `git status --porcelain=v1` was empty at inspection start; the specified commit was checked locally, without fetching or changing the donor.
- Destination: `prop-trading-system`, branch `codex/tradeops-dashboard-migration`, clean starting HEAD `b397202224776d7883c14001ba7eb806318bdf7f`.
- Inspection followed the donor Frontend module, announced batches of one to three files, and reads of at most 200 lines per range. `AGENTS.md` and the Frontend entry in `.planning/codebase/MODULE_MAP.md` were consulted; donor code was not changed.

The seven inspected source files are the attribution baseline for the local port. Paths below are relative to the donor root; blob identities bind the evidence to exact file contents.

| Source file | Git blob |
| --- | --- |
| `frontend/src/app/page.tsx` | `e2842d9e6262789332e89367370e84bad21984d7` |
| `frontend/src/components/layout/AppShell.tsx` | `6ad435b578c62bb9e1637009c32578af1c1bf472` |
| `frontend/src/components/layout/Sidebar.tsx` | `5829619010a527069223ecc854895fa0feac0ffd` |
| `frontend/src/components/layout/TopBar.tsx` | `fdbc3fdd877db4bcedc950ea6217edeabc6a01b0` |
| `frontend/src/components/dashboard/AccountStrip.tsx` | `ea12e21d6dd427968f23596fabc02ec3dcd034ec` |
| `frontend/src/components/dashboard/AggregateBar.tsx` | `804cecf499479be67a1c1509c0c4367d58c67f8f` |
| `frontend/src/app/globals.css` | `336c0510be378212a97c95d59518a340ec02aa93` |

Targeted source headers and case-insensitive searches for copyright, SPDX, license/licence, and attribution markers in these seven files found no such notices. Targeted root checks for `LICENSE`, `LICENCE`, `COPYING`, `COPYRIGHT`, and `NOTICE` candidates (including common suffixes and lowercase variants) found no candidate file. This establishes only the result of those checks; it does not establish a license grant or conclude that no notice exists elsewhere. Preserve this source attribution and any notices discovered during later scoped migration; redistribution/license clearance is not verified here.

## Observed shell and dashboard

- `AppShell.tsx`: fixed desktop sidebar offset uses `md:ml-56` / `md:ml-14`; full-height content column is centered at `max-w-[1800px] 2xl:max-w-[2000px]`. The main region scrolls vertically and uses compact `p-3 sm:p-4` padding.
- `Sidebar.tsx`: expanded/collapsed widths are `w-56` / `w-14` (224px / 56px with the standard 16px root size). The sidebar brand row uses `h-12` (48px). Preserve grouped compact navigation, TradeOps branding, amber active state, icons, and collapse behavior.
- **Header fidelity correction:** actual `TopBar.tsx` uses `h-16` (64px), not 48px. Its `.topbar-glass` CSS does not set a competing height. The initial task's general 48px-header description was inaccurate; the migration owner clarified that the port should retain the observed 64px top bar and 48px sidebar brand row. These are source-class observations, not browser measurements.
- `page.tsx`: pinned aggregate strip, status banners, account strip, trade-permissions panel, open positions, then dense Latest Signals plus a right-side log (`xl:w-[260px] 2xl:w-[300px]`). Preserve the visual hierarchy while replacing unsafe data/behavior, not the original runtime integrations.
- Selected-row inspector linkage is explicit in `page.tsx`: `SignalTable` receives `onSelectSignal={handleSelectSignal}` (line 247); that handler stores the selected signal and opens the inspector (lines 184–187). `SignalInspector` receives `selectedSignal`, `inspectorOpen`, and `setInspectorOpen` (lines 283–287), linking the selected table row to its detail view and open/close state. This interaction pattern is preserved with preview-safe data and covered by automated interaction tests; protected production records were not supplied for browser verification.
- `AccountStrip.tsx`: compact rounded account cards with a 3px status rail, account/type/status labels, monospace balance, equity drift bar, filtering and detail navigation. Grid progresses through 2/3/4/5 columns with `gap-2`; loading and empty states exist in the donor.
- `AggregateBar.tsx`: sticky top strip with status, total PnL, open positions, win rate, and account health. Its donor zero defaults and LIVE/OFFLINE labels are not evidence of preview data availability and must not misrepresent the preview's state.

## Original navigation order and preview scope

| Order | Original group | Original item order | Supported preview pages |
| --- | --- | --- | --- |
| 1 | Overview | Dashboard | Dashboard (`/`) |
| 2 | Trading | Accounts; Exec Quality | Accounts (`/accounts`) |
| 3 | Monitoring | Risk & Rules; Alerts; Prop Firm | Risk & Rules (`/risk`) |
| 4 | Analytics | Analytics | Analytics (`/analytics`) |
| 5 | Automation | Alert Setup; Optimizer | None |
| 6 | Strategy | Strategies | None |
| 7 | Ops | Journal; Notifications; Settings | Journal (`/journal`) |

The implementation preserves this group/item ordering and five view identities within a single shared session; the path column identifies donor pages, not separate exported preview URLs. Unsupported items are disabled with explanations. The preview title uses the same `Risk & Rules` label as its sidebar; the donor top-bar title was `Risk Monitor`.

## Tokens to preserve

Observed in `globals.css` root tokens:

| Role | Value |
| --- | --- |
| Background | `#080b10` |
| Surface | `#0d1117` |
| Raised surface | `#161b22` |
| Border | `#21262d` |
| Primary text | `#e6eaf0` |
| Secondary text | `#8b95a5` |
| Amber | `#f0b90b` |
| Green | `#0ecb81` |
| Red | `#f6465d` |
| Blue | `#3b82f6` |

Sans stack begins with Inter, then SF Pro Text / Segoe UI / Roboto / Helvetica Neue / Arial and system fallbacks. Monospace stack begins with JetBrains Mono / Roboto Mono, then platform monospace fallbacks. The preview preserves dense type, tabular numeric alignment, terminal-style dark surfaces, subtle borders/glass, and amber navigation treatment. Computed Inter typography and rendered geometry were verified locally as recorded below.

## Explicit exclusions from the preview port

- Old live-mode setters and confirmation flows: `Sidebar.tsx` directly calls `setMode`, including `setMode('LIVE')`; do not carry them over.
- Broker/trading mutations, including the top-bar kill-switch mutation and any account or position mutation. `TopBar.tsx` visibly imports and invokes `useKillSwitchMutation`; read-only preview presentation must not retain its operational handler.
- Legacy `/backend` proxy and donor API plumbing; no legacy endpoint integration is authorized by visual reuse.
- Supabase clients/realtime subscriptions and mock fallbacks that impersonate real or available account data.
- Market streams and copilot: `AppShell.tsx` mounts `AICopilot` and `LiveMarketPanel`; `TopBar.tsx` exposes their toggles. Exclude their runtime integrations.
- Signal-derived fake positions: `page.tsx` calls `buildOpenPositionFallback(visibleSignals)` and substitutes those results when live positions are empty. Do not migrate that behavior or fabricate broker positions.

The proxy and Supabase exclusions are approved boundaries, not claims from an inspection of their implementation files. This task inspected only the named visual sources and targeted provenance material.

## Implementation verification checklist

- [x] Confirm all five preview views render and preserve donor shell/layout fidelity, including expanded/collapsed sidebar, narrow viewports, and corrected header heights. Protected account/table rendering is fixture-tested, not production-verified.
- [x] Verify token values and computed typography in the rendered preview; capture actual visual evidence.
- [x] Verify preview-only state labels, account selection, unknown/empty/loading/error behavior, and truthful position provenance through automated tests; confirm locked/public states in the actual browser.
- [x] Verify excluded imports, handlers, proxies, subscriptions, network destinations, and mutation paths are absent from the migrated runtime.
- [x] Run relevant tests/build and preview/browser checks after implementation; record actual commands and results.

The initial provenance inspection did not satisfy these implementation checks. Subsequent evidence is separated below; no fixture results are presented as production account evidence.

## Implementation evidence through Task 7

- Branch: `codex/tradeops-dashboard-migration`, target base `528ad8f33324b9a254f74e1988367caf6d3a7cad`.
- Task 2 (`484dc5b`): strict read-only ledger parser, typed unauthorized responses, preserved fallback decision loader.
- Task 3 (`a453d09`): exact minor-unit formatting, currency-and-scale grouping, source-aware account and loaded-window selectors.
- Task 4 (`81d8bb6`): one memory-only session, shared 30-second visible/online polling, stale recovery, cancellation and generation checks.
- Task 5 (`f31e925`): source-derived shell, navigation, account strip and aggregate presentation; local fonts and icons.
- Task 6 (`7be2bfa`): setup table and selected-ID evidence inspector, preserving existing model reasoning and explicit paper linkage.
- Task 7 (`a7175dd`): five read-only views and root integration; OPEN/SETTLED distinction, safe unlock/lock, public observations and local filters.
- Main-agent rerun after Task 7: `npm test` — 348 passed in 19 files; `npm run typecheck` and `npm run lint` — exit 0; `env -u NEXT_PUBLIC_API_BASE_URL npm run build` — successful static export; `git diff --check` — clean.
- Independent Task 7 spec reviewer reran 16 composed integration/safety tests. Quality review found no actionable issues. These checks use test fixtures and do not establish actual protected production data.
- Donor recheck after Task 7: unchanged clean HEAD `cc740a197209cef27374ca6166a505b14af54ab6`.
- Presentation package versions: `@fontsource/inter` 5.2.8 and `@fontsource/jetbrains-mono` 5.2.8 (SIL OFL 1.1), `lucide-react` 0.563.0 (ISC and included Feather MIT notice). Exact bundled license text is retained in `apps/operations-console/public/third-party-notices.txt` for the export.

Production health was checked read-only during implementation and reported `OBSERVATION_ONLY`, paper simulator `ENABLED`, canonical paper `DISABLED`, execution `DISABLED`, deployment tag `pr6-528ad8f`. This is a point-in-time public API result, not evidence of broker connectivity or a deployment performed by this task.

## Browser evidence — 2026-09-03 continuation

- A separate local in-app browser tab opened `http://127.0.0.1:4173/`; only the local Node preview was started. No production tab was replaced.
- Actual 1440×1000 measurements: sidebar 224px expanded / 56px collapsed, top bar 64px, computed Inter font, no horizontal overflow. Dashboard, Accounts, Risk & Rules, Analytics and Journal navigation worked.
- Actual 390×844 and 320×700 checks: mobile navigation opened with focus on Close navigation and an inert background; selecting a view closed the dialog and restored focus to Open navigation. No horizontal overflow. The initial title wrapping defect was fixed in `b6e09d3`: mobile title/action rows use an expandable 96px-minimum header without reducing fonts or hiding controls. Dashboard and Risk & Rules titles measured one line after the fix. Desktop remained 64px. Independent correction review passed spec and quality; 28 shell tests passed.
- Screenshots captured from the actual preview (temporary local QA artifacts, not fabricated designs): `/private/tmp/tradeops-preview-yO8ysn/desktop-1440.png`, `mobile-390.png`, and `mobile-navigation.png`. The mobile dashboard image was replaced after the header fix. These temporary artifacts are not required to build or run the app.
- Public health and observation requests returned HTTP 200. The log displayed 50 actual returned receipts including TRADINGVIEW, OTHER and TEST sources. Receipt timestamps were historical; a current fetch timestamp does not imply new market activity or executed trades.
- Five view changes produced zero additional network requests. CDP network evidence after offline recovery showed one two-GET cycle followed by cycles approximately 30.003 and 30.000 seconds apart. All six responses were HTTP 200; only health and observation receipt routes were used while locked.
- Offline emulation retained the observation log and previous success times while marking API/resources stale; zero requests occurred during the offline interval. Restoring the connection produced one refresh. Emulation was restored online afterward.
- No runtime exceptions or console error events appeared in the captured browser event interval.
- Final rebuild/server restart and browser reload at `145fe19`: 18 requests (document, local CSS/JS/fonts, and two public API GETs), all HTTP 200, no captured errors, no external browser destinations or protected requests. The temporary viewport override was reset and the online state restored before handoff.
- No operator credential was supplied or discovered. Protected production account/setup/position integration remains **unverified**. The operator can unlock directly in the UI; fixture-based tests validate interaction and data semantics only. Broker execution and legacy Supabase integration remain outside this preview.

## Final review corrections

Task 8 server (`3f50cad`) passed independent spec/quality review and 109 transport tests; the main rerun passed all 457 tests across 20 files, typecheck, lint and static build. Mobile correction `b6e09d3` increased the suite to 463 passing tests.

The whole-change review identified two integration defects: a legacy receipt HTTP 503 fallback could overwrite the last successful log, and the local proxy's credential alphabet was narrower than the Worker contract. Commit `145fe19` corrects both: TradeOps now uses a strict HTTP-200 receipt reader, preserving cached data on failures without changing the Foundation fallback; proxy bearer syntax matches the Worker's visible-ASCII 1–1024 contract while retaining duplicate/control/whitespace protections. Regression tests cover first failure, recovery, later failure with cached receipts, valid blocked reports, punctuation and the local HTTP boundary. No Worker code changed.

The main agent independently reran on this final implementation:

```text
npm test                                      467 passed / 20 files
npm run typecheck                             exit 0
npm run lint                                  exit 0
env -u NEXT_PUBLIC_API_BASE_URL npm run build   successful static export
git diff --check                              clean
```

The final diff is limited to `apps/operations-console` and scoped documentation. Donor HEAD remains `cc740a197209cef27374ca6166a505b14af54ab6` with a clean worktree. Production, Supabase, Pine, TradingView, EA/MT5, broker execution, database schemas, bindings and secrets were not changed. The feature branch/worktree and running local preview are retained for review, not pushed or deployed.

Final independent re-review at `145fe194795e46f14f136a091c85a9729d178595`: **spec PASS; quality PASS; no remaining blockers**. The reviewer independently reproduced cache preservation, malformed-report rejection, legacy fallback compatibility, valid punctuation and invalid-header handling with local fabricated values. The mobile correction and handoff guide were reviewed, and all three installed dependency license texts were confirmed verbatim in the bundled notices.
