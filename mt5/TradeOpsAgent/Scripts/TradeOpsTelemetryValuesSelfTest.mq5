#property strict
#property version "1.000"
#property description "Offline synthetic telemetry value contract tests"

#include "../Include/TradeOpsTelemetryValues.mqh"

int tov2_checks=0;
int tov2_failures=0;

void Check(const bool condition,const string label)
{
   tov2_checks++;
   if(!condition)
   {
      tov2_failures++;
      Print("TOV2_VALUES_FAILURE ",label," #",tov2_checks);
   }
}

void CheckFixed(const string value,const int scale,const bool expected)
{
   bool text_ok=Tov2FixedText(value,scale);
   Check(text_ok==expected,"fixed-text");

   string expected_json="";
   if(expected)
      expected_json="{\"scale\":"+IntegerToString(scale)+",\"value\":\""+value+"\"}";

   string json="sentinel";
   bool json_ok=Tov2FixedJson(value,scale,json);
   Check(json_ok==expected && json==(expected?expected_json:""),"fixed-json");

   string known="sentinel";
   bool known_ok=Tov2KnownReading(value,scale,known);
   string expected_known="";
   if(expected)
      expected_known="{\"reason\":null,\"value\":"+expected_json+"}";
   Check(known_ok==expected && known==(expected?expected_known:""),"fixed-known");
}

void CheckTicket(const string value,const bool expected)
{
   Check(Tov2Ticket(value)==expected,"ticket");
}

void CheckCounter(const string value,const long minimum,const bool expected)
{
   long result=123;
   bool actual=Tov2CounterFromText(value,minimum,result);
   Check(actual==expected,"counter");
   if(expected)
      Check(IntegerToString(result)==value,"counter-value");
   else
      Check(result==0,"counter-cleared");
}

void CheckIdentifier(const string value,const bool expected)
{
   Check(Tov2Identifier(value)==expected,"identifier");
}

void CheckDigest(const string value,const bool expected)
{
   Check(Tov2Digest(value)==expected,"digest");
}

void CheckMissing(const string reason,const bool expected)
{
   string result="sentinel";
   bool actual=Tov2MissingReading(reason,result);
   string expected_json="";
   if(expected)
      expected_json="{\"reason\":\""+reason+"\",\"value\":null}";
   Check(actual==expected && result==(expected?expected_json:""),"missing");
}

void CheckDouble(const double value,const int scale,const string expected_json)
{
   string result="sentinel";
   bool actual=Tov2FixedFromDouble(value,scale,result);
   bool expected=(expected_json!="");
   Check(actual==expected && result==(expected?expected_json:""),"double");
}

void OnStart()
{
   CheckFixed("0",0,true);
   CheckFixed("-1",0,true);
   CheckFixed("10.00",2,true);
   CheckFixed("-9.75",2,true);
   CheckFixed("0.0000000000000000",16,true);
   CheckFixed("-0.0000000000000001",16,true);
   CheckFixed("9007199254740993.01",2,true);
   CheckFixed("999999999999999999",0,true);
   CheckFixed("-999999999999999999.1234567890123456",16,true);
   CheckFixed("",0,false);
   CheckFixed("-0",0,false);
   CheckFixed("-0.00",2,false);
   CheckFixed("01.00",2,false);
   CheckFixed("+1.00",2,false);
   CheckFixed("1e3",0,false);
   CheckFixed("1.",0,false);
   CheckFixed(".1",1,false);
   CheckFixed("1.0",0,false);
   CheckFixed("1",2,false);
   CheckFixed("1.000",2,false);
   CheckFixed("1.0.0",3,false);
   CheckFixed(" 1",0,false);
   CheckFixed("1\n",0,false);
   CheckFixed("1000000000000000000",0,false);
   CheckFixed("1",-1,false);
   CheckFixed("1.00000000000000000",17,false);

   CheckTicket("1",true);
   CheckTicket("9007199254740993",true);
   CheckTicket("18446744073709551615",true);
   CheckTicket("18446744073709551616",false);
   CheckTicket("0",false);
   CheckTicket("01",false);
   CheckTicket("-1",false);
   CheckTicket("1.0",false);
   CheckTicket("1e3",false);
   CheckTicket("",false);
   CheckTicket("1\n",false);

   CheckCounter("0",0,true);
   CheckCounter("1",1,true);
   CheckCounter("9007199254740991",0,true);
   CheckCounter("9007199254740992",0,false);
   CheckCounter("0",1,false);
   CheckCounter("00",0,false);
   CheckCounter("+1",0,false);
   CheckCounter("-1",0,false);
   CheckCounter("1.0",0,false);
   CheckCounter("",0,false);
   CheckCounter("1\n",0,false);

   CheckIdentifier("account:demo_1.a-b",true);
   CheckIdentifier("",false);
   CheckIdentifier("a b",false);
   CheckIdentifier("a/b",false);
   CheckIdentifier("a\\b",false);
   CheckIdentifier("a\n",false);

   CheckDigest("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",true);
   CheckDigest("0000000000000000000000000000000000000000000000000000000000000001",true);
   CheckDigest("0000000000000000000000000000000000000000000000000000000000000000",false);
   CheckDigest("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",false);
   CheckDigest("a",false);

   CheckMissing("READ_FAILED",true);
   CheckMissing("NOT_APPLICABLE",true);
   CheckMissing("NOT_SET",true);
   CheckMissing("UNAVAILABLE",true);
   CheckMissing("",false);
   CheckMissing("UNKNOWN",false);
   CheckMissing("READ_FAILED\n",false);

   CheckDouble(1.25,2,"{\"scale\":2,\"value\":\"1.25\"}");
   CheckDouble(-9.75,2,"{\"scale\":2,\"value\":\"-9.75\"}");
   CheckDouble(-0.0001,2,"{\"scale\":2,\"value\":\"0.00\"}");
   CheckDouble(1.0,16,"{\"scale\":16,\"value\":\"1.0000000000000000\"}");
   CheckDouble(1.0,-1,"");
   CheckDouble(1.0,17,"");
   CheckDouble(1.0e20,2,"");
   CheckDouble(MathArcsin(2.0),2,"");

   Check(!Tov2Counter(-1),"counter-negative");
   Check(!Tov2Counter(9007199254740992),"counter-overflow");
   Check(!Tov2Counter(1,-1),"counter-minimum");
   string long_id="";
   for(int i=0;i<160;i++) long_id+="a";
   Check(Tov2Identifier(long_id),"160 character identifier");
   Check(!Tov2Identifier(long_id+"a"),"161 character identifier");
   Check(!Tov2Identifier(ShortToString(0x20ac)),"identifier-euro");

   ulong largest=~(ulong)0;
   string ticket_result="sentinel";
   Check(Tov2TicketFromUlong(largest,ticket_result) && ticket_result=="18446744073709551615","ticket-largest");
   ticket_result="sentinel";
   Check(Tov2TicketFromUlong((ulong)1,ticket_result) && ticket_result=="1","ticket-one");
   ticket_result="sentinel";
   Check(!Tov2TicketFromUlong((ulong)0,ticket_result) && ticket_result=="","ticket-zero");

   Print(tov2_failures==0?"TOV2_VALUES_PASS":"TOV2_VALUES_FAIL"," checks=",tov2_checks," failures=",tov2_failures);
}
