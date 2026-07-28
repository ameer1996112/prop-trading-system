"""Fail if runtime code grows any broker command or live/import configuration surface."""

from __future__ import annotations

import argparse
import json
import re
from collections.abc import Sequence
from pathlib import Path

RUNTIME_ROOTS = (
    Path("src/prop_trading"),
    Path("apps/observation-edge/src"),
    Path("apps/operations-console/src"),
)
V3_CONTRACT_PATH = Path("config/phase0/rd-strategy-rule-contract-v3.json")
FORBIDDEN_IDENTIFIERS = (
    "place" + "_order",
    "create" + "_market_order",
    "modify" + "_position",
    "close" + "_position",
    "cancel" + "_order",
    "execute" + "_trade",
    "trade" + "_request",
    "met" + "aapi_cloud_sdk",
)
FORBIDDEN_CONFIGURATION = (
    "META" + "API_TOKEN",
    "BROKER" + "_PASSWORD",
    "LIVE" + "_ACCOUNT",
    "IMPORTED" + "_ACCOUNT",
)


def check(root: Path) -> None:
    failures: list[str] = []
    contract_path = root / V3_CONTRACT_PATH
    if not contract_path.is_file():
        failures.append(f"{contract_path}: required v3 safety contract is missing")
    else:
        try:
            contract = json.loads(contract_path.read_text(encoding="utf-8"))
            automation_policy = contract["automation_policy"]
        except (json.JSONDecodeError, KeyError, TypeError) as error:
            failures.append(f"{contract_path}: invalid v3 safety contract: {error}")
        else:
            if automation_policy.get("paper_only") is not True:
                failures.append(f"{contract_path}: v3 paper_only must be true")
            if automation_policy.get("real_execution_allowed") is not False:
                failures.append(f"{contract_path}: v3 real_execution_allowed must be false")

    for relative_root in RUNTIME_ROOTS:
        runtime_root = root / relative_root
        if not runtime_root.exists():
            continue
        for path in sorted(runtime_root.rglob("*")):
            if path.suffix not in {".py", ".ts", ".tsx"} or not path.is_file():
                continue
            content = path.read_text(encoding="utf-8").lower()
            failures.extend(
                f"{path}: forbidden broker command identifier {identifier}"
                for identifier in FORBIDDEN_IDENTIFIERS
                if re.search(rf"\b{re.escape(identifier.lower())}\b", content)
            )
    configuration_files = [root / ".env.example", root / "compose.yaml"]
    for path in configuration_files:
        if not path.exists():
            continue
        content = path.read_text(encoding="utf-8")
        failures.extend(
            f"{path}: forbidden runtime configuration {name}"
            for name in FORBIDDEN_CONFIGURATION
            if name in content
        )
    if failures:
        raise SystemExit("\n".join(failures))


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path.cwd())
    args = parser.parse_args(argv)
    check(args.root)
    print("static boundary check: no broker command or live/import configuration surface")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
