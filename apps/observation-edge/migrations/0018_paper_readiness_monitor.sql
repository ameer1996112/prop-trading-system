CREATE TABLE IF NOT EXISTS paper_kill_switch_events (
    event_id TEXT PRIMARY KEY,
    idempotency_key TEXT NOT NULL UNIQUE,
    payload_sha256 TEXT NOT NULL
        CHECK (length(payload_sha256) = 64 AND payload_sha256 NOT GLOB '*[^a-f0-9]*'),
    enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
    reason TEXT NOT NULL CHECK (length(reason) BETWEEN 3 AND 240),
    changed_at TEXT NOT NULL
);

INSERT OR IGNORE INTO paper_kill_switch_events (
    event_id,
    idempotency_key,
    payload_sha256,
    enabled,
    reason,
    changed_at
) VALUES (
    'paper-kill-switch-initial',
    'paper-kill-switch:initial',
    '0000000000000000000000000000000000000000000000000000000000000000',
    1,
    'INITIAL_FAIL_CLOSED',
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
);

CREATE TRIGGER IF NOT EXISTS paper_kill_switch_events_no_update
BEFORE UPDATE ON paper_kill_switch_events
BEGIN
    SELECT RAISE(ABORT, 'paper kill-switch events are append-only');
END;

CREATE TRIGGER IF NOT EXISTS paper_kill_switch_events_no_delete
BEFORE DELETE ON paper_kill_switch_events
BEGIN
    SELECT RAISE(ABORT, 'paper kill-switch events are append-only');
END;
