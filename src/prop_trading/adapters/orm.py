"""SQLAlchemy metadata for append-only operational evidence."""

from __future__ import annotations

import datetime as dt
import uuid

from sqlalchemy import BigInteger, CheckConstraint, Computed, DateTime, String, Text, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class Phase0EvidenceRecord(Base):
    """Append-only capability evidence; mutation is blocked by the database migration."""

    __tablename__ = "phase0_evidence_records"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    evidence_id: Mapped[str] = mapped_column(String(160), unique=True, nullable=False)
    gate_id: Mapped[str] = mapped_column(String(160), nullable=False)
    canonical_payload_text: Mapped[str] = mapped_column(Text, nullable=False)
    canonical_sha256: Mapped[str] = mapped_column(
        String(64),
        Computed(
            "encode(digest(canonical_payload_text, 'sha256'), 'hex')",
            persisted=True,
        ),
        nullable=False,
    )
    source_note: Mapped[str] = mapped_column(Text, nullable=False)
    recorded_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("clock_timestamp()")
    )


class ObservationReceiptRow(Base):
    """Credential-free metadata proving that an observation reached the LAB ingress."""

    __tablename__ = "observation_receipts"
    __table_args__ = (
        CheckConstraint(
            "length(idempotency_key) BETWEEN 1 AND 200",
            name="ck_observation_receipt_idempotency_key",
        ),
        CheckConstraint(
            "payload_sha256 ~ '^[0-9a-f]{64}$'",
            name="ck_observation_receipt_payload_sha256",
        ),
        CheckConstraint(
            "length(schema_version) BETWEEN 1 AND 32",
            name="ck_observation_receipt_schema_version",
        ),
        CheckConstraint(
            "length(strategy_id) BETWEEN 1 AND 160",
            name="ck_observation_receipt_strategy_id",
        ),
        CheckConstraint(
            "length(strategy_version) BETWEEN 1 AND 64",
            name="ck_observation_receipt_strategy_version",
        ),
        CheckConstraint(
            "length(producer_instance_id) BETWEEN 1 AND 160",
            name="ck_observation_receipt_producer_instance_id",
        ),
        CheckConstraint(
            "length(symbol) BETWEEN 1 AND 64",
            name="ck_observation_receipt_symbol",
        ),
        CheckConstraint(
            "length(ticker_id) BETWEEN 1 AND 160",
            name="ck_observation_receipt_ticker_id",
        ),
        CheckConstraint(
            "length(feed) BETWEEN 1 AND 64",
            name="ck_observation_receipt_feed",
        ),
        CheckConstraint(
            "length(timeframe) BETWEEN 1 AND 32",
            name="ck_observation_receipt_timeframe",
        ),
        CheckConstraint(
            "length(kind) BETWEEN 1 AND 64",
            name="ck_observation_receipt_kind",
        ),
        CheckConstraint("sequence >= 0", name="ck_observation_receipt_sequence"),
        CheckConstraint(
            "status = 'RECEIVED'",
            name="ck_observation_receipt_status",
        ),
    )

    receipt_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    idempotency_key: Mapped[str] = mapped_column(String(200), unique=True, nullable=False)
    payload_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    schema_version: Mapped[str] = mapped_column(String(32), nullable=False)
    strategy_id: Mapped[str] = mapped_column(String(160), nullable=False)
    strategy_version: Mapped[str] = mapped_column(String(64), nullable=False)
    producer_instance_id: Mapped[str] = mapped_column(String(160), nullable=False)
    symbol: Mapped[str] = mapped_column(String(64), nullable=False)
    ticker_id: Mapped[str] = mapped_column(String(160), nullable=False)
    feed: Mapped[str] = mapped_column(String(64), nullable=False)
    timeframe: Mapped[str] = mapped_column(String(32), nullable=False)
    kind: Mapped[str] = mapped_column(String(64), nullable=False)
    sequence: Mapped[int] = mapped_column(BigInteger, nullable=False)
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, server_default=text("'RECEIVED'")
    )
    received_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("clock_timestamp()")
    )
