import { describe, expect, it } from "vitest";
import worker, { type Env } from "../src/index";

const env = {
  DASHBOARD_ACCOUNT_ID: "account-server-only",
  AGENT_HEALTH_DB: {
    prepare() {
      return {
        bind() {
          return {
            first: async () => ({
              last_accepted_epoch: 100, request_sequence: 11, server_sequence: 12,
              terminal_build: 4410, source_symbol: "EURUSD", terminal_connection_state: "CONNECTED",
              account_trade_permission: "ALLOWED", terminal_trade_permission: "ALLOWED", algo_trading_permission: "ALLOWED",
            }),
            all: async () => ({ results: [] }),
          };
        },
      };
    },
  } as unknown as D1Database,
  DASHBOARD_INSTALLATION_ID: "installation-server-only",
} satisfies Env;

describe("agent health console worker", () => {
  it("returns a redacted no-store summary from the same-origin GET route", async () => {
    const response = await worker.fetch(new Request("https://console.example/api/v1/health-summary"), env);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toMatchObject({ schema_version: "AgentHealthSummaryV1", status: expect.any(String) });
    expect(JSON.stringify(body)).not.toMatch(/account_id|installation_id|balance|equity|price|position/iu);
  });

  it("rejects POST at the summary route", async () => {
    const response = await worker.fetch(new Request("https://console.example/api/v1/health-summary", { method: "POST" }), env);

    expect(response.status).toBe(405);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
