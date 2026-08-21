#!/usr/bin/env python3
"""Generate the release Pine deterministically from the LAB authoring source."""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

BEGIN = re.compile(r"^// @lab-only-begin ([a-z0-9-]+)\n$")
END = re.compile(r"^// @lab-only-end ([a-z0-9-]+)\n$")
LAB_TITLE = 'indicator("SND RD 5M V3 THREE ENTRY LAB"'
RELEASE_TITLE = 'indicator("SND RD 5M V3 RELEASE"'
REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_LAB = REPOSITORY_ROOT / "scripts/pinescript/SND_RD_5M_V3_THREE_ENTRY_LAB.pine"
DEFAULT_RELEASE = REPOSITORY_ROOT / "scripts/pinescript/SND_RD_5M_V3_RELEASE.pine"


def generate_release(source: str) -> str:
    """Remove well-formed LAB-only sections and substitute the release title."""
    stack: list[str] = []
    seen: set[str] = set()
    output: list[str] = []
    for line in source.splitlines(keepends=True):
        if match := BEGIN.fullmatch(line):
            name = match.group(1)
            if name in seen:
                raise ValueError(f"duplicate lab-only section: {name}")
            seen.add(name)
            stack.append(name)
        elif match := END.fullmatch(line):
            name = match.group(1)
            if not stack:
                raise ValueError(f"unexpected lab-only end: {name}")
            if stack[-1] != name:
                raise ValueError(f"crossed lab-only section: {name}")
            stack.pop()
        elif line.startswith(("// @lab-only-begin", "// @lab-only-end")):
            raise ValueError(f"malformed lab-only marker: {line.rstrip()}")
        elif not stack:
            output.append(line)
    if stack:
        raise ValueError(f"unclosed lab-only section: {stack[-1]}")
    return "".join(output).replace(LAB_TITLE, RELEASE_TITLE, 1)


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--lab", type=Path, default=DEFAULT_LAB)
    parser.add_argument("--release", type=Path, default=DEFAULT_RELEASE)
    parser.add_argument(
        "--check",
        action="store_true",
        help="fail if the checked-in release bytes differ; do not write",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        generated = generate_release(args.lab.read_bytes().decode("utf-8"))
    except (OSError, UnicodeError, ValueError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 2

    generated_bytes = generated.encode("utf-8")
    if args.check:
        try:
            current_bytes = args.release.read_bytes()
        except FileNotFoundError:
            current_bytes = b""
        except OSError as error:
            print(f"error: {error}", file=sys.stderr)
            return 2
        if current_bytes != generated_bytes:
            print(
                f"error: release Pine is out of date: {args.release}",
                file=sys.stderr,
            )
            return 1
        return 0

    try:
        args.release.parent.mkdir(parents=True, exist_ok=True)
        args.release.write_bytes(generated_bytes)
    except OSError as error:
        print(f"error: {error}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
