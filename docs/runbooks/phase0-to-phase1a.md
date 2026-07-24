# Runbook: exact gates before Phase 1A

Phase 0 code is delivered when `make verify-phase0` passes. Phase 0 closure and Phase 1A traffic
remain blocked until every item below has a `VERIFIED` evidence record whose artifact hash and
requirements reproduce under the deterministic evaluator.

1. Capture every exact Optimizer 1 input and feed/chart/session context from the operator; compute
   the settings hash without using Pine defaults.
2. Capture a redacted TradingView destination and message structure, create a dedicated canonical
   instance with diagnostics disabled, bind the approved manifest, and record alert recreation.
3. Commit approved Pine bytes in a clean source tree and prove working bytes equal that commit.
4. Provision and drill AWS Secrets Manager plus scoped workload identity (candidate), including
   versioning, rotation, audit export, backup/restore, revocation, and per-account scope.
5. Provision and spike Supabase Auth (candidate), proving server-side roles, MFA challenge/verify,
   revocation, and the separately implemented bound single-use action-grant protocol.
6. Provision and drill Grafana Cloud, Better Stack, and Resend candidates for required retention,
   bounded labels, evidence queries, independent dead-man timing, delivery, acknowledgement,
   escalation, export/restore, and surviving-channel failure behavior.
7. Establish a separate MetaApi identity containing only demo-provisioned retail-hedging accounts;
   prove arbitrary import disabled, no live-capable credentials, and per-account isolation.
8. Run the broker concurrency spike. A complete synchronization needs one generation, a common
   start cursor, every snapshot/history page, buffered updates, a common end cursor, gapless fold,
   matching history watermark, and Tier 0 durability. Timestamps, repeated identical polls, and a
   generic synchronized flag cannot pass.
9. Complete the legal tick-source review for capture, retention, replay, derived statistics, and
   redistribution limits. Separately prove upstream quote sequence/loss detection, contiguous
   coverage, reconnect backfill, clock tolerance, checksum, and capability behavior before using
   `SEQUENCE_COMPLETE`.
10. Deploy the collector only after authorization. Capture five consecutive correctly labeled
    EURUSD trading days including rollover, a gap/disconnect fixture, alignment, checksum/gap
    detection, encrypted retention, restore, and linked licensing evidence. Do not relabel
    observed-only data.
11. Before any Phase 1A request, complete the Tier 0/Tier 1 durability, PITR, restore, fencing,
    rollback, retention/capacity, and dual-channel alert proof in `docs/durability.md`.

When evidence is supplied, place only redacted/canonical evidence artifacts under the reviewed
evidence path, regenerate the registry/report, and obtain independent review. Never edit the
gate report directly. Phase 1A remains observation-only and still cannot add a broker command.

## 2026-07-23 observation-ingress override

The operator authorized a narrow exception so TradingView LAB alerts can be received and visible
before every Phase 0 evidence gate is verified. This exception does not mark any gate verified and
does not authorize trading.

Deploy the zero-cost edge package under `apps/observation-edge`:

1. Create its D1 receipt database and apply every tracked migration.
2. Store only the lowercase SHA-256 digest of a newly rotated TradingView credential as the Worker
   secret `TRADINGVIEW_OBSERVATION_CREDENTIAL_SHA256`.
3. Build the static operations console and deploy one Worker with D1 and Static Assets bindings.
4. Verify the stable `workers.dev` URL before changing any TradingView alert.

Never place the raw TradingView credential in Cloudflare configuration, Git, logs, D1, or the
dashboard. Docker Compose remains the local PostgreSQL fallback; Railway is not required.

Use the public API domain plus `/api/v1/tradingview/observations` as the TradingView webhook URL.
Update the LAB Pine source with the corrected JSON escape function, save it, and recreate alerts;
existing TradingView alerts retain the old script snapshot.

MetaApi is not a required dependency for this override. Paper execution stays internal. A future
account may use the free cTrader Open API only when that prop firm permits API automation, or a
local MT5 terminal bridge when MT5 is required. Each account needs its own dated automation and
copy-trading policy before it can leave paper mode; the legacy MetaApi evidence gates remain
blocked rather than being treated as implicitly satisfied.

Done means:

- Alembic reaches migration head.
- `/health/live` returns `200`.
- a valid Pine-shaped observation returns `202/RECEIVED`;
- its exact replay returns `200/DUPLICATE`;
- conflicting content under the same idempotency key returns `409`;
- a bad credential returns `401`;
- the receipt appears in the read API and operations console;
- `/webhook` and every broker/provider, live/imported-account, external-order, and fill route
  remain absent; only the separately protected PAPER_ONLY ledger and simulator routes below are
  permitted.

## Protected PAPER_ONLY registry/manual-ledger amendment

This amendment coexists with the observation-ingress override above and does not expand it into
strategy interpretation or execution. The PAPER_ONLY surface is restricted to this exact
allowlist:

- `POST /api/v1/paper-accounts`
- `GET /api/v1/paper-accounts`
- `POST /api/v1/paper-accounts/{account_id}/ledger-entries`
- `GET /api/v1/paper-accounts/{account_id}/ledger-entries`

There is no other paper route. All four routes fail closed unless
`PAPER_LEDGER_ENABLED=true`, and every request requires a separate paper-admin bearer credential.
Never reuse the TradingView observation credential as the paper-admin credential.

`POST /api/v1/paper-accounts` creates an immutable PAPER_ONLY account record. There is no account
update or delete operation. Ledger POSTs append only `MANUAL_ADJUSTMENT` entries; there is no
ledger update or delete operation. Monetary values are signed integer minor units under an
explicit currency definition, never binary floating-point values.

The ledger is manual administration only. A TradingView receipt or setup transition cannot create
a ledger entry, and no ledger entry represents an order, fill, position, trade, P&L event, or
broker/provider action. Do not describe these records as paper trades or execution.

Done means:

- with `PAPER_LEDGER_ENABLED` absent or false, all four PAPER_ONLY routes fail closed;
- with the gate enabled, missing or invalid paper-admin bearer authentication is rejected on every
  POST and GET;
- a created paper account cannot be mutated or deleted;
- only append-only `MANUAL_ADJUSTMENT` entries are accepted;
- adjustment amounts round-trip exactly as integer minor units;
- observations cannot create accounts or ledger entries;
- the existing observation-ingress acceptance proof still passes unchanged;
- no ledger route exists beyond the four-entry ledger allowlist, and broker/provider,
  live/imported-account, external-order, and fill routes remain absent.

## Protected broker-free paper-simulator amendment

The operator authorized explicit internal paper simulation. This amendment adds exactly:

- `POST /api/v1/paper-simulations/intents`
- `POST /api/v1/paper-simulations/intents/{intent_id}/settlement`
- `GET /api/v1/paper-simulations/summary`

All three routes fail closed under `PAPER_LEDGER_ENABLED` and require the paper-admin bearer
credential. The static console must never persist that credential; it may retain it only in memory
until refresh or operator Lock.

An intent explicitly supplies a versioned intent
identifier, symbol, side, entry, stop, target, risk basis points, and one or more PAPER_ONLY
account identifiers. D1 stores one immutable intent and one immutable risk allocation per account.
Risk is calculated from each account independently and is capped by the contract.

A settlement records one deterministic R-multiple outcome across the intent's allocations.
Settlement P&L uses integer minor units. Intent, allocation, and settlement updates/deletes are
forbidden, settlement replay is idempotent, conflicting replay is rejected, and a D1 trigger
prevents unsafe balances.

Schema 1.0 observations cannot create simulator facts. The separately authorized schema 1.1
automation amendment below permits only explicit, validated paper commands. Neither amendment
authorizes broker quotes, external positions, order placement, broker credentials, or prop-firm
connectivity.

Done means:

- the liveness document reports observation status, simulator status, and
  `execution=DISABLED` without the console falsely showing the observation API offline;
- missing or invalid paper-admin authorization is rejected before D1 access;
- one intent allocates risk independently across at least two PAPER_ONLY accounts;
- exact intent and settlement replay are idempotent and changed replay conflicts;
- one settlement projects per-account balance, realized P&L, open risk, wins/losses, and maximum
  drawdown;
- all simulator facts are immutable and append-only;
- the operator UI has locked, loading, invalid-credential, empty, and populated states;
- the observation receipt path still records the known EURUSD EDGE alert;
- `/api/v1/orders` and every broker/provider command path still return `404`.

## TradingView-to-paper automation amendment

This section documents the retained schema-1.1 simulator transport, not the current RD V2
producer. `SND_RD_5M_V2_LAB.pine` uses observation-only schema 1.2, exports frozen rule evidence,
and has no `OPEN`, `SETTLE`, or `paper_commands` path. Do not apply the enablement steps below to
V2 unless a later reviewed contract explicitly replaces this fail-closed policy.

The operator authorized autonomous broker-free paper bookkeeping. Updated Pine alerts use
observation schema `1.1`, strategy version `1.1.0-paper1`, and include a bounded
`paper_commands` array:

- `OPEN` contains the complete simulator intent contract and one or more PAPER_ONLY account IDs.
- `SETTLE` contains the deterministic intent ID plus an immutable STOP/TARGET R outcome.

The producer emits `OPEN` only on a confirmed `TRIGGERED` setup after the initial snapshot. Entry
is the confirmed trigger close constrained to valid directional geometry, stop is the zone distal
boundary, and target is the configured R multiple. An open paper intent is checked only on later
confirmed five-minute bars. If both stop and target are touched by the same bar, STOP wins.

The Worker authenticates and canonicalizes the entire observation, preflights every account,
intent, settlement, safe balance, and conflict, then records the receipt and all new paper facts
in one D1 batch transaction. A command failure prevents the receipt from being accepted. Existing
schema 1.0 alerts remain receipt-only and backward compatible.

Before enabling the TradingView input:

1. Apply D1 migration `0017_paper_automation_ingress.sql`.
2. Configure a separate Worker secret
   `TRADINGVIEW_PAPER_AUTOMATION_CREDENTIAL_SHA256`. It is accepted only for schema 1.1; retaining
   the existing observation credential keeps schema-1.0 alerts working during rollout.
3. Deploy and verify the Worker still reports `execution=DISABLED`.
4. Save/compile the updated Pine source and recreate the dedicated EDGE alert because existing
   alerts retain their previous script snapshot.
5. Set Paper account IDs to registered PAPER_ONLY accounts, keep risk between 1 and 500 basis
   points, and enable broker-free paper automation.
6. Confirm the next `OPEN` row is labelled `AUTO · TRADINGVIEW` in the protected console.

Done means:

- schema 1.0 receipt behavior is unchanged;
- malformed, unauthenticated, missing-account, conflicting, or unsafe schema 1.1 commands mutate
  neither receipts nor simulator facts;
- a schema 1.1 OPEN allocates at least two accounts and records TradingView receipt provenance;
- a later SETTLE projects deterministic per-account P&L;
- duplicate observations and commands are idempotent;
- ambiguous same-bar exits settle as STOP;
- `/api/v1/orders` remains `404` and no broker/provider credential or command port exists.

## Paper readiness monitor amendment

Apply `0018_paper_readiness_monitor.sql` and then
`0019_paper_readiness_atomic_gates.sql` after `0017`. Migration `0018` deliberately creates an
append-only `INITIAL_FAIL_CLOSED` kill-switch event; `0019` adds monotonic control ordering,
blocked-command evidence, and database-enforced allocation gates. After deployment:

1. Unlock the protected console with the paper-admin credential.
2. Confirm `/api/v1/paper-readiness` reports `STOPPED` with
   `KILL_SWITCH_ENABLED`.
3. Review receipt freshness, open intent age, daily loss, drawdown, aggregate risk, and position
   counts for every account.
4. Release the kill switch with a specific operator reason. The console supplies a unique
   idempotency key; do not reuse it for different content.
5. Confirm readiness becomes `READY`. `DEGRADED` means evidence needs attention and must not be
   treated as authorization to add a broker.

The initial paper validation limits are 5% daily loss, 10% total drawdown, 2% open risk, four
positions, 24-hour stale trades, and 15-minute receipt freshness. These are internal validation
limits, not claims about any specific prop firm's current rules. New manual OPENs receive `423`
while the switch is engaged. TradingView envelopes remain accepted as observation evidence:
blocked OPENs are recorded immutably, valid SETTLE commands in the same envelope continue, and the
response reports `BLOCKED` or `PARTIAL`. Candidate exposure and the current kill-switch state are
rechecked atomically by D1 when each allocation is inserted.

Done means:

- missing control state fails closed;
- every control change is append-only, reasoned, authenticated, and idempotent;
- fresh evidence inside every limit reports `READY`;
- missing/stale delivery evidence reports `DEGRADED`;
- a hard account breach or kill switch reports `STOPPED`;
- new OPENs stop while SETTLE remains available;
- execution remains disabled and `/api/v1/orders` remains `404`.
