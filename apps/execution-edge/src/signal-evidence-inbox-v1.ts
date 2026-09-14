import { canonicalStringify, sha256Hex } from './canonical';
import { boolean, boundedBody, choice, integer, list, nullable, object, text } from './telemetry-schema-v2';

export interface InboxEnv {
  EXECUTION_DB: D1Database;
  SIGNAL_EVIDENCE_INBOX_ENABLED?: 'true' | 'false';
  SIGNAL_DELIVERY_SECRET_SHA256?: string;
}

const MAX_BODY = 278528;
const MAX_EVIDENCE = 262144;
const HASH = /^[a-f0-9]{64}$/u;
const digest = text(64, HASH);
const identifier = text(160, /^[\x21-\x5b\x5d-\x7e]+$/u);
// Existing inner evidence retains its original string bounds.
const innerId = text(256, /^[\x21-\x5b\x5d-\x7e]+$/u);
const sourceId = text(1024, /^[\x21-\x5b\x5d-\x7e]+$/u);
const counter = integer();
const positive = integer(1);
const models = choice('BOC', 'DIR_CLOSE', 'HTF_FLIP');
const direction = choice('LONG', 'SHORT');
const fidelity = choice('EXACT', 'CALIBRATED', 'DISCRETIONARY', 'UNRESOLVED');
const plane = choice('CONFIRMED_5M', 'LOWER_TIMEFRAME_REPLAY', 'REALTIME_TICK', 'EXTERNAL_ARCHIVED_TICK');
const replayability = choice('REPLAYABLE', 'LIVE_EXACT_NON_REPLAYABLE');
const tier = nullable(choice('HTF_TIMED', 'DISCRETIONARY_5M'));
const strings = list(innerId, 20000);
const safety = { authority: choice('EVIDENCE_ONLY'), execution_allowed: choice(false) };
const tickSize = text(64, /^(?:0\.[0-9]*[1-9]|[1-9][0-9]*(?:\.[0-9]*[1-9])?)$/u);
const candle = object({ open_epoch: counter, close_epoch: counter, open_ticks: positive, high_ticks: positive, low_ticks: positive, close_ticks: positive });
const binding = object({ schema_version: choice('TradeOpsSignalEvidenceBindingV1'), producer_namespace: identifier, ticker_id: identifier, feed: innerId, symbol: innerId, tick_size: tickSize, detector_code_hash: digest, settings_hash: digest });
const formation = object({ setup_id: innerId, origin_epoch: positive, confirmation_epoch: positive, direction, variant: choice('STANDARD', 'ACCURACY'), origin_open_ticks: positive, origin_high_ticks: positive, origin_low_ticks: positive, origin_close_ticks: positive, zone_top_ticks: positive, zone_bottom_ticks: positive, formation_source_id: sourceId });
const candidate = object({ candidate_id: innerId, setup_id: innerId, model: models, state: choice('MATCHED', 'BLOCKED', 'REJECTED'), direction, event_anchor_epoch: counter, trigger_ordinal: counter, boc_tier: tier, reference_candle_open_epoch: nullable(counter), source_claim_ids: strings, observed_at_epoch: counter });
const proof = object({
  evidence_id: innerId,
  candidate_id: innerId,
  observed_trigger_epoch: nullable(counter),
  trigger_sequence: counter,
  observed_trigger_ticks: nullable(positive),
  htf_context_minutes: list(choice(15, 30, 60), 3),
  fidelity,
  proof_plane: plane,
  replayability,
  coverage_start_epoch: counter,
  coverage_end_epoch: counter,
  ambiguity_codes: list(choice(
    'SHADOW_SAME_CHILD_BAR_ORDER',
    'SHADOW_MISSING_INTRABAR_COVERAGE',
    'SHADOW_REALTIME_ONLY_NOT_REPLAYABLE',
  ), 3),
  boc_tier: tier,
  reference_candle_open_epoch: nullable(counter),
  reference_candle_open_ticks: nullable(positive),
  reference_candle_high_ticks: nullable(positive),
  reference_candle_low_ticks: nullable(positive),
  reference_candle_close_ticks: nullable(positive),
  htf_open_ticks: nullable(positive),
  contact_candle: nullable(candle),
  recross_candle: nullable(candle),
  coverage_gap_detected: nullable(boolean),
  full_lifecycle_ordered: nullable(boolean),
  destination_seen_before_contact: nullable(boolean),
  passed_rule_ids: strings,
  failed_rule_ids: strings,
  source_claim_ids: strings,
  payload_sha256: innerId,
  observed_at_epoch: counter
});
const selection = object({ selection_id: innerId, setup_id: innerId, policy_version: choice('rd-entry-arbitration-v3'), revision: counter, candidate_ids_considered: strings, canonical_candidate_id: nullable(innerId), canonical_evidence_id: nullable(innerId), canonical_model: nullable(models), reason: choice('ONLY_EXACT_TRIGGER', 'EARLIEST_EXACT_TRIGGER', 'FALLBACK_TO_CONFIRMED_CLOSE', 'CO_TRIGGER_SAME_EVENT', 'CO_TRIGGER_PRICE_CONFLICT', 'NO_EXACT_CANDIDATE', 'SETUP_INVALIDATED', 'NO_CANDIDATE'), fidelity: nullable(fidelity), action: choice('OBSERVE', 'PAPER_ELIGIBLE', 'SHADOW_ONLY', 'NONE'), co_triggered_models: list(models, 3), evaluated_at_epoch: counter });
const evaluation = object({ candidates: list(candidate, 20000), evidence: list(proof, 20000), selection });
const setup = object({ setup_id: innerId, direction, zone_top_ticks: positive, zone_bottom_ticks: positive, zone_engaged_epoch: nullable(counter), invalidated_before_entry: boolean, common_fidelity: fidelity, liquidity_cohort: choice('ONE_CANDLE', 'TWO_PLUS_CANDLES'), one_candle_enabled: boolean, common_rule_results: list(object({ rule_id: innerId, passed: boolean }), 20000) });
const bundle = object({ setup, candidates: list(candidate, 20000), evidence: list(proof, 20000), selection_proposal: selection, trade_plan: nullable(object({ direction, entry_ticks: positive, stop_ticks: positive, target_ticks: positive })) });
const observation = object({
  schema_version: choice('3.1'),
  strategy_id: identifier,
  strategy_version: choice('3.1.0-contract3'),
  rule_contract_version: choice('3.1.0'),
  execution_mode: choice('PAPER_ONLY'),
  producer_instance_id: identifier,
  producer_sequence: positive,
  event_id: innerId,
  is_realtime: choice(true),
  symbol: innerId,
  ticker_id: identifier,
  feed: innerId,
  timeframe: choice('5'),
  tick_size: text(64, /^(?:0\.[0-9]*[1-9][0-9]*|[1-9][0-9]*(?:\.[0-9]+)?)$/u),
  detector_code_hash: digest,
  settings_hash: digest,
  observed_at_epoch: counter,
  market_event: object({
    epoch: counter,
    sequence: counter,
    tick_price_ticks: nullable(positive),
    barstate_isconfirmed: boolean,
    confirmed_bar: nullable(candle),
  }),
  exit_events: list(object({
    event_id: innerId,
    setup_id: innerId,
    exit_reason: innerId,
    epoch: counter,
    sequence: counter,
    price_ticks: positive,
  }), 0),
  setups: list(bundle, 20000),
});
const entry = object({ schema_version: choice('TradeOpsSignalEvidenceV1'), ...safety, status: choice('SELECTED'), attempt_key: digest, formation_body_sha256: digest, evidence_id: digest, evidence_body_sha256: digest, formation, reviewed_binding: binding, source_observation: observation, edge_evaluation: evaluation, selected: object({ candidate, evidence: proof }) });
const delivery = object({ schema_version: choice('TradeOpsSignalDeliveryV1'), ...safety, delivery_id: digest, delivery_body_sha256: digest, receipt_id: digest, registration_id: identifier, generation: positive, attempt_key: digest, evidence_id: digest, evidence_body_sha256: digest, admitted_at_epoch: counter, expires_at_epoch: counter, evidence: entry });
export type SignalDeliveryV1 = ReturnType<typeof delivery>;

function invalid(): never { throw new Error('INVALID_DELIVERY'); }
function requireValid(condition: unknown): asserts condition { if (!condition) invalid(); }
const hash = (value: unknown) => sha256Hex(canonicalStringify(value));
const equal = (a: unknown, b: unknown) => canonicalStringify(a) === canonicalStringify(b);

// Independent bounded parser: duplicate keys and numeric spelling are checked
// before JSON numbers lose their original tokens. Never imports observation code.
function parse(bytes: Uint8Array): unknown {
  const source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  let offset = 0; let nodes = 0;
  const whitespace = () => { while (/[\t\n\r ]/u.test(source[offset] ?? 'x')) offset++; };
  function string(): string {
    const start = offset++;
    while (offset < source.length) {
      const c = source[offset++];
      if (c === '\\') { offset++; continue; }
      if (c === '"') {
        const result: unknown = JSON.parse(source.slice(start, offset));
        if (typeof result !== 'string') invalid();
        return result;
      }
    }
    return invalid();
  }
  function value(depth: number): unknown {
    if (depth > 64 || ++nodes > 20000) invalid(); whitespace();
    const c = source[offset];
    if (c === '"') return string();
    if (c === '{') {
      offset++; whitespace(); const entries: Array<[string, unknown]> = []; const keys = new Set<string>();
      if (source[offset] === '}') { offset++; return Object.fromEntries(entries); }
      while (offset < source.length) {
        whitespace(); if (source[offset] !== '"') invalid(); const key = string();
        if (keys.has(key)) invalid(); keys.add(key); whitespace(); if (source[offset++] !== ':') invalid();
        entries.push([key, value(depth + 1)]); whitespace(); const separator = source[offset++];
        if (separator === '}') return Object.fromEntries(entries);
        if (separator !== ',') invalid();
      }
      return invalid();
    }
    if (c === '[') {
      offset++; whitespace(); const result: unknown[] = [];
      if (source[offset] === ']') { offset++; return result; }
      while (offset < source.length) {
        result.push(value(depth + 1)); whitespace(); const separator = source[offset++];
        if (separator === ']') return result;
        if (separator !== ',') invalid();
      }
      return invalid();
    }
    for (const [token, literal] of [['true', true], ['false', false], ['null', null]] as const) {
      if (source.startsWith(token, offset)) { offset += token.length; return literal; }
    }
    const token = /^-?(?:0|[1-9][0-9]*)/u.exec(source.slice(offset))?.[0];
    if (token === undefined || token === '-0') invalid(); offset += token.length;
    const n = Number(token); if (!Number.isSafeInteger(n)) invalid(); return n;
  }
  const result = value(0); whitespace(); if (offset !== source.length) invalid(); return result;
}

function unique(values: readonly string[]): void { requireValid(new Set(values).size === values.length); }
function validateEvaluation(e: ReturnType<typeof evaluation>, setupId: string): void {
  unique(e.candidates.map(c => c.candidate_id)); unique(e.evidence.map(p => p.evidence_id));
  unique(e.selection.candidate_ids_considered); unique(e.selection.co_triggered_models);
  requireValid(e.selection.setup_id === setupId);
  for (const c of e.candidates) requireValid(c.setup_id === setupId);
  for (const p of e.evidence) requireValid(e.candidates.some(c => c.candidate_id === p.candidate_id));
  for (const id of e.selection.candidate_ids_considered) requireValid(e.candidates.some(c => c.candidate_id === id));
}

/** Closed transport validation only. Does not re-evaluate market rules. */
export async function decodeSignalDeliveryV1(bytes: Uint8Array): Promise<SignalDeliveryV1> {
  requireValid(bytes.byteLength > 0 && bytes.byteLength <= MAX_BODY);
  const raw = parse(bytes); const body = delivery(raw);
  const e = body.evidence; const f = e.formation; const b = e.reviewed_binding; const o = e.source_observation;
  requireValid(new TextEncoder().encode(canonicalStringify(e)).byteLength <= MAX_EVIDENCE);
  requireValid(body.attempt_key === e.attempt_key && body.evidence_id === e.evidence_id && body.evidence_body_sha256 === e.evidence_body_sha256);
  requireValid(body.expires_at_epoch > body.admitted_at_epoch);
  requireValid(b.detector_code_hash !== '0'.repeat(64) && b.settings_hash !== '0'.repeat(64));
  requireValid(b.ticker_id === o.ticker_id && b.feed === o.feed && b.symbol === o.symbol && b.detector_code_hash === o.detector_code_hash && b.settings_hash === o.settings_hash);
  requireValid(b.tick_size === (o.tick_size.includes('.') ? o.tick_size.replace(/0+$/u, '').replace(/\.$/u, '') : o.tick_size));
  const attempt = { domain: 'tradeops-demo-attempt-v1', strategy_id: o.strategy_id, ticker_id: b.ticker_id, feed: b.feed, timeframe: '5', origin_epoch: f.origin_epoch, confirmation_epoch: f.confirmation_epoch, direction: f.direction, variant: f.variant, attempt_kind: 'INITIAL' };
  const geometry = { domain: 'tradeops-demo-formation-v1', origin_epoch: f.origin_epoch, confirmation_epoch: f.confirmation_epoch, direction: f.direction, variant: f.variant, origin_open_ticks: f.origin_open_ticks, origin_high_ticks: f.origin_high_ticks, origin_low_ticks: f.origin_low_ticks, origin_close_ticks: f.origin_close_ticks, tick_size: b.tick_size, zone_top_ticks: f.zone_top_ticks, zone_bottom_ticks: f.zone_bottom_ticks };
  requireValid(e.attempt_key === await hash(attempt)); requireValid(e.formation_body_sha256 === await hash(geometry));
  requireValid(e.evidence_id === await hash({ domain: 'tradeops-signal-evidence-id-v1', producer_namespace: b.producer_namespace, producer_instance_id: o.producer_instance_id, event_id: o.event_id, producer_sequence: o.producer_sequence, attempt_key: e.attempt_key }));
  requireValid(body.delivery_id === await hash({ schema_version: 'TradeOpsSignalDeliveryIdentityV1', attempt_key: e.attempt_key, evidence_id: e.evidence_id }));
  requireValid(body.receipt_id === await hash({ schema_version: 'TradeOpsSignalReceiptIdentityV1', registration_id: body.registration_id, generation: body.generation, sequence: o.producer_sequence }));
  const { evidence_body_sha256, ...evidenceBody } = e;
  requireValid(evidence_body_sha256 === await hash(evidenceBody));
  const { delivery_body_sha256, ...deliveryBody } = body;
  requireValid(delivery_body_sha256 === await hash(deliveryBody));
  unique(o.setups.map(s => s.setup.setup_id));
  for (const s of o.setups) validateEvaluation({ candidates: s.candidates, evidence: s.evidence, selection: s.selection_proposal }, s.setup.setup_id);
  validateEvaluation(e.edge_evaluation, f.setup_id);
  const s = o.setups.find(s => s.setup.setup_id === f.setup_id);
  requireValid(s !== undefined && s.setup.direction === f.direction && s.setup.zone_top_ticks === f.zone_top_ticks && s.setup.zone_bottom_ticks === f.zone_bottom_ticks);
  const c = e.selected.candidate; const p = e.selected.evidence; const selected = e.edge_evaluation.selection;
  requireValid(c.state === 'MATCHED' && c.direction === f.direction && c.setup_id === f.setup_id && p.candidate_id === c.candidate_id);
  requireValid(selected.canonical_model === c.model && selected.canonical_candidate_id === c.candidate_id && selected.canonical_evidence_id === p.evidence_id && selected.action === 'PAPER_ELIGIBLE' && selected.fidelity === 'EXACT');
  requireValid(e.edge_evaluation.candidates.some(item => equal(item, c)) && e.edge_evaluation.evidence.some(item => equal(item, p)));
  requireValid(equal({ candidates: s.candidates, evidence: s.evidence, selection: s.selection_proposal }, e.edge_evaluation));
  requireValid(p.fidelity === 'EXACT' && p.failed_rule_ids.length === 0 && p.observed_trigger_epoch !== null && p.coverage_start_epoch <= p.coverage_end_epoch);
  requireValid(c.observed_at_epoch <= selected.evaluated_at_epoch && p.observed_at_epoch <= selected.evaluated_at_epoch && selected.evaluated_at_epoch <= o.observed_at_epoch);
  requireValid(HASH.test(c.candidate_id) && HASH.test(p.evidence_id) && HASH.test(p.payload_sha256) && HASH.test(selected.selection_id));
  requireValid(c.candidate_id === await hash({ boc_tier: c.boc_tier, direction: c.direction, event_anchor_epoch: c.event_anchor_epoch, model: c.model, reference_candle_open_epoch: c.reference_candle_open_epoch, setup_id: c.setup_id, trigger_ordinal: c.trigger_ordinal }));
  const { evidence_id: proofId, payload_sha256: proofHash, observed_at_epoch: _observedAt, ...proofBody } = p;
  requireValid(proofHash === await hash(proofBody));
  requireValid(proofId === await hash({ candidate_id: p.candidate_id, coverage_end_epoch: p.coverage_end_epoch, coverage_start_epoch: p.coverage_start_epoch, observed_trigger_epoch: p.observed_trigger_epoch, payload_sha256: p.payload_sha256, proof_plane: p.proof_plane, trigger_sequence: p.trigger_sequence }));
  const { selection_id: selectionId, canonical_model: _model, evaluated_at_epoch: _evaluatedAt, ...selectionBody } = selected;
  requireValid(selectionId === await hash(selectionBody));
  if (c.model === 'DIR_CLOSE') requireValid(p.proof_plane === 'CONFIRMED_5M' && p.replayability === 'REPLAYABLE');
  else {
    requireValid(p.proof_plane === 'REALTIME_TICK' && p.replayability === 'LIVE_EXACT_NON_REPLAYABLE');
    if (c.model === 'BOC') requireValid(c.boc_tier === 'HTF_TIMED' && p.boc_tier === 'HTF_TIMED' && p.reference_candle_open_epoch !== null && p.observed_trigger_ticks !== null);
    else requireValid(p.contact_candle !== null && p.recross_candle !== null && p.coverage_gap_detected === false && p.full_lifecycle_ordered === true && p.destination_seen_before_contact === false && p.contact_candle.close_epoch <= p.recross_candle.open_epoch);
  }
  return body;
}

function response(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
}
function failure(error: string, status: number): Response { return response({ authority: 'EVIDENCE_ONLY', execution_allowed: false, error }, status); }
function ack(body: SignalDeliveryV1, status: 'STORED' | 'DUPLICATE'): Response {
  return response({ schema_version: 'TradeOpsSignalDeliveryAckV1', authority: 'EVIDENCE_ONLY', execution_allowed: false, delivery_id: body.delivery_id, delivery_body_sha256: body.delivery_body_sha256, status }, status === 'STORED' ? 201 : 200);
}
async function authenticated(request: Request, env: InboxEnv): Promise<boolean> {
  const expected = env.SIGNAL_DELIVERY_SECRET_SHA256;
  const authorization = request.headers.get('authorization') ?? '';
  if (expected === undefined || !HASH.test(expected) || !/^Bearer [\x20-\x7e]{1,1024}$/u.test(authorization)) return false;
  const actual = await sha256Hex(authorization.slice(7)); let mismatch = 0;
  for (let index = 0; index < 64; index++) mismatch |= actual.charCodeAt(index) ^ expected.charCodeAt(index);
  return mismatch === 0;
}

export async function handleSignalEvidenceInbox(request: Request, env: InboxEnv, now: number): Promise<Response> {
  if (env.SIGNAL_EVIDENCE_INBOX_ENABLED !== 'true') return failure('NOT_FOUND', 404);
  if (request.method !== 'POST') return failure('METHOD_NOT_ALLOWED', 405);
  if (!await authenticated(request, env)) return failure('UNAUTHORIZED', 401);
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(request.headers.get('content-type') ?? '')) return failure('INVALID_DELIVERY', 415);
  let body: SignalDeliveryV1;
  try { body = await decodeSignalDeliveryV1(await boundedBody(request, MAX_BODY)); }
  catch (error) { return failure('INVALID_DELIVERY', error instanceof Error && error.message === 'TELEMETRY_TOO_LARGE' ? 413 : 422); }
  if (!Number.isSafeInteger(now) || now < 0) return failure('UNAVAILABLE', 503);
  try {
    const db = env.EXECUTION_DB;
    const existing = await db.prepare('SELECT delivery_body_sha256 FROM signal_evidence_inbox_v1 WHERE delivery_id=?').bind(body.delivery_id).first<{ delivery_body_sha256: string }>();
    if (existing !== null) return existing.delivery_body_sha256 === body.delivery_body_sha256 ? ack(body, 'DUPLICATE') : failure('CONFLICT', 409);
    if (now < body.admitted_at_epoch || now >= body.expires_at_epoch) return failure('EXPIRED', 422);
    // Unique constraints are the concurrency lock. A no-op must be re-read and
    // digest-compared; it is never an unconditional successful acknowledgment.
    const inserted = await db.prepare(`INSERT INTO signal_evidence_inbox_v1
      (delivery_id,namespace,attempt_key,delivery_body_sha256,receipt_id,evidence_id,evidence_body_sha256,registration_id,generation,admitted_at_epoch,expires_at_epoch,received_at_epoch,body,authority,execution_allowed)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'EVIDENCE_ONLY',0)
      ON CONFLICT DO NOTHING`).bind(body.delivery_id, body.evidence.reviewed_binding.producer_namespace, body.attempt_key, body.delivery_body_sha256, body.receipt_id, body.evidence_id, body.evidence_body_sha256, body.registration_id, body.generation, body.admitted_at_epoch, body.expires_at_epoch, now, canonicalStringify(body)).run();
    if (!inserted.success) return failure('UNAVAILABLE', 503);
    if (inserted.meta.changes === 1) return ack(body, 'STORED');
    if (inserted.meta.changes !== 0) return failure('UNAVAILABLE', 503);
    const winner = await db.prepare('SELECT delivery_id,delivery_body_sha256 FROM signal_evidence_inbox_v1 WHERE namespace=? AND attempt_key=?').bind(body.evidence.reviewed_binding.producer_namespace, body.attempt_key).first<{ delivery_id: string; delivery_body_sha256: string }>();
    if (winner === null) return failure('UNAVAILABLE', 503);
    return winner.delivery_id === body.delivery_id && winner.delivery_body_sha256 === body.delivery_body_sha256 ? ack(body, 'DUPLICATE') : failure('CONFLICT', 409);
  } catch { return failure('UNAVAILABLE', 503); }
}
