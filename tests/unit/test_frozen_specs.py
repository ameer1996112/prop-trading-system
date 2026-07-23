from __future__ import annotations

from pathlib import Path

import pytest
from scripts.assert_frozen_specs import ACT3_PREFIX, validate_frozen_bytes


def _approved() -> tuple[bytes, bytes]:
    return Path("PLAN.md").read_bytes(), Path("PLAN-REVIEW-LOG.md").read_bytes()[:23_929]


def test_exact_approved_prefix_and_valid_act3_suffix_pass() -> None:
    plan, log = _approved()
    validate_frozen_bytes(plan, log)
    validate_frozen_bytes(plan, log + ACT3_PREFIX + b"reviewer-owned content\n")


@pytest.mark.parametrize(
    "mutation",
    [
        "prefix",
        "truncated",
        "arbitrary_suffix",
        "duplicate_act3",
        "later_act",
        "indented_heading",
        "tab_heading",
        "h1_heading",
        "setext_heading",
        "invalid_utf8",
    ],
)
def test_prefix_mutation_truncation_and_arbitrary_suffix_fail(mutation: str) -> None:
    plan, log = _approved()
    if mutation == "prefix":
        candidate = b"X" + log[1:]
    elif mutation == "truncated":
        candidate = log[:-1]
    elif mutation == "duplicate_act3":
        candidate = log + ACT3_PREFIX + b"first\n## Act 3 \xe2\x80\x94 Build\nsecond\n"
    elif mutation == "later_act":
        candidate = log + ACT3_PREFIX + b"review\n## Act 4 \xe2\x80\x94 Commit\n"
    elif mutation == "indented_heading":
        candidate = log + ACT3_PREFIX + b"review\n  ## Act 4\n"
    elif mutation == "tab_heading":
        candidate = log + ACT3_PREFIX + b"review\n##\tAct 4\n"
    elif mutation == "h1_heading":
        candidate = log + ACT3_PREFIX + b"review\n# Act 4\n"
    elif mutation == "setext_heading":
        candidate = log + ACT3_PREFIX + b"review\nAct 4\n---\n"
    elif mutation == "invalid_utf8":
        candidate = log + ACT3_PREFIX + b"review\n\xff\n"
    else:
        candidate = log + b"\nnot Act 3\n"
    with pytest.raises(ValueError, match="prefix|truncated|suffix|top-level act|UTF-8"):
        validate_frozen_bytes(plan, candidate)
