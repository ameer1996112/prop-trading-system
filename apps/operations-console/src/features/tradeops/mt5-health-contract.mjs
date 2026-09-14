// Shared browser/Node read contract. No execution, persistence, or credentials.
const ROOT_KEYS = ["schema_version", "server_time_epoch", "status", "current", "recent"];
const CURRENT_KEYS = ["last_accepted_epoch", "request_sequence", "server_sequence", "terminal_build", "source_symbol", "terminal_connection_state", "account_trade_permission", "terminal_trade_permission", "algo_trading_permission"];
const RECENT_KEYS = ["request_sequence", "result_code", "server_sequence", "received_at_epoch"];
const OUTCOMES = ["ACCEPTED", "EXACT_RETRY", "REPLAY_CONFLICT", "SEQUENCE_INVALID", "IDENTITY_MISMATCH", "STALE_TIMESTAMP"];
function invalid() { throw new Error("Invalid MT5 health response"); }
function record(value, keys) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) invalid();
  const actual = Object.keys(value);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) invalid();
  return value;
}
function integer(value, min = 0, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < min || value > max) invalid();
  return value;
}
function epoch(value) { return integer(value, 1, 253402300799); }
function member(value, values) { if (!values.includes(value)) invalid(); return value; }

export function heartbeatStatusAt(ageSeconds) {
  if (!Number.isFinite(ageSeconds) || ageSeconds < 0) return "UNKNOWN";
  return ageSeconds <= 35 ? "ONLINE" : ageSeconds <= 90 ? "STALE" : "OFFLINE";
}

export function parseMt5HealthSummary(value) {
  const root = record(value, ROOT_KEYS);
  if (root.schema_version !== "AgentHealthSummaryV1") invalid();
  const now = epoch(root.server_time_epoch);
  const status = member(root.status, ["ONLINE", "STALE", "OFFLINE", "UNKNOWN"]);
  if (!Array.isArray(root.recent) || root.recent.length > 20) invalid();
  let current = null;
  if (root.current !== null) {
    const row = record(root.current, CURRENT_KEYS);
    const accepted = epoch(row.last_accepted_epoch);
    if (accepted > now || heartbeatStatusAt(now - accepted) !== status) invalid();
    if (typeof row.source_symbol !== "string" || !/^[A-Za-z0-9._:#/+!-]{1,80}$/.test(row.source_symbol)) invalid();
    current = {
      last_accepted_epoch: accepted,
      request_sequence: integer(row.request_sequence, 1), server_sequence: integer(row.server_sequence, 1),
      terminal_build: integer(row.terminal_build, 1), source_symbol: row.source_symbol,
      terminal_connection_state: member(row.terminal_connection_state, ["CONNECTED", "DISCONNECTED", "UNKNOWN"]),
      account_trade_permission: member(row.account_trade_permission, ["ALLOWED", "DENIED", "UNKNOWN"]),
      terminal_trade_permission: member(row.terminal_trade_permission, ["ALLOWED", "DENIED", "UNKNOWN"]),
      algo_trading_permission: member(row.algo_trading_permission, ["ALLOWED", "DENIED", "UNKNOWN"]),
    };
  } else if (status !== "UNKNOWN" || root.recent.length !== 0) invalid();
  let previousTime = now;
  const recent = root.recent.map((value) => {
    const row = record(value, RECENT_KEYS);
    const received = epoch(row.received_at_epoch);
    if (received > previousTime) invalid();
    previousTime = received;
    return { request_sequence: integer(row.request_sequence, 1), result_code: member(row.result_code, OUTCOMES),
      server_sequence: row.server_sequence === null ? null : integer(row.server_sequence, 1), received_at_epoch: received };
  });
  return { schema_version: "AgentHealthSummaryV1", server_time_epoch: now, status, current, recent };
}
