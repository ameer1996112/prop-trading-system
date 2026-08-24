import {
  AGENT_SYNC_MAX_BODY_BYTES,
  authenticateAgentSyncBearer,
  createDryRunResponse,
  parseAgentSyncRequest,
} from "./agent-sync-v1";

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

export class AccountCoordinator {
  constructor(_state: DurableObjectState, _env: Env) {}

  fetch(): Response {
    return json({ error: "FOUNDATION_ONLY" }, 503);
  }
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

    if (pathname === "/api/v1/agent/sync") {
      if (env.AGENT_SYNC_ENABLED !== "true") {
        return json({ error: "AGENT_SYNC_DISABLED" }, 503);
      }
      if (request.method !== "POST") {
        return json({ error: "METHOD_NOT_ALLOWED" }, 405);
      }
      if (!await authenticateAgentSyncBearer(request.headers.get("authorization"), env.AGENT_SYNC_SHARED_SECRET_SHA256)) {
        return json({ error: "UNAUTHORIZED" }, 401);
      }
      try {
        const parsed = await parseAgentSyncRequest(await readBoundedAgentSyncBody(request), {
          nowEpoch: Math.floor(Date.now() / 1000),
        });
        if (parsed.last_acknowledged_server_sequence >= Number.MAX_SAFE_INTEGER) {
          return json({ error: "AGENT_SYNC_INVALID" }, 400);
        }
        return json(
          await createDryRunResponse(
            parsed,
            parsed.last_acknowledged_server_sequence + 1,
            Math.floor(Date.now() / 1000),
          ),
          200,
        );
      } catch {
        return json({ error: "AGENT_SYNC_INVALID" }, 400);
      }
    }

    return json({ error: "NOT_FOUND" }, 404);
  },
};

export default worker;
