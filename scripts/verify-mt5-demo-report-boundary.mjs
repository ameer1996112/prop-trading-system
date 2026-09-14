import { readFileSync, realpathSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

// Safety policy over the complete local include closure, NOT an MQL runtime test.
const root = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '../mt5/TradeOpsAgent'));
const forbidden = /\b(?:OrderSend\w*|OrderCheck|CTrade|WebRequest|Socket\w*|File\w*|Folder\w*|SymbolSelect|ChartOpen|ChartApplyTemplate|EventChartCustom|SendFTP|SendMail|SendNotification|ResourceCreate|GlobalVariable\w*|OnTimer|OnTradeTransaction)\s*\(/u;
function check(text) {
  // Remove comments, preserving string literals until imports have been checked.
  const plain = text.replace(/"(?:\\.|[^"\\])*"|\/\/[^\n]*|\/\*[\s\S]*?\*\//gu, token => token.startsWith('"') ? token : ' ');
  assert(!/#\s*import\b/u.test(plain), 'DLL/import boundary violation');
  assert(!/#\s*include\s*</u.test(plain), 'nonlocal include boundary violation');
  const code = plain.replace(/"(?:\\.|[^"\\])*"/gu, '""');
  assert(!forbidden.test(code), 'write/trading/network boundary violation');
  return plain;
}
assert.throws(() => check('void f(){ OrderSend(request,result); }'));
assert.throws(() => check('#import "evil.dll"'));
assert.throws(() => check('void f(){ WebRequest(url); }'));
assert.throws(() => check('void f(){ FileOpen(name,0); }'));
check('Print("OrderSend(request,result)"); // WebRequest(url)');
const seen = new Set();
function visit(file) {
  file = realpathSync(file);
  assert(!relative(root, file).startsWith('..'), 'include escaped package root');
  if (seen.has(file)) return;
  seen.add(file);
  const text = check(readFileSync(file, 'utf8'));
  for (const match of text.matchAll(/#\s*include\s*"([^"]+)"/gu)) visit(resolve(dirname(file), match[1]));
}
visit(resolve(root, 'Scripts/TradeOpsDemoReadOnlyReport.mq5'));
console.log(`Demo-report include boundary passed: ${seen.size} files; policy negative controls passed. MQL execution not tested.`);
