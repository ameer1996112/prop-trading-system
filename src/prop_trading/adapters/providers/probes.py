"""Safe provider probes: evidence collection only, with no command surface."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Protocol

from prop_trading.contracts.models import (
    EvidenceStatus,
    GateId,
    ProviderCapabilityEvidence,
    RequirementEvidence,
)


class CapabilityProbe(Protocol):
    async def inspect(self) -> ProviderCapabilityEvidence:
        """Return capability evidence without changing provider state."""
        ...


class BlockedCapabilityProbe:
    """Default probe used until a credentialed, reviewer-approved spike exists."""

    def __init__(
        self,
        *,
        evidence_id: str,
        gate_id: GateId,
        provider: str,
        requirements: Sequence[str],
        official_sources: Sequence[str] = (),
    ) -> None:
        self._evidence_id = evidence_id
        self._gate_id = gate_id
        self._provider = provider
        self._requirements = tuple(requirements)
        self._official_sources = list(official_sources)

    async def inspect(self) -> ProviderCapabilityEvidence:
        return ProviderCapabilityEvidence(
            schema_id="phase0.provider-capability.v1",
            evidence_id=self._evidence_id,
            gate_id=self._gate_id,
            provider=self._provider,
            capability_version="1.0.0",
            status=EvidenceStatus.UNVERIFIED,
            observed_at=None,
            official_sources=self._official_sources,
            requirements=[
                RequirementEvidence(
                    requirement=requirement,
                    satisfied=False,
                    source="credential-free Phase 0 build",
                    note="requires an approved external capability spike",
                )
                for requirement in self._requirements
            ],
            details={"network_called": False, "state_changed": False},
            artifact_sha256=None,
        )
