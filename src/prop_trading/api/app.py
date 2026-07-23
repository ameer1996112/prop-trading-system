"""Minimal truthful Phase 0 API."""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI
from fastapi.responses import JSONResponse

from prop_trading.application.readiness import ReadinessService
from prop_trading.config import get_settings


def create_app() -> FastAPI:
    settings = get_settings()
    readiness = ReadinessService(settings.phase0_evidence_path)
    app = FastAPI(
        title="Prop Trading Phase 0 Foundation",
        version="0.1.0",
        description="Observation-only. No broker command surface exists.",
    )

    @app.get("/health/live")
    async def liveness() -> dict[str, str]:
        return {"status": "ALIVE", "mode": settings.operation_mode}

    @app.get("/health/readiness")
    async def readiness_endpoint() -> JSONResponse:
        body = await readiness.readiness()
        return JSONResponse(status_code=503, content=body)

    @app.get("/api/v1/phase0/gates")
    async def gates_endpoint() -> dict[str, Any]:
        return await readiness.gate_report()

    return app


app = create_app()
