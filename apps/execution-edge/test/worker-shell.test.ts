import { describe, expect, it } from "vitest";

import worker, { AccountCoordinator, CandidateInbox, type Env } from "../src/index";

const inertEnv = {
  CANDIDATE_INBOX_ENABLED: "false",
  AGENT_SYNC_ENABLED: "false",
  EXECUTION_AUTHORITY_ENABLED: "false",
  EXECUTION_MODE_CEILING: "DRY_RUN",
  ROUTING_MANIFEST_SHA256: "INERT_NOT_CONFIGURED",
} as Env;

async function responseFor(path: string, init?: RequestInit, env: Env = inertEnv): Promise<Response> {
  const request = new Request(`https://execution-edge.example${path}`, init);
  const fetch = worker.fetch as unknown as (
    incomingRequest: typeof request,
    env: Env,
    context: ExecutionContext,
  ) => Promise<Response>;

  return fetch(request, env, {} as ExecutionContext);
}

describe("inert execution Worker shell", () => {
  it("returns the exact inert health status only for GET /health/live", async () => {
    const response = await responseFor("/health/live");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      service: "prop-trading-execution-edge",
      mode: "INERT_FOUNDATION",
      candidate_inbox: "DISABLED",
      agent_sync: "DISABLED",
      execution_authority: "DISABLED",
      execution_mode_ceiling: "DRY_RUN",
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");

    const nonGetResponse = await responseFor("/health/live", { method: "POST" });
    expect(nonGetResponse.status).toBe(404);
    expect(await nonGetResponse.json()).toEqual({ error: "NOT_FOUND" });
  });

  it("reports an enabled heartbeat without changing the execution safety state", async () => {
    const syncEnabledEnv = { ...inertEnv, AGENT_SYNC_ENABLED: "true" } as Env;

    const response = await responseFor("/health/live", undefined, syncEnabledEnv);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      service: "prop-trading-execution-edge",
      mode: "DRY_RUN_AGENT_SYNC",
      candidate_inbox: "DISABLED",
      agent_sync: "ENABLED",
      execution_authority: "DISABLED",
      execution_mode_ceiling: "DRY_RUN",
    });
  });

  it.each(["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])(
    "fails closed for %s on the agent sync route",
    async (method) => {
      const response = await responseFor("/api/v1/agent/sync", { method });

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: "AGENT_SYNC_DISABLED", mode: "DRY_RUN", command: null });
    },
  );

  it("returns not found for every other route", async () => {
    const response = await responseFor("/other");

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "NOT_FOUND" });
  });

  it("exports inert Durable Object constructors", async () => {
    expect(CandidateInbox).toEqual(expect.any(Function));
    expect(AccountCoordinator).toEqual(expect.any(Function));

    const inboxResponse = await new CandidateInbox(
      null as unknown as DurableObjectState,
      inertEnv,
    ).fetch();
    const coordinatorResponse = await new AccountCoordinator(
      null as unknown as DurableObjectState,
      inertEnv,
    ).fetch();

    expect(inboxResponse.status).toBe(503);
    expect(await inboxResponse.json()).toEqual({ error: "FOUNDATION_ONLY" });
    expect(coordinatorResponse.status).toBe(503);
    expect(await coordinatorResponse.json()).toEqual({ error: "FOUNDATION_ONLY", mode: "DRY_RUN", command: null });
  });

  it("returns unsafe configuration when an inert value differs", async () => {
    const unsafeEnv = {
      ...inertEnv,
      EXECUTION_AUTHORITY_ENABLED: "true",
    } as unknown as Env;

    const response = await responseFor("/health/live", undefined, unsafeEnv);

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "UNSAFE_CONFIGURATION" });
  });
});
