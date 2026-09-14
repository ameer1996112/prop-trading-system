#ifndef TRADEOPS_TELEMETRY_WIRE_V2_MQH
#define TRADEOPS_TELEMETRY_WIRE_V2_MQH
#include "TradeOpsTelemetryWireTypes.mqh"
#include "TradeOpsCaptureCodec.mqh"

// Pure wire operations. No capture adapter, terminal, transport or committed State dependency.
string Tov2WireBoolean(const bool value) {return value?"true":"false";}
string Tov2WireNullableInstant(const long value) {return value==0?"null":Tov2CaptureNumber(value);}
bool Tov2WireOptionalDigest(const string value) {return value=="" || Tov2Digest(value);}
bool Tov2WireGap(const string value)
{
   return value=="" || Tov2CaptureChoice(value,"HISTORY_UNAVAILABLE|CLOCK_DISCONTINUITY|OUTBOX_CORRUPT|CAPTURE_FAILED|UNSUPPORTED_RECORD");
}
bool Tov2WireIdentityValid(const Tov2WireIdentity &v)
{
   return Tov2Identifier(v.account_id) && Tov2Identifier(v.installation_id) && Tov2Identifier(v.tracking_id) &&
      Tov2Counter(v.safety_epoch) && Tov2Digest(v.account_profile_sha256) &&
      Tov2Digest(v.account_fingerprint_sha256) && Tov2Digest(v.tracking_boundary_sha256);
}
string Tov2WireIdentityJson(const Tov2WireIdentity &v)
{
   return "{\"account_fingerprint_sha256\":"+Tov2CaptureQuote(v.account_fingerprint_sha256)+
      ",\"account_id\":"+Tov2CaptureQuote(v.account_id)+",\"account_profile_sha256\":"+Tov2CaptureQuote(v.account_profile_sha256)+
      ",\"installation_id\":"+Tov2CaptureQuote(v.installation_id)+",\"safety_epoch\":"+Tov2CaptureNumber(v.safety_epoch)+
      ",\"tracking_boundary_sha256\":"+Tov2CaptureQuote(v.tracking_boundary_sha256)+",\"tracking_id\":"+Tov2CaptureQuote(v.tracking_id)+"}";
}
bool Tov2WireCollectionValid(const Tov2WireCollection &v,const long acknowledged)
{
   return Tov2Counter(v.produced_events) && Tov2Counter(acknowledged) && acknowledged<=v.produced_events &&
      Tov2Counter(v.scan_through_broker_msc) && (!v.scan_finished || v.scan_through_broker_msc!=0) && Tov2WireGap(v.record_gap);
}
string Tov2WireCollectionJson(const Tov2WireCollection &v)
{
   return "{\"observation_gap\":"+Tov2WireBoolean(v.observation_gap)+",\"produced_events\":"+Tov2CaptureNumber(v.produced_events)+
      ",\"record_gap\":"+Tov2CaptureNullableText(v.record_gap)+",\"scan_finished\":"+Tov2WireBoolean(v.scan_finished)+
      ",\"scan_through_broker_msc\":"+Tov2WireNullableInstant(v.scan_through_broker_msc)+"}";
}
bool Tov2WireDiagnosticsValid(const Tov2WireDiagnostics &v)
{
   return Tov2CaptureText(v.ea_release,64) && Tov2WireOptionalDigest(v.reported_source_sha256) &&
      Tov2WireOptionalDigest(v.reported_manifest_sha256) && Tov2CaptureText(v.source_symbol,64) &&
      Tov2Counter(v.terminal_build,1) && Tov2Counter(v.observed_at_utc_seconds,1) &&
      Tov2Counter(v.last_successful_upload_utc_seconds) && Tov2Counter(v.last_accepted_request_sequence) &&
      Tov2Counter(v.local_unsent_events) && Tov2CaptureChoice(v.terminal_connection_state,"CONNECTED|DISCONNECTED|UNKNOWN") &&
      Tov2CaptureChoice(v.account_trade_permission,"ALLOWED|DENIED|UNKNOWN") &&
      Tov2CaptureChoice(v.terminal_trade_permission,"ALLOWED|DENIED|UNKNOWN") &&
      Tov2CaptureChoice(v.algo_trading_permission,"ALLOWED|DENIED|UNKNOWN") &&
      (v.last_error=="" || Tov2CaptureChoice(v.last_error,"HISTORY_UNAVAILABLE|CLOCK_DISCONTINUITY|OUTBOX_CORRUPT|CAPTURE_FAILED|UNSUPPORTED_RECORD|DISK_FULL|HTTP_ERROR|RESPONSE_INVALID"));
}
string Tov2WireDiagnosticsJson(const Tov2WireDiagnostics &v)
{
   return "{\"account_trade_permission\":"+Tov2CaptureQuote(v.account_trade_permission)+
      ",\"algo_trading_permission\":"+Tov2CaptureQuote(v.algo_trading_permission)+",\"ea_release\":"+Tov2CaptureQuote(v.ea_release)+
      ",\"last_accepted_request_sequence\":"+Tov2CaptureNumber(v.last_accepted_request_sequence)+
      ",\"last_error\":"+Tov2CaptureNullableText(v.last_error)+
      ",\"last_successful_upload_utc_seconds\":"+Tov2WireNullableInstant(v.last_successful_upload_utc_seconds)+
      ",\"local_unsent_events\":"+Tov2CaptureNumber(v.local_unsent_events)+",\"observed_at_utc_seconds\":"+Tov2CaptureNumber(v.observed_at_utc_seconds)+
      ",\"reported_manifest_sha256\":"+Tov2CaptureNullableText(v.reported_manifest_sha256)+
      ",\"reported_source_sha256\":"+Tov2CaptureNullableText(v.reported_source_sha256)+",\"source_symbol\":"+Tov2CaptureQuote(v.source_symbol)+
      ",\"terminal_build\":"+Tov2CaptureNumber(v.terminal_build)+",\"terminal_connection_state\":"+Tov2CaptureQuote(v.terminal_connection_state)+
      ",\"terminal_trade_permission\":"+Tov2CaptureQuote(v.terminal_trade_permission)+"}";
}
bool Tov2WireEncodeAccount(const Tov2CaptureAccount &v,const int scale,string &out)
{
   out="";
   // Receiver allows any valid margin_level reading when used margin is zero.
   if(!Tov2Counter(v.observed_at_utc_seconds,1) || !Tov2Counter(v.observed_at_broker_msc,1) ||
      !Tov2CaptureReadingValid(v.balance,scale) || !Tov2CaptureReadingValid(v.equity,scale) ||
      !Tov2CaptureReadingValid(v.margin_free,scale) || !Tov2CaptureReadingValid(v.margin_used,scale) ||
      !Tov2CaptureReadingValid(v.margin_level)) return false;
   if(v.status=="COMPLETE")
   {if(v.balance.reason!="" || v.equity.reason!="" || v.margin_free.reason!="" || v.margin_used.reason!="") return false;}
   else if(v.status=="CAPTURE_FAILED")
   {if(v.balance.reason=="" || v.equity.reason=="" || v.margin_free.reason=="" || v.margin_used.reason=="" || v.margin_level.reason=="") return false;}
   else return false;
   out="{\"balance\":"+Tov2CaptureReadingJson(v.balance)+",\"equity\":"+Tov2CaptureReadingJson(v.equity)+
      ",\"margin_free\":"+Tov2CaptureReadingJson(v.margin_free)+",\"margin_level\":"+Tov2CaptureReadingJson(v.margin_level)+
      ",\"margin_used\":"+Tov2CaptureReadingJson(v.margin_used)+",\"observed_at_broker_msc\":"+Tov2CaptureNumber(v.observed_at_broker_msc)+
      ",\"observed_at_utc_seconds\":"+Tov2CaptureNumber(v.observed_at_utc_seconds)+",\"status\":"+Tov2CaptureQuote(v.status)+"}";
   return true;
}

// Full wire record; capture intentionally only produces the null-split subset.
struct Tov2WireRecord
{
   bool is_deal,has_split;
   Tov2CaptureDeal deal;
   Tov2CaptureProtection protection;
   Tov2CaptureFixed closing_volume,opening_volume;
};
string Tov2WireDealJson(const Tov2WireRecord &v)
{
   string split="null";
   if(v.has_split) split="{\"closing_volume\":"+Tov2CaptureFixedJson(v.closing_volume)+
      ",\"opening_volume\":"+Tov2CaptureFixedJson(v.opening_volume)+",\"source\":\"RECONSTRUCTED_POSITION_VOLUME\"}";
   return "{\"broker_time_msc\":"+Tov2CaptureNumber(v.deal.broker_time_msc)+",\"commission\":"+Tov2CaptureReadingJson(v.deal.commission)+
      ",\"deal_id\":"+Tov2CaptureQuote(v.deal.deal_id)+",\"entry\":"+Tov2CaptureQuote(v.deal.entry)+",\"fee\":"+Tov2CaptureReadingJson(v.deal.fee)+
      ",\"kind\":\"DEAL\",\"order_id\":"+Tov2CaptureNullableText(v.deal.order_id)+",\"position_id\":"+Tov2CaptureNullableText(v.deal.position_id)+
      ",\"previous_record_sha256\":"+Tov2CaptureNullableText(v.deal.previous_record_sha256)+",\"price\":"+Tov2CaptureReadingJson(v.deal.price)+
      ",\"profit\":"+Tov2CaptureReadingJson(v.deal.profit)+",\"protection_source\":"+Tov2CaptureQuote(v.deal.protection_source)+
      ",\"reason\":"+Tov2CaptureQuote(v.deal.reason)+",\"reversal_split\":"+split+",\"revision\":"+Tov2CaptureNumber(v.deal.revision)+
      ",\"sl\":"+Tov2CaptureReadingJson(v.deal.sl)+",\"swap\":"+Tov2CaptureReadingJson(v.deal.swap)+
      ",\"symbol\":"+Tov2CaptureNullableText(v.deal.symbol)+",\"tp\":"+Tov2CaptureReadingJson(v.deal.tp)+
      ",\"type\":"+Tov2CaptureQuote(v.deal.type)+",\"volume\":"+(v.deal.has_volume?Tov2CaptureFixedJson(v.deal.volume):"null")+"}";
}
bool Tov2WireSplitSum(const Tov2CaptureFixed &a,const Tov2CaptureFixed &b,const Tov2CaptureFixed &total)
{
   if(!Tov2CaptureFixedValid(a,true) || !Tov2CaptureFixedValid(b,true) ||
      !Tov2CaptureFixedValid(total,true) || a.scale!=b.scale || a.scale!=total.scale) return false;
   // Add decimal digits directly: up to 34 integer units exceed both long and double precision.
   string x=a.value,y=b.value,z=total.value;
   StringReplace(x,".","");StringReplace(y,".","");StringReplace(z,".","");
   int i=StringLen(x)-1,j=StringLen(y)-1,carry=0;string sum="";
   while(i>=0 || j>=0 || carry!=0)
   {
      int n=carry;
      if(i>=0) n+=(int)StringGetCharacter(x,i--)-48;
      if(j>=0) n+=(int)StringGetCharacter(y,j--)-48;
      sum=ShortToString((ushort)(48+n%10))+sum;carry=n/10;
   }
   while(StringLen(sum)>1 && StringGetCharacter(sum,0)==48) sum=StringSubstr(sum,1);
   while(StringLen(z)>1 && StringGetCharacter(z,0)==48) z=StringSubstr(z,1);
   return sum==z;
}
bool Tov2WireRecordValid(const Tov2WireRecord &v,const Tov2CaptureBoundary &boundary,const int scale)
{
   if(!v.is_deal) return Tov2CaptureProtectionValid(v.protection) && v.protection.observed_at_broker_msc>=boundary.started_at_broker_msc;
   const Tov2CaptureDeal d=v.deal;
   if(!Tov2Ticket(d.deal_id) || !Tov2Counter(d.broker_time_msc,1) || !Tov2Counter(d.revision,1) ||
      ((d.revision==1)!=(d.previous_record_sha256=="")) || !Tov2WireOptionalDigest(d.previous_record_sha256) ||
      !Tov2CaptureChoice(d.type,"BUY|SELL|BUY_CANCELED|SELL_CANCELED|BALANCE|CREDIT|CHARGE|CORRECTION|BONUS|COMMISSION|COMMISSION_DAILY|COMMISSION_MONTHLY|COMMISSION_AGENT_DAILY|COMMISSION_AGENT_MONTHLY|INTEREST|DIVIDEND|DIVIDEND_FRANKED|TAX") ||
      !Tov2CaptureChoice(d.entry,"IN|OUT|INOUT|OUT_BY|NONE") ||
      !Tov2CaptureChoice(d.reason,"CLIENT|MOBILE|WEB|EXPERT|SL|TP|SO|ROLLOVER|VMARGIN|SPLIT|CORPORATE_ACTION|UNKNOWN") ||
      !Tov2CaptureChoice(d.protection_source,"BROKER_DEAL|UNAVAILABLE")) return false;
   if((d.order_id!="" && !Tov2Ticket(d.order_id)) || (d.position_id!="" && !Tov2Ticket(d.position_id)) ||
      (d.symbol!="" && !Tov2CaptureText(d.symbol,64)) || (d.has_volume && !Tov2CaptureFixedValid(d.volume))) return false;
   if(Tov2CaptureDealTrading(d.type))
   {if(d.order_id=="" || d.position_id=="" || d.symbol=="" || !d.has_volume || !Tov2CaptureFixedValid(d.volume,true) || d.entry=="NONE") return false;}
   else if(d.entry!="NONE" || v.has_split) return false;
   if(d.protection_source=="UNAVAILABLE" && (d.sl.reason=="" || d.tp.reason=="")) return false;
   if(v.has_split && (d.entry!="INOUT" || !d.has_volume || !Tov2WireSplitSum(v.closing_volume,v.opening_volume,d.volume))) return false;
   if(d.broker_time_msc<boundary.started_at_broker_msc) return false;
   if(d.broker_time_msc<boundary.started_at_broker_msc+1000)
      for(int i=0;i<boundary.excluded_size;i++) if(boundary.excluded_boundary_deal_ids[i]==d.deal_id) return false;
   return Tov2CaptureReadingValid(d.price) && Tov2CaptureReadingValid(d.profit,scale) &&
      Tov2CaptureReadingValid(d.commission,scale) && Tov2CaptureReadingValid(d.swap,scale) &&
      Tov2CaptureReadingValid(d.fee,scale) && Tov2CaptureReadingValid(d.sl) && Tov2CaptureReadingValid(d.tp);
}

// Base readers have exact canonical order, bounded strings/arrays and strict fixed decimals.
// All reconstructed objects are compared against the original UTF-8 before publication.
class CTov2WireReader : public CTov2CaptureReader
{
public:
   bool Boolean(bool &value)
   {value=false;if(Take("false")) return true;if(!Take("true")) return false;value=true;return true;}
   bool NullableInstant(long &value)
   {value=0;if(Take("null")) return true;return Number(value,1);}
   bool Identity(Tov2WireIdentity &v)
   {
      Tov2WireClearIdentity(v);
      return Take("{\"account_fingerprint_sha256\":") && Text(v.account_fingerprint_sha256,64) &&
         Take(",\"account_id\":") && Text(v.account_id,160) && Take(",\"account_profile_sha256\":") && Text(v.account_profile_sha256,64) &&
         Take(",\"installation_id\":") && Text(v.installation_id,160) && Take(",\"safety_epoch\":") && Number(v.safety_epoch) &&
         Take(",\"tracking_boundary_sha256\":") && Text(v.tracking_boundary_sha256,64) &&
         Take(",\"tracking_id\":") && Text(v.tracking_id,160) && Take("}");
   }
   bool Collection(Tov2WireCollection &v)
   {
      Tov2WireClearCollection(v);
      return Take("{\"observation_gap\":") && Boolean(v.observation_gap) && Take(",\"produced_events\":") && Number(v.produced_events) &&
         Take(",\"record_gap\":") && NullableText(v.record_gap,32) && Take(",\"scan_finished\":") && Boolean(v.scan_finished) &&
         Take(",\"scan_through_broker_msc\":") && NullableInstant(v.scan_through_broker_msc) && Take("}");
   }
   bool Diagnostics(Tov2WireDiagnostics &v)
   {
      return Take("{\"account_trade_permission\":") && Text(v.account_trade_permission,16) &&
         Take(",\"algo_trading_permission\":") && Text(v.algo_trading_permission,16) && Take(",\"ea_release\":") && Text(v.ea_release,64) &&
         Take(",\"last_accepted_request_sequence\":") && Number(v.last_accepted_request_sequence) &&
         Take(",\"last_error\":") && NullableText(v.last_error,32) &&
         Take(",\"last_successful_upload_utc_seconds\":") && NullableInstant(v.last_successful_upload_utc_seconds) &&
         Take(",\"local_unsent_events\":") && Number(v.local_unsent_events) && Take(",\"observed_at_utc_seconds\":") && Number(v.observed_at_utc_seconds,1) &&
         Take(",\"reported_manifest_sha256\":") && NullableText(v.reported_manifest_sha256,64) &&
         Take(",\"reported_source_sha256\":") && NullableText(v.reported_source_sha256,64) && Take(",\"source_symbol\":") && Text(v.source_symbol,64) &&
         Take(",\"terminal_build\":") && Number(v.terminal_build,1) && Take(",\"terminal_connection_state\":") && Text(v.terminal_connection_state,16) &&
         Take(",\"terminal_trade_permission\":") && Text(v.terminal_trade_permission,16) && Take("}");
   }
   bool Reversal(Tov2WireRecord &v)
   {
      v.has_split=false;if(Take("null")) return true;v.has_split=true;
      return Take("{\"closing_volume\":") && Fixed(v.closing_volume) && Take(",\"opening_volume\":") && Fixed(v.opening_volume) &&
         Take(",\"source\":\"RECONSTRUCTED_POSITION_VOLUME\"}");
   }
   bool Record(Tov2WireRecord &v,string &canonical)
   {
      canonical="";ZeroMemory(v);v.is_deal=Is("{\"broker_time_msc\":");
      if(!v.is_deal) return Protection(v.protection) && Tov2CaptureEncodeProtection(v.protection,canonical);
      if(!(Take("{\"broker_time_msc\":") && Number(v.deal.broker_time_msc,1) &&
         Take(",\"commission\":") && Reading(v.deal.commission) && Take(",\"deal_id\":") && Text(v.deal.deal_id,20) &&
         Take(",\"entry\":") && Text(v.deal.entry,16) && Take(",\"fee\":") && Reading(v.deal.fee) && Take(",\"kind\":\"DEAL\"") &&
         Take(",\"order_id\":") && NullableText(v.deal.order_id,20) && Take(",\"position_id\":") && NullableText(v.deal.position_id,20) &&
         Take(",\"previous_record_sha256\":") && NullableText(v.deal.previous_record_sha256,64) && Take(",\"price\":") && Reading(v.deal.price) &&
         Take(",\"profit\":") && Reading(v.deal.profit) && Take(",\"protection_source\":") && Text(v.deal.protection_source,16) &&
         Take(",\"reason\":") && Text(v.deal.reason,32) && Take(",\"reversal_split\":") && Reversal(v) &&
         Take(",\"revision\":") && Number(v.deal.revision,1) && Take(",\"sl\":") && Reading(v.deal.sl) && Take(",\"swap\":") && Reading(v.deal.swap) &&
         Take(",\"symbol\":") && NullableText(v.deal.symbol,64) && Take(",\"tp\":") && Reading(v.deal.tp) &&
         Take(",\"type\":") && Text(v.deal.type,32) && Take(",\"volume\":") && OptionalVolume(v.deal) && Take("}"))) return false;
      canonical=Tov2WireDealJson(v);return true;
   }
   bool Event(Tov2WireEvent &v)
   {
      Tov2WireRecord record;
      return Take("{\"event_id\":") && Text(v.event_id,160) && Take(",\"observed_at_utc_seconds\":") && Number(v.observed_at_utc_seconds,1) &&
         Take(",\"record\":") && Record(record,v.record_json) && Take(",\"record_sha256\":") && Text(v.record_sha256,64) &&
         Take(",\"sequence\":") && Number(v.sequence,1) && Take("}");
   }
   bool Request(CTov2WireRequest &v,string &body_hash)
   {
      body_hash="";
      if(!Take("{\"account\":") || !Account(v.account) || !Take(",\"body_sha256\":") || !Text(body_hash,64) ||
         !Take(",\"collection\":") || !Collection(v.collection) || !Take(",\"diagnostics\":") || !Diagnostics(v.diagnostics) ||
         !Take(",\"events\":[")) return false;
      v.event_count=0;
      if(!Is("]")) do
      {
         if(v.event_count>=TOV2_WIRE_EVENTS_MAX || !Event(v.events[v.event_count])) return false;
         v.event_count++;
      }while(Take(","));
      return Take("],\"exposure\":") && Exposure(v.exposure) && Take(",\"identity\":") && Identity(v.identity) &&
         Take(",\"last_acknowledged_event_sequence\":") && Number(v.last_acknowledged_event_sequence) &&
         Take(",\"registration\":") && Registration(v.registration) && Take(",\"request_sequence\":") && Number(v.request_sequence,1) &&
         Take(",\"schema_version\":\"AgentSyncRequestV2\",\"sent_at_utc_seconds\":") && Number(v.sent_at_utc_seconds,1) && Take("}");
   }
};

bool Tov2WireTimeBetween(const long value,const long first,const long last)
{return Tov2Counter(value,1) && value>=first && value<=last;}
const int TOV2_WIRE_ENCODE_OK=0;
const int TOV2_WIRE_ENCODE_SIZE_LIMIT=1;
const int TOV2_WIRE_ENCODE_INVALID=2;
// Counts UTF-16 scalar values without allocating a UTF-8 buffer. The caller has
// already validated semantics; malformed surrogate sequences still fail closed.
int Tov2WireUtf8SizeResult(const string text,int &size)
{
   for(int i=0;i<StringLen(text);i++)
   {
      ushort c=StringGetCharacter(text,i);int width=1;
      if(c>=0xd800 && c<=0xdbff)
      {
         if(i+1>=StringLen(text)) return TOV2_WIRE_ENCODE_INVALID;
         ushort low=StringGetCharacter(text,++i);
         if(low<0xdc00 || low>0xdfff) return TOV2_WIRE_ENCODE_INVALID;
         width=4;
      }
      else if(c>=0xdc00 && c<=0xdfff) return TOV2_WIRE_ENCODE_INVALID;
      else if(c>=0x800) width=3;
      else if(c>=0x80) width=2;
      size+=width;
      if(size>TOV2_WIRE_REQUEST_MAX) return TOV2_WIRE_ENCODE_SIZE_LIMIT;
   }
   return TOV2_WIRE_ENCODE_OK;
}
bool Tov2WireValidateRequest(const CTov2WireRequest &v,string &account,string &exposure,string &registration)
{
   account="";exposure="";registration="";
   // Reject counts before any access to backing arrays, including embedded capture objects.
   if(v.event_count<0 || v.event_count>TOV2_WIRE_EVENTS_MAX || !Tov2WireIdentityValid(v.identity) ||
      !Tov2Counter(v.request_sequence,1) || !Tov2Counter(v.last_acknowledged_event_sequence) || !Tov2Counter(v.sent_at_utc_seconds,1) ||
      !Tov2WireCollectionValid(v.collection,v.last_acknowledged_event_sequence) || !Tov2WireDiagnosticsValid(v.diagnostics) ||
      !Tov2CaptureRegistrationJson(v.registration,registration)) return false;
   const int scale=v.registration.display.currency_scale;
   if(!Tov2WireEncodeAccount(v.account,scale,account) || !Tov2CaptureExposureJson(v.exposure,scale,exposure)) return false;
   const long initialized=v.registration.boundary.initialized_at_utc_seconds;
   const long started=v.registration.boundary.started_at_broker_msc;
   string boundary="",boundary_hash="";
   if(v.identity.tracking_id!=v.registration.boundary.tracking_id ||
      v.identity.account_fingerprint_sha256!=v.registration.boundary.account_fingerprint_sha256 ||
      !Tov2CaptureEncodeBoundary(v.registration.boundary,boundary) || !Tov2CaptureRecordHash(boundary,boundary_hash) ||
      boundary_hash!=v.identity.tracking_boundary_sha256 || initialized>v.sent_at_utc_seconds ||
      !Tov2WireTimeBetween(v.account.observed_at_utc_seconds,initialized,v.sent_at_utc_seconds) ||
      !Tov2WireTimeBetween(v.exposure.observed_at_utc_seconds,initialized,v.sent_at_utc_seconds) ||
      !Tov2WireTimeBetween(v.diagnostics.observed_at_utc_seconds,initialized,v.sent_at_utc_seconds)) return false;
   if(v.diagnostics.last_accepted_request_sequence!=v.request_sequence-1 ||
      v.diagnostics.local_unsent_events!=v.collection.produced_events-v.last_acknowledged_event_sequence ||
      (v.diagnostics.last_successful_upload_utc_seconds!=0 &&
      !Tov2WireTimeBetween(v.diagnostics.last_successful_upload_utc_seconds,initialized,v.sent_at_utc_seconds))) return false;
   const long upper=v.account.observed_at_broker_msc>v.exposure.observed_at_broker_msc?v.account.observed_at_broker_msc:v.exposure.observed_at_broker_msc;
   if(v.collection.scan_through_broker_msc!=0 && (v.collection.scan_through_broker_msc<started || v.collection.scan_through_broker_msc>upper)) return false;
   string deals[TOV2_WIRE_EVENTS_MAX];
   for(int i=0;i<v.event_count;i++)
   {
      deals[i]="";Tov2WireRecord record;CTov2WireReader reader;string encoded="",digest="";
      if(!Tov2Identifier(v.events[i].event_id) || !Tov2Counter(v.events[i].sequence,1) ||
         v.events[i].sequence>v.collection.produced_events || !Tov2Digest(v.events[i].record_sha256) ||
         !Tov2WireTimeBetween(v.events[i].observed_at_utc_seconds,initialized,v.sent_at_utc_seconds) ||
         !reader.Start(v.events[i].record_json) || !reader.Record(record,encoded) || !reader.Done() || encoded!=v.events[i].record_json ||
         !Tov2WireRecordValid(record,v.registration.boundary,scale) || !Tov2CaptureRecordHash(encoded,digest) || digest!=v.events[i].record_sha256) return false;
      if(record.is_deal) deals[i]=record.deal.deal_id;
      for(int j=0;j<i;j++) if(v.events[j].event_id==v.events[i].event_id || (deals[i]!="" && deals[j]==deals[i])) return false;
   }
   // Receiver validates maxima, not prefix membership or ordering. Committed State proves those later.
   return true;
}
int Tov2WireEncodeRequestResult(const CTov2WireRequest &request,uchar &bytes[],Tov2WireExpected &expected)
{
   ArrayResize(bytes,0);Tov2WireClearExpected(expected);
   ResetLastError();
   string account="",exposure="",registration="";
   if(!Tov2WireValidateRequest(request,account,exposure,registration)) return TOV2_WIRE_ENCODE_INVALID;
   string events="[";
   for(int i=0;i<request.event_count;i++)
   {
      events+=(i==0?"":",")+"{\"event_id\":"+Tov2CaptureQuote(request.events[i].event_id)+
         ",\"observed_at_utc_seconds\":"+Tov2CaptureNumber(request.events[i].observed_at_utc_seconds)+
         ",\"record\":"+request.events[i].record_json+",\"record_sha256\":"+Tov2CaptureQuote(request.events[i].record_sha256)+
         ",\"sequence\":"+Tov2CaptureNumber(request.events[i].sequence)+"}";
   }
   events+="]";
   string prefix="{\"account\":"+account;
   string suffix=",\"collection\":"+Tov2WireCollectionJson(request.collection)+",\"diagnostics\":"+Tov2WireDiagnosticsJson(request.diagnostics)+
      ",\"events\":"+events+",\"exposure\":"+exposure+",\"identity\":"+Tov2WireIdentityJson(request.identity)+
      ",\"last_acknowledged_event_sequence\":"+Tov2CaptureNumber(request.last_acknowledged_event_sequence)+
      ",\"registration\":"+registration+",\"request_sequence\":"+Tov2CaptureNumber(request.request_sequence)+
      ",\"schema_version\":\"AgentSyncRequestV2\",\"sent_at_utc_seconds\":"+Tov2CaptureNumber(request.sent_at_utc_seconds)+"}";
   string hash="";
   if(GetLastError()!=0) return TOV2_WIRE_ENCODE_INVALID;
   int size=StringLen(",\"body_sha256\":\"\"")+64;
   int measured=Tov2WireUtf8SizeResult(prefix,size);
   if(measured!=TOV2_WIRE_ENCODE_OK) return measured;
   measured=Tov2WireUtf8SizeResult(suffix,size);
   if(measured!=TOV2_WIRE_ENCODE_OK) return measured;
   if(!Tov2CaptureRecordHash(prefix+suffix,hash) || !Tov2CaptureUtf8Bytes(prefix+",\"body_sha256\":"+Tov2CaptureQuote(hash)+suffix,bytes))
   {ArrayResize(bytes,0);return TOV2_WIRE_ENCODE_INVALID;}
   if(ArraySize(bytes)!=size) {ArrayResize(bytes,0);return TOV2_WIRE_ENCODE_INVALID;}
   expected.identity=request.identity;expected.collection=request.collection;expected.request_sequence=request.request_sequence;
   expected.final_event=request.event_count>0?request.events[request.event_count-1].sequence:request.last_acknowledged_event_sequence;
   expected.request_body_sha256=hash;
   return TOV2_WIRE_ENCODE_OK;
}
bool Tov2WireEncodeRequest(const CTov2WireRequest &request,uchar &bytes[],Tov2WireExpected &expected)
{return Tov2WireEncodeRequestResult(request,bytes,expected)==TOV2_WIRE_ENCODE_OK;}
void Tov2WirePublishRequest(const CTov2WireRequest &source,CTov2WireRequest &out)
{
   out.identity=source.identity;out.registration=source.registration;out.request_sequence=source.request_sequence;
   out.last_acknowledged_event_sequence=source.last_acknowledged_event_sequence;out.sent_at_utc_seconds=source.sent_at_utc_seconds;
   out.account=source.account;out.exposure=source.exposure;out.collection=source.collection;out.diagnostics=source.diagnostics;
   out.event_count=source.event_count;
   for(int i=0;i<source.event_count;i++) out.events[i]=source.events[i];
}
bool Tov2WireDecodeRequest(const uchar &bytes[],CTov2WireRequest &request,Tov2WireExpected &expected)
{
   Tov2WireClearRequest(request);Tov2WireClearExpected(expected);
   string text="";
   if(!Tov2CaptureUtf8Text(bytes,text)) return false;
   CTov2WireRequest *candidate=new CTov2WireRequest;
   if(CheckPointer(candidate)==POINTER_INVALID) return false;
   Tov2WireClearRequest(candidate);
   CTov2WireReader reader;string hash="";uchar encoded[];Tov2WireExpected verified;
   bool ok=reader.Start(text) && reader.Request(candidate,hash) && reader.Done() &&
      Tov2WireEncodeRequest(candidate,encoded,verified) && verified.request_body_sha256==hash && ArraySize(bytes)==ArraySize(encoded);
   if(ok) for(int i=0;i<ArraySize(bytes);i++) if(bytes[i]!=encoded[i]) {ok=false;break;}
   if(ok) {Tov2WirePublishRequest(candidate,request);expected=verified;}
   delete candidate;return ok;
}
#endif
