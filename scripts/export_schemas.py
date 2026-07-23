"""Export deterministic JSON Schema files for every frozen Phase 0 contract."""

from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from pathlib import Path

from prop_trading.contracts.models import SCHEMA_MODELS


def _render(model: type) -> bytes:
    return (
        json.dumps(model.model_json_schema(), ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    ).encode()


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args(argv)
    for name, model in SCHEMA_MODELS.items():
        target = args.output_dir / f"{name}.schema.json"
        rendered = _render(model)
        if args.check:
            if not target.exists() or target.read_bytes() != rendered:
                raise SystemExit(f"schema is stale: {target}")
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(rendered)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
