"""Async PostgreSQL foundation without startup side effects."""

from __future__ import annotations

import datetime as dt
import hashlib
import uuid
from dataclasses import dataclass
from typing import Literal, cast

from sqlalchemy import text
from sqlalchemy.engine import RowMapping
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine, create_async_engine

from prop_trading.application.observation_ingress import (
    ObservationReceiptAppendResult,
    ObservationReceiptConflictError,
    ObservationReceiptDraft,
    ObservationReceiptRecord,
)
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


class PostgresObservationReceiptRepository:
    """Transactional, credential-free adapter for append-only ingress receipts."""

    def __init__(self, engine: AsyncEngine, *, max_list_limit: int = 100) -> None:
        if max_list_limit < 1:
            raise ValueError("max_list_limit must be positive")
        self._engine = engine
        self._max_list_limit = max_list_limit

    async def append(self, draft: ObservationReceiptDraft) -> ObservationReceiptAppendResult:
        """Append once, or return the original row for an exact replay."""
        async with self._engine.begin() as connection:
            await _assume_receipt_runtime_role(connection)
            row = (
                (
                    await connection.execute(
                        text(
                            """
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
                              received_at,
                              inserted,
                              matches_submission
                            FROM public.phase1a_append_observation_receipt(
                              :idempotency_key,
                              :payload_sha256,
                              :schema_version,
                              :strategy_id,
                              :strategy_version,
                              :producer_instance_id,
                              :sequence,
                              :symbol,
                              :ticker_id,
                              :feed,
                              :timeframe,
                              :kind
                            )
                            """
                        ),
                        _draft_parameters(draft),
                    )
                )
                .mappings()
                .one()
            )
            matches_submission = row["matches_submission"]
            if not isinstance(matches_submission, bool):
                raise RuntimeError("database returned an invalid receipt match flag")
            if not matches_submission:
                raise ObservationReceiptConflictError(
                    "idempotency key was already used for different content"
                )
            _assert_row_matches_draft(row, draft)
            inserted = row["inserted"]
            if not isinstance(inserted, bool):
                raise RuntimeError("database returned an invalid receipt insertion flag")
            return ObservationReceiptAppendResult(
                record=_record_from_row(row),
                inserted=inserted,
            )

    async def list(self, *, limit: int) -> list[ObservationReceiptRecord]:
        """List newest receipts first through the credential-free projection."""
        if isinstance(limit, bool) or not 1 <= limit <= self._max_list_limit:
            raise ValueError(f"limit must be between 1 and {self._max_list_limit}")
        async with self._engine.begin() as connection:
            await _assume_receipt_runtime_role(connection)
            rows = (
                (
                    await connection.execute(
                        text(
                            """
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
                            FROM public.phase1a_observation_receipt_projection
                            ORDER BY received_at DESC, receipt_id DESC
                            LIMIT :limit
                            """
                        ),
                        {"limit": limit},
                    )
                )
                .mappings()
                .all()
            )
            return [_record_from_row(row) for row in rows]


async def _assume_receipt_runtime_role(connection: AsyncConnection) -> None:
    """Drop owner privileges for the remainder of the current transaction."""
    await connection.execute(text("SET LOCAL ROLE phase0_runtime"))


def _draft_parameters(draft: ObservationReceiptDraft) -> dict[str, object]:
    return {
        "idempotency_key": draft.idempotency_key,
        "payload_sha256": draft.payload_sha256,
        "schema_version": draft.schema_version,
        "strategy_id": draft.strategy_id,
        "strategy_version": draft.strategy_version,
        "producer_instance_id": draft.producer_instance_id,
        "sequence": draft.sequence,
        "symbol": draft.symbol,
        "ticker_id": draft.ticker_id,
        "feed": draft.feed,
        "timeframe": draft.timeframe,
        "kind": draft.kind,
    }


def _assert_row_matches_draft(
    row: RowMapping,
    draft: ObservationReceiptDraft,
) -> None:
    for field_name, submitted_value in _draft_parameters(draft).items():
        if row[field_name] != submitted_value:
            raise RuntimeError("database receipt row is not bound to the submitted metadata")


def _record_from_row(row: RowMapping) -> ObservationReceiptRecord:
    status = row["status"]
    if status != "RECEIVED":
        raise RuntimeError("database returned a receipt with an invalid stored status")
    kind = row["kind"]
    if kind not in {"incremental", "snapshot"}:
        raise RuntimeError("database returned a receipt with an invalid kind")
    receipt_id = row["receipt_id"]
    try:
        normalized_receipt_id = str(uuid.UUID(str(receipt_id)))
    except (TypeError, ValueError, AttributeError) as exc:
        raise RuntimeError("database returned an invalid receipt identifier") from exc
    received_at = row["received_at"]
    if (
        not isinstance(received_at, dt.datetime)
        or received_at.tzinfo is None
        or received_at.utcoffset() is None
    ):
        raise RuntimeError("database returned a naive receipt timestamp")
    return ObservationReceiptRecord(
        receipt_id=normalized_receipt_id,
        idempotency_key=cast(str, row["idempotency_key"]),
        payload_sha256=cast(str, row["payload_sha256"]),
        schema_version=cast(str, row["schema_version"]),
        strategy_id=cast(str, row["strategy_id"]),
        strategy_version=cast(str, row["strategy_version"]),
        producer_instance_id=cast(str, row["producer_instance_id"]),
        sequence=cast(int, row["sequence"]),
        symbol=cast(str, row["symbol"]),
        ticker_id=cast(str, row["ticker_id"]),
        feed=cast(str, row["feed"]),
        timeframe=cast(str, row["timeframe"]),
        kind=cast(Literal["incremental", "snapshot"], kind),
        received_at=received_at.astimezone(dt.UTC),
    )


def create_database_engine(dsn: str) -> AsyncEngine:
    """Construct, but do not connect, an async SQLAlchemy engine."""
    return create_async_engine(dsn, pool_pre_ping=True)


async def dispose_database_engine(engine: AsyncEngine) -> None:
    await engine.dispose()
