import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Scope: only the separate execution-edge Worker and MT5 agent sources are scanned.
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const executionEdgeRequire = createRequire(new URL("../apps/execution-edge/package.json", import.meta.url));
const ts = executionEdgeRequire("typescript");
const skippedDirectories = new Set([".git", "dist", "node_modules"]);
const skippedMt5Directories = new Set([...skippedDirectories, "generated", "journal", "local"]);
const mt5SourceExtensions = new Set([".mq5", ".mqh"]);
const frozenCandidateContractPath = "apps/execution-edge/src/execution-candidate-v2.ts";

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
  if (/\b(?:ShellExecute|WinExec|CreateProcess|system)\b/iu.test(source)) {
    violations.push("MT5_SHELL_FORBIDDEN");
  }
  if (/\b(?:SocketListen|WebSocketServer|HttpServer|ServerSocket)\b/iu.test(source)) {
    violations.push("MT5_INBOUND_LISTENER_FORBIDDEN");
  }
  if (/(["'`])https:\/\/[^"'`]*\1/iu.test(source)) {
    violations.push("MT5_WEBREQUEST_URL_FORBIDDEN");
  }
  if (/\b(?:password|secret|token|auth[_ -]?token|api[_ -]?(?:key|secret))\b\s*[:=]\s*(["'`])[^"'`]+?\1/iu.test(source)) {
    violations.push("MT5_CREDENTIAL_LITERAL_FORBIDDEN");
  }

  return sorted(violations);
}

export function scanHealthDashboardSource(source) {
  const violations = [];

  if (/\/api\/v1\/agent\/sync/iu.test(source)) {
    violations.push("DASHBOARD_MT5_SYNC_REFERENCE_FORBIDDEN");
  }
  if (/\b(?:OrderSend|CTrade|PositionClose|OrderModify|OrderDelete|placeOrder|closePosition|candidate|execution\s+authority)\b/iu.test(source)) {
    violations.push("DASHBOARD_EXECUTION_REFERENCE_FORBIDDEN");
  }
  for (const match of source.matchAll(/\bfetch\s*\(\s*(["'`])([^"'`]*)\1/giu)) {
    if (match[2] !== "/api/v1/health-summary") {
      violations.push("DASHBOARD_OUTBOUND_NETWORK_FORBIDDEN");
    }
  }

  return sorted(violations);
}

export function scanWorkerSource(source, allowedExecutionModeIndexes = new Set()) {
  const violations = [];
  const tree = ts.createSourceFile("worker.ts", source, ts.ScriptTarget.Latest, true);
  const staticString = (node) => {
    if (ts.isParenthesizedExpression(node)) return staticString(node.expression);
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    if (ts.isTemplateExpression(node)) {
      let value = node.head.text;
      for (const span of node.templateSpans) { const part = staticString(span.expression); if (part === undefined) return undefined; value += part + span.literal.text; }
      return value;
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const left = staticString(node.left); const right = staticString(node.right);
      return left === undefined || right === undefined ? undefined : left + right;
    }
    return undefined;
  };
  const nameOf = (node) => {
    if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    if (ts.isComputedPropertyName(node)) return staticString(node.expression);
    if (ts.isPropertyAccessExpression(node)) return node.name.text;
    if (ts.isElementAccessExpression(node)) return staticString(node.argumentExpression);
    return undefined;
  };
  const exact = (node, value) => (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && node.text === value;
  const falseLiteral = (node) => node.kind === ts.SyntaxKind.FalseKeyword || (ts.isAsExpression(node) && node.expression.kind === ts.SyntaxKind.FalseKeyword);
  const check = (name, value, index) => {
    if (name === "execution_mode" && !allowedExecutionModeIndexes.has(index) && !exact(value, "DRY_RUN")) violations.push("WORKER_EXECUTION_MODE_NOT_DRY_RUN");
    if (name === "real_execution_allowed" && !falseLiteral(value)) violations.push("WORKER_REAL_EXECUTION_ALLOWED_FORBIDDEN");
  };
  const visit = (node) => {
    if (ts.isPropertyAssignment(node)) check(nameOf(node.name), node.initializer, node.name.getStart(tree));
    if (ts.isPropertySignature(node) && node.type && ts.isLiteralTypeNode(node.type)) check(nameOf(node.name), node.type.literal, node.name.getStart(tree));
    if (ts.isPropertyDeclaration(node) && node.initializer) check(nameOf(node.name), node.initializer, node.name.getStart(tree));
    if (ts.isVariableDeclaration(node) && node.initializer) check(nameOf(node.name), node.initializer, node.name.getStart(tree));
    if (ts.isBindingElement(node) && node.initializer) check(nameOf(node.propertyName ?? node.name), node.initializer, (node.propertyName ?? node.name).getStart(tree));
    if (ts.isBinaryExpression(node) && [ts.SyntaxKind.EqualsToken, ts.SyntaxKind.PlusEqualsToken, ts.SyntaxKind.BarBarEqualsToken, ts.SyntaxKind.QuestionQuestionEqualsToken, ts.SyntaxKind.AmpersandAmpersandEqualsToken].includes(node.operatorToken.kind)) {
      const name = nameOf(node.left); if (name === undefined && ts.isElementAccessExpression(node.left)) { violations.push("WORKER_EXECUTION_MODE_NOT_DRY_RUN", "WORKER_REAL_EXECUTION_ALLOWED_FORBIDDEN"); } else check(name, node.right, node.left.getStart(tree));
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const owner = identifierText(node.expression.expression); const method = node.expression.name.text;
      if ((owner === "Object" || owner === "Reflect") && method === "defineProperty" && node.arguments.length >= 3) { const name = staticString(node.arguments[1]); const descriptor = node.arguments[2]; if (ts.isObjectLiteralExpression(descriptor)) { const value = descriptor.properties.find((p) => ts.isPropertyAssignment(p) && propertyNameText(p) === "value"); if (value && ts.isPropertyAssignment(value)) check(name, value.initializer, node.arguments[1].getStart(tree)); } }
      if (owner === "Reflect" && method === "set" && node.arguments.length >= 3) check(staticString(node.arguments[1]), node.arguments[2], node.arguments[1].getStart(tree));
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);

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

function identifierText(node) { return ts.isIdentifier(node) ? node.text : undefined; }
function propertyNameText(node) { return node.name && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) ? node.name.text : undefined; }
function frozenCandidateModeIndexes(source) {
  const tree = ts.createSourceFile("execution-candidate-v2.ts", source, ts.ScriptTarget.Latest, true);
  const interfaces = tree.statements.filter((node) => ts.isInterfaceDeclaration(node) && node.name.text === "ExecutionCandidateV2" && node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword));
  const interfaceProperty = interfaces.length === 1 ? interfaces[0].members.filter((m) => ts.isPropertySignature(m) && propertyNameText(m) === "execution_mode") : [];
  const typedPaperOnly = interfaceProperty.length === 1 && interfaceProperty[0].modifiers?.some((m) => m.kind === ts.SyntaxKind.ReadonlyKeyword) && ts.isLiteralTypeNode(interfaceProperty[0].type) && ts.isStringLiteral(interfaceProperty[0].type.literal) && interfaceProperty[0].type.literal.text === "PAPER_ONLY";
  const keys = tree.statements.filter((node) => ts.isVariableStatement(node)).flatMap((node) => node.declarationList.declarations).filter((node) => identifierText(node.name) === "CANDIDATE_KEYS");
  const keyElements = keys.length === 1 && keys[0].initializer && ts.isAsExpression(keys[0].initializer) && ts.isArrayLiteralExpression(keys[0].initializer.expression) ? keys[0].initializer.expression.elements : [];
  const keyValues = keyElements.every(ts.isStringLiteral) ? keyElements.map((node) => node.text) : [];
  const forbiddenCandidateKey = /^(?:account|installation|command|lease|reservation|order|deal|position|broker_(?:password|credential|token))/iu;
  const accountFree = keyElements.length > 0 && keyValues.length === keyElements.length && keyValues.includes("execution_mode") && !keyValues.some((key) => forbiddenCandidateKey.test(key));
  const validators = tree.statements.filter((node) => ts.isFunctionDeclaration(node) && node.name?.text === "validateExecutionCandidateV2");
  if (!typedPaperOnly || !accountFree || validators.length !== 1 || !validators[0].body) return new Set();
  const tries = validators[0].body.statements.filter(ts.isTryStatement);
  if (tries.length !== 1) return new Set();
  const statements = tries[0].tryBlock.statements;
  const declarations = statements.filter(ts.isVariableStatement).flatMap((node) => node.declarationList.declarations).filter((node) => identifierText(node.name) === "executionMode");
  const validDeclaration = declarations.length === 1 && declarations[0].initializer && ts.isCallExpression(declarations[0].initializer) && identifierText(declarations[0].initializer.expression) === "literal" && declarations[0].initializer.arguments.length === 2 && ts.isPropertyAccessExpression(declarations[0].initializer.arguments[0]) && identifierText(declarations[0].initializer.arguments[0].expression) === "input" && declarations[0].initializer.arguments[0].name.text === "execution_mode" && ts.isStringLiteral(declarations[0].initializer.arguments[1]) && declarations[0].initializer.arguments[1].text === "PAPER_ONLY";
  const returns = statements.filter(ts.isReturnStatement).filter((node) => node.expression && ts.isCallExpression(node.expression) && ts.isPropertyAccessExpression(node.expression.expression) && identifierText(node.expression.expression.expression) === "Object" && node.expression.expression.name.text === "freeze" && ts.isObjectLiteralExpression(node.expression.arguments[0]));
  if (!validDeclaration || returns.length !== 1) return new Set();
  const properties = returns[0].expression.arguments[0].properties.filter((node) => ts.isPropertyAssignment(node) && propertyNameText(node) === "execution_mode");
  const returnProperties = returns[0].expression.arguments[0].properties;
  const returnAccountFree = returnProperties.every((property) => !ts.isSpreadAssignment(property) && propertyNameText(property) !== undefined && !forbiddenCandidateKey.test(propertyNameText(property)));
  if (properties.length !== 1 || identifierText(properties[0].initializer) !== "executionMode" || !returnAccountFree) return new Set();
  return new Set([interfaceProperty[0].name.getStart(tree), properties[0].name.getStart(tree)]);
}

function scanWorkerFile(root, file) {
  const source = readFileSync(file, "utf8");
  const allowedExecutionModeIndexes = new Set();

  if (relative(root, file) === frozenCandidateContractPath) {
    for (const index of frozenCandidateModeIndexes(source)) allowedExecutionModeIndexes.add(index);
  }
  return scanWorkerSource(source, allowedExecutionModeIndexes);
}

export function runBoundaryVerifier(root = repositoryRoot) {
  const violations = [];
  for (const file of sourceFiles(join(root, "apps/execution-edge/src"), new Set([".ts"]))) {
    violations.push(...scanWorkerFile(root, file));
  }
  for (const file of sourceFiles(join(root, "apps/agent-health-console/src"), new Set([".ts"]))) {
    violations.push(...scanHealthDashboardSource(readFileSync(file, "utf8")));
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
