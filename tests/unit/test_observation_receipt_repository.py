from __future__ import annotations

import uuid
from collections.abc import Mapping
from datetime import UTC, datetime
from types import TracebackType
from typing import Any, Self, cast

import pytest
from sqlalchemy.ext.asyncio import AsyncEngine

from prop_trading.adapters.database import PostgresObservationReceiptRepository
from prop_trading.application.observation_ingress import (
    ObservationReceiptConflictError,
    ObservationReceiptDraft,
)


class _FakeResult:
    def __init__(self, rows: list[dict[str, object]]) -> None:
        self._rows = rows

    def mappings(self) -> Self:
        return self

    def one(self) -> dict[str, object]:
        assert len(self._rows) == 1
        return self._rows[0]

    def all(self) -> list[dict[str, object]]:
        return self._rows


class _FakeConnection:
    def __init__(
        self,
        rows: list[dict[str, object]],
        *,
        fail_on_call: int | None = None,
    ) -> None:
        self._rows = rows
        self._fail_on_call = fail_on_call
        self.calls: list[tuple[str, Mapping[str, object]]] = []

    async def execute(
        self,
        statement: Any,
        parameters: Mapping[str, object] | None = None,
    ) -> _FakeResult:
        self.calls.append((str(statement), parameters or {}))
        if self._fail_on_call == len(self.calls):
            raise PermissionError("runtime role assumption rejected")
        return _FakeResult(self._rows)


class _FakeTransaction:
    def __init__(self, connection: _FakeConnection) -> None:
        self._connection = connection
        self.exit_exception_type: type[BaseException] | None = None

    async def __aenter__(self) -> _FakeConnection:
        return self._connection

    async def __aexit__(
        self,
        exception_type: type[BaseException] | None,
        exception: BaseException | None,
        traceback: TracebackType | None,
    ) -> bool:
        del exception, traceback
        self.exit_exception_type = exception_type
        return False


class _FakeEngine:
    def __init__(
        self,
        rows: list[dict[str, object]],
        *,
        fail_on_call: int | None = None,
    ) -> None:
        self.connection = _FakeConnection(rows, fail_on_call=fail_on_call)
        self.transaction = _FakeTransaction(self.connection)
        self.begin_calls = 0

    def begin(self) -> _FakeTransaction:
        self.begin_calls += 1
        return self.transaction


def _draft(**changes: object) -> ObservationReceiptDraft:
    values: dict[str, object] = {
        "idempotency_key": "tv-lab-0001",
        "payload_sha256": "a" * 64,
        "schema_version": "1.0",
        "strategy_id": "lab-observer",
        "strategy_version": "2026.07",
        "producer_instance_id": "tv-chart-1",
        "sequence": 42,
        "symbol": "EURUSD",
        "ticker_id": "OANDA:EURUSD",
        "feed": "OANDA",
        "timeframe": "5m",
        "kind": "incremental",
    }
    values.update(changes)
    return ObservationReceiptDraft(**values)  # type: ignore[arg-type]


def _row(
    draft: ObservationReceiptDraft,
    *,
    inserted: bool = True,
    matches_submission: bool = True,
    received_at: datetime | None = None,
) -> dict[str, object]:
    return {
        "receipt_id": uuid.UUID("01234567-89ab-cdef-0123-456789abcdef"),
        "received_at": received_at or datetime(2026, 7, 23, 8, 0, tzinfo=UTC),
        "status": "RECEIVED",
        "inserted": inserted,
        "matches_submission": matches_submission,
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


@pytest.mark.asyncio
async def test_append_owns_transaction_and_sends_only_credential_free_metadata() -> None:
    draft = _draft()
    engine = _FakeEngine([_row(draft)])
    repository = PostgresObservationReceiptRepository(cast(AsyncEngine, engine))

    result = await repository.append(draft)

    assert result.inserted is True
    assert result.record.receipt_id == "01234567-89ab-cdef-0123-456789abcdef"
    assert result.record.received_at.tzinfo is UTC
    assert result.record.payload_sha256 == "a" * 64
    assert engine.begin_calls == 1
    assert engine.transaction.exit_exception_type is None
    assert len(engine.connection.calls) == 2
    role_statement, role_parameters = engine.connection.calls[0]
    assert role_statement.strip() == "SET LOCAL ROLE phase0_runtime"
    assert role_parameters == {}
    statement, parameters = engine.connection.calls[1]
    assert "phase1a_append_observation_receipt" in statement
    assert parameters == {
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
    assert all("credential" not in name and "raw" not in name for name in parameters)


@pytest.mark.asyncio
async def test_identical_replay_returns_original_receipt_without_inserting() -> None:
    draft = _draft()
    engine = _FakeEngine([_row(draft, inserted=False)])
    repository = PostgresObservationReceiptRepository(cast(AsyncEngine, engine))

    result = await repository.append(draft)

    assert result.inserted is False
    assert result.record.idempotency_key == draft.idempotency_key
    assert engine.transaction.exit_exception_type is None
    assert engine.connection.calls[0][0].strip() == "SET LOCAL ROLE phase0_runtime"


@pytest.mark.asyncio
async def test_conflicting_replay_raises_typed_error_and_rolls_back() -> None:
    draft = _draft()
    existing = _row(
        _draft(payload_sha256="b" * 64),
        inserted=False,
        matches_submission=False,
    )
    engine = _FakeEngine([existing])
    repository = PostgresObservationReceiptRepository(cast(AsyncEngine, engine))

    with pytest.raises(
        ObservationReceiptConflictError,
        match="idempotency key was already used for different content",
    ):
        await repository.append(draft)

    assert engine.transaction.exit_exception_type is ObservationReceiptConflictError
    assert engine.connection.calls[0][0].strip() == "SET LOCAL ROLE phase0_runtime"


@pytest.mark.asyncio
async def test_role_assumption_failure_aborts_before_receipt_sql() -> None:
    draft = _draft()
    engine = _FakeEngine([_row(draft)], fail_on_call=1)
    repository = PostgresObservationReceiptRepository(cast(AsyncEngine, engine))

    with pytest.raises(PermissionError, match="runtime role assumption rejected"):
        await repository.append(draft)

    assert len(engine.connection.calls) == 1
    assert engine.connection.calls[0][0].strip() == "SET LOCAL ROLE phase0_runtime"
    assert engine.transaction.exit_exception_type is PermissionError


@pytest.mark.asyncio
async def test_list_is_bounded_and_orders_newest_first_in_database() -> None:
    older = _draft(idempotency_key="tv-lab-older", sequence=1)
    newer = _draft(idempotency_key="tv-lab-newer", sequence=2)
    engine = _FakeEngine(
        [
            _row(newer, received_at=datetime(2026, 7, 23, 9, 0, tzinfo=UTC)),
            _row(older, received_at=datetime(2026, 7, 23, 8, 0, tzinfo=UTC)),
        ]
    )
    repository = PostgresObservationReceiptRepository(cast(AsyncEngine, engine))

    records = await repository.list(limit=2)

    assert [record.idempotency_key for record in records] == [
        "tv-lab-newer",
        "tv-lab-older",
    ]
    assert len(engine.connection.calls) == 2
    role_statement, role_parameters = engine.connection.calls[0]
    assert role_statement.strip() == "SET LOCAL ROLE phase0_runtime"
    assert role_parameters == {}
    statement, parameters = engine.connection.calls[1]
    assert "phase1a_observation_receipt_projection" in statement
    assert "ORDER BY received_at DESC, receipt_id DESC" in statement
    assert parameters == {"limit": 2}


@pytest.mark.asyncio
@pytest.mark.parametrize("limit", [0, 101, True])
async def test_list_rejects_limits_outside_the_repository_bound(limit: int) -> None:
    engine = _FakeEngine([])
    repository = PostgresObservationReceiptRepository(cast(AsyncEngine, engine))

    with pytest.raises(ValueError, match="limit must be between 1 and 100"):
        await repository.list(limit=limit)

    assert engine.begin_calls == 0
