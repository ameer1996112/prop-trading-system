"""Generate shared Python/TypeScript canonical JSON golden vectors."""

from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from pathlib import Path
from typing import Any

from prop_trading.domain.canonical import canonical_json_bytes, canonical_sha256


def build_vectors() -> dict[str, Any]:
    values: list[tuple[str, object]] = [
        ("empty-object", {}),
        ("sorted-nested", {"z": [3, {"b": True, "a": None}], "a": "value"}),
        ("unicode-value", {"message": "שלום", "strategy": "rd_liquidity_sd_5m_v1"}),
        (
            "numeric-domain",
            {
                "entry_ticks": 108765,
                "lot_steps": 7,
                "money": {"currency": "USD", "minor_units": 12345, "scale": 2},
                "ratio": "0.04000000",
                "tick_size": "0.00001",
            },
        ),
    ]
    valid = [
        {
            "name": name,
            "value": value,
            "canonical_utf8": canonical_json_bytes(value).decode("utf-8"),
            "sha256": canonical_sha256(value),
        }
        for name, value in values
    ]
    invalid = [
        {
            "name": "duplicate-root-key",
            "operation": "parse",
            "raw_json": '{"value":1,"value":2}',
        },
        {
            "name": "duplicate-nested-key",
            "operation": "parse",
            "raw_json": '{"outer":{"value":1,"value":2}}',
        },
        {
            "name": "lone-high-surrogate-value",
            "operation": "parse",
            "raw_json": '{"value":"\\ud800"}',
        },
        {
            "name": "lone-low-surrogate-value",
            "operation": "parse",
            "raw_json": '{"value":"\\udc00"}',
        },
        {
            "name": "lone-high-surrogate-key",
            "operation": "parse",
            "raw_json": '{"\\ud800":"value"}',
        },
        {
            "name": "lone-low-surrogate-key",
            "operation": "parse",
            "raw_json": '{"\\udc00":"value"}',
        },
        {
            "name": "postgresql-incompatible-null-code-point",
            "operation": "parse",
            "raw_json": '{"value":"\\u0000"}',
        },
        {"name": "binary-float", "operation": "parse", "raw_json": '{"value":1.25}'},
        {"name": "exponent-number", "operation": "parse", "raw_json": '{"value":1e3}'},
        {
            "name": "unsafe-integer",
            "operation": "parse",
            "raw_json": '{"value":9007199254740992}',
        },
        {
            "name": "decimal-exponent-string",
            "operation": "fixed_decimal",
            "scale": 2,
            "value": "1e-2",
        },
        {
            "name": "decimal-leading-zero",
            "operation": "fixed_decimal",
            "scale": 2,
            "value": "01.00",
        },
        {
            "name": "decimal-wrong-scale",
            "operation": "fixed_decimal",
            "scale": 2,
            "value": "1.0",
        },
    ]
    return {"schema_id": "phase0.canonical-json-golden-v1", "invalid": invalid, "valid": valid}


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args(argv)
    rendered = (
        json.dumps(build_vectors(), ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    ).encode()
    if args.check:
        if not args.output.exists() or args.output.read_bytes() != rendered:
            raise SystemExit(f"golden vectors are stale: {args.output}")
    else:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_bytes(rendered)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
