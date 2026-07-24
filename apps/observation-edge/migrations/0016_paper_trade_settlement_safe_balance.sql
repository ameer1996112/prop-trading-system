CREATE TRIGGER IF NOT EXISTS paper_trade_settlement_safe_balance
BEFORE INSERT ON paper_trade_settlements
WHEN
    NOT EXISTS (
        SELECT 1
        FROM paper_trade_allocations
        WHERE intent_id = NEW.intent_id
    )
    OR EXISTS (
        SELECT 1
        FROM paper_trade_allocations AS allocation
        JOIN paper_account_projections AS account
            ON account.account_id = allocation.account_id
        WHERE allocation.intent_id = NEW.intent_id
          AND (
              CAST(
                  allocation.risk_amount_minor * NEW.outcome_r_millis / 1000
                  AS INTEGER
              ) < -9007199254740991 - account.balance_minor
              OR CAST(
                  allocation.risk_amount_minor * NEW.outcome_r_millis / 1000
                  AS INTEGER
              ) > 9007199254740991 - account.balance_minor
          )
    )
BEGIN
    SELECT RAISE(ABORT, 'paper settlement balance out of range');
END;
