import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const verifier = new URL("../../../scripts/verify-mt5-dry-run-boundary.mjs", import.meta.url);

async function loadVerifier() {
  expect(existsSync(verifier), "the MT5 dry-run boundary verifier must exist").toBe(true);
  return import(verifier.href);
}

describe("MT5 dry-run boundary", () => {
  it("allows only the frozen PAPER_ONLY candidate contract in the real repository", async () => {
    const { runBoundaryVerifier } = await loadVerifier();

    const candidateContract = new URL("../src/execution-candidate-v2.ts", import.meta.url);
    expect(readFileSync(candidateContract, "utf8")).toContain('readonly execution_mode: "PAPER_ONLY";');
    expect(runBoundaryVerifier()).toEqual({ ok: true, violations: [] });
  });

  it("rejects dashboard references to sync, execution, and outbound network capability", async () => {
    const { scanHealthDashboardSource } = await loadVerifier();

    expect(typeof scanHealthDashboardSource).toBe("function");
    expect(scanHealthDashboardSource('export default { fetch(){ return new Response("ok"); } };')).toEqual([]);
    expect(scanHealthDashboardSource('const endpoint = "/api/v1/agent/sync";')).toContain(
      "DASHBOARD_MT5_SYNC_REFERENCE_FORBIDDEN",
    );
    expect(scanHealthDashboardSource("function placeOrder() {}")).toContain(
      "DASHBOARD_EXECUTION_REFERENCE_FORBIDDEN",
    );
    expect(scanHealthDashboardSource('export default { async fetch(){ return fetch("https://broker.example"); } };')).toContain(
      "DASHBOARD_OUTBOUND_NETWORK_FORBIDDEN",
    );
    expect(scanHealthDashboardSource('const endpoint = "https://broker.example"; fetch(endpoint);')).toContain(
      "DASHBOARD_OUTBOUND_NETWORK_FORBIDDEN",
    );
    expect(scanHealthDashboardSource('fetch(new URL("https://broker.example"));')).toContain(
      "DASHBOARD_OUTBOUND_NETWORK_FORBIDDEN",
    );
    expect(scanHealthDashboardSource('fetch?.("https://broker.example");')).toContain(
      "DASHBOARD_OUTBOUND_NETWORK_FORBIDDEN",
    );
    expect(scanHealthDashboardSource('globalThis.fetch("https://broker.example");')).toContain(
      "DASHBOARD_OUTBOUND_NETWORK_FORBIDDEN",
    );
    expect(scanHealthDashboardSource('fetch?.("/api/v1/health-summary");')).toContain(
      "DASHBOARD_OUTBOUND_NETWORK_FORBIDDEN",
    );
    expect(scanHealthDashboardSource('globalThis.fetch("/api/v1/health-summary");')).toContain(
      "DASHBOARD_OUTBOUND_NETWORK_FORBIDDEN",
    );
    expect(scanHealthDashboardSource('window.fetch("/api/v1/health-summary");')).toContain(
      "DASHBOARD_OUTBOUND_NETWORK_FORBIDDEN",
    );
    expect(scanHealthDashboardSource('client["fetch"]("/api/v1/health-summary");')).toContain(
      "DASHBOARD_OUTBOUND_NETWORK_FORBIDDEN",
    );
    expect(scanHealthDashboardSource('(fetch)("/api/v1/health-summary");')).toContain(
      "DASHBOARD_OUTBOUND_NETWORK_FORBIDDEN",
    );
    expect(scanHealthDashboardSource('const f = fetch; f("https://broker.example");')).toContain(
      "DASHBOARD_OUTBOUND_NETWORK_FORBIDDEN",
    );
    expect(scanHealthDashboardSource('const page = `<script>globalThis.fetch("https://broker.example")</script>`;')).toContain(
      "DASHBOARD_OUTBOUND_NETWORK_FORBIDDEN",
    );
    expect(scanHealthDashboardSource('const page = `<script>${0}; globalThis.fetch("https://broker.example")</script>`;')).toContain(
      "DASHBOARD_OUTBOUND_NETWORK_FORBIDDEN",
    );
    expect(scanHealthDashboardSource('fetch("/api/v1/health-summary", { method: "GET" });')).toContain(
      "DASHBOARD_OUTBOUND_NETWORK_FORBIDDEN",
    );
    expect(scanHealthDashboardSource('fetch("/api/v1/health-summary");')).toEqual([]);
    expect(scanHealthDashboardSource('const page = `<script>fetch("/api/v1/health-summary")</script>`;')).toEqual([]);
    expect(scanHealthDashboardSource('const title = "MT5 DRY_RUN Health";')).toEqual([]);
  });

  it("scans health dashboard TypeScript without changing execution-edge or MT5 scope", async () => {
    const { runBoundaryVerifier } = await loadVerifier();
    const root = mkdtempSync(join(tmpdir(), "mt5-dry-run-boundary-"));

    try {
      const dashboard = join(root, "apps/agent-health-console/src");
      const execution = join(root, "apps/execution-edge/src");
      const mt5 = join(root, "mt5/TradeOpsAgent");
      mkdirSync(dashboard, { recursive: true });
      mkdirSync(execution, { recursive: true });
      mkdirSync(mt5, { recursive: true });
      writeFileSync(join(dashboard, "unsafe.ts"), 'const endpoint = "/api/v1/agent/sync";\n');
      writeFileSync(join(execution, "safe.ts"), 'const config = { execution_mode: "DRY_RUN" };\n');
      writeFileSync(join(mt5, "safe.mq5"), "void f() {}\n");

      expect(runBoundaryVerifier(root)).toEqual({
        ok: false,
        violations: ["DASHBOARD_MT5_SYNC_REFERENCE_FORBIDDEN"],
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects Worker execution authority escalations", async () => {
    const { scanWorkerSource } = await loadVerifier();

    expect(typeof scanWorkerSource).toBe("function");
    expect(scanWorkerSource('const execution_mode = "LIVE";')).toContain(
      "WORKER_EXECUTION_MODE_NOT_DRY_RUN",
    );
    expect(scanWorkerSource("const config = { execution_mode: LIVE }; ")).toContain(
      "WORKER_EXECUTION_MODE_NOT_DRY_RUN",
    );
    expect(scanWorkerSource('interface Candidate { readonly execution_mode: "PAPER_ONLY"; }')).toContain(
      "WORKER_EXECUTION_MODE_NOT_DRY_RUN",
    );
    expect(scanWorkerSource('const config = { "execution_mode": "LIVE" };')).toContain(
      "WORKER_EXECUTION_MODE_NOT_DRY_RUN",
    );
    expect(scanWorkerSource('const config = { ["execution_mode"]: "LIVE" };')).toContain(
      "WORKER_EXECUTION_MODE_NOT_DRY_RUN",
    );
    expect(scanWorkerSource('const config = { [`execution_mode`]: `LIVE` };')).toContain(
      "WORKER_EXECUTION_MODE_NOT_DRY_RUN",
    );
    expect(scanWorkerSource('const config = { execution_mode /* comment */: "LIVE" };')).toContain(
      "WORKER_EXECUTION_MODE_NOT_DRY_RUN",
    );
    expect(scanWorkerSource('const config = { ["execution" + "_mode"]: "LIVE" };')).toContain(
      "WORKER_EXECUTION_MODE_NOT_DRY_RUN",
    );
    expect(scanWorkerSource('const config = { [`execution_${"mode"}`]: "LIVE" };')).toContain("WORKER_EXECUTION_MODE_NOT_DRY_RUN");
    expect(scanWorkerSource('const config = { [("execution_mode")]: "LIVE" };')).toContain("WORKER_EXECUTION_MODE_NOT_DRY_RUN");
    expect(scanWorkerSource('class X { public execution_mode = "LIVE"; }')).toContain("WORKER_EXECUTION_MODE_NOT_DRY_RUN");
    expect(scanWorkerSource('execution_mode += "LIVE";')).toContain("WORKER_EXECUTION_MODE_NOT_DRY_RUN");
    expect(scanWorkerSource('Object.defineProperty(x, "execution_mode", { value: "LIVE" });')).toContain("WORKER_EXECUTION_MODE_NOT_DRY_RUN");
    expect(scanWorkerSource('Reflect.defineProperty(x, "execution_mode", { value: "LIVE" });')).toContain("WORKER_EXECUTION_MODE_NOT_DRY_RUN");
    expect(scanWorkerSource('function candidate({ execution_mode = "LIVE" }) {}')).toContain("WORKER_EXECUTION_MODE_NOT_DRY_RUN");
    expect(scanWorkerSource('const config = { execution_mode: "DRY_RUN" };')).toEqual([]);
    expect(scanWorkerSource('const config = { execution_mode: "DRY_RUN" + "LIVE" };')).toContain(
      "WORKER_EXECUTION_MODE_NOT_DRY_RUN",
    );
    expect(scanWorkerSource('execution_mode ||= "LIVE";')).toContain(
      "WORKER_EXECUTION_MODE_NOT_DRY_RUN",
    );
    expect(scanWorkerSource('execution_mode ??= "LIVE";')).toContain(
      "WORKER_EXECUTION_MODE_NOT_DRY_RUN",
    );
    expect(scanWorkerSource('obj["execution_mode"] &&= "LIVE";')).toContain(
      "WORKER_EXECUTION_MODE_NOT_DRY_RUN",
    );
    expect(scanWorkerSource("const config = { real_execution_allowed: true }; ")).toContain(
      "WORKER_REAL_EXECUTION_ALLOWED_FORBIDDEN",
    );
    expect(scanWorkerSource("real_execution_allowed = true;")).toContain(
      "WORKER_REAL_EXECUTION_ALLOWED_FORBIDDEN",
    );
    expect(scanWorkerSource('const config = { "real_execution_allowed": true };')).toContain(
      "WORKER_REAL_EXECUTION_ALLOWED_FORBIDDEN",
    );
    expect(scanWorkerSource('const config = { ["real_execution_allowed"]: true };')).toContain(
      "WORKER_REAL_EXECUTION_ALLOWED_FORBIDDEN",
    );
    expect(scanWorkerSource('obj["real_execution_allowed"] = true;')).toContain(
      "WORKER_REAL_EXECUTION_ALLOWED_FORBIDDEN",
    );
    expect(scanWorkerSource('const config = { [`real_execution_allowed`]: true };')).toContain(
      "WORKER_REAL_EXECUTION_ALLOWED_FORBIDDEN",
    );
    expect(scanWorkerSource("const config = { real_execution_allowed: Boolean(1) }; ")).toContain(
      "WORKER_REAL_EXECUTION_ALLOWED_FORBIDDEN",
    );
    expect(scanWorkerSource("real_execution_allowed += true;")).toContain("WORKER_REAL_EXECUTION_ALLOWED_FORBIDDEN");
    expect(scanWorkerSource('Reflect.set(x, "real_execution_allowed", true);')).toContain("WORKER_REAL_EXECUTION_ALLOWED_FORBIDDEN");
    expect(scanWorkerSource('Reflect.defineProperty(x, "real_execution_allowed", { value: true });')).toContain("WORKER_REAL_EXECUTION_ALLOWED_FORBIDDEN");
    expect(scanWorkerSource('function candidate({ real_execution_allowed = true }) {}')).toContain("WORKER_REAL_EXECUTION_ALLOWED_FORBIDDEN");
    expect(scanWorkerSource("obj[key] = true;")).toContain("WORKER_REAL_EXECUTION_ALLOWED_FORBIDDEN");
    expect(scanWorkerSource("real_execution_allowed ||= true;")).toContain(
      "WORKER_REAL_EXECUTION_ALLOWED_FORBIDDEN",
    );
    expect(scanWorkerSource("real_execution_allowed ??= true;")).toContain(
      "WORKER_REAL_EXECUTION_ALLOWED_FORBIDDEN",
    );
    expect(scanWorkerSource('obj[`real_execution_allowed`] &&= true;')).toContain(
      "WORKER_REAL_EXECUTION_ALLOWED_FORBIDDEN",
    );
  });

  it("rejects direct MT5 order APIs", async () => {
    const { scan } = await loadVerifier();

    expect(scan("void f(){ OrderSend(r,q); }")).toContain("MT5_ORDER_API_FORBIDDEN");
    expect(scan("void f(){ CTrade trade; }")).toContain("MT5_CTRADE_FORBIDDEN");
    expect(scan("void f(){ PositionClose(1); }")).toContain("MT5_POSITION_CLOSE_FORBIDDEN");
    expect(scan("void f(){ OrderDelete(1); }")).toContain("MT5_ORDER_DELETE_FORBIDDEN");
    expect(scan("void f(){ OrderModify(1); }")).toContain("MT5_ORDER_MODIFY_FORBIDDEN");
  });

  it("rejects MT5 DLL imports", async () => {
    const { scan } = await loadVerifier();

    expect(scan('#import "x.dll"')).toContain("MT5_DLL_IMPORT_FORBIDDEN");
  });

  it("rejects MT5 shell and inbound-listener capability", async () => {
    const { scan } = await loadVerifier();

    expect(scan("ShellExecute(command);")).toContain("MT5_SHELL_FORBIDDEN");
    expect(scan("SocketListen(socket, port);")).toContain("MT5_INBOUND_LISTENER_FORBIDDEN");
  });

  it("rejects template MT5 credentials and WebRequest URLs", async () => {
    const { scan } = await loadVerifier();

    expect(scan("string token = `secret-value`; ")).toContain("MT5_CREDENTIAL_LITERAL_FORBIDDEN");
    expect(scan('WebRequest("GET", `https://example.test`, body);')).toContain(
      "MT5_WEBREQUEST_URL_FORBIDDEN",
    );
    expect(scan('string endpoint = "https://example.test";')).toContain(
      "MT5_WEBREQUEST_URL_FORBIDDEN",
    );
    expect(scan("string endpoint = `https://example.test`; ")).toContain(
      "MT5_WEBREQUEST_URL_FORBIDDEN",
    );
    expect(scan('string authToken = "secret-value";')).toContain("MT5_CREDENTIAL_LITERAL_FORBIDDEN");
    expect(scan("string auth_token = `secret-value`; ")).toContain("MT5_CREDENTIAL_LITERAL_FORBIDDEN");
    expect(scan('string api_secret = "secret-value";')).toContain("MT5_CREDENTIAL_LITERAL_FORBIDDEN");
  });

  it("skips ignored local MT5 artifacts", async () => {
    const { runBoundaryVerifier } = await loadVerifier();
    const root = mkdtempSync(join(tmpdir(), "mt5-dry-run-boundary-"));

    try {
      const local = join(root, "mt5/TradeOpsAgent/local");
      mkdirSync(local, { recursive: true });
      writeFileSync(join(local, "generated.mqh"), "void f(){ OrderSend(r,q); }\n");

      expect(runBoundaryVerifier(root)).toEqual({ ok: true, violations: [] });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("skips generated MT5 source while scanning ordinary EA source", async () => {
    const { runBoundaryVerifier } = await loadVerifier();
    const root = mkdtempSync(join(tmpdir(), "mt5-dry-run-boundary-"));

    try {
      const generated = join(root, "mt5/TradeOpsAgent/generated");
      const include = join(root, "mt5/TradeOpsAgent/Include");
      mkdirSync(generated, { recursive: true });
      mkdirSync(include, { recursive: true });
      writeFileSync(join(generated, "generated.mqh"), "void f(){ CTrade trade; }\n");
      writeFileSync(join(include, "active.mqh"), "void f(){ OrderSend(r,q); }\n");

      expect(runBoundaryVerifier(root)).toEqual({
        ok: false,
        violations: ["MT5_ORDER_API_FORBIDDEN"],
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("scans every Worker TypeScript source file", async () => {
    const { runBoundaryVerifier } = await loadVerifier();
    const root = mkdtempSync(join(tmpdir(), "mt5-dry-run-boundary-"));

    try {
      const source = join(root, "apps/execution-edge/src");
      mkdirSync(source, { recursive: true });
      writeFileSync(join(source, "index.ts"), 'const config = { execution_mode: "DRY_RUN" };\n');
      writeFileSync(join(source, "sibling.ts"), 'const config = { execution_mode: "PAPER_ONLY" };\n');
      writeFileSync(join(source, "nested.ts"), "real_execution_allowed = true;\n");

      expect(runBoundaryVerifier(root)).toEqual({
        ok: false,
        violations: [
          "WORKER_EXECUTION_MODE_NOT_DRY_RUN",
          "WORKER_REAL_EXECUTION_ALLOWED_FORBIDDEN",
        ],
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("scans generated-named execution-edge source without scanning observation-edge", async () => {
    const { runBoundaryVerifier } = await loadVerifier();
    const root = mkdtempSync(join(tmpdir(), "mt5-dry-run-boundary-"));

    try {
      const executionGenerated = join(root, "apps/execution-edge/src/generated");
      const observationSource = join(root, "apps/observation-edge/src");
      mkdirSync(executionGenerated, { recursive: true });
      mkdirSync(observationSource, { recursive: true });
      writeFileSync(join(executionGenerated, "unsafe.ts"), 'execution_mode ||= "LIVE";\n');
      writeFileSync(join(observationSource, "paper-contract.ts"), 'readonly execution_mode: "PAPER_ONLY";\n');

      expect(runBoundaryVerifier(root)).toEqual({
        ok: false,
        violations: ["WORKER_EXECUTION_MODE_NOT_DRY_RUN"],
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects a second PAPER_ONLY form in the allowlisted candidate file", async () => {
    const { runBoundaryVerifier } = await loadVerifier();
    const root = mkdtempSync(join(tmpdir(), "mt5-dry-run-boundary-"));

    try {
      const source = join(root, "apps/execution-edge/src");
      mkdirSync(source, { recursive: true });
      writeFileSync(join(source, "execution-candidate-v2.ts"), [
        'readonly execution_mode: "PAPER_ONLY";',
        'const executionMode = literal(input.execution_mode, "PAPER_ONLY");',
        "const candidate = { execution_mode: executionMode, };",
        'readonly execution_mode: "PAPER_ONLY";',
      ].join("\n"));

      expect(runBoundaryVerifier(root)).toEqual({
        ok: false,
        violations: ["WORKER_EXECUTION_MODE_NOT_DRY_RUN"],
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects a shadowed PAPER_ONLY candidate output", async () => {
    const { runBoundaryVerifier } = await loadVerifier();
    const root = mkdtempSync(join(tmpdir(), "mt5-dry-run-boundary-"));

    try {
      const source = join(root, "apps/execution-edge/src");
      mkdirSync(source, { recursive: true });
      writeFileSync(join(source, "execution-candidate-v2.ts"), [
        'export interface ExecutionCandidateV2 { readonly execution_mode: "PAPER_ONLY"; }',
        'const CANDIDATE_KEYS = ["execution_mode"] as const;',
        "export function validateExecutionCandidateV2(input: Record<string, unknown>) {",
        "  try {",
        '    const executionMode = literal(input.execution_mode, "PAPER_ONLY");',
        "    const executionMode = \"LIVE\" as \"PAPER_ONLY\";",
        "    return Object.freeze({ execution_mode: executionMode, });",
        "  } catch { return null; }",
        "}",
      ].join("\n"));

      expect(runBoundaryVerifier(root)).toEqual({
        ok: false,
        violations: ["WORKER_EXECUTION_MODE_NOT_DRY_RUN"],
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects candidate key spreads in the allowlisted filename", async () => {
    const { runBoundaryVerifier } = await loadVerifier();
    const root = mkdtempSync(join(tmpdir(), "mt5-dry-run-boundary-"));
    try {
      const source = join(root, "apps/execution-edge/src");
      mkdirSync(source, { recursive: true });
      writeFileSync(join(source, "execution-candidate-v2.ts"), [
        'export interface ExecutionCandidateV2 { readonly execution_mode: "PAPER_ONLY"; }',
        'const CANDIDATE_KEYS = ["execution_mode", ...["account_id"]] as const;',
        "export function validateExecutionCandidateV2(input: Record<string, unknown>) { try {",
        'const executionMode = literal(input.execution_mode, "PAPER_ONLY");',
        "return Object.freeze({ execution_mode: executionMode, }); } catch { return null; } }",
      ].join("\n"));
      expect(runBoundaryVerifier(root)).toEqual({ ok: false, violations: ["WORKER_EXECUTION_MODE_NOT_DRY_RUN"] });
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
