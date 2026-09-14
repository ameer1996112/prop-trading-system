# MT5 DRY_RUN Health Dashboard

This dashboard is read-only and uses the `AGENT_HEALTH_DB` D1 binding. Its Wrangler configuration contains no secret values.

## Dashboard integrity manifest

The dashboard source files are frozen by a checked-in integrity manifest. The boundary verifier fails every dashboard-source change. An authorized source change requires this exact local sequence:

```sh
node scripts/write-dashboard-integrity-manifest.mjs
npm test --prefix apps/execution-edge -- mt5-dry-run-boundary.test.ts
node scripts/verify-mt5-dry-run-boundary.mjs
```

Review the generated manifest in the same change as the source update. Because the manifest contains SHA-256 values, a source change can also change its intentional high-entropy secret-scan findings. Inspect every resulting finding and update `.secrets.baseline` only for the exact reviewed non-secret digest fingerprints; never regenerate or broadly relax the baseline.

Add and run focused regression tests proving the changed dashboard release remains read-only and DRY_RUN-only, then run the complete verification set:

```sh
npm test --prefix apps/execution-edge
npm run lint --prefix apps/execution-edge
npm run typecheck --prefix apps/execution-edge
npm run build --prefix apps/execution-edge
npm test --prefix apps/agent-health-console
npm run typecheck --prefix apps/agent-health-console
npm run build --prefix apps/agent-health-console
node scripts/verify-mt5-dry-run-boundary.mjs
UV_CACHE_DIR=/tmp/prop-trading-review-uv-cache make secret-scan
git diff --check
```

An independent reviewer must review the changed source, generated manifest, any narrow secret-baseline delta, focused regression coverage, and complete verification evidence before merge or deployment. None of these commands deploy Cloudflare or change MT5.

## Operator runbook

1. Run tests and dry-run builds:
   ```sh
   npm --prefix apps/execution-edge test -- mt5-dry-run-boundary.test.ts
   node scripts/verify-mt5-dry-run-boundary.mjs
   npm --prefix apps/agent-health-console test
   npx --prefix apps/agent-health-console wrangler deploy --config apps/agent-health-console/wrangler.dry-run.jsonc --dry-run --outdir /tmp/agent-health-console-dry-run
   ```
2. Before any migration or Worker deployment, obtain explicit approval to pre-stage and activate a Cloudflare Access application for the deterministic dashboard hostname derived from the checked-in Worker name and the account's known Workers subdomain:
   ```text
   https://prop-trading-agent-health-console-dry-run.<workers-subdomain>.workers.dev
   ```
   Configure the policy for only Ameer’s approved email and verify in Cloudflare that the active application and email policy match that exact hostname. Do not apply Access to the execution-edge sync Worker. If Access cannot be pre-staged or its active state cannot be proven, stop; do not run a migration or deploy either Worker.
3. After Access is proven active, obtain a separate explicit approval covering the remaining remote rollout. Only under that approval, use this order:
   1. apply execution-edge D1 migrations `0002_agent_health_current.sql` and `0003_agent_health_dashboard_index.sql` to the existing DRY_RUN database;
   2. deploy the reviewed projection-writing execution-edge revision; and
   3. deploy the reviewed dashboard Worker:
   ```sh
   npx --prefix apps/agent-health-console wrangler deploy --config apps/agent-health-console/wrangler.dry-run.jsonc
   ```
4. Immediately verify that an unauthenticated request to the dashboard hostname is denied. If it is not denied, stop and do not perform the authenticated check.
5. Verify authenticated dashboard access using Ameer’s approved email.

This README does not itself authorize any remote step. The rollout must not change the MT5 EA, MT5 WebRequest allowlist, Algo Trading, broker account, execution authority, or any trading setting. If any step requires one of those changes, stop and request a new review instead of expanding scope.
