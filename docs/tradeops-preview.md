# TradeOps local preview

Status: original TradeOps frontend restoration and health-only MT5 integration implemented locally on 2026-09-03. See the [restoration verification record](audits/2026-09-03-original-tradeops-restoration.md) and [MT5 health verification record](audits/2026-09-03-mt5-health-connection.md). The private MT5 health feed was read successfully after the operator completed Cloudflare Access sign-in; protected paper integration remains unverified without its separate operator credential. The earlier [preview verification](audits/2026-09-02-tradeops-preview-verification.md) and [design refresh](audits/2026-09-03-tradeops-design-refresh.md) are historical records, not the current page design.

This restores the older TradeOps styles, shell, thirteen destinations and page compositions in `apps/operations-console`, retaining the current paper/observation APIs. It is a read-only local preview, not a production deployment or a broker-execution dashboard.

## Start locally

Use Node.js 22–26. From this feature checkout:

```sh
cd apps/operations-console
npm ci
env -u NEXT_PUBLIC_API_BASE_URL npm run build
npm run preview:tradeops
```

Open [TradeOps on this computer](http://127.0.0.1:4173/). `npm ci` is unnecessary when this checkout's locked dependencies are already installed. Keep the preview process running; Ctrl+C stops it. The server requires the exported `out/index.html`, so rebuild after changing the interface.

The build must use same-origin API paths. Do not set `NEXT_PUBLIC_API_BASE_URL` in the shell or an application environment file for this preview. Never put a credential in build configuration. There are no application environment files in the verified checkout.

## Unlocking paper data

Public health and observation receipts load without a credential. To view protected paper records, enter your existing **paper operator credential** directly in the password field and choose **Unlock paper data**. Do not paste it into chat, a URL, or source code.

The credential lives only in the running tab's memory. The input clears on submission; **Lock paper data**, a page reload, or an unauthorized response clears protected session data. Locking also removes account/setup filters and the selected inspector from the visible interface. No credential is read from the old database, local storage, cookies, or deployment secrets.

Authenticated production integration requires a valid credential supplied by the operator. Tests with fixtures are not evidence of actual account balances or live execution.

The locked layout retains the original workspace sections with one compact unlock form at the top. Protected values remain unavailable until unlocking; they are not populated with example values. **Connection details** expands the same six source statuses without making extra requests. Refresh failures and retained stale data also produce a notice above the workspace, so warnings are not hidden inside the disclosure or below long tables. Source freshness describes a response timestamp, not the age of its observations.

All thirteen original destinations are navigable and support direct static URLs. Accounts opens source details from overview cards. Risk retains Monitor/Guards/Risk Rules/Strategy sections. Journal keeps its summary, filters, Table/Calendar views, historical sections and loaded-record inspection; Analytics retains the Performance Intelligence composition. The eight service-dependent pages keep their distinct forms, tables and local tabs. Disabled controls explain the missing service; merely opening a page does not activate it.

## Connected surfaces

| Surface | Source and meaning |
| --- | --- |
| API status | `/health/live`; does not establish broker connectivity |
| MT5 health on Dashboard / Accounts; separate EA badge | Opt-in `/api/v1/mt5-health-summary`; accepted heartbeat, reported terminal/permission flags, build, symbol, sequences and up to 20 sync outcomes. Not broker account identity, balances or fills |
| Observation log | Public `/api/v1/observation-receipts`; observations are not trades and are not account-attributed |
| Accounts and account strip | `/api/v1/paper-accounts` joined by ID with the simulation summary; ledger and simulation balances remain separately labeled |
| Setups and inspector | `/api/v1/rd-entry-decisions`; model evidence, rule failures, fidelity, selection and explicit paper linkage |
| Open paper positions and Journal | `/api/v1/paper-simulations/summary`; OPEN versus SETTLED paper intents, not broker fills |
| Risk & Rules | `/api/v1/paper-readiness`; reported thresholds, reasons and read-only kill switch; READY is paper readiness only |
| Analytics | Source-provided account aggregates plus explicitly separate loaded-window intent counts |

Account monetary aggregates stay grouped by both currency and scale. Missing values display as unavailable, not zero; broker equity is never inferred. Account aggregates remain unfiltered. Setup attribution to an account requires an explicit linked intent and allocation, so unlinked decisions are excluded when an account is selected.

The intent and decision lists cover at most 50 returned records. Search and model filters operate locally on that window; they do not query lifetime history. A multi-account paper intent remains one intent in window statistics. Window win rate uses settled outcome R, while account win rate uses the returned account aggregates. These scopes must not be combined.

## Local transport and refresh

The preview binds only to `127.0.0.1:4173` by default (`--port` can choose another loopback port). Observation/paper requests use the existing fixed observation Worker; the optional MT5 read uses the fixed private health Worker described below. There is no arbitrary upstream or filesystem-root setting. It accepts only the six existing GET routes plus the one MT5 health GET route, validates limits, Host and browser Origin, and rejects cross-site requests, mutations, redirects and unlisted API paths.

Authorization is forwarded only on the four protected routes. Cookies and unrelated request headers are not forwarded. The server bounds each upstream request and response body to six seconds and 2 MiB, serves only the static export, and does not log credentials or upstream response bodies. It does not change production CORS.

One shared refresh cycle runs every 30 seconds while the tab is visible and online: two public reads while locked, plus four protected reads when unlocked, plus one MT5 read when explicitly connected. Navigation and filters do not create extra polling. Existing observation/paper client GET retry limits remain in place; the preview proxy and MT5 loader add no retries. Stale data keeps its last-success timestamp during failures and retries. This does not change Cloudflare's plan or promise unlimited free usage.

The desktop header clock has a separate local one-second display timer; it makes no requests. Market-session cards show the original fixed-UTC reference schedule, not verified broker opening hours or trading permission. Local form drafts and tab selections are not saved to a backend or browser storage.

## Connect the existing private MT5 health feed

Stop the current preview, then start from `apps/operations-console`:

```sh
npm run preview:tradeops -- --mt5-health
```

The installed `cloudflared` CLI opens the normal Cloudflare Access login when needed. Complete that sign-in, wait for the local preview address, then choose **Read MT5 health** on Dashboard or Accounts. Paper unlock is separate and is not required for MT5 health. Do not paste Access tokens, EA credentials or broker passwords into the page or chat.

Explicit startup runs `cloudflared access login --app <fixed-health-origin> --no-verbose` with captured output, a 120-second deadline, and bounded output/token lengths. No login runs from a request handler or polling timer. Failed login still starts the preview disconnected. An expired/rejected session clears private health data and stops health polling; restart with the same flag, sign in, then choose **Read MT5 health** again. The page never receives the Access token.

Only the server-owned `Cf-Access-Token` is sent to `https://prop-trading-agent-health-console-dry-run.ameer-1996112.workers.dev/api/v1/health-summary`. Browser cookies and paper authorization are not forwarded there. This new route allows no queries and uses a six-second deadline, 128-KiB limit, strict versioned schema and redacted failures. It follows no authentication redirects. Concurrent readers share one in-flight upstream read; disconnecting one caller does not cancel the others.

**Disconnect health feed** clears this tab's health data and cancels its pending reads; it does not revoke Access or stop another tab. Stopping the local preview clears its in-memory token copy. Cloudflared can retain its normal local authentication cache. This is a trusted single-machine development preview, not a hosted multi-user authentication design. No token is added to repository files, build output or browser storage.

Heartbeat freshness uses the service's 35/90-second boundaries: ONLINE through 35 seconds, STALE through 90, then OFFLINE. The older historical design's 20/60 boundaries do not match the inspected producer. Age uses the source clock plus elapsed local time; a display-only timer ages the badge without network reads. Fetch errors/paused updates have a separate warning and do not redefine heartbeat age. A recent rejected request does not advance the accepted heartbeat. Permission flags are reported diagnostics, not authority to trade.

The health service does **not** supply account login/server/demo identity, balance, equity, positions or fills. No empty position list or paper result is treated as broker evidence. Nominal extra health traffic is at most 2,880 scheduled reads/day if continuously visible, excluding manual refreshes/reconnects; this is not a guarantee about account-wide free-tier use. No polling frequency or write behavior on the existing EA is changed.

## Intentionally disconnected

- The older Supabase database and its historical records are not read, changed or imported.
- Broker positions, fills and equity are unavailable; this dashboard cannot open, close or amend trades.
- Exec Quality, Alerts, Prop Firm, Alert Setup, Optimizer, Strategies, Notifications and Settings are navigable. Their unsupported operations remain disabled inside the restored page layouts, with explanations and unavailable values.
- No Railway, MetaAPI, paid feed, AI service, legacy `/backend` proxy or synthetic-data fallback is introduced.
- Pine, TradingView, MT5/EA, Workers, database schemas, bindings and secrets are unchanged.

The source-derived presentation is pinned to donor commit `cc740a197209cef27374ca6166a505b14af54ab6`. Original global and Sovereign Terminal CSS are retained. Service-page provenance is mapped in `src/features/tradeops/original/PROVENANCE.md`. Bundled Inter, JetBrains Mono, Outfit, Space Grotesk and Lucide notices are preserved in `apps/operations-console/public/third-party-notices.txt` and included in the static export.

The branch `codex/tradeops-dashboard-migration` is retained for review. Pushing, merging, deploying, connecting legacy history or enabling execution requires a separate decision.
