CREATE TABLE agent_sync_audit_v1 (
  audit_id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL,
  installation_id TEXT NOT NULL,
  request_sequence INTEGER NOT NULL,
  request_body_sha256 TEXT NOT NULL,
  result_code TEXT NOT NULL,
  server_sequence INTEGER,
  received_at_epoch INTEGER NOT NULL
);
