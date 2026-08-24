export type HealthSummaryResponseV1 = {
  schema_version: "AgentHealthSummaryV1";
  server_time_epoch: number;
  status: "ONLINE" | "STALE" | "OFFLINE" | "UNKNOWN";
  current: null | {
    last_accepted_epoch: number;
    request_sequence: number;
    server_sequence: number;
    terminal_build: number;
    source_symbol: string;
    terminal_connection_state: string;
    account_trade_permission: string;
    terminal_trade_permission: string;
    algo_trading_permission: string;
  };
  recent: readonly {
    request_sequence: number;
    result_code: string;
    server_sequence: number | null;
    received_at_epoch: number;
  }[];
};

export interface AgentHealthConsoleEnv {
  AGENT_HEALTH_DB: D1Database;
  AGENT_HEALTH_ACCOUNT_ID: string;
  AGENT_HEALTH_INSTALLATION_ID: string;
}

type CurrentRow = NonNullable<HealthSummaryResponseV1["current"]>;
type RecentRow = HealthSummaryResponseV1["recent"][number];

const CURRENT_QUERY = `SELECT last_accepted_epoch, request_sequence, server_sequence, terminal_build,
       source_symbol, terminal_connection_state, account_trade_permission,
       terminal_trade_permission, algo_trading_permission
FROM agent_health_current_v1
WHERE account_id = ? AND installation_id = ?;`;

const RECENT_QUERY = `SELECT request_sequence, result_code, server_sequence, received_at_epoch
FROM agent_sync_audit_v1
WHERE account_id = ? AND installation_id = ?
ORDER BY received_at_epoch DESC, request_sequence DESC
LIMIT 20;`;

function unknownSummary(nowEpoch: number): HealthSummaryResponseV1 {
  return {
    schema_version: "AgentHealthSummaryV1",
    server_time_epoch: nowEpoch,
    status: "UNKNOWN",
    current: null,
    recent: [],
  };
}

function statusAt(nowEpoch: number, lastAcceptedEpoch: number): HealthSummaryResponseV1["status"] {
  const age = nowEpoch - lastAcceptedEpoch;
  if (age <= 20) return "ONLINE";
  if (age <= 60) return "STALE";
  return "OFFLINE";
}

function currentFrom(row: CurrentRow): CurrentRow {
  return {
    last_accepted_epoch: row.last_accepted_epoch,
    request_sequence: row.request_sequence,
    server_sequence: row.server_sequence,
    terminal_build: row.terminal_build,
    source_symbol: row.source_symbol,
    terminal_connection_state: row.terminal_connection_state,
    account_trade_permission: row.account_trade_permission,
    terminal_trade_permission: row.terminal_trade_permission,
    algo_trading_permission: row.algo_trading_permission,
  };
}

function recentFrom(row: RecentRow): RecentRow {
  return {
    request_sequence: row.request_sequence,
    result_code: row.result_code,
    server_sequence: row.server_sequence,
    received_at_epoch: row.received_at_epoch,
  };
}

export async function healthSummaryV1(
  env: AgentHealthConsoleEnv,
  nowEpoch: number,
): Promise<HealthSummaryResponseV1> {
  try {
    const selectors = [env.AGENT_HEALTH_ACCOUNT_ID, env.AGENT_HEALTH_INSTALLATION_ID] as const;
    const currentRow = await env.AGENT_HEALTH_DB.prepare(CURRENT_QUERY).bind(...selectors).first<CurrentRow>();
    if (currentRow === null) return unknownSummary(nowEpoch);

    const recentResult = await env.AGENT_HEALTH_DB.prepare(RECENT_QUERY).bind(...selectors).all<RecentRow>();
    const current = currentFrom(currentRow);
    return {
      schema_version: "AgentHealthSummaryV1",
      server_time_epoch: nowEpoch,
      status: statusAt(nowEpoch, current.last_accepted_epoch),
      current,
      recent: recentResult.results.slice(0, 20).map(recentFrom),
    };
  } catch {
    return unknownSummary(nowEpoch);
  }
}
