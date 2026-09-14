#ifndef TRADEOPS_DEMO_REPORT_MQH
#define TRADEOPS_DEMO_REPORT_MQH
#include "../../Include/TradeOpsAccountSnapshot.mqh"

// A disposable diagnostic, not a collector/enrollment/transport integration.
// Stage all rows before publishing; no persistence or broker writes.
class CTov2DemoReport
{
private:
   bool Reject(const string reason) {Clear();error=reason;return false;}
   bool Guard(ITov2CaptureBroker *broker,const string expected,Tov2CaptureDisplay &display)
   {
      string actual="";
      if(broker.Identity(actual,display)!=TOV2_CAPTURE_OK || !Tov2Digest(actual) || !Tov2CaptureDisplayValid(display))
         return Reject("IDENTITY_READ_FAILED");
      if(display.account_mode!="DEMO") return Reject("DEMO_REQUIRED");
      if(actual!=expected) return Reject("IDENTITY_CHANGED");
      return true;
   }
public:
   bool ready;
   string error,balance,equity,currency,login_last4,account_json;
   long from_msc,through_msc,observed_utc,observed_broker;
   int position_count,order_count,deal_count;
   string positions[],orders[],deals[];
   CTov2DemoReport() {Clear();}
   void Clear()
   {
      ready=false;error="";balance="";equity="";currency="";login_last4="";account_json="";
      from_msc=0;through_msc=0;observed_utc=0;observed_broker=0;
      position_count=0;order_count=0;deal_count=0;
      ArrayResize(positions,0);ArrayResize(orders,0);ArrayResize(deals,0);
   }
   bool Collect(ITov2CaptureBroker *broker)
   {
      Clear();
      if(CheckPointer(broker)==POINTER_INVALID) return Reject("BROKER_UNAVAILABLE");
      string expected="";Tov2CaptureDisplay display,after;
      if(broker.Identity(expected,display)!=TOV2_CAPTURE_OK || !Tov2Digest(expected) || !Tov2CaptureDisplayValid(display))
         return Reject("IDENTITY_READ_FAILED");
      if(display.account_mode!="DEMO") return Reject("DEMO_REQUIRED");
      long utc=0,time=0;
      if(broker.Clocks(utc,time)!=TOV2_CAPTURE_OK || time<86400000 || time>9007199254739991 || time%1000!=0 ||
         !Tov2Counter(utc,1) || !broker.EnrollmentClockReady(time)) return Reject("FRESH_QUOTE_REQUIRED");
      CTov2AccountSnapshot snapshot(expected);
      Tov2CaptureAccount account;Tov2CaptureExposure exposure;
      Tov2CaptureResult result=snapshot.Capture(broker,account,exposure);
      if(result!=TOV2_CAPTURE_OK) return Reject(result==TOV2_CAPTURE_LIMIT_EXCEEDED?"EXPOSURE_LIMIT_128":"SNAPSHOT_READ_FAILED");
      if(!Guard(broker,expected,after)) return false;
      if(after.currency!=display.currency || after.currency_scale!=display.currency_scale) return Reject("CURRENCY_CHANGED");
      // Last 24h through the freshly observed server quote's whole second, inclusive.
      from_msc=time-86399000;through_msc=time+999;
      Tov2CaptureHistoryPage page;
      result=broker.History(from_msc,through_msc,page);
      if(result!=TOV2_CAPTURE_OK || page.result!=TOV2_CAPTURE_OK)
      {
         if(result==TOV2_CAPTURE_LIMIT_EXCEEDED || page.result==TOV2_CAPTURE_LIMIT_EXCEEDED) return Reject("HISTORY_LIMIT_256");
         if(result==TOV2_CAPTURE_UNSUPPORTED || page.result==TOV2_CAPTURE_UNSUPPORTED) return Reject("HISTORY_UNSUPPORTED");
         return Reject("HISTORY_READ_FAILED");
      }
      if(page.size<0 || page.size>TOV2_CAPTURE_HISTORY_MAX || page.total!=page.size) return Reject("HISTORY_INCOMPLETE");
      if(!Guard(broker,expected,after)) return false;
      if(after.currency!=display.currency || after.currency_scale!=display.currency_scale) return Reject("CURRENCY_CHANGED");
      if(!Tov2CaptureEncodeAccount(account,display.currency_scale,account_json)) return Reject("ACCOUNT_ENCODING");
      if(account.balance.reason=="READ_FAILED" || account.equity.reason=="READ_FAILED" || account.margin_used.reason=="READ_FAILED" ||
         account.margin_free.reason=="READ_FAILED" || account.margin_level.reason=="READ_FAILED") return Reject("FIELD_READ_FAILED");
      position_count=exposure.positions_size;order_count=exposure.orders_size;deal_count=page.size;
      if(ArrayResize(positions,position_count)!=position_count || ArrayResize(orders,order_count)!=order_count ||
         ArrayResize(deals,deal_count)!=deal_count) return Reject("ALLOCATION_FAILED");
      for(int i=0;i<position_count;i++)
      {
         if(exposure.positions[i].entry_price.reason=="READ_FAILED" || exposure.positions[i].current_price.reason=="READ_FAILED" ||
            exposure.positions[i].sl.reason=="READ_FAILED" || exposure.positions[i].tp.reason=="READ_FAILED" ||
            exposure.positions[i].floating_profit.reason=="READ_FAILED" || exposure.positions[i].swap.reason=="READ_FAILED")
            return Reject("FIELD_READ_FAILED");
         if(!Tov2CaptureEncodePosition(exposure.positions[i],display.currency_scale,positions[i]) || StringLen(positions[i])>3500)
            return Reject("POSITION_ENCODING");
      }
      for(int i=0;i<order_count;i++)
      {
         if(exposure.orders[i].price.reason=="READ_FAILED" || exposure.orders[i].stop_limit_price.reason=="READ_FAILED" ||
            exposure.orders[i].sl.reason=="READ_FAILED" || exposure.orders[i].tp.reason=="READ_FAILED") return Reject("FIELD_READ_FAILED");
         if(!Tov2CaptureEncodeOrder(exposure.orders[i],orders[i]) || StringLen(orders[i])>3500) return Reject("ORDER_ENCODING");
      }
      for(int i=0;i<deal_count;i++)
      {
         if(page.rows[i].deal.price.reason=="READ_FAILED" || page.rows[i].deal.profit.reason=="READ_FAILED" ||
            page.rows[i].deal.commission.reason=="READ_FAILED" || page.rows[i].deal.swap.reason=="READ_FAILED" ||
            page.rows[i].deal.fee.reason=="READ_FAILED" || page.rows[i].deal.sl.reason=="READ_FAILED" ||
            page.rows[i].deal.tp.reason=="READ_FAILED") return Reject("FIELD_READ_FAILED");
         if(page.rows[i].result!=TOV2_CAPTURE_OK || page.rows[i].broker_time_msc<from_msc ||
            page.rows[i].broker_time_msc>through_msc || page.rows[i].ticket!=page.rows[i].deal.deal_id ||
            page.rows[i].broker_time_msc!=page.rows[i].deal.broker_time_msc) return Reject("HISTORY_ROW_INVALID");
         for(int j=0;j<i;j++) if(page.rows[j].ticket==page.rows[i].ticket) return Reject("HISTORY_DUPLICATE");
         // Revision 1 is an encoder convention in this diagnostic, NOT a persisted journal revision.
         if(!Tov2CaptureEncodeDeal(page.rows[i].deal,display.currency_scale,1,"",deals[i]) || StringLen(deals[i])>3500)
            return Reject("DEAL_ENCODING");
      }
      balance=account.balance.fixed.value;equity=account.equity.fixed.value;
      currency=display.currency;login_last4=display.login_last4;
      observed_utc=account.observed_at_utc_seconds;observed_broker=account.observed_at_broker_msc;
      ready=true;return true;
   }
};
#endif
