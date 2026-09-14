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
             produced<=state.produced && fields[7]==state.pending_body;
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

class CWitnessPayloadValidator : public CSyntheticPayloadValidator
{
public:
   string expected[3];
   CTov2TelemetryState *reenter;
   int unpaired_calls,pair_calls,capability_busy,pair_busy;
   bool reject_pair;
   CWitnessPayloadValidator()
   {
      for(int i=0;i<3;i++) expected[i]="";
      reenter=NULL;unpaired_calls=0;pair_calls=0;capability_busy=0;pair_busy=0;
      reject_pair=false;
   }
   virtual bool RequiresAckWitness()
   {
      if(CheckPointer(reenter)!=POINTER_INVALID && reenter.Recover()==TOV2_STATE_BUSY)
         capability_busy++;
      return true;
   }
   virtual bool Ack(const uchar &payload[],const Tov2LocalState &state,const string identity)
   { unpaired_calls++;return false; }
   virtual bool AckWithPending(const uchar &response[],const uchar &pending[],
                               const Tov2LocalState &state,const string identity)
   {
      pair_calls++;
      if(CheckPointer(reenter)!=POINTER_INVALID && reenter.Compact()==TOV2_STATE_BUSY)
         pair_busy++;
      string text="";
      return !reject_pair && state.ack_request>=1 && state.ack_request<=3 &&
         Tov2LocalText(pending,text) && text==expected[(int)state.ack_request-1] &&
         CSyntheticPayloadValidator::Ack(response,state,identity);
   }
};

class CWitnessTestAdapter : public ITov2TelemetryOutboxAdapter
{
public:
   virtual int Build(const Tov2OutboxContext &context,const uchar &registration[],
                     const uchar &event_arena[],const int &event_ends[],
                     const int prefix_count,Tov2OutboxCandidate &candidate,uchar &request[])
   { return TOV2_OUTBOX_BUILD_INVALID; }
   virtual bool ValidateRequest(const Tov2OutboxContext &context,const uchar &registration[],
                     const uchar &event_arena[],const int &event_ends[],
                     const Tov2OutboxCandidate &candidate,const uchar &request[])
   {
      uchar expected[];
      return PendingBytes(context.state.identity,candidate.request_sequence,
         context.state.accepted_event,context.state.accepted_event+candidate.prefix_count,
         candidate.prefix_count,candidate.frozen_produced,candidate.body_sha,expected) &&
         Tov2LocalEqual(expected,request);
   }
   virtual bool ValidateResponse(const Tov2LocalState &state,const uchar &pending[],
                                 const uchar &response[],Tov2OutboxAcceptance &accepted)
   {
      uchar expected[];
      Tov2OutboxClearAcceptance(accepted);
      if(!AckBytes(state.identity,state.pending_request,state.pending_final,1,
         state.pending.sha,state.pending_body,expected) || !Tov2LocalEqual(expected,response)) return false;
      accepted.identity=state.identity;accepted.registration_sha=state.registration.sha;
      accepted.request_sequence=state.pending_request;accepted.body_sha=state.pending_body;
      accepted.pending_sha=state.pending.sha;accepted.final_event=state.pending_final;
      accepted.accepted_at=1;return true;
   }
   virtual bool ValidateReplacement(const Tov2LocalState &state,const uchar &pending[],
                     const uchar &rejection[],const uchar &replacement[],const string body_sha)
   { return false; }
};

bool WitnessPrepare(CTov2TelemetryState &state,CWitnessPayloadValidator &validator,
                    CWitnessTestAdapter &adapter,Tov2StorageLocator &locator,uchar &response[])
{
   Tov2OutboxContext context;uchar registration[],arena[],request[],persisted[];int ends[];
   if(state.ReadOutboxContext(context,registration,arena,ends)!=TOV2_STATE_OK) return false;
   Tov2OutboxCandidate candidate;Tov2OutboxClearCandidate(candidate);
   candidate.expected_generation=context.state.generation;candidate.expected_root_sha=context.root_sha;
   candidate.registration_sha=context.state.registration.sha;
   candidate.request_sequence=context.state.accepted_request+1;candidate.body_sha=Repeat("a",64);
   candidate.prefix_count=context.state.event_count;candidate.frozen_produced=context.state.produced;
   if(candidate.request_sequence>3 || !PendingBytes(context.state.identity,candidate.request_sequence,
      context.state.accepted_event,context.state.accepted_event+candidate.prefix_count,
      candidate.prefix_count,candidate.frozen_produced,candidate.body_sha,request) ||
      !Tov2LocalText(request,validator.expected[(int)candidate.request_sequence-1]) ||
      state.PreparePending(GetPointer(adapter),candidate,request,persisted)!=TOV2_STATE_OK ||
      !Tov2LocalEqual(request,persisted)) return false;
   Tov2LocalState pending;if(!state.Snapshot(pending)) return false;
   locator=Tov2StorageObjectLocator(pending.pending.generation,pending.pending.ordinal);
   return AckBytes(pending.identity,pending.pending_request,pending.pending_final,1,
                   pending.pending.sha,pending.pending_body,response);
}

void AckWitnessRecovery()
{
   for(int damage=0;damage<5;damage++)
   {
      CTov2TelemetryMemoryStore store;CWitnessPayloadValidator validator;CWitnessTestAdapter adapter;
      CTov2TelemetryState state(GetPointer(store),GetPointer(validator),Identity());
      Check(NewInitialized(store,state) && AppendOne(state,"witness.event","event.witness","capture.witness"),
            "ack_witness.initialize");
      Tov2StorageLocator locator;uchar response[];
      Check(WitnessPrepare(state,validator,adapter,locator,response),"ack_witness.prepare");
      Tov2LocalState before;Check(state.Snapshot(before),"ack_witness.before");
      int records=store.RecordCount();validator.reject_pair=true;validator.reenter=GetPointer(state);
      Check(state.AcceptResponse(GetPointer(adapter),response)==TOV2_STATE_INVALID &&
            store.RecordCount()==records,"ack_witness.reject_no_publication");
      Tov2LocalState unchanged;
      Check(state.Snapshot(unchanged) && unchanged.generation==before.generation &&
            unchanged.accepted_event==before.accepted_event,"ack_witness.reject_no_advancement");
      validator.reject_pair=false;
      Check(state.AcceptResponse(GetPointer(adapter),response)==TOV2_STATE_OK,"ack_witness.accept");
      Check(validator.capability_busy>0 && validator.pair_busy>0 && validator.unpaired_calls==0,
            "ack_witness.callback_reentry_refused");
      Tov2LocalState committed;Check(state.Snapshot(committed),"ack_witness.committed");
      state.Close();validator.reenter=NULL;
      if(damage==1) Check(store.Remove(locator),"ack_witness.remove");
      if(damage==2) Check(store.Corrupt(locator,0),"ack_witness.corrupt");
      if(damage==3)
      {
         // A second valid object with the exact frame digest is ambiguous.
         uchar copy[];Check(store.Copy(locator,copy) &&
            store.Inject(Tov2StorageObjectLocator(locator.generation,9),copy),"ack_witness.duplicate");
      }
      if(damage==4)
      {
         // Validly framed metadata and ACK redirected to a different valid request.
         uchar other[],frame[],ack_frame[];string other_sha="",ack_sha="",commit_sha="";
         Check(PendingBytes(Identity(),2,0,1,1,1,Repeat("a",64),other) &&
               Tov2RecordEncode("PENDING",locator.generation,other,frame) &&
               Tov2LocalHash(frame,other_sha) && store.Remove(locator) && store.Inject(locator,frame),
               "ack_witness.substitute_request");
         committed.ack_pending_sha=other_sha;
         Check(AckBytes(Identity(),1,1,1,other_sha,committed.ack_body,response) &&
               Tov2RecordEncode("ACK",committed.ack.generation,response,ack_frame) &&
               Tov2LocalHash(ack_frame,ack_sha),"ack_witness.substitute_ack");
         committed.ack.sha=ack_sha;
         Check(store.Remove(Tov2StorageObjectLocator(committed.ack.generation,2)) &&
               store.Inject(Tov2StorageObjectLocator(committed.ack.generation,2),ack_frame) &&
               store.Remove(Tov2StorageStateLocator(committed.generation)) &&
               store.Remove(Tov2StorageCommitLocator(committed.generation)) &&
               InjectRoot(store,committed,"ACK",commit_sha),"ack_witness.substitute_metadata");
      }
      records=store.RecordCount();
      CTov2TelemetryState reopened(GetPointer(store),GetPointer(validator),Identity());
      Check(reopened.Open()==TOV2_STATE_OK,"ack_witness.reopen");
      int result=reopened.Recover();
      Check(result==(damage==0 ? TOV2_STATE_OK : TOV2_STATE_RECOVERY_REQUIRED),
            "ack_witness.recovery."+IntegerToString(damage));
      Check(store.RecordCount()==records,"ack_witness.recovery_no_publication");
      if(damage==0) Check(reopened.Snapshot(unchanged) && unchanged.accepted_request==1 &&
         unchanged.accepted_event==1,"ack_witness.recovered_prefix");
      else Check(!reopened.Snapshot(unchanged),"ack_witness.damaged_not_loaded");
      reopened.Close();
   }
}

void AckWitnessCompaction()
{
   CTov2TelemetryMemoryStore store;CWitnessPayloadValidator validator;CWitnessTestAdapter adapter;
   CTov2TelemetryState state(GetPointer(store),GetPointer(validator),Identity());
   Check(NewInitialized(store,state),"ack_witness.compact_initialize");
   Tov2StorageLocator witnesses[3];uchar response[];
   for(int request=0;request<3;request++)
   {
      Check(WitnessPrepare(state,validator,adapter,witnesses[request],response) &&
            state.AcceptResponse(GetPointer(adapter),response)==TOV2_STATE_OK,
            "ack_witness.compact_accept."+IntegerToString(request+1));
      Check(store.Exists(witnesses[request]),"ack_witness.current_retained");
      for(int pass=0;pass<3;pass++)
      {
         Check(state.Compact()==TOV2_STATE_OK,"ack_witness.repeated_compact");
         Check(store.Exists(witnesses[request]),"ack_witness.current_survives");
         if(request>0) Check(!store.Exists(witnesses[request-1]),"ack_witness.retired_reclaimed");
         state.Close();
         Check(state.Open()==TOV2_STATE_OK && state.Recover()==TOV2_STATE_OK,
               "ack_witness.compact_reopen");
         Tov2LocalState snapshot;
         Check(state.Snapshot(snapshot) && snapshot.accepted_request==request+1,
               "ack_witness.compact_prefix");
      }
   }
   state.Close();
}

void AckWitnessPreviousRoot()
{
   for(int mode=TOV2_MEMORY_FAULT_BEFORE;mode<=TOV2_MEMORY_FAULT_AFTER;mode++)
   {
      CTov2TelemetryMemoryStore store;CWitnessPayloadValidator validator;CWitnessTestAdapter adapter;
      CTov2TelemetryState state(GetPointer(store),GetPointer(validator),Identity());
      Check(NewInitialized(store,state),"ack_witness.previous_initialize");
      Tov2StorageLocator first,second;uchar response[],commit_frame[];
      Check(WitnessPrepare(state,validator,adapter,first,response) &&
            state.AcceptResponse(GetPointer(adapter),response)==TOV2_STATE_OK,
            "ack_witness.previous_ack1");
      Tov2LocalState ack1,ack2;string ack1_sha="",current_sha="";
      Check(state.Snapshot(ack1) && store.Copy(Tov2StorageCommitLocator(ack1.generation),commit_frame) &&
            Tov2LocalHash(commit_frame,ack1_sha),"ack_witness.previous_commit");
      Check(WitnessPrepare(state,validator,adapter,second,response) &&
            state.AcceptResponse(GetPointer(adapter),response)==TOV2_STATE_OK && state.Snapshot(ack2),
            "ack_witness.previous_ack2");
      state.Close();
      // Exact chain fixture: current ACK2 -> previous ACK1 -> retired PREPARE1.
      // It isolates protection by the previous root after current advances.
      ack2.parent_generation=ack1.generation;ack2.parent_commit=ack1_sha;
      Check(store.Remove(Tov2StorageStateLocator(ack2.generation)) &&
            store.Remove(Tov2StorageCommitLocator(ack2.generation)) &&
            InjectRoot(store,ack2,"CHECKPOINT",current_sha),"ack_witness.previous_chain");
      Check(state.Open()==TOV2_STATE_OK && state.Recover()==TOV2_STATE_OK,
            "ack_witness.previous_recover");
      store.ArmFault("DELETE",1,mode);
      Check(state.Compact()!=TOV2_STATE_OK && state.ReloadRequired(),"ack_witness.previous_prune_fault");
      Check(store.Exists(first) && store.Exists(second),"ack_witness.previous_survives_fault");
      store.ClearFault();state.Close();
      Check(state.Open()==TOV2_STATE_OK && state.Recover()==TOV2_STATE_OK &&
            state.Compact()==TOV2_STATE_OK,"ack_witness.previous_retry");
      Check(store.Exists(first) && store.Exists(second),"ack_witness.previous_only_retained");
      state.Close();
      Check(state.Open()==TOV2_STATE_OK && state.Recover()==TOV2_STATE_OK &&
            state.Compact()==TOV2_STATE_OK,"ack_witness.previous_advance");
      Check(!store.Exists(first) && store.Exists(second),"ack_witness.previous_eventual_reclaim");
      state.Close();
   }
}

void AckWitnessPublicationFaults()
{
   for(int mode=TOV2_MEMORY_FAULT_BEFORE;mode<=TOV2_MEMORY_FAULT_AFTER;mode++)
      for(int boundary=1;boundary<=3;boundary++)
      {
         CTov2TelemetryMemoryStore store;CWitnessPayloadValidator validator;CWitnessTestAdapter adapter;
         CTov2TelemetryState state(GetPointer(store),GetPointer(validator),Identity());
         Check(NewInitialized(store,state) && AppendOne(state,"fault.event","event.fault","capture.fault"),
               "ack_witness.publication_initialize");
         Tov2StorageLocator locator;uchar response[];
         Check(WitnessPrepare(state,validator,adapter,locator,response),"ack_witness.publication_prepare");
         store.ArmFault("CREATE",boundary,mode);
         Check(state.AcceptResponse(GetPointer(adapter),response)!=TOV2_STATE_OK && state.ReloadRequired(),
               "ack_witness.publication_fault");
         Check(store.Exists(locator),"ack_witness.publication_preserves_request");
         store.ClearFault();store.Crash();state.Close();
         CTov2TelemetryState fresh(GetPointer(store),GetPointer(validator),Identity());
         Check(fresh.Open()==TOV2_STATE_OK && fresh.Recover()==TOV2_STATE_OK,
               "ack_witness.publication_restart");
         bool committed=(mode==TOV2_MEMORY_FAULT_AFTER && boundary==3);
         Tov2LocalState snapshot;
         Check(fresh.Snapshot(snapshot) && snapshot.accepted_request==(committed ? 1 : 0) &&
               snapshot.accepted_event==(committed ? 1 : 0),"ack_witness.publication_atomic_prefix");
         Check(fresh.AcceptResponse(GetPointer(adapter),response)==TOV2_STATE_OK &&
               fresh.Snapshot(snapshot) && snapshot.accepted_request==1 && snapshot.accepted_event==1,
               "ack_witness.publication_retry_once");
         fresh.Close();
      }
   for(int mode=TOV2_MEMORY_FAULT_BEFORE;mode<=TOV2_MEMORY_FAULT_AFTER;mode++)
      for(int boundary=1;boundary<=2;boundary++)
      {
         CTov2TelemetryMemoryStore store;CWitnessPayloadValidator validator;CWitnessTestAdapter adapter;
         CTov2TelemetryState state(GetPointer(store),GetPointer(validator),Identity());
         Tov2StorageLocator locator;uchar response[];
         Check(NewInitialized(store,state) && WitnessPrepare(state,validator,adapter,locator,response) &&
               state.AcceptResponse(GetPointer(adapter),response)==TOV2_STATE_OK,
               "ack_witness.checkpoint_initialize");
         store.ArmFault("CREATE",boundary,mode);
         Check(state.Compact()!=TOV2_STATE_OK && state.ReloadRequired() && store.Exists(locator),
               "ack_witness.checkpoint_publication_fault");
         store.ClearFault();store.Crash();state.Close();
         Check(state.Open()==TOV2_STATE_OK && state.Recover()==TOV2_STATE_OK &&
               state.Compact()==TOV2_STATE_OK && store.Exists(locator),"ack_witness.checkpoint_retry");
         state.Close();
      }
}

void AckWitnessDeleteFaults()
{
   for(int mode=TOV2_MEMORY_FAULT_BEFORE;mode<=TOV2_MEMORY_FAULT_AFTER;mode++)
      for(int boundary=1;boundary<=4;boundary++)
      {
         CTov2TelemetryMemoryStore store;CWitnessPayloadValidator validator;CWitnessTestAdapter adapter;
         CTov2TelemetryState state(GetPointer(store),GetPointer(validator),Identity());
         Check(NewInitialized(store,state),"ack_witness.delete_initialize");
         Tov2StorageLocator first,second;uchar response[];
         Check(WitnessPrepare(state,validator,adapter,first,response) &&
               state.AcceptResponse(GetPointer(adapter),response)==TOV2_STATE_OK,
               "ack_witness.delete_ack1");
         Tov2LocalState ack1;Check(state.Snapshot(ack1),"ack_witness.delete_snapshot");
         Check(WitnessPrepare(state,validator,adapter,second,response) &&
               state.AcceptResponse(GetPointer(adapter),response)==TOV2_STATE_OK,
               "ack_witness.delete_ack2");
         store.ClearDeleteLog();store.ArmFault("DELETE",boundary,mode);
         Check(state.Compact()!=TOV2_STATE_OK && state.ReloadRequired(),"ack_witness.delete_fault");
         Check(store.Exists(second),"ack_witness.delete_protected_intact");
         if(boundary==1) Check(store.Exists(first),"ack_witness.delete_ack_before_witness");
         if(mode==TOV2_MEMORY_FAULT_AFTER && boundary==1)
            Check(!store.Exists(Tov2StorageObjectLocator(ack1.ack.generation,2)) && store.Exists(first),
                  "ack_witness.delete_after_ack_resume_authority");
         store.ClearFault();store.Crash();state.Close();
         CTov2TelemetryState fresh(GetPointer(store),GetPointer(validator),Identity());
         Check(fresh.Open()==TOV2_STATE_OK && fresh.Recover()==TOV2_STATE_OK,
               "ack_witness.delete_restart");
         Tov2LocalState snapshot;
         Check(fresh.Snapshot(snapshot) && snapshot.accepted_request==2 && snapshot.accepted_event==0,
               "ack_witness.delete_no_advancement");
         Check(fresh.Compact()==TOV2_STATE_OK && !store.Exists(first) && store.Exists(second),
               "ack_witness.delete_retry_reclaims");
         fresh.Close();
         Check(fresh.Open()==TOV2_STATE_OK && fresh.Recover()==TOV2_STATE_OK,
               "ack_witness.delete_final_restart");
         fresh.Close();
         Check(store.DeleteLogKind(0)==TOV2_LOC_OBJECT &&
               store.DeleteLogGeneration(0)==ack1.ack.generation && store.DeleteLogOrdinal(0)==2,
               "ack_witness.delete_order_ack_first");
      }
}

void OnStart()
{
   synthetic_validator.AcceptAll();
   AckWitnessRecovery();
   AckWitnessCompaction();
   AckWitnessPreviousRoot();
   AckWitnessPublicationFaults();
   AckWitnessDeleteFaults();
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
