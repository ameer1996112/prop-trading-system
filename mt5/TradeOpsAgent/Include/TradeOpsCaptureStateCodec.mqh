#ifndef TRADEOPS_CAPTURE_STATE_CODEC_MQH
#define TRADEOPS_CAPTURE_STATE_CODEC_MQH
#include "TradeOpsCaptureCodec.mqh"
#include "TradeOpsTelemetryState.mqh"

#define TOV2_CAPTURE_REVISIONS_MAX 1024
#define TOV2_CAPTURE_QUEUE_MAX 512
#define TOV2_CAPTURE_DIAGNOSTIC_RESERVE 1024
const string TOV2_CAPTURE_SCHEMA="capture.v1";

struct Tov2CaptureRevision
{
   string ticket,record_sha,content_sha;
   long revision,broker_msc;
};
struct Tov2CaptureQueued
{
   long sequence,observed_utc;
   string event_id,record_sha;
};
struct Tov2CaptureProtectionIndex { string position_id,content_sha; };
struct Tov2CaptureCheckpoint
{
   string identity,registration_sha;
   long start_msc,initialized_utc;
   int currency_scale;
   long produced,forward_start,forward_end,rotation_start,rotation_end,watermark;
   bool scan_finished;
   string record_gap;
   bool observation_gap;
   long previous_utc,previous_broker,broker_anchor_utc;
   bool reconcile,rotate_next;
   string account_json,attempt_status,last_complete_json;
   long attempt_utc,attempt_broker,position_count,order_count;
   int revision_count,queue_count,protection_count;
   Tov2CaptureRevision revisions[TOV2_CAPTURE_REVISIONS_MAX];
   Tov2CaptureQueued queued[TOV2_CAPTURE_QUEUE_MAX];
   Tov2CaptureProtectionIndex protections[TOV2_CAPTURE_POSITIONS_MAX];
   bool quarantine;
   string quarantine_ticket;
   long quarantine_msc,quarantine_type,quarantine_reason;
};
struct Tov2CaptureEnrollment
{
   string identity;
   uchar registration[];
   uchar capture[];
};

void Tov2CaptureCheckpointClear(Tov2CaptureCheckpoint &c)
{
   ZeroMemory(c);
   // ZeroMemory leaves strings NULL; failed reads promise an empty identity.
   c.identity="";
   c.record_gap="-";c.position_count=-1;c.order_count=-1;
}
bool Tov2CaptureGap(const string gap)
{
   return gap=="-" || Tov2CaptureChoice(gap,
      "HISTORY_UNAVAILABLE|CLOCK_DISCONTINUITY|OUTBOX_CORRUPT|CAPTURE_FAILED|UNSUPPORTED_RECORD");
}
int Tov2CaptureFindRevision(const Tov2CaptureCheckpoint &c,const string ticket)
{
   for(int i=0;i<c.revision_count;i++) if(c.revisions[i].ticket==ticket) return i;
   return -1;
}
int Tov2CaptureFindProtection(const Tov2CaptureCheckpoint &c,const string id)
{
   for(int i=0;i<c.protection_count;i++) if(c.protections[i].position_id==id) return i;
   return -1;
}
void Tov2CaptureProtectionFacts(const Tov2CapturePosition &p,const long time,Tov2CaptureProtection &out)
{
   ZeroMemory(out);out.position_id=p.position_id;out.ticket=p.ticket;out.symbol=p.symbol;
   out.sl=p.sl;out.tp=p.tp;out.source="POLL";out.observed_at_broker_msc=time;
}
bool Tov2CaptureProtectionContent(const Tov2CapturePosition &p,string &sha)
{
   sha="";Tov2CaptureProtection facts;string json="";
   Tov2CaptureProtectionFacts(p,1,facts);
   return Tov2CaptureEncodeProtection(facts,json) &&
      Tov2CaptureRecordHash("TOV2-CAPTURE-PROTECTION-CONTENT|"+json,sha);
}
bool Tov2CaptureCheckpointValid(const Tov2CaptureCheckpoint &c)
{
   string installation="";
   if(!Tov2LocalIdentity(c.identity,installation) || !Tov2Digest(c.registration_sha) ||
      !Tov2Counter(c.start_msc,1) || c.start_msc>9007199254739991 || c.start_msc%1000!=0 ||
      !Tov2Counter(c.initialized_utc,1) || c.currency_scale<0 || c.currency_scale>16 ||
      !Tov2Counter(c.produced) || !Tov2Counter(c.forward_start,c.start_msc) ||
      !Tov2Counter(c.forward_end,c.forward_start) || !Tov2Counter(c.rotation_start,c.start_msc) ||
      !Tov2Counter(c.rotation_end,c.rotation_start) || !Tov2Counter(c.watermark) ||
      (c.watermark>0 && c.watermark<c.start_msc) || (c.scan_finished && c.watermark==0) ||
      (c.reconcile && (c.watermark!=0 || c.scan_finished)) || !Tov2CaptureGap(c.record_gap) ||
      !Tov2Counter(c.previous_utc,1) || !Tov2Counter(c.previous_broker,1) ||
      !Tov2Counter(c.broker_anchor_utc,1) || c.broker_anchor_utc>c.previous_utc ||
      c.revision_count<0 || c.revision_count>TOV2_CAPTURE_REVISIONS_MAX ||
      c.queue_count<0 || c.queue_count>TOV2_CAPTURE_QUEUE_MAX ||
      c.protection_count<0 || c.protection_count>TOV2_CAPTURE_POSITIONS_MAX) return false;
   Tov2CaptureAccount account;Tov2CaptureExposure complete,attempt;
   if(!Tov2CaptureDecodeAccount(c.account_json,c.currency_scale,account) ||
      !Tov2CaptureDecodeExposure(c.last_complete_json,c.currency_scale,complete) ||
      complete.status!="COMPLETE" || account.observed_at_utc_seconds<c.initialized_utc ||
      complete.observed_at_utc_seconds<c.initialized_utc ||
      complete.observed_at_broker_msc<c.start_msc ||
      c.watermark>MathMax(account.observed_at_broker_msc,c.attempt_broker)) return false;
   Tov2CaptureClearExposure(attempt);
   if(c.attempt_status=="COMPLETE") attempt=complete;
   attempt.status=c.attempt_status;attempt.observed_at_utc_seconds=c.attempt_utc;
   attempt.observed_at_broker_msc=c.attempt_broker;
   attempt.position_count=c.position_count;attempt.order_count=c.order_count;
   if(!Tov2CaptureExposureValid(attempt,c.currency_scale) || c.attempt_utc<c.initialized_utc ||
      (c.attempt_status=="COMPLETE" &&
       (c.attempt_utc!=complete.observed_at_utc_seconds || c.attempt_broker!=complete.observed_at_broker_msc))) return false;
   long revision_total=0;
   for(int i=0;i<c.revision_count;i++)
   {
      Tov2CaptureRevision row=c.revisions[i];
      if(!Tov2Ticket(row.ticket) || !Tov2Counter(row.revision,1) || !Tov2Digest(row.record_sha) ||
         !Tov2Digest(row.content_sha) || !Tov2Counter(row.broker_msc,c.start_msc) ||
         (i>0 && StringCompare(c.revisions[i-1].ticket,row.ticket)>=0)) return false;
      if(row.revision>c.produced-revision_total) return false;
      revision_total+=row.revision;
   }
   for(int i=0;i<c.queue_count;i++)
   {
      Tov2CaptureQueued row=c.queued[i];
      if(!Tov2Counter(row.sequence,1) || row.sequence>c.produced ||
         !Tov2Counter(row.observed_utc,c.initialized_utc) || !Tov2Identifier(row.event_id) ||
         !Tov2Digest(row.record_sha) || (i>0 && c.queued[i-1].sequence>=row.sequence)) return false;
      for(int j=0;j<i;j++) if(c.queued[j].event_id==row.event_id) return false;
   }
   for(int i=0;i<c.protection_count;i++)
      if(!Tov2Ticket(c.protections[i].position_id) || !Tov2Digest(c.protections[i].content_sha) ||
         (i>0 && StringCompare(c.protections[i-1].position_id,c.protections[i].position_id)>=0)) return false;
   if(c.quarantine && (!Tov2Ticket(c.quarantine_ticket) || !Tov2Counter(c.quarantine_msc,c.start_msc) ||
      !Tov2Counter(c.quarantine_type) || !Tov2Counter(c.quarantine_reason) ||
      c.record_gap!="UNSUPPORTED_RECORD")) return false;
   return true;
}

string Tov2CaptureNet(const string value)
{
   uchar bytes[];
   if(!Tov2CaptureUtf8Bytes(value,bytes)) return "";
   return IntegerToString(ArraySize(bytes))+":"+value+",";
}
string Tov2CaptureNetNumber(const long value) { return Tov2CaptureNet(Tov2LocalNumber(value)); }
bool Tov2CaptureCheckpointEncode(const Tov2CaptureCheckpoint &c,uchar &out[])
{
   ArrayResize(out,0);
   if(!Tov2CaptureCheckpointValid(c)) return false;
   string text=Tov2CaptureNet("TCAP1")+Tov2CaptureNet(c.identity)+Tov2CaptureNet(c.registration_sha)+
      Tov2CaptureNetNumber(c.start_msc)+Tov2CaptureNetNumber(c.initialized_utc)+
      Tov2CaptureNetNumber(c.currency_scale)+Tov2CaptureNetNumber(c.produced)+
      Tov2CaptureNetNumber(c.forward_start)+Tov2CaptureNetNumber(c.forward_end)+
      Tov2CaptureNetNumber(c.rotation_start)+Tov2CaptureNetNumber(c.rotation_end)+
      Tov2CaptureNetNumber(c.watermark)+Tov2CaptureNetNumber(c.scan_finished?1:0)+
      Tov2CaptureNet(c.record_gap)+Tov2CaptureNetNumber(c.observation_gap?1:0)+
      Tov2CaptureNetNumber(c.previous_utc)+Tov2CaptureNetNumber(c.previous_broker)+
      Tov2CaptureNetNumber(c.broker_anchor_utc)+
      Tov2CaptureNetNumber(c.reconcile?1:0)+Tov2CaptureNetNumber(c.rotate_next?1:0)+
      Tov2CaptureNet(c.account_json)+Tov2CaptureNet(c.attempt_status)+
      Tov2CaptureNetNumber(c.attempt_utc)+Tov2CaptureNetNumber(c.attempt_broker)+
      Tov2CaptureNet(c.position_count<0?"-":Tov2LocalNumber(c.position_count))+
      Tov2CaptureNet(c.order_count<0?"-":Tov2LocalNumber(c.order_count))+
      Tov2CaptureNet(c.last_complete_json)+Tov2CaptureNetNumber(c.revision_count);
   for(int i=0;i<c.revision_count;i++)
      text+=Tov2CaptureNet(c.revisions[i].ticket)+Tov2CaptureNetNumber(c.revisions[i].revision)+
         Tov2CaptureNet(c.revisions[i].record_sha)+Tov2CaptureNet(c.revisions[i].content_sha)+
         Tov2CaptureNetNumber(c.revisions[i].broker_msc);
   text+=Tov2CaptureNetNumber(c.queue_count);
   for(int i=0;i<c.queue_count;i++)
      text+=Tov2CaptureNetNumber(c.queued[i].sequence)+Tov2CaptureNet(c.queued[i].event_id)+
         Tov2CaptureNetNumber(c.queued[i].observed_utc)+Tov2CaptureNet(c.queued[i].record_sha);
   text+=Tov2CaptureNetNumber(c.protection_count);
   for(int i=0;i<c.protection_count;i++)
      text+=Tov2CaptureNet(c.protections[i].position_id)+Tov2CaptureNet(c.protections[i].content_sha);
   text+=Tov2CaptureNetNumber(c.quarantine?1:0);
   if(c.quarantine) text+=Tov2CaptureNet(c.quarantine_ticket)+Tov2CaptureNetNumber(c.quarantine_msc)+
      Tov2CaptureNetNumber(c.quarantine_type)+Tov2CaptureNetNumber(c.quarantine_reason);
   return Tov2CaptureUtf8Bytes(text,out);
}

class CTov2CaptureNetReader
{
private:
   uchar m_bytes[];
   int m_at;
public:
   bool Start(const uchar &bytes[])
   {
      m_at=0;ArrayResize(m_bytes,0);
      return ArraySize(bytes)>0 && ArraySize(bytes)<=TOV2_CAPTURE_JSON_MAX && Tov2LocalCopy(bytes,m_bytes);
   }
   bool Done() { return m_at==ArraySize(m_bytes); }
   bool Text(string &out,const int maximum=TOV2_CAPTURE_JSON_MAX)
   {
      out="";int length=0,digits=0,start=m_at,n=ArraySize(m_bytes);
      while(m_at<n && m_bytes[m_at]>=48 && m_bytes[m_at]<=57)
      {
         if(++digits>6 || (digits>1 && m_bytes[start]==48)) return false;
         int digit=m_bytes[m_at++]-48;
         if(length>(maximum-digit)/10) return false;
         length=length*10+digit;
      }
      if(digits==0 || length<1 || length>maximum || m_at>=n || m_bytes[m_at++]!=58 ||
         length>n-m_at-1 || m_bytes[m_at+length]!=44) return false;
      uchar segment[];
      if(ArrayResize(segment,length)!=length || ArrayCopy(segment,m_bytes,0,m_at,length)!=length ||
         !Tov2CaptureUtf8Text(segment,out)) { out="";return false; }
      m_at+=length+1;return true;
   }
   bool Number(long &out,const long minimum=0)
   { string value="";out=0;return Text(value,16) && Tov2CounterFromText(value,minimum,out); }
   bool Count(int &out,const int maximum)
   { out=0;long value=0;if(!Number(value) || value>maximum) return false;out=(int)value;return true; }
   bool Flag(bool &out)
   { out=false;long value=0;if(!Number(value) || value>1) return false;out=value==1;return true; }
   bool OptionalCount(long &out)
   {out=-1;string value="";return Text(value,16) && (value=="-" || Tov2CounterFromText(value,0,out));}
};
bool Tov2CaptureCheckpointDecode(const uchar &payload[],Tov2CaptureCheckpoint &out)
{
   Tov2CaptureCheckpointClear(out);
   CTov2CaptureNetReader reader;Tov2CaptureCheckpoint c;Tov2CaptureCheckpointClear(c);
   string tag="";
   if(!reader.Start(payload) || !reader.Text(tag,5) || tag!="TCAP1" ||
      !reader.Text(c.identity,1024) || !reader.Text(c.registration_sha,64) ||
      !reader.Number(c.start_msc,1) || !reader.Number(c.initialized_utc,1) ||
      !reader.Count(c.currency_scale,16) || !reader.Number(c.produced) ||
      !reader.Number(c.forward_start,1) || !reader.Number(c.forward_end,1) ||
      !reader.Number(c.rotation_start,1) || !reader.Number(c.rotation_end,1) ||
      !reader.Number(c.watermark) || !reader.Flag(c.scan_finished) ||
      !reader.Text(c.record_gap,24) || !reader.Flag(c.observation_gap) ||
      !reader.Number(c.previous_utc,1) || !reader.Number(c.previous_broker,1) ||
      !reader.Number(c.broker_anchor_utc,1) ||
      !reader.Flag(c.reconcile) || !reader.Flag(c.rotate_next) ||
      !reader.Text(c.account_json) || !reader.Text(c.attempt_status,16) ||
      !reader.Number(c.attempt_utc,1) || !reader.Number(c.attempt_broker,1) ||
      !reader.OptionalCount(c.position_count) || !reader.OptionalCount(c.order_count) ||
      !reader.Text(c.last_complete_json) || !reader.Count(c.revision_count,TOV2_CAPTURE_REVISIONS_MAX)) return false;
   for(int i=0;i<c.revision_count;i++)
      if(!reader.Text(c.revisions[i].ticket,20) || !reader.Number(c.revisions[i].revision,1) ||
         !reader.Text(c.revisions[i].record_sha,64) || !reader.Text(c.revisions[i].content_sha,64) ||
         !reader.Number(c.revisions[i].broker_msc,1)) return false;
   if(!reader.Count(c.queue_count,TOV2_CAPTURE_QUEUE_MAX)) return false;
   for(int i=0;i<c.queue_count;i++)
      if(!reader.Number(c.queued[i].sequence,1) || !reader.Text(c.queued[i].event_id,160) ||
         !reader.Number(c.queued[i].observed_utc,1) || !reader.Text(c.queued[i].record_sha,64)) return false;
   if(!reader.Count(c.protection_count,TOV2_CAPTURE_POSITIONS_MAX)) return false;
   for(int i=0;i<c.protection_count;i++)
      if(!reader.Text(c.protections[i].position_id,20) || !reader.Text(c.protections[i].content_sha,64)) return false;
   if(!reader.Flag(c.quarantine)) return false;
   if(c.quarantine && (!reader.Text(c.quarantine_ticket,20) || !reader.Number(c.quarantine_msc,1) ||
      !reader.Number(c.quarantine_type) || !reader.Number(c.quarantine_reason))) return false;
   uchar canonical[];
   if(!reader.Done() || !Tov2CaptureCheckpointEncode(c,canonical) || !Tov2LocalEqual(payload,canonical)) return false;
   out=c;return true;
}
bool Tov2CaptureRegistrationBinding(const Tov2CaptureRegistration &registration,const string identity)
{
   string parts[],installation="",boundary="",hash="";
   return Tov2LocalIdentity(identity,installation) && StringSplit(identity,126,parts)==7 &&
      parts[2]==registration.boundary.tracking_id &&
      parts[5]==registration.boundary.account_fingerprint_sha256 &&
      Tov2CaptureEncodeBoundary(registration.boundary,boundary) &&
      Tov2CaptureRecordHash(boundary,hash) && parts[6]==hash;
}
bool Tov2CaptureContextMatches(const Tov2LocalState &state,const uchar &registration[],
                              const Tov2CaptureCheckpoint &capture,Tov2CaptureRegistration &decoded)
{
   ZeroMemory(decoded);string json="",sha="";Tov2CaptureRegistration r;
   if(capture.identity!=state.identity || capture.produced!=state.produced ||
      state.capture_schema!=TOV2_CAPTURE_SCHEMA || !Tov2CaptureUtf8Text(registration,json) ||
      !Tov2CaptureDecodeRegistration(json,r) || !Tov2CaptureRegistrationBinding(r,state.identity) ||
      !Tov2LocalHash(registration,sha) || capture.registration_sha!=sha ||
      capture.start_msc!=r.boundary.started_at_broker_msc ||
      capture.initialized_utc!=r.boundary.initialized_at_utc_seconds ||
      capture.currency_scale!=r.display.currency_scale) return false;
   for(int i=0;i<state.event_count;i++)
   {
      bool found=false;
      for(int j=0;j<capture.queue_count;j++)
         if(capture.queued[j].sequence==state.events[i].sequence)
            found=capture.queued[j].event_id==state.events[i].event_id &&
               capture.queued[j].record_sha==state.events[i].record_sha &&
               capture.queued[j].observed_utc>=capture.initialized_utc;
      if(!found) return false;
      if(state.events[i].deal_id!="-")
      {
         int index=Tov2CaptureFindRevision(capture,state.events[i].deal_id);
         if(index<0 || capture.revisions[index].revision<state.events[i].revision ||
            (capture.revisions[index].revision==state.events[i].revision &&
             capture.revisions[index].record_sha!=state.events[i].record_sha)) return false;
      }
   }
   decoded=r;return true;
}

class ITov2CaptureWirePayloadValidator
{
public:
   virtual bool Pending(const uchar &payload[],const Tov2LocalState &state,const string identity)=0;
   virtual bool Ack(const uchar &payload[],const Tov2LocalState &state,const string identity)=0;
   virtual bool RequiresAckWitness() { return false; }
   virtual bool AckWithPending(const uchar &response[],const uchar &pending[],
                               const Tov2LocalState &state,const string identity)
   { return false; }
};
class CTov2CapturePayloadValidator : public ITov2TelemetryStatePayloadValidator
{
private:
   ITov2CaptureWirePayloadValidator *m_wire;
   int m_scale;
   string m_identity,m_registration_sha;
   Tov2CaptureRegistration m_registration;
public:
   CTov2CapturePayloadValidator(const int expected_currency_scale,ITov2CaptureWirePayloadValidator *wire=NULL)
   { m_wire=wire;m_scale=expected_currency_scale;m_identity="";m_registration_sha="";ZeroMemory(m_registration); }
   virtual bool Registration(const uchar &payload[],const string expected_identity)
   {
      m_identity="";m_registration_sha="";ZeroMemory(m_registration);
      string text="",sha="";Tov2CaptureRegistration r;
      if(!Tov2CaptureUtf8Text(payload,text) || !Tov2CaptureDecodeRegistration(text,r) ||
         r.display.currency_scale!=m_scale ||
         !Tov2CaptureRegistrationBinding(r,expected_identity) || !Tov2LocalHash(payload,sha)) return false;
      m_registration=r;m_identity=expected_identity;m_registration_sha=sha;return true;
   }
   virtual bool Capture(const uchar &payload[],const string schema,const string expected_identity)
   {
      Tov2CaptureCheckpoint c;
      if(schema!=TOV2_CAPTURE_SCHEMA || !Tov2CaptureCheckpointDecode(payload,c) ||
         c.identity!=expected_identity || c.currency_scale!=m_scale) return false;
      if(m_identity==expected_identity)
         return c.registration_sha==m_registration_sha && c.currency_scale==m_registration.display.currency_scale &&
            c.start_msc==m_registration.boundary.started_at_broker_msc &&
            c.initialized_utc==m_registration.boundary.initialized_at_utc_seconds;
      return true;
   }
   virtual bool CaptureAdvance(const uchar &previous[],const string previous_schema,
                               const uchar &candidate[],const string schema,const string identity)
   {
      Tov2CaptureCheckpoint a,b;
      if(!Capture(previous,previous_schema,identity) || !Capture(candidate,schema,identity) ||
         !Tov2CaptureCheckpointDecode(previous,a) || !Tov2CaptureCheckpointDecode(candidate,b) ||
         a.registration_sha!=b.registration_sha || a.start_msc!=b.start_msc ||
         a.initialized_utc!=b.initialized_utc || a.currency_scale!=b.currency_scale ||
         b.produced<a.produced || b.produced-a.produced>TOV2_LOCAL_BATCH) return false;
      long revision_delta=0;
      for(int i=0;i<a.revision_count;i++)
      {
         int index=Tov2CaptureFindRevision(b,a.revisions[i].ticket);
         if(index<0) return false;
         Tov2CaptureRevision old=a.revisions[i],next=b.revisions[index];
         if(next.revision<old.revision || next.revision-old.revision>1) return false;
         if(next.revision==old.revision && (next.record_sha!=old.record_sha ||
            next.content_sha!=old.content_sha || next.broker_msc!=old.broker_msc)) return false;
         if(next.revision>old.revision && (next.record_sha==old.record_sha || next.content_sha==old.content_sha)) return false;
         revision_delta+=next.revision-old.revision;
      }
      for(int i=0;i<b.revision_count;i++)
         if(Tov2CaptureFindRevision(a,b.revisions[i].ticket)<0)
         {
            if(b.revisions[i].revision!=1) return false;
            revision_delta++;
         }
      return revision_delta<=b.produced-a.produced;
   }
   virtual bool Event(const uchar &payload[],const string event_id,const string sha,
                      const string deal_id,const long revision,const string identity)
   {
      if(identity!=m_identity || !Tov2Identifier(event_id)) return false;
      string text="",actual="";
      if(!Tov2CaptureUtf8Text(payload,text) || !Tov2LocalHash(payload,actual) || actual!=sha) return false;
      if(deal_id=="-")
      {
         Tov2CaptureProtection p;
         return revision==0 && Tov2CaptureDecodeProtection(text,p) && p.source=="POLL" &&
            p.observed_at_broker_msc>=m_registration.boundary.started_at_broker_msc;
      }
      Tov2CaptureDeal d;
      if(!Tov2CaptureDecodeDeal(text,m_registration.display.currency_scale,d) ||
         d.deal_id!=deal_id || d.revision!=revision ||
         d.broker_time_msc<m_registration.boundary.started_at_broker_msc) return false;
      if(d.broker_time_msc<m_registration.boundary.started_at_broker_msc+1000)
         for(int i=0;i<m_registration.boundary.excluded_size;i++)
            if(deal_id==m_registration.boundary.excluded_boundary_deal_ids[i]) return false;
      return true;
   }
   virtual bool Pending(const uchar &payload[],const Tov2LocalState &state,const string identity)
   { return CheckPointer(m_wire)!=POINTER_INVALID && m_wire.Pending(payload,state,identity); }
   virtual bool Ack(const uchar &payload[],const Tov2LocalState &state,const string identity)
   { return CheckPointer(m_wire)!=POINTER_INVALID && m_wire.Ack(payload,state,identity); }
   virtual bool RequiresAckWitness()
   { return CheckPointer(m_wire)==POINTER_INVALID || m_wire.RequiresAckWitness(); }
   virtual bool AckWithPending(const uchar &response[],const uchar &pending[],
                               const Tov2LocalState &state,const string identity)
   { return CheckPointer(m_wire)!=POINTER_INVALID && m_wire.AckWithPending(response,pending,state,identity); }
};
#endif
