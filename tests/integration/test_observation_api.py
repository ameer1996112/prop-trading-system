from __future__ import annotations

import asyncio
import hashlib
import importlib
from copy import deepcopy

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from prop_trading.api.app import create_app
from prop_trading.application.observation_ingress import (
    InMemoryObservationReceiptRepository,
)
from prop_trading.config import Settings

_AUTH_VALUE = "tv-lab-value"


def _payload() -> dict[str, object]:
    return {
        "schema_version": "1.0",
        "strategy_id": "rd_liquidity_sd_5m_v1",
        "strategy_version": "1.0.0-phase1",
        "producer_instance_id": "pine-lab-01",
        "sequence": 1,
        "idempotency_key": "pine-lab-01:1",
        "symbol": "XAUUSD",
        "ticker_id": "OANDA:XAUUSD",
        "feed": "OANDA",
        "timeframe": "5",
        "timezone": "Etc/UTC",
        "bar_open_epoch": 1_710_000_000_000,
        "bar_close_epoch": 1_710_000_300_000,
        "detector_code_hash": "a" * 64,
        "settings_hash": "b" * 64,
        "kind": "incremental",
        "chunk_index": 0,
        "chunk_count": 1,
        "transitions": [
            {
                "transition_index": 0,
                "natural_key": {
                    "side": "DEMAND",
                    "zone_key": "demand|1710000000000",
                    "liquidity_key": "swing-low|1709999700000",
                    "formation_bar_close_epoch": 1_710_000_000_000,
                },
                "from_state": None,
                "to_state": "WAITING_FOR_ELIGIBILITY",
                "reason_code": "WAIT_SETUP_ELIGIBILITY",
                "zone": {
                    "top": 2150.25,
                    "bottom": 2149.75,
                    "origin_bar_open_epoch": 1_709_999_700_000,
                    "origin_bar_close_epoch": 1_710_000_000_000,
                },
                "liquidity": {
                    "price": 2149.50,
                    "origin_bar_open_epoch": 1_709_999_700_000,
                    "origin_bar_close_epoch": 1_710_000_000_000,
                },
                "source_candle": {
                    "open_epoch": 1_710_000_000_000,
                    "close_epoch": 1_710_000_300_000,
                    "open": 2150.00,
                    "high": 2151.00,
                    "low": 2149.50,
                    "close": 2150.50,
                },
            }
        ],
    }


def _settings(
    *,
    enabled: bool = True,
    environment: str = "test",
    max_body_bytes: int = 262_144,
) -> Settings:
    return Settings(
        app_environment=environment,
        tradingview_observation_ingress_enabled=enabled,
        tradingview_observation_credential_sha256=hashlib.sha256(
            _AUTH_VALUE.encode("utf-8")
        ).hexdigest(),
        tradingview_observation_max_body_bytes=max_body_bytes,
    )


def _app(
    *,
    settings: Settings | None = None,
    repository: InMemoryObservationReceiptRepository | None = None,
) -> FastAPI:
    return create_app(
        settings=settings or _settings(),
        receipt_repository=repository or InMemoryObservationReceiptRepository(),
    )


@pytest.mark.asyncio
async def test_new_duplicate_conflict_and_list_receipt_semantics() -> None:
    app = _app()
    envelope = {"credential": _AUTH_VALUE, "payload": _payload()}
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        inserted = await client.post("/api/v1/tradingview/observations", json=envelope)
        duplicate = await client.post("/api/v1/tradingview/observations", json=envelope)
        conflicting_envelope = deepcopy(envelope)
        conflicting_payload = conflicting_envelope["payload"]
        assert isinstance(conflicting_payload, dict)
        conflicting_payload["settings_hash"] = "c" * 64
        conflict = await client.post(
            "/api/v1/tradingview/observations",
            json=conflicting_envelope,
        )
        listed = await client.get("/api/v1/observation-receipts?limit=50")

    assert inserted.status_code == 202
    assert inserted.json()["status"] == "RECEIVED"
    assert inserted.json()["received_at"].endswith("Z")
    assert len(inserted.json()["payload_sha256"]) == 64
    assert duplicate.status_code == 200
    assert duplicate.json()["status"] == "DUPLICATE"
    assert duplicate.json()["receipt_id"] == inserted.json()["receipt_id"]
    assert conflict.status_code == 409
    assert conflict.json()["error"]["code"] == "IDEMPOTENCY_CONFLICT"
    assert listed.status_code == 200
    assert listed.json()["mode"] == "OBSERVATION_ONLY"
    assert listed.json()["ingress_enabled"] is True
    assert listed.json()["count"] == 1
    assert listed.json()["items"][0]["status"] == "RECEIVED"
    assert "credential" not in listed.text.lower()


@pytest.mark.asyncio
async def test_bad_credential_is_constant_shape_and_never_echoed() -> None:
    rejected_value = "never-echo-this"
    app = _app()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post(
            "/api/v1/tradingview/observations",
            json={"credential": rejected_value, "payload": _payload()},
        )

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "INVALID_CREDENTIAL"
    assert rejected_value not in response.text


@pytest.mark.asyncio
async def test_disabled_ingress_fails_closed_before_body_parsing_and_blocks_list() -> None:
    app = _app(settings=_settings(enabled=False))
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        posted = await client.post(
            "/api/v1/tradingview/observations",
            content=b"not-json",
            headers={"content-type": "application/json"},
        )
        listed = await client.get("/api/v1/observation-receipts")

    assert posted.status_code == 503
    assert posted.json()["error"]["code"] == "INGRESS_DISABLED"
    assert listed.status_code == 503
    assert listed.json()["error"]["code"] == "INGRESS_DISABLED"


def test_enabled_foundation_requires_database_configuration() -> None:
    settings = _settings(environment="foundation")
    settings.database_dsn = None
    settings.database_host = None
    settings.database_password_file = None
    with pytest.raises(RuntimeError, match="PTS_DATABASE_DSN"):
        create_app(settings=settings, receipt_repository=None)


def test_enabled_foundation_wires_postgres_repository(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    app_module = importlib.import_module("prop_trading.api.app")
    repository = InMemoryObservationReceiptRepository()
    engine = object()
    calls: list[tuple[object, int]] = []
    monkeypatch.setattr(app_module, "create_database_engine", lambda _dsn: engine)

    def repository_factory(
        given_engine: object,
        *,
        max_list_limit: int,
    ) -> InMemoryObservationReceiptRepository:
        calls.append((given_engine, max_list_limit))
        return repository

    monkeypatch.setattr(
        app_module,
        "PostgresObservationReceiptRepository",
        repository_factory,
    )
    settings = _settings(environment="foundation")
    settings.database_dsn = "postgresql+asyncpg://runtime@postgres/prop_trading"
    created = create_app(settings=settings)

    assert isinstance(created, FastAPI)
    assert calls == [(engine, 200)]


@pytest.mark.asyncio
async def test_body_is_bounded_before_json_validation() -> None:
    oversized_value = "value-that-must-not-leak-" + ("x" * 2_000)
    app = _app(settings=_settings(max_body_bytes=1024))
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post(
            "/api/v1/tradingview/observations",
            json={"credential": oversized_value, "payload": _payload()},
        )

    assert response.status_code == 413
    assert response.json()["error"]["code"] == "BODY_TOO_LARGE"
    assert oversized_value not in response.text


@pytest.mark.asyncio
async def test_malformed_and_corrupt_payload_errors_are_sanitized() -> None:
    app = _app()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        malformed = await client.post(
            "/api/v1/tradingview/observations",
            content=b'{"credential":',
            headers={"content-type": "application/json"},
        )
        corrupt_payload = _payload()
        corrupt_payload["producer_instance_id"] = "pine\\corrupt"
        corrupt_payload["idempotency_key"] = "pine\\corrupt:1"
        corrupt = await client.post(
            "/api/v1/tradingview/observations",
            json={"credential": _AUTH_VALUE, "payload": corrupt_payload},
        )

    assert malformed.status_code == 422
    assert malformed.json()["error"]["code"] == "INVALID_OBSERVATION"
    assert corrupt.status_code == 422
    assert corrupt.json()["error"]["code"] == "INVALID_OBSERVATION"
    assert _AUTH_VALUE not in corrupt.text
    assert "pine\\corrupt" not in corrupt.text


@pytest.mark.asyncio
async def test_atomic_in_memory_idempotency_under_concurrent_delivery() -> None:
    app = _app()
    envelope = {"credential": _AUTH_VALUE, "payload": _payload()}
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        responses = await asyncio.gather(
            *[client.post("/api/v1/tradingview/observations", json=envelope) for _ in range(8)]
        )
        listed = await client.get("/api/v1/observation-receipts")

    assert [response.status_code for response in responses].count(202) == 1
    assert [response.status_code for response in responses].count(200) == 7
    assert listed.json()["count"] == 1
