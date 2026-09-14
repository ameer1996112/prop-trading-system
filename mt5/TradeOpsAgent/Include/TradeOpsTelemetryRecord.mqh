#ifndef TRADEOPS_TELEMETRY_RECORD_MQH
#define TRADEOPS_TELEMETRY_RECORD_MQH

const int TOV2_RECORD_PAYLOAD_MAX=262144;
const int TOV2_RECORD_HEADER_MAX=128;
const int TOV2_RECORD_FOOTER_SIZE=73;
const int TOV2_RECORD_FRAME_MAX=262345;

#include "TradeOpsTelemetryValues.mqh"

bool Tov2RecordKind(const string kind)
{
   return kind=="REGISTRATION" || kind=="EVENT" || kind=="PENDING" || kind=="ACK" || kind=="CHECKPOINT";
}

bool Tov2RecordHash(const uchar &bytes[],string &hex)
{
   hex="";
   int count=ArraySize(bytes);
   if(count<1 || count>TOV2_RECORD_PAYLOAD_MAX+TOV2_RECORD_HEADER_MAX) return false;
   uchar key[];
   uchar digest[];
   string candidate="";
   if(CryptEncode(CRYPT_HASH_SHA256,bytes,key,digest)==32 && ArraySize(digest)==32)
   {
      for(int index=0; index<32; index++)
         candidate+=StringFormat("%02x",digest[index]);
   }
   else
   {
      return false;
   }
   if(StringLen(candidate)!=64) return false;
   hex=candidate;
   return true;
}

bool Tov2RecordEncode(const string kind,const long generation,const uchar &payload[],uchar &frame[])
{
   ArrayResize(frame,0);
   if(!Tov2RecordKind(kind) || !Tov2Counter(generation,1)) return false;
   int payload_count=ArraySize(payload);
   if(payload_count<1 || payload_count>TOV2_RECORD_PAYLOAD_MAX) return false;

   string generation_text=StringFormat("%I64d",generation);
   string header="TOV2R1|"+kind+"|"+generation_text+"|"+IntegerToString(payload_count)+"\n";
   int header_count=StringLen(header);
   if(header_count<1 || header_count>TOV2_RECORD_HEADER_MAX) return false;
   int prefix_count=header_count+payload_count;
   uchar prefix[];
   if(ArrayResize(prefix,prefix_count)!=prefix_count)
   {
      ArrayResize(frame,0);
      return false;
   }
   for(int index=0; index<header_count; index++)
      prefix[index]=(uchar)StringGetCharacter(header,index);
   if(ArrayCopy(prefix,payload,header_count,0,payload_count)!=payload_count)
   {
      ArrayResize(frame,0);
      return false;
   }

   string digest="";
   if(!Tov2RecordHash(prefix,digest))
   {
      ArrayResize(frame,0);
      return false;
   }
   string footer="\nSHA256|"+digest+"\n";
   if(StringLen(footer)!=TOV2_RECORD_FOOTER_SIZE || prefix_count+TOV2_RECORD_FOOTER_SIZE>TOV2_RECORD_FRAME_MAX)
   {
      ArrayResize(frame,0);
      return false;
   }
   int frame_count=prefix_count+TOV2_RECORD_FOOTER_SIZE;
   if(ArrayResize(frame,frame_count)!=frame_count || ArrayCopy(frame,prefix,0,0,prefix_count)!=prefix_count)
   {
      ArrayResize(frame,0);
      return false;
   }
   for(int index=0; index<StringLen(footer); index++)
      frame[prefix_count+index]=(uchar)StringGetCharacter(footer,index);
   return true;
}

void Tov2RecordClearDecode(string &kind,long &generation,uchar &payload[])
{
   kind="";
   generation=0;
   ArrayResize(payload,0);
}

// Callers provide distinct dynamic, non-series one-dimensional arrays; outputs stay clear on failure.
bool Tov2RecordDecode(const uchar &frame[],string &kind,long &generation,uchar &payload[])
{
   Tov2RecordClearDecode(kind,generation,payload);
   int total=ArraySize(frame);
   if(total<TOV2_RECORD_FOOTER_SIZE+2 || total>TOV2_RECORD_FRAME_MAX) return false;

   int scan_limit=total<TOV2_RECORD_HEADER_MAX ? total : TOV2_RECORD_HEADER_MAX;
   int header_end=-1;
   for(int index=0; index<scan_limit; index++)
   {
      uchar value=frame[index];
      if(value==10)
      {
         header_end=index;
         break;
      }
      if(value<32 || value>126) return false;
   }
   if(header_end<1) return false;

   string header="";
   if(!StringInit(header,header_end,32) || StringLen(header)!=header_end) return false;
   for(int index=0; index<header_end; index++)
      if(!StringSetCharacter(header,index,(ushort)frame[index])) return false;
   string parts[];
   if(StringSplit(header,(ushort)124,parts)!=4) return false;
   if(parts[0]!="TOV2R1" || !Tov2RecordKind(parts[1])) return false;

   long parsed_generation=0;
   long parsed_size=0;
   if(!Tov2CounterFromText(parts[2],1,parsed_generation)) return false;
   if(!Tov2CounterFromText(parts[3],1,parsed_size)) return false;
   if(parsed_size>TOV2_RECORD_PAYLOAD_MAX) return false;
   int payload_count=(int)parsed_size;

   string canonical_header="TOV2R1|"+parts[1]+"|"+StringFormat("%I64d",parsed_generation)+"|"+IntegerToString(payload_count);
   if(canonical_header!=header) return false;
   int prefix_count=header_end+1+payload_count;
   if(prefix_count<1 || total!=prefix_count+TOV2_RECORD_FOOTER_SIZE) return false;

   string footer_prefix="\nSHA256|";
   for(int index=0; index<StringLen(footer_prefix); index++)
      if(frame[prefix_count+index]!=(uchar)StringGetCharacter(footer_prefix,index)) return false;
   if(frame[total-1]!=10) return false;

   string footer_digest="";
   for(int index=0; index<64; index++)
   {
      uchar value=frame[prefix_count+StringLen(footer_prefix)+index];
      bool digit=(value>=48 && value<=57);
      bool lower=(value>=97 && value<=102);
      if(!digit && !lower) return false;
      footer_digest+=StringFormat("%c",value);
   }

   uchar prefix[];
   if(ArrayResize(prefix,prefix_count)!=prefix_count || ArrayCopy(prefix,frame,0,0,prefix_count)!=prefix_count)
   {
      Tov2RecordClearDecode(kind,generation,payload);
      return false;
   }
   string expected_digest="";
   if(!Tov2RecordHash(prefix,expected_digest) || expected_digest!=footer_digest)
   {
      Tov2RecordClearDecode(kind,generation,payload);
      return false;
   }
   if(ArrayResize(payload,payload_count)!=payload_count || ArrayCopy(payload,frame,0,header_end+1,payload_count)!=payload_count)
   {
      Tov2RecordClearDecode(kind,generation,payload);
      return false;
   }
   kind=parts[1];
   generation=parsed_generation;
   return true;
}

#endif
