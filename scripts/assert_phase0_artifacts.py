"""Assert generated Phase 0 gate artifacts contain the exact blocked gate set."""

from __future__ import annotations

import argparse
from collections.abc import Sequence
from pathlib import Path

from prop_trading.contracts.models import (
    EvidenceStatus,
    GateId,
    Phase0EvidenceRegistry,
    Phase0GateReport,
)


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--registry", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args(argv)
    registry = Phase0EvidenceRegistry.model_validate_json(args.registry.read_bytes())
    report = Phase0GateReport.model_validate_json(args.report.read_bytes())
    expected = set(GateId)
    registry_gates = [item.gate_id for item in registry.evidence]
    report_gates = [item.gate_id for item in report.gates]
    if len(registry_gates) != 13 or set(registry_gates) != expected:
        raise SystemExit("evidence registry does not contain exactly 13 unique gate records")
    if any(item.status is EvidenceStatus.VERIFIED for item in registry.evidence):
        raise SystemExit("Phase 0 registry must not contain a claimed VERIFIED record")
    if (
        len(report_gates) != 13
        or set(report_gates) != expected
        or report.overall_status is not EvidenceStatus.BLOCKED
        or any(item.status is not EvidenceStatus.BLOCKED for item in report.gates)
    ):
        raise SystemExit("generated gate report must contain exactly 13 BLOCKED gates")
    print("Phase 0 artifacts: exact 13-gate set is BLOCKED; registry contains no VERIFIED claims")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
