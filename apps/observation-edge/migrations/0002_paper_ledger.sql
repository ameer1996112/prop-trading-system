-- Vendor-neutral PAPER_ONLY capital registry and append-only manual ledger.
-- Raw requests and authentication credentials are never persisted.
CREATE TABLE paper_accounts (
    account_id TEXT PRIMARY KEY NOT NULL,
    mode TEXT NOT NULL CHECK (mode = 'PAPER_ONLY'),
    label TEXT NOT NULL,
    currency_code TEXT NOT NULL,
    currency_scale INTEGER NOT NULL,
    opening_balance_minor INTEGER NOT NULL,
    idempotency_key TEXT NOT NULL UNIQUE,
    payload_sha256 TEXT NOT NULL,
    created_at TEXT NOT NULL,
    CHECK (length(account_id) BETWEEN 1 AND 128),
    CHECK (account_id NOT IN ('.', '..')),
    CHECK (length(label) BETWEEN 1 AND 80),
    CHECK (
        length(currency_code) = 3
        AND currency_code = upper(currency_code)
        AND currency_code NOT GLOB '*[^A-Z]*'
    ),
    CHECK (currency_scale BETWEEN 0 AND 8),
    CHECK (opening_balance_minor BETWEEN 0 AND 9007199254740991),
    CHECK (idempotency_key = 'paper-account:' || account_id),
    CHECK (
        length(payload_sha256) = 64
        AND payload_sha256 NOT GLOB '*[^0-9a-f]*'
    )
) STRICT;

CREATE TABLE paper_ledger_entries (
    entry_id TEXT PRIMARY KEY NOT NULL,
    account_id TEXT NOT NULL
        REFERENCES paper_accounts(account_id) ON DELETE RESTRICT,
    sequence INTEGER NOT NULL,
    idempotency_key TEXT NOT NULL UNIQUE,
    payload_sha256 TEXT NOT NULL,
    entry_kind TEXT NOT NULL CHECK (entry_kind = 'MANUAL_ADJUSTMENT'),
    amount_minor INTEGER NOT NULL,
    recorded_at TEXT NOT NULL,
    CHECK (sequence BETWEEN 1 AND 9007199254740991),
    CHECK (
        idempotency_key =
            'paper-ledger:' || account_id || ':' || CAST(sequence AS TEXT)
    ),
    CHECK (
        length(payload_sha256) = 64
        AND payload_sha256 NOT GLOB '*[^0-9a-f]*'
    ),
    CHECK (
        amount_minor BETWEEN -9007199254740991 AND 9007199254740991
        AND amount_minor <> 0
    ),
    UNIQUE (account_id, sequence)
) STRICT;

CREATE INDEX idx_paper_accounts_created
    ON paper_accounts(created_at DESC, account_id);

CREATE INDEX idx_paper_ledger_account_sequence
    ON paper_ledger_entries(account_id, sequence DESC);
