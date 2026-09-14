import { canonicalStringify, sha256Hex } from '../../src/canonical';
import { parseTelemetryV2 } from '../../src/telemetry-wire-v2';

export const NOW = 1_800_000_010;
export const START = 1_800_000_000;
export const f = (value: string, scale = 2) => ({ value, scale });
export const r = (value: string, scale = 2) => ({ value: f(value, scale), reason: null });
export const missing = () => ({ value: null, reason: 'UNAVAILABLE' as const });

export const positionFixture = () => ({ ticket: '18446744073709551615', position_id: '9007199254740993', symbol: 'EURUSD.a', side: 'BUY', volume: f('0.10'), entry_price: r('1.10000', 5), current_price: r('1.10010', 5), sl: missing(), tp: missing(), floating_profit: r('1.00'), swap: r('-0.01') });
export const dealFixture = (sequence = 1) => ({ sequence, event_id: `event-${sequence}`, observed_at_utc_seconds: NOW, record_sha256: 'a'.repeat(64), record: { kind: 'DEAL', deal_id: String(sequence), revision: 1, previous_record_sha256: null, broker_time_msc: START * 1000 + 5000, type: 'BUY', entry: 'OUT', order_id: '700', position_id: '9007199254740993', symbol: 'EURUSD.a', volume: f('0.10'), price: r('1.10000', 5), profit: r('10.00'), commission: r('-0.20'), swap: r('-0.05'), fee: r('-0.05'), reason: 'TP', sl: missing(), tp: r('1.10000', 5), protection_source: 'BROKER_DEAL', reversal_split: null } });

// This builder intentionally stays mutable so downstream tests can construct malformed wire inputs.
// fixture() below remains strict because it parses the signed bytes through the production reader.
export const unsignedFixture = (sequence = 1, acknowledged = 0, events: readonly unknown[] = []): any => {
  const lastSequence = (events.at(-1) as { readonly sequence?: number } | undefined)?.sequence ?? acknowledged;
  return ({
  schema_version: 'AgentSyncRequestV2',
  identity: { account_id: 'synthetic-account', installation_id: 'synthetic-installation', tracking_id: 'synthetic-tracking', safety_epoch: 7, account_profile_sha256: 'a'.repeat(64), account_fingerprint_sha256: 'b'.repeat(64), tracking_boundary_sha256: 'c'.repeat(64) },
  registration: { boundary: { tracking_id: 'synthetic-tracking', account_fingerprint_sha256: 'b'.repeat(64), started_at_broker_msc: START * 1000, initialized_at_utc_seconds: START, excluded_boundary_deal_ids: [] }, display: { company: 'Synthetic Broker', server: 'Synthetic-Demo', login_last4: '0001', currency: 'USD', currency_scale: 2, account_mode: 'DEMO', margin_mode: 'RETAIL_HEDGING' }, baseline: { status: 'COMPLETE', observed_at_utc_seconds: START, observed_at_broker_msc: START * 1000, position_count: 0, order_count: 0, positions: [], orders: [] } },
  request_sequence: sequence, last_acknowledged_event_sequence: acknowledged, sent_at_utc_seconds: NOW,
  account: { status: 'COMPLETE', observed_at_utc_seconds: NOW, observed_at_broker_msc: NOW * 1000, balance: r('10000.00'), equity: r('10000.00'), margin_used: r('0.00'), margin_free: r('10000.00'), margin_level: { value: null, reason: 'NOT_APPLICABLE' } },
  exposure: { status: 'COMPLETE', observed_at_utc_seconds: NOW, observed_at_broker_msc: NOW * 1000, position_count: 0, order_count: 0, positions: [], orders: [] },
  collection: { produced_events: lastSequence, scan_finished: true, scan_through_broker_msc: NOW * 1000, record_gap: null, observation_gap: false },
  diagnostics: { ea_release: 'synthetic-v2', reported_source_sha256: null, reported_manifest_sha256: null, terminal_build: 6140, source_symbol: 'EURUSD', observed_at_utc_seconds: NOW, terminal_connection_state: 'CONNECTED', account_trade_permission: 'DENIED', terminal_trade_permission: 'DENIED', algo_trading_permission: 'DENIED', last_successful_upload_utc_seconds: sequence === 1 ? null : NOW, last_accepted_request_sequence: sequence - 1, local_unsent_events: lastSequence - acknowledged, last_error: null }, events: [...events], body_sha256: 'd'.repeat(64),
  });
};

export async function signFixture(raw: object): Promise<Uint8Array> {
  const value = structuredClone(raw) as Record<string, unknown>;
  const registration = value.registration as Record<string, unknown>;
  const boundary = registration.boundary;
  (value.identity as Record<string, unknown>).tracking_boundary_sha256 = await sha256Hex(canonicalStringify(boundary));
  for (const event of value.events as Record<string, unknown>[]) { const record = event.record; event.record_sha256 = await sha256Hex(canonicalStringify(record)); }
  delete value.body_sha256;
  value.body_sha256 = await sha256Hex(canonicalStringify(value));
  return new TextEncoder().encode(canonicalStringify(value));
}
export async function fixture(sequence = 1, acknowledged = 0, events: readonly unknown[] = []) {
  return parseTelemetryV2(await signFixture(unsignedFixture(sequence, acknowledged, events)));
}
