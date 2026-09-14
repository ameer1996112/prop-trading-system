#ifndef TRADEOPS_CAPTURE_CODEC_MQH
#define TRADEOPS_CAPTURE_CODEC_MQH
#include "TradeOpsCaptureTypes.mqh"
#include "TradeOpsTelemetryRecord.mqh"

string Tov2CaptureNumber(const long n) { return StringFormat("%I64d",n); }
string Tov2CaptureQuote(const string s)
{
   string out="\"";
   for(int i=0;i<StringLen(s);i++)
   {
      ushort ch=StringGetCharacter(s,i);
      if(ch==34 || ch==92) out+="\\";
      out+=ShortToString(ch);
   }
   return out+"\"";
}
string Tov2CaptureNullableText(const string s) { return s==""?"null":Tov2CaptureQuote(s); }
string Tov2CaptureNullableCount(const long n) { return n==-1?"null":Tov2CaptureNumber(n); }
string Tov2CaptureFixedJson(const Tov2CaptureFixed &f)
{
   string out=""; if(!Tov2FixedJson(f.value,f.scale,out)) return ""; return out;
}
bool Tov2CaptureEncodeReading(const Tov2CaptureReading &r,string &out)
{
   out=""; if(!Tov2CaptureReadingValid(r)) return false;
   if(r.reason!="") return Tov2MissingReading(r.reason,out);
   return Tov2KnownReading(r.fixed.value,r.fixed.scale,out);
}
string Tov2CaptureReadingJson(const Tov2CaptureReading &r)
{
   string out=""; Tov2CaptureEncodeReading(r,out); return out;
}
bool Tov2CaptureUtf8Bytes(const string text,uchar &bytes[])
{
   ArrayResize(bytes,0);
   if(!Tov2CaptureText(text,TOV2_CAPTURE_JSON_MAX)) return false;
   int size=StringToCharArray(text,bytes,0,WHOLE_ARRAY,CP_UTF8);
   if(size<2 || size>TOV2_CAPTURE_JSON_MAX+1 || ArraySize(bytes)!=size || bytes[size-1]!=0)
   { ArrayResize(bytes,0);return false; }
   if(ArrayResize(bytes,size-1)!=size-1) { ArrayResize(bytes,0);return false; }
   return true;
}
bool Tov2CaptureUtf8Text(const uchar &bytes[],string &out)
{
   out=""; int n=ArraySize(bytes);
   if(n<1 || n>TOV2_CAPTURE_JSON_MAX) return false;
   string candidate=CharArrayToString(bytes,0,n,CP_UTF8);
   uchar again[];
   if(!Tov2CaptureUtf8Bytes(candidate,again) || ArraySize(again)!=n) return false;
   for(int i=0;i<n;i++) if(bytes[i]!=again[i]) return false;
   out=candidate; return true;
}
bool Tov2CaptureFinish(const string candidate,string &out)
{
   out=""; uchar bytes[];
   if(!Tov2CaptureUtf8Bytes(candidate,bytes)) return false;
   out=candidate; return true;
}
bool Tov2CaptureRecordHash(const string canonical_record,string &out)
{
   out="";uchar bytes[];
   return Tov2CaptureUtf8Bytes(canonical_record,bytes) && Tov2RecordHash(bytes,out) && Tov2Digest(out);
}

bool Tov2CaptureEncodeAccount(const Tov2CaptureAccount &v,const int scale,string &out)
{
   out=""; if(!Tov2CaptureAccountValid(v,scale)) return false;
   string candidate="{"+"\"balance\":"+Tov2CaptureReadingJson(v.balance)+",\"equity\":"+Tov2CaptureReadingJson(v.equity)+",\"margin_free\":"+Tov2CaptureReadingJson(v.margin_free)+",\"margin_level\":"+Tov2CaptureReadingJson(v.margin_level)+",\"margin_used\":"+Tov2CaptureReadingJson(v.margin_used)+",\"observed_at_broker_msc\":"+Tov2CaptureNumber(v.observed_at_broker_msc)+",\"observed_at_utc_seconds\":"+Tov2CaptureNumber(v.observed_at_utc_seconds)+",\"status\":"+Tov2CaptureQuote(v.status)+"}";
   return Tov2CaptureFinish(candidate,out);
}

bool Tov2CaptureEncodePosition(const Tov2CapturePosition &v,const int scale,string &out)
{
   out=""; if(!Tov2CapturePositionValid(v,scale)) return false;
   string candidate="{"+"\"current_price\":"+Tov2CaptureReadingJson(v.current_price)+",\"entry_price\":"+Tov2CaptureReadingJson(v.entry_price)+",\"floating_profit\":"+Tov2CaptureReadingJson(v.floating_profit)+",\"position_id\":"+Tov2CaptureQuote(v.position_id)+",\"side\":"+Tov2CaptureQuote(v.side)+",\"sl\":"+Tov2CaptureReadingJson(v.sl)+",\"swap\":"+Tov2CaptureReadingJson(v.swap)+",\"symbol\":"+Tov2CaptureQuote(v.symbol)+",\"ticket\":"+Tov2CaptureQuote(v.ticket)+",\"tp\":"+Tov2CaptureReadingJson(v.tp)+",\"volume\":"+Tov2CaptureFixedJson(v.volume)+"}";
   return Tov2CaptureFinish(candidate,out);
}

bool Tov2CaptureEncodeOrder(const Tov2CaptureOrder &v,string &out)
{
   out=""; if(!Tov2CaptureOrderValid(v)) return false;
   string candidate="{"+"\"price\":"+Tov2CaptureReadingJson(v.price)+",\"sl\":"+Tov2CaptureReadingJson(v.sl)+",\"state\":"+Tov2CaptureQuote(v.state)+",\"stop_limit_price\":"+Tov2CaptureReadingJson(v.stop_limit_price)+",\"symbol\":"+Tov2CaptureQuote(v.symbol)+",\"ticket\":"+Tov2CaptureQuote(v.ticket)+",\"tp\":"+Tov2CaptureReadingJson(v.tp)+",\"type\":"+Tov2CaptureQuote(v.type)+",\"volume_current\":"+Tov2CaptureFixedJson(v.volume_current)+",\"volume_initial\":"+Tov2CaptureFixedJson(v.volume_initial)+"}";
   return Tov2CaptureFinish(candidate,out);
}

bool Tov2CaptureEncodeDisplay(const Tov2CaptureDisplay &v,string &out)
{
   out=""; if(!Tov2CaptureDisplayValid(v)) return false;
   string candidate="{"+"\"account_mode\":"+Tov2CaptureQuote(v.account_mode)+",\"company\":"+Tov2CaptureQuote(v.company)+",\"currency\":"+Tov2CaptureQuote(v.currency)+",\"currency_scale\":"+Tov2CaptureNumber(v.currency_scale)+",\"login_last4\":"+Tov2CaptureQuote(v.login_last4)+",\"margin_mode\":"+Tov2CaptureQuote(v.margin_mode)+",\"server\":"+Tov2CaptureQuote(v.server)+"}";
   return Tov2CaptureFinish(candidate,out);
}

bool Tov2CaptureEncodeProtection(const Tov2CaptureProtection &v,string &out)
{
   out=""; if(!Tov2CaptureProtectionValid(v)) return false;
   string candidate="{"+"\"kind\":"+"\"PROTECTION_OBSERVATION\""+",\"observed_at_broker_msc\":"+Tov2CaptureNumber(v.observed_at_broker_msc)+",\"position_id\":"+Tov2CaptureQuote(v.position_id)+",\"sl\":"+Tov2CaptureReadingJson(v.sl)+",\"source\":"+Tov2CaptureQuote(v.source)+",\"symbol\":"+Tov2CaptureQuote(v.symbol)+",\"ticket\":"+Tov2CaptureQuote(v.ticket)+",\"tp\":"+Tov2CaptureReadingJson(v.tp)+"}";
   return Tov2CaptureFinish(candidate,out);
}

bool Tov2CaptureEncodeDeal(const Tov2CaptureDeal &v,const int scale,const long revision,const string previous,string &out)
{
   out=""; if(!Tov2CaptureDealValid(v,scale,revision,previous)) return false;
   string candidate="{"+"\"broker_time_msc\":"+Tov2CaptureNumber(v.broker_time_msc)+",\"commission\":"+Tov2CaptureReadingJson(v.commission)+",\"deal_id\":"+Tov2CaptureQuote(v.deal_id)+",\"entry\":"+Tov2CaptureQuote(v.entry)+",\"fee\":"+Tov2CaptureReadingJson(v.fee)+",\"kind\":"+"\"DEAL\""+",\"order_id\":"+Tov2CaptureNullableText(v.order_id)+",\"position_id\":"+Tov2CaptureNullableText(v.position_id)+",\"previous_record_sha256\":"+Tov2CaptureNullableText(previous)+",\"price\":"+Tov2CaptureReadingJson(v.price)+",\"profit\":"+Tov2CaptureReadingJson(v.profit)+",\"protection_source\":"+Tov2CaptureQuote(v.protection_source)+",\"reason\":"+Tov2CaptureQuote(v.reason)+",\"reversal_split\":"+"null"+",\"revision\":"+Tov2CaptureNumber(revision)+",\"sl\":"+Tov2CaptureReadingJson(v.sl)+",\"swap\":"+Tov2CaptureReadingJson(v.swap)+",\"symbol\":"+Tov2CaptureNullableText(v.symbol)+",\"tp\":"+Tov2CaptureReadingJson(v.tp)+",\"type\":"+Tov2CaptureQuote(v.type)+",\"volume\":"+(v.has_volume?Tov2CaptureFixedJson(v.volume):"null")+"}";
   return Tov2CaptureFinish(candidate,out);
}

// Shared canonical construction. Callers apply their envelope's byte cap after
// semantic validation; each constituent row remains validated and bounded.
bool Tov2CaptureExposureJson(const Tov2CaptureExposure &v,const int scale,string &out)
{
   out=""; if(!Tov2CaptureExposureValid(v,scale)) return false;
   string positions="[",orders="[",row="";
   for(int i=0;i<v.positions_size;i++) { if(!Tov2CaptureEncodePosition(v.positions[i],scale,row)) return false; positions+=(i>0?",":"")+row; }
   for(int i=0;i<v.orders_size;i++) { if(!Tov2CaptureEncodeOrder(v.orders[i],row)) return false; orders+=(i>0?",":"")+row; }
   positions+="]";orders+="]";
   out="{\"observed_at_broker_msc\":"+Tov2CaptureNumber(v.observed_at_broker_msc)+
      ",\"observed_at_utc_seconds\":"+Tov2CaptureNumber(v.observed_at_utc_seconds)+
      ",\"order_count\":"+Tov2CaptureNullableCount(v.order_count)+",\"orders\":"+orders+
      ",\"position_count\":"+Tov2CaptureNullableCount(v.position_count)+",\"positions\":"+positions+
      ",\"status\":"+Tov2CaptureQuote(v.status)+"}";
   return true;
}
bool Tov2CaptureEncodeExposure(const Tov2CaptureExposure &v,const int scale,string &out)
{
   out="";string candidate="";
   return Tov2CaptureExposureJson(v,scale,candidate) && Tov2CaptureFinish(candidate,out);
}
bool Tov2CaptureBoundaryValid(const Tov2CaptureBoundary &b)
{
   if(!Tov2Identifier(b.tracking_id) || !Tov2Digest(b.account_fingerprint_sha256) ||
      !Tov2Counter(b.started_at_broker_msc,1) || b.started_at_broker_msc>9007199254739991 || b.started_at_broker_msc%1000!=0 ||
      !Tov2Counter(b.initialized_at_utc_seconds,1) || b.excluded_size<0 || b.excluded_size>TOV2_CAPTURE_BOUNDARY_MAX) return false;
   for(int i=0;i<b.excluded_size;i++)
   {
      if(!Tov2Ticket(b.excluded_boundary_deal_ids[i])) return false;
      if(i>0)
      {
         string a=b.excluded_boundary_deal_ids[i-1],z=b.excluded_boundary_deal_ids[i];
         if(StringCompare(a,z)>=0) return false;
      }
   }
   return true;
}
bool Tov2CaptureEncodeBoundary(const Tov2CaptureBoundary &b,string &out)
{
   out="";if(!Tov2CaptureBoundaryValid(b)) return false;
   string ids="[";
   for(int i=0;i<b.excluded_size;i++) ids+=(i>0?",":"")+Tov2CaptureQuote(b.excluded_boundary_deal_ids[i]);
   ids+="]";
   string boundary="{\"account_fingerprint_sha256\":"+Tov2CaptureQuote(b.account_fingerprint_sha256)+
      ",\"excluded_boundary_deal_ids\":"+ids+",\"initialized_at_utc_seconds\":"+Tov2CaptureNumber(b.initialized_at_utc_seconds)+
      ",\"started_at_broker_msc\":"+Tov2CaptureNumber(b.started_at_broker_msc)+
      ",\"tracking_id\":"+Tov2CaptureQuote(b.tracking_id)+"}";
   return Tov2CaptureFinish(boundary,out);
}
bool Tov2CaptureRegistrationJson(const Tov2CaptureRegistration &v,string &out)
{
   out="";string baseline="",display="",boundary="";
   if(!Tov2CaptureEncodeBoundary(v.boundary,boundary) || v.baseline.status!="COMPLETE" ||
      v.baseline.observed_at_utc_seconds!=v.boundary.initialized_at_utc_seconds ||
      (v.baseline.observed_at_broker_msc/1000)*1000!=v.boundary.started_at_broker_msc ||
      !Tov2CaptureExposureJson(v.baseline,v.display.currency_scale,baseline) ||
      !Tov2CaptureEncodeDisplay(v.display,display)) return false;
   out="{\"baseline\":"+baseline+",\"boundary\":"+boundary+",\"display\":"+display+"}";
   return true;
}
bool Tov2CaptureEncodeRegistration(const Tov2CaptureRegistration &v,string &out)
{
   out="";string candidate="";
   return Tov2CaptureRegistrationJson(v,candidate) && Tov2CaptureFinish(candidate,out);
}
bool Tov2CaptureDealContentHash(const Tov2CaptureDeal &d,const int scale,string &out)
{
   out="";string record="";
   if(!Tov2CaptureEncodeDeal(d,scale,1,"",record)) return false;
   // Separate, explicit domain. This digest must never be passed as the record payload hash.
   return Tov2CaptureRecordHash("TOV2-CAPTURE-DEAL-CONTENT|"+record,out);
}

// Exact ordered shape parser. It accepts no whitespace, unknown keys, alternate escapes,
// duplicate keys or unbounded arrays. Public decoders clear outputs and require reencode equality.
class CTov2CaptureReader
{
private:
   string m_text;
   int m_at;
public:
   bool Start(const string text)
   { m_text="";m_at=0;uchar bytes[]; if(!Tov2CaptureUtf8Bytes(text,bytes)) return false; m_text=text;return true; }
   bool Done() { return m_at==StringLen(m_text); }
   bool Take(const string token)
   {
      if(StringSubstr(m_text,m_at,StringLen(token))!=token) return false;
      m_at+=StringLen(token);return true;
   }
   bool Is(const string token) { return StringSubstr(m_text,m_at,StringLen(token))==token; }
   bool Text(string &out,const int max=160)
   {
      out=""; if(!Take("\"")) return false;
      string s="";
      bool closed=false;
      while(m_at<StringLen(m_text))
      {
         ushort ch=StringGetCharacter(m_text,m_at++);
         if(ch==34) {closed=true;break;}
         if(ch==92)
         {
            if(m_at>=StringLen(m_text)) return false;
            ch=StringGetCharacter(m_text,m_at++);
            if(ch!=34 && ch!=92) return false;
         }
         s+=ShortToString(ch);
         if(StringLen(s)>max) return false;
      }
      if(!closed || !Tov2CaptureText(s,max)) return false;
      out=s;return true;
   }
   bool NullableText(string &out,const int max=160)
   {out="";if(Take("null")) return true;return Text(out,max);}
   bool Number(long &out,const long minimum=0)
   {
      out=0;int start=m_at;
      while(m_at<StringLen(m_text))
      {
         ushort ch=StringGetCharacter(m_text,m_at);
         if(ch<48 || ch>57) break;
         m_at++;if(m_at-start>16) return false;
      }
      return Tov2CounterFromText(StringSubstr(m_text,start,m_at-start),minimum,out);
   }
   bool Scale(int &out)
   {out=0;long n=0;if(!Number(n) || n>16) return false;out=(int)n;return true;}
   bool Count(long &out)
   {out=-1;if(Take("null")) return true;return Number(out);}
   bool Fixed(Tov2CaptureFixed &f)
   {
      ZeroMemory(f);
      return Take("{\"scale\":") && Scale(f.scale) && Take(",\"value\":") && Text(f.value,36) && Take("}") && Tov2CaptureFixedValid(f);
   }
   bool Reading(Tov2CaptureReading &r)
   {
      Tov2CaptureMissing(r);
      if(!Take("{\"reason\":")) return false;
      if(Take("null"))
      {
         r.reason="";
         return Take(",\"value\":") && Fixed(r.fixed) && Take("}");
      }
      string reason="";
      if(!Text(reason,16) || !Take(",\"value\":null}")) return false;
      Tov2CaptureMissing(r,reason);return Tov2CaptureReadingValid(r);
   }
   bool Account(Tov2CaptureAccount &v)
   {
      ZeroMemory(v);
      return Take("{\"balance\":") &&
         Reading(v.balance) &&
         Take(",\"equity\":") &&
         Reading(v.equity) &&
         Take(",\"margin_free\":") &&
         Reading(v.margin_free) &&
         Take(",\"margin_level\":") &&
         Reading(v.margin_level) &&
         Take(",\"margin_used\":") &&
         Reading(v.margin_used) &&
         Take(",\"observed_at_broker_msc\":") &&
         Number(v.observed_at_broker_msc) &&
         Take(",\"observed_at_utc_seconds\":") &&
         Number(v.observed_at_utc_seconds) &&
         Take(",\"status\":") &&
         Text(v.status,160) &&
         Take("}");
   }
   bool Position(Tov2CapturePosition &v)
   {
      ZeroMemory(v);
      return Take("{\"current_price\":") &&
         Reading(v.current_price) &&
         Take(",\"entry_price\":") &&
         Reading(v.entry_price) &&
         Take(",\"floating_profit\":") &&
         Reading(v.floating_profit) &&
         Take(",\"position_id\":") &&
         Text(v.position_id,160) &&
         Take(",\"side\":") &&
         Text(v.side,160) &&
         Take(",\"sl\":") &&
         Reading(v.sl) &&
         Take(",\"swap\":") &&
         Reading(v.swap) &&
         Take(",\"symbol\":") &&
         Text(v.symbol,64) &&
         Take(",\"ticket\":") &&
         Text(v.ticket,160) &&
         Take(",\"tp\":") &&
         Reading(v.tp) &&
         Take(",\"volume\":") &&
         Fixed(v.volume) &&
         Take("}");
   }
   bool Order(Tov2CaptureOrder &v)
   {
      ZeroMemory(v);
      return Take("{\"price\":") &&
         Reading(v.price) &&
         Take(",\"sl\":") &&
         Reading(v.sl) &&
         Take(",\"state\":") &&
         Text(v.state,160) &&
         Take(",\"stop_limit_price\":") &&
         Reading(v.stop_limit_price) &&
         Take(",\"symbol\":") &&
         Text(v.symbol,64) &&
         Take(",\"ticket\":") &&
         Text(v.ticket,160) &&
         Take(",\"tp\":") &&
         Reading(v.tp) &&
         Take(",\"type\":") &&
         Text(v.type,160) &&
         Take(",\"volume_current\":") &&
         Fixed(v.volume_current) &&
         Take(",\"volume_initial\":") &&
         Fixed(v.volume_initial) &&
         Take("}");
   }
   bool Display(Tov2CaptureDisplay &v)
   {
      ZeroMemory(v);
      return Take("{\"account_mode\":") &&
         Text(v.account_mode,160) &&
         Take(",\"company\":") &&
         Text(v.company,96) &&
         Take(",\"currency\":") &&
         Text(v.currency,160) &&
         Take(",\"currency_scale\":") &&
         Scale(v.currency_scale) &&
         Take(",\"login_last4\":") &&
         Text(v.login_last4,160) &&
         Take(",\"margin_mode\":") &&
         Text(v.margin_mode,160) &&
         Take(",\"server\":") &&
         Text(v.server,96) &&
         Take("}");
   }
   bool Protection(Tov2CaptureProtection &v)
   {
      ZeroMemory(v);
      return Take("{\"kind\":") &&
         Take("\"PROTECTION_OBSERVATION\"") &&
         Take(",\"observed_at_broker_msc\":") &&
         Number(v.observed_at_broker_msc) &&
         Take(",\"position_id\":") &&
         Text(v.position_id,160) &&
         Take(",\"sl\":") &&
         Reading(v.sl) &&
         Take(",\"source\":") &&
         Text(v.source,160) &&
         Take(",\"symbol\":") &&
         Text(v.symbol,64) &&
         Take(",\"ticket\":") &&
         Text(v.ticket,160) &&
         Take(",\"tp\":") &&
         Reading(v.tp) &&
         Take("}");
   }
   bool Deal(Tov2CaptureDeal &v)
   {
      ZeroMemory(v);
      return Take("{\"broker_time_msc\":") &&
         Number(v.broker_time_msc) &&
         Take(",\"commission\":") &&
         Reading(v.commission) &&
         Take(",\"deal_id\":") &&
         Text(v.deal_id,160) &&
         Take(",\"entry\":") &&
         Text(v.entry,160) &&
         Take(",\"fee\":") &&
         Reading(v.fee) &&
         Take(",\"kind\":") &&
         Take("\"DEAL\"") &&
         Take(",\"order_id\":") &&
         NullableText(v.order_id,20) &&
         Take(",\"position_id\":") &&
         NullableText(v.position_id,20) &&
         Take(",\"previous_record_sha256\":") &&
         NullableText(v.previous_record_sha256,64) &&
         Take(",\"price\":") &&
         Reading(v.price) &&
         Take(",\"profit\":") &&
         Reading(v.profit) &&
         Take(",\"protection_source\":") &&
         Text(v.protection_source,160) &&
         Take(",\"reason\":") &&
         Text(v.reason,160) &&
         Take(",\"reversal_split\":") &&
         Take("null") &&
         Take(",\"revision\":") &&
         Number(v.revision,1) &&
         Take(",\"sl\":") &&
         Reading(v.sl) &&
         Take(",\"swap\":") &&
         Reading(v.swap) &&
         Take(",\"symbol\":") &&
         NullableText(v.symbol,64) &&
         Take(",\"tp\":") &&
         Reading(v.tp) &&
         Take(",\"type\":") &&
         Text(v.type,160) &&
         Take(",\"volume\":") &&
         OptionalVolume(v) &&
         Take("}");
   }
   bool OptionalVolume(Tov2CaptureDeal &v)
   {
      v.has_volume=false;
      if(Take("null")) return true;
      v.has_volume=true;return Fixed(v.volume);
   }
   bool Exposure(Tov2CaptureExposure &v)
   {
      Tov2CaptureClearExposure(v);
      if(!Take("{\"observed_at_broker_msc\":") || !Number(v.observed_at_broker_msc,1) ||
         !Take(",\"observed_at_utc_seconds\":") || !Number(v.observed_at_utc_seconds,1) ||
         !Take(",\"order_count\":") || !Count(v.order_count) || !Take(",\"orders\":[")) return false;
      if(!Is("]")) do
      {
         if(v.orders_size>=TOV2_CAPTURE_ORDERS_MAX || !Order(v.orders[v.orders_size])) return false;
         v.orders_size++;
      } while(Take(","));
      if(!Take("],\"position_count\":") || !Count(v.position_count) || !Take(",\"positions\":[")) return false;
      if(!Is("]")) do
      {
         if(v.positions_size>=TOV2_CAPTURE_POSITIONS_MAX || !Position(v.positions[v.positions_size])) return false;
         v.positions_size++;
      } while(Take(","));
      return Take("],\"status\":") && Text(v.status,16) && Take("}");
   }
   bool Registration(Tov2CaptureRegistration &v)
   {
      ZeroMemory(v);
      if(!Take("{\"baseline\":") || !Exposure(v.baseline) ||
         !Take(",\"boundary\":{\"account_fingerprint_sha256\":") || !Text(v.boundary.account_fingerprint_sha256,64) ||
         !Take(",\"excluded_boundary_deal_ids\":[")) return false;
      if(!Is("]")) do
      {
         if(v.boundary.excluded_size>=TOV2_CAPTURE_BOUNDARY_MAX ||
            !Text(v.boundary.excluded_boundary_deal_ids[v.boundary.excluded_size],20)) return false;
         v.boundary.excluded_size++;
      } while(Take(","));
      return Take("],\"initialized_at_utc_seconds\":") && Number(v.boundary.initialized_at_utc_seconds,1) &&
         Take(",\"started_at_broker_msc\":") && Number(v.boundary.started_at_broker_msc,1) &&
         Take(",\"tracking_id\":") && Text(v.boundary.tracking_id,160) &&
         Take("},\"display\":") && Display(v.display) && Take("}");
   }
};
bool Tov2CaptureDecodeAccount(const string canonical,const int scale,Tov2CaptureAccount &out)
{
   ZeroMemory(out);Tov2CaptureAccount candidate;CTov2CaptureReader reader;string encoded="";
   if(!reader.Start(canonical) || !reader.Account(candidate) || !reader.Done() ||
      !Tov2CaptureEncodeAccount(candidate,scale,encoded) || encoded!=canonical) return false;
   out=candidate;return true;
}
bool Tov2CaptureDecodeExposure(const string canonical,const int scale,Tov2CaptureExposure &out)
{
   ZeroMemory(out);Tov2CaptureExposure candidate;CTov2CaptureReader reader;string encoded="";
   if(!reader.Start(canonical) || !reader.Exposure(candidate) || !reader.Done() ||
      !Tov2CaptureEncodeExposure(candidate,scale,encoded) || encoded!=canonical) return false;
   out=candidate;return true;
}
bool Tov2CaptureDecodeRegistration(const string canonical,Tov2CaptureRegistration &out)
{
   ZeroMemory(out);Tov2CaptureRegistration candidate;CTov2CaptureReader reader;string encoded="";
   if(!reader.Start(canonical) || !reader.Registration(candidate) || !reader.Done() ||
      !Tov2CaptureEncodeRegistration(candidate,encoded) || encoded!=canonical) return false;
   out=candidate;return true;
}
bool Tov2CaptureDecodeDeal(const string canonical,const int scale,Tov2CaptureDeal &out)
{
   ZeroMemory(out);Tov2CaptureDeal candidate;CTov2CaptureReader reader;string encoded="";
   if(!reader.Start(canonical) || !reader.Deal(candidate) || !reader.Done() ||
      !Tov2CaptureEncodeDeal(candidate,scale,candidate.revision,candidate.previous_record_sha256,encoded) || encoded!=canonical) return false;
   out=candidate;return true;
}
bool Tov2CaptureDecodeProtection(const string canonical,Tov2CaptureProtection &out)
{
   ZeroMemory(out);Tov2CaptureProtection candidate;CTov2CaptureReader reader;string encoded="";
   if(!reader.Start(canonical) || !reader.Protection(candidate) || !reader.Done() ||
      !Tov2CaptureEncodeProtection(candidate,encoded) || encoded!=canonical) return false;
   out=candidate;return true;
}

#endif
