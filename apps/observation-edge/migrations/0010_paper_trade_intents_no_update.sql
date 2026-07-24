CREATE TRIGGER IF NOT EXISTS paper_trade_intents_no_update
BEFORE UPDATE ON paper_trade_intents
BEGIN
    SELECT RAISE(ABORT, 'paper trade intents are immutable');
END;
