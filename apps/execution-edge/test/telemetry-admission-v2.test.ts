import { describe, expect, it } from "vitest";
import {
  decideAdmissionV2,
  type AcceptedStateV2,
  type ReceiptMetaV2,
  type RequestMetaV2,
  type SyncIdentityV2,
} from "../src/telemetry-admission-v2";

const identity: SyncIdentityV2 = {
  account_id: "account-001",
  installation_id: "installation-001",
  tracking_id: "tracking-001",
  safety_epoch: 1,
  account_profile_sha256: "a".repeat(64),
  account_fingerprint_sha256: "b".repeat(64),
  tracking_boundary_sha256: "c".repeat(64),
};

function request(overrides: Partial<RequestMetaV2> = {}): RequestMetaV2 {
  return {
    identity,
    request_sequence: 1,
    body_sha256: "d".repeat(64),
    event_sequences: [1, 2],
    fresh: true,
    ...overrides,
  };
}

function state(overrides: Partial<AcceptedStateV2> = {}): AcceptedStateV2 {
  return { identity, last_request_sequence: 1, last_event_sequence: 2, ...overrides };
}

function receipt(overrides: Partial<ReceiptMetaV2> = {}): ReceiptMetaV2 {
  return {
    identity,
    request_sequence: 1,
    request_body_sha256: "d".repeat(64),
    response_bytes: '{"mode":"DRY_RUN","command":null}',
    ...overrides,
  };
}

describe("telemetry admission v2", () => {
  it("admits a first request and preserves the empty-batch journal watermark", () => {
    expect(decideAdmissionV2(null, null, request())).toEqual({ kind: "NEW", event_sequence_if_committed: 2 });
    expect(decideAdmissionV2(null, null, request({ event_sequences: [] }))).toEqual({ kind: "NEW", event_sequence_if_committed: 0 });
  });

  it("admits the next request with an empty batch", () => {
    expect(decideAdmissionV2(state(), null, request({ request_sequence: 2, event_sequences: [] }))).toEqual({ kind: "NEW", event_sequence_if_committed: 2 });
  });

  it("returns exact opaque receipt bytes for replay, regardless of freshness", () => {
    const stored = receipt();
    expect(decideAdmissionV2(state(), stored, request({ fresh: false }))).toEqual({ kind: "REPLAY", response_bytes: stored.response_bytes });
  });

  it("rejects conflicting, missing, and invalid receipt paths", () => {
    expect(decideAdmissionV2(state(), receipt({ request_body_sha256: "e".repeat(64) }), request())).toEqual({ kind: "REJECT", code: "REPLAY_CONFLICT" });
    expect(decideAdmissionV2(state(), null, request())).toEqual({ kind: "REJECT", code: "RECEIPT_MISSING" });
    expect(decideAdmissionV2(null, receipt(), request())).toEqual({ kind: "REJECT", code: "RECEIPT_INVALID" });
    expect(decideAdmissionV2(state(), receipt({ request_sequence: 2 }), request())).toEqual({ kind: "REJECT", code: "RECEIPT_INVALID" });
  });

  it("rejects gaps, stale envelopes, and bad event progression", () => {
    expect(decideAdmissionV2(null, null, request({ request_sequence: 2 }))).toEqual({ kind: "REJECT", code: "SEQUENCE_INVALID" });
    expect(decideAdmissionV2(state(), null, request({ request_sequence: 2, fresh: false }))).toEqual({ kind: "REJECT", code: "STALE_ENVELOPE" });
    expect(decideAdmissionV2(null, null, request({ event_sequences: [1, 3] }))).toEqual({ kind: "REJECT", code: "EVENT_SEQUENCE_INVALID" });
    expect(decideAdmissionV2(null, null, request({ event_sequences: [1, 1] }))).toEqual({ kind: "REJECT", code: "EVENT_SEQUENCE_INVALID" });
  });

  it("rejects every identity drift before acceptance or replay", () => {
    for (const key of Object.keys(identity) as Array<keyof SyncIdentityV2>) {
      const changed = key === "safety_epoch" ? 2 : key.endsWith("sha256") ? "e".repeat(64) : `${identity[key]}-changed`;
      const changedIdentity = { ...identity, [key]: changed } as SyncIdentityV2;
      expect(decideAdmissionV2(state({ identity: changedIdentity }), null, request())).toEqual({ kind: "REJECT", code: "IDENTITY_MISMATCH" });
      expect(decideAdmissionV2(state(), receipt(), request({ identity: changedIdentity }))).toEqual({ kind: "REJECT", code: "IDENTITY_MISMATCH" });
    }
  });

  it("handles advanced state and batch bounds without mutation", () => {
    expect(decideAdmissionV2(state({ last_request_sequence: 5, last_event_sequence: 8 }), receipt({ request_sequence: 1 }), request())).toEqual({ kind: "REPLAY", response_bytes: receipt().response_bytes });
    expect(decideAdmissionV2(null, null, request({ event_sequences: Array.from({ length: 32 }, (_, index) => index + 1) }))).toEqual({ kind: "NEW", event_sequence_if_committed: 32 });
    expect(() => decideAdmissionV2(null, null, request({ event_sequences: Array.from({ length: 33 }, (_, index) => index + 1) }))).toThrow("TELEMETRY_REQUEST_META_INVALID");
    expect(decideAdmissionV2(state({ last_request_sequence: 2, last_event_sequence: Number.MAX_SAFE_INTEGER }), null, request({ request_sequence: 3, event_sequences: [Number.MAX_SAFE_INTEGER] }))).toEqual({ kind: "REJECT", code: "EVENT_SEQUENCE_INVALID" });
    const inputState = state();
    const before = JSON.stringify(inputState);
    decideAdmissionV2(inputState, null, request({ request_sequence: 2, event_sequences: [3] }));
    expect(JSON.stringify(inputState)).toBe(before);
  });

  it("rejects invalid receipt content and propagates request primitive validation", () => {
    expect(decideAdmissionV2(state(), receipt({ response_bytes: "" }), request())).toEqual({ kind: "REJECT", code: "RECEIPT_INVALID" });
    expect(decideAdmissionV2(state(), receipt({ response_bytes: "x".repeat(128 * 1024 + 1) }), request())).toEqual({ kind: "REJECT", code: "RECEIPT_INVALID" });
    expect(decideAdmissionV2(state(), receipt({ identity: { ...identity, tracking_id: "tracking-002" } }), request())).toEqual({ kind: "REJECT", code: "RECEIPT_INVALID" });
    expect(() => decideAdmissionV2(null, null, request({ fresh: "true" as never }))).toThrow("TELEMETRY_REQUEST_META_INVALID");
    expect(() => decideAdmissionV2(null, null, request({ request_sequence: 0 }))).toThrow("TELEMETRY_COUNTER_INVALID");
    expect(() => decideAdmissionV2(null, null, request({ body_sha256: "0".repeat(64) }))).toThrow("TELEMETRY_DIGEST_INVALID");
    const sparse = [1, 2] as number[];
    delete sparse[1];
    expect(() => decideAdmissionV2(null, null, request({ event_sequences: sparse }))).toThrow("TELEMETRY_COUNTER_INVALID");
  });

  it("rejects an inherited value in a sparse event array before replay handling", () => {
    const sparse = [1, 2] as number[];
    delete sparse[1];
    const inheritedIndex = Object.create(Array.prototype) as number[];
    inheritedIndex[1] = 2;
    Object.setPrototypeOf(sparse, inheritedIndex);
    expect(() => decideAdmissionV2(state(), receipt(), request({ event_sequences: sparse }))).toThrow("TELEMETRY_COUNTER_INVALID");
  });

  it("propagates malformed receipt primitives after receipt structural checks", () => {
    expect(() => decideAdmissionV2(state(), receipt({ identity: { ...identity, tracking_id: "bad\ntracking" } }), request())).toThrow("TELEMETRY_IDENTIFIER_INVALID");
    expect(() => decideAdmissionV2(state(), receipt({ request_sequence: 0 }), request())).toThrow("TELEMETRY_COUNTER_INVALID");
    expect(() => decideAdmissionV2(state(), receipt({ request_body_sha256: "0".repeat(64) }), request())).toThrow("TELEMETRY_DIGEST_INVALID");
  });
});
