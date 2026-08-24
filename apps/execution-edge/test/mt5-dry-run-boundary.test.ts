import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const verifier = new URL("../../../scripts/verify-mt5-dry-run-boundary.mjs", import.meta.url);
const phase0Workflow = new URL("../../../.github/workflows/phase0.yml", import.meta.url);

async function loadVerifier() {
  expect(existsSync(verifier), "the MT5 dry-run boundary verifier must exist").toBe(true);
  return import(verifier.href);
}

type DashboardFixtureFile = readonly [path: string, source: string, sha256: string];

const dashboardFixtureFiles: readonly DashboardFixtureFile[] = [
  ["dashboard-html.ts", "export const dashboard = true;\n", "087ec181c702af59101dc20acb36e24731a34d9db19ea593bf7e5ec833a0f346"],
  ["health-summary-v1.ts", "export const health = true;\n", "c2421597efcdf166f1c9ba0d68fb8bfd9806fffd13510a43595aa5f2f08770cd"],
  ["index.ts", "export const index = true;\n", "48afe2a06bf66c168d1858387c1477488592fa55f785a2cc24fd13784172edad"],
] as const;

function writeDashboardIntegrityFixture(root: string, manifestFiles: readonly DashboardFixtureFile[] = dashboardFixtureFiles) {
  const sourceDirectory = join(root, "apps/agent-health-console/src");
  mkdirSync(sourceDirectory, { recursive: true });
  for (const [path, source] of dashboardFixtureFiles) writeFileSync(join(sourceDirectory, path), source);
  writeFileSync(join(root, "apps/agent-health-console/dashboard-integrity-manifest.v1.json"), `${JSON.stringify({
    schema_version: "DashboardIntegrityManifestV1",
    files: manifestFiles.map(([path, , sha256]) => ({ path, sha256 })),
  }, null, 2)}\n`);
}

function writeDashboardIntegrityManifestForSources(root: string, sourceDirectory: string) {
  const files = ["dashboard-html.ts", "health-summary-v1.ts", "index.ts"].map((path) => ({
    path,
    sha256: createHash("sha256").update(readFileSync(join(sourceDirectory, path))).digest("hex"),
  }));
  writeFileSync(join(root, "apps/agent-health-console/dashboard-integrity-manifest.v1.json"), `${JSON.stringify({
    schema_version: "DashboardIntegrityManifestV1",
    files,
  }, null, 2)}\n`);
}

function writeRealDashboardIntegrityFixture(root: string) {
  const sourceDirectory = join(root, "apps/agent-health-console/src");
  const dashboardSources = new URL("../../agent-health-console/src/", import.meta.url);
  mkdirSync(sourceDirectory, { recursive: true });
  for (const path of ["dashboard-html.ts", "health-summary-v1.ts", "index.ts"]) {
    writeFileSync(join(sourceDirectory, path), readFileSync(new URL(path, dashboardSources), "utf8"));
  }
  writeDashboardIntegrityManifestForSources(root, sourceDirectory);
}

describe("MT5 dry-run boundary", () => {
  it("runs the immutable dashboard boundary verifier in pull-request CI without regenerating the manifest", () => {
    const workflow = readFileSync(phase0Workflow, "utf8");

    expect(workflow).toContain("npm ci --prefix apps/execution-edge --ignore-scripts --no-audit --no-fund");
    expect(workflow).toContain("npm test --prefix apps/execution-edge -- mt5-dry-run-boundary.test.ts");
    expect(workflow).toContain("node scripts/verify-mt5-dry-run-boundary.mjs");
    expect(workflow).not.toMatch(/(?:generate|update)-dashboard-integrity-manifest/iu);
  });

  it("accepts an exact reviewed dashboard integrity manifest", async () => {
    const { verifyDashboardIntegrityManifest } = await loadVerifier();
    const root = mkdtempSync(join(tmpdir(), "dashboard-integrity-"));

    try {
      writeDashboardIntegrityFixture(root);

      expect(verifyDashboardIntegrityManifest(root)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects a dashboard source whose reviewed digest no longer matches", async () => {
    const { verifyDashboardIntegrityManifest } = await loadVerifier();
    const root = mkdtempSync(join(tmpdir(), "dashboard-integrity-"));

    try {
      writeDashboardIntegrityFixture(root);
      writeFileSync(join(root, "apps/agent-health-console/src/index.ts"), "export const index = false;\n");

      expect(verifyDashboardIntegrityManifest(root)).toContain("DASHBOARD_INTEGRITY_MANIFEST_DIGEST_MISMATCH");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects a dashboard TypeScript source outside the reviewed set", async () => {
    const { verifyDashboardIntegrityManifest } = await loadVerifier();
    const root = mkdtempSync(join(tmpdir(), "dashboard-integrity-"));

    try {
      writeDashboardIntegrityFixture(root);
      writeFileSync(join(root, "apps/agent-health-console/src/extra.ts"), "export const extra = true;\n");

      expect(verifyDashboardIntegrityManifest(root)).toContain("DASHBOARD_INTEGRITY_MANIFEST_UNALLOWED_SOURCE_FILE");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects a dashboard integrity manifest with duplicate paths", async () => {
    const { verifyDashboardIntegrityManifest } = await loadVerifier();
    const root = mkdtempSync(join(tmpdir(), "dashboard-integrity-"));

    try {
      writeDashboardIntegrityFixture(root, [...dashboardFixtureFiles, dashboardFixtureFiles[0]!]);

      expect(verifyDashboardIntegrityManifest(root)).toContain("DASHBOARD_INTEGRITY_MANIFEST_INVALID");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects a dashboard integrity manifest that omits an approved source entry", async () => {
    const { verifyDashboardIntegrityManifest } = await loadVerifier();
    const root = mkdtempSync(join(tmpdir(), "dashboard-integrity-"));

    try {
      writeDashboardIntegrityFixture(root, dashboardFixtureFiles.slice(0, 2));

      expect(verifyDashboardIntegrityManifest(root)).toContain("DASHBOARD_INTEGRITY_MANIFEST_INVALID");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects a dashboard integrity manifest with a malformed digest", async () => {
    const { verifyDashboardIntegrityManifest } = await loadVerifier();
    const root = mkdtempSync(join(tmpdir(), "dashboard-integrity-"));

    try {
      writeDashboardIntegrityFixture(root, [
        ["dashboard-html.ts", "export const dashboard = true;\n", "not-a-digest"],
        dashboardFixtureFiles[1]!,
        dashboardFixtureFiles[2]!,
      ]);

      expect(verifyDashboardIntegrityManifest(root)).toContain("DASHBOARD_INTEGRITY_MANIFEST_INVALID");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects a dashboard integrity manifest with an unreviewed top-level property", async () => {
    const { verifyDashboardIntegrityManifest } = await loadVerifier();
    const root = mkdtempSync(join(tmpdir(), "dashboard-integrity-"));
    const manifestPath = join(root, "apps/agent-health-console/dashboard-integrity-manifest.v1.json");

    try {
      writeDashboardIntegrityFixture(root);
      writeFileSync(manifestPath, `${JSON.stringify({
        ...JSON.parse(readFileSync(manifestPath, "utf8")),
        extra: true,
      }, null, 2)}\n`);

      expect(verifyDashboardIntegrityManifest(root)).toContain("DASHBOARD_INTEGRITY_MANIFEST_INVALID");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns an integrity violation instead of throwing when an approved dashboard source is missing", async () => {
    const { verifyDashboardIntegrityManifest } = await loadVerifier();
    const root = mkdtempSync(join(tmpdir(), "dashboard-integrity-"));

    try {
      writeDashboardIntegrityFixture(root);
      rmSync(join(root, "apps/agent-health-console/src/index.ts"));

      expect(() => verifyDashboardIntegrityManifest(root)).not.toThrow();
      expect(verifyDashboardIntegrityManifest(root)).toContain("DASHBOARD_INTEGRITY_MANIFEST_UNALLOWED_SOURCE_FILE");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

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
    expect(scanHealthDashboardSource('const page = `<scr${"ipt"}>globalThis.fetch("https://broker.example")</scr${"ipt"}>`;')).toContain(
      "DASHBOARD_TEMPLATE_EXPRESSION_FORBIDDEN",
    );
    expect(scanHealthDashboardSource('const label = `health-${status}`;')).toContain(
      "DASHBOARD_TEMPLATE_EXPRESSION_FORBIDDEN",
    );
    expect(scanHealthDashboardSource("const request = new XMLHttpRequest();")).toContain(
      "DASHBOARD_BROWSER_NETWORK_FORBIDDEN",
    );
    expect(scanHealthDashboardSource('const socket = new WebSocket("wss://example.invalid");')).toContain(
      "DASHBOARD_BROWSER_NETWORK_FORBIDDEN",
    );
    expect(scanHealthDashboardSource('navigator.sendBeacon("/collect", "data");')).toContain(
      "DASHBOARD_BROWSER_NETWORK_FORBIDDEN",
    );
    expect(scanHealthDashboardSource('env.AGENT_HEALTH_DB.prepare("DELETE FROM agent_health_current_v1").run();')).toContain(
      "DASHBOARD_DATA_WRITE_FORBIDDEN",
    );
    expect(scanHealthDashboardSource("env.AGENT_HEALTH_DB.batch([]);")).toContain(
      "DASHBOARD_DATA_WRITE_FORBIDDEN",
    );
    expect(scanHealthDashboardSource('const page = `<script>navigator.sendBeacon("/collect", "data")</script>`;')).toContain(
      "DASHBOARD_BROWSER_NETWORK_FORBIDDEN",
    );
    expect(scanHealthDashboardSource('fetch("/api/v1/health-summary", { method: "GET" });')).toContain(
      "DASHBOARD_OUTBOUND_NETWORK_FORBIDDEN",
    );
    expect(scanHealthDashboardSource('fetch("/api/v1/health-summary");')).toEqual([]);
    expect(scanHealthDashboardSource('const page = `<script>fetch("/api/v1/health-summary")</script>`;')).toEqual([]);
    expect(scanHealthDashboardSource('const title = "MT5 DRY_RUN Health";')).toEqual([]);
  });

  it("rejects EventSource as an unapproved dashboard browser capability", async () => {
    const { scanHealthDashboardSource } = await loadVerifier();

    expect(scanHealthDashboardSource('new EventSource("https://example.invalid/events");')).toContain(
      "DASHBOARD_BROWSER_NETWORK_FORBIDDEN",
    );
  });

  it("rejects external resource URLs embedded in static dashboard HTML", async () => {
    const { scanHealthDashboardSource } = await loadVerifier();

    expect(scanHealthDashboardSource('const page = `<img src="https://example.invalid/pixel">`;')).toContain(
      "DASHBOARD_BROWSER_NETWORK_FORBIDDEN",
    );
  });

  it("rejects network-capable DOM elements in the static dashboard script", async () => {
    const { scanHealthDashboardSource } = await loadVerifier();

    expect(scanHealthDashboardSource('document.createElement("img");')).toContain(
      "DASHBOARD_BROWSER_NETWORK_FORBIDDEN",
    );
  });

  it("rejects external resource URLs assembled from static string fragments", async () => {
    const { scanHealthDashboardSource } = await loadVerifier();

    expect(scanHealthDashboardSource('const endpoint = "ht" + "tps://example.invalid/pixel";')).toContain(
      "DASHBOARD_BROWSER_NETWORK_FORBIDDEN",
    );
  });

  it("rejects dynamically assembled mutation SQL passed through a read-named D1 method", async () => {
    const { scanHealthDashboardSource } = await loadVerifier();

    expect(scanHealthDashboardSource('const sql = "DE" + "LETE FROM agent_health_current_v1 RETURNING account_id"; await env.AGENT_HEALTH_DB.prepare(sql).first();')).toContain(
      "DASHBOARD_DATA_WRITE_FORBIDDEN",
    );
  });

  it("rejects dashboard source files outside the three-file capability allowlist", async () => {
    const { scanHealthDashboardSource } = await loadVerifier();

    expect(scanHealthDashboardSource("export const helper = true;", "extra-helper.ts")).toContain(
      "DASHBOARD_SOURCE_FILE_NOT_ALLOWLISTED",
    );
  });

  it("requires the dashboard HTML file to contain exactly the one reviewed browser fetch", async () => {
    const { scanHealthDashboardSource } = await loadVerifier();

    expect(scanHealthDashboardSource(
      "export function renderDashboardHtml() { return `<script>(() => {})();</script>`; }",
      "dashboard-html.ts",
    )).toContain("DASHBOARD_CAPABILITY_NOT_ALLOWLISTED");
  });

  it("requires the health summary file to use the two exact reviewed D1 SELECT chains", async () => {
    const { scanHealthDashboardSource } = await loadVerifier();
    const unreviewedRead = 'const QUERY = "SELECT secret FROM agent_health_current_v1"; export async function read(env) { return env.AGENT_HEALTH_DB.prepare(QUERY).bind("a", "b").first(); }';

    expect(scanHealthDashboardSource(unreviewedRead, "health-summary-v1.ts")).toContain(
      "DASHBOARD_DATA_WRITE_FORBIDDEN",
    );
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
      const dashboardSources = new URL("../../agent-health-console/src/", import.meta.url);
      for (const path of ["dashboard-html.ts", "health-summary-v1.ts", "index.ts"]) {
        writeFileSync(join(dashboard, path), readFileSync(new URL(path, dashboardSources), "utf8"));
      }
      writeFileSync(join(dashboard, "index.ts"), `${readFileSync(join(dashboard, "index.ts"), "utf8")}\nconst endpoint = "/api/v1/agent/sync";\n`);
      writeDashboardIntegrityManifestForSources(root, dashboard);
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
      writeRealDashboardIntegrityFixture(root);
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
      writeRealDashboardIntegrityFixture(root);
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
      writeRealDashboardIntegrityFixture(root);
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
      writeRealDashboardIntegrityFixture(root);
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
      writeRealDashboardIntegrityFixture(root);
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
      writeRealDashboardIntegrityFixture(root);
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
      writeRealDashboardIntegrityFixture(root);
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
