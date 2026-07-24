CREATE TRIGGER IF NOT EXISTS paper_ledger_safe_balance
BEFORE INSERT ON paper_ledger_entries
WHEN NEW.amount_minor < (
    -9007199254740991 - (
        SELECT
            opening_balance_minor + COALESCE(
                (
                    SELECT SUM(amount_minor)
                    FROM paper_ledger_entries
                    WHERE account_id = NEW.account_id
                ),
                0
            )
        FROM paper_accounts
        WHERE account_id = NEW.account_id
    )
)
OR NEW.amount_minor > (
    9007199254740991 - (
        SELECT
            opening_balance_minor + COALESCE(
                (
                    SELECT SUM(amount_minor)
                    FROM paper_ledger_entries
                    WHERE account_id = NEW.account_id
                ),
                0
            )
        FROM paper_accounts
        WHERE account_id = NEW.account_id
    )
)
OR NEW.amount_minor < (
    -9007199254740991 - COALESCE(
        (
            SELECT SUM(amount_minor)
            FROM paper_ledger_entries
            WHERE account_id = NEW.account_id
        ),
        0
    )
)
OR NEW.amount_minor > (
    9007199254740991 - COALESCE(
        (
            SELECT SUM(amount_minor)
            FROM paper_ledger_entries
            WHERE account_id = NEW.account_id
        ),
        0
    )
)
BEGIN
    SELECT RAISE(ABORT, 'paper_balance_out_of_safe_range');
END;
