# Observation-only architecture

## Scope and dependency direction

This is a modular monolith scaffold with a deliberately narrow runtime:

```text
operations console -> FastAPI presentation -> application services -> domain contracts
                                             -> observation-only adapters
```

`prop_trading.domain` imports no framework. `prop_trading.contracts` owns strict versioned wire
schemas. `prop_trading.application` evaluates evidence/readiness and authenticates observation
envelopes. `prop_trading.adapters` owns PostgreSQL metadata, safe provider probes, and immutable
tick-fixture storage. API handlers validate bounded input and render application results.

All runtime I/O boundaries are async. Settings are read once through `prop_trading.config`; no
other runtime module reads the environment. PostgreSQL is represented as the future correctness
boundary. Redis is absent and can never be necessary for correctness.

## Structural paper-only isolation

Phase 0 is incapable of sending a broker command:

- no broker SDK is a dependency;
- no provider token, account secret, live/imported-account variable, or onboarding schema exists;
- no order/position command port or method exists;
- the only traffic-ingress route accepts a strict, authenticated TradingView LAB observation
  envelope and stores receipt metadata, never an order intent;
- receipt storage contains no raw payload or credential and runs under a restricted database role;
- provider probes return evidence only and the default probe performs no network request;
- static verification scans runtime sources and configuration for forbidden execution surfaces.

Future execution capability is not an extension of a Phase 0 adapter. It belongs to a separately
reviewed Phase 1C slice after the tenant, secret, synchronization, platform, and strategy gates.

### Protected PAPER_ONLY registry and manual ledger

The protected PAPER_ONLY registry is an administrative accounting sandbox, not a broker simulator
and not paper-trade execution. It permits exactly these routes:

- `POST /api/v1/paper-accounts`
- `GET /api/v1/paper-accounts`
- `POST /api/v1/paper-accounts/{account_id}/ledger-entries`
- `GET /api/v1/paper-accounts/{account_id}/ledger-entries`

Every one of these routes fails closed unless `PAPER_LEDGER_ENABLED=true` and authenticates a
separate paper-admin bearer credential. The paper-admin credential must not be shared with the
TradingView observation credential. No unauthenticated paper read or write route exists.

Paper-account records are immutable after creation. Ledger entries are append-only,
`MANUAL_ADJUSTMENT` records; they cannot be edited, deleted, or relabelled as orders, fills,
positions, trades, or broker activity. Monetary amounts use signed integer minor units with an
explicit currency definition. Binary floating-point money is forbidden.

The manual ledger has no observation-to-intent mapping. TradingView observations cannot create
accounts or ledger entries, and a ledger adjustment cannot claim that a strategy decision, order,
fill, position, or paper trade occurred. No broker/provider, live/imported-account, external order,
or fill route is permitted. The existing authenticated observation-ingress override continues
unchanged alongside this independently gated PAPER_ONLY surface.

### Protected broker-free paper simulator

The simulator is a separately named PAPER_ONLY projection over the immutable account registry. It
permits exactly these additional routes:

- `POST /api/v1/paper-simulations/intents`
- `POST /api/v1/paper-simulations/intents/{intent_id}/settlement`
- `GET /api/v1/paper-simulations/summary`
- `GET /api/v1/paper-readiness`
- `POST /api/v1/paper-readiness/kill-switch`

Every simulator route uses the same fail-closed paper-ledger feature gate and paper-admin bearer
credential. There is no unauthenticated account, intent, allocation, settlement, balance, P&L, or
drawdown read.

An intent is explicit versioned input: identifier, symbol, BUY/SELL side, fixed-decimal entry,
stop, target, risk basis points, and one or more immutable PAPER_ONLY account identifiers. It can
arrive through the protected operator API or as a schema-1.1 `OPEN` command inside the
authenticated TradingView observation envelope. The contract validates directional price
geometry and caps risk at 500 basis points. Account allocations are calculated independently from
each account's current integer-minor-unit balance inside D1's transaction boundary. Exact replay
is idempotent; changed content under the same identifier conflicts.

A settlement is a single immutable fact for an intent: outcome in thousandths of R and a
STOP/TARGET/MANUAL reason. Integer-minor-unit P&L is derived from each stored risk allocation.
Settlement triggers reject balances outside the cross-language safe-integer range. The summary
projects current balance, realized simulated P&L, open risk, wins/losses, and maximum simulated
drawdown per account.

Intent, allocation, and settlement tables are append-only. A schema-1.1 TradingView receipt can
atomically create or settle simulator facts, but only through strict `paper_commands`; schema 1.0
remains observation-only. Schema 1.2 is also observation-only and requires the frozen RD
rule-contract version plus complete per-setup rule and lifecycle evidence. The V2 Pine producer
uses schema 1.2 and has no `paper_commands` or `OPEN` path; non-exact and same-bar-ambiguous setups
are retained as `SHADOW_ONLY`. A future command producer requires a separately frozen contract and
reviewed mapping for entry, stop, target, per-account risk, and deterministic intent identity. The
simulator has no quote listener, order state machine, broker adapter, provider credential, or
external command port. `execution: DISABLED` in liveness means exactly that. The operator console
requires the paper credential and holds it in React memory only; it is not persisted to browser
storage.

### Paper readiness and stop control

Readiness is derived from durable evidence on every protected read. It combines the latest
schema-1.1 receipt, stale open-intent evidence, per-account daily simulated P&L, maximum drawdown,
aggregate open risk, and open-position count. The initial paper validation profile is explicit:
15-minute receipt freshness, 24-hour stale intent age, 500 basis points UTC-day loss, 1,000 basis
points total drawdown, 200 basis points aggregate open risk, and four open positions. Missing or
stale evidence is `DEGRADED`; any hard account breach or the global kill switch is `STOPPED`.

Kill-switch changes are append-only control events with strict content, operator reason,
idempotency key, payload hash, timestamp, and a monotonic control sequence. Migration starts the
switch engaged so a new environment is fail-closed. Exact replays remain idempotent. New manual
OPENs return `423`; TradingView envelopes persist their receipt plus immutable blocked-OPEN
evidence and continue to apply valid SETTLE commands from the same envelope, reporting `BLOCKED`
or `PARTIAL`. A D1 allocation trigger atomically rechecks the latest control state, candidate
exposure, position count, daily loss, and drawdown, closing application-level race windows. The
live-intent and blocked-intent tables also have reciprocal insertion guards, so one intent ID
cannot become both states under concurrent requests. The control cannot create an order or
contact a broker.

## Deterministic contracts

Canonical serialization uses UTF-8 JSON, ASCII-profile sorted object keys, no insignificant
whitespace, safe-range integers, and strings for exact fixed-scale decimals. Binary float,
`Decimal` objects, NaN/infinity, exponent numbers, duplicate input keys, non-list sequences, and
integers outside the cross-language safe range are rejected. SHA-256 is lower-case hexadecimal
over the exact canonical bytes. Python and TypeScript consume the same golden-vector file.

Prices are integer ticks, volume is integer lot steps, money is integer minor units plus currency
scale, and ratios/tick sizes are fixed-scale decimal strings. A string is not automatically a
valid decimal: schema validators pin its required scale and plain notation.

## Checkpoint and gap foundation

Contracts freeze one heartbeat per confirmed five-minute bar and a checkpoint every 12 bars.
Checkpoint chunks are staged only, bounded by the candidate approved-alert manifest, and carry
the confirmed bar close and logical sequence plus per-chunk and full-set SHA-256 metadata. The
typed chunk body includes each active setup's natural key, exact active state, reason, integer-tick
zone/liquidity geometry, and source candle. It verifies exact canonical byte length and digest,
natural-key-derived ordering/identities/bounds, negative-oracle geometry, and single-chunk full-set
count/digest. Multi-chunk assembly still requires every declared index
and full-set verification in a future Phase 1A stream-lock transaction. A 720-second timeout is
permanent for that checkpoint.

A gap declaration always freezes allocations, permanently taints setups spanning the gap and
those restored by its checkpoint, and forbids retrospective execution. Recovery can reach only
`ACTIVE_FOR_NEW_LIFECYCLES`, and only with a complete checkpoint identifier. Phase 0 defines and
tests these schemas. The override accepts only the narrower LAB setup-transition/snapshot envelope
and mutates only an append-only receipt projection; it does not interpret observations into
decisions or trades.

## Tick collector foundation

The immutable writer accepts typed fixture observations, canonicalizes them to JSONL, hashes the
exact bytes, and atomically renames a fully durable staging directory into its final append-only
name. A per-chunk advisory file lock serializes conforming threads/processes, so an orphan is
recovered or quarantined only after exclusive ownership is established. Every successful return
re-reads the final pair and verifies the manifest hash against final payload bytes. File-safe
identifiers and resolved-parent checks prevent root escape.

One chunk contains exactly one feed and account-capability ID. Ingest order, monotonic and UTC
receive order, connection generation, clock tolerance, licensing, reconnect backfill, collector
coverage, clock synchronization, storage encryption, and fixture status are persisted. Exact
eligibility is derived from all of them; contiguous sequence numbers alone are insufficient and
fixtures are capped at `CONTINUOUS_OBSERVED`.

Rule-pack risk periods are not accepted as documentary offset claims. The typed validator loads
the declared IANA zone from pinned bundled `tzdata==2025.2`, derives gap-forward/fold-early reset
instants, and checks the local label, UTC bounds, offset, resolution, uniqueness, and adjacency.
