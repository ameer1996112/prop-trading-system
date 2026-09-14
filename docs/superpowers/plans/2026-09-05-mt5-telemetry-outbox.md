# MT5 telemetry durable outbox implementation checkpoint

**Goal:** Persist one exact pending telemetry request, recover it for retry, and retire its selected events only after a correlated acknowledgement is durably committed.

**Architecture:** `CTov2TelemetryState` remains the sole commit writer. A separate outbox orchestrates bounded prefix selection and calls a trusted injected wire adapter. This checkpoint supplies a synthetic adapter for deterministic tests; production canonical serialization and networking remain Stage 3D.

**Tech stack:** MQL5, existing TOV2R1/state codec, existing deterministic memory storage, Vitest source and receiver contract checks.

## Current checkpoint status

Local source implementation, failure harness, host verification, independent specification/code-quality reviews and source-only ZIP are complete. See the [execution audit](../../audits/2026-09-05-mt5-telemetry-outbox.md) for exact sources and evidence.

Checked implementation/failure-matrix items below mean code or executable native scenarios were authored and reviewed; they do **not** mean MQL5 executed on this host. Windows compilation and native runtime remain pending:

- [ ] Compile the isolated outbox script on Windows with zero errors/warnings; retain compiler output and build identity.
- [ ] Run that exact compiled script and collect `TOV2_OUTBOX_PASS` with a positive checks count and `failures=0`.

## Scope and authorization

The user approved this isolated outbox checkpoint on 2026-09-05. Continue local implementation and reviews without another design approval. Preserve the existing dirty worktrees. No stage/commit/push, deployment, remote database migration, installed EA replacement, broker action, or TradingView change is included.

Backend: `/Users/ameeramer/.config/superpowers/worktrees/prop-trading-system/mt5-stale-payload-recovery`, branch `codex/mt5-stale-payload-recovery`, HEAD `8a801423bc19b3bb27c8e24f45d2800a9deb6881`.
Docs: `/Users/ameeramer/.config/superpowers/worktrees/prop-trading-system/tradeops-dashboard-migration`.
Baseline: `/private/tmp/tradeops-outbox-RPWXbJ/baseline.json`, 508 hashed tracked/nonignored files before implementation.

This plan refines section 4 of the approved [persistence design](../specs/2026-09-03-mt5-telemetry-persistence-design.md). Earlier checkpoint plans describe historical source boundaries and are not permission to overwrite their implementations. The completed native storage tests establish adapter evidence, not full outbox or EA correctness. READ_FIXTURE is user-reported PASS with four checks; the final raw marker/EX5 identity is still uncollected and is not required to begin local implementation.

## File responsibilities

- New `mt5/TradeOpsAgent/Include/TradeOpsTelemetryOutbox.mqh`: bounded preparation, exact retry, and response/rejection orchestration.
- Optional new adjacent outbox contract include: shared typed context/candidate/adapter interfaces if needed to avoid cyclic includes.
- Extend `mt5/TradeOpsAgent/Include/TradeOpsTelemetryState.mqh`: closed methods to read verified context/pending, prepare pending, accept response, and replace a definitively rejected envelope, all through its private publisher.
- Extend `mt5/TradeOpsAgent/Include/TradeOpsTelemetryStorage.mqh`: admit PREPARE/ACK/REPLACE into the runtime transition allowlist; retain existing reserve restrictions.
- New `mt5/TradeOpsAgent/Scripts/Support/TradeOpsTelemetrySyntheticOutbox.mqh`: strict bounded synthetic adapter, with no production construction path.
- New `mt5/TradeOpsAgent/Scripts/TradeOpsTelemetryOutboxSelfTest.mq5`: executable MQL failure scenarios using the actual state/outbox and fresh instances after simulated crashes.
- New `apps/execution-edge/test/mt5-telemetry-outbox-v2-source.test.ts`: explicitly static contract/isolation evidence plus any actual receiver fixture agreement checks.
- Narrow updates to state self-test/source seam and file-store predecessor pins, only where the outbox intentionally extends the reviewed contract. Record every changed predecessor hash in the execution audit.

Preserve StorageCodec, Values, Record, native FileStore, MemoryStore unless a separately reproduced harness defect requires a reviewed test-support change, active `TradeOpsAgent.mq5`, receiver production source, private configuration and frontend source.

## Task 1: Freeze and test the outbox boundary

- [x] Define closed typed context/candidate and trusted adapter interfaces. Context binds the current root and registration; candidate cannot contain an arbitrary full replacement state, path, locator, transition string, or caller approval flag.
- [x] Author native scenarios for pending publication/restart, exact retry, trailing appends, ACK publication and rejection. The static host seam was red before runtime implementation; the native harness was authored alongside runtime work and remains unexecuted.
- [x] Run the new host seam to establish missing-target/contract failures; report it as static evidence. Native behavioral tests remain pending until compiled and run on Windows.

## Task 2: Implement preparation and retry

- [x] Every operation checks ownership, refreshes inventory, and verifies the current root against disk. Snapshot alone is insufficient. Clear outputs first and publish only complete results.
- [x] Select contiguous events beginning at accepted_event+1; cap at32 and stop before the first repeated deal. The adapter supplies exact encoded byte size. Shrink only after a specific size-limit outcome. A head event that cannot fit returns LIMIT; a nonempty queue must not become endless empty heartbeats.
- [x] The adapter validates exact request bytes against committed registration and selected event bytes. Keep wire body digest, payload hash and full PENDING-frame digest distinct.
- [x] Derive counters/references inside State, allocate above every observed generation, write PENDING ordinal1, state, then commit. Reload before exposing bytes. PREPARE/REPLACE use normal budgets.
- [x] Existing pending bypasses construction and returns exact persisted bytes. Trailing appends cannot change frozen counters, events, snapshots or diagnostics in that request. Validate pending_produced against its frozen value, not equality with current produced.
- [x] Empty heartbeats use the persisted prior event ACK, including nonzero ACK. PREPARE moves UP_TO_DATE to CATCHING_UP while retaining named error/reconciliation states.

## Task 3: Implement ACK and stale-envelope replacement

- [x] State calls the trusted adapter on stored pending bytes and the bounded response (max16384). Compare identity, registration, request/body/frame association, exact final event ACK and acceptance time before any write. Synthetic validation demonstrates malformed/digest/coverage/mode/command rejection; production wire parsing remains absent.
- [x] Check the retained exact ACK witness first, including when a newer pending exists. Identical replay has no write/counter side effects. A different response cannot use this path.
- [x] Publish ACK ordinal2 plus candidate state/commit. Advance accepted counters and remove only the pending prefix, preserving tail/produced/capture/diagnostics. Clear every pending metadata field. ACK may use the reserve. Do not infer up-to-date capture merely from acceptance.
- [x] Replacement requires a definitive rejection classified by the trusted adapter against the exact pending request. Timeout, generic status or invalid response cannot qualify. Keep request sequence, registration and selected event bytes/identities/counters. Validate only envelope renewal; commit replacement before returning it.
- [x] Keep old rejected pending evidence. Do not weaken compaction: current/previous roots and references remain protected; retirement requires positive classification and at most32 deletions per call.

## Task 4: Failure matrix and regression

- [x] Author native scenarios that restart with fresh state/outbox instances after MemoryStore.Crash at before/after object/state/commit CREATE boundaries for PREPARE/ACK/REPLACE. A missing commit restores old authority; a damaged highest commit blocks. An effective commit whose success return was lost is recovered.
- [x] Author native scenarios for read/revalidation errors, counter exhaustion, ownership/identity mismatch, 32-event/repeated-deal/encoded-size boundaries, oversized head, nonzero heartbeat ACK, invalid/partial responses, duplicate ACK with newer pending, and appends behind frozen pending.
- [x] Author native scenarios for ACK reserve vs PREPARE/REPLACE normal limits and compaction interruption with a newer pending; no required or unacknowledged bytes may disappear.
- [x] Run focused telemetry/source/boundary tests, TypeScript typecheck/lint and `node scripts/verify-mt5-dry-run-boundary.mjs`; run the complete execution-edge regression after the final implementation changes.
- [x] Independently review specification compliance, then code quality. Resolve significant findings and rerun affected checks. Compare actual file hashes against the508-file baseline; explain intentional changes and preserve all others.

## Task 5: Source handoff

- [x] Create a source-only ZIP outside the backend worktree with the isolated outbox self-test, required includes/support, source SHA256 manifest and Windows instructions. Verify every archived source byte against the reviewed worktree and test archive integrity.
- [x] Record actual host verification/review results and native evidence limits in an audit. A TypeScript check does not execute MQL5; a compile result does not establish native recovery behavior.
- [x] Hand off the isolated self-test for Windows compile/runtime verification. The original telemetry storage fixture remains retained; the new test uses deterministic memory storage and does not need that namespace cleared.

## Completion criterion

The local implementation checkpoint is complete when its code, native failure harness, host checks, independent reviews and source archive are ready. Native outbox compile/runtime remains a separate pending handoff. Full telemetry, account/history capture, live wire adapter, dashboard financial reads and rollout remain subsequent milestones.
