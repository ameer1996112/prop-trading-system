# MT5 DRY_RUN Agent — Local Verification and Handoff

## Purpose and non-negotiable safety boundary

This runbook verifies source code and an optional local Worker only. It does
not activate a trading system. Every state in this document is **not demo**,
**not evaluation**, and **not live** trading.

The approved safety envelope is fixed for this handoff:

- `EXECUTION_MODE_CEILING` is `DRY_RUN`.
- `EXECUTION_AUTHORITY_ENABLED` is `false`.
- Agent-sync responses have `mode: "DRY_RUN"` and `command: null`.
- The MT5 source has no order, modification, close, or position-management
  API.

Do not reinterpret `DRY_RUN_READY`, `SYNC_OK`, or a successful local check as
permission to trade. They are health/verification states only.

## The three distinct states

| State | What it proves | What it does not do |
| --- | --- | --- |
| Source verified locally | TypeScript, Worker configuration, and MT5 source satisfy the repository's static and automated checks on the development machine. | It does not start a Worker, compile or attach an EA, send a request, contact Cloudflare, TradingView, MetaTrader, or a broker. |
| Worker running locally | A developer has deliberately started `wrangler dev --local` using only local state and the local hash binding. | It is not a deployed Worker, does not create Cloudflare resources, and does not give MT5, a demo account, an evaluation account, or a live account any authority. |
| Future Windows compile/attachment | After separate owner approval, the source can be compiled in MetaEditor and, later, attached to the approved Windows MT5 chart with the independently approved endpoint. | Compilation and attachment are not authorized by this runbook. They must not enable Algo Trading, add a WebRequest allowlist, or send a broker order. |

The current handoff ends at **source verified locally**. Do not perform the
second or third state merely because the first state passes.

## Preconditions

From the repository root:

```sh
cd /Users/ameeramer/Documents/ChatGPT/Trading/prop-trading-system-v3-design
git status --short
```

Expected evidence: no unexpected output. Resolve or explicitly account for
any existing change before verification; never use `git reset --hard` or
discard unrelated work to obtain a clean result.

Use Node.js in the range declared by
`apps/execution-edge/package.json` (currently `>=22.0.0 <27`). Install
dependencies only if they are not already present:

```sh
npm --prefix apps/execution-edge install
```

This installs local project dependencies. It does not deploy or configure a
remote service.

## Source verified locally

Run these commands from the repository root, in this order:

```sh
npm --prefix apps/execution-edge test
npm --prefix apps/execution-edge run lint
npm --prefix apps/execution-edge run typecheck
npm --prefix apps/execution-edge run build
node scripts/verify-mt5-dry-run-boundary.mjs
./scripts/verify-execution-edge-foundation.sh
```

Expected evidence:

- `test` reports all test files and tests passing. Record the exact test count
  printed by that run in the change/verification note; do not guess it.
- `lint` and `typecheck` exit with status `0` and report no TypeScript errors.
- `build` runs only `wrangler deploy --dry-run --outdir dist`; it produces a
  local bundle and does not publish it. Successful evidence includes
  `--dry-run: exiting now.`
- The boundary command prints `MT5 dry-run boundary verification passed.` and
  reports zero violations.
- The foundation command prints `Execution edge foundation verification
  passed.`; it removes common Cloudflare credential variables for its own
  process and performs the test/lint/typecheck/dry-run build checks again.

This state statically scans the MQL5 source but **does not compile it in
MetaEditor**. It is not a Windows or MT5 runtime test.

In a restricted development environment, Wrangler can print a local
`Failed to write to log file` permission warning even though its dry-run bundle
reaches `--dry-run: exiting now.`. Do not broaden log-directory permissions,
remove `--dry-run`, or deploy to suppress that warning. Instead, rely on the
following foundation command in this runbook: it reruns the same checks with
`WRANGLER_WRITE_LOGS=false` and must print `Execution edge foundation
verification passed.`. Any failure of that foundation command is a stop
condition.

Finish with:

```sh
git status --short
git branch --show-current
git log -1 --oneline
```

Expected evidence: only known/generated ignored artifacts, if any, are absent
from the short status; record the branch and commit actually shown. A clean
tree confirms the verification did not create a source change.

## Worker running locally — optional and separately deliberate

Do this only after source verification and only to test the local Worker shell.
It is not required for this handoff and must not be combined with a Windows MT5
attachment.

```sh
cd apps/execution-edge
cp .dev.vars.example .dev.vars
# In .dev.vars, add only:
# AGENT_SYNC_SHARED_SECRET_SHA256=<lowercase SHA-256 of the local bearer>
npx wrangler dev --local
```

`AGENT_SYNC_ENABLED=true` in the copied file is a local override only. Keep
the raw bearer outside the repository, `.dev.vars`, source files, fixtures,
logs, terminals captured in screenshots, and chat. Never enter a Cloudflare
API token to make this command work.

Expected evidence:

- Wrangler identifies local development; it must not show a deployment,
  publish, remote D1 creation, remote Durable Object migration, secret upload,
  or a Cloudflare account prompt.
- Health/sync responses, if deliberately exercised with a non-MT5 local test
  client, remain `DRY_RUN` with `command: null`.
- Stop the local process with `Ctrl-C` after the check. Do not turn it into a
  daemon or an internet-facing service.

The checked-in Worker configuration intentionally keeps `workers_dev: false`,
`preview_urls: false`, `AGENT_SYNC_ENABLED: "false"`, a placeholder D1 ID,
and `EXECUTION_AUTHORITY_ENABLED: "false"`.

## Future Windows compilation and attachment — explicitly deferred

The files under `mt5/TradeOpsAgent/` are source only. A future operator may
compile them in MetaEditor and then evaluate an attachment only after a new,
separate owner approval covering all of the following:

1. A separately approved, deployed HTTPS execution-edge origin exists.
2. A separately approved Cloudflare secret binding and non-placeholder remote
   D1/DO configuration exist.
3. The exact endpoint is approved before any MT5 WebRequest allowlist change.
4. The local ignored `TradeOpsAgent/local/config.ini` is created on Windows
   without copying its bearer, endpoint, broker server name, or account login
   into source control, logs, screenshots, or chat.
5. The MT5 chart/symbol/timeframe, EA binary hash, and evidence collection
   plan are approved.

Until all five items receive that new approval, do **not** compile/attach the
EA, add a WebRequest allowlist entry, enable Algo Trading, run the EA timer,
or send any request from the Windows computer. In particular, never use a demo
account, evaluation account, or live account as a shortcut for local testing.

Even after a future attachment approval, this EA is limited to a five-second
outbound health heartbeat and rejects any response that is not `DRY_RUN` with
`command: null`; it has no broker-order API in its source. That future work
still requires a distinct operational runbook and approval.

## Stop conditions and escalation

Stop immediately; do not work around the failure, if any of the following is
observed:

- A test, lint, typecheck, build, boundary, or foundation command exits
  non-zero, reports a violation, or produces a warning/error that changes the
  safety conclusion.
- The boundary verifier reports anything other than zero violations, or the
  foundation verifier does not print its success message.
- A command proposes or performs a non-dry-run deployment, remote resource
  creation, remote migration, secret upload, account login, or Cloudflare
  authentication.
- A raw bearer, endpoint, account login, broker server name, password, API
  token, or other credential appears in terminal output, a file, a screenshot,
  or a commit.
- An MT5 chart receives the EA, a WebRequest allowlist is changed, Algo Trading
  is enabled, a timer runs, or any request is sent without the separate future
  authorization.
- A broker, demo, evaluation, live, or TradingView action is suggested by any
  tool or command.

Preserve the failing command, its exit code, and redacted output. Report it for
review; do not relax the configuration, replace the placeholder IDs, add a
secret, or change execution flags to force a pass.

## Handoff attestation for this task

For this Task 6 documentation/verification phase, no Cloudflare remote
resource or deployment, Cloudflare secret, MT5 attachment, WebRequest
allowlist change, Algo Trading change, broker action, or TradingView change is
authorized or performed. No demo, evaluation, or live trading is enabled.

The only authorized result is a local source-verification record containing:

- branch and commit IDs actually printed after verification;
- exact passing test count and command exit statuses;
- the two verifier success messages; and
- confirmation that `git status --short` is clean after committing the
  documentation.
