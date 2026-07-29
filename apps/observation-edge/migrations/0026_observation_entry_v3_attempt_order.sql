-- Supports latest-revision lookup per immutable setup attempt. SQLite rowid is
-- the append ordinal; every existing and future row already has one, so no
-- audit row is rewritten or backfilled.
CREATE INDEX idx_observation_entry_v3_selections_attempt_order
    ON observation_entry_v3_selections(
        setup_id,
        attempt_kind,
        evaluated_at_epoch DESC
    );
