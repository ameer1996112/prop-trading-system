"""Build the deterministic, explicitly blocked Phase 0 evidence registry."""

from __future__ import annotations

import argparse
from collections.abc import Sequence
from pathlib import Path

from prop_trading.application.gates import GATE_DEFINITIONS
from prop_trading.contracts.models import (
    EvidenceStatus,
    GateId,
    Phase0EvidenceRegistry,
    ProviderCapabilityEvidence,
    RequirementEvidence,
)
from prop_trading.domain.canonical import canonical_json_bytes

OFFICIAL_SOURCES: dict[GateId, list[str]] = {
    GateId.MANAGED_SECRET_WORKLOAD_IDENTITY: [
        "https://docs.aws.amazon.com/secretsmanager/latest/userguide/whats-in-a-secret.html",
        "https://docs.aws.amazon.com/secretsmanager/latest/userguide/monitoring-cloudtrail.html",
        "https://docs.aws.amazon.com/secretsmanager/latest/userguide/replicate-secrets.html",
        "https://docs.aws.amazon.com/rolesanywhere/latest/userguide/getting-started.html",
    ],
    GateId.OIDC_MFA: ["https://supabase.com/docs/guides/auth/auth-mfa"],
    GateId.TELEMETRY: [
        "https://grafana.com/docs/grafana-cloud/send-data/",
        "https://grafana.com/docs/grafana-cloud/send-data/otlp/otlp-format-considerations/",
    ],
    GateId.INDEPENDENT_DEAD_MAN: [
        "https://betterstack.com/docs/uptime/cron-and-heartbeat-monitor/",
        "https://betterstack.com/docs/uptime/escalation-policies/",
    ],
    GateId.TRANSACTIONAL_EMAIL: [
        "https://resend.com/docs/webhooks/introduction",
        "https://resend.com/docs/webhooks/event-types",
    ],
    GateId.METAAPI_DEMO_ONLY_TENANT: [
        "https://metaapi.cloud/docs/provisioning/",
    ],
    GateId.METAAPI_COMMON_CURSOR_BARRIER: [
        "https://metaapi.cloud/docs/client/websocket/synchronizing/synchronizationStarted/",
        "https://metaapi.cloud/docs/client/websocket/synchronizing/update/",
        "https://metaapi.cloud/docs/client/websocket/usingStreamingApi/",
    ],
    GateId.LICENSED_TICK_SOURCE: [
        "https://metaapi.cloud/docs/client/websocket/marketDataStreaming/prices/",
    ],
    GateId.SEQUENCE_COMPLETE_TICKS: [
        "https://metaapi.cloud/docs/client/websocket/marketDataStreaming/prices/",
        "https://metaapi.cloud/docs/client/websocket/synchronizing/synchronizationStarted/",
    ],
}

PROVIDERS: dict[GateId, str] = {
    GateId.OPTIMIZER_1_INPUTS: "Operator-supplied TradingView configuration",
    GateId.TRADINGVIEW_ALERT_CONFIGURATION: "Operator-supplied TradingView alert",
    GateId.COMMITTED_CLEAN_PINE_PROVENANCE: "Legacy Git evidence",
    GateId.MANAGED_SECRET_WORKLOAD_IDENTITY: "AWS Secrets Manager + IAM Roles Anywhere candidate",
    GateId.OIDC_MFA: "Supabase Auth candidate",
    GateId.TELEMETRY: "Grafana Cloud candidate",
    GateId.INDEPENDENT_DEAD_MAN: "Better Stack candidate",
    GateId.TRANSACTIONAL_EMAIL: "Resend candidate",
    GateId.METAAPI_DEMO_ONLY_TENANT: "MetaApi",
    GateId.METAAPI_COMMON_CURSOR_BARRIER: "MetaApi",
    GateId.LICENSED_TICK_SOURCE: "MetaApi realtime stream candidate",
    GateId.SEQUENCE_COMPLETE_TICKS: "MetaApi realtime stream candidate",
    GateId.FIVE_DAY_TICK_PILOT: "No collector deployment",
}

STATUS: dict[GateId, EvidenceStatus] = {
    GateId.OPTIMIZER_1_INPUTS: EvidenceStatus.BLOCKED,
    GateId.TRADINGVIEW_ALERT_CONFIGURATION: EvidenceStatus.BLOCKED,
    GateId.COMMITTED_CLEAN_PINE_PROVENANCE: EvidenceStatus.BLOCKED,
    GateId.MANAGED_SECRET_WORKLOAD_IDENTITY: EvidenceStatus.UNVERIFIED,
    GateId.OIDC_MFA: EvidenceStatus.UNVERIFIED,
    GateId.TELEMETRY: EvidenceStatus.UNVERIFIED,
    GateId.INDEPENDENT_DEAD_MAN: EvidenceStatus.UNVERIFIED,
    GateId.TRANSACTIONAL_EMAIL: EvidenceStatus.UNVERIFIED,
    GateId.METAAPI_DEMO_ONLY_TENANT: EvidenceStatus.BLOCKED,
    GateId.METAAPI_COMMON_CURSOR_BARRIER: EvidenceStatus.UNVERIFIED,
    GateId.LICENSED_TICK_SOURCE: EvidenceStatus.UNVERIFIED,
    GateId.SEQUENCE_COMPLETE_TICKS: EvidenceStatus.UNVERIFIED,
    GateId.FIVE_DAY_TICK_PILOT: EvidenceStatus.BLOCKED,
}


def _details(gate_id: GateId) -> dict[str, str | int | bool | None]:
    if gate_id is GateId.OPTIMIZER_1_INPUTS:
        return {"template": "config/templates/optimizer-1.example.json", "operator_artifact": None}
    if gate_id is GateId.TRADINGVIEW_ALERT_CONFIGURATION:
        return {
            "template": "config/templates/tradingview-alert.example.json",
            "operator_artifact": None,
        }
    if gate_id is GateId.COMMITTED_CLEAN_PINE_PROVENANCE:
        return {
            "inventory": "evidence/inventory.json",
            "working_tree_status": "MODIFIED",
            "content_matches_head": False,
        }
    if gate_id is GateId.METAAPI_COMMON_CURSOR_BARRIER:
        return {
            "timestamp_or_repeated_poll_used": False,
            "generic_synchronized_flag_accepted": False,
            "credentialed_spike": False,
        }
    if gate_id is GateId.SEQUENCE_COMPLETE_TICKS:
        return {"classification": "UNVERIFIED", "credentialed_spike": False}
    if gate_id is GateId.FIVE_DAY_TICK_PILOT:
        return {"consecutive_trading_days": 0, "collector_deployed": False}
    return {"credentialed_spike": False, "provider_state_mutated": False}


def build_registry() -> Phase0EvidenceRegistry:
    records: list[ProviderCapabilityEvidence] = []
    for gate_id, definition in GATE_DEFINITIONS.items():
        records.append(
            ProviderCapabilityEvidence(
                schema_id="phase0.provider-capability.v1",
                evidence_id=f"phase0-{gate_id.value}-unverified",
                gate_id=gate_id,
                provider=PROVIDERS[gate_id],
                capability_version="1.0.0",
                status=STATUS[gate_id],
                observed_at=("2026-07-22T00:00:00Z" if OFFICIAL_SOURCES.get(gate_id) else None),
                official_sources=OFFICIAL_SOURCES.get(gate_id, []),
                requirements=[
                    RequirementEvidence(
                        requirement=requirement,
                        satisfied=False,
                        source="Phase 0 build evidence",
                        note=(
                            "No qualifying operator artifact, provisioned service, or approved "
                            "spike exists."
                        ),
                    )
                    for requirement in sorted(definition.required)
                ],
                details=_details(gate_id),
                artifact_sha256=None,
            )
        )
    return Phase0EvidenceRegistry(
        schema_id="phase0.evidence-registry.v1",
        release_id="phase0-foundation-0.1.0",
        evidence=records,
    )


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args(argv)
    rendered = canonical_json_bytes(build_registry().model_dump(mode="json")) + b"\n"
    if args.check:
        if not args.output.exists() or args.output.read_bytes() != rendered:
            raise SystemExit(f"evidence registry is stale: {args.output}")
    else:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_bytes(rendered)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
