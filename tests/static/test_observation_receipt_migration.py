from __future__ import annotations

from pathlib import Path

from prop_trading.adapters.orm import Base


def test_observation_receipt_metadata_is_credential_and_payload_free() -> None:
    table = Base.metadata.tables["observation_receipts"]
    assert set(table.columns.keys()) == {
        "receipt_id",
        "idempotency_key",
        "payload_sha256",
        "schema_version",
        "strategy_id",
        "strategy_version",
        "producer_instance_id",
        "sequence",
        "symbol",
        "ticker_id",
        "feed",
        "timeframe",
        "kind",
        "status",
        "received_at",
    }
    assert table.c.idempotency_key.unique is True
    assert table.c.received_at.type.timezone is True


def test_observation_receipt_migration_is_atomic_append_only_and_least_privilege() -> None:
    migration = Path("alembic/versions/0002_observation_receipts.py").read_text(encoding="utf-8")
    assert 'down_revision = "0001_phase0"' in migration
    assert "sa.UniqueConstraint(" in migration
    assert '"idempotency_key"' in migration
    assert "pg_advisory_xact_lock" in migration
    assert "hashtextextended(p_idempotency_key, 0)" in migration
    assert "BEFORE UPDATE OR DELETE" in migration
    assert "BEFORE TRUNCATE" in migration
    membership_grant = migration.index("GRANT phase0_runtime TO CURRENT_USER")
    role_proof = migration.index("SET LOCAL ROLE phase0_runtime")
    role_reset = migration.index("RESET ROLE")
    assert membership_grant < role_proof < role_reset
    assert "REVOKE phase0_runtime FROM CURRENT_USER" in migration
    assert "status = 'RECEIVED'" in migration
    assert "SECURITY DEFINER" in migration
    assert "SET search_path = pg_catalog, pg_temp" in migration
    assert "matches_submission boolean" in migration
    assert "IS NOT DISTINCT FROM p_payload_sha256" in migration
    assert "ON CONFLICT DO UPDATE" not in migration
    assert "GRANT SELECT ON public.phase1a_observation_receipt_projection" in migration
    assert "GRANT EXECUTE ON FUNCTION " in migration
    assert "public.phase1a_append_observation_receipt(" in migration
    assert "GRANT SELECT ON public.observation_receipts" not in migration
