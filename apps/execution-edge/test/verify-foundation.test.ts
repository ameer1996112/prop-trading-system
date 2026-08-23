import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const verifier = new URL("../../../scripts/verify-execution-edge-foundation.sh", import.meta.url);

const inertConfig = JSON.stringify({
  name: "fixture-execution-edge",
  workers_dev: false,
  preview_urls: false,
  vars: {
    CANDIDATE_INBOX_ENABLED: "false",
    AGENT_SYNC_ENABLED: "false",
    EXECUTION_AUTHORITY_ENABLED: "false",
    EXECUTION_MODE_CEILING: "DRY_RUN",
    ROUTING_MANIFEST_SHA256: "INERT_NOT_CONFIGURED",
  },
}, null, 2);

function writeFixture(source = "export {};\n"): string {
  const root = mkdtempSync(join(tmpdir(), "execution-edge-verifier-"));
  const app = join(root, "apps/execution-edge");
  mkdirSync(join(app, "src"), { recursive: true });
  mkdirSync(join(app, "node_modules/.bin"), { recursive: true });
  mkdirSync(join(root, "contracts/schema"), { recursive: true });
  mkdirSync(join(root, "scripts"), { recursive: true });
  writeFileSync(join(app, "wrangler.jsonc"), `${inertConfig}\n`);
  writeFileSync(join(app, "src/index.ts"), source);
  writeFileSync(join(app, "package.json"), JSON.stringify({
    scripts: {
      test: "true",
      lint: "true",
      typecheck: "true",
      build: "wrangler deploy --dry-run --outdir dist",
    },
  }));
  writeFileSync(join(app, "node_modules/.bin/wrangler"), "#!/usr/bin/env sh\nexit 0\n");
  chmodSync(join(app, "node_modules/.bin/wrangler"), 0o755);
  copyFileSync(verifier, join(root, "scripts/verify-execution-edge-foundation.sh"));
  chmodSync(join(root, "scripts/verify-execution-edge-foundation.sh"), 0o755);
  return root;
}

function runFixture(root: string) {
  return spawnSync(join(root, "scripts/verify-execution-edge-foundation.sh"), [], {
    cwd: root,
    encoding: "utf8",
  });
}

describe("execution-edge foundation verifier", () => {
  it("accepts a fixture with exactly the five inert configuration values", () => {
    expect(existsSync(verifier), "the verifier must exist before the smoke test can run").toBe(true);
    const root = writeFixture();
    try {
      const result = runFixture(root);
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain("Execution edge foundation verification passed.");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.each([
    ["CANDIDATE_INBOX_ENABLED", "false"],
    ["AGENT_SYNC_ENABLED", "false"],
    ["EXECUTION_AUTHORITY_ENABLED", "false"],
    ["EXECUTION_MODE_CEILING", "DRY_RUN"],
    ["ROUTING_MANIFEST_SHA256", "INERT_NOT_CONFIGURED"],
  ])("rejects drift in inert config value %s", (key, expectedValue) => {
    expect(existsSync(verifier), "the verifier must exist before the smoke test can run").toBe(true);
    const root = writeFixture();
    try {
      const config = join(root, "apps/execution-edge/wrangler.jsonc");
      writeFileSync(config, inertConfig.replace(`"${key}": "${expectedValue}"`, `"${key}": "DRIFTED"`));
      const result = runFixture(root);
      expect(result.status).not.toBe(0);
      expect(`${result.stdout}${result.stderr}`).toContain(key);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.each([
    "EXECUTION_AUTHORITY_ENABLED = true",
    'EXECUTION_MODE_CEILING = "LIVE"',
    "broker_password",
    "account_password",
    "generic_instruction",
  ])("rejects forbidden production text %s while excluding documentation", (forbidden) => {
    expect(existsSync(verifier), "the verifier must exist before the smoke test can run").toBe(true);
    const root = writeFixture(`export const forbidden = "${forbidden}";\n`);
    try {
      writeFileSync(join(root, "README.md"), `Documentation may explain ${forbidden} safely.\n`);
      const result = runFixture(root);
      expect(result.status).not.toBe(0);
      expect(`${result.stdout}${result.stderr}`).toContain(forbidden);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
