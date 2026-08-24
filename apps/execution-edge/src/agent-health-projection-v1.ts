import type { AgentSyncRequestV1 } from "./agent-sync-v1";

export type HealthStateV1 = "ONLINE" | "STALE" | "OFFLINE" | "UNKNOWN";

export interface AgentHealthProjectionV1 {
  readonly account_id: string;
  readonly installation_id: string;
  readonly last_accepted_epoch: number;
  readonly request_sequence: number;
  readonly server_sequence: number;
  readonly terminal_build: number;
  readonly source_symbol: string;
  readonly terminal_connection_state: string;
  readonly account_trade_permission: string;
  readonly terminal_trade_permission: string;
  readonly algo_trading_permission: string;
}

export function projectAcceptedHeartbeatV1(
  request: AgentSyncRequestV1,
  serverSequence: number,
  receivedAtEpoch: number,
): AgentHealthProjectionV1 {
  const snapshot = request.account_snapshot;
  const symbols = snapshot.symbols as readonly Readonly<Record<string, unknown>>[];
  const firstSymbol = symbols[0]!;
  return {
    account_id: request.account_id,
    installation_id: request.installation_id,
    last_accepted_epoch: receivedAtEpoch,
    request_sequence: request.request_sequence,
    server_sequence: serverSequence,
    terminal_build: snapshot.terminal_build as number,
    source_symbol: firstSymbol.source_symbol as string,
    terminal_connection_state: snapshot.terminal_connection_state as string,
    account_trade_permission: snapshot.account_trade_permission as string,
    terminal_trade_permission: snapshot.terminal_trade_permission as string,
    algo_trading_permission: snapshot.algo_trading_permission as string,
  };
}

export function deriveHealthStateV1(lastAcceptedEpoch: number | null, nowEpoch: number): HealthStateV1 {
  if (lastAcceptedEpoch === null) return "UNKNOWN";
  const age = nowEpoch - lastAcceptedEpoch;
  if (age <= 20) return "ONLINE";
  if (age <= 60) return "STALE";
  return "OFFLINE";
}
