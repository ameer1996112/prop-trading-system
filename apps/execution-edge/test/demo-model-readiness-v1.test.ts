import { expect, it } from "vitest";
import { assessModelReadiness } from "../src/demo-model-readiness-v1";

const policies = ["BOC", "DIR_CLOSE", "HTF_FLIP"].map(model => ({
  model,
  kind: "FIXED_BROKER_TICKS" as const,
  stopTicks: 10,
  targetTicks: 20,
}));

it("requires one policy for every model and never grants execution", () => {
  expect(assessModelReadiness(policies)).toMatchObject({ ready: true, executionAllowed: false });
  for (const value of [
    null,
    [],
    policies.slice(1),
    [...policies, policies[0]],
    [policies[0], policies[0], policies[2]],
    [...policies.slice(0, 2), {}],
  ]) {
    expect(assessModelReadiness(value)).toEqual({
      ready: false,
      executionAllowed: false,
      reason: "ALL_MODEL_POLICIES_REQUIRED",
    });
  }
});

it("returns policies in canonical model order regardless of input permutation", () => {
  const result = assessModelReadiness([policies[2], policies[0], policies[1]]);
  expect(result).toMatchObject({ ready: true, executionAllowed: false });
  if (result.ready) expect(result.policies.map(policy => policy.model)).toEqual(["BOC", "DIR_CLOSE", "HTF_FLIP"]);
});

it("rejects sparse arrays", () => {
  const sparse = new Array(3);
  sparse[0] = policies[0];
  sparse[2] = policies[2];
  expect(assessModelReadiness(sparse)).toEqual({
    ready: false,
    executionAllowed: false,
    reason: "ALL_MODEL_POLICIES_REQUIRED",
  });
});

it("does not invoke custom iterators or accessor slots", () => {
  let iteratorCalls = 0;
  const sparse = new Array(3);
  Object.defineProperty(sparse, Symbol.iterator, {
    value: () => {
      iteratorCalls += 1;
      return policies[Symbol.iterator]();
    },
  });
  expect(assessModelReadiness(sparse)).toEqual({
    ready: false,
    executionAllowed: false,
    reason: "ALL_MODEL_POLICIES_REQUIRED",
  });
  expect(iteratorCalls).toBe(0);

  let slotReads = 0;
  const accessorSlots = [...policies];
  Object.defineProperty(accessorSlots, "1", {
    get() {
      slotReads += 1;
      return policies[1];
    },
  });
  expect(assessModelReadiness(accessorSlots)).toEqual({
    ready: false,
    executionAllowed: false,
    reason: "ALL_MODEL_POLICIES_REQUIRED",
  });
  expect(slotReads).toBe(0);
});

it("converts failed inspection into a blocked result", () => {
  const { proxy, revoke } = Proxy.revocable([], {});
  revoke();
  expect(() => assessModelReadiness(proxy)).not.toThrow();
  expect(assessModelReadiness(proxy)).toEqual({
    ready: false,
    executionAllowed: false,
    reason: "ALL_MODEL_POLICIES_REQUIRED",
  });
});

it("returns frozen clones detached from the caller input", () => {
  const input = policies.map(policy => ({ ...policy }));
  const result = assessModelReadiness(input);
  expect(result.ready).toBe(true);
  expect(Object.isFrozen(result)).toBe(true);
  if (!result.ready) return;

  expect(Object.isFrozen(result.policies)).toBe(true);
  expect(result.policies.every(Object.isFrozen)).toBe(true);
  expect(result.policies[0]).not.toBe(input[0]);
  input[0]!.stopTicks = 99;
  expect(result.policies[0]!.stopTicks).toBe(10);
});
