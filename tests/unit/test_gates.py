from __future__ import annotations

import json
from pathlib import Path

from prop_trading.application.gates import evaluate_phase0
from prop_trading.contracts.models import (
    EvidenceStatus,
    GateId,
    Phase0EvidenceRegistry,
)


def _registry() -> Phase0EvidenceRegistry:
    return Phase0EvidenceRegistry.model_validate_json(
        Path("evidence/phase0/evidence-registry.json").read_bytes()
    )


def test_absent_external_evidence_fails_every_gate_closed() -> None:
    report = evaluate_phase0(_registry())
    assert report.overall_status is EvidenceStatus.BLOCKED
    assert len(report.gates) == 13
    assert all(gate.status is EvidenceStatus.BLOCKED for gate in report.gates)
    assert all(gate.reason for gate in report.gates)


def _claimed_verified_payload() -> dict[str, object]:
    payload = json.loads(Path("evidence/phase0/evidence-registry.json").read_text())
    assert isinstance(payload, dict)
    records = payload["evidence"]
    assert isinstance(records, list)
    for record in records:
        record["status"] = "VERIFIED"
        record["observed_at"] = "2026-07-22T00:00:00Z"
        record["artifact_sha256"] = "a" * 64
        record["official_sources"] = ["https://attacker.invalid/fake-proof"]
        for requirement in record["requirements"]:
            requirement["satisfied"] = True
        if record["gate_id"] == "sequence_complete_ticks":
            record["details"]["classification"] = "SEQUENCE_COMPLETE"
        if record["gate_id"] == "five_day_tick_pilot":
            record["details"]["consecutive_trading_days"] = 5
    return payload


def _cursor_gate(payload: dict[str, object]) -> dict[str, object]:
    records = payload["evidence"]
    assert isinstance(records, list)
    return next(item for item in records if item["gate_id"] == "metaapi_common_cursor_barrier")


def test_self_attested_verified_records_cannot_satisfy_any_gate() -> None:
    registry = Phase0EvidenceRegistry.model_validate_json(json.dumps(_claimed_verified_payload()))
    report = evaluate_phase0(registry)
    assert len(report.gates) == 13
    assert len({gate.gate_id for gate in report.gates}) == 13
    assert report.overall_status is EvidenceStatus.BLOCKED
    assert all(gate.status is EvidenceStatus.BLOCKED for gate in report.gates)
    assert all("unsupported/untrusted verification" in gate.reason for gate in report.gates)


def test_repeated_poll_or_timestamp_cannot_satisfy_cursor_barrier_gate() -> None:
    payload = _claimed_verified_payload()
    _cursor_gate(payload)["details"]["timestamp_or_repeated_poll_used"] = True
    registry = Phase0EvidenceRegistry.model_validate_json(json.dumps(payload))
    report = evaluate_phase0(registry)
    gate = next(
        item for item in report.gates if item.gate_id is GateId.METAAPI_COMMON_CURSOR_BARRIER
    )
    assert gate.status is EvidenceStatus.BLOCKED
    assert "explicitly false" in gate.reason


def test_generic_synchronized_flag_cannot_satisfy_cursor_barrier_gate() -> None:
    payload = _claimed_verified_payload()
    _cursor_gate(payload)["details"]["generic_synchronized_flag_accepted"] = True
    report = evaluate_phase0(Phase0EvidenceRegistry.model_validate_json(json.dumps(payload)))
    gate = next(
        item for item in report.gates if item.gate_id is GateId.METAAPI_COMMON_CURSOR_BARRIER
    )
    assert gate.status is EvidenceStatus.BLOCKED
    assert "explicitly false" in gate.reason


def test_missing_forbidden_cursor_detail_is_unknown_and_fails_closed() -> None:
    payload = _claimed_verified_payload()
    details = _cursor_gate(payload)["details"]
    assert isinstance(details, dict)
    del details["generic_synchronized_flag_accepted"]
    report = evaluate_phase0(Phase0EvidenceRegistry.model_validate_json(json.dumps(payload)))
    gate = next(
        item for item in report.gates if item.gate_id is GateId.METAAPI_COMMON_CURSOR_BARRIER
    )
    assert gate.status is EvidenceStatus.BLOCKED
    assert "explicitly false" in gate.reason


def test_healthy_connection_without_sequence_classification_cannot_pass_tick_gate() -> None:
    report = evaluate_phase0(_registry())
    gate = next(item for item in report.gates if item.gate_id is GateId.SEQUENCE_COMPLETE_TICKS)
    assert gate.status is EvidenceStatus.BLOCKED
    assert "source is not proven" in gate.reason
