CREATE TRIGGER IF NOT EXISTS paper_trade_settlements_no_update
BEFORE UPDATE ON paper_trade_settlements
BEGIN
    SELECT RAISE(ABORT, 'paper trade settlements are immutable');
END;
