export interface Env {
  EXECUTION_DB: D1Database;
  CANDIDATE_INBOX: DurableObjectNamespace;
  ACCOUNT_COORDINATOR: DurableObjectNamespace;
  CANDIDATE_INBOX_ENABLED: "false";
  AGENT_SYNC_ENABLED: "false";
  EXECUTION_AUTHORITY_ENABLED: "false";
  EXECUTION_MODE_CEILING: "DRY_RUN";
  ROUTING_MANIFEST_SHA256: "INERT_NOT_CONFIGURED";
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

function isInertConfiguration(env: Env): boolean {
  return (
    env.CANDIDATE_INBOX_ENABLED === INERT_CONFIGURATION.CANDIDATE_INBOX_ENABLED
    && env.AGENT_SYNC_ENABLED === INERT_CONFIGURATION.AGENT_SYNC_ENABLED
    && env.EXECUTION_AUTHORITY_ENABLED === INERT_CONFIGURATION.EXECUTION_AUTHORITY_ENABLED
    && env.EXECUTION_MODE_CEILING === INERT_CONFIGURATION.EXECUTION_MODE_CEILING
    && env.ROUTING_MANIFEST_SHA256 === INERT_CONFIGURATION.ROUTING_MANIFEST_SHA256
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
    if (!isInertConfiguration(env)) {
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
      return json({ error: "AGENT_SYNC_DISABLED" }, 503);
    }

    return json({ error: "NOT_FOUND" }, 404);
  },
};

export default worker;
