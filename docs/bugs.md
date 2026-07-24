# Verified bug fixes

## 2026-07-23 — Worker failed during real local startup

- **Summary:** `wrangler deploy --dry-run` succeeded, but `wrangler dev --local`
  could not start the observation Worker.
- **Root cause:** the Worker entry module exported SQL string constants. Workerd
  interpreted named exports from the main module as handler entrypoints and
  rejected the strings because they were neither functions nor exported
  handlers.
- **Fix:** moved SQL constants into the internal `src/queries.ts` module. The
  main module now exposes only the default Worker handler.
- **Regression risk:** adding any non-handler named export to `src/index.ts`
  can reproduce the startup failure. Verification must include a real
  `wrangler dev --local` boot and HTTP request, not only unit tests or a deploy
  dry-run.
- **Proof:** local workerd served the static console and D1-backed API; the
  smoke sequence returned `200` health, `202` accepted, `200` duplicate,
  `409` conflict, `401` invalid credential, and `200` receipt list.
