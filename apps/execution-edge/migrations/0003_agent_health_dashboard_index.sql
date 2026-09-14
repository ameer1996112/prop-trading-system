CREATE INDEX agent_sync_audit_v1_dashboard_recent_idx
ON agent_sync_audit_v1 (
  account_id,
  installation_id,
  received_at_epoch DESC,
  request_sequence DESC,
  audit_id DESC
);
