import { describe, expect, it } from "vitest";
import {
  includesDealV2,
  makeBoundaryV2,
  sameBoundaryV2,
} from "../src/telemetry-cutover-v2";

const fingerprintA = "a".repeat(64);
const fingerprintB = "b".repeat(64);

function boundary(overrides: Partial<Parameters<typeof makeBoundaryV2>[0]> = {}) {
  return makeBoundaryV2({
    tracking_id: "tracking-001",
    account_fingerprint_sha256: fingerprintA,
    started_at_broker_msc: 100_000,
    initialized_at_utc_seconds: 200,
    excluded_boundary_deal_ids: ["22", "11"],
    ...overrides,
  });
}

describe("telemetry cutover v2", () => {
  it("includes only new deals after the immutable start boundary", () => {
    const value = boundary();
    expect(includesDealV2(value, 99_999, "30")).toBe(false);
    expect(includesDealV2(value, 100_000, "11")).toBe(false);
    expect(includesDealV2(value, 100_000, "30")).toBe(true);
    expect(includesDealV2(value, 100_999, "22")).toBe(false);
    expect(includesDealV2(value, 100_999, "30")).toBe(true);
    expect(includesDealV2(value, 101_000, "11")).toBe(true);
    expect(includesDealV2(value, 101_000, "31")).toBe(true);
  });

  it("copies and freezes boundary state", () => {
    const exclusions = ["22", "11"];
    const value = boundary({ excluded_boundary_deal_ids: exclusions });
    exclusions.push("33");
    expect(value.excluded_boundary_deal_ids).toEqual(["11", "22"]);
    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(value.excluded_boundary_deal_ids)).toBe(true);
  });

  it("compares all boundary identity fields canonically", () => {
    expect(sameBoundaryV2(boundary(), boundary({ excluded_boundary_deal_ids: ["11", "22"] }))).toBe(true);
    expect(sameBoundaryV2(boundary(), boundary({ started_at_broker_msc: 101_000 }))).toBe(false);
    expect(sameBoundaryV2(boundary(), boundary({ account_fingerprint_sha256: fingerprintB }))).toBe(false);
    expect(sameBoundaryV2(boundary(), boundary({ tracking_id: "tracking-002" }))).toBe(false);
    expect(sameBoundaryV2(boundary(), boundary({ initialized_at_utc_seconds: 201 }))).toBe(false);
    expect(sameBoundaryV2(boundary(), boundary({ excluded_boundary_deal_ids: ["11"] }))).toBe(false);
  });

  it("rejects malformed boundary clocks and exclusions", () => {
    expect(() => boundary({ started_at_broker_msc: 0 })).toThrow("TELEMETRY_COUNTER_INVALID");
    expect(() => boundary({ started_at_broker_msc: 100_001 })).toThrow("TELEMETRY_BOUNDARY_INVALID");
    expect(() => boundary({ started_at_broker_msc: Math.floor(Number.MAX_SAFE_INTEGER / 1000) * 1000 })).toThrow("TELEMETRY_BOUNDARY_INVALID");
    for (const started_at_broker_msc of [Number.MAX_SAFE_INTEGER - 999]) {
      expect(() => boundary({ started_at_broker_msc })).toThrow("TELEMETRY_BOUNDARY_INVALID");
    }
    expect(() => boundary({ initialized_at_utc_seconds: 0 })).toThrow("TELEMETRY_COUNTER_INVALID");
    expect(() => boundary({ excluded_boundary_deal_ids: ["11", "11"] })).toThrow("TELEMETRY_BOUNDARY_INVALID");
    expect(() => boundary({ excluded_boundary_deal_ids: ["0"] })).toThrow("TELEMETRY_TICKET_INVALID");
    expect(boundary({ excluded_boundary_deal_ids: Array.from({ length: 1024 }, (_, i) => String(i + 1)) }).excluded_boundary_deal_ids).toHaveLength(1024);
    expect(() => boundary({ excluded_boundary_deal_ids: Array.from({ length: 1025 }, (_, i) => String(i + 1)) })).toThrow("TELEMETRY_BOUNDARY_INVALID");
    const sparse = new Array<string>(1);
    expect(() => boundary({ excluded_boundary_deal_ids: sparse })).toThrow("TELEMETRY_BOUNDARY_INVALID");
  });

  it("rejects malformed deal timestamps and tickets", () => {
    const value = boundary();
    expect(() => includesDealV2(value, -1, "30")).toThrow("TELEMETRY_COUNTER_INVALID");
    expect(() => includesDealV2(value, Number.MAX_SAFE_INTEGER + 1, "30")).toThrow("TELEMETRY_COUNTER_INVALID");
    expect(() => includesDealV2(value, 100_000, "0")).toThrow("TELEMETRY_TICKET_INVALID");
  });
});
