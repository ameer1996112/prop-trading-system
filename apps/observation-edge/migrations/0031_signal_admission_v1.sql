CREATE TABLE signal_admission_v1_registrations (
  registration_id TEXT PRIMARY KEY,
  namespace TEXT NOT NULL,
  scope_key TEXT NOT NULL,
  active_generation INTEGER NOT NULL CHECK(active_generation BETWEEN 1 AND 9007199254740991),
  revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991),
  enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
  registration_json TEXT NOT NULL CHECK(json_valid(registration_json))
) STRICT, WITHOUT ROWID;
CREATE UNIQUE INDEX signal_admission_v1_active_scope ON signal_admission_v1_registrations(scope_key) WHERE enabled=1;
CREATE TABLE signal_admission_v1_streams (
  registration_id TEXT NOT NULL REFERENCES signal_admission_v1_registrations(registration_id),
  generation INTEGER NOT NULL CHECK(generation BETWEEN 1 AND 9007199254740991),
  registry_revision INTEGER NOT NULL CHECK(registry_revision BETWEEN 1 AND 9007199254740991),
  revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991),
  next_sequence INTEGER NOT NULL CHECK(next_sequence BETWEEN 1 AND 9007199254740991),
  state TEXT NOT NULL CHECK(state IN ('ACTIVE','QUARANTINED','RETIRED')),
  last_accepted_at INTEGER CHECK(last_accepted_at BETWEEN 0 AND 9007199254740991),
  reason TEXT,
  PRIMARY KEY(registration_id,generation)
) STRICT, WITHOUT ROWID;
CREATE UNIQUE INDEX signal_admission_v1_active_stream ON signal_admission_v1_streams(registration_id) WHERE state='ACTIVE';
CREATE TABLE signal_admission_v1_receipts (
  registration_id TEXT NOT NULL,
  generation INTEGER NOT NULL CHECK(generation BETWEEN 1 AND 9007199254740991),
  sequence INTEGER NOT NULL CHECK(sequence BETWEEN 1 AND 9007199254740991),
  receipt_id TEXT NOT NULL UNIQUE,
  body_sha256 TEXT NOT NULL CHECK(length(body_sha256)=64 AND body_sha256 NOT GLOB '*[^0-9a-f]*'),
  outcome TEXT NOT NULL CHECK(outcome IN ('ACCEPTED','NO_CANDIDATE','AUDIT_ONLY','REJECTED')),
  code TEXT CHECK(code IN ('SEQUENCE_GAP','UNKNOWN_OLD_SEQUENCE','BODY_CONFLICT','INVALID_EVIDENCE','STALE','FUTURE','CLOCK_REGRESSION','ATTEMPT_CONFLICT','STREAM_BLOCKED')),
  admitted_at INTEGER NOT NULL CHECK(admitted_at BETWEEN 0 AND 9007199254740991),
  PRIMARY KEY(registration_id,generation,sequence),
  FOREIGN KEY(registration_id,generation) REFERENCES signal_admission_v1_streams(registration_id,generation)
) STRICT, WITHOUT ROWID;
CREATE TABLE signal_admission_v1_evidence (
  evidence_id TEXT PRIMARY KEY,
  namespace TEXT NOT NULL,
  attempt_key TEXT NOT NULL,
  evidence_hash TEXT NOT NULL CHECK(length(evidence_hash)=64 AND evidence_hash NOT GLOB '*[^0-9a-f]*'),
  receipt_id TEXT NOT NULL REFERENCES signal_admission_v1_receipts(receipt_id),
  body TEXT NOT NULL CHECK(json_valid(body)),
  authority TEXT NOT NULL CHECK(authority='EVIDENCE_ONLY'),
  execution_allowed INTEGER NOT NULL CHECK(execution_allowed=0)
) STRICT, WITHOUT ROWID;
CREATE INDEX signal_admission_v1_evidence_receipt ON signal_admission_v1_evidence(receipt_id);
CREATE TABLE signal_admission_v1_attempts (
  namespace TEXT NOT NULL,
  attempt_key TEXT NOT NULL,
  formation_hash TEXT NOT NULL CHECK(length(formation_hash)=64 AND formation_hash NOT GLOB '*[^0-9a-f]*'),
  evidence_id TEXT REFERENCES signal_admission_v1_evidence(evidence_id),
  evidence_hash TEXT,
  trigger_epoch INTEGER CHECK(trigger_epoch BETWEEN 0 AND 9007199254740991),
  selection_key TEXT CHECK(selection_key IS NULL OR json_valid(selection_key)),
  disputed INTEGER NOT NULL DEFAULT 0 CHECK(disputed IN (0,1)),
  PRIMARY KEY(namespace,attempt_key),
  CHECK((evidence_id IS NULL AND evidence_hash IS NULL AND trigger_epoch IS NULL AND selection_key IS NULL)
    OR (evidence_id IS NOT NULL AND evidence_hash IS NOT NULL AND length(evidence_hash)=64 AND evidence_hash NOT GLOB '*[^0-9a-f]*' AND trigger_epoch IS NOT NULL AND selection_key IS NOT NULL))
) STRICT, WITHOUT ROWID;
CREATE TABLE signal_admission_v1_outbox (
  delivery_id TEXT PRIMARY KEY,
  namespace TEXT NOT NULL,
  attempt_key TEXT NOT NULL,
  registration_id TEXT NOT NULL,
  generation INTEGER NOT NULL CHECK(generation BETWEEN 1 AND 9007199254740991),
  receipt_id TEXT NOT NULL REFERENCES signal_admission_v1_receipts(receipt_id),
  evidence_id TEXT NOT NULL REFERENCES signal_admission_v1_evidence(evidence_id),
  delivery_body_sha256 TEXT NOT NULL CHECK(length(delivery_body_sha256)=64 AND delivery_body_sha256 NOT GLOB '*[^0-9a-f]*'),
  body TEXT NOT NULL CHECK(json_valid(body)),
  admitted_at_epoch INTEGER NOT NULL CHECK(admitted_at_epoch BETWEEN 0 AND 9007199254740991),
  expires_at_epoch INTEGER NOT NULL CHECK(expires_at_epoch>admitted_at_epoch AND expires_at_epoch<=9007199254740991),
  status TEXT NOT NULL CHECK(status IN ('PENDING','CLAIMED','RETRY','ACKNOWLEDGED','EXPIRED','FAILED_TERMINAL','QUARANTINED')),
  claim_token TEXT,
  lease_until_epoch INTEGER CHECK(lease_until_epoch BETWEEN 0 AND 9007199254740991),
  delivery_attempts INTEGER NOT NULL DEFAULT 0 CHECK(delivery_attempts BETWEEN 0 AND 9007199254740991),
  next_attempt_at_epoch INTEGER NOT NULL CHECK(next_attempt_at_epoch BETWEEN 0 AND 9007199254740991),
  authority TEXT NOT NULL CHECK(authority='EVIDENCE_ONLY'),
  execution_allowed INTEGER NOT NULL CHECK(execution_allowed=0),
  UNIQUE(namespace,attempt_key),
  FOREIGN KEY(namespace,attempt_key) REFERENCES signal_admission_v1_attempts(namespace,attempt_key),
  FOREIGN KEY(registration_id,generation) REFERENCES signal_admission_v1_streams(registration_id,generation)
) STRICT, WITHOUT ROWID;
CREATE INDEX signal_admission_v1_outbox_due ON signal_admission_v1_outbox(status,next_attempt_at_epoch,delivery_id);
CREATE INDEX signal_admission_v1_outbox_stream ON signal_admission_v1_outbox(registration_id,generation);
CREATE TABLE signal_admission_v1_audit (
  audit_id TEXT PRIMARY KEY,
  registration_id TEXT NOT NULL,
  generation INTEGER NOT NULL CHECK(generation BETWEEN 1 AND 9007199254740991),
  sequence INTEGER CHECK(sequence BETWEEN 1 AND 9007199254740991),
  body_sha256 TEXT,
  reason TEXT NOT NULL,
  authority TEXT NOT NULL CHECK(authority='EVIDENCE_ONLY'),
  execution_allowed INTEGER NOT NULL CHECK(execution_allowed=0)
) STRICT, WITHOUT ROWID;
CREATE TABLE signal_admission_v1_guards (
  token TEXT PRIMARY KEY,
  ok INTEGER NOT NULL CONSTRAINT signal_admission_v1_cas CHECK(ok=1)
) STRICT, WITHOUT ROWID;
CREATE TRIGGER signal_admission_v1_receipts_immutable BEFORE UPDATE ON signal_admission_v1_receipts BEGIN SELECT RAISE(ABORT,'immutable receipt'); END;
CREATE TRIGGER signal_admission_v1_receipts_retained BEFORE DELETE ON signal_admission_v1_receipts BEGIN SELECT RAISE(ABORT,'retained receipt'); END;
CREATE TRIGGER signal_admission_v1_evidence_immutable BEFORE UPDATE ON signal_admission_v1_evidence BEGIN SELECT RAISE(ABORT,'immutable evidence'); END;
CREATE TRIGGER signal_admission_v1_evidence_retained BEFORE DELETE ON signal_admission_v1_evidence BEGIN SELECT RAISE(ABORT,'retained evidence'); END;
CREATE TRIGGER signal_admission_v1_audit_immutable BEFORE UPDATE ON signal_admission_v1_audit BEGIN SELECT RAISE(ABORT,'immutable audit'); END;
CREATE TRIGGER signal_admission_v1_audit_retained BEFORE DELETE ON signal_admission_v1_audit BEGIN SELECT RAISE(ABORT,'retained audit'); END;
CREATE TRIGGER signal_admission_v1_attempts_retained BEFORE DELETE ON signal_admission_v1_attempts BEGIN SELECT RAISE(ABORT,'retained attempt'); END;
CREATE TRIGGER signal_admission_v1_attempts_immutable BEFORE UPDATE ON signal_admission_v1_attempts
WHEN NEW.namespace IS NOT OLD.namespace OR NEW.attempt_key IS NOT OLD.attempt_key OR NEW.formation_hash IS NOT OLD.formation_hash OR NEW.disputed<OLD.disputed
 OR (OLD.evidence_id IS NOT NULL AND (NEW.evidence_id IS NOT OLD.evidence_id OR NEW.evidence_hash IS NOT OLD.evidence_hash OR NEW.trigger_epoch IS NOT OLD.trigger_epoch OR NEW.selection_key IS NOT OLD.selection_key))
 OR (OLD.disputed=1 AND OLD.evidence_id IS NULL AND NEW.evidence_id IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'immutable reservation'); END;
CREATE TRIGGER signal_admission_v1_streams_sticky BEFORE UPDATE ON signal_admission_v1_streams
WHEN (OLD.state='RETIRED' AND NEW.state!='RETIRED') OR (OLD.state='QUARANTINED' AND NEW.state='ACTIVE')
BEGIN SELECT RAISE(ABORT,'sticky stream'); END;
CREATE TRIGGER signal_admission_v1_outbox_immutable BEFORE UPDATE ON signal_admission_v1_outbox
WHEN NEW.delivery_id IS NOT OLD.delivery_id OR NEW.namespace IS NOT OLD.namespace OR NEW.attempt_key IS NOT OLD.attempt_key OR NEW.registration_id IS NOT OLD.registration_id OR NEW.generation IS NOT OLD.generation OR NEW.receipt_id IS NOT OLD.receipt_id OR NEW.evidence_id IS NOT OLD.evidence_id OR NEW.delivery_body_sha256 IS NOT OLD.delivery_body_sha256 OR NEW.body IS NOT OLD.body OR NEW.admitted_at_epoch IS NOT OLD.admitted_at_epoch OR NEW.expires_at_epoch IS NOT OLD.expires_at_epoch
BEGIN SELECT RAISE(ABORT,'immutable delivery'); END;
CREATE TRIGGER signal_admission_v1_outbox_retained BEFORE DELETE ON signal_admission_v1_outbox BEGIN SELECT RAISE(ABORT,'retained delivery'); END;
CREATE TRIGGER signal_admission_v1_streams_retained BEFORE DELETE ON signal_admission_v1_streams BEGIN SELECT RAISE(ABORT,'retained stream'); END;
CREATE TRIGGER signal_admission_v1_outbox_quarantine_sticky BEFORE UPDATE ON signal_admission_v1_outbox
WHEN OLD.status='QUARANTINED' AND NEW.status!='QUARANTINED'
BEGIN SELECT RAISE(ABORT,'sticky delivery quarantine'); END;
