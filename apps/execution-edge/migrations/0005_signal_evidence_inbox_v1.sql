CREATE TABLE signal_evidence_inbox_v1 (
  delivery_id TEXT PRIMARY KEY CHECK(length(delivery_id)=64 AND delivery_id NOT GLOB '*[^a-f0-9]*'),
  namespace TEXT NOT NULL CHECK(length(namespace) BETWEEN 1 AND 160),
  attempt_key TEXT NOT NULL CHECK(length(attempt_key)=64 AND attempt_key NOT GLOB '*[^a-f0-9]*'),
  delivery_body_sha256 TEXT NOT NULL CHECK(length(delivery_body_sha256)=64 AND delivery_body_sha256 NOT GLOB '*[^a-f0-9]*'),
  receipt_id TEXT NOT NULL CHECK(length(receipt_id)=64 AND receipt_id NOT GLOB '*[^a-f0-9]*'),
  evidence_id TEXT NOT NULL CHECK(length(evidence_id)=64 AND evidence_id NOT GLOB '*[^a-f0-9]*'),
  evidence_body_sha256 TEXT NOT NULL CHECK(length(evidence_body_sha256)=64 AND evidence_body_sha256 NOT GLOB '*[^a-f0-9]*'),
  registration_id TEXT NOT NULL CHECK(length(registration_id) BETWEEN 1 AND 160),
  generation INTEGER NOT NULL CHECK(generation BETWEEN 1 AND 9007199254740991),
  admitted_at_epoch INTEGER NOT NULL CHECK(admitted_at_epoch BETWEEN 0 AND 9007199254740991),
  expires_at_epoch INTEGER NOT NULL CHECK(expires_at_epoch BETWEEN 0 AND 9007199254740991 AND expires_at_epoch>admitted_at_epoch),
  received_at_epoch INTEGER NOT NULL CHECK(received_at_epoch BETWEEN admitted_at_epoch AND 9007199254740991 AND received_at_epoch<expires_at_epoch),
  body TEXT NOT NULL CHECK(length(CAST(body AS BLOB)) BETWEEN 1 AND 278528 AND json_valid(body)),
  authority TEXT NOT NULL CHECK(authority='EVIDENCE_ONLY'),
  execution_allowed INTEGER NOT NULL CHECK(execution_allowed=0),
  UNIQUE(namespace,attempt_key)
) STRICT, WITHOUT ROWID;

CREATE TRIGGER signal_evidence_inbox_v1_no_update BEFORE UPDATE ON signal_evidence_inbox_v1 BEGIN
  SELECT RAISE(ABORT,'immutable signal evidence');
END;
CREATE TRIGGER signal_evidence_inbox_v1_no_delete BEFORE DELETE ON signal_evidence_inbox_v1 BEGIN
  SELECT RAISE(ABORT,'retained signal evidence');
END;
