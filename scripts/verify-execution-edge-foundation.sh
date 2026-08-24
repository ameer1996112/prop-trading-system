#!/usr/bin/env bash

set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
execution_edge="$repository_root/apps/execution-edge"
config="$execution_edge/wrangler.jsonc"

fail() {
  printf 'Execution edge foundation verification failed: %s\n' "$*" >&2
  exit 1
}

[[ -f "$config" ]] || fail "missing apps/execution-edge/wrangler.jsonc"
[[ -f "$execution_edge/package.json" ]] || fail "missing apps/execution-edge/package.json"

node --input-type=module - "$config" <<'NODE'
import { readFileSync } from "node:fs";

const expectedVars = {
  CANDIDATE_INBOX_ENABLED: "false",
  AGENT_SYNC_ENABLED: "false",
  EXECUTION_AUTHORITY_ENABLED: "false",
  EXECUTION_MODE_CEILING: "DRY_RUN",
  ROUTING_MANIFEST_SHA256: "INERT_NOT_CONFIGURED",
};

function stripJsonc(input) {
  let result = "";
  let inString = false;
  let escaped = false;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    const next = input[index + 1];
    if (inString) {
      result += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      result += character;
      continue;
    }
    if (character === "/" && next === "/") {
      while (index < input.length && input[index] !== "\n") index += 1;
      result += "\n";
      continue;
    }
    if (character === "/" && next === "*") {
      index += 2;
      while (index < input.length && !(input[index] === "*" && input[index + 1] === "/")) index += 1;
      if (index >= input.length) throw new Error("unterminated block comment");
      index += 1;
      continue;
    }
    result += character;
  }
  return result.replace(/,(\s*[}\]])/gu, "$1");
}

const configPath = process.argv[2];
let config;
try {
  config = JSON.parse(stripJsonc(readFileSync(configPath, "utf8")));
} catch (error) {
  console.error(`Execution edge foundation verification failed: invalid wrangler.jsonc (${error.message})`);
  process.exit(1);
}

if (config.workers_dev !== false || config.preview_urls !== false) {
  console.error("Execution edge foundation verification failed: workers_dev and preview_urls must both be false");
  process.exit(1);
}
const actualKeys = Object.keys(config.vars ?? {}).sort();
const expectedKeys = Object.keys(expectedVars).sort();
const invalidKey = expectedKeys.find((key) => config.vars?.[key] !== expectedVars[key]);
if (invalidKey || JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
  const detail = invalidKey
    ? `${invalidKey} must be ${expectedVars[invalidKey]}`
    : "vars must contain exactly the five inert values";
  console.error(`Execution edge foundation verification failed: ${detail}`);
  process.exit(1);
}
NODE

for forbidden in \
  '(?s)EXECUTION_AUTHORITY_ENABLED.{0,160}?true' \
  '(?s)EXECUTION_MODE_CEILING.{0,160}?LIVE' \
  'broker_password' \
  'account_password' \
  'generic_instruction'; do
  if rg --line-number --pcre2 --multiline --hidden --glob '!node_modules/**' --glob '!dist/**' -- "$forbidden" \
    "$execution_edge/src" "$config" "$repository_root/contracts"; then
    fail "forbidden production/config/contract text detected: $forbidden"
  else
    scan_status=$?
    [[ "$scan_status" -eq 1 ]] || fail "safety scan failed for: $forbidden"
  fi
done

if ! node --input-type=module - "$execution_edge/package.json" <<'NODE'
import { readFileSync } from "node:fs";

const packagePath = process.argv[2];
const pkg = JSON.parse(readFileSync(packagePath, "utf8"));
if (pkg.scripts?.build !== "wrangler deploy --dry-run --outdir dist") process.exit(1);
NODE
then
  fail "package build must remain the local dry-run Wrangler command"
fi

run_npm() {
  env \
    -u CLOUDFLARE_API_TOKEN \
    -u CF_API_TOKEN \
    -u CLOUDFLARE_ACCESS_CLIENT_ID \
    -u CLOUDFLARE_ACCESS_CLIENT_SECRET \
    -u WRANGLER_API_TOKEN \
    -u CLOUDFLARE_API_KEY \
    -u CF_API_KEY \
    -u CLOUDFLARE_EMAIL \
    -u CF_EMAIL \
    -u CLOUDFLARE_API_USER_SERVICE_KEY \
    -u CLOUDFLARE_USER_SERVICE_KEY \
    -u WRANGLER_CF_AUTHORIZATION_TOKEN \
    -u CLOUDFLARE_CF_AUTH \
    -u CLOUDFLARE_AUTH_USE_KEYRING \
    -u CLOUDFLARE_BASE_URL \
    -u CLOUDFLARE_API_BASE_URL \
    -u CF_API_BASE_URL \
    -u WRANGLER_API_ENVIRONMENT \
    -u WRANGLER_AUTH_DOMAIN \
    -u WRANGLER_AUTH_URL \
    -u WRANGLER_TOKEN_URL \
    -u WRANGLER_R2_SQL_AUTH_TOKEN \
    -u WRANGLER_HTTPS_KEY_PATH \
    CI=1 WRANGLER_SEND_METRICS=false WRANGLER_WRITE_LOGS=false \
    npm --prefix "$execution_edge" "$@"
}

run_npm test
run_npm run lint
run_npm run typecheck
run_npm run build

printf 'Execution edge foundation verification passed.\n'
