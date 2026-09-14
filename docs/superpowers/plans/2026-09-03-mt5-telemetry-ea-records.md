# MT5 Telemetry Local Record Implementation Plan — Stage 3B1

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish a bounded, checksummed, byte-preserving local record format before building journal file ownership and crash recovery.

**Architecture:** Add an isolated MQL5 binary record encoder/decoder using the verified Stage 3A counter validators. Bind record kind, generation, payload length and exact payload bytes into one SHA-256 checksum. Test deterministic vectors, truncation, corruption and bounds without file, account or network access; the next dependent checkpoint owns durable commits, not this codec.

**Tech Stack:** MQL5, native `CryptEncode(CRYPT_HASH_SHA256)`, Node SHA-256, Vitest, Windows MetaEditor and the existing isolated test terminal.

---

## Status, scope and paths

Written as a planning-only document on 2026-09-03. The user subsequently approved subagent-driven execution with “ok lets do it.” Local implementation and both independent reviews pass, with **545 tests / 31 files PASS**, typecheck/lint/safety checks passing, and a verified source-only Windows bundle; see the [execution audit](../../audits/2026-09-03-mt5-telemetry-ea-records.md). The user now reports GUI compilation with zero errors/warnings and `TOV2_RECORD_PASS checks=475 failures=0`; the full compiler/runtime logs, EX5 identity and fresh environment attestation have not been supplied. Do not ask for a repeat run to begin local recovery design. The code blocks below remain the original reviewed plan, not the byte-identical as-built source or proof of runtime success; use the audit's source hashes and bundle for the implemented version. No commit, deployment, migration, installed-EA replacement or broker action is authorized.

Backend root (all relative source paths and shell commands below):

`/Users/ameeramer/.config/superpowers/worktrees/prop-trading-system/mt5-stale-payload-recovery`

Docs root:

`/Users/ameeramer/.config/superpowers/worktrees/prop-trading-system/tradeops-dashboard-migration`

Inspected backend HEAD: `8a801423bc19b3bb27c8e24f45d2800a9deb6881`; docs HEAD: `18e29ce68d9e9fc89311163e95dd2b71f040c527`. Both contain pre-existing uncommitted work. Preserve it. No staging or commits: use local review checkpoints instead.

Read the approved [account telemetry design](../specs/2026-09-03-mt5-account-telemetry-journal-design.md), the [EA checkpoint sequence](2026-09-03-mt5-telemetry-ea-delivery.md), and [Stage 3A evidence](../../audits/2026-09-03-mt5-telemetry-ea-values.md). The user-provided raw native log records two runs of `TOV2_VALUES_PASS checks=146 failures=0`. Uploaded sources match the reviewed sources, and transfer of the uploaded EX5 into the test terminal without recompiling is user-attested. Do not request that upload or values rerun again. Retain the separately recorded compiler-log/environment evidence limits; this is not full-EA readiness.

Create only these three implementation files after plan approval:

| File | Responsibility |
| --- | --- |
| `mt5/TradeOpsAgent/Include/TradeOpsTelemetryRecord.mqh` | Pure local binary framing and checksum validation |
| `mt5/TradeOpsAgent/Scripts/TradeOpsTelemetryRecordSelfTest.mq5` | Synthetic native codec checks; no terminal/account/file I/O |
| `apps/execution-edge/test/mt5-telemetry-record-v2-source.test.ts` | Independent golden-vector arithmetic/hashes and source-isolation guard |

Do not modify the verified values files, `TradeOpsAgent.mq5`, Config/Sync/CanonicalJson, installed files, Worker source/schema, existing fixture, package dependencies, risk or Pine settings. An execution audit may be added under the docs root after obtaining its write permission; record actual results, not predictions.

## Why 3B is split

The parent 3B checkpoint includes record framing, exclusive file ownership, recovery selection, durable event sequencing, immutable uploads and ACK compaction. They are dependent boundaries. This plan is executable for **3B1 only**; it is not an implementation plan or completion claim for the remaining persistence/outbox work.

Alternatives considered within the approved local-files design:

1. **Selected: bounded binary frames with explicit type/generation/length and checksum.** Preserve arbitrary request bytes; make malformed headers and partial writes detectable before interpreting state.
2. Text INI/JSON lines without framing. Requires escaping/reparsing every payload and does not itself bind length, generation and payload integrity. Do not reuse the v1 INI persistence layer.
3. Embedded database through DLL or an external service. Adds a runtime dependency and permission/operational surface not required by the approved free/local approach.

The frame checksum is corruption detection, not authentication or encryption. A complete valid frame is **not proof of a filesystem commit**, nor proof of a valid telemetry request. There is deliberately no function that selects a recovery generation or authorizes sending/deletion in this checkpoint.

### Receiver facts that later checkpoints must preserve

Inspected `telemetry-wire-v2.ts`, `telemetry-admission-v2.ts`, `telemetry-sync-v2.ts` and `telemetry-cutover-v2.ts` in the backend root:

- V2 body digest hashes canonical JSON **without** `body_sha256`. The local frame checksum hashes a different preimage, including all persisted payload bytes. Never substitute one digest for the other.
- An exact accepted retry is recognized before envelope freshness. Retain the exact pending request bytes; do not rebuild an uncertain request from new observations.
- Requests and events advance contiguously. A response must match the pending request identity, sequence, body digest and exact final event ACK. A general HTTP 200 or numeric ACK is insufficient.
- An upload permits at most 32 events and no two revisions of one deal. Split at the first repeated deal ID; do not skip an earlier event to fill a batch.
- Requests are capped at 262,144 encoded bytes, responses at 16,384. The **local frame overhead is never transmitted**.
- Registration binds the immutable boundary/baseline. Missing or corrupt local state cannot silently initialize a different boundary. There is no public receiver recovery lookup to invent.

## Local record contract

One frame consists of ASCII header, raw payload, and ASCII footer:

```text
TOV2R1|<kind>|<generation>|<payload_byte_count>\n
<exact payload bytes>
\nSHA256|<64 lowercase hexadecimal characters>\n
```

The notation places header/payload/footer on separate lines for readability; the encoder adds only the literal line feeds shown with `\n`, not a line separator after each diagram line.

- Kind: exactly `REGISTRATION`, `EVENT`, `PENDING`, `ACK` or `CHECKPOINT`.
- Generation: canonical decimal integer 1 through `9007199254740991`; never convert through `double`. It is a local record generation, not a server request sequence.
- Payload: 1 through 262,144 bytes. No BOM insertion, character conversion, JSON parsing or NUL stripping. Empty payloads are rejected; a valid zero-event upload is still a nonempty JSON body.
- Header including its terminating LF: at most 128 bytes; printable ASCII before LF, exactly four pipe-separated fields. No leading zero, whitespace, sign, exponent, CR or unknown version.
- Footer: exactly 73 bytes. SHA-256 covers the **header including LF plus the raw payload**, not the footer.
- Total bound: 262,345 bytes. Reject bounds before allocating according to untrusted lengths; require exact total length (no trailing junk or concatenated frames).
- Decoder outputs are cleared on failure. Encoder output is cleared on failure. Input/output byte arrays must be distinct, dynamic, one-dimensional, non-series arrays; callers must not alias them or pass fixed-size output arrays.
- The decoder returns raw payload and validated structural metadata. A later typed-state reader must validate the payload schema, expected identity, referenced records, generation chain and commit status before use. Payload bytes need not be valid UTF-8 at this layer.
- `PENDING` may hold a maximum-size wire request. Other kinds retain the same outer limit; their inner schemas and smaller limits belong to the subsequent state/outbox plan. No disk-budget promise follows from the frame bound.

Official API basis: [CryptEncode](https://www.mql5.com/en/docs/common/cryptencode) takes byte arrays and reports output byte count; require exactly 32 hash bytes. [ArrayCopy](https://www.mql5.com/en/docs/array/arraycopy) reports copied elements; verify counts. [StringSplit](https://www.mql5.com/en/docs/strings/stringsplit) supplies bounded header fields. No file operations are introduced here.

## Task 1: Native fixtures first

**Create:** `mt5/TradeOpsAgent/Scripts/TradeOpsTelemetryRecordSelfTest.mq5`.

- [x] Record status/HEAD and verify all three planned paths are absent before creating them. Stop on an existing path; inspect rather than overwrite it.

```sh
git status --short
git rev-parse HEAD
git diff --cached --stat
rg --files mt5/TradeOpsAgent apps/execution-edge/test | rg 'TelemetryRecord|telemetry-record-v2-source'
```

Expected: existing dirty work is preserved, staged diff stays empty, final search has no match (exit 1).

- [x] Implement the native fixture from the contract below, before adding its record include. As-built source and strengthened failure assertions are identified in the execution audit.

```cpp
#property strict
#property version "1.000"
#property description "Offline synthetic local telemetry record tests"
#include "../Include/TradeOpsTelemetryRecord.mqh"

int tor_checks=0;
int tor_failures=0;

void Check(const bool ok,const string label)
{
   tor_checks++;
   if(!ok)
   {
      tor_failures++;
      Print("TOV2_RECORD_FAILURE ",label," #",tor_checks);
   }
}

int Nibble(const ushort ch)
{
   if(ch>=48 && ch<=57) return (int)ch-48;
   if(ch>=97 && ch<=102) return (int)ch-87;
   return -1;
}

bool FromHex(const string text,uchar &bytes[])
{
   ArrayResize(bytes,0);
   int size=StringLen(text);
   if(size%2!=0 || ArrayResize(bytes,size/2)!=size/2) return false;
   for(int i=0;i<size;i+=2)
   {
      int high=Nibble(StringGetCharacter(text,i));
      int low=Nibble(StringGetCharacter(text,i+1));
      if(high<0 || low<0) { ArrayResize(bytes,0); return false; }
      bytes[i/2]=(uchar)(high*16+low);
   }
   return true;
}

string ToHex(const uchar &bytes[])
{
   string result="";
   for(int i=0;i<ArraySize(bytes);i++) result+=StringFormat("%02x",bytes[i]);
   return result;
}

bool SameBytes(const uchar &left[],const uchar &right[])
{
   if(ArraySize(left)!=ArraySize(right)) return false;
   for(int i=0;i<ArraySize(left);i++) if(left[i]!=right[i]) return false;
   return true;
}

void Rejected(const uchar &frame[])
{
   string kind="sentinel";
   long generation=123;
   uchar decoded[];
   ArrayResize(decoded,1);
   decoded[0]=99;
   Check(!Tov2RecordDecode(frame,kind,generation,decoded),"reject damaged frame");
   Check(kind=="" && generation==0 && ArraySize(decoded)==0,"clear rejected output");
}

void Golden(const string kind,const string generation_text,const string payload_hex,const string digest,const int size)
{
   long generation=0;
   uchar payload[],frame[],decoded[];
   Check(Tov2CounterFromText(generation_text,1,generation),"golden counter");
   Check(FromHex(payload_hex,payload),"golden payload");
   Check(Tov2RecordEncode(kind,generation,payload,frame),"golden encode");
   Check(ArraySize(frame)==size,"golden byte size");
   string expected="\nSHA256|"+digest+"\n";
   bool footer=(ArraySize(frame)>=73);
   if(footer)
      for(int i=0;i<73;i++)
         if(frame[ArraySize(frame)-73+i]!=(uchar)StringGetCharacter(expected,i)) footer=false;
   Check(footer,"independent golden digest");
   string actual_kind="";
   long actual_generation=0;
   Check(Tov2RecordDecode(frame,actual_kind,actual_generation,decoded),"golden decode");
   Check(actual_kind==kind && actual_generation==generation,"golden metadata");
   Check(ToHex(decoded)==payload_hex,"raw bytes including NUL preserved");
   uchar retry[];
   Check(Tov2RecordEncode(kind,generation,payload,retry) && SameBytes(frame,retry),"deterministic encoding");
}

// Forge a correct checksum for an intentionally malformed header, so rejection
// cannot be explained only by a checksum mismatch.
void BadHeader(const string header)
{
   int count=StringLen(header);
   uchar prefix[],frame[];
   ArrayResize(prefix,count+1);
   for(int i=0;i<count;i++) prefix[i]=(uchar)StringGetCharacter(header,i);
   prefix[count]=65;
   string digest="";
   Check(Tov2RecordHash(prefix,digest),"forged header checksum");
   string footer="\nSHA256|"+digest+"\n";
   ArrayResize(frame,count+1+73);
   ArrayCopy(frame,prefix,0,0,count+1);
   for(int i=0;i<73;i++) frame[count+1+i]=(uchar)StringGetCharacter(footer,i);
   Rejected(frame);
}

void OnStart()
{
   Golden("PENDING","1","7b7d","013de192cb5d8de0b182063e53fe6ed87e7750939c7b519e65dbb698afc02233",94);
   Golden("EVENT","9007199254740991","007cff0a","f9c3d87acdc76753a78bbf99565aa1a28dc4c55e98b9871a2a914be9c6f0c3d7",109);
   Golden("REGISTRATION","2","e282ac","6ec2d7564655f7b344c2b571d5f8470ceb6a80e0c089603b129c24a2e4e2328c",100);

   uchar payload[],frame[],changed[],decoded[];
   FromHex("7b7d",payload);
   Check(Tov2RecordEncode("PENDING",1,payload,frame),"small mutation fixture");
   int size=ArraySize(frame);
   for(int end=0;end<size;end++)
   {
      ArrayResize(changed,end);
      if(end>0) ArrayCopy(changed,frame,0,0,end);
      Rejected(changed);
   }
   for(int index=0;index<size;index++)
   {
      ArrayResize(changed,size);
      ArrayCopy(changed,frame,0,0,size);
      changed[index]=(uchar)(changed[index]^1);
      Rejected(changed);
   }
   ArrayResize(changed,size+1);
   ArrayCopy(changed,frame,0,0,size);
   changed[size]=0;
   Rejected(changed);
   ArrayResize(changed,size*2);
   ArrayCopy(changed,frame,0,0,size);
   ArrayCopy(changed,frame,size,0,size);
   Rejected(changed);

   BadHeader("TOV2R2|EVENT|1|1\n");
   BadHeader("TOV2R1|UNKNOWN|1|1\n");
   BadHeader("TOV2R1|event|1|1\n");
   BadHeader("TOV2R1|EVENT|01|1\n");
   BadHeader("TOV2R1|EVENT|0|1\n");
   BadHeader("TOV2R1|EVENT|-1|1\n");
   BadHeader("TOV2R1|EVENT|+1|1\n");
   BadHeader("TOV2R1|EVENT|1.0|1\n");
   BadHeader("TOV2R1|EVENT|9007199254740992|1\n");
   BadHeader("TOV2R1|EVENT|1|01\n");
   BadHeader("TOV2R1|EVENT|1|0\n");
   BadHeader("TOV2R1|EVENT|1|262145\n");
   BadHeader("TOV2R1|EVENT|1|1\r\n");
   BadHeader("TOV2R1|EVENT|1|1|extra\n");
   BadHeader("TOV2R1|EVENT|1|1|\n");
   string overlong="TOV2R1|";
   for(int i=0;i<129;i++) overlong+="A";
   BadHeader(overlong+"|1|1\n");

   string kinds[]={"REGISTRATION","EVENT","PENDING","ACK","CHECKPOINT"};
   for(int k=0;k<ArraySize(kinds);k++)
   {
      Check(Tov2RecordEncode(kinds[k],7,payload,frame),"known record kind");
      string kind="";
      long generation=0;
      Check(Tov2RecordDecode(frame,kind,generation,decoded)
         && kind==kinds[k] && generation==7 && SameBytes(decoded,payload),"known kind round trip");
   }
   Check(!Tov2RecordEncode("UNKNOWN",1,payload,frame) && ArraySize(frame)==0,"bad kind clears encoder");
   Check(!Tov2RecordEncode("EVENT",0,payload,frame) && ArraySize(frame)==0,"zero generation");
   Check(!Tov2RecordEncode("EVENT",9007199254740992,payload,frame) && ArraySize(frame)==0,"generation overflow");
   ArrayResize(payload,0);
   Check(!Tov2RecordEncode("EVENT",1,payload,frame) && ArraySize(frame)==0,"empty payload");
   ArrayResize(payload,262144);
   ArrayInitialize(payload,(uchar)255);
   Check(Tov2RecordEncode("PENDING",1,payload,frame),"maximum payload encode");
   string kind="";
   long generation=0;
   Check(Tov2RecordDecode(frame,kind,generation,decoded) && SameBytes(payload,decoded),"maximum raw payload round trip");
   ArrayResize(payload,262145);
   Check(!Tov2RecordEncode("PENDING",1,payload,frame) && ArraySize(frame)==0,"oversized payload");
   ArrayResize(frame,262346);
   ArrayInitialize(frame,(uchar)65);
   Rejected(frame);

   if(tor_failures==0) Print("TOV2_RECORD_PASS checks=",tor_checks," failures=0");
   else Print("TOV2_RECORD_FAIL checks=",tor_checks," failures=",tor_failures);
}
```

## Task 2: Add the independent source/vector seam and observe RED

**Create:** `apps/execution-edge/test/mt5-telemetry-record-v2-source.test.ts`.

- [x] Implement the source/vector seam below, with additional review-regression guards in the as-built version. It checks fixture arithmetic with Node; it does not execute MQL5 or prove filesystem reliability.

```typescript
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readCounterV2 } from '../src/telemetry-values-v2';

const root = join(import.meta.dirname, '../../..');
const agent = join(root, 'mt5/TradeOpsAgent');
function source(path: string): string {
  const full = join(agent, path);
  expect(existsSync(full), `${path} must exist`).toBe(true);
  return readFileSync(full, 'utf8');
}

describe('MT5 telemetry local-record source seam', () => {
  it('keeps the codec and synthetic test isolated from the active EA', () => {
    const codec = source('Include/TradeOpsTelemetryRecord.mqh');
    const native = source('Scripts/TradeOpsTelemetryRecordSelfTest.mq5');
    expect(codec.split('\n').filter((line) => line.startsWith('#include')))
      .toEqual(['#include "TradeOpsTelemetryValues.mqh"']);
    expect(native.split('\n').filter((line) => line.startsWith('#include')))
      .toEqual(['#include "../Include/TradeOpsTelemetryRecord.mqh"']);
    for (const text of [codec, native]) {
      expect(text).not.toMatch(/\b(?:File\w+|Folder\w+|WebRequest|Socket\w+|OrderSend\w*|CTrade|AccountInfo\w*|History\w*|PositionGet\w*|OrderGet\w*|OnTimer|OnTradeTransaction)\s*\(|#import/u);
    }
    expect(source('TradeOpsAgent.mq5')).not.toContain('TradeOpsTelemetryRecord');
    expect(codec).toContain('CryptEncode(CRYPT_HASH_SHA256,bytes,key,digest)!=32');
    expect(codec).toContain('Tov2CounterFromText(parts[2],1,parsed_generation)');
    expect(codec).toContain('Tov2CounterFromText(parts[3],1,parsed_size)');
    expect(codec).not.toMatch(/\b(?:double|StringToDouble|CharArrayToString)\b/u);
  });

  it('matches every native golden frame against independent byte hashes', () => {
    const native = source('Scripts/TradeOpsTelemetryRecordSelfTest.mq5');
    const cases = [...native.matchAll(/^   Golden\((.*)\);$/gm)];
    expect(cases).toHaveLength(3);
    for (const match of cases) {
      const [kind, generationText, hex, expectedDigest, expectedSize] = JSON.parse(`[${match[1]}]`) as [string, string, string, string, number];
      const generation = readCounterV2(Number(generationText), 1);
      expect(String(generation)).toBe(generationText);
      const payload = Buffer.from(hex, 'hex');
      expect(payload.toString('hex')).toBe(hex);
      const header = Buffer.from(`TOV2R1|${kind}|${generationText}|${payload.length}\n`, 'ascii');
      const prefix = Buffer.concat([header, payload]);
      const digest = createHash('sha256').update(prefix).digest('hex');
      const frame = Buffer.concat([prefix, Buffer.from(`\nSHA256|${digest}\n`, 'ascii')]);
      expect(digest).toBe(expectedDigest);
      expect(frame.length).toBe(expectedSize);
      expect(frame.subarray(header.length, prefix.length)).toEqual(payload);
    }
  });

  it('retains native corruption and bounds cases, not only successful round trips', () => {
    const native = source('Scripts/TradeOpsTelemetryRecordSelfTest.mq5');
    expect(native).toContain('for(int end=0;end<size;end++)');
    expect(native).toContain('for(int index=0;index<size;index++)');
    expect(native).toContain('changed[index]=(uchar)(changed[index]^1);');
    expect(native).toContain('ArrayResize(changed,size*2);');
    expect(native).toContain('BadHeader("TOV2R1|EVENT|01|1\\n");');
    expect(native).toContain('BadHeader("TOV2R1|EVENT|9007199254740992|1\\n");');
    expect(native).toContain('ArrayResize(payload,262144);');
    expect(native).toContain('ArrayResize(payload,262145);');
    expect(native).toContain('ArrayResize(frame,262346);');
    expect(native).toContain('kind=="" && generation==0 && ArraySize(decoded)==0');
    expect(native).toContain('TOV2_RECORD_PASS');
    expect(native).toContain('TOV2_RECORD_FAILURE');
  });
});
```

- [x] Run the new focused check before creating the include:

```sh
npm --prefix apps/execution-edge test -- test/mt5-telemetry-record-v2-source.test.ts
```

Expected: nonzero exit and the source-existence assertion fails for `Include/TradeOpsTelemetryRecord.mqh`. Native fixture/hash checks can pass already. Record the actual RED output. Missing dependency/runtime failures are not the intended RED.

## Task 3: Implement only the pure record include

**Create:** `mt5/TradeOpsAgent/Include/TradeOpsTelemetryRecord.mqh`.

- [x] Implement the pure record include from this contract; review fixes and as-built hashes are recorded in the execution audit:

```cpp
#ifndef TRADEOPS_TELEMETRY_RECORD_MQH
#define TRADEOPS_TELEMETRY_RECORD_MQH
#include "TradeOpsTelemetryValues.mqh"

const int TOV2_RECORD_PAYLOAD_MAX=262144;
const int TOV2_RECORD_HEADER_MAX=128;
const int TOV2_RECORD_FOOTER_SIZE=73;
const int TOV2_RECORD_FRAME_MAX=262345;

bool Tov2RecordKind(const string kind)
{
   return kind=="REGISTRATION" || kind=="EVENT" || kind=="PENDING"
      || kind=="ACK" || kind=="CHECKPOINT";
}

bool Tov2RecordHash(const uchar &bytes[],string &hex)
{
   hex="";
   int count=ArraySize(bytes);
   if(count<1 || count>TOV2_RECORD_PAYLOAD_MAX+TOV2_RECORD_HEADER_MAX) return false;
   uchar key[],digest[];
   if(CryptEncode(CRYPT_HASH_SHA256,bytes,key,digest)!=32 || ArraySize(digest)!=32) return false;
   for(int i=0;i<32;i++) hex+=StringFormat("%02x",digest[i]);
   return true;
}

bool Tov2RecordEncode(const string kind,const long generation,const uchar &payload[],uchar &frame[])
{
   ArrayResize(frame,0);
   int count=ArraySize(payload);
   if(!Tov2RecordKind(kind) || !Tov2Counter(generation,1)
      || count<1 || count>TOV2_RECORD_PAYLOAD_MAX) return false;
   string header="TOV2R1|"+kind+"|"+StringFormat("%I64d",generation)+"|"+IntegerToString(count)+"\n";
   int header_count=StringLen(header);
   if(header_count>TOV2_RECORD_HEADER_MAX) return false;
   int prefix_count=header_count+count;
   uchar prefix[];
   if(ArrayResize(prefix,prefix_count)!=prefix_count) return false;
   for(int i=0;i<header_count;i++) prefix[i]=(uchar)StringGetCharacter(header,i);
   if(ArrayCopy(prefix,payload,header_count,0,count)!=count) return false;
   string digest="";
   if(!Tov2RecordHash(prefix,digest)) return false;
   string footer="\nSHA256|"+digest+"\n";
   int total=prefix_count+TOV2_RECORD_FOOTER_SIZE;
   if(ArrayResize(frame,total)!=total) { ArrayResize(frame,0); return false; }
   if(ArrayCopy(frame,prefix,0,0,prefix_count)!=prefix_count)
   {
      ArrayResize(frame,0);
      return false;
   }
   for(int i=0;i<TOV2_RECORD_FOOTER_SIZE;i++) frame[prefix_count+i]=(uchar)StringGetCharacter(footer,i);
   return true;
}

bool Tov2RecordDecode(const uchar &frame[],string &kind,long &generation,uchar &payload[])
{
   kind="";
   generation=0;
   ArrayResize(payload,0);
   int total=ArraySize(frame);
   if(total<TOV2_RECORD_FOOTER_SIZE+2 || total>TOV2_RECORD_FRAME_MAX) return false;

   string header="";
   int header_count=0;
   bool ended=false;
   for(int i=0;i<total && i<TOV2_RECORD_HEADER_MAX;i++)
   {
      if(frame[i]==10) { header_count=i+1; ended=true; break; }
      if(frame[i]<32 || frame[i]>126) return false;
      header+=ShortToString((ushort)frame[i]);
   }
   if(!ended) return false;
   string parts[];
   if(StringSplit(header,(ushort)124,parts)!=4) return false;
   if(parts[0]!="TOV2R1" || !Tov2RecordKind(parts[1])) return false;
   long parsed_generation=0;
   long parsed_size=0;
   if(!Tov2CounterFromText(parts[2],1,parsed_generation)
      || !Tov2CounterFromText(parts[3],1,parsed_size)
      || parsed_size>TOV2_RECORD_PAYLOAD_MAX) return false;
   int count=(int)parsed_size;
   string canonical_header="TOV2R1|"+parts[1]+"|"+StringFormat("%I64d",parsed_generation)+"|"+IntegerToString(count);
   if(header!=canonical_header) return false;
   int prefix_count=header_count+count;
   if(total!=prefix_count+TOV2_RECORD_FOOTER_SIZE) return false;

   string footer_prefix="\nSHA256|";
   for(int i=0;i<8;i++) if(frame[prefix_count+i]!=(uchar)StringGetCharacter(footer_prefix,i)) return false;
   if(frame[total-1]!=10) return false;
   string stored_digest="";
   for(int i=0;i<64;i++)
   {
      uchar ch=frame[prefix_count+8+i];
      if(!((ch>=48 && ch<=57) || (ch>=97 && ch<=102))) return false;
      stored_digest+=ShortToString((ushort)ch);
   }
   uchar prefix[];
   if(ArrayResize(prefix,prefix_count)!=prefix_count) return false;
   if(ArrayCopy(prefix,frame,0,0,prefix_count)!=prefix_count) return false;
   string actual_digest="";
   if(!Tov2RecordHash(prefix,actual_digest) || actual_digest!=stored_digest) return false;
   if(ArrayResize(payload,count)!=count) { ArrayResize(payload,0); return false; }
   if(ArrayCopy(payload,frame,0,header_count,count)!=count)
   {
      ArrayResize(payload,0);
      return false;
   }
   kind=parts[1];
   generation=parsed_generation;
   return true;
}

#endif
```

- [x] Run the focused source/vector test again:

```sh
npm --prefix apps/execution-edge test -- test/mt5-telemetry-record-v2-source.test.ts
```

Expected: 3 passing TS checks. This GREEN establishes the seam and golden vectors only. Do not label the native codec or durable storage as passed on this basis.

## Task 4: Regression and source review

- [x] Run the existing values seam and complete execution-edge regression, then typecheck/lint and the unchanged safety verifier:

```sh
npm --prefix apps/execution-edge test
npm --prefix apps/execution-edge run typecheck
npm --prefix apps/execution-edge run lint
node scripts/verify-mt5-dry-run-boundary.mjs
git diff --check
git diff --cached --stat
git status --short
shasum -a 256 mt5/TradeOpsAgent/Include/TradeOpsTelemetryValues.mqh mt5/TradeOpsAgent/Include/TradeOpsTelemetryRecord.mqh mt5/TradeOpsAgent/Scripts/TradeOpsTelemetryRecordSelfTest.mq5 apps/execution-edge/test/mt5-telemetry-record-v2-source.test.ts
```

Expected: zero exit for all validation commands; staged diff empty. Historical baseline is 542 tests in 30 files, so unchanged baseline plus the proposed 3 checks should produce 545 in 31 files. Treat this as a prediction until execution; investigate any discrepancy. If the sandbox blocks Miniflare's disposable local runtime, request only the needed local-test permission rather than changing tests or using remote D1.

The verified values source must remain SHA-256 `0016223e32d8d0cf960a3b015581518948a8a2e1464196c0d8f7952d4dc9ea4f`. Compare all pre-existing files against the pre-task snapshot, not just the tracked diff: most telemetry source is currently untracked. Confirm the active EA has no new include. Independent implementation/spec/quality review is required if using the subagent-driven execution option; reviews must inspect the actual three-file diff and actual results.

## Task 5: Native verification, using the existing test installation

The original procedure below is retained as the formal evidence checklist. The user has already reported a GUI build and native PASS through the later step-by-step handoff; unchecked combined steps below reflect missing hash/log/environment artifacts, not an instruction to repeat that successful test. Do not install another terminal, attach the new script to the working EA's terminal, enable trading, or place a test order. Use the already identified test installation `C:\MT5-Telemetry-Test` only after confirming it is still the separate test copy. DLL/WebRequest and Algo Trading stay off; no broker login is needed for this pure test.

- [x] User reports GUI compiler result: zero errors and zero warnings.
- [x] User reports native result: `TOV2_RECORD_PASS checks=475 failures=0`.
- [ ] Independently identify compiler/runtime artifacts, EX5 hash and test-environment state. These are not supplied; no rerun/upload request is made now.

- [x] Prepare a source-only bundle with exactly the new script and the two includes, preserving `Scripts/` and `Include/`. Include a generated SHA-256 manifest. Run this command from the backend root; it writes only a unique temporary directory and archive, not the repo:

```sh
node --input-type=module -e '
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
const dest = mkdtempSync(join(tmpdir(), "tradeops-records-verify-"));
const files = ["Include/TradeOpsTelemetryValues.mqh", "Include/TradeOpsTelemetryRecord.mqh", "Scripts/TradeOpsTelemetryRecordSelfTest.mq5"];
mkdirSync(join(dest, "Include"));
mkdirSync(join(dest, "Scripts"));
const manifest = {};
for (const name of files) {
  const input = join("mt5/TradeOpsAgent", name);
  copyFileSync(input, join(dest, name));
  manifest[name] = createHash("sha256").update(readFileSync(input)).digest("hex");
}
writeFileSync(join(dest, "sha256.json"), JSON.stringify(manifest, null, 2) + "\n");
const archive = join(dest, "TradeOpsTelemetryRecord-Windows-SelfTest.zip");
execFileSync("zip", ["-q", archive, ...files, "sha256.json"], { cwd: dest });
process.stdout.write(JSON.stringify({ archive, manifest }, null, 2) + "\n");
'
```

This packaging command is a mechanical copy/archive/manifest operation, not a substitute for `apply_patch` source edits. Inspect the ZIP entry list and compare all three archived source hashes with the manifest before handoff. Do not include config, account data, the active EA or any precompiled EX5.

- [ ] On Windows, extract that bundle and run the following PowerShell build procedure. It prompts for real existing paths instead of assuming the browser's download directory. It compiles in a fresh unique directory to avoid an old EX5 being mistaken for a new result:

```powershell
$ErrorActionPreference = 'Stop'
$bundleRoot = (Resolve-Path (Read-Host 'Full path of the extracted record-test folder')).Path
$compilerPath = (Resolve-Path (Read-Host 'Full path of MetaEditor64.exe in the separate test installation')).Path
if ($compilerPath -ine 'C:\MT5-Telemetry-Test\metaeditor64.exe') { throw 'Use the identified separate test installation only.' }
$manifest = Get-Content -LiteralPath (Join-Path $bundleRoot 'sha256.json') -Raw | ConvertFrom-Json
$relativeFiles = @('Include/TradeOpsTelemetryValues.mqh', 'Include/TradeOpsTelemetryRecord.mqh', 'Scripts/TradeOpsTelemetryRecordSelfTest.mq5')
if (@($manifest.PSObject.Properties).Count -ne 3) { throw 'Unexpected manifest entries.' }
$buildRoot = Join-Path $env:TEMP ('TradeOpsRecordBuild-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path (Join-Path $buildRoot 'Include') -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $buildRoot 'Scripts') -Force | Out-Null
foreach ($relative in $relativeFiles) {
  $source = Join-Path $bundleRoot $relative
  $expected = $manifest.PSObject.Properties[$relative].Value
  if (-not ($expected -cmatch '^[0-9a-f]{64}$')) { throw "Missing hash: $relative" }
  if ((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant() -cne $expected) { throw "Hash mismatch: $relative" }
  Copy-Item -LiteralPath $source -Destination (Join-Path $buildRoot $relative)
}
$mainSource = Join-Path $buildRoot 'Scripts\TradeOpsTelemetryRecordSelfTest.mq5'
$compileLog = [IO.Path]::ChangeExtension($mainSource, '.log')
$binary = [IO.Path]::ChangeExtension($mainSource, '.ex5')
$startedUtc = [DateTime]::UtcNow
$process = Start-Process -FilePath $compilerPath -ArgumentList ('/compile:"' + $mainSource + '" /log') -Wait -PassThru
if (-not (Test-Path -LiteralPath $compileLog)) { throw 'Compiler log missing; preserve the build folder.' }
Get-Content -LiteralPath $compileLog
if (-not (Test-Path -LiteralPath $binary)) { throw 'No new EX5; preserve the compiler log.' }
if ((Get-Item -LiteralPath $binary).LastWriteTimeUtc -lt $startedUtc) { throw 'EX5 predates this build.' }
Get-FileHash -LiteralPath $binary -Algorithm SHA256
Write-Output ('Compiler process exit code: ' + $process.ExitCode)
Write-Output ('Build folder: ' + $buildRoot)
```

Expected: the actual compiler log names the self-test and both includes, reports code generation and zero errors/warnings; EX5 exists in the fresh build folder. Inspect the log, not only process exit code. Save compiler build/version, full log, source manifest and EX5 hash. If compilation fails, stop and fix the isolated source through review; do not work around it by changing the active EA or permission settings. Official [MetaEditor command-line compiler](https://www.metatrader5.com/en/metaeditor/help/beginning/integration_ide#compiler) documents `/compile` and `/log`.

- [ ] Copy only that newly built EX5 to the separate test copy's data directory under `MQL5\Scripts`; verify its hash after copying. Refresh Scripts there, run the script once, and save the **Experts** log. Do not copy the sources into the terminal or trigger a bulk recompile. Expected: one `TOV2_RECORD_PASS` summary for that invocation, `checks=475 failures=0`, no `TOV2_RECORD_FAILURE` or `TOV2_RECORD_FAIL` entries. This expected count is static arithmetic, not observed execution: 27 golden checks, 1 mutation-fixture check, 376 prefix/byte-mutation checks, 4 extra/concatenated-frame checks, 48 malformed-header checks, 10 known-kind checks, 7 encoder/bounds checks and 2 oversized-frame checks. Reconcile the count if reviewed source changes. This test does not create/delete files, make HTTP requests or read an account.

- [ ] Record separately: native result, compiler result, source/binary identity, test-terminal identity/settings, and local TS regression. No C++ conversion, TS reimplementation or source inspection may be labelled native MQL5 execution. Do not mark Stage 3B complete: only this codec subcheckpoint is tested.

## Dependent checkpoint: 3B2 persistence/state/outbox — not yet executable

The [3B2 persistence design](../specs/2026-09-03-mt5-telemetry-persistence-design.md) now expands the storage/recovery decisions and is awaiting written-design review before the executable code/test plan. The parent 3B requirements remain mandatory; none are waived by this split. These are design/acceptance constraints, not source implementation tasks in this document:

1. **Ownership and paths.** Session-held exclusive handle in a versioned shared-files namespace keyed by a hash of the configured installation identity, so duplicate terminals on the same Windows user cannot both write. No sharing flags; no timer-based lock stealing or deleting a lock because a heartbeat is old. Failure to acquire is blocked, not evidence that a registration is absent. Release the handle at shutdown; abnormal-process recovery depends on the OS releasing ownership. The shared directory is local, not cloud storage. This cannot enforce ownership across different Windows users or machines; the rollout must forbid cloning the identity across hosts. Validate actual two-terminal behavior. [MetaQuotes sharing rules](https://www.mql5.com/en/book/common/files/files_open_close).
2. **Registration and recovery.** Immutable identity, baseline, broker/UTC cutover, excluded boundary IDs and source schema must be committed together before starting tracking. Explicit first initialization is separate from loading existing state. Missing/corrupt/ambiguous state freezes capture/send and preserves evidence. No automatic new tracking ID or guessed remote registration state.
3. **Commit protocol.** Write uniquely named generation records, verify counts, flush/close/reopen/read back, and validate hashes before publishing a checksummed commit/checkpoint that references the complete set. Recovery validates referenced frames, typed payloads and monotonic relationships, not just the newest filename. A corrupt committed generation must not silently fall back and forget possibly sent/ACKed data. Preserve uncertain generations and return recovery-required when intent cannot be proven. The framing footer means only byte integrity. [FileFlush](https://www.mql5.com/en/docs/files/fileflush) returns no value; do not code a boolean success test. [FileMove](https://www.mql5.com/en/docs/files/filemove) does not document crash-atomic replacement; rename alone is not a durability proof. Explicitly limit claims about OS/power-loss durability and test reopen/process-interruption behavior.
4. **Event/outbox transaction.** Assign the next event sequence with its durable append/checkpoint. Persist exact pending request bytes and their event range before sending. Keep pending bytes frozen while delivery is uncertain, even if new events/snapshots arrive. New events can queue without mutating the request. After remote acceptance but before a local ACK commit, restart resends the same bytes. Only validated, correlated response data may propose an ACK; commit the ACK/checkpoint before compaction and retain anything not covered. Account mismatch freezes all pending work.
5. **Bounds, quarantine and tests.** Set total disk/index/event budgets, reserve space for error/checkpoint records, and define visible recovery/quarantine behavior without dropping unacknowledged data or logging private payloads. Inject partial writes, absent/unreadable files, flush/close/reopen failure, disk-full, conflicting generations, crash at every publish/ACK/compaction boundary, stale owner, duplicate terminal and account switch. No network/broker calls in the deterministic harness. The file adapter uses a dedicated disposable test namespace, never v1 `local/config.ini` or `journal/sync-state.ini`.

3C history capture and 3D wire/lifecycle integration remain subsequent plans. The current 15-second reporting loop, Worker, free-plan quota configuration, chart alerts and working EA are unchanged. Local record work does not enable trades or address signal-to-order latency; that is outside this read-only telemetry feature.

## Inline plan review and handoff

- [x] Scope: only 3B1 has complete implementation/test code. All remaining 3B requirements are explicitly mapped to the dependent checkpoint, not claimed implemented.
- [x] Predecessor: use verified `Tov2Counter` / `Tov2CounterFromText`; preserve values source/hash and existing receiver contracts.
- [x] Format: length bound before allocation, checksum includes metadata and raw bytes, footer has fixed 73-byte length, no implicit text encoding, strict total length and cleared failed outputs.
- [x] Tests: independent golden digests, all truncation prefixes and one-bit mutations of the small frame, checksum-valid malformed headers, maximum payload, oversized payload, invalid generation, extra bytes and concatenation.
- [x] No success overclaim: source/vector tests are not MQL5 execution; valid frames are not committed transactions; no 3B completion/deployment claim.
- [x] Source steps contain complete code; all referenced helper interfaces are defined above or in the verified values include.
- [x] User approved subagent-driven implementation with separate reviews on 2026-09-03 (“ok lets do it”).

Planning validation (historical): three golden header/payload digests and total lengths were calculated independently with Node from this contract; they match the literals above. The fenced TypeScript test had zero syntax diagnostics from the installed TypeScript parser; that was not a test run or full typecheck. Inline planning review added canonical-header reconstruction and a checksum-valid trailing-separator rejection case to avoid depending on how `StringSplit` treats a trailing empty field. No proposed MQL5 code was compiled or run during planning. Local implementation/regression and the subsequent user-reported native result are recorded above. Independent native artifact verification remains incomplete; fault-injected file recovery is not implemented or executed.
