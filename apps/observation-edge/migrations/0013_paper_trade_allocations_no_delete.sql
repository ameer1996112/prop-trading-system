CREATE TRIGGER IF NOT EXISTS paper_trade_allocations_no_delete
BEFORE DELETE ON paper_trade_allocations
BEGIN
    SELECT RAISE(ABORT, 'paper trade allocations are append-only');
END;
