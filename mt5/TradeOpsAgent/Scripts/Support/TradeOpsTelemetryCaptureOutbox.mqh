#ifndef TRADEOPS_TELEMETRY_CAPTURE_OUTBOX_MQH
#define TRADEOPS_TELEMETRY_CAPTURE_OUTBOX_MQH
#include "../../Include/TradeOpsCaptureStateCodec.mqh"

// Synthetic offline request/ACK grammar. No production HTTP or signature semantics.
bool Tov2CaptureTestPending(const uchar &payload[],const Tov2LocalState &state)
{
   CTov2CaptureNetReader r;string tag="",identity="",registration="",root="",capture_sha="",sha="";
   long request=0,prior=0,produced=0;int count=0,scale=0;
   if(!r.Start(payload) || !r.Text(tag,16) || tag!="CPEND1" ||
      !r.Text(identity,1024) || identity!=state.identity ||
      !r.Text(registration,64) || registration!=state.registration.sha ||
      !r.Number(request,1) || request!=state.pending_request ||
      !r.Number(prior) || prior!=state.pending_prior ||
      !r.Count(count,32) || count!=state.pending_count ||
      !r.Number(produced) || produced!=state.pending_produced || produced>state.produced ||
      !r.Count(scale,16) || !r.Text(root,64) || !Tov2Digest(root) ||
      !r.Text(capture_sha,64) || !Tov2Digest(capture_sha) ||
      count>state.event_count || prior+count!=state.pending_final ||
      !Tov2LocalHash(payload,sha) || sha!=state.pending_body) return false;
   for(int i=0;i<count;i++)
   {
      long sequence=0,utc=0;string id="",record_sha="",json="",actual="";
      if(!r.Number(sequence,1) || sequence!=state.events[i].sequence ||
         !r.Text(id,160) || id!=state.events[i].event_id ||
         !r.Number(utc,1) || !r.Text(record_sha,64) || record_sha!=state.events[i].record_sha ||
         !r.Text(json) || !Tov2CaptureRecordHash(json,actual) || actual!=record_sha) return false;
      if(state.events[i].deal_id=="-")
      {
         Tov2CaptureProtection p;
         if(!Tov2CaptureDecodeProtection(json,p) || state.events[i].revision!=0) return false;
      }
      else
      {
         Tov2CaptureDeal deal;
         if(!Tov2CaptureDecodeDeal(json,scale,deal) || deal.deal_id!=state.events[i].deal_id ||
            deal.revision!=state.events[i].revision) return false;
      }
   }
   return r.Done();
}
string Tov2CaptureTestAckBody(const Tov2OutboxAcceptance &a)
{
   return Tov2CaptureNet("CACK1")+Tov2CaptureNet(a.identity)+Tov2CaptureNet(a.registration_sha)+
      Tov2CaptureNetNumber(a.request_sequence)+Tov2CaptureNet(a.body_sha)+Tov2CaptureNet(a.pending_sha)+
      Tov2CaptureNetNumber(a.final_event)+Tov2CaptureNetNumber(a.accepted_at);
}
bool Tov2CaptureTestAck(const uchar &payload[],Tov2OutboxAcceptance &out)
{
   Tov2OutboxClearAcceptance(out);Tov2OutboxAcceptance a;Tov2OutboxClearAcceptance(a);
   CTov2CaptureNetReader r;string tag="",sha="",actual="",installation="";
   if(!r.Start(payload) || !r.Text(tag,16) || tag!="CACK1" ||
      !r.Text(a.identity,1024) || !Tov2LocalIdentity(a.identity,installation) ||
      !r.Text(a.registration_sha,64) || !Tov2Digest(a.registration_sha) ||
      !r.Number(a.request_sequence,1) || !r.Text(a.body_sha,64) || !Tov2Digest(a.body_sha) ||
      !r.Text(a.pending_sha,64) || !Tov2Digest(a.pending_sha) ||
      !r.Number(a.final_event) || !r.Number(a.accepted_at,1) || !r.Text(sha,64) || !r.Done() ||
      !Tov2CaptureRecordHash(Tov2CaptureTestAckBody(a),actual) || actual!=sha) return false;
   out=a;return true;
}
class CTov2CaptureTestWire : public ITov2CaptureWirePayloadValidator
{
public:
   virtual bool Pending(const uchar &payload[],const Tov2LocalState &state,const string identity)
   {return identity==state.identity && Tov2CaptureTestPending(payload,state);}
   virtual bool Ack(const uchar &payload[],const Tov2LocalState &state,const string identity)
   {
      Tov2OutboxAcceptance a;
      return identity==state.identity && Tov2CaptureTestAck(payload,a) && a.identity==identity &&
         a.registration_sha==state.registration.sha && a.request_sequence==state.ack_request &&
         a.body_sha==state.ack_body && a.pending_sha==state.ack_pending_sha &&
         a.final_event==state.ack_event && a.accepted_at==state.accepted_at;
   }
};
class CTov2CaptureTestOutbox : public ITov2TelemetryOutboxAdapter
{
private:
   bool m_bound;
   Tov2CaptureCheckpoint m_capture;
   string m_root,m_capture_sha;
   long m_generation;
public:
   CTov2CaptureTestOutbox() {m_bound=false;m_root="";m_capture_sha="";m_generation=0;}
   bool Bind(const Tov2LocalState &state,const string root,const uchar &registration[],const uchar &capture[])
   {
      m_bound=false;Tov2CaptureRegistration r;
      if(!Tov2Digest(root) || !Tov2CaptureCheckpointDecode(capture,m_capture) ||
         !Tov2CaptureContextMatches(state,registration,m_capture,r) || !Tov2LocalHash(capture,m_capture_sha)) return false;
      m_root=root;m_generation=state.generation;m_bound=true;return true;
   }
   virtual int Build(const Tov2OutboxContext &context,const uchar &registration[],
                     const uchar &event_arena[],const int &event_ends[],const int prefix_count,
                     Tov2OutboxCandidate &candidate,uchar &request[])
   {
      Tov2OutboxClearCandidate(candidate);ArrayResize(request,0);
      Tov2CaptureRegistration r;uchar frame[];string registration_sha="";
      if(!m_bound || context.root_sha!=m_root || context.state.generation!=m_generation ||
         !Tov2CaptureContextMatches(context.state,registration,m_capture,r) ||
         !Tov2RecordEncode("REGISTRATION",1,registration,frame) || !Tov2LocalHash(frame,registration_sha) ||
         registration_sha!=context.state.registration.sha || prefix_count<0 || prefix_count>32 ||
         prefix_count>context.state.event_count || prefix_count>ArraySize(event_ends)) return TOV2_OUTBOX_BUILD_INVALID;
      string text=Tov2CaptureNet("CPEND1")+Tov2CaptureNet(context.state.identity)+
         Tov2CaptureNet(context.state.registration.sha)+Tov2CaptureNetNumber(context.state.accepted_request+1)+
         Tov2CaptureNetNumber(context.state.accepted_event)+Tov2CaptureNetNumber(prefix_count)+
         Tov2CaptureNetNumber(context.state.produced)+Tov2CaptureNetNumber(m_capture.currency_scale)+
         Tov2CaptureNet(context.root_sha)+Tov2CaptureNet(m_capture_sha);
      int previous=0;
      for(int i=0;i<prefix_count;i++)
      {
         int size=event_ends[i]-previous;uchar payload[];string json="",sha="";long utc=0;
         for(int j=0;j<m_capture.queue_count;j++)
            if(m_capture.queued[j].sequence==context.state.events[i].sequence) utc=m_capture.queued[j].observed_utc;
         if(size<1 || event_ends[i]>ArraySize(event_arena) || utc==0 ||
            ArrayResize(payload,size)!=size || ArrayCopy(payload,event_arena,0,previous,size)!=size ||
            !Tov2CaptureUtf8Text(payload,json) || !Tov2LocalHash(payload,sha) ||
            sha!=context.state.events[i].record_sha) return TOV2_OUTBOX_BUILD_INVALID;
         text+=Tov2CaptureNetNumber(context.state.events[i].sequence)+Tov2CaptureNet(context.state.events[i].event_id)+
            Tov2CaptureNetNumber(utc)+Tov2CaptureNet(sha)+Tov2CaptureNet(json);
         previous=event_ends[i];
      }
      if(!Tov2CaptureUtf8Bytes(text,request) || !Tov2LocalHash(request,candidate.body_sha)) return TOV2_OUTBOX_BUILD_SIZE_LIMIT;
      candidate.expected_generation=context.state.generation;candidate.expected_root_sha=context.root_sha;
      candidate.registration_sha=context.state.registration.sha;candidate.request_sequence=context.state.accepted_request+1;
      candidate.prefix_count=prefix_count;candidate.frozen_produced=context.state.produced;
      return TOV2_OUTBOX_BUILD_OK;
   }
   virtual bool ValidateRequest(const Tov2OutboxContext &context,const uchar &registration[],
                        const uchar &event_arena[],const int &event_ends[],
                        const Tov2OutboxCandidate &candidate,const uchar &request[])
   {
      // Bound context was read before entering State's callback guard.
      Tov2OutboxCandidate expected;uchar bytes[];
      return Build(context,registration,event_arena,event_ends,candidate.prefix_count,expected,bytes)==TOV2_OUTBOX_BUILD_OK &&
         Tov2LocalEqual(bytes,request) && expected.body_sha==candidate.body_sha &&
         expected.expected_root_sha==candidate.expected_root_sha;
   }
   bool Response(const Tov2LocalState &state,uchar &response[])
   {
      ArrayResize(response,0);if(state.pending.kind=="-") return false;
      Tov2OutboxAcceptance a;
      a.identity=state.identity;a.registration_sha=state.registration.sha;a.request_sequence=state.pending_request;
      a.body_sha=state.pending_body;a.pending_sha=state.pending.sha;a.final_event=state.pending_final;
      a.accepted_at=1800001000;
      string body=Tov2CaptureTestAckBody(a),sha="";
      return Tov2CaptureRecordHash(body,sha) && Tov2CaptureUtf8Bytes(body+Tov2CaptureNet(sha),response);
   }
   virtual bool ValidateResponse(const Tov2LocalState &state,const uchar &pending[],const uchar &response[],
                                  Tov2OutboxAcceptance &accepted)
   {
      Tov2OutboxClearAcceptance(accepted);Tov2OutboxAcceptance a;
      if(!Tov2CaptureTestPending(pending,state) || !Tov2CaptureTestAck(response,a) ||
         a.identity!=state.identity || a.registration_sha!=state.registration.sha ||
         a.request_sequence!=state.pending_request || a.body_sha!=state.pending_body ||
         a.pending_sha!=state.pending.sha || a.final_event!=state.pending_final) return false;
      accepted=a;return true;
   }
   virtual bool ValidateReplacement(const Tov2LocalState &state,const uchar &pending[],const uchar &rejection[],
                                    const uchar &replacement[],const string replacement_body_sha)
   {return false;}
};
#endif
