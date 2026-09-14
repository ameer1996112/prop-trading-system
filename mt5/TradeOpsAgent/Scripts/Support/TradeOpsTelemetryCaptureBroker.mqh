#ifndef TRADEOPS_TELEMETRY_CAPTURE_BROKER_MQH
#define TRADEOPS_TELEMETRY_CAPTURE_BROKER_MQH
#include "../../Include/TradeOpsCaptureTypes.mqh"
class CTov2FakeCaptureBroker : public ITov2CaptureBroker
{
public:
   string fingerprint;
   Tov2CaptureDisplay display;
   Tov2CaptureAccount account;
   Tov2CaptureExposure exposure;
   Tov2CaptureResult account_result,exposure_result,history_result,clock_result;
   bool membership_race,switch_identity,switch_after_read;
   int exposure_calls,stable_mutation;
   long utc_now,broker_now,overflow_window_msc;
   int boundary_calls,history_calls,deal_count;
   bool boundary_race,reverse_history;
   bool enrollment_ready;
   string boundary_ids[];
   // Dynamic storage keeps the large fixture buffer out of each function's local-variable section.
   // Capacity is unchanged; this is a synthetic broker, never a live history buffer.
   Tov2CaptureHistoryRow deals[];
   CTov2FakeCaptureBroker()
   {
      fingerprint="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
      display.company="Synthetic Broker";display.server="Synthetic-Demo";display.login_last4="0007";
      display.currency="USD";display.currency_scale=2;display.account_mode="DEMO";display.margin_mode="RETAIL_HEDGING";
      stable_mutation=0;clock_result=TOV2_CAPTURE_OK;account_result=TOV2_CAPTURE_OK;exposure_result=TOV2_CAPTURE_OK;history_result=TOV2_CAPTURE_OK;
      if(ArrayResize(deals,2048)!=2048) history_result=TOV2_CAPTURE_READ_FAILED;
      membership_race=false;switch_identity=false;switch_after_read=false;exposure_calls=0;
      utc_now=1800000010;broker_now=1800000010000;overflow_window_msc=0;
      boundary_calls=0;history_calls=0;deal_count=0;boundary_race=false;reverse_history=false;
      enrollment_ready=true;
      Tov2CaptureClearAccount(account);account.status="COMPLETE";
      Tov2CaptureFromDouble(100.0,2,account.balance);Tov2CaptureFromDouble(100.0,2,account.equity);
      Tov2CaptureFromDouble(0.0,2,account.margin_used);Tov2CaptureFromDouble(100.0,2,account.margin_free);
      Tov2CaptureMissing(account.margin_level,"NOT_APPLICABLE");SetPositions(0);
   }
   void SetPositions(const int count)
   {
      Tov2CaptureClearExposure(exposure);exposure.status="COMPLETE";exposure.position_count=count;exposure.order_count=0;
      exposure.positions_size=count<=TOV2_CAPTURE_POSITIONS_MAX?count:0;
      for(int i=0;i<exposure.positions_size;i++)
      {
         exposure.positions[i].ticket=IntegerToString(i+1);
         exposure.positions[i].position_id=IntegerToString(i+1000);
         exposure.positions[i].symbol=(i%2==0?"EURUSD":"UNALLOWED-SYMBOL");exposure.positions[i].side="BUY";
         exposure.positions[i].volume.value="0.10";exposure.positions[i].volume.scale=2;
         Tov2CaptureFromDouble(1.0,5,exposure.positions[i].entry_price);
         Tov2CaptureFromDouble(1.1,5,exposure.positions[i].current_price);
         Tov2CaptureMissing(exposure.positions[i].sl,"NOT_SET");Tov2CaptureMissing(exposure.positions[i].tp,"NOT_SET");
         Tov2CaptureFromDouble(10.0,2,exposure.positions[i].floating_profit);
         Tov2CaptureFromDouble(-0.1,2,exposure.positions[i].swap);
      }
   }
   void SetOrders(const int count)
   {
      exposure.orders_size=count<=TOV2_CAPTURE_ORDERS_MAX?count:0;exposure.order_count=count;
      for(int i=0;i<exposure.orders_size;i++)
      {
         exposure.orders[i].ticket=IntegerToString(i+2000);exposure.orders[i].symbol="UNALLOWED-SYMBOL";
         exposure.orders[i].type="BUY_LIMIT";exposure.orders[i].state="PLACED";
         exposure.orders[i].volume_initial.value="1.00";exposure.orders[i].volume_initial.scale=2;
         exposure.orders[i].volume_current.value="0.50";exposure.orders[i].volume_current.scale=2;
         Tov2CaptureFromDouble(1.0,5,exposure.orders[i].price);
         Tov2CaptureMissing(exposure.orders[i].stop_limit_price,"NOT_APPLICABLE");
         Tov2CaptureMissing(exposure.orders[i].sl,"NOT_SET");Tov2CaptureMissing(exposure.orders[i].tp,"NOT_SET");
      }
   }
   virtual Tov2CaptureResult Identity(string &out,Tov2CaptureDisplay &d)
   {
      out=(switch_identity || (switch_after_read && exposure_calls>0))?"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa":fingerprint;
      d=display;return TOV2_CAPTURE_OK;
   }
   virtual Tov2CaptureResult Clocks(long &utc,long &broker)
   {utc=0;broker=0;if(clock_result!=TOV2_CAPTURE_OK) return clock_result;utc=utc_now;broker=broker_now;return TOV2_CAPTURE_OK;}
   virtual bool EnrollmentClockReady(const long exact_broker_msc)
   {return enrollment_ready && exact_broker_msc==broker_now;}
   virtual Tov2CaptureResult Account(Tov2CaptureAccount &out)
   {out=account;return account_result;}
   virtual Tov2CaptureResult Exposure(Tov2CaptureExposure &out)
   {
      exposure_calls++;out=exposure;
      if(out.position_count>TOV2_CAPTURE_POSITIONS_MAX || out.order_count>TOV2_CAPTURE_ORDERS_MAX) return TOV2_CAPTURE_LIMIT_EXCEEDED;
      if(membership_race && exposure_calls%2==0 && out.positions_size>0) out.positions[0].ticket="999";
      if(exposure_calls%2==0)
      {
         if(out.positions_size>0)
         {
            if(stable_mutation==1) out.positions[0].symbol="CHANGED";
            if(stable_mutation==2) out.positions[0].side="SELL";
            if(stable_mutation==3) out.positions[0].volume.value="0.20";
            if(stable_mutation==4) Tov2CaptureFromDouble(1.2,5,out.positions[0].entry_price);
            if(stable_mutation==5) Tov2CaptureFromDouble(1.2,5,out.positions[0].sl);
            if(stable_mutation==6) Tov2CaptureFromDouble(1.2,5,out.positions[0].tp);
            if(stable_mutation==16) {Tov2CaptureFromDouble(1.2,5,out.positions[0].current_price);Tov2CaptureFromDouble(20.0,2,out.positions[0].floating_profit);}
         }
         if(out.orders_size>0)
         {
            if(stable_mutation==7) out.orders[0].symbol="CHANGED";
            if(stable_mutation==8) out.orders[0].type="SELL_LIMIT";
            if(stable_mutation==9) out.orders[0].state="REQUEST_MODIFY";
            if(stable_mutation==10) out.orders[0].volume_initial.value="2.00";
            if(stable_mutation==11) out.orders[0].volume_current.value="0.20";
            if(stable_mutation==12) Tov2CaptureFromDouble(1.2,5,out.orders[0].price);
            if(stable_mutation==13) Tov2CaptureFromDouble(1.2,5,out.orders[0].stop_limit_price);
            if(stable_mutation==14) Tov2CaptureFromDouble(1.2,5,out.orders[0].sl);
            if(stable_mutation==15) Tov2CaptureFromDouble(1.2,5,out.orders[0].tp);
         }
      }
      return exposure_result;
   }
   virtual Tov2CaptureResult BoundaryTickets(const long second_msc,string &tickets[],long &total)
   {
      boundary_calls++;ArrayResize(tickets,ArraySize(boundary_ids));ArrayCopy(tickets,boundary_ids);
      if(boundary_race) {ArrayResize(tickets,1);tickets[0]=IntegerToString(boundary_calls);}
      total=ArraySize(tickets);return TOV2_CAPTURE_OK;
   }
   void AddDeal(const string ticket,const long time,const string type="BUY",const string entry="OUT")
   {
      if(deal_count<0 || deal_count>=2048 || deal_count>=ArraySize(deals)) return;
      Tov2CaptureHistoryRow row;ZeroMemory(row);
      row.result=TOV2_CAPTURE_OK;row.ticket=ticket;row.broker_time_msc=time;
      row.deal.deal_id=ticket;row.deal.broker_time_msc=time;row.deal.type=type;
      row.deal.entry=entry;row.deal.order_id="4000";row.deal.position_id="1000";
      row.deal.symbol="UNLISTED";row.deal.reason="EXPERT";row.deal.protection_source="UNAVAILABLE";
      row.deal.has_volume=true;row.deal.volume.value="0.10";row.deal.volume.scale=2;
      Tov2CaptureFromDouble(1.0,5,row.deal.price);Tov2CaptureFromDouble(5.0,2,row.deal.profit);
      Tov2CaptureFromDouble(-0.2,2,row.deal.commission);Tov2CaptureFromDouble(-0.1,2,row.deal.swap);
      Tov2CaptureFromDouble(-0.05,2,row.deal.fee);
      Tov2CaptureMissing(row.deal.sl,"UNAVAILABLE");Tov2CaptureMissing(row.deal.tp,"UNAVAILABLE");
      if(!Tov2CaptureDealTrading(type))
      {
         row.deal.entry="NONE";row.deal.order_id="";row.deal.position_id="";row.deal.symbol="";
         row.deal.has_volume=false;Tov2CaptureMissing(row.deal.price,"NOT_APPLICABLE");
      }
      deals[deal_count++]=row;
   }
   virtual Tov2CaptureResult History(const long from_msc,const long through_msc,Tov2CaptureHistoryPage &page)
   {
      Tov2CaptureClearHistory(page);page.result=history_result;
      history_calls++;
      if(overflow_window_msc>0 && through_msc-from_msc+1>=overflow_window_msc)
      {page.result=TOV2_CAPTURE_LIMIT_EXCEEDED;page.total=257;return page.result;}
      if(history_result==TOV2_CAPTURE_OK) page.total=0;
      if(history_result==TOV2_CAPTURE_OK)
      {
         for(int i=0;i<deal_count;i++)
         {
            int j=reverse_history?deal_count-1-i:i;
            if(deals[j].broker_time_msc<from_msc || deals[j].broker_time_msc>through_msc) continue;
            if(page.size<TOV2_CAPTURE_HISTORY_MAX) page.rows[page.size++]=deals[j];
            page.total++;
         }
         if(page.total>TOV2_CAPTURE_HISTORY_MAX) {page.result=TOV2_CAPTURE_LIMIT_EXCEEDED;return page.result;}
      }
      if(history_result==TOV2_CAPTURE_UNSUPPORTED)
      {
         page.total=1;page.size=1;page.rows[0].result=TOV2_CAPTURE_UNSUPPORTED;
         page.rows[0].ticket="55";page.rows[0].broker_time_msc=from_msc;
         page.rows[0].raw_type=999;page.rows[0].raw_reason=999;
      }
      return history_result;
   }
};
#endif
