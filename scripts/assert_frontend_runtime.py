"""Prove the production home route is built for runtime evaluation, not prerendered."""

from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from pathlib import Path


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--console-root", type=Path, required=True)
    args = parser.parse_args(argv)
    prerender_path = args.console_root / ".next" / "prerender-manifest.json"
    manifest: dict[str, object] = json.loads(prerender_path.read_text())
    routes = manifest.get("routes")
    if not isinstance(routes, dict):
        raise SystemExit("Next prerender manifest has no routes mapping")
    if "/" in routes:
        raise SystemExit("operations console / route was frozen into a prerendered snapshot")
    source = (args.console_root / "src" / "app" / "page.tsx").read_text()
    if 'dynamic = "force-dynamic"' not in source:
        raise SystemExit("operations console / route lacks its force-dynamic declaration")
    print("frontend runtime check: / is dynamic and absent from prerendered routes")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
