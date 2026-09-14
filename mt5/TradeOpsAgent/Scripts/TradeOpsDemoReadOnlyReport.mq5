#property strict
#property description "Demo-only local capture comparison. No orders, network requests or EA changes."
#include "../Include/TradeOpsNativeCaptureBroker.mqh"
#include "Support/TradeOpsDemoReportTests.mqh"
bool Tov2DemoTerminalAllowed()
{
   if(IsStopped()) return false;
   ResetLastError();long mode=AccountInfoInteger(ACCOUNT_TRADE_MODE);
   if(GetLastError()!=0 || mode!=ACCOUNT_TRADE_MODE_DEMO) return false;
   ResetLastError();long connected=TerminalInfoInteger(TERMINAL_CONNECTED);
   return GetLastError()==0 && connected!=0;
}
void OnStart()
{
   Print("TOV2_DEMO_START version=demo-report-v1 read_only=1 local_log_only=1");
   if(!Tov2DemoTerminalAllowed()) {Print("TOV2_DEMO_ABORT reason=CONNECTED_DEMO_REQUIRED");return;}
   int checks=0,failures=0;
   if(!Tov2DemoReportTests(checks,failures))
   {Print("TOV2_DEMO_ABORT reason=SELFTEST checks=",checks," failures=",failures);return;}
   Print("TOV2_DEMO_SELFTEST_PASS checks=",checks," failures=0");
   CTov2NativeCaptureBroker broker;
   string expected="";Tov2CaptureDisplay display;
   if(!Tov2DemoTerminalAllowed() || broker.Identity(expected,display)!=TOV2_CAPTURE_OK || display.account_mode!="DEMO")
   {Print("TOV2_DEMO_ABORT reason=DEMO_IDENTITY");return;}
   Print("TOV2_DEMO_WAIT waiting_for_fresh_quote timeout_seconds=15");
   ulong started=GetTickCount64();bool fresh=false;
   while(!IsStopped() && GetTickCount64()-started<15000)
   {
      string actual="";Tov2CaptureDisplay now;
      if(!Tov2DemoTerminalAllowed() || broker.Identity(actual,now)!=TOV2_CAPTURE_OK || actual!=expected || now.account_mode!="DEMO")
      {Print("TOV2_DEMO_ABORT reason=DEMO_OR_IDENTITY_CHANGED");return;}
      long utc=0,time=0;
      if(broker.Clocks(utc,time)==TOV2_CAPTURE_OK && broker.EnrollmentClockReady(time)) {fresh=true;break;}
      Sleep(100);
   }
   if(!fresh || IsStopped()) {Print("TOV2_DEMO_ABORT reason=NO_FRESH_QUOTE_OR_STOPPED");return;}
   Print("TOV2_DEMO_READING snapshot_and_last_24h_history");
   CTov2DemoReport report;
   if(!report.Collect(GetPointer(broker))) {Print("TOV2_DEMO_ABORT reason=",report.error);return;}
   string final_identity="";Tov2CaptureDisplay final_display;
   if(!Tov2DemoTerminalAllowed() || broker.Identity(final_identity,final_display)!=TOV2_CAPTURE_OK ||
      final_identity!=expected || final_display.account_mode!="DEMO")
   {report.Clear();Print("TOV2_DEMO_ABORT reason=FINAL_DEMO_OR_IDENTITY_CHANGED");return;}
   // No private report rows are printed until all collection and identity checks succeed.
   Print("TOV2_DEMO_REPORT_BEGIN account_last4=",report.login_last4," currency=",report.currency,
      " balance=",report.balance," equity=",report.equity);
   Print("TOV2_DEMO_WINDOW from_server_msc=",report.from_msc," through_server_msc=",report.through_msc,
      " from_server=",TimeToString((datetime)(report.from_msc/1000),TIME_DATE|TIME_SECONDS),
      " through_server=",TimeToString((datetime)(report.through_msc/1000),TIME_DATE|TIME_SECONDS));
   Print("TOV2_DEMO_ACCOUNT ",report.account_json);
   for(int i=0;i<report.position_count;i++) Print("TOV2_DEMO_POSITION index=",i+1," ",report.positions[i]);
   for(int i=0;i<report.order_count;i++) Print("TOV2_DEMO_ORDER index=",i+1," ",report.orders[i]);
   for(int i=0;i<report.deal_count;i++) Print("TOV2_DEMO_DEAL index=",i+1," ",report.deals[i]);
   Print("TOV2_DEMO_REPORT_COMPLETE positions=",report.position_count," orders=",report.order_count," deals=",report.deal_count,
      " comparison=PENDING no_orders_sent=1 no_network_requests=1");
   report.Clear();
}
