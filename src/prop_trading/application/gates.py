"""Deterministic fail-closed Phase 0 gate evaluation."""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Literal, Protocol

from prop_trading.contracts.models import (
    EvidenceStatus,
    GateId,
    GateResult,
    Phase0EvidenceRegistry,
    Phase0GateReport,
    ProviderCapabilityEvidence,
)
from prop_trading.domain.canonical import canonical_sha256

DetailPredicate = Callable[[dict[str, str | int | bool | None]], bool]


@dataclass(frozen=True, slots=True)
class GateDefinition:
    required: frozenset[str]
    detail_predicate: DetailPredicate | None = None
    detail_failure: str | None = None


@dataclass(frozen=True, slots=True)
class TrustedVerification:
    """Output of future trusted code, never editable registry input.

    A verifier must safely resolve and re-hash a gate-specific artifact and validate an
    approval signature against a configured trust root before setting every field true.
    Phase 0 intentionally configures no verifier or trust root.
    """

    artifact_resolved_and_rehashed: bool
    artifact_hash_matches_claim: bool
    approval_signature_verified: bool
    trust_root_id: str | None
    reason: str

    @property
    def accepted(self) -> bool:
        return (
            self.artifact_resolved_and_rehashed
            and self.artifact_hash_matches_claim
            and self.approval_signature_verified
            and self.trust_root_id is not None
        )


class GateVerifier(Protocol):
    """Extension seam for a code-reviewed, gate-specific verifier."""

    def verify(self, record: ProviderCapabilityEvidence) -> TrustedVerification: ...


def _detail_equals(key: str, expected: str | int | bool) -> DetailPredicate:
    return lambda details: details.get(key) == expected


def _cursor_details_are_safe(details: dict[str, str | int | bool | None]) -> bool:
    return (
        details.get("timestamp_or_repeated_poll_used") is False
        and details.get("generic_synchronized_flag_accepted") is False
    )


GATE_DEFINITIONS: dict[GateId, GateDefinition] = {
    GateId.OPTIMIZER_1_INPUTS: GateDefinition(
        frozenset(
            {
                "complete_input_set",
                "operator_supplied",
                "settings_hash_reproduced",
                "feed_context_recorded",
            }
        )
    ),
    GateId.TRADINGVIEW_ALERT_CONFIGURATION: GateDefinition(
        frozenset(
            {
                "redacted_destination_captured",
                "message_structure_captured",
                "dedicated_canonical_instance",
                "diagnostics_disabled",
                "manifest_binding",
                "alert_recreation_record",
            }
        )
    ),
    GateId.COMMITTED_CLEAN_PINE_PROVENANCE: GateDefinition(
        frozenset(
            {
                "source_commit_recorded",
                "working_content_matches_head",
                "working_tree_clean_for_source",
                "detector_hash_reproduced",
            }
        )
    ),
    GateId.MANAGED_SECRET_WORKLOAD_IDENTITY: GateDefinition(
        frozenset(
            {
                "kms_encryption",
                "secret_versioning",
                "rotation_proven",
                "audit_export_proven",
                "backup_restore_proven",
                "scoped_workload_identity",
                "per_account_scope",
                "revocation_drill",
                "integration_spike",
            }
        )
    ),
    GateId.OIDC_MFA: GateDefinition(
        frozenset(
            {
                "jwt_validation",
                "server_side_roles",
                "mfa_challenge_verify",
                "fresh_challenge_evidence",
                "single_use_action_grant",
                "revocation_behavior",
                "integration_spike",
            }
        )
    ),
    GateId.TELEMETRY: GateDefinition(
        frozenset(
            {
                "otlp_metrics_logs_traces",
                "metrics_retention_13_months",
                "logs_traces_retention_90_days",
                "bounded_label_enforcement",
                "gate_query_export_restore",
                "export_failure_drill",
                "integration_spike",
            }
        )
    ),
    GateId.INDEPENDENT_DEAD_MAN: GateDefinition(
        frozenset(
            {
                "independent_failure_domain",
                "missed_interval_detection",
                "owned_acknowledgement",
                "five_and_fifteen_minute_escalation",
                "surviving_channel_drill",
                "integration_spike",
            }
        )
    ),
    GateId.TRANSACTIONAL_EMAIL: GateDefinition(
        frozenset(
            {
                "delivery_events",
                "signed_webhook_verification",
                "idempotent_delivery_evidence",
                "critical_delivery_under_60_seconds",
                "channel_failure_drill",
                "integration_spike",
            }
        )
    ),
    GateId.METAAPI_DEMO_ONLY_TENANT: GateDefinition(
        frozenset(
            {
                "separate_tenant_identity",
                "demo_provisioning_only",
                "arbitrary_import_disabled",
                "no_live_accounts_or_credentials",
                "per_account_credential_isolation",
                "retail_hedging_only",
                "tenant_inspection_spike",
            }
        )
    ),
    GateId.METAAPI_COMMON_CURSOR_BARRIER: GateDefinition(
        frozenset(
            {
                "synchronization_generation",
                "common_start_cursor",
                "snapshot_page_completion",
                "buffered_concurrent_updates",
                "common_end_cursor",
                "gapless_fold_through_end",
                "history_watermark_coverage",
                "tier0_remote_durability",
                "concurrency_spike",
            }
        ),
        detail_predicate=_cursor_details_are_safe,
        detail_failure=(
            "timestamp/repeated-poll and generic synchronized flags must both be explicitly false"
        ),
    ),
    GateId.LICENSED_TICK_SOURCE: GateDefinition(
        frozenset(
            {
                "current_license_review",
                "internal_capture_allowed",
                "retention_allowed",
                "replay_allowed",
                "derived_statistics_allowed",
                "redistribution_forbidden",
                "legal_approval_recorded",
            }
        )
    ),
    GateId.SEQUENCE_COMPLETE_TICKS: GateDefinition(
        frozenset(
            {
                "upstream_quote_sequence_contract",
                "packet_loss_detection",
                "contiguous_sequence_proof",
                "reconnect_backfill_proof",
                "connection_coverage",
                "clock_tolerance",
                "checksum_verification",
                "capability_spike",
            }
        ),
        detail_predicate=_detail_equals("classification", "SEQUENCE_COMPLETE"),
        detail_failure="source is not proven SEQUENCE_COMPLETE",
    ),
    GateId.FIVE_DAY_TICK_PILOT: GateDefinition(
        frozenset(
            {
                "five_consecutive_trading_days",
                "rollover_included",
                "gap_disconnect_fixture",
                "alignment_proven",
                "checksum_gap_detection",
                "encrypted_retention",
                "restore_proven",
                "licensing_review_linked",
            }
        ),
        detail_predicate=_detail_equals("consecutive_trading_days", 5),
        detail_failure="pilot does not contain exactly the required five-day proof window",
    ),
}


def _evaluate_one(
    gate_id: GateId,
    records: list[ProviderCapabilityEvidence],
    verifier: GateVerifier | None,
) -> GateResult:
    definition = GATE_DEFINITIONS[gate_id]
    if len(records) != 1:
        reason = "evidence is absent" if not records else "multiple evidence records are ambiguous"
        return GateResult(
            gate_id=gate_id,
            status=EvidenceStatus.BLOCKED,
            evidence_id=None,
            missing_requirements=sorted(definition.required),
            reason=reason,
        )

    record = records[0]
    checks = {item.requirement: item.satisfied for item in record.requirements}
    missing = sorted(name for name in definition.required if checks.get(name) is not True)
    unexpected = sorted(set(checks) - set(definition.required))
    detail_ok = definition.detail_predicate is None or definition.detail_predicate(record.details)
    trusted = (
        verifier.verify(record)
        if verifier is not None
        and record.status is EvidenceStatus.VERIFIED
        and not missing
        and not unexpected
        and detail_ok
        else None
    )
    is_verified = (
        record.status is EvidenceStatus.VERIFIED
        and not missing
        and not unexpected
        and detail_ok
        and trusted is not None
        and trusted.accepted
    )
    if is_verified and trusted is not None:
        return GateResult(
            gate_id=gate_id,
            status=EvidenceStatus.VERIFIED,
            evidence_id=record.evidence_id,
            missing_requirements=[],
            reason=(
                "gate-specific artifact was re-hashed and its approval signature verified by "
                f"trust root {trusted.trust_root_id}"
            ),
        )

    reasons: list[str] = []
    if record.status is not EvidenceStatus.VERIFIED:
        reasons.append(f"evidence status is {record.status.value}")
    if missing:
        reasons.append("required proof is missing or unsatisfied")
    if unexpected:
        reasons.append("unexpected requirement names are not accepted")
    if not detail_ok and definition.detail_failure is not None:
        reasons.append(definition.detail_failure)
    if record.status is EvidenceStatus.VERIFIED:
        if verifier is None:
            reasons.append(
                "unsupported/untrusted verification: no gate-specific verifier or trust root is "
                "configured"
            )
        elif trusted is None:
            reasons.append(
                "unsupported/untrusted verification: gate-specific verifier was not invoked "
                "because local contract checks failed"
            )
        elif not trusted.accepted:
            reasons.append(f"unsupported/untrusted verification: {trusted.reason}")
    return GateResult(
        gate_id=gate_id,
        status=EvidenceStatus.BLOCKED,
        evidence_id=record.evidence_id,
        missing_requirements=missing,
        reason="; ".join(reasons),
    )


def evaluate_phase0(
    registry: Phase0EvidenceRegistry,
    *,
    verifiers: Mapping[GateId, GateVerifier] | None = None,
) -> Phase0GateReport:
    """Evaluate every frozen Phase 0 gate without time-, health-, or poll-based shortcuts."""
    by_gate: dict[GateId, list[ProviderCapabilityEvidence]] = {
        gate_id: [] for gate_id in GATE_DEFINITIONS
    }
    for record in registry.evidence:
        by_gate[record.gate_id].append(record)
    active_verifiers = verifiers or {}
    results = [
        _evaluate_one(gate_id, by_gate[gate_id], active_verifiers.get(gate_id))
        for gate_id in GATE_DEFINITIONS
    ]
    overall: Literal[EvidenceStatus.VERIFIED, EvidenceStatus.BLOCKED] = (
        EvidenceStatus.VERIFIED
        if all(item.status is EvidenceStatus.VERIFIED for item in results)
        else EvidenceStatus.BLOCKED
    )
    dumped = registry.model_dump(mode="json")
    return Phase0GateReport(
        schema_id="phase0.gate-report.v1",
        release_id=registry.release_id,
        input_sha256=canonical_sha256(dumped),
        overall_status=overall,
        gates=results,
    )
