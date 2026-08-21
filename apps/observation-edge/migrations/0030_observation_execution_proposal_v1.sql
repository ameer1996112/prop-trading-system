-- Immutable, account-free paper proposal evidence and a private inert outbox.
CREATE TABLE observation_execution_proposal_v1_events (
    event_id TEXT PRIMARY KEY NOT NULL CHECK (length(event_id) = 64),
    producer_instance_id TEXT NOT NULL,
    producer_sequence INTEGER NOT NULL CHECK (producer_sequence >= 1),
    proposal_sha256 TEXT NOT NULL CHECK (length(proposal_sha256) = 64),
    proposal_json TEXT NOT NULL CHECK (
        json_valid(proposal_json) AND json_type(proposal_json) = 'object'
    ),
    logical_candidate_id TEXT NOT NULL CHECK (length(logical_candidate_id) = 64),
    candidate_body_sha256 TEXT NOT NULL CHECK (length(candidate_body_sha256) = 64),
    execution_mode TEXT NOT NULL CHECK (execution_mode = 'PAPER_ONLY'),
    entry_model TEXT NOT NULL CHECK (entry_model = 'DIR_CLOSE'),
    liquidity_cohort TEXT NOT NULL CHECK (liquidity_cohort = 'TWO_PLUS_CANDLES'),
    direction TEXT NOT NULL CHECK (direction IN ('LONG', 'SHORT')),
    entry_ticks INTEGER NOT NULL,
    stop_ticks INTEGER NOT NULL,
    risk_distance_ticks INTEGER NOT NULL CHECK (risk_distance_ticks > 0),
    target_ticks INTEGER NOT NULL,
    received_at_epoch INTEGER NOT NULL CHECK (received_at_epoch >= 0),
    UNIQUE (producer_instance_id, producer_sequence),
    CHECK (
        (
            direction = 'LONG'
            AND stop_ticks < entry_ticks
            AND risk_distance_ticks = entry_ticks - stop_ticks
            AND target_ticks = entry_ticks + 4 * risk_distance_ticks
        )
        OR (
            direction = 'SHORT'
            AND stop_ticks > entry_ticks
            AND risk_distance_ticks = stop_ticks - entry_ticks
            AND target_ticks = entry_ticks - 4 * risk_distance_ticks
        )
    )
) STRICT;

CREATE INDEX idx_observation_execution_proposal_v1_logical_candidate
    ON observation_execution_proposal_v1_events(
        logical_candidate_id,
        candidate_body_sha256
    );

CREATE TRIGGER observation_execution_proposal_v1_candidate_conflict_guard
BEFORE INSERT ON observation_execution_proposal_v1_events
WHEN EXISTS (
    SELECT 1
    FROM observation_execution_proposal_v1_events AS existing
    WHERE existing.logical_candidate_id = NEW.logical_candidate_id
      AND existing.candidate_body_sha256 <> NEW.candidate_body_sha256
)
BEGIN
    SELECT RAISE(ABORT, 'logical candidate body conflict');
END;

CREATE TABLE observation_execution_proposal_v1_paper_results (
    event_id TEXT PRIMARY KEY NOT NULL
        REFERENCES observation_execution_proposal_v1_events(event_id) ON DELETE RESTRICT,
    status_code INTEGER NOT NULL CHECK (status_code = 202),
    response_json TEXT NOT NULL CHECK (
        json_valid(response_json) AND json_type(response_json) = 'object'
    ),
    recorded_at_epoch INTEGER NOT NULL CHECK (recorded_at_epoch >= 0)
) STRICT;

-- Checkpoints are immutable sequence facts. The current checkpoint is the
-- greatest producer_sequence, so accepting the next proposal needs no update.
CREATE TABLE observation_execution_producer_checkpoints (
    checkpoint_id TEXT PRIMARY KEY NOT NULL CHECK (length(checkpoint_id) = 64),
    producer_instance_id TEXT NOT NULL,
    producer_sequence INTEGER NOT NULL CHECK (producer_sequence >= 1),
    proposal_sha256 TEXT NOT NULL CHECK (length(proposal_sha256) = 64),
    recorded_at_epoch INTEGER NOT NULL CHECK (recorded_at_epoch >= 0),
    UNIQUE (producer_instance_id, producer_sequence)
) STRICT;

CREATE INDEX idx_observation_execution_producer_checkpoint_latest
    ON observation_execution_producer_checkpoints(
        producer_instance_id,
        producer_sequence DESC
    );

CREATE TABLE observation_execution_producer_incidents (
    incident_id TEXT PRIMARY KEY NOT NULL CHECK (length(incident_id) = 64),
    producer_instance_id TEXT NOT NULL,
    producer_sequence INTEGER NOT NULL CHECK (producer_sequence >= 1),
    incident_kind TEXT NOT NULL CHECK (
        incident_kind IN ('SEQUENCE_GAP', 'OUT_OF_ORDER', 'BODY_CONFLICT', 'CANDIDATE_CONFLICT')
    ),
    expected_sequence INTEGER NOT NULL CHECK (expected_sequence >= 1),
    proposal_sha256 TEXT NOT NULL CHECK (length(proposal_sha256) = 64),
    existing_sha256 TEXT CHECK (existing_sha256 IS NULL OR length(existing_sha256) = 64),
    incident_json TEXT NOT NULL CHECK (
        json_valid(incident_json) AND json_type(incident_json) = 'object'
    ),
    recorded_at_epoch INTEGER NOT NULL CHECK (recorded_at_epoch >= 0)
) STRICT;

CREATE INDEX idx_observation_execution_producer_incidents_sequence
    ON observation_execution_producer_incidents(
        producer_instance_id,
        producer_sequence,
        recorded_at_epoch
    );

CREATE TABLE observation_execution_candidate_v1_payloads (
    logical_candidate_id TEXT PRIMARY KEY NOT NULL CHECK (length(logical_candidate_id) = 64),
    candidate_body_sha256 TEXT NOT NULL CHECK (length(candidate_body_sha256) = 64),
    event_id TEXT NOT NULL UNIQUE
        REFERENCES observation_execution_proposal_v1_events(event_id) ON DELETE RESTRICT,
    execution_mode TEXT NOT NULL CHECK (execution_mode = 'PAPER_ONLY'),
    payload_json TEXT NOT NULL CHECK (
        json_valid(payload_json) AND json_type(payload_json) = 'object'
    ),
    created_at_epoch INTEGER NOT NULL CHECK (created_at_epoch >= 0),
    expires_at_epoch INTEGER NOT NULL CHECK (expires_at_epoch >= 0)
) STRICT;

CREATE TABLE observation_execution_candidate_v1_deliveries (
    logical_candidate_id TEXT PRIMARY KEY NOT NULL
        REFERENCES observation_execution_candidate_v1_payloads(logical_candidate_id)
        ON DELETE RESTRICT,
    status TEXT NOT NULL CHECK (
        status IN ('PENDING', 'RETRY', 'CLAIMED', 'ACKNOWLEDGED', 'EXPIRED', 'FAILED_TERMINAL')
    ),
    attempt_count INTEGER NOT NULL CHECK (attempt_count BETWEEN 0 AND 5),
    next_attempt_at_epoch INTEGER NOT NULL CHECK (next_attempt_at_epoch >= 0),
    lease_owner TEXT,
    lease_expires_at_epoch INTEGER,
    claim_token TEXT CHECK (claim_token IS NULL OR length(claim_token) = 64),
    acknowledged_at_epoch INTEGER,
    receiver_status INTEGER CHECK (
        receiver_status IS NULL OR receiver_status BETWEEN 100 AND 599
    ),
    last_error TEXT,
    created_at_epoch INTEGER NOT NULL CHECK (created_at_epoch >= 0),
    expires_at_epoch INTEGER NOT NULL CHECK (expires_at_epoch >= 0),
    updated_at_epoch INTEGER NOT NULL CHECK (updated_at_epoch >= created_at_epoch),
    CHECK (
        (
            status = 'CLAIMED'
            AND lease_owner IS NOT NULL
            AND lease_expires_at_epoch IS NOT NULL
            AND claim_token IS NOT NULL
        )
        OR (
            status <> 'CLAIMED'
            AND lease_owner IS NULL
            AND lease_expires_at_epoch IS NULL
            AND claim_token IS NULL
        )
    ),
    CHECK (
        (status = 'ACKNOWLEDGED' AND acknowledged_at_epoch IS NOT NULL)
        OR (status <> 'ACKNOWLEDGED' AND acknowledged_at_epoch IS NULL)
    )
) STRICT;

CREATE INDEX idx_observation_execution_candidate_delivery_claim
    ON observation_execution_candidate_v1_deliveries(
        status,
        next_attempt_at_epoch,
        created_at_epoch,
        logical_candidate_id
    );

CREATE UNIQUE INDEX idx_observation_execution_candidate_delivery_claim_token
    ON observation_execution_candidate_v1_deliveries(claim_token)
    WHERE claim_token IS NOT NULL;

CREATE TRIGGER observation_execution_candidate_v1_deliveries_update_guard
BEFORE UPDATE ON observation_execution_candidate_v1_deliveries
WHEN NEW.logical_candidate_id <> OLD.logical_candidate_id
  OR NEW.created_at_epoch <> OLD.created_at_epoch
  OR NEW.expires_at_epoch <> OLD.expires_at_epoch
  OR NOT (
      (OLD.status IN ('PENDING', 'RETRY') AND NEW.status IN ('CLAIMED', 'EXPIRED'))
      OR (OLD.status = 'CLAIMED' AND NEW.status IN (
          'ACKNOWLEDGED', 'RETRY', 'EXPIRED', 'FAILED_TERMINAL'
      ))
  )
BEGIN
    SELECT RAISE(ABORT, 'invalid delivery transition');
END;

CREATE TRIGGER observation_execution_candidate_v1_deliveries_no_delete
BEFORE DELETE ON observation_execution_candidate_v1_deliveries
BEGIN SELECT RAISE(ABORT, 'append-only delivery identity'); END;

CREATE TRIGGER observation_execution_proposal_v1_events_no_update
BEFORE UPDATE ON observation_execution_proposal_v1_events
BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TRIGGER observation_execution_proposal_v1_events_no_delete
BEFORE DELETE ON observation_execution_proposal_v1_events
BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TRIGGER observation_execution_proposal_v1_paper_results_no_update
BEFORE UPDATE ON observation_execution_proposal_v1_paper_results
BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TRIGGER observation_execution_proposal_v1_paper_results_no_delete
BEFORE DELETE ON observation_execution_proposal_v1_paper_results
BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TRIGGER observation_execution_producer_checkpoints_no_update
BEFORE UPDATE ON observation_execution_producer_checkpoints
BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TRIGGER observation_execution_producer_checkpoints_no_delete
BEFORE DELETE ON observation_execution_producer_checkpoints
BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TRIGGER observation_execution_producer_incidents_no_update
BEFORE UPDATE ON observation_execution_producer_incidents
BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TRIGGER observation_execution_producer_incidents_no_delete
BEFORE DELETE ON observation_execution_producer_incidents
BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TRIGGER observation_execution_candidate_v1_payloads_no_update
BEFORE UPDATE ON observation_execution_candidate_v1_payloads
BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TRIGGER observation_execution_candidate_v1_payloads_no_delete
BEFORE DELETE ON observation_execution_candidate_v1_payloads
BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
