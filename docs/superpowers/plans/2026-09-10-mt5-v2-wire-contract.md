# MT5 V2 Wire Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Supply an offline, strict MQL5 implementation of the existing Cloudflare v2 request/response contract before connecting durable State to HTTP.

**Architecture:** Reuse the existing typed account/exposure/registration/deal codecs. Add a bounded v2 envelope codec and correlated acknowledgement verifier, tested against the production TypeScript receiver using shared synthetic vectors. Do not modify the installed EA, existing v1 codec, State, receiver schema or infrastructure in this checkpoint.

**Tech Stack:** MQL5, existing TypeScript receiver, Vitest, canonical UTF-8 JSON and SHA256, Windows MetaEditor for native validation.

**Spec:** `../specs/2026-09-03-mt5-account-telemetry-journal-design.md`, sections 2–4 and 8; parent checkpoint requirements in `2026-09-03-mt5-telemetry-ea-delivery.md`, Stage 3D.

## Global Constraints

- All modes remain `DRY_RUN`, all command responses remain `null`, and execution authority remains disabled.
- 256 KiB encoded sync request; at most 128 current positions and 128 pending orders; at most 32 journal events in one request.
- Responses are bounded at 16 KiB; safe counters are positive or nonnegative integers as required, at most 9007199254740991.
- No order APIs, broker reads, WebRequest, custom file writes, callbacks, timers, credentials, migration, deployment, staging, commit, merge or active-terminal installation in this checkpoint. The no-commit boundary overrides the skill's generic commit steps.
- Preserve the old v1 response verifier and its event-acknowledgement-zero restriction.
- No pre-start history import; the disposable demo report's last-24h window is NOT the production tracking boundary.
- Host tests do not execute MQL5. Report source checks, receiver tests, Windows compilation, native run and operator comparison as distinct evidence.
- Use existing isolated backend `/Users/ameeramer/.config/superpowers/worktrees/prop-trading-system/mt5-stale-payload-recovery`; docs remain in `tradeops-dashboard-migration`. Preserve intentionally dirty files in both.

## Inspected evidence and scope

The September 10 screenshot shows `TOV2_DEMO_SELFTEST_PASS checks=38 failures=0` and `TOV2_DEMO_REPORT_COMPLETE positions=0 orders=0 deals=0 comparison=PENDING`, balance/equity USD50000.00. This demonstrates a successful empty-demo read, not nonempty history/exposure validation or completed manual comparison. The operator separately reports capture PASS1671. Neither licenses orders or deployment.

`TradeOpsTelemetryOutboxContract.mqh` already defines the production adapter interface, but the only capture-specific adapter is `Scripts/Support/TradeOpsTelemetryCaptureOutbox.mqh`: CPEND1/CACK1 are expressly synthetic, not HTTP JSON. Do not send these test formats to the receiver.

The reference contract is executable source:

- `apps/execution-edge/src/telemetry-wire-v2.ts`: exact request/response shapes and semantic checks.
- `apps/execution-edge/src/telemetry-schema-v2.ts`: canonical-input and strict-object policy.
- `apps/execution-edge/src/telemetry-coverage-v2.ts`: independently derived coverage.
- `apps/execution-edge/src/telemetry-sync-v2.ts`: HTTP bounds and errors.
- `apps/execution-edge/test/support/telemetry-fixture-v2.ts`: synthetic request builders, not live identity.
- `mt5/TradeOpsAgent/Include/TradeOpsCaptureCodec.mqh`: existing typed records and UTF-8 primitives.

Do not loosen the receiver to accommodate an MQL mismatch. No Cloudflare API/configuration change is needed for this wire-only work; all sizes above are application bounds, not Cloudflare quota claims.

## Files and interfaces

Create in backend:

1. `mt5/TradeOpsAgent/Include/TradeOpsTelemetryWireTypes.mqh`: v2 envelope-specific bounded types; reuse capture types.
2. `mt5/TradeOpsAgent/Include/TradeOpsTelemetryWireV2.mqh`: full request validation/encoding/decoding and request expectations.
3. `mt5/TradeOpsAgent/Include/TradeOpsTelemetryResponseV2.mqh`: strict response parser, derived coverage, acknowledgement correlation.
4. `mt5/TradeOpsAgent/Scripts/TradeOpsTelemetryWireSelfTest.mq5`: offline native vectors and mutations, start/progress/final logs.
5. `mt5/TradeOpsAgent/fixtures/telemetry-wire-v2.json`: reviewed literal vectors with canonical requests/responses and hashes.
6. `apps/execution-edge/test/mt5-telemetry-wire-v2-golden.test.ts`: execute receiver on literal fixture bytes and semantic mutations.
7. `scripts/package-mt5-wire-selftest.mjs`: deterministic include-closure packaging, safety policy, hashes and CRC verification.

New types and signatures (no missing cross-task names):

```cpp
struct Tov2WireIdentity {
  string account_id,installation_id,tracking_id;
  long safety_epoch;
  string account_profile_sha256,account_fingerprint_sha256,tracking_boundary_sha256;
};
struct Tov2WireCollection {
  long produced_events,scan_through_broker_msc; // 0 encodes nullable watermark
  bool scan_finished,observation_gap;
  string record_gap; // empty encodes null; five named receiver gaps only
};
struct Tov2WireDiagnostics {
  string ea_release,reported_source_sha256,reported_manifest_sha256,source_symbol;
  long terminal_build,observed_at_utc_seconds,last_successful_upload_utc_seconds;
  long last_accepted_request_sequence,local_unsent_events;
  string terminal_connection_state,account_trade_permission,terminal_trade_permission,algo_trading_permission,last_error;
};
struct Tov2WireEvent {
  long sequence,observed_at_utc_seconds;
  string event_id,record_sha256,record_json;
};
class CTov2WireRequest {
public:
  Tov2WireIdentity identity;
  Tov2CaptureRegistration registration;
  long request_sequence,last_acknowledged_event_sequence,sent_at_utc_seconds;
  Tov2CaptureAccount account;
  Tov2CaptureExposure exposure;
  Tov2WireCollection collection;
  Tov2WireDiagnostics diagnostics;
  Tov2WireEvent events[32]; int event_count;
};
struct Tov2WireExpected {
  Tov2WireIdentity identity;
  long request_sequence,final_event;
  string request_body_sha256;
  Tov2WireCollection collection;
};
struct Tov2WireAck {
  long request_sequence,acknowledged_event_sequence,accepted_at_utc_seconds;
  string request_body_sha256,response_body_sha256;
};
void Tov2WireClearRequest(CTov2WireRequest &out);
void Tov2WireClearExpected(Tov2WireExpected &out);
void Tov2WireClearAck(Tov2WireAck &out);
bool Tov2WireEncodeRequest(const CTov2WireRequest &request,uchar &bytes[],Tov2WireExpected &expected);
bool Tov2WireDecodeRequest(const uchar &bytes[],CTov2WireRequest &request,Tov2WireExpected &expected);
bool Tov2WireVerifyResponse(const uchar &pending[],const uchar &response[],Tov2WireAck &ack);
```

Allocate CTov2WireRequest fixtures dynamically in native tests; do not embed multiple large requests in a local stack frame. Validate pointers/allocation before calls. Clearing functions explicitly assign empty strings to publicly inspected identities/digests; do not repeat the NULL-versus-empty reset bug. Decode into private staging, publishing no output on any failure. Reject a request before encoding if any count exceeds its backing array.

### Task 1: Shared receiver vectors and native test harness

**Consumes:** `unsignedFixture`, `signFixture`, `parseTelemetryV2`, `responseBytesV2`, `validateResponseV2` from the inspected modules.
**Produces:** literal `telemetry-wire-v2.json` entries `{name, request_utf8, response_utf8, request_sha256, response_sha256}` and the native test entry point.

- [ ] Build and review literal vectors from existing receiver fixtures: idle complete, one deal, protection, 32 contiguous events, produced backlog beyond uploaded prefix, record gap, observation gap, unfinished scan, Unicode symbol/company, large tickets, currency scales0/2/8. Include incomplete account/exposure statuses without fabricated zeros. These are generated test data, never installation identities.
- [ ] Add a host test that reads those literal bytes and validates both directions. Whole-byte SHA256 below differs deliberately from the protocol's hash excluding the digest field.

```ts
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { it, expect } from 'vitest';
import { parseTelemetryV2, validateResponseV2 } from '../src/telemetry-wire-v2';
import { canonicalStringify, sha256Hex } from '../src/canonical';
const vectors = JSON.parse(readFileSync(new URL('../../../mt5/TradeOpsAgent/fixtures/telemetry-wire-v2.json', import.meta.url), 'utf8'));
it.each(vectors)('accepts fixed wire vector $name', async (v) => {
  const pending = new TextEncoder().encode(v.request_utf8);
  const response = new TextEncoder().encode(v.response_utf8);
  expect(createHash('sha256').update(pending).digest('hex')).toBe(v.request_sha256);
  expect(createHash('sha256').update(response).digest('hex')).toBe(v.response_sha256);
  const parsed = await parseTelemetryV2(pending);
  expect(await validateResponseV2(response, parsed)).toBe(v.response_utf8);
});
```

- [ ] Native harness embeds the same literal vectors and calls the three codec functions. For each: decode, encode byte-equal, verify response and exact expected acknowledgement. Emit `TOV2_WIRE_START`, scenario progress, labeled failed assertions, and `TOV2_WIRE_PASS checks=N failures=0` or FAIL. It has no input/account/network dependency.
- [ ] Observe the initial missing-implementation failure separately from actual native behavior. Windows compile/native execution is mandatory later; do not emulate MQL by reimplementing it in TypeScript and call that a native pass.

### Task 2: Strict request envelope

**Consumes:** typed capture validators/encoders, the new types and fixed vectors.
**Produces:** all Clear functions plus EncodeRequest/DecodeRequest and a verified Tov2WireExpected.

- [ ] Implement exact canonical request keys: `account`, `body_sha256`, `collection`, `diagnostics`, `events`, `exposure`, `identity`, `last_acknowledged_event_sequence`, `registration`, `request_sequence`, `schema_version`, `sent_at_utc_seconds`, in canonical order. Do not add profile/command fields to the request.
- [ ] Hash canonical UTF-8 of the request with only `body_sha256` omitted, then insert that digest. Independently validate registration boundary digest and each canonical event-record digest. Preserve raw signed decimal text and unsigned ticket strings, never doubles.
- [ ] Implement bounded parsing using strict literal key order plus typed readers; reject duplicate/extra/missing keys, BOM, trailing bytes, noncanonical whitespace/escapes/numbers, invalid UTF-8/surrogates, wrong null/value combinations and size/count overflow. Re-encode and compare every decoded request byte-for-byte before exposing expected acknowledgement context.
- [ ] Port the receiver's semantic relationships exactly: identity/boundary agreement; frozen registration timestamps; snapshot/diagnostic/event times between initialization and sent time; currency scales; unique IDs and at most one revision per deal in a batch; record revision/previous-hash agreement; post-boundary deal inclusion; produced/backlog/accepted-request relationships; valid scan watermark/coverage. The later State adapter additionally enforces contiguous prefix membership against committed events; this codec must not invent State proof.
- [ ] Native assertions include failure clearing on truncated request after prior successful decode; two different large requests in sequence; repeat encoding determinism; 33events/129positions/129orders; 262144 versus262145 encoded bytes; huge tickets; unknown enums; wrong body/record/boundary hash; inconsistent counters and pre-start events. Build exact-boundary payloads using valid permitted fields, not appended spaces.
- [ ] Re-run the host vector suite and native compiler/test when available. Receiver or pre-existing source changes are not an allowed shortcut to passing this task.

### Task 3: Response verification and correlated acceptance

**Consumes:** verified DecodeRequest output from exact pending bytes, receiver response/coverage semantics.
**Produces:** `Tov2WireVerifyResponse`, returning cleared acknowledgement on any invalid response.

- [ ] Decode and validate the complete pending request first. Do not accept caller-supplied expected identity/ACK flags in place of durable pending bytes.
- [ ] Parse the response's exact canonical shape; require AgentSyncResponseV2, all seven identity fields equal, matching request sequence/body digest, positive accepted time, exact final ACK (last event sequence or prior acknowledged sequence for an empty batch), mode DRY_RUN and literal command null.
- [ ] Derive expected coverage rather than trusting its fields. Production rule:

```text
pending = produced_events - final_event; reject if negative
state = record_gap != null ? DATA_MISSING
      : (!scan_finished || pending != 0) ? CATCHING_UP : UP_TO_DATE
through = state == UP_TO_DATE ? scan_through_broker_msc : null
reason = record_gap
observation_gap = request.collection.observation_gap
```

V2 requests always have a registered start. Do not label an observation gap as a record gap or force coverage to DATA_MISSING solely from observation_gap; match the receiver.
- [ ] Reconstruct canonical expected response using the parsed accepted time and calculated coverage; hash the response with only response_body_sha256 omitted. Compare exact bytes. Accepted retries may legitimately carry an older original acceptance time, so no local wall-clock freshness filter is added to valid ACKs.
- [ ] Test hostile responses by recomputing their digest after semantic mutations, so tests prove correlation rather than merely detect a stale hash:

```ts
it.each(vectors)('rejects a rehashed command in $name', async (v) => {
  const parsed = await parseTelemetryV2(new TextEncoder().encode(v.request_utf8));
  const value = JSON.parse(v.response_utf8);
  value.command = { kind: 'BUY' };
  delete value.response_body_sha256;
  value.response_body_sha256 = await sha256Hex(canonicalStringify(value));
  await expect(validateResponseV2(new TextEncoder().encode(canonicalStringify(value)), parsed)).rejects.toThrow();
});
```

Use the same mutation for each identity field, request_sequence, request_body_sha256, ACK below/above final, every coverage field, non-DRY_RUN mode; also check extra keys, wrong schema, duplicate keys, truncation and >16384bytes. Native tests apply matching literal/rehashed cases. Clearing after invalid response must leave no accepted sequence/digest.
- [ ] Host full regression `npm test --prefix apps/execution-edge`; `npm run typecheck --prefix apps/execution-edge`; dry-run boundary `node scripts/verify-mt5-dry-run-boundary.mjs`; whitespace `git diff --check`. Scope-check pre-existing sources unchanged.
- [ ] Independent source review, followed by a versioned source-only ZIP from the exact include closure with hashes, CRC and extracted-byte checks. Save in Downloads, not only temporary storage. Hand off compile/run instructions and record native evidence separately. No activation of the installed EA.

## Subsequent dependent checkpoints (not authorized rollout steps)

After this wire checkpoint passes, expand a separate executable plan for the production `ITov2TelemetryOutboxAdapter`: Bind a verified committed capture generation/root outside State callbacks; assemble diagnostics and event observation metadata; validate pending/ACK recovery; preserve exact persisted bytes. CPEND1/CACK1 stay test-only. No generic reentrant State reader inside a validation callback.

Next, plan the single selected v1/v2 lifecycle/HTTP owner: 15-second scheduling, one network attempt per cycle, bounded backoff, fresh identity checks, immutable pending retries, durable ACK-before-success, explicit initialization versus recovery and no silent v1 fallback. Only then prepare a separately approved deployment/install and interrupted-upload experiment. Private dashboard reads are later work.

Important unresolved transport decision: HTTP error `STALE_ENVELOPE` currently contains only error/mode/command, with no identity/sequence/request digest. Exact accepted retries are checked from receipts first, but the EA still needs a rigorously bound definitive-rejection mechanism before ReplaceRejected can renew anything. A generic 400/409, timeout, proxy body or locally inferred age is insufficient proof. Until that separate contract is designed and tested, renewal stays refused, exact pending bytes preserved, and the lifecycle must surface recovery-required rather than claim continuous stale recovery is finished. This does not block an offline success-response codec.

## Self-review / handoff

This is an executable wire-only checkpoint under the approved reporting spec, not a complete transport implementation or permission to upload private data. It intentionally keeps native reads, persistence writes, credentials, HTTP and active-EA changes out. Interfaces above connect its three tasks; subsequent State/HTTP adaptation is named but not started. Acceptance requires actual Windows native evidence before an installable-binary claim.
