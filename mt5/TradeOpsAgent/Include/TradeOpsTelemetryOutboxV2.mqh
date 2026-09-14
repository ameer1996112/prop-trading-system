#ifndef TRADEOPS_TELEMETRY_OUTBOX_V2_MQH
#define TRADEOPS_TELEMETRY_OUTBOX_V2_MQH
#include "TradeOpsTelemetryWireStateV2.mqh"

// Owns immutable value copies, never State/storage/caller pointers; no I/O.
class CTov2TelemetryOutboxV2 : public ITov2TelemetryOutboxAdapter
{
private:
   bool m_bound;
   long m_generation,m_sent_at;
   string m_root;
   uchar m_state_bytes[],m_registration[];
   Tov2CaptureCheckpoint m_capture;
   Tov2WireDiagnostics m_diagnostics;
   void ClearBinding()
   {
      m_bound=false;m_generation=0;m_sent_at=0;m_root="";
      ArrayResize(m_state_bytes,0);ArrayResize(m_registration,0);Tov2CaptureCheckpointClear(m_capture);
      ZeroMemory(m_diagnostics);m_diagnostics.ea_release="";m_diagnostics.source_symbol="";
      m_diagnostics.reported_source_sha256="";m_diagnostics.reported_manifest_sha256="";
      m_diagnostics.terminal_connection_state="";m_diagnostics.account_trade_permission="";
      m_diagnostics.terminal_trade_permission="";m_diagnostics.algo_trading_permission="";m_diagnostics.last_error="";
   }
   bool Assemble(const Tov2OutboxContext &context,const uchar &registration[],
                 const uchar &arena[],const int &ends[],const int count,CTov2WireRequest &request)
   {
      Tov2WireClearRequest(request);uchar state_bytes[];
      if(!m_bound || context.root_sha!=m_root || context.state.generation!=m_generation ||
         !Tov2LocalStateEncode(context.state,state_bytes) || !Tov2LocalEqual(state_bytes,m_state_bytes) ||
         !Tov2LocalEqual(registration,m_registration) || context.state.accepted_request>=TOV2_LOCAL_MAX_COUNTER ||
         count<0 || count>TOV2_WIRE_EVENTS_MAX || count>context.state.event_count || count>ArraySize(ends) ||
         (count==0 && context.state.event_count!=0) ||
         !Tov2CaptureContextMatches(context.state,registration,m_capture,request.registration) ||
         !Tov2WireLocalIdentity(context.state.identity,request.identity) ||
         !Tov2CaptureDecodeAccount(m_capture.account_json,m_capture.currency_scale,request.account)) return false;
      Tov2CaptureClearExposure(request.exposure);
      if(m_capture.attempt_status=="COMPLETE" &&
         !Tov2CaptureDecodeExposure(m_capture.last_complete_json,m_capture.currency_scale,request.exposure)) return false;
      request.exposure.status=m_capture.attempt_status;request.exposure.observed_at_utc_seconds=m_capture.attempt_utc;
      request.exposure.observed_at_broker_msc=m_capture.attempt_broker;
      request.exposure.position_count=m_capture.position_count;request.exposure.order_count=m_capture.order_count;
      request.collection.produced_events=context.state.produced;request.collection.scan_through_broker_msc=m_capture.watermark;
      request.collection.scan_finished=m_capture.scan_finished;request.collection.observation_gap=m_capture.observation_gap;
      request.collection.record_gap=m_capture.record_gap=="-"?"":m_capture.record_gap;
      request.request_sequence=context.state.accepted_request+1;
      request.last_acknowledged_event_sequence=context.state.accepted_event;request.sent_at_utc_seconds=m_sent_at;
      request.diagnostics=m_diagnostics;
      request.diagnostics.last_accepted_request_sequence=context.state.accepted_request;
      request.diagnostics.local_unsent_events=context.state.produced-context.state.accepted_event;
      request.event_count=count;int previous=0;
      for(int i=0;i<count;i++)
      {
         Tov2LocalRef reference=context.state.events[i];int size=ends[i]-previous;uchar payload[];
         if(reference.sequence!=context.state.accepted_event+1+i || size<1 || ends[i]>ArraySize(arena) ||
            ArrayResize(payload,size)!=size || ArrayCopy(payload,arena,0,previous,size)!=size ||
            !Tov2CaptureUtf8Text(payload,request.events[i].record_json)) return false;
         request.events[i].sequence=reference.sequence;request.events[i].event_id=reference.event_id;
         request.events[i].record_sha256=reference.record_sha;int matches=0;
         for(int j=0;j<m_capture.queue_count;j++)
            if(m_capture.queued[j].sequence==reference.sequence)
            {
               if(m_capture.queued[j].event_id!=reference.event_id || m_capture.queued[j].record_sha!=reference.record_sha) return false;
               request.events[i].observed_at_utc_seconds=m_capture.queued[j].observed_utc;matches++;
            }
         if(matches!=1 || !Tov2WireEventMatches(request.events[i],reference,m_capture.currency_scale)) return false;
         previous=ends[i];
      }
      return true;
   }
public:
   CTov2TelemetryOutboxV2() {ClearBinding();}
   bool Bind(const Tov2LocalState &state,const string root,const uchar &registration[],const uchar &capture[],
             const Tov2WireDiagnostics &diagnostics,const long sent_at)
   {
      ClearBinding();Tov2CaptureRegistration decoded;
      if(!Tov2Digest(root) || !Tov2LocalStateValid(state) || !Tov2Counter(sent_at,1) ||
         !Tov2WireFrameMatches(registration,state.registration,"REGISTRATION") ||
         !Tov2WireFrameMatches(capture,state.capture,"CAPTURE") ||
         !Tov2CaptureCheckpointDecode(capture,m_capture) ||
         !Tov2CaptureContextMatches(state,registration,m_capture,decoded)) {ClearBinding();return false;}
      m_diagnostics=diagnostics;
      m_diagnostics.last_accepted_request_sequence=state.accepted_request;
      m_diagnostics.local_unsent_events=state.produced-state.accepted_event;
      if(!Tov2WireDiagnosticsValid(m_diagnostics) ||
         !Tov2WireTimeBetween(m_diagnostics.observed_at_utc_seconds,m_capture.initialized_utc,sent_at) ||
         (m_diagnostics.last_successful_upload_utc_seconds!=0 &&
          !Tov2WireTimeBetween(m_diagnostics.last_successful_upload_utc_seconds,m_capture.initialized_utc,sent_at)) ||
         !Tov2LocalStateEncode(state,m_state_bytes) || !Tov2LocalCopy(registration,m_registration))
      {ClearBinding();return false;}
      m_generation=state.generation;m_root=root;m_sent_at=sent_at;m_bound=true;return true;
   }
   virtual int Build(const Tov2OutboxContext &context,const uchar &registration[],
                     const uchar &event_arena[],const int &event_ends[],const int prefix_count,
                     Tov2OutboxCandidate &candidate,uchar &request[])
   {
      Tov2OutboxClearCandidate(candidate);ArrayResize(request,0);
      CTov2WireRequest *assembled=new CTov2WireRequest;
      if(CheckPointer(assembled)==POINTER_INVALID) return TOV2_OUTBOX_BUILD_INVALID;
      Tov2WireExpected expected;int result=TOV2_WIRE_ENCODE_INVALID;
      if(Assemble(context,registration,event_arena,event_ends,prefix_count,assembled))
         result=Tov2WireEncodeRequestResult(assembled,request,expected);
      delete assembled;
      if(result!=TOV2_WIRE_ENCODE_OK)
      {ArrayResize(request,0);return result==TOV2_WIRE_ENCODE_SIZE_LIMIT?TOV2_OUTBOX_BUILD_SIZE_LIMIT:TOV2_OUTBOX_BUILD_INVALID;}
      candidate.expected_generation=context.state.generation;candidate.expected_root_sha=context.root_sha;
      candidate.registration_sha=context.state.registration.sha;candidate.request_sequence=expected.request_sequence;
      candidate.body_sha=expected.request_body_sha256;candidate.prefix_count=prefix_count;candidate.frozen_produced=context.state.produced;
      return TOV2_OUTBOX_BUILD_OK;
   }
   virtual bool ValidateRequest(const Tov2OutboxContext &context,const uchar &registration[],
                               const uchar &event_arena[],const int &event_ends[],
                               const Tov2OutboxCandidate &candidate,const uchar &request[])
   {
      Tov2OutboxCandidate expected;uchar bytes[];
      return Build(context,registration,event_arena,event_ends,candidate.prefix_count,expected,bytes)==TOV2_OUTBOX_BUILD_OK &&
         Tov2LocalEqual(request,bytes) && candidate.expected_generation==expected.expected_generation &&
         candidate.expected_root_sha==expected.expected_root_sha && candidate.registration_sha==expected.registration_sha &&
         candidate.request_sequence==expected.request_sequence && candidate.body_sha==expected.body_sha &&
         candidate.prefix_count==expected.prefix_count && candidate.frozen_produced==expected.frozen_produced;
   }
   virtual bool ValidateResponse(const Tov2LocalState &state,const uchar &pending[],const uchar &response[],
                                 Tov2OutboxAcceptance &accepted)
   {
      Tov2OutboxClearAcceptance(accepted);CTov2TelemetryWireStateV2 wire;Tov2WireAck ack;
      if(!wire.Pending(pending,state,state.identity) || !Tov2WireVerifyResponse(pending,response,ack)) return false;
      accepted.identity=state.identity;accepted.registration_sha=state.registration.sha;
      accepted.request_sequence=ack.request_sequence;accepted.body_sha=ack.request_body_sha256;
      accepted.pending_sha=state.pending.sha;accepted.final_event=ack.acknowledged_event_sequence;
      accepted.accepted_at=ack.accepted_at_utc_seconds;return true;
   }
   virtual bool ValidateReplacement(const Tov2LocalState &state,const uchar &pending[],const uchar &rejection[],
                                    const uchar &replacement[],const string replacement_body_sha)
   {return false;}
};
#endif
