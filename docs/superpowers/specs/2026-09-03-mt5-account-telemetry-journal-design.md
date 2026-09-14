# TradeOps — read-only MT5 account telemetry and forward-only journal

Date: 2026-09-03

Status: written specification approved by the user's “ok lets do it” on 2026-09-03 after the specification handoff. Stage 1 local pure helpers and tests are implemented and independently reviewed; the full execution-edge suite passes 335 tests. Runtime integration, installation, and deployment have not started.

## Outcome and approved scope

Keep the restored, familiar TradeOps frontend and extend the existing Windows EA → Cloudflare → private dashboard reporting path. Show real account financials, current exposure, and a durable journal beginning at the upgrade. Do not import earlier trading history.

The user selected “from the upgrade onward” and approved these additions: account identity, journal completeness, accurate results including costs and exit reasons, and useful synchronization diagnostics. Include account activity from manual trading and other EAs; do not automatically attribute it to this strategy.

This is one end-to-end read-only reporting feature with three dependent implementation slices: capture/contract, durable storage/private reads, and existing-dashboard integration. Trade execution, alert-to-order tracing, challenge enforcement, strategy changes, risk sizing, advanced analytics, and another frontend redesign are separate projects.

All modes remain `DRY_RUN`, all command responses remain `null`, and execution authority remains disabled. Demo/live is a broker-reported account property, not an execution permission. No automatic paid-plan upgrade or new paid service is part of this design.

## Evidence and repository boundaries

- Frontend destination: `/Users/ameeramer/.config/superpowers/worktrees/prop-trading-system/tradeops-dashboard-migration`, branch `codex/tradeops-dashboard-migration`, inspected HEAD `18e29ce68d9e9fc89311163e95dd2b71f040c527`. Preserve the existing uncommitted restoration and MT5-health work.
- Matching EA/backend source: `/Users/ameeramer/.config/superpowers/worktrees/prop-trading-system/mt5-stale-payload-recovery`, inspected revision `8a801423bc19b3bb27c8e24f45d2800a9deb6881`. Relevant components: `mt5/TradeOpsAgent`, `apps/execution-edge`, `apps/agent-health-console`. These do not exist in the frontend worktree. Plan changes in their owning lineage; do not merge branches or copy whole services into the frontend branch as an incidental step.
- The four uploaded EA source files match that source revision byte-for-byte. This does not attest to the compiled EX5 currently running on Windows. Version `1.000` is in the uploaded EA; terminal build 6140 is a separate fact.
- The EA currently sends financial values as null, orders/positions/events as empty arrays, and accepts only event acknowledgement zero. The current dashboard read projects heartbeat health, not account finances or a journal.
- The v1 sync validator contains some financial/exposure fields but lacks account currency/scale and a complete deal record. Its symbol allowlist is execution-oriented, and ticket fields use JavaScript-safe numeric integers. Do not reuse these restrictions for account-wide observation or silently change the v1 schema.
- `AccountCoordinatorV1` retains sequencing, response bytes, and heartbeat summary, not journal event bodies. It advances an event watermark without retaining those events. This is not sufficient journal durability. The current HTTP path also distinguishes first acceptance from exact retry when writing health; the new path must explicitly test recovery after database failure.
- Existing local health integration is described in `2026-09-03-mt5-health-connection-design.md`. Preserve its authentication isolation, stale-state behavior, existing paper/observation routes, and single polling owner.
- Planning inspection identified a frozen health-service source/query allowlist and integrity manifest in `scripts/verify-mt5-dry-run-boundary.mjs` and `apps/agent-health-console/dashboard-integrity-manifest.v1.json`. New read routes require a narrowly reviewed boundary update; never skip verification, auto-regenerate the manifest in CI, or allow arbitrary SQL/network capabilities to make checks pass. The existing EA source test also forbids transaction callbacks in its heartbeat-only version; update that assertion only when implementing the approved read-only collector, retaining all broker-mutation prohibitions.

## Approaches and decision

1. **Selected: versioned account reporting in the existing EA and existing Worker/database, read through the existing private dashboard service.** One reporting owner, familiar interface, no new service dependency. Requires coordinated source changes and a separately approved rollout.
2. Populate only the existing v1 placeholders. Smaller superficially, but does not solve financial precision, account identity, journal durability, or exposure schema restrictions. Rejected.
3. Introduce another collector/service/database. Separates reporting deployment, but adds an installation, authentication path, and operational burden. Rejected. Do not migrate the older project's Supabase database in this feature.

## 1. Start boundary and account identity

Tracking starts when the upgraded EA can validate the configured account identity, obtain a usable broker time, and durably initialize its reporting state. Merely compiling a file, opening a chart, or failing initialization does not start the journal. Display “tracking not started” until this succeeds.

Persist an immutable tracking identifier, account fingerprint, broker-time start boundary, captured UTC observation time, and the initial exposure baseline before publishing reports. Register this same identity/boundary with the server on first acceptance. Preserve it across chart reattachment, terminal restart, reconnect, and later EA updates. Never silently reset it because state files are missing or corrupt when a server-side tracking registration already exists.

History filtering uses broker time, with the original broker-time value retained. Do not assume the broker clock is UTC or apply today's offset to all historical timestamps. Where the broker start clock has only second precision, record the already-existing deal IDs at the boundary second so an inclusive recovery scan does not import pre-start deals from that second. Initialization and boundary filtering need dedicated race tests. Clock discontinuities invalidate the completeness claim until reconciliation can establish coverage.

The EA validates its configured account/server fingerprint before every capture and transmission. An account switch or identity mismatch stops private account uploads; never relabel another account's data with the previous identifier. Simultaneous reporting EA instances for the same installation must be detected and refused, not allowed to compete for the same journal.

Account display fields: broker/company and server label, masked login (last four digits only), account currency and decimal precision, account mode `DEMO` / `REAL` / `CONTEST` / `UNKNOWN`, and margin mode. Keep the full login local; compute the existing identity fingerprint locally. Raw credentials, unrestricted comments, and configuration files are never uploaded or logged. Identity is reported by the authenticated EA, not independently broker-attested.

MT5 documents currency precision and account modes in [Account Properties](https://www.mql5.com/en/docs/constants/environment_state/accountinformation). Its [HistorySelect](https://www.mql5.com/en/docs/trading/historyselect) interval uses server time and can fail; failure must not be interpreted as an empty history.

## 2. Capture model and precision

Use one EA instance to enumerate account positions and pending orders, including symbols other than its attached chart. Observation of a symbol grants no strategy eligibility or permission to trade it. Keep any strategy/execution allowlist unchanged.

Capture modules have separate responsibilities:

- **Account snapshot:** balance, equity, used/free margin, nullable margin level, identity, and observation times.
- **Exposure snapshot:** current positions and pending orders, symbol, direction, volume, entry/current price where available, SL/TP, floating result, order state, and stable broker identifiers.
- **Journal collector:** broker deals, terminal-reported transaction facts, and observed exposure changes after the start boundary.
- **Local outbox:** persistent event sequencing, immutable pending request, acknowledgement and recovery state.

Tickets and position identifiers travel as decimal strings, not floating-point JSON numbers. Preserve both position ticket and stable position identifier; do not use symbol alone as the trade identity. Financial amounts use signed decimal strings with explicit account-currency scale; prices and volumes use validated decimal strings with explicit precision. Normalize once at the collection boundary, reject overflow/non-finite values, and use exact decimal arithmetic in aggregation. Missing readings are null with a reason, not zero. Do not assume USD, two currency decimals, or a universal tick/lot size.

Every snapshot declares capture status, actual total counts when known, and capture timestamps. An unsuccessful or bounded-out enumeration is incomplete; it must not erase previously known positions or prove a position closed. The private read retains the last complete exposure snapshot separately from the latest failed attempt and visibly ages it.

Initial application bounds: 256 KiB encoded sync request; at most 128 current positions and 128 pending orders; at most 32 journal events in one request. These are safety bounds, not Cloudflare limits. Defer surplus journal events to later cycles. If a complete exposure snapshot cannot fit, send a bounded error/status and retain the last complete one rather than truncating without notice. A single unsupported event is quarantined locally with a visible gap; it must not be discarded or acknowledged as recorded.

## 3. Journal meaning and completeness

The durable source is a broker-deal ledger, not a one-label-per-order approximation. Capture deal/order/position IDs, symbol, broker execution time, direction and entry/exit/reversal type, volume, fill price, profit, commission, swap, fee, and the broker-reported reason. Record initial and subsequently observed SL/TP values. Preserve provenance for observed changes; do not invent an exact modification timestamp when only a polling snapshot proves the change.

Group deals by account and stable position identifier, retaining individual fills and partial closes. Handle netting reversals explicitly as closing and opening portions; never double-count their volume or costs. A reversal's opening/closing cost allocation is unknown unless the broker data supports it: keep the deal-level amount and mark derived trade totals incomplete. Pending-order disappearance is not itself evidence of a fill or cancellation.

Show gross realized result, separately itemized signed costs, and net recorded result. Net aggregation uses each broker amount once. Deposits, withdrawals, credits, corrections, and standalone balance operations remain a separate account-activity category, not trading wins/losses. Do not force an unlinked charge onto a guessed trade. Corrected/cancelled broker deals are preserved as revisions and replaced in the current projection without counting both versions as independent profits.

Positions open before tracking appear in the baseline and continue to be reported. Their later exits/costs can be in the journal, but the trade remains labelled “opened before tracking — earlier history excluded.” Show recorded-since-start values without claiming complete lifetime P/L or R-multiple. Do not infer initial risk from a later/moved SL, or include incomplete lifecycles in win-rate calculations. Advanced performance statistics are out of scope.

Broker reason identifies the immediate cause of a deal, not necessarily who originally opened the position. Preserve origin and exit reason separately. A broker `EXPERT` reason means EA/script, not necessarily this strategy. Unverifiable strategy attribution stays unknown.

Completeness is independent of heartbeat health:

| State | Required meaning |
| --- | --- |
| Not started | No durable tracking boundary yet. |
| Catching up | A recovery scan or unsent journal batch remains. |
| Up to date through … | Broker reconciliation finished through the displayed watermark and all events through it have durable server acknowledgement. |
| Data missing | Capture, local persistence, unsupported data, broker-history availability, or identity/clock consistency prevents establishing coverage. Show the specific reason. |

“Up to date” applies only to supported broker deal records through that watermark. It does not claim every intermediate SL/TP change during an offline period can be reconstructed. Surface such observation gaps separately. Financial snapshots, journal coverage, terminal connection, and API availability each have their own freshness indicators.

Source semantics: [MT5 Deal Properties](https://www.mql5.com/en/docs/constants/tradingconstants/dealproperties) distinguishes entry/exit/reversal, costs, corrections, and broker reasons; [Position Properties](https://www.mql5.com/en/docs/constants/tradingconstants/positionproperties) supplies stable position identity.

## 4. Local reliability and versioned transport

Keep `OnTradeTransaction` bounded: record a small local observation/dirty marker and defer network requests and full history enumeration to timer work. Periodically reconcile broker history from the persisted start/recovery cursor, not solely from callbacks. Use bounded scan windows and resumable local cursors, with overlap and ID/content comparison to handle repeated timestamps and changed records. Include a rotating reconciliation pass over the tracked period to detect older broker corrections; never move the coverage watermark past unprocessed records.

The broker's callback queue is finite and event order is not guaranteed, which is why callbacks alone are insufficient ([OnTradeTransaction](https://www.mql5.com/en/docs/event_handlers/ontradetransaction)). Do not scan or upload history predating the start boundary as a backfill.

Use separate versioned reporting files for the start boundary, outbox, and pending request. Preserve the existing v1 `sync-state.ini` and `local/config.ini`; do not erase or reinterpret them. Use atomic replacement with validation/checksums for local state. Truncated/corrupt files and disk-full failures stop acknowledgement advancement and produce a visible error. Local compaction removes only acknowledged outbox records; journal events awaiting acknowledgement are never dropped to make space.

Add an explicit v2 sync contract at `POST /api/v2/agent/sync` on the existing execution Worker origin. Keep the v1 endpoint and byte-level response behavior compatible with the old EA. The upgraded EA uses one selected protocol, not simultaneous v1 and v2 uploads. Its existing 15-second timer owns capture and at most one network attempt per cycle; recovery batches share that budget. Bound retries/backoff after service errors, with no tight loop or one-second cloud polling.

V2 retains authenticated account/installation/profile binding, safety epoch, canonical hashing, monotonic request sequence, and exact-retry behavior. Add the immutable tracking identity, versioned snapshots, journal event batch and contiguous acknowledgement, collection/coverage status, and diagnostics. Explicitly version the local response parser; do not weaken the v1 rule that event acknowledgement must be zero.

A v2 response can acknowledge only contiguous events durably retained by the server. The EA validates protocol, identity, tracking ID, request/body association, response digest, bounded acknowledgement, and exact `DRY_RUN` / `command: null` before advancing local state. A non-null command is rejected, never executed. Persist acceptance locally before deleting acknowledged outbox data. Preserve exact pending bytes for uncertain outcomes; refreshing an unaccepted stale envelope must retain the same event identities and tracking start.

Diagnostics include reported EA release identifier, protocol version, terminal build separately, most recent successful upload, accepted sequence, local unsent count, scan progress, named last error, and local observation timestamp. Show configured hash values as configured/reported identity, never as cryptographic proof of the running binary. Remote diagnostics are only the last successfully uploaded report; when connectivity is lost the current unsent count may be unknown until reconnect.

## 5. Server durability and private reads

Reuse the existing account coordinator and `EXECUTION_DB`; no additional database, service, or binding is required by the design. Add new versioned tables without altering/deleting v1 state or historical audit data. Keep v2 identity, request/event sequencing, and health projections distinct from v1; a protocol switch must not let a small v2 sequence overwrite a higher v1 sequence through the old health upsert rule.

The existing health-summary read remains compatible: normalize the newest accepted heartbeat from either protocol into its existing health shape, choosing by original server acceptance time rather than comparing sequences across protocols. Preserve the chart/source symbol as a diagnostic field in v2 even though account exposure is multi-symbol. Exact retries and rejected uploads never advance heartbeat freshness. V1 clients continue using their unchanged write contract; the new account-summary read exposes protocol-specific sequence details explicitly.

V2 acceptance follows this ordering:

1. Authenticate and strictly validate the bounded body and account binding. Serialize same-account v2 acceptance in the coordinator; do not assume single-threaded JavaScript prevents interleaving across awaited I/O.
2. Consult the durable v2 receipt/session state in D1. Same sequence and same digest is an exact retry; same sequence with different bytes is a conflict. New events must continue the accepted sequence without gaps.
3. In one prepared-statement D1 batch, store the receipt, contiguous event records, deal revisions/current projection updates, latest valid account/exposure snapshot references, health/diagnostics, and coverage watermark. Make the sequence claim conditional and constraint-protected so concurrent or resumed attempts cannot both commit different batches.
4. Return the canonical stored response only after that batch commits. D1 is authoritative for v2 acceptance; a coordinator cache cannot manufacture an acknowledgement. A lost response or crash after commit is recovered by reading the stored receipt, not by re-inserting journal rows or advancing freshness again.

Never acknowledge first and persist journal events later in `waitUntil`. D1 batch rollback is documented in [D1 Database API](https://developers.cloudflare.com/d1/worker-api/d1-database/); it does not provide a transaction spanning D1 and Durable Object storage. Avoid that cross-store atomicity assumption. Use the existing coordinator as the serialized entry point and D1 as the single v2 commit authority. Check the installed runtime's [concurrency controls](https://developers.cloudflare.com/durable-objects/api/state/) during implementation.

Minimum storage responsibilities are tracking/session registration, current snapshot/status, immutable accepted request receipts, ordered journal events, broker-deal revisions/current projection, and efficient journal pagination. Uniqueness includes account fingerprint and tracking identity; an event ID/content conflict is surfaced rather than silently overwritten. All queries use bound parameters and account-scoped authorization. Do not put raw request bodies, credentials, full logins, or private account details in general Worker logs.

Extend the existing private health-console service with versioned GET reads for account summary and cursor-paginated journal. Continue using its existing Access protection and scoped account mapping; no public financial endpoint, arbitrary account lookup, new browser credential, or Access-policy change. Missing mappings fail closed.

Add fixed-path adapters to the existing local preview proxy. Preserve origin/host defenses, response bounds, timeouts, no-store headers, strict version checks, auth-expiry purge, and late-response cancellation. Only the journal pagination cursor is accepted where required; it is opaque, bounded, and validated by the server. Page size is fixed at 50 records with a deterministic event-sequence cursor, not an unbounded historical scan.

## 6. Familiar frontend and refresh

Use the existing Dashboard, Accounts, Positions, Journal, and connection-details surfaces; do not introduce another dashboard URL or layout redesign. Keep broker data visibly separate from existing paper/simulation records and never join them by guessed account IDs or matching symbols.

- Dashboard/Accounts: masked account identity, explicit demo/live badge, currency-aware financials, observation time, and journal coverage banner.
- Positions: current exposure and pending orders with SL/TP and data freshness, including the pre-start baseline label where applicable. No order/close/modify buttons.
- Journal: fill/deal detail and supported lifecycle grouping, itemized costs, partial-close and exit-reason labels, since-start boundary, and incomplete-history indicators.
- Connection details: EA version versus terminal build, accepted uploads/sequences, reported local backlog, and redacted actionable error codes. Do not call a heartbeat a fill.

Reuse the single visible/online 30-second refresh owner for current summary. Fetch the journal page only when the Journal view is active; deduplicate concurrent refreshes and cancel on disconnect/auth failure. Local age displays may tick without network activity. A healthy reporting cycle can take about 15 seconds to upload plus up to 30 seconds for the next UI refresh, before network delays. This is not the design for low-latency order execution and must not be advertised as such.

On transport failure retain permitted last-known data with timestamps/stale labels. On authentication loss or explicit disconnect purge private data. Schema errors, unknown finance, incomplete exposure, and absent journal records have distinct states. No fabricated balances, trades, zeroes, or success indicators.

## 7. Free-plan operating budget

The plan adds no Railway, MetaApi, paid analytics, cloud one-second timer, or background cloud scanner. One 15-second reporting owner schedules at most 5,760 upload attempts/day; the 30-second UI owner schedules 2,880 summary reads/day per continuously visible session. An active Journal view can add one paginated read per refresh. These are arithmetic planning bounds excluding startup/manual requests, other applications, and additional browser sessions—not an account-wide free-tier guarantee.

Retain one current snapshot instead of appending every balance tick to history. Write journal data only for new events/revisions; exact retries should not append duplicate receipts or repeat projection writes. Use indexes for account/sequence pagination; measure their write cost as well as row inserts/updates. Do not rewrite every stored position/deal on every heartbeat. Measure receipt-storage growth during the demo; any retention/deletion policy needs a separate explicit decision and must not delete the trade journal incidentally. If capacity prevents a durable write, return a visible storage error and preserve the local outbox instead of discarding receipts to continue silently.

Current official allowances include 100,000 daily Worker requests, 100,000 daily D1 row writes, and 100,000 daily SQLite Durable Object row writes. They are separate meters; request count does not prove database budget. Verify actual account-wide usage before rollout, including existing workloads. Quota errors preserve local events and show catching-up/failure states rather than trigger a plan upgrade. Sources: [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/).

Implementation acceptance includes an idle-day workload test with actual D1 `rows_written` accounting, representative journal bursts, retry storms, and read-query plans. A projected free-tier violation blocks rollout until write amplification/cadence is corrected or the user makes a new cost decision. Local test performance is not proof of deployed Worker CPU usage.

## 8. Verification and rollout gates

Required automated/local evidence:

- Start boundary persists across restart/reattach; no pre-start historical import; boundary-second duplicates, failed initialization, missing/corrupt state, and account switch fail safely.
- Multi-symbol enumeration, netting and hedging identifiers, very large tickets, currency precisions, decimal rounding, no SL, zero margin, read failures, and exceeded snapshot bounds.
- Manual/EA/SL/TP reason handling, multiple fills, partial closes, reversals, pre-start exposure, standalone costs/balance operations, corrected/cancelled deals, and unavailable origin/risk.
- Crash before local persistence, after local persistence, before server commit, after server commit/before response, and before local ACK persistence. No accepted event loss, duplicate P/L, unsafe sequence skip, or artificial freshness on retry.
- Out-of-order callbacks, overlapping history windows, backlog pagination, broker-clock changes, unavailable history, unsupported records, and recovered observation gaps. “Up to date” must be impossible with a known unresolved gap.
- Two concurrent EA instances/requests, identity mismatch, stale envelope renewal, wrong response digest/tracking ID, and non-null command rejection. No broker mutation APIs added to the EA.
- Private-read account isolation, absent Access login, expired auth, hostile cursors, strict request/response limits, token-free errors, and no public financial payloads.
- Regression tests for v1 `SYNC_OK`, v1 response checks, existing health-only clients, paper routes, restored UI/mobile layout, shared refresh ownership, and auth/stale-state behavior.
- Cloudflare write/read/CPU budgets and growing journal workload; compilation/tests of all changed packages. Compile MQL5 in MetaEditor on Windows and retain diagnostics; source/static tests alone cannot establish an installable EX5.

Phased implementation: first contract/capture with deterministic fixtures; then durable server storage and private reads with failure injection; then existing UI integration and end-to-end read-only replay. No phase is considered complete merely because fixtures populate the dashboard.

Rollout requires separate explicit approval for additive D1 migrations, Worker/private-read deployments, and installation of a specifically identified compiled EA on the configured demo account. Verify the actual current revisions/configuration before those operations; inspected source is not a live-deployment attestation. Preserve credentials, bindings, Access policies, v1 sequence files, and the start boundary. A source/build manifest must distinguish the uploaded source digest, produced EX5 digest, and self-reported runtime version.

Only after installation verify real balances, exposure, and post-start journal records against the user's MT5 account. Observe existing/user-initiated activity; do not create a broker trade merely to test reporting. Rollback to the old EA must preserve journal/start/outbox files and show a telemetry gap, not restart tracking silently. No commit, push, merge, deploy, migration, secret change, TradingView change, EA installation, or broker operation is performed by writing this document.

## Self-review and next gate

Reviewed for scope, precision, recovery, privacy, and consistency. The specification explicitly separates heartbeat acceptance from durable journal coverage, baseline exposure from historical import, broker facts from strategy attribution, and reporting latency from execution latency. Existing v1 behavior and user-owned frontend changes remain protected. Free-tier suitability requires measurement rather than a guarantee.

Next: expand the Stage 2 durable receiver plan using the verified Stage 1 helpers. Keep source and documentation local and uncommitted under the current workspace handoff boundary. Signal-to-trade tracing and demo execution remain subsequent, separately approved work.
