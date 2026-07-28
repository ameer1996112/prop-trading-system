from __future__ import annotations

from pathlib import Path

from prop_trading.adapters.orm import Base


def test_metadata_contains_only_append_only_evidence_and_observation_receipts() -> None:
    assert set(Base.metadata.tables) == {
        "phase0_evidence_records",
        "observation_receipts",
    }
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


def test_edge_v3_migration_freezes_observations_and_one_paper_decision() -> None:
    migration = Path(
        "apps/observation-edge/migrations/0024_observation_entries_v3.sql"
    ).read_text(encoding="utf-8")
    for table in (
        "observation_entry_v3_events",
        "observation_entry_v3_candidates",
        "observation_entry_v3_evidence",
        "observation_entry_v3_selections",
        "observation_entry_v3_selection_members",
        "observation_entry_v3_parity",
        "observation_entry_v3_paper_links",
        "observation_entry_v3_shadow_positions",
        "observation_entry_v3_exit_applications",
        "observation_entry_v3_event_dispositions",
    ):
        assert f"CREATE TABLE {table}" in migration
    assert "PRIMARY KEY (setup_id, attempt_kind)" in migration
    assert "model IN ('BOC', 'DIR_CLOSE', 'HTF_FLIP')" in migration
    assert "state IN ('OPEN', 'STOPPED', 'TARGET_HIT', 'AMBIGUOUS')" in migration
    assert "observation_entry_v3_shadow_positions_state_guard" in migration
    assert "observation_entry_v3_paper_links_no_update" in migration
    assert "observation_entry_v3_paper_links_no_delete" in migration
    assert "observation_entry_v3_exit_applications_no_update" in migration
    assert "observation_entry_v3_exit_applications_no_delete" in migration
    assert "observation_entry_v3_event_dispositions_no_update" in migration
    assert "observation_entry_v3_event_dispositions_no_delete" in migration
