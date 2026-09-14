import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = '2.0.0';
const ISOLATED_DIRECTORY = `TradeOpsTelemetryWireSelfTest-v${VERSION}`;
const root = fileURLToPath(new URL('..', import.meta.url));
const sourceRoot = join(root, 'mt5', 'TradeOpsAgent');
const entry = join(sourceRoot, 'Scripts', 'TradeOpsTelemetryWireSelfTest.mq5');

function fail(message) {
  throw new Error(`MT5_WIRE_PACKAGE_INVALID: ${message}`);
}
function parseOutputDir(argv) {
  if (argv.length !== 2 || argv[0] !== '--output-dir' || argv[1] === '' || argv[1] === undefined) {
    fail('usage: node scripts/package-mt5-wire-selftest.mjs --output-dir <directory>');
  }
  return resolve(argv[1]);
}
function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}
function archivePath(path) {
  const local = relative(sourceRoot, path).split(sep).join('/');
  if (local.startsWith('../') || local === '..' || isAbsolute(local)) fail(`source escaped root: ${path}`);
  return `MQL5/Scripts/${ISOLATED_DIRECTORY}/${local}`;
}
function sourceClosure() {
  const trustedRoot = `${realpathSync(sourceRoot)}${sep}`;
  const found = new Map();
  const pending = [entry];
  while (pending.length > 0) {
    const path = normalize(pending.pop());
    const trustedPath = realpathSync(path);
    if (!trustedPath.startsWith(trustedRoot)) fail(`include escaped source root: ${path}`);
    if (found.has(trustedPath)) continue;
    if (!/\.(?:mq5|mqh)$/u.test(trustedPath)) fail(`non-source include: ${path}`);
    const bytes = readFileSync(trustedPath);
    found.set(trustedPath, bytes);
    const text = bytes.toString('utf8');
    const include = /^\s*#include\s+"([^"]+)"\s*$/gmu;
    for (const match of text.matchAll(include)) pending.push(resolve(dirname(trustedPath), match[1]));
    const unresolved = [...text.matchAll(/^\s*#include\s+(.+)$/gmu)].filter((match) => !/^"[^"]+"\s*$/u.test(match[1]));
    if (unresolved.length > 0) fail(`unsupported include form in ${trustedPath}`);
  }
  return [...found.entries()].map(([path, bytes]) => ({ name: archivePath(path), bytes })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
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
function verifyZip(zip, expected) {
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

const sources = sourceClosure();
const readme = Buffer.from([
  'TradeOps Telemetry Wire V2 offline self-test (source only)',
  '',
  'This archive contains no EX5 binary, credentials, telemetry, HTTP transport, broker reads, order APIs, or active EA.',
  '',
  'Windows / MetaTrader 5 verification:',
  '1. In MetaTrader 5 choose File > Open Data Folder.',
  `2. If MQL5\\Scripts\\${ISOLATED_DIRECTORY} already exists, stop and compare package hashes; do not overwrite it.`,
  `3. Copy only this archive\'s MQL5\\Scripts\\${ISOLATED_DIRECTORY} directory into the Data Folder\'s MQL5\\Scripts directory.`,
  '4. Do not copy the archive\'s whole MQL5 tree over an existing terminal tree.',
  `5. Open MetaEditor and compile MQL5\\Scripts\\${ISOLATED_DIRECTORY}\\Scripts\\TradeOpsTelemetryWireSelfTest.mq5.`,
  '6. Record the compiler build, zero-error result, and source ZIP SHA-256 separately.',
  '7. Run only the offline script in a disposable non-live terminal and capture TOV2_WIRE_START plus the final TOV2_WIRE_PASS line.',
  '8. Do not attach or activate any Expert Advisor. Do not treat host tests as MQL5 compile/run evidence.',
  '',
].join('\r\n'), 'utf8');
const described = [...sources, { name: 'README.txt', bytes: readme }];
const manifest = Buffer.from(`${JSON.stringify({
  package: 'tradeops-telemetry-wire-selftest',
  version: VERSION,
  source_only: true,
  entrypoint: `MQL5/Scripts/${ISOLATED_DIRECTORY}/Scripts/TradeOpsTelemetryWireSelfTest.mq5`,
  files: described.map(({ name, bytes }) => ({ path: name, bytes: bytes.length, sha256: sha256(bytes) })),
}, null, 2)}\n`, 'utf8');
const hashed = [{ name: 'MANIFEST.json', bytes: manifest }, ...described].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
const sums = Buffer.from(`${hashed.map(({ name, bytes }) => `${sha256(bytes)}  ${name}`).join('\n')}\n`, 'utf8');
const entries = [...hashed, { name: 'SHA256SUMS.txt', bytes: sums }].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
const zip = makeZip(entries);
const outputDir = parseOutputDir(process.argv.slice(2));
mkdirSync(outputDir, { recursive: true });
const output = join(outputDir, `tradeops-telemetry-wire-selftest-v${VERSION}-source.zip`);
writeFileSync(output, zip, { flag: 'wx' });
const written = readFileSync(output);
const extractedBytes = verifyZip(written, entries);
process.stdout.write(`MT5_WIRE_PACKAGE_PASS path=${output} files=${entries.length} crc_checks=${entries.length} extracted_bytes=${extractedBytes} sha256=${sha256(written)}\n`);
