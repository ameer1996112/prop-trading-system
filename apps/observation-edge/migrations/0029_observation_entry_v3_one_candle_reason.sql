-- Persist the canonical fail-closed reason for attempted one-candle paper
-- promotion without weakening any existing selection constraint.
PRAGMA defer_foreign_keys = ON;

DROP TRIGGER observation_entry_v3_paper_links_authorization_guard;
DROP TRIGGER observation_entry_v3_shadow_positions_authorization_guard;

CREATE TABLE observation_entry_v3_selections_one_candle_reason (
    selection_id TEXT PRIMARY KEY NOT NULL,
    logical_selection_id TEXT NOT NULL,
    event_id TEXT NOT NULL
        REFERENCES observation_entry_v3_events(event_id) ON DELETE RESTRICT,
    setup_id TEXT NOT NULL,
    attempt_kind TEXT NOT NULL CHECK (attempt_kind IN ('INITIAL', 'RE_ENTRY')),
    policy_version TEXT NOT NULL CHECK (
        policy_version = 'rd-entry-arbitration-v3'
    ),
    revision INTEGER NOT NULL CHECK (revision >= 0),
    canonical_candidate_id TEXT,
    canonical_evidence_id TEXT,
    canonical_model TEXT CHECK (
        canonical_model IS NULL
        OR canonical_model IN ('BOC', 'DIR_CLOSE', 'HTF_FLIP')
    ),
    reason TEXT NOT NULL CHECK (
        reason IN (
            'ONLY_EXACT_TRIGGER',
            'EARLIEST_EXACT_TRIGGER',
            'FALLBACK_TO_CONFIRMED_CLOSE',
            'CO_TRIGGER_SAME_EVENT',
            'CO_TRIGGER_PRICE_CONFLICT',
            'NO_EXACT_CANDIDATE',
            'SETUP_INVALIDATED',
            'NO_CANDIDATE'
        )
    ),
    fidelity TEXT CHECK (
        fidelity IS NULL
        OR fidelity IN ('EXACT', 'CALIBRATED', 'DISCRETIONARY', 'UNRESOLVED')
    ),
    policy_action TEXT NOT NULL CHECK (
        policy_action IN ('OBSERVE', 'PAPER_ELIGIBLE', 'SHADOW_ONLY', 'NONE')
    ),
    action TEXT NOT NULL CHECK (
        action IN ('OBSERVE', 'PAPER_ELIGIBLE', 'SHADOW_ONLY', 'NONE')
    ),
    effective_action_reason TEXT CHECK (
        effective_action_reason IS NULL
        OR effective_action_reason IN (
            'ONE_CANDLE_EXPERIMENT_NOT_PROMOTED',
            'PROMOTION_IDENTITY_MISMATCH',
            'PAPER_CONFIGURATION_UNAVAILABLE',
            'NOT_SELECTED_ALREADY_OPEN'
        )
    ),
    liquidity_cohort TEXT NOT NULL DEFAULT 'TWO_PLUS_CANDLES' CHECK (
        liquidity_cohort IN ('ONE_CANDLE', 'TWO_PLUS_CANDLES')
    ),
    one_candle_enabled INTEGER NOT NULL DEFAULT 0 CHECK (
        one_candle_enabled IN (0, 1)
    ),
    co_triggered_models_json TEXT NOT NULL CHECK (
        json_valid(co_triggered_models_json)
        AND json_type(co_triggered_models_json) = 'array'
    ),
    evaluated_at_epoch INTEGER NOT NULL CHECK (evaluated_at_epoch >= 0),
    selected_trigger_epoch INTEGER,
    selected_trigger_sequence INTEGER,
    entry_ticks INTEGER NOT NULL,
    stop_ticks INTEGER NOT NULL,
    target_ticks INTEGER NOT NULL,
    selection_json TEXT NOT NULL CHECK (
        json_valid(selection_json) AND json_type(selection_json) = 'object'
    ),
    UNIQUE (event_id, logical_selection_id),
    CHECK (
        (selected_trigger_epoch IS NULL) =
        (selected_trigger_sequence IS NULL)
    ),
    CHECK (
        action <> 'PAPER_ELIGIBLE'
        OR (
            policy_action = 'PAPER_ELIGIBLE'
            AND canonical_candidate_id IS NOT NULL
            AND canonical_evidence_id IS NOT NULL
            AND canonical_model IS NOT NULL
            AND fidelity = 'EXACT'
            AND selected_trigger_epoch IS NOT NULL
            AND effective_action_reason IS NULL
        )
    )
) STRICT;

INSERT INTO observation_entry_v3_selections_one_candle_reason (
    selection_id, logical_selection_id, event_id, setup_id, attempt_kind,
    policy_version, revision, canonical_candidate_id, canonical_evidence_id,
    canonical_model, reason, fidelity, policy_action, action,
    effective_action_reason, liquidity_cohort, one_candle_enabled,
    co_triggered_models_json, evaluated_at_epoch, selected_trigger_epoch,
    selected_trigger_sequence, entry_ticks, stop_ticks, target_ticks,
    selection_json
)
SELECT
    selection_id, logical_selection_id, event_id, setup_id, attempt_kind,
    policy_version, revision, canonical_candidate_id, canonical_evidence_id,
    canonical_model, reason, fidelity, policy_action, action,
    effective_action_reason, liquidity_cohort, one_candle_enabled,
    co_triggered_models_json, evaluated_at_epoch, selected_trigger_epoch,
    selected_trigger_sequence, entry_ticks, stop_ticks, target_ticks,
    selection_json
FROM observation_entry_v3_selections;

DROP TABLE observation_entry_v3_selections;
ALTER TABLE observation_entry_v3_selections_one_candle_reason
    RENAME TO observation_entry_v3_selections;

CREATE INDEX idx_observation_entry_v3_selections_decision_order
    ON observation_entry_v3_selections(
        evaluated_at_epoch DESC,
        selection_id DESC
    );
CREATE INDEX idx_observation_entry_v3_selections_attempt_order
    ON observation_entry_v3_selections(
        setup_id,
        attempt_kind,
        evaluated_at_epoch DESC
    );

CREATE TRIGGER observation_entry_v3_selections_no_update
BEFORE UPDATE ON observation_entry_v3_selections
BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TRIGGER observation_entry_v3_selections_no_delete
BEFORE DELETE ON observation_entry_v3_selections
BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TRIGGER observation_entry_v3_selections_liquidity_cohort_insert_guard
BEFORE INSERT ON observation_entry_v3_selections
WHEN NEW.liquidity_cohort = 'ONE_CANDLE' AND NEW.one_candle_enabled = 0
BEGIN
    SELECT RAISE(ABORT, 'one-candle cohort requires enabled flag');
END;
CREATE TRIGGER observation_entry_v3_selections_liquidity_cohort_update_guard
BEFORE UPDATE ON observation_entry_v3_selections
WHEN NEW.liquidity_cohort = 'ONE_CANDLE' AND NEW.one_candle_enabled = 0
BEGIN
    SELECT RAISE(ABORT, 'one-candle cohort requires enabled flag');
END;

CREATE TRIGGER observation_entry_v3_paper_links_authorization_guard
BEFORE INSERT ON observation_entry_v3_paper_links
WHEN NOT EXISTS (
    SELECT 1
    FROM observation_entry_v3_selections AS selection
    JOIN observation_entry_v3_events AS event
        ON event.event_id = selection.event_id
    WHERE selection.selection_id = NEW.selection_id
      AND selection.setup_id = NEW.setup_id
      AND selection.attempt_kind = NEW.attempt_kind
      AND selection.action = 'PAPER_ELIGIBLE'
      AND selection.liquidity_cohort = 'TWO_PLUS_CANDLES'
      AND event.event_role = 'ENTRY_DECISION'
)
BEGIN
    SELECT RAISE(ABORT, 'v3 paper link authorization rejected');
END;

CREATE TRIGGER observation_entry_v3_shadow_positions_authorization_guard
BEFORE INSERT ON observation_entry_v3_shadow_positions
WHEN NOT EXISTS (
    SELECT 1
    FROM observation_entry_v3_candidates AS candidate
    JOIN observation_entry_v3_events AS event
        ON event.event_id = candidate.event_id
    JOIN observation_entry_v3_selections AS selection
        ON selection.event_id = candidate.event_id
        AND selection.setup_id = candidate.setup_id
        AND selection.attempt_kind = NEW.attempt_kind
    WHERE candidate.candidate_id = NEW.candidate_id
      AND candidate.setup_id = NEW.setup_id
      AND candidate.state = 'MATCHED'
      AND event.event_role = 'ENTRY_DECISION'
      AND selection.liquidity_cohort = NEW.liquidity_cohort
      AND selection.one_candle_enabled = NEW.one_candle_enabled
      AND (
          (
              selection.liquidity_cohort = 'TWO_PLUS_CANDLES'
              AND candidate.model = 'BOC'
              AND candidate.boc_tier = 'DISCRETIONARY_5M'
          )
          OR (
              selection.liquidity_cohort = 'TWO_PLUS_CANDLES'
              AND selection.canonical_candidate_id = candidate.candidate_id
              AND selection.policy_action = 'PAPER_ELIGIBLE'
              AND selection.action = 'SHADOW_ONLY'
              AND selection.effective_action_reason =
                  'PAPER_CONFIGURATION_UNAVAILABLE'
          )
          OR (
              selection.liquidity_cohort = 'ONE_CANDLE'
              AND selection.one_candle_enabled = 1
              AND selection.policy_action = 'SHADOW_ONLY'
              AND selection.action = 'SHADOW_ONLY'
              AND selection.evaluated_at_epoch = NEW.evaluated_at_epoch
              AND EXISTS (
                  SELECT 1
                  FROM observation_entry_v3_selection_members AS member
                  WHERE member.selection_id = selection.selection_id
                    AND member.object_kind = 'CANDIDATE'
                    AND member.object_id = candidate.candidate_id
              )
          )
      )
)
BEGIN
    SELECT RAISE(ABORT, 'v3 shadow position authorization rejected');
END;

PRAGMA foreign_key_check;
PRAGMA defer_foreign_keys = OFF;
