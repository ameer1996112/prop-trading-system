import { authenticateAgentSyncBearer } from './agent-sync-v1';
import { canonicalStringify } from './canonical';
import { boundedBody, parseTelemetryV2, validateResponseV2, type TelemetryRequestV2 } from './telemetry-wire-v2';

export interface TelemetryHttpEnvV2 {
  AGENT_SYNC_ENABLED: 'true' | 'false';
  AGENT_SYNC_SHARED_SECRET_SHA256?: string;
  ACCOUNT_COORDINATOR: DurableObjectNamespace;
}

const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
const safeErrors = new Map<string, number>([
  ['IDENTITY_MISMATCH', 409], ['REPLAY_CONFLICT', 409], ['SEQUENCE_INVALID', 409], ['EVENT_SEQUENCE_INVALID', 409],
  ['TELEMETRY_V1_REGISTRATION_REQUIRED', 409], ['STALE_ENVELOPE', 400], ['TELEMETRY_UNAVAILABLE', 503],
]);

function failure(error: string, status: number): Response {
  return new Response(canonicalStringify({ error, mode: 'DRY_RUN', command: null }), { status, headers });
}

function coordinatorFailure(bytes: Uint8Array, upstreamStatus: number): Response {
  const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes));
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_COORDINATOR_ERROR');
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== 3 || !keys.every((key) => ['code', 'mode', 'command'].includes(key))
    || typeof record.code !== 'string' || record.mode !== 'DRY_RUN' || record.command !== null) throw new Error('INVALID_COORDINATOR_ERROR');
  const status = safeErrors.get(record.code);
  if (status === undefined || status !== upstreamStatus) throw new Error('INVALID_COORDINATOR_ERROR');
  return failure(record.code, status);
}

export async function handleTelemetryV2(request: Request, env: TelemetryHttpEnvV2): Promise<Response> {
  if (env.AGENT_SYNC_ENABLED !== 'true') return failure('AGENT_SYNC_DISABLED', 503);
  if (request.method !== 'POST') return failure('METHOD_NOT_ALLOWED', 405);
  if (!await authenticateAgentSyncBearer(request.headers.get('authorization'), env.AGENT_SYNC_SHARED_SECRET_SHA256)) return failure('UNAUTHORIZED', 401);
  if (new URL(request.url).search !== '' || request.headers.has('content-encoding')
    || !/^application\/json(?:;\s*charset=utf-8)?$/iu.test(request.headers.get('content-type') ?? '')) return failure('TELEMETRY_INVALID', 400);

  let bytes: Uint8Array;
  let parsed: TelemetryRequestV2;
  try {
    bytes = await boundedBody(request, 256 * 1024);
    parsed = await parseTelemetryV2(bytes);
  } catch (error) {
    return error instanceof Error && error.message === 'TELEMETRY_TOO_LARGE'
      ? failure('TELEMETRY_TOO_LARGE', 413) : failure('TELEMETRY_INVALID', 400);
  }

  try {
    const id = env.ACCOUNT_COORDINATOR.idFromName(parsed.identity.account_id);
    const upstream = await env.ACCOUNT_COORDINATOR.get(id).fetch(new Request('https://account-coordinator.internal/sync-v2', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: new TextDecoder().decode(bytes),
    }));
    const responseBytes = await boundedBody(upstream, 16 * 1024);
    if (upstream.status !== 200) return coordinatorFailure(responseBytes, upstream.status);
    return new Response(await validateResponseV2(responseBytes, parsed), { headers });
  } catch {
    return failure('TELEMETRY_UNAVAILABLE', 503);
  }
}
