#ifndef TRADEOPS_DEMO_REPORT_TESTS_MQH
#define TRADEOPS_DEMO_REPORT_TESTS_MQH
#include "TradeOpsDemoReport.mqh"
#include "TradeOpsTelemetryCaptureBroker.mqh"
class CTov2DemoChangingBroker : public CTov2FakeCaptureBroker
{
public:
   virtual Tov2CaptureResult History(const long from,const long through,Tov2CaptureHistoryPage &page)
   {
      Tov2CaptureResult result=CTov2FakeCaptureBroker::History(from,through,page);
      display.account_mode="REAL";
      return result;
   }
};
void Tov2DemoTestCheck(const bool pass,const string label,int &checks,int &failures)
{
   checks++;
   if(!pass) {failures++;Print("TOV2_DEMO_SELFTEST_FAILURE case=",label);}
}
bool Tov2DemoReportTests(int &checks,int &failures)
{
   checks=0;failures=0;
   CTov2DemoReport report;
   CTov2FakeCaptureBroker *broker=new CTov2FakeCaptureBroker;
   if(CheckPointer(broker)==POINTER_INVALID) return false;
   Tov2DemoTestCheck(report.Collect(broker),"empty-demo",checks,failures);
   Tov2DemoTestCheck(report.ready && report.balance=="100.00" && report.equity=="100.00" &&
      report.position_count==0 && report.order_count==0 && report.deal_count==0,"empty-complete",checks,failures);
   Tov2DemoTestCheck(report.from_msc==broker.broker_now-86399000 && report.through_msc==broker.broker_now+999 &&
      report.through_msc-report.from_msc+1==86400000,"exact-24h-server-seconds",checks,failures);
   broker.SetPositions(1);broker.SetOrders(1);
   broker.AddDeal("901",broker.broker_now-86399001);
   broker.AddDeal("902",broker.broker_now-86399000);
   broker.AddDeal("903",broker.broker_now+999);
   broker.AddDeal("904",broker.broker_now+1000);
   Tov2DemoTestCheck(report.Collect(broker) && report.position_count==1 && report.order_count==1 && report.deal_count==2,
      "snapshot-and-inclusive-history-boundaries",checks,failures);
   Tov2DemoTestCheck(StringFind(report.deals[0],"902")>=0 && StringFind(report.deals[1],"903")>=0,
      "history-row-values",checks,failures);
   broker.display.account_mode="REAL";int calls=broker.history_calls;
   Tov2DemoTestCheck(!report.Collect(broker) && report.error=="DEMO_REQUIRED" && broker.history_calls==calls,
      "reject-real-before-history",checks,failures);
   Tov2DemoTestCheck(!report.ready && report.balance=="" && report.account_json=="" && ArraySize(report.deals)==0 &&
      ArraySize(report.positions)==0 && ArraySize(report.orders)==0,"clear-prior-report",checks,failures);
   broker.display.account_mode="CONTEST";
   Tov2DemoTestCheck(!report.Collect(broker) && report.error=="DEMO_REQUIRED","reject-contest",checks,failures);
   broker.display.account_mode="DEMO";broker.enrollment_ready=false;
   Tov2DemoTestCheck(!report.Collect(broker) && report.error=="FRESH_QUOTE_REQUIRED","reject-stale",checks,failures);
   broker.enrollment_ready=true;broker.account_result=TOV2_CAPTURE_READ_FAILED;
   Tov2DemoTestCheck(!report.Collect(broker) && !report.ready,"account-read-failure",checks,failures);
   broker.account_result=TOV2_CAPTURE_OK;broker.membership_race=true;
   Tov2DemoTestCheck(!report.Collect(broker),"membership-race",checks,failures);
   broker.membership_race=false;broker.switch_after_read=true;broker.exposure_calls=0;
   Tov2DemoTestCheck(!report.Collect(broker),"identity-switch",checks,failures);
   broker.switch_after_read=false;broker.SetPositions(129);
   Tov2DemoTestCheck(!report.Collect(broker),"position-limit",checks,failures);
   broker.SetPositions(0);broker.SetOrders(129);
   Tov2DemoTestCheck(!report.Collect(broker),"order-limit",checks,failures);
   broker.SetOrders(0);broker.history_result=TOV2_CAPTURE_READ_FAILED;
   Tov2DemoTestCheck(!report.Collect(broker) && report.error=="HISTORY_READ_FAILED","history-unavailable",checks,failures);
   broker.history_result=TOV2_CAPTURE_UNSUPPORTED;
   Tov2DemoTestCheck(!report.Collect(broker) && report.error=="HISTORY_UNSUPPORTED","unsupported-history",checks,failures);
   broker.history_result=TOV2_CAPTURE_OK;broker.deal_count=0;
   Tov2CaptureFromDouble(1.0,2,broker.account.margin_used);
   Tov2CaptureMissing(broker.account.margin_level,"READ_FAILED");
   Tov2DemoTestCheck(!report.Collect(broker) && report.error=="FIELD_READ_FAILED","margin-level-read-failed",checks,failures);
   Tov2CaptureFromDouble(0.0,2,broker.account.margin_used);
   Tov2CaptureMissing(broker.account.margin_level,"NOT_APPLICABLE");
   for(int field=0;field<6;field++)
   {
      broker.SetPositions(1);
      if(field==0) Tov2CaptureMissing(broker.exposure.positions[0].entry_price);
      if(field==1) Tov2CaptureMissing(broker.exposure.positions[0].current_price);
      if(field==2) Tov2CaptureMissing(broker.exposure.positions[0].sl);
      if(field==3) Tov2CaptureMissing(broker.exposure.positions[0].tp);
      if(field==4) Tov2CaptureMissing(broker.exposure.positions[0].floating_profit);
      if(field==5) Tov2CaptureMissing(broker.exposure.positions[0].swap);
      Tov2DemoTestCheck(!report.Collect(broker) && report.error=="FIELD_READ_FAILED" && ArraySize(report.positions)==0,
         "position-field-"+IntegerToString(field),checks,failures);
   }
   broker.SetPositions(0);
   for(int field=0;field<4;field++)
   {
      broker.SetOrders(1);
      if(field==0) Tov2CaptureMissing(broker.exposure.orders[0].price);
      if(field==1) Tov2CaptureMissing(broker.exposure.orders[0].stop_limit_price);
      if(field==2) Tov2CaptureMissing(broker.exposure.orders[0].sl);
      if(field==3) Tov2CaptureMissing(broker.exposure.orders[0].tp);
      Tov2DemoTestCheck(!report.Collect(broker) && report.error=="FIELD_READ_FAILED" && ArraySize(report.orders)==0,
         "order-field-"+IntegerToString(field),checks,failures);
   }
   broker.SetOrders(0);
   for(int field=0;field<7;field++)
   {
      broker.deal_count=0;broker.AddDeal("700",broker.broker_now);
      if(field==0) Tov2CaptureMissing(broker.deals[0].deal.price);
      if(field==1) Tov2CaptureMissing(broker.deals[0].deal.profit);
      if(field==2) Tov2CaptureMissing(broker.deals[0].deal.commission);
      if(field==3) Tov2CaptureMissing(broker.deals[0].deal.swap);
      if(field==4) Tov2CaptureMissing(broker.deals[0].deal.fee);
      if(field==5) Tov2CaptureMissing(broker.deals[0].deal.sl,"READ_FAILED");
      if(field==6) Tov2CaptureMissing(broker.deals[0].deal.tp,"READ_FAILED");
      Tov2DemoTestCheck(!report.Collect(broker) && report.error=="FIELD_READ_FAILED" && ArraySize(report.deals)==0,
         "deal-field-"+IntegerToString(field),checks,failures);
   }
   broker.deal_count=0;
   for(int i=0;i<256;i++) broker.AddDeal(IntegerToString(i+1),broker.broker_now);
   Tov2DemoTestCheck(report.Collect(broker) && report.deal_count==256,"history-256",checks,failures);
   broker.AddDeal("257",broker.broker_now);
   Tov2DemoTestCheck(!report.Collect(broker) && report.error=="HISTORY_LIMIT_256" && !report.ready &&
      ArraySize(report.deals)==0,"history-257-no-partial-output",checks,failures);
   delete broker;
   CTov2DemoChangingBroker *changing=new CTov2DemoChangingBroker;
   if(CheckPointer(changing)==POINTER_INVALID) return false;
   Tov2DemoTestCheck(!report.Collect(changing) && report.error=="DEMO_REQUIRED" && !report.ready,
      "demo-switch-during-history",checks,failures);
   delete changing;
   Tov2DemoTestCheck(!report.Collect(NULL) && report.error=="BROKER_UNAVAILABLE","null-broker",checks,failures);
   return failures==0;
}
#endif
