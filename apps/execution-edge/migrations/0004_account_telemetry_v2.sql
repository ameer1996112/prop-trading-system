CREATE TABLE telemetry_session_v2 (
  account_id TEXT NOT NULL PRIMARY KEY,
  scope TEXT NOT NULL UNIQUE,
  identity_json TEXT NOT NULL CHECK(json_valid(identity_json)),
  registration_json TEXT NOT NULL CHECK(json_valid(registration_json)),
  last_request_sequence INTEGER NOT NULL CHECK(typeof(last_request_sequence) = 'integer' AND last_request_sequence BETWEEN 1 AND 9007199254740991),
  last_event_sequence INTEGER NOT NULL CHECK(typeof(last_event_sequence) = 'integer' AND last_event_sequence BETWEEN 0 AND 9007199254740991),
  request_digest TEXT NOT NULL,
  accepted_at INTEGER NOT NULL CHECK(typeof(accepted_at) = 'integer' AND accepted_at BETWEEN 1 AND 9007199254740991),
  latest_json TEXT NOT NULL CHECK(json_valid(latest_json)),
  account_json TEXT CHECK(account_json IS NULL OR json_valid(account_json)),
  exposure_json TEXT CHECK(exposure_json IS NULL OR json_valid(exposure_json))
) WITHOUT ROWID;

CREATE TABLE telemetry_receipt_v2 (
  scope TEXT NOT NULL REFERENCES telemetry_session_v2(scope),
  request_sequence INTEGER NOT NULL CHECK(typeof(request_sequence) = 'integer' AND request_sequence BETWEEN 1 AND 9007199254740991),
  request_digest TEXT NOT NULL,
  response_bytes TEXT NOT NULL,
  accepted_at INTEGER NOT NULL CHECK(typeof(accepted_at) = 'integer' AND accepted_at BETWEEN 1 AND 9007199254740991),
  acknowledged_events INTEGER NOT NULL CHECK(typeof(acknowledged_events) = 'integer' AND acknowledged_events BETWEEN 0 AND 9007199254740991),
  PRIMARY KEY(scope, request_sequence)
) WITHOUT ROWID;

CREATE TABLE telemetry_event_v2 (
  scope TEXT NOT NULL REFERENCES telemetry_session_v2(scope),
  sequence INTEGER NOT NULL CHECK(typeof(sequence) = 'integer' AND sequence BETWEEN 1 AND 9007199254740991),
  event_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('DEAL', 'PROTECTION_OBSERVATION')),
  deal_id TEXT,
  revision INTEGER,
  previous_digest TEXT,
  record_digest TEXT NOT NULL,
  event_json TEXT NOT NULL CHECK(json_valid(event_json)),
  projection_json TEXT CHECK(projection_json IS NULL OR json_valid(projection_json)),
  PRIMARY KEY(scope, sequence),
  UNIQUE(scope, event_id),
  UNIQUE(scope, deal_id, revision),
  CHECK((kind = 'DEAL' AND deal_id IS NOT NULL AND revision IS NOT NULL AND typeof(revision) = 'integer' AND revision BETWEEN 1 AND 9007199254740991)
    OR (kind = 'PROTECTION_OBSERVATION' AND deal_id IS NULL AND revision IS NULL AND previous_digest IS NULL))
) WITHOUT ROWID;

CREATE TABLE telemetry_deal_current_v2 (
  scope TEXT NOT NULL,
  deal_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  revision INTEGER NOT NULL,
  record_digest TEXT NOT NULL,
  PRIMARY KEY(scope, deal_id),
  FOREIGN KEY(scope, sequence) REFERENCES telemetry_event_v2(scope, sequence)
) WITHOUT ROWID;

CREATE TRIGGER telemetry_session_v2_identity_immutable
BEFORE UPDATE ON telemetry_session_v2
WHEN NEW.account_id IS NOT OLD.account_id OR NEW.scope IS NOT OLD.scope
  OR NEW.identity_json IS NOT OLD.identity_json OR NEW.registration_json IS NOT OLD.registration_json
BEGIN SELECT RAISE(ABORT, 'TELEMETRY_IDENTITY_IMMUTABLE'); END;

CREATE TRIGGER telemetry_session_v2_no_delete
BEFORE DELETE ON telemetry_session_v2
BEGIN SELECT RAISE(ABORT, 'TELEMETRY_SESSION_IMMUTABLE'); END;

CREATE TRIGGER telemetry_receipt_v2_claim
BEFORE INSERT ON telemetry_receipt_v2
WHEN NOT EXISTS (SELECT 1 FROM telemetry_session_v2
  WHERE scope = NEW.scope AND last_request_sequence = NEW.request_sequence
    AND request_digest = NEW.request_digest AND last_event_sequence = NEW.acknowledged_events
    AND accepted_at = NEW.accepted_at)
BEGIN SELECT RAISE(ABORT, 'TELEMETRY_RECEIPT_CLAIM_INVALID'); END;

CREATE TRIGGER telemetry_receipt_v2_no_update
BEFORE UPDATE ON telemetry_receipt_v2
BEGIN SELECT RAISE(ABORT, 'TELEMETRY_RECEIPT_IMMUTABLE'); END;

CREATE TRIGGER telemetry_receipt_v2_no_delete
BEFORE DELETE ON telemetry_receipt_v2
BEGIN SELECT RAISE(ABORT, 'TELEMETRY_RECEIPT_IMMUTABLE'); END;

CREATE TRIGGER telemetry_event_v2_revision
BEFORE INSERT ON telemetry_event_v2
WHEN NEW.kind = 'DEAL' AND (
  NEW.revision != COALESCE((SELECT revision FROM telemetry_deal_current_v2 WHERE scope = NEW.scope AND deal_id = NEW.deal_id), 0) + 1
  OR NEW.previous_digest IS NOT (SELECT record_digest FROM telemetry_deal_current_v2 WHERE scope = NEW.scope AND deal_id = NEW.deal_id))
BEGIN SELECT RAISE(ABORT, 'TELEMETRY_REVISION_INVALID'); END;

CREATE TRIGGER telemetry_event_v2_no_update
BEFORE UPDATE ON telemetry_event_v2
BEGIN SELECT RAISE(ABORT, 'TELEMETRY_EVENT_IMMUTABLE'); END;

CREATE TRIGGER telemetry_event_v2_no_delete
BEFORE DELETE ON telemetry_event_v2
BEGIN SELECT RAISE(ABORT, 'TELEMETRY_EVENT_IMMUTABLE'); END;

CREATE TRIGGER telemetry_deal_current_v2_insert_guard
BEFORE INSERT ON telemetry_deal_current_v2
WHEN NOT EXISTS (SELECT 1 FROM telemetry_event_v2
  WHERE scope = NEW.scope AND sequence = NEW.sequence AND kind = 'DEAL'
    AND deal_id = NEW.deal_id AND revision = NEW.revision AND record_digest = NEW.record_digest)
BEGIN SELECT RAISE(ABORT, 'TELEMETRY_POINTER_INVALID'); END;

CREATE TRIGGER telemetry_deal_current_v2_update_guard
BEFORE UPDATE ON telemetry_deal_current_v2
WHEN NOT EXISTS (SELECT 1 FROM telemetry_event_v2
  WHERE scope = NEW.scope AND sequence = NEW.sequence AND kind = 'DEAL'
    AND deal_id = NEW.deal_id AND revision = NEW.revision AND record_digest = NEW.record_digest)
BEGIN SELECT RAISE(ABORT, 'TELEMETRY_POINTER_INVALID'); END;
