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
   s.capture.generation=2; s.capture.ordinal=TOV2_LOCAL_EVENTS+1;
   s.produced=TOV2_LOCAL_EVENTS; s.event_count=TOV2_LOCAL_EVENTS;
   for(int i=0;i<TOV2_LOCAL_EVENTS;i++)
      Ref(s.events[i],"EVENT",2,i+1,Repeat("1",64),i+1,"event."+IntegerToString(i+1),Repeat("2",64));
   Check(Tov2LocalStateEncode(s,payload) && ArraySize(payload)<=262144,"queue.512");
   Check(Tov2LocalStateDecode(payload,out) && out.event_count==TOV2_LOCAL_EVENTS &&
         out.events[TOV2_LOCAL_EVENTS-1].ordinal==TOV2_LOCAL_EVENTS &&
         out.events[TOV2_LOCAL_EVENTS-1].sequence==TOV2_LOCAL_EVENTS &&
         out.events[TOV2_LOCAL_EVENTS-1].event_id=="event.512" &&
         out.events[TOV2_LOCAL_EVENTS-1].record_sha==Repeat("2",64),"queue.512_decode");
   Check(Tov2LocalStateEncode(out,decoded) && Tov2LocalEqual(payload,decoded),
         "queue.512_reencode");
   s.produced=TOV2_LOCAL_EVENTS+1; s.event_count=TOV2_LOCAL_EVENTS+1;
   RejectState(s,"queue.513_rejected");
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
   Check(Tov2LocalCopy(raw,raw) && ArraySize(raw)==3 &&
         raw[0]==65 && raw[1]==0 && raw[2]==255,"copy.self_alias");

   Pending(s);
   Check(Tov2LocalStateEncode(s,payload) &&
         Tov2RecordEncode("CHECKPOINT",3,payload,frame),"match.fixture");
   Check(Tov2LocalHash(frame,sha),"match.hash");
   Ref(r,"STATE",3,0,sha);
   Check(Tov2LocalFrameMatches(r,frame,decoded) &&
         Tov2LocalEqual(payload,decoded),"match.valid");
   uchar aliased_frame[];
   Check(Tov2LocalCopy(frame,aliased_frame),"match.self_alias_fixture");
   Check(Tov2LocalFrameMatches(r,aliased_frame,aliased_frame) &&
         Tov2LocalEqual(payload,aliased_frame),"match.self_alias");
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
