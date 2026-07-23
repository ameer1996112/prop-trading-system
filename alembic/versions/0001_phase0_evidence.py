"""Create the exact-byte, append-only Phase 0 evidence ledger.

Revision ID: 0001_phase0
Revises: None
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0001_phase0"
down_revision = None
branch_labels = None
depends_on = None


_GATE_CHECK = """gate_id IN (
  'optimizer_1_inputs', 'tradingview_alert_configuration',
  'committed_clean_pine_provenance', 'managed_secret_workload_identity', 'oidc_mfa',
  'telemetry', 'independent_dead_man', 'transactional_email',
  'metaapi_demo_only_tenant', 'metaapi_common_cursor_barrier', 'licensed_tick_source',
  'sequence_complete_ticks', 'five_day_tick_pilot'
)"""


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")
    op.execute(
        """
        DO $$
        BEGIN
          IF pg_catalog.getdatabaseencoding() <> 'UTF8' THEN
            RAISE EXCEPTION 'Phase 0 evidence ledger requires a UTF8 PostgreSQL database';
          END IF;
        END
        $$
        """
    )
    op.create_table(
        "phase0_evidence_records",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("evidence_id", sa.String(length=160), nullable=False),
        sa.Column("gate_id", sa.String(length=160), nullable=False),
        sa.Column("canonical_payload_text", sa.Text(), nullable=False),
        sa.Column(
            "canonical_sha256",
            sa.String(length=64),
            sa.Computed(
                "encode(digest(canonical_payload_text, 'sha256'), 'hex')",
                persisted=True,
            ),
            nullable=False,
        ),
        sa.Column("source_note", sa.Text(), nullable=False),
        sa.Column(
            "recorded_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("clock_timestamp()"),
            nullable=False,
        ),
        sa.CheckConstraint(_GATE_CHECK, name="ck_phase0_evidence_gate_id"),
        sa.CheckConstraint("length(source_note) BETWEEN 1 AND 2000", name="ck_phase0_source_note"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("evidence_id"),
    )
    op.execute(
        r"""
        CREATE FUNCTION public.phase0_canonical_jsonb(p_value jsonb) RETURNS text
        LANGUAGE plpgsql IMMUTABLE STRICT
        SET search_path = pg_catalog, pg_temp
        AS $$
        DECLARE
          v_kind text;
          v_scalar text;
          v_result text;
        BEGIN
          v_kind := pg_catalog.jsonb_typeof(p_value);
          IF v_kind = 'null' THEN
            RETURN 'null';
          ELSIF v_kind = 'boolean' OR v_kind = 'string' THEN
            RETURN p_value::text;
          ELSIF v_kind = 'number' THEN
            v_scalar := p_value #>> '{}';
            IF v_scalar !~ '^-?(0|[1-9][0-9]*)$' THEN
              RAISE EXCEPTION 'canonical evidence permits integer JSON numbers only';
            END IF;
            IF v_scalar::numeric < -9007199254740991 OR v_scalar::numeric > 9007199254740991 THEN
              RAISE EXCEPTION 'canonical evidence integer exceeds cross-language safe range';
            END IF;
            RETURN v_scalar;
          ELSIF v_kind = 'array' THEN
            SELECT '[' || coalesce(
              pg_catalog.string_agg(
                public.phase0_canonical_jsonb(element.value), ',' ORDER BY element.ordinality
              ), ''
            ) || ']'
            INTO v_result
            FROM pg_catalog.jsonb_array_elements(p_value) WITH ORDINALITY
              AS element(value, ordinality);
            RETURN v_result;
          ELSIF v_kind = 'object' THEN
            IF EXISTS (
              SELECT 1 FROM pg_catalog.jsonb_each(p_value) AS member(key, value)
              WHERE member.key !~ '^[A-Za-z0-9_.:-]+$'
            ) THEN
              RAISE EXCEPTION 'canonical evidence object key is outside the ASCII profile';
            END IF;
            SELECT '{' || coalesce(
              pg_catalog.string_agg(
                pg_catalog.to_jsonb(member.key)::text || ':' ||
                  public.phase0_canonical_jsonb(member.value),
                ',' ORDER BY member.key COLLATE "C"
              ), ''
            ) || '}'
            INTO v_result
            FROM pg_catalog.jsonb_each(p_value) AS member(key, value);
            RETURN v_result;
          END IF;
          RAISE EXCEPTION 'unsupported JSONB kind';
        END;
        $$
        """
    )
    op.execute(
        """
        CREATE FUNCTION public.phase0_append_evidence(
          p_evidence_id text,
          p_gate_id text,
          p_canonical_payload_text text,
          p_source_note text
        ) RETURNS TABLE (
          id uuid,
          evidence_id text,
          gate_id text,
          canonical_payload_text text,
          canonical_sha256 text,
          payload jsonb,
          source_note text,
          recorded_at timestamptz
        )
        LANGUAGE plpgsql SECURITY DEFINER
        SET search_path = pg_catalog, pg_temp
        AS $$
        DECLARE
          v_payload jsonb;
          v_canonical text;
        BEGIN
          IF p_source_note IS NULL OR length(p_source_note) NOT BETWEEN 1 AND 2000 THEN
            RAISE EXCEPTION 'source note is required and bounded';
          END IF;
          BEGIN
            v_payload := p_canonical_payload_text::jsonb;
          EXCEPTION WHEN others THEN
            RAISE EXCEPTION 'canonical payload is not valid PostgreSQL UTF-8 JSON';
          END;
          IF jsonb_typeof(v_payload) <> 'object' THEN
            RAISE EXCEPTION 'evidence payload must be a JSON object';
          END IF;
          v_canonical := public.phase0_canonical_jsonb(v_payload);
          IF v_canonical <> p_canonical_payload_text THEN
            RAISE EXCEPTION 'payload bytes are not the exact canonical JSON representation';
          END IF;
          IF v_payload->>'schema_id' IS DISTINCT FROM 'phase0.provider-capability.v1' THEN
            RAISE EXCEPTION 'payload schema_id is not provider capability evidence';
          END IF;
          IF v_payload->>'evidence_id' IS DISTINCT FROM p_evidence_id THEN
            RAISE EXCEPTION 'evidence envelope identifier disagrees with canonical payload';
          END IF;
          IF v_payload->>'gate_id' IS DISTINCT FROM p_gate_id THEN
            RAISE EXCEPTION 'gate envelope identifier disagrees with canonical payload';
          END IF;
          RETURN QUERY
          INSERT INTO public.phase0_evidence_records (
            evidence_id, gate_id, canonical_payload_text, source_note
          ) VALUES (
            p_evidence_id, p_gate_id, p_canonical_payload_text, p_source_note
          )
          RETURNING
            phase0_evidence_records.id,
            phase0_evidence_records.evidence_id::text,
            phase0_evidence_records.gate_id::text,
            phase0_evidence_records.canonical_payload_text,
            phase0_evidence_records.canonical_sha256::text,
            phase0_evidence_records.canonical_payload_text::jsonb,
            phase0_evidence_records.source_note,
            phase0_evidence_records.recorded_at;
        END;
        $$
        """
    )
    op.execute(
        """
        CREATE VIEW public.phase0_evidence_projection AS
        SELECT id, evidence_id, gate_id, canonical_payload_text,
               canonical_sha256, canonical_payload_text::jsonb AS payload,
               source_note, recorded_at
        FROM public.phase0_evidence_records
        """
    )
    op.execute(
        """
        CREATE FUNCTION public.phase0_evidence_immutable() RETURNS trigger
        LANGUAGE plpgsql
        SET search_path = pg_catalog, pg_temp
        AS $$
        BEGIN
          RAISE EXCEPTION 'phase0 evidence is append-only';
        END;
        $$
        """
    )
    op.execute(
        """
        CREATE TRIGGER phase0_evidence_no_mutation
        BEFORE UPDATE OR DELETE ON public.phase0_evidence_records
        FOR EACH ROW EXECUTE FUNCTION public.phase0_evidence_immutable()
        """
    )
    op.execute(
        """
        CREATE TRIGGER phase0_evidence_no_truncate
        BEFORE TRUNCATE ON public.phase0_evidence_records
        FOR EACH STATEMENT EXECUTE FUNCTION public.phase0_evidence_immutable()
        """
    )
    op.execute(
        """
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'phase0_runtime') THEN
            CREATE ROLE phase0_runtime
              NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
          ELSE
            IF EXISTS (
              SELECT 1 FROM pg_roles
              WHERE rolname = 'phase0_runtime'
                AND (
                  rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolinherit OR
                  rolreplication OR rolbypassrls
                )
            ) THEN
              RAISE EXCEPTION 'pre-existing phase0_runtime role has unsafe attributes';
            END IF;
            IF EXISTS (
              SELECT 1
              FROM pg_auth_members membership
              JOIN pg_roles member_role ON member_role.oid = membership.member
              WHERE member_role.rolname = 'phase0_runtime'
            ) THEN
              RAISE EXCEPTION 'pre-existing phase0_runtime role has unsafe memberships';
            END IF;
            IF EXISTS (
              SELECT 1 FROM pg_database database_record
              JOIN pg_roles owner_role ON owner_role.oid = database_record.datdba
              WHERE database_record.datname = current_database()
                AND owner_role.rolname = 'phase0_runtime'
            ) THEN
              RAISE EXCEPTION 'phase0_runtime cannot own the current database';
            END IF;
            IF EXISTS (
              SELECT 1
              FROM pg_namespace namespace_record
              JOIN pg_roles owner_role ON owner_role.oid = namespace_record.nspowner
              WHERE namespace_record.nspname = 'public'
                AND owner_role.rolname = 'phase0_runtime'
            ) THEN
              RAISE EXCEPTION 'phase0_runtime cannot own schema public';
            END IF;
          END IF;
        END
        $$
        """
    )
    op.execute("REVOKE ALL ON public.phase0_evidence_records FROM PUBLIC")
    op.execute("REVOKE ALL ON public.phase0_evidence_projection FROM PUBLIC")
    op.execute("REVOKE ALL ON FUNCTION public.phase0_canonical_jsonb(jsonb) FROM PUBLIC")
    op.execute(
        "REVOKE ALL ON FUNCTION public.phase0_append_evidence(text,text,text,text) FROM PUBLIC"
    )
    op.execute("REVOKE ALL ON public.phase0_evidence_records FROM phase0_runtime")
    op.execute("REVOKE ALL ON public.phase0_evidence_projection FROM phase0_runtime")
    op.execute("REVOKE ALL ON FUNCTION public.phase0_canonical_jsonb(jsonb) FROM phase0_runtime")
    op.execute(
        "REVOKE ALL ON FUNCTION public.phase0_append_evidence(text,text,text,text) "
        "FROM phase0_runtime"
    )
    op.execute("REVOKE ALL ON SCHEMA public FROM phase0_runtime")
    op.execute("REVOKE CREATE ON SCHEMA public FROM PUBLIC")
    op.execute("GRANT USAGE ON SCHEMA public TO phase0_runtime")
    op.execute("GRANT SELECT ON public.phase0_evidence_records TO phase0_runtime")
    op.execute("GRANT SELECT ON public.phase0_evidence_projection TO phase0_runtime")
    op.execute(
        "GRANT EXECUTE ON FUNCTION public.phase0_append_evidence(text,text,text,text) "
        "TO phase0_runtime"
    )


def downgrade() -> None:
    op.execute(
        "REVOKE ALL ON FUNCTION public.phase0_append_evidence(text,text,text,text) "
        "FROM phase0_runtime"
    )
    op.execute("REVOKE ALL ON public.phase0_evidence_projection FROM phase0_runtime")
    op.execute("REVOKE ALL ON public.phase0_evidence_records FROM phase0_runtime")
    op.execute("DROP TRIGGER phase0_evidence_no_truncate ON public.phase0_evidence_records")
    op.execute("DROP TRIGGER phase0_evidence_no_mutation ON public.phase0_evidence_records")
    op.execute("DROP FUNCTION public.phase0_evidence_immutable()")
    op.execute("DROP VIEW public.phase0_evidence_projection")
    op.execute("DROP FUNCTION public.phase0_append_evidence(text,text,text,text)")
    op.execute("DROP FUNCTION public.phase0_canonical_jsonb(jsonb)")
    op.drop_table("phase0_evidence_records")
