import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
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
  return runFixtureWithEnvironment(root);
}

function runFixtureWithEnvironment(root: string, environment: NodeJS.ProcessEnv = {}) {
  return spawnSync(join(root, "scripts/verify-execution-edge-foundation.sh"), [], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, ...environment },
  });
}

const credentialVariables = [
  "CLOUDFLARE_API_TOKEN",
  "CF_API_TOKEN",
  "CLOUDFLARE_ACCESS_CLIENT_ID",
  "CLOUDFLARE_ACCESS_CLIENT_SECRET",
  "WRANGLER_API_TOKEN",
  "CLOUDFLARE_API_KEY",
  "CF_API_KEY",
  "CLOUDFLARE_EMAIL",
  "CF_EMAIL",
  "CLOUDFLARE_API_USER_SERVICE_KEY",
  "CLOUDFLARE_USER_SERVICE_KEY",
  "WRANGLER_CF_AUTHORIZATION_TOKEN",
  "CLOUDFLARE_CF_AUTH",
  "CLOUDFLARE_AUTH_USE_KEYRING",
  "CLOUDFLARE_BASE_URL",
  "CLOUDFLARE_API_BASE_URL",
  "CF_API_BASE_URL",
  "WRANGLER_API_ENVIRONMENT",
  "WRANGLER_AUTH_DOMAIN",
  "WRANGLER_AUTH_URL",
  "WRANGLER_TOKEN_URL",
  "WRANGLER_R2_SQL_AUTH_TOKEN",
  "WRANGLER_HTTPS_KEY_PATH",
] as const;

function installCredentialCheckingNpm(root: string): string {
  const bin = join(root, "bin");
  const record = join(root, "npm-environment.txt");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "npm"), `#!/usr/bin/env sh
for variable in ${credentialVariables.join(" ")}; do
  if printenv "$variable" >/dev/null; then
    echo "credential reached npm: $variable" >&2
    exit 91
  fi
done
env | LC_ALL=C sort > "$NPM_ENVIRONMENT_RECORD"
`);
  chmodSync(join(bin, "npm"), 0o755);
  return record;
}

describe("execution-edge foundation verifier", { timeout: 30_000 }, () => {
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
    ["EXECUTION_AUTHORITY_ENABLED = true", "EXECUTION_AUTHORITY_ENABLED"],
    ["EXECUTION_AUTHORITY_ENABLED === true", "EXECUTION_AUTHORITY_ENABLED"],
    ["EXECUTION_AUTHORITY_ENABLED\n===\ntrue", "EXECUTION_AUTHORITY_ENABLED"],
    ['EXECUTION_MODE_CEILING = "LIVE"', "EXECUTION_MODE_CEILING"],
    ['EXECUTION_MODE_CEILING === "LIVE"', "EXECUTION_MODE_CEILING"],
    ["EXECUTION_MODE_CEILING === `LIVE`", "EXECUTION_MODE_CEILING"],
    ["EXECUTION_MODE_CEILING\n===\n`LIVE`", "EXECUTION_MODE_CEILING"],
    ["EXECUTION_AUTHORITY_ENABLED:\ntrue", "EXECUTION_AUTHORITY_ENABLED"],
    ["EXECUTION_MODE_CEILING:\nLIVE", "EXECUTION_MODE_CEILING"],
    ["broker_password", "broker_password"],
    ["account_password", "account_password"],
    ["generic_instruction", "generic_instruction"],
  ])("rejects forbidden production text %s while excluding documentation", (source, expectedDiagnostic) => {
    expect(existsSync(verifier), "the verifier must exist before the smoke test can run").toBe(true);
    const root = writeFixture(`export const forbidden = "${source}";\n`);
    try {
      writeFileSync(join(root, "README.md"), `Documentation may explain ${source} safely.\n`);
      const result = runFixture(root);
      expect(result.status).not.toBe(0);
      expect(`${result.stdout}${result.stderr}`).toContain(expectedDiagnostic);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("removes all Cloudflare credentials before invoking npm", () => {
    const root = writeFixture();
    try {
      const record = installCredentialCheckingNpm(root);
      const result = runFixtureWithEnvironment(root, {
        ...Object.fromEntries(credentialVariables.map((variable) => [variable, "sentinel"])),
        NPM_ENVIRONMENT_RECORD: record,
        PATH: `${join(root, "bin")}:${process.env.PATH ?? ""}`,
      });
      expect(result.status, result.stderr).toBe(0);
      const npmEnvironment = readFileSync(record, "utf8");
      for (const variable of credentialVariables) {
        expect(npmEnvironment).not.toContain(`${variable}=`);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
