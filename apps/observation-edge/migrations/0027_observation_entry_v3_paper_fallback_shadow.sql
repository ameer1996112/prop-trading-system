-- Preserve hypothetical outcomes when a reviewed canonical entry cannot open
-- paper solely because paper configuration/readiness is unavailable.
DROP TRIGGER observation_entry_v3_shadow_positions_authorization_guard;

CREATE TRIGGER observation_entry_v3_shadow_positions_authorization_guard
BEFORE INSERT ON observation_entry_v3_shadow_positions
WHEN NOT EXISTS (
    SELECT 1
    FROM observation_entry_v3_candidates AS candidate
    JOIN observation_entry_v3_events AS event
        ON event.event_id = candidate.event_id
    WHERE candidate.candidate_id = NEW.candidate_id
      AND candidate.setup_id = NEW.setup_id
      AND candidate.state = 'MATCHED'
      AND event.event_role = 'ENTRY_DECISION'
      AND (
          (
              candidate.model = 'BOC'
              AND candidate.boc_tier = 'DISCRETIONARY_5M'
          )
          OR EXISTS (
              SELECT 1
              FROM observation_entry_v3_selections AS selection
              WHERE selection.event_id = candidate.event_id
                AND selection.setup_id = candidate.setup_id
                AND selection.attempt_kind = NEW.attempt_kind
                AND selection.canonical_candidate_id = candidate.candidate_id
                AND selection.policy_action = 'PAPER_ELIGIBLE'
                AND selection.action = 'SHADOW_ONLY'
                AND selection.effective_action_reason =
                    'PAPER_CONFIGURATION_UNAVAILABLE'
          )
      )
)
BEGIN
    SELECT RAISE(ABORT, 'v3 shadow position authorization rejected');
END;
