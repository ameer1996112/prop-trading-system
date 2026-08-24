#ifndef TRADE_OPS_CONFIG_MQH
#define TRADE_OPS_CONFIG_MQH

#include "TradeOpsCanonicalJson.mqh"

struct TradeOpsConfig
{
   string profile;
   string endpoint;
   string bearer;
   string installation_id;
   string account_id;
   string account_profile_sha256;
   string broker_server_sha256;
   string ea_sha256;
   string manifest_sha256;
   string symbol_capability_sha256;
   string reconciliation_sha256;
   string source_symbol;
   long safety_epoch;
};

string TradeOpsConfigPath()
{
   return "TradeOpsAgent\\local\\config.ini";
}

bool TradeOpsConfigAssign(TradeOpsConfig &config,const string key,const string value)
{
   if(key=="profile") config.profile=value;
   else if(key=="endpoint") config.endpoint=value;
   else if(key=="bearer") config.bearer=value;
   else if(key=="installation_id") config.installation_id=value;
   else if(key=="account_id") config.account_id=value;
   else if(key=="account_profile_sha256") config.account_profile_sha256=value;
   else if(key=="broker_server_sha256") config.broker_server_sha256=value;
   else if(key=="ea_sha256") config.ea_sha256=value;
   else if(key=="manifest_sha256") config.manifest_sha256=value;
   else if(key=="symbol_capability_sha256") config.symbol_capability_sha256=value;
   else if(key=="reconciliation_sha256") config.reconciliation_sha256=value;
   else if(key=="source_symbol") config.source_symbol=value;
   else if(key=="safety_epoch") config.safety_epoch=StringToInteger(value);
   else return false;
   return true;
}

bool TradeOpsConfigIsSafe(const TradeOpsConfig &config)
{
   string https_prefix="https"+"://";
   return config.profile=="DRY_RUN"
      && StringFind(config.endpoint,https_prefix)==0
      && StringLen(config.bearer)>0
      && TradeOpsJsonSafeIdentifier(config.installation_id)
      && TradeOpsJsonSafeIdentifier(config.account_id)
      && TradeOpsJsonSafeIdentifier(config.source_symbol)
      && config.safety_epoch>=0
      && TradeOpsIsLowerHexSha256(config.account_profile_sha256)
      && TradeOpsIsLowerHexSha256(config.broker_server_sha256)
      && TradeOpsIsLowerHexSha256(config.ea_sha256)
      && TradeOpsIsLowerHexSha256(config.manifest_sha256)
      && TradeOpsIsLowerHexSha256(config.symbol_capability_sha256)
      && TradeOpsIsLowerHexSha256(config.reconciliation_sha256);
}

bool TradeOpsLoadConfig(TradeOpsConfig &config)
{
   ZeroMemory(config);
   int handle=FileOpen(TradeOpsConfigPath(),FILE_READ|FILE_TXT|FILE_ANSI);
   if(handle==INVALID_HANDLE) return false;

   bool valid=true;
   while(!FileIsEnding(handle))
   {
      string line=FileReadString(handle);
      if(StringLen(line)==0 || StringGetCharacter(line,0)==35) continue;
      int delimiter=StringFind(line,"=");
      if(delimiter<=0 || StringFind(line,"=",delimiter+1)>=0)
      {
         valid=false;
         break;
      }
      string key=StringSubstr(line,0,delimiter);
      string value=StringSubstr(line,delimiter+1);
      if(!TradeOpsConfigAssign(config,key,value))
      {
         valid=false;
         break;
      }
   }
   FileClose(handle);
   return valid && TradeOpsConfigIsSafe(config);
}

#endif
