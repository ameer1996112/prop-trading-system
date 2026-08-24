# TradeOpsAgent — DRY_RUN heartbeat source

This source is a non-trading MT5 heartbeat client. It has no order, modification,
close, or position-management capability. It is source only: no EA has been
attached, no request has been sent, and no trading platform setting has changed.

## Current safe state

Compile the EA and optional self-test only. **Do not attach** either program to a
chart during this phase. Keep **Algo Trading disabled** and **DLL imports disabled**.
Do not add a WebRequest allowlist entry until the Cloudflare edge is separately
deployed and its origin has been explicitly approved by the operator.

The future intended attachment is one chart: `EURUSD`, M5. Its only possible
status labels are `DRY_RUN_READY`, `SYNC_OK`, `SYNC_WAITING`, `SYNC_REJECTED`,
`PROFILE_REJECTED`, `CONFIG_REJECTED`, and `STOPPED`. None represents a trade
instruction or permission.

## Local configuration — not committed and not compiled

After separate deployment approval, create the ignored runtime-only file below in
the MT5 data folder under `MQL5/Files`:

```text
TradeOpsAgent/local/config.ini
```

It must contain exactly one value per key. `endpoint` must be the separately
approved HTTPS execution-edge origin and `bearer` is the raw secret; neither may
be placed in source, fixtures, screenshots, logs, or version control.

```ini
profile=DRY_RUN
endpoint=<approved edge origin plus /api/v1/agent/sync>
bearer=<raw bearer kept only here>
installation_id=<redacted installation identifier>
account_id=<redacted account identifier>
account_profile_sha256=<lowercase SHA-256>
broker_server_sha256=<lowercase SHA-256>
ea_sha256=<lowercase SHA-256>
manifest_sha256=<lowercase SHA-256>
symbol_capability_sha256=<lowercase SHA-256>
reconciliation_sha256=<lowercase SHA-256>
source_symbol=EURUSD
safety_epoch=1
```

The EA reads this file at runtime; it is not an include file and is never compiled.
It sends a bounded zero-event heartbeat every five seconds only after a future,
separate attachment approval. A failed or rejected response merely changes the
redacted chart status and waits for the next timer interval.

For future installation evidence, capture only: the EA version/hash, chart symbol
and timeframe, status label, HTTP status class, and the server response digest.
Do not capture the local configuration contents, bearer, endpoint, account login,
or broker server name.

`fixtures/agent-sync-v1.json` is deliberately redacted and generated/verified by
the TypeScript canonical JSON test. `Scripts/TradeOpsAgentSelfTest.mq5` contains
pure local digest and response-safety checks; it makes no network call.
