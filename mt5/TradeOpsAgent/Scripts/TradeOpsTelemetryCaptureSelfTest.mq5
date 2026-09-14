#property strict
#include "../Include/TradeOpsNativeCaptureBroker.mqh"
#include "../Include/TradeOpsAccountSnapshot.mqh"
#include "Support/TradeOpsTelemetryCaptureBroker.mqh"
#include "../Include/TradeOpsJournalCollector.mqh"
#include "Support/TradeOpsTelemetryMemoryStore.mqh"
#include "Support/TradeOpsTelemetryCaptureOutbox.mqh"

int checks=0,failures=0;
string scenario="typed-capture";
void Check(const bool pass)
{
   checks++;
   if(!pass) { failures++; Print("TOV2_CAPTURE_CHECK scenario=",scenario," index=",checks); }
}
void DurableEnrollmentAndCodec()
{
   scenario="durable-enrollment-codec";
   const string golden="5:TCAP1,251:synthetic-account~synthetic-install~synthetic-tracking~0~aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa~bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb~eefe4a344505adb4aaf7fe607b8000c51bd000cbaeaaabc8297f9e7a7bf0d40e,64:519daabec27a753e45f37d9e8dff443cf0d657982444ad7137d57ea9347e1c45,13:1800000000000,10:1800000000,1:2,1:0,13:1800000000000,13:1800000000000,13:1800000000000,13:1800000000000,1:0,1:0,1:-,1:0,10:1800000000,13:1800000000123,10:1800000000,1:0,1:0,410:{\"balance\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"100.00\"}},\"equity\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"100.00\"}},\"margin_free\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"100.00\"}},\"margin_level\":{\"reason\":\"NOT_APPLICABLE\",\"value\":null},\"margin_used\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"0.00\"}},\"observed_at_broker_msc\":1800000000123,\"observed_at_utc_seconds\":1800000000,\"status\":\"COMPLETE\"},8:COMPLETE,10:1800000000,13:1800000000123,1:1,1:1,1052:{\"observed_at_broker_msc\":1800000000123,\"observed_at_utc_seconds\":1800000000,\"order_count\":1,\"orders\":[{\"price\":{\"reason\":null,\"value\":{\"scale\":5,\"value\":\"10.00000\"}},\"sl\":{\"reason\":\"NOT_SET\",\"value\":null},\"state\":\"REQUEST_MODIFY\",\"stop_limit_price\":{\"reason\":null,\"value\":{\"scale\":5,\"value\":\"9.90000\"}},\"symbol\":\"UNLISTED\",\"ticket\":\"9223372036854775809\",\"tp\":{\"reason\":\"NOT_SET\",\"value\":null},\"type\":\"SELL_STOP_LIMIT\",\"volume_current\":{\"scale\":2,\"value\":\"0.10\"},\"volume_initial\":{\"scale\":2,\"value\":\"0.20\"}}],\"position_count\":1,\"positions\":[{\"current_price\":{\"reason\":null,\"value\":{\"scale\":3,\"value\":\"2024.220\"}},\"entry_price\":{\"reason\":null,\"value\":{\"scale\":3,\"value\":\"2024.120\"}},\"floating_profit\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"1.00\"}},\"position_id\":\"9223372036854775808\",\"side\":\"BUY\",\"sl\":{\"reason\":\"NOT_SET\",\"value\":null},\"swap\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.01\"}},\"symbol\":\"XAUUSD.测试\",\"ticket\":\"18446744073709551615\",\"tp\":{\"reason\":\"NOT_SET\",\"value\":null},\"volume\":{\"scale\":2,\"value\":\"0.10\"}}],\"status\":\"COMPLETE\"},1:0,1:0,1:1,19:9223372036854775808,64:94cf66daa2293276d0eae5de72d7d9d41044674406595e4cface5ce8d4044dbe,1:0,";
   uchar golden_bytes[],golden_encoded[];string golden_hash="";Tov2CaptureCheckpoint golden_state;
   Check(Tov2CaptureUtf8Bytes(golden,golden_bytes) && Tov2CaptureCheckpointDecode(golden_bytes,golden_state));
   Check(Tov2CaptureCheckpointEncode(golden_state,golden_encoded) && Tov2LocalEqual(golden_bytes,golden_encoded));
   Check(Tov2LocalHash(golden_bytes,golden_hash) && golden_hash=="cca714485780ec2db7e16cdfbad7f5c451c16dce2cefec1d8ec823b79abece2b");
   CTov2FakeCaptureBroker broker;
   Tov2CaptureEnrollment frozen;
   CTov2JournalCollector collector;
   Check(collector.PrepareEnrollment(GetPointer(broker),"synthetic-account","synthetic-install",
      "synthetic-tracking",0,"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      broker.fingerprint,frozen)==TOV2_STATE_OK);
   CTov2CapturePayloadValidator validator(2);
   CTov2TelemetryMemoryStore storage;
   CTov2TelemetryState state(GetPointer(storage),GetPointer(validator),frozen.identity);
   Check(state.Open()==TOV2_STATE_OK && state.Recover()==TOV2_STATE_NOT_STARTED);
   Check(collector.InitializeFrozen(GetPointer(state),frozen)==TOV2_STATE_OK);
   Tov2LocalState local;string root="dirty";uchar registration[],capture[];
   Check(state.ReadCaptureContext(local,root,registration,capture)==TOV2_STATE_OK);
   Tov2CaptureCheckpoint checkpoint;uchar encoded[];
   Check(Tov2CaptureCheckpointDecode(capture,checkpoint));
   Check(checkpoint.produced==0 && checkpoint.identity==frozen.identity);
   Check(Tov2CaptureCheckpointEncode(checkpoint,encoded) && Tov2LocalEqual(encoded,capture));
   uchar invalid[];Tov2LocalCopy(capture,invalid);invalid[0]=48;
   Check(!Tov2CaptureCheckpointDecode(invalid,checkpoint) && checkpoint.identity=="");
   Check(collector.Poll(GetPointer(state),GetPointer(broker))==TOV2_STATE_OK);
   string coverage="";Check(collector.ReadCoverage(GetPointer(state),coverage)==TOV2_STATE_OK);
   Check(coverage=="UP_TO_DATE");
   state.Close();
   root="dirty";
   Check(state.ReadCaptureContext(local,root,registration,capture)==TOV2_STATE_OWNERSHIP_LOST);
   Check(root=="" && local.identity=="" && ArraySize(registration)==0 && ArraySize(capture)==0);
}
class CTov2CaptureRig
{
public:
   CTov2FakeCaptureBroker broker;
   CTov2TelemetryMemoryStore storage;
   CTov2CaptureTestWire wire;
   CTov2CaptureTestOutbox outbox;
   CTov2JournalCollector *collector;
   CTov2CapturePayloadValidator *validator;
   CTov2TelemetryState *state;
   Tov2CaptureEnrollment frozen;
   CTov2CaptureRig() {state=NULL;validator=NULL;collector=new CTov2JournalCollector;}
   ~CTov2CaptureRig()
   {
      if(CheckPointer(state)!=POINTER_INVALID) {state.Close();delete state;}
      if(CheckPointer(validator)!=POINTER_INVALID) delete validator;
      if(CheckPointer(collector)!=POINTER_INVALID) delete collector;
   }
   bool Init()
   {
      if(CheckPointer(collector)==POINTER_INVALID || CheckPointer(state)!=POINTER_INVALID ||
         CheckPointer(validator)!=POINTER_INVALID) return false;
      if(collector.PrepareEnrollment(GetPointer(broker),"synthetic-account","synthetic-install",
         "synthetic-tracking",0,"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",broker.fingerprint,frozen)!=TOV2_STATE_OK) return false;
      validator=new CTov2CapturePayloadValidator(2,GetPointer(wire));
      if(CheckPointer(validator)==POINTER_INVALID) return false;
      state=new CTov2TelemetryState(GetPointer(storage),validator,frozen.identity);
      if(CheckPointer(state)==POINTER_INVALID) return false;
      return state.Open()==TOV2_STATE_OK && state.Recover()==TOV2_STATE_NOT_STARTED &&
         collector.InitializeFrozen(state,frozen)==TOV2_STATE_OK;
   }
   bool Read(Tov2CaptureCheckpoint &capture,Tov2LocalState &local)
   {
      Tov2CaptureCheckpointClear(capture);Tov2LocalClearState(local);
      if(CheckPointer(state)==POINTER_INVALID) return false;
      string root="";uchar reg[],bytes[];
      Tov2LocalState staged_local;Tov2CaptureCheckpoint staged_capture;
      if(state.ReadCaptureContext(staged_local,root,reg,bytes)!=TOV2_STATE_OK ||
         !Tov2CaptureCheckpointDecode(bytes,staged_capture)) return false;
      local=staged_local;capture=staged_capture;return true;
   }
   bool Restart()
   {
      string installation="";
      if(!Tov2LocalIdentity(frozen.identity,installation)) return false;
      storage.Crash();
      if(CheckPointer(state)!=POINTER_INVALID) delete state;
      if(CheckPointer(validator)!=POINTER_INVALID) delete validator;
      if(CheckPointer(collector)!=POINTER_INVALID) delete collector;
      state=NULL;validator=NULL;collector=NULL;
      collector=new CTov2JournalCollector;
      if(CheckPointer(collector)==POINTER_INVALID) return false;
      validator=new CTov2CapturePayloadValidator(2,GetPointer(wire));
      if(CheckPointer(validator)==POINTER_INVALID) return false;
      state=new CTov2TelemetryState(GetPointer(storage),validator,frozen.identity);
      if(CheckPointer(state)==POINTER_INVALID) return false;
      return state.Open()==TOV2_STATE_OK && state.Recover()==TOV2_STATE_OK && collector.Recover(state)==TOV2_STATE_OK;
   }
   bool Prepare(uchar &pending[])
   {
      ArrayResize(pending,0);
      if(CheckPointer(state)==POINTER_INVALID) return false;
      Tov2LocalState local;string root="";uchar reg[],capture[];
      if(state.ReadCaptureContext(local,root,reg,capture)!=TOV2_STATE_OK || !outbox.Bind(local,root,reg,capture)) return false;
      Tov2OutboxContext context;uchar event_arena[];int ends[];
      if(state.ReadOutboxContext(context,reg,event_arena,ends)!=TOV2_STATE_OK) return false;
      Tov2OutboxCandidate candidate;uchar request[];
      if(outbox.Build(context,reg,event_arena,ends,ArraySize(ends),candidate,request)!=TOV2_OUTBOX_BUILD_OK) return false;
      return state.PreparePending(GetPointer(outbox),candidate,request,pending)==TOV2_STATE_OK;
   }
   bool AckAll()
   {
      for(int i=0;i<17;i++)
      {
         Tov2LocalState local;Tov2CaptureCheckpoint capture;
         if(!Read(capture,local)) return false;
         if(local.event_count==0) return true;
         uchar pending[],response[];
         if(!Prepare(pending) || !state.Snapshot(local) || !outbox.Response(local,response) ||
            state.AcceptResponse(GetPointer(outbox),response)!=TOV2_STATE_OK) return false;
      }
      return false;
   }
};
void UninitializedRigHelpersFailClosed()
{
   scenario="uninitialized-rig-helpers";
   CTov2CaptureRig rig;
   Tov2CaptureCheckpoint capture;capture.identity="prefilled";
   Tov2LocalState local;local.identity="prefilled";
   uchar pending[];ArrayResize(pending,3);
   Check(!rig.Read(capture,local));
   Check(capture.identity=="" && local.identity=="");
   Check(!rig.Prepare(pending) && ArraySize(pending)==0);
   Check(!rig.Restart() && !rig.AckAll());
   Check(rig.Init());
   Check(rig.Read(capture,local) && capture.identity==rig.frozen.identity);
}
void CollectorBoundaryRace()
{
   scenario="boundary-race";
   CTov2CaptureRig race;race.broker.boundary_race=true;
   Check(!race.Init() && race.broker.boundary_calls==6 && race.storage.PersistentCount()==0);
   CTov2CaptureRig rig;rig.broker.SetPositions(1);
   ArrayResize(rig.broker.boundary_ids,2);rig.broker.boundary_ids[0]="2";rig.broker.boundary_ids[1]="10";
   Check(rig.Init());Tov2CaptureRegistration registration;string json="";
   Check(Tov2CaptureUtf8Text(rig.frozen.registration,json) && Tov2CaptureDecodeRegistration(json,registration));
   Check(registration.boundary.excluded_boundary_deal_ids[0]=="10");
   long start=rig.broker.broker_now;
   rig.broker.AddDeal("1",start-1);rig.broker.AddDeal("2",start);rig.broker.AddDeal("10",start);
   rig.broker.deals[2].result=TOV2_CAPTURE_UNSUPPORTED;
   rig.broker.AddDeal("3",start+1000);rig.broker.broker_now+=2000;rig.broker.utc_now+=2;
   Check(rig.collector.Poll(rig.state,GetPointer(rig.broker))==TOV2_STATE_OK);
   Tov2CaptureCheckpoint c;Tov2LocalState s;Check(rig.Read(c,s));
   Check(c.produced==1 && c.revision_count==1 && c.revisions[0].ticket=="3");
   Check(c.start_msc==start && c.record_gap=="-");
}
void CollectorHistoryAndProtection()
{
   scenario="history-pagination-protection-drain";
   CTov2CaptureRig rig;rig.broker.SetPositions(40);Check(rig.Init());
   for(int i=0;i<40;i++)
   {
      rig.broker.AddDeal(IntegerToString(100+i),rig.broker.broker_now);
      Tov2CaptureFromDouble(1.2,5,rig.broker.exposure.positions[i].sl);
   }
   rig.broker.reverse_history=true;
   Check(rig.collector.Poll(rig.state,GetPointer(rig.broker))==TOV2_STATE_OK);
   Tov2CaptureCheckpoint c;Tov2LocalState s;Check(rig.Read(c,s));
   Check(c.produced==32 && c.revision_count==16 && !c.scan_finished);
   long original_time=c.attempt_broker;
   for(int i=0;i<40;i++) Tov2CaptureFromDouble(1.3,5,rig.broker.exposure.positions[i].sl);
   rig.broker.broker_now+=1000;rig.broker.utc_now++;rig.collector.MarkDirty();
   Check(rig.collector.Poll(rig.state,GetPointer(rig.broker))==TOV2_STATE_OK);
   Check(rig.Read(c,s) && c.produced==64 && c.attempt_broker==original_time && c.observation_gap);
   Check(rig.collector.Poll(rig.state,GetPointer(rig.broker))==TOV2_STATE_OK);
   Check(rig.Read(c,s) && c.produced==80 && c.revision_count==40 && c.attempt_broker==original_time);
   for(int i=0;i<c.queue_count;i++) if(i>=32) Check(c.queued[i].observed_utc>=1800000010);
   Check(rig.AckAll());Check(rig.Restart());
   Check(rig.collector.Poll(rig.state,GetPointer(rig.broker))==TOV2_STATE_OK);
   Check(rig.Read(c,s) && c.revision_count==40 && c.produced==112);
}
void CollectorAcknowledgedCorrection()
{
   scenario="acknowledged-revision-and-pending";
   CTov2CaptureRig rig;Check(rig.Init());long start=rig.broker.broker_now;
   rig.broker.AddDeal("700",start,"BUY","INOUT");
   rig.broker.AddDeal("701",start,"COMMISSION_DAILY","NONE");
   Check(rig.collector.Poll(rig.state,GetPointer(rig.broker))==TOV2_STATE_OK);
   Tov2CaptureCheckpoint c;Tov2LocalState s;Check(rig.Read(c,s) && c.produced==2);
   string first=c.revisions[Tov2CaptureFindRevision(c,"700")].record_sha;
   uchar pending[],again[];Check(rig.Prepare(pending));
   rig.broker.deals[0].deal.type="BUY_CANCELED";
   Tov2CaptureFromDouble(-7.0,2,rig.broker.deals[0].deal.profit);
   Check(rig.collector.Poll(rig.state,GetPointer(rig.broker))==TOV2_STATE_OK);
   Check(rig.state.ReadPending(again)==TOV2_STATE_OK && Tov2LocalEqual(pending,again));
   Check(rig.Read(c,s));string second=c.revisions[Tov2CaptureFindRevision(c,"700")].record_sha;
   Check(rig.AckAll() && rig.Restart());
   Check(rig.collector.Poll(rig.state,GetPointer(rig.broker))==TOV2_STATE_OK);
   Check(rig.Read(c,s) && c.produced==3 && s.accepted_event==3);
   rig.broker.deals[0].deal.type="BUY";
   Check(rig.collector.Poll(rig.state,GetPointer(rig.broker))==TOV2_STATE_OK);
   Check(rig.Read(c,s) && c.produced==4 && c.revisions[Tov2CaptureFindRevision(c,"700")].revision==3);
   Tov2OutboxContext context;uchar registration[],arena[];int ends[];
   Check(rig.state.ReadOutboxContext(context,registration,arena,ends)==TOV2_STATE_OK);
   string json="";Tov2CaptureDeal deal;
   Check(Tov2CaptureUtf8Text(arena,json) && Tov2CaptureDecodeDeal(json,2,deal));
   Check(deal.revision==3 && deal.previous_record_sha256==second && second!=first && deal.entry=="INOUT");
}
void CollectorHistoryFailures()
{
   scenario="history-failed-empty-overflow";
   CTov2CaptureRig rig;Check(rig.Init());
   rig.broker.history_result=TOV2_CAPTURE_READ_FAILED;
   Check(rig.collector.Poll(rig.state,GetPointer(rig.broker))==TOV2_STATE_OK);
   Tov2CaptureCheckpoint c;Tov2LocalState s;Check(rig.Read(c,s));
   Check(c.record_gap=="HISTORY_UNAVAILABLE" && c.produced==0 && c.watermark==0);
   rig.broker.history_result=TOV2_CAPTURE_OK;rig.broker.overflow_window_msc=1;
   Check(rig.collector.Poll(rig.state,GetPointer(rig.broker))==TOV2_STATE_OK);
   Check(rig.Read(c,s) && c.forward_start==c.start_msc && c.watermark==0);
   rig.broker.overflow_window_msc=2000;rig.broker.utc_now+=60;rig.broker.broker_now+=60000;
   Check(rig.collector.Poll(rig.state,GetPointer(rig.broker))==TOV2_STATE_OK);
   Check(rig.Read(c,s) && c.forward_start>c.start_msc && c.reconcile && c.watermark==0);
   rig.broker.overflow_window_msc=0;
   for(int i=0;i<4;i++) Check(rig.collector.Poll(rig.state,GetPointer(rig.broker))==TOV2_STATE_OK);
   Check(rig.Read(c,s) && c.record_gap=="-" && c.scan_finished && c.produced==0);
   rig.broker.account_result=TOV2_CAPTURE_READ_FAILED;
   Check(rig.collector.Poll(rig.state,GetPointer(rig.broker))==TOV2_STATE_OK);
   Check(rig.Read(c,s) && c.record_gap=="CAPTURE_FAILED");
   rig.broker.account_result=TOV2_CAPTURE_OK;
   for(int i=0;i<4;i++) Check(rig.collector.Poll(rig.state,GetPointer(rig.broker))==TOV2_STATE_OK);
   Check(rig.Read(c,s) && c.record_gap=="-");
}
void CollectorUnsupportedAndMissing()
{
   scenario="unsupported-quarantine";
   CTov2CaptureRig rig;Check(rig.Init());rig.broker.AddDeal("50",rig.broker.broker_now);
   rig.broker.deals[0].result=TOV2_CAPTURE_UNSUPPORTED;
   rig.broker.deals[0].raw_type=999;rig.broker.deals[0].raw_reason=998;
   Check(rig.collector.Poll(rig.state,GetPointer(rig.broker))==TOV2_STATE_OK);
   Tov2CaptureCheckpoint c;Tov2LocalState s;Check(rig.Read(c,s));
   Check(c.quarantine && c.quarantine_ticket=="50" && c.quarantine_type==999 && c.produced==0);
   CTov2CaptureRig missing;Check(missing.Init());missing.broker.AddDeal("51",missing.broker.broker_now);
   Check(missing.collector.Poll(missing.state,GetPointer(missing.broker))==TOV2_STATE_OK);
   missing.broker.deal_count=0;
   Check(missing.collector.Poll(missing.state,GetPointer(missing.broker))==TOV2_STATE_OK);
   Check(missing.Read(c,s) && c.record_gap=="HISTORY_UNAVAILABLE" && c.produced==1);
}
void CollectorClockAndIdentity()
{
   scenario="clock-reconcile-and-identity";
   CTov2CaptureRig rig;Check(rig.Init());
   Check(rig.collector.Poll(rig.state,GetPointer(rig.broker))==TOV2_STATE_OK);
   rig.broker.broker_now+=60000;rig.broker.utc_now++;
   Check(rig.collector.Poll(rig.state,GetPointer(rig.broker))==TOV2_STATE_OK);
   Tov2CaptureCheckpoint c;Tov2LocalState s;Check(rig.Read(c,s));
   Check(c.reconcile && c.watermark==0 && !c.scan_finished && c.record_gap=="CLOCK_DISCONTINUITY");
   long generation=s.generation;
   rig.broker.switch_identity=true;
   Check(rig.collector.Poll(rig.state,GetPointer(rig.broker))==TOV2_STATE_IDENTITY_MISMATCH);
   Check(rig.Read(c,s) && s.generation==generation);
   CTov2CaptureRig burst;Check(burst.Init());int reads=burst.broker.history_calls;
   for(int i=0;i<1000;i++) burst.collector.MarkDirty();
   Check(burst.broker.history_calls==reads);
   Check(burst.collector.Poll(burst.state,GetPointer(burst.broker))==TOV2_STATE_OK);
   Check(burst.Read(c,s) && c.observation_gap);
   string coverage="";Check(burst.collector.ReadCoverage(burst.state,coverage)==TOV2_STATE_OK && coverage=="UP_TO_DATE");
   burst.broker.utc_now+=120;
   Check(burst.collector.Poll(burst.state,GetPointer(burst.broker))==TOV2_STATE_OK);
   Check(burst.Read(c,s) && c.attempt_utc==burst.broker.utc_now && !c.reconcile);
   rig.collector.ReadCoverage(rig.state,coverage);Check(coverage!="UP_TO_DATE");
}
void CollectorCrashMatrix()
{
   scenario="append-crash-matrix";
   for(int mode=TOV2_MEMORY_FAULT_BEFORE;mode<=TOV2_MEMORY_FAULT_AFTER;mode++)
      for(int point=1;point<=4;point++)
      {
         CTov2CaptureRig rig;Check(rig.Init());rig.broker.AddDeal("90",rig.broker.broker_now);
         rig.storage.ArmFault("CREATE",point,mode);
         Check(rig.collector.Poll(rig.state,GetPointer(rig.broker))!=TOV2_STATE_OK);
         Check(rig.Restart());Tov2CaptureCheckpoint c;Tov2LocalState s;Check(rig.Read(c,s));
         bool committed=mode==TOV2_MEMORY_FAULT_AFTER && point==4;
         Check(c.produced==(committed?1:0) && c.revision_count==(committed?1:0));
         Check(rig.collector.Poll(rig.state,GetPointer(rig.broker))==TOV2_STATE_OK);
         Check(rig.Read(c,s) && c.produced==1 && c.revision_count==1);
      }
}
void CollectorOldWindowCorrection()
{
   scenario="old-window-rotation";
   CTov2CaptureRig rig;Check(rig.Init());long start=rig.broker.broker_now;
   rig.broker.AddDeal("300",start);rig.broker.AddDeal("301",start+60000);rig.broker.AddDeal("302",start+120000);
   rig.broker.broker_now+=180000;rig.broker.utc_now+=180;
   for(int i=0;i<8;i++) Check(rig.collector.Poll(rig.state,GetPointer(rig.broker))==TOV2_STATE_OK);
   Tov2CaptureCheckpoint c;Tov2LocalState s;Check(rig.Read(c,s) && c.produced==3 && c.scan_finished);
   string previous=c.revisions[Tov2CaptureFindRevision(c,"300")].record_sha;
   Check(rig.AckAll() && rig.Restart());
   Tov2CaptureFromDouble(99.0,2,rig.broker.deals[0].deal.profit);
   for(int i=0;i<8;i++) Check(rig.collector.Poll(rig.state,GetPointer(rig.broker))==TOV2_STATE_OK);
   Check(rig.Read(c,s) && c.produced==4 && c.revisions[Tov2CaptureFindRevision(c,"300")].revision==2);
   Tov2OutboxContext context;uchar reg[],arena[];int ends[];string json="";Tov2CaptureDeal deal;
   Check(rig.state.ReadOutboxContext(context,reg,arena,ends)==TOV2_STATE_OK);
   Check(Tov2CaptureUtf8Text(arena,json) && Tov2CaptureDecodeDeal(json,2,deal));
   Check(deal.previous_record_sha256==previous && deal.profit.fixed.value=="99.00");
}
void CheckpointRejectsMalformedAndRegression()
{
   scenario="checkpoint-malformed-and-regression";
   CTov2CaptureRig rig;Check(rig.Init());Tov2CaptureCheckpoint c;Tov2LocalState s;
   Check(rig.Read(c,s));uchar valid[],bad[],encoded[];
   Check(Tov2CaptureCheckpointEncode(c,valid));
   for(int cut=1;cut<20;cut++)
   {
      Tov2LocalCopy(valid,bad);ArrayResize(bad,cut);
      Tov2CaptureCheckpoint out;Check(!Tov2CaptureCheckpointDecode(bad,out) && out.identity=="");
   }
   Tov2LocalCopy(valid,bad);int n=ArraySize(bad);ArrayResize(bad,n+1);bad[n]=44;
   Tov2CaptureCheckpoint out;Check(!Tov2CaptureCheckpointDecode(bad,out));
   Tov2LocalCopy(valid,bad);bad[3]=255;Check(!Tov2CaptureCheckpointDecode(bad,out));
   Tov2CaptureUtf8Bytes("05:TCAP1,",bad);Check(!Tov2CaptureCheckpointDecode(bad,out));
   Tov2CaptureUtf8Bytes("9999999:TCAP1,",bad);Check(!Tov2CaptureCheckpointDecode(bad,out));
   Tov2CaptureCheckpoint next=c;next.produced=1;
   next.revision_count=1;next.revisions[0].ticket="1";next.revisions[0].revision=1;
   next.revisions[0].broker_msc=c.start_msc;
   next.revisions[0].record_sha="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
   next.revisions[0].content_sha="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
   Check(Tov2CaptureCheckpointEncode(next,encoded));
   Check(rig.validator.CaptureAdvance(valid,TOV2_CAPTURE_SCHEMA,encoded,TOV2_CAPTURE_SCHEMA,c.identity));
   Tov2CaptureCheckpoint old=next;uchar old_bytes[];Tov2LocalCopy(encoded,old_bytes);
   next.produced=0;Check(!Tov2CaptureCheckpointEncode(next,bad));
   next=old;next.revision_count=0;Check(Tov2CaptureCheckpointEncode(next,bad));
   Check(!rig.validator.CaptureAdvance(old_bytes,TOV2_CAPTURE_SCHEMA,bad,TOV2_CAPTURE_SCHEMA,c.identity));
   next=old;next.revisions[0].revision=2;
   Check(!Tov2CaptureCheckpointEncode(next,bad));
   next=old;next.produced=2;next.revisions[0].revision=2;
   next.revisions[0].record_sha="cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
   next.revisions[0].content_sha="dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";
   Check(Tov2CaptureCheckpointEncode(next,bad));
   Check(rig.validator.CaptureAdvance(old_bytes,TOV2_CAPTURE_SCHEMA,bad,TOV2_CAPTURE_SCHEMA,c.identity));
   next=old;next.currency_scale=8;Check(!Tov2CaptureCheckpointEncode(next,bad));
   next=old;next.queue_count=513;Check(!Tov2CaptureCheckpointEncode(next,bad));
   next=old;next.revision_count=1025;Check(!Tov2CaptureCheckpointEncode(next,bad));
   next=old;next.watermark=c.start_msc+1000;Check(!Tov2CaptureCheckpointEncode(next,bad));
   // A full non-evicting ledger and a full exposure independently exhaust encoded bytes.
   next=c;next.produced=1024;next.revision_count=1024;
   for(int i=0;i<1024;i++)
   {
      next.revisions[i]=old.revisions[0];next.revisions[i].ticket=IntegerToString(10000+i);
   }
   Check(Tov2CaptureCheckpointEncode(next,bad));
   CTov2FakeCaptureBroker full;full.SetPositions(128);full.SetOrders(128);
   Tov2CaptureExposure exposure=full.exposure;exposure.observed_at_utc_seconds=c.initialized_utc;
   exposure.observed_at_broker_msc=c.start_msc;
   Check(Tov2CaptureEncodeExposure(exposure,2,next.last_complete_json));
   next.position_count=128;next.order_count=128;
   Check(!Tov2CaptureCheckpointEncode(next,bad));
}
class CTov2ReentrantCaptureValidator : public CTov2CapturePayloadValidator
{
public:
   CTov2TelemetryState *target;
   bool guarded;
   CTov2ReentrantCaptureValidator():CTov2CapturePayloadValidator(2) {target=NULL;guarded=false;}
   virtual bool Registration(const uchar &payload[],const string identity)
   {
      bool valid=CTov2CapturePayloadValidator::Registration(payload,identity);
      if(CheckPointer(target)!=POINTER_INVALID)
      {
         Tov2LocalState local;local.identity="prefilled";string root="prefilled";uchar registration[],capture[];
         ArrayResize(registration,1);ArrayResize(capture,1);
         int result=target.ReadCaptureContext(local,root,registration,capture);
         guarded=result==TOV2_STATE_BUSY && local.identity=="" && root=="" &&
            ArraySize(registration)==0 && ArraySize(capture)==0;
      }
      return valid;
   }
};
void CaptureReadGuardAndCorruption()
{
   scenario="capture-read-guard-root-corruption";
   CTov2FakeCaptureBroker broker;CTov2JournalCollector collector;Tov2CaptureEnrollment frozen;
   Check(collector.PrepareEnrollment(GetPointer(broker),"a","i","t",0,
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",broker.fingerprint,frozen)==TOV2_STATE_OK);
   CTov2ReentrantCaptureValidator validator;CTov2TelemetryMemoryStore storage;
   CTov2TelemetryState state(GetPointer(storage),GetPointer(validator),frozen.identity);
   validator.target=GetPointer(state);
   Check(state.Open()==TOV2_STATE_OK && state.Recover()==TOV2_STATE_NOT_STARTED);
   Check(collector.InitializeFrozen(GetPointer(state),frozen)==TOV2_STATE_OK && validator.guarded);
   Tov2LocalState local;string root="";uchar registration[],capture[];
   Check(state.ReadCaptureContext(local,root,registration,capture)==TOV2_STATE_OK);
   Check(storage.Corrupt(Tov2StorageCommitLocator(local.generation),0));
   local.identity="prefilled";root="prefilled";
   Check(state.ReadCaptureContext(local,root,registration,capture)!=TOV2_STATE_OK);
   Check(local.identity=="" && root=="" && ArraySize(registration)==0 && ArraySize(capture)==0);
   state.Close();
}
void CollectorCapacityAndDuplicates()
{
   scenario="collector-capacity-no-eviction";
   CTov2CaptureRig rig;Check(rig.Init());
   for(int batch=0;batch<32;batch++)
   {
      rig.broker.broker_now+=1000;rig.broker.utc_now++;
      for(int i=0;i<32;i++) rig.broker.AddDeal(IntegerToString(10000+batch*32+i),rig.broker.broker_now);
      Tov2CaptureCheckpoint c;Tov2LocalState s;
      for(int pass=0;pass<16;pass++)
      {
         Check(rig.collector.Poll(rig.state,GetPointer(rig.broker))==TOV2_STATE_OK);
         Check(rig.Read(c,s));
         if(c.produced==(batch+1)*32) break;
      }
      Check(rig.Read(c,s) && c.produced==(batch+1)*32 && c.revision_count==(batch+1)*32);
      Check(rig.AckAll());
   }
   Tov2CaptureCheckpoint prior;Tov2LocalState s;Check(rig.Read(prior,s));
   Check(prior.revision_count==1024 && s.accepted_event==1024);
   rig.broker.broker_now+=1000;rig.broker.utc_now++;rig.broker.AddDeal("20000",rig.broker.broker_now);
   int result=TOV2_STATE_OK;
   for(int pass=0;pass<16 && result==TOV2_STATE_OK;pass++)
      result=rig.collector.Poll(rig.state,GetPointer(rig.broker));
   Check(result==TOV2_STATE_LIMIT);
   Tov2CaptureCheckpoint after;Check(rig.Read(after,s));
   Check(after.revision_count==1024 && after.produced==1024 && after.record_gap=="HISTORY_UNAVAILABLE");
   for(int i=0;i<1024;i++) Check(after.revisions[i].ticket==prior.revisions[i].ticket &&
      after.revisions[i].record_sha==prior.revisions[i].record_sha);
   scenario="conflicting-duplicate";
   CTov2CaptureRig duplicate;Check(duplicate.Init());
   duplicate.broker.AddDeal("600",duplicate.broker.broker_now);
   duplicate.broker.AddDeal("600",duplicate.broker.broker_now);
   Check(duplicate.collector.Poll(duplicate.state,GetPointer(duplicate.broker))==TOV2_STATE_OK);
   Check(duplicate.Read(after,s) && after.produced==1);
   Tov2CaptureFromDouble(20.0,2,duplicate.broker.deals[1].deal.profit);
   Check(duplicate.collector.Poll(duplicate.state,GetPointer(duplicate.broker))==TOV2_STATE_OK);
   Check(duplicate.Read(after,s) && after.produced==1 && after.record_gap=="HISTORY_UNAVAILABLE");
}
void EnrollmentRequiresFreshQuote()
{
   scenario="fresh-quote-enrollment";
   CTov2CaptureQuoteFreshness gate;
   gate.Observe(1000,100,true);Check(!gate.Ready(1000,100));
   gate.Observe(1000,200,true);Check(!gate.Ready(1000,200));
   gate.Observe(2000,300,true);Check(gate.Ready(2000,300));
   Check(!gate.Ready(1000,300) && !gate.Ready(2000,1301));
   gate.Observe(3000,2000,true);Check(!gate.Ready(3000,2000));
   gate.Observe(4000,2100,true);Check(gate.Ready(4000,2100));
   gate.Observe(4000,2200,false);Check(!gate.Ready(4000,2200));
   gate.Observe(5000,2300,true);Check(!gate.Ready(5000,2300));
   gate.Observe(6000,2400,true);Check(gate.Ready(6000,2400));
   gate.Observe(5000,2500,true);Check(!gate.Ready(5000,2500));
   gate.Reset();Check(!gate.Ready(6000,2400));
   CTov2CaptureRig rig;rig.broker.enrollment_ready=false;
   long friday=rig.broker.broker_now;
   rig.broker.utc_now+=2*86400;
   rig.broker.AddDeal("800",friday+86400000,"BALANCE","NONE");
   Check(!rig.Init() && rig.frozen.identity=="" && rig.storage.PersistentCount()==0);
   Check(ArraySize(rig.frozen.registration)==0 && ArraySize(rig.frozen.capture)==0);
   rig.broker.broker_now+=3*86400000;rig.broker.utc_now+=86400;rig.broker.enrollment_ready=true;
   ArrayResize(rig.broker.boundary_ids,1);rig.broker.boundary_ids[0]="801";
   rig.broker.AddDeal("801",rig.broker.broker_now,"BALANCE","NONE");
   Check(rig.Init());
   rig.broker.broker_now+=1000;rig.broker.utc_now++;rig.broker.AddDeal("802",rig.broker.broker_now);
   Check(rig.collector.Poll(rig.state,GetPointer(rig.broker))==TOV2_STATE_OK);
   Tov2CaptureCheckpoint c;Tov2LocalState s;
   Check(rig.Read(c,s) && c.produced==1 && c.revisions[0].ticket=="802" && c.start_msc>friday);
}
void DiscardedSampleMarksObservationGap()
{
   scenario="discarded-complete-sample";
   for(int unsupported=0;unsupported<2;unsupported++)
   {
      CTov2CaptureRig rig;rig.broker.SetPositions(1);Check(rig.Init());
      Tov2CaptureFromDouble(1.2,5,rig.broker.exposure.positions[0].sl);
      if(unsupported==0) rig.broker.history_result=TOV2_CAPTURE_READ_FAILED;
      else
      {
         rig.broker.AddDeal("810",rig.broker.broker_now);
         rig.broker.deals[0].result=TOV2_CAPTURE_UNSUPPORTED;
         rig.broker.deals[0].raw_type=999;rig.broker.deals[0].raw_reason=999;
      }
      Check(rig.collector.Poll(rig.state,GetPointer(rig.broker))==TOV2_STATE_OK);
      Tov2CaptureCheckpoint c;Tov2LocalState s;Check(rig.Read(c,s) && c.observation_gap && c.produced==0);
      Tov2CaptureMissing(rig.broker.exposure.positions[0].sl,"NOT_SET");
      rig.broker.history_result=TOV2_CAPTURE_OK;rig.broker.deal_count=0;
      Check(rig.collector.Poll(rig.state,GetPointer(rig.broker))==TOV2_STATE_OK);
      Check(rig.Read(c,s) && c.observation_gap && c.produced==0);
   }
}
void DeferredProtectionBlocksCompleteCoverage()
{
   scenario="protection-only-ack-between-polls";
   CTov2CaptureRig rig;rig.broker.SetPositions(40);Check(rig.Init());
   for(int i=0;i<40;i++) Tov2CaptureFromDouble(1.2,5,rig.broker.exposure.positions[i].sl);
   Check(rig.collector.Poll(rig.state,GetPointer(rig.broker))==TOV2_STATE_OK);
   Tov2CaptureCheckpoint c;Tov2LocalState s;Check(rig.Read(c,s) && c.produced==32);
   Check(rig.AckAll());string coverage="";
   Check(rig.collector.ReadCoverage(rig.state,coverage)==TOV2_STATE_OK && coverage=="CATCHING_UP");
   Check(rig.collector.Poll(rig.state,GetPointer(rig.broker))==TOV2_STATE_OK);
   Check(rig.Read(c,s) && c.produced==40);
   Check(rig.AckAll());
   Check(rig.collector.ReadCoverage(rig.state,coverage)==TOV2_STATE_OK && coverage=="UP_TO_DATE");
}
void ClockAnchorAndPreEnrollmentReversal()
{
   scenario="idle-quote-clock-anchor";
   CTov2CaptureRig idle;Check(idle.Init());long initial=idle.broker.utc_now;
   Check(idle.collector.Poll(idle.state,GetPointer(idle.broker))==TOV2_STATE_OK);
   idle.broker.utc_now+=10;
   Check(idle.collector.Poll(idle.state,GetPointer(idle.broker))==TOV2_STATE_OK);
   Tov2CaptureCheckpoint c;Tov2LocalState s;
   Check(idle.Read(c,s) && c.broker_anchor_utc==initial && c.previous_utc==initial+10);
   idle.broker.utc_now++;idle.broker.broker_now+=11000;
   Check(idle.collector.Poll(idle.state,GetPointer(idle.broker))==TOV2_STATE_OK);
   Check(idle.Read(c,s) && !c.reconcile && c.record_gap=="-" && c.broker_anchor_utc==initial+11);
   scenario="utc-before-enrollment";
   CTov2CaptureRig reversed;Check(reversed.Init());
   Check(reversed.collector.Poll(reversed.state,GetPointer(reversed.broker))==TOV2_STATE_OK);
   reversed.broker.utc_now-=10;
   Check(reversed.collector.Poll(reversed.state,GetPointer(reversed.broker))==TOV2_STATE_OK);
   Check(reversed.Read(c,s) && c.watermark==0 && c.reconcile && !c.scan_finished && c.record_gap=="CLOCK_DISCONTINUITY");
   Check(reversed.collector.Poll(reversed.state,GetPointer(reversed.broker))==TOV2_STATE_OK);
   Check(reversed.Read(c,s) && c.watermark==0 && c.reconcile && c.produced==0);
   reversed.broker.utc_now=c.initialized_utc;
   Check(reversed.collector.Poll(reversed.state,GetPointer(reversed.broker))==TOV2_STATE_OK);
   Check(reversed.Read(c,s) && c.record_gap=="-" && c.scan_finished && c.produced==0);
}
void Golden(const string kind,const int scale,const string canonical,const string expected_hash)
{
   string output="",hash="";
   bool ok=false;
   if(kind=="account") { Tov2CaptureAccount a; ok=Tov2CaptureDecodeAccount(canonical,scale,a) && Tov2CaptureEncodeAccount(a,scale,output); }
   if(kind=="exposure") { Tov2CaptureExposure e; ok=Tov2CaptureDecodeExposure(canonical,scale,e) && Tov2CaptureEncodeExposure(e,scale,output); }
   if(kind=="registration") { Tov2CaptureRegistration r; ok=Tov2CaptureDecodeRegistration(canonical,r) && Tov2CaptureEncodeRegistration(r,output); }
   if(kind=="deal")
   {
      Tov2CaptureDeal d; ok=Tov2CaptureDecodeDeal(canonical,scale,d) && Tov2CaptureEncodeDeal(d,scale,d.revision,d.previous_record_sha256,output);
      string content="",same="",next="",next_hash="";
      Check(Tov2CaptureDealContentHash(d,scale,content) && content!=expected_hash);
      d.revision=2;d.previous_record_sha256=expected_hash;
      Check(Tov2CaptureDealContentHash(d,scale,same) && same==content);
      Check(Tov2CaptureEncodeDeal(d,scale,2,expected_hash,next) && Tov2CaptureRecordHash(next,next_hash) && next_hash!=expected_hash);
      Check(!Tov2CaptureEncodeDeal(d,scale,2,"",next));
   }
   if(kind=="protection") { Tov2CaptureProtection p; ok=Tov2CaptureDecodeProtection(canonical,p) && Tov2CaptureEncodeProtection(p,output); }
   Check(ok && output==canonical);
   Check(Tov2CaptureRecordHash(output,hash) && hash==expected_hash);
}
void ScaleCases()
{
   Tov2CaptureReading r;
   for(int i=0;i<3;i++) { int scale=i==0?0:(i==1?2:8); Check(Tov2CaptureFromDouble(123.0,scale,r)); Check(r.fixed.scale==scale); }
   int scale=-1;
   Check(Tov2CaptureVolumeScale(0.01,scale) && scale==2);
   Check(Tov2CaptureVolumeScale(0.25,scale) && scale==2);
   Check(Tov2CaptureVolumeScale(0.00000001,scale) && scale==8);
   Check(!Tov2CaptureVolumeScale(0.0,scale));
}
void UnsignedTickets()
{
   string value="";
   ulong high=9223372036854775808,maximum=18446744073709551615;
   Check(Tov2TicketFromUlong(high,value) && value=="9223372036854775808");
   Check(Tov2TicketFromUlong(maximum,value) && value=="18446744073709551615");
}
void MissingReadings()
{
   Tov2CaptureReading r; string text="";
   Tov2CaptureMissing(r,"NOT_SET"); Check(Tov2CaptureEncodeReading(r,text) && text=="{\"reason\":\"NOT_SET\",\"value\":null}");
   Check(!Tov2CaptureFromDouble(MathArcsin(2.0),2,r) && r.reason=="READ_FAILED");
   CTov2FakeCaptureBroker broker; CTov2AccountSnapshot snapshot(broker.fingerprint);
   Tov2CaptureAccount account; Tov2CaptureExposure exposure;
   Check(snapshot.Capture(GetPointer(broker),account,exposure)==TOV2_CAPTURE_OK);
   Check(account.margin_level.reason=="NOT_APPLICABLE");
   broker.account_result=TOV2_CAPTURE_READ_FAILED;
   Check(snapshot.Capture(GetPointer(broker),account,exposure)==TOV2_CAPTURE_READ_FAILED);
   Check(account.status=="CAPTURE_FAILED" && account.balance.reason=="READ_FAILED" && account.equity.reason=="READ_FAILED");
}
void ExposureBounds()
{
   CTov2FakeCaptureBroker broker; CTov2AccountSnapshot snapshot(broker.fingerprint);
   Tov2CaptureAccount account; Tov2CaptureExposure exposure;
   broker.SetPositions(128);
   Check(snapshot.Capture(GetPointer(broker),account,exposure)==TOV2_CAPTURE_OK && exposure.positions_size==128);
   broker.SetPositions(129);
   Check(snapshot.Capture(GetPointer(broker),account,exposure)==TOV2_CAPTURE_LIMIT_EXCEEDED);
   Check(exposure.positions_size==0 && exposure.position_count==129);
   broker.SetPositions(0);broker.SetOrders(128);
   Check(snapshot.Capture(GetPointer(broker),account,exposure)==TOV2_CAPTURE_OK && exposure.orders_size==128);
   broker.SetOrders(129);
   Check(snapshot.Capture(GetPointer(broker),account,exposure)==TOV2_CAPTURE_LIMIT_EXCEEDED && exposure.order_count==129 && exposure.orders_size==0);
}
void DuplicateIds()
{
   CTov2FakeCaptureBroker broker; CTov2AccountSnapshot snapshot(broker.fingerprint);
   Tov2CaptureAccount account; Tov2CaptureExposure exposure;
   broker.SetPositions(2); broker.exposure.positions[1].position_id=broker.exposure.positions[0].position_id;
   Check(snapshot.Capture(GetPointer(broker),account,exposure)==TOV2_CAPTURE_READ_FAILED && exposure.positions_size==0);
   broker.SetPositions(2); broker.exposure.positions[1].ticket=broker.exposure.positions[0].ticket;
   Check(snapshot.Capture(GetPointer(broker),account,exposure)==TOV2_CAPTURE_READ_FAILED && exposure.positions_size==0);
}
void MembershipRace()
{
   CTov2FakeCaptureBroker broker; CTov2AccountSnapshot snapshot(broker.fingerprint);
   Tov2CaptureAccount account; Tov2CaptureExposure exposure;
   broker.SetPositions(1); broker.membership_race=true;
   Check(snapshot.Capture(GetPointer(broker),account,exposure)==TOV2_CAPTURE_READ_FAILED && exposure.positions_size==0);
}
void StableMutations()
{
   CTov2FakeCaptureBroker broker;CTov2AccountSnapshot snapshot(broker.fingerprint);
   Tov2CaptureAccount account;Tov2CaptureExposure exposure;
   broker.SetPositions(1);broker.SetOrders(1);
   for(int i=1;i<=15;i++)
   {
      broker.exposure_calls=0;broker.stable_mutation=i;
      Check(snapshot.Capture(GetPointer(broker),account,exposure)==TOV2_CAPTURE_READ_FAILED && exposure.positions_size==0 && exposure.orders_size==0);
   }
   broker.exposure_calls=0;broker.stable_mutation=16;
   Check(snapshot.Capture(GetPointer(broker),account,exposure)==TOV2_CAPTURE_OK);
}
void RejectFalseComplete()
{
   CTov2FakeCaptureBroker broker;CTov2AccountSnapshot snapshot(broker.fingerprint);
   Tov2CaptureAccount account;Tov2CaptureExposure exposure,previous;
   Tov2CaptureClearAccount(broker.account);
   Check(snapshot.Capture(GetPointer(broker),account,exposure)==TOV2_CAPTURE_READ_FAILED && account.status=="CAPTURE_FAILED");
   broker.exposure.status="CAPTURE_FAILED";
   Check(snapshot.Capture(GetPointer(broker),account,exposure)==TOV2_CAPTURE_READ_FAILED && exposure.status=="CAPTURE_FAILED");
   Check(snapshot.LastComplete(previous) && previous.status=="COMPLETE");
}
void MissingClocks()
{
   CTov2FakeCaptureBroker broker;CTov2AccountSnapshot snapshot(broker.fingerprint);
   Tov2CaptureAccount account;Tov2CaptureExposure exposure,previous;
   broker.SetPositions(1);
   Check(snapshot.Capture(GetPointer(broker),account,exposure)==TOV2_CAPTURE_OK);
   broker.clock_result=TOV2_CAPTURE_READ_FAILED;
   Check(snapshot.Capture(GetPointer(broker),account,exposure)==TOV2_CAPTURE_READ_FAILED && exposure.positions_size==0);
   Check(snapshot.LastComplete(previous) && previous.positions_size==1);
}
void IdentitySwitch()
{
   CTov2FakeCaptureBroker broker; CTov2AccountSnapshot snapshot(broker.fingerprint);
   Tov2CaptureAccount account; Tov2CaptureExposure exposure,previous;
   Check(snapshot.Capture(GetPointer(broker),account,exposure)==TOV2_CAPTURE_OK);
   broker.exposure_calls=0;broker.switch_after_read=true;
   Check(snapshot.Capture(GetPointer(broker),account,exposure)==TOV2_CAPTURE_IDENTITY_CHANGED);
   Check(exposure.positions_size==0 && !snapshot.LastComplete(previous));
   snapshot.Reset();
   Check(snapshot.Capture(GetPointer(broker),account,exposure)==TOV2_CAPTURE_IDENTITY_CHANGED);
}
void RetainsLastComplete()
{
   CTov2FakeCaptureBroker broker; CTov2AccountSnapshot snapshot(broker.fingerprint);
   Tov2CaptureAccount account; Tov2CaptureExposure exposure,previous;
   broker.SetPositions(2);
   Check(snapshot.Capture(GetPointer(broker),account,exposure)==TOV2_CAPTURE_OK);
   Check(exposure.positions[0].symbol!=exposure.positions[1].symbol);
   broker.exposure_result=TOV2_CAPTURE_READ_FAILED;
   Check(snapshot.Capture(GetPointer(broker),account,exposure)==TOV2_CAPTURE_READ_FAILED);
   Check(exposure.positions_size==0 && snapshot.LastComplete(previous) && previous.positions_size==2);
   broker.exposure_result=TOV2_CAPTURE_OK; broker.SetPositions(1);
   Check(snapshot.Capture(GetPointer(broker),account,exposure)==TOV2_CAPTURE_OK);
   Check(snapshot.LastComplete(previous) && previous.positions_size==1);
}
void HistoryOutcomes()
{
   CTov2FakeCaptureBroker broker; Tov2CaptureHistoryPage page;
   Check(broker.History(1800000000000,1800000010000,page)==TOV2_CAPTURE_OK && page.total==0);
   broker.history_result=TOV2_CAPTURE_READ_FAILED;
   Check(broker.History(1800000000000,1800000010000,page)==TOV2_CAPTURE_READ_FAILED && page.total==-1);
   broker.history_result=TOV2_CAPTURE_UNSUPPORTED;
   Check(broker.History(1800000000000,1800000010000,page)==TOV2_CAPTURE_UNSUPPORTED && page.rows[0].result==TOV2_CAPTURE_UNSUPPORTED);
   Check(page.rows[0].ticket=="55" && page.rows[0].raw_type==999 && page.rows[0].raw_reason==999);
}
void FakeHistoryAllocationBounds()
{
   scenario="fake-history-allocation-bounds";
   CTov2FakeCaptureBroker broker;
   Check(ArraySize(broker.deals)==2048 && broker.history_result==TOV2_CAPTURE_OK);
   if(ArraySize(broker.deals)!=2048) return;
   broker.AddDeal("100",broker.broker_now);
   Check(broker.deal_count==1 && broker.deals[0].ticket=="100");
   broker.deal_count=2047;broker.AddDeal("200",broker.broker_now);
   Check(broker.deal_count==2048 && broker.deals[2047].ticket=="200");
   broker.AddDeal("201",broker.broker_now);
   Check(broker.deal_count==2048 && broker.deals[2047].ticket=="200");
   ArrayResize(broker.deals,0);broker.deal_count=0;
   broker.AddDeal("202",broker.broker_now);
   Check(broker.deal_count==0 && ArraySize(broker.deals)==0);
}
void DealMappings()
{
   FakeHistoryAllocationBounds();
   Check(Tov2NativeDealType(DEAL_DIVIDEND)=="DIVIDEND");
   Check(Tov2NativeDealType(DEAL_DIVIDEND_FRANKED)=="DIVIDEND_FRANKED");
   Check(Tov2NativeDealType(DEAL_TAX)=="TAX");
   Check(Tov2NativeDealType(DEAL_TYPE_BUY_CANCELED)=="BUY_CANCELED");
   Check(Tov2NativeDealType(DEAL_TYPE_SELL_CANCELED)=="SELL_CANCELED");
   Check(Tov2NativeDealType(DEAL_TYPE_COMMISSION_DAILY)=="COMMISSION_DAILY");
   Check(Tov2NativeDealType(DEAL_TYPE_BALANCE)=="BALANCE");
   Check(Tov2NativeDealType(999)=="");
   Check(Tov2NativeDealReason(DEAL_REASON_EXPERT)=="EXPERT");
   Check(Tov2NativeDealReason(DEAL_REASON_SL)=="SL");
   Check(Tov2NativeDealReason(999)=="UNKNOWN");
}
void CodecRejectsMalformed()
{
   Tov2CaptureBoundary b;ZeroMemory(b);b.tracking_id="synthetic-tracking";b.account_fingerprint_sha256="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
   b.started_at_broker_msc=1800000000000;b.initialized_at_utc_seconds=1800000000;b.excluded_size=2;
   b.excluded_boundary_deal_ids[0]="2";b.excluded_boundary_deal_ids[1]="18446744073709551615";
   string boundary="";Check(!Tov2CaptureEncodeBoundary(b,boundary));
   b.excluded_boundary_deal_ids[0]="18446744073709551615";b.excluded_boundary_deal_ids[1]="2";
   Check(Tov2CaptureEncodeBoundary(b,boundary));
   b.started_at_broker_msc=9007199254740000;Check(!Tov2CaptureEncodeBoundary(b,boundary));
   Tov2CaptureProtection p; string output="";
   p.position_id="1";p.ticket="2";p.symbol="EURUSD";p.observed_at_broker_msc=1800000000000;p.source="POLL";
   Tov2CaptureMissing(p.sl,"NOT_SET");Tov2CaptureMissing(p.tp,"NOT_SET");
   Check(Tov2CaptureEncodeProtection(p,output));
   Tov2CaptureProtection q;
   Check(!Tov2CaptureDecodeProtection(" "+output,q));
   Check(!Tov2CaptureDecodeProtection(output+" ",q));
   Check(!Tov2CaptureDecodeProtection(StringSubstr(output,0,StringLen(output)-1),q));
   p.symbol="bad\nsymbol"; Check(!Tov2CaptureEncodeProtection(p,output) && output=="");
   string invalid=""; StringInit(invalid,1,0xD800); p.symbol=invalid;
   Check(!Tov2CaptureEncodeProtection(p,output));
   uchar bad_utf8[2]; bad_utf8[0]=0xC0;bad_utf8[1]=0x80;
   Check(!Tov2CaptureUtf8Text(bad_utf8,output));
}
void OnStart()
{
   DurableEnrollmentAndCodec();
   UninitializedRigHelpersFailClosed();
   CollectorBoundaryRace();CollectorHistoryAndProtection();CollectorAcknowledgedCorrection();
   CollectorHistoryFailures();CollectorUnsupportedAndMissing();CollectorClockAndIdentity();CollectorCrashMatrix();
   CollectorOldWindowCorrection();CheckpointRejectsMalformedAndRegression();CaptureReadGuardAndCorruption();
   CollectorCapacityAndDuplicates();
   EnrollmentRequiresFreshQuote();DiscardedSampleMarksObservationGap();
   DeferredProtectionBlocksCompleteCoverage();ClockAnchorAndPreEnrollmentReversal();
   ScaleCases(); UnsignedTickets(); MissingReadings(); ExposureBounds(); DuplicateIds();
   MembershipRace(); StableMutations(); RejectFalseComplete(); MissingClocks(); IdentitySwitch(); RetainsLastComplete(); HistoryOutcomes(); DealMappings(); CodecRejectsMalformed();
   Golden("account",0,"{\"balance\":{\"reason\":null,\"value\":{\"scale\":0,\"value\":\"100\"}},\"equity\":{\"reason\":null,\"value\":{\"scale\":0,\"value\":\"100\"}},\"margin_free\":{\"reason\":null,\"value\":{\"scale\":0,\"value\":\"100\"}},\"margin_level\":{\"reason\":\"NOT_APPLICABLE\",\"value\":null},\"margin_used\":{\"reason\":null,\"value\":{\"scale\":0,\"value\":\"0\"}},\"observed_at_broker_msc\":1800000010000,\"observed_at_utc_seconds\":1800000010,\"status\":\"COMPLETE\"}","796056599b0e1a3fd1a0505508e98e082a286fb1e67606db5524bcbc93b06943");
   Golden("account",2,"{\"balance\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"100.00\"}},\"equity\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"100.00\"}},\"margin_free\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"100.00\"}},\"margin_level\":{\"reason\":\"NOT_APPLICABLE\",\"value\":null},\"margin_used\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"0.00\"}},\"observed_at_broker_msc\":1800000010000,\"observed_at_utc_seconds\":1800000010,\"status\":\"COMPLETE\"}","c3be3bb76952fc2e04836a60a3de3a3453c11e3d1e8e9145829c3c64dd1e2cbe");
   Golden("account",8,"{\"balance\":{\"reason\":null,\"value\":{\"scale\":8,\"value\":\"100.00000000\"}},\"equity\":{\"reason\":null,\"value\":{\"scale\":8,\"value\":\"100.00000000\"}},\"margin_free\":{\"reason\":null,\"value\":{\"scale\":8,\"value\":\"100.00000000\"}},\"margin_level\":{\"reason\":\"NOT_APPLICABLE\",\"value\":null},\"margin_used\":{\"reason\":null,\"value\":{\"scale\":8,\"value\":\"0.00000000\"}},\"observed_at_broker_msc\":1800000010000,\"observed_at_utc_seconds\":1800000010,\"status\":\"COMPLETE\"}","229f95ca8a8213e6fff31009d28a330a697ed5b861801213df2255c2a9cd7e76");
   Golden("account",2,"{\"balance\":{\"reason\":\"READ_FAILED\",\"value\":null},\"equity\":{\"reason\":\"READ_FAILED\",\"value\":null},\"margin_free\":{\"reason\":\"READ_FAILED\",\"value\":null},\"margin_level\":{\"reason\":\"READ_FAILED\",\"value\":null},\"margin_used\":{\"reason\":\"READ_FAILED\",\"value\":null},\"observed_at_broker_msc\":1800000010000,\"observed_at_utc_seconds\":1800000010,\"status\":\"CAPTURE_FAILED\"}","1014f57d47b36ee4baa415d28c70822c42437ae9bc63a46e6979cff7be318ef8");
   Golden("exposure",2,"{\"observed_at_broker_msc\":1800000010000,\"observed_at_utc_seconds\":1800000010,\"order_count\":1,\"orders\":[{\"price\":{\"reason\":null,\"value\":{\"scale\":5,\"value\":\"10.00000\"}},\"sl\":{\"reason\":\"NOT_SET\",\"value\":null},\"state\":\"REQUEST_MODIFY\",\"stop_limit_price\":{\"reason\":null,\"value\":{\"scale\":5,\"value\":\"9.90000\"}},\"symbol\":\"UNLISTED\",\"ticket\":\"9223372036854775809\",\"tp\":{\"reason\":\"NOT_SET\",\"value\":null},\"type\":\"SELL_STOP_LIMIT\",\"volume_current\":{\"scale\":2,\"value\":\"0.10\"},\"volume_initial\":{\"scale\":2,\"value\":\"0.20\"}}],\"position_count\":1,\"positions\":[{\"current_price\":{\"reason\":null,\"value\":{\"scale\":3,\"value\":\"2024.220\"}},\"entry_price\":{\"reason\":null,\"value\":{\"scale\":3,\"value\":\"2024.120\"}},\"floating_profit\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"1.00\"}},\"position_id\":\"9223372036854775808\",\"side\":\"BUY\",\"sl\":{\"reason\":\"NOT_SET\",\"value\":null},\"swap\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.01\"}},\"symbol\":\"XAUUSD.测试\",\"ticket\":\"18446744073709551615\",\"tp\":{\"reason\":\"NOT_SET\",\"value\":null},\"volume\":{\"scale\":2,\"value\":\"0.10\"}}],\"status\":\"COMPLETE\"}","b71f8c97cfe7883a99044baea58afa82a6c3e6fa428c711f4abb252c1ad4a775");
   Golden("exposure",2,"{\"observed_at_broker_msc\":1800000010000,\"observed_at_utc_seconds\":1800000010,\"order_count\":0,\"orders\":[],\"position_count\":129,\"positions\":[],\"status\":\"LIMIT_EXCEEDED\"}","4d5850dd4e5348f69a5427b85bde74ebe58c0387ced858d63fa9d6448bfc6c65");
   Golden("deal",2,"{\"broker_time_msc\":1800000005000,\"commission\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.20\"}},\"deal_id\":\"18446744073709551615\",\"entry\":\"INOUT\",\"fee\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.05\"}},\"kind\":\"DEAL\",\"order_id\":\"9223372036854775809\",\"position_id\":\"9223372036854775808\",\"previous_record_sha256\":null,\"price\":{\"reason\":null,\"value\":{\"scale\":5,\"value\":\"1.10000\"}},\"profit\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"10.00\"}},\"protection_source\":\"BROKER_DEAL\",\"reason\":\"EXPERT\",\"reversal_split\":null,\"revision\":1,\"sl\":{\"reason\":\"NOT_SET\",\"value\":null},\"swap\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.05\"}},\"symbol\":\"EURUSD.a\",\"tp\":{\"reason\":null,\"value\":{\"scale\":5,\"value\":\"1.20000\"}},\"type\":\"BUY\",\"volume\":{\"scale\":2,\"value\":\"0.10\"}}","e64f152523896da8b02ec1be7c016b1e5769dc0b7bbca659cb8d54df67ce4f32");
   Golden("deal",2,"{\"broker_time_msc\":1800000005000,\"commission\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.20\"}},\"deal_id\":\"17\",\"entry\":\"OUT\",\"fee\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.05\"}},\"kind\":\"DEAL\",\"order_id\":\"9223372036854775809\",\"position_id\":\"9223372036854775808\",\"previous_record_sha256\":null,\"price\":{\"reason\":null,\"value\":{\"scale\":5,\"value\":\"1.10000\"}},\"profit\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"10.00\"}},\"protection_source\":\"BROKER_DEAL\",\"reason\":\"CLIENT\",\"reversal_split\":null,\"revision\":1,\"sl\":{\"reason\":\"NOT_SET\",\"value\":null},\"swap\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.05\"}},\"symbol\":\"EURUSD.a\",\"tp\":{\"reason\":null,\"value\":{\"scale\":5,\"value\":\"1.20000\"}},\"type\":\"SELL_CANCELED\",\"volume\":{\"scale\":2,\"value\":\"0.10\"}}","68e1b5526a792a22c466cb062a9a9170a8bbd3d2a31e3a592b81b32195a74eee");
   Golden("deal",2,"{\"broker_time_msc\":1800000005000,\"commission\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"0.00\"}},\"deal_id\":\"18\",\"entry\":\"NONE\",\"fee\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"0.00\"}},\"kind\":\"DEAL\",\"order_id\":null,\"position_id\":null,\"previous_record_sha256\":null,\"price\":{\"reason\":\"NOT_APPLICABLE\",\"value\":null},\"profit\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-5.00\"}},\"protection_source\":\"UNAVAILABLE\",\"reason\":\"UNKNOWN\",\"reversal_split\":null,\"revision\":1,\"sl\":{\"reason\":\"UNAVAILABLE\",\"value\":null},\"swap\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"0.00\"}},\"symbol\":null,\"tp\":{\"reason\":\"UNAVAILABLE\",\"value\":null},\"type\":\"COMMISSION_DAILY\",\"volume\":null}","bdb6f47e09b196a17fa23426e5ef454c0e98461585715a997d76a4e054044fe6");
   Golden("protection",2,"{\"kind\":\"PROTECTION_OBSERVATION\",\"observed_at_broker_msc\":1800000010000,\"position_id\":\"9223372036854775808\",\"sl\":{\"reason\":\"NOT_SET\",\"value\":null},\"source\":\"POLL\",\"symbol\":\"XAUUSD.测试\",\"ticket\":\"18446744073709551615\",\"tp\":{\"reason\":null,\"value\":{\"scale\":3,\"value\":\"2050.000\"}}}","d6eca42361837d56fe9bae712e284d30fe9ec741968acb6b16a2d8d626ac87ee");
   Golden("registration",2,"{\"baseline\":{\"observed_at_broker_msc\":1800000000123,\"observed_at_utc_seconds\":1800000000,\"order_count\":1,\"orders\":[{\"price\":{\"reason\":null,\"value\":{\"scale\":5,\"value\":\"10.00000\"}},\"sl\":{\"reason\":\"NOT_SET\",\"value\":null},\"state\":\"REQUEST_MODIFY\",\"stop_limit_price\":{\"reason\":null,\"value\":{\"scale\":5,\"value\":\"9.90000\"}},\"symbol\":\"UNLISTED\",\"ticket\":\"9223372036854775809\",\"tp\":{\"reason\":\"NOT_SET\",\"value\":null},\"type\":\"SELL_STOP_LIMIT\",\"volume_current\":{\"scale\":2,\"value\":\"0.10\"},\"volume_initial\":{\"scale\":2,\"value\":\"0.20\"}}],\"position_count\":1,\"positions\":[{\"current_price\":{\"reason\":null,\"value\":{\"scale\":3,\"value\":\"2024.220\"}},\"entry_price\":{\"reason\":null,\"value\":{\"scale\":3,\"value\":\"2024.120\"}},\"floating_profit\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"1.00\"}},\"position_id\":\"9223372036854775808\",\"side\":\"BUY\",\"sl\":{\"reason\":\"NOT_SET\",\"value\":null},\"swap\":{\"reason\":null,\"value\":{\"scale\":2,\"value\":\"-0.01\"}},\"symbol\":\"XAUUSD.测试\",\"ticket\":\"18446744073709551615\",\"tp\":{\"reason\":\"NOT_SET\",\"value\":null},\"volume\":{\"scale\":2,\"value\":\"0.10\"}}],\"status\":\"COMPLETE\"},\"boundary\":{\"account_fingerprint_sha256\":\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\"excluded_boundary_deal_ids\":[\"18446744073709551615\",\"2\"],\"initialized_at_utc_seconds\":1800000000,\"started_at_broker_msc\":1800000000000,\"tracking_id\":\"synthetic-tracking\"},\"display\":{\"account_mode\":\"DEMO\",\"company\":\"Synthetic \\\"Broker\\\" 测试\",\"currency\":\"USD\",\"currency_scale\":2,\"login_last4\":\"0007\",\"margin_mode\":\"RETAIL_HEDGING\",\"server\":\"Synthetic-Demo\"}}","519daabec27a753e45f37d9e8dff443cf0d657982444ad7137d57ea9347e1c45");
   if(failures==0) Print("TOV2_CAPTURE_PASS checks=",checks," failures=0");
   else Print("TOV2_CAPTURE_FAIL checks=",checks," failures=",failures);
}
