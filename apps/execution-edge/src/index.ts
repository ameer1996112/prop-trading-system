import {
  AGENT_SYNC_MAX_BODY_BYTES,
  authenticateAgentSyncBearer,
  parseAgentSyncRequest,
} from "./agent-sync-v1";
import type { AgentSyncRequestV1 } from "./agent-sync-v1";
import { AccountCoordinatorV1 } from "./account-coordinator-v1";
import { projectAcceptedHeartbeatV1 } from "./agent-health-projection-v1";
import { canonicalStringify, sha256Hex } from "./canonical";

export interface Env {
  EXECUTION_DB: D1Database;
  CANDIDATE_INBOX: DurableObjectNamespace;
  ACCOUNT_COORDINATOR: DurableObjectNamespace;
  CANDIDATE_INBOX_ENABLED: "false";
  AGENT_SYNC_ENABLED: "false" | "true";
  EXECUTION_AUTHORITY_ENABLED: "false";
  EXECUTION_MODE_CEILING: "DRY_RUN";
  ROUTING_MANIFEST_SHA256: "INERT_NOT_CONFIGURED";
  AGENT_SYNC_SHARED_SECRET_SHA256?: string;
}

const INERT_CONFIGURATION = {
  CANDIDATE_INBOX_ENABLED: "false",
  AGENT_SYNC_ENABLED: "false",
  EXECUTION_AUTHORITY_ENABLED: "false",
  EXECUTION_MODE_CEILING: "DRY_RUN",
  ROUTING_MANIFEST_SHA256: "INERT_NOT_CONFIGURED",
} as const;

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
    },
  });
}

function dryRunFailure(error: string, status: number): Response {
  return json({ error, mode: "DRY_RUN", command: null }, status);
}

function syncAuditStatement(
  env: Env,
  request: AgentSyncRequestV1,
  resultCode: string,
  serverSequence: number | null,
  receivedAtEpoch: number,
): D1PreparedStatement {
  return env.EXECUTION_DB.prepare(
    "INSERT INTO agent_sync_audit_v1 (audit_id, account_id, installation_id, request_sequence, request_body_sha256, result_code, server_sequence, received_at_epoch) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).bind(
    crypto.randomUUID(),
    request.account_id,
    request.installation_id,
    request.request_sequence,
    request.body_sha256,
    resultCode,
    serverSequence,
    receivedAtEpoch,
  );
}

async function writeSyncAudit(
  env: Env,
  request: AgentSyncRequestV1,
  resultCode: string,
  serverSequence: number | null,
  receivedAtEpoch: number,
): Promise<void> {
  await syncAuditStatement(env, request, resultCode, serverSequence, receivedAtEpoch).run();
}

async function writeAcceptedSyncAuditAndHealth(
  env: Env,
  request: AgentSyncRequestV1,
  serverSequence: number,
  receivedAtEpoch: number,
): Promise<void> {
  const health = projectAcceptedHeartbeatV1(request, serverSequence, receivedAtEpoch);
  const healthStatement = env.EXECUTION_DB.prepare(
    "INSERT INTO agent_health_current_v1 (account_id, installation_id, last_accepted_epoch, request_sequence, server_sequence, terminal_build, source_symbol, terminal_connection_state, account_trade_permission, terminal_trade_permission, algo_trading_permission) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(account_id, installation_id) DO UPDATE SET last_accepted_epoch = excluded.last_accepted_epoch, request_sequence = excluded.request_sequence, server_sequence = excluded.server_sequence, terminal_build = excluded.terminal_build, source_symbol = excluded.source_symbol, terminal_connection_state = excluded.terminal_connection_state, account_trade_permission = excluded.account_trade_permission, terminal_trade_permission = excluded.terminal_trade_permission, algo_trading_permission = excluded.algo_trading_permission",
  ).bind(
    health.account_id,
    health.installation_id,
    health.last_accepted_epoch,
    health.request_sequence,
    health.server_sequence,
    health.terminal_build,
    health.source_symbol,
    health.terminal_connection_state,
    health.account_trade_permission,
    health.terminal_trade_permission,
    health.algo_trading_permission,
  );
  await env.EXECUTION_DB.batch([
    syncAuditStatement(env, request, "ACCEPTED", serverSequence, receivedAtEpoch),
    healthStatement,
  ]);
}

const AGENT_SYNC_RESPONSE_KEYS = [
  "schema_version", "response_body_sha256", "server_sequence", "server_time_epoch", "mode",
  "freeze_reasons", "acknowledged_event_sequence", "evidence_requests", "command",
] as const;
const SHA256 = /^[a-f0-9]{64}$/u;

async function validateCoordinatorResponse(
  responseBytes: string,
  expectedServerSequence: number,
  minimumAcknowledgedEventSequence: number,
): Promise<Readonly<{ server_sequence: number }> | null> {
  try {
    const value = JSON.parse(responseBytes) as Record<string, unknown>;
    if (value === null || Array.isArray(value) || typeof value !== "object") return null;
    const actualKeys = Object.keys(value).sort();
    const expectedKeys = [...AGENT_SYNC_RESPONSE_KEYS].sort();
    if (actualKeys.length !== expectedKeys.length || actualKeys.some((key, index) => key !== expectedKeys[index])) return null;
    if (value.schema_version !== "AgentSyncResponseV1" || value.mode !== "DRY_RUN" || value.command !== null) return null;
    if (typeof value.response_body_sha256 !== "string" || !SHA256.test(value.response_body_sha256) || value.response_body_sha256 === "0".repeat(64)) return null;
    if (value.server_sequence !== expectedServerSequence || !Number.isSafeInteger(value.server_sequence) || value.server_sequence < 1) return null;
    if (typeof value.server_time_epoch !== "number" || !Number.isSafeInteger(value.server_time_epoch) || value.server_time_epoch < 0) return null;
    if (typeof value.acknowledged_event_sequence !== "number" || !Number.isSafeInteger(value.acknowledged_event_sequence)
      || value.acknowledged_event_sequence < minimumAcknowledgedEventSequence) return null;
    if (!Array.isArray(value.freeze_reasons) || value.freeze_reasons.length !== 0 || !Array.isArray(value.evidence_requests) || value.evidence_requests.length !== 0) return null;
    if (responseBytes !== canonicalStringify(value)) return null;
    const { response_body_sha256: digest, ...body } = value;
    return await sha256Hex(canonicalStringify(body)) === digest ? { server_sequence: value.server_sequence } : null;
  } catch {
    return null;
  }
}

async function rejectOversizedBody(body: ReadableStream<Uint8Array> | null): Promise<never> {
  await body?.cancel("AGENT_SYNC_BODY_TOO_LARGE");
  throw new Error("AGENT_SYNC_BODY_TOO_LARGE");
}

async function readBoundedAgentSyncBody(request: Request): Promise<Uint8Array> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null && /^[0-9]+$/u.test(contentLength) && Number(contentLength) > AGENT_SYNC_MAX_BODY_BYTES) {
    return rejectOversizedBody(request.body);
  }
  if (request.body === null) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value === undefined || value.byteLength > AGENT_SYNC_MAX_BODY_BYTES - total) {
        await reader.cancel("AGENT_SYNC_BODY_TOO_LARGE");
        throw new Error("AGENT_SYNC_BODY_TOO_LARGE");
      }
      chunks.push(value);
      total += value.byteLength;
    }
  } catch (error) {
    await reader.cancel(error).catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function isSafeConfiguration(env: Env): boolean {
  return (
    env.CANDIDATE_INBOX_ENABLED === INERT_CONFIGURATION.CANDIDATE_INBOX_ENABLED
    && env.EXECUTION_AUTHORITY_ENABLED === INERT_CONFIGURATION.EXECUTION_AUTHORITY_ENABLED
    && env.EXECUTION_MODE_CEILING === INERT_CONFIGURATION.EXECUTION_MODE_CEILING
    && env.ROUTING_MANIFEST_SHA256 === INERT_CONFIGURATION.ROUTING_MANIFEST_SHA256
    && (env.AGENT_SYNC_ENABLED === "false" || env.AGENT_SYNC_ENABLED === "true")
  );
}

export class CandidateInbox {
  constructor(_state: DurableObjectState, _env: Env) {}

  fetch(): Response {
    return json({ error: "FOUNDATION_ONLY" }, 503);
  }
}

export class AccountCoordinator extends AccountCoordinatorV1 {
  constructor(state: DurableObjectState, _env: Env) {
    super(state);
  }
}

async function coordinatorResponse(
  env: Env,
  accountId: string,
  request: Request,
): Promise<Response> {
  const id = env.ACCOUNT_COORDINATOR.idFromName(accountId);
  return env.ACCOUNT_COORDINATOR.get(id).fetch(request);
}

const worker: ExportedHandler<Env> = {
  async fetch(request, env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (!isSafeConfiguration(env)) {
      if (pathname === "/api/v1/agent/sync" || pathname === "/api/v1/agent/sync/status") {
        return dryRunFailure("UNSAFE_CONFIGURATION", 500);
      }
      return json({ error: "UNSAFE_CONFIGURATION" }, 500);
    }

    if (request.method === "GET" && pathname === "/health/live") {
      const agentSyncEnabled = env.AGENT_SYNC_ENABLED === "true";
      return json({
        ok: true,
        service: "prop-trading-execution-edge",
        mode: agentSyncEnabled ? "DRY_RUN_AGENT_SYNC" : "INERT_FOUNDATION",
        candidate_inbox: "DISABLED",
        agent_sync: agentSyncEnabled ? "ENABLED" : "DISABLED",
        execution_authority: "DISABLED",
        execution_mode_ceiling: "DRY_RUN",
      }, 200);
    }

    if (pathname === "/api/v1/agent/sync/status") {
      if (env.AGENT_SYNC_ENABLED !== "true") {
        return dryRunFailure("AGENT_SYNC_DISABLED", 503);
      }
      if (request.method !== "GET") {
        return dryRunFailure("METHOD_NOT_ALLOWED", 405);
      }
      if (!await authenticateAgentSyncBearer(request.headers.get("authorization"), env.AGENT_SYNC_SHARED_SECRET_SHA256)) {
        return dryRunFailure("UNAUTHORIZED", 401);
      }
      const accountId = new URL(request.url).searchParams.get("account_id");
      if (accountId === null || accountId.length === 0) return dryRunFailure("AGENT_SYNC_INVALID", 400);
      try {
        const response = await coordinatorResponse(env, accountId, new Request("https://account-coordinator.internal/status"));
        if (!response.ok) return dryRunFailure("COORDINATOR_UNAVAILABLE", 503);
        const status = await response.json() as Readonly<{ mode?: unknown; last_request_sequence?: unknown }>;
        if (status.mode !== "DRY_RUN" || typeof status.last_request_sequence !== "number"
          || !Number.isSafeInteger(status.last_request_sequence) || status.last_request_sequence < 0) {
          return dryRunFailure("COORDINATOR_UNAVAILABLE", 503);
        }
        return json({ mode: "DRY_RUN", last_request_sequence: status.last_request_sequence }, 200);
      } catch {
        return dryRunFailure("COORDINATOR_UNAVAILABLE", 503);
      }
    }

    if (pathname === "/api/v1/agent/sync") {
      if (env.AGENT_SYNC_ENABLED !== "true") return dryRunFailure("AGENT_SYNC_DISABLED", 503);
      if (request.method !== "POST") return dryRunFailure("METHOD_NOT_ALLOWED", 405);
      if (!await authenticateAgentSyncBearer(request.headers.get("authorization"), env.AGENT_SYNC_SHARED_SECRET_SHA256)) {
        return dryRunFailure("UNAUTHORIZED", 401);
      }
      const nowEpoch = Math.floor(Date.now() / 1000);
      let parsed: AgentSyncRequestV1;
      let bodyBytes: Uint8Array | undefined;
      try {
        bodyBytes = await readBoundedAgentSyncBody(request);
        parsed = await parseAgentSyncRequest(bodyBytes, { nowEpoch });
      } catch (error) {
        console.warn("agent_sync_parse_rejected", {
          body_bytes: bodyBytes?.byteLength ?? null,
          body_sha256: bodyBytes === undefined ? null : await sha256Hex(bodyBytes),
          reason: error instanceof Error ? error.message : "UNKNOWN",
        });
        return dryRunFailure("AGENT_SYNC_INVALID", 400);
      }
      try {
        const response = await coordinatorResponse(env, parsed.account_id, new Request("https://account-coordinator.internal/sync", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: canonicalStringify({ request: parsed, now_epoch: nowEpoch }),
        }));
        if (!response.ok) return dryRunFailure("COORDINATOR_UNAVAILABLE", 503);
        const result = await response.json() as Readonly<{ code?: string; replayed?: unknown; response_bytes?: unknown }>;
        const minimumAcknowledgedEventSequence = parsed.events.reduce(
          (maximum, event) => Math.max(maximum, event.sequence as number),
          0,
        );
        const validResponse = result.code === "OK" && typeof result.response_bytes === "string"
          ? await validateCoordinatorResponse(result.response_bytes, parsed.request_sequence, minimumAcknowledgedEventSequence)
          : null;
        const outcome = result.code === "OK"
          ? result.replayed === false ? "ACCEPTED" : result.replayed === true ? "EXACT_RETRY" : null
          : result.code === "REPLAY_CONFLICT" || result.code === "SEQUENCE_INVALID" || result.code === "IDENTITY_MISMATCH" || result.code === "STALE_TIMESTAMP"
            ? result.code
            : null;
        const serverSequence = validResponse?.server_sequence ?? null;
        if (outcome === null || (result.code === "OK" && validResponse === null)) {
          return dryRunFailure("COORDINATOR_UNAVAILABLE", 503);
        }
        try {
          if (outcome === "ACCEPTED" && serverSequence !== null) {
            await writeAcceptedSyncAuditAndHealth(env, parsed, serverSequence, nowEpoch);
          } else {
            await writeSyncAudit(env, parsed, outcome, serverSequence, nowEpoch);
          }
        } catch {
          return dryRunFailure("AGENT_SYNC_AUDIT_UNAVAILABLE", 503);
        }
        if (result.code === "REPLAY_CONFLICT") return dryRunFailure("REPLAY_CONFLICT", 409);
        if (result.code === "STALE_TIMESTAMP") return dryRunFailure("AGENT_SYNC_TIMESTAMP_INVALID", 400);
        if (result.code !== "OK" || typeof result.response_bytes !== "string") {
          return dryRunFailure("AGENT_SYNC_CONFLICT", 409);
        }
        return new Response(result.response_bytes, {
          status: 200,
          headers: { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" },
        });
      } catch {
        return dryRunFailure("COORDINATOR_UNAVAILABLE", 503);
      }
    }

    return json({ error: "NOT_FOUND" }, 404);
  },
};

export default worker;
