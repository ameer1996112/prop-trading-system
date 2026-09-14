#ifndef TRADEOPS_TELEMETRY_VALUES_MQH
#define TRADEOPS_TELEMETRY_VALUES_MQH

bool Tov2Digits(const string text,const int start,const int count)
{
   int length=StringLen(text);
   if(start<0 || count<1 || start>length || count>length-start) return false;
   for(int index=start; index<start+count; index++)
   {
      ushort character=(ushort)StringGetCharacter(text,index);
      if(character<48 || character>57) return false;
   }
   return true;
}

bool Tov2Counter(const long value,const long minimum=0)
{
   const long maximum=9007199254740991;
   if(minimum<0 || minimum>maximum) return false;
   return value>=minimum && value<=maximum;
}

bool Tov2CounterFromText(const string text,const long minimum,long &result)
{
   result=0;
   int length=StringLen(text);
   if(length<1 || length>16) return false;
   if(!Tov2Digits(text,0,length)) return false;
   if(length>1 && StringGetCharacter(text,0)==48) return false;
   if(length==16 && StringCompare(text,"9007199254740991")>0) return false;
   long parsed=StringToInteger(text);
   if(!Tov2Counter(parsed,minimum)) return false;
   result=parsed;
   return true;
}

bool Tov2Identifier(const string value)
{
   int length=StringLen(value);
   if(length<1 || length>160) return false;
   for(int index=0; index<length; index++)
   {
      ushort character=(ushort)StringGetCharacter(value,index);
      bool upper=(character>=65 && character<=90);
      bool lower=(character>=97 && character<=122);
      bool digit=(character>=48 && character<=57);
      bool punctuation=(character==46 || character==95 || character==58 || character==45);
      if(!upper && !lower && !digit && !punctuation) return false;
   }
   return true;
}

bool Tov2Digest(const string value)
{
   if(StringLen(value)!=64) return false;
   bool all_zero=true;
   for(int index=0; index<64; index++)
   {
      ushort character=(ushort)StringGetCharacter(value,index);
      bool digit=(character>=48 && character<=57);
      bool lower=(character>=97 && character<=102);
      if(!digit && !lower) return false;
      if(character!='0') all_zero=false;
   }
   return !all_zero;
}

bool Tov2Ticket(const string value)
{
   int length=StringLen(value);
   if(length<1 || length>20) return false;
   ushort first=(ushort)StringGetCharacter(value,0);
   if(first<49 || first>57) return false;
   if(length>1 && !Tov2Digits(value,1,length-1)) return false;
   if(length==20 && StringCompare(value,"18446744073709551615")>0) return false;
   return true;
}

bool Tov2TicketFromUlong(const ulong value,string &result)
{
   result="";
   if(value==0) return false;
   string candidate=StringFormat("%I64u",value);
   if(!Tov2Ticket(candidate)) return false;
   result=candidate;
   return true;
}

bool Tov2ZeroDigits(const string value)
{
   bool found=false;
   for(int index=0; index<StringLen(value); index++)
   {
      ushort character=(ushort)StringGetCharacter(value,index);
      if(index==0 && character==45) continue;
      if(character==46) continue;
      if(character<48 || character>57) return false;
      found=true;
      if(character!=48) return false;
   }
   return found;
}

bool Tov2FixedText(const string value,const int scale)
{
   int length=StringLen(value);
   if(scale<0 || scale>16 || length<1 || length>36) return false;

   int cursor=0;
   bool negative=(StringGetCharacter(value,0)==45);
   if(negative) cursor=1;
   if(cursor>=length) return false;

   int integer_start=cursor;
   while(cursor<length && StringGetCharacter(value,cursor)!=46) cursor++;
   int integer_count=cursor-integer_start;
   if(integer_count<1 || integer_count>18) return false;
   if(!Tov2Digits(value,integer_start,integer_count)) return false;
   if(integer_count>1 && StringGetCharacter(value,integer_start)==48) return false;

   if(scale==0)
   {
      if(cursor!=length) return false;
   }
   else
   {
      if(cursor>=length || StringGetCharacter(value,cursor)!=46) return false;
      int fraction_start=cursor+1;
      if(fraction_start+scale!=length) return false;
      if(!Tov2Digits(value,fraction_start,scale)) return false;
   }

   if(negative && Tov2ZeroDigits(value)) return false;
   return true;
}

bool Tov2FixedJson(const string value,const int scale,string &result)
{
   result="";
   if(!Tov2FixedText(value,scale)) return false;
   result="{\"scale\":"+IntegerToString(scale)+",\"value\":\""+value+"\"}";
   return true;
}

bool Tov2FixedFromDouble(const double value,const int scale,string &result)
{
   result="";
   if(scale<0 || scale>16) return false;
   if(!MathIsValidNumber(value)) return false;
   string text=DoubleToString(value,scale);
   if(StringLen(text)>0 && StringGetCharacter(text,0)==45 && Tov2ZeroDigits(text))
      text=StringSubstr(text,1);
   return Tov2FixedJson(text,scale,result);
}

bool Tov2KnownReading(const string value,const int scale,string &result)
{
   result="";
   string fixed_json="";
   if(!Tov2FixedJson(value,scale,fixed_json)) return false;
   result="{\"reason\":null,\"value\":"+fixed_json+"}";
   return true;
}

bool Tov2MissingReading(const string reason,string &result)
{
   result="";
   if(reason!="READ_FAILED" && reason!="NOT_APPLICABLE" && reason!="NOT_SET" && reason!="UNAVAILABLE") return false;
   result="{\"reason\":\""+reason+"\",\"value\":null}";
   return true;
}

#endif
