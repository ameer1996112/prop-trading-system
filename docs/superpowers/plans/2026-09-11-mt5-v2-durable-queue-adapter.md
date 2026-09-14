# MT5 v2 Durable-Queue Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce an offline production v2 outbox adapter with exact pending replay and durable, restart-verifiable acknowledgments.

**Architecture:** Bind committed capture data before entering State callbacks. Keep storage reads and acknowledgment-witness retention in State; keep JSON assembly and validation pure. Preserve existing synthetic tests and the running EA.

**Tech Stack:** MQL5, existing State/storage/capture/wire contracts, Node >=22.0.0 <27, TypeScript/Vitest, source-only ZIP packaging.

**Spec:** `/Users/ameeramer/.config/superpowers/worktrees/prop-trading-system/tradeops-dashboard-migration/docs/superpowers/specs/2026-09-11-mt5-v2-durable-queue-adapter-design.md` (approved by user on 2026-09-11).

## Global Constraints

- This checkpoint is offline. It does not make the trading system operational.
- Preserve existing dirty changes. No staging, commits, merge, deployment, credentials, migration, private uploads, active-terminal installation, broker calls, HTTP, timers, or order submission.
- The no-commit boundary overrides generic skill commit instructions.
- Keep the 262144-byte request and 16384-byte response limits.
- Existing persisted pending bytes take priority even if a fresh binding is absent or invalid.
- `ValidateReplacement` returns false in this checkpoint.
- No automatic store reset, dropping events, fallback to v1, or order execution.
- Native compile/run remains a separate user action and its evidence is recorded separately.
- No fixed expected assertion count is promised before the test suite exists.

## Workspaces and evidence

All code paths below are relative to backend `/Users/ameeramer/.config/superpowers/worktrees/prop-trading-system/mt5-stale-payload-recovery`. Do not implement in the older `dev/projects` checkout. Documentation paths are relative to `/Users/ameeramer/.config/superpowers/worktrees/prop-trading-system/tradeops-dashboard-migration`.

Read the spec, this plan, and any applicable AGENTS.md before execution. Read existing `TradeOpsTelemetryState.mqh`, `TradeOpsTelemetryOutbox.mqh`, `TradeOpsCaptureStateCodec.mqh`, `TradeOpsTelemetryWireV2.mqh`, and `TradeOpsTelemetryResponseV2.mqh` before changing their seams. Existing files are dirty/untracked project work, not disposable scaffolding.

Capture a fresh SHA256 baseline of existing source files before editing and task snapshots/diffs instead of commits. Record changes and command results under a new `.superpowers/sdd/2026-09-11-mt5-v2-durable-queue-adapter/` ledger if using SDD. Do not reuse the completed wire checkpoint ledger. Review each task's diff against its starting snapshot.

User log `20260911.log` records two native wire PASS runs, 412 checks each. Prior host result was 644 tests in 37 files. These are baselines, not success evidence for new code. Host source assertions never prove MQL runtime execution.

## File map

Create:
- `mt5/TradeOpsAgent/Include/TradeOpsTelemetryOutboxV2.mqh`: immutable binding, request assembly, adapter methods.
- `mt5/TradeOpsAgent/Include/TradeOpsTelemetryWireStateV2.mqh`: pure pending/ACK-pair State association validator.
- `mt5/TradeOpsAgent/Scripts/Support/TradeOpsTelemetryOutboxV2Rig.mqh`: fake-broker/memory-store test rig, native fixtures and receiver-generated expected replies.
- `mt5/TradeOpsAgent/Scripts/TradeOpsTelemetryOutboxV2SelfTest.mq5`: named offline scenarios and assertions.
- `mt5/TradeOpsAgent/fixtures/telemetry-outbox-v2.json`: literal input/checkpoint/request/response vectors.
- `apps/execution-edge/test/mt5-telemetry-outbox-v2-golden.test.ts`: independent receiver oracle and native fixture parity.
- `scripts/package-mt5-outbox-v2-selftest.mjs`: isolated source archive.
- Documentation `docs/audits/2026-09-11-mt5-v2-durable-queue-adapter.md`: host/package/native evidence separately.
- Update documentation `docs/audits/2026-09-10-mt5-v2-wire-contract.md` with the separately supplied native wire evidence.

Modify narrowly (Include/ and Scripts/ below are under mt5/TradeOpsAgent/):
- `Include/TradeOpsTelemetryState.mqh`: opt-in paired ACK callbacks, witness lookup/verification, current/previous-root retention and eventual cleanup.
- `Include/TradeOpsCaptureStateCodec.mqh`: forward paired capability through capture validator.
- `Include/TradeOpsTelemetryWireV2.mqh`: classified encoding result, preserving existing boolean API and bytes.
- `Include/TradeOpsTelemetryOutboxContract.mqh`: update obsolete implementation-status comment only.
- `Scripts/TradeOpsTelemetryStateSelfTest.mq5`, `apps/execution-edge/test/mt5-telemetry-state-v2-source.test.ts`: witness regression coverage.

Do not modify active `TradeOpsAgent.mq5`, native broker implementation, receiver behavior, wire schema, local-state serialized schema, frontend, or deployment files. An implementation discovery requiring a schema change stops for design review.

## Task 1: State-owned acknowledgment witness recovery

**Files:** State, CaptureStateCodec, StateSelfTest, state source test from the map.

**Interfaces:** Add these non-pure defaults to both `ITov2TelemetryStatePayloadValidator` and `ITov2CaptureWirePayloadValidator`; existing test implementations remain source-compatible:

```cpp
virtual bool RequiresAckWitness() { return false; }
virtual bool AckWithPending(const uchar &response[],const uchar &pending[],
                            const Tov2LocalState &state,const string identity)
{ return false; }
```

`CTov2CapturePayloadValidator` forwards both methods to a valid `m_wire`. Missing dependency must not become permission to accept an ACK. State checks capability within its callback guard. Opt-in validators never fall back to `Ack` when witness validation fails.

State private helper contract:

```cpp
int ReadAckWitness(const Tov2LocalState &state,
                   Tov2StorageLocator &locator,uchar &pending[]);
```

- [ ] Write a witness-required synthetic validator in StateSelfTest that returns false from unpaired Ack and accepts paired bytes only when exact expected bytes match. Add assertions for accepting, closing/reopening, and recovering a committed ACK. This test must initially fail because State never invokes the pair hook.
- [ ] Add negative assertions: delete witness, corrupt witness, point metadata at another request, and attempt callback reentry. For each, require RECOVERY_REQUIRED or INVALID as appropriate, with no new commit or accepted-event advancement. Use existing memory-store `Remove`, `Corrupt`, `Inject`, `Copy`, and `ArmFault` methods; do not use disk or terminal APIs.
- [ ] Implement unique inventory lookup by `ack_pending_sha`. Require an object locator, exact frame SHA, PENDING kind, frame generation matching locator, and a generation older than the ACK object. Bound lookup by existing inventory limits; zero or multiple matches fail closed. Verify bytes by reading the exact locator, never trusting inventory hash alone.
- [ ] Route recovered ACK validation through the helper and paired callback. For prospective ACK publication in AcceptResponse, supply the already-read pending bytes and verify they match `next.ack_pending_sha` through the original frame reference. Do not recursively load State inside the callback.
- [ ] Extend both `AddRootLocators` and `RootProtectedAssociation` to protect ACK witnesses for current AND previous retained roots when the validator opts in. Do not merely change one deletion predicate: all pruning paths must agree.
- [ ] Once neither root retains the corresponding ACK, permit deletion of a verified retired pending reference only when its request sequence is no greater than the current accepted request, its identity belongs to the verified chain, and existing retired-object integrity checks succeed. Preserve legacy non-opt-in rules. This prevents permanent witness leaks after advancing to later ACKs.
- [ ] Add repeated Compact/reopen tests across ACK1, ACK2, ACK3: witness1 survives while either protected root references it, then becomes reclaimable; witness2/3 remain intact as required. Test faults before/after deletion and publication. Ensure an incomplete prune never makes a protected root unrecoverable.

Native assertions use the existing `Check` convention, for example within an initialized State test fixture:

```cpp
Check(state.AcceptResponse(GetPointer(adapter),response)==TOV2_STATE_OK);
Check(storage.Exists(original_pending_locator));
Check(state.Compact()==TOV2_STATE_OK);
Check(storage.Exists(original_pending_locator));
```

- [ ] Run `npm --prefix apps/execution-edge test -- test/mt5-telemetry-state-v2-source.test.ts test/mt5-telemetry-capture-v2-source.test.ts test/mt5-telemetry-outbox-v2-source.test.ts`. Keep native scenarios pending if no MQL compiler is available. Review the State diff and baseline before Task 2. Do not report these source tests as native recovery evidence.

## Task 2: Classified wire encoding and production adapter

**Files:** OutboxV2, WireStateV2, WireV2, OutboxContract, new rig/self-test/golden fixtures and host test.

**Interfaces produced:**

```cpp
const int TOV2_WIRE_ENCODE_OK=0;
const int TOV2_WIRE_ENCODE_SIZE_LIMIT=1;
const int TOV2_WIRE_ENCODE_INVALID=2;
int Tov2WireEncodeRequestResult(const CTov2WireRequest &request,
                                uchar &bytes[],Tov2WireExpected &expected);
// Existing Tov2WireEncodeRequest remains a wrapper returning result==OK.

class CTov2TelemetryOutboxV2 : public ITov2TelemetryOutboxAdapter
{
public:
   bool Bind(const Tov2LocalState &state,const string root,
             const uchar &registration[],const uchar &capture[],
             const Tov2WireDiagnostics &diagnostics,const long sent_at);
   // Implements unchanged Build, ValidateRequest, ValidateResponse,
   // ValidateReplacement signatures in TradeOpsTelemetryOutboxContract.mqh.
};
class CTov2TelemetryWireStateV2 : public ITov2CaptureWirePayloadValidator
{
public:
   virtual bool RequiresAckWitness() { return true; }
   // Implements Pending and AckWithPending; unpaired Ack returns false.
};
```

- [ ] Create a heap-owned `CTov2OutboxV2Rig` using CTov2FakeCaptureBroker, CTov2TelemetryMemoryStore, CTov2JournalCollector, production wire validator and adapter, and CTov2CapturePayloadValidator. Adapt enrollment/restart mechanics from CTov2CaptureRig without including another .mq5 or the native broker. Expose `bool Init()`, `bool Restart()`, `bool Bind()`, `int Request(uchar &bytes[])`, `int Accept(const uchar &bytes[])`, plus `state`, `storage`, and `adapter` test access. Request wraps CTov2TelemetryOutbox.Request; Accept wraps its Accept method. Bind uses ReadCaptureContext and fixed synthetic diagnostics/time, not the terminal clock.
- [ ] Add literal fixtures for empty, one-deal, protection, partial/failed exposure and 32 events. Store canonical expected request/response strings with stable names, plus the committed input/metadata used to obtain them. Embed those same literals in the rig. Do not use the production encoder to manufacture its expected output inside a native assertion.
- [ ] Add receiver-oracle tests using this exact fixture shape and existing parser:

```ts
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { parseTelemetryV2, responseBytesV2 } from '../src/telemetry-wire-v2';
const vectors: Array<{name:string;request:string;response:string;acceptedAt:number;finalEvent:number}> =
  JSON.parse(readFileSync(new URL('../../../mt5/TradeOpsAgent/fixtures/telemetry-outbox-v2.json', import.meta.url),'utf8'));
it.each(vectors)('receiver agrees with $name',async v=>{
  const request=await parseTelemetryV2(new TextEncoder().encode(v.request));
  const response=await responseBytesV2(request,v.finalEvent,v.acceptedAt);
  expect(response).toBe(v.response);
});
```

The existing responseBytesV2 returns a canonical string and takes acknowledged sequence before accepted time. Native tests compare actual adapter output with the same literal request, so host and native evidence meet at exact bytes.

- [ ] Run the new host test and record the red result before adding production adapter behavior. Add native failure-clearing assertions even when native execution is deferred.
- [ ] Refactor only the encoder result classification, preserving canonical construction. Validate semantics first. For a valid request, compute final UTF-8 length including the fixed 64-character digest field before capped byte conversion/hash helpers. Count Unicode surrogate pairs correctly; short-circuit above the cap without allocating unbounded byte buffers. Return SIZE_LIMIT only for proven valid over-limit serialization; allocation/hash/conversion failure returns INVALID. Keep all existing wire golden bytes unchanged and add exact 262144/262145 tests.
- [ ] Implement private immutable binding: clear prior binding first; validate root and State references; reconstruct and hash registration/capture frames using their reference generations (registration is generation 1); decode and call Tov2CaptureContextMatches. Store copies, never pointers to caller-owned mutable inputs. Parse the seven-part identity using existing identity validation before numeric conversion.
- [ ] Assemble account/exposure/collection according to the approved spec. For non-COMPLETE exposure start from cleared arrays and preserve attempt metadata. Derive counters, do not trust caller diagnostics for accepted-request/backlog values. Validate every selected event against both State references and checkpoint queued metadata before encoding.
- [ ] Fill every candidate field, using the protocol digest for body_sha. ValidateRequest rebuilds and compares all candidate fields, prefix and bytes. Wire SIZE_LIMIT maps to OUTBOX_BUILD_SIZE_LIMIT; other failures map INVALID; outputs are cleared.
- [ ] Implement recovered Pending validation using full canonical decode, reconstructed registration-frame digest, identity, frozen pending fields, contiguous sequence/event ID/record SHA and deal/revision prefix comparisons. It must allow newer capture generations while the old pending survives.
- [ ] Implement AckWithPending by full `Tov2WireVerifyResponse` plus State metadata/registration association. ValidateResponse first checks current pending membership, then verifies the response, and fills Tov2OutboxAcceptance using protocol digest and actual pending-frame SHA. Unpaired Ack and ValidateReplacement always return false.
- [ ] Run new golden, existing wire golden, and State/capture/outbox source tests; inspect all hash-domain comparisons and no-I/O boundaries before Task 3.

## Task 3: Native adapter lifecycle and fault matrix

**Files:** rig, OutboxV2SelfTest, golden fixture/test; only focused production fixes exposed by tests.

**Interfaces consumed:** CTov2OutboxV2Rig and production types from Task 2; `ArmFault(operation,occurrence,mode)`, `Crash()`, and `Compact()` already exist.

- [ ] Add a replay test using the real adapter, not the synthetic outbox:

```cpp
void ReplayAfterRestart()
{
   CTov2OutboxV2Rig *rig=new CTov2OutboxV2Rig;
   if(CheckPointer(rig)==POINTER_INVALID) { Check(false);return; }
   uchar first[],again[];
   Check(rig.Init());Check(rig.Bind());
   Check(rig.Request(first)==TOV2_STATE_OK);
   Check(rig.Restart()); // New unbound adapter must still replay pending.
   Check(rig.Request(again)==TOV2_STATE_OK);
   Check(Tov2LocalEqual(first,again));
   delete rig;
}
```

- [ ] Add the same byte-equality assertion after a valid newer collector Poll and changed diagnostics. A stale binding must fail for a NEW request but cannot displace a persisted one. Add wrong generation/root and failed rebind cases with no output/commit.
- [ ] Mutate each candidate field independently; mutate checkpoint queue event ID, digest, sequence and observed time; assert no Prepare commit. Change each response identity component, request digest/sequence, ACK final and coverage, regenerate its response hash independently, and require rejection with unchanged queue.
- [ ] Exercise zero events, 32 events, 33 queued events, two revisions of the same deal, valid size shrink, invalid record, oversized head event, max counters, negative/null/known readings, huge tickets and UTF-8 symbols. Assert selected sequence is always accepted_event+1+i and no skipped head.
- [ ] Accept one literal valid ACK, restart and accept its duplicate; then prepare a newer request and replay the old ACK. Require the newer pending bytes remain unchanged. Run the witness deletion/corruption and current/previous-root retention tests with the production validator, not only Task 1's synthetic test.
- [ ] For PREPARE and ACK enumerate BEFORE/AFTER faults across CreateExact/read verification/commit publication using the store's actual operation names. After every interrupted attempt reconstruct State and recover: either old valid root with original pending or new fully committed root is acceptable; missing events, partial advancement, fabricated success, or modified retry bytes are not. Record observed operation counts before selecting fault occurrences, so every injection actually fires.
- [ ] Use global `checks`, `failures` and `Check(bool)`; print named failed scenarios and finish with `TOV2_OUTBOX_V2_PASS checks=... failures=0` or `TOV2_OUTBOX_V2_FAIL`. No broker/account connection requirement. Clear outputs after failed decode/bind/response and use heap allocations for large fixtures.
- [ ] Run `npm --prefix apps/execution-edge test` and `npm --prefix apps/execution-edge run typecheck`; run `node scripts/verify-mt5-dry-run-boundary.mjs` and `git diff --check`. Review result counts without assuming the old 644 count remains exact. Mark native tests NOT RUN until compiled/executed in MT5.

## Task 4: Reproducible isolated package and handoff

**Files:** new packager, package tests within new golden test, audit document.

**CLI contract:**

```sh
node scripts/package-mt5-outbox-v2-selftest.mjs --output-dir /Users/ameeramer/Downloads
```

Produces `tradeops-telemetry-outbox-v2-selftest-v2.0.0-source.zip`. Root is `MQL5/Scripts/TradeOpsTelemetryOutboxV2SelfTest-v2.0.0/`; entry is `Scripts/TradeOpsTelemetryOutboxV2SelfTest.mq5` inside it. Never overwrite an existing different artifact silently.

- [ ] Write package tests asserting isolated paths, no global Include/Experts destinations, no binaries/credentials, exact include closure, no unresolved includes or symlink escape, and unchanged active EA. A missing packager initially fails these tests.
- [ ] Adapt the wire packager's include traversal/archive implementation to this entry/version. Keep all dependencies inside the isolated folder. Permit only the test logging and in-memory fake-storage behavior; reject native broker, WebRequest, order APIs and real file-writing APIs in the source closure. Do not weaken the existing wire package policy.
- [ ] Include README compile/run steps, source manifest, and SHA256SUMS. Document that it is offline and must not be merged into a global Include directory or installed over the running EA. If the versioned destination exists, stop and choose a fresh version.
- [ ] Build to an approved output directory. Independently test the exact delivered archive:

```sh
unzip -t /Users/ameeramer/Downloads/tradeops-telemetry-outbox-v2-selftest-v2.0.0-source.zip
shasum -a 256 /Users/ameeramer/Downloads/tradeops-telemetry-outbox-v2-selftest-v2.0.0-source.zip
```

Extract into a new `mktemp -d` directory and run `shasum -a 256 -c SHA256SUMS.txt` from the extracted manifest's directory. This independent check is mandatory: the prior packager's local-entry checks alone did not validate the entire ZIP central directory.

- [ ] Re-run full host tests/typecheck/dry-run boundary after the final packaging change. Compare baseline hashes, classify every changed pre-existing file against the allowlist, review State witness retention and encoder compatibility, and record final archive hash and include count.
- [ ] Write audit with host results, native NOT RUN status, known deferred stale-envelope recovery and no-trading scope. Update the wire audit's native evidence using the user log without claiming a source-hash binding. Hand off a clickable Downloads ZIP and short isolated compile/run instructions. No production installation or trade test.

## Self-review coverage and execution choice

Spec mapping: binding/mapping/hash domains and overflow -> Task 2; witness recovery/retention -> Task 1 and production checks in Task 3; immutable retries/ACK atomicity/rejection/faults -> Task 3; packaging/native evidence/boundaries -> Task 4. All tasks inherit the no-network/no-trading/no-commit constraints. No change to serialized State or receiver contracts is planned.

Execute tasks in order. Each ends with tests, snapshot/diff and review rather than a commit. If native execution is unavailable, preserve that limitation explicitly and deliver the source self-test; do not invent passing runtime evidence.

Offer the user reviewed subagent execution or inline execution before implementation. The plan itself does not authorize deployment or live trading.
