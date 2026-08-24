# MT5 DRY_RUN Health Dashboard

This dashboard is read-only and uses the `AGENT_HEALTH_DB` D1 binding. Its Wrangler configuration contains no secret values.

## Operator runbook

1. Run tests and dry-run builds:
   ```sh
   npm --prefix apps/execution-edge test -- mt5-dry-run-boundary.test.ts
   node scripts/verify-mt5-dry-run-boundary.mjs
   npm --prefix apps/agent-health-console test
   npx --prefix apps/agent-health-console wrangler deploy --config apps/agent-health-console/wrangler.dry-run.jsonc --dry-run --outdir /tmp/agent-health-console-dry-run
   ```
2. Deploy the dashboard only after owner approval:
   ```sh
   npx --prefix apps/agent-health-console wrangler deploy --config apps/agent-health-console/wrangler.dry-run.jsonc
   ```
3. In Cloudflare Zero Trust, create a Worker Access application for the new dashboard `workers.dev` hostname.
4. Allow only Ameer’s approved email.
5. Test browser sign-in to the dashboard.
6. Do not apply Access to the execution-edge sync Worker.
