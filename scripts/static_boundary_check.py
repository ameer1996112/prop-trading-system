"""Fail if runtime code grows any broker command or live/import configuration surface."""

from __future__ import annotations

import argparse
import re
from collections.abc import Sequence
from pathlib import Path

RUNTIME_ROOTS = (
    Path("src/prop_trading"),
    Path("apps/operations-console/src"),
)
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
