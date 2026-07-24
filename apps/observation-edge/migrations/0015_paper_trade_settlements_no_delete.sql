CREATE TRIGGER IF NOT EXISTS paper_trade_settlements_no_delete
BEFORE DELETE ON paper_trade_settlements
BEGIN
    SELECT RAISE(ABORT, 'paper trade settlements are append-only');
END;
