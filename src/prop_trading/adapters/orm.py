"""Phase 0 SQLAlchemy metadata: evidence only."""

from __future__ import annotations

import datetime as dt
import uuid

from sqlalchemy import Computed, DateTime, String, Text, text
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
