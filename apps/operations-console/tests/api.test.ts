import { afterEach, describe, expect, it, vi } from "vitest";

import { loadFoundationSnapshot } from "../src/lib/api";

const gateIds = [
  "optimizer_1_inputs",
  "tradingview_alert_configuration",
  "committed_clean_pine_provenance",
  "managed_secret_workload_identity",
  "oidc_mfa",
  "telemetry",
  "independent_dead_man",
  "transactional_email",
  "metaapi_demo_only_tenant",
  "metaapi_common_cursor_barrier",
  "licensed_tick_source",
  "sequence_complete_ticks",
  "five_day_tick_pilot",
];

function readiness(overrides: Record<string, unknown> = {}) {
  return {
    ready: false,
    status: "BLOCKED",
    mode: "FOUNDATION_OBSERVATION_ONLY",
    evaluated_at: "2026-07-23T10:00:00Z",
    evidence_freshness: {
      last_modified_at: "2026-07-23T09:59:00Z",
      age_seconds: 60,
      status: "OBSERVED",
    },
    ...overrides,
  };
}

function gateReport(gates = gateIds.map((gate_id) => ({
  gate_id,
  status: "BLOCKED",
  reason: "external proof unavailable",
  missing_requirements: ["proof"],
}))) {
  return { overall_status: "BLOCKED", gates };
}

function response(body: unknown, status: number): Response {
  return responseRaw(JSON.stringify(body), status);
}

function responseRaw(body: string, status: number): Response {
  return { status, text: async () => body } as Response;
}

function mockApi(readinessBody: unknown, gatesBody: unknown, readinessStatus = 503) {
  vi.stubEnv("PHASE0_API_BASE_URL", "http://api:8000");
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(response(readinessBody, readinessStatus))
      .mockResolvedValueOnce(response(gatesBody, 200)),
  );
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("loadFoundationSnapshot", () => {
  it("renders a valid blocked 503 body instead of calling the API unavailable", async () => {
    mockApi(readiness(), gateReport());
    const snapshot = await loadFoundationSnapshot();
    expect(snapshot.source).toBe("SERVER_API");
    expect(snapshot.status).toBe("BLOCKED");
    expect(snapshot.ready).toBe(false);
    expect(snapshot.gates).toHaveLength(13);
    expect(snapshot.evaluatedAt).toBe("2026-07-23T10:00:00Z");
  });

  it.each([
    [readiness({ ready: true }), gateReport()],
    [readiness({ status: "READY" }), gateReport()],
    [readiness({ evaluated_at: "2026-02-30T00:00:00Z" }), gateReport()],
    [readiness(), gateReport(gateReport().gates.slice(0, 12))],
    [readiness(), gateReport([gateReport().gates[0]!, ...gateReport().gates.slice(0, 12)])],
  ])("degrades malformed, unsafe, missing, or duplicate API state", async (ready, gates) => {
    mockApi(ready, gates, 200);
    const snapshot = await loadFoundationSnapshot();
    expect(snapshot.source).toBe("API_INVALID");
    expect(snapshot.ready).toBe(false);
    expect(snapshot.status).toBe("DEGRADED");
    expect(snapshot.gates).toEqual([]);
  });

  it("aborts an API request at the bounded timeout", async () => {
    vi.useFakeTimers();
    vi.stubEnv("PHASE0_API_BASE_URL", "http://api:8000");
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
      ),
    );
    const pending = loadFoundationSnapshot();
    await vi.advanceTimersByTimeAsync(2501);
    const snapshot = await pending;
    expect(snapshot.source).toBe("API_UNAVAILABLE");
    expect(snapshot.ready).toBe(false);
  });

  it.each([
    ['{"ready":false,"ready":true}', JSON.stringify(gateReport())],
    [JSON.stringify(readiness()), '{"overall_status":"BLOCKED","overall_status":"BLOCKED"}'],
    ['{"ready":false,"status":"BLOCKED","mode":"FOUNDATION_OBSERVATION_ONLY","evaluated_at":"2026-07-23T10:00:00Z","evidence_freshness":{"status":"UNKNOWN","last_modified_at":null,"age_seconds":null},"detail":"\\ud800"}', JSON.stringify(gateReport())],
  ])("rejects duplicate keys and lone surrogates in raw API bytes", async (readyRaw, gatesRaw) => {
    vi.stubEnv("PHASE0_API_BASE_URL", "http://api:8000");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(responseRaw(readyRaw, 503))
        .mockResolvedValueOnce(responseRaw(gatesRaw, 200)),
    );
    const snapshot = await loadFoundationSnapshot();
    expect(snapshot.source).toBe("API_INVALID");
    expect(snapshot.ready).toBe(false);
  });
});
