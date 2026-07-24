CREATE TRIGGER IF NOT EXISTS paper_trade_intents_no_delete
BEFORE DELETE ON paper_trade_intents
BEGIN
    SELECT RAISE(ABORT, 'paper trade intents are append-only');
END;
