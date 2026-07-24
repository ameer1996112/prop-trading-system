from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from prop_trading.api.app import create_app


@pytest.mark.asyncio
async def test_health_and_gate_surfaces_are_truthful() -> None:
    app = create_app()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        live = await client.get("/health/live")
        readiness = await client.get("/health/readiness")
        gates = await client.get("/api/v1/phase0/gates")
    assert live.json() == {"status": "ALIVE", "mode": "FOUNDATION_OBSERVATION_ONLY"}
    assert readiness.status_code == 503
    assert readiness.json()["ready"] is False
    assert readiness.json()["status"] == "BLOCKED"
    assert readiness.json()["evaluated_at"].endswith("Z")
    assert readiness.json()["evidence_freshness"]["last_modified_at"].endswith("Z")
    assert readiness.json()["dependencies"]["postgresql"]["status"] == "UNKNOWN"
    assert gates.json()["overall_status"] == "BLOCKED"


def test_api_exposes_only_observation_ingress_and_no_broker_command_routes() -> None:
    paths = {route.path for route in create_app().routes}
    assert paths == {
        "/openapi.json",
        "/docs",
        "/docs/oauth2-redirect",
        "/redoc",
        "/health/live",
        "/health/readiness",
        "/api/v1/phase0/gates",
        "/api/v1/tradingview/observations",
        "/api/v1/observation-receipts",
    }
