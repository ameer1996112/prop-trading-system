# MT5 telemetry native `FILE_COMMON` store — Stage 3B3 design

Date: 2026-09-04.

Status: approved by the user on 2026-09-04 after the native deterministic state runtime reported `TOV2_STATE_PASS checks=146 failures=0`.

## Outcome and scope

Add a concrete Windows/MT5 implementation of the existing `ITov2TelemetryStorage` contract. The adapter persists immutable telemetry-v2 records in `FILE_COMMON`, holds one exclusive writer lock for the complete session, inventories the fixed namespace conservatively, and implements exact binary read/create/delete operations without exposing caller-controlled paths.

This checkpoint remains isolated from `TradeOpsAgent.mq5`. It adds no account/history reads, WebRequest, broker calls, commands, database work, deployment, configuration, secret, or active-EA wiring. The existing state runtime, codec, record, value helpers, memory store, and active EA remain byte-for-byte unchanged.

The checkpoint validates application-level file persistence and cooperative same-Windows-user ownership. It does not claim hardware power-loss durability, protection from malicious local programs, ownership across different Windows users or machines, or production readiness.

## Approaches considered

1. **Selected: additive native adapter in a new include.** Create `Include/TradeOpsTelemetryFileStore.mqh` implementing the existing interface, plus an isolated native self-test and a TypeScript source seam. This preserves the already reviewed pure interface/state sources and their native evidence.
2. Add native APIs directly to `TradeOpsTelemetryStorage.mqh`. Rejected because that file is the verified pure contract and is hash-pinned by the state checkpoint.
3. Reuse the mutable v1 text journal or an external database/service. Rejected because overwrite-based text persistence does not implement immutable generation semantics, and an external service adds latency, cost, credentials, and availability dependencies.

## Namespace and capabilities

Production locators map only beneath:

```text
TradeOpsTelemetry/v2/<installation-key>/
  owner.lock
  registration.rec
  objects/<generation>-<ordinal>.rec
  states/<generation>.rec
  commits/<generation>.rec
```

`installation-key` must be an already validated lowercase nonzero SHA-256 digest produced by `Tov2LocalInstallationKey`. The adapter accepts an installation key, never an arbitrary root or relative path. Every data filename comes from a validated `Tov2StorageLocator`; inventory performs the inverse canonical parse and rejects unknown, noncanonical, traversal-like, duplicate, directory, or over-limit evidence.

The approved synthetic Windows test identity is `native.storage.20260904.01`. Its exact key and retained namespace are:

```text
0a0c1e55bac97da98734ad83c7310d90f1cea4c526c366fe882daf3347873668
TradeOpsTelemetry/v2/0a0c1e55bac97da98734ad83c7310d90f1cea4c526c366fe882daf3347873668/
```

The key is SHA-256 of ASCII `TOV2-INSTALL|native.storage.20260904.01`. The test does not use an account login, fingerprint, credential, active installation identity, or user-selected path. Generated test files remain after execution for inspection; this checkpoint exposes no cleanup-all operation.

## Ownership session

`Acquire` opens `owner.lock` once with `FILE_BIN | FILE_READ | FILE_WRITE | FILE_COMMON` and neither `FILE_SHARE_READ` nor `FILE_SHARE_WRITE`. The handle remains open for the session. File existence is not ownership: after a normal or abnormal process exit, a new process may acquire the existing zero-byte file when Windows releases the old handle.

The adapter returns `TOV2_STORE_BUSY` when another cooperative process owns the lock and performs no inventory/read/create/delete work. A nonzero or unreadable lock is invalid evidence, not a lock to truncate or delete. `Revalidate` accepts only the current opaque session token and a live, zero-byte held handle. `Close` invalidates the token before closing the handle and never deletes `owner.lock`.

The lock covers terminals using the same Windows user's `TERMINAL_COMMONDATA_PATH`. Native two-terminal evidence must record that both terminals report the same common path before interpreting contention results.

`Acquire` creates only the fixed installation container and its three expected `objects`, `states`, and `commits` subdirectories. Bootstrap order is exact: validate the installation key; create or positively confirm `TradeOpsTelemetry/v2/<installation-key>` under `FILE_COMMON`; completely enumerate that parent to classify `owner.lock`; open `owner.lock` exclusively; then create or positively confirm `objects`, `states`, and `commits`. Only after all containers are confirmed may it return a session token. Any folder, probe, or open failure returns `TOV2_STORE_IO_ERROR` unless the exact outcome table below assigns a narrower safe result; after lock acquisition, every failure closes the lock before returning. Partial folder creation never authorizes state initialization. Expected container directories are allowed but never represented as inventory records. Missing expected containers after a session has been acquired, unexpected directories, and a directory occupying a canonical record path block inventory.

The adapter uses the following exact outcome mapping:

| Situation | Result |
| --- | --- |
| Invalid installation key, locator, frame bounds, or delete digest | `TOV2_STORE_INVALID` |
| A pre-probed existing zero-byte lock then fails exclusive open with `ERR_CANNOT_OPEN_FILE` | `TOV2_STORE_BUSY` |
| Lock opens but is nonzero | close it, then `TOV2_STORE_CONFLICT` |
| Lock/path/property access is ambiguous or reports an unexpected native error | `TOV2_STORE_IO_ERROR` |
| Empty, stale, or mismatched session token, or held handle no longer live/zero-byte | `TOV2_STORE_OWNERSHIP_LOST` |
| Generated data path is definitely absent | `TOV2_STORE_ABSENT` for read/delete; eligible for create |
| Existing data file contains exactly the requested valid bytes | `TOV2_STORE_EXISTS_SAME` |
| Existing readable data differs, is zero-length/partial, or a directory occupies its path | `TOV2_STORE_CONFLICT` |
| Existing data cannot be opened, sized, fully read, flushed, closed, reopened, or verified | `TOV2_STORE_IO_ERROR` |
| Delete target digest differs from the exact readable current bytes | `TOV2_STORE_CONFLICT` |
| Inventory finds an unknown/malformed name, unexpected directory, or canonical zero-length file | `TOV2_STORE_CONFLICT` with cleared output |
| Inventory cannot enumerate, inspect a size, allocate/copy/hash, or distinguish exhaustion from error | `TOV2_STORE_IO_ERROR` with cleared output |
| Canonical file is oversized or a max-plus-one entry is discovered | `TOV2_STORE_LIMIT` with cleared output |

Only a complete parent-directory probe may establish definite absence. The adapter enumerates the immediate expected parent with `FileFindFirst(parent+"\\*", ..., FILE_COMMON)`, classifies every returned name as file or directory, and closes a valid search handle on all exits. A valid enumeration that reaches `FileFindNext == false` with freshly captured `_LastError == 0` proves the unseen target absent. For an empty directory where `FileFindFirst` returns `INVALID_HANDLE`, absence is accepted only when `FileGetInteger(parent, FILE_EXISTS, true)` returns present with `ERR_FILE_IS_DIRECTORY`; any other result is `TOV2_STORE_IO_ERROR`. Finding the exact target proves its type and size; malformed duplicate/case-colliding names are conflicts. `FileIsExist == false` alone is never sufficient.

Lock acquisition first runs that root-parent probe for `owner.lock`. If it finds a zero-byte regular file and the immediately following exclusive `FileOpen` fails specifically with `ERR_CANNOT_OPEN_FILE`, the adapter classifies the safe stop as `TOV2_STORE_BUSY`; all other open failures are `TOV2_STORE_IO_ERROR`. This is an operational contention classification, not proof against malicious local software. If exclusive open succeeds, handle-based size is rechecked before returning ownership.

## Exact binary operations

All record data uses `uchar[]` with `FILE_BIN | FILE_COMMON`; no text conversion or raw struct serialization is allowed.

`Read` validates ownership and the typed locator, opens the generated file read-only, checks an exact size of 1 through `TOV2_RECORD_FRAME_MAX` before allocation, checks allocation and the exact `FileReadArray` element count, rejects trailing/short data, closes every handle, and clears output on every refusal. Definite missing-file evidence returns `TOV2_STORE_ABSENT`; ambiguous access/type/property failures return `TOV2_STORE_IO_ERROR`.

`CreateExact` requires a bounded nonempty byte array, computes its full-file digest successfully, validates the `TOV2R1` envelope/checksum, and verifies that the envelope generation agrees with the locator. It does not compare against a caller-supplied digest and does not change the frozen interface. The memory adapter remains a lower-level deterministic state harness; production file admission is intentionally stricter. Existing canonical files are read and compared: exact valid bytes return `TOV2_STORE_EXISTS_SAME`; deterministic readable mismatch, empty data, partial data, or a directory at the destination returns `TOV2_STORE_CONFLICT`; ambiguous access returns `TOV2_STORE_IO_ERROR`. Only after an exact probe proves absence may the destination be opened. Under the held cooperative lock, the file is written with an exact element count, flushed, closed, reopened, and byte-for-byte verified. `FileFlush` and `FileClose` are `void`; the native wrapper resets stale error state immediately before each call and returns the captured `_LastError` separately from the operation. Any uncertain or partial create remains as evidence and returns `TOV2_STORE_IO_ERROR`, forcing state reload.

`DeleteExact` refuses owner and registration locators. It reads and hashes the exact current bytes, deletes only when the caller's expected digest matches, and reports absent/deleted/conflict/I/O outcomes distinctly. It never performs recursive deletion or wildcard cleanup.

Registration refusal is native defense in depth. The frozen memory store can delete registration when called directly, but the state engine never authorizes owner or registration deletion. The new source seam pins both properties: native refusal and absence of any state call that sends either protected locator to `DeleteExact`. The memory store remains unchanged to preserve its reviewed checkpoint hash.

No `FileMove` or `FILE_REWRITE` operation is commit authority. The existing state engine already publishes objects, then state, then the immutable commit file last.

## Bounded inventory and failure behavior

Inventory requires a valid ownership session and enumerates only the fixed root plus `objects`, `states`, and `commits`. It includes the zero-byte `owner.lock` and every bounded nonempty canonical record file. A canonical zero-length file cannot satisfy the frozen `Tov2StorageEntryValid` contract, so inventory returns `TOV2_STORE_CONFLICT` with empty output instead of publishing an invalid sentinel. This still blocks recovery and initialization without hiding the damaged evidence. A bounded nonempty file receives its computed digest even when its record contents are corrupt; the state layer then performs structural validation and blocks the highest damaged commit rather than falling back.

The adapter closes every enumeration handle. Results are sorted deterministically by locator. It rejects duplicates and unexpected names/types/directories. It checks each size before representing it and refuses negative/unreadable sizes. It retains at most `TOV2_STORAGE_INVENTORY_MAX` entries while performing one max-plus-one enumeration probe: 4,225 total entries are allowed only when they are the owner plus 4,224 managed files; discovery of entry 4,226 returns `TOV2_STORE_LIMIT` with an empty output. Normal `FileFindNext` exhaustion is distinguished from an enumeration error using freshly reset and captured native error state.

Any incomplete enumeration, allocation failure, unknown evidence, or ambiguous absence returns an error and clears output. It never initializes a new journal, falls back below damaged highest commit, removes quarantined files, or changes generation counters.

## Test architecture

Create three additive files:

| File | Responsibility |
| --- | --- |
| `Include/TradeOpsTelemetryFileStore.mqh` | Concrete `ITov2TelemetryStorage` implementation using the fixed `FILE_COMMON` namespace. |
| `Scripts/TradeOpsTelemetryFileStoreSelfTest.mq5` | Native real-file modes for local round-trip, lock holder/contender, retained writer fixture, and fresh-process reader verification. |
| `apps/execution-edge/test/mt5-telemetry-file-store-v2-source.test.ts` | Static contract seam for path confinement, exact flags/counts, lifecycle, bounded inventory, forbidden capabilities, active-EA isolation, and predecessor hashes. |

The existing `mt5-telemetry-state-v2-source.test.ts` remains unchanged because native file calls live outside its pure target set.

The new include contains a narrow internal `ITov2TelemetryFileOps` boundary, a production `CTov2TelemetryMqlFileOps` wrapper, and `CTov2TelemetryFileStore`. Only the store exposes `ITov2TelemetryStorage`; the low-level operations interface is not passed into the state engine and cannot accept paths from application callers. The native wrapper performs `ResetLastError` immediately before each relevant MQL call and returns both the API result and captured error. The self-test supplies a deterministic fake file-operations implementation to force allocation/copy, short read/write, flush, close, enumeration, and handle-lifecycle failures. Real-file modes separately verify actual Windows success, persistence, and contention behavior.

The native script has explicit modes rather than hidden environment behavior:

- `LOCAL`: same-process path, ownership, binary NUL/non-UTF8 round trip, exact create/read/reopen, existing-same, conflict preservation, authorized deletion, release/reacquire, and deterministic low-level failure tests.
- `HOLD_LOCK`: acquire the approved synthetic namespace, print the common-path fingerprint and a ready marker, then hold the handle for a bounded operator-selected interval without reading or modifying journal records.
- `PROBE_LOCK`: from a second terminal with the same common path, require `TOV2_STORE_BUSY` and prove no storage method succeeded.
- `PROBE_AFTER_RELEASE`: after terminal A releases ownership, require acquisition, successful revalidation, an unchanged inventory digest, and persistence of the zero-byte lock without deleting it.
- `WRITE_FIXTURE`: create and verify a deterministic immutable fixture, close ownership, and retain it.
- `READ_FIXTURE`: in a fresh terminal process, reacquire and verify the exact retained bytes and inventory without rewriting them.

Modes use disjoint canonical locators. `LOCAL` uses generation `7000001` and may delete only its exact disposable object after digest verification. `WRITE_FIXTURE`/`READ_FIXTURE` use immutable object generation `7000101`; repeat writes must return `EXISTS_SAME`, never overwrite. Lock modes create no record data. Each mode validates its exact allowed starting inventory and treats unrelated canonical evidence as a visible refusal, so interruption or repetition cannot silently contaminate another mode.

The deterministic fake-operations matrix must include stale-error isolation, allocation/copy failure, short read, short write, flush error, close error, open/reopen error, normal enumeration exhaustion, `FileFindNext` error, and every short-lived/enumeration handle-close path. It also covers nonzero and ambiguously unreadable `owner.lock`; empty/stale/mismatched session tokens; missing expected containers after acquisition; an unexpected directory and a directory at a canonical file path; exact proven absence; unknown, malformed, duplicate, and case-colliding names; canonical zero-length and oversized files; readable differing/partial existing files; exactly 4,225 entries; and the max-plus-one 4,226 refusal. These checks validate adapter control flow and the exact outcome table; only the real-file modes validate the MQL runtime's actual file behavior.

Each mode prints one final marker with actual counts and zero failures. Tests do not require Algo Trading, DLLs, WebRequest, broker login, market data, or account history.

## Verification gates

Implementation follows red-green TDD: the new TypeScript source seam must fail because both MQL targets are absent, then pass after each additive target is introduced. Existing focused telemetry source seams, typecheck, lint, the MT5 dry-run boundary verifier, hashes, and dirty-worktree accounting must remain green.

Native handoff is separate evidence:

1. Compile `TradeOpsTelemetryFileStoreSelfTest.mq5` with 0 errors and 0 warnings in the same MetaEditor build used for the state checkpoint.
2. Run `LOCAL` and record its exact PASS marker.
3. Record two terminals' common paths; run `HOLD_LOCK` in terminal A and `PROBE_LOCK` in terminal B; then close A and prove B can acquire without deleting the lock.
4. Run `WRITE_FIXTURE`, close the terminal process, launch a fresh process, and run `READ_FIXTURE`.
5. Preserve compiler build/log, source hashes, EX5 hash, mode markers, and the retained synthetic namespace.

Source/static success is not native behavior evidence. Local native success is not active-EA integration, network delivery, or trading evidence.

## Safety and rollback

The implementation is additive and unwired. Source rollback is removal of the three new checkpoint files only. Native files are confined to the approved exact synthetic namespace. They are left for inspection; deletion requires a later explicit request naming that namespace. No broad `FolderClean`, account action, active EA replacement, deployment, migration, or paid service is part of this checkpoint.

## Self-review

- No placeholder, automatic repair, caller path, mutable overwrite, secret, account identifier, or active-EA wiring is specified.
- The interface outcomes, limits, canonical locator mapping, state publication order, and conservative recovery behavior match the approved Stage 3B2 design.
- The additive file split preserves the already verified pure runtime instead of changing its contract.
- Native limitations and user-reported versus independently inspected evidence remain explicit.
