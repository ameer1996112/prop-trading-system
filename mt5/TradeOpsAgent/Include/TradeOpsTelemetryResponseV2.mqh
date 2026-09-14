#ifndef TRADEOPS_TELEMETRY_RESPONSE_V2_MQH
#define TRADEOPS_TELEMETRY_RESPONSE_V2_MQH
#include "TradeOpsTelemetryWireV2.mqh"

// Offline response verification only. No transport, State, terminal or broker dependency.
struct Tov2WireCoverageResponse
{
   bool observation_gap;
   long pending_events,through_broker_msc;
   string reason,state;
};
struct Tov2WireResponse
{
   long accepted_at_utc_seconds,acknowledged_event_sequence,request_sequence;
   string request_body_sha256,response_body_sha256;
   Tov2WireIdentity identity;
   Tov2WireCoverageResponse coverage;
};

void Tov2WireClearCoverageResponse(Tov2WireCoverageResponse &v)
{
   v.observation_gap=false;v.pending_events=0;v.through_broker_msc=0;v.reason="";v.state="";
}
void Tov2WireClearResponse(Tov2WireResponse &v)
{
   v.accepted_at_utc_seconds=0;v.acknowledged_event_sequence=0;v.request_sequence=0;
   v.request_body_sha256="";v.response_body_sha256="";
   Tov2WireClearIdentity(v.identity);Tov2WireClearCoverageResponse(v.coverage);
}
bool Tov2WireIdentityEqual(const Tov2WireIdentity &a,const Tov2WireIdentity &b)
{
   return a.account_id==b.account_id && a.installation_id==b.installation_id &&
      a.tracking_id==b.tracking_id && a.safety_epoch==b.safety_epoch &&
      a.account_profile_sha256==b.account_profile_sha256 &&
      a.account_fingerprint_sha256==b.account_fingerprint_sha256 &&
      a.tracking_boundary_sha256==b.tracking_boundary_sha256;
}
string Tov2WireCoverageResponseJson(const Tov2WireCoverageResponse &v)
{
   return "{\"observation_gap\":"+Tov2WireBoolean(v.observation_gap)+
      ",\"pending_events\":"+Tov2CaptureNumber(v.pending_events)+
      ",\"reason\":"+Tov2CaptureNullableText(v.reason)+
      ",\"state\":"+Tov2CaptureQuote(v.state)+
      ",\"through_broker_msc\":"+Tov2WireNullableInstant(v.through_broker_msc)+"}";
}

class CTov2WireResponseReader : public CTov2WireReader
{
public:
   bool Coverage(Tov2WireCoverageResponse &v)
   {
      Tov2WireClearCoverageResponse(v);
      return Take("{\"observation_gap\":") && Boolean(v.observation_gap) &&
         Take(",\"pending_events\":") && Number(v.pending_events) &&
         Take(",\"reason\":") && NullableText(v.reason,32) &&
         Take(",\"state\":") && Text(v.state,16) &&
         Take(",\"through_broker_msc\":") && NullableInstant(v.through_broker_msc) && Take("}");
   }
   bool Response(Tov2WireResponse &v)
   {
      Tov2WireClearResponse(v);
      return Take("{\"accepted_at_utc_seconds\":") && Number(v.accepted_at_utc_seconds,1) &&
         Take(",\"acknowledged_event_sequence\":") && Number(v.acknowledged_event_sequence) &&
         Take(",\"command\":null,\"coverage\":") && Coverage(v.coverage) &&
         Take(",\"identity\":") && Identity(v.identity) &&
         Take(",\"mode\":\"DRY_RUN\",\"request_body_sha256\":") && Text(v.request_body_sha256,64) &&
         Take(",\"request_sequence\":") && Number(v.request_sequence,1) &&
         Take(",\"response_body_sha256\":") && Text(v.response_body_sha256,64) &&
         Take(",\"schema_version\":\"AgentSyncResponseV2\"}");
   }
};

bool Tov2WireExpectedCoverage(const Tov2WireExpected &expected,Tov2WireCoverageResponse &coverage)
{
   Tov2WireClearCoverageResponse(coverage);
   if(!Tov2Counter(expected.collection.produced_events) || !Tov2Counter(expected.final_event) ||
      expected.final_event>expected.collection.produced_events || !Tov2WireGap(expected.collection.record_gap)) return false;
   coverage.pending_events=expected.collection.produced_events-expected.final_event;
   coverage.reason=expected.collection.record_gap;
   coverage.observation_gap=expected.collection.observation_gap;
   coverage.state=coverage.reason!=""?"DATA_MISSING":
      (!expected.collection.scan_finished || coverage.pending_events!=0)?"CATCHING_UP":"UP_TO_DATE";
   coverage.through_broker_msc=coverage.state=="UP_TO_DATE"?expected.collection.scan_through_broker_msc:0;
   return true;
}

bool Tov2WireVerifyResponse(const uchar &pending[],const uchar &response[],Tov2WireAck &ack)
{
   Tov2WireClearAck(ack);

   // Pending bytes are the sole durable correlation authority. Fully validate them first.
   CTov2WireRequest *request=new CTov2WireRequest;
   if(CheckPointer(request)==POINTER_INVALID) return false;
   Tov2WireExpected expected;
   const bool pending_ok=Tov2WireDecodeRequest(pending,request,expected);
   delete request;
   if(!pending_ok) return false;

   if(ArraySize(response)<1 || ArraySize(response)>TOV2_WIRE_RESPONSE_MAX) return false;
   string actual="";
   if(!Tov2CaptureUtf8Text(response,actual)) return false;
   CTov2WireResponseReader reader;Tov2WireResponse parsed;
   if(!reader.Start(actual) || !reader.Response(parsed) || !reader.Done()) return false;

   Tov2WireCoverageResponse coverage;
   if(!Tov2WireExpectedCoverage(expected,coverage) ||
      !Tov2WireIdentityEqual(parsed.identity,expected.identity) ||
      parsed.request_sequence!=expected.request_sequence ||
      parsed.request_body_sha256!=expected.request_body_sha256 ||
      parsed.acknowledged_event_sequence!=expected.final_event ||
      !Tov2Counter(parsed.accepted_at_utc_seconds,1) || !Tov2Digest(parsed.response_body_sha256)) return false;

   string body="{\"accepted_at_utc_seconds\":"+Tov2CaptureNumber(parsed.accepted_at_utc_seconds)+
      ",\"acknowledged_event_sequence\":"+Tov2CaptureNumber(expected.final_event)+
      ",\"command\":null,\"coverage\":"+Tov2WireCoverageResponseJson(coverage)+
      ",\"identity\":"+Tov2WireIdentityJson(expected.identity)+
      ",\"mode\":\"DRY_RUN\",\"request_body_sha256\":"+Tov2CaptureQuote(expected.request_body_sha256)+
      ",\"request_sequence\":"+Tov2CaptureNumber(expected.request_sequence)+
      ",\"schema_version\":\"AgentSyncResponseV2\"}";
   string digest="";
   if(!Tov2CaptureRecordHash(body,digest)) return false;
   string canonical=StringSubstr(body,0,StringLen(body)-StringLen("\"schema_version\":\"AgentSyncResponseV2\"}"))+
      "\"response_body_sha256\":"+Tov2CaptureQuote(digest)+",\"schema_version\":\"AgentSyncResponseV2\"}";
   if(parsed.response_body_sha256!=digest || actual!=canonical) return false;

   ack.request_sequence=expected.request_sequence;
   ack.acknowledged_event_sequence=expected.final_event;
   ack.accepted_at_utc_seconds=parsed.accepted_at_utc_seconds;
   ack.request_body_sha256=expected.request_body_sha256;
   ack.response_body_sha256=digest;
   return true;
}
#endif
