#ifndef TRADE_OPS_SYNC_MQH
#define TRADE_OPS_SYNC_MQH

#include "TradeOpsConfig.mqh"

string TradeOpsPermission(const long allowed)
{
   return allowed!=0 ? "ALLOWED" : "DENIED";
}

string TradeOpsConnectionState()
{
   return TerminalInfoInteger(TERMINAL_CONNECTED)!=0 ? "CONNECTED" : "DISCONNECTED";
}

string TradeOpsNullableEpoch(const datetime value)
{
   if(value<=0) return "null";
   return LongToString((long)value);
}

bool TradeOpsAccountFingerprint(string &fingerprint)
{
   string material=LongToString(AccountInfoInteger(ACCOUNT_LOGIN))+"|"+AccountInfoString(ACCOUNT_SERVER)+"|"+AccountInfoString(ACCOUNT_COMPANY);
   return TradeOpsSha256Hex(material,fingerprint);
}

bool TradeOpsBrokerServerMatches(const TradeOpsConfig &config)
{
   string broker_server_digest="";
   return TradeOpsSha256Hex(AccountInfoString(ACCOUNT_SERVER),broker_server_digest)
      && broker_server_digest==config.broker_server_sha256;
}

string TradeOpsBuildSnapshot(const TradeOpsConfig &config,const string account_fingerprint,const long observed_at)
{
   string broker_symbol=Symbol();
   if(!TradeOpsJsonSafeIdentifier(broker_symbol)) return "";
   string selection_state=SymbolInfoInteger(broker_symbol,SYMBOL_SELECT)!=0 ? "SELECTED" : "NOT_SELECTED";
   string symbol="{"
      +"\"ask_ticks\":null,\"bid_ticks\":null,\"broker_symbol\":"+TradeOpsJsonString(broker_symbol)
      +",\"capability_state\":\"UNKNOWN\",\"observed_at_epoch\":"+LongToString(observed_at)
      +",\"selection_state\":"+TradeOpsJsonString(selection_state)
      +",\"source_symbol\":"+TradeOpsJsonString(config.source_symbol)
      +",\"symbol_capability_sha256\":"+TradeOpsJsonString(config.symbol_capability_sha256)
      +",\"synchronization_state\":\"UNKNOWN\",\"trade_mode\":\"UNKNOWN\"}";
   string watermark="{\"consecutive_stable_sweeps\":0,\"history_through_epoch\":0,\"reconciliation_sha256\":"
      +TradeOpsJsonString(config.reconciliation_sha256)+",\"state\":\"UNKNOWN\",\"watermark\":\"not-started\"}";
   return "{"
      +"\"account_fingerprint_sha256\":"+TradeOpsJsonString(account_fingerprint)
      +",\"account_trade_permission\":"+TradeOpsJsonString(TradeOpsPermission(AccountInfoInteger(ACCOUNT_TRADE_ALLOWED)))
      +",\"algo_trading_permission\":"+TradeOpsJsonString(TradeOpsPermission(MQLInfoInteger(MQL_TRADE_ALLOWED)))
      +",\"balance_minor_units\":null"
      +",\"broker_time_epoch\":"+TradeOpsNullableEpoch(TimeTradeServer())
      +",\"ea_sha256\":"+TradeOpsJsonString(config.ea_sha256)
      +",\"equity_minor_units\":null,\"free_margin_minor_units\":null"
      +",\"manifest_sha256\":"+TradeOpsJsonString(config.manifest_sha256)
      +",\"margin_level_bps\":null,\"margin_minor_units\":null"
      +",\"observed_at_epoch\":"+LongToString(observed_at)
      +",\"open_orders\":[],\"positions\":[],\"reconciliation_watermark\":"+watermark
      +",\"symbols\":["+symbol+"]"
      +",\"terminal_build\":"+LongToString(TerminalInfoInteger(TERMINAL_BUILD))
      +",\"terminal_connection_state\":"+TradeOpsJsonString(TradeOpsConnectionState())
      +",\"terminal_trade_permission\":"+TradeOpsJsonString(TradeOpsPermission(TerminalInfoInteger(TERMINAL_TRADE_ALLOWED)))
      +",\"windows_time_epoch\":"+TradeOpsNullableEpoch(TimeLocal())
      +"}";
}

bool TradeOpsBuildHeartbeatRequest(const TradeOpsConfig &config,const long request_sequence,const long last_acknowledged_server_sequence,string &payload)
{
   if(request_sequence<1 || last_acknowledged_server_sequence<0 || !TradeOpsBrokerServerMatches(config)) return false;
   long now=(long)TimeLocal();
   if(now<=0) return false;
   string fingerprint="";
   if(!TradeOpsAccountFingerprint(fingerprint)) return false;
   string snapshot=TradeOpsBuildSnapshot(config,fingerprint,now);
   if(StringLen(snapshot)==0) return false;
   string nonce="n-"+LongToString(request_sequence)+"-"+StringSubstr(fingerprint,0,24);
   string body_without_digest="{"
      +"\"account_id\":"+TradeOpsJsonString(config.account_id)
      +",\"account_profile_sha256\":"+TradeOpsJsonString(config.account_profile_sha256)
      +",\"account_snapshot\":"+snapshot
      +",\"broker_bar_evidence\":[],\"events\":[]"
      +",\"installation_id\":"+TradeOpsJsonString(config.installation_id)
      +",\"last_acknowledged_server_sequence\":"+LongToString(last_acknowledged_server_sequence)
      +",\"nonce\":"+TradeOpsJsonString(nonce)
      +",\"request_sequence\":"+LongToString(request_sequence)
      +",\"safety_epoch\":"+LongToString(config.safety_epoch)
      +",\"schema_version\":\"AgentSyncRequestV1\""
      +",\"sent_at_epoch\":"+LongToString(now)
      +"}";
   string digest="";
   if(!TradeOpsSha256Hex(body_without_digest,digest)) return false;
   payload="{"
      +"\"account_id\":"+TradeOpsJsonString(config.account_id)
      +",\"account_profile_sha256\":"+TradeOpsJsonString(config.account_profile_sha256)
      +",\"account_snapshot\":"+snapshot
      +",\"body_sha256\":"+TradeOpsJsonString(digest)
      +",\"broker_bar_evidence\":[],\"events\":[]"
      +",\"installation_id\":"+TradeOpsJsonString(config.installation_id)
      +",\"last_acknowledged_server_sequence\":"+LongToString(last_acknowledged_server_sequence)
      +",\"nonce\":"+TradeOpsJsonString(nonce)
      +",\"request_sequence\":"+LongToString(request_sequence)
      +",\"safety_epoch\":"+LongToString(config.safety_epoch)
      +",\"schema_version\":\"AgentSyncRequestV1\""
      +",\"sent_at_epoch\":"+LongToString(now)
      +"}";
   return StringLen(payload)<=262144;
}

bool TradeOpsPostHeartbeat(const TradeOpsConfig &config,long &request_sequence,long &last_acknowledged_server_sequence,string &status)
{
   string payload="";
   if(!TradeOpsBuildHeartbeatRequest(config,request_sequence,last_acknowledged_server_sequence,payload))
   {
      status="PROFILE_REJECTED";
      return false;
   }
   char request_bytes[];
   int request_size=StringToCharArray(payload,request_bytes,0,WHOLE_ARRAY,CP_UTF8);
   if(request_size<=0) { status="PAYLOAD_REJECTED"; return false; }
   if(request_bytes[request_size-1]==0) ArrayResize(request_bytes,request_size-1);
   if(ArraySize(request_bytes)>262144) { status="PAYLOAD_REJECTED"; return false; }
   string headers="Authorization: Bearer "+config.bearer+"\r\nContent-Type: application/json\r\n";
   char response_bytes[];
   string response_headers="";
   ResetLastError();
   int http_status=WebRequest("POST",config.endpoint,headers,1500,request_bytes,response_bytes,response_headers);
   if(http_status!=200)
   {
      status="SYNC_WAITING";
      return false;
   }
   string response=CharArrayToString(response_bytes,0,WHOLE_ARRAY,CP_UTF8);
   long acknowledged=0;
   if(!TradeOpsResponseIsSafe(response,request_sequence,acknowledged))
   {
      status="SYNC_REJECTED";
      return false;
   }
   last_acknowledged_server_sequence=acknowledged;
   request_sequence++;
   status="SYNC_OK";
   return true;
}

#endif
