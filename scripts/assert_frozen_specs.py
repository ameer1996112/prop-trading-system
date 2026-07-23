"""Freeze PLAN in full and the reviewer-approved PLAN-REVIEW-LOG prefix exactly."""

from __future__ import annotations

import hashlib
import re
from pathlib import Path

PLAN_SHA256 = "c64c7f45e21dd578ffc191895ce0df4e074184f910dbb659ad53d630643ea99e"
REVIEW_LOG_PREFIX_BYTES = 23_929
REVIEW_LOG_PREFIX_SHA256 = "4ad7f8b3e68ac4392a8fdc79f6018c55d26450eea68e2c71cd59a74decbc9e87"
ACT3_PREFIX = b"\n\n## Act 3 \xe2\x80\x94 Build\n"
_TOP_LEVEL_ATX_HEADING = re.compile(r" {0,3}#{1,2}(?:[ \t]+|$)")
_SETEXT_HEADING_UNDERLINE = re.compile(r" {0,3}(?:=+|-+)[ \t]*$")


def validate_frozen_bytes(plan: bytes, review_log: bytes) -> None:
    if hashlib.sha256(plan).hexdigest() != PLAN_SHA256:
        raise ValueError("reviewer-owned frozen file changed: PLAN.md")
    if len(review_log) < REVIEW_LOG_PREFIX_BYTES:
        raise ValueError("PLAN-REVIEW-LOG.md approved prefix was truncated")
    approved_prefix = review_log[:REVIEW_LOG_PREFIX_BYTES]
    if hashlib.sha256(approved_prefix).hexdigest() != REVIEW_LOG_PREFIX_SHA256:
        raise ValueError("PLAN-REVIEW-LOG.md approved prefix changed")
    suffix = review_log[REVIEW_LOG_PREFIX_BYTES:]
    if suffix and not suffix.startswith(ACT3_PREFIX):
        raise ValueError("PLAN-REVIEW-LOG.md suffix is not an approved Act 3 build append")
    if suffix:
        act3_body_bytes = suffix[len(ACT3_PREFIX) :]
        try:
            act3_body = act3_body_bytes.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise ValueError("PLAN-REVIEW-LOG.md Act 3 append is not valid UTF-8") from exc
        if any(
            _TOP_LEVEL_ATX_HEADING.match(line) or _SETEXT_HEADING_UNDERLINE.fullmatch(line)
            for line in act3_body.splitlines()
        ):
            raise ValueError("PLAN-REVIEW-LOG.md Act 3 append contains another top-level act")


def main() -> int:
    try:
        validate_frozen_bytes(Path("PLAN.md").read_bytes(), Path("PLAN-REVIEW-LOG.md").read_bytes())
    except ValueError as exc:
        raise SystemExit(str(exc)) from exc
    print(
        "frozen spec check: PLAN.md full hash and PLAN-REVIEW-LOG.md 23,929-byte "
        "approved prefix unchanged; optional suffix is Act 3 only"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
