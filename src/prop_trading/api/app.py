"""Truthful observation-only API with a fail-closed TradingView LAB ingress."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator, Sequence
from contextlib import asynccontextmanager
from typing import Annotated, Any

from fastapi import FastAPI, Query, Request
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncEngine

from prop_trading.adapters.database import (
    PostgresObservationReceiptRepository,
    create_database_engine,
    dispose_database_engine,
)
from prop_trading.application.observation_ingress import (
    InMemoryObservationReceiptRepository,
    ObservationCredentialRejectedError,
    ObservationIngressDisabledError,
    ObservationIngressService,
    ObservationReceiptConflictError,
    ObservationReceiptRepository,
    ObservationStorageUnavailableError,
)
from prop_trading.application.readiness import ReadinessService
from prop_trading.config import Settings, get_settings
from prop_trading.contracts.models import (
    ObservationReceipt,
    ObservationReceiptList,
    ObservationReceiptStatus,
    TradingViewObservationEnvelope,
)


class ObservationBodyError(ValueError):
    """A bounded, client-safe request body failure."""

    def __init__(self, *, status_code: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message


def _error_response(
    *,
    status_code: int,
    code: str,
    message: str,
    issues: Sequence[dict[str, str]] = (),
) -> JSONResponse:
    error: dict[str, object] = {"code": code, "message": message}
    if issues:
        error["issues"] = list(issues)
    return JSONResponse(status_code=status_code, content={"error": error})


async def _read_bounded_json_body(request: Request, *, max_body_bytes: int) -> bytes:
    content_type = request.headers.get("content-type", "").partition(";")[0].strip().lower()
    if content_type != "application/json":
        raise ObservationBodyError(
            status_code=415,
            code="UNSUPPORTED_MEDIA_TYPE",
            message="Content-Type must be application/json",
        )

    content_length = request.headers.get("content-length")
    if content_length is not None:
        try:
            declared_length = int(content_length)
        except ValueError as exc:
            raise ObservationBodyError(
                status_code=400,
                code="INVALID_CONTENT_LENGTH",
                message="Content-Length must be a non-negative integer",
            ) from exc
        if declared_length < 0:
            raise ObservationBodyError(
                status_code=400,
                code="INVALID_CONTENT_LENGTH",
                message="Content-Length must be a non-negative integer",
            )
        if declared_length > max_body_bytes:
            raise ObservationBodyError(
                status_code=413,
                code="BODY_TOO_LARGE",
                message="Observation body exceeds the configured byte limit",
            )

    chunks: list[bytes] = []
    received = 0
    async for chunk in request.stream():
        received += len(chunk)
        if received > max_body_bytes:
            raise ObservationBodyError(
                status_code=413,
                code="BODY_TOO_LARGE",
                message="Observation body exceeds the configured byte limit",
            )
        chunks.append(chunk)
    if received == 0:
        raise ObservationBodyError(
            status_code=422,
            code="INVALID_OBSERVATION",
            message="Observation body must not be empty",
        )
    return b"".join(chunks)


def _decode_json_object(raw: bytes) -> object:
    def unique_object(pairs: list[tuple[str, object]]) -> dict[str, object]:
        result: dict[str, object] = {}
        for key, value in pairs:
            if key in result:
                raise ValueError("duplicate JSON object key")
            result[key] = value
        return result

    def reject_constant(_value: str) -> None:
        raise ValueError("non-finite JSON number")

    return json.loads(
        raw,
        object_pairs_hook=unique_object,
        parse_constant=reject_constant,
    )


def _validation_issues(exc: ValidationError) -> list[dict[str, str]]:
    return [
        {
            "location": ".".join(str(part) for part in error["loc"]),
            "message": str(error["msg"]),
            "type": str(error["type"]),
        }
        for error in exc.errors(
            include_context=False,
            include_input=False,
            include_url=False,
        )
    ]


def create_app(
    *,
    settings: Settings | None = None,
    receipt_repository: ObservationReceiptRepository | None = None,
) -> FastAPI:
    runtime_settings = settings or get_settings()
    readiness = ReadinessService(runtime_settings.phase0_evidence_path)
    database_engine: AsyncEngine | None = None
    database_required = (
        receipt_repository is None
        and runtime_settings.app_environment == "foundation"
        and runtime_settings.tradingview_observation_ingress_enabled
    )
    if receipt_repository is None and (
        runtime_settings.database_dsn is not None or database_required
    ):
        database_engine = create_database_engine(runtime_settings.migration_database_url())
        receipt_repository = PostgresObservationReceiptRepository(
            database_engine,
            max_list_limit=200,
        )
    elif receipt_repository is None and runtime_settings.app_environment in {"local", "test"}:
        receipt_repository = InMemoryObservationReceiptRepository()
    observation_ingress = ObservationIngressService(
        enabled=runtime_settings.tradingview_observation_ingress_enabled,
        credential_sha256=runtime_settings.tradingview_observation_credential_sha256,
        repository=receipt_repository,
    )

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        try:
            yield
        finally:
            if database_engine is not None:
                await dispose_database_engine(database_engine)

    app = FastAPI(
        title="Prop Trading Observation Lab",
        version="0.2.0",
        description="Observation-only. No broker command surface exists.",
        lifespan=lifespan,
    )

    @app.get("/health/live")
    async def liveness() -> dict[str, str]:
        return {"status": "ALIVE", "mode": runtime_settings.operation_mode}

    @app.get("/health/readiness")
    async def readiness_endpoint() -> JSONResponse:
        body = await readiness.readiness()
        return JSONResponse(status_code=503, content=body)

    @app.get("/api/v1/phase0/gates")
    async def gates_endpoint() -> dict[str, Any]:
        return await readiness.gate_report()

    @app.post(
        "/api/v1/tradingview/observations",
        response_model=ObservationReceipt,
        responses={
            200: {"description": "Identical idempotent replay"},
            202: {"description": "Observation receipt persisted"},
            401: {"description": "Credential rejected"},
            409: {"description": "Conflicting idempotency-key replay"},
            413: {"description": "Body exceeds configured maximum"},
            422: {"description": "Malformed observation"},
            503: {"description": "Ingress disabled or receipt storage unavailable"},
        },
        openapi_extra={
            "requestBody": {
                "required": True,
                "content": {
                    "application/json": {
                        "schema": TradingViewObservationEnvelope.model_json_schema(),
                    }
                },
            }
        },
    )
    async def receive_tradingview_observation(request: Request) -> JSONResponse:
        try:
            observation_ingress.require_enabled()
        except ObservationIngressDisabledError:
            return _error_response(
                status_code=503,
                code="INGRESS_DISABLED",
                message="TradingView observation ingress is disabled",
            )

        try:
            raw = await _read_bounded_json_body(
                request,
                max_body_bytes=runtime_settings.tradingview_observation_max_body_bytes,
            )
        except ObservationBodyError as exc:
            return _error_response(
                status_code=exc.status_code,
                code=exc.code,
                message=exc.message,
            )

        try:
            decoded = _decode_json_object(raw)
            envelope = TradingViewObservationEnvelope.model_validate(decoded)
        except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as exc:
            if isinstance(exc, ValidationError):
                return _error_response(
                    status_code=422,
                    code="INVALID_OBSERVATION",
                    message="Observation envelope failed validation",
                    issues=_validation_issues(exc),
                )
            return _error_response(
                status_code=422,
                code="INVALID_OBSERVATION",
                message="Observation body is not valid JSON",
            )

        try:
            receipt = await observation_ingress.receive(envelope)
        except ObservationCredentialRejectedError:
            return _error_response(
                status_code=401,
                code="INVALID_CREDENTIAL",
                message="Observation credential was rejected",
            )
        except ObservationReceiptConflictError:
            return _error_response(
                status_code=409,
                code="IDEMPOTENCY_CONFLICT",
                message="Idempotency key was already used for different observation content",
            )
        except (ObservationIngressDisabledError, ObservationStorageUnavailableError):
            return _error_response(
                status_code=503,
                code="INGRESS_UNAVAILABLE",
                message="TradingView observation ingress is unavailable",
            )

        status_code = 202 if receipt.status is ObservationReceiptStatus.RECEIVED else 200
        return JSONResponse(
            status_code=status_code,
            content=receipt.model_dump(mode="json"),
        )

    @app.get(
        "/api/v1/observation-receipts",
        response_model=ObservationReceiptList,
        responses={
            503: {"description": "Ingress disabled or receipt storage unavailable"},
        },
    )
    async def list_observation_receipts(
        limit: Annotated[int, Query(ge=1, le=200)] = 50,
    ) -> ObservationReceiptList | JSONResponse:
        try:
            return await observation_ingress.list_receipts(limit=limit)
        except ObservationIngressDisabledError:
            return _error_response(
                status_code=503,
                code="INGRESS_DISABLED",
                message="TradingView observation ingress is disabled",
            )
        except ObservationStorageUnavailableError:
            return _error_response(
                status_code=503,
                code="INGRESS_UNAVAILABLE",
                message="Observation receipt storage is unavailable",
            )

    return app


app = create_app()
