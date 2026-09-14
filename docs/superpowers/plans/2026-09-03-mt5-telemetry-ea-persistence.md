# MT5 Telemetry Persistence: Local-Format Checkpoint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Freeze and implement the pure typed local-file format used by the approved restart-recovery design, without writing files or changing the installed EA.

**Architecture:** Add one metadata codec above the tested TOV2R1 envelope, with independent byte/hash vectors and a pure native self-test. Separate persisted file digests, wire-body digests and record payload digests. The filesystem adapter, ownership, publication/recovery and outbox remain mandatory dependent work; this plan does not claim to implement those behaviors.

**Tech Stack:** MQL5, the unchanged values/record includes, Node.js SHA-256, TypeScript/Vitest, later Windows MetaEditor verification.

---

## Status and scope

The user approved the [complete Stage 3B2 design](../specs/2026-09-03-mt5-telemetry-persistence-design.md) by saying “ok continue” after its handoff. Do not repeat that design-approval question.

This is the first executable local-format checkpoint within 3B2. It is split out because all subsequent modules depend on the same typed state/commit grammar, and it produces an independently testable pure component. **The complete 3B2 runtime implementation plan is not yet finished.** Do not present this narrower plan, its local tests, or its native codec marker as completed restart recovery. The unimplemented responsibilities are explicitly retained below.

Planning has changed documentation only. Do not stage, commit, push, merge, deploy, migrate, change Cloudflare bindings/secrets, change TradingView, touch Supabase, install an EA, or perform a broker operation. Local implementation requires an execution handoff; native testing remains separately identified. There is no new Windows action for the user now. Preserve the user's reported `TOV2_RECORD_PASS checks=475 failures=0` and compile 0/0; do not request that test again.

Backend root for all three proposed code files:

`/Users/ameeramer/.config/superpowers/worktrees/prop-trading-system/mt5-stale-payload-recovery`

Expected branch `codex/mt5-stale-payload-recovery`; inspected HEAD `8a801423bc19b3bb27c8e24f45d2800a9deb6881`; planning baseline 473 tracked/nonignored-untracked files. This is a dirty worktree. A changed HEAD/baseline requires inspection, not reset.

Documentation root:

`/Users/ameeramer/.config/superpowers/worktrees/prop-trading-system/tradeops-dashboard-migration`

Expected branch `codex/tradeops-dashboard-migration`; inspected HEAD `18e29ce68d9e9fc89311163e95dd2b71f040c527`; planning baseline 402 files. Do not move backend modules into this worktree. The app's current working directory is neither repository root.

## File map

| Ownership | Exact new repository-relative path | Responsibility |
| --- | --- | --- |
| Backend | `mt5/TradeOpsAgent/Include/TradeOpsTelemetryStorageCodec.mqh` | Bounded canonical metadata fields, references, local state/commit schema, full-file digest, structural invariants |
| Backend | `mt5/TradeOpsAgent/Scripts/TradeOpsTelemetryStorageCodecSelfTest.mq5` | Pure native format vectors, accepted/rejected metadata cases, output-clearing and bounds |
| Backend | `apps/execution-edge/test/mt5-telemetry-storage-codec-v2-source.test.ts` | Five static/vector/scalar-compatibility tests; explicitly not MQL execution |
| Documentation | This plan and its [complete code appendix](2026-09-03-mt5-telemetry-ea-persistence-code.md) | Executable source/test content and staged evidence gates |

The additional pure codec self-test is deliberately separate from the planned state fault-injection and real-file self-tests; their names and purposes remain reserved. No production transport/capture adapter is added by this checkpoint. No existing source file is modified.

The complete proposed contents of every code file appear in the appendix under their exact file headings. These are full replacement contents for **new files**, not patches to the existing record codec. Copy only the indicated fenced block to its target. If any target already exists, inspect it and stop for reconciliation rather than overwrite unknown work.

## Frozen contract and invariants

The appendix freezes every local payload field and its order. The state has 27 fixed LF-terminated fields, including its schema tag and named last error, followed by exactly the declared number of event references. Commit records have seven fields. Canonical re-encoding must equal the original bytes, rejecting extra fields, duplicate/trailing delimiters, CRLF, unknown schema, leading-zero numbers and forbidden characters.

Important non-equivalences:

- A checksum-valid outer frame is not a typed manifest, committed transaction, account registration, valid JSON request or validated ACK.
- `Tov2LocalFrameMatches` checks reference/full-file/envelope association. State and commit payloads still require their respective typed decoder. CAPTURE payload semantics belong to its adapter.
- `Tov2LocalStateValid` checks a single manifest's structural invariants. It does not authorize a transition from another state, prove server acceptance, or prove history reconciliation.
- Registration and event payloads stay exact bytes; metadata references carry their local associations. Pending payloads remain the exact full request with no metadata prefix.
- An absent optional reference is the fully cleared reference; stale metadata is rejected.
- The frozen produced-event count belongs to the pending request. A later append cannot rewrite it.
- Accepted request/event counts require a retained correlated ACK reference. A zero-event pending request after event ACK 2 must still expect ACK 2.
- Repeated deal IDs across queued revisions are allowed; repeated deal IDs inside the selected upload prefix are rejected. Identical deal/revision identity cannot appear twice in the unacknowledged queue.
- The receiver permits safety epoch zero. The local identity grammar uses minimum zero, not minimum one.
- `UP_TO_DATE` cannot coexist with an unsent queue, pending upload, or named error in this conservative local checkpoint. The later capture adapter must also validate that reconciliation is actually finished.
- The largest full-frame hash input is 262,345 bytes. The unchanged record preimage helper's smaller input bound is not reused for this purpose.
- No reference accepts a path from callers. Only exact kinds and canonical integer generation/ordinal components generate relative paths.
- Output byte arrays and decoded result structures are cleared on rejection.

Local errors are a closed redacted vocabulary; raw account data is not an error string. DATA_MISSING requires a named reason. RECONCILIATION_REQUIRED carries its corresponding reason. The runtime owner must not persist or advertise a completed recovery simply because these metadata fields can be encoded.

## Independently computed golden vectors

Node's SHA-256 computes these values from the textual grammar, independently of the proposed MQL functions:

| Vector | Payload bytes | Payload SHA-256 | Full frame bytes | Full frame SHA-256 |
| --- | ---: | --- | ---: | --- |
| INIT_STATE | 500 | `9bccb02d39c4158b2df2c0ea389afe9f1bfedf69a7a8fa0be2a6dd949a375290` | 597 | `577f01f1a1ccf7c39e567ab0da203efd0edf18002738592931c4b89dc3192706` |
| PENDING_STATE | 1021 | `7acea604e0f1f7626cd1c700d96c6d694653beb35bce2ee8a96e28c3d003d015` | 1119 | `66746cdcdaa23e1cfa407650e96839403774b285487d6d3e2562314d92656422` |
| PREPARE_COMMIT | 214 | `12b2da5e3ca373549c518d9408e9cec21886aebcfa4ece961e534280ef48f548` | 311 | `dcd76abe3ee40c9d724a53b622a0d8498e1546b12e604354bb2e0456f6d8c157` |

Installation `install.demo` hashes to `7246c0eecdeaa9b9a59b59c250e045bcaf47131ab392b31690339362facd7ed0` using ASCII `TOV2-INSTALL|install.demo`. The raw 262,345-byte array filled with `0xa5` hashes to `180d5a23cd4e5186392e648c88828250a67da838688cef28d79a1757a77257e5`.

A golden vector's checksum match is not a Windows/native execution result. All example identity values are synthetic; do not substitute real account data into tests.

## Task 1 — Freeze the tests before production code

**Files:** Create the native self-test and TS seam from appendix sections B and C. Do not create the codec yet.

- [ ] Inspect the backend branch, HEAD, index and dirty baseline using these read-only commands, each from the backend root:

~~~sh
git branch --show-current
git rev-parse HEAD
git status --short
git diff --cached --stat
~~~

Expected: the branch/HEAD above, preexisting dirty work preserved, no staged changes introduced. If the index was already dirty, preserve it and record it instead of clearing it.

- [ ] Confirm the three target files do not already exist:

~~~sh
node --input-type=module -e 'import {existsSync} from "node:fs"; const paths=["mt5/TradeOpsAgent/Include/TradeOpsTelemetryStorageCodec.mqh","mt5/TradeOpsAgent/Scripts/TradeOpsTelemetryStorageCodecSelfTest.mq5","apps/execution-edge/test/mt5-telemetry-storage-codec-v2-source.test.ts"]; const found=paths.filter(existsSync); if(found.length) throw new Error("Existing target(s): "+found.join(", ")); process.stdout.write("3 new targets available\n");'
~~~

Expected: `3 new targets available`. This is a read-only scope check, not permission to overwrite files.

- [ ] Create the TS seam with the exact complete section C source using `apply_patch`. It uses the already installed Vitest and existing scalar validators; no package/lockfile change is needed.
- [ ] Create the native self-test with the exact complete section B source using `apply_patch`. No file, network, account, history, time, DLL or trading API belongs in this file.
- [ ] Run the red test:

~~~sh
npm --prefix apps/execution-edge test -- test/mt5-telemetry-storage-codec-v2-source.test.ts
~~~

Expected: failure that names the missing `Include/TradeOpsTelemetryStorageCodec.mqh`. Dependency/startup/permission failure is not the intended red signal; resolve only the in-scope test-runtime issue, then rerun. Do not change production receiver behavior or the safety verifier.

Record the exact failed assertion. The red test proves the source seam catches a missing component; it does not yet prove native semantic failures.

## Task 2 — Implement the complete pure local-format codec

**File:** Create the include from appendix section A.

- [ ] Create `Include/TradeOpsTelemetryStorageCodec.mqh` with the exact complete section A source using `apply_patch`. It includes only the existing record header. Keep both previously tested includes byte-for-byte unchanged.
- [ ] Run the same focused test command:

~~~sh
npm --prefix apps/execution-edge test -- test/mt5-telemetry-storage-codec-v2-source.test.ts
~~~

Expected: five tests pass. If an independent vector differs, compare exact field bytes and hash domain; do not replace expected hashes to bless a disagreement.
- [ ] Inspect the full three-file diff and confirm no include was wired into `TradeOpsAgent.mq5`.
- [ ] Review every rejection fixture against the actual decoder/validator, especially the 512-reference boundary, shared-path rejection, zero-event pending request, absent optional metadata and unknown error values.

This is one pure component; do not append native filesystem methods to make other design requirements appear implemented. Do not add an `Ack(number)`, network call, live account reader or validation bypass.

## Task 3 — Verify local regression and boundary

No source changes are planned by this task. Run each command from the backend root:

- [ ] Full execution-edge tests:

~~~sh
npm --prefix apps/execution-edge test
~~~

Expected: all existing tests plus the five new seam tests pass. The last recorded baseline was 545 tests/31 files; with no concurrent additions this gives 550/32. Report the actual run's count rather than overwrite a newer baseline. These are JS/TS tests, not native MQL.
- [ ] Typecheck:

~~~sh
npm --prefix apps/execution-edge run typecheck
~~~

Expected: exit 0.
- [ ] Lint:

~~~sh
npm --prefix apps/execution-edge run lint
~~~

Expected: exit 0.
- [ ] Existing MT5 safety verifier:

~~~sh
node scripts/verify-mt5-dry-run-boundary.mjs
~~~

Expected: exit 0 without editing that verifier or any integrity manifest.
- [ ] Whitespace/diff check:

~~~sh
git diff --check
~~~

Expected: exit 0. Separately inspect new untracked files because `git diff` alone does not include them.
- [ ] Compare SHA-256 snapshots of all baseline files, HEAD and index. The only permitted additions are the three targets; no baseline source may change.

Record failures precisely. A Miniflare sandbox startup failure requires a narrowly scoped permission request, not weakened tests. No deployment/build-to-production command is in this plan.

## Task 4 — Native verification gate, held for the combined 3B2 handoff

The local-format source can be reviewed before Windows execution, but it is **not native-verified** until this gate passes. Do not ask the user to repeat the values/record tests. Avoid interrupting the user with another small standalone installation; bundle this pure test with the later approved 3B2 native handoff when ready.

- [ ] Independently review the codec and its fixture for MQL5 type/signature/array semantics. The TS seam does not compile structs containing fixed arrays or exercise string allocation failures.
- [ ] Prepare a source-only bundle only after the source review and local regressions pass. Include the exact new codec/self-test and unchanged values/record dependencies, plus SHA-256 manifest. No config file, credentials, existing EA, EX5, network endpoint or live account identifier belongs in it.
- [ ] At the separately approved Windows handoff, compile `TradeOpsTelemetryStorageCodecSelfTest.mq5`, not the `.mqh` include alone. Preserve the existing EA. Do not enable Algo Trading, DLLs or WebRequest for this pure test.
- [ ] Collect native compile 0 errors/0 warnings and the runtime line `TOV2_STORAGE_CODEC_PASS checks=<actual-count> failures=0`. Report user-reported versus uploaded/independently checked evidence accurately; the exact runtime count is determined by the actual test execution.
- [ ] If a failure appears, preserve its named assertion and diagnose locally. Do not reset journal/configuration files or ask for a broker test order.

This pure script performs no file I/O. The later real-file self-test is a different artifact and requires approval of its exact new synthetic common-files namespace before it creates anything. No Windows execution is performed by writing or executing the local source tasks in this plan.

## Task 5 — Review handoff without committing

- [ ] Perform specification review against this plan and the local-format parts of the approved design.
- [ ] Perform separate code-quality review after specification issues are resolved.
- [ ] Record actual local test evidence, source hashes, scope changes and native pending/completed status. Keep previous native test evidence intact.
- [ ] Stop before wiring any module into the active EA, writing telemetry state, or claiming full 3B2 completion. Do not stage or commit.
- [ ] Continue the runtime planning items below against these fixed, reviewed names and signatures.

If using subagents after execution choice, assign one bounded implementer for the three files, then fresh specification and quality reviewers. Do not dispatch state/storage/outbox implementations simultaneously against unfrozen interfaces.

## Remaining full-3B2 requirements — not executable tasks in this checkpoint

These are retained from the approved design, not waived or claimed covered by the codec:

| Requirement | Future owning module / evidence |
| --- | --- |
| Same-installation ownership held across operations; identity recheck before capture/send; no automatic initialization | `TradeOpsTelemetryStorage.mqh`, `TradeOpsTelemetryState.mqh`; same-root concurrent-handle and mismatch tests |
| Three-way read/inventory outcome, binary exact counts, non-overwriting creation, bounded namespace inventory | Native storage adapter; real-file and injected failure tests |
| Observe every generation including abandoned files; commit last; uncertain operation requires disk reload | State engine + deterministic memory store |
| Corrupt highest commit blocks, no lower-root fallback; missing live reference blocks | Fresh-instance recovery test at every publication boundary |
| Registration payload/capture version validation, boundary/cursor atomically committed with events | Explicit adapter contracts; defined synthetic capture adapter in 3B2 and real collector in 3C |
| Frozen request selection/build/validation, exact bytes before exposure, prefix limit32/exact bytes/repeated deals | `TradeOpsTelemetryOutbox.mqh`; fake strict wire adapter and future production 3D adapter |
| Full response association, exact ACK commit before event retirement, duplicate ACK witness, definitive stale-envelope replacement only | Outbox and adapter tests; no caller boolean validation bypass |
| 64+8 MiB and 4096+128 physical-file budgets, reserve-limited transitions, count orphan/quarantined files | State admission/preflight and fault harness |
| Current and previous intact root retention, acknowledged-only classified retirement, max32 deletion batch, preserve abandoned/corrupt evidence | Conservative compaction with interruption tests and no recursive cleanup |
| Two-terminal/native exclusive-lock behavior and fresh-process binary reopen | Separate real-file test with explicit synthetic-namespace approval |
| Fresh instance for every simulated restart; no speculative memory or hidden cursor advancement | `TradeOpsTelemetryMemoryStore.mqh`, `TradeOpsTelemetryStateSelfTest.mq5` |
| No full-folder rollback or cross-machine clone guarantee, no power-loss durability claim | Documented operational limits and rollout checks |

The runtime plan must include complete implementations and native fault-test code for these modules before those tasks are executable. In particular, `FileFindNext` documents a boolean success result, not a proof of every OS-level enumeration failure being distinguishable from completion. Reset/read error codes around calls, reject explicit errors, test the actual terminal behavior, and state the verified limits honestly. Do not infer an empty namespace from any false file probe. [MetaQuotes FileFindNext](https://www.mql5.com/en/docs/files/filefindnext), [FileIsExist](https://www.mql5.com/en/docs/files/fileisexist).

Local completeness has stricter prerequisites than a green heartbeat. Full state/outbox recovery remains open until all approved acceptance scenarios, actual native file semantics and independent reviews pass.

## Plan self-review

- Local-format spec coverage: exact schemas, error vocabulary, integer/identifier compatibility, no paths, metadata size bounds, maximum full-file hash, ordered references, pending frozen count, ACK correlation metadata and independently computed vectors are covered by tasks 1–3 and appendix A–C.
- Complete 3B2 coverage: deliberately **not complete**; the preceding table records every remaining runtime obligation. No native filesystem or recovery success is asserted.
- No undefined project helper in the proposed codec/self-test: functions are defined in appendix A/B or the unchanged values/record includes; TS imports were checked against the actual receiver.
- Golden vectors are independently recomputed from the grammar, not copied from MQL execution. The ACK/pending fields are associations, not authorization to acknowledge.
- Test and implementation content is complete for these three files. No existing source edits, package changes, paid services, database migration or deployed/installed change are part of the checkpoint.
- MQL compile/runtime behavior is unverified on this Mac; native evidence is a separate gate, not replaced by an in-memory TS syntax check.

## Planning verification (not implementation evidence)

Fresh checks while writing this plan: three complete fenced source blocks; zero TypeScript parse diagnostics; three independent golden vectors matching the proposed native fixture literals; no undefined project-prefixed helper calls; 38 named native-case anchors present; pure-code API boundary checks passed. The unchanged values and record source hashes still match their recorded artifacts. Fifteen relative document links resolved. Both worktrees passed `git diff --check`.

The backend's 473 baseline files, HEAD and index were unchanged, and the three planned source targets were still absent. Documentation changes were limited to this plan, its code appendix and two design/delivery status updates. No MQL compiler, native test, persistence test or full application test suite was run by this documentation pass. These checks do not establish executable EA behavior.

## Execution handoff

Choose either:

1. **Subagent-driven (recommended):** one implementer, then specification and quality reviews, with the controller checking the actual diff/tests.
2. **Inline execution:** perform tasks 1–3 in this task, review, and leave native testing explicitly pending for the combined handoff.

Both choices keep the current EA, cloud services and account untouched. Neither choice marks full restart recovery or the trading system ready.
