CREATE TRIGGER IF NOT EXISTS paper_ledger_no_update
BEFORE UPDATE ON paper_ledger_entries
BEGIN
    SELECT RAISE(ABORT, 'paper_ledger_is_append_only');
END;
