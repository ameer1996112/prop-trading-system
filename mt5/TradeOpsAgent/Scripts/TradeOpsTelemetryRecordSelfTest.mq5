#property strict
#property version   "1.000"
#property description "Offline synthetic local telemetry record tests"

#include "../Include/TradeOpsTelemetryRecord.mqh"

int tor_checks=0;
int tor_failures=0;

bool Check(const bool condition)
{
   tor_checks++;
   if(!condition)
   {
      tor_failures++;
      Print("TOV2_RECORD_FAILURE #",tor_checks);
   }
   return condition;
}

int Nibble(const ushort character)
{
   if(character>=48 && character<=57) return (int)character-48;
   if(character>=97 && character<=102) return (int)character-97+10;
   return -1;
}

bool FromHex(const string text,uchar &output[])
{
   ArrayResize(output,0);
   int length=StringLen(text);
   if((length%2)!=0) return false;
   int count=length/2;
   if(ArrayResize(output,count)!=count) return false;
   for(int index=0; index<count; index++)
   {
      int high=Nibble((ushort)StringGetCharacter(text,index*2));
      int low=Nibble((ushort)StringGetCharacter(text,index*2+1));
      if(high<0 || low<0)
      {
         ArrayResize(output,0);
         return false;
      }
      output[index]=(uchar)(high*16+low);
   }
   return true;
}

string ToHex(const uchar &bytes[])
{
   string result="";
   const string digits="0123456789abcdef";
   for(int index=0; index<ArraySize(bytes); index++)
   {
      int value=(int)bytes[index];
      result+=StringSubstr(digits,value>>4,1);
      result+=StringSubstr(digits,value&15,1);
   }
   return result;
}

bool SameBytes(const uchar &left[],const uchar &right[])
{
   int count=ArraySize(left);
   if(count!=ArraySize(right)) return false;
   for(int index=0; index<count; index++)
      if(left[index]!=right[index]) return false;
   return true;
}

bool FooterExactly(const uchar &frame[],const int offset,const string digest)
{
   string footer="\nSHA256|"+digest+"\n";
   if(offset<0 || offset+StringLen(footer)!=ArraySize(frame)) return false;
   for(int index=0; index<StringLen(footer); index++)
      if(frame[offset+index]!=(uchar)StringGetCharacter(footer,index)) return false;
   return true;
}

void Rejected(const uchar &frame[])
{
   string kind="sentinel";
   long generation=123;
   uchar decoded[];
   ArrayResize(decoded,1);
   decoded[0]=99;
   bool accepted=Tov2RecordDecode(frame,kind,generation,decoded);
   Check(!accepted);
   Check(kind=="" && generation==0 && ArraySize(decoded)==0);
}

void Golden(const string expected_kind,const string generation_text,const string payload_hex,const string digest,const int expected_size)
{
   long generation=0;
   uchar payload[];
   uchar frame[];
   uchar decoded[];
   string encoded_digest="";
   Check(Tov2CounterFromText(generation_text,1,generation));
   Check(FromHex(payload_hex,payload));
   Check(Tov2RecordEncode(expected_kind,generation,payload,frame));
   Check(ArraySize(frame)==expected_size);
   string header="TOV2R1|"+expected_kind+"|"+generation_text+"|"+IntegerToString(ArraySize(payload))+"\n";
   Check(FooterExactly(frame,StringLen(header)+ArraySize(payload),digest));
   Check(Tov2RecordDecode(frame,encoded_digest,generation,decoded));
   Check(encoded_digest==expected_kind && generation==StringToInteger(generation_text));
   Check(ToHex(decoded)==payload_hex);
   uchar repeated[];
   Check(Tov2RecordEncode(expected_kind,generation,payload,repeated) && SameBytes(frame,repeated));
}

void AppendAscii(const string text,uchar &output[])
{
   int offset=ArraySize(output);
   int length=StringLen(text);
   ArrayResize(output,offset+length);
   for(int index=0; index<length; index++)
      output[offset+index]=(uchar)StringGetCharacter(text,index);
}

void BadHeader(const string header)
{
   uchar prefix[];
   AppendAscii(header,prefix);
   int payload_offset=ArraySize(prefix);
   ArrayResize(prefix,payload_offset+1);
   prefix[payload_offset]=65;
   string digest="";
   Check(Tov2RecordHash(prefix,digest));
   uchar frame[];
   ArrayResize(frame,ArraySize(prefix));
   ArrayCopy(frame,prefix,0,0,ArraySize(prefix));
   AppendAscii("\nSHA256|"+digest+"\n",frame);
   Rejected(frame);
}

void OnStart()
{
   Golden("PENDING","1","7b7d","013de192cb5d8de0b182063e53fe6ed87e7750939c7b519e65dbb698afc02233",94);
   Golden("EVENT","9007199254740991","007cff0a","f9c3d87acdc76753a78bbf99565aa1a28dc4c55e98b9871a2a914be9c6f0c3d7",109);
   Golden("REGISTRATION","2","e282ac","6ec2d7564655f7b344c2b571d5f8470ceb6a80e0c089603b129c24a2e4e2328c",100);

   uchar payload[];
   FromHex("7b7d",payload);
   uchar frame[];
   Check(Tov2RecordEncode("PENDING",1,payload,frame));
   for(int length=0; length<ArraySize(frame); length++)
   {
      uchar truncated[];
      ArrayResize(truncated,length);
      if(length>0) ArrayCopy(truncated,frame,0,0,length);
      Rejected(truncated);
   }
   for(int index=0; index<ArraySize(frame); index++)
   {
      uchar mutated[];
      ArrayResize(mutated,ArraySize(frame));
      ArrayCopy(mutated,frame,0,0,ArraySize(frame));
      mutated[index]^=1;
      Rejected(mutated);
   }
   uchar extra[];
   ArrayResize(extra,ArraySize(frame)+1);
   ArrayCopy(extra,frame,0,0,ArraySize(frame));
   extra[ArraySize(frame)]=0;
   Rejected(extra);
   uchar concatenated[];
   ArrayResize(concatenated,ArraySize(frame)*2);
   ArrayCopy(concatenated,frame,0,0,ArraySize(frame));
   ArrayCopy(concatenated,frame,ArraySize(frame),0,ArraySize(frame));
   Rejected(concatenated);

   BadHeader("TOV2R2|EVENT|1|1\n");
   BadHeader("TOV2R1|UNKNOWN|1|1\n");
   BadHeader("TOV2R1|event|1|1\n");
   BadHeader("TOV2R1|EVENT|01|1\n");
   BadHeader("TOV2R1|EVENT|0|1\n");
   BadHeader("TOV2R1|EVENT|-1|1\n");
   BadHeader("TOV2R1|EVENT|+1|1\n");
   BadHeader("TOV2R1|EVENT|1.0|1\n");
   BadHeader("TOV2R1|EVENT|9007199254740992|1\n");
   BadHeader("TOV2R1|EVENT|1|01\n");
   BadHeader("TOV2R1|EVENT|1|0\n");
   BadHeader("TOV2R1|EVENT|1|262145\n");
   BadHeader("TOV2R1|EVENT|1|1\r\n");
   BadHeader("TOV2R1|EVENT|1|1|extra\n");
   BadHeader("TOV2R1|EVENT|1|1|\n");
   string overlong="TOV2R1|";
   for(int index=0; index<129; index++) overlong+="A";
   BadHeader(overlong+"|1|1\n");

   string kinds[5]={"REGISTRATION","EVENT","PENDING","ACK","CHECKPOINT"};
   for(int kind_index=0; kind_index<5; kind_index++)
   {
      uchar sample[];
      ArrayResize(sample,2);
      sample[0]=7;
      sample[1]=8;
      uchar sample_frame[];
      Check(Tov2RecordEncode(kinds[kind_index],7,sample,sample_frame));
      string decoded_kind="";
      long decoded_generation=0;
      uchar decoded_payload[];
      Check(Tov2RecordDecode(sample_frame,decoded_kind,decoded_generation,decoded_payload) && decoded_kind==kinds[kind_index] && decoded_generation==7 && SameBytes(sample,decoded_payload));
   }

   uchar bad_kind_frame[];
   ArrayResize(bad_kind_frame,1);
   bad_kind_frame[0]=99;
   Check(!Tov2RecordEncode("BAD",7,payload,bad_kind_frame) && ArraySize(bad_kind_frame)==0);
   uchar generation_frame[];
   ArrayResize(generation_frame,1);
   generation_frame[0]=99;
   Check(!Tov2RecordEncode("EVENT",0,payload,generation_frame) && ArraySize(generation_frame)==0);
   ArrayResize(generation_frame,1);
   generation_frame[0]=99;
   Check(!Tov2RecordEncode("EVENT",9007199254740992,payload,generation_frame) && ArraySize(generation_frame)==0);
   uchar empty_payload[];
   ArrayResize(generation_frame,1);
   generation_frame[0]=99;
   Check(!Tov2RecordEncode("EVENT",7,empty_payload,generation_frame) && ArraySize(generation_frame)==0);
   uchar max_payload[];
   ArrayResize(max_payload,262144);
   ArrayInitialize(max_payload,255);
   Check(Tov2RecordEncode("EVENT",7,max_payload,generation_frame));
   string max_kind="";
   long max_generation=0;
   uchar decoded_max[];
   Check(Tov2RecordDecode(generation_frame,max_kind,max_generation,decoded_max) && max_kind=="EVENT" && max_generation==7 && SameBytes(max_payload,decoded_max));
   uchar oversized[];
   ArrayResize(oversized,262145);
   ArrayResize(generation_frame,1);
   generation_frame[0]=99;
   Check(!Tov2RecordEncode("EVENT",7,oversized,generation_frame) && ArraySize(generation_frame)==0);
   uchar overlong_frame[];
   ArrayResize(overlong_frame,262346);
   ArrayInitialize(overlong_frame,65);
   Rejected(overlong_frame);

   if(tor_failures==0) Print("TOV2_RECORD_PASS checks=",tor_checks," failures=0");
   else Print("TOV2_RECORD_FAIL checks=",tor_checks," failures=",tor_failures);
}
