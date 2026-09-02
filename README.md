# Autonomous Prop-Trading System — Observation and Paper Simulator

This repository contains a fail-closed observation receiver and broker-free paper simulator. It has
no broker command interface and no broker account credential settings. An explicitly enabled
TradingView observation endpoint may authenticate, validate, deduplicate, and record
non-executable LAB payloads:

```text
POST /api/v1/tradingview/observations
GET  /api/v1/observation-receipts?limit=50
```

Ingress is disabled by default. Enable it only with
`PTS_TRADINGVIEW_OBSERVATION_INGRESS_ENABLED=true` and configure the lowercase SHA-256 digest of a
dedicated, rotated TradingView credential in
`PTS_TRADINGVIEW_OBSERVATION_CREDENTIAL_SHA256`. The raw credential belongs only in the TradingView
script input and request body; it must never be committed, logged, stored, or returned.

Schema 1.0 remains receipt-only. Schema 1.1 may additionally carry strict broker-free paper
`OPEN`/`SETTLE` commands; these can mutate only the internal simulator tables and cannot reach an
external account. Schema 1.2 is the current RD contract-evidence transport: it requires the frozen
rule-contract version and per-setup rule/lifecycle evidence, rejects paper-command fields, and is
observation-only.

The separately protected PAPER_ONLY surface supports multiple immutable internal accounts and
append-only manual balance adjustments:

```text
POST /api/v1/paper-accounts
GET  /api/v1/paper-accounts
POST /api/v1/paper-accounts/{account_id}/ledger-entries
GET  /api/v1/paper-accounts/{account_id}/ledger-entries
```

All four routes fail closed unless `PAPER_LEDGER_ENABLED=true` and require a dedicated bearer
credential whose SHA-256 digest is stored as the Worker secret
`PAPER_LEDGER_ADMIN_CREDENTIAL_SHA256`. Keep the raw credential in an owner-only file outside the
repository, such as `~/.config/prop-trading-system/paper-admin.env`. Never reuse the TradingView
credential.

Manual ledger entries remain administrative bookkeeping only. A `MANUAL_ADJUSTMENT` is not an
order, fill, position, P&L event, or paper trade.

The protected paper simulator adds an explicit versioned intent and settlement surface:

```text
POST /api/v1/paper-simulations/intents
POST /api/v1/paper-simulations/intents/{intent_id}/settlement
GET  /api/v1/paper-simulations/summary?limit=50
GET  /api/v1/paper-readiness
POST /api/v1/paper-readiness/kill-switch
GET  /api/v1/rd-entry-readiness
```

An intent names one or more PAPER_ONLY accounts, side, entry, stop, target, and risk in basis
points. Account allocations are derived independently from each account balance. A settlement
records one deterministic R-multiple outcome and projects integer-minor-unit P&L and drawdown.
Intents, allocations, and settlements are immutable and idempotent.

The readiness endpoint evaluates each paper account against the initial validation profile:
5% UTC-day loss, 10% total drawdown, 2% aggregate open risk, four open positions, a 24-hour stale
trade boundary, and a 15-minute TradingView receipt heartbeat. It reports `READY`, `DEGRADED`, or
`STOPPED` with machine-readable reasons. The append-only global kill switch blocks new manual and
TradingView `OPEN` commands while continuing to permit `SETTLE`, so risk can be reduced while the
system is stopped. Manual OPENs receive `423`; automated envelopes remain observable, record each
blocked OPEN, and still apply valid SETTLE commands from the same envelope. Every control change
requires a reason and an idempotency key.

The canonical current three-entry Pine producer is
[`scripts/pinescript/SND_RD_5M_V3_RELEASE.pine`](scripts/pinescript/SND_RD_5M_V3_RELEASE.pine).
It emits the schema-3.1 / contract-3.1 PAPER_ONLY envelope. The older
[`scripts/pinescript/SND_RD_5M_V3_THREE_ENTRY_LAB.pine`](scripts/pinescript/SND_RD_5M_V3_THREE_ENTRY_LAB.pine)
is retained strictly as the immutable schema-3.0 historical rollback artifact; do not use it for a
new alert. Its frozen rule source is
[`docs/rd-strategy-rule-contract-v3.md`](docs/rd-strategy-rule-contract-v3.md). Contract v3 keeps
`BOC`, `DIR_CLOSE`, and `HTF_FLIP` distinct, evaluates all observed candidates, and lets the edge
select at most one paper decision by exact event chronology. Strict HTF-timed BOC can be paper
eligible; discretionary five-minute BOC is always visible but shadow-only. Atomic BOC/flip
co-triggers retain both model identities and create at most one paper intent.

The v2 producer and contract remain available for immutable historical records. The edge accepts
both schema-3.0 historical records and schema-3.1 current records, but new v3 alerts must use the
canonical schema-3.1 producer. Neither producer contains a broker command. Reviewed
TradingView **Any alert() function call** automatically sends the complete
`{credential,payload}` envelope; operators do not compose a separate message template. Reviewed
detector/settings identity and PAPER_ONLY account/risk configuration are required before the edge
can create an internal paper intent; missing or inconsistent authority fails closed to audit.
The reviewed detector and settings hashes are Worker secret bindings, not plaintext
`wrangler.jsonc` variables. The `secrets.required` list is schema/type/local-warning metadata only,
not a remote-value or deployment gate. Operators must list all four remote secret names before
deployment continuation, then prove the reviewed values after deployment with the signed strict
DIR_CLOSE decision/intent and replay checks before Pine emission. The exact procedure is in the
contract-v3 release runbook below.

`GET /api/v1/rd-entry-readiness` is an authenticated, bounded release-readiness summary. It
reports configuration presence, reviewed identity-binding mode, schema readiness, paper-readiness
state, and the latest decision action/reason without returning credentials, digests, raw payloads,
or unbounded ledgers.

This is simulation bookkeeping, not broker execution. The older schema-1.1 transport can
atomically create and settle internal simulator intents through authenticated observations, but
the V2 strategy producer deliberately uses observation-only schema 1.2.
Automated intents retain their receipt provenance and are labelled `AUTO · TRADINGVIEW` in the
console. No route can send, modify, or close an external order. The static console keeps the
paper-admin credential in memory only while the operator panel is unlocked; refresh or Lock
removes it from the UI.

The one proof command is:

```sh
make verify-observation
```

For the focused schema-3.1 lifecycle proof, run `make verify-paper-loop`. It exercises strict
wire rejection, current and historical ingestion, duplicate handling, paper-only selection and
settlement, shadow-only one-candle behavior, bounded authenticated reads, and the kill-switch
boundary. It does not call a remote Worker, broker, or trading platform.

Its container test migrates a fresh PostgreSQL database and proves a Pine-shaped empty snapshot is
accepted (`202`), replayed idempotently (`200/DUPLICATE`), rejected on conflicting replay (`409`)
and bad credential (`401`), listed by the read API, and rendered by the console. It also proves the
legacy executable `/webhook` route does not exist.

The zero-cost hosted path is one Cloudflare Worker serving the strict webhook API and static
operations console from the same stable `workers.dev` origin, with receipt metadata in D1. It
requires no Railway service, custom domain, always-on Mac, broker SDK, Redis queue, or account
credential. The protected PAPER_ONLY ledger and simulator reuse that Worker and D1 database, so
they add no separate hosting service. Docker Compose remains the PostgreSQL-backed local
development and recovery path.

See [docs/development.md](docs/development.md), [docs/architecture.md](docs/architecture.md),
[docs/threat-model.md](docs/threat-model.md), and
[docs/runbooks/phase0-to-phase1a.md](docs/runbooks/phase0-to-phase1a.md) for the development,
safety, and promotion contracts. The contract-v3 release procedure is
[docs/runbooks/rd-three-entry-paper-rollout.md](docs/runbooks/rd-three-entry-paper-rollout.md).
