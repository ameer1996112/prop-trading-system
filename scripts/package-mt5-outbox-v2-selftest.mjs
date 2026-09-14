import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = '2.0.0';
const PACKAGE_NAME = 'tradeops-telemetry-outbox-v2-selftest';
const ISOLATED_DIRECTORY = `TradeOpsTelemetryOutboxV2SelfTest-v${VERSION}`;
const root = fileURLToPath(new URL('..', import.meta.url));
const defaultSourceRoot = join(root, 'mt5', 'TradeOpsAgent');
const defaultEntry = join(defaultSourceRoot, 'Scripts', 'TradeOpsTelemetryOutboxV2SelfTest.mq5');

function fail(message) {
  throw new Error(`MT5_OUTBOX_V2_PACKAGE_INVALID: ${message}`);
}

function parseOutputDir(argv) {
  if (argv.length !== 2 || argv[0] !== '--output-dir' || argv[1] === '' || argv[1] === undefined) {
    fail('usage: node scripts/package-mt5-outbox-v2-selftest.mjs --output-dir <directory>');
  }
  return resolve(argv[1]);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function archivePath(sourceRoot, path) {
  const local = relative(sourceRoot, path).split(sep).join('/');
  if (local.startsWith('../') || local === '..' || isAbsolute(local)) fail(`source escaped root: ${path}`);
  return `MQL5/Scripts/${ISOLATED_DIRECTORY}/${local}`;
}

function rejectUnsafeSource(path, text) {
  const forbidden = /\b(?:WebRequest|Socket\w*|CTrade|MqlTradeRequest|MqlTradeResult|Order(?:Send\w*|Check|Select|Get\w*)|OrdersTotal|History(?:Select\w*|Deal\w*|Order\w*)|AccountInfo\w*|TerminalInfo\w*|SymbolInfo\w*|MarketBook\w*|Position(?:Select\w*|Get\w*)|PositionsTotal|CopyRates|CopyTicks\w*|File\w*|Folder\w*|GlobalVariable\w*|TimeCurrent|TimeLocal|EventSetTimer|EventKillTimer|EventSetMillisecondTimer|EventKillMillisecondTimer|OnTimer|OnTradeTransaction)\b|#import/u;
  if (forbidden.test(text)) fail(`forbidden native capability in ${path}`);
  const credential = /-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:api[_-]?key|password|access[_-]?token|client[_-]?secret|broker[_-]?password|account[_-]?password|bearer[_-]?token)\s*[:=]\s*["'][^"']+["']/iu;
  if (credential.test(text)) fail(`credential-like source in ${path}`);
}

export function collectSourceClosure(sourceRootPath, entryPath) {
  const sourceRoot = realpathSync(sourceRootPath);
  const trustedRoot = `${sourceRoot}${sep}`;
  const found = new Map();
  const pending = [resolve(entryPath)];
  while (pending.length > 0) {
    const candidate = normalize(pending.pop());
    if (!existsSync(candidate)) fail(`unresolved include: ${candidate}`);
    const trustedPath = realpathSync(candidate);
    if (!trustedPath.startsWith(trustedRoot)) fail(`include escaped source root: ${candidate}`);
    if (found.has(trustedPath)) continue;
    if (!/\.(?:mq5|mqh)$/u.test(trustedPath)) fail(`non-source include: ${candidate}`);
    const bytes = readFileSync(trustedPath);
    const text = bytes.toString('utf8');
    rejectUnsafeSource(trustedPath, text);
    found.set(trustedPath, bytes);
    const includes = [...text.matchAll(/^\s*#include\s+"([^"]+)"\s*$/gmu)];
    const allIncludes = [...text.matchAll(/^\s*#include\s+(.+)$/gmu)];
    if (allIncludes.length !== includes.length) fail(`unsupported include form in ${trustedPath}`);
    for (const match of includes) pending.push(resolve(dirname(trustedPath), match[1]));
  }
  return [...found.entries()]
    .map(([path, bytes]) => ({ name: archivePath(sourceRoot, path), bytes }))
    .sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
}

const crcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) !== 0 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(value) { const out = Buffer.alloc(2); out.writeUInt16LE(value); return out; }
function u32(value) { const out = Buffer.alloc(4); out.writeUInt32LE(value >>> 0); return out; }

function makeZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  const dosDate = 33;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const data = Buffer.from(entry.bytes);
    const crc = crc32(data);
    const local = Buffer.concat([
      u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(0), u16(dosDate), u32(crc),
      u32(data.length), u32(data.length), u16(name.length), u16(0), name, data,
    ]);
    locals.push(local);
    centrals.push(Buffer.concat([
      u32(0x02014b50), u16(0x0314), u16(20), u16(0x0800), u16(0), u16(0), u16(dosDate),
      u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0),
      u16(0), u16(0), u32(0o100644 << 16), u32(offset), name,
    ]));
    offset += local.length;
  }
  const central = Buffer.concat(centrals);
  const end = Buffer.concat([
    u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length),
    u32(central.length), u32(offset), u16(0),
  ]);
  return Buffer.concat([...locals, central, end]);
}

function verifyLocalEntries(zip, expected) {
  const extracted = new Map();
  let offset = 0;
  while (offset + 4 <= zip.length && zip.readUInt32LE(offset) === 0x04034b50) {
    const flags = zip.readUInt16LE(offset + 6);
    const method = zip.readUInt16LE(offset + 8);
    const expectedCrc = zip.readUInt32LE(offset + 14);
    const compressed = zip.readUInt32LE(offset + 18);
    const size = zip.readUInt32LE(offset + 22);
    const nameLength = zip.readUInt16LE(offset + 26);
    const extraLength = zip.readUInt16LE(offset + 28);
    if (flags !== 0x0800 || method !== 0 || compressed !== size) fail('unexpected ZIP encoding');
    const nameAt = offset + 30;
    const dataAt = nameAt + nameLength + extraLength;
    const name = zip.subarray(nameAt, nameAt + nameLength).toString('utf8');
    const data = zip.subarray(dataAt, dataAt + size);
    if (data.length !== size || crc32(data) !== expectedCrc) fail(`CRC mismatch: ${name}`);
    if (extracted.has(name)) fail(`duplicate ZIP entry: ${name}`);
    extracted.set(name, Buffer.from(data));
    offset = dataAt + size;
  }
  if (extracted.size !== expected.length) fail('entry count mismatch');
  let extractedBytes = 0;
  for (const entry of expected) {
    const actual = extracted.get(entry.name);
    if (actual === undefined || !actual.equals(entry.bytes)) fail(`extracted bytes mismatch: ${entry.name}`);
    extractedBytes += actual.length;
  }
  return extractedBytes;
}

function buildPackage(outputDir) {
  const sources = collectSourceClosure(defaultSourceRoot, defaultEntry);
  const readme = Buffer.from([
    'TradeOps Telemetry Outbox V2 offline durable-adapter self-test (source only)',
    '',
    'This package is an offline source self-test. It contains no EX5 binary, credentials, HTTP transport, native broker access, real file storage, timers, order APIs, or active EA.',
    'This folder must not be merged into a global Include directory and must not be installed over the running EA.',
    '',
    'Windows / MetaTrader 5 verification:',
    '1. Use a disposable non-live MT5 terminal. In MetaTrader 5 choose File > Open Data Folder.',
    `2. If MQL5\\Scripts\\${ISOLATED_DIRECTORY} already exists, stop. If the versioned destination already exists, stop and choose a fresh version.`,
    `3. Copy only this archive's MQL5\\Scripts\\${ISOLATED_DIRECTORY} folder into the Data Folder's MQL5\\Scripts folder.`,
    '4. Do not copy the archive\'s whole MQL5 tree, replace global Include, install over an active EA, or connect this test to production.',
    `5. Open MetaEditor and compile MQL5\\Scripts\\${ISOLATED_DIRECTORY}\\Scripts\\TradeOpsTelemetryOutboxV2SelfTest.mq5.`,
    '6. Record the compiler build, source ZIP SHA-256, and compiler errors/warnings separately.',
    '7. Run only that offline script and capture its final TOV2_OUTBOX_V2_PASS or TOV2_OUTBOX_V2_FAIL line.',
    '8. Do not attach or activate any Expert Advisor. Host tests are source/package checks, not MQL5 compile or runtime evidence.',
    '',
  ].join('\r\n'), 'utf8');
  const described = [...sources, { name: 'README.txt', bytes: readme }];
  const manifest = Buffer.from(`${JSON.stringify({
    package: PACKAGE_NAME,
    version: VERSION,
    source_only: true,
    offline: true,
    entrypoint: `MQL5/Scripts/${ISOLATED_DIRECTORY}/Scripts/TradeOpsTelemetryOutboxV2SelfTest.mq5`,
    source_include_count: sources.length,
    files: described.map(({ name, bytes }) => ({ path: name, bytes: bytes.length, sha256: sha256(bytes) })),
  }, null, 2)}\n`, 'utf8');
  const hashed = [{ name: 'MANIFEST.json', bytes: manifest }, ...described]
    .sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  const sums = Buffer.from(`${hashed.map(({ name, bytes }) => `${sha256(bytes)}  ${name}`).join('\n')}\n`, 'utf8');
  const entries = [...hashed, { name: 'SHA256SUMS.txt', bytes: sums }]
    .sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  const zip = makeZip(entries);
  mkdirSync(outputDir, { recursive: true });
  const output = join(outputDir, `${PACKAGE_NAME}-v${VERSION}-source.zip`);
  writeFileSync(output, zip, { flag: 'wx' });
  const written = readFileSync(output);
  const extractedBytes = verifyLocalEntries(written, entries);
  return { output, entries, sources, extractedBytes, sha256: sha256(written) };
}

function main() {
  const result = buildPackage(parseOutputDir(process.argv.slice(2)));
  process.stdout.write(`MT5_OUTBOX_V2_PACKAGE_PASS path=${result.output} files=${result.entries.length} source_includes=${result.sources.length} crc_checks=${result.entries.length} extracted_bytes=${result.extractedBytes} sha256=${result.sha256}\n`);
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && existsSync(invokedPath) && realpathSync(invokedPath) === realpathSync(fileURLToPath(import.meta.url))) main();
