# MT5 Telemetry Stage 2 — Durable Receiver Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Accept bounded, authenticated, command-free v2 account reports and forward-only journal records without acknowledging uncommitted data or duplicating recorded results.

**Architecture:** Keep the existing Worker and account coordinator. Reuse the coordinator's pinned v1 installation/profile/fingerprint/epoch for this existing-account upgrade; serialize v2 requests separately. D1 alone commits v2 registration, receipt, events, current deal pointers, snapshots, diagnostics, and coverage. The old heartbeat path remains compatible.

**Tech Stack:** TypeScript 5.9.3, existing Workers types, Vitest 4.1.10, installed Miniflare 4.20260721.0/workerd 1.20260721.1, SQLite through D1, existing canonical JSON and Stage 1 helpers.

**Execution status — 2026-09-03:** Complete locally and uncommitted. All eight tasks passed implementation/specification/quality gates; the final suite passed **537 tests / 29 files**, including the actual 5,760-upload budget workload. Typecheck, lint, the unchanged safety verifier and final code/spec/safety reviews PASS. The authoritative completed task checklist, execution adaptations and measured evidence are in [the implementation audit](../../audits/2026-09-03-mt5-telemetry-receiver.md). The recipe checkboxes and code snippets below preserve the original approved plan, not the live completion ledger. No deployment or EA installation is authorized; the storage rollout gate remains.

---

## Scope and working directory

This is a local implementation plan, not permission to operate the deployed system. Do not stage, commit, push, merge, deploy, apply remote migrations, change bindings/secrets/Access, edit the running EA/Pine, install an EX5, migrate Supabase, or perform broker operations. Replace commit steps with local diff-review checkpoints.

Backend root (all implementation paths below are relative to this exact root):

`/Users/ameeramer/.config/superpowers/worktrees/prop-trading-system/mt5-stale-payload-recovery`

Verified HEAD: `8a801423bc19b3bb27c8e24f45d2800a9deb6881`. Preserve the eight untracked Stage 1 source/test files. The restored frontend lives in a different dirty worktree and is out of scope. Private financial reads and dashboard integration are Stage 4, not this stage. MQL5 collector/response parsing is Stage 3; only synthetic cross-language fixtures are produced here.

The approved design is `docs/superpowers/specs/2026-09-03-mt5-account-telemetry-journal-design.md` in the documentation worktree. The delivery roadmap remains authoritative for subsequent stages.

**Storage rollout gate:** The disposable planning run measured 11,521 D1 row writes for 5,760 idle uploads but about 27 MB of allocated database growth. Continuous retention at that measured rate would exhaust an otherwise empty 500 MB database in roughly 18 comparable days. Local implementation can proceed; continuous rollout cannot be approved from the write-count result alone. Stage 5 must establish remaining space, intended demo duration and an explicitly reviewed longer-term storage approach. Do not automatically prune receipts/events or upgrade plans. Full measurements and limitations: `docs/audits/2026-09-03-mt5-telemetry-receiver-plan.md`.

### Findings that supersede assumptions in the roadmap

1. There is **no deployed-profile lookup table or identity guard in index.ts**. V1 authenticates a shared bearer and pins installation/profile/fingerprint/epoch in coordinator storage. V2 must read that pin, require an existing registration, and compare it before first D1 registration. Never invent an authenticated profile table or silently enroll a new identity. A brand-new installation is outside this upgrade path.
2. Existing SQL migrations are `0001_agent_sync.sql`, `0002_agent_health_current.sql`, and `0003_agent_health_dashboard_index.sql`. The proposed `0004_account_telemetry_v2.sql` is additive.
3. The coordinator subclass in index.ts currently discards its environment. Pass the existing D1 binding through an optional constructor argument, preserving old unit-test constructors.
4. Do not write v2 health through `agent_health_current_v1`: its sequence-based update rule is not valid across protocols. Store original v2 acceptance time in the v2 session; Stage 4 will normalize by acceptance time.
5. Use the existing fetch-based coordinator interface for compatibility, despite the skill's general preference for RPC. Do not change DO class names/migrations. A bounded promise queue is scheduling only; D1 constraints remain authoritative after restart.

### Verified platform constraints

D1 batch statements commit together or roll back on statement failure. Plain D1 binding reads go to the primary without opting into read replication. Sessions are consistency controls, **not** the paid, 15-minute transaction API described in the local reference; no `session.close()` exists in the inspected API. [D1 database API](https://developers.cloudflare.com/d1/worker-api/d1-database/).

The Free plan allows 50 queries per invocation; each SQL statement has at most 100 bound parameters. Use `json_each(?)` to insert a whole bounded event batch and update current pointers, not one statement per field/event. [D1 limits](https://developers.cloudflare.com/d1/platform/limits/).

Measure `meta.rows_written`, including indexes, and storage growth. The current D1 Free allowance is 100,000 writes/day and 5 million reads/day, shared with other workloads. No budget guarantee follows from a 15-second request interval. [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/).

External database awaits permit interleaving in a DO. Avoid a per-request `blockConcurrencyWhile` around D1: it also has a 30-second reset timeout. Use a separate bounded v2 queue plus a database sequence claim. [Durable Object state](https://developers.cloudflare.com/durable-objects/api/state/).

Broker deals have distinct entry/exit/reversal types, signed costs, stable position IDs, and cancellation revisions. Persist broker facts; EXPERT does not prove this strategy, and a reversal does not reveal a cost allocation. [MQL5 deal properties](https://www.mql5.com/en/docs/constants/tradingconstants/dealproperties).

## File map

| Path under backend root | Responsibility |
| --- | --- |
| `apps/execution-edge/src/telemetry-schema-v2.ts` | Small exact-key schema readers, canonical UTF-8 boundary and bounded HTTP bodies |
| `apps/execution-edge/src/telemetry-wire-v2.ts` | Request/response schemas, domain cross-checks and digest validation |
| `apps/execution-edge/src/telemetry-journal-projection-v2.ts` | Per-deal exact recorded contribution; no guessed lifetime statistics |
| `apps/execution-edge/migrations/0004_account_telemetry_v2.sql` | Four additive tables and integrity triggers |
| `apps/execution-edge/src/telemetry-repository-v2.ts` | Primary reads, one atomic acceptance batch, stored receipt validation |
| `apps/execution-edge/src/telemetry-sync-v2.ts` | Authenticated public adapter and bounded coordinator response validation |
| `apps/execution-edge/src/telemetry-queue-v2.ts` | Bounded per-instance v2 serialization, no persisted queue |
| `apps/execution-edge/src/account-coordinator-v1.ts` | Read-only v1 identity pin check and separate `/sync-v2` branch |
| `apps/execution-edge/src/index.ts` | Explicit v2 route and pass-through of existing environment |
| `apps/execution-edge/test/support/telemetry-fixture-v2.ts` | Synthetic deterministic input/signing helpers |
| `apps/execution-edge/test/support/telemetry-d1-v2.ts` | Disposable local D1 runtime and metrics/fault wrapper |
| `apps/execution-edge/test/telemetry-wire-v2.test.ts` | Strict wire/adversarial/response tests |
| `apps/execution-edge/test/telemetry-repository-v2.test.ts` | Actual D1 rollback, CAS, replay, corrections, exposure preservation |
| `apps/execution-edge/test/telemetry-sync-v2.test.ts` | Authentication, routing, v1 pinning and command boundary |
| `apps/execution-edge/test/telemetry-journal-projection-v2.test.ts` | Signed costs, partial/reversal/baseline/unknown semantics |
| `apps/execution-edge/test/telemetry-budget-v2.test.ts` | Idle-day, 32-event burst, replay storms and query plans |
| `apps/execution-edge/test/telemetry-golden-v2.test.ts` | Cross-language canonical byte regression |
| `apps/execution-edge/package.json` and `package-lock.json` | Declare the already installed exact local D1 test dependency |
| `mt5/TradeOpsAgent/fixtures/agent-sync-v2.json` | Canonical synthetic request/response string vectors and SHA-256 values |

No new runtime dependency is required. Declare the **already installed exact Miniflare version** as a devDependency for its new test imports, updating only this package's lockfile. Do not install latest or change Vitest pools globally. All code blocks labelled `file:` below contain the full new file. Integration blocks contain exact insertions/replacements, not whole-file rewrites.

## Task 1 — strict schema primitives

- [ ] Add the schema test in Task 7 first; run `npm --prefix apps/execution-edge test -- test/telemetry-wire-v2.test.ts`. Expect an unresolved v2 module, not a passing dummy assertion.
- [ ] Add this complete file.

```ts file:apps/execution-edge/src/telemetry-schema-v2.ts
import { canonicalStringify } from "./canonical";
import { parseFixedV2, readCounterV2 } from "./telemetry-values-v2";

export type Reader<T> = (value: unknown) => T;
export function bad(code = "TELEMETRY_INVALID"): never { throw new Error(code); }
export function check(ok: unknown, code?: string): asserts ok { if (!ok) bad(code); }
export const integer = (minimum = 0): Reader<number> => value => readCounterV2(value, minimum);
export const boolean: Reader<boolean> = value => { check(typeof value === "boolean"); return value; };
export function text(max: number, pattern = /^[^\u0000-\u001f\u007f]+$/u): Reader<string> {
  return value => { check(typeof value === "string" && value.length <= max && pattern.test(value)); return value; };
}
export function choice<const T extends readonly (string | number | boolean | null)[]>(...values: T): Reader<T[number]> {
  return value => { check(values.includes(value as T[number])); return value as T[number]; };
}
export const nullable = <T>(read: Reader<T>): Reader<T | null> => value => value === null ? null : read(value);
export function list<T>(read: Reader<T>, max: number): Reader<readonly T[]> {
  return value => {
    check(Array.isArray(value) && value.length <= max && Object.keys(value).length === value.length);
    return Object.freeze(Array.from({ length: value.length }, (_, index) => {
      check(Object.hasOwn(value, index)); return read(value[index]);
    }));
  };
}
export function object<S extends Record<string, Reader<unknown>>>(shape: S): Reader<{ readonly [K in keyof S]: ReturnType<S[K]> }> {
  return value => {
    check(value !== null && typeof value === "object" && !Array.isArray(value));
    check(Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
    const raw = value as Record<string, unknown>;
    check(Object.keys(raw).length === Object.keys(shape).length);
    return Object.freeze(Object.fromEntries(Object.entries(shape).map(([key, read]) => {
      check(Object.hasOwn(raw, key)); return [key, read(raw[key])];
    }))) as { readonly [K in keyof S]: ReturnType<S[K]> };
  };
}
export const fixed = (value: unknown) => {
  const raw = object({ value: text(36), scale: integer() })(value);
  return parseFixedV2(raw.value, raw.scale);
};
export const reading = (value: unknown) => {
  const result = object({ value: nullable(fixed), reason: nullable(choice("READ_FAILED", "NOT_APPLICABLE", "NOT_SET", "UNAVAILABLE")) })(value);
  check((result.value === null) === (result.reason !== null)); return result;
};
export function canonicalInput(bytes: Uint8Array, max = 256 * 1024): unknown {
  check(bytes.byteLength > 0 && bytes.byteLength <= max);
  const raw = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  const value: unknown = JSON.parse(raw);
  function depth(item: unknown, level: number): void {
    check(level <= 16);
    if (item !== null && typeof item === "object") for (const next of Object.values(item)) depth(next, level + 1);
  }
  depth(value, 0);
  // Exact canonical bytes also reject duplicate JSON keys, whitespace, BOM and alternate numeric spellings.
  check(raw === canonicalStringify(value)); return value;
}
export async function boundedBody(request: Request | Response, max = 256 * 1024): Promise<Uint8Array> {
  const length = request.headers.get("content-length");
  if (length !== null && /^[0-9]+$/u.test(length) && Number(length) > max) {
    await request.body?.cancel(); bad("TELEMETRY_TOO_LARGE");
  }
  if (request.body === null) return new Uint8Array();
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      check(value !== undefined && value.byteLength <= max - size, "TELEMETRY_TOO_LARGE");
      size += value.byteLength; chunks.push(value);
    }
  } catch (error) { await reader.cancel().catch(() => undefined); throw error; }
  finally { reader.releaseLock(); }
  const result = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}
```

- [ ] Run the Task 7 schema tests after its dependencies are added. Also run `npm --prefix apps/execution-edge run typecheck`. Keep primitive numeric semantics identical to Stage 1.

## Task 2 — exact versioned wire contract

Wire observations are account-wide; symbols below are bounded printable broker names, not the execution allowlist. A null reading always has a reason. `baseline` is immutable first-capture exposure. Every request repeats registration so changed baseline/currency/start cannot be silently accepted. A snapshot that exceeds transport bounds is sent as an explicit failed attempt, never a truncated COMPLETE snapshot. The initial baseline must be COMPLETE before registration succeeds.

- [ ] Add the strict request/response tests in Task 7 and observe RED.
- [ ] Add the following file in three small edits: schemas through `readEnvelope`, semantic checks through `parseTelemetryV2`, then response helpers. Run typecheck after each edit.

```ts file:apps/execution-edge/src/telemetry-wire-v2.ts
import { canonicalStringify, sha256Hex } from "./canonical";
import { makeBoundaryV2, includesDealV2 } from "./telemetry-cutover-v2";
import { deriveCoverageV2 } from "./telemetry-coverage-v2";
import { readDigestV2 as digest, readIdentifierV2 as id, readTicketV2 as ticket, sumFixedV2 } from "./telemetry-values-v2";
import { boolean, boundedBody, canonicalInput, check, choice, fixed, integer, list, nullable, object, reading, text } from "./telemetry-schema-v2";
export { boundedBody };

const symbol = text(64);
const instant = integer(1);
export const readIdentityV2 = object({ account_id: id, installation_id: id, tracking_id: id,
  safety_epoch: integer(), account_profile_sha256: digest, account_fingerprint_sha256: digest, tracking_boundary_sha256: digest });
const readBoundary = object({ tracking_id: id, account_fingerprint_sha256: digest,
  started_at_broker_msc: instant, initialized_at_utc_seconds: instant, excluded_boundary_deal_ids: list(ticket, 1024) });
const position = object({ ticket, position_id: ticket, symbol, side: choice("BUY", "SELL"), volume: fixed,
  entry_price: reading, current_price: reading, sl: reading, tp: reading, floating_profit: reading, swap: reading });
const order = object({ ticket, symbol, type: choice("BUY_LIMIT", "SELL_LIMIT", "BUY_STOP", "SELL_STOP", "BUY_STOP_LIMIT", "SELL_STOP_LIMIT"),
  state: choice("STARTED", "PLACED", "PARTIAL", "REQUEST_ADD", "REQUEST_MODIFY", "REQUEST_CANCEL", "UNKNOWN"),
  volume_initial: fixed, volume_current: fixed, price: reading, stop_limit_price: reading, sl: reading, tp: reading });
const exposure = object({ status: choice("COMPLETE", "CAPTURE_FAILED", "LIMIT_EXCEEDED"),
  observed_at_utc_seconds: instant, observed_at_broker_msc: instant,
  position_count: nullable(integer()), order_count: nullable(integer()), positions: list(position, 128), orders: list(order, 128) });
const account = object({ status: choice("COMPLETE", "CAPTURE_FAILED"), observed_at_utc_seconds: instant,
  observed_at_broker_msc: instant, balance: reading, equity: reading, margin_used: reading, margin_free: reading, margin_level: reading });
const display = object({ company: text(96), server: text(96), login_last4: text(4, /^[0-9]{4}$/u),
  currency: text(12, /^[A-Z0-9]{1,12}$/u), currency_scale: integer(),
  account_mode: choice("DEMO", "REAL", "CONTEST", "UNKNOWN"), margin_mode: choice("RETAIL_NETTING", "EXCHANGE", "RETAIL_HEDGING", "UNKNOWN") });
export const readRegistrationV2 = object({ boundary: readBoundary, display, baseline: exposure });
const reason = choice("CLIENT", "MOBILE", "WEB", "EXPERT", "SL", "TP", "SO", "ROLLOVER", "VMARGIN", "SPLIT", "CORPORATE_ACTION", "UNKNOWN");
const deal = object({ kind: choice("DEAL"), deal_id: ticket, revision: instant, previous_record_sha256: nullable(digest),
  broker_time_msc: instant, type: choice("BUY", "SELL", "BUY_CANCELED", "SELL_CANCELED", "BALANCE", "CREDIT", "CHARGE", "CORRECTION", "BONUS", "COMMISSION", "COMMISSION_DAILY", "COMMISSION_MONTHLY", "COMMISSION_AGENT_DAILY", "COMMISSION_AGENT_MONTHLY", "INTEREST", "DIVIDEND", "DIVIDEND_FRANKED", "TAX"),
  entry: choice("IN", "OUT", "INOUT", "OUT_BY", "NONE"), order_id: nullable(ticket), position_id: nullable(ticket),
  symbol: nullable(symbol), volume: nullable(fixed), price: reading, profit: reading, commission: reading, swap: reading, fee: reading,
  reason, sl: reading, tp: reading, protection_source: choice("BROKER_DEAL", "UNAVAILABLE"),
  reversal_split: nullable(object({ source: choice("RECONSTRUCTED_POSITION_VOLUME"), closing_volume: fixed, opening_volume: fixed })) });
const protection = object({ kind: choice("PROTECTION_OBSERVATION"), position_id: ticket, ticket, symbol,
  observed_at_broker_msc: instant, sl: reading, tp: reading, source: choice("POLL", "TRANSACTION_OBSERVATION") });
const record = (value: unknown) => {
  check(value !== null && typeof value === "object" && !Array.isArray(value));
  return (value as { kind?: unknown }).kind === "DEAL" ? deal(value) : protection(value);
};
const event = object({ sequence: instant, event_id: id, observed_at_utc_seconds: instant, record_sha256: digest, record });
const collection = object({ produced_events: integer(), scan_finished: boolean, scan_through_broker_msc: nullable(instant),
  record_gap: nullable(choice("HISTORY_UNAVAILABLE", "CLOCK_DISCONTINUITY", "OUTBOX_CORRUPT", "CAPTURE_FAILED", "UNSUPPORTED_RECORD")), observation_gap: boolean });
const permission = choice("ALLOWED", "DENIED", "UNKNOWN");
const diagnostics = object({ ea_release: text(64), reported_source_sha256: nullable(digest), reported_manifest_sha256: nullable(digest),
  terminal_build: instant, source_symbol: symbol, observed_at_utc_seconds: instant,
  terminal_connection_state: choice("CONNECTED", "DISCONNECTED", "UNKNOWN"), account_trade_permission: permission,
  terminal_trade_permission: permission, algo_trading_permission: permission,
  last_successful_upload_utc_seconds: nullable(instant), last_accepted_request_sequence: integer(), local_unsent_events: integer(),
  last_error: nullable(choice("HISTORY_UNAVAILABLE", "CLOCK_DISCONTINUITY", "OUTBOX_CORRUPT", "CAPTURE_FAILED", "UNSUPPORTED_RECORD", "DISK_FULL", "HTTP_ERROR", "RESPONSE_INVALID")) });
const readEnvelope = object({ schema_version: choice("AgentSyncRequestV2"), identity: readIdentityV2,
  registration: readRegistrationV2, request_sequence: instant, last_acknowledged_event_sequence: integer(),
  sent_at_utc_seconds: instant, account, exposure, collection, diagnostics, events: list(event, 32), body_sha256: digest });
export type TelemetryRequestV2 = ReturnType<typeof readEnvelope>;
export type DealV2 = ReturnType<typeof deal>;
export type JournalEventV2 = ReturnType<typeof event>;

function unique(values: readonly string[]): void { check(new Set(values).size === values.length); }
function positive(value: ReturnType<typeof fixed>): boolean { return !value.value.startsWith("-") && /[1-9]/u.test(value.value); }
function exposureValid(value: ReturnType<typeof exposure>, moneyScale: number): void {
  unique(value.positions.map(p => p.ticket)); unique(value.positions.map(p => p.position_id)); unique(value.orders.map(o => o.ticket));
  if (value.status === "COMPLETE") check(value.position_count === value.positions.length && value.order_count === value.orders.length);
  else check(value.positions.length === 0 && value.orders.length === 0);
  for (const p of value.positions) {
    check(positive(p.volume));
    for (const amount of [p.floating_profit, p.swap]) check(amount.value === null || amount.value.scale === moneyScale);
  }
  for (const o of value.orders) {
    check(positive(o.volume_initial) && positive(o.volume_current) && o.volume_initial.scale === o.volume_current.scale);
    const difference = sumFixedV2([o.volume_initial, { value: `-${o.volume_current.value}`, scale: o.volume_current.scale }], o.volume_current.scale);
    check(!difference.value.startsWith("-"));
  }
}
export async function parseTelemetryV2(bytes: Uint8Array): Promise<TelemetryRequestV2> {
  const value = readEnvelope(canonicalInput(bytes)); const { body_sha256, ...body } = value;
  check(await sha256Hex(canonicalStringify(body)) === body_sha256, "TELEMETRY_DIGEST_INVALID");
  const boundary = makeBoundaryV2(value.registration.boundary);
  check(canonicalStringify(boundary) === canonicalStringify(value.registration.boundary));
  check(boundary.tracking_id === value.identity.tracking_id && boundary.account_fingerprint_sha256 === value.identity.account_fingerprint_sha256);
  check(await sha256Hex(canonicalStringify(boundary)) === value.identity.tracking_boundary_sha256);
  const scale = value.registration.display.currency_scale; check(scale <= 16);
  check(value.registration.baseline.status === "COMPLETE");
  exposureValid(value.registration.baseline, scale); exposureValid(value.exposure, scale);
  const start = boundary.initialized_at_utc_seconds;
  check(start <= value.sent_at_utc_seconds);
  check(value.registration.baseline.observed_at_utc_seconds === start);
  check(Math.floor(value.registration.baseline.observed_at_broker_msc / 1000) * 1000 === boundary.started_at_broker_msc);
  for (const at of [value.account.observed_at_utc_seconds, value.exposure.observed_at_utc_seconds, value.diagnostics.observed_at_utc_seconds]) check(at >= start && at <= value.sent_at_utc_seconds);
  for (const amount of [value.account.balance, value.account.equity, value.account.margin_used, value.account.margin_free]) check(amount.value === null || amount.value.scale === scale);
  if (value.account.status === "COMPLETE") check([value.account.balance, value.account.equity, value.account.margin_used, value.account.margin_free].every(a => a.value !== null));
  if (value.account.status === "CAPTURE_FAILED") check([value.account.balance, value.account.equity, value.account.margin_used, value.account.margin_free, value.account.margin_level].every(a => a.value === null));
  unique(value.events.map(e => e.event_id));
  unique(value.events.filter(e => e.record.kind === "DEAL").map(e => (e.record as DealV2).deal_id));
  for (const e of value.events) {
    check(e.observed_at_utc_seconds >= start && e.observed_at_utc_seconds <= value.sent_at_utc_seconds);
    check(await sha256Hex(canonicalStringify(e.record)) === e.record_sha256);
    const r = e.record;
    if (r.kind === "PROTECTION_OBSERVATION") { check(r.observed_at_broker_msc >= boundary.started_at_broker_msc); continue; }
    check(includesDealV2(boundary, r.broker_time_msc, r.deal_id), "TELEMETRY_BEFORE_TRACKING");
    check((r.revision === 1) === (r.previous_record_sha256 === null));
    const trading = ["BUY", "SELL", "BUY_CANCELED", "SELL_CANCELED"].includes(r.type);
    if (trading) check(r.position_id !== null && r.order_id !== null && r.symbol !== null && r.entry !== "NONE" && r.volume !== null && positive(r.volume));
    else check(r.entry === "NONE" && r.reversal_split === null);
    for (const amount of [r.profit, r.commission, r.swap, r.fee]) check(amount.value === null || amount.value.scale === scale);
    if (r.protection_source === "UNAVAILABLE") check(r.sl.value === null && r.tp.value === null);
    if (r.reversal_split !== null) {
      check(r.entry === "INOUT" && r.volume !== null);
      const { closing_volume, opening_volume } = r.reversal_split;
      check(positive(closing_volume) && positive(opening_volume));
      check(canonicalStringify(sumFixedV2([closing_volume, opening_volume], r.volume.scale)) === canonicalStringify(r.volume));
    }
  }
  const last = value.events.at(-1)?.sequence ?? value.last_acknowledged_event_sequence;
  check(value.collection.produced_events >= last);
  check(value.diagnostics.local_unsent_events === value.collection.produced_events - value.last_acknowledged_event_sequence);
  check(value.diagnostics.last_accepted_request_sequence === value.request_sequence - 1);
  const successAt = value.diagnostics.last_successful_upload_utc_seconds;
  check(successAt === null || (successAt >= start && successAt <= value.sent_at_utc_seconds));
  const through = value.collection.scan_through_broker_msc;
  check(through === null || (through >= boundary.started_at_broker_msc && through <= Math.max(value.account.observed_at_broker_msc, value.exposure.observed_at_broker_msc)));
  deriveCoverageV2({ started: true, ...value.collection, acknowledged_events: value.last_acknowledged_event_sequence });
  return value;
}
const coverage = object({ state: choice("NOT_STARTED", "CATCHING_UP", "UP_TO_DATE", "DATA_MISSING"), through_broker_msc: nullable(instant),
  pending_events: integer(), reason: nullable(choice("HISTORY_UNAVAILABLE", "CLOCK_DISCONTINUITY", "OUTBOX_CORRUPT", "CAPTURE_FAILED", "UNSUPPORTED_RECORD")), observation_gap: boolean });
const response = object({ schema_version: choice("AgentSyncResponseV2"), identity: readIdentityV2, request_sequence: instant,
  request_body_sha256: digest, accepted_at_utc_seconds: instant, acknowledged_event_sequence: integer(), coverage,
  mode: choice("DRY_RUN"), command: choice(null), response_body_sha256: digest });
export async function responseBytesV2(request: TelemetryRequestV2, ack: number, acceptedAt: number): Promise<string> {
  const body = { schema_version: "AgentSyncResponseV2", identity: request.identity, request_sequence: request.request_sequence,
    request_body_sha256: request.body_sha256, accepted_at_utc_seconds: acceptedAt, acknowledged_event_sequence: ack,
    coverage: deriveCoverageV2({ started: true, ...request.collection, acknowledged_events: ack }), mode: "DRY_RUN", command: null };
  return canonicalStringify({ ...body, response_body_sha256: await sha256Hex(canonicalStringify(body)) });
}
export async function validateResponseV2(bytes: Uint8Array, request: TelemetryRequestV2): Promise<string> {
  const value = response(canonicalInput(bytes, 16 * 1024));
  const expectedAck = request.events.at(-1)?.sequence ?? request.last_acknowledged_event_sequence;
  check(value.acknowledged_event_sequence === expectedAck);
  check(await responseBytesV2(request, expectedAck, value.accepted_at_utc_seconds) === new TextDecoder().decode(bytes));
  return canonicalStringify(value);
}
```

- [ ] Run the strict wire tests and typecheck. Confirm v1 source/parser/golden response tests remain unchanged.
- [ ] Local checkpoint: review keysets, nullability, limits, revision chain, epoch units and body hashing. Require canonical UTF-8 from both TypeScript and future MQL5; never relax parsing to make a fixture pass.

## Task 3 — lossless per-deal projection

The immutable event contains each revision. A separate current pointer selects one revision per broker deal. Projection records are contributions, not closed-trade claims. Group by stable position ID in Stage 4; preserve every partial fill. Never allocate a reversal's entire volume/cost to both portions. Unknown reconstruction is explicit. A cancellation replaces the current broker facts; it is not a fabricated negative reversal of earlier P/L. Standalone broker adjustments remain account activity.

- [ ] Add Task 7's projection tests, run `npm --prefix apps/execution-edge test -- test/telemetry-journal-projection-v2.test.ts`, and observe RED.
- [ ] Add this file, then rerun that command and typecheck.

```ts file:apps/execution-edge/src/telemetry-journal-projection-v2.ts
import type { DealV2, TelemetryRequestV2 } from "./telemetry-wire-v2";
import { sumFixedV2 } from "./telemetry-values-v2";

export function projectDealV2(deal: DealV2, registration: TelemetryRequestV2["registration"]) {
  const amounts = [deal.profit, deal.commission, deal.swap, deal.fee];
  const complete = amounts.every(amount => amount.value !== null);
  const trading = ["BUY", "SELL", "BUY_CANCELED", "SELL_CANCELED"].includes(deal.type);
  const before = deal.position_id !== null && registration.baseline.positions.some(p => p.position_id === deal.position_id);
  const origin = !trading || deal.entry !== "IN" ? "UNKNOWN"
    : ["CLIENT", "MOBILE", "WEB"].includes(deal.reason) ? "MANUAL"
      : deal.reason === "EXPERT" ? "EA_OR_SCRIPT" : "UNKNOWN";
  const reversal = deal.entry === "INOUT";
  return Object.freeze({
    category: trading ? "TRADE_DEAL" : "ACCOUNT_ACTIVITY",
    position_id: deal.position_id, broker_type: deal.type, entry: deal.entry,
    cancelled: deal.type === "BUY_CANCELED" || deal.type === "SELL_CANCELED",
    gross_recorded: deal.profit, commission: deal.commission, swap: deal.swap, fee: deal.fee,
    net_recorded: complete ? sumFixedV2(amounts.map(a => a.value!), registration.display.currency_scale) : null,
    result_reason: complete ? null : "MISSING_BROKER_AMOUNT",
    opened_before_tracking: before, lifetime_complete: false, initial_risk: null, strategy: "UNKNOWN",
    opening_origin: origin, exit_reason: ["OUT", "OUT_BY", "INOUT"].includes(deal.entry) ? deal.reason : null,
    opening_volume: !trading ? null : reversal ? deal.reversal_split?.opening_volume ?? null : deal.entry === "IN" ? deal.volume : null,
    closing_volume: !trading ? null : reversal ? deal.reversal_split?.closing_volume ?? null : ["OUT", "OUT_BY"].includes(deal.entry) ? deal.volume : null,
    portion_reason: reversal ? deal.reversal_split === null ? "REVERSAL_SPLIT_UNKNOWN" : "RECONSTRUCTED_NOT_BROKER_ATTESTED" : null,
    portion_cost_allocation: reversal ? "UNKNOWN" : "SINGLE_PORTION",
    sl: deal.sl, tp: deal.tp, protection_source: deal.protection_source,
  });
}
```

## Task 4 — additive transactional schema and repository

### 4A. Schema

- [ ] Add the repository tests before the schema; the local runtime must report missing tables/module, not pass against a map pretending to be D1.
- [ ] Add this migration file. Apply it only to the disposable local test database via the harness. Do not run Wrangler remote commands.

```sql file:apps/execution-edge/migrations/0004_account_telemetry_v2.sql
CREATE TABLE telemetry_session_v2 (
  account_id TEXT PRIMARY KEY NOT NULL,
  scope TEXT UNIQUE NOT NULL,
  identity_json TEXT NOT NULL CHECK(json_valid(identity_json)),
  registration_json TEXT NOT NULL CHECK(json_valid(registration_json)),
  last_request_sequence INTEGER NOT NULL CHECK(last_request_sequence BETWEEN 1 AND 9007199254740991),
  last_event_sequence INTEGER NOT NULL CHECK(last_event_sequence BETWEEN 0 AND 9007199254740991),
  request_digest TEXT NOT NULL,
  accepted_at INTEGER NOT NULL CHECK(accepted_at > 0),
  latest_json TEXT NOT NULL CHECK(json_valid(latest_json)),
  account_json TEXT CHECK(account_json IS NULL OR json_valid(account_json)),
  exposure_json TEXT CHECK(exposure_json IS NULL OR json_valid(exposure_json))
) WITHOUT ROWID;
CREATE TABLE telemetry_receipt_v2 (
  scope TEXT NOT NULL REFERENCES telemetry_session_v2(scope),
  request_sequence INTEGER NOT NULL,
  request_digest TEXT NOT NULL,
  response_bytes TEXT NOT NULL,
  accepted_at INTEGER NOT NULL,
  acknowledged_events INTEGER NOT NULL,
  PRIMARY KEY(scope, request_sequence)
) WITHOUT ROWID;
CREATE TABLE telemetry_event_v2 (
  scope TEXT NOT NULL REFERENCES telemetry_session_v2(scope),
  sequence INTEGER NOT NULL,
  event_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('DEAL', 'PROTECTION_OBSERVATION')),
  deal_id TEXT,
  revision INTEGER,
  previous_digest TEXT,
  record_digest TEXT NOT NULL,
  event_json TEXT NOT NULL CHECK(json_valid(event_json)),
  projection_json TEXT CHECK(projection_json IS NULL OR json_valid(projection_json)),
  PRIMARY KEY(scope, sequence),
  UNIQUE(scope, event_id),
  UNIQUE(scope, deal_id, revision),
  CHECK((kind = 'DEAL' AND deal_id IS NOT NULL AND revision IS NOT NULL AND revision > 0) OR
        (kind = 'PROTECTION_OBSERVATION' AND deal_id IS NULL AND revision IS NULL AND previous_digest IS NULL))
) WITHOUT ROWID;
CREATE TABLE telemetry_deal_current_v2 (
  scope TEXT NOT NULL,
  deal_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  revision INTEGER NOT NULL,
  record_digest TEXT NOT NULL,
  PRIMARY KEY(scope, deal_id),
  FOREIGN KEY(scope, sequence) REFERENCES telemetry_event_v2(scope, sequence)
) WITHOUT ROWID;
CREATE TRIGGER telemetry_session_v2_identity
BEFORE UPDATE ON telemetry_session_v2
WHEN NEW.account_id IS NOT OLD.account_id OR NEW.scope IS NOT OLD.scope
  OR NEW.identity_json IS NOT OLD.identity_json OR NEW.registration_json IS NOT OLD.registration_json
BEGIN SELECT RAISE(ABORT, 'TELEMETRY_IDENTITY_CONFLICT'); END;
CREATE TRIGGER telemetry_session_v2_no_delete BEFORE DELETE ON telemetry_session_v2
BEGIN SELECT RAISE(ABORT, 'TELEMETRY_REGISTRATION_IMMUTABLE'); END;
CREATE TRIGGER telemetry_receipt_v2_guard BEFORE INSERT ON telemetry_receipt_v2
WHEN NOT EXISTS(SELECT 1 FROM telemetry_session_v2 s WHERE s.scope = NEW.scope
  AND s.last_request_sequence = NEW.request_sequence AND s.request_digest = NEW.request_digest
  AND s.last_event_sequence = NEW.acknowledged_events AND s.accepted_at = NEW.accepted_at)
BEGIN SELECT RAISE(ABORT, 'TELEMETRY_CLAIM_INVALID'); END;
CREATE TRIGGER telemetry_event_v2_revision BEFORE INSERT ON telemetry_event_v2
WHEN NEW.kind = 'DEAL' AND (
  NEW.revision != COALESCE((SELECT revision FROM telemetry_deal_current_v2 WHERE scope = NEW.scope AND deal_id = NEW.deal_id), 0) + 1
  OR NEW.previous_digest IS NOT (SELECT record_digest FROM telemetry_deal_current_v2 WHERE scope = NEW.scope AND deal_id = NEW.deal_id))
BEGIN SELECT RAISE(ABORT, 'TELEMETRY_REVISION_CONFLICT'); END;
CREATE TRIGGER telemetry_receipt_v2_no_update BEFORE UPDATE ON telemetry_receipt_v2
BEGIN SELECT RAISE(ABORT, 'TELEMETRY_RECEIPT_IMMUTABLE'); END;
CREATE TRIGGER telemetry_receipt_v2_no_delete BEFORE DELETE ON telemetry_receipt_v2
BEGIN SELECT RAISE(ABORT, 'TELEMETRY_RECEIPT_IMMUTABLE'); END;
CREATE TRIGGER telemetry_event_v2_no_update BEFORE UPDATE ON telemetry_event_v2
BEGIN SELECT RAISE(ABORT, 'TELEMETRY_EVENT_IMMUTABLE'); END;
CREATE TRIGGER telemetry_event_v2_no_delete BEFORE DELETE ON telemetry_event_v2
BEGIN SELECT RAISE(ABORT, 'TELEMETRY_EVENT_IMMUTABLE'); END;
```

There is intentionally no receipt expiration or automatic cleanup. Measure storage growth; a capacity error must preserve the EA outbox. A future retention policy requires a separate decision. The event primary key is also the account/tracking journal cursor index. The current-deal table points into immutable events instead of storing a second monetary copy.

### 4B. Atomic acceptance

- [ ] Implement this file in three reviewable edits: reads/admission; transaction construction; post-commit replay recovery. Run the corresponding repository tests after each edit.

```ts file:apps/execution-edge/src/telemetry-repository-v2.ts
import { canonicalStringify, sha256Hex } from "./canonical";
import { decideAdmissionV2, type AcceptedStateV2, type ReceiptMetaV2 } from "./telemetry-admission-v2";
import { deriveCoverageV2 } from "./telemetry-coverage-v2";
import { check, bad } from "./telemetry-schema-v2";
import { readCounterV2, readDigestV2 } from "./telemetry-values-v2";
import { readIdentityV2, responseBytesV2, validateResponseV2, type TelemetryRequestV2 } from "./telemetry-wire-v2";
import { projectDealV2 } from "./telemetry-journal-projection-v2";

type SessionRow = { scope: string; identity_json: string; registration_json: string; last_request_sequence: number; last_event_sequence: number };
type ReceiptRow = { request_digest: string; response_bytes: string; accepted_at: number; acknowledged_events: number };
export const SESSION_SQL_V2 = "SELECT scope, identity_json, registration_json, last_request_sequence, last_event_sequence FROM telemetry_session_v2 WHERE account_id = ?";
export const RECEIPT_SQL_V2 = "SELECT request_digest, response_bytes, accepted_at, acknowledged_events FROM telemetry_receipt_v2 WHERE scope = ? AND request_sequence = ?";
export const JOURNAL_SQL_V2 = "SELECT sequence, event_json, projection_json FROM telemetry_event_v2 WHERE scope = ? AND sequence < ? ORDER BY sequence DESC LIMIT 50";
export async function scopeV2(request: TelemetryRequestV2): Promise<string> { return sha256Hex(canonicalStringify(request.identity)); }
async function load(db: D1Database, request: TelemetryRequestV2, scope: string) {
  const results = await db.batch([
    db.prepare(SESSION_SQL_V2).bind(request.identity.account_id),
    db.prepare(RECEIPT_SQL_V2).bind(scope, request.request_sequence),
  ]);
  check(results.length === 2 && results.every(r => r.success), "TELEMETRY_STORAGE_UNAVAILABLE");
  const session = (results[0]!.results[0] ?? null) as SessionRow | null;
  const row = (results[1]!.results[0] ?? null) as ReceiptRow | null;
  let state: AcceptedStateV2 | null = null; let receipt: ReceiptMetaV2 | null = null;
  if (session !== null) {
    const identity = readIdentityV2(JSON.parse(session.identity_json));
    check(session.scope === await sha256Hex(canonicalStringify(identity)), "TELEMETRY_STORAGE_INVALID");
    check(session.scope === scope && session.registration_json === canonicalStringify(request.registration), "IDENTITY_MISMATCH");
    state = { identity, last_request_sequence: readCounterV2(session.last_request_sequence, 1), last_event_sequence: readCounterV2(session.last_event_sequence) };
  }
  if (row !== null) {
    check(state !== null, "TELEMETRY_STORAGE_INVALID");
    receipt = { identity: state.identity, request_sequence: request.request_sequence,
      request_body_sha256: readDigestV2(row.request_digest), response_bytes: row.response_bytes };
    // Check association only for an exact body. An altered same-sequence body must be a conflict, not a checksum error.
    if (row.request_digest === request.body_sha256) {
      await validateResponseV2(new TextEncoder().encode(row.response_bytes), request);
      const response = JSON.parse(row.response_bytes) as { accepted_at_utc_seconds: number; acknowledged_event_sequence: number };
      check(response.accepted_at_utc_seconds === row.accepted_at && response.acknowledged_event_sequence === row.acknowledged_events, "TELEMETRY_STORAGE_INVALID");
    }
  }
  return { state, receipt };
}
export function statementsV2(db: D1Database, request: TelemetryRequestV2, scope: string, previous: number, ack: number, now: number, response: string): D1PreparedStatement[] {
  const rows = request.events.map(event => ({
    sequence: event.sequence, event_id: event.event_id, kind: event.record.kind,
    deal_id: event.record.kind === "DEAL" ? event.record.deal_id : null,
    revision: event.record.kind === "DEAL" ? event.record.revision : null,
    previous_digest: event.record.kind === "DEAL" ? event.record.previous_record_sha256 : null,
    record_digest: event.record_sha256, event_json: canonicalStringify(event),
    projection_json: event.record.kind === "DEAL" ? canonicalStringify(projectDealV2(event.record, request.registration)) : null,
  }));
  const latest = canonicalStringify({ account_attempt: request.account, exposure_attempt: request.exposure,
    collection: request.collection, diagnostics: request.diagnostics,
    coverage: deriveCoverageV2({ started: true, ...request.collection, acknowledged_events: ack }) });
  return [
    db.prepare(`INSERT INTO telemetry_session_v2
      (account_id,scope,identity_json,registration_json,last_request_sequence,last_event_sequence,request_digest,accepted_at,latest_json,account_json,exposure_json)
      VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(account_id) DO UPDATE SET
      last_request_sequence = CASE WHEN telemetry_session_v2.last_request_sequence = ?
        AND telemetry_session_v2.scope = excluded.scope AND telemetry_session_v2.registration_json = excluded.registration_json
        THEN excluded.last_request_sequence ELSE 0 END,
      last_event_sequence = excluded.last_event_sequence, request_digest = excluded.request_digest,
      accepted_at = excluded.accepted_at, latest_json = excluded.latest_json,
      account_json = COALESCE(excluded.account_json,telemetry_session_v2.account_json),
      exposure_json = COALESCE(excluded.exposure_json,telemetry_session_v2.exposure_json)`)
      .bind(request.identity.account_id, scope, canonicalStringify(request.identity), canonicalStringify(request.registration),
        request.request_sequence, ack, request.body_sha256, now, latest,
        request.account.status === "COMPLETE" ? canonicalStringify(request.account) : null,
        request.exposure.status === "COMPLETE" ? canonicalStringify(request.exposure) : null, previous),
    db.prepare("INSERT INTO telemetry_receipt_v2 (scope,request_sequence,request_digest,response_bytes,accepted_at,acknowledged_events) VALUES (?,?,?,?,?,?)")
      .bind(scope, request.request_sequence, request.body_sha256, response, now, ack),
    db.prepare(`INSERT INTO telemetry_event_v2 (scope,sequence,event_id,kind,deal_id,revision,previous_digest,record_digest,event_json,projection_json)
      SELECT ?, json_extract(value,'$.sequence'),json_extract(value,'$.event_id'),json_extract(value,'$.kind'),
      json_extract(value,'$.deal_id'),json_extract(value,'$.revision'),json_extract(value,'$.previous_digest'),
      json_extract(value,'$.record_digest'),json_extract(value,'$.event_json'),json_extract(value,'$.projection_json') FROM json_each(?)`)
      .bind(scope, canonicalStringify(rows)),
    db.prepare(`INSERT INTO telemetry_deal_current_v2 (scope,deal_id,sequence,revision,record_digest)
      SELECT ?,json_extract(value,'$.deal_id'),json_extract(value,'$.sequence'),json_extract(value,'$.revision'),json_extract(value,'$.record_digest')
      FROM json_each(?) WHERE json_extract(value,'$.kind') = 'DEAL'
      ON CONFLICT(scope,deal_id) DO UPDATE SET sequence=excluded.sequence,revision=excluded.revision,record_digest=excluded.record_digest`)
      .bind(scope, canonicalStringify(rows)),
  ];
}
/** Caller has authenticated, parsed the canonical wire bytes, and checked the existing coordinator identity pin. */
export async function acceptTelemetryV2(db: D1Database, request: TelemetryRequestV2, now: number): Promise<string> {
  readCounterV2(now, 1); const scope = await scopeV2(request);
  const current = await load(db, request, scope);
  const admission = decideAdmissionV2(current.state, current.receipt, { identity: request.identity,
    request_sequence: request.request_sequence, body_sha256: request.body_sha256,
    event_sequences: request.events.map(e => e.sequence), fresh: Math.abs(now - request.sent_at_utc_seconds) <= 30 });
  if (admission.kind === "REJECT") bad(admission.code);
  if (admission.kind === "REPLAY") return admission.response_bytes;
  check(request.last_acknowledged_event_sequence === (current.state?.last_event_sequence ?? 0), "EVENT_SEQUENCE_INVALID");
  const ack = admission.event_sequence_if_committed;
  const bytes = await responseBytesV2(request, ack, now);
  await validateResponseV2(new TextEncoder().encode(bytes), request);
  try {
    const results = await db.batch(statementsV2(db, request, scope, current.state?.last_request_sequence ?? 0, ack, now, bytes));
    check(results.length === 4 && results.every(r => r.success), "TELEMETRY_STORAGE_UNAVAILABLE");
  } catch {
    // Recover an uncertain successful commit or a concurrent exact winner. Never turn other failures into ACKs.
    const recovered = await load(db, request, scope);
    if (recovered.receipt?.request_body_sha256 === request.body_sha256) return recovered.receipt.response_bytes;
    if (recovered.receipt !== null) bad("REPLAY_CONFLICT");
    bad("TELEMETRY_STORAGE_UNAVAILABLE");
  }
  // Read authoritative bytes even on first acceptance; lost post-commit reads are retried from this receipt.
  const saved = await load(db, request, scope);
  check(saved.receipt !== null && saved.receipt.request_body_sha256 === request.body_sha256, "TELEMETRY_STORAGE_UNAVAILABLE");
  return saved.receipt.response_bytes;
}
```

The four-statement batch has a conditional session update that deliberately violates its positive-sequence CHECK if another writer has advanced. The receipt's primary key additionally prevents two first registrations from producing different accepted bodies at one sequence. Each request contains at most one revision per deal; the SQL revision trigger compares to the prior current pointer. Failed event chains roll back the receipt/session as well. Events and per-deal monetary values are never updated in place.

Identity conflicts use `IDENTITY_MISMATCH`; altered receipt bodies use `REPLAY_CONFLICT`; gaps use `EVENT_SEQUENCE_INVALID`; invalid revision/event uniqueness or storage failures initially use `TELEMETRY_STORAGE_UNAVAILABLE` with **no ACK**. Task 7 verifies they remain visible failures. Do not parse SQL error strings into success. A later UI may explain server failures without exposing database messages.

- [ ] Run repository tests against real local D1. Check rollback after each of the four positions, a commit followed by a thrown transport error, and a second distinct connection racing the first. Do not replace this acceptance gate with source-only checks.
- [ ] Check original acceptance time and last-complete snapshots after retries/rejections. Review the SQL and `git diff --check` without staging.

## Task 5 — coordinator queue and existing identity pin

- [ ] Add Task 7's queue/identity tests and observe RED.
- [ ] Add this complete queue file.

```ts file:apps/execution-edge/src/telemetry-queue-v2.ts
import { bad } from "./telemetry-schema-v2";
export class TelemetryQueueV2 {
  private tail: Promise<void> = Promise.resolve();
  private queued = 0;
  async run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.queued >= 8) bad("TELEMETRY_BUSY");
    this.queued += 1;
    const result = this.tail.then(operation);
    this.tail = result.then(() => undefined, () => undefined);
    try { return await result; } finally { this.queued -= 1; }
  }
}
```

- [ ] In `account-coordinator-v1.ts`, add these imports. Keep `coordinateAgentSyncV1`, `loadCoordinatorSyncStateV1`, all existing storage keys and v1 response functions unchanged.

```ts
import { boundedBody, parseTelemetryV2 } from "./telemetry-wire-v2";
import { acceptTelemetryV2 } from "./telemetry-repository-v2";
import { TelemetryQueueV2 } from "./telemetry-queue-v2";
import { check } from "./telemetry-schema-v2";
```

- [ ] Replace only the class's constructor declaration with these members. `syncTelemetryV2` reads the existing identity pin through the existing state loader and never writes v1 storage.

```ts
  private readonly telemetryQueue = new TelemetryQueueV2();
  constructor(private readonly state: DurableObjectState, private readonly telemetryEnv?: { EXECUTION_DB: D1Database }) {}

  private async syncTelemetryV2(request: Request): Promise<Response> {
    try {
      return await this.telemetryQueue.run(async () => {
        check(this.telemetryEnv !== undefined, "TELEMETRY_STORAGE_UNAVAILABLE");
        const parsed = await parseTelemetryV2(await boundedBody(request));
        const pinned = await loadCoordinatorSyncStateV1(this.state.storage);
        check(pinned.last_accepted_request_sequence !== undefined, "TELEMETRY_V1_REGISTRATION_REQUIRED");
        check(pinned.installation_id === parsed.identity.installation_id
          && pinned.account_profile_sha256 === parsed.identity.account_profile_sha256
          && pinned.account_fingerprint_sha256 === parsed.identity.account_fingerprint_sha256
          && pinned.safety_epoch === parsed.identity.safety_epoch, "IDENTITY_MISMATCH");
        const bytes = await acceptTelemetryV2(this.telemetryEnv.EXECUTION_DB, parsed, Math.floor(Date.now() / 1000));
        return new Response(bytes, { headers: { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" } });
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "";
      const conflicts = ["IDENTITY_MISMATCH", "REPLAY_CONFLICT", "SEQUENCE_INVALID", "EVENT_SEQUENCE_INVALID", "TELEMETRY_V1_REGISTRATION_REQUIRED"];
      const code = conflicts.includes(reason) ? reason : reason === "STALE_ENVELOPE" ? reason : "TELEMETRY_UNAVAILABLE";
      return coordinatorDryRun({ code }, conflicts.includes(code) ? 409 : code === "STALE_ENVELOPE" ? 400 : 503);
    }
  }
```

- [ ] Immediately after `const { pathname } = new URL(request.url);` in the existing class's fetch method, insert:

```ts
    if (request.method === "POST" && pathname === "/sync-v2") return this.syncTelemetryV2(request);
```

The public adapter supplies the account-specific DO name; arbitrary public coordinator paths are not forwarded. V1 and v2 sequencing remain independent. This upgrade refuses a missing/corrupt v1 pin rather than enrolling private account data on first unaudited upload. A v1 pin cannot be changed by a subsequent v1 request; keep that existing regression test.

- [ ] Run the new queue tests and `test/account-coordinator-v1.test.ts`, then typecheck. A rejected operation must release the v2 queue; a restart must recover only from D1, never an in-memory ACK.

## Task 6 — public command-free endpoint

- [ ] Add the public adapter tests before adding this file.

```ts file:apps/execution-edge/src/telemetry-sync-v2.ts
import { authenticateAgentSyncBearer } from "./agent-sync-v1";
import { boundedBody, parseTelemetryV2, validateResponseV2 } from "./telemetry-wire-v2";
import { canonicalStringify } from "./canonical";
import { choice, object } from "./telemetry-schema-v2";
export type TelemetryHttpEnvV2 = {
  AGENT_SYNC_ENABLED: "true" | "false";
  AGENT_SYNC_SHARED_SECRET_SHA256?: string;
  ACCOUNT_COORDINATOR: DurableObjectNamespace;
};
function failure(error: string, status: number): Response {
  return new Response(canonicalStringify({ error, mode: "DRY_RUN", command: null }), {
    status, headers: { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" },
  });
}
export async function handleTelemetryV2(request: Request, env: TelemetryHttpEnvV2): Promise<Response> {
  if (env.AGENT_SYNC_ENABLED !== "true") return failure("AGENT_SYNC_DISABLED", 503);
  if (request.method !== "POST") return failure("METHOD_NOT_ALLOWED", 405);
  if (!await authenticateAgentSyncBearer(request.headers.get("authorization"), env.AGENT_SYNC_SHARED_SECRET_SHA256)) return failure("UNAUTHORIZED", 401);
  if (new URL(request.url).search !== "" || request.headers.get("content-encoding") !== null
    || !/^application\/json(?:;\s*charset=utf-8)?$/iu.test(request.headers.get("content-type") ?? "")) return failure("TELEMETRY_INVALID", 400);
  let bytes: Uint8Array; let parsed;
  try { bytes = await boundedBody(request); parsed = await parseTelemetryV2(bytes); }
  catch (error) { return failure(error instanceof Error && error.message === "TELEMETRY_TOO_LARGE" ? "TELEMETRY_TOO_LARGE" : "TELEMETRY_INVALID", error instanceof Error && error.message === "TELEMETRY_TOO_LARGE" ? 413 : 400); }
  try {
    const stub = env.ACCOUNT_COORDINATOR.get(env.ACCOUNT_COORDINATOR.idFromName(parsed.identity.account_id));
    const result = await stub.fetch(new Request("https://account-coordinator.internal/sync-v2", {
      method: "POST", headers: { "content-type": "application/json" }, body: new TextDecoder().decode(bytes),
    }));
    const responseBytes = await boundedBody(result, 16 * 1024);
    if (result.status !== 200) {
      const value = object({ code: choice("IDENTITY_MISMATCH", "REPLAY_CONFLICT", "SEQUENCE_INVALID", "EVENT_SEQUENCE_INVALID", "TELEMETRY_V1_REGISTRATION_REQUIRED", "STALE_ENVELOPE", "TELEMETRY_UNAVAILABLE"), mode: choice("DRY_RUN"), command: choice(null) })(JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(responseBytes)));
      const status = value.code === "STALE_ENVELOPE" ? 400 : value.code === "TELEMETRY_UNAVAILABLE" ? 503 : 409;
      if (result.status !== status) return failure("TELEMETRY_UNAVAILABLE", 503);
      return failure(value.code, status);
    }
    return new Response(await validateResponseV2(responseBytes, parsed), {
      status: 200, headers: { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" },
    });
  } catch { return failure("TELEMETRY_UNAVAILABLE", 503); }
}
```

- [ ] Add `import { handleTelemetryV2 } from "./telemetry-sync-v2";` to index.ts.
- [ ] In the existing `AccountCoordinator` subclass constructor replace `super(state);` with `super(state, _env);`. Keep the class name and all Wrangler configuration unchanged.
- [ ] In the unsafe-configuration branch, extend only the existing sync-path condition with `|| pathname === "/api/v2/agent/sync"`, preserving its `dryRunFailure` response.
- [ ] After the complete unsafe-configuration branch and before `/health/live`, insert:

```ts
    if (pathname === "/api/v2/agent/sync") return handleTelemetryV2(request, env);
```

- [ ] Run v1 `agent-sync-v1`, `account-coordinator-v1`, `worker-shell`, new sync tests, and the unchanged boundary verifier. V2 must not write v1 audit/health, issue commands, expose a public account read, or bypass the global unsafe-configuration check.

## Task 7 — executable fixtures and regression tests

Create the two support files before writing the component test files referenced in Tasks 1–6. Tests must be written/run RED before their production components. All accounts, prices, credentials and IDs below are synthetic. No source fixture is an account configuration.

### Fixture support

```ts file:apps/execution-edge/test/support/telemetry-fixture-v2.ts
import { canonicalStringify, sha256Hex } from "../../src/canonical";
import { parseTelemetryV2 } from "../../src/telemetry-wire-v2";
export const NOW = 1_800_000_010;
export const START = 1_800_000_000;
export const f = (value: string, scale = 2) => ({ value, scale });
export const r = (value: string, scale = 2) => ({ value: f(value, scale), reason: null });
export const missing = () => ({ value: null, reason: "UNAVAILABLE" });
export function positionFixture() {
  return { ticket: "18446744073709551615", position_id: "9007199254740993", symbol: "EURUSD.a", side: "BUY", volume: f("0.10"),
    entry_price: r("1.10000", 5), current_price: r("1.10010", 5), sl: missing(), tp: missing(), floating_profit: r("1.00"), swap: r("-0.01") };
}
export function dealFixture(sequence = 1): any {
  return { sequence, event_id: `event-${sequence}`, observed_at_utc_seconds: NOW, record_sha256: "a".repeat(64), record: {
    kind: "DEAL", deal_id: String(sequence), revision: 1, previous_record_sha256: null,
    broker_time_msc: START * 1000 + 5000, type: "BUY", entry: "OUT", order_id: "700", position_id: "9007199254740993",
    symbol: "EURUSD.a", volume: f("0.10"), price: r("1.10000", 5), profit: r("10.00"), commission: r("-0.20"), swap: r("-0.05"), fee: r("-0.05"),
    reason: "TP", sl: missing(), tp: r("1.10000", 5), protection_source: "BROKER_DEAL", reversal_split: null,
  } };
}
export function unsignedFixture(sequence = 1, acknowledged = 0, events: any[] = []): any {
  const capture = { status: "COMPLETE", observed_at_utc_seconds: NOW, observed_at_broker_msc: NOW * 1000,
    position_count: 0, order_count: 0, positions: [], orders: [] };
  const produced = events.at(-1)?.sequence ?? acknowledged;
  return {
    schema_version: "AgentSyncRequestV2", identity: { account_id: "synthetic-account", installation_id: "synthetic-installation",
      tracking_id: "synthetic-tracking", safety_epoch: 7, account_profile_sha256: "a".repeat(64), account_fingerprint_sha256: "b".repeat(64), tracking_boundary_sha256: "c".repeat(64) },
    registration: { boundary: { tracking_id: "synthetic-tracking", account_fingerprint_sha256: "b".repeat(64),
      started_at_broker_msc: START * 1000, initialized_at_utc_seconds: START, excluded_boundary_deal_ids: [] },
      display: { company: "Synthetic Broker", server: "Synthetic-Demo", login_last4: "0001", currency: "USD", currency_scale: 2, account_mode: "DEMO", margin_mode: "RETAIL_HEDGING" },
      baseline: { ...capture, observed_at_utc_seconds: START, observed_at_broker_msc: START * 1000 } },
    request_sequence: sequence, last_acknowledged_event_sequence: acknowledged, sent_at_utc_seconds: NOW,
    account: { status: "COMPLETE", observed_at_utc_seconds: NOW, observed_at_broker_msc: NOW * 1000,
      balance: r("10000.00"), equity: r("10000.00"), margin_used: r("0.00"), margin_free: r("10000.00"), margin_level: { value: null, reason: "NOT_APPLICABLE" } },
    exposure: capture, events, collection: { produced_events: produced, scan_finished: true, scan_through_broker_msc: NOW * 1000, record_gap: null, observation_gap: false },
    diagnostics: { ea_release: "synthetic-v2", reported_source_sha256: null, reported_manifest_sha256: null, terminal_build: 6140,
      source_symbol: "EURUSD", observed_at_utc_seconds: NOW, terminal_connection_state: "CONNECTED", account_trade_permission: "DENIED",
      terminal_trade_permission: "DENIED", algo_trading_permission: "DENIED", last_successful_upload_utc_seconds: sequence === 1 ? null : NOW,
      last_accepted_request_sequence: sequence - 1, local_unsent_events: produced - acknowledged, last_error: null }, body_sha256: "d".repeat(64),
  };
}
export async function signFixture(raw: any) {
  const body = structuredClone(raw);
  for (const event of body.events) event.record_sha256 = await sha256Hex(canonicalStringify(event.record));
  body.identity.tracking_boundary_sha256 = await sha256Hex(canonicalStringify(body.registration.boundary));
  delete body.body_sha256;
  const bytes = new TextEncoder().encode(canonicalStringify({ ...body, body_sha256: await sha256Hex(canonicalStringify(body)) }));
  return bytes;
}
export async function fixture(sequence = 1, ack = 0, events: any[] = []) {
  return parseTelemetryV2(await signFixture(unsignedFixture(sequence, ack, events)));
}
```

### Real local D1 harness

The installed Miniflare synchronous `getD1Database` proxy stalled during planning with both Node 26 and 24. `dispatchFetch` to an actual Worker using its local D1 binding works. The harness below uses that working route. It is a thin SQL transport, **not a database mock**: SQL, constraints, transactions and metrics execute inside workerd. Never deploy this generic test SQL endpoint. No remote bindings, Cloudflare credentials or Wrangler state are loaded.

Add exact devDependency `miniflare: "4.20260721.0"` to `apps/execution-edge/package.json` when implementing. Update this package's lockfile with `npm --prefix apps/execution-edge install --package-lock-only --ignore-scripts --offline`; if unavailable offline, stop for a dependency/network check rather than upgrading versions. The package already exists locally.

```ts file:apps/execution-edge/test/support/telemetry-d1-v2.ts
import { Miniflare } from "miniflare";
import { readFile } from "node:fs/promises";
import { check } from "../../src/telemetry-schema-v2";

const script = `export default {async fetch(request,env) {
  const input=await request.json();
  try {
    if(input.schema) { for(const sql of input.schema) await env.DB.prepare(sql).run(); return Response.json([]); }
    return Response.json(await env.DB.batch(input.statements.map(s=>env.DB.prepare(s.sql).bind(...s.values))));
  } catch { return new Response("LOCAL_D1_REJECTED",{status:409}); }
}}`;
type StatementData = { sql: string; values: unknown[] };
export async function localD1V2() {
  const runtime = new Miniflare({ modules: true, script, compatibilityDate: "2026-07-23", d1Databases: ["DB"], cf: false });
  const statements = new WeakMap<object, StatementData>();
  const metrics = { reads: 0, writes: 0, maxBatch: 0, queries: 0, allocatedBytes: 0 };
  const faults = { beforeStatement: -1, afterCommit: false };
  async function send(input: unknown): Promise<D1Result[]> {
    const response = await runtime.dispatchFetch("http://localhost/test-d1", { method: "POST", body: JSON.stringify(input) });
    check(response.ok, "LOCAL_D1_REJECTED"); return response.json() as Promise<D1Result[]>;
  }
  function prepare(sql: string, values: unknown[] = []): D1PreparedStatement {
    const item = {
      bind: (...next: unknown[]) => prepare(sql, next),
      all: async () => (await batch([item as unknown as D1PreparedStatement]))[0],
      run: async () => (await batch([item as unknown as D1PreparedStatement]))[0],
      first: async (column?: string) => { const row = (await batch([item as unknown as D1PreparedStatement]))[0]?.results[0] as Record<string, unknown> | undefined; return column === undefined ? row ?? null : row?.[column] ?? null; },
    };
    statements.set(item, { sql, values }); return item as unknown as D1PreparedStatement;
  }
  async function batch(items: D1PreparedStatement[]): Promise<D1Result[]> {
    const data = items.map(item => { const data = statements.get(item); check(data !== undefined); return data; });
    const acceptance = data[0]?.sql.startsWith("INSERT INTO telemetry_session_v2") === true;
    if (acceptance && faults.beforeStatement >= 0) data.splice(faults.beforeStatement, 0, { sql: "INSERT INTO telemetry_fault_test VALUES (0)", values: [] });
    metrics.maxBatch = Math.max(metrics.maxBatch, data.length); metrics.queries += data.length;
    const results = await send({ statements: data });
    for (const result of results) { metrics.reads += result.meta.rows_read; metrics.writes += result.meta.rows_written; metrics.allocatedBytes = Math.max(metrics.allocatedBytes, result.meta.size_after); }
    if (acceptance && faults.afterCommit) { faults.afterCommit = false; throw new Error("SYNTHETIC_LOST_COMMIT_RESPONSE"); }
    return results;
  }
  const migration = await readFile(new URL("../../migrations/0004_account_telemetry_v2.sql", import.meta.url), "utf8");
  // This parser accepts only the fixed CREATE TABLE/TRIGGER migration grammar above.
  const schema = migration.match(/CREATE (?:TABLE[\s\S]*?\) WITHOUT ROWID;|TRIGGER[\s\S]*?END;)/gu) ?? [];
  check(schema.length > 0 && schema.reduce((rest, sql) => rest.replace(sql, ""), migration).trim() === "");
  await send({ schema: [...schema, "CREATE TABLE telemetry_fault_test (n INTEGER CHECK(n > 0))"] });
  return { db: { prepare, batch } as unknown as D1Database, metrics, faults, close: () => runtime.dispose() };
}
```

### Wire tests

```ts file:apps/execution-edge/test/telemetry-wire-v2.test.ts
import { describe, expect, it } from "vitest";
import { canonicalStringify } from "../src/canonical";
import { parseTelemetryV2, responseBytesV2, validateResponseV2, boundedBody } from "../src/telemetry-wire-v2";
import { canonicalInput, list, integer } from "../src/telemetry-schema-v2";
import { NOW, START, dealFixture, fixture, positionFixture, signFixture, unsignedFixture } from "./support/telemetry-fixture-v2";
const bytes = (text: string) => new TextEncoder().encode(text);
describe("telemetry wire v2", () => {
  it("retains uint64 tickets, broker symbol suffixes and precise decimals", async () => {
    const raw = unsignedFixture(); raw.exposure.positions = [positionFixture()]; raw.exposure.position_count = 1;
    const result = await parseTelemetryV2(await signFixture(raw));
    expect(result.exposure.positions[0]?.ticket).toBe("18446744073709551615");
    expect(result.account.balance.value).toEqual({ value: "10000.00", scale: 2 });
  });
  it.each([
    (v: any) => { v.command = { type: "OPEN" }; },
    (v: any) => { v.identity.account_login = "12345678"; },
    (v: any) => { v.account.balance = { value: null, reason: null }; },
    (v: any) => { v.account.balance.value = { value: "1e4", scale: 2 }; },
    (v: any) => { v.account.balance.value.scale = 3; },
    (v: any) => { v.exposure.positions = [positionFixture()]; },
    (v: any) => { v.exposure.positions = Array.from({ length: 129 }, positionFixture); v.exposure.position_count = 129; },
    (v: any) => { v.exposure.status = "CAPTURE_FAILED"; v.exposure.positions = [positionFixture()]; },
    (v: any) => { v.events = Array.from({ length: 33 }, (_, i) => dealFixture(i + 1)); },
    (v: any) => { v.registration.boundary.started_at_broker_msc += 1; },
    (v: any) => { v.diagnostics.last_accepted_request_sequence = 9; },
    (v: any) => { v.collection.scan_finished = true; v.collection.scan_through_broker_msc = null; },
  ])("rejects malformed or authority-bearing fields %#", async mutate => {
    const raw = unsignedFixture(); mutate(raw); await expect(parseTelemetryV2(await signFixture(raw))).rejects.toThrow();
  });
  it("rejects pre-start deals and excludes only known IDs within the start second", async () => {
    const raw = unsignedFixture(1, 0, [dealFixture()]); raw.events[0].record.broker_time_msc = START * 1000 - 1;
    await expect(parseTelemetryV2(await signFixture(raw))).rejects.toThrow("TELEMETRY_BEFORE_TRACKING");
    raw.events[0].record.broker_time_msc = START * 1000 + 999; raw.registration.boundary.excluded_boundary_deal_ids = ["1"];
    await expect(parseTelemetryV2(await signFixture(raw))).rejects.toThrow("TELEMETRY_BEFORE_TRACKING");
    raw.events[0].record.deal_id = "2"; await expect(parseTelemetryV2(await signFixture(raw))).resolves.toBeDefined();
  });
  it("rejects noncanonical JSON, duplicate keys, bad UTF8, deep values and sparse lists", () => {
    for (const raw of ['{"a":1,"a":1}', ' {"a":1}', '{"a":1e0}', '\ufeff{}', '['.repeat(18) + '0' + ']'.repeat(18)]) expect(() => canonicalInput(bytes(raw))).toThrow();
    expect(() => canonicalInput(new Uint8Array([255]))).toThrow();
    expect(() => list(integer(), 32)(Array(1))).toThrow();
  });
  it("rejects oversized streaming body without trusting Content-Length", async () => {
    const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array(262145)); c.close(); } });
    await expect(boundedBody(new Response(stream))).rejects.toThrow("TELEMETRY_TOO_LARGE");
  });
  it("checks event content hash independently of the envelope hash", async () => {
    const request = await fixture(1, 0, [dealFixture()]); const raw: any = structuredClone(request);
    raw.events[0].record_sha256 = "f".repeat(64);
    const { body_sha256: _, ...body } = raw;
    const { sha256Hex } = await import("../src/canonical");
    await expect(parseTelemetryV2(bytes(canonicalStringify({ ...body, body_sha256: await sha256Hex(canonicalStringify(body)) })))).rejects.toThrow();
  });
  it("accepts only correlated command-free response bytes with exact ACK", async () => {
    const request = await fixture(1, 0, [dealFixture()]); const valid = await responseBytesV2(request, 1, NOW);
    await expect(validateResponseV2(bytes(valid), request)).resolves.toBe(valid);
    for (const change of [{ command: {} }, { mode: "LIVE" }, { request_sequence: 2 }, { acknowledged_event_sequence: 2 }, { response_body_sha256: "e".repeat(64) }, { identity: { ...request.identity, tracking_id: "other" } }]) {
      await expect(validateResponseV2(bytes(canonicalStringify({ ...JSON.parse(valid), ...change })), request)).rejects.toThrow();
    }
  });
});
```

### Projection tests

```ts file:apps/execution-edge/test/telemetry-journal-projection-v2.test.ts
import { expect, it } from "vitest";
import { projectDealV2 } from "../src/telemetry-journal-projection-v2";
import { parseTelemetryV2, type DealV2 } from "../src/telemetry-wire-v2";
import { dealFixture, f, missing, positionFixture, r, signFixture, unsignedFixture } from "./support/telemetry-fixture-v2";
it("uses each signed amount once and never invents lifetime risk/strategy", async () => {
  const raw = unsignedFixture(1, 0, [dealFixture()]); raw.registration.baseline.positions = [positionFixture()]; raw.registration.baseline.position_count = 1;
  const request = await parseTelemetryV2(await signFixture(raw));
  expect(projectDealV2(request.events[0]!.record as DealV2, request.registration)).toMatchObject({
    net_recorded: f("9.70"), opened_before_tracking: true, lifetime_complete: false, initial_risk: null,
    strategy: "UNKNOWN", opening_origin: "UNKNOWN", exit_reason: "TP", closing_volume: f("0.10"),
  });
});
it("preserves missing amounts, standalone activity, EA attribution and reversal uncertainty", async () => {
  const raw = unsignedFixture(1, 0, [dealFixture()]);
  raw.events[0].record.profit = missing();
  let request = await parseTelemetryV2(await signFixture(raw));
  expect(projectDealV2(request.events[0]!.record as DealV2, request.registration).net_recorded).toBeNull();
  Object.assign(raw.events[0].record, { type: "COMMISSION", entry: "NONE", profit: r("0.00"), commission: r("-5.00"), swap: r("0.00"), fee: r("0.00"), position_id: null, order_id: null, symbol: null, volume: null });
  request = await parseTelemetryV2(await signFixture(raw));
  expect(projectDealV2(request.events[0]!.record as DealV2, request.registration)).toMatchObject({ category: "ACCOUNT_ACTIVITY", net_recorded: f("-5.00"), opening_origin: "UNKNOWN" });
  raw.events[0] = dealFixture(); Object.assign(raw.events[0].record, { entry: "IN", reason: "EXPERT" });
  request = await parseTelemetryV2(await signFixture(raw));
  expect(projectDealV2(request.events[0]!.record as DealV2, request.registration).opening_origin).toBe("EA_OR_SCRIPT");
  raw.events[0].record.entry = "INOUT";
  request = await parseTelemetryV2(await signFixture(raw));
  expect(projectDealV2(request.events[0]!.record as DealV2, request.registration)).toMatchObject({ opening_volume: null, closing_volume: null, portion_cost_allocation: "UNKNOWN" });
  raw.events[0].record.reversal_split = { source: "RECONSTRUCTED_POSITION_VOLUME", closing_volume: f("0.04"), opening_volume: f("0.06") };
  request = await parseTelemetryV2(await signFixture(raw));
  expect(projectDealV2(request.events[0]!.record as DealV2, request.registration)).toMatchObject({ opening_volume: f("0.06"), closing_volume: f("0.04"), net_recorded: f("9.70"), portion_cost_allocation: "UNKNOWN" });
});
```

### Repository failure/recovery tests

```ts file:apps/execution-edge/test/telemetry-repository-v2.test.ts
import { afterEach, beforeEach, expect, it } from "vitest";
import { acceptTelemetryV2, scopeV2, statementsV2 } from "../src/telemetry-repository-v2";
import { parseTelemetryV2, responseBytesV2 } from "../src/telemetry-wire-v2";
import { localD1V2 } from "./support/telemetry-d1-v2";
import { NOW, dealFixture, f, fixture, positionFixture, r, signFixture, unsignedFixture } from "./support/telemetry-fixture-v2";
let local: Awaited<ReturnType<typeof localD1V2>>;
beforeEach(async () => { local = await localD1V2(); });
afterEach(async () => { await local?.close(); });
it("acknowledges only a durable contiguous journal and exact retry never refreshes/writes", async () => {
  const request = await fixture(1, 0, [dealFixture()]);
  const first = await acceptTelemetryV2(local.db, request, NOW); const writes = local.metrics.writes;
  expect(JSON.parse(first)).toMatchObject({ acknowledged_event_sequence: 1, accepted_at_utc_seconds: NOW });
  expect(await acceptTelemetryV2(local.db, request, NOW + 500)).toBe(first);
  expect(local.metrics.writes).toBe(writes);
  const changed = unsignedFixture(1, 0, [dealFixture()]); changed.account.balance = r("10001.00");
  await expect(acceptTelemetryV2(local.db, await parseTelemetryV2(await signFixture(changed)), NOW)).rejects.toThrow("REPLAY_CONFLICT");
  expect(local.metrics.writes).toBe(writes);
});
it.each([0, 1, 2, 3, 4])("rolls back all writes when a constraint fails at batch boundary %s", async index => {
  local.faults.beforeStatement = index;
  await expect(acceptTelemetryV2(local.db, await fixture(1, 0, [dealFixture()]), NOW)).rejects.toThrow();
  for (const table of ["telemetry_session_v2", "telemetry_receipt_v2", "telemetry_event_v2", "telemetry_deal_current_v2"]) {
    expect(await local.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first("n")).toBe(0);
  }
  local.faults.beforeStatement = -1;
  expect(JSON.parse(await acceptTelemetryV2(local.db, await fixture(1, 0, [dealFixture()]), NOW)).acknowledged_event_sequence).toBe(1);
});
it("recovers committed response loss and does not count replayed P/L", async () => {
  local.faults.afterCommit = true;
  const request = await fixture(1, 0, [dealFixture()]);
  const first = await acceptTelemetryV2(local.db, request, NOW);
  expect(await acceptTelemetryV2(local.db, request, NOW + 100)).toBe(first);
  expect(await local.db.prepare("SELECT COUNT(*) AS n FROM telemetry_event_v2").first("n")).toBe(1);
});
it("rejects stale new requests, event gaps, missing client ACK and registration resets", async () => {
  await expect(acceptTelemetryV2(local.db, await fixture(), NOW + 31)).rejects.toThrow("STALE_ENVELOPE");
  await acceptTelemetryV2(local.db, await fixture(1, 0, [dealFixture()]), NOW);
  await expect(acceptTelemetryV2(local.db, await fixture(2, 1, [dealFixture(3)]), NOW)).rejects.toThrow("EVENT_SEQUENCE_INVALID");
  await expect(acceptTelemetryV2(local.db, await fixture(2, 0, []), NOW)).rejects.toThrow("EVENT_SEQUENCE_INVALID");
  for (const mutate of [
    (v: any) => { v.identity.tracking_id = "reset"; v.registration.boundary.tracking_id = "reset"; },
    (v: any) => { v.registration.display.currency = "EUR"; },
    (v: any) => { v.registration.baseline.position_count = 1; v.registration.baseline.positions = [positionFixture()]; },
  ]) { const raw = unsignedFixture(2, 1); mutate(raw); await expect(acceptTelemetryV2(local.db, await parseTelemetryV2(await signFixture(raw)), NOW)).rejects.toThrow("IDENTITY_MISMATCH"); }
});
it("replaces a corrected/cancelled current deal while retaining its original event", async () => {
  const original = await fixture(1, 0, [dealFixture()]); await acceptTelemetryV2(local.db, original, NOW);
  const revision = dealFixture(2); Object.assign(revision.record, { deal_id: "1", revision: 2,
    previous_record_sha256: original.events[0]!.record_sha256, type: "BUY_CANCELED", profit: r("0.00"), commission: r("0.00"), swap: r("0.00"), fee: r("0.00") });
  await acceptTelemetryV2(local.db, await fixture(2, 1, [revision]), NOW);
  expect(await local.db.prepare("SELECT COUNT(*) AS n FROM telemetry_event_v2").first("n")).toBe(2);
  const row = await local.db.prepare("SELECT e.projection_json FROM telemetry_deal_current_v2 c JOIN telemetry_event_v2 e ON e.scope=c.scope AND e.sequence=c.sequence WHERE c.scope=? AND c.deal_id=?").bind(await scopeV2(original), "1").first<{ projection_json: string }>();
  expect(JSON.parse(row!.projection_json)).toMatchObject({ cancelled: true, net_recorded: f("0.00") });
  const invalid = dealFixture(3); invalid.record.deal_id = "1";
  await expect(acceptTelemetryV2(local.db, await fixture(3, 2, [invalid]), NOW)).rejects.toThrow();
  expect(await local.db.prepare("SELECT last_event_sequence FROM telemetry_session_v2").first("last_event_sequence")).toBe(2);
});
it("retains last-complete financial/exposure snapshots after a failed empty attempt", async () => {
  const initial = unsignedFixture(); initial.exposure.positions = [positionFixture()]; initial.exposure.position_count = 1;
  await acceptTelemetryV2(local.db, await parseTelemetryV2(await signFixture(initial)), NOW);
  const next = unsignedFixture(2); next.exposure.status = "CAPTURE_FAILED"; next.exposure.position_count = null;
  next.collection.record_gap = "HISTORY_UNAVAILABLE";
  await acceptTelemetryV2(local.db, await parseTelemetryV2(await signFixture(next)), NOW);
  const row = await local.db.prepare("SELECT exposure_json,latest_json FROM telemetry_session_v2").first<{ exposure_json: string; latest_json: string }>();
  expect(JSON.parse(row!.exposure_json).positions).toHaveLength(1);
  expect(JSON.parse(row!.latest_json)).toMatchObject({ exposure_attempt: { status: "CAPTURE_FAILED" }, coverage: { state: "DATA_MISSING", through_broker_msc: null } });
});
it("database CAS rejects a stale independently prepared acceptance transaction", async () => {
  const a = await fixture(); const scope = await scopeV2(a); const response = await responseBytesV2(a, 0, NOW);
  const first = statementsV2(local.db, a, scope, 0, 0, NOW, response);
  const second = statementsV2(local.db, a, scope, 0, 0, NOW, response);
  const outcomes = await Promise.allSettled([local.db.batch(first), local.db.batch(second)]);
  expect(outcomes.filter(o => o.status === "fulfilled")).toHaveLength(1);
  expect(await local.db.prepare("SELECT COUNT(*) AS n FROM telemetry_receipt_v2").first("n")).toBe(1);
  expect(await acceptTelemetryV2(local.db, a, NOW + 100)).toBe(response);
});
```

### Public pipeline and queue tests

These invoke the actual exported Worker handler and actual coordinator class with a synthetic pre-existing v1 pin; database SQL still executes in local workerd. The namespace/storage shim is routing and v1 seed state only, not a mock of v2 persistence. No real bearer value appears anywhere.

```ts file:apps/execution-edge/test/telemetry-sync-v2.test.ts
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import worker, { AccountCoordinator, type Env } from "../src/index";
import { canonicalStringify, sha256Hex } from "../src/canonical";
import { TelemetryQueueV2 } from "../src/telemetry-queue-v2";
import { localD1V2 } from "./support/telemetry-d1-v2";
import { NOW, dealFixture, signFixture, unsignedFixture } from "./support/telemetry-fixture-v2";
let local: Awaited<ReturnType<typeof localD1V2>>;
let env: Env; let pin: Record<string, unknown> | undefined;
beforeEach(async () => {
  vi.spyOn(Date, "now").mockReturnValue(NOW * 1000);
  local = await localD1V2();
  pin = { installation_id: "synthetic-installation", account_profile_sha256: "a".repeat(64),
    account_fingerprint_sha256: "b".repeat(64), safety_epoch: 7, last_accepted_request_sequence: 42 };
  env = { EXECUTION_DB: local.db, CANDIDATE_INBOX_ENABLED: "false", AGENT_SYNC_ENABLED: "true",
    EXECUTION_AUTHORITY_ENABLED: "false", EXECUTION_MODE_CEILING: "DRY_RUN", ROUTING_MANIFEST_SHA256: "INERT_NOT_CONFIGURED",
    AGENT_SYNC_SHARED_SECRET_SHA256: await sha256Hex("synthetic-only-not-a-real-credential") } as Env;
  const state = { storage: { get: async (key: string) => key === "sync_state_v1" ? pin : undefined,
    put: async () => { throw new Error("V2_MUST_NOT_WRITE_V1_STATE"); } } } as unknown as DurableObjectState;
  const coordinator = new AccountCoordinator(state, env);
  env.ACCOUNT_COORDINATOR = { idFromName: (name: string) => { expect(name).toBe("synthetic-account"); return name; },
    get: () => ({ fetch: (request: Request) => coordinator.fetch(request) }) } as unknown as DurableObjectNamespace;
});
afterEach(async () => { vi.restoreAllMocks(); await local?.close(); });
async function post(raw = unsignedFixture(), authorization = "Bearer synthetic-only-not-a-real-credential") {
  return worker.fetch!(new Request("https://execution-edge.example/api/v2/agent/sync", { method: "POST",
    headers: { "content-type": "application/json", authorization }, body: new TextDecoder().decode(await signFixture(raw)) }), env, {} as ExecutionContext);
}
it("runs command-free POST through the existing Worker/coordinator and durable D1", async () => {
  const raw = unsignedFixture(1, 0, [dealFixture()]); const response = await post(raw);
  expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
  const body = await response.text(); expect(JSON.parse(body)).toMatchObject({ mode: "DRY_RUN", command: null, acknowledged_event_sequence: 1 });
  const writes = local.metrics.writes; vi.mocked(Date.now).mockReturnValue((NOW + 100) * 1000);
  expect(await (await post(raw)).text()).toBe(body); expect(local.metrics.writes).toBe(writes);
  expect(pin?.last_accepted_request_sequence).toBe(42);
});
it("rejects bearer/identity/missing pin and unsafe config before any v2 acceptance", async () => {
  expect((await post(undefined, "Bearer wrong")).status).toBe(401); expect(local.metrics.queries).toBe(0);
  pin = undefined; expect((await post()).status).toBe(409); expect(local.metrics.writes).toBe(0);
  pin = { installation_id: "another-installation", last_accepted_request_sequence: 42 };
  expect((await post()).status).toBe(409); expect(local.metrics.writes).toBe(0);
  env = { ...env, EXECUTION_AUTHORITY_ENABLED: "true" } as unknown as Env;
  expect(await (await post()).json()).toEqual({ error: "UNSAFE_CONFIGURATION", mode: "DRY_RUN", command: null });
});
it("rejects authority-bearing coordinator replies even with HTTP 200", async () => {
  env.ACCOUNT_COORDINATOR = { idFromName: () => "test", get: () => ({ fetch: async () => new Response(canonicalStringify({ mode: "DRY_RUN", command: { type: "OPEN" } })) }) } as unknown as DurableObjectNamespace;
  expect(await (await post()).json()).toEqual({ error: "TELEMETRY_UNAVAILABLE", mode: "DRY_RUN", command: null });
});
it("serializes across awaits, bounds the queue, and recovers after rejection", async () => {
  const queue = new TelemetryQueueV2(); let release!: () => void; const order: number[] = [];
  const pending = new Promise<void>(resolve => { release = resolve; });
  const first = queue.run(async () => { order.push(1); await pending; throw new Error("synthetic"); }).catch(() => "rejected");
  const others = Array.from({ length: 7 }, (_, i) => queue.run(async () => { order.push(i + 2); return i; }));
  await expect(queue.run(async () => 9)).rejects.toThrow("TELEMETRY_BUSY");
  await Promise.resolve(); expect(order).toEqual([1]); release(); await first; await Promise.all(others);
  expect(order).toEqual([1, 2, 3, 4, 5, 6, 7, 8]); await expect(queue.run(async () => 10)).resolves.toBe(10);
});
```

### Budget and index tests

This is the **telemetry component** budget, not an account-wide cost promise. Counts below are conservative acceptance thresholds to investigate if exceeded; do not increase them simply to make tests pass. An actual 5,760-acceptance run must retain all receipts. Reports must distinguish local D1 metadata, local wall time, production CPU (unmeasured), and existing account usage (unmeasured).

```ts file:apps/execution-edge/test/telemetry-budget-v2.test.ts
import { expect, it } from "vitest";
import { acceptTelemetryV2, JOURNAL_SQL_V2, scopeV2 } from "../src/telemetry-repository-v2";
import { localD1V2 } from "./support/telemetry-d1-v2";
import { NOW, dealFixture, fixture } from "./support/telemetry-fixture-v2";
it("measures a full idle day, an event burst, retries and journal index access", async () => {
  const local = await localD1V2();
  try {
    for (let n = 1; n <= 5760; n += 1) await acceptTelemetryV2(local.db, await fixture(n), NOW);
    const idle = { ...local.metrics };
    expect(idle.writes).toBeGreaterThan(0); expect(idle.writes).toBeLessThan(5760 * 12);
    expect(idle.reads).toBeLessThan(5760 * 80); expect(idle.maxBatch).toBeLessThanOrEqual(4);
    expect(await local.db.prepare("SELECT COUNT(*) AS n FROM telemetry_receipt_v2").first("n")).toBe(5760);
    const burst = await fixture(5761, 0, Array.from({ length: 32 }, (_, i) => dealFixture(i + 1)));
    const before = { ...local.metrics }; await acceptTelemetryV2(local.db, burst, NOW);
    const burstWrites = local.metrics.writes - before.writes; const burstQueries = local.metrics.queries - before.queries;
    expect(burstWrites).toBeLessThan(400); expect(burstQueries).toBeLessThan(20);
    const writes = local.metrics.writes;
    for (let retry = 0; retry < 100; retry += 1) await acceptTelemetryV2(local.db, burst, NOW + 1000);
    expect(local.metrics.writes).toBe(writes);
    const plan = await local.db.prepare(`EXPLAIN QUERY PLAN ${JOURNAL_SQL_V2}`).bind(await scopeV2(burst), Number.MAX_SAFE_INTEGER).all();
    const detail = JSON.stringify(plan.results);
    expect(detail).toMatch(/SEARCH/iu); expect(detail).not.toMatch(/SCAN telemetry_event_v2|TEMP B-TREE/iu);
    console.info("telemetry_budget_v2", { idle, burstWrites, burstQueries, retries: 100, retryWrites: 0, allocatedDatabaseBytes: local.metrics.allocatedBytes });
  } finally { await local.close(); }
}, 300_000);
```

- [ ] Run the fast tests with `npm --prefix apps/execution-edge test -- test/telemetry-wire-v2.test.ts test/telemetry-journal-projection-v2.test.ts test/telemetry-repository-v2.test.ts test/telemetry-sync-v2.test.ts`.
- [ ] Run `npm --prefix apps/execution-edge test -- test/telemetry-budget-v2.test.ts` as a yielding terminal process. Continue reporting progress; a five-minute test timeout is not permission to block communication for five minutes.
- [ ] Append measured totals and actual runtime versions to the Stage 2 audit. Do not state the full idle-day or full receiver suite passed on the basis of the smaller planning probe.

## Task 8 — golden fixture, final verification and local handoff

- [ ] Add this test file first. It fails until the checked-in synthetic fixture exists.

```ts file:apps/execution-edge/test/telemetry-golden-v2.test.ts
import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { canonicalStringify, sha256Hex } from "../src/canonical";
import { responseBytesV2 } from "../src/telemetry-wire-v2";
import { NOW, dealFixture, fixture } from "./support/telemetry-fixture-v2";
it("matches the cross-language canonical request and response fixture byte-for-byte", async () => {
  const request = await fixture(1, 0, [dealFixture()]); const requestBytes = canonicalStringify(request);
  const responseBytes = await responseBytesV2(request, 1, NOW);
  const expected = { fixture_version: "TelemetryGoldenV2", synthetic: true, request_bytes: requestBytes,
    request_bytes_sha256: await sha256Hex(requestBytes), response_bytes: responseBytes, response_bytes_sha256: await sha256Hex(responseBytes) };
  const saved = JSON.parse(await readFile(new URL("../../../mt5/TradeOpsAgent/fixtures/agent-sync-v2.json", import.meta.url), "utf8"));
  expect(saved).toEqual(expected);
});
```

- [ ] Add the exact JSON in Appendix A using `apply_patch` to `mt5/TradeOpsAgent/fixtures/agent-sync-v2.json`. It was computed from these fixture helpers, not hand-invented hashes. Do not embed credentials or local configuration. Preserve UTF-8 canonical request/response strings as stored.
- [ ] Run that test; expected PASS. Include empty-event and multi-event boundary cases in the later MQL5 Stage 3 tests, using this contract rather than altering v1 response parsing.
- [ ] Run the final commands from the backend root:

```sh
npm --prefix apps/execution-edge test
npm --prefix apps/execution-edge run typecheck
npm --prefix apps/execution-edge run lint
node scripts/verify-mt5-dry-run-boundary.mjs
git diff --check
git status --short
```

Expected: all tests/checks pass, including the original 335 tests; only the mapped v2 files, exact index/coordinator integration, package test dependency/lockfile and synthetic fixture differ. No health-service source/manifest, EA implementation/configuration, TradingView, frontend, v1 parser or old SQL migration changes. Inspect any unrelated changes and preserve them. Do not regenerate the boundary manifest.

- [ ] Add a local audit at `docs/audits/2026-09-03-mt5-telemetry-receiver.md` in the documentation worktree: source revision, exact changed paths, RED/GREEN results, real-D1 rollback/CAS results, idle/burst/retry/query-plan metrics, golden hashes, and all unverified deployment/EA facts. Mark Stage 2 complete in the roadmap **only after its executable acceptance gates pass**.
- [ ] Request code/spec/safety review using the execution skill's procedure. Resolve findings and rerun affected tests. Keep all code uncommitted.
- [ ] Stop at the local handoff. Next is Stage 3's upgraded read-only EA plan. No remote migration, Worker deployment, health deployment, EX5 installation or broker test is implied by finishing Stage 2.

## Coverage/self-review checklist

| Requirement | Concrete task/gate |
| --- | --- |
| Exact numbers, large IDs, account-wide symbols, null reasons | 1–2; wire tests |
| Immutable start, known boundary-second exclusions, initial exposure | 2; registration equality and schema trigger in 4 |
| Broker identity and configured/reported version distinction | 2/5; existing v1 pin comparison; no binary attestation claim |
| Partial fills, signed costs, separate balance activity | 3; immutable per-deal facts and exact contribution tests |
| Reversals, baseline positions, unknown attribution/lifetime | 3; explicit unknown allocation and baseline labels |
| Corrections/cancellations/event conflicts | 4; revision trigger, unique IDs, current pointer and revision test |
| Actual transaction rollback/no ACK before persistence | 4/7; D1 constraint injection at every batch boundary |
| Concurrent writers, lost response and exact retry | 4/5/7; CAS, queue, stored bytes/original acceptance |
| Failed snapshot cannot erase last complete exposure | 2/4/7; status schema and COALESCE/current snapshot test |
| Truthful coverage independent of heartbeat | 2/4; Stage 1 derivation with committed ACK |
| Free-plan query/write/storage budget | 7; bounded SQL, actual 5,760/32/100 workload and query plans |
| Old EA, source safety, no frontend/private-read drift | 6/8; unchanged v1 tests, boundary verifier and diff audit |
| Cross-language response contract | 8; canonical golden fixture; MQL5 implementation reserved for Stage 3 |

The plan's test support shims do not validate real Windows capture, real Access isolation, deployed CPU/latency or account-wide quotas. Those remain explicit later-stage gates. A reporting receipt is not a trade fill and this 15-second reporting path is not the low-latency execution design.

## Planning validation status

Plan preparation changes documentation only. The proposed source/test snippets typecheck in a virtual compiler host; selected proposed receiver paths were executed in a disposable, in-memory bundle against local D1. This is planning evidence, not a deployed or committed implementation. Detailed outcomes and limitations are in the accompanying planning audit. Implementation checkboxes stay unchecked until the task-by-task RED/GREEN execution and full regression suite pass.

## Appendix A — generated synthetic golden fixture

```json file:mt5/TradeOpsAgent/fixtures/agent-sync-v2.json
{
  "fixture_version": "TelemetryGoldenV2",
  "synthetic": true,
  "request_bytes": "{\"account\":{\"balance\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"10000.00\"}},\"equity\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"10000.00\"}},\"margin_free\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"10000.00\"}},\"margin_level\":{\"reason\":\"NOT_APPLICABLE\",\"value\":null},\"margin_used\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"0.00\"}},\"observed_at_broker_msc\":1800000010000,\"observed_at_utc_seconds\":1800000010,\"status\":\"COMPLETE\"},\"body_sha256\":\"a83ce515fda782fb04131242fe9800ebe2a7162cdd3b1c24ee78baac9971ae9a\",\"collection\":{\"observation_gap\":false,\"produced_events\":1,\"record_gap\":null,\"scan_finished\":true,\"scan_through_broker_msc\":1800000010000},\"diagnostics\":{\"account_trade_permission\":\"DENIED\",\"algo_trading_permission\":\"DENIED\",\"ea_release\":\"synthetic-v2\",\"last_accepted_request_sequence\":0,\"last_error\":null,\"last_successful_upload_utc_seconds\":null,\"local_unsent_events\":1,\"observed_at_utc_seconds\":1800000010,\"reported_manifest_sha256\":null,\"reported_source_sha256\":null,\"source_symbol\":\"EURUSD\",\"terminal_build\":6140,\"terminal_connection_state\":\"CONNECTED\",\"terminal_trade_permission\":\"DENIED\"},\"events\":[{\"event_id\":\"event-1\",\"observed_at_utc_seconds\":1800000010,\"record\":{\"broker_time_msc\":1800000005000,\"commission\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.20\"}},\"deal_id\":\"1\",\"entry\":\"OUT\",\"fee\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.05\"}},\"kind\":\"DEAL\",\"order_id\":\"700\",\"position_id\":\"9007199254740993\",\"previous_record_sha256\":null,\"price\":{\"reason\":null,\"value\":{\"scale\":5,\"value\":\"1.10000\"}},\"profit\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"10.00\"}},\"protection_source\":\"BROKER_DEAL\",\"reason\":\"TP\",\"reversal_split\":null,\"revision\":1,\"sl\":{\"reason\":\"UNAVAILABLE\",\"value\":null},\"swap\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.05\"}},\"symbol\":\"EURUSD.a\",\"tp\":{\"reason\":null,\"value\":{\"scale\":5,\"value\":\"1.10000\"}},\"type\":\"BUY\",\"volume\":{\"scale\":2,\"value\":\"0.10\"}},\"record_sha256\":\"c9661c0379aa6bbdfae0c540b61ab000ebbcb485f7f24ca8df136311471050cb\",\"sequence\":1}],\"exposure\":{\"observed_at_broker_msc\":1800000010000,\"observed_at_utc_seconds\":1800000010,\"order_count\":0,\"orders\":[],\"position_count\":0,\"positions\":[],\"status\":\"COMPLETE\"},\"identity\":{\"account_fingerprint_sha256\":\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\"account_id\":\"synthetic-account\",\"account_profile_sha256\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"installation_id\":\"synthetic-installation\",\"safety_epoch\":7,\"tracking_boundary_sha256\":\"d44d100c6c5e0c657976c49a3e50bc1b2a5862584b6e16e7a1e2f5dffc947716\",\"tracking_id\":\"synthetic-tracking\"},\"last_acknowledged_event_sequence\":0,\"registration\":{\"baseline\":{\"observed_at_broker_msc\":1800000000000,\"observed_at_utc_seconds\":1800000000,\"order_count\":0,\"orders\":[],\"position_count\":0,\"positions\":[],\"status\":\"COMPLETE\"},\"boundary\":{\"account_fingerprint_sha256\":\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\"excluded_boundary_deal_ids\":[],\"initialized_at_utc_seconds\":1800000000,\"started_at_broker_msc\":1800000000000,\"tracking_id\":\"synthetic-tracking\"},\"display\":{\"account_mode\":\"DEMO\",\"company\":\"Synthetic Broker\",\"currency\":\"USD\",\"currency_scale\":2,\"login_last4\":\"0001\",\"margin_mode\":\"RETAIL_HEDGING\",\"server\":\"Synthetic-Demo\"}},\"request_sequence\":1,\"schema_version\":\"AgentSyncRequestV2\",\"sent_at_utc_seconds\":1800000010}",
  "request_bytes_sha256": "c9c0203007d5f7b9a6ff5bdddcbeda06032d1d37ccc02d20da2b39cb4365b9cb",
  "response_bytes": "{\"accepted_at_utc_seconds\":1800000010,\"acknowledged_event_sequence\":1,\"command\":null,\"coverage\":{\"observation_gap\":false,\"pending_events\":0,\"reason\":null,\"state\":\"UP_TO_DATE\",\"through_broker_msc\":1800000010000},\"identity\":{\"account_fingerprint_sha256\":\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\"account_id\":\"synthetic-account\",\"account_profile_sha256\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"installation_id\":\"synthetic-installation\",\"safety_epoch\":7,\"tracking_boundary_sha256\":\"d44d100c6c5e0c657976c49a3e50bc1b2a5862584b6e16e7a1e2f5dffc947716\",\"tracking_id\":\"synthetic-tracking\"},\"mode\":\"DRY_RUN\",\"request_body_sha256\":\"a83ce515fda782fb04131242fe9800ebe2a7162cdd3b1c24ee78baac9971ae9a\",\"request_sequence\":1,\"response_body_sha256\":\"e2d0abaf7aa0254b6bf0e7069fe6e76c82b19e4990bf11eff71ad3b6c4ba9126\",\"schema_version\":\"AgentSyncResponseV2\"}",
  "response_bytes_sha256": "53629c12f1cc367b6b1b0ddf3aee0012229411acecea41d1e702df51c311fa11"
}
```
