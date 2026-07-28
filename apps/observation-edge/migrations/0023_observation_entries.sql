-- Immutable normalized projections for server-validated RD entry observations.
-- These tables contain observation and audit facts only; they have no live
-- execution, external-venue, order-command, raw-credential, or raw-payload path.
CREATE TABLE observation_entry_batches (
    batch_id TEXT PRIMARY KEY NOT NULL,
    producer_instance_id TEXT NOT NULL,
    producer_sequence INTEGER NOT NULL CHECK (producer_sequence >= 1),
    kind TEXT NOT NULL CHECK (kind IN ('snapshot', 'incremental')),
    bar_close_epoch INTEGER NOT NULL CHECK (bar_close_epoch >= 0),
    strategy_id TEXT NOT NULL CHECK (strategy_id = 'rd_liquidity_sd_5m_v1'),
    strategy_version TEXT NOT NULL
        CHECK (strategy_version = '2.0.0-contract2'),
    rule_contract_version TEXT NOT NULL CHECK (rule_contract_version = '2.0.0'),
    execution_mode TEXT NOT NULL CHECK (execution_mode = 'OBSERVATION_ONLY'),
    symbol TEXT NOT NULL,
    ticker_id TEXT NOT NULL,
    feed TEXT NOT NULL,
    timeframe TEXT NOT NULL CHECK (timeframe = '5'),
    tick_size TEXT NOT NULL,
    bar_open_epoch INTEGER NOT NULL CHECK (
        bar_open_epoch >= 0
        AND bar_close_epoch = bar_open_epoch + 300
    ),
    detector_code_hash TEXT NOT NULL CHECK (
        length(detector_code_hash) = 64
        AND detector_code_hash NOT GLOB '*[^0-9a-f]*'
        AND detector_code_hash <>
            '0000000000000000000000000000000000000000000000000000000000000000'
    ),
    settings_hash TEXT NOT NULL CHECK (
        length(settings_hash) = 64
        AND settings_hash NOT GLOB '*[^0-9a-f]*'
        AND settings_hash <>
            '0000000000000000000000000000000000000000000000000000000000000000'
    ),
    chunk_count INTEGER NOT NULL CHECK (chunk_count BETWEEN 1 AND 12),
    first_receipt_id TEXT NOT NULL
        REFERENCES observation_receipts(receipt_id) ON DELETE RESTRICT,
    first_seen_at TEXT NOT NULL,
    CHECK (
        length(batch_id) = 64
        AND batch_id NOT GLOB '*[^0-9a-f]*'
    ),
    UNIQUE (producer_instance_id, producer_sequence),
    UNIQUE (producer_instance_id, bar_close_epoch)
) STRICT;

-- Both compatible producers are projected onto epoch seconds. Legacy
-- millisecond timestamps must be normalized by the authenticated server before
-- insertion, while producer/code provenance deliberately remains independent.
CREATE TABLE observation_market_bar_heartbeats (
    receipt_id TEXT PRIMARY KEY NOT NULL
        REFERENCES observation_receipts(receipt_id) ON DELETE RESTRICT,
    batch_id TEXT
        REFERENCES observation_entry_batches(batch_id) ON DELETE RESTRICT,
    schema_version TEXT NOT NULL CHECK (schema_version IN ('1.2', '2.0')),
    producer_role TEXT NOT NULL
        CHECK (producer_role IN ('LEGACY_REFERENCE', 'ENTRY_V3_CANARY')),
    producer_instance_id TEXT NOT NULL,
    producer_sequence INTEGER NOT NULL CHECK (
        (schema_version = '1.2' AND producer_sequence >= 0)
        OR (schema_version = '2.0' AND producer_sequence >= 1)
    ),
    strategy_version TEXT NOT NULL CHECK (
        (schema_version = '1.2' AND strategy_version = '1.2.0-contract1')
        OR
        (schema_version = '2.0' AND strategy_version = '2.0.0-contract2')
    ),
    symbol TEXT NOT NULL,
    ticker_id TEXT NOT NULL,
    feed TEXT NOT NULL,
    timeframe TEXT NOT NULL CHECK (timeframe = '5'),
    bar_open_epoch INTEGER NOT NULL CHECK (bar_open_epoch >= 0),
    bar_close_epoch INTEGER NOT NULL
        CHECK (bar_close_epoch = bar_open_epoch + 300),
    detector_code_hash TEXT CHECK (
        detector_code_hash IS NULL
        OR (
            length(detector_code_hash) = 64
            AND detector_code_hash NOT GLOB '*[^0-9a-f]*'
            AND detector_code_hash <>
                '0000000000000000000000000000000000000000000000000000000000000000'
        )
    ),
    settings_hash TEXT CHECK (
        settings_hash IS NULL
        OR (
            length(settings_hash) = 64
            AND settings_hash NOT GLOB '*[^0-9a-f]*'
            AND settings_hash <>
                '0000000000000000000000000000000000000000000000000000000000000000'
        )
    ),
    recorded_at TEXT NOT NULL,
    CHECK (
        (
            schema_version = '1.2'
            AND producer_role = 'LEGACY_REFERENCE'
            AND batch_id IS NULL
        )
        OR
        (
            schema_version = '2.0'
            AND producer_role = 'ENTRY_V3_CANARY'
            AND batch_id IS NOT NULL
            AND detector_code_hash IS NOT NULL
            AND settings_hash IS NOT NULL
        )
    )
) STRICT;

CREATE TABLE observation_entry_chunks (
    batch_id TEXT NOT NULL
        REFERENCES observation_entry_batches(batch_id) ON DELETE RESTRICT,
    chunk_index INTEGER NOT NULL CHECK (chunk_index BETWEEN 0 AND 11),
    chunk_count INTEGER NOT NULL CHECK (chunk_count BETWEEN 1 AND 12),
    receipt_id TEXT NOT NULL UNIQUE
        REFERENCES observation_receipts(receipt_id) ON DELETE RESTRICT,
    payload_sha256 TEXT NOT NULL,
    validated_payload_json TEXT NOT NULL CHECK (
        json_valid(validated_payload_json)
        AND json_type(validated_payload_json) = 'object'
    ),
    recorded_at TEXT NOT NULL,
    PRIMARY KEY (batch_id, chunk_index),
    CHECK (chunk_index < chunk_count),
    CHECK (
        length(payload_sha256) = 64
        AND payload_sha256 NOT GLOB '*[^0-9a-f]*'
    )
) STRICT;

CREATE TABLE observation_entry_batch_completions (
    completion_id TEXT PRIMARY KEY NOT NULL,
    batch_id TEXT NOT NULL UNIQUE
        REFERENCES observation_entry_batches(batch_id) ON DELETE RESTRICT,
    assembled_payload_sha256 TEXT NOT NULL,
    completed_at TEXT NOT NULL,
    CHECK (
        length(completion_id) = 64
        AND completion_id NOT GLOB '*[^0-9a-f]*'
    ),
    CHECK (
        length(assembled_payload_sha256) = 64
        AND assembled_payload_sha256 NOT GLOB '*[^0-9a-f]*'
    )
) STRICT;

CREATE TABLE observation_entry_setup_events (
    event_id TEXT PRIMARY KEY NOT NULL,
    setup_id TEXT NOT NULL,
    batch_id TEXT NOT NULL
        REFERENCES observation_entry_batches(batch_id) ON DELETE RESTRICT,
    receipt_id TEXT NOT NULL
        REFERENCES observation_receipts(receipt_id) ON DELETE RESTRICT,
    confirmed_bar_close_epoch INTEGER NOT NULL
        CHECK (confirmed_bar_close_epoch >= 0),
    proof_input_sha256 TEXT NOT NULL,
    proof_input_json TEXT NOT NULL CHECK (
        json_valid(proof_input_json)
        AND json_type(proof_input_json) = 'object'
    ),
    recorded_at TEXT NOT NULL,
    UNIQUE (setup_id, confirmed_bar_close_epoch),
    CHECK (
        length(event_id) = 64
        AND event_id NOT GLOB '*[^0-9a-f]*'
    ),
    CHECK (
        length(proof_input_sha256) = 64
        AND proof_input_sha256 NOT GLOB '*[^0-9a-f]*'
    )
) STRICT;

CREATE TABLE observation_entry_setup_terminals (
    setup_id TEXT PRIMARY KEY NOT NULL,
    terminal_reason TEXT NOT NULL CHECK (
        terminal_reason IN (
            'INVALIDATED',
            'BOTH_ACTIVE_MODELS_OBSERVED',
            'RETENTION_EVICTED'
        )
    ),
    terminal_epoch INTEGER NOT NULL CHECK (terminal_epoch >= 0),
    first_batch_id TEXT NOT NULL
        REFERENCES observation_entry_batches(batch_id) ON DELETE RESTRICT,
    first_receipt_id TEXT NOT NULL
        REFERENCES observation_receipts(receipt_id) ON DELETE RESTRICT,
    recorded_at TEXT NOT NULL
) STRICT;

-- This is the server-owned catalog projection. Producers only carry claim IDs;
-- the authenticated store inserts metadata from the generated official source
-- catalog and the fixed official RD channel identity below.
CREATE TABLE observation_entry_source_claims (
    claim_id TEXT PRIMARY KEY NOT NULL,
    contract_version TEXT NOT NULL CHECK (contract_version = '2.0.0'),
    source_id TEXT NOT NULL,
    youtube_video_id TEXT NOT NULL,
    published_date TEXT NOT NULL,
    title_snapshot TEXT NOT NULL,
    channel_id TEXT NOT NULL CHECK (channel_id = 'UC54xbL96tU58iez3YbTVTAg'),
    channel_handle TEXT NOT NULL CHECK (channel_handle = '@RD_Forex'),
    timestamp_start_seconds INTEGER NOT NULL CHECK (timestamp_start_seconds >= 0),
    timestamp_end_seconds INTEGER NOT NULL
        CHECK (timestamp_end_seconds > timestamp_start_seconds),
    relationship TEXT NOT NULL
        CHECK (relationship IN ('SUPPORTS', 'NARROWS', 'SUPERSEDES')),
    summary TEXT NOT NULL
) STRICT;

CREATE TABLE observation_entry_source_claim_relationships (
    claim_id TEXT PRIMARY KEY NOT NULL
        REFERENCES observation_entry_source_claims(claim_id) ON DELETE RESTRICT,
    target_claim_id TEXT NOT NULL
        REFERENCES observation_entry_source_claims(claim_id) ON DELETE RESTRICT,
    CHECK (claim_id <> target_claim_id)
) STRICT;

CREATE TABLE observation_entry_candidates (
    candidate_id TEXT PRIMARY KEY NOT NULL,
    setup_id TEXT NOT NULL,
    model TEXT NOT NULL CHECK (
        model IN (
            'DIR_CLOSE',
            'HTF_FLIP',
            'LEGACY_BREAK_CANDLE',
            'LEGACY_REJECTION_RESPECT'
        )
    ),
    state TEXT NOT NULL
        CHECK (state IN ('MATCHED', 'BLOCKED', 'REJECTED', 'NORMALIZED')),
    event_anchor_epoch INTEGER NOT NULL CHECK (event_anchor_epoch >= 0),
    trigger_ordinal INTEGER NOT NULL CHECK (trigger_ordinal >= 1),
    direction TEXT NOT NULL CHECK (direction IN ('LONG', 'SHORT')),
    source_claim_ids_json TEXT NOT NULL CHECK (
        json_valid(source_claim_ids_json)
        AND json_type(source_claim_ids_json) = 'array'
        AND json_array_length(source_claim_ids_json) BETWEEN 1 AND 16
    ),
    normalized_from TEXT CHECK (
        normalized_from IS NULL
        OR normalized_from IN (
            'LEGACY_BREAK_CANDLE',
            'LEGACY_REJECTION_RESPECT'
        )
    ),
    identity_sha256 TEXT NOT NULL UNIQUE,
    first_receipt_id TEXT NOT NULL
        REFERENCES observation_receipts(receipt_id) ON DELETE RESTRICT,
    observed_at_epoch INTEGER NOT NULL CHECK (observed_at_epoch >= 0),
    CHECK (
        length(candidate_id) = 64
        AND candidate_id NOT GLOB '*[^0-9a-f]*'
    ),
    CHECK (candidate_id = identity_sha256)
) STRICT;

-- Authoritative proof rows are replayable/archive facts only. REALTIME_TICK
-- is deliberately absent and is retained exclusively in diagnostic JSON.
CREATE TABLE observation_entry_candidate_evidence (
    evidence_id TEXT PRIMARY KEY NOT NULL,
    candidate_id TEXT NOT NULL
        REFERENCES observation_entry_candidates(candidate_id) ON DELETE RESTRICT,
    receipt_id TEXT NOT NULL
        REFERENCES observation_receipts(receipt_id) ON DELETE RESTRICT,
    observed_trigger_epoch INTEGER
        CHECK (observed_trigger_epoch IS NULL OR observed_trigger_epoch >= 0),
    observed_trigger_ticks INTEGER,
    htf_context_minutes_json TEXT NOT NULL CHECK (
        json_valid(htf_context_minutes_json)
        AND json_type(htf_context_minutes_json) = 'array'
        AND json_array_length(htf_context_minutes_json) BETWEEN 0 AND 3
    ),
    fidelity TEXT NOT NULL CHECK (
        fidelity IN ('EXACT', 'CALIBRATED', 'DISCRETIONARY', 'UNRESOLVED')
    ),
    proof_plane TEXT NOT NULL CHECK (
        proof_plane IN (
            'CONFIRMED_5M',
            'LOWER_TIMEFRAME_REPLAY',
            'EXTERNAL_ARCHIVED_TICK'
        )
    ),
    proof_resolution_seconds INTEGER NOT NULL
        CHECK (proof_resolution_seconds > 0),
    coverage_start_epoch INTEGER NOT NULL CHECK (coverage_start_epoch >= 0),
    coverage_end_epoch INTEGER NOT NULL
        CHECK (coverage_end_epoch > coverage_start_epoch),
    ambiguity_codes_json TEXT NOT NULL CHECK (
        json_valid(ambiguity_codes_json)
        AND json_type(ambiguity_codes_json) = 'array'
    ),
    passed_rule_ids_json TEXT NOT NULL CHECK (
        json_valid(passed_rule_ids_json)
        AND json_type(passed_rule_ids_json) = 'array'
    ),
    failed_rule_ids_json TEXT NOT NULL CHECK (
        json_valid(failed_rule_ids_json)
        AND json_type(failed_rule_ids_json) = 'array'
    ),
    source_claim_ids_json TEXT NOT NULL CHECK (
        json_valid(source_claim_ids_json)
        AND json_type(source_claim_ids_json) = 'array'
        AND json_array_length(source_claim_ids_json) BETWEEN 1 AND 16
    ),
    payload_sha256 TEXT NOT NULL,
    identity_sha256 TEXT NOT NULL UNIQUE,
    observed_at_epoch INTEGER NOT NULL CHECK (observed_at_epoch >= 0),
    CHECK (
        length(evidence_id) = 64
        AND evidence_id NOT GLOB '*[^0-9a-f]*'
    ),
    CHECK (
        length(payload_sha256) = 64
        AND payload_sha256 NOT GLOB '*[^0-9a-f]*'
    ),
    CHECK (evidence_id = identity_sha256),
    CHECK (
        (observed_trigger_epoch IS NULL) =
        (observed_trigger_ticks IS NULL)
    )
) STRICT;

CREATE TABLE observation_entry_handling (
    handling_id TEXT PRIMARY KEY NOT NULL,
    candidate_id TEXT NOT NULL
        REFERENCES observation_entry_candidates(candidate_id) ON DELETE RESTRICT,
    evidence_id TEXT NOT NULL
        REFERENCES observation_entry_candidate_evidence(evidence_id)
        ON DELETE RESTRICT,
    receipt_id TEXT NOT NULL
        REFERENCES observation_receipts(receipt_id) ON DELETE RESTRICT,
    handling_mode TEXT NOT NULL CHECK (
        handling_mode IN (
            'CLOSE_CONFIRMATION',
            'INTRABAR_FLIP',
            'NEXT_CANDLE_WICK',
            'AGGRESSIVE'
        )
    ),
    attempt_kind TEXT NOT NULL CHECK (attempt_kind IN ('INITIAL', 'RE_ENTRY')),
    observed_epoch INTEGER NOT NULL CHECK (observed_epoch >= 0),
    observed_ticks INTEGER,
    fidelity TEXT NOT NULL CHECK (
        fidelity IN ('EXACT', 'CALIBRATED', 'DISCRETIONARY', 'UNRESOLVED')
    ),
    source_claim_ids_json TEXT NOT NULL CHECK (
        json_valid(source_claim_ids_json)
        AND json_type(source_claim_ids_json) = 'array'
        AND json_array_length(source_claim_ids_json) BETWEEN 1 AND 16
    ),
    identity_sha256 TEXT NOT NULL UNIQUE,
    CHECK (
        length(handling_id) = 64
        AND handling_id NOT GLOB '*[^0-9a-f]*'
    ),
    CHECK (handling_id = identity_sha256)
) STRICT;

CREATE TABLE observation_entry_producer_diagnostics (
    diagnostic_id TEXT PRIMARY KEY NOT NULL,
    batch_id TEXT NOT NULL
        REFERENCES observation_entry_batches(batch_id) ON DELETE RESTRICT,
    setup_id TEXT NOT NULL,
    candidate_refs_json TEXT NOT NULL CHECK (
        json_valid(candidate_refs_json)
        AND json_type(candidate_refs_json) = 'array'
        AND json_array_length(candidate_refs_json) BETWEEN 0 AND 4
    ),
    evidence_refs_json TEXT NOT NULL CHECK (
        json_valid(evidence_refs_json)
        AND json_type(evidence_refs_json) = 'array'
        AND json_array_length(evidence_refs_json) BETWEEN 0 AND 16
    ),
    realtime_evidence_refs_json TEXT NOT NULL CHECK (
        json_valid(realtime_evidence_refs_json)
        AND json_type(realtime_evidence_refs_json) = 'array'
        AND json_array_length(realtime_evidence_refs_json) BETWEEN 0 AND 16
    ),
    handling_refs_json TEXT NOT NULL CHECK (
        json_valid(handling_refs_json)
        AND json_type(handling_refs_json) = 'array'
        AND json_array_length(handling_refs_json) BETWEEN 0 AND 4
    ),
    diagnostic_selection_json TEXT CHECK (
        diagnostic_selection_json IS NULL
        OR (
            json_valid(diagnostic_selection_json)
            AND json_type(diagnostic_selection_json) = 'object'
        )
    ),
    observed_at TEXT NOT NULL
) STRICT;

CREATE TABLE observation_entry_selections (
    selection_id TEXT PRIMARY KEY NOT NULL,
    batch_id TEXT NOT NULL
        REFERENCES observation_entry_batches(batch_id) ON DELETE RESTRICT,
    setup_id TEXT NOT NULL,
    policy_version TEXT NOT NULL
        CHECK (policy_version = 'rd-entry-arbitration-v2'),
    revision INTEGER NOT NULL CHECK (revision >= 1),
    candidate_ids_considered_json TEXT NOT NULL CHECK (
        json_valid(candidate_ids_considered_json)
        AND json_type(candidate_ids_considered_json) = 'array'
    ),
    canonical_candidate_id TEXT
        REFERENCES observation_entry_candidates(candidate_id) ON DELETE RESTRICT,
    canonical_evidence_id TEXT
        REFERENCES observation_entry_candidate_evidence(evidence_id)
        ON DELETE RESTRICT,
    canonical_model TEXT CHECK (
        canonical_model IS NULL
        OR canonical_model IN ('DIR_CLOSE', 'HTF_FLIP')
    ),
    reason TEXT NOT NULL CHECK (
        reason IN (
            'ONLY_EXACT_TRIGGER',
            'EARLIEST_EXACT_TRIGGER',
            'FALLBACK_TO_CONFIRMED_CLOSE',
            'NO_EXACT_CANDIDATE',
            'UNRESOLVED_SOURCE_PRIORITY',
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
        OR effective_action_reason = 'PROMOTION_IDENTITY_MISMATCH'
    ),
    evaluated_at_epoch INTEGER NOT NULL CHECK (evaluated_at_epoch >= 0),
    UNIQUE (setup_id, policy_version, revision),
    CHECK (
        length(selection_id) = 64
        AND selection_id NOT GLOB '*[^0-9a-f]*'
    ),
    CHECK (
        (canonical_candidate_id IS NULL) =
        (canonical_evidence_id IS NULL)
        AND (canonical_candidate_id IS NULL) =
            (canonical_model IS NULL)
    ),
    CHECK (
        CASE
            WHEN effective_action_reason IS NULL
                THEN
                    action = policy_action
                    OR (
                        policy_action IN ('OBSERVE', 'PAPER_ELIGIBLE')
                        AND action = 'SHADOW_ONLY'
                    )
            ELSE
                effective_action_reason = 'PROMOTION_IDENTITY_MISMATCH'
                AND policy_action = 'PAPER_ELIGIBLE'
                AND action = 'SHADOW_ONLY'
        END
    )
) STRICT;

CREATE TABLE observation_entry_evaluation_members (
    selection_id TEXT NOT NULL
        REFERENCES observation_entry_selections(selection_id)
        ON DELETE RESTRICT,
    object_kind TEXT NOT NULL
        CHECK (object_kind IN ('CANDIDATE', 'EVIDENCE', 'HANDLING')),
    object_id TEXT NOT NULL,
    PRIMARY KEY (selection_id, object_kind, object_id)
) STRICT;

CREATE TABLE observation_entry_parity (
    parity_id TEXT PRIMARY KEY NOT NULL,
    batch_id TEXT NOT NULL
        REFERENCES observation_entry_batches(batch_id) ON DELETE RESTRICT,
    setup_id TEXT NOT NULL,
    producer_diagnostic_id TEXT NOT NULL
        REFERENCES observation_entry_producer_diagnostics(diagnostic_id)
        ON DELETE RESTRICT,
    selection_id TEXT NOT NULL
        REFERENCES observation_entry_selections(selection_id) ON DELETE RESTRICT,
    parity_status TEXT NOT NULL
        CHECK (parity_status IN ('MATCH', 'MISMATCH', 'NOT_PROVIDED')),
    mismatch_reason TEXT CHECK (
        mismatch_reason IS NULL
        OR mismatch_reason IN (
            'CANDIDATE_KEYS',
            'EVIDENCE_DESCRIPTORS',
            'HANDLING_DESCRIPTORS',
            'SELECTED_CANDIDATE',
            'REASON',
            'FIDELITY',
            'DIAGNOSTIC_ACTION',
            'MULTIPLE'
        )
    ),
    compared_at TEXT NOT NULL,
    CHECK (
        (parity_status = 'MATCH' AND mismatch_reason IS NULL)
        OR (parity_status = 'NOT_PROVIDED' AND mismatch_reason IS NULL)
        OR (parity_status = 'MISMATCH' AND mismatch_reason IS NOT NULL)
    )
) STRICT;

-- Quarantine records only conflict identity and hashes. It deliberately has no
-- raw credential or payload column, and batch_id is not a foreign key because
-- an invalid or unknown presented batch must itself remain recordable.
CREATE TABLE observation_entry_quarantine (
    quarantine_id TEXT PRIMARY KEY NOT NULL,
    receipt_id TEXT
        REFERENCES observation_receipts(receipt_id) ON DELETE RESTRICT,
    batch_id TEXT,
    producer_instance_id TEXT,
    producer_sequence INTEGER
        CHECK (producer_sequence IS NULL OR producer_sequence >= 1),
    presented_bar_close_epoch INTEGER CHECK (
        presented_bar_close_epoch IS NULL
        OR presented_bar_close_epoch >= 0
    ),
    object_kind TEXT NOT NULL CHECK (
        object_kind IN (
            'BATCH',
            'CHUNK',
            'SETUP_EVENT',
            'SETUP_TERMINAL',
            'CANDIDATE',
            'EVIDENCE',
            'HANDLING'
        )
    ),
    object_id TEXT NOT NULL,
    existing_sha256 TEXT CHECK (
        existing_sha256 IS NULL
        OR (
            length(existing_sha256) = 64
            AND existing_sha256 NOT GLOB '*[^0-9a-f]*'
        )
    ),
    presented_sha256 TEXT NOT NULL CHECK (
        length(presented_sha256) = 64
        AND presented_sha256 NOT GLOB '*[^0-9a-f]*'
    ),
    reason TEXT NOT NULL CHECK (
        reason IN (
            'IMMUTABLE_ID_CONFLICT',
            'INCONSISTENT_CHUNK_COUNT',
            'INCONSISTENT_BATCH_METADATA',
            'DUPLICATE_SETUP_ACROSS_CHUNKS',
            'BATCH_SETUP_LIMIT',
            'INCOMPLETE_BATCH',
            'EVENT_STREAM_CONTEXT_MISSING',
            'EVENT_STREAM_CONFLICT',
            'TERMINAL_FACT_CONFLICT',
            'SEQUENCE_CONFLICT',
            'BAR_CLOSE_CONFLICT',
            'SEQUENCE_TIME_CONFLICT',
            'PRODUCER_IDENTITY_CONFLICT'
        )
    ),
    quarantined_at TEXT NOT NULL,
    CHECK (
        reason NOT IN (
            'SEQUENCE_CONFLICT',
            'BAR_CLOSE_CONFLICT',
            'SEQUENCE_TIME_CONFLICT',
            'PRODUCER_IDENTITY_CONFLICT'
        )
        OR (
            producer_instance_id IS NOT NULL
            AND producer_sequence IS NOT NULL
            AND presented_bar_close_epoch IS NOT NULL
        )
    )
) STRICT;

CREATE INDEX idx_entry_chunks_batch
    ON observation_entry_chunks(batch_id, chunk_index);
CREATE INDEX idx_market_bar_heartbeat_schedule
    ON observation_market_bar_heartbeats(
        producer_role,
        symbol,
        ticker_id,
        feed,
        timeframe,
        bar_close_epoch
    );
CREATE INDEX idx_entry_batches_producer_sequence
    ON observation_entry_batches(producer_instance_id, producer_sequence);
CREATE INDEX idx_entry_candidates_setup
    ON observation_entry_candidates(setup_id, observed_at_epoch DESC);
CREATE INDEX idx_entry_candidates_model
    ON observation_entry_candidates(model, observed_at_epoch DESC);
CREATE INDEX idx_entry_evidence_candidate
    ON observation_entry_candidate_evidence(candidate_id, observed_at_epoch DESC);
CREATE INDEX idx_entry_evidence_fidelity
    ON observation_entry_candidate_evidence(fidelity, observed_at_epoch DESC);
CREATE INDEX idx_entry_selections_setup_revision
    ON observation_entry_selections(setup_id, revision DESC);
CREATE INDEX idx_entry_selections_reason
    ON observation_entry_selections(reason, evaluated_at_epoch DESC);
CREATE INDEX idx_entry_parity_status
    ON observation_entry_parity(parity_status, compared_at DESC);
CREATE INDEX idx_entry_evaluation_members_selection
    ON observation_entry_evaluation_members(selection_id, object_kind);
CREATE INDEX idx_entry_terminals_epoch
    ON observation_entry_setup_terminals(terminal_epoch, setup_id);
CREATE INDEX idx_entry_setup_events_stream
    ON observation_entry_setup_events(
        setup_id,
        confirmed_bar_close_epoch,
        event_id
    );

-- INSERT conflict guards run before SQLite applies REPLACE conflict handling.
-- This closes the implicit-delete path even when recursive_triggers is disabled.
CREATE TRIGGER observation_entry_batches_no_conflict
BEFORE INSERT ON observation_entry_batches
WHEN EXISTS (
    SELECT 1
    FROM observation_entry_batches
    WHERE
        batch_id = NEW.batch_id
        OR (
            producer_instance_id = NEW.producer_instance_id
            AND producer_sequence = NEW.producer_sequence
        )
        OR (
            producer_instance_id = NEW.producer_instance_id
            AND bar_close_epoch = NEW.bar_close_epoch
        )
)
BEGIN
    SELECT RAISE(
        ABORT,
        'observation_entry_batches immutable insert conflict'
    );
END;

CREATE TRIGGER observation_market_bar_heartbeats_no_conflict
BEFORE INSERT ON observation_market_bar_heartbeats
WHEN EXISTS (
    SELECT 1
    FROM observation_market_bar_heartbeats
    WHERE receipt_id = NEW.receipt_id
)
BEGIN
    SELECT RAISE(
        ABORT,
        'observation_market_bar_heartbeats immutable insert conflict'
    );
END;

CREATE TRIGGER observation_entry_chunks_no_conflict
BEFORE INSERT ON observation_entry_chunks
WHEN EXISTS (
    SELECT 1
    FROM observation_entry_chunks
    WHERE
        (
            batch_id = NEW.batch_id
            AND chunk_index = NEW.chunk_index
        )
        OR receipt_id = NEW.receipt_id
)
BEGIN
    SELECT RAISE(
        ABORT,
        'observation_entry_chunks immutable insert conflict'
    );
END;

CREATE TRIGGER observation_entry_completions_no_conflict
BEFORE INSERT ON observation_entry_batch_completions
WHEN EXISTS (
    SELECT 1
    FROM observation_entry_batch_completions
    WHERE
        completion_id = NEW.completion_id
        OR batch_id = NEW.batch_id
)
BEGIN
    SELECT RAISE(
        ABORT,
        'observation_entry_batch_completions immutable insert conflict'
    );
END;

CREATE TRIGGER observation_entry_setup_events_no_conflict
BEFORE INSERT ON observation_entry_setup_events
WHEN EXISTS (
    SELECT 1
    FROM observation_entry_setup_events
    WHERE
        event_id = NEW.event_id
        OR (
            setup_id = NEW.setup_id
            AND confirmed_bar_close_epoch = NEW.confirmed_bar_close_epoch
        )
)
BEGIN
    SELECT RAISE(
        ABORT,
        'observation_entry_setup_events immutable insert conflict'
    );
END;

CREATE TRIGGER observation_entry_terminals_no_conflict
BEFORE INSERT ON observation_entry_setup_terminals
WHEN EXISTS (
    SELECT 1
    FROM observation_entry_setup_terminals
    WHERE setup_id = NEW.setup_id
)
BEGIN
    SELECT RAISE(
        ABORT,
        'observation_entry_setup_terminals immutable insert conflict'
    );
END;

CREATE TRIGGER observation_entry_source_claims_no_conflict
BEFORE INSERT ON observation_entry_source_claims
WHEN EXISTS (
    SELECT 1
    FROM observation_entry_source_claims
    WHERE claim_id = NEW.claim_id
)
BEGIN
    SELECT RAISE(
        ABORT,
        'observation_entry_source_claims immutable insert conflict'
    );
END;

CREATE TRIGGER observation_entry_source_relationships_no_conflict
BEFORE INSERT ON observation_entry_source_claim_relationships
WHEN EXISTS (
    SELECT 1
    FROM observation_entry_source_claim_relationships
    WHERE claim_id = NEW.claim_id
)
BEGIN
    SELECT RAISE(
        ABORT,
        'observation_entry_source_claim_relationships immutable insert conflict'
    );
END;

CREATE TRIGGER observation_entry_candidates_no_conflict
BEFORE INSERT ON observation_entry_candidates
WHEN EXISTS (
    SELECT 1
    FROM observation_entry_candidates
    WHERE
        candidate_id = NEW.candidate_id
        OR identity_sha256 = NEW.identity_sha256
)
BEGIN
    SELECT RAISE(
        ABORT,
        'observation_entry_candidates immutable insert conflict'
    );
END;

CREATE TRIGGER observation_entry_evidence_no_conflict
BEFORE INSERT ON observation_entry_candidate_evidence
WHEN EXISTS (
    SELECT 1
    FROM observation_entry_candidate_evidence
    WHERE
        evidence_id = NEW.evidence_id
        OR identity_sha256 = NEW.identity_sha256
)
BEGIN
    SELECT RAISE(
        ABORT,
        'observation_entry_candidate_evidence immutable insert conflict'
    );
END;

CREATE TRIGGER observation_entry_handling_no_conflict
BEFORE INSERT ON observation_entry_handling
WHEN EXISTS (
    SELECT 1
    FROM observation_entry_handling
    WHERE
        handling_id = NEW.handling_id
        OR identity_sha256 = NEW.identity_sha256
)
BEGIN
    SELECT RAISE(
        ABORT,
        'observation_entry_handling immutable insert conflict'
    );
END;

CREATE TRIGGER observation_entry_diagnostics_no_conflict
BEFORE INSERT ON observation_entry_producer_diagnostics
WHEN EXISTS (
    SELECT 1
    FROM observation_entry_producer_diagnostics
    WHERE diagnostic_id = NEW.diagnostic_id
)
BEGIN
    SELECT RAISE(
        ABORT,
        'observation_entry_producer_diagnostics immutable insert conflict'
    );
END;

CREATE TRIGGER observation_entry_selections_no_conflict
BEFORE INSERT ON observation_entry_selections
WHEN EXISTS (
    SELECT 1
    FROM observation_entry_selections
    WHERE
        selection_id = NEW.selection_id
        OR (
            setup_id = NEW.setup_id
            AND policy_version = NEW.policy_version
            AND revision = NEW.revision
        )
)
BEGIN
    SELECT RAISE(
        ABORT,
        'observation_entry_selections immutable insert conflict'
    );
END;

CREATE TRIGGER observation_entry_evaluation_members_no_conflict
BEFORE INSERT ON observation_entry_evaluation_members
WHEN EXISTS (
    SELECT 1
    FROM observation_entry_evaluation_members
    WHERE
        selection_id = NEW.selection_id
        AND object_kind = NEW.object_kind
        AND object_id = NEW.object_id
)
BEGIN
    SELECT RAISE(
        ABORT,
        'observation_entry_evaluation_members immutable insert conflict'
    );
END;

CREATE TRIGGER observation_entry_parity_no_conflict
BEFORE INSERT ON observation_entry_parity
WHEN EXISTS (
    SELECT 1
    FROM observation_entry_parity
    WHERE parity_id = NEW.parity_id
)
BEGIN
    SELECT RAISE(
        ABORT,
        'observation_entry_parity immutable insert conflict'
    );
END;

CREATE TRIGGER observation_entry_quarantine_no_conflict
BEFORE INSERT ON observation_entry_quarantine
WHEN EXISTS (
    SELECT 1
    FROM observation_entry_quarantine
    WHERE quarantine_id = NEW.quarantine_id
)
BEGIN
    SELECT RAISE(
        ABORT,
        'observation_entry_quarantine immutable insert conflict'
    );
END;

CREATE TRIGGER observation_entry_batches_validate_first_receipt
BEFORE INSERT ON observation_entry_batches
WHEN NOT EXISTS (
    SELECT 1
    FROM observation_receipts AS receipt
    WHERE
        receipt.receipt_id IS NEW.first_receipt_id
        AND receipt.schema_version IS '2.0'
        AND receipt.strategy_id IS NEW.strategy_id
        AND receipt.strategy_version IS NEW.strategy_version
        AND receipt.producer_instance_id IS NEW.producer_instance_id
        AND receipt.sequence IS NEW.producer_sequence
        AND receipt.symbol IS NEW.symbol
        AND receipt.ticker_id IS NEW.ticker_id
        AND receipt.feed IS NEW.feed
        AND receipt.timeframe IS NEW.timeframe
        AND receipt.kind IS NEW.kind
        AND typeof(receipt.payload_sha256) = 'text'
        AND length(receipt.payload_sha256) = 64
        AND receipt.payload_sha256 NOT GLOB '*[^0-9a-f]*'
)
BEGIN
    SELECT RAISE(ABORT, 'batch first receipt provenance mismatch');
END;

CREATE TRIGGER observation_market_bar_heartbeats_validate_receipt
BEFORE INSERT ON observation_market_bar_heartbeats
WHEN
    EXISTS (
        SELECT 1
        FROM observation_receipts
        WHERE receipt_id = NEW.receipt_id
    )
    AND NOT EXISTS (
        SELECT 1
        FROM observation_receipts
        WHERE
            receipt_id = NEW.receipt_id
            AND schema_version = NEW.schema_version
            AND strategy_version = NEW.strategy_version
            AND producer_instance_id = NEW.producer_instance_id
            AND sequence = NEW.producer_sequence
            AND symbol = NEW.symbol
            AND ticker_id = NEW.ticker_id
            AND feed = NEW.feed
            AND timeframe = NEW.timeframe
    )
BEGIN
    SELECT RAISE(ABORT, 'heartbeat receipt provenance mismatch');
END;

CREATE TRIGGER observation_market_bar_heartbeats_validate_batch
BEFORE INSERT ON observation_market_bar_heartbeats
WHEN
    NEW.schema_version = '2.0'
    AND NOT EXISTS (
        SELECT 1
        FROM observation_entry_batches AS batch
        JOIN observation_receipts AS receipt
          ON receipt.receipt_id = NEW.receipt_id
        WHERE
            batch.batch_id = NEW.batch_id
            AND batch.producer_instance_id = NEW.producer_instance_id
            AND batch.producer_sequence = NEW.producer_sequence
            AND batch.strategy_version = NEW.strategy_version
            AND batch.symbol = NEW.symbol
            AND batch.ticker_id = NEW.ticker_id
            AND batch.feed = NEW.feed
            AND batch.timeframe = NEW.timeframe
            AND batch.bar_open_epoch = NEW.bar_open_epoch
            AND batch.bar_close_epoch = NEW.bar_close_epoch
            AND batch.detector_code_hash = NEW.detector_code_hash
            AND batch.settings_hash = NEW.settings_hash
            AND batch.kind = receipt.kind
    )
BEGIN
    SELECT RAISE(ABORT, 'heartbeat batch provenance mismatch');
END;

CREATE TRIGGER observation_entry_candidates_validate_source_claims
BEFORE INSERT ON observation_entry_candidates
WHEN
    EXISTS (
        SELECT 1
        FROM json_each(NEW.source_claim_ids_json)
        WHERE type <> 'text'
    )
    OR (
        SELECT COUNT(*)
        FROM json_each(NEW.source_claim_ids_json)
    ) <> (
        SELECT COUNT(DISTINCT value)
        FROM json_each(NEW.source_claim_ids_json)
    )
    OR EXISTS (
        SELECT 1
        FROM json_each(NEW.source_claim_ids_json) AS source_claim
        LEFT JOIN observation_entry_source_claims AS catalog
          ON catalog.claim_id = source_claim.value
        WHERE catalog.claim_id IS NULL
    )
BEGIN
    SELECT RAISE(ABORT, 'entry source claims invalid');
END;

CREATE TRIGGER observation_entry_evidence_validate_source_claims
BEFORE INSERT ON observation_entry_candidate_evidence
WHEN
    EXISTS (
        SELECT 1
        FROM json_each(NEW.source_claim_ids_json)
        WHERE type <> 'text'
    )
    OR (
        SELECT COUNT(*)
        FROM json_each(NEW.source_claim_ids_json)
    ) <> (
        SELECT COUNT(DISTINCT value)
        FROM json_each(NEW.source_claim_ids_json)
    )
    OR EXISTS (
        SELECT 1
        FROM json_each(NEW.source_claim_ids_json) AS source_claim
        LEFT JOIN observation_entry_source_claims AS catalog
          ON catalog.claim_id = source_claim.value
        WHERE catalog.claim_id IS NULL
    )
BEGIN
    SELECT RAISE(ABORT, 'entry source claims invalid');
END;

CREATE TRIGGER observation_entry_handling_validate_source_claims
BEFORE INSERT ON observation_entry_handling
WHEN
    EXISTS (
        SELECT 1
        FROM json_each(NEW.source_claim_ids_json)
        WHERE type <> 'text'
    )
    OR (
        SELECT COUNT(*)
        FROM json_each(NEW.source_claim_ids_json)
    ) <> (
        SELECT COUNT(DISTINCT value)
        FROM json_each(NEW.source_claim_ids_json)
    )
    OR EXISTS (
        SELECT 1
        FROM json_each(NEW.source_claim_ids_json) AS source_claim
        LEFT JOIN observation_entry_source_claims AS catalog
          ON catalog.claim_id = source_claim.value
        WHERE catalog.claim_id IS NULL
    )
BEGIN
    SELECT RAISE(ABORT, 'entry source claims invalid');
END;

CREATE TRIGGER observation_entry_evidence_validate_arrays
BEFORE INSERT ON observation_entry_candidate_evidence
WHEN
    EXISTS (
        SELECT 1
        FROM json_each(NEW.htf_context_minutes_json)
        WHERE
            type <> 'integer'
            OR value NOT IN (15, 30, 60)
    )
    OR (
        SELECT COUNT(*)
        FROM json_each(NEW.htf_context_minutes_json)
    ) <> (
        SELECT COUNT(DISTINCT value)
        FROM json_each(NEW.htf_context_minutes_json)
    )
    OR EXISTS (
        SELECT 1
        FROM json_each(NEW.htf_context_minutes_json) AS previous
        JOIN json_each(NEW.htf_context_minutes_json) AS following
          ON CAST(following.key AS INTEGER) =
             CAST(previous.key AS INTEGER) + 1
        WHERE following.value <= previous.value
    )
    OR EXISTS (
        SELECT 1
        FROM json_each(NEW.ambiguity_codes_json)
        WHERE
            type <> 'text'
            OR value NOT IN (
                'SHADOW_SAME_CHILD_BAR_ORDER',
                'SHADOW_MISSING_INTRABAR_COVERAGE',
                'SHADOW_REALTIME_ONLY_NOT_REPLAYABLE'
            )
    )
    OR (
        SELECT COUNT(*)
        FROM json_each(NEW.ambiguity_codes_json)
    ) <> (
        SELECT COUNT(DISTINCT value)
        FROM json_each(NEW.ambiguity_codes_json)
    )
    OR EXISTS (
        SELECT 1
        FROM json_each(NEW.passed_rule_ids_json)
        WHERE
            type <> 'text'
            OR value NOT IN (
                'ENTRY_DIR_CLOSE',
                'ENTRY_BREAK_CANDLE_NORMALIZATION',
                'ENTRY_REJECTION_RESPECT_DISABLED',
                'ENTRY_HTF_FLIP',
                'ENTRY_HTF_ZONE_SIDE_FIRST'
            )
    )
    OR (
        SELECT COUNT(*)
        FROM json_each(NEW.passed_rule_ids_json)
    ) <> (
        SELECT COUNT(DISTINCT value)
        FROM json_each(NEW.passed_rule_ids_json)
    )
    OR EXISTS (
        SELECT 1
        FROM json_each(NEW.failed_rule_ids_json)
        WHERE
            type <> 'text'
            OR value NOT IN (
                'ENTRY_DIR_CLOSE',
                'ENTRY_BREAK_CANDLE_NORMALIZATION',
                'ENTRY_REJECTION_RESPECT_DISABLED',
                'ENTRY_HTF_FLIP',
                'ENTRY_HTF_ZONE_SIDE_FIRST'
            )
    )
    OR (
        SELECT COUNT(*)
        FROM json_each(NEW.failed_rule_ids_json)
    ) <> (
        SELECT COUNT(DISTINCT value)
        FROM json_each(NEW.failed_rule_ids_json)
    )
    OR EXISTS (
        SELECT 1
        FROM json_each(NEW.passed_rule_ids_json) AS passed
        JOIN json_each(NEW.failed_rule_ids_json) AS failed
          ON failed.value = passed.value
    )
BEGIN
    SELECT RAISE(ABORT, 'entry evidence arrays invalid');
END;

CREATE TRIGGER observation_entry_source_relationships_validate_semantics
BEFORE INSERT ON observation_entry_source_claim_relationships
WHEN NOT EXISTS (
    SELECT 1
    FROM observation_entry_source_claims AS source
    JOIN observation_entry_source_claims AS target
      ON target.claim_id = NEW.target_claim_id
    WHERE
        source.claim_id = NEW.claim_id
        AND source.relationship IN ('NARROWS', 'SUPERSEDES')
        AND target.published_date <= source.published_date
)
BEGIN
    SELECT RAISE(ABORT, 'source relationship invalid');
END;

CREATE TRIGGER observation_entry_handling_validate_ownership
BEFORE INSERT ON observation_entry_handling
WHEN NOT EXISTS (
    SELECT 1
    FROM observation_entry_candidate_evidence AS evidence
    WHERE
        evidence.evidence_id = NEW.evidence_id
        AND evidence.candidate_id = NEW.candidate_id
)
BEGIN
    SELECT RAISE(ABORT, 'handling evidence ownership mismatch');
END;

CREATE TRIGGER observation_entry_selections_validate_ownership
BEFORE INSERT ON observation_entry_selections
WHEN
    NEW.canonical_candidate_id IS NOT NULL
    AND NEW.canonical_model IN ('DIR_CLOSE', 'HTF_FLIP')
    AND NOT EXISTS (
        SELECT 1
        FROM observation_entry_candidates AS candidate
        JOIN observation_entry_candidate_evidence AS evidence
          ON evidence.candidate_id = candidate.candidate_id
        WHERE
            candidate.candidate_id = NEW.canonical_candidate_id
            AND candidate.setup_id = NEW.setup_id
            AND candidate.model = NEW.canonical_model
            AND evidence.evidence_id = NEW.canonical_evidence_id
    )
BEGIN
    SELECT RAISE(ABORT, 'selection ownership mismatch');
END;

CREATE TRIGGER observation_entry_selections_validate_candidates
BEFORE INSERT ON observation_entry_selections
WHEN
    json_type(NEW.candidate_ids_considered_json) <> 'array'
    OR EXISTS (
        SELECT 1
        FROM json_each(NEW.candidate_ids_considered_json) AS considered
        WHERE considered.type <> 'text'
    )
    OR (
        SELECT COUNT(*)
        FROM json_each(NEW.candidate_ids_considered_json)
    ) <> (
        SELECT COUNT(DISTINCT value)
        FROM json_each(NEW.candidate_ids_considered_json)
    )
    OR EXISTS (
        SELECT 1
        FROM json_each(NEW.candidate_ids_considered_json) AS considered
        LEFT JOIN observation_entry_candidates AS candidate
          ON candidate.candidate_id = considered.value
         AND candidate.setup_id = NEW.setup_id
        WHERE candidate.candidate_id IS NULL
    )
    OR (
        NEW.canonical_candidate_id IS NOT NULL
        AND NOT EXISTS (
            SELECT 1
            FROM json_each(NEW.candidate_ids_considered_json)
            WHERE
                type = 'text'
                AND value = NEW.canonical_candidate_id
        )
    )
BEGIN
    SELECT RAISE(ABORT, 'selection candidates considered invalid');
END;

CREATE TRIGGER observation_entry_evaluation_members_validate_ownership
BEFORE INSERT ON observation_entry_evaluation_members
WHEN
    CASE NEW.object_kind
        WHEN 'CANDIDATE' THEN NOT EXISTS (
            SELECT 1
            FROM observation_entry_selections AS selection
            JOIN observation_entry_candidates AS candidate
              ON candidate.candidate_id = NEW.object_id
             AND candidate.setup_id = selection.setup_id
            WHERE
                selection.selection_id = NEW.selection_id
                AND EXISTS (
                    SELECT 1
                    FROM json_each(
                        selection.candidate_ids_considered_json
                    ) AS considered
                    WHERE
                        considered.type = 'text'
                        AND considered.value = candidate.candidate_id
                )
        )
        WHEN 'EVIDENCE' THEN NOT EXISTS (
            SELECT 1
            FROM observation_entry_selections AS selection
            JOIN observation_entry_candidate_evidence AS evidence
              ON evidence.evidence_id = NEW.object_id
            JOIN observation_entry_candidates AS candidate
              ON candidate.candidate_id = evidence.candidate_id
             AND candidate.setup_id = selection.setup_id
            WHERE
                selection.selection_id = NEW.selection_id
                AND EXISTS (
                    SELECT 1
                    FROM json_each(
                        selection.candidate_ids_considered_json
                    ) AS considered
                    WHERE
                        considered.type = 'text'
                        AND considered.value = candidate.candidate_id
                )
        )
        WHEN 'HANDLING' THEN NOT EXISTS (
            SELECT 1
            FROM observation_entry_selections AS selection
            JOIN observation_entry_handling AS handling
              ON handling.handling_id = NEW.object_id
            JOIN observation_entry_candidates AS candidate
              ON candidate.candidate_id = handling.candidate_id
             AND candidate.setup_id = selection.setup_id
            WHERE
                selection.selection_id = NEW.selection_id
                AND EXISTS (
                    SELECT 1
                    FROM json_each(
                        selection.candidate_ids_considered_json
                    ) AS considered
                    WHERE
                        considered.type = 'text'
                        AND considered.value = candidate.candidate_id
                )
        )
        ELSE 1
    END
BEGIN
    SELECT RAISE(ABORT, 'evaluation member ownership mismatch');
END;

CREATE TRIGGER observation_entry_parity_validate_ownership
BEFORE INSERT ON observation_entry_parity
WHEN NOT EXISTS (
    SELECT 1
    FROM observation_entry_producer_diagnostics AS diagnostic
    JOIN observation_entry_selections AS selection
      ON selection.selection_id = NEW.selection_id
    WHERE
        diagnostic.diagnostic_id = NEW.producer_diagnostic_id
        AND diagnostic.batch_id = NEW.batch_id
        AND diagnostic.setup_id = NEW.setup_id
        AND selection.batch_id = NEW.batch_id
        AND selection.setup_id = NEW.setup_id
)
BEGIN
    SELECT RAISE(ABORT, 'parity ownership mismatch');
END;

CREATE TRIGGER observation_entry_diagnostics_validate_reference_shapes
BEFORE INSERT ON observation_entry_producer_diagnostics
WHEN
    EXISTS (
        SELECT 1
        FROM json_each(NEW.candidate_refs_json)
        WHERE type <> 'object'
    )
    OR EXISTS (
        SELECT 1
        FROM json_each(NEW.evidence_refs_json)
        WHERE type <> 'object'
    )
    OR EXISTS (
        SELECT 1
        FROM json_each(NEW.realtime_evidence_refs_json)
        WHERE type <> 'object'
    )
    OR EXISTS (
        SELECT 1
        FROM json_each(NEW.handling_refs_json)
        WHERE type <> 'object'
    )
BEGIN
    SELECT RAISE(ABORT, 'diagnostic references must be JSON objects');
END;

CREATE TRIGGER observation_entry_diagnostics_validate_evidence_planes
BEFORE INSERT ON observation_entry_producer_diagnostics
WHEN EXISTS (
    SELECT 1
    FROM json_each(NEW.evidence_refs_json) AS evidence
    WHERE
        (
            SELECT COUNT(*)
            FROM json_each(evidence.value) AS field
            WHERE field.key = 'proof_plane'
        ) <> 1
        OR COALESCE(
            (
                SELECT field.type
                FROM json_each(evidence.value) AS field
                WHERE field.key = 'proof_plane'
                LIMIT 1
            ),
            ''
        ) <> 'text'
        OR COALESCE(
            (
                SELECT field.value
                FROM json_each(evidence.value) AS field
                WHERE field.key = 'proof_plane'
                LIMIT 1
            ),
            ''
        ) NOT IN (
            'CONFIRMED_5M',
            'LOWER_TIMEFRAME_REPLAY',
            'EXTERNAL_ARCHIVED_TICK'
        )
)
BEGIN
    SELECT RAISE(ABORT, 'diagnostic evidence proof planes invalid');
END;

CREATE TRIGGER observation_entry_diagnostics_validate_realtime
BEFORE INSERT ON observation_entry_producer_diagnostics
WHEN
    EXISTS (
        SELECT 1
        FROM json_each(NEW.realtime_evidence_refs_json) AS realtime
        WHERE
            (
                SELECT COUNT(DISTINCT field.key)
                FROM json_each(realtime.value) AS field
                WHERE field.key IN (
                    'proof_plane',
                    'proof_resolution_seconds',
                    'observed_trigger_epoch',
                    'coverage_start_epoch',
                    'coverage_end_epoch'
                )
            ) <> 5
            OR EXISTS (
                SELECT 1
                FROM json_each(realtime.value) AS field
                WHERE field.key IN (
                    'proof_plane',
                    'proof_resolution_seconds',
                    'observed_trigger_epoch',
                    'coverage_start_epoch',
                    'coverage_end_epoch'
                )
                GROUP BY field.key
                HAVING COUNT(*) <> 1
            )
            OR EXISTS (
                SELECT 1
                FROM json_each(realtime.value) AS field
                WHERE
                    (
                        field.key = 'proof_plane'
                        AND field.type <> 'text'
                    )
                    OR (
                        field.key IN (
                            'proof_resolution_seconds',
                            'observed_trigger_epoch',
                            'coverage_start_epoch',
                            'coverage_end_epoch'
                        )
                        AND field.type <> 'integer'
                    )
            )
            OR json_extract(realtime.value, '$.proof_plane') <> 'REALTIME_TICK'
            OR json_extract(
                realtime.value,
                '$.proof_resolution_seconds'
            ) <> 0
            OR json_extract(
                realtime.value,
                '$.coverage_start_epoch'
            ) <> json_extract(
                realtime.value,
                '$.observed_trigger_epoch'
            )
            OR json_extract(
                realtime.value,
                '$.coverage_end_epoch'
            ) <> json_extract(
                realtime.value,
                '$.observed_trigger_epoch'
            )
    )
BEGIN
    SELECT RAISE(
        ABORT,
        'realtime evidence must be diagnostic point coverage'
    );
END;

CREATE TRIGGER observation_entry_batches_no_update
BEFORE UPDATE ON observation_entry_batches
BEGIN
    SELECT RAISE(ABORT, 'observation_entry_batches rows are immutable');
END;
CREATE TRIGGER observation_entry_batches_no_delete
BEFORE DELETE ON observation_entry_batches
BEGIN
    SELECT RAISE(ABORT, 'observation_entry_batches rows are append-only');
END;

CREATE TRIGGER observation_market_bar_heartbeats_no_update
BEFORE UPDATE ON observation_market_bar_heartbeats
BEGIN
    SELECT RAISE(
        ABORT,
        'observation_market_bar_heartbeats rows are immutable'
    );
END;
CREATE TRIGGER observation_market_bar_heartbeats_no_delete
BEFORE DELETE ON observation_market_bar_heartbeats
BEGIN
    SELECT RAISE(
        ABORT,
        'observation_market_bar_heartbeats rows are append-only'
    );
END;

CREATE TRIGGER observation_entry_chunks_no_update
BEFORE UPDATE ON observation_entry_chunks
BEGIN
    SELECT RAISE(ABORT, 'observation_entry_chunks rows are immutable');
END;
CREATE TRIGGER observation_entry_chunks_no_delete
BEFORE DELETE ON observation_entry_chunks
BEGIN
    SELECT RAISE(ABORT, 'observation_entry_chunks rows are append-only');
END;

CREATE TRIGGER observation_entry_completions_no_update
BEFORE UPDATE ON observation_entry_batch_completions
BEGIN
    SELECT RAISE(
        ABORT,
        'observation_entry_batch_completions rows are immutable'
    );
END;
CREATE TRIGGER observation_entry_completions_no_delete
BEFORE DELETE ON observation_entry_batch_completions
BEGIN
    SELECT RAISE(
        ABORT,
        'observation_entry_batch_completions rows are append-only'
    );
END;

CREATE TRIGGER observation_entry_setup_events_no_update
BEFORE UPDATE ON observation_entry_setup_events
BEGIN
    SELECT RAISE(ABORT, 'observation_entry_setup_events rows are immutable');
END;
CREATE TRIGGER observation_entry_setup_events_no_delete
BEFORE DELETE ON observation_entry_setup_events
BEGIN
    SELECT RAISE(ABORT, 'observation_entry_setup_events rows are append-only');
END;

CREATE TRIGGER observation_entry_terminals_no_update
BEFORE UPDATE ON observation_entry_setup_terminals
BEGIN
    SELECT RAISE(
        ABORT,
        'observation_entry_setup_terminals rows are immutable'
    );
END;
CREATE TRIGGER observation_entry_terminals_no_delete
BEFORE DELETE ON observation_entry_setup_terminals
BEGIN
    SELECT RAISE(
        ABORT,
        'observation_entry_setup_terminals rows are append-only'
    );
END;

CREATE TRIGGER observation_entry_candidates_no_update
BEFORE UPDATE ON observation_entry_candidates
BEGIN
    SELECT RAISE(ABORT, 'entry candidates are immutable');
END;
CREATE TRIGGER observation_entry_candidates_no_delete
BEFORE DELETE ON observation_entry_candidates
BEGIN
    SELECT RAISE(ABORT, 'entry candidates are append-only');
END;

CREATE TRIGGER observation_entry_evidence_no_update
BEFORE UPDATE ON observation_entry_candidate_evidence
BEGIN
    SELECT RAISE(ABORT, 'entry evidence is immutable');
END;
CREATE TRIGGER observation_entry_evidence_no_delete
BEFORE DELETE ON observation_entry_candidate_evidence
BEGIN
    SELECT RAISE(ABORT, 'entry evidence is append-only');
END;

CREATE TRIGGER observation_entry_handling_no_update
BEFORE UPDATE ON observation_entry_handling
BEGIN
    SELECT RAISE(ABORT, 'entry handling is immutable');
END;
CREATE TRIGGER observation_entry_handling_no_delete
BEFORE DELETE ON observation_entry_handling
BEGIN
    SELECT RAISE(ABORT, 'entry handling is append-only');
END;

CREATE TRIGGER observation_entry_diagnostics_no_update
BEFORE UPDATE ON observation_entry_producer_diagnostics
BEGIN
    SELECT RAISE(
        ABORT,
        'observation_entry_producer_diagnostics rows are immutable'
    );
END;
CREATE TRIGGER observation_entry_diagnostics_no_delete
BEFORE DELETE ON observation_entry_producer_diagnostics
BEGIN
    SELECT RAISE(
        ABORT,
        'observation_entry_producer_diagnostics rows are append-only'
    );
END;

CREATE TRIGGER observation_entry_selections_no_update
BEFORE UPDATE ON observation_entry_selections
BEGIN
    SELECT RAISE(ABORT, 'entry selections are immutable');
END;
CREATE TRIGGER observation_entry_selections_no_delete
BEFORE DELETE ON observation_entry_selections
BEGIN
    SELECT RAISE(ABORT, 'entry selections are append-only');
END;

CREATE TRIGGER observation_entry_evaluation_members_no_update
BEFORE UPDATE ON observation_entry_evaluation_members
BEGIN
    SELECT RAISE(
        ABORT,
        'observation_entry_evaluation_members rows are immutable'
    );
END;
CREATE TRIGGER observation_entry_evaluation_members_no_delete
BEFORE DELETE ON observation_entry_evaluation_members
BEGIN
    SELECT RAISE(
        ABORT,
        'observation_entry_evaluation_members rows are append-only'
    );
END;

CREATE TRIGGER observation_entry_parity_no_update
BEFORE UPDATE ON observation_entry_parity
BEGIN
    SELECT RAISE(ABORT, 'observation_entry_parity rows are immutable');
END;
CREATE TRIGGER observation_entry_parity_no_delete
BEFORE DELETE ON observation_entry_parity
BEGIN
    SELECT RAISE(ABORT, 'observation_entry_parity rows are append-only');
END;

CREATE TRIGGER observation_entry_source_claims_no_update
BEFORE UPDATE ON observation_entry_source_claims
BEGIN
    SELECT RAISE(
        ABORT,
        'observation_entry_source_claims rows are immutable'
    );
END;
CREATE TRIGGER observation_entry_source_claims_no_delete
BEFORE DELETE ON observation_entry_source_claims
BEGIN
    SELECT RAISE(
        ABORT,
        'observation_entry_source_claims rows are append-only'
    );
END;

CREATE TRIGGER observation_entry_source_relationships_no_update
BEFORE UPDATE ON observation_entry_source_claim_relationships
BEGIN
    SELECT RAISE(
        ABORT,
        'observation_entry_source_claim_relationships rows are immutable'
    );
END;
CREATE TRIGGER observation_entry_source_relationships_no_delete
BEFORE DELETE ON observation_entry_source_claim_relationships
BEGIN
    SELECT RAISE(
        ABORT,
        'observation_entry_source_claim_relationships rows are append-only'
    );
END;

CREATE TRIGGER observation_entry_quarantine_no_update
BEFORE UPDATE ON observation_entry_quarantine
BEGIN
    SELECT RAISE(ABORT, 'observation_entry_quarantine rows are immutable');
END;
CREATE TRIGGER observation_entry_quarantine_no_delete
BEFORE DELETE ON observation_entry_quarantine
BEGIN
    SELECT RAISE(ABORT, 'observation_entry_quarantine rows are append-only');
END;

PRAGMA foreign_key_check;
