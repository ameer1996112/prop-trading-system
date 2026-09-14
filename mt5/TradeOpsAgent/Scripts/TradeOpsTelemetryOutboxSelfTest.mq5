#property strict
#property version "1.000"
#property script_show_inputs
#property description "Offline synthetic durable outbox and crash recovery checks"
#include "../Include/TradeOpsTelemetryOutbox.mqh"
#include "Support/TradeOpsTelemetryMemoryStore.mqh"
#include "Support/TradeOpsTelemetrySyntheticOutbox.mqh"

int tov2_outbox_checks=0;
int tov2_outbox_failures=0;
CTov2SyntheticOutboxPayloadValidator payload_validator;

void Check(const bool ok,const string label)
{
   tov2_outbox_checks++;
   if(!ok) { tov2_outbox_failures++; Print("TOV2_OUTBOX_FAILURE ",label); }
}

bool Initialize(CTov2TelemetryState &state)
{
   uchar registration[],capture[];
   return state.Open()==TOV2_STATE_OK && state.Recover()==TOV2_STATE_NOT_STARTED &&
      Tov2LocalBytes("REG2|"+Tov2SyntheticIdentity(),registration) &&
      Tov2LocalBytes("CAP2|"+Tov2SyntheticIdentity()+"|initial",capture) &&
      state.InitializeNew(registration,capture,"synthetic.capture.2")==TOV2_STATE_OK;
}

bool AppendEvents(CTov2TelemetryState &state,const int start,const int count,
                   const int data_size=1,const bool repeated_deal=false)
{
   Tov2AppendCandidate candidates[]; uchar arena[],capture[]; int ends[];
   if(ArrayResize(candidates,count)!=count || ArrayResize(ends,count)!=count) return false;
   string identity=Tov2SyntheticIdentity();
   int offset=0;
   for(int i=0;i<count;i++)
   {
      candidates[i].event_id="event."+IntegerToString(start+i);
      candidates[i].deal_id=repeated_deal ? "99" : IntegerToString(1000+start+i);
      candidates[i].revision=repeated_deal ? i+1 : 1;
      uchar payload[];
      string text="EV2|"+identity+"|"+candidates[i].event_id+"|"+candidates[i].deal_id+"|"+
         Tov2LocalNumber(candidates[i].revision)+"|"+Tov2SyntheticRepeat("x",data_size);
      if(!Tov2LocalBytes(text,payload) || !Tov2LocalHash(payload,candidates[i].record_sha)) return false;
      int size=ArraySize(payload);
      if(ArrayResize(arena,offset+size)!=offset+size ||
         ArrayCopy(arena,payload,offset,0,size)!=size) return false;
      offset+=size; ends[i]=offset;
   }
   long sequences[];
   return Tov2LocalBytes("CAP2|"+identity+"|"+IntegerToString(start+count),capture) &&
      state.Append(candidates,arena,ends,capture,"synthetic.capture.2",sequences)==TOV2_STATE_OK &&
      ArraySize(sequences)==count;
}

void MutationBoundaries()
{
   for(int action=0;action<3;action++)
   for(int mode=TOV2_MEMORY_FAULT_BEFORE;mode<=TOV2_MEMORY_FAULT_AFTER;mode++)
   for(int boundary=1;boundary<=3;boundary++)
   {
      CTov2TelemetryMemoryStore store;
      CTov2SyntheticOutboxAdapter adapter;
      CTov2TelemetryState state(GetPointer(store),GetPointer(payload_validator),Tov2SyntheticIdentity());
      CTov2TelemetryOutbox outbox(GetPointer(state),GetPointer(adapter));
      Check(Initialize(state) && AppendEvents(state,1,2),"crash.fixture");
      uchar original[],response[],rejection[],replacement[],persisted[];
      Tov2LocalState before;
      if(action>0)
      {
         Check(outbox.Request(original)==TOV2_STATE_OK && state.Snapshot(before),"crash.pending");
         Check(adapter.Response(before,original,response) && adapter.Rejection(before,rejection) &&
               adapter.Renew(original,2,replacement),"crash.proofs");
      }
      else
      {
         Tov2OutboxContext context; uchar registration[],events[]; int ends[];
         Tov2OutboxCandidate candidate;
         Check(state.ReadOutboxContext(context,registration,events,ends)==TOV2_STATE_OK &&
            adapter.Build(context,registration,events,ends,2,candidate,original)==TOV2_OUTBOX_BUILD_OK,
            "crash.expected_bytes");
      }
      store.ArmFault("CREATE",boundary,mode);
      if(action!=1) Tov2LocalBytes("stale.caller.bytes",persisted);
      int result=TOV2_STATE_INVALID;
      if(action==0) result=outbox.Request(persisted);
      if(action==1) result=outbox.Accept(response);
      if(action==2) result=outbox.Replace(rejection,replacement,before.pending_body,persisted);
      string label=(action==0 ? "prepare.crash." : action==1 ? "ack.crash." : "replace.crash.")+
         IntegerToString(mode)+"."+IntegerToString(boundary);
      Check(result!=TOV2_STATE_OK && state.ReloadRequired() && ArraySize(persisted)==0,label+"no_output");
      bool committed=mode==TOV2_MEMORY_FAULT_AFTER && boundary==3;
      store.Crash();
      CTov2TelemetryState recovered(GetPointer(store),GetPointer(payload_validator),Tov2SyntheticIdentity());
      CTov2TelemetryOutbox retry(GetPointer(recovered),GetPointer(adapter));
      Check(recovered.Open()==TOV2_STATE_OK && recovered.Recover()==TOV2_STATE_OK,label+"fresh");
      Tov2LocalState after;
      Check(recovered.Snapshot(after),label+"snapshot");
      if(action==0) Check((after.pending.kind=="PENDING")==committed,label+"commit_visibility");
      if(action==1)
      {
         Check(after.accepted_event==(committed ? 2 : 0) &&
               after.event_count==(committed ? 0 : 2),label+"atomic_counters");
         int files=store.PersistentCount();
         Check(retry.Accept(response)==TOV2_STATE_OK,label+"response_retry");
         Check(!committed || store.PersistentCount()==files,label+"lost_return_noop");
      }
      else
      {
         adapter.build_result=TOV2_OUTBOX_BUILD_INVALID;
         if(action==0 && !committed) adapter.build_result=TOV2_OUTBOX_BUILD_OK;
         Check(retry.Request(persisted)==TOV2_STATE_OK,label+"request_retry");
         if(action==2 && committed) Check(Tov2LocalEqual(persisted,replacement),label+"byte_stable");
         else Check(Tov2LocalEqual(persisted,original),label+"byte_stable");
         if(action==2 && !committed)
            Check(retry.Replace(rejection,replacement,before.pending_body,persisted)==TOV2_STATE_OK &&
                  Tov2LocalEqual(persisted,replacement),label+"replace_retry");
      }
      recovered.Close();
   }
}

void RetryAndAcknowledgment()
{
   CTov2TelemetryMemoryStore store;
   CTov2SyntheticOutboxAdapter adapter;
   CTov2TelemetryState state(GetPointer(store),GetPointer(payload_validator),Tov2SyntheticIdentity());
   CTov2TelemetryOutbox outbox(GetPointer(state),GetPointer(adapter));
   Check(Initialize(state) && AppendEvents(state,1,2),"retry.fixture");
   uchar original[],retry[],response[];
   Check(outbox.Request(original)==TOV2_STATE_OK,"retry.prepare");
   Tov2LocalState pending;
   Check(state.Snapshot(pending) && pending.pending_produced==2,"retry.frozen");
   Check(AppendEvents(state,3,1),"retry.append_tail");
   Check(state.PublishDiagnostic("DATA_MISSING","HISTORY_UNAVAILABLE")==TOV2_STATE_OK,"retry.diagnostic");
   int builds=adapter.build_calls;
   adapter.build_result=TOV2_OUTBOX_BUILD_INVALID;
   Check(outbox.Request(retry)==TOV2_STATE_OK && Tov2LocalEqual(original,retry) &&
         adapter.build_calls==builds,"retry.exact");
   Tov2LocalState with_tail;
   Check(state.Snapshot(with_tail) && with_tail.produced==3 && with_tail.pending_produced==2,
         "retry.producer_not_rewritten");
   Check(adapter.Response(with_tail,original,response) && outbox.Accept(response)==TOV2_STATE_OK,
         "ack.commit");
   Tov2LocalState accepted;
   Check(state.Snapshot(accepted) && accepted.accepted_event==2 && accepted.accepted_request==1 &&
      accepted.event_count==1 && accepted.events[0].event_id=="event.3" &&
      accepted.produced==3 && accepted.capture.sha==with_tail.capture.sha &&
      accepted.completeness=="DATA_MISSING" && accepted.pending.kind=="-" &&
      accepted.pending_request==0 && accepted.pending_body=="-" && accepted.pending_count==0 &&
      accepted.pending_prior==0 && accepted.pending_final==0 && accepted.pending_produced==0,
      "ack.tail_preserved");
   adapter.build_result=TOV2_OUTBOX_BUILD_OK;
   Check(outbox.Request(retry)==TOV2_STATE_OK,"ack.next_pending");
   int files=store.PersistentCount();
   Check(outbox.Accept(response)==TOV2_STATE_OK && store.PersistentCount()==files &&
         state.Snapshot(accepted) && accepted.pending_request==2,
         "ack.duplicate_newer_pending");
   uchar second_response[];
   Check(adapter.Response(accepted,retry,second_response) && outbox.Accept(second_response)==TOV2_STATE_OK,
         "ack.second");
   Check(state.PublishDiagnostic("UP_TO_DATE","NONE")==TOV2_STATE_OK,"heartbeat.up_to_date");
   Check(outbox.Request(retry)==TOV2_STATE_OK && state.Snapshot(accepted) &&
         accepted.pending_count==0 && accepted.pending_final==3 && accepted.pending_prior==3 &&
         accepted.completeness=="CATCHING_UP","heartbeat.nonzero_ack");
   Check(adapter.Response(accepted,retry,second_response) && outbox.Accept(second_response)==TOV2_STATE_OK,
         "heartbeat.exact_final_ack");
   state.Close();
}

bool ChangeResponse(const uchar &response[],const int field,const string value,uchar &changed[])
{
   string text="",fields[],sha="",prefix="";
   if(!Tov2LocalText(response,text) || StringSplit(text,10,fields)!=12 || field<0 || field>11)
      return false;
   fields[field]=value;
   for(int i=0;i<11;i++) prefix+=(i==0 ? "" : "\n")+fields[i];
   if(field==11) sha=value;
   else if(!Tov2SyntheticHashText(prefix,sha)) return false;
   return Tov2LocalBytes(prefix+"\n"+sha,changed);
}

void InvalidResponsesAndReplacement()
{
   CTov2TelemetryMemoryStore store;
   CTov2SyntheticOutboxAdapter adapter;
   CTov2TelemetryState state(GetPointer(store),GetPointer(payload_validator),Tov2SyntheticIdentity());
   CTov2TelemetryOutbox outbox(GetPointer(state),GetPointer(adapter));
   Check(Initialize(state) && AppendEvents(state,1,2),"response.fixture");
   uchar original[],response[],invalid[],rejection[],replacement[],persisted[];
   Tov2LocalState before,after;
   Check(outbox.Request(original)==TOV2_STATE_OK && state.Snapshot(before) &&
         adapter.Response(before,original,response),"response.original");
   string values[12];
   values[0]="BAD"; values[1]="other~install.demo~tracking.demo~1~"+
      Tov2SyntheticRepeat("d",64)+"~"+Tov2SyntheticRepeat("e",64)+"~"+Tov2SyntheticRepeat("f",64);
   values[2]=Tov2SyntheticRepeat("a",64); values[3]="2";
   values[4]=Tov2SyntheticRepeat("b",64); values[5]=Tov2SyntheticRepeat("c",64);
   values[6]="1"; values[7]="0"; values[8]="LIVE"; values[9]="trade";
   values[10]=Tov2SyntheticRepeat("0",64); values[11]=Tov2SyntheticRepeat("1",64);
   int files=store.PersistentCount();
   for(int field=0;field<12;field++)
   {
      Check(ChangeResponse(response,field,values[field],invalid),"response.mutation_fixture");
      Check(outbox.Accept(invalid)==TOV2_STATE_INVALID && store.PersistentCount()==files &&
         state.Snapshot(after) && after.generation==before.generation &&
         after.pending.sha==before.pending.sha,"response.invalid_no_write."+IntegerToString(field));
   }
   ArrayResize(invalid,TOV2_OUTBOX_RESPONSE_MAX+1); ArrayInitialize(invalid,65);
   Check(outbox.Accept(invalid)==TOV2_STATE_INVALID && store.PersistentCount()==files,
         "response.max16384");
   Check(adapter.Rejection(before,rejection) && adapter.Renew(original,2,replacement),
         "replacement.fixture");
   string reasons[4]={"timeout","HTTP500","malformed","{error:envelope_expired,mode:DRY_RUN,command:null}"};
   for(int i=0;i<4;i++)
   {
      Tov2LocalBytes(reasons[i],invalid);
      Tov2LocalCopy(original,persisted);
      Check(outbox.Replace(invalid,replacement,before.pending_body,persisted)==TOV2_STATE_INVALID &&
         ArraySize(persisted)==0 && store.PersistentCount()==files,
         "replacement.rejection_required."+IntegerToString(i));
   }
   Check(outbox.Replace(rejection,replacement,before.pending_body,persisted)==TOV2_STATE_OK &&
      Tov2LocalEqual(replacement,persisted) && state.Snapshot(after) &&
      after.pending_request==before.pending_request && after.pending_count==before.pending_count &&
      after.pending_produced==before.pending_produced && after.pending_prior==before.pending_prior &&
      after.pending_final==before.pending_final && after.pending.sha!=before.pending.sha &&
      store.Exists(Tov2StorageObjectLocator(before.pending.generation,1)),"replacement.only_envelope");
   files=store.PersistentCount();
   Check(outbox.Accept(response)==TOV2_STATE_INVALID && store.PersistentCount()==files,
         "replacement.old_response_refused");
   Check(state.Compact()==TOV2_STATE_OK &&
      store.Exists(Tov2StorageObjectLocator(before.pending.generation,1)),"replacement.old_evidence_retained");
   state.Close();
}

void Prefixes()
{
   for(int scenario=0;scenario<4;scenario++)
   {
      CTov2TelemetryMemoryStore store;
      CTov2SyntheticOutboxAdapter adapter;
      CTov2TelemetryState state(GetPointer(store),GetPointer(payload_validator),Tov2SyntheticIdentity());
      CTov2TelemetryOutbox outbox(GetPointer(state),GetPointer(adapter));
      Check(Initialize(state),"prefix.fixture");
      if(scenario==0) Check(AppendEvents(state,1,32) && AppendEvents(state,33,1),"prefix.append33");
      if(scenario==1) Check(AppendEvents(state,1,3,1,true),"prefix.repeat_fixture");
      if(scenario==2) Check(AppendEvents(state,1,2,90000),"prefix.size_fixture");
      if(scenario==3) Check(AppendEvents(state,1,1,140000),"prefix.head_fixture");
      int files=store.PersistentCount();
      uchar request[]; Tov2LocalState pending;
      int result=outbox.Request(request);
      if(scenario==0) Check(result==TOV2_STATE_OK && state.Snapshot(pending) &&
         pending.pending_count==32,"prefix.batch32");
      if(scenario==1) Check(result==TOV2_STATE_OK && state.Snapshot(pending) &&
         pending.pending_count==1 && adapter.build_calls==1,"prefix.repeated_deal");
      if(scenario==2) Check(result==TOV2_STATE_OK && state.Snapshot(pending) &&
         pending.pending_count==1 && adapter.build_calls==2 && ArraySize(request)<=262144,
         "prefix.size_limit");
      if(scenario==3) Check(result==TOV2_STATE_LIMIT && ArraySize(request)==0 &&
         store.PersistentCount()==files && adapter.build_calls==1,"prefix.oversized_head");
      state.Close();
   }
}

void ReadAndOwnershipFaults()
{
   // Each case constructs new state/outbox instances after Crash. READ occurrences
   // cover root validation, pending reload, and post-commit revalidation. Later
   // occurrences may be beyond an operation, in which case success must be durable.
   for(int action=0;action<3;action++)
   for(int operation=0;operation<2;operation++)
   for(int mode=TOV2_MEMORY_FAULT_BEFORE;mode<=TOV2_MEMORY_FAULT_AFTER;mode++)
   for(int boundary=1;boundary<=128;boundary++)
   {
      CTov2TelemetryMemoryStore store;
      CTov2SyntheticOutboxAdapter adapter;
      CTov2TelemetryState state(GetPointer(store),GetPointer(payload_validator),Tov2SyntheticIdentity());
      CTov2TelemetryOutbox outbox(GetPointer(state),GetPointer(adapter));
      if(!Initialize(state) || !AppendEvents(state,1,1)) { Check(false,"fault.fixture"); return; }
      uchar original[],response[],rejection[],replacement[],output[];
      Tov2LocalState before;
      if(action>0 && (outbox.Request(original)!=TOV2_STATE_OK || !state.Snapshot(before) ||
         !adapter.Response(before,original,response) || !adapter.Rejection(before,rejection) ||
         !adapter.Renew(original,2,replacement))) { Check(false,"fault.pending_fixture"); return; }
      store.ArmFault(operation==0 ? "READ" : "REVALIDATE",boundary,mode);
      if(action!=1) Tov2LocalBytes("stale.caller.bytes",output);
      int result=action==0 ? outbox.Request(output) : action==1 ? outbox.Accept(response) :
         outbox.Replace(rejection,replacement,before.pending_body,output);
      string label=(operation==0 ? "fault.read." : "fault.revalidate.")+
         IntegerToString(action)+"."+IntegerToString(mode)+"."+IntegerToString(boundary);
      Check(result==TOV2_STATE_OK || ArraySize(output)==0,label+"no_false_output");
      store.Crash();
      CTov2TelemetryState recovered(GetPointer(store),GetPointer(payload_validator),Tov2SyntheticIdentity());
      CTov2TelemetryOutbox retry(GetPointer(recovered),GetPointer(adapter));
      Check(recovered.Open()==TOV2_STATE_OK && recovered.Recover()==TOV2_STATE_OK,label+"fresh");
      Tov2LocalState after;
      Check(recovered.Snapshot(after),label+"snapshot");
      if(action==1)
      {
         if(result==TOV2_STATE_OK) Check(after.accepted_event==1 && after.pending.kind=="-",
                                        label+"ack_success_durable");
         Check(retry.Accept(response)==TOV2_STATE_OK,label+"ack_retry");
      }
      else
      {
         uchar persisted[];
         if(result==TOV2_STATE_OK) Check(after.pending.kind=="PENDING",label+"success_root");
         Check(retry.Request(persisted)==TOV2_STATE_OK,label+"retry");
         if(result==TOV2_STATE_OK) Check(Tov2LocalEqual(output,persisted),label+"success_durable");
         if(action==2)
         {
            if(after.pending.sha==before.pending.sha)
               Check(Tov2LocalEqual(persisted,original),label+"replacement_atomic");
            else Check(Tov2LocalEqual(persisted,replacement),label+"replacement_atomic");
         }
      }
      recovered.Close();
   }
}

void CandidateAndExactLimit()
{
   CTov2TelemetryMemoryStore store;
   CTov2SyntheticOutboxAdapter adapter;
   CTov2TelemetryState state(GetPointer(store),GetPointer(payload_validator),Tov2SyntheticIdentity());
   CTov2TelemetryOutbox outbox(GetPointer(state),GetPointer(adapter));
   Check(Initialize(state) && AppendEvents(state,1,1),"candidate.fixture");
   Tov2OutboxContext context; Tov2OutboxCandidate candidate;
   uchar registration[],events[],request[],persisted[]; int ends[];
   Check(state.ReadOutboxContext(context,registration,events,ends)==TOV2_STATE_OK &&
      adapter.Build(context,registration,events,ends,1,candidate,request)==TOV2_OUTBOX_BUILD_OK,
      "candidate.build");
   int files=store.PersistentCount();
   for(int field=0;field<7;field++)
   {
      Tov2OutboxCandidate invalid=candidate;
      if(field==0) invalid.expected_generation++;
      if(field==1) invalid.expected_root_sha=Tov2SyntheticRepeat("0",64);
      if(field==2) invalid.registration_sha=Tov2SyntheticRepeat("1",64);
      if(field==3) invalid.request_sequence++;
      if(field==4) invalid.body_sha=Tov2SyntheticRepeat("2",64);
      if(field==5) invalid.prefix_count=0;
      if(field==6) invalid.frozen_produced++;
      Tov2LocalCopy(request,persisted);
      Check(state.PreparePending(GetPointer(adapter),invalid,request,persisted)==TOV2_STATE_INVALID &&
         ArraySize(persisted)==0 && store.PersistentCount()==files,
         "candidate.invalid_no_write."+IntegerToString(field));
   }
   adapter.build_result=TOV2_OUTBOX_BUILD_INVALID;
   int calls=adapter.build_calls;
   Check(outbox.Request(persisted)==TOV2_STATE_INVALID && ArraySize(persisted)==0 &&
         adapter.build_calls==calls+1 && store.PersistentCount()==files,"builder.invalid_not_shrunk");
   adapter.build_result=TOV2_OUTBOX_BUILD_OK;
   Check(outbox.Request(persisted)==TOV2_STATE_OK,"candidate.prepare");
   CTov2TelemetryOutbox no_adapter(GetPointer(state),NULL);
   Check(no_adapter.Request(request)==TOV2_STATE_OK && Tov2LocalEqual(request,persisted),
         "retry.no_builder_dependency");
   state.Close();

   // Size is measured on the actual encoded request. Hex expansion changes by two
   // bytes per event-data byte; the envelope digit count supplies the parity bit.
   int baseline_size=ArraySize(request);
   long exact_envelope=((TOV2_RECORD_PAYLOAD_MAX-baseline_size)%2==0 ? 1 : 10);
   int envelope_delta=exact_envelope==1 ? 0 : 1;
   int exact_data_size=1+(TOV2_RECORD_PAYLOAD_MAX-baseline_size-envelope_delta)/2;
   for(int extra=0;extra<2;extra++)
   {
      CTov2TelemetryMemoryStore exact_store;
      CTov2TelemetryState exact_state(GetPointer(exact_store),GetPointer(payload_validator),Tov2SyntheticIdentity());
      CTov2TelemetryOutbox exact_outbox(GetPointer(exact_state),GetPointer(adapter));
      adapter.envelope=exact_envelope;
      Check(Initialize(exact_state) && AppendEvents(exact_state,1,1,exact_data_size+extra),
            "prefix.exact_fixture");
      int result=exact_outbox.Request(persisted);
      if(extra==0) Check(result==TOV2_STATE_OK && ArraySize(persisted)==262144,"prefix.exact262144");
      else Check(result==TOV2_STATE_LIMIT && ArraySize(persisted)==0,"prefix.over262144");
      exact_state.Close();
   }
}

void CorruptionAndPointers()
{
   CTov2TelemetryMemoryStore store;
   CTov2SyntheticOutboxAdapter adapter;
   CTov2TelemetryState state(GetPointer(store),GetPointer(payload_validator),Tov2SyntheticIdentity());
   CTov2TelemetryOutbox outbox(GetPointer(state),GetPointer(adapter));
   Check(Initialize(state) && AppendEvents(state,1,1),"corrupt.fixture");
   uchar request[]; Tov2LocalState pending;
   Check(outbox.Request(request)==TOV2_STATE_OK && state.Snapshot(pending),"corrupt.pending");
   Check(store.Corrupt(Tov2StorageObjectLocator(pending.pending.generation,1),0),"corrupt.object");
   Check(outbox.Request(request)==TOV2_STATE_RECOVERY_REQUIRED && ArraySize(request)==0,
         "pending.fresh_corrupt");
   Check(store.Corrupt(Tov2StorageObjectLocator(pending.pending.generation,1),0),"corrupt.restore");
   Check(store.Corrupt(Tov2StorageCommitLocator(pending.generation),0),"corrupt.highest");
   store.Crash();
   CTov2TelemetryState recovered(GetPointer(store),GetPointer(payload_validator),Tov2SyntheticIdentity());
   Check(recovered.Open()==TOV2_STATE_OK && recovered.Recover()==TOV2_STATE_RECOVERY_REQUIRED,
         "pending.highest_commit_no_fallback");
   recovered.Close();
   Check(store.Corrupt(Tov2StorageCommitLocator(pending.generation),0),"corrupt.restore_commit");
   CTov2TelemetryState wrong(GetPointer(store),GetPointer(payload_validator),
      "other~install.demo~tracking.demo~1~"+Tov2SyntheticRepeat("d",64)+"~"+
      Tov2SyntheticRepeat("e",64)+"~"+Tov2SyntheticRepeat("f",64));
   Check(wrong.Open()==TOV2_STATE_OK && wrong.Recover()==TOV2_STATE_IDENTITY_MISMATCH,
         "identity.mismatch");
   wrong.Close();
   Check(outbox.Request(request)==TOV2_STATE_OWNERSHIP_LOST && ArraySize(request)==0,"ownership.lost");
   CTov2TelemetryOutbox invalid(NULL,NULL);
   Check(invalid.Request(request)==TOV2_STATE_INVALID && ArraySize(request)==0,"pointer.invalid");
}

bool FillFiles(CTov2TelemetryMemoryStore &store,const int target)
{
   uchar bytes[];
   if(!Tov2LocalBytes("abandoned.fixture",bytes)) return false;
   int start=store.PersistentCount();
   for(int i=start;i<target;i++)
      if(!store.Inject(Tov2StorageObjectLocator(10000+i,1),bytes)) return false;
   return true;
}

void BudgetAndCompaction()
{
   for(int scenario=0;scenario<4;scenario++)
   {
      CTov2TelemetryMemoryStore store;
      CTov2SyntheticOutboxAdapter adapter;
      CTov2TelemetryState state(GetPointer(store),GetPointer(payload_validator),Tov2SyntheticIdentity());
      CTov2TelemetryOutbox outbox(GetPointer(state),GetPointer(adapter));
      Check(Initialize(state) && AppendEvents(state,1,1),"budget.fixture");
      uchar request[],response[]; Tov2LocalState pending;
      if(scenario>0) Check(outbox.Request(request)==TOV2_STATE_OK && state.Snapshot(pending) &&
         adapter.Response(pending,request,response),"budget.pending");
      Check(FillFiles(store,scenario==2 ? TOV2_STORAGE_NORMAL_FILES+TOV2_STORAGE_RESERVE_FILES :
                                          TOV2_STORAGE_NORMAL_FILES),"budget.fill");
      int files=store.PersistentCount();
      if(scenario==0) Check(outbox.Request(request)==TOV2_STATE_LIMIT && ArraySize(request)==0 &&
         store.PersistentCount()==files,"budget.prepare_limit");
      if(scenario==1) Check(outbox.Accept(response)==TOV2_STATE_OK,"budget.ack_reserve");
      if(scenario==2) Check(outbox.Accept(response)==TOV2_STATE_LIMIT &&
         store.PersistentCount()==files,"budget.reserve_exhausted");
      if(scenario==3)
      {
         uchar rejection[],replacement[],persisted[];
         Check(adapter.Rejection(pending,rejection) && adapter.Renew(request,2,replacement),
               "budget.replace_fixture");
         Check(outbox.Replace(rejection,replacement,pending.pending_body,persisted)==TOV2_STATE_LIMIT &&
            ArraySize(persisted)==0 && store.PersistentCount()==files,"budget.replace_limit");
      }
      state.Close();
   }
   CTov2TelemetryMemoryStore store;
   CTov2SyntheticOutboxAdapter adapter;
   CTov2TelemetryState state(GetPointer(store),GetPointer(payload_validator),Tov2SyntheticIdentity());
   CTov2TelemetryOutbox outbox(GetPointer(state),GetPointer(adapter));
   Check(Initialize(state) && AppendEvents(state,1,1),"compact.fixture");
   uchar request[],response[]; Tov2LocalState pending,accepted;
   Check(outbox.Request(request)==TOV2_STATE_OK && state.Snapshot(pending) &&
      adapter.Response(pending,request,response) && outbox.Accept(response)==TOV2_STATE_OK &&
      state.Snapshot(accepted) && AppendEvents(state,2,1) && outbox.Request(request)==TOV2_STATE_OK &&
      state.Snapshot(pending),"compact.ack_then_pending");
   Check(state.Compact()==TOV2_STATE_OK &&
      store.Exists(Tov2StorageObjectLocator(pending.pending.generation,1)) &&
      store.Exists(Tov2StorageObjectLocator(accepted.ack.generation,2)) &&
      store.Exists(Tov2StorageObjectLocator(pending.events[0].generation,pending.events[0].ordinal)),
      "compact.pending_retained");
   uchar retry[];
   Check(outbox.Request(retry)==TOV2_STATE_OK && Tov2LocalEqual(request,retry),"compact.retry_exact");
   Check(outbox.Accept(response)==TOV2_STATE_OK,"compact.retained_duplicate");
   state.Close();

   CTov2TelemetryMemoryStore max_store;
   CTov2TelemetryState max_state(GetPointer(max_store),GetPointer(payload_validator),Tov2SyntheticIdentity());
   CTov2TelemetryOutbox max_outbox(GetPointer(max_state),GetPointer(adapter));
   Check(Initialize(max_state),"counter.fixture");
   uchar abandoned[]; Tov2LocalBytes("abandoned",abandoned);
   Check(max_store.Inject(Tov2StorageObjectLocator(TOV2_LOCAL_MAX_COUNTER,1),abandoned),"counter.max_observed");
   Check(max_outbox.Request(retry)==TOV2_STATE_LIMIT && ArraySize(retry)==0,"counter.overflow");
   max_state.Close();
}

class CTov2ReentryProbe
{
public:
   CTov2TelemetryState *target;
   int blocked;
   int failures;
   CTov2ReentryProbe() { target=NULL; blocked=0; failures=0; }
   void Probe()
   {
      if(CheckPointer(target)==POINTER_INVALID) return;
      int diagnostic=target.PublishDiagnostic("CATCHING_UP","NONE");
      int recovery=target.Recover();
      int compact=target.Compact();
      target.Close();
      if(diagnostic==TOV2_STATE_BUSY && recovery==TOV2_STATE_BUSY && compact==TOV2_STATE_BUSY)
         blocked++;
      else failures++;
   }
};

class CTov2ReentrantPayloadValidator : public CTov2SyntheticOutboxPayloadValidator
{
public:
   CTov2ReentryProbe *probe;
   CTov2ReentrantPayloadValidator() { probe=NULL; }
   bool Pending(const uchar &payload[],const Tov2LocalState &state,const string identity)
   {
      if(CheckPointer(probe)!=POINTER_INVALID) probe.Probe();
      return CTov2SyntheticOutboxPayloadValidator::Pending(payload,state,identity);
   }
   bool Ack(const uchar &payload[],const Tov2LocalState &state,const string identity)
   {
      if(CheckPointer(probe)!=POINTER_INVALID) probe.Probe();
      return CTov2SyntheticOutboxPayloadValidator::Ack(payload,state,identity);
   }
};

class CTov2ReentrantAdapter : public CTov2SyntheticOutboxAdapter
{
public:
   CTov2ReentryProbe *probe;
   CTov2ReentrantAdapter() { probe=NULL; }
   bool ValidateRequest(const Tov2OutboxContext &context,const uchar &registration[],
                        const uchar &arena[],const int &ends[],
                        const Tov2OutboxCandidate &candidate,const uchar &request[])
   {
      if(CheckPointer(probe)!=POINTER_INVALID) probe.Probe();
      return CTov2SyntheticOutboxAdapter::ValidateRequest(context,registration,arena,ends,candidate,request);
   }
   bool ValidateResponse(const Tov2LocalState &state,const uchar &pending[],
                         const uchar &response[],Tov2OutboxAcceptance &accepted)
   {
      if(CheckPointer(probe)!=POINTER_INVALID) probe.Probe();
      return CTov2SyntheticOutboxAdapter::ValidateResponse(state,pending,response,accepted);
   }
   bool ValidateReplacement(const Tov2LocalState &state,const uchar &pending[],
                     const uchar &rejection[],const uchar &replacement[],const string body_sha)
   {
      if(CheckPointer(probe)!=POINTER_INVALID) probe.Probe();
      return CTov2SyntheticOutboxAdapter::ValidateReplacement(state,pending,rejection,replacement,body_sha);
   }
};

void ReentrantCallbacks()
{
   CTov2TelemetryMemoryStore store;
   CTov2ReentrantPayloadValidator validator;
   CTov2ReentrantAdapter adapter;
   CTov2ReentryProbe probe;
   CTov2TelemetryState state(GetPointer(store),GetPointer(validator),Tov2SyntheticIdentity());
   CTov2TelemetryOutbox outbox(GetPointer(state),GetPointer(adapter));
   probe.target=GetPointer(state); validator.probe=GetPointer(probe); adapter.probe=GetPointer(probe);
   Check(Initialize(state) && AppendEvents(state,1,1),"callback.fixture");
   uchar pending[],response[],rejection[],replacement[],persisted[]; Tov2LocalState snapshot;
   Check(outbox.Request(pending)==TOV2_STATE_OK && state.Snapshot(snapshot),"callback.prepare");
   Check(adapter.Rejection(snapshot,rejection) && adapter.Renew(pending,2,replacement) &&
      outbox.Replace(rejection,replacement,snapshot.pending_body,persisted)==TOV2_STATE_OK &&
      state.Snapshot(snapshot),"callback.replace");
   Check(adapter.Response(snapshot,persisted,response) && outbox.Accept(response)==TOV2_STATE_OK,
         "callback.ack");
   Check(probe.blocked>0 && probe.failures==0 && state.Snapshot(snapshot) &&
      snapshot.accepted_event==1 && snapshot.pending.kind=="-","callback.reentry_blocked");
   state.Close();
}

void CompactionDeleteFaults()
{
   for(int newer_pending=0;newer_pending<2;newer_pending++)
   for(int mode=TOV2_MEMORY_FAULT_BEFORE;mode<=TOV2_MEMORY_FAULT_AFTER;mode++)
   for(int boundary=1;boundary<=(newer_pending==1 ? 2 : 4);boundary++)
   {
      CTov2TelemetryMemoryStore store;
      CTov2SyntheticOutboxAdapter adapter;
      CTov2TelemetryState state(GetPointer(store),GetPointer(payload_validator),Tov2SyntheticIdentity());
      CTov2TelemetryOutbox outbox(GetPointer(state),GetPointer(adapter));
      Check(Initialize(state) && AppendEvents(state,1,1),"compact_fault.fixture");
      uchar first[],response[],pending[]; Tov2LocalState snapshot;
      Check(outbox.Request(first)==TOV2_STATE_OK && state.Snapshot(snapshot) &&
         adapter.Response(snapshot,first,response) && outbox.Accept(response)==TOV2_STATE_OK,
         "compact_fault.accept");
      // ACK4 -> CHECKPOINT5 retires PREPARE3: event, pending, state, commit. Adding a
      // heartbeat PREPARE5 -> CHECKPOINT6 instead retires ACK4 metadata only.
      if(newer_pending==1)
         Check(outbox.Request(pending)==TOV2_STATE_OK,"compact_fault.next");
      Check(state.Snapshot(snapshot),"compact_fault.current");
      Tov2StorageLocator current=Tov2StorageObjectLocator(snapshot.capture.generation,snapshot.capture.ordinal);
      if(newer_pending==1) current=Tov2StorageObjectLocator(snapshot.pending.generation,1);
      store.ArmFault("DELETE",boundary,mode);
      int result=state.Compact();
      string label="compact.delete_crash."+IntegerToString(newer_pending)+"."+
         IntegerToString(mode)+"."+IntegerToString(boundary);
      Check(result==TOV2_STATE_IO_ERROR && state.ReloadRequired(),label+"interrupted");
      store.Crash();
      CTov2TelemetryState recovered(GetPointer(store),GetPointer(payload_validator),Tov2SyntheticIdentity());
      CTov2TelemetryOutbox retry(GetPointer(recovered),GetPointer(adapter));
      Check(recovered.Open()==TOV2_STATE_OK && recovered.Recover()==TOV2_STATE_OK,label+"fresh");
      uchar actual[];
      if(newer_pending==1) Check(retry.Request(actual)==TOV2_STATE_OK &&
         Tov2LocalEqual(actual,pending),label+"exact_pending");
      else Check(recovered.ReadPending(actual)==TOV2_STATE_NOT_STARTED,label+"retired_pending");
      Check(retry.Accept(response)==TOV2_STATE_OK && store.Exists(current),label+"protected");
      Check(recovered.Compact()==TOV2_STATE_OK && store.Exists(current),label+"resume");
      recovered.Close();
   }
}

void RequestSequenceExhaustion()
{
   CTov2TelemetryMemoryStore store;
   CTov2SyntheticOutboxAdapter adapter;
   CTov2TelemetryState state(GetPointer(store),GetPointer(payload_validator),Tov2SyntheticIdentity());
   Check(Initialize(state),"request_counter.fixture");
   Tov2OutboxContext context; uchar registration[],events[],request[]; int ends[];
   Check(state.ReadOutboxContext(context,registration,events,ends)==TOV2_STATE_OK,"request_counter.context");
   Tov2LocalState exhausted=context.state;
   exhausted.generation=2; exhausted.parent_generation=1; exhausted.parent_commit=context.root_sha;
   exhausted.accepted_request=TOV2_LOCAL_MAX_COUNTER;
   exhausted.ack_request=TOV2_LOCAL_MAX_COUNTER;
   exhausted.ack_body=Tov2SyntheticRepeat("a",64);
   exhausted.ack_pending_sha=Tov2SyntheticRepeat("b",64); exhausted.accepted_at=123456;
   string coverage="",digest="";
   Check(Tov2SyntheticHashText("COVERAGE2|0|0|0",coverage),"request_counter.coverage");
   string prefix="ACK2\n"+exhausted.identity+"\n"+exhausted.registration.sha+"\n"+
      Tov2LocalNumber(TOV2_LOCAL_MAX_COUNTER)+"\n"+exhausted.ack_body+"\n"+
      exhausted.ack_pending_sha+"\n0\n123456\nDRY_RUN\nnull\n"+coverage;
   uchar response[],ack_frame[],state_payload[],state_frame[],commit_payload[],commit_frame[];
   Check(Tov2SyntheticHashText(prefix,digest) && Tov2LocalBytes(prefix+"\n"+digest,response) &&
      Tov2RecordEncode("ACK",2,response,ack_frame) && Tov2LocalHash(ack_frame,digest),"request_counter.ack");
   exhausted.ack.kind="ACK"; exhausted.ack.generation=2; exhausted.ack.ordinal=2;
   exhausted.ack.sequence=TOV2_LOCAL_MAX_COUNTER; exhausted.ack.sha=digest;
   Tov2LocalCommit commit; Tov2LocalClearCommit(commit);
   commit.generation=2; commit.parent_generation=1; commit.parent_sha=context.root_sha;
   commit.registration_sha=exhausted.registration.sha; commit.transition="ACK";
   Check(Tov2LocalStateEncode(exhausted,state_payload) &&
      Tov2RecordEncode("CHECKPOINT",2,state_payload,state_frame) &&
      Tov2LocalHash(state_frame,commit.state_sha) && Tov2LocalCommitEncode(commit,commit_payload) &&
      Tov2RecordEncode("CHECKPOINT",2,commit_payload,commit_frame),"request_counter.frames");
   state.Close();
   Check(store.Inject(Tov2StorageObjectLocator(2,2),ack_frame) &&
      store.Inject(Tov2StorageStateLocator(2),state_frame) &&
      store.Inject(Tov2StorageCommitLocator(2),commit_frame),"request_counter.inject_fixture");
   CTov2TelemetryState recovered(GetPointer(store),GetPointer(payload_validator),Tov2SyntheticIdentity());
   CTov2TelemetryOutbox outbox(GetPointer(recovered),GetPointer(adapter));
   Check(recovered.Open()==TOV2_STATE_OK && recovered.Recover()==TOV2_STATE_OK,"request_counter.recover");
   int files=store.PersistentCount();
   Tov2LocalBytes("stale.caller.bytes",request);
   Check(outbox.Request(request)==TOV2_STATE_LIMIT && ArraySize(request)==0 &&
      store.PersistentCount()==files && adapter.build_calls==0,"counter.request_exhaustion");
   recovered.Close();
}

void OnStart()
{
   MutationBoundaries();
   RetryAndAcknowledgment();
   InvalidResponsesAndReplacement();
   Prefixes();
   CandidateAndExactLimit();
   ReadAndOwnershipFaults();
   CorruptionAndPointers();
   BudgetAndCompaction();
   CompactionDeleteFaults();
   RequestSequenceExhaustion();
   ReentrantCallbacks();
   if(tov2_outbox_failures==0) Print("TOV2_OUTBOX_PASS checks=",tov2_outbox_checks," failures=0");
   else Print("TOV2_OUTBOX_FAIL checks=",tov2_outbox_checks," failures=",tov2_outbox_failures);
}
