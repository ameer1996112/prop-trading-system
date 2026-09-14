#ifndef TRADEOPS_CAPTURE_TYPES_MQH
#define TRADEOPS_CAPTURE_TYPES_MQH
#include "TradeOpsTelemetryValues.mqh"
#define TOV2_CAPTURE_POSITIONS_MAX 128
#define TOV2_CAPTURE_ORDERS_MAX 128
#define TOV2_CAPTURE_HISTORY_MAX 256
#define TOV2_CAPTURE_BOUNDARY_MAX 1024
#define TOV2_CAPTURE_JSON_MAX 262144

enum Tov2CaptureResult
{
   TOV2_CAPTURE_OK=0,
   TOV2_CAPTURE_READ_FAILED=1,
   TOV2_CAPTURE_LIMIT_EXCEEDED=2,
   TOV2_CAPTURE_UNSUPPORTED=3,
   TOV2_CAPTURE_IDENTITY_CHANGED=4
};
struct Tov2CaptureFixed { string value; int scale; };
struct Tov2CaptureReading { string reason; Tov2CaptureFixed fixed; };
struct Tov2CaptureDisplay
{
   string company,server,login_last4,currency,account_mode,margin_mode;
   int currency_scale;
};
struct Tov2CaptureAccount
{
   string status;
   long observed_at_utc_seconds,observed_at_broker_msc;
   Tov2CaptureReading balance,equity,margin_used,margin_free,margin_level;
};
struct Tov2CapturePosition
{
   string ticket,position_id,symbol,side;
   Tov2CaptureFixed volume;
   Tov2CaptureReading entry_price,current_price,sl,tp,floating_profit,swap;
};
struct Tov2CaptureOrder
{
   string ticket,symbol,type,state;
   Tov2CaptureFixed volume_initial,volume_current;
   Tov2CaptureReading price,stop_limit_price,sl,tp;
};
struct Tov2CaptureExposure
{
   string status;
   long observed_at_utc_seconds,observed_at_broker_msc;
   // -1 means actual count unknown. A failed attempt never contains partial rows.
   long position_count,order_count;
   int positions_size,orders_size;
   Tov2CapturePosition positions[TOV2_CAPTURE_POSITIONS_MAX];
   Tov2CaptureOrder orders[TOV2_CAPTURE_ORDERS_MAX];
};
struct Tov2CaptureBoundary
{
   string tracking_id,account_fingerprint_sha256;
   long started_at_broker_msc,initialized_at_utc_seconds;
   int excluded_size;
   string excluded_boundary_deal_ids[TOV2_CAPTURE_BOUNDARY_MAX];
};
struct Tov2CaptureRegistration
{
   Tov2CaptureBoundary boundary;
   Tov2CaptureDisplay display;
   Tov2CaptureExposure baseline;
};
struct Tov2CaptureDeal
{
   string deal_id,type,entry,order_id,position_id,symbol,reason,protection_source;
   long broker_time_msc,revision;
   // Empty previous digest encodes null. Native facts carry revision 0.
   string previous_record_sha256;
   bool has_volume;
   Tov2CaptureFixed volume;
   Tov2CaptureReading price,profit,commission,swap,fee,sl,tp;
   // No speculative INOUT reconstruction: reversal_split is always null.
};
struct Tov2CaptureProtection
{
   string position_id,ticket,symbol,source;
   long observed_at_broker_msc;
   Tov2CaptureReading sl,tp;
};
struct Tov2CaptureHistoryRow
{
   Tov2CaptureResult result;
   // Safe descriptor is available even for unsupported broker deal types.
   string ticket;
   long broker_time_msc,raw_type,raw_reason;
   Tov2CaptureDeal deal;
};
struct Tov2CaptureHistoryPage
{
   Tov2CaptureResult result;
   long total;
   int size;
   Tov2CaptureHistoryRow rows[TOV2_CAPTURE_HISTORY_MAX];
};

void Tov2CaptureMissing(Tov2CaptureReading &r,const string reason="READ_FAILED")
{
   r.reason=reason; r.fixed.value=""; r.fixed.scale=0;
}
bool Tov2CaptureFromDouble(const double value,const int scale,Tov2CaptureReading &r)
{
   Tov2CaptureMissing(r);
   string encoded="";
   if(!Tov2FixedFromDouble(value,scale,encoded)) return false;
   string fixed=DoubleToString(value,scale);
   if(StringLen(fixed)>0 && StringGetCharacter(fixed,0)==45 && Tov2ZeroDigits(fixed)) fixed=StringSubstr(fixed,1);
   if(!Tov2FixedText(fixed,scale)) return false;
   r.reason=""; r.fixed.value=fixed; r.fixed.scale=scale;
   return true;
}
bool Tov2CaptureVolumeScale(const double step,int &scale)
{
   scale=-1;
   if(!MathIsValidNumber(step) || step<=0 || step>=1e18) return false;
   for(int i=0;i<=16;i++)
   {
      double normalized=StringToDouble(DoubleToString(step,i));
      if(normalized>0 && MathAbs(normalized-step)<=MathAbs(step)*1e-12)
      { scale=i; return true; }
   }
   return false;
}
void Tov2CaptureClearAccount(Tov2CaptureAccount &a)
{
   a.status="CAPTURE_FAILED";a.observed_at_utc_seconds=0;a.observed_at_broker_msc=0;
   Tov2CaptureMissing(a.balance);Tov2CaptureMissing(a.equity);Tov2CaptureMissing(a.margin_used);
   Tov2CaptureMissing(a.margin_free);Tov2CaptureMissing(a.margin_level);
}
void Tov2CaptureClearExposure(Tov2CaptureExposure &e)
{
   ZeroMemory(e); e.status="CAPTURE_FAILED"; e.position_count=-1;e.order_count=-1;
}
void Tov2CaptureFailExposure(Tov2CaptureExposure &e,const Tov2CaptureResult result)
{
   long positions=e.position_count,orders=e.order_count,utc=e.observed_at_utc_seconds,broker=e.observed_at_broker_msc;
   Tov2CaptureClearExposure(e);e.position_count=positions;e.order_count=orders;
   e.observed_at_utc_seconds=utc;e.observed_at_broker_msc=broker;
   e.status=result==TOV2_CAPTURE_LIMIT_EXCEEDED?"LIMIT_EXCEEDED":"CAPTURE_FAILED";
}
void Tov2CaptureClearHistory(Tov2CaptureHistoryPage &p)
{
   ZeroMemory(p);p.result=TOV2_CAPTURE_READ_FAILED;p.total=-1;
}
bool Tov2CaptureText(const string s,const int max)
{
   int n=StringLen(s);
   if(n<1 || n>max) return false;
   for(int i=0;i<n;i++)
   {
      ushort c=StringGetCharacter(s,i);
      if(c<32 || c==127) return false;
      if(c>=0xD800 && c<=0xDBFF)
      {
         if(++i>=n) return false;
         ushort low=StringGetCharacter(s,i);
         if(low<0xDC00 || low>0xDFFF) return false;
      }
      else if(c>=0xDC00 && c<=0xDFFF) return false;
   }
   return true;
}
bool Tov2CaptureChoice(const string value,const string choices)
{
   return StringFind("|"+choices+"|","|"+value+"|")>=0 && value!="" && StringFind(value,"|")<0;
}
bool Tov2CaptureFixedValid(const Tov2CaptureFixed &f,const bool positive=false)
{
   return Tov2FixedText(f.value,f.scale) && (!positive || (StringGetCharacter(f.value,0)!=45 && !Tov2ZeroDigits(f.value)));
}
bool Tov2CaptureReadingValid(const Tov2CaptureReading &r,const int scale=-1)
{
   if(r.reason!="") return Tov2CaptureChoice(r.reason,"READ_FAILED|NOT_APPLICABLE|NOT_SET|UNAVAILABLE") && r.fixed.value=="" && r.fixed.scale==0;
   return Tov2CaptureFixedValid(r.fixed) && (scale<0 || r.fixed.scale==scale);
}
bool Tov2CaptureDisplayValid(const Tov2CaptureDisplay &d)
{
   if(!Tov2CaptureText(d.company,96) || !Tov2CaptureText(d.server,96) ||
      StringLen(d.login_last4)!=4 || !Tov2Digits(d.login_last4,0,4) ||
      d.currency_scale<0 || d.currency_scale>16 || StringLen(d.currency)<1 || StringLen(d.currency)>12) return false;
   for(int i=0;i<StringLen(d.currency);i++)
   {
      ushort c=StringGetCharacter(d.currency,i);
      if(!((c>=65 && c<=90) || (c>=48 && c<=57))) return false;
   }
   return Tov2CaptureChoice(d.account_mode,"DEMO|REAL|CONTEST|UNKNOWN") &&
          Tov2CaptureChoice(d.margin_mode,"RETAIL_NETTING|EXCHANGE|RETAIL_HEDGING|UNKNOWN");
}
bool Tov2CaptureAccountValid(const Tov2CaptureAccount &a,const int scale)
{
   if(scale<0 || scale>16 || !Tov2Counter(a.observed_at_utc_seconds,1) ||
      !Tov2Counter(a.observed_at_broker_msc,1) ||
      !Tov2CaptureReadingValid(a.balance,scale) || !Tov2CaptureReadingValid(a.equity,scale) ||
      !Tov2CaptureReadingValid(a.margin_used,scale) || !Tov2CaptureReadingValid(a.margin_free,scale) ||
      !Tov2CaptureReadingValid(a.margin_level)) return false;
   if(a.status=="CAPTURE_FAILED") return a.balance.reason!="" && a.equity.reason!="" &&
      a.margin_used.reason!="" && a.margin_free.reason!="" && a.margin_level.reason!="";
   if(a.status!="COMPLETE" || a.balance.reason!="" || a.equity.reason!="" ||
      a.margin_used.reason!="" || a.margin_free.reason!="") return false;
   return !Tov2ZeroDigits(a.margin_used.fixed.value) || a.margin_level.reason=="NOT_APPLICABLE";
}
bool Tov2CapturePositionValid(const Tov2CapturePosition &p,const int scale)
{
   return Tov2Ticket(p.ticket) && Tov2Ticket(p.position_id) && Tov2CaptureText(p.symbol,64) &&
      Tov2CaptureChoice(p.side,"BUY|SELL") && Tov2CaptureFixedValid(p.volume,true) &&
      Tov2CaptureReadingValid(p.entry_price) && Tov2CaptureReadingValid(p.current_price) &&
      Tov2CaptureReadingValid(p.sl) && Tov2CaptureReadingValid(p.tp) &&
      Tov2CaptureReadingValid(p.floating_profit,scale) && Tov2CaptureReadingValid(p.swap,scale);
}
bool Tov2CaptureLessOrEqual(const Tov2CaptureFixed &a,const Tov2CaptureFixed &b)
{
   if(!Tov2CaptureFixedValid(a,true) || !Tov2CaptureFixedValid(b,true) || a.scale!=b.scale) return false;
   int x=StringLen(a.value),y=StringLen(b.value);
   return x<y || (x==y && StringCompare(a.value,b.value)<=0);
}
bool Tov2CaptureOrderValid(const Tov2CaptureOrder &o)
{
   return Tov2Ticket(o.ticket) && Tov2CaptureText(o.symbol,64) &&
      Tov2CaptureChoice(o.type,"BUY_LIMIT|SELL_LIMIT|BUY_STOP|SELL_STOP|BUY_STOP_LIMIT|SELL_STOP_LIMIT") &&
      Tov2CaptureChoice(o.state,"STARTED|PLACED|PARTIAL|REQUEST_ADD|REQUEST_MODIFY|REQUEST_CANCEL|UNKNOWN") &&
      Tov2CaptureLessOrEqual(o.volume_current,o.volume_initial) &&
      Tov2CaptureReadingValid(o.price) && Tov2CaptureReadingValid(o.stop_limit_price) &&
      Tov2CaptureReadingValid(o.sl) && Tov2CaptureReadingValid(o.tp);
}
bool Tov2CaptureExposureValid(const Tov2CaptureExposure &e,const int scale)
{
   if(scale<0 || scale>16 || !Tov2Counter(e.observed_at_utc_seconds,1) || !Tov2Counter(e.observed_at_broker_msc,1) ||
      e.positions_size<0 || e.positions_size>TOV2_CAPTURE_POSITIONS_MAX || e.orders_size<0 || e.orders_size>TOV2_CAPTURE_ORDERS_MAX ||
      (e.position_count!=-1 && !Tov2Counter(e.position_count)) || (e.order_count!=-1 && !Tov2Counter(e.order_count))) return false;
   if(e.status!="COMPLETE") return Tov2CaptureChoice(e.status,"CAPTURE_FAILED|LIMIT_EXCEEDED") && e.positions_size==0 && e.orders_size==0;
   if(e.position_count!=e.positions_size || e.order_count!=e.orders_size) return false;
   for(int i=0;i<e.positions_size;i++)
   {
      if(!Tov2CapturePositionValid(e.positions[i],scale)) return false;
      for(int j=0;j<i;j++) if(e.positions[j].ticket==e.positions[i].ticket || e.positions[j].position_id==e.positions[i].position_id) return false;
   }
   for(int i=0;i<e.orders_size;i++)
   {
      if(!Tov2CaptureOrderValid(e.orders[i])) return false;
      for(int j=0;j<i;j++) if(e.orders[j].ticket==e.orders[i].ticket) return false;
   }
   return true;
}
bool Tov2CaptureDealTrading(const string type)
{
   return Tov2CaptureChoice(type,"BUY|SELL|BUY_CANCELED|SELL_CANCELED");
}
bool Tov2CaptureDealValid(const Tov2CaptureDeal &d,const int scale,const long revision,const string previous)
{
   if(scale<0 || scale>16 || !Tov2Ticket(d.deal_id) || !Tov2Counter(d.broker_time_msc,1) || !Tov2Counter(revision,1) ||
      ((revision==1)!=(previous=="")) || (previous!="" && !Tov2Digest(previous)) ||
      !Tov2CaptureChoice(d.type,"BUY|SELL|BUY_CANCELED|SELL_CANCELED|BALANCE|CREDIT|CHARGE|CORRECTION|BONUS|COMMISSION|COMMISSION_DAILY|COMMISSION_MONTHLY|COMMISSION_AGENT_DAILY|COMMISSION_AGENT_MONTHLY|INTEREST|DIVIDEND|DIVIDEND_FRANKED|TAX") ||
      !Tov2CaptureChoice(d.entry,"IN|OUT|INOUT|OUT_BY|NONE") ||
      !Tov2CaptureChoice(d.reason,"CLIENT|MOBILE|WEB|EXPERT|SL|TP|SO|ROLLOVER|VMARGIN|SPLIT|CORPORATE_ACTION|UNKNOWN") ||
      !Tov2CaptureChoice(d.protection_source,"BROKER_DEAL|UNAVAILABLE")) return false;
   if(d.order_id!="" && !Tov2Ticket(d.order_id)) return false;
   if(d.position_id!="" && !Tov2Ticket(d.position_id)) return false;
   if(d.symbol!="" && !Tov2CaptureText(d.symbol,64)) return false;
   if(d.has_volume && !Tov2CaptureFixedValid(d.volume,true)) return false;
   if(Tov2CaptureDealTrading(d.type))
   { if(d.order_id=="" || d.position_id=="" || d.symbol=="" || !d.has_volume || d.entry=="NONE") return false; }
   else if(d.entry!="NONE") return false;
   if(d.protection_source=="UNAVAILABLE" && (d.sl.reason=="" || d.tp.reason=="")) return false;
   return Tov2CaptureReadingValid(d.price) && Tov2CaptureReadingValid(d.profit,scale) &&
      Tov2CaptureReadingValid(d.commission,scale) && Tov2CaptureReadingValid(d.swap,scale) &&
      Tov2CaptureReadingValid(d.fee,scale) && Tov2CaptureReadingValid(d.sl) && Tov2CaptureReadingValid(d.tp);
}
bool Tov2CaptureProtectionValid(const Tov2CaptureProtection &p)
{
   return Tov2Ticket(p.position_id) && Tov2Ticket(p.ticket) && Tov2CaptureText(p.symbol,64) &&
      Tov2Counter(p.observed_at_broker_msc,1) && Tov2CaptureReadingValid(p.sl) && Tov2CaptureReadingValid(p.tp) &&
      Tov2CaptureChoice(p.source,"POLL|TRANSACTION_OBSERVATION");
}
class ITov2CaptureBroker
{
public:
   virtual Tov2CaptureResult Identity(string &fingerprint,Tov2CaptureDisplay &display)=0;
   virtual Tov2CaptureResult Clocks(long &utc_seconds,long &broker_msc)=0;
   // Enrollment is denied unless an adapter can prove this exact broker value was freshly received.
   virtual bool EnrollmentClockReady(const long exact_broker_msc) {return false;}
   virtual Tov2CaptureResult Account(Tov2CaptureAccount &account)=0;
   virtual Tov2CaptureResult Exposure(Tov2CaptureExposure &exposure)=0;
   virtual Tov2CaptureResult BoundaryTickets(const long second_msc,string &tickets[],long &total)=0;
   virtual Tov2CaptureResult History(const long from_msc,const long through_msc,Tov2CaptureHistoryPage &page)=0;
};
#endif
