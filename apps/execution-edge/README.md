# Execution Edge — Local DRY_RUN Agent Sync

This Worker is a broker-free heartbeat receiver for a future Windows MT5
agent. It never sends a trade command: the execution authority flag remains
`false`, the execution-mode ceiling remains `DRY_RUN`, and every agent-sync
response has `command: null`.

The existing `apps/observation-edge` Worker remains the TradingView ingress.
The checked-in `wrangler.jsonc` is intentionally inert: `workers_dev` and
`preview_urls` are disabled, agent sync is disabled by default, and its D1 ID
is a non-routable placeholder. Do not change those defaults for local work.

## Local agent-sync check

Run this from `apps/execution-edge` only:

```sh
cp .dev.vars.example .dev.vars
# Add only AGENT_SYNC_SHARED_SECRET_SHA256=<lowercase sha256>; never add raw bearer text.
npx wrangler dev --local
```

`AGENT_SYNC_ENABLED=true` in the copied local file is the sole local override.
Set `AGENT_SYNC_SHARED_SECRET_SHA256` to the lowercase SHA-256 digest of the
local bearer value. Keep the bearer value outside this repository and do not
put it in `.dev.vars`, source, fixtures, logs, or screenshots. A missing,
empty, or placeholder digest must be treated as disabled authentication.

The local command bundles and runs against local resources only. It does not
deploy a Worker, create a D1 database, apply a remote Durable Object migration,
upload a secret, configure MT5, or connect to a broker.

## Future remote setup is a separate decision

A remote deployment requires separate owner approval. Before that approval,
the operator must provide a non-placeholder D1 ID, create the required
Cloudflare secret binding named `AGENT_SYNC_SHARED_SECRET_SHA256`, obtain the deployed
origin over HTTPS, and approve the remote Durable Object migration. None of those remote
steps are part of this repository's local setup, and no deployment command is
provided here.

## Local verification

From the repository root, install the execution-edge dependencies and run its
local checks:

```sh
npm --prefix apps/execution-edge install
npm --prefix apps/execution-edge test
npm --prefix apps/execution-edge run lint
npm --prefix apps/execution-edge run typecheck
npm --prefix apps/execution-edge run build
./scripts/verify-execution-edge-foundation.sh
```

The build is a Wrangler dry-run only. The verification script removes common
Cloudflare API-token variables and enables CI/no-metrics mode before it runs;
it must not be used to deploy or contact Cloudflare resources.

## Local secrets

`apps/execution-edge/.dev.vars` is local and secret: keep it out of version
control. The only secret-shaped value this phase accepts is the hash binding
name above; the raw bearer value is never stored by this Worker.
