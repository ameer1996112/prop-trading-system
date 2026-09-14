import { expect, it } from "vitest";
import { readGeometryPolicy } from "../src/demo-geometry-policy-v1";

it("requires explicit geometry and a canonical model", () => {
  for (const model of ["BOC", "DIR_CLOSE", "HTF_FLIP"] as const) {
    const value = { model, kind: "FIXED_BROKER_TICKS" as const, stopTicks: 10, targetTicks: 20 };
    expect(readGeometryPolicy(value)).toEqual(value);

    for (const stopTicks of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "10"]) {
      expect(readGeometryPolicy({ ...value, stopTicks })).toBeNull();
    }
    for (const targetTicks of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "20"]) {
      expect(readGeometryPolicy({ ...value, targetTicks })).toBeNull();
    }

    expect(readGeometryPolicy({ ...value, extra: true })).toBeNull();
    expect(readGeometryPolicy({ model, kind: value.kind, targetTicks: 20 })).toBeNull();
    expect(readGeometryPolicy({ model, kind: value.kind, stopTicks: 10 })).toBeNull();
    expect(readGeometryPolicy({ ...value, stopTicks: undefined })).toBeNull();
    expect(readGeometryPolicy({ ...value, targetTicks: undefined })).toBeNull();
    expect(readGeometryPolicy(Object.create(value))).toBeNull();
  }

  expect(readGeometryPolicy(null)).toBeNull();
  expect(readGeometryPolicy([])).toBeNull();
});

it("rejects non-canonical models and returns a frozen policy", () => {
  const value = { model: "BOC", kind: "FIXED_BROKER_TICKS", stopTicks: 10, targetTicks: 20 };

  for (const model of ["", "boc", "STRUCTURAL_WICK", undefined, null]) {
    expect(readGeometryPolicy({ ...value, model })).toBeNull();
  }
  expect(readGeometryPolicy({ ...value, kind: "OTHER" })).toBeNull();
  expect(readGeometryPolicy({ model: value.model, kind: value.kind, stopTicks: 10, targetTicks: 20, toString: () => "x" })).toBeNull();

  const policy = readGeometryPolicy(value);
  expect(policy).not.toBeNull();
  expect(Object.isFrozen(policy)).toBe(true);
});

it("snapshots only the exact own data fields without invoking accessors", () => {
  let reads = 0;
  const changing = {
    model: "BOC",
    kind: "FIXED_BROKER_TICKS",
    get stopTicks() {
      reads += 1;
      return reads === 1 ? 10 : -1;
    },
    targetTicks: 20,
  };

  expect(readGeometryPolicy(changing)).toBeNull();
  expect(reads).toBe(0);

  const hiddenExtra = { model: "BOC", kind: "FIXED_BROKER_TICKS", stopTicks: 10, targetTicks: 20 };
  Object.defineProperty(hiddenExtra, "extra", { value: true });
  expect(readGeometryPolicy(hiddenExtra)).toBeNull();

  const symbolExtra = { model: "BOC", kind: "FIXED_BROKER_TICKS", stopTicks: 10, targetTicks: 20 };
  Object.defineProperty(symbolExtra, Symbol("extra"), { value: true });
  expect(readGeometryPolicy(symbolExtra)).toBeNull();
});

it("converts failed input inspection into rejection", () => {
  const { proxy, revoke } = Proxy.revocable({}, {});
  revoke();
  expect(() => readGeometryPolicy(proxy)).not.toThrow();
  expect(readGeometryPolicy(proxy)).toBeNull();

  const throwing = new Proxy({}, {
    getPrototypeOf() {
      throw new Error("inspection failed");
    },
  });
  expect(readGeometryPolicy(throwing)).toBeNull();
});
