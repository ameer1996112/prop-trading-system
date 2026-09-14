# MT5 Telemetry EA Delivery Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement an executable checkpoint plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This document orders checkpoints; it is not a complete implementation plan for checkpoints 3B–3D.

**Goal:** Upgrade the existing read-only EA to report account financials, exposure, and a forward-only journal without losing records or changing broker state.

**Architecture:** Keep one EA and the existing receiver. Establish exact values first, then durable local state, account/history collection, and finally the selected v2 transport lifecycle. Preserve the installed v1 EA until the complete upgrade passes Windows and end-to-end verification.

**Tech Stack:** MQL5, existing TypeScript v2 validators and golden fixtures, Vitest, Windows MetaEditor, disposable local D1 tests.

---

## Current boundary

Windows follow-up (2026-09-07, after the initial handoff): the first capture bundle failed compilation with6 errors/0 warnings. A reviewed source repair corrects dividend/tax enum names and the synthetic fixture's inline memory allocation. Replacement `TradeOpsTelemetryCapture-2e3554c48b2b.zip` passes36 files/582 host tests and integrity verification; native recompilation/execution is still pending. See [capture compile follow-up](../../audits/2026-09-07-mt5-telemetry-capture.md). The initial package and580-test results in the paragraph below are historical, not the current download.

Latest update (2026-09-07): the dependent local State, file-store and outbox source checkpoints have since been implemented and reviewed; the outbox baseline is35 files /574 host tests passing. The operator reports outbox compilation0 errors/0 warnings and8081 checks, without a full final PASS/failures marker or EX5 hash; see [outbox evidence](../../audits/2026-09-05-mt5-telemetry-outbox.md). The user authorized [Stage3C capture implementation](2026-09-07-mt5-telemetry-capture.md). Its typed capture/codec/native read adapter and durable journal are now implemented with independent specification/quality reviews and36 files/580 host tests passing. The verified source-only synthetic Windows bundle is `TradeOpsTelemetryCapture-d6045e557df6.zip`; see [capture evidence and handoff](../../audits/2026-09-07-mt5-telemetry-capture.md). Native capture compilation/execution and actual demo comparison remain pending; this does not complete the parent3C acceptance gate. The installed EA, network lifecycle and frontend are unchanged. Earlier paragraphs below retain their historical checkpoint evidence, not the latest implementation status.

Planning date: 2026-09-03. Stages 1–2 are implemented and verified locally, uncommitted and not deployed. Stage 3 source has not been implemented by this planning pass.

Execution update (2026-09-03): Stage 3A's three isolated source/test files are implemented locally, with specification and quality reviews passing and **542 tests / 30 files PASS** in its recorded regression. The user's raw Windows log confirms two native runs of **146 checks / zero failures**; uploaded source hashes match, and unchanged EX5 transfer into the test copy is user-attested. GUI compilation shows zero errors/warnings. Separate fresh-directory compiler-log/environment evidence limits remain documented; do not repeat the resolved upload/rerun request or infer full-EA readiness. See the [values execution audit](../../audits/2026-09-03-mt5-telemetry-ea-values.md).

The [3B1 local-record plan](2026-09-03-mt5-telemetry-ea-records.md) is implemented locally in three isolated files, with specification/quality reviews passing and **545 tests / 31 files PASS**, plus typecheck/lint/safety checks and a source-only Windows bundle. The user subsequently reports GUI compilation with zero errors/warnings and native `TOV2_RECORD_PASS checks=475 failures=0`. Full logs, EX5 hash and fresh environment evidence have not been supplied; see the [records execution audit](../../audits/2026-09-03-mt5-telemetry-ea-records.md). Do not request another run to begin local design work. The active EA is unchanged. The [3B2 persistence/recovery design](../specs/2026-09-03-mt5-telemetry-persistence-design.md) is now approved. Its first executable [local-format checkpoint](2026-09-03-mt5-telemetry-ea-persistence.md) includes complete codec/test source; the full runtime recovery/outbox plan remains open. 3B2 and 3C–3D are not implemented; a valid byte frame or metadata codec does not complete Stage 3B.

Backend root: `/Users/ameeramer/.config/superpowers/worktrees/prop-trading-system/mt5-stale-payload-recovery` (branch `codex/mt5-stale-payload-recovery`, inspected HEAD `8a801423bc19b3bb27c8e24f45d2800a9deb6881`).

Docs root: `/Users/ameeramer/.config/superpowers/worktrees/prop-trading-system/tradeops-dashboard-migration` (branch `codex/tradeops-dashboard-migration`). Preserve both dirty worktrees. No commit, push, deployment, remote migration, account change, secret change, terminal installation or broker action is authorized by this plan. Do not migrate the older Supabase database.

Approved specification: `docs/superpowers/specs/2026-09-03-mt5-account-telemetry-journal-design.md` in the docs root. Receiver evidence: `docs/audits/2026-09-03-mt5-telemetry-receiver.md` in that root.

## Checkpoint sequence

| Checkpoint | Deliverable | Exit evidence |
| --- | --- | --- |
| 3A — exact values | Isolated MQL5 values include, native offline self-test, TS fixture agreement checks | TS/static checks plus separately identified Windows compile and native self-test evidence |
| 3B — durable local state and outbox | Registration, ownership, ordered events, immutable pending upload, ACK/recovery state | Fault injection across write/flush/replace/ACK boundaries; duplicate-instance/account-switch/corrupt-state tests |
| 3C — account and history capture | Account-wide snapshots, cutover, history reconciliation, revisions, bounded observations | Synthetic broker adapter cases and native read-only demo comparison; explicit gaps and last-complete exposure |
| 3D — v2 transport and lifecycle | Canonical encoder/parser, persisted retries, one network owner, selected protocol, diagnostics | Golden request/response bytes, local receiver integration, Windows build and interrupted-upload recovery |

- [ ] Execute the complete [3A plan](2026-09-03-mt5-telemetry-ea-values.md). Do not wire its include into the active EA yet.
- [ ] Preserve the completed [3B1 local-record code/test evidence](2026-09-03-mt5-telemetry-ea-records.md); execute the new [3B2 local-format checkpoint](2026-09-03-mt5-telemetry-ea-persistence.md) after execution handoff, then complete the dependent runtime file-ownership, state/outbox and fault-test plan. The parent 3B acceptance requirements below remain open.
- [x] Expand 3C after the persistence interfaces and fault tests are established: see [capture implementation plan](2026-09-07-mt5-telemetry-capture.md). Expansion is complete; implementation and native acceptance are tracked there separately.
- [ ] Expand 3D after capture/outbox interfaces are established. Do not change v1 lifecycle assertions before this checkpoint.

These are dependent work boundaries, not four independent implementations to start simultaneously. Later checkpoint descriptions below are acceptance requirements, not executable code steps.

## 3A contract

Files in the backend root:

- `mt5/TradeOpsAgent/Include/TradeOpsTelemetryValues.mqh`: exact canonical decimal text, positive unsigned ticket strings, safe sequence counters, restricted identifiers/digests and explicit reading values.
- `mt5/TradeOpsAgent/Scripts/TradeOpsTelemetryValuesSelfTest.mq5`: synthetic native tests only; no account, history, file, network or trading APIs.
- `apps/execution-edge/test/mt5-telemetry-values-v2-source.test.ts`: check the native test vectors against the existing receiver validators and inspect the new source boundary. This is not an MQL5 emulator.

String inputs preserve exact decimal values. Broker APIs returning `double` are converted at an explicitly selected scale; this cannot recover precision already lost by the broker/API representation. Ticket IDs and counters never pass through `double`. No new P/L aggregation is introduced; the existing receiver owns exact deal projection.

## 3B persistence and recovery requirements

Own `TradeOpsTelemetryState.mqh` and `TradeOpsTelemetryOutbox.mqh` under the EA Include directory. Use versioned private v2 paths, never overwrite `local/config.ini` or `journal/sync-state.ini`.

- Immutable account fingerprint, installation/tracking identity, cutover UTC and broker time, boundary-second excluded IDs, baseline exposure and source schema are durably bound together before tracking begins.
- Explicit initialization is distinct from recovery. Missing/corrupt registration cannot silently create a new cutover. The receiver has no public recovery lookup; do not invent one or infer server absence from a network error. Preserve damaged files and surface a recovery-required status.
- Revalidate account identity before capture and send. An account switch freezes v2 work, rather than relabeling a pending request.
- Hold exclusive instance ownership for the full session, including across terminals using the same identity. Specify acquisition, stale-owner recovery and shutdown. An exclusive file handle is available when sharing flags are omitted; test actual terminal behavior. [MetaQuotes file opening rules](https://www.mql5.com/en/book/common/files/files_open_close).
- Define bounded versioned records, checksums, generations, commit records, flush ordering and recovery selection. Do not describe a rename alone as a proven crash-atomic transaction: the official FileMove contract does not promise that. Test torn/truncated writes, failed flush/rename, stale generations and disk exhaustion. [FileMove](https://www.mql5.com/en/docs/files/filemove), [FileFlush](https://www.mql5.com/en/docs/files/fileflush).
- Ordered event sequence assignment and durable append must be recoverable together. Preserve queued records until a validated, correlated ACK and its durable local checkpoint permit compaction. Recovery after remote commit/local ACK loss resends the same bytes.
- Persist the exact pending request before sending it. Never rebuild uncertain requests from new snapshots. Never place two revisions of one deal in the same batch; the receiver rejects duplicate deal IDs within one upload.
- Bound individual records, batches and disk usage; unsupported/oversized records enter visible quarantine with a coverage gap. No silent truncation, reset, or dropping oldest events.

## 3C capture and journal requirements

Own `TradeOpsAccountSnapshot.mqh` and `TradeOpsJournalCollector.mqh`. Use an injectable read-only broker adapter in native tests rather than placing test orders.

- Account-wide means manual and other-EA activity across symbols, not the strategy allowlist. Report company/server/currency/margin mode and distinguish stable position ID from ticket. Do not expose full login in public diagnostics.
- Cutover initialization samples broker boundary-second IDs and baseline positions/orders with bounded retries and identity rechecks. Include only permitted post-cutover activity, including the specified boundary-second exclusions. No pre-start backfill.
- Capture account values, positions and orders with complete/failed/limit statuses and timestamps. Successful empty exposure is different from failed enumeration; failures must not erase the last complete server snapshot. Bound positions and orders at 128 each.
- History capture is forward-only, broker-time based, overlaps scan windows, and rotates older ranges to discover corrections. Preserve revisions and previous record hashes. Offline fills may be recovered from history; missed intermediate SL/TP edits must remain an observation gap.
- Capture each deal's signed profit, commission, swap and fee once. Preserve standalone balance/cost operations, cancellation/correction types, reason, position/order IDs and broker-provided protection. Unknown reversal allocation stays unknown. An exit from a baseline position is not a complete trade P/L claim.
- Callback work is only a bounded dirty/observation marker. No full history scan, durable compaction or synchronous HTTP in `OnTradeTransaction`; its finite queue and event ordering cannot provide the journal's sole durability guarantee. [MetaQuotes transaction callback](https://www.mql5.com/en/docs/event_handlers/ontradetransaction).
- Reconcile clocks, scan-finished watermark, produced events, unsent events, record gaps and observation gaps independently of heartbeat freshness. Unknown data is not zero.

## 3D transport, compatibility and lifecycle requirements

Own `TradeOpsTelemetrySync.mqh` and a focused v2 canonical codec if needed. Modify `TradeOpsAgent.mq5`, installation README and narrowly scoped source tests only here. Keep the existing v1 canonical/response implementation unchanged unless an independently justified compatibility change is reviewed.

- Use the exact existing `telemetry-wire-v2.ts` key sets and `fixtures/agent-sync-v2.json`. Support canonical Unicode escaping/key ordering and UTF-8 hashing; do not assume the limited v1 string escaper is a general v2 serializer.
- Bound requests at 256 KiB encoded bytes, responses at 16 KiB, events at 32, snapshots at 128 positions/128 orders. Validate timestamps, body/record hashes, expected identity and exact response content including coverage/ACK. Every response remains `DRY_RUN` with `command: null`.
- The first v2 registration requires the existing v1 identity pin. One selected protocol, one 15-second timer owner, at most one network attempt per cycle, bounded backoff. No parallel v1/v2 upload loops. Pending v2 work cannot be discarded by falling back to v1.
- Accepted exact retries retain their original response/time. Only a definitive server rejection of a still-unaccepted stale envelope permits renewing timestamps with the same sequence and preserved events; uncertain delivery never permits renewal.
- Persist remote ACK effects before reporting local success. Callback queues, scanner state, pending transport and outbox recovery must be tested together across restarts.
- Separate reported source/manifest, actual terminal/compiler build, receiver schema and release identity. A green heartbeat alone does not certify journal completeness or deployment version.
- `WebRequest` is synchronous and unavailable in Strategy Tester. Keep pure/native tests and later Windows network verification distinct; do not report a Strategy Tester pass as HTTP integration evidence. [MetaQuotes WebRequest](https://www.mql5.com/en/docs/network/webrequest).

## Full upgrade exit and rollout gates

Do not replace the working EA until all four checkpoints, native Windows compilation, receiver integration and independent source/safety review pass. Record source hashes, compiler build, EX5 hash, native test output and recovery instructions. Stage 4 adds private dashboard financial/journal reads; this stage does not redesign that interface or enable execution.

The receiver's measured 5,760 idle acceptances allocated 27,017,216 bytes locally. This is not a promise of production free-tier capacity. Before continuous rollout, review actual remaining capacity, demo duration, indexes/other workloads, and a retention design. No automatic pruning or paid upgrade is authorized.

Deployment, migration 0004 on remote D1, installation into the active terminal, and any execution capability require separate approval. Validation must not place a broker test trade. Current Pine alerts, risk settings, Worker bindings/secrets and the attached EA remain unchanged during this planning work.
