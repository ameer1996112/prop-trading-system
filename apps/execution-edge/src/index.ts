import {
  AGENT_SYNC_MAX_BODY_BYTES,
  authenticateAgentSyncBearer,
  parseAgentSyncRequest,
} from "./agent-sync-v1";
import type { AgentSyncRequestV1 } from "./agent-sync-v1";
import { AccountCoordinatorV1 } from "./account-coordinator-v1";
import { canonicalStringify } from "./canonical";

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

async function writeAgentSyncAudit(
  env: Env,
  request: AgentSyncRequestV1,
  resultCode: string,
  serverSequence: number | null,
  receivedAtEpoch: number,
): Promise<void> {
  await env.EXECUTION_DB.prepare(
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
  ).run();
}

function responseServerSequence(responseBytes: string): number | null {
  try {
    const value = JSON.parse(responseBytes) as Readonly<{ server_sequence?: unknown }>;
    return typeof value.server_sequence === "number" && Number.isSafeInteger(value.server_sequence) && value.server_sequence > 0
      ? value.server_sequence
      : null;
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
    if (!isSafeConfiguration(env)) {
      return json({ error: "UNSAFE_CONFIGURATION" }, 500);
    }

    const { pathname } = new URL(request.url);
    if (request.method === "GET" && pathname === "/health/live") {
      return json({
        ok: true,
        service: "prop-trading-execution-edge",
        mode: "INERT_FOUNDATION",
        candidate_inbox: "DISABLED",
        agent_sync: "DISABLED",
        execution_authority: "DISABLED",
        execution_mode_ceiling: "DRY_RUN",
      }, 200);
    }

    if (pathname === "/api/v1/agent/sync/status") {
      if (env.AGENT_SYNC_ENABLED !== "true") {
        return json({ error: "AGENT_SYNC_DISABLED" }, 503);
      }
      if (request.method !== "GET") {
        return json({ error: "METHOD_NOT_ALLOWED" }, 405);
      }
      if (!await authenticateAgentSyncBearer(request.headers.get("authorization"), env.AGENT_SYNC_SHARED_SECRET_SHA256)) {
        return json({ error: "UNAUTHORIZED" }, 401);
      }
      const accountId = new URL(request.url).searchParams.get("account_id");
      if (accountId === null || accountId.length === 0) return json({ error: "AGENT_SYNC_INVALID" }, 400);
      try {
        const response = await coordinatorResponse(env, accountId, new Request("https://account-coordinator.internal/status"));
        if (!response.ok) return json({ error: "COORDINATOR_UNAVAILABLE" }, 503);
        const status = await response.json() as Readonly<{ mode?: unknown; last_request_sequence?: unknown }>;
        if (status.mode !== "DRY_RUN" || typeof status.last_request_sequence !== "number"
          || !Number.isSafeInteger(status.last_request_sequence) || status.last_request_sequence < 0) {
          return json({ error: "COORDINATOR_UNAVAILABLE" }, 503);
        }
        return json({ mode: "DRY_RUN", last_request_sequence: status.last_request_sequence }, 200);
      } catch {
        return json({ error: "COORDINATOR_UNAVAILABLE" }, 503);
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
      try {
        parsed = await parseAgentSyncRequest(await readBoundedAgentSyncBody(request), { nowEpoch });
      } catch {
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
        const outcome = result.code === "OK"
          ? result.replayed === true ? "EXACT_RETRY" : "ACCEPTED"
          : result.code === "REPLAY_CONFLICT" || result.code === "SEQUENCE_INVALID" || result.code === "IDENTITY_MISMATCH"
            ? result.code
            : null;
        const serverSequence = typeof result.response_bytes === "string" ? responseServerSequence(result.response_bytes) : null;
        if (outcome === null || (result.code === "OK" && serverSequence === null)) {
          return dryRunFailure("COORDINATOR_UNAVAILABLE", 503);
        }
        try {
          await writeAgentSyncAudit(env, parsed, outcome, serverSequence, nowEpoch);
        } catch {
          return dryRunFailure("AGENT_SYNC_AUDIT_UNAVAILABLE", 503);
        }
        if (result.code === "REPLAY_CONFLICT") return dryRunFailure("REPLAY_CONFLICT", 409);
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
