-- Contract-v3 observations are stored beside the contract-v2 projection.
-- Economic authorization is represented only by the paper link table; the
-- observation tables are immutable audit facts.
--
-- Existing child tables keep their contract-v2 receipt parent. A new current
-- receipt registry admits 3.0 and mirrors only legacy/contract-v2 inserts into
-- that retained parent. This avoids deleting, rewriting, or temporarily
-- detaching any historical append-only child row during the upgrade.
ALTER TABLE observation_receipts
    RENAME TO observation_receipts_contract_v2_archive;

DROP INDEX idx_observation_receipts_received;
DROP INDEX idx_observation_receipts_producer_sequence;

CREATE TABLE observation_receipts (
    receipt_id TEXT PRIMARY KEY NOT NULL,
    received_at TEXT NOT NULL,
    idempotency_key TEXT NOT NULL UNIQUE,
    payload_sha256 TEXT NOT NULL,
    schema_version TEXT NOT NULL CHECK (
        schema_version IN ('1.0', '1.1', '1.2', '2.0', '3.0')
    ),
    strategy_id TEXT NOT NULL CHECK (strategy_id = 'rd_liquidity_sd_5m_v1'),
    strategy_version TEXT NOT NULL CHECK (
        (schema_version = '1.0' AND strategy_version = '1.0.0-phase1')
        OR
        (schema_version = '1.1' AND strategy_version = '1.1.0-paper1')
        OR
        (schema_version = '1.2' AND strategy_version = '1.2.0-contract1')
        OR
        (schema_version = '2.0' AND strategy_version = '2.0.0-contract2')
        OR
        (schema_version = '3.0' AND strategy_version = '3.0.0-contract3')
    ),
    producer_instance_id TEXT NOT NULL,
    sequence INTEGER NOT NULL CHECK (
        (schema_version IN ('2.0', '3.0') AND sequence >= 1)
        OR
        (schema_version IN ('1.0', '1.1', '1.2') AND sequence >= 0)
    ),
    symbol TEXT NOT NULL,
    ticker_id TEXT NOT NULL,
    feed TEXT NOT NULL,
    timeframe TEXT NOT NULL CHECK (timeframe = '5'),
    kind TEXT NOT NULL CHECK (kind IN ('incremental', 'snapshot')),
    CHECK (
        length(payload_sha256) = 64
        AND (
            schema_version IN ('1.0', '1.1', '1.2')
            OR payload_sha256 NOT GLOB '*[^0-9a-f]*'
        )
    )
) STRICT;

INSERT INTO observation_receipts
SELECT * FROM observation_receipts_contract_v2_archive;

CREATE TRIGGER observation_receipts_mirror_contract_v2
AFTER INSERT ON observation_receipts
WHEN NEW.schema_version <> '3.0'
BEGIN
    INSERT INTO observation_receipts_contract_v2_archive
    VALUES (
        NEW.receipt_id, NEW.received_at, NEW.idempotency_key,
        NEW.payload_sha256, NEW.schema_version, NEW.strategy_id,
        NEW.strategy_version, NEW.producer_instance_id, NEW.sequence,
        NEW.symbol, NEW.ticker_id, NEW.feed, NEW.timeframe, NEW.kind
    );
END;

CREATE INDEX idx_observation_receipts_received
    ON observation_receipts(received_at DESC, receipt_id DESC);
CREATE INDEX idx_observation_receipts_producer_sequence
    ON observation_receipts(producer_instance_id, sequence DESC);

CREATE TABLE observation_entry_v3_events (
    event_id TEXT PRIMARY KEY NOT NULL,
    receipt_id TEXT NOT NULL UNIQUE
        REFERENCES observation_receipts(receipt_id) ON DELETE RESTRICT,
    producer_instance_id TEXT NOT NULL,
    producer_sequence INTEGER NOT NULL CHECK (producer_sequence >= 1),
    strategy_version TEXT NOT NULL
        CHECK (strategy_version = '3.0.0-contract3'),
    rule_contract_version TEXT NOT NULL CHECK (rule_contract_version = '3.0.0'),
    event_role TEXT NOT NULL CHECK (
        event_role IN ('ENTRY_DECISION', 'EXIT_FOLLOWUP')
    ),
    is_realtime INTEGER NOT NULL CHECK (is_realtime IN (0, 1)),
    symbol TEXT NOT NULL,
    tick_size TEXT NOT NULL,
    detector_code_hash TEXT NOT NULL,
    settings_hash TEXT NOT NULL,
    validated_payload_json TEXT NOT NULL CHECK (
        json_valid(validated_payload_json)
        AND json_type(validated_payload_json) = 'object'
    ),
    payload_sha256 TEXT NOT NULL CHECK (
        length(payload_sha256) = 64
        AND payload_sha256 NOT GLOB '*[^0-9a-f]*'
    ),
    observed_at_epoch INTEGER NOT NULL CHECK (observed_at_epoch >= 0),
    recorded_at TEXT NOT NULL,
    UNIQUE (producer_instance_id, producer_sequence)
) STRICT;

CREATE TABLE observation_entry_v3_candidates (
    candidate_id TEXT PRIMARY KEY NOT NULL,
    logical_candidate_id TEXT NOT NULL,
    event_id TEXT NOT NULL
        REFERENCES observation_entry_v3_events(event_id) ON DELETE RESTRICT,
    setup_id TEXT NOT NULL,
    model TEXT NOT NULL CHECK (model IN ('BOC', 'DIR_CLOSE', 'HTF_FLIP')),
    state TEXT NOT NULL CHECK (state IN ('MATCHED', 'BLOCKED', 'REJECTED')),
    direction TEXT NOT NULL CHECK (direction IN ('LONG', 'SHORT')),
    event_anchor_epoch INTEGER NOT NULL CHECK (event_anchor_epoch >= 0),
    trigger_ordinal INTEGER NOT NULL CHECK (trigger_ordinal >= 1),
    boc_tier TEXT CHECK (boc_tier IN ('HTF_TIMED', 'DISCRETIONARY_5M')),
    reference_candle_open_epoch INTEGER CHECK (
        reference_candle_open_epoch IS NULL
        OR reference_candle_open_epoch >= 0
    ),
    source_claim_ids_json TEXT NOT NULL CHECK (
        json_valid(source_claim_ids_json)
        AND json_type(source_claim_ids_json) = 'array'
    ),
    candidate_json TEXT NOT NULL CHECK (
        json_valid(candidate_json) AND json_type(candidate_json) = 'object'
    ),
    observed_at_epoch INTEGER NOT NULL CHECK (observed_at_epoch >= 0),
    UNIQUE (event_id, logical_candidate_id),
    CHECK (
        (
            model = 'BOC'
            AND boc_tier IS NOT NULL
            AND reference_candle_open_epoch IS NOT NULL
        )
        OR
        (
            model <> 'BOC'
            AND boc_tier IS NULL
            AND reference_candle_open_epoch IS NULL
        )
    )
) STRICT;

CREATE TABLE observation_entry_v3_evidence (
    evidence_id TEXT PRIMARY KEY NOT NULL,
    logical_evidence_id TEXT NOT NULL,
    event_id TEXT NOT NULL
        REFERENCES observation_entry_v3_events(event_id) ON DELETE RESTRICT,
    candidate_id TEXT NOT NULL
        REFERENCES observation_entry_v3_candidates(candidate_id)
        ON DELETE RESTRICT,
    logical_candidate_id TEXT NOT NULL,
    observed_trigger_epoch INTEGER,
    trigger_sequence INTEGER NOT NULL CHECK (trigger_sequence >= 0),
    observed_trigger_ticks INTEGER,
    fidelity TEXT NOT NULL CHECK (
        fidelity IN ('EXACT', 'CALIBRATED', 'DISCRETIONARY', 'UNRESOLVED')
    ),
    proof_plane TEXT NOT NULL CHECK (
        proof_plane IN (
            'CONFIRMED_5M',
            'LOWER_TIMEFRAME_REPLAY',
            'REALTIME_TICK',
            'EXTERNAL_ARCHIVED_TICK'
        )
    ),
    replayability TEXT NOT NULL CHECK (
        replayability IN ('REPLAYABLE', 'LIVE_EXACT_NON_REPLAYABLE')
    ),
    evidence_json TEXT NOT NULL CHECK (
        json_valid(evidence_json) AND json_type(evidence_json) = 'object'
    ),
    observed_at_epoch INTEGER NOT NULL CHECK (observed_at_epoch >= 0),
    UNIQUE (event_id, logical_evidence_id),
    CHECK (
        (observed_trigger_epoch IS NULL) =
        (observed_trigger_ticks IS NULL)
    )
) STRICT;

CREATE TABLE observation_entry_v3_selections (
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
            'PROMOTION_IDENTITY_MISMATCH',
            'PAPER_CONFIGURATION_UNAVAILABLE',
            'NOT_SELECTED_ALREADY_OPEN'
        )
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

CREATE TABLE observation_entry_v3_selection_members (
    selection_id TEXT NOT NULL
        REFERENCES observation_entry_v3_selections(selection_id)
        ON DELETE RESTRICT,
    object_kind TEXT NOT NULL CHECK (object_kind IN ('CANDIDATE', 'EVIDENCE')),
    object_id TEXT NOT NULL,
    PRIMARY KEY (selection_id, object_kind, object_id)
) STRICT;

CREATE TABLE observation_entry_v3_parity (
    parity_id TEXT PRIMARY KEY NOT NULL,
    event_id TEXT NOT NULL,
    selection_id TEXT NOT NULL UNIQUE
        REFERENCES observation_entry_v3_selections(selection_id)
        ON DELETE RESTRICT,
    parity_status TEXT NOT NULL CHECK (
        parity_status IN ('MATCH', 'MISMATCH', 'NOT_PROVIDED')
    ),
    mismatch_reason TEXT CHECK (
        mismatch_reason IS NULL
        OR mismatch_reason IN (
            'CANDIDATE_IDENTITIES',
            'EVIDENCE_IDENTITIES',
            'SELECTED_CANDIDATE',
            'REASON',
            'ACTION',
            'MULTIPLE'
        )
    ),
    compared_at TEXT NOT NULL,
    FOREIGN KEY (event_id)
        REFERENCES observation_entry_v3_events(event_id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE observation_entry_v3_paper_links (
    setup_id TEXT NOT NULL,
    attempt_kind TEXT NOT NULL CHECK (attempt_kind IN ('INITIAL', 'RE_ENTRY')),
    selection_id TEXT NOT NULL UNIQUE
        REFERENCES observation_entry_v3_selections(selection_id)
        ON DELETE RESTRICT,
    intent_id TEXT NOT NULL UNIQUE
        REFERENCES paper_trade_intents(intent_id) ON DELETE RESTRICT,
    direction TEXT NOT NULL CHECK (direction IN ('LONG', 'SHORT')),
    trigger_epoch INTEGER NOT NULL CHECK (trigger_epoch >= 0),
    trigger_sequence INTEGER NOT NULL CHECK (trigger_sequence >= 0),
    evaluated_at_epoch INTEGER NOT NULL CHECK (evaluated_at_epoch >= 0),
    entry_ticks INTEGER NOT NULL,
    stop_ticks INTEGER NOT NULL,
    target_ticks INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (setup_id, attempt_kind)
) STRICT;

CREATE TABLE observation_entry_v3_shadow_positions (
    candidate_id TEXT PRIMARY KEY NOT NULL
        REFERENCES observation_entry_v3_candidates(candidate_id)
        ON DELETE RESTRICT,
    setup_id TEXT NOT NULL,
    attempt_kind TEXT NOT NULL CHECK (attempt_kind IN ('INITIAL', 'RE_ENTRY')),
    direction TEXT NOT NULL CHECK (direction IN ('LONG', 'SHORT')),
    trigger_epoch INTEGER NOT NULL CHECK (trigger_epoch >= 0),
    trigger_sequence INTEGER NOT NULL CHECK (trigger_sequence >= 0),
    evaluated_at_epoch INTEGER NOT NULL CHECK (evaluated_at_epoch >= 0),
    entry_ticks INTEGER NOT NULL,
    stop_ticks INTEGER NOT NULL,
    target_ticks INTEGER NOT NULL,
    state TEXT NOT NULL CHECK (
        state IN ('OPEN', 'STOPPED', 'TARGET_HIT', 'AMBIGUOUS')
    ),
    exit_event_id TEXT,
    outcome_r_millis INTEGER CHECK (
        outcome_r_millis IS NULL
        OR outcome_r_millis BETWEEN -1000 AND 10000
    ),
    created_at TEXT NOT NULL,
    terminal_at TEXT,
    UNIQUE (setup_id, attempt_kind),
    CHECK (
        (
            state = 'OPEN'
            AND exit_event_id IS NULL
            AND outcome_r_millis IS NULL
            AND terminal_at IS NULL
        )
        OR
        (
            state = 'STOPPED'
            AND exit_event_id IS NOT NULL
            AND outcome_r_millis = -1000
            AND terminal_at IS NOT NULL
        )
        OR
        (
            state = 'TARGET_HIT'
            AND exit_event_id IS NOT NULL
            AND outcome_r_millis BETWEEN 0 AND 10000
            AND terminal_at IS NOT NULL
        )
        OR
        (
            state = 'AMBIGUOUS'
            AND exit_event_id IS NOT NULL
            AND outcome_r_millis IS NULL
            AND terminal_at IS NOT NULL
        )
    )
) STRICT;

CREATE TABLE observation_entry_v3_exit_applications (
    application_id TEXT PRIMARY KEY NOT NULL,
    event_id TEXT NOT NULL
        REFERENCES observation_entry_v3_events(event_id) ON DELETE RESTRICT,
    exit_event_id TEXT NOT NULL,
    setup_id TEXT NOT NULL,
    attempt_kind TEXT NOT NULL CHECK (attempt_kind IN ('INITIAL', 'RE_ENTRY')),
    target_kind TEXT NOT NULL CHECK (target_kind IN ('PAPER', 'SHADOW')),
    intent_id TEXT REFERENCES paper_trade_intents(intent_id) ON DELETE RESTRICT,
    candidate_id TEXT REFERENCES observation_entry_v3_candidates(candidate_id)
        ON DELETE RESTRICT,
    terminal_code TEXT NOT NULL CHECK (
        terminal_code IN ('STOP', 'TARGET', 'STOPPED', 'TARGET_HIT', 'AMBIGUOUS')
    ),
    outcome_r_millis INTEGER CHECK (
        outcome_r_millis IS NULL
        OR outcome_r_millis BETWEEN -1000 AND 10000
    ),
    applied_at TEXT NOT NULL,
    UNIQUE (exit_event_id, target_kind),
    UNIQUE (target_kind, setup_id, attempt_kind),
    CHECK (
        (target_kind = 'PAPER' AND intent_id IS NOT NULL AND candidate_id IS NULL)
        OR
        (target_kind = 'SHADOW' AND candidate_id IS NOT NULL AND intent_id IS NULL)
    )
) STRICT;

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
    WHERE candidate.candidate_id = NEW.candidate_id
      AND candidate.setup_id = NEW.setup_id
      AND candidate.model = 'BOC'
      AND candidate.boc_tier = 'DISCRETIONARY_5M'
      AND candidate.state = 'MATCHED'
      AND event.event_role = 'ENTRY_DECISION'
)
BEGIN
    SELECT RAISE(ABORT, 'v3 shadow position authorization rejected');
END;

CREATE TRIGGER observation_entry_v3_shadow_positions_state_guard
BEFORE UPDATE ON observation_entry_v3_shadow_positions
WHEN
    OLD.state <> 'OPEN'
    OR NEW.state = 'OPEN'
    OR NEW.candidate_id <> OLD.candidate_id
    OR NEW.setup_id <> OLD.setup_id
    OR NEW.attempt_kind <> OLD.attempt_kind
    OR NEW.direction <> OLD.direction
    OR NEW.trigger_epoch <> OLD.trigger_epoch
    OR NEW.trigger_sequence <> OLD.trigger_sequence
    OR NEW.evaluated_at_epoch <> OLD.evaluated_at_epoch
    OR NEW.entry_ticks <> OLD.entry_ticks
    OR NEW.stop_ticks <> OLD.stop_ticks
    OR NEW.target_ticks <> OLD.target_ticks
    OR NEW.created_at <> OLD.created_at
BEGIN
    SELECT RAISE(ABORT, 'shadow position transition rejected');
END;

CREATE TRIGGER observation_entry_v3_shadow_positions_no_delete
BEFORE DELETE ON observation_entry_v3_shadow_positions
BEGIN SELECT RAISE(ABORT, 'append-only table'); END;

CREATE TRIGGER observation_entry_v3_events_no_update
BEFORE UPDATE ON observation_entry_v3_events
BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TRIGGER observation_entry_v3_events_no_delete
BEFORE DELETE ON observation_entry_v3_events
BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TRIGGER observation_entry_v3_candidates_no_update
BEFORE UPDATE ON observation_entry_v3_candidates
BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TRIGGER observation_entry_v3_candidates_no_delete
BEFORE DELETE ON observation_entry_v3_candidates
BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TRIGGER observation_entry_v3_evidence_no_update
BEFORE UPDATE ON observation_entry_v3_evidence
BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TRIGGER observation_entry_v3_evidence_no_delete
BEFORE DELETE ON observation_entry_v3_evidence
BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TRIGGER observation_entry_v3_selections_no_update
BEFORE UPDATE ON observation_entry_v3_selections
BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TRIGGER observation_entry_v3_selections_no_delete
BEFORE DELETE ON observation_entry_v3_selections
BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TRIGGER observation_entry_v3_selection_members_no_update
BEFORE UPDATE ON observation_entry_v3_selection_members
BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TRIGGER observation_entry_v3_selection_members_no_delete
BEFORE DELETE ON observation_entry_v3_selection_members
BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TRIGGER observation_entry_v3_parity_no_update
BEFORE UPDATE ON observation_entry_v3_parity
BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TRIGGER observation_entry_v3_parity_no_delete
BEFORE DELETE ON observation_entry_v3_parity
BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TRIGGER observation_entry_v3_paper_links_no_update
BEFORE UPDATE ON observation_entry_v3_paper_links
BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TRIGGER observation_entry_v3_paper_links_no_delete
BEFORE DELETE ON observation_entry_v3_paper_links
BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TRIGGER observation_entry_v3_exit_applications_no_update
BEFORE UPDATE ON observation_entry_v3_exit_applications
BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
CREATE TRIGGER observation_entry_v3_exit_applications_no_delete
BEFORE DELETE ON observation_entry_v3_exit_applications
BEGIN SELECT RAISE(ABORT, 'append-only table'); END;
