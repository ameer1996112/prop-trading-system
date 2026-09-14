-- A reused immutable evidence fact belongs to every receipt that admitted it.
-- evidence.receipt_id remains its original provenance, not this many-to-many link.
CREATE TABLE signal_admission_v1_receipt_evidence (
  receipt_id TEXT NOT NULL REFERENCES signal_admission_v1_receipts(receipt_id),
  evidence_id TEXT NOT NULL REFERENCES signal_admission_v1_evidence(evidence_id),
  namespace TEXT NOT NULL,
  attempt_key TEXT NOT NULL,
  PRIMARY KEY(receipt_id,evidence_id),
  UNIQUE(receipt_id,namespace,attempt_key),
  FOREIGN KEY(namespace,attempt_key) REFERENCES signal_admission_v1_attempts(namespace,attempt_key)
) STRICT, WITHOUT ROWID;

CREATE TRIGGER signal_admission_v1_receipt_evidence_consistent
BEFORE INSERT ON signal_admission_v1_receipt_evidence
WHEN NOT EXISTS (
  SELECT 1 FROM signal_admission_v1_evidence e
  JOIN signal_admission_v1_receipts c ON c.receipt_id=NEW.receipt_id
  JOIN signal_admission_v1_registrations r ON r.registration_id=c.registration_id
  WHERE e.evidence_id=NEW.evidence_id AND e.namespace=NEW.namespace
    AND e.attempt_key=NEW.attempt_key AND r.namespace=NEW.namespace
    AND c.outcome IN ('ACCEPTED','NO_CANDIDATE','AUDIT_ONLY')
)
BEGIN SELECT RAISE(ABORT,'inconsistent receipt evidence association'); END;

-- Retain the associations recoverable from first-admission provenance.
INSERT INTO signal_admission_v1_receipt_evidence(receipt_id,evidence_id,namespace,attempt_key)
SELECT receipt_id,evidence_id,namespace,attempt_key FROM signal_admission_v1_evidence;

CREATE TRIGGER signal_admission_v1_receipt_evidence_immutable
BEFORE UPDATE ON signal_admission_v1_receipt_evidence
BEGIN SELECT RAISE(ABORT,'immutable receipt evidence association'); END;
CREATE TRIGGER signal_admission_v1_receipt_evidence_retained
BEFORE DELETE ON signal_admission_v1_receipt_evidence
BEGIN SELECT RAISE(ABORT,'retained receipt evidence association'); END;
