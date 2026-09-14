ALTER TABLE signal_admission_v1_outbox ADD COLUMN last_dispatch_at_epoch INTEGER CHECK(last_dispatch_at_epoch BETWEEN 0 AND 9007199254740991);
ALTER TABLE signal_admission_v1_outbox ADD COLUMN failure_reason TEXT CHECK(failure_reason IN ('CLOCK_REGRESSION','ATTEMPTS_EXHAUSTED','DELIVERY_FAILED'));
