import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '../../../mt5/TradeOpsAgent');
const source = (path: string) => readFileSync(join(root, path), 'utf8');
const slice = (text: string, start: string, end: string) => {
  const from = text.indexOf(start);
  const to = text.indexOf(end, from + start.length);
  expect(from).toBeGreaterThanOrEqual(0);
  expect(to).toBeGreaterThan(from);
  return text.slice(from, to);
};

describe('isolated native telemetry outbox source contract (not MQL execution)', () => {
  it('keeps a closed State writer and invokes adapters on persisted bytes', () => {
    const state = source('Include/TradeOpsTelemetryState.mqh');
    const pub = state.slice(state.indexOf('\npublic:', state.indexOf('class CTov2TelemetryState')));
    expect(state.match(/int Publish\(const string transition/gu)).toHaveLength(1);
    expect(pub).not.toMatch(/int Publish\(const string transition|int Ack\(const (?:long|int)/u);
    for (const method of ['ReadOutboxContext', 'ReadPending', 'PreparePending', 'AcceptResponse', 'ReplaceRejected']) {
      expect(state).toContain(`int ${method}(`);
    }
    const read = slice(state, 'int ReadPending(', 'int PreparePending(');
    expect(read).toContain('FreshOutboxRoot()');
    expect(read).toContain('ReadReferencePayload(m_state.pending,stored)');
    expect(read).toContain('Tov2LocalCopy(stored,request)');
    const ack = slice(state, 'int AcceptResponse(', 'int ReplaceRejected(');
    expect(ack.indexOf('Tov2LocalEqual(witness,response)')).toBeLessThan(ack.indexOf('m_state.pending.kind'));
    expect(ack).toContain('adapter.ValidateResponse(m_state,pending,response,accepted)');
    expect(ack).toContain('accepted.pending_sha!=m_state.pending.sha');
    expect(ack).toContain('accepted.final_event!=m_state.pending_final');
    expect(ack).toContain('Publish("ACK"');
    expect(state).toContain('adapter.ValidateReplacement(m_state,pending,rejection,replacement,body_sha)');
    expect(state).toContain('return TOV2_STATE_UNSUPPORTED;');
    expect(state).toContain('if(m_callback_active) return TOV2_STATE_BUSY;');
    expect(slice(state, 'int Recover()', 'int InitializeNew('))
      .toMatch(/if\(m_callback_active\) return TOV2_STATE_BUSY;[\s\S]*m_loaded=false/u);
    expect(slice(state, 'void Close()', 'bool ReloadRequired()'))
      .toContain('if(m_callback_active) return;');
  });

  it('selects bounded contiguous prefixes and retries only explicit size limits', () => {
    const outbox = source('Include/TradeOpsTelemetryOutbox.mqh');
    expect(outbox.indexOf('m_state.ReadPending(persisted)')).toBeLessThan(outbox.indexOf('m_adapter.Build('));
    expect(outbox).toContain('TOV2_LOCAL_BATCH');
    expect(outbox).toContain('context.state.events[j].deal_id==context.state.events[i].deal_id');
    expect(outbox).toContain('built!=TOV2_OUTBOX_BUILD_SIZE_LIMIT');
    expect(outbox).toContain('if(count<=1) return TOV2_STATE_LIMIT;');
    expect(outbox).toContain('CheckPointer(m_adapter)!=POINTER_INVALID');
    expect(outbox).toContain('if(!StateValid() || !AdapterValid()) return TOV2_STATE_INVALID;');
    const contract = source('Include/TradeOpsTelemetryOutboxContract.mqh');
    expect(contract).toContain('const int TOV2_OUTBOX_RESPONSE_MAX=16384;');
    expect(contract).not.toMatch(/bool validated|Publish\(|Ack\(const long/u);
  });

  it('has actual native state/store fault tests and a strict test-only adapter', () => {
    const native = source('Scripts/TradeOpsTelemetryOutboxSelfTest.mq5');
    expect(native).toContain('#property script_show_inputs');
    expect(native).toContain('store.Crash();');
    expect(native).toContain('CTov2TelemetryOutbox');
    expect(native).toContain('CTov2TelemetryState recovered(');
    for (const label of ['prepare.crash.', 'ack.crash.', 'replace.crash.', 'retry.exact',
      'ack.tail_preserved', 'ack.duplicate_newer_pending', 'response.invalid_no_write',
      'prefix.batch32', 'prefix.repeated_deal', 'prefix.oversized_head', 'prefix.size_limit',
      'heartbeat.nonzero_ack', 'pending.fresh_corrupt', 'fault.read.', 'fault.revalidate.',
      'replacement.rejection_required', 'compact.pending_retained', 'budget.prepare_limit',
      'budget.ack_reserve', 'ownership.lost', 'identity.mismatch', 'counter.overflow']) {
      expect(native).toContain(`"${label}`);
    }
    for (const label of ['budget.replace_limit', 'compact.delete_crash.',
      'counter.request_exhaustion', 'callback.reentry_blocked', 'prefix.exact262144']) {
      expect(native).toContain(`"${label}`);
    }
    expect(native).toContain('Tov2LocalBytes("stale.caller.bytes",persisted)');
    const adapter = source('Scripts/Support/TradeOpsTelemetrySyntheticOutbox.mqh');
    for (const field of ['DRY_RUN', 'null', 'coverage', 'pending.sha', 'registration.sha', 'pending_body']) {
      expect(adapter).toContain(field);
    }
    expect(adapter).toContain('ENVELOPE_EXPIRED');
    expect(native).toContain('TOV2_OUTBOX_PASS');
  });

  it('keeps all outbox dependencies offline and outside the active EA', () => {
    const paths = ['Include/TradeOpsTelemetryOutboxContract.mqh', 'Include/TradeOpsTelemetryOutbox.mqh',
      'Scripts/Support/TradeOpsTelemetrySyntheticOutbox.mqh', 'Scripts/TradeOpsTelemetryOutboxSelfTest.mq5'];
    for (const path of paths) {
      const text = source(path);
      expect(text).not.toMatch(/\b(?:WebRequest|Socket\w*|OrderSend\w*|CTrade|FileOpen|FileDelete|FolderClean|TimeCurrent|TimeLocal|OnTimer|OnTradeTransaction)\b|#import/u);
      expect([...text].filter(c => c === '{').length).toBe([...text].filter(c => c === '}').length);
    }
    expect(source('TradeOpsAgent.mq5')).not.toContain('TradeOpsTelemetryOutbox');
  });

  it('authors the production adapter lifecycle and fault matrix (source contract, not MQL execution)', () => {
    const native = source('Scripts/TradeOpsTelemetryOutboxV2SelfTest.mq5');
    const rig = source('Scripts/Support/TradeOpsTelemetryOutboxV2Rig.mqh');
    const store = source('Scripts/Support/TradeOpsTelemetryMemoryStore.mqh');
    expect(native).toContain('#property script_show_inputs');
    expect(native).toMatch(/int checks\s*=\s*0\s*,\s*failures\s*=\s*0/u);
    expect(native).toContain('void Check(const bool pass,const string label)');
    for (const label of [
      'replay.restart.exact', 'replay.newer_capture.exact', 'binding.stale_new_no_commit',
      'binding.wrong_generation', 'binding.wrong_root', 'binding.failed_rebind_clears',
      'candidate.invalid_no_commit.', 'checkpoint.queue_event_id', 'checkpoint.queue_digest',
      'checkpoint.queue_sequence', 'checkpoint.queue_observed', 'response.invalid_no_write.',
      'prefix.zero', 'prefix.batch32', 'prefix.queued33', 'prefix.repeated_deal',
      'prefix.size_shrink', 'prefix.invalid_record', 'prefix.oversized_head',
      'counter.request_exhaustion', 'values.negative_null_known', 'values.huge_utf8',
      'outputs.decode_cleared', 'outputs.response_cleared',
      'ack.literal', 'ack.duplicate_after_restart', 'ack.old_newer_pending_unchanged',
      'witness.missing', 'witness.corrupt', 'witness.current_retained',
      'witness.previous_retained', 'witness.eventual_reclaim',
      'prepare.fault.', 'ack.fault.', 'fault.actual_hit',
    ]) expect(native, label).toContain(`\"${label}`);
    for (const label of [
      'checkpoint.fixture.accepted_head', 'checkpoint.fixture.decode',
      'checkpoint.fixture.sent_at_covers_mutation',
      'checkpoint.fixture.encode.', 'checkpoint.fixture.bind.',
      'checkpoint.queue_sequence.reaches_adapter_validator',
      'checkpoint.queue_observed.maps_changed_value',
      'witness.previous_only.chain', 'witness.previous_only.recover',
      'witness.previous_only.exclusive', 'witness.previous_only.prune_fault',
      'witness.previous_only.sent_at_covers_event',
      'witness.previous_only.retained',
      'witness.previous_only.eventual_reclaim',
    ]) expect(native, label).toContain(`\"${label}`);
    expect(native).toContain('bool InjectCheckpointRoot(');
    expect(native).toContain('changed_context.state=changed_state');
    expect(native).toContain('CheckpointMutationValidation();');
    expect(native).not.toContain('(!bound || result==TOV2_STATE_INVALID)');
    expect(native).toContain('TOV2_OUTBOX_V2_PASS checks=');
    expect(native).toContain('TOV2_OUTBOX_V2_FAIL');
    expect(native).toContain('Tov2WireDecodeRequest');
    expect(native).toContain('Tov2WireVerifyResponse');
    expect(native).toContain('new CTov2OutboxV2Rig');
    expect(native).toContain('class CTov2CaptureCheckpointBox');
    expect(native).toContain('new CTov2CaptureCheckpointBox');
    expect(native).not.toContain('new Tov2CaptureCheckpoint');
    const oldAckReplay = slice(native, 'void ResponseMutationsAndLiteralAck()', 'void FailedOutputClearing()');
    const newerPoll = oldAckReplay.indexOf('bool newer_polled=rig.Poll();');
    const coveredSendTime = oldAckReplay.indexOf('rig.sent_at=rig.broker.utc_now;', newerPoll);
    const newerBind = oldAckReplay.indexOf('rig.Bind()', newerPoll);
    expect(newerPoll).toBeGreaterThanOrEqual(0);
    expect(coveredSendTime).toBeGreaterThan(newerPoll);
    expect(newerBind).toBeGreaterThan(coveredSendTime);
    expect(oldAckReplay).toContain('before.pending.kind=="PENDING" && before.pending_request==2');
    expect(oldAckReplay).toContain('if(!newer_pending) {delete rig;return;}');
    expect(rig).toContain('bool Poll()');
    expect(rig).toContain('bool ReadContext(');
    expect(store).toContain('int FaultSeen()');
    expect(store).toContain('bool FaultTriggered()');
  });
});
