# MT5 Telemetry Invariants Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking. Ask for the execution approach before dispatching agents.

**Goal:** Establish tested, pure reporting invariants for exact values, forward-only history selection, journal completeness, and idempotent request admission without changing the running v1 path.

**Architecture:** Add four small TypeScript modules to the existing execution-edge package, each with a complete independent test file. These modules are domain helpers, not a wire parser, database repository, network endpoint, or EA implementation. Later delivery stages consume their verified behavior.

**Tech Stack:** Existing TypeScript 5.9, Vitest 4, ES2022 BigInt, and the existing canonical JSON helper. No dependency changes.

---

## Scope and working directory

Execute code tasks only in:

/Users/ameeramer/.config/superpowers/worktrees/prop-trading-system/mt5-stale-payload-recovery

Inspected HEAD: 8a801423bc19b3bb27c8e24f45d2800a9deb6881. Re-check HEAD, status, and applicable AGENTS.md instructions before execution. Preserve unrelated changes if this has moved. Request filesystem write permission for the precise source/test directories before editing; planning permission only covers the documentation worktree.

Approved design:

/Users/ameeramer/.config/superpowers/worktrees/prop-trading-system/tradeops-dashboard-migration/docs/superpowers/specs/2026-09-03-mt5-account-telemetry-journal-design.md

Full delivery map:

/Users/ameeramer/.config/superpowers/worktrees/prop-trading-system/tradeops-dashboard-migration/docs/superpowers/plans/2026-09-03-mt5-telemetry-delivery-roadmap.md

This stage is deliberately not the whole feature. It must not alter the EA, database, Worker entry point, v1 contract, private read service, integrity manifest, bindings, secrets, or frontend. Keep changes local/uncommitted under the approved handoff boundary; use review checkpoints instead of commit steps.

Commands below run from the backend worktree root. The root has no package.json; always use the package prefix. Existing installed Node is v26.3.1 and both packages permit Node >=22 and <27. Do not install or upgrade dependencies as an incidental step.

## File structure

| Create under apps/execution-edge/ | Responsibility |
| --- | --- |
| src/telemetry-values-v2.ts | Bounded decimal strings, exact sums, 64-bit string IDs, safe counters/digests/identifiers |
| test/telemetry-values-v2.test.ts | Exact arithmetic, overflow, invalid inputs, large IDs |
| src/telemetry-cutover-v2.ts | Validated immutable boundary and boundary-second exclusion rule |
| test/telemetry-cutover-v2.test.ts | No backfill, same-second behavior, immutability and identity stability |
| src/telemetry-coverage-v2.ts | Truthful coverage state independent of heartbeat freshness |
| test/telemetry-coverage-v2.test.ts | No false “up to date,” gaps, incomplete scans and baseline state |
| src/telemetry-admission-v2.ts | Pure new/replay/conflict decision; never a persistence acknowledgement |
| test/telemetry-admission-v2.test.ts | Sequence/digest/identity conflicts, stale replay and gaps |

Reuse apps/execution-edge/src/canonical.ts without modifying it. Do not import these helpers into src/index.ts in this stage.

## Task 0: Baseline and safety boundary

- [x] Run these commands and record the actual outcomes before changing files:

~~~sh
git status --short
git rev-parse HEAD
npm --prefix apps/execution-edge test
npm --prefix apps/execution-edge run typecheck
node scripts/verify-mt5-dry-run-boundary.mjs
~~~

Expected: existing tests/typecheck pass and the verifier prints “MT5 dry-run boundary verification passed.” A failing pre-existing baseline is evidence to investigate, not permission to weaken the checker. Do not claim the old dashboard test count is the backend count.

- [x] Confirm that the four planned source files and four tests do not already exist. If they exist, read them and reconcile with this plan rather than overwrite unrelated work.

~~~sh
rg --files apps/execution-edge/src apps/execution-edge/test | rg 'telemetry-(values|cutover|coverage|admission)-v2'
~~~

Expected on the inspected revision: no matches (rg exit 1).

## Task 1: Exact values and identifiers

**Create:**

- /Users/ameeramer/.config/superpowers/worktrees/prop-trading-system/mt5-stale-payload-recovery/apps/execution-edge/src/telemetry-values-v2.ts
- /Users/ameeramer/.config/superpowers/worktrees/prop-trading-system/mt5-stale-payload-recovery/apps/execution-edge/test/telemetry-values-v2.test.ts

- [x] Write the complete failing test file:

~~~ts
import { describe, expect, it } from "vitest";
import {
  parseFixedV2, sumFixedV2, readTicketV2, readCounterV2,
  readDigestV2, readIdentifierV2,
} from "../src/telemetry-values-v2";

describe("telemetry exact values", () => {
  it("adds signed broker values without floating-point arithmetic", () => {
    const values = ["100.00", "-2.50", "-0.25", "-0.10"].map(
      (value) => parseFixedV2(value, 2),
    );
    expect(sumFixedV2(values, 2)).toEqual({ value: "97.15", scale: 2 });
    expect(sumFixedV2([], 3)).toEqual({ value: "0.000", scale: 3 });
    expect(sumFixedV2([parseFixedV2("-0.10", 2), parseFixedV2("0.10", 2)], 2))
      .toEqual({ value: "0.00", scale: 2 });
  });
  it("preserves amounts larger than a JavaScript-safe integer", () => {
    const large = parseFixedV2("9007199254740993.01", 2);
    expect(sumFixedV2([large, parseFixedV2("0.01", 2)], 2).value)
      .toBe("9007199254740993.02");
  });
  it.each([null, 1.2, "1e3", "01.00", "+1.00", "-0.00", "1.0", "NaN"])(
    "rejects noncanonical decimal %s", (value) => {
      expect(() => parseFixedV2(value, 2)).toThrow("TELEMETRY_DECIMAL_INVALID");
    },
  );
  it("rejects unsupported precision, mixed scales and sum overflow", () => {
    expect(() => parseFixedV2("1", 17)).toThrow();
    expect(() => parseFixedV2("1", -1)).toThrow();
    expect(() => sumFixedV2([], 1000000000)).toThrow("TELEMETRY_DECIMAL_INVALID");
    expect(() => sumFixedV2([parseFixedV2("1", 0)], 2)).toThrow();
    expect(() => sumFixedV2([
      parseFixedV2("999999999999999999", 0), parseFixedV2("1", 0),
    ], 0)).toThrow("TELEMETRY_DECIMAL_INVALID");
  });
  it("accepts full unsigned 64-bit ticket text, not numeric tickets", () => {
    expect(readTicketV2("18446744073709551615")).toBe("18446744073709551615");
    for (const value of [0, 9007199254740992, "0", "01", "-1", "18446744073709551616"]) {
      expect(() => readTicketV2(value)).toThrow("TELEMETRY_TICKET_INVALID");
    }
  });
  it("checks small counters, binding digests and internal identifiers", () => {
    expect(readCounterV2(0)).toBe(0);
    expect(() => readCounterV2(0, 1)).toThrow();
    expect(() => readCounterV2(Number.MAX_SAFE_INTEGER + 1)).toThrow();
    expect(readDigestV2("a".repeat(64))).toBe("a".repeat(64));
    expect(() => readDigestV2("0".repeat(64))).toThrow();
    expect(() => readDigestV2("A".repeat(64))).toThrow();
    expect(readIdentifierV2("account-local-001")).toBe("account-local-001");
    expect(() => readIdentifierV2("private value\n")).toThrow();
  });
});
~~~

- [x] Run the RED check:

~~~sh
npm --prefix apps/execution-edge test -- test/telemetry-values-v2.test.ts
~~~

Expected: FAIL because the imported module does not exist, not because Vitest is missing.

- [x] Create the complete implementation file:

~~~ts
export type FixedDecimalV2 = Readonly<{ value: string; scale: number }>;

export function readCounterV2(value: unknown, minimum = 0): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) {
    throw new Error("TELEMETRY_COUNTER_INVALID");
  }
  return value;
}

export function readIdentifierV2(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9._:-]{1,160}$/u.test(value)) {
    throw new Error("TELEMETRY_IDENTIFIER_INVALID");
  }
  return value;
}

export function readDigestV2(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)
    || value === "0".repeat(64)) {
    throw new Error("TELEMETRY_DIGEST_INVALID");
  }
  return value;
}

export function readTicketV2(value: unknown): string {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,19}$/u.test(value)
    || BigInt(value) > 18446744073709551615n) {
    throw new Error("TELEMETRY_TICKET_INVALID");
  }
  return value;
}

export function parseFixedV2(value: unknown, scale: unknown): FixedDecimalV2 {
  if (typeof scale !== "number" || !Number.isInteger(scale) || scale < 0 || scale > 16
    || typeof value !== "string" || value.length > 36) {
    throw new Error("TELEMETRY_DECIMAL_INVALID");
  }
  const fraction = scale === 0 ? "" : "\\.[0-9]{" + scale + "}";
  if (!new RegExp("^-?(?:0|[1-9][0-9]{0,17})" + fraction + "$", "u").test(value)
    || (/^-0(?:\.0+)?$/u.test(value))) {
    throw new Error("TELEMETRY_DECIMAL_INVALID");
  }
  return Object.freeze({ value, scale });
}

export function sumFixedV2(
  values: readonly FixedDecimalV2[], scale: number,
): FixedDecimalV2 {
  if (!Number.isInteger(scale) || scale < 0 || scale > 16) {
    throw new Error("TELEMETRY_DECIMAL_INVALID");
  }
  let total = 0n;
  for (const item of values) {
    const parsed = parseFixedV2(item.value, item.scale);
    if (parsed.scale !== scale) throw new Error("TELEMETRY_DECIMAL_INVALID");
    total += BigInt(parsed.value.replace(".", ""));
  }
  const sign = total < 0n ? "-" : "";
  const digits = (total < 0n ? -total : total).toString().padStart(scale + 1, "0");
  const value = scale === 0 ? sign + digits
    : sign + digits.slice(0, -scale) + "." + digits.slice(-scale);
  return parseFixedV2(value, scale);
}
~~~

These are bounded domain primitives. The later strict wire parser must validate object keys, account currency precision, and allowed value sign/range for each field. This helper deliberately does not treat an arbitrary string as a broker symbol or authenticate an identifier.

- [x] Run GREEN and package typecheck:

~~~sh
npm --prefix apps/execution-edge test -- test/telemetry-values-v2.test.ts
npm --prefix apps/execution-edge run typecheck
~~~

Expected: PASS. Review both new files with git diff --no-index against /dev/null; do not stage or commit.

## Task 2: Immutable start-boundary rules

**Create:**

- /Users/ameeramer/.config/superpowers/worktrees/prop-trading-system/mt5-stale-payload-recovery/apps/execution-edge/src/telemetry-cutover-v2.ts
- /Users/ameeramer/.config/superpowers/worktrees/prop-trading-system/mt5-stale-payload-recovery/apps/execution-edge/test/telemetry-cutover-v2.test.ts

- [x] Write the complete failing test file:

~~~ts
import { describe, expect, it } from "vitest";
import { makeBoundaryV2, includesDealV2, sameBoundaryV2 } from "../src/telemetry-cutover-v2";

function boundary() {
  return makeBoundaryV2({
    tracking_id: "tracking-001",
    account_fingerprint_sha256: "a".repeat(64),
    started_at_broker_msc: 100000,
    initialized_at_utc_seconds: 200,
    excluded_boundary_deal_ids: ["22", "11"],
  });
}

describe("forward-only telemetry cutover", () => {
  it("rejects older history and already observed boundary-second deals", () => {
    const start = boundary();
    expect(includesDealV2(start, 99999, "30")).toBe(false);
    expect(includesDealV2(start, 100500, "11")).toBe(false);
    expect(includesDealV2(start, 100500, "30")).toBe(true);
    expect(includesDealV2(start, 101000, "31")).toBe(true);
  });
  it("freezes a copied boundary rather than retaining a mutable input array", () => {
    const source = ["22", "11"];
    const start = makeBoundaryV2({ ...boundary(), excluded_boundary_deal_ids: source });
    source.push("30");
    expect(start.excluded_boundary_deal_ids).toEqual(["11", "22"]);
    expect(Object.isFrozen(start)).toBe(true);
    expect(Object.isFrozen(start.excluded_boundary_deal_ids)).toBe(true);
  });
  it("compares all immutable fields and ignores input exclusion ordering", () => {
    const start = boundary();
    expect(sameBoundaryV2(start, makeBoundaryV2({
      ...start, excluded_boundary_deal_ids: ["22", "11"],
    }))).toBe(true);
    expect(sameBoundaryV2(start, makeBoundaryV2({
      ...start, started_at_broker_msc: 101000,
    }))).toBe(false);
    expect(sameBoundaryV2(start, makeBoundaryV2({
      ...start, account_fingerprint_sha256: "b".repeat(64),
    }))).toBe(false);
  });
  it("rejects unusable clocks and duplicate/invalid exclusions", () => {
    expect(() => makeBoundaryV2({ ...boundary(), started_at_broker_msc: 0 })).toThrow();
    expect(() => makeBoundaryV2({ ...boundary(), started_at_broker_msc: 100001 })).toThrow();
    expect(() => makeBoundaryV2({ ...boundary(), initialized_at_utc_seconds: 0 })).toThrow();
    expect(() => makeBoundaryV2({ ...boundary(), excluded_boundary_deal_ids: ["11", "11"] })).toThrow();
    expect(() => makeBoundaryV2({ ...boundary(), excluded_boundary_deal_ids: ["0"] })).toThrow();
  });
});
~~~

- [x] Run RED:

~~~sh
npm --prefix apps/execution-edge test -- test/telemetry-cutover-v2.test.ts
~~~

Expected: FAIL on the missing cutover module.

- [x] Create the complete implementation:

~~~ts
import { canonicalStringify } from "./canonical";
import { readCounterV2, readDigestV2, readIdentifierV2, readTicketV2 } from "./telemetry-values-v2";

export type TrackingBoundaryV2 = Readonly<{
  tracking_id: string;
  account_fingerprint_sha256: string;
  started_at_broker_msc: number;
  initialized_at_utc_seconds: number;
  excluded_boundary_deal_ids: readonly string[];
}>;

export function makeBoundaryV2(input: TrackingBoundaryV2): TrackingBoundaryV2 {
  const started = readCounterV2(input.started_at_broker_msc, 1);
  if (started % 1000 !== 0 || started > Number.MAX_SAFE_INTEGER - 1000
    || !Array.isArray(input.excluded_boundary_deal_ids)
    || input.excluded_boundary_deal_ids.length > 1024) {
    throw new Error("TELEMETRY_BOUNDARY_INVALID");
  }
  const excluded = input.excluded_boundary_deal_ids.map(readTicketV2).sort();
  if (new Set(excluded).size !== excluded.length) {
    throw new Error("TELEMETRY_BOUNDARY_INVALID");
  }
  return Object.freeze({
    tracking_id: readIdentifierV2(input.tracking_id),
    account_fingerprint_sha256: readDigestV2(input.account_fingerprint_sha256),
    started_at_broker_msc: started,
    initialized_at_utc_seconds: readCounterV2(input.initialized_at_utc_seconds, 1),
    excluded_boundary_deal_ids: Object.freeze(excluded),
  });
}

export function includesDealV2(
  boundary: TrackingBoundaryV2, brokerTimeMsc: number, dealId: string,
): boolean {
  readCounterV2(brokerTimeMsc);
  readTicketV2(dealId);
  if (brokerTimeMsc < boundary.started_at_broker_msc) return false;
  return brokerTimeMsc >= boundary.started_at_broker_msc + 1000
    || !boundary.excluded_boundary_deal_ids.includes(dealId);
}

export function sameBoundaryV2(left: TrackingBoundaryV2, right: TrackingBoundaryV2): boolean {
  return canonicalStringify(makeBoundaryV2(left)) === canonicalStringify(makeBoundaryV2(right));
}
~~~

The EA capture stage must establish and persist this boundary and the matching baseline together. This pure helper does not sample a broker clock, claim the account is connected, prevent a terminal race, or replace the local/server registration recovery check. If more than 1024 existing boundary-second deal IDs are present, initialization must refuse the boundary rather than silently omit IDs.

- [x] Run GREEN and typecheck:

~~~sh
npm --prefix apps/execution-edge test -- test/telemetry-cutover-v2.test.ts
npm --prefix apps/execution-edge run typecheck
~~~

Expected: PASS. Inspect the two new files and leave uncommitted.

## Task 3: Truthful coverage, not a heartbeat-derived success badge

**Create:**

- /Users/ameeramer/.config/superpowers/worktrees/prop-trading-system/mt5-stale-payload-recovery/apps/execution-edge/src/telemetry-coverage-v2.ts
- /Users/ameeramer/.config/superpowers/worktrees/prop-trading-system/mt5-stale-payload-recovery/apps/execution-edge/test/telemetry-coverage-v2.test.ts

- [x] Write the complete failing test:

~~~ts
import { describe, expect, it } from "vitest";
import { deriveCoverageV2, type CoverageInputV2 } from "../src/telemetry-coverage-v2";

const complete: CoverageInputV2 = {
  started: true, produced_events: 3, acknowledged_events: 3,
  scan_finished: true, scan_through_broker_msc: 100000,
  record_gap: null, observation_gap: false,
};

describe("journal coverage independent of heartbeat health", () => {
  it("reports only the acknowledged completed scan watermark", () => {
    expect(deriveCoverageV2(complete)).toEqual({
      state: "UP_TO_DATE", through_broker_msc: 100000,
      pending_events: 0, reason: null, observation_gap: false,
    });
  });
  it("does not call queued or unscanned data up to date", () => {
    expect(deriveCoverageV2({ ...complete, acknowledged_events: 2 }).state).toBe("CATCHING_UP");
    expect(deriveCoverageV2({ ...complete, scan_finished: false }).state).toBe("CATCHING_UP");
    expect(deriveCoverageV2({ ...complete, acknowledged_events: 2 }).through_broker_msc).toBeNull();
  });
  it("gives known missing records precedence over a completed scan", () => {
    expect(deriveCoverageV2({ ...complete, record_gap: "HISTORY_UNAVAILABLE" }))
      .toMatchObject({ state: "DATA_MISSING", reason: "HISTORY_UNAVAILABLE", through_broker_msc: null });
  });
  it("retains an offline modification-observation gap without fabricating lost changes", () => {
    expect(deriveCoverageV2({ ...complete, observation_gap: true }))
      .toMatchObject({ state: "UP_TO_DATE", observation_gap: true });
  });
  it("supports unstarted state and rejects contradictory acknowledgements", () => {
    expect(deriveCoverageV2({
      started: false, produced_events: 0, acknowledged_events: 0,
      scan_finished: false, scan_through_broker_msc: null,
      record_gap: null, observation_gap: false,
    }).state).toBe("NOT_STARTED");
    expect(() => deriveCoverageV2({ ...complete, acknowledged_events: 4 })).toThrow();
    expect(() => deriveCoverageV2({ ...complete, scan_through_broker_msc: null })).toThrow();
    expect(() => deriveCoverageV2({ ...complete, started: false })).toThrow();
  });
});
~~~

- [x] Run RED:

~~~sh
npm --prefix apps/execution-edge test -- test/telemetry-coverage-v2.test.ts
~~~

Expected: FAIL on the missing module.

- [x] Create the complete implementation:

~~~ts
import { readCounterV2 } from "./telemetry-values-v2";

export type RecordGapV2 = "HISTORY_UNAVAILABLE" | "CLOCK_DISCONTINUITY"
  | "OUTBOX_CORRUPT" | "CAPTURE_FAILED" | "UNSUPPORTED_RECORD";

export type CoverageInputV2 = Readonly<{
  started: boolean;
  produced_events: number;
  acknowledged_events: number;
  scan_finished: boolean;
  scan_through_broker_msc: number | null;
  record_gap: RecordGapV2 | null;
  observation_gap: boolean;
}>;

export type CoverageV2 = Readonly<{
  state: "NOT_STARTED" | "CATCHING_UP" | "UP_TO_DATE" | "DATA_MISSING";
  through_broker_msc: number | null;
  pending_events: number;
  reason: RecordGapV2 | null;
  observation_gap: boolean;
}>;

export function deriveCoverageV2(input: CoverageInputV2): CoverageV2 {
  const produced = readCounterV2(input.produced_events);
  const acknowledged = readCounterV2(input.acknowledged_events);
  const through = input.scan_through_broker_msc === null ? null
    : readCounterV2(input.scan_through_broker_msc, 1);
  const gaps: readonly RecordGapV2[] = [
    "HISTORY_UNAVAILABLE", "CLOCK_DISCONTINUITY", "OUTBOX_CORRUPT",
    "CAPTURE_FAILED", "UNSUPPORTED_RECORD",
  ];
  if (typeof input.started !== "boolean" || typeof input.scan_finished !== "boolean"
    || typeof input.observation_gap !== "boolean"
    || (input.record_gap !== null && !gaps.includes(input.record_gap))
    || acknowledged > produced || (input.scan_finished && through === null)
    || (!input.started && (produced !== 0 || acknowledged !== 0 || through !== null
      || input.scan_finished))) {
    throw new Error("TELEMETRY_COVERAGE_INVALID");
  }
  const pending = produced - acknowledged;
  const state: CoverageV2["state"] = !input.started ? "NOT_STARTED"
    : input.record_gap !== null ? "DATA_MISSING"
    : !input.scan_finished || pending !== 0 ? "CATCHING_UP" : "UP_TO_DATE";
  return Object.freeze({
    state,
    through_broker_msc: state === "UP_TO_DATE" ? through : null,
    pending_events: pending,
    reason: input.record_gap,
    observation_gap: input.observation_gap,
  });
}
~~~

The later storage module supplies the actual committed acknowledgement. The later UI ages the report separately and may retain a previous completed coverage watermark alongside a current catching-up report. This helper cannot prove broker history completeness from a heartbeat or predict unpublished backlog during an outage.

- [x] Run GREEN and typecheck:

~~~sh
npm --prefix apps/execution-edge test -- test/telemetry-coverage-v2.test.ts
npm --prefix apps/execution-edge run typecheck
~~~

Expected: PASS. Review new files, no commit.

## Task 4: Pure request admission and exact replay

**Create:**

- /Users/ameeramer/.config/superpowers/worktrees/prop-trading-system/mt5-stale-payload-recovery/apps/execution-edge/src/telemetry-admission-v2.ts
- /Users/ameeramer/.config/superpowers/worktrees/prop-trading-system/mt5-stale-payload-recovery/apps/execution-edge/test/telemetry-admission-v2.test.ts

- [x] Write the complete failing test:

~~~ts
import { describe, expect, it } from "vitest";
import {
  decideAdmissionV2, type SyncIdentityV2, type RequestMetaV2,
  type AcceptedStateV2, type ReceiptMetaV2,
} from "../src/telemetry-admission-v2";

const identity: SyncIdentityV2 = {
  account_id: "account-001", installation_id: "installation-001",
  tracking_id: "tracking-001", safety_epoch: 1,
  account_profile_sha256: "a".repeat(64),
  account_fingerprint_sha256: "b".repeat(64),
  tracking_boundary_sha256: "c".repeat(64),
};
function request(patch: Partial<RequestMetaV2> = {}): RequestMetaV2 {
  return { identity, request_sequence: 1, body_sha256: "d".repeat(64),
    event_sequences: [1, 2], fresh: true, ...patch };
}
const state: AcceptedStateV2 = { identity, last_request_sequence: 1, last_event_sequence: 2 };
const receipt: ReceiptMetaV2 = {
  identity, request_sequence: 1, request_body_sha256: "d".repeat(64),
  response_bytes: '{"mode":"DRY_RUN","command":null}',
};

describe("telemetry request admission is not a persistence acknowledgement", () => {
  it("proposes a contiguous watermark for a new transaction", () => {
    expect(decideAdmissionV2(null, null, request()))
      .toEqual({ kind: "NEW", event_sequence_if_committed: 2 });
    expect(decideAdmissionV2(state, null, request({
      request_sequence: 2, event_sequences: [],
    }))).toEqual({ kind: "NEW", event_sequence_if_committed: 2 });
  });
  it("returns the original committed response on exact retry, even if now stale", () => {
    expect(decideAdmissionV2(state, receipt, request({ fresh: false })))
      .toEqual({ kind: "REPLAY", response_bytes: receipt.response_bytes });
  });
  it("rejects altered retry bytes and missing receipts", () => {
    expect(decideAdmissionV2(state, receipt, request({ body_sha256: "e".repeat(64) })))
      .toEqual({ kind: "REJECT", code: "REPLAY_CONFLICT" });
    expect(decideAdmissionV2(state, null, request()))
      .toEqual({ kind: "REJECT", code: "RECEIPT_MISSING" });
  });
  it("rejects gaps, stale unaccepted requests and duplicate event sequence numbers", () => {
    expect(decideAdmissionV2(null, null, request({ request_sequence: 2 })))
      .toEqual({ kind: "REJECT", code: "SEQUENCE_INVALID" });
    expect(decideAdmissionV2(null, null, request({ fresh: false })))
      .toEqual({ kind: "REJECT", code: "STALE_ENVELOPE" });
    expect(decideAdmissionV2(null, null, request({ event_sequences: [1, 3] })))
      .toEqual({ kind: "REJECT", code: "EVENT_SEQUENCE_INVALID" });
    expect(decideAdmissionV2(null, null, request({ event_sequences: [1, 1] })))
      .toEqual({ kind: "REJECT", code: "EVENT_SEQUENCE_INVALID" });
  });
  it("rejects changed account or tracking boundary before accepting or replaying", () => {
    for (const changed of [
      { ...identity, account_fingerprint_sha256: "f".repeat(64) },
      { ...identity, tracking_boundary_sha256: "f".repeat(64) },
      { ...identity, tracking_id: "tracking-other" },
    ]) {
      expect(decideAdmissionV2(state, receipt, request({ identity: changed })))
        .toEqual({ kind: "REJECT", code: "IDENTITY_MISMATCH" });
    }
  });
  it("rejects a receipt with no matching accepted session or lookup key", () => {
    expect(decideAdmissionV2(null, receipt, request()))
      .toEqual({ kind: "REJECT", code: "RECEIPT_INVALID" });
    expect(decideAdmissionV2(state, { ...receipt, request_sequence: 2 }, request()))
      .toEqual({ kind: "REJECT", code: "RECEIPT_INVALID" });
  });
  it("never mutates the durable state supplied by its caller", () => {
    const saved = JSON.stringify(state);
    decideAdmissionV2(state, null, request({ request_sequence: 2, event_sequences: [3] }));
    expect(JSON.stringify(state)).toBe(saved);
  });
});
~~~

- [x] Run RED:

~~~sh
npm --prefix apps/execution-edge test -- test/telemetry-admission-v2.test.ts
~~~

Expected: FAIL on the missing admission module.

- [x] Create the complete implementation:

~~~ts
import { canonicalStringify } from "./canonical";
import { readCounterV2, readDigestV2, readIdentifierV2 } from "./telemetry-values-v2";

export type SyncIdentityV2 = Readonly<{
  account_id: string;
  installation_id: string;
  tracking_id: string;
  safety_epoch: number;
  account_profile_sha256: string;
  account_fingerprint_sha256: string;
  tracking_boundary_sha256: string;
}>;
export type RequestMetaV2 = Readonly<{
  identity: SyncIdentityV2;
  request_sequence: number;
  body_sha256: string;
  event_sequences: readonly number[];
  fresh: boolean;
}>;
export type AcceptedStateV2 = Readonly<{
  identity: SyncIdentityV2;
  last_request_sequence: number;
  last_event_sequence: number;
}>;
export type ReceiptMetaV2 = Readonly<{
  identity: SyncIdentityV2;
  request_sequence: number;
  request_body_sha256: string;
  response_bytes: string;
}>;
export type AdmissionV2 =
  | Readonly<{ kind: "NEW"; event_sequence_if_committed: number }>
  | Readonly<{ kind: "REPLAY"; response_bytes: string }>
  | Readonly<{ kind: "REJECT"; code: "IDENTITY_MISMATCH" | "RECEIPT_INVALID"
      | "REPLAY_CONFLICT" | "RECEIPT_MISSING" | "SEQUENCE_INVALID"
      | "STALE_ENVELOPE" | "EVENT_SEQUENCE_INVALID" }>;

function identityKey(input: SyncIdentityV2): string {
  return canonicalStringify({
    account_id: readIdentifierV2(input.account_id),
    installation_id: readIdentifierV2(input.installation_id),
    tracking_id: readIdentifierV2(input.tracking_id),
    safety_epoch: readCounterV2(input.safety_epoch),
    account_profile_sha256: readDigestV2(input.account_profile_sha256),
    account_fingerprint_sha256: readDigestV2(input.account_fingerprint_sha256),
    tracking_boundary_sha256: readDigestV2(input.tracking_boundary_sha256),
  });
}

export function decideAdmissionV2(
  state: AcceptedStateV2 | null,
  receipt: ReceiptMetaV2 | null,
  request: RequestMetaV2,
): AdmissionV2 {
  const identity = identityKey(request.identity);
  const sequence = readCounterV2(request.request_sequence, 1);
  const digest = readDigestV2(request.body_sha256);
  if (typeof request.fresh !== "boolean" || !Array.isArray(request.event_sequences)
    || request.event_sequences.length > 32) {
    throw new Error("TELEMETRY_REQUEST_META_INVALID");
  }
  request.event_sequences.forEach((value) => readCounterV2(value, 1));
  const lastRequest = state === null ? 0 : readCounterV2(state.last_request_sequence, 1);
  const lastEvent = state === null ? 0 : readCounterV2(state.last_event_sequence);
  if (state !== null && identityKey(state.identity) !== identity) {
    return { kind: "REJECT", code: "IDENTITY_MISMATCH" };
  }
  if (receipt !== null) {
    if (state === null || identityKey(receipt.identity) !== identity
      || readCounterV2(receipt.request_sequence, 1) !== sequence
      || receipt.request_sequence > lastRequest
      || typeof receipt.response_bytes !== "string" || receipt.response_bytes.length === 0
      || receipt.response_bytes.length > 128 * 1024) {
      return { kind: "REJECT", code: "RECEIPT_INVALID" };
    }
    if (readDigestV2(receipt.request_body_sha256) !== digest) {
      return { kind: "REJECT", code: "REPLAY_CONFLICT" };
    }
    return { kind: "REPLAY", response_bytes: receipt.response_bytes };
  }
  if (sequence <= lastRequest) return { kind: "REJECT", code: "RECEIPT_MISSING" };
  if (lastRequest === Number.MAX_SAFE_INTEGER || sequence !== lastRequest + 1) {
    return { kind: "REJECT", code: "SEQUENCE_INVALID" };
  }
  if (!request.fresh) return { kind: "REJECT", code: "STALE_ENVELOPE" };
  let proposed = lastEvent;
  for (const value of request.event_sequences) {
    if (proposed === Number.MAX_SAFE_INTEGER || value !== proposed + 1) {
      return { kind: "REJECT", code: "EVENT_SEQUENCE_INVALID" };
    }
    proposed = value;
  }
  return { kind: "NEW", event_sequence_if_committed: proposed };
}
~~~

Caller contracts for the later receiver are mandatory: authenticate before invoking this helper; validate the entire wire body and recompute its digest; look up receipt by the exact account/tracking/request key; validate stored canonical response schema/digest before sending it; and commit the state/events/receipt atomically before issuing a new ACK. This helper does none of those I/O operations. Its NEW result is explicitly conditional, not proof of persistence.

- [x] Run GREEN and typecheck:

~~~sh
npm --prefix apps/execution-edge test -- test/telemetry-admission-v2.test.ts
npm --prefix apps/execution-edge run typecheck
~~~

Expected: PASS. Review both new files, no commit.

## Task 5: Regression and stage handoff

- [x] Run the four focused files together:

~~~sh
npm --prefix apps/execution-edge test -- test/telemetry-values-v2.test.ts test/telemetry-cutover-v2.test.ts test/telemetry-coverage-v2.test.ts test/telemetry-admission-v2.test.ts
~~~

Expected: all new cases PASS.

- [x] Run the complete existing safety/regression checks:

~~~sh
npm --prefix apps/execution-edge test
npm --prefix apps/execution-edge run typecheck
npm --prefix apps/execution-edge run lint
node scripts/verify-mt5-dry-run-boundary.mjs
git diff --check
git status --short
~~~

Expected: PASS and only the eight intended new source/test paths. There should be no changes to mt5/, migrations/, src/index.ts, canonical.ts, v1 contracts, configuration, CI, or dashboard integrity files. If a checker rejects a new pure module, investigate the exact rule; do not bypass or broaden a security rule in this stage.

- [x] Record actual commands, counts and outcomes in the implementation handoff, and report that no EA/backend/UI functionality has been activated yet.
- [x] Expand delivery Stage 2 into a full executable plan using these verified functions and actual local D1 runtime behavior. Keep the source contracts and byte fixtures synchronized across subsequent EA and frontend stages. Do not jump directly to remote deployment.

Stage 1 execution note: Tasks 0–5 implementation, per-task reviews, and regression checks have passed locally (27 new tests; 335 total). The final combined review passed with no remaining findings. Stage 2 follow-on planning is now complete in `2026-09-03-mt5-telemetry-receiver.md`; no Stage 2 application source, schema file, or runtime integration has been implemented. Its snippets were tested only in a disposable planning copy. See `docs/audits/2026-09-03-mt5-telemetry-invariants.md` for Stage 1 evidence and `docs/audits/2026-09-03-mt5-telemetry-receiver-plan.md` for planning checks.

## Self-review of this plan

Scope is intentionally one executable foundation stage. Every imported function in its test code is defined above or already exists in canonical.ts. Code steps include full file content and RED/GREEN commands. No placeholders or unapproved endpoint/deployment steps are present. Full feature coverage and downstream file ownership are mapped in the delivery roadmap rather than misrepresented as implemented by these pure helpers.

The final reviewer must specifically inspect decimal scale limits before allocation, millisecond boundary overflow, array-copy immutability, coverage acknowledgement ordering, receipt/state consistency, and whether a proposed admission could accidentally be mistaken for a durable ACK.

Historical planning verification on 2026-09-03, before implementation: all eight TypeScript source/test code blocks typechecked together in an in-memory compiler host using the inspected execution-edge tsconfig and installed dependencies. That review corrected decimal-scale validation so an excessive scale is rejected before string allocation. No source/test files or executed tests existed at that planning-only stage, and its execution checkboxes were still open. The Stage 1 execution note above and linked audit supersede that historical status with the actual implementation and regression results.
