# Worklog

## 2026-07-29 — RD BOC three-entry paper contract

- Restored BOC as a first-class version 3 entry model alongside directional close and HTF flip;
  BOC is never normalized into flip.
- Added exact Python/TypeScript parity vectors and a versioned Pine producer that observes all
  three candidates independently.
- Added chronology-first arbitration, same-event BOC/flip co-trigger handling, immutable decision
  freeze, and at-most-one initial paper intent per setup.
- Added append-only D1 event, candidate, evidence, selection, parity, paper-link, shadow, exit, and
  conflict facts through migrations 0024 and 0025.
- Added a bounded decision API and operations-console ledger that always explains all three model
  rows, selected/competing candidates, blockers, parity, and linked paper state.
- Extended the global broker/live boundary scan to contract-v3 edge sources and added a
  reproducible paper-only rollout and rollback runbook.
- TradingView compile, add-to-chart, and live-tick smoke remain manual deployment checks. No remote
  D1, Cloudflare, Railway, production, or TradingView state was changed by this implementation.

## 2026-07-23 — Paper readiness monitor and global stop control

- Added derived `READY`, `DEGRADED`, and `STOPPED` state from schema-1.1 receipt freshness, stale
  open intents, per-account UTC-day loss, drawdown, aggregate open risk, and open positions.
- Added an append-only, authenticated, idempotent kill-switch event log that starts fail-closed,
  blocks new manual and TradingView OPENs, and continues to allow SETTLE.
- Added monotonic control ordering, immutable blocked-automation evidence, strict receipt inserts,
  strict simulator mutations, reciprocal intent-state guards, and a D1 allocation trigger so
  candidate risk and kill-switch checks remain atomic under races.
- Added a confirmed-five-minute-bar delivery heartbeat. Authenticated schema-1.1 incremental
  envelopes with no transitions or paper commands refresh receipt liveness without mutating any
  paper intent; schema 1.0 still requires a non-empty transition set.
- Added protected readiness and kill-switch APIs plus focused evaluator, route, migration,
  idempotency, atomic-block, and settlement-continuity tests.
- Added an operations-console readiness surface and explicit operator-reason control flow.
- Broker execution and `/api/v1/orders` remain absent.

## 2026-07-23 — TradingView-to-paper automation

- Added backward-compatible observation schema 1.1 with strict versioned `OPEN` and `SETTLE`
  paper commands; schema 1.0 remains receipt-only.
- The Worker preflights account existence, risk, price geometry, immutable conflicts, settlement
  safety, and then batches the receipt with simulator mutations in one D1 transaction.
- Updated the Pine producer to create deterministic intents on confirmed setup triggers and settle
  them on later confirmed bars. Same-bar stop/target ambiguity resolves conservatively to STOP.
- Added durable TradingView receipt provenance to automated intents and an `AUTO · TRADINGVIEW`
  console label.
- No broker SDK, quote feed, order endpoint, external position, prop-firm credential, or execution
  port was added.

## 2026-07-23 — Protected multi-account paper simulator

- Corrected the operations console health parser: the live Worker reports `OBSERVATION_ONLY`, not
  the obsolete `FOUNDATION_OBSERVATION_ONLY` value that caused a false `API OFFLINE` display.
- Liveness now distinguishes observation API availability, protected paper-simulator enablement,
  and broker execution (`DISABLED`).
- Added strict, versioned paper trade intent and settlement contracts with directional
  entry/stop/target validation, risk-basis-point bounds, canonical idempotency, and conflict
  handling.
- Added immutable D1 intent, per-account allocation, and settlement facts plus a safe-balance
  trigger and a projection for balance, realized P&L, open risk, wins/losses, and drawdown.
- Added a credential-protected operator panel. The credential exists only in React memory and is
  cleared on refresh or Lock; it is not stored in local/session storage.
- TradingView receipts remain metadata-only and cannot create intents. No broker SDK, provider
  credential, quote listener, order route, or external command path was added.

## 2026-07-23 — Observation-only TradingView ingress override

- Operator explicitly overrode the Phase 0 no-ingress boundary to make LAB webhook delivery work.
- The exception is limited to authenticated validation, idempotency, persistence, and receipt
  visibility.
- No broker command, account credential, trade execution, or strategy-decision surface is added.
- Root cause of the previous HTTP 422 responses: LAB observation envelopes were sent to the legacy
  executable webhook contract.
- A Pine serialization defect also escaped every letter `r` as `\r`; the producer fix removes the
  invalid carriage-return replacement and requires alert recreation.
- The previously used TradingView credential must be rotated because it appeared in delivery logs.
- Ingress remains disabled by default and verifies only a configured SHA-256 credential digest.
- PostgreSQL stores only receipt metadata behind an append function and read projection; API
  transactions drop into the restricted `phase0_runtime` role.
- Railway-style PostgreSQL URLs are normalized to the pinned asyncpg driver.
- The container proof passes real migration, receipt, conflict, authentication, console, and
  no-execution-route checks.
