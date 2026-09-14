#ifndef TRADEOPS_TELEMETRY_SYNTHETIC_OUTBOX_MQH
#define TRADEOPS_TELEMETRY_SYNTHETIC_OUTBOX_MQH
#include "../../Include/TradeOpsTelemetryState.mqh"
#include "../../Include/TradeOpsTelemetryOutboxContract.mqh"

// Offline fixture format only. This is not the production HTTP protocol.
string Tov2SyntheticRepeat(const string text,const int count)
{
   string result="";
   for(int i=0;i<count;i++) result+=text;
   return result;
}

string Tov2SyntheticIdentity()
{
   return "account.demo~install.demo~tracking.demo~1~"+
          Tov2SyntheticRepeat("d",64)+"~"+Tov2SyntheticRepeat("e",64)+"~"+
          Tov2SyntheticRepeat("f",64);
}

string Tov2SyntheticHex(const uchar &bytes[])
{
   string result="";
   int n=ArraySize(bytes);
   if(n<1 || n>TOV2_RECORD_PAYLOAD_MAX || !StringInit(result,2*n,48)) return "";
   string digits="0123456789abcdef";
   for(int i=0;i<n;i++)
      if(!StringSetCharacter(result,2*i,StringGetCharacter(digits,bytes[i]/16)) ||
         !StringSetCharacter(result,2*i+1,StringGetCharacter(digits,bytes[i]%16))) return "";
   return result;
}

bool Tov2SyntheticUnhex(const string text,uchar &bytes[])
{
   ArrayResize(bytes,0);
   int n=StringLen(text);
   if(n<2 || n%2!=0 || n>2*TOV2_RECORD_PAYLOAD_MAX) return false;
   if(ArrayResize(bytes,n/2)!=n/2) return false;
   string digits="0123456789abcdef";
   for(int i=0;i<n;i+=2)
   {
      int high=StringFind(digits,StringSubstr(text,i,1));
      int low=StringFind(digits,StringSubstr(text,i+1,1));
      if(high<0 || low<0) { ArrayResize(bytes,0); return false; }
      bytes[i/2]=(uchar)(16*high+low);
   }
   return true;
}

bool Tov2SyntheticHashText(const string text,string &sha)
{
   uchar bytes[];
   return Tov2LocalBytes(text,bytes) && Tov2LocalHash(bytes,sha);
}

bool Tov2SyntheticEvent(const uchar &payload[],const string identity,
                         const Tov2LocalRef &reference)
{
   string text="",sha="",fields[];
   long revision=0;
   return Tov2LocalText(payload,text) &&
          StringSplit(text,124,fields)==6 && fields[0]=="EV2" &&
          fields[1]==identity && fields[2]==reference.event_id &&
          fields[3]==reference.deal_id && fields[5]!="" &&
          Tov2CounterFromText(fields[4],0,revision) && revision==reference.revision &&
          Tov2LocalHash(payload,sha) && sha==reference.record_sha;
}

string Tov2SyntheticEventRow(const Tov2LocalRef &reference,const uchar &payload[])
{
   return Tov2LocalNumber(reference.sequence)+"|"+reference.event_id+"|"+
          reference.deal_id+"|"+Tov2LocalNumber(reference.revision)+"|"+
          reference.record_sha+"|"+Tov2SyntheticHex(payload);
}

bool Tov2SyntheticPending(const uchar &payload[],const Tov2LocalState &state)
{
   string text="",fields[],body="",sha="",rows="",coverage="";
   long envelope=0,request=0,prior=0,final_event=0,count=0,produced=0;
   if(!Tov2LocalText(payload,text) || StringSplit(text,10,fields)<14 ||
      fields[0]!="SYNTHETIC2" || !Tov2CounterFromText(fields[1],1,envelope) ||
      fields[3]!="BODY2" || fields[4]!=state.identity ||
      fields[5]!=state.registration.sha ||
      !Tov2CounterFromText(fields[6],1,request) || request!=state.pending_request ||
      !Tov2CounterFromText(fields[7],0,prior) || prior!=state.pending_prior ||
      !Tov2CounterFromText(fields[8],0,final_event) || final_event!=state.pending_final ||
      !Tov2CounterFromText(fields[9],0,count) || count!=state.pending_count ||
      !Tov2CounterFromText(fields[10],0,produced) || produced!=state.pending_produced ||
      produced>state.produced || produced<final_event ||
      fields[11]!="DRY_RUN" || fields[12]!="null" ||
      !Tov2Digest(fields[13]) || ArraySize(fields)!=14+(int)count ||
      state.pending.kind!="PENDING" || state.pending.ordinal!=1 ||
      state.pending.sequence!=request) return false;
   for(int i=3;i<ArraySize(fields);i++) body+=(i==3 ? "" : "\n")+fields[i];
   if(!Tov2SyntheticHashText(body,sha) || sha!=fields[2] || sha!=state.pending_body)
      return false;
   for(int i=0;i<(int)count;i++)
   {
      string row[];
      uchar event_bytes[];
      if(StringSplit(fields[14+i],124,row)!=6 ||
         !Tov2SyntheticUnhex(row[5],event_bytes) ||
         !Tov2SyntheticEvent(event_bytes,state.identity,state.events[i]) ||
         fields[14+i]!=Tov2SyntheticEventRow(state.events[i],event_bytes)) return false;
      rows+="\n"+fields[14+i];
   }
   return Tov2SyntheticHashText("COVERAGE2|"+fields[7]+"|"+fields[8]+"|"+fields[9]+rows,
                                coverage) && coverage==fields[13];
}

bool Tov2SyntheticAcceptance(const uchar &response[],Tov2OutboxAcceptance &accepted,
                              string &coverage)
{
   Tov2OutboxClearAcceptance(accepted); coverage="";
   string text="",fields[],prefix="",sha="",installation="";
   if(ArraySize(response)>TOV2_OUTBOX_RESPONSE_MAX || !Tov2LocalText(response,text) ||
      StringSplit(text,10,fields)!=12 || fields[0]!="ACK2" ||
      !Tov2LocalIdentity(fields[1],installation) || !Tov2Digest(fields[2]) ||
      !Tov2CounterFromText(fields[3],1,accepted.request_sequence) ||
      !Tov2Digest(fields[4]) || !Tov2Digest(fields[5]) ||
      !Tov2CounterFromText(fields[6],0,accepted.final_event) ||
      !Tov2CounterFromText(fields[7],1,accepted.accepted_at) ||
      fields[8]!="DRY_RUN" || fields[9]!="null" || !Tov2Digest(fields[10])) return false;
   for(int i=0;i<11;i++) prefix+=(i==0 ? "" : "\n")+fields[i];
   if(!Tov2SyntheticHashText(prefix,sha) || sha!=fields[11]) return false;
   accepted.identity=fields[1]; accepted.registration_sha=fields[2];
   accepted.body_sha=fields[4]; accepted.pending_sha=fields[5];
   coverage=fields[10];
   return true;
}

class CTov2SyntheticOutboxAdapter : public ITov2TelemetryOutboxAdapter
{
public:
   int build_calls;
   int build_result;
   long envelope;

   CTov2SyntheticOutboxAdapter()
   {
      build_calls=0; build_result=TOV2_OUTBOX_BUILD_OK; envelope=1;
   }

   int Build(const Tov2OutboxContext &context,const uchar &registration[],
             const uchar &event_arena[],const int &event_ends[],const int prefix_count,
             Tov2OutboxCandidate &candidate,uchar &request[])
   {
      build_calls++;
      ArrayResize(request,0); Tov2OutboxClearCandidate(candidate);
      if(build_result!=TOV2_OUTBOX_BUILD_OK) return build_result;
      if(prefix_count<0 || prefix_count>TOV2_LOCAL_BATCH ||
         prefix_count>context.state.event_count || ArraySize(event_ends)<prefix_count ||
         context.state.accepted_request>=TOV2_LOCAL_MAX_COUNTER)
         return TOV2_OUTBOX_BUILD_INVALID;
      string rows="";
      int previous=0;
      for(int i=0;i<prefix_count;i++)
      {
         int size=event_ends[i]-previous;
         uchar bytes[];
         if(size<1 || event_ends[i]>ArraySize(event_arena) ||
            ArrayResize(bytes,size)!=size ||
            ArrayCopy(bytes,event_arena,0,previous,size)!=size)
            return TOV2_OUTBOX_BUILD_INVALID;
         string row=Tov2SyntheticEventRow(context.state.events[i],bytes);
         if(StringLen(rows)+1+StringLen(row)>TOV2_RECORD_PAYLOAD_MAX)
            return TOV2_OUTBOX_BUILD_SIZE_LIMIT;
         rows+="\n"+row;
         previous=event_ends[i];
      }
      string prior=Tov2LocalNumber(context.state.accepted_event);
      string final_event=Tov2LocalNumber(context.state.accepted_event+prefix_count);
      string count=IntegerToString(prefix_count),coverage="";
      string coverage_text="COVERAGE2|"+prior+"|"+final_event+"|"+count+rows;
      if(StringLen(coverage_text)>TOV2_RECORD_PAYLOAD_MAX)
         return TOV2_OUTBOX_BUILD_SIZE_LIMIT;
      if(!Tov2SyntheticHashText(coverage_text,coverage)) return TOV2_OUTBOX_BUILD_INVALID;
      string body="BODY2\n"+context.state.identity+"\n"+context.state.registration.sha+"\n"+
         Tov2LocalNumber(context.state.accepted_request+1)+"\n"+prior+"\n"+
         final_event+"\n"+count+"\n"+Tov2LocalNumber(context.state.produced)+
         "\nDRY_RUN\nnull\n"+coverage+rows;
      string sha="";
      int encoded=StringLen("SYNTHETIC2\n"+Tov2LocalNumber(envelope)+"\n")+65+StringLen(body);
      if(encoded>TOV2_RECORD_PAYLOAD_MAX) return TOV2_OUTBOX_BUILD_SIZE_LIMIT;
      if(!Tov2SyntheticHashText(body,sha) ||
         !Tov2LocalBytes("SYNTHETIC2\n"+Tov2LocalNumber(envelope)+"\n"+sha+"\n"+body,request))
         return TOV2_OUTBOX_BUILD_INVALID;
      candidate.expected_generation=context.state.generation;
      candidate.expected_root_sha=context.root_sha;
      candidate.registration_sha=context.state.registration.sha;
      candidate.request_sequence=context.state.accepted_request+1;
      candidate.body_sha=sha; candidate.prefix_count=prefix_count;
      candidate.frozen_produced=context.state.produced;
      return TOV2_OUTBOX_BUILD_OK;
   }

   bool ValidateRequest(const Tov2OutboxContext &context,const uchar &registration[],
                        const uchar &event_arena[],const int &event_ends[],
                        const Tov2OutboxCandidate &candidate,const uchar &request[])
   {
      Tov2LocalState pending_state=context.state;
      pending_state.pending.kind="PENDING"; pending_state.pending.ordinal=1;
      pending_state.pending.sequence=candidate.request_sequence;
      pending_state.pending_request=candidate.request_sequence;
      pending_state.pending_body=candidate.body_sha;
      pending_state.pending_count=candidate.prefix_count;
      pending_state.pending_prior=context.state.accepted_event;
      pending_state.pending_final=context.state.accepted_event+candidate.prefix_count;
      pending_state.pending_produced=candidate.frozen_produced;
      if(!Tov2SyntheticPending(request,pending_state)) return false;
      uchar registration_frame[]; string registration_sha="";
      if(!Tov2RecordEncode("REGISTRATION",1,registration,registration_frame) ||
         !Tov2LocalHash(registration_frame,registration_sha) ||
         registration_sha!=context.state.registration.sha) return false;
      string text="",fields[];
      if(!Tov2LocalText(request,text) || StringSplit(text,10,fields)<14) return false;
      int previous=0;
      for(int i=0;i<candidate.prefix_count;i++)
      {
         if(i>=ArraySize(event_ends)) return false;
         int size=event_ends[i]-previous;
         uchar event_bytes[];
         if(size<1 || event_ends[i]>ArraySize(event_arena) ||
            ArrayResize(event_bytes,size)!=size ||
            ArrayCopy(event_bytes,event_arena,0,previous,size)!=size ||
            fields[14+i]!=Tov2SyntheticEventRow(context.state.events[i],event_bytes)) return false;
         previous=event_ends[i];
      }
      return true;
   }

   bool ValidateResponse(const Tov2LocalState &state,const uchar &pending[],
                         const uchar &response[],Tov2OutboxAcceptance &accepted)
   {
      string coverage="",text="",fields[];
      return Tov2SyntheticPending(pending,state) &&
         Tov2SyntheticAcceptance(response,accepted,coverage) &&
         Tov2LocalText(pending,text) && StringSplit(text,10,fields)>=14 &&
         coverage==fields[13] && accepted.identity==state.identity &&
         accepted.registration_sha==state.registration.sha &&
         accepted.request_sequence==state.pending_request &&
         accepted.body_sha==state.pending_body && accepted.pending_sha==state.pending.sha &&
         accepted.final_event==state.pending_final;
   }

   bool Response(const Tov2LocalState &state,const uchar &pending[],uchar &response[],
                 const long accepted_at=123456)
   {
      ArrayResize(response,0);
      string text="",fields[],sha="";
      if(!Tov2SyntheticPending(pending,state) || !Tov2LocalText(pending,text) ||
         StringSplit(text,10,fields)<14) return false;
      string prefix="ACK2\n"+state.identity+"\n"+state.registration.sha+"\n"+
         Tov2LocalNumber(state.pending_request)+"\n"+state.pending_body+"\n"+
         state.pending.sha+"\n"+Tov2LocalNumber(state.pending_final)+"\n"+
         Tov2LocalNumber(accepted_at)+"\nDRY_RUN\nnull\n"+fields[13];
      return Tov2SyntheticHashText(prefix,sha) && Tov2LocalBytes(prefix+"\n"+sha,response);
   }

   bool Rejection(const Tov2LocalState &state,uchar &rejection[])
   {
      string prefix="REJECT2\n"+state.identity+"\n"+state.registration.sha+"\n"+
         Tov2LocalNumber(state.pending_request)+"\n"+state.pending_body+"\n"+
         state.pending.sha+"\nENVELOPE_EXPIRED";
      string sha="";
      return Tov2SyntheticHashText(prefix,sha) && Tov2LocalBytes(prefix+"\n"+sha,rejection);
   }

   bool Renew(const uchar &pending[],const long new_envelope,uchar &replacement[])
   {
      ArrayResize(replacement,0);
      string text="",fields[];
      if(!Tov2Counter(new_envelope,1) || !Tov2LocalText(pending,text) ||
         StringSplit(text,10,fields)<14) return false;
      string renewed="SYNTHETIC2\n"+Tov2LocalNumber(new_envelope);
      for(int i=2;i<ArraySize(fields);i++) renewed+="\n"+fields[i];
      return Tov2LocalBytes(renewed,replacement);
   }

   bool ValidateReplacement(const Tov2LocalState &state,const uchar &pending[],
                     const uchar &rejection[],const uchar &replacement[],
                     const string replacement_body_sha)
   {
      uchar proof[];
      string old_text="",new_text="",old_fields[],new_fields[];
      if(replacement_body_sha!=state.pending_body ||
         !Rejection(state,proof) || !Tov2LocalEqual(proof,rejection) ||
         !Tov2SyntheticPending(pending,state) || !Tov2SyntheticPending(replacement,state) ||
         !Tov2LocalText(pending,old_text) || !Tov2LocalText(replacement,new_text) ||
         StringSplit(old_text,10,old_fields)!=StringSplit(new_text,10,new_fields) ||
         ArraySize(old_fields)<14) return false;
      long old_envelope=0,new_envelope=0;
      if(!Tov2CounterFromText(old_fields[1],1,old_envelope) ||
         !Tov2CounterFromText(new_fields[1],1,new_envelope) || new_envelope<=old_envelope)
         return false;
      for(int i=2;i<ArraySize(old_fields);i++)
         if(old_fields[i]!=new_fields[i]) return false;
      return true;
   }
};

class CTov2SyntheticOutboxPayloadValidator : public ITov2TelemetryStatePayloadValidator
{
public:
   bool Registration(const uchar &payload[],const string identity)
   {
      uchar expected[];
      return Tov2LocalBytes("REG2|"+identity,expected) && Tov2LocalEqual(payload,expected);
   }
   bool Capture(const uchar &payload[],const string schema,const string identity)
   {
      string text="";
      return schema=="synthetic.capture.2" && Tov2LocalText(payload,text) &&
             StringFind(text,"CAP2|"+identity+"|")==0;
   }
   bool CaptureAdvance(const uchar &previous[],const string previous_schema,
                       const uchar &candidate[],const string candidate_schema,
                       const string identity)
   {
      return Capture(previous,previous_schema,identity) && Capture(candidate,candidate_schema,identity);
   }
   bool Event(const uchar &payload[],const string event_id,const string record_sha,
              const string deal_id,const long revision,const string identity)
   {
      Tov2LocalRef reference;
      Tov2LocalClearRef(reference);
      reference.event_id=event_id; reference.record_sha=record_sha;
      reference.deal_id=deal_id; reference.revision=revision;
      return Tov2SyntheticEvent(payload,identity,reference);
   }
   bool Pending(const uchar &payload[],const Tov2LocalState &state,const string identity)
   {
      return identity==state.identity && Tov2SyntheticPending(payload,state);
   }
   bool Ack(const uchar &payload[],const Tov2LocalState &state,const string identity)
   {
      Tov2OutboxAcceptance accepted; string coverage="";
      return Tov2SyntheticAcceptance(payload,accepted,coverage) &&
         state.ack.kind=="ACK" && state.ack.ordinal==2 &&
         accepted.identity==identity && accepted.identity==state.identity &&
         accepted.registration_sha==state.registration.sha &&
         accepted.request_sequence==state.ack_request && state.ack.sequence==state.ack_request &&
         accepted.request_sequence==state.accepted_request &&
         accepted.body_sha==state.ack_body && accepted.pending_sha==state.ack_pending_sha &&
         accepted.final_event==state.ack_event && state.ack_event==state.accepted_event &&
         accepted.accepted_at==state.accepted_at;
   }
};
#endif
