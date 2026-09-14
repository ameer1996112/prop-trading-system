#ifndef TRADEOPS_TELEMETRY_STATE_MQH
#define TRADEOPS_TELEMETRY_STATE_MQH
#include "TradeOpsTelemetryStorage.mqh"
#include "TradeOpsTelemetryOutboxContract.mqh"

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
   virtual bool RequiresAckWitness() { return false; }
   virtual bool AckWithPending(const uchar &response[],const uchar &pending[],
                               const Tov2LocalState &state,const string identity)
   { return false; }
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
   bool m_callback_active;
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
      if(m_callback_active) return TOV2_STATE_BUSY;
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

   bool AckWitnessRequired(bool &required)
   {
      required=true;
      if(m_callback_active || !DependenciesValid()) return false;
      m_callback_active=true;
      required=m_validator.RequiresAckWitness();
      m_callback_active=false;
      return DependenciesValid();
   }

   int ReadAckWitness(const Tov2LocalState &state,
                      Tov2StorageLocator &locator,uchar &pending[])
   {
      Tov2StorageClearLocator(locator);ArrayResize(pending,0);
      if(state.ack.kind!="ACK" || !Tov2Digest(state.ack_pending_sha) ||
         ArraySize(m_inventory)>TOV2_STORAGE_INVENTORY_MAX)
         return TOV2_STATE_RECOVERY_REQUIRED;
      int matches=0;
      for(int i=0;i<ArraySize(m_inventory);i++)
         if(m_inventory[i].sha==state.ack_pending_sha)
         {
            matches++;
            locator=m_inventory[i].locator;
         }
      if(matches!=1 || locator.kind!=TOV2_LOC_OBJECT ||
         !Tov2StorageLocatorValid(locator)) return TOV2_STATE_RECOVERY_REQUIRED;
      uchar frame[],payload[];string actual="",kind="";long generation=0;
      int read=ReadExact(locator,frame);
      if(read!=TOV2_STATE_OK) return read==TOV2_STATE_NOT_STARTED ?
         TOV2_STATE_RECOVERY_REQUIRED : read;
      if(!Tov2LocalHash(frame,actual) || actual!=state.ack_pending_sha ||
         !Tov2RecordDecode(frame,kind,generation,payload) || kind!="PENDING" ||
         generation!=locator.generation || generation>=state.ack.generation)
         return TOV2_STATE_RECOVERY_REQUIRED;
      return Tov2LocalCopy(payload,pending) ? TOV2_STATE_OK : TOV2_STATE_IO_ERROR;
   }

   bool AckPayloadValid(const Tov2LocalState &state,const uchar &response[],
                         const uchar &pending[])
   {
      bool required=true;
      if(!AckWitnessRequired(required)) return false;
      m_callback_active=true;
      bool valid=required ? m_validator.AckWithPending(response,pending,state,m_expected_identity) :
                            m_validator.Ack(response,state,m_expected_identity);
      m_callback_active=false;
      return valid;
   }

   bool TypedPayloadValid(const Tov2LocalRef &reference,const Tov2LocalState &state,
                          const uchar &payload[])
   {
      bool valid=false;
      if(m_callback_active || !DependenciesValid()) return false;
      if(reference.kind=="ACK")
      {
         bool required=true;uchar pending[];Tov2StorageLocator locator;
         if(!AckWitnessRequired(required)) return false;
         if(required && ReadAckWitness(state,locator,pending)!=TOV2_STATE_OK) return false;
         if(!DependenciesValid()) return false;
         // Capability is queried once for this dispatch: opt-in never falls back.
         m_callback_active=true;
         valid=required ? m_validator.AckWithPending(payload,pending,state,m_expected_identity) :
                          m_validator.Ack(payload,state,m_expected_identity);
         m_callback_active=false;
         return valid;
      }
      m_callback_active=true;
      if(reference.kind=="REGISTRATION")
         valid=m_validator.Registration(payload,m_expected_identity);
      else if(reference.kind=="CAPTURE")
         valid=m_validator.Capture(payload,state.capture_schema,m_expected_identity);
      else if(reference.kind=="EVENT")
         valid=m_validator.Event(payload,reference.event_id,reference.record_sha,
                                 reference.deal_id,reference.revision,m_expected_identity);
      else if(reference.kind=="PENDING")
         valid=m_validator.Pending(payload,state,m_expected_identity);
      m_callback_active=false;
      return valid;
   }

   bool ValidateRegistrationCapture(const uchar &registration[],const uchar &capture[],
                                     const string schema)
   {
      if(m_callback_active || !DependenciesValid()) return false;
      m_callback_active=true;
      bool valid=m_validator.Registration(registration,m_expected_identity);
      if(valid && DependenciesValid()) valid=m_validator.Capture(capture,schema,m_expected_identity);
      else valid=false;
      m_callback_active=false;
      return valid;
   }

   bool ValidateAppendEvent(const uchar &payload[],const string event_id,
                             const string record_sha,const string deal_id,const long revision)
   {
      if(m_callback_active || !DependenciesValid()) return false;
      m_callback_active=true;
      bool valid=m_validator.Event(payload,event_id,record_sha,deal_id,revision,m_expected_identity);
      m_callback_active=false;
      return valid;
   }

   bool ValidateCaptureAdvance(const uchar &previous[],const string previous_schema,
                               const uchar &candidate[],const string candidate_schema)
   {
      if(m_callback_active || !DependenciesValid()) return false;
      m_callback_active=true;
      bool valid=m_validator.CaptureAdvance(previous,previous_schema,candidate,candidate_schema,
                                            m_expected_identity);
      m_callback_active=false;
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

   int FreshOutboxRoot()
   {
      int guard=Guard();
      if(guard!=TOV2_STATE_OK) return guard;
      if(!m_loaded) return TOV2_STATE_RECOVERY_REQUIRED;
      int inventory=RefreshInventory();
      if(inventory!=TOV2_STATE_OK) return inventory;
      return VerifyCurrentRootFresh();
   }

   bool OutboxAdapterValid(ITov2TelemetryOutboxAdapter *adapter)
   {
      return CheckPointer(adapter)!=POINTER_INVALID;
   }

   bool OutboxCandidateMatches(const Tov2OutboxCandidate &candidate)
   {
      if(candidate.expected_generation!=m_state.generation ||
         candidate.expected_root_sha!=m_commit_sha ||
         candidate.registration_sha!=m_state.registration.sha ||
         m_state.accepted_request>=TOV2_LOCAL_MAX_COUNTER ||
         candidate.request_sequence!=m_state.accepted_request+1 ||
         !Tov2Digest(candidate.body_sha) || candidate.prefix_count<0 ||
         candidate.prefix_count>TOV2_LOCAL_BATCH ||
         candidate.prefix_count>m_state.event_count ||
         candidate.frozen_produced!=m_state.produced) return false;
      if(candidate.prefix_count==0 && m_state.event_count>0) return false;
      for(int i=0;i<candidate.prefix_count;i++)
      {
         if(m_state.events[i].sequence!=m_state.accepted_event+1+i) return false;
         for(int j=0;j<i;j++)
            if(m_state.events[i].deal_id!="-" &&
               m_state.events[i].deal_id==m_state.events[j].deal_id) return false;
      }
      return true;
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

   bool AddRootLocators(const Tov2LocalState &state,Tov2StorageLocator &set[],
                        const bool include_witness=true)
   {
      if(!AddLocator(set,Tov2StorageRegistrationLocator()) ||
         !AddLocator(set,Tov2StorageStateLocator(state.generation)) ||
         !AddLocator(set,Tov2StorageCommitLocator(state.generation)) ||
         !AddLocator(set,RefLocator(state.capture))) return false;
      for(int i=0;i<state.event_count;i++)
         if(!AddLocator(set,RefLocator(state.events[i]))) return false;
      if(state.pending.kind!="-" && !AddLocator(set,RefLocator(state.pending))) return false;
      if(state.ack.kind!="-" && !AddLocator(set,RefLocator(state.ack))) return false;
      if(include_witness && state.ack.kind=="ACK")
      {
         bool required=true;
         if(!AckWitnessRequired(required)) return false;
         if(required)
         {
            Tov2StorageLocator locator;uchar pending[];
            if(ReadAckWitness(state,locator,pending)!=TOV2_STATE_OK ||
               !AddLocator(set,locator)) return false;
         }
      }
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
      {
         bool required=true;
         if(!AckWitnessRequired(required)) return false;
         if(required) return reference.sequence<=current.accepted_request &&
            !PendingHasRetainedAck(reference,current,previous);
         return PendingHasRetainedAck(reference,current,previous);
      }
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
      result=MatchProtectedCandidate(reference,root.ack,retired,root,matched);
      if(result!=TOV2_STATE_OK || root.ack.kind!="ACK") return result;
      bool required=true;
      if(!AckWitnessRequired(required)) return TOV2_STATE_RECOVERY_REQUIRED;
      if(required)
      {
         Tov2StorageLocator locator;uchar pending[];
         result=ReadAckWitness(root,locator,pending);
         if(result!=TOV2_STATE_OK) return result;
         if(Tov2StorageSameLocator(RefLocator(reference),locator))
         {
            matched=true;
            if(reference.kind!="PENDING" || reference.sha!=root.ack_pending_sha ||
               reference.sequence!=root.ack_request || reference.sequence!=root.ack.sequence ||
               retired.identity!=root.identity || retired.registration.sha!=root.registration.sha)
               return TOV2_STATE_RECOVERY_REQUIRED;
         }
      }
      return TOV2_STATE_OK;
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

   int ClassifyRetiredAckWitness(const Tov2LocalState &retired,
                                 const Tov2LocalState &current,
                                 const Tov2LocalState &previous,
                                 Tov2StorageLocator &live_eligible[],bool &has_ineligible)
   {
      if(retired.ack.kind!="ACK") return TOV2_STATE_OK;
      bool required=true;
      if(!AckWitnessRequired(required)) return TOV2_STATE_RECOVERY_REQUIRED;
      if(!required) return TOV2_STATE_OK;
      // Authority is the verified ancestor ACK metadata, even after its PREPARE
      // metadata has retired. A witness is deleted after its ACK, before metadata.
      int matches=0;
      for(int i=0;i<ArraySize(m_inventory);i++)
         if(m_inventory[i].sha==retired.ack_pending_sha) matches++;
      if(matches==0 && InventoryIndex(RefLocator(retired.ack))<0)
         return TOV2_STATE_OK; // Resume after the exact witness delete took effect.
      Tov2StorageLocator locator;uchar pending[];
      int read=ReadAckWitness(retired,locator,pending);
      if(read!=TOV2_STATE_OK) return read;
      Tov2LocalRef reference;
      MakeRef(reference,"PENDING",locator.generation,locator.ordinal,
               retired.ack_pending_sha,retired.ack_request);
      bool matched=false;
      int result=RootProtectedAssociation(reference,retired,current,matched);
      if(result!=TOV2_STATE_OK) return result;
      result=RootProtectedAssociation(reference,retired,previous,matched);
      if(result!=TOV2_STATE_OK) return result;
      Tov2StorageLocator protected_set[];
      if(!AddRootLocators(current,protected_set) || !AddRootLocators(previous,protected_set))
         return TOV2_STATE_RECOVERY_REQUIRED;
      if(matched || LocatorIn(locator,protected_set)) return TOV2_STATE_OK;
      if(retired.identity!=current.identity ||
         retired.registration.sha!=current.registration.sha)
         return TOV2_STATE_RECOVERY_REQUIRED;
      if(!RetiredReferenceEligible(reference,current,previous))
      { has_ineligible=true;return TOV2_STATE_OK; }
      // Caller already verified a present retired ACK using this exact witness.
      // After an ACK delete interruption its committed frame hash remains authority.
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
      // Retired ACK witnesses are classified separately, including delete retries.
      if(!AddRootLocators(retired,retired_set,false)) return TOV2_STATE_IO_ERROR;
      for(int i=0;i<ArraySize(m_inventory);i++)
         if(m_inventory[i].locator.kind==TOV2_LOC_OBJECT &&
            m_inventory[i].locator.generation==generation &&
            !LocatorIn(m_inventory[i].locator,retired_set))
            has_ineligible=true;
      SortLocators(live_eligible);
      return ClassifyRetiredAckWitness(retired,current,previous,live_eligible,has_ineligible);
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
      m_callback_active=false;
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
      if(m_callback_active) return TOV2_STATE_BUSY;
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
      if(!ValidateRegistrationCapture(registration_payload,capture_payload,capture_schema))
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
         if(!ValidateAppendEvent(payload,candidates[i].event_id,candidates[i].record_sha,
                                  candidates[i].deal_id,candidates[i].revision))
            return TOV2_STATE_INVALID;
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
            if(!Tov2LocalEqual(committed_payload,payload) ||
               !ValidateAppendEvent(committed_payload,m_state.events[found].event_id,
                                     m_state.events[found].record_sha,
                                     m_state.events[found].deal_id,m_state.events[found].revision))
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
      if(!ValidateCaptureAdvance(previous_capture,m_state.capture_schema,
                                  capture_payload,capture_schema)) return TOV2_STATE_INVALID;
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

   int ReadCaptureContext(Tov2LocalState &state,string &root_sha,
                          uchar &registration[],uchar &capture[])
   {
      Tov2LocalClearState(state);root_sha="";
      ArrayResize(registration,0);ArrayResize(capture,0);
      int fresh=FreshOutboxRoot();
      if(fresh!=TOV2_STATE_OK) return fresh;
      uchar stored_registration[],stored_capture[];
      int read=ReadReferencePayload(m_state.registration,stored_registration);
      if(read!=TOV2_STATE_OK) return read;
      read=ReadReferencePayload(m_state.capture,stored_capture);
      if(read!=TOV2_STATE_OK) return read;
      if(!TypedPayloadValid(m_state.registration,m_state,stored_registration) ||
         !TypedPayloadValid(m_state.capture,m_state,stored_capture))
         return TOV2_STATE_RECOVERY_REQUIRED;
      if(!Tov2LocalCopy(stored_registration,registration) ||
         !Tov2LocalCopy(stored_capture,capture))
      {
         ArrayResize(registration,0);ArrayResize(capture,0);
         return TOV2_STATE_IO_ERROR;
      }
      state=m_state;root_sha=m_commit_sha;
      return TOV2_STATE_OK;
   }

   int ReadOutboxContext(Tov2OutboxContext &context,uchar &registration[],
                         uchar &event_arena[],int &event_ends[])
   {
      Tov2LocalClearState(context.state); context.root_sha="";
      ArrayResize(registration,0); ArrayResize(event_arena,0); ArrayResize(event_ends,0);
      int fresh=FreshOutboxRoot();
      if(fresh!=TOV2_STATE_OK) return fresh;
      uchar stored_registration[],arena[]; int ends[];
      int read=ReadReferencePayload(m_state.registration,stored_registration);
      if(read!=TOV2_STATE_OK) return read;
      for(int i=0;i<m_state.event_count && i<TOV2_LOCAL_BATCH;i++)
      {
         bool repeated=false;
         for(int j=0;j<i;j++)
            if(m_state.events[i].deal_id!="-" &&
               m_state.events[i].deal_id==m_state.events[j].deal_id) repeated=true;
         if(repeated) break;
         uchar payload[];
         read=ReadReferencePayload(m_state.events[i],payload);
         if(read!=TOV2_STATE_OK) return read;
         if(!AppendFlat(arena,ends,payload)) return TOV2_STATE_IO_ERROR;
      }
      int size=ArraySize(arena),count=ArraySize(ends);
      if(!Tov2LocalCopy(stored_registration,registration) ||
         ArrayResize(event_arena,size)!=size ||
         (size>0 && ArrayCopy(event_arena,arena,0,0,size)!=size) ||
         ArrayResize(event_ends,count)!=count ||
         (count>0 && ArrayCopy(event_ends,ends,0,0,count)!=count))
      {
         ArrayResize(registration,0); ArrayResize(event_arena,0); ArrayResize(event_ends,0);
         return TOV2_STATE_IO_ERROR;
      }
      context.state=m_state; context.root_sha=m_commit_sha;
      return TOV2_STATE_OK;
   }

   int ReadPending(uchar &request[])
   {
      ArrayResize(request,0);
      int fresh=FreshOutboxRoot();
      if(fresh!=TOV2_STATE_OK) return fresh;
      if(m_state.pending.kind=="-") return TOV2_STATE_NOT_STARTED;
      uchar stored[];
      int read=ReadReferencePayload(m_state.pending,stored);
      if(read!=TOV2_STATE_OK) return read;
      if(!TypedPayloadValid(m_state.pending,m_state,stored)) return TOV2_STATE_RECOVERY_REQUIRED;
      return Tov2LocalCopy(stored,request) ? TOV2_STATE_OK : TOV2_STATE_IO_ERROR;
   }

   int PreparePending(ITov2TelemetryOutboxAdapter *adapter,
                       const Tov2OutboxCandidate &candidate,const uchar &request[],
                       uchar &persisted[])
   {
      ArrayResize(persisted,0);
      int fresh=FreshOutboxRoot();
      if(fresh!=TOV2_STATE_OK) return fresh;
      // An already committed request wins even when the new candidate is invalid.
      if(m_state.pending.kind!="-") return ReadPending(persisted);
      if(m_highest_observed>=TOV2_LOCAL_MAX_COUNTER ||
         m_state.accepted_request>=TOV2_LOCAL_MAX_COUNTER) return TOV2_STATE_LIMIT;
      if(ArraySize(request)<1 || ArraySize(request)>TOV2_RECORD_PAYLOAD_MAX ||
         !OutboxAdapterValid(adapter) || !OutboxCandidateMatches(candidate))
         return TOV2_STATE_INVALID;
      Tov2OutboxContext context; uchar registration[],arena[]; int ends[];
      int read=ReadOutboxContext(context,registration,arena,ends);
      if(read!=TOV2_STATE_OK) return read;
      m_callback_active=true;
      bool valid_request=adapter.ValidateRequest(context,registration,arena,ends,candidate,request);
      m_callback_active=false;
      if(!valid_request)
         return TOV2_STATE_INVALID;
      fresh=FreshOutboxRoot();
      if(fresh!=TOV2_STATE_OK) return fresh;
      if(!OutboxCandidateMatches(candidate) || m_state.pending.kind!="-")
         return TOV2_STATE_CONFLICT;
      if(m_highest_observed>=TOV2_LOCAL_MAX_COUNTER) return TOV2_STATE_LIMIT;
      Tov2LocalState next=m_state;
      next.generation=m_highest_observed+1;
      next.parent_generation=m_state.generation; next.parent_commit=m_commit_sha;
      uchar frame[]; string sha="";
      if(!MakeFrame("PENDING",next.generation,request,frame,sha)) return TOV2_STATE_INVALID;
      MakeRef(next.pending,"PENDING",next.generation,1,sha,candidate.request_sequence);
      next.pending_request=candidate.request_sequence; next.pending_body=candidate.body_sha;
      next.pending_prior=m_state.accepted_event;
      next.pending_final=m_state.accepted_event+candidate.prefix_count;
      next.pending_count=candidate.prefix_count; next.pending_produced=m_state.produced;
      if(next.completeness=="UP_TO_DATE") next.completeness="CATCHING_UP";
      if(!TypedPayloadValid(next.pending,next,request)) return TOV2_STATE_INVALID;
      Tov2StorageLocator locators[1]; locators[0]=Tov2StorageObjectLocator(next.generation,1);
      int frame_ends[1]; frame_ends[0]=ArraySize(frame);
      int published=Publish("PREPARE",next,locators,frame,frame_ends);
      if(published!=TOV2_STATE_OK) return published;
      return ReadPending(persisted);
   }

   int AcceptResponse(ITov2TelemetryOutboxAdapter *adapter,const uchar &response[])
   {
      int fresh=FreshOutboxRoot();
      if(fresh!=TOV2_STATE_OK) return fresh;
      if(ArraySize(response)<1 || ArraySize(response)>TOV2_OUTBOX_RESPONSE_MAX)
         return TOV2_STATE_INVALID;
      // The retained exact witness is checked before association with a newer request.
      if(m_state.ack.kind!="-")
      {
         uchar witness[];
         int read=ReadReferencePayload(m_state.ack,witness);
         if(read!=TOV2_STATE_OK) return read;
         if(Tov2LocalEqual(witness,response)) return TOV2_STATE_OK;
      }
      if(m_state.pending.kind=="-" || !OutboxAdapterValid(adapter)) return TOV2_STATE_INVALID;
      uchar pending[];
      int read=ReadReferencePayload(m_state.pending,pending);
      if(read!=TOV2_STATE_OK) return read;
      Tov2OutboxAcceptance accepted; Tov2OutboxClearAcceptance(accepted);
      string expected_root_sha=m_commit_sha;
      m_callback_active=true;
      bool valid_response=adapter.ValidateResponse(m_state,pending,response,accepted);
      m_callback_active=false;
      if(!valid_response ||
         accepted.identity!=m_state.identity ||
         accepted.registration_sha!=m_state.registration.sha ||
         accepted.request_sequence!=m_state.pending_request ||
         accepted.body_sha!=m_state.pending_body ||
         accepted.pending_sha!=m_state.pending.sha ||
         accepted.final_event!=m_state.pending_final ||
         !Tov2Counter(accepted.accepted_at,1)) return TOV2_STATE_INVALID;
      fresh=FreshOutboxRoot();
      if(fresh!=TOV2_STATE_OK) return fresh;
      if(m_commit_sha!=expected_root_sha) return TOV2_STATE_CONFLICT;
      if(m_highest_observed>=TOV2_LOCAL_MAX_COUNTER) return TOV2_STATE_LIMIT;
      Tov2LocalState next=m_state;
      next.generation=m_highest_observed+1;
      next.parent_generation=m_state.generation; next.parent_commit=m_commit_sha;
      uchar frame[]; string sha="";
      if(!MakeFrame("ACK",next.generation,response,frame,sha)) return TOV2_STATE_INVALID;
      MakeRef(next.ack,"ACK",next.generation,2,sha,m_state.pending_request);
      next.accepted_request=m_state.pending_request; next.accepted_event=m_state.pending_final;
      next.ack_request=m_state.pending_request; next.ack_body=m_state.pending_body;
      next.ack_pending_sha=m_state.pending.sha; next.ack_event=m_state.pending_final;
      next.accepted_at=accepted.accepted_at;
      int remaining=m_state.event_count-m_state.pending_count;
      for(int i=0;i<remaining;i++) next.events[i]=m_state.events[m_state.pending_count+i];
      for(int i=remaining;i<m_state.event_count;i++) Tov2LocalClearRef(next.events[i]);
      next.event_count=remaining;
      Tov2LocalClearRef(next.pending);
      next.pending_request=0; next.pending_body="-"; next.pending_prior=0;
      next.pending_final=0; next.pending_count=0; next.pending_produced=0;
      // Bind the already-read bytes to the original reference, never next.pending
      // (which is cleared) or a recursively loaded State inside a callback.
      uchar pending_frame[],verified_pending[];
      if(m_state.pending.sha!=next.ack_pending_sha ||
         !Tov2RecordEncode("PENDING",m_state.pending.generation,pending,pending_frame) ||
         !Tov2LocalFrameMatches(m_state.pending,pending_frame,verified_pending) ||
         m_state.pending.generation>=next.ack.generation ||
         !AckPayloadValid(next,response,pending)) return TOV2_STATE_INVALID;
      Tov2StorageLocator locators[1]; locators[0]=Tov2StorageObjectLocator(next.generation,2);
      int frame_ends[1]; frame_ends[0]=ArraySize(frame);
      return Publish("ACK",next,locators,frame,frame_ends);
   }

   int ReplaceRejected(ITov2TelemetryOutboxAdapter *adapter,const uchar &rejection[],
                        const uchar &replacement[],const string body_sha,uchar &persisted[])
   {
      ArrayResize(persisted,0);
      int fresh=FreshOutboxRoot();
      if(fresh!=TOV2_STATE_OK) return fresh;
      if(m_state.pending.kind=="-" || !OutboxAdapterValid(adapter) ||
         ArraySize(rejection)<1 || ArraySize(rejection)>TOV2_OUTBOX_RESPONSE_MAX ||
         ArraySize(replacement)<1 || ArraySize(replacement)>TOV2_RECORD_PAYLOAD_MAX ||
         !Tov2Digest(body_sha)) return TOV2_STATE_INVALID;
      uchar pending[];
      int read=ReadReferencePayload(m_state.pending,pending);
      if(read!=TOV2_STATE_OK) return read;
      string expected_root_sha=m_commit_sha;
      m_callback_active=true;
      bool valid_replacement=adapter.ValidateReplacement(m_state,pending,rejection,replacement,body_sha);
      m_callback_active=false;
      if(!valid_replacement)
         return TOV2_STATE_INVALID;
      fresh=FreshOutboxRoot();
      if(fresh!=TOV2_STATE_OK) return fresh;
      if(m_commit_sha!=expected_root_sha) return TOV2_STATE_CONFLICT;
      if(m_highest_observed>=TOV2_LOCAL_MAX_COUNTER) return TOV2_STATE_LIMIT;
      Tov2LocalState next=m_state;
      next.generation=m_highest_observed+1;
      next.parent_generation=m_state.generation; next.parent_commit=m_commit_sha;
      uchar frame[]; string sha="";
      if(!MakeFrame("PENDING",next.generation,replacement,frame,sha)) return TOV2_STATE_INVALID;
      MakeRef(next.pending,"PENDING",next.generation,1,sha,m_state.pending_request);
      next.pending_body=body_sha;
      if(!TypedPayloadValid(next.pending,next,replacement)) return TOV2_STATE_INVALID;
      Tov2StorageLocator locators[1]; locators[0]=Tov2StorageObjectLocator(next.generation,1);
      int frame_ends[1]; frame_ends[0]=ArraySize(frame);
      int published=Publish("REPLACE",next,locators,frame,frame_ends);
      if(published!=TOV2_STATE_OK) return published;
      return ReadPending(persisted);
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
      if(m_callback_active) return;
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
