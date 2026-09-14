import { canonicalStringify, sha256Hex } from './canonical';
import { deriveCoverageV2 } from './telemetry-coverage-v2';
import { canonicalInput, bad, boolean, choice, fixed as schemaFixed, integer, list, nullable, object, reading, text, type Reader } from './telemetry-schema-v2';
import { readDigestV2, readIdentifierV2, readTicketV2, sumFixedV2, type FixedDecimalV2 } from './telemetry-values-v2';
import { includesDealV2, makeBoundaryV2, type TrackingBoundaryV2 } from './telemetry-cutover-v2';

const id: Reader<string> = readIdentifierV2;
const digest: Reader<string> = readDigestV2;
const ticket: Reader<string> = readTicketV2;
const instant = integer(1);
const counter = integer();
const symbol = text(64);
const fixedValue: Reader<FixedDecimalV2> = schemaFixed;
const money = reading;
const reason = choice('CLIENT', 'MOBILE', 'WEB', 'EXPERT', 'SL', 'TP', 'SO', 'ROLLOVER', 'VMARGIN', 'SPLIT', 'CORPORATE_ACTION', 'UNKNOWN');
const gap = choice('HISTORY_UNAVAILABLE', 'CLOCK_DISCONTINUITY', 'OUTBOX_CORRUPT', 'CAPTURE_FAILED', 'UNSUPPORTED_RECORD');
const nullableTicket = nullable(ticket);
const nullableSymbol = nullable(symbol);

const identityReader = object({ account_id: id, installation_id: id, tracking_id: id, safety_epoch: counter, account_profile_sha256: digest, account_fingerprint_sha256: digest, tracking_boundary_sha256: digest });
export type IdentityV2 = ReturnType<typeof identityReader>;
export const readIdentityV2: Reader<IdentityV2> = identityReader;
const boundaryReader = object({ tracking_id: id, account_fingerprint_sha256: digest, started_at_broker_msc: instant, initialized_at_utc_seconds: instant, excluded_boundary_deal_ids: list(ticket, 1024) });
const positionReader = object({ ticket, position_id: ticket, symbol, side: choice('BUY', 'SELL'), volume: fixedValue, entry_price: money, current_price: money, sl: money, tp: money, floating_profit: money, swap: money });
const orderReader = object({ ticket, symbol, type: choice('BUY_LIMIT', 'SELL_LIMIT', 'BUY_STOP', 'SELL_STOP', 'BUY_STOP_LIMIT', 'SELL_STOP_LIMIT'), state: choice('STARTED', 'PLACED', 'PARTIAL', 'REQUEST_ADD', 'REQUEST_MODIFY', 'REQUEST_CANCEL', 'UNKNOWN'), volume_initial: fixedValue, volume_current: fixedValue, price: money, stop_limit_price: money, sl: money, tp: money });
const exposureReader = object({ status: choice('COMPLETE', 'CAPTURE_FAILED', 'LIMIT_EXCEEDED'), observed_at_utc_seconds: instant, observed_at_broker_msc: instant, position_count: nullable(counter), order_count: nullable(counter), positions: list(positionReader, 128), orders: list(orderReader, 128) });
const accountReader = object({ status: choice('COMPLETE', 'CAPTURE_FAILED'), observed_at_utc_seconds: instant, observed_at_broker_msc: instant, balance: money, equity: money, margin_used: money, margin_free: money, margin_level: money });
const displayReader = object({ company: text(96), server: text(96), login_last4: text(4, /^\d{4}$/u), currency: text(12, /^[A-Z0-9]{1,12}$/u), currency_scale: integer(0), account_mode: choice('DEMO', 'REAL', 'CONTEST', 'UNKNOWN'), margin_mode: choice('RETAIL_NETTING', 'EXCHANGE', 'RETAIL_HEDGING', 'UNKNOWN') });
const registrationReader = object({ boundary: boundaryReader, display: displayReader, baseline: exposureReader });
export type RegistrationV2 = ReturnType<typeof registrationReader>;
export const readRegistrationV2: Reader<RegistrationV2> = registrationReader;

const reversalReader = object({ source: choice('RECONSTRUCTED_POSITION_VOLUME'), closing_volume: fixedValue, opening_volume: fixedValue });
const dealReader = object({ kind: choice('DEAL'), deal_id: ticket, revision: instant, previous_record_sha256: nullable(digest), broker_time_msc: instant, type: choice('BUY', 'SELL', 'BUY_CANCELED', 'SELL_CANCELED', 'BALANCE', 'CREDIT', 'CHARGE', 'CORRECTION', 'BONUS', 'COMMISSION', 'COMMISSION_DAILY', 'COMMISSION_MONTHLY', 'COMMISSION_AGENT_DAILY', 'COMMISSION_AGENT_MONTHLY', 'INTEREST', 'DIVIDEND', 'DIVIDEND_FRANKED', 'TAX'), entry: choice('IN', 'OUT', 'INOUT', 'OUT_BY', 'NONE'), order_id: nullableTicket, position_id: nullableTicket, symbol: nullableSymbol, volume: nullable(fixedValue), price: money, profit: money, commission: money, swap: money, fee: money, reason, sl: money, tp: money, protection_source: choice('BROKER_DEAL', 'UNAVAILABLE'), reversal_split: nullable(reversalReader) });
const protectionReader = object({ kind: choice('PROTECTION_OBSERVATION'), position_id: ticket, ticket, symbol, observed_at_broker_msc: instant, sl: money, tp: money, source: choice('POLL', 'TRANSACTION_OBSERVATION') });
export type DealV2 = ReturnType<typeof dealReader>;
export type ProtectionV2 = ReturnType<typeof protectionReader>;
const recordReader: Reader<DealV2 | ProtectionV2> = (value) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) bad();
  return (value as Record<string, unknown>).kind === 'DEAL' ? dealReader(value) : protectionReader(value);
};
const eventReader = object({ sequence: instant, event_id: id, observed_at_utc_seconds: instant, record_sha256: digest, record: recordReader });
export type JournalEventV2 = ReturnType<typeof eventReader>;
const collectionReader = object({ produced_events: counter, scan_finished: boolean, scan_through_broker_msc: nullable(instant), record_gap: nullable(gap), observation_gap: boolean });
const diagnosticsReader = object({ ea_release: text(64), reported_source_sha256: nullable(digest), reported_manifest_sha256: nullable(digest), terminal_build: instant, source_symbol: symbol, observed_at_utc_seconds: instant, terminal_connection_state: choice('CONNECTED', 'DISCONNECTED', 'UNKNOWN'), account_trade_permission: choice('ALLOWED', 'DENIED', 'UNKNOWN'), terminal_trade_permission: choice('ALLOWED', 'DENIED', 'UNKNOWN'), algo_trading_permission: choice('ALLOWED', 'DENIED', 'UNKNOWN'), last_successful_upload_utc_seconds: nullable(instant), last_accepted_request_sequence: counter, local_unsent_events: counter, last_error: nullable(choice('HISTORY_UNAVAILABLE', 'CLOCK_DISCONTINUITY', 'OUTBOX_CORRUPT', 'CAPTURE_FAILED', 'UNSUPPORTED_RECORD', 'DISK_FULL', 'HTTP_ERROR', 'RESPONSE_INVALID')) });
const requestReader = object({ schema_version: choice('AgentSyncRequestV2'), identity: identityReader, registration: registrationReader, request_sequence: instant, last_acknowledged_event_sequence: counter, sent_at_utc_seconds: instant, account: accountReader, exposure: exposureReader, collection: collectionReader, diagnostics: diagnosticsReader, events: list(eventReader, 32), body_sha256: digest });
export type TelemetryRequestV2 = ReturnType<typeof requestReader>;

function equalFixed(left: FixedDecimalV2, right: FixedDecimalV2): boolean { return left.scale === right.scale && left.value === right.value; }
function positive(value: FixedDecimalV2): boolean { return !value.value.startsWith('-') && value.value !== '0' && !/^0\.0+$/u.test(value.value); }
function known(value: ReturnType<typeof money>): value is Readonly<{ value: FixedDecimalV2; reason: null }> { return value.value !== null; }
function requireScale(value: ReturnType<typeof money>, scale: number): void { if (known(value) && value.value.scale !== scale) bad(); }
function validateExposure(value: ReturnType<typeof exposureReader>, scale: number, completeRequired = false): void {
  const positions = new Set<string>(), positionIds = new Set<string>(), orders = new Set<string>();
  for (const position of value.positions) { if (positions.has(position.ticket) || positionIds.has(position.position_id) || !positive(position.volume)) bad(); positions.add(position.ticket); positionIds.add(position.position_id); requireScale(position.floating_profit, scale); requireScale(position.swap, scale); }
  for (const order of value.orders) { if (orders.has(order.ticket) || !positive(order.volume_initial) || !positive(order.volume_current) || order.volume_initial.scale !== order.volume_current.scale) bad(); const remainder = sumFixedV2([order.volume_initial, { value: `-${order.volume_current.value}`, scale: order.volume_current.scale }], order.volume_initial.scale); if (remainder.value.startsWith('-')) bad(); orders.add(order.ticket); }
  if (value.status === 'COMPLETE' || completeRequired) { if (value.position_count !== value.positions.length || value.order_count !== value.orders.length) bad(); }
  if (value.status !== 'COMPLETE' && (value.positions.length !== 0 || value.orders.length !== 0)) bad();
}
function validateAccount(value: ReturnType<typeof accountReader>, scale: number): void {
  const core = [value.balance, value.equity, value.margin_used, value.margin_free];
  if (value.status === 'COMPLETE' && core.some((entry) => !known(entry))) bad();
  if (value.status === 'CAPTURE_FAILED' && [ ...core, value.margin_level ].some(known)) bad();
  for (const entry of core) requireScale(entry, scale);
}
function validateEvent(event: JournalEventV2, boundary: TrackingBoundaryV2, scale: number): void {
  const record = event.record;
  if (record.kind === 'PROTECTION_OBSERVATION') { if (record.observed_at_broker_msc < boundary.started_at_broker_msc) bad('TELEMETRY_BEFORE_TRACKING'); return; }
  if (!includesDealV2(boundary, record.broker_time_msc, record.deal_id)) bad('TELEMETRY_BEFORE_TRACKING');
  if ((record.revision === 1) !== (record.previous_record_sha256 === null)) bad();
  const trading = ['BUY', 'SELL', 'BUY_CANCELED', 'SELL_CANCELED'].includes(record.type);
  if (trading) { if (record.position_id === null || record.order_id === null || record.symbol === null || record.volume === null || !positive(record.volume) || record.entry === 'NONE') bad(); }
  else if (record.entry !== 'NONE' || record.reversal_split !== null) bad();
  for (const item of [record.profit, record.commission, record.swap, record.fee]) requireScale(item, scale);
  if (record.protection_source === 'UNAVAILABLE' && (known(record.sl) || known(record.tp))) bad();
  if (record.reversal_split !== null) { if (record.entry !== 'INOUT' || record.volume === null || !positive(record.reversal_split.closing_volume) || !positive(record.reversal_split.opening_volume) || record.volume.scale !== record.reversal_split.closing_volume.scale || record.volume.scale !== record.reversal_split.opening_volume.scale || !equalFixed(sumFixedV2([record.reversal_split.closing_volume, record.reversal_split.opening_volume], record.volume.scale), record.volume)) bad(); }
}
async function validateRequest(value: TelemetryRequestV2, raw: unknown): Promise<void> {
  const boundary = makeBoundaryV2(value.registration.boundary);
  if (canonicalStringify(boundary) !== canonicalStringify(value.registration.boundary) || value.identity.tracking_id !== boundary.tracking_id || value.identity.account_fingerprint_sha256 !== boundary.account_fingerprint_sha256) bad();
  const scale = value.registration.display.currency_scale; if (scale > 16) bad();
  validateExposure(value.registration.baseline, scale, true); validateExposure(value.exposure, scale); validateAccount(value.account, scale);
  if (value.registration.baseline.status !== 'COMPLETE' || value.registration.baseline.observed_at_utc_seconds !== boundary.initialized_at_utc_seconds || Math.floor(value.registration.baseline.observed_at_broker_msc / 1000) * 1000 !== boundary.started_at_broker_msc || boundary.initialized_at_utc_seconds > value.sent_at_utc_seconds) bad();
  for (const time of [value.account.observed_at_utc_seconds, value.exposure.observed_at_utc_seconds, value.diagnostics.observed_at_utc_seconds, ...value.events.map((event) => event.observed_at_utc_seconds)]) if (time < boundary.initialized_at_utc_seconds || time > value.sent_at_utc_seconds) bad();
  const ids = new Set<string>(), deals = new Set<string>(); let highest = value.last_acknowledged_event_sequence;
  for (const event of value.events) { if (ids.has(event.event_id) || (event.record.kind === 'DEAL' && deals.has(event.record.deal_id))) bad(); ids.add(event.event_id); if (event.record.kind === 'DEAL') deals.add(event.record.deal_id); validateEvent(event, boundary, scale); if (event.record_sha256 !== await sha256Hex(canonicalStringify(event.record))) bad(); if (event.sequence > highest) highest = event.sequence; }
  if (value.collection.produced_events < highest || value.diagnostics.local_unsent_events !== value.collection.produced_events - value.last_acknowledged_event_sequence || value.diagnostics.last_accepted_request_sequence !== value.request_sequence - 1) bad();
  if (value.diagnostics.last_successful_upload_utc_seconds !== null && (value.diagnostics.last_successful_upload_utc_seconds < boundary.initialized_at_utc_seconds || value.diagnostics.last_successful_upload_utc_seconds > value.sent_at_utc_seconds)) bad();
  const upper = Math.max(value.account.observed_at_broker_msc, value.exposure.observed_at_broker_msc);
  if (value.collection.scan_through_broker_msc !== null && (value.collection.scan_through_broker_msc < boundary.started_at_broker_msc || value.collection.scan_through_broker_msc > upper)) bad();
  deriveCoverageV2({ started: true, ...value.collection, acknowledged_events: value.last_acknowledged_event_sequence });
  if (value.identity.tracking_boundary_sha256 !== await sha256Hex(canonicalStringify(value.registration.boundary))) bad();
  const envelope = { ...(raw as Record<string, unknown>) }; delete envelope.body_sha256;
  if (value.body_sha256 !== await sha256Hex(canonicalStringify(envelope))) bad('TELEMETRY_DIGEST_INVALID');
}
export async function parseTelemetryV2(bytes: Uint8Array): Promise<TelemetryRequestV2> {
  const raw = canonicalInput(bytes); const parsed = requestReader(raw); await validateRequest(parsed, raw);
  // Hash comparisons are intentionally based on raw canonical input, not normalized reader output.
  return parsed;
}

const responseReader = object({ schema_version: choice('AgentSyncResponseV2'), identity: identityReader, request_sequence: instant, request_body_sha256: digest, accepted_at_utc_seconds: instant, acknowledged_event_sequence: counter, coverage: object({ state: choice('NOT_STARTED', 'CATCHING_UP', 'UP_TO_DATE', 'DATA_MISSING'), through_broker_msc: nullable(instant), pending_events: counter, reason: nullable(gap), observation_gap: boolean }), mode: choice('DRY_RUN'), command: choice(null), response_body_sha256: digest });
type TelemetryResponseV2 = ReturnType<typeof responseReader>;
export async function responseBytesV2(request: TelemetryRequestV2, acknowledged: number, acceptedAt: number): Promise<string> {
  const expectedAck = request.events.at(-1)?.sequence ?? request.last_acknowledged_event_sequence;
  if (counter(acknowledged) !== expectedAck) bad();
  const coverage = deriveCoverageV2({ started: true, ...request.collection, acknowledged_events: acknowledged });
  const body = { schema_version: 'AgentSyncResponseV2', identity: request.identity, request_sequence: request.request_sequence, request_body_sha256: request.body_sha256, accepted_at_utc_seconds: instant(acceptedAt), acknowledged_event_sequence: counter(acknowledged), coverage, mode: 'DRY_RUN', command: null };
  const response = { ...body, response_body_sha256: await sha256Hex(canonicalStringify(body)) };
  return canonicalStringify(response);
}
export async function validateResponseV2(bytes: Uint8Array, request: TelemetryRequestV2): Promise<string> {
  const raw = canonicalInput(bytes, 16 * 1024); const response: TelemetryResponseV2 = responseReader(raw);
  const expectedAck = request.events.at(-1)?.sequence ?? request.last_acknowledged_event_sequence;
  if (response.acknowledged_event_sequence !== expectedAck) bad();
  // The comparison also validates response hashing, correlation, mode, command and exact derived coverage.
  const actual = new TextDecoder().decode(bytes);
  const expected = await responseBytesV2(request, expectedAck, response.accepted_at_utc_seconds);
  if (actual !== expected) bad();
  return actual;
}
export { boundedBody } from './telemetry-schema-v2';
