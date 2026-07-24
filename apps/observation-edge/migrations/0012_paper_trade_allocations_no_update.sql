CREATE TRIGGER IF NOT EXISTS paper_trade_allocations_no_update
BEFORE UPDATE ON paper_trade_allocations
BEGIN
    SELECT RAISE(ABORT, 'paper trade allocations are immutable');
END;
