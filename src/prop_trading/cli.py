"""Deterministic Phase 0 command-line reports."""

from __future__ import annotations

import argparse
from collections.abc import Sequence
from pathlib import Path

from prop_trading.application.gates import evaluate_phase0
from prop_trading.contracts.models import Phase0EvidenceRegistry
from prop_trading.domain.canonical import canonical_json_bytes, parse_canonical_json


def _gate_report(evidence: Path, output: Path, check: bool) -> int:
    parsed = parse_canonical_json(evidence.read_bytes())
    registry = Phase0EvidenceRegistry.model_validate_json(canonical_json_bytes(parsed))
    rendered = canonical_json_bytes(evaluate_phase0(registry).model_dump(mode="json")) + b"\n"
    if check:
        if not output.exists() or output.read_bytes() != rendered:
            raise SystemExit(f"gate report is stale: run phase0-gates without --check for {output}")
        return 0
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(rendered)
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="phase0")
    subparsers = parser.add_subparsers(dest="command", required=True)
    gates = subparsers.add_parser("gates", help="evaluate all Phase 0 gates")
    gates.add_argument("--evidence", type=Path, required=True)
    gates.add_argument("--output", type=Path, required=True)
    gates.add_argument("--check", action="store_true")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.command == "gates":
        return _gate_report(args.evidence, args.output, args.check)
    raise AssertionError("argparse accepted an unknown command")


if __name__ == "__main__":
    raise SystemExit(main())
