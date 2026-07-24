CREATE TRIGGER IF NOT EXISTS paper_ledger_contiguous_sequence
BEFORE INSERT ON paper_ledger_entries
WHEN NEW.sequence <> COALESCE(
    (
        SELECT MAX(sequence) + 1
        FROM paper_ledger_entries
        WHERE account_id = NEW.account_id
    ),
    1
)
BEGIN
    SELECT RAISE(ABORT, 'paper_ledger_sequence_conflict');
END;
