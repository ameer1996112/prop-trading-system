CREATE TABLE agent_health_current_v1 (
  account_id TEXT NOT NULL, installation_id TEXT NOT NULL,
  last_accepted_epoch INTEGER NOT NULL, request_sequence INTEGER NOT NULL,
  server_sequence INTEGER NOT NULL, terminal_build INTEGER NOT NULL,
  source_symbol TEXT NOT NULL, terminal_connection_state TEXT NOT NULL,
  account_trade_permission TEXT NOT NULL, terminal_trade_permission TEXT NOT NULL,
  algo_trading_permission TEXT NOT NULL,
  PRIMARY KEY (account_id, installation_id)
);

CREATE TRIGGER agent_health_current_v1_no_delete
BEFORE DELETE ON agent_health_current_v1
BEGIN
  SELECT RAISE(ABORT, 'agent_health_current_v1 cannot be deleted');
END;
