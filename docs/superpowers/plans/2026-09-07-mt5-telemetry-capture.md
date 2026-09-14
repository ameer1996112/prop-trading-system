# MT5 read-only capture implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development for isolated implementation followed by specification and quality review. Preserve the existing dirty worktrees; do not commit, stage, deploy, install an EA, or place a trade.

**Goal:** Implement the approved account-wide snapshots and forward-only broker-deal capture checkpoint, with durable cursors/revisions and explicit gaps.

**Architecture:** A typed injectable read-only broker adapter feeds account/exposure capture and a journal collector. State remains the sole persistence writer; the collector reads a fresh committed checkpoint and atomically appends event records plus its next checkpoint. Production HTTP, request/response lifecycle and active-EA wiring remain Stage 3D.

**Tech Stack:** MQL5, existing exact-value/record/State/outbox helpers, deterministic memory broker/storage fixtures, existing TypeScript v2 validators, Windows MetaEditor handoff.

## Scope and evidence

Windows follow-up (2026-09-07): the operator supplied a failed compile with6 errors/0 warnings. Corrected three MQL5 enum names and moved the synthetic2048-row history buffer to checked dynamic allocation without changing capacity or production behavior. Replacement bundle `TradeOpsTelemetryCapture-2e3554c48b2b.zip` passed independent repair review,36 files/582 host tests and archive integrity checks. Windows recompilation is pending; see [compile follow-up evidence](../../audits/2026-09-07-mt5-telemetry-capture.md). The initial `d6045e557df6` package is superseded but retained.

User authorized this checkpoint with “ok lets do it” on 2026-09-07 after the account/history-capture recommendation. The approved parent design is [account telemetry and journal](../specs/2026-09-03-mt5-account-telemetry-journal-design.md); [EA delivery](2026-09-03-mt5-telemetry-ea-delivery.md) defines Stage 3C. Implementation choices below refine that scope, not a new product/service or rollout.

Backend: /Users/ameeramer/.config/superpowers/worktrees/prop-trading-system/mt5-stale-payload-recovery.
Docs: /Users/ameeramer/.config/superpowers/worktrees/prop-trading-system/tradeops-dashboard-migration.
Baseline513 files: /private/tmp/tradeops-capture-3wW0A6/baseline.json, with copies of relevant predecessors under before/. Baseline suite35 files/574 tests passed.

The operator reports outbox compilation0 errors/0 warnings and completion with8081 checks. No full final marker, failures field, raw log or compiled EX5 identity was uploaded. Record this as operator-reported native completion, not independent binary verification. No repeat run is needed to start local capture work.

Preserve active TradeOpsAgent.mq5, v1 configuration/transport, receiver production source, frontend, StorageCodec/Values/Record/FileStore/MemoryStore and outbox behavior. The only planned predecessor runtime change is a narrow verified capture-checkpoint read seam in State. Any necessary predecessor source hash-pin change must list old/new hashes and preserve unrelated assertions.

## Frozen engineering contract

### Typed capture and native reads

New files under backend mt5/TradeOpsAgent:

- Include/TradeOpsCaptureTypes.mqh: bounded structs, enums/status strings, clearing/validation helpers and ITov2CaptureBroker interface.
- Include/TradeOpsCaptureCodec.mqh: canonical JSON encoding/strict validation for registration, normalized records, account/exposure and versioned local checkpoint payloads. Full sync-envelope/response handling is excluded.
- Include/TradeOpsAccountSnapshot.mqh: account-wide capture, pinned identity checks and last-complete exposure retention.
- Include/TradeOpsNativeCaptureBroker.mqh: only documented account/position/order/history/symbol/time read APIs, no trade/send/network/file APIs.
- Include/TradeOpsJournalCollector.mqh: cutover, bounded history windows, revisions/protection observations and State append orchestration.
- Include/TradeOpsCaptureStateCodec.mqh may hold the focused checkpoint grammar/validator if needed to keep the JSON/value codec bounded.
- Scripts/Support/TradeOpsTelemetryCaptureBroker.mqh: deterministic fake broker only.
- Scripts/TradeOpsTelemetryCaptureSelfTest.mq5: actual native modules exercised with synthetic broker/memory storage.
- apps/execution-edge/test/mt5-telemetry-capture-v2-source.test.ts: expressly static isolation/contracts and agreement with actual receiver validators.
- mt5/TradeOpsAgent/fixtures/telemetry-capture-v2.json: shared canonical registration/account/exposure/deal/protection vectors, with independent expected hashes.

Required interface capabilities: read identity/display/clocks, account readings, exposure arrays with counts/status, boundary-second ticket IDs (max1024), and one bounded history window (max256 returned deal rows). Native methods return distinct success/read-failure/limit/unsupported outcomes; never use a failed query as empty history. No callback may mutate broker state.

Normalized fields/enums must match telemetry-wire-v2.ts exactly. Tickets remain decimal strings derived from ulong; no double conversion. Known decimals use existing scale0..16 helpers. Account core money fields use broker currency scale, prices use symbol digits, volumes use validated symbol step precision. Margin level at zero margin is NOT_APPLICABLE. Missing SL/TP at zero is NOT_SET. Failed account capture makes all five readings missing; failed/limited exposure returns empty attempt arrays and real counts when known without erasing the separately retained complete exposure. Never attach strategy attribution to EXPERT reason.

Every capture rechecks the pinned fingerprint before and after reads. Fingerprint uses the existing login|server|company algorithm locally; full login and comments are neither returned nor logged. Identity/display/clock failures clear outward data and fail closed. Compare membership and stable fields across bounded exposure passes to detect enumeration races, including unchanged counts with different tickets. No symbol allowlist or chart-symbol filter.

### Registration and durable checkpoint

Explicit enrollment is separate from recovery. It needs a caller-supplied valid new tracking identity/configured fingerprint and inspected empty State; never initialize on missing/corrupt recovery.

Use at most3 bounded cutover attempts: sample broker second/UTC and identity; read that second's existing deal IDs; capture complete baseline exposure; read IDs/identity/clock again; accept only stable IDs, baseline membership and same broker second. Sort excluded IDs lexicographically, unique, max1024. Freeze registration boundary/display/baseline and its canonical boundary digest before State.InitializeNew. A failed attempt never creates a new tracking start or uploads data.

The versioned checkpoint retains immutable registration binding, forward scan cursor/window, rotating correction cursor, last broker/UTC clock observations, scanned watermark, record/observation gap, known deal revision/content/record hashes, baseline position identities, queued-event observation UTC metadata, and latest/last-complete snapshots. All checkpoint bytes fit the existing262144 payload bound; define strict grammar/roundtrip validation before implementation. Unsupported schema or corrupt checkpoint blocks recovery, not reset.

Retained revision index bound1024 and queued-event metadata bound512 are safety ceilings. Never evict acknowledged deal identities to fit: exhaustion records a named gap and stops scan advancement. Quarantine a bounded safe unsupported-record descriptor in the checkpoint (ticket/time/numeric type and redacted reason, no comments); no fabricated event or ACK. If the diagnostic cannot be persisted, keep an explicit in-memory error and stop.

State read seam:
```cpp
int ReadCaptureContext(Tov2LocalState &state, string &root_sha,
                       uchar &registration[], uchar &capture[]);
```
Clear every output first; Guard, refresh inventory, verify current root; read only committed registration/capture references and invoke typed validation; stage copies and expose them only on success. Do not expose locators, session or generic whole-state mutation.

### Journal and event hashes

Scan only broker-time ranges at/after the immutable start. Use small windows (initial maximum60 seconds), inclusive overlap at the previous boundary, stable time/ticket ordering and content comparison. Adaptively split overfull windows; an overfull one-second window stops with a gap. Process at most32 new events per append. Persist resumable cursor only with those exact events; a crash reads committed state into a fresh collector.

Do not depend on history-list order/index across calls. Re-scan a partial window with retained content identities, or bind continuation to a verified window digest and restart that window if it changed. Never advance through an unprocessed row. After forward coverage, rotate bounded older windows from start to watermark to detect corrected records. A missing prior deal is not a cancellation; only explicit broker cancellation/revision facts create revisions.

DEAL revision1 has previous hash null; changed broker facts create revision+1 linked to prior canonical record hash, including after ACK/compaction. Unchanged facts create no event even after restart. Capture signed profit, commission, swap and fee separately, with exact readings. Non-trade balance/charge operations remain separate types. INOUT reversal_split remains null unless genuinely reconstructable; never invent a split or cost allocation.

Persist each event's canonical record JSON as the exact State event payload, so State's SHA(payload) equals receiver SHA(canonical record). Keep event observed UTC metadata in the same checkpoint for all unacknowledged events; this is not broker execution time. Event wrapper construction stays in3D. Use stable, bounded distinct event IDs and preserve them through retries.

Compare SL/TP only across complete exposure snapshots and create PROTECTION_OBSERVATION with source POLL and actual observation broker time. Missing positions/orders do not prove fills/cancellation. A bounded dirty-marker method does no I/O/history scan; timer-side capture handles work. After restart/disconnect/overflow, retain observation_gap independently of record_gap.

Do not claim UP_TO_DATE on heartbeat success. Scan completion, watermark, produced count, pending events and gaps remain independent; only finished scan without record gap and with all produced events acknowledged can yield UP_TO_DATE. Clock reversal or inconsistent broker/UTC deltas stops completeness until a full reconciliation establishes coverage. Never apply today's timezone offset to old deals.

## Task 1 — typed broker capture, canonical records and native adapter

- [x] Add a failing static contract/vector test first. Required assertions inspect new files, prohibit broker mutation/network/file calls, and validate canonical fixture bytes with existing parseTelemetryV2/canonical hashing. This is not MQL execution.
- [x] Implement bounded types/codec/account snapshot/native read adapter as specified above, with no active-EA include.
- [x] Author native fake-broker tests for money scales0/2/8, huge unsigned tickets, zero margin, unknown/no SL, NaN/read failure, all symbols, duplicate IDs,128/129 bounds, changed membership with equal count, identity switch, and complete→failed→complete exposure.
- [x] Run focused host seam and obtain independent spec then quality review before building the dependent collector. Both passed; see [audit](../../audits/2026-09-07-mt5-telemetry-capture.md). Native execution pending.

Host command:
```sh
npm test --prefix apps/execution-edge -- test/mt5-telemetry-capture-v2-source.test.ts
```
Expected initial failure: missing new module/fixture contract. Expected green: receiver accepts the supplied canonical vectors and source isolation assertions pass. Native behavior remains Windows-pending.

## Task 2 — durable cutover, history/revision collector and State seam

- [x] Freeze checkpoint encode/decode grammar and vectors, write the failing static seam and initial native scenario before implementation. Additional native cases were authored during implementation/review, not all test-first; none were executed on this Mac.
- [x] Implement the single State read seam and refresh only its intentional predecessor pins. Integrate the capture payload validator without weakening Pending/ACK validation: unsupported wire payload types fail closed until a trusted later adapter is injected.
- [x] Implement enrollment/recovery and bounded collector under the frozen contract. Use State.Append(events,capture) for all cursor/revision movement, including zero-event checkpoints; never update collector authority before successful durable publication.
- [x] Author native scenarios for boundary races/exclusions, pre-start baseline/late exit, unavailable/overfull history, overlap and unstable order, duplicate and corrected/cancelled records, standalone costs, reversal unknown,32-event pagination, old rotating corrections, clock switch, unsupported quarantine, callback burst, interrupted append before/after commit, fresh recovery, ACKed revision dedup and exact old pending bytes with new captures. Execution remains Windows-pending.
- [x] Review spec then quality; resolve substantive findings. Five specification findings and one P3 native-harness diagnostic improvement were fixed and independently re-reviewed; both reviews passed.

## Task 3 — regression, audit and Windows handoff

- [x] Run complete execution-edge tests, typecheck/lint and unchanged dry-run boundary verifier. Compare all513 baseline hashes; explain every intentional source/test-pin change.36 files/580 tests passed; only the State seam and its pin changed.
- [x] Record actual source hashes, reviewer findings/resolutions and host test results. Keep operator-reported outbox evidence distinct from native capture execution. See [final audit](../../audits/2026-09-07-mt5-telemetry-capture.md).
- [x] Package source-only native self-test plus required includes/support/vector manifest and instructions; verify archive members byte-for-byte. No active EA, credentials, real namespace initialization or network owner included. Bundle `TradeOpsTelemetryCapture-d6045e557df6.zip`,19 verified members.
- [x] Provide the Windows handoff to compile and run the synthetic capture self-test in test MT5. Native execution is still pending; a later explicit read-only demo comparison is required. No test order or active-EA replacement.

Commands:
```sh
npm test --prefix apps/execution-edge
npm run typecheck --prefix apps/execution-edge
npm run lint --prefix apps/execution-edge
node scripts/verify-mt5-dry-run-boundary.mjs
git diff --check
```

## Completion boundary

### Task 2 grammar and recovery decisions (frozen before implementation)

Enrollment is explicitly two-phase because the seven-field local identity already includes the immutable boundary digest. `PrepareEnrollment` freezes canonical registration and an initial checkpoint from caller-supplied account ID, installation ID, new tracking ID, epoch, profile hash and configured fingerprint. It returns the complete identity including the computed boundary digest. Only then does the caller construct State, open/recover an inspected-empty namespace, and explicitly initialize that exact frozen bundle. Recovery never calls preparation or initialization. A delayed publication retains the original cutover and scans forward from it; it does not rewrite the start time.

Checkpoint schema is `capture.v1`. Encoding is an ordered sequence of UTF-8 netstrings, with no separators outside each netstring: canonical decimal byte length, colon, exactly that many bytes, comma. First field is `TCAP1`. Empty fields are permitted only where specified. Reject leading-zero lengths, unknown tags, truncated lengths/bodies/commas, overflow, invalid UTF-8, extra trailing bytes, noncanonical embedded JSON, and any payload above262144 bytes. Decoder bounds counts and lengths before allocation and re-encodes to byte-for-byte equality before exposing output.

Fields, in this exact order:

1. Tag, seven-field identity, SHA256 of canonical registration payload (not storage frame), immutable start broker milliseconds, initialized UTC seconds, currency scale, produced sequence. Currency scale is immutable0..16 and is cross-checked against registration on recovery; carrying it here makes account/exposure decoding self-contained because State's Capture validator receives no registration payload.
2. Forward window start/end, rotating correction window start/end, scanned-through watermark (`0` means absent), scan-finished boolean (`0`/`1`), record-gap (`-` or receiver enum), observation-gap boolean, previous observed UTC, previous observed broker milliseconds, broker-advance anchor UTC, clock-reconciliation boolean, next-pass rotation boolean. The positive anchor UTC pairs with the last advancing broker observation; latest observed UTC is retained separately so idle-market polls do not create a false discontinuity on quote resumption and UTC reversals remain detectable.
3. Canonical account JSON; latest exposure attempt status, UTC, broker milliseconds, position/order counts (`-` means unknown); last-complete exposure canonical JSON. A COMPLETE latest attempt uses the separately stored last-complete arrays and must match its metadata. A failed attempt exports empty arrays. Registration supplies immutable baseline identities without duplicating the baseline in the checkpoint.
4. Revision-row count followed by that many rows of ticket, revision, canonical record SHA, revision-independent content SHA, broker timestamp. Rows sorted lexicographically by ticket, unique, maximum1024. No ACK-driven eviction. Each revision is positive and both digests valid.
5. Queue-metadata count followed by rows of sequence, event ID, observed UTC and canonical record SHA; ascending unique sequence, maximum512. Each sequence is positive and no greater than produced; event IDs unique. ACK may leave old rows in a persisted checkpoint because ACK does not rewrite capture. Recovery accepts this retained superset, but requires an exact matching row for every unacknowledged State event. The next successful capture checkpoint may purge only acknowledged metadata.
6. Protection-observation index count followed by rows of position ID and SHA256 of canonical protection facts with timestamp normalized to1 for change comparison (domain `TOV2-CAPTURE-PROTECTION-CONTENT|`). Rows sorted lexicographically by position ID, unique, maximum128. This is separate from the current complete snapshot: when more than32 protection changes need events, only successfully appended rows advance their observation digest, while the latest snapshot can still be retained accurately. Removing a row for an absent position is only bounded observation-cache maintenance, never evidence of a close/fill/cancellation. Initialize the index from the immutable complete baseline; newly seen positions produce their first POLL observation.
7. Quarantine-present boolean, and if present: valid ticket, broker timestamp, numeric raw type, numeric raw reason. No comments, login or broker text is retained. This is diagnostic only, never a fabricated event.

All counters use exact bounded decimal text; clocks are positive except explicitly absent watermark. Window endpoints remain at/after immutable start and start <=end. Registration binding and revision rows are revalidated on recovery; checkpoint produced must equal committed State produced. `CaptureAdvance` rejects identity/binding/start changes, produced regression, revision deletion/regression, inconsistent same-revision hashes, and an invalid revision increment/previous-link relationship where available. The collector owns the exact event/checkpoint correspondence and rechecks State references after fresh reads; the validator interface has no event-list argument, so it must not pretend to independently prove unavailable cross-object context.

A partial history window is re-read from its beginning on every call; retained facts suppress already committed rows. Sort by broker timestamp then ticket, reject duplicate conflicting rows, process at most32 new records, and advance the window only after all rows have been examined. History-overflow splitting never crosses below one broker second; a still-overfull second records HISTORY_UNAVAILABLE and does not advance. A previously retained deal absent from a fully read correction window records HISTORY_UNAVAILABLE rather than inventing cancellation. Forward passes and older correction passes alternate once caught up, preventing either from starving.

Protection observations and deal history share the32-event append budget. Use a bounded fair split when both have work (for example16 each), lending unused capacity to the other class. Before replacing a persisted complete exposure sample, drain every deferred protection observation from that sample using its original broker/UTC timestamps. The digest index alone cannot preserve older sampled SL/TP facts after replacement. While draining, retain the sample with its original age; observed callback activity during this interval marks an observation gap. An alternative implementation may replace the sample only if it durably and explicitly marks the superseded unappended observations as an observation gap; it must never silently claim those facts were recorded. A callback burst is only a saturating dirty count plus observation-gap flag; it never queues raw account/transaction payloads. Deal revisions remain in the non-evicting1024-entry ledger; the protection index is a distinct current-position observation cache and must not be used for P/L deduplication.

Row limits and encoded-byte limits are independent ceilings. Reserve at least1024 bytes within the262144-byte payload bound for diagnostic fields, and preflight the exact candidate encoding before publishing. On exhaustion, attempt a zero-event gap checkpoint derived from the prior committed checkpoint, leaving cursors/revisions/observation digests unchanged. If even that cannot be committed, stop with an explicit in-memory persistence error. Capture-derived coverage must come from capture data and the verified State acknowledged count, not State's separately stored completeness/last_error fields, which Append does not update.

A synthetic outbox adapter receives a pre-read verified capture context before Prepare and checks its root correlation; it must not call ReadCaptureContext from inside a State callback because the reentrancy guard correctly rejects that. Native snapshot-cache restoration is collector-owned via the strict exposure decoder; no additional snapshot or State mutation seam is needed.

A clock discontinuity removes the exported completed watermark and requests a full bounded reconciliation from the immutable boundary. It never changes past broker timestamps or the registration. Unsupported/limit/read failures persist an explicit gap if possible; failed publication leaves the last committed cursor authoritative and stops work. No unbounded retries or speculative in-memory progress.

The capture validator fails closed for Pending/ACK unless a separate trusted adapter is injected. Native integration tests may add a test-only capture outbox adapter to exercise exact pending bytes and ACK/restart behavior; it is not a production HTTP codec and is excluded from active-EA wiring. Capture checkpoint publication does not silently compact unrelated files; later lifecycle maintenance remains explicit.

### Specification-review refinements before source release

Enrollment additionally requires a fail-closed fresh broker-quote gate. A stable `TimeCurrent` value alone is insufficient: it may be a last quote from before a weekend. The native adapter accepts readiness only after observing a strictly advancing broker clock between closely spaced monotonic reads (at most1000ms apart), with at most1000ms receipt age and an exact match to the candidate boundary clock. First reads, long-gap advances, disconnection, clock reversal and identity changes cannot establish readiness. Preparation remains bounded and returns conflict with cleared output while waiting; the future lifecycle caller retries without creating a namespace. No PC-estimated broker timestamp or historical offset conversion is introduced. The test adapter exposes deterministic readiness.

Protection-only deferred work prevents UP_TO_DATE even when all staged events are ACKed. Discarding a newly read complete protection sample on a later history/unsupported/capacity failure must preserve that sample or explicitly persist an observation gap. Valid positive UTC reversal, including below enrollment UTC, invalidates the watermark and requires reconciliation before any new observation can be emitted.

The local capture source checkpoint is complete only after implementation, native harness, host regression, independent reviews and verified source bundle. Native compilation/synthetic execution and actual read-only demo comparison are separate pending evidence. The dashboard receives no financial data until3D and later private-read integration/rollout pass; do not imply that authoring the collector already connects it.
