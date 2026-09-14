#property strict
#property script_show_inputs

#include "..\\Include\\TradeOpsCanonicalJson.mqh"

bool TradeOpsSelfTest(const bool condition,const string label)
{
   if(condition) return true;
   Print("TradeOpsAgent self-test failed: ",label);
   return false;
}

void OnStart()
{
   bool ok=true;
   ok=TradeOpsSelfTest(TradeOpsCanonicalObject2("z","1","a","2")=="{\"a\":2,\"z\":1}","canonical key order") && ok;
   string payload="{\"a\":1,\"z\":2}";
   string payload_digest="";
   ok=TradeOpsSelfTest(TradeOpsSha256Hex(payload,payload_digest) && payload_digest=="99168216144c7fed5d4c54916cf98d9c66096280c04a499822a99b6658bd177a","payload digest") && ok;
   string response_body="{\"acknowledged_event_sequence\":0,\"command\":null,\"evidence_requests\":[],\"freeze_reasons\":[],\"mode\":\"DRY_RUN\",\"schema_version\":\"AgentSyncResponseV1\",\"server_sequence\":1,\"server_time_epoch\":1787472010}";
   string response_digest="";
   ok=TradeOpsSelfTest(TradeOpsSha256Hex(response_body,response_digest) && response_digest=="4b8ae9a769afc7f3447deffcf1b0b0eb5f0560997652a13a0214e9b841aa7274","response digest") && ok;
   string safe_response="{\"acknowledged_event_sequence\":0,\"command\":null,\"evidence_requests\":[],\"freeze_reasons\":[],\"mode\":\"DRY_RUN\",\"response_body_sha256\":\"4b8ae9a769afc7f3447deffcf1b0b0eb5f0560997652a13a0214e9b841aa7274\",\"schema_version\":\"AgentSyncResponseV1\",\"server_sequence\":1,\"server_time_epoch\":1787472010}";
   long server_sequence=0;
   long acknowledged=0;
   ok=TradeOpsSelfTest(TradeOpsResponseIsSafe(safe_response,1,server_sequence,acknowledged) && server_sequence==1 && acknowledged==0,"dry-run null-command response") && ok;
   if(ok) Print("TradeOpsAgent self-test passed");
}
