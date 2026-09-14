import { describe, expect, it } from "vitest";
import type { AgentSyncRequestV1 } from "../src/agent-sync-v1";
import { deriveHealthStateV1, projectAcceptedHeartbeatV1 } from "../src/agent-health-projection-v1";

const request = {
  schema_version: "AgentSyncRequestV1",
  installation_id: "installation-1",
  account_id: "account-1",
  request_sequence: 2,
  account_snapshot: {
    terminal_build: 4410,
    terminal_connection_state: "CONNECTED",
    account_trade_permission: "DENIED",
    terminal_trade_permission: "DENIED",
    algo_trading_permission: "DENIED",
    symbols: [
      { source_symbol: "EURUSD", broker_symbol: "EURUSD.PRO" },
      { source_symbol: "GBPJPY", broker_symbol: "GBPJPY.PRO" },
    ],
  },
} as unknown as AgentSyncRequestV1;

describe("accepted heartbeat projection v1", () => {
  it("projects only the minimal operational health fields", () => {
    const projection = projectAcceptedHeartbeatV1(request, 9, 1_787_472_010);

    expect(projection).toEqual({
      account_id: "account-1", installation_id: "installation-1",
      last_accepted_epoch: 1_787_472_010, request_sequence: 2, server_sequence: 9,
      terminal_build: 4410, source_symbol: "EURUSD",
      terminal_connection_state: "CONNECTED", account_trade_permission: "DENIED",
      terminal_trade_permission: "DENIED", algo_trading_permission: "DENIED",
    });
    expect(Object.keys(projection)).not.toEqual(expect.arrayContaining([
      "digest", "broker", "raw_event", "balance", "equity", "margin", "price", "order", "position",
    ]));
  });

  it.each([
    [100, 135, "ONLINE"],
    [100, 136, "STALE"],
    [100, 190, "STALE"],
    [100, 191, "OFFLINE"],
    [null, 191, "UNKNOWN"],
  ] as const)("derives %s health state", (lastAccepted, now, expected) => {
    expect(deriveHealthStateV1(lastAccepted, now)).toBe(expected);
  });
});
