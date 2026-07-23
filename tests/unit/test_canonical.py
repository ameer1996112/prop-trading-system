from __future__ import annotations

import json
from decimal import Decimal
from pathlib import Path
from typing import Any

import pytest

from prop_trading.domain.canonical import (
    CanonicalizationError,
    canonical_json_bytes,
    canonical_sha256,
    parse_canonical_json,
    validate_fixed_decimal,
)


def _vectors() -> dict[str, Any]:
    return json.loads(Path("contracts/vectors/canonical-json-v1.json").read_text(encoding="utf-8"))


def test_python_matches_every_shared_valid_vector() -> None:
    for vector in _vectors()["valid"]:
        assert canonical_json_bytes(vector["value"]).decode() == vector["canonical_utf8"]
        assert canonical_sha256(vector["value"]) == vector["sha256"]


def test_python_rejects_every_shared_invalid_vector() -> None:
    for vector in _vectors()["invalid"]:
        if vector["operation"] == "parse":
            with pytest.raises(CanonicalizationError):
                parse_canonical_json(vector["raw_json"])
        else:
            with pytest.raises(CanonicalizationError):
                validate_fixed_decimal(vector["value"], scale=vector["scale"])


@pytest.mark.parametrize(
    "value",
    [
        1.0,
        float("nan"),
        float("inf"),
        Decimal("1.00"),
        (1, 2),
        9_007_199_254_740_992,
        "embedded\x00null",
    ],
)
def test_canonicalization_rejects_ambiguous_or_nonportable_types(value: object) -> None:
    with pytest.raises(CanonicalizationError):
        canonical_json_bytes({"value": value})


def test_raw_parser_rejects_duplicate_keys_and_constants() -> None:
    with pytest.raises(CanonicalizationError):
        parse_canonical_json('{"a":1,"a":2}')
    with pytest.raises(CanonicalizationError):
        parse_canonical_json('{"a":NaN}')


def test_fixed_decimal_preserves_scale_and_plain_notation() -> None:
    assert validate_fixed_decimal("0.04000000", scale=8) == Decimal("0.04000000")
    assert validate_fixed_decimal("-12.34", scale=2) == Decimal("-12.34")
