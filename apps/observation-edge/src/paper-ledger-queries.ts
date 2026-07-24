export const INSERT_PAPER_ACCOUNT_SQL = `
INSERT OR IGNORE INTO paper_accounts (
  account_id,
  mode,
  label,
  currency_code,
  currency_scale,
  opening_balance_minor,
  idempotency_key,
  payload_sha256,
  created_at
) VALUES (?, 'PAPER_ONLY', ?, ?, ?, ?, ?, ?, ?)
`;

export const SELECT_PAPER_ACCOUNT_BY_IDEMPOTENCY_SQL = `
SELECT
  account_id,
  mode,
  label,
  currency_code,
  currency_scale,
  opening_balance_minor,
  idempotency_key,
  payload_sha256,
  created_at
FROM paper_accounts
WHERE idempotency_key = ?
LIMIT 1
`;

export const SELECT_PAPER_ACCOUNT_PROJECTION_SQL = `
SELECT
  account_id,
  mode,
  label,
  currency_code,
  currency_scale,
  opening_balance_minor,
  created_at,
  ledger_delta_minor,
  balance_minor,
  last_sequence
FROM paper_account_projections
WHERE account_id = ?
LIMIT 1
`;

export const LIST_PAPER_ACCOUNT_PROJECTIONS_SQL = `
SELECT
  account_id,
  mode,
  label,
  currency_code,
  currency_scale,
  opening_balance_minor,
  created_at,
  ledger_delta_minor,
  balance_minor,
  last_sequence
FROM paper_account_projections
ORDER BY created_at DESC, account_id
LIMIT ?
`;

export const INSERT_PAPER_LEDGER_ENTRY_SQL = `
WITH account_state AS (
  SELECT
    account_id,
    ledger_delta_minor,
    balance_minor AS current_balance_minor,
    last_sequence + 1 AS next_sequence
  FROM paper_account_projections
  WHERE account_id = ?
)
INSERT OR IGNORE INTO paper_ledger_entries (
  entry_id,
  account_id,
  sequence,
  idempotency_key,
  payload_sha256,
  entry_kind,
  amount_minor,
  recorded_at
)
SELECT
  ?,
  account_id,
  ?,
  ?,
  ?,
  'MANUAL_ADJUSTMENT',
  ?,
  ?
FROM account_state
WHERE next_sequence = ?
  AND ? >= -9007199254740991 - current_balance_minor
  AND ? <= 9007199254740991 - current_balance_minor
  AND ? >= -9007199254740991 - ledger_delta_minor
  AND ? <= 9007199254740991 - ledger_delta_minor
`;

export const SELECT_PAPER_LEDGER_ENTRY_BY_IDEMPOTENCY_SQL = `
SELECT
  entry_id,
  account_id,
  sequence,
  idempotency_key,
  payload_sha256,
  entry_kind,
  amount_minor,
  recorded_at
FROM paper_ledger_entries
WHERE idempotency_key = ?
LIMIT 1
`;

export const LIST_PAPER_LEDGER_ENTRIES_SQL = `
SELECT
  entry_id,
  account_id,
  sequence,
  idempotency_key,
  payload_sha256,
  entry_kind,
  amount_minor,
  recorded_at
FROM paper_ledger_entries
WHERE account_id = ?
  AND (? IS NULL OR sequence < ?)
ORDER BY sequence DESC
LIMIT ?
`;
