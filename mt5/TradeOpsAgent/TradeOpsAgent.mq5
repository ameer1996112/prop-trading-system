#property strict
#property version   "1.000"
#property description "Dry-run heartbeat only. This EA has no trading authority."

#include "Include\\TradeOpsConfig.mqh"
#include "Include\\TradeOpsSync.mqh"

input string InpProfile = "DRY_RUN";

TradeOpsConfig g_config;
TradeOpsSyncState g_sync_state;
bool g_timer_busy=false;
string g_status="INITIALIZING";

void TradeOpsRenderStatus()
{
   Comment("TradeOpsAgent | "+g_status+" | DRY_RUN");
}

int OnInit()
{
   if(InpProfile!="DRY_RUN")
   {
      g_status="PROFILE_REJECTED";
      TradeOpsRenderStatus();
      return INIT_PARAMETERS_INCORRECT;
   }
   if(!TradeOpsLoadConfig(g_config) || g_config.profile!=InpProfile)
   {
      g_status="CONFIG_REJECTED";
      TradeOpsRenderStatus();
      return INIT_PARAMETERS_INCORRECT;
   }
   if(!TradeOpsLoadSyncState(g_sync_state))
   {
      g_status="JOURNAL_REJECTED";
      TradeOpsRenderStatus();
      return INIT_PARAMETERS_INCORRECT;
   }
   if(!EventSetTimer(5))
   {
      g_status="TIMER_REJECTED";
      TradeOpsRenderStatus();
      return INIT_FAILED;
   }
   g_status="DRY_RUN_READY";
   TradeOpsRenderStatus();
   return INIT_SUCCEEDED;
}

void OnTimer()
{
   if(g_timer_busy) return;
   g_timer_busy=true;
   TradeOpsPostHeartbeat(g_config,g_sync_state,g_status);
   TradeOpsRenderStatus();
   g_timer_busy=false;
}

void OnDeinit(const int reason)
{
   EventKillTimer();
   g_timer_busy=false;
   g_status="STOPPED";
   TradeOpsRenderStatus();
}
