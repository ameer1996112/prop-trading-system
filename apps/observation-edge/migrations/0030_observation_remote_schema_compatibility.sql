-- REMOTE_SCHEMA_RECONCILIATION
--
-- The production D1 database already owns proposal tables from an earlier,
-- incompatible paper-only lineage. This observation-only release deliberately
-- does not expose proposal ingestion or alter those historical tables.
--
-- Keep this statement as a migration ledger marker: it performs no schema
-- mutation while recording that the remote lineage was reviewed.
SELECT 1;
