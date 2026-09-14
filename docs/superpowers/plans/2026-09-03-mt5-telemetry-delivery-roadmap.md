# MT5 Telemetry Delivery Roadmap

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement the executable stage plan task-by-task. Steps use checkbox syntax for tracking. This roadmap is not authorization to deploy or bypass source integrity checks.

**Goal:** Deliver the approved read-only account telemetry and forward-only journal in the familiar TradeOps interface.

**Architecture:** One Windows EA reports through the existing execution Worker and account coordinator into D1. The existing private read service supplies the restored dashboard. V2 reporting remains command-free and compatible with the working v1 heartbeat.

**Tech Stack:** MQL5, TypeScript, Cloudflare Workers/Durable Objects/D1, existing Cloudflare Access, Next.js/React, Vitest.

---

## Plan status and boundaries

The written design was approved on 2026-09-03. This document orders the whole delivery; the companion “telemetry invariants” plan is the first complete, executable stage. Later stages must be expanded into complete test-first plans against the interfaces produced by their dependencies before their code is changed. An outline below is not a claim that those later implementations are fully specified or complete.

Use the existing worktrees, without merging or relocating them:

- Backend/EA root: /Users/ameeramer/.config/superpowers/worktrees/prop-trading-system/mt5-stale-payload-recovery
- Frontend/docs root: /Users/ameeramer/.config/superpowers/worktrees/prop-trading-system/tradeops-dashboard-migration
- Approved design: /Users/ameeramer/.config/superpowers/worktrees/prop-trading-system/tradeops-dashboard-migration/docs/superpowers/specs/2026-09-03-mt5-account-telemetry-journal-design.md
- Executable first stage: /Users/ameeramer/.config/superpowers/worktrees/prop-trading-system/tradeops-dashboard-migration/docs/superpowers/plans/2026-09-03-mt5-telemetry-invariants.md

All stages remain local and uncommitted until an explicit handoff changes that boundary. Preserve the frontend's existing dirty worktree. No real credentials, deployment, remote migration, binding change, Access-policy change, TradingView change, EA attachment, or broker action is included in local execution. The existing Supabase/older-project database is not migrated.

## Stage 1 — completed locally: reporting invariants

- [x] Implement and test exact decimal/ticket handling, immutable start-boundary filtering, truthful completeness derivation, and pure new-request/exact-retry decisions using the companion plan.
- [x] Preserve v1 files, source integrity manifest, Worker routes, database schema, and EA source byte-for-byte.
- [x] Run the existing execution-edge suite and dry-run boundary verifier.

**Deliverable:** Small pure functions and tests, not an active v2 endpoint or a new EA build. This stage establishes rules later components can reuse and test against. It does not yet provide wire-schema validation, durable I/O, or telemetry.

Local execution evidence: 27 new tests and 335 total execution-edge tests pass; typecheck, lint, and the unchanged dry-run boundary verifier pass. Existing backend and frontend files were unchanged at the Stage 1 handoff. Final combined review passed with no remaining findings. See `docs/audits/2026-09-03-mt5-telemetry-invariants.md` for that handoff. Stage 2 is also complete locally; its measured evidence and remaining rollout gates are recorded in `docs/audits/2026-09-03-mt5-telemetry-receiver.md`.

## Stage 2 — completed locally: full v2 contract and durable receiver

Detailed plan: `docs/superpowers/plans/2026-09-03-mt5-telemetry-receiver.md`. Its earlier virtual/planning checks are now followed by completed local implementation and actual-D1 tests; see `docs/audits/2026-09-03-mt5-telemetry-receiver.md` for execution evidence and the separate `docs/audits/2026-09-03-mt5-telemetry-receiver-plan.md` for historical planning evidence. This is not rollout. Measured receipt growth remains a separate rollout constraint even though local write counts fit the tested single-account component budget.

- [x] Implement all eight receiver tasks with independent specification and quality reviews.
- [x] Pass **537 tests / 29 files**, typecheck, lint, unchanged safety verification and final code/spec/safety review.
- [x] Measure 5,760 idle acceptances: **34,559 reads, 11,521 writes, 46,080 SQL statements, maximum batch 4, 27,017,216 allocated bytes**. A 32-event burst uses 130 writes/8 statements; 100 exact retries add zero writes. Journal reads use the primary-key index.
- [x] Produce and independently verify the synthetic canonical request/response fixture; preserve the current EA and keep every v2 response command-free.

All source remains uncommitted; migration 0004 has run only in disposable local tests. Continuous rollout still requires actual remaining database capacity, intended demo duration and a reviewed retention approach. Production CPU/latency and account-wide quota remain unmeasured.

**Owning root:** backend/EA root above.

**Implemented file map (complete inventory in the execution audit):**

- Create apps/execution-edge/src/telemetry-wire-v2.ts — strict bounded request/response validation; exact key sets; domain objects and shared fixtures.
- Create apps/execution-edge/src/telemetry-repository-v2.ts — prepared D1 writes/reads, one acceptance transaction, exact stored response retrieval.
- Create apps/execution-edge/src/telemetry-sync-v2.ts — authenticated read-only endpoint adapter and error mapping.
- Create apps/execution-edge/src/telemetry-journal-projection-v2.ts — deal revisions, net recorded results, attribution, baseline/partial/reversal classifications.
- Create apps/execution-edge/migrations/0004_account_telemetry_v2.sql — additive registration/session, receipt, current snapshot, ordered events, deal revisions/current indexes.
- Modify apps/execution-edge/src/account-coordinator-v1.ts — a separate v2 method and serialization boundary; leave the v1 algorithm/keys unchanged.
- Modify apps/execution-edge/src/index.ts — explicit v2 route, existing identity guard, command-free replies, unchanged v1 route.
- Create apps/execution-edge/test/telemetry-wire-v2.test.ts, telemetry-repository-v2.test.ts, telemetry-sync-v2.test.ts, telemetry-journal-projection-v2.test.ts, and telemetry-budget-v2.test.ts.
- Create mt5/TradeOpsAgent/fixtures/agent-sync-v2.json — synthetic golden canonical request/response bytes for the later MQL5 parser, not a secret/configuration.

**Required test cases:** Strict schemas, body/record bounds, large IDs, nullable failures, no client-supplied authority, stale unaccepted envelope versus accepted exact retry, concurrent sequence claims, altered start boundary, event gaps/conflicting content, failure at every D1 statement, crash after commit, preserved original acceptance time, corrected deal projections, signed fees, standalone balance activity, netting reversal cost uncertainty, and last-complete exposure on failed enumeration.

The transaction must use D1 as the only authoritative v2 commit store. Validate the current D1 runtime API and test rollback in a local D1 runtime, not just a permissive mock. The request-admission function from Stage 1 proposes a watermark; only committed repository output may become an ACK.

**Exit:** Local synthetic end-to-end POST/replay works with no event loss or duplicate P/L, v1 regression tests pass, and the idle-day/32-event-burst write budget is measured. Migration files exist but have not been applied remotely.

## Stage 3 — upgraded read-only EA

**Owning root:** backend/EA root.

**Planning update (2026-09-03):** [EA checkpoint delivery plan](2026-09-03-mt5-telemetry-ea-delivery.md) now separates Stage 3 into exact values (3A), durable state/outbox (3B), capture/history (3C), and v2 transport/lifecycle (3D). The [3A exact-values plan](2026-09-03-mt5-telemetry-ea-values.md) is the first complete code/test plan. No Stage 3 source was changed during planning. Checkpoints 3B–3D require their own executable plans against verified predecessor interfaces. Native Windows compile/self-test remains a distinct verification gate.

**Execution update (2026-09-03):** Stage 3A's isolated values library, native synthetic self-test and receiver agreement tests are implemented locally. Specification and separate quality reviews pass; fresh regression passes **542 tests across 30 files**. The two-source Windows handoff is ready, but native compilation and isolated execution are still pending. Stage 3A is therefore not fully complete; the installed EA remains unchanged and 3B–3D have not started. Evidence and source hashes: [values execution audit](../../audits/2026-09-03-mt5-telemetry-ea-values.md).

**File map to expand in its executable plan:**

- Create mt5/TradeOpsAgent/Include/TradeOpsTelemetryValues.mqh — exact display serialization and string broker IDs, cross-language fixtures.
- Create mt5/TradeOpsAgent/Include/TradeOpsTelemetryState.mqh — immutable cutover/baseline, account binding, exclusive instance ownership, atomic local state.
- Create mt5/TradeOpsAgent/Include/TradeOpsAccountSnapshot.mqh — identity, finances, account-wide exposure enumeration and explicit completeness.
- Create mt5/TradeOpsAgent/Include/TradeOpsJournalCollector.mqh — bounded transaction observations, broker-time history windows, reconciliation and revisions.
- Create mt5/TradeOpsAgent/Include/TradeOpsTelemetryOutbox.mqh — persistent ordered records, quarantine, bounded batches, ACK-safe compaction.
- Create mt5/TradeOpsAgent/Include/TradeOpsTelemetrySync.mqh — v2 canonical serialization, strict correlated response parser, exact pending request and retry handling.
- Create mt5/TradeOpsAgent/Scripts/TradeOpsTelemetrySelfTest.mq5 — local pure fixture/state tests with no network or broker mutations.
- Modify mt5/TradeOpsAgent/TradeOpsAgent.mq5 — explicit selected-protocol lifecycle, one 15-second network owner, minimal transaction callback, diagnostics.
- Modify mt5/TradeOpsAgent/README.md — versioned installation/rollback instructions without changing private local configuration.
- Modify apps/execution-edge/test/mt5-heartbeat-agent-source.test.ts and add apps/execution-edge/test/mt5-telemetry-agent-source.test.ts — distinguish v1 mode from the new read-only collector; retain all forbidden broker operations.

**Required test cases:** No history before cutover; boundary-second IDs; restart and reinstall recovery; lost/corrupt local registration; two EA instances; account switch; local disk failure; oversized snapshot/outbox record; offline fills recovered from broker history; partial closes/reversals; unsupported record quarantine; clock discontinuity; altered response/digest/ACK; lost response after commit. Never reset v1 sync-state.ini or local/config.ini.

Do not duplicate the entire protocol parser in unrelated modules or make the transaction callback perform WebRequest. The old assertion banning all transaction callbacks can change only to a narrowly scoped read-only assertion, not removal of the broker safety scanner. An unconfirmed pending v2 upload cannot fall back into v1 and discard events.

**Exit:** Cross-language golden fixtures match. Source checks pass. A specifically identified MQL5 build must compile in MetaEditor on Windows before installation can be proposed; local TypeScript tests do not establish EX5 correctness. Installing on the user's active terminal remains outside the stage.

## Stage 4 — private account reads and familiar dashboard

**Owning roots:** backend private service and existing frontend worktree.

**Backend file map to expand:**

- Create apps/agent-health-console/src/account-summary-v2.ts and journal-v2.ts — fixed account/installation scoped, bounded prepared SELECTs.
- Modify apps/agent-health-console/src/health-summary-v1.ts — newest accepted v1/v2 heartbeat, never cross-protocol sequence comparison.
- Modify apps/agent-health-console/src/index.ts — fixed GET routes, explicit failure status, no public write capability.
- Modify scripts/verify-mt5-dry-run-boundary.mjs and apps/execution-edge/test/mt5-dry-run-boundary.test.ts — reviewed, literal source/query allowlist extension with adversarial tests.
- Review apps/agent-health-console/dashboard-integrity-manifest.v1.json only after the exact allowed source/query changes are reviewed. Never automatically rewrite it in CI or disable its checks.
- Add apps/agent-health-console/test/account-summary-v2.test.ts and journal-v2.test.ts; extend worker.test.ts and health-summary-v1.test.ts.

**Frontend file map to expand:**

- Create apps/operations-console/src/features/tradeops/mt5-account-contract.mjs and mt5-account-contract.d.mts — exact private response contract.
- Create apps/operations-console/src/features/tradeops/mt5-account.ts — bounded same-origin summary/journal loaders.
- Create apps/operations-console/src/features/tradeops/Mt5AccountPanel.tsx, Mt5PositionsPanel.tsx, Mt5JournalPanel.tsx — read-only account, exposure, and journal views using existing visual tokens.
- Create apps/operations-console/scripts/mt5-account-proxy.mjs — fixed origin/path Access-protected reads, bounded cursor, no arbitrary URL/account.
- Modify apps/operations-console/scripts/tradeops-preview.mjs and mt5-health-access.mjs only as needed to share the existing private Access session safely.
- Modify apps/operations-console/src/features/tradeops/session.ts and use-tradeops.ts — existing refresh owner, active-view journal reads, no second timer.
- Modify TradeOpsDashboard.tsx, TradeOpsShell.tsx, OriginalDataPage.tsx, ConnectionDetails.tsx in the same features/tradeops directory — preserve layout and paper-source separation. Use the existing exposure placement; navigation currently has no standalone Positions page, so do not invent a new navigation redesign.
- Add apps/operations-console/tests/tradeops-mt5-account.test.ts, tradeops-mt5-journal.test.tsx, tradeops-mt5-account-proxy.test.ts, and extend existing MT5 session/restoration tests.

**Required test cases:** Access and fixed account isolation; unsupported/public paths; opaque cursor validation; bounded pages; unknown versus zero; latest complete exposure; stale financials independent of journal completeness; auth purge/cancellation/late responses; no cross-source paper joins; missing pre-start entry and unknown strategy; one refresh owner; source/version/terminal-build separation; observed SL/TP gaps; mobile layout.

**Exit:** Familiar Dashboard/Accounts/Journal show synthetic read-only broker records accurately, all restoration checks pass, and the private integrity verifier still rejects writes, arbitrary SQL, external network access, and unreviewed source changes.

## Stage 5 — end-to-end verification and explicit rollout handoff

- [ ] Produce an integration fixture with baseline exposure, new entry, partial close, SL/TP exit, signed charges, interrupted upload, replay, correction, and recovery; compare all stored and displayed totals.
- [ ] Run all affected test/typecheck/build scripts and the boundary verifier. For execution-edge and health-console, inspected build commands use Wrangler's explicit dry-run flag; inspect again before running.
- [ ] Measure database rows read/written and storage growth for idle and active representative days. Include indexes, retries, and other account workloads in the separate rollout assessment; do not promise free-tier capacity from request counts alone.
- [ ] Record exact source revisions/diffs, schema version, reviewed read-service manifest, source hashes, EX5 hash, compiler output, and rollback instructions.
- [ ] Stop for separate approval of remote migrations/deployments and EA installation. Re-check the actual target account is the intended demo account.
- [ ] After approved rollout only, compare real MT5 account values and subsequent user-initiated/existing activity with the journal. Do not place a broker test trade.

## Spec coverage review

| Approved requirement | Delivery stage |
| --- | --- |
| Immutable forward-only boundary, baseline exposure | 1 invariants; 3 capture/persistence |
| Exact amounts, string IDs, account identity | 1 values; 2 wire; 3 capture; 4 display |
| Completeness separate from heartbeat | 1 derivation; 2 persistence; 3 scan; 4 display |
| Partial closes, costs, broker reasons, corrections | 2 projection; 3 capture; 4 journal |
| Local replay and no ACK before durable commit | 1 admission; 2 transaction; 3 outbox; 5 failure tests |
| Old EA and health compatibility | 2 unchanged v1; 3 selected protocol; 4 normalized health |
| Private reads, existing frontend | 4 |
| Reported version, backlog and diagnostics | 2/3 transport; 4 display |
| Free-plan budget and no new paid service | 2 measured local cost; 5 account-wide rollout check |
| No broker authority, no automatic rollout | Every stage and final explicit approval gate |

Stages 1–2 are complete locally, not deployed. This remains a delivery map for the unfinished Stages 3–5. Stage 3A is implemented and reviewed locally but awaits native Windows verification; plans for 3B–3D and Stage 4 must use verified predecessor interfaces before those implementations begin.
