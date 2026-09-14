# MT5 telemetry persistence — local-format code appendix

This appendix is documentation, not installed source. It contains the first isolated local-format checkpoint, not the complete Stage 3B2 implementation. Code is proposed for the new codec and synthetic tests only. It has not been compiled by MetaEditor. The [companion plan](2026-09-03-mt5-telemetry-ea-persistence.md) determines execution and evidence gates; copying these blocks into the active EA is not authorized.

## Local format decision

Use canonical ASCII LF-delimited fields inside the existing checksummed `TOV2R1` envelope. A local reference is `kind,generation,ordinal,file_sha256,sequence,event_id,record_sha256,deal_id,revision`. `-` means not applicable. References contain no paths. Registration is generation 1, ordinal 0; other object ordinals are positive. State/commit ordinals are 0. Event IDs use the existing restricted identifier alphabet; commas/newlines cannot occur.

The local state schema is `TOV2S1`. The fields, in order, are generation, parent generation, parent commit digest (or `-` initially), identity, registration reference, produced event, accepted request, accepted event, capture reference, capture schema, completeness, pending reference or `-`, pending request, pending body digest or `-`, pending prior ACK, pending final ACK, selected count, frozen produced count, latest ACK reference or `-`, ACK request, ACK body digest or `-`, ACK pending full-file digest or `-`, accepted UTC seconds, ACK event, event count, last error, followed by that many ordered event-reference lines. Every field has a final LF. Optional pending/ACK metadata must be all-zero/`-` when absent. A manifest describes one complete recovery root; it is not a mutable log.

Identity is `account~installation~tracking~safety_epoch~profile_sha256~fingerprint_sha256~boundary_sha256`. Values cannot contain `~`. Production registration/capture/wire adapters must validate these against the exact stored payloads; local syntax validation is not JSON/account attestation.

Commit schema is `TOV2C1`, then generation, parent generation, parent commit digest or `-`, registration full-file digest, state full-file digest, transition name; each LF terminated. Allowed transition names: INIT, APPEND, PREPARE, ACK, REPLACE, CHECKPOINT, DIAGNOSTIC. Capture payload schema belongs to its adapter; a CHECKPOINT capture object is never interpreted as a state or commit.

Retirement authorization is derived from verified historical commit/manifest pairs and their exact references. It must not be inferred from a filename alone. Physical inventory and recovery/compaction algorithms are separate from this codec.

## A. `mt5/TradeOpsAgent/Include/TradeOpsTelemetryStorageCodec.mqh`

~~~cpp
#ifndef TRADEOPS_TELEMETRY_STORAGE_CODEC_MQH
#define TRADEOPS_TELEMETRY_STORAGE_CODEC_MQH
#include "TradeOpsTelemetryRecord.mqh"

const long TOV2_LOCAL_MAX_COUNTER=9007199254740991;
const int TOV2_LOCAL_EVENTS=512;
const int TOV2_LOCAL_BATCH=32;

string Tov2LocalNumber(const long value)
{
   return StringFormat("%I64d",value);
}

bool Tov2LocalBytes(const string text,uchar &result[])
{
   ArrayResize(result,0);
   int n=StringLen(text);
   if(n<1 || n>TOV2_RECORD_PAYLOAD_MAX) return false;
   uchar candidate[];
   if(ArrayResize(candidate,n)!=n) return false;
   for(int i=0;i<n;i++)
   {
      ushort c=StringGetCharacter(text,i);
      if(c!=10 && (c<32 || c>126)) return false;
      candidate[i]=(uchar)c;
   }
   if(ArrayResize(result,n)!=n || ArrayCopy(result,candidate,0,0,n)!=n)
   {
      ArrayResize(result,0);
      return false;
   }
   return true;
}

bool Tov2LocalText(const uchar &bytes[],string &result)
{
   result="";
   int n=ArraySize(bytes);
   if(n<1 || n>TOV2_RECORD_PAYLOAD_MAX) return false;
   string candidate="";
   if(!StringInit(candidate,n,32) || StringLen(candidate)!=n) return false;
   for(int i=0;i<n;i++)
   {
      uchar c=bytes[i];
      if(c!=10 && (c<32 || c>126)) return false;
      if(!StringSetCharacter(candidate,i,c)) return false;
   }
   result=candidate;
   return StringLen(result)==n;
}

bool Tov2LocalHash(const uchar &bytes[],string &result)
{
   result="";
   int n=ArraySize(bytes);
   if(n<1 || n>TOV2_RECORD_FRAME_MAX) return false;
   uchar key[],digest[];
   if(CryptEncode(CRYPT_HASH_SHA256,bytes,key,digest)!=32 ||
      ArraySize(digest)!=32) return false;
   string candidate="";
   for(int i=0;i<32;i++) candidate+=StringFormat("%02x",digest[i]);
   if(!Tov2Digest(candidate)) return false;
   result=candidate;
   return true;
}

bool Tov2LocalEqual(const uchar &a[],const uchar &b[])
{
   if(ArraySize(a)!=ArraySize(b)) return false;
   for(int i=0;i<ArraySize(a);i++) if(a[i]!=b[i]) return false;
   return true;
}

bool Tov2LocalCopy(const uchar &source[],uchar &destination[])
{
   ArrayResize(destination,0);
   int n=ArraySize(source);
   if(n<0 || n>TOV2_RECORD_FRAME_MAX) return false;
   if(n==0) return true;
   if(ArrayResize(destination,n)!=n ||
      ArrayCopy(destination,source,0,0,n)!=n)
   {
      ArrayResize(destination,0);
      return false;
   }
   return true;
}

bool Tov2LocalIdentity(const string text,string &installation)
{
   installation="";
   string f[];
   if(StringSplit(text,126,f)!=7) return false;
   long epoch=0;
   if(!Tov2Identifier(f[0]) || !Tov2Identifier(f[1]) ||
      !Tov2Identifier(f[2]) || !Tov2CounterFromText(f[3],0,epoch) ||
      !Tov2Digest(f[4]) || !Tov2Digest(f[5]) || !Tov2Digest(f[6])) return false;
   installation=f[1];
   return true;
}

bool Tov2LocalInstallationKey(const string installation,string &key)
{
   key="";
   if(!Tov2Identifier(installation)) return false;
   string preimage="TOV2-INSTALL|"+installation;
   if(StringLen(preimage)!=13+StringLen(installation)) return false;
   uchar bytes[];
   return Tov2LocalBytes(preimage,bytes) &&
          Tov2LocalHash(bytes,key);
}

struct Tov2LocalRef
{
   string kind;
   long generation;
   long ordinal;
   string sha;
   long sequence;
   string event_id;
   string record_sha;
   string deal_id;
   long revision;
};

void Tov2LocalClearRef(Tov2LocalRef &r)
{
   r.kind="-"; r.generation=0; r.ordinal=0; r.sha="-";
   r.sequence=0; r.event_id="-"; r.record_sha="-"; r.deal_id="-"; r.revision=0;
}

bool Tov2LocalEmptyRef(const Tov2LocalRef &r)
{
   return r.kind=="-" && r.generation==0 && r.ordinal==0 && r.sha=="-" &&
      r.sequence==0 && r.event_id=="-" && r.record_sha=="-" && r.deal_id=="-" &&
      r.revision==0;
}

bool Tov2LocalRefValid(const Tov2LocalRef &r)
{
   if(!Tov2Counter(r.generation,1) || !Tov2Counter(r.ordinal) ||
      !Tov2Digest(r.sha) || !Tov2Counter(r.sequence) ||
      !Tov2Counter(r.revision)) return false;
   if(r.kind!="REGISTRATION" && r.kind!="EVENT" && r.kind!="PENDING" &&
      r.kind!="ACK" && r.kind!="CAPTURE" && r.kind!="STATE" &&
      r.kind!="COMMIT") return false;
   if(r.kind=="REGISTRATION")
   {
      if(r.generation!=1 || r.ordinal!=0) return false;
   }
   else if(r.kind=="STATE" || r.kind=="COMMIT")
   {
      if(r.ordinal!=0) return false;
   }
   else if(r.ordinal<1) return false;
   if(r.kind=="EVENT")
   {
      if(r.sequence<1 || !Tov2Identifier(r.event_id) || !Tov2Digest(r.record_sha))
         return false;
      if(r.deal_id=="-") return r.revision==0;
      return Tov2Ticket(r.deal_id) && r.revision>=1;
   }
   if((r.kind=="PENDING" || r.kind=="ACK") && r.sequence<1) return false;
   if(r.kind!="PENDING" && r.kind!="ACK" && r.sequence!=0) return false;
   return r.event_id=="-" && r.record_sha=="-" && r.deal_id=="-" && r.revision==0;
}

string Tov2LocalRefText(const Tov2LocalRef &r)
{
   if(!Tov2LocalRefValid(r)) return "";
   string text=r.kind+","+Tov2LocalNumber(r.generation)+","+
      Tov2LocalNumber(r.ordinal)+","+r.sha+","+
      Tov2LocalNumber(r.sequence)+","+r.event_id+","+
      r.record_sha+","+r.deal_id+","+Tov2LocalNumber(r.revision);
   int expected=8+StringLen(r.kind)+StringLen(Tov2LocalNumber(r.generation))+
      StringLen(Tov2LocalNumber(r.ordinal))+StringLen(r.sha)+
      StringLen(Tov2LocalNumber(r.sequence))+StringLen(r.event_id)+
      StringLen(r.record_sha)+StringLen(r.deal_id)+StringLen(Tov2LocalNumber(r.revision));
   return StringLen(text)==expected ? text : "";
}

bool Tov2LocalParseRef(const string text,Tov2LocalRef &result)
{
   Tov2LocalClearRef(result);
   string f[];
   if(StringSplit(text,44,f)!=9) return false;
   Tov2LocalRef r; Tov2LocalClearRef(r);
   r.kind=f[0]; r.sha=f[3]; r.event_id=f[5]; r.record_sha=f[6]; r.deal_id=f[7];
   if(!Tov2CounterFromText(f[1],1,r.generation) ||
      !Tov2CounterFromText(f[2],0,r.ordinal) ||
      !Tov2CounterFromText(f[4],0,r.sequence) ||
      !Tov2CounterFromText(f[8],0,r.revision) || !Tov2LocalRefValid(r) ||
      Tov2LocalRefText(r)!=text) return false;
   result=r;
   return true;
}

string Tov2LocalRefPath(const Tov2LocalRef &r)
{
   if(!Tov2LocalRefValid(r)) return "";
   if(r.kind=="REGISTRATION") return "registration.rec";
   if(r.kind=="STATE") return "states/"+Tov2LocalNumber(r.generation)+".rec";
   if(r.kind=="COMMIT") return "commits/"+Tov2LocalNumber(r.generation)+".rec";
   return "objects/"+Tov2LocalNumber(r.generation)+"-"+
      Tov2LocalNumber(r.ordinal)+".rec";
}

string Tov2LocalEnvelopeKind(const string kind)
{
   if(kind=="CAPTURE" || kind=="STATE" || kind=="COMMIT") return "CHECKPOINT";
   if(Tov2RecordKind(kind)) return kind;
   return "";
}

bool Tov2LocalFrameMatches(const Tov2LocalRef &r,const uchar &frame[],uchar &payload[])
{
   ArrayResize(payload,0);
   if(!Tov2LocalRefValid(r)) return false;
   string sha="",kind=""; long generation=0; uchar candidate[];
   if(!Tov2LocalHash(frame,sha) || sha!=r.sha ||
      !Tov2RecordDecode(frame,kind,generation,candidate) ||
      kind!=Tov2LocalEnvelopeKind(r.kind) || generation!=r.generation) return false;
   return Tov2LocalCopy(candidate,payload);
}

struct Tov2LocalState
{
   long generation;
   long parent_generation;
   string parent_commit;
   string identity;
   Tov2LocalRef registration;
   long produced;
   long accepted_request;
   long accepted_event;
   Tov2LocalRef capture;
   string capture_schema;
   string completeness;
   Tov2LocalRef pending;
   long pending_request;
   string pending_body;
   long pending_prior;
   long pending_final;
   int pending_count;
   long pending_produced;
   Tov2LocalRef ack;
   long ack_request;
   string ack_body;
   string ack_pending_sha;
   long accepted_at;
   long ack_event;
   int event_count;
   string last_error;
   Tov2LocalRef events[512];
};

void Tov2LocalClearState(Tov2LocalState &s)
{
   s.generation=0; s.parent_generation=0; s.parent_commit="-"; s.identity="";
   Tov2LocalClearRef(s.registration);
   s.produced=0; s.accepted_request=0; s.accepted_event=0;
   Tov2LocalClearRef(s.capture);
   s.capture_schema=""; s.completeness="NOT_STARTED";
   Tov2LocalClearRef(s.pending);
   s.pending_request=0; s.pending_body="-"; s.pending_prior=0;
   s.pending_final=0; s.pending_count=0; s.pending_produced=0;
   Tov2LocalClearRef(s.ack);
   s.ack_request=0; s.ack_body="-"; s.ack_pending_sha="-";
   s.accepted_at=0; s.ack_event=0; s.event_count=0; s.last_error="NONE";
   for(int i=0;i<512;i++) Tov2LocalClearRef(s.events[i]);
}

bool Tov2LocalCompleteness(const string value)
{
   return value=="CATCHING_UP" || value=="RECONCILIATION_REQUIRED" ||
      value=="DATA_MISSING" || value=="UP_TO_DATE";
}

bool Tov2LocalError(const string value)
{
   return value=="NONE" || value=="OUTBOX_CORRUPT" || value=="DISK_FULL" ||
      value=="UNSUPPORTED_SCHEMA" || value=="OWNERSHIP_LOST" ||
      value=="IDENTITY_MISMATCH" || value=="IO_ERROR" ||
      value=="ALLOCATION_FAILED" || value=="COUNTER_EXHAUSTED" ||
      value=="RECONCILIATION_REQUIRED" || value=="CAPTURE_FAILED" ||
      value=="HISTORY_UNAVAILABLE" || value=="CLOCK_DISCONTINUITY" ||
      value=="UNSUPPORTED_RECORD";
}

bool Tov2LocalStateValid(const Tov2LocalState &s)
{
   string installation="";
   if(!Tov2Counter(s.generation,1) || !Tov2Counter(s.parent_generation) ||
      !Tov2LocalIdentity(s.identity,installation) ||
      !Tov2LocalRefValid(s.registration) || s.registration.kind!="REGISTRATION" ||
      !Tov2LocalRefValid(s.capture) || s.capture.kind!="CAPTURE" ||
      s.capture.generation>s.generation || !Tov2Identifier(s.capture_schema) ||
      !Tov2LocalCompleteness(s.completeness) || !Tov2LocalError(s.last_error)) return false;
   if(s.completeness=="UP_TO_DATE" && s.last_error!="NONE") return false;
   if(s.completeness=="DATA_MISSING" && s.last_error=="NONE") return false;
   if(s.completeness=="RECONCILIATION_REQUIRED" &&
      s.last_error!="RECONCILIATION_REQUIRED") return false;
   if(s.generation==1)
   {
      if(s.parent_generation!=0 || s.parent_commit!="-") return false;
      if(s.produced!=0 || s.accepted_request!=0 || s.accepted_event!=0 ||
         s.pending.kind!="-" || s.ack.kind!="-") return false;
   }
   else if(s.parent_generation<1 || s.parent_generation>=s.generation ||
           !Tov2Digest(s.parent_commit)) return false;
   if(!Tov2Counter(s.produced) || !Tov2Counter(s.accepted_request) ||
      !Tov2Counter(s.accepted_event) || s.accepted_event>s.produced ||
      s.event_count<0 || s.event_count>512 ||
      s.produced-s.accepted_event!=s.event_count) return false;
   for(int i=0;i<s.event_count;i++)
   {
      if(!Tov2LocalRefValid(s.events[i]) || s.events[i].kind!="EVENT" ||
         s.events[i].generation>s.generation ||
         s.events[i].sequence!=s.accepted_event+1+i) return false;
      string event_path=Tov2LocalRefPath(s.events[i]);
      if(event_path==Tov2LocalRefPath(s.capture) ||
         event_path==Tov2LocalRefPath(s.pending) ||
         event_path==Tov2LocalRefPath(s.ack)) return false;
      for(int j=0;j<i;j++)
      {
         if(Tov2LocalRefPath(s.events[i])==Tov2LocalRefPath(s.events[j]) ||
            s.events[i].event_id==s.events[j].event_id) return false;
         if(s.events[i].deal_id!="-" && s.events[i].deal_id==s.events[j].deal_id &&
            s.events[i].revision==s.events[j].revision) return false;
      }
   }
   if(s.pending.kind=="-")
   {
      if(!Tov2LocalEmptyRef(s.pending) || s.pending_request!=0 || s.pending_body!="-" || s.pending_prior!=0 ||
         s.pending_final!=0 || s.pending_count!=0 || s.pending_produced!=0) return false;
   }
   else
   {
      if(!Tov2LocalRefValid(s.pending) || s.pending.kind!="PENDING" ||
         s.pending.generation>s.generation || s.accepted_request==TOV2_LOCAL_MAX_COUNTER ||
         s.pending_request!=s.accepted_request+1 ||
         s.pending.sequence!=s.pending_request || !Tov2Digest(s.pending_body) ||
         s.pending_prior!=s.accepted_event || s.pending_count<0 ||
         s.pending_count>32 || s.pending_count>s.event_count ||
         s.pending_final!=s.accepted_event+s.pending_count ||
         !Tov2Counter(s.pending_produced) || s.pending_produced<s.pending_final ||
         s.pending_produced>s.produced) return false;
      for(int i=0;i<s.pending_count;i++)
         for(int j=0;j<i;j++)
            if(s.events[i].deal_id!="-" && s.events[i].deal_id==s.events[j].deal_id)
               return false;
   }
   if(s.ack.kind=="-")
   {
      if(!Tov2LocalEmptyRef(s.ack) || s.accepted_request!=0 || s.accepted_event!=0 ||
         s.ack_request!=0 || s.ack_body!="-" || s.ack_pending_sha!="-" ||
         s.accepted_at!=0 || s.ack_event!=0) return false;
   }
   else if(!Tov2LocalRefValid(s.ack) || s.ack.kind!="ACK" ||
           s.ack.generation>s.generation || s.ack_request!=s.accepted_request ||
           s.ack.sequence!=s.ack_request || !Tov2Digest(s.ack_body) ||
           !Tov2Digest(s.ack_pending_sha) || !Tov2Counter(s.accepted_at,1) ||
           s.ack_event!=s.accepted_event) return false;
   if(s.completeness=="UP_TO_DATE" && (s.event_count!=0 || s.pending.kind!="-"))
      return false;
   string capture_path=Tov2LocalRefPath(s.capture);
   if(capture_path==Tov2LocalRefPath(s.pending) || capture_path==Tov2LocalRefPath(s.ack))
      return false;
   if(s.pending.kind!="-" && s.ack.kind!="-" &&
      Tov2LocalRefPath(s.pending)==Tov2LocalRefPath(s.ack)) return false;
   return true;
}

string Tov2LocalOptionalRef(const Tov2LocalRef &r)
{
   return Tov2LocalEmptyRef(r) ? "-" : Tov2LocalRefText(r);
}

bool Tov2LocalLines(const string &fields[],uchar &payload[])
{
   ArrayResize(payload,0);
   string text="";
   int total=0;
   ResetLastError();
   for(int i=0;i<ArraySize(fields);i++)
   {
      int n=StringLen(fields[i]);
      if(n<1 || StringFind(fields[i],"\n")>=0 ||
         n>TOV2_RECORD_PAYLOAD_MAX-total-1) return false;
      total+=n+1;
      text+=fields[i]+"\n";
      if(StringLen(text)!=total || GetLastError()!=0) return false;
   }
   return Tov2LocalBytes(text,payload);
}

bool Tov2LocalStateEncode(const Tov2LocalState &s,uchar &payload[])
{
   ArrayResize(payload,0);
   if(!Tov2LocalStateValid(s)) return false;
   string f[];
   ResetLastError();
   if(ArrayResize(f,27+s.event_count)!=27+s.event_count) return false;
   f[0]="TOV2S1"; f[1]=Tov2LocalNumber(s.generation);
   f[2]=Tov2LocalNumber(s.parent_generation); f[3]=s.parent_commit; f[4]=s.identity;
   f[5]=Tov2LocalRefText(s.registration); f[6]=Tov2LocalNumber(s.produced);
   f[7]=Tov2LocalNumber(s.accepted_request); f[8]=Tov2LocalNumber(s.accepted_event);
   f[9]=Tov2LocalRefText(s.capture); f[10]=s.capture_schema; f[11]=s.completeness;
   f[12]=Tov2LocalOptionalRef(s.pending); f[13]=Tov2LocalNumber(s.pending_request);
   f[14]=s.pending_body; f[15]=Tov2LocalNumber(s.pending_prior);
   f[16]=Tov2LocalNumber(s.pending_final); f[17]=IntegerToString(s.pending_count);
   f[18]=Tov2LocalNumber(s.pending_produced); f[19]=Tov2LocalOptionalRef(s.ack);
   f[20]=Tov2LocalNumber(s.ack_request); f[21]=s.ack_body; f[22]=s.ack_pending_sha;
   f[23]=Tov2LocalNumber(s.accepted_at); f[24]=Tov2LocalNumber(s.ack_event);
   f[25]=IntegerToString(s.event_count);
   f[26]=s.last_error;
   for(int i=0;i<s.event_count;i++) f[27+i]=Tov2LocalRefText(s.events[i]);
   if(GetLastError()!=0) return false;
   return Tov2LocalLines(f,payload);
}

bool Tov2LocalStateDecode(const uchar &payload[],Tov2LocalState &result)
{
   Tov2LocalClearState(result);
   string text="",f[];
   if(!Tov2LocalText(payload,text) || StringGetCharacter(text,StringLen(text)-1)!=10)
      return false;
   // Strip the one trailing delimiter explicitly; do not rely on terminal split conventions.
   string body=StringSubstr(text,0,StringLen(text)-1);
   int fields=StringSplit(body,10,f);
   if(fields<27 || f[0]!="TOV2S1") return false;
   Tov2LocalState s; Tov2LocalClearState(s);
   long pending_count=0,event_count=0;
   if(!Tov2CounterFromText(f[1],1,s.generation) ||
      !Tov2CounterFromText(f[2],0,s.parent_generation) ||
      !Tov2LocalParseRef(f[5],s.registration) ||
      !Tov2CounterFromText(f[6],0,s.produced) ||
      !Tov2CounterFromText(f[7],0,s.accepted_request) ||
      !Tov2CounterFromText(f[8],0,s.accepted_event) ||
      !Tov2LocalParseRef(f[9],s.capture) ||
      !Tov2CounterFromText(f[13],0,s.pending_request) ||
      !Tov2CounterFromText(f[15],0,s.pending_prior) ||
      !Tov2CounterFromText(f[16],0,s.pending_final) ||
      !Tov2CounterFromText(f[17],0,pending_count) ||
      !Tov2CounterFromText(f[18],0,s.pending_produced) ||
      !Tov2CounterFromText(f[20],0,s.ack_request) ||
      !Tov2CounterFromText(f[23],0,s.accepted_at) ||
      !Tov2CounterFromText(f[24],0,s.ack_event) ||
      !Tov2CounterFromText(f[25],0,event_count) ||
      pending_count>32 || event_count>512 || fields!=27+(int)event_count) return false;
   s.parent_commit=f[3]; s.identity=f[4]; s.capture_schema=f[10];
   s.completeness=f[11]; s.pending_body=f[14]; s.ack_body=f[21];
   s.ack_pending_sha=f[22]; s.pending_count=(int)pending_count; s.event_count=(int)event_count;
   s.last_error=f[26];
   if(f[12]!="-" && !Tov2LocalParseRef(f[12],s.pending)) return false;
   if(f[19]!="-" && !Tov2LocalParseRef(f[19],s.ack)) return false;
   for(int i=0;i<s.event_count;i++)
      if(!Tov2LocalParseRef(f[27+i],s.events[i])) return false;
   uchar canonical[];
   if(!Tov2LocalStateEncode(s,canonical) || !Tov2LocalEqual(payload,canonical)) return false;
   ResetLastError();
   result=s;
   if(GetLastError()!=0) { Tov2LocalClearState(result); return false; }
   return true;
}

struct Tov2LocalCommit
{
   long generation;
   long parent_generation;
   string parent_sha;
   string registration_sha;
   string state_sha;
   string transition;
};

void Tov2LocalClearCommit(Tov2LocalCommit &c)
{
   c.generation=0; c.parent_generation=0; c.parent_sha="-";
   c.registration_sha=""; c.state_sha=""; c.transition="";
}

bool Tov2LocalTransition(const string value)
{
   return value=="INIT" || value=="APPEND" || value=="PREPARE" ||
      value=="ACK" || value=="REPLACE" || value=="CHECKPOINT" || value=="DIAGNOSTIC";
}

bool Tov2LocalCommitEncode(const Tov2LocalCommit &c,uchar &payload[])
{
   ArrayResize(payload,0);
   if(!Tov2Counter(c.generation,1) || !Tov2Counter(c.parent_generation) ||
      !Tov2Digest(c.registration_sha) || !Tov2Digest(c.state_sha) ||
      !Tov2LocalTransition(c.transition)) return false;
   if(c.transition=="INIT")
   {
      if(c.generation!=1 || c.parent_generation!=0 || c.parent_sha!="-") return false;
   }
   else if(c.generation<=1 || c.parent_generation<1 ||
           c.parent_generation>=c.generation || !Tov2Digest(c.parent_sha)) return false;
   string f[];
   ResetLastError();
   if(ArrayResize(f,7)!=7) return false;
   f[0]="TOV2C1"; f[1]=Tov2LocalNumber(c.generation);
   f[2]=Tov2LocalNumber(c.parent_generation); f[3]=c.parent_sha;
   f[4]=c.registration_sha; f[5]=c.state_sha; f[6]=c.transition;
   if(GetLastError()!=0) return false;
   return Tov2LocalLines(f,payload);
}

bool Tov2LocalCommitDecode(const uchar &payload[],Tov2LocalCommit &result)
{
   Tov2LocalClearCommit(result);
   string text="",f[];
   if(!Tov2LocalText(payload,text) || StringGetCharacter(text,StringLen(text)-1)!=10)
      return false;
   if(StringSplit(StringSubstr(text,0,StringLen(text)-1),10,f)!=7 ||
      f[0]!="TOV2C1") return false;
   Tov2LocalCommit c; Tov2LocalClearCommit(c);
   if(!Tov2CounterFromText(f[1],1,c.generation) ||
      !Tov2CounterFromText(f[2],0,c.parent_generation)) return false;
   c.parent_sha=f[3]; c.registration_sha=f[4]; c.state_sha=f[5]; c.transition=f[6];
   uchar canonical[];
   if(!Tov2LocalCommitEncode(c,canonical) || !Tov2LocalEqual(payload,canonical)) return false;
   ResetLastError();
   result=c;
   if(GetLastError()!=0) { Tov2LocalClearCommit(result); return false; }
   return true;
}
#endif
~~~

## B. `mt5/TradeOpsAgent/Scripts/TradeOpsTelemetryStorageCodecSelfTest.mq5`

This is a pure synthetic test. It does not create files, enumerate accounts, use a clock, send network requests, or place trades. It is not the later native storage/locking test.

~~~cpp
#property strict
#property version "1.000"
#property description "Offline synthetic local telemetry metadata format tests"
#include "../Include/TradeOpsTelemetryStorageCodec.mqh"

int tov2_local_checks=0;
int tov2_local_failures=0;

void Check(const bool ok,const string label)
{
   tov2_local_checks++;
   if(!ok)
   {
      tov2_local_failures++;
      Print("TOV2_STORAGE_CODEC_FAILURE ",label);
   }
}

string Repeat(const string value,const int count)
{
   string result="";
   for(int i=0;i<count;i++) result+=value;
   return result;
}

void Ref(Tov2LocalRef &r,const string kind,const long generation,const long ordinal,
         const string sha,const long sequence=0,const string event_id="-",
         const string record_sha="-",const string deal_id="-",const long revision=0)
{
   Tov2LocalClearRef(r);
   r.kind=kind; r.generation=generation; r.ordinal=ordinal; r.sha=sha;
   r.sequence=sequence; r.event_id=event_id; r.record_sha=record_sha;
   r.deal_id=deal_id; r.revision=revision;
}

void Initial(Tov2LocalState &s)
{
   Tov2LocalClearState(s);
   s.generation=1;
   s.identity="account.demo~install.demo~tracking.demo~1~"+
      Repeat("d",64)+"~"+Repeat("e",64)+"~"+Repeat("f",64);
   Ref(s.registration,"REGISTRATION",1,0,Repeat("a",64));
   Ref(s.capture,"CAPTURE",1,1,Repeat("b",64));
   s.capture_schema="synthetic.capture.1";
   s.completeness="CATCHING_UP";
}

void Pending(Tov2LocalState &s)
{
   Initial(s);
   s.generation=3; s.parent_generation=2; s.parent_commit=Repeat("c",64);
   s.produced=2; s.event_count=2;
   Ref(s.capture,"CAPTURE",2,3,Repeat("b",64));
   Ref(s.events[0],"EVENT",2,1,Repeat("1",64),1,"event.1",Repeat("2",64),"42",1);
   Ref(s.events[1],"EVENT",2,2,Repeat("3",64),2,"event.2",Repeat("4",64),"43",1);
   Ref(s.pending,"PENDING",3,1,Repeat("5",64),1);
   s.pending_request=1; s.pending_body=Repeat("6",64); s.pending_prior=0;
   s.pending_final=2; s.pending_count=2; s.pending_produced=2;
}

void ClearPending(Tov2LocalState &s)
{
   Tov2LocalClearRef(s.pending); s.pending_request=0; s.pending_body="-";
   s.pending_prior=0; s.pending_final=0; s.pending_count=0; s.pending_produced=0;
}

void Accepted(Tov2LocalState &s)
{
   Pending(s);
   s.generation=4; s.parent_generation=3;
   s.accepted_request=1; s.accepted_event=2; s.event_count=0;
   ClearPending(s);
   Ref(s.ack,"ACK",4,1,Repeat("7",64),1);
   s.ack_request=1; s.ack_body=Repeat("6",64); s.ack_pending_sha=Repeat("5",64);
   s.accepted_at=1770000000; s.ack_event=2;
}

void Golden(const string name,const long generation,const uchar &payload[],
            const string payload_sha,const int payload_size,
            const string frame_sha,const int frame_size)
{
   string actual=""; uchar frame[],decoded[]; string kind=""; long gen=0;
   Check(ArraySize(payload)==payload_size,name+".payload_size");
   Check(Tov2LocalHash(payload,actual) && actual==payload_sha,name+".payload_sha");
   Check(Tov2RecordEncode("CHECKPOINT",generation,payload,frame),name+".encode");
   Check(ArraySize(frame)==frame_size,name+".frame_size");
   Check(Tov2LocalHash(frame,actual) && actual==frame_sha,name+".frame_sha");
   Check(actual!=payload_sha,name+".hash_domains");
   Check(Tov2RecordDecode(frame,kind,gen,decoded) && kind=="CHECKPOINT" &&
         gen==generation && Tov2LocalEqual(payload,decoded),name+".round_trip");
}

void RejectStateText(const string text,const string label)
{
   uchar bytes[];
   Check(Tov2LocalBytes(text,bytes),label+".fixture");
   Tov2LocalState out; Pending(out);
   Check(!Tov2LocalStateDecode(bytes,out),label+".reject");
   Check(out.generation==0 && out.identity=="" && out.event_count==0 &&
         Tov2LocalEmptyRef(out.pending) && Tov2LocalEmptyRef(out.ack),label+".clear");
}

void RejectState(const Tov2LocalState &s,const string label)
{
   uchar out[]; ArrayResize(out,1); out[0]=99;
   Check(!Tov2LocalStateEncode(s,out) && ArraySize(out)==0,label);
}

void ReplaceStateField(const uchar &payload[],const int field,const string value,
                       const string label)
{
   string text="",fields[];
   Check(Tov2LocalText(payload,text),label+".source");
   int n=StringSplit(StringSubstr(text,0,StringLen(text)-1),10,fields);
   Check(field>=0 && field<n,label+".index");
   if(field<0 || field>=n) return;
   fields[field]=value;
   string changed="";
   for(int i=0;i<n;i++) changed+=fields[i]+"\n";
   RejectStateText(changed,label);
}

void OnStart()
{
   Tov2LocalState s,out;
   uchar payload[],initial_bytes[],pending_bytes[],frame[],decoded[];
   string text="",sha="",installation="";
   Initial(s);
   Check(Tov2LocalStateEncode(s,payload),"initial.encode");
   Check(Tov2LocalCopy(payload,initial_bytes),"initial.copy");
   Golden("INIT_STATE",1,payload,"9bccb02d39c4158b2df2c0ea389afe9f1bfedf69a7a8fa0be2a6dd949a375290",500,"577f01f1a1ccf7c39e567ab0da203efd0edf18002738592931c4b89dc3192706",597);
   Check(Tov2LocalStateDecode(payload,out) && out.identity==s.identity &&
         out.generation==1 && out.event_count==0,"initial.decode");

   Pending(s);
   Check(Tov2LocalStateEncode(s,payload),"pending.encode");
   Check(Tov2LocalCopy(payload,pending_bytes),"pending.copy");
   Golden("PENDING_STATE",3,payload,"7acea604e0f1f7626cd1c700d96c6d694653beb35bce2ee8a96e28c3d003d015",1021,"66746cdcdaa23e1cfa407650e96839403774b285487d6d3e2562314d92656422",1119);
   Check(Tov2LocalStateDecode(payload,out) && out.pending_final==2 &&
         out.pending_count==2 && out.pending_produced==2 &&
         out.events[1].deal_id=="43","pending.decode");
   Check(Tov2RecordEncode("CHECKPOINT",3,payload,frame),"commit.state_frame");
   Check(Tov2LocalHash(frame,sha),"commit.state_hash");

   Tov2LocalCommit c,decoded_commit; Tov2LocalClearCommit(c);
   c.generation=3; c.parent_generation=2; c.parent_sha=Repeat("c",64);
   c.registration_sha=Repeat("a",64); c.state_sha=sha; c.transition="PREPARE";
   Check(Tov2LocalCommitEncode(c,payload),"commit.encode");
   Golden("PREPARE_COMMIT",3,payload,"12b2da5e3ca373549c518d9408e9cec21886aebcfa4ece961e534280ef48f548",214,"dcd76abe3ee40c9d724a53b622a0d8498e1546b12e604354bb2e0456f6d8c157",311);
   Check(Tov2LocalCommitDecode(payload,decoded_commit) &&
         decoded_commit.state_sha==sha && decoded_commit.transition=="PREPARE",
         "commit.decode");
   Check(!Tov2LocalStateDecode(payload,out) && out.generation==0,"commit.not_state");
   Check(!Tov2LocalCommitDecode(initial_bytes,decoded_commit) &&
         decoded_commit.generation==0,"state.not_commit");

   Check(Tov2LocalIdentity(s.identity,installation) && installation=="install.demo",
         "identity.valid");
   string epoch_zero=s.identity; StringReplace(epoch_zero,"~1~","~0~");
   Check(Tov2LocalIdentity(epoch_zero,installation),"identity.zero_epoch_compatible");
   Check(!Tov2LocalIdentity(s.identity+"~extra",installation) && installation=="",
         "identity.extra");
   Check(!Tov2LocalIdentity("a~../escape~t~1~"+Repeat("d",64)+"~"+
         Repeat("e",64)+"~"+Repeat("f",64),installation),"identity.path");
   Check(Tov2LocalInstallationKey("install.demo",sha) &&
         sha=="7246c0eecdeaa9b9a59b59c250e045bcaf47131ab392b31690339362facd7ed0","installation.key");
   Check(!Tov2LocalInstallationKey("../escape",sha) && sha=="","installation.reject");

   Tov2LocalRef r,parsed;
   Ref(r,"EVENT",2,1,Repeat("a",64),1,"event.1",Repeat("b",64),"18446744073709551615",1);
   text=Tov2LocalRefText(r);
   Check(Tov2LocalParseRef(text,parsed) && parsed.deal_id==r.deal_id,"reference.round_trip");
   Check(Tov2LocalRefPath(parsed)=="objects/2-1.rec","reference.path");
   Ref(r,"REGISTRATION",1,0,Repeat("a",64));
   Check(Tov2LocalRefPath(r)=="registration.rec","reference.registration");
   Ref(r,"STATE",12,0,Repeat("a",64));
   Check(Tov2LocalRefPath(r)=="states/12.rec","reference.state");
   Ref(r,"COMMIT",12,0,Repeat("a",64));
   Check(Tov2LocalRefPath(r)=="commits/12.rec","reference.commit");
   Check(!Tov2LocalParseRef("../escape,1,0,"+Repeat("a",64)+",0,-,-,-,0",parsed) &&
         Tov2LocalEmptyRef(parsed),"reference.traversal");
   Check(!Tov2LocalParseRef("STATE,01,0,"+Repeat("a",64)+",0,-,-,-,0",parsed),
         "reference.leading_zero");
   Check(!Tov2LocalParseRef("STATE,9007199254740992,0,"+Repeat("a",64)+",0,-,-,-,0",parsed),
         "reference.counter_overflow");
   Check(!Tov2LocalParseRef("REGISTRATION,2,0,"+Repeat("a",64)+",0,-,-,-,0",parsed),
         "reference.registration_generation");
   Check(!Tov2LocalParseRef("EVENT,2,1,"+Repeat("a",64)+",1,e,"+Repeat("b",64)+",42,0",parsed),
         "reference.deal_revision");

   ReplaceStateField(initial_bytes,0,"TOV2S2","state.unknown_schema");
   ReplaceStateField(initial_bytes,1,"01","state.leading_zero");
   ReplaceStateField(initial_bytes,1,"9007199254740992","state.overflow");
   ReplaceStateField(initial_bytes,10,"schema/new","state.schema_path");
   ReplaceStateField(initial_bytes,11,"GREEN","state.unknown_completeness");
   ReplaceStateField(initial_bytes,26,"RAW_ACCOUNT_PAYLOAD","state.unknown_error");
   ReplaceStateField(initial_bytes,25,"513","state.event_bound");
   ReplaceStateField(initial_bytes,13,"1","state.absent_pending_metadata");
   ReplaceStateField(initial_bytes,20,"1","state.absent_ack_metadata");
   ReplaceStateField(pending_bytes,17,"33","pending.batch_bound");
   ReplaceStateField(pending_bytes,16,"1","pending.partial_ack_target");
   ReplaceStateField(pending_bytes,15,"1","pending.prior");
   ReplaceStateField(pending_bytes,18,"1","pending.frozen_produced");
   ReplaceStateField(pending_bytes,25,"0","state.trailing_events");
   ReplaceStateField(pending_bytes,4,"different~identity","state.identity");
   Check(Tov2LocalText(initial_bytes,text),"text.initial");
   RejectStateText(text+"\n","state.extra_lf");
   RejectStateText(StringSubstr(text,0,StringLen(text)-1),"state.missing_lf");
   string crlf=text; StringReplace(crlf,"\n","\r\n");
   Check(!Tov2LocalBytes(crlf,decoded) && ArraySize(decoded)==0,"state.crlf_rejected");

   Pending(s); s.events[1].sequence=1; RejectState(s,"events.sequence");
   Pending(s); s.events[1].event_id=s.events[0].event_id; RejectState(s,"events.duplicate_id");
   Pending(s); s.events[1].deal_id=s.events[0].deal_id; RejectState(s,"events.duplicate_revision");
   Pending(s); s.events[1].deal_id=s.events[0].deal_id; s.events[1].revision=2;
   RejectState(s,"pending.repeated_deal");
   s.pending_count=1; s.pending_final=1;
   Check(Tov2LocalStateEncode(s,payload),"pending.repeated_deal_prefix");
   Pending(s); s.capture.ordinal=1; RejectState(s,"reference.path_collision");
   Pending(s); s.pending.generation=4; RejectState(s,"reference.future");
   Pending(s); s.completeness="UP_TO_DATE"; RejectState(s,"completeness.unsent");
   Initial(s); s.pending.sha=Repeat("a",64); RejectState(s,"reference.absent_not_cleared");
   Initial(s); s.completeness="DATA_MISSING"; RejectState(s,"error.required_for_gap");
   s.last_error="DISK_FULL";
   Check(Tov2LocalStateEncode(s,payload),"error.named_gap");
   Initial(s); s.completeness="RECONCILIATION_REQUIRED";
   RejectState(s,"error.required_for_reconciliation");
   s.last_error="RECONCILIATION_REQUIRED";
   Check(Tov2LocalStateEncode(s,payload),"error.reconciliation");

   Accepted(s);
   Check(Tov2LocalStateEncode(s,payload),"accepted.valid");
   Check(Tov2LocalStateDecode(payload,out) && out.accepted_event==2 &&
         out.ack_pending_sha==Repeat("5",64),"accepted.decode");
   Ref(s.pending,"PENDING",5,1,Repeat("8",64),2);
   s.generation=5; s.parent_generation=4; s.pending_request=2;
   s.pending_body=Repeat("9",64); s.pending_prior=2; s.pending_final=2;
   s.pending_produced=2; s.pending_count=0;
   Check(Tov2LocalStateEncode(s,payload),"heartbeat.nonzero_prior");
   s.pending_final=0; RejectState(s,"heartbeat.no_ack_reset");
   Accepted(s); s.ack_event=1; RejectState(s,"ack.exact_event");
   Accepted(s); s.ack_request=2; RejectState(s,"ack.exact_request");
   Accepted(s); s.ack_pending_sha="-"; RejectState(s,"ack.pending_association");

   Initial(s); s.generation=2; s.parent_generation=1; s.parent_commit=Repeat("c",64);
   s.capture.generation=2; s.capture.ordinal=513; s.produced=512; s.event_count=512;
   for(int i=0;i<512;i++)
      Ref(s.events[i],"EVENT",2,i+1,Repeat("1",64),i+1,"event."+IntegerToString(i+1),Repeat("2",64));
   Check(Tov2LocalStateEncode(s,payload) && ArraySize(payload)<=262144,"queue.512");
   Check(Tov2LocalStateDecode(payload,out) && out.event_count==512,"queue.512_decode");
   s.produced=513; s.event_count=513; RejectState(s,"queue.513_rejected");
   s.event_count=-1; RejectState(s,"queue.negative_rejected");

   uchar raw[];
   Check(ArrayResize(raw,262345)==262345,"hash.allocate_max");
   ArrayInitialize(raw,165);
   Check(Tov2LocalHash(raw,sha) && sha=="180d5a23cd4e5186392e648c88828250a67da838688cef28d79a1757a77257e5","hash.full_frame_max");
   ArrayResize(raw,262346); sha="sentinel";
   Check(!Tov2LocalHash(raw,sha) && sha=="","hash.oversized_clear");
   ArrayResize(raw,0); sha="sentinel";
   Check(!Tov2LocalHash(raw,sha) && sha=="","hash.empty_clear");
   ArrayResize(raw,3); raw[0]=65; raw[1]=0; raw[2]=255;
   Check(!Tov2LocalText(raw,text) && text=="","text.binary_not_metadata");

   Pending(s);
   Check(Tov2LocalStateEncode(s,payload) &&
         Tov2RecordEncode("CHECKPOINT",3,payload,frame),"match.fixture");
   Check(Tov2LocalHash(frame,sha),"match.hash");
   Ref(r,"STATE",3,0,sha);
   Check(Tov2LocalFrameMatches(r,frame,decoded) &&
         Tov2LocalEqual(payload,decoded),"match.valid");
   r.generation=4;
   Check(!Tov2LocalFrameMatches(r,frame,decoded) && ArraySize(decoded)==0,"match.generation");
   Ref(r,"EVENT",3,1,sha,1,"event.1",Repeat("a",64));
   Check(!Tov2LocalFrameMatches(r,frame,decoded) && ArraySize(decoded)==0,"match.kind");
   Ref(r,"STATE",3,0,Repeat("9",64));
   Check(!Tov2LocalFrameMatches(r,frame,decoded) && ArraySize(decoded)==0,"match.digest");
   Check(Tov2LocalCommitEncode(c,payload),"commit.valid_again");
   Check(Tov2LocalText(payload,text),"commit.text");
   string wrong=text; StringReplace(wrong,"TOV2C1","TOV2C2");
   Check(Tov2LocalBytes(wrong,raw) && !Tov2LocalCommitDecode(raw,decoded_commit) &&
         decoded_commit.generation==0,"commit.schema");
   c.transition="DELETE_ALL";
   Check(!Tov2LocalCommitEncode(c,raw) && ArraySize(raw)==0,"commit.transition");
   c.transition="INIT";
   Check(!Tov2LocalCommitEncode(c,raw) && ArraySize(raw)==0,"commit.init_generation");
   c.transition="PREPARE"; c.parent_generation=3;
   Check(!Tov2LocalCommitEncode(c,raw) && ArraySize(raw)==0,"commit.parent_order");

   if(tov2_local_failures==0)
      PrintFormat("TOV2_STORAGE_CODEC_PASS checks=%d failures=0",tov2_local_checks);
   else
      PrintFormat("TOV2_STORAGE_CODEC_FAIL checks=%d failures=%d",
                  tov2_local_checks,tov2_local_failures);
}
~~~

## C. `apps/execution-edge/test/mt5-telemetry-storage-codec-v2-source.test.ts`

These five tests verify source boundaries, independently computed vectors and selected existing receiver scalar contracts. They do not interpret MQL5 or prove runtime recovery.

~~~typescript
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { readCounterV2, readTicketV2 } from '../src/telemetry-values-v2';
import { readIdentityV2 } from '../src/telemetry-wire-v2';

const agent = join(import.meta.dirname, '../../../mt5/TradeOpsAgent');

function source(path: string): string {
  const full = join(agent, path);
  expect(existsSync(full), path).toBe(true);
  return readFileSync(full, 'utf8');
}

function hash(bytes: string | Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function reference(
  kind: string, generation: number, ordinal: number, sha: string,
  sequence = 0, eventId = '-', recordSha = '-', dealId = '-', revision = 0,
): string {
  return [kind, generation, ordinal, sha, sequence, eventId, recordSha, dealId, revision].join(',');
}

function localPayload(fields: readonly (string | number)[]): Buffer {
  return Buffer.from(fields.join('\n') + '\n', 'ascii');
}

function record(payload: Buffer, generation: number): Buffer {
  const prefix = Buffer.concat([
    Buffer.from('TOV2R1|CHECKPOINT|' + generation + '|' + payload.length + '\n', 'ascii'),
    payload,
  ]);
  return Buffer.concat([prefix, Buffer.from('\nSHA256|' + hash(prefix) + '\n', 'ascii')]);
}

function vectors(): Map<string, { generation: number; payload: Buffer; frame: Buffer }> {
  const identity = [
    'account.demo', 'install.demo', 'tracking.demo', 1,
    'd'.repeat(64), 'e'.repeat(64), 'f'.repeat(64),
  ].join('~');
  const initial: (string | number)[] = [
    'TOV2S1', 1, 0, '-', identity, reference('REGISTRATION', 1, 0, 'a'.repeat(64)),
    0, 0, 0, reference('CAPTURE', 1, 1, 'b'.repeat(64)), 'synthetic.capture.1',
    'CATCHING_UP', '-', 0, '-', 0, 0, 0, 0, '-', 0, '-', '-', 0, 0, 0, 'NONE',
  ];
  const pending = initial.slice();
  Object.assign(pending, {
    1: 3, 2: 2, 3: 'c'.repeat(64), 6: 2,
    9: reference('CAPTURE', 2, 3, 'b'.repeat(64)),
    12: reference('PENDING', 3, 1, '5'.repeat(64), 1),
    13: 1, 14: '6'.repeat(64), 16: 2, 17: 2, 18: 2, 25: 2,
  });
  pending.push(
    reference('EVENT', 2, 1, '1'.repeat(64), 1, 'event.1', '2'.repeat(64), '42', 1),
    reference('EVENT', 2, 2, '3'.repeat(64), 2, 'event.2', '4'.repeat(64), '43', 1),
  );
  const stateFrame = record(localPayload(pending), 3);
  const commit = [
    'TOV2C1', 3, 2, 'c'.repeat(64), 'a'.repeat(64), hash(stateFrame), 'PREPARE',
  ];
  return new Map([
    ['INIT_STATE', { generation: 1, payload: localPayload(initial), frame: record(localPayload(initial), 1) }],
    ['PENDING_STATE', { generation: 3, payload: localPayload(pending), frame: stateFrame }],
    ['PREPARE_COMMIT', { generation: 3, payload: localPayload(commit), frame: record(localPayload(commit), 3) }],
  ]);
}

describe('MT5 local storage codec source and vector seam', () => {
  it('keeps the new codec pure and outside the active EA', () => {
    const codec = source('Include/TradeOpsTelemetryStorageCodec.mqh');
    const native = source('Scripts/TradeOpsTelemetryStorageCodecSelfTest.mq5');
    const active = source('TradeOpsAgent.mq5');
    expect(codec.split('\n').filter((line) => line.startsWith('#include')))
      .toEqual(['#include "TradeOpsTelemetryRecord.mqh"']);
    expect(native.split('\n').filter((line) => line.startsWith('#include')))
      .toEqual(['#include "../Include/TradeOpsTelemetryStorageCodec.mqh"']);
    expect(active).not.toContain('TradeOpsTelemetryStorageCodec');
    const forbidden = /\b(?:File\w*|Folder\w*|WebRequest|Socket\w*|OrderSend\w*|CTrade|AccountInfo\w*|History\w*|PositionGet\w*|OrderGet\w*|OnTimer|OnTradeTransaction|TimeCurrent|TimeLocal|GetTickCount\w*)\b|#import/u;
    expect(codec).not.toMatch(forbidden);
    expect(native).not.toMatch(forbidden);
    expect(codec).not.toMatch(/\b(?:double|StringToDouble|CharArrayToString)\b/u);
    expect(codec).toContain('n>TOV2_RECORD_FRAME_MAX');
    expect(codec).toContain('CryptEncode(CRYPT_HASH_SHA256,bytes,key,digest)!=32');
    expect(codec).toContain('ArraySize(digest)!=32');
  });

  it('matches independent metadata and full-file golden vectors', () => {
    const native = source('Scripts/TradeOpsTelemetryStorageCodecSelfTest.mq5');
    const calls = [...native.matchAll(/^   Golden\((.*)\);$/gm)];
    expect(calls).toHaveLength(3);
    const expected = vectors();
    const names: string[] = [];
    for (const call of calls) {
      const args = JSON.parse('[' + call[1].replace(',payload,', ',') + ']') as
        [string, number, string, number, string, number];
      const [name, generation, payloadHash, payloadSize, frameHash, frameSize] = args;
      names.push(name);
      const vector = expected.get(name);
      expect(vector, name).toBeDefined();
      if (!vector) throw new Error('unknown golden vector');
      expect(generation).toBe(vector.generation);
      expect(payloadSize).toBe(vector.payload.length);
      expect(payloadHash).toBe(hash(vector.payload));
      expect(frameSize).toBe(vector.frame.length);
      expect(frameHash).toBe(hash(vector.frame));
      expect(frameHash).not.toBe(payloadHash);
    }
    expect(new Set(names)).toEqual(new Set(expected.keys()));
  });

  it('preserves existing values and records code byte-for-byte', () => {
    expect(hash(source('Include/TradeOpsTelemetryValues.mqh')))
      .toBe('0016223e32d8d0cf960a3b015581518948a8a2e1464196c0d8f7952d4dc9ea4f');
    expect(hash(source('Include/TradeOpsTelemetryRecord.mqh')))
      .toBe('7a0f42d1d481487ba812f6ef2b18faaf3f80143980388f4f54efd8075d977685');
  });

  it('agrees with existing receiver identity and integer boundaries', () => {
    const identity = {
      account_id: 'account.demo', installation_id: 'install.demo', tracking_id: 'tracking.demo',
      safety_epoch: 0, account_profile_sha256: 'd'.repeat(64),
      account_fingerprint_sha256: 'e'.repeat(64), tracking_boundary_sha256: 'f'.repeat(64),
    };
    expect(readIdentityV2(identity)).toEqual(identity);
    expect(readCounterV2(9007199254740991)).toBe(9007199254740991);
    expect(() => readCounterV2(9007199254740992)).toThrow();
    expect(readTicketV2('18446744073709551615')).toBe('18446744073709551615');
    expect(() => readTicketV2('18446744073709551616')).toThrow();
    const native = source('Scripts/TradeOpsTelemetryStorageCodecSelfTest.mq5');
    expect(native).toContain(hash('TOV2-INSTALL|install.demo'));
    expect(native).toContain(hash(Buffer.alloc(262345, 165)));
    expect(native).toContain('identity.zero_epoch_compatible');
  });

  it('retains native rejection and output-clearing cases', () => {
    const native = source('Scripts/TradeOpsTelemetryStorageCodecSelfTest.mq5');
    for (const label of [
      'state.unknown_schema', 'state.overflow', 'state.unknown_error',
      'state.extra_lf', 'state.missing_lf', 'state.crlf_rejected',
      'state.absent_pending_metadata', 'state.absent_ack_metadata',
      'events.duplicate_id', 'events.duplicate_revision', 'events.sequence',
      'pending.repeated_deal', 'pending.repeated_deal_prefix', 'pending.frozen_produced',
      'heartbeat.nonzero_prior', 'heartbeat.no_ack_reset',
      'ack.exact_event', 'ack.exact_request', 'ack.pending_association',
      'reference.path_collision', 'reference.future', 'reference.traversal',
      'queue.512', 'queue.513_rejected', 'queue.negative_rejected',
      'match.generation', 'match.kind', 'match.digest',
      'commit.schema', 'commit.parent_order', 'commit.not_state', 'state.not_commit',
      'hash.full_frame_max', 'hash.oversized_clear', 'hash.empty_clear',
      'error.required_for_gap', 'error.named_gap', 'error.reconciliation',
    ]) expect(native, label).toContain('"' + label + '"');
    expect(native).toContain('TOV2_STORAGE_CODEC_PASS');
    expect(native).toContain('TOV2_STORAGE_CODEC_FAIL');
    expect(native).toContain('TOV2_STORAGE_CODEC_FAILURE');
    expect(native).toContain('out.generation==0 && out.identity==""');
  });
});
~~~
