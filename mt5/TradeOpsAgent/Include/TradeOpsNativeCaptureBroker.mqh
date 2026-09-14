#ifndef TRADEOPS_NATIVE_CAPTURE_BROKER_MQH
#define TRADEOPS_NATIVE_CAPTURE_BROKER_MQH
#include "TradeOpsCaptureCodec.mqh"

// Mapping functions are pure and are covered by the offline fake-broker self-test.
string Tov2NativeDealType(const long raw)
{
   if(raw==DEAL_TYPE_BUY) return "BUY";
   if(raw==DEAL_TYPE_SELL) return "SELL";
   if(raw==DEAL_TYPE_BUY_CANCELED) return "BUY_CANCELED";
   if(raw==DEAL_TYPE_SELL_CANCELED) return "SELL_CANCELED";
   if(raw==DEAL_TYPE_BALANCE) return "BALANCE";
   if(raw==DEAL_TYPE_CREDIT) return "CREDIT";
   if(raw==DEAL_TYPE_CHARGE) return "CHARGE";
   if(raw==DEAL_TYPE_CORRECTION) return "CORRECTION";
   if(raw==DEAL_TYPE_BONUS) return "BONUS";
   if(raw==DEAL_TYPE_COMMISSION) return "COMMISSION";
   if(raw==DEAL_TYPE_COMMISSION_DAILY) return "COMMISSION_DAILY";
   if(raw==DEAL_TYPE_COMMISSION_MONTHLY) return "COMMISSION_MONTHLY";
   if(raw==DEAL_TYPE_COMMISSION_AGENT_DAILY) return "COMMISSION_AGENT_DAILY";
   if(raw==DEAL_TYPE_COMMISSION_AGENT_MONTHLY) return "COMMISSION_AGENT_MONTHLY";
   if(raw==DEAL_TYPE_INTEREST) return "INTEREST";
   if(raw==DEAL_DIVIDEND) return "DIVIDEND";
   if(raw==DEAL_DIVIDEND_FRANKED) return "DIVIDEND_FRANKED";
   if(raw==DEAL_TAX) return "TAX";
   return "";
}
string Tov2NativeDealReason(const long raw)
{
   if(raw==DEAL_REASON_CLIENT) return "CLIENT";
   if(raw==DEAL_REASON_MOBILE) return "MOBILE";
   if(raw==DEAL_REASON_WEB) return "WEB";
   if(raw==DEAL_REASON_EXPERT) return "EXPERT";
   if(raw==DEAL_REASON_SL) return "SL";
   if(raw==DEAL_REASON_TP) return "TP";
   if(raw==DEAL_REASON_SO) return "SO";
   if(raw==DEAL_REASON_ROLLOVER) return "ROLLOVER";
   if(raw==DEAL_REASON_VMARGIN) return "VMARGIN";
   if(raw==DEAL_REASON_SPLIT) return "SPLIT";
   if(raw==DEAL_REASON_CORPORATE_ACTION) return "CORPORATE_ACTION";
   return "UNKNOWN";
}
string Tov2NativeDealEntry(const long raw)
{
   if(raw==DEAL_ENTRY_IN) return "IN";
   if(raw==DEAL_ENTRY_OUT) return "OUT";
   if(raw==DEAL_ENTRY_INOUT) return "INOUT";
   if(raw==DEAL_ENTRY_OUT_BY) return "OUT_BY";
   return "";
}
string Tov2NativeOrderType(const long raw)
{
   if(raw==ORDER_TYPE_BUY_LIMIT) return "BUY_LIMIT";
   if(raw==ORDER_TYPE_SELL_LIMIT) return "SELL_LIMIT";
   if(raw==ORDER_TYPE_BUY_STOP) return "BUY_STOP";
   if(raw==ORDER_TYPE_SELL_STOP) return "SELL_STOP";
   if(raw==ORDER_TYPE_BUY_STOP_LIMIT) return "BUY_STOP_LIMIT";
   if(raw==ORDER_TYPE_SELL_STOP_LIMIT) return "SELL_STOP_LIMIT";
   return "";
}
string Tov2NativeOrderState(const long raw)
{
   if(raw==ORDER_STATE_STARTED) return "STARTED";
   if(raw==ORDER_STATE_PLACED) return "PLACED";
   if(raw==ORDER_STATE_PARTIAL) return "PARTIAL";
   if(raw==ORDER_STATE_REQUEST_ADD) return "REQUEST_ADD";
   if(raw==ORDER_STATE_REQUEST_MODIFY) return "REQUEST_MODIFY";
   if(raw==ORDER_STATE_REQUEST_CANCEL) return "REQUEST_CANCEL";
   return "UNKNOWN";
}
string Tov2NativeAccountMode(const long raw)
{
   if(raw==ACCOUNT_TRADE_MODE_DEMO) return "DEMO";
   if(raw==ACCOUNT_TRADE_MODE_REAL) return "REAL";
   if(raw==ACCOUNT_TRADE_MODE_CONTEST) return "CONTEST";
   return "UNKNOWN";
}
string Tov2NativeMarginMode(const long raw)
{
   if(raw==ACCOUNT_MARGIN_MODE_RETAIL_NETTING) return "RETAIL_NETTING";
   if(raw==ACCOUNT_MARGIN_MODE_EXCHANGE) return "EXCHANGE";
   if(raw==ACCOUNT_MARGIN_MODE_RETAIL_HEDGING) return "RETAIL_HEDGING";
   return "UNKNOWN";
}

// Pure freshness gate: a cached quote advancing after a long polling gap is not proof of receipt.
// The next bounded observation pair must demonstrate a new broker value within one second.
class CTov2CaptureQuoteFreshness
{
private:
   bool m_seen,m_fresh;
   long m_previous_broker,m_fresh_broker;
   ulong m_previous_tick,m_fresh_tick;
public:
   CTov2CaptureQuoteFreshness() {Reset();}
   void Reset()
   {m_seen=false;m_fresh=false;m_previous_broker=0;m_fresh_broker=0;m_previous_tick=0;m_fresh_tick=0;}
   void Observe(const long broker,const ulong tick,const bool connected)
   {
      if(!connected || !Tov2Counter(broker,1)) {Reset();return;}
      if(m_seen && (tick<m_previous_tick || broker<m_previous_broker || tick-m_previous_tick>1000))
         m_fresh=false;
      else if(m_seen && broker>m_previous_broker)
      {m_fresh=true;m_fresh_broker=broker;m_fresh_tick=tick;}
      m_seen=true;m_previous_broker=broker;m_previous_tick=tick;
   }
   bool Ready(const long exact_broker,const ulong tick)
   {
      return m_fresh && exact_broker==m_fresh_broker && exact_broker==m_previous_broker &&
         tick>=m_fresh_tick && tick-m_fresh_tick<=1000;
   }
};

class CTov2NativeCaptureBroker : public ITov2CaptureBroker
{
private:
   CTov2CaptureQuoteFreshness m_quote_freshness;
   string m_clock_identity;
   bool AccountInteger(const ENUM_ACCOUNT_INFO_INTEGER property,long &out)
   {out=0;ResetLastError();long value=AccountInfoInteger(property);if(GetLastError()!=0) return false;out=value;return true;}
   bool AccountString(const ENUM_ACCOUNT_INFO_STRING property,string &out)
   {out="";ResetLastError();string value=AccountInfoString(property);if(GetLastError()!=0) return false;out=value;return true;}
   bool AccountReading(const ENUM_ACCOUNT_INFO_DOUBLE property,const int scale,Tov2CaptureReading &out)
   {
      Tov2CaptureMissing(out);ResetLastError();double value=AccountInfoDouble(property);
      return GetLastError()==0 && Tov2CaptureFromDouble(value,scale,out);
   }
   bool CurrencyScale(int &out)
   {out=-1;long value=0;if(!AccountInteger(ACCOUNT_CURRENCY_DIGITS,value) || value<0 || value>16) return false;out=(int)value;return true;}
   bool SymbolScales(const string symbol,int &price,int &volume)
   {
      price=-1;volume=-1;long digits=0;double step=0;
      ResetLastError();
      bool p=SymbolInfoInteger(symbol,SYMBOL_DIGITS,digits);
      if(p && GetLastError()==0 && digits>=0 && digits<=16) price=(int)digits;
      ResetLastError();
      bool v=SymbolInfoDouble(symbol,SYMBOL_VOLUME_STEP,step);
      if(!v || GetLastError()!=0 || !Tov2CaptureVolumeScale(step,volume)) return false;
      return true;
   }
   bool PositionInteger(const ENUM_POSITION_PROPERTY_INTEGER property,long &out)
   {out=0;ResetLastError();return PositionGetInteger(property,out) && GetLastError()==0;}
   bool PositionString(const ENUM_POSITION_PROPERTY_STRING property,string &out)
   {out="";ResetLastError();return PositionGetString(property,out) && GetLastError()==0;}
   bool PositionDouble(const ENUM_POSITION_PROPERTY_DOUBLE property,double &out)
   {out=0;ResetLastError();return PositionGetDouble(property,out) && GetLastError()==0 && MathIsValidNumber(out);}
   void PositionReading(const ENUM_POSITION_PROPERTY_DOUBLE property,const int scale,const bool zero_not_set,Tov2CaptureReading &out)
   {
      Tov2CaptureMissing(out);double value=0;
      if(scale<0 || !PositionDouble(property,value)) return;
      if(zero_not_set && value==0) {Tov2CaptureMissing(out,"NOT_SET");return;}
      Tov2CaptureFromDouble(value,scale,out);
   }
   bool OrderInteger(const ENUM_ORDER_PROPERTY_INTEGER property,long &out)
   {out=0;ResetLastError();return OrderGetInteger(property,out) && GetLastError()==0;}
   bool OrderString(const ENUM_ORDER_PROPERTY_STRING property,string &out)
   {out="";ResetLastError();return OrderGetString(property,out) && GetLastError()==0;}
   bool OrderDouble(const ENUM_ORDER_PROPERTY_DOUBLE property,double &out)
   {out=0;ResetLastError();return OrderGetDouble(property,out) && GetLastError()==0 && MathIsValidNumber(out);}
   void OrderReading(const ENUM_ORDER_PROPERTY_DOUBLE property,const int scale,const bool zero_not_set,Tov2CaptureReading &out)
   {
      Tov2CaptureMissing(out);double value=0;
      if(scale<0 || !OrderDouble(property,value)) return;
      if(zero_not_set && value==0) {Tov2CaptureMissing(out,"NOT_SET");return;}
      Tov2CaptureFromDouble(value,scale,out);
   }
   bool DealInteger(const ulong ticket,const ENUM_DEAL_PROPERTY_INTEGER property,long &out)
   {out=0;ResetLastError();return HistoryDealGetInteger(ticket,property,out) && GetLastError()==0;}
   bool DealDouble(const ulong ticket,const ENUM_DEAL_PROPERTY_DOUBLE property,double &out)
   {out=0;ResetLastError();return HistoryDealGetDouble(ticket,property,out) && GetLastError()==0 && MathIsValidNumber(out);}
   void DealReading(const ulong ticket,const ENUM_DEAL_PROPERTY_DOUBLE property,const int scale,const bool zero_not_set,Tov2CaptureReading &out)
   {
      Tov2CaptureMissing(out);double value=0;
      if(scale<0 || !DealDouble(ticket,property,value)) return;
      if(zero_not_set && value==0) {Tov2CaptureMissing(out,"NOT_SET");return;}
      Tov2CaptureFromDouble(value,scale,out);
   }
   bool ReadPosition(const ulong ticket,const int scale,Tov2CapturePosition &p)
   {
      ZeroMemory(p);long selected=0,position=0,side=0;int price=-1,volume=-1;double amount=0;
      if(!Tov2TicketFromUlong(ticket,p.ticket) || !PositionInteger(POSITION_TICKET,selected) || (ulong)selected!=ticket ||
         !PositionInteger(POSITION_IDENTIFIER,position) || !Tov2TicketFromUlong((ulong)position,p.position_id) ||
         !PositionString(POSITION_SYMBOL,p.symbol) || !Tov2CaptureText(p.symbol,64) ||
         !PositionInteger(POSITION_TYPE,side) || (side!=POSITION_TYPE_BUY && side!=POSITION_TYPE_SELL) ||
         !SymbolScales(p.symbol,price,volume) || !PositionDouble(POSITION_VOLUME,amount)) return false;
      p.side=side==POSITION_TYPE_BUY?"BUY":"SELL";
      Tov2CaptureReading reading;
      if(!Tov2CaptureFromDouble(amount,volume,reading)) return false;p.volume=reading.fixed;
      PositionReading(POSITION_PRICE_OPEN,price,false,p.entry_price);PositionReading(POSITION_PRICE_CURRENT,price,false,p.current_price);
      PositionReading(POSITION_SL,price,true,p.sl);PositionReading(POSITION_TP,price,true,p.tp);
      PositionReading(POSITION_PROFIT,scale,false,p.floating_profit);PositionReading(POSITION_SWAP,scale,false,p.swap);
      return Tov2CapturePositionValid(p,scale);
   }
   bool ReadOrder(const ulong ticket,Tov2CaptureOrder &o)
   {
      ZeroMemory(o);long selected=0,type=0,state=0;int price=-1,volume=-1;double initial=0,current=0;
      if(!Tov2TicketFromUlong(ticket,o.ticket) || !OrderInteger(ORDER_TICKET,selected) || (ulong)selected!=ticket ||
         !OrderString(ORDER_SYMBOL,o.symbol) || !Tov2CaptureText(o.symbol,64) ||
         !OrderInteger(ORDER_TYPE,type) || !OrderInteger(ORDER_STATE,state) ||
         !SymbolScales(o.symbol,price,volume) || !OrderDouble(ORDER_VOLUME_INITIAL,initial) ||
         !OrderDouble(ORDER_VOLUME_CURRENT,current)) return false;
      o.type=Tov2NativeOrderType(type);o.state=Tov2NativeOrderState(state);
      Tov2CaptureReading reading;
      if(!Tov2CaptureFromDouble(initial,volume,reading)) return false;o.volume_initial=reading.fixed;
      if(!Tov2CaptureFromDouble(current,volume,reading)) return false;o.volume_current=reading.fixed;
      OrderReading(ORDER_PRICE_OPEN,price,false,o.price);
      if(o.type=="BUY_STOP_LIMIT" || o.type=="SELL_STOP_LIMIT") OrderReading(ORDER_PRICE_STOPLIMIT,price,false,o.stop_limit_price);
      else Tov2CaptureMissing(o.stop_limit_price,"NOT_APPLICABLE");
      OrderReading(ORDER_SL,price,true,o.sl);OrderReading(ORDER_TP,price,true,o.tp);
      return Tov2CaptureOrderValid(o);
   }
   Tov2CaptureResult ReadDeal(const ulong ticket,const int scale,Tov2CaptureHistoryRow &row)
   {
      ZeroMemory(row);row.result=TOV2_CAPTURE_READ_FAILED;
      if(!Tov2TicketFromUlong(ticket,row.ticket) ||
         !DealInteger(ticket,DEAL_TIME_MSC,row.broker_time_msc) || !Tov2Counter(row.broker_time_msc,1) ||
         !DealInteger(ticket,DEAL_TYPE,row.raw_type) || !DealInteger(ticket,DEAL_REASON,row.raw_reason)) return row.result;
      string type=Tov2NativeDealType(row.raw_type);
      if(type=="") {row.result=TOV2_CAPTURE_UNSUPPORTED;return row.result;}
      Tov2CaptureDeal d;ZeroMemory(d);
      d.deal_id=row.ticket;d.broker_time_msc=row.broker_time_msc;d.type=type;
      d.reason=Tov2NativeDealReason(row.raw_reason);d.protection_source="UNAVAILABLE";d.entry="NONE";
      Tov2CaptureMissing(d.price,"NOT_APPLICABLE");Tov2CaptureMissing(d.sl,"UNAVAILABLE");Tov2CaptureMissing(d.tp,"UNAVAILABLE");
      DealReading(ticket,DEAL_PROFIT,scale,false,d.profit);DealReading(ticket,DEAL_COMMISSION,scale,false,d.commission);
      DealReading(ticket,DEAL_SWAP,scale,false,d.swap);DealReading(ticket,DEAL_FEE,scale,false,d.fee);
      if(Tov2CaptureDealTrading(type))
      {
         long order=0,position=0,entry=0;int price=-1,volume=-1;double amount=0;
         if(!DealInteger(ticket,DEAL_ORDER,order) || !Tov2TicketFromUlong((ulong)order,d.order_id) ||
            !DealInteger(ticket,DEAL_POSITION_ID,position) || !Tov2TicketFromUlong((ulong)position,d.position_id) ||
            !DealInteger(ticket,DEAL_ENTRY,entry)) return row.result;
         ResetLastError();
         if(!HistoryDealGetString(ticket,DEAL_SYMBOL,d.symbol) || GetLastError()!=0 ||
            !Tov2CaptureText(d.symbol,64) || !SymbolScales(d.symbol,price,volume) ||
            !DealDouble(ticket,DEAL_VOLUME,amount)) return row.result;
         Tov2CaptureReading reading;
         if(!Tov2CaptureFromDouble(amount,volume,reading)) return row.result;
         d.has_volume=true;d.volume=reading.fixed;d.entry=Tov2NativeDealEntry(entry);
         DealReading(ticket,DEAL_PRICE,price,false,d.price);
         DealReading(ticket,DEAL_SL,price,true,d.sl);DealReading(ticket,DEAL_TP,price,true,d.tp);
         d.protection_source="BROKER_DEAL";
      }
      if(!Tov2CaptureDealValid(d,scale,1,"")) return row.result;
      row.deal=d;row.result=TOV2_CAPTURE_OK;return row.result;
   }
   bool SelectHistory(const long from_msc,const long through_msc,int &count)
   {
      count=-1;
      if(!Tov2Counter(from_msc,1) || !Tov2Counter(through_msc,1) || through_msc<from_msc) return false;
      // HistorySelect takes broker SERVER seconds, not UTC; filtering retains the exact millisecond bounds.
      ResetLastError();
      if(!HistorySelect((datetime)(from_msc/1000),(datetime)(through_msc/1000)) || GetLastError()!=0) return false;
      ResetLastError();int actual=HistoryDealsTotal();
      if(GetLastError()!=0 || actual<0) return false;
      count=actual;return true;
   }
public:
   virtual Tov2CaptureResult Identity(string &fingerprint,Tov2CaptureDisplay &display)
   {
      fingerprint="";ZeroMemory(display);Tov2CaptureDisplay d;ZeroMemory(d);
      long login=0,mode=0,margin=0;
      if(!AccountInteger(ACCOUNT_LOGIN,login) || login<=0 ||
         !AccountString(ACCOUNT_SERVER,d.server) || !AccountString(ACCOUNT_COMPANY,d.company) ||
         !AccountString(ACCOUNT_CURRENCY,d.currency) || !CurrencyScale(d.currency_scale) ||
         !AccountInteger(ACCOUNT_TRADE_MODE,mode) || !AccountInteger(ACCOUNT_MARGIN_MODE,margin))
      {m_quote_freshness.Reset();return TOV2_CAPTURE_READ_FAILED;}
      string local_login=StringFormat("%I64d",login);
      string padded="0000"+local_login;d.login_last4=StringSubstr(padded,StringLen(padded)-4);
      d.account_mode=Tov2NativeAccountMode(mode);d.margin_mode=Tov2NativeMarginMode(margin);
      if(!Tov2CaptureDisplayValid(d)) {m_quote_freshness.Reset();return TOV2_CAPTURE_READ_FAILED;}
      // Same local-only preimage as the predecessor's TradeOpsAccountFingerprint.
      string material=local_login+"|"+d.server+"|"+d.company;
      if(!Tov2CaptureRecordHash(material,fingerprint)) {m_quote_freshness.Reset();return TOV2_CAPTURE_READ_FAILED;}
      if(m_clock_identity!=fingerprint) m_quote_freshness.Reset();
      m_clock_identity=fingerprint;
      if(!TerminalInfoInteger(TERMINAL_CONNECTED)) m_quote_freshness.Reset();
      display=d;return TOV2_CAPTURE_OK;
   }
   virtual Tov2CaptureResult Clocks(long &utc_seconds,long &broker_msc)
   {
      utc_seconds=0;broker_msc=0;
      // TimeCurrent is the last server quote time; no invented broker millisecond precision or UTC conversion.
      ResetLastError();datetime utc=TimeGMT();
      if(GetLastError()!=0) {m_quote_freshness.Reset();return TOV2_CAPTURE_READ_FAILED;}
      ResetLastError();datetime broker=TimeCurrent();
      if(GetLastError()!=0) {m_quote_freshness.Reset();return TOV2_CAPTURE_READ_FAILED;}
      if(!Tov2Counter((long)utc,1) || !Tov2Counter((long)broker,1) || (long)broker>9007199254740)
      {m_quote_freshness.Reset();return TOV2_CAPTURE_READ_FAILED;}
      utc_seconds=(long)utc;broker_msc=(long)broker*1000;
      m_quote_freshness.Observe(broker_msc,GetTickCount64(),TerminalInfoInteger(TERMINAL_CONNECTED)!=0);
      return TOV2_CAPTURE_OK;
   }
   virtual bool EnrollmentClockReady(const long exact_broker_msc)
   {
      if(!TerminalInfoInteger(TERMINAL_CONNECTED)) {m_quote_freshness.Reset();return false;}
      return m_quote_freshness.Ready(exact_broker_msc,GetTickCount64());
   }
   virtual Tov2CaptureResult Account(Tov2CaptureAccount &account)
   {
      Tov2CaptureClearAccount(account);int scale=-1;
      if(!CurrencyScale(scale)) return TOV2_CAPTURE_READ_FAILED;
      Tov2CaptureAccount a;Tov2CaptureClearAccount(a);
      if(Clocks(a.observed_at_utc_seconds,a.observed_at_broker_msc)!=TOV2_CAPTURE_OK ||
         !AccountReading(ACCOUNT_BALANCE,scale,a.balance) || !AccountReading(ACCOUNT_EQUITY,scale,a.equity) ||
         !AccountReading(ACCOUNT_MARGIN,scale,a.margin_used) || !AccountReading(ACCOUNT_MARGIN_FREE,scale,a.margin_free)) return TOV2_CAPTURE_READ_FAILED;
      if(Tov2ZeroDigits(a.margin_used.fixed.value)) Tov2CaptureMissing(a.margin_level,"NOT_APPLICABLE");
      else AccountReading(ACCOUNT_MARGIN_LEVEL,2,a.margin_level);
      a.status="COMPLETE";
      if(!Tov2CaptureAccountValid(a,scale)) return TOV2_CAPTURE_READ_FAILED;
      account=a;return TOV2_CAPTURE_OK;
   }
   virtual Tov2CaptureResult Exposure(Tov2CaptureExposure &exposure)
   {
      Tov2CaptureClearExposure(exposure);int scale=-1;
      if(Clocks(exposure.observed_at_utc_seconds,exposure.observed_at_broker_msc)!=TOV2_CAPTURE_OK || !CurrencyScale(scale)) return TOV2_CAPTURE_READ_FAILED;
      ResetLastError();int positions=PositionsTotal();if(GetLastError()==0 && positions>=0) exposure.position_count=positions;
      ResetLastError();int orders=OrdersTotal();if(GetLastError()==0 && orders>=0) exposure.order_count=orders;
      if(exposure.position_count<0 || exposure.order_count<0) return TOV2_CAPTURE_READ_FAILED;
      if(positions>TOV2_CAPTURE_POSITIONS_MAX || orders>TOV2_CAPTURE_ORDERS_MAX)
      {Tov2CaptureFailExposure(exposure,TOV2_CAPTURE_LIMIT_EXCEEDED);return TOV2_CAPTURE_LIMIT_EXCEEDED;}
      for(int i=0;i<positions;i++)
      {
         ResetLastError();ulong ticket=PositionGetTicket(i);
         if(GetLastError()!=0 || ticket==0 || !ReadPosition(ticket,scale,exposure.positions[i]))
         {Tov2CaptureFailExposure(exposure,TOV2_CAPTURE_READ_FAILED);return TOV2_CAPTURE_READ_FAILED;}
         exposure.positions_size++;
      }
      for(int i=0;i<orders;i++)
      {
         ResetLastError();ulong ticket=OrderGetTicket(i);
         if(GetLastError()!=0 || ticket==0 || !ReadOrder(ticket,exposure.orders[i]))
         {Tov2CaptureFailExposure(exposure,TOV2_CAPTURE_READ_FAILED);return TOV2_CAPTURE_READ_FAILED;}
         exposure.orders_size++;
      }
      ResetLastError();int after_positions=PositionsTotal();bool same=GetLastError()==0 && after_positions==positions;
      ResetLastError();int after_orders=OrdersTotal();same=same && GetLastError()==0 && after_orders==orders;
      exposure.status="COMPLETE";
      if(!same || !Tov2CaptureExposureValid(exposure,scale))
      {Tov2CaptureFailExposure(exposure,TOV2_CAPTURE_READ_FAILED);return TOV2_CAPTURE_READ_FAILED;}
      return TOV2_CAPTURE_OK;
   }
   virtual Tov2CaptureResult BoundaryTickets(const long second_msc,string &tickets[],long &total)
   {
      ArrayResize(tickets,0);total=-1;int n=-1;
      if(second_msc%1000!=0 || !Tov2Counter(second_msc,1) || second_msc>9007199254739991 ||
         !SelectHistory(second_msc,second_msc+999,n)) return TOV2_CAPTURE_READ_FAILED;
      total=n;
      if(n>TOV2_CAPTURE_BOUNDARY_MAX) return TOV2_CAPTURE_LIMIT_EXCEEDED;
      string candidate[];
      if(ArrayResize(candidate,n)!=n) return TOV2_CAPTURE_READ_FAILED;
      for(int i=0;i<n;i++)
      {
         ResetLastError();ulong ticket=HistoryDealGetTicket(i);long time=0;
         if(GetLastError()!=0 || !Tov2TicketFromUlong(ticket,candidate[i]) ||
            !DealInteger(ticket,DEAL_TIME_MSC,time) || time<second_msc || time>second_msc+999)
         {total=-1;return TOV2_CAPTURE_READ_FAILED;}
         for(int j=0;j<i;j++) if(candidate[i]==candidate[j]) {total=-1;return TOV2_CAPTURE_READ_FAILED;}
      }
      // Server boundary contract uses lexicographic ticket ordering.
      for(int i=1;i<n;i++)
      {
         string current=candidate[i];int j=i-1;
         while(j>=0 && StringCompare(candidate[j],current)>0)
         {candidate[j+1]=candidate[j];j--;}
         candidate[j+1]=current;
      }
      if(ArrayResize(tickets,n)!=n || (n>0 && ArrayCopy(tickets,candidate,0,0,n)!=n))
      {ArrayResize(tickets,0);return TOV2_CAPTURE_READ_FAILED;}
      return TOV2_CAPTURE_OK;
   }
   virtual Tov2CaptureResult History(const long from_msc,const long through_msc,Tov2CaptureHistoryPage &page)
   {
      Tov2CaptureClearHistory(page);int n=-1,scale=-1;
      if(!CurrencyScale(scale) || !SelectHistory(from_msc,through_msc,n)) return TOV2_CAPTURE_READ_FAILED;
      if(n>TOV2_CAPTURE_HISTORY_MAX)
      {
         page.result=TOV2_CAPTURE_LIMIT_EXCEEDED;
         // The selected seconds can contain rows outside the exact millisecond interval.
         page.total=(from_msc%1000==0 && through_msc%1000==999)?n:-1;
         return page.result;
      }
      page.total=0;page.result=TOV2_CAPTURE_OK;
      for(int i=0;i<n;i++)
      {
         ResetLastError();ulong ticket=HistoryDealGetTicket(i);long time=0;
         if(GetLastError()!=0 || ticket==0 || !DealInteger(ticket,DEAL_TIME_MSC,time))
         {Tov2CaptureClearHistory(page);return TOV2_CAPTURE_READ_FAILED;}
         if(time<from_msc || time>through_msc) continue;
         Tov2CaptureHistoryRow row;Tov2CaptureResult result=ReadDeal(ticket,scale,row);
         if(result==TOV2_CAPTURE_READ_FAILED) {Tov2CaptureClearHistory(page);return result;}
         for(int j=0;j<page.size;j++) if(page.rows[j].ticket==row.ticket)
         {Tov2CaptureClearHistory(page);return TOV2_CAPTURE_READ_FAILED;}
         if(result==TOV2_CAPTURE_UNSUPPORTED) page.result=TOV2_CAPTURE_UNSUPPORTED;
         page.rows[page.size]=row;page.size++;page.total++;
      }
      // Caller sorts by broker_time_msc/ticket if needed; terminal list order is never assumed.
      return page.result;
   }
};
#endif
