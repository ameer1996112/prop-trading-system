import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, relative, resolve } from "node:path";
import * as ts from "typescript";
import { describe, expect, it } from "vitest";
import { validateSignalEvidenceV1 } from "../src/signal-evidence-v1";

type SourceSet = ReadonlyMap<string, string>;

const repositoryRoot = resolve(dirname(new URL(import.meta.url).pathname), "../../..");
const bridge = "apps/observation-edge/src/signal-evidence-v1.ts";
const identity = "apps/observation-edge/src/signal-evidence-identity-v1.ts";
const decision = "apps/observation-edge/src/signal-admission-decision-v1.ts";
const route = "apps/observation-edge/src/signal-admission-route-v1.ts";
const store = "apps/observation-edge/src/signal-admission-store-v1.ts";
const outbox = "apps/observation-edge/src/signal-admission-outbox-v1.ts";
const registration = "apps/observation-edge/src/signal-admission-registration-v1.ts";
const wire = "apps/observation-edge/src/signal-admission-wire-v1.ts";
const inbox = "apps/execution-edge/src/signal-evidence-inbox-v1.ts";
const observationIndex = "apps/observation-edge/src/index.ts";
const executionIndex = "apps/execution-edge/src/index.ts";
const strictJson = "apps/observation-edge/src/strict-json.ts";
// Edges are reviewed per importer. Membership in this map grants no blanket
// permission to import any other admission component.
const admissionDependencies = new Map<string, ReadonlySet<string>>([
  [route, new Set([outbox, registration, store, wire, strictJson])],
  [store, new Set([decision, registration, wire])],
  [decision, new Set([bridge, registration, wire])],
  [outbox, new Set([store, strictJson])],
  [registration, new Set([wire, strictJson])],
  [wire, new Set([strictJson])],
  [inbox, new Set(["apps/execution-edge/src/canonical.ts", "apps/execution-edge/src/telemetry-schema-v2.ts"])],
]);
const reviewedDependencies = new Map(admissionDependencies);
for (const [name, dependencies] of Object.entries({
  "rd-entry-policy": ["rd-entry-domain"],
  "rd-entry-domain-v3": ["rd-entry-policy"],
  "rd-entry-wire-v3": ["rd-entry-domain-v3", "rd-entry-arbitrator-v3", "strict-json", "types"],
  "rd-entry-arbitrator-v3": ["rd-entry-domain-v3", "rd-entry-matcher-v3"],
  "rd-entry-matcher-v3": ["rd-entry-domain-v3"],
  "rd-entry-domain": ["types", "validation"],
  "types": ["rd-entry-wire", "rd-entry-wire-v3"],
  "rd-entry-wire": ["rd-entry-domain", "rd-entry-matcher", "rd-entry-policy", "rd-entry-source-catalog", "strict-json", "types"],
  "rd-entry-matcher": ["rd-entry-domain", "rd-entry-policy"],
  "rd-entry-source-catalog": [],
  "validation": ["strict-json", "types", "paper-simulator-contract", "rd-entry-wire", "rd-entry-wire-v3"],
  "paper-simulator-contract": ["strict-json", "types", "paper-ledger-contract"],
  "paper-ledger-contract": ["strict-json", "types"],
  "strict-json": [],
})) reviewedDependencies.set(`apps/observation-edge/src/${name}.ts`, new Set(dependencies.map(dependency => `apps/observation-edge/src/${dependency}.ts`)));
reviewedDependencies.set("apps/execution-edge/src/canonical.ts", new Set());
reviewedDependencies.set("apps/execution-edge/src/telemetry-schema-v2.ts", new Set(["apps/execution-edge/src/canonical.ts", "apps/execution-edge/src/telemetry-values-v2.ts"]));
reviewedDependencies.set("apps/execution-edge/src/telemetry-values-v2.ts", new Set());
const evidenceModules = new Set([bridge, identity]);
const sourceExtensions = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs"]);
const excludedDirectories = new Set([".git", ".superpowers", "node_modules", "test", "tests", "docs", "dist"]);

function productionSources(root: string): Map<string, string> {
  const result = new Map<string, string>();
  function visit(directory: string): void {
    for (const name of readdirSync(directory)) {
      if (excludedDirectories.has(name)) continue;
      const path = resolve(directory, name);
      const status = statSync(path);
      if (status.isDirectory()) visit(path);
      else if (status.isFile() && sourceExtensions.has(extname(name))) {
        result.set(relative(root, path).replaceAll("\\", "/"), readFileSync(path, "utf8"));
      }
    }
  }
  visit(root);
  return result;
}

function importedSpecifiers(file: string, source: string): string[] {
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const imports: string[] = [];
  function visit(node: ts.Node): void {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier !== undefined && ts.isStringLiteral(node.moduleSpecifier)) {
      imports.push(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node) && node.arguments.length === 1 &&
      ((node.expression.kind === ts.SyntaxKind.ImportKeyword) || (ts.isIdentifier(node.expression) && node.expression.text === "require")) &&
      ts.isStringLiteral(node.arguments[0]!)) {
      imports.push(node.arguments[0]!.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  return imports;
}

function resolveLocalImport(importer: string, specifier: string, sources: SourceSet): string | null {
  if (!specifier.startsWith(".")) return null;
  const base = resolve("/repo", dirname(importer), specifier).slice("/repo/".length).replaceAll("\\", "/");
  for (const candidate of [base, ...[...sourceExtensions].map(extension => `${base}${extension}`), ...[...sourceExtensions].map(extension => `${base}/index${extension}`)]) {
    if (sources.has(candidate)) return candidate;
  }
  return null;
}

function capabilityViolations(sources: SourceSet): string[] {
  const violations: string[] = [];
  const allowedBridgeDependencies = new Set([
    "apps/observation-edge/src/types.ts",
    "apps/observation-edge/src/rd-entry-policy.ts",
    "apps/observation-edge/src/rd-entry-domain-v3.ts",
    "apps/observation-edge/src/rd-entry-wire-v3.ts",
    "apps/observation-edge/src/strict-json.ts",
    identity,
  ]);
  const allowedIdentityDependencies = new Set([
    "apps/observation-edge/src/rd-entry-policy.ts",
    "apps/observation-edge/src/strict-json.ts",
  ]);

  for (const [file, source] of sources) {
    for (const specifier of importedSpecifiers(file, source)) {
      const target = resolveLocalImport(file, specifier, sources);
      const dependencies = reviewedDependencies.get(file);
      if (dependencies && target !== null && !dependencies.has(target)) {
        violations.push(`${file} imports unapproved production dependency ${target}`);
      }
      if (dependencies && target === null) {
        violations.push(`${file} imports ${specifier.startsWith(".") ? "unresolved local dependency" : "external capability"} ${specifier}`);
      }
      if (target !== null && admissionDependencies.has(target)
        && !dependencies?.has(target)
        && !(file === observationIndex && target === route)
        && !(file === executionIndex && target === inbox)) {
        violations.push(`${file} imports unapproved admission module ${target}`);
      }
      // Reviewed pure admission consumer only; no route or execution consumer.
      if (target !== null && evidenceModules.has(target) && file !== bridge && !(file === decision && target === bridge)) {
        violations.push(`${file} imports evidence module ${target}`);
      }
      if (file === bridge && target !== null && !allowedBridgeDependencies.has(target)) {
        violations.push(`${bridge} imports unapproved production dependency ${target}`);
      }
      if (file === identity && target !== null && !allowedIdentityDependencies.has(target)) {
        violations.push(`${identity} imports unapproved production dependency ${target}`);
      }
      if (evidenceModules.has(file) && target === null && !specifier.startsWith(".")) {
        violations.push(`${file} imports external capability ${specifier}`);
      }
      if (evidenceModules.has(file) && target === null && specifier.startsWith(".")) {
        violations.push(`${file} imports unresolved local dependency ${specifier}`);
      }
    }
  }
  return violations.sort();
}

const vectorPath = resolve(repositoryRoot, "contracts/vectors/signal-evidence-v1.json");
const vectors = JSON.parse(readFileSync(vectorPath, "utf8")) as {
  cases: Array<{ case_id: string; input: unknown; reviewed_binding: unknown }>;
};
const sixModelDirectionCases = new Set([
  "strict_long_boc_only",
  "strict_short_boc_only",
  "close_fallback_after_blocked_aggressive_models",
  "close_fallback_after_blocked_aggressive_models_short",
  "flip_before_boc",
  "flip_before_boc_short",
]);
const encode = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value));
const prohibitedAuthorityFields = /^(?:account(?:_|$)|volume(?:_|$)|command(?:_|$))/u;

describe("signal evidence capability boundary", () => {
  it("rejects capability dependencies and unreviewed consumers throughout admission", () => {
    const sources = productionSources(repositoryRoot);
    sources.set(decision, sources.get(decision)! + '\nimport "node:fs";');
    sources.set("apps/observation-edge/src/order.ts", 'import "./signal-admission-decision-v1";');
    sources.set("apps/observation-edge/src/coordinator.ts", 'import "./signal-admission-store-v1";');
    expect(capabilityViolations(sources)).toEqual(expect.arrayContaining([
      `${decision} imports external capability node:fs`,
      `apps/observation-edge/src/order.ts imports unapproved admission module ${decision}`,
      `apps/observation-edge/src/coordinator.ts imports unapproved admission module ${store}`,
    ]));
  });
  it("rejects unreviewed edges and external capabilities in every reviewed dependency", () => {
    const sources = productionSources(repositoryRoot);
    for (const file of reviewedDependencies.keys()) sources.set(file, sources.get(file)! + '\nimport "node:fs";');
    const violations = capabilityViolations(sources);
    for (const file of reviewedDependencies.keys()) expect(violations).toContain(`${file} imports external capability node:fs`);
    sources.set(decision, sources.get(decision)! + '\nimport "./signal-admission-outbox-v1";');
    expect(capabilityViolations(sources)).toContain(`${decision} imports unapproved production dependency ${outbox}`);
  });
  it("proves the AST scanner detects route consumers and forbidden bridge capabilities", () => {
    const synthetic = new Map<string, string>([
      [bridge, 'import "node:fs/promises"; import "node:cluster"; import "./missing-bridge-adapter"; import "./signal-evidence-identity-v1";'],
      [identity, 'import "node:readline"; import "node:perf_hooks"; import "./missing-identity-store"; import "./rd-entry-policy";'],
      ["apps/observation-edge/src/routes/execute.ts", 'export { validateSignalEvidenceV1 } from "../signal-evidence-v1";'],
      ["apps/observation-edge/src/order.ts", 'import "./signal-evidence-v1";'],
      ["apps/observation-edge/src/coordinator.ts", 'import "./signal-evidence-identity-v1";'],
      ["apps/observation-edge/src/rd-entry-policy.ts", "export {};"],
    ]);
    expect(capabilityViolations(synthetic)).toEqual([
      `apps/observation-edge/src/coordinator.ts imports evidence module ${identity}`,
      `apps/observation-edge/src/order.ts imports evidence module ${bridge}`,
      `apps/observation-edge/src/routes/execute.ts imports evidence module ${bridge}`,
      `${identity} imports external capability node:perf_hooks`,
      `${identity} imports external capability node:readline`,
      `${identity} imports unresolved local dependency ./missing-identity-store`,
      `${bridge} imports external capability node:cluster`,
      `${bridge} imports external capability node:fs/promises`,
      `${bridge} imports unresolved local dependency ./missing-bridge-adapter`,
    ]);
  });

  it("enumerates production imports with only the reviewed pure admission consumer", () => {
    const sources = productionSources(repositoryRoot);
    expect(sources.has(bridge)).toBe(true);
    expect(sources.has(identity)).toBe(true);
    expect(capabilityViolations(sources)).toEqual([]);
  });

  it("allows only the reviewed route to store to decision integration chain", () => {
    const sources = productionSources(repositoryRoot);
    expect(importedSpecifiers(route, sources.get(route)!)).toContain("./signal-admission-store-v1");
    expect(importedSpecifiers(store, sources.get(store)!)).toContain("./signal-admission-decision-v1");
  });
});

describe("signal evidence authority invariants", () => {
  it("marks every successful container and entry evidence-only with no command authority fields", async () => {
    expect(vectors.cases.filter(item => sixModelDirectionCases.has(item.case_id)).map(item => item.case_id).sort())
      .toEqual([...sixModelDirectionCases].sort());
    for (const vector of vectors.cases) {
      const result = await validateSignalEvidenceV1(encode(vector.input), encode(vector.reviewed_binding));
      expect(result.status, vector.case_id).toBe("VALIDATED");
      if (result.status !== "VALIDATED") continue;
      expect(result.authority).toBe("EVIDENCE_ONLY");
      expect(result.execution_allowed).toBe(false);
      expect(Object.keys(result).filter(key => prohibitedAuthorityFields.test(key))).toEqual([]);
      expect(result.entries.length).toBeGreaterThan(0);
      for (const entry of result.entries) {
        expect(entry.authority).toBe("EVIDENCE_ONLY");
        expect(entry.execution_allowed).toBe(false);
        expect(Object.keys(entry).filter(key => prohibitedAuthorityFields.test(key))).toEqual([]);
      }
    }
  });
});
