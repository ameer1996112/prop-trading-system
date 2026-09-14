#ifndef TRADEOPS_TELEMETRY_WIRE_TYPES_MQH
#define TRADEOPS_TELEMETRY_WIRE_TYPES_MQH
#include "TradeOpsCaptureTypes.mqh"
#define TOV2_WIRE_REQUEST_MAX 262144
#define TOV2_WIRE_RESPONSE_MAX 16384
#define TOV2_WIRE_EVENTS_MAX 32

struct Tov2WireIdentity
{
   string account_id,installation_id,tracking_id;
   long safety_epoch;
   string account_profile_sha256,account_fingerprint_sha256,tracking_boundary_sha256;
};
struct Tov2WireCollection
{
   long produced_events,scan_through_broker_msc; // Zero watermark encodes null.
   bool scan_finished,observation_gap;
   string record_gap; // Empty encodes null.
};
struct Tov2WireDiagnostics
{
   string ea_release,reported_source_sha256,reported_manifest_sha256,source_symbol;
   long terminal_build,observed_at_utc_seconds,last_successful_upload_utc_seconds;
   long last_accepted_request_sequence,local_unsent_events;
   string terminal_connection_state,account_trade_permission,terminal_trade_permission,algo_trading_permission,last_error;
};
struct Tov2WireEvent
{
   long sequence,observed_at_utc_seconds;
   string event_id,record_sha256,record_json;
};
class CTov2WireRequest
{
public:
   Tov2WireIdentity identity;
   Tov2CaptureRegistration registration;
   long request_sequence,last_acknowledged_event_sequence,sent_at_utc_seconds;
   Tov2CaptureAccount account;
   Tov2CaptureExposure exposure;
   Tov2WireCollection collection;
   Tov2WireDiagnostics diagnostics;
   Tov2WireEvent events[TOV2_WIRE_EVENTS_MAX];
   int event_count;
};
struct Tov2WireExpected
{
   Tov2WireIdentity identity;
   long request_sequence,final_event;
   string request_body_sha256;
   Tov2WireCollection collection;
};
struct Tov2WireAck
{
   long request_sequence,acknowledged_event_sequence,accepted_at_utc_seconds;
   string request_body_sha256,response_body_sha256;
};

void Tov2WireClearIdentity(Tov2WireIdentity &v)
{
   v.account_id="";v.installation_id="";v.tracking_id="";v.safety_epoch=0;
   v.account_profile_sha256="";v.account_fingerprint_sha256="";v.tracking_boundary_sha256="";
}
void Tov2WireClearCollection(Tov2WireCollection &v)
{
   v.produced_events=0;v.scan_through_broker_msc=0;v.scan_finished=false;v.observation_gap=false;v.record_gap="";
}
void Tov2WireClearExpected(Tov2WireExpected &v)
{
   Tov2WireClearIdentity(v.identity);Tov2WireClearCollection(v.collection);
   v.request_sequence=0;v.final_event=0;v.request_body_sha256="";
}
void Tov2WireClearAck(Tov2WireAck &v)
{
   v.request_sequence=0;v.acknowledged_event_sequence=0;v.accepted_at_utc_seconds=0;
   v.request_body_sha256="";v.response_body_sha256="";
}
void Tov2WireClearRequest(CTov2WireRequest &v)
{
   Tov2WireClearIdentity(v.identity);Tov2WireClearCollection(v.collection);
   v.request_sequence=0;v.last_acknowledged_event_sequence=0;v.sent_at_utc_seconds=0;
   Tov2CaptureClearAccount(v.account);Tov2CaptureClearExposure(v.exposure);
   ZeroMemory(v.registration);Tov2CaptureClearExposure(v.registration.baseline);
   v.registration.boundary.tracking_id="";v.registration.boundary.account_fingerprint_sha256="";
   for(int i=0;i<TOV2_CAPTURE_BOUNDARY_MAX;i++) v.registration.boundary.excluded_boundary_deal_ids[i]="";
   v.registration.display.company="";v.registration.display.server="";v.registration.display.login_last4="";
   v.registration.display.currency="";v.registration.display.account_mode="";v.registration.display.margin_mode="";
   ZeroMemory(v.diagnostics);
   v.diagnostics.ea_release="";v.diagnostics.reported_source_sha256="";v.diagnostics.reported_manifest_sha256="";
   v.diagnostics.source_symbol="";v.diagnostics.terminal_connection_state="";v.diagnostics.account_trade_permission="";
   v.diagnostics.terminal_trade_permission="";v.diagnostics.algo_trading_permission="";v.diagnostics.last_error="";
   v.event_count=0;
   for(int i=0;i<TOV2_WIRE_EVENTS_MAX;i++)
   {
      v.events[i].sequence=0;v.events[i].observed_at_utc_seconds=0;
      v.events[i].event_id="";v.events[i].record_sha256="";v.events[i].record_json="";
   }
}
#endif
