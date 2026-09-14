# MT5 Telemetry Native `FILE_COMMON` Store Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add and independently verify a concrete, bounded, exclusive-writer `FILE_COMMON` adapter for the existing telemetry-v2 storage contract without wiring it into the active EA.

**Architecture:** Add one native adapter include behind the frozen `ITov2TelemetryStorage` interface, one isolated MQL self-test with deterministic fake-file fault injection and six real-file modes, and one Vitest source-contract seam. The adapter alone constructs canonical paths below one fixed common-files namespace; callers provide only a validated installation key and typed locators. All work is additive, retains uncertain evidence, and preserves the active EA and every predecessor checkpoint byte-for-byte.

**Tech Stack:** MQL5 build 6140-compatible source, MetaTrader 5 `FILE_COMMON`, TypeScript, Vitest, Node.js SHA-256 checks, Git.

---

## Frozen scope and file map

Implementation happens only in the backend worktree:

```text
/Users/ameeramer/.config/superpowers/worktrees/prop-trading-system/mt5-stale-payload-recovery
```

The checkpoint creates exactly three files:

| File | Responsibility |
| --- | --- |
| `apps/execution-edge/test/mt5-telemetry-file-store-v2-source.test.ts` | Static contract, isolation, predecessor-hash, and native-test evidence seam. |
| `mt5/TradeOpsAgent/Include/TradeOpsTelemetryFileStore.mqh` | Production `FILE_COMMON` operations wrapper plus concrete `ITov2TelemetryStorage` adapter. |
| `mt5/TradeOpsAgent/Scripts/TradeOpsTelemetryFileStoreSelfTest.mq5` | Deterministic fake fault matrix and six operator-selected real-file evidence modes. |

Do not modify, stage, or reformat any existing file. In particular, do not modify `TradeOpsAgent.mq5`, `TradeOpsTelemetryStorage.mqh`, `TradeOpsTelemetryState.mqh`, `TradeOpsTelemetryMemoryStore.mqh`, any prior source seam, configuration, database, Cloudflare, or deployment file. Do not run the active EA, call a broker, use WebRequest, or delete the retained native namespace.

Complete source for the three targets is frozen in the companion appendix:

```text
docs/superpowers/plans/2026-09-04-mt5-telemetry-native-file-store-code.md
```

The approved governing design is:

```text
docs/superpowers/specs/2026-09-04-mt5-telemetry-native-file-store-design.md
```

## Closed implementation decisions

- Production root: `TradeOpsTelemetry\v2\<validated-lowercase-sha256>` in `FILE_COMMON`.
- Synthetic identity: `native.storage.20260904.01`.
- Synthetic key: `0a0c1e55bac97da98734ad83c7310d90f1cea4c526c366fe882daf3347873668`.
- `LOCAL` generation: `7000001`; retained fixture generation: `7000101`.
- Missing required `objects`, `states`, or `commits` directory after ownership acquisition is definite structural evidence and returns `TOV2_STORE_CONFLICT` with cleared inventory.
- A zero-length canonical record is `TOV2_STORE_CONFLICT` for inventory/read/delete.
- An oversized canonical record is `TOV2_STORE_LIMIT` for inventory/read/delete.
- `Acquire` reports `BUSY` only after the complete parent probe found an existing zero-byte regular `owner.lock` and the immediately following exclusive open failed with exactly `ERR_CANNOT_OPEN_FILE`.
- Every valid enumeration handle and every short-lived file handle receives exactly one close attempt. A close error overrides an otherwise definite result with `IO_ERROR`.
- `CreateExact` never removes uncertain evidence. `DeleteExact` refuses owner and registration locators.
- `READ_FIXTURE` contains no create or delete call. `HOLD_LOCK` contains no journal read/create/delete call.
- The active EA remains unaware of this checkpoint.

## Exact low-level interface

The appendix must define this interface exactly; later code and fake operations use the same signatures:

```cpp
class ITov2TelemetryFileOps
{
public:
   virtual bool FolderCreateCommon(const string path,int &native_error)=0;
   virtual long FindFirstCommon(const string filter,string &name,int &native_error)=0;
   virtual bool FindNext(const long search_handle,string &name,int &native_error)=0;
   virtual bool FindClose(const long search_handle,int &native_error)=0;
   virtual long PathIntegerCommon(const string path,
                                  const ENUM_FILE_PROPERTY_INTEGER property,
                                  int &native_error)=0;
   virtual int OpenCommon(const string path,const int flags,int &native_error)=0;
   virtual long HandleInteger(const int handle,
                              const ENUM_FILE_PROPERTY_INTEGER property,
                              int &native_error)=0;
   virtual uint ReadBytes(const int handle,uchar &bytes[],const int start,
                          const int count,int &native_error)=0;
   virtual uint WriteBytes(const int handle,const uchar &bytes[],const int start,
                           const int count,int &native_error)=0;
   virtual bool Flush(const int handle,int &native_error)=0;
   virtual bool CloseFile(const int handle,int &native_error)=0;
   virtual bool DeleteFileCommon(const string path,int &native_error)=0;
   virtual int ResizeBytes(uchar &bytes[],const int count,int &native_error)=0;
   virtual int CopyBytes(uchar &destination[],const uchar &source[],
                         const int destination_start,const int source_start,
                         const int count,int &native_error)=0;
   virtual int ResizeEntries(Tov2StorageEntry &entries[],const int count,
                             int &native_error)=0;
   virtual bool HashBytes(const uchar &bytes[],string &sha,int &native_error)=0;
};
```

`CTov2TelemetryMqlFileOps` resets `_LastError` immediately before exactly one underlying primitive and captures `GetLastError()` immediately afterward. Its `FindClose`, `Flush`, and `CloseFile` methods call the native void function and return `native_error==0`. `OpenCommon` adds `FILE_COMMON`; public store code supplies only the remaining flags. `HandleInteger` uses the official `FILE_SIZE`, `FILE_POSITION`, and `FILE_END` properties.

`CTov2TelemetryFileStore` has exactly these public methods:

```cpp
class CTov2TelemetryFileStore : public ITov2TelemetryStorage
{
public:
   CTov2TelemetryFileStore();
   CTov2TelemetryFileStore(ITov2TelemetryFileOps *file_ops);
   ~CTov2TelemetryFileStore();
   int Acquire(const string installation_key,string &session_token);
   int Revalidate(const string session_token);
   int Inventory(const string session_token,Tov2StorageEntry &entries[]);
   int Read(const string session_token,const Tov2StorageLocator &locator,
            uchar &bytes[]);
   int CreateExact(const string session_token,
                   const Tov2StorageLocator &locator,const uchar &bytes[]);
   int DeleteExact(const string session_token,
                   const Tov2StorageLocator &locator,const string expected_sha);
   void Close(const string session_token);
};
```

The injected operations pointer is non-owning. Default construction points it to an embedded production wrapper. Construction performs no I/O.

### Task 1: Record the immutable baseline

**Files:**
- Inspect only: backend worktree and protected predecessors
- Create: `/tmp/tov2-file-store-baseline-status.txt`
- Create: `/tmp/tov2-file-store-baseline-hashes.txt`

- [ ] **Step 1: Confirm the exact branch and commit**

```bash
git branch --show-current
git rev-parse HEAD
```

Expected:

```text
codex/mt5-stale-payload-recovery
8a801423bc19b3bb27c8e24f45d2800a9deb6881
```

- [ ] **Step 2: Capture the dirty baseline without modifying it**

```bash
git status --porcelain=v1 > /tmp/tov2-file-store-baseline-status.txt
wc -l /tmp/tov2-file-store-baseline-status.txt
git diff --cached --name-only
```

Expected: 45 porcelain entries and no staged paths. If the count or staged state differs, stop and report the new baseline; do not discard or absorb user work.

- [ ] **Step 3: Prove all new targets are absent**

```bash
test ! -e apps/execution-edge/test/mt5-telemetry-file-store-v2-source.test.ts
test ! -e mt5/TradeOpsAgent/Include/TradeOpsTelemetryFileStore.mqh
test ! -e mt5/TradeOpsAgent/Scripts/TradeOpsTelemetryFileStoreSelfTest.mq5
```

Expected: exit 0.

- [ ] **Step 4: Capture protected hashes**

```bash
shasum -a 256 \
  mt5/TradeOpsAgent/TradeOpsAgent.mq5 \
  mt5/TradeOpsAgent/Include/TradeOpsTelemetryValues.mqh \
  mt5/TradeOpsAgent/Include/TradeOpsTelemetryRecord.mqh \
  mt5/TradeOpsAgent/Include/TradeOpsTelemetryStorageCodec.mqh \
  mt5/TradeOpsAgent/Include/TradeOpsTelemetryStorage.mqh \
  mt5/TradeOpsAgent/Include/TradeOpsTelemetryState.mqh \
  mt5/TradeOpsAgent/Scripts/Support/TradeOpsTelemetryMemoryStore.mqh \
  mt5/TradeOpsAgent/Scripts/TradeOpsTelemetryValuesSelfTest.mq5 \
  mt5/TradeOpsAgent/Scripts/TradeOpsTelemetryRecordSelfTest.mq5 \
  mt5/TradeOpsAgent/Scripts/TradeOpsTelemetryStorageCodecSelfTest.mq5 \
  mt5/TradeOpsAgent/Scripts/TradeOpsTelemetryStateSelfTest.mq5 \
  apps/execution-edge/test/mt5-telemetry-values-v2-source.test.ts \
  apps/execution-edge/test/mt5-telemetry-record-v2-source.test.ts \
  apps/execution-edge/test/mt5-telemetry-storage-codec-v2-source.test.ts \
  apps/execution-edge/test/mt5-telemetry-state-v2-source.test.ts \
  > /tmp/tov2-file-store-baseline-hashes.txt
```

Expected: exact values pinned in appendix section A.

### Task 2: Add the source-contract seam first

**Files:**
- Create: `apps/execution-edge/test/mt5-telemetry-file-store-v2-source.test.ts`
- Test: `apps/execution-edge/test/mt5-telemetry-file-store-v2-source.test.ts`

- [ ] **Step 1: Add appendix section A with `apply_patch`**

Copy the complete TypeScript block from appendix section A verbatim. Do not create either MQL target yet.

- [ ] **Step 2: Run the focused test and observe the intended red signal**

```bash
npm test --prefix apps/execution-edge -- mt5-telemetry-file-store-v2-source.test.ts
```

Expected: Vitest starts successfully and fails because these exact paths are missing:

```text
Include/TradeOpsTelemetryFileStore.mqh
Scripts/TradeOpsTelemetryFileStoreSelfTest.mq5
```

A dependency, permission, syntax, or Vitest-startup failure is not the intended red result.

- [ ] **Step 3: Confirm only the seam was added**

```bash
git status --short -- apps/execution-edge/test/mt5-telemetry-file-store-v2-source.test.ts mt5/TradeOpsAgent
```

Expected: one new source-seam path plus the pre-existing untracked telemetry state files; no file-store MQL path yet.

### Task 3: Add the concrete native adapter

**Files:**
- Create: `mt5/TradeOpsAgent/Include/TradeOpsTelemetryFileStore.mqh`
- Test: `apps/execution-edge/test/mt5-telemetry-file-store-v2-source.test.ts`

- [ ] **Step 1: Add appendix section B with `apply_patch`**

Copy the complete MQL include from appendix section B verbatim. It must include only `TradeOpsTelemetryStorage.mqh` and contain:

```text
ITov2TelemetryFileOps
CTov2TelemetryMqlFileOps
CTov2TelemetryFileStore
```

- [ ] **Step 2: Run the seam and observe the partial-red signal**

```bash
npm test --prefix apps/execution-edge -- mt5-telemetry-file-store-v2-source.test.ts
```

Expected: the adapter-specific assertions pass and the suite remains red only because `Scripts/TradeOpsTelemetryFileStoreSelfTest.mq5` is absent.

- [ ] **Step 3: Inspect forbidden capabilities directly**

```bash
rg -n 'FileMove|FileCopy|FolderClean|FolderDelete|FILE_REWRITE|FILE_SHARE_READ|FILE_SHARE_WRITE|FILE_TXT|FILE_CSV|WebRequest|OrderSend|CTrade|AccountInfo|History|#import' mt5/TradeOpsAgent/Include/TradeOpsTelemetryFileStore.mqh
```

Expected: no matches.

- [ ] **Step 4: Confirm the active EA remains isolated**

```bash
rg -n 'TradeOpsTelemetryFileStore' mt5/TradeOpsAgent/TradeOpsAgent.mq5
```

Expected: no matches.

### Task 4: Add the deterministic and real-file self-test

**Files:**
- Create: `mt5/TradeOpsAgent/Scripts/TradeOpsTelemetryFileStoreSelfTest.mq5`
- Test: `apps/execution-edge/test/mt5-telemetry-file-store-v2-source.test.ts`

- [ ] **Step 1: Add appendix section C with `apply_patch`**

Copy the complete script from appendix section C verbatim. The script must include only `../Include/TradeOpsTelemetryFileStore.mqh`, use explicit enum input `TestMode`, and expose these modes:

```text
LOCAL
HOLD_LOCK
PROBE_LOCK
PROBE_AFTER_RELEASE
WRITE_FIXTURE
READ_FIXTURE
```

- [ ] **Step 2: Run the source seam to green**

```bash
npm test --prefix apps/execution-edge -- mt5-telemetry-file-store-v2-source.test.ts
```

Expected: all file-store source tests pass.

- [ ] **Step 3: Verify the read-only and lock-only bodies**

```bash
node --input-type=module - <<'NODE'
import { readFileSync } from 'node:fs';
const text = readFileSync('mt5/TradeOpsAgent/Scripts/TradeOpsTelemetryFileStoreSelfTest.mq5', 'utf8');
const body = (name) => text.split(`void ${name}(`)[1].split('\n}')[0];
if (/CreateExact|DeleteExact/.test(body('RunReadFixture'))) throw new Error('READ_FIXTURE mutates');
if (/\bRead\(|CreateExact|DeleteExact/.test(body('RunHoldLock'))) throw new Error('HOLD_LOCK accesses records');
console.log('mode isolation PASS');
NODE
```

Expected: `mode isolation PASS`.

### Task 5: Run static regressions and account for every byte

**Files:**
- Test only: all five telemetry source seams and dry-run boundaries

- [ ] **Step 1: Run focused telemetry seams**

```bash
npm test --prefix apps/execution-edge -- \
  mt5-telemetry-values-v2-source.test.ts \
  mt5-telemetry-record-v2-source.test.ts \
  mt5-telemetry-storage-codec-v2-source.test.ts \
  mt5-telemetry-state-v2-source.test.ts \
  mt5-telemetry-file-store-v2-source.test.ts
```

Expected: all focused tests pass.

- [ ] **Step 2: Run typecheck and lint**

```bash
npm run typecheck --prefix apps/execution-edge
npm run lint --prefix apps/execution-edge
```

Expected: both exit 0.

- [ ] **Step 3: Run both boundary checks**

```bash
npm test --prefix apps/execution-edge -- mt5-dry-run-boundary.test.ts
node scripts/verify-mt5-dry-run-boundary.mjs
```

Expected: both pass without changing files.

- [ ] **Step 4: Attempt the full execution-edge suite**

```bash
npm test --prefix apps/execution-edge
```

Expected: pass. If Miniflare cannot bind the sandbox loopback and reports `listen EPERM 127.0.0.1`, record it as an environment limitation only after the focused tests, typecheck, lint, and boundary gates are green. Do not weaken or skip tests to hide it.

- [ ] **Step 5: Recheck every predecessor hash**

```bash
shasum -a 256 \
  mt5/TradeOpsAgent/TradeOpsAgent.mq5 \
  mt5/TradeOpsAgent/Include/TradeOpsTelemetryValues.mqh \
  mt5/TradeOpsAgent/Include/TradeOpsTelemetryRecord.mqh \
  mt5/TradeOpsAgent/Include/TradeOpsTelemetryStorageCodec.mqh \
  mt5/TradeOpsAgent/Include/TradeOpsTelemetryStorage.mqh \
  mt5/TradeOpsAgent/Include/TradeOpsTelemetryState.mqh \
  mt5/TradeOpsAgent/Scripts/Support/TradeOpsTelemetryMemoryStore.mqh \
  mt5/TradeOpsAgent/Scripts/TradeOpsTelemetryValuesSelfTest.mq5 \
  mt5/TradeOpsAgent/Scripts/TradeOpsTelemetryRecordSelfTest.mq5 \
  mt5/TradeOpsAgent/Scripts/TradeOpsTelemetryStorageCodecSelfTest.mq5 \
  mt5/TradeOpsAgent/Scripts/TradeOpsTelemetryStateSelfTest.mq5 \
  apps/execution-edge/test/mt5-telemetry-values-v2-source.test.ts \
  apps/execution-edge/test/mt5-telemetry-record-v2-source.test.ts \
  apps/execution-edge/test/mt5-telemetry-storage-codec-v2-source.test.ts \
  apps/execution-edge/test/mt5-telemetry-state-v2-source.test.ts \
  > /tmp/tov2-file-store-final-hashes.txt
diff -u /tmp/tov2-file-store-baseline-hashes.txt /tmp/tov2-file-store-final-hashes.txt
```

Expected: no diff.

- [ ] **Step 6: Account for the dirty worktree**

```bash
git status --porcelain=v1 > /tmp/tov2-file-store-final-status.txt
git diff --cached --name-only
wc -l /tmp/tov2-file-store-final-status.txt
comm -13 \
  <(LC_ALL=C sort /tmp/tov2-file-store-baseline-status.txt) \
  <(LC_ALL=C sort /tmp/tov2-file-store-final-status.txt)
```

Expected: no staged paths, 48 porcelain entries, and exactly the three approved new paths. Do not stage or commit this checkpoint unless the user separately authorizes it.

### Task 6: Perform two-stage implementation review

**Files:**
- Review only: the three new targets and approved design

- [ ] **Step 1: Request a fresh spec-compliance review**

Give the reviewer the approved design, this plan, companion appendix, the three new paths, and the captured baseline. Require a requirement-by-requirement PASS/FAIL result, with file and line for every failure.

Expected: `PASS`, including exact outcome mappings, path confinement, handle closure, mode isolation, retained evidence, predecessor hashes, and active-EA isolation.

- [ ] **Step 2: Request a separate code-quality review**

Require checks for unsupported MQL syntax, stale `_LastError`, invalid pointer dereference, integer narrowing, array publication before successful allocation/copy, leaked handles, accidental overwrite/delete, false absence, fake/production semantic drift, and brittle static tests.

Expected: `PASS` with no P1/P2 finding. Fixes restart from the narrowest failing test and repeat Tasks 5 and 6.

### Task 7: Build a separately authorized Windows source handoff

**Files:**
- Package only after Tasks 1–6 pass: the two new MQL files and required predecessor includes
- Do not include: EX5 binaries, secrets, active EA replacement, or cleanup commands

- [ ] **Step 1: Create a source-only manifest and ZIP outside the repository**

The archive contains:

```text
TradeOpsAgent/Include/TradeOpsTelemetryValues.mqh
TradeOpsAgent/Include/TradeOpsTelemetryRecord.mqh
TradeOpsAgent/Include/TradeOpsTelemetryStorageCodec.mqh
TradeOpsAgent/Include/TradeOpsTelemetryStorage.mqh
TradeOpsAgent/Include/TradeOpsTelemetryFileStore.mqh
TradeOpsAgent/Scripts/TradeOpsTelemetryFileStoreSelfTest.mq5
SHA256SUMS.txt
```

Expected: every archive member matches the backend source hash. Creating the archive does not authorize copying into an active terminal.

- [ ] **Step 2: Compile only the self-test on Windows**

Copy the source tree under the intended terminal's `MQL5` directory, compile `TradeOpsTelemetryFileStoreSelfTest.mq5`, and retain the MetaEditor build and compiler log.

Expected: 0 errors and 0 warnings. Static success is not native evidence; compilation is not runtime evidence.

- [ ] **Step 3: Run `LOCAL`**

Expected final marker:

```text
TOV2_FILE_STORE_LOCAL_PASS checks=<actual-positive-count> failures=0 common_sha256=<digest>
```

It must finish with only zero-byte `owner.lock` in the synthetic namespace.

- [ ] **Step 4: Prove two-terminal contention and release**

Run `HOLD_LOCK` in terminal A. Copy its exact common-path and owner-only inventory digests into terminal B's inputs. While A prints `TOV2_FILE_STORE_HOLD_LOCK_READY`, run `PROBE_LOCK` in B. After A releases, run `PROBE_AFTER_RELEASE` in B.

Expected: identical common-path digests, B reports BUSY during the hold, no record method succeeds during contention, B acquires after release, the inventory digest is unchanged, and the zero-byte lock remains.

- [ ] **Step 5: Prove fresh-process persistence**

Run `WRITE_FIXTURE`, capture the inventory digest, close the whole terminal process, start a fresh terminal process, and run `READ_FIXTURE` with the expected digest.

Expected: the retained fixture is read byte-for-byte, its inventory is unchanged, and the reader performs no create/delete action.

- [ ] **Step 6: Preserve evidence and stop**

Retain source hashes, compiler log/build, EX5 hash, both common-path records, every exact mode marker, and the synthetic namespace. Do not delete the namespace, replace/attach the active EA, deploy, stage, commit, push, call a broker, or enable live trading.

## Self-review checklist

- [ ] Every approved design section maps to a task or exact appendix assertion.
- [ ] `rg -n 'TBD|TODO|implement later|similar to|appropriate error handling|write tests for'` finds no placeholder language in either plan document.
- [ ] Interface method names, return types, dynamic-array references, flags, constants, labels, modes, and outcome values match between the main plan and appendix.
- [ ] Only three implementation files are created and every predecessor hash remains pinned.
- [ ] Source/static, native compilation, native runtime, and active-EA integration are reported as four different evidence levels.
- [ ] No step authorizes production integration, deployment, cleanup, or broker action.
