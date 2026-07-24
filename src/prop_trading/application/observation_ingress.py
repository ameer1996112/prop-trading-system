"""Observation-only TradingView ingress and receipt application boundary."""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import logging
from collections.abc import Sequence
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from typing import Literal, Protocol
from uuid import uuid4

from prop_trading.contracts.models import (
    ObservationReceipt,
    ObservationReceiptList,
    ObservationReceiptStatus,
    TradingViewObservationEnvelope,
    TradingViewObservationPayload,
)
from prop_trading.domain.canonical import canonical_sha256

logger = logging.getLogger(__name__)


class ObservationIngressDisabledError(RuntimeError):
    """Raised when the explicit ingress gate or credential configuration is absent."""


class ObservationCredentialRejectedError(RuntimeError):
    """Raised when a presented TradingView credential does not match configuration."""


class ObservationReceiptConflictError(RuntimeError):
    """Raised for an idempotency key replay carrying different immutable content."""


class ObservationStorageUnavailableError(RuntimeError):
    """Raised when durable receipt storage cannot safely service the request."""


@dataclass(frozen=True, slots=True)
class ObservationReceiptDraft:
    idempotency_key: str
    payload_sha256: str
    schema_version: str
    strategy_id: str
    strategy_version: str
    producer_instance_id: str
    sequence: int
    symbol: str
    ticker_id: str
    feed: str
    timeframe: str
    kind: Literal["incremental", "snapshot"]


@dataclass(frozen=True, slots=True)
class ObservationReceiptRecord:
    receipt_id: str
    received_at: datetime
    idempotency_key: str
    payload_sha256: str
    schema_version: str
    strategy_id: str
    strategy_version: str
    producer_instance_id: str
    sequence: int
    symbol: str
    ticker_id: str
    feed: str
    timeframe: str
    kind: Literal["incremental", "snapshot"]


@dataclass(frozen=True, slots=True)
class ObservationReceiptAppendResult:
    record: ObservationReceiptRecord
    inserted: bool


class ObservationReceiptRepository(Protocol):
    """Credential-free persistence port with atomic idempotency semantics."""

    async def append(
        self,
        draft: ObservationReceiptDraft,
    ) -> ObservationReceiptAppendResult: ...

    async def list(self, *, limit: int) -> Sequence[ObservationReceiptRecord]: ...


class InMemoryObservationReceiptRepository:
    """Race-safe reference adapter for local/test operation."""

    def __init__(self) -> None:
        self._by_idempotency_key: dict[str, ObservationReceiptRecord] = {}
        self._lock = asyncio.Lock()

    async def append(
        self,
        draft: ObservationReceiptDraft,
    ) -> ObservationReceiptAppendResult:
        async with self._lock:
            existing = self._by_idempotency_key.get(draft.idempotency_key)
            if existing is not None:
                if existing.payload_sha256 != draft.payload_sha256:
                    raise ObservationReceiptConflictError(
                        "idempotency key was already used for different content"
                    )
                return ObservationReceiptAppendResult(record=existing, inserted=False)

            record = ObservationReceiptRecord(
                receipt_id=str(uuid4()),
                received_at=datetime.now(UTC),
                **asdict(draft),
            )
            self._by_idempotency_key[draft.idempotency_key] = record
            return ObservationReceiptAppendResult(record=record, inserted=True)

    async def list(self, *, limit: int) -> Sequence[ObservationReceiptRecord]:
        async with self._lock:
            records = sorted(
                self._by_idempotency_key.values(),
                key=lambda item: (item.received_at, item.receipt_id),
                reverse=True,
            )
            return tuple(records[:limit])


class ObservationIngressService:
    """Authenticate, canonicalize, and persist observation receipts only."""

    def __init__(
        self,
        *,
        enabled: bool,
        credential_sha256: str | None,
        repository: ObservationReceiptRepository | None,
    ) -> None:
        self._enabled = enabled
        self._credential_sha256 = credential_sha256
        self._repository = repository

    def require_enabled(self) -> None:
        if not self._enabled or self._credential_sha256 is None:
            raise ObservationIngressDisabledError("TradingView observation ingress is not enabled")

    async def receive(self, envelope: TradingViewObservationEnvelope) -> ObservationReceipt:
        repository = self._require_repository()
        self._authenticate(envelope)
        payload = envelope.payload
        payload_sha256 = canonical_sha256(payload.model_dump(mode="json"))
        draft = self._draft(payload, payload_sha256)
        try:
            result = await repository.append(draft)
            status = (
                ObservationReceiptStatus.RECEIVED
                if result.inserted
                else ObservationReceiptStatus.DUPLICATE
            )
            return self._receipt(result.record, status=status)
        except ObservationReceiptConflictError:
            raise
        except Exception as exc:
            logger.exception(
                "observation receipt append failed",
                extra={"idempotency_key": draft.idempotency_key},
            )
            raise ObservationStorageUnavailableError(
                "observation receipt storage is unavailable"
            ) from exc

    async def list_receipts(self, *, limit: int) -> ObservationReceiptList:
        repository = self._require_repository()
        try:
            records = await repository.list(limit=limit)
            items = [
                self._receipt(record, status=ObservationReceiptStatus.RECEIVED)
                for record in records
            ]
            return ObservationReceiptList(
                mode="OBSERVATION_ONLY",
                ingress_enabled=True,
                items=items,
                count=len(items),
            )
        except Exception as exc:
            logger.exception("observation receipt list failed")
            raise ObservationStorageUnavailableError(
                "observation receipt storage is unavailable"
            ) from exc

    def _require_repository(self) -> ObservationReceiptRepository:
        self.require_enabled()
        if self._repository is None:
            raise ObservationStorageUnavailableError("observation receipt storage is unavailable")
        return self._repository

    def _authenticate(self, envelope: TradingViewObservationEnvelope) -> None:
        assert self._credential_sha256 is not None
        presented_digest = hashlib.sha256(
            envelope.credential.get_secret_value().encode("utf-8")
        ).hexdigest()
        if not hmac.compare_digest(self._credential_sha256, presented_digest):
            raise ObservationCredentialRejectedError("observation credential was rejected")

    @staticmethod
    def _draft(
        payload: TradingViewObservationPayload,
        payload_sha256: str,
    ) -> ObservationReceiptDraft:
        return ObservationReceiptDraft(
            idempotency_key=payload.idempotency_key,
            payload_sha256=payload_sha256,
            schema_version=payload.schema_version,
            strategy_id=payload.strategy_id,
            strategy_version=payload.strategy_version,
            producer_instance_id=payload.producer_instance_id,
            sequence=payload.sequence,
            symbol=payload.symbol,
            ticker_id=payload.ticker_id,
            feed=payload.feed,
            timeframe=payload.timeframe,
            kind=payload.kind,
        )

    @staticmethod
    def _receipt(
        record: ObservationReceiptRecord,
        *,
        status: ObservationReceiptStatus,
    ) -> ObservationReceipt:
        if record.received_at.tzinfo is None or record.received_at.utcoffset() is None:
            raise ValueError("receipt received_at must be timezone-aware")
        received_at = (
            record.received_at.astimezone(UTC)
            .isoformat(timespec="microseconds")
            .replace("+00:00", "Z")
        )
        return ObservationReceipt.model_validate(
            {
                "receipt_id": record.receipt_id,
                "received_at": received_at,
                "idempotency_key": record.idempotency_key,
                "payload_sha256": record.payload_sha256,
                "schema_version": record.schema_version,
                "strategy_id": record.strategy_id,
                "strategy_version": record.strategy_version,
                "producer_instance_id": record.producer_instance_id,
                "sequence": record.sequence,
                "symbol": record.symbol,
                "ticker_id": record.ticker_id,
                "feed": record.feed,
                "timeframe": record.timeframe,
                "kind": record.kind,
                "status": status,
            }
        )
