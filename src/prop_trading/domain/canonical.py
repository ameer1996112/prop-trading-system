"""Canonical JSON and SHA-256 contract shared by every Phase 0 artifact."""

from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Mapping, Sequence
from decimal import Decimal
from typing import NoReturn, cast

type CanonicalScalar = str | int | bool | None
type CanonicalValue = CanonicalScalar | list[CanonicalValue] | dict[str, CanonicalValue]

MAX_SAFE_INTEGER = 9_007_199_254_740_991
_KEY_PATTERN = re.compile(r"^[A-Za-z0-9_.:-]+$")
_DECIMAL_PATTERN = re.compile(r"^-?(?:0|[1-9][0-9]*)\.([0-9]+)$")


class CanonicalizationError(ValueError):
    """Raised when a value cannot participate in the frozen numeric/hash contract."""


def _reject_float(_value: str) -> NoReturn:
    raise CanonicalizationError("binary float and exponent JSON numbers are forbidden")


def _reject_constant(_value: str) -> NoReturn:
    raise CanonicalizationError("NaN and infinity are forbidden")


def _pairs_to_object(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise CanonicalizationError(f"duplicate object key: {key}")
        result[key] = value
    return result


def validate_fixed_decimal(value: str, *, scale: int, non_negative: bool = False) -> Decimal:
    """Validate a plain, fixed-scale decimal string and return its exact Decimal value."""
    if not isinstance(value, str):
        raise CanonicalizationError("fixed decimals must be JSON strings")
    match = _DECIMAL_PATTERN.fullmatch(value)
    if match is None or len(match.group(1)) != scale:
        raise CanonicalizationError(f"expected a plain decimal string with scale {scale}")
    decimal_value = Decimal(value)
    if non_negative and decimal_value < 0:
        raise CanonicalizationError("decimal must be non-negative")
    return decimal_value


def validate_canonical_value(value: object, *, location: str = "$") -> CanonicalValue:
    """Reject non-portable JSON types before serialization or hashing."""
    if value is None or isinstance(value, str | bool):
        if isinstance(value, str):
            if "\x00" in value:
                raise CanonicalizationError(
                    f"{location}: U+0000 is outside the PostgreSQL-compatible JSON profile"
                )
            try:
                value.encode("utf-8", errors="strict")
            except UnicodeEncodeError as exc:
                raise CanonicalizationError(f"{location}: invalid UTF-8 scalar") from exc
        return cast(CanonicalScalar, value)
    if isinstance(value, int):
        if not -MAX_SAFE_INTEGER <= value <= MAX_SAFE_INTEGER:
            raise CanonicalizationError(f"{location}: integer is outside cross-language range")
        return value
    if isinstance(value, float | Decimal):
        raise CanonicalizationError(
            f"{location}: numeric values must be integers or decimal strings"
        )
    if isinstance(value, Mapping):
        result: dict[str, CanonicalValue] = {}
        for key, item in value.items():
            if not isinstance(key, str) or _KEY_PATTERN.fullmatch(key) is None:
                raise CanonicalizationError(
                    f"{location}: object keys must use the ASCII key profile"
                )
            result[key] = validate_canonical_value(item, location=f"{location}.{key}")
        return result
    if isinstance(value, Sequence) and not isinstance(value, str | bytes | bytearray):
        if not isinstance(value, list):
            raise CanonicalizationError(f"{location}: arrays must be lists")
        return [
            validate_canonical_value(item, location=f"{location}[{index}]")
            for index, item in enumerate(value)
        ]
    raise CanonicalizationError(f"{location}: unsupported canonical type {type(value).__name__}")


def canonical_json_bytes(value: object) -> bytes:
    """Serialize with UTF-8, sorted keys, and no insignificant whitespace."""
    checked = validate_canonical_value(value)
    serialized = json.dumps(
        checked,
        ensure_ascii=False,
        allow_nan=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return serialized.encode("utf-8", errors="strict")


def canonical_sha256(value: object) -> str:
    """Hash canonical JSON bytes with lowercase SHA-256."""
    return hashlib.sha256(canonical_json_bytes(value)).hexdigest()


def parse_canonical_json(raw: bytes | str) -> CanonicalValue:
    """Parse raw JSON while rejecting duplicate keys, floats, exponent forms, and constants."""
    try:
        parsed = json.loads(
            raw,
            parse_int=int,
            parse_float=_reject_float,
            parse_constant=_reject_constant,
            object_pairs_hook=_pairs_to_object,
        )
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise CanonicalizationError("invalid UTF-8 JSON") from exc
    return validate_canonical_value(parsed)
