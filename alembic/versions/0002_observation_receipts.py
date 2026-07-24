"""Create append-only TradingView LAB observation receipts.

Revision ID: 0002_observation_receipts
Revises: 0001_phase0
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0002_observation_receipts"
down_revision = "0001_phase0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "observation_receipts",
        sa.Column(
            "receipt_id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("idempotency_key", sa.String(length=200), nullable=False),
        sa.Column("payload_sha256", sa.String(length=64), nullable=False),
        sa.Column("schema_version", sa.String(length=32), nullable=False),
        sa.Column("strategy_id", sa.String(length=160), nullable=False),
        sa.Column("strategy_version", sa.String(length=64), nullable=False),
        sa.Column("producer_instance_id", sa.String(length=160), nullable=False),
        sa.Column("sequence", sa.BigInteger(), nullable=False),
        sa.Column("symbol", sa.String(length=64), nullable=False),
        sa.Column("ticker_id", sa.String(length=160), nullable=False),
        sa.Column("feed", sa.String(length=64), nullable=False),
        sa.Column("timeframe", sa.String(length=32), nullable=False),
        sa.Column("kind", sa.String(length=64), nullable=False),
        sa.Column(
            "status",
            sa.String(length=16),
            server_default=sa.text("'RECEIVED'"),
            nullable=False,
        ),
        sa.Column(
            "received_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("clock_timestamp()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "length(idempotency_key) BETWEEN 1 AND 200",
            name="ck_observation_receipt_idempotency_key",
        ),
        sa.CheckConstraint(
            "payload_sha256 ~ '^[0-9a-f]{64}$'",
            name="ck_observation_receipt_payload_sha256",
        ),
        sa.CheckConstraint(
            "length(schema_version) BETWEEN 1 AND 32",
            name="ck_observation_receipt_schema_version",
        ),
        sa.CheckConstraint(
            "length(strategy_id) BETWEEN 1 AND 160",
            name="ck_observation_receipt_strategy_id",
        ),
        sa.CheckConstraint(
            "length(strategy_version) BETWEEN 1 AND 64",
            name="ck_observation_receipt_strategy_version",
        ),
        sa.CheckConstraint(
            "length(producer_instance_id) BETWEEN 1 AND 160",
            name="ck_observation_receipt_producer_instance_id",
        ),
        sa.CheckConstraint(
            "length(symbol) BETWEEN 1 AND 64",
            name="ck_observation_receipt_symbol",
        ),
        sa.CheckConstraint(
            "length(ticker_id) BETWEEN 1 AND 160",
            name="ck_observation_receipt_ticker_id",
        ),
        sa.CheckConstraint(
            "length(feed) BETWEEN 1 AND 64",
            name="ck_observation_receipt_feed",
        ),
        sa.CheckConstraint(
            "length(timeframe) BETWEEN 1 AND 32",
            name="ck_observation_receipt_timeframe",
        ),
        sa.CheckConstraint(
            "length(kind) BETWEEN 1 AND 64",
            name="ck_observation_receipt_kind",
        ),
        sa.CheckConstraint("sequence >= 0", name="ck_observation_receipt_sequence"),
        sa.CheckConstraint("status = 'RECEIVED'", name="ck_observation_receipt_status"),
        sa.PrimaryKeyConstraint("receipt_id"),
        sa.UniqueConstraint(
            "idempotency_key",
            name="uq_observation_receipts_idempotency_key",
        ),
    )
    op.execute(
        """
        CREATE FUNCTION public.phase1a_append_observation_receipt(
          p_idempotency_key text,
          p_payload_sha256 text,
          p_schema_version text,
          p_strategy_id text,
          p_strategy_version text,
          p_producer_instance_id text,
          p_sequence bigint,
          p_symbol text,
          p_ticker_id text,
          p_feed text,
          p_timeframe text,
          p_kind text
        ) RETURNS TABLE (
          receipt_id uuid,
          idempotency_key text,
          payload_sha256 text,
          schema_version text,
          strategy_id text,
          strategy_version text,
          producer_instance_id text,
          sequence bigint,
          symbol text,
          ticker_id text,
          feed text,
          timeframe text,
          kind text,
          status text,
          received_at timestamptz,
          inserted boolean,
          matches_submission boolean
        )
        LANGUAGE plpgsql SECURITY DEFINER
        SET search_path = pg_catalog, pg_temp
        AS $$
        DECLARE
          v_existing public.observation_receipts%ROWTYPE;
        BEGIN
          PERFORM pg_catalog.pg_advisory_xact_lock(
            pg_catalog.hashtextextended(p_idempotency_key, 0)
          );
          SELECT stored.*
          INTO v_existing
          FROM public.observation_receipts AS stored
          WHERE stored.idempotency_key = p_idempotency_key;

          IF FOUND THEN
            RETURN QUERY SELECT
              v_existing.receipt_id,
              v_existing.idempotency_key::text,
              v_existing.payload_sha256::text,
              v_existing.schema_version::text,
              v_existing.strategy_id::text,
              v_existing.strategy_version::text,
              v_existing.producer_instance_id::text,
              v_existing.sequence,
              v_existing.symbol::text,
              v_existing.ticker_id::text,
              v_existing.feed::text,
              v_existing.timeframe::text,
              v_existing.kind::text,
              v_existing.status::text,
              v_existing.received_at,
              false,
              (
                v_existing.payload_sha256 IS NOT DISTINCT FROM p_payload_sha256
                AND v_existing.schema_version IS NOT DISTINCT FROM p_schema_version
                AND v_existing.strategy_id IS NOT DISTINCT FROM p_strategy_id
                AND v_existing.strategy_version IS NOT DISTINCT FROM p_strategy_version
                AND v_existing.producer_instance_id
                  IS NOT DISTINCT FROM p_producer_instance_id
                AND v_existing.sequence IS NOT DISTINCT FROM p_sequence
                AND v_existing.symbol IS NOT DISTINCT FROM p_symbol
                AND v_existing.ticker_id IS NOT DISTINCT FROM p_ticker_id
                AND v_existing.feed IS NOT DISTINCT FROM p_feed
                AND v_existing.timeframe IS NOT DISTINCT FROM p_timeframe
                AND v_existing.kind IS NOT DISTINCT FROM p_kind
              );
            RETURN;
          END IF;

          RETURN QUERY
          INSERT INTO public.observation_receipts (
            idempotency_key,
            payload_sha256,
            schema_version,
            strategy_id,
            strategy_version,
            producer_instance_id,
            sequence,
            symbol,
            ticker_id,
            feed,
            timeframe,
            kind
          ) VALUES (
            p_idempotency_key,
            p_payload_sha256,
            p_schema_version,
            p_strategy_id,
            p_strategy_version,
            p_producer_instance_id,
            p_sequence,
            p_symbol,
            p_ticker_id,
            p_feed,
            p_timeframe,
            p_kind
          )
          RETURNING
            observation_receipts.receipt_id,
            observation_receipts.idempotency_key::text,
            observation_receipts.payload_sha256::text,
            observation_receipts.schema_version::text,
            observation_receipts.strategy_id::text,
            observation_receipts.strategy_version::text,
            observation_receipts.producer_instance_id::text,
            observation_receipts.sequence,
            observation_receipts.symbol::text,
            observation_receipts.ticker_id::text,
            observation_receipts.feed::text,
            observation_receipts.timeframe::text,
            observation_receipts.kind::text,
            observation_receipts.status::text,
            observation_receipts.received_at,
            true,
            true;
        END;
        $$
        """
    )
    op.execute(
        """
        CREATE VIEW public.phase1a_observation_receipt_projection AS
        SELECT
          receipt_id,
          idempotency_key,
          payload_sha256,
          schema_version,
          strategy_id,
          strategy_version,
          producer_instance_id,
          sequence,
          symbol,
          ticker_id,
          feed,
          timeframe,
          kind,
          status,
          received_at
        FROM public.observation_receipts
        """
    )
    op.execute(
        """
        CREATE FUNCTION public.phase1a_observation_receipt_immutable() RETURNS trigger
        LANGUAGE plpgsql
        SET search_path = pg_catalog, pg_temp
        AS $$
        BEGIN
          RAISE EXCEPTION 'observation receipts are append-only';
        END;
        $$
        """
    )
    op.execute(
        """
        CREATE TRIGGER phase1a_observation_receipt_no_mutation
        BEFORE UPDATE OR DELETE ON public.observation_receipts
        FOR EACH ROW EXECUTE FUNCTION public.phase1a_observation_receipt_immutable()
        """
    )
    op.execute(
        """
        CREATE TRIGGER phase1a_observation_receipt_no_truncate
        BEFORE TRUNCATE ON public.observation_receipts
        FOR EACH STATEMENT EXECUTE FUNCTION public.phase1a_observation_receipt_immutable()
        """
    )
    op.execute("GRANT phase0_runtime TO CURRENT_USER")
    op.execute("SET LOCAL ROLE phase0_runtime")
    op.execute("RESET ROLE")
    op.execute("REVOKE ALL ON public.observation_receipts FROM PUBLIC")
    op.execute("REVOKE ALL ON public.phase1a_observation_receipt_projection FROM PUBLIC")
    op.execute(
        "REVOKE ALL ON FUNCTION "
        "public.phase1a_append_observation_receipt("
        "text,text,text,text,text,text,bigint,text,text,text,text,text"
        ") FROM PUBLIC"
    )
    op.execute("REVOKE ALL ON public.observation_receipts FROM phase0_runtime")
    op.execute("REVOKE ALL ON public.phase1a_observation_receipt_projection FROM phase0_runtime")
    op.execute(
        "REVOKE ALL ON FUNCTION "
        "public.phase1a_append_observation_receipt("
        "text,text,text,text,text,text,bigint,text,text,text,text,text"
        ") FROM phase0_runtime"
    )
    op.execute("GRANT SELECT ON public.phase1a_observation_receipt_projection TO phase0_runtime")
    op.execute(
        "GRANT EXECUTE ON FUNCTION "
        "public.phase1a_append_observation_receipt("
        "text,text,text,text,text,text,bigint,text,text,text,text,text"
        ") TO phase0_runtime"
    )


def downgrade() -> None:
    op.execute(
        "REVOKE ALL ON FUNCTION "
        "public.phase1a_append_observation_receipt("
        "text,text,text,text,text,text,bigint,text,text,text,text,text"
        ") FROM phase0_runtime"
    )
    op.execute("REVOKE ALL ON public.phase1a_observation_receipt_projection FROM phase0_runtime")
    op.execute(
        "DROP TRIGGER phase1a_observation_receipt_no_truncate ON public.observation_receipts"
    )
    op.execute(
        "DROP TRIGGER phase1a_observation_receipt_no_mutation ON public.observation_receipts"
    )
    op.execute("DROP FUNCTION public.phase1a_observation_receipt_immutable()")
    op.execute("DROP VIEW public.phase1a_observation_receipt_projection")
    op.execute(
        "DROP FUNCTION public.phase1a_append_observation_receipt("
        "text,text,text,text,text,text,bigint,text,text,text,text,text"
        ")"
    )
    op.drop_table("observation_receipts")
    op.execute("REVOKE phase0_runtime FROM CURRENT_USER")
