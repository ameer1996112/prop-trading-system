"""Prove the production console is a deployable static export."""

from __future__ import annotations

import argparse
from collections.abc import Sequence
from pathlib import Path


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--console-root", type=Path, required=True)
    args = parser.parse_args(argv)
    exported_index = args.console_root / "out" / "index.html"
    if not exported_index.is_file():
        raise SystemExit("operations console has no static out/index.html export")
    next_config = (args.console_root / "next.config.ts").read_text()
    if 'output: "export"' not in next_config:
        raise SystemExit('operations console lacks output: "export"')
    source = (args.console_root / "src" / "app" / "page.tsx").read_text()
    if 'dynamic = "force-dynamic"' in source:
        raise SystemExit("operations console / route still forces server rendering")
    print("frontend runtime check: static out/index.html export is present")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
