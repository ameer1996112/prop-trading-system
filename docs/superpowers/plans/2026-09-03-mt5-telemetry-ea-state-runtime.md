# MT5 Telemetry Persistence: Pure State Runtime Checkpoint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement and fault-test the locator-only storage contract, deterministic memory adapter, and pure INIT/APPEND/DIAGNOSTIC/CHECKPOINT publication and recovery engine without native files, outbox behavior, or active-EA wiring.

**Architecture:** Caller-owned `ITov2TelemetryStorage` and `ITov2TelemetryStatePayloadValidator` dependencies separate typed locators, conservative storage outcomes, and typed registration/capture/event/pending/ACK semantics from the state machine; both dependencies must outlive the state object, its constructor is inert, and `Open`, `Recover`, and `InitializeNew` remain explicit. Central `StorageValid`, `ValidatorValid`, and `DependenciesValid` `CheckPointer` guards reject `POINTER_INVALID` before every dependency dereference. The state engine freshly verifies the committed root, builds immutable TOV2R1 files entirely in memory, publishes the commit last, and forces recovery after every non-definite mutation outcome; a namespace-bound flat-arena memory store uses logical counts to make partial allocation/copy failures invisible, injects failures before and after every persistence boundary, and preserves committed bytes across simulated crashes.

**Tech Stack:** MQL5, the unchanged `TradeOpsTelemetryStorageCodec.mqh`/TOV2R1 codec, deterministic in-memory fault injection, TypeScript/Vitest static source seams, later MetaEditor native verification.

---

## Status, authority, and hard boundary

The approved [Stage 3B2 persistence design](../specs/2026-09-03-mt5-telemetry-persistence-design.md) remains authoritative. The completed [local-format checkpoint](2026-09-03-mt5-telemetry-ea-persistence.md) and its [code appendix](2026-09-03-mt5-telemetry-ea-persistence-code.md) freeze the existing codec API. This plan is the next independently executable checkpoint; it does not complete the outbox, native file ownership, capture, networking, broker integration, deployment, or rollout.

Planning changes documentation only. During later execution, create only the five backend targets listed below. Do not stage, commit, push, merge, deploy, install, compile on Windows without a separate handoff, change a binding/secret/database, call a broker, or wire the active EA. Preserve all dirty work in both repositories.

Backend root:

`/Users/ameeramer/.config/superpowers/worktrees/prop-trading-system/mt5-stale-payload-recovery`

Expected backend branch/HEAD at planning time: `codex/mt5-stale-payload-recovery`, `8a801423bc19b3bb27c8e24f45d2800a9deb6881`; 476 unique tracked plus nonignored-untracked files. Documentation root branch/HEAD: `codex/tradeops-dashboard-migration`, `18e29ce68d9e9fc89311163e95dd2b71f040c527`; 404 tracked plus nonignored-untracked files. A changed value requires read-only reconciliation, never a reset. Count with `git ls-files -co --exclude-standard | sort -u | wc -l`; omitting deduplication overcounts modified tracked files.

Pinned predecessor hashes:

| Existing backend file | Planning SHA-256 | Required outcome |
| --- | --- | --- |
| `mt5/TradeOpsAgent/Include/TradeOpsTelemetryValues.mqh` | `0016223e32d8d0cf960a3b015581518948a8a2e1464196c0d8f7952d4dc9ea4f` | byte-for-byte unchanged |
| `mt5/TradeOpsAgent/Include/TradeOpsTelemetryRecord.mqh` | `7a0f42d1d481487ba812f6ef2b18faaf3f80143980388f4f54efd8075d977685` | byte-for-byte unchanged |
| `mt5/TradeOpsAgent/Include/TradeOpsTelemetryStorageCodec.mqh` | `6caf9d02cbd5afc1a940d9744f125e7d97239cd622fba2785ddd340580b7f6ad` | byte-for-byte unchanged |
| `mt5/TradeOpsAgent/Scripts/TradeOpsTelemetryStorageCodecSelfTest.mq5` | `d8a206fc8dd9bd1183ee7f187225eb5984ac997a328785c55d03b2445f5ee7ff` | byte-for-byte unchanged |
| `apps/execution-edge/test/mt5-telemetry-storage-codec-v2-source.test.ts` | `b2c41688e147d23ffe93140aec4e7877c9b61dddb1206663c9f79aecbb8a65a0` | byte-for-byte unchanged |
| `mt5/TradeOpsAgent/TradeOpsAgent.mq5` | `4d3058b7ada9d2a2de5ab7bd864225e9120f645cf084e75e731ba747983b12b9` | byte-for-byte unchanged and unwired |

The user-reported native predecessor result remains `TOV2_RECORD_PASS checks=475 failures=0` with GUI compile 0 errors/0 warnings. It is not an independently collected runtime log. Do not request that test again merely to execute this checkpoint.

## Complete file map

| Order | Exact new backend path | Single responsibility |
| --- | --- | --- |
| Test first | `apps/execution-edge/test/mt5-telemetry-state-v2-source.test.ts` | Red/green source seam: target absence, signatures, limits, labels, forbidden APIs, active-EA isolation, and all five proposed files |
| Test first | `mt5/TradeOpsAgent/Scripts/TradeOpsTelemetryStateSelfTest.mq5` | Strict synthetic typed validator, fresh-instance restart, mixed replay, typed corruption, and ordered compaction fault matrix; no real file, account, time, network, or trade APIs |
| Production | `mt5/TradeOpsAgent/Include/TradeOpsTelemetryStorage.mqh` | Locator types, outcome vocabulary, abstract interface, pure path/inventory/budget helpers only |
| Test support | `mt5/TradeOpsAgent/Scripts/Support/TradeOpsTelemetryMemoryStore.mqh` | One-installation-bound flat-arena adapter, logical record/arena/delete-log counts, transactional publication under allocation/copy faults, reusable ownership sessions, crash preservation, before/after-effect and unexpected-outcome faults, deletion-order evidence |
| Production | `mt5/TradeOpsAgent/Include/TradeOpsTelemetryState.mqh` | Typed payload-validator interface, fresh-root verification, explicit initialization/recovery, mixed replay/suffix allocation, publication, diagnostic/checkpoint, ordered compaction |

The [complete code appendix](2026-09-03-mt5-telemetry-ea-state-runtime-code.md) contains exactly one full fenced source block for each target. All are new files. If any target exists at execution time, stop and reconcile it; do not overwrite unknown work.

## Frozen public signatures

The appendix is definitive. These signatures are pinned by the TypeScript seam:

~~~cpp
struct Tov2StorageLocator { int kind; long generation; long ordinal; };
struct Tov2StorageEntry { Tov2StorageLocator locator; string relative_path; long size; string sha; };

class ITov2TelemetryStorage
{
public:
   virtual int Acquire(const string installation_key,string &session_token)=0;
   virtual int Revalidate(const string session_token)=0;
   virtual int Inventory(const string session_token,Tov2StorageEntry &entries[])=0;
   virtual int Read(const string session_token,const Tov2StorageLocator &locator,uchar &bytes[])=0;
   virtual int CreateExact(const string session_token,const Tov2StorageLocator &locator,const uchar &bytes[])=0;
   virtual int DeleteExact(const string session_token,const Tov2StorageLocator &locator,const string expected_sha)=0;
   virtual void Close(const string session_token)=0;
};

class ITov2TelemetryStatePayloadValidator
{
public:
   virtual bool Registration(const uchar &payload[],const string expected_identity)=0;
   virtual bool Capture(const uchar &payload[],const string capture_schema,const string expected_identity)=0;
   virtual bool CaptureAdvance(const uchar &previous_payload[],const string previous_schema,const uchar &candidate_payload[],const string candidate_schema,const string expected_identity)=0;
   virtual bool Event(const uchar &payload[],const string event_id,const string record_sha,const string deal_id,const long revision,const string expected_identity)=0;
   virtual bool Pending(const uchar &payload[],const Tov2LocalState &state,const string expected_identity)=0;
   virtual bool Ack(const uchar &payload[],const Tov2LocalState &state,const string expected_identity)=0;
};

class CTov2TelemetryState
{
public:
   CTov2TelemetryState(ITov2TelemetryStorage *storage,ITov2TelemetryStatePayloadValidator *validator,const string expected_identity);
   int Open();
   int Recover();
   int InitializeNew(const uchar &registration_payload[],const uchar &capture_payload[],const string capture_schema);
   int Append(const Tov2AppendCandidate &candidates[],const uchar &event_payload_arena[],const int &event_ends[],const uchar &capture_payload[],const string capture_schema,long &sequences[]);
   int PublishDiagnostic(const string completeness,const string named_error);
   int Compact();
   void Close();
   bool ReloadRequired() const;
   bool Snapshot(Tov2LocalState &state);
};
~~~

MQL5 interfaces using pure virtual methods with dynamic-array references remain a native-compilation risk, not a verified language claim. Review and MetaEditor compilation are explicit gates. The caller owns both non-owning pointers and must keep both referents alive longer than the state object; construction calls neither. Central pointer helpers use `CheckPointer` and reject `POINTER_INVALID` before `Open` and every storage/validator use. `Close` checks only the storage pointer it can dereference, allowing a still-valid storage session to close even if the validator was invalidated. No primitive `Ack(number)`, `validated=true`, arbitrary path, delete-all, reset, repair, sendable payload, PREPARE, ACK, or REPLACE API exists.

## Closed outcomes and transition table

Storage results are named integers, never booleans that erase ambiguity:

| Operation | Exact outcomes |
| --- | --- |
| `Acquire` | `TOV2_STORE_ACQUIRED`, `TOV2_STORE_BUSY`, `TOV2_STORE_CONFLICT` for a different installation key bound to this single-namespace adapter, `TOV2_STORE_IO_ERROR` |
| `Revalidate` | `TOV2_STORE_OK`, `TOV2_STORE_OWNERSHIP_LOST`, `TOV2_STORE_IO_ERROR` |
| `Inventory` | `TOV2_STORE_OK`, `TOV2_STORE_ABSENT`, `TOV2_STORE_IO_ERROR`, `TOV2_STORE_OWNERSHIP_LOST`, `TOV2_STORE_LIMIT` |
| `Read` | `TOV2_STORE_OK`, `TOV2_STORE_ABSENT`, `TOV2_STORE_IO_ERROR`, `TOV2_STORE_OWNERSHIP_LOST`, `TOV2_STORE_LIMIT` |
| `CreateExact` | `TOV2_STORE_CREATED`, `TOV2_STORE_EXISTS_SAME`, `TOV2_STORE_CONFLICT`, `TOV2_STORE_IO_ERROR`, `TOV2_STORE_OWNERSHIP_LOST`, `TOV2_STORE_LIMIT` |
| `DeleteExact` | `TOV2_STORE_DELETED`, `TOV2_STORE_ABSENT`, `TOV2_STORE_CONFLICT`, `TOV2_STORE_IO_ERROR`, `TOV2_STORE_OWNERSHIP_LOST` |

`Inventory` may expose only adapter-produced canonical relative paths as evidence. Callers can construct typed locators, never paths. `owner.lock` is excluded from budget only when its inventory entry is exactly zero bytes; nonzero owner evidence blocks mutation.

| Runtime transition | Normal/reserve class | New objects | State | Commit | Checkpoint result |
| --- | --- | --- | --- | --- | --- |
| INIT | normal | registration and capture | generation 1 | INIT, last | supported only via `InitializeNew` |
| APPEND, including zero events | normal | 0–32 events and one capture | next observed generation | APPEND, last | supported |
| DIAGNOSTIC | reserve-eligible | none | next observed generation | DIAGNOSTIC, last | supported |
| CHECKPOINT | reserve-eligible | none | self-contained next generation | CHECKPOINT, last | internal to `Compact` |
| PREPARE | reserved later | none | none | none | `TOV2_STATE_UNSUPPORTED` |
| ACK | reserved later | none | none | none | `TOV2_STATE_UNSUPPORTED` |
| REPLACE | reserved later | none | none | none | `TOV2_STATE_UNSUPPORTED` |

INIT and APPEND must fit 64 MiB and 4,096 files. In this checkpoint only DIAGNOSTIC and CHECKPOINT may consume the additional 8 MiB and 128 files; the pure helper also freezes ACK as reserve-eligible for the later outbox, while this runtime still refuses ACK. Every frame is at most 262,345 bytes, payload at most 262,144, the queue at most 512, APPEND at most 32 candidates, and compaction deletes at most 32 individually verified files per call.

## Recovery and publication invariants

- `CTov2TelemetryState` retains the full expected identity and non-owning pointers to caller-owned, longer-lived adapter and validator objects. Its constructor invokes neither dependency. Central storage/validator/dependency guards apply `CheckPointer` before every dereference; `Close` checks the storage pointer specifically, and `POINTER_INVALID` is a safe refusal. INIT validates registration and capture payloads; APPEND validates prior/candidate capture semantics and every event; recovery validates registration, capture, event, pending, and ACK payloads after envelope/reference checks.
- One memory-store instance models exactly one installation namespace: its first successful/effectful acquire binds the installation key, `Crash()` clears the owner session but preserves that binding and all bytes, and a different key is refused before inventory or read exposure. An acquire-after-effect injected error clears its unusable owner token so the same installation can acquire again.
- `Open` acquires only. `Recover` neither initializes nor repairs. `InitializeNew` works only after an exact empty-namespace recovery result, apart from a zero-byte lock entry.
- Every storage read/mutation and every snapshot first revalidates ownership and expected identity. `Snapshot` exposes state metadata only; this checkpoint has no sendable bytes.
- Bounded inventory observes all recognized object/state/commit generations. Generation allocation is one greater than the highest observed name, including definitely uncommitted abandoned files. It never wraps.
- The highest observed commit filename is authoritative. Absent commit for newer object/state files means abandoned and counted. An unreadable, malformed, corrupt, wrong-generation, or incompletely referenced highest commit blocks recovery; no lower commit fallback is permitted.
- Recovery validates the commit, its state file, immutable registration digest/frame, capture frame, every queued event, and any pending/ACK reference already encoded by predecessor-compatible state. Full state identity must equal expected identity. The commit and state must also agree exactly on `parent_generation` and parent commit digest; a checksum-valid disagreement is corrupt authority.
- A current checkpoint root is self-contained. Its parent generation/digest is retained metadata, not a read dependency. Compaction nevertheless preserves the current complete root, immediate previous complete root, all their references and witnesses, and every abandoned/quarantined entry.
- After fresh inventory and before every mutation, reload and byte-compare the current committed root, identity, references, and typed payloads. Each candidate transition is then validated and framed before storage. Publication order is new objects, state, commit. The commit is created and read back last. Current memory changes only after reloading the newly committed root.
- Storage outcomes are handled by operation. Read/inventory/acquire retain their explicit three-way/owner mappings. After `CreateExact`, only CREATED, EXISTS_SAME, and CONFLICT are definite; after `DeleteExact`, only DELETED, ABSENT, and CONFLICT are definite. Every other result—including a valid constant that is nonsensical for that operation—forces reload-required because the mutation was attempted. The memory adapter can inject such nonconforming results to prove this boundary.
- The memory store never uses physical array capacity as published state. `m_record_count`, `m_arena_count`, and `m_delete_log_count` are advanced only after all required allocation, copy, metadata assignment, or log assignment succeeds; every search/iteration/index check uses those logical counts. Deterministic record-allocation, record-copy, and delete-log-allocation faults prove that partial physical growth cannot expose a phantom record or log entry and that fresh recovery still follows committed bytes.
- APPEND uses scalar candidate metadata plus one flat byte arena and cumulative `event_ends`; it rejects ragged arrays, more than 32 candidates, inconsistent ends, duplicate/conflicting IDs/revisions, noncontiguous sequence allocation, and queue/budget overflow. Zero candidates may atomically advance capture.
- APPEND accepts an exact freshly verified tail-aligned already-committed prefix followed by a new suffix. It clears `sequences` on entry/failure, returns one sequence per candidate on success, reuses prefix sequences, and allocates contiguous suffix sequences. A committed prefix followed by new data must end at the current queue tail; an interior prefix that skips a committed event is refused. A repeated event ID with different bytes/metadata, or the same `(deal_id, revision)` under any different event ID, is a conflict. A wholly committed replay succeeds only when the schema-aware typed capture transition proves the supplied capture is the already committed one.
- Compaction has positive retirement authority only for the immediate grandparent reached by exact `current -> previous -> target` generation/digest links. It never scans lower commit names and never retires a disconnected valid root. If the current commit is CHECKPOINT and that target's cleanup is incomplete, the next call resumes the same target instead of publishing another checkpoint.
- The resumable retired-root loader verifies target commit/state hashes, identity, registration digest, and exact parent-field agreement while allowing a missing object only when that exact reference was already classified as eligible for retirement. It refuses missing ineligible, unknown, corrupt, unacknowledged, or unproven evidence. Eligible classes are unprotected superseded CAPTURE, EVENT only through `current.accepted_event`, PENDING only with an exact retained ACK digest/request association, and safely superseded ACK only through `current.accepted_request`.
- A locator match never proves that a retired reference is protected. Every matching object reference in current or previous must equal the retired `Tov2LocalRef` in every encoded field, then its frame/hash/payload is re-read and typed-validated using the retired state's association fields. A protected CAPTURE additionally requires identical retired and retained `capture_schema` values. The event-alias fixture keeps current and previous individually valid and mutates only the retired reference metadata, so recovery succeeds and `Compact` specifically reaches this comparison before returning recovery-required with zero deletes. Any event metadata, capture schema, PENDING/ACK association, frame, or typed-payload mismatch leaves retired objects/state/commit untouched.
- After a fresh inventory, compaction freshly reloads both retained roots immediately before deletion. It deletes eligible objects in deterministic ordinal order and reserves two of the 32 deletion slots for state then commit. More than 30 live eligible objects therefore takes multiple calls while target metadata remains; an after-effect error reloads and resumes because only authorized missing eligible references are tolerated. If state deletion took effect before its error, the exact linked target commit digest authorizes only the final commit deletion on retry. If any unprotected ineligible reference remains, target state and commit remain. Every attempted delete is individually inventory-digest-authorized.
- `Compact` inspects the already committed transition and resumes linked cleanup before testing whether another generation can be allocated. Therefore an interrupted CHECKPOINT at `TOV2_LOCAL_MAX_COUNTER` can finish cleanup; only the branch that must publish a new CHECKPOINT returns `TOV2_STATE_LIMIT`.
- `PublishDiagnostic` validates inputs, refreshes inventory, and freshly verifies the current root before checking the generation ceiling. A valid diagnostic at `TOV2_LOCAL_MAX_COUNTER` returns `TOV2_STATE_LIMIT`, never INVALID, creates nothing, and does not set reload-required.
- Synthetic EVENT, PENDING, and ACK fixtures are canonical delimited payloads, not prefixes. EVENT binds identity, event ID, deal ID, revision, and body while `record_sha` must equal the full payload digest. PENDING binds exact identity, request, prior/final event, count, produced counter, and body digest. ACK binds exact identity, request, accepted event, accepted timestamp, pending-frame digest, and body digest. The strict validator parses counters/digests and compares every field to state metadata; each independently bound field has a negative fixture.

## Fault-injection matrix

Every restart row constructs a new `CTov2TelemetryState` against the same memory store after `Crash()`; old runtime fields are never reused.

| Boundary/fault | Before persistent effect | After persistent effect | Required fresh recovery |
| --- | --- | --- | --- |
| ownership acquire/revalidate | no access | session invalid | explicit busy/lost/error; no state exposure |
| inventory | no observation | same bytes, error returned | recovery-required; never infer empty |
| registration create | boundary 1 BEFORE leaves no bytes | exact immutable registration exists | pristine BEFORE case is `TOV2_STATE_NOT_STARTED`; any partial evidence is recovery-required; no automatic init |
| each event/capture create | prior root remains | object persists abandoned | prior commit recovers; object counts and forces later generation skip |
| state create | prior root remains | state persists abandoned | prior commit recovers; no candidate state adoption |
| commit create | absent | complete commit persists despite error | absent recovers prior root; present authoritative commit recovers candidate |
| read-back of object/state/commit | bytes unchanged | bytes unchanged | I/O blocks operation; later clean recover follows disk authority |
| typed validator rejects registration/capture/event/pending/ACK | no storage attempt | no storage attempt | current verified root remains unchanged; recovery blocks the typed-corrupt root |
| corrupt/missing highest commit | n/a | damage persists | recovery-required, no fallback |
| missing/wrong live reference | n/a | damage persists | recovery-required, no exposure/delete |
| each exact deletion | file retained | file deleted despite error | current checkpoint remains recoverable; reload required and physical budget recounts |
| record/log allocation or record copy | logical count unchanged | partial capacity is unreachable | no phantom inventory/log entry; prior commit recovers |
| unexpected Create/Delete outcome | no trusted effect | effect deliberately unspecified | reload required; clean recovery/inventory decides authority |
| caller deletes dynamic dependency | `CheckPointer` reports invalid | no dependency dereference | operation safely refuses; `Close` performs no invalid call |

The native fixture pins actual read ordinals rather than assuming them. In the diagnostic-root deletion fixture, CHECKPOINT compaction reads 1–4 to verify current, 5–8 to reload it, 9 for current commit metadata, 10–11 to read back new state/commit, 12–15 to recover the checkpoint, 16–23 to load both retained roots, 24–26 for retired commit/state/registration, and 27 to validate the protected capture frame/hash/payload in retired context. Reads 28–31 revalidate the current retained root and 32–35 revalidate the previous retained root immediately before deletion. Fault occurrences 28 and 32 prove each retained-root first-access boundary. APPEND's boundary loops likewise document their exact counts. Any implementation change that alters a sequence must update the fixture comment and injected ordinal together.

The self-test additionally covers normal restart, identity mismatch, checksum-valid parent mismatch, abandoned generation allocation, exact append replay/conflict, tail-aligned mixed replay and interior-prefix refusal, capture schema migration/refusal, capture/event atomicity, 64+8 MiB and 4,096+128 file admission, 512 queue, 32 candidates/deletions, 262,144 payload/262,345 frame bounds, multi-call resumable compaction, after-effect retry, disconnected-root preservation, unacknowledged-event and unproven-pending preservation, checkpoint retention, parent-metadata independence, and unsupported PREPARE/ACK/REPLACE.

## Task 1 — Freeze the TypeScript seam first

**File:** Create `apps/execution-edge/test/mt5-telemetry-state-v2-source.test.ts` from appendix section E; create no MQL target yet.

- [ ] From the backend root, inspect branch, HEAD, status, index, target absence, and pinned hashes:

~~~sh
git branch --show-current
git rev-parse HEAD
git status --short
git diff --cached --stat
node --input-type=module -e 'import {existsSync} from "node:fs"; const p=["mt5/TradeOpsAgent/Include/TradeOpsTelemetryStorage.mqh","mt5/TradeOpsAgent/Include/TradeOpsTelemetryState.mqh","mt5/TradeOpsAgent/Scripts/Support/TradeOpsTelemetryMemoryStore.mqh","mt5/TradeOpsAgent/Scripts/TradeOpsTelemetryStateSelfTest.mq5","apps/execution-edge/test/mt5-telemetry-state-v2-source.test.ts"]; const f=p.filter(existsSync); if(f.length) throw new Error("existing target: "+f.join(",")); console.log("5 runtime targets absent");'
shasum -a 256 mt5/TradeOpsAgent/Include/TradeOpsTelemetryValues.mqh mt5/TradeOpsAgent/Include/TradeOpsTelemetryRecord.mqh mt5/TradeOpsAgent/Include/TradeOpsTelemetryStorageCodec.mqh mt5/TradeOpsAgent/Scripts/TradeOpsTelemetryStorageCodecSelfTest.mq5 apps/execution-edge/test/mt5-telemetry-storage-codec-v2-source.test.ts mt5/TradeOpsAgent/TradeOpsAgent.mq5
~~~

Expected: the recorded branch/HEAD, preexisting dirty files preserved, no new staged changes, `5 runtime targets absent`, and the six exact hashes above.

- [ ] Create section E with `apply_patch`; it is a complete 8-test source seam and the only file created in this task.
- [ ] Run the focused red test:

~~~sh
npm --prefix apps/execution-edge test -- test/mt5-telemetry-state-v2-source.test.ts
~~~

Expected: FAIL naming missing `Include/TradeOpsTelemetryStorage.mqh`, `Include/TradeOpsTelemetryState.mqh`, `Scripts/Support/TradeOpsTelemetryMemoryStore.mqh`, and `Scripts/TradeOpsTelemetryStateSelfTest.mq5`. A dependency, permission, or Vitest startup error is not the intended red signal.

## Task 2 — Add the native fault specification before implementations

**File:** Create `mt5/TradeOpsAgent/Scripts/TradeOpsTelemetryStateSelfTest.mq5` from appendix section D. The includes intentionally remain missing.

- [ ] Create section D with `apply_patch`. It contains an explicit strict synthetic payload validator with canonical parsed EVENT/PENDING/ACK fields and one negative fixture per association, protected-alias event-metadata and capture-schema corruption chains, concrete fixture builders, invalidated-dynamic-dependency guards, fresh-instance recovery helpers, publication/read-back boundary loops with audited operation ordinals, tail-aligned mixed-retry/interior-prefix and typed-corruption cases, deterministic compaction-order logs, logical-count allocation/copy fault cases, unexpected mutation outcomes, a 32-object resumable retirement chain including max-generation continuation, disconnected/unacknowledged/unproven preservation fixtures, budgets, and stable pass/failure markers.
- [ ] Rerun the focused seam.

Expected: FAIL because the three implementation includes are still absent; the seam must already find every required native test label and must continue to reject the incomplete target set.

## Task 3 — Freeze the locator storage contract and pure helpers

**File:** Create `mt5/TradeOpsAgent/Include/TradeOpsTelemetryStorage.mqh` from appendix section A.

- [ ] Create section A with `apply_patch`. Do not add native `File*` calls or a real-file subclass.
- [ ] Rerun the focused seam.

Expected: FAIL naming the missing state and memory-store modules. Storage-specific signature, locator/path, outcome, budget, owner-lock-zero-byte, and forbidden-API assertions pass.

## Task 4 — Implement the deterministic memory adapter

**File:** Create `mt5/TradeOpsAgent/Scripts/Support/TradeOpsTelemetryMemoryStore.mqh` from appendix section B.

- [ ] Create section B with `apply_patch`. Its byte storage is one flat arena plus parallel locator/offset/length/deleted arrays; no copyable struct contains a dynamic byte array. Logical record/arena/delete-log counts, not `ArraySize`, define visible entries, and internal allocation/copy faults cannot advance a logical count.
- [ ] Rerun the focused seam.

Expected: FAIL only for missing `Include/TradeOpsTelemetryState.mqh`. Memory-store ownership, crash-preservation, fault vocabulary, before/after-effect points, and absence of `File*` pass static checks.

## Task 5 — Implement the pure state engine

**File:** Create `mt5/TradeOpsAgent/Include/TradeOpsTelemetryState.mqh` from appendix section C.

- [ ] Create section C with `apply_patch`; do not alter the reviewed codec to make the runtime compile.
- [ ] Run the focused seam:

~~~sh
npm --prefix apps/execution-edge test -- test/mt5-telemetry-state-v2-source.test.ts
~~~

Expected: 8 tests PASS. This establishes only source presence/contracts and static boundaries, not MQL execution.

- [ ] Inspect all five new files and confirm `TradeOpsAgent.mq5`, predecessor sources, package manifests, lockfiles, and receiver code have no runtime-checkpoint edits.

## Task 6 — Local regression and preservation gate

Run from the backend root without staging:

- [ ] Focused predecessor/runtime seams:

~~~sh
npm --prefix apps/execution-edge test -- test/mt5-telemetry-values-v2-source.test.ts test/mt5-telemetry-record-v2-source.test.ts test/mt5-telemetry-storage-codec-v2-source.test.ts test/mt5-telemetry-state-v2-source.test.ts
~~~

Expected: all four files PASS.

- [ ] Full execution-edge suite:

~~~sh
npm --prefix apps/execution-edge test
~~~

Expected: every test passes. Report actual file/test counts; do not assume the earlier 545/31 or codec-checkpoint total if concurrent work changed them.

- [ ] Typecheck, lint, MT5 safety boundary, and whitespace:

~~~sh
npm --prefix apps/execution-edge run typecheck
npm --prefix apps/execution-edge run lint
node scripts/verify-mt5-dry-run-boundary.mjs
git diff --check
~~~

Expected: each exits 0. A sandbox startup failure is infrastructure, not permission to weaken a test.

- [ ] Re-run all six predecessor hashes, `git status --short`, `git diff --cached --stat`, and `git ls-files -co --exclude-standard | sort -u | wc -l`. Expected: predecessor hashes unchanged; exactly five additions attributable to this checkpoint; existing index and unrelated dirt preserved.

## Task 7 — Specification and code-quality review gates

- [ ] Specification review maps every acceptance row below to a concrete function and native label. Reject missing fresh-instance recovery, silent lower-commit fallback, path-taking public APIs, automatic initialization, or reserve use by APPEND.
- [ ] After specification issues are resolved, perform a separate code-quality/MQL review: pointer ownership, constructor purity, dynamic-array signatures, aliasing, array allocation checks, flat-arena offsets, output clearing, loop bounds, digest domains, and no undefined project-prefixed helper.
- [ ] Run the focused seam and regressions after any review edit. Recompute the five new-file hashes and preserve them for the native handoff.
- [ ] Stop without staging, committing, pushing, deploying, installing, or touching active runtime state.

## Task 8 — Native verification gate, separately authorized

This plan performs no Windows action. When the combined source handoff is separately approved:

- [ ] Build a source-only bundle containing the four new MQL files and unchanged codec/record/value dependencies, plus a SHA-256 manifest. Exclude config, credentials, EX5 binaries, journal directories, account identifiers, and the active EA.
- [ ] Review whether the abstract-interface dynamic-array signatures compile in the target MetaEditor build. If MetaEditor rejects them, record the exact compiler diagnostics and return to review; do not add a boolean/path bypass.
- [ ] Compile `TradeOpsTelemetryStateSelfTest.mq5` with 0 errors/0 warnings. It is pure: do not enable Algo Trading, DLLs, WebRequest, account history, or broker connectivity.
- [ ] Run and collect `TOV2_STATE_PASS checks=<actual-count> failures=0`, exact compiler build/log identity, source hashes, and EX5 identity. Keep user-reported and independently inspected evidence distinct.
- [ ] A native pass validates only the deterministic memory checkpoint. It does not validate Windows `FILE_COMMON`, sharing locks, flush/close behavior, fresh-process file reopen, or the active EA.

## Acceptance mapping

| Approved requirement in this checkpoint | Implementation owner | Required evidence |
| --- | --- | --- |
| Typed locators; adapter-only relative-path evidence; no caller paths | Storage include | TS signature/path assertions; `locator.canonical`, `locator.reject` |
| Three-way inventory/read and explicit acquire/create/delete outcomes | Storage + memory store | TS outcome assertions; `inventory.three_way`, `create.outcomes`, `delete.outcomes` |
| Caller-owned adapter; inert constructor; Open/Recover/InitializeNew separation | State | TS constructor scan; `open.acquire_only`, `recover.no_initialize`, `initialize.explicit` |
| Full identity recheck for reads/mutations/snapshot | State | `identity.recover_mismatch`, `identity.snapshot_recheck`, `ownership.before_each_access` |
| Highest commit authoritative; corrupt/missing blocks; abandoned newer counted | State + memory | `recovery.highest_corrupt`, `recovery.highest_missing`, `generation.abandoned_skip` |
| Commit-last; uncertain result requires reload | State + fault harness | before/after loops for object/state/commit; `publication.reload_required` |
| Self-contained current root; parent metadata not a recovery dependency | State | `recovery.parent_not_dependency` |
| INIT/APPEND/DIAGNOSTIC/internal CHECKPOINT only | State | `transition.supported`, `transition.outbox_reserved` |
| Zero-event APPEND; max 32; flat event arena/ends | State | `append.zero_event`, `append.batch_32`, `append.batch_33`, `append.flat_arena` |
| Exact append replay and conflict; atomic capture/events | State + self-test | `append.replay_exact`, `append.conflict`, `append.atomic_capture` |
| Per-candidate sequence results and tail-aligned mixed replay | State + self-test | `append.mixed_sequences`, `append.tail_aligned_prefix`, `append.interior_prefix_rejected`; output empty on every refusal |
| 64 MiB/4096 normal and +8 MiB/+128 reserve; owner.lock only zero-byte excluded | Helpers + state | `budget.normal`, `budget.reserve`, `budget.owner_zero_only` |
| Queue 512, payload 262144, frame 262345 | Codec reuse + state | `queue.512`, `queue.513`, `payload.262144`, `frame.262345` |
| Preserve current/previous roots and witnesses/evidence; delete <=32 | State compaction | `compact.retention`, `compact.delete_32`, `compact.abandoned`, delete fault loop |
| Crash invalidates sessions but preserves bytes | Memory store | `memory.crash_preserves`, `memory.crash_invalidates` |
| No ACK/boolean validation bypass or sendable exposure | Public surface + TS | forbidden API assertions across all five sources |
| Typed payload validation for registration/capture/advance/event/pending/ACK | State + synthetic validator | `typed.valid_paths`, `typed.reject_root_unchanged`, `typed.recovery_registration`, `typed.recovery_capture`, `typed.recovery_event`, `typed.recovery_pending`, `typed.recovery_ack` |
| Mixed committed prefix/new suffix and cross-ID deal/revision conflict | State + self-test | `append.mixed_retry`, `append.mixed_sequences`, `append.deal_revision_conflict` |
| Fresh current-root verification before mutation | State | `mutation.current_root_rechecked`, `mutation.current_corrupt_blocks` |
| Deterministic compaction ordering and interruption | State + memory operation log | `compact.object_before_state`, `compact.state_before_commit`, `compact.class_interruptions` |
| Positive ancestor authority; no disconnected/lower-root scan | State + self-test | exact two-link target selection; `compact.disconnected_valid_preserved` |
| Resumable <=32 deletion with two metadata slots | State + memory store | `compact.multicall_object_prefix`, `compact.multicall_complete`, `compact.after_effect_retry_resumes`, `compact.state_after_effect_retry`, `compact.metadata_last_after_objects` |
| Preserve unacknowledged/unproven retirement evidence | State + self-test | `compact.unack_event_preserved`, `compact.unproven_pending_preserved` |
| Protected-reference alias safety | State + self-test | full `Tov2LocalRefText` equality, retired-context typed validation, exact capture schema; `compact.protected_event_metadata_mismatch_blocks`, `compact.protected_capture_schema_mismatch_blocks` |
| Exact commit/state parent-field equality | Recovery loader | checksum-valid mismatch fixture; `recovery.parent_metadata_mismatch` |
| Schema-aware capture advancement | Validator + state | `capture.schema_migration_valid`, `capture.previous_schema_reject`, `capture.candidate_schema_reject` |
| Memory acquire cleanup and one-installation binding | Memory store | `memory.acquire_after_reusable`, `memory.installation_isolation` |
| Parallel-array transactional visibility under allocation/copy failure | Memory + self-test | `memory.no_phantom_record.*`, `memory.allocation_failure_recovery.*`, `memory.no_phantom_delete_log`, `memory.delete_log_failure_recovery` |
| Non-owning dependency lifetime and invalid pointer guards | State + self-test | `StorageValid`/`ValidatorValid`/`DependenciesValid` with `CheckPointer`; `pointer.validator_invalid_before_open`, `pointer.storage_invalid_guarded`, `pointer.invalid_close_no_dereference`, `pointer.validator_invalid_close_releases_storage` |
| Operation-specific mutation outcomes | State + memory outcome injection | `outcome.create_conflict_definite`, `outcome.delete_conflict_definite`; `outcome.create_unexpected_reload`, `outcome.create_unexpected_recovery`, `outcome.delete_unexpected_reload` |
| Existing CHECKPOINT cleanup at max generation | State + self-test | `compact.max_existing_checkpoint_cleanup`, followed by `compact.max_new_checkpoint_refused` only when a new checkpoint is required |
| Valid diagnostic at max generation | State + self-test | post-refresh ceiling check; `diagnostic.max_valid_limit_no_mutation`, `diagnostic.max_limit_preserved_cleanup` |
| Pristine versus partial INIT create fault | State + self-test | boundary-1 BEFORE recovers NOT_STARTED; all partial evidence recovers RECOVERY_REQUIRED; boundary-4 AFTER commit recovers OK |
| Canonical exact EVENT/PENDING/ACK field binding | Synthetic validator + fixtures | EVENT `typed.event_association_valid` plus independent wrong identity/event-ID/deal-ID/revision/body-with-stale-digest/full-digest labels; PENDING/ACK valid associations plus wrong request/prior/final/count/produced/body/identity and wrong request/event/accepted-at/pending-digest/body/identity labels |
| Missing registration and typed-corruption recovery | State + validator | `recovery.registration_missing` plus typed recovery labels |
| Existing codec and active EA unchanged | Hash gate | six pinned hashes plus active-source include check |

## Explicit later requirements, not implemented here

| Later checkpoint | Still-required behavior |
| --- | --- |
| Native storage | Concrete `FILE_COMMON` adapter, exclusive held `owner.lock`, exact binary counts, allocation/error/flush/close/reopen handling, bounded real inventory, Windows two-terminal and fresh-process tests |
| Outbox | PREPARE selection, exact frozen request persistence/exposure, pending retry, strict ACK association and commit, ACK witness/idempotence, stale-envelope REPLACE |
| Capture 3C | Live account/history reads, concrete capture-state schema/cursor/revision reconciliation, event business logic, boundary advancement |
| Transport 3D | Canonical wire request/response adapters, WebRequest, receiver association, command-null and DRY_RUN validation |
| Rollout | Active-EA wiring, source/EX5 provenance, test-installation observation, clone prohibition, deployment and rollback decisions |

No native `File*` API, real-file storage class, recursive deletion, automatic repair/reset/delete-all, network, broker, database, paid service, or installed-EA action is hidden in this checkpoint. Unknown/corrupt evidence remains preserved and budgeted. Full-folder rollback, malicious local modification, hardware durability, and cross-machine clones remain unsupported conditions.

## Plan self-review

- Spec coverage: every in-scope design requirement maps to the acceptance table, source appendix, and a stable self-test label; outbox/native-file/capture/transport/rollout obligations remain explicit rather than implied complete.
- Placeholder scan: the plan and appendix use no implementation placeholders. Later work is specified in the explicit later-requirements table, not represented by empty methods.
- Type/signature consistency: storage outcome constants, locator fields, state signatures, memory fault names, and test calls match across all five appendix blocks.
- Dependency integrity: every project-prefixed call is defined in one proposed source or the unchanged codec/record/value chain. Standard MQL built-ins are not redefined.
- Safety: no code path accepts arbitrary paths, calls native files/network/account/trading APIs, initializes during recovery, falls back below damaged highest commit, or exposes sendable bytes.
- Evidence honesty: TypeScript checks are static; MQL syntax/runtime and native file behavior remain unverified until their separate gates.

## Execution handoff

Choose either subagent-driven execution with fresh specification/quality reviewers or inline execution with the same red→green and review gates. Both choices create only the five new backend files and stop before staging, committing, native execution, or active-EA wiring.
