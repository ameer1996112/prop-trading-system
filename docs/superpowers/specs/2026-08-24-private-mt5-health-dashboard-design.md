# Private MT5 health dashboard design

## Goal

Provide Ameer with a low-cost private dashboard that shows the health of the
Windows MT5 `TradeOpsAgent` dry-run heartbeat. The dashboard is visibility
only: it must never create, modify, close, or otherwise authorize a trade.

## Scope

The first release contains one private status page showing:

- Online, stale, offline, or unknown state.
- Last accepted heartbeat time and age.
- MT5 terminal connection state.
- Account, terminal, and Algo Trading permission states.
- Terminal build, source symbol, and latest request/server sequences.
- A bounded recent-sync timeline of accepted or rejected synchronization
  outcomes.

The page refreshes its data every ten seconds and includes a manual refresh
control. It uses the free `workers.dev` hostname initially.

The first release does not show balances, positions, orders, broker login,
broker server, bearer credentials, raw payloads, market prices, trade signals,
or execution controls. It does not send anything to MT5.

## Architecture

```text
Windows MT5 TradeOpsAgent
      | authenticated zero-event DRY_RUN heartbeat
      v
execution-edge Worker -----> D1 audit + current-health projection
                                      ^
                                      |
private agent-health-console Worker --+----> browser dashboard
      ^
      | Cloudflare Access email sign-in
      +---- approved operator browser
```

`apps/execution-edge` remains the only component that accepts MT5 syncs. Once
a sync response is validated and accepted, it records the existing immutable
audit outcome and updates a current-health projection containing only the
allowed health fields above. A rejected sync never updates the projection.

A new `apps/agent-health-console` Worker binds to the same D1 database in
read-only application behavior. It exposes a bounded health-summary endpoint
and serves its static dashboard assets from the same Worker origin. The browser
never receives the MT5 bearer and never calls execution-edge directly.

Cloudflare Access protects the health-dashboard Worker, including its
`workers.dev` hostname. The MT5 execution Worker is deliberately not protected
by browser Access because it uses bearer-authenticated machine-to-machine
heartbeats.

## Data model

Add a single `agent_health_current_v1` table keyed by the opaque account and
installation identifiers already used by the agent. Its projection contains:

- `account_id`, `installation_id`
- `last_accepted_epoch`, `request_sequence`, `server_sequence`
- `terminal_build`, `source_symbol`
- `terminal_connection_state`
- `account_trade_permission`, `terminal_trade_permission`,
  `algo_trading_permission`

No bearer, account fingerprint, broker-server data, raw request, raw response,
or financial/exposure field is persisted by the dashboard projection. Recent
history comes from the existing append-only `agent_sync_audit_v1` table and is
bounded by the API.

The API derives state from server time:

- `ONLINE`: most recent accepted heartbeat is within 20 seconds.
- `STALE`: last accepted heartbeat is older than 20 seconds and no older than
  60 seconds.
- `OFFLINE`: last accepted heartbeat is older than 60 seconds.
- `UNKNOWN`: no current-health projection exists or data cannot be read.

The API must not label a system online from a rejected heartbeat.

## API and UI contract

The dashboard Worker provides a same-origin `GET /api/v1/health-summary`
endpoint. Its response is schema-versioned and contains only the current
projection for the configured dry-run account/installation, derived status,
server time, and at most 20 recent redacted audit records. It returns
`UNKNOWN` rather than fabricating values when the database is unavailable or
no accepted record exists. It does not offer a client-controlled account or
installation selector in the first release.

The static page calls this endpoint on initial load and every ten seconds. It
has distinct visual states for online, stale, offline, and unknown. A manual
refresh only repeats this read request.

## Security and deployment

- The new Worker has no broker, order, position, MetaApi, or execution binding.
- Its source is checked by the existing dry-run boundary scanner extended for
  the dashboard paths.
- `EXECUTION_AUTHORITY_ENABLED` remains `false` and the execution mode ceiling
  remains `DRY_RUN`.
- The dashboard is protected through a Cloudflare Access policy allowing only
  Ameer’s approved email identity.
- The `workers.dev` URL is appropriate for the initial personal health view;
  a custom domain can be attached later without changing API or storage
  contracts.

## Test and rollout plan

1. Add migration and unit tests proving that only accepted syncs update the
   projection and that no disallowed field is written.
2. Add API tests for online, stale, offline, unknown, bounded history, and
   database failure behavior.
3. Add UI tests for each state and refresh behavior.
4. Run execution-edge and dashboard test suites, type checks, builds, and the
   dry-run boundary scanner.
5. Deploy the dashboard Worker, then immediately configure Worker-level
   Cloudflare Access for the dashboard only and permit Ameer’s email before
   treating the dashboard as usable.
6. Verify browser sign-in, `ONLINE` data, a forced stale display after the
   heartbeat age threshold, and that MT5 continues to sync while Access is
   enabled on the dashboard.

## Acceptance criteria

- The dashboard is private behind Cloudflare Access and reachable on a free
  `workers.dev` address after sign-in.
- It accurately displays the existing MT5 heartbeat as online when recent.
- It shows stale, offline, or unknown conservatively when data is absent or
  old.
- It shows no credential, account-login, trade, balance, position, order, or
  execution control.
- No dashboard request changes Cloudflare execution state, MT5 state, or broker
  state.
- All automated verification passes before deployment.
