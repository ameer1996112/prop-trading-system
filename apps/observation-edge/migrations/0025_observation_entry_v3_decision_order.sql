CREATE INDEX idx_observation_entry_v3_selections_decision_order
    ON observation_entry_v3_selections(evaluated_at_epoch DESC, selection_id DESC);
