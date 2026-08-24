#ifndef TRADE_OPS_CANONICAL_JSON_MQH
#define TRADE_OPS_CANONICAL_JSON_MQH

string TradeOpsJsonEscape(const string value)
{
   string output="";
   for(int index=0; index<StringLen(value); index++)
   {
      ushort character=(ushort)StringGetCharacter(value,index);
      if(character==92) output+="\\\\";
      else if(character==34) output+="\\\"";
      else if(character==10) output+="\\n";
      else if(character==13) output+="\\r";
      else if(character==9) output+="\\t";
      else output+=ShortToString(character);
   }
   return output;
}

string TradeOpsJsonString(const string value)
{
   return "\""+TradeOpsJsonEscape(value)+"\"";
}

string TradeOpsIntegerString(const long value)
{
   return StringFormat("%I64d",value);
}

string TradeOpsCanonicalObject2(const string first_key,const string first_value,const string second_key,const string second_value)
{
   if(StringCompare(first_key,second_key)<=0)
      return "{"+TradeOpsJsonString(first_key)+":"+first_value+","+TradeOpsJsonString(second_key)+":"+second_value+"}";
   return "{"+TradeOpsJsonString(second_key)+":"+second_value+","+TradeOpsJsonString(first_key)+":"+first_value+"}";
}

bool TradeOpsSha256Hex(const string value,string &hex)
{
   uchar bytes[];
   uchar key[];
   uchar digest[];
   int count=StringToCharArray(value,bytes,0,WHOLE_ARRAY,CP_UTF8);
   if(count<=0) return false;
   if(bytes[count-1]==0) ArrayResize(bytes,count-1);
   if(CryptEncode(CRYPT_HASH_SHA256,bytes,key,digest)<=0) return false;
   hex="";
   for(int index=0; index<ArraySize(digest); index++)
      hex+=StringFormat("%02x",digest[index]);
   return StringLen(hex)==64;
}

bool TradeOpsIsLowerHexSha256(const string value)
{
   if(StringLen(value)!=64) return false;
   for(int index=0; index<64; index++)
   {
      ushort character=(ushort)StringGetCharacter(value,index);
      bool digit=(character>=48 && character<=57);
      bool lower=(character>=97 && character<=102);
      if(!digit && !lower) return false;
   }
   return value!="0000000000000000000000000000000000000000000000000000000000000000";
}

bool TradeOpsJsonSafeIdentifier(const string value)
{
   int length=StringLen(value);
   if(length<1 || length>160) return false;
   for(int index=0; index<length; index++)
   {
      ushort character=(ushort)StringGetCharacter(value,index);
      if(character<33 || character==92 || character>126) return false;
   }
   return true;
}

bool TradeOpsReadNonnegativeInteger(const string value,int &cursor,const string suffix,long &number)
{
   int start=cursor;
   while(cursor<StringLen(value))
   {
      ushort character=(ushort)StringGetCharacter(value,cursor);
      if(character<48 || character>57) break;
      cursor++;
   }
   if(cursor==start || StringSubstr(value,cursor,StringLen(suffix))!=suffix) return false;
   string digits=StringSubstr(value,start,cursor-start);
   number=StringToInteger(digits);
   if(number<0 || TradeOpsIntegerString(number)!=digits) return false;
   cursor+=StringLen(suffix);
   return true;
}

bool TradeOpsResponseIsSafe(const string response,const long expected_server_sequence,long &verified_server_sequence,long &acknowledged_event_sequence)
{
   const string ack_prefix="{\"acknowledged_event_sequence\":";
   if(StringFind(response,ack_prefix)!=0) return false;
   int cursor=StringLen(ack_prefix);
   long acknowledged=0;
   if(!TradeOpsReadNonnegativeInteger(response,cursor,",\"command\":null,\"evidence_requests\":[],\"freeze_reasons\":[],\"mode\":\"DRY_RUN\",\"response_body_sha256\":\"",acknowledged)) return false;
   int digest_start=cursor;
   if(digest_start+64>=StringLen(response)) return false;
   string digest=StringSubstr(response,digest_start,64);
   if(!TradeOpsIsLowerHexSha256(digest)) return false;
   cursor+=64;
   const string sequence_prefix=",\"schema_version\":\"AgentSyncResponseV1\",\"server_sequence\":";
   if(StringSubstr(response,cursor,StringLen(sequence_prefix))!=sequence_prefix) return false;
   cursor+=StringLen(sequence_prefix);
   long server_sequence=0;
   if(!TradeOpsReadNonnegativeInteger(response,cursor,",\"server_time_epoch\":",server_sequence)) return false;
   long server_time=0;
   if(!TradeOpsReadNonnegativeInteger(response,cursor,"}",server_time)) return false;
   if(cursor!=StringLen(response) || server_sequence!=expected_server_sequence) return false;
   string canonical_body="{\"acknowledged_event_sequence\":"+TradeOpsIntegerString(acknowledged)
      +",\"command\":null,\"evidence_requests\":[],\"freeze_reasons\":[],\"mode\":\"DRY_RUN\""
      +",\"schema_version\":\"AgentSyncResponseV1\",\"server_sequence\":"+TradeOpsIntegerString(server_sequence)
      +",\"server_time_epoch\":"+TradeOpsIntegerString(server_time)+"}";
   string calculated_digest="";
   if(!TradeOpsSha256Hex(canonical_body,calculated_digest) || calculated_digest!=digest) return false;
   verified_server_sequence=server_sequence;
   acknowledged_event_sequence=acknowledged;
   return true;
}

#endif
