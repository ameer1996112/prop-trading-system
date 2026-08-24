import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Scope: only the separate execution-edge Worker and MT5 agent sources are scanned.
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const skippedDirectories = new Set([".git", "dist", "node_modules"]);
const skippedMt5Directories = new Set([...skippedDirectories, "generated", "journal", "local"]);
const mt5SourceExtensions = new Set([".mq5", ".mqh"]);
const frozenCandidateContractPath = "apps/execution-edge/src/execution-candidate-v2.ts";
const frozenCandidateExecutionMode = 'readonly execution_mode: "PAPER_ONLY";';
const frozenCandidateExecutionModeValidation = 'const executionMode = literal(input.execution_mode, "PAPER_ONLY");';
const frozenCandidateExecutionModeValue = "execution_mode: executionMode,";

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
  if (/\bWebRequest\s*\([^)]*["'`]https?:\/\//isu.test(source)) {
    violations.push("MT5_WEBREQUEST_URL_FORBIDDEN");
  }
  if (/\b(?:password|secret|token|api[_ -]?key)\b\s*[:=]\s*(["'`])[^"'`]+?\1/iu.test(source)) {
    violations.push("MT5_CREDENTIAL_LITERAL_FORBIDDEN");
  }

  return sorted(violations);
}

export function scanWorkerSource(source, allowedExecutionModeIndexes = new Set()) {
  const violations = [];
  const executionMode = /(?:\bexecution_mode\b|["'`]execution_mode["'`]|\[\s*["'`]execution_mode["'`]\s*\])\s*(?::|=|\|\|=|\?\?=)\s*(?:(["'`])([^"'`]*)\1|([^\s,;}]+))/giu;

  for (const match of source.matchAll(executionMode)) {
    const trailing = source.slice((match.index ?? 0) + match[0].length).trimStart();
    const isExactDryRun = (
      match[1] !== undefined
      && match[2] === "DRY_RUN"
      && (trailing.length === 0 || /^[,;}\r\n]/u.test(trailing))
    );
    if (
      !allowedExecutionModeIndexes.has(match.index)
      && !isExactDryRun
    ) {
      violations.push("WORKER_EXECUTION_MODE_NOT_DRY_RUN");
    }
  }
  if (/(?:\breal_execution_allowed\b|["'`]real_execution_allowed["'`]|\[\s*["'`]real_execution_allowed["'`]\s*\])\s*(?::|=|\|\|=|\?\?=)\s*true\b/iu.test(source)) {
    violations.push("WORKER_REAL_EXECUTION_ALLOWED_FORBIDDEN");
  }

  return sorted(violations);
}

function sourceFiles(root, extensions, skipped = skippedDirectories) {
  if (!existsSync(root)) return [];

  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!skipped.has(entry.name)) files.push(...sourceFiles(join(root, entry.name), extensions, skipped));
      continue;
    }
    if (entry.isFile() && extensions.has(extname(entry.name).toLowerCase())) files.push(join(root, entry.name));
  }
  return files;
}

function exactExecutionModeIndex(source, fragment) {
  const fragmentStart = source.indexOf(fragment);
  if (fragmentStart === -1 || source.indexOf(fragment, fragmentStart + fragment.length) !== -1) {
    return undefined;
  }
  return fragmentStart + fragment.indexOf("execution_mode");
}

function scanWorkerFile(root, file) {
  const source = readFileSync(file, "utf8");
  const allowedExecutionModeIndexes = new Set();

  // This frozen, account-free candidate contract is not a command authority.
  if (
    relative(root, file) === frozenCandidateContractPath
    && source.indexOf(frozenCandidateExecutionModeValidation) !== -1
    && source.indexOf(
      frozenCandidateExecutionModeValidation,
      source.indexOf(frozenCandidateExecutionModeValidation) + frozenCandidateExecutionModeValidation.length,
    ) === -1
  ) {
    const declarationIndex = exactExecutionModeIndex(source, frozenCandidateExecutionMode);
    const valueIndex = exactExecutionModeIndex(source, frozenCandidateExecutionModeValue);
    if (declarationIndex !== undefined && valueIndex !== undefined) {
      allowedExecutionModeIndexes.add(declarationIndex);
      allowedExecutionModeIndexes.add(valueIndex);
    }
  }
  return scanWorkerSource(source, allowedExecutionModeIndexes);
}

export function runBoundaryVerifier(root = repositoryRoot) {
  const violations = [];
  for (const file of sourceFiles(join(root, "apps/execution-edge/src"), new Set([".ts"]))) {
    violations.push(...scanWorkerFile(root, file));
  }
  for (const file of sourceFiles(join(root, "mt5/TradeOpsAgent"), mt5SourceExtensions, skippedMt5Directories)) {
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
