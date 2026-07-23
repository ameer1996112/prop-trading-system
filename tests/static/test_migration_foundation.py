from __future__ import annotations

from pathlib import Path

from prop_trading.adapters.orm import Base


def test_phase0_metadata_contains_only_append_only_evidence() -> None:
    assert set(Base.metadata.tables) == {"phase0_evidence_records"}
    migration = Path("alembic/versions/0001_phase0_evidence.py").read_text(encoding="utf-8")
    assert "BEFORE UPDATE OR DELETE" in migration
    assert "BEFORE TRUNCATE" in migration
    assert "GRANT SELECT ON public.phase0_evidence_records" in migration
    assert "GRANT EXECUTE ON FUNCTION public.phase0_append_evidence" in migration
    assert "GRANT SELECT, INSERT" not in migration
    assert "canonical_payload_text" in migration
    assert "sa.Computed" in migration
    assert "canonical_payload_text::jsonb" in migration
    assert "SECURITY DEFINER" in migration
    assert "SET search_path = pg_catalog, pg_temp" in migration
    assert "payload bytes are not the exact canonical JSON representation" in migration
    assert "IS DISTINCT FROM 'phase0.provider-capability.v1'" in migration
    assert "evidence envelope identifier disagrees" in migration
    assert "gate envelope identifier disagrees" in migration
    assert "NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS" in migration
    assert "pre-existing phase0_runtime role has unsafe attributes" in migration
    assert "pre-existing phase0_runtime role has unsafe memberships" in migration
    assert "phase0_runtime cannot own schema public" in migration
    assert "REVOKE ALL ON public.phase0_evidence_records FROM phase0_runtime" in migration
    assert "REVOKE CREATE ON SCHEMA public FROM PUBLIC" in migration
    assert "append-only" in migration
