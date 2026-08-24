import {
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
        const parsed = await parseAgentSyncRequest(new Uint8Array(await request.arrayBuffer()), {
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
