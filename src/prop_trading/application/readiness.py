"""Truthful Phase 0 health/readiness projection."""

from __future__ import annotations

import asyncio
import json
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from prop_trading.application.gates import evaluate_phase0
from prop_trading.contracts.models import EvidenceStatus, Phase0EvidenceRegistry
from prop_trading.domain.canonical import (
    CanonicalizationError,
    canonical_json_bytes,
    parse_canonical_json,
)


class ReadinessService:
    """Read local evidence asynchronously and project fail-closed readiness."""

    def __init__(
        self,
        evidence_path: Path,
        *,
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        self._evidence_path = evidence_path
        self._clock = clock or (lambda: datetime.now(UTC))

    async def gate_report(self) -> dict[str, Any]:
        registry = await asyncio.to_thread(self._load_registry)
        return evaluate_phase0(registry).model_dump(mode="json")

    async def readiness(self) -> dict[str, Any]:
        evaluated = self._clock().astimezone(UTC)
        evaluated_at = evaluated.isoformat().replace("+00:00", "Z")
        try:
            report = await self.gate_report()
            modified_at = await asyncio.to_thread(self._evidence_modified_at)
        except (OSError, CanonicalizationError, ValidationError, json.JSONDecodeError) as exc:
            return {
                "ready": False,
                "status": "DEGRADED",
                "mode": "FOUNDATION_OBSERVATION_ONLY",
                "evaluated_at": evaluated_at,
                "evidence_freshness": {
                    "last_modified_at": None,
                    "age_seconds": None,
                    "status": "UNKNOWN",
                },
                "dependencies": {
                    "phase0_evidence": {"status": "DEGRADED", "reason": type(exc).__name__},
                    "postgresql": {"status": "UNKNOWN", "reason": "not probed by Phase 0 API"},
                },
                "blocker_count": None,
            }
        blockers = [gate for gate in report["gates"] if gate["status"] != EvidenceStatus.VERIFIED]
        age_seconds = max(0, int((evaluated - modified_at).total_seconds()))
        return {
            "ready": False,
            "status": "BLOCKED" if blockers else "DEGRADED",
            "mode": "FOUNDATION_OBSERVATION_ONLY",
            "evaluated_at": evaluated_at,
            "evidence_freshness": {
                "last_modified_at": modified_at.isoformat().replace("+00:00", "Z"),
                "age_seconds": age_seconds,
                "status": "OBSERVED",
            },
            "dependencies": {
                "phase0_evidence": {"status": "BLOCKED" if blockers else "VERIFIED"},
                "postgresql": {"status": "UNKNOWN", "reason": "not configured/probed"},
                "external_providers": {"status": "BLOCKED" if blockers else "UNKNOWN"},
            },
            "blocker_count": len(blockers),
        }

    def _load_registry(self) -> Phase0EvidenceRegistry:
        raw = self._evidence_path.read_bytes()
        parsed = parse_canonical_json(raw)
        return Phase0EvidenceRegistry.model_validate_json(canonical_json_bytes(parsed))

    def _evidence_modified_at(self) -> datetime:
        return datetime.fromtimestamp(self._evidence_path.stat().st_mtime, tz=UTC)
