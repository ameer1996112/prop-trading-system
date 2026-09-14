import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, posix } from 'node:path';
import { expect, it } from 'vitest';
import { canonicalStringify } from '../src/canonical';
import { parseTelemetryV2, responseBytesV2, validateResponseV2 } from '../src/telemetry-wire-v2';
const base = new URL('../../../mt5/TradeOpsAgent/', import.meta.url);
const fixture = new URL('fixtures/telemetry-outbox-v2.json', base);
const vectors: Array<{name:string;request:string;response:string;acceptedAt:number;finalEvent:number;input: {
  identity:string;registration:string;account:string;attempt:string;
  collection:unknown;events:Array<{sequence:number;eventId:string;recordSha:string;observedUtc:number;record:string}>
}}> = JSON.parse(readFileSync(fixture, 'utf8'));
it('provides six production adapter fixture cases and native entry', () => {
  expect(vectors.map(v => v.name)).toEqual(['empty', 'one-deal', 'protection', 'partial-exposure', 'failed-exposure', '32-events']);
  for (const path of ['Include/TradeOpsTelemetryOutboxV2.mqh', 'Include/TradeOpsTelemetryWireStateV2.mqh', 'Scripts/TradeOpsTelemetryOutboxV2SelfTest.mq5'])
    expect(existsSync(new URL(path, base)), path).toBe(true);
});
it.each(vectors)('receiver agrees with $name', async v => {
  const request = await parseTelemetryV2(new TextEncoder().encode(v.request));
  expect(request.events.map((event, index) => event.sequence === request.last_acknowledged_event_sequence + 1 + index).every(Boolean)).toBe(true);
  expect(await responseBytesV2(request, v.finalEvent, v.acceptedAt)).toBe(v.response);
});

const responseMutations: Array<[string, (response: any) => void]> = [
  ['account id', value => { value.identity.account_id = 'other-account'; }],
  ['installation id', value => { value.identity.installation_id = 'other-install'; }],
  ['tracking id', value => { value.identity.tracking_id = 'other-tracking'; }],
  ['safety epoch', value => { value.identity.safety_epoch = 1; }],
  ['account profile digest', value => { value.identity.account_profile_sha256 = 'e'.repeat(64); }],
  ['account fingerprint digest', value => { value.identity.account_fingerprint_sha256 = 'e'.repeat(64); }],
  ['tracking boundary digest', value => { value.identity.tracking_boundary_sha256 = 'e'.repeat(64); }],
  ['request digest', value => { value.request_body_sha256 = 'e'.repeat(64); }],
  ['request sequence', value => { value.request_sequence += 1; }],
  ['final event', value => { value.acknowledged_event_sequence -= 1; }],
  ['coverage observation gap', value => { value.coverage.observation_gap = true; }],
  ['coverage pending events', value => { value.coverage.pending_events = 1; }],
  ['coverage reason', value => { value.coverage.reason = 'HISTORY_UNAVAILABLE'; }],
  ['coverage state', value => { value.coverage.state = 'CATCHING_UP'; }],
  ['coverage watermark', value => { value.coverage.through_broker_msc = null; }],
];
it.each(responseMutations)('receiver rejects an independently rehashed wrong %s', async (_name, mutate) => {
  const vector = vectors[1]!;
  const request = await parseTelemetryV2(new TextEncoder().encode(vector.request));
  const response = JSON.parse(vector.response);
  mutate(response);
  delete response.response_body_sha256;
  response.response_body_sha256 = createHash('sha256').update(canonicalStringify(response)).digest('hex');
  const bytes = new TextEncoder().encode(canonicalStringify(response));
  await expect(validateResponseV2(bytes, request)).rejects.toThrow();
});
it.each(vectors)('literal inputs and embedded native bytes agree for $name', v => {
  const request = JSON.parse(v.request);
  expect(v.input.registration).toBe(canonicalStringify(request.registration));
  expect(v.input.account).toBe(canonicalStringify(request.account));
  expect(v.input.attempt).toBe(canonicalStringify(request.exposure));
  expect(v.input.collection).toEqual(request.collection);
  expect(v.input.events).toEqual(request.events.map((e: any) => ({sequence:e.sequence,eventId:e.event_id,
    recordSha:e.record_sha256,observedUtc:e.observed_at_utc_seconds,record:canonicalStringify(e.record)})));
  for (const event of v.input.events) {
    expect(createHash('sha256').update(event.record).digest('hex')).toBe(event.recordSha);
    const identity = createHash('sha256').update(v.input.identity).digest('hex').slice(0,32);
    expect(event.eventId).toBe(`cap.${identity}.${event.sequence}.${event.recordSha}`);
  }
  const embedded = readFileSync(new URL('Scripts/Support/TradeOpsTelemetryOutboxV2Fixtures.mqh', base), 'utf8');
  for (const field of ['Request', 'Response'] as const) {
    const body = embedded.split(`string Tov2OutboxV2Fixture${field}`)[1];
    expect(body).toBeDefined();
    const expression = body!.match(new RegExp(`if\\(index==${vectors.indexOf(v)}\\) return ([\\s\\S]*?);`))?.[1];
    expect(expression).toBeDefined();
    const literal = [...expression!.matchAll(/"(?:\\.|[^"\\])*"/gu)].map(m => JSON.parse(m[0])).join('');
    expect(literal).toBe(field === 'Request' ? v.request : v.response);
  }
});
it('keeps the complete native include closure offline (source check, not MQL execution)', () => {
  const visited = new Set<string>();
  function visit(url: URL) {
    if (visited.has(url.href)) return;
    visited.add(url.href);
    const source = readFileSync(url, 'utf8');
    expect(source, url.pathname).not.toMatch(/\b(?:WebRequest|Socket\w*|OrderSend\w*|CTrade|FileOpen|FileDelete|FolderClean|TimeCurrent|TimeLocal|OnTimer|OnTradeTransaction)\b|#import/u);
    for (const match of source.matchAll(/#include "([^"]+)"/gu)) visit(new URL(match[1]!, url));
  }
  visit(new URL('Scripts/TradeOpsTelemetryOutboxV2SelfTest.mq5', base));
  expect(visited.size).toBeGreaterThan(10);
  const pure = readFileSync(new URL('Include/TradeOpsTelemetryWireStateV2.mqh', base), 'utf8');
  expect(pure).not.toMatch(/CTov2TelemetryState\s*\*|\.Read(?:Pending|CaptureContext|OutboxContext)|\.Snapshot\(/u);
});

const outboxPackageScript = new URL('../../../scripts/package-mt5-outbox-v2-selftest.mjs', import.meta.url);
const outboxPackageName = 'tradeops-telemetry-outbox-v2-selftest-v2.0.0-source.zip';
const outboxPackageRoot = 'MQL5/Scripts/TradeOpsTelemetryOutboxV2SelfTest-v2.0.0';
const expectedOutboxSources = [
  'Include/TradeOpsAccountSnapshot.mqh',
  'Include/TradeOpsCaptureCodec.mqh',
  'Include/TradeOpsCaptureStateCodec.mqh',
  'Include/TradeOpsCaptureTypes.mqh',
  'Include/TradeOpsJournalCollector.mqh',
  'Include/TradeOpsTelemetryOutbox.mqh',
  'Include/TradeOpsTelemetryOutboxContract.mqh',
  'Include/TradeOpsTelemetryOutboxV2.mqh',
  'Include/TradeOpsTelemetryRecord.mqh',
  'Include/TradeOpsTelemetryResponseV2.mqh',
  'Include/TradeOpsTelemetryState.mqh',
  'Include/TradeOpsTelemetryStorage.mqh',
  'Include/TradeOpsTelemetryStorageCodec.mqh',
  'Include/TradeOpsTelemetryValues.mqh',
  'Include/TradeOpsTelemetryWireStateV2.mqh',
  'Include/TradeOpsTelemetryWireTypes.mqh',
  'Include/TradeOpsTelemetryWireV2.mqh',
  'Scripts/Support/TradeOpsTelemetryCaptureBroker.mqh',
  'Scripts/Support/TradeOpsTelemetryMemoryStore.mqh',
  'Scripts/Support/TradeOpsTelemetryOutboxV2Fixtures.mqh',
  'Scripts/Support/TradeOpsTelemetryOutboxV2Rig.mqh',
  'Scripts/TradeOpsTelemetryOutboxV2SelfTest.mq5',
] as const;
const forbiddenPackagedCapability = /\b(?:WebRequest|Socket\w*|CTrade|MqlTradeRequest|MqlTradeResult|Order(?:Send\w*|Check|Select|Get\w*)|OrdersTotal|History(?:Select\w*|Deal\w*|Order\w*)|AccountInfo\w*|TerminalInfo\w*|SymbolInfo\w*|MarketBook\w*|Position(?:Select\w*|Get\w*)|PositionsTotal|CopyRates|CopyTicks\w*|File\w*|Folder\w*|GlobalVariable\w*|TimeCurrent|TimeLocal|EventSetTimer|EventKillTimer|EventSetMillisecondTimer|EventKillMillisecondTimer|OnTimer|OnTradeTransaction)\b|#import/u;
const packagedCredential = /-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:api[_-]?key|password|access[_-]?token|client[_-]?secret|broker[_-]?password|account[_-]?password|bearer[_-]?token)\s*[:=]\s*["'][^"']+["']/iu;

function zipLocalFiles(bytes: Buffer): ReadonlyMap<string, Buffer> {
  const files = new Map<string, Buffer>();
  for (let offset = 0; offset + 30 <= bytes.length && bytes.readUInt32LE(offset) === 0x04034b50;) {
    const method = bytes.readUInt16LE(offset + 8);
    const size = bytes.readUInt32LE(offset + 22);
    const nameLength = bytes.readUInt16LE(offset + 26);
    const extraLength = bytes.readUInt16LE(offset + 28);
    expect(method).toBe(0);
    const nameAt = offset + 30;
    const dataAt = nameAt + nameLength + extraLength;
    const name = bytes.subarray(nameAt, nameAt + nameLength).toString('utf8');
    expect(files.has(name), `duplicate ZIP entry ${name}`).toBe(false);
    files.set(name, Buffer.from(bytes.subarray(dataAt, dataAt + size)));
    offset = dataAt + size;
  }
  return files;
}

it('packages the exact isolated outbox-v2 source closure reproducibly without active or unsafe code', () => {
  const first = mkdtempSync(join(tmpdir(), 'tov2-outbox-package-a-'));
  const second = mkdtempSync(join(tmpdir(), 'tov2-outbox-package-b-'));
  const extracted = mkdtempSync(join(tmpdir(), 'tov2-outbox-package-extracted-'));
  try {
    const firstOutput = execFileSync(process.execPath, [outboxPackageScript.pathname, '--output-dir', first], { encoding: 'utf8' });
    const secondOutput = execFileSync(process.execPath, [outboxPackageScript.pathname, '--output-dir', second], { encoding: 'utf8' });
    expect(firstOutput).toContain('MT5_OUTBOX_V2_PACKAGE_PASS');
    expect(secondOutput).toContain('MT5_OUTBOX_V2_PACKAGE_PASS');
    expect(readdirSync(first)).toEqual([outboxPackageName]);
    expect(readdirSync(second)).toEqual([outboxPackageName]);
    const firstBytes = readFileSync(join(first, outboxPackageName));
    expect(firstBytes).toEqual(readFileSync(join(second, outboxPackageName)));
    expect(execFileSync('unzip', ['-t', join(first, outboxPackageName)], { encoding: 'utf8' })).toContain('No errors detected');
    execFileSync('unzip', ['-q', join(first, outboxPackageName), '-d', extracted]);
    const hashOutput = execFileSync('shasum', ['-a', '256', '-c', 'SHA256SUMS.txt'], { cwd: extracted, encoding: 'utf8' });
    expect(hashOutput.trim().split('\n')).toHaveLength(expectedOutboxSources.length + 2);
    expect(hashOutput).not.toContain('FAILED');
    const files = zipLocalFiles(firstBytes);
    expect([...files.keys()].sort()).toEqual([
      'MANIFEST.json',
      ...expectedOutboxSources.map(path => `${outboxPackageRoot}/${path}`),
      'README.txt',
      'SHA256SUMS.txt',
    ].sort());
    expect([...files.keys()].some(path => path.startsWith('MQL5/Include/') || path.includes('/Experts/'))).toBe(false);
    expect([...files.keys()].some(path => /(?:^|\/)\.\.(?:\/|$)|\.(?:ex[45]|dll|so|dylib|pem|key|env)$/iu.test(path))).toBe(false);
    expect(files.has(`${outboxPackageRoot}/TradeOpsAgent.mq5`)).toBe(false);
    expect(createHash('sha256').update(readFileSync(new URL('TradeOpsAgent.mq5', base))).digest('hex'))
      .toBe('4d3058b7ada9d2a2de5ab7bd864225e9120f645cf084e75e731ba747983b12b9');

    for (const [name, bytes] of files) {
      if (!/\.mq[5h]$/u.test(name)) continue;
      const source = bytes.toString('utf8');
      expect(source, name).not.toMatch(forbiddenPackagedCapability);
      expect(source, name).not.toMatch(packagedCredential);
      const includes = [...source.matchAll(/^\s*#include\s+"([^"]+)"\s*$/gmu)];
      expect([...source.matchAll(/^\s*#include\s+(.+)$/gmu)]).toHaveLength(includes.length);
      for (const include of includes) {
        const target = posix.normalize(posix.join(posix.dirname(name), include[1]!));
        expect(target.startsWith(`${outboxPackageRoot}/`), `${name} include escaped package root`).toBe(true);
        expect(files.has(target), `${name} unresolved include ${include[1]}`).toBe(true);
      }
    }
    const readme = files.get('README.txt')?.toString('utf8') ?? '';
    expect(readme).toContain('offline');
    expect(readme).toContain('must not be merged into a global Include directory');
    expect(readme).toContain('must not be installed over the running EA');
    expect(readme).toContain('If the versioned destination already exists, stop and choose a fresh version.');
    expect(readme).toContain('Scripts\\TradeOpsTelemetryOutboxV2SelfTest.mq5');
    expect(JSON.parse(files.get('MANIFEST.json')?.toString('utf8') ?? '{}')).toMatchObject({
      package: 'tradeops-telemetry-outbox-v2-selftest',
      version: '2.0.0',
      source_only: true,
      entrypoint: `${outboxPackageRoot}/Scripts/TradeOpsTelemetryOutboxV2SelfTest.mq5`,
    });
  } finally {
    rmSync(first, { recursive: true, force: true });
    rmSync(second, { recursive: true, force: true });
    rmSync(extracted, { recursive: true, force: true });
  }
});

it('refuses unresolved includes and include symlink escapes', async () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'tov2-outbox-closure-'));
  try {
    const sourceRoot = join(sandbox, 'source');
    const scripts = join(sourceRoot, 'Scripts');
    mkdirSync(scripts, { recursive: true });
    const entry = join(scripts, 'SelfTest.mq5');
    writeFileSync(entry, '#include "missing.mqh"\n');
    const { collectSourceClosure } = await import(outboxPackageScript.href);
    expect(() => collectSourceClosure(sourceRoot, entry)).toThrow(/unresolved include/u);
    const outside = join(sandbox, 'outside.mqh');
    writeFileSync(outside, '// outside\n');
    symlinkSync(outside, join(scripts, 'escape.mqh'));
    writeFileSync(entry, '#include "escape.mqh"\n');
    expect(() => collectSourceClosure(sourceRoot, entry)).toThrow(/include escaped source root/u);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

it('rejects broker, network, order, persistence, timer, import, and credential source capabilities', async () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'tov2-outbox-policy-'));
  try {
    const sourceRoot = join(sandbox, 'source');
    const scripts = join(sourceRoot, 'Scripts');
    mkdirSync(scripts, { recursive: true });
    const entry = join(scripts, 'SelfTest.mq5');
    const { collectSourceClosure } = await import(outboxPackageScript.href);
    const forbidden = [
      ['native broker account', 'void Test(){ AccountInfoInteger(ACCOUNT_LOGIN); }'],
      ['native broker position', 'void Test(){ PositionSelect("EURUSD"); }'],
      ['network', 'void Test(){ WebRequest("GET","https://invalid",NULL,NULL,0,NULL,0,NULL,NULL); }'],
      ['order submission', 'void Test(){ MqlTradeRequest r; MqlTradeResult o; OrderSend(r,o); }'],
      ['order selection', 'void Test(){ OrderSelect(1); }'],
      ['history order', 'void Test(){ HistoryOrderGetInteger(1,ORDER_TIME_SETUP_MSC); }'],
      ['file storage', 'void Test(){ FileOpen("state",FILE_WRITE); }'],
      ['folder creation', 'void Test(){ FolderCreate("state"); }'],
      ['folder deletion', 'void Test(){ FolderDelete("state"); }'],
      ['terminal-global persistence', 'void Test(){ GlobalVariableSet("state",1); }'],
      ['timer', 'void OnTimer(){ EventSetTimer(1); }'],
      ['import', '#import "unsafe.dll"\n#import'],
      ['API key credential', 'string api_key = "private-value";'],
      ['password credential', 'string broker_password = "private-value";'],
      ['access-token credential', 'string access_token = "private-value";'],
      ['client-secret credential', 'string client_secret = "private-value";'],
      ['private-key credential', 'string key = "-----BEGIN PRIVATE KEY-----";'],
    ] as const;
    for (const [name, source] of forbidden) {
      writeFileSync(entry, `${source}\n`);
      expect(() => collectSourceClosure(sourceRoot, entry), name).toThrow(/forbidden native capability|credential-like source/u);
    }
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

it('never overwrites an existing versioned outbox-v2 archive', () => {
  const output = mkdtempSync(join(tmpdir(), 'tov2-outbox-no-overwrite-'));
  try {
    const archive = join(output, outboxPackageName);
    writeFileSync(archive, 'different artifact');
    expect(() => execFileSync(process.execPath, [outboxPackageScript.pathname, '--output-dir', output], { stdio: 'pipe' }))
      .toThrow();
    expect(readFileSync(archive, 'utf8')).toBe('different artifact');
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
});
