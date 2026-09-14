export type Mt5HealthStatus = "ONLINE" | "STALE" | "OFFLINE" | "UNKNOWN";
export type Mt5Permission = "ALLOWED" | "DENIED" | "UNKNOWN";
export type Mt5HealthSummary = {
  schema_version: "AgentHealthSummaryV1";
  server_time_epoch: number;
  status: Mt5HealthStatus;
  current: null | {
    last_accepted_epoch: number; request_sequence: number; server_sequence: number;
    terminal_build: number; source_symbol: string;
    terminal_connection_state: "CONNECTED" | "DISCONNECTED" | "UNKNOWN";
    account_trade_permission: Mt5Permission; terminal_trade_permission: Mt5Permission; algo_trading_permission: Mt5Permission;
  };
  recent: { request_sequence: number; result_code: string; server_sequence: number | null; received_at_epoch: number }[];
};
export function parseMt5HealthSummary(value: unknown): Mt5HealthSummary;
export function heartbeatStatusAt(ageSeconds: number): Mt5HealthStatus;
