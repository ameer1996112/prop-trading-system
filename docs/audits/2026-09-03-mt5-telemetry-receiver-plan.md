# Stage 2 receiver — planning validation, 2026-09-03

## Outcome and boundary

The executable plan is `docs/superpowers/plans/2026-09-03-mt5-telemetry-receiver.md`. It contains exact code/schema/test files, integration edits, a generated synthetic golden fixture, test-first checkpoints and rollout exclusions. The application has **not** been changed for Stage 2. Its execution checkboxes remain unchecked.

Backend inspected: `/Users/ameeramer/.config/superpowers/worktrees/prop-trading-system/mt5-stale-payload-recovery`, HEAD `8a801423bc19b3bb27c8e24f45d2800a9deb6881`. Documentation resides in the existing `tradeops-dashboard-migration` worktree. Preserve all prior restoration/health and Stage 1 changes.

Skills used: writing-plans for executable decomposition/self-review; Cloudflare and durable-objects for platform retrieval and concurrency decisions; verification-before-completion for evidence-bounded status. No sub-agents were dispatched in this planning turn.

## Verification performed

Temporary verifier: `/private/tmp/telemetry-stage2-plan.yJemFu/check.mjs`.

Command (from execution-edge):

```sh
node /private/tmp/telemetry-stage2-plan.yJemFu/check.mjs --runtime --budget
```

Final exit code: **0**. The verifier reads Markdown code blocks into a virtual TypeScript compiler host and bundles selected paths in memory. It does not materialize v2 application files. Local D1 instances are disposable and closed after checks; no Cloudflare credential, real account payload, remote binding or Wrangler deployment is used.

- 16 virtual TypeScript source/test/integration units plus one SQL migration: **0 type errors** against the existing strict tsconfig/dependencies.
- Actual local D1 CHECK violation at each of five boundaries around a four-statement acceptance batch: **all five rollback checks passed**, with all four telemetry tables empty afterwards.
- New acceptance, exact stale replay, unchanged write count on replay and corrected-deal current pointer: **passed**.
- Two independently prepared sequence claims racing into local D1: **one winner**, one rejected transaction, one receipt; exact recovery passed.
- Actual exported Worker handler → actual coordinator implementation → local D1 with a synthetic v1 identity pin: **POST passed**, canonical command-free response matched the fixture.
- 5,760 synthetic sequential idle acceptances, one 32-event burst and 100 exact stale retries: **completed**. This simulates request volume, not 24 hours of elapsed wall time.
- Journal query plan: `SEARCH telemetry_event_v2 USING PRIMARY KEY (scope=? AND sequence<?)`; no full scan or temporary sort in the measured plan.

### Measured component workload

| Workload | D1 rows read | D1 rows written | SQL queries | Notes |
| --- | ---: | ---: | ---: | --- |
| 5,760 idle acceptances | 28799 | 11521 | 46080 | Includes first registration, excludes migration DDL |
| One 32-event acceptance | Not separately asserted | 130 | 8 | Per-event IDs/revisions and current pointers |
| 100 exact retries | Reads occur | 0 | Two read statements per retry | Original response/acceptance time retained |

Maximum statements in a batch: 4. Idle allocated database size from local D1 `meta.size_after`: **27017216 bytes** (~27.0 MB). After the burst/retries: **27176960 bytes**. Numbers include the local schema's table/index allocation; no production storage/CPU claim is made.

### Important storage gate

The write rate leaves room under the current 100,000 D1 writes/day allowance **for this synthetic component alone**, not necessarily the user's entire Cloudflare account. More importantly, retained receipts grow by roughly 27 MB per synthetic idle day with this layout. Against the currently documented 500 MB per-database Free limit, that is only roughly 18 comparable days in an otherwise empty database. Actual available space and growth will differ.

Do not approve continuous rollout from the write-rate result alone. Stage 5 must assess the real database's remaining capacity and intended demo duration; an explicitly reviewed storage optimization or retention policy is needed for longer operation. This turn authorizes neither deleting receipts/journal data nor upgrading the plan. Preserve local pending events on capacity errors. Sources: [D1 limits](https://developers.cloudflare.com/d1/platform/limits/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/).

## Issues found and corrected during planning

- Replaced an assumed database profile lookup with the actual existing coordinator identity pin. Missing pin fails closed; v2 does not silently enroll a new installation.
- Corrected the coordinator state-loader name and the environment pass-through.
- Corrected the UTF-8 TextDecoder options to match the installed Workers types.
- Added a maximum scan watermark check against reported observation times and allowed bounded broker symbols without an execution-symbol allowlist.
- Fixed the test migration extractor to handle `WITHOUT ROWID` tables and full trigger bodies.
- The synchronous Miniflare `getD1Database` proxy stalled under both Node 26 and Node 24. Replaced it with async Worker dispatch using an actual local D1 binding. Terminated only the exact temporary stalled processes; existing services were not targeted.
- Local D1 rejects `PRAGMA page_count` and `PRAGMA page_size` with SQLITE_AUTH. The final measurement uses supported `meta.size_after` instead.

Platform guidance was checked against current official [D1 batch API](https://developers.cloudflare.com/d1/worker-api/d1-database/) and [DO concurrency documentation](https://developers.cloudflare.com/durable-objects/api/state/). The local skill references contain stale Sessions/pricing API examples; the plan explicitly does not use those examples.

## Not verified / not performed

The complete proposed Vitest suite has been **typechecked, not executed as a suite**. Selected paths ran in a standalone disposable verifier; this does not replace the planned RED/GREEN sequence, full 335-test baseline regressions, final safety verifier, or independent implementation review. Stage 1's prior 335-test result is historical and was not rerun or re-labelled as a Stage 2 result.

No application source changes, package installation, Stage 2 migration file in the application tree, commit/staging/push/merge, deployment, remote migration, binding/secret/Access change, TradingView change, EA installation or broker action. No live account financial values or trading activity were inspected. The frontend remains unchanged by this turn. Real EX5 capture, Windows compilation, Access-protected reads, UI integration, production CPU/latency, quota usage and the actual broker account are later gates.

Next: execute the Stage 2 plan locally with per-task review, retaining the explicit storage-rollout gate. Keep the current EA/Pine installed; this planning work produces no replacement trading-terminal artifact.
