"""Freeze reviewer-approved specifications and the v3 contract exactly."""

from __future__ import annotations

import hashlib
import re
from pathlib import Path

PLAN_SHA256 = "c64c7f45e21dd578ffc191895ce0df4e074184f910dbb659ad53d630643ea99e"
REVIEW_LOG_PREFIX_BYTES = 23_929
REVIEW_LOG_PREFIX_SHA256 = "4ad7f8b3e68ac4392a8fdc79f6018c55d26450eea68e2c71cd59a74decbc9e87"
RD_BOC_THREE_ENTRY_DESIGN_SHA256 = (
    "58eac0077950e90d76bdfe36a8e3d9df4342ae62efd466da0909b0f954340cdc"
)
RD_BOC_THREE_ENTRY_IMPLEMENTATION_PLAN_SHA256 = (
    "7d254addf2b73f42add8230ec2448740f0534335382d2773c7afe65b96638846"
)
RD_STRATEGY_RULE_CONTRACT_V3_SHA256 = (
    "df5e6a0eec33dad51a8d1d9584f5d169aa6c06b8538e05d10f3e04f3a0312625"
)
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


def validate_frozen_v3_bytes(
    design: bytes,
    implementation_plan: bytes,
    contract: bytes,
) -> None:
    checks = (
        (
            design,
            RD_BOC_THREE_ENTRY_DESIGN_SHA256,
            "reviewer-owned frozen file changed: RD BOC three-entry design",
        ),
        (
            implementation_plan,
            RD_BOC_THREE_ENTRY_IMPLEMENTATION_PLAN_SHA256,
            "reviewer-owned frozen file changed: RD BOC three-entry implementation plan",
        ),
        (
            contract,
            RD_STRATEGY_RULE_CONTRACT_V3_SHA256,
            "frozen file changed: RD strategy rule contract v3",
        ),
    )
    for content, expected_digest, message in checks:
        if hashlib.sha256(content).hexdigest() != expected_digest:
            raise ValueError(message)


def main() -> int:
    try:
        validate_frozen_bytes(Path("PLAN.md").read_bytes(), Path("PLAN-REVIEW-LOG.md").read_bytes())
        validate_frozen_v3_bytes(
            Path(
                "docs/superpowers/specs/2026-07-28-rd-boc-three-entry-arbitration-design.md"
            ).read_bytes(),
            Path(
                "docs/superpowers/plans/2026-07-28-rd-boc-three-entry-implementation.md"
            ).read_bytes(),
            Path("config/phase0/rd-strategy-rule-contract-v3.json").read_bytes(),
        )
    except ValueError as exc:
        raise SystemExit(str(exc)) from exc
    print(
        "frozen spec check: plans, approved design, and RD contract v3 unchanged; "
        "PLAN-REVIEW-LOG.md optional suffix is Act 3 only"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
