import { describe, expect, it } from "vitest";

import {
  authenticateAgentSyncBearer,
  createDryRunResponse,
  parseAgentSyncRequest,
} from "../src/agent-sync-v1";
import { canonicalStringify, sha256Hex } from "../src/canonical";
import worker, { type Env } from "../src/index";

const NOW = 1_787_472_010;
const D = (digit: string): string => digit.repeat(64);
const SECRET = "agent-sync-test-token";

const snapshot = {
  terminal_build: 4410,
  ea_sha256: D("a"),
  manifest_sha256: D("b"),
  account_fingerprint_sha256: D("c"),
  broker_time_epoch: NOW,
  windows_time_epoch: NOW,
  terminal_connection_state: "CONNECTED",
  account_trade_permission: "DENIED",
  terminal_trade_permission: "DENIED",
  algo_trading_permission: "DENIED",
  balance_minor_units: 10_000_000,
  equity_minor_units: 10_000_000,
  margin_minor_units: 0,
  free_margin_minor_units: 10_000_000,
  margin_level_bps: null,
  symbols: [{
    source_symbol: "EURUSD",
    broker_symbol: "EURUSD",
    synchronization_state: "SYNCHRONIZED",
    selection_state: "SELECTED",
    capability_state: "CURRENT",
    symbol_capability_sha256: D("f"),
    trade_mode: "FULL",
    bid_ticks: 109999,
    ask_ticks: 110001,
    observed_at_epoch: NOW,
  }],
  open_orders: [],
  positions: [],
  reconciliation_watermark: {
    watermark: "cursor-1",
    state: "STABLE",
    reconciliation_sha256: D("d"),
    history_through_epoch: NOW,
    consecutive_stable_sweeps: 1,
  },
  observed_at_epoch: NOW,
};

async function validRequest(overrides: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const withoutDigest: Record<string, unknown> = {
    schema_version: "AgentSyncRequestV1",
    installation_id: "installation-1",
    account_id: "account-1",
    account_profile_sha256: D("e"),
    safety_epoch: 7,
    request_sequence: 2,
    last_acknowledged_server_sequence: 1,
    nonce: "nonce-2",
    sent_at_epoch: NOW,
    account_snapshot: snapshot,
    events: [],
    broker_bar_evidence: [],
    ...overrides,
  };
  const { body_sha256: _ignored, ...body } = withoutDigest;
  return { ...withoutDigest, body_sha256: await sha256Hex(canonicalStringify(body)) };
}

async function validHeartbeatEvent(overrides: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const withoutDigest: Record<string, unknown> = {
    schema_version: "AgentEventV1",
    event_id: "event-1",
    installation_id: "installation-1",
    account_id: "account-1",
    account_profile_sha256: D("e"),
    safety_epoch: 7,
    sequence: 1,
    observed_at_epoch: NOW,
    kind: "HEARTBEAT",
    fact: {
      terminal_connection_state: "CONNECTED",
      account_trade_permission: "DENIED",
      terminal_trade_permission: "DENIED",
      algo_trading_permission: "DENIED",
      broker_time_epoch: NOW,
      windows_time_epoch: NOW,
    },
    ...overrides,
  };
  const { body_sha256: _ignored, ...body } = withoutDigest;
  return { ...withoutDigest, body_sha256: await sha256Hex(canonicalStringify(body)) };
}

async function validUnpricedExposureEvent(overrides: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const withoutDigest: Record<string, unknown> = {
    schema_version: "AgentEventV1",
    event_id: "exposure-event-1",
    installation_id: "installation-1",
    account_id: "account-1",
    account_profile_sha256: D("e"),
    safety_epoch: 7,
    sequence: 1,
    observed_at_epoch: NOW,
    kind: "UNATTRIBUTED_EXPOSURE_STATE",
    fact: {
      exposure_id: "exposure-1",
      exposure_kind: "POSITION",
      broker_ticket: 123,
      broker_symbol: "EURUSD",
      direction: "LONG",
      volume_steps: 1,
      price_ticks: null,
      pricing_state: "UNPRICED",
      modeled_loss_minor_units: null,
      protection_state: "UNKNOWN",
      state: "DISCOVERED",
    },
    ...overrides,
  };
  const { body_sha256: _ignored, ...body } = withoutDigest;
  return { ...withoutDigest, body_sha256: await sha256Hex(canonicalStringify(body)) };
}

const validOpenOrder = {
  order_ticket: 123,
  attribution_state: "UNATTRIBUTED",
  command_id: null,
  broker_request_id: null,
  state: "PENDING",
  direction: "LONG",
  broker_symbol: "EURUSD",
  requested_volume_steps: 10,
  filled_volume_steps: 0,
  residual_volume_steps: 10,
  entry_price_ticks: 110000,
  stop_ticks: 109800,
  target_ticks: 110800,
  protection_state: "UNKNOWN",
};

async function encodedRequest(overrides: Record<string, unknown> = {}): Promise<string> {
  return JSON.stringify(await validRequest(overrides));
}

async function enabledEnv(): Promise<Env> {
  return {
    CANDIDATE_INBOX_ENABLED: "false",
    AGENT_SYNC_ENABLED: "true",
    EXECUTION_AUTHORITY_ENABLED: "false",
    EXECUTION_MODE_CEILING: "DRY_RUN",
    ROUTING_MANIFEST_SHA256: "INERT_NOT_CONFIGURED",
    AGENT_SYNC_SHARED_SECRET_SHA256: await sha256Hex(SECRET),
    EXECUTION_DB: auditDatabase(),
    ACCOUNT_COORDINATOR: {
      idFromName(name: string) {
        return name;
      },
      get() {
        return {
          async fetch(request: Request): Promise<Response> {
            const body = await request.json() as { request: Parameters<typeof createDryRunResponse>[0]; now_epoch: number };
            const response = await createDryRunResponse(body.request, 1, body.now_epoch);
            return new Response(JSON.stringify({ code: "OK", response_bytes: canonicalStringify(response) }));
          },
        };
      },
    },
  } as unknown as Env;
}

type AuditRun = Readonly<{ query: string; parameters: readonly unknown[] }>;

function auditDatabase(runs: AuditRun[] = [], fail = false): D1Database {
  return {
    prepare(query: string) {
      return {
        bind(...parameters: unknown[]) {
          return {
            async run() {
              if (fail) throw new Error("audit unavailable");
              runs.push({ query, parameters });
              return { success: true };
            },
          };
        },
      };
    },
  } as unknown as D1Database;
}

async function route(body: string, authorization?: string, env?: Env): Promise<Response> {
  const request = new Request("https://execution-edge.example/api/v1/agent/sync", {
    method: "POST",
    headers: authorization === undefined ? {} : { authorization },
    body,
  });
  const fetch = worker.fetch as unknown as (
    incomingRequest: Request,
    environment: Env,
    context: ExecutionContext,
  ) => Promise<Response>;
  return fetch(request, env ?? await enabledEnv(), {} as ExecutionContext);
}

describe("AgentSyncRequestV1", () => {
  it("parses a canonical bounded request and returns a canonical dry-run response", async () => {
    const parsed = await parseAgentSyncRequest(await encodedRequest({ events: [await validHeartbeatEvent()] }), { nowEpoch: NOW });
    expect(parsed).toMatchObject({ request_sequence: 2, events: [{ sequence: 1 }] });

    const response = await createDryRunResponse(parsed, 3, NOW);
    expect(response).toEqual({
      schema_version: "AgentSyncResponseV1",
      response_body_sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      server_sequence: 3,
      server_time_epoch: NOW,
      mode: "DRY_RUN",
      freeze_reasons: [],
      acknowledged_event_sequence: 1,
      evidence_requests: [],
      command: null,
    });
    const { response_body_sha256, ...body } = response;
    expect(await sha256Hex(canonicalStringify(body))).toBe(response_body_sha256);
  });

  it("rejects unknown or duplicate JSON keys", async () => {
    await expect(parseAgentSyncRequest(await encodedRequest({ unexpected: true }), { nowEpoch: NOW }))
      .rejects.toThrow("AGENT_SYNC_INVALID");
    await expect(parseAgentSyncRequest('{"schema_version":"AgentSyncRequestV1","schema_version":"AgentSyncRequestV1"}', { nowEpoch: NOW }))
      .rejects.toThrow("AGENT_SYNC_INVALID");
  });

  it("rejects a body digest mismatch and stale timestamps", async () => {
    const wrongDigest = await validRequest();
    wrongDigest.body_sha256 = D("f");
    await expect(parseAgentSyncRequest(JSON.stringify(wrongDigest), { nowEpoch: NOW }))
      .rejects.toThrow("AGENT_SYNC_BODY_DIGEST_MISMATCH");
    await expect(parseAgentSyncRequest(await encodedRequest({ sent_at_epoch: NOW - 31 }), { nowEpoch: NOW }))
      .rejects.toThrow("AGENT_SYNC_TIMESTAMP_INVALID");
  });

  it("rejects invalid nested snapshot fields and typed heartbeat facts", async () => {
    await expect(parseAgentSyncRequest(await encodedRequest({
      account_snapshot: { ...snapshot, open_orders: [{ ...validOpenOrder, order_ticket: "123" }] },
    }), { nowEpoch: NOW })).rejects.toThrow("AGENT_SYNC_INVALID");

    const invalidHeartbeat = await validHeartbeatEvent({
      fact: {
        terminal_connection_state: "CONNECTED",
        account_trade_permission: ["DENIED"],
        terminal_trade_permission: "DENIED",
        algo_trading_permission: "DENIED",
        broker_time_epoch: NOW,
        windows_time_epoch: NOW,
      },
    });
    await expect(parseAgentSyncRequest(await encodedRequest({ events: [invalidHeartbeat] }), { nowEpoch: NOW }))
      .rejects.toThrow("AGENT_SYNC_INVALID");
  });

  it("rejects an event digest mismatch even when the enclosing body digest is valid", async () => {
    const event = await validHeartbeatEvent();
    event.body_sha256 = D("f");
    await expect(parseAgentSyncRequest(await encodedRequest({ events: [event] }), { nowEpoch: NOW }))
      .rejects.toThrow("AGENT_SYNC_EVENT_BODY_DIGEST_MISMATCH");
  });

  it("rejects numeric price and loss values for an unpriced exposure", async () => {
    const event = await validUnpricedExposureEvent({
      fact: {
        exposure_id: "exposure-1",
        exposure_kind: "POSITION",
        broker_ticket: 123,
        broker_symbol: "EURUSD",
        direction: "LONG",
        volume_steps: 1,
        price_ticks: 110000,
        pricing_state: "UNPRICED",
        modeled_loss_minor_units: 100,
        protection_state: "UNKNOWN",
        state: "DISCOVERED",
      },
    });
    await expect(parseAgentSyncRequest(await encodedRequest({ events: [event] }), { nowEpoch: NOW }))
      .rejects.toThrow("AGENT_SYNC_INVALID");

    const pricedWithoutValues = await validUnpricedExposureEvent({
      fact: {
        exposure_id: "exposure-1",
        exposure_kind: "POSITION",
        broker_ticket: 123,
        broker_symbol: "EURUSD",
        direction: "LONG",
        volume_steps: 1,
        price_ticks: null,
        pricing_state: "PRICED",
        modeled_loss_minor_units: null,
        protection_state: "UNKNOWN",
        state: "DISCOVERED",
      },
    });
    await expect(parseAgentSyncRequest(await encodedRequest({ events: [pricedWithoutValues] }), { nowEpoch: NOW }))
      .rejects.toThrow("AGENT_SYNC_INVALID");
  });

  it("accepts nullable account amounts", async () => {
    await expect(parseAgentSyncRequest(await encodedRequest({
      account_snapshot: {
        ...snapshot,
        balance_minor_units: null,
        equity_minor_units: null,
        margin_minor_units: null,
        free_margin_minor_units: null,
      },
    }), { nowEpoch: NOW })).resolves.toMatchObject({ account_snapshot: { balance_minor_units: null } });
  });

  it("authenticates a bearer token only against a configured digest", async () => {
    const configured = await sha256Hex(SECRET);
    await expect(authenticateAgentSyncBearer(`Bearer ${SECRET}`, configured)).resolves.toBe(true);
    await expect(authenticateAgentSyncBearer(undefined, configured)).resolves.toBe(false);
    await expect(authenticateAgentSyncBearer("Bearer wrong", configured)).resolves.toBe(false);
    await expect(authenticateAgentSyncBearer(`Bearer ${SECRET}`, "not-a-digest")).resolves.toBe(false);
  });
});

describe("agent sync Worker route", () => {
  it("writes bounded accepted and rejected audit rows only after parsing", async () => {
    const runs: AuditRun[] = [];
    const acceptedEnv = { ...await enabledEnv(), EXECUTION_DB: auditDatabase(runs) } as Env;
    const body = await encodedRequest({
      request_sequence: 1,
      last_acknowledged_server_sequence: 0,
      sent_at_epoch: Math.floor(Date.now() / 1000),
    });

    expect((await route(body, `Bearer ${SECRET}`, acceptedEnv)).status).toBe(200);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      query: expect.stringContaining("INSERT INTO agent_sync_audit_v1"),
      parameters: [expect.any(String), "account-1", "installation-1", 1, expect.stringMatching(/^[a-f0-9]{64}$/u), "ACCEPTED", 1, expect.any(Number)],
    });
    expect(JSON.stringify(runs[0])).not.toMatch(/price_ticks|open_orders|positions|agent-sync-test-token/u);

    const conflictRuns: AuditRun[] = [];
    const conflictEnv = {
      ...await enabledEnv(),
      EXECUTION_DB: auditDatabase(conflictRuns),
      ACCOUNT_COORDINATOR: {
        idFromName(name: string) { return name; },
        get() { return { fetch: async () => new Response(JSON.stringify({ code: "REPLAY_CONFLICT" })) }; },
      },
    } as unknown as Env;
    expect((await route(body, `Bearer ${SECRET}`, conflictEnv)).status).toBe(409);
    expect(conflictRuns[0]?.parameters.slice(5, 7)).toEqual(["REPLAY_CONFLICT", null]);
  });

  it("fails closed when audit persistence fails", async () => {
    const env = { ...await enabledEnv(), EXECUTION_DB: auditDatabase([], true) } as Env;
    const response = await route(await encodedRequest({
      request_sequence: 1,
      last_acknowledged_server_sequence: 0,
      sent_at_epoch: Math.floor(Date.now() / 1000),
    }), `Bearer ${SECRET}`, env);

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "AGENT_SYNC_AUDIT_UNAVAILABLE", mode: "DRY_RUN", command: null });
  });

  it("audits exact retries and every coordinator rejection code", async () => {
    const body = await encodedRequest({
      request_sequence: 1,
      last_acknowledged_server_sequence: 0,
      sent_at_epoch: Math.floor(Date.now() / 1000),
    });
    for (const [code, expected] of [
      ["OK", "EXACT_RETRY"],
      ["SEQUENCE_INVALID", "SEQUENCE_INVALID"],
      ["IDENTITY_MISMATCH", "IDENTITY_MISMATCH"],
      ["REPLAY_CONFLICT", "REPLAY_CONFLICT"],
    ] as const) {
      const runs: AuditRun[] = [];
      const env = {
        ...await enabledEnv(),
        EXECUTION_DB: auditDatabase(runs),
        ACCOUNT_COORDINATOR: {
          idFromName(name: string) { return name; },
          get() {
            return {
              fetch: async () => new Response(JSON.stringify(code === "OK"
                ? { code, replayed: true, response_bytes: canonicalStringify(await createDryRunResponse({ events: [] }, 1, NOW)) }
                : { code })),
            };
          },
        },
      } as unknown as Env;

      const response = await route(body, `Bearer ${SECRET}`, env);
      expect(response.status).toBe(code === "OK" ? 200 : 409);
      expect(runs[0]?.parameters[5]).toBe(expected);
    }
  });

  it("envelopes sync rejection outcomes as dry-run null-command responses", async () => {
    const malformed = await route("{", `Bearer ${SECRET}`);
    const unauthorized = await route(await encodedRequest({ sent_at_epoch: Math.floor(Date.now() / 1000) }));
    const disabled = { ...await enabledEnv(), AGENT_SYNC_ENABLED: "false" } as Env;
    const disabledResponse = await route(await encodedRequest({ sent_at_epoch: Math.floor(Date.now() / 1000) }), `Bearer ${SECRET}`, disabled);
    const fetch = worker.fetch as unknown as (request: Request, env: Env, context: ExecutionContext) => Promise<Response>;
    const methodResponse = await fetch(new Request("https://execution-edge.example/api/v1/agent/sync"), await enabledEnv(), {} as ExecutionContext);

    for (const response of [malformed, unauthorized, disabledResponse, methodResponse]) {
      expect((await response.json()) as { mode: unknown; command: unknown }).toMatchObject({ mode: "DRY_RUN", command: null });
    }
  });

  it("keys the enabled local coordinator by exact account id and maps replay conflicts to 409", async () => {
    const names: string[] = [];
    const conflictEnv = {
      ...await enabledEnv(),
      ACCOUNT_COORDINATOR: {
        idFromName(name: string) {
          names.push(name);
          return name;
        },
        get() {
          return {
            fetch: async () => new Response(JSON.stringify({ code: "REPLAY_CONFLICT" })),
          };
        },
      },
    } as unknown as Env;

    const response = await route(await encodedRequest({
      request_sequence: 1,
      last_acknowledged_server_sequence: 0,
      sent_at_epoch: Math.floor(Date.now() / 1000),
    }), `Bearer ${SECRET}`, conflictEnv);

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "REPLAY_CONFLICT", mode: "DRY_RUN", command: null });
    expect(names).toEqual(["account-1"]);
  });

  it("exposes only DRY_RUN status and the last request sequence", async () => {
    const statusEnv = {
      ...await enabledEnv(),
      ACCOUNT_COORDINATOR: {
        idFromName(name: string) {
          return name;
        },
        get() {
          return {
            fetch: async () => new Response(JSON.stringify({
              mode: "DRY_RUN",
              last_request_sequence: 7,
              unexpected_secret: "must-not-leak",
            })),
          };
        },
      },
    } as unknown as Env;
    const fetch = worker.fetch as unknown as (request: Request, env: Env, context: ExecutionContext) => Promise<Response>;

    const response = await fetch(new Request("https://execution-edge.example/api/v1/agent/sync/status?account_id=account-1", {
      headers: { authorization: `Bearer ${SECRET}` },
    }), statusEnv, {} as ExecutionContext);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ mode: "DRY_RUN", last_request_sequence: 7 });
  });

  it("requires POST and a valid bearer, then never returns a command", async () => {
    const body = await encodedRequest({ sent_at_epoch: Math.floor(Date.now() / 1000) });
    expect((await route(body)).status).toBe(401);
    expect((await route(body, "Bearer wrong")).status).toBe(401);
    const success = await route(body, `Bearer ${SECRET}`);
    expect(success.status).toBe(200);
    expect((await success.json() as { command: unknown }).command).toBeNull();

    const nonPost = new Request("https://execution-edge.example/api/v1/agent/sync");
    const fetch = worker.fetch as unknown as (request: Request, env: Env, context: ExecutionContext) => Promise<Response>;
    expect((await fetch(nonPost, await enabledEnv(), {} as ExecutionContext)).status).toBe(405);
  });

  it("returns 400 for malformed bodies and remains disabled without an exact enablement", async () => {
    expect((await route("{", `Bearer ${SECRET}`)).status).toBe(400);
    const disabled = { ...await enabledEnv(), AGENT_SYNC_ENABLED: "false" } as Env;
    expect((await route(await encodedRequest({ sent_at_epoch: Math.floor(Date.now() / 1000) }), `Bearer ${SECRET}`, disabled)).status).toBe(503);
  });

  it("rejects an oversized streaming body before complete parsing", async () => {
    let cancelled = false;
    const oversized = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(256 * 1024 + 1));
      },
      cancel() {
        cancelled = true;
      },
    });
    const request = new Request("https://execution-edge.example/api/v1/agent/sync", {
      method: "POST",
      headers: { authorization: `Bearer ${SECRET}` },
      body: oversized,
      // Node requires this for a ReadableStream request body; Workers ignore it.
      duplex: "half",
    } as RequestInit);
    const fetch = worker.fetch as unknown as (request: Request, env: Env, context: ExecutionContext) => Promise<Response>;

    const response = await fetch(request, await enabledEnv(), {} as ExecutionContext);

    expect(response.status).toBe(400);
    expect(cancelled).toBe(true);
  });
});
