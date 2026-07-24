CREATE TRIGGER IF NOT EXISTS paper_accounts_no_update
BEFORE UPDATE ON paper_accounts
BEGIN
    SELECT RAISE(ABORT, 'paper_accounts_are_immutable');
END;
