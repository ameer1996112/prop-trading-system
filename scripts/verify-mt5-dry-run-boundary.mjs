import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
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

const allowedDashboardSourceFilePaths = ["dashboard-html.ts", "health-summary-v1.ts", "index.ts"];
const allowedDashboardSourceFiles = new Set(allowedDashboardSourceFilePaths);
const dashboardSourceDirectoryPath = "apps/agent-health-console/src";
const dashboardIntegrityManifestPath = "apps/agent-health-console/dashboard-integrity-manifest.v1.json";
const dashboardIntegrityManifestSchemaVersion = "DashboardIntegrityManifestV1";
const allowedDashboardQueries = new Map([
  [
    "SELECT last_accepted_epoch, request_sequence, server_sequence, terminal_build, source_symbol, terminal_connection_state, account_trade_permission, terminal_trade_permission, algo_trading_permission FROM agent_health_current_v1 WHERE account_id = ? AND installation_id = ?;",
    "first",
  ],
  [
    "SELECT request_sequence, result_code, server_sequence, received_at_epoch FROM agent_sync_audit_v1 WHERE account_id = ? AND installation_id = ? ORDER BY received_at_epoch DESC, request_sequence DESC, audit_id DESC LIMIT 20;",
    "all",
  ],
]);

function dashboardBindingNames(name, names, declarationNodes) {
  if (ts.isIdentifier(name)) {
    names.add(name.text);
    declarationNodes.add(name);
    return;
  }
  if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
    for (const element of name.elements) {
      if (ts.isBindingElement(element)) dashboardBindingNames(element.name, names, declarationNodes);
    }
  }
}

function dashboardDeclarations(program) {
  const names = new Set();
  const declarationNodes = new Set();
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isBindingElement(node)) {
      dashboardBindingNames(node.name, names, declarationNodes);
    }
    if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node)
      || ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node) || ts.isModuleDeclaration(node)) && node.name) {
      dashboardBindingNames(node.name, names, declarationNodes);
    }
    if (ts.isImportClause(node)) {
      if (node.name) dashboardBindingNames(node.name, names, declarationNodes);
      if (node.namedBindings && ts.isNamespaceImport(node.namedBindings)) {
        dashboardBindingNames(node.namedBindings.name, names, declarationNodes);
      }
    }
    if (ts.isImportSpecifier(node)) dashboardBindingNames(node.name, names, declarationNodes);
    ts.forEachChild(node, visit);
  };
  visit(program);
  return { names, declarationNodes };
}

function dashboardPropertyNameNode(node) {
  const parent = node.parent;
  return !!parent && (
    (ts.isPropertyAccessExpression(parent) && parent.name === node)
    || ((ts.isPropertyAssignment(parent) || ts.isPropertySignature(parent) || ts.isMethodDeclaration(parent)
      || ts.isPropertyDeclaration(parent) || ts.isMethodSignature(parent)) && parent.name === node)
  );
}

function dashboardStaticStrings(program) {
  const constants = new Map();
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer
      && ts.isVariableDeclarationList(node.parent)
      && (node.parent.flags & ts.NodeFlags.Const) !== 0) {
      constants.set(node.name.text, node.initializer);
    }
    ts.forEachChild(node, visit);
  };
  visit(program);
  const resolveString = (node, seen = new Set()) => {
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) {
      return resolveString(node.expression, seen);
    }
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const left = resolveString(node.left, seen);
      const right = resolveString(node.right, seen);
      return left === undefined || right === undefined ? undefined : left + right;
    }
    if (ts.isIdentifier(node) && constants.has(node.text) && !seen.has(node.text)) {
      const nextSeen = new Set(seen);
      nextSeen.add(node.text);
      return resolveString(constants.get(node.text), nextSeen);
    }
    return undefined;
  };
  return resolveString;
}

function normalizedDashboardSql(value) {
  return value.trim().replace(/\s+/gu, " ");
}

function isExternalDashboardResource(value) {
  return /(?:https?:|wss?:)\/\//iu.test(value)
    || /<\s*(?:img|iframe|link|object|embed|audio|video|source|form|base)\b/iu.test(value)
    || /<\s*script\b[^>]*\bsrc\s*=/iu.test(value)
    || /<\s*meta\b[^>]*\bhttp-equiv\s*=\s*["']?refresh\b/iu.test(value)
    || /(?:@import\b|url\s*\()/iu.test(value);
}

function dashboardD1TerminalMethod(prepareCall) {
  const bindAccess = prepareCall.parent;
  if (!ts.isPropertyAccessExpression(bindAccess) || bindAccess.expression !== prepareCall || bindAccess.name.text !== "bind") return undefined;
  const bindCall = bindAccess.parent;
  if (!ts.isCallExpression(bindCall) || bindCall.expression !== bindAccess) return undefined;
  const terminalAccess = bindCall.parent;
  if (!ts.isPropertyAccessExpression(terminalAccess) || terminalAccess.expression !== bindCall) return undefined;
  const terminalCall = terminalAccess.parent;
  if (!ts.isCallExpression(terminalCall) || terminalCall.expression !== terminalAccess) return undefined;
  return terminalAccess.name.text;
}

function validateDashboardGlobals(program, allowedGlobals, violations) {
  const { names, declarationNodes } = dashboardDeclarations(program);
  const visit = (node) => {
    if (ts.isIdentifier(node) && !names.has(node.text) && !allowedGlobals.has(node.text)
      && !declarationNodes.has(node) && !dashboardPropertyNameNode(node)) {
      violations.push("DASHBOARD_CAPABILITY_NOT_ALLOWLISTED");
    }
    ts.forEachChild(node, visit);
  };
  visit(program);
}

export function scanHealthDashboardSource(source, sourceFileName) {
  const violations = [];
  const forbiddenBrowserNetworkIdentifiers = new Set(["EventSource", "XMLHttpRequest", "WebSocket"]);
  const forbiddenWriteMethods = new Set(["batch", "delete", "exec", "put", "run"]);
  const allowedConstructors = new Set(["Error", "Response", "URL"]);
  const isFetchReference = (node) => {
    if (ts.isIdentifier(node)) return node.text === "fetch";
    if (ts.isPropertyAccessExpression(node)) {
      return node.name.text === "fetch" || isFetchReference(node.expression);
    }
    if (ts.isElementAccessExpression(node)) {
      return (ts.isStringLiteral(node.argumentExpression) && node.argumentExpression.text === "fetch") || isFetchReference(node.expression);
    }
    return false;
  };
  const isAllowedDirectFetchCall = (node) => {
    const [argument] = node.arguments;
    return ts.isIdentifier(node.expression)
      && node.expression.text === "fetch"
      && !node.questionDotToken
      && node.arguments.length === 1
      && !!argument
      && ts.isStringLiteral(argument)
      && argument.text === "/api/v1/health-summary";
  };
  const isHandlerMethodName = (node) => !!node.parent
    && ts.isMethodDeclaration(node.parent)
    && node.parent.name === node;
  const scanProgram = (program, strictInlineScript = false) => {
    const resolveString = dashboardStaticStrings(program);
    let allowedFetchCount = 0;
    if (program.parseDiagnostics.length > 0) {
      violations.push("DASHBOARD_OUTBOUND_NETWORK_FORBIDDEN");
      return { allowedFetchCount };
    }
    const visit = (node) => {
      if (ts.isCallExpression(node) && isFetchReference(node.expression)) {
        if (!isAllowedDirectFetchCall(node)) {
          violations.push("DASHBOARD_OUTBOUND_NETWORK_FORBIDDEN");
        } else {
          allowedFetchCount += 1;
        }
      }
      if (ts.isIdentifier(node) && node.text === "fetch") {
        if (!isHandlerMethodName(node) && (!node.parent || !ts.isCallExpression(node.parent) || node.parent.expression !== node || !isAllowedDirectFetchCall(node.parent))) {
          violations.push("DASHBOARD_OUTBOUND_NETWORK_FORBIDDEN");
        }
      }
      if (ts.isIdentifier(node) && forbiddenBrowserNetworkIdentifiers.has(node.text)) {
        violations.push("DASHBOARD_BROWSER_NETWORK_FORBIDDEN");
      }
      if (ts.isNewExpression(node)) {
        if (!ts.isIdentifier(node.expression) || !allowedConstructors.has(node.expression.text)) {
          violations.push("DASHBOARD_BROWSER_NETWORK_FORBIDDEN");
        }
      }
      if (ts.isPropertyAccessExpression(node) && node.name.text === "sendBeacon") {
        violations.push("DASHBOARD_BROWSER_NETWORK_FORBIDDEN");
      }
      if (ts.isElementAccessExpression(node)
        && ts.isStringLiteral(node.argumentExpression)
        && node.argumentExpression.text === "sendBeacon") {
        violations.push("DASHBOARD_BROWSER_NETWORK_FORBIDDEN");
      }
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
        && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === "document"
        && node.expression.name.text === "createElement") {
        const tagName = node.arguments[0] ? resolveString(node.arguments[0]) : undefined;
        if (tagName !== "td" && tagName !== "tr") violations.push("DASHBOARD_BROWSER_NETWORK_FORBIDDEN");
      }
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
        && node.expression.name.text === "setAttribute") {
        const attributeName = node.arguments[0] ? resolveString(node.arguments[0]) : undefined;
        if (attributeName === undefined || /^(?:action|data|formaction|href|poster|src|srcset)$/iu.test(attributeName)) {
          violations.push("DASHBOARD_BROWSER_NETWORK_FORBIDDEN");
        }
      }
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
        && ((ts.isPropertyAccessExpression(node.left) && /^(?:action|data|formAction|href|poster|src|srcset)$/u.test(node.left.name.text))
          || (ts.isElementAccessExpression(node.left) && ts.isStringLiteral(node.left.argumentExpression)
            && /^(?:action|data|formAction|href|poster|src|srcset)$/u.test(node.left.argumentExpression.text)))) {
        violations.push("DASHBOARD_BROWSER_NETWORK_FORBIDDEN");
      }
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
        && forbiddenWriteMethods.has(node.expression.name.text)) {
        violations.push("DASHBOARD_DATA_WRITE_FORBIDDEN");
      }
      if (ts.isCallExpression(node) && ts.isElementAccessExpression(node.expression)
        && ts.isStringLiteral(node.expression.argumentExpression)
        && forbiddenWriteMethods.has(node.expression.argumentExpression.text)) {
        violations.push("DASHBOARD_DATA_WRITE_FORBIDDEN");
      }
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
        && node.expression.name.text === "prepare") {
        const query = node.arguments[0] ? resolveString(node.arguments[0]) : undefined;
        if (query === undefined || !/^\s*SELECT\b/iu.test(query)) {
          violations.push("DASHBOARD_DATA_WRITE_FORBIDDEN");
        }
      }
      if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
        && /^\s*(?:ALTER|CREATE|DELETE|DROP|INSERT|REPLACE|UPDATE)\b/iu.test(node.text)) {
        violations.push("DASHBOARD_DATA_WRITE_FORBIDDEN");
      }
      if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
        && isExternalDashboardResource(node.text)) {
        violations.push("DASHBOARD_BROWSER_NETWORK_FORBIDDEN");
      }
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
        const value = resolveString(node);
        if (value !== undefined && isExternalDashboardResource(value)) {
          violations.push("DASHBOARD_BROWSER_NETWORK_FORBIDDEN");
        }
      }
      if (ts.isTemplateExpression(node)) {
        violations.push("DASHBOARD_TEMPLATE_EXPRESSION_FORBIDDEN");
        const textFragments = [node.head.text, ...node.templateSpans.map((span) => span.literal.text)];
        if (textFragments.some((text) => /<\/?script\b/iu.test(text))) {
          violations.push("DASHBOARD_OUTBOUND_NETWORK_FORBIDDEN");
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(program);
    if (strictInlineScript) {
      validateDashboardGlobals(
        program,
        new Set(["Array", "Error", "Math", "String", "document", "fetch", "setInterval", "undefined"]),
        violations,
      );
    }
    return { allowedFetchCount };
  };
  const tree = ts.createSourceFile(sourceFileName ?? "dashboard.ts", source, ts.ScriptTarget.Latest, true);
  const scriptContent = [];
  const collectInlineScripts = (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      for (const match of node.text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/giu)) scriptContent.push(match[1]);
    }
    ts.forEachChild(node, collectInlineScripts);
  };

  if (/\/api\/v1\/agent\/sync/iu.test(source)) {
    violations.push("DASHBOARD_MT5_SYNC_REFERENCE_FORBIDDEN");
  }
  if (/\b(?:OrderSend|CTrade|PositionClose|OrderModify|OrderDelete|placeOrder|closePosition|candidate|execution\s+authority)\b/iu.test(source)) {
    violations.push("DASHBOARD_EXECUTION_REFERENCE_FORBIDDEN");
  }
  scanProgram(tree);
  collectInlineScripts(tree);
  let inlineFetchCount = 0;
  for (const script of scriptContent) {
    inlineFetchCount += scanProgram(
      ts.createSourceFile("dashboard-inline-script.ts", script, ts.ScriptTarget.Latest, true),
      true,
    ).allowedFetchCount;
  }

  if (sourceFileName !== undefined) {
    if (!allowedDashboardSourceFiles.has(sourceFileName)) {
      violations.push("DASHBOARD_SOURCE_FILE_NOT_ALLOWLISTED");
    } else {
      const allowedGlobalsByFile = new Map([
        ["dashboard-html.ts", new Set()],
        ["health-summary-v1.ts", new Set(["D1Database", "NonNullable", "Promise", "const"])],
        ["index.ts", new Set(["Date", "ExportedHandler", "Math", "Promise", "Request", "Response", "URL"])],
      ]);
      validateDashboardGlobals(tree, allowedGlobalsByFile.get(sourceFileName), violations);
    }

    if (sourceFileName === "dashboard-html.ts") {
      if (scriptContent.length !== 1 || inlineFetchCount !== 1) {
        violations.push("DASHBOARD_CAPABILITY_NOT_ALLOWLISTED");
      }
      if (/\bAGENT_HEALTH_DB\b/u.test(source)) violations.push("DASHBOARD_DATA_WRITE_FORBIDDEN");
    }

    if (sourceFileName === "index.ts" && /\bAGENT_HEALTH_DB\b/u.test(source)) {
      violations.push("DASHBOARD_DATA_WRITE_FORBIDDEN");
    }

    if (sourceFileName === "index.ts") {
      const visitIndexEnv = (node) => {
        if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)
          && node.expression.text === "env") violations.push("DASHBOARD_CAPABILITY_NOT_ALLOWLISTED");
        ts.forEachChild(node, visitIndexEnv);
      };
      visitIndexEnv(tree);
    }

    if (sourceFileName === "health-summary-v1.ts") {
      const resolveString = dashboardStaticStrings(tree);
      const prepareCalls = [];
      const visitPrepare = (node) => {
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
          && node.expression.name.text === "prepare") prepareCalls.push(node);
        ts.forEachChild(node, visitPrepare);
      };
      visitPrepare(tree);
      const seenQueries = new Set();
      for (const call of prepareCalls) {
        const owner = call.expression.expression;
        const query = call.arguments[0] ? resolveString(call.arguments[0]) : undefined;
        const normalizedQuery = query === undefined ? undefined : normalizedDashboardSql(query);
        const expectedTerminal = normalizedQuery === undefined ? undefined : allowedDashboardQueries.get(normalizedQuery);
        const directDatabaseOwner = ts.isPropertyAccessExpression(owner) && owner.name.text === "AGENT_HEALTH_DB";
        if (!directDatabaseOwner || expectedTerminal === undefined
          || dashboardD1TerminalMethod(call) !== expectedTerminal || seenQueries.has(normalizedQuery)) {
          violations.push("DASHBOARD_DATA_WRITE_FORBIDDEN");
        } else {
          seenQueries.add(normalizedQuery);
        }
      }
      if (prepareCalls.length !== allowedDashboardQueries.size || seenQueries.size !== allowedDashboardQueries.size) {
        violations.push("DASHBOARD_DATA_WRITE_FORBIDDEN");
      }
      const visitDatabaseBinding = (node) => {
        if (ts.isIdentifier(node) && node.text === "AGENT_HEALTH_DB") {
          const databaseAccess = node.parent;
          const prepareAccess = databaseAccess?.parent;
          const declarationOnly = (ts.isPropertySignature(databaseAccess) || ts.isPropertyDeclaration(databaseAccess))
            && databaseAccess.name === node;
          if (!declarationOnly && (!ts.isPropertyAccessExpression(databaseAccess) || databaseAccess.name !== node
            || !ts.isPropertyAccessExpression(prepareAccess) || prepareAccess.expression !== databaseAccess
            || prepareAccess.name.text !== "prepare")) {
            violations.push("DASHBOARD_DATA_WRITE_FORBIDDEN");
          }
        }
        ts.forEachChild(node, visitDatabaseBinding);
      };
      visitDatabaseBinding(tree);
      const allowedHealthEnvProperties = new Set([
        "AGENT_HEALTH_DB", "DASHBOARD_ACCOUNT_ID", "DASHBOARD_INSTALLATION_ID",
      ]);
      const visitHealthEnv = (node) => {
        if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)
          && node.expression.text === "env" && !allowedHealthEnvProperties.has(node.name.text)) {
          violations.push("DASHBOARD_CAPABILITY_NOT_ALLOWLISTED");
        }
        ts.forEachChild(node, visitHealthEnv);
      };
      visitHealthEnv(tree);
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

export function verifyDashboardIntegrityManifest(root = repositoryRoot) {
  const violations = [];
  const sourceRoot = join(root, dashboardSourceDirectoryPath);
  const manifestPath = join(root, dashboardIntegrityManifestPath);
  const sourcePaths = sourceFiles(sourceRoot, new Set([".ts"]), new Set())
    .map((file) => relative(sourceRoot, file))
    .sort();

  if (sourcePaths.length !== allowedDashboardSourceFilePaths.length
    || sourcePaths.some((path, index) => path !== allowedDashboardSourceFilePaths[index])) {
    violations.push("DASHBOARD_INTEGRITY_MANIFEST_UNALLOWED_SOURCE_FILE");
  }

  if (!existsSync(manifestPath)) return sorted([...violations, "DASHBOARD_INTEGRITY_MANIFEST_INVALID"]);

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    return sorted([...violations, "DASHBOARD_INTEGRITY_MANIFEST_INVALID"]);
  }

  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)
    || Object.keys(manifest).length !== 2 || !Object.hasOwn(manifest, "schema_version") || !Object.hasOwn(manifest, "files")
    || manifest.schema_version !== dashboardIntegrityManifestSchemaVersion || !Array.isArray(manifest.files)) {
    return sorted([...violations, "DASHBOARD_INTEGRITY_MANIFEST_INVALID"]);
  }

  const entries = manifest.files;
  const validEntries = entries.every((entry) => entry && typeof entry === "object" && !Array.isArray(entry)
    && Object.keys(entry).length === 2 && Object.hasOwn(entry, "path") && Object.hasOwn(entry, "sha256")
    && typeof entry.path === "string" && typeof entry.sha256 === "string"
    && /^[a-f0-9]{64}$/u.test(entry.sha256));
  const manifestPaths = validEntries ? entries.map((entry) => entry.path).sort() : [];
  const manifestHasExactPaths = manifestPaths.length === allowedDashboardSourceFilePaths.length
    && manifestPaths.every((path, index) => path === allowedDashboardSourceFilePaths[index]);
  if (!validEntries || !manifestHasExactPaths) {
    return sorted([...violations, "DASHBOARD_INTEGRITY_MANIFEST_INVALID"]);
  }

  if (violations.includes("DASHBOARD_INTEGRITY_MANIFEST_UNALLOWED_SOURCE_FILE")) return sorted(violations);

  for (const entry of entries) {
    const file = join(sourceRoot, entry.path);
    const digest = createHash("sha256").update(readFileSync(file)).digest("hex");
    if (digest !== entry.sha256) violations.push("DASHBOARD_INTEGRITY_MANIFEST_DIGEST_MISMATCH");
  }

  return sorted(violations);
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
  const violations = [...verifyDashboardIntegrityManifest(root)];
  for (const file of sourceFiles(join(root, "apps/execution-edge/src"), new Set([".ts"]))) {
    violations.push(...scanWorkerFile(root, file));
  }
  for (const file of sourceFiles(join(root, "apps/agent-health-console/src"), new Set([".ts"]))) {
    violations.push(...scanHealthDashboardSource(readFileSync(file, "utf8"), relative(join(root, "apps/agent-health-console/src"), file)));
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
