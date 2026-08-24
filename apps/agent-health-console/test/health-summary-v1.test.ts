import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { healthSummaryV1, type AgentHealthConsoleEnv } from "../src/health-summary-v1";

type Run = Readonly<{ query: string; parameters: readonly unknown[] }>;
type DashboardWranglerConfig = Readonly<{
  vars: Readonly<{
    DASHBOARD_ACCOUNT_ID: string;
    DASHBOARD_INSTALLATION_ID: string;
  }>;
}>;

const dashboardWranglerConfig = JSON.parse(
  readFileSync(new URL("../wrangler.dry-run.jsonc", import.meta.url), "utf8"),
) as DashboardWranglerConfig;

const current = {
  last_accepted_epoch: 100,
  request_sequence: 11,
  server_sequence: 12,
  terminal_build: 4410,
  source_symbol: "EURUSD",
  terminal_connection_state: "CONNECTED",
  account_trade_permission: "ALLOWED",
  terminal_trade_permission: "ALLOWED",
  algo_trading_permission: "ALLOWED",
};

function database(currentRow: typeof current | null, recentRows: readonly object[] = [], fail = false): { env: AgentHealthConsoleEnv; runs: Run[] } {
  const runs: Run[] = [];
  return {
    env: {
      DASHBOARD_ACCOUNT_ID: dashboardWranglerConfig.vars.DASHBOARD_ACCOUNT_ID,
      AGENT_HEALTH_DB: {
        prepare(query: string) {
          return {
            bind(...parameters: unknown[]) {
              runs.push({ query, parameters });
              return {
                first: async () => {
                  if (fail) throw new Error("database connection failed with secret detail");
                  return currentRow;
                },
                all: async () => {
                  if (fail) throw new Error("database connection failed with secret detail");
                  return { results: recentRows };
                },
              };
            },
          };
        },
      } as unknown as D1Database,
      DASHBOARD_INSTALLATION_ID: dashboardWranglerConfig.vars.DASHBOARD_INSTALLATION_ID,
    },
    runs,
  };
}

describe("health summary v1", () => {
  it.each([
    [120, "ONLINE"],
    [121, "STALE"],
    [161, "OFFLINE"],
  ] as const)("derives %s from the accepted heartbeat age", async (nowEpoch, status) => {
    const { env } = database(current);

    const summary = await healthSummaryV1(env, nowEpoch);

    expect(summary.status).toBe(status);
    expect(summary.current).toEqual(current);
  });

  it("returns unknown with no data when the projection is absent", async () => {
    const { env } = database(null);

    await expect(healthSummaryV1(env, 161)).resolves.toEqual({
      schema_version: "AgentHealthSummaryV1", server_time_epoch: 161,
      status: "UNKNOWN", current: null, recent: [],
    });
  });

  it("returns unknown without database error text when a D1 read fails", async () => {
    const { env } = database(current, [], true);

    const summary = await healthSummaryV1(env, 161);

    expect(summary).toEqual({
      schema_version: "AgentHealthSummaryV1", server_time_epoch: 161,
      status: "UNKNOWN", current: null, recent: [],
    });
    expect(JSON.stringify(summary)).not.toContain("secret detail");
  });

  it("reads exactly the 20 newest audit rows with server-configured selectors", async () => {
    const recent = Array.from({ length: 20 }, (_, index) => ({
      request_sequence: 120 - index,
      result_code: "ACCEPTED",
      server_sequence: 220 - index,
      received_at_epoch: 320 - index,
    }));
    const { env, runs } = database(current, recent);

    const summary = await healthSummaryV1(env, 120);

    expect(summary.recent).toEqual(recent);
    expect(runs).toHaveLength(2);
    expect(runs).toEqual(expect.arrayContaining([
      expect.objectContaining({ parameters: [
        dashboardWranglerConfig.vars.DASHBOARD_ACCOUNT_ID,
        dashboardWranglerConfig.vars.DASHBOARD_INSTALLATION_ID,
      ] }),
      expect.objectContaining({ query: expect.stringMatching(/ORDER BY received_at_epoch DESC, request_sequence DESC\s+LIMIT 20/u) }),
    ]));
  });

  it("uses the dashboard selector names and values configured by Wrangler", async () => {
    const { env, runs } = database(current);

    await healthSummaryV1(env, 120);

    expect(runs).toEqual(expect.arrayContaining([
      expect.objectContaining({ parameters: [
        dashboardWranglerConfig.vars.DASHBOARD_ACCOUNT_ID,
        dashboardWranglerConfig.vars.DASHBOARD_INSTALLATION_ID,
      ] }),
    ]));
  });
});
