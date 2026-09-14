import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '../../..');
const agent = join(root, 'mt5/TradeOpsAgent');
const targets = [
  'Include/TradeOpsTelemetryFileStore.mqh',
  'Scripts/TradeOpsTelemetryFileStoreSelfTest.mq5',
] as const;
const modeRunners = [
  ['LOCAL', 'RunLocal'],
  ['HOLD_LOCK', 'RunHoldLock'],
  ['PROBE_LOCK', 'RunProbeLock'],
  ['PROBE_AFTER_RELEASE', 'RunProbeAfterRelease'],
  ['WRITE_FIXTURE', 'RunWriteFixture'],
  ['READ_FIXTURE', 'RunReadFixture'],
] as const;
const realModeRoots = modeRunners.map(([, runner]) => runner);

const predecessors = [
  ['mt5/TradeOpsAgent/TradeOpsAgent.mq5', '4d3058b7ada9d2a2de5ab7bd864225e9120f645cf084e75e731ba747983b12b9'],
  ['mt5/TradeOpsAgent/Include/TradeOpsTelemetryValues.mqh', '0016223e32d8d0cf960a3b015581518948a8a2e1464196c0d8f7952d4dc9ea4f'],
  ['mt5/TradeOpsAgent/Include/TradeOpsTelemetryRecord.mqh', '7a0f42d1d481487ba812f6ef2b18faaf3f80143980388f4f54efd8075d977685'],
  ['mt5/TradeOpsAgent/Include/TradeOpsTelemetryStorageCodec.mqh', '15e0462aeec4b298ad2d0bbf5cbe59c0e24ebf0d1e7e4063c77075463e30f499'],
  // Intentional isolated outbox delta: closed PREPARE/ACK/REPLACE State methods.
  ['mt5/TradeOpsAgent/Include/TradeOpsTelemetryStorage.mqh', '4a215232ec12b0941ef6f4c3139eb7730d4b9773d982117693d0fb51cf668a4c'],
  ['mt5/TradeOpsAgent/Include/TradeOpsTelemetryState.mqh', '16646d3ae27c42c1751b47b96339ca81b4302cfca392933cd16a0f78b934c700'],
  // Task 3 adds read-only fault-hit observability for the measured native matrix.
  ['mt5/TradeOpsAgent/Scripts/Support/TradeOpsTelemetryMemoryStore.mqh', '9a397a105e077d257ef81b1bfa910102864c84982e1474cc6c915787393967a6'],
  ['mt5/TradeOpsAgent/Scripts/TradeOpsTelemetryValuesSelfTest.mq5', 'c1287570a90f8a412d303d27aa30d940671c431ace5213dbf76ed7b0067bd04a'],
  ['mt5/TradeOpsAgent/Scripts/TradeOpsTelemetryRecordSelfTest.mq5', '514f062d5489cede97d831596763900af0d8877c3edf4cd0f00c99c20c684503'],
  ['mt5/TradeOpsAgent/Scripts/TradeOpsTelemetryStorageCodecSelfTest.mq5', 'd8a206fc8dd9bd1183ee7f187225eb5984ac997a328785c55d03b2445f5ee7ff'],
  ['mt5/TradeOpsAgent/Scripts/TradeOpsTelemetryStateSelfTest.mq5', '3652fdae4affbf05dd95fc9895fb48ed4dd056cf1cc3e352dad4e6486892eaa9'],
  ['apps/execution-edge/test/mt5-telemetry-values-v2-source.test.ts', '36ec1017d1f6b79627536db3ff98a606e77279fc502c443bea97b2822b2dc55c'],
  ['apps/execution-edge/test/mt5-telemetry-record-v2-source.test.ts', '6177e450dafe31d84bc927ba147e346af5eac6fa9461f7640590338c3960afd0'],
  ['apps/execution-edge/test/mt5-telemetry-storage-codec-v2-source.test.ts', '1d31d8da97af47bc498ab47062813e7d76fba37fba22f6c7109fc2c6cbe5d761'],
  ['apps/execution-edge/test/mt5-telemetry-state-v2-source.test.ts', 'a801c2a7fd9adb49facf85a3ff1d20903343d8d839425674508765a94a83af2e'],
] as const;

function source(relativePath: (typeof targets)[number]): string {
  const full = join(agent, relativePath);
  expect(existsSync(full), relativePath).toBe(true);
  return readFileSync(full, 'utf8');
}

function sha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function available(relativePath: (typeof targets)[number]): boolean {
  return existsSync(join(agent, relativePath));
}

function codeMask(value: string, maskStrings = true): string {
  const masked = [...value];
  let quote = '';
  let lineComment = false;
  let blockComment = false;
  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    const next = value[index + 1];
    if (lineComment) {
      if (character === '\n') lineComment = false;
      else masked[index] = ' ';
      continue;
    }
    if (blockComment) {
      if (character !== '\n') masked[index] = ' ';
      if (character === '*' && next === '/') {
        masked[index + 1] = ' ';
        blockComment = false;
        index++;
      }
      continue;
    }
    if (quote !== '') {
      if (maskStrings && character !== '\n') masked[index] = ' ';
      if (character === '\\') {
        if (maskStrings) masked[index + 1] = ' ';
        index++;
      } else if (character === quote) quote = '';
      continue;
    }
    if (character === '/' && next === '/') {
      masked[index] = ' ';
      masked[index + 1] = ' ';
      lineComment = true;
      index++;
      continue;
    }
    if (character === '/' && next === '*') {
      masked[index] = ' ';
      masked[index + 1] = ' ';
      blockComment = true;
      index++;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      if (maskStrings) masked[index] = ' ';
    }
  }
  return masked.join('');
}

function block(value: string, declaration: RegExp): string {
  const code = codeMask(value);
  const match = code.match(declaration);
  expect(match?.index, declaration.source).toBeTypeOf('number');
  if (match?.index === undefined) throw new Error(`missing declaration: ${declaration.source}`);
  const open = code.indexOf('{', match.index + match[0].length);
  expect(open, declaration.source).toBeGreaterThanOrEqual(0);

  let depth = 0;
  for (let index = open; index < code.length; index++) {
    const character = code[index];
    if (character === '{') depth++;
    if (character === '}' && --depth === 0) return value.slice(match.index, index + 1);
  }
  throw new Error(`unclosed declaration: ${declaration.source}`);
}

function calls(value: string, callee: string): { source: string; args: string[]; start: number; end: number }[] {
  const code = codeMask(value);
  const found: { source: string; args: string[]; start: number; end: number }[] = [];
  const escaped = callee.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const matcher = new RegExp(`${escaped}\\s*\\(`, 'gu');
  let search = 0;
  while (search < value.length) {
    matcher.lastIndex = search;
    const match = matcher.exec(code);
    if (match === null) break;
    const start = match.index;
    if (/[.\w]/u.test(code[start - 1] ?? '')) {
      search = start + match[0].length;
      continue;
    }
    const open = code.indexOf('(', start + callee.length);
    let depth = 0;
    const commas: number[] = [];
    let end = -1;
    for (let index = open; index < code.length; index++) {
      const character = code[index];
      if (character === '(') depth++;
      else if (character === ')') {
        depth--;
        if (depth === 0) {
          end = index + 1;
          break;
        }
      } else if (character === ',' && depth === 1) commas.push(index);
    }
    expect(end, callee).toBeGreaterThan(start);
    const boundaries = [open + 1, ...commas.map((index) => index + 1), end - 1];
    const args = boundaries.slice(0, -1).map((from, index) =>
      value.slice(from, commas[index] ?? end - 1).trim());
    found.push({ source: value.slice(start, end), args, start, end });
    search = end;
  }
  return found;
}

function onlyCall(value: string, callee: string) {
  const found = calls(value, callee);
  expect(found, callee).toHaveLength(1);
  const call = found[0];
  if (call === undefined) throw new Error(`missing call: ${callee}`);
  return call;
}

type NativeFunction = { name: string; source: string };
const nativeFunctionCache = new Map<string, Map<string, NativeFunction>>();
const reachabilityCache = new WeakMap<Map<string, NativeFunction>, Map<string, Set<string>>>();

function nativeFunctions(value: string): Map<string, NativeFunction> {
  const cached = nativeFunctionCache.get(value);
  if (cached !== undefined) return cached;
  const code = codeMask(value);
  const depths: number[] = new Array(code.length).fill(0);
  let depth = 0;
  for (let index = 0; index < code.length; index++) {
    depths[index] = depth;
    if (code[index] === '{') depth++;
    else if (code[index] === '}') depth--;
  }
  const functions = new Map<string, NativeFunction>();
  const declaration = /^\s*(?:static\s+)?[A-Za-z_]\w*(?:\s*[&*])?\s+([A-Za-z_]\w*)\s*\(/gmu;
  for (const match of code.matchAll(declaration)) {
    const start = match.index;
    if ((depths[start] ?? -1) !== 0) continue;
    const name = match[1];
    if (name === undefined) continue;
    const open = code.indexOf('{', start + match[0].length);
    const terminator = code.indexOf(';', start + match[0].length);
    if (open < 0 || (terminator >= 0 && terminator < open)) continue;
    let braces = 0;
    let end = -1;
    for (let index = open; index < code.length; index++) {
      if (code[index] === '{') braces++;
      else if (code[index] === '}' && --braces === 0) {
        end = index + 1;
        break;
      }
    }
    expect(end, name).toBeGreaterThan(open);
    expect(functions.has(name), `${name} top-level function must be unique`).toBe(false);
    functions.set(name, { name, source: value.slice(start, end) });
  }
  nativeFunctionCache.set(value, functions);
  return functions;
}

function reachable(functions: Map<string, NativeFunction>, roots: readonly string[]): Set<string> {
  let cache = reachabilityCache.get(functions);
  if (cache === undefined) {
    cache = new Map<string, Set<string>>();
    reachabilityCache.set(functions, cache);
  }
  const cacheKey = [...roots].sort().join('\0');
  const cached = cache.get(cacheKey);
  if (cached !== undefined) return cached;
  const reached = new Set<string>();
  const pending = [...roots];
  while (pending.length > 0) {
    const name = pending.pop();
    if (name === undefined || reached.has(name)) continue;
    const fn = functions.get(name);
    if (fn === undefined) continue;
    reached.add(name);
    for (const candidate of functions.keys()) {
      if (!reached.has(candidate) && calls(fn.source, candidate).length > 0)
        pending.push(candidate);
    }
  }
  cache.set(cacheKey, reached);
  return reached;
}

type NativeAssignment = { expression: string; start: number };

function assignments(value: string): Map<string, NativeAssignment[]> {
  const code = codeMask(value);
  const found = new Map<string, NativeAssignment[]>();
  const add = (name: string, expression: string, start: number) => {
    const existing = found.get(name) ?? [];
    existing.push({ expression, start });
    found.set(name, existing);
  };
  const pattern = /(?:^|(?<=[;{}]))\s*(?:(?:const\s+)?[A-Za-z_]\w*(?:\s*[&*])?\s+)?([A-Za-z_]\w*)\s*=\s*([^;]+);/gmu;
  for (const match of code.matchAll(pattern)) {
    const name = match[1];
    const expression = match[2];
    const start = match.index;
    if (name === undefined || expression === undefined || start === undefined) continue;
    add(name, expression, start);
  }
  const mutation = /(?:^|(?<=[;{}]))\s*([A-Za-z_]\w*)\s*(?:\+\+|--|[+*/%&|^-]=)[^;]*;/gmu;
  for (const match of code.matchAll(mutation)) {
    const name = match[1];
    const start = match.index;
    if (name !== undefined && start !== undefined)
      add(name, '__ambiguous_mutation__', start);
  }
  const prefixMutation = /(?:^|(?<=[;{}]))\s*(?:\+\+|--)\s*([A-Za-z_]\w*)[^;]*;/gmu;
  for (const match of code.matchAll(prefixMutation)) {
    const name = match[1];
    const start = match.index;
    if (name !== undefined && start !== undefined)
      add(name, '__ambiguous_mutation__', start);
  }
  for (const writes of found.values()) writes.sort((left, right) => left.start - right.start);
  return found;
}

function directOperationOrFake(expression: string): boolean {
  const publicOperation = /\.\s*(?:Acquire|Revalidate|Inventory|Read|CreateExact|DeleteExact)\s*\(/u;
  const fakeObservation = /\b[A-Za-z_]\w*(?:fake|ops)[A-Za-z_]*\s*\.\s*[A-Za-z_]\w*\s*\(/iu;
  return publicOperation.test(expression) || fakeObservation.test(expression);
}

const approvedPrimitive = /\b(?:ArraySize|ArrayCompare|StringLen|StringCompare|Tov2LocalHash|Tov2StorageSameLocator|Tov2Digest|Tov2CounterFromText)\s*\(/u;

function primitiveOrInputValidation(expression: string): boolean {
  return approvedPrimitive.test(expression) ||
    /\bTestMode\b\s*(?:==|!=)|(?:==|!=)\s*\bTestMode\b/u.test(expression);
}

function mandatoryDerivedExpression(expression: string): boolean {
  const code = codeMask(expression);
  const compact = code.replace(/\s+/gu, '');
  return !compact.includes('||') && !/[?:]/u.test(compact) &&
    !/\btrue\b/u.test(code) && !hasCommaOperator(compact) &&
    !/\b([A-Za-z_]\w*)\s*(?:==|!=)\s*\1\b/u.test(code);
}

function unqualifiedHelperCalls(expression: string): string[] {
  const code = codeMask(expression);
  return [...code.matchAll(/\b([A-Za-z_]\w*)\s*\(/gu)].flatMap((match) => {
    const name = match[1];
    const index = match.index;
    if (name === undefined || index === undefined) return [];
    let previous = index - 1;
    while (/\s/u.test(code[previous] ?? '')) previous--;
    if (code[previous] === '.') return [];
    if (/^(?:if|for|while|switch|return|Check|ArraySize|ArrayCompare|StringLen|StringCompare|Tov2LocalHash|Tov2StorageSameLocator|Tov2Digest|Tov2CounterFromText)$/u.test(name))
      return [];
    return [name];
  });
}

function helperDerived(
  name: string, functions: Map<string, NativeFunction>, seen: Set<string>,
): boolean {
  if (seen.has(name)) return false;
  const fn = functions.get(name);
  if (fn === undefined) return false;
  const nextSeen = new Set(seen).add(name);
  const code = codeMask(fn.source);
  const returns = [...code.matchAll(/\breturn\s+([^;]+);/gu)]
    .map((match) => ({
      expression: match[1]?.trim() ?? '',
      start: match.index,
    }));
  if (returns.length === 0) return false;
  const localAssignments = assignments(fn.source);
  return returns.every(({ expression, start }) =>
    expressionDerived(expression, localAssignments, functions, nextSeen, start));
}

function expressionDerived(
  expression: string, assigned: Map<string, NativeAssignment[]>,
  functions: Map<string, NativeFunction>, seen: Set<string>, before: number,
): boolean {
  if (!mandatoryDerivedExpression(expression)) return false;
  const helpers = unqualifiedHelperCalls(expression);
  if (helpers.some((helper) => !helperDerived(helper, functions, seen))) return false;
  if (directOperationOrFake(expression) || primitiveOrInputValidation(expression)) return true;
  if (helpers.length > 0) return true;
  const identifiers = [...expression.matchAll(/\b[A-Za-z_]\w*\b/gu)]
    .map((match) => match[0]);
  return identifiers.some((identifier) =>
    hasProvenance(identifier, assigned, functions, seen, before));
}

function hasProvenance(
  name: string, assigned: Map<string, NativeAssignment[]>, functions: Map<string, NativeFunction>,
  seen = new Set<string>(), before = Number.POSITIVE_INFINITY,
): boolean {
  if (seen.has(name)) return false;
  const writes = (assigned.get(name) ?? []).filter((write) => write.start < before);
  const latest = writes.at(-1);
  if (latest === undefined) return false;
  if (writes.length > 1) {
    const helpers = unqualifiedHelperCalls(latest.expression);
    return mandatoryDerivedExpression(latest.expression) &&
      directOperationOrFake(latest.expression) &&
      helpers.every((helper) => helperDerived(helper, functions, seen));
  }
  return expressionDerived(
    latest.expression, assigned, functions, new Set(seen).add(name), latest.start,
  );
}

function expectScenarioCategory(
  source: string, functionName: string, label: string,
  functions: Map<string, NativeFunction>,
): void {
  const code = codeMask(source);
  const publicOperation = /\.\s*(?:Acquire|Revalidate|Inventory|Read|CreateExact|DeleteExact)\s*\(/u;
  const fakeSetup = /(?:\b[A-Za-z_]\w*(?:fake|ops)[A-Za-z_]*\s*\.\s*[A-Za-z_]\w*\s*\(|\.\s*[A-Za-z_]*?(?:Fault|Outcome|Owner|Handle|Error|Count|Enumerat|Alloc|Copy|Hash|Resize|Arm|Force|Observe|Inject|Seed|Set|Fail|Short|Partial|Stale|Missing)[A-Za-z_]*\s*\()/iu;
  const require = (pattern: RegExp, category: string) =>
    expect(code, `${label} ${category} setup in ${functionName}`).toMatch(pattern);

  if (/^(?:owner|session)\./u.test(label)) {
    require(/(?:\.\s*(?:Acquire|Revalidate)\s*\(|\.\s*[A-Za-z_]*Owner[A-Za-z_]*\s*\()/iu,
      'ownership');
  } else if (label.startsWith('inventory.')) require(/\.\s*Inventory\s*\(/u, 'inventory');
  else if (label.startsWith('read.')) require(/\.\s*Read\s*\(/u, 'read');
  else if (label.startsWith('create.')) require(/\.\s*CreateExact\s*\(/u, 'create');
  else if (label.startsWith('delete.')) require(/\.\s*DeleteExact\s*\(/u, 'delete');
  else if (/^(?:local|start|probe|fixture)\./u.test(label)) {
    require(publicOperation, 'real store operation');
    const helpers = unqualifiedHelperCalls(source)
      .filter((name) => name !== functionName && functions.has(name));
    expect(helpers.some((name) =>
      helperDerived(name, functions, new Set([functionName]))),
    `${label} recursively proven mode helper in ${functionName}`).toBe(true);
  } else {
    require(fakeSetup, 'fake fault or observation');
  }
}

function hasCommaOperator(value: string): boolean {
  const stack: boolean[] = [];
  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    if (character === '(') {
      let previous = index - 1;
      while (/\s/u.test(value[previous] ?? '')) previous--;
      stack.push(/[A-Za-z0-9_\])]/u.test(value[previous] ?? ''));
    } else if (character === '[') stack.push(false);
    else if (character === ')' || character === ']') stack.pop();
    else if (character === ',' && stack.at(-1) !== true) return true;
  }
  return false;
}

function expectOpenFlags(value: string, expected: readonly string[]): void {
  const open = onlyCall(value, 'm_ops.OpenCommon');
  expect(open.args).toHaveLength(3);
  let expression = codeMask(open.args[1] ?? '').trim();
  if (/^[A-Za-z_]\w*$/u.test(expression)) {
    const before = codeMask(value.slice(0, open.start));
    const assignments = [...before.matchAll(new RegExp(
      `(?:^|[;{}])\\s*(?:(?:const\\s+)?int\\s+)?${expression}\\s*=\\s*([^;]+);`,
      'gmu',
    ))];
    expect(assignments.length, `${expression} flag assignment`).toBeGreaterThan(0);
    expression = assignments.at(-1)?.[1]?.trim() ?? '';
  }
  const terms = stripOuterParens(expression).split('|')
    .map((term) => stripOuterParens(term.trim()));
  expect(terms.every((term) => /^FILE_[A-Z_]+$/u.test(term))).toBe(true);
  const flags = terms;
  expect(new Set(flags)).toEqual(new Set(expected));
}

function expectExactCount(value: string, callee: 'ReadBytes' | 'WriteBytes'): void {
  const call = onlyCall(value, `m_ops.${callee}`);
  expect(call.args, `${callee} argument count`).toHaveLength(5);
  const requested = call.args.at(-2);
  expect(requested, `${callee} requested count`).toMatch(/^[A-Za-z_]\w*$/u);
  if (requested === undefined) throw new Error(`${callee} has no requested count`);
  const before = codeMask(value.slice(0, call.start));
  const assignment = before.match(
    /(?:^|[;{}])\s*(?:(?:const\s+)?(uint|int|long)\s+)?([A-Za-z_]\w*)\s*=\s*$/u,
  );
  const declaredType = assignment?.[1];
  const result = assignment?.[2];
  if (declaredType !== undefined) expect(['uint', 'int', 'long']).toContain(declaredType);
  expect(result, `${callee} result assignment`).toMatch(/^[A-Za-z_]\w*$/u);
  if (result === undefined) throw new Error(`${callee} result is not assigned`);
  const compactMethod = codeMask(value).replace(/\s+/gu, '');
  const cast = '(?:\\((?:int|uint|long)\\))?';
  const comparison = new RegExp(
    `(?<![A-Za-z0-9_])(?:${result}!=${cast}${requested}|${cast}${requested}!=${result})(?![A-Za-z0-9_])`,
    'u',
  );
  expect(compactMethod, `${callee} exact-count comparison`).toMatch(comparison);
}

function checkForLabel(value: string, label: string, roots: readonly string[]) {
  const functions = nativeFunctions(value);
  const matching = [...functions.values()].flatMap((fn) =>
    calls(fn.source, 'Check')
      .filter((call) => call.args.some((argument) => argument.trim() === `"${label}"`))
      .map((call) => ({ call, fn })));
  expect(matching, `${label} executable Check`).toHaveLength(1);
  const found = matching[0];
  if (found === undefined) throw new Error(`missing executable Check: ${label}`);
  const condition = codeMask(found.call.args[0] ?? '', false).trim();
  expect(condition, `${label} Check condition`).not.toMatch(
    /^(?:true|false|[-+]?\d+(?:\.\d+)?|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')$/u,
  );
  const conditionCode = codeMask(found.call.args[0] ?? '');
  const compactCondition = conditionCode.replace(/\s+/gu, '');
  expect(compactCondition, `${label} cannot make observations optional`).not.toContain('||');
  expect(compactCondition, `${label} cannot use a ternary`).not.toMatch(/[?:]/u);
  expect(compactCondition, `${label} cannot depend on literal true`).not.toMatch(/\btrue\b/u);
  expect(compactCondition.replace(/&&/gu, ''), `${label} only permits logical conjunction`)
    .not.toMatch(/[&|^]/u);
  expect(hasCommaOperator(compactCondition), `${label} cannot use the comma operator`).toBe(false);
  expect(conditionCode, `${label} cannot use a self-comparison`).not.toMatch(
    /\b([A-Za-z_]\w*)\s*(?:==|!=)\s*\1\b\s*(?=$|&&|\|\||\))/u,
  );
  const assigned = assignments(found.fn.source.slice(0, found.call.start));
  const terms = conjunctions(compactCondition).map(stripOuterParens);
  expect(terms.length, `${label} mandatory condition terms`).toBeGreaterThan(0);
  for (const term of terms) {
    const unaryIdentifier = /^!?[A-Za-z_]\w*$/u.test(term);
    const comparisons = term.match(/(?:==|!=|<=|>=|<|>)/gu) ?? [];
    const comparison = comparisons.length === 1;
    expect(unaryIdentifier || comparison, `${label} unsupported condition term: ${term}`)
      .toBe(true);
    if (term.replace(/!=/gu, '').includes('!'))
      expect(term, `${label} only permits unary negation of an observation identifier`)
        .toMatch(/^![A-Za-z_]\w*$/u);
    expect(hasCommaOperator(term), `${label} cannot use a nested comma operator`).toBe(false);
    const identifiers = [...term.matchAll(/\b[A-Za-z_]\w*\b/gu)]
      .map((match) => match[0])
      .filter((identifier) => identifier !== 'Check' &&
        !/^(?:true|false|const|int|uint|long|bool|string|TOV2_[A-Z0-9_]+)$/u.test(identifier));
    expect(identifiers.some((identifier) =>
      hasProvenance(identifier, assigned, functions)),
      `${label} term must reference an assigned operation observation`).toBe(true);
  }
  const fromOnStart = reachable(functions, ['OnStart']);
  expect(fromOnStart.has(found.fn.name), `${label} reachable from OnStart`).toBe(true);
  expect(roots.some((root) =>
    fromOnStart.has(root) && reachable(functions, [root]).has(found.fn.name)),
  `${label} reachable through an approved suite or mode runner`).toBe(true);
  expectScenarioCategory(found.fn.source, found.fn.name, label, functions);
  return found;
}

function stripOuterParens(value: string): string {
  let result = value;
  while (result.startsWith('(') && result.endsWith(')')) {
    let depth = 0;
    let closesAtEnd = false;
    for (let index = 0; index < result.length; index++) {
      if (result[index] === '(') depth++;
      else if (result[index] === ')' && --depth === 0) {
        closesAtEnd = index === result.length - 1;
        break;
      }
    }
    if (!closesAtEnd) break;
    result = result.slice(1, -1);
  }
  return result;
}

function conjunctions(value: string): string[] {
  const expression = stripOuterParens(value);
  let depth = 0;
  const parts: string[] = [];
  let start = 0;
  for (let index = 0; index < expression.length - 1; index++) {
    if (expression[index] === '(') depth++;
    else if (expression[index] === ')') depth--;
    else if (depth === 0 && expression.slice(index, index + 2) === '&&') {
      parts.push(expression.slice(start, index));
      start = index + 2;
      index++;
    }
  }
  if (parts.length === 0) return [expression];
  parts.push(expression.slice(start));
  return parts.flatMap(conjunctions);
}

function expectOutcome(
  value: string, label: string, expected: string, roots: readonly string[],
): void {
  const found = checkForLabel(value, label, roots);
  const condition = codeMask(found.call.args[0] ?? '').replace(/\s+/gu, '');
  expect(condition, `${label} must use positive equality`).not.toContain('!');
  expect(condition, `${label} cannot make the expected outcome optional`).not.toContain('||');
  expect(condition, `${label} cannot use a ternary outcome`).not.toMatch(/[?:]/u);
  expect(condition, `${label} cannot negate equality with false`).not.toMatch(/==false|false==/u);
  const positive = new RegExp(
    `^(?:[A-Za-z_]\\w*==${expected}|${expected}==[A-Za-z_]\\w*)$`,
    'u',
  );
  expect(conjunctions(condition).some((part) => positive.test(stripOuterParens(part))),
    `${label} expected ${expected} as a mandatory conjunct`).toBe(true);
  const storeOutcomes = [
    ...condition.matchAll(/\bTOV2_STORE_[A-Z_]+(?===)/gu),
    ...condition.matchAll(/(?<===)TOV2_STORE_[A-Z_]+\b/gu),
  ].map((match) => match[0]);
  expect(new Set(storeOutcomes), `${label} cannot accept another store outcome`)
    .toEqual(new Set([expected]));
  const equality = conjunctions(condition)
    .map(stripOuterParens)
    .find((part) => positive.test(part));
  const result = equality?.match(/^([A-Za-z_]\w*)==TOV2_STORE_/u)?.[1] ??
    equality?.match(/TOV2_STORE_[A-Z_]+==([A-Za-z_]\w*)$/u)?.[1];
  expect(result, `${label} compared result variable`).toMatch(/^[A-Za-z_]\w*$/u);
  if (result !== undefined) {
    const before = codeMask(found.fn.source.slice(0, found.call.start));
    const liveOwnerRevalidation = /^owner\.(?:live_)?revalidation(?:\.|$)/u.test(label);
    const operation = label.startsWith('create.') ? 'CreateExact' :
      label.startsWith('owner.') ? (liveOwnerRevalidation ? 'Revalidate' : 'Acquire') :
        label.startsWith('session.') ? 'Revalidate' :
          label.startsWith('inventory.') ? 'Inventory' :
            label.startsWith('read.') ? 'Read' :
              label.startsWith('delete.') ? 'DeleteExact' :
                label === 'containers.missing_after_acquire_conflict' ? 'Inventory' : null;
    expect(operation, `${label} exact public operation mapping`).not.toBeNull();
    if (operation === null) throw new Error(`unmapped exact outcome label: ${label}`);
    const assignment = new RegExp(
      `\\b${result}\\s*=\\s*(?:[A-Za-z_]\\w*\\s*\\.\\s*)?${operation}\\s*\\(`,
      'u',
    );
    expect(before, `${label} result must be assigned from ${operation} in the same scenario`)
      .toMatch(assignment);
  }
}

function ifBranch(value: string, mode: string): string {
  const code = codeMask(value);
  const commentsRemoved = codeMask(value, false);
  const candidates: { close: number; condition: string }[] = [];
  for (const match of code.matchAll(/\b(?:else\s+)?if\s*\(/gu)) {
    const open = code.indexOf('(', match.index);
    let depth = 0;
    let close = -1;
    for (let index = open; index < code.length; index++) {
      if (code[index] === '(') depth++;
      else if (code[index] === ')' && --depth === 0) {
        close = index;
        break;
      }
    }
    if (close >= 0) {
      const condition = commentsRemoved.slice(open + 1, close).replace(/\s+/gu, '');
      if (condition === `TestMode=="${mode}"`) candidates.push({ close, condition });
    }
  }
  expect(candidates, `${mode} if/else-if condition`).toHaveLength(1);
  const candidate = candidates[0];
  if (candidate === undefined) throw new Error(`missing mode condition: ${mode}`);
  let start = candidate.close + 1;
  while (/\s/u.test(code[start] ?? '')) start++;
  if (code[start] !== '{') {
    const end = code.indexOf(';', start);
    expect(end, `${mode} controlled statement`).toBeGreaterThan(start);
    return value.slice(start, end + 1);
  }
  let depth = 0;
  for (let index = start; index < code.length; index++) {
    if (code[index] === '{') depth++;
    else if (code[index] === '}' && --depth === 0) return value.slice(start, index + 1);
  }
  throw new Error(`unclosed mode branch: ${mode}`);
}

function unqualifiedNativeCalls(value: string): string[] {
  const code = codeMask(value);
  const matches = [...code.matchAll(/\b(?:File|Folder)[A-Za-z0-9_]*\s*\(/gu)];
  return matches.flatMap((match) => {
    const index = match.index;
    if (index === undefined) return [];
    if (/m_ops\s*\.\s*$/u.test(code.slice(Math.max(0, index - 24), index)))
      return [];
    const lineStart = code.lastIndexOf('\n', index) + 1;
    const prefix = code.slice(lineStart, index).trim();
    if (/^virtual\s+[A-Za-z_]\w*(?:\s*[&*])?\s*$/u.test(prefix)) return [];
    return [match[0].trimEnd()];
  });
}

describe('MT5 FILE_COMMON telemetry file-store source seam', () => {
  it('declares the native Inputs dialog so operators can select a test mode', () => {
    // Static launch-contract check; displaying the dialog still requires Windows.
    const native = source('Scripts/TradeOpsTelemetryFileStoreSelfTest.mq5');
    expect(native).toMatch(/^\s*#property\s+script_show_inputs\s*$/mu);
  });

  it('requires the complete additive checkpoint', () => {
    const missing = targets.filter((path) => !existsSync(join(agent, path)));
    expect(missing, 'both additive MQL file-store targets must exist').toEqual([]);

    const checkpoint = new Map<string, string>(
      targets.map((path) => [path, source(path)]),
    );
    checkpoint.set(
      'test/mt5-telemetry-file-store-v2-source.test.ts',
      readFileSync(import.meta.filename, 'utf8'),
    );
    expect(checkpoint.size).toBe(3);
    for (const [path, text] of checkpoint) {
      expect(text.length, path).toBeGreaterThan(500);
      for (const parts of [['T', 'ODO'], ['T', 'BD'], ['sim', 'ilar', ' ', 'to']])
        expect(text, path).not.toContain(parts.join(''));
    }
  });

  it('confines native file access behind the frozen three-class layering', () => {
    if (!available('Include/TradeOpsTelemetryFileStore.mqh')) return;
    const store = source('Include/TradeOpsTelemetryFileStore.mqh');
    const includes = store.split('\n').filter((line) => line.startsWith('#include'));

    expect(includes).toEqual(['#include "TradeOpsTelemetryStorage.mqh"']);
    const contract = block(store, /^class ITov2TelemetryFileOps\b[^\n{]*/mu);
    const mql = block(store, /^class CTov2TelemetryMqlFileOps\s*:\s*public ITov2TelemetryFileOps\b[^\n{]*/mu);
    const storage = block(store, /^class CTov2TelemetryFileStore\s*:\s*public ITov2TelemetryStorage\b[^\n{]*/mu);
    const contractCode = codeMask(contract);
    const storageCode = codeMask(storage);
    const opsReady = block(storage, /^\s*bool\s+OpsReady\s*\(/mu);
    const closeHandle = block(storage, /^\s*bool\s+CloseHandle\s*\(/mu);
    const abi = [
      'virtual bool FolderCreateCommon(const string path,int &native_error)=0;',
      'virtual long FindFirstCommon(const string filter,string &name,int &native_error)=0;',
      'virtual bool FindNext(const long search_handle,string &name,int &native_error)=0;',
      'virtual bool FindClose(const long search_handle,int &native_error)=0;',
      'virtual long PathIntegerCommon(const string path,const ENUM_FILE_PROPERTY_INTEGER property,int &native_error)=0;',
      'virtual int OpenCommon(const string path,const int flags,int &native_error)=0;',
      'virtual long HandleInteger(const int handle,const ENUM_FILE_PROPERTY_INTEGER property,int &native_error)=0;',
      'virtual uint ReadBytes(const int handle,uchar &bytes[],const int start,const int count,int &native_error)=0;',
      'virtual uint WriteBytes(const int handle,const uchar &bytes[],const int start,const int count,int &native_error)=0;',
      'virtual bool Flush(const int handle,int &native_error)=0;',
      'virtual bool CloseFile(const int handle,int &native_error)=0;',
      'virtual bool DeleteFileCommon(const string path,int &native_error)=0;',
      'virtual int ResizeBytes(uchar &bytes[],const int count,int &native_error)=0;',
      'virtual int CopyBytes(uchar &destination[],const uchar &source[],const int destination_start,const int source_start,const int count,int &native_error)=0;',
      'virtual int ResizeEntries(Tov2StorageEntry &entries[],const int count,int &native_error)=0;',
      'virtual bool HashBytes(const uchar &bytes[],string &sha,int &native_error)=0;',
    ];
    const normalize = (value: string) => value.replace(/\s+/gu, '');
    const declarations = [...contractCode.matchAll(/\bvirtual\s+[\s\S]*?=\s*0\s*;/gu)]
      .map((match) => normalize(match[0])).sort();
    expect(declarations).toEqual(abi.map(normalize).sort());

    const mqlStart = store.indexOf(mql);
    expect(mqlStart).toBeGreaterThanOrEqual(0);
    const outsideMql = store.slice(0, mqlStart) + ' '.repeat(mql.length) +
      store.slice(mqlStart + mql.length);
    expect(unqualifiedNativeCalls(outsideMql)).toEqual([]);
    const outsideCode = codeMask(outsideMql);
    expect(outsideCode).not.toMatch(/(^|[^.\w])(?:ResetLastError|GetLastError)\s*\(/u);
    expect(storageCode).not.toMatch(/(^|[^.\w])(?:ArrayResize|ArrayCopy)\s*\(/u);
    const approved = new Set([
      'FolderCreateCommon', 'FindFirstCommon', 'FindNext', 'FindClose',
      'PathIntegerCommon', 'OpenCommon', 'HandleInteger', 'ReadBytes',
      'WriteBytes', 'Flush', 'CloseFile', 'DeleteFileCommon', 'ResizeBytes',
      'CopyBytes', 'ResizeEntries', 'HashBytes',
    ]);
    const invoked = [...outsideCode.matchAll(/\bm_ops\s*\.\s*([A-Za-z_]\w*)\s*\(/gu)]
      .map((match) => match[1] ?? '');
    expect(invoked.filter((callee) => !approved.has(callee))).toEqual([]);
    expect(calls(mql, 'FileOpen').length).toBeGreaterThan(0);
    expect(calls(mql, 'FileClose').length).toBeGreaterThan(0);
    expect(mql).toContain('FILE_COMMON');
    expect(storage).toContain('Tov2StorageRelativePath(locator)');
    expect(storage).toContain('Tov2Digest(installation_key)');
    const storageWithoutPseudoEntry = storage.replace(
      block(storage, /^\s*bool\s+IsPseudoEntry\s*\(/mu), '',
    );
    expect(storageWithoutPseudoEntry).not.toMatch(/(?:\.\.|[A-Za-z]:[\\/]|\\\\|\/Users\/|\/home\/|\/tmp\/)/u);
    for (const signature of [
      'int Read(const string session_token,const Tov2StorageLocator &locator,',
      'int CreateExact(const string session_token,const Tov2StorageLocator &locator,',
      'int DeleteExact(const string session_token,const Tov2StorageLocator &locator,',
    ]) expect(storage).toContain(signature);

    const hash = block(mql, /^\s*(?:virtual\s+)?bool\s+HashBytes\s*\(/mu);
    const hashCode = codeMask(hash);
    expect(hashCode).toMatch(/bool\s+HashBytes\(const uchar &bytes\[\],string &sha,int &native_error\)/u);
    expect(hashCode).toContain('Tov2LocalHash(');
    expect(codeMask(store).match(/\bTov2LocalHash\s*\(/gu)).toHaveLength(1);
    const storageHashes = calls(storage, 'm_ops.HashBytes');
    expect(storageHashes.length).toBeGreaterThan(0);
    for (const call of storageHashes) expect(call.args).toHaveLength(3);
    expect(storageCode).not.toContain('Tov2LocalHash(');
    expect(codeMask(opsReady).replace(/\s+/gu, ''))
      .toContain('CheckPointer(m_ops)!=POINTER_INVALID');
    expect(codeMask(closeHandle)).toContain('OpsReady()');
    const storageBody = storage.slice(storage.indexOf('{') + 1, storage.lastIndexOf('}'));
    for (const member of nativeFunctions(storageBody).values()) {
      const masked = codeMask(member.source);
      const firstDereference = masked.search(/\bm_ops\s*\./u);
      if (firstDereference < 0) continue;
      expect(masked.slice(0, firstDereference), `${member.name} guards m_ops`)
        .toContain('OpsReady()');
    }
    expect(normalize(storage)).toContain(
      normalize('if(file_ops==NULL) m_ops=&m_default_ops; else m_ops=file_ops;'),
    );
    expect(normalize(storage)).toContain(
      normalize('CTov2TelemetryFileStore(const CTov2TelemetryFileStore &other)=delete;'),
    );
    expect(normalize(storage)).toContain(
      normalize('void operator=(const CTov2TelemetryFileStore &other)=delete;'),
    );
  });

  it('holds an exclusive owner lock and preserves native error evidence', () => {
    if (!available('Include/TradeOpsTelemetryFileStore.mqh')) return;
    const store = source('Include/TradeOpsTelemetryFileStore.mqh');
    const mql = block(store, /^class CTov2TelemetryMqlFileOps\s*:\s*public ITov2TelemetryFileOps\b[^\n{]*/mu);
    const storage = block(store, /^class CTov2TelemetryFileStore\s*:\s*public ITov2TelemetryStorage\b[^\n{]*/mu);
    const acquire = block(storage, /^\s*(?:virtual\s+)?int\s+Acquire\s*\(/mu);
    const revalidate = block(storage, /^\s*(?:virtual\s+)?int\s+Revalidate\s*\(/mu);
    const close = block(storage, /^\s*(?:virtual\s+)?void\s+Close\s*\(/mu);
    const ownershipCode = [acquire, revalidate, close]
      .map((method) => codeMask(method)).join('\n');
    const openCommon = block(mql, /^\s*(?:virtual\s+)?(?:int|long)\s+OpenCommon\s*\(/mu);

    expectOpenFlags(acquire, ['FILE_BIN', 'FILE_READ', 'FILE_WRITE']);
    const nativeOpen = onlyCall(openCommon, 'FileOpen');
    expect(nativeOpen.source.replace(/\s+/gu, '')).toBe('FileOpen(path,flags|FILE_COMMON)');
    expect(mql).toContain('INVALID_HANDLE');
    expect(calls(mql, 'ResetLastError').length).toBeGreaterThan(0);
    expect(calls(mql, 'GetLastError').length).toBeGreaterThan(0);
    expect(store).toContain('ERR_CANNOT_OPEN_FILE');
    expect(codeMask(acquire)).toContain('Tov2StorageOwnerLocator()');
    expect(ownershipCode).toContain('TOV2_STORE_BUSY');
    expect(ownershipCode).toContain('TOV2_STORE_OWNERSHIP_LOST');
    expect(ownershipCode).toContain('TOV2_STORE_IO_ERROR');
    expect(ownershipCode).toMatch(/m_\w*(?:owner|lock)\w*\s*!=\s*INVALID_HANDLE/u);
    expect(ownershipCode).toMatch(/m_\w*(?:owner|lock)\w*\s*=\s*INVALID_HANDLE/u);
    expect(ownershipCode).toContain('installation_key');
    expect(ownershipCode).toContain('session_token');
  });

  it('implements exact bounded binary read, create, and protected delete', () => {
    if (!available('Include/TradeOpsTelemetryFileStore.mqh')) return;
    const store = source('Include/TradeOpsTelemetryFileStore.mqh');
    const mql = block(store, /^class CTov2TelemetryMqlFileOps\s*:\s*public ITov2TelemetryFileOps\b[^\n{]*/mu);
    const storage = block(store, /^class CTov2TelemetryFileStore\s*:\s*public ITov2TelemetryStorage\b[^\n{]*/mu);
    const read = block(storage, /^\s*(?:virtual\s+)?int\s+Read\s*\(/mu);
    const create = block(storage, /^\s*(?:virtual\s+)?int\s+CreateExact\s*\(/mu);
    const remove = block(storage, /^\s*(?:virtual\s+)?int\s+DeleteExact\s*\(/mu);
    const readCode = codeMask(read);
    const createCode = codeMask(create);
    const deleteCode = codeMask(remove);
    const exactOperations = [readCode, createCode, deleteCode].join('\n');

    for (const primitive of [
      'FileReadArray', 'FileWriteArray', 'FileFlush', 'FileDelete',
    ]) expect(calls(mql, primitive).length, primitive).toBeGreaterThan(0);
    expect(mql).toContain('FILE_BIN');
    expect(mql).not.toMatch(/\b(?:FileReadString|FileWriteString|FileWriteStruct)\s*\(/u);
    expectOpenFlags(read, ['FILE_BIN', 'FILE_READ']);
    expectOpenFlags(create, ['FILE_BIN', 'FILE_READ', 'FILE_WRITE']);
    expectExactCount(read, 'ReadBytes');
    expectExactCount(create, 'WriteBytes');
    const write = onlyCall(create, 'm_ops.WriteBytes');
    const beforeWrite = codeMask(create.slice(0, write.start));
    expect(beforeWrite).toMatch(
      /\b[A-Za-z_]\w*\s*=\s*m_ops\s*\.\s*HandleInteger\s*\(\s*handle\s*,\s*FILE_SIZE\s*,/u,
    );
    const preWriteSize = calls(beforeWrite, 'm_ops.HandleInteger').at(-1);
    expect(preWriteSize, 'pre-write FILE_SIZE observation').toBeDefined();
    if (preWriteSize === undefined) throw new Error('missing pre-write FILE_SIZE observation');
    const preWriteGuard = beforeWrite.slice(preWriteSize.start);
    expect(preWriteGuard).toMatch(/\b[A-Za-z_]\w*\s*!=\s*0/u);
    expect(preWriteGuard).toContain('TOV2_STORE_CONFLICT');
    expect(preWriteGuard).toContain('CloseHandle(handle)');
    expect(exactOperations).toContain('TOV2_RECORD_FRAME_MAX');
    expect(exactOperations).toContain('m_ops.HashBytes(');
    expect(exactOperations).not.toContain('Tov2LocalHash(');
    expect(deleteCode).toContain('expected_sha');
    expect(createCode).toContain('TOV2_STORE_EXISTS_SAME');
    expect(exactOperations).toContain('TOV2_STORE_CONFLICT');
    expect(exactOperations).toContain('TOV2_STORE_LIMIT');
    expect(deleteCode).toMatch(/locator\.kind\s*==\s*TOV2_LOC_OWNER/u);
    expect(deleteCode).toMatch(/locator\.kind\s*==\s*TOV2_LOC_REGISTRATION/u);
    expect(store).not.toMatch(/DeleteAll|ResetJournal|RepairJournal/iu);
  });

  it('builds a bounded canonical inventory and distinguishes exhaustion from errors', () => {
    if (!available('Include/TradeOpsTelemetryFileStore.mqh')) return;
    const store = source('Include/TradeOpsTelemetryFileStore.mqh');
    const mql = block(store, /^class CTov2TelemetryMqlFileOps\s*:\s*public ITov2TelemetryFileOps\b[^\n{]*/mu);
    const storage = block(store, /^class CTov2TelemetryFileStore\s*:\s*public ITov2TelemetryStorage\b[^\n{]*/mu);
    const inventory = block(storage, /^\s*(?:virtual\s+)?int\s+Inventory\s*\(/mu);
    const read = block(storage, /^\s*(?:virtual\s+)?int\s+Read\s*\(/mu);
    const create = block(storage, /^\s*(?:virtual\s+)?int\s+CreateExact\s*\(/mu);
    const remove = block(storage, /^\s*(?:virtual\s+)?int\s+DeleteExact\s*\(/mu);
    const expectedParent = block(storage, /^\s*int\s+ExpectedParentStatus\s*\(/mu);
    const pseudoEntry = block(storage, /^\s*bool\s+IsPseudoEntry\s*\(/mu);
    const probeChild = block(storage, /^\s*int\s+ProbeChild\s*\(/mu);
    const enumerateRoot = block(storage, /^\s*int\s+EnumerateRoot\s*\(/mu);
    const enumerateRecords = block(storage, /^\s*int\s+EnumerateRecords\s*\(/mu);
    const inventoryCode = codeMask(inventory);
    const inventoryText = codeMask(inventory, false);

    for (const primitive of ['FileFindFirst', 'FileFindNext', 'FileFindClose'])
      expect(calls(mql, primitive).length, primitive).toBeGreaterThan(0);
    const normalizeFoundName = block(mql, /^\s*void\s+NormalizeFoundName\s*\(/mu);
    expect(normalizeFoundName.replace(/\s+/gu, ''))
      .toContain('if(last==47||last==92)name=StringSubstr(name,0,count-1);');
    expect(block(mql, /^\s*(?:virtual\s+)?long\s+FindFirstCommon\s*\(/mu))
      .toContain('NormalizeFoundName(name);');
    expect(block(mql, /^\s*(?:virtual\s+)?bool\s+FindNext\s*\(/mu))
      .toContain('NormalizeFoundName(name);');
    expect(mql).toContain('TraceEntry("find_first",name,result,native_error);');
    expect(mql).toContain('TraceEntry("find_next",name,(result ? 1 : 0),native_error);');
    expect(inventoryCode).toContain('TOV2_STORAGE_INVENTORY_MAX');
    expect(inventoryCode).toContain('TOV2_RECORD_FRAME_MAX');
    expect(inventoryCode).toContain('Tov2CounterFromText(');
    for (const container of ['objects', 'states', 'commits'])
      expect(inventoryText).toContain(container);
    expect(inventoryText).toContain('registration.rec');
    expect(inventoryText).toContain('.rec');
    expect(inventoryCode).toContain('Tov2StorageSameLocator(');
    expect(inventoryCode).toContain('TOV2_STORE_LIMIT');
    expect(inventoryCode).toContain('TOV2_STORE_CONFLICT');
    expect(inventoryCode).toContain('TOV2_STORE_IO_ERROR');
    expect(inventoryCode).not.toMatch(
      /ClearEntries\s*\(\s*staged\s*\)\s*;\s*return\s+staged\s*\[/u,
    );
    expect(calls(expectedParent, 'm_ops.PathIntegerCommon')).toHaveLength(1);
    expect(codeMask(expectedParent)).toContain('FILE_EXISTS');
    expect(codeMask(expectedParent)).toContain('TOV2_STORE_OK');
    expect(codeMask(expectedParent)).toContain('TOV2_STORE_CONFLICT');
    expect(codeMask(expectedParent)).toContain('TOV2_STORE_IO_ERROR');
    const expectedParentCompact = codeMask(expectedParent).replace(/\s+/gu, '');
    expect(expectedParentCompact).toContain('ERR_FILE_NOT_EXIST');
    expect(expectedParentCompact).toContain('ERR_DIRECTORY_NOT_EXIST');
    expect(expectedParentCompact).toMatch(
      /if\(exists>0&&native_error==ERR_FILE_IS_DIRECTORY\)returnTOV2_STORE_OK;/u,
    );
    expect(expectedParentCompact).toMatch(
      /if\(exists<=0&&\(native_error==ERR_FILE_NOT_EXIST\|\|native_error==ERR_DIRECTORY_NOT_EXIST\)\)returnTOV2_STORE_CONFLICT;/u,
    );
    expect(expectedParentCompact).toMatch(
      /if\(native_error==0&&\(exists==0\|\|exists==1\)\)returnTOV2_STORE_CONFLICT;/u,
    );
    expect(codeMask(probeChild)).toContain('ExpectedParentStatus(');
    expect(codeMask(enumerateRecords)).toContain('ExpectedParentStatus(');
    expect(pseudoEntry.replace(/\s+/gu, ''))
      .toBe('boolIsPseudoEntry(conststringname){returnname=="."||name=="..";}');
    const enumerationCode = [probeChild, enumerateRoot, enumerateRecords]
      .map((value) => codeMask(value).replace(/\s+/gu, ''))
      .join('\n');
    expect(
      enumerationCode.match(
        /!more&&native_error!=0&&native_error!=ERR_FILE_NOT_EXIST/gu,
      ),
      'native ERR_FILE_NOT_EXIST means normal FileFindNext exhaustion, including pseudo-entry skips',
    ).toHaveLength(6);
    expect(enumerationCode.match(/if\(IsPseudoEntry\(name\)\)\{/gu),
      'every enumeration must skip only native dot pseudo-entries').toHaveLength(3);
    const rootCode = codeMask(enumerateRoot);
    expect(rootCode).toContain('m_ops.HandleInteger(m_owner_handle,FILE_SIZE,native_error)');
    expect(rootCode.indexOf('name==TOV2_FILE_STORE_OWNER_NAME'))
      .toBeLessThan(rootCode.indexOf('InspectChild('));
    for (const operation of [inventory, read, create, remove])
      expect(codeMask(operation)).not.toContain('EnsureDirectory(');
  });

  it('retains the deterministic fake fault, ownership, inventory, and mutation matrix', () => {
    if (!available('Scripts/TradeOpsTelemetryFileStoreSelfTest.mq5')) return;
    const native = source('Scripts/TradeOpsTelemetryFileStoreSelfTest.mq5');
    const fake = block(native, /^class CTov2DeterministicFileOps\s*:\s*public ITov2TelemetryFileOps\b[^\n{]*/mu);
    const fakePath = block(fake, /^\s*(?:virtual\s+)?long\s+PathIntegerCommon\s*\(/mu);
    const fakeFindFirst = block(fake, /^\s*(?:virtual\s+)?long\s+FindFirstCommon\s*\(/mu);
    const fakeFindNext = block(fake, /^\s*(?:virtual\s+)?bool\s+FindNext\s*\(/mu);
    expect(native.split('\n').filter((line) => line.startsWith('#include')))
      .toEqual(['#include "../Include/TradeOpsTelemetryFileStore.mqh"']);
    expect(native).toMatch(/class\s+\w+\s*:\s*public\s+ITov2TelemetryFileOps/u);
    expect(codeMask(fakeFindNext).replace(/\s+/gu, ''))
      .toContain('if(!found&&m_native_exhaustion_error)native_error=ERR_FILE_NOT_EXIST;');
    expect(native).toContain('fake_ops.UseNativeExhaustionError();');
    for (const label of [
      'error.stale_isolated', 'allocation.read', 'allocation.inventory',
      'copy.read', 'copy.inventory', 'hash.read', 'hash.inventory',
      'read.short', 'read.zero_length_conflict', 'read.oversized_limit',
      'write.short', 'flush.error',
      'close.error', 'open.error', 'reopen.error', 'enumeration.exhaustion',
      'enumeration.next_error', 'handles.short_lived_closed',
      'handles.enumeration_closed', 'owner.nonzero', 'owner.unreadable',
      'owner.busy', 'session.empty', 'session.stale', 'session.mismatched',
      'session.dead_handle', 'session.nonzero_lock',
      'containers.missing_after_acquire_conflict',
      'read.missing_container_conflict', 'create.missing_container_conflict',
      'delete.missing_container_conflict',
      'inventory.unexpected_directory', 'inventory.directory_at_record',
      'inventory.absence_proven', 'inventory.unknown_name',
      'inventory.malformed_name', 'inventory.duplicate',
      'inventory.case_collision', 'inventory.zero_length', 'inventory.oversized',
      'inventory.4225', 'inventory.4226_refused', 'create.existing_same',
      'create.differing', 'create.partial', 'create.directory_conflict',
      'create.zero_length_conflict', 'create.oversized_conflict',
      'delete.absent', 'delete.zero_length_conflict', 'delete.oversized_limit',
      'delete.digest_conflict', 'delete.owner_refused',
      'delete.registration_refused',
    ]) checkForLabel(native, label, ['RunDeterministicFakeSuite']);
    for (const [label, outcome] of [
      ['containers.missing_after_acquire_conflict', 'TOV2_STORE_CONFLICT'],
      ['read.missing_container_conflict', 'TOV2_STORE_CONFLICT'],
      ['create.missing_container_conflict', 'TOV2_STORE_CONFLICT'],
      ['delete.missing_container_conflict', 'TOV2_STORE_CONFLICT'],
      ['read.zero_length_conflict', 'TOV2_STORE_CONFLICT'],
      ['read.oversized_limit', 'TOV2_STORE_LIMIT'],
      ['inventory.zero_length', 'TOV2_STORE_CONFLICT'],
      ['inventory.oversized', 'TOV2_STORE_LIMIT'],
      ['inventory.4225', 'TOV2_STORE_OK'],
      ['inventory.4226_refused', 'TOV2_STORE_LIMIT'],
      ['owner.busy', 'TOV2_STORE_BUSY'],
      ['session.empty', 'TOV2_STORE_OWNERSHIP_LOST'],
      ['session.stale', 'TOV2_STORE_OWNERSHIP_LOST'],
      ['session.mismatched', 'TOV2_STORE_OWNERSHIP_LOST'],
      ['session.dead_handle', 'TOV2_STORE_OWNERSHIP_LOST'],
      ['session.nonzero_lock', 'TOV2_STORE_OWNERSHIP_LOST'],
      ['create.existing_same', 'TOV2_STORE_EXISTS_SAME'],
      ['create.differing', 'TOV2_STORE_CONFLICT'],
      ['create.partial', 'TOV2_STORE_CONFLICT'],
      ['create.directory_conflict', 'TOV2_STORE_CONFLICT'],
      ['create.zero_length_conflict', 'TOV2_STORE_CONFLICT'],
      ['create.oversized_conflict', 'TOV2_STORE_CONFLICT'],
      ['delete.absent', 'TOV2_STORE_ABSENT'],
      ['delete.zero_length_conflict', 'TOV2_STORE_CONFLICT'],
      ['delete.oversized_limit', 'TOV2_STORE_LIMIT'],
      ['delete.digest_conflict', 'TOV2_STORE_CONFLICT'],
      ['delete.owner_refused', 'TOV2_STORE_INVALID'],
      ['delete.registration_refused', 'TOV2_STORE_INVALID'],
    ] as const) expectOutcome(native, label, outcome, ['RunDeterministicFakeSuite']);
    const fakePathCompact = codeMask(fakePath).replace(/\s+/gu, '');
    expect(fakePathCompact).toContain(
      'if(node<0){native_error=ERR_FILE_NOT_EXIST;return-1;}',
    );
    const fakeFindCompact = codeMask(fakeFindFirst).replace(/\s+/gu, '');
    expect(fakeFindCompact).toContain('intparent_node=Node(parent);');
    expect(fakeFindCompact).toContain(
      'native_error=ERR_DIRECTORY_NOT_EXIST;returnINVALID_HANDLE;',
    );
    expect(fakeFindCompact).toContain(
      'if(!NextChild(parent,cursor,name))returnINVALID_HANDLE;',
    );
  });

  it('pins all six native FILE_COMMON modes, their labels, and durable markers', () => {
    if (!available('Scripts/TradeOpsTelemetryFileStoreSelfTest.mq5')) return;
    const native = source('Scripts/TradeOpsTelemetryFileStoreSelfTest.mq5');
    const storeSource = source('Include/TradeOpsTelemetryFileStore.mqh');
    const mql = block(storeSource, /^class CTov2TelemetryMqlFileOps\s*:\s*public ITov2TelemetryFileOps\b[^\n{]*/mu);

    expect(native).toContain('native.storage.20260904.01');
    expect(native).toContain('0a0c1e55bac97da98734ad83c7310d90f1cea4c526c366fe882daf3347873668');
    for (const mode of [
      'LOCAL', 'HOLD_LOCK', 'PROBE_LOCK', 'PROBE_AFTER_RELEASE',
      'WRITE_FIXTURE', 'READ_FIXTURE',
    ]) expect(native, mode).toContain('"' + mode + '"');
    expect(codeMask(native, false)).toMatch(/^input\s+string\s+TestMode\s*=\s*"LOCAL"\s*;/mu);
    const dispatch = block(native, /^\s*void\s+OnStart\s*\(/mu);
    const modeRunners = [
      ['LOCAL', 'RunLocal'],
      ['HOLD_LOCK', 'RunHoldLock'],
      ['PROBE_LOCK', 'RunProbeLock'],
      ['PROBE_AFTER_RELEASE', 'RunProbeAfterRelease'],
      ['WRITE_FIXTURE', 'RunWriteFixture'],
      ['READ_FIXTURE', 'RunReadFixture'],
    ] as const;
    const runnerBodies = new Map(modeRunners.map(([, runner]) => [
      runner,
      block(native, new RegExp(`^\\s*(?:bool|int|void)\\s+${runner}\\s*\\(`, 'mu')),
    ]));
    const runLocal = runnerBodies.get('RunLocal') ?? '';
    expect(mql).toContain('TOV2_ACQUIRE_TRACE');
    expect(mql).toContain('void EnableTrace()');
    expect(mql).toContain('void DisableTrace()');
    expect(runLocal).toContain('native_ops.EnableTrace();');
    expect(runLocal).toContain('native_ops.DisableTrace();');
    expect(runLocal).toContain('TOV2_ACQUIRE_RESULT');
    for (const [mode, runner] of modeRunners) {
      expect(calls(ifBranch(dispatch, mode), runner), mode).toHaveLength(1);
    }
    for (const label of [
      'start.local_exact', 'start.lock_exact', 'start.fixture_exact',
      'start.unrelated_refused', 'local.binary_nul_non_utf8',
      'local.existing_same', 'local.conflict_preserved', 'local.delete_exact',
      'local.release_reacquire', 'local.owner_lock_retained',
      'probe.no_method_succeeded', 'fixture.repeat_exists_same',
      'fixture.reader_no_rewrite',
    ]) checkForLabel(native, label, realModeRoots);
    for (const marker of [
      'TOV2_FILE_STORE_COMMON_PATH', 'TOV2_FILE_STORE_HOLD_READY',
      'TOV2_FILE_STORE_LOCAL_PASS', 'TOV2_FILE_STORE_HOLD_LOCK_PASS',
      'TOV2_FILE_STORE_PROBE_LOCK_PASS',
      'TOV2_FILE_STORE_PROBE_AFTER_RELEASE_PASS',
      'TOV2_FILE_STORE_WRITE_FIXTURE_PASS',
      'TOV2_FILE_STORE_READ_FIXTURE_PASS', 'TOV2_FILE_STORE_FAIL',
      'TOV2_FILE_STORE_FAILURE',
    ]) expect(native, marker).toContain(marker);
    expect(native).toContain('FILE_COMMON');
    const readFixture = runnerBodies.get('RunReadFixture') ?? '';
    const holdLock = runnerBodies.get('RunHoldLock') ?? '';
    expect(readFixture.length).toBeGreaterThan(0);
    expect(holdLock.length).toBeGreaterThan(0);
    expect(readFixture).not.toMatch(/\.(?:CreateExact|DeleteExact)\s*\(/u);
    expect(holdLock).not.toMatch(/\.(?:Read|CreateExact|DeleteExact)\s*\(/u);
  });

  it('forbids unrelated capabilities and leaves the active EA isolated', () => {
    const active = readFileSync(join(agent, 'TradeOpsAgent.mq5'), 'utf8');
    const forbidden = /\b(?:WebRequest|Socket\w*|OrderSend\w*|CTrade|AccountInfo\w*|History\w*|PositionGet\w*|OrderGet\w*|OnTimer|OnTradeTransaction|TimeCurrent|TimeLocal|GetTickCount\w*|FolderClean|FolderDelete|FileMove|FileCopy)\b|#import/u;

    if (available('Include/TradeOpsTelemetryFileStore.mqh')) {
      const store = source('Include/TradeOpsTelemetryFileStore.mqh');
      expect(store).not.toMatch(forbidden);
      expect(store).not.toMatch(/\b(?:FILE_SHARE_READ|FILE_SHARE_WRITE|FILE_REWRITE|FILE_TXT|FILE_CSV)\b/u);
    }
    if (available('Scripts/TradeOpsTelemetryFileStoreSelfTest.mq5'))
    {
      const native = source('Scripts/TradeOpsTelemetryFileStoreSelfTest.mq5');
      expect(native).not.toMatch(forbidden);
      expect(native).not.toMatch(/\b(?:FILE_SHARE_READ|FILE_SHARE_WRITE|FILE_REWRITE|FILE_TXT|FILE_CSV)\b/u);
    }
    expect(active).not.toContain('TradeOpsTelemetryFileStore');
    expect(active).not.toContain('ITov2TelemetryFileOps');
    expect(active).not.toContain('CTov2TelemetryMqlFileOps');
    expect(active).not.toContain('CTov2TelemetryFileStore');
    expect(active).not.toContain('TradeOpsTelemetryFileStoreSelfTest');
  });

  it('preserves all fifteen reviewed predecessors byte-for-byte', () => {
    expect(predecessors).toHaveLength(15);
    for (const [path, expected] of predecessors) {
      const full = join(root, path);
      expect(existsSync(full), path).toBe(true);
      expect(sha256(readFileSync(full)), path).toBe(expected);
    }

    if (targets.every(available)) {
      for (const path of targets) {
        const text = source(path);
        const opens = [...text].filter((character) => character === '{').length;
        const closes = [...text].filter((character) => character === '}').length;
        expect(opens, path).toBe(closes);
      }
      expect(source('Include/TradeOpsTelemetryFileStore.mqh')).toContain('#endif');
    }
  });
});
