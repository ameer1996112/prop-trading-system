# MT5 telemetry persistence — pure state runtime code appendix

This appendix is documentation, not installed source. It contains complete proposed source for the locator contract, deterministic memory adapter, pure state engine, native fault self-test, and TypeScript seam in the companion [implementation plan](2026-09-03-mt5-telemetry-ea-state-runtime.md). The blocks have not been compiled by MetaEditor and do not authorize a Windows action, native file write, active-EA edit, network call, broker operation, staging, commit, push, or deployment.

## A. `mt5/TradeOpsAgent/Include/TradeOpsTelemetryStorage.mqh`

~~~cpp
#ifndef TRADEOPS_TELEMETRY_STORAGE_MQH
#define TRADEOPS_TELEMETRY_STORAGE_MQH
#include "TradeOpsTelemetryStorageCodec.mqh"

const long TOV2_STORAGE_NORMAL_BYTES=67108864;
const long TOV2_STORAGE_RESERVE_BYTES=8388608;
const int TOV2_STORAGE_NORMAL_FILES=4096;
const int TOV2_STORAGE_RESERVE_FILES=128;
const int TOV2_STORAGE_DELETE_BATCH=32;
const int TOV2_STORAGE_INVENTORY_MAX=4225;

const int TOV2_LOC_OWNER=1;
const int TOV2_LOC_REGISTRATION=2;
const int TOV2_LOC_OBJECT=3;
const int TOV2_LOC_STATE=4;
const int TOV2_LOC_COMMIT=5;

const int TOV2_STORE_OK=0;
const int TOV2_STORE_ABSENT=1;
const int TOV2_STORE_ACQUIRED=2;
const int TOV2_STORE_BUSY=3;
const int TOV2_STORE_CREATED=4;
const int TOV2_STORE_EXISTS_SAME=5;
const int TOV2_STORE_DELETED=6;
const int TOV2_STORE_CONFLICT=7;
const int TOV2_STORE_IO_ERROR=8;
const int TOV2_STORE_OWNERSHIP_LOST=9;
const int TOV2_STORE_LIMIT=10;
const int TOV2_STORE_INVALID=11;

struct Tov2StorageLocator
{
   int kind;
   long generation;
   long ordinal;
};

void Tov2StorageClearLocator(Tov2StorageLocator &locator)
{
   locator.kind=0;
   locator.generation=0;
   locator.ordinal=0;
}

bool Tov2StorageLocatorValid(const Tov2StorageLocator &locator)
{
   if(locator.kind==TOV2_LOC_OWNER)
      return locator.generation==0 && locator.ordinal==0;
   if(locator.kind==TOV2_LOC_REGISTRATION)
      return locator.generation==1 && locator.ordinal==0;
   if(locator.kind==TOV2_LOC_STATE || locator.kind==TOV2_LOC_COMMIT)
      return Tov2Counter(locator.generation,1) && locator.ordinal==0;
   if(locator.kind==TOV2_LOC_OBJECT)
      return Tov2Counter(locator.generation,1) && Tov2Counter(locator.ordinal,1);
   return false;
}

bool Tov2StorageSameLocator(const Tov2StorageLocator &left,
                            const Tov2StorageLocator &right)
{
   return left.kind==right.kind && left.generation==right.generation &&
          left.ordinal==right.ordinal;
}

Tov2StorageLocator Tov2StorageOwnerLocator()
{
   Tov2StorageLocator result;
   result.kind=TOV2_LOC_OWNER; result.generation=0; result.ordinal=0;
   return result;
}

Tov2StorageLocator Tov2StorageRegistrationLocator()
{
   Tov2StorageLocator result;
   result.kind=TOV2_LOC_REGISTRATION; result.generation=1; result.ordinal=0;
   return result;
}

Tov2StorageLocator Tov2StorageObjectLocator(const long generation,const long ordinal)
{
   Tov2StorageLocator result;
   result.kind=TOV2_LOC_OBJECT; result.generation=generation; result.ordinal=ordinal;
   return result;
}

Tov2StorageLocator Tov2StorageStateLocator(const long generation)
{
   Tov2StorageLocator result;
   result.kind=TOV2_LOC_STATE; result.generation=generation; result.ordinal=0;
   return result;
}

Tov2StorageLocator Tov2StorageCommitLocator(const long generation)
{
   Tov2StorageLocator result;
   result.kind=TOV2_LOC_COMMIT; result.generation=generation; result.ordinal=0;
   return result;
}

string Tov2StorageRelativePath(const Tov2StorageLocator &locator)
{
   if(!Tov2StorageLocatorValid(locator)) return "";
   if(locator.kind==TOV2_LOC_OWNER) return "owner.lock";
   if(locator.kind==TOV2_LOC_REGISTRATION) return "registration.rec";
   if(locator.kind==TOV2_LOC_STATE)
      return "states/"+Tov2LocalNumber(locator.generation)+".rec";
   if(locator.kind==TOV2_LOC_COMMIT)
      return "commits/"+Tov2LocalNumber(locator.generation)+".rec";
   return "objects/"+Tov2LocalNumber(locator.generation)+"-"+
          Tov2LocalNumber(locator.ordinal)+".rec";
}

struct Tov2StorageEntry
{
   Tov2StorageLocator locator;
   string relative_path;
   long size;
   string sha;
};

void Tov2StorageClearEntry(Tov2StorageEntry &entry)
{
   Tov2StorageClearLocator(entry.locator);
   entry.relative_path="";
   entry.size=0;
   entry.sha="-";
}

bool Tov2StorageEntryValid(const Tov2StorageEntry &entry)
{
   if(!Tov2StorageLocatorValid(entry.locator) || entry.size<0 ||
      entry.relative_path!=Tov2StorageRelativePath(entry.locator)) return false;
   if(entry.locator.kind==TOV2_LOC_OWNER)
      return entry.sha=="-";
   return Tov2Digest(entry.sha) && entry.size>=1 && entry.size<=TOV2_RECORD_FRAME_MAX;
}

bool Tov2StorageDefiniteRead(const int result)
{
   return result==TOV2_STORE_OK || result==TOV2_STORE_ABSENT;
}

bool Tov2StorageDefiniteCreate(const int result)
{
   return result==TOV2_STORE_CREATED || result==TOV2_STORE_EXISTS_SAME ||
          result==TOV2_STORE_CONFLICT;
}

bool Tov2StorageDefiniteDelete(const int result)
{
   return result==TOV2_STORE_DELETED || result==TOV2_STORE_ABSENT ||
          result==TOV2_STORE_CONFLICT;
}

bool Tov2StorageReserveTransition(const string transition)
{
   return transition=="ACK" || transition=="CHECKPOINT" ||
          transition=="DIAGNOSTIC";
}

bool Tov2StorageRuntimeTransition(const string transition)
{
   return transition=="INIT" || transition=="APPEND" ||
          transition=="CHECKPOINT" || transition=="DIAGNOSTIC";
}

bool Tov2StorageBudgetTransition(const string transition)
{
   return Tov2LocalTransition(transition);
}

bool Tov2StorageBudget(const Tov2StorageEntry &entries[],long &bytes,int &files,
                       long &highest_generation)
{
   bytes=0; files=0; highest_generation=0;
   int count=ArraySize(entries);
   if(count<0 || count>TOV2_STORAGE_INVENTORY_MAX) return false;
   for(int i=0;i<count;i++)
   {
      if(!Tov2StorageEntryValid(entries[i])) return false;
      for(int j=0;j<i;j++)
         if(Tov2StorageSameLocator(entries[i].locator,entries[j].locator) ||
            entries[i].relative_path==entries[j].relative_path) return false;
      if(entries[i].locator.kind==TOV2_LOC_OWNER)
      {
         if(entries[i].size!=0) return false;
         continue;
      }
      if(entries[i].size>TOV2_STORAGE_NORMAL_BYTES+TOV2_STORAGE_RESERVE_BYTES-bytes)
         return false;
      bytes+=entries[i].size;
      files++;
      if(entries[i].locator.generation>highest_generation)
         highest_generation=entries[i].locator.generation;
   }
   return files<=TOV2_STORAGE_NORMAL_FILES+TOV2_STORAGE_RESERVE_FILES;
}

bool Tov2StoragePreflight(const Tov2StorageEntry &entries[],const string transition,
                          const long added_bytes,const int added_files)
{
   if(!Tov2StorageBudgetTransition(transition) || added_bytes<0 || added_files<0)
      return false;
   long bytes=0,highest=0; int files=0;
   if(!Tov2StorageBudget(entries,bytes,files,highest)) return false;
   long byte_limit=TOV2_STORAGE_NORMAL_BYTES;
   int file_limit=TOV2_STORAGE_NORMAL_FILES;
   if(Tov2StorageReserveTransition(transition))
   {
      byte_limit+=TOV2_STORAGE_RESERVE_BYTES;
      file_limit+=TOV2_STORAGE_RESERVE_FILES;
   }
   if(added_bytes>byte_limit-bytes || added_files>file_limit-files) return false;
   return true;
}

class ITov2TelemetryStorage
{
public:
   virtual int Acquire(const string installation_key,string &session_token)=0;
   virtual int Revalidate(const string session_token)=0;
   virtual int Inventory(const string session_token,Tov2StorageEntry &entries[])=0;
   virtual int Read(const string session_token,const Tov2StorageLocator &locator,
                    uchar &bytes[])=0;
   virtual int CreateExact(const string session_token,const Tov2StorageLocator &locator,
                           const uchar &bytes[])=0;
   virtual int DeleteExact(const string session_token,const Tov2StorageLocator &locator,
                           const string expected_sha)=0;
   virtual void Close(const string session_token)=0;
};

#endif
~~~

## D. `mt5/TradeOpsAgent/Scripts/TradeOpsTelemetryStateSelfTest.mq5`

~~~cpp
#property strict
#property version "1.000"
#property description "Offline deterministic telemetry state publication and recovery tests"
#include "../Include/TradeOpsTelemetryState.mqh"
#include "Support/TradeOpsTelemetryMemoryStore.mqh"

string Identity(const string account="account.demo",const string installation="install.demo");
string Repeat(const string value,const int count);

class CSyntheticPayloadValidator : public ITov2TelemetryStatePayloadValidator
{
private:
   string m_reject;

   bool TextStarts(const uchar &payload[],const string prefix)
   {
      string text="";
      return Tov2LocalText(payload,text) && StringFind(text,prefix)==0;
   }

   bool Allowed(const string kind)
   {
      return m_reject!=kind;
   }

public:
   int calls;

   CSyntheticPayloadValidator()
   {
      m_reject="";
      calls=0;
   }

   void Reject(const string kind) { m_reject=kind; }
   void AcceptAll() { m_reject=""; }

   bool Registration(const uchar &payload[],const string expected_identity)
   {
      calls++;
      return Allowed("REGISTRATION") && expected_identity==Identity() &&
             TextStarts(payload,"registration.synthetic.");
   }

   bool Capture(const uchar &payload[],const string capture_schema,
                const string expected_identity)
   {
      calls++;
      if(!Allowed("CAPTURE") || expected_identity!=Identity()) return false;
      if(capture_schema=="synthetic.capture.1") return TextStarts(payload,"capture.");
      return capture_schema=="synthetic.capture.2" &&
             TextStarts(payload,"capture.migrated.");
   }

   bool CaptureAdvance(const uchar &previous_payload[],const string previous_schema,
                       const uchar &candidate_payload[],const string candidate_schema,
                       const string expected_identity)
   {
      calls++;
      if(!Allowed("CAPTURE_ADVANCE") || expected_identity!=Identity() ||
         !Capture(previous_payload,previous_schema,expected_identity) ||
         !Capture(candidate_payload,candidate_schema,expected_identity)) return false;
      if(previous_schema==candidate_schema) return true;
      return previous_schema=="synthetic.capture.1" &&
             candidate_schema=="synthetic.capture.2" &&
             TextStarts(candidate_payload,"capture.migrated.");
   }

   bool Event(const uchar &payload[],const string event_id,const string record_sha,
              const string deal_id,const long revision,const string expected_identity)
   {
      calls++;
      string actual="",text=""; string fields[]; long encoded_revision=0;
      return Allowed("EVENT") && expected_identity==Identity() &&
             Tov2Identifier(event_id) && Tov2LocalText(payload,text) &&
             StringSplit(text,StringGetCharacter("|",0),fields)==6 &&
             fields[0]=="EVENT1" && fields[1]==expected_identity &&
             fields[2]==event_id && fields[3]==deal_id &&
             Tov2CounterFromText(fields[4],0,encoded_revision) &&
             encoded_revision==revision && fields[5]!="" &&
             Tov2LocalHash(payload,actual) &&
             actual==record_sha && (deal_id=="-" ? revision==0 : revision>=1) &&
             (StringFind(fields[5],"event.")==0 || StringFind(fields[5],"q.")==0);
   }

   bool Pending(const uchar &payload[],const Tov2LocalState &state,
                const string expected_identity)
   {
      calls++;
      string text=""; string fields[];
      long request=0,prior=0,final_event=0,produced=0;
      long count=0;
      return Allowed("PENDING") && expected_identity==Identity() &&
             Tov2LocalText(payload,text) &&
             StringSplit(text,StringGetCharacter("|",0),fields)==8 &&
             fields[0]=="PENDING1" && fields[1]==expected_identity &&
             Tov2CounterFromText(fields[2],0,request) &&
             Tov2CounterFromText(fields[3],0,prior) &&
             Tov2CounterFromText(fields[4],0,final_event) &&
             Tov2CounterFromText(fields[5],0,count) &&
             Tov2CounterFromText(fields[6],0,produced) && Tov2Digest(fields[7]) &&
             state.pending.kind=="PENDING" && state.pending.ordinal==1 &&
             request==state.pending_request && request==state.pending.sequence &&
             prior==state.pending_prior && prior==state.accepted_event &&
             final_event==state.pending_final &&
             final_event==state.accepted_event+state.pending_count &&
             count==state.pending_count && produced==state.pending_produced &&
             produced==state.produced && fields[7]==state.pending_body;
   }

   bool Ack(const uchar &payload[],const Tov2LocalState &state,
            const string expected_identity)
   {
      calls++;
      string text=""; string fields[];
      long request=0,event_sequence=0,accepted_at=0;
      return Allowed("ACK") && expected_identity==Identity() &&
             Tov2LocalText(payload,text) &&
             StringSplit(text,StringGetCharacter("|",0),fields)==7 &&
             fields[0]=="ACK1" && fields[1]==expected_identity &&
             Tov2CounterFromText(fields[2],0,request) &&
             Tov2CounterFromText(fields[3],0,event_sequence) &&
             Tov2CounterFromText(fields[4],1,accepted_at) &&
             Tov2Digest(fields[5]) && Tov2Digest(fields[6]) &&
             state.ack.kind=="ACK" && state.ack.sequence==state.ack_request &&
             state.ack.ordinal==2 &&
             request==state.ack_request && request==state.accepted_request &&
             event_sequence==state.ack_event && event_sequence==state.accepted_event &&
             accepted_at==state.accepted_at && fields[5]==state.ack_pending_sha &&
             fields[6]==state.ack_body;
   }
};

CSyntheticPayloadValidator synthetic_validator;

int tov2_state_checks=0;
int tov2_state_failures=0;

void Check(const bool ok,const string label)
{
   tov2_state_checks++;
   if(!ok)
   {
      tov2_state_failures++;
      Print("TOV2_STATE_FAILURE ",label);
   }
}

string Repeat(const string value,const int count)
{
   string result="";
   for(int i=0;i<count;i++) result+=value;
   return result;
}

string Identity(const string account,const string installation)
{
   return account+"~"+installation+"~tracking.demo~1~"+Repeat("d",64)+"~"+
          Repeat("e",64)+"~"+Repeat("f",64);
}

bool Bytes(const string value,uchar &bytes[])
{
   return Tov2LocalBytes(value,bytes);
}

bool PendingBytes(const string identity,const long request,const long prior,
                  const long final_event,const long count,const long produced,
                  const string body_sha,uchar &bytes[])
{
   return Bytes("PENDING1|"+identity+"|"+Tov2LocalNumber(request)+"|"+
                Tov2LocalNumber(prior)+"|"+Tov2LocalNumber(final_event)+"|"+
                Tov2LocalNumber(count)+"|"+Tov2LocalNumber(produced)+"|"+body_sha,
                bytes);
}

bool AckBytes(const string identity,const long request,const long event_sequence,
              const long accepted_at,const string pending_sha,const string body_sha,
              uchar &bytes[])
{
   return Bytes("ACK1|"+identity+"|"+Tov2LocalNumber(request)+"|"+
                Tov2LocalNumber(event_sequence)+"|"+Tov2LocalNumber(accepted_at)+"|"+
                pending_sha+"|"+body_sha,bytes);
}

void Ref(Tov2LocalRef &reference,const string kind,const long generation,
         const long ordinal,const string sha,const long sequence=0)
{
   Tov2LocalClearRef(reference);
   reference.kind=kind; reference.generation=generation; reference.ordinal=ordinal;
   reference.sha=sha; reference.sequence=sequence;
}

bool OpenEmpty(CTov2TelemetryMemoryStore &store,CTov2TelemetryState &state)
{
   return state.Open()==TOV2_STATE_OK && state.Recover()==TOV2_STATE_NOT_STARTED;
}

bool Initialize(CTov2TelemetryState &state)
{
   uchar registration[],capture[];
   return Bytes("registration.synthetic.1",registration) &&
          Bytes("capture.synthetic.0",capture) &&
          state.InitializeNew(registration,capture,"synthetic.capture.1")==TOV2_STATE_OK;
}

bool Fresh(CTov2TelemetryMemoryStore &store,const string identity,
           Tov2LocalState &snapshot,int &recovery)
{
   Tov2LocalClearState(snapshot);
   CTov2TelemetryState state(GetPointer(store),GetPointer(synthetic_validator),identity);
   if(state.Open()!=TOV2_STATE_OK) return false;
   recovery=state.Recover();
   bool copied=(recovery==TOV2_STATE_OK && state.Snapshot(snapshot));
   state.Close();
   return copied;
}

bool Candidate(const string id,const string payload_text,const string deal,
               const long revision,Tov2AppendCandidate &candidate,
               uchar &arena[],int &ends[])
{
   Tov2AppendClearCandidate(candidate);
   candidate.event_id=id;
   candidate.deal_id=deal;
   candidate.revision=revision;
   uchar payload[];
   string canonical="EVENT1|"+Identity()+"|"+id+"|"+deal+"|"+
                    Tov2LocalNumber(revision)+"|"+payload_text;
   if(StringFind(payload_text,"|")>=0 || !Bytes(canonical,payload) ||
      !Tov2LocalHash(payload,candidate.record_sha))
      return false;
   int old=ArraySize(arena);
   int n=ArraySize(ends);
   if(ArrayResize(arena,old+ArraySize(payload))!=old+ArraySize(payload) ||
      ArrayCopy(arena,payload,old,0,ArraySize(payload))!=ArraySize(payload) ||
      ArrayResize(ends,n+1)!=n+1) return false;
   ends[n]=old+ArraySize(payload);
   return true;
}

bool AppendOne(CTov2TelemetryState &state,const string id,const string event_text,
               const string capture_text)
{
   Tov2AppendCandidate candidates[];
   uchar arena[],capture[];
   int ends[]; long sequences[];
   if(ArrayResize(candidates,1)!=1 ||
      !Candidate(id,event_text,"42",1,candidates[0],arena,ends) ||
      !Bytes(capture_text,capture)) return false;
   return state.Append(candidates,arena,ends,capture,"synthetic.capture.1",sequences)==TOV2_STATE_OK &&
          ArraySize(sequences)==1;
}

bool NewInitialized(CTov2TelemetryMemoryStore &store,CTov2TelemetryState &state)
{
   return OpenEmpty(store,state) && Initialize(state);
}

bool InjectPendingAckRoot(CTov2TelemetryMemoryStore &store,const Tov2LocalState &base)
{
   uchar parent_frame[],pending_payload[],pending_frame[],ack_payload[],ack_frame[];
   uchar state_payload[],state_frame[],commit_payload[],commit_frame[];
   string parent_sha="",pending_sha="",ack_sha="",state_sha="";
   string pending_body=Repeat("6",64),ack_body=Repeat("7",64);
   if(!store.Copy(Tov2StorageCommitLocator(base.generation),parent_frame) ||
      !Tov2LocalHash(parent_frame,parent_sha) ||
      !PendingBytes(Identity(),2,0,1,1,1,pending_body,pending_payload) ||
      !Tov2RecordEncode("PENDING",3,pending_payload,pending_frame) ||
      !Tov2LocalHash(pending_frame,pending_sha) ||
      !AckBytes(Identity(),1,0,1,Repeat("5",64),ack_body,ack_payload) ||
      !Tov2RecordEncode("ACK",3,ack_payload,ack_frame) ||
      !Tov2LocalHash(ack_frame,ack_sha)) return false;
   Tov2LocalState state=base;
   state.generation=3; state.parent_generation=base.generation;
   state.parent_commit=parent_sha;
   state.accepted_request=1; state.accepted_event=0;
   Ref(state.ack,"ACK",3,2,ack_sha,1);
   state.ack_request=1; state.ack_body=ack_body;
   state.ack_pending_sha=Repeat("5",64); state.accepted_at=1; state.ack_event=0;
   Ref(state.pending,"PENDING",3,1,pending_sha,2);
   state.pending_request=2; state.pending_body=pending_body;
   state.pending_prior=0; state.pending_final=1; state.pending_count=1;
   state.pending_produced=1;
   if(!Tov2LocalStateEncode(state,state_payload) ||
      !Tov2RecordEncode("CHECKPOINT",3,state_payload,state_frame) ||
      !Tov2LocalHash(state_frame,state_sha)) return false;
   Tov2LocalCommit commit;
   Tov2LocalClearCommit(commit);
   commit.generation=3; commit.parent_generation=base.generation;
   commit.parent_sha=parent_sha; commit.registration_sha=base.registration.sha;
   commit.state_sha=state_sha; commit.transition="CHECKPOINT";
   if(!Tov2LocalCommitEncode(commit,commit_payload) ||
      !Tov2RecordEncode("CHECKPOINT",3,commit_payload,commit_frame)) return false;
   return store.Inject(Tov2StorageObjectLocator(3,1),pending_frame) &&
          store.Inject(Tov2StorageObjectLocator(3,2),ack_frame) &&
          store.Inject(Tov2StorageStateLocator(3),state_frame) &&
          store.Inject(Tov2StorageCommitLocator(3),commit_frame);
}

bool InjectRoot(CTov2TelemetryMemoryStore &store,const Tov2LocalState &state,
                const string transition,string &commit_sha)
{
   uchar state_payload[],state_frame[],commit_payload[],commit_frame[];
   string state_sha=""; commit_sha="";
   if(!Tov2LocalStateEncode(state,state_payload) ||
      !Tov2RecordEncode("CHECKPOINT",state.generation,state_payload,state_frame) ||
      !Tov2LocalHash(state_frame,state_sha)) return false;
   Tov2LocalCommit commit; Tov2LocalClearCommit(commit);
   commit.generation=state.generation;
   commit.parent_generation=state.parent_generation;
   commit.parent_sha=state.parent_commit;
   commit.registration_sha=state.registration.sha;
   commit.state_sha=state_sha; commit.transition=transition;
   if(!Tov2LocalCommitEncode(commit,commit_payload) ||
      !Tov2RecordEncode("CHECKPOINT",state.generation,commit_payload,commit_frame) ||
      !Tov2LocalHash(commit_frame,commit_sha)) return false;
   return store.Inject(Tov2StorageStateLocator(state.generation),state_frame) &&
          store.Inject(Tov2StorageCommitLocator(state.generation),commit_frame);
}

bool InjectObject(CTov2TelemetryMemoryStore &store,const string kind,
                  const long generation,const long ordinal,const string text,
                  Tov2LocalRef &reference,const long sequence=0)
{
   uchar payload[],frame[]; string frame_sha="",record_sha="";
   string event_id="retired.event."+Tov2LocalNumber(sequence);
   string deal_id=Tov2LocalNumber(1000+sequence);
   string encoded=(kind=="EVENT" ? "EVENT1|"+Identity()+"|"+event_id+"|"+
                   deal_id+"|1|"+text : text);
   if(!Bytes(encoded,payload) || !Tov2LocalHash(payload,record_sha) ||
      !Tov2RecordEncode(kind,generation,payload,frame) ||
      !Tov2LocalHash(frame,frame_sha)) return false;
   Ref(reference,kind,generation,ordinal,frame_sha,sequence);
   if(kind=="EVENT")
   {
      reference.event_id=event_id;
      reference.record_sha=record_sha;
      reference.deal_id=deal_id;
      reference.revision=1;
   }
   return store.Inject(Tov2StorageObjectLocator(generation,ordinal),frame);
}

bool InjectRetirementChain(CTov2TelemetryMemoryStore &store,
                           const Tov2LocalState &base,const int event_count,
                           const bool acknowledge,const bool add_pending,
                           const bool add_disconnected,
                           const long previous_generation=10,
                           const long current_generation=11)
{
   uchar root_frame[]; string root_sha="";
   if(!store.Copy(Tov2StorageCommitLocator(base.generation),root_frame) ||
      !Tov2LocalHash(root_frame,root_sha)) return false;
   Tov2LocalState retired=base;
   retired.generation=2; retired.parent_generation=base.generation;
   retired.parent_commit=root_sha; retired.produced=event_count;
   retired.event_count=event_count; retired.completeness="DATA_MISSING";
   retired.last_error="HISTORY_UNAVAILABLE";
   if(ArrayResize(retired.events,event_count)!=event_count) return false;
   for(int i=0;i<event_count;i++)
      if(!InjectObject(store,"EVENT",2,i+1+(add_pending ? 1 : 0),
                       "event.retired."+Tov2LocalNumber(i+1),
                       retired.events[i],i+1)) return false;
   if(!InjectObject(store,"CAPTURE",2,event_count+1+(add_pending ? 1 : 0),"capture.retired",
                    retired.capture)) return false;
   retired.capture_schema="synthetic.capture.1";
   if(add_pending)
   {
      uchar pending_payload[],pending_frame[]; string pending_sha="";
      retired.pending_body=Repeat("6",64);
      if(event_count<1 ||
         !PendingBytes(Identity(),1,0,1,1,event_count,retired.pending_body,
                       pending_payload) ||
         !Tov2RecordEncode("PENDING",2,pending_payload,pending_frame) ||
         !Tov2LocalHash(pending_frame,pending_sha) ||
         !store.Inject(Tov2StorageObjectLocator(2,1),pending_frame)) return false;
      Ref(retired.pending,"PENDING",2,1,pending_sha,1);
      retired.pending_request=1; retired.pending_prior=0; retired.pending_final=1;
      retired.pending_count=1; retired.pending_produced=event_count;
   }
   string retired_sha="";
   if(!InjectRoot(store,retired,"APPEND",retired_sha)) return false;

   Tov2LocalState previous=base;
   previous.generation=previous_generation; previous.parent_generation=2;
   previous.parent_commit=retired_sha; previous.capture=retired.capture;
   previous.capture_schema="synthetic.capture.1";
   previous.completeness="DATA_MISSING"; previous.last_error="HISTORY_UNAVAILABLE";
   if(acknowledge)
   {
      previous.produced=event_count; previous.accepted_event=event_count;
      previous.accepted_request=1;
      uchar ack_payload[],ack_frame[]; string ack_sha="";
      previous.ack_body=Repeat("7",64);
      if(!AckBytes(Identity(),1,event_count,1,Repeat("5",64),previous.ack_body,
                   ack_payload) ||
         !Tov2RecordEncode("ACK",previous_generation,ack_payload,ack_frame) ||
         !Tov2LocalHash(ack_frame,ack_sha) ||
         !store.Inject(Tov2StorageObjectLocator(previous_generation,2),ack_frame)) return false;
      Ref(previous.ack,"ACK",previous_generation,2,ack_sha,1);
      previous.ack_request=1; previous.ack_pending_sha=Repeat("5",64);
      previous.accepted_at=1; previous.ack_event=event_count;
   }
   string previous_sha="";
   if(!InjectRoot(store,previous,"CHECKPOINT",previous_sha)) return false;
   Tov2LocalState current=previous;
   current.generation=current_generation; current.parent_generation=previous_generation;
   current.parent_commit=previous_sha;
   string current_sha="";
   if(!InjectRoot(store,current,"CHECKPOINT",current_sha)) return false;
   if(add_disconnected)
   {
      Tov2LocalState disconnected=base;
      disconnected.generation=5; disconnected.parent_generation=1;
      disconnected.parent_commit=root_sha;
      string disconnected_sha="";
      if(!InjectRoot(store,disconnected,"DIAGNOSTIC",disconnected_sha)) return false;
   }
   return true;
}

bool InjectProtectedAliasChain(CTov2TelemetryMemoryStore &store,
                               const Tov2LocalState &base,
                               const bool event_metadata_mismatch,
                               const bool capture_schema_mismatch)
{
   uchar root_frame[]; string root_sha="";
   if(!store.Copy(Tov2StorageCommitLocator(1),root_frame) ||
      !Tov2LocalHash(root_frame,root_sha)) return false;
   Tov2LocalState retired=base;
   retired.generation=2; retired.parent_generation=1; retired.parent_commit=root_sha;
   retired.produced=1; retired.event_count=1;
   retired.completeness="DATA_MISSING"; retired.last_error="HISTORY_UNAVAILABLE";
   if(ArrayResize(retired.events,1)!=1 ||
      !InjectObject(store,"EVENT",2,1,"event.alias",retired.events[0],1) ||
      !InjectObject(store,"CAPTURE",2,2,
                    capture_schema_mismatch ? "capture.migrated.alias" : "capture.alias",
                    retired.capture)) return false;
   Tov2LocalRef valid_event=retired.events[0];
   if(event_metadata_mismatch) retired.events[0].record_sha=Repeat("8",64);
   retired.capture_schema=capture_schema_mismatch ?
                          "synthetic.capture.2" : "synthetic.capture.1";
   string retired_sha="";
   if(!InjectRoot(store,retired,"APPEND",retired_sha)) return false;
   Tov2LocalState previous=retired;
   previous.generation=10; previous.parent_generation=2;
   previous.parent_commit=retired_sha;
   previous.events[0]=valid_event;
   if(capture_schema_mismatch) previous.capture_schema="synthetic.capture.1";
   string previous_sha="";
   if(!InjectRoot(store,previous,"CHECKPOINT",previous_sha)) return false;
   Tov2LocalState current=previous;
   current.generation=11; current.parent_generation=10;
   current.parent_commit=previous_sha;
   string current_sha="";
   return InjectRoot(store,current,"CHECKPOINT",current_sha);
}

void BasicLifecycle()
{
   CTov2TelemetryMemoryStore store;
   store.ArmFault("ACQUIRE",1,TOV2_MEMORY_FAULT_BEFORE);
   CTov2TelemetryState inert(GetPointer(store),GetPointer(synthetic_validator),Identity());
   Check(store.PersistentCount()==0,"constructor.no_virtual_call");
   Check(inert.Open()==TOV2_STATE_IO_ERROR,"open.acquire_only_fault");
   store.ClearFault();

   store.ArmFault("ACQUIRE",1,TOV2_MEMORY_FAULT_AFTER);
   CTov2TelemetryState after_fault(GetPointer(store),GetPointer(synthetic_validator),Identity());
   Check(after_fault.Open()==TOV2_STATE_IO_ERROR,"memory.acquire_after_fault");
   store.ClearFault();
   CTov2TelemetryState reusable(GetPointer(store),GetPointer(synthetic_validator),Identity());
   Check(reusable.Open()==TOV2_STATE_OK,"memory.acquire_after_reusable");
   reusable.Close();

   CTov2TelemetryState null_validator(GetPointer(store),NULL,Identity());
   Check(null_validator.Open()==TOV2_STATE_INVALID,"validator.required");

   CTov2TelemetryState first(GetPointer(store),GetPointer(synthetic_validator),Identity());
   Check(first.Open()==TOV2_STATE_OK && store.PersistentCount()==0,"open.acquire_only");
   Check(first.Recover()==TOV2_STATE_NOT_STARTED && store.PersistentCount()==0,
         "recover.no_initialize");
   Check(Initialize(first),"initialize.explicit");
   Tov2LocalState original;
   Check(first.Snapshot(original) && original.generation==1 &&
         original.identity==Identity(),"initialize.snapshot");

   CTov2TelemetryState second(GetPointer(store),GetPointer(synthetic_validator),Identity());
   Check(second.Open()==TOV2_STATE_BUSY,"ownership.second_instance_busy");
   store.Crash();
   Tov2LocalState cleared;
   Check(!first.Snapshot(cleared),"memory.crash_invalidates");
   int recovery=-1;
   Check(Fresh(store,Identity(),cleared,recovery) && recovery==TOV2_STATE_OK &&
         cleared.generation==1 && cleared.identity==original.identity,
         "memory.crash_preserves");
   Check(cleared.capture.sha==original.capture.sha,"restart.normal_capture");

   CTov2TelemetryState isolated(GetPointer(store),GetPointer(synthetic_validator),
                                Identity("account.demo","install.changed"));
   Check(isolated.Open()==TOV2_STATE_CONFLICT,"memory.installation_isolation");
}

void InitializationFaults()
{
   for(int mode=TOV2_MEMORY_FAULT_BEFORE;mode<=TOV2_MEMORY_FAULT_AFTER;mode++)
   {
      for(int boundary=1;boundary<=4;boundary++)
      {
         CTov2TelemetryMemoryStore store;
         CTov2TelemetryState state(GetPointer(store),GetPointer(synthetic_validator),Identity());
         Check(OpenEmpty(store,state),"init_fault.open."+IntegerToString(mode)+"."+
               IntegerToString(boundary));
         store.ArmFault("CREATE",boundary,mode);
         Check(!Initialize(state) && state.ReloadRequired(),
               "init_fault.reload."+IntegerToString(mode)+"."+IntegerToString(boundary));
         store.Crash();
         Tov2LocalState snapshot; int recovery=-1;
         bool loaded=Fresh(store,Identity(),snapshot,recovery);
         bool commit_persisted=(mode==TOV2_MEMORY_FAULT_AFTER && boundary==4);
         bool pristine=(mode==TOV2_MEMORY_FAULT_BEFORE && boundary==1);
         bool expected=false;
         if(commit_persisted)
            expected=loaded && recovery==TOV2_STATE_OK;
         else if(pristine)
            expected=!loaded && recovery==TOV2_STATE_NOT_STARTED;
         else
            expected=!loaded && recovery==TOV2_STATE_RECOVERY_REQUIRED;
         Check(expected,
               "init_fault.fresh_recovery."+IntegerToString(mode)+"."+
               IntegerToString(boundary));
      }
   }
}

void AppendFaults()
{
   for(int mode=TOV2_MEMORY_FAULT_BEFORE;mode<=TOV2_MEMORY_FAULT_AFTER;mode++)
   {
      for(int boundary=1;boundary<=4;boundary++)
      {
         CTov2TelemetryMemoryStore store;
         CTov2TelemetryState state(GetPointer(store),GetPointer(synthetic_validator),Identity());
         Check(NewInitialized(store,state),"append_fault.initialize."+
               IntegerToString(mode)+"."+IntegerToString(boundary));
         store.ArmFault("CREATE",boundary,mode);
         Check(!AppendOne(state,"event.1","event.synthetic.1","capture.synthetic.1") &&
               state.ReloadRequired(),"publication.reload_required."+
               IntegerToString(mode)+"."+IntegerToString(boundary));
         store.Crash();
         Tov2LocalState snapshot; int recovery=-1;
         Check(Fresh(store,Identity(),snapshot,recovery) && recovery==TOV2_STATE_OK,
               "publication.fresh_instance."+IntegerToString(mode)+"."+
               IntegerToString(boundary));
         bool committed=(mode==TOV2_MEMORY_FAULT_AFTER && boundary==4);
         Check(snapshot.produced==(committed ? 1 : 0) &&
               snapshot.event_count==(committed ? 1 : 0),
               "append.atomic_capture."+IntegerToString(mode)+"."+
               IntegerToString(boundary));
      }
   }
}

void ReadbackFaults()
{
   for(int mode=TOV2_MEMORY_FAULT_BEFORE;mode<=TOV2_MEMORY_FAULT_AFTER;mode++)
   {
      for(int boundary=1;boundary<=4;boundary++)
      {
         CTov2TelemetryMemoryStore init_store;
         CTov2TelemetryState init_state(GetPointer(init_store),GetPointer(synthetic_validator),Identity());
         Check(OpenEmpty(init_store,init_state),"readback.init_open."+
               IntegerToString(mode)+"."+IntegerToString(boundary));
         init_store.ArmFault("READ",boundary,mode);
         Check(!Initialize(init_state) && init_state.ReloadRequired(),
               "readback.init_reload."+IntegerToString(mode)+"."+
               IntegerToString(boundary));
         init_store.Crash();
         Tov2LocalState snapshot; int recovery=-1;
         bool loaded=Fresh(init_store,Identity(),snapshot,recovery);
         Check(boundary==4 ? loaded && recovery==TOV2_STATE_OK :
               !loaded && recovery==TOV2_STATE_RECOVERY_REQUIRED,
               "readback.init_fresh."+IntegerToString(mode)+"."+
               IntegerToString(boundary));

         CTov2TelemetryMemoryStore append_store;
         CTov2TelemetryState append_state(GetPointer(append_store),GetPointer(synthetic_validator),Identity());
         Check(NewInitialized(append_store,append_state),"readback.append_initialize."+
               IntegerToString(mode)+"."+IntegerToString(boundary));
         // APPEND performs five required current-root/capture reads before its four write read-backs.
         append_store.ArmFault("READ",5+boundary,mode);
         Check(!AppendOne(append_state,"event.1","event.synthetic.1",
                          "capture.synthetic.1") && append_state.ReloadRequired(),
               "readback.append_reload."+IntegerToString(mode)+"."+
               IntegerToString(boundary));
         append_store.Crash();
         loaded=Fresh(append_store,Identity(),snapshot,recovery);
         Check(loaded && recovery==TOV2_STATE_OK &&
               snapshot.produced==(boundary==4 ? 1 : 0),
               "readback.append_fresh."+IntegerToString(mode)+"."+
               IntegerToString(boundary));
      }
   }
}

void MetadataPublicationFaults()
{
   for(int mode=TOV2_MEMORY_FAULT_BEFORE;mode<=TOV2_MEMORY_FAULT_AFTER;mode++)
   {
      for(int boundary=1;boundary<=2;boundary++)
      {
         CTov2TelemetryMemoryStore diagnostic_store;
         CTov2TelemetryState diagnostic_state(GetPointer(diagnostic_store),GetPointer(synthetic_validator),Identity());
         Check(NewInitialized(diagnostic_store,diagnostic_state),
               "diagnostic_fault.initialize."+IntegerToString(mode)+"."+
               IntegerToString(boundary));
         diagnostic_store.ArmFault("CREATE",boundary,mode);
         Check(diagnostic_state.PublishDiagnostic("DATA_MISSING","HISTORY_UNAVAILABLE")!=
               TOV2_STATE_OK && diagnostic_state.ReloadRequired(),
               "diagnostic_fault.reload."+IntegerToString(mode)+"."+
               IntegerToString(boundary));
         diagnostic_store.Crash();
         Tov2LocalState snapshot; int recovery=-1;
         Check(Fresh(diagnostic_store,Identity(),snapshot,recovery) &&
               snapshot.generation==(mode==TOV2_MEMORY_FAULT_AFTER && boundary==2 ? 2 : 1),
               "diagnostic_fault.fresh."+IntegerToString(mode)+"."+
               IntegerToString(boundary));

         CTov2TelemetryMemoryStore checkpoint_store;
         CTov2TelemetryState checkpoint_state(GetPointer(checkpoint_store),GetPointer(synthetic_validator),Identity());
         Check(NewInitialized(checkpoint_store,checkpoint_state),
               "checkpoint_fault.initialize."+IntegerToString(mode)+"."+
               IntegerToString(boundary));
         checkpoint_store.ArmFault("CREATE",boundary,mode);
         Check(checkpoint_state.Compact()!=TOV2_STATE_OK &&
               checkpoint_state.ReloadRequired(),
               "checkpoint_fault.reload."+IntegerToString(mode)+"."+
               IntegerToString(boundary));
         checkpoint_store.Crash();
         Check(Fresh(checkpoint_store,Identity(),snapshot,recovery) &&
               snapshot.generation==(mode==TOV2_MEMORY_FAULT_AFTER && boundary==2 ? 2 : 1),
               "checkpoint_fault.fresh."+IntegerToString(mode)+"."+
               IntegerToString(boundary));
      }
   }
}

void RecoveryAuthority()
{
   CTov2TelemetryMemoryStore corrupt_store;
   CTov2TelemetryState corrupt_state(GetPointer(corrupt_store),GetPointer(synthetic_validator),Identity());
   Check(NewInitialized(corrupt_store,corrupt_state) &&
         AppendOne(corrupt_state,"event.1","event.synthetic.1","capture.synthetic.1"),
         "recovery.fixture");
   corrupt_state.Close();
   Check(corrupt_store.Corrupt(Tov2StorageCommitLocator(2),0),
         "recovery.corrupt_fixture");
   Tov2LocalState snapshot; int recovery=-1;
   Check(!Fresh(corrupt_store,Identity(),snapshot,recovery) &&
         recovery==TOV2_STATE_RECOVERY_REQUIRED,"recovery.highest_corrupt");

   CTov2TelemetryMemoryStore absent_store;
   CTov2TelemetryState absent_state(GetPointer(absent_store),GetPointer(synthetic_validator),Identity());
   Check(NewInitialized(absent_store,absent_state) &&
         AppendOne(absent_state,"event.1","event.synthetic.1","capture.synthetic.1"),
         "recovery.absent_fixture");
   absent_state.Close();
   Check(absent_store.Remove(Tov2StorageCommitLocator(2)),"recovery.remove_commit");
   Check(Fresh(absent_store,Identity(),snapshot,recovery) && snapshot.generation==1,
         "recovery.highest_missing");

   CTov2TelemetryMemoryStore missing_ref_store;
   CTov2TelemetryState missing_ref_state(GetPointer(missing_ref_store),GetPointer(synthetic_validator),Identity());
   Check(NewInitialized(missing_ref_store,missing_ref_state) &&
         AppendOne(missing_ref_state,"event.1","event.synthetic.1","capture.synthetic.1"),
         "recovery.missing_ref_fixture");
   missing_ref_state.Close();
   Check(missing_ref_store.Remove(Tov2StorageObjectLocator(2,1)),
         "recovery.remove_live_event");
   Check(!Fresh(missing_ref_store,Identity(),snapshot,recovery) &&
         recovery==TOV2_STATE_RECOVERY_REQUIRED,"recovery.highest_live_reference_missing");

   CTov2TelemetryMemoryStore forged_store;
   CTov2TelemetryState forged_state(GetPointer(forged_store),
                                    GetPointer(synthetic_validator),Identity());
   Check(NewInitialized(forged_store,forged_state) && forged_state.Snapshot(snapshot),
         "recovery.parent_mismatch_fixture");
   forged_state.Close();
   uchar parent_frame[],state_payload[],state_frame[],commit_payload[],commit_frame[];
   string parent_sha="",state_sha="";
   Check(forged_store.Copy(Tov2StorageCommitLocator(1),parent_frame) &&
         Tov2LocalHash(parent_frame,parent_sha),"recovery.parent_mismatch_parent");
   Tov2LocalState forged=snapshot;
   forged.generation=2; forged.parent_generation=1; forged.parent_commit=parent_sha;
   Tov2LocalCommit forged_commit;
   Tov2LocalClearCommit(forged_commit);
   Check(Tov2LocalStateEncode(forged,state_payload) &&
         Tov2RecordEncode("CHECKPOINT",2,state_payload,state_frame) &&
         Tov2LocalHash(state_frame,state_sha),"recovery.parent_mismatch_state");
   forged_commit.generation=2; forged_commit.parent_generation=1;
   forged_commit.parent_sha=Repeat("9",64);
   forged_commit.registration_sha=forged.registration.sha;
   forged_commit.state_sha=state_sha; forged_commit.transition="CHECKPOINT";
   Check(Tov2LocalCommitEncode(forged_commit,commit_payload) &&
         Tov2RecordEncode("CHECKPOINT",2,commit_payload,commit_frame) &&
         forged_store.Inject(Tov2StorageStateLocator(2),state_frame) &&
         forged_store.Inject(Tov2StorageCommitLocator(2),commit_frame),
         "recovery.parent_mismatch_inject");
   Check(!Fresh(forged_store,Identity(),snapshot,recovery) &&
         recovery==TOV2_STATE_RECOVERY_REQUIRED,
         "recovery.parent_metadata_mismatch");

   CTov2TelemetryState mismatch(GetPointer(absent_store),GetPointer(synthetic_validator),Identity("account.changed"));
   Check(mismatch.Open()==TOV2_STATE_OK &&
         mismatch.Recover()==TOV2_STATE_IDENTITY_MISMATCH,"identity.recover_mismatch");
   mismatch.Close();
}

void TypedValidationAndMissingRegistration()
{
   CTov2TelemetryMemoryStore rejected_store;
   CTov2TelemetryState rejected(GetPointer(rejected_store),GetPointer(synthetic_validator),
                                Identity());
   Check(OpenEmpty(rejected_store,rejected),"typed.reject_open");
   synthetic_validator.Reject("REGISTRATION");
   Check(!Initialize(rejected) && rejected_store.PersistentCount()==0,
         "typed.reject_root_unchanged");
   synthetic_validator.AcceptAll();
   Check(Initialize(rejected),"typed.valid_paths");
   Tov2LocalState unchanged;
   Check(rejected.Snapshot(unchanged),"typed.initial_snapshot");
   synthetic_validator.Reject("EVENT");
   Check(!AppendOne(rejected,"event.bad","event.invalid","capture.invalid") &&
         rejected.Snapshot(unchanged) && unchanged.generation==1,
         "typed.event_reject_root_unchanged");
   synthetic_validator.AcceptAll();
   synthetic_validator.Reject("CAPTURE_ADVANCE");
   Check(!AppendOne(rejected,"event.bad","event.invalid","capture.invalid") &&
         rejected.Snapshot(unchanged) && unchanged.generation==1,
         "typed.capture_advance_reject_root_unchanged");
   synthetic_validator.AcceptAll();
   Check(AppendOne(rejected,"event.1","event.synthetic.1","capture.synthetic.1") &&
         rejected.Snapshot(unchanged),"typed.event_capture_valid");
   rejected.Close();
   Check(InjectPendingAckRoot(rejected_store,unchanged),"typed.pending_ack_fixture");

   Tov2LocalState snapshot; int recovery=-1;
   Check(Fresh(rejected_store,Identity(),snapshot,recovery) && snapshot.generation==3,
         "typed.pending_ack_valid");
   CTov2TelemetryState maintenance(GetPointer(rejected_store),
                                   GetPointer(synthetic_validator),Identity());
   Check(maintenance.Open()==TOV2_STATE_OK && maintenance.Recover()==TOV2_STATE_OK &&
         maintenance.Compact()==TOV2_STATE_OK,
         "compact.pending_ack_checkpoint");
   maintenance.Close();
   Check(rejected_store.Exists(Tov2StorageObjectLocator(3,1)) &&
         rejected_store.Exists(Tov2StorageObjectLocator(3,2)),
         "compact.pending_ack_witnesses");
   string kinds[5]={"REGISTRATION","CAPTURE","EVENT","PENDING","ACK"};
   string labels[5]={"typed.recovery_registration","typed.recovery_capture",
                     "typed.recovery_event","typed.recovery_pending",
                     "typed.recovery_ack"};
   for(int i=0;i<5;i++)
   {
      synthetic_validator.Reject(kinds[i]);
      Check(!Fresh(rejected_store,Identity(),snapshot,recovery) &&
            recovery==TOV2_STATE_RECOVERY_REQUIRED,
            labels[i]);
      synthetic_validator.AcceptAll();
   }

   CTov2TelemetryMemoryStore missing_store;
   CTov2TelemetryState missing(GetPointer(missing_store),GetPointer(synthetic_validator),
                               Identity());
   Check(NewInitialized(missing_store,missing),"recovery.registration_fixture");
   missing.Close();
   Check(missing_store.Remove(Tov2StorageRegistrationLocator()),
         "recovery.registration_remove");
   Check(!Fresh(missing_store,Identity(),snapshot,recovery) &&
         recovery==TOV2_STATE_RECOVERY_REQUIRED,"recovery.registration_missing");
}

void MutationFreshRootVerification()
{
   CTov2TelemetryMemoryStore store;
   CTov2TelemetryState state(GetPointer(store),GetPointer(synthetic_validator),Identity());
   Check(NewInitialized(store,state),"mutation.current_fixture");
   Tov2LocalState before;
   Check(state.Snapshot(before),"mutation.current_snapshot");
   Check(store.Corrupt(Tov2StorageObjectLocator(1,1),0),
         "mutation.current_corrupt_fixture");
   Check(state.PublishDiagnostic("DATA_MISSING","HISTORY_UNAVAILABLE")==
         TOV2_STATE_RECOVERY_REQUIRED,"mutation.current_corrupt_blocks");
   Check(store.PersistentCount()==4,"mutation.current_root_rechecked");
   state.Close();
}

void ValidatorAssociationsAndSchemaMigration()
{
   Tov2AppendCandidate event_candidate; uchar event_payload[]; int event_ends[];
   Check(Candidate("event.validator","event.validator.body","77",3,event_candidate,
                   event_payload,event_ends),"typed.event_association_fixture");
   Check(synthetic_validator.Event(event_payload,event_candidate.event_id,
         event_candidate.record_sha,event_candidate.deal_id,event_candidate.revision,
         Identity()),"typed.event_association_valid");
   Check(!synthetic_validator.Event(event_payload,event_candidate.event_id,
         event_candidate.record_sha,event_candidate.deal_id,event_candidate.revision,
         Identity("account.changed")),"typed.event_wrong_identity");
   Check(!synthetic_validator.Event(event_payload,"event.changed",
         event_candidate.record_sha,event_candidate.deal_id,event_candidate.revision,
         Identity()),"typed.event_wrong_event_id");
   Check(!synthetic_validator.Event(event_payload,event_candidate.event_id,
         event_candidate.record_sha,"78",event_candidate.revision,Identity()),
         "typed.event_wrong_deal_id");
   Check(!synthetic_validator.Event(event_payload,event_candidate.event_id,
         event_candidate.record_sha,event_candidate.deal_id,4,Identity()),
         "typed.event_wrong_revision");
   uchar changed_event_payload[];
   Check(Bytes("EVENT1|"+Identity()+"|event.validator|77|3|event.changed.body",
               changed_event_payload) &&
         !synthetic_validator.Event(changed_event_payload,event_candidate.event_id,
          event_candidate.record_sha,event_candidate.deal_id,event_candidate.revision,
          Identity()),"typed.event_body_stale_record_sha");
   Check(!synthetic_validator.Event(event_payload,event_candidate.event_id,Repeat("9",64),
         event_candidate.deal_id,event_candidate.revision,Identity()),
         "typed.event_wrong_record_sha");

   uchar pending[],ack[],capture1[],capture2[];
   string pending_body=Repeat("6",64),ack_body=Repeat("7",64);
   Check(PendingBytes(Identity(),2,0,1,1,1,pending_body,pending) &&
         AckBytes(Identity(),1,0,1,Repeat("5",64),ack_body,ack) &&
         Bytes("capture.synthetic.1",capture1) &&
         Bytes("capture.migrated.1",capture2),"typed.association_fixture");
   Tov2LocalState state;
   Tov2LocalClearState(state);
   state.generation=3; state.produced=1;
   Ref(state.pending,"PENDING",3,1,Repeat("4",64),2);
   state.pending_request=2; state.pending_body=pending_body;
   state.pending_prior=0; state.pending_final=1; state.pending_count=1;
   state.pending_produced=1;
   Ref(state.ack,"ACK",3,2,Repeat("7",64),1);
   state.accepted_request=1; state.accepted_event=0; state.ack_request=1;
   state.ack_body=ack_body; state.ack_pending_sha=Repeat("5",64);
   state.ack_event=0; state.accepted_at=1;
   Check(synthetic_validator.Pending(pending,state,Identity()),"typed.pending_association_valid");
   state.pending_request=3;
   Check(!synthetic_validator.Pending(pending,state,Identity()),"typed.pending_wrong_request");
   state.pending_request=2; state.pending.sequence=3;
   Check(!synthetic_validator.Pending(pending,state,Identity()),"typed.pending_wrong_sequence");
   state.pending.sequence=2; state.pending.ordinal=9;
   Check(!synthetic_validator.Pending(pending,state,Identity()),"typed.pending_wrong_ordinal");
   state.pending.ordinal=1; state.pending_prior=1;
   Check(!synthetic_validator.Pending(pending,state,Identity()),"typed.pending_wrong_prior");
   state.pending_prior=0; state.pending_final=0;
   Check(!synthetic_validator.Pending(pending,state,Identity()),"typed.pending_wrong_final");
   state.pending_final=1; state.pending_count=0;
   Check(!synthetic_validator.Pending(pending,state,Identity()),"typed.pending_wrong_count");
   state.pending_count=1; state.pending_produced=0;
   Check(!synthetic_validator.Pending(pending,state,Identity()),"typed.pending_wrong_produced");
   state.pending_produced=1; state.pending_body=Repeat("9",64);
   Check(!synthetic_validator.Pending(pending,state,Identity()),"typed.pending_wrong_body");
   state.pending_body=pending_body;
   Check(!synthetic_validator.Pending(pending,state,Identity("account.changed")),
         "typed.pending_wrong_identity");
   Check(synthetic_validator.Ack(ack,state,Identity()),"typed.ack_association_valid");
   state.ack.sequence=2;
   Check(!synthetic_validator.Ack(ack,state,Identity()),"typed.ack_wrong_sequence");
   state.ack.sequence=1; state.ack.ordinal=9;
   Check(!synthetic_validator.Ack(ack,state,Identity()),"typed.ack_wrong_ordinal");
   state.ack.ordinal=2; state.accepted_request=2;
   Check(!synthetic_validator.Ack(ack,state,Identity()),"typed.ack_wrong_accepted_request");
   state.accepted_request=1; state.accepted_event=1;
   Check(!synthetic_validator.Ack(ack,state,Identity()),"typed.ack_wrong_accepted_event");
   state.accepted_event=0; state.ack_request=2;
   Check(!synthetic_validator.Ack(ack,state,Identity()),"typed.ack_wrong_request");
   state.ack_request=1; state.ack_event=1;
   Check(!synthetic_validator.Ack(ack,state,Identity()),"typed.ack_wrong_event");
   state.ack_event=0; state.accepted_at=2;
   Check(!synthetic_validator.Ack(ack,state,Identity()),"typed.ack_wrong_accepted_at");
   state.accepted_at=1;
   state.ack_pending_sha=Repeat("8",64);
   Check(!synthetic_validator.Ack(ack,state,Identity()),"typed.ack_wrong_pending_digest");
   state.ack_pending_sha=Repeat("5",64); state.ack_body=Repeat("8",64);
   Check(!synthetic_validator.Ack(ack,state,Identity()),"typed.ack_wrong_body");
   state.ack_body=ack_body;
   Check(!synthetic_validator.Ack(ack,state,Identity("account.changed")),
         "typed.ack_wrong_identity");
   Check(synthetic_validator.CaptureAdvance(capture1,"synthetic.capture.1",capture2,
         "synthetic.capture.2",Identity()),"capture.schema_migration_valid");
   Check(!synthetic_validator.CaptureAdvance(capture1,"synthetic.capture.9",capture2,
          "synthetic.capture.2",Identity()),"capture.previous_schema_reject");
   Check(!synthetic_validator.CaptureAdvance(capture1,"synthetic.capture.1",capture2,
          "synthetic.capture.9",Identity()),"capture.candidate_schema_reject");

   CTov2TelemetryMemoryStore store;
   CTov2TelemetryState runtime(GetPointer(store),GetPointer(synthetic_validator),Identity());
   Check(NewInitialized(store,runtime),"capture.migration_runtime_fixture");
   Tov2AppendCandidate none[]; uchar arena[]; int ends[]; long sequences[];
   Check(runtime.Append(none,arena,ends,capture2,"synthetic.capture.2",sequences)==
         TOV2_STATE_OK,"capture.schema_migration_runtime");
   Tov2LocalState snapshot;
   Check(runtime.Snapshot(snapshot) && snapshot.capture_schema=="synthetic.capture.2",
         "capture.schema_migration_persisted");
   Check(runtime.Append(none,arena,ends,capture1,"synthetic.capture.1",sequences)==
         TOV2_STATE_INVALID && runtime.Snapshot(snapshot) && snapshot.generation==2,
         "capture.schema_downgrade_rejected");
   runtime.Close();
}

void AbandonedGenerationAndReplay()
{
   CTov2TelemetryMemoryStore store;
   CTov2TelemetryState state(GetPointer(store),GetPointer(synthetic_validator),Identity());
   Check(NewInitialized(store,state),"generation.initialize");
   uchar payload[],frame[];
   Check(Bytes("EVENT1|"+Identity()+"|abandoned.event|-|0|event.abandoned",payload) &&
         Tov2RecordEncode("EVENT",9,payload,frame) &&
         store.Inject(Tov2StorageObjectLocator(9,1),frame),"generation.abandoned_inject");
   state.Close(); store.Crash();
   CTov2TelemetryState restarted(GetPointer(store),GetPointer(synthetic_validator),Identity());
   Check(restarted.Open()==TOV2_STATE_OK && restarted.Recover()==TOV2_STATE_OK,
         "generation.abandoned_recover");
   Check(AppendOne(restarted,"event.1","event.synthetic.1","capture.synthetic.1"),
         "generation.abandoned_append");
   Tov2LocalState snapshot;
   Check(restarted.Snapshot(snapshot) && snapshot.generation==10,
         "generation.abandoned_skip");

   Tov2AppendCandidate candidates[]; uchar arena[],capture[]; int ends[]; long sequences[];
   Check(ArrayResize(candidates,1)==1 &&
         Candidate("event.1","event.synthetic.1","42",1,candidates[0],arena,ends) &&
         Bytes("capture.synthetic.1",capture),"append.replay_fixture");
   Check(restarted.Append(candidates,arena,ends,capture,"synthetic.capture.1",sequences)==TOV2_STATE_OK &&
         ArraySize(sequences)==1 && sequences[0]==1 &&
         restarted.Snapshot(snapshot) && snapshot.produced==1,
         "append.replay_exact");
   candidates[0].record_sha=Repeat("9",64);
   ArrayResize(arena,0); ArrayResize(ends,0);
   Check(Candidate("event.1","event.synthetic.changed","42",1,candidates[0],arena,ends),
         "append.conflict_fixture_valid_digest");
   Check(restarted.Append(candidates,arena,ends,capture,"synthetic.capture.1",sequences)==
         TOV2_STATE_CONFLICT,"append.conflict");
   Check(ArraySize(sequences)==0,"append.conflict_sequences_clear");
   restarted.Close();
}

void MixedRetryAndIdentityConflicts()
{
   CTov2TelemetryMemoryStore store;
   CTov2TelemetryState state(GetPointer(store),GetPointer(synthetic_validator),Identity());
   Check(NewInitialized(store,state) &&
         AppendOne(state,"event.1","event.synthetic.1","capture.synthetic.1"),
         "append.mixed_fixture");
   Tov2AppendCandidate mixed[]; uchar arena[],capture[]; int ends[]; long sequences[];
   Check(ArrayResize(mixed,2)==2 &&
         Candidate("event.1","event.synthetic.1","42",1,mixed[0],arena,ends) &&
         Candidate("event.2","event.synthetic.2","43",1,mixed[1],arena,ends) &&
         Bytes("capture.synthetic.2",capture),"append.mixed_retry_fixture");
   Check(state.Append(mixed,arena,ends,capture,"synthetic.capture.1",sequences)==TOV2_STATE_OK,
         "append.mixed_retry");
   Tov2LocalState snapshot;
   Check(state.Snapshot(snapshot) && snapshot.event_count==2 &&
         snapshot.events[0].sequence==1 && snapshot.events[1].sequence==2 &&
         snapshot.produced==2 && ArraySize(sequences)==2 &&
         sequences[0]==1 && sequences[1]==2,"append.mixed_sequences");

   Tov2AppendCandidate tail[]; uchar tail_arena[]; int tail_ends[];
   Check(ArrayResize(tail,3)==3 &&
         Candidate("event.1","event.synthetic.1","42",1,tail[0],tail_arena,tail_ends) &&
         Candidate("event.2","event.synthetic.2","43",1,tail[1],tail_arena,tail_ends) &&
         Candidate("event.3","event.synthetic.3","44",1,tail[2],tail_arena,tail_ends) &&
         state.Append(tail,tail_arena,tail_ends,capture,"synthetic.capture.1",sequences)==
         TOV2_STATE_OK && sequences[0]==1 && sequences[1]==2 && sequences[2]==3,
         "append.tail_aligned_prefix");
   Tov2AppendCandidate interior[]; uchar interior_arena[]; int interior_ends[];
   Check(ArrayResize(interior,3)==3 &&
         Candidate("event.1","event.synthetic.1","42",1,interior[0],interior_arena,interior_ends) &&
         Candidate("event.2","event.synthetic.2","43",1,interior[1],interior_arena,interior_ends) &&
         Candidate("event.4","event.synthetic.4","45",1,interior[2],interior_arena,interior_ends) &&
         state.Append(interior,interior_arena,interior_ends,capture,
                      "synthetic.capture.1",sequences)==TOV2_STATE_CONFLICT &&
         ArraySize(sequences)==0,"append.interior_prefix_rejected");

   Tov2AppendCandidate conflict[]; uchar conflict_arena[]; int conflict_ends[];
   Check(ArrayResize(conflict,1)==1 &&
         Candidate("event.other","event.synthetic.other","42",1,conflict[0],
                   conflict_arena,conflict_ends),"append.deal_revision_fixture");
   Check(state.Append(conflict,conflict_arena,conflict_ends,capture,
                      "synthetic.capture.1",sequences)==TOV2_STATE_CONFLICT &&
         ArraySize(sequences)==0,
         "append.deal_revision_conflict");
   Check(state.Snapshot(snapshot) && snapshot.produced==3,
         "append.conflict_root_unchanged");
   state.Close();
}

void AppendBoundaries()
{
   CTov2TelemetryMemoryStore store;
   CTov2TelemetryState state(GetPointer(store),GetPointer(synthetic_validator),Identity());
   Check(NewInitialized(store,state),"append_bounds.initialize");
   Tov2AppendCandidate none[]; uchar no_events[],capture[]; int no_ends[]; long sequences[];
   Check(Bytes("capture.synthetic.zero",capture) &&
         state.Append(none,no_events,no_ends,capture,"synthetic.capture.1",sequences)==TOV2_STATE_OK &&
         ArraySize(sequences)==0,
         "append.zero_event");

   Tov2AppendCandidate batch[]; uchar arena[]; int ends[];
   Check(ArrayResize(batch,32)==32,"append.batch_32_allocate");
   for(int i=0;i<32;i++)
      Check(Candidate("event."+IntegerToString(i+1),"event.payload."+IntegerToString(i+1),
                      IntegerToString(100+i),1,batch[i],arena,ends),
            "append.flat_arena."+IntegerToString(i+1));
   Check(Bytes("capture.synthetic.32",capture) &&
         state.Append(batch,arena,ends,capture,"synthetic.capture.1",sequences)==TOV2_STATE_OK,
         "append.batch_32");
   Tov2AppendCandidate too_many[]; int too_many_ends[];
   Check(ArrayResize(too_many,33)==33 && ArrayResize(too_many_ends,33)==33,
         "append.batch_33_fixture");
   Check(state.Append(too_many,arena,too_many_ends,capture,"synthetic.capture.1",sequences)==
         TOV2_STATE_LIMIT,"append.batch_33");
   Check(state.ReservedTransition("PREPARE")==TOV2_STATE_UNSUPPORTED &&
         state.ReservedTransition("ACK")==TOV2_STATE_UNSUPPORTED &&
         state.ReservedTransition("REPLACE")==TOV2_STATE_UNSUPPORTED,
         "transition.outbox_reserved");
   Check(Tov2StorageRuntimeTransition("INIT") &&
         Tov2StorageRuntimeTransition("APPEND") &&
         Tov2StorageRuntimeTransition("DIAGNOSTIC") &&
         Tov2StorageRuntimeTransition("CHECKPOINT"),"transition.supported");
   state.Close();
}

void QueueBoundary()
{
   CTov2TelemetryMemoryStore store;
   CTov2TelemetryState state(GetPointer(store),GetPointer(synthetic_validator),Identity());
   Check(NewInitialized(store,state),"queue.initialize");
   int serial=0;
   for(int group=0;group<16;group++)
   {
      Tov2AppendCandidate batch[]; uchar arena[],capture[]; int ends[]; long sequences[];
      Check(ArrayResize(batch,32)==32,"queue.batch_allocate."+IntegerToString(group));
      for(int i=0;i<32;i++)
      {
         serial++;
         Check(Candidate("queue."+IntegerToString(serial),"q."+IntegerToString(serial),
                         IntegerToString(10000+serial),1,batch[i],arena,ends),
               "queue.candidate."+IntegerToString(serial));
      }
      Check(Bytes("capture.queue."+IntegerToString(serial),capture) &&
            state.Append(batch,arena,ends,capture,"synthetic.capture.1",sequences)==TOV2_STATE_OK,
            "queue.publish."+IntegerToString(group));
   }
   Tov2LocalState snapshot;
   Check(state.Snapshot(snapshot) && snapshot.event_count==512,"queue.512");
   Tov2AppendCandidate one[]; uchar arena[],capture[]; int ends[]; long sequences[];
   Check(ArrayResize(one,1)==1 && Candidate("queue.513","q.513","20000",1,
         one[0],arena,ends) && Bytes("capture.queue.513",capture),"queue.513_fixture");
   Check(state.Append(one,arena,ends,capture,"synthetic.capture.1",sequences)==TOV2_STATE_LIMIT &&
         ArraySize(sequences)==0,
         "queue.513");
   state.Close();
}

void BudgetBoundary()
{
   Tov2StorageEntry entries[];
   Check(ArrayResize(entries,256)==256,"budget.bytes_fixture");
   for(int i=0;i<256;i++)
   {
      entries[i].locator=Tov2StorageObjectLocator(i+1,1);
      entries[i].relative_path=Tov2StorageRelativePath(entries[i].locator);
      entries[i].size=262144;
      entries[i].sha=Repeat("a",64);
   }
   Check(Tov2StoragePreflight(entries,"APPEND",0,0),"budget.normal");
   Check(!Tov2StoragePreflight(entries,"APPEND",1,0),"budget.normal_blocks_reserve");
   Check(!Tov2StoragePreflight(entries,"PREPARE",1,0),"budget.prepare_blocks_reserve");
   Check(Tov2StoragePreflight(entries,"ACK",1,1),"budget.ack_reserve_later");
   Check(Tov2StoragePreflight(entries,"CHECKPOINT",1,1),"budget.reserve");
   Check(Tov2StoragePreflight(entries,"DIAGNOSTIC",8388608,1),
         "budget.diagnostic_reserve");
   entries[0].locator=Tov2StorageOwnerLocator();
   entries[0].relative_path="owner.lock";
   entries[0].size=0;
   entries[0].sha="-";
   long bytes=0,highest=0; int files=0;
   Check(Tov2StorageBudget(entries,bytes,files,highest),"budget.owner_zero_only");
   entries[0].size=1;
   Check(!Tov2StorageBudget(entries,bytes,files,highest),"budget.owner_nonzero_blocks");

   Tov2StorageEntry file_entries[];
   Check(ArrayResize(file_entries,4224)==4224,"budget.files_fixture");
   for(int i=0;i<4224;i++)
   {
      file_entries[i].locator=Tov2StorageObjectLocator(i+1,1);
      file_entries[i].relative_path=Tov2StorageRelativePath(file_entries[i].locator);
      file_entries[i].size=1;
      file_entries[i].sha=Repeat("b",64);
   }
   Check(!Tov2StoragePreflight(file_entries,"APPEND",0,0),
         "budget.normal_file_limit");
   Check(Tov2StoragePreflight(file_entries,"CHECKPOINT",0,0),
         "budget.reserve_file_limit");
   Check(!Tov2StoragePreflight(file_entries,"CHECKPOINT",0,1),
         "budget.reserve_file_exhausted");

   uchar maximum[],frame[];
   Check(ArrayResize(maximum,262144)==262144,"payload.262144_allocate");
   ArrayInitialize(maximum,65);
   Check(Tov2RecordEncode("EVENT",1,maximum,frame),"payload.262144");
   Check(ArraySize(frame)<=262345 && TOV2_RECORD_FRAME_MAX==262345,"frame.262345");
}

void InventoryAndStorageOutcomes()
{
   Tov2StorageLocator valid=Tov2StorageObjectLocator(7,3);
   Tov2StorageLocator invalid=Tov2StorageObjectLocator(0,3);
   Check(Tov2StorageRelativePath(valid)=="objects/7-3.rec","locator.canonical");
   Check(Tov2StorageRelativePath(invalid)=="","locator.reject");
   Check(Tov2StorageDefiniteRead(TOV2_STORE_OK) &&
         Tov2StorageDefiniteRead(TOV2_STORE_ABSENT) &&
         !Tov2StorageDefiniteRead(TOV2_STORE_IO_ERROR),"inventory.three_way");
   Check(Tov2StorageDefiniteCreate(TOV2_STORE_CREATED) &&
         Tov2StorageDefiniteCreate(TOV2_STORE_EXISTS_SAME) &&
         Tov2StorageDefiniteCreate(TOV2_STORE_CONFLICT),"create.outcomes");
   Check(Tov2StorageDefiniteDelete(TOV2_STORE_DELETED) &&
         Tov2StorageDefiniteDelete(TOV2_STORE_ABSENT) &&
         Tov2StorageDefiniteDelete(TOV2_STORE_CONFLICT),"delete.outcomes");
}

void IdentityAndReadFaults()
{
   CTov2TelemetryMemoryStore store;
   CTov2TelemetryState state(GetPointer(store),GetPointer(synthetic_validator),Identity());
   Check(NewInitialized(store,state),"identity.initialize");
   store.ArmFault("REVALIDATE",1,TOV2_MEMORY_FAULT_BEFORE);
   Tov2LocalState snapshot;
   Check(!state.Snapshot(snapshot) && state.ReloadRequired(),"identity.snapshot_recheck");
   store.ClearFault();
   Check(state.Recover()==TOV2_STATE_OK,"identity.snapshot_recover");
   store.ArmFault("REVALIDATE",1,TOV2_MEMORY_FAULT_AFTER);
   uchar capture[]; Tov2AppendCandidate none[]; uchar arena[]; int ends[]; long sequences[];
   Check(Bytes("capture.revalidate",capture) &&
         state.Append(none,arena,ends,capture,"synthetic.capture.1",sequences)!=TOV2_STATE_OK,
         "ownership.before_each_access");
   CTov2TelemetryState reacquired(GetPointer(store),GetPointer(synthetic_validator),Identity());
   Check(reacquired.Open()==TOV2_STATE_OK,"memory.revalidate_after_reusable");
   reacquired.Close();
   state.Close(); store.Crash();

   CTov2TelemetryState reader(GetPointer(store),GetPointer(synthetic_validator),Identity());
   Check(reader.Open()==TOV2_STATE_OK,"read_fault.open");
   store.ArmFault("INVENTORY",1,TOV2_MEMORY_FAULT_BEFORE);
   Check(reader.Recover()==TOV2_STATE_IO_ERROR,"inventory.error_not_empty");
   store.ClearFault();
   store.ArmFault("INVENTORY",1,TOV2_MEMORY_FAULT_AFTER);
   Check(reader.Recover()==TOV2_STATE_IO_ERROR,"inventory.after_error_not_empty");
   store.ClearFault();
   store.ArmFault("READ",1,TOV2_MEMORY_FAULT_AFTER);
   Check(reader.Recover()==TOV2_STATE_RECOVERY_REQUIRED,"read.error_blocks_recovery");
   reader.Close();
}

void InvalidatedDependencies()
{
   CTov2TelemetryMemoryStore *store=new CTov2TelemetryMemoryStore();
   CSyntheticPayloadValidator *validator=new CSyntheticPayloadValidator();
   CTov2TelemetryState *before_open=new CTov2TelemetryState(store,validator,Identity());
   delete validator;
   Check(before_open.Open()==TOV2_STATE_INVALID,
         "pointer.validator_invalid_before_open");
   before_open.Close();
   delete before_open;
   delete store;

   CTov2TelemetryMemoryStore close_store;
   CSyntheticPayloadValidator *close_validator=new CSyntheticPayloadValidator();
   CTov2TelemetryState *close_state=new CTov2TelemetryState(GetPointer(close_store),
                                                            close_validator,Identity());
   Check(close_state.Open()==TOV2_STATE_OK,"pointer.validator_close_fixture");
   delete close_validator;
   close_state.Close();
   CSyntheticPayloadValidator replacement;
   CTov2TelemetryState probe(GetPointer(close_store),GetPointer(replacement),Identity());
   Check(probe.Open()==TOV2_STATE_OK,"pointer.validator_invalid_close_releases_storage");
   probe.Close();
   delete close_state;

   store=new CTov2TelemetryMemoryStore();
   validator=new CSyntheticPayloadValidator();
   CTov2TelemetryState *after_open=new CTov2TelemetryState(store,validator,Identity());
   Check(after_open.Open()==TOV2_STATE_OK &&
         after_open.Recover()==TOV2_STATE_NOT_STARTED,"pointer.dynamic_open");
   delete store;
   Tov2LocalState snapshot;
   Check(!after_open.Snapshot(snapshot),"pointer.storage_invalid_guarded");
   after_open.Close();
   Check(true,"pointer.invalid_close_no_dereference");
   delete after_open;
   delete validator;
}

void MemoryAllocationAndUnexpectedOutcomes()
{
   string faults[2]={"ALLOC_RECORD","COPY_RECORD"};
   for(int i=0;i<2;i++)
   {
      CTov2TelemetryMemoryStore store;
      CTov2TelemetryState state(GetPointer(store),GetPointer(synthetic_validator),Identity());
      Check(NewInitialized(store,state),"memory.logical_fixture."+IntegerToString(i));
      int records=store.RecordCount();
      store.ArmInternalFault(faults[i],1);
      Check(!AppendOne(state,"event.alloc","event.alloc","capture.alloc") &&
            state.ReloadRequired() && store.RecordCount()==records &&
            store.PersistentCount()==records,
            "memory.no_phantom_record."+IntegerToString(i));
      store.Crash();
      Tov2LocalState recovered; int recovery=-1;
      Check(Fresh(store,Identity(),recovered,recovery) && recovered.generation==1,
            "memory.allocation_failure_recovery."+IntegerToString(i));
   }

   CTov2TelemetryMemoryStore create_store;
   CTov2TelemetryState create_state(GetPointer(create_store),GetPointer(synthetic_validator),Identity());
   Check(NewInitialized(create_store,create_state),"outcome.create_fixture");
   create_store.ArmOutcome("CREATE",1,TOV2_STORE_CONFLICT);
   Check(!AppendOne(create_state,"event.conflict","event.conflict","capture.conflict") &&
         !create_state.ReloadRequired(),"outcome.create_conflict_definite");
   create_store.ClearOutcome();
   create_store.ArmOutcome("CREATE",1,TOV2_STORE_ACQUIRED);
   Check(!AppendOne(create_state,"event.outcome","event.outcome","capture.outcome") &&
         create_state.ReloadRequired(),"outcome.create_unexpected_reload");
   create_store.Crash();
   Tov2LocalState recovered; int recovery=-1;
   Check(Fresh(create_store,Identity(),recovered,recovery) && recovered.generation==1,
         "outcome.create_unexpected_recovery");

   CTov2TelemetryMemoryStore delete_store;
   CTov2TelemetryState delete_state(GetPointer(delete_store),GetPointer(synthetic_validator),Identity());
   Check(NewInitialized(delete_store,delete_state) &&
         delete_state.PublishDiagnostic("DATA_MISSING","HISTORY_UNAVAILABLE")==TOV2_STATE_OK,
         "outcome.delete_fixture");
   delete_store.ClearDeleteLog();
   delete_store.ArmInternalFault("ALLOC_LOG",1);
   Check(delete_state.Compact()!=TOV2_STATE_OK && delete_state.ReloadRequired() &&
         delete_store.DeleteLogCount()==0,"memory.no_phantom_delete_log");
   delete_store.Crash();
   CTov2TelemetryState delete_retry(GetPointer(delete_store),GetPointer(synthetic_validator),Identity());
   Check(delete_retry.Open()==TOV2_STATE_OK && delete_retry.Recover()==TOV2_STATE_OK,
         "memory.delete_log_failure_recovery");
   delete_store.ArmOutcome("DELETE",1,TOV2_STORE_CONFLICT);
   Check(delete_retry.Compact()==TOV2_STATE_CONFLICT && !delete_retry.ReloadRequired(),
         "outcome.delete_conflict_definite");
   delete_store.ClearOutcome();
   delete_store.ArmOutcome("DELETE",1,TOV2_STORE_CREATED);
   Check(delete_retry.Compact()!=TOV2_STATE_OK && delete_retry.ReloadRequired(),
         "outcome.delete_unexpected_reload");
   delete_store.Crash();
}

void CompactionAndDeleteFaults()
{
   CTov2TelemetryMemoryStore store;
   CTov2TelemetryState state(GetPointer(store),GetPointer(synthetic_validator),Identity());
   Check(NewInitialized(store,state),"compact.initialize");
   Check(state.PublishDiagnostic("DATA_MISSING","HISTORY_UNAVAILABLE")==TOV2_STATE_OK,
         "compact.diagnostic");
   Check(state.Compact()==TOV2_STATE_OK,"compact.first_checkpoint");
   Check(state.Compact()==TOV2_STATE_OK,"compact.second_checkpoint");
   Tov2LocalState current;
   Check(state.Snapshot(current) && current.parent_generation>0,"compact.retention");
   Check(store.Exists(Tov2StorageStateLocator(current.generation)) &&
         store.Exists(Tov2StorageCommitLocator(current.generation)) &&
         store.Exists(Tov2StorageStateLocator(current.parent_generation)) &&
         store.Exists(Tov2StorageCommitLocator(current.parent_generation)),
         "compact.previous_root_retained");
   uchar abandoned_payload[],abandoned_frame[];
   Check(Bytes("EVENT1|"+Identity()+"|abandoned.compaction|-|0|event.abandoned",
               abandoned_payload) &&
         Tov2RecordEncode("EVENT",50,abandoned_payload,abandoned_frame) &&
         store.Inject(Tov2StorageObjectLocator(50,1),abandoned_frame),
         "compact.abandoned_fixture");
   Check(state.Compact()==TOV2_STATE_OK &&
         store.Exists(Tov2StorageObjectLocator(50,1)),"compact.abandoned");
   Check(state.Snapshot(current),"compact.final_snapshot");
   state.Close(); store.Crash();
   int recovery=-1;
   Check(Fresh(store,Identity(),current,recovery) && recovery==TOV2_STATE_OK,
         "compact.fresh_recovery");

   for(int mode=TOV2_MEMORY_FAULT_BEFORE;mode<=TOV2_MEMORY_FAULT_AFTER;mode++)
   {
      CTov2TelemetryMemoryStore fault_store;
      CTov2TelemetryState fault_state(GetPointer(fault_store),GetPointer(synthetic_validator),Identity());
      Check(NewInitialized(fault_store,fault_state),"delete_fault.initialize."+
            IntegerToString(mode));
      Check(fault_state.PublishDiagnostic("DATA_MISSING","HISTORY_UNAVAILABLE")==
            TOV2_STATE_OK && fault_state.Compact()==TOV2_STATE_OK,
            "delete_fault.roots."+IntegerToString(mode));
      int before=fault_store.PersistentCount();
      fault_store.ArmFault("DELETE",1,mode);
      int compact=fault_state.Compact();
      Check(compact!=TOV2_STATE_OK && fault_state.ReloadRequired(),
            "compact.delete_fault."+IntegerToString(mode));
      int after=fault_store.PersistentCount();
      Check(before+2-after<=TOV2_STORAGE_DELETE_BATCH,
            "compact.delete_batch_bound."+IntegerToString(mode));
      fault_store.Crash();
      Tov2LocalState recovered; int fresh_result=-1;
      Check(Fresh(fault_store,Identity(),recovered,fresh_result) &&
            fresh_result==TOV2_STATE_OK,"compact.delete_fault_recovery."+
            IntegerToString(mode));
   }
   Check(TOV2_STORAGE_DELETE_BATCH==32,"compact.delete_32");
}

void ParentMetadataIndependence()
{
   CTov2TelemetryMemoryStore store;
   CTov2TelemetryState state(GetPointer(store),GetPointer(synthetic_validator),Identity());
   Check(NewInitialized(store,state) &&
         state.PublishDiagnostic("DATA_MISSING","HISTORY_UNAVAILABLE")==TOV2_STATE_OK,
         "recovery.parent_independence_fixture");
   Tov2LocalState current;
   Check(state.Snapshot(current) && current.parent_generation==1,
         "recovery.parent_independence_snapshot");
   state.Close();
   Check(store.Remove(Tov2StorageCommitLocator(1)) &&
         store.Remove(Tov2StorageStateLocator(1)),
         "recovery.parent_payloads_removed");
   store.Crash();
   int recovery=-1;
   Check(Fresh(store,Identity(),current,recovery) && recovery==TOV2_STATE_OK &&
         current.generation==2,"recovery.parent_not_dependency");
}

void CompactionRetainedRootReadFaults()
{
   int occurrences[2]={28,32};
   string labels[2]={"compact.current_revalidate_before_delete",
                     "compact.previous_revalidate_before_delete"};
   for(int mode=TOV2_MEMORY_FAULT_BEFORE;mode<=TOV2_MEMORY_FAULT_AFTER;mode++)
   {
      for(int i=0;i<2;i++)
      {
         CTov2TelemetryMemoryStore store;
         CTov2TelemetryState state(GetPointer(store),GetPointer(synthetic_validator),Identity());
         Check(NewInitialized(store,state) &&
               state.PublishDiagnostic("DATA_MISSING","HISTORY_UNAVAILABLE")==TOV2_STATE_OK,
               "compact.revalidate_fixture."+
               IntegerToString(mode)+"."+IntegerToString(i));
         store.ClearDeleteLog();
         // Reads 1-4 verify current, 5-8 load it, 9 reads its commit, 10-11
         // verify new metadata, 12-15 recover the checkpoint, 16-23 load both
         // retained roots, 24-26 read retired commit/state/registration, 27
         // validates the protected capture in retired context, 28-31 revalidate
         // current, and 32-35 revalidate previous immediately before deletion.
         store.ArmFault("READ",occurrences[i],mode);
         Check(state.Compact()==TOV2_STATE_RECOVERY_REQUIRED &&
               store.DeleteLogCount()==0,labels[i]+"."+IntegerToString(mode));
         store.Crash();
         Tov2LocalState recovered; int recovery=-1;
         Check(Fresh(store,Identity(),recovered,recovery) && recovered.generation==3,
               "compact.revalidate_fresh."+IntegerToString(mode)+"."+
               IntegerToString(i));
      }
   }
}

void CompactionOrderAndClassInterruptions()
{
   CTov2TelemetryMemoryStore ordered_store;
   CTov2TelemetryState ordered(GetPointer(ordered_store),
                               GetPointer(synthetic_validator),Identity());
   Check(NewInitialized(ordered_store,ordered) &&
         AppendOne(ordered,"event.1","event.synthetic.1","capture.synthetic.1"),
         "compact.order_fixture");
   Tov2AppendCandidate none[]; uchar arena[],capture[]; int ends[]; long sequences[];
   Check(Bytes("capture.synthetic.2",capture) &&
         ordered.Append(none,arena,ends,capture,"synthetic.capture.1",sequences)==TOV2_STATE_OK,
         "compact.order_second_root");
   ordered_store.ClearDeleteLog();
   Check(ordered.Compact()==TOV2_STATE_OK && ordered_store.DeleteLogCount()>=3,
         "compact.order_run");
   Check(ordered_store.DeleteLogKind(0)==TOV2_LOC_OBJECT &&
         ordered_store.DeleteLogKind(1)==TOV2_LOC_STATE,
         "compact.object_before_state");
   Check(ordered_store.DeleteLogKind(1)==TOV2_LOC_STATE &&
         ordered_store.DeleteLogKind(2)==TOV2_LOC_COMMIT,
         "compact.state_before_commit");
   // The new CHECKPOINT is generation 4, its previous root is generation 3,
   // and only their linked immediate grandparent generation 2 may retire.
   Check(ordered_store.DeleteLogGeneration(0)==2 &&
         ordered_store.DeleteLogGeneration(1)==2 &&
         ordered_store.DeleteLogGeneration(2)==2,
         "compact.retired_generation_order");
   ordered.Close();

   for(int occurrence=1;occurrence<=3;occurrence++)
   {
      CTov2TelemetryMemoryStore store;
      CTov2TelemetryState state(GetPointer(store),GetPointer(synthetic_validator),Identity());
      Check(NewInitialized(store,state) &&
            AppendOne(state,"event.1","event.synthetic.1","capture.synthetic.1"),
            "compact.class_fixture."+IntegerToString(occurrence));
      uchar next_capture[];
      Check(Bytes("capture.synthetic.2",next_capture) &&
            state.Append(none,arena,ends,next_capture,"synthetic.capture.1",sequences)==TOV2_STATE_OK,
            "compact.class_second_root."+IntegerToString(occurrence));
      store.ClearDeleteLog();
      store.ArmFault("DELETE",occurrence,TOV2_MEMORY_FAULT_AFTER);
      Check(state.Compact()!=TOV2_STATE_OK && state.ReloadRequired() &&
            store.DeleteLogCount()==occurrence,
            "compact.class_interruptions."+IntegerToString(occurrence));
      store.Crash();
      Tov2LocalState recovered; int recovery=-1;
      Check(Fresh(store,Identity(),recovered,recovery) && recovery==TOV2_STATE_OK,
            "compact.class_recovery."+IntegerToString(occurrence));
   }
}

void ResumableCompactionAndPositiveAuthority()
{
   CTov2TelemetryMemoryStore store;
   CTov2TelemetryState seed(GetPointer(store),GetPointer(synthetic_validator),Identity());
   Tov2LocalState base;
   Check(NewInitialized(store,seed) && seed.Snapshot(base),
         "compact.multicall_fixture");
   seed.Close();
   Check(InjectRetirementChain(store,base,32,true,false,true),
         "compact.multicall_chain");
   store.Crash();
   CTov2TelemetryState state(GetPointer(store),GetPointer(synthetic_validator),Identity());
   Check(state.Open()==TOV2_STATE_OK && state.Recover()==TOV2_STATE_OK,
         "compact.multicall_recover");
   store.ClearDeleteLog();
   Check(state.Compact()==TOV2_STATE_OK && store.DeleteLogCount()==30 &&
         store.Exists(Tov2StorageStateLocator(2)) &&
         store.Exists(Tov2StorageCommitLocator(2)),
         "compact.multicall_object_prefix");
   Check(state.Compact()==TOV2_STATE_OK && store.DeleteLogCount()==34 &&
         !store.Exists(Tov2StorageStateLocator(2)) &&
         !store.Exists(Tov2StorageCommitLocator(2)),
         "compact.multicall_complete");
   Check(store.Exists(Tov2StorageStateLocator(5)) &&
         store.Exists(Tov2StorageCommitLocator(5)),
         "compact.disconnected_valid_preserved");
   Check(store.DeleteLogKind(32)==TOV2_LOC_STATE &&
         store.DeleteLogKind(33)==TOV2_LOC_COMMIT,
         "compact.metadata_last_after_objects");
   state.Close();

   CTov2TelemetryMemoryStore retry_store;
   CTov2TelemetryState retry_seed(GetPointer(retry_store),GetPointer(synthetic_validator),Identity());
   Check(NewInitialized(retry_store,retry_seed) && retry_seed.Snapshot(base),
         "compact.after_effect_fixture");
   retry_seed.Close();
   Check(InjectRetirementChain(retry_store,base,32,true,false,false),
         "compact.after_effect_chain");
   retry_store.Crash();
   CTov2TelemetryState retry(GetPointer(retry_store),GetPointer(synthetic_validator),Identity());
   Check(retry.Open()==TOV2_STATE_OK && retry.Recover()==TOV2_STATE_OK,
         "compact.after_effect_recover");
   retry_store.ArmFault("DELETE",1,TOV2_MEMORY_FAULT_AFTER);
   Check(retry.Compact()!=TOV2_STATE_OK && retry.ReloadRequired(),
         "compact.after_effect_reload");
   retry_store.Crash(); retry_store.ClearFault();
   CTov2TelemetryState resumed(GetPointer(retry_store),GetPointer(synthetic_validator),Identity());
   Check(resumed.Open()==TOV2_STATE_OK && resumed.Recover()==TOV2_STATE_OK &&
         resumed.Compact()==TOV2_STATE_OK && resumed.Compact()==TOV2_STATE_OK &&
         !retry_store.Exists(Tov2StorageCommitLocator(2)),
         "compact.after_effect_retry_resumes");
   resumed.Close();

   CTov2TelemetryMemoryStore metadata_store;
   CTov2TelemetryState metadata(GetPointer(metadata_store),GetPointer(synthetic_validator),Identity());
   Check(NewInitialized(metadata_store,metadata) &&
         metadata.PublishDiagnostic("DATA_MISSING","HISTORY_UNAVAILABLE")==TOV2_STATE_OK,
         "compact.metadata_after_effect_fixture");
   metadata_store.ArmFault("DELETE",1,TOV2_MEMORY_FAULT_AFTER);
   Check(metadata.Compact()!=TOV2_STATE_OK && metadata.ReloadRequired(),
         "compact.state_after_effect_reload");
   metadata_store.Crash(); metadata_store.ClearFault();
   CTov2TelemetryState metadata_retry(GetPointer(metadata_store),
                                      GetPointer(synthetic_validator),Identity());
   Check(metadata_retry.Open()==TOV2_STATE_OK &&
         metadata_retry.Recover()==TOV2_STATE_OK &&
         metadata_retry.Compact()==TOV2_STATE_OK &&
         !metadata_store.Exists(Tov2StorageCommitLocator(1)),
         "compact.state_after_effect_retry");
   metadata_retry.Close();

   CTov2TelemetryMemoryStore max_store;
   CTov2TelemetryState max_seed(GetPointer(max_store),GetPointer(synthetic_validator),Identity());
   Check(NewInitialized(max_store,max_seed) && max_seed.Snapshot(base),
         "compact.max_cleanup_fixture");
   max_seed.Close();
   Check(InjectRetirementChain(max_store,base,1,true,false,false,
                               TOV2_LOCAL_MAX_COUNTER-1,TOV2_LOCAL_MAX_COUNTER),
         "compact.max_cleanup_chain");
   max_store.Crash();
   CTov2TelemetryState max_state(GetPointer(max_store),GetPointer(synthetic_validator),Identity());
   int max_before=max_store.PersistentCount();
   Tov2LocalState max_snapshot;
   Check(max_state.Open()==TOV2_STATE_OK && max_state.Recover()==TOV2_STATE_OK &&
         max_state.PublishDiagnostic("DATA_MISSING","HISTORY_UNAVAILABLE")==
         TOV2_STATE_LIMIT && !max_state.ReloadRequired() &&
         max_store.PersistentCount()==max_before && max_state.Snapshot(max_snapshot) &&
         max_snapshot.generation==TOV2_LOCAL_MAX_COUNTER,
         "diagnostic.max_valid_limit_no_mutation");
   int before_cleanup=max_store.PersistentCount();
   Check(max_state.Compact()==TOV2_STATE_OK &&
         !max_store.Exists(Tov2StorageCommitLocator(2)),
         "compact.max_existing_checkpoint_cleanup");
   Check(max_store.PersistentCount()<before_cleanup,
         "diagnostic.max_limit_preserved_cleanup");
   Check(max_state.Compact()==TOV2_STATE_LIMIT,
         "compact.max_new_checkpoint_refused");
   max_state.Close();

   CTov2TelemetryMemoryStore unack_store;
   CTov2TelemetryState unack_seed(GetPointer(unack_store),GetPointer(synthetic_validator),Identity());
   Check(NewInitialized(unack_store,unack_seed) && unack_seed.Snapshot(base),
         "compact.unack_fixture");
   unack_seed.Close();
   Check(InjectRetirementChain(unack_store,base,1,false,false,false),
         "compact.unack_chain");
   unack_store.Crash();
   CTov2TelemetryState unack(GetPointer(unack_store),GetPointer(synthetic_validator),Identity());
   Check(unack.Open()==TOV2_STATE_OK && unack.Recover()==TOV2_STATE_OK &&
         unack.Compact()==TOV2_STATE_OK &&
         unack_store.Exists(Tov2StorageObjectLocator(2,1)) &&
         unack_store.Exists(Tov2StorageCommitLocator(2)),
         "compact.unack_event_preserved");
   unack.Close();

   CTov2TelemetryMemoryStore pending_store;
   CTov2TelemetryState pending_seed(GetPointer(pending_store),GetPointer(synthetic_validator),Identity());
   Check(NewInitialized(pending_store,pending_seed) && pending_seed.Snapshot(base),
         "compact.unproven_pending_fixture");
   pending_seed.Close();
   Check(InjectRetirementChain(pending_store,base,1,false,true,false),
         "compact.unproven_pending_chain");
   pending_store.Crash();
   CTov2TelemetryState pending(GetPointer(pending_store),GetPointer(synthetic_validator),Identity());
   Check(pending.Open()==TOV2_STATE_OK && pending.Recover()==TOV2_STATE_OK &&
         pending.Compact()==TOV2_STATE_OK &&
         pending_store.Exists(Tov2StorageObjectLocator(2,1)) &&
         pending_store.Exists(Tov2StorageCommitLocator(2)),
         "compact.unproven_pending_preserved");
   pending.Close();
}

void ProtectedAliasSafety()
{
   CTov2TelemetryMemoryStore event_store;
   CTov2TelemetryState event_seed(GetPointer(event_store),GetPointer(synthetic_validator),Identity());
   Tov2LocalState base;
   Check(NewInitialized(event_store,event_seed) && event_seed.Snapshot(base),
         "compact.alias_event_fixture");
   event_seed.Close();
   Check(InjectProtectedAliasChain(event_store,base,true,false),
         "compact.alias_event_chain");
   event_store.Crash(); event_store.ClearDeleteLog();
   CTov2TelemetryState event_state(GetPointer(event_store),GetPointer(synthetic_validator),Identity());
   Check(event_state.Open()==TOV2_STATE_OK && event_state.Recover()==TOV2_STATE_OK &&
         event_state.Compact()==TOV2_STATE_RECOVERY_REQUIRED &&
         event_store.DeleteLogCount()==0 &&
         event_store.Exists(Tov2StorageStateLocator(2)) &&
         event_store.Exists(Tov2StorageCommitLocator(2)),
         "compact.protected_event_metadata_mismatch_blocks");
   event_state.Close();

   CTov2TelemetryMemoryStore capture_store;
   CTov2TelemetryState capture_seed(GetPointer(capture_store),GetPointer(synthetic_validator),Identity());
   Check(NewInitialized(capture_store,capture_seed) && capture_seed.Snapshot(base),
         "compact.alias_capture_fixture");
   capture_seed.Close();
   Check(InjectProtectedAliasChain(capture_store,base,false,true),
         "compact.alias_capture_chain");
   capture_store.Crash(); capture_store.ClearDeleteLog();
   CTov2TelemetryState capture_state(GetPointer(capture_store),GetPointer(synthetic_validator),Identity());
   Check(capture_state.Open()==TOV2_STATE_OK && capture_state.Recover()==TOV2_STATE_OK &&
         capture_state.Compact()==TOV2_STATE_RECOVERY_REQUIRED &&
         capture_store.DeleteLogCount()==0 &&
         capture_store.Exists(Tov2StorageStateLocator(2)) &&
         capture_store.Exists(Tov2StorageCommitLocator(2)),
         "compact.protected_capture_schema_mismatch_blocks");
   capture_state.Close();
}

void OnStart()
{
   synthetic_validator.AcceptAll();
   BasicLifecycle();
   InitializationFaults();
   AppendFaults();
   ReadbackFaults();
   MetadataPublicationFaults();
   RecoveryAuthority();
   TypedValidationAndMissingRegistration();
   MutationFreshRootVerification();
   ValidatorAssociationsAndSchemaMigration();
   AbandonedGenerationAndReplay();
   MixedRetryAndIdentityConflicts();
   AppendBoundaries();
   QueueBoundary();
   BudgetBoundary();
   InventoryAndStorageOutcomes();
   IdentityAndReadFaults();
   InvalidatedDependencies();
   MemoryAllocationAndUnexpectedOutcomes();
   CompactionAndDeleteFaults();
   ParentMetadataIndependence();
   CompactionRetainedRootReadFaults();
   CompactionOrderAndClassInterruptions();
   ResumableCompactionAndPositiveAuthority();
   ProtectedAliasSafety();

   if(tov2_state_failures==0)
      PrintFormat("TOV2_STATE_PASS checks=%d failures=0",tov2_state_checks);
   else
      PrintFormat("TOV2_STATE_FAIL checks=%d failures=%d",
                  tov2_state_checks,tov2_state_failures);
}
~~~

## E. `apps/execution-edge/test/mt5-telemetry-state-v2-source.test.ts`

~~~typescript
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '../../..');
const agent = join(root, 'mt5/TradeOpsAgent');
const targets = [
  'Include/TradeOpsTelemetryStorage.mqh',
  'Include/TradeOpsTelemetryState.mqh',
  'Scripts/Support/TradeOpsTelemetryMemoryStore.mqh',
  'Scripts/TradeOpsTelemetryStateSelfTest.mq5',
] as const;

function source(relativePath: string): string {
  const full = join(agent, relativePath);
  expect(existsSync(full), relativePath).toBe(true);
  return readFileSync(full, 'utf8');
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function body(value: string, start: string, end: string): string {
  const from = value.indexOf(start);
  const to = value.indexOf(end, from + start.length);
  expect(from, start).toBeGreaterThanOrEqual(0);
  expect(to, end).toBeGreaterThan(from);
  return value.slice(from, to);
}

describe('MT5 telemetry pure state runtime source seam', () => {
  it('requires all five complete checkpoint sources', () => {
    const missing = targets.filter((path) => !existsSync(join(agent, path)));
    expect(missing).toEqual([]);
    const all = new Map<string, string>(targets.map((path) => [path, source(path)]));
    all.set('test/mt5-telemetry-state-v2-source.test.ts', readFileSync(import.meta.filename, 'utf8'));
    expect(all.size).toBe(5);
    for (const [path, text] of all) {
      expect(text.length, path).toBeGreaterThan(500);
      for (const parts of [['T', 'ODO'], ['T', 'BD'], ['sim', 'ilar', ' ', 'to']])
        expect(text, path).not.toContain(parts.join(''));
    }
  });

  it('pins the locator-only storage interface and explicit outcome vocabulary', () => {
    const storage = source('Include/TradeOpsTelemetryStorage.mqh');
    expect(storage).toContain('struct Tov2StorageLocator');
    expect(storage).toContain('string relative_path;');
    expect(storage).toContain('virtual int Acquire(const string installation_key,string &session_token)=0;');
    expect(storage).toContain('virtual int Revalidate(const string session_token)=0;');
    expect(storage).toContain('virtual int Inventory(const string session_token,Tov2StorageEntry &entries[])=0;');
    expect(storage).toContain('virtual int Read(const string session_token,const Tov2StorageLocator &locator,');
    expect(storage).toContain('virtual int CreateExact(const string session_token,const Tov2StorageLocator &locator,');
    expect(storage).toContain('virtual int DeleteExact(const string session_token,const Tov2StorageLocator &locator,');
    expect(storage).toContain('virtual void Close(const string session_token)=0;');
    for (const outcome of [
      'TOV2_STORE_OK', 'TOV2_STORE_ABSENT', 'TOV2_STORE_ACQUIRED',
      'TOV2_STORE_BUSY', 'TOV2_STORE_CREATED', 'TOV2_STORE_EXISTS_SAME',
      'TOV2_STORE_DELETED', 'TOV2_STORE_CONFLICT', 'TOV2_STORE_IO_ERROR',
      'TOV2_STORE_OWNERSHIP_LOST', 'TOV2_STORE_LIMIT', 'TOV2_STORE_INVALID',
    ]) expect(storage).toContain(outcome);
    expect(storage).toContain('return "owner.lock";');
    expect(storage).toContain('return "registration.rec";');
    expect(storage).toContain('return "states/"+Tov2LocalNumber(locator.generation)+".rec";');
    expect(storage).toContain('return "commits/"+Tov2LocalNumber(locator.generation)+".rec";');
    expect(storage).toContain('return "objects/"+Tov2LocalNumber(locator.generation)+"-"+');
    expect(storage).not.toMatch(/virtual .*path/iu);
  });

  it('pins limits, reserve policy, runtime transitions, and exact-delete ceiling', () => {
    const storage = source('Include/TradeOpsTelemetryStorage.mqh');
    const codec = source('Include/TradeOpsTelemetryStorageCodec.mqh');
    expect(storage).toContain('const long TOV2_STORAGE_NORMAL_BYTES=67108864;');
    expect(storage).toContain('const long TOV2_STORAGE_RESERVE_BYTES=8388608;');
    expect(storage).toContain('const int TOV2_STORAGE_NORMAL_FILES=4096;');
    expect(storage).toContain('const int TOV2_STORAGE_RESERVE_FILES=128;');
    expect(storage).toContain('const int TOV2_STORAGE_DELETE_BATCH=32;');
    expect(storage).toContain('return transition=="ACK" || transition=="CHECKPOINT" ||');
    expect(storage).toContain('return transition=="INIT" || transition=="APPEND" ||');
    expect(storage).toContain('return Tov2LocalTransition(transition);');
    expect(codec).toContain('const int TOV2_LOCAL_EVENTS=512;');
    expect(codec).toContain('const int TOV2_LOCAL_BATCH=32;');
    const record = source('Include/TradeOpsTelemetryRecord.mqh');
    expect(record).toContain('const int TOV2_RECORD_PAYLOAD_MAX=262144;');
    expect(record).toContain('const int TOV2_RECORD_FRAME_MAX=262345;');
    expect(storage).toContain('if(entries[i].size!=0) return false;');
  });

  it('keeps construction inert and freezes explicit state operations', () => {
    const state = source('Include/TradeOpsTelemetryState.mqh');
    const constructor = body(state, 'CTov2TelemetryState(ITov2TelemetryStorage *storage', 'int Open()');
    expect(constructor).not.toMatch(/m_storage\.(?:Acquire|Revalidate|Inventory|Read|CreateExact|DeleteExact|Close)/u);
    expect(constructor).not.toMatch(/m_validator\.(?:Registration|Capture|CaptureAdvance|Event|Pending|Ack)/u);
    expect(state).toContain('class ITov2TelemetryStatePayloadValidator');
    for (const method of ['Registration', 'Capture', 'CaptureAdvance', 'Event', 'Pending', 'Ack'])
      expect(state).toMatch(new RegExp(`virtual bool ${method}\\(`, 'u'));
    for (const call of ['Registration', 'Capture', 'CaptureAdvance', 'Event', 'Pending', 'Ack'])
      expect(state).toContain(`m_validator.${call}(`);
    expect(state).toMatch(/const uchar &previous_payload\[\],\s*const string previous_schema,/u);
    expect(state).toMatch(/const uchar &candidate_payload\[\],\s*const string candidate_schema,/u);
    expect(state).toContain('CheckPointer(m_storage)!=POINTER_INVALID');
    expect(state).toContain('CheckPointer(m_validator)!=POINTER_INVALID');
    expect(state).toContain('if(!DependenciesValid()) return TOV2_STATE_INVALID;');
    expect(state).toContain('if(m_open && StorageValid()) m_storage.Close(m_session);');
    for (const signature of [
      'int Open()', 'int Recover()',
      'int InitializeNew(const uchar &registration_payload[],const uchar &capture_payload[],',
      'int Append(const Tov2AppendCandidate &candidates[],const uchar &event_payload_arena[],',
      'int PublishDiagnostic(const string completeness,const string named_error)',
      'int Compact()', 'void Close()', 'bool ReloadRequired() const',
      'bool Snapshot(Tov2LocalState &state)',
    ]) expect(state).toContain(signature);
    expect(state).toContain('long highest_commit=HighestCommit();');
    expect(state).toContain('int loaded=LoadRoot(highest_commit,recovered,commit_sha);');
    expect(state).not.toMatch(/highest_commit\s*--|fallback/iu);
    const publish = body(state, 'int Publish(const string transition', 'bool AppendFlat');
    const objects = publish.indexOf('CreateAndVerify(object_locators[i],frame)');
    const manifest = publish.indexOf('CreateAndVerify(Tov2StorageStateLocator(candidate.generation),state_frame)');
    const commit = publish.indexOf('CreateAndVerify(Tov2StorageCommitLocator(candidate.generation),commit_frame)');
    expect(objects).toBeGreaterThan(-1);
    expect(manifest).toBeGreaterThan(objects);
    expect(commit).toBeGreaterThan(manifest);
    expect(state).toContain('m_reload_required=true;');
    expect(state).toContain('transition=="PREPARE" || transition=="ACK" || transition=="REPLACE"');
    expect(state).not.toMatch(/\bint\s+Ack\s*\(|validated\s*=\s*true|sendable/iu);
    expect(state).toContain('int current=VerifyCurrentRootFresh();');
    expect(state).toContain('if(m_state.events[found].record_sha!=candidates[i].record_sha');
    expect(state).toContain('int new_count=count-prefix_count;');
    expect(state).toContain('const string capture_schema,long &sequences[])');
    expect(state).toContain('replay_start+prefix_count!=m_state.event_count');
    expect(state).toContain('ArrayResize(sequences,0);');
    expect(state).toContain('commit.parent_generation!=state.parent_generation');
    expect(state).toContain('commit.parent_sha!=state.parent_commit');
    const compact = body(state, 'int Compact()', 'int ReservedTransition');
    expect(compact).toContain('LoadRoot(m_state.generation,verified_current,verified_current_sha)');
    expect(compact).toContain('LoadRoot(m_state.parent_generation,previous,previous_sha)');
    const objectDelete = compact.indexOf('DeleteAuthorized(retired_objects[i],attempts)');
    const stateDelete = compact.lastIndexOf('DeleteAuthorized(Tov2StorageStateLocator(retired_generation),attempts)');
    const commitDelete = compact.lastIndexOf('DeleteAuthorized(Tov2StorageCommitLocator(retired_generation),attempts)');
    expect(objectDelete).toBeGreaterThan(-1);
    expect(stateDelete).toBeGreaterThan(objectDelete);
    expect(commitDelete).toBeGreaterThan(stateDelete);
    expect(compact).toContain('current_commit.transition=="CHECKPOINT"');
    expect(compact).toContain('continue_cleanup=true');
    expect(compact).toContain('previous.parent_generation');
    expect(compact).toContain('LoadRetiredMetadata(retired_generation,retired_commit_sha');
    expect(compact).toContain('TOV2_STORAGE_DELETE_BATCH-2');
    expect(compact).toContain('if(object_count>delete_count || has_ineligible) return TOV2_STATE_OK;');
    expect(compact).toContain('retired_commit_index>=0 && retired_state_index<0');
    expect(compact).not.toContain('retired_commits');
    expect(compact.indexOf('current_commit.transition=="CHECKPOINT"'))
      .toBeLessThan(compact.indexOf('if(m_highest_observed>=TOV2_LOCAL_MAX_COUNTER) return TOV2_STATE_LIMIT;'));
    expect(state).toContain('int CreateFailure(const int result)');
    expect(state).toContain('int DeleteFailure(const int result)');
    expect(state).toContain('Tov2LocalRefText(reference)!=Tov2LocalRefText(candidate)');
    expect(state).toContain('retired.capture_schema!=root.capture_schema');
    expect(state).toContain('return VerifyTypedReference(reference,retired);');
    expect(state).toContain('m_reload_required=true;');
    const diagnostic = body(state, 'int PublishDiagnostic(', 'int Compact()');
    expect(diagnostic).not.toMatch(/if\(!m_loaded\s*\|\|\s*m_highest_observed/iu);
    expect(diagnostic.indexOf('int inventory=RefreshInventory();'))
      .toBeLessThan(diagnostic.indexOf('if(m_highest_observed>=TOV2_LOCAL_MAX_COUNTER)'));
  });

  it('uses a deterministic flat-arena memory store with before/after faults', () => {
    const memory = source('Scripts/Support/TradeOpsTelemetryMemoryStore.mqh');
    expect(memory).toContain('class CTov2TelemetryMemoryStore : public ITov2TelemetryStorage');
    for (const field of [
      'int m_kind[];', 'long m_generation[];', 'long m_ordinal[];',
      'int m_offset[];', 'int m_length[];', 'bool m_deleted[];', 'uchar m_arena[];',
      'int m_record_count;', 'int m_arena_count;', 'int m_delete_log_count;',
    ]) expect(memory).toContain(field);
    expect(memory).not.toMatch(/struct[\s\S]{0,300}uchar\s+\w+\[\]/u);
    expect(memory).toContain('const int TOV2_MEMORY_FAULT_BEFORE=1;');
    expect(memory).toContain('const int TOV2_MEMORY_FAULT_AFTER=2;');
    expect(memory).toContain('void ArmFault(const string operation,const int occurrence,const int mode)');
    const crash = body(memory, 'void Crash()', 'int PersistentCount()');
    expect(crash).toContain('m_owner_token="";');
    expect(crash).not.toMatch(/ArrayResize\(m_(?:arena|kind|generation|ordinal|offset|length|deleted)/u);
    expect(memory).toContain('if(Fault("CREATE",TOV2_MEMORY_FAULT_BEFORE))');
    expect(memory).toContain('if(Fault("CREATE",TOV2_MEMORY_FAULT_AFTER))');
    expect(memory).toContain('if(Fault("DELETE",TOV2_MEMORY_FAULT_BEFORE))');
    expect(memory).toContain('if(Fault("DELETE",TOV2_MEMORY_FAULT_AFTER))');
    expect(memory).toContain('m_installation_key!=installation_key');
    expect(memory).toContain('m_owner_token="";');
    const revalidate = body(memory, 'int Revalidate(const string session_token)', 'int Inventory(');
    expect(revalidate).toContain('if(Fault("REVALIDATE",TOV2_MEMORY_FAULT_AFTER))');
    expect(revalidate).toContain('m_owner_token="";');
    expect(memory).toContain('int DeleteLogKind(const int index)');
    expect(memory).toContain('for(int i=m_record_count-1;i>=0;i--)');
    expect(memory).toContain('for(int i=0;i<m_record_count;i++)');
    expect(memory).not.toMatch(/for\([^\n]*ArraySize\(m_kind\)/u);
    expect(memory).toContain('m_record_count=old_count+1;');
    expect(memory).toContain('m_delete_log_count=log_count+1;');
    expect(memory).toContain('void ArmInternalFault(const string operation,const int occurrence)');
    expect(memory).toContain('void ArmOutcome(const string operation,const int occurrence,const int result)');
    expect(memory).toContain('if(ForcedOutcome("CREATE",forced)) return forced;');
    expect(memory).toContain('if(ForcedOutcome("DELETE",forced)) return forced;');
  });

  it('retains every stable native recovery, budget, and compaction label', () => {
    const native = source('Scripts/TradeOpsTelemetryStateSelfTest.mq5');
    for (const label of [
      'constructor.no_virtual_call', 'open.acquire_only', 'recover.no_initialize',
      'init_fault.fresh_recovery.',
      'initialize.explicit', 'memory.crash_invalidates', 'memory.crash_preserves',
      'restart.normal_capture', 'ownership.second_instance_busy',
      'publication.reload_required.', 'publication.fresh_instance.',
      'append.atomic_capture.', 'recovery.highest_corrupt', 'recovery.highest_missing',
      'recovery.highest_live_reference_missing', 'identity.recover_mismatch',
      'identity.snapshot_recheck', 'ownership.before_each_access',
      'generation.abandoned_skip', 'append.replay_exact', 'append.conflict',
      'append.mixed_retry', 'append.mixed_sequences', 'append.deal_revision_conflict',
      'append.tail_aligned_prefix', 'append.interior_prefix_rejected',
      'append.zero_event', 'append.batch_32', 'append.batch_33', 'append.flat_arena.',
      'queue.512', 'queue.513', 'payload.262144', 'frame.262345',
      'budget.normal', 'budget.prepare_blocks_reserve', 'budget.ack_reserve_later',
      'budget.reserve', 'budget.owner_zero_only',
      'compact.retention', 'compact.abandoned', 'compact.delete_fault.',
      'compact.delete_32', 'recovery.parent_not_dependency',
      'compact.object_before_state', 'compact.state_before_commit',
      'compact.class_interruptions.', 'compact.pending_ack_witnesses',
      'compact.current_revalidate_before_delete',
      'compact.previous_revalidate_before_delete',
      'compact.multicall_object_prefix', 'compact.multicall_complete',
      'compact.after_effect_retry_resumes', 'compact.metadata_last_after_objects',
      'compact.state_after_effect_retry',
      'compact.disconnected_valid_preserved', 'compact.unack_event_preserved',
      'compact.unproven_pending_preserved',
      'compact.protected_event_metadata_mismatch_blocks',
      'compact.protected_capture_schema_mismatch_blocks',
      'compact.max_existing_checkpoint_cleanup', 'compact.max_new_checkpoint_refused',
      'diagnostic.max_valid_limit_no_mutation',
      'diagnostic.max_limit_preserved_cleanup',
      'inventory.three_way', 'inventory.error_not_empty', 'read.error_blocks_recovery',
      'create.outcomes', 'delete.outcomes', 'transition.supported',
      'transition.outbox_reserved', 'locator.canonical', 'locator.reject',
      'memory.acquire_after_reusable', 'memory.installation_isolation',
      'typed.valid_paths', 'typed.reject_root_unchanged',
      'typed.recovery_registration', 'typed.recovery_capture',
      'typed.recovery_event', 'typed.recovery_pending', 'typed.recovery_ack',
      'typed.event_association_valid', 'typed.event_wrong_identity',
      'typed.event_wrong_event_id', 'typed.event_wrong_deal_id',
      'typed.event_wrong_revision', 'typed.event_body_stale_record_sha',
      'typed.event_wrong_record_sha',
      'recovery.registration_missing', 'mutation.current_root_rechecked',
      'mutation.current_corrupt_blocks',
      'recovery.parent_metadata_mismatch', 'capture.schema_migration_valid',
      'capture.previous_schema_reject', 'capture.candidate_schema_reject',
      'typed.pending_wrong_request', 'typed.pending_wrong_body',
      'typed.pending_wrong_identity', 'typed.ack_wrong_pending_digest',
      'typed.ack_wrong_body', 'typed.ack_wrong_identity',
      'typed.pending_wrong_prior', 'typed.pending_wrong_final',
      'typed.pending_wrong_count', 'typed.pending_wrong_produced',
      'typed.pending_wrong_sequence', 'typed.pending_wrong_ordinal',
      'typed.ack_wrong_request', 'typed.ack_wrong_event',
      'typed.ack_wrong_accepted_at',
      'typed.ack_wrong_sequence', 'typed.ack_wrong_ordinal',
      'typed.ack_wrong_accepted_request', 'typed.ack_wrong_accepted_event',
      'memory.no_phantom_record.', 'memory.allocation_failure_recovery.',
      'memory.no_phantom_delete_log', 'memory.delete_log_failure_recovery',
      'outcome.create_unexpected_reload', 'outcome.create_unexpected_recovery',
      'outcome.delete_unexpected_reload',
      'outcome.create_conflict_definite', 'outcome.delete_conflict_definite',
      'pointer.validator_invalid_before_open', 'pointer.storage_invalid_guarded',
      'pointer.invalid_close_no_dereference',
      'pointer.validator_invalid_close_releases_storage',
    ]) expect(native, label).toContain('"' + label);
    expect(native).toContain('for(int mode=TOV2_MEMORY_FAULT_BEFORE;mode<=TOV2_MEMORY_FAULT_AFTER;mode++)');
    expect(native).toContain('for(int boundary=1;boundary<=4;boundary++)');
    expect(native).toContain('store.Crash();');
    expect(native).toContain('TOV2_STATE_PASS');
    expect(native).toContain('TOV2_STATE_FAIL');
    expect(native).toContain('TOV2_STATE_FAILURE');
    expect(native).toContain('class CSyntheticPayloadValidator');
    expect(native).toContain('bool pristine=(mode==TOV2_MEMORY_FAULT_BEFORE && boundary==1);');
    expect(native).toContain('expected=!loaded && recovery==TOV2_STATE_NOT_STARTED;');
    expect(native).toContain('"PENDING1|"+identity');
    expect(native).toContain('"ACK1|"+identity');
    expect(native).toContain('"EVENT1|"+Identity()+"|"+id');
    expect(native).toContain('StringSplit(text,StringGetCharacter("|",0),fields)==6');
    expect(native).toContain('if(event_metadata_mismatch) retired.events[0].record_sha=Repeat("8",64);');
    expect(native).toContain('previous.events[0]=valid_event;');
    expect(native).toContain('StringSplit(text,StringGetCharacter("|",0),fields)==8');
    expect(native).toContain('StringSplit(text,StringGetCharacter("|",0),fields)==7');
  });

  it('keeps all runtime sources pure and the active EA isolated', () => {
    const runtime = targets.map(source).join('\n');
    const active = source('TradeOpsAgent.mq5');
    const forbidden = /\b(?:FileOpen|FileRead|FileWrite|FileFlush|FileClose|FileMove|FileDelete|FileFindFirst|FileFindNext|FolderClean|WebRequest|Socket\w*|OrderSend\w*|CTrade|AccountInfo\w*|History\w*|PositionGet\w*|OrderGet\w*|OnTimer|OnTradeTransaction|TimeCurrent|TimeLocal|GetTickCount\w*)\b|#import/u;
    expect(runtime).not.toMatch(forbidden);
    expect(active).not.toContain('TradeOpsTelemetryStorage.mqh');
    expect(active).not.toContain('TradeOpsTelemetryState.mqh');
    expect(active).not.toContain('TradeOpsTelemetryMemoryStore.mqh');
    expect(active).not.toContain('TradeOpsTelemetryStateSelfTest');
    expect(runtime).not.toMatch(/DeleteAll|ResetJournal|RepairJournal/iu);
  });

  it('preserves reviewed predecessors and has balanced complete source bodies', () => {
    expect(sha256(source('Include/TradeOpsTelemetryValues.mqh')))
      .toBe('0016223e32d8d0cf960a3b015581518948a8a2e1464196c0d8f7952d4dc9ea4f');
    expect(sha256(source('Include/TradeOpsTelemetryRecord.mqh')))
      .toBe('7a0f42d1d481487ba812f6ef2b18faaf3f80143980388f4f54efd8075d977685');
    expect(sha256(source('Include/TradeOpsTelemetryStorageCodec.mqh')))
      .toBe('6caf9d02cbd5afc1a940d9744f125e7d97239cd622fba2785ddd340580b7f6ad');
    expect(sha256(source('Scripts/TradeOpsTelemetryStorageCodecSelfTest.mq5')))
      .toBe('d8a206fc8dd9bd1183ee7f187225eb5984ac997a328785c55d03b2445f5ee7ff');
    expect(sha256(readFileSync(join(import.meta.dirname, 'mt5-telemetry-storage-codec-v2-source.test.ts'), 'utf8')))
      .toBe('b2c41688e147d23ffe93140aec4e7877c9b61dddb1206663c9f79aecbb8a65a0');
    expect(sha256(source('TradeOpsAgent.mq5')))
      .toBe('4d3058b7ada9d2a2de5ab7bd864225e9120f645cf084e75e731ba747983b12b9');
    for (const path of targets) {
      const text = source(path);
      const opens = [...text].filter((character) => character === '{').length;
      const closes = [...text].filter((character) => character === '}').length;
      expect(opens, path).toBe(closes);
    }
    expect(source('Include/TradeOpsTelemetryStorage.mqh')).toContain('#endif');
    expect(source('Include/TradeOpsTelemetryState.mqh')).toContain('#endif');
    expect(source('Scripts/Support/TradeOpsTelemetryMemoryStore.mqh')).toContain('#endif');
  });
});
~~~

## C. `mt5/TradeOpsAgent/Include/TradeOpsTelemetryState.mqh`

~~~cpp
#ifndef TRADEOPS_TELEMETRY_STATE_MQH
#define TRADEOPS_TELEMETRY_STATE_MQH
#include "TradeOpsTelemetryStorage.mqh"

const int TOV2_STATE_OK=0;
const int TOV2_STATE_NOT_STARTED=1;
const int TOV2_STATE_BUSY=2;
const int TOV2_STATE_RECOVERY_REQUIRED=3;
const int TOV2_STATE_IDENTITY_MISMATCH=4;
const int TOV2_STATE_CONFLICT=5;
const int TOV2_STATE_LIMIT=6;
const int TOV2_STATE_OWNERSHIP_LOST=7;
const int TOV2_STATE_IO_ERROR=8;
const int TOV2_STATE_INVALID=9;
const int TOV2_STATE_UNSUPPORTED=10;
const int TOV2_STATE_RELOAD_REQUIRED=11;

struct Tov2AppendCandidate
{
   string event_id;
   string record_sha;
   string deal_id;
   long revision;
};

void Tov2AppendClearCandidate(Tov2AppendCandidate &candidate)
{
   candidate.event_id="";
   candidate.record_sha="";
   candidate.deal_id="-";
   candidate.revision=0;
}

bool Tov2AppendCandidateValid(const Tov2AppendCandidate &candidate)
{
   if(!Tov2Identifier(candidate.event_id) || !Tov2Digest(candidate.record_sha) ||
      !Tov2Counter(candidate.revision)) return false;
   if(candidate.deal_id=="-") return candidate.revision==0;
   return Tov2Ticket(candidate.deal_id) && candidate.revision>=1;
}

class ITov2TelemetryStatePayloadValidator
{
public:
   virtual bool Registration(const uchar &payload[],const string expected_identity)=0;
   virtual bool Capture(const uchar &payload[],const string capture_schema,
                        const string expected_identity)=0;
   virtual bool CaptureAdvance(const uchar &previous_payload[],
                               const string previous_schema,
                               const uchar &candidate_payload[],
                               const string candidate_schema,
                               const string expected_identity)=0;
   virtual bool Event(const uchar &payload[],const string event_id,
                      const string record_sha,const string deal_id,
                      const long revision,const string expected_identity)=0;
   virtual bool Pending(const uchar &payload[],const Tov2LocalState &state,
                        const string expected_identity)=0;
   virtual bool Ack(const uchar &payload[],const Tov2LocalState &state,
                    const string expected_identity)=0;
};

class CTov2TelemetryState
{
private:
   // Non-owning dependencies. Callers keep both referents alive through Close.
   ITov2TelemetryStorage *m_storage;
   ITov2TelemetryStatePayloadValidator *m_validator;
   string m_expected_identity;
   string m_installation_key;
   string m_session;
   bool m_open;
   bool m_loaded;
   bool m_empty_ready;
   bool m_reload_required;
   Tov2LocalState m_state;
   string m_commit_sha;
   Tov2StorageEntry m_inventory[];
   long m_highest_observed;

   int StoreFailure(const int result,const bool attempted)
   {
      if(attempted && (result==TOV2_STORE_IO_ERROR ||
                       result==TOV2_STORE_OWNERSHIP_LOST ||
                       result==TOV2_STORE_LIMIT)) m_reload_required=true;
      if(result==TOV2_STORE_OWNERSHIP_LOST) return TOV2_STATE_OWNERSHIP_LOST;
      if(result==TOV2_STORE_LIMIT) return TOV2_STATE_LIMIT;
      if(result==TOV2_STORE_CONFLICT) return TOV2_STATE_CONFLICT;
      if(result==TOV2_STORE_INVALID) return TOV2_STATE_INVALID;
      return TOV2_STATE_IO_ERROR;
   }

   int CreateFailure(const int result)
   {
      if(result==TOV2_STORE_CONFLICT) return TOV2_STATE_CONFLICT;
      m_reload_required=true;
      return StoreFailure(result,false);
   }

   int DeleteFailure(const int result)
   {
      if(result==TOV2_STORE_CONFLICT) return TOV2_STATE_CONFLICT;
      m_reload_required=true;
      return StoreFailure(result,false);
   }

   bool StorageValid()
   {
      return CheckPointer(m_storage)!=POINTER_INVALID;
   }

   bool ValidatorValid()
   {
      return CheckPointer(m_validator)!=POINTER_INVALID;
   }

   bool DependenciesValid()
   {
      return StorageValid() && ValidatorValid();
   }

   bool ExpectedIdentityValid()
   {
      string installation="";
      return Tov2LocalIdentity(m_expected_identity,installation) &&
             Tov2LocalInstallationKey(installation,m_installation_key);
   }

   int Guard(const bool allow_reload=false)
   {
      if(!DependenciesValid()) return TOV2_STATE_INVALID;
      if(!m_open || m_session=="") return TOV2_STATE_OWNERSHIP_LOST;
      if(m_reload_required && !allow_reload) return TOV2_STATE_RELOAD_REQUIRED;
      if(!ExpectedIdentityValid()) return TOV2_STATE_INVALID;
      int result=m_storage.Revalidate(m_session);
      if(result!=TOV2_STORE_OK) return StoreFailure(result,true);
      if(m_loaded && m_state.identity!=m_expected_identity)
         return TOV2_STATE_IDENTITY_MISMATCH;
      return TOV2_STATE_OK;
   }

   int RefreshInventory()
   {
      int guard=Guard(true);
      if(guard!=TOV2_STATE_OK) return guard;
      ArrayResize(m_inventory,0);
      int result=m_storage.Inventory(m_session,m_inventory);
      if(result==TOV2_STORE_ABSENT)
      {
         m_highest_observed=0;
         return TOV2_STATE_NOT_STARTED;
      }
      if(result!=TOV2_STORE_OK) return StoreFailure(result,true);
      long bytes=0;
      int files=0;
      if(!Tov2StorageBudget(m_inventory,bytes,files,m_highest_observed))
         return TOV2_STATE_RECOVERY_REQUIRED;
      return TOV2_STATE_OK;
   }

   int ReadExact(const Tov2StorageLocator &locator,uchar &bytes[])
   {
      ArrayResize(bytes,0);
      int guard=Guard(true);
      if(guard!=TOV2_STATE_OK) return guard;
      int result=m_storage.Read(m_session,locator,bytes);
      if(result==TOV2_STORE_OK) return TOV2_STATE_OK;
      if(result==TOV2_STORE_ABSENT) return TOV2_STATE_NOT_STARTED;
      return StoreFailure(result,true);
   }

   Tov2StorageLocator RefLocator(const Tov2LocalRef &reference)
   {
      if(reference.kind=="REGISTRATION") return Tov2StorageRegistrationLocator();
      if(reference.kind=="STATE") return Tov2StorageStateLocator(reference.generation);
      if(reference.kind=="COMMIT") return Tov2StorageCommitLocator(reference.generation);
      return Tov2StorageObjectLocator(reference.generation,reference.ordinal);
   }

   int ReadReferencePayload(const Tov2LocalRef &reference,uchar &payload[])
   {
      ArrayResize(payload,0);
      uchar frame[];
      int read=ReadExact(RefLocator(reference),frame);
      if(read!=TOV2_STATE_OK) return read;
      if(!Tov2LocalFrameMatches(reference,frame,payload))
         return TOV2_STATE_RECOVERY_REQUIRED;
      return TOV2_STATE_OK;
   }

   bool TypedPayloadValid(const Tov2LocalRef &reference,const Tov2LocalState &state,
                          const uchar &payload[])
   {
      bool valid=false;
      if(!DependenciesValid()) return false;
      if(reference.kind=="REGISTRATION")
         valid=m_validator.Registration(payload,m_expected_identity);
      else if(reference.kind=="CAPTURE")
         valid=m_validator.Capture(payload,state.capture_schema,m_expected_identity);
      else if(reference.kind=="EVENT")
         valid=m_validator.Event(payload,reference.event_id,reference.record_sha,
                                 reference.deal_id,reference.revision,m_expected_identity);
      else if(reference.kind=="PENDING")
         valid=m_validator.Pending(payload,state,m_expected_identity);
      else if(reference.kind=="ACK")
         valid=m_validator.Ack(payload,state,m_expected_identity);
      return valid;
   }

   int VerifyTypedReference(const Tov2LocalRef &reference,
                            const Tov2LocalState &state)
   {
      uchar payload[];
      int read=ReadReferencePayload(reference,payload);
      if(read!=TOV2_STATE_OK) return read;
      return TypedPayloadValid(reference,state,payload) ?
             TOV2_STATE_OK : TOV2_STATE_RECOVERY_REQUIRED;
   }

   int LoadRoot(const long generation,Tov2LocalState &state,string &commit_sha)
   {
      Tov2LocalClearState(state);
      commit_sha="";
      uchar commit_frame[],commit_payload[],state_frame[],state_payload[];
      string kind="",actual="";
      long decoded_generation=0;
      Tov2StorageLocator commit_locator=Tov2StorageCommitLocator(generation);
      int read=ReadExact(commit_locator,commit_frame);
      if(read!=TOV2_STATE_OK) return TOV2_STATE_RECOVERY_REQUIRED;
      if(!Tov2LocalHash(commit_frame,commit_sha) ||
         !Tov2RecordDecode(commit_frame,kind,decoded_generation,commit_payload) ||
         kind!="CHECKPOINT" || decoded_generation!=generation) return TOV2_STATE_RECOVERY_REQUIRED;
      Tov2LocalCommit commit;
      if(!Tov2LocalCommitDecode(commit_payload,commit) || commit.generation!=generation)
         return TOV2_STATE_RECOVERY_REQUIRED;

      Tov2StorageLocator state_locator=Tov2StorageStateLocator(generation);
      read=ReadExact(state_locator,state_frame);
      if(read!=TOV2_STATE_OK || !Tov2LocalHash(state_frame,actual) ||
         actual!=commit.state_sha ||
         !Tov2RecordDecode(state_frame,kind,decoded_generation,state_payload) ||
         kind!="CHECKPOINT" || decoded_generation!=generation ||
         !Tov2LocalStateDecode(state_payload,state) || state.generation!=generation)
         return TOV2_STATE_RECOVERY_REQUIRED;
      if(state.identity!=m_expected_identity ||
         state.registration.sha!=commit.registration_sha)
         return TOV2_STATE_IDENTITY_MISMATCH;
      if(commit.parent_generation!=state.parent_generation ||
         commit.parent_sha!=state.parent_commit)
         return TOV2_STATE_RECOVERY_REQUIRED;
      if(VerifyTypedReference(state.registration,state)!=TOV2_STATE_OK ||
         VerifyTypedReference(state.capture,state)!=TOV2_STATE_OK)
         return TOV2_STATE_RECOVERY_REQUIRED;
      for(int i=0;i<state.event_count;i++)
         if(VerifyTypedReference(state.events[i],state)!=TOV2_STATE_OK)
            return TOV2_STATE_RECOVERY_REQUIRED;
      if(state.pending.kind!="-" &&
         VerifyTypedReference(state.pending,state)!=TOV2_STATE_OK)
         return TOV2_STATE_RECOVERY_REQUIRED;
      if(state.ack.kind!="-" && VerifyTypedReference(state.ack,state)!=TOV2_STATE_OK)
         return TOV2_STATE_RECOVERY_REQUIRED;
      return TOV2_STATE_OK;
   }

   bool InventoryHasOnlyEmptyOwner()
   {
      if(ArraySize(m_inventory)==0) return true;
      return ArraySize(m_inventory)==1 &&
             m_inventory[0].locator.kind==TOV2_LOC_OWNER &&
             m_inventory[0].relative_path=="owner.lock" &&
             m_inventory[0].size==0 && m_inventory[0].sha=="-";
   }

   long HighestCommit()
   {
      long highest=0;
      for(int i=0;i<ArraySize(m_inventory);i++)
         if(m_inventory[i].locator.kind==TOV2_LOC_COMMIT &&
            m_inventory[i].locator.generation>highest)
            highest=m_inventory[i].locator.generation;
      return highest;
   }

   bool SameState(const Tov2LocalState &left,const Tov2LocalState &right)
   {
      uchar left_payload[],right_payload[];
      return Tov2LocalStateEncode(left,left_payload) &&
             Tov2LocalStateEncode(right,right_payload) &&
             Tov2LocalEqual(left_payload,right_payload);
   }

   int VerifyCurrentRootFresh()
   {
      if(!m_loaded || HighestCommit()!=m_state.generation)
         return TOV2_STATE_RECOVERY_REQUIRED;
      Tov2LocalState current;
      string commit_sha="";
      int loaded=LoadRoot(m_state.generation,current,commit_sha);
      if(loaded!=TOV2_STATE_OK) return loaded;
      if(commit_sha!=m_commit_sha || !SameState(current,m_state))
         return TOV2_STATE_RECOVERY_REQUIRED;
      return TOV2_STATE_OK;
   }

   bool MakeFrame(const string kind,const long generation,const uchar &payload[],
                  uchar &frame[],string &sha)
   {
      ArrayResize(frame,0); sha="";
      return Tov2RecordEncode(kind,generation,payload,frame) &&
             Tov2LocalHash(frame,sha);
   }

   void MakeRef(Tov2LocalRef &reference,const string kind,const long generation,
                const long ordinal,const string sha,const long sequence=0,
                const string event_id="-",const string record_sha="-",
                const string deal_id="-",const long revision=0)
   {
      Tov2LocalClearRef(reference);
      reference.kind=kind; reference.generation=generation; reference.ordinal=ordinal;
      reference.sha=sha; reference.sequence=sequence; reference.event_id=event_id;
      reference.record_sha=record_sha; reference.deal_id=deal_id;
      reference.revision=revision;
   }

   int CreateAndVerify(const Tov2StorageLocator &locator,const uchar &frame[])
   {
      int guard=Guard();
      if(guard!=TOV2_STATE_OK) return guard;
      int result=m_storage.CreateExact(m_session,locator,frame);
      if(result!=TOV2_STORE_CREATED && result!=TOV2_STORE_EXISTS_SAME)
         return CreateFailure(result);
      uchar read_back[];
      int read=ReadExact(locator,read_back);
      if(read!=TOV2_STATE_OK || !Tov2LocalEqual(frame,read_back))
      {
         m_reload_required=true;
         return read==TOV2_STATE_OK ? TOV2_STATE_CONFLICT : read;
      }
      return TOV2_STATE_OK;
   }

   int Publish(const string transition,Tov2LocalState &candidate,
               const Tov2StorageLocator &object_locators[],const uchar &object_arena[],
               const int &object_ends[])
   {
      if(!Tov2StorageRuntimeTransition(transition) ||
         transition=="INIT" || !m_loaded || candidate.identity!=m_expected_identity)
         return TOV2_STATE_INVALID;
      int count=ArraySize(object_locators);
      if(ArraySize(object_ends)!=count) return TOV2_STATE_INVALID;
      int previous=0;
      long added_bytes=0;
      for(int i=0;i<count;i++)
      {
         if(object_ends[i]<=previous || object_ends[i]>ArraySize(object_arena))
            return TOV2_STATE_INVALID;
         added_bytes+=object_ends[i]-previous;
         previous=object_ends[i];
      }
      if(previous!=ArraySize(object_arena)) return TOV2_STATE_INVALID;

      uchar state_payload[],state_frame[],commit_payload[],commit_frame[];
      string state_sha="",commit_sha="";
      if(!Tov2LocalStateEncode(candidate,state_payload) ||
         !MakeFrame("CHECKPOINT",candidate.generation,state_payload,state_frame,state_sha))
         return TOV2_STATE_INVALID;
      Tov2LocalCommit commit;
      Tov2LocalClearCommit(commit);
      commit.generation=candidate.generation;
      commit.parent_generation=m_state.generation;
      commit.parent_sha=m_commit_sha;
      commit.registration_sha=m_state.registration.sha;
      commit.state_sha=state_sha;
      commit.transition=transition;
      if(!Tov2LocalCommitEncode(commit,commit_payload) ||
         !MakeFrame("CHECKPOINT",candidate.generation,commit_payload,commit_frame,commit_sha))
         return TOV2_STATE_INVALID;
      added_bytes+=ArraySize(state_frame)+ArraySize(commit_frame);
      if(!Tov2StoragePreflight(m_inventory,transition,added_bytes,count+2))
         return TOV2_STATE_LIMIT;

      previous=0;
      for(int i=0;i<count;i++)
      {
         int size=object_ends[i]-previous;
         uchar frame[];
         if(ArrayResize(frame,size)!=size ||
            ArrayCopy(frame,object_arena,0,previous,size)!=size)
            return TOV2_STATE_IO_ERROR;
         int created=CreateAndVerify(object_locators[i],frame);
         if(created!=TOV2_STATE_OK) return created;
         previous=object_ends[i];
      }
      int created=CreateAndVerify(Tov2StorageStateLocator(candidate.generation),state_frame);
      if(created!=TOV2_STATE_OK) return created;
      created=CreateAndVerify(Tov2StorageCommitLocator(candidate.generation),commit_frame);
      if(created!=TOV2_STATE_OK) return created;
      m_reload_required=true;
      return Recover();
   }

   bool AppendFlat(uchar &arena[],int &ends[],const uchar &frame[])
   {
      int old=ArraySize(arena);
      int count=ArraySize(frame);
      int n=ArraySize(ends);
      if(count<1 || ArrayResize(arena,old+count)!=old+count ||
         ArrayCopy(arena,frame,old,0,count)!=count ||
         ArrayResize(ends,n+1)!=n+1) return false;
      ends[n]=old+count;
      return true;
   }

   int CurrentCaptureMatches(const uchar &capture_payload[],const string capture_schema,
                             bool &matches)
   {
      matches=false;
      if(m_state.capture_schema!=capture_schema) return TOV2_STATE_OK;
      uchar frame[],stored[];
      int read=ReadExact(RefLocator(m_state.capture),frame);
      if(read!=TOV2_STATE_OK) return read;
      if(!Tov2LocalFrameMatches(m_state.capture,frame,stored))
         return TOV2_STATE_RECOVERY_REQUIRED;
      matches=Tov2LocalEqual(stored,capture_payload);
      return TOV2_STATE_OK;
   }

   bool LocatorIn(const Tov2StorageLocator &locator,const Tov2StorageLocator &set[])
   {
      for(int i=0;i<ArraySize(set);i++)
         if(Tov2StorageSameLocator(locator,set[i])) return true;
      return false;
   }

   bool AddLocator(Tov2StorageLocator &set[],const Tov2StorageLocator &locator)
   {
      if(LocatorIn(locator,set)) return true;
      int n=ArraySize(set);
      if(ArrayResize(set,n+1)!=n+1) return false;
      set[n]=locator;
      return true;
   }

   bool AddRootLocators(const Tov2LocalState &state,Tov2StorageLocator &set[])
   {
      if(!AddLocator(set,Tov2StorageRegistrationLocator()) ||
         !AddLocator(set,Tov2StorageStateLocator(state.generation)) ||
         !AddLocator(set,Tov2StorageCommitLocator(state.generation)) ||
         !AddLocator(set,RefLocator(state.capture))) return false;
      for(int i=0;i<state.event_count;i++)
         if(!AddLocator(set,RefLocator(state.events[i]))) return false;
      if(state.pending.kind!="-" && !AddLocator(set,RefLocator(state.pending))) return false;
      if(state.ack.kind!="-" && !AddLocator(set,RefLocator(state.ack))) return false;
      return true;
   }

   int InventoryIndex(const Tov2StorageLocator &locator)
   {
      for(int i=0;i<ArraySize(m_inventory);i++)
         if(Tov2StorageSameLocator(locator,m_inventory[i].locator)) return i;
      return -1;
   }

   void SortLocators(Tov2StorageLocator &items[])
   {
      for(int i=0;i<ArraySize(items);i++)
         for(int j=i+1;j<ArraySize(items);j++)
            if(items[j].generation<items[i].generation ||
               (items[j].generation==items[i].generation &&
                items[j].ordinal<items[i].ordinal))
            {
               Tov2StorageLocator swap=items[i];
               items[i]=items[j];
               items[j]=swap;
            }
   }

   int DeleteAuthorized(const Tov2StorageLocator &locator,int &attempts)
   {
      if(attempts>=TOV2_STORAGE_DELETE_BATCH) return TOV2_STATE_LIMIT;
      int index=InventoryIndex(locator);
      if(index<0 || !Tov2Digest(m_inventory[index].sha)) return TOV2_STATE_CONFLICT;
      int guard=Guard();
      if(guard!=TOV2_STATE_OK) return guard;
      attempts++;
      int result=m_storage.DeleteExact(m_session,locator,m_inventory[index].sha);
      if(result==TOV2_STORE_DELETED || result==TOV2_STORE_ABSENT)
         return TOV2_STATE_OK;
      return DeleteFailure(result);
   }

   int ReadCommitMetadata(const long generation,Tov2LocalCommit &commit,
                          string &commit_sha)
   {
      Tov2LocalClearCommit(commit); commit_sha="";
      uchar frame[],payload[]; string kind=""; long decoded_generation=0;
      if(ReadExact(Tov2StorageCommitLocator(generation),frame)!=TOV2_STATE_OK ||
         !Tov2LocalHash(frame,commit_sha) ||
         !Tov2RecordDecode(frame,kind,decoded_generation,payload) ||
         kind!="CHECKPOINT" || decoded_generation!=generation ||
         !Tov2LocalCommitDecode(payload,commit) || commit.generation!=generation)
         return TOV2_STATE_RECOVERY_REQUIRED;
      return TOV2_STATE_OK;
   }

   bool PendingHasRetainedAck(const Tov2LocalRef &pending,
                              const Tov2LocalState &current,
                              const Tov2LocalState &previous)
   {
      return (current.ack.kind=="ACK" && current.ack_pending_sha==pending.sha &&
              current.ack_request==pending.sequence &&
              current.ack.sequence==pending.sequence) ||
             (previous.ack.kind=="ACK" && previous.ack_pending_sha==pending.sha &&
              previous.ack_request==pending.sequence &&
              previous.ack.sequence==pending.sequence);
   }

   bool RetiredReferenceEligible(const Tov2LocalRef &reference,
                                 const Tov2LocalState &current,
                                 const Tov2LocalState &previous)
   {
      if(reference.kind=="CAPTURE") return true;
      if(reference.kind=="EVENT") return reference.sequence<=current.accepted_event;
      if(reference.kind=="PENDING")
         return PendingHasRetainedAck(reference,current,previous);
      if(reference.kind=="ACK") return reference.sequence<=current.accepted_request;
      return false;
   }

   int MatchProtectedCandidate(const Tov2LocalRef &reference,
                               const Tov2LocalRef &candidate,
                               const Tov2LocalState &retired,
                               const Tov2LocalState &root,bool &matched)
   {
      if(candidate.kind=="-" ||
         !Tov2StorageSameLocator(RefLocator(reference),RefLocator(candidate)))
         return TOV2_STATE_OK;
      matched=true;
      if(Tov2LocalRefText(reference)!=Tov2LocalRefText(candidate))
         return TOV2_STATE_RECOVERY_REQUIRED;
      if(reference.kind=="CAPTURE" && retired.capture_schema!=root.capture_schema)
         return TOV2_STATE_RECOVERY_REQUIRED;
      return TOV2_STATE_OK;
   }

   int RootProtectedAssociation(const Tov2LocalRef &reference,
                                const Tov2LocalState &retired,
                                const Tov2LocalState &root,bool &matched)
   {
      int result=MatchProtectedCandidate(reference,root.capture,retired,root,matched);
      if(result!=TOV2_STATE_OK) return result;
      for(int i=0;i<root.event_count;i++)
      {
         result=MatchProtectedCandidate(reference,root.events[i],retired,root,matched);
         if(result!=TOV2_STATE_OK) return result;
      }
      result=MatchProtectedCandidate(reference,root.pending,retired,root,matched);
      if(result!=TOV2_STATE_OK) return result;
      return MatchProtectedCandidate(reference,root.ack,retired,root,matched);
   }

   int ProtectedAssociation(const Tov2LocalRef &reference,
                            const Tov2LocalState &retired,
                            const Tov2LocalState &current,
                            const Tov2LocalState &previous,bool &protected_reference)
   {
      protected_reference=false;
      int result=RootProtectedAssociation(reference,retired,current,protected_reference);
      if(result!=TOV2_STATE_OK) return result;
      result=RootProtectedAssociation(reference,retired,previous,protected_reference);
      if(result!=TOV2_STATE_OK) return result;
      if(protected_reference)
         return VerifyTypedReference(reference,retired);
      return TOV2_STATE_OK;
   }

   int ClassifyRetiredReference(const Tov2LocalRef &reference,
                                const Tov2LocalState &retired,
                                const Tov2LocalState &current,
                                const Tov2LocalState &previous,
                                Tov2StorageLocator &live_eligible[],
                                bool &has_ineligible)
   {
      Tov2StorageLocator locator=RefLocator(reference);
      bool protected_reference=false;
      int association=ProtectedAssociation(reference,retired,current,previous,
                                            protected_reference);
      if(association!=TOV2_STATE_OK) return association;
      if(protected_reference) return TOV2_STATE_OK;
      bool eligible=RetiredReferenceEligible(reference,current,previous);
      uchar payload[];
      int read=ReadReferencePayload(reference,payload);
      if(read==TOV2_STATE_NOT_STARTED && eligible) return TOV2_STATE_OK;
      if(read!=TOV2_STATE_OK || !TypedPayloadValid(reference,retired,payload))
         return TOV2_STATE_RECOVERY_REQUIRED;
      if(!eligible)
      {
         has_ineligible=true;
         return TOV2_STATE_OK;
      }
      return AddLocator(live_eligible,locator) ? TOV2_STATE_OK : TOV2_STATE_IO_ERROR;
   }

   int LoadRetiredMetadata(const long generation,const string expected_commit_sha,
                           const Tov2LocalState &current,
                           const Tov2LocalState &previous,
                           Tov2StorageLocator &live_eligible[],bool &has_ineligible)
   {
      ArrayResize(live_eligible,0); has_ineligible=false;
      Tov2LocalCommit commit; string commit_sha="";
      if(ReadCommitMetadata(generation,commit,commit_sha)!=TOV2_STATE_OK ||
         commit_sha!=expected_commit_sha) return TOV2_STATE_RECOVERY_REQUIRED;
      uchar state_frame[],state_payload[]; string kind="",state_sha="";
      long decoded_generation=0;
      if(ReadExact(Tov2StorageStateLocator(generation),state_frame)!=TOV2_STATE_OK ||
         !Tov2LocalHash(state_frame,state_sha) || state_sha!=commit.state_sha ||
         !Tov2RecordDecode(state_frame,kind,decoded_generation,state_payload) ||
         kind!="CHECKPOINT" || decoded_generation!=generation)
         return TOV2_STATE_RECOVERY_REQUIRED;
      Tov2LocalState retired;
      if(!Tov2LocalStateDecode(state_payload,retired) || retired.generation!=generation ||
         retired.identity!=m_expected_identity ||
         retired.registration.sha!=commit.registration_sha ||
         commit.parent_generation!=retired.parent_generation ||
         commit.parent_sha!=retired.parent_commit)
         return TOV2_STATE_RECOVERY_REQUIRED;
      if(retired.registration.sha!=current.registration.sha ||
         VerifyTypedReference(retired.registration,retired)!=TOV2_STATE_OK)
         return TOV2_STATE_RECOVERY_REQUIRED;
      int classified=ClassifyRetiredReference(retired.capture,retired,current,previous,
                                              live_eligible,has_ineligible);
      if(classified!=TOV2_STATE_OK) return classified;
      for(int i=0;i<retired.event_count;i++)
      {
         classified=ClassifyRetiredReference(retired.events[i],retired,current,previous,
                                             live_eligible,has_ineligible);
         if(classified!=TOV2_STATE_OK) return classified;
      }
      if(retired.pending.kind!="-")
      {
         classified=ClassifyRetiredReference(retired.pending,retired,current,previous,
                                             live_eligible,has_ineligible);
         if(classified!=TOV2_STATE_OK) return classified;
      }
      if(retired.ack.kind!="-")
      {
         classified=ClassifyRetiredReference(retired.ack,retired,current,previous,
                                             live_eligible,has_ineligible);
         if(classified!=TOV2_STATE_OK) return classified;
      }
      Tov2StorageLocator retired_set[];
      if(!AddRootLocators(retired,retired_set)) return TOV2_STATE_IO_ERROR;
      for(int i=0;i<ArraySize(m_inventory);i++)
         if(m_inventory[i].locator.kind==TOV2_LOC_OBJECT &&
            m_inventory[i].locator.generation==generation &&
            !LocatorIn(m_inventory[i].locator,retired_set))
            has_ineligible=true;
      SortLocators(live_eligible);
      return TOV2_STATE_OK;
   }

public:
   CTov2TelemetryState(ITov2TelemetryStorage *storage,
                       ITov2TelemetryStatePayloadValidator *validator,
                       const string expected_identity)
   {
      m_storage=storage;
      m_validator=validator;
      m_expected_identity=expected_identity;
      m_installation_key="";
      m_session="";
      m_open=false;
      m_loaded=false;
      m_empty_ready=false;
      m_reload_required=false;
      m_commit_sha="";
      m_highest_observed=0;
      ArrayResize(m_inventory,0);
      Tov2LocalClearState(m_state);
   }

   int Open()
   {
      if(m_open || !DependenciesValid() || !ExpectedIdentityValid())
         return TOV2_STATE_INVALID;
      string token="";
      int result=m_storage.Acquire(m_installation_key,token);
      if(result==TOV2_STORE_BUSY) return TOV2_STATE_BUSY;
      if(result!=TOV2_STORE_ACQUIRED || token=="") return StoreFailure(result,true);
      m_session=token;
      m_open=true;
      m_loaded=false;
      m_empty_ready=false;
      m_reload_required=false;
      return TOV2_STATE_OK;
   }

   int Recover()
   {
      if(!m_open) return TOV2_STATE_OWNERSHIP_LOST;
      m_loaded=false;
      m_empty_ready=false;
      Tov2LocalClearState(m_state);
      m_commit_sha="";
      m_reload_required=false;
      int inventory=RefreshInventory();
      if(inventory==TOV2_STATE_NOT_STARTED)
      {
         m_empty_ready=true;
         return TOV2_STATE_NOT_STARTED;
      }
      if(inventory!=TOV2_STATE_OK) return inventory;
      long highest_commit=HighestCommit();
      if(highest_commit==0)
      {
         if(InventoryHasOnlyEmptyOwner())
         {
            m_empty_ready=true;
            return TOV2_STATE_NOT_STARTED;
         }
         return TOV2_STATE_RECOVERY_REQUIRED;
      }
      Tov2LocalState recovered;
      string commit_sha="";
      int loaded=LoadRoot(highest_commit,recovered,commit_sha);
      if(loaded!=TOV2_STATE_OK) return loaded;
      m_state=recovered;
      m_commit_sha=commit_sha;
      m_loaded=true;
      return TOV2_STATE_OK;
   }

   int InitializeNew(const uchar &registration_payload[],const uchar &capture_payload[],
                     const string capture_schema)
   {
      int guard=Guard();
      if(guard!=TOV2_STATE_OK) return guard;
      if(m_loaded || !m_empty_ready || !Tov2Identifier(capture_schema))
         return TOV2_STATE_INVALID;
      int inventory=RefreshInventory();
      if(inventory!=TOV2_STATE_NOT_STARTED || !InventoryHasOnlyEmptyOwner())
         return inventory==TOV2_STATE_OK ? TOV2_STATE_CONFLICT : inventory;
      if(!DependenciesValid()) return TOV2_STATE_INVALID;
      uchar registration_frame[],capture_frame[],state_payload[],state_frame[];
      uchar commit_payload[],commit_frame[],objects[];
      int ends[];
      string registration_sha="",capture_sha="",state_sha="",commit_sha="";
      if(!m_validator.Registration(registration_payload,m_expected_identity) ||
         !m_validator.Capture(capture_payload,capture_schema,m_expected_identity))
         return TOV2_STATE_INVALID;
      if(!MakeFrame("REGISTRATION",1,registration_payload,registration_frame,registration_sha) ||
         !MakeFrame("CHECKPOINT",1,capture_payload,capture_frame,capture_sha))
         return TOV2_STATE_INVALID;
      Tov2LocalState initial;
      Tov2LocalClearState(initial);
      initial.generation=1;
      initial.identity=m_expected_identity;
      MakeRef(initial.registration,"REGISTRATION",1,0,registration_sha);
      MakeRef(initial.capture,"CAPTURE",1,1,capture_sha);
      initial.capture_schema=capture_schema;
      initial.completeness="CATCHING_UP";
      if(!Tov2LocalStateEncode(initial,state_payload) ||
         !MakeFrame("CHECKPOINT",1,state_payload,state_frame,state_sha))
         return TOV2_STATE_INVALID;
      Tov2LocalCommit commit;
      Tov2LocalClearCommit(commit);
      commit.generation=1; commit.parent_generation=0; commit.parent_sha="-";
      commit.registration_sha=registration_sha; commit.state_sha=state_sha;
      commit.transition="INIT";
      if(!Tov2LocalCommitEncode(commit,commit_payload) ||
         !MakeFrame("CHECKPOINT",1,commit_payload,commit_frame,commit_sha))
         return TOV2_STATE_INVALID;
      long added=ArraySize(registration_frame)+ArraySize(capture_frame)+
                 ArraySize(state_frame)+ArraySize(commit_frame);
      if(!Tov2StoragePreflight(m_inventory,"INIT",added,4)) return TOV2_STATE_LIMIT;
      int result=CreateAndVerify(Tov2StorageRegistrationLocator(),registration_frame);
      if(result!=TOV2_STATE_OK) return result;
      result=CreateAndVerify(Tov2StorageObjectLocator(1,1),capture_frame);
      if(result!=TOV2_STATE_OK) return result;
      result=CreateAndVerify(Tov2StorageStateLocator(1),state_frame);
      if(result!=TOV2_STATE_OK) return result;
      result=CreateAndVerify(Tov2StorageCommitLocator(1),commit_frame);
      if(result!=TOV2_STATE_OK) return result;
      m_reload_required=true;
      return Recover();
   }

   int Append(const Tov2AppendCandidate &candidates[],const uchar &event_payload_arena[],
              const int &event_ends[],const uchar &capture_payload[],
              const string capture_schema,long &sequences[])
   {
      ArrayResize(sequences,0);
      int guard=Guard();
      if(guard!=TOV2_STATE_OK) return guard;
      if(!m_loaded || !Tov2Identifier(capture_schema)) return TOV2_STATE_INVALID;
      int inventory=RefreshInventory();
      if(inventory!=TOV2_STATE_OK) return inventory;
      int current=VerifyCurrentRootFresh();
      if(current!=TOV2_STATE_OK) return current;
      int count=ArraySize(candidates);
      if(count<0 || count>TOV2_LOCAL_BATCH || ArraySize(event_ends)!=count)
         return TOV2_STATE_LIMIT;
      int previous=0;
      int prefix_count=0;
      int replay_start=-1;
      bool saw_new=false;
      for(int i=0;i<count;i++)
      {
         if(!Tov2AppendCandidateValid(candidates[i]) || event_ends[i]<=previous ||
            event_ends[i]>ArraySize(event_payload_arena)) return TOV2_STATE_INVALID;
         int size=event_ends[i]-previous;
         uchar payload[]; string digest="";
         if(size<1 || size>TOV2_RECORD_PAYLOAD_MAX ||
            ArrayResize(payload,size)!=size ||
            ArrayCopy(payload,event_payload_arena,0,previous,size)!=size ||
            !Tov2LocalHash(payload,digest) || digest!=candidates[i].record_sha)
            return TOV2_STATE_INVALID;
         if(!DependenciesValid() ||
            !m_validator.Event(payload,candidates[i].event_id,candidates[i].record_sha,
                               candidates[i].deal_id,candidates[i].revision,
                               m_expected_identity)) return TOV2_STATE_INVALID;
         int found=-1;
         for(int j=0;j<m_state.event_count;j++)
         {
            if(m_state.events[j].event_id==candidates[i].event_id) found=j;
            if(candidates[i].deal_id!="-" &&
               m_state.events[j].deal_id==candidates[i].deal_id &&
               m_state.events[j].revision==candidates[i].revision &&
               m_state.events[j].event_id!=candidates[i].event_id)
               return TOV2_STATE_CONFLICT;
         }
         if(found>=0)
         {
            if(saw_new) return TOV2_STATE_CONFLICT;
            prefix_count++;
            if(replay_start<0) replay_start=found;
            if(found!=replay_start+i) return TOV2_STATE_CONFLICT;
            if(m_state.events[found].record_sha!=candidates[i].record_sha ||
               m_state.events[found].deal_id!=candidates[i].deal_id ||
               m_state.events[found].revision!=candidates[i].revision)
               return TOV2_STATE_CONFLICT;
            uchar committed_payload[];
            int verified=ReadReferencePayload(m_state.events[found],committed_payload);
            if(verified!=TOV2_STATE_OK) return verified;
            if(!Tov2LocalEqual(committed_payload,payload) || !DependenciesValid() ||
               !m_validator.Event(committed_payload,m_state.events[found].event_id,
                                  m_state.events[found].record_sha,
                                  m_state.events[found].deal_id,
                                  m_state.events[found].revision,m_expected_identity))
               return TOV2_STATE_CONFLICT;
         }
         else saw_new=true;
         for(int j=0;j<i;j++)
            if(candidates[j].event_id==candidates[i].event_id ||
               (candidates[i].deal_id!="-" && candidates[j].deal_id==candidates[i].deal_id &&
                candidates[j].revision==candidates[i].revision)) return TOV2_STATE_CONFLICT;
         previous=event_ends[i];
      }
      if(previous!=ArraySize(event_payload_arena)) return TOV2_STATE_INVALID;
      if(!DependenciesValid()) return TOV2_STATE_INVALID;
      uchar previous_capture[];
      int capture_read=ReadReferencePayload(m_state.capture,previous_capture);
      if(capture_read!=TOV2_STATE_OK) return capture_read;
      if(!m_validator.CaptureAdvance(previous_capture,m_state.capture_schema,
                                     capture_payload,capture_schema,
                                     m_expected_identity)) return TOV2_STATE_INVALID;
      if(prefix_count==count && count>0)
      {
         bool matches=false;
         int compared=CurrentCaptureMatches(capture_payload,capture_schema,matches);
         if(compared!=TOV2_STATE_OK) return compared;
         if(!matches) return TOV2_STATE_CONFLICT;
         if(ArrayResize(sequences,count)!=count) { ArrayResize(sequences,0); return TOV2_STATE_IO_ERROR; }
         for(int i=0;i<count;i++) sequences[i]=m_state.events[replay_start+i].sequence;
         return TOV2_STATE_OK;
      }
      int new_count=count-prefix_count;
      if(prefix_count>0 && replay_start+prefix_count!=m_state.event_count)
         return TOV2_STATE_CONFLICT;
      if(m_state.event_count>TOV2_LOCAL_EVENTS-new_count) return TOV2_STATE_LIMIT;
      if(m_highest_observed>=TOV2_LOCAL_MAX_COUNTER) return TOV2_STATE_LIMIT;
      long generation=m_highest_observed+1;
      uchar capture_frame[]; string capture_sha="";
      Tov2LocalState candidate=m_state;
      candidate.generation=generation;
      candidate.parent_generation=m_state.generation;
      candidate.parent_commit=m_commit_sha;
      candidate.capture_schema=capture_schema;
      Tov2StorageLocator locators[];
      uchar frames[];
      int frame_ends[];
      long staged_sequences[];
      if(ArrayResize(staged_sequences,count)!=count) return TOV2_STATE_IO_ERROR;
      for(int i=0;i<prefix_count;i++)
         staged_sequences[i]=m_state.events[replay_start+i].sequence;
      if(ArrayResize(locators,new_count+1)!=new_count+1) return TOV2_STATE_IO_ERROR;
      previous=(prefix_count==0 ? 0 : event_ends[prefix_count-1]);
      for(int i=prefix_count;i<count;i++)
      {
         int new_index=i-prefix_count;
         int size=event_ends[i]-previous;
         uchar payload[],frame[]; string sha="";
         if(ArrayResize(payload,size)!=size ||
            ArrayCopy(payload,event_payload_arena,0,previous,size)!=size ||
            !MakeFrame("EVENT",generation,payload,frame,sha) ||
            !AppendFlat(frames,frame_ends,frame)) return TOV2_STATE_IO_ERROR;
         long sequence=candidate.produced+1;
         staged_sequences[i]=sequence;
         MakeRef(candidate.events[candidate.event_count],"EVENT",generation,new_index+1,sha,
                 sequence,candidates[i].event_id,candidates[i].record_sha,
                 candidates[i].deal_id,candidates[i].revision);
         candidate.event_count++;
         candidate.produced=sequence;
         locators[new_index]=Tov2StorageObjectLocator(generation,new_index+1);
         previous=event_ends[i];
      }
      if(!MakeFrame("CHECKPOINT",generation,capture_payload,capture_frame,capture_sha) ||
         !AppendFlat(frames,frame_ends,capture_frame)) return TOV2_STATE_IO_ERROR;
      MakeRef(candidate.capture,"CAPTURE",generation,new_count+1,capture_sha);
      locators[new_count]=Tov2StorageObjectLocator(generation,new_count+1);
      int published=Publish("APPEND",candidate,locators,frames,frame_ends);
      if(published!=TOV2_STATE_OK) { ArrayResize(sequences,0); return published; }
      if(ArrayResize(sequences,count)!=count ||
         ArrayCopy(sequences,staged_sequences,0,0,count)!=count)
      {
         ArrayResize(sequences,0);
         return TOV2_STATE_IO_ERROR;
      }
      return TOV2_STATE_OK;
   }

   int PublishDiagnostic(const string completeness,const string named_error)
   {
      int guard=Guard();
      if(guard!=TOV2_STATE_OK) return guard;
      if(!m_loaded ||
         !Tov2LocalCompleteness(completeness) || !Tov2LocalError(named_error))
         return TOV2_STATE_INVALID;
      int inventory=RefreshInventory();
      if(inventory!=TOV2_STATE_OK) return inventory;
      int current=VerifyCurrentRootFresh();
      if(current!=TOV2_STATE_OK) return current;
      if(m_highest_observed>=TOV2_LOCAL_MAX_COUNTER) return TOV2_STATE_LIMIT;
      Tov2LocalState candidate=m_state;
      candidate.generation=m_highest_observed+1;
      candidate.parent_generation=m_state.generation;
      candidate.parent_commit=m_commit_sha;
      candidate.completeness=completeness;
      candidate.last_error=named_error;
      Tov2StorageLocator locators[]; uchar arena[]; int ends[];
      return Publish("DIAGNOSTIC",candidate,locators,arena,ends);
   }

   int Compact()
   {
      int guard=Guard();
      if(guard!=TOV2_STATE_OK) return guard;
      if(!m_loaded) return TOV2_STATE_INVALID;
      int inventory=RefreshInventory();
      if(inventory!=TOV2_STATE_OK) return inventory;
      int current_verified=VerifyCurrentRootFresh();
      if(current_verified!=TOV2_STATE_OK) return current_verified;
      Tov2LocalState verified_current;
      string verified_current_sha="";
      if(LoadRoot(m_state.generation,verified_current,verified_current_sha)!=TOV2_STATE_OK ||
         verified_current_sha!=m_commit_sha || !SameState(verified_current,m_state))
         return TOV2_STATE_RECOVERY_REQUIRED;
      Tov2LocalState previous;
      string previous_sha="";
      Tov2LocalCommit current_commit; string current_commit_sha="";
      if(ReadCommitMetadata(m_state.generation,current_commit,current_commit_sha)!=TOV2_STATE_OK ||
         current_commit_sha!=m_commit_sha) return TOV2_STATE_RECOVERY_REQUIRED;
      bool continue_cleanup=false;
      if(current_commit.transition=="CHECKPOINT" && m_state.parent_generation>0)
      {
         if(LoadRoot(m_state.parent_generation,previous,previous_sha)!=TOV2_STATE_OK ||
            previous_sha!=m_state.parent_commit) return TOV2_STATE_RECOVERY_REQUIRED;
         if(previous.parent_generation>0)
         {
            int target_commit=InventoryIndex(Tov2StorageCommitLocator(previous.parent_generation));
            int target_state=InventoryIndex(Tov2StorageStateLocator(previous.parent_generation));
            if(target_commit>=0 && target_state>=0) continue_cleanup=true;
            else if(target_commit>=0 && target_state<0 &&
                    m_inventory[target_commit].sha==previous.parent_commit)
               continue_cleanup=true;
            else if(target_commit>=0 || target_state>=0) return TOV2_STATE_RECOVERY_REQUIRED;
         }
      }
      if(!continue_cleanup)
      {
         if(m_highest_observed>=TOV2_LOCAL_MAX_COUNTER) return TOV2_STATE_LIMIT;
         Tov2LocalState checkpoint=m_state;
         checkpoint.generation=m_highest_observed+1;
         checkpoint.parent_generation=m_state.generation;
         checkpoint.parent_commit=m_commit_sha;
         Tov2StorageLocator none[]; uchar arena[]; int ends[];
         int published=Publish("CHECKPOINT",checkpoint,none,arena,ends);
         if(published!=TOV2_STATE_OK) return published;
         if(RefreshInventory()!=TOV2_STATE_OK ||
            LoadRoot(m_state.generation,verified_current,verified_current_sha)!=TOV2_STATE_OK ||
            verified_current_sha!=m_commit_sha || !SameState(verified_current,m_state))
            return TOV2_STATE_RECOVERY_REQUIRED;
         if(m_state.parent_generation<1) return TOV2_STATE_OK;
         if(LoadRoot(m_state.parent_generation,previous,previous_sha)!=TOV2_STATE_OK ||
            previous_sha!=m_state.parent_commit) return TOV2_STATE_RECOVERY_REQUIRED;
      }
      if(previous.parent_generation<1) return TOV2_STATE_OK;

      // Positive authority is only the immediate grandparent reached by two exact
      // parent links. Lower or disconnected valid commits are never candidates.
      long retired_generation=previous.parent_generation;
      string retired_commit_sha=previous.parent_commit;
      int retired_commit_index=InventoryIndex(Tov2StorageCommitLocator(retired_generation));
      int retired_state_index=InventoryIndex(Tov2StorageStateLocator(retired_generation));
      if(retired_commit_index>=0 && retired_state_index<0)
      {
         // A prior state delete may have taken effect before returning an error.
         // The exact ancestor commit digest is sufficient to finish commit-last.
         if(m_inventory[retired_commit_index].sha!=retired_commit_sha ||
            RefreshInventory()!=TOV2_STATE_OK ||
            LoadRoot(m_state.generation,verified_current,verified_current_sha)!=TOV2_STATE_OK ||
            verified_current_sha!=m_commit_sha ||
            LoadRoot(m_state.parent_generation,previous,previous_sha)!=TOV2_STATE_OK ||
            previous_sha!=m_state.parent_commit) return TOV2_STATE_RECOVERY_REQUIRED;
         int orphan_attempts=0;
         return DeleteAuthorized(Tov2StorageCommitLocator(retired_generation),orphan_attempts);
      }
      Tov2StorageLocator retired_objects[]; bool has_ineligible=false;
      int loaded=LoadRetiredMetadata(retired_generation,retired_commit_sha,
                                     verified_current,previous,
                                     retired_objects,has_ineligible);
      if(loaded!=TOV2_STATE_OK) return loaded;
      // Revalidate both retained roots again immediately before the first mutation.
      if(RefreshInventory()!=TOV2_STATE_OK ||
         LoadRoot(m_state.generation,verified_current,verified_current_sha)!=TOV2_STATE_OK ||
         verified_current_sha!=m_commit_sha ||
         LoadRoot(m_state.parent_generation,previous,previous_sha)!=TOV2_STATE_OK ||
         previous_sha!=m_state.parent_commit)
         return TOV2_STATE_RECOVERY_REQUIRED;
      int attempts=0;
      int object_limit=has_ineligible ? TOV2_STORAGE_DELETE_BATCH :
                       TOV2_STORAGE_DELETE_BATCH-2;
      int object_count=ArraySize(retired_objects);
      int delete_count=MathMin(object_count,object_limit);
      for(int i=0;i<delete_count;i++)
      {
         int removed=DeleteAuthorized(retired_objects[i],attempts);
         if(removed!=TOV2_STATE_OK) return removed;
      }
      if(object_count>delete_count || has_ineligible) return TOV2_STATE_OK;
      // Metadata is retired only after no classified object remains. The reserved
      // two slots make state-before-commit completion atomic with respect to bounds.
      int removed=DeleteAuthorized(Tov2StorageStateLocator(retired_generation),attempts);
      if(removed!=TOV2_STATE_OK) return removed;
      removed=DeleteAuthorized(Tov2StorageCommitLocator(retired_generation),attempts);
      if(removed!=TOV2_STATE_OK) return removed;
      return TOV2_STATE_OK;
   }

   int ReservedTransition(const string transition)
   {
      if(transition=="PREPARE" || transition=="ACK" || transition=="REPLACE")
         return TOV2_STATE_UNSUPPORTED;
      return TOV2_STATE_INVALID;
   }

   void Close()
   {
      if(m_open && StorageValid()) m_storage.Close(m_session);
      m_session="";
      m_open=false;
      m_loaded=false;
      m_empty_ready=false;
      m_reload_required=false;
      ArrayResize(m_inventory,0);
      Tov2LocalClearState(m_state);
      m_commit_sha="";
   }

   bool ReloadRequired() const
   {
      return m_reload_required;
   }

   bool Snapshot(Tov2LocalState &state)
   {
      Tov2LocalClearState(state);
      if(Guard()!=TOV2_STATE_OK || !m_loaded) return false;
      state=m_state;
      return state.identity==m_expected_identity;
   }
};

#endif
~~~

## B. `mt5/TradeOpsAgent/Scripts/Support/TradeOpsTelemetryMemoryStore.mqh`

~~~cpp
#ifndef TRADEOPS_TELEMETRY_MEMORY_STORE_MQH
#define TRADEOPS_TELEMETRY_MEMORY_STORE_MQH
#include "../../Include/TradeOpsTelemetryStorage.mqh"

const int TOV2_MEMORY_FAULT_NONE=0;
const int TOV2_MEMORY_FAULT_BEFORE=1;
const int TOV2_MEMORY_FAULT_AFTER=2;

class CTov2TelemetryMemoryStore : public ITov2TelemetryStorage
{
private:
   int m_kind[];
   long m_generation[];
   long m_ordinal[];
   int m_offset[];
   int m_length[];
   bool m_deleted[];
   uchar m_arena[];
   int m_record_count;
   int m_arena_count;
   string m_installation_key;
   string m_owner_token;
   long m_session_serial;
   string m_fault_operation;
   int m_fault_occurrence;
   int m_fault_seen;
   int m_fault_mode;
   int m_delete_log_kind[];
   long m_delete_log_generation[];
   long m_delete_log_ordinal[];
   int m_delete_log_count;
   string m_internal_fault_operation;
   int m_internal_fault_occurrence;
   int m_internal_fault_seen;
   string m_outcome_operation;
   int m_outcome_occurrence;
   int m_outcome_seen;
   int m_outcome_result;

   bool Session(const string token)
   {
      return token!="" && token==m_owner_token;
   }

   bool Fault(const string operation,const int boundary)
   {
      if(m_fault_mode!=boundary ||
         (m_fault_operation!="ANY" && m_fault_operation!=operation)) return false;
      m_fault_seen++;
      if(m_fault_seen!=m_fault_occurrence) return false;
      m_fault_mode=TOV2_MEMORY_FAULT_NONE;
      return true;
   }

   bool InternalFault(const string operation)
   {
      if(m_internal_fault_operation!=operation) return false;
      m_internal_fault_seen++;
      return m_internal_fault_seen==m_internal_fault_occurrence;
   }

   bool ForcedOutcome(const string operation,int &result)
   {
      if(m_outcome_operation!=operation) return false;
      m_outcome_seen++;
      if(m_outcome_seen!=m_outcome_occurrence) return false;
      result=m_outcome_result;
      return true;
   }

   int Find(const Tov2StorageLocator &locator)
   {
      for(int i=m_record_count-1;i>=0;i--)
         if(!m_deleted[i] && m_kind[i]==locator.kind &&
            m_generation[i]==locator.generation && m_ordinal[i]==locator.ordinal)
            return i;
      return -1;
   }

   bool SegmentEqual(const int index,const uchar &bytes[])
   {
      int count=ArraySize(bytes);
      if(index<0 || m_length[index]!=count) return false;
      for(int i=0;i<count;i++)
         if(m_arena[m_offset[index]+i]!=bytes[i]) return false;
      return true;
   }

   bool AppendRecord(const Tov2StorageLocator &locator,const uchar &bytes[])
   {
      int old_count=m_record_count;
      int old_bytes=m_arena_count;
      int count=ArraySize(bytes);
      if(count<1 || count>TOV2_RECORD_FRAME_MAX ||
         ArrayResize(m_kind,old_count+1)!=old_count+1 ||
         InternalFault("ALLOC_RECORD") ||
         ArrayResize(m_generation,old_count+1)!=old_count+1 ||
         ArrayResize(m_ordinal,old_count+1)!=old_count+1 ||
         ArrayResize(m_offset,old_count+1)!=old_count+1 ||
         ArrayResize(m_length,old_count+1)!=old_count+1 ||
         ArrayResize(m_deleted,old_count+1)!=old_count+1 ||
         ArrayResize(m_arena,old_bytes+count)!=old_bytes+count ||
         InternalFault("COPY_RECORD") ||
         ArrayCopy(m_arena,bytes,old_bytes,0,count)!=count) return false;
      m_kind[old_count]=locator.kind;
      m_generation[old_count]=locator.generation;
      m_ordinal[old_count]=locator.ordinal;
      m_offset[old_count]=old_bytes;
      m_length[old_count]=count;
      m_deleted[old_count]=false;
      m_arena_count=old_bytes+count;
      m_record_count=old_count+1;
      return true;
   }

public:
   CTov2TelemetryMemoryStore()
   {
      m_owner_token="";
      m_installation_key="";
      m_session_serial=0;
      m_fault_operation="";
      m_fault_occurrence=0;
      m_fault_seen=0;
      m_fault_mode=TOV2_MEMORY_FAULT_NONE;
      m_record_count=0;
      m_arena_count=0;
      m_delete_log_count=0;
      m_internal_fault_operation="";
      m_internal_fault_occurrence=0;
      m_internal_fault_seen=0;
      m_outcome_operation="";
      m_outcome_occurrence=0;
      m_outcome_seen=0;
      m_outcome_result=TOV2_STORE_IO_ERROR;
   }

   void ArmFault(const string operation,const int occurrence,const int mode)
   {
      m_fault_operation=operation;
      m_fault_occurrence=occurrence;
      m_fault_seen=0;
      m_fault_mode=mode;
   }

   void ClearFault()
   {
      m_fault_operation="";
      m_fault_occurrence=0;
      m_fault_seen=0;
      m_fault_mode=TOV2_MEMORY_FAULT_NONE;
   }

   void ArmInternalFault(const string operation,const int occurrence)
   {
      m_internal_fault_operation=operation;
      m_internal_fault_occurrence=occurrence;
      m_internal_fault_seen=0;
   }

   void ClearInternalFault()
   {
      m_internal_fault_operation="";
      m_internal_fault_occurrence=0;
      m_internal_fault_seen=0;
   }

   void ArmOutcome(const string operation,const int occurrence,const int result)
   {
      m_outcome_operation=operation;
      m_outcome_occurrence=occurrence;
      m_outcome_seen=0;
      m_outcome_result=result;
   }

   void ClearOutcome()
   {
      m_outcome_operation="";
      m_outcome_occurrence=0;
      m_outcome_seen=0;
      m_outcome_result=TOV2_STORE_IO_ERROR;
   }

   void Crash()
   {
      m_owner_token="";
      ClearFault();
      ClearInternalFault();
      ClearOutcome();
   }

   int PersistentCount()
   {
      int count=0;
      for(int i=0;i<m_record_count;i++) if(!m_deleted[i]) count++;
      return count;
   }

   int Acquire(const string installation_key,string &session_token)
   {
      session_token="";
      if(!Tov2Digest(installation_key)) return TOV2_STORE_INVALID;
      if(Fault("ACQUIRE",TOV2_MEMORY_FAULT_BEFORE)) return TOV2_STORE_IO_ERROR;
      if(m_installation_key!="" && m_installation_key!=installation_key)
         return TOV2_STORE_CONFLICT;
      if(m_owner_token!="") return TOV2_STORE_BUSY;
      if(m_installation_key=="") m_installation_key=installation_key;
      m_session_serial++;
      m_owner_token="memory.session."+Tov2LocalNumber(m_session_serial);
      session_token=m_owner_token;
      if(Fault("ACQUIRE",TOV2_MEMORY_FAULT_AFTER))
      {
         m_owner_token="";
         session_token="";
         return TOV2_STORE_IO_ERROR;
      }
      return TOV2_STORE_ACQUIRED;
   }

   int Revalidate(const string session_token)
   {
      if(Fault("REVALIDATE",TOV2_MEMORY_FAULT_BEFORE)) return TOV2_STORE_IO_ERROR;
      if(!Session(session_token)) return TOV2_STORE_OWNERSHIP_LOST;
      if(Fault("REVALIDATE",TOV2_MEMORY_FAULT_AFTER))
      {
         m_owner_token="";
         return TOV2_STORE_IO_ERROR;
      }
      return TOV2_STORE_OK;
   }

   int Inventory(const string session_token,Tov2StorageEntry &entries[])
   {
      ArrayResize(entries,0);
      if(Fault("INVENTORY",TOV2_MEMORY_FAULT_BEFORE)) return TOV2_STORE_IO_ERROR;
      if(!Session(session_token)) return TOV2_STORE_OWNERSHIP_LOST;
      int count=PersistentCount();
      if(count>TOV2_STORAGE_INVENTORY_MAX) return TOV2_STORE_LIMIT;
      if(count==0)
      {
         if(Fault("INVENTORY",TOV2_MEMORY_FAULT_AFTER)) return TOV2_STORE_IO_ERROR;
         return TOV2_STORE_ABSENT;
      }
      if(ArrayResize(entries,count)!=count)
      {
         ArrayResize(entries,0);
         return TOV2_STORE_IO_ERROR;
      }
      int out=0;
      for(int i=0;i<m_record_count;i++)
      {
         if(m_deleted[i]) continue;
         entries[out].locator.kind=m_kind[i];
         entries[out].locator.generation=m_generation[i];
         entries[out].locator.ordinal=m_ordinal[i];
         entries[out].relative_path=Tov2StorageRelativePath(entries[out].locator);
         entries[out].size=m_length[i];
         if(m_kind[i]==TOV2_LOC_OWNER) entries[out].sha="-";
         else
         {
            uchar value[];
            if(ArrayResize(value,m_length[i])!=m_length[i] ||
               ArrayCopy(value,m_arena,0,m_offset[i],m_length[i])!=m_length[i] ||
               !Tov2LocalHash(value,entries[out].sha))
            {
               ArrayResize(entries,0);
               return TOV2_STORE_IO_ERROR;
            }
         }
         out++;
      }
      if(Fault("INVENTORY",TOV2_MEMORY_FAULT_AFTER))
      {
         ArrayResize(entries,0);
         return TOV2_STORE_IO_ERROR;
      }
      return TOV2_STORE_OK;
   }

   int Read(const string session_token,const Tov2StorageLocator &locator,
            uchar &bytes[])
   {
      ArrayResize(bytes,0);
      if(!Tov2StorageLocatorValid(locator) || locator.kind==TOV2_LOC_OWNER)
         return TOV2_STORE_INVALID;
      if(Fault("READ",TOV2_MEMORY_FAULT_BEFORE)) return TOV2_STORE_IO_ERROR;
      if(!Session(session_token)) return TOV2_STORE_OWNERSHIP_LOST;
      int index=Find(locator);
      if(index<0) return TOV2_STORE_ABSENT;
      int count=m_length[index];
      if(ArrayResize(bytes,count)!=count ||
         ArrayCopy(bytes,m_arena,0,m_offset[index],count)!=count)
      {
         ArrayResize(bytes,0);
         return TOV2_STORE_IO_ERROR;
      }
      if(Fault("READ",TOV2_MEMORY_FAULT_AFTER))
      {
         ArrayResize(bytes,0);
         return TOV2_STORE_IO_ERROR;
      }
      return TOV2_STORE_OK;
   }

   int CreateExact(const string session_token,const Tov2StorageLocator &locator,
                   const uchar &bytes[])
   {
      if(!Tov2StorageLocatorValid(locator) || locator.kind==TOV2_LOC_OWNER ||
         ArraySize(bytes)<1 || ArraySize(bytes)>TOV2_RECORD_FRAME_MAX)
         return TOV2_STORE_INVALID;
      if(Fault("CREATE",TOV2_MEMORY_FAULT_BEFORE)) return TOV2_STORE_IO_ERROR;
      if(!Session(session_token)) return TOV2_STORE_OWNERSHIP_LOST;
      int forced=TOV2_STORE_IO_ERROR;
      if(ForcedOutcome("CREATE",forced)) return forced;
      int index=Find(locator);
      if(index>=0)
         return SegmentEqual(index,bytes) ? TOV2_STORE_EXISTS_SAME : TOV2_STORE_CONFLICT;
      if(!AppendRecord(locator,bytes)) return TOV2_STORE_IO_ERROR;
      if(Fault("CREATE",TOV2_MEMORY_FAULT_AFTER)) return TOV2_STORE_IO_ERROR;
      return TOV2_STORE_CREATED;
   }

   int DeleteExact(const string session_token,const Tov2StorageLocator &locator,
                   const string expected_sha)
   {
      if(!Tov2StorageLocatorValid(locator) || locator.kind==TOV2_LOC_OWNER ||
         !Tov2Digest(expected_sha)) return TOV2_STORE_INVALID;
      if(Fault("DELETE",TOV2_MEMORY_FAULT_BEFORE)) return TOV2_STORE_IO_ERROR;
      if(!Session(session_token)) return TOV2_STORE_OWNERSHIP_LOST;
      int forced=TOV2_STORE_IO_ERROR;
      if(ForcedOutcome("DELETE",forced)) return forced;
      int log_count=m_delete_log_count;
      if(ArrayResize(m_delete_log_kind,log_count+1)!=log_count+1 ||
         InternalFault("ALLOC_LOG") ||
         ArrayResize(m_delete_log_generation,log_count+1)!=log_count+1 ||
         ArrayResize(m_delete_log_ordinal,log_count+1)!=log_count+1)
         return TOV2_STORE_IO_ERROR;
      m_delete_log_kind[log_count]=locator.kind;
      m_delete_log_generation[log_count]=locator.generation;
      m_delete_log_ordinal[log_count]=locator.ordinal;
      m_delete_log_count=log_count+1;
      int index=Find(locator);
      if(index<0) return TOV2_STORE_ABSENT;
      uchar value[]; string actual="";
      if(ArrayResize(value,m_length[index])!=m_length[index] ||
         ArrayCopy(value,m_arena,0,m_offset[index],m_length[index])!=m_length[index] ||
         !Tov2LocalHash(value,actual)) return TOV2_STORE_IO_ERROR;
      if(actual!=expected_sha) return TOV2_STORE_CONFLICT;
      m_deleted[index]=true;
      if(Fault("DELETE",TOV2_MEMORY_FAULT_AFTER)) return TOV2_STORE_IO_ERROR;
      return TOV2_STORE_DELETED;
   }

   void Close(const string session_token)
   {
      if(Session(session_token)) m_owner_token="";
   }

   bool Corrupt(const Tov2StorageLocator &locator,const int byte_index)
   {
      int index=Find(locator);
      if(index<0 || byte_index<0 || byte_index>=m_length[index]) return false;
      m_arena[m_offset[index]+byte_index]^=1;
      return true;
   }

   bool Remove(const Tov2StorageLocator &locator)
   {
      int index=Find(locator);
      if(index<0) return false;
      m_deleted[index]=true;
      return true;
   }

   bool Inject(const Tov2StorageLocator &locator,const uchar &bytes[])
   {
      if(!Tov2StorageLocatorValid(locator) || Find(locator)>=0) return false;
      return AppendRecord(locator,bytes);
   }

   bool Exists(const Tov2StorageLocator &locator)
   {
      return Find(locator)>=0;
   }

   bool Copy(const Tov2StorageLocator &locator,uchar &bytes[])
   {
      ArrayResize(bytes,0);
      int index=Find(locator);
      if(index<0) return false;
      return ArrayResize(bytes,m_length[index])==m_length[index] &&
             ArrayCopy(bytes,m_arena,0,m_offset[index],m_length[index])==m_length[index];
   }

   void ClearDeleteLog()
   {
      m_delete_log_count=0;
   }

   int RecordCount() { return m_record_count; }
   int DeleteLogCount() { return m_delete_log_count; }
   int DeleteLogKind(const int index)
   {
      return index>=0 && index<m_delete_log_count ? m_delete_log_kind[index] : 0;
   }
   long DeleteLogGeneration(const int index)
   {
      return index>=0 && index<m_delete_log_count ?
             m_delete_log_generation[index] : 0;
   }
   long DeleteLogOrdinal(const int index)
   {
      return index>=0 && index<m_delete_log_count ?
             m_delete_log_ordinal[index] : 0;
   }
};

#endif
~~~
