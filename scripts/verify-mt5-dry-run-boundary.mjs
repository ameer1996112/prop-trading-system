import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const skippedDirectories = new Set([".git", "dist", "journal", "local", "node_modules"]);
const mt5SourceExtensions = new Set([".mq5", ".mqh"]);

function sorted(violations) {
  return [...new Set(violations)].sort();
}

export function scan(source) {
  const violations = [];

  if (/\bOrderSend\b/iu.test(source)) violations.push("MT5_ORDER_API_FORBIDDEN");
  if (/\bCTrade\b/iu.test(source)) violations.push("MT5_CTRADE_FORBIDDEN");
  if (/\bPositionClose\b/iu.test(source)) violations.push("MT5_POSITION_CLOSE_FORBIDDEN");
  if (/\bOrderDelete\b/iu.test(source)) violations.push("MT5_ORDER_DELETE_FORBIDDEN");
  if (/\bOrderModify\b/iu.test(source)) violations.push("MT5_ORDER_MODIFY_FORBIDDEN");
  if (/#\s*import\b/iu.test(source)) violations.push("MT5_DLL_IMPORT_FORBIDDEN");
  if (/\bWebRequest\s*\([^)]*["']https?:\/\//isu.test(source)) {
    violations.push("MT5_WEBREQUEST_URL_FORBIDDEN");
  }
  if (/\b(?:password|secret|token|api[_ -]?key)\b\s*[:=]\s*["'][^"']+?["']/iu.test(source)) {
    violations.push("MT5_CREDENTIAL_LITERAL_FORBIDDEN");
  }

  return sorted(violations);
}

export function scanWorkerSource(source) {
  const violations = [];
  const executionMode = /\bexecution_mode\b\s*(?:=\s*(["'`])([^"'`]*)\1|:\s*(["'`])([^"'`]*)\3(?=\s*[,}]))/giu;

  for (const match of source.matchAll(executionMode)) {
    const value = match[2] ?? match[4];
    if (value !== "DRY_RUN") violations.push("WORKER_EXECUTION_MODE_NOT_DRY_RUN");
  }
  if (/\breal_execution_allowed\b\s*:\s*true\b/iu.test(source)) {
    violations.push("WORKER_REAL_EXECUTION_ALLOWED_FORBIDDEN");
  }

  return sorted(violations);
}

function sourceFiles(root, extensions) {
  if (!existsSync(root)) return [];

  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!skippedDirectories.has(entry.name)) files.push(...sourceFiles(join(root, entry.name), extensions));
      continue;
    }
    if (entry.isFile() && extensions.has(extname(entry.name).toLowerCase())) files.push(join(root, entry.name));
  }
  return files;
}

export function runBoundaryVerifier(root = repositoryRoot) {
  const violations = [];
  for (const file of sourceFiles(join(root, "apps/execution-edge/src"), new Set([".ts"]))) {
    violations.push(...scanWorkerSource(readFileSync(file, "utf8")));
  }
  for (const file of sourceFiles(join(root, "mt5/TradeOpsAgent"), mt5SourceExtensions)) {
    violations.push(...scan(readFileSync(file, "utf8")));
  }

  const sortedViolations = sorted(violations);
  return { ok: sortedViolations.length === 0, violations: sortedViolations };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = runBoundaryVerifier();
  if (!result.ok) {
    console.error(`MT5 dry-run boundary violations: ${result.violations.join(", ")}`);
    process.exitCode = 1;
  } else {
    console.log("MT5 dry-run boundary verification passed.");
  }
}
