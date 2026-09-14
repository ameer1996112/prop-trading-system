# MT5 Telemetry Exact Values Implementation Plan — Stage 3A

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an isolated, offline-tested MQL5 values library matching the receiver's v2 numeric and identifier contracts.

**Architecture:** Preserve exact decimal strings and unsigned broker IDs at the MQL5 boundary. Use native MQL5 test vectors checked independently against the existing TypeScript validators. Do not include this library in the running EA or alter transport until the subsequent checkpoint plans are complete.

**Tech Stack:** MQL5, Vitest, existing TypeScript canonical/values modules, Windows MetaEditor.

---

## Scope and working directories

**Execution update (2026-09-03):** The three-file values checkpoint is implemented locally; independent specification and quality reviews pass. Recorded execution-edge regression: **542 tests / 30 files PASS**, plus typecheck, lint and the unchanged MT5 boundary verifier. Subsequent Windows evidence includes GUI compilation with zero errors/warnings, matching uploaded sources and an EX5 hash, and the user's full raw log reporting **146 checks / zero failures** in each of two native runs. The user confirms the uploaded EX5 was copied unchanged into the test copy; no duplicate upload or rerun is requested. The separate fresh-directory compiler-log/environment evidence limits remain in the [execution audit](../../audits/2026-09-03-mt5-telemetry-ea-values.md). The original checkboxes below are the full acceptance checklist, not a full-EA readiness claim. Keep the active EA unchanged. Next is review of the [3B1 local-record plan](2026-09-03-mt5-telemetry-ea-records.md), not deployment.

Implementation root (all shell test commands below run here):

`/Users/ameeramer/.config/superpowers/worktrees/prop-trading-system/mt5-stale-payload-recovery`

Docs root:

`/Users/ameeramer/.config/superpowers/worktrees/prop-trading-system/tradeops-dashboard-migration`

Read the approved `docs/superpowers/specs/2026-09-03-mt5-account-telemetry-journal-design.md` and companion `docs/superpowers/plans/2026-09-03-mt5-telemetry-ea-delivery.md` in the docs root. Inspected backend HEAD: `8a801423bc19b3bb27c8e24f45d2800a9deb6881`. Stages 1–2 are existing uncommitted work; preserve them. Verify current status before execution, not just HEAD.

**Only create these three source/test files:**

1. `mt5/TradeOpsAgent/Include/TradeOpsTelemetryValues.mqh` — pure value validation and canonical formatting.
2. `mt5/TradeOpsAgent/Scripts/TradeOpsTelemetryValuesSelfTest.mq5` — executable synthetic MQL5 tests.
3. `apps/execution-edge/test/mt5-telemetry-values-v2-source.test.ts` — native-vector contract checks plus source isolation checks.

Do not modify `TradeOpsAgent.mq5`, Config/Sync/CanonicalJson includes, existing self-test, README, configuration, integrity manifests, Worker source/schema or golden fixtures. No new dependency. No commit, push, deployment, migration, installed-EA replacement, broker API operation or credential access. Use local review checkpoints instead of commits. Windows verification copies only the two new MQL5 files to a disposable build directory; running the pure script requires a separately identified isolated terminal, not the active trading terminal.

This is not a complete Stage 3 implementation. There is no collector, persistence, generic JSON parser, network client or financial aggregation here. Later work must use the checkpoint sequence in the delivery plan.

## Value contract and evidence boundary

- Counter: nonnegative safe integer at most `9007199254740991`, with explicit minimum. Text parsing adds strict canonical decimal syntax before signed conversion.
- Ticket: positive canonical unsigned decimal string, at most `18446744073709551615`; use `ulong` formatting, never a floating conversion.
- Fixed decimal: signed canonical string; 1–18 integer digits; scale 0–16; exactly that many fractional digits; no exponent, plus sign, leading zeros or negative zero. Canonical JSON sorts `scale` before `value`.
- Identifiers and digests match the existing `telemetry-values-v2.ts` exactly.
- Reading: either a known fixed decimal with null reason, or null value with one of the four receiver reasons. An invalid value is not converted to a missing reading implicitly.
- Every function with an output reference clears that output before validating.
- `double` conversion is display quantization at an explicit scale, not lossless reconstruction. Validate scale before `DoubleToString` because unsupported digits default to 8; reject nonfinite values and normalize rounded negative zero. [DoubleToString](https://www.mql5.com/en/docs/convert/doubletostring), [MathIsValidNumber](https://www.mql5.com/en/docs/math/mathisvalidnumber).

The TypeScript tests below check the shared vectors and source boundary. They do **not** execute MQL5. Native compile and native self-test are separate completion gates; neither C++ substitution nor a TS reimplementation proves EX5 correctness.

## Task 1: Write the native test vectors first

**Create:** `mt5/TradeOpsAgent/Scripts/TradeOpsTelemetryValuesSelfTest.mq5`.

- [ ] Record the existing worktree status before creating files:

```sh
git status --short
git rev-parse HEAD
```

Expected: the existing Stage 1–2 dirty files remain visible. Stop if any of the three planned new paths already exists; inspect rather than overwrite another worker's implementation.

- [ ] Add this entire native self-test. The included values file does not exist yet.

```cpp
#property strict
#property version "1.000"
#property description "Offline synthetic telemetry value contract tests"
#include "../Include/TradeOpsTelemetryValues.mqh"

int tov2_checks=0;
int tov2_failures=0;

void Check(const bool condition,const string label)
{
   tov2_checks++;
   if(!condition)
   {
      tov2_failures++;
      Print("TOV2_VALUES_FAILURE ",label," #",tov2_checks);
   }
}

void CheckFixed(const string value,const int scale,const bool expected)
{
   Check(Tov2FixedText(value,scale)==expected,"fixed text");
   string actual="sentinel";
   Check(Tov2FixedJson(value,scale,actual)==expected,"fixed result");
   string wanted=expected ? "{\"scale\":"+IntegerToString(scale)+",\"value\":\""+value+"\"}" : "";
   Check(actual==wanted,"fixed canonical or cleared");
   actual="sentinel";
   Check(Tov2KnownReading(value,scale,actual)==expected,"known reading result");
   Check(actual==(expected ? "{\"reason\":null,\"value\":"+wanted+"}" : ""),"known reading bytes");
}

void CheckTicket(const string value,const bool expected)
{
   Check(Tov2Ticket(value)==expected,"ticket");
}

void CheckCounter(const string value,const long minimum,const bool expected)
{
   long actual=123;
   Check(Tov2CounterFromText(value,minimum,actual)==expected,"counter result");
   Check(expected ? IntegerToString(actual)==value : actual==0,"counter value or cleared");
}

void CheckIdentifier(const string value,const bool expected)
{
   Check(Tov2Identifier(value)==expected,"identifier");
}

void CheckDigest(const string value,const bool expected)
{
   Check(Tov2Digest(value)==expected,"digest");
}

void CheckMissing(const string reason,const bool expected)
{
   string actual="sentinel";
   Check(Tov2MissingReading(reason,actual)==expected,"missing result");
   Check(actual==(expected ? "{\"reason\":\""+reason+"\",\"value\":null}" : ""),"missing bytes or cleared");
}

void CheckDouble(const double value,const int scale,const string expected)
{
   string actual="sentinel";
   Check(Tov2FixedFromDouble(value,scale,actual)==(expected!=""),"double result");
   Check(actual==expected,"double bytes or cleared");
}

void OnStart()
{
   CheckFixed("0",0,true);
   CheckFixed("-1",0,true);
   CheckFixed("10.00",2,true);
   CheckFixed("-9.75",2,true);
   CheckFixed("0.0000000000000000",16,true);
   CheckFixed("-0.0000000000000001",16,true);
   CheckFixed("9007199254740993.01",2,true);
   CheckFixed("999999999999999999",0,true);
   CheckFixed("-999999999999999999.1234567890123456",16,true);
   CheckFixed("",0,false);
   CheckFixed("-0",0,false);
   CheckFixed("-0.00",2,false);
   CheckFixed("01.00",2,false);
   CheckFixed("+1.00",2,false);
   CheckFixed("1e3",0,false);
   CheckFixed("1.",0,false);
   CheckFixed(".1",1,false);
   CheckFixed("1.0",0,false);
   CheckFixed("1",2,false);
   CheckFixed("1.000",2,false);
   CheckFixed("1.0.0",3,false);
   CheckFixed(" 1",0,false);
   CheckFixed("1\n",0,false);
   CheckFixed("1000000000000000000",0,false);
   CheckFixed("1",-1,false);
   CheckFixed("1.00000000000000000",17,false);
   CheckTicket("1",true);
   CheckTicket("9007199254740993",true);
   CheckTicket("18446744073709551615",true);
   CheckTicket("18446744073709551616",false);
   CheckTicket("0",false);
   CheckTicket("01",false);
   CheckTicket("-1",false);
   CheckTicket("1.0",false);
   CheckTicket("1e3",false);
   CheckTicket("",false);
   CheckTicket("1\n",false);
   CheckCounter("0",0,true);
   CheckCounter("1",1,true);
   CheckCounter("9007199254740991",0,true);
   CheckCounter("9007199254740992",0,false);
   CheckCounter("0",1,false);
   CheckCounter("00",0,false);
   CheckCounter("+1",0,false);
   CheckCounter("-1",0,false);
   CheckCounter("1.0",0,false);
   CheckCounter("",0,false);
   CheckCounter("1\n",0,false);
   CheckIdentifier("account:demo_1.a-b",true);
   CheckIdentifier("",false);
   CheckIdentifier("a b",false);
   CheckIdentifier("a/b",false);
   CheckIdentifier("a\\b",false);
   CheckIdentifier("a\n",false);
   CheckDigest("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",true);
   CheckDigest("0000000000000000000000000000000000000000000000000000000000000001",true);
   CheckDigest("0000000000000000000000000000000000000000000000000000000000000000",false);
   CheckDigest("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",false);
   CheckDigest("a",false);
   CheckMissing("READ_FAILED",true);
   CheckMissing("NOT_APPLICABLE",true);
   CheckMissing("NOT_SET",true);
   CheckMissing("UNAVAILABLE",true);
   CheckMissing("",false);
   CheckMissing("UNKNOWN",false);
   CheckMissing("READ_FAILED\n",false);
   CheckDouble(1.25,2,"{\"scale\":2,\"value\":\"1.25\"}");
   CheckDouble(-9.75,2,"{\"scale\":2,\"value\":\"-9.75\"}");
   CheckDouble(-0.0001,2,"{\"scale\":2,\"value\":\"0.00\"}");
   CheckDouble(1.0,16,"{\"scale\":16,\"value\":\"1.0000000000000000\"}");
   CheckDouble(1.0,-1,"");
   CheckDouble(1.0,17,"");
   CheckDouble(1.0e20,2,"");
   CheckDouble(MathArcsin(2.0),2,"");
   Check(!Tov2Counter(-1),"negative counter");
   Check(!Tov2Counter(9007199254740992),"unsafe counter");
   Check(!Tov2Counter(1,-1),"invalid minimum");
   string long_id="";
   for(int i=0;i<160;i++) long_id+="a";
   Check(Tov2Identifier(long_id),"160 character identifier");
   Check(!Tov2Identifier(long_id+"a"),"161 character identifier");
   Check(!Tov2Identifier(ShortToString(0x20ac)),"non ASCII identifier");
   string ticket="sentinel";
   ulong largest=~(ulong)0;
   Check(Tov2TicketFromUlong(largest,ticket),"unsigned conversion");
   Check(ticket=="18446744073709551615","unsigned maximum exact");
   Check(Tov2TicketFromUlong((ulong)1,ticket) && ticket=="1","unsigned one");
   Check(!Tov2TicketFromUlong((ulong)0,ticket) && ticket=="","zero unsigned cleared");
   Print(tov2_failures==0 ? "TOV2_VALUES_PASS" : "TOV2_VALUES_FAIL",
         " checks=",tov2_checks," failures=",tov2_failures);
}
```

Expected at this point: native compilation cannot succeed because `TradeOpsTelemetryValues.mqh` has not been added. Do not claim this compiler failure was observed unless MetaEditor is actually available. Task 2 supplies the locally runnable RED check.

## Task 2: Add the cross-language fixture and source checks

**Create:** `apps/execution-edge/test/mt5-telemetry-values-v2-source.test.ts`.

- [ ] Add this complete test file:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { canonicalStringify } from '../src/canonical';
import { reading } from '../src/telemetry-schema-v2';
import {
  parseFixedV2, readCounterV2, readDigestV2, readIdentifierV2, readTicketV2,
} from '../src/telemetry-values-v2';

const root = join(import.meta.dirname, '../../..');
const agent = join(root, 'mt5/TradeOpsAgent');
const read = (path: string): string => readFileSync(join(agent, path), 'utf8');
const native = (): string => read('Scripts/TradeOpsTelemetryValuesSelfTest.mq5');
const values = (): string => read('Include/TradeOpsTelemetryValues.mqh');

function vectors(name: string, minimum: number): unknown[][] {
  const expression = new RegExp(`^   ${name}\\((.*)\\);$`, 'gm');
  const rows = [...native().matchAll(expression)].map((match) =>
    JSON.parse(`[${match[1]}]`) as unknown[]);
  expect(rows.length).toBeGreaterThanOrEqual(minimum);
  return rows;
}

function accepted(action: () => unknown): boolean {
  try { action(); return true; } catch { return false; }
}

describe('MT5 v2 values native fixtures (not native execution)', () => {
  it('has an isolated pure implementation without changing the active EA', () => {
    const source = values();
    const test = native();
    expect(source).toContain('bool Tov2FixedJson(');
    expect(source).toContain('StringFormat("%I64u",value)');
    expect(source).toContain('MathIsValidNumber(value)');
    expect(test).toContain('TOV2_VALUES_PASS');
    expect(test).toContain('ulong largest=~(ulong)0;');
    expect(test).toContain('CheckDouble(MathArcsin(2.0),2,"");');
    const forbidden = /\b(?:WebRequest|FileOpen|OrderSend|OrderSendAsync|CTrade|AccountInfo\w*|History\w*|PositionGet\w*|OrderGet\w*|OnTimer|OnTradeTransaction)\b|#import/u;
    expect(source).not.toMatch(forbidden);
    expect(test).not.toMatch(forbidden);
    expect(source).not.toMatch(/^\s*#include/mu);
    expect(test.match(/^#include .+$/gm)).toEqual([
      '#include "../Include/TradeOpsTelemetryValues.mqh"',
    ]);
    expect(read('TradeOpsAgent.mq5')).not.toContain('TradeOpsTelemetryValues');
  });

  it('agrees with receiver fixed-decimal validation and canonical bytes', () => {
    for (const row of vectors('CheckFixed', 26)) {
      const [value, scale, valid] = row as [string, number, boolean];
      expect(accepted(() => parseFixedV2(value, scale)), JSON.stringify(row)).toBe(valid);
      if (valid) {
        const fixed = parseFixedV2(value, scale);
        expect(canonicalStringify(fixed)).toBe(`{"scale":${scale},"value":"${value}"}`);
        expect(canonicalStringify({ reason: null, value: fixed }))
          .toBe(`{"reason":null,"value":{"scale":${scale},"value":"${value}"}}`);
      }
    }
  });

  it('agrees with unsigned tickets and restricted identity fields', () => {
    const readers = [
      ['CheckTicket', 11, readTicketV2],
      ['CheckIdentifier', 6, readIdentifierV2],
      ['CheckDigest', 5, readDigestV2],
    ] as const;
    for (const [name, minimum, reader] of readers) {
      for (const row of vectors(name, minimum)) {
        const [value, valid] = row as [string, boolean];
        expect(accepted(() => reader(value)), JSON.stringify(row)).toBe(valid);
      }
    }
    expect(readIdentifierV2('a'.repeat(160))).toHaveLength(160);
    expect(() => readIdentifierV2('a'.repeat(161))).toThrow();
    expect(() => readIdentifierV2('\u20ac')).toThrow();
  });

  it('agrees on counter range after strict canonical text parsing', () => {
    for (const row of vectors('CheckCounter', 11)) {
      const [value, minimum, valid] = row as [string, number, boolean];
      const canonical = /^(0|[1-9][0-9]*)$/u.test(value);
      expect(canonical && accepted(() => readCounterV2(Number(value), minimum)), JSON.stringify(row)).toBe(valid);
    }
  });

  it('uses exactly the receiver missing-reading reasons and bytes', () => {
    for (const row of vectors('CheckMissing', 7)) {
      const [reason, valid] = row as [string, boolean];
      expect(accepted(() => reading({ reason, value: null })), JSON.stringify(row)).toBe(valid);
      if (valid) expect(canonicalStringify(reading({ reason, value: null })))
        .toBe(`{"reason":"${reason}","value":null}`);
    }
  });
});
```

- [ ] Run the RED check:

```sh
npm --prefix apps/execution-edge test -- test/mt5-telemetry-values-v2-source.test.ts
```

Expected: failure opening `Include/TradeOpsTelemetryValues.mqh` in the isolation test. Other fixture tests may pass; that does not prove the missing MQL5 implementation. Fix test syntax/import issues before proceeding if the failure is unrelated to the missing file.

## Task 3: Implement the exact value primitives

**Create:** `mt5/TradeOpsAgent/Include/TradeOpsTelemetryValues.mqh`.

- [ ] Add this entire include:

```cpp
#ifndef TRADEOPS_TELEMETRY_VALUES_MQH
#define TRADEOPS_TELEMETRY_VALUES_MQH

bool Tov2Digits(const string text,const int start,const int count)
{
   int length=StringLen(text);
   if(start<0 || count<1 || start>length || count>length-start) return false;
   for(int i=start;i<start+count;i++)
   {
      ushort code=StringGetCharacter(text,i);
      if(code<'0' || code>'9') return false;
   }
   return true;
}

bool Tov2Counter(const long value,const long minimum=0)
{
   return minimum>=0 && minimum<=9007199254740991 &&
          value>=minimum && value<=9007199254740991;
}

bool Tov2CounterFromText(const string text,const long minimum,long &result)
{
   result=0;
   int length=StringLen(text);
   if(length<1 || length>16 || !Tov2Digits(text,0,length)) return false;
   if(length>1 && StringGetCharacter(text,0)=='0') return false;
   if(length==16 && StringCompare(text,"9007199254740991")>0) return false;
   long parsed=StringToInteger(text);
   if(!Tov2Counter(parsed,minimum)) return false;
   result=parsed;
   return true;
}

bool Tov2Identifier(const string value)
{
   int length=StringLen(value);
   if(length<1 || length>160) return false;
   for(int i=0;i<length;i++)
   {
      ushort c=StringGetCharacter(value,i);
      bool allowed=(c>='A' && c<='Z') || (c>='a' && c<='z') ||
                   (c>='0' && c<='9') || c=='.' || c=='_' || c==':' || c=='-';
      if(!allowed) return false;
   }
   return true;
}

bool Tov2Digest(const string value)
{
   if(StringLen(value)!=64) return false;
   bool nonzero=false;
   for(int i=0;i<64;i++)
   {
      ushort c=StringGetCharacter(value,i);
      if(!((c>='0' && c<='9') || (c>='a' && c<='f'))) return false;
      if(c!='0') nonzero=true;
   }
   return nonzero;
}

bool Tov2Ticket(const string value)
{
   int length=StringLen(value);
   if(length<1 || length>20 || !Tov2Digits(value,0,length)) return false;
   if(StringGetCharacter(value,0)=='0') return false;
   return length<20 || StringCompare(value,"18446744073709551615")<=0;
}

bool Tov2TicketFromUlong(const ulong value,string &result)
{
   result="";
   if(value==0) return false;
   string candidate=StringFormat("%I64u",value);
   if(!Tov2Ticket(candidate)) return false;
   result=candidate;
   return true;
}

bool Tov2ZeroDigits(const string value)
{
   bool digit=false;
   for(int i=0;i<StringLen(value);i++)
   {
      ushort c=StringGetCharacter(value,i);
      if(c=='-' && i==0) continue;
      if(c=='.') continue;
      if(c!='0') return false;
      digit=true;
   }
   return digit;
}

bool Tov2FixedText(const string value,const int scale)
{
   int length=StringLen(value);
   if(scale<0 || scale>16 || length<1 || length>36) return false;
   bool negative=StringGetCharacter(value,0)=='-';
   int start=negative ? 1 : 0;
   int dot=StringFind(value,".");
   int end=dot<0 ? length : dot;
   int integer_digits=end-start;
   if(integer_digits<1 || integer_digits>18 || !Tov2Digits(value,start,integer_digits)) return false;
   if(integer_digits>1 && StringGetCharacter(value,start)=='0') return false;
   if(scale==0)
   {
      if(dot>=0) return false;
   }
   else
   {
      if(dot<0 || length-dot-1!=scale || !Tov2Digits(value,dot+1,scale)) return false;
   }
   if(negative && Tov2ZeroDigits(value)) return false;
   return true;
}

bool Tov2FixedJson(const string value,const int scale,string &result)
{
   result="";
   if(!Tov2FixedText(value,scale)) return false;
   result="{\"scale\":"+IntegerToString(scale)+",\"value\":\""+value+"\"}";
   return true;
}

bool Tov2FixedFromDouble(const double value,const int scale,string &result)
{
   result="";
   if(scale<0 || scale>16 || !MathIsValidNumber(value)) return false;
   string text=DoubleToString(value,scale);
   if(StringLen(text)>0 && StringGetCharacter(text,0)=='-' && Tov2ZeroDigits(text))
      text=StringSubstr(text,1);
   return Tov2FixedJson(text,scale,result);
}

bool Tov2KnownReading(const string value,const int scale,string &result)
{
   result="";
   string fixed="";
   if(!Tov2FixedJson(value,scale,fixed)) return false;
   result="{\"reason\":null,\"value\":"+fixed+"}";
   return true;
}

bool Tov2MissingReading(const string reason,string &result)
{
   result="";
   if(reason!="READ_FAILED" && reason!="NOT_APPLICABLE" &&
      reason!="NOT_SET" && reason!="UNAVAILABLE") return false;
   result="{\"reason\":\""+reason+"\",\"value\":null}";
   return true;
}

#endif
```

`Tov2ZeroDigits` is a formatting helper, not a standalone decimal validator; public serializers always apply `Tov2FixedText`. Use MQL5's documented unsigned format modifier for the ticket conversion. [MetaQuotes integer formatting](https://www.mql5.com/en/docs/common/printformat).

- [ ] Run the targeted GREEN checks:

```sh
npm --prefix apps/execution-edge test -- test/mt5-telemetry-values-v2-source.test.ts test/telemetry-values-v2.test.ts test/mt5-heartbeat-agent-source.test.ts
npm --prefix apps/execution-edge run typecheck
node scripts/verify-mt5-dry-run-boundary.mjs
```

Expected: targeted Vitest tests, TypeScript typecheck and unchanged safety verifier pass. Do not adjust existing source-integrity manifests or remove a forbidden-operation check to make this pass.

## Task 4: Native Windows verification — explicit environment gate

- [ ] Identify a Windows MetaEditor executable and a transfer directory containing the **two new files only**, preserving `Scripts` and `Include` subdirectories. Do not transfer `config.ini`, journal state or existing EA credentials. Record MetaEditor version/build from About. If Windows tooling is unavailable, report native verification pending; Stage 3A is not fully verified.

- [ ] Compile only the synthetic script in a fresh directory using PowerShell:

```powershell
$ErrorActionPreference = 'Stop'
$telemetryEditor = (Resolve-Path -LiteralPath (Read-Host 'Full path to MetaEditor executable')).Path
$telemetryInput = (Resolve-Path -LiteralPath (Read-Host 'Transferred telemetry values directory')).Path
$telemetryBuild = Join-Path ([IO.Path]::GetTempPath()) ('tradeops-values-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $telemetryBuild | Out-Null
New-Item -ItemType Directory -Path (Join-Path $telemetryBuild 'Scripts') | Out-Null
New-Item -ItemType Directory -Path (Join-Path $telemetryBuild 'Include') | Out-Null
$telemetryScript = Join-Path $telemetryBuild 'Scripts\TradeOpsTelemetryValuesSelfTest.mq5'
$telemetryInclude = Join-Path $telemetryBuild 'Include\TradeOpsTelemetryValues.mqh'
Copy-Item -LiteralPath (Join-Path $telemetryInput 'Scripts\TradeOpsTelemetryValuesSelfTest.mq5') -Destination $telemetryScript
Copy-Item -LiteralPath (Join-Path $telemetryInput 'Include\TradeOpsTelemetryValues.mqh') -Destination $telemetryInclude
$telemetryEditorArgs = '/compile:"' + $telemetryScript + '" /log'
Start-Process -FilePath $telemetryEditor -ArgumentList $telemetryEditorArgs -Wait
$telemetryLog = [IO.Path]::ChangeExtension($telemetryScript, '.log')
$telemetryExe = [IO.Path]::ChangeExtension($telemetryScript, '.ex5')
if (!(Test-Path -LiteralPath $telemetryLog)) { throw 'Compiler log missing; native verification incomplete' }
Get-Content -LiteralPath $telemetryLog
if (!(Test-Path -LiteralPath $telemetryExe)) { throw 'Fresh EX5 missing; native verification incomplete' }
Get-FileHash -Algorithm SHA256 -LiteralPath $telemetryScript, $telemetryInclude, $telemetryExe
Write-Output ('Verification directory: ' + $telemetryBuild)
```

Expected: a fresh compiler log with zero errors and zero warnings, and a newly generated EX5 next to the synthetic script. Inspect the log rather than relying on process exit status or EX5 existence alone. The supported command-line flags are documented by [MetaEditor](https://www.metatrader5.com/en/metaeditor/help/beginning/integration_ide#compiler). Compare transferred source hashes with the local sources before accepting compiler evidence.

- [ ] After approval of a specific isolated/offline terminal, run **only** `TradeOpsTelemetryValuesSelfTest.ex5` there. It requires no account, network, DLL or trade permissions. Capture the Experts output: exactly one final `TOV2_VALUES_PASS`, zero `TOV2_VALUES_FAILURE`, and `failures=0`; keep the printed check count. `TOV2_VALUES_FAIL`, missing output or a runtime error is failure. Do not replace or detach the user's working EA. Do not call this script a Strategy Tester HTTP test.

Any MQL5 compile or runtime mismatch must be corrected in the new files with its failing case retained. Re-run the TypeScript and native checks after changes. Do not change receiver semantics merely to match an erroneous client result.

## Task 5: Regression, local handoff, and stop before active integration

- [ ] Run regression commands from the backend root:

```sh
npm --prefix apps/execution-edge test
npm --prefix apps/execution-edge run typecheck
npm --prefix apps/execution-edge run lint
node scripts/verify-mt5-dry-run-boundary.mjs
git diff --check
git status --short
```

Expected: all tests/checks pass, and only the three planned new files have been added relative to the captured dirty baseline. The previous suite had 537 tests/29 files; this plan adds 5 TS tests in one file. Use the actual run totals, not this historical count, if concurrent authorized work changed the baseline. Inspect new untracked files too; `git diff --check` alone does not cover them.

- [ ] Record the local handoff in the response: exact three files, actual test totals, source hashes, Windows compiler/native output or the explicit pending gate, and no live changes. Preserve current v1 behavior and all Stage 1–2 work. Do not stage or commit.

- [ ] Stop before active integration. The next checkpoint is the complete 3B persistence/outbox plan; this values library does not yet add real financials or journal entries to the dashboard.

## Inline plan review

The plan covers the values subset of the approved design: exact decimals/tickets, safe counters, canonical known/missing values, matching native/TS vectors and unchanged v1 boundaries. Persistence/cutover/ownership, collection/history, canonical full transport and lifecycle are explicitly assigned to 3B–3D in the companion delivery plan, not claimed here. Every new helper used in the self-test is defined in Task 3; every TS import exists in the inspected receiver. No MQL5 compile/runtime result is implied by the fixture agreement tests. Windows verification is an explicit dependency, not a substituted TS success.
