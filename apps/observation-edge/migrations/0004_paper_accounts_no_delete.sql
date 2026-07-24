CREATE TRIGGER IF NOT EXISTS paper_accounts_no_delete
BEFORE DELETE ON paper_accounts
BEGIN
    SELECT RAISE(ABORT, 'paper_accounts_are_immutable');
END;
