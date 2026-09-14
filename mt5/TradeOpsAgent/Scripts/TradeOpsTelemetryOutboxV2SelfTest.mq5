#property strict
#property version "1.000"
#property script_show_inputs
#property description "Offline production v2 durable-outbox lifecycle and fault checks"
#include "Support/TradeOpsTelemetryOutboxV2Rig.mqh"

int checks=0,failures=0;
string scenario="";

// A class wrapper puts the very large checkpoint arrays on the heap.
class CTov2CaptureCheckpointBox
{
public:
   Tov2CaptureCheckpoint value;
};

void Check(const bool pass,const string label)
{
   checks++;
   if(!pass)
   {
      failures++;
      Print("TOV2_OUTBOX_V2_CHECK scenario=",scenario," label=",label);
   }
}

string RepeatText(const string value,const int count)
{
   string out="";
   for(int i=0;i<count;i++) out+=value;
   return out;
}

bool DecodeRequest(const uchar &bytes[],CTov2WireRequest *request,Tov2WireExpected &expected)
{
   return CheckPointer(request)!=POINTER_INVALID && Tov2WireDecodeRequest(bytes,request,expected);
}

bool RequestSequences(const uchar &bytes[],const int expected_count,const long accepted)
{
   CTov2WireRequest *request=new CTov2WireRequest;
   if(CheckPointer(request)==POINTER_INVALID) return false;
   Tov2WireExpected expected;
   bool valid=DecodeRequest(bytes,request,expected) && request.event_count==expected_count;
   for(int i=0;valid && i<request.event_count;i++)
      valid=request.events[i].sequence==accepted+1+i;
   delete request;
   return valid;
}

bool ResponseForPending(const uchar &pending[],const long accepted_at,uchar &response[])
{
   ArrayResize(response,0);
   CTov2WireRequest *request=new CTov2WireRequest;
   if(CheckPointer(request)==POINTER_INVALID) return false;
   Tov2WireExpected expected;Tov2WireCoverageResponse coverage;
   bool valid=DecodeRequest(pending,request,expected) &&
      Tov2WireExpectedCoverage(expected,coverage);
   delete request;
   if(!valid) return false;
   string body="{\"accepted_at_utc_seconds\":"+Tov2CaptureNumber(accepted_at)+
      ",\"acknowledged_event_sequence\":"+Tov2CaptureNumber(expected.final_event)+
      ",\"command\":null,\"coverage\":"+Tov2WireCoverageResponseJson(coverage)+
      ",\"identity\":"+Tov2WireIdentityJson(expected.identity)+
      ",\"mode\":\"DRY_RUN\",\"request_body_sha256\":"+Tov2CaptureQuote(expected.request_body_sha256)+
      ",\"request_sequence\":"+Tov2CaptureNumber(expected.request_sequence)+
      ",\"schema_version\":\"AgentSyncResponseV2\"}";
   string digest="";
   if(!Tov2CaptureRecordHash(body,digest)) return false;
   string marker=",\"schema_version\":\"AgentSyncResponseV2\"}";
   int at=StringFind(body,marker);
   if(at<0) return false;
   string canonical=StringSubstr(body,0,at)+",\"response_body_sha256\":"+
      Tov2CaptureQuote(digest)+StringSubstr(body,at);
   return Tov2CaptureUtf8Bytes(canonical,response);
}

bool InjectCheckpointRoot(CTov2TelemetryMemoryStore &store,const Tov2LocalState &state,
                          const string transition,string &commit_sha)
{
   uchar state_payload[],state_frame[],commit_payload[],commit_frame[];
   string state_sha="";commit_sha="";
   if(!Tov2LocalStateEncode(state,state_payload) ||
      !Tov2RecordEncode("CHECKPOINT",state.generation,state_payload,state_frame) ||
      !Tov2LocalHash(state_frame,state_sha)) return false;
   Tov2LocalCommit commit;Tov2LocalClearCommit(commit);
   commit.generation=state.generation;commit.parent_generation=state.parent_generation;
   commit.parent_sha=state.parent_commit;commit.registration_sha=state.registration.sha;
   commit.state_sha=state_sha;commit.transition=transition;
   if(!Tov2LocalCommitEncode(commit,commit_payload) ||
      !Tov2RecordEncode("CHECKPOINT",state.generation,commit_payload,commit_frame) ||
      !Tov2LocalHash(commit_frame,commit_sha)) return false;
   return store.Inject(Tov2StorageStateLocator(state.generation),state_frame) &&
      store.Inject(Tov2StorageCommitLocator(state.generation),commit_frame);
}

bool RehashResponse(string &text)
{
   string hash_marker=",\"response_body_sha256\":\"";
   int at=StringFind(text,hash_marker);
   if(at<0) return false;
   int after=at+StringLen(hash_marker)+65;
   if(after>StringLen(text)) return false;
   string body=StringSubstr(text,0,at)+StringSubstr(text,after);
   string digest="",schema_marker=",\"schema_version\":\"AgentSyncResponseV2\"}";
   int schema=StringFind(body,schema_marker);
   if(schema<0 || !Tov2CaptureRecordHash(body,digest)) return false;
   text=StringSubstr(body,0,schema)+hash_marker+digest+"\""+StringSubstr(body,schema);
   return true;
}

bool MutatedResponse(const string baseline,const int field,uchar &bytes[])
{
   string text=baseline;
   string bad64=RepeatText("e",64);
   int changed=0;
   if(field==0) changed=StringReplace(text,"\"account_id\":\"synthetic-account\"","\"account_id\":\"other-account\"");
   if(field==1) changed=StringReplace(text,"\"installation_id\":\"synthetic-install\"","\"installation_id\":\"other-install\"");
   if(field==2) changed=StringReplace(text,"\"tracking_id\":\"synthetic-tracking\"","\"tracking_id\":\"other-tracking\"");
   if(field==3) changed=StringReplace(text,"\"safety_epoch\":0","\"safety_epoch\":1");
   if(field==4) changed=StringReplace(text,"\"account_profile_sha256\":\""+RepeatText("a",64)+"\"","\"account_profile_sha256\":\""+bad64+"\"");
   if(field==5) changed=StringReplace(text,"\"account_fingerprint_sha256\":\""+RepeatText("b",64)+"\"","\"account_fingerprint_sha256\":\""+bad64+"\"");
   if(field==6) changed=StringReplace(text,"\"tracking_boundary_sha256\":\"d44d100c6c5e0c657976c49a3e50bc1b2a5862584b6e16e7a1e2f5dffc947716\"","\"tracking_boundary_sha256\":\""+bad64+"\"");
   if(field==7) changed=StringReplace(text,"\"request_body_sha256\":\"79bd13f13a10ae9ff0f65da74b79f5faa12eca31adcee8d03eeb5e34032f8bc4\"","\"request_body_sha256\":\""+bad64+"\"");
   if(field==8) changed=StringReplace(text,"\"request_sequence\":1","\"request_sequence\":2");
   if(field==9) changed=StringReplace(text,"\"acknowledged_event_sequence\":1","\"acknowledged_event_sequence\":0");
   if(field==10) changed=StringReplace(text,"\"observation_gap\":false","\"observation_gap\":true");
   if(field==11) changed=StringReplace(text,"\"pending_events\":0","\"pending_events\":1");
   if(field==12) changed=StringReplace(text,"\"reason\":null","\"reason\":\"HISTORY_UNAVAILABLE\"");
   if(field==13) changed=StringReplace(text,"\"state\":\"UP_TO_DATE\"","\"state\":\"CATCHING_UP\"");
   if(field==14) changed=StringReplace(text,"\"through_broker_msc\":1800000010000","\"through_broker_msc\":null");
   if(field==15) changed=StringReplace(text,"\"accepted_at_utc_seconds\":1800001000","\"accepted_at_utc_seconds\":0");
   return changed==1 && RehashResponse(text) && Tov2CaptureUtf8Bytes(text,bytes);
}

void GoldenFixtures()
{
   for(int index=0;index<6;index++)
   {
      scenario="golden."+Tov2OutboxV2FixtureName(index);
      CTov2OutboxV2Rig *rig=new CTov2OutboxV2Rig;
      if(CheckPointer(rig)==POINTER_INVALID) {Check(false,"golden.allocate");return;}
      bool ready=rig.Fixture(index);Check(ready,"golden.fixture");
      if(!ready) {delete rig;continue;}
      uchar request[],expected[],response[];
      Check(Tov2CaptureUtf8Bytes(Tov2OutboxV2FixtureRequest(index),expected),"golden.literal_request");
      Check(rig.Request(request)==TOV2_STATE_OK,"golden.prepare");
      Check(Tov2LocalEqual(request,expected),"golden.exact_bytes");
      Tov2LocalState local;string whole="";
      Check(rig.Snapshot(local) && Tov2LocalHash(request,whole) && whole!=local.pending.sha &&
         whole!=local.pending_body && local.pending.sha!=local.pending_body,"golden.three_hash_domains");
      Check(Tov2CaptureUtf8Bytes(Tov2OutboxV2FixtureResponse(index),response),"golden.literal_response");
      Check(rig.Accept(response)==TOV2_STATE_OK,"golden.accept");
      Check(rig.Snapshot(local) && local.accepted_request==1 &&
         local.accepted_event==(index==5?32:(index==1 || index==2?1:0)),"golden.accepted_prefix");
      delete rig;
   }
}

void ReplayLifecycle()
{
   scenario="replay-lifecycle";
   CTov2OutboxV2Rig *rig=new CTov2OutboxV2Rig;
   if(CheckPointer(rig)==POINTER_INVALID) {Check(false,"replay.allocate");return;}
   uchar first[],again[],response[];
   Check(rig.Init(),"replay.init");Check(rig.Bind(),"replay.bind");
   Check(rig.Request(first)==TOV2_STATE_OK,"replay.request");
   Check(rig.Restart(),"replay.restart");
   CTov2TelemetryOutboxV2 unbound;
   CTov2TelemetryOutbox replay(rig.state,GetPointer(unbound));
   Check(replay.Request(again)==TOV2_STATE_OK && Tov2LocalEqual(first,again),"replay.restart.exact");
   delete rig;

   rig=new CTov2OutboxV2Rig;
   if(CheckPointer(rig)==POINTER_INVALID) {Check(false,"replay.newer.allocate");return;}
   Check(rig.Fixture(1),"replay.newer.fixture");
   Check(rig.Request(first)==TOV2_STATE_OK,"replay.newer.prepare");
   rig.broker.broker_now+=1000;rig.broker.utc_now++;
   rig.broker.AddDeal("2",rig.broker.broker_now);
   Check(rig.Poll(),"replay.newer.poll");
   rig.diagnostics.ea_release="changed-after-pending";
   Check(rig.Request(again)==TOV2_STATE_OK && Tov2LocalEqual(first,again),"replay.newer_capture.exact");
   Check(Tov2CaptureUtf8Bytes(Tov2OutboxV2FixtureResponse(1),response) &&
      rig.Accept(response)==TOV2_STATE_OK,"replay.newer.accept_old");
   Tov2LocalState before,after;int files=rig.storage.PersistentCount();
   Check(rig.Snapshot(before),"binding.stale.snapshot");
   Tov2LocalBytes("dirty",again);
   Check(rig.Request(again)==TOV2_STATE_INVALID && ArraySize(again)==0 &&
      rig.storage.PersistentCount()==files && rig.Snapshot(after) &&
      after.generation==before.generation && after.pending.kind=="-","binding.stale_new_no_commit");
   delete rig;
}

void CandidateAndBindingFailures()
{
   scenario="candidate-binding-failures";
   CTov2OutboxV2Rig *rig=new CTov2OutboxV2Rig;
   if(CheckPointer(rig)==POINTER_INVALID || !rig.Fixture(1)) {Check(false,"candidate.fixture");if(CheckPointer(rig)!=POINTER_INVALID) delete rig;return;}
   Tov2OutboxContext context;uchar registration[],arena[],request[],persisted[],capture[];int ends[];
   Tov2OutboxCandidate candidate;
   Check(rig.ReadContext(context,registration,arena,ends) &&
      rig.adapter.Build(context,registration,arena,ends,1,candidate,request)==TOV2_OUTBOX_BUILD_OK,"candidate.build");
   int files=rig.storage.PersistentCount();Tov2LocalState before,after;Check(rig.Snapshot(before),"candidate.before");
   for(int field=0;field<7;field++)
   {
      Tov2OutboxCandidate changed=candidate;
      if(field==0) changed.expected_generation++;
      if(field==1) changed.expected_root_sha=RepeatText("e",64);
      if(field==2) changed.registration_sha=RepeatText("e",64);
      if(field==3) changed.request_sequence++;
      if(field==4) changed.body_sha=RepeatText("e",64);
      if(field==5) changed.prefix_count=0;
      if(field==6) changed.frozen_produced++;
      Tov2LocalBytes("dirty",persisted);
      Check(rig.state.PreparePending(GetPointer(rig.adapter),changed,request,persisted)==TOV2_STATE_INVALID &&
         ArraySize(persisted)==0 && rig.storage.PersistentCount()==files && rig.Snapshot(after) &&
         after.generation==before.generation && after.pending.kind=="-",
         "candidate.invalid_no_commit."+IntegerToString(field));
   }
   Tov2OutboxCandidate wrong=candidate;wrong.expected_generation++;
   Check(rig.state.PreparePending(GetPointer(rig.adapter),wrong,request,persisted)==TOV2_STATE_INVALID &&
      ArraySize(persisted)==0 && rig.storage.PersistentCount()==files && rig.Snapshot(after) &&
      after.generation==before.generation && after.pending.kind=="-","binding.wrong_generation");
   wrong=candidate;wrong.expected_root_sha=RepeatText("f",64);
   Check(rig.state.PreparePending(GetPointer(rig.adapter),wrong,request,persisted)==TOV2_STATE_INVALID &&
      ArraySize(persisted)==0 && rig.storage.PersistentCount()==files && rig.Snapshot(after) &&
      after.generation==before.generation && after.pending.kind=="-","binding.wrong_root");

   Tov2LocalState local;string root="";
   Check(rig.state.ReadCaptureContext(local,root,registration,capture)==TOV2_STATE_OK,"binding.capture_context");
   Check(!rig.adapter.Bind(local,"invalid",registration,capture,rig.diagnostics,rig.sent_at),"binding.failed_rebind");
   Tov2LocalBytes("dirty",persisted);
   Check(rig.Request(persisted)==TOV2_STATE_INVALID && ArraySize(persisted)==0 &&
      rig.storage.PersistentCount()==files && rig.Snapshot(after) && after.generation==before.generation,
      "binding.failed_rebind_clears");
   delete rig;
}

void CheckpointMutationValidation()
{
   scenario="checkpoint-mutations";
   CTov2OutboxV2Rig *rig=new CTov2OutboxV2Rig;
   bool fixture=CheckPointer(rig)!=POINTER_INVALID && rig.Fixture(1);
   Check(fixture,"checkpoint.fixture.initial");
   if(!fixture) {if(CheckPointer(rig)!=POINTER_INVALID) delete rig;return;}
   uchar first[],response[];
   bool accepted=rig.Request(first)==TOV2_STATE_OK &&
      Tov2CaptureUtf8Bytes(Tov2OutboxV2FixtureResponse(1),response) &&
      rig.Accept(response)==TOV2_STATE_OK;
   Check(accepted,"checkpoint.fixture.accepted_head");
   if(!accepted) {delete rig;return;}
   rig.broker.broker_now+=1000;rig.broker.utc_now++;
   rig.broker.AddDeal("2",rig.broker.broker_now);
   bool polled=rig.Poll();
   rig.sent_at=rig.broker.utc_now+1;
   polled=polled && rig.Bind();
   Check(polled,"checkpoint.fixture.next_event");
   if(!polled) {delete rig;return;}

   Tov2OutboxContext context;Tov2LocalState local;string root="";
   uchar registration[],capture[],arena[];int ends[];
   bool read=rig.state.ReadCaptureContext(local,root,registration,capture)==TOV2_STATE_OK &&
      rig.ReadContext(context,registration,arena,ends) && local.accepted_event==1 &&
      local.produced==2 && local.event_count==1 && local.events[0].sequence==2;
   Check(read,"checkpoint.fixture.context");
   CTov2CaptureCheckpointBox *baseline=new CTov2CaptureCheckpointBox;
   bool decoded=read && CheckPointer(baseline)!=POINTER_INVALID &&
      Tov2CaptureCheckpointDecode(capture,baseline.value) && baseline.value.produced==2 &&
      baseline.value.queue_count==1 && baseline.value.queued[0].sequence==2;
   Check(decoded,"checkpoint.fixture.decode");
   if(!decoded) {if(CheckPointer(baseline)!=POINTER_INVALID) delete baseline;delete rig;return;}
   Check(rig.sent_at==baseline.value.queued[0].observed_utc+1,
      "checkpoint.fixture.sent_at_covers_mutation");
   int files=rig.storage.PersistentCount();Tov2LocalState before,after;
   Check(rig.Snapshot(before),"checkpoint.fixture.snapshot");

   for(int field=0;field<4;field++)
   {
      CTov2CaptureCheckpointBox *changed=new CTov2CaptureCheckpointBox;
      CTov2TelemetryOutboxV2 *altered=new CTov2TelemetryOutboxV2;
      bool allocated=CheckPointer(changed)!=POINTER_INVALID && CheckPointer(altered)!=POINTER_INVALID;
      Check(allocated,"checkpoint.fixture.allocate."+IntegerToString(field));
      if(!allocated)
      {
         if(CheckPointer(changed)!=POINTER_INVALID) delete changed;
         if(CheckPointer(altered)!=POINTER_INVALID) delete altered;
         continue;
      }
      changed.value=baseline.value;Tov2LocalState changed_state=local;
      if(field==0) changed.value.queued[0].event_id="changed.event";
      if(field==1) changed.value.queued[0].record_sha=RepeatText("e",64);
      if(field==2) changed.value.queued[0].sequence--;
      if(field==3) changed.value.queued[0].observed_utc++;
      uchar changed_bytes[],frame[],built[],persisted[];string sha="";
      bool encoded=Tov2CaptureCheckpointEncode(changed.value,changed_bytes) &&
         Tov2RecordEncode("CAPTURE",local.capture.generation,changed_bytes,frame) &&
         Tov2LocalHash(frame,sha);
      Check(encoded,"checkpoint.fixture.encode."+IntegerToString(field));
      if(encoded) changed_state.capture.sha=sha;
      bool bound=encoded && altered.Bind(changed_state,root,registration,changed_bytes,
         rig.diagnostics,rig.sent_at);
      Check(encoded && (field==3?bound:!bound),
         "checkpoint.fixture.bind."+IntegerToString(field));

      bool intended=false;
      if(field==2)
         intended=encoded && !bound;
      else if(field==3 && bound)
      {
         Tov2OutboxContext changed_context=context;changed_context.state=changed_state;
         Tov2OutboxCandidate changed_candidate;
         int build=altered.Build(changed_context,registration,arena,ends,1,changed_candidate,built);
         CTov2WireRequest *decoded_request=new CTov2WireRequest;Tov2WireExpected expected;
         intended=build==TOV2_OUTBOX_BUILD_OK && DecodeRequest(built,decoded_request,expected) &&
            decoded_request.event_count==1 &&
            decoded_request.events[0].observed_at_utc_seconds==changed.value.queued[0].observed_utc;
         Check(intended,"checkpoint.queue_observed.maps_changed_value");
         if(CheckPointer(decoded_request)!=POINTER_INVALID) delete decoded_request;
      }
      else intended=encoded && !bound;
      if(field==2) Check(intended,"checkpoint.queue_sequence.reaches_adapter_validator");

      CTov2TelemetryOutbox outbox(rig.state,altered);Tov2LocalBytes("dirty",persisted);
      int result=outbox.Request(persisted);
      string label=field==0?"checkpoint.queue_event_id":field==1?"checkpoint.queue_digest":
         field==2?"checkpoint.queue_sequence":"checkpoint.queue_observed";
      Check(intended && result==TOV2_STATE_INVALID && ArraySize(persisted)==0 &&
         rig.storage.PersistentCount()==files && rig.Snapshot(after) &&
         after.generation==before.generation && after.pending.kind=="-",label);
      delete altered;delete changed;
   }
   delete baseline;delete rig;
}

void ResponseMutationsAndLiteralAck()
{
   scenario="response-mutations";
   CTov2OutboxV2Rig *rig=new CTov2OutboxV2Rig;
   if(CheckPointer(rig)==POINTER_INVALID || !rig.Fixture(1)) {Check(false,"response.fixture");if(CheckPointer(rig)!=POINTER_INVALID) delete rig;return;}
   uchar request[],response[],invalid[];Tov2LocalState before,after;
   Check(rig.Request(request)==TOV2_STATE_OK && rig.Snapshot(before),"response.pending");
   Check(Tov2CaptureUtf8Bytes(Tov2OutboxV2FixtureResponse(1),response),"response.literal");
   int files=rig.storage.PersistentCount();
   for(int field=0;field<16;field++)
   {
      Tov2WireAck ack;
      Check(MutatedResponse(Tov2OutboxV2FixtureResponse(1),field,invalid),"response.mutation_fixture");
      Check(!Tov2WireVerifyResponse(request,invalid,ack) && rig.Accept(invalid)==TOV2_STATE_INVALID &&
         rig.storage.PersistentCount()==files && rig.Snapshot(after) && after.generation==before.generation &&
         after.accepted_event==0 && after.event_count==1 && after.pending.sha==before.pending.sha,
         "response.invalid_no_write."+IntegerToString(field));
   }
   Check(rig.Accept(response)==TOV2_STATE_OK,"ack.literal");
   Check(rig.Restart(),"ack.restart");
   files=rig.storage.PersistentCount();
   Check(rig.Accept(response)==TOV2_STATE_OK && rig.storage.PersistentCount()==files,
      "ack.duplicate_after_restart");
   rig.broker.broker_now+=1000;rig.broker.utc_now++;
   rig.broker.AddDeal("2",rig.broker.broker_now);
   bool newer_polled=rig.Poll();
   rig.sent_at=rig.broker.utc_now;
   bool newer_pending=newer_polled && rig.sent_at==rig.broker.utc_now && rig.Bind() &&
      rig.Request(request)==TOV2_STATE_OK && rig.Snapshot(before) &&
      before.pending.kind=="PENDING" && before.pending_request==2;
   Check(newer_pending,"ack.newer_pending");
   if(!newer_pending) {delete rig;return;}
   uchar persisted[];Check(rig.Request(persisted)==TOV2_STATE_OK && Tov2LocalEqual(request,persisted),"ack.newer_retry");
   files=rig.storage.PersistentCount();
   Check(rig.Accept(response)==TOV2_STATE_OK && rig.storage.PersistentCount()==files &&
      rig.Snapshot(after) && after.pending.sha==before.pending.sha && after.pending_request==2 &&
      rig.Request(persisted)==TOV2_STATE_OK && Tov2LocalEqual(request,persisted),
      "ack.old_newer_pending_unchanged");
   delete rig;
}

void FailedOutputClearing()
{
   scenario="failed-output-clearing";
   CTov2WireRequest *decoded=new CTov2WireRequest;
   uchar valid[],bad[];Tov2WireExpected expected;
   bool loaded=CheckPointer(decoded)!=POINTER_INVALID &&
      Tov2CaptureUtf8Bytes(Tov2OutboxV2FixtureRequest(1),valid) &&
      DecodeRequest(valid,decoded,expected);
   Tov2LocalBytes("invalid",bad);expected.request_body_sha256="dirty";
   Check(loaded && !DecodeRequest(bad,decoded,expected) && decoded.event_count==0 &&
      expected.request_body_sha256=="" && expected.request_sequence==0,"outputs.decode_cleared");
   if(CheckPointer(decoded)!=POINTER_INVALID) delete decoded;

   CTov2OutboxV2Rig *rig=new CTov2OutboxV2Rig;
   Tov2OutboxAcceptance accepted;accepted.identity="dirty";accepted.registration_sha="dirty";
   accepted.body_sha="dirty";accepted.pending_sha="dirty";accepted.request_sequence=9;
   accepted.final_event=9;accepted.accepted_at=9;Tov2LocalState local;
   Check(CheckPointer(rig)!=POINTER_INVALID && rig.Fixture(1) && rig.Snapshot(local) &&
      !rig.adapter.ValidateResponse(local,bad,bad,accepted) && accepted.identity=="" &&
      accepted.registration_sha=="" && accepted.body_sha=="" && accepted.pending_sha=="" &&
      accepted.request_sequence==0 && accepted.final_event==0 && accepted.accepted_at==0,
      "outputs.response_cleared");
   if(CheckPointer(rig)!=POINTER_INVALID) delete rig;
}

void PadSymbol(string &symbol,int &remaining)
{
   symbol="S";
   int triples=MathMin(63,remaining/3);
   for(int i=0;i<triples;i++) symbol+="界";
   remaining-=triples*3;
   if(remaining>=2 && StringLen(symbol)<64) {symbol+="é";remaining-=2;}
   if(remaining>=1 && StringLen(symbol)<64) {symbol+="a";remaining--;}
}

bool ConfigureLargeExposure(CTov2FakeCaptureBroker &broker,const int budget)
{
   broker.SetPositions(128);broker.SetOrders(128);int remaining=budget;
   for(int i=0;i<128;i++) PadSymbol(broker.exposure.positions[i].symbol,remaining);
   for(int i=0;i<128;i++) PadSymbol(broker.exposure.orders[i].symbol,remaining);
   return remaining==0;
}

bool BuildTwoEventSize(CTov2OutboxV2Rig *rig,const int count,int &size)
{
   size=0;Tov2OutboxContext context;uchar registration[],arena[],bytes[];int ends[];Tov2OutboxCandidate candidate;
   int result=rig.ReadContext(context,registration,arena,ends)?
      rig.adapter.Build(context,registration,arena,ends,count,candidate,bytes):TOV2_OUTBOX_BUILD_INVALID;
   size=ArraySize(bytes);return result==TOV2_OUTBOX_BUILD_OK;
}

bool SizeRig(CTov2OutboxV2Rig *rig,const int budget)
{
   if(!ConfigureLargeExposure(rig.broker,budget) || !rig.Init()) return false;
   rig.broker.AddDeal("1",rig.broker.broker_now);
   rig.broker.AddDeal("2",rig.broker.broker_now);
   return rig.Poll() && rig.Bind();
}

void PrefixAndValueMatrix()
{
   scenario="prefix-values";
   CTov2OutboxV2Rig *rig=new CTov2OutboxV2Rig;
   uchar bytes[];Tov2LocalState local;
   if(CheckPointer(rig)==POINTER_INVALID) {Check(false,"prefix.allocate");return;}
   Check(rig.Fixture(0) && rig.Request(bytes)==TOV2_STATE_OK && RequestSequences(bytes,0,0),"prefix.zero");
   delete rig;

   rig=new CTov2OutboxV2Rig;
   Check(CheckPointer(rig)!=POINTER_INVALID && rig.Fixture(5) && rig.Request(bytes)==TOV2_STATE_OK &&
      RequestSequences(bytes,32,0),"prefix.batch32");
   delete rig;

   rig=new CTov2OutboxV2Rig;
   bool ready=CheckPointer(rig)!=POINTER_INVALID && rig.Init();
   if(ready) for(int i=0;i<33;i++) rig.broker.AddDeal(IntegerToString(i+1),rig.broker.broker_now);
   for(int pass=0;ready && pass<4;pass++)
   {
      if(!rig.Poll()) ready=false;
      if(ready && rig.Snapshot(local) && local.produced==33) break;
   }
   Check(ready && rig.Snapshot(local) && local.event_count==33 && rig.Bind() &&
      rig.Request(bytes)==TOV2_STATE_OK && RequestSequences(bytes,32,0),"prefix.queued33");
   delete rig;

   rig=new CTov2OutboxV2Rig;
   ready=CheckPointer(rig)!=POINTER_INVALID && rig.Init();
   if(ready) {rig.broker.AddDeal("700",rig.broker.broker_now,"BUY","INOUT");ready=rig.Poll();}
   if(ready) {Tov2CaptureFromDouble(-7.0,2,rig.broker.deals[0].deal.profit);ready=rig.Poll();}
   Check(ready && rig.Snapshot(local) && local.event_count==2 &&
      local.events[0].deal_id==local.events[1].deal_id && local.events[0].revision==1 &&
      local.events[1].revision==2 && rig.Bind() && rig.Request(bytes)==TOV2_STATE_OK &&
      RequestSequences(bytes,1,0) && rig.Snapshot(local) && local.pending_count==1,
      "prefix.repeated_deal");
   delete rig;

   rig=new CTov2OutboxV2Rig;
   ready=CheckPointer(rig)!=POINTER_INVALID && rig.Fixture(1);
   if(ready)
   {
      Tov2OutboxContext context;uchar registration[],arena[],valid[],invalid[];int ends[];Tov2OutboxCandidate candidate;
      ready=rig.ReadContext(context,registration,arena,ends) &&
         rig.adapter.Build(context,registration,arena,ends,1,candidate,valid)==TOV2_OUTBOX_BUILD_OK &&
         Tov2LocalCopy(valid,invalid);
      int files=rig.storage.PersistentCount();Tov2LocalState before,after;rig.Snapshot(before);
      if(ArraySize(invalid)>0) invalid[0]='x';
      Check(ready && rig.adapter.Build(context,registration,invalid,ends,1,candidate,bytes)==TOV2_OUTBOX_BUILD_INVALID &&
         ArraySize(bytes)==0 && rig.state.PreparePending(GetPointer(rig.adapter),candidate,invalid,bytes)==TOV2_STATE_INVALID &&
         ArraySize(bytes)==0 && rig.storage.PersistentCount()==files && rig.Snapshot(after) &&
         after.generation==before.generation,"prefix.invalid_record");
   }
   else Check(false,"prefix.invalid_record");
   delete rig;

   CTov2OutboxV2Rig *probe=new CTov2OutboxV2Rig;int size_two=0,size_one=0;
   ready=CheckPointer(probe)!=POINTER_INVALID && SizeRig(probe,0) &&
      BuildTwoEventSize(probe,2,size_two) && BuildTwoEventSize(probe,1,size_one);
   delete probe;
   int shrink_budget=ready && size_two<262145?(262145-size_two+1)/2:0;
   rig=new CTov2OutboxV2Rig;
   ready=ready && CheckPointer(rig)!=POINTER_INVALID && SizeRig(rig,shrink_budget);
   Check(ready && rig.Request(bytes)==TOV2_STATE_OK && rig.Snapshot(local) &&
      local.pending_count==1 && RequestSequences(bytes,1,0) && ArraySize(bytes)<=262144,
      "prefix.size_shrink");
   delete rig;

   int head_budget=ready && size_one<262145?(262145-size_one+1)/2:0;
   rig=new CTov2OutboxV2Rig;
   ready=CheckPointer(rig)!=POINTER_INVALID && SizeRig(rig,head_budget);
   int files=ready?rig.storage.PersistentCount():0;
   Check(ready && rig.Request(bytes)==TOV2_STATE_LIMIT && ArraySize(bytes)==0 &&
      rig.storage.PersistentCount()==files && rig.Snapshot(local) && local.event_count==2 &&
      local.events[0].sequence==1,"prefix.oversized_head");
   delete rig;

   rig=new CTov2OutboxV2Rig;
   Tov2LocalBytes("abandoned",bytes);
   ready=CheckPointer(rig)!=POINTER_INVALID && rig.Init() &&
      rig.storage.Inject(Tov2StorageObjectLocator(TOV2_LOCAL_MAX_COUNTER,1),bytes);
   Check(ready && rig.Bind() && rig.Request(bytes)==TOV2_STATE_LIMIT && ArraySize(bytes)==0,
      "counter.request_exhaustion");
   delete rig;

   rig=new CTov2OutboxV2Rig;
   ready=CheckPointer(rig)!=POINTER_INVALID && rig.Fixture(1) && rig.Request(bytes)==TOV2_STATE_OK;
   CTov2WireRequest *decoded=new CTov2WireRequest;Tov2WireExpected expected;
   Check(ready && DecodeRequest(bytes,decoded,expected) && decoded.event_count==1 &&
      decoded.events[0].record_json!="" && StringFind(decoded.events[0].record_json,"\"commission\":{\"reason\":null")>=0 &&
      StringFind(decoded.events[0].record_json,"\"value\":\"-0.20\"")>=0 &&
      decoded.account.balance.reason=="" && decoded.account.balance.fixed.value=="100.00" &&
      decoded.account.margin_level.reason=="NOT_APPLICABLE","values.negative_null_known");
   delete decoded;delete rig;

   rig=new CTov2OutboxV2Rig;
   ready=CheckPointer(rig)!=POINTER_INVALID;
   if(ready)
   {
      rig.broker.SetPositions(1);
      rig.broker.exposure.positions[0].ticket="18446744073709551615";
      rig.broker.exposure.positions[0].position_id="9223372036854775808";
      rig.broker.exposure.positions[0].symbol="XAUUSD.测试";
      ready=rig.Init() && rig.Poll() && rig.Bind() && rig.Request(bytes)==TOV2_STATE_OK;
   }
   decoded=new CTov2WireRequest;
   Check(ready && DecodeRequest(bytes,decoded,expected) && decoded.exposure.positions_size==1 &&
      RequestSequences(bytes,0,0) &&
      decoded.exposure.positions[0].ticket=="18446744073709551615" &&
      decoded.exposure.positions[0].position_id=="9223372036854775808" &&
      decoded.exposure.positions[0].symbol=="XAUUSD.测试","values.huge_utf8");
   delete decoded;delete rig;
}

void PreviousRootWitnessRetention()
{
   for(int mode=TOV2_MEMORY_FAULT_BEFORE;mode<=TOV2_MEMORY_FAULT_AFTER;mode++)
   {
      CTov2OutboxV2Rig *rig=new CTov2OutboxV2Rig;
      bool fixture=CheckPointer(rig)!=POINTER_INVALID && rig.Fixture(1);
      Check(fixture,"witness.previous_only.fixture");
      if(!fixture) {if(CheckPointer(rig)!=POINTER_INVALID) delete rig;continue;}
      uchar first[],response1[],second[],response2[],commit_frame[];
      Tov2LocalState pending1,ack1,pending2,ack2;
      bool first_accepted=rig.Request(first)==TOV2_STATE_OK && rig.Snapshot(pending1) &&
         Tov2CaptureUtf8Bytes(Tov2OutboxV2FixtureResponse(1),response1) &&
         rig.Accept(response1)==TOV2_STATE_OK && rig.Snapshot(ack1);
      string ack1_sha="";
      bool first_root=first_accepted &&
         rig.storage.Copy(Tov2StorageCommitLocator(ack1.generation),commit_frame) &&
         Tov2LocalHash(commit_frame,ack1_sha);
      Check(first_root,"witness.previous_only.ack1");
      if(!first_root) {delete rig;continue;}

      rig.broker.broker_now+=1000;rig.broker.utc_now++;
      rig.broker.AddDeal("2",rig.broker.broker_now);
      bool second_polled=rig.Poll();
      rig.sent_at=rig.broker.utc_now;
      Check(second_polled && rig.sent_at==rig.broker.utc_now,
         "witness.previous_only.sent_at_covers_event");
      bool second_accepted=second_polled && rig.Bind() && rig.Request(second)==TOV2_STATE_OK &&
         rig.Snapshot(pending2) && ResponseForPending(second,1800002000,response2) &&
         rig.Accept(response2)==TOV2_STATE_OK && rig.Snapshot(ack2);
      Check(second_accepted,"witness.previous_only.ack2");
      if(!second_accepted) {delete rig;continue;}
      Tov2StorageLocator witness1=Tov2StorageObjectLocator(pending1.pending.generation,1);
      Tov2StorageLocator witness2=Tov2StorageObjectLocator(pending2.pending.generation,1);
      bool exclusive=ack1.ack_pending_sha==pending1.pending.sha &&
         ack2.ack_pending_sha==pending2.pending.sha &&
         ack2.ack_pending_sha!=pending1.pending.sha && ack2.pending.kind=="-" &&
         ack2.event_count==0;
      Check(exclusive,"witness.previous_only.exclusive");
      if(!exclusive) {delete rig;continue;}

      rig.state.Close();
      ack2.parent_generation=ack1.generation;ack2.parent_commit=ack1_sha;
      string current_sha="";
      bool chain=rig.storage.Remove(Tov2StorageStateLocator(ack2.generation)) &&
         rig.storage.Remove(Tov2StorageCommitLocator(ack2.generation)) &&
         InjectCheckpointRoot(rig.storage,ack2,"CHECKPOINT",current_sha) &&
         Tov2Digest(current_sha);
      Check(chain,"witness.previous_only.chain");
      if(!chain) {delete rig;continue;}
      bool recovered=rig.Restart();
      Check(recovered && rig.storage.Exists(witness1) && rig.storage.Exists(witness2),
         "witness.previous_only.recover");
      if(!recovered) {delete rig;continue;}

      rig.storage.ArmFault("DELETE",1,mode);
      int pruned=rig.state.Compact();
      bool interrupted=rig.storage.FaultSeen()==1 && rig.storage.FaultTriggered() &&
         pruned!=TOV2_STATE_OK && rig.state.ReloadRequired();
      Check(interrupted,"witness.previous_only.prune_fault");
      Check(interrupted && rig.storage.Exists(witness1) && rig.storage.Exists(witness2),
         "witness.previous_only.survives_fault");
      rig.storage.ClearFault();
      bool recovered_after_fault=rig.Restart();
      Check(recovered_after_fault && rig.storage.Exists(witness1) && rig.storage.Exists(witness2),
         "witness.previous_only.recover_after_fault");
      bool retried=recovered_after_fault && rig.state.Compact()==TOV2_STATE_OK;
      Check(retried && rig.storage.Exists(witness1) && rig.storage.Exists(witness2),
         "witness.previous_only.retained");
      Check(retried && rig.storage.Exists(witness1) && rig.storage.Exists(witness2),
         "witness.previous_retained");

      bool recovered_retained=rig.Restart();
      Check(recovered_retained && rig.storage.Exists(witness1) && rig.storage.Exists(witness2),
         "witness.previous_only.recover_retained_roots");
      bool advanced=recovered_retained && rig.state.Compact()==TOV2_STATE_OK;
      Check(advanced && !rig.storage.Exists(witness1) && rig.storage.Exists(witness2),
         "witness.previous_only.eventual_reclaim");
      Check(advanced && !rig.storage.Exists(witness1) && rig.storage.Exists(witness2),
         "witness.eventual_reclaim");
      delete rig;
   }
}

void WitnessRetentionAndDamage()
{
   scenario="witness-production";
   for(int damage=0;damage<2;damage++)
   {
      CTov2OutboxV2Rig *rig=new CTov2OutboxV2Rig;
      if(CheckPointer(rig)==POINTER_INVALID || !rig.Fixture(1)) {Check(false,"witness.damage.fixture");if(CheckPointer(rig)!=POINTER_INVALID) delete rig;continue;}
      uchar request[],response[];Tov2LocalState pending;
      Check(rig.Request(request)==TOV2_STATE_OK && rig.Snapshot(pending) &&
         Tov2CaptureUtf8Bytes(Tov2OutboxV2FixtureResponse(1),response) &&
         rig.Accept(response)==TOV2_STATE_OK,"witness.damage.accept");
      Tov2StorageLocator locator=Tov2StorageObjectLocator(pending.pending.generation,1);
      rig.state.Close();
      bool changed=damage==0?rig.storage.Remove(locator):rig.storage.Corrupt(locator,0);
      int records=rig.storage.RecordCount();
      bool restarted=rig.Restart();
      Check(changed && !restarted && rig.storage.RecordCount()==records,
         damage==0?"witness.missing":"witness.corrupt");
      delete rig;
   }

   CTov2OutboxV2Rig *rig=new CTov2OutboxV2Rig;
   if(CheckPointer(rig)==POINTER_INVALID || !rig.Fixture(1)) {Check(false,"witness.retention.fixture");if(CheckPointer(rig)!=POINTER_INVALID) delete rig;return;}
   uchar first[],response[];Tov2LocalState pending1;
   Check(rig.Request(first)==TOV2_STATE_OK && rig.Snapshot(pending1) &&
      Tov2CaptureUtf8Bytes(Tov2OutboxV2FixtureResponse(1),response) && rig.Accept(response)==TOV2_STATE_OK,
      "witness.retention.ack1");
   Tov2StorageLocator witness1=Tov2StorageObjectLocator(pending1.pending.generation,1);
   Check(rig.state.Compact()==TOV2_STATE_OK && rig.storage.Exists(witness1),"witness.current_retained");
   delete rig;
   PreviousRootWitnessRetention();
}

int ObserveFaultCount(const int action,const string operation,const int mode)
{
   CTov2OutboxV2Rig *rig=new CTov2OutboxV2Rig;
   if(CheckPointer(rig)==POINTER_INVALID || !rig.Fixture(1)) {Check(false,"fault.observe.fixture");if(CheckPointer(rig)!=POINTER_INVALID) delete rig;return 0;}
   uchar request[],response[];
   if(action==1 && (rig.Request(request)!=TOV2_STATE_OK ||
      !Tov2CaptureUtf8Bytes(Tov2OutboxV2FixtureResponse(1),response)))
   {Check(false,"fault.observe.pending");delete rig;return 0;}
   rig.storage.ArmFault(operation,1000000,mode);
   int result=action==0?rig.Request(request):rig.Accept(response);
   int count=rig.storage.FaultSeen();
   Check(result==TOV2_STATE_OK && count>0 && !rig.storage.FaultTriggered(),"fault.observe.count");
   Print("TOV2_OUTBOX_V2_FAULT_COUNTS action=",action==0?"PREPARE":"ACK",
      " operation=",operation," mode=",mode," count=",count);
   delete rig;return count;
}

bool ExpectedPrepareBytes(CTov2OutboxV2Rig *rig,uchar &expected[])
{
   Tov2OutboxContext context;uchar registration[],arena[];int ends[];Tov2OutboxCandidate candidate;
   return rig.ReadContext(context,registration,arena,ends) &&
      rig.adapter.Build(context,registration,arena,ends,1,candidate,expected)==TOV2_OUTBOX_BUILD_OK;
}

void FaultMatrixAction(const int action,const string operation,const int mode,const int count)
{
   for(int occurrence=1;occurrence<=count;occurrence++)
   {
      CTov2OutboxV2Rig *rig=new CTov2OutboxV2Rig;
      if(CheckPointer(rig)==POINTER_INVALID || !rig.Fixture(1)) {Check(false,"fault.fixture");if(CheckPointer(rig)!=POINTER_INVALID) delete rig;return;}
      uchar original[],response[],output[];Tov2LocalState before;
      bool ready=action==0?ExpectedPrepareBytes(rig,original):
         (rig.Request(original)==TOV2_STATE_OK && rig.Snapshot(before) &&
          Tov2CaptureUtf8Bytes(Tov2OutboxV2FixtureResponse(1),response));
      if(!ready) {Check(false,"fault.action.fixture");delete rig;return;}
      rig.storage.ArmFault(operation,occurrence,mode);
      int result=action==0?rig.Request(output):rig.Accept(response);
      string prefix=action==0?"prepare.fault.":"ack.fault.";
      string label=prefix+operation+"."+IntegerToString(mode)+"."+IntegerToString(occurrence);
      Check(rig.storage.FaultSeen()==occurrence && rig.storage.FaultTriggered(),"fault.actual_hit."+label);
      Check(result!=TOV2_STATE_OK && (action==1 || ArraySize(output)==0),label+".interrupted_no_success");
      bool restarted=rig.Restart();Tov2LocalState recovered;
      Check(restarted && rig.Snapshot(recovered),label+".recover");
      if(!restarted) {delete rig;continue;}
      bool old_root=recovered.pending.kind=="PENDING" && recovered.accepted_event==0 &&
         recovered.event_count==1 && recovered.events[0].sequence==1;
      bool new_root=action==0?
         (recovered.pending.kind=="PENDING" && recovered.accepted_event==0 && recovered.event_count==1):
         (recovered.pending.kind=="-" && recovered.accepted_request==1 &&
          recovered.accepted_event==1 && recovered.event_count==0);
      if(action==0)
      {
         bool absent_root=recovered.pending.kind=="-" && recovered.accepted_event==0 &&
            recovered.event_count==1 && recovered.events[0].sequence==1;
         Check(absent_root || new_root,label+".atomic_root");
         Check(rig.Bind() && rig.Request(output)==TOV2_STATE_OK && Tov2LocalEqual(output,original),
            label+".retry_exact");
      }
      else
      {
         Check(old_root || new_root,label+".atomic_root");
         if(old_root) Check(rig.Request(output)==TOV2_STATE_OK && Tov2LocalEqual(output,original),
            label+".pending_exact");
         Check(rig.Accept(response)==TOV2_STATE_OK && rig.Snapshot(recovered) &&
            recovered.pending.kind=="-" && recovered.accepted_request==1 &&
            recovered.accepted_event==1 && recovered.event_count==0,label+".retry_once");
      }
      delete rig;
   }
}

void PublicationFaultMatrix()
{
   scenario="publication-fault-matrix";
   string operations[2]={"CREATE","READ"};
   for(int action=0;action<2;action++)
      for(int op=0;op<2;op++)
         for(int mode=TOV2_MEMORY_FAULT_BEFORE;mode<=TOV2_MEMORY_FAULT_AFTER;mode++)
         {
            int observed=ObserveFaultCount(action,operations[op],mode);
            Check(observed>0,"fault.observed_nonzero");
            FaultMatrixAction(action,operations[op],mode,observed);
         }
}

void OnStart()
{
   GoldenFixtures();
   ReplayLifecycle();
   CandidateAndBindingFailures();
   CheckpointMutationValidation();
   ResponseMutationsAndLiteralAck();
   FailedOutputClearing();
   PrefixAndValueMatrix();
   WitnessRetentionAndDamage();
   PublicationFaultMatrix();
   if(failures==0)
      Print("TOV2_OUTBOX_V2_PASS checks=",checks," failures=0");
   else
      Print("TOV2_OUTBOX_V2_FAIL checks=",checks," failures=",failures);
}
