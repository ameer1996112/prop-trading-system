# Execution Edge Foundation

This phase is an inert contract and reconstruction foundation. It does not
connect to a Windows MT5 agent, a broker, or an execution account.

The existing `apps/observation-edge` Worker remains the TradingView ingress.
Execution-edge health is local-only until a separately approved deployment.
All candidate, agent-sync, and execution-authority flags must remain `false`.

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
control. `.dev.vars.example` lists names only—never values, placeholders, or
credentials.

## Next phase

The next phase is signed `/api/v1/agent/sync` plus an MQL5 `DRY_RUN` receiver,
followed by demo-only paper/canary promotion.
