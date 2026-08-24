# Dashboard Integrity Manifest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Freeze the reviewed private dashboard release so any dashboard source change fails the repository boundary verifier until its integrity manifest is deliberately regenerated and reviewed.

**Architecture:** A checked-in manifest records SHA-256 digests for the three approved dashboard TypeScript source files. The existing boundary verifier validates the manifest schema, exact source-file set, and each digest before its existing defense-in-depth semantic scans. A separate explicit generator writes the manifest only when the source directory contains exactly the approved files; verification never rewrites it.

**Tech Stack:** Node.js ESM, Node `crypto`/`fs`, TypeScript AST verifier, Vitest, npm.

---

## File structure

- Create: `apps/agent-health-console/dashboard-integrity-manifest.v1.json` — reviewed source path/digest manifest.
- Create: `scripts/write-dashboard-integrity-manifest.mjs` — explicit local generator; never run by CI/build automatically.
- Modify: `scripts/verify-mt5-dry-run-boundary.mjs` — exports and invokes manifest validation before scanning dashboard source.
- Modify: `apps/execution-edge/test/mt5-dry-run-boundary.test.ts` — manifest mutation and temporary-repository regression coverage.
- Modify: `apps/agent-health-console/README.md` — documented intentional update protocol.
- Modify: `.superpowers/sdd/2026-08-24-private-mt5-health-dashboard/progress.md` — architecture decision and final outcome.

### Task 1: Prove the dashboard release is immutable by default

**Files:**

- Create: `apps/agent-health-console/dashboard-integrity-manifest.v1.json`
- Modify: `scripts/verify-mt5-dry-run-boundary.mjs`
- Test: `apps/execution-edge/test/mt5-dry-run-boundary.test.ts`

- [ ] **Step 1: Write failing manifest tests**

Add an isolated temporary dashboard fixture helper and tests that call an exported `verifyDashboardIntegrityManifest(root)` function. The fixture must create exactly the three approved source paths and a manifest with SHA-256 values. Add individual assertions for a changed source digest, an unexpected `extra.ts` source file, a duplicate manifest path, and a malformed digest:

```ts
expect(verifyDashboardIntegrityManifest(root)).toEqual([]);
writeFileSync(join(root, "apps/agent-health-console/src/index.ts"), "export default {};\n");
expect(verifyDashboardIntegrityManifest(root)).toContain("DASHBOARD_INTEGRITY_MISMATCH");
```

```ts
writeFileSync(join(dashboardSource, "extra.ts"), "export const extra = true;\n");
expect(verifyDashboardIntegrityManifest(root)).toContain("DASHBOARD_SOURCE_FILE_NOT_ALLOWLISTED");
```

- [ ] **Step 2: Run the manifest test to verify it fails**

Run:

```bash
npm test -- mt5-dry-run-boundary.test.ts
```

Expected: FAIL because `verifyDashboardIntegrityManifest` is not exported and no manifest is enforced.

- [ ] **Step 3: Implement an exact manifest validator**

In `scripts/verify-mt5-dry-run-boundary.mjs`, define immutable constants:

```js
const dashboardSourceRelativePaths = [
  "dashboard-html.ts",
  "health-summary-v1.ts",
  "index.ts",
];
const dashboardManifestRelativePath = "apps/agent-health-console/dashboard-integrity-manifest.v1.json";
```

Export `verifyDashboardIntegrityManifest(root = repositoryRoot)`. It must recursively enumerate `.ts` files under `apps/agent-health-console/src`, require the exact sorted path set above, parse JSON, require:

```json
{
  "schema_version": "DashboardIntegrityManifestV1",
  "files": [
    { "path": "dashboard-html.ts", "sha256": "64-lowercase-hex-characters" }
  ]
}
```

The validator must reject missing/malformed manifests, wrong schema, duplicate/missing/extra paths, non-lowercase-hex digests, and digest mismatches. Use `createHash("sha256").update(readFileSync(file)).digest("hex")`. It returns sorted violation strings and never writes a file.

Call it at the start of `runBoundaryVerifier` and append its violations before the existing semantic source scans. Keep the semantic scanner as defense in depth only.

- [ ] **Step 4: Add the reviewed manifest and generate it deliberately**

Create `scripts/write-dashboard-integrity-manifest.mjs`. It must use the same three fixed relative paths, reject an unexpected/missing dashboard `.ts` file, compute SHA-256 values from bytes, serialize sorted two-space JSON with a final newline, and write only `apps/agent-health-console/dashboard-integrity-manifest.v1.json` relative to the repository root. Run the script once to create the manifest. Do not invoke the generator from `package.json`, the build, tests, or the verifier.

- [ ] **Step 5: Run targeted tests to verify green**

Run:

```bash
npm test -- mt5-dry-run-boundary.test.ts
node scripts/verify-mt5-dry-run-boundary.mjs
```

Expected: the new manifest regressions pass and the real repository reports `MT5 dry-run boundary verified` with no violations.

- [ ] **Step 6: Commit the immutable-release guard**

```bash
git add scripts/verify-mt5-dry-run-boundary.mjs scripts/write-dashboard-integrity-manifest.mjs \
  apps/agent-health-console/dashboard-integrity-manifest.v1.json \
  apps/execution-edge/test/mt5-dry-run-boundary.test.ts
git commit -m "fix: lock reviewed dashboard release"
```

### Task 2: Document the intentional update process and complete verification

**Files:**

- Modify: `apps/agent-health-console/README.md`
- Modify: `.superpowers/sdd/2026-08-24-private-mt5-health-dashboard/progress.md`
- Test: existing execution-edge and dashboard test suites.

- [ ] **Step 1: Document the manual manifest update protocol**

Add a short `Dashboard integrity manifest` section to `apps/agent-health-console/README.md` stating that the three dashboard source files are frozen, the verifier fails on every source change, and an authorized code change requires this exact local sequence:

```bash
node scripts/write-dashboard-integrity-manifest.mjs
npm test --prefix apps/execution-edge -- mt5-dry-run-boundary.test.ts
node scripts/verify-mt5-dry-run-boundary.mjs
```

State that the generated manifest must be reviewed in the same change and that the command does not deploy Cloudflare or change MT5.

- [ ] **Step 2: Record the replacement boundary decision**

Update the ignored SDD ledger to state that source-pattern scanning was not sufficient as a primary no-capability proof, the manifest now locks the exact reviewed dashboard release, and any future source change requires a conscious manifest/review update. Include the cost: dashboard edits become intentionally more deliberate.

- [ ] **Step 3: Run full verification**

Run:

```bash
npm test --prefix apps/execution-edge
npm run lint --prefix apps/execution-edge
npm run typecheck --prefix apps/execution-edge
npm run build --prefix apps/execution-edge
npm test --prefix apps/agent-health-console
npm run typecheck --prefix apps/agent-health-console
npm run build --prefix apps/agent-health-console
node scripts/verify-mt5-dry-run-boundary.mjs
git diff --check
```

Expected: all commands pass, the boundary verifier has zero violations, and the dashboard build uses its checked-in Dry Run Wrangler configuration.

- [ ] **Step 4: Commit documentation and verification updates**

```bash
git add apps/agent-health-console/README.md
git commit -m "docs: document dashboard integrity updates"
```

## Plan self-review

- Spec coverage: Task 1 implements the exact reviewed-file lock and deliberate generator; Task 2 documents the required reviewed-update process and preserves full verification.
- Placeholder scan: no placeholders or deferred implementation steps remain.
- Type consistency: the manifest schema, `verifyDashboardIntegrityManifest(root)` name, fixed source paths, generator filename, and violation names are used consistently across tasks.
