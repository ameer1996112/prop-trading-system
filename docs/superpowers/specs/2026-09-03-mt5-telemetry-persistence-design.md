# MT5 telemetry persistence and restart recovery — Stage 3B2 design

Date: 2026-09-03.

Status: approved by the user's “ok continue” on 2026-09-03 following the written-design handoff. This is not an executable code plan or an implementation claim. The user previously approved moving to restart recovery after reporting `TOV2_RECORD_PASS checks=475 failures=0`. No additional Windows action is requested now.

## Outcome and boundaries

Keep the original tracking boundary, queued journal events and exact pending request across chart reattachment and terminal/process restart. Advance local acceptance only after a validated server acknowledgement has itself been committed locally. Never lose an unacknowledged event to compaction or create a new tracking session to conceal damaged state.

This extends the [approved read-only telemetry design](2026-09-03-mt5-account-telemetry-journal-design.md) and [EA delivery sequence](../plans/2026-09-03-mt5-telemetry-ea-delivery.md). Stage 3B2 implements local ownership, typed state, persistence, outbox transitions and failure tests together. Account/history capture belongs to 3C; canonical v2 request/response handling and networking belong to 3D. The outbox has no HTTP or broker methods. It remains unwired from `TradeOpsAgent.mq5` until those later stages pass.

Backend owner: `/Users/ameeramer/.config/superpowers/worktrees/prop-trading-system/mt5-stale-payload-recovery`, HEAD `8a801423bc19b3bb27c8e24f45d2800a9deb6881`. Documentation owner: `/Users/ameeramer/.config/superpowers/worktrees/prop-trading-system/tradeops-dashboard-migration`, HEAD `18e29ce68d9e9fc89311163e95dd2b71f040c527`. Preserve both dirty worktrees. No commit, push, merge, deployment, migration, secret/binding change, account action, active-EA installation or database migration is authorized by this design.

## Predecessor evidence

The controller previously ran 545 execution-edge tests in 31 files, typecheck, lint and the unchanged MT5 safety verifier successfully. Independent specification and quality reviews passed after the record decoder fixes. The user subsequently reported GUI compilation with zero errors/warnings and native `TOV2_RECORD_PASS checks=475 failures=0`. These are user-reported native results, not an uploaded record-test compiler/runtime log or independently matched EX5. Preserve that distinction; do not request repetition of the completed test simply to start this design work.

The record helper validates byte framing, not a durable transaction, account identity or a valid v2 request. Its verified source stays unchanged. See [records evidence](../../audits/2026-09-03-mt5-telemetry-ea-records.md).

## Approaches considered

1. **Recommended: immutable generation files, explicit checked commit records and one held file lock.** Each published state identifies every record needed for recovery; a pending upload cannot become sendable before its commit. Does not rely on rename being crash-atomic. Costs extra metadata and conservative stops on uncertain corruption.
2. One mutable JSON/state file or two alternating files chosen by the largest valid number. Simpler, but a corrupt newer state can be mistaken for permission to fall back and forget a possibly sent request. Rejected without a more substantial commit protocol.
3. DLL-backed embedded database or another service. Adds dependencies, deployment/security work and potential costs. Rejected for this free, native-MT5 checkpoint.

The selected approach provides protocol-level all-or-nothing publication, not a promise that every operating-system or hardware failure preserves all recent disk writes. Read-back verifies bytes currently visible to the terminal; it is not power-loss proof. A full disk rollback, deleted complete generation or malicious modification cannot always be detected using local checksums alone. Such incidents require explicit reconciliation, not a claimed automatic repair.

## 1. Ownership and paths

Use a new fixed namespace under `FILE_COMMON`:

```text
TradeOpsTelemetry/v2/<installation-key>/
  owner.lock
  registration.rec
  objects/<generation>-<ordinal>.rec
  states/<generation>.rec
  commits/<generation>.rec
```

`installation-key` is lowercase SHA-256 of the ASCII bytes of the validated installation identifier prefixed with `TOV2-INSTALL|`. Do not place the identifier, account login, account fingerprint or user-provided path fragments in filenames. A changed account must not redirect the same installation into a fresh directory and bypass mismatch detection. All remaining names are generated internally from canonical positive integer generations/ordinals; reject separators, traversal, unexpected file types and noncanonical names during recovery. No arbitrary filesystem path is accepted by the outbox API.

Hold `owner.lock` open using binary read/write common-file access, with neither share flag, for the entire session. Never write account data into it, delete it, steal it based on time, or reopen it during each operation. A second instance that cannot acquire the handle stops before reading, creating, compacting or uploading private state. Revalidate the session token and expected account/installation binding before each mutation and every read that can expose a sendable pending request. Closing the session invalidates its token and closes its handles.

An exclusive shared-directory lock only covers terminals on the same Windows user/common-data area. It does not prevent cloning the installation identity onto another machine or Windows user. The later rollout must forbid those clones; no distributed lock or new service is introduced here. Native two-terminal tests must confirm that the test installations actually share the same common path. [MetaQuotes file sharing rules](https://www.mql5.com/en/book/common/files/files_open_close).

Common-file storage is not encrypted or isolated from other programs running as that Windows user. It stores private telemetry locally, never authentication secrets or full-login configuration. The lock coordinates cooperative instances; it is not a security boundary against malicious local software.

Recovery never creates a registration. `InitializeNew` is a separate explicit enrollment operation, permitted only for an explicitly approved new tracking identity and an inspected empty namespace apart from `owner.lock`. It is not called automatically after missing files, denied access, a zero-length record, failed enumeration, account switch or HTTP error. Failed first initialization stays not-started/recovery-required; no reset or deletion helper is exposed.

## 2. Filesystem adapter and publication protocol

Separate the state machine from native file calls. The adapter exposes bounded inventory, read, create-new-and-verify, held ownership, and deletion of individually authorized retired files. Each read/inventory has distinct success, definite absence, and I/O-error results. A false existence probe is not proof of an empty namespace: a directory can also make `FileIsExist` return false. [FileIsExist](https://www.mql5.com/en/docs/files/fileisexist).

The production adapter uses binary byte arrays and exact counts, checks file size before allocating, checks every allocation/read/write/copy result, and closes all short-lived handles on every path. It refuses to truncate or overwrite existing generation files. Under the exclusive application lock, it checks that a generated destination is absent before opening; an existing file is either fully verified as the exact expected immutable bytes or treated as conflict. This is not protection against external filesystem writers.

To publish a transition from committed state G to candidate state N:

1. Validate the candidate transition entirely in memory against G; verify identity, counters, references, byte sizes and storage budget. Allocate N above every generation observed in the bounded inventory, including abandoned files. Counter exhaustion blocks; never wrap or reuse an abandoned name.
2. Write each new referenced object to its unique path. Check the returned byte count; flush, close, reopen and compare exact bytes, frame checksum and typed metadata. The current state and any existing pending bytes remain unchanged.
3. Write and read-back-verify `states/N.rec`, a complete typed state manifest referencing the retained registration, live objects and new objects.
4. Write and read-back-verify `commits/N.rec` last. It binds the state-file digest, generation, previous committed generation/digest, immutable registration digest, and the transition type. A checksum-valid data file alone is not a commit.
5. Revalidate the committed manifest and all its live references. Only then publish N in memory and return success or expose its pending request to the later transport owner. On any uncertain result, stop the operation and recover from disk before another mutation; do not carry on with speculative memory state.

`FileFlush` and `FileClose` return no boolean success result. Capture reported error codes without inventing return values, and require reopen/read-back verification; injected adapter failures cover these boundaries even when the real API cannot prove hardware persistence. [FileFlush](https://www.mql5.com/en/docs/files/fileflush), [FileClose](https://www.mql5.com/en/docs/files/fileclose).

No `FileMove`/`FILE_REWRITE` overwrite is the commit authority. Its documentation describes movement/overwrite behavior, not a crash-atomic commit guarantee. [FileMove](https://www.mql5.com/en/docs/files/filemove).

### Recovery rules

- Acquire ownership first and enumerate the fixed namespace within limits; any incomplete/failed inventory is an error, not an empty journal.
- Inspect all commit filenames, not only checksum-valid ones. The highest observed commit generation is authoritative only after its record, manifest, registration, and every live reference validate. A damaged/unreadable highest commit or missing referenced file blocks recovery; never select a lower valid commit to hide it.
- If newer object/state files exist but there is definitely no corresponding commit file, they were never eligible for publication or sending. Preserve them as abandoned evidence and recover the last fully verified commit. They consume budget and generation numbers. Do not adopt their event sequence, capture cursor or pending upload. A capture interruption marks reconciliation required before a future up-to-date claim.
- A partial commit file is different from an absent commit file: partial means recovery-required. Do not infer that a malformed publication was safe to ignore. If the highest commit is intact but the process stopped before its success return, recover and use that committed state; the caller must handle idempotent replay.
- If there is no verified initial registration/commit, return not-started or recovery-required as appropriate; never silently initialize. If the complete namespace has been externally deleted or rolled back, local checks alone cannot prove earlier server history is absent.
- A complete checkpoint is a self-contained recovery root. Its prior-generation digest preserves lineage metadata, but retired predecessor payloads are not required to load it. Compaction must explicitly preserve the live roots below; do not attempt to recover an older root whose objects were intentionally retired.

These decisions are safety behavior, not guaranteed availability: ambiguous damage pauses reporting and preserves the files for diagnosis.

## 3. Typed persistent state

All data, state and commit files reuse the tested `TOV2R1` record envelope; the empty held `owner.lock` is not a data record. The persistence codec adds a bounded typed payload schema and verifies that its type/generation agree with the envelope and generated filename. Immutable `registration.rec` is always generation 1 and has that fixed special name. `CHECKPOINT` envelopes distinguish state manifests and commit markers using different exact payload schema tags. No new outer kind is needed.

The implementation plan must freeze the complete local payload grammar and independent golden vectors before writing its decoder. Do not serialize raw MQL struct memory, platform pointers, doubles or a mutable runtime object. Decimal counters are canonical integers; digests are lowercase hexadecimal. No caller-provided path or unknown payload field can become a filesystem capability.

State responsibilities:

| Record | Persisted meaning |
| --- | --- |
| Registration | Immutable identity tuple, profile/fingerprint/boundary hashes, original boundary including excluded boundary-second IDs, baseline exposure and schema/capture-version identity. Persist all together before tracking starts. |
| Event | Assigned event sequence, event ID, record digest, optional deal/revision key, and exact validated event bytes. References preserve order; identical IDs with conflicting content block. |
| Pending | Payload is exactly the full wire-request bytes. Associated metadata lives in the state manifest: request sequence, wire body digest, full-file digest, prior ACK, selected event identities/digests and exact expected final event ACK. |
| ACK | Payload is the exact validated bounded response bytes. The manifest retains request/body/identity association, accepted timestamp and event ACK. A numeric watermark alone is insufficient. |
| State manifest | Generation, immutable registration reference, produced event counter, accepted request/event counters, ordered unsent references, optional pending reference, most recent ACK reference, durable capture-state reference and named completeness/error state. |
| Commit marker | Exact manifest association, registration association, previous committed generation/digest and permitted transition type. It is written last. |

Do not add an inner metadata prefix to a pending payload: a maximum-size 262,144-byte wire request already fills the record payload allowance. The manifest binds its metadata to the immutable pending file digest, and the wire adapter verifies that metadata against the raw request. Event/registration payloads likewise remain exact validated bytes with their local reference metadata outside those bytes; state and commit payloads use the dedicated local schema.

The capture-state reference is opaque to disk framing, but versioned and validated through the capture adapter before it can advance reconciliation. Stage 3C owns the concrete cursor/revision-index semantics. Unsupported capture-state versions block rather than reset. Stage 3B2 synthetic tests use a defined test adapter; they do not certify live broker capture or JSON wire validation.

There are three different digest domains: record-envelope checksum, SHA-256 of full persisted file bytes, and v2 wire body digest which excludes `body_sha256`. Never substitute one for another. Add a separate bounded full-file hash routine if needed: `Tov2RecordHash` is bounded for the envelope preimage, not every possible complete frame. Keep the verified record helper unchanged.

## 4. Outbox transitions and invariants

Only one state transition runs at a time under the held ownership session. Public failures do not return sendable bytes or a partially advanced state.

### Append journal events

Assign the next contiguous event sequences inside the same publication that retains those event bytes and advances the capture cursor. A failed append must not advance the producer counter or cursor. The producer can retry the same event ID/content after a crash; if it already committed, return its existing sequence. A conflicting ID or deal revision digest is an error, not an overwrite. Later capture reconciliation owns retention of acknowledged deal/revision identities so the next history scan cannot manufacture a new event for an old observation.

Events after a frozen pending request may be appended, but they cannot alter that request, its selected events, counters, diagnostics or snapshots. Produce/acknowledge counters remain monotonic and within the verified safe-integer bound.

### Prepare and retry an upload

When there is no pending request, select only a contiguous prefix beginning at accepted-event + 1. Stop at 32 events, the exact encoded wire-byte limit, or the first repeated deal ID; do not skip the conflicting revision to fill the batch. Zero-event heartbeat requests are allowed and expect the existing event ACK.

The future wire adapter builds and validates a candidate from that selection and the committed registration/identity. Store the exact bytes and binding metadata through the commit protocol before returning any sendable payload. The request sequence is last accepted request + 1; last-acknowledged event is the committed ACK. Refuse a mismatched event list, body digest, registration, request sequence or excessive size.

If a pending request already exists, return only those persisted exact bytes. Do not rebuild it on restart, timeout, reconnect, new account readings or newer events. No second request can overtake it. This is safe exact retry, not a promise of one HTTP attempt; the existing receiver deduplicates accepted exact requests.

Replacing a definitively rejected, never-accepted stale envelope is a separate transition available only to the later strict response/transport adapter. It preserves request sequence, registration and selected event identities/bytes, validates a new canonical envelope, and commits it before exposing it. A timeout, generic HTTP status, missing response, invalid response or uncertain delivery cannot authorize replacement.

### Accept acknowledgement

The later response adapter must validate the entire existing v2 response contract against the persisted request: version, identity/profile/safety epoch, tracking boundary, request sequence/body digest, response digest, expected derived coverage, exact final ACK, `DRY_RUN` and null command. Stage 3B2 must not expose an `Ack(number)` or caller-set `validated=true` bypass; use a typed validation result associated with the exact pending-byte digest through the adapter interface. Production adapter construction remains absent until 3D; synthetic tests use explicit fake validation.

Publish an ACK object and next state together. Only a successful local commit advances accepted counters, removes the pending reference and makes acknowledged event objects eligible for retirement. Never clear pending immediately on HTTP 200. If remote acceptance happened but no local ACK commit exists, recovery retains the old exact pending request for retry. If the ACK commit is damaged or ambiguous, stop instead of guessing.

Retain the most recent correlated ACK as an idempotence witness. Repeating that identical response after a success-return interruption is a no-op; a different/stale/unrelated response cannot modify state.

## 5. Compaction, limits and quarantine

Proposed fixed limits for the first demo implementation:

- Individual frame/payload: unchanged 3B1 bounds (262,345 / 262,144 bytes). Wire request: 262,144 bytes; response: 16,384 bytes; event batch: 32.
- At most 512 unacknowledged event references. Manifest encoded payload must still fit 262,144 bytes; whichever bound is reached first stops admission.
- 64 MiB normal managed-file budget plus 8 MiB reserved for bounded ACK/recovery/diagnostic publication; 4,096 normal files plus 128 reserved files. Check physical retained/orphan bytes, not only current manifest size. Unknown/unreadable file size blocks mutation.
- Preflight the entire next transaction, including duplicate generations needed during safe publication. Do not assume compaction will succeed to justify a write. Only ACK/compaction/diagnostic transitions may use the reserve; ordinary capture and heartbeat preparation cannot consume it.
- These are local application safety ceilings, not a prediction of how many days of offline trading fit. Test realistic burst sizes and idle churn before rollout; no paid storage is added.

Compaction runs as a separate bounded maintenance operation after a verified checkpoint. Preserve the current recovery root, the immediately previous intact recovery root with all its references, registration, current/previous pending and ACK witnesses, capture-state roots, all unacknowledged events and quarantined/abandoned evidence. Only delete an individually listed file if it is unreachable from both retained roots and is positively classified as acknowledged event data, accepted pending data, or superseded committed metadata. A newer pending root must remain recoverable during every deletion boundary. Do not use recursive wildcard deletion or delete registration/owner.lock.

Work in bounded batches of at most 32 retired files per maintenance call. Recheck ownership and roots before each batch. A deletion failure leaves additional storage occupied and prevents a false budget/completeness claim; it never advances an ACK. Interruption halfway through compaction must reload the current root with every required byte present.

Unknown or corrupt files are preserved in place as quarantined evidence; they are not auto-deleted or moved out of the namespace to escape accounting. Unsupported data or lack of capacity sets a visible local gap/error and stops the relevant capture watermark. If even diagnostics cannot be persisted, retain an in-memory redacted error and stop; never report that the gap was durably saved. No raw payload, full login or credential is written to general terminal logs.

A storage-limit or corruption stop may require a separately reviewed recovery/export decision. Do not automatically drop the oldest events, clear the folder, initialize a new boundary, migrate databases or buy capacity to continue.

## 6. Module ownership and dependency order

Planned backend additions under `mt5/TradeOpsAgent`:

| File | Single responsibility |
| --- | --- |
| `Include/TradeOpsTelemetryStorageCodec.mqh` | Typed local state/commit payload schemas, canonical encoding, full-file digest and reference validation. |
| `Include/TradeOpsTelemetryStorage.mqh` | Native bounded common-file adapter, held ownership session and exact binary operations. |
| `Include/TradeOpsTelemetryState.mqh` | Generation publication, recovery roots, immutable initialization, identity checks, storage budget and conservative compaction. |
| `Include/TradeOpsTelemetryOutbox.mqh` | Contiguous events, frozen pending upload, correlated ACK transitions and idempotence. No networking. |
| `Scripts/Support/TradeOpsTelemetryMemoryStore.mqh` | Deterministic fake adapter with partial/failed operations and restart snapshots. Test-only. |
| `Scripts/TradeOpsTelemetryStateSelfTest.mq5` | Native state/outbox fault-injection tests using the fake store and fake wire/capture adapters. |
| `Scripts/TradeOpsTelemetryStorageSelfTest.mq5` | Native real-file binary/lock/reopen tests confined to a unique synthetic common-files namespace. |

Add one focused source/vector seam under `apps/execution-edge/test/mt5-telemetry-state-v2-source.test.ts`; reuse current receiver validators/golden fixtures to check contract association. Do not modify their production behavior. Exact test counts are determined by the reviewed executable plan, not promised here.

Dependency order: freeze codec/adapter contracts and golden fixtures → pure state and memory fault harness → native file adapter and lock tests → outbox/ACK tests → full regression and independent review → separately approved native Windows file tests. Do not dispatch dependent modules to competing implementers before their shared contracts are fixed. No source/implementation task has begun in this design turn.

## 7. Acceptance matrix

Every injected interruption restarts with a new state-machine instance against only the simulated persisted bytes; retaining old in-memory state is not a recovery test.

| Scenario | Required result |
| --- | --- |
| Normal restart/reattach | Same identity, boundary, counters, queue, pending bytes and capture-state reference. |
| Second instance, same common root | Lock acquisition fails; no state access/mutation/sendable output. First owner continues. |
| First owner exits; second starts | New handle can acquire after actual release; files remain unchanged. No lock deletion. |
| Same installation, different account/profile | Explicit mismatch; no new directory/session or relabelled data. |
| Empty/missing registration during recovery | No automatic initialization; preserve evidence and block. |
| Failed initialization at each write/read-back boundary | No tracking success or sendable request; retry cannot invent a new boundary. |
| Object/state write fails before any commit file exists | Prior verified root remains current; uncommitted files preserved and counted; producer/cursor do not advance. |
| Commit file truncated, corrupted or unreadable | Recovery-required, not fallback to an older green-looking root. |
| Commit intact, one live object missing/wrong kind/hash/generation | Recovery-required; nothing sent/deleted. |
| Commit succeeded, caller missed return | Recover that commit; identical append or ACK retry is idempotent. |
| Pending committed, restart before/after lost response | Exact same bytes, body digest, event range and request sequence are returned. |
| New events arrive while pending exists | Queue grows contiguously; old pending bytes remain identical. |
| Remote accepts, no local ACK commit file exists | Old pending remains retryable; no acknowledged event deletion. A partial/invalid ACK commit file instead triggers the corruption rule. |
| Wrong response, partial ACK, wrong digest/identity, non-null command | No accepted-counter movement or pending removal. |
| ACK committed; crash before/during cleanup | Accepted state reloads correctly; leftover retired files are harmless and counted. |
| Duplicate event ID, same bytes vs different bytes | Same bytes reuse committed sequence; conflict blocks. |
| Two revisions of a deal in one candidate batch | Select prefix before repeated deal; do not reorder or skip it. |
| Zero-event request with nonzero previous ACK | Expected ACK equals persisted previous ACK, not zero. |
| Payload/manifest/queue/file/disk bounds, allocation/copy failure | Stop before publication; preserve old root and all unacknowledged bytes. |
| Safe-integer exhaustion, malicious path/filename, unknown schema | Named refusal; no overflow, arbitrary path access or best-effort parsing. |
| False absence caused by file type/access/inventory failure | Error, not permission to initialize or overwrite. |
| Stale-envelope replacement interrupted | Original or fully committed replacement is current, or an ambiguous commit blocks recovery; never mixed metadata/bytes. |
| Clone on another machine/user or external full-folder rollback | Explicit unsupported operating condition; no claim local lock/checksum detects it. |

Also run actual Windows tests for exclusive locking, binary NUL/invalid-UTF8 preservation, exact read/write counts, flush/close/reopen and fresh-process reopen. Use the existing separate test installation; no broker login/trade is required. Unlike the completed pure record test, these tests will create files, so name the exact unique synthetic namespace and obtain approval before execution. Leave fixtures for inspection; cleanup, if later requested, must name only those generated test files.

TypeScript/static/vector success is not native MQL execution. Native test markers are separate from source hashes, compiler build/logs and EX5 identity. Do not mark full 3B or the EA upgrade ready until failure cases and actual file/lock behavior have evidence.

## Self-review and next gate

The proposed design preserves the approved no-reset, read-only, free/local and one-owner constraints. It distinguishes uncommitted abandoned files from damaged commit evidence; frozen pending requests from new capture data; full-file hashes from wire digests; verified local publication from hardware power-loss guarantees; and retired acknowledged data from unacknowledged/quarantined evidence.

The written-design approval includes this deliberate behavior: ambiguous or corrupt commit evidence pauses reporting and preserves files rather than attempting automatic repair. The 64+8 MiB / 512-event / bounded-file limits likewise pause rather than discard data. These are conservative defaults for the demo, not a promise of indefinite offline operation.

Planning update: the first executable [local-format checkpoint](../plans/2026-09-03-mt5-telemetry-ea-persistence.md) now contains the complete pure metadata-codec and test source with exact payload schemas and independent vectors. The complete 3B2 runtime plan (adapter interfaces, file ownership, publication/recovery, outbox, compaction and native fault cases) remains open; the approved acceptance requirements above are not reduced by this checkpoint. This design contains no production implementation and authorizes no rollout. No existing source, v1 configuration/state, Worker schema, safety verifier, frontend or installed EA was changed while writing it.
