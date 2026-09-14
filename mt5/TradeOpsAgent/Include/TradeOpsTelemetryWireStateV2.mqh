#ifndef TRADEOPS_TELEMETRY_WIRE_STATE_V2_MQH
#define TRADEOPS_TELEMETRY_WIRE_STATE_V2_MQH
#include "TradeOpsCaptureStateCodec.mqh"
#include "TradeOpsTelemetryResponseV2.mqh"

bool Tov2WireLocalIdentity(const string text,Tov2WireIdentity &out)
{
   Tov2WireClearIdentity(out);string installation="",parts[];long epoch=0;
   if(!Tov2LocalIdentity(text,installation) || StringSplit(text,126,parts)!=7 ||
      !Tov2CounterFromText(parts[3],0,epoch)) return false;
   out.account_id=parts[0];out.installation_id=parts[1];out.tracking_id=parts[2];out.safety_epoch=epoch;
   out.account_profile_sha256=parts[4];out.account_fingerprint_sha256=parts[5];out.tracking_boundary_sha256=parts[6];
   return true;
}
bool Tov2WireFrameMatches(const uchar &payload[],const Tov2LocalRef &reference,const string kind)
{
   uchar frame[];string digest="";
   return Tov2LocalRefValid(reference) && reference.kind==kind &&
      Tov2RecordEncode(kind,reference.generation,payload,frame) &&
      Tov2LocalHash(frame,digest) && digest==reference.sha;
}
bool Tov2WireRegistrationMatches(const CTov2WireRequest &request,const Tov2LocalState &state)
{
   Tov2WireIdentity identity;string json="";uchar registration[];
   return Tov2WireLocalIdentity(state.identity,identity) && Tov2WireIdentityEqual(request.identity,identity) &&
      Tov2CaptureRegistrationBinding(request.registration,state.identity) &&
      Tov2CaptureEncodeRegistration(request.registration,json) && Tov2CaptureUtf8Bytes(json,registration) &&
      Tov2WireFrameMatches(registration,state.registration,"REGISTRATION");
}
bool Tov2WireEventMatches(const Tov2WireEvent &event,const Tov2LocalRef &reference,const int scale)
{
   uchar bytes[];string digest="";
   if(event.sequence!=reference.sequence || event.event_id!=reference.event_id ||
      event.record_sha256!=reference.record_sha || !Tov2CaptureUtf8Bytes(event.record_json,bytes) ||
      !Tov2LocalHash(bytes,digest) || digest!=reference.record_sha ||
      !Tov2WireFrameMatches(bytes,reference,"EVENT")) return false;
   if(reference.deal_id=="-")
   {
      Tov2CaptureProtection protection;
      return reference.revision==0 && Tov2CaptureDecodeProtection(event.record_json,protection);
   }
   Tov2CaptureDeal deal;
   return Tov2CaptureDecodeDeal(event.record_json,scale,deal) &&
      deal.deal_id==reference.deal_id && deal.revision==reference.revision;
}
bool Tov2WireDurablePrefix(const CTov2WireRequest &request)
{
   if(request.event_count<0 || request.event_count>TOV2_WIRE_EVENTS_MAX ||
      request.event_count>request.collection.produced_events-request.last_acknowledged_event_sequence ||
      (request.event_count==0 && request.collection.produced_events!=request.last_acknowledged_event_sequence)) return false;
   for(int i=0;i<request.event_count;i++)
      if(request.events[i].sequence!=request.last_acknowledged_event_sequence+1+i) return false;
   return true;
}

// Pure recovery validator: only supplied values are consulted. State owns framed
// witness lookup and verifies ack_pending_sha before supplying its decoded payload.
class CTov2TelemetryWireStateV2 : public ITov2CaptureWirePayloadValidator
{
private:
   bool PendingDecoded(const CTov2WireRequest &request,const Tov2WireExpected &expected,
                       const Tov2LocalState &state)
   {
      if(!Tov2WireDurablePrefix(request) || !Tov2WireRegistrationMatches(request,state) || state.pending.kind!="PENDING" ||
         request.request_sequence!=state.pending_request || expected.request_body_sha256!=state.pending_body ||
         request.last_acknowledged_event_sequence!=state.pending_prior || expected.final_event!=state.pending_final ||
         request.event_count!=state.pending_count || request.event_count>state.event_count ||
         request.collection.produced_events!=state.pending_produced || state.pending_produced>state.produced ||
         state.pending_prior!=state.accepted_event || state.pending_request!=state.accepted_request+1 ||
         state.pending_final!=state.pending_prior+state.pending_count) return false;
      for(int i=0;i<request.event_count;i++)
         if(request.events[i].sequence!=state.pending_prior+1+i ||
            !Tov2WireEventMatches(request.events[i],state.events[i],request.registration.display.currency_scale)) return false;
      return true;
   }
public:
   virtual bool RequiresAckWitness() {return true;}
   virtual bool Pending(const uchar &payload[],const Tov2LocalState &state,const string identity)
   {
      if(identity!=state.identity || !Tov2LocalStateValid(state) ||
         !Tov2WireFrameMatches(payload,state.pending,"PENDING")) return false;
      CTov2WireRequest *request=new CTov2WireRequest;
      if(CheckPointer(request)==POINTER_INVALID) return false;
      Tov2WireExpected expected;
      bool valid=Tov2WireDecodeRequest(payload,request,expected) && PendingDecoded(request,expected,state);
      delete request;return valid;
   }
   virtual bool Ack(const uchar &payload[],const Tov2LocalState &state,const string identity)
   {return false;}
   virtual bool AckWithPending(const uchar &response[],const uchar &pending[],
                               const Tov2LocalState &state,const string identity)
   {
      if(identity!=state.identity || !Tov2LocalStateValid(state) || state.ack.kind!="ACK" ||
         !Tov2Digest(state.ack_pending_sha) || !Tov2WireFrameMatches(response,state.ack,"ACK")) return false;
      CTov2WireRequest *request=new CTov2WireRequest;
      if(CheckPointer(request)==POINTER_INVALID) return false;
      Tov2WireExpected expected;Tov2WireAck ack;
      bool valid=Tov2WireDecodeRequest(pending,request,expected) && Tov2WireDurablePrefix(request) &&
         Tov2WireRegistrationMatches(request,state) &&
         Tov2WireVerifyResponse(pending,response,ack) && ack.request_sequence==state.ack_request &&
         ack.request_body_sha256==state.ack_body && ack.acknowledged_event_sequence==state.ack_event &&
         ack.accepted_at_utc_seconds==state.accepted_at;
      delete request;return valid;
   }
};
#endif
