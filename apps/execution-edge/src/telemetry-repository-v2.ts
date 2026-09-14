import { canonicalStringify, sha256Hex } from './canonical';
import { decideAdmissionV2, type AcceptedStateV2, type ReceiptMetaV2 } from './telemetry-admission-v2';
import { deriveCoverageV2 } from './telemetry-coverage-v2';
import { projectDealV2 } from './telemetry-journal-projection-v2';
import { readCounterV2, readDigestV2 } from './telemetry-values-v2';
import { readIdentityV2, readRegistrationV2, responseBytesV2, validateResponseV2, type TelemetryRequestV2 } from './telemetry-wire-v2';

export const SESSION_SQL_V2 = `SELECT scope, identity_json, registration_json, last_request_sequence, last_event_sequence
FROM telemetry_session_v2 WHERE account_id = ?`;
export const RECEIPT_SQL_V2 = `SELECT request_digest, response_bytes, accepted_at, acknowledged_events
FROM telemetry_receipt_v2 WHERE scope = ? AND request_sequence = ?`;
export const JOURNAL_SQL_V2 = `SELECT sequence, event_json, projection_json
FROM telemetry_event_v2 WHERE scope = ? AND sequence < ? ORDER BY sequence DESC LIMIT 50`;

type Row = Record<string, unknown>;
type Loaded = Readonly<{ state: AcceptedStateV2 | null; receipt: ReceiptMetaV2 | null }>;
const encoder = new TextEncoder();
function reject(code: string): never { throw new Error(code); }
function boundedEvents(events: unknown): void {
  if (!Array.isArray(events)) reject('TELEMETRY_INVALID');
  if (events.length > 32) reject('TELEMETRY_TOO_LARGE');
}
function storedText(value: unknown): string {
  if (typeof value !== 'string') reject('TELEMETRY_STORAGE_UNAVAILABLE');
  return value;
}
function successful<T>(results: D1Result<T>[], count: number): void {
  if (results.length !== count || results.some((result) => !result.success || !Array.isArray(result.results))) reject('TELEMETRY_STORAGE_UNAVAILABLE');
}
export function scopeV2(request: TelemetryRequestV2): Promise<string> {
  return sha256Hex(canonicalStringify(request.identity));
}

// Read current identity and the exact historical receipt in a single snapshot.
async function loadV2(db: D1Database, request: TelemetryRequestV2, scope: string): Promise<Loaded> {
  try {
    const results = await db.batch<Row>([
      db.prepare(SESSION_SQL_V2).bind(request.identity.account_id),
      db.prepare(RECEIPT_SQL_V2).bind(scope, request.request_sequence),
    ]);
    successful(results, 2);
    const sessionRows = results[0]!.results, receiptRows = results[1]!.results;
    if (sessionRows.length > 1 || receiptRows.length > 1) reject('TELEMETRY_STORAGE_UNAVAILABLE');
    const session = sessionRows[0], receiptRow = receiptRows[0];
    let state: AcceptedStateV2 | null = null;
    if (session !== undefined) {
      const identity = readIdentityV2(JSON.parse(storedText(session.identity_json)) as unknown);
      const identityJson = canonicalStringify(identity);
      const registrationJson = canonicalStringify(readRegistrationV2(JSON.parse(storedText(session.registration_json)) as unknown));
      if (session.scope !== await sha256Hex(identityJson) || session.identity_json !== identityJson || session.registration_json !== registrationJson) reject('TELEMETRY_STORAGE_UNAVAILABLE');
      if (session.scope !== scope || identityJson !== canonicalStringify(request.identity) || registrationJson !== canonicalStringify(request.registration)) reject('IDENTITY_MISMATCH');
      state = { identity, last_request_sequence: readCounterV2(session.last_request_sequence, 1), last_event_sequence: readCounterV2(session.last_event_sequence) };
    }
    let receipt: ReceiptMetaV2 | null = null;
    if (receiptRow !== undefined) {
      if (state === null) reject('TELEMETRY_STORAGE_UNAVAILABLE');
      const digest = readDigestV2(receiptRow.request_digest);
      const bytes = storedText(receiptRow.response_bytes);
      const acceptedAt = readCounterV2(receiptRow.accepted_at, 1);
      const ack = readCounterV2(receiptRow.acknowledged_events);
      if (ack > state.last_event_sequence) reject('TELEMETRY_STORAGE_UNAVAILABLE');
      // A different digest belongs to replay-conflict admission, not validation
      // of that other request's response against this request.
      if (digest === request.body_sha256) {
        await validateResponseV2(encoder.encode(bytes), request);
        const response = JSON.parse(bytes) as Record<string, unknown>;
        if (response.accepted_at_utc_seconds !== acceptedAt || response.acknowledged_event_sequence !== ack) reject('TELEMETRY_STORAGE_UNAVAILABLE');
      }
      receipt = { identity: state.identity, request_sequence: request.request_sequence, request_body_sha256: digest, response_bytes: bytes };
    }
    return { state, receipt };
  } catch (error) {
    if (error instanceof Error && error.message === 'IDENTITY_MISMATCH') throw error;
    return reject('TELEMETRY_STORAGE_UNAVAILABLE');
  }
}

export function statementsV2(
  db: D1Database, request: TelemetryRequestV2, scope: string, previous: number,
  ack: number, now: number, response: string,
): D1PreparedStatement[] {
  boundedEvents(request.events);
  const coverage = deriveCoverageV2({ started: true, ...request.collection, acknowledged_events: ack });
  const latest = canonicalStringify({ account_attempt: request.account, exposure_attempt: request.exposure, collection: request.collection, diagnostics: request.diagnostics, coverage });
  const events = canonicalStringify(request.events.map((event) => ({
    sequence: event.sequence, event_id: event.event_id, kind: event.record.kind,
    deal_id: event.record.kind === 'DEAL' ? event.record.deal_id : null,
    revision: event.record.kind === 'DEAL' ? event.record.revision : null,
    previous_digest: event.record.kind === 'DEAL' ? event.record.previous_record_sha256 : null,
    record_digest: event.record_sha256, event_json: canonicalStringify(event),
    projection_json: event.record.kind === 'DEAL' ? canonicalStringify(projectDealV2(event.record, request.registration)) : null,
  })));
  return [
    db.prepare(`INSERT INTO telemetry_session_v2
      (account_id, scope, identity_json, registration_json, last_request_sequence, last_event_sequence, request_digest, accepted_at, latest_json, account_json, exposure_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(account_id) DO UPDATE SET
        last_request_sequence = CASE WHEN telemetry_session_v2.last_request_sequence = ?
          AND telemetry_session_v2.scope = excluded.scope AND telemetry_session_v2.registration_json = excluded.registration_json
          THEN excluded.last_request_sequence ELSE 0 END,
        last_event_sequence = excluded.last_event_sequence, request_digest = excluded.request_digest,
        accepted_at = excluded.accepted_at, latest_json = excluded.latest_json,
        account_json = COALESCE(excluded.account_json, telemetry_session_v2.account_json),
        exposure_json = COALESCE(excluded.exposure_json, telemetry_session_v2.exposure_json)`)
      .bind(request.identity.account_id, scope, canonicalStringify(request.identity), canonicalStringify(request.registration), request.request_sequence, ack, request.body_sha256, now, latest,
        request.account.status === 'COMPLETE' ? canonicalStringify(request.account) : null,
        request.exposure.status === 'COMPLETE' ? canonicalStringify(request.exposure) : null, previous),
    db.prepare(`INSERT INTO telemetry_receipt_v2 (scope, request_sequence, request_digest, response_bytes, accepted_at, acknowledged_events)
      VALUES (?, ?, ?, ?, ?, ?)`).bind(scope, request.request_sequence, request.body_sha256, response, now, ack),
    db.prepare(`INSERT INTO telemetry_event_v2 (scope, sequence, event_id, kind, deal_id, revision, previous_digest, record_digest, event_json, projection_json)
      SELECT ?, json_extract(value, '$.sequence'), json_extract(value, '$.event_id'), json_extract(value, '$.kind'),
        json_extract(value, '$.deal_id'), json_extract(value, '$.revision'), json_extract(value, '$.previous_digest'),
        json_extract(value, '$.record_digest'), json_extract(value, '$.event_json'), json_extract(value, '$.projection_json')
      FROM json_each(?)`).bind(scope, events),
    db.prepare(`INSERT INTO telemetry_deal_current_v2 (scope, deal_id, sequence, revision, record_digest)
      SELECT ?, json_extract(value, '$.deal_id'), json_extract(value, '$.sequence'), json_extract(value, '$.revision'), json_extract(value, '$.record_digest')
      FROM json_each(?) WHERE json_extract(value, '$.kind') = 'DEAL'
      ON CONFLICT(scope, deal_id) DO UPDATE SET sequence = excluded.sequence, revision = excluded.revision, record_digest = excluded.record_digest`).bind(scope, events),
  ];
}

function admission(loaded: Loaded, request: TelemetryRequestV2, now: number) {
  return decideAdmissionV2(loaded.state, loaded.receipt, {
    identity: request.identity, request_sequence: request.request_sequence,
    body_sha256: request.body_sha256, event_sequences: request.events.map((event) => event.sequence),
    fresh: Math.abs(now - request.sent_at_utc_seconds) <= 30,
  });
}

async function committedBytes(db: D1Database, request: TelemetryRequestV2, scope: string, now: number): Promise<string> {
  const result = admission(await loadV2(db, request, scope), request, now);
  if (result.kind === 'REPLAY') return result.response_bytes;
  if (result.kind === 'REJECT' && result.code === 'REPLAY_CONFLICT') reject(result.code);
  return reject('TELEMETRY_STORAGE_UNAVAILABLE');
}

// Authentication and pinned-account checks belong to the caller. No accepted
// response leaves this boundary until the authoritative receipt is reloaded.
export async function acceptTelemetryV2(db: D1Database, request: TelemetryRequestV2, now: number): Promise<string> {
  boundedEvents(request.events);
  readCounterV2(now, 1);
  const scope = await scopeV2(request);
  const loaded = await loadV2(db, request, scope);
  const result = admission(loaded, request, now);
  if (result.kind === 'REJECT') reject(result.code);
  if (result.kind === 'REPLAY') return result.response_bytes;
  if (request.last_acknowledged_event_sequence !== (loaded.state?.last_event_sequence ?? 0)) reject('EVENT_SEQUENCE_INVALID');
  const ack = result.event_sequence_if_committed;
  const response = await responseBytesV2(request, ack, now);
  await validateResponseV2(encoder.encode(response), request);
  const statements = statementsV2(db, request, scope, loaded.state?.last_request_sequence ?? 0, ack, now, response);
  try { successful(await db.batch(statements), 4); }
  catch { return committedBytes(db, request, scope, now); }
  return committedBytes(db, request, scope, now);
}
