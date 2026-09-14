# Demo Policy Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Add an independently testable, inert policy-readiness boundary for all three entry models without enabling any broker action.

**Architecture:** A pure TypeScript module accepts untrusted configuration and produces either normalized complete demo policy data or a typed rejection. Existing PAPER_ONLY, DRY_RUN and telemetry protocols remain unchanged. This is the first bounded implementation stage, not the complete trading release.

**Tech Stack:** TypeScript, Vitest, existing execution-edge package; no new dependencies or network calls.

**Spec:** `../specs/2026-09-14-three-model-demo-completion-design.md`; companion `../specs/2026-09-14-tradeops-strategy-validation-plan.md`.

## Global Constraints

Implementation review amendment (2026-09-14): the Task 2/3 sample code below is
superseded for unknown-input inspection. Use captured own data-descriptor values,
reject accessors and extra own keys including symbols/non-enumerable keys, and
convert inspection exceptions into rejection. Read the three own array slots
directly, never a supplied iterator. Add regressions for changing getters,
revoked proxies, custom iterators, hidden keys and readiness cloning/freezing.
The reviewed source and final fix report are the final implementation evidence;
do not restore the original sample's repeated property reads or Array.from.

- All three strict models are required for release acceptance.
- Trading starts disabled.
- Existing v1 DRY_RUN and v2 telemetry contracts remain inert and command-free respectively.
- Missing policy values block enablement, not silently fall back to a risk percentage or lot size.
- No deployment, alert mutation, terminal replacement, secret discovery, account arming or broker action.
- Preserve both dirty worktrees. No automatic staging or commits in this plan.

## Workspace and scope

Run code/test commands in `/Users/ameeramer/.config/superpowers/worktrees/prop-trading-system/mt5-stale-payload-recovery`.
Documentation lives in the companion `tradeops-dashboard-migration` worktree.
Before edits record `git status --short` and hashes of pre-existing touched files.
New files only in this stage; do not edit production routes, Pine, EA or schemas.
Use the installed package runtime; do not install dependencies or invoke deploy.

This plan does not authorize treating readiness as an execution grant. The later
account gate must independently prove account identity, demo account type,
installation/policy pins, current broker state and risk availability.

## Task 1: Canonical strict-model registry

**Files:** Create `apps/execution-edge/src/demo-models-v1.ts`; create `apps/execution-edge/test/demo-models-v1.test.ts`.

**Interfaces:** Produces `DEMO_MODELS`, `DemoModel`, `isDemoModel(value: unknown): value is DemoModel`.

- [ ] Write the failing test:

```ts
import { expect, it } from "vitest";
import { DEMO_MODELS, isDemoModel } from "../src/demo-models-v1";
it("supports all strict models without aliases", () => {
  expect(DEMO_MODELS).toEqual(["BOC", "DIR_CLOSE", "HTF_FLIP"]);
  for (const model of DEMO_MODELS) expect(isDemoModel(model)).toBe(true);
  for (const value of ["FLIP", "LEGACY_BREAK_CANDLE", "boc", null, {}, 1])
    expect(isDemoModel(value)).toBe(false);
  expect(Object.isFrozen(DEMO_MODELS)).toBe(true);
});
```

- [ ] Run `npm --prefix apps/execution-edge test -- test/demo-models-v1.test.ts`; expect missing-module failure.
- [ ] Implement the registry:

```ts
export const DEMO_MODELS = Object.freeze(["BOC", "DIR_CLOSE", "HTF_FLIP"] as const);
export type DemoModel = (typeof DEMO_MODELS)[number];
export function isDemoModel(value: unknown): value is DemoModel {
  return typeof value === "string" && DEMO_MODELS.some(model => model === value);
}
```

- [ ] Rerun the test; expect pass. Review the diff for accidental legacy changes.

## Task 2: Required per-model geometry policy

**Files:** Create `apps/execution-edge/src/demo-geometry-policy-v1.ts`; create `apps/execution-edge/test/demo-geometry-policy-v1.test.ts`.

**Interfaces:** Consumes `DemoModel`. Produces `GeometryPolicy`, `readGeometryPolicy(value: unknown): GeometryPolicy | null`.

This stage supports explicit integer tick distances only as a configuration
representation. It does not select distances, establish profitability, convert
source/broker prices or submit an order. A future structural-wick policy requires
its own discriminant and validator; do not reinterpret this one.

- [ ] Write failing tests for each model and rejection of missing, extra, inherited,
  fractional, zero, negative and unsafe fields:

```ts
import { expect, it } from "vitest";
import { readGeometryPolicy } from "../src/demo-geometry-policy-v1";
it("requires explicit geometry and a canonical model", () => {
  for (const model of ["BOC", "DIR_CLOSE", "HTF_FLIP"]) {
    const value = { model, kind: "FIXED_BROKER_TICKS", stopTicks: 10, targetTicks: 20 };
    expect(readGeometryPolicy(value)).toEqual(value);
    for (const stopTicks of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "10"])
      expect(readGeometryPolicy({ ...value, stopTicks })).toBeNull();
    expect(readGeometryPolicy({ ...value, extra: true })).toBeNull();
    expect(readGeometryPolicy({ ...value, targetTicks: undefined })).toBeNull();
    expect(readGeometryPolicy(Object.create(value))).toBeNull();
  }
  expect(readGeometryPolicy(null)).toBeNull();
});
```

- [ ] Run `npm --prefix apps/execution-edge test -- test/demo-geometry-policy-v1.test.ts`; expect missing-module failure.
- [ ] Implement the closed validator:

```ts
import { isDemoModel, type DemoModel } from "./demo-models-v1";
export type GeometryPolicy = Readonly<{
  model: DemoModel; kind: "FIXED_BROKER_TICKS"; stopTicks: number; targetTicks: number;
}>;
export function readGeometryPolicy(value: unknown): GeometryPolicy | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) return null;
  const keys = Object.keys(value).sort();
  if (keys.join(",") !== "kind,model,stopTicks,targetTicks") return null;
  const v = value as Record<string, unknown>;
  if (!isDemoModel(v.model) || v.kind !== "FIXED_BROKER_TICKS") return null;
  if (typeof v.stopTicks !== "number" || !Number.isSafeInteger(v.stopTicks) || v.stopTicks <= 0) return null;
  if (typeof v.targetTicks !== "number" || !Number.isSafeInteger(v.targetTicks) || v.targetTicks <= 0) return null;
  return Object.freeze({ model: v.model, kind: v.kind, stopTicks: v.stopTicks, targetTicks: v.targetTicks });
}
```

- [ ] Add symmetric invalid-target tests and assert returned object is frozen.
- [ ] Run the focused test and typecheck; expect pass. Fixture distances are never operational defaults.

## Task 3: All-model readiness without an execution grant

**Files:** Create `apps/execution-edge/src/demo-model-readiness-v1.ts`; create `apps/execution-edge/test/demo-model-readiness-v1.test.ts`.

**Interfaces:** Consumes `DEMO_MODELS`, `readGeometryPolicy`, `GeometryPolicy`. Produces `ModelReadiness` and `assessModelReadiness(value: unknown): ModelReadiness`.

- [ ] Write failing tests:

```ts
import { expect, it } from "vitest";
import { assessModelReadiness } from "../src/demo-model-readiness-v1";
it("requires one policy for every model and never grants execution", () => {
  const policies = ["BOC", "DIR_CLOSE", "HTF_FLIP"].map(model =>
    ({ model, kind: "FIXED_BROKER_TICKS", stopTicks: 10, targetTicks: 20 }));
  expect(assessModelReadiness(policies)).toMatchObject({ ready: true, executionAllowed: false });
  for (const value of [null, [], policies.slice(1), [...policies, policies[0]],
    [policies[0], policies[0], policies[2]], [...policies.slice(0, 2), {}]])
    expect(assessModelReadiness(value)).toEqual({ ready: false, executionAllowed: false,
      reason: "ALL_MODEL_POLICIES_REQUIRED" });
});
```

- [ ] Run `npm --prefix apps/execution-edge test -- test/demo-model-readiness-v1.test.ts`; expect missing-module failure.
- [ ] Implement:

```ts
import { DEMO_MODELS } from "./demo-models-v1";
import { readGeometryPolicy, type GeometryPolicy } from "./demo-geometry-policy-v1";
export type ModelReadiness =
  | Readonly<{ ready: false; executionAllowed: false; reason: "ALL_MODEL_POLICIES_REQUIRED" }>
  | Readonly<{ ready: true; executionAllowed: false; policies: readonly GeometryPolicy[] }>;
export function assessModelReadiness(value: unknown): ModelReadiness {
  const blocked = Object.freeze({ ready: false, executionAllowed: false,
    reason: "ALL_MODEL_POLICIES_REQUIRED" } as const);
  if (!Array.isArray(value) || value.length !== 3) return blocked;
  const policies = Array.from(value, readGeometryPolicy);
  if (policies.some(p => p === null)) return blocked;
  const valid = policies as GeometryPolicy[];
  if (!DEMO_MODELS.every(model => valid.filter(p => p.model === model).length === 1)) return blocked;
  const ordered = DEMO_MODELS.map(model => valid.find(p => p.model === model)!);
  return Object.freeze({ ready: true, executionAllowed: false,
    policies: Object.freeze(ordered) });
}
```

- [ ] Add permutation and sparse-array tests; output must be canonical and sparse arrays rejected.
- [ ] Run all three focused tests, `npm --prefix apps/execution-edge run typecheck`, and the complete execution-edge suite. Record commands and actual counts, not expected counts.
- [ ] Review changed files; no production import of this readiness function may exist yet. Save results in `docs/audits/2026-09-14-demo-policy-foundation.md` in the docs worktree.

## Coverage and remaining release work

This plan covers model naming and explicit all-model geometry readiness only.
It is not an implementation plan for the entire approved design. Follow-on
subsystem plans must cover: three-model ordered evidence/proposal versions and
Pine generation; broker geometry and full account/risk policy; durable candidate
arbitration/reservations; demo command lifecycle and reconciliation; EA transport
and execution; private data/dashboard; release packaging and external acceptance;
and separate research evaluation. None is marked complete by this foundation.

Before any geometry-to-order integration, confirm whether the owner intends fixed
distances, structural wick stops or another precisely defined rule for each model.
The fixed-distance representation above must not determine strategy behavior by
default. The final release remains all three models even if internal stages are
delivered independently.
