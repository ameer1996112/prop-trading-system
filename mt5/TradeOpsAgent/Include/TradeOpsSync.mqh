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
   return TradeOpsIntegerString((long)value);
}

bool TradeOpsAccountFingerprint(string &fingerprint)
{
   string material=TradeOpsIntegerString(AccountInfoInteger(ACCOUNT_LOGIN))+"|"+AccountInfoString(ACCOUNT_SERVER)+"|"+AccountInfoString(ACCOUNT_COMPANY);
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
      +",\"capability_state\":\"UNKNOWN\",\"observed_at_epoch\":"+TradeOpsIntegerString(observed_at)
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
      +",\"observed_at_epoch\":"+TradeOpsIntegerString(observed_at)
      +",\"open_orders\":[],\"positions\":[],\"reconciliation_watermark\":"+watermark
      +",\"symbols\":["+symbol+"]"
      +",\"terminal_build\":"+TradeOpsIntegerString(TerminalInfoInteger(TERMINAL_BUILD))
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
   string nonce="n-"+TradeOpsIntegerString(request_sequence)+"-"+StringSubstr(fingerprint,0,24);
   string body_without_digest="{"
      +"\"account_id\":"+TradeOpsJsonString(config.account_id)
      +",\"account_profile_sha256\":"+TradeOpsJsonString(config.account_profile_sha256)
      +",\"account_snapshot\":"+snapshot
      +",\"broker_bar_evidence\":[],\"events\":[]"
      +",\"installation_id\":"+TradeOpsJsonString(config.installation_id)
      +",\"last_acknowledged_server_sequence\":"+TradeOpsIntegerString(last_acknowledged_server_sequence)
      +",\"nonce\":"+TradeOpsJsonString(nonce)
      +",\"request_sequence\":"+TradeOpsIntegerString(request_sequence)
      +",\"safety_epoch\":"+TradeOpsIntegerString(config.safety_epoch)
      +",\"schema_version\":\"AgentSyncRequestV1\""
      +",\"sent_at_epoch\":"+TradeOpsIntegerString(now)
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
      +",\"last_acknowledged_server_sequence\":"+TradeOpsIntegerString(last_acknowledged_server_sequence)
      +",\"nonce\":"+TradeOpsJsonString(nonce)
      +",\"request_sequence\":"+TradeOpsIntegerString(request_sequence)
      +",\"safety_epoch\":"+TradeOpsIntegerString(config.safety_epoch)
      +",\"schema_version\":\"AgentSyncRequestV1\""
      +",\"sent_at_epoch\":"+TradeOpsIntegerString(now)
      +"}";
   return StringLen(payload)<=262144;
}

struct TradeOpsSyncState
{
   long request_sequence;
   long last_acknowledged_server_sequence;
   string pending_payload;
};

string TradeOpsSyncJournalPath()
{
   return "TradeOpsAgent\\journal\\sync-state.ini";
}

bool TradeOpsLineValue(const string line,const string key,string &value)
{
   string prefix=key+"=";
   if(StringFind(line,prefix)!=0) return false;
   value=StringSubstr(line,StringLen(prefix));
   return true;
}

bool TradeOpsPendingPayloadMatchesState(const string payload,const long request_sequence,const long last_acknowledged_server_sequence)
{
   if(StringLen(payload)==0 || StringLen(payload)>262144) return false;
   const string body_prefix=",\"body_sha256\":\"";
   int body_index=StringFind(payload,body_prefix);
   if(body_index<0 || StringFind(payload,body_prefix,body_index+1)>=0) return false;
   int digest_index=body_index+StringLen(body_prefix);
   if(digest_index+65>StringLen(payload)) return false;
   string digest=StringSubstr(payload,digest_index,64);
   if(!TradeOpsIsLowerHexSha256(digest) || StringGetCharacter(payload,digest_index+64)!=34) return false;
   string canonical_without_digest=StringSubstr(payload,0,body_index)+StringSubstr(payload,digest_index+65);
   string calculated_digest="";
   if(!TradeOpsSha256Hex(canonical_without_digest,calculated_digest) || calculated_digest!=digest) return false;
   const string acknowledged_prefix=",\"last_acknowledged_server_sequence\":";
   int acknowledged_index=StringFind(payload,acknowledged_prefix);
   if(acknowledged_index<0) return false;
   int cursor=acknowledged_index+StringLen(acknowledged_prefix);
   long persisted_acknowledged=0;
   if(!TradeOpsReadNonnegativeInteger(payload,cursor,",\"nonce\":",persisted_acknowledged) || persisted_acknowledged!=last_acknowledged_server_sequence) return false;
   const string sequence_prefix=",\"request_sequence\":";
   int sequence_index=StringFind(payload,sequence_prefix);
   if(sequence_index<0) return false;
   cursor=sequence_index+StringLen(sequence_prefix);
   long persisted_sequence=0;
   return TradeOpsReadNonnegativeInteger(payload,cursor,",\"safety_epoch\":",persisted_sequence)
      && persisted_sequence==request_sequence;
}

bool TradeOpsSaveSyncState(const TradeOpsSyncState &state)
{
   if(state.request_sequence<1 || state.last_acknowledged_server_sequence<0) return false;
   if(StringLen(state.pending_payload)>0 && !TradeOpsPendingPayloadMatchesState(state.pending_payload,state.request_sequence,state.last_acknowledged_server_sequence)) return false;
   string path=TradeOpsSyncJournalPath();
   string temporary_path=path+".tmp";
   int handle=FileOpen(temporary_path,FILE_WRITE|FILE_TXT|FILE_ANSI);
   if(handle==INVALID_HANDLE) return false;
   bool written=FileWrite(handle,"request_sequence="+TradeOpsIntegerString(state.request_sequence))>0
      && FileWrite(handle,"last_acknowledged_server_sequence="+TradeOpsIntegerString(state.last_acknowledged_server_sequence))>0
      && FileWrite(handle,"pending_payload="+state.pending_payload)>0;
   FileClose(handle);
   if(!written)
   {
      FileDelete(temporary_path);
      return false;
   }
   if(!FileMove(temporary_path,0,path,FILE_REWRITE))
   {
      FileDelete(temporary_path);
      return false;
   }
   return true;
}

bool TradeOpsLoadSyncState(TradeOpsSyncState &state)
{
   state.request_sequence=1;
   state.last_acknowledged_server_sequence=0;
   state.pending_payload="";
   int handle=FileOpen(TradeOpsSyncJournalPath(),FILE_READ|FILE_TXT|FILE_ANSI);
   if(handle==INVALID_HANDLE) return true;
   string request_line=FileReadString(handle);
   string acknowledged_line=FileReadString(handle);
   string pending_line=FileReadString(handle);
   bool complete=FileIsEnding(handle);
   FileClose(handle);
   string request_value="";
   string acknowledged_value="";
   string pending_value="";
   if(!complete || !TradeOpsLineValue(request_line,"request_sequence",request_value)
      || !TradeOpsLineValue(acknowledged_line,"last_acknowledged_server_sequence",acknowledged_value)
      || !TradeOpsLineValue(pending_line,"pending_payload",pending_value)) return false;
   state.request_sequence=StringToInteger(request_value);
   state.last_acknowledged_server_sequence=StringToInteger(acknowledged_value);
   state.pending_payload=pending_value;
   if(state.request_sequence<1 || state.last_acknowledged_server_sequence<0) return false;
   return StringLen(state.pending_payload)==0
      || TradeOpsPendingPayloadMatchesState(state.pending_payload,state.request_sequence,state.last_acknowledged_server_sequence);
}

bool TradeOpsPostHeartbeat(const TradeOpsConfig &config,TradeOpsSyncState &state,string &status)
{
   if(StringLen(state.pending_payload)==0)
   {
      TradeOpsSyncState pending_state=state;
      if(!TradeOpsBuildHeartbeatRequest(config,pending_state.request_sequence,pending_state.last_acknowledged_server_sequence,pending_state.pending_payload))
      {
         status="PROFILE_REJECTED";
         return false;
      }
      if(!TradeOpsSaveSyncState(pending_state))
      {
         status="JOURNAL_REJECTED";
         return false;
      }
      state=pending_state;
   }
   if(!TradeOpsPendingPayloadMatchesState(state.pending_payload,state.request_sequence,state.last_acknowledged_server_sequence))
   {
      status="JOURNAL_REJECTED";
      return false;
   }
   char request_bytes[];
   int request_size=StringToCharArray(state.pending_payload,request_bytes,0,WHOLE_ARRAY,CP_UTF8);
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
      int transport_error=GetLastError();
      status=http_status<0
         ? "SYNC_WAITING_"+TradeOpsIntegerString((long)transport_error)
         : "SYNC_HTTP_"+TradeOpsIntegerString((long)http_status);
      return false;
   }
   string response=CharArrayToString(response_bytes,0,WHOLE_ARRAY,CP_UTF8);
   long server_sequence=0;
   long acknowledged=0;
   if(!TradeOpsResponseIsSafe(response,state.request_sequence,server_sequence,acknowledged) || acknowledged!=0)
   {
      status="SYNC_REJECTED";
      return false;
   }
   TradeOpsSyncState advanced_state=state;
   advanced_state.last_acknowledged_server_sequence=server_sequence;
   advanced_state.request_sequence++;
   advanced_state.pending_payload="";
   if(!TradeOpsSaveSyncState(advanced_state))
   {
      status="JOURNAL_REJECTED";
      return false;
   }
   state=advanced_state;
   status="SYNC_OK";
   return true;
}

#endif
