#ifndef TRADEOPS_TELEMETRY_STORAGE_CODEC_MQH
#define TRADEOPS_TELEMETRY_STORAGE_CODEC_MQH
#include "TradeOpsTelemetryRecord.mqh"

const long TOV2_LOCAL_MAX_COUNTER=9007199254740991;
#define TOV2_LOCAL_EVENTS 512
#define TOV2_LOCAL_BATCH 32

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
   int n=ArraySize(source);
   uchar staged[];
   bool ready=(n>=0 && n<=TOV2_RECORD_FRAME_MAX);
   if(ready && n>0)
      ready=ArrayResize(staged,n)==n && ArrayCopy(staged,source,0,0,n)==n;
   if(!ready)
   {
      ArrayResize(destination,0);
      return false;
   }
   ArrayResize(destination,0);
   if(n==0) return true;
   if(ArrayResize(destination,n)!=n ||
      ArrayCopy(destination,staged,0,0,n)!=n)
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
   uchar staged[];
   if(!Tov2LocalCopy(frame,staged))
   {
      ArrayResize(payload,0);
      return false;
   }
   ArrayResize(payload,0);
   if(!Tov2LocalRefValid(r)) return false;
   string sha="",kind=""; long generation=0; uchar candidate[];
   if(!Tov2LocalHash(staged,sha) || sha!=r.sha ||
      !Tov2RecordDecode(staged,kind,generation,candidate) ||
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
   Tov2LocalRef events[TOV2_LOCAL_EVENTS];
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
   for(int i=0;i<TOV2_LOCAL_EVENTS;i++) Tov2LocalClearRef(s.events[i]);
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
      s.event_count<0 || s.event_count>TOV2_LOCAL_EVENTS ||
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
         s.pending_count>TOV2_LOCAL_BATCH || s.pending_count>s.event_count ||
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
      pending_count>TOV2_LOCAL_BATCH || event_count>TOV2_LOCAL_EVENTS ||
      fields!=27+(int)event_count) return false;
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
