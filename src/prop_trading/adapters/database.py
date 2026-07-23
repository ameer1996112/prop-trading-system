"""Async PostgreSQL foundation without startup side effects."""

from __future__ import annotations

import datetime as dt
import hashlib
import uuid
from dataclasses import dataclass
from typing import cast

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine, create_async_engine

from prop_trading.contracts.models import ProviderCapabilityEvidence
from prop_trading.domain.canonical import canonical_json_bytes


@dataclass(frozen=True, slots=True)
class EvidenceLedgerAppendResult:
    id: uuid.UUID
    evidence_id: str
    gate_id: str
    canonical_payload_text: str
    canonical_sha256: str
    payload: dict[str, object]
    source_note: str
    recorded_at: dt.datetime


class EvidenceLedgerRepository:
    """Narrow typed append boundary; the runtime role cannot insert into the table directly."""

    async def append(
        self,
        connection: AsyncConnection,
        evidence: ProviderCapabilityEvidence,
        *,
        source_note: str,
    ) -> EvidenceLedgerAppendResult:
        canonical_bytes = canonical_json_bytes(evidence.model_dump(mode="json"))
        canonical_text = canonical_bytes.decode("utf-8")
        expected_sha = hashlib.sha256(canonical_bytes).hexdigest()
        row = (
            (
                await connection.execute(
                    text(
                        """
                    SELECT id, evidence_id, gate_id, canonical_payload_text,
                           canonical_sha256, payload, source_note, recorded_at
                    FROM public.phase0_append_evidence(
                      :evidence_id, :gate_id, :canonical_payload_text, :source_note
                    )
                    """
                    ),
                    {
                        "evidence_id": evidence.evidence_id,
                        "gate_id": evidence.gate_id.value,
                        "canonical_payload_text": canonical_text,
                        "source_note": source_note,
                    },
                )
            )
            .mappings()
            .one()
        )
        if (
            row["canonical_payload_text"] != canonical_text
            or row["canonical_sha256"] != expected_sha
            or row["evidence_id"] != evidence.evidence_id
            or row["gate_id"] != evidence.gate_id.value
        ):
            raise RuntimeError(
                "database append result is not bound to the submitted canonical bytes"
            )
        return EvidenceLedgerAppendResult(
            id=cast(uuid.UUID, row["id"]),
            evidence_id=cast(str, row["evidence_id"]),
            gate_id=cast(str, row["gate_id"]),
            canonical_payload_text=cast(str, row["canonical_payload_text"]),
            canonical_sha256=cast(str, row["canonical_sha256"]),
            payload=cast(dict[str, object], row["payload"]),
            source_note=cast(str, row["source_note"]),
            recorded_at=cast(dt.datetime, row["recorded_at"]),
        )


def create_database_engine(dsn: str) -> AsyncEngine:
    """Construct, but do not connect, an async SQLAlchemy engine."""
    return create_async_engine(dsn, pool_pre_ping=True)


async def dispose_database_engine(engine: AsyncEngine) -> None:
    await engine.dispose()
