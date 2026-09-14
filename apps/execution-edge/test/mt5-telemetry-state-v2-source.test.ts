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
  it('requires State-owned paired ACK recovery and both retention paths', () => {
    const state = source('Include/TradeOpsTelemetryState.mqh');
    const capture = source('Include/TradeOpsCaptureStateCodec.mqh');
    for (const text of [state, capture]) {
      expect(text).toContain('virtual bool RequiresAckWitness()');
      expect(text).toContain('virtual bool AckWithPending(');
    }
    expect(capture).toContain('m_wire.RequiresAckWitness()');
    expect(capture).toContain('m_wire.AckWithPending(response,pending,state,identity)');
    const lookup = body(state, 'int ReadAckWitness(', 'bool AckPayloadValid(');
    for (const check of ['TOV2_STORAGE_INVENTORY_MAX', 'ack_pending_sha',
      'TOV2_LOC_OBJECT', 'matches!=1', 'ReadExact(locator,frame)',
      'actual!=state.ack_pending_sha', 'kind!="PENDING"',
      'generation!=locator.generation', 'generation>=state.ack.generation'])
      expect(lookup).toContain(check);
    const roots = body(state, 'bool AddRootLocators(', 'int InventoryIndex(');
    expect(roots).toContain('ReadAckWitness(state,locator,pending)');
    const protection = body(state, 'int RootProtectedAssociation(', 'int ProtectedAssociation(');
    expect(protection).toContain('ReadAckWitness(root,locator,pending)');
    expect(protection).toContain('reference.sha!=root.ack_pending_sha');
    const acceptance = body(state, 'int AcceptResponse(', 'int ReplaceRejected(');
    expect(acceptance).toContain('AckPayloadValid(next,response,pending)');
    expect(acceptance).toContain('Tov2LocalFrameMatches(m_state.pending,pending_frame,verified_pending)');
    expect(acceptance).toContain('m_state.pending.sha!=next.ack_pending_sha');
    const capability = body(state, 'bool AckWitnessRequired(', 'int ReadAckWitness(');
    expect(capability.indexOf('m_callback_active=true')).toBeLessThan(capability.indexOf('m_validator.RequiresAckWitness()'));
    expect(state).toContain('int ClassifyRetiredAckWitness(');
    expect(state).toContain('reference.sequence<=current.accepted_request');
    const cleanup = body(state, 'int LoadRetiredMetadata(', '\npublic:');
    expect(cleanup.indexOf('ClassifyRetiredReference(retired.ack')).toBeLessThan(cleanup.indexOf('ClassifyRetiredAckWitness('));
    expect(cleanup.indexOf('SortLocators(live_eligible)')).toBeLessThan(cleanup.indexOf('ClassifyRetiredAckWitness('));
    const native = source('Scripts/TradeOpsTelemetryStateSelfTest.mq5');
    for (const label of [
      'ack_witness.accept', 'ack_witness.recovery.', 'ack_witness.remove',
      'ack_witness.corrupt', 'ack_witness.duplicate', 'ack_witness.substitute_metadata',
      'ack_witness.reject_no_publication', 'ack_witness.reject_no_advancement',
      'ack_witness.callback_reentry_refused', 'ack_witness.recovered_prefix',
      'ack_witness.repeated_compact', 'ack_witness.retired_reclaimed',
      'ack_witness.previous_only_retained', 'ack_witness.previous_survives_fault',
      'ack_witness.previous_eventual_reclaim', 'ack_witness.publication_atomic_prefix',
      'ack_witness.publication_retry_once', 'ack_witness.checkpoint_publication_fault',
      'ack_witness.delete_after_ack_resume_authority', 'ack_witness.delete_retry_reclaims',
      'ack_witness.delete_order_ack_first', 'ack_witness.delete_no_advancement',
    ]) expect(native).toContain('"' + label);
  });

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
    expect(codec).toContain('#define TOV2_LOCAL_EVENTS 512');
    expect(codec).toContain('#define TOV2_LOCAL_BATCH 32');
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
      .toBe('15e0462aeec4b298ad2d0bbf5cbe59c0e24ebf0d1e7e4063c77075463e30f499');
    expect(sha256(source('Scripts/TradeOpsTelemetryStorageCodecSelfTest.mq5')))
      .toBe('d8a206fc8dd9bd1183ee7f187225eb5984ac997a328785c55d03b2445f5ee7ff');
    expect(sha256(readFileSync(join(import.meta.dirname, 'mt5-telemetry-storage-codec-v2-source.test.ts'), 'utf8')))
      .toBe('1d31d8da97af47bc498ab47062813e7d76fba37fba22f6c7109fc2c6cbe5d761');
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
