#ifndef TRADEOPS_TELEMETRY_OUTBOX_V2_RIG_MQH
#define TRADEOPS_TELEMETRY_OUTBOX_V2_RIG_MQH
#include "TradeOpsTelemetryCaptureBroker.mqh"
#include "TradeOpsTelemetryMemoryStore.mqh"
#include "TradeOpsTelemetryOutboxV2Fixtures.mqh"
#include "../../Include/TradeOpsJournalCollector.mqh"
#include "../../Include/TradeOpsTelemetryOutbox.mqh"
#include "../../Include/TradeOpsTelemetryOutboxV2.mqh"

// Allocate this rig on the heap: capture, State and wire fixtures are large.
class CTov2OutboxV2Rig
{
public:
   CTov2FakeCaptureBroker broker;
   CTov2TelemetryMemoryStore storage;
   CTov2TelemetryWireStateV2 wire;
   CTov2TelemetryOutboxV2 adapter;
   CTov2JournalCollector *collector;
   CTov2CapturePayloadValidator *validator;
   CTov2TelemetryState *state;
   Tov2CaptureEnrollment frozen;
   Tov2WireDiagnostics diagnostics;
   long sent_at;
   CTov2OutboxV2Rig()
   {
      state=NULL;validator=NULL;collector=new CTov2JournalCollector;
      broker.utc_now=1800000000;broker.broker_now=1800000000000;
      ZeroMemory(diagnostics);diagnostics.ea_release="synthetic-outbox-v2";
      diagnostics.reported_source_sha256="cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
      diagnostics.reported_manifest_sha256="dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";
      diagnostics.source_symbol="EURUSD";diagnostics.terminal_build=6140;diagnostics.observed_at_utc_seconds=1800000010;
      diagnostics.terminal_connection_state="CONNECTED";diagnostics.account_trade_permission="DENIED";
      diagnostics.terminal_trade_permission="DENIED";diagnostics.algo_trading_permission="DENIED";diagnostics.last_error="";
      // Deliberately wrong caller counters; adapter must derive these from State.
      diagnostics.last_accepted_request_sequence=999;diagnostics.local_unsent_events=999;
      sent_at=1800000010;
   }
   ~CTov2OutboxV2Rig()
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
         "synthetic-tracking",0,"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
         broker.fingerprint,frozen)!=TOV2_STATE_OK) return false;
      validator=new CTov2CapturePayloadValidator(2,GetPointer(wire));
      if(CheckPointer(validator)==POINTER_INVALID) return false;
      state=new CTov2TelemetryState(GetPointer(storage),validator,frozen.identity);
      return CheckPointer(state)!=POINTER_INVALID && state.Open()==TOV2_STATE_OK &&
         state.Recover()==TOV2_STATE_NOT_STARTED && collector.InitializeFrozen(state,frozen)==TOV2_STATE_OK;
   }
   bool Restart()
   {
      string installation="";
      if(!Tov2LocalIdentity(frozen.identity,installation)) return false;
      storage.Crash();
      if(CheckPointer(state)!=POINTER_INVALID) delete state;
      if(CheckPointer(validator)!=POINTER_INVALID) delete validator;
      if(CheckPointer(collector)!=POINTER_INVALID) delete collector;
      state=NULL;validator=NULL;collector=new CTov2JournalCollector;
      if(CheckPointer(collector)==POINTER_INVALID) return false;
      validator=new CTov2CapturePayloadValidator(2,GetPointer(wire));
      if(CheckPointer(validator)==POINTER_INVALID) return false;
      state=new CTov2TelemetryState(GetPointer(storage),validator,frozen.identity);
      return CheckPointer(state)!=POINTER_INVALID && state.Open()==TOV2_STATE_OK &&
         state.Recover()==TOV2_STATE_OK && collector.Recover(state)==TOV2_STATE_OK;
   }
   bool Bind()
   {
      if(CheckPointer(state)==POINTER_INVALID) return false;
      Tov2LocalState local;string root="";uchar registration[],capture[];
      return state.ReadCaptureContext(local,root,registration,capture)==TOV2_STATE_OK &&
         adapter.Bind(local,root,registration,capture,diagnostics,sent_at);
   }
   bool Poll()
   {
      return CheckPointer(state)!=POINTER_INVALID && CheckPointer(collector)!=POINTER_INVALID &&
         collector.Poll(state,GetPointer(broker))==TOV2_STATE_OK;
   }
   bool ReadContext(Tov2OutboxContext &context,uchar &registration[],uchar &arena[],int &ends[])
   {
      ArrayResize(registration,0);ArrayResize(arena,0);ArrayResize(ends,0);
      return CheckPointer(state)!=POINTER_INVALID &&
         state.ReadOutboxContext(context,registration,arena,ends)==TOV2_STATE_OK;
   }
   bool Snapshot(Tov2LocalState &local)
   {
      return CheckPointer(state)!=POINTER_INVALID && state.Snapshot(local);
   }
   int Request(uchar &bytes[])
   {CTov2TelemetryOutbox outbox(state,GetPointer(adapter));return outbox.Request(bytes);}
   int Accept(const uchar &bytes[])
   {CTov2TelemetryOutbox outbox(state,GetPointer(adapter));return outbox.Accept(bytes);}
   bool Fixture(const int index)
   {
      if(index<0 || index>5 || !Init()) return false;
      broker.utc_now=1800000010;broker.broker_now=1800000010000;
      if(index==1) broker.AddDeal("18446744073709551615",1800000005000);
      if(index==2) broker.SetPositions(1);
      if(index==3) broker.SetPositions(257);
      if(index==4) {Tov2CaptureClearExposure(broker.exposure);broker.exposure_result=TOV2_CAPTURE_READ_FAILED;}
      if(index==5) for(int i=0;i<32;i++) broker.AddDeal(IntegerToString(i+1),1800000005000);
      return collector.Poll(state,GetPointer(broker))==TOV2_STATE_OK && Bind();
   }
};
#endif
