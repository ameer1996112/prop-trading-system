"""Require detect-secrets output to match a narrowly reviewed hash baseline exactly."""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Sequence
from pathlib import Path
from typing import Any

Finding = tuple[str, str, str]


def _findings(report: dict[str, Any]) -> set[Finding]:
    found: set[Finding] = set()
    for path, items in report.get("results", {}).items():
        for item in items:
            found.add((path, item["type"], item["hashed_secret"]))
    return found


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--baseline", type=Path, required=True)
    args = parser.parse_args(argv)
    baseline: dict[str, Any] = json.loads(args.baseline.read_text())
    observed: dict[str, Any] = json.load(sys.stdin)
    expected_findings = _findings(baseline)
    observed_findings = _findings(observed)
    unexpected = sorted(observed_findings - expected_findings)
    stale = sorted(expected_findings - observed_findings)
    if unexpected or stale:
        for path, kind, _hashed_secret in unexpected:
            print(f"unexpected potential secret: {path}: {kind}", file=sys.stderr)
        for path, kind, _hashed_secret in stale:
            print(f"stale secret-scan baseline entry: {path}: {kind}", file=sys.stderr)
        return 1
    print(f"secret scan: {len(observed_findings)} narrowly baselined false positive(s), 0 new")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
